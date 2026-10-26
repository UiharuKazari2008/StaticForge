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
                const key = `${spec.body}:${cells[0].textContent.trim() || index}`;
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
            const logoInput = document.createElement('input');
            logoInput.type = 'file';
            logoInput.className = 'cpl-ua-input';
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
            const logoClear = document.createElement('button');
            logoClear.type = 'button';
            logoClear.className = 'cpl-vault-link';
            logoClear.textContent = 'Remove picture';
            logoClear.addEventListener('click', () => {
                row._logoData = '';
                row._logoClear = true;
                logoPreview.removeAttribute('src');
                logoPreview.style.display = 'none';
                logoInput.value = '';
            });
            const logoWrap = document.createElement('div');
            logoWrap.append(logoPreview, logoInput, logoClear);
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
    const CARD_KINDS = {
        director: ['Director accounts', 'Director Account'],
        service: ['Service keys', 'Service Key'],
        application: ['Application keys', 'Application Key'],
        'custom-models': ['Custom model providers', 'Custom Model Provider']
    };
    let win = null;
    let csView = 'home';
    let csSel = null;
    let csMoved = null;
    let csTimer = 0;
    let csObserver = null;

    function csEl(sel) {
        return win ? win.querySelector(sel) : null;
    }

    /** The section a vault row belongs to (its list's head, or the custom providers' list). */
    function csKindOf(row) {
        const list = row.closest('.cpl-vault-list');
        if (!list) return 'director';
        if (list.id === 'cplCustomProviderList') return 'custom-models';
        const body = list.dataset.cplVaultFor || '';
        if (/Cursor/.test(body)) return 'director';
        if (/Keychain/.test(body)) return 'service';
        return 'application';
    }

    function csRows() {
        return hostEl ? [...hostEl.querySelectorAll('.cpl-vault-row[data-cpl-vault-key]')] : [];
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
        const holder = (csMoved && csMoved.row === row) ? csMoved.actions : row.querySelector('.cpl-vault-actions');
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
    const DIRECTOR = '/static_images/app_icons/director.png';
    const SERVICE_LOGOS = [
        [/^novelai$/i, '/static_images/novelai-round.png'],
        [/^grok\b|xai/i, XAI],
        [/^google$/i, '/static_images/vista-gadgets/flowerpot/images/google.png'],
        [/^tokenrouter$/i, '/dist/custom-icons/tokenrouter-icon.svg']
    ];
    // an application key's app, from its name and its client (user agent)
    const APP_LOGOS = [
        [/^cursor\b|\bcursor\//i, '/dist/custom-icons/cursor-icon.svg'],
        [/claude/i, '/dist/custom-icons/claude-icon.svg'],
        [/DreamscapeDirector/i, DIRECTOR],
        [/DreamscapeDedicatedAgentClient/i, '/static_images/icon.png'],
        [/^grok$/i, XAI]
    ];

    function csLogo(row) {
        if (row.dataset.cplCardPicture) return row.dataset.cplCardPicture;
        const kind = csKindOf(row);
        const name = csName(row);
        const sub = (row.querySelector('.cpl-vault-sub') || {}).textContent || '';
        if (kind === 'director') return DIRECTOR;
        const hit = (list, text) => (list.find(([re]) => re.test(text)) || [])[1] || '';
        if (kind === 'service') return hit(SERVICE_LOGOS, name);
        if (kind === 'application') return hit(APP_LOGOS, name) || hit(APP_LOGOS, sub);
        return '';
    }

    /** A card: the picture in its dark frame, the name under it (the VM's 130 x 106 cell). */
    function csCard(row, extra) {
        const logo = csLogo(row);
        const picture = logo || `${CS}/personal-card.png`;
        const dot = row.querySelector('.cpl-vault-status');
        const tip = (row.querySelector('.cpl-vault-sub') || {}).textContent || '';
        return `<button type="button" class="cs-card${extra || ''}" data-cs-key="${esc(row.dataset.cplVaultKey)}" title="${esc(tip)}">
            <span class="cs-card-pic${logo ? ' is-logo' : ''}"><img src="${esc(picture)}" alt="" draggable="false"></span>
            <span class="cs-card-name">${esc(csName(row))}</span>${dot ? `<span class="cs-card-dots">${dot.innerHTML}</span>` : ''}</button>`;
    }

    /** A group per kind of card (as CardSpace's "Your cards:" group), Add a card in its own group after them. */
    function csRenderHome() {
        const groups = Object.keys(CARD_KINDS).map((kind) => {
            const rows = csRows().filter((r) => csKindOf(r) === kind);
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
        const del = row && csFind(row, /delete|revoke|deny/i);
        const has = (id) => !!(hostEl && hostEl.querySelector(`#${id}`));
        list.innerHTML = csTask('Duplicate card', '', false) + csTask('Delete card', 'data-cs-task="delete"', !!del)
            + '<li class="cs-sep"></li>'
            + csTask('Add a card', 'data-cs-go="add"')
            + csTask('Save key changes', 'data-cs-click="secKeychainSave"', has('secKeychainSave'))
            + csTask('View the request log', 'data-cs-click="secAppkeysLogBtn"', has('secAppkeysLogBtn'))
            + csTask('Preferences', 'data-cs-task="preferences"')
            + '<li class="cs-sep"></li>'
            + csTask('Delete all cards', '', false)
            + '<li class="cs-sep"></li>'
            + csTask('Help', 'data-cs-task="help"');
    }

    function csRenderFoot() {
        const foot = csEl('.cs-foot');
        if (csView === 'home') {
            foot.innerHTML = `<button type="button" class="tbp-button cs-foot-btn" data-dialog-primary="1" data-cs-go="details"${csSel && csRow(csSel) ? '' : ' disabled'}>Preview</button>`;
        } else if (csView === 'details') {
            const row = csSel && csRow(csSel);
            const save = row && csFind(row, /^\s*save\s*$/i);
            const edit = row && csFind(row, /edit/i);
            foot.innerHTML = save
                ? '<button type="button" class="tbp-button cs-foot-btn cs-foot-save" data-dialog-primary="1" data-cs-task="save">Save</button><button type="button" class="tbp-button cs-foot-btn" data-cs-go="home">Cancel</button>'
                : (edit ? '<button type="button" class="tbp-button cs-foot-btn" data-dialog-primary="1" data-cs-task="edit">Edit</button>' : '');
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
            const actions = details && details.querySelector('.cpl-vault-actions');
            csMoved = { row, details, actions };
        }
        const kind = csKindOf(row);
        pane.innerHTML = `<div class="cs-details-card">${csCard(row, ' is-details')}<div class="cs-details-kind">${esc(CARD_KINDS[kind][1])}</div></div>
            <div class="cs-details-info"><div class="cs-group-label"><span>Information in this card:</span></div><div class="cs-details-fields"></div></div>`;
        if (csMoved.details) pane.querySelector('.cs-details-fields').appendChild(csMoved.details);
    }

    const CS_TEXT = {
        home: ['Select a card to preview', 'To see or edit card data before you send it, select a card, and then click Preview. To create a new card, click Add a card.'],
        details: ['Card Details', 'This card is kept on the Dreamscape server. To change the card data, use the tasks on the right or click Edit.'],
        add: ['Add a card', 'Select the type of card you want to add.']
    };

    function csRender() {
        if (!win) return;
        win.dataset.csView = csView;
        csEl('.cs-title').textContent = CS_TEXT[csView][0];
        csEl('.cs-desc').textContent = CS_TEXT[csView][1];
        csEl('.cs-back').disabled = csView === 'home';
        if (csView === 'home') { csPutBack(); csRenderHome(); }
        if (csView === 'details') csRenderDetails();
        csRenderTasks();
        csRenderFoot();
    }

    function csGo(next) {
        if (next === 'details' && !(csSel && csRow(csSel))) return;
        if (next !== 'details') csPutBack();
        csView = next;
        csRender();
    }

    /** The vault changed under the window (the driver re-rendered, a provider was saved). */
    function csRefresh() {
        if (!win || csTimer) return;
        csTimer = setTimeout(() => {
            csTimer = 0;
            if (csView === 'details') {
                const row = csSel && csRow(csSel);
                if (!row) { csGo('home'); return; }
                if (csMoved && csMoved.row === row && row.isConnected) { csRenderTasks(); csRenderFoot(); return; }
            }
            csRender();
        }, 0);
    }

    /** Add a card's entries: the vault's own add buttons. */
    const CS_ADD = [
        ['secCursorAccountsAddBtn', 'Add a Director account', 'Director accounts are the Cursor profiles the Director runs Wren and Xi on. Add one to sign in with another profile or to share the work between two.'],
        ['secAppkeysCreateBtn', 'Create an application key', 'Application keys let programs reach Dreamscape on your behalf. Each key has its own name and can be revoked at any time.'],
        ['custom-provider', 'Add a custom model provider', 'Custom model providers give the Director another model host: its address, its key and the model it uses by default.']
    ];

    function csRenderAdd() {
        csEl('.cs-add').innerHTML = CS_ADD.map(([id, title, text]) => `<button type="button" class="cs-add-item" data-cs-add="${esc(id)}">
            <img src="${CS}/arrow.png" alt="" class="cs-add-arrow"><span class="cs-add-title">${esc(title)}</span><span class="cs-add-text">${esc(text)}</span></button>`).join('');
    }

    function csAdd(id) {
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
            const card = t.closest('.cs-card[data-cs-key]');
            if (card && csView === 'home') {
                csSel = card.dataset.csKey;
                win.querySelectorAll('.cs-home .cs-card.is-selected').forEach((c) => c.classList.remove('is-selected'));
                card.classList.add('is-selected');
                csRenderTasks();
                csRenderFoot();
                return;
            }
            const go = t.closest('[data-cs-go]');
            if (go && !go.disabled) { csGo(go.dataset.csGo); return; }
            if (t.closest('.cs-back')) { csGo('home'); return; }
            const add = t.closest('[data-cs-add]');
            if (add) { csAdd(add.dataset.csAdd); return; }
            const click = t.closest('[data-cs-click]');
            if (click && !click.disabled) { const b = hostEl.querySelector(`#${click.dataset.csClick}`); if (b) b.click(); return; }
            const task = t.closest('[data-cs-task]');
            if (task && !task.disabled) {
                const row = csSel && csRow(csSel);
                const which = task.dataset.csTask;
                if (which === 'help') { if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('cardspace'); return; }
                if (which === 'preferences') { if (typeof openDsapInGrimoire === 'function') openDsapInGrimoire(`dsap://${SECURITY_URL}/`); return; }
                const btn = row && (which === 'delete' ? csFind(row, /delete|revoke|deny/i) : which === 'save' ? csFind(row, /^\s*save\s*$/i) : csFind(row, /edit/i));
                if (btn) btn.click();
            }
        });
        win.addEventListener('dblclick', (ev) => {
            const card = ev.target.closest('.cs-home .cs-card[data-cs-key]');
            if (card) { csSel = card.dataset.csKey; csGo('details'); }
        });
        win.querySelector('.cs-close').addEventListener('click', () => {
            if (typeof root.closeModal === 'function') root.closeModal(win);
            csClose();
        });
    }

    function csBuild() {
        win = document.createElement('div');
        win.id = 'dreamscapeCardSpaceModal';
        win.className = 'modal hidden resizeable-window cs-window';
        win.dataset.windowIdentifier = 'dreamscapeCardSpace';
        win.dataset.windowClient = 'light';
        win.dataset.windowDefaultWidth = '756';
        win.dataset.windowDefaultHeight = '550';
        win.dataset.windowMinWidth = '640';
        win.dataset.windowMinHeight = '420';
        win.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${CS}/cardspace-16.png" alt=""><span>Dreamscape CardSpace</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
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
        csPutBack();
        if (csObserver) { csObserver.disconnect(); csObserver = null; }
        unmount();
        csSel = null;
        csView = 'home';
    }

    /** Open Dreamscape CardSpace (from Control Panel, Melaton Defender, Security Center links). */
    async function openCardSpace(section) {
        if (typeof document === 'undefined') return false;
        if (!win) csBuild();
        const wasOpen = !win.classList.contains('hidden') && !!hostEl;
        // closed some other way (the taskbar's Close): let go of the old copy first
        if (!wasOpen && hostEl) csClose();
        if (typeof root.openModal === 'function') root.openModal(win); else win.classList.remove('hidden');
        if (typeof root.bringModalToFront === 'function') root.bringModalToFront(win);
        if (!wasOpen) {
            csView = 'home';
            csSel = null;
            csRender();
            await mount(win);
            if (!hostEl) return true;
            if (csObserver) csObserver.disconnect();
            csObserver = new MutationObserver(csRefresh);
            csObserver.observe(hostEl, { childList: true, subtree: true });
            csRender();
        }
        if (section) {
            const first = csRows().find((r) => csKindOf(r) === section);
            if (first) { csSel = first.dataset.cplVaultKey; csRender(); }
        }
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
    }

    function unmount() {
        observers.forEach((o) => o.disconnect());
        observers = [];
        if (driver) {
            try { driver.destroy(makeHost(hostEl)); } catch (_err) { /* the page is going away */ }
        }
        driver = null;
        customProviderRows = [];
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
