/* =========================================================
  TyöaikaSeuranta - app.js (päivitetty)
  Muutokset:
  - PIN OK -> suoraan Työaika (viewMenu ohitetaan)
  - Varmistusdialogi (modal): ALOITA / TAUKO-JATKA / LOPETA / TANKKAUS
  - 1s välein vain live-laskenta (ei historiaa joka sekunti)
  - Turva: käynnissä oleva työ on käyttäjäkohtainen (lukitsee napit jos eri user)
========================================================= */

(() => {
  // ---------- CONFIG ----------
  const USERS = ["Juha", "Matti", "Janne", "Tommi"];
  
  // Hardcoded endpoints
  const HARD_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyFO7eewNr2L-PRgRktrBwYUHA9ub5JzDG6Vf9SyJEcvUDY1wP8o2IKOkzCqzzH75mN/exec";
  const HARD_FUEL_URL = "https://vilmusenahojuha-stack.github.io/Tankkaus/";
  const HARD_CARDS_URL = "https://vilmusenahojuha-stack.github.io/kortit-perehdytykset/";
  const HARD_CARDS_API_URL = "https://script.google.com/macros/s/AKfycbws1ods-A_0YnJ04cWHU8D5bTdGVg8Z36qA6lsuyEUHYuDlneG_KkOd32ZP8tK1-4Vc/exec";

const STORAGE = {
    session: "ta_new_session_v2",
    cfg: "ta_new_cfg_v2",
    running: "ta_new_running_v2",
    history: "ta_new_history_v2",
  };

  const DEFAULT_CFG = {
  sheetsUrl: "https://script.google.com/macros/s/AKfycbyFO7eewNr2L-PRgRktrBwYUHA9ub5JzDG6Vf9SyJEcvUDY1wP8o2IKOkzCqzzH75mN/exec",
  fuelUrl: "https://vilmusenahojuha-stack.github.io/Tankkaus/",
  plates: ["ISS-440", "GPG-830"],
};

  // ---------- DOM HELPERS ----------
  function normalizePlate(s){
  return String(s||"").trim().toUpperCase();
}

function renderPlates(){
  const sel = $("plateSelect");
  if (!sel) return;

  // TEST-rekisterit eivät saa jäädä selaimen vanhoista asetuksista.
  cfg.plates = [...new Set((cfg.plates || []).map(normalizePlate).filter(p => p && !/^TEST(?:-|$)/.test(p)))];
  if (!cfg.plates.includes("ISS-440")) cfg.plates.push("ISS-440");
  if (!cfg.plates.includes("GPG-830")) cfg.plates.push("GPG-830");
  cfg.plates.sort();
  Sset(STORAGE.cfg, cfg);

  const cur = sel.value;
  sel.innerHTML = `<option value="">Valitse rekisteri…</option>`;

  for (const p of (cfg.plates || [])) {
    const o = document.createElement("option");
    o.value = p;
    o.textContent = p;
    sel.appendChild(o);
  }

  const restore = (cfg.plates || []).includes(cur)
    ? cur
    : ((running && running.user === session?.user && cfg.plates.includes(running.plate))
      ? running.plate
      : (cfg.plates.includes(cfg.lastPlate) ? cfg.lastPlate : ""));
  sel.value = restore;
}
  const $ = (id) => document.getElementById(id);
  const toastEl = $("toast");

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.display = "block";
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => (toastEl.style.display = "none"), 2400);
  }

  function showView(viewId) {
    const ids = ["viewLogin", "viewPin", "viewMenu", "viewWork", "viewSettings"];
    ids.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.style.display = id === viewId ? "block" : "none";
    });
  }

  function showModal(modalId, show) {
    const el = $(modalId);
    if (!el) return;
    el.style.display = show ? "flex" : "none";
  }

  function Sget(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  function Sset(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("Paikallinen tallennus epäonnistui", error);
      toast("Laitteen tallennustila ei ole käytettävissä.");
      return false;
    }
  }

  // ---------- STATE ----------
  let cfg = Sget(STORAGE.cfg, DEFAULT_CFG);
  // Uusi sovellus käyttää aina vain omaa kiinteää Sheets-palvelua.
  cfg.sheetsUrl = HARD_SHEETS_URL;
  // Päivitä testiversion rekisterit kerran; myöhemmin lisätyt rekisterit säilyvät.
  if (cfg.platesVersion !== 3) {
    cfg.plates = ["ISS-440", "GPG-830"];
    cfg.platesVersion = 3;
    Sset(STORAGE.cfg, cfg);
  }
  let session = Sget(STORAGE.session, { user: "", authed: false, cardToken: "" });
  let running = Sget(STORAGE.running, null);   // current running day
  let history = Sget(STORAGE.history, []);     // approved rows
  let syncInProgress = false;

  // running structure:
  // {
  //   id, user, startTs,
  //   breakSegments:[{s,e?}],
  //   perDiem:0|1|2,
  //   state:"running"|"break"
  // }

  // ---------- TIME HELPERS ----------
  function normalizePlate(s){ return String(s||"").trim().toUpperCase(); }
function getSelectedPlate(){ return normalizePlate($("plateSelect")?.value || ""); }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function toLocalDateStr(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  }
  function toLocalTimeStr(ts) {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function minutesToHHMM(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }
  function minutesToText(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h} h ${m} min`;
  }
  
  // Minutes -> decimal hours string (60min=1, 90min=1.5)
  function minutesToHoursDec(min, decimals = 2) {
    const h = Math.max(0, Number(min) || 0) / 60;
    // round to decimals
    const factor = Math.pow(10, decimals);
    const rounded = Math.round(h * factor) / factor;
    // strip trailing zeros
    let s = String(rounded.toFixed(decimals));
    s = s.replace(/\.0+$/,"").replace(/(\.\d*[1-9])0+$/,"$1");
    return s;
  }
  
  function clampInt(x, min, max) {
    x = Number(x);
    if (!Number.isFinite(x)) x = min;
    return Math.min(max, Math.max(min, Math.round(x)));
  }

  function dateTimeToTs(dateStr, hhmm) {
    const parts = String(dateStr || "").split("-").map(Number);
    const time = String(hhmm || "00:00").split(":").map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return NaN;
    return new Date(parts[0], parts[1] - 1, parts[2], time[0] || 0, time[1] || 0, 0, 0).getTime();
  }

  function parseTimeToTsSameDay(baseDateTs, hhmm) {
    const d = new Date(baseDateTs);
    const [hh, mm] = (hhmm || "00:00").split(":").map(Number);
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d.getTime();
  }

  // If end time is "earlier" than start time, treat as next day
  function ensureEndAfterStart(startTs, endTsCandidate) {
    if (endTsCandidate >= startTs) return endTsCandidate;
    return endTsCandidate + 24 * 60 * 60 * 1000;
  }

  // ---------- P / I / Y segmentation ----------
  // P = 06:00–18:00
  // I = 18:00–22:00
  // Y = 22:00–06:00
  function segmentTypeForDate(d) {
    const t = d.getHours() * 60 + d.getMinutes();
    if (t >= 6*60 && t < 18*60) return "day";
    if (t >= 18*60 && t < 22*60) return "eve";
    return "night";
  }

  function nextBoundaryTs(ts) {
    const d = new Date(ts);
    const y = d.getFullYear(), mo = d.getMonth(), da = d.getDate();
    const mins = d.getHours() * 60 + d.getMinutes();

    const make = (hour, minute, addDays=0) => new Date(y, mo, da + addDays, hour, minute, 0, 0).getTime();

    const b0600 = make(6,0,0);
    const b1800 = make(18,0,0);
    const b2200 = make(22,0,0);

    if (mins < 6*60) return b0600;
    if (mins < 18*60) return b1800;
    if (mins < 22*60) return b2200;
    return make(6,0,1);
  }

  function splitPIY(startTs, endTs) {
    let cur = startTs;
    const out = { day: 0, eve: 0, night: 0 };

    while (cur < endTs) {
      const type = segmentTypeForDate(new Date(cur));
      const nb = Math.min(nextBoundaryTs(cur), endTs);
      out[type] += (nb - cur) / 60000;
      cur = nb;
    }

    out.day = Math.round(out.day);
    out.eve = Math.round(out.eve);
    out.night = Math.round(out.night);
    return out;
  }

  function sumBreakMinutes(breakSegments, nowTs) {
    let total = 0;
    for (const b of breakSegments || []) {
      if (b.s && b.e) total += (b.e - b.s) / 60000;
      else if (b.s && !b.e) total += (nowTs - b.s) / 60000;
    }
    return Math.max(0, Math.round(total));
  }

  function computeDeduct(breakTotalMin) {
    return Math.max(0, breakTotalMin - 30);
  }

  function allocateDeduct(rawSeg, deductMin) {
    const day = rawSeg.day, eve = rawSeg.eve, night = rawSeg.night;
    const rawTotal = day + eve + night;
    if (rawTotal <= 0 || deductMin <= 0) return { dDay: 0, dEve: 0, dNight: 0 };

    let dDay = Math.floor(deductMin * (day / rawTotal));
    let dEve = Math.floor(deductMin * (eve / rawTotal));
    let dNight = Math.floor(deductMin * (night / rawTotal));
    let used = dDay + dEve + dNight;
    let rem = deductMin - used;

    const arr = [
      { k: "day", v: day },
      { k: "eve", v: eve },
      { k: "night", v: night },
    ].sort((a,b) => b.v - a.v);

    let i = 0;
    while (rem > 0 && i < 50) {
      const k = arr[i % arr.length].k;
      if (k === "day") dDay++;
      else if (k === "eve") dEve++;
      else dNight++;
      rem--;
      i++;
    }

    dDay = Math.min(dDay, day);
    dEve = Math.min(dEve, eve);
    dNight = Math.min(dNight, night);

    let shortage = deductMin - (dDay + dEve + dNight);
    if (shortage > 0) {
      const caps = [
        { k: "day", cap: day - dDay },
        { k: "eve", cap: eve - dEve },
        { k: "night", cap: night - dNight },
      ].sort((a,b) => b.cap - a.cap);

      for (const c of caps) {
        if (shortage <= 0) break;
        const add = Math.min(shortage, Math.max(0, c.cap));
        if (c.k === "day") dDay += add;
        if (c.k === "eve") dEve += add;
        if (c.k === "night") dNight += add;
        shortage -= add;
      }
    }

    return { dDay, dEve, dNight };
  }

  // ---------- SHEETS ----------
  // ---------- SHEETS: helpers ----------
async function sheetsPost(payload) {
  const url = (HARD_SHEETS_URL || (cfg?.sheetsUrl || "")).trim();
  if (!url) throw new Error("Sheets URL puuttuu (cfg.sheetsUrl).");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, workToken: session?.cardToken || "" }),
  });

  const txt = await res.text();
  let data = null;
  try { data = JSON.parse(txt); } catch {}

  if (!res.ok || !data || data.ok !== true) {
    const msg = (data && (data.error || data.message)) ? (data.error || data.message) : txt;
    throw new Error(`Sheets virhe: ${String(msg).slice(0, 220)}`);
  }
  return data;
}

// Map Sheets-row -> app history entry (pidetään samat avaimet mitä list palauttaa)
function normalizeRow(r) {
  // Varmistus + defaultit, ettei render hajoa puuttuviin kenttiin
  return {
    user: r.user || "",
    plate: r.plate || "",
    startDate: r.startDate || "",
    startTime: r.startTime || "",
    endDate: r.endDate || "",
    endTime: r.endTime || "",
    breakTotalMin: Number(r.breakTotalMin || 0),
    breakDeductMin: Number(r.breakDeductMin || 0),
    dayMin: Number(r.dayMin || 0) || Math.round(Number(r.dayH || 0) * 60),
    eveMin: Number(r.eveMin || 0) || Math.round(Number(r.eveH || 0) * 60),
    nightMin: Number(r.nightMin || 0) || Math.round(Number(r.nightH || 0) * 60),
    totalMin: Number(r.totalMin || 0) || Math.round(Number(r.totalH || 0) * 60),
    perDiem: Number(r.perDiem || 0),
    approved: Boolean(r.approved),
    timestamp: r.timestamp || "",
    id: r.id || "",
    // paikallinen apukenttä (ei pakko käyttää)
    sent: true,
  };
}

// ---------- HISTORY: fetch from Sheets ----------
async function fetchHistoryFromSheets(user) {
  if (!user) return [];

  const data = await sheetsPost({
    action: "list",
    user: user
  });

  const rows = Array.isArray(data.rows) ? data.rows : [];

  // Normalisoidaan rivit UI:lle
  return rows.map(r => ({
    user: r.user || "",
    plate: r.plate || "",
    startDate: r.startDate || "",
    startTime: r.startTime || "",
    endDate: r.endDate || "",
    endTime: r.endTime || "",
    breakTotalMin: Number(r.breakTotalMin || 0),
    breakDeductMin: Number(r.breakDeductMin || 0),
    dayMin: Number(r.dayMin || 0) || Math.round(Number(r.dayH || 0) * 60),
    eveMin: Number(r.eveMin || 0) || Math.round(Number(r.eveH || 0) * 60),
    nightMin: Number(r.nightMin || 0) || Math.round(Number(r.nightH || 0) * 60),
    totalMin: Number(r.totalMin || 0) || Math.round(Number(r.totalH || 0) * 60),
    perDiem: Number(r.perDiem || 0),
    approved: Boolean(r.approved),
    timestamp: r.timestamp || "",
    id: r.id || "",
    sent: true
  }));
}

function entryKey(e) {
  if (e && e.id) return "id:" + String(e.id);
  return [e?.user, e?.plate, e?.startDate, e?.startTime, e?.endDate, e?.endTime, e?.totalMin]
    .map(v => String(v ?? "")).join("|");
}

// ---------- HISTORY: always from Sheets ----------
async function refreshHistoryFromSheets() {
  const user = session?.user;
  if (!user) return;

  try {
    const currentPending = history.filter(e => e && e.user === user && e.approved && e.sent !== true);
    const otherPending = history.filter(e => e && e.user !== user && e.approved && e.sent !== true);
    const rows = await fetchHistoryFromSheets(user);
    const remoteKeys = new Set(rows.map(entryKey));
    const unresolved = currentPending.filter(e => !remoteKeys.has(entryKey(e)));
    history = [...rows, ...unresolved, ...otherPending];
    Sset(STORAGE.history, history);
    Sset(`ta_history_cache_${user}`, rows);
    renderAll({ full: true });
  } catch (err) {
    const currentPending = history.filter(e => e && e.user === user && e.approved && e.sent !== true);
    const otherPending = history.filter(e => e && e.user !== user && e.approved && e.sent !== true);
    const cached = Sget(`ta_history_cache_${user}`, []);
    const pendingKeys = new Set(currentPending.map(entryKey));
    history = [...cached.filter(e => !pendingKeys.has(entryKey(e))), ...currentPending, ...otherPending];
    Sset(STORAGE.history, history);
    renderAll({ full: true });
    toast("Offline-tila: lähettämättömät merkinnät säilyvät jonossa.");
  }
}
  async function postSheets(url, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ ...payload, workToken: session?.cardToken || "" }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const txt = await res.text();
    let data = null;
    try { data = JSON.parse(txt); } catch {}
    return { ok: res.ok && data && data.ok === true, resOk: res.ok, data, text: txt };
  }

  function decimalHours(min) {
    return Math.round(((Number(min) || 0) / 60) * 100) / 100;
  }

  function entryToSheetRow(e) {
    return {
      id: e.id || "",
      user: e.user,
      plate: e.plate || "",
      startDate: e.startDate,
      startTime: e.startTime,
      endDate: e.endDate,
      endTime: e.endTime,
      breakTotalMin: e.breakTotalMin,
      breakDeductMin: e.breakDeductMin,
      dayH: decimalHours(e.dayMin),
      eveH: decimalHours(e.eveMin),
      nightH: decimalHours(e.nightMin),
      totalH: decimalHours(e.totalMin),
      perDiem: e.perDiem,
      approved: true,
      timestamp: new Date(e.approvedTs).toISOString(),
    };
  }

 async function trySendEntryToSheets(entry) {
  const url = (HARD_SHEETS_URL || (cfg.sheetsUrl || "")).trim();
  if (!url) {
    entry.sent = false;
    entry.sentErr = "Sheets URL puuttuu";
    persist();
    return false;
  }

  try {
    const r = await postSheets(url, {
      action: "append",
      rows: [entryToSheetRow(entry)],
    });

    const ok = (r && r.ok === true);
    if (!ok) {
      const msg = (r?.data?.error) ? String(r.data.error) : "Sheets-vastaus ei kelpaa";
      throw new Error(msg);
    }

    entry.sent = true;
    entry.sentErr = "";
    persist();

    // tärkein: aina päivitetään historia Sheetistä (tämä renderöi)
    await refreshHistoryFromSheets();

    return true;

  } catch (err) {
    entry.sent = false;
    entry.sentErr = String(err?.message || err);
    persist();

    // virhetilassa näytä paikallinen tila (ei refresh)
    renderAll({ full: true });
    return false;
  }
}

  async function syncUnsent({ silent = false } = {}) {
    if (syncInProgress || !session?.user) return;
    syncInProgress = true;
    const url = HARD_SHEETS_URL.trim();
    const unsent = history.filter(h => h.user === session.user && h.approved && h.sent !== true);

    if (!unsent.length) {
      syncInProgress = false;
      if (!silent) toast("Ei lähettämättömiä.");
      return;
    }

    let sentCount = 0;
    let failedCount = 0;
    if (!silent) toast(`Lähetetään ${unsent.length} kpl...`);

    try {
      for (const entry of unsent) {
        try {
          const result = await postSheets(url, { action: "append", rows: [entryToSheetRow(entry)] });
          if (!result.ok) throw new Error(result?.data?.error || "Sheets-vastaus ei kelpaa");
          entry.sent = true;
          entry.sentAt = Date.now();
          entry.sentErr = "";
          sentCount++;
        } catch (error) {
          entry.sent = false;
          entry.sentErr = String(error?.message || error);
          failedCount++;
        }
        persist();
        renderAll({ full: true });
      }

      if (sentCount) await refreshHistoryFromSheets();
      if (!silent) {
        if (!failedCount) toast(`Lähetys onnistui: ${sentCount} ✔`);
        else toast(`Lähetetty ${sentCount}, jonossa ${failedCount}.`);
      }
    } finally {
      syncInProgress = false;
    }
  }

  async function testSheets() {
    const url = (HARD_SHEETS_URL || ($("sheetsUrl")?.value || "")).trim();
    if (!url) return toast("Lisää /exec URL ensin.");
    toast("Testataan...");
    try {
      const r = await postSheets(url, { action: "ping" });
      toast(r.ok ? "Sheets OK ✔" : "Sheets ei vastaa oikein ✖");
    } catch {
      toast("Testi epäonnistui ✖");
    }
  }

  // ---------- CONFIRM MODAL (auto-injected) ----------
  function ensureConfirmModal() {
    if ($("modalConfirm")) return;

    const wrap = document.createElement("div");
    wrap.className = "modal";
    wrap.id = "modalConfirm";
    wrap.style.display = "none";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");

    wrap.innerHTML = `
      <div class="modalSheet">
        <div class="modalHead">
          <div>
            <div class="h2" id="confTitle">Varmistus</div>
            <div class="muted" id="confText"></div>
          </div>
          <button class="btn btn-ghost" id="confClose">✕</button>
        </div>
        <div class="btnbar">
          <button class="btn btn-ghost" id="confCancel">Peruuta</button>
          <button class="btn btn-blue" id="confOk">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  function confirmModal(text, okLabel = "OK") {
    ensureConfirmModal();
    return new Promise((resolve) => {
      const modal = $("modalConfirm");
      const t = $("confText");
      const ok = $("confOk");
      const cancel = $("confCancel");
      const close = $("confClose");

      if (t) t.textContent = text || "";
      if (ok) ok.textContent = okLabel || "OK";

      const cleanup = () => {
        ok?.removeEventListener("click", onOk);
        cancel?.removeEventListener("click", onCancel);
        close?.removeEventListener("click", onCancel);
      };

      const onOk = () => {
        cleanup();
        showModal("modalConfirm", false);
        resolve(true);
      };
      const onCancel = () => {
        cleanup();
        showModal("modalConfirm", false);
        resolve(false);
      };

      ok?.addEventListener("click", onOk);
      cancel?.addEventListener("click", onCancel);
      close?.addEventListener("click", onCancel);

      showModal("modalConfirm", true);
    });
  }

  // ---------- PERSIST / RENDER ----------
  function renderForeignRunningLock() {
  const box = document.getElementById("foreignRunningBox");
  const name = document.getElementById("foreignRunningUser");
  if (!box || !name) return;

  if (running && session.user && running.user !== session.user) {
    name.textContent = running.user;
    box.style.display = "block";
  } else {
    box.style.display = "none";
  }
}
  function persist() {
    Sset(STORAGE.cfg, cfg);
    Sset(STORAGE.session, session);
    Sset(STORAGE.running, running);
    Sset(STORAGE.history, history);
  }

  function setSubtitle() {
    const el = $("subtitle");
    if (!el) return;
    el.textContent = (session.authed && session.user) ? `Käyttäjä: ${session.user}` : "";
    const btn = $("btnLogout");
    if (btn) btn.style.display = session.authed ? "inline-block" : "none";
  }

  function updateUnsentCount() {
    const el = $("unsentCount");
    if (!el) return;
    const n = history.filter(h => h.user === session.user && h.approved && h.sent !== true).length;
    el.textContent = n ? `Jonossa: ${n}` : "";
  }

  function setPerDiemUI(val) {
    const buttons = document.querySelectorAll("#perDiemSeg .segbtn");
    buttons.forEach(b => b.classList.toggle("active", String(val) === String(b.dataset.perdiem)));
  }

  function perDiemText(v){
    if (String(v) === "1") return "Puoli";
    if (String(v) === "2") return "Koko";
    return "Ei";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderHistory() {
    const list = $("historyList");
    const hint = $("historyHint");
    if (!list) return;

    const arr = history
      .filter(e => e.user === session.user)
      .sort((a,b) => Number(b.approvedTs || Date.parse(b.timestamp) || 0) - Number(a.approvedTs || Date.parse(a.timestamp) || 0));

    list.innerHTML = "";
    if (!arr.length) {
      list.innerHTML = `<div class="muted">Ei vielä merkintöjä.</div>`;
      if (hint) hint.textContent = "";
      return;
    }

    if (hint) hint.textContent = `${arr.length} kpl`;

    for (const e of arr) {
      const status = e.sent === true ? "ok" : "err";
      const statusChar = e.sent === true ? "✔" : "✖";
      const timeLine = `${e.startDate} ${e.startTime} → ${e.endDate} ${e.endTime}`;
      const plateTxt = e.plate ? `Auto: ${e.plate} | ` : "";
	const sub = `${plateTxt}
Työaika: ${minutesToText(e.totalMin)} | 
Päivä: ${minutesToText(e.dayMin)} | 
Ilta: ${minutesToText(e.eveMin)} | 
Yö: ${minutesToText(e.nightMin)} | 
Tauko: ${e.breakTotalMin} min (vähennys ${e.breakDeductMin} min) | 
Päiväraha: ${perDiemText(e.perDiem)}`;

      const div = document.createElement("div");
      div.className = "hist lock";
      div.innerHTML = `
        <div class="status ${status}" title="${escapeHtml(e.sent === true ? "Lähetetty" : (e.sentErr || "Ei lähetetty"))}">${statusChar}</div>
        <div class="meta">
          <div class="time"><b>${escapeHtml(e.user)}</b> — ${minutesToText(e.totalMin)}</div>
          <div class="sub">${escapeHtml(timeLine)}</div>
          <div class="sub">${escapeHtml(sub)}</div>
        </div>
      `;
      list.appendChild(div);
    }
  }

  function renderLive() {
    const now = Date.now();

    // totals from history
    const histTotal = history
      .filter(e => e.user === session.user)
      .reduce((sum, e) => sum + (e.totalMin || 0), 0);

    let todayMin = 0;
    let breakMin = 0;
    let deductMin = 0;

    if (running && running.startTs) {
      const endTs = now;
      const rawSeg = splitPIY(running.startTs, endTs);
      const breakTotalMin = sumBreakMinutes(running.breakSegments || [], endTs);
      const deduct = computeDeduct(breakTotalMin);
      const alloc = allocateDeduct(rawSeg, deduct);
      const adjSeg = {
        day: Math.max(0, rawSeg.day - alloc.dDay),
        eve: Math.max(0, rawSeg.eve - alloc.dEve),
        night: Math.max(0, rawSeg.night - alloc.dNight),
      };
      todayMin = adjSeg.day + adjSeg.eve + adjSeg.night;
      breakMin = breakTotalMin;
      deductMin = deduct;
    }

    $("liveToday").textContent = minutesToText(todayMin);
    $("liveAll").textContent = minutesToText(histTotal + todayMin);
    $("liveBreak").textContent = String(breakMin);
    $("liveDeduct").textContent = String(deductMin);

    // button states + user lock
    const btnStart = $("btnStart");
    const btnBreak = $("btnBreak");
    const btnStop = $("btnStop");

    if (!btnStart || !btnBreak || !btnStop) return;

    const hasRunning = !!running;
    const runningBelongsToUser = !hasRunning || (running.user === session.user);

    // default states
    btnStart.disabled = hasRunning;
    btnStop.disabled = !hasRunning;
    btnBreak.disabled = !hasRunning;

    if (!hasRunning) {
      btnBreak.textContent = "TAUKO";
    } else {
      btnBreak.textContent = (running.state === "break") ? "JATKA" : "TAUKO";
    }

    // lock if different user
    if (hasRunning && !runningBelongsToUser) {
      btnStart.disabled = true;
      btnBreak.disabled = true;
      btnStop.disabled = true;
      // (Ei lisätä uutta elementtiä HTML:ään — pidetään yksinkertaisena)
    }

    setPerDiemUI(hasRunning ? running.perDiem : 0);
  }

  function renderAll({ full } = { full: false }) {
    setSubtitle();
    updateUnsentCount();
    renderLive();
    if (full) renderHistory();
	renderForeignRunningLock();
  }

  // ---------- AUTH FLOW ----------
  function goLogin() {
    session = { user: "", authed: false, cardToken: "" };
    persist();
    setSubtitle();
    showView("viewLogin");
  }

  function goPin(user) {
    session.user = user;
    session.authed = false;
    session.cardToken = "";
    persist();
    $("pinUser").textContent = user;
    $("pinInput").value = "";
    $("pinNote").textContent = "";
    showView("viewPin");
    setSubtitle();
    setTimeout(() => $("pinInput").focus(), 50);
  }

  async function goWork() {
  if (!session || !session.user) return;
  if (!session.expiresAt || Date.now() >= Number(session.expiresAt)) {
    goLogin();
    toast("Istunto vanheni. Kirjaudu uudelleen.");
    return;
  }
  showView("viewWork");
  renderPlates();
  renderAll({ full: true });
  await refreshHistoryFromSheets();
  if (navigator.onLine) {
    await syncUnsent({ silent: true });
    await refreshHistoryFromSheets();
  }
}

  function setCardStatus(kind, title, detail) {
    const box = $("cardStatus");
    if (!box) return;
    box.className = `card-status card-status-${kind}`;
    $("cardStatusTitle").textContent = title;
    $("cardStatusDetail").textContent = detail;
  }
  function renderCardStatus(s) {
    const detail = `Voimassa ${s.valid || 0} · Vanhenee pian ${s.warning || 0} · Vanhentunut ${s.expired || 0}`;
    if ((s.expired || 0) > 0) setCardStatus("expired", `Vanhentuneita: ${s.expired}`, detail);
    else if ((s.warning || 0) > 0) setCardStatus("warning", `Vanhenee pian: ${s.warning}`, detail);
    else setCardStatus("valid", "Kortit kunnossa", detail);
  }
  async function cardsApi(action, data = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(HARD_CARDS_API_URL, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, ...data }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Korttipalvelu ei vastaa");
    return result;
  }
  async function refreshCardStatus() {
    if (!session?.authed || !session.user || !session.cardToken) return;
    setCardStatus("loading", "Tarkistetaan korttien tilaa…", "Odota hetki");
    try {
      const data = await Promise.race([
        cardsApi("workStatus", { token: session.cardToken }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Aikakatkaisu")), 8000))
      ]);
      if (!data.status) throw new Error("Korttitilaa ei saatu");
      renderCardStatus(data.status);
    } catch (_) {
      setCardStatus("error", "Korttien tilaa ei voitu tarkistaa", "Työaika toimii normaalisti");
    }
  }

  function goSettings() {
    showView("viewSettings");
    $("sheetsUrl").value = HARD_SHEETS_URL;
    $("sheetsUrl").disabled = true;
    $("fuelUrl").value = cfg.fuelUrl || "";
    $("settingsNote").textContent = "";
    updateUnsentCount();
  }

  // ---------- WORK ACTIONS ----------
  async function startWork() {
    if (!session.authed || !session.user || !session.expiresAt || Date.now() >= Number(session.expiresAt)) {
      goLogin();
      return toast("Istunto vanheni. Kirjaudu uudelleen.");
    }
    if (running) return toast("Työ on jo käynnissä.");
    const plate = getSelectedPlate();
    if (!plate) return toast("Valitse rekisterinumero ennen työn aloittamista.");

    const ok = await confirmModal("Aloitetaanko työ nyt?", "ALOITA");
    if (!ok) return;

    const now = Date.now();
    running = {
      id: `run_${now}_${Math.random().toString(16).slice(2)}`,
      user: session.user,
      startTs: now,
      breakSegments: [],
      perDiem: 0,
      state: "running",
      plate,
    };
    persist();
    toast("Työ aloitettu.");
    renderAll({ full: true });
  }

  async function toggleBreak() {
    if (!running) return;
    if (running.user !== session.user) return toast(`Käynnissä oleva työ kuuluu käyttäjälle ${running.user}.`);

    const label = (running.state === "break") ? "JATKA" : "TAUKO";
    const ok = await confirmModal(`${label} nyt?`, label);
    if (!ok) return;

    const now = Date.now();
    if (running.state === "running") {
      running.state = "break";
      running.breakSegments.push({ s: now });
      persist();
      toast("Tauko alkoi.");
    } else {
      running.state = "running";
      const last = running.breakSegments[running.breakSegments.length - 1];
      if (last && last.s && !last.e) last.e = now;
      persist();
      toast("Tauko päättyi.");
    }
    renderAll({ full: false });
  }

  function setPerDiem(val) {
    val = clampInt(val, 0, 2);
    if (running) {
      if (running.user !== session.user) return toast(`Käynnissä oleva työ kuuluu käyttäjälle ${running.user}.`);
      running.perDiem = val;
      persist();
      renderAll({ full: false });
    } else {
      toast("Päiväraha valitaan työpäivälle (aloita työ ensin) tai manuaalisessa lisäyksessä.");
    }
  }

  // ---------- SUMMARY MODAL (STOP / APPROVE) ----------
  let pendingSummary = null;

  function openSummaryFromRunningStop() {
    if (!running) return;
    if (running.user !== session.user) return toast(`Käynnissä oleva työ kuuluu käyttäjälle ${running.user}.`);

    const now = Date.now();

    if (running.state === "break") {
      const last = running.breakSegments[running.breakSegments.length - 1];
      if (last && last.s && !last.e) last.e = now;
      running.state = "running";
    }

    const startTs = running.startTs;
    const endTs = now;
    const breakTotalMin = sumBreakMinutes(running.breakSegments || [], endTs);

    pendingSummary = {
      mode: "stop",
      user: running.user,
      baseDateTs: startTs,
      startTs,
      endTs,
      breakTotalMin,
      perDiem: running.perDiem || 0,
      plate: running.plate || getSelectedPlate(),
    };

    fillSummaryUI();
    showModal("modalSummary", true);
  }

  function fillSummaryUI() {
    if (!pendingSummary) return;

    $("sumUser").value = pendingSummary.user;
    $("sumStartDate").value = toLocalDateStr(pendingSummary.startTs);
    $("sumEndDate").value = toLocalDateStr(pendingSummary.endTs);
    $("sumStartTime").value = toLocalTimeStr(pendingSummary.startTs);
    $("sumEndTime").value = toLocalTimeStr(pendingSummary.endTs);

    $("sumBreakTotal").value = String(Math.max(0, Math.round(pendingSummary.breakTotalMin)));
    $("sumPerDiem").value = String(pendingSummary.perDiem);

    $("sumSub").textContent = pendingSummary.mode === "stop" ? "Tarkista ja hyväksy" : "Manuaalinen päivä – tarkista ja hyväksy";

    recalcSummaryPanel();
  }

  function recalcSummaryPanel() {
    if (!pendingSummary) return;

    const startTime = ($("sumStartTime").value || "00:00");
    const endTime = ($("sumEndTime").value || "00:00");
    const startTs = dateTimeToTs($("sumStartDate").value, startTime);
    const endTs = dateTimeToTs($("sumEndDate").value, endTime);
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
      $("sumSub").textContent = "Loppuajan täytyy olla alkamisajan jälkeen.";
      return;
    }
    $("sumSub").textContent = pendingSummary.mode === "stop" ? "Tarkista ja hyväksy" : "Manuaalinen päivä – tarkista ja hyväksy";

    const breakTotalMin = clampInt($("sumBreakTotal").value, 0, 24*60);

    const rawSeg = splitPIY(startTs, endTs);
    const deductMin = computeDeduct(breakTotalMin);
    const alloc = allocateDeduct(rawSeg, deductMin);
    const adjSeg = {
      day: Math.max(0, rawSeg.day - alloc.dDay),
      eve: Math.max(0, rawSeg.eve - alloc.dEve),
      night: Math.max(0, rawSeg.night - alloc.dNight),
    };
    const totalMin = adjSeg.day + adjSeg.eve + adjSeg.night;

    $("sumDeduct").textContent = String(deductMin);
    $("sumTotal").textContent = minutesToText(totalMin);
    $("sumDay").textContent = minutesToText(adjSeg.day);
    $("sumEve").textContent = minutesToText(adjSeg.eve);
    $("sumNight").textContent = minutesToText(adjSeg.night);
  }

  function closeSummary() {
    pendingSummary = null;
    showModal("modalSummary", false);
  }

  async function approveSummary() {
    if (!pendingSummary) return;

    const startTime = ($("sumStartTime").value || "00:00");
    const endTime = ($("sumEndTime").value || "00:00");
    const breakTotalMin = clampInt($("sumBreakTotal").value, 0, 24*60);
    const perDiem = clampInt($("sumPerDiem").value, 0, 2);

    const startTs = dateTimeToTs($("sumStartDate").value, startTime);
    const endTs = dateTimeToTs($("sumEndDate").value, endTime);
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
      return toast("Tarkista alkamis- ja loppumispäivä sekä kellonajat.");
    }
    if (endTs - startTs > 7 * 24 * 60 * 60 * 1000) {
      return toast("Yksi työjakso voi olla enintään 7 vuorokautta.");
    }

    const rawSeg = splitPIY(startTs, endTs);
    const deductMin = computeDeduct(breakTotalMin);
    const alloc = allocateDeduct(rawSeg, deductMin);
    const adjSeg = {
      day: Math.max(0, rawSeg.day - alloc.dDay),
      eve: Math.max(0, rawSeg.eve - alloc.dEve),
      night: Math.max(0, rawSeg.night - alloc.dNight),
    };
    const totalMin = adjSeg.day + adjSeg.eve + adjSeg.night;

    const entry = {
      id: `day_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      user: pendingSummary.user,
      startTs,
      endTs,
      startDate: toLocalDateStr(startTs),
      startTime: startTime,
      endDate: toLocalDateStr(endTs),
      endTime: toLocalTimeStr(endTs),
      breakTotalMin,
      breakDeductMin: deductMin,
      dayMin: adjSeg.day,
      eveMin: adjSeg.eve,
      nightMin: adjSeg.night,
      totalMin,
      perDiem,
      approved: true,
      approvedTs: Date.now(),
      sent: false,
      plate: pendingSummary.plate || getSelectedPlate(),
      sentAt: null,
      sentErr: "",
    };

    history.push(entry);

    if (pendingSummary.mode === "stop") {
      running = null;
    }

    persist();
    closeSummary();
    toast("Tallennettu. Lähetetään Sheetiin...");

    await trySendEntryToSheets(entry);
    toast(entry.sent ? "Sheets: OK ✔" : "Sheets: epäonnistui ✖");
  }

  // ---------- MANUAL DAY ----------
  function openManual() {
    if (!session.authed || !session.user) return toast("Kirjaudu sisään.");
    const plate = getSelectedPlate();
    if (!plate) return toast("Valitse rekisterinumero ennen manuaalisen päivän lisäämistä.");

    const d = new Date();
    $("manDate").value = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    $("manStart").value = "08:00";
    $("manEnd").value = "16:00";
    $("manBreak").value = "0";
    $("manPerDiem").value = "0";
    showModal("modalManual", true);
  }

  function closeManual() {
    showModal("modalManual", false);
  }

  function manualToSummary() {
    const dateStr = ($("manDate").value || "").trim();
    if (!dateStr) return toast("Valitse päivämäärä.");

    const startTime = $("manStart").value || "00:00";
    const endTime = $("manEnd").value || "00:00";
    const breakTotalMin = clampInt($("manBreak").value, 0, 24*60);
    const perDiem = clampInt($("manPerDiem").value, 0, 2);

    const [Y,M,D] = dateStr.split("-").map(Number);
    const base = new Date(Y, (M||1)-1, D||1, 0,0,0,0);
    const baseDayTs = base.getTime();

    let startTs = parseTimeToTsSameDay(baseDayTs, startTime);
    let endTs = parseTimeToTsSameDay(baseDayTs, endTime);
    endTs = ensureEndAfterStart(startTs, endTs);

    pendingSummary = {
      mode: "manual",
      user: session.user,
      baseDateTs: baseDayTs,
      startTs,
      endTs,
      breakTotalMin,
      perDiem,
      plate: getSelectedPlate(),
    };

    closeManual();
    fillSummaryUI();
    showModal("modalSummary", true);
  }

  // ---------- EVENTS ----------
function bindEvents() {

  // User buttons
  document.querySelectorAll(".btn-user").forEach((b) => {
    b.addEventListener("click", () => {
      const user = b.dataset.user;
      if (!USERS.includes(user)) return;
      goPin(user);
    });
  });

  //	Clear foreign running (if another user has an active day)
  document.getElementById("btnClearForeignRunning")?.addEventListener("click", async () => {
    if (!running) return;

    const ok = await confirmModal(
      `Poistetaanko käynnissä oleva työ?\n\nKäyttäjä: ${running.user}\nAloitettu: ${new Date(running.startTs).toLocaleString()}`,
      "POISTA"
    );
    if (!ok) return;

    running = null;
    localStorage.removeItem(STORAGE.running);
    persist();
    toast("Käynnissä oleva työ poistettu.");
    renderAll({ full: true });
  });

    // PIN
    $("btnPinBack")?.addEventListener("click", () => showView("viewLogin"));
    $("btnPinOk")?.addEventListener("click", async () => {
      const pin = ($("pinInput").value || "").trim();
      if (!pin) return;
      $("btnPinOk").disabled = true;
      try {
        const result = await cardsApi("workLogin", { user: session.user, pin });
        session.authed = true;
        session.cardToken = result.token;
        session.expiresAt = Date.now() + 18 * 60 * 60 * 1000;
        persist();
        $("pinNote").textContent = "";
        toast("OK");
        if (result.status) renderCardStatus(result.status);
        goWork();
      } catch (error) {
        session.authed = false;
        session.cardToken = "";
        $("pinNote").textContent = error.message || "Väärä PIN.";
        toast("Kirjautuminen epäonnistui");
      } finally { $("btnPinOk").disabled = false; }
      setSubtitle();
    });
    $("pinInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("btnPinOk")?.click();
    });

    // (Menu on yhä HTML:ssä, mutta voidaan pitää varalla)
    $("btnGoWork")?.addEventListener("click", goWork);
    $("btnGoSettings")?.addEventListener("click", goSettings);
    $("btnSwitchUser")?.addEventListener("click", goLogin);

    // Tankkaus: jos myöhemmin lisäät Work-näkymään nappiin id="btnFuel", tämä tukee sitä.
    const fuelHandler = async () => {
      const url = (HARD_FUEL_URL || (cfg.fuelUrl || "")).trim();
      if (!url) return toast("Fuel-URL puuttuu (Asetuksissa).");
      const ok = await confirmModal("Avataanko Tankkaus?", "TANKKAUS");
      if (!ok) return;
      window.location.href = url;
    };
    $("btnGoFuel")?.addEventListener("click", fuelHandler);

    // Logout
    $("btnLogout")?.addEventListener("click", goLogin);

    // Work actions
	// Plates: täytä lista kerran kun eventit bindataan
renderPlates();

// Kun valinta vaihtuu, päivitä käynnissä olevalle päivälle
$("plateSelect")?.addEventListener("change", () => {
  cfg.lastPlate = getSelectedPlate();
  if (running && running.user === session.user) running.plate = getSelectedPlate();
  persist();
});

// Lisää uusi rekisteri
$("btnAddPlate")?.addEventListener("click", () => {
  const raw = prompt("Uusi rekisterinumero (esim ABC-123):");
  const p = normalizePlate(raw);
  if (!p) return;

  if (!cfg.plates) cfg.plates = [];
  if (!cfg.plates.includes(p)) cfg.plates.push(p);

  cfg.plates.sort();
  persist();
  renderPlates();

  // valitse heti lisätty
  const sel = $("plateSelect");
  if (sel) sel.value = p;
  cfg.lastPlate = p;

  // jos työ käynnissä, päivitä siihenkin
  if (running && running.user === session.user) {
    running.plate = p;
    persist();
  }

  toast("Rekisterinumero lisätty.");
});
    $("btnBackMenu")?.addEventListener("click", goSettings); // menu pois -> mennään asetuksiin
    $("btnStart")?.addEventListener("click", startWork);
    $("btnBreak")?.addEventListener("click", toggleBreak);
    $("btnStop")?.addEventListener("click", async () => {
      if (!running) return;
      if (running.user !== session.user) return toast(`Käynnissä oleva työ kuuluu käyttäjälle ${running.user}.`);
      const ok = await confirmModal("Lopetetaanko työ ja avataan koonti?", "LOPETA");
      if (!ok) return;
      openSummaryFromRunningStop();
    });

    // Per diem segment
    document.querySelectorAll("#perDiemSeg .segbtn").forEach((b) => {
      b.addEventListener("click", () => setPerDiem(b.dataset.perdiem));
    });

    // Manual
    $("btnManualDay")?.addEventListener("click", openManual);
    $("manCancel")?.addEventListener("click", closeManual);
    $("manClose")?.addEventListener("click", closeManual);
    $("manNext")?.addEventListener("click", manualToSummary);

    // Summary modal
    $("sumClose")?.addEventListener("click", closeSummary);
    $("sumCancel")?.addEventListener("click", closeSummary);
    $("sumApprove")?.addEventListener("click", approveSummary);
    ["sumStartDate","sumEndDate","sumStartTime","sumEndTime","sumBreakTotal","sumPerDiem"].forEach(id => {
      $(id)?.addEventListener("input", recalcSummaryPanel);
      $(id)?.addEventListener("change", recalcSummaryPanel);
    });

    // Settings
    $("btnBackMenu2")?.addEventListener("click", goWork);
    $("btnSaveSettings")?.addEventListener("click", () => {
      cfg.sheetsUrl = HARD_SHEETS_URL;
      cfg.fuelUrl = ($("fuelUrl").value || "").trim();
      persist();
      $("settingsNote").textContent = "Tallennettu.";
      toast("Tallennettu");
      updateUnsentCount();
    });
    $("btnTestSheets")?.addEventListener("click", testSheets);
    $("btnSyncUnsent")?.addEventListener("click", syncUnsent);
  }

  // ---------- INIT ----------
  function init() {
    if (!Array.isArray(history)) history = [];
    if (running && !Array.isArray(running.breakSegments)) running.breakSegments = [];

    bindEvents();
    setSubtitle();

    // Boot route: jos authed, suoraan workiin (ei menu)
    if (session && session.authed && session.user && session.cardToken && Number(session.expiresAt) > Date.now()) {
      goWork();
    } else {
      session = { user: "", authed: false, cardToken: "" };
      persist();
      showView("viewLogin");
    }

    renderAll({ full: true });

    // Live timer (kevyt)
    setInterval(() => renderAll({ full: false }), 1000);
    setInterval(() => {
      if (session?.authed && (!session.expiresAt || Date.now() >= Number(session.expiresAt))) {
        goLogin();
        toast("18 tunnin istunto päättyi.");
      }
    }, 60000);
  }

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE.running) {
      running = Sget(STORAGE.running, null);
      renderPlates();
      renderAll({ full: false });
    }
    if (event.key === STORAGE.history) {
      history = Sget(STORAGE.history, []);
      renderAll({ full: true });
    }
  });

  window.addEventListener("online", async () => {
    if (!session?.authed) return;
    await refreshHistoryFromSheets();
    await syncUnsent({ silent: true });
    await refreshHistoryFromSheets();
    toast("Verkkoyhteys palautui.");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js?v=26").catch(error => console.error("Offline-tuki ei käynnistynyt", error));
    });
  }

  init();

  $("cardStatus")?.addEventListener("click", () => { window.location.href = HARD_CARDS_URL + "#workToken=" + encodeURIComponent(session.cardToken || ""); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshCardStatus(); });
  setInterval(refreshCardStatus, 5 * 60 * 1000);

  $("btnFuel")?.addEventListener("click", async () => {
    const ok = await confirmModal("Avataanko Tankkaus?", "TANKKAUS");
    if (ok) window.location.href = HARD_FUEL_URL;
  });

  $("btnCards")?.addEventListener("click", () => {
    window.location.href = HARD_CARDS_URL + "#workToken=" + encodeURIComponent(session.cardToken || "");
  });
})();