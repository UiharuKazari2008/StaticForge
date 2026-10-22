/**
 * Windows Defender (Yukimi 2026-10-13: "security center can then be converted into windows
 * defender and authorised ips can go into that panel"). Vista's Windows Defender window, 1:1 with
 * the VM's (MSASCui.exe; art from MsMpRes.dll in public/static_images/vista-defender/): the
 * blue-to-green client area (#4372a4 to #68b472), the toolbar on it (Defender's own orbs in the
 * travel band, Home, Scan, History, Tools, the logo right), "Protection against malicious and
 * unwanted software", and the white panel with the page.
 *
 *   Home              the status banner (green: nothing blocked today; yellow: clients blocked or
 *                     honeypot traps hit today) and the Status box
 *   Scan              runs the check again (blocked clients and honeypot hits)
 *   History           Security Center's telemetry
 *   Tools             Tools and Settings: Quarantined items (blocked clients), Allowed items (the
 *                     authorised / approved IPs), Honeypot traps; Settings: Dreamscape Services, User Accounts
 *
 * The list pages run Security Center's own driver (securityCenterDsapApplet.js
 * securityDsapDriver) on the applet markup with that view showing, so searching, paging,
 * unblocking and approving all work; the driver's links stay inside Defender. Admins only.
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-defender';
    const SECURITY_URL = 'security.dreamscape.jp';
    const PAGES = {
        quarantine: { view: 'blocked', icon: 'quarantine-32.png', title: 'Quarantined items', text: 'Melaton Defender keeps these clients from reaching Dreamscape until you unblock them.' },
        allowed: { view: 'auth', icon: 'allowed-32.png', title: 'Allowed items', text: 'These addresses are authorised to reach Dreamscape.' },
        honeypot: { view: 'honeypot', icon: 'explorer-32.png', title: 'Honeypot traps', text: 'Paths that only scanners ask for. A client that asks for one is blocked.' },
        history: { view: 'telemetry', icon: 'history-32.png', title: 'History', text: 'See all Melaton Defender activities: sign-ins, blocks and other security events.' }
    };
    const VIEW_TO_PAGE = { blocked: 'quarantine', honeypot: 'honeypot', telemetry: 'history', auth: 'allowed', home: 'home' };

    let modal = null;
    let page = 'home';
    const back = [];
    const forward = [];
    let driver = null;
    let secRoot = null;
    let homeData = null;
    let scanning = false;

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function el(sel) {
        return modal ? modal.querySelector(sel) : null;
    }

    function isAdmin() {
        try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; }
    }

    // ---- the window ----

    function toolButton(id, icon, label) {
        return `<button type="button" class="defender-tool" data-defender="${id}" title="${esc(label)}">`
            + `<img src="${ART}/${icon}.png" data-hot="${ART}/${icon}-hot.png" data-normal="${ART}/${icon}.png" alt="">`
            + (label ? `<span>${esc(label)}</span>` : '') + '</button>';
    }

    function ensureModal() {
        if (modal || typeof document === 'undefined') return modal;
        modal = document.createElement('div');
        modal.id = 'defenderModal';
        modal.className = 'modal hidden resizeable-window defender-window';
        modal.dataset.windowIdentifier = 'windowsDefender';
        modal.dataset.windowMinWidth = '640';
        modal.dataset.windowMinHeight = '460';
        modal.dataset.windowDefaultWidth = '860';
        modal.dataset.windowDefaultHeight = '640';
        modal.dataset.windowMaxWidth = '1600';
        modal.dataset.windowMaxHeight = '1100';
        modal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main">
                    <img src="${ART}/defender-16.png" alt="" class="icon-image">
                    <span>Melaton Defender</span>
                </div>
            </div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small defender-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content defender-content">
                <div class="defender-bar">
                    <div class="defender-travel">
                        <button type="button" class="defender-orb defender-back" data-defender="back" title="Back"></button>
                        <button type="button" class="defender-orb defender-forward" data-defender="forward" title="Forward"></button>
                    </div>
                    ${toolButton('home', 'home', 'Home')}
                    ${toolButton('scan', 'scan', 'Scan')}
                    <span class="defender-bar-sep" aria-hidden="true"></span>
                    ${toolButton('history', 'history', 'History')}
                    ${toolButton('tools', 'tools', 'Tools')}
                    <img class="defender-logo" src="${ART}/logo.png" alt="Melaton Defender">
                </div>
                <div class="defender-sub">Protection against malicious and unwanted software</div>
                <div class="defender-panel"></div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-defender]');
            if (!b || !modal.contains(b)) return;
            act(b.dataset.defender, b);
        });
        modal.querySelectorAll('.defender-tool img').forEach((img) => {
            const btn = img.closest('button');
            btn.addEventListener('pointerenter', () => { img.src = img.dataset.hot; });
            btn.addEventListener('pointerleave', () => { img.src = img.dataset.normal; });
        });
        el('.defender-close').addEventListener('click', close);
        return modal;
    }

    function open(target) {
        if (!ensureModal()) return false;
        const wasHidden = modal.classList.contains('hidden');
        if (wasHidden) {
            back.length = 0;
            forward.length = 0;
        }
        go(PAGES[target] || target === 'tools' || target === 'home' ? target : 'home', { replace: wasHidden });
        if (wasHidden && typeof root.openModal === 'function') root.openModal(modal);
        else modal.classList.remove('hidden');
        return true;
    }

    function close() {
        stopDriver();
        if (!modal) return;
        if (typeof root.closeModal === 'function') root.closeModal(modal);
        else modal.classList.add('hidden');
    }

    function go(next, { replace = false, fromHistory = false } = {}) {
        if (page && page !== next && !replace && !fromHistory) {
            back.push(page);
            forward.length = 0;
        }
        page = next;
        render();
    }

    function act(what) {
        if (what === 'back' && back.length) { forward.push(page); go(back.pop(), { fromHistory: true }); return; }
        if (what === 'forward' && forward.length) { back.push(page); go(forward.pop(), { fromHistory: true }); return; }
        if (what === 'home' || what === 'tools' || what === 'history') { go(what); return; }
        if (what === 'scan') { go('home'); scan(); return; }
        if (what === 'goto') return;
        if (PAGES[what]) { go(what); return; }
        if (what === 'authentication' && root.cplAuthentication) root.cplAuthentication.open();
        if (what === 'user-accounts' && root.cplUserAccounts) root.cplUserAccounts.open();
    }

    // ---- pages ----

    function render() {
        const panel = el('.defender-panel');
        if (!panel) return;
        modal.dataset.page = page;
        el('.defender-back').disabled = !back.length;
        el('.defender-forward').disabled = !forward.length;
        modal.querySelectorAll('.defender-tool').forEach((b) => b.classList.toggle('is-current', b.dataset.defender === page));
        stopDriver();
        if (!isAdmin()) {
            panel.innerHTML = '<div class="defender-page"><p class="defender-note">Melaton Defender needs the Administrator. Sign in as the Administrator to use it.</p></div>';
            return;
        }
        if (page === 'home') { panel.innerHTML = homeHtml(); if (!homeData) scan(); return; }
        if (page === 'tools') { panel.innerHTML = toolsHtml(); return; }
        listPage(panel, page);
    }

    function homeHtml() {
        const d = homeData;
        let banner;
        if (scanning || !d) {
            banner = { kind: 'scan', shield: null, title: 'Scanning…', body: 'Checking blocked clients and honeypot traps.' };
        } else if (d.error) {
            banner = { kind: 'warn', shield: 'shield-warning-32', title: 'Melaton Defender could not check Dreamscape', body: d.error };
        } else if (d.blockedToday || d.honeypotToday) {
            banner = {
                kind: 'warn', shield: 'shield-warning-32', title: 'Melaton Defender blocked clients today',
                body: `${d.blockedToday} ${d.blockedToday === 1 ? 'client was' : 'clients were'} blocked and ${d.honeypotToday} honeypot ${d.honeypotToday === 1 ? 'trap was' : 'traps were'} hit today.`,
                link: ['Review quarantined items', 'quarantine']
            };
        } else {
            banner = { kind: 'ok', shield: 'shield-ok-32', title: 'No unwanted or harmful activity detected.', body: 'Dreamscape is running normally.' };
        }
        const rows = d && !d.error ? [
            ['Last check:', d.checkedAt],
            ['Blocked clients:', `${d.blockedTotal} (${d.blockedToday} today)`],
            ['Honeypot traps:', `${d.pathsTotal} paths (${d.honeypotToday} hit today)`],
            ['Guest sign-in:', d.guest === null ? 'Unknown' : (d.guest ? 'On' : 'Off')],
            ['Real-time protection:', 'On']
        ] : [];
        return `
            <div class="defender-page defender-home">
                <div class="defender-banner defender-banner--${banner.kind}">
                    <div class="defender-banner-head">${banner.shield ? `<img src="${ART}/${banner.shield}.png" alt="">` : ''}<span>${esc(banner.title)}</span></div>
                    <div class="defender-banner-body">
                        <p>${esc(banner.body)}</p>
                        ${banner.kind === 'scan' ? '<div class="defender-progress marquee" role="progressbar" aria-label="Scanning"></div>' : ''}
                        ${banner.link ? `<button type="button" class="defender-link" data-defender="${banner.link[1]}">${esc(banner.link[0])}</button>` : ''}
                    </div>
                </div>
                <div class="defender-status">
                    <h2>Status</h2>
                    <table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
                </div>
            </div>`;
    }

    function toolItem(id, icon, title, text) {
        return `<div class="defender-item"><img src="${ART}/${icon}" alt=""><div><button type="button" class="defender-link" data-defender="${id}">${esc(title)}</button><p>${esc(text)}</p></div></div>`;
    }

    function toolsHtml() {
        return `
            <div class="defender-page defender-tools">
                <h1>Tools and Settings</h1>
                <div class="defender-group"><span>Settings</span></div>
                <div class="defender-items">
                    ${toolItem('authentication', 'cardspace-48.png', 'Dreamscape Services', 'The accounts and keys Dreamscape signs in with, and the keys programs use to reach it')}
                    ${toolItem('user-accounts', 'users-48.png', 'User Accounts', 'Change the Administrator and Guest passwords and pictures, and turn the guest account on or off')}
                </div>
                <div class="defender-group"><span>Tools</span></div>
                <div class="defender-items">
                    ${toolItem('quarantine', 'quarantine-48.png', 'Quarantined items', 'Unblock or remove clients that Melaton Defender has kept from reaching Dreamscape')}
                    ${toolItem('honeypot', 'explorer-48.png', 'Honeypot traps', 'View the paths that only scanners ask for, and the clients that asked')}
                    ${toolItem('allowed', 'allowed-48.png', 'Allowed items', 'View and change the addresses authorised to reach Dreamscape')}
                </div>
            </div>`;
    }

    // ---- the list pages: Security Center's driver on its own view ----

    async function loadSecurityCenter() {
        if (typeof root.securityDsapBuildHtml === 'function') return true;
        if (typeof resolveDsap !== 'function' || typeof ensureDsapEntryReady !== 'function') return false;
        const match = resolveDsap(SECURITY_URL);
        return match ? ensureDsapEntryReady(match.entry) : false;
    }

    function parseUrl(url) {
        try {
            const u = new URL(`http://${String(url).replace(/^dsap:\/\//, '')}`);
            const query = {};
            u.searchParams.forEach((v, k) => { query[k] = v; });
            const view = u.pathname.split('/').filter(Boolean)[0] || 'home';
            return { view, query };
        } catch (_err) {
            return { view: 'home', query: {} };
        }
    }

    function makeHost(view, query) {
        return {
            defender: true,
            cplAuthentication: view === 'auth',
            getRoot: () => secRoot,
            getPathSegments: () => [view],
            getQueryParam: (k) => (query && query[k] != null ? query[k] : null),
            // the driver's pagers, searches and tabs stay inside Defender
            navigate: (url) => {
                const next = parseUrl(url);
                const target = VIEW_TO_PAGE[securityDsapNormalizeView(next.view)] || 'home';
                if (target !== page) {
                    go(target);
                    return;
                }
                startDriver(PAGES[page].view, next.query);
            },
            registerContextMenuAction: () => {},
            registerContextMenuItems: () => {}
        };
    }

    function stopDriver() {
        if (driver) {
            try { driver.destroy(makeHost('home', {})); } catch (_err) { /* going away */ }
        }
        driver = null;
    }

    function startDriver(view, query) {
        stopDriver();
        /* global securityDsapDriver */
        driver = Object.create(securityDsapDriver);
        driver._state = null;
        driver._clickMenuTargets = [];
        driver.init(makeHost(view, query || {}));
    }

    async function listPage(panel, id) {
        const p = PAGES[id];
        panel.innerHTML = `
            <div class="defender-page defender-list defender-list--${id}">
                <div class="defender-page-head"><img src="${ART}/${p.icon}" alt=""><div><h1>${esc(p.title)}</h1><p>${esc(p.text)}</p></div></div>
                <div class="defender-sec"><p class="defender-note">Loading…</p></div>
            </div>`;
        const ready = await loadSecurityCenter();
        const host = panel.querySelector('.defender-sec');
        if (!host || !host.isConnected || page !== id) return;
        /* global securityDsapBuildHtml, securityDsapNormalizeView */
        if (!ready || typeof securityDsapBuildHtml !== 'function' || typeof securityDsapDriver === 'undefined') {
            host.innerHTML = '<p class="defender-note">Melaton Defender could not load this list.</p>';
            return;
        }
        host.innerHTML = securityDsapBuildHtml();
        secRoot = host;
        const appRoot = host.firstElementChild;
        if (appRoot) {
            appRoot.removeAttribute('data-dsap');
            appRoot.classList.remove('dsap-smf', 'dsap-root');
        }
        startDriver(p.view, {});
    }

    // ---- Home's check ----

    async function scan() {
        const ws = root.wsClient;
        if (!ws || scanning) return;
        scanning = true;
        if (page === 'home') render();
        try {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const today = start.getTime();
            const [blocked, paths, pins] = await Promise.all([
                ws.getBlockedIPs(1, 1000),
                ws.getKnownBadPaths(1, 1000, ''),
                ws.getPinSettings().catch(() => null)
            ]);
            const list = blocked && blocked.success ? blocked.blockedIPs || [] : [];
            const pathList = paths && paths.success ? paths.paths || [] : [];
            homeData = {
                blockedTotal: (blocked && blocked.total) || list.length,
                blockedToday: list.filter((e) => e.blockedAt >= today).length,
                pathsTotal: (paths && paths.total) || pathList.length,
                honeypotToday: pathList.filter((e) => (e.firstSeen || e.lastSeen || 0) >= today).length,
                guest: pins && pins.success ? pins.userPinLoginEnabled !== false : null,
                checkedAt: `Today at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            };
        } catch (err) {
            homeData = { error: (err && err.message) || 'The server did not answer.' };
        } finally {
            scanning = false;
            if (page === 'home') render();
        }
    }

    root.windowsDefender = { open, close, PAGES, VIEW_TO_PAGE, _test: { homeHtml: (d) => { homeData = d; scanning = false; return homeHtml(); }, toolsHtml } };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.windowsDefender;

    // Control Panel's item
    function registerItem() {
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerItem !== 'function') return;
        cpl.registerItem({
            id: 'windows-defender',
            name: 'Melaton Defender',
            image: `${ART}/defender-32.png`,
            description: 'Blocked clients, honeypot traps, allowed addresses and security history.',
            open: () => open('home')
        });
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerItem);
        else registerItem();
    }
})(typeof window !== 'undefined' ? window : globalThis);
