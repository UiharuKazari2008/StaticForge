#!/usr/bin/env node
// WebSocket request names check (Yozora #1350). The rule is .cursor/rules/notification-discipline.mdc (N1, N11): the
// ticker shows words a person reads, never a raw identifier, and machinery is not a notice.
// Yukimi: "if a name cannot be written, it is machinery, and if it is machinery it does not go in the ticker."
//
// Every REQUEST type (any type not ending in _response, _error, _update, _progress) registered with
// modules/ws/wsPacketRegistry.js needs a decision: a name (meta.name, or an entry in modules/ws/wsRequestNames.js
// `names`) or an explicit ticker:false (meta.ticker:false, or the `quiet` list there). Request types with neither are
// UNDECIDED. They are counted per registering file and compared with scripts/ws-names-baseline.json (the
// check-notifications.js pattern): a count may only go DOWN, a new file must be clean, a rise needs Yukimi's decision
// (--accept-rise). Hard errors with no baseline:
//   (i)   a name in the table whose type is not registered (a dead entry must never come back),
//   (ii)  a quiet entry whose type is not registered,
//   (iii) the client block between `// ws-names:begin` and `// ws-names:end` in public/scripts/websocket.js differs
//         from what --generate produces (stale). Until agent B has put the markers there the check is skipped.
// The client block (REQUEST_TYPE_NAMES and TICKER_OFF_TYPES) is generated here, once, so the client gets plain literals.
//
//   node scripts/check-ws-names.js                       check (exit 1 on a rise or a hard error)
//   node scripts/check-ws-names.js --staged              the pre-commit hook: runs only when a staged file is under
//                                                        modules/ws/, is scripts/ws-names-baseline.json or is
//                                                        public/scripts/websocket.js; otherwise exits 0 at once
//   node scripts/check-ws-names.js --list [type-or-prefix]   offenders: type and registering file
//   node scripts/check-ws-names.js --report              totals: registered, requests, named, quiet, undecided, dead
//   node scripts/check-ws-names.js --update              lower the baseline to today's counts (never raises)
//   node scripts/check-ws-names.js --update --accept-rise <file>   a rise Yukimi accepted
//   node scripts/check-ws-names.js --generate            rewrite the generated block in public/scripts/websocket.js
//
// Self-test aid: CHECK_WS_NAMES_EXTRA=<type>[,<type>] adds nameless fake request types to the registered list
// (file "(self-test)"), so the check can be seen to fail. CHECK_WS_NAMES_CLIENT=<file> points --generate and the
// in-sync check at another copy of the client file. The decision logic is the exported evaluate().
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'scripts', 'ws-names-baseline.json');
const CLIENT = process.env.CHECK_WS_NAMES_CLIENT || path.join(ROOT, 'public', 'scripts', 'websocket.js');
const BEGIN = '// ws-names:begin';
const END = '// ws-names:end';
const STAGED_RE = /^(modules\/ws\/|scripts\/ws-names-baseline\.json$|public\/scripts\/websocket\.js$)/;

const { isAnswerType } = require('../modules/ws/wsPacketRegistry');

// ---- the decision logic (pure) -------------------------------------------------------------------------------
// items: [{ type, file, name, ticker }]  as registered (name '' / ticker null = nothing decided)
// names: the table's { type: 'Name' }; quiet: the table's [type]; baseline: { files: { file: n } }
function evaluate({ items, names, quiet, baseline, accept }) {
    const acceptSet = new Set(accept || []);
    const registered = new Set(items.map((i) => i.type));
    const requests = items.filter((i) => !isAnswerType(i.type));
    const undecided = requests.filter((i) => i.ticker === null && !i.name);
    const counts = {};
    undecided.forEach((i) => { counts[i.file] = (counts[i.file] || 0) + 1; });

    const errors = [];
    const dead = Object.keys(names || {}).filter((t) => !registered.has(t));
    dead.forEach((t) => errors.push('name for a type that is not registered (dead entry): ' + t));
    const deadQuiet = (quiet || []).filter((t) => !registered.has(t));
    deadQuiet.forEach((t) => errors.push('quiet entry for a type that is not registered: ' + t));

    const base = (baseline && baseline.files) || {};
    const rises = [], drops = [];
    new Set(Object.keys(base).concat(Object.keys(counts))).forEach((f) => {
        const was = base[f] || 0, is = counts[f] || 0;
        if (is > was) rises.push({ file: f, was, is, accepted: acceptSet.has(f) });
        else if (is < was) drops.push({ file: f, was, is });
    });
    return {
        errors,
        rises: rises.filter((r) => !r.accepted),
        acceptedRises: rises.filter((r) => r.accepted),
        drops,
        counts,
        undecided,
        dead,
        deadQuiet,
        totals: {
            registered: items.length,
            requests: requests.length,
            named: requests.filter((i) => i.name).length,
            quiet: requests.filter((i) => i.ticker === false).length,
            undecided: undecided.length,
            dead: dead.length
        }
    };
}

// ---- the generated client block ------------------------------------------------------------------------------
const lit = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";

function generateBlock(items, names) {
    const named = {};
    Object.keys(names).forEach((t) => { named[t] = names[t]; });
    items.forEach((i) => { if (i.name && !(i.type in named)) named[i.type] = i.name; });
    const tableOrder = Object.keys(names);
    const rest = Object.keys(named).filter((t) => !(t in names)).sort();
    const lines = [
        '    // GENERATED by `node scripts/check-ws-names.js --generate` from modules/ws/wsRequestNames.js and the registered',
        '    // WebSocket packets (#1350). Do not edit by hand: the pre-commit check fails while this block is stale.',
        '    static REQUEST_TYPE_NAMES = Object.freeze({'
    ];
    tableOrder.concat(rest).forEach((t) => lines.push('        ' + lit(t) + ': ' + lit(named[t]) + ','));
    lines.push('    });');
    lines.push('    static TICKER_OFF_TYPES = new Set([');
    items.filter((i) => i.ticker === false).map((i) => i.type).sort().forEach((t) => lines.push('        ' + lit(t) + ','));
    lines.push('    ]);');
    return lines.join('\n');
}

// the lines between the two marker lines of the client file; null when the markers are not there yet
function readClientBlock(src) {
    const lines = src.split('\n');
    const b = lines.findIndex((l) => l.trim().startsWith(BEGIN));
    const e = lines.findIndex((l) => l.trim().startsWith(END));
    if (b < 0 || e < 0 || e < b) return null;
    return { before: lines.slice(0, b + 1), inner: lines.slice(b + 1, e).join('\n'), after: lines.slice(e) };
}

// ---- loading what the server registers (silent) ---------------------------------------------------------------
function loadRegistered() {
    process.chdir(ROOT);
    const reg = require('../modules/ws/wsPacketRegistry');
    const registerAll = require('../modules/ws/registerAllWsHandlers');
    const stubFn = () => stub;
    const stub = new Proxy(stubFn, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), set: () => true, apply: () => stub });
    const ctx = new Proxy({}, { get: (t, k) => (k === 'globalResources' ? {} : () => {}), set: () => true });
    const saved = [console.warn, console.log, console.error, console.info];
    console.warn = console.log = console.error = console.info = () => {};
    try {
        try { registerAll(ctx); } catch (e) { /* a handler that needs a real server: the rest still registered */ }
        // the replication routes register WS packets too (server start loads them with the HTTP routes)
        try {
            reg.withRegistrar(path.join(ROOT, 'modules', 'replication', 'registerRoutes.js'),
                () => require('../modules/replication/registerRoutes')(stub, stub));
        } catch (e) { /* same */ }
    } finally {
        [console.warn, console.log, console.error, console.info] = saved;
    }
    const items = reg.listRegisteredPackets().map((p) => {
        const entry = reg.getWsPacketEntry(p.type);
        const file = entry && entry.file ? path.relative(ROOT, entry.file) : '(unknown file)';
        return { type: p.type, file, name: p.meta.name || '', ticker: p.meta.ticker };
    });
    String(process.env.CHECK_WS_NAMES_EXTRA || '').split(',').map((s) => s.trim()).filter(Boolean)
        .forEach((t) => items.push({ type: t, file: '(self-test)', name: '', ticker: null }));
    return items;
}

function loadBaseline() {
    try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (e) { return null; }
}
function saveBaseline(files) {
    const sorted = {};
    Object.keys(files).sort().forEach((f) => { if (files[f] > 0) sorted[f] = files[f]; });
    const total = Object.values(sorted).reduce((a, b) => a + b, 0);
    fs.writeFileSync(BASELINE, JSON.stringify({
        note: 'WebSocket request types with no name and no ticker decision, per registering file. Counts may only go down. See scripts/check-ws-names.js and Yozora #1350.',
        total,
        files: sorted
    }, null, 1) + '\n');
    return total;
}

function stagedMatters() {
    try {
        return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: ROOT, encoding: 'utf8' })
            .split('\n').some((f) => STAGED_RE.test(f));
    } catch (e) { return false; }
}

function main(argv) {
    const flag = (f) => argv.includes(f);
    if (flag('--staged') && !stagedMatters()) return 0;

    const items = loadRegistered();
    const tableMod = require('../modules/ws/wsRequestNames');
    const baseline = loadBaseline();
    const accept = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === '--accept-rise' && argv[i + 1]) accept.push(argv[++i]);
    const res = evaluate({ items, names: tableMod.names, quiet: tableMod.quiet, baseline, accept });

    if (flag('--generate')) {
        const cur = readClientBlock(fs.readFileSync(CLIENT, 'utf8'));
        if (!cur) {
            console.error('ws-names: public/scripts/websocket.js has no `' + BEGIN + '` / `' + END + '` markers yet (agent B inserts them); nothing generated.');
            return 2;
        }
        const next = cur.before.concat(generateBlock(items, tableMod.names).split('\n'), cur.after).join('\n');
        fs.writeFileSync(CLIENT, next);
        console.log('ws-names: client block written (' + Object.keys(tableMod.names).length + ' names).');
        return 0;
    }

    if (flag('--list')) {
        const i = argv.indexOf('--list');
        const want = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
        res.undecided.filter((u) => u.type.startsWith(want)).sort((a, b) => a.type.localeCompare(b.type))
            .forEach((u) => console.log(u.type + '  ' + u.file));
        return 0;
    }

    if (flag('--report')) {
        const t = res.totals;
        console.log('registered ' + t.registered + '  requests ' + t.requests + '  named ' + t.named + '  quiet ' + t.quiet
            + '  undecided ' + t.undecided + '  dead ' + t.dead);
        Object.entries(res.counts).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([f, n]) => console.log(String(n).padStart(6) + '  ' + f));
        return 0;
    }

    if (flag('--update') || flag('--init')) {
        const base = (baseline && baseline.files) || {};
        const init = flag('--init') || !baseline;
        const next = {};
        new Set(Object.keys(base).concat(Object.keys(res.counts))).forEach((f) => {
            const was = base[f] || 0, is = res.counts[f] || 0;
            next[f] = init || is <= was || accept.includes(f) ? is : was;
        });
        const total = saveBaseline(next);
        console.log('baseline written: ' + total + ' undecided request type(s) in ' + Object.keys(next).filter((f) => next[f] > 0).length + ' file(s)');
        if (res.rises.length && !init) {
            console.error('\nNOT recorded (counts rose):');
            res.rises.forEach((r) => console.error('  ' + r.file + '  ' + r.was + ' -> ' + r.is));
            return 1;
        }
        return 0;
    }

    const errors = res.errors.slice();
    const clientSrc = fs.readFileSync(CLIENT, 'utf8');
    const cur = readClientBlock(clientSrc);
    let note = '';
    if (!cur) note = ', client block not marked yet (skipped)';
    else if (cur.inner !== generateBlock(items, tableMod.names)) {
        errors.push('the generated block in public/scripts/websocket.js is stale: run  node scripts/check-ws-names.js --generate');
    }

    let bad = false;
    if (errors.length) {
        bad = true;
        console.error('WS names: ' + errors.length + ' error(s)\n');
        errors.forEach((e) => console.error('  ' + e));
        console.error('');
    }
    if (res.rises.length) {
        bad = true;
        console.error('WS names: ' + res.rises.length + ' count(s) of request types with no name and no ticker decision rose. .cursor/rules/notification-discipline.mdc (N1, N11), Yozora #1350\n');
        res.rises.forEach((r) => console.error('  ' + r.file + '\n    undecided: ' + r.was + ' -> ' + r.is));
        console.error('\nGive the request words a person reads (meta.name, or modules/ws/wsRequestNames.js `names`), or, if no name can be');
        console.error('written, it is machinery: meta.ticker:false (or the `quiet` list). Show them:  node scripts/check-ws-names.js --list');
        console.error('A rise that stays needs Yukimi\'s decision (--update --accept-rise <file>).');
    }
    if (bad) return 1;
    console.log('WS names: ok (' + res.totals.requests + ' request types, ' + res.totals.undecided + ' undecided'
        + (res.drops.length ? ', ' + res.drops.length + ' file count(s) fell: run --update to record them' : '') + note + ')');
    return 0;
}

if (require.main === module) {
    // handlers leave timers running: always exit explicitly
    let code = 1;
    try { code = main(process.argv.slice(2)); } catch (e) { console.error(e && e.stack || e); }
    process.exit(code);
}

module.exports = { evaluate, generateBlock, readClientBlock, isAnswerType, loadRegistered };
