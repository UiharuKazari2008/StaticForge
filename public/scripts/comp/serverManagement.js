/**
 * Admin server control — PM2 restart/flush, runtime asset compile, dev mode toggle.
 * public/scripts/comp/confirmationDialog.js (showConfirmationDialog)
 * public/scripts/comp/modalUtils.js (waitForServerDisconnect, runClientShutdownSequence, suppressWebSocketReconnectForReload)
 * public/scripts/comp/connectionManager.js (syncAuthLocalStorageFromServer)
 * public/scripts/websocket.js (wsClient.recompileRuntimeAssets)
 */

const serverManagement = {
    restartBroomDefault: true,
    pm2Status: null,
    pm2Available: false,
    runtimeCompileStatus: null,
    _runtimeCompileWsWired: false,
    _runtimeCompileListeners: [],

    isAdminSession() {
        return localStorage.getItem('userType') === 'admin';
    },

    getAdminApiBasePath() {
        const uuid = localStorage.getItem('logViewerPathUuid');
        if (!uuid) return null;
        return `/${uuid}`;
    },

    async ensureAdminApiPath() {
        if (this.getAdminApiBasePath()) return true;
        try {
            const response = await fetch('/app', {
                method: 'OPTIONS',
                credentials: 'same-origin',
                cache: 'no-store'
            });
            if (!response.ok) return false;
            const data = await response.json();
            // syncAuthLocalStorageFromServer: public/scripts/comp/connectionManager.js
            syncAuthLocalStorageFromServer(data);
            return Boolean(data.logViewerPathUuid);
        } catch (_) { /* ignore */ }
        return false;
    },

    setPm2Available(available) {
        this.pm2Available = available === true;
    },

    isPm2Available() {
        return this.pm2Available;
    },

    setPm2Status(status) {
        if (!status) return;
        this.pm2Status = status;
        if (status.runtimeCompile) {
            this.setRuntimeCompileStatus(status.runtimeCompile);
        }
    },

    getPm2ProcessLabel() {
        const name = this.pm2Status?.processName || 'Dreamscape';
        const id = this.pm2Status?.pm2Id;
        return id != null ? `${name} (id ${id})` : name;
    },

    async postPm2Action(path, body = {}) {
        const base = this.getAdminApiBasePath();
        if (!base) throw new Error('Admin API path unavailable');
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
    },

    wireRestartBroomToggleInDialog(signal) {
        const toggle = document.querySelector('#confirmationDialog .log-viewer-restart-broom-toggle');
        if (!toggle) return;
        toggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const on = toggle.getAttribute('data-state') === 'on';
            toggle.setAttribute('data-state', on ? 'off' : 'on');
        }, signal ? { signal } : undefined);
    },

    async requestFlushPm2Logs(options = {}) {
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
        if (!confirmed) return false;

        try {
            await this.postPm2Action('/pm2/flush');
            showGlassToast('success', 'System', 'Log files flushed', false, 3000, '<i class="fas fa-broom"></i>');
            if (options.onSuccess) {
                await options.onSuccess();
            }
            return true;
        } catch (error) {
            showGlassToast('error', 'System', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return false;
        }
    },

    async requestRestartServer(options = {}) {
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
                onDialogReady: (signal) => this.wireRestartBroomToggleInDialog(signal),
                resolveValue: (value, dialog) => {
                    if (!value) return false;
                    const toggle = dialog?.querySelector('.log-viewer-restart-broom-toggle');
                    const broom = toggle ? toggle.getAttribute('data-state') !== 'off' : true;
                    return { confirmed: true, broom };
                }
            }
        );
        const confirmed = await dialogPromise;
        if (!confirmed || confirmed === false) return false;

        const broom = typeof confirmed === 'object' ? confirmed.broom !== false : true;
        this.restartBroomDefault = broom;

        try {
            if (options.onPrepare) {
                options.onPrepare();
            }
            // suppressWebSocketReconnectForReload, waitForServerDisconnect, runClientShutdownSequence — modalUtils.js
            suppressWebSocketReconnectForReload();
            if (options.onStatus) {
                options.onStatus('Preparing DSS restart…');
            }
            await this.postPm2Action('/pm2/restart', { broom });
            if (options.onStatus) {
                options.onStatus('DSS restarting — waiting for disconnect…');
            }

            const disconnected = await waitForServerDisconnect({ timeoutMs: 120000 });

            if (!disconnected) {
                showGlassToast('error', 'DreamScape Server', 'Server did not disconnect in time — reload manually when ready', false, 10000, '<i class="fas fa-exclamation-triangle"></i>');
                if (options.onStatus) {
                    options.onStatus('DSS restart timed out — server may still be shutting down');
                }
                if (options.onError) {
                    options.onError(new Error('Server did not disconnect in time'));
                }
                return false;
            }

            if (options.onStatus) {
                options.onStatus('Server disconnected — restarting application…');
            }
            await runClientShutdownSequence(() => location.reload());
            return true;
        } catch (error) {
            showGlassToast('error', 'System', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            if (options.onError) {
                options.onError(error);
            }
            return false;
        }
    },

    isRuntimeDevMode() {
        try {
            return localStorage.getItem('staticforge_dev_mode') === 'true';
        } catch (e) {
            return false;
        }
    },

    syncRuntimeDevModeCookie(devMode) {
        try {
            if (devMode) {
                document.cookie = 'staticforge_dev_mode=1; path=/; SameSite=Lax';
            } else {
                document.cookie = 'staticforge_dev_mode=; path=/; Max-Age=0';
            }
        } catch (e) { /* ignore */ }
    },

    toggleRuntimeDevMode() {
        const nextDev = !this.isRuntimeDevMode();
        try {
            localStorage.setItem('staticforge_dev_mode', nextDev.toString());
        } catch (e) { /* ignore */ }
        this.syncRuntimeDevModeCookie(nextDev);
        this._notifyRuntimeCompileListeners('devMode');
        return nextDev;
    },

    getRuntimeCompileStatus() {
        return this.runtimeCompileStatus;
    },

    setRuntimeCompileStatus(runtimeCompile) {
        if (!runtimeCompile) return;
        this.runtimeCompileStatus = runtimeCompile;
        this._notifyRuntimeCompileListeners('status');
    },

    addRuntimeCompileListener(listener) {
        if (typeof listener === 'function') {
            this._runtimeCompileListeners.push(listener);
        }
    },

    removeRuntimeCompileListener(listener) {
        this._runtimeCompileListeners = this._runtimeCompileListeners.filter((fn) => fn !== listener);
    },

    _notifyRuntimeCompileListeners(event, payload) {
        this._runtimeCompileListeners.forEach((listener) => {
            try {
                listener(event, payload);
            } catch (error) {
                console.error('serverManagement runtime compile listener error:', error);
            }
        });
    },

    onRuntimeCompileProgress(message) {
        const data = message && message.data ? message.data : message;
        if (!data) return;
        this._notifyRuntimeCompileListeners('progress', data);
    },

    onRuntimeCompileComplete(message) {
        const data = message && message.data ? message.data : message;
        if (data) {
            this.runtimeCompileStatus = {
                complete: true,
                inProgress: false,
                compiled: data.compiled,
                failedCount: data.failedCount != null ? data.failedCount : (data.errors ? data.errors.length : 0),
                stats: data.stats || (this.runtimeCompileStatus && this.runtimeCompileStatus.stats),
                lastRunAt: Date.now()
            };
        }
        this._notifyRuntimeCompileListeners('complete', data);
    },

    onRuntimeCompileLogs(message) {
        const data = message && message.data ? message.data : message;
        const entries = data && Array.isArray(data.entries) ? data.entries : [];
        if (entries.length) {
            this._notifyRuntimeCompileListeners('logs', entries);
        }
    },

    wireRuntimeCompileWsHandlers() {
        if (this._runtimeCompileWsWired) return;
        if (!wsClient || typeof wsClient.on !== 'function') return;
        this._runtimeCompileWsWired = true;
        wsClient.on('runtime_compile_progress', (message) => this.onRuntimeCompileProgress(message));
        wsClient.on('runtime_compile_complete', (message) => this.onRuntimeCompileComplete(message));
        wsClient.on('runtime_compile_logs', (message) => this.onRuntimeCompileLogs(message));
    },

    async requestRuntimeCompile() {
        if (!wsClient || !wsClient.isConnected() || typeof wsClient.recompileRuntimeAssets !== 'function') {
            return null;
        }
        this._notifyRuntimeCompileListeners('compileStart');
        try {
            const result = await wsClient.recompileRuntimeAssets({ force: true, silent: true });
            if (result) {
                this.runtimeCompileStatus = {
                    complete: true,
                    inProgress: false,
                    compiled: result.compiled,
                    failedCount: result.failedCount != null ? result.failedCount : (result.errors ? result.errors.length : 0),
                    stats: result.stats || null,
                    lastRunAt: Date.now()
                };
            }
            this._notifyRuntimeCompileListeners('compileDone', result);
            return result;
        } catch (error) {
            console.error('Runtime compile request failed:', error);
            this._notifyRuntimeCompileListeners('compileError', error);
            throw error;
        } finally {
            this._notifyRuntimeCompileListeners('compileEnd');
        }
    }
};
