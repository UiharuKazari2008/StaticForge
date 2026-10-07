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
 *   MAX_SESSIONS             default 4 (popup windows have their own cap of the same size)
 *   ALCHEMY_PROFILE_DIR      default ~/.local/share/dreamscape/alchemy-profile (cookies, extension logins: keep 0700)
 *   ALCHEMY_EXTENSIONS_DIR   default ~/.local/share/dreamscape/alchemy-extensions (scripts/alchemy-update-extension.js)
 *   ALCHEMY_CHROMIUM_DIR     default ~/.local/share/dreamscape/alchemy-chromium (scripts/alchemy-brand-chromium.js)
 *   ALCHEMY_HEADLESS         set 1 to run headless; otherwise Chromium runs windowed on a private Xvfb display when Xvfb is installed
 *   ALCHEMY_AUDIO            set 0 to mute; otherwise audio plays into a private PulseAudio when pulseaudio and ffmpeg are installed
 */

let sharp = null;
try {
    sharp = require('sharp');
    sharp.cache(false);
} catch (_) {
    sharp = null;
}

const { spawn, spawnSync } = require('child_process');
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
const DIALOG_MS = 5 * 60 * 1000;
const DATA_DIR = path.join(os.homedir(), '.local', 'share', 'dreamscape');
const PROFILE_DIR = process.env.ALCHEMY_PROFILE_DIR || path.join(DATA_DIR, 'alchemy-profile');
const EXTENSIONS_DIR = process.env.ALCHEMY_EXTENSIONS_DIR || path.join(DATA_DIR, 'alchemy-extensions');
const ALCHEMY_BIN = path.join(process.env.ALCHEMY_CHROMIUM_DIR || path.join(DATA_DIR, 'alchemy-chromium'), 'alchemy');
const NO_SANDBOX = process.env.CHROME_NO_SANDBOX !== '0';
// Sites such as X refuse logins from headless Chromium, so it runs windowed on a virtual display.
const XVFB_BIN = '/usr/bin/Xvfb';
const XAUTH_FILE = path.join(DATA_DIR, 'alchemy-xauth');
const HEADFUL = process.env.ALCHEMY_HEADLESS !== '1' && fs.existsSync(XVFB_BIN);
const GPU_NODE = '/dev/dri/renderD128';
const PULSEAUDIO_BIN = '/usr/bin/pulseaudio';
const FFMPEG_BIN = '/usr/bin/ffmpeg';
const AUDIO = process.env.ALCHEMY_AUDIO !== '0' && fs.existsSync(PULSEAUDIO_BIN) && fs.existsSync(FFMPEG_BIN);
const FAKE_MIC_FILE = path.join(DATA_DIR, 'alchemy-fake-mic.wav');
const FAKE_CAMERA_FILE = path.join(DATA_DIR, 'alchemy-fake-camera.y4m');
const FAKE_CAMERA_LOGO = path.join(__dirname, '..', '..', 'public', 'static_images', 'app_icons', 'alchemy.png');
const JPEG_QUALITY = Math.min(90, Math.max(30, Number(process.env.GRIMOIRE_BROWSER_JPEG_QUALITY || 55)));
const DEFAULT_SETTINGS = Object.freeze({ jpegQuality: JPEG_QUALITY, minFps: 10, maxFps: 30, regionQuality: 78 });

// Runs in the 'alchemy' isolated world, top frame only: report document.title changes (Chrome does not send target title updates for every change).
function watchTitle() {
    if (window !== window.top) return;
    let last = null;
    const check = () => {
        if (document.title === last) return;
        last = document.title;
        try { globalThis.__alchemyTitle(last); } catch (_) {}
    };
    const watch = () => {
        check();
        if (document.head) new MutationObserver(check).observe(document.head, { subtree: true, childList: true, characterData: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
    else watch();
}

// Runs in the 'alchemy' isolated world, top frame only: Chrome draws a <select> list as an OS popup the screencast never
// sees, so the native popup is stopped and the options go to the viewer. composedPath reaches selects in shadow DOM (chrome://settings).
function watchSelects() {
    if (window !== window.top) return;
    let open = null;
    globalThis.__alchemyPickSelect = (index) => {
        const el = open;
        open = null;
        if (!el || !el.isConnected || index < 0 || index >= el.options.length || el.selectedIndex === index) return;
        el.selectedIndex = index;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        const el = ev.composedPath().find((node) => node instanceof HTMLSelectElement);
        if (!el || el.multiple || el.size > 1 || el.disabled) return;
        ev.preventDefault();
        el.focus();
        open = el;
        const rect = el.getBoundingClientRect();
        const options = Array.from(el.options).slice(0, 500).map((option) => {
            const group = option.parentElement && option.parentElement.tagName === 'OPTGROUP' ? option.parentElement : null;
            return { label: option.label || option.text, disabled: option.disabled || !!(group && group.disabled), group: group ? group.label : '' };
        });
        try { globalThis.__alchemySelect(JSON.stringify({ options, selected: el.selectedIndex, x: rect.left, y: rect.bottom })); } catch (_) {}
    }, true);
}

function sessionSettings(input, base) {
    const src = input && typeof input === 'object' ? input : {};
    const pick = (key, min, max) => clampSize(src[key], base[key], min, max);
    const out = {
        jpegQuality: pick('jpegQuality', 30, 90),
        minFps: pick('minFps', 1, 30),
        maxFps: pick('maxFps', 5, 60),
        regionQuality: pick('regionQuality', 30, 90)
    };
    if (out.minFps > out.maxFps) out.minFps = out.maxFps;
    return out;
}

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
    // Last, so it wins a version tie; an older copy (apt updated Chromium) loses to the system build.
    if (fs.existsSync(ALCHEMY_BIN)) found.push(ALCHEMY_BIN);
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
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'chrome:' || parsed.protocol === 'chrome-extension:') {
        if (!parsed.hostname) return '';
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            const h = parsed.hostname;
            if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '[::1]' || h === '169.254.169.254' || h.startsWith('192.168.') || h.startsWith('10.') || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h) || h.startsWith('[fc00:') || h.startsWith('[fe80:')) {
                return '';
            }
        }
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
        if (!ev || !ev.guid) return;
        const item = session.downloads.get(ev.guid);
        // Page and Browser both report progress; 4 updates a second is enough for a toast bar.
        if (ev.state === 'inProgress' || ev.state === 'canceled') {
            const now = Date.now();
            if (!item || (ev.state === 'inProgress' && now - (item.sentAt || 0) < 250)) return;
            item.sentAt = now;
            broadcast(session, { type: 'download-progress', id: ev.guid, filename: item.filename, received: ev.receivedBytes || 0, total: ev.totalBytes || 0, canceled: ev.state === 'canceled' });
            return;
        }
        if (ev.state !== 'completed') return;
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
    const ownExtension = parsed.protocol === 'chrome-extension:' && session.page.url().startsWith('chrome-extension://' + parsed.host + '/');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'data:' && !ownExtension) {
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

// Icon candidates for a desktop shortcut: large icons, then og:image, then small icons, then /favicon.ico.
async function readPageInfo(session) {
    const read = session.page.evaluate(async () => {
        const abs = (href, base) => {
            try { return new URL(href, base || document.baseURI).href; } catch (_) { return ''; }
        };
        const px = (sizes, fallback) => {
            if (/any/i.test(sizes || '')) return 512;
            let best = 0;
            String(sizes || '').split(/\s+/).forEach((part) => {
                const m = /^(\d+)x\d+$/i.exec(part);
                if (m) best = Math.max(best, Number(m[1]));
            });
            return best || fallback;
        };
        const icons = [];
        document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]').forEach((link) => {
            const touch = /apple-touch-icon/i.test(link.rel);
            icons.push({ href: abs(link.getAttribute('href')), px: px(link.getAttribute('sizes'), touch ? 180 : 16) });
        });
        const manifest = document.querySelector('link[rel="manifest"]');
        if (manifest && manifest.href) {
            try {
                const res = await fetch(manifest.href, { credentials: 'include' });
                const json = await res.json();
                (Array.isArray(json.icons) ? json.icons : []).forEach((icon) => {
                    if (icon && icon.src) icons.push({ href: abs(icon.src, manifest.href), px: px(icon.sizes, 48) });
                });
            } catch (_) {}
        }
        icons.sort((a, b) => b.px - a.px);
        const og = document.querySelector('meta[property="og:image"], meta[name="og:image"]');
        const list = icons.filter((i) => i.px >= 48).map((i) => i.href);
        if (og && og.content) list.push(abs(og.content));
        icons.filter((i) => i.px < 48).forEach((i) => list.push(i.href));
        list.push(abs('/favicon.ico'));
        return {
            url: location.href,
            title: document.title || '',
            icons: [...new Set(list.filter((href) => /^(https?:|data:|chrome-extension:)/i.test(href)))].slice(0, 12)
        };
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('page info timed out')), 6000));
    const info = await Promise.race([read, timeout]);
    // Extension pages rarely link an icon; the manifest one is what Chrome shows.
    const ext = extensions.find((e) => e.icon && info.url.startsWith('chrome-extension://' + e.id + '/'));
    if (ext) info.icons.unshift(ext.icon);
    return info;
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
    if (/^(https?:|chrome(-extension)?:)/i.test(current)) session.url = current;
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
    const fastest = Math.round(1000 / session.settings.maxFps);
    const slowest = Math.round(1000 / session.settings.minFps);
    return Math.max(fastest, Math.min(Math.round(rtt), slowest));
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
        }).jpeg({ quality: session.settings.regionQuality }).toBuffer();
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

// Address bar fill: Chromium has no load percentage, so lifecycle stages stand in. Only ever moves forward.
const LOAD_STAGES = { commit: 0.3, DOMContentLoaded: 0.6, firstContentfulPaint: 0.7, load: 0.9, networkAlmostIdle: 1 };

function noteLoadProgress(session, value) {
    if (value <= (session.loadProgress || 0)) return;
    session.loadProgress = value;
    broadcast(session, { type: 'progress', value });
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
    if (session.navigating || session.dialog) {
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

function popupCount() {
    let count = 0;
    for (const session of sessions.values()) if (session.popup) count++;
    return count;
}

async function adoptPopup(announce, page, parentId) {
    try {
        const child = await createSession({ width: 480, height: 640, popup: true, parentId }, page);
        if (!sessions.get(announce.id)) {
            closeSession(child.id);
            return;
        }
        broadcast(announce, { type: 'popup', url: child.url || '', sessionId: child.id, viewerToken: child.viewerToken, tab: !parentId });
    } catch (err) {
        console.error('[grimoire-browser] popup', err && err.message);
        page.close().catch(() => {});
    }
}

// Popups that can reach window.opener (OAuth, sign-in) stay alive as a child session streamed in a small window.
// The rest (target=_blank is noopener) close here and reopen as a new Alchemy window.
function holdPopup(session, popup) {
    let opener = false;
    try { opener = !!popup.target()._getTargetInfo().canAccessOpener; } catch (_) {}
    if (opener && popupCount() < MAX_SESSIONS) {
        adoptPopup(session, popup, session.id);
        return;
    }
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

// One pending dialog per session; it waits for a viewer reply (or DIALOG_MS) and is resent on attach.
function openDialog(session, ask, settle) {
    if (session.dialog) session.dialog.settle(null);
    const id = crypto.randomBytes(8).toString('hex');
    const dialog = { id, ask: Object.assign({ type: 'dialog', id }, ask), js: ask.kind !== 'auth', timer: null };
    dialog.settle = (reply) => {
        if (session.dialog !== dialog) return;
        session.dialog = null;
        clearTimeout(dialog.timer);
        Promise.resolve().then(() => settle(reply)).catch(() => {});
    };
    dialog.timer = setTimeout(() => dialog.settle(null), DIALOG_MS);
    session.dialog = dialog;
    broadcast(session, dialog.ask);
}

function holdDialog(session, dialog) {
    const kind = dialog.type();
    openDialog(session, {
        kind,
        message: String(dialog.message() || '').slice(0, 4000),
        defaultValue: String(dialog.defaultValue() || '').slice(0, 4000)
    }, (reply) => {
        if (reply && reply.accept) return dialog.accept(kind === 'prompt' ? String(reply.text || '') : undefined);
        return dialog.dismiss();
    });
}

// Headless cancels HTTP auth challenges, so the 401 page loads; ask, then retry with page.authenticate.
function holdAuth(session, response) {
    if (response.status() !== 401 || !response.request().isNavigationRequest()) return;
    if (response.frame() !== session.page.mainFrame()) return;
    const header = response.headers()['www-authenticate'] || '';
    if (!/^\s*(basic|digest)\b/i.test(header)) return;
    const target = response.url();
    let host = target;
    try { host = new URL(target).host; } catch (_) {}
    const realm = (header.match(/realm="([^"]*)"/i) || [])[1] || '';
    openDialog(session, { kind: 'auth', message: host, realm: realm.slice(0, 200) }, async (reply) => {
        if (!reply || !reply.accept || !sessions.get(session.id)) return;
        await session.page.authenticate({
            username: String(reply.username || '').slice(0, 512),
            password: String(reply.password || '').slice(0, 512)
        });
        requestNavigate(session, target, false);
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
            if (!job.reload) await Promise.all([applySiteUserAgent(session, job.url), grantCapture(job.url)]);
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
    for (const child of [...sessions.values()]) {
        if (child.parentId === id) closeSession(child.id);
    }
    if (session.popup) broadcast(session, { type: 'closed' });
    clearTimeout(session.navSettle);
    session.navSettle = null;
    clearTimeout(session.frameTimer);
    session.frameTimer = null;
    clearTimeout(session.healthTimer);
    session.healthTimer = null;
    if (session.dialog) clearTimeout(session.dialog.timer);
    session.dialog = null;
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

let browserLaunch = null;
let pageUserAgent = '';
let pageUserAgentMetadata = null;
let plainUserAgent = '';
let plainUserAgentMetadata = null;
// X answers an unknown brand with "we temporarily limited your login", so it gets the plain Chromium UA and brands.
const PLAIN_UA_HOSTS = /(^|\.)(x\.com|twitter\.com)$/i;

async function applySiteUserAgent(session, url) {
    let host = '';
    try { host = new URL(url).hostname; } catch (_) { return; }
    const plain = PLAIN_UA_HOSTS.test(host);
    if (!pageUserAgent || session.plainUa === plain) return;
    session.plainUa = plain;
    await session.page.setUserAgent(plain ? plainUserAgent : pageUserAgent, plain ? plainUserAgentMetadata : pageUserAgentMetadata).catch(() => {});
}
let extensions = [];
const ownPages = new WeakSet();

function extensionMessage(dir, manifest, value) {
    const match = /^__MSG_(\w+)__$/.exec(String(value || ''));
    if (!match) return String(value || '');
    try {
        const messages = JSON.parse(fs.readFileSync(path.join(dir, '_locales', manifest.default_locale || 'en', 'messages.json'), 'utf8'));
        const key = Object.keys(messages).find((name) => name.toLowerCase() === match[1].toLowerCase());
        return key ? String(messages[key].message || '') : '';
    } catch (_) {
        return '';
    }
}

// Unpacked extensions with a manifest "key" (scripts/alchemy-update-extension.js), so the id is the store id.
function readExtensions() {
    let names = [];
    try { names = fs.readdirSync(EXTENSIONS_DIR); } catch (_) { return []; }
    const out = [];
    for (const name of names) {
        const dir = path.join(EXTENSIONS_DIR, name);
        let manifest;
        try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) { continue; }
        if (!manifest.key) continue;
        const hex = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
        const id = hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
        const action = manifest.action || manifest.browser_action || {};
        const icons = manifest.icons || {};
        const iconSize = Object.keys(icons).sort((a, b) => Number(b) - Number(a))[0];
        const own = (file) => 'chrome-extension://' + id + '/' + String(file).replace(/^\/+/, '');
        out.push({
            id,
            dir,
            name: extensionMessage(dir, manifest, manifest.short_name || manifest.name) || id,
            popup: action.default_popup ? own(action.default_popup) : '',
            icon: iconSize ? own(icons[iconSize]) : ''
        });
    }
    return out;
}

// Opened before any viewer was attached (1Password's install welcome opens at launch); the next viewer gets them.
const pendingOrphans = [];

function flushOrphans(session) {
    while (pendingOrphans.length && popupCount() < MAX_SESSIONS) {
        const page = pendingOrphans.shift();
        if (!page.isClosed()) adoptPopup(session, page, '');
    }
}

// Pages an extension opens itself (chrome.tabs.create: sign-in, onboarding) have no page opener; stream them to the most recently used viewer.
async function adoptOrphan(target) {
    if (target.type() !== 'page') return;
    const opener = target.opener();
    if (opener && opener.type() === 'page') return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const page = await target.page().catch(() => null);
    if (!page || page.isClosed() || ownPages.has(page)) return;
    let announce = null;
    for (const session of sessions.values()) {
        if (session.sockets.size && (!announce || session.idleAt > announce.idleAt)) announce = session;
    }
    if (!announce && pendingOrphans.length < MAX_SESSIONS) {
        pendingOrphans.push(page);
        return;
    }
    if (!announce || popupCount() >= MAX_SESSIONS) {
        page.close().catch(() => {});
        return;
    }
    adoptPopup(announce, page, '');
}

let xvfb = null;
let xvfbDisplay = '';

// Xvfb picks a free display (-displayfd) and only accepts this cookie, so other local users cannot watch the pages.
function startDisplay() {
    if (xvfb && xvfb.exitCode === null && xvfbDisplay) return Promise.resolve(xvfbDisplay);
    const cookie = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(XAUTH_FILE, '', { mode: 0o600 });
    return new Promise((resolve, reject) => {
        const child = spawn(XVFB_BIN, ['-displayfd', '3', '-screen', '0', '1920x1440x24', '-nolisten', 'tcp', '-auth', XAUTH_FILE], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
        let out = '';
        const fail = (err) => reject(err instanceof Error ? err : new Error('Xvfb exited'));
        child.once('error', fail);
        child.once('exit', fail);
        child.stdio[3].on('data', (chunk) => {
            out += chunk;
            if (!out.includes('\n')) return;
            child.off('error', fail);
            child.off('exit', fail);
            xvfb = child;
            xvfbDisplay = ':' + out.trim();
            spawnSync('xauth', ['-f', XAUTH_FILE, 'add', xvfbDisplay, '.', cookie]);
            child.once('exit', () => {
                if (xvfb === child) xvfb = null;
            });
            resolve(xvfbDisplay);
        });
    });
}

function stopDisplay() {
    if (xvfb) xvfb.kill('SIGTERM');
    xvfb = null;
}

let pulse = null;
let pulseDir = '';
let audioListener = null;

// A private PulseAudio (socket in a fresh 0700 temp dir, one null sink) gives Chromium a device; the sink monitor is the stream.
async function startAudio() {
    if (pulse && pulse.exitCode === null && pulseDir) return 'unix:' + path.join(pulseDir, 'native');
    pulseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alchemy-pulse-'));
    const socket = path.join(pulseDir, 'native');
    const child = spawn(PULSEAUDIO_BIN, [
        '-n', '--daemonize=no', '--exit-idle-time=-1', '--use-pid-file=no', '--disallow-exit', '--disable-shm=yes', '--log-target=stderr', '--log-level=error',
        '-L', 'module-native-protocol-unix socket=' + socket + ' auth-anonymous=1',
        '-L', 'module-null-sink sink_name=alchemy sink_properties=device.description=Alchemy'
    ], { stdio: 'ignore', env: Object.assign({}, process.env, { PULSE_RUNTIME_PATH: pulseDir, PULSE_STATE_PATH: pulseDir }) });
    pulse = child;
    child.once('exit', () => {
        if (pulse === child) pulse = null;
    });
    for (let i = 0; i < 50 && !fs.existsSync(socket); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    if (!fs.existsSync(socket)) {
        stopAudio();
        throw new Error('PulseAudio did not start');
    }
    return 'unix:' + socket;
}

function stopAudio() {
    if (audioListener) audioListener();
    if (pulse) pulse.kill('SIGTERM');
    pulse = null;
    if (pulseDir) fs.rmSync(pulseDir, { recursive: true, force: true });
    pulseDir = '';
}

// One listener at a time (the focused Alchemy window); a new listener ends the old stream. Ogg pages are 20ms for low latency.
function streamAudio(res) {
    if (audioListener) audioListener();
    const ff = spawn(FFMPEG_BIN, [
        '-hide_banner', '-loglevel', 'error', '-fragment_size', '3840', '-f', 'pulse', '-i', 'alchemy.monitor',
        '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-frame_duration', '20',
        '-f', 'ogg', '-page_duration', '20000', '-flush_packets', '1', 'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'], env: Object.assign({}, process.env, { PULSE_SERVER: 'unix:' + path.join(pulseDir, 'native') }) });
    res.writeHead(200, { 'Content-Type': 'audio/ogg', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    ff.stdout.pipe(res);
    const end = () => {
        if (audioListener === end) audioListener = null;
        ff.kill('SIGKILL');
        if (!res.writableEnded) res.end();
    };
    audioListener = end;
    ff.once('exit', end);
    ff.once('error', end);
    res.once('close', end);
}

// Windowed Chrome stops painting a background tab, so every session gets its own window.
async function openPage(instance) {
    if (!HEADFUL) return instance.newPage();
    const marker = 'about:blank#alchemy-' + crypto.randomBytes(8).toString('hex');
    const client = await instance.target().createCDPSession();
    try {
        await client.send('Target.createTarget', { url: marker, newWindow: true });
    } finally {
        client.detach().catch(() => {});
    }
    const target = await instance.waitForTarget((t) => t.url() === marker, { timeout: 10000 });
    return target.page();
}

function ensureBrowser() {
    if (browser && browser.connected) return Promise.resolve(browser);
    if (!browserLaunch) browserLaunch = launchBrowser().finally(() => { browserLaunch = null; });
    return browserLaunch;
}

// Viewers get 'restarting' first, so they reopen their page instead of showing the failed tab page.
async function restartBrowser() {
    const ids = [...sessions.keys()];
    for (const id of ids) broadcast(sessions.get(id), { type: 'restarting' });
    const old = browser;
    browser = null;
    for (const id of ids) await closeSession(id);
    if (old) {
        try { await old.close(); } catch (_) {}
    }
    await ensureBrowser();
}

// The host has no camera or mic, so WebRTC pages got NotFoundError: a silent mic and an Alchemy-logo camera stand in.
function fakeCaptureArgs() {
    const args = ['--use-fake-device-for-media-stream'];
    if (!fs.existsSync(FFMPEG_BIN)) return args;
    if (!fs.existsSync(FAKE_MIC_FILE)) {
        spawnSync(FFMPEG_BIN, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1', FAKE_MIC_FILE]);
    }
    if (!fs.existsSync(FAKE_CAMERA_FILE) && fs.existsSync(FAKE_CAMERA_LOGO)) {
        spawnSync(FFMPEG_BIN, ['-y', '-loglevel', 'error', '-i', FAKE_CAMERA_LOGO, '-vf', 'scale=480:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:color=0x202124', '-frames:v', '1', '-pix_fmt', 'yuv420p', FAKE_CAMERA_FILE]);
    }
    if (fs.existsSync(FAKE_MIC_FILE)) args.push('--use-file-for-fake-audio-capture=' + FAKE_MIC_FILE);
    if (fs.existsSync(FAKE_CAMERA_FILE)) args.push('--use-file-for-fake-video-capture=' + FAKE_CAMERA_FILE);
    return args;
}

let browserClient = null;
const grantedCaptureOrigins = new Set();

// The camera / mic prompt would open on the invisible X display, so each http(s) origin is granted on its first visit
// (Browser.setPermission without an origin is ignored). Screen share still prompts.
function grantCapture(url) {
    let origin = '';
    try { origin = new URL(url).origin; } catch (_) { return Promise.resolve(); }
    if (!/^https?:/.test(origin) || !browserClient || grantedCaptureOrigins.has(origin)) return Promise.resolve();
    grantedCaptureOrigins.add(origin);
    return Promise.all(['camera', 'microphone'].map((name) => browserClient.send('Browser.setPermission', { permission: { name }, setting: 'granted', origin })))
        .catch(() => grantedCaptureOrigins.delete(origin));
}

// Chromium reads enable_do_not_track from the profile at launch (DNT: 1 and navigator.doNotTrack). An unreadable file is left alone.
function setProfilePrefs() {
    const file = path.join(PROFILE_DIR, 'Default', 'Preferences');
    let prefs = {};
    try {
        prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        if (err.code !== 'ENOENT') return;
    }
    if (prefs.enable_do_not_track === true) return;
    prefs.enable_do_not_track = true;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(prefs), { mode: 0o600 });
}

async function launchBrowser() {
    if (!chromeBin) throw new Error('Chrome binary not found. Set CHROME_BIN.');
    fs.mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(PROFILE_DIR, 0o700);
    setProfilePrefs();
    extensions = readExtensions();
    const extensionDirs = extensions.map((ext) => ext.dir).join(',');
    const args = [
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=WebAuthentication,WebAuthnConditionalUI,DisableLoadExtensionCommandLineSwitch',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-popup-blocking',
        '--disable-blink-features=AutomationControlled'
    ];
    if (extensionDirs) args.push('--disable-extensions-except=' + extensionDirs, '--load-extension=' + extensionDirs);
    else args.push('--disable-extensions');
    if (NO_SANDBOX) args.push('--no-sandbox', '--disable-setuid-sandbox');
    const env = Object.assign({}, process.env);
    let audio = false;
    if (AUDIO) {
        try {
            env.PULSE_SERVER = await startAudio();
            audio = true;
        } catch (err) {
            console.warn('[grimoire-browser] audio off:', err.message);
        }
    }
    if (!audio) args.push('--mute-audio');
    if (HEADFUL) {
        env.DISPLAY = await startDisplay();
        env.XAUTHORITY = XAUTH_FILE;
        delete env.WAYLAND_DISPLAY;
        // Xvfb has no GPU, but ANGLE on Vulkan renders on the Intel render node directly (compositing, raster, WebGL, video decode).
        // Without access to the node, SwiftShader keeps WebGL on (a missing WebGL is a bot signal).
        let gpu = false;
        try { fs.accessSync(GPU_NODE, fs.constants.R_OK | fs.constants.W_OK); gpu = true; } catch (_) {}
        if (gpu) args.push('--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization');
        else args.push('--enable-unsafe-swiftshader');
        console.log('[grimoire-browser] rendering ' + (gpu ? 'on the GPU (' + GPU_NODE + ')' : 'in software (no access to ' + GPU_NODE + ')'));
        // Session windows overlap on the virtual screen; covered windows must keep painting and running timers.
        args.push('--ozone-platform=x11', '--window-size=1280,800', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling');
    }
    args.push(...fakeCaptureArgs());
    const instance = await puppeteer.launch({
        executablePath: chromeBin,
        headless: !HEADFUL,
        pipe: true,
        userDataDir: PROFILE_DIR,
        ignoreDefaultArgs: ['--disable-extensions'],
        env,
        args
    });
    grantedCaptureOrigins.clear();
    browserClient = await instance.target().createCDPSession();
    instance.on('targetcreated', (target) => {
        adoptOrphan(target).catch(() => {});
    });
    instance.on('disconnected', () => {
        if (browser !== instance) return;
        browser = null;
        for (const id of [...sessions.keys()]) closeSession(id);
        pendingOrphans.length = 0;
    });
    // Cloudflare Turnstile refuses a click from a HeadlessChrome UA (webdriver is hidden by the flag above).
    // Alchemy brands itself like Edge: Chrome UA + Alchemy/<version>, and an Alchemy Client Hints brand.
    const chromeUa = (await instance.userAgent()).replace(/HeadlessChrome/g, 'Chrome');
    const uaVersion = (chromeUa.match(/Chrome\/([\d.]+)/) || [])[1] || '0.0.0.0';
    const fullVersion = ((await instance.version()).match(/([\d.]+)$/) || [])[1] || uaVersion;
    const major = uaVersion.split('.')[0];
    pageUserAgent = chromeUa + ' Alchemy/' + uaVersion;
    const brands = (version, grease) => [
        { brand: 'Not)A;Brand', version: grease },
        { brand: 'Chromium', version },
        { brand: 'Alchemy', version }
    ];
    pageUserAgentMetadata = {
        brands: brands(major, '99'),
        fullVersionList: brands(fullVersion, '99.0.0.0'),
        fullVersion,
        platform: 'Linux',
        platformVersion: '',
        architecture: 'x86',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false
    };
    plainUserAgent = chromeUa;
    plainUserAgentMetadata = Object.assign({}, pageUserAgentMetadata, {
        brands: pageUserAgentMetadata.brands.slice(0, 2),
        fullVersionList: pageUserAgentMetadata.fullVersionList.slice(0, 2)
    });
    browser = instance;
    return browser;
}

async function startScreencast(session) {
    await session.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: session.settings.jpegQuality,
        maxWidth: session.width,
        maxHeight: session.height,
        everyNthFrame: 1
    });
}

async function restartScreencast(session) {
    try { await session.cdp.send('Page.stopScreencast'); } catch (_) {}
    await startScreencast(session);
}

// adoptedPage: a popup page that is already open (adoptPopup); popup sessions close with their page.
async function createSession(body, adoptedPage) {
    const popup = !!(adoptedPage || (body && body.popup));
    if ((popup ? popupCount() : sessions.size - popupCount()) >= MAX_SESSIONS) {
        const error = new Error('too many browser sessions');
        error.status = 429;
        throw error;
    }
    const url = adoptedPage ? 'about:blank' : (normalizeWebUrl(body && body.url) || 'about:blank');
    if (!adoptedPage && url === 'about:blank' && body && body.url) {
        const error = new Error('url must be http, https, chrome, or chrome-extension');
        error.status = 400;
        throw error;
    }
    const width = clampSize(body && body.width, 1280, 320, 1920);
    const height = clampSize(body && body.height, 800, 240, 1440);
    const instance = await ensureBrowser();
    const page = adoptedPage || await openPage(instance);
    ownPages.add(page);
    if (pageUserAgent) await page.setUserAgent(pageUserAgent, pageUserAgentMetadata);
    await page.evaluateOnNewDocument(blockPasskeys);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const cdp = await page.createCDPSession();
    // Only one window has OS focus; each page still behaves focused (caret, :focus, focus events).
    if (HEADFUL) await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    const id = crypto.randomBytes(16).toString('hex');
    const viewerToken = crypto.randomBytes(24).toString('hex');
    const session = {
        id,
        viewerToken,
        page,
        cdp,
        url: adoptedPage ? normalizeWebUrl(page.url()) : (url === 'about:blank' ? '' : url),
        title: '',
        popup,
        parentId: String((body && body.parentId) || ''),
        width,
        height,
        settings: sessionSettings(body && body.settings, DEFAULT_SETTINGS),
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
        dialog: null,
        closing: false
    };
    sessions.set(id, session);
    armDownloads(session);

    try {
        const tree = await cdp.send('Page.getFrameTree');
        session.mainFrameId = tree && tree.frameTree && tree.frameTree.frame && tree.frameTree.frame.id || '';
    } catch (_) {}
    cdp.send('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => {});

    // Isolated world: a page-visible binding (page.exposeFunction) makes Cloudflare Turnstile refuse the click.
    cdp.on('Runtime.bindingCalled', (ev) => {
        if (ev && ev.name === '__alchemySelect' && sessions.get(id)) {
            let picked = null;
            try { picked = JSON.parse(ev.payload); } catch (_) {}
            if (!picked || !Array.isArray(picked.options)) return;
            session.selectContextId = ev.executionContextId;
            broadcast(session, { type: 'select', options: picked.options, selected: picked.selected, x: Number(picked.x) || 0, y: Number(picked.y) || 0 });
            return;
        }
        if (!ev || ev.name !== '__alchemyTitle' || !sessions.get(id)) return;
        const title = String(ev.payload || '').slice(0, 300);
        if (title === session.title) return;
        session.title = title;
        if (!session.navigating) publishLocation(session);
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Runtime.addBinding', { name: '__alchemyTitle', executionContextName: 'alchemy' });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + watchTitle + ')()', worldName: 'alchemy' });
    await cdp.send('Runtime.addBinding', { name: '__alchemySelect', executionContextName: 'alchemy' });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + watchSelects + ')()', worldName: 'alchemy' });

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
        session.loadProgress = 0;
        noteLoadProgress(session, 0.1);
        beginNavigating(session, false);
    });

    cdp.on('Page.lifecycleEvent', async (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev)) return;
        if (LOAD_STAGES[ev.name]) noteLoadProgress(session, LOAD_STAGES[ev.name]);
        if (ev.name !== 'DOMContentLoaded' && ev.name !== 'firstContentfulPaint' && ev.name !== 'load' && ev.name !== 'networkAlmostIdle') return;
        try { session.title = await page.title(); } catch (_) {}
        endNavigating(session);
    });

    cdp.on('Page.frameStoppedLoading', async (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev)) return;
        noteLoadProgress(session, 1);
        try { session.title = await page.title(); } catch (_) {}
        endNavigating(session);
    });

    cdp.on('Page.navigatedWithinDocument', (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev) || !ev.url) return;
        session.url = ev.url;
        endNavigating(session);
    });

    page.on('popup', (popup) => holdPopup(session, popup));
    page.on('dialog', (dialog) => holdDialog(session, dialog));
    page.on('response', (response) => holdAuth(session, response));
    cdp.on('Page.javascriptDialogClosed', () => {
        if (session.dialog && session.dialog.js) {
            clearTimeout(session.dialog.timer);
            session.dialog = null;
        }
    });
    page.on('error', () => markHealth(session, 'failed'));
    page.on('close', () => {
        if (session.closing) return;
        if (session.popup) closeSession(id);
        else markHealth(session, 'failed');
    });

    page.on('framenavigated', (frame) => {
        if (!sessions.get(id) || frame !== page.mainFrame()) return;
        const next = frame.url();
        if (/^(https?:|chrome(-extension)?:)/i.test(next)) session.url = next;
        applySiteUserAgent(session, next);
        grantCapture(next);
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
    if (msg.type === 'dialog-reply') {
        if (session.dialog && session.dialog.id === msg.id) session.dialog.settle(msg);
        return;
    }
    if (msg.type === 'select-pick' && Number.isInteger(msg.index) && session.selectContextId) {
        session.cdp.send('Runtime.evaluate', { expression: '__alchemyPickSelect(' + msg.index + ')', contextId: session.selectContextId }).catch(() => {});
        return;
    }
    if (msg.type === 'ping') {
        broadcast(session, { type: 'pong', t: msg.t });
        return;
    }
    if (msg.type === 'rtt') {
        noteClientRtt(session, msg.ms);
        return;
    }
    if (msg.type === 'settings') {
        const before = session.settings.jpegQuality;
        session.settings = sessionSettings(msg, session.settings);
        if (session.settings.jpegQuality !== before) await restartScreencast(session);
        return;
    }
    if (msg.type === 'inspect') {
        const x = Number(msg.x);
        const y = Number(msg.y);
        let info = { selection: '', text: '', href: '', src: '', alt: '', editable: false };
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
                        alt: '',
                        editable: false
                    };
                    if (!el) return out;
                    const field = el.closest ? el.closest('input, textarea, [contenteditable]') : null;
                    const nonText = /^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i;
                    if (field && !field.disabled && !field.readOnly
                        && (field.tagName !== 'INPUT' || !nonText.test(field.type))
                        && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA' || field.isContentEditable)) {
                        out.editable = true;
                        if (document.activeElement !== field) field.focus();
                    }
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
            alt: info && info.alt || '',
            editable: !!(info && info.editable)
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

    if (req.method === 'POST' && pathname === '/browser/restart') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        try {
            await restartBrowser();
            sendJson(res, 200, { ok: true });
        } catch (err) {
            sendJson(res, 500, { error: err.message || 'restart failed' });
        }
        return;
    }

    if (req.method === 'GET' && pathname === '/extensions') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        sendJson(res, 200, { extensions: extensions.map(({ id, name, popup }) => ({ id, name, popup })) });
        return;
    }

    const pageInfo = pathname.match(/^\/sessions\/([a-f0-9]{32})\/page-info$/);
    if (pageInfo && req.method === 'GET') {
        const session = sessions.get(pageInfo[1]);
        const token = url.searchParams.get('t') || '';
        if (!session || !tokenEquals(token, session.viewerToken)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        try {
            sendJson(res, 200, await readPageInfo(session));
        } catch (err) {
            sendJson(res, 502, { error: err.message || 'page info failed' });
        }
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

    // The whole browser's mix, not just this page: any session token may listen.
    const audio = pathname.match(/^\/sessions\/([a-f0-9]{32})\/audio$/);
    if (audio && req.method === 'GET') {
        const session = sessions.get(audio[1]);
        const token = url.searchParams.get('t') || '';
        if (!session || !tokenEquals(token, session.viewerToken)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        if (!pulse || !pulseDir) {
            sendJson(res, 503, { error: 'audio is off' });
            return;
        }
        streamAudio(res);
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
    if (session.dialog) ws.send(JSON.stringify(session.dialog.ask));
    if (!session.popup) flushOrphans(session);
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
        if (preview && (preview.type === 'dialog-reply' || preview.type === 'navigate' || preview.type === 'reload' || preview.type === 'key' || preview.type === 'paste' || preview.type === 'ping' || preview.type === 'rtt' || preview.type === 'inspect' || preview.type === 'copy')) {
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
    if (fs.existsSync(ALCHEMY_BIN) && chromeBin !== ALCHEMY_BIN) {
        console.warn('[grimoire-browser] the Alchemy-branded Chromium is older than the system one: run node scripts/alchemy-brand-chromium.js');
    }
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
        stopDisplay();
        stopAudio();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('exit', () => {
        stopDisplay();
        stopAudio();
    });
}

main().catch((err) => {
    console.error('[grimoire-browser]', err);
    process.exit(1);
});
