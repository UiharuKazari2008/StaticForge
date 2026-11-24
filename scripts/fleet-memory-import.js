#!/usr/bin/env node
'use strict';
/**
 * Imports a Claude Code memory folder (default ~/.claude/projects/-home-kanmi-staticforge/memory/*.md) into
 * Fleet's shared memory (#1154). Idempotent: a memory is found again by its source `import:<file>` and updated.
 *   node scripts/fleet-memory-import.js [--dry-run] [--dir <folder>] [--repo staticforge] [--no-mirror]
 * Writes only the agent-coord DB (AGENT_COORD_DB) and the ~/fleet-memory mirror (FLEET_MEMORY_DIR).
 * type user | feedback -> preference / lesson, global, pinned; project -> decision / fact, repo:<repo>; reference -> fact, global.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const mem = require('../modules/agentCoord/memoryStore');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const dir = opt('--dir', path.join(os.homedir(), '.claude', 'projects', '-home-kanmi-staticforge', 'memory'));
const repo = opt('--repo', 'staticforge');
const dry = flag('--dry-run');

function parse(text) {
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
    if (!m) return { meta: {}, body: text.trim() };
    const meta = {};
    m[1].split('\n').forEach((l) => {
        const k = /^\s*([\w-]+):\s*(.*)$/.exec(l);
        if (k) meta[k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
    });
    return { meta, body: m[2].trim() };
}

function map(meta, body) {
    const type = (meta.type || '').toLowerCase();
    if (type === 'user') return { kind: 'preference', scope: 'global', pinned: true };
    if (type === 'feedback') return { kind: 'lesson', scope: 'global', pinned: true };
    if (type === 'reference') return { kind: 'fact', scope: 'global', pinned: false };
    const decision = /\b(decid|decision|chose|approved|plan:|agreed)/i.test(`${meta.description || ''} ${body.slice(0, 400)}`);
    return { kind: decision ? 'decision' : 'fact', scope: `repo:${repo}`, pinned: false };
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').sort();
const counts = { files: files.length, added: 0, updated: 0, same: 0, skipped: 0, byKind: {}, byScope: {} };
const skipped = [];
for (const f of files) {
    const { meta, body } = parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!body) { counts.skipped += 1; skipped.push(`${f}: empty`); continue; }
    const m = map(meta, body);
    const title = String(meta.description || meta.name || f.replace(/\.md$/, '')).replace(/\s+/g, ' ').slice(0, 160);
    const o = { scope: m.scope, title, body: `${body}\n\n(imported from memory file ${f}${meta.name ? `, name ${meta.name}` : ''})`.slice(0, 6000), kind: m.kind, tags: [meta.type || 'memory', meta.name || ''].filter(Boolean), source: `import:${f}`, author: 'import', pinned: m.pinned };
    if (mem.hasSecret(`${o.title}\n${o.body}`)) { counts.skipped += 1; skipped.push(`${f}: looks like it holds a secret`); continue; }
    counts.byKind[m.kind] = (counts.byKind[m.kind] || 0) + 1;
    counts.byScope[m.scope] = (counts.byScope[m.scope] || 0) + 1;
    if (dry) continue;
    try {
        const r = mem.upsertImported(o);
        counts[r.action === 'added' ? 'added' : r.action === 'updated' ? 'updated' : 'same'] += 1;
    } catch (e) { counts.skipped += 1; skipped.push(`${f}: ${e.message}`); }
}
if (!dry && !flag('--no-mirror')) { const s = mem.syncMirror({ message: 'import from the Claude Code memory folder' }); counts.mirror = s; }
console.log(JSON.stringify({ dryRun: dry, dir, counts, skipped }, null, 1));
