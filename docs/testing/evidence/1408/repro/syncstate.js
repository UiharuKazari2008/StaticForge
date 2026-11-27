'use strict';
// Is a preloaded picture already `complete` in the SAME task that builds its <img> with innerHTML on a detached
// element (buildBootLayers' way), or only a microtask / the load event later? Same-origin page, no app code.
const { connect, evaluate, sleep, newPhoneTab, BASE_INIT } = require('./cdp');
const JOB = `(async () => {
    const urls = ['/static_images/wm61/boot-melaton.png', '/static_images/melaton/cafe-ready-dark.png'];
    const make = async (url, preload) => {
        if (preload) await new Promise((r) => { const l = document.createElement('link'); l.rel = 'preload'; l.as = 'image'; l.href = url; l.onload = l.onerror = r; document.documentElement.appendChild(l); });
        const d = document.createElement('div');
        const state = (i) => ({ complete: i.complete, w: i.naturalWidth });
        d.innerHTML = '<img src="' + url + '" alt="">';
        const img = d.firstChild;
        const out = { preload, sameTaskDetached: state(img) };
        document.documentElement.appendChild(d);
        out.sameTaskAppended = state(img);
        await Promise.resolve(); await Promise.resolve();
        out.afterMicrotasks = state(img);
        await new Promise((r) => { if (img.complete && img.naturalWidth) r(); else img.onload = img.onerror = r; });
        out.afterLoad = state(img);
        d.remove();
        return out;
    };
    const res = {};
    res['boot-melaton.png preloaded'] = await make(urls[0], true);
    res['cafe-ready-dark.png not preloaded'] = await make(urls[1], false);
    return res;
})()`;
const JOB2 = JOB.replace("res['boot-melaton.png preloaded'] = await make(urls[0], true);\n    res['cafe-ready-dark.png not preloaded'] = await make(urls[1], false);",
    "res['cafe-ready-dark.png preloaded'] = await make(urls[1], true);\n    res['boot-melaton.png not preloaded'] = await make(urls[0], false);");
(async () => {
    const cdp = await connect();
    for (const job of [JOB, JOB2]) {
        const tab = await newPhoneTab(cdp, BASE_INIT);
        await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9220/status' }, tab.sessionId);
        await sleep(1500);
        console.log(JSON.stringify(await evaluate(cdp, tab.sessionId, job), null, 1));
        await cdp.send('Target.closeTarget', { targetId: tab.targetId });
    }
    cdp.close();
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
