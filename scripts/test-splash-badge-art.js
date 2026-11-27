#!/usr/bin/env node
// Melaton Mobile's page splash (#1408): the "Powered by CaféReady" badge shows only when it is complete
// (the Miniport link up AND its picture in), every splash picture's box is reserved, and app.html asks for
// the splash's pictures early under exactly the addresses the splash's <img> use (one request each, only
// what this boot draws, never a data: URL). Runs the real buildBootLayers() and the real app.html block
// against a fake DOM. Run: node scripts/test-splash-badge-art.js [repo root]
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BADGE = '/static_images/melaton/cafe-ready-dark.png';

let failed = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`ok    ${name}`);
    } catch (err) {
        failed += 1;
        console.log(`FAIL  ${name}\n      ${String(err.message).split('\n').join('\n      ')}`);
    }
}

// ---------------------------------------------------------------- a fake DOM, as much as the two pieces use

class El {
    constructor(tag) {
        this.tag = tag;
        this.attrs = {};
        this.children = [];
        this.listeners = {};
        this.className = '';
        this.hidden = false;
        this.hiddenWrites = 0;
        // an <img> before its picture is in
        this.complete = false;
        this.naturalWidth = 0;
        this.html = '';
        const self = this;
        this.classList = { add: (c) => { self.className = `${self.className} ${c}`.trim(); } };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    set innerHTML(v) {
        this.html = String(v);
        this.children = [...this.html.matchAll(/<img\b([^>]*)>/g)].map((m) => {
            const img = new El('img');
            for (const a of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) img.attrs[a[1]] = a[2];
            return img;
        });
    }
    get innerHTML() { return this.html; }
    appendChild(c) { this.children.push(c); return c; }
    querySelector(sel) {
        if (sel === 'img') return this.imgs()[0] || null;
        if (sel === '.wm-content') return this.content || (this.content = new El('div'));
        throw new Error(`fake DOM: no selector ${sel}`);
    }
    imgs() { return this.children.flatMap((c) => (c.tag === 'img' ? [c] : c.imgs())); }
    addEventListener(type, fn, opts) { (this.listeners[type] = this.listeners[type] || []).push({ fn, once: !!(opts && opts.once) }); }
    fire(type) {
        const list = this.listeners[type] || [];
        this.listeners[type] = list.filter((l) => !l.once);
        list.forEach((l) => l.fn({ type, target: this }));
    }
}

// ---------------------------------------------------------------- the splash, from wmShell.js

const shellSrc = read('public/scripts/comp/wmShell.js');
const from = shellSrc.indexOf('    function buildBootLayers() {');
const to = shellSrc.indexOf('\n    }\n', from);
assert.ok(from > 0 && to > from, 'buildBootLayers found in wmShell.js');
const buildSrc = shellSrc.slice(from, to + 7);

/** Builds the boot layers; link is what melatonContinuity.miniport() says, changed through setLink(). */
function boot({ wm65 = false, link = { present: true, enabled: true, up: true } } = {}) {
    const shell = new El('div');
    let state = link;
    const handlers = [];
    const timers = [];
    const timer = (...a) => { timers.push(a); return 1; };
    const ctx = vm.createContext({
        shell,
        WM65: wm65,
        document: { createElement: (t) => new El(t) },
        window: { melatonContinuity: { miniport: () => state, on: (type, fn) => { if (type === 'miniport') handlers.push(fn); } } },
        setTimeout: timer, setInterval: timer, requestAnimationFrame: timer, Date
    });
    vm.runInContext(`${buildSrc}\nbuildBootLayers();`, ctx);
    const splash = shell.children.find((c) => String(c.className).split(' ')[0] === 'wm-splash');
    const badge = splash.children.find((c) => String(c.className).includes('wm-splash-cafe'));
    const art = badge.querySelector('img');
    // the browser's own order: the element's state first, then its event
    const load = () => { art.complete = true; art.naturalWidth = 704; art.fire('load'); };
    const fail = () => { art.complete = true; art.naturalWidth = 0; art.fire('error'); };
    const setLink = (next) => { state = next; handlers.forEach((fn) => fn()); };
    return { splash, badge, art, load, fail, setLink, timers };
}

const UP = { present: true, enabled: true, up: true };
const DOWN = { present: true, enabled: true, up: false };

for (const wm65 of [false, true]) {
    const v = wm65 ? '6.5' : '6.1';
    check(`${v}: link up, picture not in yet: the badge stays hidden`, () => {
        const b = boot({ wm65 });
        assert.strictEqual(b.badge.hidden, true, 'badge shown with a blank where its picture goes');
        b.setLink(UP);
        assert.strictEqual(b.badge.hidden, true, 'a link event showed the badge before its picture');
    });
    check(`${v}: the picture's load shows the badge when the link is already up`, () => {
        const b = boot({ wm65 });
        assert.strictEqual(b.badge.hidden, true);
        b.load();
        assert.strictEqual(b.badge.hidden, false);
    });
    check(`${v}: picture first, then the link: the link's event shows the badge; link down hides it`, () => {
        const b = boot({ wm65, link: DOWN });
        b.load();
        assert.strictEqual(b.badge.hidden, true, 'shown with the link down');
        b.setLink(UP);
        assert.strictEqual(b.badge.hidden, false);
        b.setLink(DOWN);
        assert.strictEqual(b.badge.hidden, true);
    });
    check(`${v}: a picture that fails to load: the badge stays hidden`, () => {
        const b = boot({ wm65 });
        b.fail();
        b.setLink(UP);
        assert.strictEqual(b.badge.hidden, true);
    });
    check(`${v}: no Miniport, or turned off: hidden with the picture in`, () => {
        for (const link of [null, { present: false, enabled: true, up: false }, { present: true, enabled: false, up: true }]) {
            const b = boot({ wm65, link });
            b.load();
            assert.strictEqual(b.badge.hidden, true, JSON.stringify(link));
        }
    });
    check(`${v}: the gate needs no timer, interval or animation frame`, () => {
        const b = boot({ wm65 });
        b.load();
        assert.strictEqual(b.timers.length, 0);
    });
}

// ---------------------------------------------------------------- the pictures and their boxes

const splashUrls = (wm65) => boot({ wm65 }).splash.imgs().map((i) => i.attrs.src);

/** A PNG's pixel size from its IHDR. */
function pngSize(url) {
    const buf = fs.readFileSync(path.join(ROOT, 'public', url));
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

for (const wm65 of [false, true]) {
    const v = wm65 ? '6.5' : '6.1';
    check(`${v}: two splash pictures, each with width and height matching its file`, () => {
        const imgs = boot({ wm65 }).splash.imgs();
        assert.deepStrictEqual(imgs.map((i) => i.attrs.src), [wm65 ? '/static_images/melaton/melaton-white-256.png' : '/static_images/wm61/boot-melaton.png', BADGE]);
        for (const img of imgs) {
            assert.deepStrictEqual([Number(img.attrs.width), Number(img.attrs.height)], pngSize(img.attrs.src), `${img.attrs.src}: width="${img.attrs.width}" height="${img.attrs.height}"`);
        }
    });
}

/** The declarations of the rule whose selector is exactly this. */
function rule(css, selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
    assert.ok(m, `rule ${selector}`);
    return m[1].replace(/\/\*[\s\S]*?\*\//g, '');
}

check('CSS: the badge picture\'s box is held in its own proportions (also About and Network Cards)', () => {
    const body = rule(read('public/css/wm-programs.css'), '.wm-cafe-badge img');
    assert.match(body, /(^|[;\s])height:\s*auto\s*;/);
    const m = body.match(/aspect-ratio:\s*(\d+)\s*\/\s*(\d+)\s*;/);
    assert.ok(m, 'no aspect-ratio on .wm-cafe-badge img');
    assert.deepStrictEqual([Number(m[1]), Number(m[2])], pngSize(BADGE));
});

check('CSS: the 6.1 emblem keeps its square box with the height attribute there', () => {
    const body = rule(read('public/css/wm-shell.css'), '.wm-splash-logo img');
    assert.match(body, /(^|[;\s])height:\s*auto\s*;/, 'height="256" would stretch the emblem to 256px tall');
    assert.match(body, /aspect-ratio:\s*1\s*;/);
});

check('CSS: the 6.5 emblem is sized on both sides, over its attributes', () => {
    const body = rule(read('public/css/wm65.css'), 'html.ui-mobile[data-wm-version="6.5"] .wm-splash65-mark');
    assert.match(body, /(^|[;\s])width:\s*29cqw\s*;/);
    assert.match(body, /(^|[;\s])height:\s*29cqw\s*;/);
});

// ---------------------------------------------------------------- the early fetch, from app.html

const appHtml = read('public/app.html');
const aFrom = appHtml.indexOf("        if (globalThis.uiShell === 'mobile') {\n            // 6.5.1 (#850)");
const aTo = appHtml.indexOf('        // html.wm-touch drives', aFrom);
assert.ok(aFrom > 0 && aTo > aFrom, "app.html's Melaton Mobile version block found");
const versionSrc = appHtml.slice(aFrom, aTo);

/** Runs app.html's block as this boot would; returns the <link>s it added to the head. */
function preloads({ uiShell = 'mobile', stored = null, miniport = false } = {}) {
    const links = [];
    const window = miniport ? { AndroidMiniport: { postMessage() {} } } : {};
    const ctx = vm.createContext({
        uiShell,
        window,
        localStorage: { getItem: (k) => (k === 'wmVersion' ? stored : null) },
        document: {
            documentElement: { dataset: {} },
            head: { appendChild: (el) => links.push(el) },
            createElement: (t) => new El(t)
        }
    });
    vm.runInContext(versionSrc, ctx);
    return links;
}

for (const stored of [null, '6.1', '6.5', '6.5.1']) {
    for (const miniport of [true, false]) {
        const name = `preload, wmVersion ${stored || '(unset)'}, ${miniport ? 'app with Miniport' : 'no Miniport'}`;
        check(`${name}: exactly the splash's own addresses that this boot draws`, () => {
            const wm65 = stored === '6.5' || stored === '6.5.1';
            const links = preloads({ stored, miniport });
            const want = splashUrls(wm65).filter((u) => miniport || u !== BADGE);
            assert.deepStrictEqual(links.map((l) => l.href), want);
            for (const l of links) {
                assert.strictEqual(l.tag, 'link');
                assert.strictEqual(l.rel, 'preload');
                assert.strictEqual(l.as, 'image');
                // a CORS mode the <img> does not have would make it a second request
                assert.ok(!l.crossOrigin && !('crossorigin' in l.attrs), 'no crossorigin');
            }
        });
    }
}

check('preload: none in the desktop shell', () => {
    assert.strictEqual(preloads({ uiShell: 'desktop', miniport: true }).length, 0);
});

check('preload: runs after the shell is chosen, ahead of every stylesheet and script file after it', () => {
    const at = appHtml.indexOf("link.rel = 'preload';");
    assert.ok(at > 0, 'no preload in app.html');
    assert.ok(at > appHtml.indexOf('globalThis.uiShell = ('), 'after uiShell');
    assert.ok(at < appHtml.indexOf('<link rel="stylesheet"'), 'before the first stylesheet');
});

check('the addresses are plain files every install keeps: no data:, no query, core package', () => {
    const packages = require(path.join(ROOT, 'public/scripts/launch/assetPackages.js'));
    const urls = [...new Set([...splashUrls(false), ...splashUrls(true), ...preloads({ stored: '6.5', miniport: true }).map((l) => l.href), ...preloads({ miniport: true }).map((l) => l.href)])];
    for (const u of urls) {
        assert.ok(u.startsWith('/static_images/') && !u.includes('?') && !/data:/i.test(u), u);
        assert.ok(fs.existsSync(path.join(ROOT, 'public', u)), `${u} missing`);
        assert.strictEqual(packages.packageOf(u), null, `${u} is not core`);
    }
    assert.ok(!/data:image/i.test(buildSrc + versionSrc), 'data: picture in the boot code');
});

if (failed) {
    console.error(`test-splash-badge-art: ${failed} check(s) failed (${ROOT})`);
    process.exit(1);
}
console.log('test-splash-badge-art: ok');
