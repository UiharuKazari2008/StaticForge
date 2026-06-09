// System tray icon for dynamic generation quips — status + phrase book wiki viewer
// Depends on: generationQuips.js, tagWikiSearchModal.js (wikiWindowManager)

let generationQuipsTrayStatus = null;
let generationQuipsTrayWikiWindow = null;
let quipsTrayPipelineWasRunning = false;
let lastHandledQuipsVersionHash = '';
let quipsTrayWsHooksBound = false;
let generationQuipsTrayWikiLastOptions = null;
let quipsTrayPopupDismissedForRun = false;
let quipsTrayPopupPinnedOpen = false;
let quipsTrayPopupState = {
    progress: 0,
    message: '',
    detail: '',
    recentPreviews: []
};

let quipsAutoUpdateSettingsDraft = null;
let quipsAutoUpdateSettingsDirty = false;
let quipsAutoUpdateSettingsSavePromise = null;

const quipsTrayPopup = { el: null };

const QUIPS_PHRASES_PER_TERM_OPTIONS = [1, 3, 5, 10, 15, 16, 17, 18, 19, 20];

const QUIPS_AUTO_TIME_SCHEDULES = [
    { value: 'daily', label: 'Every day' },
    { value: 'weekly', label: 'Every week' },
    { value: 'biweekly', label: 'Every 2 weeks' },
    { value: 'monthly', label: 'Every month' },
    { value: 'quarterly', label: 'Every 3 months' }
];

const QUIPS_AUTO_COUNT_SCHEDULES = [
    { value: 'new_50', label: '50 new images' },
    { value: 'new_100', label: '100 new images' },
    { value: 'new_500', label: '500 new images' },
    { value: 'new_1000', label: '1000 new images' }
];

const QUIPS_TERM_LIMIT_OPTIONS = [25, 50, 75, 100, 150];
const QUIPS_GROK_BATCH_OPTIONS = [1, 2, 3, 5];

function quipsTrayEscapeHtml(text) {
    if (text == null) return '';
    if (typeof escapeHtml === 'function') return escapeHtml(text);
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function quipsTrayEscapeHtmlAttribute(text) {
    if (text == null) return '';
    if (typeof escapeHtmlAttribute === 'function') return escapeHtmlAttribute(text);
    return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const QUIPS_RUNNING_STALE_SEC = 180;

function computeQuipsTrayProgress(status, data) {
    if (data?.progress != null) return Math.max(0, Math.min(100, data.progress));
    const gen = status?.generation || data?.generation || {};
    if (gen.progress != null) return Math.max(0, Math.min(100, gen.progress));
    if (gen.status === 'complete') return 100;
    if (gen.status !== 'running') return 0;
    if (gen.phase === 'extracting') return 8;
    const wsTotal = gen.workspace_total || 0;
    if (wsTotal <= 0) return 12;
    const wsIndex = Math.max(0, (gen.workspace_index || 1) - 1);
    let withinStep = 0;
    if (gen.batch_total > 0) {
        withinStep = Math.min(1, (gen.batch_index || 0) / gen.batch_total);
    } else if (gen.terms_total > 0) {
        withinStep = Math.min(1, (gen.terms_complete || 0) / gen.terms_total);
    }
    return Math.min(99, Math.round(((wsIndex + withinStep) / wsTotal) * 100));
}

function formatQuipsGenerationDetail(gen) {
    if (!gen || gen.status !== 'running') return '';
    const parts = [];
    if (gen.workspace_total > 0) {
        parts.push(`WS ${gen.workspace_index || 0}/${gen.workspace_total}`);
    }
    if (gen.batch_total > 0) {
        parts.push(`batch ${gen.batch_index || 0}/${gen.batch_total}`);
    } else if (gen.terms_total > 0) {
        parts.push(`${gen.terms_complete || 0}/${gen.terms_total} terms`);
    }
    return parts.join(' · ');
}

function getQuipsRecentPreviews(status, data) {
    if (Array.isArray(data?.recentPreviews) && data.recentPreviews.length) {
        return data.recentPreviews;
    }
    if (Array.isArray(status?.generation?.recentPreviews) && status.generation.recentPreviews.length) {
        return status.generation.recentPreviews;
    }
    return quipsTrayPopupState.recentPreviews || [];
}

function buildQuipsTrayStatusSummary(status, data) {
    const gen = data?.generation || status?.generation || {};
    const progress = computeQuipsTrayProgress(status, data);
    const message = gen.message || (status ? formatQuipsTrayTitle(status) : 'Generation quips');
    const detail = formatQuipsGenerationDetail(gen);
    const previews = getQuipsRecentPreviews(status, data);

    return { gen, progress, message, detail, previews };
}

function buildQuipsTrayPopupBodyHtml(status, data) {
    const summary = buildQuipsTrayStatusSummary(status, data);
    const isRunning = summary.gen.status === 'running';
    const progressHtml = isRunning
        ? `<div class="generation-quips-tray-popup-progress-wrap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${summary.progress}"><div style="width: ${summary.progress}%"></div></div>`
        : '';

    const detailHtml = summary.detail
        ? `<div class="generation-quips-tray-popup-detail">${quipsTrayEscapeHtml(summary.detail)}</div>`
        : '';

    const previews = isRunning ? summary.previews.slice(-4).reverse() : [];
    const previewHtml = previews.length
        ? `<div class="generation-quips-tray-popup-previews">${previews.map((item) => `
            <div class="generation-quips-tray-preview">
                <span class="generation-quips-tray-preview-term">${quipsTrayEscapeHtml(item.term)}</span>
                <span class="generation-quips-tray-preview-phrase">${quipsTrayEscapeHtml(item.phrase)}</span>
            </div>
        `).join('')}</div>`
        : '';

    return `
        <div class="generation-quips-tray-popup-status">${quipsTrayEscapeHtml(summary.message)}</div>
        ${detailHtml}
        ${progressHtml}
        ${previewHtml}
    `;
}

function formatQuipsTrayHoverTitle(status, data) {
    const gen = data?.generation || status?.generation || {};
    if (gen.status === 'running') {
        const progress = computeQuipsTrayProgress(status, data);
        const parts = [gen.message || 'Generating quips'];
        const detail = formatQuipsGenerationDetail(gen);
        if (detail) parts.push(detail);
        parts.push(`${progress}%`);
        return parts.join(' · ');
    }
    return formatQuipsTrayTitle(status);
}

function syncQuipsTrayHoverTitle(status, data) {
    const indicator = document.getElementById('generationQuipsTrayIcon');
    if (!indicator) return;
    indicator.title = formatQuipsTrayHoverTitle(status, data);
}

function ensureQuipsTrayPopup() {
    if (quipsTrayPopup.el) return;

    const el = document.createElement('div');
    el.className = 'popover arrow-bottom-right generation-quips-tray-popup hidden';
    el.id = 'generationQuipsTrayPopup';
    el.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(el);
    quipsTrayPopup.el = el;
}

function positionQuipsTrayPopup() {
    if (!quipsTrayPopup.el) return;
    const anchor = document.getElementById('generationQuipsTrayIcon');
    if (!anchor) return;

    const popover = quipsTrayPopup.el;
    const rect = anchor.getBoundingClientRect();
    const wasHidden = popover.classList.contains('hidden');

    if (wasHidden) {
        popover.style.visibility = 'hidden';
        popover.classList.remove('hidden');
    }

    const popoverRect = popover.getBoundingClientRect();
    const arrowOffset = 18;
    const arrowRightOffset = parseFloat(getComputedStyle(popover).fontSize) || 16;

    let top = rect.top - popoverRect.height - arrowOffset;
    let left = rect.right - popoverRect.width + arrowRightOffset;
    const padding = 8;

    if (left < padding) left = padding;
    if (left + popoverRect.width > window.innerWidth - padding) {
        left = window.innerWidth - popoverRect.width - padding;
    }
    if (top < padding) top = padding;
    if (top + popoverRect.height > window.innerHeight - padding) {
        top = window.innerHeight - popoverRect.height - padding;
    }

    left -= 10;
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    if (wasHidden) {
        popover.classList.add('hidden');
        popover.style.visibility = '';
    }
}

function renderQuipsTrayPopup(status, data) {
    ensureQuipsTrayPopup();
    const summary = buildQuipsTrayStatusSummary(status, data);
    quipsTrayPopupState = {
        progress: summary.progress,
        message: summary.message,
        detail: summary.detail,
        recentPreviews: summary.previews
    };

    quipsTrayPopup.el.innerHTML = `
        <div class="popover-content generation-quips-tray-popup-inner">
            <div class="generation-quips-tray-popup-header-row">
                <div class="popover-body">${buildQuipsTrayPopupBodyHtml(status, data)}</div>
                <button type="button" class="context-menu-icon-btn generation-quips-tray-popup-close" title="Close"><i class="fa-regular fa-xmark"></i></button>
            </div>
        </div>
    `;

    quipsTrayPopup.el.querySelector('.generation-quips-tray-popup-close')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        quipsTrayPopupDismissedForRun = true;
        quipsTrayPopupPinnedOpen = false;
        hideQuipsTrayPopup();
    });
}

function showQuipsTrayPopup() {
    ensureQuipsTrayPopup();
    renderQuipsTrayPopup(generationQuipsTrayStatus, quipsTrayPopupState);
    positionQuipsTrayPopup();
    quipsTrayPopup.el.classList.remove('hidden');
    quipsTrayPopup.el.classList.add('show');
}

function hideQuipsTrayPopup() {
    if (!quipsTrayPopup.el) return;
    quipsTrayPopup.el.classList.remove('show');
    quipsTrayPopup.el.classList.add('hidden');
}

function handleGenerationQuipsProgress(data) {
    if (!data) return;

    if (data.status) {
        generationQuipsTrayStatus = applyQuipsBroadcastStatus(data.status);
    } else {
        generationQuipsTrayStatus = {
            ...(generationQuipsTrayStatus || {}),
            generation: data.generation || generationQuipsTrayStatus?.generation
        };
    }

    updateGenerationQuipsTrayIcon(generationQuipsTrayStatus);
    syncQuipsTrayHoverTitle(generationQuipsTrayStatus, data);
    renderQuipsTrayPopup(generationQuipsTrayStatus, data);

    const gen = data.generation || {};
    if (gen.status === 'running' && !quipsTrayPopupDismissedForRun) {
        showQuipsTrayPopup();
    } else if ((gen.status === 'complete' || gen.status === 'error') && quipsTrayPopupPinnedOpen) {
        showQuipsTrayPopup();
    } else if (gen.status === 'complete' || gen.status === 'error') {
        hideQuipsTrayPopup();
    }
}

function buildQuipsPhrasesPerTermSubmenu() {
    return QUIPS_PHRASES_PER_TERM_OPTIONS.map((count) => ({
        text: String(count),
        action: 'generation-quips-set-phrases-per-term',
        value: count,
        keepMenuOpen: true,
        showIndicator: true,
        loadfn(item) {
            item.checked = (getQuipsAutoUpdateForMenu().phrasesPerTerm || 15) === count;
        }
    }));
}

function markQuipsGenerationRunStarted() {
    quipsTrayPopupDismissedForRun = false;
    quipsTrayPopupPinnedOpen = false;
    quipsTrayPopupState = { progress: 0, message: '', detail: '', recentPreviews: [] };
    showQuipsTrayPopup();
}

function applyQuipsBroadcastStatus(data) {
    if (!data) return null;
    const wsId = getActiveWorkspaceIdForQuips();
    return {
        versionHash: data.versionHash,
        totalQuipTerms: data.totalQuipTerms,
        totalWorkspacesWithQuips: data.totalWorkspacesWithQuips,
        extractedTermRows: data.extractedTermRows,
        generation: data.generation || generationQuipsTrayStatus?.generation,
        workspaces: data.workspaces || generationQuipsTrayStatus?.workspaces,
        autoUpdateByWorkspace: data.autoUpdateByWorkspace,
        activeWorkspaceId: wsId,
        activeWorkspace: data.workspaces?.find((w) => w.id === wsId)
            || generationQuipsTrayStatus?.activeWorkspace
            || null,
        autoUpdate: data.autoUpdateByWorkspace?.[wsId] || {
            enabled: false,
            schedule: 'disabled',
            scheduleLabel: 'Disabled',
            termLimit: 50,
            grokBatchSize: 3,
            phrasesPerTerm: 15,
            lastRunLabel: 'Never',
            scanPending: false,
            workspaceId: wsId
        }
    };
}

function handleGenerationQuipsStatusBroadcast(data) {
    const wasRunning = isQuipsPipelineRunning();
    let status = applyQuipsBroadcastStatus(data);
    if (!status) return;

    if (quipsAutoUpdateSettingsDirty && quipsAutoUpdateSettingsDraft) {
        const wsId = getActiveWorkspaceIdForQuips();
        const mergedAuto = {
            ...status.autoUpdate,
            ...quipsAutoUpdateSettingsDraft,
            workspaceId: wsId
        };
        status = {
            ...status,
            autoUpdate: mergedAuto,
            autoUpdateByWorkspace: {
                ...(status.autoUpdateByWorkspace || {}),
                [wsId]: mergedAuto
            }
        };
    }

    generationQuipsTrayStatus = status;
    updateGenerationQuipsTrayIcon(status);
    syncQuipsTrayHoverTitle(status, data);

    const isRunning = status?.generation?.status === 'running';
    if (!wasRunning && isRunning) {
        markQuipsGenerationRunStarted();
    } else if (isRunning) {
        renderQuipsTrayPopup(status, data);
        if (!quipsTrayPopupDismissedForRun && quipsTrayPopup.el?.classList.contains('show')) {
            positionQuipsTrayPopup();
        } else if (!quipsTrayPopupDismissedForRun) {
            showQuipsTrayPopup();
        }
    } else if (wasRunning && !quipsTrayPopupPinnedOpen) {
        hideQuipsTrayPopup();
    }
    quipsTrayPipelineWasRunning = isRunning;
}

function getQuipsAutoUpdateFromStatus(status) {
    return status?.autoUpdate || {
        enabled: false,
        schedule: 'disabled',
        scheduleLabel: 'Disabled',
        termLimit: 50,
        grokBatchSize: 3,
        phrasesPerTerm: 15,
        lastRunLabel: 'Never',
        scanPending: false
    };
}

function getQuipsAutoUpdateForMenu() {
    const base = getQuipsAutoUpdateFromStatus(generationQuipsTrayStatus);
    if (!quipsAutoUpdateSettingsDraft) return base;
    return { ...base, ...quipsAutoUpdateSettingsDraft };
}

function beginQuipsAutoUpdateSettingsDraft() {
    quipsAutoUpdateSettingsDraft = { ...getQuipsAutoUpdateFromStatus(generationQuipsTrayStatus || {}) };
    quipsAutoUpdateSettingsDirty = false;
}

function getQuipsAutoUpdateSettingsDraft() {
    if (!quipsAutoUpdateSettingsDraft) {
        beginQuipsAutoUpdateSettingsDraft();
    }
    return quipsAutoUpdateSettingsDraft;
}

function markQuipsAutoUpdateSettingsDraftDirty() {
    quipsAutoUpdateSettingsDirty = true;
}

function setQuipsAutoUpdateDraftValue(key, value) {
    const draft = getQuipsAutoUpdateSettingsDraft();
    draft[key] = value;
    if (key === 'schedule') {
        draft.enabled = value !== 'disabled';
        draft.scheduleLabel = getQuipsAutoScheduleLabel(value);
    }
    markQuipsAutoUpdateSettingsDraftDirty();
    applyQuipsAutoUpdateDraftToLocalStatus();
}

function applyQuipsAutoUpdatePatchToLocalStatus(patch) {
    if (!patch || typeof patch !== 'object') return;

    const wsId = getActiveWorkspaceIdForQuips();
    const prev = getQuipsAutoUpdateFromStatus(generationQuipsTrayStatus || {});
    const merged = {
        ...prev,
        ...patch,
        workspaceId: wsId
    };

    if (patch.schedule !== undefined) {
        merged.scheduleLabel = getQuipsAutoScheduleLabel(merged.schedule);
        merged.enabled = merged.schedule !== 'disabled';
    }

    generationQuipsTrayStatus = {
        ...(generationQuipsTrayStatus || {}),
        autoUpdate: merged,
        autoUpdateByWorkspace: {
            ...(generationQuipsTrayStatus?.autoUpdateByWorkspace || {}),
            [wsId]: merged
        }
    };

    updateGenerationQuipsTrayIcon(generationQuipsTrayStatus);
}

function applyQuipsAutoUpdateDraftToLocalStatus() {
    if (!quipsAutoUpdateSettingsDraft) return;
    applyQuipsAutoUpdatePatchToLocalStatus(quipsAutoUpdateSettingsDraft);
}

function reRenderQuipsTrayContextMenuIfOpen() {
    const indicator = document.getElementById('generationQuipsTrayIcon');
    if (!indicator?._menuConfigFn || !contextMenu?.isOpen || contextMenu.currentTarget !== indicator) {
        return;
    }

    const config = indicator._menuConfigFn();
    config.sections = buildQuipsTrayMenuSections();
    contextMenu.renderMenu(config, indicator);
    contextMenu.updateIndicatorDots(config);
}

async function flushQuipsAutoUpdateSettingsDraftIfDirty() {
    if (!quipsAutoUpdateSettingsDirty || !quipsAutoUpdateSettingsDraft) {
        quipsAutoUpdateSettingsDraft = null;
        return;
    }

    if (quipsAutoUpdateSettingsSavePromise) {
        await quipsAutoUpdateSettingsSavePromise;
        return;
    }

    const snapshot = { ...quipsAutoUpdateSettingsDraft };
    quipsAutoUpdateSettingsSavePromise = saveGenerationQuipsAutoUpdateSettings(snapshot).finally(() => {
        quipsAutoUpdateSettingsSavePromise = null;
        quipsAutoUpdateSettingsDraft = null;
        quipsAutoUpdateSettingsDirty = false;
    });
    await quipsAutoUpdateSettingsSavePromise;
}

function handleQuipsSettingsMenuAction(action, item) {
    if (action === 'generation-quips-set-term-limit') {
        const limit = parseInt(item.value, 10);
        if (!QUIPS_TERM_LIMIT_OPTIONS.includes(limit)) return false;
        setQuipsAutoUpdateDraftValue('termLimit', limit);
        return true;
    }
    if (action === 'generation-quips-set-grok-batch') {
        const size = parseInt(item.value, 10);
        if (!QUIPS_GROK_BATCH_OPTIONS.includes(size)) return false;
        setQuipsAutoUpdateDraftValue('grokBatchSize', size);
        return true;
    }
    if (action === 'generation-quips-set-phrases-per-term') {
        const count = parseInt(item.value, 10);
        if (!QUIPS_PHRASES_PER_TERM_OPTIONS.includes(count)) return false;
        setQuipsAutoUpdateDraftValue('phrasesPerTerm', count);
        return true;
    }
    return false;
}

function formatQuipsAutoUpdateMenuValue(status) {
    const auto = getQuipsAutoUpdateFromStatus(status);
    if (!auto.enabled || auto.schedule === 'disabled') {
        return auto.lastRunLabel && auto.lastRunLabel !== 'Never'
            ? `Off · last ${auto.lastRunLabel}`
            : 'Off';
    }
    return auto.scheduleLabel || auto.schedule;
}

async function saveGenerationQuipsAutoUpdateSettings(patch) {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        showGlassToast('error', 'Error', 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
        return null;
    }

    const workspaceId = getActiveWorkspaceIdForQuips();

    try {
        const result = await window.wsClient.updateUserGlobalSettings({
            generationQuips: {
                byWorkspace: {
                    [workspaceId]: patch
                }
            }
        });
        const saved = result?.settings?.generationQuips?.byWorkspace?.[workspaceId]
            || result?.data?.settings?.generationQuips?.byWorkspace?.[workspaceId];
        if (saved) {
            applyQuipsAutoUpdatePatchToLocalStatus(saved);
            return saved;
        }
        applyQuipsAutoUpdatePatchToLocalStatus({ ...getQuipsAutoUpdateFromStatus(generationQuipsTrayStatus), ...patch });
        return patch;
    } catch (error) {
        showQuipsErrorDialog('Auto-update settings', error.message || 'Failed to save settings');
        return null;
    }
}

function getQuipsAutoScheduleLabel(value) {
    if (!value || value === 'disabled') return 'Disable automatic updates';
    const time = QUIPS_AUTO_TIME_SCHEDULES.find((o) => o.value === value);
    if (time) return time.label;
    const count = QUIPS_AUTO_COUNT_SCHEDULES.find((o) => o.value === value);
    if (count) return count.label;
    return value;
}

function buildQuipsAutoScheduleDropdownGroups() {
    return [
        {
            group: 'By time',
            options: QUIPS_AUTO_TIME_SCHEDULES.map((opt) => ({ value: opt.value, label: opt.label }))
        },
        {
            group: 'By new images',
            options: QUIPS_AUTO_COUNT_SCHEDULES.map((opt) => ({ value: opt.value, label: opt.label }))
        },
        {
            group: 'Other',
            options: [{ value: 'disabled', label: 'Disable automatic updates' }]
        }
    ];
}

function wireQuipsAutoUpdateScheduleDropdown(dialogEl, initialSchedule) {
    const container = dialogEl.querySelector('#quipsAutoScheduleDropdown');
    const btn = dialogEl.querySelector('#quipsAutoScheduleBtn');
    const menu = dialogEl.querySelector('#quipsAutoScheduleMenu');
    const selectedEl = dialogEl.querySelector('#quipsAutoScheduleSelected');
    const hidden = dialogEl.querySelector('#quipsAutoScheduleHidden');
    if (!container || !btn || !menu || !selectedEl || !hidden) return;

    let currentValue = initialSchedule || 'disabled';
    hidden.value = currentValue;
    selectedEl.textContent = getQuipsAutoScheduleLabel(currentValue);

    const groups = buildQuipsAutoScheduleDropdownGroups();

    const renderMenu = (selectedVal) => {
        // renderGroupedDropdown, closeDropdown: public/scripts/comp/dropdown.js
        renderGroupedDropdown(
            menu,
            groups,
            (value) => {
                currentValue = value;
                hidden.value = value;
                selectedEl.textContent = getQuipsAutoScheduleLabel(value);
            },
            () => closeDropdown(menu, btn),
            selectedVal,
            (opt) => quipsTrayEscapeHtml(opt.label)
        );
    };

    // setupDropdown: public/scripts/comp/dropdown.js
    setupDropdown(container, btn, menu, renderMenu, () => currentValue, { preventFocusTransfer: true });
}

function buildQuipsAutoUpdateDialogHtml(currentSchedule) {
    const selected = currentSchedule || 'disabled';
    const selectedLabel = quipsTrayEscapeHtml(getQuipsAutoScheduleLabel(selected));

    return `
        <div class="quips-auto-update-dialog">
            <p class="quips-auto-update-intro">Choose when to automatically scan and regenerate dynamic quips for this workspace. Time-based schedules are checked daily at the configured server time (default 8:00 AM in config.json). Image-count schedules check every 4 hours but run at most once per day for this workspace.</p>
            <div class="form-group">
                <label for="quipsAutoScheduleBtn">Schedule</label>
                <div id="quipsAutoScheduleDropdown" class="custom-dropdown dropup">
                    <button type="button" id="quipsAutoScheduleBtn" class="custom-dropdown-btn hover-show colored">
                        <span id="quipsAutoScheduleSelected">${selectedLabel}</span>
                    </button>
                    <div id="quipsAutoScheduleMenu" class="custom-dropdown-menu hidden"></div>
                </div>
                <input type="hidden" id="quipsAutoScheduleHidden" value="${quipsTrayEscapeHtmlAttribute(selected)}">
            </div>
        </div>
    `;
}

async function openGenerationQuipsAutoUpdateDialog() {
    const status = generationQuipsTrayStatus || {};
    const auto = getQuipsAutoUpdateFromStatus(status);
    const wsLabel = getActiveWorkspaceNameForQuips(status);
    const lastRunLine = auto.lastRunLabel && auto.lastRunLabel !== 'Never'
        ? `<p class="quips-auto-update-meta">Last automatic run: ${quipsTrayEscapeHtml(auto.lastRunLabel)}</p>`
        : '<p class="quips-auto-update-meta">Last automatic run: Never</p>';

    const message = buildQuipsAutoUpdateDialogHtml(auto.schedule) + lastRunLine;

    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    if (typeof showConfirmationDialog !== 'function') return;

    const dialogPromise = showConfirmationDialog(message, [
        { text: 'Save', value: 'save', className: 'btn-primary', icon: 'fas fa-check' },
        { text: 'Cancel', value: null, className: 'btn-secondary' }
    ], null, {
        title: `Automatic quips — ${wsLabel}`,
        icon: 'fas fa-clock',
        resolveValue: (value, dialogEl) => {
            if (value !== 'save') return null;
            const hidden = dialogEl.querySelector('#quipsAutoScheduleHidden');
            return hidden ? hidden.value : 'disabled';
        }
    });

    setTimeout(() => {
        const dialog = document.getElementById('confirmationDialog');
        if (dialog) wireQuipsAutoUpdateScheduleDropdown(dialog, auto.schedule);
    }, 0);

    const result = await dialogPromise;

    if (result == null) return;

    const schedule = result || 'disabled';
    quipsAutoUpdateSettingsDirty = false;
    quipsAutoUpdateSettingsDraft = null;
    await saveGenerationQuipsAutoUpdateSettings({
        schedule,
        enabled: schedule !== 'disabled'
    });

    showGlassToast(
        'success',
        'Auto-update',
        schedule === 'disabled' ? 'Automatic updates disabled' : `Scheduled: ${getQuipsAutoScheduleLabel(schedule)}`,
        false,
        5000,
        '<i class="fas fa-clock"></i>'
    );
}

function buildQuipsTermLimitSubmenu() {
    return QUIPS_TERM_LIMIT_OPTIONS.map((limit) => ({
        text: String(limit),
        action: 'generation-quips-set-term-limit',
        value: limit,
        keepMenuOpen: true,
        showIndicator: true,
        loadfn(item) {
            item.checked = getQuipsAutoUpdateForMenu().termLimit === limit;
        }
    }));
}

function buildQuipsGrokBatchSubmenu() {
    return QUIPS_GROK_BATCH_OPTIONS.map((size) => ({
        text: String(size),
        action: 'generation-quips-set-grok-batch',
        value: size,
        keepMenuOpen: true,
        showIndicator: true,
        loadfn(item) {
            item.checked = getQuipsAutoUpdateForMenu().grokBatchSize === size;
        }
    }));
}

function updateQuipsAutoIndicator(status) {
    const indicator = document.getElementById('generationQuipsAutoIndicator');
    const trayIcon = document.getElementById('generationQuipsTrayIcon');
    if (!indicator || !trayIcon) return;

    const auto = getQuipsAutoUpdateFromStatus(status);
    const showPending = auto.enabled && auto.scanPending;

    indicator.classList.toggle('hidden', !showPending);
    trayIcon.classList.toggle('quips-auto-pending', showPending);
}

function showQuipsErrorDialog(title, message) {
    const dialogTitle = title || 'Generation Quips';
    const dialogMessage = message || 'An unknown error occurred';

    showGlassToast('error', dialogTitle, dialogMessage, false, 8000, '<i class="fas fa-comment-exclamation"></i>');

    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    if (typeof showConfirmationDialog === 'function') {
        showConfirmationDialog(dialogMessage, [
            { text: 'OK', value: true, className: 'btn-primary' }
        ], null, { title: dialogTitle, icon: 'fas fa-comment-exclamation' });
    }
}

function getActiveWorkspaceIdForQuips() {
    return typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
}

function getActiveWorkspaceNameForQuips(status) {
    const fromStatus = status?.activeWorkspace?.name;
    if (fromStatus) return fromStatus;

    const wsId = status?.activeWorkspaceId || getActiveWorkspaceIdForQuips();
    if (typeof workspaces !== 'undefined' && workspaces[wsId]?.name) {
        return workspaces[wsId].name;
    }
    return wsId || 'workspace';
}

function isQuipsPipelineRunning() {
    return generationQuipsTrayStatus?.generation?.status === 'running';
}

function getQuipsGenerationTargetWorkspaceId(status) {
    const gen = status?.generation || {};
    return gen.workspace_id || null;
}

function getQuipsGenerationTargetLabel(status) {
    const gen = status?.generation || {};
    if (gen.workspace_name) return gen.workspace_name;

    const targetId = getQuipsGenerationTargetWorkspaceId(status);
    if (targetId && typeof workspaces !== 'undefined' && workspaces[targetId]?.name) {
        return workspaces[targetId].name;
    }
    if (targetId === '_shared') return 'shared terms';
    if (!targetId) return 'all workspaces';
    return targetId;
}

function isGenerationForOtherWorkspace(status) {
    if (!status?.generation || status.generation.status !== 'running') return false;

    const activeId = status.activeWorkspaceId || getActiveWorkspaceIdForQuips();
    const targetId = getQuipsGenerationTargetWorkspaceId(status);

    if (!targetId) return true;
    return targetId !== activeId;
}

function normalizeQuipsTrayStatus(status) {
    if (!status?.generation || status.generation.status !== 'running') {
        return status;
    }

    const gen = status.generation;
    const nowSec = Math.floor(Date.now() / 1000);
    const updatedAt = gen.updated_at || gen.started_at || 0;
    if (!updatedAt || nowSec - updatedAt <= QUIPS_RUNNING_STALE_SEC) {
        return status;
    }

    return {
        ...status,
        generation: {
            ...gen,
            status: 'error',
            error: 'interrupted',
            message: 'Generation interrupted — server may have restarted'
        }
    };
}

function isQuipsRequestReady(status) {
    const ws = status?.activeWorkspace;
    if (!ws) return false;
    if (isQuipsPipelineRunning()) return false;
    return !!ws.needsGeneration;
}

function formatQuipsTrayTitle(status) {
    if (!status) return 'Generation quips — loading…';

    const ws = status.activeWorkspace;
    const gen = status.generation || {};
    const wsLabel = getActiveWorkspaceNameForQuips(status);

    if (gen.status === 'running') {
        const targetLabel = getQuipsGenerationTargetLabel(status);
        if (isGenerationForOtherWorkspace(status)) {
            const parts = [`Generating quips for ${targetLabel}`];
            parts.push(`you are in ${wsLabel}`);
            if (gen.batch_total > 0) {
                parts.push(`batch ${gen.batch_index || 0}/${gen.batch_total}`);
            }
            return parts.join(' · ');
        }

        const parts = [gen.message || 'Generating quips…'];
        if (gen.workspace_total > 0) {
            parts.push(`WS ${gen.workspace_index || 0}/${gen.workspace_total}`);
        }
        if (gen.batch_total > 0) {
            parts.push(`batch ${gen.batch_index || 0}/${gen.batch_total}`);
        }
        const progress = computeQuipsTrayProgress(status);
        if (progress > 0) parts.push(`${progress}%`);
        return parts.join(' · ');
    }

    if (gen.status === 'error') {
        return `Quips error: ${gen.error || gen.message || 'unknown'}`;
    }

    if (isQuipsRequestReady(status)) {
        if (ws.generationStaleReason === 'stale') {
            return `${wsLabel}: quips are over 3 months old — right-click to regenerate`;
        }
        if ((ws.termCount || 0) === 0) {
            return `${wsLabel}: ready to generate quips`;
        }
        return `${wsLabel}: ready to regenerate quips`;
    }

    const terms = ws?.termCount || 0;
    const phrases = ws?.phraseCount || 0;
    const minP = ws?.minPhrasesPerTerm;

    if (terms === 0) {
        return `${wsLabel}: no dynamic quips`;
    }

    const minLabel = minP != null ? `, min ${minP}/term` : '';
    const auto = getQuipsAutoUpdateFromStatus(status);
    let autoSuffix = '';
    if (auto.enabled && auto.schedule !== 'disabled') {
        autoSuffix = ` · auto: ${auto.scheduleLabel}`;
        if (auto.scanPending) autoSuffix += ' (scan soon)';
    } else if (auto.lastRunLabel && auto.lastRunLabel !== 'Never') {
        autoSuffix = ` · last auto: ${auto.lastRunLabel}`;
    }
    return `${wsLabel}: ${terms} terms, ${phrases} phrases${minLabel}${autoSuffix}`;
}

function updateGenerationQuipsTrayIcon(status) {
    const indicator = document.getElementById('generationQuipsTrayIcon');
    const glyph = document.getElementById('generationQuipsTrayIconGlyph');
    if (!indicator || !glyph) return;

    generationQuipsTrayStatus = status;
    syncQuipsTrayHoverTitle(status);

    if (indicator._menuConfigFn && contextMenu) {
        contextMenu.attachToElement(indicator, indicator._menuConfigFn());
    }

    indicator.classList.remove(
        'quips-running',
        'quips-running-other',
        'quips-ready',
        'quips-partial',
        'quips-error',
        'quips-idle',
        'quips-request-ready',
        'quips-auto-pending'
    );

    const gen = status?.generation || {};
    const ws = status?.activeWorkspace;
    const isRunning = gen.status === 'running';

    if (isRunning) {
        indicator.classList.add(isGenerationForOtherWorkspace(status) ? 'quips-running-other' : 'quips-running');
        glyph.className = 'fas fa-comment-dots';
        updateQuipsAutoIndicator(status);
        return;
    }

    if (gen.status === 'error') {
        indicator.classList.add('quips-error');
        glyph.className = 'fas fa-comment-exclamation';
        updateQuipsAutoIndicator(status);
        return;
    }

    if (isQuipsRequestReady(status)) {
        indicator.classList.add('quips-request-ready');
        glyph.className = 'fas fa-wand-magic-sparkles';
        updateQuipsAutoIndicator(status);
        return;
    }

    if ((ws?.termCount || 0) > 0) {
        const targetPhrases = getQuipsAutoUpdateFromStatus(status).phrasesPerTerm || 15;
        const minOk = ws.minPhrasesPerTerm == null || ws.minPhrasesPerTerm >= targetPhrases;
        indicator.classList.add(minOk ? 'quips-ready' : 'quips-partial');
        glyph.className = minOk ? 'fas fa-comment-heart' : 'fas fa-comment-lines';
        updateQuipsAutoIndicator(status);
        return;
    }

    indicator.classList.add('quips-idle');
    glyph.className = 'fas fa-comment';

    updateQuipsAutoIndicator(status);
}

async function refreshGenerationQuipsTrayStatus() {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        return;
    }

    try {
        const status = normalizeQuipsTrayStatus(await window.wsClient.getGenerationQuipsStatus());
        generationQuipsTrayStatus = status;
        updateGenerationQuipsTrayIcon(status);
        syncQuipsTrayHoverTitle(status);
        quipsTrayPipelineWasRunning = status?.generation?.status === 'running';
    } catch (error) {
        const indicator = document.getElementById('generationQuipsTrayIcon');
        if (indicator) {
            indicator.title = `Quips status unavailable: ${error.message}`;
        }
    }
}

function bindGenerationQuipsTrayWsHooks() {
    if (quipsTrayWsHooksBound || !window.wsClient) return;
    quipsTrayWsHooksBound = true;

    window.wsClient.on('connected', () => {
        quipsTrayPipelineWasRunning = false;
        syncGenerationQuipsTrayInitialState();
    });

    window.wsClient.on('disconnected', () => {
        if (isQuipsPipelineRunning()) {
            updateGenerationQuipsTrayIcon(normalizeQuipsTrayStatus({
                ...(generationQuipsTrayStatus || {}),
                generation: {
                    ...(generationQuipsTrayStatus?.generation || {}),
                    status: 'error',
                    error: 'interrupted',
                    message: 'Lost connection to server during quip generation'
                }
            }));
        }
    });
}

function handleGenerationQuipsClientUpdate(data, options = {}) {
    if (!data) return;

    const silent = options.silent === true;

    if (data.status === 'error') {
        if (!silent) {
            showQuipsErrorDialog('Generate Quips Failed', data.message || 'Generation failed');
        }
        return;
    }

    if (data.versionHash) {
        lastHandledQuipsVersionHash = data.versionHash;
    }

    if (!silent && data.status === 'complete') {
        const scope = data.scope === 'all' ? 'all workspaces' : 'this workspace';
        const detail = data.message || `Quips updated for ${scope}`;
        showGlassToast(
            'success',
            'Quips updated',
            detail,
            false,
            6000,
            '<i class="fas fa-comment-heart"></i>'
        );
    }
}

function getWorkspaceLabelForQuips(workspaceId) {
    if (typeof workspaces !== 'undefined' && workspaces[workspaceId]?.name) {
        return workspaces[workspaceId].name;
    }
    return workspaceId || 'workspace';
}

async function handleQuipWikiAction(action, workspaceId) {
    if (!workspaceId || !action) return;

    switch (action) {
        case 'generate':
            await startGenerationQuipsScanForWorkspace(workspaceId);
            break;
        case 'extract':
            await startGenerationQuipsExtractForWorkspace(workspaceId);
            break;
        case 'refresh-cache':
            if (typeof loadDynamicGenerationQuips === 'function') {
                const result = await loadDynamicGenerationQuips(true);
                if (!result?.ok) {
                    showQuipsErrorDialog('Quips Cache', result?.error || 'Could not refresh quips cache');
                } else {
                    if (result.versionHash) lastHandledQuipsVersionHash = result.versionHash;
                    showGlassToast('success', 'Quips cache', 'Client phrase book updated', false, 4000, '<i class="fas fa-download"></i>');
                }
                refreshGenerationQuipsTrayStatus();
            }
            break;
        case 'clear':
            await clearGenerationQuipsForWorkspace(workspaceId);
            break;
        default:
            break;
    }
}

async function clearGenerationQuipsForWorkspace(workspaceId) {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        showGlassToast('error', 'Error', 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
        return;
    }

    if (isQuipsPipelineRunning()) {
        showGlassToast('info', 'Clear quips', 'Wait for the current generation to finish', false, 4000, '<i class="fas fa-comment-dots"></i>');
        return;
    }

    const label = getWorkspaceLabelForQuips(workspaceId);
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    if (typeof showConfirmationDialog === 'function') {
        const confirmed = await showConfirmationDialog(
            `Clear all quips and extracted terms for "${label}"? This cannot be undone.`,
            [
                { text: 'Clear all', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ],
            null,
            { title: 'Clear workspace quips', icon: 'fas fa-trash' }
        );
        if (!confirmed) return;
    }

    try {
        await window.wsClient.clearGenerationQuips({ workspaceId });
        showGlassToast('success', 'Quips cleared', `Removed quips for ${label}`, false, 5000, '<i class="fas fa-trash"></i>');
        if (generationQuipsTrayWikiLastOptions) {
            await openGenerationQuipsWiki(generationQuipsTrayWikiLastOptions);
        }
        refreshGenerationQuipsTrayStatus();
    } catch (error) {
        showQuipsErrorDialog('Clear Quips Failed', error.message || 'Failed to clear workspace quips');
    }
}

async function startGenerationQuipsExtractForWorkspace(workspaceId) {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        showGlassToast('error', 'Error', 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
        return;
    }

    if (isQuipsPipelineRunning()) {
        showGlassToast('info', 'Extract terms', 'Generation is already running', false, 4000, '<i class="fas fa-comment-dots"></i>');
        return;
    }

    try {
        const result = await window.wsClient.runGenerationQuips({
            scope: 'workspace',
            workspaceId,
            extractOnly: true
        });

        if (result?.started === false) {
            showGlassToast('info', 'Extract terms', result.message || 'Extraction already in progress', false, 4000, '<i class="fas fa-comment-dots"></i>');
            return;
        }

        const label = getWorkspaceLabelForQuips(workspaceId);
        showGlassToast('info', 'Extract terms', `Scanning prompts for ${label}…`, false, 5000, '<i class="fas fa-list"></i>');
    } catch (error) {
        showGlassToast('error', 'Extract terms', error.message || 'Failed to start extraction', false, 6000, '<i class="fas fa-exclamation-circle"></i>');
    }
}

async function startGenerationQuipsScanForWorkspace(workspaceId) {
    if (!workspaceId) return;

    if (!window.wsClient || !window.wsClient.isConnected()) {
        showGlassToast('error', 'Error', 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
        return;
    }

    if (isQuipsPipelineRunning()) {
        showGlassToast('info', 'Generate quips', 'Generation is already running', false, 4000, '<i class="fas fa-comment-dots"></i>');
        return;
    }

    try {
        const auto = getQuipsAutoUpdateFromStatus(generationQuipsTrayStatus);
        const payload = {
            scope: 'workspace',
            workspaceId,
            termLimit: auto.termLimit,
            grokBatchSize: auto.grokBatchSize,
            phrasesPerTerm: auto.phrasesPerTerm
        };
        console.log('📤 [Quips] Starting generation', payload);
        const result = await window.wsClient.runGenerationQuips(payload);
        console.log('📥 [Quips] Generation accepted', result);

        if (result?.started === false) {
            showGlassToast('info', 'Generate quips', result.message || 'Generation already in progress', false, 4000, '<i class="fas fa-comment-dots"></i>');
            return;
        }

        markQuipsGenerationRunStarted();

        const label = getWorkspaceLabelForQuips(workspaceId);
        showGlassToast('info', 'Generate quips', `Starting generation for ${label}…`, false, 5000, '<i class="fas fa-wand-magic-sparkles"></i>');
    } catch (error) {
        console.error('Failed to start quip generation:', error);
        showGlassToast('error', 'Generate quips', error.message || 'Failed to start generation', false, 6000, '<i class="fas fa-exclamation-circle"></i>');
    }
}

async function startGenerationQuipsScan(scope) {
    if (scope === 'all') {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            showGlassToast('error', 'Error', 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
            return;
        }

        if (isQuipsPipelineRunning()) {
            showGlassToast('info', 'Generate quips', 'Generation is already running', false, 4000, '<i class="fas fa-comment-dots"></i>');
            return;
        }

        try {
            const auto = getQuipsAutoUpdateFromStatus(generationQuipsTrayStatus);
            const payload = {
                scope: 'all',
                allWorkspaces: true,
                termLimit: auto.termLimit,
                grokBatchSize: auto.grokBatchSize,
                phrasesPerTerm: auto.phrasesPerTerm
            };
            console.log('📤 [Quips] Starting generation', payload);
            const result = await window.wsClient.runGenerationQuips(payload);
            console.log('📥 [Quips] Generation accepted', result);

            if (result?.started === false) {
                showGlassToast('info', 'Generate quips', result.message || 'Generation already in progress', false, 4000, '<i class="fas fa-comment-dots"></i>');
                return;
            }

            markQuipsGenerationRunStarted();

            showGlassToast('info', 'Generate quips', 'Starting generation for all workspaces…', false, 5000, '<i class="fas fa-wand-magic-sparkles"></i>');
        } catch (error) {
            console.error('Failed to start quip generation:', error);
            showGlassToast('error', 'Generate quips', error.message || 'Failed to start generation', false, 6000, '<i class="fas fa-exclamation-circle"></i>');
        }
        return;
    }

    await startGenerationQuipsScanForWorkspace(getActiveWorkspaceIdForQuips());
}

function buildQuipsTrayMenuSections() {
    const menuStatus = generationQuipsTrayStatus
        ? { ...generationQuipsTrayStatus, autoUpdate: getQuipsAutoUpdateForMenu() }
        : generationQuipsTrayStatus;
    const auto = getQuipsAutoUpdateForMenu();

    return [{
        type: 'list',
        title: 'Generation Quips',
        items: [
            {
                icon: 'fas fa-clock',
                text: 'Automatic updates',
                action: 'generation-quips-auto-update',
                valueDisplay: () => formatQuipsAutoUpdateMenuValue(menuStatus),
                tooltip: 'Schedule automatic quip scans — click to configure'
            },
            {
                icon: 'fas fa-list-ol',
                text: 'Terms to rank',
                valueDisplay: () => String(auto.termLimit || 50),
                submenu: buildQuipsTermLimitSubmenu(),
                tooltip: 'How many prompt terms to extract and rank per scan'
            },
            {
                icon: 'fas fa-layer-group',
                text: 'Terms per Grok batch',
                valueDisplay: () => String(auto.grokBatchSize || 3),
                submenu: buildQuipsGrokBatchSubmenu(),
                tooltip: 'How many ranked terms to send per Grok request'
            },
            {
                icon: 'fas fa-quote-right',
                text: 'Quips per term',
                valueDisplay: () => String(auto.phrasesPerTerm || 15),
                submenu: buildQuipsPhrasesPerTermSubmenu(),
                tooltip: 'How many phrases Grok generates for each ranked term'
            },
            { separator: true },
            {
                icon: 'fas fa-wand-magic-sparkles',
                text: 'Generate Quips',
                action: 'generation-quips-run-workspace',
                tooltip: 'Extract prompt terms and generate quips for the active workspace',
                disabled: () => isQuipsPipelineRunning()
            },
            {
                icon: 'fas fa-wand-magic-sparkles',
                text: 'Generate Quips (Global)',
                action: 'generation-quips-run-all',
                tooltip: 'Extract and generate quips for every workspace plus global fallback',
                disabled: () => isQuipsPipelineRunning()
            },
            { separator: true },
            {
                icon: 'fas fa-book',
                text: 'Open phrase book',
                action: 'generation-quips-open-wiki'
            },
            {
                icon: 'fas fa-download',
                text: 'Refresh client cache',
                action: 'generation-quips-refresh-client',
                tooltip: 'Download latest quips into browser storage'
            }
        ]
    }];
}

function setupGenerationQuipsTrayContextMenu() {
    const indicator = document.getElementById('generationQuipsTrayIcon');
    if (!indicator || !contextMenu) return;

    const getMenuConfig = () => ({
        beforeShow: () => {
            beginQuipsAutoUpdateSettingsDraft();
            void refreshGenerationQuipsTrayStatus().then(() => {
                if (!quipsAutoUpdateSettingsDirty) {
                    beginQuipsAutoUpdateSettingsDraft();
                    reRenderQuipsTrayContextMenuIfOpen();
                }
            });
        },
        sections: buildQuipsTrayMenuSections(),
        onAction: function (action, target, item) {
            if (handleQuipsSettingsMenuAction(action, item)) {
                this.sections = buildQuipsTrayMenuSections();
                if (contextMenu.isOpen && contextMenu.currentTarget === target) {
                    contextMenu.renderMenu(this, target);
                    contextMenu.updateIndicatorDots(this);
                }
                return;
            }

            document.dispatchEvent(new CustomEvent('contextMenuAction', {
                detail: { action, target, item, menu: contextMenu }
            }));
        },
        onHide: function () {
            void flushQuipsAutoUpdateSettingsDraftIfDirty();
        }
    });

    indicator._menuConfigFn = getMenuConfig;
    contextMenu.attachToElement(indicator, getMenuConfig());
}

function attachQuipWikiNavHandlers(windowInstance) {
    if (!windowInstance?.displayArea) return;

    if (windowInstance._quipWikiNavClickHandler) {
        windowInstance.displayArea.removeEventListener('click', windowInstance._quipWikiNavClickHandler, true);
    }

    windowInstance._quipWikiNavClickHandler = async (e) => {
        if (!windowInstance.displayArea.contains(e.target)) return;

        const actionBtn = e.target.closest('[data-quip-action]');
        if (actionBtn) {
            e.preventDefault();
            e.stopPropagation();
            await handleQuipWikiAction(
                actionBtn.dataset.quipAction,
                actionBtn.dataset.quipWorkspaceId
            );
            return;
        }

        const link = e.target.closest('.quip-wiki-nav-link[data-quip-ws], .quip-wiki-nav-link[data-quip-view]');
        if (!link) return;

        e.preventDefault();
        e.stopPropagation();

        const viewAll = link.dataset.quipView === 'all';
        const wsId = link.dataset.quipWs || null;
        await openGenerationQuipsWiki({
            viewAll,
            workspaceId: wsId
        });
    };

    windowInstance.displayArea.addEventListener('click', windowInstance._quipWikiNavClickHandler, true);
}

async function openGenerationQuipsWiki(options = {}) {
    if (!wikiWindowManager) {
        showGlassToast('error', 'Error', 'Wiki window manager not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    if (!window.wsClient || !window.wsClient.isConnected()) {
        showGlassToast('error', 'Error', 'WebSocket not connected', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const viewAll = !!options.viewAll;
    const workspaceId = options.workspaceId || getActiveWorkspaceIdForQuips();
    generationQuipsTrayWikiLastOptions = { viewAll, workspaceId };

    try {
        const result = await window.wsClient.getGenerationQuipsWiki({
            viewAll,
            workspaceId: viewAll ? undefined : workspaceId
        });

        if (!result?.html) {
            showGlassToast('error', 'Error', 'No quip data to display', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        const content = {
            title: result.title || 'Generation Quips',
            tagName: `quips:${viewAll ? 'all' : workspaceId}`,
            html: result.html,
            staticWiki: true
        };

        if (generationQuipsTrayWikiWindow?.modal && document.body.contains(generationQuipsTrayWikiWindow.modal)) {
            generationQuipsTrayWikiWindow.renderWikiPage(content);
            const titleEl = generationQuipsTrayWikiWindow.modal.querySelector('.modal-window-title-main span');
            if (titleEl) titleEl.textContent = content.title;
            attachQuipWikiNavHandlers(generationQuipsTrayWikiWindow);
            return;
        }

        generationQuipsTrayWikiWindow = wikiWindowManager.createWindow(content, content.tagName);
        attachQuipWikiNavHandlers(generationQuipsTrayWikiWindow);
    } catch (error) {
        console.error('Failed to open generation quips wiki:', error);
        showGlassToast('error', 'Error', error.message || 'Failed to open phrase book', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

function initializeGenerationQuipsTray() {
    const indicator = document.getElementById('generationQuipsTrayIcon');
    if (!indicator) return;

    if (!window.isDesktop) {
        indicator.classList.add('hidden');
        return;
    }

    indicator.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openGenerationQuipsWiki({ workspaceId: getActiveWorkspaceIdForQuips() });
    });

    indicator.addEventListener('click', (e) => {
        if (e.detail > 1) return;
        if (!isQuipsPipelineRunning()) return;
        e.preventDefault();
        e.stopPropagation();
        quipsTrayPopupPinnedOpen = true;
        quipsTrayPopupDismissedForRun = false;
        showQuipsTrayPopup();
    });

    setupGenerationQuipsTrayContextMenu();
    bindGenerationQuipsTrayWsHooks();
    syncGenerationQuipsTrayInitialState();
}

function syncGenerationQuipsTrayInitialState() {
    const indicator = document.getElementById('generationQuipsTrayIcon');
    if (!indicator || indicator.classList.contains('hidden')) return;
    refreshGenerationQuipsTrayStatus();
}

document.addEventListener('workspaceChanged', () => {
    if (generationQuipsTrayStatus) {
        handleGenerationQuipsStatusBroadcast(generationQuipsTrayStatus);
    }
    // loadDynamicGenerationQuips: public/scripts/comp/generationQuips.js
    if (typeof loadDynamicGenerationQuips === 'function') {
        loadDynamicGenerationQuips(true).catch(() => {});
    }
});

document.addEventListener('contextMenuAction', async (event) => {
    const action = event.detail?.action;
    if (!action || !action.startsWith('generation-quips-')) return;

    switch (action) {
        case 'generation-quips-auto-update':
            await openGenerationQuipsAutoUpdateDialog();
            break;
        case 'generation-quips-run-workspace':
            if (isQuipsPipelineRunning()) return;
            await startGenerationQuipsScan('workspace');
            break;
        case 'generation-quips-run-all':
            if (isQuipsPipelineRunning()) return;
            await startGenerationQuipsScan('all');
            break;
        case 'generation-quips-open-wiki':
            await openGenerationQuipsWiki({ workspaceId: getActiveWorkspaceIdForQuips() });
            break;
        case 'generation-quips-refresh-client':
            if (typeof loadDynamicGenerationQuips === 'function') {
                const result = await loadDynamicGenerationQuips(true);
                if (!result?.ok) {
                    showQuipsErrorDialog('Quips Cache', result?.error || 'Could not refresh quips cache');
                } else {
                    if (result.versionHash) lastHandledQuipsVersionHash = result.versionHash;
                    showGlassToast(
                        'success',
                        'Quips cache',
                        result.unchanged
                            ? 'Phrase book is already up to date'
                            : `Client phrase book updated (${result.termCount || 0} terms)`,
                        false,
                        4000,
                        '<i class="fas fa-download"></i>'
                    );
                }
                refreshGenerationQuipsTrayStatus();
            }
            break;
        default:
            break;
    }
});
