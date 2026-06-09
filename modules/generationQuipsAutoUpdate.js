const TIME_SCHEDULES = {
    daily: { label: 'Every day', intervalSec: 24 * 60 * 60 },
    weekly: { label: 'Every week', intervalSec: 7 * 24 * 60 * 60 },
    biweekly: { label: 'Every 2 weeks', intervalSec: 14 * 24 * 60 * 60 },
    monthly: { label: 'Every month', intervalSec: 30 * 24 * 60 * 60 },
    quarterly: { label: 'Every 3 months', intervalSec: 90 * 24 * 60 * 60 }
};

const COUNT_SCHEDULES = {
    new_50: { label: '50 new images', threshold: 50 },
    new_100: { label: '100 new images', threshold: 100 },
    new_500: { label: '500 new images', threshold: 500 },
    new_1000: { label: '1000 new images', threshold: 1000 }
};

const DEFAULT_TERM_LIMIT = 50;
const DEFAULT_GROK_BATCH_SIZE = 3;
const DEFAULT_PHRASES_PER_TERM = 15;
const MIN_PHRASES_PER_TERM = 1;
const MAX_PHRASES_PER_TERM = 20;
const TERM_LIMIT_OPTIONS = [25, 50, 75, 100, 150];
const GROK_BATCH_OPTIONS = [1, 2, 3, 5];
const PHRASES_PER_TERM_OPTIONS = [1, 3, 5, 10, 15, 16, 17, 18, 19, 20];

const DEFAULT_SERVER_CONFIG = {
    autoUpdateCheckHour: 8,
    autoUpdateCheckMinute: 0,
    countBasedCheckIntervalHours: 4
};

function normalizeWorkspaceQuipSettings(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const schedule = typeof base.schedule === 'string' ? base.schedule : 'disabled';
    const validSchedules = ['disabled', ...Object.keys(TIME_SCHEDULES), ...Object.keys(COUNT_SCHEDULES)];
    const normalizedSchedule = validSchedules.includes(schedule) ? schedule : 'disabled';

    let termLimit = parseInt(base.termLimit, 10);
    if (!TERM_LIMIT_OPTIONS.includes(termLimit)) termLimit = DEFAULT_TERM_LIMIT;

    let grokBatchSize = parseInt(base.grokBatchSize, 10);
    if (!GROK_BATCH_OPTIONS.includes(grokBatchSize)) grokBatchSize = DEFAULT_GROK_BATCH_SIZE;

    let phrasesPerTerm = parseInt(base.phrasesPerTerm, 10);
    if (!PHRASES_PER_TERM_OPTIONS.includes(phrasesPerTerm)) phrasesPerTerm = DEFAULT_PHRASES_PER_TERM;

    const enabled = base.enabled === true && normalizedSchedule !== 'disabled';

    return {
        enabled,
        schedule: normalizedSchedule,
        termLimit,
        grokBatchSize,
        phrasesPerTerm
    };
}

function computeGenerationProgress(gen) {
    if (!gen) return 0;
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

function getScheduleLabel(schedule) {
    if (!schedule || schedule === 'disabled') return 'Disabled';
    if (TIME_SCHEDULES[schedule]) return TIME_SCHEDULES[schedule].label;
    if (COUNT_SCHEDULES[schedule]) return COUNT_SCHEDULES[schedule].label;
    return schedule;
}

function isTimeBasedSchedule(schedule) {
    return !!TIME_SCHEDULES[schedule];
}

function isCountBasedSchedule(schedule) {
    return !!COUNT_SCHEDULES[schedule];
}

function getServerAutoUpdateConfig(config) {
    const raw = config?.generationQuips && typeof config.generationQuips === 'object'
        ? config.generationQuips
        : {};

    let hour = parseInt(raw.autoUpdateCheckHour, 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) hour = DEFAULT_SERVER_CONFIG.autoUpdateCheckHour;

    let minute = parseInt(raw.autoUpdateCheckMinute, 10);
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) minute = DEFAULT_SERVER_CONFIG.autoUpdateCheckMinute;

    let countHours = parseInt(raw.countBasedCheckIntervalHours, 10);
    if (!Number.isFinite(countHours) || countHours < 1 || countHours > 24) {
        countHours = DEFAULT_SERVER_CONFIG.countBasedCheckIntervalHours;
    }

    return {
        autoUpdateCheckHour: hour,
        autoUpdateCheckMinute: minute,
        countBasedCheckIntervalHours: countHours
    };
}

function startOfLocalDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function formatTimestamp(unixSec) {
    if (!unixSec) return 'Never';
    try {
        return new Date(unixSec * 1000).toLocaleString();
    } catch {
        return 'Unknown';
    }
}

function getNextDailyCheckTimestamp(nowMs, serverConfig) {
    const now = new Date(nowMs);
    const next = new Date(now);
    next.setHours(serverConfig.autoUpdateCheckHour, serverConfig.autoUpdateCheckMinute, 0, 0);
    if (next.getTime() <= nowMs) {
        next.setDate(next.getDate() + 1);
    }
    return Math.floor(next.getTime() / 1000);
}

function getNextCountCheckTimestamp(nowMs, serverConfig, lastCountCheckAt) {
    const intervalMs = serverConfig.countBasedCheckIntervalHours * 60 * 60 * 1000;
    if (!lastCountCheckAt) {
        return Math.floor(nowMs / 1000);
    }
    return Math.floor((lastCountCheckAt * 1000 + intervalMs) / 1000);
}

function isAtDailyCheckWindow(nowMs, serverConfig, windowMinutes = 1) {
    const now = new Date(nowMs);
    const targetMinutes = serverConfig.autoUpdateCheckHour * 60 + serverConfig.autoUpdateCheckMinute;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return nowMinutes >= targetMinutes && nowMinutes < targetMinutes + windowMinutes;
}

function isWithinMinutesBefore(targetUnixSec, nowSec, minutes) {
    if (!targetUnixSec || !nowSec) return false;
    const diff = targetUnixSec - nowSec;
    return diff >= 0 && diff <= minutes * 60;
}

function getWorkspaceImageCount(globalResources, workspaceId) {
    const workspaces = globalResources.getWorkspaceManager().getWorkspaces();
    const workspace = workspaces[workspaceId];
    if (!workspace) return 0;
    return (workspace.files || []).length + (workspace.scraps || []).length;
}

function countNewImagesForWorkspace(globalResources, workspaceId, snapshotCount) {
    const current = getWorkspaceImageCount(globalResources, workspaceId);
    const prev = snapshotCount || 0;
    return Math.max(0, current - prev);
}

function hasRunToday(lastRunAtSec, nowMs) {
    if (!lastRunAtSec) return false;
    const lastRunDay = startOfLocalDay(lastRunAtSec * 1000).getTime();
    const today = startOfLocalDay(nowMs).getTime();
    return lastRunDay === today;
}

function shouldRunTimeBasedAutoUpdate(settings, state, nowMs, serverConfig) {
    if (!settings.enabled || !isTimeBasedSchedule(settings.schedule)) return false;
    if (!isAtDailyCheckWindow(nowMs, serverConfig)) return false;

    const intervalSec = TIME_SCHEDULES[settings.schedule].intervalSec;
    const lastRunAt = state?.last_run_at || 0;
    const nowSec = Math.floor(nowMs / 1000);
    if (!lastRunAt) return true;
    return nowSec - lastRunAt >= intervalSec;
}

function shouldRunCountBasedAutoUpdate(settings, state, nowMs, serverConfig, globalResources, workspaceId) {
    if (!settings.enabled || !isCountBasedSchedule(settings.schedule)) return false;

    const nowSec = Math.floor(nowMs / 1000);
    const lastCountCheckAt = state?.last_count_check_at || 0;
    const nextCheckAt = getNextCountCheckTimestamp(nowMs, serverConfig, lastCountCheckAt);
    if (nowSec < nextCheckAt) return false;

    if (hasRunToday(state?.last_run_at, nowMs)) return false;

    const threshold = COUNT_SCHEDULES[settings.schedule].threshold;
    const newImages = countNewImagesForWorkspace(globalResources, workspaceId, state?.image_count);
    return newImages >= threshold;
}

function buildAutoUpdateStatus(settings, state, globalResources, config, workspaceId) {
    const serverConfig = getServerAutoUpdateConfig(config);
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const lastRunAt = state?.last_run_at || null;
    const nextDailyCheckAt = getNextDailyCheckTimestamp(nowMs, serverConfig);
    const nextCountCheckAt = getNextCountCheckTimestamp(nowMs, serverConfig, state?.last_count_check_at || 0);

    let newImagesSinceLastRun = null;
    let countThreshold = null;
    if (isCountBasedSchedule(settings.schedule)) {
        countThreshold = COUNT_SCHEDULES[settings.schedule].threshold;
        newImagesSinceLastRun = countNewImagesForWorkspace(globalResources, workspaceId, state?.image_count);
    }

    const timeDueNow = shouldRunTimeBasedAutoUpdate(settings, state, nowMs, serverConfig);
    const countDueNow = shouldRunCountBasedAutoUpdate(
        settings, state, nowMs, serverConfig, globalResources, workspaceId
    );

    let scanPending = false;
    if (settings.enabled) {
        if (isTimeBasedSchedule(settings.schedule)) {
            scanPending = isWithinMinutesBefore(nextDailyCheckAt, nowSec, 60) && (
                !lastRunAt || (nowSec - lastRunAt >= TIME_SCHEDULES[settings.schedule].intervalSec)
            );
        } else if (isCountBasedSchedule(settings.schedule)) {
            const canRunToday = !hasRunToday(lastRunAt, nowMs);
            scanPending = canRunToday
                && newImagesSinceLastRun >= countThreshold
                && isWithinMinutesBefore(nextCountCheckAt, nowSec, 30);
        }
    }

    return {
        workspaceId,
        ...settings,
        scheduleLabel: getScheduleLabel(settings.schedule),
        lastRunAt,
        lastRunLabel: formatTimestamp(lastRunAt),
        nextDailyCheckAt,
        nextCountCheckAt,
        nextCheckAt: isCountBasedSchedule(settings.schedule) ? nextCountCheckAt : nextDailyCheckAt,
        newImagesSinceLastRun,
        countThreshold,
        scanPending,
        runDueNow: timeDueNow || countDueNow,
        serverConfig
    };
}

module.exports = {
    TIME_SCHEDULES,
    COUNT_SCHEDULES,
    TERM_LIMIT_OPTIONS,
    GROK_BATCH_OPTIONS,
    DEFAULT_TERM_LIMIT,
    DEFAULT_GROK_BATCH_SIZE,
    DEFAULT_PHRASES_PER_TERM,
    MIN_PHRASES_PER_TERM,
    MAX_PHRASES_PER_TERM,
    PHRASES_PER_TERM_OPTIONS,
    DEFAULT_SERVER_CONFIG,
    computeGenerationProgress,
    normalizeWorkspaceQuipSettings,
    getScheduleLabel,
    isTimeBasedSchedule,
    isCountBasedSchedule,
    getServerAutoUpdateConfig,
    getWorkspaceImageCount,
    countNewImagesForWorkspace,
    shouldRunTimeBasedAutoUpdate,
    shouldRunCountBasedAutoUpdate,
    buildAutoUpdateStatus,
    formatTimestamp,
    getNextDailyCheckTimestamp,
    getNextCountCheckTimestamp
};
