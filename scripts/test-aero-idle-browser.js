#!/usr/bin/env node
'use strict';
/**
 * #406 acceptance in a real CSS engine: headless Chromium loads a harness page that links every
 * stylesheet public/app.html links (same order), with the real tray / star-field markup and a set of
 * transient blur surfaces, and asserts per aeroGlass mode:
 *   frosted + basic: no backdrop-filter on any element or ::before/::after;
 *   basic + reduced motion: the star fields and tray icons run no animation;
 *   control (live): animations exist and at least one surface blurs (the harness is real).
 * A test script, not shipped code (no perf impact on the client).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const CHROMIUM = process.env.CHROMIUM || '/usr/bin/chromium';

function hrefs() {
    const out = [];
    const re = /<link\b[^>]*rel="stylesheet"[^>]*href="(\/[^"]+\.css)"/g;
    let m;
    while ((m = re.exec(APP))) out.push(m[1]);
    // multi-line <link rel="stylesheet"\n href=...> are covered: [^>]* spans newlines
    return out;
}

function divBlock(startMarker) {
    const i = APP.indexOf(startMarker);
    if (i < 0) throw new Error('marker not found: ' + startMarker);
    const re = /<div\b|<\/div>/g;
    re.lastIndex = i;
    let depth = 0, m;
    while ((m = re.exec(APP))) {
        depth += m[0] === '<div' ? 1 : -1;
        if (depth === 0) return APP.slice(i, m.index + 6);
    }
    throw new Error('unbalanced: ' + startMarker);
}

const sheets = hrefs();
const tray = divBlock('<div class="taskbar-tray">');
const previewStars = divBlock('<div id="previewStars"').replace('preview-stars hidden', 'preview-stars');

const SURFACES = [
    ['context menu', '.context-menu', 'context-menu.css:170'],
    ['custom dropdown menu (open)', '.custom-dropdown-menu', 'custom-dropdown.css:214'],
    ['toast', '.glass-toast', 'toasts.css:61'],
    ['Director session overlay', '.director-session-overlay', 'director.css:62'],
    ['modal toolbar overlay', '.modal-content-toolbar-overlay', 'app.css:3413'],
    ['lightbox close button', '.lightbox-close-btn', 'lightbox.css:29'],
    ['Director thought bubble (::before/::after)', '.dm-vn-layer .dm-think', 'director.css:4710 (::before/::after)'],
    ['taskbar (::after layer)', '.desktop-taskbar', 'desktop-shell.css:265 (::after)'],
];

const harness = `<!doctype html><html data-glass="live"><head><meta charset="utf-8"><title>aero idle harness</title>
${sheets.map((h) => `<link rel="stylesheet" href="file://${path.join(ROOT, 'public', h)}">`).join('\n')}
</head><body class="desktop-mode theme-vista">
<div id="focus-overlay"><div class="focus-star-field" id="focus-star-field">
 <div class="focus-star small"></div><div class="focus-star small"></div><div class="focus-star small"></div></div></div>
<div id="title-bar" class="floating-bar-top-left"><div class="star-field" id="star-field">
 <div class="star small"></div><div class="star small"></div><div class="star small"></div></div></div>
<div class="modal"><div class="modal-content"><div class="modal-content-toolbar-overlay">toolbar</div>
 ${previewStars}</div></div>
<div id="desktopTaskbar" class="desktop-taskbar"><div class="taskbar-start"></div>
${tray}
<div class="dev-warnings-tray-icon taskbar-tray-icon has-warnings" id="devWarningsTrayIcon"><i class="fas fa-bug"></i></div>
</div>
<div class="context-menu" style="left:20px;top:80px">menu</div>
<div style="position:relative"><button class="custom-dropdown-btn">pick</button><div class="custom-dropdown-menu">x</div></div>
<div class="glass-toast glass-toast-info" style="transform:none">toast</div>
<div class="director-session-overlay">director</div>
<button class="lightbox-close-btn">x</button>
<div class="dm-vn-layer" style="position:relative;height:60px"><div class="dm-think" style="position:relative">think</div></div>
<script>
 for (const id of ['imageGenerationIndicator','serviceWorkerTrayIcon']) {
   const el = document.getElementById(id); el.classList.remove('hidden');
   if (id === 'imageGenerationIndicator') el.classList.add('active'); else el.classList.add('sw-update-downloading');
 }
 document.querySelectorAll('.taskbar-tray-icon').forEach((e) => e.classList.remove('hidden'));
 document.getElementById('previewStars').classList.remove('hidden');
</script></body></html>`;

const MODES = {
    frosted: { glass: 'frosted', cls: '' },
    basic: { glass: 'basic', cls: 'disable-blur' },
    live: { glass: 'live', cls: '' },
};

const PAGE_JS = `(${function (surfaces) {
    const none = (v) => !v || v === 'none';
    const sel = (el, ps) => {
        let s = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
            (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
        return s + (ps || '');
    };
    const offenders = [];
    for (const el of document.body.querySelectorAll('*')) {
        for (const ps of [null, '::before', '::after']) {
            const cs = getComputedStyle(el, ps);
            const a = cs.backdropFilter, b = cs.webkitBackdropFilter;
            if (!none(a) || !none(b)) offenders.push(sel(el, ps) + ' = ' + (none(a) ? b : a));
        }
    }
    for (const ps of ['::before', '::after']) {
        const cs = getComputedStyle(document.body, ps);
        if (!none(cs.backdropFilter)) offenders.push('body' + ps + ' = ' + cs.backdropFilter);
    }
    const surfaceBlur = {};
    for (const [name, s] of surfaces) {
        const el = document.querySelector(s);
        let v = el ? getComputedStyle(el).backdropFilter : 'MISSING';
        if (el && none(v) && /taskbar/.test(name)) v = getComputedStyle(el, '::after').backdropFilter;
        surfaceBlur[name] = v;
    }
    const scope = '.taskbar-tray-icons, #star-field, #focus-star-field, #previewStars';
    const running = [];
    for (const an of document.getAnimations()) {
        if (!an.animationName) continue; // transitions are not idle motion
        const t = an.effect && an.effect.target;
        if (!t || !t.closest || !t.closest(scope)) continue;
        if (an.playState === 'paused') continue;
        running.push(sel(t, an.effect.pseudoElement) + ' ' + an.animationName + ' (' + an.playState + ')');
    }
    return { offenders, surfaceBlur, running };
}})`;

function cdpConnect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0;
        const pending = new Map();
        ws.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.id && pending.has(m.id)) {
                const { res, rej } = pending.get(m.id);
                pending.delete(m.id);
                m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
            }
        };
        ws.onerror = reject;
        ws.onopen = () => resolve({
            send: (method, params = {}) => new Promise((res, rej) => {
                const i = ++id; pending.set(i, { res, rej });
                ws.send(JSON.stringify({ id: i, method, params }));
            }),
            close: () => ws.close(),
        });
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-idle-'));
    const page = path.join(tmp, 'harness.html');
    fs.writeFileSync(page, harness);
    const profile = path.join(tmp, 'profile');
    const child = spawn(CHROMIUM, [
        '--headless=new', '--no-sandbox', '--allow-file-access-from-files', '--disable-gpu',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
        '--window-size=1280,800', 'file://' + page,
    ], { stdio: 'ignore' });
    let cdp;
    const rows = [];
    const check = (name, ok, detail) => rows.push({ name, ok, detail: detail || '' });
    try {
        let port;
        for (let i = 0; i < 100 && !port; i++) {
            await sleep(100);
            try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ }
        }
        if (!port) throw new Error('Chromium did not open a debugging port');
        let target;
        for (let i = 0; i < 50 && !target; i++) {
            try {
                const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
                target = list.find((t) => t.type === 'page' && t.url.includes('harness.html'));
            } catch { /* retry */ }
            if (!target) await sleep(100);
        }
        if (!target) throw new Error('harness page target not found');
        cdp = await cdpConnect(target.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await sleep(800); // stylesheets + animations start

        const evalIn = async (expr) => {
            const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
            return r.result.value;
        };
        const setMode = (m) => evalIn(`(() => { const h = document.documentElement; h.setAttribute('data-glass', ${JSON.stringify(m.glass)});
            h.classList.toggle('disable-blur', ${JSON.stringify(m.cls === 'disable-blur')}); return true; })()`);
        const measure = async (m) => {
            await setMode(m);
            await sleep(500);
            return evalIn(`(${PAGE_JS})(${JSON.stringify(SURFACES.map((s) => [s[0], s[1]]))})`);
        };
        const sample = (r) => r.offenders.slice(0, 8).join('; ') + (r.offenders.length > 8 ? ` (+${r.offenders.length - 8})` : '');

        const live = await measure(MODES.live);
        const blurring = Object.entries(live.surfaceBlur).filter(([, v]) => !/^none$/.test(v) && v !== 'MISSING');
        const missing = Object.entries(live.surfaceBlur).filter(([, v]) => v === 'MISSING').map(([k]) => k);
        check('live control: harness animations run', live.running.length > 0, `${live.running.length} running: ${live.running.slice(0, 4).join(', ')}`);
        check('live control: transient surfaces blur', blurring.length > 0 && !missing.length,
            blurring.map(([k, v]) => `${k}=${v}`).join(' | ') + (missing.length ? ` MISSING: ${missing}` : ''));
        const liveNone = Object.entries(live.surfaceBlur).filter(([, v]) => v === 'none').map(([k]) => k);
        if (liveNone.length) check('live control: every listed surface blurs (info)', true, 'none in live: ' + liveNone.join(', '));

        const livePseudo = live.offenders.filter((o) => /::(before|after) =/.test(o));
        check('live control: a ::before/::after backdrop-filter exists (pseudo coverage is real)', livePseudo.length > 0, livePseudo.slice(0, 3).join('; ') + ` (${live.offenders.length} blurring boxes in live)`);

        const frosted = await measure(MODES.frosted);
        check('frosted: no backdrop-filter (elements + pseudos)', frosted.offenders.length === 0, sample(frosted));
        const basic = await measure(MODES.basic);
        check('basic: no backdrop-filter (elements + pseudos)', basic.offenders.length === 0, sample(basic));
        check('basic: star fields + tray icons not animating', basic.running.length === 0, basic.running.join('; '));

        await setMode(MODES.live);
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await sleep(500);
        const rm = await evalIn(`(${PAGE_JS})([])`);
        check('reduced motion (live): star fields + tray icons not animating', rm.running.length === 0, rm.running.join('; '));
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await sleep(500);
        const back = await evalIn(`(${PAGE_JS})([])`);
        check('live again: animations restart', back.running.length > 0, `${back.running.length} running`);
    } catch (e) {
        check('harness run', false, String(e && e.message || e));
    } finally {
        try { cdp && cdp.close(); } catch { /* ignore */ }
        child.kill('SIGKILL');
        await sleep(200);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log(`Surfaces: ${SURFACES.map((s) => `${s[0]} [${s[1]}; ${s[2]}]`).join(' | ')}`);
    console.log(`Stylesheets linked: ${sheets.length}`);
    console.log('');
    let fail = 0;
    for (const r of rows) {
        if (!r.ok) fail++;
        console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '\n        ' + r.detail : ''}`);
    }
    console.log(`\n${fail ? 'FAIL' : 'PASS'}: ${rows.length - fail}/${rows.length} checks`);
    process.exit(fail ? 1 : 0);
}

main();
