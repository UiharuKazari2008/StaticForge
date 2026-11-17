'use strict';
// scripts/check-perf-rules.js finds what it should and leaves alone what it should (#890).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-rules-'));
const put = (rel, text) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
put('modules/websocket.js', "const DESKTOP_ONLY_TYPES = new Set(['desk_only']);\nconst PHONE_ONLY_TYPES = new Set([]);\nconst BROADCAST_ALL = new Set(['every_one']);\nconst DORMANT_HOLD = new Map([\n    ['ping', 'last'],\n]);\n");
put('public/scripts/comp/a.js', [
    '(function () {',
    "    setInterval(() => { el.innerHTML = AndroidApps.list(); wsClient.send({ type: 'x' }); }, 1000);",
    '    setInterval(() => { if (document.hidden) return; tick(); }, 1000);',
    "    setInterval(() => { if (document.documentElement.dataset.screenOff !== undefined) return; tick(); }, 1000);",
    '    // perf: allow the clock while it shows',
    '    setInterval(() => tick(), 1000);',
    '    function loop() { AndroidBars.size(); requestAnimationFrame(loop); }',
    '    requestAnimationFrame(loop);',
    '})();'
].join('\n'));
put('public/css/a.css', '.a { animation: spin 1s linear infinite; will-change: transform; }\n/* perf: allow */ .b { animation: x 1s infinite; }\n\n@keyframes glow { to { box-shadow: 0 0 9px red; } }\n@keyframes ok { to { transform: scale(2); opacity: 0; } }\n');
put('modules/route.js', [
    "app.get('/x', (req, res) => { const t = fs.readFileSync('a'); res.send(t); });",
    "const boot = fs.readFileSync('b');",
    "server.broadcast({ type: 'new_thing', data: 1 });",
    "server.broadcast({ type: 'every_one', data: 1 });",
    "server.broadcast({ type: 'ping', data: 1 });"
].join('\n'));

process.env.PERF_RULES_ROOT = dir;
const { scanFile } = require('./check-perf-rules.js');
const count = (f) => scanFile(f).reduce((m, h) => { m[h.rule] = (m[h.rule] || 0) + 1; return m; }, {});

// each requestAnimationFrame(loop) call site counts (the loop's own and the first call), plus the timer
const a = count('public/scripts/comp/a.js');
assert.deepStrictEqual(a, { 'ungated-timer': 1, 'polling-timer': 1, 'bridge-in-loop': 3, 'timer-html-rebuild': 1 }, JSON.stringify(a));
const css = count('public/css/a.css');
assert.deepStrictEqual(css, { 'infinite-animation': 1, 'will-change': 1, 'paint-keyframes': 1 }, JSON.stringify(css));
const srv = count('modules/route.js');
assert.deepStrictEqual(srv, { 'sync-io-in-handler': 1, 'unclassified-broadcast': 1 }, JSON.stringify(srv));

fs.rmSync(dir, { recursive: true, force: true });
console.log('check-perf-rules: ok');
