#!/usr/bin/env node
/**
 * Dump novelai.net public assets via patched ResourcesSaverExt.
 *
 * Launches Chrome with the unpacked extension loaded, then drives it over CDP
 * using a tiny built-in WebSocket client — no Playwright, no bundled Chromium.
 *
 * Prefer Chrome for Testing (CHROME_BIN or .cache/chrome-for-testing). Branded
 * google-chrome-stable 151.0.7922.169 ignores --load-extension (dry-check
 * background_page is Hangouts; dump times out). CFT 152.0.7977.64 honors
 * --load-extension (ResourcesSaverExt id oamocmhnmfbafhblidnbibinconkgked).
 *
 * DUMP_HEADLESS=1 / --headless uses --headless=new and works when Chrome
 * honors --load-extension (CFT). xvfb headed (dump-novelai-webapp.sh default)
 * remains the fallback if CFT is missing. Containers: DUMP_CHROME_NO_SANDBOX=1.
 *
 * Usage:
 *   ./scripts/nai-webapp-watch/setup-dump-deps.sh --chrome-for-testing
 *   DUMP_HEADLESS=1 DUMP_CHROME_NO_SANDBOX=1 ./scripts/nai-webapp-watch/dump-novelai-webapp.sh
 *   node scripts/nai-webapp-watch/dump-novelai-webapp.js --out tmp/nai-webapp-dumps
 *   node scripts/nai-webapp-watch/dump-novelai-webapp.js --dry-check
 */

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_EXT = path.join(ROOT, 'tools', 'ResourcesSaverExt', 'unpacked2x');
const EXT_PATH = process.env.RESOURCES_SAVER_EXT_PATH
    ? path.resolve(process.env.RESOURCES_SAVER_EXT_PATH)
    : DEFAULT_EXT;
const DEFAULT_OUT = path.join(ROOT, 'tmp', 'nai-webapp-dumps');
const TARGET_URL = 'https://novelai.net/';

function parseArgs(argv) {
    const opts = {
        out: DEFAULT_OUT,
        url: TARGET_URL,
        timeoutMs: 120000,
        dryCheck: false,
        headless: process.env.DUMP_HEADLESS === '1' || process.env.DUMP_HEADLESS === 'true',
        port: Number(process.env.DUMP_CDP_PORT || 0) || 0,
        help: false
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--out' && argv[i + 1]) opts.out = path.resolve(argv[++i]);
        else if (arg === '--url' && argv[i + 1]) opts.url = argv[++i];
        else if (arg === '--timeout' && argv[i + 1]) opts.timeoutMs = Number(argv[++i]);
        else if (arg === '--port' && argv[i + 1]) opts.port = Number(argv[++i]);
        else if (arg === '--dry-check') opts.dryCheck = true;
        else if (arg === '--headless') opts.headless = true;
        else if (arg === '--headed') opts.headless = false;
        else if (arg === '--help' || arg === '-h') opts.help = true;
    }
    return opts;
}

const CFT_CACHE_DIRS = [
    process.env.DUMP_CFT_DIR ? path.resolve(process.env.DUMP_CFT_DIR) : null,
    path.join(ROOT, '.cache', 'chrome-for-testing'),
    path.join(ROOT, 'tools', 'chrome-for-testing')
].filter(Boolean);
const KNOWN_SAVER_EXT_ID = 'oamocmhnmfbafhblidnbibinconkgked';
const BRANDED_151_NOTE =
    'branded google-chrome-stable 151.0.7922.169 ignores --load-extension ' +
    '(dry-check background_page is Hangouts; dump times out). ' +
    'Chrome for Testing 152.0.7977.64 honors --load-extension ' +
    '(ResourcesSaverExt id ' + KNOWN_SAVER_EXT_ID + ').';

function cftInstallHint() {
    return 'Install Chrome for Testing: ./scripts/nai-webapp-watch/setup-dump-deps.sh --chrome-for-testing';
}

function collectChromeBins(dir, hits, depth, maxDepth) {
    if (depth > maxDepth) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of ents) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            collectChromeBins(p, hits, depth + 1, maxDepth);
            continue;
        }
        if (ent.name === 'chrome' || ent.name === 'chrome.exe' || ent.name === 'Google Chrome for Testing') {
            hits.push(p);
        }
    }
}

function findChromeForTesting() {
    const hits = [];
    for (const root of CFT_CACHE_DIRS) {
        if (fs.existsSync(root)) collectChromeBins(root, hits, 0, 6);
    }
    const preferred = hits.filter((bin) => {
        const id = chromeIdentity(bin);
        return id && id.forTesting;
    });
    return (preferred[0] || hits[0] || null);
}

function chromeIdentity(bin) {
    try {
        const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
        const out = String((r.stdout || '') + (r.stderr || '')).trim();
        const version = (out.match(/(\d+\.\d+\.\d+\.\d+)/) || [])[1] || null;
        const forTesting = /Chrome for Testing/i.test(out);
        const branded = /Google Chrome/i.test(out) && !forTesting;
        const major = version ? Number(version.split('.')[0]) : null;
        return { raw: out.split('\n')[0], version, major, forTesting, branded };
    } catch (_) {
        return { raw: null, version: null, major: null, forTesting: false, branded: false };
    }
}

function resolveChrome() {
    const explicit = process.env.CHROME_BIN;
    if (explicit && fs.existsSync(explicit)) {
        return { bin: explicit, source: 'CHROME_BIN', identity: chromeIdentity(explicit) };
    }
    const cft = findChromeForTesting();
    if (cft) {
        return { bin: cft, source: 'chrome-for-testing', identity: chromeIdentity(cft) };
    }
    const branded = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];
    for (const bin of branded) {
        if (fs.existsSync(bin)) {
            return { bin, source: 'branded', identity: chromeIdentity(bin) };
        }
    }
    return null;
}

function warnIfBranded(resolved) {
    if (!resolved) return;
    const id = resolved.identity || {};
    if (resolved.source === 'chrome-for-testing' || id.forTesting) return;
    console.error('[nai-webapp-dump] using branded Chrome:', resolved.bin, id.raw || '');
    console.error('[nai-webapp-dump]', BRANDED_151_NOTE);
    console.error('[nai-webapp-dump]', cftInstallHint());
    if (id.major === 151) {
        console.error('[nai-webapp-dump] this binary is Chrome 151 — expect --load-extension to be ignored');
    }
}

function analyzeExtensionTargets(list) {
    const ext = [];
    for (const t of list || []) {
        const url = String(t.url || '');
        if (!url.startsWith('chrome-extension://')) continue;
        const id = url.slice('chrome-extension://'.length).split('/')[0];
        ext.push({
            type: t.type,
            id,
            title: t.title || '',
            url
        });
    }
    const saver = ext.filter((e) =>
        e.id === KNOWN_SAVER_EXT_ID ||
        /save all resources/i.test(e.title) ||
        /resourcesaver/i.test(e.title)
    );
    const hangouts = ext.filter((e) => /hangouts/i.test(e.title) || /hangouts/i.test(e.url));
    // MV3 ResourcesSaverExt is a service_worker. Path-based IDs vary; SW + no Hangouts
    // is enough. Hangouts background_page is the branded-151 --load-extension failure.
    const serviceWorkers = ext.filter((e) => e.type === 'service_worker');
    const loaded = saver.length > 0 || (serviceWorkers.length > 0 && hangouts.length === 0);
    return {
        loaded,
        saver,
        hangouts,
        serviceWorkers,
        all: ext
    };
}

function failExtensionNotLoaded(resolved, analysis) {
    const id = (resolved && resolved.identity) || {};
    console.error('[nai-webapp-dump] ResourcesSaverExt did not load (--load-extension ignored or overlay missing)');
    if (analysis && analysis.hangouts.length) {
        console.error('[nai-webapp-dump] CDP targets show Hangouts, not ResourcesSaverExt — branded Chrome is ignoring --load-extension');
    }
    if (analysis && analysis.all.length) {
        console.error('[nai-webapp-dump] extension targets:', JSON.stringify(analysis.all));
    }
    console.error('[nai-webapp-dump]', BRANDED_151_NOTE);
    if (id.raw) console.error('[nai-webapp-dump] current binary:', resolved.bin, id.raw);
    console.error('[nai-webapp-dump]', cftInstallHint());
    console.error('[nai-webapp-dump] then: export CHROME_BIN=... && DUMP_HEADLESS=1 DUMP_CHROME_NO_SANDBOX=1 ./scripts/nai-webapp-watch/dump-novelai-webapp.sh');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close((err) => (err ? reject(err) : resolve(port)));
        });
        server.on('error', reject);
    });
}

function httpGetJson(url, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
                    return;
                }
                try { resolve(JSON.parse(body)); }
                catch (err) { reject(err); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout fetching ' + url));
        });
    });
}

async function waitForCdp(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < deadline) {
        try {
            const version = await httpGetJson('http://127.0.0.1:' + port + '/json/version');
            if (version && version.webSocketDebuggerUrl) return version;
        } catch (err) {
            lastErr = err;
        }
        await sleep(150);
    }
    throw new Error('CDP not ready on port ' + port + ': ' + (lastErr && lastErr.message ? lastErr.message : lastErr));
}

/** Minimal text-frame WebSocket client for CDP (no external deps). */
class SimpleWebSocket {
    constructor(url) {
        this.url = new URL(url);
        this.socket = null;
        this.buf = Buffer.alloc(0);
        this.openHandlers = [];
        this.messageHandlers = [];
        this.closeHandlers = [];
        this.errorHandlers = [];
        this._closed = false;
    }

    on(event, handler) {
        if (event === 'open') this.openHandlers.push(handler);
        else if (event === 'message') this.messageHandlers.push(handler);
        else if (event === 'close') this.closeHandlers.push(handler);
        else if (event === 'error') this.errorHandlers.push(handler);
    }

    connect() {
        return new Promise((resolve, reject) => {
            const key = crypto.randomBytes(16).toString('base64');
            const pathWithQuery = this.url.pathname + this.url.search;
            const socket = net.connect({
                host: this.url.hostname,
                port: Number(this.url.port) || 80
            });
            this.socket = socket;

            socket.once('connect', () => {
                socket.write(
                    'GET ' + pathWithQuery + ' HTTP/1.1\r\n' +
                    'Host: ' + this.url.host + '\r\n' +
                    'Upgrade: websocket\r\n' +
                    'Connection: Upgrade\r\n' +
                    'Sec-WebSocket-Key: ' + key + '\r\n' +
                    'Sec-WebSocket-Version: 13\r\n' +
                    '\r\n'
                );
            });

            let handshakeDone = false;
            socket.on('data', (chunk) => {
                this.buf = Buffer.concat([this.buf, chunk]);
                if (!handshakeDone) {
                    const idx = this.buf.indexOf('\r\n\r\n');
                    if (idx < 0) return;
                    const header = this.buf.slice(0, idx).toString('utf8');
                    this.buf = this.buf.slice(idx + 4);
                    handshakeDone = true;
                    if (!/^HTTP\/1\.1 101/i.test(header)) {
                        const err = new Error('WebSocket handshake failed: ' + header.split('\r\n')[0]);
                        this.errorHandlers.forEach((h) => h(err));
                        reject(err);
                        socket.destroy();
                        return;
                    }
                    this.openHandlers.forEach((h) => h());
                    resolve();
                    this._consumeFrames();
                    return;
                }
                this._consumeFrames();
            });
            socket.on('error', (err) => {
                this.errorHandlers.forEach((h) => h(err));
                if (!handshakeDone) reject(err);
            });
            socket.on('close', () => {
                this._closed = true;
                this.closeHandlers.forEach((h) => h());
            });
        });
    }

    _consumeFrames() {
        while (true) {
            if (this.buf.length < 2) return;
            const b0 = this.buf[0];
            const b1 = this.buf[1];
            const opcode = b0 & 0x0f;
            const masked = (b1 & 0x80) !== 0;
            let len = b1 & 0x7f;
            let offset = 2;
            if (len === 126) {
                if (this.buf.length < 4) return;
                len = this.buf.readUInt16BE(2);
                offset = 4;
            } else if (len === 127) {
                if (this.buf.length < 10) return;
                const big = this.buf.readUInt32BE(2);
                const low = this.buf.readUInt32BE(6);
                if (big !== 0) throw new Error('frame too large');
                len = low;
                offset = 10;
            }
            const maskLen = masked ? 4 : 0;
            if (this.buf.length < offset + maskLen + len) return;
            let payload = this.buf.slice(offset + maskLen, offset + maskLen + len);
            if (masked) {
                const mask = this.buf.slice(offset, offset + 4);
                payload = Buffer.from(payload);
                for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
            }
            this.buf = this.buf.slice(offset + maskLen + len);
            if (opcode === 0x8) { this.close(); return; }
            if (opcode === 0x9) { this._sendFrame(0xA, payload); continue; }
            if (opcode === 0x1 || opcode === 0x2) {
                const data = opcode === 0x1 ? payload.toString('utf8') : payload;
                this.messageHandlers.forEach((h) => h(data));
            }
        }
    }

    _sendFrame(opcode, data) {
        if (!this.socket || this._closed) return;
        const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        const mask = crypto.randomBytes(4);
        const len = payload.length;
        let header;
        if (len < 126) {
            header = Buffer.alloc(2);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | len;
        } else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 126;
            header.writeUInt16BE(len, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 127;
            header.writeUInt32BE(0, 2);
            header.writeUInt32BE(len, 6);
        }
        const maskedPayload = Buffer.from(payload);
        for (let i = 0; i < maskedPayload.length; i++) maskedPayload[i] ^= mask[i % 4];
        this.socket.write(Buffer.concat([header, mask, maskedPayload]));
    }

    send(data) { this._sendFrame(0x1, data); }

    close() {
        if (this._closed) return;
        this._closed = true;
        try { this._sendFrame(0x8, Buffer.alloc(0)); } catch (_) {}
        if (this.socket) this.socket.end();
    }
}

class CdpSession {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.nextId = 1;
        this.pending = new Map();
        this.eventHandlers = new Map();
    }

    async connect() {
        this.ws = new SimpleWebSocket(this.wsUrl);
        this.ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch (_) { return; }
            if (msg.id != null && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                else resolve(msg.result);
                return;
            }
            if (msg.method) {
                const handlers = this.eventHandlers.get(msg.method) || [];
                handlers.forEach((h) => h(msg.params || {}));
            }
        });
        await this.ws.connect();
    }

    on(method, handler) {
        if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, []);
        this.eventHandlers.get(method).push(handler);
    }

    send(method, params = {}, timeoutMs = 120000) {
        const id = this.nextId++;
        const payload = JSON.stringify({ id, method, params });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('CDP timeout: ' + method));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); }
            });
            this.ws.send(payload);
        });
    }

    close() { if (this.ws) this.ws.close(); }
}

function ensureExtension() {
    if (!fs.existsSync(EXT_PATH)) {
        console.error('[nai-webapp-dump] missing extension at', EXT_PATH);
        console.error('[nai-webapp-dump] run: ./scripts/nai-webapp-watch/setup-dump-deps.sh');
        console.error('[nai-webapp-dump] optional override: RESOURCES_SAVER_EXT_PATH=/path/to/unpacked2x');
        process.exit(1);
    }
    if (!fs.existsSync(path.join(EXT_PATH, 'automation-bridge.js'))) {
        console.error('[nai-webapp-dump] extension found but automation overlay missing');
        console.error('[nai-webapp-dump] re-run: ./scripts/nai-webapp-watch/setup-dump-deps.sh');
        process.exit(1);
    }
}

const FLAG_RDP = "--remote-debugging-port=";
const FLAG_RAO = "--remote-allow-origins=*";
const FLAG_LOAD_EXT = "--load-extension=";
const FLAG_DIS_EXT = "--disable-extensions-except=";
const FLAG_HEADLESS_NEW = "--headless=new";

function buildBrowserArgs(opts, port, profileDir) {
    const args = [
        FLAG_RDP + port,
        FLAG_RAO,
        '--user-data-dir=' + profileDir,
        FLAG_DIS_EXT + EXT_PATH,
        FLAG_LOAD_EXT + EXT_PATH,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-popup-blocking',
        '--disable-translate',
        '--metrics-recording-only',
        '--password-store=basic',
        '--use-mock-keychain',
        'about:blank'
    ];
    if (opts.headless) args.unshift(FLAG_HEADLESS_NEW);
    if (process.env.DUMP_CHROME_NO_SANDBOX === '1' || process.env.DUMP_CHROME_NO_SANDBOX === 'true') {
        args.push('--no-sandbox', '--disable-setuid-sandbox');
    }
    const extra = process.env.CHROME_EXTRA_ARGS;
    if (extra) args.push(...extra.split(/\s+/).filter(Boolean));
    return args;
}

async function launchBrowser(bin, args) {
    const child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('exit', (code, signal) => {
        child._exitInfo = { code, signal };
    });
    child._stderrBuf = () => stderr;
    return child;
}

async function stopBrowser(child) {
    if (!child || child._exitInfo) return;
    try { child.kill('SIGTERM'); } catch (_) {}
    const deadline = Date.now() + 5000;
    while (!child._exitInfo && Date.now() < deadline) await sleep(100);
    if (!child._exitInfo) {
        try { child.kill('SIGKILL'); } catch (_) {}
    }
}

async function pickPageTarget(port) {
    const list = await httpGetJson('http://127.0.0.1:' + port + '/json/list');
    const pages = (list || []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!pages.length) throw new Error('no page targets from CDP /json/list');
    return pages.find((t) => !String(t.url || '').startsWith('chrome-extension://')) || pages[0];
}

async function runDryCheck(opts) {
    ensureExtension();
    const resolved = resolveChrome();
    if (!resolved) {
        console.error('[nai-webapp-dump] Chrome not found. ' + cftInstallHint());
        console.error('[nai-webapp-dump] or set CHROME_BIN to Chrome for Testing');
        process.exit(1);
    }
    const chromeBin = resolved.bin;
    warnIfBranded(resolved);
    if (opts.headless && !(resolved.identity && resolved.identity.forTesting) && resolved.source !== 'chrome-for-testing') {
        console.error('[nai-webapp-dump] --headless=new only works when Chrome honors --load-extension (use CFT)');
    } else if (!opts.headless && !process.env.DISPLAY) {
        console.error('[nai-webapp-dump] WARNING: DISPLAY unset — use dump-novelai-webapp.sh (xvfb-run) or DUMP_HEADLESS=1 with CFT');
    }

    fs.mkdirSync(opts.out, { recursive: true });
    const profileDir = path.join(opts.out, '.chrome-profile-dry');
    fs.mkdirSync(profileDir, { recursive: true });
    const port = opts.port || await findFreePort();
    const args = buildBrowserArgs(opts, port, profileDir);
    console.log('[nai-webapp-dump] dry-check launching', chromeBin, '(' + resolved.source + ')');
    if (resolved.identity && resolved.identity.raw) console.log('[nai-webapp-dump]', resolved.identity.raw);
    console.log('[nai-webapp-dump] extension', EXT_PATH);
    console.log('[nai-webapp-dump] mode', opts.headless ? 'headless=new' : 'headed');

    const child = await launchBrowser(chromeBin, args);
    try {
        const version = await waitForCdp(port, 20000);
        await sleep(1500);
        const list = await httpGetJson('http://127.0.0.1:' + port + '/json/list');
        const types = {};
        for (const t of list || []) types[t.type] = (types[t.type] || 0) + 1;
        const analysis = analyzeExtensionTargets(list);
        const forTesting = !!(resolved.identity && resolved.identity.forTesting) || resolved.source === 'chrome-for-testing';
        const report = {
            ok: analysis.loaded,
            dryCheck: true,
            chromeBin,
            chromeSource: resolved.source,
            chromeForTesting: forTesting,
            chromeVersion: (resolved.identity && resolved.identity.version) || null,
            browser: version.Browser || version.browser || null,
            protocol: version['Protocol-Version'] || null,
            cdpPort: port,
            headless: !!opts.headless,
            noSandbox: process.env.DUMP_CHROME_NO_SANDBOX === '1' || process.env.DUMP_CHROME_NO_SANDBOX === 'true',
            display: process.env.DISPLAY || null,
            extensionPath: EXT_PATH,
            extensionLoaded: analysis.loaded,
            resourcesSaverTargets: analysis.saver,
            hangoutsTargets: analysis.hangouts,
            targetTypes: types,
            note: analysis.loaded
                ? (opts.headless
                    ? 'headless=new + extension loaded (CFT path)'
                    : 'headed Chrome + CDP + extension loaded (xvfb fallback is fine)')
                : BRANDED_151_NOTE + ' ' + cftInstallHint()
        };
        console.log('[nai-webapp-dump]', JSON.stringify(report));
        if (!analysis.loaded) {
            failExtensionNotLoaded(resolved, analysis);
            process.exitCode = 3;
        }
    } catch (err) {
        console.error('[nai-webapp-dump] dry-check failed:', err.message);
        if (child._stderrBuf) console.error(child._stderrBuf());
        process.exitCode = 1;
    } finally {
        await stopBrowser(child);
    }
}

async function runDump(opts) {
    ensureExtension();
    const resolved = resolveChrome();
    if (!resolved) {
        console.error('[nai-webapp-dump] Chrome not found. ' + cftInstallHint());
        console.error('[nai-webapp-dump] or set CHROME_BIN to Chrome for Testing');
        process.exit(1);
    }
    const chromeBin = resolved.bin;
    warnIfBranded(resolved);
    if (!opts.headless && !process.env.DISPLAY) {
        console.error('[nai-webapp-dump] DISPLAY unset — run via dump-novelai-webapp.sh (xvfb-run) or DUMP_HEADLESS=1 with CFT');
        process.exit(1);
    }
    console.log('[nai-webapp-dump] launching', chromeBin, '(' + resolved.source + ')', opts.headless ? 'headless=new' : 'headed');
    if (resolved.identity && resolved.identity.raw) console.log('[nai-webapp-dump]', resolved.identity.raw);

    fs.mkdirSync(opts.out, { recursive: true });
    const profileDir = path.join(opts.out, '.chrome-profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const port = opts.port || await findFreePort();
    const args = buildBrowserArgs(opts, port, profileDir);

    const child = await launchBrowser(chromeBin, args);
    let session;
    try {
        await waitForCdp(port, 20000);
        await sleep(1500);
        const list = await httpGetJson('http://127.0.0.1:' + port + '/json/list');
        const analysis = analyzeExtensionTargets(list);
        if (!analysis.loaded) {
            failExtensionNotLoaded(resolved, analysis);
            process.exitCode = 3;
            return;
        }
        const target = await pickPageTarget(port);
        session = new CdpSession(target.webSocketDebuggerUrl);
        await session.connect();

        await session.send('Page.enable');
        await session.send('Runtime.enable');
        try {
            await session.send('Browser.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: opts.out,
                eventsEnabled: true
            });
        } catch (_) {
            try {
                await session.send('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath: opts.out
                });
            } catch (err2) {
                console.error('[nai-webapp-dump] warning: could not set download behavior:', err2.message);
            }
        }

        let downloadFile = null;
        session.on('Browser.downloadWillBegin', (params) => {
            downloadFile = params.suggestedFilename || downloadFile;
        });

        const nav = await session.send('Page.navigate', { url: opts.url });
        if (nav && nav.errorText) throw new Error('navigate failed: ' + nav.errorText);

        await Promise.race([
            new Promise((resolve) => { session.on('Page.loadEventFired', resolve); }),
            sleep(Math.min(opts.timeoutMs, 60000))
        ]);
        await sleep(3000);

        const requestId = 'save-' + Date.now();
        const MSG_SAVE = "RESOURCES_SAVER_AUTOMATION_SAVE";
        const MSG_RESULT = "RESOURCES_SAVER_AUTOMATION_SAVE_RESULT";
        const pageTimeout = Math.max(1000, opts.timeoutMs - 5000);
        const expression = [
            'new Promise((resolve) => {',
            '  const rid = ' + JSON.stringify(requestId) + ';',
            '  const MSG_SAVE = ' + JSON.stringify(MSG_SAVE) + ';',
            '  const MSG_RESULT = ' + JSON.stringify(MSG_RESULT) + ';',
            '  function onMessage(event) {',
            '    if (event.source !== window) return;',
            '    const data = event.data;',
            '    if (!data || data.type !== MSG_RESULT) return;',
            '    if (data.requestId !== rid) return;',
            '    window.removeEventListener("message", onMessage);',
            '    resolve(data.response || { ok: false, error: "empty response" });',
            '  }',
            '  window.addEventListener("message", onMessage);',
            '  window.postMessage({ type: MSG_SAVE, requestId: rid }, "*");',
            '  setTimeout(() => {',
            '    window.removeEventListener("message", onMessage);',
            '    resolve({ ok: false, error: "extension timeout inside page" });',
            '  }, ' + pageTimeout + ');',
            '})'
        ].join('\n');

        const evalResult = await session.send('Runtime.evaluate', {
            awaitPromise: true,
            returnByValue: true,
            expression
        }, opts.timeoutMs);

        if (evalResult && evalResult.exceptionDetails) {
            throw new Error(evalResult.exceptionDetails.text || 'Runtime.evaluate failed');
        }
        const extensionResult = evalResult && evalResult.result ? evalResult.result.value : null;

        let savedPath = null;
        const suggested = (extensionResult && extensionResult.filename) || downloadFile;
        if (suggested) {
            const candidate = path.join(opts.out, suggested);
            const waitUntil = Date.now() + 15000;
            while (Date.now() < waitUntil) {
                if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
                    savedPath = candidate;
                    break;
                }
                await sleep(250);
            }
            if (!savedPath && fs.existsSync(candidate)) savedPath = candidate;
        }

        const report = {
            ok: !!(extensionResult && extensionResult.ok),
            url: opts.url,
            extensionResult,
            savedPath,
            outDir: opts.out,
            headless: !!opts.headless,
            chromeBin,
            chromeSource: resolved.source,
            chromeForTesting: !!(resolved.identity && resolved.identity.forTesting) || resolved.source === 'chrome-for-testing',
            note: 'Dump stays under tmp/ (gitignored). Never commit JWT/recaptcha captures. Prefer CFT + DUMP_HEADLESS=1; xvfb headed is the fallback if CFT is missing. Containers: DUMP_CHROME_NO_SANDBOX=1.'
        };
        console.log('[nai-webapp-dump]', JSON.stringify(report));
        if (!report.ok) process.exitCode = 2;
    } catch (err) {
        console.error('[nai-webapp-dump] fatal', err.message);
        if (child._stderrBuf) {
            const s = child._stderrBuf();
            if (s) console.error(s);
        }
        process.exitCode = 1;
    } finally {
        if (session) session.close();
        await stopBrowser(child);
    }
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        console.log('Usage: node scripts/nai-webapp-watch/dump-novelai-webapp.js [options]\n');
        console.log('Options:');
        console.log('  --out DIR       Output directory (default: tmp/nai-webapp-dumps)');
        console.log('  --url URL       Target URL (default: https://novelai.net/)');
        console.log('  --timeout MS    Overall timeout (default: 120000)');
        console.log('  --port N        CDP port (default: ephemeral)');
        console.log('  --dry-check     Launch browser+extension+CDP only; do not navigate/save');
        console.log('  --headless      Use --headless=new (works with Chrome for Testing)');
        console.log('  --headed        Force headed mode (xvfb fallback; dump-novelai-webapp.sh)');
        console.log('\nEnv:');
        console.log('  CHROME_BIN                 Chrome for Testing binary (preferred over branded)');
        console.log('  DUMP_HEADLESS=1            --headless=new (works when Chrome honors --load-extension)');
        console.log('  DUMP_CHROME_NO_SANDBOX=1   required in many containers');
        console.log('  DUMP_CFT_DIR, RESOURCES_SAVER_EXT_PATH, CHROME_EXTRA_ARGS, DUMP_CDP_PORT');
        console.log('\nInstall CFT: ./scripts/nai-webapp-watch/setup-dump-deps.sh --chrome-for-testing');
        console.log('xvfb headed remains the fallback if CFT is missing.');
        process.exit(0);
    }
    if (opts.dryCheck) await runDryCheck(opts);
    else await runDump(opts);
}

main().catch((err) => {
    console.error('[nai-webapp-dump] fatal', err.message);
    process.exit(1);
});
