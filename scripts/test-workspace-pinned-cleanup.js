/**
 * Equivalence test: pinned cleanup in WorkspaceManager._legacySyncWorkspacePinnedScrapsJson
 * must leave the same pinned lists and emit the same pin changes as origin/main's version.
 * Credit: grok.menma (Jules session 11768727937177017258)
 * Run: node scripts/test-workspace-pinned-cleanup.js [base-ref]   (default origin/main)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');

const origLoad = Module._load;
Module._load = function (request) {
    if (['sharp', 'better-sqlite3', 'sqlite3', 'winston'].includes(request)) return {};
    return origLoad.apply(this, arguments);
};
const quiet = console.log; console.log = () => {};

const root = path.join(__dirname, '..');
const baseRef = process.argv[2] || 'origin/main';
const baseFile = path.join(root, 'modules', `.workspace-base-${process.pid}.js`);
fs.writeFileSync(baseFile, execFileSync('git', ['show', `${baseRef}:modules/workspace.js`], { cwd: root }));
let BaseWM, NewWM;
try {
    BaseWM = require(baseFile);
    NewWM = require(path.join(root, 'modules', 'workspace.js'));
} finally { fs.unlinkSync(baseFile); }

function run(WM, workspaces) {
    let pins = null;
    const res = {
        getWorkspacesConfig: () => workspaces, saveConfig: () => {}, getMetadataDatabase: () => null,
        modifyConfig: () => ({ merge: () => {}, delete: () => {} }), getPath: () => '/tmp', ensureDirectoryExists: () => {}
    };
    const m = new WM(res);
    m._queueGalleryOwnershipAndPinSync = (_o, p) => { pins = p || []; };
    m._legacySyncWorkspacePinnedScrapsJson();
    return { pinned: Object.fromEntries(Object.entries(workspaces).map(([k, w]) => [k, w.pinned])), pins };
}

let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
function fixture() {
    const ws = {}; const nW = 1 + rnd(4); const nF = 2 + rnd(12);
    for (let i = 0; i < nW; i++) {
        const files = [], pinned = [];
        for (let f = 0; f < nF; f++) { if (rnd(3) === 0) files.push('f' + f); if (rnd(3) === 0) pinned.push('f' + f); }
        if (rnd(2)) pinned.push('f' + rnd(nF));            // duplicates
        ws['ws' + i] = { name: 'W' + i, files, ...(rnd(5) ? { pinned } : {}) };
    }
    return ws;
}

const cases = [{
    ws1: { name: 'W1', files: ['f1'], pinned: ['f1', 'f2', 'f3', 'f4', 'f5', 'f2'] },
    ws2: { name: 'W2', files: ['f2', 'f4', 'f5'], pinned: ['f4', 'f5'] },
    ws3: { name: 'W3', files: ['f3x'] }
}];
for (let i = 0; i < 500; i++) cases.push(fixture());

cases.forEach((c, i) => {
    const a = run(BaseWM, JSON.parse(JSON.stringify(c)));
    const b = run(NewWM, JSON.parse(JSON.stringify(c)));
    assert.deepStrictEqual(b.pinned, a.pinned, `case ${i}: pinned lists differ`);
    assert.deepStrictEqual(b.pins, a.pins, `case ${i}: pin changes differ`);
});
console.log = quiet;
console.log(`ok - ${cases.length} fixtures: pinned lists and pin changes match ${baseRef}`);
