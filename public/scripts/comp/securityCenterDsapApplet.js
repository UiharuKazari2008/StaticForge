/**
 * Security Center DSAP — security.dreamscape.jp
 * Linksys-style admin panel for blocked IPs, honeypot paths, authentication, and telemetry.
 * Depends on: dsapRegistry.js, websocket.js, confirmationDialog.js, contextMenu.js
 */

const SECURITY_DSAP_URL = 'security.dreamscape.jp';
const SECURITY_DSAP_URL_LEGACY = 'security.dyna.dreamscape.jp';
const SECURITY_DEFAULT_PER_PAGE = 15;
const SECURITY_PER_PAGE_OPTIONS = [10, 15, 25, 50];
const SECURITY_SEARCH_FETCH_LIMIT = 1000;
const SECURITY_DSAP_TAB_LABELS = {
    home: 'Home',
    blocked: 'Blocked Clients',
    honeypot: 'Honeypot',
    auth: 'Authentication',
    telemetry: 'Telemetry'
};

function securityDsapNormalizeView(view) {
    const v = String(view || '').trim().toLowerCase();
    if (!v || v === 'home' || v === 'dashboard') return 'home';
    if (v === 'paths' || v === 'honeypot' || v === 'scraped') return 'honeypot';
    if (v === 'pins' || v === 'appkeys' || v === 'authentication' || v === 'auth' || v === 'keys') return 'auth';
    if (v === 'blocked' || v === 'telemetry' || v === 'honeypot' || v === 'auth') return v;
    return 'home';
}

function securityDsapStartOfTodayMs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function securityDsapEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function securityDsapEscapeAttr(text) {
    return String(text || '').replace(/"/g, '&quot;');
}

function securityDsapFormatAge(minutes) {
    if (minutes == null || minutes < 0) return '—';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
}

function securityDsapFormatTimestamp(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—';
}

function securityDsapShortReason(reason) {
    const r = String(reason || '');
    if (r.includes('Failed login')) return 'Login';
    if (r.includes('Scraping')) return 'Scraping';
    if (r.includes('Invalid URL')) return 'Invalid URLs';
    if (r.includes('Rate limit')) return 'Rate Limit';
    if (r.includes('Suspicious')) return 'Suspicious';
    return 'Blocked';
}

function securityDsapBadgeClass(badge) {
    if (badge === 'Login') return 'login';
    if (badge === 'Scraping') return 'scraping';
    if (badge === 'Invalid URLs') return 'invalid';
    if (badge === 'Rate Limit') return 'ratelimit';
    return '';
}

function securityDsapBuildUrl(view, query = {}) {
    const base = view && view !== 'blocked'
        ? `dsap://${SECURITY_DSAP_URL}/${view}`
        : `dsap://${SECURITY_DSAP_URL}/blocked`;
    const q = new URLSearchParams();
    if (query.page && query.page > 1) q.set('page', String(query.page));
    if (query.perPage && query.perPage !== SECURITY_DEFAULT_PER_PAGE) q.set('perPage', String(query.perPage));
    if (query.search) q.set('search', query.search);
    if (query.eventType) q.set('eventType', query.eventType);
    const qs = q.toString();
    return qs ? `${base}?${qs}` : base;
}

function securityDsapShortUserAgent(ua) {
    const s = String(ua || '');
    return s.length > 52 ? `${s.slice(0, 49)}…` : s;
}

function securityDsapTelemetryEventLabel(type) {
    if (type === 'app') return 'App Load';
    if (type === 'login') return 'Login';
    return type || '—';
}

function securityDsapBuildHtml() {
    return `
<div data-dsap="security-dyna" class="dsap-root dsap-smf sec-dsap">
${dsapSmfBuildHeader({
    branchTitle: DSAP_SMF_BRANCH_SECURITY,
    toolTitle: SECURITY_DSAP_TAB_LABELS.home
})}

<table class="dsap-smf-tabbar sec-dsap-nav" id="secTabBar" cellspacing="0" cellpadding="3" border="1" width="100%">
  <tr>
    <td align="center" class="sec-tab" data-sec-tab="home"><i class="fas fa-gauge-high"></i> Home</td>
    <td align="center" class="sec-tab" data-sec-tab="blocked"><i class="fas fa-ban"></i> Blocked Clients</td>
    <td align="center" class="sec-tab" data-sec-tab="honeypot"><i class="fas fa-spider"></i> Honeypot</td>
    <td align="center" class="sec-tab" data-sec-tab="auth"><i class="fas fa-key"></i> Authentication</td>
    <td align="center" class="sec-tab" data-sec-tab="telemetry"><i class="fas fa-chart-line"></i> Telemetry</td>
  </tr>
</table>

<div class="sec-view sec-home-view" id="secHomeView">
  <div class="sec-dsap-section-hdr">Security Dashboard</div>
  <div class="sec-dsap-statusbox" id="secHomeStatus">
    <span class="sec-dsap-status-message" id="secHomeStatusMessage">Loading dashboard…</span>
  </div>
  <table class="sec-dsap-stats" cellspacing="0" cellpadding="3" width="100%" border="1">
    <tr>
      <td align="center" width="33%"><span class="sec-dsap-stat-label">Blocked today</span><br><span class="sec-dsap-stat-value" id="secHomeBlockedToday">—</span></td>
      <td align="center" width="33%"><span class="sec-dsap-stat-label">Honeypot URLs today</span><br><span class="sec-dsap-stat-value" id="secHomeHoneypotToday">—</span></td>
      <td align="center" width="34%"><span class="sec-dsap-stat-label">User login</span><br><span class="sec-dsap-stat-value" id="secHomeUserLogin">—</span></td>
    </tr>
  </table>
  <div id="secHomeLoading" class="sec-dsap-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading dashboard…</div>
  <div id="secHomeError" class="sec-dsap-error hidden"><i class="fas fa-exclamation-triangle"></i> <span id="secHomeErrorText">Failed to load</span></div>
  <div id="secHomeContent" class="sec-home-content hidden">
    <p class="sec-dsap-settings-intro">Today's security snapshot. Use the tabs above for full lists and configuration.</p>
  </div>
</div>

<div class="sec-view sec-blocked-view hidden" id="secBlockedView">
  <div class="sec-dsap-section-hdr">Blocked Clients</div>
  <div class="sec-dsap-statusbox" id="secBlockedStatus">
    <span class="sec-dsap-status-message" id="secBlockedStatusMessage">Loading blocked clients…</span>
  </div>
  <div class="sec-toolbar">
    <div class="sec-search-wrap">
      <i class="fas fa-search sec-search-icon"></i>
      <input type="text" id="secBlockedSearch" class="sec-input sec-search-input" placeholder="Search blocked IPs or reasons…">
    </div>
    <button type="button" id="secBlockedRefresh" class="sec-dsap-action-btn" title="Refresh"><i class="fas fa-sync"></i> Refresh</button>
  </div>
  <table class="sec-dsap-stats" cellspacing="0" cellpadding="3" width="100%" border="1">
    <tr>
      <td align="center" width="33%"><span class="sec-dsap-stat-label">Total blocked</span><br><span class="sec-dsap-stat-value" id="secBlockedTotal">0</span></td>
      <td align="center" width="33%"><span class="sec-dsap-stat-label">Page</span><br><span class="sec-dsap-stat-value"><span id="secBlockedPage">1</span> / <span id="secBlockedTotalPages">1</span></span></td>
      <td align="center" width="34%"><span class="sec-dsap-stat-label">Showing</span><br><span class="sec-dsap-stat-value" id="secBlockedRange">0–0</span></td>
    </tr>
  </table>
  <div id="secBlockedLoading" class="sec-dsap-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading blocked clients…</div>
  <div id="secBlockedError" class="sec-dsap-error hidden"><i class="fas fa-exclamation-triangle"></i> <span id="secBlockedErrorText">Failed to load</span></div>
  <div id="secBlockedTableWrap" class="sec-table-wrap hidden">
    <table class="sec-data-table" cellspacing="0" cellpadding="4" width="100%" border="1">
      <thead>
        <tr>
          <th align="left">IP Address</th>
          <th align="left">Reason</th>
          <th align="center" width="70">Attempts</th>
          <th align="center" width="90">Age</th>
          <th align="center" width="130">Actions</th>
        </tr>
      </thead>
      <tbody id="secBlockedTableBody"></tbody>
    </table>
  </div>
  <div id="secBlockedEmpty" class="sec-dsap-empty hidden"><i class="fas fa-check-circle"></i> No blocked clients</div>
  <div id="secBlockedEmptySearch" class="sec-dsap-empty hidden"><i class="fas fa-search"></i> No matches for your search</div>
  <div id="secBlockedDetails" class="sec-details-panel hidden">
    <div class="sec-details-header">
      <strong>IP Details</strong>
      <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="close-details" title="Close"><i class="fas fa-times"></i></button>
    </div>
    <div id="secBlockedDetailsBody" class="sec-details-body"></div>
  </div>
  <div class="sec-pager" id="secBlockedPager">
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-pager="prev" id="secBlockedPrev"><i class="fas fa-chevron-left"></i> Prev</button>
    <span class="sec-pager-info">(<span id="secBlockedCount">0</span> total)</span>
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-pager="next" id="secBlockedNext">Next <i class="fas fa-chevron-right"></i></button>
    <div class="sec-perpage">
      <label>Per page</label>
      <button type="button" id="secBlockedPerPageBtn" class="dsap-smf-btn dsap-smf-btn-small sec-perpage-btn">
        <span id="secBlockedPerPageSelected">15</span> <i class="fas fa-caret-down"></i>
      </button>
      <input type="hidden" id="secBlockedPerPageHidden" value="15">
    </div>
  </div>
</div>

<div class="sec-view sec-honeypot-view hidden" id="secHoneypotView">
  <div class="sec-dsap-section-hdr">Honeypot (Captured URLs)</div>
  <div class="sec-dsap-statusbox" id="secHoneypotStatus">
    <span class="sec-dsap-status-message" id="secHoneypotStatusMessage">Loading honeypot URLs…</span>
  </div>
  <div class="sec-toolbar">
    <div class="sec-search-wrap">
      <i class="fas fa-search sec-search-icon"></i>
      <input type="text" id="secHoneypotSearch" class="sec-input sec-search-input" placeholder="Search captured URLs…">
    </div>
    <button type="button" id="secHoneypotRefresh" class="sec-dsap-action-btn"><i class="fas fa-sync"></i> Refresh</button>
    <button type="button" id="secHoneypotClearAll" class="sec-dsap-action-btn sec-btn-danger"><i class="fas fa-trash"></i> Clear All</button>
  </div>
  <table class="sec-dsap-stats" cellspacing="0" cellpadding="3" width="100%" border="1">
    <tr>
      <td align="center" width="33%"><span class="sec-dsap-stat-label">Captured URLs</span><br><span class="sec-dsap-stat-value" id="secHoneypotTotal">0</span></td>
      <td align="center" width="33%"><span class="sec-dsap-stat-label">Page</span><br><span class="sec-dsap-stat-value"><span id="secHoneypotPage">1</span> / <span id="secHoneypotTotalPages">1</span></span></td>
      <td align="center" width="34%"><span class="sec-dsap-stat-label">Showing</span><br><span class="sec-dsap-stat-value" id="secHoneypotRange">0–0</span></td>
    </tr>
  </table>
  <div id="secHoneypotLoading" class="sec-dsap-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading honeypot URLs…</div>
  <div id="secHoneypotError" class="sec-dsap-error hidden"><i class="fas fa-exclamation-triangle"></i> <span id="secHoneypotErrorText">Failed to load</span></div>
  <div id="secHoneypotTableWrap" class="sec-table-wrap hidden">
    <table class="sec-data-table" cellspacing="0" cellpadding="4" width="100%" border="1">
      <thead>
        <tr>
          <th align="left">Path</th>
          <th align="center" width="70">Hits</th>
          <th align="center" width="90">Last seen</th>
          <th align="center" width="100">First seen</th>
          <th align="center" width="60">Remove</th>
        </tr>
      </thead>
      <tbody id="secHoneypotTableBody"></tbody>
    </table>
  </div>
  <div id="secHoneypotEmpty" class="sec-dsap-empty hidden"><i class="fas fa-check-circle"></i> No honeypot URLs recorded</div>
  <div id="secHoneypotEmptySearch" class="sec-dsap-empty hidden"><i class="fas fa-search"></i> No matches for your search</div>
  <div class="sec-pager" id="secHoneypotPager">
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-pager="prev" id="secHoneypotPrev"><i class="fas fa-chevron-left"></i> Prev</button>
    <span class="sec-pager-info">(<span id="secHoneypotCount">0</span> total)</span>
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-pager="next" id="secHoneypotNext">Next <i class="fas fa-chevron-right"></i></button>
    <div class="sec-perpage">
      <label>Per page</label>
      <button type="button" id="secHoneypotPerPageBtn" class="dsap-smf-btn dsap-smf-btn-small sec-perpage-btn">
        <span id="secHoneypotPerPageSelected">15</span> <i class="fas fa-caret-down"></i>
      </button>
      <input type="hidden" id="secHoneypotPerPageHidden" value="15">
    </div>
  </div>
</div>

<div class="sec-view sec-auth-view hidden" id="secAuthView">
  <div class="sec-dsap-section-hdr">PIN Access Control</div>
  <div class="sec-dsap-statusbox" id="secAuthPinStatus">
    <span class="sec-dsap-status-message" id="secAuthPinStatusMessage">Loading PIN settings…</span>
  </div>
  <div id="secAuthPinsLoading" class="sec-dsap-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading PIN settings…</div>
  <div id="secAuthPinsError" class="sec-dsap-error hidden"><i class="fas fa-exclamation-triangle"></i> <span id="secAuthPinsErrorText">Failed to load</span></div>
  <div id="secAuthPinsContent" class="sec-pins-content hidden">
    <p class="sec-dsap-settings-intro">Configure admin and user PIN login. Changes save immediately when you click Save or toggle user login.</p>
    <table class="sec-dsap-settings-table" cellspacing="0" cellpadding="4" border="0" width="100%">
      <tr>
        <td class="sec-dsap-setting-label">Admin PIN</td>
        <td class="sec-dsap-setting-control">
          <span class="sec-dsap-setting-hint">Status:</span>
          <span id="secAdminPinStatus" class="sec-pin-status">—</span>
          <input type="password" id="secAdminPinInput" class="sec-input sec-pin-input" autocomplete="new-password" placeholder="Enter new admin PIN">
          <button type="button" id="secSaveAdminPin" class="sec-dsap-action-btn sec-btn-primary"><i class="fas fa-save"></i> Update</button>
        </td>
      </tr>
      <tr>
        <td class="sec-dsap-setting-label">User PIN</td>
        <td class="sec-dsap-setting-control">
          <span class="sec-dsap-setting-hint">Status:</span>
          <span id="secUserPinStatus" class="sec-pin-status">—</span>
          <input type="password" id="secUserPinInput" class="sec-input sec-pin-input" autocomplete="new-password" placeholder="Enter new user PIN">
          <button type="button" id="secSaveUserPin" class="sec-dsap-action-btn sec-btn-primary"><i class="fas fa-save"></i> Update</button>
          <button type="button" id="secUserPinToggle" class="sec-dsap-action-btn sec-pin-toggle" data-state="off"><i class="fas fa-toggle-off"></i> Disabled</button>
        </td>
      </tr>
    </table>
    <p class="sec-pins-note"><i class="fas fa-info-circle"></i> PIN values are stored in config.json (plain text). Leave fields blank to keep current values.</p>
  </div>

  <div class="sec-dsap-section-hdr sec-sub-hdr">Service Keys</div>
  <div class="sec-dsap-statusbox" id="secKeychainStatus">
    <span class="sec-dsap-status-message" id="secKeychainStatusMessage">Loading service keys…</span>
  </div>
  <div class="sec-toolbar">
    <button type="button" id="secKeychainRefresh" class="sec-dsap-action-btn"><i class="fas fa-sync"></i> Refresh</button>
    <button type="button" id="secKeychainSave" class="sec-dsap-action-btn sec-btn-primary" disabled><i class="fas fa-save"></i> Save Selections</button>
  </div>
  <div id="secKeychainLoading" class="sec-dsap-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading service keys…</div>
  <div id="secKeychainError" class="sec-dsap-error hidden"><i class="fas fa-exclamation-triangle"></i> <span id="secKeychainErrorText">Failed to load</span></div>
  <div id="secKeychainTableWrap" class="sec-table-wrap hidden">
    <table class="sec-data-table" cellspacing="0" cellpadding="4" width="100%" border="1">
      <thead>
        <tr>
          <th align="left">Service</th>
          <th align="left">Active key</th>
          <th align="left">Fingerprint</th>
          <th align="center" width="130">Actions</th>
        </tr>
      </thead>
      <tbody id="secKeychainTableBody"></tbody>
    </table>
  </div>
  <div id="secKeychainEmpty" class="sec-dsap-empty hidden"><i class="fas fa-key-skeleton-left-right"></i> No service key providers configured</div>

  <div id="secKeychainEditPanel" class="sec-details-panel hidden">
    <div class="sec-details-header">
      <strong id="secKeychainEditTitle">Edit Service Key</strong>
      <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="close-keychain-edit"><i class="fas fa-times"></i></button>
    </div>
    <div class="sec-details-body sec-appkeys-form">
      <label>Name<input type="text" id="secKeychainEditName" class="sec-input" placeholder="Key label"></label>
      <label>Key value<input type="password" id="secKeychainEditValue" class="sec-input" autocomplete="new-password" placeholder="Leave blank to keep current value"></label>
      <div class="sec-appkeys-form-actions">
        <button type="button" id="secKeychainEditSave" class="sec-dsap-action-btn sec-btn-primary"><i class="fas fa-save"></i> Save Key</button>
      </div>
    </div>
  </div>

  <div id="secKeychainAddPanel" class="sec-details-panel hidden">
    <div class="sec-details-header">
      <strong id="secKeychainAddTitle">Add Service Key</strong>
      <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="close-keychain-add"><i class="fas fa-times"></i></button>
    </div>
    <div class="sec-details-body sec-appkeys-form">
      <label>Name<input type="text" id="secKeychainAddName" class="sec-input" placeholder="Key label"></label>
      <label>Key value<input type="password" id="secKeychainAddValue" class="sec-input" autocomplete="new-password" placeholder="API key or contract ID"></label>
      <div class="sec-appkeys-form-actions">
        <button type="button" id="secKeychainAddSubmit" class="sec-dsap-action-btn sec-btn-primary"><i class="fas fa-plus"></i> Add Key</button>
      </div>
    </div>
  </div>

  <div class="sec-dsap-section-hdr sec-sub-hdr">Application Keys</div>
  <div class="sec-dsap-statusbox" id="secAppkeysStatus">
    <span class="sec-dsap-status-message" id="secAppkeysStatusMessage">Loading application keys…</span>
  </div>
  <div class="sec-toolbar">
    <button type="button" id="secAppkeysRefresh" class="sec-dsap-action-btn"><i class="fas fa-sync"></i> Refresh</button>
    <button type="button" id="secAppkeysCreateBtn" class="sec-dsap-action-btn sec-btn-primary"><i class="fas fa-plus"></i> Create Key</button>
  </div>
  <div id="secAppkeysLoading" class="sec-dsap-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading application keys…</div>
  <div id="secAppkeysError" class="sec-dsap-error hidden"><i class="fas fa-exclamation-triangle"></i> <span id="secAppkeysErrorText">Failed to load</span></div>
  <div id="secAppkeysPendingWrap" class="sec-appkeys-pending hidden">
    <div class="sec-dsap-section-hdr sec-sub-hdr">Pending Authorization Requests</div>
    <table class="sec-data-table" cellspacing="0" cellpadding="4" width="100%" border="1">
      <thead>
        <tr>
          <th align="left">App</th>
          <th align="center" width="80">Code</th>
          <th align="left">User-Agent</th>
          <th align="center" width="120">Actions</th>
        </tr>
      </thead>
      <tbody id="secAppkeysPendingBody"></tbody>
    </table>
  </div>
  <div id="secAppkeysTableWrap" class="sec-table-wrap hidden">
    <table class="sec-data-table" cellspacing="0" cellpadding="4" width="100%" border="1">
      <thead>
        <tr>
          <th align="left">Application</th>
          <th align="left">Key</th>
          <th align="left">Scopes</th>
          <th align="center" width="90">Status</th>
          <th align="center" width="110">Expires</th>
          <th align="center" width="110">Refresh by</th>
          <th align="center" width="80">Actions</th>
        </tr>
      </thead>
      <tbody id="secAppkeysTableBody"></tbody>
    </table>
  </div>
  <div id="secAppkeysEmpty" class="sec-dsap-empty hidden"><i class="fas fa-plug"></i> No application keys registered</div>
  <div id="secAppkeysCreatePanel" class="sec-details-panel hidden">
    <div class="sec-details-header">
      <strong>Create Application Key</strong>
      <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="close-appkey-create"><i class="fas fa-times"></i></button>
    </div>
    <div class="sec-details-body sec-appkeys-form">
      <label>Application name<input type="text" id="secAppkeyNameInput" class="sec-input" placeholder="My Desktop Client"></label>
      <label>User-Agent (exact string the app will send)<input type="text" id="secAppkeyUaInput" class="sec-input" placeholder="MyApp/1.0 (StaticForge)"></label>
      <label>Access level
        <button type="button" id="secAppkeyUserTypeBtn" class="dsap-smf-btn dsap-smf-btn-small sec-appkey-menu-btn">
          <span id="secAppkeyUserTypeSelected">Administrator</span> <i class="fas fa-caret-down"></i>
        </button>
        <input type="hidden" id="secAppkeyUserTypeHidden" value="admin">
      </label>
      <label>Expiration
        <button type="button" id="secAppkeyExpiryBtn" class="dsap-smf-btn dsap-smf-btn-small sec-appkey-menu-btn">
          <span id="secAppkeyExpirySelected">Perpetual</span> <i class="fas fa-caret-down"></i>
        </button>
        <input type="hidden" id="secAppkeyExpiryHidden" value="perpetual">
      </label>
      <label>Refresh interval (days)<input type="number" id="secAppkeyRefreshDaysInput" class="sec-input" min="1" max="365" value="30"></label>
      <div class="sec-appkeys-scopes" id="secAppkeyScopesWrap">
        <span class="sec-dsap-setting-hint">Scopes (select one or more; Universal overrides others)</span>
        <div id="secAppkeyScopesList"></div>
      </div>
      <div class="sec-appkeys-form-actions">
        <button type="button" id="secAppkeySubmitCreate" class="sec-dsap-action-btn sec-btn-primary"><i class="fas fa-check"></i> Issue Key</button>
      </div>
      <div id="secAppkeyCreateResult" class="sec-appkey-result hidden"></div>
    </div>
  </div>
</div>

<div class="sec-view sec-telemetry-view hidden" id="secTelemetryView">
  <div class="sec-dsap-section-hdr">Client Telemetry</div>
  <div class="sec-dsap-statusbox" id="secTelemetryStatus">
    <span class="sec-dsap-status-message" id="secTelemetryStatusMessage">Loading telemetry…</span>
  </div>
  <div class="sec-toolbar">
    <div class="sec-search-wrap">
      <i class="fas fa-search sec-search-icon"></i>
      <input type="text" id="secTelemetrySearch" class="sec-input sec-search-input" placeholder="Search IP, user agent, platform…">
    </div>
    <div class="sec-perpage sec-telemetry-filter">
      <label>Event</label>
    <button type="button" id="secTelemetryEventBtn" class="dsap-smf-btn dsap-smf-btn-small sec-telemetry-event-btn">
      <span id="secTelemetryEventSelected">All events</span> <i class="fas fa-caret-down"></i>
    </button>
    <input type="hidden" id="secTelemetryEventHidden" value="">
    </div>
    <button type="button" id="secTelemetryRefresh" class="sec-dsap-action-btn" title="Refresh"><i class="fas fa-sync"></i> Refresh</button>
  </div>
  <table class="sec-dsap-stats" cellspacing="0" cellpadding="3" width="100%" border="1">
    <tr>
      <td align="center" width="33%"><span class="sec-dsap-stat-label">Total events</span><br><span class="sec-dsap-stat-value" id="secTelemetryTotal">0</span></td>
      <td align="center" width="33%"><span class="sec-dsap-stat-label">Page</span><br><span class="sec-dsap-stat-value"><span id="secTelemetryPage">1</span> / <span id="secTelemetryTotalPages">1</span></span></td>
      <td align="center" width="34%"><span class="sec-dsap-stat-label">Showing</span><br><span class="sec-dsap-stat-value" id="secTelemetryRange">0–0</span></td>
    </tr>
  </table>
  <div id="secTelemetryLoading" class="sec-dsap-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading telemetry…</div>
  <div id="secTelemetryError" class="sec-dsap-error hidden"><i class="fas fa-exclamation-triangle"></i> <span id="secTelemetryErrorText">Failed to load</span></div>
  <div id="secTelemetryTableWrap" class="sec-table-wrap hidden">
    <table class="sec-data-table" cellspacing="0" cellpadding="4" width="100%" border="1">
      <thead>
        <tr>
          <th align="left">Time</th>
          <th align="center" width="80">Event</th>
          <th align="left">IP</th>
          <th align="left">Platform</th>
          <th align="left">User Agent</th>
          <th align="center" width="70">User</th>
          <th align="center" width="70">Details</th>
        </tr>
      </thead>
      <tbody id="secTelemetryTableBody"></tbody>
    </table>
  </div>
  <div id="secTelemetryEmpty" class="sec-dsap-empty hidden"><i class="fas fa-chart-line"></i> No telemetry events recorded</div>
  <div id="secTelemetryEmptySearch" class="sec-dsap-empty hidden"><i class="fas fa-search"></i> No matches for your search</div>
  <div id="secTelemetryDetails" class="sec-details-panel hidden">
    <div class="sec-details-header">
      <strong>Telemetry Details</strong>
      <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="close-telemetry-details" title="Close"><i class="fas fa-times"></i></button>
    </div>
    <div id="secTelemetryDetailsBody" class="sec-details-body"></div>
  </div>
  <div class="sec-pager" id="secTelemetryPager">
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-pager="prev" id="secTelemetryPrev"><i class="fas fa-chevron-left"></i> Prev</button>
    <span class="sec-pager-info">(<span id="secTelemetryCount">0</span> total)</span>
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-pager="next" id="secTelemetryNext">Next <i class="fas fa-chevron-right"></i></button>
    <div class="sec-perpage">
      <label>Per page</label>
      <button type="button" id="secTelemetryPerPageBtn" class="dsap-smf-btn dsap-smf-btn-small sec-perpage-btn">
        <span id="secTelemetryPerPageSelected">15</span> <i class="fas fa-caret-down"></i>
      </button>
      <input type="hidden" id="secTelemetryPerPageHidden" value="15">
    </div>
  </div>
</div>

<div id="secAccessDenied" class="sec-dsap-error sec-access-denied hidden">
  <i class="fas fa-lock"></i>
  <p>Admin access required for Security Center.</p>
</div>
</div>`;
}

const securityDsapScopedCss = `
[data-dsap="security-dyna"].sec-dsap,
[data-dsap="security-dyna"].sec-dsap *:not(i) {
  font-family: Arial, Helvetica, sans-serif !important;
}
[data-dsap="security-dyna"].sec-dsap {
  background: #eeeeee;
  color: #000000;
  font-size: 12pt;
  line-height: 1.3;
  padding: 6px;
  box-sizing: border-box;
  border: 1px solid #666666;
}
[data-dsap="security-dyna"] .hidden { display: none !important; }

/* Header, tabs, section hdr, status, stats, toolbar, buttons: public/css/dsap-smf.css */

[data-dsap="security-dyna"] .sec-search-wrap {
  flex: 1;
  min-width: 140px;
  position: relative;
}
[data-dsap="security-dyna"] .sec-search-icon {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  color: #666;
  font-size: 10pt;
}
[data-dsap="security-dyna"] .sec-search-input { padding-left: 24px !important; }

[data-dsap="security-dyna"] .sec-input,
[data-dsap="security-dyna"] .sec-pin-input {
  background: #ffffff;
  border: 1px solid #666666;
  border-radius: 0;
  color: #000000;
  font-size: 11pt;
  box-sizing: border-box;
  padding: 2px 6px;
  width: 100%;
  max-width: 220px;
}

[data-dsap="security-dyna"] .sec-dsap-action-btn {
  font-size: 9pt;
  font-weight: bold;
  background: #c0c0c0;
  color: #000000;
  border: 1px solid #ff8c00;
  border-radius: 3px;
  padding: 5px 12px;
  margin: 0;
  cursor: pointer;
  line-height: 1.15;
  white-space: nowrap;
  box-shadow: 1px 1px 0 #ffffff inset, -1px -1px 0 #808080 inset;
}
[data-dsap="security-dyna"] .sec-dsap-action-btn:active {
  box-shadow: -1px -1px 0 #ffffff inset, 1px 1px 0 #808080 inset;
  background: #b0b0b0;
}
[data-dsap="security-dyna"] .sec-btn-primary {
  background: #d4d8e0;
  border: 2px solid #ff8c00;
  box-shadow: 1px 1px 0 #ffffff inset, -1px -1px 0 #606060 inset;
}
[data-dsap="security-dyna"] .sec-btn-danger {
  background: #e8a8a8;
  color: #330000;
  border: 1px solid #cc4400;
}
[data-dsap="security-dyna"] .sec-btn-small {
  font-size: 9pt;
  padding: 3px 8px;
}
[data-dsap="security-dyna"] .sec-dsap-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

[data-dsap="security-dyna"] .sec-table-wrap {
  background: #ffffff;
  border: 1px solid #666666;
  margin: 4px 0;
  overflow-x: auto;
}
[data-dsap="security-dyna"] .sec-data-table {
  border-collapse: collapse;
  font-size: 11pt;
  width: 100%;
}
[data-dsap="security-dyna"] .sec-data-table th {
  background: #003366;
  color: #ffffff;
  font-weight: bold;
  padding: 4px 6px;
  border: 1px solid #000033;
  font-size: 10pt;
}
[data-dsap="security-dyna"] .sec-data-table td {
  padding: 4px 6px;
  border: 1px solid #cccccc;
  vertical-align: middle;
  background: #ffffff;
  font-size: 11pt;
}
[data-dsap="security-dyna"] .sec-data-table tr:nth-child(even) td {
  background: #f8f8f8;
}
[data-dsap="security-dyna"] .sec-data-table tr:hover td {
  background: #ffffee;
}
[data-dsap="security-dyna"] .sec-ip-cell {
  font-family: monospace;
  font-weight: bold;
  word-break: break-all;
}
[data-dsap="security-dyna"] .sec-path-cell {
  font-family: monospace;
  word-break: break-all;
}
[data-dsap="security-dyna"] .sec-actions-cell {
  white-space: nowrap;
  text-align: center;
}
[data-dsap="security-dyna"] .sec-actions-cell .sec-dsap-action-btn {
  padding: 2px 6px;
  margin: 0 1px;
}

[data-dsap="security-dyna"] .sec-badge {
  display: inline-block;
  padding: 1px 5px;
  font-size: 9pt;
  font-weight: bold;
  background: #003366;
  color: #ffffff;
  border: 1px solid #000033;
  margin-left: 4px;
}
[data-dsap="security-dyna"] .sec-badge.scraping { background: #663300; }
[data-dsap="security-dyna"] .sec-badge.telemetry-login { background: #003366; }
[data-dsap="security-dyna"] .sec-badge.telemetry-app { background: #336633; }
[data-dsap="security-dyna"] .sec-telemetry-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 8px;
}
[data-dsap="security-dyna"] .sec-telemetry-filter label {
  font-size: 10pt;
  white-space: nowrap;
}
[data-dsap="security-dyna"] .sec-badge.login { background: #660000; }
[data-dsap="security-dyna"] .sec-badge.invalid { background: #444400; }
[data-dsap="security-dyna"] .sec-badge.ratelimit { background: #004444; }

[data-dsap="security-dyna"] .sec-dsap-loading,
[data-dsap="security-dyna"] .sec-dsap-empty,
[data-dsap="security-dyna"] .sec-dsap-error {
  text-align: center;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #999999;
  margin: 4px 0;
  color: #333333;
  font-size: 11pt;
}
[data-dsap="security-dyna"] .sec-dsap-error {
  color: #990000;
  background: #ffeeee;
  font-weight: bold;
}
[data-dsap="security-dyna"] .sec-dsap-empty {
  color: #336633;
  font-style: italic;
}
[data-dsap="security-dyna"] .sec-access-denied p {
  margin: 8px 0 0;
  font-weight: bold;
}

[data-dsap="security-dyna"] .sec-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px;
  background: #f0f0f0;
  border: 1px solid #999999;
  font-size: 11pt;
  margin-top: 4px;
}
[data-dsap="security-dyna"] .sec-pager-info { color: #333333; }
[data-dsap="security-dyna"] .sec-perpage {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 11pt;
}
[data-dsap="security-dyna"] .sec-perpage-dropdown { min-width: 3.5em; }

[data-dsap="security-dyna"] .sec-details-panel {
  background: #f8f8f8;
  border: 1px solid #666666;
  margin: 4px 0;
  font-size: 11pt;
}
[data-dsap="security-dyna"] .sec-details-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #003366;
  color: #ffffff;
  padding: 3px 6px;
  font-weight: bold;
}
[data-dsap="security-dyna"] .sec-details-body {
  padding: 6px 8px;
  line-height: 1.5;
}

[data-dsap="security-dyna"] .sec-dsap-settings-intro {
  margin: 5px 0;
  color: #333333;
  font-size: 11pt;
}
[data-dsap="security-dyna"] .sec-dsap-settings-table {
  background: #f8f8f8;
  border: 1px solid #999999;
  margin: 5px 0;
  font-size: 11pt;
}
[data-dsap="security-dyna"] .sec-dsap-settings-table td {
  padding: 6px 8px;
  vertical-align: middle;
  border-bottom: 1px solid #dddddd;
}
[data-dsap="security-dyna"] .sec-dsap-setting-label {
  font-weight: bold;
  color: #000000;
  white-space: nowrap;
  width: 130px;
}
[data-dsap="security-dyna"] .sec-dsap-setting-hint {
  color: #222222;
  font-size: 11pt;
}
[data-dsap="security-dyna"] .sec-dsap-setting-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
[data-dsap="security-dyna"] .sec-dsap-setting-control .sec-pin-input {
  flex: 1;
  min-width: 120px;
  max-width: 180px;
}
[data-dsap="security-dyna"] .sec-home-content .sec-dsap-stat-value.sec-status-on { color: #006600; font-weight: bold; }
[data-dsap="security-dyna"] .sec-home-content .sec-dsap-stat-value.sec-status-off { color: #990000; font-weight: bold; }

[data-dsap="security-dyna"] .sec-pins-note {
  font-size: 10pt;
  color: #555555;
  font-style: italic;
  margin-top: 8px;
}
[data-dsap="security-dyna"] .sec-pin-toggle[data-state="on"] {
  background: #c8e6c8;
  color: #003300;
  border-color: #006600;
}
[data-dsap="security-dyna"] .sec-pin-status.configured { color: #006600; font-weight: bold; }
[data-dsap="security-dyna"] .sec-pin-status.not-set { color: #990000; font-weight: bold; }

[data-dsap="security-dyna"] .custom-dropdown-btn {
  background: #ffffff !important;
  border: 1px solid #666666 !important;
  color: #000000 !important;
  font-family: Arial, Helvetica, sans-serif !important;
  font-size: 11pt !important;
  padding: 2px 6px !important;
  min-height: 18px !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  width: auto !important;
}
[data-dsap="security-dyna"] .custom-dropdown-btn:hover {
  background: #f0f0f0 !important;
}
[data-dsap="security-dyna"] .custom-dropdown-menu {
  background: #ffffff !important;
  border: 1px solid #666666 !important;
  box-shadow: none !important;
  font-size: 11pt !important;
  min-width: 60px !important;
  border-radius: 0 !important;
  padding: 2px 0 !important;
}
[data-dsap="security-dyna"] .custom-dropdown-menu .dd-item,
[data-dsap="security-dyna"] .custom-dropdown-menu > div {
  padding: 3px 7px !important;
  color: #000000 !important;
  background: transparent !important;
}
[data-dsap="security-dyna"] .custom-dropdown-menu .dd-item:hover,
[data-dsap="security-dyna"] .custom-dropdown-menu > div:hover {
  background: #003366 !important;
  color: #ffffff !important;
}

[data-dsap="security-dyna"] .sec-pins-note {
  margin-top: 8px;
  font-size: 10pt;
  color: #333333;
}
[data-dsap="security-dyna"] .sec-sub-hdr {
  margin-top: 10px;
  font-size: 11pt;
}
[data-dsap="security-dyna"] .sec-appkeys-form label {
  display: block;
  margin-bottom: 8px;
  font-size: 11pt;
}
[data-dsap="security-dyna"] .sec-appkeys-form .sec-input {
  display: block;
  width: 100%;
  margin-top: 2px;
  box-sizing: border-box;
}
[data-dsap="security-dyna"] .sec-appkeys-scopes {
  margin: 8px 0;
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid #cccccc;
  padding: 6px;
  background: #ffffff;
}
[data-dsap="security-dyna"] .sec-scope-chip {
  display: inline-block;
  margin: 2px 4px 2px 0;
  padding: 2px 6px;
  border: 1px solid #666666;
  background: #f8f8f8;
  cursor: pointer;
  font-size: 10pt;
}
[data-dsap="security-dyna"] .sec-scope-chip.selected {
  background: #003366;
  color: #ffffff;
  border-color: #001a33;
}
[data-dsap="security-dyna"] .sec-appkey-result {
  margin-top: 8px;
  padding: 8px;
  border: 1px solid #336633;
  background: #eef8ee;
  font-family: monospace;
  font-size: 10pt;
  word-break: break-all;
}
[data-dsap="security-dyna"] .sec-status-active { color: #006600; font-weight: bold; }
[data-dsap="security-dyna"] .sec-status-expired,
[data-dsap="security-dyna"] .sec-status-revoked,
[data-dsap="security-dyna"] .sec-status-replaced { color: #990000; font-weight: bold; }
[data-dsap="security-dyna"] .sec-status-refresh_required { color: #996600; font-weight: bold; }

[data-dsap="security-dyna"] i,
[data-dsap="security-dyna"] i * {
  font-family: "Font Awesome 5 Free", "Font Awesome 5 Pro", "FontAwesome", sans-serif !important;
  font-weight: 900 !important;
}
`;

const securityDsapDriver = {
    _state: null,
    _clickMenuTargets: [],

    init(host) {
        this._state = {
            host,
            view: 'home',
            blocked: { items: [], meta: { page: 1, perPage: SECURITY_DEFAULT_PER_PAGE, search: '', total: 0, totalPages: 1 }, selectedIp: null },
            honeypot: { items: [], meta: { page: 1, perPage: SECURITY_DEFAULT_PER_PAGE, search: '', total: 0, totalPages: 1 } },
            pins: { userPinLoginEnabled: true, adminPinConfigured: false, userPinConfigured: false },
            keychain: { services: [], originalSelections: {}, pendingSelections: {}, editServiceId: null, editKeyIndex: null, addServiceId: null },
            appkeys: { keys: [], pending: [], scopes: [], selectedScopes: ['universal'] },
            telemetry: { items: [], meta: { page: 1, perPage: SECURITY_DEFAULT_PER_PAGE, search: '', eventType: '', total: 0, totalPages: 1 }, selectedId: null },
            searchTimers: {}
        };

        const root = host.getRoot();
        if (!root) return;

        if (localStorage.getItem('userType') !== 'admin') {
            root.querySelectorAll('.sec-view, #secTabBar').forEach((el) => el.classList.add('hidden'));
            root.querySelector('#secAccessDenied')?.classList.remove('hidden');
            return;
        }

        const segments = host.getPathSegments();
        const view = securityDsapNormalizeView(segments[0]);
        this._state.view = view;

        const page = Math.max(1, parseInt(host.getQueryParam('page') || '1', 10) || 1);
        const perPage = Math.max(5, Math.min(100, parseInt(host.getQueryParam('perPage') || String(SECURITY_DEFAULT_PER_PAGE), 10) || SECURITY_DEFAULT_PER_PAGE));
        const search = host.getQueryParam('search') || '';
        const eventType = host.getQueryParam('eventType') || '';

        if (this._state.view === 'blocked') {
            this._state.blocked.meta = { page, perPage, search, total: 0, totalPages: 1 };
        } else if (this._state.view === 'honeypot') {
            this._state.honeypot.meta = { page, perPage, search, total: 0, totalPages: 1 };
        } else if (this._state.view === 'telemetry') {
            this._state.telemetry.meta = { page, perPage, search, eventType, total: 0, totalPages: 1 };
        }

        this._state._onClick = (e) => this._onClick(e);
        root.addEventListener('click', this._state._onClick);

        this._wireTabs(root, host);
        this._showView(root);
        this._wireViewControls(root, host);
        setTimeout(() => this._wireClickMenus(root, host), 0);
        this._loadCurrentView(root);
    },

    refresh(host) {
        this.destroy(host);
        this.init(host);
    },

    destroy(host) {
        const state = this._state;
        if (!state) return;

        const root = host?.getRoot?.() || state.host?.getRoot?.();
        if (root && state._onClick) {
            root.removeEventListener('click', state._onClick);
        }

        this._teardownClickMenus();

        Object.values(state.searchTimers || {}).forEach((t) => clearTimeout(t));
        this._state = null;
    },

    _teardownClickMenus() {
        // contextMenu.detachClickMenuFromElement: public/scripts/comp/contextMenu.js
        if (!contextMenu || !this._clickMenuTargets.length) {
            this._clickMenuTargets = [];
            return;
        }
        this._clickMenuTargets.forEach((el) => {
            contextMenu.detachClickMenuFromElement(el);
        });
        this._clickMenuTargets = [];
    },

    _attachClickMenu(btn, config) {
        if (!btn || !contextMenu) return;
        contextMenu.attachClickMenuToElement(btn, config);
        this._clickMenuTargets.push(btn);
    },

    _setStatus(root, viewKey, message, tone) {
        const msgEl = root.querySelector(`#sec${viewKey.charAt(0).toUpperCase()}${viewKey.slice(1)}StatusMessage`);
        const boxEl = root.querySelector(`#sec${viewKey.charAt(0).toUpperCase()}${viewKey.slice(1)}Status`);
        if (msgEl) msgEl.textContent = message;
        if (boxEl) {
            boxEl.classList.remove('sec-dsap-status-error', 'sec-dsap-status-ok');
            if (tone === 'error') boxEl.classList.add('sec-dsap-status-error');
            if (tone === 'ok') boxEl.classList.add('sec-dsap-status-ok');
        }
    },

    _viewElementId(view) {
        const map = {
            home: 'secHomeView',
            blocked: 'secBlockedView',
            honeypot: 'secHoneypotView',
            auth: 'secAuthView',
            telemetry: 'secTelemetryView'
        };
        return map[view] || 'secHomeView';
    },

    _showView(root) {
        const view = this._state.view;
        root.querySelectorAll('.sec-view').forEach((el) => el.classList.add('hidden'));
        root.querySelector(`#${this._viewElementId(view)}`)?.classList.remove('hidden');
        root.querySelectorAll('.sec-tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.secTab === view);
            tab.classList.toggle('dsap-smf-tab-active', tab.dataset.secTab === view);
        });
        // dsapSmfUpdateHeaderTool: public/scripts/comp/dsapSmfMarkup.js
        dsapSmfUpdateHeaderTool(root, SECURITY_DSAP_TAB_LABELS[view] || 'Home');
    },

    _wireTabs(root, host) {
        const tabBar = root.querySelector('#secTabBar');
        if (!tabBar || tabBar.dataset.secWired === '1') return;
        tabBar.dataset.secWired = '1';
        tabBar.addEventListener('click', (e) => {
            const tab = e.target.closest('[data-sec-tab]');
            if (!tab) return;
            const view = tab.dataset.secTab;
            const meta = view === 'honeypot'
                ? this._state.honeypot.meta
                : view === 'telemetry'
                    ? this._state.telemetry.meta
                    : view === 'blocked'
                        ? this._state.blocked.meta
                        : this._state.blocked.meta;
            const url = securityDsapBuildUrl(view, {
                page: 1,
                perPage: meta.perPage,
                search: view === this._state.view ? meta.search : '',
                eventType: view === 'telemetry' && view === this._state.view ? meta.eventType : ''
            });
            host.navigate(url);
        });
    },

    _wireViewControls(root, host) {
        this._wireSearch(root, '#secBlockedSearch', 'blocked', host);
        this._wireSearch(root, '#secHoneypotSearch', 'honeypot', host);
        this._wireSearch(root, '#secTelemetrySearch', 'telemetry', host);
        this._wireRefresh(root, '#secBlockedRefresh', 'blocked');
        this._wireRefresh(root, '#secHoneypotRefresh', 'honeypot');
        this._wireRefresh(root, '#secAppkeysRefresh', 'auth');
        this._wireRefresh(root, '#secKeychainRefresh', 'auth');
        this._wireRefresh(root, '#secTelemetryRefresh', 'telemetry');
        this._wirePager(root, '#secBlockedPager', 'blocked', host);
        this._wirePager(root, '#secHoneypotPager', 'honeypot', host);
        this._wirePager(root, '#secTelemetryPager', 'telemetry', host);

        const clearBtn = root.querySelector('#secHoneypotClearAll');
        if (clearBtn && clearBtn.dataset.secWired !== '1') {
            clearBtn.dataset.secWired = '1';
            clearBtn.addEventListener('click', () => this._clearAllPaths(root));
        }

        const userToggle = root.querySelector('#secUserPinToggle');
        if (userToggle && userToggle.dataset.secWired !== '1') {
            userToggle.dataset.secWired = '1';
            userToggle.addEventListener('click', () => this._toggleUserPinLogin(root));
        }

        const saveAdmin = root.querySelector('#secSaveAdminPin');
        if (saveAdmin && saveAdmin.dataset.secWired !== '1') {
            saveAdmin.dataset.secWired = '1';
            saveAdmin.addEventListener('click', () => this._saveAdminPin(root));
        }

        const saveUser = root.querySelector('#secSaveUserPin');
        if (saveUser && saveUser.dataset.secWired !== '1') {
            saveUser.dataset.secWired = '1';
            saveUser.addEventListener('click', () => this._saveUserPin(root));
        }

        const keychainSave = root.querySelector('#secKeychainSave');
        if (keychainSave && keychainSave.dataset.secWired !== '1') {
            keychainSave.dataset.secWired = '1';
            keychainSave.addEventListener('click', () => void this._saveKeychainSelections(root));
        }

        const keychainAddSubmit = root.querySelector('#secKeychainAddSubmit');
        if (keychainAddSubmit && keychainAddSubmit.dataset.secWired !== '1') {
            keychainAddSubmit.dataset.secWired = '1';
            keychainAddSubmit.addEventListener('click', () => void this._submitKeychainAdd(root));
        }

        const keychainEditSave = root.querySelector('#secKeychainEditSave');
        if (keychainEditSave && keychainEditSave.dataset.secWired !== '1') {
            keychainEditSave.dataset.secWired = '1';
            keychainEditSave.addEventListener('click', () => void this._submitKeychainEdit(root));
        }

        const createBtn = root.querySelector('#secAppkeysCreateBtn');
        if (createBtn && createBtn.dataset.secWired !== '1') {
            createBtn.dataset.secWired = '1';
            createBtn.addEventListener('click', () => {
                root.querySelector('#secAppkeysCreatePanel')?.classList.remove('hidden');
                void this._wireAppkeyCreateForm(root);
            });
        }

        const submitCreate = root.querySelector('#secAppkeySubmitCreate');
        if (submitCreate && submitCreate.dataset.secWired !== '1') {
            submitCreate.dataset.secWired = '1';
            submitCreate.addEventListener('click', () => void this._submitAppkeyCreate(root));
        }
    },

    _onClick(e) {
        const btn = e.target.closest('[data-sec-action]');
        if (!btn || !this._state) return;

        const root = this._state.host.getRoot();
        const action = btn.dataset.secAction;

        if (action === 'close-details') {
            root.querySelector('#secBlockedDetails')?.classList.add('hidden');
            return;
        }
        if (action === 'close-telemetry-details') {
            root.querySelector('#secTelemetryDetails')?.classList.add('hidden');
            return;
        }
        if (action === 'close-appkey-create') {
            root.querySelector('#secAppkeysCreatePanel')?.classList.add('hidden');
            root.querySelector('#secAppkeyCreateResult')?.classList.add('hidden');
            return;
        }
        if (action === 'close-keychain-edit') {
            root.querySelector('#secKeychainEditPanel')?.classList.add('hidden');
            this._state.keychain.editServiceId = null;
            this._state.keychain.editKeyIndex = null;
            return;
        }
        if (action === 'close-keychain-add') {
            root.querySelector('#secKeychainAddPanel')?.classList.add('hidden');
            this._state.keychain.addServiceId = null;
            return;
        }
        if (action === 'keychain-edit') {
            const row = btn.closest('[data-sec-keychain-service]');
            if (row) this._openKeychainEditPanel(root, row.dataset.secKeychainService);
            return;
        }
        if (action === 'keychain-add') {
            const row = btn.closest('[data-sec-keychain-service]');
            if (row) this._openKeychainAddPanel(root, row.dataset.secKeychainService);
            return;
        }
        if (action === 'keychain-unlock') {
            const row = btn.closest('[data-sec-keychain-service]');
            if (row) void this._unlockKeychainService(root, row.dataset.secKeychainService);
            return;
        }
        if (action === 'revoke-appkey') {
            const keyId = btn.closest('[data-sec-appkey-id]')?.dataset.secAppkeyId;
            if (keyId) void this._revokeAppkey(root, keyId);
            return;
        }
        if (action === 'approve-appkey-req') {
            const reqId = btn.closest('[data-sec-appkey-req]')?.dataset.secAppkeyReq;
            if (reqId) void this._approveAppkeyRequest(root, reqId);
            return;
        }
        if (action === 'deny-appkey-req') {
            const reqId = btn.closest('[data-sec-appkey-req]')?.dataset.secAppkeyReq;
            if (reqId) void this._denyAppkeyRequest(root, reqId);
            return;
        }

        const telRow = btn.closest('[data-sec-telemetry-id]');
        if (telRow && action === 'telemetry-details') {
            void this._showTelemetryDetails(root, telRow.dataset.secTelemetryId);
            return;
        }

        const row = btn.closest('[data-sec-ip]');
        if (!row) return;

        const ip = row.dataset.secIp;
        if (action === 'details') void this._showBlockedDetails(root, ip);
        if (action === 'unblock') void this._unblockIp(root, ip);
        if (action === 'export') void this._exportIp(root, ip);
    },

    _getViewMeta(viewKey) {
        if (viewKey === 'honeypot') return this._state.honeypot.meta;
        if (viewKey === 'telemetry') return this._state.telemetry.meta;
        return this._state.blocked.meta;
    },

    _wireSearch(root, selector, viewKey, host) {
        const input = root.querySelector(selector);
        if (!input || input.dataset.secWired === '1') return;
        input.dataset.secWired = '1';
        const meta = this._getViewMeta(viewKey);
        input.value = meta.search || '';
        input.addEventListener('input', () => {
            clearTimeout(this._state.searchTimers[viewKey]);
            this._state.searchTimers[viewKey] = setTimeout(() => {
                const url = securityDsapBuildUrl(viewKey, {
                    page: 1,
                    perPage: meta.perPage,
                    search: input.value || '',
                    eventType: viewKey === 'telemetry' ? meta.eventType : ''
                });
                host.navigate(url);
            }, 280);
        });
    },

    _wireRefresh(root, selector, viewKey) {
        const btn = root.querySelector(selector);
        if (!btn || btn.dataset.secWired === '1') return;
        btn.dataset.secWired = '1';
        btn.addEventListener('click', () => {
            this._state.view = viewKey;
            this._loadCurrentView(root);
        });
    },

    _wirePager(root, selector, viewKey, host) {
        const pager = root.querySelector(selector);
        if (!pager || pager.dataset.secWired === '1') return;
        pager.dataset.secWired = '1';
        pager.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-sec-pager]');
            if (!btn || btn.disabled) return;
            const meta = this._getViewMeta(viewKey);
            let page = meta.page || 1;
            if (btn.dataset.secPager === 'prev') page = Math.max(1, page - 1);
            if (btn.dataset.secPager === 'next') page = page + 1;
            const url = securityDsapBuildUrl(viewKey, {
                page,
                perPage: meta.perPage,
                search: meta.search,
                eventType: viewKey === 'telemetry' ? meta.eventType : ''
            });
            host.navigate(url);
        });
    },

    _viewPagerPrefix(viewKey) {
        if (viewKey === 'honeypot') return 'secHoneypot';
        if (viewKey === 'telemetry') return 'secTelemetry';
        return 'secBlocked';
    },

    _wireClickMenus(root, host) {
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (!contextMenu) return;
        this._teardownClickMenus();
        const driver = this;

        ['blocked', 'honeypot', 'telemetry'].forEach((viewKey) => {
            const prefix = this._viewPagerPrefix(viewKey);
            const btn = root.querySelector(`#${prefix}PerPageBtn`);
            const selected = root.querySelector(`#${prefix}PerPageSelected`);
            const hidden = root.querySelector(`#${prefix}PerPageHidden`);
            if (!btn || !hidden) return;

            const config = {
                position: 'anchor',
                anchorAlign: 'start',
                maxHeight: 240,
                beforeShow: () => {
                    const meta = driver._getViewMeta(viewKey);
                    const current = String(meta.perPage || SECURITY_DEFAULT_PER_PAGE);
                    config.sections[0].items = SECURITY_PER_PAGE_OPTIONS.map((n) => ({
                        text: String(n),
                        action: 'select-per-page',
                        perPageValue: n,
                        viewKey,
                        loadfn: (item) => {
                            item.highlighted = String(item.perPageValue) === current;
                        }
                    }));
                },
                sections: [{ type: 'list', items: [] }],
                onAction: (action, target, item) => {
                    if (action !== 'select-per-page') return;
                    const val = item.perPageValue;
                    const meta = driver._getViewMeta(item.viewKey);
                    if (selected) selected.textContent = String(val);
                    hidden.value = String(val);
                    const url = securityDsapBuildUrl(item.viewKey, {
                        page: 1,
                        perPage: parseInt(val, 10),
                        search: meta.search,
                        eventType: item.viewKey === 'telemetry' ? meta.eventType : ''
                    });
                    host.navigate(url);
                }
            };
            this._attachClickMenu(btn, config);
        });

        const telEventBtn = root.querySelector('#secTelemetryEventBtn');
        const telEventSelected = root.querySelector('#secTelemetryEventSelected');
        const telEventHidden = root.querySelector('#secTelemetryEventHidden');
        if (telEventBtn && telEventHidden) {
            const telOptions = [
                { value: '', label: 'All events' },
                { value: 'login', label: 'Login' },
                { value: 'app', label: 'App Load' }
            ];
            const telConfig = {
                position: 'anchor',
                anchorAlign: 'start',
                maxHeight: 240,
                beforeShow: () => {
                    const current = driver._state.telemetry.meta.eventType || '';
                    telConfig.sections[0].items = telOptions.map((opt) => ({
                        text: opt.label,
                        action: 'select-telemetry-event',
                        eventValue: opt.value,
                        loadfn: (item) => {
                            item.highlighted = item.eventValue === current;
                        }
                    }));
                },
                sections: [{ type: 'list', items: [] }],
                onAction: (action, target, item) => {
                    if (action !== 'select-telemetry-event') return;
                    const meta = driver._state.telemetry.meta;
                    if (telEventSelected) telEventSelected.textContent = item.text;
                    telEventHidden.value = item.eventValue;
                    const url = securityDsapBuildUrl('telemetry', {
                        page: 1,
                        perPage: meta.perPage,
                        search: meta.search,
                        eventType: item.eventValue
                    });
                    host.navigate(url);
                }
            };
            this._attachClickMenu(telEventBtn, telConfig);
        }
    },

    _loadCurrentView(root) {
        if (this._state.view === 'home') void this._loadHome(root);
        else if (this._state.view === 'blocked') void this._loadBlocked(root);
        else if (this._state.view === 'honeypot') void this._loadHoneypot(root);
        else if (this._state.view === 'auth') void this._loadAuth(root);
        else if (this._state.view === 'telemetry') void this._loadTelemetry(root);
    },

    _updatePagerButtons(root, viewKey, meta) {
        const prefix = this._viewPagerPrefix(viewKey);
        const prev = root.querySelector(`#${prefix}Prev`);
        const next = root.querySelector(`#${prefix}Next`);
        if (prev) prev.disabled = meta.page <= 1;
        if (next) next.disabled = meta.page >= meta.totalPages;
    },

    async _ensureWs() {
        if (!wsClient?.isConnected()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Connection Error', 'WebSocket not connected', false, 5000, '<i class="fas fa-wifi"></i>');
            }
            return false;
        }
        return true;
    },

    _hideListStates(root, viewKey) {
        const cap = viewKey.charAt(0).toUpperCase() + viewKey.slice(1);
        root.querySelector(`#sec${cap}Loading`)?.classList.add('hidden');
        root.querySelector(`#sec${cap}Error`)?.classList.add('hidden');
        root.querySelector(`#sec${cap}TableWrap`)?.classList.add('hidden');
        root.querySelector(`#sec${cap}Empty`)?.classList.add('hidden');
        root.querySelector(`#sec${cap}EmptySearch`)?.classList.add('hidden');
    },

    async _loadBlocked(root) {
        const meta = this._state.blocked.meta;
        this._hideListStates(root, 'blocked');
        root.querySelector('#secBlockedLoading')?.classList.remove('hidden');
        root.querySelector('#secBlockedDetails')?.classList.add('hidden');
        this._setStatus(root, 'blocked', 'Loading blocked clients…', null);

        if (!(await this._ensureWs())) {
            root.querySelector('#secBlockedLoading')?.classList.add('hidden');
            this._setStatus(root, 'blocked', 'Connection unavailable — check WebSocket', 'error');
            return;
        }

        try {
            let items;
            let totalCount;
            let totalPages;
            let currentPage;

            if (meta.search) {
                const probe = await wsClient.getBlockedIPs(1, 15);
                if (!probe?.success) throw new Error('Failed to load blocked IPs');
                totalCount = probe.pagination?.totalCount || 0;
                const fetchLimit = Math.min(Math.max(totalCount, 1), SECURITY_SEARCH_FETCH_LIMIT);
                const response = totalCount > 15
                    ? await wsClient.getBlockedIPs(1, fetchLimit)
                    : probe;
                if (!response?.success) throw new Error('Failed to load blocked IPs');

                const q = meta.search.toLowerCase();
                const filtered = (response.blockedIPs || []).filter(
                    (ip) => ip.ip.includes(q) || String(ip.reason || '').toLowerCase().includes(q)
                );
                totalCount = filtered.length;
                totalPages = Math.max(1, Math.ceil(totalCount / meta.perPage));
                currentPage = Math.min(meta.page, totalPages);
                const offset = (currentPage - 1) * meta.perPage;
                items = filtered.slice(offset, offset + meta.perPage);
                meta.total = totalCount;
                meta.totalPages = totalPages;
                meta.page = currentPage;
            } else {
                const response = await wsClient.getBlockedIPs(meta.page, meta.perPage);
                if (!response?.success) throw new Error('Failed to load blocked IPs');
                items = response.blockedIPs || [];
                meta.total = response.pagination?.totalCount || 0;
                meta.totalPages = response.pagination?.totalPages || 1;
                meta.page = response.pagination?.currentPage || meta.page;
            }

            this._state.blocked.items = items;
            this._renderBlocked(root);
            this._setStatus(root, 'blocked', meta.total === 0 ? 'No clients are currently blocked' : `${meta.total} blocked client${meta.total === 1 ? '' : 's'} on record`, meta.total === 0 ? 'ok' : null);
        } catch (err) {
            console.error('[security-dsap] blocked load error:', err);
            root.querySelector('#secBlockedLoading')?.classList.add('hidden');
            root.querySelector('#secBlockedError')?.classList.remove('hidden');
            const errText = root.querySelector('#secBlockedErrorText');
            if (errText) errText.textContent = err.message || 'Failed to load blocked clients';
            this._setStatus(root, 'blocked', 'Failed to load blocked clients', 'error');
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to load blocked clients', false, 5000);
        } finally {
            root.querySelector('#secBlockedLoading')?.classList.add('hidden');
        }
    },

    _renderBlocked(root) {
        const meta = this._state.blocked.meta;
        const items = this._state.blocked.items;
        const tbody = root.querySelector('#secBlockedTableBody');
        const hasSearch = !!meta.search;

        root.querySelector('#secBlockedTotal').textContent = String(meta.total);
        root.querySelector('#secBlockedPage').textContent = String(meta.page);
        root.querySelector('#secBlockedTotalPages').textContent = String(meta.totalPages);

        const start = meta.total === 0 ? 0 : (meta.page - 1) * meta.perPage + 1;
        const end = Math.min(meta.page * meta.perPage, meta.total);
        root.querySelector('#secBlockedRange').textContent = meta.total === 0 ? '0–0' : `${start}–${end}`;
        root.querySelector('#secBlockedCount').textContent = String(meta.total);
        this._updatePagerButtons(root, 'blocked', meta);

        if (!items.length) {
            if (hasSearch && meta.total === 0) {
                root.querySelector('#secBlockedEmptySearch')?.classList.remove('hidden');
            } else {
                root.querySelector('#secBlockedEmpty')?.classList.remove('hidden');
            }
            return;
        }

        root.querySelector('#secBlockedTableWrap')?.classList.remove('hidden');
        if (!tbody) return;

        tbody.innerHTML = items.map((ip) => {
            const badge = securityDsapShortReason(ip.reason);
            const badgeClass = securityDsapBadgeClass(badge);
            return `
<tr data-sec-ip="${securityDsapEscapeAttr(ip.ip)}">
  <td class="sec-ip-cell">${securityDsapEscapeHtml(ip.ip)} <span class="sec-badge ${badgeClass}">${securityDsapEscapeHtml(badge)}</span></td>
  <td>${securityDsapEscapeHtml(ip.reason || '—')}</td>
  <td align="center">${ip.attempts || 0}</td>
  <td align="center">${securityDsapEscapeHtml(securityDsapFormatAge(ip.ageMinutes))}</td>
  <td class="sec-actions-cell">
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="details" title="Details"><i class="fas fa-info-circle"></i></button>
    <button type="button" class="sec-dsap-action-btn sec-btn-primary sec-btn-small" data-sec-action="unblock" title="Unblock"><i class="fas fa-unlock"></i></button>
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="export" title="Export to Gateway"><i class="fas fa-upload"></i></button>
  </td>
</tr>`;
        }).join('');
    },

    async _loadTelemetry(root) {
        const meta = this._state.telemetry.meta;
        this._hideListStates(root, 'telemetry');
        root.querySelector('#secTelemetryLoading')?.classList.remove('hidden');
        root.querySelector('#secTelemetryDetails')?.classList.add('hidden');
        this._setStatus(root, 'telemetry', 'Loading telemetry…', null);

        if (!(await this._ensureWs())) {
            root.querySelector('#secTelemetryLoading')?.classList.add('hidden');
            this._setStatus(root, 'telemetry', 'Connection unavailable — check WebSocket', 'error');
            return;
        }

        try {
            const response = await wsClient.getTelemetry(meta.page, meta.perPage, meta.search, meta.eventType);
            if (!response?.success) throw new Error('Failed to load telemetry');

            const items = response.events || [];
            meta.total = response.pagination?.totalCount || 0;
            meta.totalPages = response.pagination?.totalPages || 1;
            meta.page = response.pagination?.currentPage || meta.page;

            this._state.telemetry.items = items;
            this._renderTelemetry(root);
            this._setStatus(
                root,
                'telemetry',
                meta.total === 0 ? 'No telemetry events recorded yet' : `${meta.total} telemetry event${meta.total === 1 ? '' : 's'} on record`,
                meta.total === 0 ? 'ok' : null
            );
        } catch (err) {
            console.error('[security-dsap] telemetry load error:', err);
            root.querySelector('#secTelemetryLoading')?.classList.add('hidden');
            root.querySelector('#secTelemetryError')?.classList.remove('hidden');
            const errText = root.querySelector('#secTelemetryErrorText');
            if (errText) errText.textContent = err.message || 'Failed to load telemetry';
            this._setStatus(root, 'telemetry', 'Failed to load telemetry', 'error');
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to load telemetry', false, 5000);
        } finally {
            root.querySelector('#secTelemetryLoading')?.classList.add('hidden');
        }
    },

    _renderTelemetry(root) {
        const meta = this._state.telemetry.meta;
        const items = this._state.telemetry.items;
        const tbody = root.querySelector('#secTelemetryTableBody');
        const hasSearch = !!meta.search || !!meta.eventType;

        root.querySelector('#secTelemetryTotal').textContent = String(meta.total);
        root.querySelector('#secTelemetryPage').textContent = String(meta.page);
        root.querySelector('#secTelemetryTotalPages').textContent = String(meta.totalPages);

        const start = meta.total === 0 ? 0 : (meta.page - 1) * meta.perPage + 1;
        const end = Math.min(meta.page * meta.perPage, meta.total);
        root.querySelector('#secTelemetryRange').textContent = meta.total === 0 ? '0–0' : `${start}–${end}`;
        root.querySelector('#secTelemetryCount').textContent = String(meta.total);
        this._updatePagerButtons(root, 'telemetry', meta);

        if (!items.length) {
            if (hasSearch && meta.total === 0) {
                root.querySelector('#secTelemetryEmptySearch')?.classList.remove('hidden');
            } else {
                root.querySelector('#secTelemetryEmpty')?.classList.remove('hidden');
            }
            return;
        }

        root.querySelector('#secTelemetryTableWrap')?.classList.remove('hidden');
        if (!tbody) return;

        tbody.innerHTML = items.map((ev) => {
            const badgeClass = ev.eventType === 'app' ? 'telemetry-app' : 'telemetry-login';
            return `
<tr data-sec-telemetry-id="${securityDsapEscapeAttr(ev.id)}">
  <td>${securityDsapEscapeHtml(securityDsapFormatTimestamp(ev.recordedAt))}</td>
  <td align="center"><span class="sec-badge ${badgeClass}">${securityDsapEscapeHtml(securityDsapTelemetryEventLabel(ev.eventType))}</span></td>
  <td>${securityDsapEscapeHtml(ev.ip || '—')}</td>
  <td>${securityDsapEscapeHtml(ev.platform || '—')}</td>
  <td title="${securityDsapEscapeAttr(ev.userAgent || '')}">${securityDsapEscapeHtml(securityDsapShortUserAgent(ev.userAgent))}</td>
  <td align="center">${securityDsapEscapeHtml(ev.userType || '—')}</td>
  <td align="center">
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="telemetry-details" title="Details"><i class="fas fa-info-circle"></i></button>
  </td>
</tr>`;
        }).join('');
    },

    _showTelemetryDetails(root, eventId) {
        const panel = root.querySelector('#secTelemetryDetails');
        const body = root.querySelector('#secTelemetryDetailsBody');
        if (!panel || !body) return;

        const ev = (this._state.telemetry.items || []).find((item) => String(item.id) === String(eventId));
        if (!ev) return;

        panel.classList.remove('hidden');
        const screen = ev.screen || {};
        const features = ev.features || {};
        const storage = ev.storage || {};
        const sw = ev.serviceWorker || {};
        const conn = ev.connection || {};

        body.innerHTML = `
<div><strong>Event:</strong> ${securityDsapEscapeHtml(securityDsapTelemetryEventLabel(ev.eventType))}</div>
<div><strong>Recorded:</strong> ${securityDsapFormatTimestamp(ev.recordedAt)}</div>
<div><strong>Client time:</strong> ${securityDsapFormatTimestamp(ev.clientTimestamp)}</div>
<div><strong>Route:</strong> ${securityDsapEscapeHtml(ev.route || '—')}</div>
<div><strong>IP:</strong> ${securityDsapEscapeHtml(ev.ip || '—')}</div>
<div><strong>User type:</strong> ${securityDsapEscapeHtml(ev.userType || '—')}</div>
<div><strong>Session:</strong> ${securityDsapEscapeHtml(ev.sessionId || '—')}</div>
<div><strong>Platform:</strong> ${securityDsapEscapeHtml(ev.platform || '—')}</div>
<div><strong>Language:</strong> ${securityDsapEscapeHtml(ev.language || '—')}</div>
<div><strong>Timezone:</strong> ${securityDsapEscapeHtml(ev.timezone || '—')}</div>
<div><strong>Screen:</strong> ${securityDsapEscapeHtml(String(screen.width || '—'))} × ${securityDsapEscapeHtml(String(screen.height || '—'))}</div>
<div><strong>Online:</strong> ${ev.onLine ? 'Yes' : 'No'} · <strong>Cookies:</strong> ${ev.cookieEnabled ? 'Yes' : 'No'}</div>
<div><strong>User agent:</strong> ${securityDsapEscapeHtml(ev.userAgent || '—')}</div>
<div><strong>Connection:</strong> ${conn.effectiveType ? `${securityDsapEscapeHtml(conn.effectiveType)} (${securityDsapEscapeHtml(String(conn.downlink || '—'))} Mbps, RTT ${securityDsapEscapeHtml(String(conn.rtt || '—'))}ms)` : '—'}</div>
<div><strong>Service worker:</strong> ${sw.supported ? (sw.registered ? `Registered (${securityDsapEscapeHtml(sw.scope || '')})` : 'Supported, not registered') : 'Not supported'}</div>
<div><strong>Storage:</strong> local=${storage.localStorage ? 'yes' : 'no'}, session=${storage.sessionStorage ? 'yes' : 'no'}, indexedDB=${storage.indexedDB ? 'yes' : 'no'}</div>
<div><strong>Features:</strong> WebGL=${features.webGL ? 'yes' : 'no'}, WebP=${features.webp ? 'yes' : 'no'}, touch=${features.touch ? 'yes' : 'no'}, geolocation=${features.geolocation ? 'yes' : 'no'}</div>`;
    },

    async _showBlockedDetails(root, ip) {
        if (!(await this._ensureWs())) return;
        const panel = root.querySelector('#secBlockedDetails');
        const body = root.querySelector('#secBlockedDetailsBody');
        if (!panel || !body) return;
        panel.classList.remove('hidden');
        body.innerHTML = '<i class="fas fa-spinner-third fa-spin"></i> Loading details…';

        try {
            const response = await wsClient.getIPBlockingReasons(ip);
            if (!response?.success) throw new Error('Failed to load details');
            const r = response.reasons || {};
            body.innerHTML = `
<div><strong>IP:</strong> ${securityDsapEscapeHtml(ip)}</div>
<div><strong>Blocked:</strong> ${r.isBlocked ? 'Yes' : 'No'}${r.blockedReason ? ` — ${securityDsapEscapeHtml(r.blockedReason)}` : ''}</div>
<div><strong>Suspicious:</strong> ${r.isSuspicious ? 'Yes' : 'No'}${r.suspiciousAttempts ? ` (${r.suspiciousAttempts} attempts)` : ''}</div>
<div><strong>Invalid URL attempts:</strong> ${r.hasInvalidAttempts ? r.invalidAttempts : 0}</div>
${r.blockedAt ? `<div><strong>Blocked at:</strong> ${securityDsapFormatTimestamp(r.blockedAt)}</div>` : ''}
${r.lastInvalidAttempt ? `<div><strong>Last invalid attempt:</strong> ${securityDsapFormatTimestamp(r.lastInvalidAttempt)}</div>` : ''}`;
        } catch (err) {
            body.innerHTML = `<span class="sec-dsap-error-inline">Failed to load details for ${securityDsapEscapeHtml(ip)}</span>`;
        }
    },

    async _unblockIp(root, ip) {
        // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
        const ok = await showConfirmationDialog(`Unblock IP ${ip}?`, [
            { text: 'Unblock', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]);
        if (!ok || !(await this._ensureWs())) return;

        try {
            const response = await wsClient.unblockIP(ip);
            if (response?.success) {
                if (typeof showGlassToast === 'function') showGlassToast('success', 'Unblocked', `IP ${ip} unblocked`, false, 3000, '<i class="fas fa-unlock"></i>');
                root.querySelector('#secBlockedDetails')?.classList.add('hidden');
                void this._loadBlocked(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to unblock IP', false, 5000);
        }
    },

    async _exportIp(root, ip) {
        const ok = await showConfirmationDialog(
            `Export IP ${ip} to gateway? It will be removed from the block list in 1 hour.`,
            [
                { text: 'Export', value: true, className: 'btn-primary' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        if (!ok || !(await this._ensureWs())) return;

        try {
            const response = await wsClient.exportIPToGateway(ip);
            if (response?.success) {
                if (typeof showGlassToast === 'function') showGlassToast('success', 'Exported', response.message || 'IP exported', false, 5000);
                void this._loadBlocked(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to export IP', false, 5000);
        }
    },

    async _loadHome(root) {
        root.querySelector('#secHomeLoading')?.classList.remove('hidden');
        root.querySelector('#secHomeContent')?.classList.add('hidden');
        root.querySelector('#secHomeError')?.classList.add('hidden');
        this._setStatus(root, 'home', 'Loading dashboard…', null);

        if (!(await this._ensureWs())) {
            root.querySelector('#secHomeLoading')?.classList.add('hidden');
            this._setStatus(root, 'home', 'Connection unavailable — check WebSocket', 'error');
            return;
        }

        try {
            const startToday = securityDsapStartOfTodayMs();
            const [blockedResp, pathsResp, pinResp] = await Promise.all([
                wsClient.getBlockedIPs(1, SECURITY_SEARCH_FETCH_LIMIT),
                wsClient.getKnownBadPaths(1, SECURITY_SEARCH_FETCH_LIMIT, ''),
                wsClient.getPinSettings()
            ]);

            const blockedList = blockedResp?.success ? (blockedResp.blockedIPs || []) : [];
            const blockedToday = blockedList.filter((entry) => entry.blockedAt >= startToday).length;

            const pathList = pathsResp?.success ? (pathsResp.paths || []) : [];
            const honeypotToday = pathList.filter((entry) => (entry.firstSeen || entry.lastSeen || 0) >= startToday).length;

            const userLoginOn = pinResp?.success ? pinResp.userPinLoginEnabled !== false : null;

            root.querySelector('#secHomeBlockedToday').textContent = String(blockedToday);
            root.querySelector('#secHomeHoneypotToday').textContent = String(honeypotToday);

            const loginEl = root.querySelector('#secHomeUserLogin');
            if (loginEl) {
                if (userLoginOn === null) {
                    loginEl.textContent = '—';
                    loginEl.className = 'sec-dsap-stat-value';
                } else {
                    loginEl.textContent = userLoginOn ? 'Enabled' : 'Disabled';
                    loginEl.className = 'sec-dsap-stat-value ' + (userLoginOn ? 'sec-status-on' : 'sec-status-off');
                }
            }

            root.querySelector('#secHomeContent')?.classList.remove('hidden');
            this._setStatus(root, 'home', 'Security dashboard ready', 'ok');
        } catch (err) {
            console.error('[security-dsap] home load error:', err);
            root.querySelector('#secHomeError')?.classList.remove('hidden');
            const errText = root.querySelector('#secHomeErrorText');
            if (errText) errText.textContent = err.message || 'Failed to load dashboard';
            this._setStatus(root, 'home', 'Failed to load dashboard', 'error');
        } finally {
            root.querySelector('#secHomeLoading')?.classList.add('hidden');
        }
    },

    async _loadAuth(root) {
        await Promise.all([
            this._loadPins(root),
            this._loadKeychain(root),
            this._loadAppkeys(root)
        ]);
    },

    async _loadHoneypot(root) {
        const meta = this._state.honeypot.meta;
        this._hideListStates(root, 'honeypot');
        root.querySelector('#secHoneypotLoading')?.classList.remove('hidden');
        this._setStatus(root, 'honeypot', 'Loading honeypot URLs…', null);

        if (!(await this._ensureWs())) {
            root.querySelector('#secHoneypotLoading')?.classList.add('hidden');
            this._setStatus(root, 'honeypot', 'Connection unavailable — check WebSocket', 'error');
            return;
        }

        try {
            const response = await wsClient.getKnownBadPaths(meta.page, meta.perPage, meta.search);
            if (!response?.success) throw new Error('Failed to load paths');

            this._state.honeypot.items = response.paths || [];
            meta.total = response.pagination?.totalCount || 0;
            meta.totalPages = response.pagination?.totalPages || 1;
            meta.page = response.pagination?.currentPage || meta.page;
            this._renderHoneypot(root);
            this._setStatus(root, 'honeypot', meta.total === 0 ? 'No honeypot URLs recorded' : `${meta.total} captured URL${meta.total === 1 ? '' : 's'} on record`, meta.total === 0 ? 'ok' : null);
        } catch (err) {
            console.error('[security-dsap] honeypot load error:', err);
            root.querySelector('#secHoneypotLoading')?.classList.add('hidden');
            root.querySelector('#secHoneypotError')?.classList.remove('hidden');
            const errText = root.querySelector('#secHoneypotErrorText');
            if (errText) errText.textContent = err.message || 'Failed to load honeypot URLs';
            this._setStatus(root, 'honeypot', 'Failed to load honeypot URLs', 'error');
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to load honeypot URLs', false, 5000);
        } finally {
            root.querySelector('#secHoneypotLoading')?.classList.add('hidden');
        }
    },

    _renderHoneypot(root) {
        const meta = this._state.honeypot.meta;
        const items = this._state.honeypot.items;
        const tbody = root.querySelector('#secHoneypotTableBody');
        const hasSearch = !!meta.search;

        root.querySelector('#secHoneypotTotal').textContent = String(meta.total);
        root.querySelector('#secHoneypotPage').textContent = String(meta.page);
        root.querySelector('#secHoneypotTotalPages').textContent = String(meta.totalPages);

        const start = meta.total === 0 ? 0 : (meta.page - 1) * meta.perPage + 1;
        const end = Math.min(meta.page * meta.perPage, meta.total);
        root.querySelector('#secHoneypotRange').textContent = meta.total === 0 ? '0–0' : `${start}–${end}`;
        root.querySelector('#secHoneypotCount').textContent = String(meta.total);
        this._updatePagerButtons(root, 'honeypot', meta);

        if (!items.length) {
            if (hasSearch) {
                root.querySelector('#secHoneypotEmptySearch')?.classList.remove('hidden');
            } else {
                root.querySelector('#secHoneypotEmpty')?.classList.remove('hidden');
            }
            return;
        }

        root.querySelector('#secHoneypotTableWrap')?.classList.remove('hidden');
        if (!tbody) return;

        tbody.innerHTML = items.map((entry) => `
<tr data-sec-path="${securityDsapEscapeAttr(entry.path)}">
  <td class="sec-path-cell">${securityDsapEscapeHtml(entry.path)}</td>
  <td align="center">${entry.hits || 0}</td>
  <td align="center">${securityDsapEscapeHtml(securityDsapFormatAge(entry.ageMinutes))}</td>
  <td align="center">${entry.firstSeen ? securityDsapEscapeHtml(new Date(entry.firstSeen).toLocaleDateString()) : '—'}</td>
  <td class="sec-actions-cell">
    <button type="button" class="sec-dsap-action-btn sec-btn-danger sec-btn-small" data-sec-action="delete" title="Remove"><i class="fas fa-trash"></i></button>
  </td>
</tr>`).join('');

        tbody.querySelectorAll('[data-sec-action="delete"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const path = btn.closest('[data-sec-path]')?.dataset.secPath;
                if (path) void this._deleteHoneypotPath(root, path);
            });
        });
    },

    async _deleteHoneypotPath(root, path) {
        const ok = await showConfirmationDialog(`Remove known bad path?\n${path}`, [
            { text: 'Remove', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]);
        if (!ok || !(await this._ensureWs())) return;

        try {
            const response = await wsClient.deleteKnownBadPath(path);
            if (response?.success) {
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Path removed', false, 3000, '<i class="fas fa-trash"></i>');
                void this._loadHoneypot(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to remove path', false, 5000);
        }
    },

    async _clearAllPaths(root) {
        const ok = await showConfirmationDialog('Clear ALL known bad paths? This cannot be undone.', [
            { text: 'Clear All', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]);
        if (!ok || !(await this._ensureWs())) return;

        try {
            const response = await wsClient.clearKnownBadPaths();
            if (response?.success) {
                if (typeof showGlassToast === 'function') showGlassToast('success', null, response.message || 'Cleared', false, 5000, '<i class="fas fa-trash"></i>');
                void this._loadHoneypot(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to clear paths', false, 5000);
        }
    },

    async _loadPins(root) {
        root.querySelector('#secAuthPinsLoading')?.classList.remove('hidden');
        root.querySelector('#secAuthPinsContent')?.classList.add('hidden');
        root.querySelector('#secAuthPinsError')?.classList.add('hidden');
        this._setPinStatus(root, 'Loading PIN settings…', null);

        if (!(await this._ensureWs())) {
            root.querySelector('#secAuthPinsLoading')?.classList.add('hidden');
            this._setPinStatus(root, 'Connection unavailable — check WebSocket', 'error');
            return;
        }

        try {
            const response = await wsClient.getPinSettings();
            if (!response?.success) throw new Error('Failed to load PIN settings');
            this._state.pins = response;
            this._renderPins(root);
            this._setPinStatus(root, 'PIN access control ready', 'ok');
        } catch (err) {
            console.error('[security-dsap] pins load error:', err);
            root.querySelector('#secAuthPinsError')?.classList.remove('hidden');
            const errText = root.querySelector('#secAuthPinsErrorText');
            if (errText) errText.textContent = err.message || 'Failed to load PIN settings';
            this._setPinStatus(root, 'Failed to load PIN settings', 'error');
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to load PIN settings', false, 5000);
        } finally {
            root.querySelector('#secAuthPinsLoading')?.classList.add('hidden');
        }
    },

    _setPinStatus(root, message, tone) {
        const msgEl = root.querySelector('#secAuthPinStatusMessage');
        const boxEl = root.querySelector('#secAuthPinStatus');
        if (msgEl) msgEl.textContent = message;
        if (boxEl) {
            boxEl.classList.remove('sec-dsap-status-error', 'sec-dsap-status-ok');
            if (tone === 'error') boxEl.classList.add('sec-dsap-status-error');
            if (tone === 'ok') boxEl.classList.add('sec-dsap-status-ok');
        }
    },

    _renderPins(root) {
        const pins = this._state.pins;
        root.querySelector('#secAuthPinsContent')?.classList.remove('hidden');

        const toggle = root.querySelector('#secUserPinToggle');
        if (toggle) {
            const on = pins.userPinLoginEnabled !== false;
            toggle.setAttribute('data-state', on ? 'on' : 'off');
            toggle.innerHTML = on
                ? '<i class="fas fa-toggle-on"></i> Enabled'
                : '<i class="fas fa-toggle-off"></i> Disabled';
        }

        const adminStatus = root.querySelector('#secAdminPinStatus');
        const userStatus = root.querySelector('#secUserPinStatus');
        if (adminStatus) {
            adminStatus.textContent = pins.adminPinConfigured ? 'Configured' : 'Not set';
            adminStatus.className = 'sec-pin-status ' + (pins.adminPinConfigured ? 'configured' : 'not-set');
        }
        if (userStatus) {
            userStatus.textContent = pins.userPinConfigured ? 'Configured' : 'Not set';
            userStatus.className = 'sec-pin-status ' + (pins.userPinConfigured ? 'configured' : 'not-set');
        }
    },

    async _toggleUserPinLogin(root) {
        const pins = this._state.pins;
        const newEnabled = pins.userPinLoginEnabled === false;
        if (!(await this._ensureWs())) return;

        try {
            const response = await wsClient.setUserPinLoginEnabled(newEnabled);
            if (response?.success) {
                pins.userPinLoginEnabled = response.userPinLoginEnabled;
                this._renderPins(root);
                this._setPinStatus(root, response.message || 'User PIN login updated', 'ok');
                if (typeof showGlassToast === 'function') showGlassToast('success', null, response.message, false, 4000, '<i class="fas fa-key"></i>');
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to update setting', false, 5000);
        }
    },

    async _saveAdminPin(root) {
        const input = root.querySelector('#secAdminPinInput');
        const pin = input?.value?.trim();
        if (!pin) {
            if (typeof showGlassToast === 'function') showGlassToast('warning', null, 'Enter a new admin PIN first', false, 4000);
            return;
        }
        const ok = await showConfirmationDialog('Change admin PIN?', [
            { text: 'Save', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]);
        if (!ok || !(await this._ensureWs())) return;

        try {
            const response = await wsClient.setAdminPin(pin);
            if (response?.success) {
                input.value = '';
                this._state.pins.adminPinConfigured = true;
                this._renderPins(root);
                this._setPinStatus(root, 'Admin PIN updated', 'ok');
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Admin PIN updated', false, 4000, '<i class="fas fa-save"></i>');
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to save admin PIN', false, 5000);
        }
    },

    async _saveUserPin(root) {
        const input = root.querySelector('#secUserPinInput');
        const pin = input?.value?.trim();
        if (!pin) {
            if (typeof showGlassToast === 'function') showGlassToast('warning', null, 'Enter a new user PIN first', false, 4000);
            return;
        }
        const ok = await showConfirmationDialog('Change user PIN?', [
            { text: 'Save', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]);
        if (!ok || !(await this._ensureWs())) return;

        try {
            const response = await wsClient.setUserPin(pin);
            if (response?.success) {
                input.value = '';
                this._state.pins.userPinConfigured = true;
                this._renderPins(root);
                this._setPinStatus(root, 'User PIN updated', 'ok');
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'User PIN updated', false, 4000, '<i class="fas fa-save"></i>');
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to save user PIN', false, 5000);
        }
    },

    async _loadAppkeys(root) {
        root.querySelector('#secAppkeysLoading')?.classList.remove('hidden');
        root.querySelector('#secAppkeysTableWrap')?.classList.add('hidden');
        root.querySelector('#secAppkeysPendingWrap')?.classList.add('hidden');
        root.querySelector('#secAppkeysEmpty')?.classList.add('hidden');
        root.querySelector('#secAppkeysError')?.classList.add('hidden');
        this._setStatus(root, 'appkeys', 'Loading application keys…', null);

        if (!(await this._ensureWs())) {
            root.querySelector('#secAppkeysLoading')?.classList.add('hidden');
            this._setStatus(root, 'appkeys', 'Connection unavailable — check WebSocket', 'error');
            return;
        }

        try {
            const [keysResp, pendingResp, scopesResp] = await Promise.all([
                wsClient.listApplicationKeys(),
                wsClient.listApplicationAuthRequests('pending'),
                wsClient.getApplicationAuthScopes()
            ]);
            if (!keysResp?.success) throw new Error('Failed to load application keys');
            this._state.appkeys.keys = keysResp.keys || [];
            this._state.appkeys.pending = pendingResp?.requests || [];
            this._state.appkeys.scopes = scopesResp?.scopes || [];
            this._renderAppkeys(root);
            const activeCount = this._state.appkeys.keys.filter((k) => k.status === 'active' || k.status === 'refresh_required').length;
            this._setStatus(root, 'appkeys', `${this._state.appkeys.keys.length} key(s) on record (${activeCount} active)`, 'ok');
        } catch (err) {
            console.error('[security-dsap] appkeys load error:', err);
            root.querySelector('#secAppkeysError')?.classList.remove('hidden');
            const errText = root.querySelector('#secAppkeysErrorText');
            if (errText) errText.textContent = err.message || 'Failed to load application keys';
            this._setStatus(root, 'appkeys', 'Failed to load application keys', 'error');
        } finally {
            root.querySelector('#secAppkeysLoading')?.classList.add('hidden');
        }
    },

    _renderAppkeys(root) {
        const keys = this._state.appkeys.keys;
        const pending = this._state.appkeys.pending;
        const tbody = root.querySelector('#secAppkeysTableBody');
        const pendingBody = root.querySelector('#secAppkeysPendingBody');

        if (pending.length && pendingBody) {
            root.querySelector('#secAppkeysPendingWrap')?.classList.remove('hidden');
            pendingBody.innerHTML = pending.map((req) => `
<tr data-sec-appkey-req="${securityDsapEscapeAttr(req.id)}">
  <td>${securityDsapEscapeHtml(req.appName)}</td>
  <td align="center"><code>${securityDsapEscapeHtml(req.requestCode)}</code></td>
  <td class="sec-path-cell">${securityDsapEscapeHtml(req.userAgent)}</td>
  <td class="sec-actions-cell">
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="approve-appkey-req" title="Approve"><i class="fas fa-check"></i></button>
    <button type="button" class="sec-dsap-action-btn sec-btn-danger sec-btn-small" data-sec-action="deny-appkey-req" title="Deny"><i class="fas fa-times"></i></button>
  </td>
</tr>`).join('');
        } else {
            root.querySelector('#secAppkeysPendingWrap')?.classList.add('hidden');
        }

        if (!keys.length) {
            root.querySelector('#secAppkeysEmpty')?.classList.remove('hidden');
            return;
        }

        root.querySelector('#secAppkeysTableWrap')?.classList.remove('hidden');
        if (!tbody) return;

        tbody.innerHTML = keys.map((key) => {
            const statusClass = 'sec-status-' + String(key.status || 'active').replace(/[^a-z_]/g, '');
            const expires = key.isPerpetual ? 'Never' : securityDsapFormatTimestamp(key.expiresAt);
            const refreshBy = securityDsapFormatTimestamp(key.refreshBeforeAt);
            const scopes = (key.scopes || []).join(', ');
            const canRevoke = key.status === 'active' || key.status === 'refresh_required';
            return `
<tr data-sec-appkey-id="${securityDsapEscapeAttr(key.id)}">
  <td>${securityDsapEscapeHtml(key.appName)}<br><span class="sec-dsap-setting-hint">${securityDsapEscapeHtml(key.userAgent)}</span></td>
  <td><code>${securityDsapEscapeHtml(key.keyPrefix)}…</code></td>
  <td>${securityDsapEscapeHtml(scopes)}</td>
  <td align="center" class="${statusClass}">${securityDsapEscapeHtml(key.status)}</td>
  <td align="center">${securityDsapEscapeHtml(expires)}</td>
  <td align="center">${securityDsapEscapeHtml(refreshBy)}</td>
  <td class="sec-actions-cell">${canRevoke ? `<button type="button" class="sec-dsap-action-btn sec-btn-danger sec-btn-small" data-sec-action="revoke-appkey" title="Revoke"><i class="fas fa-ban"></i></button>` : '—'}</td>
</tr>`;
        }).join('');
    },

    _wireAppkeyCreateForm(root) {
        const scopes = this._state.appkeys.scopes;
        const list = root.querySelector('#secAppkeyScopesList');
        if (list && !list.dataset.secWired) {
            list.dataset.secWired = '1';
            list.innerHTML = scopes.map((s) =>
                `<span class="sec-scope-chip${this._state.appkeys.selectedScopes.includes(s.id) ? ' selected' : ''}" data-scope-id="${securityDsapEscapeAttr(s.id)}" title="${securityDsapEscapeAttr(s.description || '')}">${securityDsapEscapeHtml(s.label || s.id)}</span>`
            ).join('');
            list.addEventListener('click', (e) => {
                const chip = e.target.closest('[data-scope-id]');
                if (!chip) return;
                const id = chip.dataset.scopeId;
                let selected = this._state.appkeys.selectedScopes.slice();
                if (id === 'universal') {
                    selected = ['universal'];
                } else {
                    selected = selected.filter((s) => s !== 'universal');
                    if (selected.includes(id)) selected = selected.filter((s) => s !== id);
                    else selected.push(id);
                    if (!selected.length) selected = ['universal'];
                }
                this._state.appkeys.selectedScopes = selected;
                list.querySelectorAll('.sec-scope-chip').forEach((el) => {
                    el.classList.toggle('selected', selected.includes(el.dataset.scopeId));
                });
            });
        }

        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        this._wireAppkeyClickMenus(root, 'secAppkeyUserType', [
            { value: 'admin', label: 'Administrator' },
            { value: 'readonly', label: 'Read-only' }
        ], 'admin');
        this._wireAppkeyClickMenus(root, 'secAppkeyExpiry', [
            { value: 'perpetual', label: 'Perpetual' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '365', label: '1 year' }
        ], 'perpetual');
    },

    _wireAppkeyClickMenus(root, prefix, options, defaultVal) {
        const btn = root.querySelector(`#${prefix}Btn`);
        const selected = root.querySelector(`#${prefix}Selected`);
        const hidden = root.querySelector(`#${prefix}Hidden`);
        if (!btn || btn.dataset.secClickMenuWired === '1') return;
        btn.dataset.secClickMenuWired = '1';
        if (hidden) hidden.value = defaultVal;
        if (selected) selected.textContent = options.find((o) => o.value === defaultVal)?.label || defaultVal;

        const config = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 260,
            beforeShow: () => {
                const current = hidden?.value || defaultVal;
                config.sections[0].items = options.map((opt) => ({
                    text: opt.label,
                    action: 'select-appkey-option',
                    optionValue: opt.value,
                    loadfn: (item) => {
                        item.highlighted = item.optionValue === current;
                    }
                }));
            },
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-appkey-option') return;
                if (hidden) hidden.value = item.optionValue;
                if (selected) selected.textContent = item.text;
            }
        };
        this._attachClickMenu(btn, config);
    },

    _wireAppkeyDropdown(root, prefix, options, defaultVal) {
        /* replaced by _wireAppkeyClickMenus */
    },

    async _submitAppkeyCreate(root) {
        const appName = root.querySelector('#secAppkeyNameInput')?.value?.trim();
        const userAgent = root.querySelector('#secAppkeyUaInput')?.value?.trim();
        const userType = root.querySelector('#secAppkeyUserTypeHidden')?.value || 'admin';
        const expiry = root.querySelector('#secAppkeyExpiryHidden')?.value || 'perpetual';
        const refreshDays = parseInt(root.querySelector('#secAppkeyRefreshDaysInput')?.value || '30', 10);
        const scopes = this._state.appkeys.selectedScopes;

        if (!appName || !userAgent) {
            if (typeof showGlassToast === 'function') showGlassToast('warning', null, 'Application name and User-Agent are required', false, 4000);
            return;
        }
        if (!(await this._ensureWs())) return;

        try {
            const payload = {
                appName,
                userAgent,
                scopes,
                userType,
                perpetual: expiry === 'perpetual',
                refreshIntervalDays: refreshDays
            };
            if (expiry !== 'perpetual') payload.expiresInDays = parseInt(expiry, 10);

            const response = await wsClient.createApplicationKey(payload);
            if (!response?.success) throw new Error('Failed to create application key');

            const resultEl = root.querySelector('#secAppkeyCreateResult');
            if (resultEl) {
                resultEl.classList.remove('hidden');
                resultEl.innerHTML = `<strong>Copy this key now — it cannot be shown again:</strong><br><code>${securityDsapEscapeHtml(response.applicationKey)}</code>`;
            }
            if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Application key created', false, 4000, '<i class="fas fa-plug"></i>');
            void this._loadAppkeys(root);
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', err.message || 'Failed to create key', false, 5000);
        }
    },

    async _revokeAppkey(root, keyId) {
        const ok = await showConfirmationDialog('Revoke this application key? Connected clients will lose access.', [
            { text: 'Revoke', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]);
        if (!ok || !(await this._ensureWs())) return;

        try {
            const response = await wsClient.revokeApplicationKey(keyId);
            if (response?.success) {
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Application key revoked', false, 3000, '<i class="fas fa-ban"></i>');
                void this._loadAppkeys(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to revoke key', false, 5000);
        }
    },

    async _approveAppkeyRequest(root, requestId) {
        if (!(await this._ensureWs())) return;
        try {
            const response = await wsClient.approveApplicationAuthRequest(requestId);
            if (response?.success) {
                const msg = response.applicationKey
                    ? `Approved. Key (share with app): ${response.applicationKey}`
                    : 'Authorization approved';
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Request approved', false, 6000, '<i class="fas fa-check"></i>');
                await showConfirmationDialog(msg, [{ text: 'OK', value: true, className: 'btn-primary' }]);
                void this._loadAppkeys(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to approve request', false, 5000);
        }
    },

    async _denyAppkeyRequest(root, requestId) {
        if (!(await this._ensureWs())) return;
        try {
            const response = await wsClient.denyApplicationAuthRequest(requestId);
            if (response?.success) {
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Request denied', false, 3000);
                void this._loadAppkeys(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', 'Failed to deny request', false, 5000);
        }
    },

    _keychainKeyLabel(service, index) {
        if (index === null || index === undefined) return 'Select a key';
        const key = service?.keys?.find((k) => k.index === index);
        return key?.name || `Key ${index + 1}`;
    },

    _keychainFingerprint(service, index) {
        if (index === null || index === undefined) return '—';
        const key = service?.keys?.find((k) => k.index === index);
        return key?.fingerprint || '—';
    },

    _getKeychainChanges() {
        const kc = this._state.keychain;
        return Object.entries(kc.pendingSelections)
            .filter(([serviceId, index]) => {
                const original = kc.originalSelections[serviceId];
                return index !== null && index !== undefined && original !== index;
            })
            .map(([serviceId, index]) => ({ serviceId, index }));
    },

    _updateKeychainSaveButton(root) {
        const btn = root.querySelector('#secKeychainSave');
        if (btn) btn.disabled = this._getKeychainChanges().length === 0;
    },

    _setKeychainStatus(root, message, tone) {
        const msgEl = root.querySelector('#secKeychainStatusMessage');
        const boxEl = root.querySelector('#secKeychainStatus');
        if (msgEl) msgEl.textContent = message;
        if (boxEl) {
            boxEl.classList.remove('sec-dsap-status-error', 'sec-dsap-status-ok');
            if (tone === 'error') boxEl.classList.add('sec-dsap-status-error');
            if (tone === 'ok') boxEl.classList.add('sec-dsap-status-ok');
        }
    },

    async _unlockKeychainService(root, serviceId) {
        if (!serviceId) return;
        if (!(await this._ensureWs())) {
            this._setKeychainStatus(root, 'Connection unavailable — check WebSocket', 'error');
            return;
        }
        try {
            await wsClient.sendMessage('unlock_api_service', { service: serviceId });
            this._setKeychainStatus(root, `Unlocked ${serviceId}`, 'ok');
            await this._loadKeychain(root);
        } catch (err) {
            console.error('[security-dsap] unlock service error:', err);
            this._setKeychainStatus(root, err.message || 'Failed to unlock service', 'error');
        }
    },

    async _loadKeychain(root) {
        root.querySelector('#secKeychainLoading')?.classList.remove('hidden');
        root.querySelector('#secKeychainTableWrap')?.classList.add('hidden');
        root.querySelector('#secKeychainEmpty')?.classList.add('hidden');
        root.querySelector('#secKeychainError')?.classList.add('hidden');
        this._setKeychainStatus(root, 'Loading service keys…', null);

        if (!(await this._ensureWs())) {
            root.querySelector('#secKeychainLoading')?.classList.add('hidden');
            this._setKeychainStatus(root, 'Connection unavailable — check WebSocket', 'error');
            return;
        }

        try {
            const data = await wsClient.sendMessage('get_api_key_services', {});
            const services = Array.isArray(data?.services) ? data.services : [];
            const kc = this._state.keychain;
            kc.services = services;
            kc.originalSelections = {};
            kc.pendingSelections = {};
            services.forEach((service) => {
                const hasKeys = Array.isArray(service.keys) && service.keys.length > 0;
                const fallbackIndex = hasKeys && Number.isInteger(service.selectedIndex) ? service.selectedIndex : 0;
                kc.originalSelections[service.id] = hasKeys ? fallbackIndex : null;
                kc.pendingSelections[service.id] = hasKeys ? fallbackIndex : null;
            });
            this._renderKeychain(root);
            this._setKeychainStatus(root, services.length ? `${services.length} service provider(s) ready` : 'No service providers configured', services.length ? 'ok' : null);
        } catch (err) {
            console.error('[security-dsap] keychain load error:', err);
            root.querySelector('#secKeychainError')?.classList.remove('hidden');
            const errText = root.querySelector('#secKeychainErrorText');
            if (errText) errText.textContent = err.message || 'Failed to load service keys';
            this._setKeychainStatus(root, 'Failed to load service keys', 'error');
        } finally {
            root.querySelector('#secKeychainLoading')?.classList.add('hidden');
        }
    },

    _renderKeychain(root) {
        const kc = this._state.keychain;
        const tbody = root.querySelector('#secKeychainTableBody');
        if (!kc.services.length) {
            root.querySelector('#secKeychainEmpty')?.classList.remove('hidden');
            this._updateKeychainSaveButton(root);
            return;
        }

        root.querySelector('#secKeychainTableWrap')?.classList.remove('hidden');
        if (!tbody) return;

        this._clickMenuTargets = this._clickMenuTargets.filter((el) => {
            if (el?.classList?.contains('sec-keychain-select-btn')) {
                // contextMenu.detachClickMenuFromElement: public/scripts/comp/contextMenu.js
                contextMenu.detachClickMenuFromElement(el);
                return false;
            }
            return true;
        });

        tbody.innerHTML = kc.services.map((service) => {
            const sel = kc.pendingSelections[service.id];
            const label = service.missingKeys ? 'No keys configured' : this._keychainKeyLabel(service, sel);
            const fp = service.missingKeys ? '—' : this._keychainFingerprint(service, sel);
            const disabled = service.missingKeys ? ' disabled' : '';
            const isLocked = !!(service.lock && service.lock.locked);
            const lockBadge = isLocked
                ? `<br><span class="sec-keychain-lock-badge" title="Locked after repeated API errors (last HTTP ${securityDsapEscapeAttr(String(service.lock.lastStatus || '??'))})"><i class="fas fa-lock"></i> Locked — HTTP ${securityDsapEscapeHtml(String(service.lock.lastStatus || '??'))}</span>`
                : '';
            const unlockBtn = isLocked
                ? `<button type="button" class="sec-dsap-action-btn sec-btn-primary sec-btn-small" data-sec-action="keychain-unlock" title="Unlock service"><i class="fas fa-unlock"></i></button>`
                : '';
            return `<tr data-sec-keychain-service="${securityDsapEscapeAttr(service.id)}"${isLocked ? ' class="sec-keychain-row-locked"' : ''}>
  <td>${securityDsapEscapeHtml(service.label || service.id)}<br><span class="sec-dsap-setting-hint">${securityDsapEscapeHtml(service.description || '')}</span>${lockBadge}</td>
  <td>
    <button type="button" class="dsap-smf-btn dsap-smf-btn-small sec-keychain-select-btn"${disabled}>
      <span>${securityDsapEscapeHtml(label)}</span> <i class="fas fa-caret-down"></i>
    </button>
  </td>
  <td class="sec-keychain-fp">${securityDsapEscapeHtml(fp)}</td>
  <td class="sec-actions-cell">
    ${unlockBtn}
    <button type="button" class="sec-dsap-action-btn sec-btn-small" data-sec-action="keychain-edit" title="Edit active key"><i class="fas fa-pen"></i></button>
    <button type="button" class="sec-dsap-action-btn sec-btn-primary sec-btn-small" data-sec-action="keychain-add" title="Add key"><i class="fas fa-plus"></i></button>
  </td>
</tr>`;
        }).join('');

        this._wireKeychainSelectMenus(root);
        this._updateKeychainSaveButton(root);
    },

    _wireKeychainSelectMenus(root) {
        const driver = this;
        this._state.keychain.services.forEach((service) => {
            if (service.missingKeys) return;
            const row = root.querySelector(`[data-sec-keychain-service="${service.id}"]`);
            const btn = row?.querySelector('.sec-keychain-select-btn');
            if (!btn) return;

            const config = {
                position: 'anchor',
                anchorAlign: 'start',
                maxHeight: 280,
                beforeShow: () => {
                    const current = driver._state.keychain.pendingSelections[service.id];
                    config.sections[0].items = (service.keys || []).map((key) => ({
                        text: `${key.name || `Key ${key.index + 1}`} (${key.fingerprint || '••••'})`,
                        action: 'select-keychain-key',
                        serviceId: service.id,
                        keyIndex: key.index,
                        loadfn: (item) => {
                            item.highlighted = item.keyIndex === current;
                        }
                    }));
                },
                sections: [{ type: 'list', items: [] }],
                onAction: (action, target, item) => {
                    if (action !== 'select-keychain-key') return;
                    driver._state.keychain.pendingSelections[item.serviceId] = item.keyIndex;
                    const svc = driver._state.keychain.services.find((s) => s.id === item.serviceId);
                    const labelSpan = row.querySelector('.sec-keychain-select-btn span');
                    const fpCell = row.querySelector('.sec-keychain-fp');
                    if (labelSpan) labelSpan.textContent = driver._keychainKeyLabel(svc, item.keyIndex);
                    if (fpCell) fpCell.textContent = driver._keychainFingerprint(svc, item.keyIndex);
                    driver._updateKeychainSaveButton(root);
                }
            };
            this._attachClickMenu(btn, config);
        });
    },

    _openKeychainEditPanel(root, serviceId) {
        const kc = this._state.keychain;
        const service = kc.services.find((s) => s.id === serviceId);
        if (!service || service.missingKeys) {
            if (typeof showGlassToast === 'function') showGlassToast('warning', null, 'Add a key before editing', false, 4000);
            return;
        }
        const index = kc.pendingSelections[serviceId];
        if (index === null || index === undefined) return;

        kc.editServiceId = serviceId;
        kc.editKeyIndex = index;

        const title = root.querySelector('#secKeychainEditTitle');
        const nameInput = root.querySelector('#secKeychainEditName');
        const valueInput = root.querySelector('#secKeychainEditValue');
        if (title) title.textContent = `Edit Key — ${service.label || serviceId}`;
        if (nameInput) nameInput.value = this._keychainKeyLabel(service, index);
        if (valueInput) valueInput.value = '';

        root.querySelector('#secKeychainAddPanel')?.classList.add('hidden');
        root.querySelector('#secKeychainEditPanel')?.classList.remove('hidden');
    },

    _openKeychainAddPanel(root, serviceId) {
        const service = this._state.keychain.services.find((s) => s.id === serviceId);
        if (!service) return;

        this._state.keychain.addServiceId = serviceId;
        const title = root.querySelector('#secKeychainAddTitle');
        const nameInput = root.querySelector('#secKeychainAddName');
        const valueInput = root.querySelector('#secKeychainAddValue');
        if (title) title.textContent = `Add Key — ${service.label || serviceId}`;
        if (nameInput) nameInput.value = '';
        if (valueInput) valueInput.value = '';

        root.querySelector('#secKeychainEditPanel')?.classList.add('hidden');
        root.querySelector('#secKeychainAddPanel')?.classList.remove('hidden');
    },

    async _submitKeychainEdit(root) {
        const kc = this._state.keychain;
        const serviceId = kc.editServiceId;
        const index = kc.editKeyIndex;
        if (!serviceId || index === null || index === undefined) return;

        const name = root.querySelector('#secKeychainEditName')?.value?.trim();
        const apiKey = root.querySelector('#secKeychainEditValue')?.value?.trim();
        if (!name && !apiKey) {
            if (typeof showGlassToast === 'function') showGlassToast('warning', null, 'Enter a new name and/or key value', false, 4000);
            return;
        }
        if (!(await this._ensureWs())) return;

        try {
            const data = await wsClient.sendMessage('update_api_key', {
                service: serviceId,
                index,
                name: name || undefined,
                apiKey: apiKey || undefined
            });
            if (data?.success) {
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Service key updated', false, 4000, '<i class="fas fa-key-skeleton-left-right"></i>');
                root.querySelector('#secKeychainEditPanel')?.classList.add('hidden');
                kc.editServiceId = null;
                kc.editKeyIndex = null;
                await this._loadKeychain(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', err.message || 'Failed to update key', false, 5000);
        }
    },

    async _submitKeychainAdd(root) {
        const serviceId = this._state.keychain.addServiceId;
        if (!serviceId) return;

        const name = root.querySelector('#secKeychainAddName')?.value?.trim();
        const apiKey = root.querySelector('#secKeychainAddValue')?.value?.trim();
        if (!name || !apiKey) {
            if (typeof showGlassToast === 'function') showGlassToast('warning', null, 'Name and key value are required', false, 4000);
            return;
        }
        if (!(await this._ensureWs())) return;

        try {
            const data = await wsClient.sendMessage('add_api_key', {
                service: serviceId,
                name,
                apiKey
            });
            if (data?.success) {
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Service key added', false, 4000, '<i class="fas fa-key-skeleton-left-right"></i>');
                root.querySelector('#secKeychainAddPanel')?.classList.add('hidden');
                this._state.keychain.addServiceId = null;
                await this._loadKeychain(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', err.message || 'Failed to add key', false, 5000);
        }
    },

    async _saveKeychainSelections(root) {
        const changes = this._getKeychainChanges();
        if (!changes.length) return;

        const changeList = changes.map((change) => {
            const service = this._state.keychain.services.find((s) => s.id === change.serviceId);
            const key = service?.keys?.find((k) => k.index === change.index);
            return {
                serviceLabel: service?.label || change.serviceId,
                keyName: key?.name || `Key ${change.index + 1}`,
                fingerprint: key?.fingerprint || '••••',
                requiresRestart: service?.requiresRestart === true
            };
        });

        const needsRestart = changeList.some((c) => c.requiresRestart);
        let message = 'Apply keychain selection changes?<br><br>';
        changeList.forEach((change) => {
            const restartMarker = change.requiresRestart ? ' <span style="color: #ff8c00;">(requires reload)</span>' : '';
            message += ` • ${securityDsapEscapeHtml(change.serviceLabel)} → ${securityDsapEscapeHtml(change.keyName)} (${securityDsapEscapeHtml(change.fingerprint)})${restartMarker}<br>`;
        });

        const result = await showConfirmationDialog(message, [
            {
                text: needsRestart ? 'Apply & Reload' : 'Apply',
                value: 'apply',
                className: 'btn-primary',
                icon: needsRestart ? 'fas fa-arrows-rotate' : 'fas fa-save'
            },
            { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
        ]);
        if (result !== 'apply' || !(await this._ensureWs())) return;

        try {
            const data = await wsClient.sendMessage('update_api_key_selections', {
                updates: changes.map((c) => ({ service: c.serviceId, index: c.index }))
            });
            if (data?.success) {
                if (Array.isArray(data.restartedServices)) {
                    data.restartedServices.forEach((serviceId) => {
                        const service = this._state.keychain.services.find((s) => s.id === serviceId);
                        const label = service?.label || serviceId;
                        if (typeof showGlassToast === 'function') {
                            showGlassToast('success', null, `${label} restarted (keychain updated)`, false, undefined, '<i class="fas fa-arrows-rotate"></i>');
                        }
                    });
                }
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Keychain updated', false, 4000, '<i class="fas fa-key-skeleton-left-right"></i>');
                await this._loadKeychain(root);
            }
        } catch (err) {
            if (typeof showGlassToast === 'function') showGlassToast('error', 'Error', err.message || 'Failed to save selections', false, 5000);
        }
    }
};

function registerSecurityCenterDsapApplet() {
    // registerDsap: public/scripts/comp/dsapRegistry.js
    if (typeof registerDsap !== 'function') return;

    registerDsap({
        url: SECURITY_DSAP_URL,
        aliases: [
            SECURITY_DSAP_URL_LEGACY,
            `dsap://${SECURITY_DSAP_URL}`,
            `dsap://${SECURITY_DSAP_URL_LEGACY}`,
            'en.grimoire.jp/applets/security',
            'applet.grimoire.jp/security'
        ],
        theme: 'dsap-smf',
        getContent() {
            return {
                html: securityDsapBuildHtml(),
                css: securityDsapScopedCss,
                drivers: securityDsapDriver,
                baseBackground: '#eeeeee'
            };
        }
    });
}

function openSecurityCenterDsap(view) {
    const target = securityDsapBuildUrl(view || 'home');
    // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
    if (typeof openDsapInGrimoire === 'function') {
        openDsapInGrimoire(target);
        return;
    }
    let tries = 0;
    const t = setInterval(() => {
        tries += 1;
        if (typeof openDsapInGrimoire === 'function') {
            clearInterval(t);
            openDsapInGrimoire(target);
        } else if (tries > 20) {
            clearInterval(t);
        }
    }, 60);
}

registerSecurityCenterDsapApplet();
