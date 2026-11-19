#!/usr/bin/env node
// Performance and power check (StaticForge #890). Rules: .cursor/rules/phone-power-client.mdc,
// phone-power-server.mdc, phone-power-native.mdc.
//
// Every pattern below was a real cost found on the phones (A53 / Fold7) and fixed in #890: timers that
// ran with the screen off, polls, synchronous Android bridge calls in loops, whole-list innerHTML on a
// timer, infinite CSS animations (120 fps idle), permanent will-change layers, paint-property
// keyframes, sync disk IO in request handlers, broadcasts with no audience, vsync redraws, allocations
// in onDraw, main-thread commits, unsampled bitmap decodes, fixed-rate wakeups, short socket pings,
// wakelocks with no early release, heavy work inside @JavascriptInterface methods.
//
// Counts per file are compared with a baseline. A count may only go DOWN: a new file must be clean, a
// file you touch may not get worse. A line marked `perf: allow <reason>` (on the line or the one
// before) is exempt - for code that really must (an animation that is the design, a clock while it
// shows), with the reason in the code, never to quiet a finding.
//
//   node scripts/check-perf-rules.js                 check StaticForge (exit 1 on a rise)
//   node scripts/check-perf-rules.js <file...>       check only these files
//   node scripts/check-perf-rules.js --staged        check the files staged for commit
//   node scripts/check-perf-rules.js --dsapp <root>  check the DSApp-Kotlin tree (baseline in <root>/tools/power-baseline.json)
//   node scripts/check-perf-rules.js --list <rule> [file]   the matching lines
//   node scripts/check-perf-rules.js --report        totals per rule, worst files
//   node scripts/check-perf-rules.js --update        lower the baseline to today's counts (never raises)
//   node scripts/check-perf-rules.js --update --accept-rise <rule>:<file>   record a rise Yukimi accepted
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const acorn = require('acorn');
const walk = require('acorn-walk');

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const SF_ROOT = process.env.PERF_RULES_ROOT ? path.resolve(process.env.PERF_RULES_ROOT) : path.join(__dirname, '..');
const dsappRoot = valueOf('--dsapp');
const root = dsappRoot ? path.resolve(dsappRoot) : SF_ROOT;
const BASELINE = dsappRoot ? path.join(root, 'tools', 'power-baseline.json') : path.join(SF_ROOT, 'scripts', 'perf-rules-baseline.json');

const RULES = {
    // client JS (public/scripts, apps)
    'ungated-timer': 'setInterval whose callback never checks that its view is seen (document.hidden / visibilityState / html[data-screen-off] / onScreen / awake): screen off does not make a page hidden, so it runs all night',
    'polling-timer': 'a timer that asks the server (send / sendMessage / request / fetch): status is pushed by the server (server-push-not-polling.mdc)',
    'bridge-in-loop': 'a synchronous Android bridge call (Android*.x()) inside a timer or animation-frame callback: each blocks the page until the app answers; cache it behind its change event',
    'timer-html-rebuild': 'innerHTML rebuilt inside a timer callback: write only what changed, only while it shows',
    // CSS
    'infinite-animation': 'an infinite animation (CSS, or made in script: iterations: Infinity, style.animation = "... infinite"): it keeps the compositor at full refresh rate (120 fps idle on the A53, 60 Hz ticks on the DreamOS Mac) while it is in the page, whatever it shows; run it only while its work runs and it is seen, or tick from a timer. The page\'s animation watchdog (public/scripts/utils/offscreenAnimationPause.js) reports the ones that slip through',
    'will-change': 'will-change in a stylesheet rule: a permanent compositor layer for every match; promote only while it moves (a class added for the transition)',
    'paint-keyframes': 'keyframes that animate a paint / layout property (box-shadow, filter, width, height, top, left, margin, background-position...): every frame restyles on the main thread; animate transform / opacity of a pre-drawn layer',
    // server JS (modules, web_server.js)
    'sync-io-in-handler': 'fs.*Sync inside an HTTP route or socket handler: it blocks every phone packet and reply while it runs',
    'unclassified-broadcast': 'a broadcast type not listed in modules/websocket.js DESKTOP_ONLY_TYPES / PHONE_ONLY_TYPES / DORMANT_HOLD / BROADCAST_ALL: decide who gets it and whether a sleeping phone holds it',
    // Kotlin (DSApp)
    'vsync-invalidate': 'postInvalidateOnAnimation: a redraw every vsync (up to 120 a second) for something that changes a few times a second; pace with postInvalidateDelayed(frame time)',
    'ondraw-alloc': 'an object (Paint, Path, Rect, RectF, gradient, Matrix) created inside onDraw: garbage every frame; build once and reuse',
    'prefs-commit': 'SharedPreferences commit(): a synchronous disk write (fsync) on the calling thread; apply(), or a background thread when it must be durable',
    'unsampled-decode': 'BitmapFactory.decode* without options: a full-size decode (a 3000 px picture is 36 MB) for a small view; decode bounds first and set inSampleSize',
    'fixed-rate-wakeup': 'a fixed-rate schedule (scheduleAtFixedRate / WithFixedDelay / setRepeating / PeriodicWorkRequest): a wakeup forever; react to events, or schedule only while it is needed',
    'time-tick': 'an ACTION_TIME_TICK receiver: a wakeup every minute; only while a view that shows the time is visible (or the page sleep tick)',
    'short-ping': 'an OkHttp pingInterval under 60 s: each ping wakes the radio; the server keeps the link (35 s keep-alive)',
    'wakelock-no-release': 'a wake lock that is never released in its file: it holds for its whole timeout; release when the work is done, keep the timeout as a backstop',
    'heavy-js-bridge': 'an @JavascriptInterface method that decodes, compresses, queries a content provider, resolves intents or does IO inline: the page waits for it; answer from a cache or reply asynchronously'
};
const RULE_IDS = Object.keys(RULES);

const SKIP = /(^|\/)(node_modules|vendor|graphify-out|\.cache|dist|workers?|build|\.gradle|third_party)\//;
const allowRe = /perf:\s*allow/;
const GATE_RE = /document\.hidden|visibilityState|screenOff|data-screen-off|onScreen\s*\(|\.awake\s*\(|wmawake|offsetParent|checkVisibility|isShown\s*\(|\bisVisible\b|\.hidden\b|isOnScreen|viewShown|shownNow/;
const ASK_RE = /\b(wsClient|ws|client|socket)\s*\.\s*(send|sendMessage|request)\s*\(|\bsendMessage\s*\(|\bfetch\s*\(/;
const INFINITE_CSS_RE = /animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/;
const BRIDGE_RE = /\b(?:window\.|root\.|globalThis\.)?Android[A-Z]\w*\s*\.\s*[a-zA-Z_]\w*\s*\(/;

function rel(p) { return path.relative(root, p).split(path.sep).join('/'); }

function listFiles() {
    const out = [];
    const visit = (dir) => {
        const abs = path.join(root, dir);
        if (!fs.existsSync(abs)) return;
        for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
            const r = dir ? `${dir}/${ent.name}` : ent.name;
            if (SKIP.test(`${r}/`) || ent.name.startsWith('.')) continue;
            if (ent.isDirectory()) visit(r);
            else if (ent.isFile() && kindOf(r)) out.push(r);
        }
    };
    if (dsappRoot) visit('app/src/main/java');
    else { ['public', 'apps', 'modules'].forEach(visit); if (fs.existsSync(path.join(root, 'web_server.js'))) out.push('web_server.js'); }
    return out.sort();
}

/** 'client' | 'server' | 'css' | 'kotlin' | null */
function kindOf(r) {
    if (/\.min\.(js|css)$/.test(r)) return null;
    if (dsappRoot) return /\.kt$/.test(r) ? 'kotlin' : null;
    if (/\.css$/.test(r) && (r.startsWith('public/') || r.startsWith('apps/'))) return 'css';
    if (!/\.js$/.test(r)) return null;
    if (r === 'web_server.js' || r.startsWith('modules/')) return 'server';
    if (/^apps\/[^/]+\/server\//.test(r) || /(^|\/)server\//.test(r)) return 'server';
    if (r.startsWith('public/scripts/') || (r.startsWith('apps/') && !/\/server\//.test(r))) return 'client';
    if (r === 'public/sw.js') return null; // the worker has no screen; its rules are in phone-power-client.mdc
    return null;
}

function parseJs(src) {
    const opts = { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, locations: true };
    try { return acorn.parse(src, Object.assign({ sourceType: 'script' }, opts)); } catch (_) { /* module? */ }
    try { return acorn.parse(src, Object.assign({ sourceType: 'module' }, opts)); } catch (_) { return null; }
}

function dotted(node) {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'ThisExpression') return 'this';
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
        const head = dotted(node.object);
        return head ? `${head}.${node.property.name}` : null;
    }
    return null;
}

function hasKey(obj, key) {
    return obj && obj.type === 'ObjectExpression' && obj.properties.some((p) => p.type === 'Property' && !p.computed
        && ((p.key.type === 'Identifier' && p.key.name === key) || (p.key.type === 'Literal' && p.key.value === key)));
}

let audience = null;
function broadcastAudience() {
    if (audience) return audience;
    audience = new Set();
    const ws = path.join(SF_ROOT, 'modules', 'websocket.js');
    if (!fs.existsSync(ws)) return audience;
    const src = fs.readFileSync(ws, 'utf8');
    for (const name of ['DESKTOP_ONLY_TYPES', 'PHONE_ONLY_TYPES', 'BROADCAST_ALL', 'DORMANT_HOLD']) {
        const m = src.match(new RegExp(`const ${name} = new (?:Set|Map)\\(\\[([\\s\\S]*?)\\]\\);`));
        if (!m) continue;
        const body = name === 'DORMANT_HOLD' ? m[1].replace(/\[\s*'([^']+)'\s*,[^\]]*\]/g, "'$1'") : m[1];
        for (const t of body.matchAll(/'([^']+)'/g)) audience.add(t[1]);
    }
    return audience;
}

/** violations in one file: [{ rule, line, text }] */
function scanFile(r) {
    const kind = kindOf(r);
    const abs = path.join(root, r);
    if (!kind || !fs.existsSync(abs)) return [];
    const src = fs.readFileSync(abs, 'utf8');
    const lines = src.split('\n');
    const allowed = (line) => allowRe.test(lines[line - 1] || '') || allowRe.test(lines[line - 2] || '');
    const hits = [];
    const add = (rule, line) => { if (!allowed(line)) hits.push({ rule, line, text: (lines[line - 1] || '').trim().slice(0, 140) }); };
    if (kind === 'css') { scanCss(src, add); return hits; }
    if (kind === 'kotlin') { scanKotlin(src, lines, add); return hits; }
    const ast = parseJs(src);
    if (!ast) return hits;
    const fnByName = new Map();
    walk.simple(ast, {
        FunctionDeclaration(n) { if (n.id) fnByName.set(n.id.name, n); },
        VariableDeclarator(n) { if (n.id && n.id.type === 'Identifier' && n.init && /Function/.test(n.init.type)) fnByName.set(n.id.name, n.init); }
    });
    const bodyOf = (arg) => {
        if (!arg) return null;
        if (/Function/.test(arg.type)) return arg;
        if (arg.type === 'Identifier') return fnByName.get(arg.name) || null;
        return null;
    };
    const textOf = (n) => src.slice(n.start, n.end);
    if (kind === 'client') {
        walk.simple(ast, {
            CallExpression(n) {
                const callee = dotted(n.callee) || '';
                const name = callee.split('.').pop();
                if (name === 'setInterval') {
                    const fn = bodyOf(n.arguments[0]);
                    const body = fn ? textOf(fn) : textOf(n);
                    if (!GATE_RE.test(body)) add('ungated-timer', n.loc.start.line);
                    if (ASK_RE.test(body)) add('polling-timer', n.loc.start.line);
                    if (BRIDGE_RE.test(body)) add('bridge-in-loop', n.loc.start.line);
                    if (/\.innerHTML\s*=/.test(body)) add('timer-html-rebuild', n.loc.start.line);
                } else if (name === 'requestAnimationFrame') {
                    const fn = bodyOf(n.arguments[0]);
                    if (fn && BRIDGE_RE.test(textOf(fn))) add('bridge-in-loop', n.loc.start.line);
                }
            },
            // an endless animation made in script (#930): el.animate(..., { iterations: Infinity }),
            // el.style.animation = '... infinite', or CSS text with one in a string / template
            Property(n) {
                if (n.computed || !n.value) return;
                const key = n.key.type === 'Identifier' ? n.key.name : n.key.type === 'Literal' ? n.key.value : null;
                if (key === 'iterations' && n.value.type === 'Identifier' && n.value.name === 'Infinity') add('infinite-animation', n.loc.start.line);
            },
            AssignmentExpression(n) {
                const left = dotted(n.left) || '';
                if (/\.(animation|animationIterationCount)$/.test(left) && /\binfinite\b/.test(textOf(n.right))) add('infinite-animation', n.loc.start.line);
            },
            Literal(n) {
                if (typeof n.value === 'string' && INFINITE_CSS_RE.test(n.value)) add('infinite-animation', n.loc.start.line);
            },
            TemplateLiteral(n) {
                if (INFINITE_CSS_RE.test(n.quasis.map((q) => q.value.raw).join('x'))) add('infinite-animation', n.loc.start.line);
            }
        });
    }
    if (kind === 'server') {
        const known = broadcastAudience();
        walk.ancestor(ast, {
            CallExpression(n, _s, anc) {
                const callee = dotted(n.callee) || '';
                // fs.xSync inside an express route / socket handler callback
                if (/(^|\.)(\w+Sync)$/.test(callee) && /^(fs|fsp|require\('fs'\))\./.test(callee)) {
                    const inHandler = anc.some((a) => a.type === 'CallExpression' && a !== n && isHandlerCall(a));
                    if (inHandler) add('sync-io-in-handler', n.loc.start.line);
                }
                // broadcast({ type: 'x' }) with no audience decision
                if (/(^|\.)broadcast$/.test(callee) && n.arguments[0] && n.arguments[0].type === 'ObjectExpression') {
                    const p = n.arguments[0].properties.find((q) => q.type === 'Property' && !q.computed && ((q.key.type === 'Identifier' && q.key.name === 'type') || (q.key.type === 'Literal' && q.key.value === 'type')));
                    const t = p && p.value && p.value.type === 'Literal' ? String(p.value.value) : null;
                    if (t && !known.has(t)) add('unclassified-broadcast', n.loc.start.line);
                }
            }
        });
    }
    return hits;
}

function isHandlerCall(n) {
    const c = dotted(n.callee) || '';
    if (/(^|\.)(app|router|api|server)\.(get|post|put|patch|delete|all)$/.test(c)) return true;
    if (/^(reg|register|registerHandler|on)$/.test(c) && n.arguments[0] && n.arguments[0].type === 'Literal' && n.arguments.some((a) => /Function/.test(a.type))) return true;
    return false;
}

function scanCss(src, add) {
    const lineAt = (i) => src.slice(0, i).split('\n').length;
    const push = (rule, i) => add(rule, lineAt(i));
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => (allowRe.test(m) ? m : m.replace(/[^\n]/g, ' ')));
    for (const m of noComments.matchAll(/animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/g)) push('infinite-animation', m.index);
    for (const m of noComments.matchAll(/will-change\s*:/g)) push('will-change', m.index);
    // keyframes blocks: @keyframes name { ... { ... } ... }
    const kfRe = /@(?:-webkit-)?keyframes\s+[\w-]+\s*\{/g;
    let m;
    while ((m = kfRe.exec(noComments))) {
        let depth = 1; let i = kfRe.lastIndex;
        while (i < noComments.length && depth > 0) { if (noComments[i] === '{') depth++; else if (noComments[i] === '}') depth--; i++; }
        const block = noComments.slice(kfRe.lastIndex, i);
        if (/(^|[\s;{])(box-shadow|filter|backdrop-filter|width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*|background-position|background-size|border-width|font-size|letter-spacing)\s*:/.test(block)) push('paint-keyframes', m.index);
        kfRe.lastIndex = i;
    }
}

function scanKotlin(src, lines, add) {
    const lineAt = (i) => src.slice(0, i).split('\n').length;
    const each = (re, rule, test) => { for (const m of src.matchAll(re)) { if (!test || test(m)) add(rule, lineAt(m.index)); } };
    const code = src.replace(/\/\/[^\n]*/g, (c) => (allowRe.test(c) ? c : ' '.repeat(c.length))).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    const eachCode = (re, rule, test) => { for (const m of code.matchAll(re)) { if (!test || test(m)) add(rule, lineAt(m.index)); } };
    eachCode(/\bpostInvalidateOnAnimation\s*\(/g, 'vsync-invalidate');
    eachCode(/\.commit\(\)/g, 'prefs-commit', (m) => /edit\s*\([\s\S]{0,400}$/.test(code.slice(Math.max(0, m.index - 400), m.index)) || /prefs|Prefs|preferences/.test(code.slice(Math.max(0, m.index - 300), m.index)));
    eachCode(/BitmapFactory\s*\.\s*decode(?:Stream|File|ByteArray|Resource|FileDescriptor)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, 'unsampled-decode', (m) => !/opt|Options|bounds|sample/i.test(m[1]) && m[1].split(',').length < (/decodeByteArray/.test(m[0]) ? 4 : 2));
    eachCode(/\b(scheduleAtFixedRate|scheduleWithFixedDelay|setRepeating|setInexactRepeating|PeriodicWorkRequest(?:Builder)?)\b/g, 'fixed-rate-wakeup');
    eachCode(/ACTION_TIME_TICK/g, 'time-tick');
    eachCode(/pingInterval\s*\(\s*(\d+)\s*,\s*TimeUnit\.(SECONDS|MILLISECONDS)/g, 'short-ping', (m) => (m[2] === 'SECONDS' ? Number(m[1]) : Number(m[1]) / 1000) < 60);
    if (/newWakeLock\s*\(/.test(code) && !/\.release\s*\(/.test(code)) eachCode(/newWakeLock\s*\(/g, 'wakelock-no-release');
    // onDraw bodies: allocations
    for (const m of code.matchAll(/override\s+fun\s+(?:onDraw|dispatchDraw|draw)\s*\(/g)) {
        const open = code.indexOf('{', m.index);
        if (open < 0) continue;
        const end = matchBrace(code, open);
        const body = code.slice(open, end);
        for (const a of body.matchAll(/\b(Paint|Path|RectF|Rect|LinearGradient|RadialGradient|SweepGradient|Matrix|PorterDuffXfermode)\s*\(/g)) {
            // a type in a declaration or a cast is not a construction
            const pre = body.slice(Math.max(0, a.index - 2), a.index);
            if (/[.:]$/.test(pre.trim())) continue;
            add('ondraw-alloc', lineAt(open + a.index));
        }
    }
    // @JavascriptInterface methods doing heavy work inline
    for (const m of code.matchAll(/@JavascriptInterface[\s\S]{0,200}?\bfun\s+\w+\s*\([^)]*\)[^{=]*([{=])/g)) {
        const at = m.index + m[0].length - 1;
        let body;
        if (m[1] === '{') body = code.slice(at, matchBrace(code, at));
        else { const nl = code.indexOf('\n', at); body = code.slice(at, nl < 0 ? code.length : nl); }
        if (/BitmapFactory|\.compress\s*\(|queryIntentActivities|contentResolver\s*\.\s*query|\.query\s*\(\s*\w+\s*,|openConnection|URL\s*\([^)]*\)\s*\.\s*(openStream|readBytes)|\.readBytes\s*\(|\.writeBytes\s*\(|getInstalledPackages|getInstalledApplications|loadIcon\s*\(|loadLabel\s*\(/.test(body)) add('heavy-js-bridge', lineAt(m.index));
    }
    void each; void lines;
}

function matchBrace(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        const c = s[i];
        if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; i++; } continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return i + 1; }
    }
    return s.length;
}

function countsOf(hits) {
    const c = {};
    hits.forEach((h) => { c[h.rule] = (c[h.rule] || 0) + 1; });
    return c;
}

function readBaseline() {
    try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) { return null; }
}

function stagedFiles() {
    try {
        return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root, encoding: 'utf8' })
            .split('\n').filter(Boolean).filter((f) => kindOf(f));
    } catch (_) { return []; }
}

function main() {
    if (flag('--rules')) { RULE_IDS.forEach((r) => console.log(`${r.padEnd(24)} ${RULES[r]}`)); return; }
    const listIdx = argv.indexOf('--list');
    if (listIdx >= 0) {
        const rule = argv[listIdx + 1];
        if (!RULE_IDS.includes(rule)) { console.error('rules: ' + RULE_IDS.join(', ')); process.exit(2); }
        const only = argv[listIdx + 2] && !argv[listIdx + 2].startsWith('--') ? [argv[listIdx + 2]] : listFiles();
        only.forEach((f) => scanFile(f).filter((h) => h.rule === rule).forEach((h) => console.log(`${f}:${h.line}  ${h.text}`)));
        return;
    }
    const all = listFiles();
    if (flag('--report')) {
        const tot = {}; const worst = [];
        all.forEach((f) => { const c = countsOf(scanFile(f)); Object.entries(c).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v; worst.push([v, k, f]); }); });
        RULE_IDS.forEach((r) => console.log(`${String(tot[r] || 0).padStart(5)}  ${r}`));
        console.log('\nworst:');
        worst.sort((a, b) => b[0] - a[0]).slice(0, 25).forEach(([v, k, f]) => console.log(`${String(v).padStart(4)}  ${k.padEnd(22)} ${f}`));
        return;
    }
    if (flag('--update') || flag('--init')) {
        const old = readBaseline() || {};
        const accept = new Set();
        argv.forEach((a, i) => { if (a === '--accept-rise' && argv[i + 1]) accept.add(argv[i + 1]); });
        const next = {};
        all.forEach((f) => {
            const c = countsOf(scanFile(f));
            const prev = old[f] || {};
            const row = {};
            // only --init (or no baseline file at all) takes today's counts; an empty baseline means every count is 0
            const fresh = flag('--init') || readBaseline() === null;
            for (const r of RULE_IDS) {
                const now = c[r] || 0;
                // --update only lowers: a count above the baseline stays at the baseline unless Yukimi accepted it
                const keep = fresh || accept.has(`${r}:${f}`) ? now : Math.min(now, prev[r] || 0);
                if (keep) row[r] = keep;
            }
            if (Object.keys(row).length) next[f] = row;
        });
        const sorted = {};
        Object.keys(next).sort().forEach((k) => { sorted[k] = next[k]; });
        fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
        fs.writeFileSync(BASELINE, JSON.stringify(sorted, null, 1) + '\n');
        console.log(`baseline written: ${Object.keys(sorted).length} files (${rel(BASELINE)})`);
        return;
    }
    const base = readBaseline();
    if (!base) { console.error(`no baseline at ${BASELINE}; run with --init once`); process.exit(2); }
    const explicit = argv.filter((a) => !a.startsWith('--') && a !== dsappRoot);
    const files = flag('--staged') ? stagedFiles() : explicit.length ? explicit.map((f) => rel(path.resolve(f))) : all;
    const rises = [];
    files.forEach((f) => {
        const hits = scanFile(f);
        const c = countsOf(hits);
        const b = base[f] || {};
        for (const r of RULE_IDS) {
            const now = c[r] || 0; const was = b[r] || 0;
            if (now > was) rises.push({ f, r, was, now, hits: hits.filter((h) => h.rule === r) });
        }
    });
    if (!rises.length) { console.log(`perf rules: ok (${files.length} files)`); return; }
    console.error('perf rules: counts rose (rules: .cursor/rules/phone-power-*.mdc)\n');
    rises.forEach(({ f, r, was, now, hits }) => {
        console.error(`  ${f}: ${r} ${was} -> ${now}`);
        console.error(`    ${RULES[r]}`);
        hits.slice(-Math.max(1, now - was) - 2).forEach((h) => console.error(`    ${h.line}: ${h.text}`));
    });
    console.error('\nFix the new ones. A line that really must stay carries `perf: allow <reason>`; a rise needs Yukimi\'s decision (--update --accept-rise <rule>:<file>).');
    process.exit(1);
}

if (require.main === module) main();
else module.exports = { scanFile, kindOf, RULES };
