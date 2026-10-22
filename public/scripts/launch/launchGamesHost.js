/**
 * Setup's games, inside launch-games.html: a transparent 1024 x 768 page that the installer
 * (/launch, melatonBoot.js) lays over its stretched VGA frame (launchGames.js), so the games
 * share Setup's false 1024 x 768 screen and stretch with it, as if no display driver were
 * installed. Every coordinate the games use (clientX, getBoundingClientRect, innerWidth) is
 * then the frame's own.
 *
 *   the Games toolbar (bottom right): Minesweeper, the card games, Block Drop, Brick Breaker,
 *     JezzBall. A click loads the game "from the installation media": one zip
 *     (/static_images/vista-games/media/<id>.zip, scripts/build-vista-games-media.js) unpacked
 *     into the service worker's static-cache-v1, under a small progress dialog, while Setup waits
 *     (gate()); then the game opens at the top left.
 *   holdRestart({ upgrade })  Setup finished under an open game: the toolbar closes (no new game
 *     now), minimized games come back, and a message box behind the games offers Restart now;
 *     resolves on that button. Once the last game closes the message box comes to the front.
 *   busy()  a game window is open (or minimized to the toolbar)
 *
 * The games are the desktop's own (public/scripts/comp/desktop-apps/vista-games/, featureLoader.js
 * openVistaGame). This page has no desktop window manager, so it stands in for the modalUtils.js
 * calls they make and draws their windows in Vista Basic, as Setup's own window is
 * (public/css/launch-games.css).
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const GAMES = [
        { id: 'minesweeper', name: 'Minesweeper' },
        { id: 'solitaire', name: 'Solitaire' },
        { id: 'spider', name: 'Spider Solitaire' },
        { id: 'freecell', name: 'FreeCell' },
        { id: 'hearts', name: 'Hearts' },
        { id: 'blockdrop', name: 'Block Drop' },
        { id: 'brickbreaker', name: 'Brick Breaker' },
        { id: 'jezzball', name: 'JezzBall' }
    ];
    // what the desktop's app.html loads for these windows: menus, 7.css controls, Vista dialogs
    const STYLES = [
        '/css/fonts.css',
        // the desktop's cursor tokens (--c-pointer and friends) the games' styles use
        '/css/desktop-cursors.css',
        '/css/menu-chrome.css',
        '/css/context-menu.css',
        '/css/vista-menus.css',
        '/css/7.scoped.css',
        '/css/vista-dialogs.css'
    ];
    const SCRIPTS = ['/scripts/comp/contextMenu.js', '/scripts/comp/featureLoader.js'];
    const MEDIA = (id, ext) => '/static_images/vista-games/media/' + id + (ext || '.zip');
    const STATIC_CACHE = 'static-cache-v1';     // sw.js STATIC_CACHE
    // lighter copies written from the media, url -> { hash (the full file's), game }; Setup's last step
    // swaps them for the full files (launchGames.js upgradeLite)
    const LITE_KEY = 'melatonGamesLite';
    const IDLE_MS = 15000;           // a download with no bytes this long has stalled
    const GATE_MAX_MS = 60000;       // the longest Setup waits for a game coming off the media
    const TYPES = {
        js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json',
        html: 'text/html; charset=utf-8', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg',
        svg: 'image/svg+xml', m4a: 'audio/mp4', opus: 'audio/ogg', wav: 'audio/wav', bin: 'application/octet-stream'
    };
    const ICON = (id, size) => '/static_images/app_icons/' + size + '/vista-' + id + '.webp';
    const PAD = 24;                             // new windows: top left, this far in, then a step down

    let toolbar = null;
    let notice = null;
    let held = false;        // Setup finished: the toolbar is gone, games cannot be minimized away
    let depsPromise = null;
    let zTop = 3000;
    let cascade = 0;
    let loading = 0;
    let loadDeadline = 0;
    let gateWaiters = [];

    function el(tag, cls, text) {
        const n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    // ---- loading -----------------------------------------------------------------------------
    function addStyle(href) {
        if (doc.querySelector('link[href="' + href + '"]')) return Promise.resolve();
        return new Promise((resolve) => {
            const link = el('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = link.onerror = () => resolve();
            doc.head.appendChild(link);
        });
    }

    function addScript(src) {
        if (doc.querySelector('script[src="' + src + '"]')) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = el('script');
            s.src = src;
            s.async = false;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Could not load ' + src));
            doc.body.appendChild(s);
        });
    }

    function loadDeps() {
        if (!depsPromise) {
            // the games draw at 1x and never load the 2x art: the frame stretches them
            // (vistaGameEngine.js reads these when it loads: Stage, Pack.sheet)
            root.VistaGamesOptions = { pixelRatio: 1, maxSheetScale: 1 };
            depsPromise = Promise.all(STYLES.map(addStyle))
                .then(() => SCRIPTS.reduce((p, src) => p.then(() => addScript(src)), Promise.resolve()))
                .catch((err) => {
                    depsPromise = null;
                    throw err;
                });
        }
        return depsPromise;
    }

    // fflate, as the installer reads its pack (updateEngine.js loadFflate)
    function loadFflate() {
        if (root.fflate) return Promise.resolve(root.fflate);
        return addScript('/protected/fflate.js').then(() => root.fflate || null);
    }

    function readLite() {
        try { return JSON.parse(root.localStorage.getItem(LITE_KEY) || '{}') || {}; } catch (_) { return {}; }
    }

    function writeLite(map) {
        try { root.localStorage.setItem(LITE_KEY, JSON.stringify(map)); } catch (_) { /* best effort */ }
    }

    // any cache the service worker keeps (an earlier full copy may sit outside static-cache-v1)
    async function have(url) {
        const hit = await root.caches.match(url, { ignoreVary: true });
        return !!(hit && hit.ok);
    }

    // The game's files the cache does not have yet (<id>.json, beside the zip). A file already
    // there, full or a lighter copy from an earlier game, is used as it is. null: no listing.
    async function missingFiles(id) {
        let list;
        try {
            const bytes = await fetchIdle(MEDIA(id, '.json'));
            if (!bytes) return null;
            list = JSON.parse(new TextDecoder().decode(bytes));
        } catch (_) {
            return null;
        }
        if (!root.caches) return null;
        const missing = [];
        for (const row of list.files || []) {
            if (!(await have(row.url))) missing.push(row.url);
        }
        return missing;
    }

    // The zip's files into static-cache-v1, rows as the installer writes them (updateEngine.js
    // putHashed), so sw.js answers the game's requests from them. Only the files the cache
    // lacks: a full copy already there always wins. A lighter copy carries x-media-lite (the
    // full file's hash) and is listed for Setup to replace.
    async function unpackMedia(game, bytes, wanted, onProgress) {
        const lib = await loadFflate();
        if (!lib || !root.caches) return false;
        const files = lib.unzipSync(bytes);
        const meta = JSON.parse(lib.strFromU8(files['pack.json']));
        const cache = await root.caches.open(STATIC_CACHE);
        const want = new Set(wanted || []);
        const lite = readLite();
        const rows = meta.files || [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const data = files[row.entry];
            if (onProgress) onProgress((i + 1) / rows.length);
            if (!data || (wanted && !want.has(row.url))) continue;
            if (await have(row.url)) continue;
            const ext = (row.url.split('.').pop() || '').toLowerCase();
            const hash = row.lite ? row.lite.hash : row.hash;
            const headers = new Headers({
                'content-type': TYPES[ext] || 'application/octet-stream',
                'content-length': String(data.byteLength),
                'x-file-hash': hash,
                etag: '"' + hash + '"'
            });
            if (row.lite) {
                headers.set('x-media-lite', row.hash);
                lite[row.url] = { hash: row.hash, game };
            }
            await cache.put(row.url, new Response(data, { status: 200, headers }));
        }
        writeLite(lite);
        return true;
    }

    // A download that gives up when the server goes quiet: no answer, or no bytes, for IDLE_MS.
    // null then (or on any error); the caller falls back.
    function fetchIdle(url, onProgress) {
        const ctl = new AbortController();
        let timer = 0;
        const poke = () => {
            clearTimeout(timer);
            timer = setTimeout(() => ctl.abort(), IDLE_MS);
        };
        poke();
        return (async () => {
            const res = await root.fetch(url, { cache: 'no-store', signal: ctl.signal });
            if (!res || !res.ok || !res.body) return null;
            const total = Number(res.headers.get('content-length')) || 0;
            const reader = res.body.getReader();
            const chunks = [];
            let got = 0;
            for (;;) {
                poke();
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                got += value.byteLength;
                if (total && onProgress) onProgress(Math.min(1, got / total));
            }
            const bytes = new Uint8Array(got);
            let at = 0;
            chunks.forEach((c) => { bytes.set(c, at); at += c.byteLength; });
            return bytes;
        })().catch(() => null).finally(() => clearTimeout(timer));
    }

    // The zip with its progress: null when there is none or it stalls (the game then loads file
    // by file)
    function fetchMedia(id, onProgress) {
        return fetchIdle(MEDIA(id), onProgress);
    }

    // ---- the window manager the games expect (modalUtils.js on the desktop) ---------------------
    function gameWindows() {
        return Array.from(doc.querySelectorAll('body > .modal'));
    }

    function front(modal) {
        if (!modal || modal.classList.contains('hidden')) return;
        modal.style.zIndex = String(++zTop);
        gameWindows().forEach((m) => { if (m !== modal) m.classList.remove('active-window'); });
        modal.classList.add('active-window');
        syncToolbar();
    }

    function activateTop() {
        const open = gameWindows().filter((m) => !m.classList.contains('hidden') && !m.classList.contains('minimised'));
        open.sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0));
        if (open[0]) front(open[0]);
        else syncToolbar();
    }

    // a new game window: the top left corner, PAD in, each next one a step down and right
    function place(modal) {
        if (modal.dataset.mgPlaced) return;
        modal.dataset.mgPlaced = '1';
        const step = (cascade++ % 6) * PAD;
        modal.style.left = (PAD + step) + 'px';
        modal.style.top = (PAD + step) + 'px';
    }

    function minimize(modal) {
        if (held) return; // nothing to restore it from once the toolbar has closed
        modal.classList.add('minimised');
        modal.classList.remove('active-window');
        activateTop();
    }

    function restore(modal) {
        modal.classList.remove('minimised');
        front(modal);
    }

    function installShims() {
        const shim = (name, fn) => { if (typeof root[name] !== 'function') root[name] = fn; };
        shim('openModal', (modal) => {
            if (!modal) return;
            modal.classList.remove('hidden', 'minimised');
            // dialogs are placed by their game (VG.centerOver)
            if (modal.classList.contains('vista-game-dialog') || modal.classList.contains('transient') || modal.dataset.windowOwned === 'true') modal.dataset.mgPlaced = '1';
            place(modal);
            front(modal);
        });
        shim('closeModal', (modal) => {
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('active-window', 'minimised');
            activateTop();
            // the last game closed under the held restart: the message box is what is left
            if (held && notice && !busy()) frontNotice();
        });
        shim('bringModalToFront', front);
        shim('setModalOffsetsFromViewportTopLeft', (modal, x, y) => {
            modal.dataset.mgPlaced = '1';
            modal.style.left = Math.round(x) + 'px';
            modal.style.top = Math.round(y) + 'px';
        });
        shim('isModalMaximized', () => false);
        shim('minimizeModalProgrammatically', minimize);
        shim('restoreMinimizedModal', restore);
        // contextMenu.js reveals a gallery preview overlay on open (referenceManager.js): none here
        shim('revealPreviewMetaOverlay', () => {});

        // caption: drag by the title, the minimize button, a click anywhere brings it forward
        doc.addEventListener('pointerdown', (ev) => {
            const modal = ev.target.closest && ev.target.closest('body > .modal');
            if (!modal) return;
            if (!modal.classList.contains('active-window')) front(modal);
            const title = ev.target.closest('.modal-window-title');
            if (!title || ev.button !== 0 || ev.target.closest('button, a, input')) return;
            const dx = ev.clientX - modal.offsetLeft;
            const dy = ev.clientY - modal.offsetTop;
            const move = (e) => {
                modal.style.left = Math.round(Math.min(root.innerWidth - 40, Math.max(40 - modal.offsetWidth, e.clientX - dx))) + 'px';
                modal.style.top = Math.round(Math.min(root.innerHeight - 28, Math.max(0, e.clientY - dy))) + 'px';
            };
            const up = () => {
                root.removeEventListener('pointermove', move);
                root.removeEventListener('pointerup', up);
            };
            root.addEventListener('pointermove', move);
            root.addEventListener('pointerup', up);
            ev.preventDefault();
        }, true);
        doc.addEventListener('click', (ev) => {
            const btn = ev.target.closest && ev.target.closest('body > .modal .modal-window-controls .minimize-btn');
            if (btn) minimize(btn.closest('.modal'));
        });
    }

    // ---- loading a game from the installation media -------------------------------------------
    function mediaDialog(game) {
        const box = el('div', 'mg-window mg-media');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', game.name);
        const title = el('div', 'mg-title');
        title.appendChild(el('span', '', game.name));
        box.appendChild(title);
        const body = el('div', 'mg-media-body');
        const icon = el('img', 'mg-media-icon');
        icon.alt = '';
        icon.src = ICON(game.id, 32);
        body.appendChild(icon);
        const text = el('div', 'mg-media-text');
        text.appendChild(el('p', '', 'Loading ' + game.name + ' from the installation media...'));
        const bar = el('div', 'mg-progress');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        const fill = el('div');
        bar.appendChild(fill);
        text.appendChild(bar);
        text.appendChild(el('p', 'mg-media-note', 'Setup will continue when it has loaded.'));
        body.appendChild(text);
        box.appendChild(body);
        box.style.zIndex = String(++zTop);
        doc.body.appendChild(box);
        return {
            progress(f) {
                const pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
                fill.style.width = pct + '%';
                bar.setAttribute('aria-valuenow', String(pct));
            },
            close() { box.remove(); }
        };
    }

    function releaseGate() {
        if (loading) return;
        const waiters = gateWaiters;
        gateWaiters = [];
        waiters.forEach((w) => w());
    }

    async function launch(game, button) {
        const m = windowOf(game.id);
        if (m && !m.classList.contains('hidden')) {
            // a running game: the button restores or brings it forward, as a taskbar button would
            if (m.classList.contains('minimised')) restore(m);
            else if (m.classList.contains('active-window')) minimize(m);
            else front(m);
            return;
        }
        if (button.classList.contains('loading')) return;
        button.classList.add('loading');
        loading += 1;
        loadDeadline = Date.now() + GATE_MAX_MS;
        const dialog = mediaDialog(game);
        try {
            // only when the cache lacks some of the game's files: download 80 %, unpacking the rest
            const missing = await missingFiles(game.id);
            dialog.progress(0.05);
            if (!missing || missing.length) {
                const bytes = await fetchMedia(game.id, (f) => dialog.progress(0.05 + f * 0.75));
                if (bytes) await unpackMedia(game.id, bytes, missing, (f) => dialog.progress(0.8 + f * 0.15)).catch(() => false);
            }
            await loadDeps();
            dialog.progress(0.97);
            // openVistaGame: public/scripts/comp/featureLoader.js
            await root.openVistaGame(game.id);
            dialog.progress(1);
        } catch (err) {
            console.warn('Setup games: ' + game.id, err);
        } finally {
            dialog.close();
            button.classList.remove('loading');
            loading -= 1;
            releaseGate();
            syncToolbar();
        }
    }

    // ---- the Games toolbar ---------------------------------------------------------------------
    function windowOf(id) {
        return gameWindows().find((m) => m.dataset.vistaGame === id && !m.classList.contains('vista-game-dialog')) || null;
    }

    function syncToolbar() {
        if (!toolbar) return;
        toolbar.querySelectorAll('.mg-game').forEach((b) => {
            const m = windowOf(b.dataset.game);
            const open = !!m && !m.classList.contains('hidden');
            b.classList.toggle('running', open);
            b.classList.toggle('active', open && m.classList.contains('active-window') && !m.classList.contains('minimised'));
        });
    }

    function buildToolbar() {
        toolbar = el('div', 'mg-window mg-toolbar');
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Games');
        const title = el('div', 'mg-title');
        const icon = el('img', 'mg-title-icon');
        icon.alt = '';
        icon.src = ICON('games', 16);
        title.appendChild(icon);
        title.appendChild(el('span', '', 'Games'));
        toolbar.appendChild(title);
        const body = el('div', 'mg-body');
        body.appendChild(el('div', 'mg-hint', 'Play a game while Setup finishes.'));
        const row = el('div', 'mg-games');
        GAMES.forEach((game) => {
            const b = el('button', 'mg-game');
            b.type = 'button';
            b.dataset.game = game.id;
            b.title = game.name;
            b.setAttribute('aria-label', game.name);
            const img = el('img');
            img.alt = '';
            img.src = ICON(game.id, 32);
            b.appendChild(img);
            b.addEventListener('click', () => launch(game, b));
            row.appendChild(b);
        });
        body.appendChild(row);
        toolbar.appendChild(body);
        doc.body.appendChild(toolbar);
    }

    function show() {
        if (!toolbar) buildToolbar();
        toolbar.hidden = false;
        syncToolbar();
    }

    function hide() {
        if (toolbar) toolbar.hidden = true;
    }

    function busy() {
        return gameWindows().some((m) => !m.classList.contains('hidden') && !m.classList.contains('vista-game-dialog') && !m.classList.contains('transient'));
    }

    // Setup waits here between its steps while a game is coming off the media
    // (until GATE_MAX_MS after the latest game started loading: one whose files stall does not
    // hold Setup)
    function gate() {
        if (!loading) return Promise.resolve();
        const left = loadDeadline - Date.now();
        if (left <= 0) return Promise.resolve();
        return new Promise((resolve) => {
            gateWaiters.push(resolve);
            setTimeout(resolve, left);
        });
    }

    // ---- Setup finished while a game is open ----------------------------------------------------
    // The toolbar closes (Setup is done: no new game), minimized games come back, and the
    // message box opens behind the games with the one Restart now.
    function frontNotice() {
        if (!notice) return;
        notice.style.zIndex = String(++zTop);
        const b = notice.querySelector('.mg-button');
        if (b) { try { b.focus({ preventScroll: true }); } catch (_) { /* old browsers */ } }
    }

    function holdRestart(opts) {
        const upgrade = !!(opts && opts.upgrade);
        held = true;
        gameWindows().forEach((m) => { if (m.classList.contains('minimised') && !m.classList.contains('hidden')) restore(m); });
        hide();
        if (notice) notice.remove();
        notice = el('div', 'mg-window mg-notice');
        notice.setAttribute('role', 'alertdialog');
        notice.setAttribute('aria-label', 'Melaton Setup');
        const title = el('div', 'mg-title');
        title.appendChild(el('span', '', 'Melaton Setup'));
        notice.appendChild(title);
        const body = el('div', 'mg-notice-body');
        body.appendChild(el('div', 'mg-notice-icon'));
        const text = el('div', 'mg-notice-text');
        text.appendChild(el('p', 'mg-notice-heading', upgrade ? 'Melaton has been upgraded.' : 'Melaton has been installed.'));
        text.appendChild(el('p', '', upgrade
            ? 'Restart your computer to finish the upgrade. Your game stays open until you do.'
            : 'Restart your computer to finish the installation. Your game stays open until you do.'));
        body.appendChild(text);
        notice.appendChild(body);
        const actions = el('div', 'mg-notice-actions');
        const restart = el('button', 'mg-button', 'Restart now');
        restart.type = 'button';
        actions.appendChild(restart);
        notice.appendChild(actions);
        // behind every game window, and it does not take the focus while a game is open
        notice.style.zIndex = '2000';
        doc.body.appendChild(notice);
        if (!busy()) frontNotice();
        return new Promise((resolve) => {
            restart.addEventListener('click', () => {
                restart.disabled = true;
                resolve('restart');
            }, { once: true });
        });
    }

    installShims();
    root.MelatonGamesHost = { show, hide, busy, gate, holdRestart, games: GAMES.slice() };
})(window);
