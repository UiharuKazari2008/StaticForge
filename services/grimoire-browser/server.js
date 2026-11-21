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
 *   ALCHEMY_CDP_PORT         default 9339: loopback CDP for Hoshino's Alchemy-owned Discord tab (modules/alchemyOwnedTab.js); 0 turns it off
 *   ALCHEMY_PROFILE_DIR      default ~/.local/share/dreamscape/alchemy-profile (cookies, extension logins: keep 0700)
 *   ALCHEMY_EXTENSIONS_DIR   default ~/.local/share/dreamscape/alchemy-extensions (scripts/alchemy-update-extension.js)
 *   ALCHEMY_CHROMIUM_DIR     default ~/.local/share/dreamscape/alchemy-chromium (a DreamScape/Alchemy-Chromium build, or scripts/alchemy-brand-chromium.js)
 *   ALCHEMY_HEADLESS         set 1 to run headless; otherwise Chromium runs windowed on a private Xvfb display when Xvfb is installed
 *   ALCHEMY_AUDIO            set 0 to mute; otherwise audio plays into a private PulseAudio when pulseaudio and ffmpeg are installed
 *   ALCHEMY_DATA_DIR         default ~/.local/share/dreamscape (X auth, performance and display settings, fake capture files)
 *   ALCHEMY_PACK_RTT_MS      default 30: a viewer this far away (round trip) gets scrolled frames as scroll packs; 0 = always
 *   ALCHEMY_JXL              set 1 to send whole frames as lossless JPEG XL to slow-link viewers that show it (jxl/)
 *   ALCHEMY_JXL_PIPE         default $ALCHEMY_DATA_DIR/alchemy-jxl-pipe (jxl/build-jxl-pipe.sh)
 *   ALCHEMY_DEBUG_PACK       set 1 to log how every frame was packed and how long it took
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
const ALCHEMY_CDP_PORT = Math.max(0, Number(process.env.ALCHEMY_CDP_PORT || 9339) || 0);
// modules/alchemyOwnedTab.js opens its tab with this marker; it is never closed for being over the window cap.
const ALCHEMY_OWNED_MARKER = '#alchemy-owned';
const ALCHEMY_QUIET_MARKER = '#alchemy-quiet';
const DIALOG_MS = 5 * 60 * 1000;
// Owned sessions (Yozora #756): Dreamscape's browsing-session registry (modules/browsingSessions.js) keeps them
// alive with leases while the owning device is connected or inside its idle time. A new session gets this long
// before its first lease; a lapsed lease closes it (Dreamscape down for that long cannot keep pages open forever).
const LEASE_GRACE_MS = 2 * 60 * 1000;
const LEASE_MAX_MS = 10 * 60 * 1000;

// ALCHEMY_DATA_DIR: a second instance (a bench, a test) keeps its X auth, profile and settings apart from the live one
const DATA_DIR = process.env.ALCHEMY_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'dreamscape');
const PROFILE_DIR = process.env.ALCHEMY_PROFILE_DIR || path.join(DATA_DIR, 'alchemy-profile');
const EXTENSIONS_DIR = process.env.ALCHEMY_EXTENSIONS_DIR || path.join(DATA_DIR, 'alchemy-extensions');
const ALCHEMY_BIN = path.join(process.env.ALCHEMY_CHROMIUM_DIR || path.join(DATA_DIR, 'alchemy-chromium'), 'alchemy');
const NO_SANDBOX = process.env.CHROME_NO_SANDBOX !== '0';
// Sites such as X refuse logins from headless Chromium, so it runs windowed on a virtual display.
const XVFB_BIN = '/usr/bin/Xvfb';
// one cookie file per service process (Nov 21): with one shared file, another Alchemy (a test instance, a restart
// whose old display lived on) rewrote it, and the live display re-read it on its next reset, so Chromium could not
// start again ("Authorization required") until Alchemy itself was restarted
const XAUTH_PREFIX = path.join(DATA_DIR, 'alchemy-xauth');
const XAUTH_FILE = XAUTH_PREFIX + '-' + process.pid;
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

// Performance options (#756 slice 6; Internet Properties > Advanced > Alchemy performance). Dreamscape sends them
// with every new session and with a restart; they are kept here so a fresh start launches with them.
const PERF_FILE = path.join(DATA_DIR, 'alchemy-performance.json');
const PERF_DEFAULTS = Object.freeze({
    tabMemoryMb: 0, isolateClients: true, isolateWindows: true, sandbox: !NO_SANDBOX, siteIsolation: true,
    rendererLimit: 0, pauseUnwatched: true, maxTabs: MAX_SESSIONS, headlessGpu: true, componentUpdate: true
});
const PERF_RELAUNCH = ['sandbox', 'siteIsolation', 'rendererLimit', 'headlessGpu', 'componentUpdate'];
const MEMORY_CHECK_MS = 5000;

function readPerf() {
    try {
        return normalizePerf(JSON.parse(fs.readFileSync(PERF_FILE, 'utf8')));
    } catch (_) {
        return normalizePerf({});
    }
}

function normalizePerf(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const [key, def] of Object.entries(PERF_DEFAULTS)) {
        if (typeof def === 'boolean') out[key] = typeof src[key] === 'boolean' ? src[key] : def;
        else out[key] = Number.isFinite(Number(src[key])) ? Math.max(0, Math.round(Number(src[key]))) : def;
    }
    out.maxTabs = Math.max(1, Math.min(32, out.maxTabs || MAX_SESSIONS));
    out.rendererLimit = Math.min(64, out.rendererLimit);
    if (!out.isolateClients) out.isolateWindows = false;
    return out;
}

let perf = readPerf();
// the options Chromium was launched with (the relaunch ones only change on a restart)
let launchedPerf = null;

// ---- 1:1 pixels (#990) ----
// Screencast frames are the page's DIP size times Chromium's real scale factor: an emulated deviceScaleFactor
// only changes how sharp the page is drawn before it is scaled back down (measured, Chromium 156: DSF 1, 1.5 and 2
// all give 800x600 frames of an 800x600 viewport). Chromium's default zoom does add pixels: a desktop viewport of
// W*Z DIP at default zoom Z is laid out W CSS pixels wide with devicePixelRatio Z from the first script, and its
// frames are W*Z pixels, the viewer's device pixels when Z is its pixel ratio. The zoom is a profile preference read
// at launch, so it follows the pixel ratio desktop viewers last reported (alchemy-display.json) and changes when
// Chromium relaunches with nothing open (createSession). Mobile emulation ignores the zoom (the phone path keeps
// CSS-sized frames and its stills).
const DISPLAY_FILE = path.join(DATA_DIR, 'alchemy-display.json');
const DISPLAY_ZOOM_MIN = 1;
const DISPLAY_ZOOM_MAX = 3;

function readDisplayZoom() {
    try {
        const raw = JSON.parse(fs.readFileSync(DISPLAY_FILE, 'utf8'));
        const zoom = Number(raw && raw.zoom);
        if (Number.isFinite(zoom)) return Math.max(DISPLAY_ZOOM_MIN, Math.min(DISPLAY_ZOOM_MAX, zoom));
    } catch (_) {}
    return 1;
}

let wantedZoom = readDisplayZoom();
let launchedZoom = 1;

// #993: Alchemy's own Chromium build (the DreamScape/Alchemy-Chromium repository) renders an emulated page at the
// emulated scale and captures it at that size, so each tab gets its viewer's device pixels by emulation alone: no
// default zoom, no relaunch, Grimoire's zoom and the phone exact too. The build leaves alchemy-patches.json next to
// its binary; stock Chromium keeps the default-zoom path above.
const EMULATED_SCALE_FEATURE = 'AlchemyEmulatedScaleCompositor';
let emulatedScale = false;

function patchedBuild(bin) {
    try {
        const info = JSON.parse(fs.readFileSync(path.join(path.dirname(fs.realpathSync(bin)), 'alchemy-patches.json'), 'utf8'));
        return Array.isArray(info.features) && info.features.includes(EMULATED_SCALE_FEATURE);
    } catch (_) {
        return false;
    }
}

function noteDesktopPixelRatio(dpr) {
    const zoom = Math.max(DISPLAY_ZOOM_MIN, Math.min(DISPLAY_ZOOM_MAX, Math.round((Number(dpr) || 1) * 100) / 100));
    if (Math.abs(zoom - wantedZoom) < 0.01) return;
    wantedZoom = zoom;
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DISPLAY_FILE, JSON.stringify({ zoom, at: new Date().toISOString() }));
    } catch (_) {}
}

/** New options from Dreamscape; the ones that need a relaunch wait for one (pendingRelaunch). */
function takePerf(raw) {
    if (!raw || typeof raw !== 'object') return;
    const next = normalizePerf(Object.assign({}, perf, raw));
    if (JSON.stringify(next) === JSON.stringify(perf)) return;
    perf = next;
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(PERF_FILE, JSON.stringify(perf));
    } catch (err) {
        console.warn('[grimoire-browser] could not keep the performance options:', err.message);
    }
    // a page over a new, higher limit thaws
    for (const session of sessions.values()) {
        if (session.memFrozen && (!perf.tabMemoryMb || (session.memMb || 0) < perf.tabMemoryMb)) thawSession(session).catch(() => {});
    }
}

function pendingRelaunch() {
    return !!launchedPerf && PERF_RELAUNCH.some((key) => launchedPerf[key] !== perf[key]);
}

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

// Runs in the 'alchemy' isolated world, every frame: a copy or cut (keyboard, menu, or the page's own execCommand)
// means the browser clipboard may have changed, so the server reads it and hands it to the viewer.
function watchClipboard() {
    const note = () => setTimeout(() => {
        try { globalThis.__alchemyClipboard(''); } catch (_) {}
    }, 30);
    addEventListener('copy', note, true);
    addEventListener('cut', note, true);
}

// Runs in the 'alchemy' isolated world, top frame only: Chromium's scrollbars are hidden (Emulation.setScrollbarsHidden),
// so the viewer draws the desktop's (vertical and horizontal) from these numbers. The scroller is the document, or a large element
// the user last scrolled (apps that scroll a full-height div instead of the page).
function watchScroll() {
    if (window !== window.top) return;
    let target = null;
    let last = '';
    let queued = false;
    const big = (el) => el.clientHeight >= innerHeight * 0.5 && el.clientWidth >= innerWidth * 0.5;
    const scroller = () => (target && target.isConnected ? target : (document.scrollingElement || document.documentElement));
    // #990: the viewer moves the picture itself while the document scrolls, all but what stays put. The layers
    // (Yukimi, Nov 21: "fixed background layer detect and seperation ... seperate top level fixed layers so that we
    // dont have that jumping around ... in a optimised way track and pridict layer adjustments or reflows"):
    //   bands     fixed (or stuck sticky) bars along the top and bottom edges: the rows the scroll packs leave alone
    //   f         other fixed and sticky elements (side bars, floating buttons, a sticky file tree): the viewer draws
    //             each where it stays (fixed) or where it will stick (sticky: its top value, where it sits in the
    //             flow, the bottom of its container), never moved with the page
    //   backdrop  a fixed picture behind the page (a fixed html/body background or pseudo-element, a full-screen
    //             fixed element under the content): v lists, in document coordinates, where it shows through (no
    //             content box over it), sampled in idle time; there the viewer keeps the backdrop still
    //   cover     a full-screen fixed layer on top (a dialog): nothing to scroll ahead
    // A full scan (points across the view) runs when scrolling stops or the view resizes. While the page scrolls only
    // the elements already found are read again (their boxes; a header that hides or shrinks is sent at once).
    let bands = [0, 0];
    let bandsTimer = 0;
    let known = [];
    let layerSent = '';
    let backdropEl = null;
    let backdropHost = null;
    let visGen = 0;
    let visTimer = 0;
    let visDone = [];
    let visLayout = 0;
    let lastSize = '';
    const alphaOf = (color) => {
        if (!color || color === 'transparent') return 0;
        const m = /rgba?\(([^)]*)\)/.exec(color);
        if (!m) return 1;
        const parts = m[1].split(/[\s,/]+/).filter(Boolean);
        return parts.length > 3 ? parseFloat(parts[3]) : 1;
    };
    const scanPinned = () => {
        const cache = new Map();
        return (el) => {
            const chain = [];
            let hit = null;
            for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
                if (cache.has(node)) { hit = cache.get(node); break; }
                chain.push(node);
                const pos = getComputedStyle(node).position;
                if (pos === 'fixed' || pos === 'sticky') { hit = node; break; }
            }
            for (const node of chain) cache.set(node, hit);
            return hit;
        };
    };
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    // a sticky element's top in the flow (document coordinates) while it is stuck: below the sibling before it, or
    // at the top of its container
    const flowTop = (el, cs, sy) => {
        let prev = el.previousElementSibling;
        while (prev && /^(absolute|fixed)$/.test(getComputedStyle(prev).position)) prev = prev.previousElementSibling;
        if (prev) return prev.getBoundingClientRect().bottom + sy + num(cs.marginTop);
        const parent = el.parentElement;
        if (!parent) return null;
        return parent.getBoundingClientRect().top + sy + num(getComputedStyle(parent).paddingTop) + num(cs.marginTop);
    };
    // what the found elements are now: bands, layers, the backdrop, a cover
    const classify = (list, w, h) => {
        const sy = scrollY;
        let top = 0;
        let bottom = 0;
        let cover = 0;
        let backdrop = null;
        const f = [];
        const keep = [];
        for (const item of list) {
            const el = item.el;
            if (!el.isConnected) continue;
            const r = el.getBoundingClientRect();
            const x0 = Math.max(0, r.left);
            const x1 = Math.min(w, r.right);
            const y0 = Math.max(0, r.top);
            const y1 = Math.min(h, r.bottom);
            if (x1 - x0 < 2 || y1 - y0 < 2) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || num(cs.opacity) < 0.02) continue;
            const sticky = cs.position === 'sticky';
            keep.push(item);
            // a bar across most of the width against one edge (stuck, when sticky)
            if (r.width >= w * 0.5 && r.height <= h * 0.4 && (r.top <= 1 || r.bottom >= h - 1)) {
                if (r.top <= 1 && r.bottom > top) top = r.bottom;
                if (r.bottom >= h - 1 && h - r.top > bottom) bottom = h - r.top;
                continue;
            }
            if (!sticky && (x1 - x0) * (y1 - y0) >= w * h * 0.6) {
                if (item.onTop) cover = 1;
                else if (!backdrop) backdrop = el;
                continue;
            }
            if (f.length >= 16) continue;
            const box = [x0, y0, x1 - x0, y1 - y0].map(Math.round);
            if (!sticky) { f.push(box.concat(0)); continue; }
            const t = cs.top === 'auto' ? null : num(cs.top);
            const parent = el.parentElement;
            const cBottom = parent ? parent.getBoundingClientRect().bottom + sy - num(getComputedStyle(parent).paddingBottom) - num(cs.marginBottom) : null;
            if (t == null || cBottom == null) { f.push(box.concat(0)); continue; }
            const moving = r.top > t + 0.5;
            const flow = moving ? r.top + sy : flowTop(el, cs, sy);
            if (flow == null) { f.push(box.concat(0)); continue; }
            // [x, y, w, h, 1, stick top, top in the flow, container bottom, full height]; y is the clipped top,
            // dy how far its box starts above it (rows the frame does not have)
            f.push(box.concat(1, Math.round(t), Math.round(flow), Math.round(cBottom), Math.round(r.height), Math.round(y0 - r.top)));
        }
        return { bands: [Math.ceil(top), Math.ceil(bottom)], f, cover, backdrop, keep };
    };
    // the page's own background (the viewer's checkerboard for rows it has no frame of): html's, else body's, else white
    const pageBg = () => {
        for (const el of [document.documentElement, document.body]) {
            if (!el) continue;
            const color = getComputedStyle(el).backgroundColor;
            if (alphaOf(color) > 0.5) return color;
        }
        return 'rgb(255, 255, 255)';
    };
    const sendLayers = (c, extra) => {
        const msg = { sy: Math.round(scrollY), w: innerWidth, h: innerHeight, f: c.f, cover: c.cover, backdrop: backdropEl || backdropHost ? 1 : 0, bg: pageBg() };
        if (extra) Object.assign(msg, extra);
        const text = JSON.stringify(msg);
        const key = text.replace(/"sy":-?\d+,/, '');
        if (!extra && key === layerSent) return;
        layerSent = key;
        try { globalThis.__alchemyLayers(text); } catch (_) {}
    };
    const applyBands = (c) => {
        if (c.bands[0] === bands[0] && c.bands[1] === bands[1]) return;
        bands = c.bands;
        last = '';
    };
    // between full scans (each scroll report): the found elements only
    const trackLayers = () => {
        if (!known.length || (target && target.isConnected)) return;
        const c = classify(known, innerWidth, innerHeight);
        applyBands(c);
        sendLayers(c);
    };
    // where the backdrop shows through, in document coordinates: a grid of points, each walked down the stack until
    // the backdrop (shows) or a box that hides it (a background, a picture, text). Edges snap to the boxes found.
    const sampleBackdrop = (fixedEls) => {
        const gen = ++visGen;
        const w = innerWidth;
        const h = innerHeight;
        const sy = scrollY;
        const g = Math.max(24, Math.min(48, Math.round(Math.sqrt(w * h / 600))));
        const colCount = Math.ceil(w / g);
        const rows = Math.ceil(h / g);
        const vis = new Uint8Array(colCount * rows);
        const boxes = new Array(colCount * rows);
        const coverCache = new Map();
        const pinned = scanPinned();
        const REPLACED = /^(IMG|VIDEO|CANVAS|SVG|IFRAME|EMBED|OBJECT|INPUT|TEXTAREA|SELECT|BUTTON|PICTURE)$/;
        const covers = (el) => {
            let v = coverCache.get(el);
            if (v !== undefined) return v;
            const cs = getComputedStyle(el);
            v = alphaOf(cs.backgroundColor) > 0.05 || cs.backgroundImage !== 'none' || REPLACED.test(el.tagName.toUpperCase());
            if (!v) for (const n of el.childNodes) { if (n.nodeType === 3 && /\S/.test(n.data)) { v = true; break; } }
            coverCache.set(el, v);
            return v;
        };
        let row = 0;
        const step = (deadline) => {
            visTimer = 0;
            if (gen !== visGen) return;
            const until = performance.now() + Math.max(3, Math.min(8, deadline && deadline.timeRemaining ? deadline.timeRemaining() : 6));
            for (; row < rows && performance.now() < until; row++) {
                const y = Math.min(h - 1, row * g + g / 2);
                for (let col = 0; col < colCount; col++) {
                    const x = Math.min(w - 1, col * g + g / 2);
                    const i = row * colCount + col;
                    for (const el of document.elementsFromPoint(x, y)) {
                        if (backdropEl ? (el === backdropEl || backdropEl.contains(el)) : (el === document.body || el === document.documentElement)) { vis[i] = 1; break; }
                        if (el === document.body || el === document.documentElement) break;
                        const pin = pinned(el);
                        if (pin && fixedEls.has(pin)) continue;
                        if (covers(el)) {
                            const r = el.getBoundingClientRect();
                            boxes[i] = [r.left, r.top, r.right, r.bottom];
                            break;
                        }
                    }
                }
            }
            if (row < rows) { visTimer = requestIdleCallback(step, { timeout: 400 }); return; }
            if (Math.abs(scrollY - sy) > 0.5 || innerWidth !== w || innerHeight !== h) return;
            // each visible cell's own box: its edges snap to the boxes beside it (left, right, above, below), so a
            // margin beside a card is not cut where the card is
            const cell = (i, j) => {
                let x0 = i * g;
                let x1 = Math.min(w, (i + 1) * g);
                let y0 = j * g;
                let y1 = Math.min(h, (j + 1) * g);
                const left = i > 0 && !vis[j * colCount + i - 1] ? boxes[j * colCount + i - 1] : null;
                if (left && left[2] > x0 - g && left[2] < x0 + g) x0 = Math.max(0, left[2]);
                const right = i + 1 < colCount && !vis[j * colCount + i + 1] ? boxes[j * colCount + i + 1] : null;
                if (right && right[0] > x1 - g && right[0] < x1 + g) x1 = Math.min(w, right[0]);
                const above = j > 0 && !vis[(j - 1) * colCount + i] ? boxes[(j - 1) * colCount + i] : null;
                if (above && above[3] > y0 - g && above[3] < y0 + g) y0 = Math.max(0, above[3]);
                const below = j + 1 < rows && !vis[(j + 1) * colCount + i] ? boxes[(j + 1) * colCount + i] : null;
                if (below && below[1] > y1 - g && below[1] < y1 + g) y1 = Math.min(h, below[1]);
                return [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)];
            };
            const rects = [];
            const open = [];
            for (let j = 0; j < rows; j++) {
                // cells side by side with the same top and bottom make one run
                const runs = [];
                for (let i = 0; i < colCount; i++) {
                    if (!vis[j * colCount + i]) continue;
                    const c = cell(i, j);
                    if (c[2] - c[0] < 1 || c[3] - c[1] < 1) continue;
                    const last = runs[runs.length - 1];
                    if (last && last[2] >= c[0] - 1 && last[1] === c[1] && last[3] === c[3] && last.end === i - 1) { last[2] = c[2]; last.end = i; continue; }
                    c.end = i;
                    runs.push(c);
                }
                for (const run of runs) {
                    const up = open.find((o) => o[0] === run[0] && o[2] === run[2] && Math.abs(o[3] - run[1]) <= 1);
                    if (up) { up[3] = run[3]; up.row = j; }
                    else { const rect = [run[0], run[1], run[2], run[3]]; rect.row = j; rects.push(rect); open.push(rect); }
                }
                for (let k = open.length - 1; k >= 0; k--) if (open[k].row !== j) open.splice(k, 1);
            }
            const r = rects.length > 160 ? [] : rects.map((q) => [q[0], q[1] + Math.round(sy), q[2] - q[0], q[3] - q[1]]);
            // columns where it shows on (nearly) every row (a page's margins): the viewer keeps it still there on rows
            // not sampled yet (the over-render band, rows a fast scroll brings in)
            const cols = [];
            for (let i = 0; i < colCount; i++) {
                let n = 0;
                for (let j = 0; j < rows; j++) n += vis[j * colCount + i];
                if (n < rows * 0.9) continue;
                let x0 = i * g;
                let x1 = Math.min(w, (i + 1) * g);
                const last = cols[cols.length - 1];
                if (last && last[1] === x0) { last[1] = x1; continue; }
                cols.push([x0, x1]);
            }
            // their edges snap to the boxes beside them (the first row that has one)
            for (const c of cols) {
                const li = Math.round(c[0] / g) - 1;
                const ri = Math.round(c[1] / g);
                for (let j = 0; j < rows; j++) {
                    const left = li >= 0 ? boxes[j * colCount + li] : null;
                    if (left && left[2] > c[0] - g && left[2] < c[0] + g) { c[0] = Math.max(0, Math.round(left[2])); break; }
                }
                for (let j = 0; j < rows; j++) {
                    const right = ri < colCount ? boxes[j * colCount + ri] : null;
                    if (right && right[0] > c[1] - g && right[0] < c[1] + g) { c[1] = Math.min(w, Math.round(right[0])); break; }
                }
            }
            visDone.push([sy, sy + h]);
            if (visDone.length > 24) visDone.shift();
            sendLayers(classify(known, w, h), { v: { d0: Math.round(sy), d1: Math.round(sy + h), r, cols } });
        };
        visTimer = requestIdleCallback(step, { timeout: 400 });
    };
    const scanLayers = () => {
        bandsTimer = 0;
        if (target && target.isConnected) return;
        const w = innerWidth;
        const h = innerHeight;
        if (!w || !h) return;
        const size = w + 'x' + h;
        const resized = size !== lastSize;
        lastSize = size;
        const pinned = scanPinned();
        const found = new Map();
        const xs = [0.02, 0.05, 0.18, 0.3, 0.42, 0.5, 0.58, 0.7, 0.82, 0.95, 0.98];
        const ys = [0.002, 0.03, 0.08, 0.15, 0.3, 0.45, 0.6, 0.75, 0.92, 0.97, 0.998];
        for (const fx of xs) {
            for (const fy of ys) {
                const stack = document.elementsFromPoint(w * fx, h * fy);
                const seen = new Set();
                for (const el of stack) {
                    const pin = pinned(el);
                    if (!pin || seen.has(pin)) continue;
                    seen.add(pin);
                    let rec = found.get(pin);
                    if (!rec) { rec = { el: pin, hits: 0, top: 0 }; found.set(pin, rec); }
                    rec.hits += 1;
                    if (stack[0] && pin.contains(stack[0])) rec.top += 1;
                }
            }
        }
        const list = Array.from(found.values()).map((rec) => ({ el: rec.el, onTop: rec.top * 2 > rec.hits }));
        const c = classify(list, w, h);
        known = c.keep;
        backdropEl = c.backdrop;
        backdropHost = null;
        if (!backdropEl) {
            for (const host of [document.documentElement, document.body]) {
                if (!host || backdropHost) continue;
                const hs = getComputedStyle(host);
                if (/fixed/.test(hs.backgroundAttachment) && hs.backgroundImage !== 'none') backdropHost = host;
                for (const ps of ['::before', '::after']) {
                    const p = getComputedStyle(host, ps);
                    if (p.content !== 'none' && p.position === 'fixed' && (p.backgroundImage !== 'none' || alphaOf(p.backgroundColor) > 0.05)) backdropHost = host;
                }
            }
        }
        applyBands(c);
        if (backdropEl || backdropHost) {
            sendLayers(c, resized ? { reset: 1 } : null);
            // rows already sampled at this layout (same view size and document height) are not sampled again
            const docH = document.documentElement.scrollHeight;
            if (resized || docH !== visLayout) { visDone = []; visLayout = docH; }
            const sy = scrollY;
            if (!visDone.some((d) => sy >= d[0] - 1 && sy + h <= d[1] + 1)) {
                const fixedEls = new Set(known.map((item) => item.el).filter((el) => el !== backdropEl));
                if (visTimer) cancelIdleCallback(visTimer);
                sampleBackdrop(fixedEls);
            }
        } else {
            sendLayers(c, resized ? { reset: 1 } : null);
        }
        queue(true);
    };
    const report = () => {
        queued = false;
        const el = scroller();
        if (!el) return;
        const root = !(target && target.isConnected);
        const next = [el.scrollTop, el.scrollHeight, el.clientHeight, el.scrollLeft, el.scrollWidth, el.clientWidth, root ? 1 : 0, bands[0], bands[1]].map(Math.round).join(':');
        if (next === last) return;
        last = next;
        try { globalThis.__alchemyScroll(next); } catch (_) {}
    };
    // noScan: a report only (the scan itself asks for one)
    const queue = (noScan) => {
        if (!queued) {
            queued = true;
            requestAnimationFrame(() => { trackLayers(); report(); });
            setTimeout(() => { if (queued) { trackLayers(); report(); } }, 100);
        }
        if (noScan === true) return;
        // a scroll moves the backdrop's sampled rows: the sampling waits for the next stop
        visGen += 1;
        if (bandsTimer) clearTimeout(bandsTimer);
        bandsTimer = setTimeout(scanLayers, 180);
    };
    globalThis.__alchemyScrollTo = (y, x) => {
        const el = scroller();
        if (!el) return;
        const to = { top: Number(y) || 0, behavior: 'instant' };
        if (Number.isFinite(x)) to.left = x;
        el.scrollTo(to);
    };
    addEventListener('scroll', (ev) => {
        const el = ev.target;
        if (el === document || el === document.documentElement || el === document.body) target = null;
        else if (el instanceof Element && big(el)) target = el;
        else return;
        queue();
    }, true);
    addEventListener('resize', queue);
    // a page that grows without a resize or a scroll (Bing's home page loads its feed later, its body keeps its box):
    // the height is read again when the pointer moves over it (at most once a second) and when the wheel turns, so the
    // viewer knows there is somewhere to scroll before the first turn (#990 round 2)
    let movedAt = 0;
    addEventListener('pointermove', () => {
        const now = Date.now();
        if (now - movedAt < 1000) return;
        movedAt = now;
        queue(true);
    }, { capture: true, passive: true });
    addEventListener('wheel', queue, { capture: true, passive: true });
    const observe = () => {
        queue();
        if (typeof ResizeObserver === 'function') {
            const sizes = new ResizeObserver(queue);
            sizes.observe(document.documentElement);
            if (document.body) sizes.observe(document.body);
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true });
    else observe();
    addEventListener('load', queue);
}

// The page's layers (watchScroll, #990): checked and bounded before they reach the viewers.
function parseLayers(payload) {
    let m = null;
    try { m = JSON.parse(String(payload || '')); } catch (_) { return null; }
    if (!m || typeof m !== 'object') return null;
    const nums = (a, n) => Array.isArray(a) && a.length >= n && a.slice(0, n).every((v) => v === null || Number.isFinite(v));
    const out = {
        type: 'layers',
        sy: Number(m.sy) || 0,
        w: Number(m.w) || 0,
        h: Number(m.h) || 0,
        f: (Array.isArray(m.f) ? m.f : []).filter((l) => nums(l, 5)).slice(0, 16).map((l) => l.slice(0, 11)),
        cover: m.cover ? 1 : 0,
        backdrop: m.backdrop ? 1 : 0,
        bg: typeof m.bg === 'string' && /^rgba?\([\d.,\s/%]+\)$/.test(m.bg) ? m.bg : ''
    };
    if (m.reset) out.reset = 1;
    if (m.v && Number.isFinite(m.v.d0) && Number.isFinite(m.v.d1) && Array.isArray(m.v.r)) {
        out.v = { d0: m.v.d0, d1: m.v.d1, r: m.v.r.filter((q) => nums(q, 4)).slice(0, 160).map((q) => q.slice(0, 4)) };
        out.v.cols = (Array.isArray(m.v.cols) ? m.v.cols : []).filter((c) => nums(c, 2)).slice(0, 16).map((c) => c.slice(0, 2));
    }
    return out;
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

// read per request, so a new viewer reaches the next page opened (ALCHEMY_VIEWER_FILE: a test instance's own copy)
function viewerHtml() {
    return fs.readFileSync(process.env.ALCHEMY_VIEWER_FILE || path.join(__dirname, 'viewer.html'));
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

const EXTENSION_BY_TYPE = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
    'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'application/pdf': 'pdf'
};

// CDN image paths often have no extension (pbs.twimg.com/media/X?format=jpg); the saved file needs one to open.
function withExtension(name, type) {
    const ext = EXTENSION_BY_TYPE[String(type || '').toLowerCase()];
    if (!ext || /\.[a-z0-9]{2,5}$/i.test(name)) return name;
    return safeFilename((name === 'download' && /^image\//i.test(type) ? 'image' : name) + '.' + ext);
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
    const pageBlob = parsed.protocol === 'blob:' && (() => {
        try { return new URL(parsed.pathname).origin === new URL(session.page.url()).origin; } catch (_) { return false; }
    })();
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'data:' && !ownExtension && !pageBlob) {
        const error = new Error('unsupported url');
        error.status = 400;
        throw error;
    }
    const filename = (type) => withExtension(filenameFromUrl(parsed), type);
    if (parsed.protocol === 'data:') {
        const match = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(targetUrl);
        if (!match) {
            const error = new Error('bad data url');
            error.status = 400;
            throw error;
        }
        const type = headerSafe(match[1], 'application/octet-stream');
        const buffer = match[3] ? Buffer.from(match[4], 'base64') : Buffer.from(decodeURIComponent(match[4]), 'utf8');
        return { type, buffer, filename: filename(type) };
    }
    // Chromium's own copy first: the page already loaded the image, and an in-page fetch() is refused by CORS / connect-src.
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const viaCdp = await readResourceViaCdp(session, targetUrl).catch(() => null);
        if (viaCdp) {
            const type = headerSafe(String(viaCdp.type || '').split(';')[0], 'application/octet-stream');
            return { type, buffer: viaCdp.buffer, filename: filenameFromDisposition(viaCdp.disposition) || filename(type) };
        }
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
    const type = headerSafe(String(result.type || '').split(';')[0], 'application/octet-stream');
    return {
        type,
        buffer: Buffer.from(result.data, 'base64'),
        filename: filenameFromDisposition(result.disposition) || filename(type)
    };
}

const RESOURCE_MAX_BYTES = 20 * 1024 * 1024;

function findFrameResource(tree, url) {
    if (!tree) return null;
    const hit = (tree.resources || []).find((r) => r.url === url);
    if (hit) return { frameId: tree.frame.id, mimeType: hit.mimeType || '' };
    for (const child of tree.childFrames || []) {
        const found = findFrameResource(child, url);
        if (found) return found;
    }
    return null;
}

// Page.getResourceContent serves what the page already has (no network, works for CDN images);
// Network.loadNetworkResource fetches in the page's frame with its cookies but outside CORS.
async function readResourceViaCdp(session, url) {
    const cdp = session.cdp;
    let tree = null;
    try { tree = (await cdp.send('Page.getResourceTree')).frameTree; } catch (_) {}
    const known = findFrameResource(tree, url);
    if (known) {
        try {
            const body = await cdp.send('Page.getResourceContent', { frameId: known.frameId, url });
            const buffer = Buffer.from(body.content || '', body.base64Encoded ? 'base64' : 'utf8');
            if (buffer.length && buffer.length <= RESOURCE_MAX_BYTES) return { type: known.mimeType, buffer, disposition: '' };
        } catch (_) {}
    }
    const frameId = (tree && tree.frame && tree.frame.id) || session.mainFrameId;
    if (!frameId) return null;
    const loaded = await cdp.send('Network.loadNetworkResource', {
        frameId,
        url,
        options: { disableCache: false, includeCredentials: true }
    });
    const resource = loaded && loaded.resource;
    if (!resource || !resource.success || !resource.stream || (resource.httpStatusCode && resource.httpStatusCode >= 400)) {
        if (resource && resource.stream) cdp.send('IO.close', { handle: resource.stream }).catch(() => {});
        return null;
    }
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const part = await cdp.send('IO.read', { handle: resource.stream, size: 1024 * 1024 });
            const chunk = Buffer.from(part.data || '', part.base64Encoded ? 'base64' : 'utf8');
            total += chunk.length;
            if (total > RESOURCE_MAX_BYTES) return null;
            chunks.push(chunk);
            if (part.eof) break;
        }
    } finally {
        cdp.send('IO.close', { handle: resource.stream }).catch(() => {});
    }
    const headers = {};
    for (const [key, value] of Object.entries(resource.headers || {})) headers[key.toLowerCase()] = String(value);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) return null;
    return { type: headers['content-type'] || '', buffer, disposition: headers['content-disposition'] || '' };
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
        if (ws.readyState !== 1) continue;
        ws.send(data);
        ws.sentAt = Date.now();
        // what each viewer was sent (binary: frames, tiles, audio), against what it says it got (automatic quality)
        if (binary) ws.txBytes = (ws.txBytes || 0) + data.length;
    }
}

// ---- automatic quality (Yukimi, Nov 21: "auto quality control and info so we can tell what encoder were using and
// what settings it has selected, and whats the best way to detect the ranges") ----
// Each viewer reports every 2 s what it received (binary bytes and frames, its decode time; viewer.html probeRtt).
// The link's range comes from three signals, as WebRTC's congestion control reads them:
//   queue delay  the RTT over the best RTT of the last 30 s: a link at its limit queues, so its delay grows first
//   in flight    bytes sent to the viewer and not received yet, in milliseconds of the rate it is receiving at
//   decode time  how long the viewer takes to decode a frame: the device's own frame rate ceiling
// A queue steps quality down at once (two steps when it is long); after 6 s calm it steps up one, and a step up
// that brings a queue back holds the next one off for a minute. Steps trade JPEG quality, frame rate and the
// tiles' WebP quality together; a slow decoder caps the frame rate.
const AQ_LEVELS = [
    { q: 85, fps: 60, rq: 85 },
    { q: 80, fps: 60, rq: 80 },
    { q: 75, fps: 45, rq: 78 },
    { q: 70, fps: 30, rq: 74 },
    { q: 62, fps: 30, rq: 68 },
    { q: 55, fps: 24, rq: 62 },
    { q: 48, fps: 20, rq: 56 },
    { q: 40, fps: 15, rq: 48 },
    { q: 34, fps: 10, rq: 42 }
];
const AQ_START = 3;
const AQ_CALM_MS = 6000;
const AQ_HOLD_MS = 60000;

function aqState(session) {
    if (!session.aq) session.aq = { auto: true, level: AQ_START, changedAt: 0, holdUntil: 0, upAt: 0, why: 'start', fpsCap: 60, link: {} };
    return session.aq;
}

function applyAutoQuality(session) {
    const aq = aqState(session);
    if (!aq.auto) return;
    const step = AQ_LEVELS[aq.level];
    const s = session.settings;
    const quality = step.q;
    s.maxFps = Math.max(1, Math.min(step.fps, aq.fpsCap || 60));
    s.minFps = Math.min(s.minFps, s.maxFps);
    s.regionQuality = step.rq;
    if (s.jpegQuality !== quality) {
        s.jpegQuality = quality;
        restartScreencast(session).catch(() => {});
    }
}

function encoderInfo(session) {
    const aq = aqState(session);
    const s = session.settings;
    return {
        type: 'encoder',
        auto: aq.auto ? 1 : 0,
        level: aq.level,
        levels: AQ_LEVELS.length,
        why: aq.why,
        source: 'Chromium screencast',
        codec: 'JPEG',
        q: s.jpegQuality,
        minFps: s.minFps,
        maxFps: s.maxFps,
        tiles: 'WebP',
        rq: s.regionQuality,
        scroll: slowLink(session) ? 'packs' : 'frames',
        // JPEG XL: whether this viewer can show it, the server's mode, whether frames went as JXL in the last 10 s,
        // and what a repack costs and saves here
        jxl: session.jxlSentAt && Date.now() - session.jxlSentAt < 10000 ? 1 : 0,
        jxlMode: JXL_MODE,
        jxlViewer: session.jxl ? 1 : 0,
        jxlMs: Math.round(jxlStats.ms),
        // the view at rest sent again as JPEG XL from a lossless capture, at this distance (0: not for this viewer)
        refine: jxlRefine(session) ? REFINE_DISTANCE[aq.level] || 1 : 0,
        jxlSaves: Math.round((1 - jxlStats.ratio) * 100),
        // the page's layers the viewer keeps apart while it scrolls ahead (watchScroll)
        layers: session.layers ? {
            fixed: session.layers.f.filter((l) => !l[4]).length,
            sticky: session.layers.f.filter((l) => l[4]).length,
            backdrop: session.layers.backdrop,
            cover: session.layers.cover,
            sampled: session.layersVis ? session.layersVis.r.length : 0,
            bands: session.scroll ? [session.scroll.bandTop || 0, session.scroll.bandBottom || 0] : [0, 0]
        } : null,
        ratio: Math.round((session.pxPerDip || 1) * 100) / 100,
        width: Math.round((session.dipWidth || session.width || 0) * (session.pxPerDip || 1)),
        height: Math.round((session.dipHeight || session.height || 0) * (session.pxPerDip || 1)),
        link: aq.link
    };
}

function noteViewerReport(session, ws, rep) {
    if (!rep || typeof rep !== 'object' || !Number.isFinite(rep.rx)) return;
    const aq = aqState(session);
    const now = Date.now();
    const st = ws.aqStat || (ws.aqStat = { at: now, rx: 0, rtts: [], good: 0 });
    const dt = Math.max(1, now - st.at);
    const rxDelta = Math.max(0, rep.rx - st.rx);
    st.at = now;
    st.rx = rep.rx;
    // receiving rate (bytes/s), smoothed; only intervals that carried something say anything about the link
    if (rxDelta > 4096) st.good = st.good ? st.good * 0.6 + (rxDelta * 1000 / dt) * 0.4 : rxDelta * 1000 / dt;
    const rtt = session.rttMs || 0;
    if (rtt > 0) {
        st.rtts.push([now, rtt]);
        while (st.rtts.length && now - st.rtts[0][0] > 30000) st.rtts.shift();
    }
    const base = st.rtts.length ? Math.min(...st.rtts.map((r) => r[1])) : rtt;
    const queue = Math.max(0, rtt - base);
    const inFlight = Math.max(0, (ws.txBytes || 0) - rep.rx);
    const flightMs = st.good > 0 ? inFlight * 1000 / st.good : 0;
    const dec = Number(rep.dec) || 0;
    // the device's ceiling: a frame every decode time plus a margin
    aq.fpsCap = dec > 4 ? Math.max(5, Math.min(60, Math.floor(1000 / (dec * 1.25)))) : 60;
    aq.link = { rtt: Math.round(rtt), base: Math.round(base), queueMs: Math.round(queue), kbps: Math.round(st.good * 8 / 1000), inFlightMs: Math.round(flightMs), decMs: Math.round(dec * 10) / 10, fpsCap: aq.fpsCap, frames: Number(rep.n) || 0 };
    if (!aq.auto) return;
    const before = aq.level;
    const congested = queue > Math.max(60, base * 0.5) || (inFlight > 65536 && flightMs > 400);
    const severe = queue > Math.max(250, base * 2) || (inFlight > 131072 && flightMs > 1200);
    // a step down needs time to show: the queue it was meant for drains first (else it falls to the bottom while the
    // RTT still carries the old queue)
    const settling = aq.downAt && now - aq.downAt < Math.max(2500, rtt * 2);
    if (congested && !settling) {
        aq.level = Math.min(AQ_LEVELS.length - 1, aq.level + (severe ? 2 : 1));
        aq.downAt = now;
        // a step up that brought the queue back: the next one waits
        if (now - aq.upAt < 10000) aq.holdUntil = now + AQ_HOLD_MS;
        aq.why = severe ? 'link queueing (' + Math.round(queue) + ' ms over its best, ' + Math.round(flightMs) + ' ms in flight)' : 'link queueing (' + Math.round(queue) + ' ms over its best)';
        aq.changedAt = now;
    } else if (!congested && queue < 30 && flightMs < 200 && now - aq.changedAt > AQ_CALM_MS && now > aq.holdUntil && aq.level > 0 && rxDelta > 0) {
        aq.level -= 1;
        aq.upAt = now;
        aq.changedAt = now;
        aq.why = 'link calm: one step up';
    }
    const capBefore = session.settings.maxFps;
    applyAutoQuality(session);
    if (aq.level !== before || session.settings.maxFps !== capBefore) broadcast(session, encoderInfo(session));
}

function livePageUrl(session) {
    // the main frame's last commit (Page.frameNavigated): on Chromium's own error page (a bad certificate, no such
    // host) it is the address that failed, where page.url() still says the page before, so the address bar can be
    // corrected (Yukimi, Nov 21)
    if (session.committedUrl && /^(https?:|chrome(-extension)?:)/i.test(session.committedUrl)) return session.committedUrl;
    try {
        const current = session.page.url();
        if (/^(https?:|chrome(-extension)?:)/i.test(current)) return current;
    } catch (_) {}
    return '';
}

function publishLocation(session) {
    const live = livePageUrl(session);
    // While Page.navigate is still outstanding, page.url() is often still the previous page.
    // Prefer the in-flight target so the address bar does not snap back until commit (or failure).
    if (live) {
        if (session.navTarget && session.navigating && live !== session.navTarget) {
            // keep session.url as the advertised target
        } else {
            session.url = live;
            if (session.navTarget && live === session.navTarget) session.navTarget = '';
        }
    }
    const url = (session.navigating && session.navTarget) || session.url || live || '';
    broadcast(session, {
        type: session.navigating ? 'navigating' : 'location',
        url,
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

// Scrolling moves every pixel: run at maxFps for a moment instead of the RTT pace, so the page glides instead of stepping.
const SCROLL_BURST_MS = 600;

function scrollBurst(session) {
    return Date.now() < (session.scrollBurstUntil || 0);
}

function frameIntervalMs(session) {
    const rtt = session.rttMs || 50;
    const fastest = Math.round(1000 / session.settings.maxFps);
    if (scrollBurst(session)) return fastest;
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

// ---- what goes on the wire for a frame (#990 round 2) ----
// A frame that changed little goes as tiles (WebP: 25-45 % smaller than JPEG for page content, and a 64 px tile fits
// one packet of a 1428-byte mobile MTU). A scrolled frame goes as a scroll pack: "move these rows by dy" plus the
// tiles that differ after the move (the revealed strip, anything that changed). That only works if the moved rows
// encode the same: JPEG's 16 x 16 colour blocks re-encode identically only when content moves by a multiple of 16
// pixels (measured: 32 px -> nothing but the revealed strip differs; 37 or 40 px -> 75-95 % of tiles differ), so
// wheel steps are sent in multiples of 16 frame pixels and Chromium's own smooth scrolling is off (the viewer
// animates). The fixed bars (bandTop / bandBottom from the page) do not move with the rows; they are compared in
// place like any other area, so a header that did not change costs nothing.
const REGION_TILE = 32;
const SCROLL_ALIGN = 16;
// a frame that takes longer than this to pack goes whole (scroll packs save far more bytes than they cost in time)
const PACK_BUDGET_MS = 90;
const PACK_DEBUG = process.env.ALCHEMY_DEBUG_PACK === '1';
// A scrolled frame is packed (decoded, compared, re-encoded: 20-60 ms on this host's CPU) only for a viewer whose
// link is slow enough that the bytes cost more than that: a whole 150 KB frame is ~120 ms on 10 Mbit/s mobile data.
// On a fast link (LAN) it goes whole at once, as Chromium encoded it. ALCHEMY_PACK_RTT_MS=0: always pack.
const PACK_RTT_MS = Number.isFinite(Number(process.env.ALCHEMY_PACK_RTT_MS)) && process.env.ALCHEMY_PACK_RTT_MS !== ''
    ? Number(process.env.ALCHEMY_PACK_RTT_MS) : 30;

// ---- JPEG XL for whole frames on slow links (#990 round 2) ----
// jxl-pipe (jxl/jxl-pipe.c, built by jxl/build-jxl-pipe.sh) repacks Chromium's JPEG into JPEG XL without decoding it:
// lossless (the same pixels), 21-42 % smaller on real pages (Wikipedia 109 -> 86 KB, YouTube 27 -> 16 KB) for 23-34 ms
// on this host's CPU. Worth it only where bytes cost more than that, and only for a viewer that decodes image/jxl
// (Chromium 156 and the phone's WebView 157 do). One helper process; requests answer in order.
// Automatic (Yukimi, Nov 21: "On the fold desktop I dont see JPEG XL ... do we have to do somethiing to enable it"):
// a whole frame is repacked for a viewer that can show JPEG XL when the bytes it saves take longer to send over
// that viewer's link (automatic quality's measured rate) than the repack takes here (measured: 60-100 ms on this
// busy 4-core host, ~10 ms on the DL580). ALCHEMY_JXL=1: on every slow link (RTT >= PACK_RTT_MS); 0: never.
const JXL_MODE = process.env.ALCHEMY_JXL === '1' ? 'on' : process.env.ALCHEMY_JXL === '0' ? 'off' : 'auto';
const JXL_ON = JXL_MODE !== 'off';
// what a repack costs and saves, as it runs (smoothed): ms, and the JXL's size over the JPEG's
const jxlStats = { ms: 80, ratio: 0.8, n: 0 };
const JXL_PIPE = process.env.ALCHEMY_JXL_PIPE || path.join(DATA_DIR, 'alchemy-jxl-pipe');
const JXL_TIMEOUT_MS = 120;
const jxl = { proc: null, buf: Buffer.alloc(0), queue: [], broken: false };

function jxlAvailable() {
    return JXL_ON && !jxl.broken && fs.existsSync(JXL_PIPE);
}

function jxlStart() {
    if (jxl.proc) return jxl.proc;
    // effort 3, half the cores (libjxl's thread pool; the pipe built before Nov 21 takes no second argument)
    const proc = spawn(JXL_PIPE, ['3', String(Math.max(1, Math.floor(os.cpus().length / 2)))], { stdio: ['pipe', 'pipe', 'ignore'] });
    jxl.proc = proc;
    jxl.buf = Buffer.alloc(0);
    proc.stdout.on('data', (chunk) => {
        jxl.buf = jxl.buf.length ? Buffer.concat([jxl.buf, chunk]) : chunk;
        while (jxl.buf.length >= 4) {
            const n = jxl.buf.readUInt32LE(0);
            if (jxl.buf.length < 4 + n) break;
            const out = n ? Buffer.from(jxl.buf.subarray(4, 4 + n)) : null;
            jxl.buf = jxl.buf.subarray(4 + n);
            const waiter = jxl.queue.shift();
            if (waiter) waiter(out);
        }
    });
    const gone = () => {
        if (jxl.proc !== proc) return;
        jxl.proc = null;
        for (const waiter of jxl.queue.splice(0)) waiter(null);
    };
    proc.once('exit', gone);
    proc.once('error', () => { jxl.broken = true; gone(); });
    proc.stdin.on('error', () => {});
    return proc;
}

// JPEG XL from 8-bit RGB / RGBA pixels (a lossless capture; RGBA keeps transparency), at a Butteraugli distance
// (1.0: visually lossless; 0 with lossless). The view at rest goes this way (Yukimi, Nov 21: "I want JPEG XL by
// default as layers can use transparentcy and would be always better quality"): on this host ~70 ms for 1200 x 900
// with the pipe's threads, about the bytes of a quality-70 JPEG at distance 1.
function jxlEncodePixels(pixels, width, height, channels, distance, lossless) {
    if (!jxlAvailable()) return Promise.resolve(null);
    const proc = jxlStart();
    return new Promise((resolve) => {
        let done = false;
        const finish = (out) => { if (!done) { done = true; resolve(out); } };
        jxl.queue.push(finish);
        setTimeout(() => finish(null), 2000).unref();
        const head = Buffer.alloc(16);
        head.writeUInt32LE(((12 + pixels.length) | 0x80000000) >>> 0, 0);
        head.writeUInt32LE(width, 4);
        head.writeUInt32LE(height, 8);
        head[12] = channels;
        head[13] = lossless ? 1 : 0;
        head.writeUInt16LE(Math.round(Math.max(0.1, Math.min(25, distance || 1)) * 100), 14);
        proc.stdin.write(head);
        proc.stdin.write(pixels);
    });
}

// the JXL of a JPEG, or null (no helper, a failure, too slow: the JPEG goes instead)
function jxlRepack(jpeg) {
    if (!jxlAvailable()) return Promise.resolve(null);
    const proc = jxlStart();
    const t0 = Date.now();
    return new Promise((resolve) => {
        let done = false;
        const finish = (out) => {
            if (done) return;
            done = true;
            const ms = Date.now() - t0;
            jxlStats.ms = jxlStats.n ? jxlStats.ms * 0.7 + ms * 0.3 : ms;
            if (out) jxlStats.ratio = jxlStats.n ? jxlStats.ratio * 0.7 + (out.length / jpeg.length) * 0.3 : out.length / jpeg.length;
            jxlStats.n += 1;
            resolve(out);
        };
        jxl.queue.push(finish);
        setTimeout(() => finish(null), JXL_TIMEOUT_MS).unref();
        const head = Buffer.allocUnsafe(4);
        head.writeUInt32LE(jpeg.length, 0);
        proc.stdin.write(head);
        proc.stdin.write(jpeg);
    });
}

// a whole frame for this viewer: JPEG XL on a slow link when it can show it and it is smaller, else the JPEG as is
// worth repacking for this session's slowest viewer: the send time it saves against what a repack costs here
function jxlWorth(session, bytes) {
    if (!session.jxl || !jxlAvailable()) return false;
    if (JXL_MODE === 'on') return slowLink(session);
    const kbps = session.aq && session.aq.link && session.aq.link.kbps;
    if (!kbps) return false;
    const savedMs = bytes * (1 - jxlStats.ratio) * 8 / kbps;
    return savedMs > jxlStats.ms * 1.2;
}

async function wholeFrame(session, jpeg, header, why) {
    if (jxlWorth(session, jpeg.length)) {
        const out = await jxlRepack(jpeg);
        if (out && out.length < jpeg.length) {
            session.jxlSentAt = Date.now();
            return { whole: binaryMessage(MSG_FRAME, Object.assign({}, header, { f: 'jxl' }), out), why: (why || 'size') + ', jxl ' + out.length + ' of ' + jpeg.length };
        }
    }
    return { binary: jpeg, why };
}

// #990 round 2: Chromium has handled the viewer's wheel turns up to seq (its renderer acknowledged them, after the
// page's own wheel handlers); the frames after this show where they took the page. The viewer keeps scrolling ahead
// of the page until then (a busy page such as Bing takes 0.6 s), instead of gliding back to an old offset.
function wheelDone(session, seq) {
    if (!seq) return;
    broadcast(session, { type: 'wheel-done', seq, t: Date.now() });
}

function slowLink(session) {
    return (session.rttMs || 0) >= PACK_RTT_MS;
}

// the page's root scroll moved since the frame before (CSS pixels); no decode needed to know
function scrolledSince(session, header) {
    const prev = session.pixelsHeader;
    return !!(header && prev && header.p && prev.p && Math.abs((header.sy || 0) - (prev.sy || 0)) * (header.k || 1) >= 0.5);
}
// the wheel's left-over distance (under a step) goes this long after the last turn
const WHEEL_REST_MS = 160;
// tiles that differ by at most this per channel are the same picture (two JPEG decoders round differently)
const PIXEL_TOLERANCE = 2;

function rowsEqual(prev, next, prevStart, nextStart, bytes) {
    if (prev.compare(next, nextStart, nextStart + bytes, prevStart, prevStart + bytes) === 0) return true;
    for (let i = 0; i < bytes; i++) {
        const d = prev[prevStart + i] - next[nextStart + i];
        if (d > PIXEL_TOLERANCE || d < -PIXEL_TOLERANCE) return false;
    }
    return true;
}

// src[y]: the previous frame's row that new row y should equal (-1: none, the row is new)
function tileChanged(prev, next, stride, x, y, w, h, src) {
    const bytes = w * 4;
    for (let row = y; row < y + h; row++) {
        const from = src[row];
        if (from < 0) return true;
        if (!rowsEqual(prev, next, (from * stride + x) * 4, (row * stride + x) * 4, bytes)) return true;
    }
    return false;
}

// Changed tiles as rectangles: runs along each tile row, merged downwards when the run below has the same span.
// Whole rows are compared first (one native compare a row); only a band with a differing row is split into tiles.
function dirtyRects(prev, next, width, height, src) {
    const rects = [];
    let open = [];
    const rowBytes = width * 4;
    for (let y = 0; y < height; y += REGION_TILE) {
        const th = Math.min(REGION_TILE, height - y);
        let bandSame = true;
        for (let row = y; row < y + th; row++) {
            const from = src[row];
            if (from < 0 || prev.compare(next, row * rowBytes, (row + 1) * rowBytes, from * rowBytes, (from + 1) * rowBytes) !== 0) {
                bandSame = false;
                break;
            }
        }
        if (bandSame) {
            open = [];
            continue;
        }
        const runs = [];
        let runX = -1;
        for (let x = 0; x < width; x += REGION_TILE) {
            const tw = Math.min(REGION_TILE, width - x);
            if (tileChanged(prev, next, width, x, y, tw, th, src)) {
                if (runX < 0) runX = x;
            } else if (runX >= 0) {
                runs.push({ x: runX, w: x - runX });
                runX = -1;
            }
        }
        if (runX >= 0) runs.push({ x: runX, w: width - runX });
        const still = [];
        for (const run of runs) {
            const above = open.find((r) => r.x === run.x && r.w === run.w && r.y + r.h === y);
            if (above) {
                above.h += th;
                still.push(above);
            } else {
                const rect = { x: run.x, y, w: run.w, h: th };
                rects.push(rect);
                still.push(rect);
            }
        }
        open = still;
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

// Rows of a desktop frame that scroll with the page: the viewport between its fixed bars, and the over-render
// band below the viewport (frame pixels).
function scrollSegments(session, header, height) {
    const k = header.k || 1;
    const scroll = session.scroll || {};
    const vh = header.vh > 0 && header.vh < height ? header.vh : height;
    const top = Math.max(0, Math.min(vh, Math.round((scroll.bandTop || 0) * k)));
    const bottom = Math.max(0, Math.min(vh - top, Math.round((scroll.bandBottom || 0) * k)));
    const segs = [[top, vh - bottom]];
    if (vh < height) segs.push([vh, height]);
    return segs.filter((seg) => seg[1] > seg[0]);
}

async function packFrame(session, jpeg, gen, header) {
    if (!sharp) return { binary: jpeg };
    // a scroll on a fast link, or one off the JPEG block grid (a page's own scroll, a scrollbar drag): whole, with
    // no decode (and the next frame is compared to nothing)
    if (scrolledSince(session, header)) {
        const moved = (header.sy - session.pixelsHeader.sy) * (header.k || 1);
        const offGrid = Math.abs(moved - Math.round(moved / SCROLL_ALIGN) * SCROLL_ALIGN) > 0.3;
        if (!slowLink(session) || offGrid) {
            session.pixels = null;
            session.pixelsHeader = header;
            return wholeFrame(session, jpeg, header, offGrid ? 'unaligned ' + moved.toFixed(1) : 'fast link scroll');
        }
    }
    const stale = () => gen != null && session.packGen !== gen;
    const t0 = PACK_DEBUG ? process.hrtime.bigint() : 0n;
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
    const prevHeader = session.pixelsHeader;
    const sameSize = prev && session.pixelWidth === width && session.pixelHeight === height && prev.length === next.length;
    session.pixels = next;
    session.pixelsHeader = header;
    session.pixelWidth = width;
    session.pixelHeight = height;
    if (!sameSize) return wholeFrame(session, jpeg, header, 'first');
    // how far the rows moved since the last frame (frame pixels; a page scroll, not one of the viewer's own guesses)
    let dy = 0;
    let segs = null;
    if (header && prevHeader && header.p && prevHeader.p && header.k && Math.abs(header.k - prevHeader.k) < 1e-6
        && (session.scroll || {}).root !== 0) {
        const moved = (header.sy - prevHeader.sy) * header.k;
        if (Math.abs(moved) >= 0.5) {
            // not on the JPEG block grid (a page's own scroll, a scrollbar drag): a whole frame is smaller than tiles
            if (Math.abs(moved - Math.round(moved / SCROLL_ALIGN) * SCROLL_ALIGN) > 0.3) return wholeFrame(session, jpeg, header, 'unaligned ' + moved.toFixed(1));
            dy = Math.round(moved);
            segs = scrollSegments(session, header, height);
        }
    }
    const src = new Int32Array(height);
    for (let y = 0; y < height; y++) src[y] = y;
    const ops = [];
    if (dy) {
        // rows in a scrolling segment come from dy further on in the previous frame, if that row scrolled too
        const inSeg = (y) => segs.some((seg) => y >= seg[0] && y < seg[1]);
        let run = null;
        for (let y = 0; y < height; y++) {
            if (!inSeg(y)) {
                run = null;
                continue;
            }
            const from = y + dy;
            if (from >= 0 && from < height && inSeg(from)) {
                src[y] = from;
                if (run && run.dst + run.rows === y && run.src + run.rows === from) run.rows += 1;
                else ops.push(run = { dst: y, src: from, rows: 1 });
            } else {
                src[y] = -1;
                run = null;
            }
        }
    }
    const t1 = PACK_DEBUG ? process.hrtime.bigint() : 0n;
    const rects = dirtyRects(prev, next, width, height, src);
    if (PACK_DEBUG) session.packTimes = 'decode ' + (Number(t1 - t0) / 1e6).toFixed(1) + ' diff ' + (Number(process.hrtime.bigint() - t1) / 1e6).toFixed(1);
    if (!rects.length && !dy) return { skip: true };
    let area = 0;
    for (const rect of rects) area += rect.w * rect.h;
    if (area > width * height * (dy ? 0.7 : 0.4) || rects.length > (dy ? 48 : 24)) return wholeFrame(session, jpeg, header, 'area ' + Math.round(area / (width * height) * 100) + '% in ' + rects.length);
    // what shows first: rects in the viewport before the over-render band, top to bottom
    const vh = header && header.vh > 0 ? header.vh : height;
    rects.sort((a, b) => ((a.y >= vh) - (b.y >= vh)) || (a.y - b.y) || (a.x - b.x));
    const regions = [];
    const bodies = [];
    let total = 0;
    for (const rect of rects) {
        const encoded = await sharp(cropRGBA(next, width, rect), {
            raw: { width: rect.w, height: rect.h, channels: 4 }
        }).webp({ quality: session.settings.regionQuality, effort: 2 }).toBuffer();
        if (stale()) return { stale: true };
        total += encoded.length;
        if (total > jpeg.length * 0.7) return wholeFrame(session, jpeg, header, 'bytes ' + total + ' of ' + jpeg.length);
        regions.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, n: encoded.length });
        bodies.push(encoded);
    }
    if (stale()) return { stale: true };
    // tiles (or the move and its tiles) patch the frame before them; the header is this frame's (scroll offset, time)
    const extra = { width, height, f: 'webp', rects: regions };
    if (dy) {
        extra.dy = dy;
        extra.ops = ops.map((op) => [op.dst, op.src, op.rows]);
    }
    return { tiles: binaryMessage(dy ? MSG_SCROLL : MSG_TILES, Object.assign({}, header, extra), Buffer.concat(bodies)) };
}

// Full-resolution still (Yozora #709). Chromium's screencast sends frames at the CSS viewport size
// whatever the device scale (measured headless and headful, Chromium 154/156: a 391 x 612 viewport
// at DSF 1.96 gives 391 x 612 frames with maxWidth 766, 1501 or 3000), so a zoomed session (zoom > 1)
// or a phone that wants device pixels gets soft frames. Once the screencast has been quiet for a
// moment, Page.captureScreenshot with a clip scale gives the same view at the wanted scale; the viewer
// draws it over the frame until the next frame. Frames stay the motion path; no still at scale 1.
const STILL_SETTLE_MS = 350;
const STILL_MIN_GAP_MS = 1200;
const STILL_MAX_GAP_MS = 8000;
const STILL_MAX_PIXELS = 1920 * 1440;
const STILL_MAX_SCALE = 4;
// One still on the way at a time: the viewer acks each one ('still-ack'), so a slow link (the
// phone's relay) never queues stills ahead of frames; an old viewer that never acks gets one per 10 s.
const STILL_ACK_WAIT_MS = 10000;
// A link this slow (the viewer's measured round trip, relay queue included) waits for a still.
const STILL_MAX_RTT_MS = 1000;

// a screencast frame's pixel size from its JPEG header (base64; only the first few KB are read)
function jpegDims(b64) {
    let buf;
    try { buf = Buffer.from(String(b64 || '').slice(0, 8192), 'base64'); } catch (_) { return null; }
    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
        i += 2 + len;
    }
    return null;
}

// the view at rest as JPEG XL for this session's viewers: they all can show it, and JPEG XL is not turned off
function jxlRefine(session) {
    return !!(session.jxl && JXL_MODE !== 'off' && jxlAvailable());
}

// JPEG XL distance of the refined view by automatic quality's step: near lossless on a good link, coarser when it
// is struggling (still far better than the step's JPEG)
const REFINE_DISTANCE = [0.5, 0.6, 0.8, 1.0, 1.2, 1.5, 1.9, 2.4, 3.0];

function stillScale(session) {
    const meta = session.meta || {};
    const cssW = Number(meta.deviceWidth) || 0;
    const cssH = Number(meta.deviceHeight) || 0;
    if (!cssW || !cssH) return 0;
    // only the phone asks for stills (still-scale); a zoomed desktop session keeps plain frames
    let scale = session.clientScale || 0;
    scale = Math.min(scale, STILL_MAX_SCALE, Math.sqrt(STILL_MAX_PIXELS / (cssW * cssH)));
    // the Alchemy build's frames already have the phone's pixels (#993): a still at a higher scale adds nothing,
    // but a viewer that shows JPEG XL gets the view at rest again as JPEG XL from a lossless capture (refine)
    if (emulatedScale && (session.pxPerDip || 1) >= scale - 0.05) return jxlRefine(session) ? 1 : 0;
    return scale >= 1.1 ? scale : (jxlRefine(session) ? 1 : 0);
}

// Every frame or tile pack that reaches the viewers makes the last still stale and restarts the wait.
function sendFrame(session, payload, binary) {
    broadcast(session, payload, binary);
    // a page that keeps changing (an animation, a ticker) gets stills further apart, so a still a
    // second does not ride on top of the frames; one that settles goes back to the short gap
    if (session.stillAt && session.stillSentGen === session.stillGen && !(session.stillInputAt > session.stillAt)) {
        const lived = Date.now() - session.stillAt;
        session.stillGap = lived < 3000 ? Math.min(STILL_MAX_GAP_MS, (session.stillGap || STILL_MIN_GAP_MS) * 2) : STILL_MIN_GAP_MS;
    }
    session.stillGen = (session.stillGen || 0) + 1;
    // the still says which binary frame it was taken over, so a transport that delivers it ahead
    // of that frame (the relay flushes text before its pending frame) does not hide it
    session.stillBaseBytes = binary && payload && payload.length ? payload.length : 0;
    armStill(session);
}

// A viewport change (resize, zoom, print) must not overlap a still capture: when the capture ends,
// Chromium puts back the device metrics it saved first, undoing the new viewport. Cancel and wait.
async function changeViewport(session) {
    session.viewportBusy = (session.viewportBusy || 0) + 1;
    try {
        await settleStill(session);
        await applyViewport(session);
        await restartScreencast(session);
    } finally {
        session.viewportBusy -= 1;
        // the new size's first frame may match the last one and be skipped: the still is asked for here too
        if (!session.viewportBusy) armStill(session);
    }
}

async function settleStill(session) {
    if (session.stillTimer) clearTimeout(session.stillTimer);
    session.stillTimer = null;
    session.stillGen = (session.stillGen || 0) + 1;
    if (session.stillPromise) {
        try { await session.stillPromise; } catch (_) {}
    }
    session.stillQuietUntil = 0;
}

function armStill(session, delay) {
    if (session.stillTimer) clearTimeout(session.stillTimer);
    session.stillTimer = null;
    if (!stillScale(session) || !session.sockets.size) return;
    const gap = Math.max(0, (session.stillAt || 0) + (session.stillGap || STILL_MIN_GAP_MS) - Date.now());
    session.stillTimer = setTimeout(() => {
        session.stillTimer = null;
        const run = captureStill(session).catch((err) => {
            // the page closed under the capture: nothing to report
            if (!sessions.get(session.id) || session.closing) return;
            console.warn('[grimoire-browser] still', err && err.message);
        });
        session.stillPromise = run;
        run.then(() => {
            if (session.stillPromise === run) session.stillPromise = null;
        });
    }, Math.max(delay == null ? STILL_SETTLE_MS : delay, gap));
}

async function captureStill(session) {
    if (!sessions.get(session.id) || session.closing) return;
    if (session.stillBusy) {
        armStill(session);
        return;
    }
    const scale = stillScale(session);
    if (!scale || !session.sockets.size) return;
    // still moving: frames in flight, a scroll or a page load
    if (session.viewportBusy || session.framePump || session.latestFrame || session.pendingScroll || scrollBurst(session) || session.navigating) {
        if (PACK_DEBUG) console.log('[grimoire-browser] still waits:', JSON.stringify({ viewport: !!session.viewportBusy, pump: !!session.framePump, latest: !!session.latestFrame, scroll: !!session.pendingScroll, burst: scrollBurst(session), nav: !!session.navigating }));
        armStill(session);
        return;
    }
    if (session.stillSentGen === session.stillGen) return;
    if (socketsCongested(session) || (session.rttMs || 0) > STILL_MAX_RTT_MS
        || (session.stillUnacked && Date.now() - session.stillUnacked < STILL_ACK_WAIT_MS)) {
        if (PACK_DEBUG) console.log('[grimoire-browser] still held: congested', socketsCongested(session), 'rtt', session.rttMs, 'unacked', session.stillUnacked ? Date.now() - session.stillUnacked : 0);
        armStill(session, STILL_MIN_GAP_MS);
        return;
    }
    if (PACK_DEBUG) console.log('[grimoire-browser] still capture at scale', scale, jxlRefine(session) ? '(JPEG XL refine)' : '');
    const gen = session.stillGen;
    const meta = session.meta;
    const baseBytes = session.stillBaseBytes || 0;
    session.stillBusy = true;
    let shot;
    let view;
    let refine = false;
    try {
        const metrics = await session.cdp.send('Page.getLayoutMetrics');
        view = metrics && metrics.cssVisualViewport;
        // a pinch-zoomed page (pageScaleFactor) is left to the frames; a mobile page with no viewport meta is one
        // Chromium itself draws smaller (a 980 px layout fitted to the phone) and gets its still at that scale
        const mobile = session.viewKind === 'mobile';
        if (!view || (!mobile && Math.abs((view.scale || 1) - 1) > 0.001) || session.stillGen !== gen) return;
        // the capture emulates the scaled device for a moment; the screencast sends a frame of
        // that size, which the frame handler drops (and only that size)
        session.stillSide = { w: Math.round(meta.deviceWidth * scale), h: Math.round(meta.deviceHeight * scale) };
        refine = jxlRefine(session) && scale === 1;
        // the refine (scale 1): the surface as it is, no clip, so Chromium emulates nothing for the capture and sends no
        // frame of its own for it (a clipped capture did, which made every refine stale before it was sent); PNG,
        // re-encoded as JPEG XL here, cropped to the view (the over-render band is not part of it)
        if (refine) {
            // the capture resets the view's visible size (the over-render band goes) and Chromium sends frames of its
            // own for it: they are not the page changing, so they are dropped (refineEchoUntil), and the band is put
            // back at once
            session.refineEchoUntil = Date.now() + 1500;
            try {
                // on a DevTools session of its own: a capture on the screencast's session reset that session's device
                // emulation (the page was laid out again at the window's width)
                if (!session.captureCdp) session.captureCdp = await session.page.createCDPSession();
                shot = await session.captureCdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
            } finally {
                if (session.bandDip) await session.cdp.send('Emulation.setVisibleSize', { width: session.dipWidth, height: session.dipHeight + session.bandDip }).catch(() => {});
                session.refineEchoUntil = Date.now() + 250;
            }
        }
        else shot = await session.cdp.send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: session.settings.jpegQuality,
            captureBeyondViewport: false,
            // the clip scale multiplies the device scale: a mobile page already has the viewer's (mobileDeviceScale)
            clip: mobile
                ? { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale: scale * (view.scale || 1) / mobileDeviceScale(session) }
                : { x: view.pageX, y: view.pageY, width: meta.deviceWidth, height: meta.deviceHeight, scale }
        });
    } finally {
        session.stillBusy = false;
        session.stillQuietUntil = Date.now() + 250;
    }
    if (PACK_DEBUG) console.log('[grimoire-browser] still captured', shot && shot.data ? shot.data.length : 0, 'B64; frames since', (session.stillGen || 0) - gen, 'meta', session.meta === meta ? 'same' : JSON.stringify(meta) + ' -> ' + JSON.stringify(session.meta));
    if (!shot || !shot.data || !sessions.get(session.id) || session.stillGen !== gen || session.meta !== meta) return;
    let data = shot.data;
    let format = 'jpeg';
    if (refine) {
        let out = null;
        try {
            const png = sharp(Buffer.from(shot.data, 'base64'));
            const info = await png.metadata();
            // the view's own rows: the frame's width, its height without the band
            const viewH = Math.min(info.height, Math.round(meta.deviceHeight * (session.pxPerDip || 1) * (meta.pageScaleFactor || 1)));
            if (PACK_DEBUG) console.log('[grimoire-browser] refine capture', info.width + 'x' + info.height, 'view rows', viewH, 'frame', session.pixelWidth + 'x' + session.pixelHeight);
            const decoded = await png.extract({ left: 0, top: 0, width: info.width, height: Math.max(1, viewH) }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
            const level = session.aq ? session.aq.level : AQ_START;
            out = await jxlEncodePixels(decoded.data, decoded.info.width, decoded.info.height, 3, REFINE_DISTANCE[level] || 1);
        } catch (err) { out = null; if (PACK_DEBUG) console.log('[grimoire-browser] refine failed', err && err.message); }
        if (PACK_DEBUG) console.log('[grimoire-browser] refine jxl', out ? out.length : 0, 'B; frames since', (session.stillGen || 0) - gen);
        // a frame came while it encoded: this view is old
        if (!out || !sessions.get(session.id) || session.stillGen !== gen || session.meta !== meta) return;
        data = out.toString('base64');
        format = 'jxl';
        session.jxlSentAt = Date.now();
    }
    session.stillSentGen = gen;
    session.stillAt = Date.now();
    session.stillUnacked = Date.now();
    const still = {
        type: 'still',
        gen,
        w: Math.round(meta.deviceWidth * scale),
        h: Math.round(meta.deviceHeight * scale),
        cssW: meta.deviceWidth,
        cssH: meta.deviceHeight,
        scale,
        baseBytes,
        f: format,
        data
    };
    session.still = still;
    broadcast(session, still);
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
    // A frame is being packed. On a slow link the newest waits for it (Chromium sends the next only once this one is
    // acked), so every frame is packed against the one before it - sending it whole broke the chain on every
    // scroll; on a fast link it goes whole now (lowest latency) and the next is compared to nothing.
    if (session.framePump && slowLink(session)) return;
    if (!session.paceNow && session.sockets.size && socketsCongested(session)) {
        session.latestFrame = null;
    }
    const jpeg = session.latestFrame;
    const header = jpeg ? frameHeader(session, session.latestMeta) : null;
    const frame = jpeg ? binaryMessage(MSG_FRAME, header, jpeg) : null;
    session.latestFrame = null;
    session.latestMeta = null;
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
        sendFrame(session, frame, true);
        session.packGen = (session.packGen || 0) + 1;
        session.pixels = null;
        schedulePump(session);
        return;
    }
    const packStarted = PACK_DEBUG ? process.hrtime.bigint() : 0n;
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
        sendFrame(session, frame, true);
        schedulePump(session);
    }, PACK_BUDGET_MS);
    packFrame(session, jpeg, gen, header).then((packed) => {
        if (PACK_DEBUG) console.log('[grimoire-browser] pack ' + (settled ? 'late ' : '') + (packed && packed.tiles ? (packed.tiles[0] === MSG_SCROLL ? 'scroll' : 'tiles') + ' ' + packed.tiles.length : packed && packed.skip ? 'skip' : 'whole ' + (packed && packed.whole ? packed.whole.length : frame.length) + ' (' + ((packed && packed.why) || 'size') + ')') + ' in ' + (Number(process.hrtime.bigint() - packStarted) / 1e6).toFixed(1) + ' ms (' + (session.packTimes || '') + ')');
        if (settled || !sessions.get(session.id)) return;
        settled = true;
        clearTimeout(budget);
        session.framePump = false;
        // a newer frame went out whole while this one was packed (a fast link): this one is older, it must not follow
        if (session.packGen !== gen || (packed && packed.stale)) {
            schedulePump(session);
            return;
        }
        if (packed && packed.tiles) sendFrame(session, packed.tiles, true);
        else if (packed && packed.whole) sendFrame(session, packed.whole, true);
        else if (!(packed && packed.skip)) sendFrame(session, frame, true);
        schedulePump(session);
    }).catch(() => {
        if (settled || !sessions.get(session.id)) return;
        settled = true;
        clearTimeout(budget);
        session.framePump = false;
        if (session.packGen === gen) sendFrame(session, frame, true);
        schedulePump(session);
    });
}

function noteScreencastFrame(session, event) {
    session.pendingAck = event.sessionId;
    if (event.data) {
        session.latestFrame = Buffer.from(event.data, 'base64');
        session.latestMeta = event.metadata || null;
    }
    pumpFrames(session);
}

// ---- binary messages to the viewer (#990) ----
// The first byte is the kind: 1 a whole JPEG frame, 2 an Opus packet (audio pump), 3 a pack of JPEG tiles. Frames and
// tile packs carry a JSON header (u16 length): t = when Chromium drew it (ms, this host's clock, which also stamps the
// audio), sx / sy = the root scroll offset in CSS pixels, k = frame pixels per CSS pixel and p = 1 when the viewer may
// scroll the picture itself (a desktop page at page scale 1).
const MSG_FRAME = 1;
const MSG_AUDIO = 2;
const MSG_TILES = 3;
// 4: a scroll pack - rows moved (ops [dst, src, rows]) then tiles, both on the frame before it (#990 round 2)
const MSG_SCROLL = 4;

function frameHeader(session, meta) {
    const m = meta || session.meta || {};
    // CSS pixels per DIP (1 / default zoom) and frame pixels per DIP (the Alchemy build's emulated scale)
    const cssPerDip = session.cssPerPx || 0;
    const k = cssPerDip ? (session.pxPerDip || 1) / cssPerDip : 0;
    const desktop = !!k && Math.abs((Number(m.pageScaleFactor) || 1) - 1) < 0.001;
    return {
        t: Math.round((Number(m.timestamp) || Date.now() / 1000) * 1000),
        // the screencast's offsets are DIP; the page's scroll reports (and scroll-to) are CSS pixels
        sx: Math.round((Number(m.scrollOffsetX) || 0) * (cssPerDip || 1) * 100) / 100,
        sy: Math.round((Number(m.scrollOffsetY) || 0) * (cssPerDip || 1) * 100) / 100,
        k: desktop ? k : 0,
        p: desktop ? 1 : 0,
        // frame rows of the page's viewport; any rows below are the over-render band
        vh: session.bandDip ? Math.round((session.dipHeight || 0) * (session.pxPerDip || 1)) : 0
    };
}

function binaryMessage(kind, header, body) {
    const json = Buffer.from(JSON.stringify(header));
    const head = Buffer.allocUnsafe(3);
    head[0] = kind;
    head.writeUInt16LE(json.length, 1);
    return Buffer.concat([head, json, body]);
}

function beginNavigating(session, resetTimer) {
    session.navigating = true;
    if (resetTimer || !session.navSettle) {
        clearTimeout(session.navSettle);
        session.navSettle = setTimeout(() => endNavigating(session), 4000);
    }
    broadcast(session, {
        type: 'navigating',
        url: session.navTarget || session.url || '',
        title: session.title || '',
        navigating: true
    });
}

// Address bar fill: Chromium has no load percentage, so lifecycle stages stand in. Only ever moves forward.
const LOAD_STAGES = { commit: 0.3, DOMContentLoaded: 0.6, firstContentfulPaint: 0.7, load: 0.9, networkAlmostIdle: 1 };

function noteLoadProgress(session, value) {
    if (value <= (session.loadProgress || 0)) return;
    session.loadProgress = value;
    broadcast(session, { type: 'progress', value, bytes: session.loadBytes || 0 });
}

// Bytes a page load has brought in, for Internet Explorer on the phone ("3688 KB" beside its meter, as the
// device counts): the Network domain on this session only while the main frame loads, at most 4 reports a second
function countLoadBytes(session, on) {
    if (on === !!session.byteCount) return;
    if (!on) {
        session.byteCount = false;
        clearTimeout(session.bytesTimer);
        session.bytesTimer = 0;
        session.cdp.send('Network.disable').catch(() => {});
        return;
    }
    session.byteCount = true;
    session.cdp.send('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }).catch(() => {});
}

function noteLoadBytes(session, n) {
    if (!session.byteCount || !(n > 0)) return;
    session.loadBytes = (session.loadBytes || 0) + n;
    if (session.bytesTimer) return;
    session.bytesTimer = setTimeout(() => {
        session.bytesTimer = 0;
        if (session.byteCount && sessions.get(session.id)) broadcast(session, { type: 'progress', value: session.loadProgress || 0, bytes: session.loadBytes });
    }, 250);
}

function endNavigating(session) {
    if (!sessions.get(session.id)) return;
    clearTimeout(session.navSettle);
    session.navSettle = null;
    // navSettle is only a spinner fallback. If Page.navigate has not committed yet, do not
    // clear navigating / snap the URL back to the old live page — re-arm briefly instead.
    if (session.navRunning && session.navTarget) {
        const live = livePageUrl(session);
        if (!live || live !== session.navTarget) {
            session.navSettle = setTimeout(() => endNavigating(session), 2000);
            return;
        }
    }
    session.navigating = false;
    session.navTarget = '';
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
        const child = await createSession({ width: 480, height: 640, popup: true, parentId, owner: announce.owner, viewKind: announce.viewKind }, page);
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

// Upload fields (Yozora #628): Chrome's own file chooser would open on the Xvfb screen nobody sees.
// It is intercepted; the viewer asks the user's desktop instead (an Open dialog over the VFS, or
// Select on Client), the files are uploaded to POST /sessions/<id>/file-chooser/<chooser>/file
// and a file-chooser-reply sets them on the input (DOM.setFileInputFiles). The files stay in the
// session's upload folder until the session closes: Chrome reads them when the form is sent.
const UPLOAD_MAX_BYTES = Number(process.env.GRIMOIRE_UPLOAD_MAX_BYTES) || 2 * 1024 * 1024 * 1024;

function armFileChooser(session) {
    session.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
    session.cdp.on('Page.fileChooserOpened', async (ev) => {
        let accept = '';
        try {
            const node = await session.cdp.send('DOM.resolveNode', { backendNodeId: ev.backendNodeId });
            const value = await session.cdp.send('Runtime.callFunctionOn', {
                objectId: node.object.objectId,
                functionDeclaration: 'function () { return String(this.accept || ""); }',
                returnByValue: true
            });
            accept = String((value && value.result && value.result.value) || '').slice(0, 500);
        } catch (_) {}
        const id = crypto.randomBytes(8).toString('hex');
        session.fileChooser = { id, backendNodeId: ev.backendNodeId, multiple: ev.mode === 'selectMultiple', files: [] };
        broadcast(session, { type: 'file-chooser', id, multiple: session.fileChooser.multiple, accept });
    });
}

function uploadDir(session) {
    if (!session.uploadDir) session.uploadDir = path.join(os.tmpdir(), 'alchemy-uploads', session.id);
    return session.uploadDir;
}

async function finishFileChooser(session, msg) {
    const chooser = session.fileChooser;
    if (!chooser || chooser.id !== msg.id) return;
    session.fileChooser = null;
    if (msg.cancel || !chooser.files.length) return;
    const files = chooser.multiple ? chooser.files : chooser.files.slice(-1);
    await session.cdp.send('DOM.setFileInputFiles', { files, backendNodeId: chooser.backendNodeId }).catch((err) => {
        console.error('[grimoire-browser] setFileInputFiles', err && err.message);
    });
}

async function receiveUpload(session, chooserId, name, req, res) {
    const chooser = session.fileChooser;
    if (!chooser || chooser.id !== chooserId) {
        sendJson(res, 409, { error: 'no file chooser is open' });
        return;
    }
    const dir = path.join(uploadDir(session), chooserId + '-' + chooser.files.length);
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, safeFilename(name || 'file'));
    let size = 0;
    let tooBig = false;
    await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(filePath);
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > UPLOAD_MAX_BYTES && !tooBig) {
                tooBig = true;
                req.unpipe(out);
                out.destroy();
                resolve();
            }
        });
        out.on('error', reject);
        out.on('finish', resolve);
        req.pipe(out);
    });
    if (tooBig) {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
        sendJson(res, 413, { error: 'file too large' });
        return;
    }
    chooser.files.push(filePath);
    sendJson(res, 200, { ok: true, size });
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
            while (el && el.shadowRoot) {
                const inner = el.shadowRoot.elementFromPoint(px, py);
                if (!inner || inner === el) break;
                el = inner;
            }
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
    if (!reload) {
        session.url = url;
        session.navTarget = url;
    } else {
        session.navTarget = session.url || '';
    }
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
            session.navTarget = '';
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

/** The device / IE window / tab that owns a session (#756); null for sessions nobody owns (agents, old clients). */
function normalizeOwner(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const deviceId = String(raw.deviceId || '').toLowerCase();
    if (!/^[a-f0-9]{16,32}$/.test(deviceId)) return null;
    const text = (value, max) => String(value || '').replace(/[\u0000-\u001f]/g, '').slice(0, max);
    return {
        deviceId,
        deviceName: text(raw.deviceName, 80),
        deviceKind: raw.deviceKind === 'mobile' ? 'mobile' : 'desktop',
        clientSession: text(raw.clientSession, 64),
        windowId: text(raw.windowId, 64),
        tabId: text(raw.tabId, 64)
    };
}

function sessionExpired(session, now) {
    if (session.owner) return (session.leaseUntil || 0) < now;
    return session.idleAt < now;
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
    clearTimeout(session.stillTimer);
    session.stillTimer = null;
    clearTimeout(session.healthTimer);
    session.healthTimer = null;
    clearTimeout(session.clipboardCheck);
    session.clipboardCheck = null;
    if (session.dialog) clearTimeout(session.dialog.timer);
    session.dialog = null;
    session.fileChooser = null;
    if (session.uploadDir) fs.promises.rm(session.uploadDir, { recursive: true, force: true }).catch(() => {});
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
    // the sign-in outlives its window a while: the owner closes it and then presses Continue, which takes the
    // cookies and disposes the context itself (modules/textMessaging.js); a context nobody took goes here
    if (session.isolatedCtx) {
        const ctx = session.isolatedCtx;
        session.isolatedCtx = null;
        setTimeout(() => { ctx.close().catch(() => {}); }, ISOLATED_KEEP_MS).unref();
    }
}
const ISOLATED_KEEP_MS = 15 * 60 * 1000;

let browserLaunch = null;

/**
 * Ask Chromium to quit (CDP Browser.close: every tab closed, cookies and the profile written, exit_type Normal)
 * and wait for its process to end by itself. puppeteer's browser.close() SIGKILLs the process right after
 * sending the same command, cutting that save short; it is only the fallback when Chromium hangs.
 */
async function closeBrowserGently(instance, timeoutMs) {
    const proc = instance && typeof instance.process === 'function' ? instance.process() : null;
    if (!proc || proc.exitCode !== null || proc.signalCode) {
        await instance.close().catch(() => {});
        return true;
    }
    const exited = new Promise((resolve) => proc.once('exit', () => resolve(true)));
    try { await browserClient.send('Browser.close'); } catch (_) { /* the pipe closes as it quits */ }
    const ok = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs).unref())]);
    if (!ok) await instance.close().catch(() => {});
    return ok;
}
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
    await applyIdentity(session, plain).catch(() => {});
}

// View kind (Yozora #748): a session asks for the phone version of sites (viewKind 'mobile': Internet Explorer
// Mobile's Mobile view) or is the desktop browser it always was ('desktop', and every session that names none).
// Mobile = Android Chrome's user agent and client hints with the Alchemy token and brand kept, phone device
// metrics (the viewport meta is honoured, overlay scrollbars, text autosizing) and touch (pointer: coarse,
// hover: none, ontouchstart). The viewer's input stays mouse and wheel.
let mobileUserAgent = '';
let mobileUserAgentMetadata = null;
let plainMobileUserAgent = '';
let plainMobileUserAgentMetadata = null;
const MOBILE_PLATFORM = 'Linux armv8l';
const MOBILE_TOUCH_POINTS = 5;

function viewKindOf(value) {
    return value === 'mobile' ? 'mobile' : 'desktop';
}

function sessionIdentity(session, plain) {
    if (session.viewKind === 'mobile' && mobileUserAgent) {
        return plain ? [plainMobileUserAgent, plainMobileUserAgentMetadata] : [mobileUserAgent, mobileUserAgentMetadata];
    }
    return plain ? [plainUserAgent, plainUserAgentMetadata] : [pageUserAgent, pageUserAgentMetadata];
}

async function applyIdentity(session, plain) {
    const [userAgent, userAgentMetadata] = sessionIdentity(session, plain);
    await session.page.setUserAgent(userAgent, userAgentMetadata);
    // navigator.platform too; Puppeteer's call has no platform. Back to desktop, the same call without one
    // puts the page's own override right (it outlives Puppeteer's).
    if (session.viewKind === 'mobile' && mobileUserAgent && session.cdp) {
        session.mobileIdentity = true;
        await session.cdp.send('Emulation.setUserAgentOverride', { userAgent, platform: MOBILE_PLATFORM, userAgentMetadata }).catch(() => {});
    } else if (session.mobileIdentity && session.cdp) {
        session.mobileIdentity = false;
        await session.cdp.send('Emulation.setUserAgentOverride', { userAgent, userAgentMetadata }).catch(() => {});
    }
}

// The device scale a mobile page sees (window.devicePixelRatio, which picture of a srcset): the viewer's own
// pixels per CSS pixel when it said so (still-scale: a phone at its pixel ratio), never under the zoom.
function mobileDeviceScale(session) {
    return Math.max(session.zoom || 1, Math.min(ZOOM_MAX, session.clientScale || 0));
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
        // the toolbar button's picture: action.default_icon, else the app icons (Chrome does the same)
        const buttonIcons = typeof action.default_icon === 'string' ? { 16: action.default_icon }
            : (action.default_icon && Object.keys(action.default_icon).length ? action.default_icon : icons);
        out.push({
            id,
            dir,
            name: extensionMessage(dir, manifest, manifest.short_name || manifest.name) || id,
            title: extensionMessage(dir, manifest, action.default_title) || '',
            popup: action.default_popup ? own(action.default_popup) : '',
            icon: iconSize ? own(icons[iconSize]) : '',
            icon16: extensionIconData(dir, buttonIcons, 16),
            icon32: extensionIconData(dir, buttonIcons, 32)
        });
    }
    return out;
}

// An extension's toolbar picture for Grimoire's command bar (its IE7 add-on buttons): a data URL, because a
// chrome-extension:// address only loads inside Chromium. size: the smallest picture at least that big.
function extensionIconData(dir, icons, size) {
    const sizes = Object.keys(icons || {}).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    const pick = sizes.find((n) => n >= size) || sizes[sizes.length - 1];
    if (!pick) return '';
    const file = path.join(dir, String(icons[pick]).replace(/^\/+/, ''));
    if (!file.startsWith(dir + path.sep)) return '';
    try {
        const bytes = fs.readFileSync(file);
        if (bytes.length > 65536) return '';
        const type = /\.svg$/i.test(file) ? 'image/svg+xml' : (/\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png');
        return 'data:' + type + ';base64,' + bytes.toString('base64');
    } catch (_) {
        return '';
    }
}

// An extension's toolbar popup is a window of its own with no browser window around it (getWindowForTarget fails):
// it is never adopted as a tab.
async function isExtensionPopup(target) {
    const targetId = (target && target._targetId) || '';
    if (!targetId || !browserClient || !/^chrome-extension:\/\//i.test(String(target.url() || ''))) return false;
    try {
        await browserClient.send('Browser.getWindowForTarget', { targetId });
        return false;
    } catch (_) {
        return true;
    }
}

// The tab target that holds a page (Extensions.triggerAction takes a tab, not its page).
function tabTargetIdOf(page) {
    const target = page && page.target ? page.target() : null;
    const manager = browser && typeof browser._targetManager === 'function' ? browser._targetManager() : null;
    if (!target || !manager) return '';
    for (const t of manager.getAvailableTargets().values()) {
        if (t.type() === 'tab' && typeof t._childTargets === 'function' && t._childTargets().has(target)) return t._targetId || '';
    }
    return '';
}

function waitExtensionPopup(instance, extensionId, ms) {
    const prefix = 'chrome-extension://' + extensionId + '/';
    return new Promise((resolve) => {
        let done = false;
        const finish = (target) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            instance.off('targetcreated', check);
            instance.off('targetchanged', check);
            resolve(target);
        };
        // a popup starts as an 'other' target and becomes a page once its document commits
        const check = (target) => {
            if (done || target.type() !== 'page' || !String(target.url() || '').startsWith(prefix)) return;
            isExtensionPopup(target).then((popup) => { if (popup) finish(target); }).catch(() => {});
        };
        const timer = setTimeout(() => finish(null), ms);
        instance.on('targetcreated', check);
        instance.on('targetchanged', check);
    });
}

/**
 * An extension's toolbar button pressed for a session's page (Grimoire's command bar), as a click on Chrome's
 * toolbar: Extensions.triggerAction (pipe only, --enable-unsafe-extension-debugging). With a popup, Chromium opens it
 * as its own small window sized to its content (at most 800 x 600); it takes no emulated viewport, so it is streamed
 * at that size as a child session (closed with its page, or when Chromium closes it: a click on the page, the popup's
 * own window.close()), and the client drops it down from the button. Without one, the extension does what its click
 * does (a page it opens comes as a tab: adoptOrphan). Resolves { sessionId, viewerToken, width, height } or null.
 */
async function openExtensionAction(session, ext) {
    const instance = browser;
    const tabId = tabTargetIdOf(session.page);
    if (!instance || !browserClient || !tabId) throw Object.assign(new Error('this page cannot run extensions'), { status: 409 });
    // the popup acts on its window's active tab (1Password fills it): this page, as the viewer shows it
    if (HEADFUL && session.group) await session.page.bringToFront().catch(() => {});
    const waiting = waitExtensionPopup(instance, ext.id, 3000);
    await browserClient.send('Extensions.triggerAction', { id: ext.id, targetId: tabId });
    const target = await waiting;
    if (!target) return null;
    const page = (await target.page().catch(() => null)) || (await target.asPage().catch(() => null));
    if (!page || page.isClosed()) return null;
    // its size once it has drawn
    let size = null;
    for (let i = 0; i < 15; i++) {
        const now = await page.evaluate(() => [document.readyState, innerWidth, innerHeight]).catch(() => null);
        if (now && size && now[0] === 'complete' && now[1] === size[1] && now[2] === size[2]) break;
        size = now;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (page.isClosed()) return null;
    let child;
    try {
        child = await createSession({ popup: true, extensionPopup: true, parentId: session.id, owner: session.owner, viewKind: session.viewKind }, page);
    } catch (err) {
        page.close().catch(() => {});
        throw err;
    }
    return { sessionId: child.id, viewerToken: child.viewerToken, width: (size && size[1]) || 0, height: (size && size[2]) || 0 };
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
    // a tab the server opens to read a page and close again (modules/youtubeAlchemy.js): never shown to a viewer
    if (String(target.url() || '').includes(ALCHEMY_QUIET_MARKER)) return;
    const owned = String(target.url() || '').includes(ALCHEMY_OWNED_MARKER);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await isExtensionPopup(target)) return;
    const page = await target.page().catch(() => null);
    if (!page || page.isClosed() || ownPages.has(page)) return;
    let announce = null;
    for (const session of sessions.values()) {
        if (session.sockets.size && (!announce || session.idleAt > announce.idleAt)) announce = session;
    }
    if (!announce && (owned || pendingOrphans.length < MAX_SESSIONS)) {
        pendingOrphans.push(page);
        return;
    }
    if (!announce || popupCount() >= MAX_SESSIONS) {
        if (!owned) page.close().catch(() => {});
        return;
    }
    adoptPopup(announce, page, '');
}

let xvfb = null;
let xvfbDisplay = '';

// Xvfb picks a free display (-displayfd) and only accepts this cookie, so other local users cannot watch the pages.
function startDisplay() {
    if (xvfb && xvfb.exitCode === null && xvfbDisplay) return Promise.resolve(xvfbDisplay);
    reapOrphanDisplays();
    const cookie = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(XAUTH_FILE, '', { mode: 0o600 });
    return new Promise((resolve, reject) => {
        // -noreset: the display keeps its cookie when its last client (Chromium, relaunching) goes
        const child = spawn(XVFB_BIN, ['-displayfd', '3', '-screen', '0', '1920x1440x24', '-nolisten', 'tcp', '-noreset', '-auth', XAUTH_FILE], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
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
    try { fs.unlinkSync(XAUTH_FILE); } catch (_) {}
}

// Alchemy's own displays left running by a service that died (their parent is gone: init, or the user's systemd that
// adopts orphans), and their cookie files: each held a whole 1920 x 1440 screen (seven of them on Nov 21, the oldest
// from Nov 7). Only Xvfb started with an Alchemy cookie file in this data dir is touched.
function reapOrphanDisplays() {
    let pids = [];
    try { pids = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name)); } catch (_) { return; }
    const live = new Set([String(process.pid)]);
    for (const pid of pids) {
        try {
            if (fs.readlinkSync('/proc/' + pid + '/exe') !== XVFB_BIN) continue;
            const args = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0');
            const auth = args[args.indexOf('-auth') + 1] || '';
            if (args.indexOf('-auth') < 0 || !auth.startsWith(XAUTH_PREFIX)) continue;
            const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
            const ppid = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1];
            const parent = ppid === '1' ? 'init' : fs.readFileSync('/proc/' + ppid + '/comm', 'utf8').trim();
            if (parent !== 'init' && parent !== 'systemd') { live.add(auth.slice(XAUTH_PREFIX.length + 1)); continue; }
            process.kill(Number(pid), 'SIGTERM');
        } catch (_) {}
    }
    // cookie files of services that are gone
    try {
        for (const name of fs.readdirSync(DATA_DIR)) {
            if (!name.startsWith('alchemy-xauth')) continue;
            const owner = name.slice('alchemy-xauth-'.length);
            if (name === 'alchemy-xauth' || (!live.has(owner) && !fs.existsSync('/proc/' + owner))) fs.rmSync(path.join(DATA_DIR, name), { force: true });
        }
    } catch (_) {}
}

let pulse = null;
let pulseDir = '';
let audioListener = null;

// Alchemy's own PulseAudio daemons left running by a service that died (their parent is gone): each one holds a
// null sink and, before #990, the session bus name. Only daemons started here (runtime dir alchemy-pulse-*) are touched.
function reapOrphanAudio() {
    let pids = [];
    try { pids = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name)); } catch (_) { return; }
    for (const pid of pids) {
        try {
            const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
            const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
            if (ppid !== 1 || fs.readlinkSync('/proc/' + pid + '/exe') !== PULSEAUDIO_BIN) continue;
            const dir = (fs.readFileSync('/proc/' + pid + '/environ', 'utf8').split('\0').find((v) => v.startsWith('PULSE_RUNTIME_PATH=')) || '').slice(19);
            if (!dir || !path.basename(dir).startsWith('alchemy-pulse-') || path.dirname(dir) !== os.tmpdir()) continue;
            process.kill(Number(pid), 'SIGTERM');
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (_) {}
    }
}

// A private PulseAudio (socket in a fresh 0700 temp dir, one null sink) gives Chromium a device; the sink monitor is the stream.
// It must not see the user's session bus or X display (#990): another PulseAudio on that bus owns org.PulseAudio1, and a
// daemon that cannot take the name exits at once, so Chromium launched muted on every start since Nov 7.
async function startAudio() {
    if (pulse && pulse.exitCode === null && pulseDir) return 'unix:' + path.join(pulseDir, 'native');
    reapOrphanAudio();
    pulseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alchemy-pulse-'));
    const socket = path.join(pulseDir, 'native');
    const env = Object.assign({}, process.env, {
        PULSE_RUNTIME_PATH: pulseDir,
        PULSE_STATE_PATH: pulseDir,
        XDG_RUNTIME_DIR: pulseDir,
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + path.join(pulseDir, 'no-bus')
    });
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
    const child = spawn(PULSEAUDIO_BIN, [
        '-n', '--daemonize=no', '--exit-idle-time=-1', '--use-pid-file=no', '--disallow-exit', '--disable-shm=yes', '--log-target=stderr', '--log-level=error',
        '-L', 'module-native-protocol-unix socket=' + socket + ' auth-anonymous=1',
        // 48 kHz like the Opus stream: no resampling between Chromium and the encoder
        '-L', 'module-null-sink sink_name=alchemy rate=48000 channels=2 sink_properties=device.description=Alchemy'
    ], { stdio: ['ignore', 'ignore', 'pipe'], env });
    pulse = child;
    let why = '';
    child.stderr.on('data', (chunk) => { why = (why + chunk).slice(-400); });
    let exited = false;
    child.once('exit', () => {
        exited = true;
        if (pulse === child) pulse = null;
    });
    for (let i = 0; i < 50 && !exited && !fs.existsSync(socket); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    if (exited || !fs.existsSync(socket)) {
        stopAudio();
        throw new Error('PulseAudio did not start' + (why.trim() ? ': ' + why.trim().split('\n').pop() : ''));
    }
    child.stderr.resume();
    return 'unix:' + socket;
}

function stopAudio() {
    stopAudioPump();
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
        // Constant bitrate: VBR silence is ~1 KB/s, and <audio> waits on its first buffer for 10s+ before it plays anything.
        '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'off', '-frame_duration', '20',
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

// ---- audio on the viewer's socket (#990) ----
// The <audio> stream above (kept for old viewers) has no clock: the element buffers what it likes and the viewer had
// to seek to catch up, a gap each time, and it drifted from the picture. Here one ffmpeg reads the sink and every
// Opus packet goes to the listening viewer as a binary message [2][f64 ms][packet], stamped on this host's clock as
// the frames are (frameHeader t), so the viewer plays it at the picture's delay. One listener at a time: the newest
// takes it and the one before is told (audio-off, taken) instead of fighting back.
const OPUS_SAMPLES_PER_MS = 48;
// pulse fragment (20 ms) plus one Opus frame between the sink and ffmpeg's output
const AUDIO_CAPTURE_LAG_MS = 40;
const AUDIO_SOCKET_MAX_BUFFER = 512 * 1024;

const audioPump = { ff: null, listener: null, buf: Buffer.alloc(0), carry: [], packets: 0, base: Infinity, lastGranule: -1 };

function setAudioListener(ws, on) {
    const prev = audioPump.listener;
    if (!on) {
        if (prev === ws) {
            audioPump.listener = null;
            stopAudioPump();
        }
        return;
    }
    if (!pulseDir) {
        try { ws.send(JSON.stringify({ type: 'audio-off', reason: 'unavailable' })); } catch (_) {}
        return;
    }
    if (prev && prev !== ws && prev.readyState === 1) {
        try { prev.send(JSON.stringify({ type: 'audio-off', reason: 'taken' })); } catch (_) {}
    }
    audioPump.listener = ws;
    startAudioPump();
}

function startAudioPump() {
    if (audioPump.ff || !pulseDir) return;
    const ff = spawn(FFMPEG_BIN, [
        '-hide_banner', '-loglevel', 'error', '-fragment_size', '3840', '-f', 'pulse', '-i', 'alchemy.monitor',
        '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'off', '-frame_duration', '20', '-application', 'audio',
        '-f', 'ogg', '-page_duration', '20000', '-flush_packets', '1', 'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'], env: Object.assign({}, process.env, { PULSE_SERVER: 'unix:' + path.join(pulseDir, 'native') }) });
    audioPump.ff = ff;
    audioPump.buf = Buffer.alloc(0);
    audioPump.carry = [];
    audioPump.packets = 0;
    audioPump.base = Infinity;
    audioPump.lastGranule = -1;
    ff.stdout.on('data', (chunk) => readOggPages(chunk, Date.now()));
    const gone = () => {
        if (audioPump.ff !== ff) return;
        audioPump.ff = null;
        // ffmpeg died under a listener (PulseAudio restarted): try again once it is back
        if (audioPump.listener && audioPump.listener.readyState === 1) setTimeout(startAudioPump, 1000).unref();
    };
    ff.once('exit', gone);
    ff.once('error', gone);
}

function stopAudioPump() {
    const ff = audioPump.ff;
    audioPump.ff = null;
    if (ff) ff.kill('SIGKILL');
}

// Ogg pages: 'OggS', header type, granule (int64 LE, samples at 48 kHz after the last packet that ends on the page),
// serial, sequence, CRC, segment count and lacing table; a packet ends on a lacing value under 255.
function readOggPages(chunk, arrivedAt) {
    let buf = audioPump.buf.length ? Buffer.concat([audioPump.buf, chunk]) : chunk;
    let at = 0;
    while (buf.length - at >= 27) {
        if (buf.readUInt32BE(at) !== 0x4f676753) {
            const next = buf.indexOf('OggS', at + 1);
            if (next < 0) { at = buf.length; break; }
            at = next;
            continue;
        }
        const segments = buf[at + 26];
        if (buf.length - at < 27 + segments) break;
        let size = 0;
        for (let i = 0; i < segments; i++) size += buf[at + 27 + i];
        const end = at + 27 + segments + size;
        if (buf.length < end) break;
        const granule = Number(buf.readBigInt64LE(at + 6));
        const done = [];
        let offset = at + 27 + segments;
        for (let i = 0; i < segments; i++) {
            const lace = buf[at + 27 + i];
            audioPump.carry.push(buf.subarray(offset, offset + lace));
            offset += lace;
            if (lace < 255) {
                done.push(Buffer.concat(audioPump.carry));
                audioPump.carry = [];
            }
        }
        if (done.length) sendOpusPackets(done, granule, arrivedAt);
        at = end;
    }
    audioPump.buf = at >= buf.length ? Buffer.alloc(0) : Buffer.from(buf.subarray(at));
}

function sendOpusPackets(packets, granule, arrivedAt) {
    const ws = audioPump.listener;
    for (let i = 0; i < packets.length; i++) {
        const packet = packets[i];
        audioPump.packets += 1;
        // OpusHead and OpusTags
        if (audioPump.packets <= 2 || granule < 0) continue;
        // each packet is 20 ms (960 samples); the ones before the page's last end earlier
        const endSample = granule - (packets.length - 1 - i) * 960;
        if (endSample <= audioPump.lastGranule) continue;
        audioPump.lastGranule = endSample;
        // the stream's start on this clock: the earliest arrival seen less the audio it carried (a late page never moves it)
        audioPump.base = Math.min(audioPump.base, arrivedAt - endSample / OPUS_SAMPLES_PER_MS);
        const stamp = audioPump.base - AUDIO_CAPTURE_LAG_MS + (endSample - 960) / OPUS_SAMPLES_PER_MS;
        if (!ws || ws.readyState !== 1 || ws.bufferedAmount > AUDIO_SOCKET_MAX_BUFFER) continue;
        const msg = Buffer.allocUnsafe(9 + packet.length);
        msg[0] = MSG_AUDIO;
        msg.writeDoubleLE(stamp, 1);
        packet.copy(msg, 9);
        ws.send(msg);
    }
}

/**
 * Which Chrome window a session's page goes in (#756, Internet Properties > Advanced > Alchemy performance):
 *   isolateClients + isolateWindows   one window per Melaton IE window (its tabs are Chrome tabs)
 *   isolateClients only               one window per client
 *   neither                           one window for every client: only the tab in front paints, so only the
 *                                     active client's current tab streams
 * A page nobody owns (agent tabs, old clients) keeps a window of its own.
 */
function windowGroup(owner) {
    if (!owner) return '';
    if (!perf.isolateClients) return 'all';
    const client = owner.clientSession || owner.deviceId;
    return perf.isolateWindows ? client + '/' + (owner.windowId || '') : client;
}

function targetIdOf(page) {
    const target = page && page.target ? page.target() : null;
    return (target && (target._targetId || (target._targetInfo && target._targetInfo.targetId))) || '';
}

let openChain = Promise.resolve();

// Windowed Chrome stops painting a background tab: a page in a shared window is brought to the front when its
// viewer shows it (onViewerMessage 'visibility'); a page of its own group gets a window.
async function openPage(instance, owner) {
    if (!HEADFUL) return instance.newPage();
    const group = windowGroup(owner);
    const run = openChain.then(async () => {
        const marker = 'about:blank#alchemy-' + crypto.randomBytes(8).toString('hex');
        const sibling = group ? [...sessions.values()].find((x) => x.group === group && x.page && !x.page.isClosed()) : null;
        const client = await instance.target().createCDPSession();
        try {
            const anchor = sibling ? targetIdOf(sibling.page) : '';
            if (anchor) {
                // a new tab opens in the window used last: make it the sibling's
                await client.send('Target.activateTarget', { targetId: anchor }).catch(() => {});
                await client.send('Target.createTarget', { url: marker, newWindow: false });
            } else {
                await client.send('Target.createTarget', { url: marker, newWindow: true });
            }
        } finally {
            client.detach().catch(() => {});
        }
        const target = await instance.waitForTarget((t) => t.url() === marker, { timeout: 10000 });
        return target.page();
    });
    openChain = run.catch(() => {});
    return run;
}

function ensureBrowser() {
    if (browser && browser.connected) return Promise.resolve(browser);
    if (!browserLaunch) browserLaunch = launchBrowser().finally(() => { browserLaunch = null; });
    return browserLaunch;
}

// The desktop pixel ratio changed since launch (#990): Chromium takes a new default zoom only at launch, so it
// relaunches when nothing is open (no session, every page blank: not Hoshino's Alchemy-owned tab), before a new tab.
async function relaunchForZoom() {
    if (!browser || !browser.connected || sessions.size || browserLaunch) return;
    if (emulatedScale || Math.abs(wantedZoom - launchedZoom) < 0.01) return;
    let pages = [];
    try { pages = await browser.pages(); } catch (_) { return; }
    if (pages.some((page) => !/^(about:blank|chrome:\/\/new-?tab)/i.test(page.url() || 'about:blank'))) return;
    console.log('[grimoire-browser] relaunching for display zoom ' + wantedZoom + ' (was ' + launchedZoom + ')');
    await keepSessionCookies().catch(() => {});
    const old = browser;
    browser = null;
    await closeBrowserGently(old, 6000).catch(() => {});
}

// Viewers get 'restarting' first, so they reopen their page instead of showing the failed tab page.
async function restartBrowser() {
    const ids = [...sessions.keys()];
    for (const id of ids) broadcast(sessions.get(id), { type: 'restarting' });
    await keepSessionCookies().catch(() => {});
    const old = browser;
    browser = null;
    for (const id of ids) await closeSession(id);
    if (old) {
        try { await old.close(); } catch (_) {}
    }
    await ensureBrowser();
}

// Cookies go through the browser target; the HTTP cache needs a page target, so an open session's (or a blank page's).
async function clearBrowsingData({ cookies, cache }) {
    await ensureBrowser();
    if (cookies && browserClient) await browserClient.send('Storage.clearCookies', {});
    if (!cache) return;
    const open = [...sessions.values()].find((s) => s && s.cdp);
    if (open) {
        await open.cdp.send('Network.clearBrowserCache');
        return;
    }
    const page = await browser.newPage();
    try {
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCache');
    } finally {
        await page.close().catch(() => {});
    }
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

/**
 * Logins survive a restart (Yukimi, Nov 13 2026: "accounts not keeping their login after an Alchemy restart").
 * Chromium drops session cookies (no expiry) at every launch unless it restores the last session, and many
 * sites sign in with exactly those. Alchemy is a browser that is never "closed" by its owner, so a session
 * cookie of the profile is made persistent (Chromium's 400-day cap) as soon as it is seen: once a minute and
 * at shutdown. Host-only cookies are set by url (a domain would widen them to subdomains); private contexts
 * (CardSpace's isolated sign-in) are left alone.
 */
const KEEP_COOKIE_MS = 400 * 24 * 3600 * 1000;
const KEEP_COOKIES_EVERY_MS = 60 * 1000;
let keepingCookies = false;
async function keepSessionCookies() {
    if (keepingCookies || !browserClient || !browser || !browser.connected) return 0;
    keepingCookies = true;
    try {
        const { cookies = [] } = await browserClient.send('Storage.getCookies', {});
        const expires = Math.floor((Date.now() + KEEP_COOKIE_MS) / 1000);
        const keep = [];
        for (const c of cookies) {
            if (!c.session) continue;
            const hostOnly = !String(c.domain || '').startsWith('.');
            const scheme = c.secure || c.sourceScheme === 'Secure' ? 'https' : 'http';
            const out = { name: c.name, value: c.value, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly, expires };
            if (hostOnly) out.url = scheme + '://' + c.domain + (c.path || '/');
            else out.domain = c.domain;
            if (c.sameSite) out.sameSite = c.sameSite;
            if (c.priority) out.priority = c.priority;
            if (c.sourceScheme) out.sourceScheme = c.sourceScheme;
            if (c.partitionKey) out.partitionKey = c.partitionKey;
            keep.push(out);
        }
        // one at a time: a cookie Chromium refuses (a stale partition key) must not cost the others
        let kept = 0;
        for (const c of keep) {
            try { await browserClient.send('Storage.setCookies', { cookies: [c] }); kept++; } catch (_) {}
        }
        return kept;
    } catch (_) {
        return 0;
    } finally {
        keepingCookies = false;
    }
}
const grantedCaptureOrigins = new Set();

// The camera / mic prompt would open on the invisible X display, so each http(s) origin is granted on its first visit
// (Browser.setPermission without an origin is ignored). Screen share still prompts.
// Clipboard read/write is granted too: the viewer's clipboard is synced through the page (readRemoteClipboard).
function grantCapture(url) {
    let origin = '';
    try { origin = new URL(url).origin; } catch (_) { return Promise.resolve(); }
    if (!/^https?:/.test(origin) || !browserClient || grantedCaptureOrigins.has(origin)) return Promise.resolve();
    grantedCaptureOrigins.add(origin);
    const grants = ['camera', 'microphone'].map((name) => browserClient.send('Browser.setPermission', { permission: { name }, setting: 'granted', origin }));
    grants.push(browserClient.send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }));
    return Promise.all(grants).catch(() => grantedCaptureOrigins.delete(origin));
}

// One Chromium, one clipboard: the last text seen there, so only real changes reach the viewer (and a paste does not echo back).
let remoteClipboard = null;

async function readRemoteClipboard(session) {
    const result = await session.cdp.send('Runtime.evaluate', {
        expression: 'navigator.clipboard.readText()',
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
        timeout: 1500
    });
    if (!result || result.exceptionDetails || !result.result || typeof result.result.value !== 'string') return null;
    return result.result.value.slice(0, 100000);
}

async function writeRemoteClipboard(session, text) {
    const result = await session.cdp.send('Runtime.evaluate', {
        expression: 'navigator.clipboard.writeText(' + JSON.stringify(text) + ').then(() => true)',
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
        timeout: 1500
    });
    return !!(result && !result.exceptionDetails && result.result && result.result.value === true);
}

// force: the user asked to copy, so send the text even when it equals the last one.
async function syncRemoteClipboard(session, force) {
    let text = null;
    try { text = await readRemoteClipboard(session); } catch (_) {}
    if (text === null) return false;
    const changed = remoteClipboard !== null && text !== remoteClipboard;
    remoteClipboard = text;
    if ((changed || force) && text && sessions.get(session.id)) broadcast(session, { type: 'clipboard', text });
    return true;
}

// The first read only learns what is there (it may be from long ago); primed on the first loaded page so the next change counts.
async function primeRemoteClipboard(session) {
    if (remoteClipboard !== null) return;
    let text = null;
    try { text = await readRemoteClipboard(session); } catch (_) {}
    if (text !== null && remoteClipboard === null) remoteClipboard = text;
}

// Copy buttons call navigator.clipboard.writeText, which fires no copy event: look again shortly after a click.
function checkClipboardSoon(session) {
    clearTimeout(session.clipboardCheck);
    session.clipboardCheck = setTimeout(() => {
        session.clipboardCheck = null;
        if (sessions.get(session.id)) syncRemoteClipboard(session, false).catch(() => {});
    }, 400);
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
    // Chromium keeps zoom levels as log base 1.2 of the factor (#990: the default zoom is the desktop pixel ratio)
    const zoom = emulatedScale ? 1 : wantedZoom;
    const zoomLevel = Math.abs(zoom - 1) < 0.001 ? 0 : Math.log(zoom) / Math.log(1.2);
    const partition = prefs.partition && typeof prefs.partition === 'object' ? prefs.partition : {};
    const levels = partition.default_zoom_level && typeof partition.default_zoom_level === 'object' ? partition.default_zoom_level : {};
    // per-host levels would beat the default on their sites; nothing in Alchemy sets one on purpose
    const hostLevels = partition.per_host_zoom_levels && typeof partition.per_host_zoom_levels === 'object' ? partition.per_host_zoom_levels : {};
    const hostsClear = !Object.values(hostLevels).some((v) => v && typeof v === 'object' && Object.keys(v).length);
    launchedZoom = zoom;
    if (prefs.enable_do_not_track === true && Math.abs((Number(levels.x) || 0) - zoomLevel) < 1e-6 && hostsClear) return;
    prefs.enable_do_not_track = true;
    levels.x = zoomLevel;
    partition.default_zoom_level = levels;
    partition.per_host_zoom_levels = {};
    prefs.partition = partition;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(prefs), { mode: 0o600 });
}

async function launchBrowser() {
    if (!chromeBin) throw new Error('Chrome binary not found. Set CHROME_BIN.');
    fs.mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(PROFILE_DIR, 0o700);
    emulatedScale = patchedBuild(chromeBin);
    setProfilePrefs();
    extensions = readExtensions();
    const extensionDirs = extensions.map((ext) => ext.dir).join(',');
    const args = [
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        // site isolation off (#756): pages of several sites share renderers, so fewer processes each with the extensions' scripts
        '--disable-features=WebAuthentication,WebAuthnConditionalUI,DisableLoadExtensionCommandLineSwitch' + (perf.siteIsolation ? '' : ',IsolateOrigins,site-per-process'),
        '--disable-background-networking',
        '--disable-sync',
        '--disable-popup-blocking',
        '--disable-blink-features=AutomationControlled'
    ];
    // --enable-unsafe-extension-debugging: CDP's Extensions domain (triggerAction: Grimoire's toolbar buttons), on the
    // pipe only; the loopback debugging port never gets it
    if (extensionDirs) args.push('--disable-extensions-except=' + extensionDirs, '--load-extension=' + extensionDirs, '--enable-unsafe-extension-debugging');
    else args.push('--disable-extensions');
    if (!perf.sandbox) args.push('--no-sandbox', '--disable-setuid-sandbox');
    if (!perf.siteIsolation) args.push('--disable-site-isolation-trials');
    if (perf.rendererLimit) args.push('--renderer-process-limit=' + perf.rendererLimit);
    if (!perf.componentUpdate) args.push('--disable-component-update');
    if (!HEADFUL && !perf.headlessGpu) args.push('--disable-gpu');
    // Chromium reads one --enable-features (the last): every feature goes in this list
    const enableFeatures = [];
    if (emulatedScale) enableFeatures.push(EMULATED_SCALE_FEATURE);
    launchedPerf = Object.assign({}, perf);
    // Loopback only: Dreamscape drives one Alchemy-owned tab here (identity-gated MCP); cookies never leave Chromium.
    if (ALCHEMY_CDP_PORT) args.push('--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + ALCHEMY_CDP_PORT);
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
        if (gpu) {
            args.push('--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization');
            enableFeatures.push('Vulkan', 'VulkanFromANGLE', 'DefaultANGLEVulkan');
        }
        else args.push('--enable-unsafe-swiftshader');
        console.log('[grimoire-browser] rendering ' + (gpu ? 'on the GPU (' + GPU_NODE + ')' : 'in software (no access to ' + GPU_NODE + ')'));
        // Session windows overlap on the virtual screen; covered windows must keep painting and running timers.
        args.push('--ozone-platform=x11', '--window-size=1280,800', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling');
        // the viewer animates a wheel turn itself; Chromium's own animation would put rows off the JPEG block grid
        // and turn every scrolled frame into a whole one (#990 round 2)
        args.push('--disable-smooth-scrolling');
    }
    args.push(...fakeCaptureArgs());
    if (enableFeatures.length) args.push('--enable-features=' + enableFeatures.join(','));
    if (emulatedScale) console.log('[grimoire-browser] Alchemy build: tabs render at their viewers\' pixel ratio (' + EMULATED_SCALE_FEATURE + ')');
    const instance = await puppeteer.launch({
        executablePath: chromeBin,
        headless: !HEADFUL,
        pipe: true,
        userDataDir: PROFILE_DIR,
        ignoreDefaultArgs: ['--disable-extensions'],
        // Puppeteer's own signal handlers SIGKILL Chromium and exit before the shutdown below runs: every
        // restart lost the cookies Chromium had not written yet and left the profile marked Crashed (Nov 13
        // 2026). The shutdown closes Chromium itself (browser.close: tabs closed, profile saved).
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
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
    // the phone identity (viewKind 'mobile'): Chrome for Android's reduced user agent, the same Alchemy token and brands
    const mobileChromeUa = chromeUa.replace(/\([^)]*\)/, '(Linux; Android 10; K)').replace(/ Safari\//, ' Mobile Safari/');
    mobileUserAgent = mobileChromeUa + ' Alchemy/' + uaVersion;
    mobileUserAgentMetadata = Object.assign({}, pageUserAgentMetadata, {
        platform: 'Android',
        platformVersion: '16.0.0',
        architecture: '',
        model: '',
        mobile: true,
        bitness: '',
        formFactors: ['Mobile']
    });
    plainMobileUserAgent = mobileChromeUa;
    plainMobileUserAgentMetadata = Object.assign({}, mobileUserAgentMetadata, {
        brands: mobileUserAgentMetadata.brands.slice(0, 2),
        fullVersionList: mobileUserAgentMetadata.fullVersionList.slice(0, 2)
    });
    browser = instance;
    return browser;
}

async function startScreencast(session) {
    session.casting = true;
    // the frame is the viewport's DIP size (desktop: device pixels, see applyViewport); never scaled down
    await session.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: session.settings.jpegQuality,
        maxWidth: Math.ceil((session.dipWidth || session.width) * (session.pxPerDip || 1)),
        maxHeight: Math.ceil(((session.dipHeight || session.height) + (session.bandDip || 0)) * (session.pxPerDip || 1)),
        everyNthFrame: 1
    });
}

async function restartScreencast(session) {
    // a paused capture (nobody watching, or frozen over its memory limit) stays paused; it starts with the new settings when shown
    if (!session.casting && (perf.pauseUnwatched || session.memFrozen)) return;
    try { await session.cdp.send('Page.stopScreencast'); } catch (_) {}
    await startScreencast(session);
}

/**
 * Pages nobody looks at are not captured (#756 "Pause pages nobody is watching", on by default): no viewer, or
 * every viewer hidden (a background tab: grimoireTabs.js tells its viewer). One capture per IE window this way.
 */
function syncCapture(session) {
    if (!sessions.get(session.id) || session.closing || session.memFrozen) return;
    const watched = session.sockets.size > 0 && !session.viewHidden;
    if (!perf.pauseUnwatched || watched) {
        if (!session.casting) startScreencast(session).catch(() => {});
        return;
    }
    if (!session.casting) return;
    session.casting = false;
    session.cdp.send('Page.stopScreencast').catch(() => {});
}

// ---- memory per tab (#756 "Maximum memory per tab") ----
// A tab's memory is its page's JavaScript heap (Performance.getMetrics JSHeapTotalSize): with shared renderers
// (site isolation off) a process size is not one tab's. Only tabs open on a client count. Over the limit the page
// is frozen and its viewer asks whether to allow more for this tab (memory-override), as long as it stays open.

async function checkMemory(session) {
    if (!session.cdp || session.closing || !sessions.get(session.id)) return;
    if (!session.perfEnabled) {
        await session.cdp.send('Performance.enable').catch(() => {});
        session.perfEnabled = true;
    }
    let metrics = null;
    try { metrics = await session.cdp.send('Performance.getMetrics'); } catch (_) { return; }
    const heap = ((metrics && metrics.metrics) || []).find((m) => m.name === 'JSHeapTotalSize');
    session.memMb = heap ? Math.round(heap.value / 1048576) : 0;
    const limit = perf.tabMemoryMb || 0;
    const level = !limit || session.memOverride ? 'ok' : session.memMb >= limit ? 'over' : session.memMb >= limit * 0.8 ? 'warn' : 'ok';
    if (level !== session.memLevel || level === 'warn') broadcast(session, { type: 'memory', level, usedMb: session.memMb, limitMb: limit });
    session.memLevel = level;
    if (level === 'over' && !session.memFrozen) await freezeSession(session);
}

async function freezeSession(session) {
    session.memFrozen = true;
    session.casting = false;
    await session.cdp.send('Page.stopScreencast').catch(() => {});
    await session.cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {});
    broadcast(session, { type: 'memory-limit', usedMb: session.memMb, limitMb: perf.tabMemoryMb || 0 });
}

async function thawSession(session) {
    if (!session.memFrozen) return;
    session.memFrozen = false;
    await session.cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
    session.memLevel = 'ok';
    broadcast(session, { type: 'memory', level: 'ok', usedMb: session.memMb, limitMb: perf.tabMemoryMb || 0 });
    syncCapture(session);
}

// Grimoire's zoom (the IE7 status bar's 100% ▾): a narrower CSS viewport drawn at a higher device scale, so the
// page reflows and stays sharp; its frames have the viewport's DIP pixels (#990: zoomed in, fewer than the screen's,
// and the viewer scales them up). Input needs nothing: the viewer maps pointer positions through the frame metadata.
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
// a 4K screen at 100 %, or a 1920 x 1200 window at 200 %
const DIP_MAX_WIDTH = 3840;
const DIP_MAX_HEIGHT = 2400;
// the band drawn below a desktop page's viewport on the Alchemy build, as a share of the viewport's height
const OVERSCAN = 0.5;

// On the Alchemy build a live page whose emulated scale changes keeps drawing at the old one until its surface is
// allocated again (measured: 1.5 -> 2 left the page at 2/3 of the frame); a size change does that, so the viewport
// goes one pixel wider for a moment first. Only when the scale really changes (a viewer's ratio, Grimoire's zoom).
function scaleChanged(session) {
    const scale = session.pxPerDip || 1;
    // a new page starts at scale 1 (createSession's first viewport)
    const before = session.appliedPxPerDip == null ? 1 : session.appliedPxPerDip;
    session.appliedPxPerDip = scale;
    return emulatedScale && Math.abs(before - scale) > 0.001;
}

async function applyViewport(session) {
    // an extension's toolbar popup takes no viewport override: frames are its own size (at most 800 x 600, 1:1)
    if (session.extensionPopup) {
        session.dipWidth = 800;
        session.dipHeight = 600;
        session.pxPerDip = 1;
        session.cssPerPx = 1;
        session.bandDip = 0;
        return;
    }
    const zoom = session.zoom || 1;
    if (session.viewKind === 'mobile') {
        // straight to CDP: Puppeteer's setViewport reloads the page by itself when isMobile / hasTouch change,
        // and waits for the load; the reload here is the session's own (view-kind)
        const width = Math.max(80, Math.round(session.width / zoom));
        const height = Math.max(60, Math.round(session.height / zoom));
        session.dipWidth = width;
        session.dipHeight = height;
        session.cssPerPx = 0;
        // the Alchemy build draws the phone's page at its ratio: frames have the phone's device pixels
        session.pxPerDip = emulatedScale ? mobileDeviceScale(session) : 1;
        if (scaleChanged(session)) {
            await session.cdp.send('Emulation.setDeviceMetricsOverride', {
                width: width + 1,
                height,
                deviceScaleFactor: mobileDeviceScale(session),
                mobile: true
            }).catch(() => {});
        }
        await session.cdp.send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: mobileDeviceScale(session),
            mobile: true,
            screenOrientation: width > height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 }
        });
        await session.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: MOBILE_TOUCH_POINTS });
        session.mobileMetrics = true;
        return;
    }
    if (session.mobileMetrics) {
        // back to desktop: Puppeteer skips a viewport it believes is still set, so the phone's is taken off here
        session.mobileMetrics = false;
        await session.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
        await session.cdp.send('Emulation.setDeviceMetricsOverride', {
            width: Math.max(80, Math.round(session.width / zoom)),
            height: Math.max(60, Math.round(session.height / zoom)),
            deviceScaleFactor: zoom,
            mobile: false
        }).catch(() => {});
    }
    // #990: DIP = the page's CSS size times Chromium's default zoom (launchedZoom), so frames are that many pixels; the
    // viewer's device pixels when it reports them (pxWidth) and its pixel ratio is that zoom. The emulated scale keeps
    // devicePixelRatio = the viewer's ratio times Grimoire's zoom, so the page picks images for the real screen.
    // On the Alchemy build (#993) the zoom is 1 and the emulated scale alone gives the frames dpr x zoom pixels per CSS
    // pixel (pxPerDip), exact for every tab.
    const z0 = launchedZoom || 1;
    const dpr = session.dpr || (emulatedScale ? 1 : z0);
    const cssW = (session.pxWidth ? session.pxWidth / dpr : session.width) / zoom;
    const cssH = (session.pxHeight ? session.pxHeight / dpr : session.height) / zoom;
    const width = Math.max(80, Math.min(DIP_MAX_WIDTH, Math.round(cssW * z0)));
    const height = Math.max(60, Math.min(DIP_MAX_HEIGHT, Math.round(cssH * z0)));
    session.dipWidth = width;
    session.dipHeight = height;
    session.cssPerPx = 1 / z0;
    session.pxPerDip = emulatedScale ? dpr * zoom : 1;
    // On the session the screencast runs on (#993): each DevTools session keeps its own emulation, and the Alchemy
    // build sizes the capture from the emulation of the session that captures (Puppeteer's setViewport is its own).
    const deviceScaleFactor = Math.max(0.25, Math.min(8, (dpr * zoom) / z0));
    // Over-render (#993 patch 2): on the Alchemy build the view is OVERSCAN taller than the page's viewport, and the
    // page draws on into that band (its layout, viewport and fixed bars do not move); the viewer scrolls into it.
    const band = emulatedScale ? Math.round(height * OVERSCAN) : 0;
    session.bandDip = band;
    const metrics = { width, height, deviceScaleFactor, mobile: false, dontSetVisibleSize: band > 0 };
    if (scaleChanged(session)) {
        await session.cdp.send('Emulation.setDeviceMetricsOverride', Object.assign({}, metrics, { width: width + 1 })).catch(() => {});
        if (band) await session.cdp.send('Emulation.setVisibleSize', { width: width + 1, height: height + band }).catch(() => {});
    }
    await session.cdp.send('Emulation.setDeviceMetricsOverride', metrics);
    if (band) await session.cdp.send('Emulation.setVisibleSize', { width, height: height + band }).catch(() => { session.bandDip = 0; });
}

// Feeds ▾: the RSS / Atom feeds the page advertises (<link rel="alternate">), sent when they change.
async function publishFeeds(session) {
    let feeds = [];
    try {
        feeds = await session.page.evaluate(() => Array.from(document.querySelectorAll('link[rel~="alternate"][href]'))
            .filter((link) => /(rss|atom)\+xml|application\/feed\+json/i.test(link.type || ''))
            .slice(0, 20)
            .map((link) => ({ href: link.href, title: (link.title || '').trim().slice(0, 200) })));
    } catch (_) {
        return;
    }
    const key = JSON.stringify(feeds);
    if (key === session.feedsKey || !sessions.get(session.id)) return;
    session.feedsKey = key;
    session.feeds = feeds;
    broadcast(session, { type: 'feeds', feeds });
}

// Print (Grimoire's Print ▾): headful Chromium has no Page.printToPDF, so the whole page goes out as
// one picture (up to 12000 CSS pixels tall) that the Grimoire window lays out on paper.
async function capturePrintPage(session) {
    await settleStill(session);
    const metrics = await session.cdp.send('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize || {};
    const width = Math.max(1, Math.ceil(size.width || session.width));
    const height = Math.max(1, Math.min(12000, Math.ceil(size.height || session.height)));
    const shot = await session.cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 90,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 }
    });
    return { image: 'data:image/jpeg;base64,' + shot.data, width, height };
}

// adoptedPage: a popup page that is already open (adoptPopup); popup sessions close with their page.
async function createSession(body, adoptedPage) {
    const popup = !!(adoptedPage || (body && body.popup));
    if (body && body.performance) takePerf(body.performance);
    if ((popup ? popupCount() : sessions.size - popupCount()) >= (perf.maxTabs || MAX_SESSIONS)) {
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
    // a desktop tab's pixel ratio from the request (Grimoire sends it): with nothing open yet, Chromium takes it now
    const askedRatio = Number(body && body.pixelRatio);
    if (!adoptedPage && !popup && !(body && body.viewKind === 'mobile') && askedRatio >= 0.5 && askedRatio <= 8) noteDesktopPixelRatio(askedRatio);
    if (!adoptedPage) await relaunchForZoom();
    const instance = await ensureBrowser();
    const ownerForPage = normalizeOwner(body && body.owner);
    // isolated: a throwaway browser context of its own (CardSpace's Google sign-in for RCS pairing). Its cookies
    // never meet the profile's, so the sign-in handed to the RCS bridge is not the one Alchemy keeps using
    // (Google signs out a session whose rotating cookies two clients present; Nov 13 2026)
    const isolatedCtx = !adoptedPage && body && body.isolated === true ? await instance.createBrowserContext() : null;
    const page = adoptedPage || (isolatedCtx ? await isolatedCtx.newPage() : await openPage(instance, ownerForPage));
    ownPages.add(page);
    if (pageUserAgent) await page.setUserAgent(pageUserAgent, pageUserAgentMetadata);
    await page.evaluateOnNewDocument(blockPasskeys);
    if (!(body && body.extensionPopup)) await page.setViewport({ width, height, deviceScaleFactor: 1 });
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
        isolatedCtx,
        url: adoptedPage ? normalizeWebUrl(page.url()) : (url === 'about:blank' ? '' : url),
        title: '',
        popup,
        extensionPopup: !!(body && body.extensionPopup),
        parentId: String((body && body.parentId) || ''),
        width,
        height,
        zoom: 1,
        // 'mobile': the phone identity (Internet Explorer Mobile's Mobile view); a popup is what its opener is
        viewKind: body && body.viewKind !== undefined ? viewKindOf(body.viewKind)
            : viewKindOf(body && body.parentId && sessions.get(String(body.parentId)) && sessions.get(String(body.parentId)).viewKind),
        feeds: [],
        feedsKey: '[]',
        settings: sessionSettings(body && body.settings, DEFAULT_SETTINGS),
        sockets: new Set(),
        idleAt: Date.now() + IDLE_MS,
        // a popup or adopted tab belongs to whoever owns the page that opened it
        group: adoptedPage ? '' : windowGroup(ownerForPage),
        casting: false,
        viewHidden: false,
        memMb: 0,
        memLevel: 'ok',
        memFrozen: false,
        memOverride: false,
        owner: normalizeOwner(body && body.owner) || (body && body.parentId && sessions.get(String(body.parentId)) && sessions.get(String(body.parentId)).owner
            ? Object.assign({}, sessions.get(String(body.parentId)).owner) : null),
        leaseUntil: Date.now() + LEASE_GRACE_MS,
        meta: null,
        downloads: new Map(),
        downloadDir: '',
        downloadWatch: null,
        inputChain: Promise.resolve(),
        navGen: 0,
        pendingNav: null,
        navRunning: false,
        navigating: false,
        navTarget: '',
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
    if (body && body.settings && body.settings.autoQuality === false) {
        aqState(session).auto = false;
        session.manualSettings = Object.assign({}, session.settings);
    }
    if (session.viewKind === 'mobile') {
        // before the first page loads; the viewer's pixel ratio may come with the request (viewScale)
        session.clientScale = Math.max(0, Math.min(STILL_MAX_SCALE, Number(body && body.viewScale) || 0));
        await applyIdentity(session, false).catch(() => {});
        await applyViewport(session).catch(() => {});
    } else {
        // the desktop page loads at its real CSS size from the start (#990); the viewer's pixel ratio may come with
        // the request (pixelRatio), else its first resize brings it
        const dpr = Number(body && body.pixelRatio);
        if (dpr >= 0.5 && dpr <= 8) session.dpr = dpr;
        await applyViewport(session).catch(() => {});
    }
    armDownloads(session);
    armFileChooser(session);

    try {
        const tree = await cdp.send('Page.getFrameTree');
        session.mainFrameId = tree && tree.frameTree && tree.frameTree.frame && tree.frameTree.frame.id || '';
    } catch (_) {}
    cdp.send('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => {});

    // Chromium gives the main frame a new id on cross-process navigations; keep mainFrameId in sync
    // so lifecycle / loading events still end the navigating state (otherwise only navSettle fires).
    cdp.on('Page.frameNavigated', (ev) => {
        if (!sessions.get(id) || !ev || !ev.frame || ev.frame.parentId) return;
        session.mainFrameId = ev.frame.id || session.mainFrameId;
        session.committedUrl = ev.frame.unreachableUrl || ((ev.frame.url || '') + (ev.frame.urlFragment || ''));
    });

    // Isolated world: a page-visible binding (page.exposeFunction) makes Cloudflare Turnstile refuse the click.
    cdp.on('Runtime.bindingCalled', (ev) => {
        if (ev && ev.name === '__alchemySelect' && sessions.get(id)) {
            let picked = null;
            try { picked = JSON.parse(ev.payload); } catch (_) {}
            if (!picked || !Array.isArray(picked.options)) return;
            session.selectContextId = ev.executionContextId;
            // the list's place in the picture (a mobile page drawn smaller: see onViewerMessage)
            // (a desktop page: CSS pixels to the picture's DIP, #990)
            const pageScale = session.viewKind === 'mobile' ? Number(session.meta && session.meta.pageScaleFactor) || 1 : (session.cssPerPx ? 1 / session.cssPerPx : 1);
            broadcast(session, { type: 'select', options: picked.options, selected: picked.selected, x: (Number(picked.x) || 0) * pageScale, y: (Number(picked.y) || 0) * pageScale });
            return;
        }
        if (ev && ev.name === '__alchemyClipboard' && sessions.get(id)) {
            // The viewer's own Ctrl+C reads and sends the clipboard itself.
            if (!session.copying) syncRemoteClipboard(session, false).catch(() => {});
            return;
        }
        if (ev && ev.name === '__alchemyLayers' && sessions.get(id)) {
            const layers = parseLayers(ev.payload);
            if (!layers) return;
            if (PACK_DEBUG) console.log('[grimoire-browser] layers sy', layers.sy, 'f', layers.f.length, 'backdrop', layers.backdrop, 'cover', layers.cover, layers.v ? 'v ' + layers.v.r.length + ' rects, ' + layers.v.cols.length + ' cols, rows ' + layers.v.d0 + '-' + layers.v.d1 : '', String(ev.payload).length + ' B');
            // the backdrop's sampled rows stay with the session (a viewer that joins later gets them too)
            if (layers.reset) session.layersVis = null;
            if (layers.v) {
                const prev = session.layersVis && !layers.reset ? session.layersVis.r : [];
                const keep = prev.filter((q) => q[1] + q[3] <= layers.v.d0 || q[1] >= layers.v.d1);
                const ranges = (session.layersVis && !layers.reset ? session.layersVis.ranges : []).concat([[layers.v.d0, layers.v.d1]]).slice(-24);
                session.layersVis = { d0: layers.v.d0, d1: layers.v.d1, r: keep.concat(layers.v.r).slice(-600), cols: layers.v.cols, ranges };
            }
            if (!layers.backdrop) session.layersVis = null;
            session.layers = layers;
            broadcast(session, layers);
            return;
        }
        if (ev && ev.name === '__alchemyScroll' && sessions.get(id)) {
            const [y, height, view, x = 0, width = 0, viewWidth = 0, root = 1, bandTop = 0, bandBottom = 0] = String(ev.payload || '').split(':').map(Number);
            if (![y, height, view, x, width, viewWidth, root, bandTop, bandBottom].every(Number.isFinite)) return;
            session.scrollContextId = ev.executionContextId;
            // root / bandTop / bandBottom (#990): whether the document is the scroller, and its fixed bars (CSS pixels)
            session.scroll = { type: 'scroll', y, height, view, x, width, viewWidth, root: root ? 1 : 0, bandTop, bandBottom };
            broadcast(session, session.scroll);
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
    await cdp.send('Runtime.addBinding', { name: '__alchemyClipboard', executionContextName: 'alchemy' });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + watchClipboard + ')()', worldName: 'alchemy' });
    await cdp.send('Runtime.addBinding', { name: '__alchemyScroll', executionContextName: 'alchemy' });
    await cdp.send('Runtime.addBinding', { name: '__alchemyLayers', executionContextName: 'alchemy' });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + watchScroll + ')()', worldName: 'alchemy' });
    // The viewer draws the scrollbar (customScrollbar look); Chromium's own would sit inside the picture.
    await cdp.send('Emulation.setScrollbarsHidden', { hidden: true }).catch(() => {});

    cdp.on('Page.screencastFrame', (event) => {
        const current = sessions.get(id);
        if (!current) return;
        let metadata = event.metadata || {};
        // the over-render band is not part of the page's viewport: the viewer maps pointers through the viewport
        if (current.bandDip && metadata.deviceHeight > current.bandDip) {
            metadata = Object.assign({}, metadata, { deviceHeight: metadata.deviceHeight - current.bandDip });
            event = Object.assign({}, event, { metadata });
        }
        const metaKey = [
            metadata.deviceWidth,
            metadata.deviceHeight,
            metadata.offsetTop,
            metadata.pageScaleFactor
        ].join(':');
        // a refine capture's own frames (captureStill): the same picture again, or one without the over-render band
        // (another size). A frame that differs otherwise is the page changing and goes on.
        if (Date.now() < (current.refineEchoUntil || 0)) {
            const dims = jpegDims(event.data);
            const last = current.lastFrameDims;
            if (event.data === current.lastFrameB64 || (dims && last && (dims[0] !== last[0] || dims[1] !== last[1]))) {
                current.cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
                return;
            }
        }
        // Page.captureScreenshot with a clip scale briefly emulates the bigger device: the screencast
        // sends a frame of that size. It is not the page; drop it (a real change is never that size).
        const side = current.stillSide;
        if (metaKey !== current.metaKey && side && (current.stillBusy || Date.now() < (current.stillQuietUntil || 0))
            && Math.abs((metadata.deviceWidth || 0) - side.w) <= 2 && Math.abs((metadata.deviceHeight || 0) - side.h) <= 2) {
            current.cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
            return;
        }
        if (metaKey !== current.metaKey) {
            current.metaKey = metaKey;
            current.meta = metadata;
            broadcast(current, { type: 'meta', metadata });
        }
        current.lastFrameB64 = event.data;
        current.lastFrameDims = jpegDims(event.data);
        noteScreencastFrame(current, event);
        touch(current);
    });

    const mainFrameEvent = (ev) => session.mainFrameId && ev && ev.frameId === session.mainFrameId;

    cdp.on('Page.frameStartedLoading', (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev)) return;
        session.loadProgress = 0;
        session.loadBytes = 0;
        countLoadBytes(session, true);
        noteLoadProgress(session, 0.1);
        beginNavigating(session, false);
    });

    cdp.on('Page.lifecycleEvent', async (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev)) return;
        if (LOAD_STAGES[ev.name]) noteLoadProgress(session, LOAD_STAGES[ev.name]);
        if (ev.name !== 'DOMContentLoaded' && ev.name !== 'firstContentfulPaint' && ev.name !== 'load' && ev.name !== 'networkAlmostIdle') return;
        try { session.title = await page.title(); } catch (_) {}
        endNavigating(session);
        if (ev.name === 'DOMContentLoaded' || ev.name === 'load') publishFeeds(session).catch(() => {});
    });

    cdp.on('Network.dataReceived', (ev) => noteLoadBytes(session, Number(ev.encodedDataLength) || Number(ev.dataLength) || 0));

    cdp.on('Page.frameStoppedLoading', async (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev)) return;
        countLoadBytes(session, false);
        noteLoadProgress(session, 1);
        try { session.title = await page.title(); } catch (_) {}
        endNavigating(session);
    });

    cdp.on('Page.navigatedWithinDocument', (ev) => {
        if (!sessions.get(id) || !mainFrameEvent(ev) || !ev.url) return;
        session.url = ev.url;
        session.committedUrl = ev.url;
        endNavigating(session);
        publishFeeds(session).catch(() => {});
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
        if (/^(https?:|chrome(-extension)?:)/i.test(next)) {
            // Ignore stale frame URLs while an in-flight target has not committed yet
            // (stopLoading / aborted navigations can re-emit the previous page).
            if (!(session.navigating && session.navTarget && next !== session.navTarget)) {
                session.url = next;
                if (session.navTarget && next === session.navTarget) {
                    session.navTarget = '';
                    // Commit reached even when lifecycle events miss (stale mainFrameId).
                    if (session.navigating) {
                        clearTimeout(session.navSettle);
                        session.navSettle = null;
                        session.navigating = false;
                    }
                }
            }
        }
        applySiteUserAgent(session, next);
        grantCapture(next).then(() => (remoteClipboard === null ? primeRemoteClipboard(session) : null)).catch(() => {});
        publishLocation(session);
    });

    await startScreencast(session);
    // a page nobody opens a viewer for stops being captured after a while (syncCapture)
    setTimeout(() => syncCapture(session), 15000).unref();

    if (url !== 'about:blank') requestNavigate(session, url, false);
    armHealth(session);

    return session;
}

function sessionPublic(session) {
    return {
        id: session.id,
        url: (session.navigating && session.navTarget) || session.url,
        title: session.title,
        width: session.width,
        height: session.height,
        viewers: session.sockets.size,
        popup: !!session.popup,
        parentId: session.parentId || '',
        viewKind: session.viewKind || 'desktop',
        owner: session.owner || null,
        leaseUntil: session.owner ? session.leaseUntil : 0
    };
}

// Grimoire's context menu (grimoireRemoteBrowser.js): what it asks of the page at the point the menu was opened for.
//   replace-word  a spelling suggestion (Dreamscape's spell engine) takes the place of the word under the point in
//                 the field, as typing would (insertText keeps the page's undo and input events)
//   edit          Undo / Redo / Delete / Select All in the page, as its Edit menu does
//   show-picture  loads a picture that did not load (IE7's Show Picture)
//   inspect       Chromium's DevTools for this page in a new Grimoire tab, the element under the point selected
const MENU_EDIT_COMMANDS = new Set(['undo', 'redo', 'delete', 'selectAll']);
async function menuAction(session, msg) {
    const page = session.page;
    const cx = Number(msg.cx);
    const cy = Number(msg.cy);
    const at = Number.isFinite(cx) && Number.isFinite(cy);
    if (!page || page.isClosed()) return;
    try {
        if (msg.action === 'replace-word' && at && typeof msg.word === 'string' && typeof msg.text === 'string') {
            await page.evaluate((px, py, word, text) => {
                let active = document.activeElement;
                while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
                const cp = document.caretPositionFromPoint ? document.caretPositionFromPoint(px, py) : null;
                if (!cp || !active) return;
                const letter = /[\p{L}\p{M}'’]/u;
                const bounds = (value, offset) => {
                    let s = offset;
                    let e = offset;
                    while (s > 0 && letter.test(value[s - 1])) s--;
                    while (e < value.length && letter.test(value[e])) e++;
                    while (s < e && /['’]/.test(value[s])) s++;
                    while (e > s && /['’]/.test(value[e - 1])) e--;
                    return value.slice(s, e) === word ? [s, e] : null;
                };
                if ((active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && cp.offsetNode === active) {
                    const r = bounds(String(active.value || ''), cp.offset);
                    if (!r) return;
                    active.setSelectionRange(r[0], r[1]);
                } else if (cp.offsetNode && cp.offsetNode.nodeType === 3) {
                    const r = bounds(cp.offsetNode.data, cp.offset);
                    if (!r) return;
                    const range = document.createRange();
                    range.setStart(cp.offsetNode, r[0]);
                    range.setEnd(cp.offsetNode, r[1]);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    return;
                }
                document.execCommand('insertText', false, text);
            }, cx, cy, msg.word.slice(0, 64), msg.text.slice(0, 200));
        } else if (msg.action === 'edit' && MENU_EDIT_COMMANDS.has(msg.command)) {
            await page.evaluate((command) => { document.execCommand(command); }, msg.command);
        } else if (msg.action === 'show-picture' && at) {
            await page.evaluate((px, py) => {
                const el = document.elementFromPoint(px, py);
                const img = el && el.closest ? el.closest('img') : null;
                if (img && img.src) {
                    const src = img.src;
                    img.src = '';
                    img.src = src;
                }
            }, cx, cy);
        } else if (msg.action === 'inspect') {
            // not awaited: the page's input queue keeps moving while DevTools loads
            openDevTools(session, at ? cx : null, at ? cy : null).catch((err) => console.error('[grimoire-browser] devtools', err && err.message));
        }
    } catch (err) {
        console.error('[grimoire-browser] menu-action', msg.action, err && err.message);
    }
}

// Inspect: the DevTools frontend Chromium serves on the loopback debugging port, for this page's target, as a tab of
// its own (a page streamed like any other, adopted as the 1Password "new tab" pages are). The frontend's socket comes
// from the port's own origin, which Chromium accepts. Then the element under the point is revealed in Elements.
async function openDevTools(session, x, y) {
    const targetId = targetIdOf(session.page);
    // (the loopback port turned off: nothing to show DevTools from)
    if (!ALCHEMY_CDP_PORT || !targetId) return;
    const host = '127.0.0.1:' + ALCHEMY_CDP_PORT;
    const url = 'http://' + host + '/devtools/inspector.html?ws=' + host + '/devtools/page/' + encodeURIComponent(targetId);
    const instance = await ensureBrowser();
    const tools = await openPage(instance, session.owner);
    // ours from the start: adoptOrphan would take it as a second tab while it loads
    ownPages.add(tools);
    // the page is already on show in its own tab: DevTools' screencast of it stays off (its setting, read at start)
    await tools.evaluateOnNewDocument(() => {
        try { localStorage.setItem('screencast-enabled', 'false'); } catch (_) { /* storage off */ }
    }).catch(() => {});
    await tools.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await adoptPopup(session, tools, '');
    if (x === null || y === null) return;
    // DevTools' own modules: wait for the page's target, then find the node at the point and reveal it
    tools.evaluate(async (px, py) => {
        const SDK = await import('./core/sdk/sdk.js');
        const Common = await import('./core/common/common.js');
        const tm = SDK.TargetManager.TargetManager.instance();
        let target = null;
        for (let i = 0; i < 100 && !target; i++) {
            target = tm.primaryPageTarget();
            if (!target) await new Promise((r) => setTimeout(r, 100));
        }
        const dom = target && target.model(SDK.DOMModel.DOMModel);
        if (!dom) return;
        await dom.requestDocument();
        const node = await dom.nodeForLocation(Math.round(px), Math.round(py), true);
        if (node) await Common.Revealer.reveal(node);
    }, x, y).catch(() => {});
}

async function onViewerMessage(session, raw, ws) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;
    touch(session);
    const page = session.page;
    // A mobile page with no viewport meta is drawn smaller (pageScaleFactor under 1): the viewer's positions are
    // the picture's, Chromium's pointer positions are in the page's own CSS pixels (wheel distances are not).
    if (session.viewKind === 'mobile' && (msg.type === 'mouse' || msg.type === 'wheel' || msg.type === 'inspect' || msg.type === 'touch')) {
        // DevTools scales input by the browser's default zoom (#990), which a phone page's layout ignores
        if (launchedZoom && Math.abs(launchedZoom - 1) > 0.001) {
            for (const key of ['x', 'y']) {
                if (typeof msg[key] === 'number' && Number.isFinite(msg[key])) msg[key] /= launchedZoom;
            }
        }
        const pageScale = Number(session.meta && session.meta.pageScaleFactor) || 1;
        if (Math.abs(pageScale - 1) > 0.001) {
            for (const key of ['x', 'y']) {
                if (typeof msg[key] === 'number' && Number.isFinite(msg[key])) msg[key] /= pageScale;
            }
        }
    }
    // #990: a desktop page's picture is in DIP (the CSS size times Chromium's default zoom); Chromium takes pointer
    // positions in CSS pixels and wheel distances in DIP. A wheel notch moves the page as far on screen as in a local
    // browser: the viewer's CSS pixels are its device pixels over its ratio, the picture's DIP over the zoom.
    if (session.viewKind !== 'mobile' && session.cssPerPx && (msg.type === 'mouse' || msg.type === 'wheel' || msg.type === 'inspect')) {
        for (const key of ['x', 'y']) {
            if (typeof msg[key] === 'number' && Number.isFinite(msg[key])) msg[key] *= session.cssPerPx;
        }
        if (msg.type === 'wheel' && session.dipWidth && session.width) {
            // (the Alchemy build lays the page out at its emulated scale, and DevTools does not scale wheel distances
            // by it as it does positions: they go in that scale's pixels, #993)
            const perCss = session.dipWidth / (session.pxWidth && session.dpr ? session.pxWidth / session.dpr : session.width)
                * (emulatedScale ? session.pxPerDip || 1 : 1);
            msg.deltaX = (Number(msg.deltaX) || 0) * perCss;
            msg.deltaY = (Number(msg.deltaY) || 0) * perCss;
        }
    }
    if (msg.type === 'dialog-reply') {
        if (session.dialog && session.dialog.id === msg.id) session.dialog.settle(msg);
        return;
    }
    if (msg.type === 'file-chooser-reply') {
        await finishFileChooser(session, msg);
        return;
    }
    if (msg.type === 'select-pick' && Number.isInteger(msg.index) && session.selectContextId) {
        session.cdp.send('Runtime.evaluate', { expression: '__alchemyPickSelect(' + msg.index + ')', contextId: session.selectContextId }).catch(() => {});
        return;
    }
    // Alchemy's download dialog: Cancel (Browser.cancelDownload; its canceled progress closes the dialog)
    if (msg.type === 'download-cancel' && typeof msg.id === 'string') {
        const item = session.downloads && session.downloads.get(msg.id);
        if (item && item.state === 'progress' && browserClient) {
            browserClient.send('Browser.cancelDownload', { guid: msg.id }).catch(() => {});
        }
        return;
    }
    if (msg.type === 'ping') {
        broadcast(session, { type: 'pong', t: msg.t });
        if (msg.rep && ws) noteViewerReport(session, ws, msg.rep);
        return;
    }
    if (msg.type === 'encoder?') {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(encoderInfo(session)));
        return;
    }
    // the tab went behind another, or came to the front (#756): only what shows is captured, and a page in a
    // shared Chrome window comes to the front of it so it paints
    if (msg.type === 'visibility') {
        session.viewHidden = !!msg.hidden;
        if (!session.viewHidden && HEADFUL && session.group && session.page) session.page.bringToFront().catch(() => {});
        syncCapture(session);
        return;
    }
    if (msg.type === 'memory-override') {
        session.memOverride = true;
        await thawSession(session);
        return;
    }
    if (msg.type === 'rtt') {
        noteClientRtt(session, msg.ms);
        return;
    }
    if (msg.type === 'settings') {
        const before = session.settings.jpegQuality;
        const aq = aqState(session);
        // automatic unless the person turned it off (auto: false); its quality, frame rates and compression are
        // then the ones they chose
        if (msg.auto === false || msg.auto === true) aq.auto = msg.auto;
        session.settings = sessionSettings(msg, aq.auto ? session.settings : (session.manualSettings || session.settings));
        if (!aq.auto) session.manualSettings = Object.assign({}, session.settings);
        else applyAutoQuality(session);
        if (session.settings.jpegQuality !== before) await restartScreencast(session);
        broadcast(session, encoderInfo(session));
        return;
    }
    if (msg.type === 'inspect') {
        const x = Number(msg.x);
        const y = Number(msg.y);
        let info = { selection: '', text: '', href: '', src: '', alt: '', editable: false };
        if (Number.isFinite(x) && Number.isFinite(y)) {
            try {
                info = await page.evaluate((px, py) => {
                    let el = document.elementFromPoint(px, py);
                    while (el && el.shadowRoot) {
                        const inner = el.shadowRoot.elementFromPoint(px, py);
                        if (!inner || inner === el) break;
                        el = inner;
                    }
                    const closestAcross = (node, selector) => {
                        let cur = node;
                        const seen = new Set();
                        while (cur && !seen.has(cur)) {
                            seen.add(cur);
                            if (cur.closest) {
                                const hit = cur.closest(selector);
                                if (hit) return hit;
                            }
                            const root = cur.getRootNode && cur.getRootNode();
                            cur = root && root.host ? root.host : null;
                        }
                        return null;
                    };
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
                    const field = closestAcross(el, 'input, textarea, [contenteditable]');
                    const nonText = /^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i;
                    if (field && !field.disabled && !field.readOnly
                        && (field.tagName !== 'INPUT' || !nonText.test(field.type))
                        && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA' || field.isContentEditable)) {
                        out.editable = true;
                        if (document.activeElement !== field) field.focus();
                    }
                    let active = document.activeElement;
                    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
                        active = active.shadowRoot.activeElement;
                    }
                    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                        const start = active.selectionStart;
                        const end = active.selectionEnd;
                        if (typeof start === 'number' && typeof end === 'number' && end > start) {
                            out.selection = String(active.value || '').slice(start, end);
                        }
                    }
                    out.text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
                    const img = closestAcross(el, 'img');
                    const link = closestAcross(el, 'a[href]');
                    if (img) {
                        out.src = img.currentSrc || img.src || '';
                        out.alt = img.alt || '';
                    }
                    if (link && link.href) out.href = link.href;
                    // what Grimoire's IE7 menu needs beyond that (grimoireRemoteBrowser.js grimoireShowRemoteMenu): the
                    // point again (menu-action), the link's words, the picture's size and whether it loaded, the
                    // background picture, the page's Properties, and in a field its state and the word under the pointer
                    const more = {
                        x: px,
                        y: py,
                        linkText: link ? String(link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : '',
                        imgWidth: img ? img.naturalWidth || 0 : 0,
                        imgHeight: img ? img.naturalHeight || 0 : 0,
                        imgBroken: !!(img && img.complete && !img.naturalWidth),
                        bg: '',
                        title: document.title || '',
                        url: location.href,
                        type: document.contentType || '',
                        modified: document.lastModified || '',
                        frame: el.tagName === 'IFRAME' || el.tagName === 'FRAME' ? String(el.src || '') : '',
                        word: '',
                        fieldText: false,
                        fieldSel: false
                    };
                    for (let n = el; n && n.nodeType === 1 && !more.bg; n = n.parentElement) {
                        const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(n).backgroundImage || '');
                        if (m) more.bg = new URL(m[1], document.baseURI).href;
                    }
                    if (out.editable) {
                        const isText = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
                        more.fieldText = isText ? !!active.value : !!String((field && field.textContent) || '').trim();
                        more.fieldSel = !!out.selection;
                        // the word under the pointer (caretPositionFromPoint gives the text control and its offset)
                        const cp = document.caretPositionFromPoint ? document.caretPositionFromPoint(px, py) : null;
                        let text = '';
                        let at = -1;
                        if (cp && isText && cp.offsetNode === active) {
                            text = String(active.value || '');
                            at = cp.offset;
                        } else if (cp && cp.offsetNode && cp.offsetNode.nodeType === 3) {
                            text = cp.offsetNode.data;
                            at = cp.offset;
                        }
                        if (at >= 0 && active && (!isText || active.type !== 'password')) {
                            const letter = /[\p{L}\p{M}'’]/u;
                            let s = at;
                            let e = at;
                            while (s > 0 && letter.test(text[s - 1])) s--;
                            while (e < text.length && letter.test(text[e])) e++;
                            more.word = text.slice(s, e).replace(/^['’]+|['’]+$/g, '').slice(0, 64);
                        }
                    }
                    out.more = more;
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
            editable: !!(info && info.editable),
            more: (info && info.more) || null
        });
        return;
    }
    // Grimoire's context menu (grimoireRemoteBrowser.js grimoireRemoteMenuAction): spelling, edit commands, Show
    // Picture and Inspect at the point the menu was opened for (cx, cy: the page's CSS pixels from the inspect answer)
    if (msg.type === 'menu-action') {
        await menuAction(session, msg);
        return;
    }
    // A real Ctrl+C / Ctrl+X in Chromium, so pages that shape their copy (and cut deleting the selection) behave as at home;
    // then the browser clipboard goes to the viewer. The selection is the fallback when the clipboard cannot be read.
    if (msg.type === 'copy') {
        const cut = !!msg.cut;
        session.copying = true;
        try {
            try { await page.keyboard.press(cut ? 'x' : 'c', { text: '', commands: [cut ? 'cut' : 'copy'] }); } catch (_) {}
            await new Promise((resolve) => setTimeout(resolve, 60));
            if (await syncRemoteClipboard(session, true).catch(() => false)) return;
        } finally {
            setTimeout(() => { session.copying = false; }, 100);
        }
        let text = '';
        try { text = await readSelection(page); } catch (_) {}
        broadcast(session, { type: 'clipboard', text: String(text || '').slice(0, 100000) });
        return;
    }
    // The viewer's clipboard becomes Chromium's, then a real paste: the page sees a paste event (rich editors, uploads).
    if (msg.type === 'paste' && typeof msg.text === 'string') {
        const text = msg.text.slice(0, 100000);
        if (!text) return;
        let pasted = false;
        try {
            if (await writeRemoteClipboard(session, text)) {
                remoteClipboard = text;
                await page.keyboard.press('v', { text: '', commands: ['paste'] });
                pasted = true;
            }
        } catch (_) {}
        if (!pasted) await session.cdp.send('Input.insertText', { text });
        return;
    }
    if (msg.type === 'scroll-to') {
        const y = Number(msg.y);
        if (!Number.isFinite(y) || !session.scrollContextId) return;
        const x = Number(msg.x);
        const args = Math.max(0, Math.round(y)) + (Number.isFinite(x) ? ',' + Math.max(0, Math.round(x)) : '');
        session.scrollBurstUntil = Date.now() + SCROLL_BURST_MS;
        await session.cdp.send('Runtime.evaluate', { expression: '__alchemyScrollTo(' + args + ')', contextId: session.scrollContextId }).catch(() => {});
        wheelDone(session, Number(msg.seq) || 0);
        return;
    }
    // Back / Forward from the viewer (mouse side buttons, Alt+Arrow, BrowserBack) walk Chromium's own history, so
    // in-page history (SPAs) and form state come back. At either end the Grimoire window takes over (history-end).
    if (msg.type === 'history') {
        const dir = msg.dir === 1 ? 1 : -1;
        let nav = null;
        try { nav = await session.cdp.send('Page.getNavigationHistory'); } catch (_) {}
        const entry = nav && nav.entries && nav.entries[nav.currentIndex + dir];
        if (!entry || !/^(https?:|chrome(-extension)?:)/i.test(entry.url || '')) {
            broadcast(session, { type: 'history-end', dir });
            return;
        }
        session.navGen += 1;
        session.pendingNav = null;
        session.dragFrom = null;
        session.navTarget = '';
        beginNavigating(session, true);
        await session.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id }).catch((err) => {
            console.error('[grimoire-browser] history', err && err.message);
        });
        return;
    }
    // A finger on the phone's page (Internet Explorer on the phone, mobile view): real touches, so the page gets
    // its own drags, holds and swipes and Chromium scrolls and flings it as a phone would. Device times from the
    // viewer keep a burst that arrived late from flinging too hard: each event keeps its gap from the touch start.
    if (msg.type === 'touch') {
        const x = Number(msg.x);
        const y = Number(msg.y);
        const kinds = { start: 'touchStart', move: 'touchMove', end: 'touchEnd', cancel: 'touchCancel' };
        const type = kinds[msg.kind];
        if (!type || !Number.isFinite(x) || !Number.isFinite(y)) return;
        if (session.viewKind !== 'mobile') return;
        const t = Number(msg.t) || 0;
        if (msg.kind === 'start') session.touchBase = { at: Date.now() / 1000, t, last: 0 };
        const base = session.touchBase || (session.touchBase = { at: Date.now() / 1000, t, last: 0 });
        const timestamp = Math.max(base.last + 0.001, base.at + Math.max(0, t - base.t) / 1000);
        base.last = timestamp;
        session.wheelAt = null;
        const points = type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 0, radiusX: 4, radiusY: 4, force: 1 }];
        await session.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points, modifiers: 0, timestamp });
        if (type === 'touchEnd' && msg.tap) {
            followChromeLink(session, x, y).catch(() => {});
            checkClipboardSoon(session);
        }
        if (type === 'touchEnd' || type === 'touchCancel') session.touchBase = null;
        return;
    }
    if (msg.type === 'mouse') {
        const x = Number(msg.x);
        const y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const button = msg.button === 'right' || msg.button === 'middle' ? msg.button : 'left';
        session.wheelAt = null;
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
                checkClipboardSoon(session);
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
            checkClipboardSoon(session);
        }
        return;
    }
    if (msg.type === 'wheel') {
        session.scrollBurstUntil = Date.now() + SCROLL_BURST_MS;
        const x = Number(msg.x);
        const y = Number(msg.y);
        // Wheel scrolls what is under the pointer; moves are throttled, so put the pointer there first.
        if (Number.isFinite(x) && Number.isFinite(y) && (!session.wheelAt || session.wheelAt.x !== x || session.wheelAt.y !== y)) {
            session.wheelAt = { x, y };
            await page.mouse.move(x, y);
        }
        let deltaX = Number(msg.deltaX) || 0;
        let deltaY = Number(msg.deltaY) || 0;
        // a desktop page scrolls in steps of 16 frame pixels so its frames go as scroll packs (#990 round 2); what
        // is left over goes once the wheel stops, so the page ends where it was turned to. A wheel distance here is
        // a frame-pixel distance (stock: DIP = frame pixels; the Alchemy build: its emulated pixels = frame pixels).
        if (session.viewKind !== 'mobile' && session.cssPerPx && !msg.ctrl) {
            const carryX = (session.wheelCarryX || 0) + deltaX;
            const carryY = (session.wheelCarryY || 0) + deltaY;
            deltaX = Math.trunc(carryX / SCROLL_ALIGN) * SCROLL_ALIGN;
            deltaY = Math.trunc(carryY / SCROLL_ALIGN) * SCROLL_ALIGN;
            session.wheelCarryX = carryX - deltaX;
            session.wheelCarryY = carryY - deltaY;
            if (session.wheelCarryTimer) clearTimeout(session.wheelCarryTimer);
            session.wheelCarryTimer = setTimeout(() => {
                session.wheelCarryTimer = null;
                const restX = session.wheelCarryX || 0;
                const restY = session.wheelCarryY || 0;
                session.wheelCarryX = 0;
                session.wheelCarryY = 0;
                if (!sessions.get(session.id)) return;
                const seq = session.wheelSeqWaiting;
                session.inputChain = session.inputChain.then(async () => {
                    if (restX || restY) await page.mouse.wheel({ deltaX: restX, deltaY: restY });
                    wheelDone(session, seq);
                }).catch(() => {});
            }, WHEEL_REST_MS);
            // the rest of this turn goes with the carry: its answer comes then
            session.wheelSeqWaiting = Math.max(Number(msg.seq) || 0, session.wheelSeqWaiting || 0);
            if (!deltaX && !deltaY) return;
        }
        const wheelStarted = Date.now();
        await page.mouse.wheel({ deltaX, deltaY });
        if (PACK_DEBUG) console.log('[grimoire-browser] wheel ' + deltaY + ' handled in ' + (Date.now() - wheelStarted) + ' ms');
        if (!session.wheelCarryTimer) wheelDone(session, Number(msg.seq) || 0);
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
        // #990: the viewer's canvas in device pixels (device-pixel-content-box) and its pixel ratio
        // (a phone's page is laid out by its mobile metrics: its pixels are the stills' business, not the viewport's)
        const dpr = session.viewKind === 'mobile' ? 0 : Number(msg.dpr);
        const okDpr = dpr >= 0.5 && dpr <= 8 ? Math.round(dpr * 1000) / 1000 : 0;
        const pxWidth = okDpr ? clampSize(msg.pxWidth, Math.round(width * okDpr), 160, DIP_MAX_WIDTH * 2) : 0;
        const pxHeight = okDpr ? clampSize(msg.pxHeight, Math.round(height * okDpr), 120, DIP_MAX_HEIGHT * 2) : 0;
        if (okDpr && !session.popup) noteDesktopPixelRatio(okDpr);
        if (width === session.width && height === session.height && pxWidth === (session.pxWidth || 0)
            && pxHeight === (session.pxHeight || 0) && (okDpr || session.dpr) === session.dpr) return;
        session.width = width;
        session.height = height;
        if (okDpr) {
            session.dpr = okDpr;
            session.pxWidth = pxWidth;
            session.pxHeight = pxHeight;
        }
        await changeViewport(session);
        return;
    }
    // the viewer's wanted device pixels per CSS pixel (a phone at its pixel ratio); stills only
    if (msg.type === 'still-ack') {
        session.stillUnacked = 0;
        return;
    }
    if (msg.type === 'still-scale') {
        const scale = Math.max(0, Math.min(STILL_MAX_SCALE, Number(msg.value) || 0));
        if (Math.abs(scale - (session.clientScale || 0)) < 0.01) return;
        session.clientScale = scale;
        session.stillGen = (session.stillGen || 0) + 1;
        // a mobile page is laid out for the viewer's pixel ratio (mobileDeviceScale)
        if (session.viewKind === 'mobile') await changeViewport(session);
        armStill(session);
        return;
    }
    // Mobile or desktop version of sites (#748): the identity and the device metrics change and the page loads
    // again, so the site answers the new one (what was typed into the page and its scroll position are lost,
    // as with Refresh; the session, its history and its cookies stay).
    if (msg.type === 'view-kind') {
        const kind = viewKindOf(msg.value);
        if (kind === (session.viewKind || 'desktop')) return;
        session.viewKind = kind;
        // the viewer's size, zoom and pixel ratio for the new view come with it, so the page loads once, as it will be shown
        if (msg.width || msg.height) {
            session.width = clampSize(msg.width, session.width, 320, 1920);
            session.height = clampSize(msg.height, session.height, 240, 1440);
        }
        if (Number(msg.zoom) > 0) session.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(msg.zoom)));
        if (Number(msg.scale) > 0) session.clientScale = Math.min(STILL_MAX_SCALE, Number(msg.scale));
        await applyIdentity(session, !!session.plainUa).catch(() => {});
        await changeViewport(session);
        broadcast(session, { type: 'view-kind', value: kind });
        if (session.navigating && session.navTarget) requestNavigate(session, session.navTarget, false);
        else if (session.url) requestNavigate(session, session.url, true);
        return;
    }
    if (msg.type === 'zoom') {
        const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(msg.value) || 1));
        if (Math.abs(zoom - (session.zoom || 1)) < 0.001) return;
        session.zoom = zoom;
        await changeViewport(session);
        return;
    }
    if (msg.type === 'print') {
        const id = String(msg.id || '').slice(0, 64);
        try {
            const shot = await capturePrintPage(session);
            broadcast(session, Object.assign({ type: 'print', id, title: session.title || '', url: session.url || '' }, shot));
        } catch (err) {
            broadcast(session, { type: 'print', id, error: (err && err.message) || 'print failed' });
        }
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
            chrome: chromeBin,
            performance: perf,
            pendingRelaunch: pendingRelaunch()
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/browser/restart') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        let body = {};
        try { body = (await readBody(req)) || {}; } catch (_) {}
        if (body.performance) takePerf(body.performance);
        try {
            await restartBrowser();
            sendJson(res, 200, { ok: true });
        } catch (err) {
            sendJson(res, 500, { error: err.message || 'restart failed' });
        }
        return;
    }

    // Internet Properties > Delete Browsing History (cplDialogs2.js, Yozora #632): Chromium's cookies and its cache.
    if (req.method === 'POST' && pathname === '/browser/clear-data') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        let body = {};
        try { body = (await readBody(req)) || {}; } catch (_) {}
        try {
            await clearBrowsingData({ cookies: body.cookies === true, cache: body.cache === true });
            sendJson(res, 200, { ok: true });
        } catch (err) {
            sendJson(res, 500, { error: err.message || 'clear failed' });
        }
        return;
    }

    // Performance options without a new session (#756): Internet Properties' Apply
    if (req.method === 'POST' && pathname === '/browser/settings') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        let body = {};
        try { body = (await readBody(req)) || {}; } catch (_) {}
        takePerf(body.performance);
        sendJson(res, 200, { ok: true, performance: perf, pendingRelaunch: pendingRelaunch() });
        return;
    }

    if (req.method === 'GET' && pathname === '/extensions') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        sendJson(res, 200, { extensions: extensions.map(({ id, name, title, popup, icon16, icon32 }) => ({ id, name, title, popup, icon16, icon32 })) });
        return;
    }

    // an extension's toolbar button for this page (Grimoire's command bar): its popup as a child session, if it has one
    const extensionAction = pathname.match(/^\/sessions\/([a-f0-9]{32})\/extension-action$/);
    if (extensionAction && req.method === 'POST') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        let body = {};
        try { body = (await readBody(req)) || {}; } catch (_) {}
        const session = sessions.get(extensionAction[1]);
        if (!session || session.popup || !tokenEquals(String(body.t || ''), session.viewerToken)) {
            sendJson(res, 404, { error: 'not found' });
            return;
        }
        const ext = extensions.find((e) => e.id === String(body.extensionId || ''));
        if (!ext) {
            sendJson(res, 404, { error: 'no such extension' });
            return;
        }
        try {
            sendJson(res, 200, { popup: await openExtensionAction(session, ext) });
        } catch (err) {
            sendJson(res, err.status || 502, { error: (err && err.message) || 'the extension did not open' });
        }
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

    // Every session with its owner (#756: Other Devices, the browsing-session registry).
    if (req.method === 'GET' && pathname === '/sessions') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        sendJson(res, 200, { sessions: [...sessions.values()].map(sessionPublic) });
        return;
    }

    // Leases (#756): Dreamscape renews the sessions whose device is connected or still inside its idle time.
    if (req.method === 'POST' && pathname === '/sessions/lease') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        let body = {};
        try { body = (await readBody(req)) || {}; } catch (_) {}
        const ttl = Math.max(15000, Math.min(LEASE_MAX_MS, Number(body.ttlMs) || LEASE_GRACE_MS));
        const until = Date.now() + ttl;
        const renewed = [];
        for (const id of Array.isArray(body.ids) ? body.ids.slice(0, 500) : []) {
            const session = sessions.get(String(id));
            if (!session) continue;
            if (!session.owner && body.owner !== false) continue;
            session.leaseUntil = until;
            renewed.push(session.id);
            // a popup lives as long as its parent's lease
            for (const child of sessions.values()) {
                if (child.parentId === session.id) child.leaseUntil = until;
            }
        }
        sendJson(res, 200, { ok: true, renewed, missing: (Array.isArray(body.ids) ? body.ids : []).filter((id) => !sessions.has(String(id))) });
        return;
    }

    const transfer = pathname.match(/^\/sessions\/([a-f0-9]{32})\/transfer$/);
    if (transfer && req.method === 'POST') {
        if (!adminOk(req)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        const session = sessions.get(transfer[1]);
        if (!session) {
            sendJson(res, 404, { error: 'not found' });
            return;
        }
        let body = {};
        try { body = (await readBody(req)) || {}; } catch (_) {}
        const owner = normalizeOwner(body.owner);
        if (!owner) {
            sendJson(res, 400, { error: 'owner required' });
            return;
        }
        // the old viewer hears where the page went, then loses its token (#756: "This tab has been transferred")
        broadcast(session, { type: 'transferred', to: owner.deviceName || 'another device', kind: owner.deviceKind, at: Date.now() });
        session.viewerToken = crypto.randomBytes(24).toString('hex');
        for (const ws of session.sockets) {
            try { ws.close(4001, 'transferred'); } catch (_) {}
        }
        session.sockets.clear();
        session.owner = owner;
        session.leaseUntil = Date.now() + LEASE_GRACE_MS;
        for (const child of sessions.values()) {
            if (child.parentId === session.id) {
                child.owner = Object.assign({}, owner);
                child.viewerToken = crypto.randomBytes(24).toString('hex');
                for (const ws of child.sockets) { try { ws.close(4001, 'transferred'); } catch (_) {} }
                child.sockets.clear();
            }
        }
        if (body.width || body.height) {
            session.width = clampSize(body.width, session.width, 320, 1920);
            session.height = clampSize(body.height, session.height, 240, 1440);
            applyViewport(session).then(() => restartScreencast(session)).catch(() => {});
        }
        sendJson(res, 200, Object.assign(sessionPublic(session), { viewerToken: session.viewerToken }));
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
                viewKind: session.viewKind || 'desktop',
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

    const upload = pathname.match(/^\/sessions\/([a-f0-9]{32})\/file-chooser\/([a-f0-9]{16})\/file$/);
    if (upload && req.method === 'POST') {
        const session = sessions.get(upload[1]);
        const token = url.searchParams.get('t') || '';
        if (!session || !tokenEquals(token, session.viewerToken)) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
        }
        touch(session);
        receiveUpload(session, upload[2], url.searchParams.get('name') || 'file', req, res).catch((err) => {
            if (!res.headersSent) sendJson(res, 500, { error: (err && err.message) || 'upload failed' });
        });
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
    // automatic quality starts at its middle step (a new link has said nothing yet); a later viewer joins at the current one
    applyAutoQuality(session);
    session.sockets.add(ws);
    // the front proxy (nginx, 737.jp.net) closes a socket after 60 s with nothing sent to the client: a viewer whose page
    // sends nothing (a tab behind another, capture paused) gets a ping after 25-40 s of silence, so it stays open; a page
    // that streams sends no extra bytes
    ws.sentAt = Date.now();
    ws.keepAlive = setInterval(() => {
        if (ws.readyState !== 1 || Date.now() - ws.sentAt < 25000) return;
        try { ws.ping(); } catch (_) {}
        ws.sentAt = Date.now();
    }, 15000);
    ws.send(JSON.stringify(encoderInfo(session)));
    touch(session);
    session.viewHidden = false;
    syncCapture(session);
    if (session.memFrozen) ws.send(JSON.stringify({ type: 'memory-limit', usedMb: session.memMb, limitMb: perf.tabMemoryMb || 0 }));
    if (session.meta) ws.send(JSON.stringify({ type: 'meta', metadata: session.meta }));
    if (session.url || session.navigating || session.navTarget) {
        ws.send(JSON.stringify({
            type: session.navigating ? 'navigating' : 'location',
            url: (session.navigating && session.navTarget) || session.url || '',
            title: session.title || '',
            navigating: !!session.navigating
        }));
    }
    if (session.health && session.health !== 'ok') {
        ws.send(JSON.stringify({ type: 'status', state: session.health, url: session.url || '' }));
    }
    if (session.feeds && session.feeds.length) ws.send(JSON.stringify({ type: 'feeds', feeds: session.feeds }));
    if (session.dialog) ws.send(JSON.stringify(session.dialog.ask));
    if (session.scroll) ws.send(JSON.stringify(session.scroll));
    if (session.layers) ws.send(JSON.stringify(Object.assign({}, session.layers, { reset: 1, v: session.layersVis || undefined })));
    if (!session.popup) flushOrphans(session);
    if (session.painted) {
        try { ws.send(session.painted); } catch (_) {}
        if (session.still && session.still.gen === session.stillGen) {
            try { ws.send(JSON.stringify(session.still)); } catch (_) {}
        } else {
            armStill(session);
        }
    } else {
        restartScreencast(session).catch(() => {});
    }
    ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const raw = data.toString();
        let preview = null;
        try { preview = JSON.parse(raw); } catch (_) {}
        // what the viewer can show (#990 round 2): image/jxl
        if (preview && preview.type === 'caps') {
            session.jxl = preview.jxl === true;
            return;
        }
        // the window in front wants this host's audio on its socket (#990)
        if (preview && preview.type === 'audio') {
            setAudioListener(ws, preview.on === true);
            return;
        }
        const gesture = preview && (
            (preview.type === 'mouse' && (preview.kind === 'down' || preview.kind === 'up' || preview.kind === 'click'))
            || (preview.type === 'key' && preview.kind === 'down')
            || preview.type === 'wheel'
            || (preview.type === 'touch' && preview.kind !== 'move')
        );
        if (gesture) releaseFramePace(session);
        // the person did something: the next still comes soon again, however busy the page was
        if (gesture || (preview && /^(scroll-to|resize|zoom|still-scale)$/.test(preview.type))) {
            session.stillGap = STILL_MIN_GAP_MS;
            session.stillInputAt = Date.now();
        }
        if (preview && (preview.type === 'dialog-reply' || preview.type === 'file-chooser-reply' || preview.type === 'navigate' || preview.type === 'reload' || preview.type === 'key' || preview.type === 'paste' || preview.type === 'ping' || preview.type === 'rtt' || preview.type === 'still-ack' || preview.type === 'inspect' || preview.type === 'copy' || preview.type === 'encoder?')) {
            onViewerMessage(session, raw, ws).catch((err) => {
                console.error('[grimoire-browser] input', err && err.message);
            });
            return;
        }
        if (preview && preview.type === 'touch' && preview.kind === 'move') {
            // a finger's moves: only the newest waits its turn (each carries its own device time)
            session.pendingTouch = raw;
            if (session.touchQueued) return;
            session.touchQueued = true;
            session.inputChain = session.inputChain.then(() => {
                session.touchQueued = false;
                const pending = session.pendingTouch;
                session.pendingTouch = null;
                if (pending) return onViewerMessage(session, pending);
            }).catch((err) => {
                session.touchQueued = false;
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
        // Trackpads send ~60 wheel events a second; while one is waiting its turn, later ones add to it instead of queueing.
        if (preview && (preview.type === 'wheel' || preview.type === 'scroll-to')) {
            session.scrollBurstUntil = Date.now() + SCROLL_BURST_MS;
            const queued = session.pendingScroll;
            if (queued && queued.type === preview.type && (preview.type === 'scroll-to'
                || (!!queued.ctrl === !!preview.ctrl && !!queued.shift === !!preview.shift))) {
                if (preview.type === 'wheel') {
                    queued.deltaX += Number(preview.deltaX) || 0;
                    queued.deltaY += Number(preview.deltaY) || 0;
                }
                queued.x = preview.x;
                queued.y = preview.y;
                if (preview.type === 'scroll-to') queued.y = preview.y;
                // the merged step answers for the newest turn in it
                if (Number(preview.seq) > (Number(queued.seq) || 0)) queued.seq = preview.seq;
                return;
            }
            const next = Object.assign({}, preview, { deltaX: Number(preview.deltaX) || 0, deltaY: Number(preview.deltaY) || 0 });
            session.pendingScroll = next;
            session.inputChain = session.inputChain.then(() => {
                if (session.pendingScroll === next) session.pendingScroll = null;
                return onViewerMessage(session, JSON.stringify(next));
            }).catch((err) => {
                console.error('[grimoire-browser] input', err && err.message);
            });
            return;
        }
        session.inputChain = session.inputChain.then(() => onViewerMessage(session, raw, ws)).catch((err) => {
            console.error('[grimoire-browser] input', err && err.message);
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'error', message: err.message || 'input failed' }));
            }
        });
    });
    ws.on('close', () => {
        clearInterval(ws.keepAlive);
        session.sockets.delete(ws);
        setAudioListener(ws, false);
        // a moment's grace: a viewer reconnecting (a reload, a transfer) finds the capture still on
        setTimeout(() => syncCapture(session), 2000);
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
        console.warn('[grimoire-browser] the Alchemy Chromium is older than the system one: rebuild it at the new tag (DreamScape/Alchemy-Chromium build-alchemy.sh), or brand the stock one (node scripts/alchemy-brand-chromium.js)');
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
            if (sessionExpired(session, now)) closeSession(id);
        }
    }, 15000).unref();

    setInterval(() => {
        for (const session of sessions.values()) {
            if (session.sockets.size && !session.popup) checkMemory(session).catch(() => {});
        }
    }, MEMORY_CHECK_MS).unref();

    setInterval(() => { keepSessionCookies().catch(() => {}); }, KEEP_COOKIES_EVERY_MS).unref();

    server.listen(PORT, HOST, () => {
        const bound = server.address();
        console.log('[grimoire-browser] listening on http://' + bound.address + ':' + bound.port);
    });

    // Close Chromium first so it flushes the profile (logins in localStorage) before pm2's
    // kill_timeout; sessions die with the browser, so their page closes are not awaited.
    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        // viewers wait for this service to come back and open their pages again (viewer.html recoverSession)
        for (const session of sessions.values()) broadcast(session, { type: 'restarting' });
        if (browser) {
            const t0 = Date.now();
            const kept = await Promise.race([keepSessionCookies(), new Promise((resolve) => setTimeout(() => resolve(-1), 1500).unref())]).catch(() => -1);
            const closed = await closeBrowserGently(browser, 6000);
            // a sync write: process.exit follows at once and would drop a piped console.log
            try { fs.writeSync(1, '[grimoire-browser] shutdown: ' + (kept >= 0 ? kept + ' session cookies kept, ' : 'cookie keep timed out, ') + 'Chromium ' + (closed ? 'closed' : 'did not close') + ' in ' + (Date.now() - t0) + ' ms\n'); } catch (_) {}
        }
        for (const id of [...sessions.keys()]) closeSession(id).catch(() => {});
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
