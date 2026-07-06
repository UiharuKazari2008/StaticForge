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
    search: 'Search'
};
const DATA_DSAP_RESERVED_SEGMENTS = new Set(['status', 'workspaces', 'spellbook', 'expanders', 'favorites', 'search']);

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
    return `dsap://${DATA_DSAP_URL}/${tabId}`;
}

function dataMgmtDsapBuildTabBar(activeTabId) {
    return dsapSmfBuildTabBar([
        { id: 'status', label: 'Status', icon: 'fas fa-gauge-high' },
        { id: 'workspaces', label: 'Workspaces', icon: 'fas fa-planet-ringed' },
        { id: 'spellbook', label: 'Spellbook', icon: 'fas fa-book-spells' },
        { id: 'expanders', label: 'Expanders', icon: 'fas fa-book-font' },
        { id: 'favorites', label: 'Favorites', icon: 'fas fa-star' },
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

    const optionsData = window.optionsData || null;
    const user = optionsData?.user || null;
    const balance = optionsData?.balance || null;
    const accountUsable = !optionsData?.accountDataDeferred && optionsData?.userDataValid !== false;
    const userValid = accountUsable && dataMgmtDsapIsUserDataValid(user);
    const balanceValid = accountUsable && dataMgmtDsapIsBalanceDataValid(balance, user);
    const standing = dataMgmtDsapResolveAccountStanding(user, balance, optionsData);

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
        const banMessage = dataMgmtDsapResolveBanMessage(user, optionsData);
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
</div>`;
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

        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);
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

        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', endDrag);

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

const dataMgmtDsapScopedCss = `
[data-dsap="data-mgmt"] .data-mgmt-view { padding: 4px 0 0; }
[data-dsap="data-mgmt"] .data-mgmt-account-host { margin-bottom: 12px; }
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

    init(host) {
        this._host = host;
        const root = host.getRoot();
        const activeTab = dataMgmtDsapResolveActiveTab(host);

        dsapSmfWireTabBar(root, '#dataMgmtTabBar', 'data-data-tab', (tabId) => dataMgmtDsapBuildTabUrl(tabId), host);

        const viewHost = root.querySelector('#dataMgmtViewHost');
        if (!viewHost) return;

        viewHost.classList.toggle('data-mgmt-view-fill', activeTab === 'workspaces' || activeTab === 'favorites');

        if (activeTab === 'search') {
            host.navigate(`dsap://${DATA_ISPY_URL}/`);
            return;
        }

        if (activeTab === 'status') {
            viewHost.innerHTML = dataMgmtDsapBuildStatusHtml();
            dataMgmtDsapRenderAccountSection(root);
            this._wireAccountListeners(host, root);
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
        } else {
            viewHost.innerHTML = dataMgmtDsapBuildStatusHtml();
            dataMgmtDsapRenderAccountSection(root);
            this._wireAccountListeners(host, root);
            void this._loadStatus(root);
        }

        dsapSmfSetActiveTab(root, 'data-data-tab', activeTab);
        // dsapSmfUpdateHeaderTool: public/scripts/comp/dsapSmfMarkup.js
        dsapSmfUpdateHeaderTool(root, DATA_DSAP_TAB_LABELS[activeTab] || 'Status');
    },

    destroy(host) {
        this._host = null;
        this._statusData = null;
        this._accountListenersWired = false;
        const root = host?.getRoot?.();
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

    async _loadStatus(root) {
        const pieHost = root.querySelector('#dataMgmtPieHost');
        const wsHost = root.querySelector('#dataMgmtWorkspacesTableHost');
        const storageHost = root.querySelector('#dataMgmtStorageTableHost');
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
