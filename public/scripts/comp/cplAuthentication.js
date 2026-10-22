/**
 * Control Panel's Dreamscape Services page (Yukimi 2026-10-13), laid out like Credential Manager's
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
            summary.textContent = bits.join(' · ');
            const chevron = document.createElement('span');
            chevron.className = 'cpl-vault-chevron';
            line.append(name, summary, chevron);
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
            // Same hosts as PRESETS in modules/customModelProviders.js.
            [
                ['', 'Custom'],
                ['google', 'Google'],
                ['openai', 'OpenAI'],
                ['tokenrouter', 'TokenRouter'],
                ['openrouter', 'OpenRouter']
            ].forEach(([id, label]) => {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = label;
                preset.appendChild(option);
            });
            const presetHosts = {
                google: ['google', 'Google', 'https://generativelanguage.googleapis.com/v1beta/openai'],
                openai: ['openai', 'OpenAI', 'https://api.openai.com'],
                tokenrouter: ['tokenrouter', 'TokenRouter', 'https://api.tokenrouter.com'],
                openrouter: ['openrouter', 'OpenRouter', 'https://openrouter.ai/api']
            };
            if (presetHosts[row.kind]) preset.value = row.kind;
            preset.addEventListener('change', () => {
                const fill = presetHosts[preset.value];
                if (!fill) return;
                if (!idInput.readOnly) idInput.value = fill[0];
                nameInput.value = fill[1];
                urlInput.value = fill[2];
                syncManagement();
            });
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
                    if (typeof showGlassToast === 'function') showGlassToast('error', 'Dreamscape Services', 'That file is not a picture');
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
                managementField,
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
                    paintCustomProviders();
                } catch (err) {
                    save.disabled = false;
                    if (typeof showGlassToast === 'function') showGlassToast('error', 'Dreamscape Services', err.message || 'Could not save the provider');
                }
            });
            actions.appendChild(save);
            details.appendChild(actions);
            block.append(line, details);
            list.appendChild(block);
        });
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
            customProviderRows.forEach((row) => { row._open = openIds.has(row.id); });
            paintCustomProviders();
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

    function scrollToSection(id) {
        const target = hostEl && hostEl.querySelector(`#cplVault-${id}`);
        if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerItem({
            id: 'authentication',
            name: 'Dreamscape Services',
            image: '/static_images/vista-cpl/cardspace-32.png',
            description: 'The accounts and keys Dreamscape signs in with, and the keys programs use to reach it.',
            open: () => cpl.open('authentication')
        });
        cpl.registerPage('authentication', {
            title: () => 'Dreamscape Services',
            tasks: () => `
                <div class="cpl-task-group">
                    <h3 class="cpl-task-heading">Tasks</h3>
                    <ul class="cpl-task-list">
                        ${VAULTS.map((v) => `<li><button type="button" class="cpl-link" data-cpl-auth-section="${esc(v.id)}">${esc(v.title)}</button></li>`).join('')}
                        <li><button type="button" class="cpl-link" data-cpl-auth-section="custom-models">Custom Model Providers (Director)</button></li>
                    </ul>
                </div>
                <div class="cpl-task-group cpl-task-group--see-also">
                    <h3 class="cpl-task-heading">See also</h3>
                    <ul class="cpl-task-list">
                        ${cpl.taskLinkHtml('User Accounts', 'nav', 'user-accounts')}
                        ${cpl.taskLinkHtml('Melaton Defender', 'item', 'windows-defender')}
                    </ul>
                </div>`,
            body: () => `
                <div class="cpl-auth-page">
                    <h1 class="cpl-page-title">Store credentials for Dreamscape</h1>
                    <p class="cpl-intro">Use Dreamscape Services to keep the accounts and keys Dreamscape signs in with, and the keys programs use to reach it.</p>
                    <div class="cpl-auth-host"></div>
                </div>`,
            mount: (main) => {
                const modal = main.closest('.modal');
                if (modal && !modal.dataset.cplAuthWired) {
                    modal.dataset.cplAuthWired = '1';
                    modal.addEventListener('click', (ev) => {
                        const section = ev.target.closest('[data-cpl-auth-section]');
                        if (section) scrollToSection(section.dataset.cplAuthSection);
                    });
                }
                return mount(main);
            },
            unmount
        });
        return true;
    }

    root.cplAuthentication = {
        register,
        open: () => register() && root.melatonControlPanel.open('authentication'),
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
