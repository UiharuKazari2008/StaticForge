#!/usr/bin/env node
'use strict';
// Rack Manager console harness (docs/rack-manager/README.md): serves this tree's public/ files plus a stub desktop page
// (/rack-harness.html: the app's own style sheets, window functions from modalUtils.js), a mocked window.wsClient that answers
// the rack_* packets (harness-mock.js: real host facts; iLO answers are read live, GET only, from 127.0.0.1:8790),
// and fake iLO console and terminal WebSockets. Used by test-rack-manager.js.
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { WebSocketServer } = require('ws');

const ROOT = path.join(__dirname, '..', '..');
const PUB = path.join(ROOT, 'public');

function png(w, h, paint) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
    }
    const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PHONE = png(360, 780, (x, y) => (y < 60 ? [30, 60, 120] : y > 720 ? [20, 20, 20] : (Math.floor(y / 90) % 2 ? [236, 240, 245] : [250, 250, 252])));
const SHOT = png(800, 600, (x, y) => (y < 20 ? [0, 0, 128] : [10, 10, 10]));

function boot() {
    // a fake POST / Linux console screen: 640x400, grey text-like blocks on black
    const W = 640;
    const H = 400;
    const rgb = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const row = Math.floor(y / 16);
        const on = y % 16 > 3 && y % 16 < 13 && ((x * 7 + row * 13) % 17) < 10 && x < 40 + (row * 37) % 500 && row < 22;
        const o = (y * W + x) * 3;
        rgb[o] = rgb[o + 1] = rgb[o + 2] = on ? 190 : 0;
    }
    return { W, H, rgb };
}

function makeApp(opts = {}) {
    const app = express();
    // read-only iLO proxy (GET only)
    app.get('/__ilo/*', (req, res) => {
        const p = req.params[0];
        http.get(`http://127.0.0.1:8790/api/${p}${req._parsedUrl.search || ''}`, (r) => { res.status(r.statusCode); res.set('content-type', 'application/json'); r.pipe(res); }).on('error', (e) => { res.status(502).json({ error: String(e.message) }); });
    });
    app.get('/rack/:server/files/shots/:file', (req, res) => { res.type('png').send(PHONE); });
    app.get('/rack/:server/ilo/screenshot.png', (req, res) => { res.type('png').send(SHOT); });
    app.get('/rack/:server/files/artifacts/:run/:name', (req, res) => { res.type('application/octet-stream').send(Buffer.from('apk')); });
    app.get('/favicon.ico', (req, res) => res.status(204).end());
    app.get('/__rack/harness-shims.js', (req, res) => res.sendFile(path.join(__dirname, 'harness-shims.js')));
    app.get('/__rack/harness-mock.js', (req, res) => res.sendFile(path.join(__dirname, 'harness-mock.js')));
    app.get('/rack-harness.html', (req, res) => {
        const html = fs.readFileSync(path.join(PUB, 'app.html'), 'utf8');
        const hrefs = [...new Set([...html.matchAll(/href="(\/css\/[^"]+\.css|\/dist\/fontawesome\/css\/[^"]+\.css)"/g)].map((m) => m[1]))].filter((h) => !/\/wm-|wm-|workspaces\.css/.test(h)).concat(['/css/taskbar-properties.css', '/css/vista-dialog-template.css', '/css/workspace-dialogs.css', '/css/mmc-console.css', '/css/mmc-frontgate.css', '/css/mmc-servermgr.css', '/css/mmc-rackmgr.css']);
        const extra = ['/scripts/vendor/xterm/xterm.css', '/css/themes/vista/console.css'];
        const scripts = ['contextMenu', 'melatonRegistry', 'modalUtils', 'confirmationDialog', 'vistaDialogs'];
        res.type('html').send(`<!doctype html><html data-theme="vista"><head><meta charset="utf-8"><title>Rack Manager harness</title>
${hrefs.concat(extra).map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
<style>html,body{margin:0;height:100%;overflow:hidden}body{background:#3a6ea5}</style></head>
<body class="theme-vista desktop-mode" data-harness="1"><div id="desktop"></div>
<script src="/__rack/harness-mock.js"></script>
<script src="/scripts/utils/deviceUtils.js"></script>
<script src="/scripts/comp/uiTheme.js"></script>
${scripts.map((s) => `<script src="/scripts/comp/${s}.js" onerror="window.__loadErrors=(window.__loadErrors||[]).concat('${s}')"></script>`).join('\n')}
<script src="/__rack/harness-shims.js"></script>
<script src="/scripts/comp/vistaDialogTemplates.js"></script>
<script src="/scripts/comp/vistaDialogTemplate.js"></script>
<script src="/scripts/vendor/xterm/xterm.js"></script><script src="/scripts/vendor/xterm/addon-fit.js"></script>
<script src="/scripts/comp/mmcConsole.js"></script>
${['mmcRackManager', 'mmcRackManagerIlo', 'mmcRackManagerHw', 'mmcRackManagerPower', 'mmcRackManagerLoad', 'mmcRackManagerRoles', 'mmcRackManagerRoles2', 'mmcRackManagerVmc', 'mmcRackManagerVm', 'mmcRackManagerVmSet'].map((s) => `<script src="/scripts/comp/${s}.js"></script>`).join('\n')}
</body></html>`);
    });
    app.use(express.static(PUB));
    return app;
}

function attachSockets(server) {
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        const u = new URL(req.url, 'http://x');
        wss.handleUpgrade(req, socket, head, (ws) => {
            if (/\/ilo\/ws$/.test(u.pathname)) ilo(ws);
            else if (/\/terminal\/ws$/.test(u.pathname)) term(ws, u);
            else ws.close();
        });
    });
}
function ilo(ws) {
    const { W, H, rgb } = boot();
    ws.send(JSON.stringify({ connecting: true }));
    setTimeout(() => {
        ws.send(JSON.stringify({ connected: true, power: true, health: 'green' }));
        const rs = Buffer.alloc(5); rs[0] = 1; rs.writeUInt16LE(W, 1); rs.writeUInt16LE(H, 3);
        ws.send(rs);
        const body = zlib.deflateRawSync(rgb);
        const hd = Buffer.alloc(9); hd[0] = 2; hd.writeUInt16LE(0, 1); hd.writeUInt16LE(0, 3); hd.writeUInt16LE(W, 5); hd.writeUInt16LE(H, 7);
        ws.send(Buffer.concat([hd, body]));
        ws.send(JSON.stringify({ post: '5808', postStage: 'Option ROMs (SATA, QLogic gPXE, iLO, Smart Array)', postPct: 62, postEta: 63, postElapsed: 101 }));
        ws.send(JSON.stringify({ text: 'Screen 640x400 - fake iLO console of the harness' }));
    }, 150);
    ws.on('message', (m) => { ws.__got = (ws.__got || []).concat(String(m)); });
}
function term(ws, u) {
    const cmd = u.searchParams.get('cmd');
    ws.send(`\x1b[32mhvadmin@fat-misaka\x1b[0m:\x1b[34m~\x1b[0m$ ${cmd ? `${cmd}\r\n[tmux: build-dsapp]\r\n` : ''}`);
    ws.on('message', (m) => { const s = String(m); if (s[0] === '\u0000') return; ws.send(s === '\r' ? '\r\n\x1b[32mhvadmin@fat-misaka\x1b[0m:\x1b[34m~\x1b[0m$ ' : s); });
}

function start(port = 0) {
    return new Promise((resolve) => {
        const server = http.createServer(makeApp());
        attachSockets(server);
        server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}
module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || 8801).then((s) => console.log(`harness on http://127.0.0.1:${s.port}/rack-harness.html`));
