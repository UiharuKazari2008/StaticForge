#!/usr/bin/env node
/*
 * CaféReady tasks into the Android app (#908, rule cafeready-background): copies public/scripts/tasks (the files
 * manifest.json lists) into DSApp-Kotlin's app/src/main/assets/cafe-tasks, with a manifest naming each file's
 * sha256 and the StaticForge commit it came from. The app runs only this bundled copy, so a task change reaches
 * phones with an app build, never behind its back.
 *
 *   node scripts/sync-cafe-tasks.js --dsapp <DSApp tree>          copy (then commit it in DSApp)
 *   node scripts/sync-cafe-tasks.js --dsapp <DSApp tree> --check  exit 1 when the app's copy differs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const tree = arg('--dsapp');
const check = process.argv.includes('--check');
if (!tree) { console.error('usage: sync-cafe-tasks.js --dsapp <DSApp tree> [--check]'); process.exit(2); }

const src = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
const dst = path.join(tree, 'app', 'src', 'main', 'assets', 'cafe-tasks');
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const files = manifest.files.map((f) => ({ name: f, data: fs.readFileSync(path.join(src, f)) }));

if (check) {
    let bad = 0;
    let have = null;
    try { have = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8')); } catch (_) { have = null; }
    if (!have) { console.error(`cafe-tasks: ${dst} has no manifest`); process.exit(1); }
    files.forEach((f) => {
        const h = (have.sha256 || {})[f.name];
        if (h !== sha(f.data)) { bad++; console.error(`cafe-tasks: ${f.name} differs from the app's copy`); }
    });
    if (have.api !== manifest.api) { bad++; console.error(`cafe-tasks: api ${have.api} in the app, ${manifest.api} here`); }
    if (bad) { console.error('cafe-tasks: run scripts/sync-cafe-tasks.js --dsapp <tree> and commit it in DSApp'); process.exit(1); }
    console.log('cafe-tasks: the app has this copy');
    process.exit(0);
}

let commit = '';
try { commit = execFileSync('git', ['-C', path.join(__dirname, '..'), 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) { commit = ''; }
fs.mkdirSync(dst, { recursive: true });
fs.readdirSync(dst).forEach((f) => { if (!manifest.files.includes(f) && f !== 'manifest.json') fs.unlinkSync(path.join(dst, f)); });
files.forEach((f) => fs.writeFileSync(path.join(dst, f.name), f.data));
const out = Object.assign({}, manifest, { source: `StaticForge ${commit}`, sha256: Object.fromEntries(files.map((f) => [f.name, sha(f.data)])) });
fs.writeFileSync(path.join(dst, 'manifest.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`cafe-tasks: ${files.length} files -> ${dst}`);
