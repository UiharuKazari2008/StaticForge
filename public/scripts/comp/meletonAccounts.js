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

    let accounts = readCache();
    let loaded = false;
    let loading = null;
    let watching = false;

    function writeCache() {
        try {
            // an uploaded picture is a 128x128 PNG data URL: small enough to keep with the names
            const slim = {};
            Object.keys(accounts).forEach((a) => {
                const row = accounts[a] || {};
                slim[a] = { name: row.name, url: typeof row.url === 'string' && row.url.length < 400000 ? row.url : null };
            });
            if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
        } catch (_) { /* private mode */ }
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
        let tries = 0;
        const timer = setInterval(() => {
            const client = ws();
            tries += 1;
            if (client && client.isConnected && client.isConnected() && client.initializationCompleted) {
                clearInterval(timer);
                refresh();
                if (typeof client.on === 'function') {
                    client.on('account_pictures_changed', (msg) => {
                        if (msg && msg.data && msg.data.accounts) set(msg.data.accounts);
                    });
                }
            } else if (tries > 300) {
                clearInterval(timer);
            }
        }, 1000);
    }

    const api = { current, name, pictureUrl, refresh, setName, set, setLogonName, apply, matchesLogonName, isLoaded: () => loaded, DEFAULT_NAMES };
    root.meletonAccounts = api;
    root.meletonAccountName = (account) => name(account);

    if (doc) {
        const start = () => { apply(); watch(); };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
        else start();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
