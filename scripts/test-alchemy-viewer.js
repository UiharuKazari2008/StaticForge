#!/usr/bin/env node
'use strict';

/**
 * Alchemy viewer end to end (#990): a private grimoire-browser (own port, data dir, Xvfb, profile and PulseAudio,
 * never the live one) shows a local test page to the real viewer.html in a headless Chromium at 150 %, and checks
 *   - 1:1 pixels: the frame is the viewer canvas's device pixels and the page has the viewer's CSS size and ratio
 *   - input lands where it is shown (a click at a frame pixel reaches that CSS pixel)
 *   - scrolling moves the picture on the next display frames, ahead of the page, and settles on the page's offset
 *   - the fixed header is measured and kept still
 *   - sound: Opus packets reach the viewer's worklet player and it plays without running dry
 *
 *   node scripts/test-alchemy-viewer.js [--viewer <file>] [--relay | --relay=ndjson] [--mobile] [--keep]
 *
 * --mobile: Internet Explorer on the phone instead (mobile identity at ratio 2.625): CSS-sized frames, no scrolling
 * ahead of the page (the phone scrolls by touch), and the full-resolution still once the page settles.
 *
 * --relay: the viewer goes through Dreamscape's bridge (modules/grimoireBrowserBridge.js) in a throwaway Express app,
 * as clients do: its WebSocket relay, or with --relay=ndjson the NDJSON stream and input POSTs (no socket route).
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const SERVICE_DIR = path.join(__dirname, '..', 'services', 'grimoire-browser');
const puppeteer = require(path.join(SERVICE_DIR, 'node_modules', 'puppeteer-core'));

const args = process.argv.slice(2);
const viewerFile = args.includes('--viewer') ? path.resolve(args[args.indexOf('--viewer') + 1]) : '';
const keep = args.includes('--keep');
const mobile = args.includes('--mobile');
// --chrome <bin>: the Chromium the private Alchemy runs (an Alchemy build, #993); the viewer stays on CHROME_BIN
const serviceChrome = args.includes('--chrome') ? path.resolve(args[args.indexOf('--chrome') + 1]) : '';
let patched = false;
try { patched = !!serviceChrome && JSON.parse(fs.readFileSync(path.join(path.dirname(serviceChrome), 'alchemy-patches.json'), 'utf8')).features.includes('AlchemyEmulatedScaleCompositor'); } catch (_) {}
// --shots <dir>: the viewer's picture before, during and after the scroll, and scrolling back
const shotsDir = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : '';
async function shot(page, name) {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: path.join(shotsDir, name + '.png') });
}
const relayMode = args.includes('--relay=ndjson') ? 'ndjson' : (args.includes('--relay') ? 'websocket' : '');
const CHROME = process.env.CHROME_BIN || '/usr/lib/chromium/chromium';
// --ratio <r>: the viewer's pixel ratio (default 1.5). Chromium launches at 1.5 either way, so another ratio
// exercises the relaunch for a new default zoom before the first page (relaunchForZoom).
const ZOOM = args.includes('--ratio') ? Number(args[args.indexOf('--ratio') + 1]) : 1.5;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px sans-serif}
#bar{position:fixed;top:0;left:0;right:0;height:40px;background:#c33;color:#fff}
.row{height:200px;border-bottom:1px solid #000}
</style></head><body><div id="bar">header</div>
<script>
for (let i = 0; i < 40; i++) { const d = document.createElement('div'); d.className = 'row'; d.textContent = 'row ' + i; d.style.background = 'hsl(' + (i * 47 % 360) + ',60%,85%)'; document.body.appendChild(d); }
window.clicks = [];
addEventListener('click', (e) => {
  clicks.push([e.clientX, e.clientY]);
  if (window.tone) return;
  const ac = new AudioContext();
  window.tone = ac.createOscillator();
  tone.frequency.value = 440;
  tone.connect(ac.destination);
  tone.start();
  // moving picture while the tone plays, so frames and sound run side by side
  document.getElementById('bar').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(60px)' }], { duration: 600, iterations: Infinity, direction: 'alternate' });
});
</script></body></html>`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
    return new Promise((resolve) => {
        const srv = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

let failures = 0;
function check(label, ok, detail) {
    if (!ok) failures += 1;
    console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail ? '  ' + detail : ''));
}

async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    for (;;) {
        const value = await fn();
        if (value) return value;
        if (Date.now() > until) throw new Error('timed out: ' + label);
        await sleep(100);
    }
}

async function main() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alchemy-viewer-test-'));
    fs.mkdirSync(path.join(dataDir, 'ext'));
    fs.writeFileSync(path.join(dataDir, 'alchemy-display.json'), JSON.stringify({ zoom: 1.5 }));
    const token = crypto.randomBytes(24).toString('hex');
    const port = await freePort();
    const cdpPort = await freePort();
    const env = Object.assign({}, process.env, {
        PORT: String(port),
        HOST: '127.0.0.1',
        GRIMOIRE_BROWSER_TOKEN: token,
        ALCHEMY_DATA_DIR: dataDir,
        ALCHEMY_PROFILE_DIR: path.join(dataDir, 'profile'),
        ALCHEMY_EXTENSIONS_DIR: path.join(dataDir, 'ext'),
        ALCHEMY_CDP_PORT: String(cdpPort)
    });
    if (viewerFile) env.ALCHEMY_VIEWER_FILE = viewerFile;
    if (serviceChrome) env.CHROME_BIN = serviceChrome;
    else delete env.CHROME_BIN;
    const service = spawn(process.execPath, ['server.js'], { cwd: SERVICE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    service.stdout.on('data', (d) => { log += d; });
    service.stderr.on('data', (d) => { log += d; });
    const pageServer = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        // ?m=1: a phone page (width=device-width), as mobile sites are
        res.end(/[?&]m=1/.test(req.url) ? PAGE.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">') : PAGE);
    }).listen(0, '127.0.0.1');
    await new Promise((resolve) => pageServer.once('listening', resolve));
    const pageUrl = 'http://127.0.0.1:' + pageServer.address().port + '/' + (mobile ? '?m=1' : '');
    let viewerBrowser = null;
    let relayServer = null;
    try {
        await waitFor(() => /listening on/.test(log), 30000, 'service start');
        check('PulseAudio starts (no "audio off")', !/audio off/.test(log), (log.match(/audio off.*/) || [''])[0]);
        const origin = 'http://127.0.0.1:' + port;
        let viewOrigin = origin;
        let viewPrefix = '';
        if (relayMode) {
            // Dreamscape's side, as web_server.js mounts it, with a signed-in session
            process.env.GRIMOIRE_BROWSER_ORIGIN = origin;
            process.env.GRIMOIRE_BROWSER_TOKEN = token;
            const express = require('express');
            const bridge = require('../modules/grimoireBrowserBridge');
            const app = express();
            app.use(express.json());
            const signedIn = (req, res, next) => { req.session = { authenticated: true }; next(); };
            bridge.mountGrimoireBrowserBridge(app, signedIn);
            relayServer = http.createServer(app);
            if (relayMode === 'websocket') bridge.attachGrimoireBrowserUpgrade(relayServer, signedIn);
            else relayServer.on('upgrade', (req, socket) => socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'));
            await new Promise((resolve) => relayServer.listen(0, '127.0.0.1', resolve));
            viewOrigin = 'http://127.0.0.1:' + relayServer.address().port;
            viewPrefix = '/api/grimoire-browser';
        }
        const created = await fetch(origin + '/sessions', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify(mobile ? { url: pageUrl, width: 412, height: 780, viewKind: 'mobile', viewScale: 2.625 } : { url: pageUrl, width: 800, height: 600, pixelRatio: ZOOM })
        }).then((r) => r.json());
        if (mobile) {
            viewerBrowser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], defaultViewport: { width: 412, height: 780, deviceScaleFactor: 2.625 } });
            const phone = await viewerBrowser.newPage();
            await phone.goto(viewOrigin + viewPrefix + created.viewPath);
            // as wmBrowser.js does once the viewer is ready
            await waitFor(() => phone.evaluate(() => !!(window.__alchemyViewerStats && window.__alchemyViewerStats().frames)), 20000, 'phone frame');
            await phone.evaluate(() => window.postMessage({ type: 'grimoire-browser-scale', value: 2.625 }, '*'));
            const m = await waitFor(async () => {
                const s = await phone.evaluate(() => (window.__alchemyViewerStats ? window.__alchemyViewerStats() : null));
                // the Alchemy build's frames already have the phone's pixels: no still comes
                return s && s.frames > 0 && (patched ? s.frame.width > 412 : s.still) ? s : null;
            }, 20000, 'phone frame and still').catch(async (err) => { console.log(JSON.stringify(await phone.evaluate(() => window.__alchemyViewerStats()))); throw err; });
            // a finger tap (wmBrowser.js posts grimoire-browser-touch in the viewer's CSS pixels) lands where it is shown
            const alchemyPhone = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + cdpPort, defaultViewport: null });
            const remotePhone = (await alchemyPhone.pages()).find((p) => p.url() === pageUrl);
            await phone.evaluate(() => {
                window.postMessage({ type: 'grimoire-browser-touch', kind: 'start', x: 200, y: 300, t: Date.now() }, '*');
                setTimeout(() => window.postMessage({ type: 'grimoire-browser-touch', kind: 'end', x: 200, y: 300, t: Date.now(), tap: true }, '*'), 60);
            });
            await sleep(1200);
            const taps = await remotePhone.evaluate(() => window.clicks);
            check('a tap lands where it is shown', taps.length === 1 && Math.abs(taps[0][0] - 200) <= 2 && Math.abs(taps[0][1] - 300) <= 2, JSON.stringify(taps));
            alchemyPhone.disconnect();
            if (patched) {
                check('phone frames at device pixels (Alchemy build)', Math.abs(m.frame.width - Math.round(412 * 2.625)) <= 1 && m.frame.p === 0, m.frame.width + 'x' + m.frame.height + ' p=' + m.frame.p);
            } else {
                check('phone frames are CSS-sized, no scrolling ahead', m.frame.width === 412 && m.frame.p === 0, m.frame.width + 'x' + m.frame.height + ' p=' + m.frame.p);
                check('phone still at device pixels', m.still.width === Math.round(412 * 2.625), JSON.stringify(m.still));
            }
            return;
        }
        viewerBrowser = await puppeteer.launch({
            executablePath: CHROME,
            headless: true,
            args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
            defaultViewport: { width: 800, height: 600, deviceScaleFactor: ZOOM }
        });
        const viewer = await viewerBrowser.newPage();
        await viewer.goto(viewOrigin + viewPrefix + created.viewPath);
        const stats = () => viewer.evaluate(() => (window.__alchemyViewerStats ? window.__alchemyViewerStats() : null));
        const first = await waitFor(async () => {
            const s = await stats();
            return s && s.frames > 0 && s.frame.width === Math.round(800 * ZOOM) && s.canvas.width === s.frame.width && s.scroll.bandTop ? s : null;
        }, 20000, "first 1:1 frame").catch(async (err) => { console.log(JSON.stringify(await stats())); throw err; });
        check((relayMode || 'direct') + ' transport', first.transport === (relayMode === 'ndjson' ? 'ndjson' : 'websocket'), first.transport);
        check('frame = canvas device pixels (1:1)', first.frame.width === first.canvas.width && first.canvas.width === Math.round(first.canvas.cssWidth * ZOOM),
            first.frame.width + 'x' + first.frame.height + ' canvas ' + first.canvas.cssWidth + 'x' + first.canvas.cssHeight + ' css @' + first.canvas.dpr);
        check('fixed header measured', first.scroll.bandTop === 40, 'bandTop ' + first.scroll.bandTop);

        // the page as Alchemy runs it (the test instance's loopback CDP; no viewport of its own)
        const alchemy = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + cdpPort, defaultViewport: null });
        const remote = (await alchemy.pages()).find((p) => p.url() === pageUrl);
        const shape = await remote.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
        if (process.env.DEBUG) console.log('first', JSON.stringify(first), 'now', JSON.stringify(await stats()));
        check('page has the viewer\'s CSS size and ratio', shape.w === 800 && shape.h === 600 && shape.dpr === ZOOM, JSON.stringify(shape));

        // a click at CSS (400, 300) of the viewer is frame pixel (600, 450) and must reach the page's CSS (400, 300)
        await viewer.mouse.click(400, 300);
        await sleep(600);
        const clicks = await remote.evaluate(() => window.clicks);
        check('a click lands where it is shown', clicks.length === 1 && Math.abs(clicks[0][0] - 400) <= 1 && Math.abs(clicks[0][1] - 300) <= 1, JSON.stringify(clicks));

        // wheel: the picture moves before Alchemy could have answered
        await viewer.mouse.move(400, 300);
        await shot(viewer, '1-before');
        const t0 = Date.now();
        await viewer.mouse.wheel({ deltaY: 300 });
        const early = await viewer.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__alchemyViewerStats())))));
        const earlyMs = Date.now() - t0;
        await shot(viewer, '2-scrolling-ahead');
        check('picture scrolls at once', early.scroll.active && early.scroll.display > 5 && early.frame.sy < 1,
            'after ' + earlyMs + ' ms shown at ' + early.scroll.display.toFixed(1) + ' of target ' + early.scroll.target + ', frame still at ' + early.frame.sy);
        // the wheel's distance in the viewer's CSS pixels (DevTools' ratio emulation divides synthetic deltas by it)
        const wanted = early.scroll.target;
        const settled = await waitFor(async () => {
            const s = await stats();
            if (process.env.DEBUG) console.log(JSON.stringify(s.scroll), s.frame.sy);
            return s && !s.scroll.active && Math.abs(s.frame.sy - wanted) < 1 && Math.abs(s.scroll.display - s.frame.sy) < 0.5 ? s : null;
        }, 5000, 'scroll settles');
        const pageY = await remote.evaluate(() => scrollY);
        await shot(viewer, '3-settled');
        check('a wheel scrolls the page as far as the picture moved', Math.abs(pageY - wanted) < 1, 'scrollY ' + pageY + ' for ' + wanted + ', frame sy ' + settled.frame.sy);

        // scrolling back up into rows already seen: drawn from the cache, not filled
        await viewer.mouse.wheel({ deltaY: -200 });
        const back = await viewer.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(window.__alchemyViewerStats()))));
        await shot(viewer, '4-back-from-cache');
        // more than one screen: the rows above the view are kept as well as the ones in it
        check('cache holds the rows above', back.scroll.cacheRows > settled.frame.height, back.scroll.cacheRows + ' rows for a ' + settled.frame.height + ' row frame');
        await sleep(1500);

        // sound: the window in front asks for it; the remote tone started with the click above
        await viewer.evaluate(() => window.postMessage({ type: 'grimoire-browser-audio', on: true, volume: 1 }, '*'));
        await viewer.mouse.click(400, 300);
        await sleep(4000);
        const sound = await stats();
        const a = sound.audio || {};
        check('audio plays through the worklet', a.path === 'worklet' && a.state === 'running' && a.packets > 100,
            JSON.stringify(a));
        check('audio does not run dry', (a.underruns || 0) <= 1, 'underruns ' + a.underruns);
        alchemy.disconnect();
        check('audio delay follows the picture', a.videoDelayMs > 0 && a.targetMs >= Math.min(a.videoDelayMs, 600) - 15, 'target ' + a.targetMs + ' ms, picture ' + a.videoDelayMs + ' ms');
    } finally {
        if (process.env.DEBUG) console.log(log.split('\n').filter((l) => !/vulkan|libva|DEP0060|deprecation/i.test(l)).join('\n'));
        if (viewerBrowser) await viewerBrowser.close().catch(() => {});
        if (relayServer) relayServer.close();
        pageServer.close();
        service.kill('SIGTERM');
        await new Promise((resolve) => {
            const timer = setTimeout(() => { service.kill('SIGKILL'); resolve(); }, 10000);
            service.once('exit', () => { clearTimeout(timer); resolve(); });
        });
        if (keep) console.log('data dir kept:', dataDir);
        else fs.rmSync(dataDir, { recursive: true, force: true });
    }
}

process.on('exit', (code) => {
    if (!code) console.log(failures ? failures + ' failed' : 'all passed');
});

main().then(() => process.exit(failures ? 1 : 0), (err) => {
    console.error(err);
    process.exit(1);
});
