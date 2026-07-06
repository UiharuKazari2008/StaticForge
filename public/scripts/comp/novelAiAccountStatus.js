/** Account standing + NovelAI upstream status helpers for tray / generation gates. */

const NOVELAI_STATUS_INHIBIT_PREFIX = 'sf_novelai_status_inhibit_';

const UPSTREAM_COMPONENT_PRIORITY = ['Image Generation', 'Login', 'Website', 'Payments'];

function getNovelAiStatusPayload() {
    return window.optionsData?.novelaiStatus || null;
}

function getBootCycleId() {
    return window.optionsData?.bootCycleId
        || getNovelAiStatusPayload()?.bootCycleId
        || null;
}

function getIncidentInhibitStorageKey(incidentKey) {
    const bootCycleId = getBootCycleId();
    if (!bootCycleId || !incidentKey) return null;
    return `${NOVELAI_STATUS_INHIBIT_PREFIX}${bootCycleId}_${incidentKey}`;
}

function isIncidentInhibited(incidentKey) {
    const storageKey = getIncidentInhibitStorageKey(incidentKey);
    if (!storageKey) return false;
    try {
        return localStorage.getItem(storageKey) === '1';
    } catch (_error) {
        return false;
    }
}

function inhibitActiveUpstreamIncident() {
    const incident = getActiveUpstreamIncident({ respectInhibit: false });
    if (!incident?.key) return false;
    const storageKey = getIncidentInhibitStorageKey(incident.key);
    if (!storageKey) return false;
    try {
        localStorage.setItem(storageKey, '1');
        return true;
    } catch (_error) {
        return false;
    }
}

/**
 * Task 1 contract (defensive fallbacks):
 * - optionsData.userDataValid
 * - optionsData.user.accountStanding
 * - optionsData.user.banMessage
 */
function resolveAccountStanding() {
    // isAccountDataDeferred: public/scripts/comp/accountDataBootstrap.js
    if (typeof isAccountDataDeferred === 'function' && isAccountDataDeferred()) {
        return 'deferred';
    }
    const user = window.optionsData?.user;
    const explicit = user?.accountStanding || window.optionsData?.accountStanding;
    if (typeof explicit === 'string' && explicit.trim()) {
        const normalized = explicit.trim().toLowerCase();
        if (normalized === 'ok') return 'good';
        if (normalized === 'banned' || normalized === 'suspended') return 'banned';
        if (normalized === 'restricted' || normalized === 'unavailable' || normalized === 'incomplete') {
            return 'degraded';
        }
        return normalized;
    }
    if (user?.banned === true || user?.isBanned === true) {
        return 'banned';
    }
    if (window.optionsData?.userDataValid === false) {
        return 'degraded';
    }
    if (user?.ok === false) {
        return 'degraded';
    }
    if (user?.ok === true) {
        return 'good';
    }
    return 'unknown';
}

function getBanMessage() {
    const user = window.optionsData?.user;
    const message = user?.banMessage || window.optionsData?.banMessage || user?.ban?.message || user?.ban?.reason;
    return typeof message === 'string' && message.trim() ? message.trim() : '';
}

function isAccountBanned() {
    return resolveAccountStanding() === 'banned';
}

function getActiveUpstreamIncident(options = {}) {
    const respectInhibit = options.respectInhibit !== false;
    const status = getNovelAiStatusPayload();
    if (!status) return null;

    const incidentFromServer = status.activeIncident;
    if (incidentFromServer?.key) {
        if (respectInhibit && isIncidentInhibited(incidentFromServer.key)) {
            return null;
        }
        return incidentFromServer;
    }

    const impaired = (status.components || [])
        .filter((component) => component && component.impaired)
        .sort((a, b) => {
            const pa = UPSTREAM_COMPONENT_PRIORITY.indexOf(a.name);
            const pb = UPSTREAM_COMPONENT_PRIORITY.indexOf(b.name);
            const rankA = pa === -1 ? 99 : pa;
            const rankB = pb === -1 ? 99 : pb;
            if (rankA !== rankB) return rankA - rankB;
            return (b.statusCode || 0) - (a.statusCode || 0);
        });

    if (!impaired.length) return null;

    const primary = impaired[0];
    const key = `${primary.name}:${primary.statusCode}:${primary.updated || ''}`;
    if (respectInhibit && isIncidentInhibited(key)) {
        return null;
    }

    return {
        key,
        component: primary.name,
        status: primary.status,
        statusCode: primary.statusCode,
        message: `${primary.name} — ${primary.status}`,
        severity: primary.outage ? 'outage' : 'degraded',
    };
}

function isUpstreamImageGenerationBlocked(options = {}) {
    const respectInhibit = options.respectInhibit !== false;
    const status = getNovelAiStatusPayload();
    if (!status?.imageGenerationBlocked) {
        return false;
    }

    const incident = status.activeIncident;
    if (!incident || incident.component !== 'Image Generation') {
        return false;
    }

    if (respectInhibit && incident.key && isIncidentInhibited(incident.key)) {
        return false;
    }

    return true;
}

function buildCreditsTrayStatusMenuItems() {
    const standing = resolveAccountStanding();
    const banMessage = getBanMessage();
    const upstreamIncident = getActiveUpstreamIncident();
    const statusPayload = getNovelAiStatusPayload();

    const items = [];

    if (standing === 'banned') {
        const statusItem = {
            icon: 'fas fa-ban',
            text: 'Account Banned',
            className: 'text-danger',
            disabled: !banMessage,
            keepMenuOpen: !!banMessage,
        };
        if (banMessage) {
            statusItem.submenu = [{
                icon: 'fas fa-scroll',
                text: 'View ban message',
                action: 'novelai-show-ban-message',
            }];
        }
        items.push(statusItem);
    } else if (upstreamIncident) {
        const isLogin = upstreamIncident.component === 'Login';
        const isOutage = upstreamIncident.severity === 'outage' || (upstreamIncident.statusCode != null && upstreamIncident.statusCode >= 400);
        items.push({
            icon: isOutage ? 'fas fa-triangle-exclamation' : 'fas fa-circle-exclamation',
            text: `${upstreamIncident.component}: ${upstreamIncident.status}`,
            className: isLogin || isOutage ? 'text-danger' : 'text-warning',
            tooltip: upstreamIncident.message,
            disabled: true,
        });
    } else if (standing === 'deferred') {
        items.push({
            icon: 'fas fa-circle-exclamation',
            text: 'Continuing without account data',
            className: 'text-warning',
            disabled: true,
        });
    } else if (standing === 'degraded') {
        items.push({
            icon: 'fas fa-circle-exclamation',
            text: 'Account data unavailable — using cached values',
            className: 'text-warning',
            disabled: true,
        });
    } else if (statusPayload && statusPayload.ok === false && statusPayload.fetchError) {
        items.push({
            icon: 'fas fa-cloud-question',
            text: 'NovelAI system status unavailable',
            className: 'text-warning',
            disabled: true,
        });
    } else {
        items.push({
            icon: 'fas fa-circle-check',
            text: 'Account in good standing',
            className: 'text-success',
            disabled: true,
        });
    }

    const rawIncident = statusPayload?.activeIncident;
    if (rawIncident?.key && !isIncidentInhibited(rawIncident.key)) {
        items.push({ separator: true });
        items.push({
            icon: 'fas fa-eye-slash',
            text: 'Dismiss this status alert for this session',
            action: 'novelai-inhibit-status-incident',
            tooltip: 'Hide the upstream status banner until the server restarts or the incident resolves',
        });
    }

    return items;
}

function syncFixedCreditsIndicatorStanding() {
    const indicator = document.getElementById('fixedCreditsIndicator');
    if (!indicator) return;

    if (isAccountBanned()) {
        const banMessage = getBanMessage();
        indicator.title = banMessage
            ? `Account banned — ${banMessage}`
            : 'Account banned';
        return;
    }

    const incident = getActiveUpstreamIncident();
    if (incident) {
        const baseTitle = indicator.dataset.baseCreditsTitle || indicator.title || 'Credits';
        if (!indicator.dataset.baseCreditsTitle) {
            indicator.dataset.baseCreditsTitle = baseTitle;
        }
        indicator.title = `${incident.component}: ${incident.status} — ${indicator.dataset.baseCreditsTitle}`;
    } else if (indicator.dataset.baseCreditsTitle) {
        indicator.title = indicator.dataset.baseCreditsTitle;
        delete indicator.dataset.baseCreditsTitle;
    }
}

async function showBanMessageDialog() {
    const banMessage = getBanMessage();
    if (!banMessage) {
        showGlassToast('warning', 'Account Banned', 'No ban details were provided.', false, 5000, '<i class="fas fa-ban"></i>');
        return;
    }
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    await showConfirmationDialog(banMessage, [
        { text: 'Close', value: true, className: 'btn-primary' },
    ]);
}

function assertClientImageGenerationAllowed() {
    if (isAccountBanned()) {
        const banMessage = getBanMessage();
        const message = banMessage
            ? `Your NovelAI account is banned: ${banMessage}`
            : 'Your NovelAI account is banned.';
        showGlassToast('error', 'Generation Blocked', message, false, 8000, '<i class="fas fa-ban"></i>');
        throw new Error(message);
    }
    if (isUpstreamImageGenerationBlocked()) {
        const incident = getActiveUpstreamIncident({ respectInhibit: false }) || getNovelAiStatusPayload()?.activeIncident;
        const label = incident?.status || 'Unavailable';
        const message = `NovelAI Image Generation is currently unavailable (${label}). Check the credits tray menu or https://status.novelai.net/.`;
        showGlassToast('error', 'Generation Blocked', message, false, 8000, '<i class="fas fa-triangle-exclamation"></i>');
        throw new Error(message);
    }
}

function applyNovelAiStatusFromOptions(options) {
    if (options?.novelaiStatus) {
        if (!window.optionsData) window.optionsData = {};
        window.optionsData.novelaiStatus = options.novelaiStatus;
    }
    if (options?.bootCycleId) {
        if (!window.optionsData) window.optionsData = {};
        window.optionsData.bootCycleId = options.bootCycleId;
    }
    syncFixedCreditsIndicatorStanding();
}

window.getNovelAiStatusPayload = getNovelAiStatusPayload;
window.resolveAccountStanding = resolveAccountStanding;
window.getBanMessage = getBanMessage;
window.isAccountBanned = isAccountBanned;
window.getActiveUpstreamIncident = getActiveUpstreamIncident;
window.isUpstreamImageGenerationBlocked = isUpstreamImageGenerationBlocked;
window.buildCreditsTrayStatusMenuItems = buildCreditsTrayStatusMenuItems;
window.inhibitActiveUpstreamIncident = inhibitActiveUpstreamIncident;
window.syncFixedCreditsIndicatorStanding = syncFixedCreditsIndicatorStanding;
window.showBanMessageDialog = showBanMessageDialog;
window.assertClientImageGenerationAllowed = assertClientImageGenerationAllowed;
window.applyNovelAiStatusFromOptions = applyNovelAiStatusFromOptions;
