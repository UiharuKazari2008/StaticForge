/**
 * Melaton's two accounts as the rest of the desktop shows them: each account's name (User
 * Accounts' Change the account name) and picture (Change the picture). One source, so the
 * Start menu, the Welcome screen and logon dialog, the lock screen, the About box, the System
 * page and the games all agree.
 *
 *   meletonAccounts.current()        'administrator' | 'guest' (localStorage userType)
 *   meletonAccounts.name(account?)   the account's name (default: the signed-in one)
 *   meletonAccounts.pictureUrl(account?)
 *   meletonAccounts.refresh()        fetch from the server (get_account_pictures)
 *   meletonAccounts.setName(account, name)
 *   window.meletonAccountName()      the signed-in account's name
 *
 * The server keeps both (modules/accountPictures.js, config.json accountNames / accountPictures)
 * and pushes account_pictures_changed after a change. The last answer is kept in localStorage,
 * so the Welcome screen and the Start menu show the right name and picture before the session is
 * up; /status logonName refreshes the Administrator's name for the logon screen. Changes fire
 * 'meletonaccountschange' on window.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const STORAGE_KEY = 'meletonAccounts';
    const DEFAULT_NAMES = { administrator: 'Administrator', guest: 'Guest' };
    const DEFAULT_PICTURES = { administrator: '/static_images/account-pictures/kitten.png', guest: '/static_images/account-pictures/guest.png' };

    function readCache() {
        try {
            const raw = root.localStorage ? root.localStorage.getItem(STORAGE_KEY) : null;
            const data = raw ? JSON.parse(raw) : null;
            return data && typeof data === 'object' ? data : {};
        } catch (_) {
            return {};
        }
    }

    // An uploaded picture is a 128x128 PNG data URL (~60 KB). It lives in IndexedDB: in localStorage
    // every page of the origin loaded it with its first storage read (#849). localStorage keeps the
    // names, the built-in pictures' paths and an `inline` mark; the picture itself arrives a moment
    // after this script and apply() puts it on screen. Without IndexedDB it stays in localStorage.
    const PICTURE_DB = 'meletonAccountPictures';
    let pictureDbP = null;
    function pictureDb() {
        if (!pictureDbP) {
            pictureDbP = new Promise((resolve) => {
                try {
                    if (!root.indexedDB) { resolve(null); return; }
                    const r = root.indexedDB.open(PICTURE_DB, 1);
                    r.onupgradeneeded = () => r.result.createObjectStore('p');
                    r.onsuccess = () => {
                        r.result.onversionchange = () => { try { r.result.close(); } catch (_) { /* closed */ } pictureDbP = null; };
                        resolve(r.result);
                    };
                    r.onerror = () => resolve(null);
                    r.onblocked = () => resolve(null);
                } catch (_) { resolve(null); }
            });
        }
        return pictureDbP;
    }
    const isInline = (url) => typeof url === 'string' && url.startsWith('data:');

    let accounts = readCache();
    let loaded = false;
    let loading = null;
    let watching = false;

    function writeCache() {
        const rows = {};
        Object.keys(accounts).forEach((a) => { rows[a] = { ...(accounts[a] || {}) }; });
        const slimFor = (inDb) => {
            const slim = {};
            Object.keys(rows).forEach((a) => {
                const row = rows[a];
                const keep = typeof row.url === 'string' && row.url.length < 400000 ? row.url : null;
                if (inDb && (isInline(keep) || (row.inline && !row.url))) slim[a] = { name: row.name, url: null, inline: 1 };
                else slim[a] = { name: row.name, url: keep };
            });
            return slim;
        };
        const store = (slim) => {
            try {
                if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
            } catch (_) { /* private mode */ }
        };
        if (!root.indexedDB) { store(slimFor(false)); return; }
        void pictureDb().then((db) => {
            if (!db) { store(slimFor(false)); return; }
            try {
                const tx = db.transaction('p', 'readwrite');
                const os = tx.objectStore('p');
                Object.keys(rows).forEach((a) => {
                    const row = rows[a];
                    if (isInline(row.url) && row.url.length < 400000) os.put(row.url, a);
                    else if (!(row.inline && !row.url)) os.delete(a);
                });
                // the mark is written only once the pictures are stored
                tx.oncomplete = () => store(slimFor(true));
                tx.onerror = () => store(slimFor(false));
                tx.onabort = () => store(slimFor(false));
            } catch (_) { store(slimFor(false)); }
        });
    }

    // the stored pictures, once per page; a copy still in localStorage (earlier builds) moves over
    function loadPictures() {
        const waiting = Object.keys(accounts).filter((a) => accounts[a] && accounts[a].inline && !accounts[a].url);
        const legacy = Object.keys(accounts).some((a) => accounts[a] && isInline(accounts[a].url));
        if (legacy && root.indexedDB) writeCache();
        if (!waiting.length || !root.indexedDB) return;
        void pictureDb().then((db) => {
            if (!db) return;
            let changed = false;
            let left = waiting.length;
            const done = () => { left -= 1; if (!left && changed) apply(); };
            waiting.forEach((a) => {
                try {
                    const g = db.transaction('p').objectStore('p').get(a);
                    g.onsuccess = () => {
                        const row = accounts[a];
                        // a server answer that came first wins
                        if (isInline(g.result) && row && row.inline && !row.url) {
                            accounts = { ...accounts, [a]: { ...row, url: g.result } };
                            changed = true;
                        }
                        done();
                    };
                    g.onerror = done;
                } catch (_) { done(); }
            });
        });
    }

    function current() {
        try {
            return root.localStorage && root.localStorage.getItem('userType') === 'admin' ? 'administrator' : 'guest';
        } catch (_) {
            return 'guest';
        }
    }

    function name(account) {
        const a = account || current();
        const row = accounts[a];
        return (row && typeof row.name === 'string' && row.name.trim()) || DEFAULT_NAMES[a] || '';
    }

    function pictureUrl(account) {
        const a = account || current();
        const row = accounts[a];
        return (row && row.url) || DEFAULT_PICTURES[a] || DEFAULT_PICTURES.guest;
    }

    /** Is this what someone typed for the account at a logon prompt? Its name or the built-in one. */
    function matchesLogonName(typed, account = 'administrator') {
        const t = String(typed || '').trim().toLowerCase();
        return !!t && (t === name(account).toLowerCase() || t === String(DEFAULT_NAMES[account]).toLowerCase());
    }

    /** Push the names and pictures into what is already on screen. */
    function apply() {
        if (!doc) return;
        const tile = doc.querySelector('.start-menu-user-tile-picture');
        const url = pictureUrl();
        if (tile && tile.getAttribute('src') !== url) tile.setAttribute('src', url);
        const userPlace = doc.querySelector('.start-menu-place.is-user');
        if (userPlace && userPlace.textContent !== name()) {
            userPlace.textContent = name();
            userPlace.title = name();
        }
        const owner = doc.getElementById('aboutWindowsOwner');
        if (owner && owner.textContent === DEFAULT_NAMES.administrator && name('administrator') !== DEFAULT_NAMES.administrator) {
            owner.textContent = name('administrator');
        }
        try {
            root.dispatchEvent(new CustomEvent('meletonaccountschange', { detail: { accounts: JSON.parse(JSON.stringify(accounts)) } }));
        } catch (_) { /* old browsers */ }
    }

    function set(next) {
        if (!next || typeof next !== 'object') return;
        accounts = { ...accounts };
        Object.keys(next).forEach((a) => {
            const row = next[a] || {};
            accounts[a] = { ...(accounts[a] || {}), ...row };
            if ('url' in row) delete accounts[a].inline;
        });
        loaded = true;
        writeCache();
        apply();
    }

    /** The Administrator's name from /status (websocket.js), before anyone signs in. */
    function setLogonName(value) {
        if (typeof value !== 'string' || !value.trim()) return;
        if (name('administrator') === value.trim()) return;
        set({ administrator: { name: value.trim() } });
    }

    function ws() {
        return root.wsClient || null;
    }

    async function refresh() {
        const client = ws();
        if (!client || typeof client.getAccountPictures !== 'function') return accounts;
        if (loading) return loading;
        loading = (async () => {
            try {
                const res = await client.getAccountPictures();
                if (res && res.accounts) set(res.accounts);
            } catch (_) { /* the cached names show */ }
            loading = null;
            return accounts;
        })();
        return loading;
    }

    async function setName(account, value) {
        const client = ws();
        if (!client) throw new Error('Not connected');
        const res = await client.sendMessage('set_account_name', { account, name: value });
        if (res && res.accounts) set(res.accounts);
        return res;
    }

    // once the session is up: the server's answer, and every later change
    function watch() {
        if (watching) return;
        watching = true;
        let started = false;
        const tryStart = () => {
            if (started) return true;
            const client = ws();
            if (!(client && client.isConnected && client.isConnected() && client.initializationCompleted)) return false;
            started = true;
            refresh();
            if (typeof client.on === 'function') {
                client.on('account_pictures_changed', (msg) => {
                    if (msg && msg.data && msg.data.accounts) set(msg.data.accounts);
                });
            }
            return true;
        };
        if (tryStart()) return;
        // the shells say when the session is up; this was a 1 s timer for up to five minutes (#849)
        // (a few spaced tries after them: the last boot steps may still be running)
        const after = () => [0, 2000, 6000, 15000].forEach((ms) => setTimeout(tryStart, ms));
        ['desktopBootDone', 'wmBootDone'].forEach((type) => doc.addEventListener(type, after, { once: true }));
        // and a socket that comes up after those tries (it dropped at the boot): its connected event, not a
        // minute timer for ten minutes (#890)
        const client = ws();
        if (client && typeof client.on === 'function') {
            const onConnected = () => {
                if (tryStart()) { if (typeof client.off === 'function') client.off('connected', onConnected); return; }
                after();
            };
            client.on('connected', onConnected);
        }
    }

    const api = { current, name, pictureUrl, refresh, setName, set, setLogonName, apply, matchesLogonName, isLoaded: () => loaded, DEFAULT_NAMES };
    root.meletonAccounts = api;
    root.meletonAccountName = (account) => name(account);

    loadPictures();
    if (doc) {
        const start = () => { apply(); watch(); };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
        else start();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
