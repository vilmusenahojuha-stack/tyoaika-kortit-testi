const CARDS_API_URL_ = "https://script.google.com/macros/s/AKfycbws1ods-A_0YnJ04cWHU8D5bTdGVg8Z36qA6lsuyEUHYuDlneG_KkOd32ZP8tK1-4Vc/exec";

/**
 * Työaikaseuranta Apps Script (DATA-yksi välilehti)
 * Tukee: ping, append, list (user)
 * Sarakkeet ovat yhteensopivat app.js:n kanssa (sisältää plate).
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    // Pingi ei lue eikä kirjoita tietoja.
    if (body.action === "ping") return ok_({ ok: true });

    const authenticatedUser = verifyWorkTokenWithCards_(body.workToken);
    const requestedUser = String(body.user || "").trim();
    const firstRowUser = (body.rows && body.rows[0] && body.rows[0].user) ? String(body.rows[0].user).trim() : "";
    const sheetName = (requestedUser || firstRowUser || authenticatedUser).trim();
    if (sheetName !== authenticatedUser) throw new Error("Istunto ei vastaa käyttäjää.");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    // Canonical headers (hours in decimals)
    const HEADERS = [
      "user",
      "plate",
      "startDate",
      "startTime",
      "endDate",
      "endTime",
      "breakTotalMin",
      "breakDeductMin",
      "dayH",
      "eveH",
      "nightH",
      "totalH",
      "perDiem",
      "approved",
      "timestamp",
      "id"
    ];

    ensureHeadersAndMaybeUpgrade_(sheet, HEADERS);

    // ---------- APPEND ----------
    if (body.action === "append" && Array.isArray(body.rows)) {
      if (!body.rows.length) return ok_({ ok: true, added: 0 });
      body.rows.forEach(r => {
        if (String(r.user || authenticatedUser).trim() !== authenticatedUser) throw new Error("Rivin käyttäjä ei vastaa istuntoa.");
        validateWorkRow_(r);
      });

      const lock = LockService.getScriptLock();
      lock.waitLock(15000);
      try {
        const idColumn = HEADERS.indexOf("id") + 1;
        const existingIds = new Set(
          sheet.getLastRow() < 2 ? [] :
          sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getValues().flat().map(String).filter(Boolean)
        );
        const inputIds = new Set();
        const newRows = body.rows.filter(r => {
          const id = String(r.id || "").trim();
          if (!id) throw new Error("Rivin yksilöllinen tunnus puuttuu.");
          if (existingIds.has(id) || inputIds.has(id)) return false;
          inputIds.add(id);
          return true;
        });

        const rows = newRows.map(r => {
        const dayH   = num_(r.dayH,   num_(r.dayMin,   0) / 60);
        const eveH   = num_(r.eveH,   num_(r.eveMin,   0) / 60);
        const nightH = num_(r.nightH, num_(r.nightMin, 0) / 60);
        const totalH = num_(r.totalH, num_(r.totalMin, 0) / 60);

        return [
          r.user || sheetName,
          r.plate || "",
          r.startDate || "",
          r.startTime || "",
          r.endDate || "",
          r.endTime || "",
          num_(r.breakTotalMin, 0),
          num_(r.breakDeductMin, 0),
          dayH,
          eveH,
          nightH,
          totalH,
          num_(r.perDiem, 0),
          r.approved === true,
          r.timestamp || new Date().toISOString(),
          String(r.id || "").trim()
        ];
      });

        if (rows.length) {
          sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
          formatHours_(sheet);
        }
        return ok_({ ok: true, added: rows.length, duplicates: body.rows.length - rows.length });
      } finally {
        try { lock.releaseLock(); } catch (_) {}
      }
    }

    // ---------- LIST ----------
    if (body.action === "list") {
      const values = sheet.getDataRange().getValues();
      if (!values || values.length < 2) return ok_({ ok: true, rows: [] });

      // Header-based indexing (robust to column drift)
      const idx = headerIndex_(values[0]);
      const out = [];

      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        if (row.join("").trim() === "") continue;

        const dayH   = getNum_(row, idx, "dayH");
        const eveH   = getNum_(row, idx, "eveH");
        const nightH = getNum_(row, idx, "nightH");
        const totalH = getNum_(row, idx, "totalH");

        out.push({
          user: getStr_(row, idx, "user"),
          plate: getStr_(row, idx, "plate"),
          startDate: getStr_(row, idx, "startDate"),
          startTime: getStr_(row, idx, "startTime"),
          endDate: getStr_(row, idx, "endDate"),
          endTime: getStr_(row, idx, "endTime"),
          breakTotalMin: getNum_(row, idx, "breakTotalMin"),
          breakDeductMin: getNum_(row, idx, "breakDeductMin"),
          dayH: dayH,
          eveH: eveH,
          nightH: nightH,
          totalH: totalH,
          // Backward-compatible mins (if client expects mins)
          dayMin: Math.round(dayH * 60),
          eveMin: Math.round(eveH * 60),
          nightMin: Math.round(nightH * 60),
          totalMin: Math.round(totalH * 60),
          perDiem: getNum_(row, idx, "perDiem"),
          approved: getBool_(row, idx, "approved"),
          timestamp: getStr_(row, idx, "timestamp"),
          id: getStr_(row, idx, "id")
        });
      }

      return ok_({ ok: true, rows: out });
    }

    return ok_({ ok: false, error: "Virheellinen pyyntö" });

  } catch (err) {
    return ok_({ ok: false, error: String(err) });
  }
}

function authorizeCardConnection() {
  const response = UrlFetchApp.fetch(CARDS_API_URL_, {
    method: "get",
    muteHttpExceptions: true
  });
  Logger.log("Korttipalveluyhteys: HTTP " + response.getResponseCode());
  return "Valtuutus valmis";
}

function verifyWorkTokenWithCards_(token) {
  const value = String(token || "").trim();
  if (!value) throw new Error("Työaikaistunto puuttuu.");
  const response = UrlFetchApp.fetch(CARDS_API_URL_, {
    method: "post",
    contentType: "text/plain; charset=utf-8",
    payload: JSON.stringify({ action: "workStatus", token: value }),
    muteHttpExceptions: true
  });
  let data;
  try { data = JSON.parse(response.getContentText()); }
  catch (_) { throw new Error("Istunnon tarkistus epäonnistui."); }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !data || data.ok !== true || !data.user) {
    throw new Error((data && data.error) ? String(data.error) : "Työaikaistunto ei kelpaa.");
  }
  return String(data.user).trim();
}

function validateWorkRow_(r) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.startDate || ""))) throw new Error("Aloituspäivä ei kelpaa.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.endDate || ""))) throw new Error("Loppupäivä ei kelpaa.");
  if (!/^\d{2}:\d{2}$/.test(String(r.startTime || ""))) throw new Error("Aloitusaika ei kelpaa.");
  if (!/^\d{2}:\d{2}$/.test(String(r.endTime || ""))) throw new Error("Lopetusaika ei kelpaa.");
  const totalH = num_(r.totalH, num_(r.totalMin, 0) / 60);
  if (totalH < 0 || totalH > 168) throw new Error("Työajan määrä ei kelpaa.");
  const perDiem = num_(r.perDiem, 0);
  if ([0, 1, 2].indexOf(perDiem) < 0) throw new Error("Päiväraha ei kelpaa.");
  if (String(r.plate || "").length > 20) throw new Error("Rekisterinumero ei kelpaa.");
}

function ensureHeadersAndMaybeUpgrade_(sheet, HEADERS){
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(HEADERS);
    formatHours_(sheet);
    return;
  }

  const hdr = sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const hdrStr = hdr.map(h => String(h||"").trim());

  // If already matches (at least starts with our headers), do nothing
  const startsOk = HEADERS.every((h, i) => (hdrStr[i] || "") === h);
  if (startsOk) { formatHours_(sheet); return; }

  // Nykyinen desimaalimuoto ilman id-saraketta: lisää id viimeiseksi.
  const headersWithoutId = HEADERS.slice(0, -1);
  const matchesWithoutId = headersWithoutId.every((h, i) => (hdrStr[i] || "") === h);
  if (matchesWithoutId) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    formatHours_(sheet);
    return;
  }

  // Upgrade path: old minute headers with same structure (user,plate,...,dayMin,eveMin,nightMin,totalMin,...)
  const oldMin = [
    "user","plate","startDate","startTime","endDate","endTime",
    "breakTotalMin","breakDeductMin","dayMin","eveMin","nightMin","totalMin",
    "perDiem","approved","timestamp"
  ];
  const matchesOld = oldMin.every((h, i) => (hdrStr[i] || "") === h);

  if (matchesOld) {
    // Rename headers to H and convert existing numeric columns in-place (cols 9-12)
    sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);

    const lr = sheet.getLastRow();
    if (lr >= 2) {
      const rng = sheet.getRange(2, 9, lr-1, 4); // day/eve/night/total columns
      const vals = rng.getValues().map(r => r.map(v => {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return n / 60;
      }));
      rng.setValues(vals);
      formatHours_(sheet);
    }
    return;
  }

  // Fallback: force our header row, keep existing data as-is (best effort)
  // This prevents "only start/end visible" cases from breaking list mapping forever.
  sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  formatHours_(sheet);
}

function formatHours_(sheet){
  const lr = sheet.getLastRow();
  if (lr < 2) return;
  // dayH..totalH are columns 9..12
  sheet.getRange(2, 9, lr-1, 4).setNumberFormat("0.00");
}

function headerIndex_(hdrRow){
  const idx = {};
  for (let i=0;i<hdrRow.length;i++){
    const k = String(hdrRow[i]||"").trim();
    if (k) idx[k]=i;
  }
  return idx;
}
function getStr_(row, idx, key){
  const i = idx[key];
  if (i == null) return "";
  return String(row[i] || "");
}
function getNum_(row, idx, key){
  const i = idx[key];
  if (i == null) return 0;
  const n = Number(row[i]);
  return Number.isFinite(n) ? n : 0;
}
function getBool_(row, idx, key){
  const i = idx[key];
  if (i == null) return false;
  return row[i] === true;
}
function num_(v, fallback){
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const f = Number(fallback);
  return Number.isFinite(f) ? f : 0;
}

function ok_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
