/**
 * Melaton Mobile's power-on self test (Yukimi, Nov 14 2026, #827): while the Android app shows the
 * maker's logo, the start page (/launch) checks that what Melaton Mobile needs to start works, as an
 * old phone tested itself behind its boot logo:
 *
 *   storage      localStorage writes and reads back
 *   indexeddb    a scratch database opens, writes, reads back and is deleted
 *   databases    every existing database of this site opens (not blocked by a stuck tab, not broken)
 *   caches       Cache Storage opens, a scratch entry goes in and comes back; the files cache opens
 *   serviceworker  the service worker is registered and has a worker (a broken registration is
 *                removed so the start registers it fresh; none yet is fine: the start installs it)
 *   quota        free space for the site (under 64 MB fails, under 256 MB warns)
 *   cookies      cookies are on (the session lives in one)
 *
 * Safe repairs run once and the failed test runs again: the scratch database and cache are deleted,
 * a broken service worker registration is unregistered. User data is never touched.
 *
 * The result: window.melatonSelfTest = { done: Promise<result>, result }, result = { state: 'pass' |
 * 'warn' | 'fail', items: [{ id, name, level: 'ok' | 'warn' | 'error', detail, repaired }], ms }.
 * Inside the app it goes to AndroidDisplay.reportSelfTest(json): the boot cover holds the maker's
 * logo until it comes, and a failure opens the recovery page with what failed. The start
 * (launch.html redirectToApp) waits for it and does not go on after a failure inside the app.
 * Every check has its own time limit and the whole test ends within 8 s.
 */
(function (root) {
    'use strict';

    if (root.melatonSelfTest) return;
    const STATIC_CACHE = 'static-cache-v2'; // sw.js STATIC_CACHE
    const SCRATCH_DB = 'melaton-self-test';
    const SCRATCH_CACHE = 'melaton-self-test';
    const TOTAL_MS = 8000;
    const t0 = Date.now();
    const items = [];
    const result = { state: 'running', items, ms: 0, startedAt: t0 };

    const limit = (p, ms, what) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000} s`)), ms))]);
    const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('failed')); });
    const msg = (e) => String((e && (e.name && e.message ? `${e.name}: ${e.message}` : e.message || e.name)) || e || 'failed');

    function add(id, name, level, detail, repaired) {
        items.push({ id, name, level, detail: detail || '', repaired: !!repaired });
    }

    // ---------------------------------------------------------------- the checks

    function storage() {
        const k = '__melatonSelfTest';
        const v = String(t0);
        localStorage.setItem(k, v);
        const back = localStorage.getItem(k);
        localStorage.removeItem(k);
        if (back !== v) throw new Error('what was written did not come back');
    }

    async function scratchDb() {
        if (!root.indexedDB) throw new Error('IndexedDB is not available');
        const open = indexedDB.open(SCRATCH_DB, 1);
        open.onupgradeneeded = () => { open.result.createObjectStore('t'); };
        const db = await limit(req(open), 3000, 'IndexedDB');
        try {
            const tx = db.transaction('t', 'readwrite');
            tx.objectStore('t').put(t0, 'k');
            const back = await req(tx.objectStore('t').get('k'));
            if (back !== t0) throw new Error('what was written did not come back');
        } finally {
            db.close();
        }
        await limit(req(indexedDB.deleteDatabase(SCRATCH_DB)), 3000, 'IndexedDB delete');
    }

    async function existingDbs() {
        if (!root.indexedDB || typeof indexedDB.databases !== 'function') return { level: 'ok', detail: 'not listed by this browser' };
        const list = (await limit(indexedDB.databases(), 2000, 'IndexedDB list')).filter((d) => d && d.name && d.name !== SCRATCH_DB).slice(0, 24);
        const bad = [];
        const blocked = [];
        await Promise.all(list.map((d) => new Promise((resolve) => {
            let r;
            try { r = indexedDB.open(d.name); } catch (e) { bad.push(`${d.name} (${msg(e)})`); resolve(); return; }
            const timer = setTimeout(() => { blocked.push(d.name); resolve(); }, 2500);
            r.onsuccess = () => { clearTimeout(timer); try { r.result.close(); } catch (_) { /* closed */ } resolve(); };
            r.onerror = () => { clearTimeout(timer); bad.push(`${d.name} (${msg(r.error)})`); resolve(); };
            r.onblocked = () => { clearTimeout(timer); blocked.push(d.name); resolve(); };
            // opening without a version never upgrades; an upgrade here would mean a missing database
            r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) { /* aborted */ } };
        })));
        if (bad.length) return { level: 'error', detail: `could not open ${bad.join(', ')}` };
        if (blocked.length) return { level: 'warn', detail: `held by another window: ${blocked.join(', ')}` };
        return { level: 'ok', detail: `${list.length} database${list.length === 1 ? '' : 's'}` };
    }

    async function cacheStorage() {
        if (!root.caches) throw new Error('Cache Storage is not available');
        const c = await limit(caches.open(SCRATCH_CACHE), 3000, 'Cache Storage');
        const url = `/__melaton-self-test?${t0}`;
        await c.put(url, new Response(String(t0)));
        const back = await c.match(url);
        const text = back ? await back.text() : null;
        await caches.delete(SCRATCH_CACHE);
        if (text !== String(t0)) throw new Error('what was written did not come back');
        // the files cache itself opens (the service worker and the start read it)
        await limit(caches.open(STATIC_CACHE), 3000, 'the files cache');
    }

    async function serviceWorker() {
        const sw = root.navigator && root.navigator.serviceWorker;
        if (!sw) throw new Error('service workers are not available');
        const reg = await limit(sw.getRegistration('/'), 3000, 'the service worker');
        if (!reg) return { level: 'ok', detail: 'not installed yet: the start installs it' };
        const w = reg.active || reg.waiting || reg.installing;
        if (!w || w.state === 'redundant') return { level: 'error', detail: 'the registration has no working service worker', broken: reg };
        return { level: 'ok', detail: reg.active ? 'active' : w.state };
    }

    async function quota() {
        const s = root.navigator && root.navigator.storage;
        if (!s || typeof s.estimate !== 'function') return { level: 'ok', detail: 'not reported' };
        const e = await limit(s.estimate(), 2000, 'the storage estimate');
        if (!e || !e.quota) return { level: 'ok', detail: 'not reported' };
        const free = Math.max(0, e.quota - (e.usage || 0));
        const mb = Math.round(free / 1048576);
        if (mb < 64) return { level: 'error', detail: `only ${mb} MB free for Melaton Mobile` };
        if (mb < 256) return { level: 'warn', detail: `${mb} MB free` };
        return { level: 'ok', detail: `${mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`} free` };
    }

    // ---------------------------------------------------------------- run, repair once, report

    async function step(id, name, fn, repair) {
        let out;
        try { out = (await fn()) || { level: 'ok', detail: '' }; } catch (e) { out = { level: 'error', detail: msg(e) }; }
        if (out.level === 'error' && repair) {
            try {
                await repair(out);
                let again;
                try { again = (await fn()) || { level: 'ok', detail: '' }; } catch (e) { again = { level: 'error', detail: msg(e) }; }
                if (again.level !== 'error') { add(id, name, again.level, `repaired (${out.detail})`, true); return; }
                out = again;
            } catch (e) { out.detail += `; repair failed: ${msg(e)}`; }
        }
        add(id, name, out.level, out.detail);
    }

    async function run() {
        await step('storage', 'Local storage', storage);
        await step('indexeddb', 'IndexedDB', scratchDb, () => limit(req(indexedDB.deleteDatabase(SCRATCH_DB)), 3000, 'IndexedDB delete'));
        await step('databases', 'Databases', existingDbs);
        await step('caches', 'Cache Storage', cacheStorage, () => caches.delete(SCRATCH_CACHE));
        await step('serviceworker', 'Service worker', serviceWorker, async (out) => { if (out.broken) await out.broken.unregister(); });
        await step('quota', 'Free space', quota);
        add('cookies', 'Cookies', root.navigator && root.navigator.cookieEnabled === false ? 'error' : 'ok', root.navigator && root.navigator.cookieEnabled === false ? 'cookies are off' : '');
    }

    const done = limit(run(), TOTAL_MS, 'The self test').catch((e) => { add('time', 'Self test', 'error', msg(e)); }).then(() => {
        result.state = items.some((i) => i.level === 'error') ? 'fail' : items.some((i) => i.level === 'warn') ? 'warn' : 'pass';
        result.ms = Date.now() - t0;
        if (result.state !== 'pass') console.warn('[self test]', result.state, items.filter((i) => i.level !== 'ok'));
        try {
            const D = root.AndroidDisplay;
            if (D && typeof D.reportSelfTest === 'function') D.reportSelfTest(JSON.stringify(result));
        } catch (_) { /* an app build without the self test */ }
        try { root.dispatchEvent(new CustomEvent('melatonselftest', { detail: result })); } catch (_) { /* old engine */ }
        return result;
    });

    /** launch.html: go on only when the test allows it (a failure inside the app stays for the recovery page). */
    function gate(go) {
        done.then((r) => {
            const inApp = !!(root.AndroidDisplay && typeof root.AndroidDisplay.reportSelfTest === 'function');
            if (r.state === 'fail' && inApp) return;
            go();
        });
    }

    root.melatonSelfTest = { done, result, gate };
})(typeof window !== 'undefined' ? window : globalThis);
