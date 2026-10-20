/**
 * Exchange Server DSAP — exchange.dreamscape.jp
 * Hosted in Grimoire. Same SMF chrome as Data Management (data.dreamscape.jp).
 *
 * Shared CSS / classes (loaded the same way Data Management loads them):
 *   css/dsap-smf.css via theme: 'dsap-smf'  (also in app.html)
 *   dsap-root dsap-smf
 *   dsap-smf-header / dsap-smf-header-branch / dsap-smf-header-tool
 *   dsap-smf-tabbar / dsap-smf-tab / dsap-smf-tab-active
 *   dsap-smf-toolbar / dsap-smf-btn / dsap-smf-btn-primary / dsap-smf-btn-small / dsap-smf-btn-danger
 *   dsap-smf-section-hdr
 *   dsap-smf-statusbox / dsap-smf-status-message / dsap-smf-status-error / dsap-smf-status-ok
 *   dsap-smf-input
 *   data-mgmt-ws-table  (shared data-table in dsap-smf.css)
 *   data-mgmt-account-info-table / -label / -value  (Data Management property list)
 *   form-row / form-group  (manual-modal.css + app.css, already in Grimoire)
 *
 * UI + WS/MCP: public/scripts/comp/desktop-apps/exchange.js
 * Depends on: dsapRegistry.js, dsapSmfMarkup.js
 */

const EXCHANGE_DSAP_URL = 'exchange.dreamscape.jp';
const EXCHANGE_DSAP_TABS = [
    { id: 'overview', label: 'Overview', icon: 'fas fa-heart-pulse' },
    { id: 'mailboxes', label: 'Mailboxes', icon: 'fas fa-inbox' },
    { id: 'aliases', label: 'Aliases', icon: 'fas fa-sitemap' },
    { id: 'toggles', label: 'Toggles', icon: 'fas fa-toggle-on' },
    { id: 'signatures', label: 'Signatures', icon: 'fas fa-pen-nib' },
    { id: 'relay', label: 'Relay', icon: 'fas fa-tower-broadcast' },
    { id: 'spam', label: 'Spam', icon: 'fas fa-ban' }
];
const EXCHANGE_DSAP_TAB_IDS = new Set(EXCHANGE_DSAP_TABS.map((tab) => tab.id));
const EXCHANGE_DSAP_ALIASES = {
    status: 'overview',
    lists: 'aliases'
};
const EXCHANGE_DSAP_TAB_LABELS = Object.fromEntries(
    EXCHANGE_DSAP_TABS.map((tab) => [tab.id, tab.label])
);

function exchangeDsapResolveActiveTab(host) {
    const queryTab = host && host.getQueryParam ? host.getQueryParam('tab') : null;
    if (queryTab && EXCHANGE_DSAP_TAB_IDS.has(queryTab)) return queryTab;
    if (queryTab && EXCHANGE_DSAP_ALIASES[queryTab]) return EXCHANGE_DSAP_ALIASES[queryTab];
    const segments = host && host.getPathSegments ? host.getPathSegments() : [];
    const first = segments[0] || 'overview';
    if (EXCHANGE_DSAP_TAB_IDS.has(first)) return first;
    if (EXCHANGE_DSAP_ALIASES[first]) return EXCHANGE_DSAP_ALIASES[first];
    return 'overview';
}

function exchangeDsapBuildTabUrl(tabId) {
    if (!tabId || tabId === 'overview') return `dsap://${EXCHANGE_DSAP_URL}/`;
    return `dsap://${EXCHANGE_DSAP_URL}/${tabId}`;
}

function exchangeDsapHostStub(match) {
    return {
        getPathSegments() {
            const norm = typeof normalizeDsapUrlInput === 'function'
                ? normalizeDsapUrlInput(match.canonicalUrl)
                : match.canonicalUrl;
            const base = EXCHANGE_DSAP_URL;
            if (!norm.startsWith(base)) return [];
            const rest = norm.slice(base.length).replace(/^\//, '');
            const pathOnly = rest.split('?')[0];
            return pathOnly ? pathOnly.split('/').filter(Boolean) : [];
        },
        getQueryParam(name) {
            const raw = match && match.canonicalUrl ? String(match.canonicalUrl) : '';
            const qIdx = raw.indexOf('?');
            if (qIdx < 0) return null;
            try {
                return new URLSearchParams(raw.slice(qIdx + 1)).get(name);
            } catch (e) {
                return null;
            }
        }
    };
}

function exchangeDsapBuildTabBar(activeTabId) {
    // dsapSmfBuildTabBar: public/scripts/comp/dsapSmfMarkup.js
    return dsapSmfBuildTabBar(EXCHANGE_DSAP_TABS, activeTabId, {
        tabBarId: 'exchangeTabBar',
        dataAttr: 'data-exchange-tab'
    });
}

function exchangeDsapBuildShellHtml(activeTabId) {
    const tabId = activeTabId || 'overview';
    const branchTitle = typeof DSAP_SMF_BRANCH_EXCHANGE !== 'undefined'
        ? DSAP_SMF_BRANCH_EXCHANGE
        : 'Exchange Server';
    // dsapSmfBuildRootOpen / Header / Toolbar / StatusBox / RootClose: public/scripts/comp/dsapSmfMarkup.js
    return `${dsapSmfBuildRootOpen('exchange')}
${dsapSmfBuildHeader({
    branchTitle: branchTitle,
    toolTitle: EXCHANGE_DSAP_TAB_LABELS[tabId] || 'Overview'
})}
${exchangeDsapBuildTabBar(tabId)}
${dsapSmfBuildToolbar(
    `<button type="button" class="dsap-smf-btn dsap-smf-btn-small" id="exchangeRefreshBtn"><i class="fas fa-rotate-right"></i> Refresh</button>`,
    'exchangeCommandSet'
)}
<div class="exchange-view" id="exchangeMain"></div>
${dsapSmfBuildStatusBox('Ready', 'exchangeStatusBox', 'exchangeStatus')}
${dsapSmfBuildRootClose()}`;
}

const exchangeDsapDriver = {
    _host: null,

    init(host) {
        this._host = host;
        const root = host.getRoot();
        const activeTab = exchangeDsapResolveActiveTab(host);
        desktopExchange.section = activeTab;

        // dsapSmfWireTabBar / dsapSmfSetActiveTab / dsapSmfUpdateHeaderTool: public/scripts/comp/dsapSmfMarkup.js
        dsapSmfWireTabBar(root, '#exchangeTabBar', 'data-exchange-tab', exchangeDsapBuildTabUrl, host);
        dsapSmfSetActiveTab(root, 'data-exchange-tab', activeTab);
        dsapSmfUpdateHeaderTool(root, EXCHANGE_DSAP_TAB_LABELS[activeTab] || 'Overview');

        const toolbar = root.querySelector('#exchangeCommandSet');
        const refreshBtn = root.querySelector('#exchangeRefreshBtn');
        if (refreshBtn && refreshBtn.dataset.exchangeWired !== '1') {
            refreshBtn.dataset.exchangeWired = '1';
            refreshBtn.addEventListener('click', () => {
                // exchangeLoadSection: public/scripts/comp/desktop-apps/exchange.js
                exchangeLoadSection();
            });
        }

        // exchangeBindHost / exchangeLoadSection: public/scripts/comp/desktop-apps/exchange.js
        exchangeBindHost({
            root: root,
            main: root.querySelector('#exchangeMain'),
            status: root.querySelector('#exchangeStatus'),
            statusBox: root.querySelector('#exchangeStatusBox'),
            toolbar: toolbar
        });
        void exchangeLoadSection();
    },

    destroy() {
        // exchangeUnbindHost: public/scripts/comp/desktop-apps/exchange.js
        exchangeUnbindHost();
        this._host = null;
    },

    refresh(host) {
        this.init(host || this._host);
    }
};

function registerExchangeDsapApplet() {
    // registerDsap: public/scripts/comp/dsapRegistry.js
    if (typeof registerDsap !== 'function') return;
    registerDsap({
        url: EXCHANGE_DSAP_URL,
        theme: 'dsap-smf',
        getContent(match) {
            const activeTab = exchangeDsapResolveActiveTab(exchangeDsapHostStub(match || {}));
            return {
                html: exchangeDsapBuildShellHtml(activeTab),
                drivers: exchangeDsapDriver,
                baseBackground: '#eeeeee'
            };
        }
    });
}

registerExchangeDsapApplet();
