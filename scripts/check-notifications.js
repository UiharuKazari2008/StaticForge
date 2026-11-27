#!/usr/bin/env node
// Notification discipline check (Yozora #1299). The rules are .cursor/rules/notification-discipline.mdc (N1-N11);
// the verdicts and the audit are docs/design/notification-discipline.md.
//
// Every place the product can reach the user unasked is an EMIT SITE: a toast, a tray balloon, a message box / WM
// notification, a sound, and (in the app) an Android notification or channel. N5: every emit site carries a
// REGISTERED SOURCE ID, and the registry says where the user turns that source off. The id is written as a comment
// on the emit line or the line right above it:
//
//     // notice: queue-blocked           (JS)         /* notice: wm-battery-low */
//     // notice: text-message-channel    (Kotlin)
//
// The id must exist in scripts/notice-sources.json (area, trigger, action, sound, switch). An id the registry does
// not know is always an error. Emit sites WITHOUT an id are counted per file and per class and compared with
// scripts/notification-baseline.json (the check-ui-standard.js / check-perf-rules.js pattern): a count may only
// go DOWN, a new file must be clean, a rise needs Yukimi's decision (--accept-rise). Marking a site means it was
// audited and kept on purpose; the Supervisor reviews every new marker against N1-N11.
//
//   node scripts/check-notifications.js                  check the tree (exit 1 on a rise or an unknown id)
//   node scripts/check-notifications.js <file...>        only these files
//   node scripts/check-notifications.js --staged         the files staged for commit
//   node scripts/check-notifications.js --dsapp <root>   the DSApp-Kotlin tree (baseline in <root>/tools/notification-baseline.json)
//   node scripts/check-notifications.js --list [class] [file]   every emit site, marked or not
//   node scripts/check-notifications.js --report         totals per class, worst files, sources with no switch
//   node scripts/check-notifications.js --update         lower the baseline to today's counts (never raises)
//   node scripts/check-notifications.js --update --accept-rise <class>:<file>   a rise Yukimi accepted
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const SF_ROOT = process.env.NOTIFICATIONS_ROOT ? path.resolve(process.env.NOTIFICATIONS_ROOT) : path.join(__dirname, '..');
const dsappRoot = valueOf('--dsapp');
const root = dsappRoot ? path.resolve(dsappRoot) : SF_ROOT;
const BASELINE = dsappRoot ? path.join(root, 'tools', 'notification-baseline.json') : path.join(SF_ROOT, 'scripts', 'notification-baseline.json');
const REGISTRY = path.join(SF_ROOT, 'scripts', 'notice-sources.json');

const CLASSES = {
    toast: 'showGlassToast: a toast (a desktop balloon / WM notification by the toast policy)',
    balloon: 'a tray balloon or popover raised on its own (PopoverManager.show*, trayNotePopup, showBalloon)',
    message: 'a WM notification, message box or note (wmShell.notify / messageBox / appNote / confirmationNotice)',
    sound: 'a sound (desktopSounds.play, playSystemSound, sndPlayFile, new Audio)',
    native: 'an Android notification or channel (NotificationCompat.Builder, NotificationChannel, notify)'
};
const CLASS_IDS = Object.keys(CLASSES);

// A method / function DEFINITION is not an emit site.
const isDefinition = (text, index) => {
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const lineEnd = text.indexOf('\n', index);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    if (/^\s*(async\s+)?function\b/.test(line)) return true;
    if (/^\s*(static\s+)?(async\s+)?[\w$]+\s*\([^)]*\)\s*\{\s*$/.test(line)) return true; // method shorthand
    if (/^\s*(const|let|var)\s+[\w$]+\s*=\s*(async\s*)?\(?[\w$,\s]*\)?\s*=>/.test(line) && false) return true;
    if (/^\s*(fun|private fun|internal fun|override fun)\b/.test(line)) return true;
    return false;
};

const JS_RULES = [
    { cls: 'toast', re: /(?<![.\w$])showGlassToast\s*\(|\bwindow\.showGlassToast\s*\(/g },
    { cls: 'balloon', re: /\b(?:PopoverManager\.(?:show|showPopover)|trayNotePopup|showBalloon|_showPolicyBalloon)\s*\(/g },
    { cls: 'message', re: /\b(?:[A-Za-z_$][\w$]*\.)?(?:messageBox|appNote|confirmationNotice)\s*\(|\b(?:wmShell|shell|WmShell)\.notify\s*\(/g },
    { cls: 'sound', re: /\bdesktopSounds\.play\s*\(|\bplaySystemSound\s*\(|\bsndPlayFile\s*\(|\bnew\s+Audio\s*\(/g }
];
const KT_RULES = [
    { cls: 'native', re: /\bNotificationCompat\.Builder\s*\(|\bNotificationChannel\s*\(|\bnotificationManager\??\.notify\s*\(|\bNotificationManagerCompat[\w.()?]*\.notify\s*\(/gi }
];

const SKIP = /(^|\/)(node_modules|vendor|graphify-out|\.cache|dist|build|\.gradle|third_party|workers?)\//;

function listFiles() {
    const out = [];
    const visit = (dir, re) => {
        let list;
        try { list = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch (e) { return; }
        list.forEach((d) => {
            const p = dir + '/' + d.name;
            if (SKIP.test(p + (d.isDirectory() ? '/' : ''))) return;
            if (d.isDirectory()) visit(p, re);
            else if (re.test(d.name) && !/\.min\.js$/.test(d.name)) out.push(p);
        });
    };
    if (dsappRoot) visit('app/src/main/java', /\.kt$/);
    else { visit('public/scripts', /\.js$/); visit('apps', /\.js$/); }
    return out;
}

function stripComments(text, file) {
    const blank = (m) => m.replace(/[^\n]/g, ' ');
    let t = text.replace(/\/\*[\s\S]*?\*\//g, blank);
    t = t.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, a) => a + blank(m.slice(a.length)));
    return t;
}

const MARK_RE = /notice:\s*([a-z0-9][\w.-]*)/i;

function loadRegistry() {
    try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).sources || {}; } catch (e) { return {}; }
}

// All emit sites of a file: [{cls, line, id|null, text}]
function sitesOf(file) {
    let raw;
    try { raw = fs.readFileSync(path.join(root, file), 'utf8'); } catch (e) { return null; }
    const rules = file.endsWith('.kt') ? KT_RULES : JS_RULES;
    const text = stripComments(raw, file);
    const rawLines = raw.split('\n');
    const out = [];
    rules.forEach((rule) => {
        const re = new RegExp(rule.re.source, rule.re.flags);
        let m;
        while ((m = re.exec(text))) {
            if (m[0] === '') { re.lastIndex++; continue; }
            if (isDefinition(text, m.index)) continue;
            const line = text.slice(0, m.index).split('\n').length;
            let id = null;
            for (const ln of [line, line - 1]) {
                const s = rawLines[ln - 1];
                const mm = s && MARK_RE.exec(s);
                if (mm) { id = mm[1]; break; }
            }
            out.push({ cls: rule.cls, line, id, text: (rawLines[line - 1] || '').trim().slice(0, 110) });
        }
    });
    return out.sort((a, b) => a.line - b.line);
}

function loadBaseline() {
    try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (e) { return { files: {} }; }
}
function saveBaseline(files) {
    const sorted = {};
    Object.keys(files).sort().forEach((f) => { if (Object.keys(files[f]).length) sorted[f] = files[f]; });
    const totals = {};
    Object.values(sorted).forEach((c) => Object.keys(c).forEach((r) => { totals[r] = (totals[r] || 0) + c[r]; }));
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify({ note: 'Emit sites with no registered source id. Counts may only go down. See docs/design/notification-discipline.md and scripts/check-notifications.js.', totals, files: sorted }, null, 1) + '\n');
    return totals;
}

function stagedFiles() {
    try {
        return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root, encoding: 'utf8' })
            .split('\n').filter((f) => (dsappRoot ? /\.kt$/ : /^(public\/scripts|apps)\/.*\.js$/).test(f));
    } catch (e) { return []; }
}

function main() {
    const registry = loadRegistry();
    const explicit = argv.filter((a, i) => !a.startsWith('--') && a !== dsappRoot && argv[i - 1] !== '--accept-rise' && argv[i - 1] !== '--list' && !CLASS_IDS.includes(a));
    const accept = new Set();
    for (let i = 0; i < argv.length; i++) if (argv[i] === '--accept-rise' && argv[i + 1]) accept.add(argv[++i]);

    let files;
    if (explicit.length) files = explicit.map((a) => path.relative(root, path.resolve(a)));
    else if (flag('--staged')) files = stagedFiles();
    else files = listFiles();

    if (flag('--list')) {
        const i = argv.indexOf('--list');
        const cls = CLASS_IDS.includes(argv[i + 1]) ? argv[i + 1] : null;
        files.forEach((f) => (sitesOf(f) || []).forEach((s) => {
            if (cls && s.cls !== cls) return;
            console.log(f + ':' + s.line + ': [' + s.cls + '] ' + (s.id ? 'id=' + s.id + (registry[s.id] ? '' : ' (UNKNOWN)') : 'NO ID') + '  ' + s.text);
        }));
        return;
    }

    const base = loadBaseline();
    const now = {};
    const unknown = [];
    const allSites = {};
    files.forEach((f) => {
        const sites = sitesOf(f);
        if (!sites) return;
        allSites[f] = sites;
        const counts = {};
        sites.forEach((s) => {
            if (s.id && !registry[s.id]) unknown.push({ f, line: s.line, id: s.id });
            if (!s.id) counts[s.cls] = (counts[s.cls] || 0) + 1;
        });
        if (Object.keys(counts).length) now[f] = counts;
    });

    if (flag('--report')) {
        const totals = {}, marked = {}, worst = {};
        Object.keys(allSites).forEach((f) => allSites[f].forEach((s) => {
            if (s.id) marked[s.cls] = (marked[s.cls] || 0) + 1;
            else { totals[s.cls] = (totals[s.cls] || 0) + 1; (worst[s.cls] = worst[s.cls] || {})[f] = ((worst[s.cls] || {})[f] || 0) + 1; }
        }));
        CLASS_IDS.forEach((c) => {
            console.log(String(totals[c] || 0).padStart(6) + ' unregistered  ' + String(marked[c] || 0).padStart(4) + ' registered  ' + c + '  - ' + CLASSES[c]);
            Object.entries(worst[c] || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([f, n]) => console.log('          ' + String(n).padStart(5) + '  ' + f));
        });
        const ids = Object.keys(registry);
        console.log('\n' + ids.length + ' registered source(s).');
        const noSwitch = ids.filter((id) => !registry[id].switch || registry[id].switch === 'none');
        if (noSwitch.length) console.log('Registered with NO switch (N5; the Supervisor calls these out): ' + noSwitch.join(', '));
        return;
    }

    const rises = [], drops = [];
    files.forEach((f) => {
        const b = (base.files || {})[f] || {};
        const n = now[f] || {};
        CLASS_IDS.forEach((c) => {
            const was = b[c] || 0, is = n[c] || 0;
            if (is > was) rises.push({ f, c, was, is });
            else if (is < was) drops.push({ f, c, was, is });
        });
    });

    if (flag('--update') || flag('--init')) {
        const next = explicit.length || flag('--staged') ? Object.assign({}, base.files) : {};
        files.forEach((f) => {
            const b = (base.files || {})[f] || {};
            const n = now[f] || {};
            const out = {};
            CLASS_IDS.forEach((c) => {
                const is = n[c] || 0, was = b[c] || 0;
                const v = flag('--init') || is <= was || accept.has(c + ':' + f) ? is : was;
                if (v) out[c] = v;
            });
            next[f] = out;
        });
        const totals = saveBaseline(next);
        console.log('baseline written: ' + Object.keys(next).length + ' files');
        CLASS_IDS.forEach((c) => console.log(String(totals[c] || 0).padStart(6) + '  ' + c));
        const left = rises.filter((x) => !flag('--init') && !accept.has(x.c + ':' + x.f));
        if (left.length) {
            console.error('\nNOT recorded (counts rose):');
            left.forEach((x) => console.error('  ' + x.f + '  ' + x.c + '  ' + x.was + ' -> ' + x.is));
            process.exit(1);
        }
        return;
    }

    let bad = false;
    if (unknown.length) {
        bad = true;
        console.error('Notifications: ' + unknown.length + ' emit site(s) name a source id that is not in scripts/notice-sources.json\n');
        unknown.forEach((x) => console.error('  ' + x.f + ':' + x.line + '  notice: ' + x.id));
        console.error('');
    }
    if (rises.length) {
        bad = true;
        console.error('Notifications: ' + rises.length + ' count(s) of emit sites with no registered source id rose. .cursor/rules/notification-discipline.mdc\n');
        rises.forEach((x) => console.error('  ' + x.f + '\n    ' + x.c + ': ' + x.was + ' -> ' + x.is + '  (' + CLASSES[x.c] + ')'));
        console.error('\nA notice is a call to action or data the user asked for (N1-N4), registered (N5), silent unless asked for (N7).');
        console.error('Add the source to scripts/notice-sources.json and write  // notice: <id>  on the emit line (or the line above);');
        console.error('the Supervisor reviews it against N1-N11. Show the sites:  node scripts/check-notifications.js --list <class> <file>');
        console.error('A rise that stays needs Yukimi\'s decision (--update --accept-rise <class>:<file>).');
    }
    if (bad) process.exit(1);
    console.log('Notifications: ok (' + files.length + ' files' + (drops.length ? ', ' + drops.length + ' count(s) fell: run --update to record them' : '') + ')');
}

main();
