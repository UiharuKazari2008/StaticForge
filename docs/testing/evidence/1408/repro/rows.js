'use strict';
// In this own test profile only: take the two splash pictures' rows out of static-cache-v2 (kept in a side
// cache), put them back, or list them.   node rows.js delete|restore|show
const { connect, evaluate, sleep, newPhoneTab, BASE_INIT } = require('./cdp');
const mode = process.argv[2] || 'show';
const JOB = `(async () => {
    const paths = ['/static_images/wm61/boot-melaton.png', '/static_images/melaton/cafe-ready-dark.png'];
    const c = await caches.open('static-cache-v2'), keep = await caches.open('r1408-side-cache');
    const out = {};
    for (const p of paths) {
        if (${JSON.stringify(mode)} === 'delete') { const r = await c.match(p, { ignoreVary: true }); if (r) { await keep.put(p, r); await c.delete(p, { ignoreVary: true }); } }
        if (${JSON.stringify(mode)} === 'restore') { const r = await keep.match(p); if (r) { await c.put(p, r); await keep.delete(p); } }
        const now = await c.match(p, { ignoreVary: true });
        out[p] = now ? { cached: true, xFileHash: (now.headers.get('x-file-hash') || '').slice(0, 16), bytes: (await now.arrayBuffer()).byteLength } : { cached: false };
    }
    return out;
})()`;
(async () => {
    const cdp = await connect();
    const tab = await newPhoneTab(cdp, BASE_INIT);
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9220/status' }, tab.sessionId);
    await sleep(1200);
    console.log(mode, JSON.stringify(await evaluate(cdp, tab.sessionId, JOB)));
    await cdp.send('Target.closeTarget', { targetId: tab.targetId });
    cdp.close();
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
