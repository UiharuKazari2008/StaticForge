/**
 * Melaton Mobile: the Director as a mobile visual novel (Yozora #709).
 *
 * Yukimi: "do not remove the mascot and such view, act like it's still a VN game but is mobile".
 * The Director is a Dreamscape app (own name and icon, no WM stock counterpart), so this is not a
 * WM clone: the desktop Director's own visual novel (director.js + directorMascot.js: her room, the
 * layered sprites, the thought cloud with live thinking, the typed lines with the working marker,
 * the reply / report card box, suggestions) runs full screen between the WM title bar and the soft
 * keys, with WM chrome around it.
 *
 * How: the desktop window #directorWindow is moved into this app's page and opened the normal way
 * (directorInstance.openDirectorWindow), so every send path, stream handler, session, persona and
 * the agent protocol stay director.js's; wm-director.css drops the window frame and command bar and
 * fits the scene to a portrait screen. Nothing here talks to the agent on its own.
 *
 *   scene        her room and sprites, face at the upper middle (the desktop puts her face 24 %
 *                in from her side; a portrait screen centres her: the mascot's layout() is wrapped
 *                on this instance only)
 *   text box     the VN box at the bottom: her lines type in while she works (working marker),
 *                the turn's reply and report card when done; a tap on the scene advances (finishes
 *                the line being typed, then pages the reply)
 *   thought cloud  tap: she thinks aloud in the text box (the desktop's click)
 *   compose      Reply opens the composer (the desktop's textarea, attachments chips) over the
 *                text box and focuses it for the SIP; soft keys Send / Cancel
 *   soft keys    Reply | Menu. Menu: Sessions, New Session, Persona >, Report Card / Reply, Log,
 *                Stop, Delete Session..., Attach File..., Options > (Visual Novel / Messages view,
 *                Show Mascot)
 *   Sessions     a WM list of the persona's chats (preview, name, date); tap opens one; back key
 *                and Cancel return to her
 *
 * Only on phones: does nothing unless window.uiShell is 'mobile'. Styles: public/css/wm-director.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'director';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let ws = null; // window.wmShell
    let page = null;
    let shown = false;
    let sub = null; // null | 'sessions'
    let composing = false;
    let patchedMascot = null;
    let waitTimer = null;

    const dir = () => window.directorInstance || null;
    const isCurrent = () => !!(ws && ws.current === APP_ID);
    const PERSONAS = { wren: 'Yumiya', kabuki: 'Chiyo', xi: 'Yozora' };

    function personaName(p) {
        try {
            // director.js top-level function
            // eslint-disable-next-line no-undef
            if (typeof directorPersonaName === 'function') return directorPersonaName(p);
        } catch (_) { /* fall back */ }
        return PERSONAS[p] || 'Director';
    }

    /** Menu > Log: the log over her scene (the desktop's peek). */
    function peeking() {
        const d = dir();
        const m = d && d.mascot;
        // only a log that is on screen counts (a view switch can leave peek set with no log showing)
        return !!(m && m.peek && m.vnBubbles() && m.host && m.host.classList.contains('dm-log-peek'));
    }

    function running(d) {
        d = d || dir();
        return !!(d && d._running && d.currentSession && d._runningSessionId === d.currentSession.id);
    }

    // ---------------------------------------------------------------- hosting the desktop Director

    /** Wrap the mascot's isHosted / layout on this instance: hidden with the app, centred on a portrait screen. */
    function patchMascot(d) {
        const m = d && d.mascot;
        if (!m || patchedMascot === m) return;
        patchedMascot = m;
        // she holds no layers while the app is in the background (applyView releases them). A phone never
        // shows the desktop window, so outside the app's page (after a reload reopened it under BODY) she is hidden too.
        m.isHosted = () => !!(shown && page && page.contains(m.host));
        const layout = m.layout.bind(m);
        m.layout = function () {
            layout();
            if (!this.root || !this.manifest || !this.host || !this._shown || this.view !== 'mascot') return;
            if (!page || !page.contains(this.host)) return;
            const box = this.host.getBoundingClientRect();
            if (!box.width || !box.height) return;
            const [W, H] = this.manifest.size;
            const cam = this.camera();
            const face = Array.isArray(this.manifest.face) ? this.manifest.face : [cam[0] + cam[2] / 2, cam[1] + cam[3] * 0.2, cam[2] * 0.15];
            // portrait: her face at the upper middle, sized from the width (the desktop sizes it from
            // the height, which on a phone put most of her off the side)
            const faceSize = Math.min(box.height * 0.1, box.width * 0.2);
            const k = faceSize / Math.max(1, face[2]);
            const px = box.width * 0.5;
            const py = box.height * 0.2;
            this.el.canvas.style.width = `${Math.round(W * k)}px`;
            this.el.canvas.style.height = `${Math.round(H * k)}px`;
            this.el.canvas.style.transform = `translate(${Math.round(px - face[0] * k)}px, ${Math.round(py - face[1] * k)}px)`;
            this._k = k;
        };
        // the pager counts pages of (height - 24 px): a short box read "1/2" with nothing more to show
        const pager = m.paintPager.bind(m);
        m.paintPager = function () {
            pager();
            const body = this.el && this.el.dialogBody;
            if (body && this.el.pager && page && page.contains(body) && body.scrollHeight <= body.clientHeight + 2) {
                this.el.pager.classList.add('hidden');
                this.el.pager.textContent = '';
            }
        };
        m.applyView();
        syncBlink(m);
    }

    /** Her blink timer (started once at mount by the desktop) runs only while the app is on screen. */
    function syncBlink(m) {
        if (!m || typeof m.scheduleBlink !== 'function') return;
        if (shown && !m._blinkTimer) m.scheduleBlink();
        else if (!shown && m._blinkTimer) { clearTimeout(m._blinkTimer); m._blinkTimer = null; }
    }

    /**
     * Patch the Director as soon as it exists, not on the first open of the app: a reload can reopen its window
     * (hidden) while the phone is on Today, and she must not hold her layers then. Also keep the desktop's
     * reload-reopen flag from being saved unless this app is on screen (the phone always starts on Today).
     */
    let patchedDirector = null;
    function patchDirector() {
        const d = dir();
        if (!d) return false;
        if (patchedDirector !== d && typeof d.saveReopenState === 'function') {
            patchedDirector = d;
            const save = d.saveReopenState.bind(d);
            d.saveReopenState = function () {
                if (shown && isCurrent()) { save(); return; }
                try { sessionStorage.removeItem('staticforge_director_reopen'); } catch (_) { /* storage blocked */ }
            };
        }
        if (!d.mascot) return false;
        patchMascot(d);
        return true;
    }

    function waitForDirector() {
        if (patchDirector()) return;
        const timer = setInterval(() => { if (patchDirector()) clearInterval(timer); }, 1000);
    }

    function hostWindow(d) {
        const win = d && d.directorWindow;
        const host = page && page.querySelector('.wmd-host');
        if (!win || !host) return false;
        if (win.parentNode !== host) host.appendChild(win);
        return true;
    }

    async function attach() {
        const d = dir();
        const status = page.querySelector('.wmd-status');
        if (!d || !d.directorWindow) {
            status.hidden = false;
            status.querySelector('.wmd-status-text').textContent = 'The Director is starting...';
            if (!waitTimer) waitTimer = setTimeout(() => { waitTimer = null; if (shown) void attach(); }, 1000);
            return;
        }
        status.hidden = true;
        hostWindow(d);
        patchMascot(d);
        watchChat(d);
        if (!d.directorWindowIsOpen()) {
            await d.openDirectorWindow();
        } else {
            if (d.mascot) d.mascot.applyView();
            d.paintPersonaToggle();
        }
        if (!shown) return;
        syncBlink(d.mascot);
        syncComposer();
        refreshTitle();
        if (d.mascot) d.mascot.settleLayout(600);
        if (ws && isCurrent()) ws.refreshSoftKeys();
    }

    /** A chat opening or a new draft (the desktop toggles director-composer-center): composer and soft keys follow. */
    let watched = null;
    function watchChat(d) {
        const chat = d && d.directorSessionChat;
        if (!chat || watched === chat || typeof MutationObserver !== 'function') return;
        watched = chat;
        let was = chat.classList.contains('director-composer-center');
        new MutationObserver(() => {
            const now = chat.classList.contains('director-composer-center');
            if (now === was) return;
            was = now;
            // left the draft some other way than send() (a quick-start button, a chat the server made): the
            // composer opened on the draft would now count as a back step with no history entry
            if (!now && composing && !(d.directorChatInput && document.activeElement === d.directorChatInput)) composing = false;
            if (!shown) return;
            syncComposer();
            if (isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
        }).observe(chat, { attributes: true, attributeFilter: ['class'] });
    }

    function refreshTitle() {
        if (!ws || !isCurrent()) return;
        if (sub === 'sessions') { ws.setTitle(`${personaName(dir() && dir().persona)}: Sessions`); return; }
        ws.setTitle('Director');
    }

    // ---------------------------------------------------------------- composer

    function isDraft(d) {
        d = d || dir();
        // the desktop centres its composer on a new chat (placeComposer): that is the draft state
        const chat = d && d.directorSessionChat;
        if (chat) return chat.classList.contains('director-composer-center');
        return !!(d && d.currentSession && d.currentSession.draft);
    }

    /** The composer shows while composing, and always on a new chat (the desktop's centred home). */
    function syncComposer() {
        if (!page) return;
        const d = dir();
        const open = composing || isDraft(d);
        page.classList.toggle('wmd-composing', open);
        if (d && d.mascot) d.mascot.settleLayout(400);
    }

    function openComposer() {
        const d = dir();
        if (!d) return;
        composing = true;
        syncComposer();
        const input = d.directorChatInput;
        if (input) {
            input.focus({ preventScroll: true });
            try { const n = input.value.length; input.setSelectionRange(n, n); } catch (_) { /* not a text field */ }
        }
        ws.refreshSoftKeys();
        ws.syncHistory();
    }

    function closeComposer() {
        const d = dir();
        composing = false;
        if (d && d.directorChatInput) d.directorChatInput.blur();
        syncComposer();
        if (ws && isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
    }

    async function send() {
        const d = dir();
        if (!d) return;
        const text = d.directorChatInput ? d.directorChatInput.value.trim() : '';
        if (!text && !(d.pendingAttachments && d.pendingAttachments.length)) { openComposer(); return; }
        await d.sendMessage();
        // the desktop clears the box once the message is on its way (a busy chat asks Steer / Queue first)
        if (d.directorChatInput && !d.directorChatInput.value.trim()) closeComposer();
        else ws.refreshSoftKeys();
        ws.syncHistory();
    }

    // ---------------------------------------------------------------- tap to advance

    /** A tap on the scene: finish the line being typed, then page the reply (the desktop's click). */
    function advance() {
        const d = dir();
        const m = d && d.mascot;
        if (!m || !m.el) return;
        const r = m._reader;
        if (m.working && r && r.current) {
            if (r.shown < r.current.text.length) {
                r.shown = r.current.text.length;
                r.holdUntil = Date.now() + 800;
            } else if (r.queue.length) {
                r.holdUntil = 0;
            }
            m.paintBubbles();
            m.startReader();
            return;
        }
        if (m._result && !m.el.result.classList.contains('hidden')) m.pageReply();
    }

    // ---------------------------------------------------------------- sessions list

    function sessionDate(d, s) {
        try { return d.formatSessionDate(s.updated_at || s.created_at); } catch (_) { return ''; }
    }

    function renderSessions() {
        const d = dir();
        const list = page.querySelector('.wmd-sessions-list');
        if (!d || !list) return;
        const sessions = (d.directorSessions || []).filter((s) => !s.archived);
        const xi = d.persona === 'xi';
        const curId = d.currentSession && d.currentSession.id;
        list.innerHTML = sessions.map((s) => {
            let thumb = '';
            if (!xi) {
                let src = '';
                try { src = d.getSessionPreviewImage(s) || ''; } catch (_) { src = ''; }
                thumb = `<img class="wmd-session-thumb" src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`;
            } else {
                thumb = '<img class="wmd-session-thumb is-icon" src="/static_images/app_icons/director.png" alt="">';
            }
            const busy = d._running && d._runningSessionId === s.id;
            return `<button type="button" class="wmd-session${String(s.id) === String(curId) ? ' is-current' : ''}" data-id="${esc(s.id)}">${thumb}<span class="wmd-session-text"><span class="wmd-session-name">${esc(s.name || 'Untitled')}</span><span class="wmd-session-date">${busy ? 'Working... ' : ''}${esc(sessionDate(d, s))}</span></span></button>`;
        }).join('') || '<p class="wmd-empty">No sessions</p>';
    }

    async function showSessions() {
        const d = dir();
        if (!d) return;
        if (composing) closeComposer();
        sub = 'sessions';
        page.classList.add('wmd-show-sessions');
        page.querySelector('.wmd-sessions').hidden = false;
        renderSessions();
        refreshTitle();
        ws.refreshSoftKeys();
        ws.syncHistory();
        try { await d.loadDirectorSessions(); } catch (_) { /* keep what is listed */ }
        if (sub === 'sessions') renderSessions();
    }

    function closeSessions() {
        if (sub !== 'sessions') return;
        sub = null;
        page.classList.remove('wmd-show-sessions');
        page.querySelector('.wmd-sessions').hidden = true;
        refreshTitle();
        ws.refreshSoftKeys();
        const d = dir();
        if (d && d.mascot) d.mascot.settleLayout(400);
    }

    async function openSession(id) {
        const d = dir();
        const s = d && (d.directorSessions || []).find((x) => String(x.id) === String(id));
        if (!s) return;
        closeSessions();
        ws.syncHistory();
        await d.showSessionChat(s);
        syncComposer();
        ws.refreshSoftKeys();
    }

    async function newSession() {
        const d = dir();
        if (!d) return;
        if (sub) { closeSessions(); ws.syncHistory(); }
        await d.openNewSession();
        openComposer();
    }

    async function switchPersona(p) {
        const d = dir();
        if (!d || d.persona === p) return;
        if (composing) closeComposer();
        await d.setPersona(p);
        syncComposer();
        if (sub === 'sessions') { renderSessions(); try { await d.loadDirectorSessions(); } catch (_) { /* best effort */ } renderSessions(); }
        refreshTitle();
        ws.refreshSoftKeys();
    }

    function personaItems() {
        const d = dir();
        if (!d) return [];
        const items = [{ label: personaName('wren'), radio: d.persona === 'wren', action: () => switchPersona('wren') }];
        if (d.kabukiAvailable() || d.persona === 'kabuki') items.push({ label: personaName('kabuki'), radio: d.persona === 'kabuki', action: () => switchPersona('kabuki') });
        if (d._xiEnabled === true) items.push({ label: personaName('xi'), radio: d.persona === 'xi', action: () => switchPersona('xi') });
        return items;
    }

    // ---------------------------------------------------------------- menus

    function optionsItems() {
        const d = dir();
        const m = d && d.mascot;
        if (!m) return [{ label: 'No options', disabled: true }];
        return [
            { label: 'Visual Novel', radio: m.view === 'mascot', action: () => { unpeek(m); m.setView('mascot'); after(); } },
            { label: 'Messages', radio: m.view !== 'mascot', action: () => { unpeek(m); m.setView('messages'); after(); } },
            '-',
            { label: 'Show Mascot', checked: !!m.enabled, action: () => { unpeek(m); m.setEnabled(!m.enabled); after(); } }
        ];
    }

    /** A view switch closes the log first, so no hidden peek is left behind (it would eat a Back press). */
    function unpeek(m) {
        if (m.peek) m.togglePeek(false);
    }

    function after() {
        const d = dir();
        if (d && d.mascot) d.mascot.settleLayout(500);
        // a closed log (or any layer) takes its history entry with it
        if (ws && isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
    }

    function mainMenu() {
        const d = dir();
        if (!d) return [{ label: 'The Director is starting...', disabled: true }];
        const m = d.mascot;
        const vn = !!(m && m.vnBubbles());
        const result = !!(vn && m._result && !m.el.result.classList.contains('hidden'));
        const card = !!(result && m._result.card);
        const items = [
            { label: 'Sessions', action: () => { void showSessions(); } },
            { label: 'New Session', action: () => { void newSession(); } },
            { label: 'Persona', submenu: personaItems }
        ];
        items.push('-');
        if (vn) {
            items.push({ label: m._tab === 'card' ? 'Show Reply' : 'Report Card', disabled: !result || (!card && m._tab !== 'card'), action: () => { m.quickAction(m._tab === 'card' ? 'reply' : 'card'); after(); } });
            items.push({ label: 'Log', checked: !!m.peek, action: () => { m.togglePeek(); after(); ws.syncHistory(); } });
        }
        items.push({ label: 'Stop', disabled: !running(d), action: () => { d.abortTurn(); after(); } });
        // the desktop's Delete (its confirmation is the shell's WM message box)
        items.push({ label: 'Delete Session...', disabled: isDraft(d), action: () => { void d.deleteSession().then(after); } });
        items.push('-');
        items.push({ label: 'Attach File...', action: () => { if (d.directorAttachFileInput) d.directorAttachFileInput.click(); openComposer(); } });
        items.push({ label: 'Options', submenu: optionsItems });
        return items;
    }

    function sessionsMenu() {
        return [
            { label: 'New Session', action: () => { void newSession(); } },
            { label: 'Refresh', action: () => { void showSessions(); } },
            { label: 'Persona', submenu: personaItems }
        ];
    }

    // ---------------------------------------------------------------- app

    function mount(p) {
        page = p;
        page.classList.add('wm-director');
        page.innerHTML = `
            <div class="wmd-host"></div>
            <div class="wmd-status" hidden><img src="/static_images/app_icons/director.png" alt=""><span class="wmd-status-text"></span></div>
            <div class="wmd-sessions" hidden><div class="wmd-sessions-list" role="list"></div></div>`;
        // tap to advance: a tap on her scene (not on a control, a link, the text box's own parts or the composer)
        page.querySelector('.wmd-host').addEventListener('click', (e) => {
            if (composing) return;
            const t = e.target;
            if (!t.closest || t.closest('a, button, input, textarea, select, label, .dm-dialog-suggest, .dm-dialog-head, #directorComposer, .director-chat-messages-container, .dm-think')) return;
            if (!t.closest('.director-mascot-stage, .dm-vn-layer, #directorSessionChat')) return;
            advance();
        });
        page.querySelector('.wmd-sessions-list').addEventListener('click', (e) => {
            const row = e.target.closest('.wmd-session');
            if (row) void openSession(row.dataset.id);
        });
        // the composer's text decides the left soft key (Send while there is something to send)
        page.addEventListener('input', (e) => {
            if (e.target && e.target.id === 'directorChatInput' && isCurrent()) ws.refreshSoftKeys();
        });
        // the SIP button opens the composer (its edit box is not on screen until then)
        document.addEventListener('click', (e) => {
            if (!isCurrent() || composing || sub || !e.target.closest || !e.target.closest('#wmShell .wm-sip')) return;
            openComposer();
        }, true);
        page.addEventListener('focusin', (e) => {
            if (e.target && e.target.id === 'directorChatInput' && !composing) {
                composing = true;
                syncComposer();
                if (isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
            }
        });
    }

    function softKeys() {
        const d = dir();
        if (sub === 'sessions') {
            return { left: { label: 'Cancel', action: () => { closeSessions(); ws.syncHistory(); } }, right: { label: 'Menu', menu: sessionsMenu } };
        }
        if (composing || isDraft(d)) {
            const has = !!(d && ((d.directorChatInput && d.directorChatInput.value.trim()) || (d.pendingAttachments && d.pendingAttachments.length)));
            return {
                left: { label: 'Send', disabled: !has, action: () => { void send(); } },
                right: isDraft(d) && !composing ? { label: 'Menu', menu: mainMenu } : { label: 'Cancel', action: closeComposer }
            };
        }
        return { left: { label: 'Reply', disabled: !d, action: openComposer }, right: { label: 'Menu', menu: mainMenu } };
    }

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
        ws.registerApp({
            id: APP_ID,
            title: 'Director',
            // a Dreamscape app with its own icon (not ROM art): /static_images/wm61/app-director*.png
            icon: 'app-director',
            inStart: 'top',
            sip: true,
            mount,
            show(p) {
                page = p;
                shown = true;
                void attach();
            },
            hide() {
                shown = false;
                if (composing) { composing = false; syncComposer(); }
                const d = dir();
                if (d && d.directorChatInput) d.directorChatInput.blur();
                // she lets go of her sprite layers while the app is in the background
                if (d && d.mascot && patchedMascot === d.mascot) { d.mascot.applyView(); syncBlink(d.mascot); }
            },
            softKeys,
            historyDepth() {
                return (sub ? 1 : 0) + (composing && !isDraft() ? 1 : 0) + (peeking() ? 1 : 0);
            },
            onBack() {
                if (sub === 'sessions') { closeSessions(); return true; }
                if (peeking()) { dir().mascot.togglePeek(false); after(); return true; }
                if (composing && !isDraft()) { closeComposer(); return true; }
                return false;
            }
        });
        waitForDirector();
        // the soft keys follow the Director (a turn starts or ends, a chat opens)
        const refresh = () => { if (isCurrent()) { syncComposer(); ws.refreshSoftKeys(); if (sub === 'sessions') renderSessions(); } };
        if (window.wsClient && typeof window.wsClient.on === 'function') {
            ['director_computer_status', 'director_session_created', 'director_turn_complete', 'director_message_response'].forEach((t) => {
                try { window.wsClient.on(t, () => setTimeout(refresh, 50)); } catch (_) { /* no such event */ }
            });
        }
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
