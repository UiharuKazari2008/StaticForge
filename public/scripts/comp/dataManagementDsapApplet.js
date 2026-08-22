/**
 * Data Management DSAP — data.dreamscape.jp
 * Status dashboard, workspaces, favorites, and stubs for spellbook / text expanders.
 * Depends on: dsapRegistry.js, dsapSmfMarkup.js, workspaceUtils.js, textReplacementManager.js
 */

const DATA_DSAP_URL = 'data.dreamscape.jp';
const DATA_ISPY_URL = 'ispy.dreamscape.jp';
const DATA_DSAP_TAB_LABELS = {
    status: 'Status',
    workspaces: 'Workspaces',
    spellbook: 'Spellbook',
    expanders: 'Expanders',
    favorites: 'Favorites',
    replication: 'Replication',
    search: 'Search'
};
const DATA_DSAP_RESERVED_SEGMENTS = new Set(['status', 'workspaces', 'spellbook', 'expanders', 'favorites', 'replication', 'search']);

const REPLICATION_DSAP_TRANSFER_MODES = [
    { id: 'tape-stream-compressed', label: 'Tape Stream (Compressed)' },
    { id: 'tape-stream', label: 'Tape Stream' },
    { id: 'blocks', label: 'Blocks (slow)' }
];
const REPLICATION_DSAP_BLOCKS_WARNING = 'Transforming cargo as Blocks (file-by-file) may be extremely slow for large galleries. Prefer Tape Stream (Compressed) unless you need a single file.';
const REPLICATION_DSAP_GALLERY_SHARED_OPTIONS = [
    { id: 'manual', label: 'Manual (per-session toggle)' },
    { id: 'always', label: 'Always show shared gallery' },
    { id: 'never', label: 'Never show shared gallery' }
];
const REPLICATION_DSAP_CONNECTIVITY_OPTIONS = [
    { id: 'normal', label: 'Normal' },
    { id: 'airgapped', label: 'Airgapped' },
    { id: 'delegated-only', label: 'Delegated only' }
];
const REPLICATION_DSAP_CLONE_OPTIONS = [
    { key: 'workspaceImages', label: 'Workspace Images' },
    { key: 'previewCache', label: 'Preview Cache' },
    { key: 'imageMetadata', label: 'Image Metadata', hint: 'Auto-included with Preview Cache' },
    { key: 'referenceBlobs', label: 'Reference blobs' },
    { key: 'vfsUserFiles', label: 'VFS user files' },
    { key: 'wikiData', label: 'Wiki Data' },
    { key: 'wikiMedia', label: 'Wiki Media' },
    { key: 'autoComplete', label: 'AutoComplete Service' }
];
const REPLICATION_DSAP_DEFAULT_CLONE_PROFILE = {
    wikiData: true,
    wikiMedia: false,
    autoComplete: true,
    workspaceImages: false,
    previewCache: true,
    imageMetadata: true,
    referenceBlobs: false,
    vfsUserFiles: false
};

function dataMgmtDsapEscapeHtml(text) {
    if (typeof dsapSmfEscapeHtml === 'function') return dsapSmfEscapeHtml(text);
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function dataMgmtDsapEscapeAttr(text) {
    if (typeof dsapSmfEscapeAttr === 'function') return dsapSmfEscapeAttr(text);
    return String(text || '').replace(/"/g, '&quot;');
}

function dataMgmtDsapResolveActiveTab(host) {
    const segments = host.getPathSegments();
    const first = segments[0] || 'status';
    if (DATA_DSAP_RESERVED_SEGMENTS.has(first)) return first;
    return 'status';
}

function dataMgmtDsapBuildTabUrl(tabId) {
    if (tabId === 'search') return `dsap://${DATA_ISPY_URL}/`;
    if (!tabId || tabId === 'status') return `dsap://${DATA_DSAP_URL}/`;
    if (tabId === 'replication') return `dsap://${DATA_DSAP_URL}/replication`;
    return `dsap://${DATA_DSAP_URL}/${tabId}`;
}

const REPLICATION_DSAP_SUB_ROUTES = new Set(['configuration', 'upsert', 'sync', 'setup', 'bundle', 'progress']);
const REPLICATION_DSAP_SUB_LABELS = {
    home: 'Replication',
    configuration: 'Configuration',
    upsert: 'Upsert Cargo',
    sync: 'Sync from Master',
    setup: 'Separation Setup',
    bundle: 'Separation Bundle',
    progress: 'Operation Progress'
};

const replicationDsapLiveProgress = {
    active: false,
    operation: '',
    phase: '',
    current: 0,
    total: 0,
    path: ''
};

function replicationDsapGetLiveProgress() {
    return { ...replicationDsapLiveProgress };
}

function replicationDsapApplyProgressPush(data) {
    if (!data) return;
    replicationDsapLiveProgress.active = true;
    if (data.phase) replicationDsapLiveProgress.phase = data.phase;
    if (typeof data.current === 'number') replicationDsapLiveProgress.current = data.current;
    if (typeof data.total === 'number') replicationDsapLiveProgress.total = data.total;
    if (data.path) replicationDsapLiveProgress.path = data.path;
    // updateReplicationTrayIndicator: public/scripts/comp/trayIndicators.js
    if (typeof updateReplicationTrayIndicator === 'function') {
        updateReplicationTrayIndicator(replicationDsapGetLiveProgress());
    }
}

function replicationDsapApplyMaintenancePush(data) {
    if (!data) return;
    if (data.active) {
        replicationDsapLiveProgress.active = true;
        replicationDsapLiveProgress.operation = data.operation || data.reason || 'active';
        if (typeof updateReplicationTrayIndicator === 'function') {
            updateReplicationTrayIndicator(replicationDsapGetLiveProgress());
        }
        return;
    }
    replicationDsapLiveProgress.active = false;
    replicationDsapLiveProgress.operation = '';
    replicationDsapLiveProgress.phase = '';
    replicationDsapLiveProgress.current = 0;
    replicationDsapLiveProgress.total = 0;
    replicationDsapLiveProgress.path = '';
    if (typeof updateReplicationTrayIndicator === 'function') {
        updateReplicationTrayIndicator(null);
    }
}

function dataMgmtDsapResolveReplicationSubRoute(host) {
    const segments = host.getPathSegments();
    if (segments[0] !== 'replication') return 'home';
    const sub = segments[1] || '';
    if (sub === 'bundle') return 'setup';
    if (!sub) return 'home';
    if (REPLICATION_DSAP_SUB_ROUTES.has(sub)) return sub;
    return 'home';
}

function dataMgmtDsapBuildReplicationUrl(subRoute) {
    const base = `dsap://${DATA_DSAP_URL}/replication`;
    if (!subRoute || subRoute === 'home') return base;
    return `${base}/${subRoute}`;
}

function dataMgmtDsapBuildTabBar(activeTabId) {
    return dsapSmfBuildTabBar([
        { id: 'status', label: 'Status', icon: 'fas fa-gauge-high' },
        { id: 'workspaces', label: 'Workspaces', icon: 'fas fa-planet-ringed' },
        { id: 'spellbook', label: 'Spellbook', icon: 'fas fa-book-spells' },
        { id: 'expanders', label: 'Expanders', icon: 'fas fa-book-font' },
        { id: 'favorites', label: 'Favorites', icon: 'fas fa-star' },
        { id: 'replication', label: 'Replication', icon: 'fas fa-clone' },
        { id: 'search', label: 'Search', icon: 'fas fa-search' }
    ], activeTabId, { tabBarId: 'dataMgmtTabBar', dataAttr: 'data-data-tab' });
}

function dataMgmtDsapFormatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return Number(num).toLocaleString('en-US');
}

function dataMgmtDsapFormatSizeString(sizeStr) {
    if (!sizeStr || typeof sizeStr !== 'string') return sizeStr;
    if (sizeStr === 'Unknown' || sizeStr === 'N/A') return sizeStr;
    return sizeStr.replace(/(\d+\.?\d*)\s*(MB|GB|TB|KB|B)/gi, (match, number, unit) => {
        const num = parseFloat(number);
        if (isNaN(num)) return match;
        return `${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${unit}`;
    });
}

function dataMgmtDsapBuildPieSvg(workspaces) {
    const rows = (workspaces || []).filter((w) => (w.images || 0) > 0);
    const total = rows.reduce((sum, w) => sum + (w.images || 0), 0);
    if (!total) {
        return '<div class="data-mgmt-pie-empty">No workspace generations yet</div>';
    }

    const cx = 100;
    const cy = 100;
    const r = 88;
    let angle = -Math.PI / 2;
    const paths = rows.map((ws) => {
        const value = ws.images || 0;
        const sliceAngle = (value / total) * Math.PI * 2;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        angle += sliceAngle;
        const x2 = cx + r * Math.cos(angle);
        const y2 = cy + r * Math.sin(angle);
        const large = sliceAngle > Math.PI ? 1 : 0;
        const color = dataMgmtDsapEscapeAttr(ws.color || '#666');
        const name = dataMgmtDsapEscapeHtml(ws.name || 'Workspace');
        const count = dataMgmtDsapFormatNumber(value);
        const pct = ((value / total) * 100).toFixed(1);
        const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
        return `<path d="${d}" fill="${color}" class="data-mgmt-pie-slice"><title>${name}: ${count} (${pct}%)</title></path>`;
    });

    const legend = rows.map((ws) => {
        const color = dataMgmtDsapEscapeAttr(ws.color || '#666');
        const name = dataMgmtDsapEscapeHtml(ws.name || 'Workspace');
        const count = dataMgmtDsapFormatNumber(ws.images || 0);
        const pct = (((ws.images || 0) / total) * 100).toFixed(1);
        return `<div class="data-mgmt-pie-legend-item"><span class="data-mgmt-pie-swatch" style="background-color:${color}"></span><span class="data-mgmt-pie-legend-label">${name}</span><span class="data-mgmt-pie-legend-value">${count} (${pct}%)</span></div>`;
    }).join('');

    return `<div class="data-mgmt-pie-wrap">
  <svg viewBox="0 0 200 200" class="data-mgmt-pie-chart" role="img" aria-label="Workspace generation distribution">${paths.join('')}</svg>
  <div class="data-mgmt-pie-legend">${legend}</div>
</div>`;
}

function dataMgmtDsapBuildWorkspacesTableHtml(workspaces) {
    if (!workspaces || !workspaces.length) {
        return '<p class="data-mgmt-muted">No workspace data available</p>';
    }

    let rows = '';
    workspaces.forEach((workspace) => {
        const color = dataMgmtDsapEscapeAttr(workspace.color || '#000');
        const name = dataMgmtDsapEscapeHtml(workspace.name || 'Unknown');
        rows += '<tr>';
        rows += '<td class="data-mgmt-ws-name-cell">';
        rows += `<span class="workspace-color-indicator" style="background-color: ${color}; margin-right: 0.5rem;"></span>`;
        rows += `<span class="workspace-name">${name}</span>`;
        rows += '</td>';
        rows += `<td class="data-mgmt-ws-col">${dataMgmtDsapFormatNumber(workspace.images || 0)}</td>`;
        rows += `<td class="data-mgmt-ws-col">${dataMgmtDsapFormatNumber(workspace.references || 0)}</td>`;
        rows += `<td class="data-mgmt-ws-col">${dataMgmtDsapFormatNumber(workspace.notes || 0)}</td>`;
        rows += `<td class="data-mgmt-ws-col">${dataMgmtDsapFormatSizeString(workspace.diskUsage || '0 MB')}</td>`;
        rows += '</tr>';
    });

    return `<table class="data-mgmt-workspaces-table">
  <thead>
    <tr>
      <th class="data-mgmt-ws-name-header">Name</th>
      <th class="data-mgmt-ws-col"><i class="fa-light fa-film-canister" title="Generations"></i></th>
      <th class="data-mgmt-ws-col"><i class="fa-light fa-swatchbook" title="References"></i></th>
      <th class="data-mgmt-ws-col"><i class="fa-light fa-notebook" title="Notes"></i></th>
      <th class="data-mgmt-ws-col"><i class="fa-light fa-hard-drive" title="Disk usage"></i></th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function dataMgmtDsapFormatTierLabel(tier) {
    if (tier === 3) return 'Opus';
    if (tier === 2) return 'Scroll';
    if (tier === 1) return 'Tablet';
    if (tier === 0) return 'Free';
    if (tier == null || tier === 'Unknown') return '—';
    return 'Enterprise';
}

function dataMgmtDsapIsUserDataValid(user) {
    if (!user) return false;
    if (user.valid === false || user.userValid === false) return false;
    if (user.error && user.ok !== true) return false;
    return user.ok === true;
}

function dataMgmtDsapIsBalanceDataValid(balance, user) {
    if (!balance) return false;
    if (balance.valid === false || balance.balanceValid === false) return false;
    if (balance.ok === false) return false;
    if (balance.totalCredits === -1) return false;
    if (user && (user.valid === false || user.userValid === false)) return false;
    if (balance.valid === true || balance.balanceValid === true) return true;
    if (user && user.ok !== true) return false;
    return true;
}

function dataMgmtDsapResolveAccountIdentity(user) {
    if (!user || !dataMgmtDsapIsUserDataValid(user)) return '—';
    const identity = user.email || user.username || user.accessIdentifier || user.name;
    return identity ? String(identity) : '—';
}

function dataMgmtDsapResolveBanMessage(user, optionsData) {
    const msg = user?.banMessage || optionsData?.banMessage || user?.ban?.message || user?.subscription?.banMessage;
    return msg ? String(msg).trim() : '';
}

function dataMgmtDsapResolveAccountStanding(user, balance, optionsData) {
    if (optionsData?.accountDataDeferred) {
        return { label: 'Account data deferred', tone: 'warn' };
    }
    if (optionsData?.userDataValid === false) {
        const label = optionsData.userDataError || optionsData.accountStanding || 'Account data unavailable';
        return { label: String(label), tone: 'error' };
    }

    const explicit = user?.accountStanding || optionsData?.accountStanding;
    if (explicit) {
        const normalized = String(explicit).toLowerCase();
        let tone = '';
        if (/ban|suspend|lock|denied|fail|unavail|error|invalid/.test(normalized)) tone = 'error';
        else if (/grace|warn|expir|inactive|defer/.test(normalized)) tone = 'warn';
        else if (/active|ok|good|valid/.test(normalized)) tone = 'ok';
        return { label: String(explicit), tone };
    }

    const banMessage = dataMgmtDsapResolveBanMessage(user, optionsData);
    if (banMessage || user?.banned || user?.isBanned || user?.subscription?.banned) {
        return { label: 'Banned', tone: 'error' };
    }

    if (!user) {
        return { label: 'Account data unavailable', tone: 'error' };
    }

    if (user.valid === false || user.userValid === false) {
        return { label: 'Account data deferred', tone: 'warn' };
    }

    if (user.ok === false) {
        if (user.reason === 'missing_api_key') {
            return { label: 'NovelAI API key not configured', tone: 'error' };
        }
        if (user.reason === 'service_locked') {
            return { label: 'Upstream unavailable (service locked)', tone: 'error' };
        }
        if (user.statusCode === 401 || user.statusCode === 403) {
            return { label: 'Authentication failed', tone: 'error' };
        }
        return {
            label: 'Upstream unavailable',
            tone: 'error',
            detail: user.error || null
        };
    }

    const sub = user.subscription;
    if (sub?.gracePeriod || optionsData?.gracePeriod || sub?.inGracePeriod) {
        return { label: 'Grace period', tone: 'warn' };
    }
    if (sub && sub.active === false) {
        return { label: 'Subscription inactive', tone: 'warn' };
    }

    if (dataMgmtDsapIsUserDataValid(user)) {
        return { label: 'Active', tone: 'ok' };
    }

    return { label: 'Unknown', tone: 'warn' };
}

function dataMgmtDsapFormatBalanceCell(balance, field, valid) {
    if (!valid) return '—';
    const raw = balance?.[field];
    if (raw == null || Number.isNaN(Number(raw))) return '—';
    return dataMgmtDsapFormatNumber(raw);
}

function dataMgmtDsapBuildAccountSectionHtml() {
    return `${dsapSmfBuildSectionHdr('Account Information')}
<div id="dataMgmtAccountHost" class="data-mgmt-account-host">
  ${dsapSmfBuildStatusBox('<span id="dataMgmtAccountStanding">Loading…</span>', 'dataMgmtAccountStandingBox', 'dataMgmtAccountStanding')}
  ${dsapSmfBuildStatsTable([
        { label: 'Fixed Anlas', valueHtml: '<span id="dataMgmtBalanceFixed">—</span>', width: '33%' },
        { label: 'Paid Anlas', valueHtml: '<span id="dataMgmtBalancePaid">—</span>', width: '33%' },
        { label: 'Total Anlas', valueHtml: '<span id="dataMgmtBalanceTotal">—</span>', width: '34%' }
    ], 'dataMgmtBalanceStats')}
  <table class="data-mgmt-account-info-table" cellspacing="0" cellpadding="4" width="100%" border="1">
    <tbody>
      <tr><td class="data-mgmt-account-info-label">Subscription</td><td id="dataMgmtAccountTier" class="data-mgmt-account-info-value">—</td></tr>
      <tr><td class="data-mgmt-account-info-label">Account</td><td id="dataMgmtAccountIdentity" class="data-mgmt-account-info-value">—</td></tr>
      <tr><td class="data-mgmt-account-info-label">Renews</td><td id="dataMgmtAccountExpiry" class="data-mgmt-account-info-value">—</td></tr>
    </tbody>
  </table>
  <div id="dataMgmtOpusUsageHost" class="data-mgmt-opus-usage-host hidden">
    ${dsapSmfBuildSectionHdr('Opus Usage')}
    ${dsapSmfBuildStatsTable([
        { label: 'Usage', valueHtml: '<span id="dataMgmtOpusUsageValue">—</span>', width: '100%' }
    ], 'dataMgmtOpusUsageStats')}
    <div class="data-mgmt-opus-usage-bar-wrap">
      <div class="token-progress-bar data-mgmt-opus-usage-bar">
        <div id="dataMgmtOpusUsageFill" class="token-progress-fill"></div>
      </div>
    </div>
  </div>
  <div id="dataMgmtBanMessageHost" class="data-mgmt-ban-host hidden"></div>
</div>`;
}

function dataMgmtDsapRenderAccountSection(root) {
    const standingEl = root.querySelector('#dataMgmtAccountStanding');
    const standingBox = root.querySelector('#dataMgmtAccountStandingBox');
    const fixedEl = root.querySelector('#dataMgmtBalanceFixed');
    const paidEl = root.querySelector('#dataMgmtBalancePaid');
    const totalEl = root.querySelector('#dataMgmtBalanceTotal');
    const tierEl = root.querySelector('#dataMgmtAccountTier');
    const identityEl = root.querySelector('#dataMgmtAccountIdentity');
    const expiryEl = root.querySelector('#dataMgmtAccountExpiry');
    const banHost = root.querySelector('#dataMgmtBanMessageHost');
    if (!standingEl || !fixedEl || !paidEl || !totalEl) return;

    const user = window.optionsData?.user || null;
    const balance = window.optionsData?.balance || null;
    const accountUsable = !window.optionsData?.accountDataDeferred && window.optionsData?.userDataValid !== false;
    const userValid = accountUsable && dataMgmtDsapIsUserDataValid(user);
    const balanceValid = accountUsable && dataMgmtDsapIsBalanceDataValid(balance, user);
    const standing = dataMgmtDsapResolveAccountStanding(user, balance, window.optionsData);

    standingEl.textContent = standing.label;
    if (standing.detail) standingEl.title = standing.detail;
    else standingEl.title = '';
    if (standingBox) {
        standingBox.classList.remove('dsap-smf-status-ok', 'dsap-smf-status-error');
        if (standing.tone === 'ok') standingBox.classList.add('dsap-smf-status-ok');
        else if (standing.tone === 'error') standingBox.classList.add('dsap-smf-status-error');
    }

    fixedEl.textContent = dataMgmtDsapFormatBalanceCell(balance, 'fixedTrainingStepsLeft', balanceValid);
    paidEl.textContent = dataMgmtDsapFormatBalanceCell(balance, 'purchasedTrainingSteps', balanceValid);
    totalEl.textContent = dataMgmtDsapFormatBalanceCell(balance, 'totalCredits', balanceValid);

    if (tierEl) {
        if (userValid && user?.subscription?.tier !== undefined) {
            tierEl.textContent = dataMgmtDsapFormatTierLabel(user.subscription.tier);
        } else {
            tierEl.textContent = '—';
        }
    }

    if (identityEl) {
        const identity = dataMgmtDsapResolveAccountIdentity(user);
        identityEl.textContent = identity;
        identityEl.title = identity !== '—' ? identity : '';
    }

    if (expiryEl) {
        if (userValid && user?.subscription?.expiresAt) {
            // getSubscriptionRenewalDisplayData: public/scripts/comp/trayIndicators.js
            const renewalData = getSubscriptionRenewalDisplayData(user.subscription.expiresAt);
            expiryEl.textContent = renewalData.renewalDateTimeStr;
            expiryEl.title = renewalData.timeRemaining;
        } else {
            expiryEl.textContent = '—';
            expiryEl.title = '';
        }
    }

    if (banHost) {
        const banMessage = dataMgmtDsapResolveBanMessage(user, window.optionsData);
        if (banMessage) {
            banHost.classList.remove('hidden');
            banHost.innerHTML = dsapSmfBuildStatusBox(
                `<span class="data-mgmt-ban-label">Ban notice</span><div class="data-mgmt-ban-text">${dataMgmtDsapEscapeHtml(banMessage)}</div>`,
                'dataMgmtBanMessageBox',
                'dataMgmtBanMessageText'
            );
            const banBox = banHost.querySelector('#dataMgmtBanMessageBox');
            if (banBox) banBox.classList.add('dsap-smf-status-error');
        } else {
            banHost.classList.add('hidden');
            banHost.innerHTML = '';
        }
    }

    // usageToolManager: public/scripts/comp/usageToolManager.js
    usageToolManager.fillDataMgmtAccountUsage();
}

function dataMgmtDsapRefreshAccountIfPresent() {
    const host = document.getElementById('dataMgmtAccountHost');
    if (!host) return;
    const root = host.closest('[data-dsap="data-mgmt"]');
    if (root) dataMgmtDsapRenderAccountSection(root);
}

function dataMgmtDsapBuildStorageTableHtml(usage) {
    if (!usage) return '<p class="data-mgmt-muted">Storage breakdown unavailable</p>';

    const rows = [
        { label: 'Workspaces', value: usage.workspaceImages },
        { label: 'Previews', value: usage.previewImages },
        { label: 'References', value: usage.referenceItems },
        { label: 'Databases', value: usage.databases },
        { label: 'Wiki Files', value: usage.wikiFiles }
    ].filter((row) => row.value);

    if (!rows.length) return '<p class="data-mgmt-muted">No storage data available</p>';

    const body = rows.map((row) => `<tr><td class="data-mgmt-storage-label">${dataMgmtDsapEscapeHtml(row.label)}</td><td class="data-mgmt-storage-value">${dataMgmtDsapFormatSizeString(row.value)}</td></tr>`).join('');

    return `<table class="data-mgmt-storage-table">
  <thead><tr><th colspan="2">Storage Breakdown</th></tr></thead>
  <tbody>${body}</tbody>
</table>`;
}

function dataMgmtDsapBuildStatusHtml() {
    return `${dataMgmtDsapBuildAccountSectionHtml()}
${dsapSmfBuildSectionHdr('Replication')}
<div id="dataMgmtStatusReplicationHost" class="data-mgmt-status-repl-host">
  <div class="data-mgmt-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading replication…</div>
</div>
${dsapSmfBuildSectionHdr('System Status')}
<div class="data-mgmt-status-layout">
  <div class="data-mgmt-status-left">
    <div class="data-mgmt-panel-hdr">Generations by Workspace</div>
    <div id="dataMgmtPieHost" class="data-mgmt-pie-host">
      <div class="data-mgmt-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading…</div>
    </div>
  </div>
  <div class="data-mgmt-status-right">
    <div class="data-mgmt-panel-hdr">Workspace Usage</div>
    <div id="dataMgmtWorkspacesTableHost" class="data-mgmt-table-host">
      <div class="data-mgmt-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading…</div>
    </div>
    <div class="data-mgmt-panel-hdr data-mgmt-panel-hdr-spaced">Storage</div>
    <div id="dataMgmtStorageTableHost" class="data-mgmt-table-host">
      <div class="data-mgmt-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading…</div>
    </div>
  </div>
</div>
${dsapSmfBuildSectionHdr('Search & Prompt Indexing')}
<div id="dataMgmtIndexingHost" class="data-mgmt-indexing-host">
  <div class="data-mgmt-loading"><i class="fas fa-spinner-third fa-spin"></i> Loading indexing status…</div>
</div>`;
}

function dataMgmtDsapIndexingEscapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function dataMgmtDsapIndexingFormatNumber(value) {
    const n = Number(value) || 0;
    return n.toLocaleString();
}

function dataMgmtDsapIndexingBuildHtml(statusPayload) {
    const stats = statusPayload?.stats || {};
    const ftsPending = stats.ftsPending || 0;
    const ftsDrift = stats.ftsDrift || 0;
    const ftsDone = stats.ftsDone || 0;
    const totalImages = stats.totalImages || 0;
    const blobPending = stats.blobPending || 0;
    const jobStatus = statusPayload?.status || 'idle';
    const running = statusPayload?.running === true;
    const paused = statusPayload?.paused === true;
    const needsWork = ftsPending > 0 || ftsDrift > 0;
    const current = statusPayload?.current || 0;
    const total = statusPayload?.total || ftsPending || 0;
    const percentage = statusPayload?.percentage != null
        ? Math.max(0, Math.min(100, Number(statusPayload.percentage) || 0))
        : (total > 0 ? Math.round((current / total) * 100) : (needsWork ? 0 : 100));

    const statusLabel = (() => {
        if (running) return 'Indexing';
        if (paused) return 'Paused';
        if (jobStatus === 'error') return 'Error';
        if (needsWork) return 'Backlog';
        return 'Up to date';
    })();

    const statusClass = running ? 'indexing' : paused ? 'paused' : needsWork ? 'pending' : 'ok';
    const phaseMessage = dataMgmtDsapIndexingEscapeHtml(statusPayload?.message || statusLabel);
    const filename = statusPayload?.filename ? dataMgmtDsapIndexingEscapeHtml(statusPayload.filename) : '';

    const statsTable = dsapSmfBuildStatsTable([
        { label: 'Prompt FTS', valueHtml: `<span class="data-mgmt-indexing-status ${statusClass}">${dataMgmtDsapIndexingEscapeHtml(statusLabel)}</span>`, width: '25%' },
        { label: 'Indexed', valueHtml: dataMgmtDsapIndexingFormatNumber(ftsDone), width: '25%' },
        { label: 'Pending FTS', valueHtml: dataMgmtDsapIndexingFormatNumber(ftsPending), width: '25%' },
        { label: 'Flag drift', valueHtml: dataMgmtDsapIndexingFormatNumber(ftsDrift), width: '25%' }
    ], 'dataMgmtIndexingStats');

    const extraRows = [];
    if (blobPending > 0) {
        extraRows.push(`<tr><td class="data-mgmt-account-info-label">Blob extract pending</td><td>${dataMgmtDsapIndexingFormatNumber(blobPending)}</td></tr>`);
    }
    extraRows.push(`<tr><td class="data-mgmt-account-info-label">Total images</td><td>${dataMgmtDsapIndexingFormatNumber(totalImages)}</td></tr>`);
    const extraTable = extraRows.length
        ? `<table class="data-mgmt-account-info-table" cellspacing="0" cellpadding="4" width="100%" border="1"><tbody>${extraRows.join('')}</tbody></table>`
        : '';

    const showProgress = running || paused || (jobStatus === 'indexing' && total > 0);
    const progressBlock = showProgress ? `
<div class="data-mgmt-repl-progress" id="dataMgmtIndexingProgress">
  <div class="data-mgmt-repl-progress-phase">${phaseMessage}</div>
  <div class="data-mgmt-repl-progress-bar" aria-hidden="true"><div class="data-mgmt-repl-progress-fill" id="dataMgmtIndexingProgressFill" style="width:${percentage}%"></div></div>
  <div class="data-mgmt-repl-progress-count" id="dataMgmtIndexingProgressCount">${dataMgmtDsapIndexingFormatNumber(current)} / ${dataMgmtDsapIndexingFormatNumber(total)} (${percentage}%)</div>
  ${filename ? `<div class="data-mgmt-repl-progress-path" id="dataMgmtIndexingProgressPath">${filename}</div>` : '<div class="data-mgmt-repl-progress-path hidden" id="dataMgmtIndexingProgressPath"></div>'}
</div>` : (needsWork ? `<p class="data-mgmt-muted" id="dataMgmtIndexingNotice">${phaseMessage}</p>` : `<p class="data-mgmt-muted" id="dataMgmtIndexingNotice">Prompt FTS and search tag indexes are current.</p>`);

    const startDisabled = running || (!needsWork && !paused);
    const pauseDisabled = !running;
    const resumeDisabled = !paused;
    const cancelDisabled = !running && !paused;

    const controls = `
<div class="data-mgmt-indexing-controls">
  <button type="button" class="dsap-smf-btn dsap-smf-btn-primary" id="dataMgmtIndexingStartBtn" ${startDisabled ? 'disabled' : ''}><i class="fas fa-play"></i> Start</button>
  <button type="button" class="dsap-smf-btn" id="dataMgmtIndexingPauseBtn" ${pauseDisabled ? 'disabled' : ''}><i class="fas fa-pause"></i> Pause</button>
  <button type="button" class="dsap-smf-btn" id="dataMgmtIndexingResumeBtn" ${resumeDisabled ? 'disabled' : ''}><i class="fas fa-play"></i> Resume</button>
  <button type="button" class="dsap-smf-btn" id="dataMgmtIndexingCancelBtn" ${cancelDisabled ? 'disabled' : ''}><i class="fas fa-stop"></i> Cancel</button>
  <button type="button" class="dsap-smf-btn dsap-smf-btn-small" id="dataMgmtIndexingReconcileBtn"><i class="fas fa-wrench"></i> Reconcile</button>
</div>`;

    return `${statsTable}
${extraTable}
${progressBlock}
${controls}`;
}

function dataMgmtDsapIndexingApplyStatus(host, statusPayload) {
    if (!host) return;
    host.innerHTML = dataMgmtDsapIndexingBuildHtml(statusPayload);
    dataMgmtDsapIndexingWireControls(host.closest('[data-dsap="data-mgmt"]') || document);
}

function dataMgmtDsapIndexingGetLastBroadcast() {
    const combined = window.wsClient?._lastSearchIndexingStatus;
    const fromCombined = combined ? resolvePromptFtsPayloadFromMessage(combined) : null;
    if (fromCombined) return fromCombined;
    if (window.wsClient?._lastPromptFtsIndexingStatus) {
        return window.wsClient._lastPromptFtsIndexingStatus;
    }
    const indicator = document.getElementById('searchIndexingIndicator');
    return indicator?._indexJobs?.prompt_fts || null;
}

function dataMgmtDsapIndexingLoad(root) {
    const host = root?.querySelector('#dataMgmtIndexingHost');
    if (!host) return;

    if (!window.wsClient?.isConnected()) {
        host.innerHTML = '<p class="data-mgmt-muted">Indexing status unavailable (WebSocket not connected)</p>';
        return;
    }

    const cached = dataMgmtDsapIndexingGetLastBroadcast();
    if (cached) {
        dataMgmtDsapIndexingApplyStatus(host, cached);
        return;
    }

    host.innerHTML = '<div class="data-mgmt-loading"><i class="fas fa-spinner-third fa-spin"></i> Waiting for index status…</div>';
}

function dataMgmtDsapIndexingWireControls(root) {
    if (!root || root.dataset.indexingControlsWired === '1') return;
    root.dataset.indexingControlsWired = '1';

    root.addEventListener('click', async (event) => {
        const startBtn = event.target.closest('#dataMgmtIndexingStartBtn');
        const pauseBtn = event.target.closest('#dataMgmtIndexingPauseBtn');
        const resumeBtn = event.target.closest('#dataMgmtIndexingResumeBtn');
        const cancelBtn = event.target.closest('#dataMgmtIndexingCancelBtn');
        const reconcileBtn = event.target.closest('#dataMgmtIndexingReconcileBtn');
        if (!startBtn && !pauseBtn && !resumeBtn && !cancelBtn && !reconcileBtn) return;
        if (!window.wsClient?.isConnected()) return;

        event.preventDefault();
        try {
            if (startBtn) await window.wsClient.sendMessage('prompt_index_start', {});
            else if (pauseBtn) await window.wsClient.sendMessage('prompt_index_pause', {});
            else if (resumeBtn) await window.wsClient.sendMessage('prompt_index_resume', {});
            else if (cancelBtn) await window.wsClient.sendMessage('prompt_index_cancel', {});
            else if (reconcileBtn) await window.wsClient.sendMessage('prompt_index_reconcile', {});
        } catch (error) {
            console.error('[data-mgmt] prompt index control failed:', error);
        }
    });
}

function dataMgmtDsapIndexingWireStatusListener(host, root) {
    if (!host || !window.wsClient || host.dataset.indexingListenerWired === '1') return;
    host.dataset.indexingListenerWired = '1';

    window.wsClient.on('search_indexing_status', (message) => {
        const payload = typeof resolvePromptFtsPayloadFromMessage === 'function'
            ? resolvePromptFtsPayloadFromMessage(message)
            : (message?.job === 'prompt_fts' ? message : (message?.promptFts ? { job: 'prompt_fts', ...message.promptFts } : null));
        if (!payload) return;
        const indexingHost = root.querySelector('#dataMgmtIndexingHost');
        if (!indexingHost) return;
        dataMgmtDsapIndexingApplyStatus(indexingHost, payload);
    });
}

function dataMgmtDsapBuildWorkspacesHtml() {
    return `${dsapSmfBuildSectionHdr('Workspaces')}
${dsapSmfBuildToolbar(`<button type="button" id="dataMgmtWorkspaceAddBtn" class="dsap-smf-btn dsap-smf-btn-primary"><i class="fas fa-plus"></i> New Workspace</button>`, 'dataMgmtWorkspacesToolbar')}
<table class="sec-data-table data-mgmt-ws-table" cellspacing="0" cellpadding="4" width="100%" border="1">
  <thead>
    <tr>
      <th align="center" width="28"></th>
      <th align="left">Workspace</th>
      <th align="center" width="70"><i class="fas fa-image" title="Generations"></i></th>
      <th align="center" width="70"><i class="fas fa-swatchbook" title="References"></i></th>
      <th align="center" width="120">Actions</th>
    </tr>
  </thead>
  <tbody id="dataMgmtWorkspaceList" class="data-mgmt-ws-list"></tbody>
</table>
<div id="dataMgmtWorkspaceEmpty" class="dsap-smf-empty hidden"><i class="fas fa-planet-ringed"></i> No workspaces configured</div>`;
}

function dataMgmtDsapBuildFavoritesHtml() {
    return `${dsapSmfBuildSectionHdr('Favorites')}
<table class="sec-data-table data-mgmt-favorites-table" cellspacing="0" cellpadding="4" width="100%" border="1">
  <thead>
    <tr>
      <th align="center" width="50">Type</th>
      <th align="left">Name</th>
      <th align="left">Details</th>
      <th align="center" width="60">Remove</th>
    </tr>
  </thead>
  <tbody id="dataMgmtFavoritesList" class="data-mgmt-favorites-list"></tbody>
</table>
<div id="dataMgmtFavoritesEmpty" class="dsap-smf-empty hidden"><i class="fas fa-star"></i> No favorites yet<br><small>Add tags and text expanders from elsewhere in the app</small></div>`;
}

function dataMgmtDsapBuildStubHtml(title, bodyHtml) {
    return `${dsapSmfBuildSectionHdr(title)}
<div class="data-mgmt-stub">
  <p class="data-mgmt-stub-lead"><i class="fas fa-screwdriver-wrench"></i> Coming soon</p>
  <div class="data-mgmt-stub-body">${bodyHtml}</div>
</div>`;
}

function dataMgmtDsapBuildSpellbookHtml() {
    return dataMgmtDsapBuildStubHtml('Spellbook', `<p>Preset / spellbook management will migrate here from the legacy Spellbook modal.</p>
<p class="data-mgmt-muted">Until then, open <button type="button" class="dsap-smf-btn dsap-smf-btn-small" id="dataMgmtOpenSpellbookLegacyBtn"><i class="fas fa-book-spells"></i> Legacy Spellbook</button></p>`);
}

function dataMgmtDsapBuildExpandersHtml() {
    return dataMgmtDsapBuildStubHtml('Expanders', `<p>Global text expander management will migrate here from the legacy Expanders modal.</p>
<p class="data-mgmt-muted">Until then, open <button type="button" class="dsap-smf-btn dsap-smf-btn-small" id="dataMgmtOpenExpandersLegacyBtn"><i class="fas fa-book-font"></i> Legacy Expanders</button></p>`);
}

function dataMgmtDsapBuildShellHtml(activeTabId) {
    const tabId = activeTabId || 'status';
    return `${dsapSmfBuildRootOpen('data-mgmt')}
${dsapSmfBuildHeader({
    branchTitle: DSAP_SMF_BRANCH_DATA_MGMT,
    toolTitle: DATA_DSAP_TAB_LABELS[tabId] || 'Status'
})}
${dataMgmtDsapBuildTabBar(tabId)}
<div class="data-mgmt-view" id="dataMgmtViewHost"></div>
${dsapSmfBuildRootClose()}`;
}

function dataMgmtDsapGetSortedWorkspaces() {
    if (typeof workspaces === 'undefined') return [];
    return Object.values(workspaces).sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

function dataMgmtDsapWireWorkspaceDragReorder(list) {
    if (!list || list.dataset.workspaceDragWired === '1') return;
    list.dataset.workspaceDragWired = '1';

    let draggedItem = null;
    let draggedIndex = null;
    let dragDocumentController = null;

    list.querySelectorAll('.data-mgmt-ws-drag-handle').forEach((handle) => {
        handle.addEventListener('mousedown', startDrag);
        handle.addEventListener('touchstart', startDrag, { passive: false });
        handle.addEventListener('touchmove', onDrag, { passive: false });
        handle.addEventListener('touchend', endDrag);
    });

    function startDrag(e) {
        e.preventDefault();
        e.stopPropagation();

        const item = e.target.closest('.data-mgmt-ws-row');
        if (!item) return;

        draggedItem = item;
        draggedIndex = Array.from(list.children).indexOf(item);
        draggedItem.classList.add('dragging');

        // Per-drag document listeners — AbortController aligned with pipelineStageControls.js
        if (dragDocumentController) {
            dragDocumentController.abort();
        }
        dragDocumentController = new AbortController();
        const dragSignal = dragDocumentController.signal;
        document.addEventListener('mousemove', onDrag, { signal: dragSignal });
        document.addEventListener('mouseup', endDrag, { signal: dragSignal });
        document.body.style.userSelect = 'none';
    }

    function onDrag(e) {
        if (!draggedItem) return;
        e.preventDefault();

        let clientY;
        if (e.type === 'mousemove') {
            clientY = e.clientY;
        } else if (e.type === 'touchmove' && e.touches.length > 0) {
            clientY = e.touches[0].clientY;
        } else {
            return;
        }

        const rect = list.getBoundingClientRect();
        const mouseY = clientY - rect.top;
        const items = Array.from(list.children);
        let targetIndex = draggedIndex;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemRect = item.getBoundingClientRect();
            const itemTop = itemRect.top - rect.top;
            const itemBottom = itemTop + itemRect.height;
            if (mouseY >= itemTop && mouseY <= itemBottom) {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex !== draggedIndex) {
            items.forEach((item) => item.classList.remove('drag-over'));
            if (targetIndex < items.length) {
                list.insertBefore(draggedItem, items[targetIndex]);
            } else {
                list.appendChild(draggedItem);
            }
            const newItems = Array.from(list.children);
            const newIndex = newItems.indexOf(draggedItem);
            if (newIndex < newItems.length) {
                newItems[newIndex].classList.add('drag-over');
            }
            draggedIndex = targetIndex;
        }
    }

    function endDrag(e) {
        if (!draggedItem) return;
        e.preventDefault();

        if (dragDocumentController) {
            dragDocumentController.abort();
            dragDocumentController = null;
        }

        draggedItem.classList.remove('dragging');
        Array.from(list.children).forEach((item) => item.classList.remove('drag-over'));
        document.body.style.userSelect = '';

        const newOrder = Array.from(list.children).map((item) => item.dataset.workspaceId);
        const row = draggedItem;
        row.style.opacity = '0.6';
        row.style.pointerEvents = 'none';

        // reorderWorkspaces: public/scripts/comp/workspaceUtils.js
        reorderWorkspaces(newOrder).catch((error) => {
            row.style.opacity = '';
            row.style.pointerEvents = '';
            showError('Failed to reorder workspaces: ' + error.message);
        });

        draggedItem = null;
        draggedIndex = null;
    }
}

function dataMgmtDsapRenderWorkspaceList(root) {
    const list = root.querySelector('#dataMgmtWorkspaceList');
    if (!list) return;

    const emptyHost = root.querySelector('#dataMgmtWorkspaceEmpty');
    const table = root.querySelector('.data-mgmt-ws-table');
    const sortedWorkspaces = dataMgmtDsapGetSortedWorkspaces();

    delete list.dataset.workspaceDragWired;
    list.innerHTML = '';

    if (!sortedWorkspaces.length) {
        if (emptyHost) emptyHost.classList.remove('hidden');
        if (table) table.classList.add('hidden');
        return;
    }

    if (emptyHost) emptyHost.classList.add('hidden');
    if (table) table.classList.remove('hidden');

    sortedWorkspaces.forEach((workspace) => {
        const row = document.createElement('tr');
        row.className = 'data-mgmt-ws-row';
        row.dataset.workspaceId = workspace.id;

        const activeBadge = workspace.id === activeWorkspace
            ? ' <span class="data-mgmt-ws-active" title="Active"><i class="fas fa-check"></i></span>'
            : '';
        const color = dataMgmtDsapEscapeAttr(workspace.color || '#102040');
        const safeName = dataMgmtDsapEscapeHtml(workspace.name);
        const safeNameAttr = String(workspace.name || '').replace(/'/g, "\\'");
        const dumpBtn = !workspace.isDefault ? `
                <button type="button" class="dsap-smf-btn dsap-smf-btn-small" onclick="showDumpWorkspaceModal('${workspace.id}', '${safeNameAttr}')" title="Dump">
                    <i class="mdi mdi-1-5 mdi-folder-move"></i>
                </button>
                <button type="button" class="dsap-smf-btn dsap-smf-btn-small dsap-smf-btn-danger" onclick="confirmDeleteWorkspace('${workspace.id}', '${safeNameAttr}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>` : '';

        row.innerHTML = `
                <td align="center" class="data-mgmt-ws-drag-cell">
                    <span class="data-mgmt-ws-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
                </td>
                <td class="data-mgmt-ws-name-cell">
                    <span class="data-mgmt-ws-color" style="background-color: ${color}"></span>
                    <span class="data-mgmt-ws-name">${safeName}</span>${activeBadge}
                </td>
                <td align="center" class="data-mgmt-ws-count">${dataMgmtDsapFormatNumber(workspace.fileCount || 0)}</td>
                <td align="center" class="data-mgmt-ws-count">${dataMgmtDsapFormatNumber(workspace.cacheFileCount || 0)}</td>
                <td align="center" class="data-mgmt-ws-actions-cell">
                    <button type="button" class="dsap-smf-btn dsap-smf-btn-small" onclick="editWorkspaceSettings('${workspace.id}')" title="Workspace Settings">
                        <i class="fas fa-cog"></i>
                    </button>
                    ${dumpBtn}
                </td>
            `;
        list.appendChild(row);
    });

    dataMgmtDsapWireWorkspaceDragReorder(list);
}

function dataMgmtDsapRenderFavoritesList(root) {
    const favoritesList = root.querySelector('#dataMgmtFavoritesList');
    if (!favoritesList) return;

    const emptyHost = root.querySelector('#dataMgmtFavoritesEmpty');
    const table = root.querySelector('.data-mgmt-favorites-table');
    favoritesList.innerHTML = '';

    // favoritesData: public/scripts/comp/textReplacementManager.js
    const favData = typeof favoritesData !== 'undefined' ? favoritesData : { tags: [], textReplacements: [] };
    const allFavorites = [];

    (favData.tags || []).forEach((tag, index) => {
        allFavorites.push({ type: 'tag', data: tag, index });
    });
    (favData.textReplacements || []).forEach((textReplacement, index) => {
        allFavorites.push({ type: 'textReplacement', data: textReplacement, index });
    });

    if (!allFavorites.length) {
        if (emptyHost) emptyHost.classList.remove('hidden');
        if (table) table.classList.add('hidden');
        return;
    }

    if (emptyHost) emptyHost.classList.add('hidden');
    if (table) table.classList.remove('hidden');

    allFavorites.forEach((favorite) => {
        const row = document.createElement('tr');
        row.className = 'data-mgmt-fav-row';
        row.dataset.index = String(favorite.index);
        row.dataset.type = favorite.type;

        if (favorite.type === 'tag') {
            const tag = favorite.data;
            const description = tag.name !== tag.description ? (tag.description || '') : '';
            row.innerHTML = `
                    <td align="center" class="data-mgmt-fav-type"><i class="fas fa-tag" title="Tag"></i></td>
                    <td class="data-mgmt-fav-name">${dataMgmtDsapEscapeHtml(tag.name)}</td>
                    <td class="data-mgmt-fav-detail">${description ? dataMgmtDsapEscapeHtml(description) : '<span class="data-mgmt-muted">—</span>'}</td>
                    <td align="center" class="data-mgmt-fav-actions">
                        <button type="button" class="dsap-smf-btn dsap-smf-btn-small dsap-smf-btn-danger data-mgmt-fav-remove" data-type="tags" data-index="${favorite.index}" title="Remove from Favorites">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
        } else {
            const textReplacement = favorite.data;
            const placeholder = textReplacement.placeholder || '';
            const replacementValue = textReplacement.replacementValue || '';
            row.innerHTML = `
                    <td align="center" class="data-mgmt-fav-type"><i class="fas fa-input-text" title="Text Expander"></i></td>
                    <td class="data-mgmt-fav-name">!${dataMgmtDsapEscapeHtml(placeholder)}</td>
                    <td class="data-mgmt-fav-detail">${replacementValue ? dataMgmtDsapEscapeHtml(replacementValue) : '<span class="data-mgmt-muted">—</span>'}</td>
                    <td align="center" class="data-mgmt-fav-actions">
                        <button type="button" class="dsap-smf-btn dsap-smf-btn-small dsap-smf-btn-danger data-mgmt-fav-remove" data-type="textReplacements" data-index="${favorite.index}" title="Remove from Favorites">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
        }

        const removeBtn = row.querySelector('.data-mgmt-fav-remove');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                // removeFavorite: public/scripts/comp/textReplacementManager.js
                removeFavorite(removeBtn.dataset.type, Number(removeBtn.dataset.index));
            });
        }
        favoritesList.appendChild(row);
    });
}

function dataMgmtDsapRefreshWorkspacesIfPresent() {
    const list = document.getElementById('dataMgmtWorkspaceList');
    if (!list) return;
    const root = list.closest('[data-dsap="data-mgmt"]');
    if (root) dataMgmtDsapRenderWorkspaceList(root);
}

function dataMgmtDsapRefreshFavoritesIfPresent() {
    const list = document.getElementById('dataMgmtFavoritesList');
    if (!list) return;
    const root = list.closest('[data-dsap="data-mgmt"]');
    if (root) dataMgmtDsapRenderFavoritesList(root);
}

function dataMgmtDsapRefreshStatusIfPresent() {
    const pieHost = document.getElementById('dataMgmtPieHost');
    if (!pieHost) return;
    const root = pieHost.closest('[data-dsap="data-mgmt"]');
    if (root) void dataMgmtDsapDriver._loadStatus(root);
}

function dataMgmtDsapReplicationEscapeHtml(text) {
    if (typeof dsapSmfEscapeHtml === 'function') return dsapSmfEscapeHtml(text);
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function dataMgmtDsapReplicationFormatService(val) {
    if (val === 'local') return { label: 'Local', tone: 'ok' };
    if (val === 'delegated') return { label: 'Delegated', tone: 'warn' };
    if (val === 'disconnected') return { label: 'Disconnected', tone: 'error' };
    if (val === 'unavailable') return { label: 'Unavailable', tone: 'error' };
    return { label: 'Unavailable', tone: 'error' };
}

function dataMgmtDsapReplicationTransferLabel(modeId) {
    const found = REPLICATION_DSAP_TRANSFER_MODES.find((m) => m.id === modeId);
    return found ? found.label : modeId;
}

function dataMgmtDsapReplicationGalleryLabel(modeId) {
    const found = REPLICATION_DSAP_GALLERY_SHARED_OPTIONS.find((m) => m.id === modeId);
    return found ? found.label : modeId;
}

function dataMgmtDsapReplicationConnectivityLabel(modeId) {
    const found = REPLICATION_DSAP_CONNECTIVITY_OPTIONS.find((m) => m.id === modeId);
    return found ? found.label : modeId;
}

function dataMgmtDsapReplicationBulkTransferBlocked(status) {
    const conn = status?.connectivity || 'normal';
    return conn === 'airgapped' || conn === 'delegated-only';
}

async function dataMgmtDsapReplicationFetchStatus() {
    const res = await fetch('/replication/status', { credentials: 'same-origin' });
    if (!res.ok) {
        const err = new Error(`Status HTTP ${res.status}`);
        console.error('[replication] fetch /replication/status failed:', err.message);
        throw err;
    }
    const json = await res.json();
    return json.data || json;
}

async function dataMgmtDsapReplicationSavePatches(patches) {
    if (!wsClient?.isConnected()) throw new Error('WebSocket not connected');
    const data = await wsClient.sendMessage('config_editor_save', { patches: { secureConfig: patches } }, false);
    if (!data?.success) {
        const errMsg = data?.errors?.map((e) => e.message || e).join('; ') || 'Save failed';
        throw new Error(errMsg);
    }
    return data;
}

function dataMgmtDsapReplicationBuildServicesHtml(delegation) {
    const d = delegation || {};
    const rows = [
        { key: 'wikiData', label: 'Wiki Data' },
        { key: 'autoComplete', label: 'AutoComplete' },
        { key: 'wikiMedia', label: 'Wiki Media' },
        { key: 'masterWsConnected', label: 'Master WS', bool: true }
    ];
    return rows.map((row) => {
        let label;
        let tone = '';
        if (row.bool) {
            label = d[row.key] ? 'Connected' : 'Disconnected';
            tone = d[row.key] ? 'ok' : 'error';
        } else {
            const fmt = dataMgmtDsapReplicationFormatService(d[row.key]);
            label = fmt.label;
            tone = fmt.tone;
        }
        return `<div class="data-mgmt-repl-service"><span class="data-mgmt-repl-service-label">${dataMgmtDsapReplicationEscapeHtml(row.label)}</span><span class="data-mgmt-repl-service-val ${tone}">${dataMgmtDsapReplicationEscapeHtml(label)}</span></div>`;
    }).join('');
}

function dataMgmtDsapReplicationFormatRelativeTime(isoOrMs) {
    if (!isoOrMs) return '—';
    const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
    if (!Number.isFinite(d.getTime())) return '—';
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return 'just now';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 14) return `${days}d ago`;
    return d.toLocaleString();
}

function dataMgmtDsapReplicationResolveChildAvailability(child, status) {
    if (child?.availability) return String(child.availability);
    const maint = status?.maintenance;
    if (maint?.active && maint.partnerInstanceId && child?.instanceId === maint.partnerInstanceId) {
        return 'docked';
    }
    if (child?.lastUpsertAt) {
        const age = Date.now() - new Date(child.lastUpsertAt).getTime();
        if (Number.isFinite(age) && age < 7 * 24 * 60 * 60 * 1000) return 'reachable';
    }
    if ((Number(child?.lastSyncLsn) || 0) > 0) return 'reachable';
    return 'unreachable';
}

function dataMgmtDsapReplicationAvailabilityLabel(code) {
    if (code === 'reachable') return 'Reachable';
    if (code === 'docked') return 'Docked';
    if (code === 'unreachable') return 'Unreachable';
    return code || '—';
}

function dataMgmtDsapReplicationAvailabilityClass(code) {
    if (code === 'reachable') return 'ok';
    if (code === 'docked') return 'warn';
    if (code === 'unreachable') return 'error';
    return '';
}

function dataMgmtDsapReplicationBuildChildrenTableHtml(children, status) {
    const rows = (children || []).filter((c) => c && (c.instanceId || c.displayName));
    if (!rows.length) {
        return '<p class="data-mgmt-repl-children-empty">No registered children yet.</p>';
    }
    const body = rows.map((child) => {
        const name = dataMgmtDsapReplicationEscapeHtml(child.displayName || '—');
        const id = dataMgmtDsapReplicationEscapeHtml(child.instanceId || '—');
        const avail = dataMgmtDsapReplicationResolveChildAvailability(child, status);
        const availClass = dataMgmtDsapReplicationAvailabilityClass(avail);
        const availLabel = dataMgmtDsapReplicationAvailabilityLabel(avail);
        const upsert = dataMgmtDsapReplicationEscapeHtml(dataMgmtDsapReplicationFormatRelativeTime(child.lastUpsertAt));
        return `<tr><td>${name}</td><td><code>${id}</code></td><td class="data-mgmt-repl-avail ${availClass}">${dataMgmtDsapReplicationEscapeHtml(availLabel)}</td><td>${upsert}</td></tr>`;
    }).join('');
    return `<table class="data-mgmt-repl-children-table" cellspacing="0" cellpadding="4" width="100%" border="1">
  <thead><tr><th>Display name</th><th>Instance ID</th><th>Availability</th><th>Last upsert</th></tr></thead>
  <tbody>${body}</tbody>
</table>`;
}

function dataMgmtDsapReplicationBuildChildSummaryHtml(status) {
    const bridge = typeof getMasterWsBridgeState === 'function' ? getMasterWsBridgeState() : null;
    const galleryCtx = typeof getGalleryReplicationContext === 'function' ? getGalleryReplicationContext() : null;
    const masterLabel = status.masterAccessUrl || status.displayName || '—';
    const masterName = dataMgmtDsapReplicationEscapeHtml(masterLabel);
    const masterUrl = status.masterAccessUrl
        ? `<a href="${dataMgmtDsapReplicationEscapeHtml(status.masterAccessUrl)}" target="_blank" rel="noopener">${masterName}</a>`
        : masterName;
    let serverProbe = '—';
    if (status.connectivity === 'airgapped') {
        serverProbe = 'airgapped';
    } else if (status.connectivity === 'delegated-only') {
        serverProbe = 'delegated-only';
    } else if (galleryCtx?.masterReachable === true) {
        serverProbe = 'reachable';
    } else if (galleryCtx?.masterReachable === false && status.masterAccessUrl) {
        serverProbe = 'unreachable';
    } else if (status.masterAccessUrl) {
        serverProbe = 'unknown';
    }
    const wsState = bridge?.masterConnected || status.delegation?.masterWsConnected ? 'connected' : 'disconnected';
    const lastSyncLsn = dataMgmtDsapReplicationResolveLastSyncSummary(status);
    return `<table class="data-mgmt-repl-children-table" cellspacing="0" cellpadding="4" width="100%" border="1">
  <thead><tr><th>Master</th><th>Server probe</th><th>Master WS</th><th>Last sync LSN</th></tr></thead>
  <tbody><tr>
    <td>${masterUrl}</td>
    <td class="data-mgmt-repl-avail ${serverProbe === 'reachable' ? 'ok' : serverProbe === 'unreachable' ? 'error' : ''}">${dataMgmtDsapReplicationEscapeHtml(serverProbe)}</td>
    <td class="data-mgmt-repl-avail ${wsState === 'connected' ? 'ok' : 'error'}">${dataMgmtDsapReplicationEscapeHtml(wsState)}</td>
    <td>${dataMgmtDsapReplicationEscapeHtml(lastSyncLsn)}</td>
  </tr></tbody>
</table>`;
}

function dataMgmtDsapReplicationResolveLastSyncSummary(status) {
    if (!status?.lastAppliedRemoteLsn) return '0';
    const values = Object.values(status.lastAppliedRemoteLsn);
    if (!values.length) return '0';
    return String(Math.max(...values.map((v) => Number(v) || 0)));
}

function replicationDsapBuildProgressHtml(snap) {
    if (!snap || !snap.active) {
        return '<p class="data-mgmt-muted">No replication operation in progress.</p>';
    }
    const phase = dataMgmtDsapReplicationEscapeHtml(snap.phase || snap.operation || 'active');
    const current = Number(snap.current) || 0;
    const total = Number(snap.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;
    const path = snap.path ? `<div class="data-mgmt-repl-progress-path">${dataMgmtDsapReplicationEscapeHtml(snap.path)}</div>` : '';
    const bar = pct != null
        ? `<div class="data-mgmt-repl-progress-bar"><div class="data-mgmt-repl-progress-fill" style="width:${pct}%"></div></div><div class="data-mgmt-repl-progress-count">${current} / ${total}</div>`
        : '';
    return `<div class="data-mgmt-repl-progress">
  <div class="data-mgmt-repl-progress-phase"><i class="fas fa-arrows-rotate fa-spin"></i> ${phase}</div>
  ${bar}
  ${path}
</div>`;
}

function dataMgmtDsapReplicationBuildBreadcrumb(subRoute) {
    const label = REPLICATION_DSAP_SUB_LABELS[subRoute] || subRoute;
    if (!subRoute || subRoute === 'home') return '';
    return `<div class="data-mgmt-repl-breadcrumb">
  <button type="button" class="data-mgmt-repl-crumb-link" data-repl-nav="home">Replication</button>
  <span class="data-mgmt-repl-crumb-sep">&raquo;</span>
  <span>${dataMgmtDsapReplicationEscapeHtml(label)}</span>
</div>`;
}

function dataMgmtDsapReplicationBuildNavGrid(status) {
    const role = status?.role || 'standalone';
    const isMasterPure = role === 'master';
    const isChild = role === 'child';
    const isChildish = isChild || role === 'ephemeral';
    const bulkBlocked = dataMgmtDsapReplicationBulkTransferBlocked(status);
    const upsertDisabled = isMasterPure || (isChildish && bulkBlocked);
    let upsertNote = '';
    if (isMasterPure) {
        upsertNote = '<span class="data-mgmt-repl-nav-note">Master nodes receive upserts from children</span>';
    } else if (isChildish && bulkBlocked) {
        upsertNote = `<span class="data-mgmt-repl-nav-note">${status.connectivity === 'delegated-only' ? 'Delegated-only — bulk cargo disabled' : 'Airgapped — use manual cargo export'}</span>`;
    }
    const syncHidden = !isChild || bulkBlocked ? ' hidden' : '';
    return `<div class="data-mgmt-repl-nav-grid">
  <button type="button" class="dsap-smf-btn data-mgmt-repl-nav-btn" data-repl-nav="configuration"><i class="fas fa-sliders"></i> Configuration</button>
  <button type="button" class="dsap-smf-btn data-mgmt-repl-nav-btn${upsertDisabled ? ' data-mgmt-repl-nav-disabled' : ''}" data-repl-nav="upsert"${upsertDisabled ? ' disabled' : ''}><i class="fas fa-cloud-upload-alt"></i> Upsert Cargo</button>
  <button type="button" class="dsap-smf-btn data-mgmt-repl-nav-btn${syncHidden}" data-repl-nav="sync"><i class="fas fa-arrows-rotate"></i> Sync from Master</button>
  <button type="button" class="dsap-smf-btn data-mgmt-repl-nav-btn${role !== 'master' && role !== 'standalone' ? ' hidden' : ''}" data-repl-nav="setup"><i class="fas fa-box-open"></i> Separation Setup</button>
</div>${upsertNote}`;
}

function dataMgmtDsapReplicationBuildHomeHtml() {
    return `${dsapSmfBuildSectionHdr('System State')}
<div class="data-mgmt-repl-layout">
  ${dsapSmfBuildStatsTable([
        { label: 'Role', valueHtml: '<span id="dataMgmtReplRole">—</span>', width: '25%' },
        { label: 'Connectivity', valueHtml: '<span id="dataMgmtReplConnectivity">—</span>', width: '25%' },
        { label: 'Instance', valueHtml: '<span id="dataMgmtReplInstance">—</span>', width: '25%' },
        { label: 'Maintenance', valueHtml: '<span id="dataMgmtReplMaintenance">—</span>', width: '25%' }
    ], 'dataMgmtReplStatusStats')}
  <div id="dataMgmtReplServicesHost" class="data-mgmt-repl-services"></div>
</div>
<div id="dataMgmtReplCtaHost" class="data-mgmt-repl-cta-host hidden"></div>
<div id="dataMgmtReplChildrenHdrHost"></div>
<div id="dataMgmtReplChildrenHost"></div>
<div id="dataMgmtReplChildSummaryHost" class="hidden"></div>
${dsapSmfBuildSectionHdr('Actions')}
<div id="dataMgmtReplNavHost"></div>`;
}

function dataMgmtDsapReplicationBuildConfigurationHtml(status) {
    const connectivity = status?.connectivity || 'normal';
    const transferMode = status?.transferMode || 'tape-stream-compressed';
    const gallery = status?.gallerySharedDefault || 'manual';
    return `${dataMgmtDsapReplicationBuildBreadcrumb('configuration')}
${dsapSmfBuildSectionHdr('Replication defaults')}
<p class="data-mgmt-repl-lead">These settings apply as defaults for future cargo and sync operations. Save persists to secure config.</p>
<div class="data-mgmt-repl-settings-row">
  <button type="button" class="dsap-smf-btn" id="dataMgmtReplConnectivityBtn" title="Replication connectivity mode"><i class="fas fa-tower-broadcast"></i> <span id="dataMgmtReplConnectivityLabel">Connectivity: ${dataMgmtDsapReplicationEscapeHtml(dataMgmtDsapReplicationConnectivityLabel(connectivity))}</span> <i class="fas fa-caret-down"></i></button>
  <button type="button" class="dsap-smf-btn" id="dataMgmtReplGallerySharedBtn"><span id="dataMgmtReplGallerySharedLabel">Shared gallery: ${dataMgmtDsapReplicationEscapeHtml(dataMgmtDsapReplicationGalleryLabel(gallery))}</span> <i class="fas fa-caret-down"></i></button>
  <button type="button" class="dsap-smf-btn" id="dataMgmtReplConfigTransferBtn"><span id="dataMgmtReplConfigTransferLabel">Default cargo mode: ${dataMgmtDsapReplicationEscapeHtml(dataMgmtDsapReplicationTransferLabel(transferMode))}</span> <i class="fas fa-caret-down"></i></button>
</div>
<div class="dsap-smf-toolbar">
  <button type="button" class="dsap-smf-btn dsap-smf-btn-primary" id="dataMgmtReplConfigSaveBtn"><i class="fas fa-save"></i> Save defaults</button>
</div>
<input type="hidden" id="dataMgmtReplConfigTransferHidden" value="${dataMgmtDsapReplicationEscapeHtml(transferMode)}" />
<input type="hidden" id="dataMgmtReplConfigGalleryHidden" value="${dataMgmtDsapReplicationEscapeHtml(gallery)}" />`;
}

function dataMgmtDsapReplicationBuildSetupHtml(status) {
    const role = status?.role || 'standalone';
    const canBundle = role === 'master' || role === 'standalone';
    const canBootstrap = role === 'standalone' || role === 'child';
    let body = dataMgmtDsapReplicationBuildBreadcrumb('setup');
    if (canBundle) {
        body += typeof replicationSepBuildBundleWizardHtml === 'function'
            ? replicationSepBuildBundleWizardHtml()
            : '<p class="data-mgmt-muted">Bundle wizard unavailable</p>';
    }
    if (canBootstrap) {
        body += `${dsapSmfBuildSectionHdr('Bootstrap from bundle')}
<div id="dataMgmtReplicationSepHost" class="data-mgmt-repl-panel-host"></div>`;
    }
    if (role === 'standalone') {
        body += `${dsapSmfBuildSectionHdr('Alternate pairing')}
${dsapSmfBuildToolbar(`<button type="button" class="dsap-smf-btn" id="dataMgmtReplRegisterBtn"><i class="fas fa-link"></i> Register manually</button>
<button type="button" class="dsap-smf-btn" id="dataMgmtReplEphemeralBtn"><i class="fas fa-mobile-screen"></i> Ephemeral setup</button>`, 'dataMgmtReplSetupToolbar')}`;
    }
    if (!canBundle && !canBootstrap && role !== 'standalone') {
        body += '<p class="data-mgmt-muted">Separation setup is not available for this role.</p>';
    }
    return body;
}

function dataMgmtDsapReplicationBuildPageHtml(subRoute, status) {
    if (subRoute === 'configuration') return dataMgmtDsapReplicationBuildConfigurationHtml(status);
    if (subRoute === 'upsert') {
        return `${dataMgmtDsapReplicationBuildBreadcrumb('upsert')}
<div id="dataMgmtReplicationCargoHost" class="data-mgmt-repl-panel-host"></div>`;
    }
    if (subRoute === 'sync') {
        return `${dataMgmtDsapReplicationBuildBreadcrumb('sync')}
<div id="dataMgmtReplicationSyncHost" class="data-mgmt-repl-panel-host"></div>`;
    }
    if (subRoute === 'setup') return dataMgmtDsapReplicationBuildSetupHtml(status);
    if (subRoute === 'progress') {
        return `${dataMgmtDsapReplicationBuildBreadcrumb('progress')}
<div id="dataMgmtReplProgressPageHost">${replicationDsapBuildProgressHtml(replicationDsapGetLiveProgress())}</div>
<p class="data-mgmt-muted"><button type="button" class="dsap-smf-btn data-mgmt-repl-crumb-link" data-repl-nav="home">Back to Replication home</button></p>`;
    }
    return dataMgmtDsapReplicationBuildHomeHtml();
}

function dataMgmtDsapReplicationResolveMasterReachableSummary(status) {
    if (!status?.masterAccessUrl) return null;
    if (status.connectivity === 'airgapped') return 'airgapped';
    const galleryCtx = typeof getGalleryReplicationContext === 'function' ? getGalleryReplicationContext() : null;
    if (galleryCtx?.masterReachable === true) return 'reachable';
    if (galleryCtx?.masterReachable === false) return 'unreachable';
    return 'unknown';
}

function dataMgmtDsapReplicationBuildStatusSummaryHtml(status) {
    if (!status) return '<p class="data-mgmt-muted">Replication status unavailable</p>';
    const maint = status.maintenance?.active
        ? dataMgmtDsapReplicationEscapeHtml(status.maintenance.operation || 'active')
        : 'off';
    const role = dataMgmtDsapReplicationEscapeHtml(status.role || 'standalone');
    const conn = dataMgmtDsapReplicationEscapeHtml(status.connectivity || 'normal');
    const inst = dataMgmtDsapReplicationEscapeHtml(status.displayName ? `${status.displayName} · ${status.instanceId || '—'}` : (status.instanceId || '—'));
    const extraRows = [];
    const masterReach = dataMgmtDsapReplicationResolveMasterReachableSummary(status);
    if (masterReach != null) {
        const reachClass = masterReach === 'reachable' ? 'ok' : masterReach === 'unreachable' ? 'error' : '';
        extraRows.push(`<tr><td class="data-mgmt-account-info-label">Master reachable</td><td class="data-mgmt-repl-avail ${reachClass}">${dataMgmtDsapReplicationEscapeHtml(masterReach)}</td></tr>`);
    }
    if (status.role === 'child') {
        const lastSyncLsn = dataMgmtDsapReplicationResolveLastSyncSummary(status);
        extraRows.push(`<tr><td class="data-mgmt-account-info-label">Last sync LSN</td><td>${dataMgmtDsapReplicationEscapeHtml(lastSyncLsn)}</td></tr>`);
    }
    if (status.role === 'master') {
        const childCount = Array.isArray(status.children) ? status.children.filter((c) => c && (c.instanceId || c.displayName)).length : 0;
        extraRows.push(`<tr><td class="data-mgmt-account-info-label">Children</td><td>${childCount} registered</td></tr>`);
    }
    const extraTable = extraRows.length
        ? `<table class="data-mgmt-account-info-table" cellspacing="0" cellpadding="4" width="100%" border="1"><tbody>${extraRows.join('')}</tbody></table>`
        : '';
    const link = `<p class="data-mgmt-repl-status-link"><button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-open-replication-tab="1"><i class="fas fa-clone"></i> Open Replication</button></p>`;
    return `${dsapSmfBuildStatsTable([
        { label: 'Role', valueHtml: role, width: '25%' },
        { label: 'Connectivity', valueHtml: conn, width: '25%' },
        { label: 'Instance', valueHtml: inst, width: '25%' },
        { label: 'Maintenance', valueHtml: maint, width: '25%' }
    ], 'dataMgmtStatusReplStats')}
${extraTable}
${link}`;
}

async function dataMgmtDsapReplicationLoadStatusSummary(root) {
    const host = root.querySelector('#dataMgmtStatusReplicationHost');
    if (!host) return;
    try {
        const status = await dataMgmtDsapReplicationFetchStatus();
        host.innerHTML = dataMgmtDsapReplicationBuildStatusSummaryHtml(status);
        const openBtn = host.querySelector('[data-open-replication-tab]');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
                if (typeof openDsapInGrimoire === 'function') {
                    openDsapInGrimoire(dataMgmtDsapBuildReplicationUrl('home'));
                }
            });
        }
    } catch (err) {
        host.innerHTML = `<p class="data-mgmt-muted">${dataMgmtDsapReplicationEscapeHtml(err.message || 'Replication status unavailable')}</p>`;
    }
}

function dataMgmtDsapReplicationRenderHome(root, status) {
    if (!status) return;
    const roleEl = root.querySelector('#dataMgmtReplRole');
    const connEl = root.querySelector('#dataMgmtReplConnectivity');
    const instEl = root.querySelector('#dataMgmtReplInstance');
    const maintEl = root.querySelector('#dataMgmtReplMaintenance');
    const servicesHost = root.querySelector('#dataMgmtReplServicesHost');
    const childrenHost = root.querySelector('#dataMgmtReplChildrenHost');
    const childrenHdrHost = root.querySelector('#dataMgmtReplChildrenHdrHost');
    const childSummaryHost = root.querySelector('#dataMgmtReplChildSummaryHost');
    const ctaHost = root.querySelector('#dataMgmtReplCtaHost');
    const navHost = root.querySelector('#dataMgmtReplNavHost');

    const role = status.role || 'standalone';
    const children = (status.children || []).filter((c) => c && (c.instanceId || c.displayName));

    if (roleEl) roleEl.textContent = role;
    if (connEl) connEl.textContent = status.connectivity || 'normal';
    if (instEl) {
        const name = status.displayName ? `${status.displayName} · ` : '';
        instEl.textContent = `${name}${status.instanceId || '—'}`;
        instEl.title = status.instanceId || '';
    }
    if (maintEl) {
        if (status.maintenance?.active) {
            maintEl.innerHTML = `<span class="data-mgmt-repl-maint-active">${dataMgmtDsapReplicationEscapeHtml(status.maintenance.operation || 'active')}</span>`;
        } else {
            maintEl.textContent = 'off';
        }
    }
    if (servicesHost) servicesHost.innerHTML = dataMgmtDsapReplicationBuildServicesHtml(status.delegation);

    if (ctaHost) {
        const showCta = (role === 'master' || role === 'standalone') && !children.length;
        ctaHost.classList.toggle('hidden', !showCta);
        if (showCta) {
            ctaHost.innerHTML = `<div class="data-mgmt-repl-cta">
  <p>No child nodes paired yet. Create a separation bundle to provision the first child.</p>
  <button type="button" class="dsap-smf-btn dsap-smf-btn-primary" data-repl-nav="setup"><i class="fas fa-box-open"></i> Create separation bundle</button>
</div>`;
        } else {
            ctaHost.innerHTML = '';
        }
    }

    if (childrenHdrHost && childrenHost) {
        const showChildren = role === 'master' && children.length > 0;
        childrenHdrHost.innerHTML = showChildren ? dsapSmfBuildSectionHdr('Registered children') : '';
        childrenHost.innerHTML = showChildren
            ? dataMgmtDsapReplicationBuildChildrenTableHtml(children, status)
            : '';
        childrenHost.classList.toggle('hidden', !showChildren);
    }

    if (childSummaryHost) {
        const showChild = role === 'child' || role === 'ephemeral';
        childSummaryHost.classList.toggle('hidden', !showChild);
        if (showChild) {
            childSummaryHost.innerHTML = `${dsapSmfBuildSectionHdr('Master link')}${dataMgmtDsapReplicationBuildChildSummaryHtml(status)}`;
        } else {
            childSummaryHost.innerHTML = '';
        }
    }

    if (navHost) navHost.innerHTML = dataMgmtDsapReplicationBuildNavGrid(status);
}

function dataMgmtDsapReplicationRenderStatus(root, status, subRoute) {
    if (!status) return;
    if (!subRoute || subRoute === 'home') {
        dataMgmtDsapReplicationRenderHome(root, status);
        return;
    }
    if (subRoute === 'configuration') {
        const connectivity = status.connectivity || 'normal';
        const connectivityLabel = root.querySelector('#dataMgmtReplConnectivityLabel');
        const connectivityBtn = root.querySelector('#dataMgmtReplConnectivityBtn');
        const galleryLabel = root.querySelector('#dataMgmtReplGallerySharedLabel');
        const transferLabel = root.querySelector('#dataMgmtReplConfigTransferLabel');
        const transferHidden = root.querySelector('#dataMgmtReplConfigTransferHidden');
        const galleryHidden = root.querySelector('#dataMgmtReplConfigGalleryHidden');
        if (connectivityLabel) {
            connectivityLabel.textContent = `Connectivity: ${dataMgmtDsapReplicationConnectivityLabel(connectivity)}`;
        }
        if (connectivityBtn) {
            connectivityBtn.classList.toggle('data-mgmt-repl-airgapped-on', connectivity === 'airgapped');
            connectivityBtn.classList.toggle('data-mgmt-repl-delegated-on', connectivity === 'delegated-only');
        }
        if (galleryLabel) {
            galleryLabel.textContent = `Shared gallery: ${dataMgmtDsapReplicationGalleryLabel(status.gallerySharedDefault || 'manual')}`;
        }
        if (galleryHidden) galleryHidden.value = status.gallerySharedDefault || 'manual';
        if (transferHidden) transferHidden.value = status.transferMode || 'tape-stream-compressed';
        if (transferLabel) {
            transferLabel.textContent = `Default cargo mode: ${dataMgmtDsapReplicationTransferLabel(status.transferMode || 'tape-stream-compressed')}`;
        }
        return;
    }
    if (subRoute === 'progress') {
        const progHost = root.querySelector('#dataMgmtReplProgressPageHost');
        if (progHost) progHost.innerHTML = replicationDsapBuildProgressHtml(replicationDsapGetLiveProgress());
    }
}

function dataMgmtDsapReplicationWireTransferMenu(btn, labelEl, getMode, setMode, hiddenEl) {
    if (!btn || !contextMenu) return;
    const items = REPLICATION_DSAP_TRANSFER_MODES.map((mode) => ({
        text: mode.label,
        action: () => {
            if (mode.id === 'blocks') {
                // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
                showConfirmationDialog(
                    REPLICATION_DSAP_BLOCKS_WARNING,
                    [
                        { text: 'Use Blocks', value: true, className: 'btn-standard primary' },
                        { text: 'Cancel', value: false, className: 'btn-standard' }
                    ],
                    null,
                    {
                        title: 'Blocks transfer mode',
                        resolveValue: (value) => {
                            if (!value) return false;
                            setMode(mode.id);
                            if (labelEl) {
                                labelEl.textContent = hiddenEl
                                    ? `Default cargo mode: ${dataMgmtDsapReplicationTransferLabel(mode.id)}`
                                    : mode.label;
                            }
                            if (hiddenEl) hiddenEl.value = mode.id;
                            return true;
                        }
                    }
                );
                return;
            }
            setMode(mode.id);
            if (labelEl) {
                labelEl.textContent = hiddenEl
                    ? `Default cargo mode: ${dataMgmtDsapReplicationTransferLabel(mode.id)}`
                    : mode.label;
            }
            if (hiddenEl) hiddenEl.value = mode.id;
        }
    }));
    contextMenu.attachClickMenuToElement(btn, items);
}

function dataMgmtDsapReplicationBuildCloneGridHtml(profile, prefix) {
    const pfx = prefix || 'replClone';
    const prof = { ...REPLICATION_DSAP_DEFAULT_CLONE_PROFILE, ...(profile || {}) };
    return REPLICATION_DSAP_CLONE_OPTIONS.map((opt) => {
        const checked = prof[opt.key] ? ' checked' : '';
        const hint = opt.hint ? `<span class="data-mgmt-repl-clone-hint"> (${dataMgmtDsapReplicationEscapeHtml(opt.hint)})</span>` : '';
        return `<label><input type="checkbox" data-${pfx}-key="${dataMgmtDsapReplicationEscapeHtml(opt.key)}"${checked} /> ${dataMgmtDsapReplicationEscapeHtml(opt.label)}${hint}</label>`;
    }).join('');
}

function dataMgmtDsapReplicationReadCloneGrid(dialogRoot, prefix) {
    const pfx = prefix || 'replClone';
    const profile = { ...REPLICATION_DSAP_DEFAULT_CLONE_PROFILE };
    dialogRoot.querySelectorAll(`input[data-${pfx}-key]`).forEach((input) => {
        const key = input.getAttribute(`data-${pfx}-key`);
        if (key) profile[key] = input.checked;
    });
    if (profile.previewCache && !profile.workspaceImages) {
        profile.imageMetadata = true;
    }
    return profile;
}

async function dataMgmtDsapReplicationShowRegisterDialog(host, root) {
    const html = `<div class="data-mgmt-repl-dialog-form" id="dataMgmtReplRegisterForm">
  <p>Pair this node as a <strong>child</strong> using master URLs and the replication token from the separation manifest.</p>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplRegDisplayName">Display name</label><input type="text" id="dataMgmtReplRegDisplayName" /></div>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplRegInstanceId">Instance ID (from manifest)</label><input type="text" id="dataMgmtReplRegInstanceId" /></div>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplRegAccessUrl">Master access URL</label><input type="text" id="dataMgmtReplRegAccessUrl" placeholder="https://master.example.com:9220" /></div>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplRegWsUrl">Master WebSocket URL</label><input type="text" id="dataMgmtReplRegWsUrl" placeholder="wss://master.example.com:9220" /></div>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplRegPeerHost">Peer host (optional)</label><input type="text" id="dataMgmtReplRegPeerHost" /></div>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplRegPeerPort">Peer port (optional)</label><input type="number" id="dataMgmtReplRegPeerPort" placeholder="9221" /></div>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplRegToken">Replication token</label><input type="password" id="dataMgmtReplRegToken" autocomplete="off" /></div>
</div>`;

    await showConfirmationDialog(html, [
        { text: 'Save pairing', value: true, className: 'btn-standard primary' },
        { text: 'Cancel', value: false, className: 'btn-standard' }
    ], null, {
        title: 'Register child manually',
        width: 520,
        resolveValue: async (value) => {
            if (!value) return false;
            const dialog = document.getElementById('confirmationDialog');
            const val = (id) => {
                const el = dialog?.querySelector(id);
                return el ? el.value.trim() : '';
            };
            const displayName = val('#dataMgmtReplRegDisplayName');
            const instanceId = val('#dataMgmtReplRegInstanceId');
            const masterAccessUrl = val('#dataMgmtReplRegAccessUrl');
            const replicationToken = val('#dataMgmtReplRegToken');
            if (!masterAccessUrl || !replicationToken) {
                if (host?.showToast) host.showToast('error', 'Access URL and token required');
                return false;
            }
            const patches = [
                { path: ['replication', 'role'], value: 'child' },
                { path: ['replication', 'connectivity'], value: 'normal' },
                { path: ['replication', 'displayName'], value: displayName || 'child' },
                { path: ['replication', 'masterAccessUrl'], value: masterAccessUrl },
                { path: ['replication', 'masterWsUrl'], value: val('#dataMgmtReplRegWsUrl') || null },
                { path: ['replication', 'masterPeerHost'], value: val('#dataMgmtReplRegPeerHost') || null },
                { path: ['replication', 'masterPeerPort'], value: val('#dataMgmtReplRegPeerPort') ? Number(val('#dataMgmtReplRegPeerPort')) : null },
                { path: ['replication', 'replicationToken'], value: replicationToken },
                { path: ['replication', 'pairedAt'], value: new Date().toISOString() }
            ];
            if (instanceId) patches.push({ path: ['replication', 'instanceId'], value: instanceId });
            try {
                await dataMgmtDsapReplicationSavePatches(patches);
                if (host?.showToast) host.showToast('success', 'Child pairing saved');
                await dataMgmtDsapDriver._refreshReplication(root, host);
                return true;
            } catch (err) {
                if (host?.showToast) host.showToast('error', err.message);
                return false;
            }
        }
    });
}

async function dataMgmtDsapReplicationShowEphemeralDialog(host, root) {
    const state = { airgapped: false };
    const html = `<div class="data-mgmt-repl-dialog-form" id="dataMgmtReplEphemeralForm">
  <p>Configure a short-lived <strong>ephemeral</strong> node (e.g. phone). Use Export cargo to hand work back to the master.</p>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplEphName">Display name</label><input type="text" id="dataMgmtReplEphName" placeholder="phone-session" /></div>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplEphAccessUrl">Master access URL (optional)</label><input type="text" id="dataMgmtReplEphAccessUrl" /></div>
  <div class="data-mgmt-repl-dialog-field"><label for="dataMgmtReplEphWsUrl">Master WS URL (optional)</label><input type="text" id="dataMgmtReplEphWsUrl" /></div>
  <div class="data-mgmt-repl-dialog-field">
    <button type="button" class="dsap-smf-btn" id="dataMgmtReplEphAirgappedBtn"><span id="dataMgmtReplEphAirgappedLabel">Airgapped: off</span></button>
  </div>
  <div class="data-mgmt-repl-dialog-field">
    <label>Clone profile (optional local copies)</label>
    <div class="data-mgmt-repl-clone-grid">${dataMgmtDsapReplicationBuildCloneGridHtml({ wikiData: false, autoComplete: false, previewCache: false, workspaceImages: false }, 'ephClone')}</div>
  </div>
</div>`;

    await showConfirmationDialog(html, [
        { text: 'Apply', value: true, className: 'btn-standard primary' },
        { text: 'Cancel', value: false, className: 'btn-standard' }
    ], null, {
        title: 'Ephemeral setup',
        width: 520,
        onDialogReady: () => {
            setTimeout(() => {
                const dialog = document.getElementById('confirmationDialog');
                const btn = dialog?.querySelector('#dataMgmtReplEphAirgappedBtn');
                const label = dialog?.querySelector('#dataMgmtReplEphAirgappedLabel');
                if (btn && label) {
                    btn.addEventListener('click', () => {
                        state.airgapped = !state.airgapped;
                        label.textContent = state.airgapped ? 'Airgapped: on' : 'Airgapped: off';
                        btn.classList.toggle('data-mgmt-repl-airgapped-on', state.airgapped);
                    });
                }
            }, 0);
        },
        resolveValue: async (value) => {
            if (!value) return false;
            const dialog = document.getElementById('confirmationDialog');
            const nameEl = dialog?.querySelector('#dataMgmtReplEphName');
            const displayName = nameEl ? nameEl.value.trim() : '';
            if (!displayName) {
                if (host?.showToast) host.showToast('error', 'Display name required');
                return false;
            }
            const accessUrl = dialog?.querySelector('#dataMgmtReplEphAccessUrl')?.value.trim() || null;
            const wsUrl = dialog?.querySelector('#dataMgmtReplEphWsUrl')?.value.trim() || null;
            const cloneProfile = dataMgmtDsapReplicationReadCloneGrid(dialog, 'ephClone');
            const patches = [
                { path: ['replication', 'role'], value: 'ephemeral' },
                { path: ['replication', 'connectivity'], value: state.airgapped ? 'airgapped' : 'normal' },
                { path: ['replication', 'displayName'], value: displayName },
                { path: ['replication', 'cloneProfile'], value: cloneProfile },
                { path: ['replication', 'masterAccessUrl'], value: accessUrl },
                { path: ['replication', 'masterWsUrl'], value: wsUrl }
            ];
            try {
                await dataMgmtDsapReplicationSavePatches(patches);
                if (host?.showToast) host.showToast('success', 'Ephemeral node configured');
                await dataMgmtDsapDriver._refreshReplication(root, host);
                return true;
            } catch (err) {
                if (host?.showToast) host.showToast('error', err.message);
                return false;
            }
        }
    });
}

async function dataMgmtDsapReplicationSetConnectivity(host, root, nextConnectivity) {
    const current = dataMgmtDsapDriver._replicationStatus?.connectivity || 'normal';
    if (nextConnectivity === current) return;
    const label = dataMgmtDsapReplicationConnectivityLabel(nextConnectivity);
    let msg = `Set connectivity to <strong>${dataMgmtDsapReplicationEscapeHtml(label)}</strong>?`;
    if (nextConnectivity === 'airgapped') {
        msg = 'Enable <strong>airgapped</strong> mode? This node will not contact the master — use manual cargo transfer for sync.';
    } else if (nextConnectivity === 'delegated-only') {
        msg = 'Enable <strong>delegated-only</strong> mode? Delegation and asset reads stay available; bulk cargo and sync to master are disabled.';
    } else if (current === 'airgapped' || current === 'delegated-only') {
        msg = 'Restore <strong>normal</strong> connectivity and re-enable bulk cargo/sync probing?';
    }
    await showConfirmationDialog(msg, [
        { text: 'Confirm', value: true, className: 'btn-standard primary' },
        { text: 'Cancel', value: false, className: 'btn-standard' }
    ], null, {
        title: 'Connectivity mode',
        resolveValue: async (value) => {
            if (!value) return false;
            try {
                await dataMgmtDsapReplicationSavePatches([
                    { path: ['replication', 'connectivity'], value: nextConnectivity }
                ]);
                if (host?.showToast) host.showToast('success', `Connectivity: ${label}`);
                await dataMgmtDsapDriver._refreshReplication(root, host);
                return true;
            } catch (err) {
                if (host?.showToast) host.showToast('error', err.message);
                return false;
            }
        }
    });
}

function dataMgmtDsapReplicationWireConnectivityMenu(btn, labelEl, status, host, root) {
    if (!btn || !contextMenu) return;
    const current = status?.connectivity || 'normal';
    const items = REPLICATION_DSAP_CONNECTIVITY_OPTIONS.map((opt) => ({
        text: opt.label,
        icon: opt.id === current ? 'fas fa-check' : '',
        action: () => {
            void dataMgmtDsapReplicationSetConnectivity(host, root, opt.id);
        }
    }));
    contextMenu.attachClickMenuToElement(btn, items);
}

function dataMgmtDsapReplicationMountPanels(root, host, subRoute) {
    const sepHost = root.querySelector('#dataMgmtReplicationSepHost');
    const cargoHost = root.querySelector('#dataMgmtReplicationCargoHost');
    const syncHost = root.querySelector('#dataMgmtReplicationSyncHost');
    const bundleWizard = root.querySelector('[data-replication-bundle-wizard]');

    if (bundleWizard && typeof replicationSepInitBundleWizard === 'function') {
        replicationSepInitBundleWizard(root, host);
    }

    if (sepHost && typeof replicationSepGetPanelContent === 'function') {
        const content = replicationSepGetPanelContent();
        sepHost.innerHTML = content.html;
        const sepRoot = sepHost.querySelector('[data-dsap="replication-separation-panel"]');
        if (sepRoot) replicationSepInitBootstrapPanel({ getRoot: () => sepRoot });
    }

    if (cargoHost && subRoute === 'upsert' && typeof replicationDsapCargoBuildPanel === 'function') {
        cargoHost.innerHTML = replicationDsapCargoBuildPanel();
        replicationDsapCargoInitPanel(cargoHost, host);
    }

    if (syncHost && subRoute === 'sync' && typeof replicationDsapSyncBuildPanel === 'function') {
        syncHost.innerHTML = replicationDsapSyncBuildPanel();
        replicationDsapSyncInitPanel(syncHost, host);
    }
}

function dataMgmtDsapReplicationTeardownPanels(root) {
    const sepHost = root.querySelector('#dataMgmtReplicationSepHost');
    const cargoHost = root.querySelector('#dataMgmtReplicationCargoHost');
    const syncHost = root.querySelector('#dataMgmtReplicationSyncHost');
    if (typeof replicationSepDestroyPanel === 'function') replicationSepDestroyPanel();
    if (cargoHost && typeof replicationDsapCargoDestroyPanel === 'function') replicationDsapCargoDestroyPanel(cargoHost);
    if (syncHost && typeof replicationDsapSyncDestroyPanel === 'function') replicationDsapSyncDestroyPanel(syncHost);
}

function dataMgmtDsapReplicationDetachMenus(root) {
    if (!contextMenu || !dataMgmtDsapDriver._replMenuTargets) return;
    dataMgmtDsapDriver._replMenuTargets.forEach((btn) => {
        contextMenu.detachClickMenuFromElement(btn);
    });
    dataMgmtDsapDriver._replMenuTargets = [];
}

function dataMgmtDsapReplicationUnwireNav(root) {
    if (!root || !dataMgmtDsapDriver._replNavClickHandler) return;
    root.removeEventListener('click', dataMgmtDsapDriver._replNavClickHandler);
    dataMgmtDsapDriver._replNavClickHandler = null;
    dataMgmtDsapDriver._replNavDelegated = false;
}

function dataMgmtDsapReplicationWireNav(root, host) {
    if (!root || dataMgmtDsapDriver._replNavDelegated) return;
    dataMgmtDsapDriver._replNavDelegated = true;
    dataMgmtDsapDriver._replNavClickHandler = (e) => {
        const el = e.target.closest('[data-repl-nav]');
        if (!el || !root.contains(el)) return;
        if (el.disabled || el.classList.contains('data-mgmt-repl-nav-disabled') || el.classList.contains('hidden')) {
            return;
        }
        e.preventDefault();
        const target = el.getAttribute('data-repl-nav') || 'home';
        const navHost = dataMgmtDsapDriver._host || host;
        if (navHost?.navigate) {
            navHost.navigate(dataMgmtDsapBuildReplicationUrl(target));
        }
    };
    root.addEventListener('click', dataMgmtDsapDriver._replNavClickHandler);
}

async function dataMgmtDsapReplicationSaveConfiguration(root, host) {
    const transferHidden = root.querySelector('#dataMgmtReplConfigTransferHidden');
    const galleryHidden = root.querySelector('#dataMgmtReplConfigGalleryHidden');
    const status = dataMgmtDsapDriver._replicationStatus || {};
    const patches = [];
    if (transferHidden?.value) {
        patches.push({ path: ['replication', 'transferMode'], value: transferHidden.value });
    }
    if (galleryHidden?.value) {
        patches.push({ path: ['replication', 'gallerySharedDefault'], value: galleryHidden.value });
    }
    if (!patches.length) return;
    try {
        await dataMgmtDsapReplicationSavePatches(patches);
        if (host?.showToast) host.showToast('success', 'Replication defaults saved');
        await dataMgmtDsapDriver._refreshReplication(root, host);
    } catch (err) {
        if (host?.showToast) host.showToast('error', err.message);
    }
}

function dataMgmtDsapReplicationWirePage(root, host, subRoute) {
    dataMgmtDsapReplicationDetachMenus(root);
    dataMgmtDsapDriver._replMenuTargets = [];

    dataMgmtDsapReplicationMountPanels(root, host, subRoute);
    dataMgmtDsapReplicationWireNav(root, host);

    const galleryBtn = root.querySelector('#dataMgmtReplGallerySharedBtn');
    if (galleryBtn && contextMenu) {
        const galleryHidden = root.querySelector('#dataMgmtReplConfigGalleryHidden');
        const items = REPLICATION_DSAP_GALLERY_SHARED_OPTIONS.map((opt) => ({
            text: opt.label,
            action: () => {
                if (galleryHidden) galleryHidden.value = opt.id;
                const label = root.querySelector('#dataMgmtReplGallerySharedLabel');
                if (label) label.textContent = `Shared gallery: ${opt.label}`;
                if (subRoute !== 'configuration') {
                    void dataMgmtDsapReplicationSavePatches([
                        { path: ['replication', 'gallerySharedDefault'], value: opt.id }
                    ]).then(() => {
                        if (host?.showToast) host.showToast('success', 'Gallery preference saved');
                    }).catch((err) => {
                        if (host?.showToast) host.showToast('error', err.message);
                    });
                }
            }
        }));
        contextMenu.attachClickMenuToElement(galleryBtn, items);
        dataMgmtDsapDriver._replMenuTargets.push(galleryBtn);
    }

    const transferBtn = root.querySelector('#dataMgmtReplConfigTransferBtn');
    const transferLabel = root.querySelector('#dataMgmtReplConfigTransferLabel');
    const transferHidden = root.querySelector('#dataMgmtReplConfigTransferHidden');
    if (transferBtn) {
        const state = { mode: transferHidden?.value || 'tape-stream-compressed' };
        dataMgmtDsapReplicationWireTransferMenu(
            transferBtn,
            transferLabel,
            () => state.mode,
            (id) => { state.mode = id; },
            transferHidden
        );
        dataMgmtDsapDriver._replMenuTargets.push(transferBtn);
    }

    const saveBtn = root.querySelector('#dataMgmtReplConfigSaveBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            void dataMgmtDsapReplicationSaveConfiguration(root, host);
        });
    }

    const connectivityBtn = root.querySelector('#dataMgmtReplConnectivityBtn');
    const connectivityLabel = root.querySelector('#dataMgmtReplConnectivityLabel');
    if (connectivityBtn) {
        dataMgmtDsapReplicationWireConnectivityMenu(
            connectivityBtn,
            connectivityLabel,
            dataMgmtDsapDriver._replicationStatus,
            host,
            root
        );
        dataMgmtDsapDriver._replMenuTargets.push(connectivityBtn);
    }

    const registerBtn = root.querySelector('#dataMgmtReplRegisterBtn');
    if (registerBtn) {
        registerBtn.addEventListener('click', () => {
            void dataMgmtDsapReplicationShowRegisterDialog(host, root);
        });
    }

    const ephemeralBtn = root.querySelector('#dataMgmtReplEphemeralBtn');
    if (ephemeralBtn) {
        ephemeralBtn.addEventListener('click', () => {
            void dataMgmtDsapReplicationShowEphemeralDialog(host, root);
        });
    }

    if (host && typeof host.on === 'function' && !dataMgmtDsapDriver._replWired) {
        dataMgmtDsapDriver._replWired = true;
        host.on('replication_maintenance', (msg) => {
            replicationDsapApplyMaintenancePush(msg?.data || msg);
            void dataMgmtDsapDriver._refreshReplication(root, host);
        });
        host.on('replication_progress', (msg) => {
            replicationDsapApplyProgressPush(msg?.data || msg);
            const sub = dataMgmtDsapResolveReplicationSubRoute(host);
            if (sub === 'progress') {
                const progHost = root.querySelector('#dataMgmtReplProgressPageHost');
                if (progHost) progHost.innerHTML = replicationDsapBuildProgressHtml(replicationDsapGetLiveProgress());
            }
            void dataMgmtDsapDriver._refreshReplication(root, host);
        });
    }

    void dataMgmtDsapDriver._refreshReplication(root, host, subRoute);
}

const dataMgmtDsapScopedCss = `
[data-dsap="data-mgmt"] .data-mgmt-view { padding: 4px 0 0; }
[data-dsap="data-mgmt"] .data-mgmt-account-host { margin-bottom: 12px; }
[data-dsap="data-mgmt"] .data-mgmt-opus-usage-host { margin-top: 10px; }
[data-dsap="data-mgmt"] .data-mgmt-opus-usage-bar-wrap { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
[data-dsap="data-mgmt"] .data-mgmt-opus-usage-bar { height: 8px; width: 100%; background: #e8eef4; border: 1px solid #c5ced8; }
[data-dsap="data-mgmt"] .data-mgmt-opus-usage-bar .token-progress-fill { height: 100%; background: #3a7bd5; }
[data-dsap="data-mgmt"] .data-mgmt-opus-usage-bar .token-progress-fill.low { background: #c79100; }
[data-dsap="data-mgmt"] .data-mgmt-account-info-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 5px; background: #fff; }
[data-dsap="data-mgmt"] .data-mgmt-account-info-table td { padding: 4px 6px; border: 1px solid #e2e8ee; vertical-align: top; }
[data-dsap="data-mgmt"] .data-mgmt-account-info-label { width: 34%; font-weight: 600; background: #f4f6f8; color: var(--dsap-smf-context-bg, #336699); white-space: nowrap; }
[data-dsap="data-mgmt"] .data-mgmt-account-info-value { word-break: break-word; }
[data-dsap="data-mgmt"] .data-mgmt-ban-host { margin-top: 5px; }
[data-dsap="data-mgmt"] .data-mgmt-ban-label { display: block; font-weight: 600; margin-bottom: 4px; }
[data-dsap="data-mgmt"] .data-mgmt-ban-text { font-weight: normal; white-space: pre-wrap; word-break: break-word; line-height: 1.4; }
[data-dsap="data-mgmt"] .data-mgmt-view.data-mgmt-view-fill { min-height: calc(100vh - 180px); }
[data-dsap="data-mgmt"] .data-mgmt-status-layout { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
[data-dsap="data-mgmt"] .data-mgmt-status-left { flex: 0 0 280px; min-width: 240px; max-width: 100%; }
[data-dsap="data-mgmt"] .data-mgmt-status-right { flex: 1 1 320px; min-width: 280px; }
[data-dsap="data-mgmt"] .data-mgmt-panel-hdr { font-weight: 600; font-size: 0.85rem; margin: 0 0 6px; color: var(--dsap-smf-context-bg, #336699); }
[data-dsap="data-mgmt"] .data-mgmt-panel-hdr-spaced { margin-top: 14px; }
[data-dsap="data-mgmt"] .data-mgmt-pie-host,
[data-dsap="data-mgmt"] .data-mgmt-table-host { background: #fff; border: 1px solid #b8c4d0; padding: 8px; min-height: 80px; }
[data-dsap="data-mgmt"] .data-mgmt-pie-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; }
[data-dsap="data-mgmt"] .data-mgmt-pie-chart { width: 200px; height: 200px; max-width: 100%; }
[data-dsap="data-mgmt"] .data-mgmt-pie-legend { width: 100%; font-size: 0.8rem; }
[data-dsap="data-mgmt"] .data-mgmt-pie-legend-item { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
[data-dsap="data-mgmt"] .data-mgmt-pie-swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.15); }
[data-dsap="data-mgmt"] .data-mgmt-pie-legend-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-dsap="data-mgmt"] .data-mgmt-pie-legend-value { white-space: nowrap; color: #555; }
[data-dsap="data-mgmt"] .data-mgmt-pie-empty,
[data-dsap="data-mgmt"] .data-mgmt-muted { color: #666; font-size: 0.85rem; }
[data-dsap="data-mgmt"] .data-mgmt-loading { color: #666; font-size: 0.85rem; padding: 12px; text-align: center; }
[data-dsap="data-mgmt"] .data-mgmt-workspaces-table,
[data-dsap="data-mgmt"] .data-mgmt-storage-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
[data-dsap="data-mgmt"] .data-mgmt-workspaces-table thead th,
[data-dsap="data-mgmt"] .data-mgmt-storage-table thead th { text-align: right; padding: 4px 6px; border-bottom: 1px solid #c5ced8; font-weight: 600; background: #f4f6f8; }
[data-dsap="data-mgmt"] .data-mgmt-workspaces-table tbody td,
[data-dsap="data-mgmt"] .data-mgmt-storage-table tbody td { padding: 4px 6px; border-bottom: 1px solid #e2e8ee; }
[data-dsap="data-mgmt"] .data-mgmt-ws-name-header,
[data-dsap="data-mgmt"] .data-mgmt-storage-label { text-align: left!important; width: 100%; }
[data-dsap="data-mgmt"] .data-mgmt-ws-col,
[data-dsap="data-mgmt"] .data-mgmt-storage-value { text-align: right; white-space: nowrap; }
[data-dsap="data-mgmt"] .data-mgmt-ws-table,
[data-dsap="data-mgmt"] .data-mgmt-favorites-table { margin-top: 2px; }
[data-dsap="data-mgmt"] .data-mgmt-ws-name-cell { text-align: left; vertical-align: middle; }
[data-dsap="data-mgmt"] .data-mgmt-ws-name-cell span.workspace-color-indicator { display: inline-block; vertical-align: middle; }
[data-dsap="data-mgmt"] .data-mgmt-ws-color { display: inline-block; width: 10px; height: 20px; border: 1px solid rgba(0,0,0,0.2); margin-right: 6px; vertical-align: middle; }
[data-dsap="data-mgmt"] .data-mgmt-ws-name { font-weight: 600; vertical-align: middle; }
[data-dsap="data-mgmt"] .data-mgmt-ws-active { color: #228822; margin-left: 4px; vertical-align: middle; }
[data-dsap="data-mgmt"] .data-mgmt-ws-drag-cell { color: #666; }
[data-dsap="data-mgmt"] .data-mgmt-ws-drag-handle { cursor: grab; display: inline-block; }
[data-dsap="data-mgmt"] .data-mgmt-ws-drag-handle:active { cursor: grabbing; }
[data-dsap="data-mgmt"] .data-mgmt-ws-actions-cell,
[data-dsap="data-mgmt"] .data-mgmt-fav-actions { white-space: nowrap; text-align: center; }
[data-dsap="data-mgmt"] .data-mgmt-ws-actions-cell .dsap-smf-btn,
[data-dsap="data-mgmt"] .data-mgmt-fav-actions .dsap-smf-btn { padding: 3px 8px;
    margin: 0 1px;
    min-width: 26px;
    min-height: 28px;
    max-width: 30px;
    max-height: 28px;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    vertical-align: middle; }
[data-dsap="data-mgmt"] .data-mgmt-ws-row.dragging { opacity: 0.55; background: #ffffee; }
[data-dsap="data-mgmt"] .data-mgmt-ws-row.drag-over { outline: 1px dashed var(--dsap-smf-tab-accent, #ff8c00); }
[data-dsap="data-mgmt"] .data-mgmt-fav-name { font-weight: 600; }
[data-dsap="data-mgmt"] .data-mgmt-fav-detail { color: #333; word-break: break-word; }
[data-dsap="data-mgmt"] .data-mgmt-fav-type { color: #555; }
[data-dsap="data-mgmt"] #dataMgmtFavoritesEmpty small { display: block; margin-top: 6px; color: #666; font-weight: normal; }
[data-dsap="data-mgmt"] .data-mgmt-stub { background: #fff; border: 1px solid #b8c4d0; padding: 14px 16px; }
[data-dsap="data-mgmt"] .data-mgmt-stub-lead { font-weight: 600; margin: 0 0 8px; }
[data-dsap="data-mgmt"] .data-mgmt-stub-body p { margin: 0 0 8px; font-size: 0.85rem; line-height: 1.45; }
`;

const dataMgmtDsapDriver = {
    _host: null,
    _statusData: null,
    _accountListenersWired: false,
    _indexingListenersWired: false,
    _replicationStatus: null,
    _replMenuTargets: [],
    _replWired: false,

    init(host) {
        this._host = host;
        const root = host.getRoot();
        const activeTab = dataMgmtDsapResolveActiveTab(host);

        dsapSmfWireTabBar(root, '#dataMgmtTabBar', 'data-data-tab', (tabId) => dataMgmtDsapBuildTabUrl(tabId), host);

        const viewHost = root.querySelector('#dataMgmtViewHost');
        if (!viewHost) return;

        viewHost.classList.toggle('data-mgmt-view-fill', activeTab === 'workspaces' || activeTab === 'favorites' || activeTab === 'replication');

        if (activeTab === 'search') {
            host.navigate(`dsap://${DATA_ISPY_URL}/`);
            return;
        }

        if (activeTab === 'status') {
            viewHost.innerHTML = dataMgmtDsapBuildStatusHtml();
            dataMgmtDsapRenderAccountSection(root);
            this._wireAccountListeners(host, root);
            dataMgmtDsapIndexingWireControls(root);
            this._wireIndexingListeners(host, root);
            void this._loadStatus(root);
        } else if (activeTab === 'workspaces') {
            viewHost.innerHTML = dataMgmtDsapBuildWorkspacesHtml();
            setTimeout(() => this._wireWorkspaces(root), 0);
        } else if (activeTab === 'favorites') {
            viewHost.innerHTML = dataMgmtDsapBuildFavoritesHtml();
            setTimeout(() => void this._wireFavorites(root), 0);
        } else if (activeTab === 'spellbook') {
            viewHost.innerHTML = dataMgmtDsapBuildSpellbookHtml();
            setTimeout(() => this._wireStubs(root), 0);
        } else if (activeTab === 'expanders') {
            viewHost.innerHTML = dataMgmtDsapBuildExpandersHtml();
            setTimeout(() => this._wireStubs(root), 0);
        } else if (activeTab === 'replication') {
            const subRoute = dataMgmtDsapResolveReplicationSubRoute(host);
            viewHost.innerHTML = dataMgmtDsapReplicationBuildPageHtml(subRoute, this._replicationStatus);
            dsapSmfUpdateHeaderTool(root, REPLICATION_DSAP_SUB_LABELS[subRoute] || 'Replication');
            setTimeout(() => dataMgmtDsapReplicationWirePage(root, host, subRoute), 0);
        } else {
            viewHost.innerHTML = dataMgmtDsapBuildStatusHtml();
            dataMgmtDsapRenderAccountSection(root);
            this._wireAccountListeners(host, root);
            void this._loadStatus(root);
        }

        dsapSmfSetActiveTab(root, 'data-data-tab', activeTab);
        // dsapSmfUpdateHeaderTool: public/scripts/comp/dsapSmfMarkup.js
        dsapSmfUpdateHeaderTool(root, DATA_DSAP_TAB_LABELS[activeTab] || 'Status');
        this._wireGrimoireContextMenus(host);
    },

    _wireGrimoireContextMenus(host) {
        if (!host || typeof host.registerContextMenuItems !== 'function') return;
        if (host._dataMgmtCtxWired) return;
        host._dataMgmtCtxWired = true;

        const copyText = (text) => {
            if (!text) return;
            // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
            copyTextToClipboard(text).then(() => {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, 'Copied to clipboard', false, 3000, '<i class="fas fa-check"></i>');
                }
            }).catch(() => {});
        };

        host.registerContextMenuItems('.data-mgmt-ws-row', (el) => {
            const id = el.dataset.workspaceId;
            if (!id) return [];
            const name = el.querySelector('.data-mgmt-ws-name')?.textContent?.trim() || id;
            const isDefault = id === 'default';
            const items = [
                { text: 'Workspace Settings', icon: 'fas fa-cog', action: 'dm-ws-settings', data: { id } },
                { text: 'Copy Workspace ID', icon: 'fas fa-copy', action: 'dm-ws-copy-id', data: { id } }
            ];
            if (!isDefault) {
                items.push(
                    { text: 'Dump Workspace', icon: 'mdi mdi-folder-move', action: 'dm-ws-dump', data: { id, name } },
                    { text: 'Delete Workspace', icon: 'fas fa-trash', action: 'dm-ws-delete', data: { id, name } }
                );
            }
            return items;
        });

        host.registerContextMenuItems('.data-mgmt-fav-row', (el) => {
            const name = el.querySelector('.data-mgmt-fav-name')?.textContent?.trim() || '';
            const type = el.dataset.type;
            const index = el.dataset.index;
            const removeType = type === 'tag' ? 'tags' : 'textReplacements';
            return [
                { text: 'Copy Name', icon: 'fas fa-copy', action: 'dm-fav-copy-name', data: { name } },
                {
                    text: 'Remove Favorite',
                    icon: 'fas fa-trash',
                    action: 'dm-fav-remove',
                    data: { type: removeType, index: Number(index) }
                }
            ];
        });

        host.registerContextMenuAction('dm-ws-settings', (el, item) => {
            const id = item?.data?.id || el?.dataset?.workspaceId;
            // editWorkspaceSettings: public/scripts/comp/workspaceUtils.js (or workspace UI)
            if (id && typeof editWorkspaceSettings === 'function') editWorkspaceSettings(id);
        });
        host.registerContextMenuAction('dm-ws-copy-id', (el, item) => {
            copyText(item?.data?.id || el?.dataset?.workspaceId);
        });
        host.registerContextMenuAction('dm-ws-dump', (el, item) => {
            const id = item?.data?.id || el?.dataset?.workspaceId;
            const name = item?.data?.name || '';
            // showDumpWorkspaceModal: workspace dump UI
            if (id && typeof showDumpWorkspaceModal === 'function') showDumpWorkspaceModal(id, name);
        });
        host.registerContextMenuAction('dm-ws-delete', (el, item) => {
            const id = item?.data?.id || el?.dataset?.workspaceId;
            const name = item?.data?.name || '';
            // confirmDeleteWorkspace: workspace delete UI
            if (id && typeof confirmDeleteWorkspace === 'function') confirmDeleteWorkspace(id, name);
        });
        host.registerContextMenuAction('dm-fav-copy-name', (el, item) => {
            copyText(item?.data?.name || el?.querySelector?.('.data-mgmt-fav-name')?.textContent?.trim());
        });
        host.registerContextMenuAction('dm-fav-remove', (el, item) => {
            const type = item?.data?.type;
            const index = item?.data?.index;
            // removeFavorite: public/scripts/comp/textReplacementManager.js
            if (type != null && index != null && typeof removeFavorite === 'function') {
                removeFavorite(type, Number(index));
            }
        });
    },

    destroy(host) {
        this._host = null;
        this._statusData = null;
        this._accountListenersWired = false;
        this._replicationStatus = null;
        this._replWired = false;
        const root = host?.getRoot?.();
        if (root) {
            dataMgmtDsapReplicationUnwireNav(root);
            dataMgmtDsapReplicationDetachMenus(root);
            dataMgmtDsapReplicationTeardownPanels(root);
        }
        this._replMenuTargets = [];
        if (!root) return;
        const addBtn = root.querySelector('#dataMgmtWorkspaceAddBtn');
        if (addBtn) addBtn.replaceWith(addBtn.cloneNode(true));
    },

    refresh(host) {
        this.init(host);
    },

    _wireAccountListeners(host, root) {
        if (this._accountListenersWired) return;
        this._accountListenersWired = true;
        host.on('ping', () => {
            const accountHost = root.querySelector('#dataMgmtAccountHost');
            if (accountHost) dataMgmtDsapRenderAccountSection(root);
        });
    },

    _wireIndexingListeners(host, root) {
        if (this._indexingListenersWired) return;
        this._indexingListenersWired = true;
        const indexingHost = root.querySelector('#dataMgmtIndexingHost');
        dataMgmtDsapIndexingWireStatusListener(indexingHost, root);
    },

    async _loadStatus(root) {
        const pieHost = root.querySelector('#dataMgmtPieHost');
        const wsHost = root.querySelector('#dataMgmtWorkspacesTableHost');
        const storageHost = root.querySelector('#dataMgmtStorageTableHost');
        void dataMgmtDsapReplicationLoadStatusSummary(root);
        void dataMgmtDsapIndexingLoad(root);
        if (!pieHost || !wsHost || !storageHost) return;

        if (!window.wsClient?.isConnected()) {
            const err = '<p class="data-mgmt-muted">System information unavailable (WebSocket not connected)</p>';
            pieHost.innerHTML = err;
            wsHost.innerHTML = err;
            storageHost.innerHTML = err;
            return;
        }

        try {
            const response = await window.wsClient.sendMessage('get_system_info', {});
            const data = response?.data || response;
            this._statusData = data;
            pieHost.innerHTML = dataMgmtDsapBuildPieSvg(data?.workspaces || []);
            wsHost.innerHTML = dataMgmtDsapBuildWorkspacesTableHtml(data?.workspaces || []);
            storageHost.innerHTML = dataMgmtDsapBuildStorageTableHtml(data?.usage || null);
        } catch (e) {
            const err = '<p class="data-mgmt-muted">Failed to load system information</p>';
            pieHost.innerHTML = err;
            wsHost.innerHTML = err;
            storageHost.innerHTML = err;
        }
    },

    _wireWorkspaces(root) {
        const addBtn = root.querySelector('#dataMgmtWorkspaceAddBtn');
        if (addBtn && !addBtn.dataset.wired) {
            addBtn.dataset.wired = '1';
            addBtn.addEventListener('click', () => {
                // showAddWorkspaceModal: public/scripts/comp/workspaceUtils.js
                showAddWorkspaceModal();
            });
        }
        dataMgmtDsapRenderWorkspaceList(root);
    },

    async _wireFavorites(root) {
        // loadFavorites: public/scripts/comp/textReplacementManager.js
        if (typeof loadFavorites === 'function') await loadFavorites();
        dataMgmtDsapRenderFavoritesList(root);
    },

    _wireStubs(root) {
        const spellbookBtn = root.querySelector('#dataMgmtOpenSpellbookLegacyBtn');
        if (spellbookBtn && !spellbookBtn.dataset.wired) {
            spellbookBtn.dataset.wired = '1';
            spellbookBtn.addEventListener('click', () => {
                // showPresetManager: public/scripts/comp/presetManager.js
                showPresetManager();
            });
        }
        const expandersBtn = root.querySelector('#dataMgmtOpenExpandersLegacyBtn');
        if (expandersBtn && !expandersBtn.dataset.wired) {
            expandersBtn.dataset.wired = '1';
            expandersBtn.addEventListener('click', () => {
                // showTextReplacementManager: public/scripts/comp/textReplacementManager.js
                showTextReplacementManager();
            });
        }
    },

    async _refreshReplication(root, host, subRoute) {
        const route = subRoute || (host ? dataMgmtDsapResolveReplicationSubRoute(host) : 'home');
        try {
            const status = await dataMgmtDsapReplicationFetchStatus();
            this._replicationStatus = status;
            dataMgmtDsapReplicationRenderStatus(root, status, route);
            const cargoHost = root.querySelector('#dataMgmtReplicationCargoHost');
            const syncHost = root.querySelector('#dataMgmtReplicationSyncHost');
            if (cargoHost && typeof replicationDsapCargoRefreshPanel === 'function') {
                await replicationDsapCargoRefreshPanel(cargoHost, host);
            }
            if (syncHost && typeof replicationDsapSyncRefreshPanel === 'function') {
                await replicationDsapSyncRefreshPanel(syncHost, host);
            }
            if (status.maintenance?.active && route === 'home' && host?.navigate) {
                host.navigate(dataMgmtDsapBuildReplicationUrl('progress'));
            }
            // refreshReplicationClientState: public/scripts/comp/masterWsBridge.js
            if (typeof refreshReplicationClientState === 'function') {
                void refreshReplicationClientState().then(() => {
                    if (route === 'home') dataMgmtDsapReplicationRenderHome(root, status);
                });
            }
            const statusReplHost = document.getElementById('dataMgmtStatusReplicationHost');
            if (statusReplHost) {
                statusReplHost.innerHTML = dataMgmtDsapReplicationBuildStatusSummaryHtml(status);
                const openBtn = statusReplHost.querySelector('[data-open-replication-tab]');
                if (openBtn) {
                    openBtn.addEventListener('click', () => {
                        // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
                        if (typeof openDsapInGrimoire === 'function') {
                            openDsapInGrimoire(dataMgmtDsapBuildReplicationUrl('home'));
                        }
                    });
                }
            }
        } catch (err) {
            console.error('[replication] status refresh failed:', err);
            const roleEl = root.querySelector('#dataMgmtReplRole');
            if (roleEl) roleEl.textContent = 'unavailable';
            if (host?.showToast) host.showToast('error', err.message || 'Replication status unavailable');
        }
    }
};

function registerDataManagementDsapApplet() {
    // registerDsap: public/scripts/comp/dsapRegistry.js
    if (typeof registerDsap !== 'function') return;

    registerDsap({
        url: DATA_DSAP_URL,
        theme: 'dsap-smf',
        getContent(match) {
            const hostStub = {
                getPathSegments() {
                    const norm = typeof normalizeDsapUrlInput === 'function'
                        ? normalizeDsapUrlInput(match.canonicalUrl)
                        : match.canonicalUrl;
                    const base = DATA_DSAP_URL;
                    if (!norm.startsWith(base)) return [];
                    const rest = norm.slice(base.length).replace(/^\//, '');
                    const pathOnly = rest.split('?')[0];
                    return pathOnly ? pathOnly.split('/').filter(Boolean) : [];
                },
                getQueryParam() { return null; }
            };
            const activeTab = dataMgmtDsapResolveActiveTab(hostStub);
            return {
                html: dataMgmtDsapBuildShellHtml(activeTab),
                css: dataMgmtDsapScopedCss,
                drivers: dataMgmtDsapDriver,
                baseBackground: '#eeeeee'
            };
        }
    });
}

registerDataManagementDsapApplet();
