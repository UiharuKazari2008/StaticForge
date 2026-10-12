#!/usr/bin/env node
// Restart paths (Yozora #420): modalUtils restartClientNavigate / runClientRestartSequence and
// serviceWorkerManager.forceRestart, lifted from the sources into a vm sandbox.
// Desktop restarts fade out through the shutdown sequence and reboot via /launch (Melaton
// boot); narrow mode reloads; agent test restarts ({ direct: true }) reload in place.
// Run: node scripts/test-melaton-restart.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function lift(src, name, { method = false } = {}) {
    const needles = method
        ? [`\n    ${name}(`, `\n    async ${name}(`]
        : [`\nfunction ${name}(`, `\nasync function ${name}(`];
    const at = needles.map((n) => src.indexOf(n)).find((i) => i >= 0);
    assert.ok(at >= 0, `missing ${name}`);
    let depth = 0;
    let quote = null;
    // body brace: after the parameter list (a default like `options = {}` has braces too)
    for (let i = src.indexOf(') {', at) + 2; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depth++;
        if (ch === '}' && --depth === 0) {
            const text = src.slice(at + 1, i + 1).trim();
            return method ? (text.startsWith('async ') ? `async function ${text.slice(6)}` : `function ${text}`) : text;
        }
    }
    throw new Error(`unbalanced ${name}`);
}

const modalSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/modalUtils.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/serviceWorkerManager.js'), 'utf8');

function sandbox({ isDesktop = true, initialized = true } = {}) {
    const log = [];
    const ctx = {
        console: { log() {}, error() {} },
        setTimeout: (fn) => { log.push('timer'); fn(); },
        bypassConfirmation: false,
        suppressWebSocketReconnectForReload: () => log.push('suppress'),
        runClientShutdownSequence: async (finalAction) => { log.push('shutdown-fade'); finalAction(); },
        location: { replace: (url) => log.push(`replace:${url}`), reload: () => log.push('reload') },
        alert: () => log.push('alert')
    };
    ctx.window = ctx;
    ctx.isDesktop = isDesktop;
    ctx.wsClient = { initializationCompleted: initialized };
    vm.createContext(ctx);
    vm.runInContext([
        lift(modalSrc, 'restartClientNavigate'),
        lift(modalSrc, 'runClientRestartSequence'),
        'window.restartClientNavigate = restartClientNavigate;',
        'window.runClientRestartSequence = runClientRestartSequence;',
        `var forceRestart = ${lift(swSrc, 'forceRestart', { method: true })};`
    ].join('\n'), ctx);
    const sw = { resetPendingUpdateFuse: () => log.push('fuse-reset') };
    return { ctx, log, forceRestart: (opts) => ctx.forceRestart.call(sw, opts) };
}

(async () => {
    // restartClientNavigate: desktop → /launch, narrow → reload; reconnect suppressed, no prompt
    let s = sandbox();
    s.ctx.restartClientNavigate();
    assert.deepStrictEqual(s.log, ['suppress', 'replace:/launch']);
    assert.strictEqual(s.ctx.bypassConfirmation, true);
    s = sandbox({ isDesktop: false });
    s.ctx.restartClientNavigate();
    assert.deepStrictEqual(s.log, ['suppress', 'reload']);

    // Restart button: shutdown fade first, then the Melaton boot
    s = sandbox();
    await s.ctx.runClientRestartSequence();
    assert.deepStrictEqual(s.log, ['shutdown-fade', 'suppress', 'replace:/launch']);

    // forceRestart with the desktop up: the same Windows restart
    s = sandbox();
    s.forceRestart();
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(s.log, ['fuse-reset', 'suppress', 'shutdown-fade', 'suppress', 'replace:/launch']);

    // during boot (nothing to close): straight to /launch
    s = sandbox({ initialized: false });
    s.forceRestart();
    assert.deepStrictEqual(s.log, ['fuse-reset', 'suppress', 'timer', 'suppress', 'replace:/launch']);

    // narrow mode: reload in place
    s = sandbox({ isDesktop: false });
    s.forceRestart();
    assert.deepStrictEqual(s.log, ['fuse-reset', 'suppress', 'timer', 'suppress', 'reload']);

    // agent test restart: direct reload, no fade, no /launch
    s = sandbox();
    s.forceRestart({ direct: true });
    assert.deepStrictEqual(s.log, ['fuse-reset', 'suppress', 'timer', 'reload']);

    // the agent bridge asks for the direct path; the System Update dialog does not
    const bridge = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/agentClientBridge.js'), 'utf8');
    assert.ok(/restartClientFromCommand[\s\S]{0,400}forceRestart\(\{ direct: true \}\)/.test(bridge), 'agent restart_client stays a direct reload');
    const dialog = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/agentClientUpdateDialog.js'), 'utf8');
    assert.ok(/sw\.forceRestart\(\);/.test(dialog), 'System Update dialog restarts like Windows');

    console.log('✅ test-melaton-restart: all assertions passed');
})().catch((err) => {
    console.error('❌ test-melaton-restart failed:', err);
    process.exit(1);
});
