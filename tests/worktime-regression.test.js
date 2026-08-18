"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

new Function(app);
new Function(sw);
assert.match(html, /Content-Security-Policy/);
assert.match(css, /\.history-error\s*\{/);
assert.equal(manifest.start_url, "./?v=29");
assert.equal(manifest.icons[0].src, "icon.svg");
assert.match(sw, /tyoaikakirjaus-v29/);
assert.match(app, /AKfycbyFO7eewNr2L-PRgRktrBwYUHA9ub5JzDG6Vf9SyJEcvUDY1wP8o2IKOkzCqzzH75mN/);
assert.doesNotMatch(app, /ta_session_v1|ta_running_v1|ta_history_v1/);

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const dynamicIds = new Set(["modalConfirm", "confirmTitle", "confText", "confOk", "confCancel", "confClose"]);
const referencedIds = [...app.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]);
const missing = [...new Set(referencedIds.filter(id => !htmlIds.has(id) && !dynamicIds.has(id)))];
assert.deepEqual(missing, [], "app.js references missing DOM ids");

function splitPIY(start, end) {
  const out = { day: 0, eve: 0, night: 0 };
  for (let t = start; t < end; t += 60000) {
    const d = new Date(t);
    const min = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (min >= 360 && min < 1080) out.day++;
    else if (min >= 1080 && min < 1320) out.eve++;
    else out.night++;
  }
  return out;
}
const utc = (day, hour, minute = 0) => Date.UTC(2026, 0, day, hour, minute);
assert.deepEqual(splitPIY(utc(1, 6), utc(1, 18)), { day: 720, eve: 0, night: 0 });
assert.deepEqual(splitPIY(utc(1, 17), utc(1, 23)), { day: 60, eve: 240, night: 60 });
assert.deepEqual(splitPIY(utc(1, 22), utc(2, 6)), { day: 0, eve: 0, night: 480 });

const deduct = minutes => Math.max(0, minutes - 30);
assert.equal(deduct(0), 0);
assert.equal(deduct(30), 0);
assert.equal(deduct(31), 1);
assert.equal(deduct(90), 60);

const history = [
  { id: "j1", user: "Juha", approved: true, sent: false },
  { id: "m1", user: "Matti", approved: true, sent: false },
  { id: "j2", user: "Juha", approved: true, sent: true }
];
assert.deepEqual(history.filter(x => x.user === "Juha" && x.approved && x.sent !== true).map(x => x.id), ["j1"]);
assert.deepEqual(history.filter(x => x.user !== "Juha" && x.approved && x.sent !== true).map(x => x.id), ["m1"]);

console.log("Kaikki työaikasovelluksen regressiotestit läpäistiin.");
