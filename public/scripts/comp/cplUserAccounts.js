/**
 * Control Panel's User Accounts (Yukimi 2026-10-13): MeletonFX's two accounts as Vista shows
 * accounts (the VM's User Accounts and Manage Accounts pages).
 *
 *   Administrator   the admin PIN (wsClient.setAdminPin)
 *   Guest           the user PIN (wsClient.setUserPin); the guest account turns on and off with
 *                   user PIN login (wsClient.setUserPinLoginEnabled)
 *
 * Views inside the one page: the account list ("Choose the account you would like to change"),
 * an account ("Make changes to the … account": Change / Create the password, Change the
 * picture, Turn off / on the guest account), the password form and the picture chooser (Vista's
 * default pictures from the VM, or Browse for more pictures: drawn into 128x128 and uploaded).
 * Pictures live on the server (modules/accountPictures.js); the start menu shows the signed-in
 * account's (localStorage userType: admin = Administrator, otherwise Guest). Admins only change.
 * Admins also get "Use Vista Logon" under the list (wsClient.setUseVistaLogon, one server-wide
 * choice): the logon screen reads it from /status (websocket.js _setVistaLogon).
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-cpl';
    const NAMES = { administrator: 'Administrator', guest: 'Guest' };
    let registered = false;
    let main = null;
    let state = { view: 'list', account: null, picture: null, upload: null };
    let pins = null;
    let pictures = null;
    let defaults = [];

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function ws() {
        return root.wsClient || null;
    }

    function isAdmin() {
        try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; }
    }

    function currentAccount() {
        return isAdmin() ? 'administrator' : 'guest';
    }

    function pictureUrl(account) {
        const p = pictures && pictures[account];
        if (p && p.url) return p.url;
        return `/static_images/account-pictures/${account === 'guest' ? 'guest' : 'kitten'}.png`;
    }

    function toast(type, text) {
        if (typeof root.showGlassToast === 'function') root.showGlassToast(type, null, text, false, 4000);
    }

    // ---- data ----

    async function load() {
        const client = ws();
        if (!client) return;
        try {
            const res = await client.getAccountPictures();
            if (res && res.accounts) {
                pictures = res.accounts;
                defaults = res.defaults || defaults;
                applyStartMenuPicture();
            }
        } catch (_err) { /* the defaults show */ }
        if (isAdmin()) {
            try {
                const res = await client.getPinSettings();
                if (res && res.success) pins = res;
            } catch (_err) { /* the facts read unknown */ }
        }
    }

    /** The start menu's user tile follows the signed-in account. */
    function applyStartMenuPicture() {
        if (typeof document === 'undefined') return;
        const img = document.querySelector('.start-menu-user-tile-picture');
        if (img && pictures) img.src = pictureUrl(currentAccount());
    }

    // ---- views ----

    function tile(account, big) {
        const lines = [];
        if (account === 'administrator') {
            lines.push('Administrator');
            if (pins && pins.adminPinConfigured) lines.push('Password protected');
        } else {
            lines.push(pins && pins.userPinLoginEnabled === false ? 'Guest account is off' : 'Guest account is on');
            if (pins && pins.userPinConfigured) lines.push('Password protected');
        }
        return `
            <div class="cpl-ua-tile${big ? ' cpl-ua-tile--big' : ''}${account === 'guest' && pins && pins.userPinLoginEnabled === false ? ' is-off' : ''}" ${big ? '' : `role="button" tabindex="0" data-cpl-ua="open" data-cpl-ua-account="${account}"`}>
                <span class="cpl-ua-picture"><img src="${esc(pictureUrl(account))}" alt=""><img class="cpl-ua-frame" src="${ART}/usertile-frame-48.png" alt=""></span>
                <span class="cpl-ua-tile-text">
                    <span class="cpl-ua-name">${esc(NAMES[account])}</span>
                    ${lines.map((l, i) => `<span class="${i === 0 ? 'cpl-ua-type' : 'cpl-ua-sub'}">${esc(l)}</span>`).join('')}
                </span>
            </div>`;
    }

    function link(label, action, shield) {
        return `<li><button type="button" class="cpl-link cpl-ua-link" data-cpl-ua="${action}">${shield ? `<img src="${ART}/shield-uac-16.png" alt="">` : '<span class="cpl-ua-link-pad"></span>'}${esc(label)}</button></li>`;
    }

    /** Use Vista Logon (config.useVistaLogon, one choice for the server): the Control Panel check box. */
    function vistaLogonOption() {
        const on = !!(pins && pins.useVistaLogon);
        return `
            <div class="cpl-settings-host">
                <div class="desktop-settings-option">
                    <button type="button" class="btn-secondary toggle-btn icon-only indicator" data-cpl-ua="vista-logon" data-state="${on ? 'on' : 'off'}" aria-pressed="${on}" aria-label="Use Vista Logon"></button>
                    <div class="desktop-settings-option-body">
                        <span class="desktop-settings-option-label">Use Vista Logon</span>
                        <p class="desktop-settings-hint">Start at the Windows Vista Welcome screen instead of the Classic logon dialog. The connection and startup windows use Windows Vista Basic. Applies to every computer that signs in to this server.</p>
                    </div>
                </div>
            </div>`;
    }

    function listView() {
        return `
            <h1 class="cpl-page-title">Choose the account you would like to change</h1>
            <div class="cpl-ua-list">${tile('administrator')}${tile('guest')}</div>
            ${isAdmin() ? vistaLogonOption() : '<p class="cpl-ua-note">Sign in as the Administrator to change these accounts.</p>'}`;
    }

    function accountView() {
        const a = state.account;
        const hasPin = a === 'administrator' ? pins && pins.adminPinConfigured : pins && pins.userPinConfigured;
        const links = [
            link(hasPin ? 'Change the password' : 'Create a password', 'password', true),
            link('Change the picture', 'picture', true)
        ];
        if (a === 'guest') links.push(link(pins && pins.userPinLoginEnabled === false ? 'Turn on the guest account' : 'Turn off the guest account', 'guest-toggle', true));
        links.push('<li class="cpl-ua-gap"></li>', link('Manage another account', 'list', false));
        return `
            <h1 class="cpl-page-title">Make changes to the ${esc(NAMES[a])} account</h1>
            <div class="cpl-ua-account">
                <ul class="cpl-ua-links">${links.join('')}</ul>
                ${tile(a, true)}
            </div>`;
    }

    function passwordView() {
        const a = state.account;
        return `
            <h1 class="cpl-page-title">Change the ${esc(NAMES[a])} account's password</h1>
            <div class="cpl-ua-form">
                ${tile(a, true)}
                <p>Signing in to MeletonFX as ${esc(NAMES[a])} asks for this password (PIN).</p>
                <input type="password" class="cpl-ua-input" data-cpl-ua-field="pin" placeholder="New password" autocomplete="new-password">
                <input type="password" class="cpl-ua-input" data-cpl-ua-field="confirm" placeholder="Confirm new password" autocomplete="new-password">
                <p class="cpl-ua-error hidden" data-cpl-ua-error></p>
                <div class="cpl-ua-buttons">
                    <button type="button" class="cpl-wu-button" data-cpl-ua="password-save">Change password</button>
                    <button type="button" class="cpl-wu-button" data-cpl-ua="account">Cancel</button>
                </div>
            </div>`;
    }

    function pictureView() {
        const a = state.account;
        const chosen = state.picture || (pictures && pictures[a] && pictures[a].picture) || null;
        const preview = state.upload || (chosen && chosen !== 'custom' ? `/static_images/account-pictures/${chosen}.png` : pictureUrl(a));
        return `
            <h1 class="cpl-page-title">Choose a new picture for the ${esc(NAMES[a])} account</h1>
            <div class="cpl-ua-form">
                <div class="cpl-ua-tile cpl-ua-tile--big">
                    <span class="cpl-ua-picture"><img src="${esc(preview)}" alt=""><img class="cpl-ua-frame" src="${ART}/usertile-frame-48.png" alt=""></span>
                    <span class="cpl-ua-tile-text"><span class="cpl-ua-name">${esc(NAMES[a])}</span></span>
                </div>
                <p>The picture you choose will appear on the Welcome screen and on the Start menu.</p>
                <div class="cpl-ua-gallery" role="listbox">${(defaults.length ? defaults : ['music', 'starfish', 'leaf', 'robot', 'fish', 'bonsai', 'sports', 'dog', 'chess', 'kitten', 'fireworks', 'guest', 'user']).map((name) => `
                    <button type="button" class="cpl-ua-choice${chosen === name && !state.upload ? ' is-selected' : ''}" data-cpl-ua="choose" data-cpl-ua-picture="${esc(name)}" title="${esc(name)}">
                        <img src="/static_images/account-pictures/${esc(name)}.png" alt="">
                    </button>`).join('')}
                </div>
                <p><button type="button" class="cpl-link" data-cpl-ua="browse">Browse for more pictures...</button></p>
                <input type="file" accept="image/*" class="hidden" data-cpl-ua-file>
                <div class="cpl-ua-buttons">
                    <button type="button" class="cpl-wu-button" data-cpl-ua="picture-save">Change Picture</button>
                    <button type="button" class="cpl-wu-button" data-cpl-ua="account">Cancel</button>
                </div>
            </div>`;
    }

    function paint() {
        if (!main || !main.isConnected) return;
        const host = main.querySelector('.cpl-ua-page');
        if (!host) return;
        const views = { list: listView, account: accountView, password: passwordView, picture: pictureView };
        host.innerHTML = (views[state.view] || listView)();
    }

    function go(view, account) {
        if (account) state.account = account;
        if (view !== 'list' && view !== 'account' && !isAdmin()) {
            toast('warning', 'Only the Administrator can change accounts.');
            return;
        }
        state.view = view;
        if (view !== 'picture') { state.picture = null; state.upload = null; }
        paint();
    }

    /** Draw an upload into 128x128 (centre crop) as a PNG data URL, as Vista sizes account pictures. */
    function toTile(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const size = Math.min(img.naturalWidth, img.naturalHeight);
                const canvas = document.createElement('canvas');
                canvas.width = 128;
                canvas.height = 128;
                canvas.getContext('2d').drawImage(img, (img.naturalWidth - size) / 2, (img.naturalHeight - size) / 2, size, size, 0, 0, 128, 128);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture')); };
            img.src = url;
        });
    }

    async function act(action, el) {
        const client = ws();
        if (action === 'open') return go('account', el.dataset.cplUaAccount);
        if (action === 'list' || action === 'account' || action === 'password' || action === 'picture') return go(action);
        if (action === 'guest-toggle' && client) {
            const enable = pins && pins.userPinLoginEnabled === false;
            try {
                const res = await client.setUserPinLoginEnabled(enable);
                if (res && res.success) pins.userPinLoginEnabled = res.userPinLoginEnabled;
            } catch (_err) { toast('error', 'The guest account could not be changed.'); }
            return paint();
        }
        if (action === 'vista-logon' && client && isAdmin()) {
            const enable = !(pins && pins.useVistaLogon);
            try {
                const res = await client.setUseVistaLogon(enable);
                if (res && res.success) pins = { ...(pins || {}), useVistaLogon: res.useVistaLogon };
            } catch (_err) { toast('error', 'The logon setting could not be changed.'); }
            return paint();
        }
        if (action === 'password-save' && client) {
            const pin = main.querySelector('[data-cpl-ua-field="pin"]').value.trim();
            const confirm = main.querySelector('[data-cpl-ua-field="confirm"]').value.trim();
            const error = main.querySelector('[data-cpl-ua-error]');
            const fail = (text) => { error.textContent = text; error.classList.remove('hidden'); };
            if (!pin) return fail('Type a new password.');
            if (pin !== confirm) return fail('The passwords you typed do not match. Please retype them.');
            try {
                const res = state.account === 'administrator' ? await client.setAdminPin(pin) : await client.setUserPin(pin);
                if (!res || !res.success) return fail('The password could not be changed.');
                if (state.account === 'administrator') pins.adminPinConfigured = true; else pins.userPinConfigured = true;
                return go('account');
            } catch (_err) { return fail('The password could not be changed.'); }
        }
        if (action === 'choose') {
            state.picture = el.dataset.cplUaPicture;
            state.upload = null;
            return paint();
        }
        if (action === 'browse') {
            const input = main.querySelector('[data-cpl-ua-file]');
            if (!input) return undefined;
            input.onchange = async () => {
                const file = input.files && input.files[0];
                if (!file) return;
                try {
                    state.upload = await toTile(file);
                    state.picture = 'custom';
                    paint();
                } catch (err) { toast('error', err.message); }
            };
            input.click();
            return undefined;
        }
        if (action === 'picture-save' && client) {
            const picture = state.picture;
            if (!picture) return go('account');
            try {
                const res = await client.setAccountPicture(state.account, picture, picture === 'custom' ? state.upload : null);
                if (res && res.accounts) {
                    pictures = res.accounts;
                    applyStartMenuPicture();
                }
                return go('account');
            } catch (err) {
                toast('error', (err && err.message) || 'The picture could not be changed.');
            }
        }
        return undefined;
    }

    async function mount(el) {
        main = el;
        state = { view: 'list', account: null, picture: null, upload: null };
        paint();
        await load();
        paint();
        const modal = el.closest('.modal');
        if (modal && !modal.dataset.cplUaWired) {
            modal.dataset.cplUaWired = '1';
            modal.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-cpl-ua]');
                if (b && modal.contains(b)) act(b.dataset.cplUa, b);
            });
            modal.addEventListener('keydown', (ev) => {
                const b = ev.target.closest && ev.target.closest('[data-cpl-ua="open"]');
                if (b && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); act('open', b); }
            });
        }
    }

    function unmount() {
        main = null;
    }

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerItem({
            id: 'user-accounts',
            name: 'User Accounts',
            image: `${ART}/users-32.png`,
            description: 'Change the Administrator and Guest accounts: passwords, pictures, the guest account.',
            open: () => cpl.open('user-accounts')
        });
        cpl.registerPage('user-accounts', {
            title: () => 'User Accounts',
            tasks: () => `
                <div class="cpl-task-group cpl-task-group--see-also">
                    <h3 class="cpl-task-heading">See also</h3>
                    <ul class="cpl-task-list">
                        ${cpl.taskLinkHtml('Dreamscape Services', 'nav', 'authentication')}
                    </ul>
                </div>`,
            body: () => '<div class="cpl-ua-page"></div>',
            mount,
            unmount
        });
        return true;
    }

    // the start menu's picture once the session is up, and whenever an administrator changes one
    function watchStartMenu() {
        let tries = 0;
        const timer = setInterval(() => {
            const client = ws();
            tries += 1;
            if (client && client.isConnected && client.isConnected() && client.initializationCompleted) {
                clearInterval(timer);
                load();
                if (typeof client.on === 'function') {
                    client.on('account_pictures_changed', (msg) => {
                        if (msg && msg.data && msg.data.accounts) {
                            pictures = msg.data.accounts;
                            applyStartMenuPicture();
                        }
                    });
                }
            } else if (tries > 120) {
                clearInterval(timer);
            }
        }, 1000);
    }

    root.cplUserAccounts = { register, open: () => register() && root.melatonControlPanel.open('user-accounts'), _test: {
        tile: (a, p, pics) => { pins = p; pictures = pics; return tile(a); },
        view: (name, st, p, pics) => {
            pins = p; pictures = pics; state = { view: name, account: null, picture: null, upload: null, ...st };
            return ({ list: listView, account: accountView, password: passwordView, picture: pictureView })[name]();
        }
    } };
    if (typeof document !== 'undefined') {
        const start = () => { register(); watchStartMenu(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplUserAccounts;
})(typeof window !== 'undefined' ? window : globalThis);
