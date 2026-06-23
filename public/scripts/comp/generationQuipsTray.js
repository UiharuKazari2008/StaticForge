// Shared generation quips status cache, WS hooks, and workspace actions (DSAP applet).
// Depends on: generationQuips.js, websocket client

let generationQuipsTrayStatus = null;
let quipsTrayPipelineWasRunning = false;
let lastHandledQuipsVersionHash = '';
let quipsTrayWsHooksBound = false;

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

const QUIPS_RUNNING_STALE_SEC = 180;

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
    return [];
}

function buildQuipsTrayStatusSummary(status, data) {
    const gen = data?.generation || status?.generation || {};
    const progress = computeQuipsTrayProgress(status, data);
    const message = gen.message || (status ? formatQuipsTrayTitle(status) : 'Generation quips');
    const detail = formatQuipsGenerationDetail(gen);
    const previews = getQuipsRecentPreviews(status, data);

    return { gen, progress, message, detail, previews };
}

function markQuipsGenerationRunStarted() {
    quipsTrayPipelineWasRunning = true;
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

function handleGenerationQuipsProgress(data) {
    if (!data) return;

    if (data.status) {
        generationQuipsTrayStatus = normalizeQuipsTrayStatus(applyQuipsBroadcastStatus(data.status));
    } else {
        generationQuipsTrayStatus = normalizeQuipsTrayStatus({
            ...(generationQuipsTrayStatus || {}),
            generation: data.generation || generationQuipsTrayStatus?.generation
        });
    }

    quipsTrayPipelineWasRunning = generationQuipsTrayStatus?.generation?.status === 'running';
}

function handleGenerationQuipsStatusBroadcast(data) {
    let status = applyQuipsBroadcastStatus(data);
    if (!status) return;

    generationQuipsTrayStatus = normalizeQuipsTrayStatus(status);
    quipsTrayPipelineWasRunning = generationQuipsTrayStatus?.generation?.status === 'running';
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
            return `${wsLabel}: quips are over 3 months old — open Dynamic Quips to regenerate`;
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

async function refreshGenerationQuipsTrayStatus() {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        return;
    }

    try {
        const status = normalizeQuipsTrayStatus(await window.wsClient.getGenerationQuipsStatus());
        generationQuipsTrayStatus = status;
        quipsTrayPipelineWasRunning = status?.generation?.status === 'running';
    } catch (error) {
        console.warn('Quips status unavailable:', error.message);
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
            generationQuipsTrayStatus = normalizeQuipsTrayStatus({
                ...(generationQuipsTrayStatus || {}),
                generation: {
                    ...(generationQuipsTrayStatus?.generation || {}),
                    status: 'error',
                    error: 'interrupted',
                    message: 'Lost connection to server during quip generation'
                }
            });
            quipsTrayPipelineWasRunning = false;
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

function initializeGenerationQuipsTray() {
    bindGenerationQuipsTrayWsHooks();
    syncGenerationQuipsTrayInitialState();
}

function syncGenerationQuipsTrayInitialState() {
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
