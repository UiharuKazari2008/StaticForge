/**
 * Bound-client update+restart dialog (#18).
 * Classic confirmation / System Update chrome + DSAP-SMF context/status.
 * Mandatory 15s countdown. Cancel aborts (no apply, no restart).
 * No input at 0 → check updates, apply, restart this tab.
 */
(function initAgentClientUpdateDialog() {
    const COUNTDOWN_SEC = 15;
    const COPY = {
        counting: {
            title: 'Client Update',
            lead: 'An agent asked this client to update, then restart.',
            body: 'This bound Dreamscape tab will check for client updates, apply them, and restart. This dialog is mandatory — it cannot be missed.',
            hint: 'Cancel aborts. If you do nothing, restart starts when the countdown hits 0.',
            unit: 'seconds'
        },
        aborted: {
            title: 'Client Update — Cancelled',
            lead: 'Update cancelled.',
            body: 'You cancelled before the countdown hit 0. Updates were not applied. This client will not restart.',
            hint: 'The agent push was acknowledged and aborted on this bound session only.',
            unit: 'aborted',
            status: 'Cancelled. Updates not applied. No restart.'
        },
        applying: {
            title: 'Client Update',
            lead: 'Applying updates and restarting this client.',
            body: 'No input during the 15 second countdown. This bound tab is checking for updates, applying them, then restarting.',
            hint: 'Cancel is no longer available. Close is still disabled.',
            unit: 'restarting',
            status: 'Applying updates… this client will restart.'
        }
    };

    let dialog = null;
    let phase = 'idle'; // idle | counting | aborted | applying
    let remaining = COUNTDOWN_SEC;
    let tickTimer = null;
    let keydownWired = false;
    let settle = null;

    function statusTextForCount(sec) {
        const n = Math.max(0, sec);
        return `Restart in ${n} second${n === 1 ? '' : 's'} unless you cancel.`;
    }

    function progressPct() {
        return Math.round(((COUNTDOWN_SEC - remaining) / COUNTDOWN_SEC) * 100);
    }

    function clearTick() {
        if (tickTimer) {
            clearInterval(tickTimer);
            tickTimer = null;
        }
    }

    function resolveOnce(payload) {
        if (!settle) return;
        const fn = settle;
        settle = null;
        fn(payload);
    }

    function el(id) {
        return dialog ? dialog.querySelector(id) : null;
    }

    function ensureDialog() {
        if (dialog) return dialog;
        dialog = document.createElement('div');
        dialog.id = 'agentClientUpdateDialog';
        dialog.className = 'modal hidden transient tool-window on-top';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.innerHTML = `
                <div class="modal-window-title">
                    <div class="modal-window-title-main">
                        <i class="fas fa-display-arrow-down"></i>
                        <span id="agentClientUpdateTitle">Client Update</span>
                    </div>
                </div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-danger close-btn btn-small" title="Close" disabled>
                        <i class="fa-regular fa-xmark-large"></i>
                    </button>
                </div>
                <div class="modal-content modal-padding dark" data-dsap="agent-client-update">
                    <div class="dsap-smf-contextbar">Agent · loopback /agent · bound client session</div>
                    <div class="agent-client-update-row">
                        <div class="agent-client-update-well" id="agentClientUpdateWell">
                            <div class="agent-client-update-num" id="agentClientUpdateCount">15</div>
                            <div class="agent-client-update-unit" id="agentClientUpdateUnit">seconds</div>
                        </div>
                        <div class="agent-client-update-copy">
                            <h2 id="agentClientUpdateLead"></h2>
                            <p id="agentClientUpdateBody"></p>
                            <p class="agent-client-update-hint" id="agentClientUpdateHint"></p>
                        </div>
                    </div>
                    <div class="dsap-smf-statusbox" id="agentClientUpdateStatusBox">
                        <span class="dsap-smf-status-message" id="agentClientUpdateStatus"></span>
                    </div>
                    <div role="progressbar">
                        <div id="agentClientUpdateBar"></div>
                    </div>
                    <div class="confirmation-controls" id="agentClientUpdateControls"></div>
                </div>
            `;
        document.body.appendChild(dialog);
        wireKeydown();
        return dialog;
    }

    function wireKeydown() {
        if (keydownWired || typeof registerKeyboardListener !== 'function') return;
        registerKeyboardListener({
            id: 'agentClientUpdateDialog.keydown',
            handler: handleKeydown,
            type: 'whenOpen',
            modalId: 'agentClientUpdateDialog',
            priority: 90,
            critical: true,
            showInOverlay: false
        });
        registerKeyboardListener({
            id: 'overlay.agentClientUpdate.escape',
            type: 'whenOpen',
            modalId: 'agentClientUpdateDialog',
            label: 'Cancel',
            keys: 'Esc',
            overlayIcon: 'fas fa-times',
            overlayGroup: 'Dialog',
            overlayOnly: true,
            priority: -10,
            overlayValid: function () {
                return phase === 'counting' || phase === 'aborted';
            }
        });
        keydownWired = true;
    }

    function handleKeydown(e) {
        if (!dialog || dialog.classList.contains('hidden')) return;
        if (e.key !== 'Escape') return;
        if (phase === 'counting') {
            e.preventDefault();
            e.stopPropagation();
            abortUpdate();
            return;
        }
        if (phase === 'aborted') {
            e.preventDefault();
            e.stopPropagation();
            hideDialog();
        }
    }

    function setCopy(block) {
        const title = el('#agentClientUpdateTitle');
        const lead = el('#agentClientUpdateLead');
        const body = el('#agentClientUpdateBody');
        const hint = el('#agentClientUpdateHint');
        const unit = el('#agentClientUpdateUnit');
        if (title) title.textContent = block.title;
        if (lead) lead.textContent = block.lead;
        if (body) body.textContent = block.body;
        if (hint) hint.textContent = block.hint;
        if (unit) unit.textContent = block.unit;
    }

    function setWell(kind) {
        const well = el('#agentClientUpdateWell');
        if (!well) return;
        well.classList.remove('aborted', 'applying');
        if (kind) well.classList.add(kind);
    }

    function setStatus(text, tone) {
        const box = el('#agentClientUpdateStatusBox');
        const msg = el('#agentClientUpdateStatus');
        if (msg) msg.textContent = text;
        if (!box) return;
        box.classList.remove('dsap-smf-status-error', 'dsap-smf-status-ok');
        if (tone) box.classList.add(tone);
    }

    function setBar(pct, stripe) {
        const bar = el('#agentClientUpdateBar');
        if (!bar) return;
        bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        bar.classList.toggle('agent-client-update-bar-stripe', !!stripe);
    }

    function setButtons(kind) {
        const controls = el('#agentClientUpdateControls');
        if (!controls) return;
        controls.innerHTML = '';
        if (kind === 'cancel') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-standard';
            btn.setAttribute('data-dialog-primary', '1');
            btn.textContent = 'Cancel';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                abortUpdate();
            });
            controls.appendChild(btn);
            controls.style.display = '';
            return;
        }
        if (kind === 'ok') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-standard';
            btn.setAttribute('data-dialog-primary', '1');
            btn.textContent = 'OK';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                hideDialog();
            });
            controls.appendChild(btn);
            controls.style.display = '';
            return;
        }
        controls.style.display = 'none';
    }

    function renderCounting() {
        setCopy(COPY.counting);
        setWell('');
        const count = el('#agentClientUpdateCount');
        if (count) {
            count.textContent = String(remaining);
            count.classList.remove('struck');
        }
        setStatus(statusTextForCount(remaining), '');
        setBar(progressPct(), false);
        setButtons('cancel');
    }

    function renderAborted() {
        setCopy(COPY.aborted);
        setWell('aborted');
        const count = el('#agentClientUpdateCount');
        if (count) {
            count.textContent = String(remaining);
            count.classList.add('struck');
        }
        setStatus(COPY.aborted.status, 'dsap-smf-status-error');
        setBar(progressPct(), false);
        setButtons('ok');
    }

    function renderApplying() {
        remaining = 0;
        setCopy(COPY.applying);
        setWell('applying');
        const count = el('#agentClientUpdateCount');
        if (count) {
            count.textContent = '0';
            count.classList.remove('struck');
        }
        setStatus(COPY.applying.status, 'dsap-smf-status-ok');
        setBar(72, true);
        setButtons('none');
    }

    function hideDialog() {
        clearTick();
        if (!dialog) {
            phase = 'idle';
            return;
        }
        if (typeof closeModal === 'function') {
            closeModal(dialog);
        } else {
            dialog.classList.add('hidden');
        }
        phase = 'idle';
    }

    function openDialog() {
        ensureDialog();
        if (typeof openModal === 'function') {
            openModal(dialog);
        } else {
            dialog.classList.remove('hidden');
        }
        if (typeof setActiveWindow === 'function') {
            setActiveWindow(dialog);
        } else {
            dialog.classList.add('active-window');
        }
    }

    function abortUpdate() {
        if (phase !== 'counting') return;
        clearTick();
        phase = 'aborted';
        renderAborted();
        resolveOnce({
            ok: true,
            cancelled: true,
            applied: false,
            restart: false
        });
    }

    async function applyClientUpdatesAndRestart() {
        const sw = window.serviceWorkerManager;
        try {
            if (sw && typeof sw.getFilesNeedingUpdate === 'function') {
                const response = await fetch('/', {
                    method: 'OPTIONS',
                    headers: {
                        'X-Service-Worker-Version': '2.0',
                        'X-Requested-With': 'ServiceWorker'
                    }
                });
                if (response.ok) {
                    const files = await response.json();
                    const filesToUpdate = await sw.getFilesNeedingUpdate(files);
                    if (filesToUpdate.length && typeof sw.attachToDownloadProgress === 'function') {
                        await sw.attachToDownloadProgress({
                            files: filesToUpdate,
                            allowSkip: false
                        });
                    } else if (typeof sw.updateStaticCache === 'function') {
                        await sw.updateStaticCache(files, true);
                    }
                }
            } else if (sw && typeof sw.checkStaticFileUpdates === 'function') {
                await sw.checkStaticFileUpdates(true);
            }
        } catch (_err) {
            // Still restart — the push is apply-then-restart, not check-or-bail.
        }
        if (sw && typeof sw.forceRestart === 'function') {
            sw.forceRestart();
            return;
        }
        if (typeof bypassConfirmation !== 'undefined') {
            bypassConfirmation = true;
        }
        try {
            window.location.reload();
        } catch (_err) {
            window.location.href = window.location.href;
        }
    }

    function startApplying() {
        if (phase !== 'counting') return;
        clearTick();
        phase = 'applying';
        renderApplying();
        resolveOnce({
            ok: true,
            cancelled: false,
            applying: true,
            applied: true,
            restart: true
        });
        void applyClientUpdatesAndRestart();
    }

    function startTick() {
        clearTick();
        tickTimer = setInterval(() => {
            if (phase !== 'counting') {
                clearTick();
                return;
            }
            remaining -= 1;
            if (remaining <= 0) {
                startApplying();
                return;
            }
            renderCounting();
        }, 1000);
    }

    /**
     * Show the mandatory Client Update dialog.
     * Resolves on Cancel (aborted) or when countdown hits 0 (applying).
     * A second push while counting/applying is a no-op (alreadyShowing).
     * A second push after abort replaces the aborted dialog with a new countdown.
     */
    function showAgentClientUpdateDialog() {
        if (phase === 'counting' || phase === 'applying') {
            return Promise.resolve({
                ok: true,
                alreadyShowing: true,
                cancelled: false,
                applying: phase === 'applying'
            });
        }
        remaining = COUNTDOWN_SEC;
        phase = 'counting';
        ensureDialog();
        renderCounting();
        openDialog();
        startTick();
        return new Promise((resolve) => {
            settle = resolve;
        });
    }

    if (typeof window !== 'undefined') {
        window.showAgentClientUpdateDialog = showAgentClientUpdateDialog;
        window.AGENT_CLIENT_UPDATE_COUNTDOWN_SEC = COUNTDOWN_SEC;
    }
})();
