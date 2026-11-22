#!/usr/bin/env node
// Every Install / Apply / Restart button goes through one flow (#1022): serviceWorkerManager.updateAction says what
// waits and installUpdates installs it. Checks the decisions per state, and that the phone's update notification
// (wmShell updateNoteSpec) offers what the manager says - it once looked for a kind 'apply' that is never set and
// restarted the phone for a style update.
// Run: node scripts/test-update-install-flow.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function block(src, needles) {
    let idx = -1;
    for (const n of needles) { idx = src.indexOf(n); if (idx >= 0) break; }
    if (idx < 0) throw new Error(`missing ${needles[0].trim()}`);
    const start = idx + 1;
    const open = src.indexOf('{', src.indexOf(')', start));
    let depth = 0; let inStr = null; let esc = false;
    for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; continue; }
        if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
        if (ch === '{') depth += 1;
        else if (ch === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unbalanced');
}

const root = path.join(__dirname, '..');
const swmSrc = fs.readFileSync(path.join(root, 'public/scripts/comp/serviceWorkerManager.js'), 'utf8');
const shellSrc = fs.readFileSync(path.join(root, 'public/scripts/comp/wmShell.js'), 'utf8');

global.window = { uiShell: 'desktop' };
const Klass = new Function(`return class { ${['updateAction', 'installUpdates'].map((m) => block(swmSrc, [`\n    ${m}(`, `\n    async ${m}(`])).join('\n')} }`)();

function manager(state = {}) {
    const calls = [];
    const m = new Klass();
    Object.assign(m, {
        agentSession: false, isUpdating: false, servicePack: null, pendingApplyFiles: null, pendingUpdateKind: null,
        pendingUpdateFuse: false, pendingUpdateFilesTotal: 0, availableUpdates: [], dex: false, kindOf: 'restart'
    }, state);
    m.hasPendingUpdates = () => m.pendingUpdateFuse;
    m.availableUpdateCount = () => (m.availableUpdates.length ? 1 : 0);
    m.classifyStaticCacheUpdate = () => m.kindOf;
    m._isContinuityDexWindow = () => m.dex;
    m.forceRestart = (o) => calls.push(['forceRestart', o]);
    m.applyStaticCacheUpdate = async (files) => {
        calls.push(['apply', files.length]);
        m.pendingApplyFiles = null; m.pendingUpdateFuse = false; m.pendingUpdateKind = 'restart';
    };
    m.recordUpdateHistory = (row) => calls.push(['history', row.status]);
    m.installAvailableUpdates = async () => { calls.push(['installAvailable']); m.availableUpdates = []; };
    m.checkStaticFileUpdates = async () => calls.push(['check']);
    m.calls = calls;
    return m;
}

(async () => {
    const css = [{ url: '/css/a.css', hash: 'x' }];
    // nothing waits
    let m = manager();
    assert.strictEqual(m.updateAction(), null);
    assert.strictEqual(await m.installUpdates(), 'check');
    assert.strictEqual(await manager().installUpdates({ check: false }), null);
    // an agent session and a running download do nothing
    assert.strictEqual(manager({ agentSession: true }).updateAction(), null);
    m = manager({ isUpdating: true });
    assert.deepStrictEqual(m.updateAction(), { kind: 'busy' });
    assert.strictEqual(await m.installUpdates(), null);
    assert.deepStrictEqual(m.calls, []);

    // styles downloaded in "let me choose" (fuse tripped, kind css-only): installed live, never a restart
    m = manager({ pendingApplyFiles: css, pendingUpdateKind: 'css-only', pendingUpdateFuse: true });
    assert.strictEqual(m.updateAction().kind, 'apply');
    assert.strictEqual(await m.installUpdates(), 'applied');
    assert.deepStrictEqual(m.calls, [['apply', 1], ['history', 'Successful']]);

    // applied, with updates counted beside it: they install too
    m = manager({ pendingApplyFiles: css, pendingUpdateKind: 'apply-safe', pendingUpdateFuse: true, availableUpdates: css, kindOf: 'css-only' });
    await m.installUpdates();
    assert.deepStrictEqual(m.calls.map((c) => c[0]), ['apply', 'history', 'installAvailable']);

    // a restart owed: forceRestart, its options passed on
    m = manager({ pendingUpdateFuse: true, pendingUpdateKind: 'restart' });
    assert.strictEqual(m.updateAction().kind, 'restart');
    assert.strictEqual(await m.installUpdates({ restart: { confirmed: true } }), 'restart');
    assert.deepStrictEqual(m.calls, [['forceRestart', { confirmed: true }]]);
    // a service pack restarts
    assert.deepStrictEqual(manager({ servicePack: { label: 'SP1' } }).updateAction(), { kind: 'restart', upgrade: true });

    // counted updates on the desktop: download (the restart prompt follows), never a restart from here
    m = manager({ availableUpdates: css, kindOf: 'restart' });
    assert.deepStrictEqual(m.updateAction(), { kind: 'install', count: 1, restart: true });
    assert.strictEqual(await m.installUpdates(), 'install');
    assert.deepStrictEqual(m.calls, [['installAvailable']]);
    // ... on the phone: restart at once when they need one (#1014), download when they apply live
    window.uiShell = 'mobile';
    m = manager({ availableUpdates: css, kindOf: 'restart' });
    assert.strictEqual(await m.installUpdates(), 'restart');
    assert.deepStrictEqual(m.calls, [['forceRestart', {}]]);
    m = manager({ availableUpdates: css, kindOf: 'css-only' });
    assert.strictEqual(await m.installUpdates(), 'install');
    assert.deepStrictEqual(m.calls, [['installAvailable']]);
    window.uiShell = 'desktop';
    // a DeX window counting only the phone's files hands the install to the phone
    m = manager({ dex: true });
    m.availableUpdateCount = () => 3;
    assert.deepStrictEqual(m.updateAction(), { kind: 'install', count: 3, restart: true });

    // the phone's notification offers what the manager says
    const specFn = new Function('window', `${block(shellSrc, ['\n    function updateNoteSpec('])}; return updateNoteSpec;`);
    const w = { serviceWorkerManager: null };
    const spec = specFn(w);
    w.serviceWorkerManager = manager({ pendingApplyFiles: css, pendingUpdateKind: 'css-only', pendingUpdateFuse: true });
    let s = spec();
    assert.strictEqual(s.action.text, 'Install Now', 'a style update is installed, not restarted for');
    s.action.run();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepStrictEqual(w.serviceWorkerManager.calls.map((c) => c[0]), ['apply', 'history']);
    w.serviceWorkerManager = manager({ pendingUpdateFuse: true, pendingUpdateKind: 'restart', pendingUpdateFilesTotal: 4 });
    s = spec();
    assert.strictEqual(s.action.text, 'Restart Now');
    assert.ok(/4 files/.test(s.html));
    w.serviceWorkerManager = manager({ availableUpdates: css, kindOf: 'restart' });
    assert.ok(/restarts to install/.test(spec().html));
    w.serviceWorkerManager = manager();
    assert.strictEqual(spec(), null);
    w.serviceWorkerManager = manager({ isUpdating: true });
    assert.strictEqual(spec(), null);

    console.log('✅ test-update-install-flow: all assertions passed');
})().catch((err) => { console.error('❌ test-update-install-flow failed:', err); process.exit(1); });
