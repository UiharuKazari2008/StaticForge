#!/usr/bin/env node
// UI standard check (Yozora #851 / #863). The standard is docs/design/ui-standard.md.
//
// It counts, per file, the things the standard bans in app code, and compares them with
// scripts/ui-standard-baseline.json. The baseline holds the tree as it was when the standard
// was written. A count may only go DOWN: a new file must be clean, and a file you touch may
// not get worse. When your change lowers a count, record it with --update.
//
//   node scripts/check-ui-standard.js            check the whole tree (exit 1 on a rise)
//   node scripts/check-ui-standard.js <file...>  check only these files
//   node scripts/check-ui-standard.js --update   lower the baseline to today's counts
//   node scripts/check-ui-standard.js --report   totals per rule, worst files
//   node scripts/check-ui-standard.js --list <rule> [file]   show the matching lines
//
// --update never raises a count. A rise needs Yukimi's decision and --accept-rise <rule>:<file>.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const BASELINE = 'scripts/ui-standard-baseline.json';

// Where UI code lives.
const SCAN_DIRS = ['public/css', 'public/scripts/comp', 'public/templates', 'apps'];
const SCAN_FILES = ['public/app.html'];
const SKIP = /(^|\/)(node_modules|vendor|graphify-out|server|\.cache)\//;

// Theme and kit files: the only places that may hold colour, font and art literals, because
// they ARE the theme. Everything else is app code. (Generated files are theme files too.)
const THEME_FILES = new Set([
    // desktop: Vista
    'public/css/7.scoped.css',
    'public/css/vista-glass-controls.css',
    'public/css/vista-scrollbars.css',
    'public/css/vista-scrollbars-frame.css',
    'public/css/vista-menus.css',
    'public/css/vista-dialogs.css',
    'public/css/vista-dialog-template.css',
    'public/css/vista-fa-icons.css',
    'public/css/vista-fonts.css',
    'public/css/vista-taskbar.css',
    'public/css/aero-glass.css',
    'public/css/modal-window-title-toolbar.css',
    'public/css/desktop-shell.css',
    'public/css/context-menu.css',
    'public/css/custom-dropdown.css',
    'public/css/confirmation-dialogs.css',
    // desktop: boot themes
    'public/css/windows-classic-theme.css',
    // phone: WM 6.1 base, 6.5, shared kit
    'public/css/wm-shell.css',
    'public/css/wm65.css',
    'public/css/wm65-start.css',
    'public/css/wm-lock65.css',
    'public/css/wm-titanium.css',
    'public/css/wm-programs.css',
    'public/css/wm-dialogs.css',
    'public/css/wm-host.css',
    // legacy web palette (frozen)
    'public/css/app.css',
    'public/css/fonts.css',
]);
// Every file under public/css/themes/ is a theme file (where new themes go).
const isThemeFile = (f) => THEME_FILES.has(f) || f.startsWith('public/css/themes/');

// Shared code that is allowed to be the one implementation of a thing.
const FACTORY_FILES = new Set([
    'public/scripts/comp/modalUtils.js',
    'public/scripts/comp/melatonApps.js',
    'public/scripts/comp/vistaDialogTemplate.js',
    'public/scripts/comp/confirmationDialog.js',
    'public/scripts/comp/desktop-apps/desktopAppWindow.js',
]);
const THEME_HELPER_FILES = new Set([
    'public/scripts/comp/uiTheme.js',
    'public/scripts/comp/desktopBoot.js',
    'public/scripts/comp/workspaceUtils.js',
]);
const WM_ART_FILES = new Set([
    'public/scripts/comp/wmShell.js',
    'public/scripts/comp/wmStart65.js',
    'public/scripts/comp/wmTitanium.js',
]);

const isCss = (f) => f.endsWith('.css');
const isJs = (f) => f.endsWith('.js');
const isHtml = (f) => f.endsWith('.html');
const isPhone = (f) => /(^|\/)wm[A-Z0-9-][^/]*\.(js|css)$/.test(f);

// Each rule: which files it reads, and a regex counted over the comment-stripped text.
const RULES = [
    // ---- no native browser UI (no-native-browser-ui.mdc) ----
    { id: 'native-range', why: 'browser range slider outside the Vista-skinned scope (phone code, or any accent-color)',
      on: (f) => isPhone(f) || isCss(f),
      re: (f) => isCss(f) ? /accent-color\s*:/g : /type\s*=\s*\\?["']?range\b/g },
    { id: 'native-picker', why: 'browser date / time / colour picker',
      on: (f) => isJs(f) || isHtml(f),
      re: () => /type\s*=\s*\\?["']?(date|time|datetime-local|month|week|color)\b|\.showPicker\s*\(/g },
    { id: 'native-select', why: 'browser <select> (its list is drawn by the browser); use the platform combo',
      on: (f) => isPhone(f) && isJs(f),
      re: () => /<select\b|createElement\(\s*["']select["']\s*\)/g },
    { id: 'native-dialog', why: 'window.alert / confirm / prompt',
      on: (f) => isJs(f),
      re: () => /(^|[^.\w$])(window\.)?(alert|confirm|prompt)\s*\(\s*["'`]/gm },
    { id: 'native-widget', why: 'browser-drawn <progress>, <meter>, <details>, <dialog>, or media controls',
      on: (f) => isJs(f) || isHtml(f),
      re: () => /<(progress|meter|details|dialog)\b|<(video|audio)\b[^>]*\scontrols\b/g },
    { id: 'native-scrollbar', why: 'own ::-webkit-scrollbar skin (scroll bars come from the theme)',
      on: (f) => isCss(f) && !isThemeFile(f),
      re: () => /::-webkit-scrollbar\b(?!-)/g },

    // ---- literals belong to the theme ----
    { id: 'colour-literal', why: 'hex / rgb() / hsl() colour in app CSS (use a theme token)',
      on: (f) => isCss(f) && !isThemeFile(f),
      re: () => /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(\s*\d/g },
    { id: 'colour-in-script', why: 'hex colour in a script (use a class or a theme token)',
      on: (f) => isJs(f),
      re: () => /["'`:\s]#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?=[;"'`\s,)])/g },
    { id: 'font-literal', why: 'font family named in app CSS (inherit, or use the theme font token)',
      on: (f) => isCss(f) && !isThemeFile(f),
      re: () => /font(-family)?\s*:[^;{}]*(["'][A-Za-z][^"']*["']|\b(Tahoma|Arial|Verdana|Helvetica|sans-serif|serif)\b)[^;{}]*/g,
      keep: (m) => !/^font(-family)?\s*:\s*var\(/.test(m) },
    { id: 'inline-style', why: 'style="..." written in a script template (use a class)',
      on: (f) => isJs(f),
      re: () => /style=\\?["'](?!\s*(display\s*:\s*none|--[\w-]+\s*:)[^"']*["'])/g },

    // ---- themes are named, never "not the other one" ----
    { id: 'theme-negative', why: ':not(.windows-classic-theme) used to mean Vista (scope by the theme id)',
      on: (f) => isCss(f),
      re: () => /:not\(\s*\.windows-classic-theme\s*\)/g },
    { id: 'theme-test-copy', why: 'own Vista / Classic / WM version test in a script (use the shared theme helper)',
      on: (f) => isJs(f) && !THEME_HELPER_FILES.has(f),
      re: () => /windows-classic-theme|vista-basic-theme|dataset\.wmVersion|data-wm-version|getItem\(\s*["']wmVersion["']/g },
    { id: 'theme-art-path', why: 'art path naming a theme folder (wm61 / wm65) outside the shell (use the art helper)',
      on: (f) => (isJs(f) && !WM_ART_FILES.has(f)) || (isCss(f) && !isThemeFile(f)),
      re: () => /\/static_images\/wm6[15]\//g },

    // ---- one factory, one kit ----
    { id: 'hand-built-window', why: 'window skeleton written by hand (use the window factory)',
      on: (f) => isJs(f) && !FACTORY_FILES.has(f),
      re: () => /modal-window-title-main/g },
    { id: 'own-menubar', why: 'app-private menu bar class (use the shared menu bar)',
      on: (f) => isCss(f) && !isThemeFile(f),
      re: () => /\.(?!naxt-)[a-z0-9]+-menubar\b(?=[^{}]*\{)/g },
    { id: 'own-control', why: 'app-private button / tab / spin / check / combo class (use the kit control)',
      on: (f) => isCss(f) && !isThemeFile(f),
      re: () => /\.[a-z0-9]+-(btn|button|tabs|spin|check|combo)\b(?=[^{}]*\{)/g },
    { id: 'toast', why: 'showGlassToast in new code (balloon / message box on desktop; notification / message box on phone)',
      on: (f) => isJs(f) && f !== 'public/scripts/comp/toastManager.js',
      re: () => /\bshowGlassToast\s*\(/g },
];
const RULE_IDS = RULES.map((r) => r.id);

function walk(dir, out) {
    let list;
    try { list = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch (e) { return out; }
    list.forEach((d) => {
        const p = dir + '/' + d.name;
        if (SKIP.test(p + (d.isDirectory() ? '/' : ''))) return;
        if (d.isDirectory()) walk(p, out);
        else if (/\.(css|js|html)$/.test(d.name) && !/\.min\.(js|css)$/.test(d.name)) out.push(p);
    });
    return out;
}

// Comments are not code: strip them, keeping line numbers.
function strip(text, file) {
    const blank = (m) => m.replace(/[^\n]/g, ' ');
    let t = text.replace(/\/\*[\s\S]*?\*\//g, blank);
    if (isJs(file)) t = t.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, a) => a + blank(m.slice(a.length)));
    if (isHtml(file)) t = t.replace(/<!--[\s\S]*?-->/g, blank);
    return t;
}

function matches(file, rule, text) {
    const re = rule.re(file);
    const out = [];
    let m;
    while ((m = re.exec(text))) {
        if (m[0] === '') { re.lastIndex++; continue; }
        if (rule.keep && !rule.keep(m[0])) continue;
        out.push(m);
    }
    return out;
}

function countFile(file) {
    let raw;
    try { raw = fs.readFileSync(path.join(root, file), 'utf8'); } catch (e) { return null; }
    const text = strip(raw, file);
    const counts = {};
    RULES.forEach((rule) => {
        if (!rule.on(file)) return;
        const n = matches(file, rule, text).length;
        if (n) counts[rule.id] = n;
    });
    return counts;
}

function loadBaseline() {
    try { return JSON.parse(fs.readFileSync(path.join(root, BASELINE), 'utf8')); } catch (e) { return { files: {} }; }
}

function saveBaseline(files) {
    const sorted = {};
    Object.keys(files).sort().forEach((f) => { if (Object.keys(files[f]).length) sorted[f] = files[f]; });
    const totals = {};
    Object.values(sorted).forEach((c) => Object.keys(c).forEach((r) => { totals[r] = (totals[r] || 0) + c[r]; }));
    const body = { note: 'Counts may only go down. See docs/design/ui-standard.md and scripts/check-ui-standard.js.', totals, files: sorted };
    fs.writeFileSync(path.join(root, BASELINE), JSON.stringify(body, null, 1) + '\n');
    return totals;
}

function main() {
    const args = process.argv.slice(2);
    const flag = (n) => args.includes(n);
    const accept = new Set();
    for (let i = 0; i < args.length; i++) if (args[i] === '--accept-rise' && args[i + 1]) accept.add(args[++i]);
    const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--accept-rise' && args[i - 1] !== '--list');

    if (flag('--list')) {
        const i = args.indexOf('--list');
        const rule = RULES.find((r) => r.id === args[i + 1]);
        if (!rule) { console.error('rules: ' + RULE_IDS.join(', ')); process.exit(2); }
        const only = args[i + 2] && !args[i + 2].startsWith('--') ? path.relative(root, path.resolve(args[i + 2])) : null;
        const files = only ? [only] : SCAN_DIRS.reduce((o, d) => walk(d, o), SCAN_FILES.slice());
        files.forEach((f) => {
            if (!rule.on(f)) return;
            let raw; try { raw = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { return; }
            const text = strip(raw, f);
            matches(f, rule, text).forEach((m) => {
                const line = text.slice(0, m.index).split('\n').length;
                console.log(f + ':' + line + ': ' + m[0].trim().slice(0, 100));
            });
        });
        return;
    }

    const all = SCAN_DIRS.reduce((o, d) => walk(d, o), SCAN_FILES.slice());
    const files = named.length ? named.map((a) => path.relative(root, path.resolve(a))) : all;
    const base = loadBaseline();
    const now = {};
    files.forEach((f) => { const c = countFile(f); if (c) now[f] = c; });

    if (flag('--report')) {
        const totals = {};
        const worst = {};
        Object.keys(now).forEach((f) => Object.keys(now[f]).forEach((r) => {
            totals[r] = (totals[r] || 0) + now[f][r];
            (worst[r] = worst[r] || []).push([now[f][r], f]);
        }));
        RULES.forEach((r) => {
            console.log(String(totals[r.id] || 0).padStart(6) + '  ' + r.id + '  - ' + r.why);
            (worst[r.id] || []).sort((a, b) => b[0] - a[0]).slice(0, 5).forEach((w) => console.log('          ' + String(w[0]).padStart(5) + '  ' + w[1]));
        });
        return;
    }

    const rises = [];
    const drops = [];
    files.forEach((f) => {
        const b = base.files[f] || {};
        const n = now[f] || {};
        RULE_IDS.forEach((r) => {
            const was = b[r] || 0;
            const is = n[r] || 0;
            if (is > was) rises.push({ f, r, was, is });
            else if (is < was) drops.push({ f, r, was, is });
        });
    });

    if (flag('--update') || flag('--init')) {
        const next = named.length ? Object.assign({}, base.files) : {};
        files.forEach((f) => {
            const b = base.files[f] || {};
            const n = now[f] || {};
            const out = {};
            RULE_IDS.forEach((r) => {
                const is = n[r] || 0;
                const was = b[r] || 0;
                // --init takes today's counts; --update only ever lowers (or an accepted rise).
                const v = flag('--init') || is <= was || accept.has(r + ':' + f) ? is : was;
                if (v) out[r] = v;
            });
            next[f] = out;
        });
        const totals = saveBaseline(next);
        console.log('baseline written: ' + Object.keys(next).length + ' files');
        RULE_IDS.forEach((r) => console.log(String(totals[r] || 0).padStart(6) + '  ' + r));
        const left = rises.filter((x) => !flag('--init') && !accept.has(x.r + ':' + x.f));
        if (left.length) {
            console.error('\nNOT recorded (counts rose):');
            left.forEach((x) => console.error('  ' + x.f + '  ' + x.r + '  ' + x.was + ' -> ' + x.is));
            process.exit(1);
        }
        return;
    }

    if (rises.length) {
        console.error('UI standard: ' + rises.length + ' count(s) rose. docs/design/ui-standard.md\n');
        rises.forEach((x) => {
            const rule = RULES.find((q) => q.id === x.r);
            console.error('  ' + x.f + '\n    ' + x.r + ': ' + x.was + ' -> ' + x.is + '  (' + rule.why + ')');
        });
        console.error('\nShow the lines:  node scripts/check-ui-standard.js --list <rule> <file>');
        process.exit(1);
    }
    console.log('UI standard: ok (' + files.length + ' files' + (drops.length ? ', ' + drops.length + ' count(s) fell: run --update to record them' : '') + ')');
}

main();
