/**
 * Desktop boot UI stepper — press / while starting to pause chrome for DevTools.
 * Window: #bootUiDebugWindow in public/app.html
 */
const BOOT_UI_DEBUG_STAGES = [
    { id: 'pre-startup', label: 'Pre-startup' },
    { id: 'system-update', label: 'System Update' },
    { id: 'install-wizard', label: 'Install wizard' },
    { id: 'startup-splash', label: 'Startup splash' },
    { id: 'gallery', label: 'Gallery' },
    { id: 'desktop', label: 'Desktop' }
];

var bootUiDebug = {
    active: false,
    paused: false,
    skipToStage: null,
    stage: 'pre-startup',
    detail: '',
    galleryReady: false,
    splashDismissed: false,
    _waiters: [],
    _heldUpdate: null,
    _wired: false,
    _closing: false,
    _justArrived: false
};

function bootUiDebugStageIndex(id) {
    const index = BOOT_UI_DEBUG_STAGES.findIndex((stage) => stage.id === id);
    return index < 0 ? 0 : index;
}

function bootUiDebugStageLabel(id) {
    const stage = BOOT_UI_DEBUG_STAGES.find((entry) => entry.id === id);
    return stage ? stage.label : id;
}

function bootUiDebugIsInstallWizardActive() {
    // serviceWorkerManager._isInstallWizardActive: public/scripts/comp/serviceWorkerManager.js
    if (serviceWorkerManager && serviceWorkerManager._isInstallWizardActive()) {
        return true;
    }
    return document.body.classList.contains('dreamscape-install-wizard');
}

function bootUiDebugIsTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
}

function bootUiDebugIsBootLive() {
    if (!isDesktop) return false;
    if (bootUiDebug.active) return true;
    if (!bootUiDebug.splashDismissed || !bootUiDebug.galleryReady) return true;
    if (document.body.classList.contains('windows-startup')) return true;
    if (document.body.classList.contains('initializing')) return true;
    if (document.body.classList.contains('dreamscape-install-wizard')) return true;
    const updateModal = document.getElementById('windowsUpdateModal');
    if (updateModal && !updateModal.classList.contains('hidden')) return true;
    const preStartup = document.getElementById('desktopPreStartupModal');
    if (preStartup && !preStartup.classList.contains('hidden')) return true;
    const splash = document.getElementById('windowsStartupModal');
    if (splash && !splash.classList.contains('hidden')) return true;
    if (serviceWorkerManager && !serviceWorkerManager.bootComplete) return true;
    if (wsClient && !wsClient.initializationCompleted) return true;
    return false;
}

function bootUiDebugDetectStage() {
    if (bootUiDebugIsInstallWizardActive()) return 'install-wizard';
    const updateModal = document.getElementById('windowsUpdateModal');
    if (updateModal && !updateModal.classList.contains('hidden')) return 'system-update';
    const preStartup = document.getElementById('desktopPreStartupModal');
    if (preStartup && !preStartup.classList.contains('hidden')) return 'pre-startup';
    const splash = document.getElementById('windowsStartupModal');
    if (splash && !splash.classList.contains('hidden')) return 'startup-splash';
    if (document.body.classList.contains('windows-startup') || document.body.classList.contains('initializing')) {
        return 'startup-splash';
    }
    if (serviceWorkerManager && !serviceWorkerManager.bootComplete) return 'system-update';
    if (wsClient && !wsClient.initializationCompleted) return 'startup-splash';
    if (!bootUiDebug.galleryReady || !bootUiDebug.splashDismissed) return 'gallery';
    return 'desktop';
}

function bootUiDebugNextStage(fromId) {
    const start = bootUiDebugStageIndex(fromId);
    for (let i = start + 1; i < BOOT_UI_DEBUG_STAGES.length; i++) {
        const id = BOOT_UI_DEBUG_STAGES[i].id;
        if (id === 'install-wizard' && !bootUiDebugIsInstallWizardActive()) {
            continue;
        }
        return id;
    }
    return 'desktop';
}

function bootUiDebugMajorStageForInitStep(step) {
    if (!step) return 'startup-splash';
    if (step.message === 'Loading Gallery' || step.priority === 31) return 'gallery';
    return 'startup-splash';
}

function bootUiDebugRefreshUi() {
    const status = document.getElementById('bootUiDebugStatus');
    if (status) {
        const pauseText = !bootUiDebug.active
            ? 'inactive'
            : (bootUiDebug.skipToStage
                ? ('running to ' + bootUiDebugStageLabel(bootUiDebug.skipToStage))
                : (bootUiDebug.paused ? 'paused' : 'running'));
        const detail = bootUiDebug.detail ? (' — ' + bootUiDebug.detail) : '';
        status.textContent = bootUiDebugStageLabel(bootUiDebug.stage) + ' (' + pauseText + ')' + detail;
    }
    const pauseBtn = document.getElementById('bootUiDebugPauseBtn');
    if (pauseBtn) {
        pauseBtn.textContent = bootUiDebug.paused && !bootUiDebug.skipToStage ? 'Resume' : 'Pause';
    }
}

function bootUiDebugHoldsUi() {
    return bootUiDebug.active && bootUiDebug.paused && !bootUiDebug.skipToStage;
}

function bootUiDebugHoldUpdate(payload) {
    bootUiDebug._heldUpdate = payload;
}

function bootUiDebugFlushHeldUpdate() {
    const held = bootUiDebug._heldUpdate;
    bootUiDebug._heldUpdate = null;
    if (!held || !wsClient) return;
    if (held.kind === 'update-modal') {
        wsClient.updateWindowsUpdateModal(held.message, held.progress);
        return;
    }
    if (held.kind === 'pre-startup') {
        wsClient._setConnectionBeat(wsClient.connectionUi.beat || 'negotiation', { message: held.message });
    }
}

function bootUiDebugReleaseWaiters() {
    const waiters = bootUiDebug._waiters.splice(0);
    for (let i = 0; i < waiters.length; i++) {
        waiters[i]();
    }
}

function bootUiDebugReleaseOne() {
    const resolve = bootUiDebug._waiters.shift();
    if (resolve) resolve();
}

function bootUiDebugWait() {
    return new Promise((resolve) => {
        bootUiDebug._waiters.push(resolve);
    });
}

async function bootUiDebugGate(stageId, options) {
    const detail = options && options.detail;
    if (stageId) {
        bootUiDebug.stage = stageId;
    }
    if (detail != null) {
        bootUiDebug.detail = detail;
    }
    bootUiDebugRefreshUi();
    if (!bootUiDebug.active) return;
    if (bootUiDebug.skipToStage) {
        if (bootUiDebugStageIndex(bootUiDebug.stage) < bootUiDebugStageIndex(bootUiDebug.skipToStage)) {
            return;
        }
        bootUiDebug.skipToStage = null;
        bootUiDebug.paused = true;
        bootUiDebug._justArrived = true;
        bootUiDebugRefreshUi();
        await bootUiDebugWait();
        return;
    }
    if (bootUiDebug._justArrived) {
        bootUiDebug._justArrived = false;
        return;
    }
    if (!bootUiDebug.paused) return;
    await bootUiDebugWait();
}

function bootUiDebugSkipSystemUpdate() {
    if (!serviceWorkerManager) return;
    if (serviceWorkerManager._attachDownloadSkipHandler) {
        serviceWorkerManager._attachDownloadSkipHandler();
    }
}

function bootUiDebugOpenWindow() {
    const modal = document.getElementById('bootUiDebugWindow');
    if (!modal) return;
    modal.dataset.windowPositionMode = 'manual-only';
    // clearModalPixelAnchor: public/scripts/comp/modalUtils.js
    clearModalPixelAnchor(modal);
    const width = 420;
    const x = Math.max(20, innerWidth - width - 20);
    modal.style.setProperty('--modal-offset-x', x + 'px');
    modal.style.setProperty('--modal-offset-y', '20px');
    // openModal: public/scripts/comp/modalUtils.js
    openModal(modal);
    // setActiveWindow: public/scripts/comp/modalUtils.js
    setActiveWindow(modal.id);
}

function bootUiDebugCloseWindow() {
    const modal = document.getElementById('bootUiDebugWindow');
    if (!modal || modal.classList.contains('hidden')) return;
    bootUiDebug._closing = true;
    // closeModal: public/scripts/comp/modalUtils.js
    closeModal(modal);
    bootUiDebug._closing = false;
}

function bootUiDebugInterrupt() {
    if (!isDesktop) return;
    if (!bootUiDebugIsBootLive() && bootUiDebug.splashDismissed && bootUiDebug.galleryReady) return;
    bootUiDebug.active = true;
    bootUiDebug.paused = true;
    bootUiDebug.skipToStage = null;
    bootUiDebug.stage = bootUiDebugDetectStage();
    if (wsClient) {
        wsClient.stepByStepMode = true;
    }
    bootUiDebugOpenWindow();
    bootUiDebugRefreshUi();
}

function bootUiDebugStep() {
    if (!bootUiDebug.active) return;
    bootUiDebug.skipToStage = null;
    bootUiDebug.paused = true;
    bootUiDebugFlushHeldUpdate();
    if (wsClient) {
        wsClient.advanceStep();
    }
    bootUiDebugReleaseOne();
    bootUiDebugRefreshUi();
}

function bootUiDebugStepOver() {
    if (!bootUiDebug.active) return;
    const next = bootUiDebugNextStage(bootUiDebug.stage);
    bootUiDebug.skipToStage = next;
    bootUiDebug.paused = false;
    if (bootUiDebug.stage === 'system-update') {
        bootUiDebugSkipSystemUpdate();
    }
    bootUiDebugFlushHeldUpdate();
    if (wsClient) {
        wsClient.advanceStep();
    }
    bootUiDebugReleaseWaiters();
    bootUiDebugRefreshUi();
}

function bootUiDebugTogglePause() {
    if (!bootUiDebug.active) return;
    if (bootUiDebug.paused && !bootUiDebug.skipToStage) {
        bootUiDebug.paused = false;
        bootUiDebug.skipToStage = null;
        bootUiDebugFlushHeldUpdate();
        if (wsClient) {
            wsClient.advanceStep();
        }
        bootUiDebugReleaseWaiters();
    } else {
        bootUiDebug.paused = true;
        bootUiDebug.skipToStage = null;
    }
    bootUiDebugRefreshUi();
}

function bootUiDebugExit() {
    bootUiDebug.active = false;
    bootUiDebug.paused = false;
    bootUiDebug.skipToStage = null;
    bootUiDebug._heldUpdate = null;
    if (wsClient) {
        wsClient.stepByStepMode = false;
        wsClient.advanceStep();
    }
    bootUiDebugReleaseWaiters();
    bootUiDebugRefreshUi();
    if (!bootUiDebug._closing) {
        bootUiDebugCloseWindow();
    }
}

function bootUiDebugMaybeArriveDesktop() {
    if (!bootUiDebug.splashDismissed || !bootUiDebug.galleryReady) return;
    bootUiDebug.stage = 'desktop';
    bootUiDebug.detail = 'Desktop clear';
    if (bootUiDebug.active && bootUiDebug.skipToStage === 'desktop') {
        bootUiDebug.skipToStage = null;
        bootUiDebug.paused = true;
        bootUiDebug._justArrived = true;
    }
    bootUiDebugRefreshUi();
}

function bootUiDebugMarkGalleryReady() {
    bootUiDebug.galleryReady = true;
    bootUiDebugMaybeArriveDesktop();
}

function bootUiDebugMarkSplashDismissed() {
    bootUiDebug.splashDismissed = true;
    bootUiDebugMaybeArriveDesktop();
}

function bootUiDebugOnSlash(e) {
    if (e.key !== '/') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (bootUiDebugIsTypingTarget(e.target)) return;
    if (!isDesktop) return;
    if (bootUiDebug.active) return;
    if (!bootUiDebugIsBootLive()) return;
    e.preventDefault();
    bootUiDebugInterrupt();
    return true;
}

function bootUiDebugWire() {
    if (bootUiDebug._wired) return;
    bootUiDebug._wired = true;

    const stepBtn = document.getElementById('bootUiDebugStepBtn');
    const stepOverBtn = document.getElementById('bootUiDebugStepOverBtn');
    const pauseBtn = document.getElementById('bootUiDebugPauseBtn');
    const exitBtn = document.getElementById('bootUiDebugExitBtn');
    const closeBtn = document.getElementById('bootUiDebugCloseBtn');
    if (stepBtn) stepBtn.addEventListener('click', bootUiDebugStep);
    if (stepOverBtn) stepOverBtn.addEventListener('click', bootUiDebugStepOver);
    if (pauseBtn) pauseBtn.addEventListener('click', bootUiDebugTogglePause);
    if (exitBtn) exitBtn.addEventListener('click', bootUiDebugExit);
    if (closeBtn) closeBtn.addEventListener('click', bootUiDebugExit);

    document.addEventListener('staticforge:modal-lifecycle', (event) => {
        if (!event.detail || event.detail.type !== 'closed') return;
        if (event.detail.id !== 'bootUiDebugWindow') return;
        if (bootUiDebug._closing) return;
        if (bootUiDebug.active) {
            bootUiDebugExit();
        }
    });

    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'bootUiDebug.slash',
        handler: bootUiDebugOnSlash,
        type: 'global',
        priority: 95,
        critical: true,
        label: 'Pause boot UI',
        keys: '/',
        overlayIcon: 'fas fa-pause',
        overlayGroup: 'Startup',
        overlayValid: bootUiDebugIsBootLive
    });
}

bootUiDebug.gate = bootUiDebugGate;
bootUiDebug.holdsUi = bootUiDebugHoldsUi;
bootUiDebug.holdUpdate = bootUiDebugHoldUpdate;
bootUiDebug.majorStageForInitStep = bootUiDebugMajorStageForInitStep;
bootUiDebug.markGalleryReady = bootUiDebugMarkGalleryReady;
bootUiDebug.markSplashDismissed = bootUiDebugMarkSplashDismissed;
bootUiDebug.interrupt = bootUiDebugInterrupt;
bootUiDebug.detectStage = bootUiDebugDetectStage;

bootUiDebugWire();
// Global alias for class methods (WebSocketClient, ServiceWorkerManager)
window.bootUiDebug = bootUiDebug;


