// A client never takes a changed asset in place (.cursor/rules/client-update-never-in-place.mdc, #1167).
// Fails if an update path could put a changed stylesheet or script into a running page, or if an update reply
// claims an asset went live without a reload.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const swm = read('public/scripts/comp/serviceWorkerManager.js');
const bridge = read('public/scripts/comp/agentClientBridge.js');
const sw = read('public/sw.js');
const cont = read('public/scripts/comp/melatonContinuity.js');

// 1. the banned paths are gone from the update code
for (const name of ['refreshStaticStylesheet', 'bumpStaticAssetReferences', 'applyStaticCacheUpdate', 'applySegmentUpdate',
    'isCssOnlyAutoApplyEnabled', 'isCssOnlyUpdate', 'isApplySafeUpdate', 'swapFeature']) {
    assert.ok(!new RegExp(`\\b${name}\\b`).test(swm.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')), `serviceWorkerManager.js has no ${name}`);
}
assert.ok(!/CSS_ONLY_AUTO_APPLY|cssOnlyAutoApply/.test(sw), 'sw.js has no CSS auto-apply');
assert.ok(!/relayApply|apply-update/.test(cont), 'melatonContinuity.js does not relay an apply to the DeX window');
// no update file rewrites or appends a loaded stylesheet / script
for (const [name, src] of [['serviceWorkerManager.js', swm], ['agentClientBridge.js', bridge], ['melatonContinuity.js', cont]]) {
    const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/link\[rel=["']?stylesheet["']?\][^\n]*\n?[^\n]*\.href\s*=(?!=)/.test(code), `${name} does not rewrite a stylesheet href`);
    assert.ok(!/\bfresh\b[^\n]*cloneNode|\.cloneNode\(false\)[^\n]*stylesheet|link\.after\(/.test(code), `${name} does not add a second sheet beside the live one`);
}

// 2. classifyStaticCacheUpdate has two answers only: restart (this page runs a changed file) and unused (it runs none)
const a = swm.indexOf('    classifyStaticCacheUpdate(files) {');
const classifySrc = swm.slice(a, swm.indexOf('\n    }\n', a) + 6).replace(/^    classifyStaticCacheUpdate\(files\) /, 'function classify(files) ');
const classify = (used) => new Function(`${classifySrc}; return classify;`)().bind({ filesUsedByPage: () => used });
const css = [{ url: '/css/a.css', hash: 'x' }];
const js = [{ url: '/scripts/comp/a.js', hash: 'y' }];
const pic = [{ url: '/static_images/a.png', hash: 'z' }];
for (const files of [css, js, pic, css.concat(js)]) {
    assert.strictEqual(classify(files)(files), 'restart', 'a changed file this page runs is a restart, whatever its kind');
    assert.strictEqual(classify([])(files), 'unused', 'files nothing here runs are only noted');
}
assert.strictEqual(classify([])([]), 'restart');

// 3. the update reply never claims an asset went live: settlePreparedClientUpdate says readyForRestart for every kind
const b = bridge.indexOf('    async function settlePreparedClientUpdate(');
const settleSrc = bridge.slice(b, bridge.indexOf('\n    }\n', b) + 6);
(async () => {
    for (const kind of ['restart', 'unused', 'css-only', 'apply-safe', 'segments']) {
        let applied = 0;
        const stubSw = { classifyStaticCacheUpdate: () => kind, applyStaticCacheUpdate: async () => { applied++; } };
        const settle = new Function('downloadCountsFromClientUpdate', 'clientUpdateStatusSnapshot', `${settleSrc}; return settlePreparedClientUpdate;`)(
            () => ({ filesDownloaded: 1, total: 1, stalled: false }), () => ({ pendingUpdateKind: 'restart' }));
        const r = await settle(stubSw, css, null);
        assert.strictEqual(r.readyForRestart, true, `${kind}: readyForRestart`);
        assert.strictEqual(r.alreadyCurrent, false, `${kind}: not already current`);
        assert.ok(!('appliedWithoutRestart' in r), `${kind}: no appliedWithoutRestart in the reply`);
        assert.strictEqual(applied, 0, `${kind}: nothing applied into the page`);
    }
    console.log('test-no-in-place-update: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
