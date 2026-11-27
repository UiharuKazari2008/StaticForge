'use strict';
// Puts one variant of the client files into THIS own browser profile's Cache Storage (nothing leaves the
// browser; the server is not touched). Variants: old (the server's own bytes), new (the tree: JS, 2 CSS and the
// app.html block), nopreload (new JS and CSS, old app.html: what the badge's load gate does without the preload).
//   CDP_PORT=n node swap.js old|new|nopreload [--check]     (--check only reports what the cache holds)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { connect, evaluate, sleep, newPhoneTab, BASE_INIT } = require('./cdp');
const BUILD = `${process.env.HOME}/.cache/claude-run/1408/build`;
const manifest = JSON.parse(fs.readFileSync(`${BUILD}/manifest.json`));
const ANCHOR = '            if (wmBars) document.documentElement.dataset.wmBars = wmBars;\n';

function want(variant) {
    const set = variant === 'old' ? 'old' : 'new';
    const files = Object.entries(manifest.files).map(([web, e]) => {
        const body = fs.readFileSync(path.join(BUILD, set, path.basename(web)), 'utf8');
        const hash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
        if (hash !== e[set]) throw new Error(`build changed under us: ${web}`);
        return { web, body, hash };
    });
    let app = fs.readFileSync(`${BUILD}/served-app.html`, 'utf8');
    for (const f of files) app = app.split(`${f.web.slice(1)}?sha=${manifest.files[f.web].old}`).join(`${f.web.slice(1)}?sha=${f.hash}`);
    if (variant === 'new') app = app.replace(ANCHOR, ANCHOR + fs.readFileSync(`${BUILD}/preload-block.html`, 'utf8'));
    return { files, app, appSha: crypto.createHash('sha256').update(app, 'utf8').digest('hex') };
}

const JOB = (w, write) => `(async () => {
    const W = ${JSON.stringify(w)};
    const hex = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const statics = await caches.open('static-cache-v2'), shells = await caches.open('melaton-launch-shell-v1'), code = await caches.open('script-code-cache-v1');
    const out = { rewritten: [], files: {} };
    for (const f of W.files) {
        const row = await statics.match(f.web, { ignoreVary: true });
        const now = row ? await hex(await row.clone().text()) : null;
        if (${write} && now !== f.hash) {
            const h = new Headers(row.headers);
            const oldHash = h.get('x-file-hash');
            h.set('x-file-hash', f.hash);
            h.set('content-length', String(new TextEncoder().encode(f.body).length));
            const tag = h.get('etag'); if (tag && oldHash && tag.includes(oldHash)) h.set('etag', tag.split(oldHash).join(f.hash));
            await statics.put(f.web, new Response(f.body, { status: 200, headers: h }));
            for (const k of await code.keys()) if (new URL(k.url).pathname === f.web) await code.delete(k);
            out.rewritten.push(f.web);
        }
        const after = await statics.match(f.web, { ignoreVary: true });
        const bodySha = await hex(await after.clone().text());
        out.files[f.web] = { asWanted: bodySha === f.hash && after.headers.get('x-file-hash') === f.hash, bodySha: bodySha.slice(0, 16) };
    }
    const kept = await shells.match('/app');
    const nowApp = kept ? await kept.clone().text() : '';
    if (${write} && (await hex(nowApp)) !== W.appSha) {
        const h = new Headers(kept.headers); h.delete('content-length');
        await shells.put('/app', new Response(W.app, { status: 200, headers: h }));
        out.rewritten.push('/app');
    }
    if (${write}) for (const k of ['/app.next', '/app.next-missing']) await shells.delete(k);
    const a = await (await shells.match('/app')).text();
    out.app = { asWanted: (await hex(a)) === W.appSha, hasPreloadBlock: a.includes('const splashArt'), names: W.files.every((f) => a.includes(f.web.slice(1) + '?sha=' + f.hash)) };
    return out;
})()`;

async function swap(cdp, variant, write) {
    const w = want(variant);
    const tab = await newPhoneTab(cdp, BASE_INIT);
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9220/status' }, tab.sessionId);
    await sleep(900);
    const res = await evaluate(cdp, tab.sessionId, JOB(w, write));
    await cdp.send('Target.closeTarget', { targetId: tab.targetId });
    res.ok = res.app.asWanted && res.app.names && Object.values(res.files).every((f) => f.asWanted);
    res.variant = variant;
    res.expected = { files: Object.fromEntries(w.files.map((f) => [f.web, f.hash])), preloadBlock: variant === 'new' };
    return res;
}

module.exports = { swap, want };
if (require.main === module) {
    (async () => {
        const cdp = await connect();
        const r = await swap(cdp, process.argv[2], !process.argv.includes('--check'));
        delete r.expected;
        console.log(JSON.stringify(r));
        cdp.close();
        process.exit(r.ok ? 0 : 1);
    })().catch((e) => { console.error(e.message); process.exit(1); });
}
