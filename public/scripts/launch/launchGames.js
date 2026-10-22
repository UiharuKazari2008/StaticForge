/**
 * Games while Setup runs (/launch installer, melatonBoot.js install). The games live in
 * launch-games.html (public/scripts/launch/launchGamesHost.js): a transparent 1024 x 768 frame
 * laid over Setup's own inside its stretched VGA framebuffer (.melaton-vga, fitMelatonVga in
 * launch.html), so they share Setup's false resolution and stretch with it, as if no display
 * driver were installed. This file places that frame and passes the installer's calls on:
 *
 *   show() / hide()       the Games toolbar, while the checklist runs
 *   busy()                a game window is open (or minimized to the toolbar)
 *   gate()                resolves once no game is coming off the installation media
 *                         (Setup waits here between its steps)
 *   holdRestart(opts)     Setup finished while a game is open: the toolbar closes, a message box
 *                         behind the games offers Restart now; resolves on the click
 *   upgradeLite(onProgress)  Completing installation: the lighter copies a game came off the
 *                         media with (x-media-lite rows in static-cache-v1, listed under
 *                         localStorage melatonGamesLite) are replaced with the full files, one
 *                         <id>.full.zip per game
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const STATIC_CACHE = 'static-cache-v1';     // sw.js STATIC_CACHE
    const LITE_KEY = 'melatonGamesLite';        // launchGamesHost.js unpackMedia
    let frame = null;
    let ready = null;

    function host() {
        try {
            return frame && frame.contentWindow && frame.contentWindow.MelatonGamesHost || null;
        } catch (_) {
            return null;
        }
    }

    function ensureFrame() {
        if (frame) return ready;
        const vga = doc.querySelector('.melaton-vga');
        if (!vga) return Promise.resolve(null);
        frame = doc.createElement('iframe');
        frame.className = 'mg-frame';
        frame.title = 'Games';
        frame.src = '/launch-games.html';
        ready = new Promise((resolve) => {
            frame.addEventListener('load', () => resolve(host()), { once: true });
        });
        vga.appendChild(frame);
        return ready;
    }

    function show() {
        return ensureFrame().then((h) => {
            if (!h) return;
            frame.hidden = false;
            h.show();
        });
    }

    function hide() {
        const h = host();
        if (h && !h.busy()) {
            h.hide();
            frame.hidden = true;
        }
    }

    function busy() {
        const h = host();
        return !!(h && h.busy());
    }

    function gate() {
        const h = host();
        return h ? h.gate() : Promise.resolve();
    }

    function holdRestart(opts) {
        return ensureFrame().then((h) => {
            if (!h) return 'restart';
            frame.hidden = false;
            return h.holdRestart(opts);
        });
    }

    function hex(buf) {
        return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    }

    function store(cache, url, data, type) {
        return root.crypto.subtle.digest('SHA-256', data).then((digest) => {
            const hash = hex(digest);
            return cache.put(url, new Response(data, {
                status: 200,
                headers: {
                    'content-type': type || 'application/octet-stream',
                    'content-length': String(data.byteLength),
                    'x-file-hash': hash,
                    etag: '"' + hash + '"'
                }
            }));
        });
    }

    function loadFflate() {
        if (root.fflate) return Promise.resolve(root.fflate);
        return new Promise((resolve) => {
            const s = doc.createElement('script');
            s.src = '/protected/fflate.js';
            s.onload = () => resolve(root.fflate || null);
            s.onerror = () => resolve(null);
            doc.head.appendChild(s);
        });
    }

    // A download that gives up when the server goes quiet (no answer, or no bytes, for IDLE_MS):
    // Completing installation waits on these. Resolves to the bytes, or rejects.
    const IDLE_MS = 15000;
    const UPGRADE_MAX_MS = 60000;
    function fetchIdle(url) {
        const ctl = new AbortController();
        let timer = 0;
        const poke = () => {
            clearTimeout(timer);
            timer = setTimeout(() => ctl.abort(), IDLE_MS);
        };
        poke();
        return (async () => {
            const res = await root.fetch(url, { cache: 'no-store', signal: ctl.signal });
            if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
            const reader = res.body.getReader();
            const chunks = [];
            let got = 0;
            for (;;) {
                poke();
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                got += value.byteLength;
            }
            const bytes = new Uint8Array(got);
            let at = 0;
            chunks.forEach((c) => { bytes.set(c, at); at += c.byteLength; });
            return { bytes, type: res.headers.get('content-type') };
        })().finally(() => clearTimeout(timer));
    }

    // A game's full files in one request (<id>.full.zip, scripts/build-vista-games-media.js)
    // over the rows that are still lighter copies. Returns the urls it replaced.
    async function upgradeGame(cache, game, urls) {
        const lib = await loadFflate();
        if (!lib) return [];
        // sw.js leaves the media folder to the network (GAME_MEDIA_PREFIX); no-store keeps the
        // browser's own cache out of it too
        const { bytes } = await fetchIdle('/static_images/vista-games/media/' + game + '.full.zip');
        const files = lib.unzipSync(bytes);
        const meta = JSON.parse(lib.strFromU8(files['pack.json']));
        const want = new Set(urls);
        const done = [];
        for (const row of meta.files || []) {
            if (!want.has(row.url) || !files[row.entry]) continue;
            const old = await cache.match(row.url);
            if (old && !old.headers.get('x-media-lite')) {
                done.push(row.url);
                continue;
            }
            await store(cache, row.url, files[row.entry], old && old.headers.get('content-type'));
            done.push(row.url);
        }
        return done;
    }

    // One lighter copy on its own (no game zip): out of the cache, the full file from the
    // server. A failed download puts the copy back.
    async function upgradeOne(cache, url) {
        const row = await cache.match(url);
        if (!row || !row.headers.get('x-media-lite')) return true;
        await cache.delete(url);
        try {
            const got = await fetchIdle(url);
            await store(cache, url, got.bytes, got.type || row.headers.get('content-type'));
            return true;
        } catch (_) {
            await cache.put(url, row);
            return false;
        }
    }

    async function upgradeLite(onProgress) {
        let map = {};
        try { map = JSON.parse(root.localStorage.getItem(LITE_KEY) || '{}') || {}; } catch (_) { map = {}; }
        const urls = Object.keys(map);
        if (!urls.length || !root.caches) return { replaced: 0, left: urls.length };
        const cache = await root.caches.open(STATIC_CACHE);
        const byGame = new Map();
        urls.forEach((url) => {
            const game = map[url] && map[url].game;
            if (!byGame.has(game)) byGame.set(game, []);
            byGame.get(game).push(url);
        });
        let done = 0;
        const tick = (n) => {
            done += n;
            if (onProgress) onProgress(done / urls.length);
        };
        // Setup waits on this step: past UPGRADE_MAX_MS what is left stays a lighter copy, which
        // sw.js replaces once the desktop opens the game (revalidateGameAsset)
        const deadline = Date.now() + UPGRADE_MAX_MS;
        for (const [game, list] of byGame) {
            if (Date.now() > deadline) break;
            let replaced = [];
            if (game) replaced = await upgradeGame(cache, game, list).catch(() => []);
            replaced.forEach((url) => { delete map[url]; });
            tick(replaced.length);
            // what the game's zip did not cover, one by one
            for (const url of list.filter((u) => map[u])) {
                if (Date.now() > deadline) break;
                if (await upgradeOne(cache, url).catch(() => false)) delete map[url];
                tick(1);
            }
        }
        try { root.localStorage.setItem(LITE_KEY, JSON.stringify(map)); } catch (_) { /* best effort */ }
        return { replaced: urls.length - Object.keys(map).length, left: Object.keys(map).length };
    }

    // the reboot: the frame goes with Setup
    function close() {
        if (frame) frame.hidden = true;
    }

    root.MelatonLaunchGames = { show, hide, busy, gate, holdRestart, upgradeLite, close };
})(typeof window !== 'undefined' ? window : globalThis);
