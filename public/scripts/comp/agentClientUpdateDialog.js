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
    let countdownTotal = COUNTDOWN_SEC;
    let activeCopy = COPY;
    let tickTimer = null;
    let keydownWired = false;
    let settle = null;

    function statusTextForCount(sec) {
        const n = Math.max(0, sec);
        return `Restart in ${n} second${n === 1 ? '' : 's'} unless you cancel.`;
    }

    function progressPct() {
        if (countdownTotal <= 0) return 100;
        return Math.round(((countdownTotal - remaining) / countdownTotal) * 100);
    }

    function copyForShow(options) {
        const opts = options && typeof options === 'object' ? options : {};
        const title = typeof opts.title === 'string' && opts.title.trim() ? opts.title.trim() : COPY.counting.title;
        const lead = typeof opts.lead === 'string' && opts.lead.trim() ? opts.lead.trim() : COPY.counting.lead;
        const body = typeof opts.message === 'string' && opts.message.trim() ? opts.message.trim() : COPY.counting.body;
        if (title === COPY.counting.title && lead === COPY.counting.lead && body === COPY.counting.body) {
            return COPY;
        }
        return {
            counting: { ...COPY.counting, title, lead, body },
            aborted: { ...COPY.aborted, title: `${title} — Cancelled` },
            applying: { ...COPY.applying, title }
        };
    }

    function clearTick() {
        if (tickTimer) {
            clearInterval(tickTimer);
            tickTimer = null;
        }
        if (tickWake) {
            document.removeEventListener('visibilitychange', tickWake);
            window.removeEventListener('melatonscreen', tickWake);
            tickWake = null;
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
        dialog.className = 'modal hidden transient owned-window on-top';
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
        setCopy(activeCopy.counting);
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
        setCopy(activeCopy.aborted);
        setWell('aborted');
        const count = el('#agentClientUpdateCount');
        if (count) {
            count.textContent = String(remaining);
            count.classList.add('struck');
        }
        setStatus(activeCopy.aborted.status, 'dsap-smf-status-error');
        setBar(progressPct(), false);
        setButtons('ok');
    }

    function renderApplying() {
        remaining = 0;
        setCopy(activeCopy.applying);
        setWell('applying');
        const count = el('#agentClientUpdateCount');
        if (count) {
            count.textContent = '0';
            count.classList.remove('struck');
        }
        setStatus(activeCopy.applying.status, 'dsap-smf-status-ok');
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
                    } else if (filesToUpdate.length && typeof sw.updateStaticCache === 'function') {
                        // install: true - downloaded now, not held as a count (#1022)
                        await sw.updateStaticCache(filesToUpdate, true, { install: true });
                    }
                }
            } else if (sw && typeof sw.checkStaticFileUpdates === 'function') {
                await sw.checkStaticFileUpdates(true);
            }
        } catch (_err) {
            // Still restart — the push is apply-then-restart, not check-or-bail.
        }
        if (sw && typeof sw.forceRestart === 'function') {
            // the agent's countdown was the warning: no second "Restart?" (Continuity) after it (#1022)
            sw.forceRestart({ confirmed: true });
            return;
        }
        // runWinlogonPower: public/scripts/comp/winlogonPower.js
        runWinlogonPower('restart');
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

    // not seen: a hidden tab or a screen that is off (the page stays visible, html[data-screen-off])
    function unseen() {
        return document.hidden || document.documentElement.hasAttribute('data-screen-off');
    }

    let tickDeadline = 0;
    let tickWake = null;

    function startTick() {
        clearTick();
        // the count comes from a deadline, so hidden-tab timer throttling cannot stretch it (#890)
        tickDeadline = Date.now() + Math.max(0, remaining) * 1000;
        const tick = () => {
            if (phase !== 'counting') {
                clearTick();
                return;
            }
            remaining = Math.max(0, Math.ceil((tickDeadline - Date.now()) / 1000));
            if (remaining <= 0) {
                startApplying();
                return;
            }
            // nothing redraws while not seen; the wake below draws the count the moment it is
            if (!unseen()) renderCounting();
        };
        tickWake = () => { if (!unseen()) tick(); };
        document.addEventListener('visibilitychange', tickWake);
        window.addEventListener('melatonscreen', tickWake);
        // perf: allow the mandatory restart countdown: lives only while its dialog counts (at most 300 s, cleared at 0 or Cancel), draws only while seen, and its zero applies the update, which a hidden desktop tab must do too (a phone holds it until seen)
        tickTimer = setInterval(tick, 1000);
    }

    /**
     * Show the mandatory Client Update / broadcast-restart dialog.
     * options.countdownSec overrides the 15s default (broadcast timeout / 1000).
     * options.title / message / lead overlay counting copy; chrome stays the same.
     * Resolves on Cancel (aborted) or when countdown hits 0 (applying).
     * A second push while counting/applying is a no-op (alreadyShowing).
     * A second push after abort replaces the aborted dialog with a new countdown.
     */
    function showAgentClientUpdateDialog(options) {
        // never on Melaton Mobile (the phone shell): this is the desktop's mandatory countdown; a phone takes its
        // updates through its own Melaton Update (WM package install) when its owner chooses (Yukimi, Nov 19, #951)
        if (window.uiShell === 'mobile' || document.documentElement.classList.contains('ui-mobile')) {
            return Promise.resolve({ ok: false, refused: true, error: 'Melaton Mobile does not take agent-requested updates; its owner installs them from Melaton Update.' });
        }
        if (phase === 'counting' || phase === 'applying') {
            return Promise.resolve({
                ok: true,
                alreadyShowing: true,
                cancelled: false,
                applying: phase === 'applying'
            });
        }
        const opts = options && typeof options === 'object' ? options : {};
        const rawCount = opts.countdownSec;
        countdownTotal = Number.isFinite(rawCount)
            ? Math.max(0, Math.min(300, Math.floor(rawCount)))
            : COUNTDOWN_SEC;
        remaining = countdownTotal;
        activeCopy = copyForShow(opts);
        phase = 'counting';
        ensureDialog();
        renderCounting();
        openDialog();
        // desktopSounds.play: public/scripts/comp/desktopSounds.js
        desktopSounds.play('uac');
        const shown = new Promise((resolve) => {
            settle = resolve;
        });
        const go = () => { if (phase !== 'counting') return; if (remaining <= 0) startApplying(); else startTick(); };
        // a phone that is not on screen holds the countdown until it is (#890): nobody can press Cancel on a
        // hidden page, and it came back to a cold boot
        const phone = window.uiShell === 'mobile' || document.documentElement.classList.contains('ui-mobile');
        const away = () => document.hidden || document.documentElement.hasAttribute('data-screen-off');
        if (phone && away()) {
            // the screen coming on is no visibilitychange (the page stays visible with the screen off,
            // html[data-screen-off]): the app's melatonscreen { on: true } says it (#890)
            const onShow = () => {
                if (away()) return;
                document.removeEventListener('visibilitychange', onShow);
                window.removeEventListener('melatonscreen', onScreen);
                go();
            };
            const onScreen = (e) => { if (e && e.detail && e.detail.on) onShow(); };
            document.addEventListener('visibilitychange', onShow);
            window.addEventListener('melatonscreen', onScreen);
        } else {
            go();
        }
        return shown;
    }

    if (typeof window !== 'undefined') {
        window.showAgentClientUpdateDialog = showAgentClientUpdateDialog;
        window.AGENT_CLIENT_UPDATE_COUNTDOWN_SEC = COUNTDOWN_SEC;
    }
})();
