/**
 * Menma progress DSAP — cake ledger, day's work, breakfast images.
 * Domain: menma.dyna.dreamscape.jp
 * Depends on: dsapRegistry.js, dsapSmfMarkup.js, assetUrlResolver.js, manualModalManager.js
 * Server: WS get_menma_state (session)
 */

const MENMA_DSAP_URL = 'menma.dyna.dreamscape.jp';
const MENMA_DSAP_ID = 'menma';
const MENMA_POLL_MS = 60000;
const MENMA_TZ = 'America/New_York';

const MENMA_TAB_LABELS = {
    status: 'Status',
    work: 'Work',
    log: 'Log'
};

const menmaDsapScopedCss = `
[data-dsap="menma"] .menma-view { padding: 8px 10px 16px; }
[data-dsap="menma"] .menma-pair { display: flex; gap: 10px; flex-wrap: wrap; }
[data-dsap="menma"] .menma-shot { width: 240px; max-width: 100%; background: #fff; border: 1px solid #8aa; }
[data-dsap="menma"] .menma-shot img { width: 100%; height: 180px; object-fit: cover; display: block; cursor: pointer; background: #dde; }
[data-dsap="menma"] .menma-shot-cap { padding: 4px 6px; font-size: 11px; display: flex; justify-content: space-between; gap: 6px; align-items: center; }
[data-dsap="menma"] .menma-shot-cap button { flex-shrink: 0; }
[data-dsap="menma"] .menma-work-item, [data-dsap="menma"] .menma-log-item {
    border: 1px solid #9ab; background: #f7f7f4; margin: 0 0 8px; padding: 6px 8px;
}
[data-dsap="menma"] .menma-work-item strong, [data-dsap="menma"] .menma-log-item strong { display: block; }
[data-dsap="menma"] .menma-muted { color: #556; font-size: 11px; }
[data-dsap="menma"] .menma-empty { padding: 10px 4px; color: #556; }
[data-dsap="menma"] .menma-named { margin: 4px 0 0; padding-left: 16px; }
[data-dsap="menma"] .menma-accounts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-bottom: 12px; }
[data-dsap="menma"] .menma-account-card { border: 1px solid #9ab; background: #f7f7f4; padding: 8px 10px; cursor: pointer; }
[data-dsap="menma"] .menma-account-card:hover { background: #eef; }
[data-dsap="menma"] .menma-account-card.menma-account-active { border-color: #68a; background: #e8f0f8; }
[data-dsap="menma"] .menma-account-card-name { font-weight: 600; margin-bottom: 4px; }
[data-dsap="menma"] .menma-account-card-stats { font-size: 11px; color: #445; }
[data-dsap="menma"] .menma-account-card-meal { font-size: 10px; color: #667; margin-top: 4px; }
[data-dsap="menma"] .menma-account-unavail { color: #888; font-style: italic; }
`;

function menmaDsapEscape(text) {
    return dsapSmfEscapeHtml(text);
}

function menmaDsapFormatWhen(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    return date.toLocaleString('en-US', {
        timeZone: MENMA_TZ,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    }) + ' ET';
}

function menmaDsapImageUrl(filename) {
    if (!filename) return '';
    if (typeof localGalleryImageUrl === 'function') return localGalleryImageUrl(filename);
    return `/images/${encodeURIComponent(filename)}`;
}

function menmaDsapNum(value, digits) {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return menmaDsapEscape(value);
    return n.toFixed(digits == null ? 1 : digits);
}

function menmaDsapResolveTab(host) {
    const segments = host.getPathSegments();
    const first = (segments[0] || '').toLowerCase();
    if (MENMA_TAB_LABELS[first]) return first;
    const q = (host.getQueryParam('tab') || '').toLowerCase();
    if (MENMA_TAB_LABELS[q]) return q;
    return 'status';
}

function menmaDsapTabUrl(tabId) {
    return `dsap://${MENMA_DSAP_URL}/${tabId}`;
}

function menmaDsapFindGalleryImage(filename) {
    if (!filename) return null;
    const lists = [];
    if (typeof allImages !== 'undefined' && Array.isArray(allImages)) lists.push(allImages);
    for (const list of lists) {
        const found = list.find((img) => (
            img && (img.filename === filename || img.original === filename || img.upscaled === filename)
        ));
        if (found) return found;
    }
    return { filename };
}

function menmaDsapOpenInStudio(filename) {
    if (!filename || typeof openManualModalWithContent !== 'function') return false;
    const image = menmaDsapFindGalleryImage(filename);
    openManualModalWithContent({ type: 'image', image }, null);
    return true;
}

function menmaDsapShotHtml(filename, label) {
    if (!filename) {
        return `<div class="menma-shot"><div class="menma-shot-cap"><span>${menmaDsapEscape(label)}</span><span class="menma-muted">none</span></div></div>`;
    }
    const url = menmaDsapImageUrl(filename);
    return `<div class="menma-shot" data-menma-file="${dsapSmfEscapeAttr(filename)}">
  <img src="${dsapSmfEscapeAttr(url)}" alt="${dsapSmfEscapeAttr(label)}" data-menma-open="${dsapSmfEscapeAttr(filename)}">
  <div class="menma-shot-cap">
    <span>${menmaDsapEscape(label)}</span>
    <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-menma-open="${dsapSmfEscapeAttr(filename)}" title="Open in Studio">
      <i class="fas fa-compass-drafting"></i> Studio
    </button>
  </div>
</div>`;
}

function menmaDsapListHtml(items, emptyText, renderItem) {
    if (!items || !items.length) return `<p class="menma-empty">${menmaDsapEscape(emptyText)}</p>`;
    return items.map(renderItem).join('');
}

function menmaDsapAccountCardHtml(accountId, accountData, isActive) {
    if (!accountData || accountData.available === false) {
        return `<div class="menma-account-card${isActive ? ' menma-account-active' : ''}" data-menma-account="${dsapSmfEscapeAttr(accountId)}">
  <div class="menma-account-card-name">${menmaDsapEscape(accountId.charAt(0).toUpperCase() + accountId.slice(1))}</div>
  <div class="menma-account-unavail">No data yet</div>
</div>`;
    }
    const name = accountData.character_name || accountId.charAt(0).toUpperCase() + accountId.slice(1);
    const kg = accountData.current_kg != null ? `${menmaDsapNum(accountData.current_kg, 1)} kg` : '— kg';
    const slices = accountData.slices_eaten_total != null ? `${accountData.slices_eaten_total} slices` : '— slices';
    const lastMeal = accountData.last_meal;
    let mealLine = '';
    if (lastMeal && lastMeal.at) {
        const sliceCount = lastMeal.slices != null ? lastMeal.slices : '?';
        mealLine = `Last: ${sliceCount} slice${lastMeal.slices === 1 ? '' : 's'}`;
        if (lastMeal.gained_kg != null) {
            const gained = Number(lastMeal.gained_kg);
            mealLine += ` (${gained >= 0 ? '+' : ''}${menmaDsapNum(lastMeal.gained_kg, 2)} kg)`;
        }
    }
    return `<div class="menma-account-card${isActive ? ' menma-account-active' : ''}" data-menma-account="${dsapSmfEscapeAttr(accountId)}">
  <div class="menma-account-card-name">${menmaDsapEscape(name)}</div>
  <div class="menma-account-card-stats">${menmaDsapEscape(kg)} · ${menmaDsapEscape(slices)}</div>
  ${mealLine ? `<div class="menma-account-card-meal">${menmaDsapEscape(mealLine)}</div>` : ''}
</div>`;
}

function menmaDsapAccountsGridHtml(accounts, activeAccountId) {
    if (!accounts || typeof accounts !== 'object') return '';
    const order = ['menma', 'hoshino', 'ivory', 'pyra', 'chiyo'];
    const cards = order
        .filter((id) => accounts[id])
        .map((id) => menmaDsapAccountCardHtml(id, accounts[id], id === activeAccountId));
    if (!cards.length) return '';
    return `${dsapSmfBuildSectionHdr('Cake Pantry')}
<div class="menma-accounts-grid">${cards.join('')}</div>`;
}

function menmaDsapStatusHtml(data, activeAccountId) {
    // Get accounts grid HTML
    const accountsGrid = menmaDsapAccountsGridHtml(data.accounts, activeAccountId || 'menma');
    
    // Get active account data (default to menma or root data for backward compat)
    const activeId = activeAccountId || 'menma';
    const activeData = (data.accounts && data.accounts[activeId]) || data;
    
    const meal = activeData.last_meal || {};
    const kgDelta = (activeData.current_kg != null && activeData.baseline_kg != null)
        ? (Number(activeData.current_kg) - Number(activeData.baseline_kg))
        : null;
    const activeName = activeData.character_name || activeId.charAt(0).toUpperCase() + activeId.slice(1);
    const stats = dsapSmfBuildStatsTable([
        { label: 'Weight', valueHtml: `${menmaDsapEscape(menmaDsapNum(activeData.current_kg, 1))} kg` },
        { label: 'Slices', valueHtml: menmaDsapEscape(String(activeData.slices_eaten_total == null ? '—' : activeData.slices_eaten_total)) },
        { label: 'Cake', valueHtml: menmaDsapEscape(activeData.cake_type || '—') }
    ]);
    const extra = dsapSmfBuildStatsTable([
        { label: 'Baseline', valueHtml: `${menmaDsapEscape(menmaDsapNum(activeData.baseline_kg, 1))} kg` },
        { label: 'Delta', valueHtml: kgDelta == null ? '—' : `${kgDelta >= 0 ? '+' : ''}${menmaDsapNum(kgDelta, 2)} kg` },
        { label: 'Chair', valueHtml: menmaDsapEscape(activeData.chair || '—') }
    ]);
    const mealBits = [];
    if (meal.at) {
        mealBits.push(menmaDsapFormatWhen(meal.at));
        const slices = meal.slices != null ? meal.slices : '?';
        mealBits.push(`${slices} slice${meal.slices === 1 ? '' : 's'}`);
        mealBits.push(meal.cake_type || activeData.cake_type || 'cake');
        if (meal.gained_kg != null) {
            const gained = Number(meal.gained_kg);
            mealBits.push(`${gained >= 0 ? '+' : ''}${menmaDsapNum(meal.gained_kg, 2)} kg`);
        }
    }
    const mealLine = mealBits.length ? mealBits.join(' · ') : 'No meal recorded yet.';
    return `${accountsGrid}
${dsapSmfBuildSectionHdr(activeName + ' Ledger')}
${stats}
${extra}
${dsapSmfBuildSectionHdr('Last meal')}
${dsapSmfBuildStatusBox(menmaDsapEscape(mealLine))}
<div class="menma-pair">
  ${menmaDsapShotHtml(activeData.last_before, 'Before')}
  ${menmaDsapShotHtml(activeData.last_after, 'After')}
</div>`;
}

function menmaDsapWorkItemHtml(item) {
    const who = item.from ? `${item.from}` : 'unknown';
    const when = item.done || item.added;
    return `<div class="menma-work-item">
  <strong>${menmaDsapEscape(item.id || '(no id)')}</strong>
  <div class="menma-muted">${menmaDsapEscape(who)} · ${menmaDsapEscape(menmaDsapFormatWhen(when))}${item.cake ? ` · ${menmaDsapEscape(item.cake)}` : ''}</div>
  <div>${menmaDsapEscape(item.summary || '')}</div>
</div>`;
}

function menmaDsapWorkHtml(data, activeAccountId) {
    // Get accounts grid HTML
    const accountsGrid = menmaDsapAccountsGridHtml(data.accounts, activeAccountId || 'menma');
    
    // Get active account data
    const activeId = activeAccountId || 'menma';
    const activeData = (data.accounts && data.accounts[activeId]) || data;
    const activeName = activeData.character_name || activeId.charAt(0).toUpperCase() + activeId.slice(1);
    
    const pile = activeData.work_pile || { open: [], done_since_breakfast: [] };
    const breakfast = pile.last_breakfast_at
        ? `Last breakfast ${menmaDsapFormatWhen(pile.last_breakfast_at)}`
        : 'No breakfast timestamp.';
    return `${accountsGrid}
${dsapSmfBuildSectionHdr(activeName + ' — Open work pile')}
${dsapSmfBuildStatusBox(menmaDsapEscape(breakfast))}
${menmaDsapListHtml(pile.open, 'Nothing open. Quiet desk.', menmaDsapWorkItemHtml)}
${dsapSmfBuildSectionHdr('Done since breakfast')}
${menmaDsapListHtml(pile.done_since_breakfast, 'Nothing folded since last meal.', menmaDsapWorkItemHtml)}`;
}

function menmaDsapLogItemHtml(entry) {
    const title = `${entry.loop || 'meal'} · ${entry.slices != null ? entry.slices : '?'} slice${entry.slices === 1 ? '' : 's'} · ${entry.cake_type || 'cake'}`;
    const kg = (entry.kg_before != null || entry.kg_after != null)
        ? `${menmaDsapNum(entry.kg_before, 2)} → ${menmaDsapNum(entry.kg_after, 2)} kg`
        : '';
    const named = Array.isArray(entry.named_for) && entry.named_for.length
        ? `<ul class="menma-named">${entry.named_for.map((n) => `<li>${menmaDsapEscape(n)}</li>`).join('')}</ul>`
        : '';
    const thumbs = (entry.before || entry.after)
        ? `<div class="menma-pair" style="margin-top:6px">${menmaDsapShotHtml(entry.before, 'Before')}${menmaDsapShotHtml(entry.after, 'After')}</div>`
        : '';
    return `<div class="menma-log-item">
  <strong>${menmaDsapEscape(title)}</strong>
  <div class="menma-muted">${menmaDsapEscape(menmaDsapFormatWhen(entry.at))} · ${menmaDsapEscape(kg)}</div>
  ${named}
  ${thumbs}
</div>`;
}

function menmaDsapLogHtml(data, activeAccountId) {
    // Get accounts grid HTML
    const accountsGrid = menmaDsapAccountsGridHtml(data.accounts, activeAccountId || 'menma');
    
    // Get active account data
    const activeId = activeAccountId || 'menma';
    const activeData = (data.accounts && data.accounts[activeId]) || data;
    const activeName = activeData.character_name || activeId.charAt(0).toUpperCase() + activeId.slice(1);
    
    const rows = Array.isArray(activeData.cake_log) ? activeData.cake_log.slice().reverse() : [];
    return `${accountsGrid}
${dsapSmfBuildSectionHdr(activeName + ' — Cake log')}
${menmaDsapListHtml(rows, 'No cake-log entries yet.', menmaDsapLogItemHtml)}`;
}

function menmaDsapShellHtml(tabId) {
    const tabs = [
        { id: 'status', label: 'Status', icon: 'fas fa-weight-scale' },
        { id: 'work', label: 'Work', icon: 'fas fa-list-check' },
        { id: 'log', label: 'Log', icon: 'fas fa-cake-candles' }
    ];
    return `${dsapSmfBuildRootOpen(MENMA_DSAP_ID)}
${dsapSmfBuildHeader({
    branchTitle: DSAP_SMF_BRANCH_MENMA,
    toolTitle: MENMA_TAB_LABELS[tabId] || 'Status'
})}
${dsapSmfBuildTabBar(tabs, tabId, { tabBarId: 'menmaDsapTabBar', dataAttr: 'data-menma-tab' })}
${dsapSmfBuildToolbar(`<button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-menma-action="refresh"><i class="fas fa-rotate-right"></i> Refresh</button>
<span class="menma-muted" data-menma-stamp></span>`)}
<div class="menma-view" data-menma-view></div>
${dsapSmfBuildRootClose()}`;
}

const menmaDsapDriver = {
    _state: null,

    init(host) {
        this.destroy(host);
        const root = host.getRoot();
        const tabId = menmaDsapResolveTab(host);
        this._state = {
            host,
            tabId,
            data: null,
            activeAccountId: 'menma',
            _onClick: null,
            _timer: null
        };
        root.innerHTML = menmaDsapShellHtml(tabId);
        const dsapRoot = root.querySelector('[data-dsap="menma"]') || root;
        dsapSmfWireTabBar(dsapRoot, '#menmaDsapTabBar', 'data-menma-tab', menmaDsapTabUrl, host);
        this._state._onClick = (e) => this._onClick(e);
        dsapRoot.addEventListener('click', this._state._onClick);
        this._wireContextMenus(host);
        this._load();
        this._state._timer = setInterval(() => this._load({ quiet: true }), MENMA_POLL_MS);
    },

    refresh(host) {
        this.init(host);
    },

    destroy(host) {
        const state = this._state;
        if (state) {
            if (state._timer) {
                clearInterval(state._timer);
                state._timer = null;
            }
            const root = host && host.getRoot ? host.getRoot() : null;
            const dsapRoot = root && root.querySelector ? root.querySelector('[data-dsap="menma"]') : null;
            if (dsapRoot && state._onClick) {
                dsapRoot.removeEventListener('click', state._onClick);
            }
        }
        this._state = null;
    },

    _wireContextMenus(host) {
        if (!host || typeof host.registerContextMenuItems !== 'function') return;
        host.registerContextMenuItems('[data-menma-file]', (el) => {
            const filename = el.getAttribute('data-menma-file');
            if (!filename) return [];
            return [
                { text: 'Open in Studio', icon: 'fas fa-compass-drafting', action: 'menma-open-studio', data: { filename } },
                { text: 'Copy filename', icon: 'fas fa-copy', action: 'menma-copy-name', data: { filename } }
            ];
        });
        host.registerContextMenuAction('menma-open-studio', (el, item) => {
            const filename = (item && item.data && item.data.filename) || el.getAttribute('data-menma-file');
            this._openStudio(filename);
        });
        host.registerContextMenuAction('menma-copy-name', (el, item) => {
            const filename = (item && item.data && item.data.filename) || el.getAttribute('data-menma-file');
            if (!filename || typeof copyTextToClipboard !== 'function') return;
            copyTextToClipboard(filename).then(() => {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, 'Copied filename', false, 2500, '<i class="fas fa-check"></i>');
                }
            }).catch(() => {});
        });
    },

    _onClick(e) {
        const openBtn = e.target.closest('[data-menma-open]');
        if (openBtn) {
            e.preventDefault();
            this._openStudio(openBtn.getAttribute('data-menma-open'));
            return;
        }
        const accountCard = e.target.closest('[data-menma-account]');
        if (accountCard) {
            e.preventDefault();
            const accountId = accountCard.getAttribute('data-menma-account');
            if (accountId && this._state) {
                this._state.activeAccountId = accountId;
                this._renderView();
            }
            return;
        }
        const refresh = e.target.closest('[data-menma-action="refresh"]');
        if (refresh) {
            e.preventDefault();
            this._load();
        }
    },

    _openStudio(filename) {
        if (!filename) return;
        const ok = menmaDsapOpenInStudio(filename);
        if (!ok && this._state && this._state.host && this._state.host.showToast) {
            this._state.host.showToast('Could not open Studio', 'error');
        }
    },

    async _load(options) {
        const state = this._state;
        if (!state) return;
        const quiet = options && options.quiet;
        try {
            if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function') {
                throw new Error('WebSocket client is not available');
            }
            if (typeof window.wsClient.isConnected === 'function' && !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }
            const result = await window.wsClient.sendMessage('get_menma_state', {}, false);
            if (!result) {
                throw new Error('Empty Menma state response');
            }
            state.data = result;
        } catch (err) {
            state.data = { success: false, error: err && err.message ? err.message : 'load failed' };
            if (!quiet && typeof console !== 'undefined') {
                console.warn('Menma DSAP load failed', err);
            }
        }
        this._renderView();
    },

    _renderView() {
        const state = this._state;
        if (!state) return;
        const root = state.host.getRoot();
        const view = root.querySelector('[data-menma-view]');
        const stamp = root.querySelector('[data-menma-stamp]');
        if (!view) return;
        const data = state.data;
        if (!data) {
            view.innerHTML = dsapSmfBuildStatusBox('Loading pantry state…');
            return;
        }
        if (data.success === false) {
            view.innerHTML = dsapSmfBuildStatusBox(menmaDsapEscape(data.error || 'Failed to load pantry state'));
            return;
        }
        if (stamp) {
            stamp.textContent = data.updated_at ? `Updated ${menmaDsapFormatWhen(data.updated_at)}` : '';
        }
        const activeId = state.activeAccountId || 'menma';
        if (state.tabId === 'work') view.innerHTML = menmaDsapWorkHtml(data, activeId);
        else if (state.tabId === 'log') view.innerHTML = menmaDsapLogHtml(data, activeId);
        else view.innerHTML = menmaDsapStatusHtml(data, activeId);
    }
};

function registerMenmaDsapApplet() {
    if (typeof registerDsap !== 'function') return;
    registerDsap({
        url: MENMA_DSAP_URL,
        getContent() {
            return {
                html: '<div class="menma-dsap-root"></div>',
                css: menmaDsapScopedCss,
                drivers: menmaDsapDriver,
                theme: 'dsap-smf'
            };
        }
    });
}

function openMenmaProgressDsap() {
    const target = `dsap://${MENMA_DSAP_URL}/status`;
    if (typeof openDsapInStandaloneWindow === 'function') {
        openDsapInStandaloneWindow(target);
        return;
    }
    if (typeof openDsapInGrimoire === 'function') {
        openDsapInGrimoire(target);
    }
}

registerMenmaDsapApplet();
if (typeof window !== 'undefined') {
    window.openMenmaProgressDsap = openMenmaProgressDsap;
}
