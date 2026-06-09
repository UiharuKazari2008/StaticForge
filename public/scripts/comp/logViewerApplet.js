/**
 * Event Viewer applet — admin-only server log tail via HTTP + SSE.
 * public/scripts/comp/modalUtils.js (openModal, closeModal)
 * public/scripts/comp/confirmationDialog.js (showConfirmationDialog)
 * public/scripts/comp/dropdown.js (setupDropdown, renderGroupedDropdown)
 * public/scripts/comp/websocketRequestsModal.js (websocketRequestsModal)
 */

const LOG_VIEWER_MAX_LINES = 2500;
const LOG_VIEWER_TRIM_TO_LINES = 1500;
const LOG_VIEWER_TRIM_INTERVAL_MS = 15000;
const LOG_VIEWER_RECONNECT_DELAY_MS = 5000;
const LOG_VIEWER_RAM_BAR_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const LOG_VIEWER_CONN_STATS_INTERVAL_MS = 1000;
const LOG_VIEWER_TASKS_INTERVAL_MS = 2000;
const LOG_VIEWER_DISK_REFRESH_MS = 60000;
const LOG_VIEWER_STATUS_INTERVAL_KEY = 'eventViewerStatusInterval';

const STATUS_REFRESH_PRESETS = [
    { label: '1 second', ms: 1000 },
    { label: '2 seconds', ms: 2000 },
    { label: '3 seconds', ms: 3000 },
    { label: '5 seconds', ms: 5000 },
    { label: '10 seconds', ms: 10000 },
    { label: '30 seconds', ms: 30000 }
];

class LogViewerApplet {
    constructor() {
        this.modal = null;
        this.contentEl = null;
        this.mainLayout = null;
        this.sourceBtn = null;
        this.sourceSelected = null;
        this.backlogLines = 500;
        this.statusEl = null;
        this.modalTitleLabel = null;
        this.linesBtn = null;
        this.linesTextEl = null;
        this.liveBadgeEl = null;
        this.metricsEl = null;
        this.sysInfoEl = null;
        this.cpuFillEl = null;
        this.ramFillEl = null;
        this.cpuPctEl = null;
        this.ramPctEl = null;
        this.diskEl = null;
        this.uptimeBtn = null;
        this.statOutEl = null;
        this.statInEl = null;
        this.statOutArrow = null;
        this.statInArrow = null;
        this.statPingEl = null;
        this.statVarEl = null;
        this.settingsPopover = null;
        this.uptimePopover = null;
        this.connectionPopover = null;
        this.connStatsBtn = null;
        this.activeGlassPopover = null;
        this._lastStatOut = 0;
        this._lastStatIn = 0;
        this._trafficTimeouts = { up: null, down: null };
        this.pausedByMinimize = false;
        this.isLive = false;
        this._lastHidden = true;
        this._lastMinimised = false;
        this.reconnectBanner = null;
        this.reconnectTextEl = null;
        this.pauseBtn = null;
        this.scrollBottomBtn = null;
        this.scrollWrapper = null;
        this.tasksToggleBtn = null;
        this.tasksSidebar = null;
        this.abortController = null;
        this.byteOffset = 0;
        this.fileSize = 0;
        this.lineCount = 0;
        this.paused = false;
        this.tailFollow = true;
        this.tasksSidebarOpen = false;
        this.currentSource = 'pm2:combined';
        this.sources = [];
        this.sourceGroups = [];
        this.pm2Available = false;
        this.pm2Status = null;
        this.pm2StatusIntervalMs = 3000;
        this.popoverFlushBtn = null;
        this.popoverRebootBtn = null;
        this.popoverReloadBtn = null;
        this.restartBroomDefault = true;
        this.streamStatusText = 'Ready';
        this.streamGeneration = 0;
        this.reconnectTimer = null;
        this.reconnectCountdownTimer = null;
        this.trimInterval = null;
        this.connStatsInterval = null;
        this.tasksInterval = null;
        this.observer = null;
        this.observerTimeout = null;
        this._glassPopoverOutsideHandler = null;
        this._lastDiskUpdateAt = 0;
        this._cachedDiskFreeText = '';
    }

    init() {
        this.modal = document.getElementById('logViewerModal');
        if (!this.modal) return;

        const storedInterval = parseInt(localStorage.getItem(LOG_VIEWER_STATUS_INTERVAL_KEY), 10);
        if (STATUS_REFRESH_PRESETS.some((p) => p.ms === storedInterval)) {
            this.pm2StatusIntervalMs = storedInterval;
        }

        this.contentEl = document.getElementById('logViewerContent');
        this.mainLayout = document.getElementById('logViewerMainLayout');
        this.sourceBtn = document.getElementById('logViewerSourceDropdownBtn');
        this.sourceSelected = document.getElementById('logViewerSourceSelected');
        this.modalTitleLabel = document.getElementById('logViewerModalTitleLabel');
        this.statusEl = document.getElementById('logViewerStatus');
        this.linesBtn = document.getElementById('logViewerLinesBtn');
        this.linesTextEl = document.getElementById('logViewerLinesText');
        this.liveBadgeEl = document.getElementById('logViewerLiveBadge');
        this.metricsEl = document.getElementById('logViewerMetrics');
        this.sysInfoEl = document.getElementById('logViewerSysInfo');
        this.cpuFillEl = document.getElementById('logViewerCpuFill');
        this.ramFillEl = document.getElementById('logViewerRamFill');
        this.cpuPctEl = document.getElementById('logViewerCpuPct');
        this.ramPctEl = document.getElementById('logViewerRamPct');
        this.diskEl = document.getElementById('logViewerDisk');
        this.uptimeBtn = document.getElementById('logViewerUptimeBtn');
        this.statOutEl = document.getElementById('logViewerStatOut');
        this.statInEl = document.getElementById('logViewerStatIn');
        this.statOutArrow = document.getElementById('logViewerStatOutArrow');
        this.statInArrow = document.getElementById('logViewerStatInArrow');
        this.statPingEl = document.getElementById('logViewerStatPing');
        this.statVarEl = document.getElementById('logViewerStatVar');
        this.connStatsBtn = document.getElementById('logViewerConnStats');
        this.reconnectBanner = document.getElementById('logViewerReconnectBanner');
        this.reconnectTextEl = document.getElementById('logViewerReconnectText');
        this.pauseBtn = document.getElementById('logViewerPauseBtn');
        this.scrollBottomBtn = document.getElementById('logViewerScrollBottomBtn');
        this.scrollWrapper = this.modal.querySelector('.log-viewer-body-scroll');
        this.tasksToggleBtn = document.getElementById('logViewerTasksToggleBtn');
        this.tasksSidebar = document.getElementById('logViewerTasksSidebar');
        const closeBtn = document.getElementById('closeLogViewerBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        this.setupSourceClickMenu();
        this.setupGlassPopovers();

        if (this.linesBtn) {
            this.linesBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleGlassPopover('settings', this.linesBtn);
            });
        }
        if (this.uptimeBtn) {
            this.uptimeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleGlassPopover('uptime', this.uptimeBtn);
            });
        }
        if (this.connStatsBtn) {
            this.connStatsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleGlassPopover('connection', this.connStatsBtn);
            });
        }

        if (this.tasksToggleBtn) {
            this.tasksToggleBtn.addEventListener('click', () => this.toggleTasksSidebar());
        }

        if (this.pauseBtn) {
            this.pauseBtn.addEventListener('click', () => {
                if (this.paused) {
                    this.resume();
                } else {
                    this.pausedByMinimize = false;
                    this.pause();
                }
            });
        }

        if (this.scrollBottomBtn) {
            this.scrollBottomBtn.addEventListener('click', () => {
                this.tailFollow = true;
                this.scrollToBottom(true);
            });
        }

        const scrollEl = this.getScrollEl();
        if (scrollEl) {
            scrollEl.addEventListener('scroll', () => this.updateTailFollow());
        }

        this._lastHidden = this.modal.classList.contains('hidden');
        this._lastMinimised = this.modal.classList.contains('minimised');
        const checkModalState = () => {
            const isHidden = this.modal.classList.contains('hidden');
            const isMinimised = this.modal.classList.contains('minimised');

            if (isHidden && !this._lastHidden) {
                this.onWindowHidden();
            }
            if (!isMinimised && this._lastMinimised && !isHidden) {
                this.onRestoredFromMinimize();
            }
            if (isMinimised && !this._lastMinimised && !isHidden) {
                this.onMinimized();
            }

            this._lastHidden = isHidden;
            this._lastMinimised = isMinimised;
        };

        this.observer = new MutationObserver(() => {
            if (this.observerTimeout) cancelAnimationFrame(this.observerTimeout);
            this.observerTimeout = requestAnimationFrame(checkModalState);
        });
        this.observer.observe(this.modal, { attributes: true, attributeFilter: ['class'] });
    }

    clearLogCache() {
        if (this.contentEl) this.contentEl.textContent = '';
        this.lineCount = 0;
        this.byteOffset = 0;
        this.fileSize = 0;
        this.pm2Status = null;
        this.isLive = false;
        this.streamStatusText = 'Ready';
        this._lastStatOut = 0;
        this._lastStatIn = 0;
        this._lastDiskUpdateAt = 0;
        this._cachedDiskFreeText = '';
        this.updateStatusBar();
        this.updateTitleBar();
    }

    onWindowHidden() {
        this.hideAllGlassPopovers();
        this.stopStream(true);
        this.stopTrimInterval();
        this.stopConnStatsInterval();
        this.stopTasksInterval();
        this.cancelReconnect();
        this.clearTasksRenderTarget();
        this.clearLogCache();
        this.pausedByMinimize = false;
        this.paused = false;
        if (this.pauseBtn) {
            this.pauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            this.pauseBtn.title = 'Pause';
        }
    }

    onMinimized() {
        if (!this.paused) {
            this.pause();
            this.pausedByMinimize = true;
        }
    }

    onRestoredFromMinimize() {
        const shouldResume = this.pausedByMinimize;
        this.pausedByMinimize = false;
        if (shouldResume) {
            this.paused = false;
            if (this.pauseBtn) {
                this.pauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
                this.pauseBtn.title = 'Pause';
            }
            this.reload();
        } else if (!this.paused) {
            this.reload();
        }
    }

    setupGlassPopovers() {
        if (this.settingsPopover) return;

        const presetOptions = STATUS_REFRESH_PRESETS.map((p) =>
            `<option value="${p.ms}"${p.ms === this.pm2StatusIntervalMs ? ' selected' : ''}>${p.label}</option>`
        ).join('');

        this.settingsPopover = document.createElement('div');
        this.settingsPopover.className = 'log-viewer-glass-popover hidden';
        this.settingsPopover.innerHTML = `
            <div class="log-viewer-glass-popover-inner">
                <div class="log-viewer-glass-popover-header"><i class="fas fa-sliders"></i> View Settings</div>
                <div class="log-viewer-glass-popover-body">
                    <label class="log-viewer-settings-label">Backlog lines</label>
                    <input type="number" id="logViewerLinesPopoverInput" class="form-control hover-show colored"
                        value="${this.backlogLines}" min="50" max="5000" step="50">
                    <label class="log-viewer-settings-label">Status refresh</label>
                    <select id="logViewerStatusIntervalSelect" class="form-control hover-show colored">${presetOptions}</select>
                    <button type="button" id="logViewerSettingsApplyBtn" class="btn-primary btn-small">Apply</button>
                    <div class="log-viewer-glass-popover-actions">
                        <button type="button" id="logViewerPopoverReloadBtn" class="btn-secondary btn-small" title="Reload backlog">
                            <i class="fa-regular fa-sync"></i> Refresh Backlog
                        </button>
                        <button type="button" id="logViewerPopoverFlushBtn" class="btn-secondary btn-small hidden" title="Flush PM2 logs for this DreamScape Server process">
                            <i class="fas fa-broom"></i> Flush DSS Logs
                        </button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(this.settingsPopover);

        this.uptimePopover = document.createElement('div');
        this.uptimePopover.className = 'log-viewer-glass-popover log-viewer-uptime-glass-popover hidden';
        this.uptimePopover.innerHTML = `
            <div class="log-viewer-glass-popover-inner">
                <div class="log-viewer-glass-popover-header"><i class="fas fa-clock"></i> Uptime</div>
                <div class="log-viewer-glass-popover-body" id="logViewerUptimePopoverBody"></div>
                <div class="log-viewer-glass-popover-actions">
                    <button type="button" id="logViewerPopoverRebootBtn" class="btn-danger btn-small hidden" title="PM2 restart DreamScape Server (this process only)">
                        <i class="fas fa-rotate-right"></i> Restart DSS
                    </button>
                </div>
            </div>`;
        document.body.appendChild(this.uptimePopover);

        this.connectionPopover = document.createElement('div');
        this.connectionPopover.className = 'log-viewer-glass-popover log-viewer-connection-glass-popover hidden';
        this.connectionPopover.innerHTML = `
            <div class="log-viewer-glass-popover-inner">
                <div class="log-viewer-glass-popover-header"><i class="fas fa-network-wired"></i> Connection</div>
                <div class="log-viewer-glass-popover-body" id="logViewerConnectionPopoverBody"></div>
                <div class="log-viewer-glass-popover-actions">
                    <button type="button" id="logViewerConnToggleBtn" class="btn-primary btn-small">Connect</button>
                </div>
            </div>`;
        document.body.appendChild(this.connectionPopover);

        this.popoverReloadBtn = document.getElementById('logViewerPopoverReloadBtn');
        this.popoverFlushBtn = document.getElementById('logViewerPopoverFlushBtn');
        this.popoverRebootBtn = document.getElementById('logViewerPopoverRebootBtn');

        this.settingsPopover.querySelector('#logViewerSettingsApplyBtn')
            ?.addEventListener('click', () => this.applyViewSettings());
        this.popoverReloadBtn?.addEventListener('click', () => {
            this.hideAllGlassPopovers();
            this.reload();
        });
        this.popoverFlushBtn?.addEventListener('click', () => {
            this.hideAllGlassPopovers();
            this.requestFlushPm2Logs();
        });
        this.popoverRebootBtn?.addEventListener('click', () => {
            this.hideAllGlassPopovers();
            this.requestRestartServer();
        });
        document.getElementById('logViewerConnToggleBtn')
            ?.addEventListener('click', () => this.toggleWsConnection());

        if (!this._glassPopoverOutsideHandler) {
            this._glassPopoverOutsideHandler = (e) => {
                if (!this.activeGlassPopover) return;
                const pop = this.getGlassPopoverEl(this.activeGlassPopover);
                const anchor = this.getGlassPopoverAnchor(this.activeGlassPopover);
                if (pop?.contains(e.target) || anchor?.contains(e.target)) return;
                this.hideAllGlassPopovers();
            };
            document.addEventListener('click', this._glassPopoverOutsideHandler);
        }
    }

    getGlassPopoverEl(which) {
        if (which === 'settings') return this.settingsPopover;
        if (which === 'uptime') return this.uptimePopover;
        if (which === 'connection') return this.connectionPopover;
        return null;
    }

    getGlassPopoverAnchor(which) {
        if (which === 'settings') return this.linesBtn;
        if (which === 'uptime') return this.uptimeBtn;
        if (which === 'connection') return this.connStatsBtn;
        return null;
    }

    toggleGlassPopover(which, anchor) {
        if (this.activeGlassPopover === which) {
            this.hideAllGlassPopovers();
            return;
        }
        this.hideAllGlassPopovers();
        const pop = this.getGlassPopoverEl(which);
        if (!pop || !anchor) return;
        if (which === 'uptime') this.refreshUptimePopover();
        if (which === 'connection') this.refreshConnectionPopover();
        if (which === 'settings') {
            const linesInput = document.getElementById('logViewerLinesPopoverInput');
            const intervalSelect = document.getElementById('logViewerStatusIntervalSelect');
            if (linesInput) linesInput.value = String(this.backlogLines);
            if (intervalSelect) intervalSelect.value = String(this.pm2StatusIntervalMs);
        }
        this.activeGlassPopover = which;
        pop.classList.remove('hidden');
        requestAnimationFrame(() => {
            pop.classList.add('show');
            this.positionGlassPopover(pop, anchor);
        });
    }

    hideAllGlassPopovers() {
        [this.settingsPopover, this.uptimePopover, this.connectionPopover].forEach((pop) => {
            if (!pop) return;
            pop.classList.remove('show');
            pop.classList.add('hidden');
        });
        this.activeGlassPopover = null;
    }

    getWsClient() {
        return window.wsClient || null;
    }

    getWsStatusLabel() {
        const ws = this.getWsClient();
        if (!ws) return 'Unavailable';
        if (ws.isConnecting) return 'Connecting';
        if (ws.isConnected()) return 'Connected';
        return 'Disconnected';
    }

    getLogStreamStatusLabel() {
        if (this.paused) return 'Paused';
        if (this.isLive) return 'Live';
        if (this.reconnectTimer || this.reconnectCountdownTimer) return 'Reconnecting';
        if (this.abortController) return 'Connecting';
        return 'Idle';
    }

    getServerAddressLabel() {
        const host = window.location.hostname || '—';
        const port = window.location.port;
        return port ? `${host}:${port}` : host;
    }

    refreshConnectionPopover() {
        const body = document.getElementById('logViewerConnectionPopoverBody');
        const toggleBtn = document.getElementById('logViewerConnToggleBtn');
        if (!body) return;

        const ws = this.getWsClient();
        const wsLabel = this.getWsStatusLabel();
        const streamLabel = this.getLogStreamStatusLabel();
        const serverAddr = this.getServerAddressLabel();
        const encryption = window.location.protocol === 'https:' ? 'TLS (HTTPS)' : 'None (HTTP)';
        const wsProto = window.location.protocol === 'https:' ? 'WSS' : 'WS';

        let connUptime = '—';
        let outCount = '0';
        let inCount = '0';
        let ping = '—';
        let pingMin = '—';
        let pingMax = '—';
        let pingVar = '—';
        let username = '—';
        let connClass = { label: 'Measuring', tier: 'unknown' };

        if (ws) {
            outCount = String(ws.connectionStats?.messagesOut || 0);
            inCount = String(ws.connectionStats?.messagesIn || 0);
            if (ws.isConnected() && ws.connectionStats?.connectedAt) {
                connUptime = this.formatDurationMs(Date.now() - ws.connectionStats.connectedAt);
            }
            if (ws.isConnected() && ws.currentRtt != null) {
                ping = `${Math.round(ws.currentRtt / 10) * 10}ms`;
                connClass = this.getConnectionClass(ws.currentRtt);
            } else if (!ws.isConnected()) {
                connClass = { label: 'Offline', tier: 'offline' };
            }
            if (ws.minRtt != null) pingMin = `${Math.round(ws.minRtt)}ms`;
            if (ws.maxRtt != null) pingMax = `${Math.round(ws.maxRtt)}ms`;
            if (ws.isConnected() && ws.rttVariability != null && ws.currentRtt > 0) {
                pingVar = `${Math.round((ws.rttVariability / ws.currentRtt) * 100)}%`;
            }
            try {
                const raw = localStorage.getItem('userData');
                if (raw) {
                    const data = JSON.parse(raw);
                    username = data?.name || data?.username || username;
                }
            } catch (_) { /* ignore */ }
            if (username === '—') {
                const userType = localStorage.getItem('userType');
                if (userType === 'admin') username = 'Administrator';
                else if (userType) username = userType;
            }
        }

        body.innerHTML = `
            <div class="log-viewer-popover-section">
                <div class="log-viewer-popover-section-title">Status</div>
                <div class="log-viewer-uptime-row"><span>WebSocket</span><strong>${wsLabel}</strong></div>
                <div class="log-viewer-uptime-row"><span>Log stream</span><strong>${streamLabel}</strong></div>
                <div class="log-viewer-uptime-row"><span>Server</span><strong>${serverAddr}</strong></div>
                <div class="log-viewer-uptime-row"><span>Protocol</span><strong>${wsProto} / ${encryption}</strong></div>
            </div>
            <div class="log-viewer-popover-section">
                <div class="log-viewer-popover-section-title">Latency</div>
                <div class="log-viewer-uptime-row log-viewer-conn-class-row">
                    <span>Class</span>
                    <strong class="log-viewer-conn-class log-viewer-conn-class--${connClass.tier}">${connClass.label}</strong>
                </div>
                <div class="log-viewer-uptime-row"><span>Current ping</span><strong>${ping}</strong></div>
                <div class="log-viewer-uptime-row"><span>Min / Max</span><strong>${pingMin} / ${pingMax}</strong></div>
                <div class="log-viewer-uptime-row"><span>Variation</span><strong>${pingVar}</strong></div>
                <div class="log-viewer-uptime-row"><span>WS uptime</span><strong>${connUptime}</strong></div>
            </div>
            <div class="log-viewer-popover-section">
                <div class="log-viewer-popover-section-title">Traffic</div>
                <div class="log-viewer-uptime-row"><span>Sent</span><strong>${outCount}</strong></div>
                <div class="log-viewer-uptime-row"><span>Received</span><strong>${inCount}</strong></div>
                <div class="log-viewer-uptime-row"><span>User</span><strong>${username}</strong></div>
            </div>`;

        if (toggleBtn) {
            const connected = ws && (ws.isConnected() || ws.isConnecting);
            toggleBtn.textContent = connected ? 'Disconnect' : 'Connect';
            toggleBtn.classList.toggle('btn-danger', !!connected);
            toggleBtn.classList.toggle('btn-primary', !connected);
        }
    }

    toggleWsConnection() {
        const ws = this.getWsClient();
        if (!ws) return;
        this.hideAllGlassPopovers();
        if (ws.isConnected() || ws.isConnecting) {
            ws.disconnect(true);
        } else {
            ws.manualReconnect();
        }
        setTimeout(() => {
            if (this.activeGlassPopover === 'connection') this.refreshConnectionPopover();
        }, 400);
    }

    positionGlassPopover(pop, anchor) {
        const rect = anchor.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        let top = rect.top - popRect.height - 10;
        let left = rect.left + (rect.width / 2) - (popRect.width / 2);
        const pad = 8;
        left = Math.max(pad, Math.min(left, window.innerWidth - popRect.width - pad));
        top = Math.max(pad, Math.min(top, window.innerHeight - popRect.height - pad));
        pop.style.top = `${top}px`;
        pop.style.left = `${left}px`;
    }

    setupSourceClickMenu() {
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        if (!this.sourceBtn || !contextMenu) return;

        this.sourceClickMenuConfig = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 420,
            beforeShow: () => this.refreshSourceClickMenuItems(),
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-log-source' || !item.sourceId) return;
                if (item.sourceId !== this.currentSource) {
                    this.currentSource = item.sourceId;
                    this.updateSourceButtonLabel();
                    this.updateTitleBar();
                    this.reload();
                }
            }
        };
        contextMenu.attachClickMenuToElement(this.sourceBtn, this.sourceClickMenuConfig);
    }

    refreshSourceClickMenuItems() {
        if (!this.sourceClickMenuConfig) return;
        const groups = this.sourceGroups.length
            ? this.sourceGroups.map((g) => ({
                header: g.header,
                options: g.sources.map((s) => ({ value: s.id, label: s.label }))
            }))
            : [{
                header: 'Logs',
                options: this.sources.map((s) => ({ value: s.id, label: s.label }))
            }];

        const items = [];
        groups.forEach((group) => {
            if (group.header) {
                items.push({ separator: true, text: group.header });
            }
            group.options.forEach((opt) => {
                items.push({
                    text: opt.label,
                    action: 'select-log-source',
                    sourceId: opt.value,
                    loadfn: (item) => {
                        item.highlighted = item.sourceId === this.currentSource;
                    }
                });
            });
        });
        if (!items.length) {
            items.push({ text: 'No sources', disabled: true });
        }
        this.sourceClickMenuConfig.sections[0].items = items;
    }

    applyViewSettings() {
        const linesInput = document.getElementById('logViewerLinesPopoverInput');
        const intervalSelect = document.getElementById('logViewerStatusIntervalSelect');
        const lines = parseInt(linesInput?.value, 10);
        const interval = parseInt(intervalSelect?.value, 10);
        if (lines >= 50 && lines <= 5000) {
            this.backlogLines = lines;
        }
        if (STATUS_REFRESH_PRESETS.some((p) => p.ms === interval)) {
            this.pm2StatusIntervalMs = interval;
            localStorage.setItem(LOG_VIEWER_STATUS_INTERVAL_KEY, String(interval));
        }
        this.hideAllGlassPopovers();
        const wasStreaming = !this.paused && this.abortController;
        if (wasStreaming) {
            this.startStream();
        } else {
            this.reload();
        }
    }

    refreshUptimePopover() {
        const body = document.getElementById('logViewerUptimePopoverBody');
        if (!body) return;
        const s = this.pm2Status || {};
        const connMs = this.getConnectionUptimeMs();
        const appMs = s.applicationUptimeMs;
        const hostMs = s.hostUptimeMs ?? s.serverUptimeMs;
        const pid = s.pid;
        const pm2Id = s.pm2Id;
        const processName = s.processName || 'Dreamscape';
        const restarts = s.restarts ?? 0;
        const cpuPct = typeof s.hostCpuPercent === 'number' ? s.hostCpuPercent : 0;
        const ramPct = typeof s.hostRamPercent === 'number' ? s.hostRamPercent : 0;
        const diskPct = typeof s.diskUsedPercent === 'number' ? s.diskUsedPercent : 0;
        const load = s.loadAverage || {};
        const loadText = [load.one, load.five, load.fifteen].every((v) => typeof v === 'number')
            ? `${load.one.toFixed(2)} / ${load.five.toFixed(2)} / ${load.fifteen.toFixed(2)}`
            : '—';

        body.innerHTML = `
            <div class="log-viewer-popover-section">
                <div class="log-viewer-popover-section-title">Uptime</div>
                <div class="log-viewer-uptime-row"><span>Connection</span><strong>${this.formatDurationMs(connMs)}</strong></div>
                <div class="log-viewer-uptime-row"><span>Application</span><strong>${this.formatDurationMs(appMs)}</strong></div>
                <div class="log-viewer-uptime-row"><span>Host</span><strong>${this.formatDurationMs(hostMs)}</strong></div>
            </div>
            <div class="log-viewer-popover-section">
                <div class="log-viewer-popover-section-title">System</div>
                ${this.renderPopoverMetricRow('CPU', cpuPct)}
                ${this.renderPopoverMetricRow('RAM', ramPct)}
                ${this.renderPopoverMetricRow('Disk', diskPct)}
                <div class="log-viewer-uptime-row"><span>Load avg</span><strong>${loadText}</strong></div>
            </div>
            <div class="log-viewer-popover-section">
                <div class="log-viewer-popover-section-title">Process</div>
                <div class="log-viewer-uptime-row"><span>DSS</span><strong>${processName}</strong></div>
                <div class="log-viewer-uptime-row"><span>PM2 id</span><strong>${pm2Id != null ? pm2Id : '—'}</strong></div>
                <div class="log-viewer-uptime-row"><span>PID</span><strong>${pid != null ? pid : '—'}</strong></div>
                <div class="log-viewer-uptime-row"><span>Restarts</span><strong>${restarts}</strong></div>
            </div>`;
    }

    renderPopoverMetricRow(label, percent) {
        const clamped = Math.max(0, Math.min(100, percent));
        let fillClass = '';
        if (clamped >= 85) fillClass = ' log-viewer-metric-danger';
        else if (clamped >= 60) fillClass = ' log-viewer-metric-warn';
        return `
            <div class="log-viewer-popover-metric">
                <span class="log-viewer-popover-metric-label">${label}</span>
                <div class="log-viewer-popover-metric-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100">
                    <div class="log-viewer-popover-metric-fill${fillClass}" style="width:${clamped}%"></div>
                </div>
                <span class="log-viewer-popover-metric-pct">${clamped.toFixed(1)}%</span>
            </div>`;
    }

    formatDiskFreeGb(bytes) {
        if (bytes == null || bytes < 0) return '—';
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    updateDiskDisplay(status) {
        if (!this.diskEl || !status) return;
        const now = Date.now();
        if (now - this._lastDiskUpdateAt < LOG_VIEWER_DISK_REFRESH_MS && this._cachedDiskFreeText) {
            this.diskEl.textContent = this._cachedDiskFreeText;
            return;
        }
        const freeBytes = status.diskFreeBytes;
        if (freeBytes == null) return;
        this._lastDiskUpdateAt = now;
        this._cachedDiskFreeText = this.formatDiskFreeGb(freeBytes);
        this.diskEl.textContent = this._cachedDiskFreeText;
        this.diskEl.title = 'Host filesystem free space';
    }

    getSourceTitleLabel(sourceId) {
        const meta = this.getSourceMeta(sourceId || this.currentSource);
        return meta?.label || 'Logs';
    }

    updateTitleBar() {
        if (!this.modalTitleLabel) return;
        const name = this.getSourceTitleLabel(this.currentSource);
        const pausedSuffix = this.paused ? ' [PAUSED]' : '';
        this.modalTitleLabel.textContent = `Event Viewer - ${name}${pausedSuffix}`;
    }

    updateLiveBadge() {
        if (!this.liveBadgeEl) return;
        this.liveBadgeEl.classList.remove(
            'log-viewer-live-badge--live',
            'log-viewer-live-badge--paused',
            'hidden'
        );
        if (this.paused) {
            this.liveBadgeEl.textContent = 'Paused';
            this.liveBadgeEl.classList.add('log-viewer-live-badge--paused');
            this.liveBadgeEl.removeAttribute('aria-hidden');
        } else if (this.isLive) {
            this.liveBadgeEl.textContent = 'Live';
            this.liveBadgeEl.classList.add('log-viewer-live-badge--live');
            this.liveBadgeEl.removeAttribute('aria-hidden');
        } else {
            this.liveBadgeEl.textContent = '';
            this.liveBadgeEl.classList.add('hidden');
            this.liveBadgeEl.setAttribute('aria-hidden', 'true');
        }
    }

    flashTrafficArrow(direction) {
        if (!this.modal || this.modal.classList.contains('hidden')
            || this.modal.classList.contains('hidden-alt')
            || this.modal.classList.contains('minimised')) {
            return;
        }
        const arrow = direction === 'up' ? this.statOutArrow : this.statInArrow;
        if (!arrow) return;
        const key = direction === 'up' ? 'up' : 'down';
        if (this._trafficTimeouts[key]) {
            clearTimeout(this._trafficTimeouts[key]);
        } else {
            arrow.classList.add('active');
        }
        this._trafficTimeouts[key] = setTimeout(() => {
            arrow.classList.remove('active');
            this._trafficTimeouts[key] = null;
        }, 300);
    }

    getConnectionUptimeMs() {
        const ws = window.wsClient;
        if (!ws || !ws.isConnected() || !ws.connectionStats?.connectedAt) return null;
        return Date.now() - ws.connectionStats.connectedAt;
    }

    formatDurationMs(ms) {
        if (ms == null || ms < 0) return '—';
        const s = Math.floor(ms / 1000);
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (s >= 48 * 3600) {
            return `${d}d ${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        }
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        return `${m}:${String(sec).padStart(2, '0')}`;
    }

    formatRelativeUptime(ms) {
        if (ms == null || ms < 0) return '—';
        const totalHours = ms / 3600000;
        if (totalHours >= 48) {
            return `${Math.floor(ms / 86400000)}d`;
        }
        if (totalHours >= 1) {
            return `${totalHours.toFixed(1)}m`;
        }
        return `${Math.max(1, Math.floor(ms / 60000))}m`;
    }

    getConnectionClass(rtt) {
        if (rtt == null || rtt < 0) return { label: 'Measuring', tier: 'unknown' };
        if (rtt < 50) return { label: 'Lightspeed', tier: 'lightspeed' };
        if (rtt < 120) return { label: 'High Speed', tier: 'high-speed' };
        if (rtt < 250) return { label: 'Standard', tier: 'standard' };
        if (rtt < 500) return { label: 'High RTT', tier: 'high-rtt' };
        return { label: 'Slow Link', tier: 'slow' };
    }

    getPm2ProcessLabel() {
        const name = this.pm2Status?.processName || 'Dreamscape';
        const id = this.pm2Status?.pm2Id;
        return id != null ? `${name} (id ${id})` : name;
    }

    toggleTasksSidebar(forceOpen) {
        this.tasksSidebarOpen = forceOpen === true ? true : (forceOpen === false ? false : !this.tasksSidebarOpen);
        if (this.mainLayout) {
            this.mainLayout.classList.toggle('tasks-open', this.tasksSidebarOpen);
        }
        if (this.tasksSidebar) {
            this.tasksSidebar.classList.toggle('hidden', !this.tasksSidebarOpen);
        }
        if (this.tasksToggleBtn) {
            this.tasksToggleBtn.dataset.state = this.tasksSidebarOpen ? 'on' : 'off';
        }
        if (this.tasksSidebarOpen) {
            this.bindTasksRenderTarget();
            this.startTasksInterval();
            if (typeof websocketRequestsModal !== 'undefined' && websocketRequestsModal) {
                websocketRequestsModal.update(true);
            }
            if (typeof customScrollbar !== 'undefined' && customScrollbar.forceReinit && this.tasksSidebar) {
                this.tasksSidebar.querySelectorAll('[data-custom-scrollbar]').forEach((el) => customScrollbar.forceReinit(el));
            }
        } else {
            this.stopTasksInterval();
            this.clearTasksRenderTarget();
        }
    }

    bindTasksRenderTarget() {
        if (typeof websocketRequestsModal === 'undefined' || !websocketRequestsModal) return;
        websocketRequestsModal.setRenderTarget({
            activeList: document.getElementById('logViewerActiveRequestsList'),
            previousList: document.getElementById('logViewerPreviousRequestsList'),
            previousCount: document.getElementById('logViewerPreviousRequestsCount'),
            activeEmpty: document.getElementById('logViewerActiveRequestsEmpty'),
            previousEmpty: document.getElementById('logViewerPreviousRequestsEmpty')
        });
    }

    clearTasksRenderTarget() {
        if (typeof websocketRequestsModal !== 'undefined' && websocketRequestsModal) {
            websocketRequestsModal.clearRenderTarget();
        }
    }

    startTasksInterval() {
        this.stopTasksInterval();
        this.tasksInterval = setInterval(() => {
            if (!this.tasksSidebarOpen || this.modal?.classList.contains('hidden')
                || this.modal?.classList.contains('minimised')) return;
            if (typeof websocketRequestsModal !== 'undefined' && websocketRequestsModal) {
                websocketRequestsModal.update(true);
            }
        }, LOG_VIEWER_TASKS_INTERVAL_MS);
    }

    stopTasksInterval() {
        if (this.tasksInterval) {
            clearInterval(this.tasksInterval);
            this.tasksInterval = null;
        }
    }

    startConnStatsInterval() {
        this.stopConnStatsInterval();
        this.updateConnectionStats();
        this.connStatsInterval = setInterval(() => this.updateConnectionStats(), LOG_VIEWER_CONN_STATS_INTERVAL_MS);
    }

    stopConnStatsInterval() {
        if (this.connStatsInterval) {
            clearInterval(this.connStatsInterval);
            this.connStatsInterval = null;
        }
    }

    updateConnectionStats() {
        const ws = window.wsClient;
        if (!ws) {
            if (this.statOutEl) this.statOutEl.textContent = '0';
            if (this.statInEl) this.statInEl.textContent = '0';
            if (this.statPingEl) this.statPingEl.textContent = '—';
            if (this.statVarEl) this.statVarEl.textContent = '—';
            return;
        }
        const outCount = ws.connectionStats?.messagesOut || 0;
        const inCount = ws.connectionStats?.messagesIn || 0;
        if (this.statOutEl) this.statOutEl.textContent = String(outCount);
        if (this.statInEl) this.statInEl.textContent = String(inCount);
        if (outCount > this._lastStatOut) this.flashTrafficArrow('up');
        if (inCount > this._lastStatIn) this.flashTrafficArrow('down');
        this._lastStatOut = outCount;
        this._lastStatIn = inCount;
        if (this.statPingEl) {
            if (ws.isConnected() && ws.currentRtt != null) {
                this.statPingEl.textContent = `${Math.round(ws.currentRtt / 10) * 10}ms`;
            } else {
                this.statPingEl.textContent = '—';
            }
        }
        if (this.statVarEl) {
            if (ws.isConnected() && ws.rttVariability != null && ws.currentRtt > 0) {
                this.statVarEl.textContent = `${Math.round((ws.rttVariability / ws.currentRtt) * 100)}%`;
            } else {
                this.statVarEl.textContent = '—';
            }
        }
        if (this.activeGlassPopover === 'uptime') {
            this.refreshUptimePopover();
        }
        if (this.activeGlassPopover === 'connection') {
            this.refreshConnectionPopover();
        }
    }

    isCombinedSource(source) {
        return source === 'pm2:combined';
    }

    isTendaiSource(source) {
        return source === 'generation' || (source && source.startsWith('generation:'));
    }

    getSourceMeta(sourceId) {
        return this.sources.find((s) => s.id === sourceId) || null;
    }

    getSourceButtonLabel(sourceId) {
        const id = sourceId || this.currentSource;
        const meta = this.getSourceMeta(id);
        if (!meta) return 'Logs';
        if (meta.group === 'tendai' || this.isTendaiSource(id)) return 'Tendai Logs';
        return meta.label;
    }

    updateSourceButtonLabel() {
        if (this.sourceSelected) {
            this.sourceSelected.textContent = this.getSourceButtonLabel(this.currentSource);
        }
    }

    getBasePath() {
        const uuid = localStorage.getItem('logViewerPathUuid');
        if (!uuid) return null;
        return `/${uuid}`;
    }

    async ensureLogViewerPath() {
        if (this.getBasePath()) return true;
        try {
            const response = await fetch('/app', {
                method: 'OPTIONS',
                credentials: 'same-origin',
                cache: 'no-store'
            });
            if (!response.ok) return false;
            const data = await response.json();
            if (data.logViewerPathUuid) {
                localStorage.setItem('logViewerPathUuid', data.logViewerPathUuid);
                return true;
            }
        } catch (_) { /* ignore */ }
        return false;
    }

    getScrollEl() {
        if (!this.modal) return null;
        return this.scrollWrapper?.querySelector('.scrollable-content') || this.scrollWrapper;
    }

    applyDefaultWindowSize() {
        if (!this.modal) return;
        // public/scripts/comp/modalUtils.js
        applyModalDefaultWindowSize(this.modal);
    }

    serializeOffset() {
        if (this.isCombinedSource(this.currentSource)) {
            const off = this.byteOffset && typeof this.byteOffset === 'object'
                ? this.byteOffset
                : { out: 0, err: 0 };
            return encodeURIComponent(JSON.stringify(off));
        }
        return String(Number(this.byteOffset) || 0);
    }

    applyNextOffset(nextOffset) {
        if (this.isCombinedSource(this.currentSource)) {
            if (nextOffset && typeof nextOffset === 'object') {
                this.byteOffset = { out: Number(nextOffset.out) || 0, err: Number(nextOffset.err) || 0 };
            }
            return;
        }
        if (typeof nextOffset === 'number') {
            this.byteOffset = nextOffset;
        }
    }

    setStatus(text) {
        this.streamStatusText = text;
        this.updateStatusBar();
    }

    updatePm2ControlsVisibility() {
        const show = this.pm2Available;
        if (this.popoverFlushBtn) this.popoverFlushBtn.classList.toggle('hidden', !show);
        if (this.popoverRebootBtn) this.popoverRebootBtn.classList.toggle('hidden', !show);
        if (this.metricsEl) this.metricsEl.classList.toggle('hidden', !show);
        if (this.sysInfoEl) this.sysInfoEl.classList.toggle('hidden', !show);
    }

    updateMetricBar(fillEl, pctEl, percent) {
        const clamped = Math.max(0, Math.min(100, percent));
        if (fillEl) {
            fillEl.style.width = `${clamped}%`;
            fillEl.classList.remove('log-viewer-metric-warn', 'log-viewer-metric-danger');
            if (clamped >= 85) fillEl.classList.add('log-viewer-metric-danger');
            else if (clamped >= 60) fillEl.classList.add('log-viewer-metric-warn');
        }
        if (pctEl) pctEl.textContent = `${clamped.toFixed(1)}%`;
    }

    updateStatusBar() {
        if (this.linesTextEl) {
            this.linesTextEl.textContent = this.streamStatusText;
        }
        if (this.linesBtn) {
            this.linesBtn.title = 'View settings — click to change backlog lines and status refresh';
        }
        this.updateLiveBadge();
        this.updateTitleBar();
    }

    applyPm2Status(status) {
        if (!status) return;
        this.pm2Status = status;
        const cpu = typeof status.cpu === 'number' ? status.cpu : 0;
        const memory = typeof status.memory === 'number' ? status.memory : 0;
        const ramPct = (memory / LOG_VIEWER_RAM_BAR_MAX_BYTES) * 100;
        this.updateMetricBar(this.cpuFillEl, this.cpuPctEl, cpu);
        this.updateMetricBar(this.ramFillEl, this.ramPctEl, ramPct);

        this.updateDiskDisplay(status);
        if (this.uptimeBtn) {
            const appMs = status.applicationUptimeMs;
            this.uptimeBtn.textContent = appMs != null ? this.formatRelativeUptime(appMs) : '—';
            this.uptimeBtn.title = 'Application uptime and system metrics';
        }
        if (this.popoverFlushBtn) {
            this.popoverFlushBtn.title = `Flush PM2 logs for ${this.getPm2ProcessLabel()}`;
        }
        if (this.popoverRebootBtn) {
            this.popoverRebootBtn.title = `PM2 restart ${this.getPm2ProcessLabel()} (DreamScape Server)`;
        }
        if (this.activeGlassPopover === 'uptime') {
            this.refreshUptimePopover();
        }
        if (this.activeGlassPopover === 'connection') {
            this.refreshConnectionPopover();
        }
    }

    appendLogContent(chunk) {
        if (!this.contentEl || !chunk) return;
        const existing = this.contentEl.textContent;
        let text = chunk;
        if (existing.endsWith('\n') && text.startsWith('\n')) {
            text = text.replace(/^\n+/, '');
        }
        this.contentEl.textContent = existing + text;
        this.lineCount += (text.match(/\n/g) || []).length;
        this.trimLogLinesIfNeeded();
        if (this.tailFollow) this.scrollToBottom(true);
    }

    trimLogLinesIfNeeded() {
        if (!this.contentEl || this.lineCount <= LOG_VIEWER_MAX_LINES) return;
        const lines = this.contentEl.textContent.split('\n');
        if (lines.length <= LOG_VIEWER_TRIM_TO_LINES) {
            this.lineCount = lines.length;
            return;
        }
        const trimmed = lines.slice(-LOG_VIEWER_TRIM_TO_LINES);
        this.contentEl.textContent = trimmed.join('\n');
        this.lineCount = trimmed.length;
    }

    startTrimInterval() {
        this.stopTrimInterval();
        this.trimInterval = setInterval(() => this.trimLogLinesIfNeeded(), LOG_VIEWER_TRIM_INTERVAL_MS);
    }

    stopTrimInterval() {
        if (this.trimInterval) {
            clearInterval(this.trimInterval);
            this.trimInterval = null;
        }
    }

    showReconnectBanner(seconds) {
        if (!this.reconnectBanner || !this.reconnectTextEl) return;
        this.reconnectBanner.classList.remove('hidden');
        this.reconnectTextEl.textContent = `Stream disconnected — reconnecting in ${seconds}s`;
    }

    hideReconnectBanner() {
        if (this.reconnectBanner) this.reconnectBanner.classList.add('hidden');
    }

    cancelReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.reconnectCountdownTimer) {
            clearInterval(this.reconnectCountdownTimer);
            this.reconnectCountdownTimer = null;
        }
        this.hideReconnectBanner();
    }

    scheduleReconnect() {
        if (this.paused || this.modal?.classList.contains('hidden')
            || this.modal?.classList.contains('minimised')) return;
        this.cancelReconnect();

        let remaining = Math.ceil(LOG_VIEWER_RECONNECT_DELAY_MS / 1000);
        this.showReconnectBanner(remaining);
        this.setStatus(`Reconnecting in ${remaining}s — ${this.formatStatusMeta()}`);

        this.reconnectCountdownTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(this.reconnectCountdownTimer);
                this.reconnectCountdownTimer = null;
                return;
            }
            this.showReconnectBanner(remaining);
            this.setStatus(`Reconnecting in ${remaining}s — ${this.formatStatusMeta()}`);
        }, 1000);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.hideReconnectBanner();
            if (!this.paused && !this.modal?.classList.contains('hidden')
                && !this.modal?.classList.contains('minimised')) {
                this.startStream(true);
            }
        }, LOG_VIEWER_RECONNECT_DELAY_MS);
    }

    wireRestartBroomToggleInDialog() {
        const toggle = document.querySelector('#confirmationDialog .log-viewer-restart-broom-toggle');
        if (!toggle || toggle.dataset.wired === '1') return;
        toggle.dataset.wired = '1';
        toggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const on = toggle.getAttribute('data-state') === 'on';
            toggle.setAttribute('data-state', on ? 'off' : 'on');
        });
    }

    async postPm2Action(path, body = {}) {
        const base = this.getBasePath();
        if (!base) throw new Error('Log path unavailable');
        const response = await fetch(`${base}${path}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'PM2 action failed');
        }
        return data;
    }

    async requestFlushPm2Logs() {
        const procLabel = this.getPm2ProcessLabel();
        const confirmed = await showConfirmationDialog(
            `Clear PM2 log files for DreamScape Server (${procLabel})? Only this process is affected. The log view will reset.`,
            [
                { text: 'Flush DSS Logs', value: true, icon: 'fas fa-broom', className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ],
            null,
            { title: 'Flush DSS Logs', icon: 'fas fa-broom' }
        );
        if (!confirmed) return;

        try {
            await this.postPm2Action('/pm2/flush');
            showGlassToast('success', 'System', 'Log files flushed', false, 3000, '<i class="fas fa-broom"></i>');
            await this.reload();
        } catch (error) {
            showGlassToast('error', 'System', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }

    async requestRestartServer() {
        const procLabel = this.getPm2ProcessLabel();
        const broomState = this.restartBroomDefault ? 'on' : 'off';
        const dialogPromise = showConfirmationDialog(
            `Restart DreamScape Server via PM2 (${procLabel})? Pending work will be flushed, databases saved, and connections will drop until the server is back online.
            <div class="log-viewer-restart-broom-row">
                <button type="button" class="btn-secondary btn-small toggle-btn log-viewer-restart-broom-toggle" data-state="${broomState}" title="Flush PM2 logs before restart" aria-label="Flush PM2 logs before restart">
                    <i class="fas fa-broom"></i>
                </button>
                <span class="log-viewer-restart-broom-hint">Flush logs before restart</span>
            </div>`,
            [
                { text: 'Restart DSS', value: true, icon: 'fas fa-rotate-right', className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ],
            null,
            {
                title: 'Restart DSS',
                icon: 'fas fa-rotate-right',
                resolveValue: (value, dialog) => {
                    if (!value) return false;
                    const toggle = dialog?.querySelector('.log-viewer-restart-broom-toggle');
                    const broom = toggle ? toggle.getAttribute('data-state') !== 'off' : true;
                    return { confirmed: true, broom };
                }
            }
        );
        setTimeout(() => this.wireRestartBroomToggleInDialog(), 0);
        const confirmed = await dialogPromise;
        if (!confirmed || confirmed === false) return;

        const broom = typeof confirmed === 'object' ? confirmed.broom !== false : true;
        this.restartBroomDefault = broom;

        try {
            this.cancelReconnect();
            this.stopStream();
            suppressWebSocketReconnectForReload();
            this.setStatus('Preparing DSS restart…');
            await this.postPm2Action('/pm2/restart', { broom });
            this.setStatus('DSS restarting — waiting for disconnect…');

            // waitForServerDisconnect, runClientShutdownSequence — modalUtils.js
            const disconnected = typeof waitForServerDisconnect === 'function'
                ? await waitForServerDisconnect({ timeoutMs: 120000 })
                : false;

            if (!disconnected) {
                showGlassToast('error', 'DreamScape Server', 'Server did not disconnect in time — reload manually when ready', false, 10000, '<i class="fas fa-exclamation-triangle"></i>');
                this.setStatus('DSS restart timed out — server may still be shutting down');
                return;
            }

            this.setStatus('Server disconnected — restarting application…');
            if (typeof runClientShutdownSequence === 'function') {
                await runClientShutdownSequence(() => location.reload());
            } else if (typeof bypassConfirmation !== 'undefined') {
                bypassConfirmation = true;
                location.reload();
            } else {
                location.reload();
            }
        } catch (error) {
            showGlassToast('error', 'System', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            if (!this.paused) this.startStream();
        }
    }

    updateTailFollow() {
        const scrollEl = this.getScrollEl();
        if (!scrollEl) return;
        const threshold = 40;
        const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < threshold;
        this.tailFollow = atBottom;
    }

    scrollToBottom(force) {
        const host = this.scrollWrapper;
        const scrollEl = this.getScrollEl();
        if (!scrollEl) return;
        if (force) this.tailFollow = true;
        const apply = () => {
            scrollEl.scrollTop = scrollEl.scrollHeight;
            if (host && typeof customScrollbar !== 'undefined' && customScrollbar.updateScrollbar) {
                customScrollbar.updateScrollbar(host);
            }
        };
        apply();
        requestAnimationFrame(() => {
            apply();
            requestAnimationFrame(apply);
        });
        setTimeout(apply, 0);
        setTimeout(apply, 100);
        setTimeout(apply, 300);
    }

    async open(options = {}) {
        if (!this.modal) return;

        const userType = localStorage.getItem('userType');
        if (userType !== 'admin') {
            showGlassToast('error', 'Access Denied', 'Admin access required for Event Viewer', false, 5000, '<i class="fas fa-lock"></i>');
            return;
        }

        if (!(await this.ensureLogViewerPath())) {
            showGlassToast('error', 'Event Viewer', 'Log path unavailable — please log in again as admin', false, 5000, '<i class="fas fa-scroll"></i>');
            return;
        }

        const alreadyOpen = !this.modal.classList.contains('hidden');
        this.applyDefaultWindowSize();
        this.setupGlassPopovers();

        if (!alreadyOpen) {
            openModal(this.modal);
            await this.loadSources();
            this.updatePm2ControlsVisibility();
            this.updateSourceButtonLabel();
            this.updateTitleBar();
            this.startTrimInterval();
            await this.reload();
        }

        this.startConnStatsInterval();
        if (options.showTasksSidebar) {
            this.toggleTasksSidebar(true);
        }

        if (typeof customScrollbar !== 'undefined' && customScrollbar.forceReinit) {
            customScrollbar.forceReinit(this.scrollWrapper);
        }

        const ws = this.getWsClient();
        if (ws?.setupRequestsModalHandlers) {
            ws.setupRequestsModalHandlers();
        }
        if (ws?.updateWebSocketStatus) {
            const status = ws.isConnected() ? 'connected' : ws.isConnecting ? 'connecting' : 'disconnected';
            ws.updateWebSocketStatus(status);
        }
    }

    close() {
        this.hideAllGlassPopovers();
        if (this.modal) closeModal(this.modal);
    }

    stopStream(intentional) {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (intentional) this.cancelReconnect();
    }

    pause() {
        this.paused = true;
        this.isLive = false;
        this.stopStream(true);
        if (this.pauseBtn) {
            this.pauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            this.pauseBtn.title = 'Resume';
        }
        this.setStatus(this.formatStatusMeta());
    }

    async resume() {
        this.pausedByMinimize = false;
        this.paused = false;
        if (this.pauseBtn) {
            this.pauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            this.pauseBtn.title = 'Pause';
        }
        this.tailFollow = true;
        await this.reload();
    }

    formatStatusMeta() {
        return `${this.lineCount}L`;
    }

    async loadSources() {
        const base = this.getBasePath();
        if (!base) return;

        try {
            this.abortController = new AbortController();
            const response = await fetch(`${base}/sources`, {
                credentials: 'same-origin',
                signal: this.abortController.signal
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to load sources');
            }
            this.sources = data.sources || [];
            this.sourceGroups = data.groups || [];
            this.pm2Available = data.pm2Available === true
                || this.sources.some((s) => s.id && s.id.startsWith('pm2:'));
            this.updatePm2ControlsVisibility();
            if (!this.sources.some((s) => s.id === this.currentSource)) {
                const preferred = this.sources.find((s) => s.id === 'pm2:combined')
                    || this.sources.find((s) => s.id === 'pm2:out')
                    || this.sources.find((s) => s.id === 'server')
                    || this.sources[0];
                this.currentSource = preferred?.id || 'server';
            }
            this.updateSourceButtonLabel();
        } catch (error) {
            if (error.name !== 'AbortError') {
                this.setStatus(`Error: ${error.message}`);
            }
        }
    }

    async reload() {
        if (this.modal?.classList.contains('minimised')) return;
        this.cancelReconnect();
        this.stopStream(true);
        this.isLive = false;
        this.tailFollow = true;
        if (this.contentEl) this.contentEl.textContent = '';
        this.lineCount = 0;
        this.byteOffset = this.isCombinedSource(this.currentSource) ? { out: 0, err: 0 } : 0;
        this.fileSize = 0;

        const lines = this.backlogLines;
        const base = this.getBasePath();
        if (!base) return;

        this.setStatus('Loading backlog…');

        try {
            this.abortController = new AbortController();
            const url = `${base}/backlog?source=${encodeURIComponent(this.currentSource)}&lines=${lines}`;
            const response = await fetch(url, {
                credentials: 'same-origin',
                signal: this.abortController.signal
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to load backlog');
            }

            if (this.contentEl) this.contentEl.textContent = data.content || '';
            this.applyNextOffset(data.byteOffset);
            this.fileSize = data.fileSize || 0;
            this.lineCount = data.lineCount || 0;
            this.trimLogLinesIfNeeded();
            if (typeof customScrollbar !== 'undefined' && customScrollbar.forceReinit && this.scrollWrapper) {
                customScrollbar.forceReinit(this.scrollWrapper);
            }
            this.scrollToBottom(true);

            if (!this.paused) {
                this.startStream();
            } else {
                this.setStatus(this.formatStatusMeta());
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                this.setStatus(`Error: ${error.message}`);
            }
        }
    }

    processSseBlock(block) {
        if (!block.trim()) return;

        let eventName = 'message';
        let dataStr = '';
        for (const line of block.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (!dataStr) return;

        if (eventName === 'pm2status') {
            try {
                const data = JSON.parse(dataStr);
                this.applyPm2Status(data.status);
            } catch (_) { /* ignore */ }
            return;
        }

        if (eventName === 'chunk') {
            try {
                const data = JSON.parse(dataStr);
                if (data.content) this.appendLogContent(data.content);
                if (data.nextOffset !== undefined) this.applyNextOffset(data.nextOffset);
                if (typeof data.fileSize === 'number') this.fileSize = data.fileSize;
                this.isLive = true;
                this.setStatus(this.formatStatusMeta());
            } catch (_) { /* ignore */ }
            return;
        }

        if (eventName === 'rotate') {
            try {
                const data = JSON.parse(dataStr);
                this.applyNextOffset(data.nextOffset);
            } catch (_) {
                this.byteOffset = this.isCombinedSource(this.currentSource) ? { out: 0, err: 0 } : 0;
            }
            this.reload();
            return;
        }

        if (eventName === 'heartbeat') {
            if (!this.paused) {
                this.isLive = true;
                this.setStatus(this.formatStatusMeta());
            }
            return;
        }

        if (eventName === 'error') {
            this.isLive = false;
            try {
                const data = JSON.parse(dataStr);
                this.setStatus(`Stream error: ${data.message}`);
            } catch (_) {
                this.setStatus('Stream error');
            }
            this.stopStream();
            this.scheduleReconnect();
        }
    }

    async startStream(isReconnect) {
        this.stopStream(true);

        const base = this.getBasePath();
        if (!base || this.paused || this.modal?.classList.contains('minimised')
            || this.modal?.classList.contains('hidden')) return;

        const generation = ++this.streamGeneration;
        const url = `${base}/stream?source=${encodeURIComponent(this.currentSource)}&offset=${this.serializeOffset()}&statusInterval=${this.pm2StatusIntervalMs}`;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        if (!isReconnect) this.hideReconnectBanner();
        this.isLive = true;
        this.setStatus(this.formatStatusMeta());

        try {
            const response = await fetch(url, {
                credentials: 'same-origin',
                cache: 'no-store',
                signal,
                headers: { Accept: 'text/event-stream' }
            });

            if (!response.ok) {
                let errMsg = `HTTP ${response.status}`;
                try {
                    const errData = await response.json();
                    if (errData.error) errMsg = errData.error;
                } catch (_) { /* ignore */ }
                this.isLive = false;
                this.setStatus(`Stream error: ${errMsg}`);
                this.scheduleReconnect();
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (!signal.aborted) {
                const { done, value } = await reader.read();
                if (done) break;
                if (generation !== this.streamGeneration) return;

                buffer += decoder.decode(value, { stream: true });
                let sep;
                while ((sep = buffer.indexOf('\n\n')) !== -1) {
                    const block = buffer.slice(0, sep);
                    buffer = buffer.slice(sep + 2);
                    this.processSseBlock(block);
                }
            }

            if (!signal.aborted && !this.paused && generation === this.streamGeneration) {
                this.scheduleReconnect();
            }
        } catch (error) {
            if (error.name !== 'AbortError' && !this.paused && generation === this.streamGeneration) {
                this.isLive = false;
                this.setStatus(`Stream error: ${error.message}`);
                this.scheduleReconnect();
            }
        }
    }
}

const logViewerApplet = new LogViewerApplet();
logViewerApplet.init();
