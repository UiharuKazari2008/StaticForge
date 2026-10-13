/**
 * Control Panel's Authentication page (Yukimi 2026-10-13): Security Center's Authentication tab
 * moved into a Vista Control Panel page. The page runs its own copy of the Security Center driver
 * (securityCenterDsapApplet.js securityDsapDriver) on the applet's markup with only the
 * Authentication view showing: PIN Access Control, Director Accounts, Service Keys, Application
 * Keys (with pending requests and the request log) and Approved IPs. The Linksys styling stays in
 * Security Center; the page takes Vista's Control Panel look (melaton-network.css, .cpl-auth-host).
 *
 * Security Center loads on demand (dsapRegistry.js ensureDsapEntryReady), so the first mount
 * fetches it. Admins only, as in Security Center.
 */
(function (root) {
    'use strict';

    const SECURITY_URL = 'security.dreamscape.jp';
    const SECTIONS = [
        ['PIN Access Control', 'secAuthPinStatus'],
        ['Director Accounts', 'secCursorAccountsStatus'],
        ['Service Keys', 'secKeychainStatus'],
        ['Application Keys', 'secAppkeysStatus'],
        ['Approved IPs', 'secApprovedView']
    ];

    let driver = null;
    let hostEl = null;
    let registered = false;

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

    async function mount(main) {
        hostEl = main.querySelector('.cpl-auth-host');
        if (!hostEl) return;
        if (localStorage.getItem('userType') !== 'admin') {
            hostEl.innerHTML = '<p class="cpl-auth-note">You need to be signed in as an administrator to change authentication settings.</p>';
            return;
        }
        hostEl.innerHTML = '<p class="cpl-auth-note">Loading…</p>';
        const ready = await loadSecurityCenter();
        if (!hostEl || !hostEl.isConnected) return;
        /* global securityDsapBuildHtml, securityDsapDriver */
        if (!ready || typeof securityDsapBuildHtml !== 'function' || typeof securityDsapDriver === 'undefined') {
            hostEl.innerHTML = '<p class="cpl-auth-note">Authentication settings could not be loaded.</p>';
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
    }

    function unmount() {
        if (driver) {
            try { driver.destroy(makeHost(hostEl)); } catch (_err) { /* the page is going away */ }
        }
        driver = null;
        if (hostEl) hostEl.innerHTML = '';
        hostEl = null;
    }

    function scrollToSection(id) {
        const target = hostEl && hostEl.querySelector(`#${id}`);
        if (!target) return;
        const header = target.previousElementSibling && target.previousElementSibling.classList.contains('sec-dsap-section-hdr')
            ? target.previousElementSibling
            : target;
        header.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
            description: 'PINs, Director accounts, service keys, application keys and approved IPs.',
            open: () => cpl.open('authentication')
        });
        cpl.registerPage('authentication', {
            title: () => 'Authentication',
            tasks: () => `
                <div class="cpl-task-group">
                    <h3 class="cpl-task-heading">Tasks</h3>
                    <ul class="cpl-task-list">
                        ${SECTIONS.map(([label, id]) => `<li><button type="button" class="cpl-link" data-cpl-auth-section="${esc(id)}">${esc(label)}</button></li>`).join('')}
                    </ul>
                </div>
                <div class="cpl-task-group cpl-task-group--see-also">
                    <h3 class="cpl-task-heading">See also</h3>
                    <ul class="cpl-task-list">
                        <li><button type="button" class="cpl-link" data-cpl-auth-security="1">Security Center</button></li>
                        ${cpl.taskLinkHtml('Remote Access', 'nav', 'remote-access')}
                    </ul>
                </div>`,
            body: () => `
                <div class="cpl-auth-page">
                    <h1 class="cpl-page-title">Manage how people and programs sign in</h1>
                    <p class="cpl-intro">PINs for this server, Director's Cursor accounts, the keys Dreamscape uses for outside services, and the keys and addresses allowed to reach it.</p>
                    <div class="cpl-auth-host"></div>
                </div>`,
            mount: (main) => {
                const modal = main.closest('.modal');
                if (modal && !modal.dataset.cplAuthWired) {
                    modal.dataset.cplAuthWired = '1';
                    modal.addEventListener('click', (ev) => {
                        const section = ev.target.closest('[data-cpl-auth-section]');
                        if (section) {
                            scrollToSection(section.dataset.cplAuthSection);
                            return;
                        }
                        if (ev.target.closest('[data-cpl-auth-security]') && typeof root.openSecurityCenterDsap === 'function') {
                            root.openSecurityCenterDsap('home');
                        }
                    });
                }
                return mount(main);
            },
            unmount
        });
        return true;
    }

    root.cplAuthentication = { register, open: () => register() && root.melatonControlPanel.open('authentication') };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
})(typeof window !== 'undefined' ? window : globalThis);
