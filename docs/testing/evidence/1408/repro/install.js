'use strict';
// Sign the own test browser in through the dev login (key read at run time, sent only with the /agent load,
// never printed) and let /launch install Melaton Mobile, so later boots run with the service worker installed.
const fs = require('fs');
const { connect, evaluate, sleep, newPhoneTab, BASE_INIT } = require('./cdp');
const ORIGIN = 'http://127.0.0.1:9220';

const STATE = `(async () => {
    let rows = -1; const have = {};
    try {
        const c = await caches.open('static-cache-v2');
        rows = (await c.keys()).length;
        for (const p of ['/static_images/wm61/boot-melaton.png', '/static_images/melaton/cafe-ready-dark.png']) have[p.split('/').pop()] = !!(await c.match(p, { ignoreVary: true }));
    } catch (_) {}
    return { path: location.pathname, boot: document.documentElement.dataset.wmBoot || '', hash: !!localStorage.getItem('melatonManifestHash'),
        sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), rows, have };
})()`;

(async () => {
    const cdp = await connect();
    const tab = await newPhoneTab(cdp, BASE_INIT);
    const s = tab.sessionId;
    const key = fs.readFileSync(`${process.env.HOME}/.secrets/dreamscape-dev-login.key`, 'utf8').trim();
    await cdp.send('Network.setExtraHTTPHeaders', { headers: { Authorization: `Bearer ${key}`, 'X-Forwarded-Proto': 'https' } }, s);
    await cdp.send('Page.navigate', { url: `${ORIGIN}/agent` }, s);
    await sleep(3000);
    await cdp.send('Network.setExtraHTTPHeaders', { headers: {} }, s);
    await cdp.send('Page.navigate', { url: `${ORIGIN}/launch` }, s);
    const t0 = Date.now();
    let last = '';
    let doneSince = 0;
    while (Date.now() - t0 < 420000) {
        await sleep(4000);
        let st;
        try { st = await evaluate(cdp, s, STATE, 8000); } catch (e) { st = { err: e.message.slice(0, 80) }; }
        const line = JSON.stringify(st);
        if (line !== last) { console.log(`${Math.round((Date.now() - t0) / 1000)}s ${line}`); last = line; }
        const done = st.path === '/app' && st.boot === 'done' && st.hash && st.have && st.have['boot-melaton.png'] && st.have['cafe-ready-dark.png'];
        if (done && !doneSince) doneSince = Date.now();
        if (doneSince && Date.now() - doneSince > 20000) break;
    }
    await cdp.send('Target.closeTarget', { targetId: tab.targetId });
    cdp.close();
    process.exit(doneSince ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
