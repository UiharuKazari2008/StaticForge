/**
 * Control Panel's Dreamscape CardSpace page (Yukimi 2026-10-13), laid out like Credential Manager's
 * vault: sections with a header strip (icon, title, "Add …" link on the right), each credential
 * a row (name, a status mark beside the name, a summary, a chevron) that opens into its details and actions.
 *
 *   Director Accounts   Cursor profiles for Wren and Xi (Add a Director account)
 *   Service Keys        the keys Dreamscape uses for outside services (Save changes)
 *   Application Keys    keys programs use to reach Dreamscape, requests waiting for approval,
 *                       the request log (Create an application key, View the request log)
 *   Custom Model Providers (Director)   URL, key, default model, Obliterated Memories, age tool
 *   Text Messaging      BlueBubbles servers (address, password, Test connection) and the RCS
 *                       account (Google Messages, paired with a QR code), Yozora #779
 *
 * PINs moved to User Accounts (cplUserAccounts.js) and approved IPs to Windows Defender
 * (cplDefender.js). The page runs its own copy of the Security Center driver
 * (securityCenterDsapApplet.js securityDsapDriver) on the applet's markup, which still loads and
 * acts; vault() turns each table into rows whenever the driver re-renders it, moving the cells'
 * own nodes so every button keeps its handler. Security Center loads on demand
 * (dsapRegistry.js ensureDsapEntryReady). Admins only.
 */
(function (root) {
    'use strict';

    const SECURITY_URL = 'security.dreamscape.jp';
    const ART = '/static_images/vista-cpl';

    /** The vault's sections: where the driver's header, buttons and tables are. */
    const VAULTS = [
        {
            id: 'director', title: 'Director Accounts', icon: 'users-16.png', status: 'secCursorAccountsStatus',
            links: [['secCursorAccountsAddBtn', 'Add a Director account']],
            tables: [{
                body: 'secCursorAccountsTableBody',
                // Status (who is using it, usage cap, sign-in) sits beside the name, not in this column.
                summary: () => '',
                empty: 'No Director accounts.'
            }]
        },
        {
            id: 'service', title: 'Service Keys', icon: 'key-16.png', status: 'secKeychainStatus',
            links: [['secKeychainSave', 'Save changes']],
            tables: [{ body: 'secKeychainTableBody', summary: [1], empty: 'No service keys.' }]
        },
        {
            id: 'application', title: 'Application Keys', icon: 'app-16.png', status: 'secAppkeysStatus',
            links: [['secAppkeysCreateBtn', 'Create an application key'], ['secAppkeysLogBtn', 'View the request log']],
            tables: [
                { body: 'secAppkeysPendingBody', summary: [1], caption: 'Waiting for your approval' },
                { body: 'secAppkeysTableBody', summary: [3, 4], empty: 'No application keys.' }
            ]
        }
    ];

    let driver = null;
    let hostEl = null;
    let observers = [];
    let registered = false;
    const open = new Set();

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    async function loadSecurityCenter() {
        if (typeof root.securityDsapBuildHtml === 'function' || typeof securityDsapBuildHtml === 'function') return true;
        if (typeof resolveDsap !== 'function' || typeof ensureDsapEntryReady !== 'function') return false;
        const match = resolveDsap(SECURITY_URL);
        if (!match) return false;
        return ensureDsapEntryReady(match.entry);
    }

    /** The slice of a Grimoire shell the driver uses (getRoot, path, query, navigate, menus). */
    function makeHost(rootEl) {
        return {
            cplAuthentication: true,
            getRoot: () => rootEl,
            getPathSegments: () => ['auth'],
            getQueryParam: () => null,
            // the other views stay in Security Center
            navigate: (url) => {
                if (typeof openDsapInGrimoire === 'function') openDsapInGrimoire(String(url).startsWith('dsap://') ? url : `dsap://${url}`);
            },
            registerContextMenuAction: () => {},
            registerContextMenuItems: () => {}
        };
    }

    // ---- the vault ----

    /** The header strip: icon and title left, the section's own buttons as links right. */
    function buildHeader(section) {
        const status = hostEl.querySelector(`#${section.status}`);
        const old = status && status.previousElementSibling && status.previousElementSibling.classList.contains('sec-dsap-section-hdr')
            ? status.previousElementSibling : null;
        const head = document.createElement('div');
        head.className = 'cpl-vault-head';
        head.id = `cplVault-${section.id}`;
        head.innerHTML = `<img src="${ART}/${section.icon}" alt=""><span class="cpl-vault-title">${esc(section.title)}</span><span class="cpl-vault-links"></span>`;
        const links = head.querySelector('.cpl-vault-links');
        section.links.forEach(([id, label]) => {
            const btn = hostEl.querySelector(`#${id}`);
            if (!btn) return;
            btn.classList.add('cpl-vault-link');
            btn.dataset.cplVaultLabel = label;
            btn.textContent = label;
            links.appendChild(btn);
        });
        const anchor = old || status;
        if (anchor) anchor.parentNode.insertBefore(head, anchor);
        if (old) old.classList.add('cpl-vault-replaced');
    }

    /** A row's name: its bold part (or first element), the rest as a grey subtitle. */
    function nameOf(cell) {
        // The profile initial (director-account-badge) is the colored badge in the details, not part of the title.
        const copy = cell.cloneNode(true);
        copy.querySelectorAll('.director-account-badge').forEach((el) => el.remove());
        const all = copy.textContent.trim().replace(/\s+/g, ' ');
        // "Name<br><span class=hint>description</span>" (service and application keys)
        const hint = cell.querySelector('.sec-dsap-setting-hint');
        if (hint) {
            const sub = hint.textContent.trim().replace(/\s+/g, ' ');
            // the hint follows the name: take it off the end (the name may contain the same text)
            const name = (all.endsWith(sub) ? all.slice(0, all.length - sub.length) : all.replace(sub, '')).replace(/\s+/g, ' ').trim();
            return { name: name || all, sub: name ? sub : '' };
        }
        const lead = copy.querySelector('strong, b') || [...copy.children].find((el) => el.textContent.trim().length > 1);
        const name = lead ? lead.textContent.trim().replace(/\s+/g, ' ') : all;
        let sub = all;
        const at = sub.indexOf(name);
        if (at >= 0) sub = (sub.slice(0, at) + sub.slice(at + name.length)).trim();
        return { name: name || all, sub: sub === name ? '' : sub };
    }

    const KEY_DOT_WORD = {
        ok: 'Working',
        fail: 'Not working',
        warn: 'Unconfirmed',
        checking: 'Checking',
        unchecked: 'Unchecked',
        none: 'Not set'
    };

    function keyDotState(className) {
        const match = String(className || '').match(/sec-key-dot-(ok|fail|warn|checking|unchecked|none)\b/);
        return match ? match[1] : 'unchecked';
    }

    /** Worst fact wins the color. The words are the dot's title, to the right of the selection. */
    function directorGlance(info) {
        const active = Array.isArray(info.active) ? info.active : [];
        const parts = [];
        let state = 'unchecked';
        if (active.length) {
            parts.push(`Active for ${active.join(' and ')}`);
            state = 'ok';
        }
        if (info.limited) {
            parts.push('Limited');
            state = 'warn';
        }
        if (info.loginNeeded) {
            parts.push('Sign in again');
            state = 'fail';
        }
        if (!parts.length) return { state: 'unchecked', label: 'Not in use', text: 'Not in use' };
        const text = parts.join(' · ');
        const label = info.limited && info.usageTitle ? `${text}. ${info.usageTitle}` : text;
        return { state, label, text };
    }

    function appKeyGlance(status) {
        const text = String(status || '').trim();
        if (text === 'active') return { state: 'ok', label: 'Active', text: 'Active' };
        if (text === 'refresh_required') return { state: 'warn', label: 'Refresh required', text: 'Refresh' };
        if (text === 'expired') return { state: 'fail', label: 'Expired', text: 'Expired' };
        if (text === 'revoked') return { state: 'fail', label: 'Revoked', text: 'Revoked' };
        return { state: 'unchecked', label: text || 'Unknown', text: text || 'Unknown' };
    }

    /** A persona cell shows Active with no Activate button while that profile is in use. */
    function personasInUse(cells) {
        return [[1, 'Wren'], [2, 'Xi']].filter(([i]) => {
            const cell = cells[i];
            return cell && !cell.querySelector('button') && /active/i.test(cell.textContent);
        }).map(([, persona]) => persona);
    }

    function serviceGlanceItems(tr, cells) {
        const items = [];
        if (tr.classList.contains('sec-keychain-row-locked')) {
            items.push({ state: 'fail', label: 'Locked', text: 'Locked' });
        }
        cells.forEach((td) => {
            td.querySelectorAll('.sec-key-dot').forEach((dot) => {
                const wrap = dot.closest('.sec-key-dot-wrap');
                const state = keyDotState(dot.className);
                const labelEl = wrap && wrap.querySelector('.sec-key-dot-label');
                const tagged = labelEl && labelEl.textContent.trim();
                const title = (wrap && wrap.getAttribute('title')) || KEY_DOT_WORD[state];
                items.push({ state, label: title, text: tagged || KEY_DOT_WORD[state] });
            });
        });
        if (!items.length) items.push({ state: 'unchecked', label: 'Not checked yet', text: 'Unchecked' });
        return items;
    }

    function rowGlance(spec, tr, cells) {
        if (spec.body === 'secCursorAccountsTableBody') {
            const usageEl = cells[4] && cells[4].querySelector('.not-set');
            return [directorGlance({
                loginNeeded: tr.classList.contains('sec-account-needs-login'),
                limited: !!usageEl,
                usageTitle: usageEl ? (usageEl.getAttribute('title') || '') : '',
                active: personasInUse(cells)
            })];
        }
        if (spec.body === 'secKeychainTableBody') return serviceGlanceItems(tr, cells);
        if (spec.body === 'secAppkeysTableBody') return [appKeyGlance(cells[3] ? cells[3].textContent : '')];
        if (spec.body === 'secAppkeysPendingBody') return [{ state: 'warn', label: 'Waiting for approval', text: 'Waiting' }];
        return [];
    }

    /** A colored dot only. The words stay on the dot's title. */
    function makeGlance(items) {
        const slot = document.createElement('span');
        slot.className = 'cpl-vault-status';
        items.forEach((item) => {
            const dot = document.createElement('span');
            dot.className = `sec-key-dot sec-key-dot-${item.state}`;
            dot.title = item.label;
            dot.setAttribute('role', 'img');
            dot.setAttribute('aria-label', item.label);
            slot.appendChild(dot);
        });
        return slot;
    }

    // Icon-only actions disappear in the vault (the icon is hidden). These words are the link text.
    const VAULT_ACTION_LABEL = {
        'edit-cursor-account': 'Edit',
        'delete-cursor-account': 'Delete',
        'copy-cursor-token': 'Copy',
        'capture-cursor-account': 'Capture',
        'keychain-edit': 'Edit',
        'keychain-add': 'Add',
        'keychain-delete': 'Delete',
        'keychain-unlock': 'Unlock',
        'edit-appkey': 'Edit',
        'revoke-appkey': 'Delete',
        'approve-appkey-req': 'Approve',
        'deny-appkey-req': 'Deny'
    };

    /** Keep the row id on each button (they leave the table) and give icon-only buttons a word. */
    function prepareVaultActions(tr) {
        tr.querySelectorAll('[data-sec-action]').forEach((btn) => {
            if (tr.dataset.secCursorAccId) btn.dataset.secCursorAccId = tr.dataset.secCursorAccId;
            if (tr.dataset.secKeychainService) btn.dataset.secKeychainService = tr.dataset.secKeychainService;
            if (tr.dataset.secAppkeyId) btn.dataset.secAppkeyId = tr.dataset.secAppkeyId;
            if (tr.dataset.secAppkeyReq) btn.dataset.secAppkeyReq = tr.dataset.secAppkeyReq;
            if (btn.textContent.trim()) return;
            const label = VAULT_ACTION_LABEL[btn.dataset.secAction];
            if (label) btn.append(document.createTextNode(label));
        });
    }

    function paintKeychainGlance(row, tr) {
        const slot = row.querySelector('.cpl-vault-status');
        const statusCell = tr.querySelector('.sec-keychain-status');
        if (!slot || !statusCell || !statusCell.querySelector('.sec-key-dot')) return;
        const fresh = makeGlance(serviceGlanceItems(tr, [...tr.children]));
        slot.replaceChildren(...fresh.childNodes);
        const lab = [...row.querySelectorAll('.cpl-vault-label')].find((el) => /^status:?$/i.test(el.textContent.trim()));
        const value = lab && lab.nextElementSibling;
        if (value && value.classList.contains('cpl-vault-value')) {
            value.replaceChildren(...[...statusCell.childNodes].map((node) => node.cloneNode(true)));
        }
    }

    /** One table as vault rows; rebuilt from the driver's rows each time it re-renders them. */
    function vaultTable(spec) {
        const body = hostEl.querySelector(`#${spec.body}`);
        if (!body) return;
        const table = body.closest('table');
        const wrap = body.closest('.sec-table-wrap') || table;
        const list = document.createElement('div');
        list.className = 'cpl-vault-list';
        list.dataset.cplVaultFor = spec.body;
        wrap.parentNode.insertBefore(list, wrap.nextSibling);
        wrap.classList.add('cpl-vault-source');
        const labels = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
        const actionsAt = labels.findIndex((l) => /^actions$/i.test(l));

        const cellWatchers = [];
        const dropCellWatchers = () => {
            cellWatchers.forEach((watcher) => {
                watcher.disconnect();
                const at = observers.indexOf(watcher);
                if (at >= 0) observers.splice(at, 1);
            });
            cellWatchers.length = 0;
        };
        const build = () => {
            dropCellWatchers();
            list.innerHTML = '';
            const rows = [...body.children].filter((tr) => tr.tagName === 'TR');
            if (spec.caption && rows.length) {
                const cap = document.createElement('div');
                cap.className = 'cpl-vault-caption';
                cap.textContent = spec.caption;
                list.appendChild(cap);
            }
            rows.forEach((tr, index) => {
                const cells = [...tr.children];
                if (cells.length === 1) {
                    const note = document.createElement('div');
                    note.className = 'cpl-vault-empty';
                    while (cells[0].firstChild) note.appendChild(cells[0].firstChild);
                    list.appendChild(note);
                    return;
                }
                // the row's id when it has one: two keys can share a name (Rook and its old key)
                const rowId = tr.dataset.secAppkeyId || tr.dataset.secAppkeyReq || tr.dataset.secKeychainService || tr.dataset.secCursorAccId;
                const key = `${spec.body}:${rowId || cells[0].textContent.trim() || index}`;
                const row = document.createElement('div');
                row.className = 'cpl-vault-row';
                row.dataset.cplVaultKey = key;
                row.classList.toggle('is-open', open.has(key));
                if (tr.className) row.dataset.state = tr.className;
                const line = document.createElement('button');
                line.type = 'button';
                line.className = 'cpl-vault-line';
                line.setAttribute('aria-expanded', open.has(key) ? 'true' : 'false');
                prepareVaultActions(tr);
                const name = document.createElement('span');
                name.className = 'cpl-vault-name';
                const title = nameOf(cells[0]);
                name.textContent = title.name;
                if (title.sub) {
                    const sub = document.createElement('span');
                    sub.className = 'cpl-vault-sub';
                    sub.textContent = title.sub;
                    name.appendChild(sub);
                }
                const summary = document.createElement('span');
                summary.className = 'cpl-vault-summary';
                summary.textContent = typeof spec.summary === 'function'
                    ? spec.summary(cells)
                    : (spec.summary || []).map((i) => cells[i] && cells[i].textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).join(' · ');
                const chevron = document.createElement('span');
                chevron.className = 'cpl-vault-chevron';
                chevron.setAttribute('aria-hidden', 'true');
                const marks = rowGlance(spec, tr, cells);
                line.append(name, summary);
                if (marks.length) line.append(makeGlance(marks));
                line.append(chevron);
                line.addEventListener('click', () => {
                    const isOpen = row.classList.toggle('is-open');
                    line.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                    if (isOpen) open.add(key); else open.delete(key);
                });
                const details = document.createElement('div');
                details.className = 'cpl-vault-details';
                cells.forEach((td, i) => {
                    if (i === actionsAt) return;
                    const item = document.createElement('div');
                    item.className = 'cpl-vault-field';
                    const label = document.createElement('span');
                    label.className = 'cpl-vault-label';
                    label.textContent = `${labels[i] || ''}:`;
                    const value = document.createElement('span');
                    value.className = 'cpl-vault-value';
                    while (td.firstChild) value.appendChild(td.firstChild);
                    item.append(label, value);
                    details.appendChild(item);
                });
                if (actionsAt >= 0 && cells[actionsAt]) {
                    const actions = document.createElement('div');
                    actions.className = 'cpl-vault-actions';
                    while (cells[actionsAt].firstChild) actions.appendChild(cells[actionsAt].firstChild);
                    details.appendChild(actions);
                }
                row.append(line, details);
                if (spec.body === 'secKeychainTableBody') {
                    const statusCell = tr.querySelector('.sec-keychain-status');
                    if (statusCell) {
                        const watch = new MutationObserver(() => paintKeychainGlance(row, tr));
                        watch.observe(statusCell, { childList: true });
                        cellWatchers.push(watch);
                        observers.push(watch);
                    }
                }
                list.appendChild(row);
            });
            if (!list.children.length && spec.empty) {
                const empty = document.createElement('div');
                empty.className = 'cpl-vault-empty';
                empty.textContent = spec.empty;
                list.appendChild(empty);
            }
        };
        build();
        const obs = new MutationObserver(build);
        obs.observe(body, { childList: true });
        observers.push(obs);
    }

    function vault() {
        VAULTS.forEach((section) => {
            buildHeader(section);
            section.tables.forEach(vaultTable);
        });
    }

    /**
     * #781: the Director's Cursor profiles as one Cursor service key. Its details hold the profile
     * rows (still rebuilt by vaultTable into the same list) and Add a Cursor profile / Refresh.
     * It sits in its own list after the keychain's, so the keychain's rebuilds cannot drop it.
     */
    function mountCursorCard() {
        if (!hostEl || hostEl.querySelector('#cplCardExtraList')) return;
        const profiles = hostEl.querySelector('.cpl-vault-list[data-cpl-vault-for="secCursorAccountsTableBody"]');
        const keychain = hostEl.querySelector('.cpl-vault-list[data-cpl-vault-for="secKeychainTableBody"]');
        if (!profiles || !keychain) return;
        const list = document.createElement('div');
        list.className = 'cpl-vault-list';
        list.id = 'cplCardExtraList';
        const row = document.createElement('div');
        row.className = 'cpl-vault-row';
        row.dataset.cplVaultKey = 'cursor:';
        row.innerHTML = `<button type="button" class="cpl-vault-line" aria-expanded="false"><span class="cpl-vault-name">Cursor<span class="cpl-vault-sub">Cursor profiles the Director can run Yumiya and Yozora on</span></span><span class="cpl-vault-summary"></span><span class="cpl-vault-chevron" aria-hidden="true"></span></button>
            <div class="cpl-vault-details"><div class="cpl-vault-field cs-nested-intro"><span class="cpl-vault-label">Profiles:</span><span class="cpl-vault-value">Open a profile to activate it for Yumiya or Yozora, sign it in again, or edit it.</span></div>
            <div class="cs-nested"></div>
            <div class="cpl-vault-actions"><button type="button" data-cs-proxy="secCursorAccountsAddBtn">Add a Cursor profile</button><button type="button" data-cs-proxy="secCursorAccountsRefresh">Refresh</button></div></div>`;
        row.querySelector('.cs-nested').appendChild(profiles);
        list.appendChild(row);
        keychain.parentNode.insertBefore(list, keychain.nextSibling);
    }

    let customProviderRows = [];
    // Supported hosts from director_custom_providers_response (modules/customModelProviders.js PRESETS).
    let customProviderPresets = [];
    // id -> director_custom_providers_balance_response row (cached on the server; never blocks a turn).
    let customProviderBalances = {};

    // Standard key dot for a provider: key set / not set, then what its balance says.
    const BALANCE_DOT = { ok: 'ok', free: 'ok', none: 'ok', low: 'warn', error: 'warn', out: 'fail', nokey: 'none' };

    function customProviderGlance(row) {
        if (!row.hasKey) return [{ state: 'none', label: 'API key not set' }];
        const balance = customProviderBalances[row.id];
        if (!balance) return [{ state: 'unchecked', label: 'API key set' }];
        const words = String(balance.title || '').split('\n').join(' · ');
        return [{ state: BALANCE_DOT[balance.state] || 'unchecked', label: `API key set · ${words}` }];
    }

    function loadCustomProviderBalances() {
        if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function') return;
        window.wsClient.sendMessage('director_custom_providers_balance', {}).then((resp) => {
            const body = resp && resp.data && typeof resp.data === 'object' ? resp.data : (resp || {});
            const next = {};
            (Array.isArray(body.balances) ? body.balances : []).forEach((item) => {
                if (item && item.id && item.engine !== 'tokenrouter') next[item.id] = item;
            });
            customProviderBalances = next;
            if (hostEl && hostEl.isConnected) paintCustomProviders();
        }).catch(() => { /* the dots stay unchecked */ });
    }

    function customField(label, control) {
        const item = document.createElement('div');
        item.className = 'cpl-vault-field';
        const lab = document.createElement('div');
        lab.className = 'cpl-vault-label';
        lab.textContent = label;
        const value = document.createElement('div');
        value.className = 'cpl-vault-value';
        value.appendChild(control);
        item.append(lab, value);
        return item;
    }

    function customInput(value, placeholder) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cpl-ua-input';
        input.value = value || '';
        if (placeholder) input.placeholder = placeholder;
        return input;
    }

    function customCheck(text, checked) {
        const wrap = document.createElement('div');
        wrap.className = 'desktop-settings-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked === true;
        const id = `cplCustomCheck-${Math.random().toString(36).slice(2, 8)}`;
        input.id = id;
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = text;
        wrap.append(input, label);
        return { wrap, input };
    }

    function paintCustomProviders() {
        const list = hostEl && hostEl.querySelector('#cplCustomProviderList');
        if (!list) return;
        list.textContent = '';
        if (!customProviderRows.length) {
            const empty = document.createElement('div');
            empty.className = 'cpl-vault-empty';
            empty.textContent = 'No custom model providers.';
            list.appendChild(empty);
            return;
        }
        customProviderRows.forEach((row) => {
            const block = document.createElement('div');
            block.className = 'cpl-vault-row' + (row._open ? ' is-open' : '');
            block.dataset.cplVaultKey = `custom:${row.id || ''}`;
            // the provider's picture is its card's picture in CardSpace
            if (row.logo) block.dataset.cplCardPicture = row.logo;
            const line = document.createElement('button');
            line.type = 'button';
            line.className = 'cpl-vault-line';
            const name = document.createElement('span');
            name.className = 'cpl-vault-name';
            name.textContent = row.name || row.id || 'New provider';
            const summary = document.createElement('span');
            summary.className = 'cpl-vault-summary';
            const bits = [];
            if (row.defaultModel) bits.push(row.defaultModel.split('/').pop());
            if (row.monitorUsage) bits.push('Usage');
            if (row.obliteratedMemories) bits.push('Obliterated Memories');
            if (row.ageTool === false) bits.push('No age tool');
            if (!row.hasKey && row.id) bits.push('No key');
            const balance = row.id ? customProviderBalances[row.id] : null;
            if (balance && balance.balanceText) bits.push(balance.balanceText);
            summary.textContent = bits.join(' · ');
            const chevron = document.createElement('span');
            chevron.className = 'cpl-vault-chevron';
            line.append(name, summary);
            if (row.id) line.append(makeGlance(customProviderGlance(row)));
            line.append(chevron);
            line.addEventListener('click', () => {
                row._open = !row._open;
                paintCustomProviders();
            });

            const details = document.createElement('div');
            details.className = 'cpl-vault-details';
            const idInput = customInput(row.id, 'my-provider');
            if (row.id) idInput.readOnly = true;
            const nameInput = customInput(row.name, 'My Provider');
            const urlInput = customInput(row.baseUrl, 'https://host.example');
            const modelInput = customInput(row.defaultModel, 'model id');
            const preset = document.createElement('select');
            preset.className = 'cpl-ua-input';
            const presetHosts = {};
            [{ id: '', name: 'Custom' }].concat(customProviderPresets).forEach((item) => {
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = item.name;
                preset.appendChild(option);
                if (item.id) presetHosts[item.id] = item;
            });
            if (presetHosts[row.kind]) preset.value = row.kind;
            preset.addEventListener('change', () => {
                const fill = presetHosts[preset.value];
                if (!fill) return;
                if (!idInput.readOnly) idInput.value = fill.id;
                nameInput.value = fill.name;
                urlInput.value = fill.baseUrl;
                if (fill.defaultModel) modelInput.value = fill.defaultModel;
                syncManagement();
            });
            // The key itself never comes back from the server: only whether one is saved.
            const keyState = document.createElement('span');
            keyState.textContent = row.hasKey ? 'Set' : 'Not set';
            const balanceInfo = row.id ? customProviderBalances[row.id] : null;
            const balanceText = document.createElement('span');
            balanceText.textContent = balanceInfo
                ? (String(balanceInfo.title || '').split('\n').join(' · ') || 'No balance on this host')
                : (row.hasKey ? 'Checking…' : 'Add a key to read the balance');
            const keyInput = document.createElement('input');
            keyInput.type = 'password';
            keyInput.className = 'cpl-ua-input';
            keyInput.autocomplete = 'new-password';
            keyInput.placeholder = row.hasKey ? 'Leave blank to keep the current key' : 'Bearer token';
            const managementInput = document.createElement('input');
            managementInput.type = 'password';
            managementInput.className = 'cpl-ua-input';
            managementInput.autocomplete = 'new-password';
            managementInput.placeholder = row.hasManagementKey ? 'Leave blank to keep the current key' : 'Personal management key';
            const managementField = customField('Management key', managementInput);
            // modules/customModelProviders.js hostKind — a TokenRouter URL is the only host that reads a management key.
            const syncManagement = () => {
                let host = '';
                try { host = new URL(urlInput.value).hostname.toLowerCase(); } catch (_err) { host = ''; }
                const show = host === 'api.tokenrouter.com' || host.endsWith('.tokenrouter.com');
                managementField.style.display = show ? '' : 'none';
            };
            urlInput.addEventListener('input', syncManagement);
            syncManagement();
            const usage = customCheck('Monitor Usage', row.monitorUsage === true);
            const memories = customCheck('Obliterated Memories', row.obliteratedMemories === true);
            const age = customCheck('Age tool', row.ageTool !== false);
            // As cplUserAccounts' picture picker: the native input stays hidden behind a DSAP button.
            const logoInput = document.createElement('input');
            logoInput.type = 'file';
            logoInput.className = 'hidden';
            logoInput.hidden = true;
            logoInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
            const logoPreview = document.createElement('img');
            logoPreview.width = 32;
            logoPreview.height = 32;
            logoPreview.alt = '';
            const logoSrc = row._logoData || row.logo || '';
            if (logoSrc) logoPreview.src = logoSrc;
            else logoPreview.style.display = 'none';
            logoInput.addEventListener('change', () => {
                const file = logoInput.files && logoInput.files[0];
                if (!file) return;
                // Same centre-crop as cplUserAccounts.js toTile, drawn at icon size.
                const img = new Image();
                const url = URL.createObjectURL(file);
                img.onload = () => {
                    const size = Math.min(img.naturalWidth, img.naturalHeight);
                    const canvas = document.createElement('canvas');
                    canvas.width = 64;
                    canvas.height = 64;
                    canvas.getContext('2d').drawImage(img, (img.naturalWidth - size) / 2, (img.naturalHeight - size) / 2, size, size, 0, 0, 64, 64);
                    URL.revokeObjectURL(url);
                    row._logoData = canvas.toDataURL('image/png');
                    row._logoClear = false;
                    logoPreview.src = row._logoData;
                    logoPreview.style.display = '';
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    if (typeof showGlassToast === 'function') showGlassToast('error', 'Dreamscape CardSpace', 'That file is not a picture');
                };
                img.src = url;
            });
            const logoBrowse = document.createElement('button');
            logoBrowse.type = 'button';
            logoBrowse.className = 'sec-dsap-action-btn';
            logoBrowse.textContent = 'Choose picture…';
            logoBrowse.addEventListener('click', () => logoInput.click());
            const logoClear = document.createElement('button');
            logoClear.type = 'button';
            logoClear.className = 'sec-dsap-action-btn';
            logoClear.textContent = 'Remove picture';
            logoClear.addEventListener('click', () => {
                row._logoData = '';
                row._logoClear = true;
                logoPreview.removeAttribute('src');
                logoPreview.style.display = 'none';
                logoInput.value = '';
            });
            const logoWrap = document.createElement('div');
            logoWrap.className = 'cpl-vault-picture';
            logoWrap.append(logoPreview, logoBrowse, logoClear, logoInput);
            details.append(
                customField('Preset', preset),
                customField('Id', idInput),
                customField('Name', nameInput),
                customField('URL', urlInput),
                customField('Model', modelInput),
                customField('Key', keyInput),
                customField('Key status', keyState),
                managementField,
                customField('Balance', balanceText),
                customField('Picture', logoWrap),
                customField('Usage', usage.wrap),
                customField('Memories', memories.wrap),
                customField('Age tool', age.wrap)
            );
            const actions = document.createElement('div');
            actions.className = 'cpl-vault-actions';
            const save = document.createElement('button');
            save.type = 'button';
            save.className = 'sec-dsap-action-btn';
            save.textContent = 'Save';
            save.addEventListener('click', async () => {
                save.disabled = true;
                try {
                    const resp = await window.wsClient.sendMessage('director_custom_providers_save', {
                        provider: Object.assign({
                            id: idInput.value,
                            name: nameInput.value,
                            baseUrl: urlInput.value,
                            defaultModel: modelInput.value,
                            apiKey: keyInput.value,
                            managementKey: managementInput.value,
                            monitorUsage: usage.input.checked,
                            obliteratedMemories: memories.input.checked,
                            ageTool: age.input.checked
                        }, row._logoClear ? { logo: '' } : (row._logoData ? { logo: row._logoData } : {}))
                    });
                    customProviderRows = customProviderPayload(resp);
                    const savedId = String(idInput.value || '').trim().toLowerCase();
                    customProviderRows.forEach((item) => { item._open = item.id === savedId; });
                    delete customProviderBalances[savedId];
                    paintCustomProviders();
                    loadCustomProviderBalances();
                } catch (err) {
                    save.disabled = false;
                    if (typeof showGlassToast === 'function') showGlassToast('error', 'Dreamscape CardSpace', err.message || 'Could not save the provider');
                }
            });
            actions.appendChild(save);
            details.appendChild(actions);
            block.append(line, details);
            list.appendChild(block);
        });
        csRefresh();
    }

    function customProviderPayload(resp) {
        if (!resp || typeof resp !== 'object') return [];
        const body = resp.data && typeof resp.data === 'object' ? resp.data : resp;
        return Array.isArray(body.providers) ? body.providers : [];
    }

    function mountCustomProviders() {
        if (!hostEl || hostEl.querySelector('#cplVault-custom-models')) return;
        const head = document.createElement('div');
        head.className = 'cpl-vault-head';
        head.id = 'cplVault-custom-models';
        head.innerHTML = `<img src="${ART}/key-16.png" alt=""><span class="cpl-vault-title">Custom Model Providers (Director)</span><span class="cpl-vault-links"></span>`;
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'cpl-vault-link';
        add.textContent = 'Add a custom model provider';
        add.addEventListener('click', () => {
            if (customProviderRows.some((row) => !row.id && row._open)) return;
            customProviderRows.push({
                id: '', name: '', baseUrl: '', defaultModel: '', hasKey: false, hasManagementKey: false,
                monitorUsage: false, obliteratedMemories: false, ageTool: true, logo: '', _open: true
            });
            paintCustomProviders();
        });
        head.querySelector('.cpl-vault-links').appendChild(add);
        const list = document.createElement('div');
        list.className = 'cpl-vault-list';
        list.id = 'cplCustomProviderList';
        hostEl.append(head, list);
        paintCustomProviders();
        if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function') return;
        window.wsClient.sendMessage('director_custom_providers_get', {}).then((resp) => {
            if (!hostEl || !hostEl.isConnected) return;
            const openIds = new Set(customProviderRows.filter((row) => row._open).map((row) => row.id));
            customProviderRows = customProviderPayload(resp);
            const body = resp && resp.data && typeof resp.data === 'object' ? resp.data : (resp || {});
            if (Array.isArray(body.presets)) customProviderPresets = body.presets;
            customProviderRows.forEach((row) => { row._open = openIds.has(row.id); });
            paintCustomProviders();
            loadCustomProviderBalances();
        }).catch((err) => {
            const note = hostEl && hostEl.querySelector('#cplCustomProviderList');
            if (!note) return;
            note.textContent = '';
            const empty = document.createElement('div');
            empty.className = 'cpl-vault-empty';
            empty.textContent = err.message || 'Custom model providers could not be loaded.';
            note.appendChild(empty);
        });
    }

    // ---- Text Messaging (Yozora #779): the accounts Melaton Messenger and the phone's Messaging use ----
    //
    // A BlueBubbles server (iMessage) is its address and password; an RCS account (Google Messages,
    // one per server) is paired by scanning a QR code with the phone. window.textMessaging
    // (textMessagingClient.js) is read at call time; its 'account' and 'pairing' events repaint.

    const TM_PICTURE = '/static_images/app_icons/melaton-messenger.webp';
    const TM_PAIR_HINT = 'On your phone, open Google Messages, tap your profile picture > Device pairing > QR code scanner, and scan this code.';
    const TM_GOOGLE_URL = 'https://messages.google.com/web/authentication';
    const TM_GOOGLE_STEPS = 'An Alchemy window opens at Google Messages for web. Sign in there with the Google account your phone uses, close that window, then press Continue.';
    const TM_EMOJI_HINT = 'Your phone shows "Is this you?". In Google Messages, tap the emoji that matches this one.';
    const TM_RCS_NOTE = 'Keep Google Messages as your default messaging app. Turn off its notifications: Dreamscape sends them now.';
    const TM_STATE = {
        connected: ['ok', 'Connected'], error: ['fail', 'Error'], disabled: ['unchecked', 'Turned off'],
        unpaired: ['warn', 'Not paired'], pairing: ['warn', 'Pairing']
    };
    let tmRows = [];
    let tmLoadError = '';
    const tmUi = {};          // id -> { open, test, testError, qr, qrAt, paired, busy }
    let tmOff = null;
    const tmApi = () => root.textMessaging || null;

    function tmUiOf(id) {
        if (!tmUi[id]) tmUi[id] = {};
        return tmUi[id];
    }

    function tmStatus(row) {
        const [state, word] = TM_STATE[row.status] || (row.id ? ['unchecked', row.status || 'Not connected'] : ['none', 'Not saved']);
        const text = row.status === 'error' && row.error ? `Error: ${row.error}` : word;
        return { state, text };
    }

    function tmToast(text) {
        if (typeof showGlassToast === 'function') showGlassToast('error', 'Dreamscape CardSpace', text);
    }

    async function loadTextMessaging(force) {
        const t = tmApi();
        if (!t) { tmLoadError = 'Text Messaging is not available.'; paintTextMessaging(); return; }
        try {
            const d = await t.accounts(force !== false);
            const drafts = tmRows.filter((r) => !r.id);
            tmRows = ((d && d.accounts) || []).concat(drafts);
            tmLoadError = '';
        } catch (err) {
            tmLoadError = (err && err.message) || 'The Text Messaging accounts could not be read.';
        }
        if (hostEl && hostEl.isConnected) paintTextMessaging();
    }

    function tmPassword(placeholder) {
        const input = document.createElement('input');
        input.type = 'password';
        input.className = 'cpl-ua-input';
        input.autocomplete = 'new-password';
        input.placeholder = placeholder;
        return input;
    }

    function tmButton(text, fn) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sec-dsap-action-btn';
        b.textContent = text;
        b.addEventListener('click', async () => {
            b.disabled = true;
            try { await fn(); } catch (err) { tmToast((err && err.message) || `${text} failed`); }
            if (b.isConnected) b.disabled = false;
        });
        return b;
    }

    function tmText(text, className) {
        const span = document.createElement('span');
        if (className) span.className = className;
        span.textContent = text;
        return span;
    }

    /** What Test connection learned: the Apple ID or phone, the server's version, Private API. */
    function tmTestText(ui) {
        if (ui.testError) return `Could not connect: ${ui.testError}`;
        if (!ui.test) return 'Not tested yet';
        const r = ui.test;
        const bits = [r.identity ? `Signed in as ${r.identity}` : 'Connected'];
        if (r.serverVersion) bits.push(`server ${r.serverVersion}`);
        bits.push(`Private API: ${r.features && r.features.privateApi ? 'Yes' : 'No'}`);
        return bits.join(' \u00b7 ');
    }

    /** The server's copy of an account (textMessagingStore.js): how far its sync is. */
    function tmSyncText(row) {
        const y = row && row.sync;
        if (!y) return 'Not synced yet';
        const n = (v) => Number(v || 0).toLocaleString();
        if (y.running || !y.complete) {
            const part = y.total ? ` (${n(y.done)} of ${n(y.total)} conversations)` : '';
            return `Syncing: ${n(y.messages)} messages so far${part}`;
        }
        return `Up to date: ${n(y.messages)} messages in ${n(y.chats)} conversations`;
    }

    function tmDetailsBlueBubbles(row, details, actions) {
        const ui = tmUiOf(row.id || '');
        const url = customInput(row.url, 'https://bluebubbles.example.com');
        const pass = tmPassword(row.hasPassword ? 'Leave blank to keep the current password' : 'The server password');
        const enabled = customCheck('Use this account', row.enabled !== false);
        const status = tmStatus(row);
        const testOut = tmText(tmTestText(ui), ui.testError ? 'cpl-tm-error' : '');
        // the account's client settings (textMessagingBlueBubbles.js DEFAULT_SETTINGS)
        const st = row.settings || {};
        const priv = !!(row.server && row.server.privateApi);
        const opt = (key, text) => { const c = customCheck(text, st[key] !== false); c.key = key; return c; };
        const opts = [
            opt('notify', 'Notify me about new messages'),
            opt('usePrivateApi', 'Use the Private API (tapbacks, replies, edit and unsend, typing, read receipts)'),
            opt('sendReadReceipts', 'Send read receipts'),
            opt('sendTyping', 'Send typing indicators'),
            opt('mergeConversations', "Show a person's iMessage and SMS chats as one conversation"),
            opt('hideEmptyChats', 'Hide conversations with no messages')
        ];
        if (!priv) opts.filter((o) => ['usePrivateApi', 'sendReadReceipts', 'sendTyping'].includes(o.key)).forEach((o) => { o.input.disabled = true; });
        const optBox = document.createElement('div');
        optBox.className = 'cpl-tm-options';
        opts.forEach((o) => optBox.appendChild(o.wrap));
        const sv = row.server;
        const serverText = sv ? [sv.version ? `BlueBubbles ${sv.version}` : '', sv.macOs ? `macOS ${sv.macOs}` : '', sv.privateApi ? (sv.helper ? 'Private API on' : 'Private API on, helper not connected') : 'Private API off'].filter(Boolean).join(', ') : 'Unknown until connected';
        details.append(
            customField('Service', tmText('iMessage through a BlueBubbles server')),
            customField('Server address', url),
            customField('Password', pass),
            customField('Enabled', enabled.wrap),
            customField('Signed in as', tmText(row.identity || 'Unknown until connected')),
            customField('Status', tmText(status.text, row.status === 'error' ? 'cpl-tm-error' : '')),
            customField('Server', tmText(serverText)),
            customField('Copy on this server', tmText(tmSyncText(row))),
            customField('Test result', testOut),
            customField('Options', optBox)
        );
        actions.append(
            tmButton('Test connection', async () => {
                testOut.textContent = 'Connecting...';
                testOut.className = '';
                try {
                    ui.test = await tmApi().testAccount({ kind: 'bluebubbles', id: row.id || undefined, url: url.value, password: pass.value || undefined });
                    ui.testError = '';
                } catch (err) {
                    ui.test = null;
                    ui.testError = (err && err.message) || 'No answer';
                }
                testOut.textContent = tmTestText(ui);
                testOut.className = ui.testError ? 'cpl-tm-error' : '';
            }),
            tmButton('Save', async () => {
                const settings = {};
                opts.forEach((o) => { if (!o.input.disabled) settings[o.key] = o.input.checked; });
                const saved = await tmApi().saveAccount({ id: row.id || undefined, kind: 'bluebubbles', url: url.value, password: pass.value || undefined, enabled: enabled.input.checked, settings });
                tmRows = tmRows.filter((r) => r.id);
                if (saved && saved.id) { tmUiOf(saved.id).open = true; csSel = `sms:${saved.id}`; }
                await loadTextMessaging(true);
            })
        );
    }

    function tmDetailsRcs(row, details, actions) {
        const ui = tmUiOf(row.id);
        const status = tmStatus(row);
        const enabled = customCheck('Use this account', row.enabled !== false);
        const paired = row.status === 'connected' || !!row.identity;
        details.append(
            customField('Service', tmText('RCS through Google Messages')),
            customField('Phone number', tmText(row.identity || 'Unknown until paired')),
            customField('Status', tmText(ui.paired ? 'Paired' : status.text, row.status === 'error' ? 'cpl-tm-error' : '')),
            customField('Copy on this server', tmText(tmSyncText(row))),
            customField('Enabled', enabled.wrap)
        );
        if (ui.google && !paired) {
            // Google account pairing (Google Messages without a QR scanner): sign in inside Alchemy,
            // Continue takes that sign-in, the phone asks for the emoji shown here
            const box = document.createElement('div');
            box.className = 'cpl-tm-pair';
            if (ui.emoji) {
                const big = document.createElement('div');
                big.className = 'cpl-tm-emoji';
                if (ui.emojiSvg) {
                    const img = document.createElement('img');
                    img.src = ui.emojiSvg;
                    img.alt = ui.emoji;
                    img.width = 96;
                    img.height = 96;
                    big.appendChild(img);
                } else {
                    big.textContent = ui.emoji;
                }
                box.append(big, tmText(TM_EMOJI_HINT, 'cpl-tm-hint'));
            } else {
                box.append(tmText(TM_GOOGLE_STEPS, 'cpl-tm-hint'),
                    tmButton('Open Alchemy', async () => { await csOpenBrowser(TM_GOOGLE_URL, 'Google Messages'); }),
                    tmButton('Continue', async () => {
                        ui.error = '';
                        try {
                            const res = await tmApi().pairRcsGoogle(row.id);
                            ui.emoji = (res && res.emoji) || ui.emoji;
                        } catch (err) {
                            ui.error = (err && err.message) || 'Pairing could not start.';
                        }
                        paintTextMessaging();
                    }));
            }
            if (ui.error) box.append(tmText(ui.error, 'cpl-tm-error'));
            details.append(customField('Pairing', box));
        }
        if (ui.qr && !paired) {
            const box = document.createElement('div');
            box.className = 'cpl-tm-pair';
            const img = document.createElement('img');
            img.className = 'cpl-tm-qr';
            img.alt = 'Pairing QR code';
            img.width = 200;
            img.height = 200;
            img.src = `/api/textmessaging/${encodeURIComponent(row.id)}/pairing-qr.svg?t=${ui.qrAt || Date.now()}`;
            img.dataset.tmQr = row.id;
            const hint = tmText(TM_PAIR_HINT, 'cpl-tm-hint');
            box.append(img, hint, tmButton('Refresh code', async () => { await tmApi().refreshRcsQr(row.id); ui.qrAt = Date.now(); paintTextMessaging(); }));
            details.append(customField('Pairing', box));
        }
        details.append(customField('Note', tmText(TM_RCS_NOTE, 'cpl-tm-hint')));
        if (!paired) {
            actions.append(tmButton('Pair with Google account', async () => {
                ui.google = true;
                ui.qr = false;
                ui.emoji = '';
                ui.error = '';
                ui.paired = false;
                void csOpenBrowser(TM_GOOGLE_URL, 'Google Messages').catch(() => {});
                paintTextMessaging();
            }));
            actions.append(tmButton(ui.qr ? 'New QR code' : 'Pair with QR code', async () => {
                const res = await tmApi().pairRcs(row.id);
                ui.qr = true;
                ui.google = false;
                ui.qrAt = Date.now();
                ui.paired = false;
                void res;
                paintTextMessaging();
            }));
        } else {
            actions.append(tmButton('Unpair', async () => {
                const ok = typeof root.showConfirmationDialog === 'function' ? await root.showConfirmationDialog('<p>Unpair this computer from Google Messages? Text messages stop until you pair again.</p>',
                    [{ text: 'Unpair', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, { title: 'Dreamscape CardSpace', width: 400 }) : true;
                if (ok !== true) return;
                await tmApi().unpairRcs(row.id);
                ui.qr = false;
                ui.paired = false;
                await loadTextMessaging(true);
            }));
        }
        actions.append(tmButton('Save', async () => {
            await tmApi().saveAccount({ id: row.id, kind: 'rcs', enabled: enabled.input.checked });
            await loadTextMessaging(true);
        }));
    }

    function paintTextMessaging() {
        const list = hostEl && hostEl.querySelector('#cplTextMessagingList');
        if (!list) return;
        list.textContent = '';
        if (!tmRows.length) {
            const empty = document.createElement('div');
            empty.className = 'cpl-vault-empty';
            empty.textContent = tmLoadError || 'No Text Messaging accounts.';
            list.appendChild(empty);
            csRefresh();
            return;
        }
        tmRows.forEach((row) => {
            const ui = tmUiOf(row.id || '');
            const rcs = row.kind === 'rcs';
            const block = document.createElement('div');
            block.className = 'cpl-vault-row' + (ui.open ? ' is-open' : '');
            block.dataset.cplVaultKey = `sms:${row.id || ''}`;
            block.dataset.cplCardPicture = TM_PICTURE;
            const line = document.createElement('button');
            line.type = 'button';
            line.className = 'cpl-vault-line';
            const name = document.createElement('span');
            name.className = 'cpl-vault-name';
            name.textContent = row.identity || (rcs ? 'Google Messages' : (row.id ? 'BlueBubbles server' : 'New BlueBubbles server'));
            const sub = document.createElement('span');
            sub.className = 'cpl-vault-sub';
            sub.textContent = rcs ? 'RCS (Google Messages)' : `iMessage (BlueBubbles)${row.url ? ` \u00b7 ${row.url}` : ''}`;
            name.appendChild(sub);
            const status = tmStatus(row);
            const summary = document.createElement('span');
            summary.className = 'cpl-vault-summary';
            summary.textContent = row.id ? status.text : 'Not saved';
            const chevron = document.createElement('span');
            chevron.className = 'cpl-vault-chevron';
            line.append(name, summary);
            if (row.id) line.append(makeGlance([{ state: status.state, label: status.text }]));
            line.append(chevron);
            line.addEventListener('click', () => { ui.open = !ui.open; paintTextMessaging(); });
            const details = document.createElement('div');
            details.className = 'cpl-vault-details';
            const actions = document.createElement('div');
            actions.className = 'cpl-vault-actions';
            if (rcs) tmDetailsRcs(row, details, actions); else tmDetailsBlueBubbles(row, details, actions);
            if (row.id) {
                actions.append(tmButton('Delete', async () => {
                    const ok = typeof root.showConfirmationDialog === 'function' ? await root.showConfirmationDialog(`<p>Delete the Text Messaging account ${esc(row.identity || row.url || row.id)}? Melaton Messenger and the phone stop showing its messages.</p>`,
                        [{ text: 'Delete', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, { title: 'Dreamscape CardSpace', width: 400 }) : true;
                    if (ok !== true) return;
                    await tmApi().deleteAccount(row.id);
                    delete tmUi[row.id];
                    await loadTextMessaging(true);
                }));
            }
            details.appendChild(actions);
            block.append(line, details);
            list.appendChild(block);
        });
        csRefresh();
    }

    function tmAddBlueBubbles() {
        if (!tmRows.some((r) => !r.id)) tmRows.push({ id: '', kind: 'bluebubbles', url: '', enabled: true, hasPassword: false });
        tmUiOf('').open = true;
        paintTextMessaging();
    }

    async function tmAddRcs() {
        const t = tmApi();
        if (!t) return null;
        const existing = tmRows.find((r) => r.kind === 'rcs' && r.id);
        if (existing) return existing.id;
        try {
            const saved = await t.saveAccount({ kind: 'rcs' });
            await loadTextMessaging(true);
            return saved && saved.id ? saved.id : null;
        } catch (err) {
            tmToast((err && err.message) || 'The RCS account could not be added');
            return null;
        }
    }

    function tmOnPairing(d) {
        if (!d || !d.accountId) return;
        const ui = tmUiOf(d.accountId);
        if (d.paired) { ui.paired = true; ui.qr = false; ui.google = false; ui.emoji = ''; void loadTextMessaging(true); return; }
        if (d.emoji) { ui.google = true; ui.emoji = d.emoji; ui.emojiSvg = d.emojiSvg || ''; ui.error = ''; paintTextMessaging(); return; }
        if (d.error) { ui.emoji = ''; ui.error = d.error; paintTextMessaging(); return; }
        if (d.qr) {
            ui.qr = true;
            ui.qrAt = Date.now();
            // QR codes expire: the shown one follows the server's
            const img = hostEl && [...hostEl.querySelectorAll('img[data-tm-qr]')].find((x) => x.dataset.tmQr === d.accountId);
            const live = win && [...win.querySelectorAll('img[data-tm-qr]')].find((x) => x.dataset.tmQr === d.accountId);
            const src = `/api/textmessaging/${encodeURIComponent(d.accountId)}/pairing-qr.svg?t=${ui.qrAt}`;
            if (img || live) [img, live].forEach((x) => { if (x) x.src = src; }); else paintTextMessaging();
        }
    }

    function mountTextMessaging() {
        if (!hostEl || hostEl.querySelector('#cplVault-text-messaging')) return;
        const head = document.createElement('div');
        head.className = 'cpl-vault-head';
        head.id = 'cplVault-text-messaging';
        head.innerHTML = `<img src="/static_images/melaton-messenger/messenger-16.png" alt=""><span class="cpl-vault-title">Text Messaging</span><span class="cpl-vault-links"></span>`;
        const links = head.querySelector('.cpl-vault-links');
        const addBb = document.createElement('button');
        addBb.type = 'button';
        addBb.className = 'cpl-vault-link';
        addBb.id = 'cplTmAddBlueBubbles';
        addBb.textContent = 'Add a BlueBubbles server';
        addBb.addEventListener('click', tmAddBlueBubbles);
        const addRcs = document.createElement('button');
        addRcs.type = 'button';
        addRcs.className = 'cpl-vault-link';
        addRcs.id = 'cplTmAddRcs';
        addRcs.textContent = 'Add an RCS account (Google Messages)';
        addRcs.addEventListener('click', () => void tmAddRcs());
        links.append(addBb, addRcs);
        const list = document.createElement('div');
        list.className = 'cpl-vault-list';
        list.id = 'cplTextMessagingList';
        hostEl.append(head, list);
        paintTextMessaging();
        const t = tmApi();
        if (t && typeof t.on === 'function' && !tmOff) {
            const onAccount = () => void loadTextMessaging(true);
            t.on('account', onAccount);
            t.on('pairing', tmOnPairing);
            tmOff = () => { if (typeof t.off === 'function') { t.off('account', onAccount); t.off('pairing', tmOnPairing); } };
        }
        void loadTextMessaging(true);
    }

    function unmountTextMessaging() {
        if (tmOff) { tmOff(); tmOff = null; }
        tmRows = [];
        Object.keys(tmUi).forEach((k) => { delete tmUi[k]; });
    }

    // ---- E-mail Accounts (Yozora #789): the IMAP accounts the server keeps a copy of and sends with ----
    //
    // An account is its address, password (or app password) and its IMAP / SMTP servers; a known
    // provider's servers fill in from the address (mailAccounts.presetFor). window.mailAccounts
    // (mailAccountsClient.js) is read at call time. A new or removed account repaints the list;
    // status and sync changes only rewrite the card's status lines, so typing in a card survives them.

    const MA_PICTURE = '/static_images/app_icons/vista-mail.webp';
    const MA_STATE = {
        connected: ['ok', 'Connected'], connecting: ['warn', 'Connecting'], error: ['fail', 'Error'], disabled: ['unchecked', 'Turned off']
    };
    const MA_SECURITY = [['tls', 'SSL/TLS'], ['starttls', 'STARTTLS'], ['none', 'None']];
    const MA_SAVE_SENT = [['auto', 'Automatic'], ['always', 'Always'], ['never', 'Never']];
    let maRows = [];
    let maLoadError = '';
    const maUi = {};          // id -> { open, test, testError, live: { summary, status, sync, glance } }
    let maOff = null;
    let maPaintNext = false;  // the next load repaints (after Save: fresh placeholders, no typed passwords)
    const maApi = () => root.mailAccounts || null;

    function maUiOf(id) {
        if (!maUi[id]) maUi[id] = {};
        return maUi[id];
    }

    function maStatus(row) {
        if (!row.id) return { state: 'none', text: 'Not saved' };
        const key = row.enabled === false ? 'disabled' : row.status;
        const [state, word] = MA_STATE[key] || ['unchecked', 'Not connected'];
        const text = key === 'error' && row.error ? `Error: ${row.error}` : (key === 'connecting' && row.error ? row.error : word);
        return { state, text };
    }

    /** The server's copy: "Synced 1,234 messages in 12 folders", or how far a running sync is. */
    function maSyncText(row) {
        const y = row && row.sync;
        const n = (v) => Number(v || 0).toLocaleString();
        const plural = (v, one, many) => `${n(v)} ${Number(v) === 1 ? one : many}`;
        if (y && y.running) {
            const p = y.progress;
            if (!p || !p.folder) return 'Syncing...';
            return p.total ? `Syncing: ${p.folder} ${n(p.done)} of ${n(p.total)}` : `Syncing: ${p.folder}`;
        }
        if (!y || (!y.messages && !y.folders)) return 'Not synced yet';
        return `Synced ${plural(y.messages, 'message', 'messages')} in ${plural(y.folders, 'folder', 'folders')}`;
    }

    async function loadMailAccounts(force) {
        const m = maApi();
        if (!m) { maLoadError = 'E-mail accounts are not available.'; maPaint(); return; }
        const before = maRows.filter((r) => r.id).map((r) => r.id).join('|');
        try {
            const d = await m.accounts(force !== false);
            const drafts = maRows.filter((r) => !r.id);
            maRows = ((d && d.accounts) || []).concat(drafts);
            maLoadError = '';
        } catch (err) {
            maLoadError = (err && err.message) || 'The e-mail accounts could not be read.';
        }
        if (!hostEl || !hostEl.isConnected) return;
        // the same accounts: rewrite their status lines only (a card being edited keeps its input)
        const after = maRows.filter((r) => r.id).map((r) => r.id).join('|');
        if (!maPaintNext && before === after && !maLoadError && hostEl.querySelector('#cplMailAccountsList .cpl-vault-row') && maRows.every((r) => !r.id || (maUi[r.id] && maUi[r.id].live))) maLive();
        else maPaint();
    }

    function maLive() {
        maRows.forEach((row) => {
            const live = row.id && maUi[row.id] && maUi[row.id].live;
            if (!live || !live.summary.isConnected) return;
            const status = maStatus(row);
            live.summary.textContent = `${status.text} \u00b7 ${maSyncText(row)}`;
            live.status.textContent = status.text;
            live.status.className = status.state === 'fail' ? 'cpl-tm-error' : '';
            live.sync.textContent = maSyncText(row);
            const glance = makeGlance([{ state: status.state, label: status.text }]);
            live.glance.replaceWith(glance);
            live.glance = glance;
        });
        csRefresh();
    }

    function maSelect(options, value) {
        const sel = document.createElement('select');
        sel.className = 'cpl-ua-input';
        options.forEach(([v, text]) => {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = text;
            sel.appendChild(o);
        });
        sel.value = options.some(([v]) => v === value) ? value : options[0][0];
        return sel;
    }

    /** A server line: host, port and security side by side. */
    function maServer(side, placeholder) {
        const s = side || {};
        const host = customInput(s.host, placeholder);
        host.classList.add('cpl-ma-host');
        const port = customInput(s.port ? String(s.port) : '', 'Port');
        port.classList.add('cpl-ma-port');
        port.inputMode = 'numeric';
        port.title = 'Port';
        const security = maSelect(MA_SECURITY, s.security || 'tls');
        security.classList.add('cpl-ma-security');
        security.title = 'This server requires a secure connection';
        const box = document.createElement('div');
        box.className = 'cpl-ma-server';
        box.append(host, port, security);
        const fill = (p) => { host.value = p.host || ''; port.value = p.port ? String(p.port) : ''; security.value = p.security || 'tls'; };
        const read = () => ({ host: host.value.trim(), port: Number(port.value) || undefined, security: security.value });
        return { box, host, port, security, fill, read };
    }

    /** What Test account settings learned: the folders and the Inbox, or the error. */
    function maTestText(ui) {
        if (ui.testError) return `Could not connect: ${ui.testError}`;
        if (!ui.test) return 'Not tested yet';
        const n = (v) => Number(v || 0).toLocaleString();
        const f = Number(ui.test.folders) || 0;
        const i = Number(ui.test.inbox) || 0;
        return `Connected: ${n(f)} ${f === 1 ? 'folder' : 'folders'}, ${n(i)} ${i === 1 ? 'message' : 'messages'} in the Inbox`;
    }

    function maDetails(row, details, actions) {
        const ui = maUiOf(row.id || '');
        const email = customInput(row.email, 'someone@example.com');
        email.type = 'email';
        email.autocomplete = 'off';
        const name = customInput(row.displayName, 'The name people see on your messages');
        const pass = tmPassword(row.hasPassword ? 'Leave blank to keep the current password' : 'The password or app password');
        const note = tmText('', 'cpl-tm-hint');
        const noteField = customField('Note', note);
        const imap = maServer(row.imap, 'imap.example.com');
        const imapUser = customInput(row.imap && row.imap.user, 'The e-mail address');
        const smtp = maServer(row.smtp, 'smtp.example.com');
        const smtpUser = customInput(row.smtp && row.smtp.user, 'The e-mail address');
        // checked unless a separate SMTP password is saved (mailAccounts: hasSmtpPassword)
        const same = customCheck('Use the same password', !(row && row.hasSmtpPassword));
        const smtpPass = tmPassword(row.id ? 'Leave blank to keep the current SMTP password' : 'The SMTP password');
        const smtpPassField = customField('SMTP password', smtpPass);
        smtpPassField.hidden = true;
        same.input.addEventListener('change', () => { smtpPassField.hidden = same.input.checked; });
        const st = row.settings || {};
        const notify = customCheck('Notify me about new mail', st.notify !== false);
        const saveSent = maSelect(MA_SAVE_SENT, st.saveSent || 'auto');
        const saveSentLine = document.createElement('label');
        saveSentLine.className = 'cpl-ma-line';
        saveSentLine.append(tmText('Save sent mail:'), saveSent);
        const optBox = document.createElement('div');
        optBox.className = 'cpl-tm-options';
        optBox.append(notify.wrap, saveSentLine);
        const enabled = customCheck('Use this account', row.enabled !== false);
        const status = maStatus(row);
        const statusOut = tmText(status.text, status.state === 'fail' ? 'cpl-tm-error' : '');
        const syncOut = tmText(maSyncText(row));
        const testOut = tmText(maTestText(ui), ui.testError ? 'cpl-tm-error' : '');

        // a known provider's servers follow the address (until the servers are typed over)
        let filled = null;
        const showNote = (p) => { note.textContent = p && p.note ? `${p.name}: ${p.note}` : ''; noteField.hidden = !note.textContent; };
        const applyPreset = () => {
            const m = maApi();
            const p = m && typeof m.presetFor === 'function' ? m.presetFor(email.value.trim()) : null;
            showNote(p);
            if (!p) return;
            const untouched = (srv, key) => !srv.host.value.trim() || (filled && srv.host.value.trim() === filled[key].host);
            if (untouched(imap, 'imap')) imap.fill(p.imap || {});
            if (untouched(smtp, 'smtp')) smtp.fill(p.smtp || {});
            filled = p;
        };
        email.addEventListener('input', applyPreset);
        {
            const m = maApi();
            const p = m && typeof m.presetFor === 'function' ? m.presetFor(row.email || '') : null;
            showNote(p);
            if (p && row.imap && row.imap.host === (p.imap || {}).host) filled = p;
        }

        const payload = () => {
            const body = {
                id: row.id || undefined,
                email: email.value.trim(),
                displayName: name.value.trim(),
                imap: Object.assign(imap.read(), { user: imapUser.value.trim() || undefined }),
                smtp: Object.assign(smtp.read(), { user: smtpUser.value.trim() || undefined })
            };
            if (pass.value) body.password = pass.value;
            if (!same.input.checked && smtpPass.value) body.smtpPassword = smtpPass.value;
            // checked again: the server drops a separate SMTP password it kept
            if (same.input.checked) body.sameSmtpPassword = true;
            return body;
        };

        details.append(
            customField('E-mail address', email),
            customField('Your name', name),
            customField('Password', pass),
            noteField,
            customField('Incoming (IMAP)', imap.box),
            customField('User name', imapUser),
            customField('Outgoing (SMTP)', smtp.box),
            customField('User name', smtpUser),
            customField('Sign-in', same.wrap),
            smtpPassField,
            customField('Options', optBox),
            customField('Enabled', enabled.wrap),
            customField('Status', statusOut),
            customField('Copy on this server', syncOut),
            customField('Test result', testOut)
        );
        if (row.id) ui.liveDetails = { status: statusOut, sync: syncOut };
        actions.append(
            tmButton('Test account settings', async () => {
                testOut.textContent = 'Connecting...';
                testOut.className = '';
                try {
                    ui.test = await maApi().testAccount(payload());
                    ui.testError = '';
                } catch (err) {
                    ui.test = null;
                    ui.testError = (err && err.message) || 'No answer';
                }
                testOut.textContent = maTestText(ui);
                testOut.className = ui.testError ? 'cpl-tm-error' : '';
            }),
            tmButton('Save', async () => {
                const body = Object.assign(payload(), { enabled: enabled.input.checked, settings: { notify: notify.input.checked, saveSent: saveSent.value } });
                const saved = await maApi().saveAccount(body);
                maRows = maRows.filter((r) => r.id);
                if (saved && saved.id) { maUiOf(saved.id).open = true; csSel = `mail:${saved.id}`; }
                maPaintNext = true;
                await loadMailAccounts(true);
            })
        );
    }

    function maPaint() {
        maPaintNext = false;
        const list = hostEl && hostEl.querySelector('#cplMailAccountsList');
        if (!list) return;
        list.textContent = '';
        if (!maRows.length) {
            const empty = document.createElement('div');
            empty.className = 'cpl-vault-empty';
            empty.textContent = maLoadError || 'No e-mail accounts.';
            list.appendChild(empty);
            csRefresh();
            return;
        }
        maRows.forEach((row) => {
            const ui = maUiOf(row.id || '');
            const block = document.createElement('div');
            block.className = 'cpl-vault-row' + (ui.open ? ' is-open' : '');
            block.dataset.cplVaultKey = `mail:${row.id || ''}`;
            block.dataset.cplCardPicture = MA_PICTURE;
            const line = document.createElement('button');
            line.type = 'button';
            line.className = 'cpl-vault-line';
            const name = document.createElement('span');
            name.className = 'cpl-vault-name';
            name.textContent = row.email || 'New e-mail account';
            const sub = document.createElement('span');
            sub.className = 'cpl-vault-sub';
            const host = row.imap && row.imap.host;
            sub.textContent = [row.displayName, host ? `IMAP \u00b7 ${host}` : 'IMAP e-mail'].filter(Boolean).join(' \u00b7 ');
            name.appendChild(sub);
            const status = maStatus(row);
            const summary = document.createElement('span');
            summary.className = 'cpl-vault-summary';
            summary.textContent = row.id ? `${status.text} \u00b7 ${maSyncText(row)}` : 'Not saved';
            const chevron = document.createElement('span');
            chevron.className = 'cpl-vault-chevron';
            line.append(name, summary);
            let glance = null;
            if (row.id) { glance = makeGlance([{ state: status.state, label: status.text }]); line.append(glance); }
            line.append(chevron);
            line.addEventListener('click', () => { ui.open = !ui.open; maPaint(); });
            const details = document.createElement('div');
            details.className = 'cpl-vault-details';
            const actions = document.createElement('div');
            actions.className = 'cpl-vault-actions';
            maDetails(row, details, actions);
            if (row.id) {
                ui.live = { summary, glance, status: ui.liveDetails.status, sync: ui.liveDetails.sync };
                actions.append(tmButton('Delete', async () => {
                    const ok = typeof root.showConfirmationDialog === 'function' ? await root.showConfirmationDialog(`<p>Delete the e-mail account ${esc(row.email || row.id)}? The server's copy of its mail is removed; the mail stays on the mail server.</p>`,
                        [{ text: 'Delete', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, { title: 'Dreamscape CardSpace', width: 400 }) : true;
                    if (ok !== true) return;
                    await maApi().deleteAccount(row.id);
                    delete maUi[row.id];
                    await loadMailAccounts(true);
                }));
            }
            details.appendChild(actions);
            block.append(line, details);
            list.appendChild(block);
        });
        csRefresh();
    }

    function maAdd() {
        if (!maRows.some((r) => !r.id)) maRows.push({ id: '', email: '', displayName: '', enabled: true, hasPassword: false, settings: { notify: true, saveSent: 'auto' } });
        maUiOf('').open = true;
        maPaint();
    }

    function mountMailAccounts() {
        if (!hostEl || hostEl.querySelector('#cplVault-mail-accounts')) return;
        const head = document.createElement('div');
        head.className = 'cpl-vault-head';
        head.id = 'cplVault-mail-accounts';
        head.innerHTML = '<img src="/static_images/vista-cmdbar/mail.png" alt=""><span class="cpl-vault-title">E-mail Accounts</span><span class="cpl-vault-links"></span>';
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'cpl-vault-link';
        add.id = 'cplMaAdd';
        add.textContent = 'Add an e-mail account';
        add.addEventListener('click', maAdd);
        head.querySelector('.cpl-vault-links').appendChild(add);
        const list = document.createElement('div');
        list.className = 'cpl-vault-list';
        list.id = 'cplMailAccountsList';
        hostEl.append(head, list);
        maPaint();
        const m = maApi();
        if (m && typeof m.on === 'function' && !maOff) {
            let timer = 0;
            const onChange = () => { clearTimeout(timer); timer = setTimeout(() => void loadMailAccounts(true), 400); };
            ['account', 'sync', 'folders', 'progress'].forEach((e) => m.on(e, onChange));
            maOff = () => { clearTimeout(timer); if (typeof m.off === 'function') ['account', 'sync', 'folders', 'progress'].forEach((e) => m.off(e, onChange)); };
        }
        void loadMailAccounts(true);
    }

    function unmountMailAccounts() {
        if (maOff) { maOff(); maOff = null; }
        maRows = [];
        Object.keys(maUi).forEach((k) => { delete maUi[k]; });
    }

    // ---- the window: Vista's Windows CardSpace (icardagt.exe, icardres.dll; measured on the VM) ----
    //
    // Windows CardSpace is a window of its own (Control Panel only starts it). Its three views:
    //   home      "Select a card to preview": a card per credential in a group per kind, an Add a
    //             card tile, Tasks on the right, Preview at the foot
    //   details   "Card Details": the card on the left, what it holds on the right (the vault row's
    //             own details, moved in with their handlers), its actions as tasks, Edit / Save
    //   add       "Add a card": a green-arrow entry per kind that can be added
    // The vault (above) still builds the rows inside the window's hidden host; the views read it.

    const CS = '/static_images/vista-cardspace';
    // #781: one Service keys group holds the keychain services (Claude among them), Cursor (the
    // Director's profiles, no longer its only accounts) and each custom model provider.
    // The home page's groups: one card per account (Yukimi, #781). Application keys have a page
    // of their own (Tasks > Application keys), as a table.
    const CARD_KINDS = {
        service: ['Managed service accounts', 'Managed Service Account'],
        provider: ['Custom model providers', 'Custom Model Provider'],
        messaging: ['Messaging services', 'Messaging Service']
    };
    // the driver's forms and the request log: shown in the window's form view while open
    const CS_FORMS = ['secCursorAccountPanel', 'secKeychainEditPanel', 'secKeychainAddPanel', 'secAppkeysCreatePanel', 'secAppkeysEditPanel', 'secAppkeysLogPage'];
    const SECURE_PREF = 'cardspace.secureDesktop';
    let win = null;
    let csView = 'home';
    let csSel = null;
    let csMoved = null;
    let csTimer = 0;
    let csPendingSection = null;
    let csObserver = null;
    let csFormObserver = null;
    let csForm = null;
    let csFormReturn = 'home';
    let csFormOff = [];

    function csEl(sel) {
        return win ? win.querySelector(sel) : null;
    }

    /** The section a vault row belongs to (its list's head, or the custom providers' list). */
    function csKindOf(row) {
        const list = row.closest('.cpl-vault-list');
        if (!list) return 'service';
        if (list.id === 'cplCustomProviderList') return 'provider';
        if (list.id === 'cplTextMessagingList' || list.id === 'cplMailAccountsList') return 'messaging';
        if (list.id === 'cplKeyCardList') return 'service';
        const body = list.dataset.cplVaultFor || '';
        // each Cursor profile is a managed service account card of its own
        if (/Cursor/.test(body)) return 'service';
        // the keychain's per-service rows stay in the host: their keys are cards (cplKeyCardList)
        if (/Keychain/.test(body)) return 'keychain-service';
        return 'application';
    }

    /** What the details view calls the card, under its picture. */
    function csKindLabel(row) {
        const key = row.dataset.cplVaultKey || '';
        if (key.startsWith('custom:')) return 'Custom Model Provider';
        if (/^secCursorAccountsTableBody:/.test(key)) return 'Cursor Profile';
        if (key.startsWith('key:')) return `${row.dataset.cplServiceLabel || 'Service'} Account`;
        return (CARD_KINDS[csKindOf(row)] || CARD_KINDS.service)[1];
    }

    /** Every card (the Cursor profiles are rows inside the Cursor card, not cards of their own). */
    function csRows() {
        return hostEl ? [...hostEl.querySelectorAll('.cpl-vault-row[data-cpl-vault-key]')].filter((r) => !r.closest('.cs-nested')) : [];
    }

    function csRow(key) {
        return csRows().find((r) => r.dataset.cplVaultKey === key) || null;
    }

    function csName(row) {
        const name = row.querySelector('.cpl-vault-name');
        if (!name) return '';
        const first = [...name.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        // an application key's "Persistent" badge runs into its name in the vault's flattened text
        return (first ? first.textContent : name.textContent).trim().replace(/(\S)Persistent$/, '$1');
    }

    /** The row's action buttons: Edit and Delete first, as CardSpace's own order. */
    function csActions(row) {
        const holder = (csMoved && csMoved.row === row) ? csMoved.actions : row.querySelector(':scope > .cpl-vault-details > .cpl-vault-actions');
        return holder ? [...holder.querySelectorAll('button')] : [];
    }

    function csFind(row, re) {
        return csActions(row).find((b) => !b.disabled && re.test(`${b.dataset.secAction || ''} ${b.textContent}`));
    }

    // Cards from a provider or for an app wear its logo, as CardSpace's Managed cards wear their
    // issuer's picture (Yukimi: "use the app or provider logos"). Only logos the repo has; a card
    // without one keeps CardSpace's Personal card picture. Missing: OpenAI, OpenWeather, Exa Search,
    // RunPod, and the StaticForge MCP agents' application keys.
    const XAI = '/dist/custom-icons/xAI_Logomark_Dark.png';
    const DIRECTOR = '/static_images/app_icons/director.webp';
    const CURSOR = '/dist/custom-icons/cursor-icon.svg';
    const CLAUDE = '/dist/custom-icons/claude-icon.svg';
    // #781 card covers (generated card faces, full bleed) for cards with no logo of their own
    const COVER = (name) => `${CS}/covers/${name}.webp`;
    const SERVICE_COVERS = [
        [/^openai$/i, COVER('openai')],
        [/^openweather$/i, COVER('openweather')],
        [/^exa\b/i, COVER('exa')],
        [/^runpod$/i, COVER('runpod')]
    ];
    const SERVICE_LOGOS = [
        [/^novelai$/i, '/static_images/novelai-round.png'],
        [/^grok\b|xai/i, XAI],
        [/^google$/i, '/static_images/vista-gadgets/flowerpot/images/google.png'],
        [/^tokenrouter$/i, '/dist/custom-icons/tokenrouter-icon.svg'],
        [/^claude$/i, CLAUDE],
        [/^apple weather$/i, '/static_images/weather/apple-weather-mark@2x.png']
    ];
    // an application key's app, from its name and its client (user agent)
    const APP_LOGOS = [
        [/^cursor\b|\bcursor\//i, '/dist/custom-icons/cursor-icon.svg'],
        [/claude/i, '/dist/custom-icons/claude-icon.svg'],
        [/DreamscapeDirector/i, DIRECTOR],
        [/DreamscapeDedicatedAgentClient/i, '/static_images/icon.png'],
        [/^grok$/i, XAI]
    ];

    /** { src, logo }: a logo sits on white in the frame, a cover fills it. */
    function csPicture(row) {
        if (row.dataset.cplCardPicture) return { src: row.dataset.cplCardPicture, logo: true };
        const key = row.dataset.cplVaultKey || '';
        const kind = csKindOf(row);
        const name = csName(row);
        const sub = (row.querySelector('.cpl-vault-sub') || {}).textContent || '';
        const hit = (list, text) => (list.find(([re]) => re.test(text)) || [])[1] || '';
        if (/^secCursorAccountsTableBody:/.test(key)) return { src: CURSOR, logo: true };
        if (key.startsWith('custom:')) return { src: COVER('model-provider'), logo: false };
        if (kind === 'service') {
            const service = row.dataset.cplServiceLabel || name;
            const logo = hit(SERVICE_LOGOS, service);
            if (logo) return { src: logo, logo: true };
            const cover = hit(SERVICE_COVERS, service);
            return { src: cover || COVER('service-key'), logo: false };
        }
        if (kind === 'provider') return { src: COVER('model-provider'), logo: false };
        if (kind === 'keychain-service') {
            const logo = hit(SERVICE_LOGOS, name);
            if (logo) return { src: logo, logo: true };
            const cover = hit(SERVICE_COVERS, name);
            return { src: cover || COVER('service-key'), logo: false };
        }
        if (kind === 'application') {
            const logo = hit(APP_LOGOS, name) || hit(APP_LOGOS, sub);
            if (logo) return { src: logo, logo: true };
            // the StaticForge MCP agents (Rook, Sala, Menma …) send "<Name>/1.0 (StaticForge; …)"
            if (/\(StaticForge;/i.test(sub)) return { src: COVER('mcp-agent'), logo: false };
            return { src: COVER('application'), logo: false };
        }
        return { src: `${CS}/personal-card.png`, logo: false };
    }

    /** The Cursor card's dots: one per profile, from the profile rows inside it. */
    function csNestedDots(row) {
        const holder = csMoved && csMoved.row === row && csMoved.details ? csMoved.details : row;
        return [...holder.querySelectorAll('.cs-nested .cpl-vault-row .cpl-vault-status')].map((el) => el.innerHTML).join('');
    }

    function csCardName(row) {
        const name = csName(row);
        return /^secCursorAccountsTableBody:/.test(row.dataset.cplVaultKey || '') ? `Cursor · ${name}` : name;
    }

    /** CardSpace's cards carry no marks: only a state that needs you (warning, failure) shows a dot. */
    function csAttentionDots(dot) {
        if (!dot || !dot.innerHTML) return '';
        const box = document.createElement('span');
        box.innerHTML = dot.innerHTML;
        const keep = [...box.querySelectorAll('.sec-key-dot')].filter((d) => /sec-key-dot-(warn|fail)\b/.test(d.className));
        return keep.length ? `<span class="cs-card-dots">${keep.map((d) => d.outerHTML).join('')}</span>` : '';
    }

    /** A card: the picture in its dark frame, the name under it (the VM's 130 x 106 cell). */
    function csCard(row, extra) {
        const pic = csPicture(row);
        const logo = pic.logo;
        const picture = pic.src;
        const dot = row.dataset.cplVaultKey === 'cursor:' ? { innerHTML: csNestedDots(row) } : row.querySelector('.cpl-vault-status');
        const tip = (row.querySelector('.cpl-vault-sub') || {}).textContent || '';
        return `<button type="button" class="cs-card${extra || ''}" data-cs-key="${esc(row.dataset.cplVaultKey)}" title="${esc(tip)}">
            <span class="cs-card-pic${logo ? ' is-logo' : ''}"><img src="${esc(picture)}" alt="" draggable="false"></span>
            <span class="cs-card-name">${esc(csCardName(row))}</span>${csAttentionDots(dot)}</button>`;
    }

    /** A group per kind of card (as CardSpace's "Your cards:" group), Add a card in its own group after them. */
    /** Managed accounts: the Director's (Claude, Cursor) first, then the services in keychain order. */
    function csCardRank(row) {
        const key = row.dataset.cplVaultKey || '';
        if (key.startsWith('key:claude:')) return 0;
        if (/^secCursorAccountsTableBody:/.test(key)) return 1;
        return 2;
    }

    function csRenderHome() {
        csBuildKeyCards();
        const groups = Object.keys(CARD_KINDS).map((kind) => {
            const rows = csRows().filter((r) => csKindOf(r) === kind)
                .map((r, i) => [r, i]).sort((a, b) => (csCardRank(a[0]) - csCardRank(b[0])) || (a[1] - b[1])).map(([r]) => r);
            if (!rows.length) return '';
            return `<div class="cs-group"><div class="cs-group-label"><span>${esc(CARD_KINDS[kind][0])}:</span></div>
                <div class="cs-cards">${rows.map((r) => csCard(r, r.dataset.cplVaultKey === csSel ? ' is-selected' : '')).join('')}</div></div>`;
        }).join('');
        csEl('.cs-home').innerHTML = `${groups}<div class="cs-group"><div class="cs-cards"><button type="button" class="cs-card cs-card-add" data-cs-go="add"><span class="cs-card-add-face"><span>Add a card</span></span></button></div></div>`;
    }

    function csTask(label, attrs, enabled) {
        return `<li><button type="button" class="cs-task"${enabled === false ? ' disabled' : ''} ${attrs || ''}>${esc(label)}</button></li>`;
    }

    function csRenderTasks() {
        const list = csEl('.cs-tasks-list');
        const row = csSel && csRow(csSel);
        if (csView === 'details') {
            list.innerHTML = '<li class="cs-tasks-moved"></li><li class="cs-sep"></li>' + csTask('Help', 'data-cs-task="help"');
            const holder = list.querySelector('.cs-tasks-moved');
            if (csMoved && csMoved.actions) holder.appendChild(csMoved.actions);
            return;
        }
        if (csView === 'add') {
            list.innerHTML = csTask('What type of card should I add?', 'data-cs-task="help"') + csTask('Help', 'data-cs-task="help"');
            return;
        }
        if (csView === 'form' || csView === 'prefs') {
            list.innerHTML = csTask('Help', 'data-cs-task="help"');
            return;
        }
        if (csView === 'appkeys') {
            const sel = csAppSelected();
            list.innerHTML = csTask('Edit key', 'data-cs-app="edit"', !!(sel && sel.key))
                + csTask('Delete key', 'data-cs-app="delete"', !!(sel && sel.key))
                + (sel && sel.req ? csTask('Approve request', 'data-cs-app="approve"') + csTask('Deny request', 'data-cs-app="deny"') : '')
                + '<li class="cs-sep"></li>'
                + csTask('Create an application key', 'data-cs-click="secAppkeysCreateBtn"')
                + csTask('View the request log', 'data-cs-click="secAppkeysLogBtn"')
                + '<li class="cs-sep"></li>'
                + csTask('Help', 'data-cs-task="help"');
            return;
        }
        const del = row && csFind(row, /delete|revoke|deny/i);
        const has = (id) => !!(hostEl && hostEl.querySelector(`#${id}`));
        list.innerHTML = csTask('Duplicate card', '', false) + csTask('Delete card', 'data-cs-task="delete"', !!del)
            + '<li class="cs-sep"></li>'
            + csTask('Add a card', 'data-cs-go="add"')
            + csTask('Application keys', 'data-cs-go="appkeys"', has('secAppkeysTableBody'))
            + csTask('Preferences', 'data-cs-go="prefs"')
            + '<li class="cs-sep"></li>'
            + csTask('Delete all cards', '', false)
            + '<li class="cs-sep"></li>'
            + csTask('Help', 'data-cs-task="help"');
    }

    function csRenderFoot() {
        const foot = csEl('.cs-foot');
        if (csView === 'home') {
            foot.innerHTML = `<button type="button" class="tbp-button cs-foot-btn" data-dialog-primary="1" data-cs-go="details"${csSel && csRow(csSel) ? '' : ' disabled'}>Open</button>`;
        } else if (csView === 'details') {
            const row = csSel && csRow(csSel);
            const save = row && csFind(row, /^\s*save\s*$/i);
            const edit = row && csFind(row, /edit/i);
            foot.innerHTML = save
                ? '<button type="button" class="tbp-button cs-foot-btn cs-foot-save" data-dialog-primary="1" data-cs-task="save">Save</button><button type="button" class="tbp-button cs-foot-btn" data-cs-go="home">Cancel</button>'
                : (edit ? '<button type="button" class="tbp-button cs-foot-btn" data-dialog-primary="1" data-cs-task="edit">Edit</button>' : '');
        } else if (csView === 'form') {
            // Save / Cancel as CardSpace's Edit a new card; the panel's own submit is hidden and proxied.
            // After a key is issued (its secret on show) or on the request log, only Close.
            const submit = csFormSubmit();
            foot.innerHTML = submit
                ? '<button type="button" class="tbp-button cs-foot-btn cs-foot-save" data-dialog-primary="1" data-cs-task="form-save">Save</button><button type="button" class="tbp-button cs-foot-btn" data-cs-task="form-close">Cancel</button>'
                : '<button type="button" class="tbp-button cs-foot-btn" data-dialog-primary="1" data-cs-task="form-close">Close</button>';
        } else if (csView === 'appkeys') {
            const sel = csAppSelected();
            foot.innerHTML = `<button type="button" class="tbp-button cs-foot-btn" data-dialog-primary="1" data-cs-app="edit"${sel && sel.key ? '' : ' disabled'}>Edit</button>`;
        } else if (csView === 'prefs') {
            foot.innerHTML = '<button type="button" class="tbp-button cs-foot-btn" data-dialog-primary="1" data-cs-go="home">OK</button>';
        } else foot.innerHTML = '';
    }

    /** Put the details view's borrowed nodes back into their row. */
    function csPutBack() {
        if (!csMoved) return;
        const { row, details, actions } = csMoved;
        csMoved = null;
        if (!row.isConnected) return;
        if (actions && details) details.appendChild(actions);
        if (details) row.appendChild(details);
    }

    function csRenderDetails() {
        const row = csSel && csRow(csSel);
        const pane = csEl('.cs-details');
        if (!row) { csGo('home'); return; }
        if (!csMoved || csMoved.row !== row) {
            csPutBack();
            const details = row.querySelector('.cpl-vault-details');
            const actions = details && details.querySelector(':scope > .cpl-vault-actions');
            csMoved = { row, details, actions };
        }
        pane.innerHTML = `<div class="cs-details-card">${csCard(row, ' is-details')}<div class="cs-details-kind">${esc(csKindLabel(row))}</div></div>
            <div class="cs-details-info"><div class="cs-group-label"><span>Information in this card:</span></div><div class="cs-details-fields"></div></div>`;
        if (csMoved.details) pane.querySelector('.cs-details-fields').appendChild(csMoved.details);
    }

    const CS_TEXT = {
        home: ['Select a card to open', 'To see or edit a card\'s data, select the card, and then click Open. To add an account, click Add a card.'],
        appkeys: ['Application keys', 'Programs reach Dreamscape with these keys. Select a key, and then click Edit, or use the tasks on the right. Requests waiting for your approval are listed first.'],
        details: ['Card Details', 'This card is kept on the Dreamscape server. To change the card data, use the tasks on the right or click Edit.'],
        add: ['Add a card', 'Select the type of card you want to add.'],
        form: ['', 'Fill in the card data, and then click Save. To leave the card as it was, click Back.'],
        prefs: ['Preferences', 'Choose how Dreamscape CardSpace opens. The PINs and the approved computers have their own places in Control Panel.']
    };

    function csRender() {
        if (!win) return;
        const picked = csApplyPending();
        if (picked && csView !== 'home') { csPutBack(); csView = 'home'; }
        win.dataset.csView = csView;
        csEl('.cs-title').textContent = csView === 'form' ? csFormTitle() : CS_TEXT[csView][0];
        csEl('.cs-desc').textContent = csView === 'form' && csForm && csForm.id === 'secAppkeysLogPage'
            ? 'The requests programs made with their application keys. Inactive keys lists the keys that no longer work.'
            : CS_TEXT[csView][1];
        csEl('.cs-back').disabled = csView === 'home';
        win.dataset.csFormSide = csView === 'form' && csForm && csForm.id !== 'secAppkeysLogPage' ? '1' : '';
        if (csView === 'home') { csPutBack(); csRenderHome(); }
        if (csView === 'details') csRenderDetails();
        if (csView === 'add') csRenderAdd();
        if (csView === 'prefs') csRenderPrefs();
        if (csView === 'appkeys') csRenderAppkeys();
        if (csView === 'form') csRenderFormSide();
        if (csView === 'add') {
            const step = CS_ADD_STEPS[csAddStep];
            if (step && step.title) { csEl('.cs-title').textContent = step.title; csEl('.cs-desc').textContent = step.desc; }
        }
        csRenderTasks();
        csRenderFoot();
        if (picked) {
            const card = [...win.querySelectorAll('.cs-home .cs-card[data-cs-key]')].find((c) => c.dataset.csKey === csSel);
            if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });
        }
    }

    /** Drop an unsaved "New provider" draft (Cancel, Back, or leaving its details). */
    function csDiscardDraft() {
        if (tmRows.some((row) => !row.id)) {
            tmRows = tmRows.filter((row) => row.id);
            if (csSel === 'sms:') csSel = null;
            paintTextMessaging();
        }
        if (maRows.some((row) => !row.id)) {
            maRows = maRows.filter((row) => row.id);
            if (csSel === 'mail:') csSel = null;
            maPaint();
        }
        if (!customProviderRows.some((row) => !row.id)) return false;
        customProviderRows = customProviderRows.filter((row) => row.id);
        if (csSel === 'custom:') csSel = null;
        paintCustomProviders();
        return true;
    }

    function csGo(next) {
        if (next === 'details' && !(csSel && csRow(csSel))) return;
        // leaving a form closes it through the driver (its close button), which brings us back
        if (csView === 'form' && next !== 'form' && csForm) { csCloseForm(); return; }
        if (next !== 'details') { csPutBack(); csDiscardDraft(); }
        if (next === 'add' && csView !== 'add') csAddStep = 'root';
        csView = next;
        csRender();
    }

    // ---- the form view: a driver panel (or the request log) opened inside the window (#781) ----
    // The panels stay in the host (the driver finds its inputs under it). The form view shows the
    // host with every branch but the open panel hidden; closing the panel brings the view back.

    function csFormTarget() {
        if (!hostEl) return null;
        for (const id of CS_FORMS) {
            const el = hostEl.querySelector(`#${id}`);
            if (el && !el.classList.contains('hidden')) return el;
        }
        return null;
    }

    function csFormTitle() {
        if (!csForm) return '';
        if (csForm.id === 'secAppkeysLogPage') return 'Request log';
        const strong = csForm.querySelector('.sec-details-header strong');
        return strong ? strong.textContent.trim().replace(/Cursor Account Profile/, 'Cursor profile') : 'Card';
    }

    function csUnmarkForm() {
        csFormOff.forEach((el) => el.classList.remove('cs-form-off'));
        csFormOff = [];
    }

    function csMarkForm(target) {
        csUnmarkForm();
        for (let el = target; el && el !== hostEl; el = el.parentElement) {
            const parent = el.parentElement;
            if (!parent) break;
            [...parent.children].forEach((sib) => {
                if (sib !== el && !sib.classList.contains('cs-form-off')) {
                    sib.classList.add('cs-form-off');
                    csFormOff.push(sib);
                }
            });
        }
    }

    function csCloseForm() {
        const target = csForm;
        if (!target) return;
        const close = target.id === 'secAppkeysLogPage'
            ? target.querySelector('#secAppkeysLogBack')
            : target.querySelector('.sec-details-header [data-sec-action^="close-"]');
        if (close) close.click(); else target.classList.add('hidden');
        csFormSync();
    }

    /** A driver panel opened or closed (a class change under the host). */
    function csFormSync() {
        if (!win || !hostEl) return;
        const target = csFormTarget();
        if (target) {
            if (csForm === target && csView === 'form') return;
            if (csView !== 'form') csFormReturn = csView === 'details' || csView === 'appkeys' ? csView : 'home';
            csForm = target;
            csMarkForm(target);
            csView = 'form';
            csRender();
            const pane = csEl('.cs-panel > .cs-host');
            if (pane) pane.scrollTop = 0;
            const first = target.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=color]), textarea');
            if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
            return;
        }
        if (csView !== 'form') return;
        csForm = null;
        csUnmarkForm();
        csView = csFormReturn === 'details' && csSel && csRow(csSel) ? 'details' : (csFormReturn === 'appkeys' ? 'appkeys' : 'home');
        if (csView === 'home') csPutBack();
        csRender();
    }

    // ---- Preferences (was a link to the old Security Center) ----

    function csSecurePref() {
        try { return localStorage.getItem(SECURE_PREF) !== '0'; } catch (_err) { return true; }
    }

    function csRenderPrefs() {
        csEl('.cs-prefs').innerHTML = `<div class="cs-group-label"><span>When Dreamscape CardSpace opens:</span></div>
            <div class="cs-pref-check desktop-settings-check"><input type="checkbox" id="csPrefSecure" data-cs-pref="secure"${csSecurePref() ? ' checked' : ''}><label for="csPrefSecure">Switch to the secure desktop</label></div>
            <p class="cs-pref-note">The rest of the desktop is dimmed and cannot be used until CardSpace closes, as when Melaton asks for your permission.</p>
            <div class="cs-group-label"><span>Related settings:</span></div>
            <ul class="cs-pref-links">
                <li><button type="button" class="cs-task" data-cs-related="pins">Change the logon PINs (User Accounts)</button></li>
                <li><button type="button" class="cs-task" data-cs-related="approved">Approved computers (Melaton Defender)</button></li>
            </ul>`;
    }

    async function csOpenRelated(which) {
        // another window cannot sit behind the secure desktop: CardSpace closes first
        await csSecureOff(() => {
            if (typeof root.closeModal === 'function') root.closeModal(win);
            csClose();
        });
        setTimeout(() => {
            if (which === 'pins' && root.cplUserAccounts && typeof root.cplUserAccounts.open === 'function') root.cplUserAccounts.open();
            /* global securityDsapOpenDefender */
            if (which === 'approved' && typeof securityDsapOpenDefender === 'function') securityDsapOpenDefender('approved');
        }, 0);
    }

    // ---- the secure desktop (Vista's consent / CardSpace desktop), root.melatonSecureDesktop ----
    // A layer of its own (desktop-boot.css --z-secure-desktop): above every desktop layer and
    // always-on-top window, below the lock cover, the Welcome screen and the boot covers. A window
    // tagged .secure-desktop-window stacks from that base in the Vista Basic frame (no DWM there).
    // Switching cuts to black for SWITCH_MS, then cuts to the other desktop, both ways. While it is
    // up, dialogs and toasts a secure window brings up (Delete's confirmation, a save toast, the
    // RCS Google sign-in) are tagged too, so they come up on it instead of behind it.
    const secureDesktop = (() => {
        const SWITCH_MS = 500;
        const SPAWN_MS = 4000;
        let backdrop = null;
        let cover = null;
        let stack = 0;
        let spawnUntil = 0;
        let toastTimer = 0;
        let spawnWatch = null;
        const tagged = new Set();
        const owners = new Set();

        function tag(el) {
            if (!el || !el.classList) return;
            stack += 1;
            // integer z from the layer's base (desktop-boot.css --z-secure-desktop 2147481000)
            el.style.setProperty('--secure-desktop-z', String(2147481010 + stack));
            el.classList.add('secure-desktop-window');
            tagged.add(el);
        }

        function untag(el) {
            if (!el || !el.classList) return;
            el.classList.remove('secure-desktop-window');
            el.style.removeProperty('--secure-desktop-z');
            tagged.delete(el);
        }

        function isActive() {
            return !!(backdrop && backdrop.isConnected);
        }

        /** A secure window was used: what it opens in the next moments belongs on the secure desktop. */
        function noteSpawn() {
            spawnUntil = Date.now() + SPAWN_MS;
        }

        function tagToasts() {
            const box = document.querySelector('.toast-container');
            if (!box) return;
            tag(box);
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { if (isActive()) untag(box); }, SPAWN_MS + 6000);
        }

        function watchSpawns() {
            if (spawnWatch) return;
            spawnWatch = new MutationObserver((records) => {
                if (Date.now() > spawnUntil) return;
                records.forEach((r) => {
                    const el = r.target;
                    if (r.type === 'childList') {
                        r.addedNodes.forEach((n) => {
                            if (n.nodeType !== 1) return;
                            if (n.classList.contains('modal') && !n.classList.contains('hidden')) tag(n);
                            if (n.closest && n.closest('.toast-container')) tagToasts();
                        });
                        return;
                    }
                    if (el.classList && el.classList.contains('modal') && !el.classList.contains('hidden') && !tagged.has(el)) tag(el);
                });
            });
            spawnWatch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        }

        function showCover() {
            if (!cover) {
                cover = document.createElement('div');
                cover.className = 'secure-desktop-switch';
                cover.setAttribute('aria-hidden', 'true');
            }
            document.body.appendChild(cover);
        }

        const hold = () => new Promise((resolve) => setTimeout(resolve, SWITCH_MS));

        /** Cut to black, run setup (open and tag the windows) under it, hold, cut to the secure desktop. */
        async function enter(owner, setup) {
            owners.add(owner);
            const already = isActive();
            if (!already) showCover();
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'secure-desktop-backdrop';
                backdrop.setAttribute('aria-hidden', 'true');
                // nothing else is on the secure desktop: clicks there go nowhere
                ['mousedown', 'click', 'contextmenu', 'dblclick'].forEach((type) => backdrop.addEventListener(type, (ev) => { ev.preventDefault(); ev.stopPropagation(); }));
            }
            if (!backdrop.isConnected) document.body.appendChild(backdrop);
            document.documentElement.classList.add('secure-desktop-active');
            if (typeof setup === 'function') setup();
            watchSpawns();
            if (already) return;
            await hold();
            if (cover) cover.remove();
        }

        /** Cut to black, tear down under it, hold, cut back to the normal desktop. */
        async function leave(owner, teardown) {
            owners.delete(owner);
            if (!isActive()) { if (typeof teardown === 'function') teardown(); return; }
            showCover();
            if (typeof teardown === 'function') teardown();
            if (!owners.size) {
                [...tagged].forEach(untag);
                if (spawnWatch) { spawnWatch.disconnect(); spawnWatch = null; }
                clearTimeout(toastTimer);
                if (backdrop) backdrop.remove();
                document.documentElement.classList.remove('secure-desktop-active');
            }
            await hold();
            if (cover) cover.remove();
        }

        return { enter, leave, tag, untag, isActive, noteSpawn, SWITCH_MS };
    })();
    root.melatonSecureDesktop = secureDesktop;
    let csSecureWatch = null;

    function csSecureOn() {
        if (!win || !csSecurePref() || typeof document === 'undefined') return Promise.resolve();
        if (!csSecureWatch) {
            // closed from anywhere (taskbar, closeModal): back to the normal desktop
            csSecureWatch = new MutationObserver(() => { if (win.classList.contains('hidden')) void csSecureOff(); });
            csSecureWatch.observe(win, { attributes: true, attributeFilter: ['class'] });
        }
        return secureDesktop.enter('cardspace', () => secureDesktop.tag(win));
    }

    /**
     * A web page CardSpace needs (the Google sign-in for RCS pairing): a standalone Alchemy window.
     * On the secure desktop it comes up there too (tagged, above CardSpace) until CardSpace leaves.
     */
    async function csOpenBrowser(url, title) {
        const fl = root.featureLoader;
        if (fl && typeof fl.loadFeature === 'function') await fl.loadFeature('grimoire');
        /* global grimoireOpenStandaloneWindow */
        const open = typeof grimoireOpenStandaloneWindow === 'function' ? grimoireOpenStandaloneWindow : root.grimoireOpenStandaloneWindow;
        if (typeof open !== 'function') { if (typeof root.openGrimoireUrl === 'function') await root.openGrimoireUrl(url); return; }
        const before = new Set(document.querySelectorAll('.modal'));
        open(url, null, title);
        const made = [...document.querySelectorAll('.modal')].filter((m) => !before.has(m));
        if (secureDesktop.isActive()) made.forEach((m) => secureDesktop.tag(m));
    }

    /** teardown: what to do under the black (close the window). */
    function csSecureOff(teardown) {
        if (csSecureWatch) { csSecureWatch.disconnect(); csSecureWatch = null; }
        return secureDesktop.leave('cardspace', teardown);
    }


    /**
     * Which card is selected, from state alone (no DOM): the selection the user made, or the first
     * card of a group the window was opened on (the tray's Service keys link). A pending group stays
     * pending until its rows exist, so a render before the driver's first load (or any later
     * rebuild) cannot lose it. rows: [{ key, kind }] in display order.
     */
    function resolveSelection(sel, pendingKind, rows) {
        if (pendingKind) {
            const first = rows.find((r) => r.kind === pendingKind);
            if (first) return { sel: first.key, pending: null, picked: true };
            return { sel, pending: pendingKind, picked: false };
        }
        return { sel, pending: null, picked: false };
    }

    /** Apply a pending group selection to csSel; true when it just landed. */
    function csApplyPending() {
        if (!csPendingSection) return false;
        const next = resolveSelection(csSel, csPendingSection, csRows().map((r) => ({ key: r.dataset.cplVaultKey, kind: csKindOf(r) })));
        csSel = next.sel;
        csPendingSection = next.pending;
        return next.picked;
    }

    /** The one select path: a user's click on a card and the Service keys link both come here. */
    function csSelect(key) {
        csSel = key || null;
        csPendingSection = null;
        if (csView !== 'home') { csGo('home'); return; }
        csRender();
    }

    /** The vault changed under the window (the driver re-rendered, a provider was saved). */
    function csRefresh() {
        if (!win || csTimer) return;
        csTimer = setTimeout(() => {
            csTimer = 0;
            if (csView === 'details' && !csPendingSection) {
                const row = csSel && csRow(csSel);
                if (!row) { csGo('home'); return; }
                if (csMoved && csMoved.row === row && row.isConnected) { csRenderTasks(); csRenderFoot(); return; }
            }
            csRender();
        }, 0);
    }

    // ---- one card per service key (#781): the keychain's services hold several keys each ----
    // Built from the driver's keychain state into a list of its own in the host (rows like the
    // vault's, so the details view and tasks work the same). Rebuilt only when that state changes:
    // the host observer re-renders on every host mutation.
    let csKeySig = '';

    function csKeyServices() {
        return (driver && driver._state && driver._state.keychain && driver._state.keychain.services) || [];
    }

    function csBuildKeyCards() {
        if (!hostEl) return;
        const services = csKeyServices();
        const sig = JSON.stringify(services.map((sv) => [sv.id, sv.selectedIndex, (sv.keys || []).map((k) => [k.name, k.fingerprint, k.status && k.status.state])]));
        let list = hostEl.querySelector('#cplKeyCardList');
        if (list && sig === csKeySig) return;
        csKeySig = sig;
        if (!list) {
            list = document.createElement('div');
            list.className = 'cpl-vault-list';
            list.id = 'cplKeyCardList';
            hostEl.appendChild(list);
        }
        const rows = [];
        services.forEach((sv) => {
            const keys = sv.keys || [];
            keys.forEach((k) => {
                const inUse = k.index === sv.selectedIndex;
                const label = sv.label || sv.id;
                const name = keys.length < 2 ? label : (k.name.toLowerCase().startsWith(label.toLowerCase()) ? k.name : `${label} · ${k.name}`);
                const state = k.status && k.status.state ? k.status.state : 'unchecked';
                const dot = sv.statusCheck === false ? '' : `<span class="cpl-vault-status"><span class="sec-key-dot sec-key-dot-${esc(state)}" title="${esc(KEY_DOT_WORD[state] || state)}" role="img" aria-label="${esc(KEY_DOT_WORD[state] || state)}"></span></span>`;
                const field = (l, v) => `<div class="cpl-vault-field"><span class="cpl-vault-label">${esc(l)}:</span><span class="cpl-vault-value">${esc(v)}</span></div>`;
                const op = (o, text, off) => `<button type="button" data-cs-keyop="${o}" data-cs-service="${esc(sv.id)}" data-cs-index="${k.index}"${off ? ' disabled' : ''}>${esc(text)}</button>`;
                rows.push(`<div class="cpl-vault-row" data-cpl-vault-key="key:${esc(sv.id)}:${k.index}" data-cpl-service-label="${esc(label)}">
                    <button type="button" class="cpl-vault-line"><span class="cpl-vault-name">${esc(name)}<span class="cpl-vault-sub">${esc(sv.description || '')}</span></span>${dot}</button>
                    <div class="cpl-vault-details">${field('Service', label)}${field('Account name', k.name)}${field(sv.keyLabel ? 'Key' : 'Fingerprint', k.fingerprint || '—')}${field('In use', inUse ? 'Yes, this account is the one Dreamscape uses' : 'No')}${sv.statusCheck === false ? '' : field('Status', KEY_DOT_WORD[state] || state)}
                    <div class="cpl-vault-actions">${op('edit', 'Edit')}${op('use', 'Use this account', inUse)}${op('delete', 'Delete')}</div></div></div>`);
            });
        });
        list.innerHTML = rows.join('');
    }

    /** Edit / Delete / Use act on the service's pending selection: point it at this key first. */
    async function csKeyOp(op, serviceId, index) {
        if (!driver || !driver._state) return;
        const kc = driver._state.keychain;
        const before = kc.pendingSelections[serviceId];
        kc.pendingSelections[serviceId] = index;
        try {
            if (op === 'edit') driver._openKeychainEditPanel(hostEl, serviceId);
            if (op === 'delete') await driver._deleteKeychainKey(hostEl, serviceId);
            if (op === 'use') await driver._saveKeychainSelections(hostEl);
        } finally {
            // a cancelled Use leaves the selection as it was
            if (op === 'use' && kc.originalSelections[serviceId] !== index) kc.pendingSelections[serviceId] = kc.originalSelections[serviceId];
            else if (op !== 'use' && kc.pendingSelections[serviceId] === index) kc.pendingSelections[serviceId] = before;
        }
    }

    // ---- the Application keys page: the keys as a Vista list, pending requests first ----
    let csAppSel = null;

    function csAppState() {
        const st = driver && driver._state && driver._state.appkeys;
        if (!st) return { keys: [], pending: [] };
        /* global securityDsapAppkeyIsInactive */
        const inactive = typeof securityDsapAppkeyIsInactive === 'function' ? securityDsapAppkeyIsInactive : (k) => /expired|replaced|revoked/.test(k.status || '');
        return { keys: (st.keys || []).filter((k) => !inactive(k)), pending: st.pending || [] };
    }

    function csAppSelected() {
        if (!csAppSel) return null;
        const { keys, pending } = csAppState();
        if (csAppSel.startsWith('req:')) {
            const req = pending.find((r) => `req:${r.id}` === csAppSel);
            return req ? { req } : null;
        }
        const key = keys.find((k) => k.id === csAppSel);
        return key ? { key } : null;
    }

    function csAppDate(value, fallback) {
        if (!value) return fallback;
        const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
        return Number.isNaN(d.getTime()) ? fallback : d.toLocaleDateString();
    }

    function csRenderAppkeys() {
        const pane = csEl('.cs-appkeys');
        if (!pane) return;
        const { keys, pending } = csAppState();
        if (csAppSel && !csAppSelected()) csAppSel = null;
        const tr = (id, cells, extra) => `<tr data-cs-app-id="${esc(id)}" class="${csAppSel === id ? 'is-selected' : ''}${extra || ''}">${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
        const dot = (g) => `<span class="sec-key-dot sec-key-dot-${g.state}" title="${esc(g.label)}"></span> ${esc(g.label)}`;
        const rows = pending.map((r) => tr(`req:${r.id}`, [
            `${esc(r.appName || 'Program')}<br><span class="cs-app-ua">${esc(r.userAgent || '')}</span>`,
            esc(r.requestCode || ''), dot({ state: 'warn', label: 'Waiting for approval' }), '—', '—'
        ], ' is-pending')).concat(keys.map((k) => tr(k.id, [
            `${esc(k.appName || k.label || 'Program')}<br><span class="cs-app-ua">${esc(k.userAgent || '')}</span>`,
            esc(k.keyPrefix ? `${k.keyPrefix}…` : ''),
            dot(appKeyGlance(k.status)),
            esc(k.persistent || k.isPerpetual ? 'Never' : csAppDate(k.expiresAt, '—')),
            esc(k.persistent ? '—' : csAppDate(k.refreshBeforeAt, '—'))
        ])));
        pane.innerHTML = `<table class="cs-app-table"><thead><tr><th>Program</th><th>Key</th><th>Status</th><th>Expires</th><th>Refresh by</th></tr></thead>
            <tbody>${rows.join('') || '<tr class="cs-app-empty"><td colspan="5">No application keys.</td></tr>'}</tbody></table>`;
    }

    function csAppAction(what) {
        const sel = csAppSelected();
        if (!sel || !driver) return;
        const fake = (action, attr, value) => {
            const b = document.createElement('button');
            b.dataset.secAction = action;
            b.dataset[attr] = value;
            driver._onClick({ target: b });
        };
        if (sel.key && what === 'edit') { driver._openAppkeyEdit(hostEl, sel.key.id); return; }
        if (sel.key && what === 'delete') fake('revoke-appkey', 'secAppkeyId', sel.key.id);
        if (sel.req && what === 'approve') fake('approve-appkey-req', 'secAppkeyReq', sel.req.id);
        if (sel.req && what === 'deny') fake('deny-appkey-req', 'secAppkeyReq', sel.req.id);
    }

    // ---- the form view's left column: the card being made or edited, as Edit a new card ----

    function csFormSubmit() {
        if (!csForm || csForm.id === 'secAppkeysLogPage') return null;
        const result = csForm.querySelector('#secAppkeyCreateResult');
        if (result && !result.classList.contains('hidden') && result.textContent.trim()) return null;
        return csForm.querySelector('.sec-appkeys-form-actions .sec-btn-primary');
    }

    function csRenderFormSide() {
        const side = csEl('.cs-form-side');
        if (!side) return;
        if (!csForm || csForm.id === 'secAppkeysLogPage') { side.innerHTML = ''; return; }
        const kc = (driver && driver._state && driver._state.keychain) || {};
        const hit = (list, text) => (list.find(([re]) => re.test(text)) || [])[1] || '';
        let src = COVER('application');
        let logo = false;
        let kind = 'Application Key';
        let name = '';
        if (csForm.id === 'secCursorAccountPanel') {
            src = CURSOR; logo = true; kind = 'Cursor Profile';
            name = (csForm.querySelector('#secCursorAccountNameInput') || {}).value || '';
        } else if (/Keychain/.test(csForm.id)) {
            const id = csForm.id === 'secKeychainAddPanel' ? kc.addServiceId : kc.editServiceId;
            const sv = csKeyServices().find((x) => x.id === id) || {};
            const label = sv.label || id || 'Service';
            const l = hit(SERVICE_LOGOS, label);
            src = l || hit(SERVICE_COVERS, label) || COVER('service-key');
            logo = !!l;
            kind = `${label} Account`;
            name = label;
        } else if (csForm.id === 'secAppkeysEditPanel') {
            name = (csForm.querySelector('#secAppkeyEditNameInput') || {}).value || '';
        }
        side.innerHTML = `<div class="cs-details-card"><span class="cs-card is-details"><span class="cs-card-pic${logo ? ' is-logo' : ''}"><img src="${esc(src)}" alt="" draggable="false"></span><span class="cs-card-name">${esc(name)}</span></span><div class="cs-details-kind">${esc(kind)}</div></div>`;
        // "Personalize this card:" over the fields, as the VM's Edit a new card
        const body = csForm.querySelector('.sec-details-body');
        if (body && !body.querySelector('.cs-form-head')) {
            const head = document.createElement('div');
            head.className = 'cs-group-label cs-form-head';
            head.innerHTML = '<span>Personalize this card:</span>';
            body.insertBefore(head, body.firstChild);
        }
    }

    // ---- Add a card: what kind of card, then (for two of them) which one ----
    let csAddStep = 'root';
    const CS_ADD_STEPS = {
        root: {
            items: [
                ['secAppkeysCreateBtn', 'Create a Personal Application Key', 'Application keys let your programs reach Dreamscape on your behalf. Each key has its own name and access, and you can revoke it at any time.'],
                ['step:managed', 'Install a Managed Service Account', 'Accounts at the services Dreamscape works with: Claude and Cursor for the Director, NovelAI, OpenAI, Google and the others. To learn which one to choose, click What type of card should I add?'],
                ['custom-provider', 'Install a Custom Model Provider', 'Another model host for the Director: its address, its key and the model it uses by default.'],
                ['step:messaging', 'Install a Messaging Service', 'iMessage through a BlueBubbles server, RCS through Google Messages, or an e-mail account, for Melaton Messenger, the phone and Dovecote Express.']
            ]
        },
        managed: {
            title: 'Install a Managed Service Account',
            desc: 'Select the service the account is for.',
            items: () => [
                ['key:claude', 'Claude', 'A Claude account the Director signs in with (paste the token from claude setup-token). The selected account runs the Claude engine for Yumiya, Yozora and Rentan.'],
                ['secCursorAccountsAddBtn', 'Cursor', 'A Cursor profile the Director can run Yumiya and Yozora on.']
            ].concat(csKeyServices().filter((sv) => sv.id !== 'claude').map((sv) => [`key:${sv.id}`, sv.label || sv.id, sv.description || '']))
        },
        messaging: {
            title: 'Install a Messaging Service',
            desc: 'Select the kind of messaging service.',
            items: [
                ['tm-bluebubbles', 'iMessage (BlueBubbles server)', 'A BlueBubbles server on a Mac brings your iMessage conversations to Melaton Messenger and the phone. Type its address and password.'],
                ['tm-rcs', 'RCS (Google Messages)', 'Pair Google Messages on your Android phone by scanning a QR code, and its RCS and SMS conversations join Melaton Messenger.'],
                ['ma-add', 'E-mail account', 'An IMAP e-mail account (Gmail, iCloud Mail, Outlook.com, Yahoo Mail or your own provider). The server keeps a copy of its mail and sends with it.']
            ]
        }
    };

    function csRenderAdd() {
        const step = CS_ADD_STEPS[csAddStep] || CS_ADD_STEPS.root;
        const items = typeof step.items === 'function' ? step.items() : step.items;
        const pane = csEl('.cs-add');
        pane.classList.toggle('is-list', csAddStep !== 'root');
        pane.innerHTML = items.map(([id, title, text]) => `<button type="button" class="cs-add-item" data-cs-add="${esc(id)}">
            <img src="${CS}/arrow.png" alt="" class="cs-add-arrow"><span class="cs-add-title">${esc(title)}</span><span class="cs-add-text">${esc(text)}</span></button>`).join('');
    }

    function csAdd(id) {
        if (id.startsWith('step:')) { csAddStep = id.slice(5); csRender(); return; }
        if (id.startsWith('key:')) {
            csGo('home');
            if (driver && typeof driver._openKeychainAddPanel === 'function') driver._openKeychainAddPanel(hostEl, id.slice(4));
            return;
        }
        if (id === 'tm-bluebubbles') {
            tmAddBlueBubbles();
            setTimeout(() => {
                const fresh = csRow('sms:');
                if (fresh) { csSel = fresh.dataset.cplVaultKey; csGo('details'); } else csGo('home');
            }, 0);
            return;
        }
        if (id === 'ma-add') {
            maAdd();
            setTimeout(() => {
                const fresh = csRow('mail:');
                if (fresh) { csSel = fresh.dataset.cplVaultKey; csGo('details'); } else csGo('home');
            }, 0);
            return;
        }
        if (id === 'tm-rcs') {
            void tmAddRcs().then((newId) => {
                const row = newId && csRow(`sms:${newId}`);
                if (row) { csSel = row.dataset.cplVaultKey; csGo('details'); } else csGo('home');
            });
            return;
        }
        if (id === 'custom-provider') {
            const add = hostEl.querySelector('#cplVault-custom-models .cpl-vault-link');
            if (add) add.click();
            setTimeout(() => {
                const fresh = csRow('custom:');
                if (fresh) { csSel = fresh.dataset.cplVaultKey; csGo('details'); } else csGo('home');
            }, 0);
            return;
        }
        const btn = hostEl.querySelector(`#${id}`);
        csGo('home');
        if (btn) btn.click();
    }

    function csWire() {
        win.addEventListener('click', (ev) => {
            const t = ev.target;
            // The driver listens on its host only. Buttons the window moved out of it (a card's
            // fields, its tasks, the Cursor profiles) hand their click to the driver here.
            const act = t.closest('[data-sec-action]');
            if (act && driver && hostEl && !hostEl.contains(act)) {
                if (!act.disabled) driver._onClick({ target: act });
                return;
            }
            const proxy = t.closest('[data-cs-proxy]');
            if (proxy) { const b = hostEl && hostEl.querySelector(`#${proxy.dataset.csProxy}`); if (b) b.click(); return; }
            const related = t.closest('[data-cs-related]');
            if (related) { csOpenRelated(related.dataset.csRelated); return; }
            const card = t.closest('.cs-card[data-cs-key]');
            if (card && csView === 'home') {
                csSelect(card.dataset.csKey);
                return;
            }
            const go = t.closest('[data-cs-go]');
            if (go && !go.disabled) { csGo(go.dataset.csGo); return; }
            if (t.closest('.cs-back')) {
                if (csView === 'add' && csAddStep !== 'root') { csAddStep = 'root'; csRender(); return; }
                csGo(csView === 'form' ? csFormReturn : 'home');
                return;
            }
            const keyop = t.closest('[data-cs-keyop]');
            if (keyop && !keyop.disabled) { csKeyOp(keyop.dataset.csKeyop, keyop.dataset.csService, Number(keyop.dataset.csIndex)); return; }
            const appRow = t.closest('.cs-app-table tbody tr[data-cs-app-id]');
            if (appRow) { csAppSel = appRow.dataset.csAppId; csRenderAppkeys(); csRenderTasks(); csRenderFoot(); return; }
            const app = t.closest('[data-cs-app]');
            if (app && !app.disabled) { csAppAction(app.dataset.csApp); return; }
            const add = t.closest('[data-cs-add]');
            if (add) { csAdd(add.dataset.csAdd); return; }
            const click = t.closest('[data-cs-click]');
            if (click && !click.disabled) { const b = hostEl.querySelector(`#${click.dataset.csClick}`); if (b) b.click(); return; }
            const task = t.closest('[data-cs-task]');
            if (task && !task.disabled) {
                const row = csSel && csRow(csSel);
                const which = task.dataset.csTask;
                if (which === 'help') { if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('cardspace'); return; }
                if (which === 'form-close') { csCloseForm(); return; }
                if (which === 'form-save') { const b = csFormSubmit(); if (b) b.click(); return; }
                const btn = row && (which === 'delete' ? csFind(row, /delete|revoke|deny/i) : which === 'save' ? csFind(row, /^\s*save\s*$/i) : csFind(row, /edit/i));
                if (btn) btn.click();
            }
        });
        win.addEventListener('change', (ev) => {
            const pref = ev.target.closest('[data-cs-pref="secure"]');
            if (!pref) return;
            try { localStorage.setItem(SECURE_PREF, pref.checked ? '1' : '0'); } catch (_err) { /* this session only */ }
            if (pref.checked) void csSecureOn(); else void csSecureOff();
        });
        win.addEventListener('dblclick', (ev) => {
            const appRow = ev.target.closest('.cs-app-table tbody tr[data-cs-app-id]');
            if (appRow) { csAppSel = appRow.dataset.csAppId; csAppAction('edit'); return; }
            const card = ev.target.closest('.cs-home .cs-card[data-cs-key]');
            if (card) { csSel = card.dataset.csKey; csGo('details'); }
        });
        // Windows CardSpace has a close button only; on the secure desktop the switch back cuts to black first
        win.querySelector('.cs-close').addEventListener('click', () => {
            void csSecureOff(() => {
                if (typeof root.closeModal === 'function') root.closeModal(win);
                csClose();
            });
        });
        // what CardSpace opens next (confirmations, toasts) joins it on the secure desktop
        ['pointerdown', 'keydown'].forEach((type) => win.addEventListener(type, () => secureDesktop.noteSpawn(), true));
    }

    function csBuild() {
        win = document.createElement('div');
        win.id = 'dreamscapeCardSpaceModal';
        win.className = 'modal hidden resizeable-window cs-window';
        win.dataset.windowIdentifier = 'dreamscapeCardSpace';
        win.dataset.windowClient = 'light';
        win.dataset.windowDefaultWidth = '756';
        win.dataset.windowDefaultHeight = '550';
        // the panel and the Tasks column sit at fixed client offsets (588 px + Tasks): narrower cuts Tasks off
        win.dataset.windowMinWidth = '756';
        win.dataset.windowMinHeight = '420';
        win.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${CS}/cardspace-16.png" alt=""><span>Dreamscape CardSpace</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-danger close-btn btn-small cs-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content win7 tbp-client cs-client">
                <button type="button" class="cs-back" title="Back" disabled><span class="cs-back-orb"></span></button>
                <div class="cs-title"></div>
                <div class="cs-desc"></div>
                <div class="cs-panel">
                    <div class="cs-home"></div>
                    <div class="cs-details"></div>
                    <div class="cs-add"></div>
                    <div class="cs-prefs"></div>
                    <div class="cs-appkeys"></div>
                    <div class="cs-form-side"></div>
                    <div class="cs-host cpl-auth-host"></div>
                </div>
                <div class="cs-tasks"><div class="cs-tasks-head">Tasks</div><ul class="cs-tasks-list"></ul></div>
                <div class="cs-foot"></div>
            </div>`;
        document.body.appendChild(win);
        csWire();
        csRenderAdd();
    }

    function csClose() {
        if (csSecureWatch) void csSecureOff();
        csUnmarkForm();
        csForm = null;
        csPutBack();
        if (csObserver) { csObserver.disconnect(); csObserver = null; }
        if (csFormObserver) { csFormObserver.disconnect(); csFormObserver = null; }
        unmount();
        csSel = null;
        csPendingSection = null;
        csView = 'home';
    }

    /** Open Dreamscape CardSpace (from Control Panel, Melaton Defender, Security Center links). */
    async function openCardSpace(section) {
        if (typeof document === 'undefined') return false;
        if (!win) csBuild();
        const wasOpen = !win.classList.contains('hidden') && !!hostEl;
        // closed some other way (the taskbar's Close): let go of the old copy first
        if (!wasOpen && hostEl) csClose();
        if (section) csPendingSection = section;
        const show = () => {
            if (typeof root.openModal === 'function') root.openModal(win); else win.classList.remove('hidden');
            if (typeof root.bringModalToFront === 'function') root.bringModalToFront(win);
        };
        // to the secure desktop: cut to black, CardSpace opens under it, then the cut back
        if (!wasOpen && csSecurePref()) await secureDesktop.enter('cardspace', () => { show(); void csSecureOn(); });
        else show();
        if (!wasOpen) {
            csView = 'home';
            csSel = null;
            csRender();
            await mount(win);
            if (!hostEl) return true;
            if (csObserver) csObserver.disconnect();
            csObserver = new MutationObserver(csRefresh);
            csObserver.observe(hostEl, { childList: true, subtree: true });
            if (csFormObserver) csFormObserver.disconnect();
            csFormObserver = new MutationObserver((records) => {
                if (records.some((r) => r.target.id && CS_FORMS.includes(r.target.id))) csFormSync();
            });
            csFormObserver.observe(hostEl, { attributes: true, attributeFilter: ['class'], subtree: true });
            csRender();
        }
        if (section) csRender();
        return true;
    }

    // ---- the page ----

    async function mount(main) {
        hostEl = main.querySelector('.cpl-auth-host');
        if (!hostEl) return;
        if (localStorage.getItem('userType') !== 'admin') {
            hostEl.innerHTML = '<p class="cpl-auth-note">You need to be signed in as the Administrator to change credentials.</p>';
            return;
        }
        hostEl.innerHTML = '<p class="cpl-auth-note">Loading…</p>';
        const ready = await loadSecurityCenter();
        if (!hostEl || !hostEl.isConnected) return;
        /* global securityDsapBuildHtml, securityDsapDriver */
        if (!ready || typeof securityDsapBuildHtml !== 'function' || typeof securityDsapDriver === 'undefined') {
            hostEl.innerHTML = '<p class="cpl-auth-note">Credentials could not be loaded.</p>';
            return;
        }
        hostEl.innerHTML = securityDsapBuildHtml();
        const appRoot = hostEl.firstElementChild;
        // Security Center's own look is keyed on [data-dsap] and .dsap-smf (dsap-smf.css); here it is Vista's
        if (appRoot) {
            appRoot.removeAttribute('data-dsap');
            appRoot.classList.remove('dsap-smf', 'dsap-root');
        }
        driver = Object.create(securityDsapDriver);
        driver._state = null;
        driver._clickMenuTargets = [];
        driver.init(makeHost(hostEl));
        vault();
        mountCustomProviders();
        mountTextMessaging();
        mountMailAccounts();
    }

    function unmount() {
        observers.forEach((o) => o.disconnect());
        observers = [];
        if (driver) {
            try { driver.destroy(makeHost(hostEl)); } catch (_err) { /* the page is going away */ }
        }
        driver = null;
        customProviderRows = [];
        unmountTextMessaging();
        unmountMailAccounts();
        if (hostEl) hostEl.innerHTML = '';
        hostEl = null;
    }


    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerItem({
            id: 'authentication',
            name: 'Dreamscape CardSpace',
            image: '/static_images/vista-cpl/cardspace-32.png',
            description: 'The accounts and keys Dreamscape signs in with, and the keys programs use to reach it.',
            // as Windows CardSpace: Control Panel starts its own window
            open: () => { void openCardSpace(); }
        });
        // old links to the page ('nav', 'authentication') open the window and leave Control Panel where it was
        cpl.registerPage('authentication', {
            title: () => 'Dreamscape CardSpace',
            tasks: () => '',
            body: () => '<div class="cpl-auth-page"></div>',
            mount: () => {
                void openCardSpace();
                setTimeout(() => { if (typeof cpl.goBack === 'function') cpl.goBack(); }, 0);
            }
        });
        return true;
    }

    root.cplAuthentication = {
        register,
        open: (section) => { register(); void openCardSpace(section); return true; },
        VAULTS,
        _test: {
            vault: (el) => { hostEl = el; vault(); },
            directorGlance,
            resolveSelection,
            appKeyGlance,
            keyDotState
        }
    };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplAuthentication;
})(typeof window !== 'undefined' ? window : globalThis);
