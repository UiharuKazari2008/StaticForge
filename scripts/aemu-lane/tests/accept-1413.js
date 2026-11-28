#!/usr/bin/env node
'use strict';
/*
 * StaticForge #1413 acceptance on one lane emulator (the caller holds its coord lease): the glass light on Today
 * (Melaton Mobile 6.5): it follows the lean, the rays differ in width, the idle drift settles and stops, and nothing
 * runs while Today is not what shows. Started by accept-1413.sh (that one owns the arguments and the restore trap).
 *
 *   node accept-1413.js <aemu-id> --out DIR [--install] [--only A,B,C,D,E] [--slide-pct 6] [--skew-deg 3] [--settle 3] [--expect-css STR]...
 *
 * Everything the device says goes to a file in DIR (JSON or txt); one PASS / FAIL / INFO line per check goes to stdout
 * and DIR/summary.txt. The page is only ever read with single evals (no timer, listener, CSS or JS is put into it); the
 * accelerometer, touch, screen and foreground program are driven from outside, as a person would.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const L = path.join(REPO, 'scripts/aemu-lane/lane.sh');
const CON = path.join(REPO, 'scripts/aemu-lane/lib/con.py');
const PKG = 'jp.net.seventhreeseven.dreamscape';
const sharp = require(path.join(REPO, 'node_modules/sharp'));

const argv = process.argv.slice(2);
const ID = argv[0];
if (!ID || ID.startsWith('--')) { console.error('usage: accept-1413.js <aemu-id> --out DIR [--install] [--only A,B]'); process.exit(2); }
let OUT = '';
let INSTALL = false;
let ONLY = null;
let SLIDE_PCT = 6;    // full lean (18 deg) slides the light this percent of the picture's width
let SKEW_DEG = 3;     // and tips its slant this many degrees
let SETTLE_S = 4;     // seconds to wait after each pose before a probe and a shot (the light follows through a slow low-pass)
const EXPECT_CSS = [];
let EXPECT_CSS_SET = false;
for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--out') OUT = argv[++i];
    else if (argv[i] === '--install') INSTALL = true;
    else if (argv[i] === '--slide-pct') SLIDE_PCT = Number(argv[++i]);
    else if (argv[i] === '--skew-deg') SKEW_DEG = Number(argv[++i]);
    else if (argv[i] === '--settle') SETTLE_S = Number(argv[++i]);
    else if (argv[i] === '--expect-css') { EXPECT_CSS.push(argv[++i]); EXPECT_CSS_SET = true; }
    else if (argv[i] === '--only') ONLY = new Set(String(argv[++i]).toUpperCase().split(',').filter(Boolean));
}
if (!OUT) { console.error('--out DIR is required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
if (INSTALL && !EXPECT_CSS_SET) EXPECT_CSS.push('is-drift', '110deg'); // the new build must be what runs after an install
const want = (s) => !ONLY || ONLY.has(s);

// ---------------------------------------------------------------- plumbing
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepUntil = async (ms) => { const d = ms - Date.now(); if (d > 0) await sleep(d); };
function run(cmd, args, timeout = 60000) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), err: String(stderr || '') });
        });
    });
}
const lane = (...a) => run(L, [ID, ...a]);
async function ev(js, timeout = 40000) {
    const r = await run(L, [ID, 'eval', js], timeout);
    let j = null;
    try { j = JSON.parse(r.out); } catch (_) { /* not JSON */ }
    if (!j || j.ok === false) return { ok: false, raw: (r.out + r.err).trim().slice(0, 400) };
    return { ok: true, value: j.value };
}
async function evJson(js) {
    const r = await ev(js);
    if (!r.ok) return { _error: r.raw };
    try { return JSON.parse(r.value); } catch (_) { return { _error: 'not JSON: ' + String(r.value).slice(0, 200) }; }
}
const sh = async (cmd) => (await lane('sh', cmd)).out;
let CONPORT = 0;
const con = (...a) => run('python3', [CON, String(CONPORT), ...a], 15000);
const HOLD = '0:6.937:6.937';
const DEFAULT_POSE = '0:9.77631:0.812349';
const poseFor = (deg) => {
    const g = (deg * Math.PI) / 180;
    return `${(6.937 * Math.sin(g)).toFixed(3)}:6.937:${(6.937 * Math.cos(g)).toFixed(3)}`;
};
const setPose = (acc) => con('sensor', 'set', 'acceleration', acc);
const touch = async () => {
    const t = Date.now();
    await sh('input motionevent DOWN 540 300; sleep 0.1; input motionevent CANCEL 540 300');
    return (t + Date.now()) / 2 - 50; // about the DOWN
};
const shot = async (file) => { // a capture that fails or leaves no file is tried again (up to 4 times)
    let r = null;
    for (let i = 0; i < 4; i++) {
        r = await lane('shot', path.resolve(OUT, file));
        try { if (fs.statSync(path.resolve(OUT, file)).size > 1000) return r; } catch (_) { /* no file */ }
        await sleep(1500);
    }
    throw new Error(`screenshot ${file} failed: ${(r.out + r.err).trim().slice(0, 200)}`);
};
const f = (name) => path.join(OUT, name);
const save = (name, obj) => fs.writeFileSync(f(name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1) + '\n');

const lines = [];
let nPass = 0; let nFail = 0; let nExpected = 0;
function say(s) { lines.push(s); console.log(s); fs.writeFileSync(f('summary.txt'), lines.join('\n') + '\n'); }
function verdict(ok, text, expectedBefore = false) {
    if (ok) { nPass++; say('PASS  ' + text); } else if (expectedBefore) { nExpected++; say('FAIL (expected before the fix)  ' + text); } else { nFail++; say('FAIL  ' + text); }
}
const info = (text) => say('INFO  ' + text);

// device clock: the page's Date.now() is the device's. skew = device - host.
const clock = { skew: 0, dayStart: 0 };
async function syncClock() {
    const a = Date.now();
    const o = (await sh("date '+%s%3N %H:%M:%S'")).trim().split(/\s+/);
    const b = Date.now();
    const devMs = Number(o[0]);
    const [h, m, s] = o[1].split(':').map(Number);
    clock.skew = devMs - (a + b) / 2;
    clock.dayStart = Math.floor(devMs / 1000) * 1000 - (h * 3600 + m * 60 + s) * 1000;
    return clock;
}
const devNow = () => Date.now() + clock.skew;
const devSec = () => Math.floor(((devNow() - clock.dayStart) / 1000) % 60) + (((devNow() - clock.dayStart) % 1000) / 1000);
const hostOfDev = (devMs) => devMs - clock.skew;
const hms = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`; };
async function waitSec(lo, hi) { // wait until the device clock's seconds are in [lo, hi]
    for (;;) {
        const s = devSec();
        if (s >= lo && s <= hi) return s;
        const need = s < lo ? lo - s : 60 - s + lo;
        await sleep(Math.min(need * 1000, 1000) + 20);
    }
}

// ---------------------------------------------------------------- the page
const PROBE = `(()=>{const q=(s)=>document.querySelector(s);const i=q(".wm-ti-shine > i"),sn=q(".wm-ti-shine");const cs=i?getComputedStyle(i):null;return JSON.stringify({ts:Date.now(),vis:document.visibilityState,app:document.documentElement.dataset.wmApp,scr:document.documentElement.dataset.screenOff===undefined?null:document.documentElement.dataset.screenOff,sx:i?i.style.getPropertyValue("--wm-ti-sx"):null,sk:i?i.style.getPropertyValue("--wm-ti-sk"):null,dr:i?i.style.getPropertyValue("--wm-ti-dr"):null,drift:sn?sn.classList.contains("is-drift"):null,tf:cs?cs.transform:null,tr:cs?cs.translate:null,anims:document.getAnimations().map(a=>(a.animationName||a.transitionProperty)+"@"+(a.effect&&a.effect.target&&a.effect.target.className)+":"+a.playState)})})()`;
async function probe() {
    const p = await evJson(PROBE);
    if (p._error) return p;
    p.running = (p.anims || []).filter((a) => a.endsWith(':running'));
    p.sxN = parseFloat(p.sx) || 0;
    p.skN = parseFloat(p.sk) || 0;
    p.drN = parseFloat(p.dr) || 0;
    p.trN = parseFloat(p.tr) || 0;
    const m = /^matrix\(([^)]*)\)$/.exec(p.tf || '');
    if (m) { const v = m[1].split(',').map(Number); p.mat = { a: v[0], b: v[1], c: v[2], d: v[3], e: v[4], f: v[5] }; }
    return p;
}
const brief = (p) => p._error ? `ERROR ${p._error}` : `app=${p.app} vis=${p.vis} scr=${p.scr} sx=${p.sx || '-'} sk=${p.sk || '-'} dr=${p.dr || '-'} drift=${p.drift} tr=${p.tr} e=${p.mat ? p.mat.e : '-'} c=${p.mat ? p.mat.c : '-'} running=[${(p.running || []).join('; ')}]`;
async function frames() {
    const o = await sh(`dumpsys gfxinfo ${PKG} | grep -m1 "Total frames rendered"`);
    const m = /Total frames rendered:\s*(\d+)/.exec(o);
    return m ? Number(m[1]) : null;
}
async function sensors() {
    const o = await sh('dumpsys sensorservice');
    const fm = /game fusion\(no mag\) (enabled|disabled) \((\d+) clients?\)/.exec(o);
    const regs = [];
    for (const line of o.split('\n')) {
        const m = /^\s*(\d\d):(\d\d):(\d\d)\s+([+-])\s+0x\w+\s+pid=\s*(\d+).*\(([^,()]+), org\.chromium\.device\.sensors\.PlatformSensor\)/.exec(line);
        if (!m) continue;
        const sod = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        regs.push({ t: `${m[1]}:${m[2]}:${m[3]}`, sod, sign: m[4], pid: Number(m[5]), sensor: m[6], devMs: clock.dayStart + sod * 1000 });
    }
    regs.reverse(); // the dump is newest first; here oldest first
    return { fusion: fm ? { state: fm[1], clients: Number(fm[2]), text: fm[0] } : null, regs, dumpAt: devNow() };
}
const fusionText = (s) => (s.fusion ? s.fusion.text : 'fusion line missing');
const regsSince = (s, devMs) => s.regs.filter((r) => r.devMs >= devMs - 999); // chronological
const regStr = (rs) => rs.map((r) => `${r.t} ${r.sign}`).join(', ') || '(none)';
const rel = (devMs, t0) => ((devMs - t0) / 1000).toFixed(1);

// A pose on the emulator: the light is read once it has stopped moving (the fusion needs up to a second, and the resting
// hold drifts in slowly while readings keep coming, so a reading is taken at the plateau, not at a fixed delay).
async function setAndSettle(acc, minMs = SETTLE_S * 1000, maxMs = SETTLE_S * 1000 + 9000) {
    await touch();
    const t0 = Date.now();
    await setPose(acc);
    await sleep(minMs);
    const trace = []; let prev = null; let same = 0; let p;
    for (;;) {
        p = await probe();
        trace.push({ t: Number(((Date.now() - t0) / 1000).toFixed(2)), sx: p.sx, sk: p.sk });
        const key = p._error ? null : `${p.sx}|${p.sk}`;
        // the light creeps in one device pixel at a time near its end: steady means three equal reads in a row (over a second)
        same = key !== null && key === prev ? same + 1 : 0;
        if (same >= 2) break;
        if (Date.now() - t0 > maxMs) break;
        prev = key;
        await sleep(350);
    }
    return { p, trace, settledAt: trace[trace.length - 1].t };
}
async function appPage() { // the page's state, tolerant of the launcher being in front
    const p = await probe();
    return p;
}
// Today must be what shows. A dialog page of the shell (app "wm-op": the update notice after another session's client
// update, a server restart's box) or the launcher can take its place in the middle of a step: wait for Today, at most maxMs.
const onToday = (p) => !!p && !p._error && p.app === 'today' && p.vis === 'visible' && p.scr === null;
async function waitToday(maxMs = 120000) {
    const t0 = Date.now(); let p = await probe(); let kicked = false;
    while (!onToday(p) && Date.now() - t0 < maxMs) {
        if (!kicked && (p._error || p.vis !== 'visible')) { await lane('screen', 'on'); await lane('start-app'); kicked = true; }
        await sleep(4000);
        p = await probe();
    }
    return p;
}
async function freshShow(pose = HOLD) { // hold pose, Today hidden and shown: the lean is measured from this show
    await setPose(pose);
    await lane('other'); await sleep(2000);
    await lane('start-app'); await sleep(3000);
    for (let i = 0; i < 6; i++) {
        const p = await probe();
        if (!p._error && p.app === 'today' && p.vis === 'visible') return p;
        if (p._error || p.vis !== 'visible') await lane('start-app');
        await sleep(2000);
    }
    return probe();
}
const TOGGLE = (on) => `(()=>{const k="wmTodayFx";const had=localStorage.getItem(k);let o={};try{o=JSON.parse(had)||{}}catch(_){o={}};o.glasslight=${on};localStorage.setItem(k,JSON.stringify(o));document.dispatchEvent(new CustomEvent("wmSettingsChange",{detail:{keys:[k]}}));return JSON.stringify({had:had,fx:document.documentElement.dataset.wmTiFx.includes("glasslight")})})()`;
let LS_ORIG; // undefined until read; null = key absent
async function readLsOrig() {
    const r = await evJson('JSON.stringify({v:localStorage.getItem("wmTodayFx")})');
    if (!r._error) { LS_ORIG = r.v; save('.ls-original.json', { wmTodayFx: r.v }); }
}
async function restoreFx() {
    if (LS_ORIG === undefined) return null;
    const js = `(()=>{const k="wmTodayFx";const v=${JSON.stringify(LS_ORIG)};if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);document.dispatchEvent(new CustomEvent("wmSettingsChange",{detail:{keys:[k]}}));return JSON.stringify({ls:localStorage.getItem(k),fx:document.documentElement.dataset.wmTiFx.includes("glasslight")})})()`;
    return evJson(js);
}
// the weather effect (#1109) animates its clouds whenever Today is seen, which feeds the frames counter: step D switches it
// off the way Settings does (wmTodayFx.weather) while it measures the glass light, and restoreFx() puts the key back
const WEATHER = (on) => `(()=>{const k="wmTodayFx";const had=localStorage.getItem(k);let o={};try{o=JSON.parse(had)||{}}catch(_){o={}};o.weather=${on};localStorage.setItem(k,JSON.stringify(o));document.dispatchEvent(new CustomEvent("wmSettingsChange",{detail:{keys:[k]}}));return JSON.stringify({had:had,weather:document.documentElement.dataset.wmTiFx.split(" ").includes("weather")})})()`;
// a passive observer for the settled window: which elements changed (it draws nothing and is disconnected right after)
const WATCH_START = '(()=>{window.__a1413&&window.__a1413.o.disconnect();const w={l:[]};w.o=new MutationObserver((list)=>{for(const m of list){const t=m.target.nodeType===1?m.target:m.target.parentElement;w.l.push([m.type,m.attributeName||"",t?(t.id?"#"+t.id:"")+"."+String(t.className&&t.className.baseVal!==undefined?t.className.baseVal:t.className).slice(0,48):"?",!!(t&&t.closest&&t.closest(".wm-ti-shine"))])}});w.o.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});window.__a1413=w;return "watching"})()';
const WATCH_STOP = '(()=>{const w=window.__a1413;if(!w)return JSON.stringify({_error:"no observer"});w.o.disconnect();delete window.__a1413;const by={};let shine=0;for(const x of w.l){const k=x[0]+(x[1]?":"+x[1]:"")+" @ "+x[2];by[k]=(by[k]||0)+1;if(x[3])shine++}return JSON.stringify({total:w.l.length,shine:shine,by:by})})()';

// ---------------------------------------------------------------- pixels
const DPR = 2.625;
async function lumaOf(file, box) {
    const { data, info: inf } = await sharp(file).extract(box).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = inf.width; const h = inf.height; const y = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) y[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
    return { y, w, h };
}
function boxOf(rect, imgW, imgH) {
    const left = Math.max(0, Math.round(rect.left * DPR));
    const top = Math.max(0, Math.round(rect.top * DPR));
    const width = Math.min(imgW - left, Math.round(rect.width * DPR));
    const height = Math.min(imgH - top, Math.round(rect.height * DPR));
    return { left, top, width, height };
}
async function imgSize(file) { const m = await sharp(file).metadata(); return { w: m.width, h: m.height }; }
function rowsMean(a, rows) { // mean over rows (array of y) per column
    const out = new Float32Array(a.w);
    for (let x = 0; x < a.w; x++) { let s = 0; for (const r of rows) s += a.y[r * a.w + x]; out[x] = s / rows.length; }
    return out;
}
function detrend(v, win = 61) {
    const n = v.length; const out = new Float32Array(n); const half = (win - 1) / 2;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + v[i];
    for (let i = 0; i < n; i++) { const lo = Math.max(0, i - half); const hi = Math.min(n, i + half + 1); out[i] = v[i] - (pre[hi] - pre[lo]) / (hi - lo); }
    return out;
}
function xcorr(a, b, maxShift = 150) { // best s with a[x] ~ b[x - s]
    const n = a.length; const res = [];
    for (let s = -maxShift; s <= maxShift; s++) {
        let sab = 0; let saa = 0; let sbb = 0;
        for (let x = Math.max(0, s); x < Math.min(n, n + s); x++) { const p = a[x]; const q = b[x - s]; sab += p * q; saa += p * p; sbb += q * q; }
        res.push({ s, c: saa && sbb ? sab / Math.sqrt(saa * sbb) : 0 });
    }
    const best = res.reduce((m, r) => (r.c > m.c ? r : m), res[0]);
    const second = res.filter((r) => Math.abs(r.s - best.s) > 12).reduce((m, r) => (r.c > m.c ? r : m), { s: 0, c: -1 });
    return { best, second };
}
async function cropBand(srcFile, rect, name) {
    const { w, h } = await imgSize(srcFile);
    const box = boxOf(rect, w, h);
    await sharp(srcFile).extract(box).toFile(f(`band-${name}.png`));
    await sharp(srcFile).extract(box).resize(box.width * 2, box.height * 2, { kernel: 'lanczos3' }).toFile(f(`band-${name}-2x.png`));
    return box;
}
function runsOf(row, thr, gap = 2) {
    const runs = []; let cur = null;
    for (let x = 0; x < row.length; x++) {
        if (row[x] >= thr) { if (cur && x - cur.end <= gap + 1) cur.end = x; else { if (cur) runs.push(cur); cur = { start: x, end: x, peak: 0 }; } }
        if (cur && x <= cur.end + 0 && row[x] > cur.peak) cur.peak = row[x];
    }
    if (cur) runs.push(cur);
    return runs.map((r) => ({ start: r.start, end: r.end, width: r.end - r.start + 1, peak: Number(r.peak.toFixed(1)) }));
}

function smoothBox(v, k) { // moving average, odd window k
    const n = v.length; const out = new Float32Array(n); const h = (k - 1) / 2;
    for (let i = 0; i < n; i++) { let sum = 0; let c = 0; for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) { sum += v[j]; c++; } out[i] = sum / c; }
    return out;
}
/** Peaks of a smoothed row: height (alpha %), prominence, and the width at half its prominence (FWHM, device px). */
function peaksOf(row, minHeight = 1.0, minProm = 0.5) {
    const sm = smoothBox(row, 5); const n = sm.length; const out = [];
    for (let x = 4; x < n - 4; x++) {
        let isMax = true;
        for (let j = x - 4; j <= x + 4; j++) if (sm[j] > sm[x] || (sm[j] === sm[x] && j < x)) { isMax = false; break; }
        if (!isMax || sm[x] < minHeight) continue;
        let lMin = sm[x]; for (let l = x - 1; l >= 0 && sm[l] <= sm[x]; l--) if (sm[l] < lMin) lMin = sm[l];
        let rMin = sm[x]; for (let r = x + 1; r < n && sm[r] <= sm[x]; r++) if (sm[r] < rMin) rMin = sm[r];
        const base = Math.max(lMin, rMin); const prom = sm[x] - base;
        if (prom < minProm) continue;
        const half = base + prom / 2;
        let a = x; while (a > 0 && sm[a] > half) a--;
        let b = x; while (b < n - 1 && sm[b] > half) b++;
        const xa = a < x && sm[a + 1] !== sm[a] ? a + (half - sm[a]) / (sm[a + 1] - sm[a]) : a;
        const xb = b > x && sm[b - 1] !== sm[b] ? b - (half - sm[b]) / (sm[b - 1] - sm[b]) : b;
        out.push({ x, height: Number(sm[x].toFixed(2)), prominence: Number(prom.toFixed(2)), fwhm: Number((xb - xa).toFixed(1)), from: Number(xa.toFixed(1)), to: Number(xb.toFixed(1)) });
    }
    return out;
}
function steepest(v, k = 3) { const sm = smoothBox(v, k); let m = 0; let at = 0; for (let i = 1; i < sm.length; i++) { const d = Math.abs(sm[i] - sm[i - 1]); if (d > m) { m = d; at = i; } } return { perPx: Number(m.toFixed(3)), at }; }

// ---------------------------------------------------------------- ray widths from the page's computed style
function splitTop(s) { const out = []; let d = 0; let cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
function rayWidths(bg, w, h) {
    const grads = splitTop(bg).filter((g) => g.startsWith('linear-gradient'));
    return grads.map((g) => {
        const inner = g.slice(g.indexOf('(') + 1, g.lastIndexOf(')'));
        const parts = splitTop(inner);
        const ang = parseFloat(parts[0]);
        const th = (ang * Math.PI) / 180;
        const len = w * Math.abs(Math.sin(th)) + h * Math.abs(Math.cos(th));
        const stops = parts.slice(1).map((p) => {
            const m = /^(rgba?\([^)]*\))\s+(-?[\d.]+)(%|px)$/.exec(p);
            if (!m) return null;
            const col = m[1].match(/[\d.]+/g).map(Number);
            const alpha = col.length > 3 ? col[3] : 1;
            return { alpha, pos: m[3] === '%' ? (Number(m[2]) / 100) * len : Number(m[2]) };
        }).filter(Boolean);
        const zero = stops.filter((s) => s.alpha === 0);
        const first = zero[0]; const last = zero[zero.length - 1];
        const peak = Math.max(...stops.map((s) => s.alpha));
        return { angle: ang, gradientLen: Number(len.toFixed(2)), stops: stops.length, width: first && last ? Number((last.pos - first.pos).toFixed(2)) : null, peakAlpha: peak, from: first && Number(first.pos.toFixed(1)), to: last && Number(last.pos.toFixed(1)) };
    });
}
function widthClasses(ws, gap) { const s = [...ws].sort((a, b) => a - b); const cl = []; for (const v of s) { if (cl.length && v - cl[cl.length - 1][cl[cl.length - 1].length - 1] <= gap) cl[cl.length - 1].push(v); else cl.push([v]); } return cl; }

// ---------------------------------------------------------------- state
const S = { fix: null, fixCss: null, fixJs: null, dir: {}, settled: false };

async function stepA() {
    say('');
    say('A. Preconditions');
    const st = JSON.parse((await lane('status')).out || '{}');
    save('A-status.json', st);
    info(`${st.id}: ${st.shape} ${st.wmSize}, Android ${st.androidSdk}, app versionCode ${st.appVersionCode}, top ${st.top}`);
    const pre = await readPre();
    save('A-preconditions.json', pre);
    return pre;
}
async function readPre() {
    const js = `(async()=>{const css=await (await fetch("/css/wm-titanium.css")).text();const js=await (await fetch("/scripts/comp/wmTitanium.js")).text();let rule=false;try{for(const ss of document.styleSheets){let rs;try{rs=ss.cssRules}catch(_){continue};for(const r of rs){if(r.selectorText&&r.selectorText.includes("is-drift"))rule=true}}}catch(_){};let ua=null;try{ua=window.serviceWorkerManager.updateAction()}catch(e){ua="error: "+e}const i=document.querySelector(".wm-ti-shine > i");return JSON.stringify({ver:document.documentElement.dataset.wmVersion,app:document.documentElement.dataset.wmApp,fx:document.documentElement.dataset.wmTiFx||"",shine:!!i,rm:matchMedia("(prefers-reduced-motion: reduce)").matches,cssLen:css.length,cssIsDrift:css.includes("is-drift"),jsLen:js.length,jsSk:js.includes("--wm-ti-sk"),jsTime:/:16\\.7[;,)]/.test(js),css110:css.includes("110deg"),cssHas:Object.fromEntries(${JSON.stringify(EXPECT_CSS)}.map(x=>[x,css.includes(x)])),jsShineDrift:js.includes("shineDrift"),loadedSheetIsDrift:rule,updateAction:ua})})()`;
    return evJson(js);
}
function setFix(pre) {
    if (pre._error) return;
    S.fixCss = pre.cssIsDrift; S.fixJs = pre.jsSk;
    S.fix = pre.cssIsDrift && pre.jsSk ? 'present' : 'absent';
}
function judgePre(pre) {
    if (pre._error) { verdict(false, `A: the page could not be read: ${pre._error}`); return false; }
    setFix(pre);
    verdict(pre.ver === '6.5', `A: data-wm-version ${pre.ver} (want 6.5)`);
    verdict(pre.app === 'today', `A: data-wm-app ${pre.app} (want today)`);
    verdict(/\btilt\b/.test(pre.fx) && /\bglasslight\b/.test(pre.fx), `A: data-wm-ti-fx has tilt and glasslight (${pre.fx.split(' ').filter((x) => /tilt|glasslight/.test(x)).join(', ')})`);
    verdict(pre.shine, 'A: the shine element .wm-ti-shine > i exists');
    verdict(pre.rm === false, `A: prefers-reduced-motion: reduce is ${pre.rm} (want false)`);
    info(`A: wm-titanium.css ${pre.cssLen} bytes, has is-drift: ${pre.cssIsDrift}; wmTitanium.js ${pre.jsLen} bytes, has "--wm-ti-sk": ${pre.jsSk} (the minified file has no function names; shineDrift: ${pre.jsShineDrift}); the loaded stylesheet has an is-drift rule: ${pre.loadedSheetIsDrift}`);
    info(`A: wm-titanium.css has "110deg" (the new rays): ${pre.css110}; wmTitanium.js has the damping counted in time (its 16.7 ms first step): ${pre.jsTime}`);
    if (INSTALL) verdict(pre.jsTime === true, `A: wmTitanium.js is the build with the light's damping counted in time (${pre.jsTime})`);
    for (const str of EXPECT_CSS) verdict(!!(pre.cssHas && pre.cssHas[str]), `A: wm-titanium.css contains "${str}" (the build this run expects)`);
    info(`A: serviceWorkerManager.updateAction() = ${JSON.stringify(pre.updateAction)}`);
    if (S.fix === 'present' && pre.loadedSheetIsDrift === false) verdict(false, 'A: the assets served have the fix but the stylesheet the page loaded has no is-drift rule (the page runs older files; it has to restart through its own update)');
    info(`A: fix=${S.fix}`);
    save('A-fix.txt', `fix=${S.fix}\n`);
    return true;
}
async function stepAInstall(pre) {
    if (!INSTALL) return pre;
    let ua = pre.updateAction;
    if (!ua) { // nothing counted yet: the page's own check for new files (serviceWorkerManager.checkStaticFileUpdates, the one a periodic check runs)
        const c = await evJson('(async()=>{const m=window.serviceWorkerManager;await m.checkStaticFileUpdates(true);return JSON.stringify({ua:m.updateAction()})})()');
        info(`A: --install: nothing was counted; the page's own check for new files answered ${JSON.stringify(c)}`);
        if (c && c.ua) { ua = c.ua; pre.updateAction = ua; }
    }
    if (!ua || (ua.kind !== 'install' && ua.kind !== 'restart')) { info(`A: --install: no update is waiting (updateAction ${JSON.stringify(ua)}); not installing anything`); return pre; }
    info(`A: --install: an update waits (${JSON.stringify(ua)}); calling serviceWorkerManager.installUpdates() (the phone's own Install Now path)`);
    const r = await ev('(async()=>{const r=await window.serviceWorkerManager.installUpdates();return JSON.stringify({r:r})})()', 30000);
    save('A-install-call.json', r);
    info(`A: installUpdates answered: ${r.ok ? r.value : 'no answer (' + r.raw + '), expected when the page restarts'}`);
    const t0 = Date.now(); const trail = [];
    let back = null;
    while (Date.now() - t0 < 240000) {
        await sleep(10000);
        const top = JSON.parse((await lane('status')).out || '{}').top || '';
        const p = await probe();
        trail.push({ at: Math.round((Date.now() - t0) / 1000), top, probe: p._error ? p._error : brief(p) });
        if (p._error || (top && !top.startsWith(PKG))) { if (!top.startsWith(PKG)) await lane('start-app'); continue; }
        if (p.app === 'today' && p.vis === 'visible') {
            const q = await readPre();
            if (!q._error && q.cssIsDrift && q.jsSk && q.jsTime && EXPECT_CSS.every((x) => q.cssHas && q.cssHas[x])) { back = q; break; }
            trail[trail.length - 1].pre = q._error || { cssIsDrift: q.cssIsDrift, jsSk: q.jsSk, jsTime: q.jsTime, updateAction: q.updateAction };
        }
    }
    save('A-install-trail.json', trail);
    if (!back) { verdict(false, `A: after installUpdates() the page did not come back on Today with the fix within 4 minutes (trail in A-install-trail.json)`); return pre; }
    info(`A: the page is back on Today with the new files after about ${Math.round((Date.now() - t0) / 1000)} s`);
    await sleep(8000);
    const again = await readPre();
    save('A-preconditions-after-install.json', again);
    return again._error ? back : again;
}

// ---------------------------------------------------------------- B
async function stepB() {
    say('');
    say('B. Leaning moves the light');
    await freshShow(HOLD);
    await sleep(1000);
    const rectR = await evJson('JSON.stringify(document.querySelector(".wm-ti-shine").getBoundingClientRect())');
    save('B-shine-rect.json', rectR);
    const rect = rectR._error ? { left: 0, top: 412.46, width: 412.19, height: 103.5 } : rectR;
    const poses = [['0', 0], ['plus9', 9], ['minus9', -9], ['plus18', 18], ['minus18', -18], ['0-back', 0]];
    const got = {};
    for (const [name, deg] of poses) {
        const st = await setAndSettle(deg === 0 ? HOLD : poseFor(deg));
        const p = st.p;
        await shot(`lean-${name}.png`);
        const later = await probe();
        got[name] = { deg, probe: p, later, trace: st.trace };
        await cropBand(f(`lean-${name}.png`), rect, name);
        info(`B pose ${name} (${deg} deg, steady after ${st.settledAt} s): ${brief(p)}`);
        if (!p._error && !later._error && Math.abs(p.sxN - later.sxN) > 0.5) info(`B pose ${name}: sx moved from ${p.sx} to ${later.sx} between the probe and the end of the shot`);
    }
    save('B-poses.json', got);
    const g = (n) => got[n].probe;
    const ok = poses.every(([n]) => !g(n)._error);
    if (!ok) { verdict(false, 'B: a probe failed, see B-poses.json'); return; }
    S.dir.sxPlus9 = g('plus9').sxN;
    const wallW = (await evJson('JSON.stringify({w:(document.querySelector("#wmShell > .wm-wall65")||document.documentElement).clientWidth})')).w || 412;
    const fullPx = (SLIDE_PCT / 100) * wallW;
    save('B-expectation.json', { slidePct: SLIDE_PCT, skewDeg: SKEW_DEG, settleSeconds: SETTLE_S, pictureWidthCss: wallW, fullLeanSlideCssPx: fullPx });
    verdict(Math.abs(g('plus18').sxN) >= 0.6 * fullPx && Math.abs(g('plus18').sxN) <= 1.02 * fullPx && Math.abs(g('minus18').sxN) >= 0.6 * fullPx && Math.abs(g('minus18').sxN) <= 1.02 * fullPx, `B: full lean (18 deg) slides ${g('plus18').sx} / ${g('minus18').sx}; expected ${SLIDE_PCT} % of the ${wallW} px picture = ${fullPx.toFixed(1)} px (accepted 60 % to 102 %: the resting hold follows each pose by 1 % per sensor reading while the emulator's fusion turns, so the lean read falls short of the full 18 deg by a varying part, and never exceeds it)`);
    verdict(g('plus9').sxN * g('minus9').sxN < 0 && Math.abs(g('plus9').sxN) >= 5 && Math.abs(g('minus9').sxN) >= 5, `B: sx at +9 deg ${g('plus9').sx}, at -9 deg ${g('minus9').sx}: opposite signs, each at least 5 px`);
    verdict(Math.abs(g('plus18').sxN) > Math.abs(g('plus9').sxN) && Math.abs(g('minus18').sxN) > Math.abs(g('minus9').sxN), `B: |sx| at 18 deg (${g('plus18').sx}, ${g('minus18').sx}) larger than at 9 deg (${g('plus9').sx}, ${g('minus9').sx})`);
    info(`B: which way the light moves: a lean of +9 deg (positive x on the accelerometer) gives sx ${g('plus9').sx} (light moves ${g('plus9').sxN < 0 ? 'left' : 'right'})`);
    verdict(Math.abs(g('0').sxN) <= 1.5, `B: sx at rest, Today freshly shown: ${g('0').sx} (want within 1.5 px of 0)`);
    // the reference hold follows each pose by 1 % per sensor reading (wmTitanium.js onOrient, "any way of holding it is the
    // middle", by design), so the same pose after a chain of leans is no longer the middle: reported, not judged
    info(`B: back at the first pose after the leans sx reads ${g('0-back').sx}: the resting hold followed the poses (1 % per reading, by design; traces in B-poses.json). A real phone re-centres the same way within seconds`);
    // what "back to the middle" means for this design: Today shown again with the phone held still starts from 0
    await freshShow(HOLD);
    await sleep(SETTLE_S * 1000);
    const again = await probe();
    save('B-fresh-show.json', again);
    verdict(!again._error && Math.abs(again.sxN) <= 1.5 && Math.abs(again.skN || 0) <= 0.2, `B: Today hidden and shown again with the phone held still starts from the middle: ${again._error ? again._error : `sx ${again.sx}, sk ${again.sk || '-'}`} (want within 1.5 px of 0)`);
    verdict(poses.every(([n]) => g(n).mat && Math.abs(g(n).mat.e - g(n).sxN) <= 0.02), `B: the computed transform matrix e equals sx at every pose (${poses.map(([n]) => `${n}: e ${g(n).mat ? g(n).mat.e : '-'} sx ${g(n).sxN}`).join('; ')})`);
    if (S.fix === 'present') {
        verdict(g('plus9').skN * g('minus9').skN < 0, `B: sk at +9 deg ${g('plus9').sk}, at -9 deg ${g('minus9').sk}: opposite signs`);
        verdict([g('plus18'), g('minus18')].every((q) => Math.abs(q.skN) >= 0.6 * SKEW_DEG - 0.1 && Math.abs(q.skN) <= SKEW_DEG + 0.1), `B: |sk| at 18 deg is ${g('plus18').sk} / ${g('minus18').sk} (want ${SKEW_DEG} deg at the full lean; accepted from 60 % of it, as the slide)`);
        verdict(poses.every(([n]) => g(n).mat && Math.abs(g(n).mat.c - Math.tan((g(n).skN * Math.PI) / 180)) <= 0.002) && g('0').mat.c === 0, `B: the matrix c equals tan(sk) at every pose, 0 at rest (${poses.map(([n]) => `${n}: c ${g(n).mat ? g(n).mat.c.toFixed(4) : '-'} sk ${g(n).sk}`).join('; ')})`);
    } else info('B: fix=absent: the slant (--wm-ti-sk) belongs to the newest code, its checks are skipped (sk readings: ' + poses.map(([n]) => `${n}: '${g(n).sk}'`).join(', ') + ')');
    await stepBPixels(rect, got);
    await stepBDamping();
}
async function stepBDamping() {
    info('B damping: from rest the phone is stepped straight to +18 deg; the page reads sx every 250 ms for 3.75 s (one eval, 15 reads, ends by itself)');
    await freshShow(HOLD);
    await syncClock();
    await touch();
    await sleep(600);
    const evp = ev('(async()=>{const i=document.querySelector(".wm-ti-shine > i");const out=[];for(let k=0;k<15;k++){out.push([Date.now(),i.style.getPropertyValue("--wm-ti-sx"),i.style.getPropertyValue("--wm-ti-sk")]);await new Promise(r=>setTimeout(r,250))}return JSON.stringify(out)})()');
    await sleep(500);
    const a = Date.now(); await setPose(poseFor(18)); const b = Date.now();
    const tPose = (a + b) / 2 + clock.skew;
    const r = await evp;
    if (!r.ok) { verdict(false, 'B damping: the page could not be read: ' + r.raw); return; }
    const rows = JSON.parse(r.value).map(([ts, sx, sk]) => ({ t: Number(((ts - tPose) / 1000).toFixed(2)), sx: parseFloat(sx) || 0, sk: parseFloat(sk) || 0 }));
    save('B-damping.json', { poseSetAtDevice: hms(tPose), rows });
    save('B-damping.txt', 't_s_after_pose\tsx_px\tsk_deg\n' + rows.map((x) => `${x.t}\t${x.sx}\t${x.sk}`).join('\n') + '\n');
    const after = rows.filter((x) => x.t >= -0.2);
    const sx0 = rows[0].sx;
    const fin = rows.slice(-3).reduce((m, x) => m + x.sx, 0) / 3;
    const cross = (frac) => { const lvl = sx0 + (fin - sx0) * frac; for (let i = 1; i < rows.length; i++) { const p = rows[i - 1]; const q = rows[i]; if ((fin > sx0 ? q.sx >= lvl : q.sx <= lvl) && q.sx !== p.sx) { return Math.max(0, p.t + ((lvl - p.sx) / (q.sx - p.sx)) * (q.t - p.t)); } } return null; };
    const t63 = cross(0.632); const t95 = cross(0.95);
    info(`B damping (sx over time, s after the pose is set: px): ${rows.map((x) => `${x.t}: ${x.sx}`).join('; ')}`);
    info(`B damping: start ${sx0} px, final (mean of the last 3 reads) ${fin.toFixed(2)} px; time to 63 % ${t63 === null ? 'not reached' : t63.toFixed(2) + ' s'}, to 95 % ${t95 === null ? 'not reached' : t95.toFixed(2) + ' s'} (expected about 0.4 s and 1.3 s for the light's own low-pass; the emulator's sensor fusion adds its own lag of up to a second, and the sampling step is 0.25 s)`);
    if (t95 !== null && t95 < 0.2) verdict(false, `B damping: the light reached 95 % of its lean in ${t95.toFixed(2)} s, under 0.2 s: not damped`);
    else if (t95 === null) info('B damping: 95 % was not reached within the window, so it is damped');
}
async function stepBPixels(rect, got) {
    // Pixel check: the pictured lean moves the wallpaper too, so each pose is shot twice, with the glass light and with it
    // off (Settings' own switch, wmTodayFx.glasslight); the difference of the two is the rays alone.
    info('B pixels: each pose shot with the glass light on and off (the difference is the rays alone), same minute, the lean unchanged');
    await waitSec(3, 22);
    await readLsOrig();
    const items = {};
    for (const [name, deg] of [['plus9', 9], ['minus9', -9]]) {
        const st = await setAndSettle(poseFor(deg));
        const p0 = st.p;
        await shot(`px-${name}-on.png`);
        const pOn = await probe();
        const off = await evJson(TOGGLE(false));
        await sleep(1500);
        const p1 = await probe();
        await shot(`px-${name}-off.png`);
        const on = await evJson(TOGGLE(true));
        await sleep(1000);
        const p2 = await probe();
        items[name] = { before: brief(p0), afterOnShot: brief(pOn), whileOff: brief(p1), afterOn: brief(p2), sxAtOnShot: (p0.sxN + pOn.sxN) / 2, toggles: [off, on], trace: st.trace };
        info(`B pixels ${name}: sx before the shot ${p0.sx}, after the with-light shot ${pOn.sx}, while off ${p1.sx}, after on ${p2.sx}`);
    }
    await restoreFx();
    save('B-pixel-pairs.json', items);
    const { w: iw, h: ih } = await imgSize(f('px-plus9-on.png'));
    const box = boxOf(rect, iw, ih);
    const rows = []; const mid = Math.floor(box.height / 2);
    for (let r = mid - 8; r <= mid + 8; r++) rows.push(r);
    const diffs = {};
    for (const name of ['plus9', 'minus9']) {
        const a = await lumaOf(f(`px-${name}-on.png`), box);
        const b = await lumaOf(f(`px-${name}-off.png`), box);
        const d = { y: new Float32Array(a.w * a.h), w: a.w, h: a.h };
        for (let i = 0; i < d.y.length; i++) d.y[i] = (100 * (a.y[i] - b.y[i])) / Math.max(40, 255 - b.y[i]); // the light's alpha in percent: independent of the picture under it
        diffs[name] = d;
    }
    const sx9 = items.plus9.sxAtOnShot; const sxm9 = items.minus9.sxAtOnShot; // the lean when the with-light shot was taken
    const expected = (sx9 - sxm9) * DPR;
    // the moving average taken off the row must be wider than the widest ray (2.5 times its width along the row), or it eats the
    // broad rays; for the old hairlines this stays at the 61 px floor
    const gb = await evJson('JSON.stringify({bg:getComputedStyle(document.querySelector(".wm-ti-shine > i")).backgroundImage,w:parseFloat(getComputedStyle(document.querySelector(".wm-ti-shine > i")).width),h:parseFloat(getComputedStyle(document.querySelector(".wm-ti-shine > i")).height)})');
    const widest = gb._error ? 0 : Math.max(...rayWidths(gb.bg, gb.w, gb.h).map((r) => r.width || 0));
    const win = Math.max(61, Math.min(1001, Math.round((2.5 * widest * DPR) / 2) * 2 + 1));
    const rowP = rowsMean(diffs.plus9, rows); const rowM = rowsMean(diffs.minus9, rows);
    const A = detrend(rowP, win);
    const B = detrend(rowM, win);
    const xc = xcorr(A, B, 150);
    const xc61 = xcorr(detrend(rowP, 61), detrend(rowM, 61), 150);
    info(`B pixels: moving average taken off the row: ${win} px (2.5 x the widest ray, ${widest} CSS px); for comparison with the 61 px window the best shift is ${xc61.best.s} (correlation ${xc61.best.c.toFixed(3)})`);
    save('B-pixel-shift.json', { expectedDevicePx: expected, sxPlus9: sx9, sxMinus9: sxm9, best: xc.best, secondPeak: xc.second, rowsUsed: [rows[0], rows[rows.length - 1]], bandBox: box });
    // the strength of the ray pattern in each difference
    const energy = (v) => Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0) / v.length);
    info(`B pixels: ray pattern strength (rms of the detrended alpha estimate, percent): +9 ${energy(A).toFixed(2)}, -9 ${energy(B).toFixed(2)}`);
    const reliable = xc.best.c >= 0.5 && xc.best.c - xc.second.c >= 0.1;
    info(`B pixels: best shift ${xc.best.s} device px (correlation ${xc.best.c.toFixed(3)}); the next best peak elsewhere ${xc.second.s} px (${xc.second.c.toFixed(3)}); expected (sx(+9) - sx(-9)) * 2.625 = ${expected.toFixed(1)} px; reliable=${reliable}`);
    if (!reliable) info('B pixels: the correlation is NOT reliable on this wallpaper (peak weak or ambiguous); the DOM numbers above remain the check, this is not a pass');
    if (!reliable) info(`B: pixel shift not decidable on this wallpaper (best ${xc.best.s} px, correlation ${xc.best.c.toFixed(2)}, next peak ${xc.second.s} px ${xc.second.c.toFixed(2)}; expected ${expected.toFixed(1)}): not counted as pass or fail, the DOM numbers are the check`);
    else verdict(Math.abs(xc.best.s - expected) <= 12, `B: pixel shift of the rays between +9 and -9 is ${xc.best.s} device px, expected ${expected.toFixed(1)} from the two sx readings (within 12: the shafts are soft bells up to 396 px wide and their slant differs by a few degrees between the two poses, which moves a row off the middle by a few pixels more; correlation ${xc.best.c.toFixed(2)})`);
    for (const n of ['plus9', 'minus9']) for (const k of ['on', 'off']) {
        await sharp(f(`px-${n}-${k}.png`)).extract(box).toFile(f(`pxband-${n}-${k}.png`)); // the band only, kept for offline checks
        fs.rmSync(f(`px-${n}-${k}.png`), { force: true });
    }
}

// ---------------------------------------------------------------- C
async function stepC() {
    say('');
    say('C. Rays at different widths');
    let p = await probe();
    if (p._error || p.app !== 'today' || Math.abs(p.sxN) > 1.5) { p = await freshShow(HOLD); await touch(); await setPose(HOLD); await sleep(1500); p = await probe(); }
    info(`C: lean at the start of C: ${brief(p)}`);
    const pg = await evJson('(()=>{const i=document.querySelector(".wm-ti-shine > i");const cs=getComputedStyle(i);const r=document.querySelector(".wm-ti-shine").getBoundingClientRect();return JSON.stringify({bg:cs.backgroundImage,w:parseFloat(cs.width),h:parseFloat(cs.height),offW:i.offsetWidth,offH:i.offsetHeight,rect:r})})()');
    save('C-gradients.json', pg);
    if (pg._error) { verdict(false, 'C: the page could not be read: ' + pg._error); return; }
    const rays = rayWidths(pg.bg, pg.w, pg.h);
    save('C-ray-widths.json', rays);
    const ws = rays.map((r) => r.width).filter((x) => x !== null);
    const sorted = [...ws].sort((a, b) => a - b);
    const cl = widthClasses(sorted, 2);
    info(`C: the <i> box is ${pg.w} x ${pg.h} CSS px; ${rays.length} gradients, ray widths (CSS px across the ray, between its first and last zero-alpha stops), sorted: ${sorted.join(', ')}; peak alphas ${rays.map((r) => r.peakAlpha).join(', ')}`);
    verdict(rays.length === 7 && cl.length >= 4 && sorted[sorted.length - 1] >= 4 * sorted[0], `C: ${rays.length} rays, ${cl.length} distinct widths (differing by more than 2 px), widest ${sorted[sorted.length - 1]} px vs narrowest ${sorted[0]} px (${(sorted[sorted.length - 1] / sorted[0]).toFixed(1)}x; want 7, at least 4, at least 4x)`);
    // pixels
    await waitSec(3, 38);
    await readLsOrig();
    await touch();
    await sleep(500);
    await shot('c-on.png');
    const off = await evJson(TOGGLE(false));
    await sleep(1500);
    await shot('c-off.png');
    const on = await evJson(TOGGLE(true));
    await sleep(1000);
    const rest = await restoreFx();
    save('C-toggles.json', { off, on, restored: rest, lsOriginal: LS_ORIG });
    info(`C: glasslight switched off and on the way Settings does; localStorage.wmTodayFx put back to ${JSON.stringify(LS_ORIG)} (now ${rest && rest.ls !== undefined ? JSON.stringify(rest.ls) : 'unknown'})`);
    const rect = pg.rect;
    const { w: iw, h: ih } = await imgSize(f('c-on.png'));
    const box = boxOf(rect, iw, ih);
    const a = await lumaOf(f('c-on.png'), box);
    const b = await lumaOf(f('c-off.png'), box);
    const alphaAt = (x, y) => (100 * (a.y[y * a.w + x] - b.y[y * a.w + x])) / Math.max(40, 255 - b.y[y * a.w + x]);
    const THR = 1.5;
    const rowAt = (y) => { const r = new Float32Array(a.w); for (let x = 0; x < a.w; x++) r[x] = alphaAt(x, y); return r; };
    const mid = Math.floor(a.h / 2);
    // the middle row crosses the clock's digits and the weather text, which cover the light (it is drawn under the
    // text): the row with the most pixels lit by the light (between 12 % and 88 % of the band's height) is used as well
    let clear = mid; let clearN = -1;
    for (let y = Math.round(a.h * 0.12); y <= Math.round(a.h * 0.88); y++) { const n = Array.from(rowAt(y)).filter((v) => v >= THR).length; if (n > clearN) { clearN = n; clear = y; } }
    const rowMid = rowAt(mid); const rowClear = rowAt(clear);
    const runsMid = runsOf(rowMid, THR, 2); const runs = runsOf(rowClear, THR, 2);
    save('C-pixel-runs.json', { threshold: THR, midRow: mid, clearRow: clear, bandBox: box, runsMiddleRow: runsMid, runsClearRow: runs, rowClear: Array.from(rowClear).map((v) => Number(v.toFixed(1))) });
    // the amplified difference over the whole band; the two rows marked (red: middle, green: the clear row)
    const buf = Buffer.alloc(a.w * a.h * 3);
    for (let i = 0; i < a.w * a.h; i++) { const v = Math.max(0, Math.min(255, Math.abs(a.y[i] - b.y[i]) * 12)); buf[i * 3] = v; buf[i * 3 + 1] = v; buf[i * 3 + 2] = v; }
    for (let x = 0; x < a.w; x++) { const o = (mid * a.w + x) * 3; buf[o] = 255; buf[o + 1] = 0; buf[o + 2] = 0; const o2 = (clear * a.w + x) * 3; buf[o2] = 0; buf[o2 + 1] = 255; buf[o2 + 2] = 0; }
    await sharp(buf, { raw: { width: a.w, height: a.h, channels: 3 } }).png().toFile(f('rays-diff.png'));
    await cropBand(f('c-on.png'), rect, 'rays-on');
    const sinA = Math.abs(Math.sin((104 * Math.PI) / 180));
    info(`C pixels: expected run widths along a row (device px) from the 7 ray widths: ${rays.map((r) => Math.round((r.width * DPR) / sinA)).sort((x, y) => x - y).join(', ')}`);
    info(`C pixels: middle row (${mid}, covered by the clock and weather text where they stand): ${runsMid.length} runs: ${runsMid.map((r) => `${r.start}-${r.end} (${r.width} px)`).join('; ')}`);
    info(`C pixels: clearest row (${clear}): ${runs.length} runs where the light's alpha estimate ((on - off) / (255 - off) of the luminance, percent) is at least ${THR}: ${runs.map((r) => `${r.start}-${r.end} (${r.width} px, peak ${r.peak})`).join('; ')}`);
    // soft shafts are peaks, not runs over a threshold: local maxima of the lightly smoothed alpha row, each with its width at half height
    const pkClear = peaksOf(rowClear); const pkMid = peaksOf(rowMid);
    const lumaRow = new Float32Array(a.w); for (let x = 0; x < a.w; x++) lumaRow[x] = a.y[clear * a.w + x] - b.y[clear * a.w + x];
    const stAlpha = steepest(rowClear, 3); const stLuma = steepest(lumaRow, 3); const stLuma1 = steepest(lumaRow, 1);
    save('C-pixel-peaks.json', { clearRow: clear, midRow: mid, peaksClearRow: pkClear, peaksMiddleRow: pkMid, steepestAlphaPctPerPx: stAlpha, steepestLumaPerPx_smooth3: stLuma, steepestLumaPerPx_raw: stLuma1 });
    info(`C pixels: middle row peaks: ${pkMid.map((q) => `x ${q.x} h ${q.height}% FWHM ${q.fwhm} px`).join('; ') || 'none'}`);
    info(`C pixels: clearest row (${clear}) peaks (height = the light's alpha in percent, FWHM = width at half the peak's prominence, device px): ${pkClear.map((q) => `x ${q.x} h ${q.height}% FWHM ${q.fwhm} px`).join('; ') || 'none'}`);
    info(`C pixels: sharpness, the steepest ramp in the on-minus-off difference on the clearest row: ${stAlpha.perPx} alpha-percent per device px (at x ${stAlpha.at}), ${stLuma.perPx} luminance levels per px smoothed over 3 px, ${stLuma1.perPx} raw (text edges beside a ray count here)`);
    const fw = pkClear.map((q) => q.fwhm);
    const maxF = Math.max(...fw); const minF = Math.min(...fw);
    verdict(pkClear.length >= 4 && maxF >= 2.5 * minF, `C: ${pkClear.length} peaks on the clearest row, FWHM ${[...fw].sort((x, y) => x - y).join(', ')} device px, widest ${maxF} vs narrowest ${minF} = ${(maxF / minF).toFixed(1)}x (want at least 4 peaks and at least 2.5x)`);
    for (const n of ['c-on.png', 'c-off.png']) fs.rmSync(f(n), { force: true });
}

// ---------------------------------------------------------------- D
async function stepD() {
    say('');
    say('D. The idle drift settles and stops');
    await readLsOrig();
    const wOff = await evJson(WEATHER(false));
    info(`D: the weather effect is switched off for this step the way Settings does (its clouds, #1109, animate whenever Today is seen and would be counted as frames): data-wm-ti-fx has weather: ${wOff._error ? wOff._error : wOff.weather}; it is put back at the end of the step`);
    // Today has to stay on screen for the whole step (about three minutes). When something else takes the screen in the
    // middle (a dialog page of the shell after another session's client update or server restart), the attempt says so in
    // one line and the step starts again, at most three times
    for (let attempt = 1; attempt <= 3; attempt++) {
        const r = await stepDOnce(attempt);
        if (r === 'done') return;
        if (attempt < 3) await waitToday();
    }
    verdict(false, 'D: Today was taken off the screen by something else in all 3 attempts (the INFO lines above say by what); not measured');
    await restoreFx();
}
async function stepDOnce(attempt) {
    const out = [];
    const V = (ok, text) => out.push(() => verdict(ok, text));
    const I = (text) => out.push(() => info(text));
    const flush = () => { for (const fn of out) fn(); out.length = 0; };
    const disturbed = (why) => { info(`D attempt ${attempt} is not counted: ${why}; something else took the screen. The step starts again`); return 'disturbed'; };
    await waitToday();
    await freshShow(HOLD);
    await syncClock();
    await touch();
    await setPose(poseFor(9));
    await sleep(SETTLE_S * 1000);
    const p0 = await probe();
    I(`D: with +9 held and Today freshly shown: ${brief(p0)}`);
    if (!onToday(p0)) return disturbed(`before the wake touch Today was not what showed (app=${p0.app} vis=${p0.vis})`);
    const T0 = await touch();                 // host ms of the wake touch
    const T0d = T0 + clock.skew;              // device ms
    I(`D: wake touch T0 at device clock ${hms(T0d)}`);
    const sched = [[5, 'sensor'], [25, 'probe'], [29.3, 'gfx0'], [31, 'probe'], [33, 'probe'], [36, 'probe'], [38, 'gfx1'], [40, 'probe'], [45, 'probe']];
    const tl = []; const rec = {};
    for (const [t, what] of sched) {
        await sleepUntil(T0 + t * 1000);
        const at = (Date.now() - T0) / 1000;
        if (what === 'probe') { const p = await probe(); tl.push({ target: t, atSec: Number(at.toFixed(1)), pageRelSec: p.ts ? Number(((p.ts - T0d) / 1000).toFixed(1)) : null, ...p }); I(`D +${t} s (page +${tl[tl.length - 1].pageRelSec}): ${brief(p)}`); }
        else if (what === 'sensor') { rec.sensorAt5 = await sensors(); I(`D +5 s (control): ${fusionText(rec.sensorAt5)}; app registrations since T0: ${regStr(regsSince(rec.sensorAt5, T0d))}`); }
        else if (what === 'gfx0') rec.gfx0 = await frames();
        else if (what === 'gfx1') rec.gfx1 = await frames();
    }
    save('D-timeline.json', { T0Host: T0, T0Device: T0d, skew: clock.skew, probes: tl, frames: { at29s: rec.gfx0, at38s: rec.gfx1 }, sensorAt5: rec.sensorAt5 });
    const P = (t) => tl.find((x) => x.target === t);
    const ok = tl.every((x) => !x._error);
    if (!ok) { V(false, 'D: a probe failed, see D-timeline.json'); flush(); return 'done'; }
    const offT = tl.find((x) => !onToday(x));
    if (offT) return disturbed(`at +${offT.target} s Today was not what showed (app=${offT.app} vis=${offT.vis})`);
    V(Math.abs(P(25).drN) === 0 && P(25).drift !== true && !P(25).running.some((a) => a.startsWith('translate')), `D: before the idle (+25 s) dr is '${P(25).dr}' and nothing drifts (running: ${P(25).running.length})`);
    const t31 = P(31); const t33 = P(33); const t36 = P(36);
    const moving = t31.running.some((a) => a.startsWith('translate')) && t33.running.some((a) => a.startsWith('translate')) && Math.abs(t31.trN) > 0.05 && Math.abs(t31.trN) < 1.19 && Math.abs(t33.trN) >= Math.abs(t31.trN) && Math.abs(t33.trN) <= 1.21 && Math.abs(Math.abs(t31.drN) - 1.2) < 0.01;
    V(moving, `D: after the idle starts (+31 s, +33 s) a translate transition runs and the computed translate moves toward dr ${t31.dr}: ${t31.tr} -> ${t33.tr} -> ${t36.tr} at +36 s (running at +36: ${t36.running.length})`);
    V(Math.sign(t31.drN) !== 0 && Math.sign(t31.drN) === Math.sign(p0.sxN), `D: dr ${t31.dr} goes the way the light was leaning (sx ${p0.sx})`);
    if (S.fix === 'present') V(t31.drift === true && P(25).drift === false, `D: class is-drift: ${P(25).drift} at +25 s, ${t31.drift} at +31 s (from the idle's start only)`);
    const t40 = P(40);
    V(t40.running.length === 0 && Math.abs(t40.trN - t40.drN) < 0.01, `D: by +40 s no animation runs (${t40.running.length}) and the computed translate ${t40.tr} equals dr ${t40.dr}`);
    V(P(45).running.length === 0 && Math.abs(P(45).trN - P(45).drN) < 0.01, `D: still nothing at +45 s (running ${P(45).running.length}, translate ${P(45).tr})`);
    V(rec.gfx1 > rec.gfx0, `D control: frames the app drew over the drift window (+29.3 to +38 s): ${rec.gfx0} -> ${rec.gfx1} = ${rec.gfx1 - rec.gfx0} (must be > 0)`);
    V(!!rec.sensorAt5.fusion && rec.sensorAt5.fusion.state === 'enabled' && rec.sensorAt5.fusion.clients === 1, `D control: at about +5 s the sensor service says "${fusionText(rec.sensorAt5)}" (want enabled (1 clients))`);
    // the settled window
    const w0s = await waitSec(5, 30);
    await syncClock();
    const pS = await probe();
    I(`D settled: animations listed as running just before the 20 s window: ${pS._error ? pS._error : (pS.running.join('; ') || 'none')}`);
    const watch = await ev(WATCH_START);
    const fa = await frames(); const wStart = devNow();
    await sleep(20000);
    const fb = await frames(); const wEnd = devNow();
    const seen = await evJson(WATCH_STOP);
    const pEnd = await probe();
    const sEnd = await sensors();
    if (!onToday(pS) || !onToday(pEnd)) return disturbed(`in the settled window Today was not what showed (app=${pS.app} / ${pEnd.app})`);
    save('D-settled.json', { windowStartSecOfMinute: w0s, windowStartDev: hms(wStart), windowEndDev: hms(wEnd), framesBefore: fa, framesAfter: fb, observer: { started: watch.ok ? watch.value : watch.raw, ...seen }, probe: pEnd, sensors: sEnd, T0Device: T0d });
    const since = regsSince(sEnd, T0d).filter((r) => r.sensor.includes('Rotation'));
    I(`D settled: the app's registrations since T0: ${regStr(since)}; ${fusionText(sEnd)}`);
    const idleMinus = since.find((r) => r.sign === '-' && r.devMs >= T0d + 27000 - 999 && r.devMs <= T0d + 34000 + 999);
    const newest = since.length ? since[since.length - 1] : null;
    const inWindow = since.filter((r) => r.devMs >= wStart - 999 && r.devMs <= wEnd + 999 && r.devMs + 1000 > wStart);
    I(`D settled: window ${hms(wStart)} to ${hms(wEnd)} on the device clock; registrations inside it: ${regStr(inWindow.filter((r) => r.devMs >= wStart - 0))}`);
    await shot('today-rest.png');
    const top = seen._error ? seen._error : Object.entries(seen.by).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => `${n} x ${k}`).join('; ');
    I(`D settled: elements that changed in the window (observer): ${seen._error ? seen._error : `${seen.total} changes, ${seen.shine} of them in the glass light's layer`}${seen._error ? '' : `: ${top || 'none'}`}`);
    V(pEnd.running.length === 0 && !!sEnd.fusion && sEnd.fusion.state === 'disabled' && sEnd.fusion.clients === 0 && !!newest && newest.sign === '-' && !!idleMinus, `D settled: running animations ${pEnd.running.length}, "${fusionText(sEnd)}", newest registration ${newest ? newest.t + ' ' + newest.sign : 'none'}, the idle unregister ${idleMinus ? idleMinus.t + ' (T0 + ' + rel(idleMinus.devMs, T0d) + ' s)' : 'NOT FOUND near T0 + 30 s'}`);
    V(!seen._error && seen.shine === 0 && pEnd.sx === pS.sx && pEnd.sk === pS.sk && pEnd.dr === pS.dr && pEnd.tr === pS.tr, `D settled: the glass light did not change over the 20 s: ${seen._error ? seen._error : seen.shine} changes in its layer; sx ${pS.sx} -> ${pEnd.sx}, sk ${pS.sk} -> ${pEnd.sk}, dr ${pS.dr} -> ${pEnd.dr}, computed translate ${pS.tr} -> ${pEnd.tr}`);
    // frames: an animation or a frame loop draws about 60 a second (the drift window above is the control); single frames
    // come from the status bar and Today's data rows as the server pushes them, and are named by the observer
    V(fb - fa < 60, `D settled: frames the app drew over the 20 s: ${fa} -> ${fb} = ${fb - fa} (want under 60, that is under 3 a second: no animation or frame loop; a running one draws about 1200, the drift window drew ${rec.gfx1 - rec.gfx0} in 8.7 s)${fb - fa > 0 && !seen._error ? `; what changed on the page meanwhile: ${top || 'nothing seen'}` : ''}`);
    S.settled = true;
    S.settledProbe = pEnd;
    // the minute boundary while settled (the peek, rule #890)
    await waitSec(55, 57.5);
    await syncClock();
    const mA = await frames(); const mStart = devNow();
    const nextMin = Math.ceil((mStart - clock.dayStart) / 60000) * 60000 + clock.dayStart; // device ms of the coming :00
    await sleepUntil(hostOfDev(nextMin + 450));
    const sPeek = await sensors();
    await sleepUntil(hostOfDev(nextMin + 5000));
    const mB = await frames(); const sAfter = await sensors();
    const pAfter = await probe();
    const lines = regsSince(sAfter, mStart - 2000).filter((r) => r.sensor.includes('Rotation'));
    save('D-minute-boundary.json', { windowStartDev: hms(mStart), boundaryDev: hms(nextMin), framesBefore: mA, framesAfter: mB, sensorsAtBoundaryPlus045: sPeek, sensorsAfter: sAfter, probeAfter: pAfter });
    I(`D minute boundary (INFO, the peek of rule #890, expected): app registrations from ${hms(mStart)} past the boundary ${hms(nextMin)}: ${regStr(lines)} (expected one + at :00 and one - about 1 s later); at :00.45 the sensor service said "${fusionText(sPeek)}"; frames over the boundary (${hms(mStart)} to +5 s past it) ${mA} -> ${mB} = ${mB - mA}; after it: running animations ${pAfter.running.length}`);
    // the weather effect back on (its default): what it draws is #1109's, reported so the frames meter can be read
    const back = await restoreFx();
    await sleep(3000);
    const wA = await frames(); await sleep(10000); const wB = await frames();
    const pW = await probe();
    save('D-weather-on.json', { restored: back, framesBefore: wA, framesAfter: wB, probe: pW });
    I(`D weather back on (INFO, not the glass light): wmTodayFx ${back && !back._error ? JSON.stringify(back.ls) : 'restore failed'}; frames over 10 s ${wA} -> ${wB} = ${wB - wA}; running: ${pW._error ? pW._error : (pW.running.join('; ') || 'none')}; the light: sx ${pW.sx} dr ${pW.dr} drift ${pW.drift} (unchanged by the switch)`);
    flush();
    return 'done';
}

// ---------------------------------------------------------------- E
async function prepare(kind) { // kind: settled | leaned. Today shown with hold, +9 held.
    S.settled = false;
    await freshShow(HOLD);
    await touch();
    await setPose(poseFor(9));
    await sleep(SETTLE_S * 1000);
    let T = await touch();
    if (kind === 'settled') {
        await sleepUntil(T + 38500);
    }
    const p = await probe();
    return { p, T };
}
async function bringBack(how, devAction) {
    await setPose(HOLD); // the hold pose is read when Today is shown again
    if (how === 'start-app') await lane('start-app');
    else if (how === 'screen-on') { await lane('screen', 'on'); await sleep(800); await lane('start-app'); }
    else if (how === 'tap-x') { await lane('tap', '1026', '50'); }
    let p = null;
    for (let i = 0; i < 8; i++) { await sleep(1000); p = await probe(); if (!p._error && p.app === 'today' && p.vis === 'visible' && p.scr === null) break; }
    if (!onToday(p)) p = await waitToday(60000);
    await sleep(1500);
    const s = await sensors();
    const after = regsSince(s, devAction).filter((r) => r.sensor.includes('Rotation'));
    return { p, s, after };
}
async function hiddenCase(c) {
    say('');
    say(`E${c.n}. ${c.title}`);
    const st = c.state;
    let prep;
    if (st === 'settled' && S.settled && c.reuse) { prep = { p: await probe(), T: Date.now() }; info(`E${c.n}: starting from the settled state of step D`); }
    else prep = await prepare(st);
    // the start needs Today on screen in the wanted state; a dialog page that took its place (see step D) means: wait, prepare again
    for (let k = 0; k < 3 && !(onToday(prep.p) && (st === 'settled' ? Math.abs(prep.p.drN) > 1.1 : Math.abs(prep.p.sxN) >= 5)); k++) {
        info(`E${c.n}: the start state was not reached (${brief(prep.p)}); waiting for Today and preparing again`);
        await waitToday();
        prep = await prepare(st);
    }
    if (c.minute) { await waitSec(46, 50); }
    await syncClock();
    info(`E${c.n} state before the action (${st}): ${brief(prep.p)}`);
    if (st === 'settled') {
        // the light's own transition must be over; the weather effect's clouds (#1109) may be drifting on a Today that is seen
        const run = prep.p.running || [];
        const drifting = run.filter((a) => a.startsWith('translate'));
        const others = run.filter((a) => !a.startsWith('translate'));
        verdict(!prep.p._error && drifting.length === 0 && Math.abs(prep.p.drN) > 1.1 && Math.abs(prep.p.trN - prep.p.drN) < 0.01, `E${c.n}: the start is settled with the drift at its end (dr ${prep.p.dr}, computed translate ${prep.p.tr}, the light's transition running: ${drifting.length}${others.length ? `; other animations on the seen Today: ${others.join('; ')}` : ''})`);
    }
    else verdict(!prep.p._error && Math.abs(prep.p.sxN) >= 5, `E${c.n}: the start is in use and leaned (sx ${prep.p.sx})`);
    const sBefore = await sensors();
    const Ta0 = Date.now(); const Tad = Ta0 + clock.skew;
    const act = await c.action();
    info(`E${c.n}: action "${c.title}" at device clock ${hms(Tad)}${act ? ' ' + act : ''}`);
    const pr = [];
    // probe 1 is the first reading in which the page itself says Today is put away (hidden, the screen off, or another
    // program in front): Android takes a moment to switch, and until then Today is still what shows. From that reading on
    // nothing may run. The later times count from it.
    const away = (p) => !p._error && (p.vis !== 'visible' || p.app !== 'today' || p.scr !== null);
    let Th = Ta0; let stillShown = 0; let first = null;
    for (;;) {
        first = await probe();
        if (away(first) || Date.now() - Ta0 > 12000) break;
        stillShown++;
        await sleep(200);
    }
    Th = Date.now();
    first.label = 'probe 1'; first.atSec = Number(((Th - Ta0) / 1000).toFixed(1)); pr.push(first);
    info(`E${c.n} probe 1, the first reading with Today put away (+${first.atSec} s after the command; ${stillShown} earlier reading(s) still had Today on screen): ${brief(first)}`);
    const push = async (label, targetS) => { if (targetS !== null) await sleepUntil(Th + targetS * 1000); const p = await probe(); p.label = label; p.atSec = Number(((Date.now() - Ta0) / 1000).toFixed(1)); pr.push(p); info(`E${c.n} ${label} (+${p.atSec} s): ${brief(p)}`); return p; };
    await sleepUntil(Th + 1000); const g2 = await frames();
    await push('probe +3', 3);
    await sleepUntil(Th + 4000); await setPose(poseFor(-9)); info(`E${c.n}: lean set to -9 deg 4 s after probe 1`);
    await sleepUntil(Th + 8800); const g10 = await frames();
    await push('probe +9', 9);
    const sMid = await sensors();
    let extra = null;
    if (c.minute) {
        // hold across the minute boundary with the screen still off
        const nextMin = Math.ceil((devNow() - clock.dayStart) / 60000) * 60000 + clock.dayStart;
        await sleepUntil(hostOfDev(nextMin + 4000));
        extra = { probe: await push('probe past the minute', null), sensors: await sensors(), framesAtEnd: await frames() };
        info(`E${c.n}: the minute boundary was at ${hms(nextMin)}`);
    }
    const sEnd = extra ? extra.sensors : sMid;
    const saveObj = { actionDevice: hms(Tad), probes: pr, framesAt2: g2, framesAt10: g10, sensorsBefore: sBefore, sensorsMid: sMid, extra };
    const mine = regsSince(sEnd, Tad).filter((r) => r.sensor.includes('Rotation'));
    const actSod = Math.floor((Tad - clock.dayStart) / 1000);
    const sameSecond = mine.filter((r) => Math.floor((r.devMs - clock.dayStart) / 1000) === actSod && r.sign === '+');
    if (sameSecond.length) info(`E${c.n} (${st}): a + in the action's own second (${sameSecond.map((r) => r.t).join(', ')}) cannot be told from Chromium's re-registration just before the action (the log has whole seconds); judged by what stands after it`);
    const plus = mine.filter((r) => r.sign === '+' && Math.floor((r.devMs - clock.dayStart) / 1000) > actSod);
    const minus = mine.filter((r) => r.sign === '-');
    // checks
    const allQuiet = pr.every((p) => !p._error && p.running.length === 0);
    const expectedDefect = c.n === 1 && st === 'settled' && S.fix === 'absent';
    verdict(allQuiet, `E${c.n} (${st}): no animation runs at any probe (${pr.map((p) => p.label + ': ' + (p._error ? 'ERR' : p.running.length)).join(', ')})${allQuiet ? '' : ' running: ' + pr.filter((p) => p.running && p.running.length).map((p) => p.label + ' ' + p.running.join('; ')).join(' | ')}`, expectedDefect);
    verdict(away(first), `E${c.n} (${st}): the page says Today is put away (vis=${first.vis} app=${first.app} scr=${first.scr})`);
    const reset = pr.every((p) => !p._error && p.sxN === 0 && p.skN === 0 && p.drN === 0 && p.drift !== true);
    verdict(reset, `E${c.n} (${st}): every probe has sx 0px, sk 0deg or empty, dr 0%, no is-drift (${pr.map((p) => `${p.label}: sx ${p.sx || '-'} sk ${p.sk || '-'} dr ${p.dr || '-'} drift ${p.drift}`).join('; ')})`, expectedDefect);
    const noPlus = plus.length === 0;
    const lastWasMinus = st === 'leaned' ? minus.some((r) => r.devMs >= Tad - 1000 && r.devMs <= Tad + 4000) : true;
    const newestMinus = mine.length ? mine[mine.length - 1].sign === '-' : st !== 'leaned';
    verdict(noPlus && lastWasMinus && newestMinus && !!sEnd.fusion && sEnd.fusion.state === 'disabled' && sEnd.fusion.clients === 0, `E${c.n} (${st}): app registrations since the action: ${regStr(mine)}; no + ${noPlus ? 'ok' : 'FAILED'}${st === 'leaned' ? '; the unregister at the action ' + (lastWasMinus ? 'found' : 'NOT found') : '; nothing to unregister (the idle already did, 30 s earlier)'}; "${fusionText(sEnd)}"`);
    if (c.frames) verdict(g2 !== null && g10 !== null && g10 - g2 === 0, `E${c.n} (${st}): frames drawn by the app from 1 s to 9 s after probe 1: ${g2} -> ${g10} = ${g10 - g2} (want 0)`);
    else info(`E${c.n} (${st}): frames from 1 s to 9 s after probe 1: ${g2} -> ${g10} (Calculator is on screen, not required to be 0)`);
    if (c.minute) verdict(extra.sensors.regs.filter((r) => r.devMs >= Tad - 999 && r.sign === '+').length === 0, `E${c.n} (${st}): across the minute boundary with the screen off no registration appeared (no peek): ${regStr(regsSince(extra.sensors, Tad).filter((r) => r.sensor.includes('Rotation')))}`);
    // back
    const back = await bringBack(c.back, Tad);
    saveObj.back = { probe: back.p, sensors: back.s };
    save(`E${c.n}-${st}.json`, saveObj);
    const plusAfter = back.after.filter((r) => r.sign === '+' && r.devMs > Tad + 1000);
    verdict(plusAfter.length >= 1 && !!back.s.fusion && back.s.fusion.state === 'enabled' && back.s.fusion.clients === 1, `E${c.n} (${st}): with Today shown again the tilt listens again: registrations since the action ${regStr(back.after)}; "${fusionText(back.s)}"; page ${back.p && !back.p._error ? 'app=' + back.p.app : 'unreadable'}`);
    S.settled = false;
}
async function stepE() {
    say('');
    say('E. Nothing runs while Today is not what shows');
    // case 3 availability first
    const cases = [
        { n: 1, title: 'another Android program in front (Settings)', state: 'settled', reuse: true, frames: true, back: 'start-app', action: async () => { await lane('other'); } },
        { n: 1, title: 'another Android program in front (Settings), from the in-use leaned state', state: 'leaned', frames: true, back: 'start-app', action: async () => { await lane('other'); } },
        { n: 2, title: 'screen off', state: 'settled', frames: true, minute: true, back: 'screen-on', action: async () => { await lane('screen', 'off'); } },
        { n: 3, title: 'a Melaton program (Calculator) in front inside the page', state: 'settled', frames: false, back: 'tap-x', action: async () => {
            const r = await ev('(()=>{try{if(!window.wmShell||typeof window.wmShell.open!=="function")return "no wmShell.open";window.wmShell.open("calculator",{fromStart:true});return "opened"}catch(e){return "error: "+e}})()');
            await sleep(600);
            return `(wmShell.open answered ${r.ok ? r.value : r.raw})`;
        } },
    ];
    for (const c of cases) {
        if (c.n === 3) {
            const has = await ev('String(!!(window.wmShell&&typeof window.wmShell.open==="function"))');
            if (!has.ok || has.value !== 'true') { info('E3: wmShell.open is not there, case 3 skipped'); continue; }
        }
        await hiddenCase(c);
        if (c.n === 3) {
            const p = await probe();
            if (p.app !== 'today') { // the X did not close it: one more tap, then report
                await lane('tap', '1026', '50'); await sleep(1500);
                const q = await probe();
                info(`E3: Calculator closing: first tap left app=${p.app}, second tap app=${q.app}`);
            }
        }
    }
}

// ---------------------------------------------------------------- restore
let restored = false;
async function restore() {
    if (restored) return; restored = true;
    try {
        await setPose(DEFAULT_POSE);
        await lane('screen', 'on');
        const top = JSON.parse((await lane('status')).out || '{}').top || '';
        if (!top.startsWith(PKG)) await lane('start-app');
        await sleep(1500);
        if (LS_ORIG !== undefined) await restoreFx();
        // the default pose set, then one hide / show so Today's lean is measured from it
        await lane('other'); await sleep(2000); await lane('start-app'); await sleep(3000);
        const p = await probe();
        const fx = await evJson('JSON.stringify({ls:localStorage.getItem("wmTodayFx"),gl:document.documentElement.dataset.wmTiFx.includes("glasslight")})');
        info(`restore: default accelerometer pose, screen on, app in front: ${p._error ? p._error : 'app=' + p.app + ' vis=' + p.vis}; wmTodayFx ${JSON.stringify(fx.ls)} (was ${JSON.stringify(LS_ORIG)}), glasslight on: ${fx.gl}`);
    } catch (e) { say('INFO  restore error: ' + e.message); }
}
process.on('SIGINT', async () => { await restore(); process.exit(130); });
process.on('SIGTERM', async () => { await restore(); process.exit(143); });

(async () => {
    const st0 = JSON.parse((await lane('status')).out || '{}');
    if (!st0.serial) { console.error('no status for ' + ID); process.exit(2); }
    CONPORT = Number(String(st0.serial).replace('emulator-', ''));
    say(`StaticForge #1413 device acceptance, ${new Date().toString()}`);
    say(`instance ${ID}, console port ${CONPORT}, out ${OUT}, only ${ONLY ? [...ONLY].join(',') : 'all'}, install ${INSTALL}`);
    say('Lean on the emulator: a still sensor sends no deviceorientation events, so a pose holds its offset until the next one; on a real phone the resting hold re-centres within seconds (tiltBase follows at 1 % per reading), by design.');
    await syncClock();
    try {
        let pre = await stepA();
        setFix(pre);
        if (INSTALL) { const after = await stepAInstall(pre); pre = after || pre; }
        const ok = judgePre(pre);
        if (!ok) throw new Error('preconditions failed');
        if (want('B')) await stepB();
        if (want('C')) await stepC();
        if (want('D')) await stepD();
        if (want('E')) await stepE();
    } catch (e) {
        verdict(false, `the run stopped: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    } finally {
        await restore();
    }
    say('');
    say(`accept-1413 (fix=${S.fix}): ${nPass} PASS, ${nFail} FAIL, ${nExpected} FAIL (expected before the fix)`);
    process.exit(nFail ? 1 : 0);
})();
