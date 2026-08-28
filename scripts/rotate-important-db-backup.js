#!/usr/bin/env node
/**
 * Rotating SQLite backups for important Dreamscape/.cache databases.
 * Skips huge image/wiki caches (tag_wiki, metadata, director, replication dumps).
 *
 * Usage:
 *   node scripts/rotate-important-db-backup.js
 *   node scripts/rotate-important-db-backup.js --keep 2
 *   node scripts/rotate-important-db-backup.js --include-large
 *
 * Destination: .cache/db-backups/<UTC-stamp>/
 * Keeps the newest --keep stamp dirs (default 2).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const OUT_ROOT = path.join(CACHE, 'db-backups');

const CORE = [
    'application_auth.db',
    'sessions/sessions.sqlite',
    'vfs.db',
    'notes.db',
    'characters.db',
    'knowledge_memory.db',
    'generation_quips.db',
    'wiki/fandom-graph.db',
    'nax_tags.db',
    'dev_bridge.db',
    'cache_metadata.db',
    'replication_asset_registry.db'
];

const LARGE_OPTIONAL = [
    'chat.db',
    'tag_search.db',
    'emphasis_segment_index.db'
];

function parseArgs(argv) {
    let keep = 2;
    let includeLarge = false;
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--keep' && argv[i + 1]) keep = Math.max(1, Number(argv[++i]) || 2);
        else if (argv[i] === '--include-large') includeLarge = true;
        else if (argv[i] === '--help' || argv[i] === '-h') {
            console.log('Usage: node scripts/rotate-important-db-backup.js [--keep N] [--include-large]');
            process.exit(0);
        }
    }
    return { keep, includeLarge };
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function sqliteBackup(src, dest) {
    ensureDir(path.dirname(dest));
    // Pass path via JS string in sqlite3; JSON.stringify quotes safely for the SQL literal.
    const sql = `.backup ${JSON.stringify(dest)}`;
    const cli = spawnSync('sqlite3', [src, sql], { encoding: 'utf8' });
    if (cli.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        return { ok: true, method: 'sqlite3' };
    }
    fs.copyFileSync(src, dest);
    for (const suffix of ['-wal', '-shm']) {
        const side = src + suffix;
        if (fs.existsSync(side)) fs.copyFileSync(side, dest + suffix);
    }
    return {
        ok: true,
        method: 'copy',
        warn: (cli.stderr || (cli.error && cli.error.message)) || null
    };
}

function rotate(keep) {
    if (!fs.existsSync(OUT_ROOT)) return [];
    const dirs = fs.readdirSync(OUT_ROOT)
        .filter((name) => fs.statSync(path.join(OUT_ROOT, name)).isDirectory())
        .sort();
    const removed = [];
    while (dirs.length > keep) {
        const old = dirs.shift();
        fs.rmSync(path.join(OUT_ROOT, old), { recursive: true, force: true });
        removed.push(old);
    }
    return removed;
}

function main() {
    const { keep, includeLarge } = parseArgs(process.argv);
    const list = includeLarge ? CORE.concat(LARGE_OPTIONAL) : CORE.slice();
    const destDir = path.join(OUT_ROOT, stamp());
    ensureDir(destDir);
    const results = [];
    for (const rel of list) {
        const src = path.join(CACHE, rel);
        if (!fs.existsSync(src)) {
            results.push({ rel, skipped: 'missing' });
            continue;
        }
        const dest = path.join(destDir, rel.replace(/\//g, '__'));
        try {
            const info = sqliteBackup(src, dest);
            results.push({
                rel,
                size: fs.statSync(dest).size,
                method: info.method,
                warn: info.warn || null
            });
        } catch (err) {
            results.push({ rel, error: err.message });
        }
    }
    const removed = rotate(keep);
    const manifest = {
        createdAt: new Date().toISOString(),
        destDir,
        keep,
        includeLarge,
        removed,
        results
    };
    fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify(manifest, null, 2));
}

main();
