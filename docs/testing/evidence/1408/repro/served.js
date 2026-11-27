'use strict';
// Which code did this browser get? Reads the kept /app shell and the cached wmShell.js, and looks for the
// #1408 edits another agent makes in the shared tree while this measurement runs. Prints no page content.
const { connect, evaluate, sleep, newPhoneTab, BASE_INIT } = require('./cdp');

const PROBE = `(async () => {
    const out = {};
    const shell = await caches.open('melaton-launch-shell-v1');
    for (const k of (await shell.keys())) {
        const t = await (await shell.match(k)).text();
        const m = /scripts\\/comp\\/wmShell\\.js\\?sha=([0-9a-f]+)/.exec(t);
        out[new URL(k.url).pathname] = { bytes: t.length, has1408preload: t.includes('splashArt'), wmShellSha: m ? m[1].slice(0, 16) : null,
            scripts: (t.match(/<script\\b[^>]*\\bsrc=/g) || []).length };
    }
    const c = await caches.open('static-cache-v2');
    const w = await c.match('/scripts/comp/wmShell.js', { ignoreVary: true });
    if (w) { const t = await w.text(); out.wmShellRow = { hash: (w.headers.get('x-file-hash') || '').slice(0, 16), has1408: t.includes('#1408'), imgHasWidth: t.includes('boot-melaton.png" width=') }; }
    for (const p of ['/static_images/wm61/boot-melaton.png', '/static_images/melaton/cafe-ready-dark.png']) {
        const r = await c.match(p, { ignoreVary: true });
        out[p] = r ? { status: r.status, bytes: (await r.arrayBuffer()).byteLength, type: r.headers.get('content-type'), hash: (r.headers.get('x-file-hash') || '').slice(0, 16) } : null;
    }
    out.staticRows = (await c.keys()).length;
    return out;
})()`;

(async () => {
    const cdp = await connect();
    const tab = await newPhoneTab(cdp, BASE_INIT);
    // a same-origin page that runs no app code
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9220/status' }, tab.sessionId);
    await sleep(1500);
    console.log(JSON.stringify(await evaluate(cdp, tab.sessionId, PROBE), null, 1));
    console.log('browser', cdp.version);
    await cdp.send('Target.closeTarget', { targetId: tab.targetId });
    cdp.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
