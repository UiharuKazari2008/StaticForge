#!/usr/bin/env node
/**
 * Manifest helper for server transfer pack/unpack.
 * scripts/transfer-manifest.js write --root PATH --out FILE --mode data|full --prefix NAME -- [paths...]
 * scripts/transfer-manifest.js verify --root PATH --manifest FILE
 */

const fs = require('fs');
const path = require('path');

function walkFiles(root, relPath, entries) {
    const full = path.join(root, relPath);
    if (!fs.existsSync(full)) return;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
        for (const name of fs.readdirSync(full)) {
            walkFiles(root, path.join(relPath, name), entries);
        }
    } else {
        entries.push({
            path: relPath.split(path.sep).join('/'),
            bytes: st.size
        });
    }
}

function cmdWrite(argv) {
    let root = '';
    let out = '';
    let mode = 'data';
    let excludeImages = '0';
    let prefix = 'dreamscape-transfer';
    const paths = [];
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a === '--root') { root = argv[++i]; i++; continue; }
        if (a === '--out') { out = argv[++i]; i++; continue; }
        if (a === '--mode') { mode = argv[++i]; i++; continue; }
        if (a === '--exclude-images') { excludeImages = argv[++i]; i++; continue; }
        if (a === '--prefix') { prefix = argv[++i]; i++; continue; }
        if (a === '--') { i++; while (i < argv.length) paths.push(argv[i++]); break; }
        i++;
    }

    if (!root || !out) {
        console.error('write requires --root and --out');
        process.exit(1);
    }

    const entries = [];
    for (const p of paths) {
        walkFiles(root, p, entries);
    }

    if (mode === 'full') {
        const skip = new Set([
            'node_modules', '.git', 'images', '.previews', '.cache', 'logs'
        ]);
        function walkApp(dir, base) {
            for (const name of fs.readdirSync(dir)) {
                if (skip.has(name)) continue;
                if (name.startsWith('dreamscape-transfer-') && name.endsWith('.tar.zst')) continue;
                if (name.endsWith('.manifest.json')) continue;
                const full = path.join(dir, name);
                const rel = base ? `${base}/${name}` : name;
                const st = fs.statSync(full);
                if (st.isDirectory()) walkApp(full, rel);
                else entries.push({ path: `app/${rel}`, bytes: st.size });
            }
        }
        walkApp(root, '');
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
        format: 1,
        created: new Date().toISOString(),
        mode,
        excludeImages: excludeImages === '1',
        prefix,
        entries,
        totalBytes: entries.reduce((s, e) => s + e.bytes, 0)
    };
    fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
}

function cmdVerify(argv) {
    let root = '';
    let manifestPath = '';
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--root') root = argv[++i];
        if (argv[i] === '--manifest') manifestPath = argv[++i];
    }
    if (!root || !manifestPath) {
        console.error('verify requires --root and --manifest');
        process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let missing = 0;
    for (const e of manifest.entries) {
        let rel = e.path;
        if (rel.startsWith('app/')) rel = rel.slice(4);
        const full = path.join(root, rel);
        if (!fs.existsSync(full)) {
            console.warn(`missing: ${rel}`);
            missing++;
        }
    }
    if (missing) {
        console.error(`verify failed: ${missing} missing path(s)`);
        process.exit(1);
    }
    console.log(`verify ok (${manifest.entries.length} entries, ${manifest.totalBytes} bytes listed)`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'write') cmdWrite(rest);
else if (cmd === 'verify') cmdVerify(rest);
else {
    console.error('Usage: transfer-manifest.js write|verify ...');
    process.exit(1);
}
