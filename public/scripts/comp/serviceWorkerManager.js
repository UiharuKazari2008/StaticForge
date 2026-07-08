function normalizeStaticFilePath(url) {
    try {
        return new URL(url, window.location.origin).pathname;
    } catch (_) {
        return String(url).split('?')[0];
    }
}

function isCssStaticFilePath(pathname) {
    return pathname.startsWith('/css/') && pathname.endsWith('.css');
}

function isScriptStaticFilePath(pathname) {
    return pathname.startsWith('/scripts/') && pathname.endsWith('.js');
}

function isApplySafeStaticFilePath(pathname) {
    if (isCssStaticFilePath(pathname)) {
        return true;
    }
    if (pathname.startsWith('/dist/')) {
        return true;
    }
    return /\.(woff2?|ttf|otf|eot|svg)$/i.test(pathname);
}

function buildShaBustUrl(pathname, hash) {
    if (!hash) {
        return pathname;
    }
    const base = pathname.split('?')[0];
    return `${base}?sha=${hash}`;
}

function pathnameMatchesAssetUrl(assetPath, rawUrl) {
    try {
        const linkPath = new URL(rawUrl, window.location.origin).pathname;
        return linkPath === assetPath || linkPath === assetPath.split('?')[0];
    } catch (_) {
        return String(rawUrl).startsWith(assetPath);
    }
}

const WIZARD_FILE_THRESHOLD = 20;
const DOWNLOAD_STALL_MS = 60000;
const INSTALL_WIZARD_SESSION_KEY = 'dreamscapeOsInstallWizard';
const LOGIN_BOOT_SESSION_KEY = 'dreamscapeLoginBoot';

const LOGIN_CRITICAL_EXACT_PATHS = new Set([
    '/',
    '/index.html',
    '/css/login_new.css',
    '/css/blockContainer.css',
    '/scripts/login.js',
    '/scripts/comp/blockContainer.js',
    '/scripts/comp/serviceWorkerManager.js',
    '/.login.jpg',
    '/manifest.json',
    '/browserconfig.xml',
    '/sw.js'
]);

const LOGIN_CRITICAL_PREFIXES = [
    '/dist/fontawesome/',
    '/dist/mdi/',
    '/dist/remixicon/',
    '/static_images/icon-',
    '/static_images/apple-touch-icon'
];

class ServiceWorkerManager {
    constructor() {
        this.swRegistration = null;
        this.updateAvailable = false;
        // Blown when updates are downloaded but not yet applied via restart.
        this.pendingUpdateFuse = false;
        // Files actually downloaded for the current pending apply/restart (not manifest size).
        this.pendingUpdateFilesTotal = 0;
        this.updateProgress = 0;
        this.isUpdating = false;
        this.lastUpdateCounts = { completed: 0, total: 0 };
        this.lastUpdateFilesTotal = 0;
        this.trayPopup = {
            el: null,
            anchorEl: null,
            state: 'hidden', // hidden | checking | downloading | available | complete
            kind: 'sw-update', // sw-update | runtime-compile
            dismissedUntilComplete: false,
            progress: 0,
            message: '',
            filesTotal: 0
        };
        this.messageHandlers = new Map();
        this.pendingRequests = new Map();
        this.updateToastId = null;
        this.checkingToastId = null;
        this.runtimeCompileNotifyId = null;
        this.initUpdateModalActive = false;
        this.timeoutToastId = null;
        this.stallToastId = null;
        this.stallRetryButtonsWired = false;
        this.swReadyTimeout = null;
        this.initialCheckDone = false;
        this.downloadState = null;
        this.stallDetectionTimeout = null;
        this.stateCheckInterval = null;
        this.lastProgressUpdate = null;
        this.lastHeartbeatTime = null;
        this.heartbeatCheckInterval = null;
        this.lastPingResponseTime = null;
        this.healthCheckInterval = null;
        this.healthCheckStartTime = null;
        this.swConfig = { cssOnlyAutoApply: true };
        this.pendingApplyFiles = null;
        this.pendingUpdateKind = 'restart';
        this.lastAppliedWorkspaceCssHash = null;

        // Boot gate state — public/scripts/websocket.js awaits ensureBootComplete()
        this.bootPhase = 'idle';
        this.bootComplete = false;
        this.loginBootComplete = false;
        this.bootPromise = null;
        this.loginBootPromise = null;
        this._bootOrchestrating = false;
        this._loginBootOrchestrating = false;
        this._bootCompleteResolvers = [];
        this._loginBootCompleteResolvers = [];
        this._pendingCacheUpdateQueue = [];
        this.installWizardToastId = null;
        this.installWizardUsed = false;
        this._installWizardEtaState = null;
        this._activeDownloadAttach = null;
        this._installWizardKeyboardWired = false;
        this._updateCompleteToastTimeout = null;

        this._wireInstallWizardKeyboardListeners();
        this.init();
    }

    _wireInstallWizardKeyboardListeners() {
        if (this._installWizardKeyboardWired) return;
        this._installWizardKeyboardWired = true;

        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        registerKeyboardListener({
            id: 'overlay.dreamscapeOsInstallWizard.close',
            type: 'whenFocused',
            modalId: 'dreamscapeOsInstallWizardModal',
            label: 'Cancel',
            keys: 'Alt+Q',
            overlayIcon: 'fas fa-times',
            overlayGroup: 'Startup',
            overlayOnly: true,
            priority: -10
        });

        registerKeyboardListener({
            id: 'overlay.dreamscapeOsInstallWizard.enter',
            type: 'whenFocused',
            modalId: 'dreamscapeOsInstallWizardModal',
            label: 'Continue',
            keys: 'Enter',
            overlayIcon: 'fas fa-forward',
            overlayGroup: 'Startup',
            overlayOnly: true,
            priority: -10
        });
    }

    _isDesktopTrayMode() {
        return Boolean(window.isDesktop && document.body.classList.contains('desktop-mode'));
    }

    hasPendingUpdates() {
        return this.pendingUpdateFuse;
    }

    tripPendingUpdateFuse(filesCount = null) {
        this.pendingUpdateFuse = true;
        this.updateAvailable = true;
        if (filesCount != null && filesCount > 0) {
            this.pendingUpdateFilesTotal = filesCount;
            this.trayPopup.filesTotal = filesCount;
            this.lastUpdateFilesTotal = filesCount;
        }
        this._notifyTrayIconUpdate();
    }

    resetPendingUpdateFuse() {
        this.pendingUpdateFuse = false;
        this.updateAvailable = false;
        this.pendingUpdateFilesTotal = 0;
        this._clearScheduledUpdateCompleteToast();
        this._notifyTrayIconUpdate();
    }

    _clearScheduledUpdateCompleteToast() {
        if (this._updateCompleteToastTimeout) {
            clearTimeout(this._updateCompleteToastTimeout);
            this._updateCompleteToastTimeout = null;
        }
    }

    _scheduleUpdateCompleteToast(mode = 'restart', delayMs = 1000) {
        this._clearScheduledUpdateCompleteToast();
        this._updateCompleteToastTimeout = setTimeout(() => {
            this._updateCompleteToastTimeout = null;
            this.showUpdateCompleteToast(mode);
        }, delayMs);
    }

    _formatDownloadCompleteMessage() {
        const count = this.pendingUpdateFilesTotal || this.trayPopup.filesTotal || 0;
        if (count > 0) {
            const fileLabel = count === 1 ? 'file' : 'files';
            return `Completed updating ${count} ${fileLabel}. Restart to apply changes.`;
        }
        return '';
    }

    _notifyTrayIconUpdate() {
        // wsClient._updateServiceWorkerTrayIcon: public/scripts/websocket.js
        if (window.wsClient && typeof window.wsClient._updateServiceWorkerTrayIcon === 'function') {
            window.wsClient._updateServiceWorkerTrayIcon();
        }
    }

    _isInstallWizardActive() {
        return Boolean(
            this.installWizardUsed ||
            this.bootPhase === 'wizard' ||
            document.body.classList.contains('dreamscape-install-wizard') ||
            this._readInstallWizardSession()?.active
        );
    }

    _isPreStartupUpdatePhase() {
        if (this._isInstallWizardActive()) {
            return false;
        }
        // wsClient: public/scripts/websocket.js
        return Boolean(
            window.isDesktop &&
            window.wsClient &&
            !window.wsClient.preStartupHandoffCompleted
        );
    }

    isBootComplete() {
        return this.bootComplete === true;
    }

    ensureBootComplete() {
        if (this.bootComplete) {
            return Promise.resolve();
        }
        if (this.bootPromise) {
            return this.bootPromise;
        }
        return new Promise((resolve) => {
            this._bootCompleteResolvers.push(resolve);
        });
    }

    ensureLoginBootComplete() {
        if (this.loginBootComplete) {
            return Promise.resolve();
        }
        if (this.loginBootPromise) {
            return this.loginBootPromise;
        }
        return new Promise((resolve) => {
            this._loginBootCompleteResolvers.push(resolve);
        });
    }

    _resolveBootComplete() {
        this.bootComplete = true;
        this.bootPhase = 'complete';
        document.body.classList.remove('dreamscape-install-wizard');
        this._hideInstallWizardUi();
        this._flushPendingCacheUpdates();
        const resolvers = this._bootCompleteResolvers.splice(0);
        resolvers.forEach((fn) => fn());
    }

    _resolveLoginBootComplete() {
        this.loginBootComplete = true;
        document.body.classList.remove('login-booting');
        const resolvers = this._loginBootCompleteResolvers.splice(0);
        resolvers.forEach((fn) => fn());
    }

    _kickApplicationBootEarly() {
        // beginApplicationBoot: public/scripts/websocket.js — UI + WS connect must not wait on SW cache sync
        const start = () => {
            if (window.wsClient && !window.wsClient.initializationStarted) {
                window.wsClient.beginApplicationBoot();
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
            start();
        }
    }

    _kickApplicationBootAfterBootGate() {
        // beginApplicationBoot: public/scripts/websocket.js
        if (window.wsClient && typeof window.wsClient.beginApplicationBoot === 'function') {
            window.wsClient.beginApplicationBoot();
        } else if (window.wsClient && !window.wsClient.initializationStarted) {
            window.wsClient.init();
        }
    }

    _showBootFatalError(error) {
        // dismissLaunchHandoffIfNeeded: public/app.html
        if (typeof dismissLaunchHandoffIfNeeded === 'function') {
            dismissLaunchHandoffIfNeeded();
        }
        const message = error && error.message ? error.message : 'Service worker failed to initialize';
        // presentDreamscapeConnectivityError: public/scripts/comp/fatalErrorBootstrap.js
        if (typeof presentDreamscapeConnectivityError === 'function') {
            presentDreamscapeConnectivityError(
                'Dreamscape OS could not start',
                'The application could not connect to the server. Check your network connection and try again.',
                message,
                error && error.stack ? error.stack : ''
            );
        } else if (typeof presentDreamscapeApplicationError === 'function') {
            presentDreamscapeApplicationError(
                'Dreamscape OS could not start',
                message,
                error && error.stack ? error.stack : ''
            );
        } else if (typeof showGlassToast === 'function') {
            showGlassToast(
                'error',
                'Dreamscape OS could not start',
                message,
                false,
                false,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        } else {
            alert(`Dreamscape OS could not start: ${message}`);
        }
    }

    _readInstallWizardSession() {
        try {
            const raw = sessionStorage.getItem(INSTALL_WIZARD_SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    _writeInstallWizardSession(patch) {
        try {
            const prev = this._readInstallWizardSession() || {};
            sessionStorage.setItem(INSTALL_WIZARD_SESSION_KEY, JSON.stringify({ ...prev, ...patch, active: true }));
        } catch (_) { /* ignore */ }
    }

    _clearInstallWizardSession() {
        try {
            sessionStorage.removeItem(INSTALL_WIZARD_SESSION_KEY);
        } catch (_) { /* ignore */ }
    }

    _readLoginBootSession() {
        try {
            const raw = sessionStorage.getItem(LOGIN_BOOT_SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    _writeLoginBootSession() {
        try {
            sessionStorage.setItem(LOGIN_BOOT_SESSION_KEY, JSON.stringify({ active: true }));
        } catch (_) { /* ignore */ }
    }

    _clearLoginBootSession() {
        try {
            sessionStorage.removeItem(LOGIN_BOOT_SESSION_KEY);
        } catch (_) { /* ignore */ }
    }

    _isLoginCriticalPath(url) {
        const pathname = normalizeStaticFilePath(url);
        if (LOGIN_CRITICAL_EXACT_PATHS.has(pathname)) {
            return true;
        }
        return LOGIN_CRITICAL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    }

    filterLoginCriticalFiles(files) {
        if (!Array.isArray(files)) {
            return [];
        }
        return files.filter((file) => file && this._isLoginCriticalPath(file.url));
    }

    _showBootUiEarly(message = 'Checking server status…') {
        this.bootPhase = 'waiting_server';
        document.body.classList.add('initializing');
        if (!window.wsClient) {
            return;
        }
        if (window.isDesktop && typeof window.wsClient._renderPreStartupDialog === 'function') {
            window.wsClient._setConnectionBeat('initializing', { message });
            window.wsClient._renderPreStartupDialog();
        } else if (typeof window.wsClient.showWindowsStartupModal === 'function') {
            window.wsClient.showWindowsStartupModal(message, 0);
        }
    }

    _applyServerStartupStatusToUi(data) {
        if (!data || !window.wsClient) {
            return;
        }
        if (typeof window.wsClient._applyServerStartupStatus === 'function') {
            window.wsClient._applyServerStartupStatus(data);
        } else {
            const message = data.stageMessage || 'Server starting…';
            window.wsClient._setConnectionBeat('dialing', { message });
        }
    }

    async _waitForServerReady() {
        const pollMs = 2000;
        const maxAttempts = 300;
        let attempts = 0;

        this._showBootUiEarly('Checking server status…');

        while (attempts < maxAttempts) {
            attempts += 1;
            try {
                const response = await fetch('/status', {
                    method: 'OPTIONS',
                    cache: 'no-cache',
                    signal: AbortSignal.timeout(8000)
                });

                if (response.ok) {
                    const data = await response.json();
                    this._applyServerStartupStatusToUi(data);

                    if (data.isReady) {
                        return data;
                    }

                    const pct = data.progressPercent != null ? ` (${data.progressPercent}%)` : '';
                    this._showBootUiEarly(`${data.stageMessage || 'Server starting…'}${pct}`);
                } else if (attempts === 1) {
                    this._showBootUiEarly('Waiting for server…');
                }
            } catch (_) {
                if (attempts === 1) {
                    this._showBootUiEarly('Waiting for server…');
                }
            }

            await new Promise((resolve) => setTimeout(resolve, pollMs));
        }

        throw new Error('Server did not become ready in time');
    }

    async _fetchManifest() {
        const response = await fetch('/', {
            method: 'OPTIONS',
            headers: {
                'X-Service-Worker-Version': '2.0',
                'X-Requested-With': 'ServiceWorker'
            }
        });
        if (!response.ok) {
            return [];
        }
        return response.json();
    }

    _flushPendingCacheUpdates() {
        if (!this._pendingCacheUpdateQueue.length) {
            return;
        }
        const queue = this._pendingCacheUpdateQueue.splice(0);
        queue.forEach((entry) => {
            if (entry.files && entry.files.length > 0) {
                this.updateStaticCache(entry.files, entry.silent, entry.cacheOptions);
            } else {
                this.checkStaticFileUpdates(entry.silent);
            }
        });
    }

    queueCacheUpdateUntilBoot(files, silent, cacheOptions) {
        this._pendingCacheUpdateQueue.push({ files, silent, cacheOptions });
    }

    _showInitUpdateModal(message, progress = 0) {
        if (!this._isPreStartupUpdatePhase() || !window.wsClient) return;
        this.initUpdateModalActive = true;
        window.wsClient.showWindowsUpdateModal(message, progress);
    }

    _updateInitUpdateModal(message, progress) {
        if (!this.initUpdateModalActive || !window.wsClient) return;
        window.wsClient.updateWindowsUpdateModal(message, progress);
    }

    _showInitUpdateRestartPrompt(message) {
        if (!this.initUpdateModalActive || !window.wsClient) return;
        this._setPreStartupUpdateStageMessage('Updates ready — restart required');
        window.wsClient.showWindowsUpdateRestartPrompt(message);
    }

    _hideInitUpdateModal() {
        if (!window.wsClient) return;
        this.initUpdateModalActive = false;
        window.wsClient.hideWindowsUpdateModal();
        window.wsClient.setUpdateModalCallbacks(null, null, null);
    }

    _waitForInitUpdateUserChoice() {
        return new Promise((resolve) => {
            if (!window.wsClient) {
                resolve({ action: 'later', success: true });
                return;
            }
            window.wsClient.setUpdateModalCallbacks(
                null,
                () => this.forceRestart(),
                () => {
                    this._hideInitUpdateModal();
                    resolve({ action: 'later', success: true });
                }
            );
        });
    }

    _setPreStartupUpdateStageMessage(message) {
        if (!this._isPreStartupUpdatePhase() || !window.wsClient) return;
        const ws = window.wsClient;
        ws._setConnectionBeat(ws.connectionUi.beat || 'negotiation', { message });
    }

    _getServiceWorkerTrayAnchor() {
        const icon = document.getElementById('serviceWorkerTrayIcon');
        return icon || null;
    }

    _ensureServiceWorkerTrayPopup() {
        if (this.trayPopup.el) {
            return;
        }

        const el = document.createElement('div');
        el.className = 'popover arrow-bottom-right service-worker-tray-popup';
        el.id = 'serviceWorkerUpdateTrayPopup';

        // We control show/hide manually; do not rely on PopoverManager click toggles.
        el.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        document.body.appendChild(el);
        this.trayPopup.el = el;

        // Close on outside click (but never auto-dismiss otherwise).
        document.addEventListener('click', (e) => {
            if (!this.trayPopup.el || !this.trayPopup.el.classList.contains('show')) return;
            if (this.trayPopup.el.contains(e.target)) return;
            // Ignore clicks on the tray icon; close is only via explicit close button.
        }, { passive: true });
    }

    _positionServiceWorkerTrayPopup() {
        if (!this.trayPopup.el) return;
        const anchor = this._getServiceWorkerTrayAnchor();
        if (!anchor) return;

        const popover = this.trayPopup.el;
        const rect = anchor.getBoundingClientRect();

        // Show temporarily for sizing.
        const wasHidden = !popover.classList.contains('show');
        if (wasHidden) {
            popover.style.visibility = 'hidden';
            popover.style.opacity = '0';
            popover.classList.add('show');
        }

        const popoverRect = popover.getBoundingClientRect();
        const arrowOffset = 18;
        const arrowRightOffset = parseFloat(getComputedStyle(popover).fontSize) || 16;

        let top = rect.top - popoverRect.height - arrowOffset;
        let left = rect.right - popoverRect.width + arrowRightOffset;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 8;

        if (left < padding) left = padding;
        if (left + popoverRect.width > viewportWidth - padding) left = viewportWidth - popoverRect.width - padding;
        if (top < padding) top = padding;
        if (top + popoverRect.height > viewportHeight - padding) top = viewportHeight - popoverRect.height - padding;

        // Match PopoverManager’s visual alignment tweak.
        left -= 10;

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;

        if (wasHidden) {
            popover.classList.remove('show');
            popover.style.visibility = '';
            popover.style.opacity = '';
        }
    }

    _hideServiceWorkerTrayPopup() {
        if (!this.trayPopup.el) return;
        this.trayPopup.el.classList.remove('show');
        this.trayPopup.state = 'hidden';
        if (this.trayPopup.kind === 'runtime-compile') {
            this.trayPopup.kind = 'sw-update';
        }
    }

    _renderServiceWorkerTrayPopup() {
        this._ensureServiceWorkerTrayPopup();
        const popover = this.trayPopup.el;
        const state = this.trayPopup.state;
        const isRuntimeCompile = this.trayPopup.kind === 'runtime-compile';

        const titleByState = isRuntimeCompile
            ? {
                downloading: 'Compiling runtime assets',
                complete: 'Compile complete',
                checking: 'Compile issue'
            }
            : {
                checking: 'Checking for updates',
                available: 'Updates available',
                downloading: 'Downloading updates',
                complete: 'Updates complete'
            };

        const showProgress = state === 'downloading';
        const progressVal = Math.max(0, Math.min(100, Math.round(this.trayPopup.progress || 0)));

        const message = this.trayPopup.message || '';
        const filesTotal = Number.isFinite(this.trayPopup.filesTotal) ? this.trayPopup.filesTotal : 0;
        const headerTitle = titleByState[state] || (isRuntimeCompile ? 'Runtime assets' : 'Service Worker');
        const headerIcon = isRuntimeCompile ? 'fa-compress' : 'fa-laptop-arrow-down';

        const wrap = document.createElement('div');
        wrap.className = 'popover-content';

        const header = document.createElement('div');
        header.className = 'popover-header';
        header.innerHTML = `<i class="fa-regular ${headerIcon}"></i><span>${headerTitle}</span>`;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'context-menu-icon-btn service-worker-tray-popup-close';
        closeBtn.title = 'Close';
        closeBtn.innerHTML = '<i class="fa-regular fa-xmark"></i>';
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isRuntimeCompile) {
                this._hideRuntimeCompileNotify();
            } else {
                if (this.trayPopup.state === 'downloading') {
                    this.trayPopup.dismissedUntilComplete = true;
                }
                this._hideServiceWorkerTrayPopup();
            }
        });

        const headerRow = document.createElement('div');
        headerRow.className = 'service-worker-tray-popup-header-row';
        headerRow.appendChild(header);
        headerRow.appendChild(closeBtn);
        wrap.appendChild(headerRow);

        const body = document.createElement('div');
        body.className = 'popover-body';

        if (isRuntimeCompile) {
            if (state === 'downloading') {
                body.textContent = message || 'Optimising CSS and JavaScript…';
            } else if (state === 'complete') {
                body.textContent = message || 'Runtime assets compiled successfully.';
            } else {
                body.textContent = message || 'Runtime compile finished with errors.';
            }
        } else if (state === 'available') {
            body.innerHTML = message || 'Resource updates are available.';
        } else if (state === 'downloading') {
            body.innerHTML = filesTotal > 0
                ? `Downloading ${filesTotal} files…`
                : (message || 'Downloading updates…');
        } else if (state === 'checking') {
            body.innerHTML = message || 'Scanning for available updates…';
        } else if (state === 'complete') {
            if (message) {
                body.innerHTML = message;
            } else {
                const count = Number.isFinite(this.trayPopup.filesTotal) ? this.trayPopup.filesTotal : 0;
                const fileLabel = count === 1 ? 'file' : 'files';
                body.innerHTML = `Completed updating ${count} ${fileLabel}. Restart to apply changes.`;
            }
        } else {
            body.innerHTML = message;
        }

        wrap.appendChild(body);

        if (showProgress) {
            const progressWrap = document.createElement('div');
            progressWrap.className = 'service-worker-tray-popup-progress-wrap';

            const bar = document.createElement('div');
            bar.setAttribute('role', 'progressbar');
            bar.setAttribute('aria-valuemin', '0');
            bar.setAttribute('aria-valuemax', '100');
            bar.setAttribute('aria-valuenow', String(progressVal));
            bar.className = 'animate';

            const fill = document.createElement('div');
            fill.style.width = `${progressVal}%`;
            bar.appendChild(fill);
            progressWrap.appendChild(bar);
            wrap.appendChild(progressWrap);
        }

        if (!isRuntimeCompile && state === 'available') {
            const actions = document.createElement('div');
            actions.className = 'service-worker-tray-popup-actions';

            const laterBtn = document.createElement('button');
            laterBtn.type = 'button';
            laterBtn.className = 'btn-standard btn-small';
            laterBtn.textContent = 'Later';
            laterBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._hideServiceWorkerTrayPopup();
            });

            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.className = 'btn-standard btn-small';
            downloadBtn.textContent = 'Download now';
            downloadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._hideServiceWorkerTrayPopup();
                this.checkStaticFileUpdates(false);
            });

            actions.appendChild(downloadBtn);
            actions.appendChild(laterBtn);
            wrap.appendChild(actions);
        }

        if (!isRuntimeCompile && state === 'complete') {
            const actions = document.createElement('div');
            actions.className = 'service-worker-tray-popup-actions';

            const laterBtn = document.createElement('button');
            laterBtn.type = 'button';
            laterBtn.className = 'btn-standard btn-small';
            laterBtn.textContent = 'Later';
            laterBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._hideServiceWorkerTrayPopup();
            });

            const restartBtn = document.createElement('button');
            restartBtn.type = 'button';
            restartBtn.className = 'btn-standard btn-small';
            restartBtn.textContent = 'Restart';
            restartBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.forceRestart();
            });

            actions.appendChild(restartBtn);
            actions.appendChild(laterBtn);
            wrap.appendChild(actions);
        }

        popover.innerHTML = '';
        popover.appendChild(wrap);
    }

    _showServiceWorkerTrayPopup(nextState, { message = '', progress = null, filesTotal = null, kind = null } = {}) {
        if (!this._isDesktopTrayMode()) {
            return false;
        }

        if (kind !== null) {
            this.trayPopup.kind = kind;
        }

        if (nextState === 'downloading' && this.trayPopup.kind !== 'runtime-compile' && this.trayPopup.dismissedUntilComplete) {
            // Stay hidden until completion.
            this.trayPopup.state = 'hidden';
            return false;
        }

        this.trayPopup.anchorEl = this._getServiceWorkerTrayAnchor();
        if (!this.trayPopup.anchorEl) return false;

        this.trayPopup.state = nextState;
        if (typeof message === 'string') this.trayPopup.message = message;
        if (progress !== null) this.trayPopup.progress = progress;
        if (filesTotal !== null) this.trayPopup.filesTotal = filesTotal;

        this._renderServiceWorkerTrayPopup();
        this._positionServiceWorkerTrayPopup();
        this.trayPopup.el.classList.add('show');
        return true;
    }
    
    async init() {
        if ('serviceWorker' in navigator) {
            try {
                this._kickApplicationBootEarly();
                this._showBootUiEarly('Checking server status…');
                await this._waitForServerReady();

                this.bootPhase = 'waiting_sw';
                this._showBootUiEarly('Loading offline cache…');

                // Register service worker (sw.js is served early on the server)
                this.swRegistration = await navigator.serviceWorker.register('/sw.js');
                console.log('Service Worker registered:', this.swRegistration);

                // Post-boot only — runBootSequence owns manifest/update checks during startup
                this.swRegistration.addEventListener('updatefound', () => {
                    if (this._bootOrchestrating || !this.bootComplete) {
                        return;
                    }
                    if (this.swRegistration.waiting) {
                        this.checkForWaiting();
                    }
                });

                if (this.swRegistration.installing) {
                    this.swRegistration.installing.addEventListener('statechange', (event) => {
                        if (event.target.state === 'installed') {
                            console.log('Service Worker installed successfully');
                        }
                    });
                }

                navigator.serviceWorker.addEventListener('message', (event) => {
                    this.handleServiceWorkerMessage(event);
                });

                this.startHealthCheck();

                console.log('Service Worker registration state:', {
                    active: !!this.swRegistration.active,
                    waiting: !!this.swRegistration.waiting,
                    installing: !!this.swRegistration.installing,
                    controller: !!navigator.serviceWorker.controller,
                    activeState: this.swRegistration.active?.state || 'none'
                });

                if (this.swRegistration.waiting) {
                    console.log('Service Worker is waiting for activation');
                    this.checkForWaiting();
                }

                await this.waitForServiceWorkerReady();
                await this.fetchSwConfig();

                if (window.isLoginPage) {
                    if (document.readyState === 'loading') {
                        await new Promise((resolve) => {
                            document.addEventListener('DOMContentLoaded', resolve, { once: true });
                        });
                    }
                    this.loginBootPromise = this.runLoginBootSequence();
                } else {
                    this.bootPromise = this.runBootSequence().then(() => {
                        this._resolveBootComplete();
                    }).catch((err) => {
                        console.error('Boot sequence failed:', err);
                        if (!this.bootComplete) {
                            this._resolveBootComplete();
                        }
                    });
                }

            } catch (error) {
                console.error('Service Worker registration failed:', error);
                console.error('Service Worker error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
                this.handleServiceWorkerError(error);
                if (window.isLoginPage) {
                    this._resolveLoginBootComplete();
                } else {
                    if (error.message !== 'Server did not become ready in time') {
                        this._showBootFatalError(error);
                    }
                    this._resolveBootComplete();
                }
            }
        } else {
            console.warn('Service Worker not supported in this browser');
            this.handleServiceWorkerNotSupported();
            if (window.isLoginPage) {
                this._resolveLoginBootComplete();
            } else {
                this._showBootFatalError(new Error('Service Worker not supported in this browser'));
                this._resolveBootComplete();
            }
        }
    }

    async waitForServiceWorkerReady() {
        return new Promise((resolve, reject) => {
            // Immediate check - if service worker is already ready, resolve immediately
            const immediateIsActive = this.swRegistration.active;
            const immediateHasController = navigator.serviceWorker.controller;
            const immediateIsActivated = immediateIsActive?.state === 'activated';

            if (immediateIsActive || immediateHasController || immediateIsActivated) {
                resolve();
                return;
            }

            console.log('⏳ Service Worker not immediately ready, starting wait logic...');
            let checkInterval;

            const checkReady = () => {
                // Check multiple readiness indicators
                const isActive = this.swRegistration.active;
                const isWaiting = this.swRegistration.waiting;
                const isInstalling = this.swRegistration.installing;
                const hasController = navigator.serviceWorker.controller;

                console.log('🔍 Service Worker state check:', {
                    active: !!isActive,
                    waiting: !!isWaiting,
                    installing: !!isInstalling,
                    controller: !!hasController,
                    activeState: isActive?.state || 'none'
                });

                // Service worker is ready if it's active OR if we have a controller (page is controlled)
                // Also check if active service worker state is 'activated'
                const isActivated = isActive?.state === 'activated';
                const isReady = isActive || hasController || isActivated;

                console.log('🔍 Ready evaluation:', {
                    isActive: !!isActive,
                    hasController: !!hasController,
                    isActivated: isActivated,
                    isReady: isReady,
                    condition: 'isActive || hasController || isActivated'
                });

                if (isReady) {
                    // Clear any existing timeout and interval
                    if (this.swReadyTimeout) {
                        clearTimeout(this.swReadyTimeout);
                        this.swReadyTimeout = null;
                    }
                    if (checkInterval) {
                        clearInterval(checkInterval);
                    }
                    resolve();
                    return; // Make sure we don't continue
                }
                console.log('⏳ Service Worker not ready yet, continuing to wait...');
                // Continue waiting if not ready yet
            };

            // Listen for controllerchange event (when service worker becomes active)
            const controllerChangeHandler = () => {
                console.log('🎯 Service Worker controller changed - service worker is now active');
                navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler);

                // Clear timeout and interval
                if (this.swReadyTimeout) {
                    clearTimeout(this.swReadyTimeout);
                    this.swReadyTimeout = null;
                }
                if (checkInterval) {
                    clearInterval(checkInterval);
                }

                resolve();
            };

            navigator.serviceWorker.addEventListener('controllerchange', controllerChangeHandler);

            // Start periodic checking as fallback
            checkInterval = setInterval(checkReady, 200); // Check every 200ms instead of 100ms

            // Initial check
            checkReady();

            // Hard wait — no timeout bypass; boot gate requires a controlling SW
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const timeoutMs = isIOS ? 120000 : 90000;

            this.swReadyTimeout = setTimeout(() => {
                console.error('Service Worker ready timeout — boot blocked');
                if (checkInterval) {
                    clearInterval(checkInterval);
                }
                navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler);
                reject(new Error('Service worker failed to become ready in time'));
            }, timeoutMs);
        });
    }

    handleServiceWorkerError(error) {
        // Mark service worker as unavailable but don't break the app
        this.swRegistration = null;

        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'warning',
                'Service Worker Unavailable',
                'Service worker failed to initialize. Some features are disabled.',
                false,
                5000,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        }
    }

    handleServiceWorkerNotSupported() {
        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'warning',
                'Service Worker Not Supported',
                'Your browser doesn\'t support service workers. Cache updates are unavailable.',
                false,
                5000,
                '<i class="fas fa-info-circle"></i>'
            );
        }
    }

    handleServiceWorkerTimeout() {
        console.log('ℹ️ Service Worker initialization completed (timeout reached)');

        // Show toast with option to force update service worker
        if (typeof showGlassToast === 'function') {
            this.timeoutToastId = showGlassToast(
                'warning',
                'Service Worker Slow',
                'Service worker took longer than expected to initialize.',
                false,
                10000, // Show for 10 seconds
                '<i class="fas fa-clock"></i>'
            );

            // Add button to force update after a short delay
            setTimeout(() => {
                if (this.timeoutToastId && typeof updateGlassToastButtons === 'function') {
                    const updateButton = {
                        text: 'Force Restart',
                        type: 'primary',
                        onClick: () => {
                            console.log('User requested service worker update');
                            this.forceUpdateServiceWorker();
                        },
                        closeOnClick: false // Keep toast open during update
                    };

                    const dismissButton = {
                        text: 'Dismiss',
                        type: 'secondary',
                        onClick: () => {
                            console.log('User dismissed service worker timeout notification');
                        },
                        closeOnClick: true
                    };

                    updateGlassToastButtons(this.timeoutToastId, [updateButton, dismissButton]);
                }
            }, 1000); // Wait 1 second before adding buttons
        }
    }
    
    async checkStaticFileUpdates(noToast = false) {
        if (!window.isLoginPage && !this.bootComplete && !this._bootOrchestrating) {
            return;
        }
        try {
            // First check if there's already a download in progress
            const swState = await this.checkDownloadState();
            if (swState && swState.isDownloading) {
                console.log('Download already in progress, syncing with existing download');
                // Sync with existing download
                this.isUpdating = true;
                const progress = swState.total > 0 
                    ? Math.round((swState.completed / swState.total) * 100) 
                    : 0;
                this.updateProgress = progress;
                
                if (!noToast && !this.updateToastId) {
                    this.showUpdateToast([{url: '...', hash: '...'}]);
                    this.updateProgressToast(progress);
                }
                
                // Check if stalled
                if (swState.lastProgressTime) {
                    const timeSinceProgress = Date.now() - swState.lastProgressTime;
                    if (timeSinceProgress > 30000) {
                        console.warn('Existing download appears stalled');
                        this.handleStalledDownload();
                    }
                }
                return; // Don't start a new check
            }
            
            // Make the actual request
            const response = await fetch('/', {
                method: 'OPTIONS',
                headers: {
                    'X-Service-Worker-Version': '2.0',
                    'X-Requested-With': 'ServiceWorker'
                }
            });

            if (response.ok) {
                const files = await response.json();
                await this.updateStaticCache(files, noToast);
            }
        } catch (error) {
            console.error('Failed to check static file updates:', error);
        }
    }
    
    async checkDownloadState() {
        if (!this.swRegistration || !this.swRegistration.active) {
            return null;
        }
        
        return new Promise((resolve) => {
            const requestId = Date.now().toString();
            
            const handler = (event) => {
                if (event.data.type === 'DOWNLOAD_STATE' && 
                    event.data.requestId === requestId) {
                    navigator.serviceWorker.removeEventListener('message', handler);
                    this.downloadState = event.data;
                    resolve(event.data);
                }
            };
            
            navigator.serviceWorker.addEventListener('message', handler);
            
            // Send request to service worker
            this.swRegistration.active.postMessage({
                type: 'GET_DOWNLOAD_STATE',
                requestId: requestId
            });
            
            // Timeout after 2 seconds
            setTimeout(() => {
                navigator.serviceWorker.removeEventListener('message', handler);
                resolve(null);
            }, 2000);
        });
    }

    async updateStaticCache(files, noToast = false, cacheOptions = null) {
        if (!window.isLoginPage && !this.bootComplete && !this._bootOrchestrating) {
            this.queueCacheUpdateUntilBoot(files, noToast, cacheOptions);
            return;
        }
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready');
            this.showServiceWorkerNotReadyToast();
            return;
        }

        try {
            // Check if service worker is already downloading
            const swState = await this.checkDownloadState();
            if (swState && swState.isDownloading) {
                console.warn('Service worker is already downloading, syncing with current status');
                // Immediately sync with current status
                this.isUpdating = true;
                const progress = swState.total > 0 
                    ? Math.round((swState.completed / swState.total) * 100) 
                    : 0;
                this.updateProgress = progress;
                
                if (!noToast) {
                    // Show or update the progress toast
                    if (!this.updateToastId) {
                        this.showCheckingForUpdatesToast();
                        setTimeout(() => {
                            if (typeof updateGlassToastComplete === 'function' && this.checkingToastId) {
                                updateGlassToastComplete(this.checkingToastId, {
                                    type: 'info',
                                    title: 'Download in Progress',
                                    message: `Downloading ${swState.completed}/${swState.total} files...`,
                                    showProgress: true,
                                    customIcon: '<i class="fas fa-download"></i>'
                                });
                                if (typeof updateGlassToastProgress === 'function') {
                                    updateGlassToastProgress(this.checkingToastId, progress);
                                }
                                this.updateToastId = this.checkingToastId;
                                this.checkingToastId = null;
                            }
                        }, 100);
                    } else {
                        // Update existing toast
                        this.updateProgressToast(progress);
                    }
                }
                
                // Check if download appears stalled
                if (swState.lastProgressTime) {
                    const timeSinceProgress = Date.now() - swState.lastProgressTime;
                    if (timeSinceProgress > 30000) {
                        console.warn('Download appears stalled when checking state');
                        this.handleStalledDownload();
                    }
                }
                
                return;
            }

            // Check if we're already updating — clear stale flag unless SW is actually downloading
            if (this.isUpdating) {
                const liveState = await this.checkDownloadState();
                if (!liveState || !liveState.isDownloading) {
                    this.isUpdating = false;
                } else {
                    console.warn('Update already in progress, syncing with existing download');
                    return;
                }
            }

            console.log('Checking for static file updates...');

            // Check which files need updating before showing UI — avoids flashing
            // "checking" when we already know the outcome is pending-only or up to date.
            const filesToUpdate = await this.getFilesNeedingUpdate(files);

            console.log(`Found ${filesToUpdate.length} files that need updating:`, filesToUpdate);

            if (filesToUpdate.length > 0) {
                console.log(`Found ${filesToUpdate.length} files that need updating`);

                if (!noToast) {
                    this._clearScheduledUpdateCompleteToast();
                    this.showCheckingForUpdatesToast();
                }
                
                // Update existing checking toast to show download progress
                this.showUpdateToastFromChecking(filesToUpdate);

                // Start background caching
                this.swRegistration.active.postMessage({
                    type: 'CACHE_STATIC_FILES',
                    files: filesToUpdate
                });
            } else if (!noToast) {
                this._clearScheduledUpdateCompleteToast();
                if (this.hasPendingUpdates()) {
                    this.showPendingUpdatesFromChecking();
                } else {
                    this.showNoUpdatesFromChecking();
                    if (this.swRegistration && this.swRegistration.active) {
                        this.swRegistration.active.postMessage({
                            type: 'NO_UPDATES_AVAILABLE'
                        });
                    }
                }
            } else {
                // Silently remove checking toast when noToast is true
                if (this.checkingToastId && typeof removeGlassToast === 'function') {
                    removeGlassToast(this.checkingToastId);
                    this.checkingToastId = null;
                }
                console.log('No application updates found');
            }
        } catch (error) {
            console.error('Error updating static cache:', error);
            this.showCacheUpdateErrorFromChecking(error);
        }
    }
    
    async _matchCachedFile(cache, file) {
        const candidates = new Set();
        if (file && file.url) {
            candidates.add(file.url);
        }
        const path = normalizeStaticFilePath(file.url);
        candidates.add(path);
        if (path === '/index.html') {
            candidates.add('/');
        }
        if (path === '/') {
            candidates.add('/index.html');
        }
        for (const key of candidates) {
            const match = await cache.match(key);
            if (match) {
                return match;
            }
        }
        return null;
    }

    async getFilesNeedingUpdate(files) {
        const filesToUpdate = [];
        
        for (const file of files) {
            try {
                const cache = await caches.open('static-cache-v1');
                const cachedResponse = await this._matchCachedFile(cache, file);
                
                if (!cachedResponse) {
                    filesToUpdate.push(file);
                    continue;
                }
                
                // Check if hash matches - look for the hash in multiple places
                let cachedHash = cachedResponse.headers.get('x-file-hash');
                
                // If no hash in headers, try to get it from the response URL or other sources
                if (!cachedHash) {
                    // Try to extract hash from response URL if it was stored there
                    const responseUrl = cachedResponse.url;
                    const urlHashMatch = responseUrl.match(/[?&]hash=([^&]+)/);
                    if (urlHashMatch) {
                        cachedHash = urlHashMatch[1];
                    }
                }
                
                if (!cachedHash || cachedHash !== file.hash) {
                    console.log(`Hash mismatch or missing for ${file.url}, adding to update list`);
                    filesToUpdate.push(file);
                }
            } catch (error) {
                console.error(`Error checking file ${file.url}:`, error);
                filesToUpdate.push(file);
            }
        }
        return filesToUpdate;
    }

    async fetchSwConfig() {
        if (!this.swRegistration || !this.swRegistration.active) {
            return this.swConfig;
        }
        try {
            const response = await this._requestSwConfig();
            if (response && typeof response.cssOnlyAutoApply === 'boolean') {
                this.swConfig = { cssOnlyAutoApply: response.cssOnlyAutoApply };
            }
        } catch (_) { /* keep default */ }
        return this.swConfig;
    }

    _requestSwConfig() {
        return new Promise((resolve, reject) => {
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const handler = (event) => {
                if (event.data.type === 'SW_CONFIG' && event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    resolve(event.data);
                }
            };
            this.messageHandlers.set(requestId, handler);
            navigator.serviceWorker.addEventListener('message', handler);
            this.swRegistration.active.postMessage({
                type: 'GET_SW_CONFIG',
                requestId
            });
            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error('SW config request timed out'));
                }
            }, 3000);
        });
    }

    isCssOnlyAutoApplyEnabled() {
        return this.swConfig.cssOnlyAutoApply !== false;
    }

    isCssOnlyUpdate(files) {
        if (!Array.isArray(files) || files.length === 0) {
            return false;
        }
        return files.every((file) => isCssStaticFilePath(normalizeStaticFilePath(file.url)));
    }

    hasScriptUpdate(files) {
        if (!Array.isArray(files) || files.length === 0) {
            return false;
        }
        return files.some((file) => isScriptStaticFilePath(normalizeStaticFilePath(file.url)));
    }

    isApplySafeUpdate(files) {
        if (!Array.isArray(files) || files.length === 0) {
            return false;
        }
        return files.every((file) => isApplySafeStaticFilePath(normalizeStaticFilePath(file.url)));
    }

    classifyStaticCacheUpdate(files) {
        if (!Array.isArray(files) || files.length === 0) {
            return 'restart';
        }
        if (this.hasScriptUpdate(files)) {
            return 'restart';
        }
        if (this.isCssOnlyUpdate(files)) {
            return 'css-only';
        }
        if (this.isApplySafeUpdate(files)) {
            return 'apply-safe';
        }
        return 'restart';
    }

    _resolveUpdatedFilesFromCacheComplete(data) {
        if (Array.isArray(data.updatedFiles) && data.updatedFiles.length > 0) {
            return data.updatedFiles;
        }
        const fromFiles = Array.isArray(data.files) ? data.files : [];
        if (fromFiles.length > 0 && fromFiles[0] && fromFiles[0].url) {
            return fromFiles;
        }
        return [];
    }

    _resolvePendingUpdateFilesCount(data) {
        const updatedFiles = this._resolveUpdatedFilesFromCacheComplete(data);
        if (updatedFiles.length > 0) {
            return updatedFiles.length;
        }
        if (data && data.total > 0) {
            return data.total;
        }
        return 0;
    }

    _formatPendingUpdatesRecheckMessage() {
        const count = this.pendingUpdateFilesTotal || 0;
        if (count > 0) {
            const fileLabel = count === 1 ? 'file' : 'files';
            return `No new updates found. Restart to apply ${count} pending ${fileLabel}.`;
        }
        return 'No new updates found. Restart to apply pending updates.';
    }

    refreshStaticStylesheet(pathname, hash) {
        const nextUrl = buildShaBustUrl(pathname, hash);
        document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
            const href = link.getAttribute('href');
            if (!href || !pathnameMatchesAssetUrl(pathname, href)) {
                return;
            }
            link.href = nextUrl;
        });
    }

    bumpStaticAssetReferences(pathname, hash) {
        const nextUrl = buildShaBustUrl(pathname, hash);
        document.querySelectorAll(`link[href*="${pathname}"], script[src*="${pathname}"]`).forEach((el) => {
            const attr = el.tagName === 'SCRIPT' ? 'src' : 'href';
            const val = el.getAttribute(attr);
            if (!val || !pathnameMatchesAssetUrl(pathname, val)) {
                return;
            }
            el.setAttribute(attr, nextUrl);
        });
    }

    async applyStaticCacheUpdate(files, options = {}) {
        const list = Array.isArray(files) && files.length > 0 ? files : this.pendingApplyFiles;
        if (!Array.isArray(list) || list.length === 0) {
            return;
        }

        const workspaceUpdates = [];
        const cssUpdates = [];
        const assetUpdates = [];

        for (const file of list) {
            const pathname = normalizeStaticFilePath(file.url);
            if (pathname.endsWith('/css/workspaces.css')) {
                workspaceUpdates.push(file.hash);
            } else if (isCssStaticFilePath(pathname)) {
                cssUpdates.push({ pathname, hash: file.hash });
            } else if (isApplySafeStaticFilePath(pathname)) {
                assetUpdates.push({ pathname, hash: file.hash });
            }
        }

        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                cssUpdates.forEach((entry) => {
                    this.refreshStaticStylesheet(entry.pathname, entry.hash);
                });
                assetUpdates.forEach((entry) => {
                    this.bumpStaticAssetReferences(entry.pathname, entry.hash);
                });
                resolve();
            });
        });

        for (const hash of workspaceUpdates) {
            // refreshWorkspaceStylesheet: public/scripts/comp/workspaceUtils.js
            await refreshWorkspaceStylesheet(hash);
            this.lastAppliedWorkspaceCssHash = hash || this.lastAppliedWorkspaceCssHash;
        }

        // switchWorkspaceTheme: public/scripts/comp/workspaceUtils.js
        switchWorkspaceTheme(activeWorkspace);

        this.pendingApplyFiles = null;
        this.pendingUpdateKind = 'restart';
        this.resetPendingUpdateFuse();
        this.hideUpdateToast();

        if (this._isDesktopTrayMode()) {
            this._hideServiceWorkerTrayPopup();
        }

        if (!options.silent && typeof showGlassToast === 'function') {
            showGlassToast(
                'success',
                'Updates Applied',
                'Styles and assets refreshed without restarting.',
                false,
                3000,
                '<i class="fas fa-check-circle"></i>'
            );
        }
    }

    _processStaticCacheComplete(data) {
        const filesCount = this._resolvePendingUpdateFilesCount(data);

        if (filesCount === 0) {
            console.log('Download completed but no files were updated');
            this.hideUpdateToast();
            return;
        }

        const silent = data.silent === true;
        const updatedFiles = this._resolveUpdatedFilesFromCacheComplete(data);
        const updateKind = this.classifyStaticCacheUpdate(updatedFiles);
        this.pendingUpdateKind = updateKind;
        const canApplyWithoutRestart = updateKind === 'css-only' || updateKind === 'apply-safe';
        this.pendingApplyFiles = canApplyWithoutRestart ? updatedFiles.slice() : null;

        console.log('Static cache update classified:', updateKind, updatedFiles);

        if (this._isInstallWizardActive()) {
            return;
        }

        if (canApplyWithoutRestart) {
            if (silent && this.isCssOnlyAutoApplyEnabled()) {
                this.applyStaticCacheUpdate(updatedFiles, { silent: true });
                return;
            }
            this.tripPendingUpdateFuse(filesCount);
            this.trayPopup.dismissedUntilComplete = false;
            if (this.initUpdateModalActive) {
                return;
            }
            this._scheduleUpdateCompleteToast('apply');
            return;
        }

        this.tripPendingUpdateFuse(filesCount);
        this.trayPopup.dismissedUntilComplete = false;
        if (this.initUpdateModalActive) {
            return;
        }
        this._scheduleUpdateCompleteToast('restart');
    }

    /**
     * Silently cache specific static files; resolves when SW finishes.
     * public/scripts/websocket.js (workspace_css_updated)
     */
    async cacheStaticFilesSilent(files) {
        if (!this.swRegistration || !this.swRegistration.active) {
            return { cached: 0, skipped: true };
        }
        if (!Array.isArray(files) || files.length === 0) {
            return { cached: 0, skipped: true };
        }

        const filesToUpdate = await this.getFilesNeedingUpdate(files);
        if (filesToUpdate.length === 0) {
            return { cached: 0, skipped: false };
        }

        return new Promise((resolve) => {
            let settled = false;
            const finish = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                navigator.serviceWorker.removeEventListener('message', handler);
                resolve(result);
            };

            const handler = (event) => {
                if (event.data.type === 'STATIC_CACHE_COMPLETE') {
                    const updatedFiles = this._resolveUpdatedFilesFromCacheComplete(event.data);
                    finish({ cached: updatedFiles.length, skipped: false });
                } else if (event.data.type === 'STATIC_CACHE_ERROR') {
                    finish({ cached: 0, skipped: false, error: event.data.error });
                }
            };

            navigator.serviceWorker.addEventListener('message', handler);
            this.swRegistration.active.postMessage({
                type: 'CACHE_STATIC_FILES',
                files: filesToUpdate,
                silent: true
            });

            setTimeout(() => finish({ cached: 0, skipped: false, timedOut: true }), 60000);
        });
    }
    
    showCheckingForUpdatesToast() {
        // Desktop mode: use tray popup
        if (this._isDesktopTrayMode()) {
            this._showServiceWorkerTrayPopup('checking', { message: 'Scanning for available updates…', progress: 0 });
            this.checkingToastId = 'service-worker-tray-popup';
        } else {
            // Non-desktop mode: use toast
            if (typeof showGlassToast === 'function') {
                this.checkingToastId = showGlassToast(
                    'info',
                    'Checking for Updates',
                    'Scanning for available updates...',
                    false,
                    false,
                    '<i class="fas fa-search"></i>'
                );
            }
        }
    }

    showServiceWorkerNotReadyToast() {
        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'warning',
                'Service Worker Unavailable',
                'Cache updates require service worker. Try refreshing the page.',
                false,
                5000,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        }
    }

    showNoUpdatesToast() {
        // Hide checking toast if it exists
        if (this.checkingToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.checkingToastId);
            this.checkingToastId = null;
        }

        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'success',
                'Up to Date',
                'Your app is already up to date!',
                false,
                3000,
                '<i class="fas fa-check-circle"></i>'
            );
        }
    }

    showCacheUpdateErrorToast(error) {
        // Hide checking toast if it exists
        if (this.checkingToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.checkingToastId);
            this.checkingToastId = null;
        }

        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'error',
                'Update Check Failed',
                'Failed to check for updates. Please try again.',
                false,
                5000,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        }
    }

    showCacheFileErrorToast(file, error) {
        if (typeof showGlassToast === 'function') {
            // Extract filename from URL for cleaner display
            const filename = file.split('/').pop() || file;
            showGlassToast(
                'warning',
                'Cache Error',
                `Failed to cache ${filename}: ${error}`,
                false,
                3000,
                '<i class="fas fa-exclamation-triangle"></i>'
            );
        }
    }

    // Methods to update the existing checking toast instead of replacing it
    showUpdateToastFromChecking(files) {
        // Convert checking toast to download progress toast (isUpdating set on STATIC_CACHE_STARTED)
        this.updateAvailable = true;
        this.updateProgress = 0;

        // Desktop mode: tray popup
        if (this._isDesktopTrayMode()) {
            this.trayPopup.dismissedUntilComplete = false;
            this._showServiceWorkerTrayPopup('downloading', { message: `Downloading ${files.length} files…`, progress: 0, filesTotal: files.length });
            this.updateToastId = 'service-worker-tray-popup';
            this.checkingToastId = null;
        } else {
            // Non-desktop mode: use toast
            if (this.checkingToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.checkingToastId, {
                    type: 'info',
                    title: 'Downloading Updates',
                    message: `Downloading ${files.length} updates...`,
                    showProgress: true,
                    customIcon: '<i class="fas fa-download"></i>'
                });
                // Keep the same toast ID for progress updates
                this.updateToastId = this.checkingToastId;
                this.checkingToastId = null;
            }
        }
    }

    showNoUpdatesFromChecking() {
        // Desktop mode: tray popup (auto-hide after short delay)
        if (this._isDesktopTrayMode()) {
            this._showServiceWorkerTrayPopup('checking', { message: 'Your app is already up to date!', progress: 100 });
            setTimeout(() => this._hideServiceWorkerTrayPopup(), 2200);
            this.checkingToastId = null;
        } else {
            // Non-desktop mode: use toast
            if (this.checkingToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.checkingToastId, {
                    type: 'success',
                    title: 'Up to Date',
                    message: 'Your app is already up to date!',
                    showProgress: false,
                    customIcon: '<i class="fas fa-check-circle"></i>',
                    timeout: 3000
                });
                // Clear the checking toast ID since it's now a completion toast
                this.checkingToastId = null;
            }
        }
    }

    showPendingUpdatesFromChecking() {
        this._clearScheduledUpdateCompleteToast();
        const message = this._formatPendingUpdatesRecheckMessage();
        if (this._isDesktopTrayMode()) {
            this._showServiceWorkerTrayPopup('complete', {
                kind: 'sw-update',
                message,
                progress: 100,
                filesTotal: this.pendingUpdateFilesTotal || 0
            });
            this.updateToastId = 'service-worker-tray-popup';
            this.checkingToastId = null;
        } else if (this.checkingToastId && typeof updateGlassToastComplete === 'function') {
            updateGlassToastComplete(this.checkingToastId, {
                type: 'warning',
                title: 'Restart Required',
                message,
                showProgress: false,
                customIcon: '<i class="fas fa-arrows-rotate"></i>',
                timeout: false
            });
            if (typeof updateGlassToastButtons === 'function') {
                updateGlassToastButtons(this.checkingToastId, [
                    {
                        text: 'Restart Now',
                        type: 'primary',
                        onClick: () => this.forceRestart(),
                        closeOnClick: true
                    },
                    {
                        text: 'Later',
                        type: 'secondary',
                        onClick: () => {},
                        closeOnClick: true
                    }
                ]);
            }
            this.updateToastId = this.checkingToastId;
            this.checkingToastId = null;
        }
    }

    showCacheUpdateErrorFromChecking(error) {
        // Desktop mode: tray popup (auto-hide)
        if (this._isDesktopTrayMode()) {
            this._showServiceWorkerTrayPopup('checking', { message: 'Failed to check for updates. Please try again.', progress: 0 });
            setTimeout(() => this._hideServiceWorkerTrayPopup(), 3500);
            this.checkingToastId = null;
        } else {
            // Non-desktop mode: use toast
            if (this.checkingToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.checkingToastId, {
                    type: 'error',
                    title: 'Update Check Failed',
                    message: 'Failed to check for updates. Please try again.',
                    showProgress: false,
                    customIcon: '<i class="fas fa-exclamation-triangle"></i>'
                });
                // Clear the checking toast ID since it's now an error toast
                this.checkingToastId = null;
            }
        }
    }

    showUpdateToast(files) {
        if (this._isInstallWizardActive()) {
            return;
        }

        // Hide checking toast if it exists
        if (this.checkingToastId && this.checkingToastId !== 'service-worker-tray-popup' && typeof removeGlassToast === 'function') {
            removeGlassToast(this.checkingToastId);
            this.checkingToastId = null;
        }

        this.updateAvailable = true;
        this.updateProgress = 0;

        // Desktop mode: tray popup
        if (this._isDesktopTrayMode()) {
            this.trayPopup.dismissedUntilComplete = false;
            this._showServiceWorkerTrayPopup('downloading', { message: `Downloading ${files.length} files…`, progress: 0, filesTotal: files.length });
            this.updateToastId = 'service-worker-tray-popup';
        } else {
            // Non-desktop mode: use toast
            if (typeof showGlassToast === 'function') {
                // Show progress toast
                this.updateToastId = showGlassToast(
                    'info',
                    'Downloading Updates',
                    `Downloading ${files.length} updates...`,
                    true,
                    false,
                    '<i class="fas fa-download"></i>'
                );
            }
        }
    }
    
    updateProgressToast(progress) {
        this.updateProgress = progress;

        if (this._isInstallWizardActive()) {
            return;
        }

        if (this.initUpdateModalActive && window.wsClient) {
            const { completed, total } = this.lastUpdateCounts;
            const message = total > 0
                ? `Downloading updates (${completed}/${total})...`
                : 'Downloading updates...';
            window.wsClient.updateWindowsUpdateModal(message, progress);
            return;
        }

        // Desktop mode: tray popup
        if (this._isDesktopTrayMode()) {
            if (this.updateToastId === 'service-worker-tray-popup') {
                this._showServiceWorkerTrayPopup('downloading', { progress: progress });
            }
        } else {
            // Non-desktop mode: use toast
            if (this.updateToastId && typeof updateGlassToastProgress === 'function') {
                updateGlassToastProgress(this.updateToastId, progress);
            }
        }
    }
    
    hideUpdateToast() {
        // Desktop mode: tray popup
        if (this._isDesktopTrayMode()) {
            if (this.updateToastId === 'service-worker-tray-popup') {
                this._hideServiceWorkerTrayPopup();
            }
        } else {
            // Non-desktop mode: use toast
            if (this.updateToastId && typeof removeGlassToast === 'function') {
                removeGlassToast(this.updateToastId);
            }
        }
        this.updateToastId = null;
        if (!this.pendingUpdateFuse) {
            this.updateAvailable = false;
        }
        this.isUpdating = false;
    }

    _resolveRuntimeCompilePercent(data) {
        if (!data) return 0;
        if (data.percent != null && Number.isFinite(data.percent)) {
            return Math.max(0, Math.min(100, data.percent));
        }
        if (data.total > 0 && data.current != null) {
            return Math.max(0, Math.min(100, (data.current / data.total) * 100));
        }
        return 0;
    }

    _hideRuntimeCompileNotify() {
        if (!this.runtimeCompileNotifyId) return;
        if (this._isDesktopTrayMode() && this.runtimeCompileNotifyId === 'service-worker-tray-popup') {
            this._hideServiceWorkerTrayPopup();
        } else if (typeof removeGlassToast === 'function') {
            removeGlassToast(this.runtimeCompileNotifyId);
        }
        this.runtimeCompileNotifyId = null;
    }

    handleRuntimeCompileProgress(data) {
        if (!data || data.inProgress === false) return;

        const percent = this._resolveRuntimeCompilePercent(data);
        const label = data.total > 0
            ? `Compiling ${data.current}/${data.total} (${Math.round(percent)}%)`
            : 'Compiling runtime assets…';

        if (this._isPreStartupUpdatePhase()) {
            this._setPreStartupUpdateStageMessage(label);
        }

        if (this._isDesktopTrayMode()) {
            this._showServiceWorkerTrayPopup('downloading', {
                kind: 'runtime-compile',
                message: 'Optimising CSS and JavaScript…',
                progress: percent,
                filesTotal: data.total || 0
            });
            this.runtimeCompileNotifyId = 'service-worker-tray-popup';
            return;
        }

        if (!this.runtimeCompileNotifyId) {
            // showGlassToast in toastManager.js
            this.runtimeCompileNotifyId = showGlassToast(
                'info',
                'Runtime Compile',
                'Compiling runtime assets…',
                true,
                false,
                '<i class="fas fa-compress"></i>'
            );
        }
        // updateGlassToastProgress in toastManager.js
        updateGlassToastProgress(this.runtimeCompileNotifyId, percent);
    }

    handleRuntimeCompileComplete(data) {
        const failedCount = data?.failedCount ?? (Array.isArray(data?.errors) ? data.errors.length : 0);
        const success = failedCount === 0;

        if (this._isPreStartupUpdatePhase()) {
            this._setPreStartupUpdateStageMessage(
                success ? 'Runtime assets compiled' : `${failedCount} file(s) failed to compile`
            );
        }

        if (this._isDesktopTrayMode()) {
            if (success) {
                this._showServiceWorkerTrayPopup('complete', {
                    kind: 'runtime-compile',
                    message: 'Runtime assets compiled successfully.',
                    progress: 100
                });
                this.runtimeCompileNotifyId = 'service-worker-tray-popup';
                setTimeout(() => {
                    if (this.runtimeCompileNotifyId === 'service-worker-tray-popup' && this.trayPopup.kind === 'runtime-compile') {
                        this._hideRuntimeCompileNotify();
                    }
                }, 2200);
            } else if (this.runtimeCompileNotifyId === 'service-worker-tray-popup') {
                this._showServiceWorkerTrayPopup('checking', {
                    kind: 'runtime-compile',
                    message: `${failedCount} file(s) failed to compile.`,
                    progress: 100
                });
            } else {
                this.runtimeCompileNotifyId = null;
            }
            return;
        }

        this._hideRuntimeCompileNotify();

        if (success && typeof showGlassToast === 'function') {
            showGlassToast(
                'success',
                'Runtime Compile',
                'Runtime assets compiled successfully.',
                false,
                3000,
                '<i class="fas fa-check-circle"></i>'
            );
        }
    }
    
    async cacheInternalData(url, data) {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready - skipping cache operation');
            return false;
        }
        
        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();
            
            // Set up message handler
            const handler = (event) => {
                if (event.data.type === 'INTERNAL_CACHE_COMPLETE' && 
                    event.data.url === url) {
                    this.messageHandlers.delete(requestId);
                    resolve(true);
                }
            };
            
            this.messageHandlers.set(requestId, handler);
            navigator.serviceWorker.addEventListener('message', handler);
            
            // Send message to service worker
            this.swRegistration.active.postMessage({
                type: 'CACHE_INTERNAL',
                url: url,
                data: data
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error('Cache operation timed out'));
                }
            }, 10000);
        });
    }
    
    // Delete from cache and precache a file
    async deleteAndPrecache(url) {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready - skipping cache operation');
            return false;
        }
        
        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();
            
            // Set up message handler
            const handler = (event) => {
                if (event.data.type === 'DELETE_AND_PRECACHE_COMPLETE' && 
                    event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    resolve(true);
                } else if (event.data.type === 'DELETE_AND_PRECACHE_ERROR' && 
                          event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error(event.data.error || 'Delete and precache failed'));
                }
            };
            
            this.messageHandlers.set(requestId, handler);
            navigator.serviceWorker.addEventListener('message', handler);
            
            // Send message to service worker
            this.swRegistration.active.postMessage({
                type: 'DELETE_AND_PRECACHE',
                url: url,
                requestId: requestId
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error('Delete and precache operation timed out'));
                }
            }, 10000);
        });
    }

    // Delete from service worker cache only (no precache)
    async deleteFromCache(url) {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready - skipping cache delete');
            return false;
        }

        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();

            const handler = (event) => {
                if (event.data.type === 'DELETE_FROM_CACHE_COMPLETE' &&
                    event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    resolve(true);
                } else if (event.data.type === 'DELETE_FROM_CACHE_ERROR' &&
                    event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error(event.data.error || 'Delete from cache failed'));
                }
            };

            this.messageHandlers.set(requestId, handler);
            navigator.serviceWorker.addEventListener('message', handler);

            this.swRegistration.active.postMessage({
                type: 'DELETE_FROM_CACHE',
                url: url,
                requestId: requestId
            });

            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error('Delete from cache operation timed out'));
                }
            }, 10000);
        });
    }
    
    async getCacheStatus() {
        if (!this.swRegistration || !this.swRegistration.active) {
            console.warn('Service Worker not ready - cannot get cache status');
            return null;
        }
        
        return new Promise((resolve, reject) => {
            const requestId = Date.now().toString();
            
            // Set up message handler
            const handler = (event) => {
                if (event.data.type === 'CACHE_STATUS' && 
                    event.data.requestId === requestId) {
                    this.messageHandlers.delete(requestId);
                    resolve({
                        static: event.data.static,
                        dynamic: event.data.dynamic,
                        internal: event.data.internal
                    });
                }
            };
            
            this.messageHandlers.set(requestId, handler);
            navigator.serviceWorker.addEventListener('message', handler);
            
            // Send message to service worker
            this.swRegistration.active.postMessage({
                type: 'GET_CACHE_STATUS',
                requestId: requestId
            });
            
            // Timeout after 5 seconds
            setTimeout(() => {
                if (this.messageHandlers.has(requestId)) {
                    this.messageHandlers.delete(requestId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    reject(new Error('Status request timed out'));
                }
            }, 5000);
        });
    }
    
    handleServiceWorkerMessage(event) {
        const { type, files, url, completed, total, currentFile } = event.data;
        
        switch (type) {
            case 'STATIC_CACHE_STARTED':
                this.updateAvailable = true;
                this.isUpdating = true;
                this.updateProgress = 0;
                this.lastProgressUpdate = Date.now();
                this.lastUpdateCounts = { completed: 0, total: event.data.total || 0 };
                this.lastUpdateFilesTotal = event.data.total || 0;
                console.log('Service worker started downloading updates');
                this._clearStallToast();
                // Clear any stall detection timeout
                if (this.stallDetectionTimeout) {
                    clearTimeout(this.stallDetectionTimeout);
                    this.stallDetectionTimeout = null;
                }
                // Start periodic state checking
                this.startPeriodicStateCheck();
                // Start heartbeat tracking
                this.startHeartbeatTracking();
                break;
                
            case 'STATIC_CACHE_PROGRESS':
                const progressTotal = total || 0;
                const prevCompleted = this.lastUpdateCounts.completed || 0;
                const progress = progressTotal > 0 ? Math.round((completed / progressTotal) * 100) : 0;
                this.updateProgress = progress;
                this.lastProgressUpdate = Date.now();
                this.lastUpdateCounts = { completed: completed || 0, total: progressTotal };
                this.lastUpdateFilesTotal = progressTotal || this.lastUpdateFilesTotal || 0;
                this.updateProgressToast(progress);

                if ((completed || 0) > prevCompleted) {
                    this._clearStallToast();
                }
                
                console.log(`Progress update: ${completed}/${progressTotal} (${progress}%)`);
                
                // Reset stall detection - we got progress
                if (this.stallDetectionTimeout) {
                    clearTimeout(this.stallDetectionTimeout);
                }
                // Set new stall detection timeout (60 seconds — align with attachToDownloadProgress)
                this.stallDetectionTimeout = setTimeout(() => {
                    console.warn('Download appears stalled - no progress for 60 seconds');
                    this.handleStalledDownload();
                }, DOWNLOAD_STALL_MS);
                
                // If this is a heartbeat, log it for debugging and track it
                if (event.data.heartbeat) {
                    console.log(`Download heartbeat: ${completed}/${total} (${progress}%)`);
                    this.lastHeartbeatTime = Date.now();
                }
                break;
                
            case 'STATIC_CACHE_COMPLETE':
                // Always clear isUpdating state, even if total is 0 (handles race condition with fast downloads)
                this.isUpdating = false;
                this.updateProgress = 100;
                this.updateProgressToast(100);
                this.lastUpdateCounts = { completed: event.data.completed || 0, total: event.data.total || 0 };
                this._clearStallToast();
                
                // Stop periodic state checking
                this.stopPeriodicStateCheck();
                
                // Stop heartbeat tracking
                this.stopHeartbeatTracking();
                
                // Clear stall detection
                if (this.stallDetectionTimeout) {
                    clearTimeout(this.stallDetectionTimeout);
                    this.stallDetectionTimeout = null;
                }
                
                // Clear heartbeat time
                this.lastHeartbeatTime = null;
                
                console.log('Download completed:', event.data);
                
                const filesCount = event.data.total > 0 ? event.data.total : (event.data.files ? event.data.files.length : 0);
                if (this._activeDownloadAttach) {
                    this._activeDownloadAttach({
                        success: filesCount >= 0,
                        filesDownloaded: event.data.completed || filesCount,
                        completed: event.data.completed != null ? event.data.completed : filesCount,
                        total: event.data.total != null ? event.data.total : filesCount,
                        hasErrors: false
                    });
                }
                if (filesCount > 0) {
                    if (this.initUpdateModalActive) {
                        this.tripPendingUpdateFuse(this._resolvePendingUpdateFilesCount(event.data));
                        break;
                    }
                    this._processStaticCacheComplete(event.data);
                } else {
                    console.log('Download completed but no files were downloaded');
                    this.hideUpdateToast();
                }
                break;
                
            case 'STATIC_CACHE_STALLED':
                console.warn('Service worker reports download stalled:', event.data);
                this.handleStalledDownload();
                break;
                
            case 'STATIC_CACHE_ALREADY_IN_PROGRESS':
                console.log('Service worker already downloading:', event.data.currentDownload);
                // Update our state to match service worker
                this.isUpdating = true;
                if (event.data.currentDownload) {
                    const progress = event.data.currentDownload.total > 0
                        ? Math.round((event.data.currentDownload.completed / event.data.currentDownload.total) * 100)
                        : 0;
                    this.updateProgress = progress;
                    this.updateProgressToast(progress);
                    
                    // Show update toast if not already shown (skip during pre-startup init modal)
                    if (!this.updateToastId && !this.initUpdateModalActive) {
                        this.showUpdateToast([{url: '...', hash: '...'}]);
                    }
                    
                    // Start periodic state checking and heartbeat tracking
                    this.startPeriodicStateCheck();
                    this.startHeartbeatTracking();
                    
                    // If we have a last progress time, use it as the last heartbeat time
                    if (event.data.currentDownload.lastProgressTime) {
                        this.lastHeartbeatTime = event.data.currentDownload.lastProgressTime;
                    }
                    
                    // Check if download appears stalled
                    if (event.data.currentDownload.lastProgressTime) {
                        const timeSinceProgress = Date.now() - event.data.currentDownload.lastProgressTime;
                        if (timeSinceProgress > 30000) {
                            console.warn('Download appears stalled based on last progress time');
                            this.handleStalledDownload();
                        }
                    }
                }
                break;
                
            case 'STATIC_CACHE_CANCELLED':
                console.log('Download cancelled');
                this.isUpdating = false;
                this.updateProgress = 0;
                this._clearStallToast();
                this.stopPeriodicStateCheck();
                this.stopHeartbeatTracking();
                this.lastHeartbeatTime = null;
                if (this.stallDetectionTimeout) {
                    clearTimeout(this.stallDetectionTimeout);
                    this.stallDetectionTimeout = null;
                }
                break;
                
            case 'DOWNLOAD_STATE':
                // Handle download state response
                const stateHandler = this.messageHandlers.get(event.data.requestId);
                if (stateHandler) {
                    stateHandler(event);
                }
                break;
                
            case 'INTERNAL_CACHE_COMPLETE':
                break;
                
            case 'CACHE_STATUS':
                // Handle cache status response
                const handler = this.messageHandlers.get(event.data.requestId);
                if (handler) {
                    handler(event);
                }
                break;

            case 'STATIC_CACHE_ERROR':
                // Handle cache error during file caching
                console.error(`Cache error for ${event.data.file}: ${event.data.error}`);
                this.showCacheFileErrorToast(event.data.file, event.data.error);
                break;

            case 'ping':
                // Handle ping response from service worker (response to our health check)
                this.lastPingResponseTime = Date.now();
                break;

            case 'SW_SCRIPT_UPDATED':
                // Boot manifest loop handles asset updates; only react during install wizard / login boot
                if (this.bootPhase === 'wizard' || this._readInstallWizardSession()?.active) {
                    this._writeInstallWizardSession({ phase: this.bootPhase || 'verify' });
                    if (this.swRegistration && this.swRegistration.waiting) {
                        this.checkForWaiting();
                    }
                } else if (this._loginBootOrchestrating || this._readLoginBootSession()?.active) {
                    this._writeLoginBootSession();
                    if (this.swRegistration && this.swRegistration.waiting) {
                        this.checkForWaiting();
                    }
                }
                break;
        }
    }
    
    // Start periodic state checking to keep UI in sync
    startPeriodicStateCheck() {
        if (this.stateCheckInterval) {
            clearInterval(this.stateCheckInterval);
        }
        
        this.stateCheckInterval = setInterval(async () => {
            if (!this.isUpdating) {
                this.stopPeriodicStateCheck();
                return;
            }
            
            try {
                const swState = await this.checkDownloadState();
                if (swState && swState.isDownloading) {
                    // Update UI with current state
                    const progress = swState.total > 0 
                        ? Math.round((swState.completed / swState.total) * 100) 
                        : 0;
                    
                    // Only update if different from current progress
                    if (progress !== this.updateProgress) {
                        console.log(`Periodic state check: updating progress from ${this.updateProgress}% to ${progress}%`);
                        this.updateProgress = progress;
                        this.updateProgressToast(progress);
                        this.lastProgressUpdate = Date.now();
                    }
                    
                    // Check for stall
                    if (swState.lastProgressTime) {
                        const timeSinceProgress = Date.now() - swState.lastProgressTime;
                        if (timeSinceProgress > 30000 && !this.stallDetectionTimeout) {
                            console.warn('Periodic check detected stalled download');
                            this.handleStalledDownload();
                        }
                    }
                } else {
                    // Service worker says download is not in progress
                    console.warn('Periodic check: Service worker reports no download, but we think it is');
                    if (this.isUpdating) {
                        // Download might have completed without us receiving the message
                        this.isUpdating = false;
                        this.stopPeriodicStateCheck();
                        // Try to check if it actually completed
                        if (this.updateProgress >= 100 && !this._updateCompleteToastTimeout
                            && this.updateToastId !== 'service-worker-tray-popup') {
                            this.showUpdateCompleteToast();
                        }
                    }
                }
            } catch (error) {
                console.error('Error in periodic state check:', error);
            }
        }, 5000); // Check every 5 seconds
    }
    
    stopPeriodicStateCheck() {
        if (this.stateCheckInterval) {
            clearInterval(this.stateCheckInterval);
            this.stateCheckInterval = null;
        }
    }

    startHeartbeatTracking() {
        // Stop any existing heartbeat check
        this.stopHeartbeatTracking();
        
        // Initialize last heartbeat time
        this.lastHeartbeatTime = Date.now();
        
        // Check for missed heartbeats every 5 seconds
        this.heartbeatCheckInterval = setInterval(() => {
            this.checkHeartbeatStatus();
        }, 5000);
    }

    stopHeartbeatTracking() {
        if (this.heartbeatCheckInterval) {
            clearInterval(this.heartbeatCheckInterval);
            this.heartbeatCheckInterval = null;
        }
    }

    checkHeartbeatStatus() {
        // Only check if we're in an update state and expecting heartbeats
        if (!this.isUpdating) {
            return;
        }

        // If we have a last heartbeat time, check if it's been too long
        if (this.lastHeartbeatTime) {
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatTime;
            // Heartbeats should come every 10 seconds, so if we haven't received one in 20 seconds, it's likely missed
            if (timeSinceLastHeartbeat > 20000) {
                // Heartbeat is missing - this will be picked up by getServiceWorkerHeartbeatStatus
                console.warn(`Service worker heartbeat missing for ${Math.round(timeSinceLastHeartbeat / 1000)}s`);
            }
        }
    }

    startHealthCheck() {
        // Stop any existing health check
        this.stopHealthCheck();
        
        // Record when health check started (for grace period)
        this.healthCheckStartTime = Date.now();
        
        // Don't initialize lastPingResponseTime - wait for first actual response
        // This way we can detect if service worker never responds
        
        // Send health check ping every 10 seconds
        this.healthCheckInterval = setInterval(() => {
            this.sendHealthCheckPing();
        }, 10000);
        
        // Send initial ping immediately
        this.sendHealthCheckPing();
    }

    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        this.healthCheckStartTime = null;
    }

    sendHealthCheckPing() {
        if (!this.swRegistration || !this.swRegistration.active) {
            this.lastPingResponseTime = null;
            return;
        }

        try {
            // Send ping to service worker
            this.swRegistration.active.postMessage({
                type: 'ping',
                timestamp: Date.now()
            });
            
            // Check if service worker is responding (if we haven't received a response in 15 seconds, it's likely stopped)
            if (this.lastPingResponseTime) {
                const timeSinceLastResponse = Date.now() - this.lastPingResponseTime;
                if (timeSinceLastResponse > 15000) {
                    console.warn(`Service worker not responding - last response ${Math.round(timeSinceLastResponse / 1000)}s ago`);
                }
            }
        } catch (error) {
            console.error('Error sending health check ping:', error);
            this.lastPingResponseTime = null;
        }
    }

    // Public method to get service worker heartbeat status
    getServiceWorkerHeartbeatStatus() {
        if (!this.swRegistration) {
            return {
                available: false,
                status: 'Not Registered',
                hasActive: false,
                isUpdating: false,
                heartbeatMissed: false,
                timeSinceLastHeartbeat: null,
                isResponding: false,
                timeSinceLastPingResponse: null
            };
        }

        const hasActive = !!this.swRegistration.active;
        const isReady = hasActive || !!navigator.serviceWorker.controller;

        // Check if service worker is responding to pings
        let isResponding = true;
        let timeSinceLastPingResponse = null;
        
        if (this.lastPingResponseTime) {
            timeSinceLastPingResponse = Date.now() - this.lastPingResponseTime;
            // If we haven't received a ping response in 15 seconds, service worker is likely stopped
            isResponding = timeSinceLastPingResponse < 15000;
        } else if (hasActive && this.healthCheckInterval && this.healthCheckStartTime) {
            // If we have an active service worker but no ping response time yet, check grace period
            const timeSinceHealthCheckStart = Date.now() - this.healthCheckStartTime;
            // Give 20 seconds grace period after starting health check before marking as not responding
            // This accounts for initial delay and potential slow responses
            if (timeSinceHealthCheckStart > 20000) {
                // Grace period expired, service worker is not responding
                isResponding = false;
                timeSinceLastPingResponse = timeSinceHealthCheckStart;
            }
        }

        // Check heartbeat status only if we're updating
        let heartbeatMissed = false;
        let timeSinceLastHeartbeat = null;

        if (this.isUpdating && this.lastHeartbeatTime) {
            timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatTime;
            // Heartbeats should come every 10 seconds, so if we haven't received one in 20 seconds, it's likely missed
            heartbeatMissed = timeSinceLastHeartbeat > 20000;
        } else if (this.isUpdating && !this.lastHeartbeatTime) {
            // If we're updating but haven't received a heartbeat yet, wait a bit before flagging as missed
            heartbeatMissed = false;
        }

        // Determine status
        let status = 'Active';
        if (!isResponding) {
            status = 'Stopped';
        } else if (this.isUpdating) {
            status = 'Updating';
            if (heartbeatMissed) {
                status = 'Heartbeat Missed';
            }
        } else if (!isReady) {
            status = 'Inactive';
        }

        return {
            available: true,
            status: status,
            hasActive: hasActive,
            isUpdating: this.isUpdating,
            heartbeatMissed: heartbeatMissed,
            timeSinceLastHeartbeat: timeSinceLastHeartbeat,
            isResponding: isResponding,
            timeSinceLastPingResponse: timeSinceLastPingResponse
        };
    }

    _clearStallToast() {
        if (this.stallToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.stallToastId);
        }
        this.stallToastId = null;
        this.stallRetryButtonsWired = false;
    }

    _wireStallToastRetryButton() {
        if (this.stallRetryButtonsWired || !this.stallToastId) {
            return;
        }
        this.stallRetryButtonsWired = true;
        setTimeout(() => {
            if (this.stallToastId && typeof updateGlassToastButtons === 'function') {
                const retryButton = {
                    text: 'Retry',
                    type: 'primary',
                    onClick: async () => {
                        console.log('User requested retry after stall');
                        this._clearStallToast();
                        await this.cancelDownload();
                        setTimeout(() => {
                            this.checkStaticFileUpdates();
                        }, 1000);
                    },
                    closeOnClick: true
                };
                updateGlassToastButtons(this.stallToastId, [retryButton]);
            }
        }, 1000);
    }

    async handleStalledDownload() {
        console.warn('Handling stalled download');
        
        // Check current state from service worker
        const swState = await this.checkDownloadState();
        if (swState && swState.isDownloading) {
            const timeSinceProgress = swState.lastProgressTime 
                ? Date.now() - swState.lastProgressTime 
                : 0;
            
            // Update UI with current state
            const progress = swState.total > 0 
                ? Math.round((swState.completed / swState.total) * 100) 
                : 0;
            this.updateProgress = progress;
            this.updateProgressToast(progress);
            
            if (typeof showGlassToast === 'function') {
                const message = timeSinceProgress > 0
                    ? `Download stalled (no progress for ${Math.round(timeSinceProgress/1000)}s). Current: ${swState.completed}/${swState.total}. Click to retry.`
                    : `Download appears stalled. Current: ${swState.completed}/${swState.total}. Click to retry.`;

                if (this.stallToastId && typeof updateGlassToastMessage === 'function') {
                    updateGlassToastMessage(this.stallToastId, message);
                } else {
                    this.stallToastId = showGlassToast(
                        'warning',
                        'Download Stalled',
                        message,
                        false,
                        false,
                        '<i class="fas fa-exclamation-triangle"></i>'
                    );
                    this._wireStallToastRetryButton();
                }
            }
            
            // Optionally offer to cancel and retry
            console.warn(`Stalled download state: ${swState.completed}/${swState.total}, last progress: ${swState.lastProgressTime ? new Date(swState.lastProgressTime).toISOString() : 'unknown'}`);
        } else {
            // Service worker says it's not downloading, but we think it is
            // This might mean the download completed or crashed
            console.warn('Service worker reports no download in progress, but we thought it was');
            this._clearStallToast();
            this.isUpdating = false;
            this.stopPeriodicStateCheck();
        }
    }
    
    async cancelDownload() {
        if (!this.swRegistration || !this.swRegistration.active) {
            return;
        }
        
        this.swRegistration.active.postMessage({
            type: 'CANCEL_DOWNLOAD'
        });
        
        this.isUpdating = false;
        this.updateProgress = 0;
        this.lastProgressUpdate = null;
        this._clearStallToast();
        
        this.stopPeriodicStateCheck();
        this.stopHeartbeatTracking();
        
        if (this.stallDetectionTimeout) {
            clearTimeout(this.stallDetectionTimeout);
            this.stallDetectionTimeout = null;
        }
        
        // Clear heartbeat time
        this.lastHeartbeatTime = null;
    }

    async syncImageCacheRules(favoriteUrls = [], lockedPreviewUrls = [], policy = null) {
        try {
            const worker = this.swRegistration?.active || navigator.serviceWorker?.controller;
            if (!worker) {
                return false;
            }

            worker.postMessage({
                type: 'SYNC_IMAGE_CACHE_RULES',
                favoriteUrls: Array.isArray(favoriteUrls) ? favoriteUrls : [],
                lockedPreviewUrls: Array.isArray(lockedPreviewUrls) ? lockedPreviewUrls : [],
                policy: policy && typeof policy === 'object' ? policy : undefined
            });

            return true;
        } catch (error) {
            console.error('Failed to sync image cache rules:', error);
            return false;
        }
    }
    
    async checkForWaiting() {
        if (this.swRegistration && this.swRegistration.waiting) {
            console.log('Service worker update waiting, activating...');

            // Show notification about update being available
            if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'info',
                    'Update Ready',
                    'A new version is ready. Activating update...',
                    false,
                    3000,
                    '<i class="fas fa-sync"></i>'
                );
            }

            // Send skip waiting message
            this.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });

            // Wait a moment for the new service worker to activate
            setTimeout(() => {
                console.log('Reloading page to activate new service worker');
                window.location.reload();
            }, 1000);
        }
    }
    
    // Public method to manually trigger update check
    async checkForUpdates() {
        if (this.swRegistration) {
            await this.swRegistration.update();
        }
    }
    
    // Public method to get cache statistics
    async getCacheStats() {
        try {
            const status = await this.getCacheStatus();
            return status;
        } catch (error) {
            console.error('Failed to get cache stats:', error);
            return null;
        }
    }

    // Public method to check service worker health
    async checkServiceWorkerHealth() {
        try {
            if (!this.swRegistration) {
                return { healthy: false, reason: 'No service worker registration' };
            }

            const hasActive = !!this.swRegistration.active;
            const hasController = !!navigator.serviceWorker.controller;
            const isReady = hasActive || hasController;

            return {
                healthy: isReady,
                active: hasActive,
                controller: hasController,
                state: this.swRegistration.active?.state || 'unknown',
                scope: this.swRegistration.scope,
                installing: !!this.swRegistration.installing,
                waiting: !!this.swRegistration.waiting
            };
        } catch (error) {
            console.error('Error checking service worker health:', error);
            return { healthy: false, reason: error.message };
        }
    }

    // Clear timeout toast
    clearTimeoutToast() {
        if (this.timeoutToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.timeoutToastId);
            this.timeoutToastId = null;
        }
    }

    // Public method to force unregister and reregister service worker
    async forceUpdateServiceWorker() {
        console.log('🔄 Force updating service worker...');

        try {
            // Show loading state in the toast
            if (this.timeoutToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.timeoutToastId, {
                    type: 'info',
                    title: 'Updating Service Worker',
                    message: 'Please wait while we update the service worker...',
                    customIcon: '<i class="fas fa-spinner-third fa-spin"></i>'
                });
            }

            // Step 1: Unregister current service worker
            if (this.swRegistration) {
                console.log('🗑️ Unregistering current service worker...');
                const unregistered = await this.swRegistration.unregister();
                console.log('Unregister result:', unregistered);

                // Clear current registration
                this.swRegistration = null;
                this.isUpdating = false;
                this.initialCheckDone = false;
                this.tripPendingUpdateFuse();
            }

            // Step 2: Clear any existing timeouts
            if (this.swReadyTimeout) {
                clearTimeout(this.swReadyTimeout);
                this.swReadyTimeout = null;
            }

            // Step 3: Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 4: Force refresh the service worker cache
            console.log('🔄 Fetching fresh service worker...');
            const response = await fetch('/sw.js', {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch service worker: ${response.status}`);
            }

            console.log('✅ Fresh service worker fetched');

            // Step 5: Reregister service worker
            console.log('📝 Reregistering service worker...');
            this.swRegistration = await navigator.serviceWorker.register('/sw.js', {
                scope: '/',
                updateViaCache: 'none' // Force fresh fetch
            });

            console.log('✅ Service worker reregistered:', this.swRegistration);

            // Step 6: Reinitialize event listeners
            this.swRegistration.addEventListener('updatefound', () => {
                console.log('🔄 Service Worker update found after force update');
                this.checkForUpdates();
            });

            if (this.swRegistration.installing) {
                this.swRegistration.installing.addEventListener('statechange', (event) => {
                    console.log('Service Worker installing state changed after force update:', event.target.state);
                });
            }

            // Re-add message listener
            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleServiceWorkerMessage(event);
            });

            // Step 7: Wait for new service worker to be ready
            await this.waitForServiceWorkerReady();

            console.log('🎉 Service worker force update completed successfully');

            // Show success message
            if (this.timeoutToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.timeoutToastId, {
                    type: 'success',
                    title: 'Service Worker Updated',
                    message: 'Service worker has been successfully updated and reregistered.',
                    customIcon: '<i class="fas fa-check-circle"></i>'
                });

                // Auto-close success toast after 3 seconds
                setTimeout(() => {
                    this.clearTimeoutToast();
                }, 3000);
            } else if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'success',
                    'Service Worker Updated',
                    'Service worker has been successfully updated and reregistered.',
                    false,
                    3000,
                    '<i class="fas fa-check-circle"></i>'
                );
            }

            return { success: true, message: 'Service worker updated successfully' };

        } catch (error) {
            console.error('❌ Error during service worker force update:', error);

            // Show error message in the existing toast or create a new one
            if (this.timeoutToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.timeoutToastId, {
                    type: 'error',
                    title: 'Update Failed',
                    message: `Failed to update service worker: ${error.message}`,
                    customIcon: '<i class="fas fa-exclamation-triangle"></i>'
                });
            } else if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'error',
                    'Update Failed',
                    `Failed to update service worker: ${error.message}`,
                    false,
                    5000,
                    '<i class="fas fa-exclamation-triangle"></i>'
                );
            }

            return { success: false, error: error.message };
        }
    }

    // Refresh server cache and check for updates
    async refreshServerCacheAndCheck() {
        console.log('Refreshing server cache and checking for updates...');
        try {
            // Check if WebSocket client is available
            if (window.wsClient && window.wsClient.isConnected()) {
                // Use WebSocket to refresh server cache
                const result = await window.wsClient.refreshServerCache();
                console.log('Server cache refresh result:', result);

                // Wait a moment for the server to process
                setTimeout(async () => {
                    // Check for static file updates
                    await this.checkStaticFileUpdates();
                }, 1000);

            } else {
                console.warn('WebSocket not connected, using HTTP fallback');
                // Fallback to HTTP OPTIONS request
                await this.checkStaticFileUpdates();
            }
        } catch (error) {
            console.error('Error refreshing server cache:', error);
        }
    }

    // Initialization step: Check for and download updates as part of startup process
    async checkAndDownloadUpdatesForInit() {
        const useInitModal = this._isPreStartupUpdatePhase();
        try {
            console.log('🔍 Checking for application updates during startup...');

            if (useInitModal) {
                this._setPreStartupUpdateStageMessage('Checking for updates...');
            }

            // Make the actual request
            const response = await fetch('/', {
                method: 'OPTIONS',
                headers: {
                    'X-Service-Worker-Version': '2.0',
                    'X-Requested-With': 'ServiceWorker'
                }
            });

            if (!response.ok) {
                console.log('No update information available, continuing...');
                this.initialCheckDone = true;
                return; // No updates available
            }

            const files = await response.json();

            // Check which files need updating
            const filesToUpdate = await this.getFilesNeedingUpdate(files);

            if (filesToUpdate.length === 0) {
                console.log('✅ No updates available');
                this.initialCheckDone = true;
                return; // No updates needed
            }

            console.log(`📦 Found ${filesToUpdate.length} updates to download`);

            if (useInitModal) {
                this._showInitUpdateModal(`Downloading ${filesToUpdate.length} updates...`, 0);
            }

            // Start downloading updates with integrated progress - AWAIT the result
            const downloadResult = await this.downloadUpdatesForInit(filesToUpdate);
            this.initialCheckDone = true;
            console.log('Update download process completed:', downloadResult);

            // Restart-required updates reload inside downloadUpdatesForInit

        } catch (error) {
            console.error('❌ Error during update check:', error);
            if (useInitModal && this.initUpdateModalActive) {
                this._hideInitUpdateModal();
            }
            this.initialCheckDone = true;
            // Don't fail the startup process for update check errors - continue normally
        }
    }

    // Download updates with integrated progress for initialization
    async downloadUpdatesForInit(files) {
        const useInitModal = this._isPreStartupUpdatePhase();

        const onProgress = ({ completed, total, progress }) => {
            this.lastUpdateCounts = { completed, total };
            if (useInitModal) {
                this._updateInitUpdateModal(
                    total > 0 ? `Downloading updates (${completed}/${total})...` : 'Downloading updates...',
                    progress
                );
            }
        };

        if (useInitModal) {
            this._showInitUpdateModal(`Downloading ${files.length} updates...`, 0);
            window.wsClient.setUpdateModalCallbacks(
                () => {
                    if (this._attachDownloadSkipHandler) {
                        this._attachDownloadSkipHandler();
                    }
                },
                () => this.forceRestart(),
                null
            );
        } else if (this._isDesktopTrayMode()) {
            this.showUpdateToast(files);
        }

        const result = await this.attachToDownloadProgress({
            files,
            onProgress,
            allowSkip: useInitModal,
            onSkip: () => {
                if (useInitModal) {
                    this._hideInitUpdateModal();
                }
            }
        });

        if (result.success && result.filesDownloaded > 0 && !result.hasErrors) {
            const updateKind = this.classifyStaticCacheUpdate(files);
            const canApplyWithoutRestart = (updateKind === 'css-only' || updateKind === 'apply-safe')
                && this.isCssOnlyAutoApplyEnabled();

            if (canApplyWithoutRestart) {
                if (useInitModal) {
                    this._hideInitUpdateModal();
                }
                await this.applyStaticCacheUpdate(files);
                return { success: true, filesDownloaded: result.filesDownloaded, userChoice: 'apply' };
            }

            // Boot init downloads: script updates must reload to execute — same as install wizard finish
            if (useInitModal) {
                this._updateInitUpdateModal('Restarting Dreamscape...', 100);
                this._setPreStartupUpdateStageMessage('Restarting Dreamscape...');
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
            this.forceRestart();
            return { success: true, filesDownloaded: result.filesDownloaded, userChoice: 'restart' };
        }

        if (useInitModal && result.userChoice !== 'restart') {
            this._hideInitUpdateModal();
        }

        if (result.stalled) {
            console.error(`Update download stalled at ${result.completed}/${result.total}`);
        }

        return result;
    }

    // Show Restart and Skip buttons for initialization updates
    showRestartSkipButtonsForInit(onUserChoice) {
        if (window.wsClient && window.wsClient.progressToastId && typeof updateGlassToastButtons === 'function') {
            const restartButton = {
                text: 'Restart',
                type: 'primary',
                onClick: () => {
                    console.log('User chose to restart after update during startup');
                    // Force restart - this will reload the page
                    this.forceRestart();
                    // Don't call onUserChoice since page will reload
                },
                closeOnClick: false
            };

            const skipButton = {
                text: 'Skip',
                type: 'secondary',
                onClick: () => {
                    console.log('User chose to skip restart after update during startup');

                    // Reset toast to info type and show progress bar
                    if (window.wsClient && window.wsClient.progressToastId && typeof updateGlassToastComplete === 'function') {
                        updateGlassToastComplete(window.wsClient.progressToastId, {
                            type: 'info',
                            title: 'Dreamscape',
                            message: 'Continuing...',
                            customIcon: '<i class="fa-duotone fa-star-christmas"></i>',
                            showProgress: true
                        });
                        // Show progress at 95% since updates are downloaded but we're continuing
                        if (typeof updateGlassToastProgress === 'function') {
                            updateGlassToastProgress(window.wsClient.progressToastId, 95);
                        }
                    }

                    onUserChoice({ action: 'skip', success: true });
                },
                closeOnClick: false
            };

            updateGlassToastButtons(window.wsClient.progressToastId, [restartButton, skipButton]);

            // Update the progress notification to show completion with warning styling and hidden progress bar
            if (window.wsClient && window.wsClient.progressToastId && typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(window.wsClient.progressToastId, {
                    type: 'warning',
                    title: 'Dreamscape',
                    message: 'Updates downloaded. Restart to apply changes.',
                    customIcon: '<i class="fa-duotone fa-star-christmas"></i>',
                    showProgress: false,
                    timeout: false
                });
            }
        } else {
            // Fallback if buttons can't be added - continue with skip
            console.log('Could not show restart/skip buttons, continuing with skip');
            onUserChoice({ action: 'skip', success: true });
        }
    }

    // Manual retry for cache updates (useful for iOS or failed updates)
    async retryCacheUpdate() {
        console.log('Manual retry of cache update requested');
        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'info',
                'Retrying Updates',
                'Checking for available updates...',
                false,
                3000,
                '<i class="fas fa-redo"></i>'
            );
        }

        try {
            await this.checkStaticFileUpdates();
        } catch (error) {
            console.error('Manual cache update retry failed:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'error',
                    'Retry Failed',
                    'Manual update retry failed. Please refresh the page.',
                    false,
                    5000,
                    '<i class="fas fa-exclamation-triangle"></i>'
                );
            }
        }
    }
    
    // Show update complete toast with restart or apply button
    showUpdateCompleteToast(mode = 'restart') {
        if (this._isInstallWizardActive()) {
            return;
        }

        // Manual re-check already showed the pending-restart prompt — don't overwrite it.
        if (this.trayPopup.state === 'complete' && this.trayPopup.kind === 'sw-update'
            && typeof this.trayPopup.message === 'string'
            && this.trayPopup.message.startsWith('No new updates found')) {
            return;
        }

        if (mode === 'apply') {
            if (this._isDesktopTrayMode()) {
                const filesTotal = this.pendingUpdateFilesTotal || this.trayPopup.filesTotal || 0;
                this._showServiceWorkerTrayPopup('complete', {
                    kind: 'sw-update',
                    filesTotal,
                    progress: 100,
                    message: 'Updates ready — apply without restart'
                });
                this.updateToastId = 'service-worker-tray-popup';
            } else if (this.updateToastId && typeof updateGlassToastButtons === 'function') {
                const applyButton = {
                    text: 'Apply Now',
                    type: 'primary',
                    onClick: () => {
                        this.applyStaticCacheUpdate(this.pendingApplyFiles);
                    },
                    closeOnClick: true
                };
                const laterButton = {
                    text: 'Later',
                    type: 'secondary',
                    onClick: () => {},
                    closeOnClick: true
                };
                updateGlassToastButtons(this.updateToastId, [applyButton, laterButton]);
                if (typeof updateGlassToastComplete === 'function') {
                    updateGlassToastComplete(this.updateToastId, {
                        type: 'success',
                        title: 'Updates Complete',
                        message: 'CSS and assets can be applied without restarting.',
                        customIcon: '<i class="fas fa-check-circle"></i>'
                    });
                }
            }
            return;
        }

        // Desktop mode: tray popup completion prompt
        if (this._isDesktopTrayMode()) {
            const filesTotal = this.pendingUpdateFilesTotal || this.trayPopup.filesTotal || 0;
            const message = this._formatDownloadCompleteMessage();
            this._showServiceWorkerTrayPopup('complete', {
                kind: 'sw-update',
                filesTotal,
                progress: 100,
                message
            });
            this.updateToastId = 'service-worker-tray-popup';
        } else {
            // Non-desktop mode: use toast
            if (this.updateToastId && typeof updateGlassToastButtons === 'function') {
                const restartButton = {
                    text: 'Restart Now',
                    type: 'primary',
                    onClick: () => {
                        console.log('Restart requested by user');
                        this.forceRestart();
                    },
                    closeOnClick: true
                };

                const laterButton = {
                    text: 'Later',
                    type: 'secondary',
                    onClick: () => {
                        console.log('User chose to restart later');
                    },
                    closeOnClick: true
                };

                updateGlassToastButtons(this.updateToastId, [restartButton, laterButton]);

                // Update the toast content to show completion
                if (typeof updateGlassToastComplete === 'function') {
                    updateGlassToastComplete(this.updateToastId, {
                        type: 'success',
                        title: 'Updates Complete',
                        message: 'Updates have been downloaded. Restart to apply changes.',
                        customIcon: '<i class="fas fa-check-circle"></i>'
                    });
                }
            }
        }
    }
    
    // Force restart with bypass confirmation
    forceRestart() {
        console.log('🔄 Force restarting application...');
        this.resetPendingUpdateFuse();

        try {
            // Set bypass confirmation to true to avoid confirmation dialogs
            bypassConfirmation = true;
            
            // Small delay to ensure bypass confirmation is set
            setTimeout(() => {
                try {
                    window.location.reload();
                } catch (e1) {
                    window.location.href = window.location.href;
                }
            }, 100);
        } catch (error) {
            console.error('❌ Error during force restart:', error);
            alert('Restart failed. Please refresh the page manually to apply updates.');
        }
    }

    // Shared stall-based download progress attach — boot gate, wizard, init, login
    attachToDownloadProgress(options = {}) {
        const {
            files = null,
            onProgress = null,
            allowSkip = false,
            onSkip = null,
            stallMs = DOWNLOAD_STALL_MS
        } = options;

        return new Promise(async (resolve) => {
            if (!this.swRegistration || !this.swRegistration.active) {
                resolve({ success: false, reason: 'Service Worker not ready' });
                return;
            }

            let completed = 0;
            let total = 0;
            let hasErrors = false;
            let finished = false;
            let skipRequested = false;
            let stallTimer = null;
            let progressHandler = null;

            const cleanup = () => {
                if (stallTimer) {
                    clearTimeout(stallTimer);
                    stallTimer = null;
                }
                if (progressHandler) {
                    navigator.serviceWorker.removeEventListener('message', progressHandler);
                    progressHandler = null;
                }
                if (this._activeDownloadAttach === finishDownload) {
                    this._activeDownloadAttach = null;
                }
            };

            const resetStallTimer = () => {
                if (stallTimer) {
                    clearTimeout(stallTimer);
                }
                stallTimer = setTimeout(() => {
                    handleStallTimeout();
                }, stallMs);
            };

            const reportProgress = (c, t) => {
                completed = c || 0;
                total = t || 0;
                this.lastUpdateCounts = { completed, total };
                const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
                this.updateProgress = progress;
                if (typeof onProgress === 'function') {
                    onProgress({ completed, total, progress });
                }
            };

            const finishDownload = async (result) => {
                if (finished) {
                    return;
                }
                if (!result.stalled && result.userChoice !== 'skip' && !result.hasErrors && result.success !== true) {
                    const liveState = await this.checkDownloadState();
                    if (liveState && liveState.isDownloading) {
                        return;
                    }
                }
                finished = true;
                cleanup();
                const finalState = await this.checkDownloadState();
                if (!finalState || !finalState.isDownloading) {
                    this.isUpdating = false;
                }
                const c = result.completed != null ? result.completed : (finalState?.completed ?? completed);
                const t = result.total != null ? result.total : (finalState?.total ?? total);
                resolve({
                    ...result,
                    completed: c,
                    total: t,
                    filesDownloaded: result.filesDownloaded != null ? result.filesDownloaded : c
                });
            };

            const handleStallTimeout = async () => {
                const swState = await this.checkDownloadState();
                const c = swState?.completed ?? completed;
                const t = swState?.total ?? total;
                if (swState && swState.isDownloading) {
                    console.warn(`Download stalled at ${c}/${t} — no progress for ${stallMs / 1000}s`);
                    await finishDownload({
                        success: false,
                        stalled: true,
                        timedOut: true,
                        completed: c,
                        total: t,
                        filesDownloaded: c,
                        hasErrors
                    });
                }
            };

            progressHandler = (event) => {
                if (skipRequested || finished) {
                    return;
                }
                const { type } = event.data || {};
                if (type === 'STATIC_CACHE_STARTED') {
                    this.isUpdating = true;
                    total = event.data.total || total;
                    reportProgress(completed, total);
                    resetStallTimer();
                } else if (type === 'STATIC_CACHE_PROGRESS') {
                    reportProgress(event.data.completed || 0, event.data.total || 0);
                    resetStallTimer();
                } else if (type === 'STATIC_CACHE_COMPLETE') {
                    const filesCount = event.data.total > 0
                        ? event.data.total
                        : (event.data.files ? event.data.files.length : completed);
                    reportProgress(filesCount, filesCount || total);
                    finishDownload({
                        success: !hasErrors && filesCount >= 0,
                        filesDownloaded: filesCount,
                        completed: filesCount,
                        total: filesCount || total,
                        hasErrors
                    });
                } else if (type === 'STATIC_CACHE_ERROR') {
                    hasErrors = true;
                }
            };

            navigator.serviceWorker.addEventListener('message', progressHandler);
            this._activeDownloadAttach = finishDownload;
            this._attachDownloadSkipHandler = null;

            if (allowSkip) {
                this._attachDownloadSkipHandler = () => {
                    if (skipRequested || finished) return;
                    skipRequested = true;
                    this.isUpdating = false;
                    cleanup();
                    if (typeof onSkip === 'function') {
                        onSkip();
                    }
                    resolve({ success: false, userChoice: 'skip', reason: 'User skipped' });
                };
            }

            const resolveIfFilesAlreadyCached = async (fileList) => {
                if (!fileList || fileList.length === 0) {
                    return false;
                }
                const stillPending = await this.getFilesNeedingUpdate(fileList);
                if (stillPending.length > 0) {
                    return false;
                }
                await finishDownload({
                    success: true,
                    filesDownloaded: fileList.length,
                    completed: fileList.length,
                    total: fileList.length,
                    hasErrors
                });
                return true;
            };

            const swState = await this.checkDownloadState();
            if (swState && swState.isDownloading) {
                console.log('Joining in-progress download:', `${swState.completed}/${swState.total}`);
                this.isUpdating = true;
                reportProgress(swState.completed || 0, swState.total || 0);
                resetStallTimer();
                return;
            }

            if (!files || files.length === 0) {
                cleanup();
                resolve({ success: true, filesDownloaded: 0, completed: 0, total: 0 });
                return;
            }

            if (await resolveIfFilesAlreadyCached(files)) {
                return;
            }

            if (allowSkip && typeof onSkip === 'function') {
                // Skip wired by caller (init modal)
            }

            this.swRegistration.active.postMessage({
                type: 'CACHE_STATIC_FILES',
                files
            });
            resetStallTimer();

            // Catch fast completions that finish before progress events propagate
            setTimeout(async () => {
                if (!finished) {
                    await resolveIfFilesAlreadyCached(files);
                }
            }, 250);
        });
    }

    _resetInstallWizardEtaState() {
        this._installWizardEtaState = {
            lastCompleted: 0,
            lastTime: Date.now(),
            lastRate: null,
            lastEtaText: '',
            stallSince: null
        };
    }

    _formatInstallWizardEta(remainingSeconds) {
        if (remainingSeconds == null || !isFinite(remainingSeconds) || remainingSeconds <= 0) {
            return '';
        }
        if (remainingSeconds < 60) {
            return '< 1 min remaining';
        }
        const mins = Math.round(remainingSeconds / 60);
        if (mins <= 1) {
            return '~1 min remaining';
        }
        return `~${mins} min remaining`;
    }

    _computeInstallWizardEta(completed, total) {
        if (!total || completed >= total) {
            return '';
        }

        const state = this._installWizardEtaState;
        if (!state) {
            return '';
        }

        const now = Date.now();
        if (completed <= state.lastCompleted) {
            if (!state.stallSince) {
                state.stallSince = now;
            }
            if (now - state.stallSince > 3000) {
                state.lastRate = null;
                state.lastEtaText = '';
            }
            return state.lastEtaText;
        }

        state.stallSince = null;
        const elapsedSec = (now - state.lastTime) / 1000;
        if (elapsedSec >= 0.5 && completed > state.lastCompleted) {
            const rate = (completed - state.lastCompleted) / elapsedSec;
            if (rate > 0) {
                const remainingSec = (total - completed) / rate;
                state.lastRate = rate;
                state.lastEtaText = this._formatInstallWizardEta(remainingSec);
            }
        }

        state.lastCompleted = completed;
        state.lastTime = now;
        return state.lastEtaText;
    }

    _buildInstallWizardStatus(phase, completed, total) {
        const phases = {
            prepare: {
                phase: 'Preparing installation…',
                detail: total > 0 ? `${total} files to download` : 'Checking for files to download…'
            },
            download: {
                phase: 'Downloading application files',
                detail: total > 0 ? `${completed} of ${total} files` : 'Starting download…'
            },
            verify: {
                phase: 'Verifying installation',
                detail: 'Checking cached files…'
            },
            stalled: {
                phase: 'Download paused',
                detail: total > 0 ? `Waiting to resume (${completed} of ${total} files)…` : 'Waiting to resume…'
            },
            finishing: {
                phase: 'Finishing installation',
                detail: 'Restarting Dreamscape OS…'
            }
        };

        const labels = phases[phase] || phases.download;
        const eta = phase === 'download' && total > 0
            ? this._computeInstallWizardEta(completed, total)
            : '';

        return { ...labels, eta };
    }

    _showInstallWizardUi(pendingCount) {
        this.installWizardUsed = true;
        this._resetInstallWizardEtaState();
        document.body.classList.add('dreamscape-install-wizard', 'initializing');
        this._writeInstallWizardSession({ phase: 'wizard', pendingCount });

        const status = this._buildInstallWizardStatus('prepare', 0, pendingCount);

        if (window.isDesktop) {
            const modal = document.getElementById('dreamscapeOsInstallWizardModal');
            const phaseEl = document.getElementById('dreamscapeOsInstallWizardPhase');
            const detailEl = document.getElementById('dreamscapeOsInstallWizardDetail');
            const etaEl = document.getElementById('dreamscapeOsInstallWizardEta');
            const progressBar = document.getElementById('dreamscapeOsInstallWizardProgressBar');
            if (modal && phaseEl && detailEl && progressBar) {
                phaseEl.textContent = status.phase;
                detailEl.textContent = status.detail;
                if (etaEl) {
                    etaEl.textContent = status.eta;
                }
                progressBar.style.width = '0%';
                modal.classList.remove('hidden');
                modal.classList.add('opening');
                if (typeof openModal === 'function') {
                    openModal(modal);
                }
            }
        } else if (typeof showGlassToast === 'function') {
            this.installWizardToastId = showGlassToast(
                'info',
                'Installing Dreamscape OS',
                `${status.phase} ${status.detail}`,
                true,
                false,
                '<i class="fa-duotone fa-star-christmas"></i>'
            );
        }
    }

    _updateInstallWizardUi(completed, total, phase = 'download') {
        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
        const status = this._buildInstallWizardStatus(phase, completed, total);
        const toastMessage = status.eta
            ? `${status.phase} — ${status.detail} (${status.eta})`
            : `${status.phase} — ${status.detail}`;

        const modal = document.getElementById('dreamscapeOsInstallWizardModal');
        const phaseEl = document.getElementById('dreamscapeOsInstallWizardPhase');
        const detailEl = document.getElementById('dreamscapeOsInstallWizardDetail');
        const etaEl = document.getElementById('dreamscapeOsInstallWizardEta');
        const progressBar = document.getElementById('dreamscapeOsInstallWizardProgressBar');
        if (modal && !modal.classList.contains('hidden') && phaseEl && detailEl && progressBar) {
            phaseEl.textContent = status.phase;
            detailEl.textContent = status.detail;
            if (etaEl) {
                etaEl.textContent = status.eta;
            }
            progressBar.style.width = `${progress}%`;
        } else if (this.installWizardToastId) {
            // updateGlassToastComplete / updateGlassToastProgress: public/scripts/comp/toastManager.js
            if (typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.installWizardToastId, {
                    type: 'info',
                    title: 'Installing Dreamscape OS',
                    message: toastMessage,
                    customIcon: '<i class="fa-duotone fa-star-christmas"></i>',
                    showProgress: true
                });
            }
            if (typeof updateGlassToastProgress === 'function') {
                updateGlassToastProgress(this.installWizardToastId, progress);
            }
        }
    }

    _hideInstallWizardUi() {
        document.body.classList.remove('dreamscape-install-wizard');
        this._installWizardEtaState = null;
        const modal = document.getElementById('dreamscapeOsInstallWizardModal');
        if (modal) {
            if (typeof closeModal === 'function') {
                closeModal(modal);
            } else {
                modal.classList.add('hidden');
                modal.classList.remove('opening');
                debouncedUpdateTaskbarWindows();
            }
        }
        if (this.installWizardToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.installWizardToastId);
            this.installWizardToastId = null;
        }
    }

    async _finishInstallWizardWithRestart() {
        this._updateInstallWizardUi(0, 0, 'finishing');
        this._clearInstallWizardSession();
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.forceRestart();
    }

    async _runInstallWizard(filesToUpdate) {
        this._showInstallWizardUi(filesToUpdate.length);
        this._updateInstallWizardUi(0, filesToUpdate.length, 'download');
        const result = await this.attachToDownloadProgress({
            files: filesToUpdate,
            onProgress: ({ completed, total }) => {
                this._updateInstallWizardUi(completed, total, 'download');
            }
        });
        if (result.stalled) {
            this._updateInstallWizardUi(
                result.completed || 0,
                result.total || 0,
                'stalled'
            );
            throw new Error(`Install wizard download stalled at ${result.completed}/${result.total}`);
        }
        if (!result.success && !result.hasErrors) {
            throw new Error(result.reason || 'Install wizard download failed');
        }
        this._updateInstallWizardUi(result.completed || filesToUpdate.length, result.total || filesToUpdate.length, 'verify');
        return result;
    }

    async runBootSequence() {
        if (this.bootComplete) {
            return;
        }
        // dismissLaunchHandoffIfNeeded: public/app.html — app boot UI (wizard, startup) must not sit under the handoff layer
        if (typeof dismissLaunchHandoffIfNeeded === 'function') {
            await dismissLaunchHandoffIfNeeded();
        }
        this._bootOrchestrating = true;
        let installWizardUsed = false;
        try {
            const resumeSession = this._readInstallWizardSession();
            if (resumeSession && resumeSession.active) {
                installWizardUsed = true;
                this.installWizardUsed = true;
                this.bootPhase = resumeSession.phase === 'verify' ? 'verify' : 'wizard';
            } else {
                this.bootPhase = 'waiting_sw';
            }

            await this.waitForServiceWorkerReady();
            this.bootPhase = 'checking';
            this._setPreStartupUpdateStageMessage('Checking for updates…');

            let verifyPass = 0;
            const MAX_VERIFY_PASSES = 5;
            let lastPendingFingerprint = '';

            while (true) {
                this.bootPhase = this.bootPhase === 'wizard' ? 'wizard' : 'checking';
                const manifest = await this._fetchManifest();
                let filesToUpdate = await this.getFilesNeedingUpdate(manifest);

                if (filesToUpdate.length === 0) {
                    break;
                }

                const pendingFingerprint = filesToUpdate.map((f) => `${f.url}:${f.hash}`).sort().join('|');
                if (pendingFingerprint === lastPendingFingerprint) {
                    verifyPass++;
                } else {
                    verifyPass = 1;
                    lastPendingFingerprint = pendingFingerprint;
                }
                if (verifyPass > MAX_VERIFY_PASSES) {
                    console.warn('Boot update verify exceeded max passes; continuing startup');
                    break;
                }

                if (filesToUpdate.length > WIZARD_FILE_THRESHOLD || installWizardUsed) {
                    installWizardUsed = true;
                    this.installWizardUsed = true;
                    this.bootPhase = 'wizard';
                    await this._runInstallWizard(filesToUpdate);
                    this.bootPhase = 'verify';
                    this._writeInstallWizardSession({ phase: 'verify', pendingCount: filesToUpdate.length });
                    this._updateInstallWizardUi(0, 0, 'verify');
                    continue;
                }

                await this.checkAndDownloadUpdatesForInit();
                this.bootPhase = 'verify';
            }

            if (installWizardUsed) {
                await this._finishInstallWizardWithRestart();
                return;
            }

            this._clearInstallWizardSession();
            this._hideInstallWizardUi();
            document.body.classList.remove('initializing');
            this._resolveBootComplete();
        } catch (error) {
            this._showBootFatalError(error);
            throw error;
        } finally {
            this._bootOrchestrating = false;
        }
    }

    async runLoginBootSequence() {
        if (this.loginBootComplete) {
            return;
        }
        this._loginBootOrchestrating = true;
        try {
            if (this._readLoginBootSession()?.active) {
                document.body.classList.add('login-booting');
            }

            await this.waitForServiceWorkerReady();

            while (true) {
                const manifest = await this._fetchManifest();
                const criticalManifest = this.filterLoginCriticalFiles(manifest);
                let filesToUpdate = await this.getFilesNeedingUpdate(criticalManifest);

                if (filesToUpdate.length === 0) {
                    break;
                }

                const loginPage = window.loginPage;
                if (loginPage && typeof loginPage.showProgressBar === 'function') {
                    loginPage.showProgressBar();
                    loginPage.updateProgressStatus(0, 'Preparing sign-in…');
                }

                await this.attachToDownloadProgress({
                    files: filesToUpdate,
                    onProgress: ({ completed, total, progress }) => {
                        if (loginPage && typeof loginPage.updateProgressStatus === 'function') {
                            loginPage.updateProgressStatus(
                                progress,
                                total > 0 ? `Preparing sign-in (${completed}/${total})…` : 'Preparing sign-in…'
                            );
                        }
                    }
                });

                // Verify pass on critical set only
            }

            this._clearLoginBootSession();
            if (window.loginPage && typeof window.loginPage.hideProgressBar === 'function') {
                window.loginPage.hideProgressBar();
            }
            this._resolveLoginBootComplete();
        } catch (error) {
            console.error('Login boot sequence failed:', error);
            this._resolveLoginBootComplete();
        } finally {
            this._loginBootOrchestrating = false;
        }
    }

    async checkLoginCriticalUpdates() {
        try {
            const manifest = await this._fetchManifest();
            const criticalFiles = this.filterLoginCriticalFiles(manifest);
            const filesToUpdate = await this.getFilesNeedingUpdate(criticalFiles);
            if (filesToUpdate.length === 0) {
                return { success: true, filesDownloaded: 0 };
            }
            return this.attachToDownloadProgress({ files: filesToUpdate });
        } catch (error) {
            console.error('Failed to check login critical updates:', error);
            return { success: false, error: error.message };
        }
    }

    showUpdateAvailableTrayPrompt(message) {
        if (!this._isDesktopTrayMode()) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('info', null, message || 'Updates are available.', false, 8000, '<i class="fas fa-download"></i>');
            }
            return;
        }
        this.trayPopup.dismissedUntilComplete = false;
        this._showServiceWorkerTrayPopup('available', { kind: 'sw-update', message: message || 'Resource updates are available.' });
    }
}

// Create global instance
window.serviceWorkerManager = new ServiceWorkerManager();
