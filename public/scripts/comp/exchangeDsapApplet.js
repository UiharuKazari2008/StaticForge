/**
 * Exchange Server DSAP — exchange.dreamscape.jp
 * Hosted in Grimoire. Section tabs are sub-routes.
 * UI + WS/MCP: public/scripts/comp/desktop-apps/exchange.js
 * Depends on: dsapRegistry.js
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

function exchangeDsapBuildTabBarHtml(activeTabId) {
    const cells = EXCHANGE_DSAP_TABS.map((tab) => {
        const selected = tab.id === activeTabId;
        const icon = tab.icon ? `<i class="${tab.icon}" aria-hidden="true"></i> ` : '';
        return `<button type="button" class="btn-secondary btn-small exchange-tab${selected ? ' active' : ''}" data-exchange-tab="${tab.id}" role="tab" aria-selected="${selected ? 'true' : 'false'}">${icon}${tab.label}</button>`;
    }).join('');
    return `<div class="exchange-tabs" id="exchangeTabBar" role="tablist">${cells}</div>`;
}

function exchangeDsapBuildShellHtml(activeTabId) {
    return `<div data-dsap="exchange" class="dsap-root exchange-dsap win7">
  <div class="exchange-toolbar explorer-actions-header" role="toolbar">
    <div class="explorer-command-set" id="exchangeCommandSet"></div>
    <div class="explorer-command-set" id="exchangeCommandSetEnd"></div>
  </div>
  ${exchangeDsapBuildTabBarHtml(activeTabId)}
  <div class="exchange-inset-panel" id="exchangeMain"></div>
  <div class="exchange-status-bar" id="exchangeStatus">Ready</div>
</div>`;
}

const exchangeDsapDriver = {
    _host: null,

    init(host) {
        this._host = host;
        const root = host.getRoot();
        const activeTab = exchangeDsapResolveActiveTab(host);
        desktopExchange.section = activeTab;

        const tabBar = root.querySelector('#exchangeTabBar');
        if (tabBar && tabBar.dataset.exchangeWired !== '1') {
            tabBar.dataset.exchangeWired = '1';
            tabBar.addEventListener('click', (e) => {
                const tab = e.target.closest('[data-exchange-tab]');
                if (!tab) return;
                host.navigate(exchangeDsapBuildTabUrl(tab.getAttribute('data-exchange-tab')));
            });
        }

        const toolbar = root.querySelector('#exchangeCommandSet');
        if (toolbar && toolbar.dataset.exchangeWired !== '1') {
            toolbar.dataset.exchangeWired = '1';
            // exchangeCreateButton: public/scripts/comp/desktop-apps/exchange.js
            const refreshBtn = exchangeCreateButton('btn-secondary btn-small explorer-command-btn', 'Refresh', 'fas fa-rotate-right');
            refreshBtn.append('Refresh');
            refreshBtn.addEventListener('click', () => {
                // exchangeLoadSection: public/scripts/comp/desktop-apps/exchange.js
                exchangeLoadSection();
            });
            toolbar.appendChild(refreshBtn);
        }

        // exchangeBindHost / exchangeLoadSection: public/scripts/comp/desktop-apps/exchange.js
        exchangeBindHost({
            root: root,
            main: root.querySelector('#exchangeMain'),
            status: root.querySelector('#exchangeStatus'),
            toolbar: toolbar,
            toolbarEnd: root.querySelector('#exchangeCommandSetEnd')
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
        getContent(match) {
            const activeTab = exchangeDsapResolveActiveTab(exchangeDsapHostStub(match || {}));
            return {
                html: exchangeDsapBuildShellHtml(activeTab),
                drivers: exchangeDsapDriver
            };
        }
    });
}

registerExchangeDsapApplet();
