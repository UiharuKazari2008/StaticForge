/**
 * Control Panel's Authentication page (Yukimi 2026-10-13), laid out like Credential Manager's
 * vault: sections with a header strip (icon, title, "Add …" link on the right), each credential
 * a row (icon, name, a summary, a chevron) that opens into its details and actions.
 *
 *   Director Accounts   Cursor profiles for Wren and Xi (Add a Director account)
 *   Service Keys        the keys Dreamscape uses for outside services (Save changes)
 *   Application Keys    keys programs use to reach Dreamscape, requests waiting for approval,
 *                       the request log (Create an application key, View the request log)
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
                // "Active for Wren and Xi": a persona's cell shows Active (no Activate button) for the profile in use
                summary: (cells) => {
                    const on = [[1, 'Wren'], [2, 'Xi']].filter(([i]) => cells[i] && !cells[i].querySelector('button') && /active/i.test(cells[i].textContent)).map(([, n]) => n);
                    return on.length ? `Active for ${on.join(' and ')}` : '';
                },
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
        const all = cell.textContent.trim().replace(/\s+/g, ' ');
        // "Name<br><span class=hint>description</span>" (service and application keys)
        const hint = cell.querySelector('.sec-dsap-setting-hint');
        if (hint) {
            const sub = hint.textContent.trim().replace(/\s+/g, ' ');
            // the hint follows the name: take it off the end (the name may contain the same text)
            const name = (all.endsWith(sub) ? all.slice(0, all.length - sub.length) : all.replace(sub, '')).trim();
            return { name: name || all, sub: name ? sub : '' };
        }
        const lead = cell.querySelector('strong, b') || [...cell.children].find((el) => el.textContent.trim().length > 1);
        const name = lead ? lead.textContent.trim().replace(/\s+/g, ' ') : all;
        let sub = all;
        const at = sub.indexOf(name);
        if (at >= 0) sub = (sub.slice(0, at) + sub.slice(at + name.length)).trim();
        // a one-letter badge before the name (Director's profile initial) is not a subtitle
        sub = sub.replace(/^\S\s+/, '').trim();
        return { name: name || all, sub: sub === name ? '' : sub };
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

        const build = () => {
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
                line.append(name, summary, chevron);
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
    }

    function unmount() {
        observers.forEach((o) => o.disconnect());
        observers = [];
        if (driver) {
            try { driver.destroy(makeHost(hostEl)); } catch (_err) { /* the page is going away */ }
        }
        driver = null;
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
            name: 'Authentication',
            image: '/static_images/vista-cpl/key-32.png',
            description: 'The accounts and keys Dreamscape signs in with, and the keys programs use to reach it.',
            open: () => cpl.open('authentication')
        });
        cpl.registerPage('authentication', {
            title: () => 'Authentication',
            tasks: () => `
                <div class="cpl-task-group">
                    <h3 class="cpl-task-heading">Tasks</h3>
                    <ul class="cpl-task-list">
                        ${VAULTS.map((v) => `<li><button type="button" class="cpl-link" data-cpl-auth-section="${esc(v.id)}">${esc(v.title)}</button></li>`).join('')}
                    </ul>
                </div>
                <div class="cpl-task-group cpl-task-group--see-also">
                    <h3 class="cpl-task-heading">See also</h3>
                    <ul class="cpl-task-list">
                        ${cpl.taskLinkHtml('User Accounts', 'nav', 'user-accounts')}
                        ${cpl.taskLinkHtml('Windows Defender', 'nav', 'defender')}
                    </ul>
                </div>`,
            body: () => `
                <div class="cpl-auth-page">
                    <h1 class="cpl-page-title">Store credentials for Dreamscape</h1>
                    <p class="cpl-intro">Use Authentication to keep the accounts and keys Dreamscape signs in with, and the keys programs use to reach it.</p>
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

    root.cplAuthentication = { register, open: () => register() && root.melatonControlPanel.open('authentication'), VAULTS, _test: { vault: (el) => { hostEl = el; vault(); } } };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplAuthentication;
})(typeof window !== 'undefined' ? window : globalThis);
