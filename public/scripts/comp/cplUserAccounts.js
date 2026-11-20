/**
 * Control Panel's User Accounts (Yukimi 2026-10-13): Melaton's two accounts as Vista shows
 * accounts (the VM's User Accounts and Manage Accounts pages).
 *
 *   Administrator   the admin PIN (wsClient.setAdminPin)
 *   Guest           the user PIN (wsClient.setUserPin); the guest account turns on and off with
 *                   user PIN login (wsClient.setUserPinLoginEnabled)
 *
 * Views inside the one page: the account list ("Choose the account you would like to change"),
 * an account ("Make changes to … account": Change the account name, Change / Create the
 * password, Change the picture, Turn off / on the guest account), the rename form ("Type a new
 * account name", as the VM's Change Your Name page), the password form and the picture chooser
 * (Vista's default pictures from the VM, or Browse for more pictures: drawn into 128x128 and
 * uploaded). Names and pictures live on the server (modules/accountPictures.js) and reach the rest
 * of the desktop through meletonAccounts.js (the Start menu, the Welcome screen, the lock screen,
 * the About box show the signed-in account's: localStorage userType admin = Administrator,
 * otherwise Guest). Admins only change.
 * Admins also get "Use Vista Logon" under the list (wsClient.setUseVistaLogon, one server-wide
 * choice): the logon screen reads it from /status (websocket.js _setVistaLogon).
 *
 * `control userpasswords2` / netplwiz (openUserPasswords2): Vista's User Accounts sheet from its own templates
 * (netplwiz.dll.mui 105 Users, 118 Advanced, 113 Automatically Log On). "Users must enter a user name and password
 * to use this computer" is this computer's logon policy (cachedLogon.requireLogon, Yukimi Nov 19 2026): on, every
 * start stops at the logon for the password; off, the computer signs in by itself (the session, or offline its
 * cached logon) - turning it off asks for the password first, as Vista's Automatically Log On does.
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-cpl';
    const NAMES = { administrator: 'Administrator', guest: 'Guest' };
    // account names may be changed (meletonAccounts.js); NAMES are the built-in ones

    function nameOf(account) {
        const accounts = root.meletonAccounts;
        return accounts ? accounts.name(account) : NAMES[account];
    }

    /** "Yukimi's" / "Administrator's", for Vista's page titles. */
    function possessive(account) {
        const n = nameOf(account);
        return /s$/i.test(n) ? `${n}'` : `${n}'s`;
    }
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
        if (root.meletonAccounts) return root.meletonAccounts.pictureUrl(account);
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

    /** The rest of the desktop follows (the Start menu's tile and name, the logon and lock screens). */
    function applyStartMenuPicture() {
        if (pictures && root.meletonAccounts) root.meletonAccounts.set(pictures);
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
                    <span class="cpl-ua-name">${esc(nameOf(account))}</span>
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
                        <p class="desktop-settings-hint">Start at the Melaton Welcome screen instead of the Classic logon dialog. The connection and startup windows use Melaton Basic. Applies to every computer that signs in to this server.</p>
                    </div>
                </div>
                ${skipMinimumOption()}
            </div>`;
    }

    /**
     * "Decrease Login Time by skipping Minimum Login Time" (config.skipMinimumLogonTime, one choice for the server;
     * Yukimi, Nov 20 2026, #910): the logon's statuses show only as long as they are true (websocket.js
     * _skipMinimumLogon). Beside Use Vista Logon.
     */
    function skipMinimumOption() {
        const on = !!(pins && pins.skipMinimumLogonTime);
        return `
                <div class="desktop-settings-option">
                    <button type="button" class="btn-secondary toggle-btn icon-only indicator" data-cpl-ua="skip-minimum" data-state="${on ? 'on' : 'off'}" aria-pressed="${on}" aria-label="Decrease Login Time by skipping Minimum Login Time"></button>
                    <div class="desktop-settings-option-body">
                        <span class="desktop-settings-option-label">Decrease Login Time by skipping Minimum Login Time</span>
                        <p class="desktop-settings-hint">The logon screens show each step only for as long as it takes, instead of for their minimum time. Applies to every computer that signs in to this server, from its next start.</p>
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
        // the signed-in account in Vista's own words (the VM's "Make changes to your user account")
        const own = a === currentAccount();
        const links = own ? [
            link(hasPin ? 'Change your password' : 'Create a password for your account', 'password', true),
            link('Change your picture', 'picture', true),
            link('Change your account name', 'rename', true)
        ] : [
            link('Change the account name', 'rename', true),
            link(hasPin ? 'Change the password' : 'Create a password', 'password', true),
            link('Change the picture', 'picture', true)
        ];
        if (a === 'guest') links.push(link(pins && pins.userPinLoginEnabled === false ? 'Turn on the guest account' : 'Turn off the guest account', 'guest-toggle', true));
        links.push('<li class="cpl-ua-gap"></li>', link('Manage another account', 'list', false));
        return `
            <h1 class="cpl-page-title">${own ? 'Make changes to your user account' : `Make changes to ${esc(possessive(a))} account`}</h1>
            <div class="cpl-ua-account">
                <ul class="cpl-ua-links">${links.join('')}</ul>
                ${tile(a, true)}
            </div>`;
    }

    /** Vista's Change Your Name page: the tile, "New account name", Change Name / Cancel. */
    function renameView() {
        const a = state.account;
        const own = a === currentAccount();
        return `
            <h1 class="cpl-page-title">${own ? 'Type a new account name' : `Type a new account name for ${esc(possessive(a))} account`}</h1>
            <div class="cpl-ua-form">
                ${tile(a, true)}
                <input type="text" class="cpl-ua-input" data-cpl-ua-field="name" placeholder="New account name" maxlength="20" autocomplete="off" spellcheck="false">
                <p>This name will appear on the Welcome screen and on the Start menu.</p>
                <p class="cpl-ua-error hidden" data-cpl-ua-error></p>
                <div class="cpl-ua-buttons">
                    <button type="button" class="cpl-wu-button" data-cpl-ua="rename-save">Change Name</button>
                    <button type="button" class="cpl-wu-button" data-cpl-ua="account">Cancel</button>
                </div>
            </div>`;
    }

    function passwordView() {
        const a = state.account;
        return `
            <h1 class="cpl-page-title">Change ${esc(possessive(a))} password</h1>
            <div class="cpl-ua-form">
                ${tile(a, true)}
                <p>Signing in to Melaton as ${esc(nameOf(a))} asks for this password (PIN).</p>
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
            <h1 class="cpl-page-title">Choose a new picture for ${esc(possessive(a))} account</h1>
            <div class="cpl-ua-form">
                <div class="cpl-ua-tile cpl-ua-tile--big">
                    <span class="cpl-ua-picture"><img src="${esc(preview)}" alt=""><img class="cpl-ua-frame" src="${ART}/usertile-frame-48.png" alt=""></span>
                    <span class="cpl-ua-tile-text"><span class="cpl-ua-name">${esc(nameOf(a))}</span></span>
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
        const views = { list: listView, account: accountView, rename: renameView, password: passwordView, picture: pictureView };
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
        if (view === 'rename') {
            const input = main && main.querySelector('[data-cpl-ua-field="name"]');
            if (input) input.focus();
        }
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
        if (action === 'list' || action === 'account' || action === 'rename' || action === 'password' || action === 'picture') return go(action);
        if (action === 'rename-save') {
            const value = main.querySelector('[data-cpl-ua-field="name"]').value.trim();
            const error = main.querySelector('[data-cpl-ua-error]');
            const fail = (text) => { error.textContent = text; error.classList.remove('hidden'); };
            if (!value) return fail('Type a new account name.');
            if (/["/\\[\]:;|=,+*?<>@]/.test(value)) return fail('The name cannot contain any of these characters: " / \\ [ ] : ; | = , + * ? < > @');
            if (!root.meletonAccounts) return fail('The account name could not be changed.');
            try {
                const res = await root.meletonAccounts.setName(state.account, value);
                if (res && res.accounts) pictures = res.accounts;
                return go('account');
            } catch (err) {
                return fail((err && err.message && !/^Request timeout|Unknown message/i.test(err.message)) ? err.message : 'The account name could not be changed. The server may need a restart to offer this.');
            }
        }
        if (action === 'guest-toggle' && client) {
            const enable = pins && pins.userPinLoginEnabled === false;
            try {
                const res = await client.setUserPinLoginEnabled(enable);
                if (res && res.success) pins.userPinLoginEnabled = res.userPinLoginEnabled;
            } catch (_err) { toast('error', 'The guest account could not be changed.'); }
            return paint();
        }
        if (action === 'skip-minimum' && client && isAdmin()) {
            const enable = !(pins && pins.skipMinimumLogonTime);
            try {
                const res = await client.setSkipMinimumLogonTime(enable);
                if (res && res.success) pins = { ...(pins || {}), skipMinimumLogonTime: res.skipMinimumLogonTime };
            } catch (_err) { toast('error', 'The logon setting could not be changed.'); }
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
                if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('[data-cpl-ua-field="name"]')) {
                    ev.preventDefault();
                    act('rename-save', ev.target);
                    return;
                }
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
                        ${cpl.taskLinkHtml('Dreamscape CardSpace', 'item', 'authentication')}
                    </ul>
                </div>`,
            body: () => '<div class="cpl-ua-page"></div>',
            mount,
            unmount
        });
        return true;
    }

    // meletonAccounts.js keeps the Start menu, logon and lock screens current; this page repaints
    // when an administrator elsewhere changes a name or picture
    function watchAccounts() {
        if (typeof root.addEventListener !== 'function') return;
        root.addEventListener('meletonaccountschange', (ev) => {
            const next = ev && ev.detail && ev.detail.accounts;
            if (next && pictures) {
                Object.keys(next).forEach((acc) => { pictures[acc] = { ...(pictures[acc] || {}), ...next[acc] }; });
            }
            paint();
        });
    }

    // ---- control userpasswords2 (netplwiz) ----------------------------------------------------------------------
    const NP = '/static_images/vista-dlg';
    let upOpen = null;

    function npRows(lv, rows) {
        if (!lv) return;
        const doc = lv.ownerDocument;
        const head = lv.querySelector('.vdt-lv-header');
        const body = lv.querySelector('.vdt-lv-body');
        lv.classList.add('is-report');
        // the VM's columns: User Name 196 px, Group the rest
        const widths = [196, 196];
        head.replaceChildren(...['User Name', 'Group'].map((t, i) => {
            const c = doc.createElement('span');
            c.className = 'vdt-lv-col';
            c.style.width = `${widths[i]}px`;
            c.textContent = t;
            return c;
        }));
        body.replaceChildren(...rows.map((r, i) => {
            const row = doc.createElement('div');
            row.className = `vdt-lv-row${i === 0 ? ' is-selected' : ''}`;
            row.dataset.account = r.account;
            r.cells.forEach((t, j) => {
                const c = doc.createElement('span');
                c.style.width = `${widths[j]}px`;
                if (j === 0) {
                    const img = doc.createElement('img');
                    img.src = `${NP}/netplwiz-user-16.png`;
                    img.alt = '';
                    c.appendChild(img);
                }
                c.appendChild(doc.createTextNode(t));
                row.appendChild(c);
            });
            return row;
        }));
    }

    /** Vista's Automatically Log On: the account's password twice; resolves true when it signed in. */
    function askAutoLogon(owner) {
        const V = root.vistaDialogTemplate;
        if (!V) return Promise.resolve(false);
        return new Promise((resolve) => {
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            V.openDialog({
                id: 'autoLogon',
                key: 'netplwiz:113',
                owner,
                init: (ctx) => {
                    ctx.set(1010, nameOf('administrator'));
                    const pw = ctx.el(1013);
                    if (pw) setTimeout(() => { try { pw.focus(); } catch (_) { /* gone */ } }, 0);
                },
                ok: async (ctx) => {
                    const a = String(ctx.get(1013) || '');
                    const b = String(ctx.get(1009) || '');
                    const say = (text) => (typeof root.showConfirmationDialog === 'function'
                        ? root.showConfirmationDialog(text, [{ text: 'OK', value: true }], null, { title: 'Automatically Log On' })
                        : Promise.resolve());
                    // netplwiz's own strings
                    if (a !== b) { await say('The passwords you typed do not match. Type the same password in both text boxes.'); return false; }
                    const r = root.cachedLogon ? await root.cachedLogon.signIn(a) : { ok: false, error: 'The password could not be checked.' };
                    // Vista's wording for a wrong password; an offline computer that never signed in here says so
                    if (!r.ok || (r.userType && r.userType !== 'admin')) { await say(r.noCache ? r.error : 'The user name or password is incorrect.'); return false; }
                    finish(true);
                    return true;
                },
                cancel: () => finish(false)
            });
        });
    }

    function openUserPasswords2() {
        const V = root.vistaDialogTemplate;
        if (!V) return false;
        if (upOpen && upOpen.modal && upOpen.modal.isConnected) {
            if (typeof root.bringModalToFront === 'function') root.bringModalToFront(upOpen.modal);
            return true;
        }
        const required = !!(root.cachedLogon && root.cachedLogon.requireLogon());
        const rows = [{ account: 'administrator', cells: [nameOf('administrator'), 'Administrators'] }];
        if (!(pins && pins.userPinLoginEnabled === false)) rows.push({ account: 'guest', cells: [nameOf('guest'), 'Guests'] });
        upOpen = V.openSheet({
            id: 'userPasswords2',
            title: 'User Accounts',
            icon: `${ART}/users-32.png`,
            pages: [
                { key: 'netplwiz:105', overrides: {
                    1034: { image: `${NP}/netplwiz-user-32.png` },
                    // one Melaton logon account each; accounts are made on the server, not here
                    1014: { disabled: true }, 1003: { disabled: true }
                } },
                { key: 'netplwiz:118', overrides: {
                    // Melaton's logon has no Ctrl+Alt+Delete secure attention step to require
                    1048: { disabled: true }
                } }
            ],
            init: (ctx) => {
                ctx.set(1022, required);
                const lv = ctx.el(1001, 'netplwiz:105');
                npRows(lv, rows);
                const show = (account) => {
                    const name = nameOf(account);
                    ctx.text(1015, `Password for ${name}`);
                    // the signed-in account's own password changes from its account page (Vista: Ctrl+Alt+Del)
                    ctx.text(1019, account === currentAccount()
                        ? 'To change your password, open User Accounts in Control Panel and select Change your password.'
                        : `To change the password for ${name}, click Reset Password.`);
                    const reset = ctx.el(1021, 'netplwiz:105');
                    if (reset) reset.disabled = account === currentAccount() || !isAdmin();
                };
                show(rows[0].account);
                // the list has the focus when the sheet opens (the VM: its selection drawn in the highlight colour)
                if (lv) setTimeout(() => { try { lv.focus(); } catch (_) { /* gone */ } }, 0);
                if (lv) lv.addEventListener('change', () => { const sel = lv.querySelector('.vdt-lv-row.is-selected'); if (sel) show(sel.dataset.account); });
                const props = ctx.el(1017, 'netplwiz:105');
                if (props) props.addEventListener('click', () => { const sel = lv && lv.querySelector('.vdt-lv-row.is-selected'); state = { ...state, view: 'account', account: sel ? sel.dataset.account : 'administrator' }; if (root.melatonControlPanel) root.melatonControlPanel.open('user-accounts'); });
                const reset = ctx.el(1021, 'netplwiz:105');
                if (reset) reset.addEventListener('click', () => { const sel = lv && lv.querySelector('.vdt-lv-row.is-selected'); state = { ...state, view: 'password', account: sel ? sel.dataset.account : 'guest' }; if (root.melatonControlPanel) root.melatonControlPanel.open('user-accounts'); });
                const manage = ctx.el(1068, 'netplwiz:118');
                if (manage) manage.addEventListener('click', () => { if (root.melatonControlPanel) root.melatonControlPanel.open('authentication'); });
                const adv = ctx.el(1005, 'netplwiz:118');
                if (adv) adv.addEventListener('click', () => { state = { ...state, view: 'list' }; if (root.melatonControlPanel) root.melatonControlPanel.open('user-accounts'); });
            },
            apply: async (ctx) => {
                const want = !!ctx.get(1022);
                const now = !!(root.cachedLogon && root.cachedLogon.requireLogon());
                if (want === now || !root.cachedLogon) return;
                if (want) { root.cachedLogon.setRequireLogon(true); return; }
                // turning automatic logon on: the password first (Vista's Automatically Log On)
                if (await askAutoLogon(upOpen && upOpen.modal)) root.cachedLogon.setRequireLogon(false);
                else ctx.set(1022, true);
            },
            close: () => { upOpen = null; }
        });
        return true;
    }

    root.cplUserAccounts = { register, openUserPasswords2, open: () => register() && root.melatonControlPanel.open('user-accounts'), _test: {
        tile: (a, p, pics) => { pins = p; pictures = pics; return tile(a); },
        view: (name, st, p, pics) => {
            pins = p; pictures = pics; state = { view: name, account: null, picture: null, upload: null, ...st };
            return ({ list: listView, account: accountView, rename: renameView, password: passwordView, picture: pictureView })[name]();
        }
    } };
    if (typeof document !== 'undefined') {
        const start = () => { register(); watchAccounts(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplUserAccounts;
})(typeof window !== 'undefined' ? window : globalThis);
