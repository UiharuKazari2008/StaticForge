#!/usr/bin/env node
'use strict';

/**
 * Lists load-time destructuring of FUNCTIONS out of modules that reload without a restart (#1292, docs/server/hot-reload.md).
 * `const { review } = require('./agentSupervisor')` at the top level keeps the OLD function after a reload; call
 * `sup.review()` (or `require('./agentSupervisor').review()`) at call time instead. UPPER_CASE names are plain constants:
 * allowed, listed as notes.
 *
 *   node scripts/check-hot-imports.js [--json]
 *
 * Exit 1 when there are hits, 0 when none. Plain fs reads, no git.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const json = process.argv.includes('--json');

function walk(dir, out) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
    for (const e of ents) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

const stripComments = (src) => src.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n');
const MARK_RE = /require\((['"])[^'"]*hotReload\1\)\s*\.mark\(|\bhotReload\s*\.mark\(|\bmodule\.exports\.hot\s*=/;
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const isConst = (n) => /^[A-Z][A-Z0-9_]*$/.test(n);

function resolveReq(fromFile, spec) {
    if (!spec.startsWith('.')) return '';
    const base = path.resolve(path.dirname(fromFile), spec);
    for (const c of [base, `${base}.js`, path.join(base, 'index.js')]) {
        try { if (fs.statSync(c).isFile()) return c; } catch (_) { /* next */ }
    }
    return '';
}

const files = [].concat(walk(path.join(ROOT, 'modules'), []), walk(path.join(ROOT, 'routes'), []));
const web = path.join(ROOT, 'web_server.js');
if (fs.existsSync(web)) files.push(web);

const sources = new Map();
for (const f of files) { try { sources.set(f, stripComments(fs.readFileSync(f, 'utf8'))); } catch (_) { /* unreadable */ } }

const hot = new Set();
for (const [f, src] of sources) {
    if (path.join(ROOT, 'modules', 'hotReload.js') === f) continue;
    if (path.dirname(f) === path.join(ROOT, 'modules') || f.startsWith(path.join(ROOT, 'modules') + path.sep)) if (MARK_RE.test(src)) hot.add(f);
}

const hits = [];
const notes = [];
const DESTRUCT = /^(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/gm;
const MEMBER = /^(?:const|let|var)\s+[\w$]+\s*=\s*require\(\s*(['"])([^'"]+)\1\s*\)\s*\.\s*([\w$]+)\s*(?=[;\n]|$)/gm;

for (const [f, src] of sources) {
    const relF = path.relative(ROOT, f).split(path.sep).join('/');
    const add = (target, idx, names) => {
        const mod = path.relative(ROOT, target).split(path.sep).join('/');
        const fns = names.filter((n) => !isConst(n));
        const consts = names.filter(isConst);
        const line = lineOf(src, idx);
        if (fns.length) hits.push({ file: relF, line, names: fns, module: mod });
        if (consts.length) notes.push({ file: relF, line, names: consts, module: mod });
    };
    let m;
    DESTRUCT.lastIndex = 0;
    while ((m = DESTRUCT.exec(src))) {
        const target = resolveReq(f, m[3]);
        if (!target || !hot.has(target) || target === f) continue;
        const names = m[1].split(',').map((p) => p.trim().split(':')[0].trim().replace(/^\.\.\./, '').split('=')[0].trim()).filter(Boolean);
        add(target, m.index, names);
    }
    MEMBER.lastIndex = 0;
    while ((m = MEMBER.exec(src))) {
        const target = resolveReq(f, m[2]);
        if (!target || !hot.has(target) || target === f) continue;
        add(target, m.index, [m[3]]);
    }
}

hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
notes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const reloadable = [...hot].map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort();

if (json) {
    console.log(JSON.stringify({ ok: !hits.length, reloadable, hits, notes }, null, 2));
} else {
    console.log(`reloadable modules: ${reloadable.length ? reloadable.join(', ') : '(none marked yet)'}`);
    hits.forEach((h) => console.log(`${h.file}:${h.line}  destructures ${h.names.join(', ')} from ${h.module} (keeps the old code after a reload)`));
    notes.forEach((n) => console.log(`note ${n.file}:${n.line}  constants ${n.names.join(', ')} from ${n.module} (allowed)`));
    console.log(hits.length ? `${hits.length} hit${hits.length === 1 ? '' : 's'}` : 'no load-time function imports of reloadable modules');
}
process.exit(hits.length ? 1 : 0);
