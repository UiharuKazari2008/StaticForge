#!/usr/bin/env node
'use strict';

/**
 * Grimoire remote browser.
 *
 * A separate process Dreamscape can point at (this host or another).
 * Grimoire iframes /view/:id, which we serve. Chromium renders the real
 * site. Frames come from CDP Page.startScreencast (what Puppeteer drives).
 * The target site is never iframed.
 *
 *   GRIMOIRE_BROWSER_TOKEN   required shared secret for session create/delete
 *   PORT                     default 9330
 *   HOST                     default 0.0.0.0
 *   CHROME_BIN               Chromium/Chrome binary (auto-detected if unset)
 *   FRAME_ANCESTORS          CSP frame-ancestors, default *
 *   CHROME_NO_SANDBOX        default 1 (set 0 to keep the sandbox)
 *   GRIMOIRE_BROWSER_IDLE_MS default 600000
 *   MAX_SESSIONS             default 4
 */

let sharp = null;
try {
    sharp = require('sharp');
    sharp.cache(false);
} catch (_) {
    sharp = null;
}

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const puppeteer = require('puppeteer-core');
const { WebSocketServer } = require('ws');

function blockPasskeys() {
    const deny = () => Promise.reject(new DOMException('Passkeys are not available in this browser.', 'NotAllowedError'));
    const proto = window.CredentialsContainer && CredentialsContainer.prototype;
    if (proto) {
        const wrap = (name) => {
            const native = proto[name];
            if (!native) return;
            proto[name] = function (options) {
                if (options && options.publicKey) return deny();
                return native.apply(this, arguments);
            };
        };
        wrap('get');
        wrap('create');
    }
    const unavailable = () => Promise.resolve(false);
    if (window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = unavailable;
        PublicKeyCredential.isConditionalMediationAvailable = unavailable;
    }
}

const PORT = Number(process.env.PORT || 9330);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_TOKEN = String(process.env.GRIMOIRE_BROWSER_TOKEN || '');
const FRAME_ANCESTORS = String(process.env.FRAME_ANCESTORS || '*').trim() || '*';
const IDLE_MS = Math.max(15000, Number(process.env.GRIMOIRE_BROWSER_IDLE_MS || 600000));
const MAX_SESSIONS = Math.max(1, Number(process.env.MAX_SESSIONS || 4));
const NO_SANDBOX = process.env.CHROME_NO_SANDBOX !== '0';
const JPEG_QUALITY = Math.min(90, Math.max(30, Number(process.env.GRIMOIRE_BROWSER_JPEG_QUALITY || 55)));

function viewerHtml() {
    return fs.readFileSync(path.join(__dirname, 'viewer.html'));
}

const sessions = new Map();
let browser = null;
let chromeBin = '';

function resolveChrome() {
    const explicit = process.env.CHROME_BIN || process.env.PUPPETEER_EXECUTABLE_PATH;
    if (explicit && fs.existsSync(explicit)) return explicit;

    const home = os.homedir();
    const found = [];

    function walk(dir, name) {
        if (!fs.existsSync(dir)) return;
        let entries = [];
        try { entries = fs.readdirSync(dir); } catch (_) { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry, name);
            if (fs.existsSync(full)) found.push(full);
        }
    }

    walk(path.join(home, '.cache', 'ms-playwright'), path.join('chrome-linux', 'chrome'));
    walk(path.join(home, '.cache', 'puppeteer', 'chrome'), path.join('chrome-linux64', 'chrome'));

    const branded = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];
    for (const bin of branded) {
        if (fs.existsSync(bin)) found.push(bin);
    }
    let best = '';
    let bestScore = -1;
    for (const bin of found) {
        let score = 0;
        try {
            const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
            const match = String((result.stdout || '') + (result.stderr || '')).match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
            if (match) {
                score = (Number(match[1]) * 1e9) + (Number(match[2]) * 1e6) + (Number(match[3]) * 1e3) + Number(match[4]);
            }
        } catch (_) {}
        if (score >= bestScore) {
            bestScore = score;
            best = bin;
        }
    }
    return best;
}

function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(payload)
    });
    res.end(payload);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 1_000_000) {
                reject(new Error('body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!chunks.length) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

function bearer(req) {
    const header = String(req.headers.authorization || '');
    if (header.startsWith('Bearer ')) return header.slice(7);
    return '';
}

function tokenEquals(given, expected) {
    const a = Buffer.from(String(given || ''));
    const b = Buffer.from(String(expected || ''));
    if (!b.length || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function adminOk(req) {
    return tokenEquals(bearer(req), ADMIN_TOKEN);
}

function normalizeWebUrl(value) {
    let raw = String(value || '').trim();
    if (!raw) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
    let parsed;
    try { parsed = new URL(raw); } catch (_) { return ''; }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'chrome:') {
        if (!parsed.hostname) return '';
        return parsed.href;
    }
    return '';
}

function safeFilename(name) {
    const base = path.basename(String(name || 'download')).replace(/[^\w.\- ()[\]]+/g, '_').replace(/^\.+/, '');
    if (!base || base === '.' || base === '..') return 'download';
    return base.slice(0, 180);
}

function headerSafe(value, fallback) {
    const clean = String(value || '').replace(/[\r\n]/g, '').slice(0, 240);
    return clean || fallback;
}

function filenameFromDisposition(header) {
    const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(String(header || ''));
    if (!match) return '';
    try {
        return safeFilename(decodeURIComponent(match[1] || match[2] || match[3] || ''));
    } catch (_) {
        return safeFilename(match[2] || match[3] || '');
    }
}

function filenameFromUrl(parsed) {
    if (!parsed || parsed.protocol === 'data:') return 'download';
    return safeFilename(parsed.pathname.split('/').pop() || 'download');
}

function noteDownload(session, id, filename, filePath) {
    if (!session || !filePath) return;
    let resolved;
    try { resolved = path.resolve(filePath); } catch (_) { return; }
    const root = path.resolve(session.downloadDir || '');
    if (!root || (resolved !== root && !resolved.startsWith(root + path.sep))) return;
    for (const item of session.downloads.values()) {
        if (item.filePath === resolved && item.state === 'completed') return;
    }
    const safeName = safeFilename(filename);
    session.downloads.set(String(id), { filename: safeName, state: 'completed', filePath: resolved });
    broadcast(session, { type: 'download', id: String(id), filename: safeName });
}

function armDownloads(session) {
    const dir = path.join(os.tmpdir(), 'grimoire-browser', session.id);
    fs.mkdirSync(dir, { recursive: true });
    session.downloadDir = dir;
    session.downloads = new Map();
    const onBegin = (ev) => {
        if (!ev || !ev.guid) return;
        session.downloads.set(ev.guid, {
            filename: safeFilename(ev.suggestedFilename || 'download'),
            state: 'progress',
            filePath: ''
        });
    };
    const onProgress = (ev) => {
        if (!ev || !ev.guid || ev.state !== 'completed') return;
        const item = session.downloads.get(ev.guid);
        const filename = (item && item.filename) || 'download';
        const filePath = ev.filePath || path.join(dir, filename);
        noteDownload(session, ev.guid, filename, filePath);
    };
    session.cdp.on('Page.downloadWillBegin', onBegin);
    session.cdp.on('Page.downloadProgress', onProgress);
    session.cdp.on('Browser.downloadWillBegin', onBegin);
    session.cdp.on('Browser.downloadProgress', onProgress);
    session.cdp.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: dir
    }).catch(() => {});
    try {
        session.downloadWatch = fs.watch(dir, (_event, filename) => {
            if (!filename || filename.endsWith('.crdownload') || filename.endsWith('.tmp')) return;
            const filePath = path.join(dir, filename);
            fs.stat(filePath, (err, stat) => {
                if (err || !stat.isFile() || stat.size <= 0) return;
                noteDownload(session, crypto.randomBytes(8).toString('hex'), filename, filePath);
            });
        });
    } catch (_) {}
}

async function selectDraggedText(page, from, to) {
    if (!from || Math.hypot(to.x - from.x, to.y - from.y) < 3) return;
    try {
        await page.evaluate((x1, y1, x2, y2) => {
            const skip = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1 };
            const nearest = (x, y) => {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let best = null;
                let bestDist = Infinity;
                let node;
                while ((node = walker.nextNode())) {
                    const parent = node.parentElement;
                    const text = node.textContent || '';
                    if (!parent || !text || skip[parent.tagName]) continue;
                    const box = parent.getBoundingClientRect();
                    if (y < box.top - 48 || y > box.bottom + 48) continue;
                    if (x < box.left - 120 || x > box.right + 120) continue;
                    const step = text.length > 240 ? 4 : 1;
                    for (let i = 0; i <= text.length; i += step) {
                        const probe = document.createRange();
                        const next = Math.min(text.length, i + 1);
                        probe.setStart(node, i);
                        probe.setEnd(node, next === i ? text.length : next);
                        const rect = probe.getBoundingClientRect();
                        if (!rect.width && !rect.height) continue;
                        const cx = i >= text.length ? rect.right : rect.left;
                        const cy = rect.top + rect.height / 2;
                        const dist = (cx - x) * (cx - x) + (cy - y) * (cy - y);
                        if (dist < bestDist) {
                            bestDist = dist;
                            best = { node: node, offset: i };
                        }
                    }
                }
                return best;
            };
            const start = nearest(x1, y1);
            const end = nearest(x2, y2);
            if (!start || !end) return 'no-caret';
            const range = document.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
            if (range.collapsed) {
                range.setStart(end.node, end.offset);
                range.setEnd(start.node, start.offset);
            }
            const sel = window.getSelection();
            if (!sel) return 'no-selection';
            sel.removeAllRanges();
            sel.addRange(range);
        }, from.x, from.y, to.x, to.y);
    } catch (_) {}
}

async function readSelection(page) {
    return page.evaluate(() => {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            const start = active.selectionStart;
            const end = active.selectionEnd;
            if (typeof start === 'number' && typeof end === 'number' && end > start) {
                return String(active.value || '').slice(start, end);
            }
        }
        const sel = window.getSelection();
        return sel ? String(sel) : '';
    });
}

async function readPageResource(session, targetUrl) {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (_) {
        const error = new Error('bad url');
        error.status = 400;
        throw error;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'data:') {
        const error = new Error('unsupported url');
        error.status = 400;
        throw error;
    }
    const result = await session.page.evaluate(async (href) => {
        const res = await fetch(href, { credentials: 'include' });
        if (!res.ok) return { error: 'fetch ' + res.status };
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 20 * 1024 * 1024) return { error: 'too large' };
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return {
            type: res.headers.get('content-type') || 'application/octet-stream',
            disposition: res.headers.get('content-disposition') || '',
            data: btoa(binary)
        };
    }, targetUrl);
    if (!result || result.error || !result.data) {
        const error = new Error((result && result.error) || 'fetch failed');
        error.status = 502;
        throw error;
    }
    return {
        type: headerSafe(String(result.type || '').split(';')[0], 'application/octet-stream'),
        buffer: Buffer.from(result.data, 'base64'),
        filename: filenameFromDisposition(result.disposition) || filenameFromUrl(parsed)
    };
}

function clampSize(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function broadcast(session, payload, binary) {
    const data = binary ? payload : JSON.stringify(payload);
    for (const ws of session.sockets) {
        if (ws.readyState === 1) ws.send(data);
    }
}

function publishLocation(session) {
    let current = '';
    try { current = session.page.url(); } catch (_) {}
    if (/^(https?:|chrome:)/i.test(current)) session.url = current;
    broadcast(session, {
        type: session.navigating ? 'navigating' : 'location',
        url: session.url || '',
        title: session.title || '',
        navigating: !!session.navigating
    });
}

function socketsCongested(session) {
    for (const ws of session.sockets) {
        if (ws.readyState === 1 && ws.bufferedAmount > 256 * 1024) return true;
    }
    return false;
}

function noteClientRtt(session, ms) {
    const sample = Math.max(1, Math.min(Number(ms) || 0, 5000));
    if (!sample) return;
    session.rttMs = sample;
}

function frameIntervalMs(session) {
    const rtt = session.rttMs || 50;
    // 33ms is about 30 fps. 100ms is the slowest capture, about 10 fps.
    return Math.max(33, Math.min(Math.round(rtt), 100));
}

function armFrameTimer(session) {
    if (session.frameTimer) return;
    const wait = Math.max(0, (session.nextFrameAt || 0) - Date.now());
    session.frameTimer = setTimeout(() => {
        session.frameTimer = null;
        pumpFrames(session);
    }, wait);
}

function releaseFramePace(session) {
    session.paceNow = true;
    session.nextFrameAt = 0;
    if (session.frameTimer) {
        clearTimeout(session.frameTimer);
        session.frameTimer = null;
    }
    pumpFrames(session);
}

const REGION_TILE = 128;

function rectChanged(prev, next, stride, rect) {
    const rowBytes = rect.w * 4;
    for (let row = 0; row < rect.h; row++) {
        const start = ((rect.y + row) * stride + rect.x) * 4;
        for (let i = 0; i < rowBytes; i++) {
            if (prev[start + i] !== next[start + i]) return true;
        }
    }
    return false;
}

function dirtyRects(prev, next, width, height) {
    const rects = [];
    for (let y = 0; y < height; y += REGION_TILE) {
        const th = Math.min(REGION_TILE, height - y);
        let runX = -1;
        let runW = 0;
        for (let x = 0; x < width; x += REGION_TILE) {
            const tw = Math.min(REGION_TILE, width - x);
            if (rectChanged(prev, next, width, { x, y, w: tw, h: th })) {
                if (runX < 0) runX = x;
                runW = x + tw - runX;
            } else if (runX >= 0) {
                rects.push({ x: runX, y, w: runW, h: th });
                runX = -1;
                runW = 0;
            }
        }
        if (runX >= 0) rects.push({ x: runX, y, w: runW, h: th });
    }
    return rects;
}

function cropRGBA(src, stride, rect) {
    const out = Buffer.allocUnsafe(rect.w * rect.h * 4);
    const rowBytes = rect.w * 4;
    for (let row = 0; row < rect.h; row++) {
        const start = ((rect.y + row) * stride + rect.x) * 4;
        src.copy(out, row * rowBytes, start, start + rowBytes);
    }
    return out;
}

async function packFrame(session, jpeg, gen) {
    if (!sharp) return { binary: jpeg };
    const stale = () => gen != null && session.packGen !== gen;
    let decoded;
    try {
        decoded = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch (_) {
        return { binary: jpeg };
    }
    if (stale()) return { stale: true };
    const width = decoded.info.width;
    const height = decoded.info.height;
    const next = decoded.data;
    const prev = session.pixels;
    const sameSize = prev && session.pixelWidth === width && session.pixelHeight === height && prev.length === next.length;
    session.pixels = next;
    session.pixelWidth = width;
    session.pixelHeight = height;
    if (!sameSize) return { binary: jpeg };
    const rects = dirtyRects(prev, next, width, height);
    if (!rects.length) return { skip: true };
    let area = 0;
    for (const rect of rects) area += rect.w * rect.h;
    if (area > width * height * 0.4 || rects.length > 18) return { binary: jpeg };
    const regions = [];
    let total = 0;
    for (const rect of rects) {
        const encoded = await sharp(cropRGBA(next, width, rect), {
            raw: { width: rect.w, height: rect.h, channels: 4 }
        }).jpeg({ quality: 78 }).toBuffer();
        if (stale()) return { stale: true };
        total += encoded.length;
        if (total > jpeg.length * 0.7) return { binary: jpeg };
        regions.push({
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            data: encoded.toString('base64')
        });
    }
    if (stale()) return { stale: true };
    return { json: { type: 'regions', width, height, rects: regions } };
}

function schedulePump(session) {
    if (!sessions.get(session.id)) return;
    session.nextFrameAt = session.paceNow ? 0 : Date.now() + frameIntervalMs(session);
    if (!(session.paceNow || session.latestFrame || session.pendingAck != null)) return;
    if (session.paceNow || Date.now() >= session.nextFrameAt) pumpFrames(session);
    else armFrameTimer(session);
}

function pumpFrames(session) {
    if (!sessions.get(session.id)) return;
    if (!session.latestFrame && session.pendingAck == null) return;
    const now = Date.now();
    if (!session.paceNow && session.nextFrameAt && now < session.nextFrameAt) {
        armFrameTimer(session);
        return;
    }
    if (!session.paceNow && session.sockets.size && socketsCongested(session)) {
        session.latestFrame = null;
    }
    const frame = session.latestFrame;
    session.latestFrame = null;
    const ack = session.pendingAck;
    session.pendingAck = null;
    session.paceNow = false;
    if (ack != null) session.cdp.send('Page.screencastFrameAck', { sessionId: ack }).catch(() => {});
    if (!frame) {
        schedulePump(session);
        return;
    }
    session.painted = frame;
    if (session.framePump) {
        broadcast(session, frame, true);
        session.packGen = (session.packGen || 0) + 1;
        session.pixels = null;
        schedulePump(session);
        return;
    }
    const gen = (session.packGen = (session.packGen || 0) + 1);
    session.framePump = true;
    let settled = false;
    const budget = setTimeout(() => {
        if (settled || !sessions.get(session.id)) return;
        settled = true;
        session.framePump = false;
        if (session.packGen === gen) {
            session.packGen += 1;
            session.pixels = null;
        }
        broadcast(session, frame, true);
        schedulePump(session);
    }, 40);
    packFrame(session, frame, gen).then((packed) => {
        if (settled || !sessions.get(session.id)) return;
        settled = true;
        clearTimeout(budget);
        session.framePump = false;
        if (packed && packed.stale) broadcast(session, frame, true);
        else if (packed && packed.binary) broadcast(session, packed.binary, true);
        else if (packed && packed.json) broadcast(session, packed.json);
        else if (!(packed && packed.skip)) broadcast(session, frame, true);
        schedulePump(session);
    }).catch(() => {
        if (settled || !sessions.get(session.id)) return;
        settled = true;
        clearTimeout(budget);
        session.framePump = false;
        broadcast(session, frame, true);
        schedulePump(session);
    });
}

function noteScreencastFrame(session, event) {
    session.pendingAck = event.sessionId;
    if (event.data) session.latestFrame = Buffer.from(event.data, 'base64');
    pumpFrames(session);
}

function beginNavigating(session, resetTimer) {
    session.navigating = true;
    if (resetTimer || !session.navSettle) {
        clearTimeout(session.navSettle);
        session.navSettle = setTimeout(() => endNavigating(session), 4000);
    }
    broadcast(session, {
        type: 'navigating',
        url: session.url || '',
        title: session.title || '',
        navigating: true
    });
}

function endNavigating(session) {
    if (!sessions.get(session.id)) return;
    clearTimeout(session.navSettle);
    session.navSettle = null;
    session.navigating = false;
    publishLocation(session);
}

function markHealth(session, state) {
    if (!sessions.get(session.id) || session.health === state) return;
    session.health = state;
    broadcast(session, { type: 'status', state, url: session.url || '' });
}

function armHealth(session) {
    clearTimeout(session.healthTimer);
    session.healthTimer = setTimeout(() => probeHealth(session), 2000);
}

async function probeHealth(session) {
    if (!sessions.get(session.id)) return;
    if (session.navigating) {
        armHealth(session);
        return;
    }
    try {
        await Promise.race([
            session.cdp.send('Runtime.evaluate', {
                expression: '1',
                returnByValue: true,
                timeout: 1500
            }),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('unresponsive')), 1800);
            })
        ]);
        session.healthMisses = 0;
        markHealth(session, 'ok');
    } catch (err) {
        const message = (err && err.message) || '';
        if (/crash|detached|closed|Target closed|Session closed/i.test(message)) {
            markHealth(session, 'failed');
        } else {
            session.healthMisses = (session.healthMisses || 0) + 1;
            if (session.healthMisses >= 2) markHealth(session, 'unresponsive');
        }
    }
    if (sessions.get(session.id)) armHealth(session);
}

function holdPopup(session, popup) {
    let settled = false;
    const finish = (url) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const next = normalizeWebUrl(url);
        if (next && sessions.get(session.id)) broadcast(session, { type: 'popup', url: next });
        popup.close().catch(() => {});
    };
    const timer = setTimeout(() => finish(''), 4000);
    const current = popup.url();
    if (normalizeWebUrl(current)) {
        finish(current);
        return;
    }
    popup.on('framenavigated', (frame) => {
        try {
            if (frame === popup.mainFrame()) finish(frame.url());
        } catch (_) {}
    });
    popup.once('close', () => {
        settled = true;
        clearTimeout(timer);
    });
}

async function pressClickModifiers(page, msg) {
    const keys = [];
    if (msg.ctrl || msg.meta) keys.push('Control');
    if (msg.shift) keys.push('Shift');
    if (msg.alt) keys.push('Alt');
    for (const key of keys) await page.keyboard.down(key).catch(() => {});
    return keys;
}

async function releaseClickModifiers(page, keys) {
    const list = keys || [];
    for (let i = list.length - 1; i >= 0; i--) await page.keyboard.up(list[i]).catch(() => {});
}

async function followChromeLink(session, x, y) {
    let pageUrl = '';
    try { pageUrl = session.page.url(); } catch (_) {}
    if (!/^chrome:/i.test(pageUrl)) return;
    let href = '';
    try {
        href = await session.page.evaluate((px, py) => {
            let el = document.elementFromPoint(px, py);
            const seen = new Set();
            while (el && !seen.has(el)) {
                seen.add(el);
                if (el.tagName === 'A') {
                    const abs = el.href || '';
                    if (abs) return abs;
                }
                const attr = el.getAttribute && el.getAttribute('href');
                if (attr && /^chrome:/i.test(attr)) return attr;
                if (el.parentElement) el = el.parentElement;
                else {
                    const root = el.getRootNode && el.getRootNode();
                    el = root && root.host ? root.host : null;
                }
            }
            return '';
        }, x, y);
    } catch (_) {
        return;
    }
    const next = normalizeWebUrl(href);
    if (!next || next === pageUrl) return;
    requestNavigate(session, next, false);
}

function requestNavigate(session, url, reload) {
    const gen = ++session.navGen;
    session.dragFrom = null;
    if (!reload) session.url = url;
    beginNavigating(session, true);
    session.pendingNav = { gen, url, reload: !!reload };
    session.pixels = null;
    releaseFramePace(session);
    session.cdp.send('Page.stopLoading').catch(() => {});
    if (!session.navRunning) {
        session.navRunning = true;
        pumpNav(session);
    }
}

async function pumpNav(session) {
    while (session.pendingNav && sessions.get(session.id)) {
        const job = session.pendingNav;
        session.pendingNav = null;
        if (job.gen !== session.navGen) continue;
        try {
            await session.cdp.send('Page.stopLoading').catch(() => {});
            if (job.gen !== session.navGen) continue;
            const result = job.reload
                ? await session.cdp.send('Page.reload')
                : await session.cdp.send('Page.navigate', { url: job.url });
            if (result && result.errorText) {
                throw new Error(result.errorText);
            }
        } catch (err) {
            if (job.gen !== session.navGen || session.pendingNav) continue;
            const message = (err && err.message) || 'navigation failed';
            console.error('[grimoire-browser] navigate', message);
            if (/ERR_ABORTED/i.test(message)) continue;
            session.navigating = false;
            clearTimeout(session.navSettle);
            session.navSettle = null;
            broadcast(session, { type: 'error', message });
            publishLocation(session);
            continue;
        }
        if (job.gen !== session.navGen || !sessions.get(session.id)) continue;
        try { session.title = await session.page.title(); } catch (_) {}
        publishLocation(session);
    }
    session.navRunning = false;
    if (session.pendingNav && sessions.get(session.id)) {
        session.navRunning = true;
        pumpNav(session);
    }
}

function touch(session) {
    session.idleAt = Date.now() + IDLE_MS;
}

async function closeSession(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    clearTimeout(session.navSettle);
    session.navSettle = null;
    clearTimeout(session.frameTimer);
    session.frameTimer = null;
    clearTimeout(session.healthTimer);
    session.healthTimer = null;
    session.closing = true;
    for (const ws of session.sockets) {
        try { ws.close(1000, 'closed'); } catch (_) {}
    }
    session.sockets.clear();
    try {
        if (session.cdp) await session.cdp.send('Page.stopScreencast').catch(() => {});
    } catch (_) {}
    try {
        if (session.downloadWatch) session.downloadWatch.close();
    } catch (_) {}
    if (session.downloadDir) {
        fs.rm(session.downloadDir, { recursive: true, force: true }, () => {});
    }
    try {
        if (session.page) await session.page.close();
    } catch (_) {}
}

async function ensureBrowser() {
    if (browser && browser.connected) return browser;
    if (!chromeBin) throw new Error('Chrome binary not found. Set CHROME_BIN.');
    const args = [
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-features=WebAuthentication,WebAuthnConditionalUI',
        '--disable-background-networking',
        '--disable-sync',
        '--mute-audio',
        '--disable-popup-blocking'
    ];
    if (NO_SANDBOX) args.push('--no-sandbox', '--disable-setuid-sandbox');
    browser = await puppeteer.launch({
        executablePath: chromeBin,
        headless: true,
        pipe: true,
        args
    });
    browser.on('disconnected', () => {
        browser = null;
        for (const id of [...sessions.keys()]) closeSession(id);
    });
    return browser;
}

async function startScreencast(session) {
    await session.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: JPEG_QUALITY,
        maxWidth: session.width,
        maxHeight: session.height,
        everyNthFrame: 1
    });
}

async function restartScreencast(session) {
    try { await session.cdp.send('Page.stopScreencast'); } catch (_) {}
    await startScreencast(session);
}

async function createSession(body) {
    if (sessions.size >= MAX_SESSIONS) {
        const error = new Error('too many browser sessions');
        error.status = 429;
        throw error;
    }
    const url = normalizeWebUrl(body && body.url) || 'about:blank';
    if (url === 'about:blank' && body && body.url) {
        const error = new Error('url must be http, https, or chrome');
        error.status = 400;
        throw error;
    }
    const width = clampSize(body && body.width, 1280, 320, 1920);
    const height = clampSize(body && body.height, 800, 240, 1440);
    const instance = await ensureBrowser();
    const page = await instance.newPage();
    await page.evaluateOnNewDocument(blockPasskeys);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const cdp = await page.createCDPSession();
    const id = crypto.randomBytes(16).toString('hex');
    const viewerToken = crypto.randomBytes(24).toString('hex');
    const session = {
        id,
        viewerToken,
        page,
        cdp,
        url: url === 'about:blank' ? '' : url,
        title: '',
        width,
        height,
        sockets: new Set(),
        idleAt: Date.now() + IDLE_MS,
        meta: null,
        downloads: new Map(),
        downloadDir: '',
        downloadWatch: null,
        inputChain: Promise.resolve(),
        navGen: 0,
        pendingNav: null,
        navRunning: false,
        navigating: false,
        latestFrame: null,
        pendingAck: null,
        framePump: false,
        mainFrameId: '',
        dragSelectAt: 0,
        paceNow: false,
        health: 'ok',
        healthMisses: 0,
        healthTimer: null,
        closing: false
    };
    sessions.set(id, session);
    armDownloads(session);

    try {
        const tree = await cdp.send('Page.getFrameTree');
        session.mainFrameId = tree && tree.frameTree && tree.frameTree.frame && tree.frameTree.frame.id || '';
    } catch (_) {}
    cdp.send('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => {});

    cdp.on('Page.screencastFrame', (event) => {
        const current = sessions.get(id);
        if (!current) return;
        const metadata = event.metadata || {};
        const metaKey = [
            metadata.deviceWidth,
            metadata.deviceHeight,
            metadata.offsetTop,
            metadata.pageScaleFactor
        ].join(':');
        if (metaKey !== current.metaKey) {
            current.metaKey = metaKey;
            current.meta = metadata;
            broadcast(current, { type: 'meta', metadata });
        }
        noteScreencastFrame(current, event);
        touch(current);
    });

    const mainFrameEvent = (ev) => session.mainFrameId && ev && ev.frameId === session.mainFrameId;

    cdp.on('Page.frameStartedLoading', (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev)) return;
        beginNavigating(session, false);
    });

    cdp.on('Page.lifecycleEvent', async (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev)) return;
        if (ev.name !== 'DOMContentLoaded' && ev.name !== 'firstContentfulPaint' && ev.name !== 'load' && ev.name !== 'networkAlmostIdle') return;
        try { session.title = await page.title(); } catch (_) {}
        endNavigating(session);
    });

    cdp.on('Page.frameStoppedLoading', async (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev)) return;
        try { session.title = await page.title(); } catch (_) {}
        endNavigating(session);
    });

    cdp.on('Page.navigatedWithinDocument', (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev) || !ev.url) return;
        session.url = ev.url;
        endNavigating(session);
    });

    page.on('popup', (popup) => holdPopup(session, popup));
    page.on('error', () => markHealth(session, 'failed'));
    page.on('close', () => {
        if (!session.closing) markHealth(session, 'failed');
    });

    page.on('framenavigated', (frame) => {
        if (!sessions.get(id) || frame !== page.mainFrame()) return;
        const next = frame.url();
        if (/^(https?:|chrome:)/i.test(next)) session.url = next;
        publishLocation(session);
    });

    await startScreencast(session);

    if (url !== 'about:blank') requestNavigate(session, url, false);
    armHealth(session);

    return session;
}

function sessionPublic(session) {
    return {
        id: session.id,
        url: session.url,
        title: session.title,
        width: session.width,
        height: session.height,
        viewers: session.sockets.size
    };
}

async function onViewerMessage(session, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;
    touch(session);
    const page = session.page;
    if (msg.type === 'ping') {
        broadcast(session, { type: 'pong', t: msg.t });
        return;
    }
    if (msg.type === 'rtt') {
        noteClientRtt(session, msg.ms);
        return;
    }
    if (msg.type === 'inspect') {
        const x = Number(msg.x);
        const y = Number(msg.y);
        let info = { selection: '', text: '', href: '', src: '', alt: '' };
        if (Number.isFinite(x) && Number.isFinite(y)) {
            try {
                info = await page.evaluate((px, py) => {
                    const el = document.elementFromPoint(px, py);
                    const sel = window.getSelection();
                    const out = {
                        selection: sel ? String(sel) : '',
                        text: '',
                        href: '',
                        src: '',
                        alt: ''
                    };
                    if (!el) return out;
                    const active = document.activeElement;
                    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                        const start = active.selectionStart;
                        const end = active.selectionEnd;
                        if (typeof start === 'number' && typeof end === 'number' && end > start) {
                            out.selection = String(active.value || '').slice(start, end);
                        }
                    }
                    out.text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
                    const img = el.tagName === 'IMG' ? el : (el.closest ? el.closest('img') : null);
                    const link = el.tagName === 'A' ? el : (el.closest ? el.closest('a') : null);
                    if (img) {
                        out.src = img.currentSrc || img.src || '';
                        out.alt = img.alt || '';
                    }
                    if (link && link.href) out.href = link.href;
                    return out;
                }, x, y);
            } catch (_) {}
        }
        broadcast(session, {
            type: 'inspect',
            selection: info && info.selection || '',
            text: info && info.text || '',
            href: info && info.href || '',
            src: info && info.src || '',
            alt: info && info.alt || ''
        });
        return;
    }
    if (msg.type === 'copy') {
        let text = '';
        try { text = await readSelection(page); } catch (_) {}
        broadcast(session, { type: 'clipboard', text: String(text || '').slice(0, 100000) });
        return;
    }
    if (msg.type === 'paste' && typeof msg.text === 'string') {
        const text = msg.text.slice(0, 100000);
        if (text) await session.cdp.send('Input.insertText', { text });
        return;
    }
    if (msg.type === 'mouse') {
        const x = Number(msg.x);
        const y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const button = msg.button === 'right' || msg.button === 'middle' ? msg.button : 'left';
        if (msg.kind === 'move') {
            await page.mouse.move(x, y);
        } else if (msg.kind === 'down' || msg.kind === 'click') {
            await releaseClickModifiers(page, session.clickKeys);
            session.clickKeys = await pressClickModifiers(page, msg);
            await page.mouse.move(x, y);
            try {
                await page.mouse.down({ button });
            } catch (err) {
                if (!/already pressed/i.test(err && err.message || '')) throw err;
                await page.mouse.up({ button }).catch(() => {});
                await page.mouse.down({ button });
            }
            if (msg.kind === 'down' && button === 'left' && !msg.ctrl && !msg.meta) session.dragFrom = { x, y };
            if (msg.kind === 'click') {
                session.dragFrom = null;
                await page.mouse.up({ button }).catch(() => {});
                await releaseClickModifiers(page, session.clickKeys);
                session.clickKeys = null;
                if (button === 'left' && !msg.ctrl && !msg.meta) followChromeLink(session, x, y).catch(() => {});
            }
        } else if (msg.kind === 'up') {
            await page.mouse.move(x, y);
            const from = session.dragFrom;
            session.dragFrom = null;
            await page.mouse.up({ button }).catch(() => {});
            await releaseClickModifiers(page, session.clickKeys);
            session.clickKeys = null;
            const click = button === 'left' && !msg.ctrl && !msg.meta && (!from || Math.hypot(x - from.x, y - from.y) < 6);
            if (from && button === 'left' && !click) await selectDraggedText(page, from, { x, y });
            if (click) followChromeLink(session, x, y).catch(() => {});
        }
        return;
    }
    if (msg.type === 'wheel') {
        await page.mouse.wheel({
            deltaX: Number(msg.deltaX) || 0,
            deltaY: Number(msg.deltaY) || 0
        });
        return;
    }
    if (msg.type === 'key' && typeof msg.key === 'string' && msg.key.length <= 32) {
        const text = typeof msg.text === 'string' ? msg.text : '';
        const editCommands = {
            Backspace: ['DeleteBackward'],
            Delete: ['DeleteForward'],
            ArrowLeft: ['MoveLeft'],
            ArrowRight: ['MoveRight'],
            ArrowUp: ['MoveUp'],
            ArrowDown: ['MoveDown'],
            Home: ['MoveToBeginningOfLine'],
            End: ['MoveToEndOfLine']
        };
        const shiftCommands = {
            ArrowLeft: ['SelectLeft'],
            ArrowRight: ['SelectRight'],
            ArrowUp: ['SelectUp'],
            ArrowDown: ['SelectDown']
        };
        try {
            if (msg.kind === 'down' && text) {
                await session.cdp.send('Input.insertText', { text: text.slice(0, 8) });
            } else if (msg.kind === 'down' && msg.key === 'Enter') {
                await page.keyboard.down('Enter', { text: '\r' });
            } else if (msg.kind === 'down' && editCommands[msg.key]) {
                const commands = msg.shift && shiftCommands[msg.key] ? shiftCommands[msg.key] : editCommands[msg.key];
                await page.keyboard.down(msg.key, { commands });
            } else if (msg.kind === 'down') {
                await page.keyboard.down(msg.key);
            } else if (msg.kind === 'up' && !text) {
                await page.keyboard.up(msg.key);
            }
        } catch (err) {
            console.error('[grimoire-browser] key', err && err.message);
        }
        return;
    }
    if (msg.type === 'navigate') {
        const next = normalizeWebUrl(msg.url);
        if (!next) return;
        requestNavigate(session, next, false);
        return;
    }
    if (msg.type === 'reload') {
        requestNavigate(session, session.url, true);
        return;
    }
    if (msg.type === 'resize') {
        const width = clampSize(msg.width, session.width, 320, 1920);
        const height = clampSize(msg.height, session.height, 240, 1440);
        if (width === session.width && height === session.height) return;
        session.width = width;
        session.height = height;
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await restartScreencast(session);
    }
}

async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
        sendJson(res, 200, {
            ok: true,
            browser: !!(browser && browser.connected),
            sessions: sessions.size,
            chrome: chromeBin
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/sessions') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        try {
            const body = await readBody(req);
            const session = await createSession(body);
            sendJson(res, 201, {
                id: session.id,
                viewerToken: session.viewerToken,
                viewPath: '/view/' + session.id + '?t=' + session.viewerToken
            });
        } catch (err) {
            sendJson(res, err.status || 500, { error: err.message || 'session failed' });
        }
        return;
    }

    const one = pathname.match(/^\/sessions\/([a-f0-9]{32})$/);
    if (one && req.method === 'GET') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        const session = sessions.get(one[1]);
        if (!session) {
            sendJson(res, 404, { error: 'not found' });
            return;
        }
        try { session.title = await session.page.title(); } catch (_) {}
        session.url = session.page.url();
        sendJson(res, 200, sessionPublic(session));
        return;
    }

    if (one && req.method === 'DELETE') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        await closeSession(one[1]);
        sendJson(res, 200, { ok: true });
        return;
    }

    const view = pathname.match(/^\/view\/([a-f0-9]{32})$/);
    if (view && req.method === 'GET') {
        const session = sessions.get(view[1]);
        const token = url.searchParams.get('t') || '';
        if (!session || !tokenEquals(token, session.viewerToken)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': 'frame-ancestors ' + FRAME_ANCESTORS,
            'Referrer-Policy': 'no-referrer'
        });
        res.end(viewerHtml());
        return;
    }

    const resource = pathname.match(/^\/sessions\/([a-f0-9]{32})\/resource$/);
    if (resource && req.method === 'GET') {
        const session = sessions.get(resource[1]);
        const token = url.searchParams.get('t') || '';
        if (!session || !tokenEquals(token, session.viewerToken)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        try {
            const file = await readPageResource(session, url.searchParams.get('url') || '');
            res.writeHead(200, {
                'Content-Type': file.type,
                'Content-Disposition': 'attachment; filename="' + file.filename + '"',
                'Cache-Control': 'no-store'
            });
            res.end(file.buffer);
        } catch (err) {
            sendJson(res, err.status || 502, { error: err.message || 'fetch failed' });
        }
        return;
    }

    const download = pathname.match(/^\/sessions\/([a-f0-9]{32})\/downloads\/([A-Za-z0-9-]{8,80})$/);
    if (download && req.method === 'GET') {
        const session = sessions.get(download[1]);
        const token = url.searchParams.get('t') || '';
        if (!session || !tokenEquals(token, session.viewerToken)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        const item = session.downloads && session.downloads.get(download[2]);
        const root = session.downloadDir ? path.resolve(session.downloadDir) : '';
        const filePath = item && item.filePath ? path.resolve(item.filePath) : '';
        if (!item || item.state !== 'completed' || !root || !filePath || (filePath !== root && !filePath.startsWith(root + path.sep))) {
            sendJson(res, 404, { error: 'not found' });
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="' + safeFilename(item.filename) + '"',
            'Cache-Control': 'no-store'
        });
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    sendJson(res, 404, { error: 'not found' });
}

function attachViewer(ws, session) {
    session.sockets.add(ws);
    touch(session);
    if (session.meta) ws.send(JSON.stringify({ type: 'meta', metadata: session.meta }));
    if (session.url || session.navigating) {
        ws.send(JSON.stringify({
            type: session.navigating ? 'navigating' : 'location',
            url: session.url || '',
            title: session.title || '',
            navigating: !!session.navigating
        }));
    }
    if (session.health && session.health !== 'ok') {
        ws.send(JSON.stringify({ type: 'status', state: session.health, url: session.url || '' }));
    }
    if (session.painted) {
        try { ws.send(session.painted); } catch (_) {}
    } else {
        restartScreencast(session).catch(() => {});
    }
    ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const raw = data.toString();
        let preview = null;
        try { preview = JSON.parse(raw); } catch (_) {}
        const gesture = preview && (
            (preview.type === 'mouse' && (preview.kind === 'down' || preview.kind === 'up' || preview.kind === 'click'))
            || (preview.type === 'key' && preview.kind === 'down')
            || preview.type === 'wheel'
        );
        if (gesture) releaseFramePace(session);
        if (preview && (preview.type === 'navigate' || preview.type === 'reload' || preview.type === 'key' || preview.type === 'paste' || preview.type === 'ping' || preview.type === 'rtt' || preview.type === 'inspect' || preview.type === 'copy')) {
            onViewerMessage(session, raw).catch((err) => {
                console.error('[grimoire-browser] input', err && err.message);
            });
            return;
        }
        if (preview && preview.type === 'mouse' && preview.kind === 'move') {
            session.pendingMove = { raw, gen: session.navGen };
            if (session.moveQueued) return;
            session.moveQueued = true;
            session.inputChain = session.inputChain.then(() => {
                session.moveQueued = false;
                const pending = session.pendingMove;
                session.pendingMove = null;
                if (!pending || pending.gen !== session.navGen) return;
                return onViewerMessage(session, pending.raw);
            }).catch((err) => {
                session.moveQueued = false;
                console.error('[grimoire-browser] input', err && err.message);
            });
            return;
        }
        if (gesture) session.pendingMove = null;
        session.inputChain = session.inputChain.then(() => onViewerMessage(session, raw)).catch((err) => {
            console.error('[grimoire-browser] input', err && err.message);
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'error', message: err.message || 'input failed' }));
            }
        });
    });
    ws.on('close', () => {
        session.sockets.delete(ws);
    });
}

async function main() {
    if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 16) {
        console.error('[grimoire-browser] set GRIMOIRE_BROWSER_TOKEN to a secret of at least 16 characters');
        process.exit(1);
    }
    chromeBin = resolveChrome();
    if (!chromeBin) {
        console.error('[grimoire-browser] Chrome not found. Set CHROME_BIN.');
        process.exit(1);
    }
    console.log('[grimoire-browser] chrome', chromeBin);
    await ensureBrowser();

    const server = http.createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
            if (!res.headersSent) sendJson(res, 500, { error: err.message || 'error' });
        });
    });
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        let url;
        try { url = new URL(req.url, 'http://127.0.0.1'); } catch (_) {
            socket.destroy();
            return;
        }
        const match = url.pathname.match(/^\/sessions\/([a-f0-9]{32})\/stream$/);
        const session = match ? sessions.get(match[1]) : null;
        const token = url.searchParams.get('t') || '';
        const tokenOk = session && tokenEquals(token, session.viewerToken);
        if (!tokenOk) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => attachViewer(ws, session));
    });

    setInterval(() => {
        const now = Date.now();
        for (const [id, session] of sessions) {
            if (session.idleAt < now) closeSession(id);
        }
    }, 15000).unref();

    server.listen(PORT, HOST, () => {
        const bound = server.address();
        console.log('[grimoire-browser] listening on http://' + bound.address + ':' + bound.port);
    });

    const shutdown = async () => {
        for (const id of [...sessions.keys()]) await closeSession(id);
        if (browser) {
            try { await browser.close(); } catch (_) {}
        }
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('[grimoire-browser]', err);
    process.exit(1);
});
