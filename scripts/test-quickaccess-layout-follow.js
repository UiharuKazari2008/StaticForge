#!/usr/bin/env node
// StaticForge #1405: the kept Quick Access / Output panel layouts follow the Quick Access settings, also with Quick Access
// switched off. Pure checks of wmQuickAccess.signature() / roles() (what melatonBars' on-screen pass and its role list rely on),
// and of melatonBars' role refresh (withCurrentQa), read from the source. Run: node scripts/test-quickaccess-layout-follow.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let cfg = { enabled: false, layout: 'strip', side: 'right', columns: 1, zoneTop: 0.35, items: ['wifi', 'bluetooth', 'volume'] };
const win = {
    AndroidQuickAccess: { config: () => JSON.stringify(cfg), get: () => JSON.stringify({ items: {} }), catalog: () => JSON.stringify({}) },
    innerHeight: 800
};
win.window = win;
const doc = {
    getElementById: () => null,
    documentElement: { dataset: {}, addEventListener() {}, style: { getPropertyValue: () => '' } },
    body: {},
    addEventListener() {},
    visibilityState: 'visible'
};
const ctx = vm.createContext(Object.assign(win, {
    document: doc,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class { observe() {} disconnect() {} },
    console
}));
vm.runInContext(read('public/scripts/comp/wmOutputPanel.js'), ctx, { filename: 'wmOutputPanel.js' });
vm.runInContext(read('public/scripts/comp/wmQuickAccess.js'), ctx, { filename: 'wmQuickAccess.js' });
const qa = win.wmQuickAccess;
assert(qa && win.wmOutputPanel, 'modules loaded');

const sig = () => qa.signature();
const outputs = Array.from({ length: 9 }, (_, i) => `output.${i}`);
const same = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
const set = (c) => { cfg = Object.assign({}, cfg, c); };

// roles: with Quick Access off only the Output panel's, whatever "Show as" says; no qatab, no quickaccess*
for (const layout of ['strip', 'wide']) {
    set({ enabled: false, layout });
    same(qa.roles(), outputs, `off, ${layout}: output roles only`);
}
set({ enabled: true, layout: 'wide' });
same(qa.roles(), ['qatab', 'quickaccess'].concat(outputs), 'on, wide: tab, one page, outputs');
set({ enabled: true, layout: 'strip' });
assert(qa.roles().includes('qatab') && qa.roles().includes('quickaccess'), 'on, strip: tab and first page');

// signature (the on-screen pass's key): changes with enabled, layout, side, columns, also while off
const base = { enabled: false, layout: 'strip', side: 'right', columns: 1 };
set(base);
const s0 = sig();
for (const [k, v] of [['enabled', true], ['layout', 'wide'], ['side', 'left'], ['columns', 2]]) {
    set(base);
    set({ [k]: v });
    assert.notStrictEqual(sig(), s0, `signature changes with ${k}`);
}
// the one-save change of the evidence (wide + on -> strip + off) is a different signature too
set({ enabled: true, layout: 'wide', side: 'right', columns: 1 });
const wideOn = sig();
set({ enabled: false, layout: 'strip' });
assert.notStrictEqual(sig(), wideOn, 'wide+on -> strip+off changes the signature');

// an Output panel role's signature follows layout, side and columns (its layout depends on them), with Quick Access off
set(base);
const o0 = qa.signature('output.1');
for (const [k, v] of [['layout', 'wide'], ['side', 'left'], ['columns', 2]]) {
    set(base);
    set({ [k]: v });
    assert.notStrictEqual(qa.signature('output.1'), o0, `output.1 signature changes with ${k}`);
}

// melatonBars: the roles asked for again take Quick Access's current roles (source checks)
const mb = read('public/scripts/comp/melatonBars.js');
assert(/function withCurrentQa\(roles\)/.test(mb), 'withCurrentQa exists');
assert(/if \(!partial\) \{ roles = withCurrentQa\(roles\); layoutsRoles = roles; \}/.test(mb), 'full pushes use the current Quick Access roles');
assert(/quickAccessChanged: \(\) => qaNow\(\)/.test(mb), 'quickAccessChanged runs at once');
// the same function, run on its own
const fn = /const QA_ROLE = [^\n]+\n[\s\S]*?function withCurrentQa\(roles\) \{[\s\S]*?\n    \}\n/.exec(mb)[0];
const w = vm.runInContext(`(function () { ${fn}; return withCurrentQa; })()`, ctx);
set({ enabled: false, layout: 'strip' });
const stale = ['data', 'battery', 'qatab', 'quickaccess', 'quickaccess.2', 'output.0', 'output.1'];
same(w(stale), ['data', 'battery'].concat(outputs), 'stale tab / pages dropped, the outputs and the bar kept');
set({ enabled: true, layout: 'wide' });
same(w(['data', 'output.3']), ['data', 'qatab', 'quickaccess'].concat(outputs), 'Quick Access on: its roles come back');
// wmShell: Settings' commit (no argument) runs with Quick Access off; only the start timer keeps the early return
const sh = read('public/scripts/comp/wmShell.js');
assert(/function quickAccessLayouts\(atStart\)/.test(sh), 'quickAccessLayouts takes atStart');
assert(/if \(atStart\) \{ try \{ if \(!JSON\.parse\(q\.config\(\)\)\.enabled\) return; \}/.test(sh), 'only the start returns early with Quick Access off');
assert(/setTimeout\(\(\) => quickAccessLayouts\(true\), 8000\)/.test(sh), 'the start timer passes atStart');
assert(/quickAccessLayouts: \(\) => quickAccessLayouts\(\)/.test(sh), 'the exported call (Settings) passes nothing');
console.log('test-quickaccess-layout-follow: ok');
