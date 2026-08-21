/**
 * Server boot status — stage tracking, progress percent, step timing, capabilities.
 * Used by /status and globalResources.initialize() reporting.
 */

const BOOT_PHASES = [
    { id: 'binding', message: 'Starting HTTP server…', weight: 2 },
    { id: 'loading_global_resources', message: 'Loading global resources…', weight: 52 },
    { id: 'syncing_previews', message: 'Syncing previews…', weight: 8 },
    { id: 'runtime_compile', message: 'Compiling runtime CSS and JavaScript…', weight: 10 },
    { id: 'account_init', message: 'Loading account data…', weight: 4 },
    { id: 'cache_init', message: 'Refreshing server cache…', weight: 4 },
    { id: 'service_init', message: 'Initializing services…', weight: 3 },
    { id: 'sprite_sheet_init', message: 'Generating login sprite sheet…', weight: 2 },
    { id: 'websocket_init', message: 'Starting WebSocket server…', weight: 10 },
    { id: 'generation_quips_auto_update_init', message: 'Starting generation quips scheduler…', weight: 2 },
    { id: 'unix_socket_init', message: 'Starting admin CLI socket…', weight: 1 },
    { id: 'finalizing', message: 'Finalizing server setup…', weight: 2 },
    { id: 'ready', message: 'Server ready', weight: 0 }
];

const GLOBAL_RESOURCES_STEPS = [
    { id: 'gr_configs', message: 'Loading configuration…' },
    { id: 'gr_logger', message: 'Starting logger…' },
    { id: 'gr_lru_cache', message: 'Initializing LRU caches…' },
    { id: 'gr_api_keys', message: 'Initializing API key manager…' },
    { id: 'gr_polymodules', message: 'Registering polymorphic modules…' },
    { id: 'gr_html_markdown', message: 'Initializing HTML to Markdown converter…' },
    { id: 'gr_t5_tokenizer', message: 'Loading T5 tokenizer…' },
    { id: 'gr_spell_checker', message: 'Loading spell checker…' },
    { id: 'gr_word_lookup', message: 'Loading dictionary service…' },
    { id: 'gr_auxiliary', message: 'Loading auxiliary services…' },
    { id: 'gr_databases', message: 'Setting up databases…' },
    { id: 'gr_replication', message: 'Initializing replication stack…' },
    { id: 'gr_knowledge_memory', message: 'Initializing knowledge memory database…' },
    { id: 'gr_tag_search_db', message: 'Initializing tag search database…' },
    { id: 'gr_nax_tags', message: 'Initializing NAX tags database…' },
    { id: 'gr_nax_vibes', message: 'Initializing NAX vibes gallery…' },
    { id: 'gr_novelai_explore', message: 'Initializing NovelAI Explore gallery…' },
    { id: 'gr_nax_generation', message: 'Loading NAX tag generation config…' },
    { id: 'gr_reference_metadata', message: 'Initializing reference metadata database…' },
    { id: 'gr_generation_quips_db', message: 'Initializing generation quips database…' },
    { id: 'gr_singleton_managers', message: 'Initializing AI and memory managers…' },
    { id: 'gr_workspace', message: 'Loading workspace system…' },
    { id: 'gr_generation_quips_mgr', message: 'Initializing generation quips manager…' },
    { id: 'gr_novel_handlers', message: 'Initializing novel handlers…' },
    { id: 'gr_queue', message: 'Initializing queue…' },
    { id: 'gr_favorites', message: 'Initializing favorites manager…' },
    { id: 'gr_checkpoint', message: 'Initializing checkpoint manager…' },
    { id: 'gr_dataset_tags', message: 'Loading dataset tag service…' },
    { id: 'gr_custom_resolutions', message: 'Loading custom resolutions…' },
    { id: 'gr_master_clients', message: 'Initializing API clients…' },
    { id: 'gr_character_data', message: 'Loading character data…' },
    { id: 'gr_tag_search_services', message: 'Loading tag search services…' },
    { id: 'gr_system_info', message: 'Initializing system info cache…' },
    { id: 'gr_novelai_status', message: 'Starting NovelAI status monitor…' },
    { id: 'gr_account_snapshot', message: 'Initializing account subscription snapshot…' },
    { id: 'gr_workspace_sync', message: 'Syncing workspace files…' }
];

const PHASE_MESSAGES = Object.fromEntries(BOOT_PHASES.map((p) => [p.id, p.message]));
const GR_STEP_MESSAGES = Object.fromEntries(GLOBAL_RESOURCES_STEPS.map((s) => [s.id, s.message]));
const TOTAL_WEIGHT = BOOT_PHASES.reduce((sum, p) => sum + p.weight, 0);

const state = {
    isReady: false,
    stage: 'binding',
    subStage: null,
    subStageMessage: null,
    startTime: Date.now(),
    lastUpdate: Date.now(),
    stageStartedAt: Date.now(),
    capabilities: {
        http: false,
        status: false,
        websocket: false,
        staticAssets: false,
        generation: false
    },
    completedSteps: [],
    currentStep: null,
    grCompletedCount: 0,
    grTotalSteps: GLOBAL_RESOURCES_STEPS.length
};

function touch() {
    state.lastUpdate = Date.now();
}

function getStageMessage(stage, subStage) {
    if (stage === 'loading_global_resources' && subStage && GR_STEP_MESSAGES[subStage]) {
        return GR_STEP_MESSAGES[subStage];
    }
    return PHASE_MESSAGES[stage] || 'Server starting…';
}

function getProgressPercent() {
    if (state.isReady) {
        return 100;
    }

    let completed = 0;
    for (const phase of BOOT_PHASES) {
        if (phase.id === 'ready') {
            break;
        }
        if (phase.id === state.stage) {
            if (phase.id === 'loading_global_resources') {
                const slice = phase.weight / Math.max(1, state.grTotalSteps);
                completed += slice * state.grCompletedCount;
                if (state.currentStep && state.grCompletedCount < state.grTotalSteps) {
                    completed += slice * 0.35;
                }
            }
            break;
        }
        completed += phase.weight;
    }

    return Math.min(99, Math.round((completed / TOTAL_WEIGHT) * 100));
}

function setCapability(key, value) {
    if (Object.prototype.hasOwnProperty.call(state.capabilities, key)) {
        state.capabilities[key] = value === true;
        touch();
    }
}

function updateStage(stage, options = {}) {
    if (stage !== state.stage) {
        state.stage = stage;
        state.stageStartedAt = Date.now();
        if (stage !== 'loading_global_resources') {
            state.subStage = null;
            state.subStageMessage = null;
            state.currentStep = null;
        }
    }

    if (options.isReady === true) {
        state.isReady = true;
        state.stage = 'ready';
        state.subStage = null;
        state.subStageMessage = null;
        state.currentStep = null;
        setCapability('generation', true);
    } else if (options.isReady === false) {
        state.isReady = false;
    }

    if (options.subStage) {
        state.subStage = options.subStage;
        state.subStageMessage = getStageMessage(stage, options.subStage);
    }

    touch();
}

function reportGlobalResourcesStep(info = {}) {
    const { stepId, label, phase, elapsedMs } = info;
    const resolvedId = stepId || null;
    const resolvedLabel = label || (resolvedId ? GR_STEP_MESSAGES[resolvedId] : null);

    if (phase === 'start' && resolvedId) {
        state.currentStep = {
            id: resolvedId,
            label: resolvedLabel || resolvedId,
            startedAt: Date.now()
        };
        state.subStage = resolvedId;
        state.subStageMessage = resolvedLabel || GR_STEP_MESSAGES[resolvedId] || resolvedId;
        touch();
        return;
    }

    if (phase === 'done') {
        const finished = {
            id: resolvedId || state.currentStep?.id || 'unknown',
            label: resolvedLabel || state.currentStep?.label || 'Step complete',
            elapsedMs: typeof elapsedMs === 'number' ? elapsedMs : null,
            completedAt: Date.now()
        };
        state.completedSteps.push(finished);
        if (state.currentStep?.id === finished.id) {
            state.currentStep = null;
        }
        const idx = GLOBAL_RESOURCES_STEPS.findIndex((s) => s.id === finished.id);
        if (idx >= 0) {
            state.grCompletedCount = Math.max(state.grCompletedCount, idx + 1);
        } else {
            state.grCompletedCount += 1;
        }
        touch();
    }
}

function getPublicStatus(extra = {}) {
    const stageMessage = state.subStageMessage || getStageMessage(state.stage, state.subStage);
    const stageElapsedMs = Date.now() - (state.stageStartedAt || state.startTime);
    const uptime = Date.now() - state.startTime;

    return {
        isReady: state.isReady,
        stage: state.stage,
        subStage: state.subStage,
        stageMessage,
        subStageMessage: state.subStageMessage,
        progressPercent: getProgressPercent(),
        uptime,
        stageElapsedMs,
        lastUpdate: state.lastUpdate,
        timestamp: Date.now(),
        capabilities: { ...state.capabilities },
        currentStep: state.currentStep
            ? {
                id: state.currentStep.id,
                label: state.currentStep.label,
                elapsedMs: Date.now() - state.currentStep.startedAt
            }
            : null,
        completedSteps: state.completedSteps.slice(-40),
        stages: { ...PHASE_MESSAGES, ...GR_STEP_MESSAGES },
        ...extra
    };
}

function resetForTests() {
    state.isReady = false;
    state.stage = 'binding';
    state.subStage = null;
    state.subStageMessage = null;
    state.startTime = Date.now();
    state.lastUpdate = Date.now();
    state.stageStartedAt = Date.now();
    state.capabilities = {
        http: false,
        status: false,
        websocket: false,
        staticAssets: false,
        generation: false
    };
    state.completedSteps = [];
    state.currentStep = null;
    state.grCompletedCount = 0;
}

module.exports = {
    BOOT_PHASES,
    GLOBAL_RESOURCES_STEPS,
    updateStage,
    setCapability,
    reportGlobalResourcesStep,
    getPublicStatus,
    getProgressPercent,
    getStageMessage,
    resetForTests
};
