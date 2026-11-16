#!/usr/bin/env node
// App scope check (Yozora #872). Rule: .cursor/rules/app-scope-ownership.mdc.
//
// An app (a Melaton package, a featureLoader feature) must be unloadable: everything it holds is
// attached to it, so a live update can take it away and the garbage collector can take the memory.
// This counts, per file, what breaks that, and compares with scripts/app-scope-baseline.json. A count
// may only go DOWN: a new file must be clean, a file you touch may not get worse (--update records a
// lower count; a rise needs Yukimi's decision and --accept-rise <rule>:<file>).
//
//   node scripts/check-app-scope.js              check the tree (exit 1 on a rise)
//   node scripts/check-app-scope.js <file...>    check only these files
//   node scripts/check-app-scope.js --report     totals per rule, worst files
//   node scripts/check-app-scope.js --list <rule> [file]   the matching lines
//   node scripts/check-app-scope.js --features   which featureLoader features can be hot segments
//   node scripts/check-app-scope.js --update     lower the baseline to today's counts
//
// Rules
//   owner-less-listener  addEventListener on a page-wide target (window, document, body, root, doc,
//                        visualViewport, matchMedia(...), navigator.serviceWorker, screen.orientation)
//                        with no `signal` and no matching removeEventListener in the file
//   owner-less-ws        wsClient.on(type, fn) with no { signal } and no wsClient.off(type, fn)
//   global-override      replacing a shared function or prototype method (EventTarget.prototype.x =,
//                        document.addEventListener =, window.fetch =, history.pushState = ...): code
//                        loaded later bypasses whatever owns it (modalKeyboardRegistry's
//                        document.addEventListener hid document listeners from their owners)
//   lost-interval        setInterval(...) whose id is not kept: it can never be cleared
//   page-global          a top-level var / let / const / function / class or window.x = in page code:
//                        state attached to the page instead of to its app
//
// `// app-scope: allow <reason>` on the line (or the line before) exempts that line, with the
// reason in the code. Use it for the runtime itself (melatonSegments.js), not to quiet a finding.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');
const walk = require('acorn-walk');

const root = path.join(__dirname, '..');
const BASELINE = 'scripts/app-scope-baseline.json';
const SCAN_DIRS = ['public/scripts', 'apps'];
const SKIP = /(^|\/)(node_modules|vendor|graphify-out|server|\.cache|dist|workers?)\//;
const RULE_IDS = ['owner-less-listener', 'owner-less-ws', 'global-override', 'lost-interval', 'page-global'];

const PAGE_TARGETS = new Set(['window', 'document', 'root', 'doc', 'self', 'globalThis', 'top', 'parent']);
const PAGE_MEMBER_TARGETS = new Set(['document.body', 'document.documentElement', 'window.visualViewport', 'root.visualViewport',
    'navigator.serviceWorker', 'screen.orientation', 'window.screen.orientation', 'document.fonts', 'root.document', 'window.document',
    'doc.body', 'doc.documentElement', 'root.document.body']);
const BUILTINS = new Set(['EventTarget', 'Node', 'Element', 'HTMLElement', 'Document', 'Window', 'Function', 'Object', 'Array',
    'Promise', 'XMLHttpRequest', 'WebSocket', 'String', 'Number', 'Map', 'Set', 'History', 'Storage', 'HTMLCanvasElement',
    'CanvasRenderingContext2D', 'Response', 'Request', 'Event', 'HTMLInputElement', 'HTMLMediaElement', 'Image']);
const OVERRIDE_TARGETS = new Set(['document.addEventListener', 'document.removeEventListener', 'window.addEventListener',
    'window.removeEventListener', 'root.addEventListener', 'window.fetch', 'root.fetch', 'window.setTimeout', 'window.setInterval',
    'window.requestAnimationFrame', 'root.setTimeout', 'root.setInterval', 'history.pushState', 'history.replaceState',
    'window.history.pushState', 'window.history.replaceState', 'URL.createObjectURL', 'URL.revokeObjectURL', 'window.open',
    'console.log', 'console.error', 'console.warn', 'window.onerror', 'window.alert', 'window.confirm', 'window.prompt',
    'Element.prototype.attachShadow', 'navigator.sendBeacon', 'document.createElement', 'document.body.appendChild']);

function listFiles() {
    const out = [];
    const visit = (dir) => {
        const abs = path.join(root, dir);
        if (!fs.existsSync(abs)) return;
        for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
            const rel = `${dir}/${ent.name}`;
            if (SKIP.test(`${rel}/`) || ent.name.startsWith('.')) continue;
            if (ent.isDirectory()) visit(rel);
            else if (ent.isFile() && /\.js$/.test(ent.name) && !/\.min\.js$/.test(ent.name)) out.push(rel);
        }
    };
    SCAN_DIRS.forEach(visit);
    return out.sort();
}

function parse(src) {
    const opts = { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, locations: true };
    try { return acorn.parse(src, Object.assign({ sourceType: 'script' }, opts)); } catch (_) { /* module? */ }
    return acorn.parse(src, Object.assign({ sourceType: 'module' }, opts));
}

/** member expression -> 'a.b.c' (identifiers / this only), else null */
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

function literalOf(node) {
    return node && node.type === 'Literal' ? String(node.value) : (node && node.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : null);
}

function isPageTarget(obj) {
    const d = dotted(obj);
    if (d && (PAGE_TARGETS.has(d) || PAGE_MEMBER_TARGETS.has(d))) return true;
    // matchMedia('(...)').addEventListener: a page-wide object
    if (obj && obj.type === 'CallExpression') {
        const c = dotted(obj.callee);
        if (c && /(^|\.)matchMedia$/.test(c)) return true;
    }
    return false;
}

/** Find violations in one file: [{ rule, line, text }] */
function scanFile(rel) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const lines = src.split('\n');
    const allowed = (line) => /app-scope:\s*allow/.test(lines[line - 1] || '') || /app-scope:\s*allow/.test(lines[line - 2] || '');
    let ast;
    try { ast = parse(src); } catch (err) { return { error: err.message, hits: [] }; }
    const hits = [];
    const add = (rule, node, note) => {
        const line = node.loc.start.line;
        if (allowed(line)) return;
        hits.push({ rule, line, text: (note ? `${note}: ` : '') + (lines[line - 1] || '').trim().slice(0, 140) });
    };

    // removals in this file: 'type|fn' for removeEventListener / off
    const removed = new Set();
    const fnKey = (n) => dotted(n) || (n && n.type === 'Identifier' ? n.name : null);
    walk.simple(ast, {
        CallExpression(n) {
            const c = n.callee;
            if (c.type !== 'MemberExpression' || c.computed) return;
            const m = c.property.name;
            if (m === 'removeEventListener' || m === 'off') {
                const t = literalOf(n.arguments[0]);
                const f = fnKey(n.arguments[1]);
                removed.add(`${t}|${f}`);
                if (t) removed.add(`${t}|*`); // a removal of that type at all (handler kept in a map)
            }
        }
    });

    walk.ancestor(ast, {
        CallExpression(n, _state, ancestors) {
            const c = n.callee;
            if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
                const m = c.property.name;
                if (m === 'addEventListener' && isPageTarget(c.object)) {
                    const opts = n.arguments[2];
                    const signalled = hasKey(opts, 'signal') || hasKey(opts, 'once') || (opts && (opts.type === 'Identifier' || opts.type === 'MemberExpression' || opts.type === 'CallExpression'));
                    const t = literalOf(n.arguments[0]);
                    const f = fnKey(n.arguments[1]);
                    const undone = (f && removed.has(`${t}|${f}`)) || removed.has(`${t}|*`);
                    if (!signalled && !undone) add('owner-less-listener', n);
                }
                if (m === 'on') {
                    const target = dotted(c.object) || '';
                    if (/(^|\.)wsClient$/.test(target)) {
                        const t = literalOf(n.arguments[0]);
                        const f = fnKey(n.arguments[1]);
                        const signalled = n.arguments[2] && (hasKey(n.arguments[2], 'signal') || n.arguments[2].type !== 'ObjectExpression');
                        if (!signalled && !(f && removed.has(`${t}|${f}`)) && !removed.has(`${t}|*`)) add('owner-less-ws', n);
                    }
                }
            }
            const callee = dotted(c);
            if (callee === 'setInterval' || callee === 'window.setInterval' || callee === 'root.setInterval') {
                const parent = ancestors[ancestors.length - 2];
                if (parent && parent.type === 'ExpressionStatement') add('lost-interval', n);
            }
        },
        AssignmentExpression(n) {
            const d = dotted(n.left);
            if (!d) return;
            const parts = d.split('.');
            const protoAt = parts.indexOf('prototype');
            if (protoAt > 0 && BUILTINS.has(parts[protoAt - 1]) && parts.length === protoAt + 2) add('global-override', n);
            else if (OVERRIDE_TARGETS.has(d)) add('global-override', n);
        }
    });

    // page-global: top-level declarations of a classic script, and window.x = anywhere at top level
    if (ast.sourceType === 'script') {
        for (const st of ast.body) {
            if (st.type === 'VariableDeclaration') st.declarations.forEach((d) => add('page-global', d, d.id && d.id.name));
            else if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') add('page-global', st, st.id && st.id.name);
        }
        walk.simple(ast, {
            AssignmentExpression(n) {
                const d = dotted(n.left);
                if (d && /^(window|globalThis|self)\.[A-Za-z_$][\w$]*$/.test(d)) add('page-global', n, d);
            }
        });
    }
    return { hits };
}

function countsOf(hits) {
    const c = {};
    for (const h of hits) c[h.rule] = (c[h.rule] || 0) + 1;
    return c;
}

// ---- featureLoader: which features can be hot segments -------------------------------------------

function featureManifest() {
    const src = fs.readFileSync(path.join(root, 'public/scripts/comp/featureLoader.js'), 'utf8');
    const ast = parse(src);
    const decl = ast.body.find((s) => s.type === 'VariableDeclaration' && s.declarations[0].id.name === 'FEATURE_MANIFEST');
    const lit = src.slice(decl.declarations[0].init.start, decl.declarations[0].init.end);
    return vm.runInNewContext(`(${lit})`);
}

/** Top-level names a classic script puts on the page: [{ name, exported }] (exported = window.x =) */
function topLevelNames(rel) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const ast = parse(src);
    const names = new Map();
    if (ast.sourceType !== 'script') return names;
    for (const st of ast.body) {
        if (st.type === 'VariableDeclaration') st.declarations.forEach((d) => { if (d.id && d.id.name) names.set(d.id.name, false); });
        else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) names.set(st.id.name, false);
    }
    walk.simple(ast, {
        AssignmentExpression(n) {
            const d = dotted(n.left);
            const m = d && /^(window|globalThis|self|root)\.([A-Za-z_$][\w$]*)$/.exec(d);
            if (m) names.set(m[2], true);
        }
    });
    return names;
}

function featureReport() {
    const manifest = featureManifest();
    // a word index over every other page file (JS, templates, app.html): who names what
    const pageFiles = listFiles().concat(
        fs.readdirSync(path.join(root, 'public/templates')).filter((f) => f.endsWith('.html')).map((f) => `public/templates/${f}`),
        ['public/app.html']
    );
    const words = new Map(); // word -> Set(files)
    for (const rel of pageFiles) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
        for (const w of new Set(text.match(/[A-Za-z_$][\w$]*/g) || [])) {
            if (!words.has(w)) words.set(w, new Set());
            words.get(w).add(rel);
        }
    }
    const rows = [];
    for (const [name, f] of Object.entries(manifest)) {
        const own = new Set([...(f.scripts || []).map((s) => `public/${s}`), f.html ? `public/${f.html}` : null].filter(Boolean));
        const blockers = [];
        let overrides = 0;
        for (const s of f.scripts || []) {
            const rel = `public/${s}`;
            if (!fs.existsSync(path.join(root, rel))) continue;
            let names;
            try { names = topLevelNames(rel); } catch (err) { blockers.push(`${s}: does not parse (${err.message})`); continue; }
            overrides += scanFile(rel).hits.filter((h) => h.rule === 'global-override').length;
            for (const [n, exported] of names) {
                if (exported) continue; // put on the page on purpose: a segment keeps that working
                const users = Array.from(words.get(n) || []).filter((u) => !own.has(u));
                if (users.length) blockers.push(`${n} <- ${users.slice(0, 3).join(', ')}${users.length > 3 ? ` +${users.length - 3}` : ''}`);
            }
        }
        if (overrides) blockers.push(`${overrides} global override(s)`);
        rows.push({ feature: name, scripts: (f.scripts || []).length, hot: f.hot === true, eligible: !blockers.length && (f.scripts || []).length > 0, blockers });
    }
    return rows;
}

// ---- main ------------------------------------------------------------------------------------------

function main() {
    const argv = process.argv.slice(2);
    const flag = (f) => argv.includes(f);
    if (flag('--features')) {
        const rows = featureReport();
        const json = flag('--json');
        if (json) { console.log(JSON.stringify(rows, null, 1)); return; }
        const ok = rows.filter((r) => r.eligible);
        console.log(`features that can be hot segments (${ok.length}/${rows.length}): ${ok.map((r) => r.feature + (r.hot ? '*' : '')).join(', ')}`);
        for (const r of rows.filter((x) => !x.eligible && x.scripts)) {
            console.log(`\n${r.feature}${r.hot ? ' (marked hot!)' : ''}:`);
            r.blockers.slice(0, 8).forEach((b) => console.log(`  ${b}`));
            if (r.blockers.length > 8) console.log(`  ... ${r.blockers.length - 8} more`);
        }
        const wrong = rows.filter((r) => r.hot && !r.eligible);
        if (wrong.length) { console.error(`\nmarked hot but not eligible: ${wrong.map((r) => r.feature).join(', ')}`); process.exit(1); }
        return;
    }

    const listAt = argv.indexOf('--list');
    const explicit = argv.filter((a, i) => !a.startsWith('--') && !(listAt >= 0 && i === listAt + 1));
    const files = explicit.length ? explicit.map((f) => path.relative(root, path.resolve(f))) : listFiles();
    const results = {};
    const errors = [];
    for (const rel of files) {
        const r = scanFile(rel);
        if (r.error) errors.push(`${rel}: ${r.error}`);
        results[rel] = r.hits;
    }

    if (listAt >= 0) {
        const rule = argv[listAt + 1];
        if (!RULE_IDS.includes(rule)) { console.error('rules: ' + RULE_IDS.join(', ')); process.exit(2); }
        for (const [rel, hits] of Object.entries(results)) hits.filter((h) => h.rule === rule).forEach((h) => console.log(`${rel}:${h.line}  ${h.text}`));
        return;
    }

    const base = fs.existsSync(path.join(root, BASELINE)) ? JSON.parse(fs.readFileSync(path.join(root, BASELINE), 'utf8')) : {};
    if (flag('--report')) {
        const totals = {};
        const per = [];
        for (const [rel, hits] of Object.entries(results)) {
            const c = countsOf(hits);
            Object.entries(c).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + v; });
            const scoped = hits.filter((h) => h.rule !== 'page-global').length;
            if (scoped) per.push([rel, scoped, c]);
        }
        console.log('totals:', JSON.stringify(totals));
        per.sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([rel, n, c]) => console.log(`${String(n).padStart(4)}  ${rel}  ${JSON.stringify(c)}`));
        if (errors.length) console.log(`\nnot parsed (${errors.length}):\n  ${errors.join('\n  ')}`);
        return;
    }

    if (flag('--update') || flag('--init')) {
        const accept = new Set();
        argv.forEach((a, i) => { if (a === '--accept-rise' && argv[i + 1]) accept.add(argv[i + 1]); });
        const next = flag('--init') ? {} : Object.assign({}, base);
        for (const [rel, hits] of Object.entries(results)) {
            const now = countsOf(hits);
            const was = base[rel] || {};
            const row = {};
            for (const rule of RULE_IDS) {
                const n = now[rule] || 0;
                const b = was[rule] || 0;
                const keep = flag('--init') || accept.has(`${rule}:${rel}`) ? n : Math.min(n, b);
                if (keep) row[rule] = keep;
            }
            if (Object.keys(row).length) next[rel] = row;
            else delete next[rel];
        }
        const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
        fs.writeFileSync(path.join(root, BASELINE), JSON.stringify(sorted, null, 1) + '\n');
        console.log('baseline written: ' + Object.keys(sorted).length + ' files');
        return;
    }

    const rises = [];
    for (const [rel, hits] of Object.entries(results)) {
        const now = countsOf(hits);
        const was = base[rel] || {};
        for (const rule of RULE_IDS) {
            if ((now[rule] || 0) > (was[rule] || 0)) rises.push(`${rel}: ${rule} ${was[rule] || 0} -> ${now[rule]}`);
        }
    }
    if (errors.length && explicit.length) console.log(`not parsed: ${errors.join('; ')}`);
    if (rises.length) {
        console.error('app scope: counts went up (fix them, see --list <rule> <file>):\n  ' + rises.join('\n  '));
        process.exit(1);
    }
    console.log(`app scope: ok (${files.length} files)`);
}

main();
