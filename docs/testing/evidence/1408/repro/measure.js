'use strict';
// One measured boot of the installed phone client (#1408). Reads only; writes <out>/<label>.json and, with
// --shots, screencast frames. Options:
//   --label x        name of the run
//   --rate N         CDP CPU throttling of the page's renderer main thread (1 = none)
//   --keepsw         do not stop the service worker before the boot (default: stop it, as a cold app start)
//   --preload        inject <link rel=preload as=image> for the two pictures before any page script (CDP only)
//   --showcafe       unhide the splash's CafeReady badge (this browser has no Café Miniport)
//   --net art-fail   the two pictures fail on the network (service worker target + browser cache off for them)
//   --net offline    the whole network is offline for the page and the service worker
//   --shots          record screencast frames and keep the ones around the splash art
//   --stall ms       ARTIFICIAL: busy-loop the page's main thread for ms right after the splash is inserted
//   --out dir        (default ./runs)      --shotdir dir (frames; default <out>/frames-<label>)
//   --variant v      old|new|nopreload (swap.js): checked and, if needed, put back before the boot; checked after
//   --miniport m     early|late: window.AndroidMiniport stub before page scripts (the app's bridge). It only answers
//                    the page's own "hello" with a link-up state (early: next task; late: 600 ms after the splash
//                    is inserted), so melatonContinuity.miniport() says "up" by the page's own code. none: no stub
//   --wm 6.1|6.5     localStorage wmVersion for this boot
//   --bogus-preload  positive control: also preload a picture nothing uses, to see Chrome's warning be caught
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('/home/kanmi/staticforge/node_modules/sharp');
const { connect, evaluate, sleep, newPhoneTab, BASE_INIT } = require('./cdp');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const flag = (n) => process.argv.includes(`--${n}`);
const label = arg('label', 'run');
const rate = Number(arg('rate', 1));
const net = arg('net', 'normal');
const outDir = path.resolve(arg('out', path.join(__dirname, 'runs')));
const shotDir = path.resolve(arg('shotdir', path.join(outDir, `frames-${label}`)));
const ORIGIN = 'http://127.0.0.1:9220';
const ART = ['/static_images/wm61/boot-melaton.png', '/static_images/melaton/cafe-ready-dark.png'];
const wmVer = arg('wm', '6.1');
if (wmVer === '6.5') ART[0] = '/static_images/melaton/melaton-white-256.png';
const variant = arg('variant', null);
const miniportMode = arg('miniport', 'none');
const BOGUS = '/static_images/melaton/cafe-ready-bios.png';
const isArt = (u) => ART.find((p) => u.split('?')[0].endsWith(p));
const short = (p) => p.split('/').pop();

const PROBE_INIT = (opts) => `(() => {
    if (window !== top) return;
    const R = window.__r1408 = { ev: [], longtasks: [], box: null };
    const ev = (k, d) => R.ev.push([Math.round(performance.now()), k, String(d == null ? '' : d)]);
    try { performance.setResourceTimingBufferSize(20000); } catch (_) {}
    const NAMES = ${JSON.stringify(ART.map(short))};
    // the app's Café Miniport bridge, as little of it as the badge needs: the page's own hello is answered with the
    // link's state through the page's own onmessage. Its socket ops stay unanswered, so no socket reaches the server
    let splashSeen = null;
    if (${JSON.stringify(opts.miniport)} !== 'none') {
        const bridge = { onmessage: null, postMessage(text) {
            let m = null; try { m = JSON.parse(text); } catch (_) { return; }
            if (!m || m.op !== 'hello') return;
            const deliver = () => { ev('miniport-state-delivered', 'handler=' + (typeof bridge.onmessage)); if (bridge.onmessage) bridge.onmessage({ data: JSON.stringify({ op: 'state', connected: true, enabled: true }) }); };
            if (${JSON.stringify(opts.miniport)} === 'late') splashSeen = () => setTimeout(deliver, 600); else setTimeout(deliver, 0);
        } };
        window.AndroidMiniport = bridge;
    }
    if (${opts.bogus}) { const mo = new MutationObserver(() => { if (!document.head) return; mo.disconnect(); const l = document.createElement('link'); l.rel = 'preload'; l.as = 'image'; l.href = '${BOGUS}'; l.dataset.r1408 = 'bogus'; document.head.appendChild(l); }); mo.observe(document, { childList: true, subtree: true }); }
    const linkState = () => { try { const x = window.melatonContinuity.miniport(); return 'present=' + x.present + ' enabled=' + x.enabled + ' up=' + x.up; } catch (_) { return 'no melatonContinuity.miniport'; } };
    const seen = new WeakSet();
    const watch = (img) => {
        if (seen.has(img)) return;
        const name = NAMES.find((n) => (img.getAttribute('src') || '').includes(n));
        if (!name || !img.closest('.wm-splash')) return;
        seen.add(img);
        // which code is running: the preload links the PAGE made (not the test's), and the imgs' own attributes
        if (name === NAMES[0]) {
            R.version = { pagePreloads: [...document.querySelectorAll('link[rel=preload][as=image]')].filter((l) => !l.dataset.r1408 && NAMES.some((n) => (l.getAttribute('href') || '').includes(n))).map((l) => l.getAttribute('href').split('/').pop() + ' fetchpriority=' + l.getAttribute('fetchpriority')),
                imgAttrs: [...img.closest('.wm-splash').querySelectorAll('img')].map((i) => i.getAttribute('src').split('/').pop() + ' width=' + i.getAttribute('width') + ' height=' + i.getAttribute('height')) };
            ev('link-at-insert', linkState());
            if (splashSeen) { splashSeen(); splashSeen = null; }
        }
        const badgeEl = img.closest('.wm-cafe-badge');
        if (badgeEl) {
            const note = () => ev(badgeEl.hidden ? 'badge-hidden' : 'badge-shown', 'imgComplete=' + img.complete + ' naturalWidth=' + img.naturalWidth);
            ev('badge-at-insert', 'hidden=' + badgeEl.hidden + ' imgComplete=' + img.complete + ' naturalWidth=' + img.naturalWidth);
            if (!badgeEl.hidden) note();
            let was = badgeEl.hidden;
            new MutationObserver(() => { if (badgeEl.hidden !== was) { was = badgeEl.hidden; note(); } }).observe(badgeEl, { attributes: true, attributeFilter: ['hidden'] });
        }
        ev('inserted', name + ' complete=' + img.complete + ' natural=' + img.naturalWidth + 'x' + img.naturalHeight + ' widthAttr=' + img.hasAttribute('width'));
        img.addEventListener('load', () => ev('load', name + ' natural=' + img.naturalWidth + 'x' + img.naturalHeight));
        img.addEventListener('error', () => ev('error', name));
        // ARTIFICIAL (only with --stall): hold the main thread right after the splash's first frame is asked for
        if (${opts.stall} > 0 && name === 'boot-melaton.png') requestAnimationFrame(() => setTimeout(() => {
            ev('stall-start (injected by the test)'); const end = performance.now() + ${opts.stall}; while (performance.now() < end) { /* busy */ } ev('stall-end');
        }, 0));
        if (${opts.showcafe} && name === 'cafe-ready-dark.png') {
            const badge = img.closest('.wm-cafe-badge');
            queueMicrotask(() => { badge.hidden = false; });
            new MutationObserver(() => { if (badge.hidden) badge.hidden = false; }).observe(badge, { attributes: true, attributeFilter: ['hidden'] });
        }
    };
    new MutationObserver((muts) => {
        for (const m of muts) {
            if (m.type === 'attributes') { if (m.target === document.documentElement) ev(m.attributeName, m.target.getAttribute(m.attributeName)); continue; }
            for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.tagName === 'IMG') watch(n);
                else if (n.firstElementChild) n.querySelectorAll('img').forEach(watch);
            }
        }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-wm-boot', 'data-wm-splash-painted'] });
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => R.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true }); } catch (_) {}
    document.addEventListener('DOMContentLoaded', () => {
        ev('DOMContentLoaded');
        ev('navigator.onLine', navigator.onLine);
        R.assets = [...document.querySelectorAll('script[src], link[rel=stylesheet]')].map((x) => x.getAttribute('src') || x.getAttribute('href')).filter((u) => ['wmShell.js?', 'wm-shell.css?', 'wm-programs.css?'].some((n) => u.includes(n)));
    });
    window.addEventListener('load', () => ev('window.load'));
    // where the two pictures sit while the splash is up (for reading the screencast frames)
    const boxes = () => {
        if (document.documentElement && document.documentElement.dataset.wmBoot === 'splash') {
            const e = document.querySelector('.wm-splash .wm-splash-logo img, .wm-splash .wm-splash65-mark'), c = document.querySelector('.wm-splash .wm-splash-cafe');
            if (e && c) { const q = (x) => { const r = x.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
                const ci = c.querySelector('img');
                if (!R.box || (!c.hidden && ci.complete && ci.naturalWidth)) R.box = { emblem: q(e), cafe: q(c), cafeImg: q(ci), cafeHidden: c.hidden };
                // computed styles, for the old / new CSS and for the 6.5 comparison
                const css = (x) => { const k = getComputedStyle(x); return { width: k.width, height: k.height, aspectRatio: k.aspectRatio }; };
                R.styles = { emblemImg: css(e), badgeImg: css(ci), emblemBox: q(e), badgeBox: q(c) }; }
        }
        if (!document.documentElement || document.documentElement.dataset.wmBoot !== 'done') setTimeout(boxes, 100);
    };
    setTimeout(boxes, 0);
    ${opts.preload ? `(() => {
        const add = () => {
            const root = document.head || document.documentElement;
            if (!root) return false;
            for (const url of ${JSON.stringify(ART)}) {
                const l = document.createElement('link'); l.rel = 'preload'; l.as = 'image'; l.setAttribute('fetchpriority', 'high'); l.href = url; l.dataset.r1408 = '1';
                l.addEventListener('load', () => ev('preload-load', url.split('/').pop()));
                l.addEventListener('error', () => ev('preload-error', url.split('/').pop()));
                root.appendChild(l);
            }
            ev('preload-injected', root.tagName);
            return true;
        };
        // in <head> as soon as the parser has made it (a link before <html>'s head is parsed is not a real page's case)
        if (!(document.head && add())) { const mo = new MutationObserver(() => { if (document.head && add()) mo.disconnect(); }); mo.observe(document, { childList: true, subtree: true }); }
    })();` : ''}
})();`;

const COLLECT = `(async () => {
    const R = window.__r1408 || { ev: [], longtasks: [] };
    const all = performance.getEntriesByType('resource');
    const art = ${JSON.stringify(ART)};
    const pick = (e) => { const o = {}; for (const k of ['initiatorType', 'startTime', 'workerStart', 'fetchStart', 'requestStart', 'responseStart', 'responseEnd', 'transferSize', 'encodedBodySize', 'decodedBodySize', 'deliveryType', 'renderBlockingStatus']) o[k] = typeof e[k] === 'number' ? Math.round(e[k]) : e[k]; return o; };
    const resources = {};
    for (const p of art) resources[p.split('/').pop()] = all.filter((e) => e.name.split('?')[0].endsWith(p)).map((e) => ({ ...pick(e), requestsStartedBefore: all.filter((x) => x.startTime < e.startTime).length,
        requestsInFlightAtStart: all.filter((x) => x.startTime < e.startTime && x.responseEnd > e.startTime).length }));
    const c = await caches.open('static-cache-v2');
    const cached = {};
    for (const p of art) cached[p.split('/').pop()] = !!(await c.match(p, { ignoreVary: true }));
    const nav = performance.getEntriesByType('navigation')[0];
    let swLog = [];
    try { const i = await caches.open('internal-cache-v1'); const r = await i.match('/internal/sw-perf-log'); if (r) swLog = await r.json(); } catch (_) {}
    const imgs = [...document.querySelectorAll('.wm-splash img')].map((x) => ({ src: x.getAttribute('src'), complete: x.complete, natural: [x.naturalWidth, x.naturalHeight] }));
    return { path: location.pathname, timeOrigin: performance.timeOrigin, version: R.version || null, assets: R.assets || null, styles: R.styles || null,
        sheetRules: (() => { const hit = {}; for (const sh of document.styleSheets) { const n = (sh.href || '').split('/').pop(); if (!/^wm-(shell|programs)\.css/.test(n)) continue; for (const r of sh.cssRules) { if (r.selectorText === '.wm-cafe-badge img') hit.badgeImgRule = { sheet: n.slice(0, 40), aspectRatio: r.style.aspectRatio || '' }; if (r.selectorText === '.wm-splash-logo img') hit.logoImgRule = { sheet: n.slice(0, 40), height: r.style.height || '' }; } } return hit; })(),
        ev: R.ev, longtasks: R.longtasks, box: R.box, resources, cached,
        resourceCount: all.length, paint: performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]),
        nav: nav ? { responseEnd: Math.round(nav.responseEnd), domInteractive: Math.round(nav.domInteractive), domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) } : null,
        served: { splashArtInHtml: document.head.innerHTML.includes('splashArt'), splashImgs: imgs, controlled: !!navigator.serviceWorker.controller },
        ackDropped: Number(sessionStorage.getItem('r1408AckDropped') || 0), swLog };
})()`;

async function setTrace(cdp, s, on) {
    await evaluate(cdp, s, `(async () => {
        const i = await caches.open('internal-cache-v1');
        await i.delete('/internal/sw-perf-log');
        if (${on}) await i.put('/internal/sw-perf-trace', new Response(String(Date.now()))); else await i.delete('/internal/sw-perf-trace');
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.active) reg.active.postMessage({ type: 'SW_PERF_TRACE' });
        return true;
    })()`);
}

(async () => {
    fs.mkdirSync(outDir, { recursive: true });
    const cdp = await connect();

    // a quiet same-origin page to turn the worker's own perf trace on
    const prep = await newPhoneTab(cdp, BASE_INIT);
    await cdp.send('Page.navigate', { url: `${ORIGIN}/status` }, prep.sessionId);
    await sleep(1200);
    await setTrace(cdp, prep.sessionId, true);
    await sleep(500);

    // before any network emulation is on: the checks load a page of this server
    if (arg('wm', null)) await evaluate(cdp, prep.sessionId, `(localStorage.setItem('wmVersion', ${JSON.stringify(wmVer)}), true)`);
    let variantBefore = null;
    if (variant) {
        const { swap } = require('./swap');
        variantBefore = await swap(cdp, variant, false);
        if (!variantBefore.ok) { const fixed = await swap(cdp, variant, true); variantBefore = { ...fixed, reapplied: true, wasNotAsWantedBeforehand: true }; if (!fixed.ok) throw new Error('variant not in place'); }
    }


    // the service worker's own network (what really leaves the browser for the two pictures)
    const swNet = [];
    const pageNet = new Map();
    const swSessions = new Set();
    const frames = [];
    const consoleRows = [];
    let bogusRequests = 0;
    let pageSession = null;
    let swFailed = 0;
    cdp.on((x) => {
        const p = x.params || {};
        if (x.method === 'Target.attachedToTarget' && p.targetInfo.type === 'service_worker') {
            const sid = p.sessionId;
            swSessions.add(sid);
            cdp.send('Network.enable', {}, sid).catch(() => {});
            if (net === 'art-fail') cdp.send('Fetch.enable', { patterns: ART.map((a) => ({ urlPattern: `*${a}*`, requestStage: 'Request' })) }, sid).catch(() => {});
            if (net === 'offline') cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sid).catch((e) => console.log('sw offline failed', e.message));
        }
        if (swSessions.has(x.sessionId)) {
            if (x.method === 'Network.requestWillBeSent' && isArt(p.request.url)) swNet.push({ wall: p.wallTime, url: short(isArt(p.request.url)), what: 'service worker sent a network request' });
            if (x.method === 'Network.loadingFailed') { const hit = swNet.find((r) => r.id === p.requestId); if (hit) hit.failed = p.errorText; }
            if (x.method === 'Fetch.requestPaused') { swFailed++; cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'AddressUnreachable' }, x.sessionId).catch(() => {}); }
        }
        if (x.sessionId !== pageSession) return;
        if (x.method === 'Log.entryAdded') consoleRows.push({ from: 'log', level: p.entry.level, text: p.entry.text, url: p.entry.url || '' });
        if (x.method === 'Runtime.consoleAPICalled') consoleRows.push({ from: 'console', level: p.type, text: (p.args || []).map((a) => String(a.value !== undefined ? a.value : a.description || '')).join(' '), url: '' });
        if (x.method === 'Network.requestWillBeSent') { const u = p.request.url.split('?')[0]; if (u.endsWith(BOGUS)) bogusRequests++; }
        if (x.method === 'Network.requestWillBeSent') {
            const a = isArt(p.request.url);
            if (a) pageNet.set(p.requestId, { url: short(a), wall: p.wallTime, mono: p.timestamp, type: p.type, priority: p.request.initialPriority, initiator: p.initiator && p.initiator.type });
        } else if (pageNet.has(p.requestId)) {
            const r = pageNet.get(p.requestId);
            const ms = () => Math.round((p.timestamp - r.mono) * 1000);
            if (x.method === 'Network.responseReceived') Object.assign(r, { status: p.response.status, fromServiceWorker: p.response.fromServiceWorker, fromDiskCache: p.response.fromDiskCache, swSource: p.response.serviceWorkerResponseSource || null, responseAfterMs: ms() });
            else if (x.method === 'Network.loadingFinished') r.finishedAfterMs = ms();
            else if (x.method === 'Network.loadingFailed') { r.failed = p.errorText; r.failedAfterMs = ms(); }
            else if (x.method === 'Network.resourceChangedPriority') r.priorityChangedTo = `${p.newPriority} after ${ms()} ms`;
        }
        if (x.method === 'Page.screencastFrame') {
            frames.push({ ts: p.metadata.timestamp, data: p.data });
            cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, pageSession).catch(() => {});
        }
    });
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'service_worker', exclude: false }] });
    await cdp.send('Target.setDiscoverTargets', { discover: true });

    if (!flag('keepsw')) {
        await cdp.send('ServiceWorker.enable', {}, prep.sessionId);
        await cdp.send('ServiceWorker.stopAllWorkers', {}, prep.sessionId);
    }
    await cdp.send('Target.closeTarget', { targetId: prep.targetId });
    await sleep(800);

    const probe = PROBE_INIT({ preload: flag('preload'), showcafe: flag('showcafe'), stall: Number(arg('stall', 0)), miniport: miniportMode, bogus: flag('bogus-preload') });
    new Function(probe); // a probe that does not parse must stop the run before a page boots
    // the bridge stub and the ack guard (BASE_INIT) are their own script: nothing in the probe can take them away
    const tab = await newPhoneTab(cdp, BASE_INIT);
    pageSession = tab.sessionId;
    const s = tab.sessionId;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probe }, s);
    await cdp.send('Log.enable', {}, s);
    if (net === 'offline') await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, s);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate }, s);
    if (flag('shots')) await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 412, maxHeight: 915, everyNthFrame: 1 }, s);
    const load0 = os.loadavg()[0];
    await cdp.send('Page.navigate', { url: `${ORIGIN}/app` }, s, 120000);

    const t0 = Date.now();
    let doneAt = 0;
    let loadedAt = 0;
    while (Date.now() - t0 < 200000) {
        await sleep(1000);
        let st = null;
        try { st = await evaluate(cdp, s, '[document.documentElement.dataset.wmBoot || "", !!(window.__r1408 && window.__r1408.ev.some((e) => e[1] === "window.load"))]', 5000); } catch (_) { /* main thread busy */ }
        if (st && st[0] === 'done' && !doneAt) doneAt = Date.now();
        if (st && st[1] && !loadedAt) loadedAt = Date.now();
        // Chrome warns about an unused preload a few seconds after the load event: wait well past it
        if (doneAt && loadedAt && Date.now() - doneAt > 6000 && Date.now() - loadedAt > 8000) break;
    }
    if (flag('shots')) await cdp.send('Page.stopScreencast', {}, s).catch(() => {});
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }, s);
    await sleep(2800); // the worker writes its trace 2 s after a row
    const r = await evaluate(cdp, s, COLLECT, 60000);
    if (!r.ev.length) throw new Error('the probe did not run in this boot');
    const origin = r.timeOrigin;
    const toPage = (wallSeconds) => Math.round(wallSeconds * 1000 - origin);

    // the worker's trace rows for the two pictures, in page time (rows carry UTC HH:MM:SS.mmm of the answer)
    const day = new Date(origin).toISOString().slice(0, 10);
    const rowTime = (line) => Math.round(Date.parse(`${day}T${line.slice(0, 12)}Z`) - origin);
    // rows of THIS page only (a worker can still hold, and write again, an earlier run's rows)
    const mine = (l) => rowTime(l) >= -500;
    const artRow = (l) => / fetch /.test(l) && ART.some((a) => l.includes(a));
    const sw = {
        artRows: r.swLog.filter((l) => artRow(l) && mine(l)).map((l) => ({ answeredAtPageMs: rowTime(l), row: l.slice(13) })),
        workerStarted: r.swLog.filter((l) => /trace on/.test(l)).map(rowTime),
        stalls: r.swLog.filter((l) => / stall /.test(l)).map((l) => ({ atPageMs: rowTime(l), row: l.slice(13) })),
        fetchRows: r.swLog.filter((l) => / fetch /.test(l)).length
    };
    r.swRowsPerArt = Object.fromEntries(ART.map((a) => [short(a), sw.artRows.filter((x) => x.row.includes(a)).length]));
    delete r.swLog;

    // read the frames: how many "detail" pixels sit where each picture belongs
    let frameRows = [];
    if (frames.length && r.box) {
        fs.mkdirSync(shotDir, { recursive: true });
        const detail = async (buf, box) => {
            const [x, y, w, h] = box;
            if (w < 4 || h < 4) return 0;
            const meta = await sharp(buf).metadata();
            const left = Math.max(0, Math.min(x, meta.width - 2)), top = Math.max(0, Math.min(y, meta.height - 2));
            // sharp's stats() reads its input, not the pipeline: the crop is made first
            const crop = await sharp(buf).extract({ left, top, width: Math.max(1, Math.min(w, meta.width - left)), height: Math.max(1, Math.min(h, meta.height - top)) }).greyscale().png().toBuffer();
            const st = await sharp(crop).stats();
            return Math.round(st.channels[0].stdev * 10) / 10;
        };
        for (let i = 0; i < frames.length; i++) {
            const buf = Buffer.from(frames[i].data, 'base64');
            const t = toPage(frames[i].ts);
            frameRows.push({ i, t, emblemStdev: await detail(buf, r.box.emblem), cafeStdev: await detail(buf, r.box.cafeImg[3] > 3 ? r.box.cafeImg : r.box.cafe) });
            fs.writeFileSync(path.join(shotDir, `f${String(i).padStart(4, '0')}-${t}ms.png`), buf);
        }
    }

    const out = {
        label, rate, net, injectedStallMs: Number(arg('stall', 0)), preload: flag('preload'), showcafe: flag('showcafe'), swStoppedFirst: !flag('keepsw'), hostLoad1: [load0, os.loadavg()[0]],
        cpuset: process.env.CPUSET || null,
        wm: wmVer, variant, variantBefore: variantBefore && { ok: variantBefore.ok, reappliedBeforeThisRun: !!variantBefore.wasNotAsWantedBeforehand, files: variantBefore.files, app: variantBefore.app, expected: variantBefore.expected },
        miniport: miniportMode, waitedPastLoadMs: loadedAt ? Date.now() - loadedAt : 0,
        consolePreload: consoleRows.filter((c) => /preload/i.test(c.text)).map((c) => ({ ...c, text: c.text.slice(0, 300) })), consoleRowsSeen: consoleRows.length,
        consoleNamingArt: consoleRows.filter((c) => ART.some((a) => (c.text + c.url).includes(short(a)))).map((c) => ({ level: c.level, text: c.text.slice(0, 200) })), bogusRequests,
        ...r, pageNetwork: [...pageNet.values()].map((x) => ({ ...x, atPageMs: toPage(x.wall), wall: undefined, mono: undefined })),
        serviceWorkerNetwork: swNet.map((x) => ({ ...x, atPageMs: toPage(x.wall), wall: undefined })), serviceWorkerRequestsFailedByTest: swFailed,
        serviceWorkerTrace: sw, frames: frameRows
    };
    fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(out, null, 1));

    // leave the trace off and the network normal: a new connection, so no session's offline emulation stays on
    await cdp.send('Target.closeTarget', { targetId: tab.targetId });
    cdp.close();
    await sleep(500);
    const clean = await connect();
    if (variant) {
        const { swap } = require('./swap');
        const after = await swap(clean, variant, false);
        out.variantAfter = { ok: after.ok, files: after.files, app: after.app };
        fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(out, null, 1));
    }
    const done = await newPhoneTab(clean, BASE_INIT);
    await clean.send('Page.navigate', { url: `${ORIGIN}/status` }, done.sessionId);
    await sleep(1200);
    await setTrace(clean, done.sessionId, false).catch(() => {});
    await clean.send('Target.closeTarget', { targetId: done.targetId });
    clean.close();

    const at = (k, name) => { const e = r.ev.find((x) => x[1] === k && x[2].startsWith(name || '')); return e ? e[0] : null; };
    console.log(JSON.stringify({ label, rate, net, splash: at('data-wm-boot', 'splash'), splashPainted: at('data-wm-splash-painted'), reveal: at('data-wm-boot', 'reveal'), done: at('data-wm-boot', 'done'),
        art: ART.map((p) => { const n = short(p); const e = (r.resources[n] || [])[0]; return { n, inserted: at('inserted', n), load: at('load', n), error: at('error', n), start: e && e.startTime, end: e && e.responseEnd, ws: e && e.workerStart, xfer: e && e.transferSize, before: e && e.requestsStartedBefore, inflight: e && e.requestsInFlightAtStart, cached: r.cached[n] }; }),
        page: out.pageNetwork.map((x) => `${x.url} @${x.atPageMs} ${x.priority} sw=${x.fromServiceWorker} src=${x.swSource} status=${x.status} resp+${x.responseAfterMs} fin+${x.finishedAfterMs}${x.failed ? ' FAILED ' + x.failed : ''}`),
        swNet: out.serviceWorkerNetwork.length, swTrace: sw.artRows.map((x) => `@${x.answeredAtPageMs} ${x.row}`), swRows: sw.fetchRows, frames: frames.length, box: r.box, ackDropped: r.ackDropped, new1408: r.served.splashArtInHtml }));
    process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
