/**
 * Melaton Mobile: Today screen widgets (Yozora #732, parent #709). Rows and blocks on WM 6.1's Today
 * screen through wmShell.registerTodayItem (wmShell.js): Settings > Today > Items lists them, their
 * Options... live there too. Today repaints every 2 s and on wmSettingsChange, so every widget here
 * reads cached data, asks the server at most every few minutes, and touches the DOM only when its
 * text or picture changed (no layout reads).
 *
 *   calendar        row (today-calendar): the next appointment, "10:30 AM Dentist", "Tomorrow 9:00
 *                   AM ...", "No upcoming appointments"; data wmCalendar.upcoming() (the desktop
 *                   Melaton Calendar's .ics files); tap opens Calendar
 *   director        block: a Director session's persona head (today-persona-<persona>, cut from the
 *                   mascot layers), its name, working / idle, the last print it made; option Session:
 *                   the last Director session, the last one in this workspace, or one persona's; tap
 *                   opens that session (openSessionInWindow). director-wren / -kabuki / -xi: the same
 *                   for one persona each, off by default. Data: director_computer_status, the
 *                   personas' session lists (director_get_sessions), director_session_image
 *   studio          block: the print in progress (live frame, step progress) or the last print with
 *                   its prompt (getImageMetadata), buttons Reroll (asks first, naming the cost) / Edit
 *                   / Ask Director (Yumiya or Chiyo) / View, tap-and-hold for Upscale, Expand Canvas,
 *                   Copy Prompt, Copy Picture; data wsClient.pendingRequests, image_generation_progress
 *                   and gallery_updated (pre handlers, read only), currentManualPreviewImage
 *   usage           row: prints in the last 24 h (the server ping's image_count, Studio's chip) and
 *                   Opus V5 usage (usageToolManager.getSnapshot()); tap opens Studio
 *   weather         block: the Weather app's selected place (wmWeather.current(): icon, temperature,
 *                   condition, place, high / low; repaint on wmWeatherChange); tap opens Weather
 *   notes           block: the newest note or one picked in Options..., its first 1 / 2 / 3 / 5
 *                   lines; tap opens that note or Notes (wmNotesApp.list / openNote, wsClient.getNote)
 *   files           block: My Documents (or Downloads, My Pictures, Scraps: Options...) with its item
 *                   count over the newest file's name and date; tap opens File Explorer there; the
 *                   6.5 panel adds a page per recent file and per phone volume
 *                   (wmFileExplorer.list / volumes / openFolder / openFile)
 *   ie              block: a search box with the Grimoire's and the web's (Bing) buttons, Enter =
 *                   the engine of Options...; under it the page IE shows, " (+X)" more windows, or
 *                   another device's last tab (browsingSessions.list, kept 3 minutes); the 6.5
 *                   panel: the page (New Window) | Resume session from <device> (Ignore) | Web
 *                   Search (Search Grimoire) | Favorites | History (Other Devices)
 *   favorites       block: programs picked from Start's list in Options... (Android programs too)
 *                   as a strip of icons; the 6.5 panel is the device's Favorites: a page each,
 *                   "Add/Remove", soft key Change (wmSettings.programItems, wmTodayFavorites)
 *   remote-desktop  row: the last computer (wmRemoteDesktop.lastComputer()); tap reconnects
 *   server          block: Details (state, host uptime, version, CPU, RAM, disk, workers) or One
 *                   line; server_status, get_system_info, sidebar_host_metrics (admin only, never sent
 *                   otherwise), remote_workers_status (Details, 15 min); tap opens Server Manager in IE
 * Accounts (balances incl. NovelAI Anlas) is wmAccounts.js's own block. Styles:
 * public/css/wm-today-widgets.css. Only on phones.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const ART = '/static_images/wm61/';
    const DIRECTOR_NAMES = { wren: 'Yumiya', kabuki: 'Chiyo', xi: 'Yozora' };
    const GEN_TYPES = new Set(['generate_image', 'generate_preset', 'reroll_image', 'upscale_image', 'expand_image', 'reroll_expanded_image', 'enhance_image', 'max_enhance_image', 'animate_image']);
    const SERVER_MS = 60 * 1000;
    const DISK_MS = 10 * 60 * 1000;
    const SESSIONS_MS = 5 * 60 * 1000;

    let sh = null;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const imgSrcset = (name) => `src="${ART}${name}.png" srcset="${ART}${name}.png 1x, ${ART}${name}@2x.png 2x, ${ART}${name}@4x.png 4x"`;
    const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };

    function ws() { return window.wsClient || null; }
    function online() {
        const c = ws();
        return !!(c && typeof c.isConnected === 'function' && c.isConnected() && c.initializationCompleted);
    }
    /** A read-only request; resolves to the reply's data or null (errors, no permission, offline). */
    async function ask(type, payload) {
        if (!online()) return null;
        try {
            const r = await ws().sendMessage(type, payload || {}, false);
            return (r && (r.data || r)) || null;
        } catch (_) { return null; }
    }
    /**
     * Admin-only packets (sidebar_host_metrics) are sent only for an
     * admin (the Sidebar's own check, vistaSidebar.js): a refusal comes back as an 'error' packet,
     * which ws/handlers/120-infrastructureInbound.js shows as "WebSocket server error: Admin access
     * required" whatever the caller does (showBanner=false only hides the ticker).
     */
    function isAdmin() {
        try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; }
    }
    const refused = (err) => /INSUFFICIENT_PERMISSIONS|Admin access required/i.test(String((err && (err.code || err.message)) || err));

    /**
     * An item switched off in Settings > Today > Items (wmTodayItems = [{ id, on }]); not listed = its
     * default. The shell marks off rows with .wm-today-off only after the first paint, so items that
     * ask the server check this first.
     */
    function itemOff(el, defaultOn) {
        if (el.classList.contains('wm-today-off')) return true;
        try {
            const list = JSON.parse(localStorage.getItem((sh && sh.todayItemsKey) || 'wmTodayItems') || 'null');
            const it = Array.isArray(list) ? list.find((x) => x && x.id === el.dataset.row) : null;
            return it ? it.on === false : defaultOn === false;
        } catch (_) { return defaultOn === false; }
    }

    function open(id) { try { sh.open(id); } catch (err) { console.warn('[wmTodayWidgets] open', id, err); } }

    /** A block's skeleton once; later paints only fill its parts. */
    function shell(el, cls, html, onTap) {
        if (el.dataset.wtwBuilt !== cls) {
            if (el.dataset.wtwBuilt) el.classList.remove(el.dataset.wtwBuilt);
            el.dataset.wtwBuilt = cls;
            el.classList.add('wtw', cls);
            el.innerHTML = html;
            if (onTap && !el.dataset.wtwTap) {
                el.dataset.wtwTap = '1';
                el.setAttribute('role', 'button');
                el.tabIndex = 0;
                el.addEventListener('click', (e) => { if (!e.target.closest('[data-wtw-own]')) onTap(e); });
            }
        }
        return el;
    }
    function setImg(img, src) {
        if (!img) return;
        if ((img.dataset.src || '') !== (src || '')) {
            img.dataset.src = src || '';
            if (src) img.src = src; else img.removeAttribute('src');
        }
        img.hidden = !src;
    }

    // ================================================================ Calendar

    const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    const fmtDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

    function dayWord(d) {
        const now = new Date();
        const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const days = Math.round((b - a) / 86400000);
        if (days <= 0) return '';
        if (days === 1) return 'Tomorrow';
        if (days < 7) return fmtDay.format(d);
        return fmtDate.format(d);
    }

    // recurrences are expanded over 14 days: once per 30 s, not per 2 s paint
    const calCache = { at: 0, list: null };
    function calendarText() {
        const c = window.wmCalendar;
        if (!c || typeof c.upcoming !== 'function') return '';
        if (calCache.list == null || Date.now() - calCache.at > 30000) { calCache.list = c.upcoming(1); calCache.at = calCache.list == null ? 0 : Date.now(); }
        const list = calCache.list;
        if (list == null) return '';
        if (!list.length) return 'No upcoming appointments';
        const o = list[0];
        const day = dayWord(o.start);
        const when = o.ev.allDay ? (day || 'Today') : `${day ? `${day} ` : ''}${fmtTime.format(o.start)}`;
        return `${when} ${o.ev.summary || '(No subject)'}`;
    }

    /** 6.5's Appointments panel: "No Appointments" over today - tomorrow, or an appointment a page. */
    function calendarTitanium() {
        const c = window.wmCalendar;
        if (!c || typeof c.upcoming !== 'function') return null;
        const list = c.upcoming(5);
        if (list == null) return null;
        const go = () => open('calendar');
        // the device's right soft key on this panel reads "Today" (it opens Calendar on today)
        const base = { label: 'calendar', softKey: { label: 'Today', action: go }, onTap: go };
        const short = new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
        if (!list.length) {
            const now = new Date();
            return { ...base, icon: 'ti-2252', pages: [{ title: 'No Appointments', line2: `${short.format(now)} - ${short.format(new Date(now.getTime() + 86400000))}` }] };
        }
        return {
            ...base, icon: 'ti-2255',
            pages: list.map((o) => {
                const day = dayWord(o.start) || short.format(o.start);
                return { title: o.ev.summary || '(No subject)', line2: o.ev.allDay ? `${day}: All day` : `${day}: ${fmtTime.format(o.start)}`, line3: o.ev.location || '' };
            })
        };
    }

    // ================================================================ Director

    /**
     * Sessions per persona (director_get_sessions { persona }: id, name, workspaceId, filename,
     * image_type, updated_at, running ...), kept fresh by our own asks (5 min, only for what an item
     * on screen needs), the app's own answers (director_get_sessions_response) and the print push
     * (director_session_image). Xi is asked only while it is enabled (its handler refuses otherwise,
     * and a refusal would show the websocket error banner).
     */
    const PERSONAS = ['wren', 'kabuki', 'xi'];
    const director = { asked: 0, status: null, lists: { wren: null, kabuki: null, xi: null }, at: { wren: 0, kabuki: 0, xi: 0 }, wired: false };
    const toTime = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : (Date.parse(v) || 0));

    function wireDirector() {
        const c = ws();
        if (director.wired || !c || typeof c.on !== 'function') return;
        director.wired = true;
        c.on('director_computer_status', (m) => { director.status = (m && (m.data || m)) || director.status; });
        // a session made a print: its picture on Today at once
        c.on('director_session_image', (m) => {
            const d = m && (m.data || m);
            if (!d || !d.chatId || !d.filename) return;
            for (const p of PERSONAS) {
                const s = director.lists[p] && director.lists[p].find((x) => String(x.id) === String(d.chatId));
                if (s) { s.filename = d.filename; s.image_type = ''; s.updated_at = new Date().toISOString(); }
            }
        });
        c.on('director_get_sessions_response', (m) => noteSessions(m));
    }

    function noteSessions(m, asked) {
        const r = m && (Array.isArray(m.sessions) ? m : m.data);
        if (!r || !Array.isArray(r.sessions)) return;
        const p = PERSONAS.includes(r.persona) ? r.persona : asked;
        if (!p) return;
        director.lists[p] = r.sessions.filter((s) => s && s.id && !s.archived);
        director.at[p] = Date.now();
    }

    function directorStatus() {
        const inst = window.directorInstance;
        const st = (inst && inst._status) || director.status;
        if (!st && online() && Date.now() - director.asked > 60000) {
            director.asked = Date.now();
            ask('director_computer_status').then((d) => { if (d && d.state) director.status = d; });
        }
        return st || null;
    }

    const xiEnabled = (st) => !!(st && st.xi && st.xi.enabled);

    /** Ask for a persona's sessions when ours are stale (never for a disabled Xi). */
    function wantList(p, st) {
        if (p === 'xi' && !xiEnabled(st)) return;
        if (!online() || Date.now() - director.at[p] < SESSIONS_MS) return;
        director.at[p] = Date.now();
        ask('director_get_sessions', { persona: p }).then((r) => noteSessions(r, p));
    }

    /** A persona's sessions: ours, else the Director's own list for its current persona. */
    function sessionsOf(p) {
        const inst = window.directorInstance;
        if (inst && inst.persona === p && Array.isArray(inst.directorSessions) && inst.directorSessions.length) return inst.directorSessions;
        return director.lists[p] || [];
    }

    const STATE_WORDS = { working: 'is working', idle: 'is idle', interrupted: 'was interrupted', failed: 'stopped with an error', offline: 'is offline' };

    /**
     * One persona's item model: its running session, else its newest one (optionally in this
     * workspace). { persona, id, name, running, words, file, at } or null.
     */
    function personaModel(p, st, wsOnly) {
        if (p === 'xi' && !xiEnabled(st)) return null;
        let list = sessionsOf(p);
        if (wsOnly) list = list.filter((s) => s.workspaceId && s.workspaceId === currentWorkspace());
        let running = false;
        let s = null;
        if (p === 'xi') {
            if (st.xi.running && st.xi.sessionId) {
                running = true;
                s = list.find((x) => String(x.id) === String(st.xi.sessionId)) || (wsOnly ? null : { id: st.xi.sessionId, name: st.xi.sessionName });
            }
        } else if (st.running && st.sessionId) {
            const tray = (st.sessions || []).find((x) => String(x.id) === String(st.sessionId));
            const mine = list.find((x) => String(x.id) === String(st.sessionId));
            const isKabuki = tray ? tray.memoryStore === 'obliterated' : (mine ? mine.memoryStore === 'obliterated' : false);
            if ((p === 'kabuki') === isKabuki && (mine || !wsOnly)) { running = true; s = mine || tray || { id: st.sessionId, name: st.sessionName }; }
        }
        if (!s) {
            s = list.slice().sort((a, b) => toTime(b.updated_at) - toTime(a.updated_at))[0] || null;
            // before our list arrives: the status tray's recent sessions (Wren / Chiyo only, no workspace)
            if (!s && !wsOnly && p !== 'xi') {
                s = (st.sessions || []).filter((x) => (x.memoryStore === 'obliterated') === (p === 'kabuki'))
                    .sort((a, b) => toTime(b.updated_at) - toTime(a.updated_at))[0] || null;
            }
        }
        if (!s) return null;
        let state = running ? 'working' : 'idle';
        if (!running && p !== 'xi' && st.last && String(st.last.sessionId) === String(s.id) && (st.last.state === 'failed' || st.last.state === 'interrupted')) state = st.last.state;
        const full = list.find((x) => String(x.id) === String(s.id)) || s;
        return {
            persona: p,
            id: String(s.id),
            name: s.name || '',
            running,
            words: `${DIRECTOR_NAMES[p]} ${STATE_WORDS[state]}`,
            file: full.filename ? { filename: full.filename, image_type: full.image_type || '' } : null,
            at: running ? Date.now() : toTime(s.updated_at)
        };
    }

    function currentWorkspace() {
        try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) return activeWorkspace; } catch (_) { /* not loaded */ } // eslint-disable-line no-undef
        return 'default';
    }

    /** show: 'last' | 'workspace' | a persona. */
    function directorModel(show) {
        wireDirector();
        const st = directorStatus();
        if (!st) return null;
        if (PERSONAS.includes(show)) {
            wantList(show, st);
            return personaModel(show, st, false);
        }
        const wsOnly = show === 'workspace';
        // 'last' finds the persona from the status; its picture (and 'workspace') needs the lists
        const models = PERSONAS.map((p) => { if (wsOnly) wantList(p, st); return personaModel(p, st, wsOnly); }).filter(Boolean);
        if (!models.length) return null;
        const best = models.find((m) => m.running) || models.sort((a, b) => b.at - a.at)[0];
        if (!best.file) wantList(best.persona, st);
        return best;
    }

    function directorPicture(file) {
        if (!file || !file.filename) return '';
        try {
            if (file.image_type === 'cache' || file.image_type === 'sessions') return typeof localCachePreviewUrl === 'function' ? localCachePreviewUrl(`${file.filename}.webp`) : ''; // eslint-disable-line no-undef
            const stem = file.filename.replace(/\.[^.]+$/, '');
            return typeof localGalleryPreviewUrl === 'function' ? localGalleryPreviewUrl(`${stem}.webp`) : `/previews/${encodeURIComponent(stem)}.webp`; // eslint-disable-line no-undef
        } catch (_) { return ''; }
    }

    /**
     * The Director app on that persona and session: director.js openSessionInWindow (wmDirector.js
     * routes it into the phone app), after setPersona when the item shows another persona.
     */
    async function openDirector(m) {
        // the phone Director's own open: her persona once she can be chosen, then THAT session's
        // messages (openSessionInWindow left it on her front page, or on Yumiya right after a load, #763)
        const app = window.wmDirectorApp;
        if (m && m.id && app && typeof app.openSession === 'function') {
            try { if (await app.openSession(m.persona, m.id)) return; } catch (err) { console.warn('[wmTodayWidgets] Director', err); }
        }
        const inst = window.directorInstance;
        if (!m || !inst || typeof inst.openSessionInWindow !== 'function') { open('director'); return; }
        try {
            if (inst.persona !== m.persona && typeof inst.setPersona === 'function') await sh.busy(() => inst.setPersona(m.persona), { paint: true });
            await inst.openSessionInWindow(m.id);
        } catch (err) {
            console.warn('[wmTodayWidgets] Director', err);
            open('director');
        }
    }

    /** A Director block: the main item (option show) or one persona's item. */
    function directorRenderer(fixedPersona) {
        let model = null;
        return function renderDirector(el, { option }) {
            // a persona's own item asks nothing while it is switched off in Settings
            if (fixedPersona && itemOff(el, false)) return false;
            const m = directorModel(fixedPersona || option('show') || 'last');
            model = m;
            if (!m) return false;
            if (!m.running && option('idle') === 'hide') return false;
            shell(el, 'wtw-director', `
                <img class="wtw-persona" alt="">
                <span class="wtw-lines"><span class="wtw-title"></span><span class="wtw-sub"></span></span>
                <img class="wtw-thumb" alt="" hidden>`, () => openDirector(model));
            const head = el.querySelector('.wtw-persona');
            if (head.dataset.persona !== m.persona) {
                head.outerHTML = `<img class="wtw-persona" data-persona="${m.persona}" ${imgSrcset(`today-persona-${m.persona}`)} alt="">`;
            }
            setText(el.querySelector('.wtw-title'), m.name || 'Untitled');
            setText(el.querySelector('.wtw-sub'), m.words);
            el.classList.toggle('is-working', m.running);
            const thumb = el.querySelector('.wtw-thumb');
            setImg(thumb, directorPicture(m.file));
            if (!thumb.dataset.wired) {
                thumb.dataset.wired = '1';
                thumb.addEventListener('error', () => { thumb.hidden = true; });
            }
            return true;
        };
    }

    /** "5 min ago", "3 h ago", "2 d ago": how long since a session was last used. */
    function agoText(at) {
        const ms = Date.now() - Number(at || 0);
        if (!at || !Number.isFinite(ms) || ms < 0) return '';
        const min = Math.round(ms / 60000);
        if (min < 1) return 'Just now';
        if (min < 60) return `${min} min ago`;
        const h = Math.round(min / 60);
        if (h < 24) return `${h} h ago`;
        return `${Math.round(h / 24)} d ago`;
    }

    /** New Session with that persona: the Director app in front, her selected, the desktop's own openNewSession. */
    async function newDirectorSession(p) {
        const inst = window.directorInstance;
        open('director');
        // the Director app's own New Session (its pages cleared, the composer up) once it is in front
        const app = window.wmDirectorApp;
        if (app && typeof app.newSessionWith === 'function') {
            try { await app.newSessionWith(p); return; } catch (err) { console.warn('[wmTodayWidgets] new session', err); }
        }
        if (!inst) return;
        try {
            if (inst.persona !== p && typeof inst.setPersona === 'function') await sh.busy(() => inst.setPersona(p), { paint: true });
            if (typeof inst.openNewSession === 'function') await sh.busy(() => inst.openNewSession(), { paint: true });
        } catch (err) { console.warn('[wmTodayWidgets] new session', err); }
    }

    /** A Director item's home screen panel (6.5): the session's picture, its name, who works on it. */
    function directorTitanium(fixedPersona) {
        return ({ option }) => {
            const first = directorModel(fixedPersona || option('show') || 'last');
            if (!first || (!first.running && option('idle') === 'hide')) return null;
            const page = (m) => {
                const go = () => openDirector(m);
                return { image: directorPicture(m.file) || '', title: m.name || 'Untitled', line2: m.words, softKey: { label: 'Director', action: go }, onTap: go };
            };
            const pages = [page(first)];
            // the main item: the last session, then a page per persona: her picture at the top
            // right, her name over how long ago she was last used and that session's name; the
            // soft key starts a new session with her, a tap opens the last one
            if (!fixedPersona) {
                PERSONAS.forEach((p) => {
                    const m = directorModel(p);
                    if (!m) return;
                    pages.push({
                        icon: `p:${p}`, title: DIRECTOR_NAMES[p],
                        line2: [m.running ? 'Working now' : agoText(m.at), m.name || 'Untitled'].filter(Boolean).join(' '),
                        softKey: { label: 'New Session', action: () => { void newDirectorSession(p); } },
                        onTap: () => openDirector(m)
                    });
                });
            }
            return { label: fixedPersona ? DIRECTOR_NAMES[fixedPersona].toLowerCase() : 'director', icon: 'x:app-director-lg', pages };
        };
    }

    // ================================================================ Studio

    let studioPanel = null; // what the Studio item shows, for its 6.5 panel
    const studio = { progress: null, latest: null, wired: false, frameKey: '', meta: { name: '', data: null, busy: false } };
    const ZW = /[​-‏⁠-⁤﻿]/g; // emphasis marks inside stored prompts

    function wireStudio() {
        if (studio.wired || typeof registerWsInboundHandler !== 'function') return; // eslint-disable-line no-undef
        studio.wired = true;
        // read only, before the generation handlers (phase 'only' stops wsClient.on for these)
        registerWsInboundHandler({ // eslint-disable-line no-undef
            id: 'wmTodayWidgets.progress',
            type: 'image_generation_progress',
            phase: 'pre',
            handler(message) {
                const d = message && message.data;
                if (!d) return;
                const prev = studio.progress && Date.now() - studio.progress.at < 120000 ? studio.progress : null;
                studio.progress = {
                    at: Date.now(),
                    phase: d.phase || '',
                    step: Number(d.currentStep) || (prev ? prev.step : 0),
                    steps: Number(d.totalSteps) || (prev ? prev.steps : 0),
                    frame: d.imageData ? `data:image/${d.imageFormat || 'webp'};base64,${d.imageData}` : (prev ? prev.frame : '')
                };
            }
        });
        registerWsInboundHandler({ // eslint-disable-line no-undef
            id: 'wmTodayWidgets.gallery',
            type: 'gallery_updated',
            phase: 'pre',
            handler(message) {
                const d = message && (message.data || message);
                if (!d || d.action !== 'append_top') return;
                const item = Array.isArray(d.newItems) && d.newItems[0];
                const filename = (item && (item.filename || item.original)) || d.latestFilename || '';
                if (filename) studio.latest = { item: item || null, filename, at: Date.now() };
            }
        });
    }

    function printing() {
        const c = ws();
        let n = 0;
        if (c && c.pendingRequests && typeof c.pendingRequests.forEach === 'function') {
            c.pendingRequests.forEach((r) => { if (r && GEN_TYPES.has(r.type)) n++; });
        }
        try { if (!n && typeof isGenerating !== 'undefined' && isGenerating) n = 1; } catch (_) { /* not loaded */ } // eslint-disable-line no-undef
        return n;
    }

    function galleryItems() {
        try {
            if (Array.isArray(window.originalAllImages) && window.originalAllImages.length) return window.originalAllImages;
            if (typeof allImages !== 'undefined' && Array.isArray(allImages)) return allImages; // eslint-disable-line no-undef
        } catch (_) { /* gallery not loaded */ }
        return [];
    }

    function lastPrint() {
        if (studio.latest) return studio.latest;
        const cur = window.currentManualPreviewImage;
        const curName = cur && (cur.filename || cur.original);
        if (curName) return { item: cur, filename: curName };
        const it = galleryItems()[0];
        return it ? { item: it, filename: it.filename || it.original } : null;
    }

    /** The gallery's own item for a print (width / height / upscaled for the desktop actions). */
    function printItem(p) {
        if (!p) return null;
        const full = galleryItems().find((it) => (it.filename || it.original) === p.filename);
        return full || p.item || { filename: p.filename, original: p.filename };
    }

    function printPicture(p) {
        if (!p) return '';
        try {
            if (p.item && typeof resolveGalleryPreviewUrl === 'function') { // eslint-disable-line no-undef
                const u = resolveGalleryPreviewUrl(p.item); // eslint-disable-line no-undef
                if (u) return u;
            }
            const stem = String(p.filename).replace(/\.[^.]+$/, '');
            return typeof localGalleryPreviewUrl === 'function' ? localGalleryPreviewUrl(`${stem}.webp`) : `/previews/${encodeURIComponent(stem)}.webp`; // eslint-disable-line no-undef
        } catch (_) { return ''; }
    }

    /** The print's metadata (getImageMetadata: the Studio preview, the IndexedDB cache, then the server), once per print. */
    function printMeta(name) {
        if (!name) return null;
        if (studio.meta.name !== name) { studio.meta = { name, data: null, busy: false }; }
        const m = studio.meta;
        if (!m.data && !m.busy && typeof getImageMetadata === 'function' && online()) { // eslint-disable-line no-undef
            m.busy = true;
            Promise.resolve(getImageMetadata(name)).then((d) => { if (studio.meta === m) m.data = d || {}; }).catch(() => { if (studio.meta === m) m.data = {}; }) // eslint-disable-line no-undef
                .finally(() => { m.busy = false; });
        }
        return m.data;
    }

    const promptOf = (meta) => String((meta && (meta.input_prompt || meta.prompt)) || '');

    function studioPrompt() {
        const t = document.getElementById('manualPrompt');
        return t && typeof t.value === 'string' ? t.value : '';
    }

    const PHASE_WORDS = { queued: 'Waiting in the queue...', upscaling: 'Upscaling...', thinking: 'Thinking...', reviewing: 'Reviewing...', tool_execution: 'Preparing...', stage_delay: 'Waiting...', previews: 'Finishing...' };
    const fnOf = (name) => (typeof window[name] === 'function' ? window[name] : null);

    function isOpus() {
        const sub = window.optionsData && window.optionsData.user && window.optionsData.user.subscription;
        return !!(sub && Number(sub.tier) === 3 && sub.active !== false);
    }

    /**
     * Reroll (the desktop's rerollImage, galleryActions.js). It spends Anlas, so a WM question names
     * the cost first (calculateCreditCost on the print's metadata, as Studio prices it). An upscaled,
     * large or wallpaper print gets the desktop's own question instead (rerollImage asks for those,
     * restyled as WM boxes by wmDialogs.js), so it is not asked twice.
     */
    async function rerollPrint(p) {
        const reroll = fnOf('rerollImage');
        const item = printItem(p);
        if (!reroll || !item) return;
        const desktopAsks = !!item.upscaled || /_upscaled|large_|wallpaper_/.test(p.filename);
        if (!desktopAsks) {
            let meta = null;
            try { meta = await sh.busy(() => getImageMetadata(p.filename), { paint: true }); } catch (_) { meta = null; } // eslint-disable-line no-undef
            let cost = null;
            try { cost = meta && typeof calculateCreditCost === 'function' ? calculateCreditCost(meta) : null; } catch (_) { cost = null; } // eslint-disable-line no-undef
            let text;
            if (cost != null) {
                const c = typeof cost === 'number' ? { list: cost, opus: cost, isFree: cost === 0 } : cost;
                const n = c.isFree ? 0 : Number(isOpus() && Number.isFinite(Number(c.opus)) ? c.opus : c.list) || 0;
                text = n > 0
                    ? `Reroll this picture? This will cost ${n.toLocaleString()} Anlas.`
                    : `Reroll this picture? It costs no Anlas${c.usageLimited || (c.metadata && c.metadata.usageLimited) ? ' (it uses Opus V5 usage)' : ''}.`;
            } else {
                text = 'Reroll this picture? Its cost could not be worked out; it may cost Anlas.';
            }
            const yes = await sh.messageBox({ title: 'Reroll', icon: 'question', text, buttons: [{ text: 'Reroll', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false });
            if (yes !== true) return;
        }
        try { await reroll(item); } catch (err) { console.warn('[wmTodayWidgets] reroll', err); }
    }

    /** Upscale: the desktop's upscaleImage, whose cost form is the WM one (wmDialogs.js wrapCreditCost). */
    function upscalePrint(p) {
        const up = fnOf('upscaleImage');
        const item = printItem(p);
        if (up && item && !item.upscaled) { try { up(item); } catch (err) { console.warn('[wmTodayWidgets] upscale', err); } }
    }

    function editPrint(p) {
        const openStudio = fnOf('openManualModalWithContent');
        const item = printItem(p);
        if (!openStudio || !item) { open('studio'); return; }
        // wmStudio.js wraps it: the Studio app opens on the print's prompt
        Promise.resolve(openStudio({ type: 'image', image: item, metadata: null })).catch((err) => console.warn('[wmTodayWidgets] edit', err));
    }

    function viewPrint(p) {
        if (!p) return;
        open('gallery');
        try { if (typeof showLightbox === 'function') showLightbox({ filename: p.filename }); } catch (_) { /* the gallery without the viewer */ } // eslint-disable-line no-undef
    }

    const baseName = (f) => String(f || '').replace(/\\/g, '/').split('/').pop();

    /**
     * Ask Director: WM asks who. Yumiya = the desktop's askWrenAboutImage (wmDirector.js routes it into
     * the phone app). Chiyo has no desktop equivalent (director.js only has the Wren route): her
     * persona, then the picture on the message being written (wmDirectorApp.attach, Explorer's route).
     */
    async function askDirector(p) {
        if (!p) return;
        const who = await sh.messageBox({
            title: 'Ask Director', icon: 'question', text: 'Who should look at this picture?',
            buttons: [{ text: 'Yumiya', value: 'wren', default: true }, { text: 'Chiyo', value: 'kabuki' }, { text: 'Cancel', value: false }], cancelValue: false
        });
        const name = baseName(p.filename);
        if (who === 'wren') {
            const askWren = fnOf('askWrenAboutImage');
            if (askWren) askWren(name); else open('director');
            return;
        }
        if (who !== 'kabuki') return;
        const d = window.directorInstance;
        const app = window.wmDirectorApp;
        if (!d || !app || typeof app.attach !== 'function') { open('director'); return; }
        try {
            if (d.persona !== 'kabuki') await sh.busy(() => d.setPersona('kabuki'), { paint: true });
            await app.attach([{ source: 'workspace', filename: name, name }]);
        } catch (err) { console.warn('[wmTodayWidgets] ask Chiyo', err); open('director'); }
    }

    async function copyPrompt(p) {
        let meta = null;
        try { meta = await sh.busy(() => getImageMetadata(p.filename), { paint: true }); } catch (_) { meta = null; } // eslint-disable-line no-undef
        const text = promptOf(meta);
        if (!text) { sh.messageBox({ title: 'Copy Prompt', icon: 'info', text: 'This picture has no prompt.' }); return; }
        try {
            if (typeof copyTextToClipboard === 'function') await copyTextToClipboard(text); // eslint-disable-line no-undef
            else await navigator.clipboard.writeText(text);
        } catch (_) {
            sh.messageBox({ title: 'Copy Prompt', icon: 'error', text: 'The prompt could not be copied.' });
        }
    }

    /** Tap-and-hold on the Studio item: the rest of the picture's operations. */
    function studioMenu(p) {
        const item = printItem(p);
        return [
            { label: 'View', disabled: !p, action: () => viewPrint(p) },
            { label: 'Edit in Studio', disabled: !p, action: () => editPrint(p) },
            '-',
            { label: 'Reroll...', disabled: !p || !fnOf('rerollImage'), action: () => rerollPrint(p) },
            { label: 'Upscale...', disabled: !p || !item || !!item.upscaled || !fnOf('upscaleImage'), action: () => upscalePrint(p) },
            { label: 'Expand Canvas', disabled: !p || !fnOf('openImageExpansionModal'), action: () => { try { window.openImageExpansionModal(item.upscaled || item.original || item.filename); } catch (err) { console.warn('[wmTodayWidgets] expand', err); } } },
            '-',
            { label: 'Ask Director...', disabled: !p, action: () => askDirector(p) },
            '-',
            { label: 'Copy Prompt', disabled: !p, action: () => copyPrompt(p) },
            { label: 'Copy Picture', disabled: !p || !fnOf('copyImageToClipboard'), action: () => { try { window.copyImageToClipboard(item); } catch (err) { console.warn('[wmTodayWidgets] copy', err); } } },
            '-',
            { label: 'Open Studio', action: () => open('studio') }
        ];
    }

    let studioShown = null; // the print the buttons act on
    /**
     * Studio's home screen panel (6.5): the last print (its time under it; tap views it in Pictures,
     * Edit opens it in Studio), then usage (prints in 24 h, V5 usage, Anlas; tap opens Accounts on
     * Status), then References and the Spellbook. Daily Usage is not an item of its own in 6.5.
     */
    function studioTitanium() {
        const s = studioPanel;
        const go = () => open('studio');
        const key = { label: 'Studio', action: go };
        const pages = [];
        if (s) {
            // "Last print, 12:37 AM" reads as the title over the time; while it prints, the state over the prompt
            const cut = s.printing ? -1 : s.title.indexOf(', ');
            pages.push({
                image: s.picture || '',
                title: cut > 0 ? s.title.slice(0, cut) : s.title,
                line2: cut > 0 ? s.title.slice(cut + 2) : s.prompt,
                softKey: s.last ? { label: 'Edit', action: () => editPrint(s.last) } : key,
                onTap: () => (s.last ? viewPrint(s.last) : go())
            });
        }
        const use = usageText().split(', ').filter(Boolean);
        let anlas = '';
        try { const b = window.optionsData && window.optionsData.balance && Number(window.optionsData.balance.totalCredits); if (Number.isFinite(b) && b >= 0) anlas = `${b.toLocaleString()} Anlas`; } catch (_) { anlas = ''; }
        if (use.length || anlas) {
            const acc = () => { const a = window.wmAccounts; if (a && typeof a.open === 'function') a.open('status'); else open('accounts'); };
            const lines = use.concat(anlas ? [anlas] : []);
            pages.push({ title: lines[0], line2: lines[1] || '', line3: lines[2] || '', softKey: key, onTap: acc });
        }
        pages.push({ icon: 'x:app-reference-lg', title: 'References', softKey: { label: 'Open', action: () => open('reference') }, onTap: () => open('reference') });
        pages.push({ icon: 'x:app-spellbook-lg', title: 'Spellbook', softKey: { label: 'Open', action: () => open('spellbook') }, onTap: () => open('spellbook') });
        return { label: 'studio', icon: 'x:app-studio-lg', pages, softKey: key, onTap: go };
    }

    function renderStudio(el) {
        wireStudio();
        const n = printing();
        const last = lastPrint();
        studioShown = last;
        if (!n && !last) { studioPanel = null; return false; }
        if (el.dataset.wtwBuilt !== 'wtw-studio') {
            shell(el, 'wtw-studio', `
                <span class="wtw-studio-top">
                    <span class="wtw-thumb-box"><img class="wtw-thumb" alt=""></span>
                    <span class="wtw-lines">
                        <span class="wtw-title"></span>
                        <span class="wtw-bar" hidden><span class="wtw-bar-fill"></span></span>
                        <span class="wtw-sub"></span>
                    </span>
                </span>
                <span class="wtw-actions" data-wtw-own>
                    <button type="button" data-act="reroll">Reroll</button><button type="button" data-act="edit">Edit</button><button type="button" data-act="ask">Ask Director</button><button type="button" data-act="view">View</button>
                </span>`, () => open('studio'));
            el.querySelector('.wtw-actions').addEventListener('click', (e) => {
                const b = e.target.closest('button[data-act]');
                if (!b || b.disabled) return;
                const p = studioShown;
                ({ reroll: rerollPrint, edit: editPrint, ask: askDirector, view: viewPrint })[b.dataset.act](p);
            });
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                sh.menuAt(e.clientX, e.clientY, studioMenu(studioShown));
            });
        }
        const p = n && studio.progress && Date.now() - studio.progress.at < 120000 ? studio.progress : null;
        let title = 'Last print';
        let pct = -1;
        if (n) {
            title = n > 1 ? `Printing ${n} pictures...` : 'Printing...';
            if (p && p.steps > 0 && p.step > 0 && (!p.phase || p.phase === 'generating' || p.phase === 'streaming')) {
                title = `Printing... step ${Math.min(p.step, p.steps)} of ${p.steps}`;
                pct = Math.round((100 * Math.min(p.step, p.steps)) / p.steps);
            } else if (p && PHASE_WORDS[p.phase]) {
                title = PHASE_WORDS[p.phase];
            }
        } else if (last) {
            const t = last.at || (last.item && Number(last.item.mtime)) || 0;
            if (t) {
                const d = new Date(t < 1e12 ? t * 1000 : t);
                title = `Last print, ${d.toDateString() === new Date().toDateString() ? fmtTime.format(d) : fmtDate.format(d)}`;
            }
        }
        // the prompt: Studio's while it prints, else the last print's own (its metadata)
        const prompt = (n ? studioPrompt() : promptOf(printMeta(last && last.filename))).replace(ZW, '').replace(/\s+/g, ' ').trim().slice(0, 200);
        studioPanel = { title, prompt, picture: p && p.frame ? p.frame : printPicture(last), last, printing: !!n };
        setText(el.querySelector('.wtw-title'), title);
        const sub = el.querySelector('.wtw-sub');
        setText(sub, prompt);
        sub.hidden = !prompt;
        const bar = el.querySelector('.wtw-bar');
        bar.hidden = pct < 0;
        if (pct >= 0) {
            const fill = el.querySelector('.wtw-bar-fill');
            const w = `${pct}%`;
            if (fill.style.width !== w) fill.style.width = w;
        }
        el.classList.toggle('is-printing', !!n);
        const acts = el.querySelector('.wtw-actions');
        acts.hidden = !last;
        const item = last ? printItem(last) : null;
        acts.querySelector('[data-act="reroll"]').disabled = !fnOf('rerollImage');
        acts.querySelector('[data-act="edit"]').disabled = !fnOf('openManualModalWithContent') || !item;
        // the live frame while printing (when the server sends frames), else the last print
        const frame = p && p.frame ? p.frame : '';
        const img = el.querySelector('.wtw-thumb');
        if (!img.dataset.wired) {
            img.dataset.wired = '1';
            img.addEventListener('error', () => {
                // the preview webp is written a moment after the print: Studio's own preview (#648)
                const name = img.dataset.file || '';
                const alt = name && typeof localStudioPreviewUrl === 'function' ? localStudioPreviewUrl(name) : ''; // eslint-disable-line no-undef
                if (alt && img.dataset.src !== alt) { img.dataset.src = alt; img.src = alt; } else img.hidden = true;
            });
        }
        if (frame) {
            const key = frame.length + frame.slice(-24);
            if (studio.frameKey !== key) { studio.frameKey = key; setImg(img, frame); }
        } else {
            img.dataset.file = last ? last.filename : '';
            setImg(img, printPicture(last));
        }
        el.querySelector('.wtw-thumb-box').classList.toggle('is-empty', img.hidden);
        return true;
    }

    // ================================================================ Daily usage

    // getSnapshot reads Studio's controls: once per 10 s
    const usageCache = { at: 0, text: '' };
    function usageText() {
        if (Date.now() - usageCache.at < 10000) return usageCache.text;
        usageCache.at = Date.now();
        usageCache.text = usageLine();
        return usageCache.text;
    }

    function usageTitanium() {
        const parts = usageText().split(', ').filter(Boolean);
        if (!parts.length) return null;
        const go = () => open('studio');
        return { label: 'daily usage', icon: 'x:app-studio-lg', pages: [{ title: parts[0], line2: parts.slice(1).join(', ') }], softKey: { label: 'Studio', action: go }, onTap: go };
    }

    function usageLine() {
        const parts = [];
        let count = null;
        try { if (typeof imageCount !== 'undefined' && Number.isFinite(Number(imageCount))) count = Number(imageCount); } catch (_) { count = null; } // eslint-disable-line no-undef
        if (count != null) parts.push(`${count.toLocaleString()} ${count === 1 ? 'print' : 'prints'} in 24 h`);
        let snap = null;
        try { snap = window.usageToolManager && typeof window.usageToolManager.getSnapshot === 'function' ? window.usageToolManager.getSnapshot() : (typeof usageToolManager !== 'undefined' ? usageToolManager.getSnapshot() : null); } catch (_) { snap = null; } // eslint-disable-line no-undef
        if (snap && snap.isOpus && snap.usage) {
            parts.push(`V5 ${snap.compactLabel}${snap.extended ? ' extra' : ''}`);
        }
        return parts.join(', ');
    }

    // ================================================================ Weather

    /**
     * The Weather app's selected place (wmWeather.js current(): cheap, starts its own quiet update when
     * stale, works for every account); Today repaints on 'wmWeatherChange'; tap opens Weather.
     */
    const deg = (v) => (v == null || !Number.isFinite(Number(v)) ? '' : `${v}°`);

    function weatherTitanium() {
        const W = window.wmWeather;
        const w = W && typeof W.current === 'function' ? W.current() : null;
        if (!w) return null;
        const go = () => open('weather');
        // the condition is the panel's picture, at the top right as on 6.5's panels
        return {
            label: 'weather', icon: w.icon ? `w:${w.icon}` : 'x:app-weather-lg',
            pages: [{
                title: `${deg(w.temp)}${w.unit || ''} ${w.condition || ''}`.trim(),
                line2: [w.place, w.region].filter(Boolean).join(', '),
                line3: w.hi != null && w.lo != null ? `${deg(w.hi)} / ${deg(w.lo)}` : ''
            }],
            softKey: { label: 'Weather', action: go }, onTap: go
        };
    }

    /** Weather's panel with the forecast on the pages left and right of now: a day a page. */
    function weatherTitaniumPages() {
        const p = weatherTitanium();
        if (!p) return null;
        const W = window.wmWeather;
        const days = W && typeof W.forecast === 'function' ? W.forecast() : [];
        const u = (W && typeof W.unit === 'function' && W.unit()) || '';
        days.forEach((d) => {
            p.pages.push({
                icon: d.icon ? `w:${d.icon}` : '',
                title: `${d.day}: ${d.condition || ''}`.replace(/: $/, ''),
                line2: d.hi != null && d.lo != null ? `${deg(d.hi)}${u} / ${deg(d.lo)}${u}` : '',
                line3: d.rain != null ? `Rain ${Math.round(d.rain)}%` : ''
            });
        });
        return p;
    }

    let weatherEl = null;
    function renderWeather(el) {
        weatherEl = el;
        const W = window.wmWeather;
        const w = W && typeof W.current === 'function' ? W.current() : null;
        if (!w) return false;
        shell(el, 'wtw-weather', `
            <img class="wtw-sky" alt="">
            <span class="wtw-lines"><span class="wtw-title"></span><span class="wtw-sub"></span></span>
            <span class="wtw-hilo"></span>`, () => open('weather'));
        const img = el.querySelector('.wtw-sky');
        if (img.dataset.src !== w.iconUrl) {
            img.dataset.src = w.iconUrl;
            img.src = w.iconUrl;
            img.srcset = w.iconUrl2x ? `${w.iconUrl} 1x, ${w.iconUrl2x} 2x` : '';
        }
        setText(el.querySelector('.wtw-title'), `${deg(w.temp)}${w.unit || ''} ${w.condition || ''}`.trim());
        setText(el.querySelector('.wtw-sub'), [w.place, w.region].filter(Boolean).join(', '));
        setText(el.querySelector('.wtw-hilo'), w.hi != null && w.lo != null ? `${deg(w.hi)} / ${deg(w.lo)}` : '');
        return true;
    }

    // ================================================================ Notes

    /**
     * Notes item: the newest note of the workspace or one picked in Options... (its choices are the
     * workspace's notes: this options array is the one Settings reads, so its 'note' choices are
     * refilled in place whenever the list changes), its first lines, tap opens that note or Notes.
     * Note text: wsClient.getNote (only for notes in the list just read; once per change).
     */
    const NOTE_PICK = { key: 'note', label: 'Note', value: 'newest', choices: [['newest', 'Newest note']] };
    const NOTES_OPTIONS = [
        NOTE_PICK,
        { key: 'lines', label: 'Preview lines', value: '1', choices: [['1', '1'], ['2', '2'], ['3', '3'], ['5', '5']] },
        { key: 'tap', label: 'Tapping the item', value: 'note', choices: [['note', 'Opens the note'], ['app', 'Opens Notes']] }
    ];
    const notes = { listKey: '', body: { key: '', text: null, busy: false } };

    /** The stored pick even before the note list (and so the choice) has loaded. */
    function storedNotePick() {
        try {
            const all = JSON.parse(localStorage.getItem((sh && sh.todayOptionsKey) || 'wmTodayOptions') || 'null');
            const v = all && all.notes && all.notes.note;
            return typeof v === 'string' && v ? v : 'newest';
        } catch (_) { return 'newest'; }
    }

    function noteBody(n) {
        const key = `${n.noteId}|${n.modifiedAt}`;
        const b = notes.body;
        if (b.key !== key) notes.body = { key, text: null, busy: false };
        const cur = notes.body;
        const c = ws();
        if (cur.text == null && !cur.busy && online() && typeof c.getNote === 'function') {
            cur.busy = true;
            c.getNote(n.noteId).then((res) => {
                const note = res && (res.note || (res.data && res.data.note));
                if (notes.body === cur) cur.text = String((note && note.content) || '');
            }).catch(() => { if (notes.body === cur) cur.text = ''; }).finally(() => { cur.busy = false; });
        }
        return cur.text;
    }

    function previewOf(n, text) {
        if (!text) return '';
        const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
        // WM names a note after its first line: the preview starts after it
        if (lines.length && lines[0] === String(n.name || '').trim()) lines.shift();
        return lines.join('\n');
    }

    let notesShown = null;
    let notesPanel = null; // what the Notes item shows, for its 6.5 panel
    function notesTitanium() {
        const s = notesPanel;
        if (!s) return null;
        const lines = String(s.text || '').split(/\n+/).map((t) => t.trim()).filter(Boolean);
        return { label: 'notes', icon: 's:notes', pages: [{ title: s.title, line2: lines[0] || '', line3: lines[1] || '' }], softKey: { label: 'Notes', action: () => open('notes') }, onTap: s.tap };
    }

    function renderNotes(el, { option }) {
        if (itemOff(el, false)) return false;
        const app = window.wmNotesApp;
        if (!app || typeof app.list !== 'function') return false;
        const list = app.list();
        if (list == null) return false;
        // the picker's choices follow the workspace's notes (newest first)
        const sorted = list.slice().sort((a, b) => (Number(b.modifiedAt) || 0) - (Number(a.modifiedAt) || 0));
        const key = sorted.map((x) => `${x.noteId}:${x.name}`).join('|');
        if (key !== notes.listKey) {
            notes.listKey = key;
            NOTE_PICK.choices.splice(0, NOTE_PICK.choices.length, ['newest', 'Newest note'], ...sorted.map((x) => [String(x.noteId), x.name]));
        }
        const pick = option('note') !== 'newest' ? option('note') : storedNotePick();
        const n = (pick !== 'newest' && sorted.find((x) => String(x.noteId) === pick)) || sorted[0] || null;
        notesShown = n;
        shell(el, 'wtw-notes', `
            <img class="wtw-notes-icon" ${imgSrcset('app-notes')} alt="">
            <span class="wtw-lines"><span class="wtw-title"></span><span class="wtw-preview"></span></span>`, () => {
            const cur = notesShown;
            if (cur && option('tap') !== 'app' && typeof app.openNote === 'function') app.openNote(cur.noteId, cur.workspaceId, cur.name);
            else open('notes');
        });
        setText(el.querySelector('.wtw-title'), n ? n.name : 'No notes');
        const lines = Number(option('lines')) || 1;
        const pv = el.querySelector('.wtw-preview');
        const text = n ? previewOf(n, noteBody(n)) : '';
        notesPanel = { title: n ? n.name : 'No notes', text, tap: () => el.click() };
        setText(pv, text);
        pv.hidden = !text;
        if (pv.style.getPropertyValue('--wtw-lines') !== String(lines)) pv.style.setProperty('--wtw-lines', String(lines));
        return true;
    }

    // ================================================================ Remote Desktop

    function remoteText() {
        const r = window.wmRemoteDesktop;
        if (!r || typeof r.lastComputer !== 'function') return '';
        const live = typeof r.sessionName === 'function' ? r.sessionName() : '';
        if (live) return `Connected to ${live}`;
        const last = r.lastComputer();
        return last ? `Connect to ${last}` : '';
    }

    function remoteTitanium() {
        const text = remoteText();
        if (!text) return null;
        const go = () => { const r = window.wmRemoteDesktop; if (r && typeof r.reconnectLast === 'function') void r.reconnectLast(); else open('remote-desktop-mobile'); };
        return { label: 'remote desktop', icon: 'x:app-remote-desktop-mobile-lg', pages: [{ title: text }], softKey: { label: 'Connect', action: go }, onTap: go };
    }

    // ================================================================ Server status

    /**
     * server_status (ready / stage), get_system_info (version, git hash, host: CPU model and cores,
     * memory, OS boot time; disk; the server caches it about hourly), sidebar_host_metrics (CPU / RAM
     * load, admin only), remote_workers_status (Data Management's worker checks: they probe every
     * worker, so only for Detailed, every 15 minutes). No packet counts connected clients.
     */
    const server = { at: 0, infoAt: 0, workersAt: 0, ready: null, stage: '', info: null, load: null, loadDenied: false, workers: null, busy: false };
    const WORKERS_MS = 15 * 60 * 1000;

    function loadServer(detailed) {
        if (server.busy || !online()) return;
        const now = Date.now();
        if (now - server.at < SERVER_MS) return;
        server.busy = true;
        server.at = now;
        const jobs = [
            ask('server_status').then((d) => { if (d && typeof d.isReady === 'boolean') { server.ready = d.isReady; server.stage = d.stage || ''; } })
        ];
        if (!server.loadDenied && isAdmin()) {
            jobs.push(ws().sendMessage('sidebar_host_metrics', {}, false).then((r) => {
                const d = r && (r.data || r);
                if (d && Number.isFinite(Number(d.cpu))) server.load = { cpu: Number(d.cpu), ram: Number(d.ram) };
            }).catch((err) => { if (refused(err)) server.loadDenied = true; server.load = null; }));
        }
        if (now - server.infoAt > DISK_MS) {
            server.infoAt = now;
            jobs.push(ask('get_system_info').then((d) => { if (d && (d.disk || d.host)) server.info = d; }));
        }
        if (detailed && now - server.workersAt > WORKERS_MS) {
            server.workersAt = now;
            jobs.push(ask('remote_workers_status').then((d) => { if (d && Array.isArray(d.workers)) server.workers = d.workers; }));
        }
        Promise.all(jobs).finally(() => { server.busy = false; });
    }

    /** "177.13 GB" / "1.2 TB" (get_system_info's formatted sizes) in GB. */
    function gb(text) {
        const m = /([\d.]+)\s*([KMGT]?B)/i.exec(String(text || ''));
        if (!m) return null;
        const f = { B: 1 / 1073741824, KB: 1 / 1048576, MB: 1 / 1024, GB: 1, TB: 1024 }[m[2].toUpperCase()];
        return f ? Number(m[1]) * f : null;
    }
    const gbText = (n) => (n == null ? '' : n >= 1024 ? `${(n / 1024).toFixed(1)} TB` : `${n >= 100 ? Math.round(n) : n.toFixed(1)} GB`);

    function uptimeText(iso) {
        const t = Date.parse(iso || '');
        if (!t) return '';
        const min = Math.max(0, Math.floor((Date.now() - t) / 60000));
        const d = Math.floor(min / 1440);
        const h = Math.floor((min % 1440) / 60);
        return d ? `${d} d ${h} h` : h ? `${h} h ${min % 60} min` : `${min} min`;
    }

    /** { state: 'OK' | 'busy' | 'starting' | 'down', head, lines[] } or null before any answer. */
    function serverModel(detailed) {
        const c = ws();
        if (!c) return null;
        if (!c.isConnected()) return { state: 'down', head: 'Server not reachable', lines: [] };
        loadServer(detailed);
        if (server.ready === false) return { state: 'starting', head: `Server starting${server.stage ? `: ${server.stage}` : '...'}`, lines: [] };
        const info = server.info || {};
        if (server.ready == null && !server.load && !info.disk) return null;
        const l = server.load;
        const free = gb(info.disk && info.disk.free);
        const total = gb(info.disk && info.disk.total);
        const low = free != null && total ? free / total < 0.1 : false;
        const busy = (l && (l.cpu >= 90 || l.ram >= 90)) || low;
        const host = info.host || {};
        const lines = [];
        const hash = info.gitHash ? String(info.gitHash).slice(0, 8) : '';
        const ver = info.packageVersion ? `Version ${info.packageVersion}${hash ? ` (${hash})` : ''}` : (hash ? `Build ${hash}` : '');
        if (ver) lines.push(ver);
        const cores = host.cpuCores ? `${host.cpuCores} cores` : '';
        if (l || host.cpuModel) lines.push(`CPU ${l ? `${Math.round(l.cpu)}%` : ''}${l && (host.cpuModel || cores) ? ', ' : ''}${[host.cpuModel, cores].filter(Boolean).join(', ')}`.replace(/\s+/g, ' ').trim());
        const ramGb = Number(host.totalMemBytes) > 0 ? Number(host.totalMemBytes) / 1073741824 : gb(info.ram);
        if (l || ramGb) lines.push(`RAM ${l ? `${Math.round(l.ram)}%` : ''}${l && ramGb ? ' of ' : ''}${ramGb ? gbText(ramGb) : ''}`.trim());
        if (free != null) lines.push(`Disk ${gbText(free)} free${total ? ` of ${gbText(total)}` : ''}`);
        const ws_ = (server.workers || []).filter((w) => w && w.status !== 'unconfigured');
        if (ws_.length) {
            const ok = ws_.filter((w) => w.status === 'healthy').length;
            const bad = ws_.filter((w) => w.status !== 'healthy').map((w) => `${w.name || w.id} ${w.status}`);
            lines.push(`Workers ${ok} of ${ws_.length} healthy${bad.length ? ` (${bad.join(', ')})` : ''}`);
        }
        // compact: the load, and the disk only when it runs low (or no load figures): one 360 px line
        const parts = [];
        if (l) parts.push(`CPU ${Math.round(l.cpu)}%`, `RAM ${Math.round(l.ram)}%`);
        if (free != null && (low || !l)) parts.push(`${gbText(free)} free`);
        return {
            state: busy ? 'busy' : 'OK',
            head: `Server ${busy ? 'busy' : 'OK'}`,
            compact: `Server ${busy ? 'busy' : 'OK'}${parts.length ? `: ${parts.join(', ')}` : ''}`,
            uptime: uptimeText(host.bootedAt),
            lines
        };
    }

    /** The server's panel: its state, then its facts two to a page. */
    function serverTitanium({ option }) {
        const m = serverModel(option('view') !== 'compact');
        if (!m) return null;
        const pages = [{ title: m.head, line2: m.uptime ? `up ${m.uptime}` : '' }];
        for (let i = 0; i < m.lines.length; i += 2) pages.push({ title: m.head, line2: m.lines[i], line3: m.lines[i + 1] || '' });
        return { label: 'server status', icon: 'x:app-data-management-lg', pages, softKey: { label: 'Manage', action: openServerManager }, onTap: openServerManager };
    }

    function renderServer(el, { option }) {
        if (itemOff(el, false)) return false;
        const detailed = option('view') !== 'compact';
        const m = serverModel(detailed);
        if (!m) return false;
        if (!detailed || !m.lines.length) {
            // one row, drawn like the shell's rows (icon + bold line)
            shell(el, 'wtw-rowlike', `<img ${imgSrcset('app-data-management')} alt=""><span class="wtw-title"></span>`, openServerManager);
            setText(el.querySelector('.wtw-title'), m.compact || m.head);
            return true;
        }
        shell(el, 'wtw-server', `
            <img class="wtw-server-icon" ${imgSrcset('app-data-management-lg')} alt="">
            <span class="wtw-lines">
                <span class="wtw-server-head"><span class="wtw-title"></span><span class="wtw-uptime"></span></span>
                <span class="wtw-server-lines"></span>
            </span>`, openServerManager);
        setText(el.querySelector('.wtw-title'), m.head);
        setText(el.querySelector('.wtw-uptime'), m.uptime ? `up ${m.uptime}` : '');
        const box = el.querySelector('.wtw-server-lines');
        const html = m.lines.map((t) => `<span>${esc(t)}</span>`).join('');
        if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
        el.classList.toggle('is-busy', m.state === 'busy');
        return true;
    }

    function openServerManager() {
        try {
            if (typeof openDsapInGrimoire === 'function') { openDsapInGrimoire('dsap://dreamscape.jp/'); return; } // eslint-disable-line no-undef
        } catch (err) { console.warn('[wmTodayWidgets] Server Manager', err); }
        open('ie');
    }

    // ================================================================ Files

    /**
     * The folder File Explorer opens in (My Documents) or one picked in Options..., its item count
     * and its newest files. One listing (wmFileExplorer.list, newest first) kept 3 minutes, asked
     * again after File Explorer read a list anew or received files (wmFilesChange); only while Today
     * is on screen, and never within a moment of a tap (the shell would show the wait cursor for
     * it). The phone's volumes (Android app only) come with it, already cached by the bridge.
     */
    const FILES_MS = 3 * 60 * 1000;
    const FILES_RETRY_MS = 60 * 1000; // a failed read waits a minute (no sub-minute polling, Yukimi Nov 13)
    const FILES_PAGE = 60; // folders list first: enough to reach the files of a workspace's top level
    const FILES_PLACES = { documents: ['', 'My Documents'], downloads: ['/Downloads', 'Downloads'], pictures: ['/Pictures', 'My Pictures'], scraps: ['/Scraps', 'Scraps'] };
    const FILES_OPTIONS = [
        { key: 'folder', label: 'Folder', value: 'documents', choices: Object.keys(FILES_PLACES).map((k) => [k, FILES_PLACES[k][1]]) },
        { key: 'recent', label: 'Recent files', value: '5', choices: [['0', 'None'], ['3', '3'], ['5', '5']] }
    ];
    const files = { key: '', at: 0, busy: 0, stale: false, count: null, list: [], vols: [], tapAt: -1e9 }; // busy: when the request went out, 0 = none
    let filesEl = null;
    let filesOption = null;
    const fe = () => window.wmFileExplorer || null;

    function filesPlace(folder) {
        const [sub, name] = FILES_PLACES[folder] || FILES_PLACES.documents;
        return { path: `${fe().myDocumentsPath()}${sub}`, name };
    }

    function loadFiles(place) {
        const key = place.path;
        // another folder or workspace: nothing of the last one stays
        if (key !== files.key) { files.key = key; files.at = 0; files.count = null; files.list = []; }
        const now = Date.now();
        // (a request the server never answers frees the slot after half a minute)
        if ((files.busy && now - files.busy < 30000) || !online() || sh.current !== 'today' || document.hidden) return;
        if (document.documentElement.dataset.wmBoot !== 'done') return; // not while the phone starts
        if (!files.stale && now - files.at < FILES_MS) return;
        if (performance.now() - files.tapAt < 800) return; // the next repaint asks
        files.busy = now;
        files.stale = false;
        files.at = now;
        const f = fe();
        f.list(key, FILES_PAGE).then((res) => {
            if (files.key !== key) return;
            files.count = res.count;
            files.list = res.files.slice(0, 5);
            // on Today now, not at its next 2 s repaint (only this block, as Weather does)
            const el = filesEl;
            if (el && el.isConnected && !el.classList.contains('wm-today-off') && filesOption) el.hidden = renderFiles(el, { option: filesOption }) === false;
        }).catch(() => { if (files.at === now) files.at = now - FILES_MS + FILES_RETRY_MS; }).finally(() => { if (files.busy === now) files.busy = 0; });
        f.volumes().then((v) => { files.vols = Array.isArray(v) ? v : []; }).catch(() => { files.vols = []; });
    }

    const filesCount = (n) => (n == null ? '' : n === 0 ? 'No items' : n === 1 ? '1 item' : `${n} items`);
    const isPicture = (i) => i.targetKind === 'image' || i.targetKind === 'scrap' || /^image\//.test(i.mimeType || '');

    /** A small picture for a listed file: the gallery's preview, or the VFS's own (same site only). */
    function filePicture(i) {
        if (!isPicture(i)) return '';
        if (i.targetKind === 'image' || i.targetKind === 'scrap') return printPicture({ filename: i.previewImageFilename || i.targetId || i.name });
        return typeof i.previewUrl === 'string' && /^\/[^/\\]/.test(i.previewUrl) ? i.previewUrl : '';
    }

    function openFile(i, place) {
        const f = fe();
        if (!f) return;
        // a contact card opens against the folder File Explorer shows: go there instead
        if (/\.vcf$/i.test(i.name || '')) { f.openFolder(place.path, place.name); return; }
        void f.openFile(i);
    }

    let filesPanel = null; // what the Files item shows, for its 6.5 panel
    function filesTitanium() {
        const s = filesPanel;
        const f = fe();
        if (!s || !f) return null;
        // the folder page's soft key receives files from the device into Downloads, whatever folder
        // the item follows (Yukimi, #748): File Explorer's Menu > Receive, its two choices as a menu
        const receive = { label: 'Receive', menu: () => [{ label: 'File', action: () => f.receive('file') }, { label: 'Pictures', action: () => f.receive('picture') }] };
        const pages = [{ title: s.place.name, line2: filesCount(s.count), softKey: receive, onTap: s.open }];
        for (const i of s.recent) {
            const go = () => openFile(i, s.place);
            pages.push({ title: i.name, line2: [f.fmtDate(i.modifiedAt), f.fmtSize(i.size)].filter(Boolean).join(', '), image: filePicture(i), softKey: { label: 'Open', action: go }, onTap: go });
        }
        for (const v of s.vols) {
            const go = () => f.openFolder(v.path, v.name);
            pages.push({ title: v.name, line2: v.total ? `${f.fmtSize(v.free)} free of ${f.fmtSize(v.total)}` : '', softKey: { label: 'Explorer', action: go }, onTap: go });
        }
        return { label: 'files', icon: 's:fileexp', pages, softKey: receive, onTap: s.open };
    }

    function renderFiles(el, { option }) {
        if (itemOff(el, false)) { filesPanel = null; return false; }
        const f = fe();
        if (!f) return false;
        const place = filesPlace(option('folder'));
        filesEl = el;
        filesOption = option;
        loadFiles(place);
        const recent = files.list.slice(0, Number(option('recent')) || 0);
        filesPanel = { place, count: files.count, recent, vols: files.vols, open: () => f.openFolder(filesPanel.place.path, filesPanel.place.name) };
        shell(el, 'wtw-files', `
            <img class="wtw-files-icon" ${imgSrcset('app-file-explorer')} alt="">
            <span class="wtw-lines"><span class="wtw-title"></span><span class="wtw-files-last"><span class="wtw-sub"></span><span class="wtw-files-date"></span></span></span>`, () => { if (filesPanel) filesPanel.open(); });
        const count = filesCount(files.count);
        setText(el.querySelector('.wtw-title'), count ? `${place.name}: ${count}` : place.name);
        const last = recent[0] || null;
        setText(el.querySelector('.wtw-sub'), last ? last.name : '');
        setText(el.querySelector('.wtw-files-date'), last ? f.fmtDate(last.modifiedAt) : '');
        el.querySelector('.wtw-files-last').hidden = !last;
        return true;
    }

    // ================================================================ Internet Explorer

    /**
     * Internet Explorer item (Yukimi, #748). 6.1: a search box with two buttons at its end, the
     * Grimoire's (IE's edtx page icon) and the web's (the Live Search button of Today's own search
     * row); Enter searches with the engine picked in Options... Under it the page of the window IE
     * has on screen, " (+X)" for X more windows; with nothing open here, the last active tab of
     * another device's session (browsingSessions, #756), which a tap brings to this phone.
     * 6.5 panel: Internet Explorer or the open page (New Window) | Resume session from <device>
     * (Ignore) | Web Search (Search Grimoire) | Favorites | History (Other Devices), every page
     * drawn as the device's Favorites panel draws its own (a 16 unit icon and one bold line).
     * Window titles are read from wmBrowser.windows() on Today's own repaint; the other devices'
     * sessions come from one browsingSessions.list() kept 3 minutes, asked again after the
     * server's "sessions changed" push, only while Today is on screen.
     */
    const IE_HOME = 'edtx://en.grimoire.jp/index.dtxt'; // the start page of a new window (wmBrowser.js GRIM_HOME_URL)
    const IE_MS = 3 * 60 * 1000;
    const IE_CHANGED_MS = 15 * 1000;
    const IE_IGNORE_KEY = 'wmTodayIeIgnore';
    const IE_ENGINES = {
        bing: { name: 'Bing', page: 'Web Search', key: 'Search Web', hint: 'Search the web', ask: 'Search the web for:', icon: 'app-search', url: (q) => (q ? `https://www.bing.com/search?q=${encodeURIComponent(q)}` : 'https://www.bing.com/') },
        grimoire: { name: 'Grimoire', page: 'Grimoire Search', key: 'Search Grimoire', hint: 'Search the Grimoire', ask: 'Search the Grimoire for:', icon: 'ie-proto-edtx', url: (q) => (q ? `edtx://en.grimoire.jp/search?q=${encodeURIComponent(q)}` : 'edtx://en.grimoire.jp/search') }
    };
    const IE_OPTIONS = [{ key: 'engine', label: 'Search with', value: 'bing', choices: [['bing', 'Bing'], ['grimoire', 'Grimoire']] }];
    const ie = { at: 0, busy: 0, stale: false, sessions: null, wired: false };
    let ieEl = null;
    let ieOption = null;
    let iePanel = null; // what the item shows, for its 6.5 panel
    const ieApp = () => window.wmBrowser || null;
    // the 4x file of a 6.1 icon as a path (a panel page's small icon is one file)
    const artBest = (name) => { const set = sh.art.srcset(name).split(',').map((s) => s.trim().split(' ')[0]).filter(Boolean); return set[set.length - 1] || sh.art.url(name); };

    function loadRemote() {
        const b = window.browsingSessions;
        if (!b || typeof b.list !== 'function') return;
        if (!ie.wired && typeof b.on === 'function') { ie.wired = true; b.on('changed', () => { ie.stale = true; }); }
        const now = Date.now();
        if ((ie.busy && now - ie.busy < 30000) || !online() || sh.current !== 'today' || document.hidden) return;
        if (document.documentElement.dataset.wmBoot !== 'done') return; // not while the phone starts
        if (now - ie.at < (ie.stale ? IE_CHANGED_MS : IE_MS)) return;
        if (performance.now() - files.tapAt < 800) return; // the next repaint asks
        let st = null;
        try { st = b.state(); } catch (_) { st = null; }
        if (!st || !st.online) return; // the server does not know this client yet
        ie.busy = now;
        ie.stale = false;
        ie.at = now;
        b.list().then((res) => {
            ie.sessions = res && Array.isArray(res.sessions) ? res.sessions : [];
            const el = ieEl;
            if (el && el.isConnected && !el.classList.contains('wm-today-off') && ieOption) el.hidden = renderIe(el, { option: ieOption }) === false;
        }).catch(() => { if (ie.at === now) ie.at = now - IE_MS + FILES_RETRY_MS; }).finally(() => { if (ie.busy === now) ie.busy = 0; });
    }

    /** The sessions put aside with Ignore (their ids, kept on the phone until they end). */
    function ieIgnored() {
        try {
            const v = JSON.parse(localStorage.getItem(IE_IGNORE_KEY) || '[]');
            return Array.isArray(v) ? v.filter((id) => typeof id === 'string') : [];
        } catch (_) { return []; }
    }
    function ieIgnore(ids) {
        try { if (ids.length) localStorage.setItem(IE_IGNORE_KEY, JSON.stringify(ids.slice(-20))); else localStorage.removeItem(IE_IGNORE_KEY); } catch (_) { /* this load only */ }
    }

    /** Another device's session with pages open: { id, device, tab, more } (not the one ignored), or null. */
    function remoteSession() {
        const b = window.browsingSessions;
        if (!b || !ie.sessions) return null;
        let own = '';
        try { own = b.deviceId(); } catch (_) { own = ''; }
        const tabsOf = (x) => (x.windows || []).reduce((all, w) => all.concat((w && w.tabs) || []), []).filter((t) => t && t.id && (t.title || t.url));
        const list = ie.sessions.filter((x) => x && x.id && !x.own && x.deviceId !== own && x.state !== 'stored' && tabsOf(x).length);
        const ignored = ieIgnored();
        // an ignored session that ended is forgotten
        const left = ignored.filter((id) => list.some((x) => x.id === id));
        if (left.length !== ignored.length) ieIgnore(left);
        const x = list.find((s) => !left.includes(s.id));
        if (!x) return null;
        const tabs = tabsOf(x);
        return { id: x.id, device: x.deviceName || 'another device', tab: tabs.find((t) => t.active) || tabs[0], more: tabs.length - 1 };
    }

    /** { title, more, has, remote }: the window on screen in IE here, else another device's last tab. */
    function ieModel() {
        const b = ieApp();
        let wins = [];
        try { wins = (b && typeof b.windows === 'function' && b.windows()) || []; } catch (_) { wins = []; }
        const cur = wins.find((w) => w.current) || wins[0] || null;
        const has = !!cur && !!cur.url && cur.url !== IE_HOME;
        const remote = remoteSession();
        const local = { title: has ? (cur.title || cur.url) : 'Internet Explorer', more: Math.max(0, wins.length - 1), has, remote, shown: null };
        // nothing open here: what the other device shows last
        if (!has && wins.length <= 1 && remote) return { ...local, shown: remote, line: `${remote.tab.title || remote.tab.url}${remote.more > 0 ? ` (+${remote.more})` : ''}` };
        return { ...local, line: `${local.title}${local.more > 0 ? ` (+${local.more})` : ''}` };
    }

    /**
     * IE's own entry points for Today, called when wmBrowser has them (takeTab, otherDevices,
     * openFavorites, openHistory, search); until then the nearest thing it does have.
     */
    function ieCall(name, args, otherwise) {
        const b = ieApp();
        if (b && typeof b[name] === 'function') {
            try { return b[name](...args); } catch (err) { console.warn('[wmTodayWidgets] Internet Explorer', name, err); }
            return undefined;
        }
        return otherwise();
    }

    function ieSearch(engine, text) {
        const e = IE_ENGINES[engine] || IE_ENGINES.bing;
        const q = String(text || '').trim();
        ieCall('search', [engine, q], () => { const b = ieApp(); if (!b || typeof b.open !== 'function' || !b.open(e.url(q))) open('browser'); });
    }

    /** The 6.5 panel's search: WM asks for the words, then IE shows the result. */
    async function ieAskSearch(engine) {
        const e = IE_ENGINES[engine] || IE_ENGINES.bing;
        const q = await sh.messageBox({ title: e.page, text: e.ask, input: { value: '' }, buttons: [{ text: 'Search', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false, modal: true });
        if (q) ieSearch(engine, q);
    }

    /** That session's tab comes to this phone (Other Devices' own take, wmBrowser.takeTab). */
    function ieResume(r) {
        if (!r || !r.tab) { open('browser'); return; }
        ie.stale = true;
        ieCall('takeTab', [r.id, r.tab.id], () => {
            // IE without takeTab: the page's address opens here and the other device keeps its page
            const b = ieApp();
            const m = ieModel();
            const ok = b && r.tab.url && (m.has && typeof b.newWindow === 'function' ? b.newWindow(r.tab.url) != null : typeof b.open === 'function' && b.open(r.tab.url));
            if (!ok) open('browser');
        });
    }

    function ieNewWindow() {
        const b = ieApp();
        if (!b || typeof b.newWindow !== 'function') { open('browser'); return; }
        if (b.newWindow() == null) void sh.messageBox({ title: 'Internet Explorer', icon: 'error', text: 'Every window is in use. Close a window, then try again.' });
    }

    /**
     * A panel whose pages changed while it is on show (a session ended, a favourite was removed):
     * the home screen redraws the page at once but keeps the right soft key of the page that was
     * there, so the keys are drawn again after its repaint.
     */
    const panelSig = {};
    function panelChanged(id, pages) {
        const sig = pages.map((pg) => `${pg.title}|${pg.softKey ? pg.softKey.label : ''}`).join('\n');
        if (panelSig[id] === sig) return;
        const first = panelSig[id] == null;
        panelSig[id] = sig;
        if (!first) setTimeout(() => { if (sh.current === 'today') sh.refreshSoftKeys(); }, 0);
    }

    /**
     * A panel's tap that opens a program or a box: the home screen acts when the pen lifts, and the
     * click that follows would land on what has just opened (a link of IE's start page, a note of
     * Notes). It opens after that click; the Enter key, which has none, waits 120 ms.
     */
    function afterTap(fn) {
        return () => {
            let done = false;
            const run = () => {
                if (done) return;
                done = true;
                document.removeEventListener('click', run, true);
                fn();
            };
            document.addEventListener('click', run, true);
            setTimeout(run, 120);
        };
    }

    function ieTitanium({ option }) {
        const m = iePanel;
        if (!m) return null;
        const tap = IE_ENGINES[option('engine')] ? option('engine') : 'bing';
        const other = tap === 'bing' ? 'grimoire' : 'bing';
        const show = () => open('browser');
        const pages = [{ smallIcon: 'ti-2552', title: m.has ? m.title : 'Internet Explorer', softKey: { label: 'New Window', action: ieNewWindow }, onTap: afterTap(show) }];
        const r = m.remote;
        if (r) {
            pages.push({
                // "Resume session from <device>" over two lines: a computer's name does not fit beside the words
                smallIcon: artBest('ie-windows'), title: 'Resume session', line2: `from ${r.device}`,
                // (the session on show when the key is pressed: the shell keeps a key until it draws its keys again)
                softKey: { label: 'Ignore', action: () => { const now = remoteSession(); if (now) ieIgnore(ieIgnored().filter((id) => id !== now.id).concat(now.id)); document.dispatchEvent(new CustomEvent('wmSettingsChange', { detail: { keys: [IE_IGNORE_KEY] } })); } },
                onTap: afterTap(() => ieResume(r))
            });
        }
        pages.push({ smallIcon: artBest(IE_ENGINES[tap].icon), title: IE_ENGINES[tap].page, softKey: { label: IE_ENGINES[other].key, action: () => { void ieAskSearch(other); } }, onTap: afterTap(() => { void ieAskSearch(tap); }) });
        // Favorites has no right soft key (Yukimi's list leaves it blank)
        pages.push({ smallIcon: artBest('ie-favorite'), title: 'Favorites', softKey: { label: '', disabled: true }, onTap: afterTap(() => ieCall('openFavorites', [], show)) });
        pages.push({ smallIcon: artBest('ie-page'), title: 'History', softKey: { label: 'Other Devices', action: () => ieCall('otherDevices', [], show) }, onTap: afterTap(() => ieCall('openHistory', [], show)) });
        panelChanged('ie', pages);
        // (the panel's own tap is the Enter key's: the page on show answers it)
        return { label: 'internet explorer', icon: 's:ie', pages, softKey: pages[0].softKey, onTap: (pg) => (pg && typeof pg.onTap === 'function' ? pg.onTap() : show()) };
    }

    function renderIe(el, { option }) {
        if (itemOff(el, false)) { iePanel = null; return false; }
        if (!ieApp()) return false;
        ieEl = el;
        ieOption = option;
        loadRemote();
        const engine = IE_ENGINES[option('engine')] ? option('engine') : 'bing';
        if (el.dataset.wtwBuilt !== 'wtw-ie') {
            el.dataset.wtwBuilt = 'wtw-ie';
            el.classList.add('wtw', 'wtw-ie');
            // the search box is Today's own (wm-shell.css .wm-today-search), with the Grimoire's button before the web's
            el.innerHTML = `
                <form class="wm-today-search wtw-ie-search" role="search">
                    <input type="search" enterkeyhint="search" autocomplete="off">
                    <button type="button" class="wtw-ie-grim" data-engine="grimoire" aria-label="Search the Grimoire"></button>
                    <button type="button" class="wm-today-search-go" data-engine="bing" aria-label="Search the web with Bing"></button>
                </form>
                <button type="button" class="wtw-ie-win"><img ${imgSrcset('app-ie')} alt=""><span class="wtw-title"></span></button>`;
            const input = el.querySelector('input');
            const go = (eng) => { const q = input.value; input.value = ''; input.blur(); ieSearch(eng, q); };
            el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); go(el.dataset.engine || 'bing'); });
            el.querySelectorAll('button[data-engine]').forEach((b) => b.addEventListener('click', () => go(b.dataset.engine)));
            el.querySelector('.wtw-ie-win').addEventListener('click', () => { const m = iePanel; if (m && m.shown) ieResume(m.shown); else open('browser'); });
        }
        if (el.dataset.engine !== engine) {
            el.dataset.engine = engine;
            const input = el.querySelector('input');
            input.placeholder = IE_ENGINES[engine].hint;
            input.setAttribute('aria-label', IE_ENGINES[engine].hint);
        }
        const m = ieModel();
        iePanel = m;
        setText(el.querySelector('.wtw-title'), m.line);
        return true;
    }

    // ================================================================ Favorites

    /**
     * Favorites item (Yukimi, #748): programs picked from Start's list (Programs and its folders,
     * the phone's Android programs among them: wmSettings.programItems, wmShell.listApps).
     * 6.5: the device's Favorites panel (HKLM\Software\Microsoft\CHome\CHomeFavs, layout
     * FavoritesExpanded of Titanium_480x640.cpr): the star (2550) at the top right, a page per
     * favourite with its 16 unit icon at 10,31 and its name in bold from 32, a last page
     * "Add/Remove" (2551), the right soft key "Change" on every page; the device's pages are
     * Internet Explorer's favourites and "Change" opens its "Change Favorites" list, ours are
     * programs and it opens the item's Options. 6.1: the favourites as a strip of icons, the one
     * last touched named; tap starts it, tap-and-hold moves or removes it.
     * The list is kept on the phone (wmTodayFavorites: { v, list: [item key], seen }): it is too long
     * for a Today option (120 letters). Options... draws two check lists (Programs, Android); what
     * it stores (the unchecked keys) is taken over into the list here and removed from the options.
     */
    const FAV_KEY = 'wmTodayFavorites';
    const FAV_GROUPS = ['favapps', 'favandroid'];
    const FAV_APPS = { key: 'favapps', label: 'Programs', type: 'checks', get choices() { return favChoices('favapps'); }, get value() { return favUnchecked('favapps'); } };
    const FAV_ANDROID = { key: 'favandroid', label: 'Android', type: 'checks', get choices() { return favChoices('favandroid'); }, get value() { return favUnchecked('favandroid'); } };
    const FAV_SIZE = { key: 'size', label: 'Icons', value: 'large', choices: [['large', 'Large'], ['small', 'Small, with the name beside them']] };
    // Options... shows one list (Yukimi, Nov 12, #777): the favourites first, in their order (Move Up /
    // Move Down), then every other program, Start's then the Android ones; the page's list box
    // scrolls, the page does not. Stored as the favourites' keys in order (wmPrograms 'orderedChecks')
    const FAV_ORDER = {
        key: 'favorder', label: 'Favorites', type: 'orderedChecks',
        get choices() {
            const all = [...favCatalog().values()];
            const g = (it) => (favGroup(it.key) === 'favandroid' ? 1 : 0);
            return all.sort((a, b) => g(a) - g(b) || favColl.compare(a.label, b.label)).map((it) => [it.key, it.label, it.small && it.small.src]);
        },
        get value() { const map = favCatalog(); return favList().filter((k) => map.has(k)).join(','); }
    };
    const FAV_OPTIONS = [FAV_ORDER, FAV_SIZE];
    const fav = { at: 0, map: null, raw: null, state: null, checked: [], sel: '' };
    let favPanel = null; // the favourites on show, for the 6.5 panel
    const favGroup = (key) => (String(key).startsWith('a:android:') ? 'favandroid' : 'favapps');

    /** Everything Start lists, by item key: { key, label, img: { src, srcset }, small, folder?, launch? }. Read at most every 5 s. */
    function favCatalog() {
        if (fav.map && Date.now() - fav.at < 5000) return fav.map;
        const S = window.wmSettings;
        if (!S || typeof S.programItems !== 'function') return fav.map || new Map();
        const map = new Map();
        const add = (it) => {
            // (a key with a comma cannot be listed in an option; games are listed but not playable yet)
            if (!it || !it.key || !it.label || !it.img || it.key.includes(',') || map.has(it.key)) return;
            if (!it.folder && !it.key.startsWith('a:') && !it.launch) return;
            // the 16 unit icon of the same 6.1 art ("app-notes" beside "app-notes-lg")
            const m = /^\/static_images\/wm61\/(.+)-lg\.png$/.exec(it.img.src || '');
            map.set(it.key, { key: it.key, label: it.label, img: it.img, small: m ? { src: sh.art.url(m[1]), srcset: sh.art.srcset(m[1]) } : it.img, folder: it.folder || null, launch: it.launch || null });
        };
        try {
            const top = S.programItems() || [];
            top.forEach(add);
            top.filter((i) => i.folder).forEach((f) => (S.programItems(f.folder) || []).forEach(add));
            // Start's own screens and the programs Settings holds (Today, Programs, Settings, Task Manager, Accounts)
            sh.listApps().forEach((a) => {
                if (!a.inStart || a.id === 'start') return;
                const icon = String(a.icon || 'app-programs');
                const own = icon.startsWith('/');
                add({ key: `a:${a.id}`, label: a.startLabel || a.title || a.id, img: own ? { src: icon, srcset: '' } : { src: sh.art.url(`${icon}-lg`), srcset: sh.art.srcset(`${icon}-lg`) } });
            });
        } catch (err) { console.warn('[wmTodayWidgets] favorites', err); }
        fav.map = map;
        fav.at = Date.now();
        // the Android list is offered once the phone has programs to list
        return map;
    }

    const favColl = new Intl.Collator(undefined, { sensitivity: 'base' });
    function favChoices(group) {
        return [...favCatalog().values()].filter((it) => favGroup(it.key) === group).sort((a, b) => favColl.compare(a.label, b.label)).map((it) => [it.key, it.label]);
    }
    /** A check list's value when Options has stored none: every key that is not a favourite. */
    function favUnchecked(group) {
        const on = new Set(favList());
        return favChoices(group).map(([k]) => k).filter((k) => !on.has(k)).join(',');
    }

    function favSave(list, seen) {
        fav.state = { v: 1, list: list.slice(0, 60), seen: seen || (fav.state && fav.state.seen) || {} };
        fav.raw = JSON.stringify(fav.state);
        try { localStorage.setItem(FAV_KEY, fav.raw); } catch (_) { /* this load only */ }
    }

    /** The favourites' keys in order, after taking over what Options... stored since the last look. */
    function favList() {
        let raw = null;
        try { raw = localStorage.getItem(FAV_KEY); } catch (_) { raw = null; }
        if (raw !== fav.raw || !fav.state) {
            let s = null;
            try { s = JSON.parse(raw || 'null'); } catch (_) { s = null; }
            fav.state = { v: 1, list: s && Array.isArray(s.list) ? s.list.filter((k) => typeof k === 'string') : [], seen: (s && s.seen && typeof s.seen === 'object' && s.seen) || {} };
            fav.raw = raw;
        }
        let all = null;
        try { all = JSON.parse(localStorage.getItem(sh.todayOptionsKey || 'wmTodayOptions') || 'null'); } catch (_) { all = null; }
        const stored = (all && all.favorites) || null;
        if (!stored || !(typeof stored.favorder === 'string' || FAV_GROUPS.some((g) => typeof stored[g] === 'string'))) return fav.state.list;
        let list = fav.state.list.slice();
        const seen = { ...fav.state.seen };
        const map = favCatalog();
        const fresh = [];
        // Options...'s ordered list (#777): exactly these, in this order; favourites Start no longer
        // lists keep their place after them (the program may come back)
        if (typeof stored.favorder === 'string') {
            if (stored.favorder !== seen.favorder) {
                const want = stored.favorder.split(',').filter(Boolean);
                list = want.concat(list.filter((k) => !map.has(k) && !want.includes(k)));
                seen.favorder = stored.favorder;
            }
            delete stored.favorder;
        }
        for (const g of FAV_GROUPS) {
            const text = stored[g];
            if (typeof text !== 'string') continue;
            if (text !== seen[g]) {
                // a new answer from Options...: its unchecked keys leave, the newly checked join at
                // the end in the order they were checked (keys that are not on its list stay)
                const off = new Set(text.split(',').filter(Boolean));
                list = list.filter((k) => !off.has(k));
                for (const k of map.keys()) if (favGroup(k) === g && !off.has(k) && !list.includes(k)) fresh.push(k);
                seen[g] = text;
            }
            delete stored[g];
        }
        const rank = (k) => { const i = fav.checked.indexOf(k); return i < 0 ? fav.checked.length : i; };
        fresh.sort((a, b) => rank(a) - rank(b) || favColl.compare(map.get(a).label, map.get(b).label));
        list = list.concat(fresh);
        fav.checked = [];
        favSave(list, seen);
        // the options keep no copy: the list above is the one Options... shows next time
        try { localStorage.setItem(sh.todayOptionsKey || 'wmTodayOptions', JSON.stringify(all)); } catch (_) { /* storage off */ }
        return fav.state.list;
    }

    /** The favourites that Start still lists, in order. */
    function favItems() {
        const map = favCatalog();
        return favList().map((k) => map.get(k)).filter(Boolean);
    }

    function favStart(it) {
        if (!it) return;
        if (it.folder) {
            // a folder of Programs: 6.5 opens it on Start; 6.1's Programs opens at its top until it can open a folder
            const S = window.wmSettings;
            if (sh.version === '6.5' && window.wmStart65 && typeof window.wmStart65.openFolder === 'function' && window.wmStart65.openFolder(it.folder)) return;
            if (S && typeof S.openProgramsFolder === 'function') { S.openProgramsFolder(it.folder); return; }
            open('programs');
            return;
        }
        if (it.key.startsWith('a:')) { open(it.key.slice(2)); return; }
        // a Dreamscape page: its own route (Internet Explorer's mobile view), under the wait cursor
        if (it.launch && typeof it.launch.action === 'function') sh.busy(() => it.launch.action(), { paint: true, timeout: 15000 });
    }

    /**
     * The item's Options (Settings > Today > Items > Favorites > Options...). Settings has no call
     * for an item's options yet (wmSettings.openTodayOptions when it has): its Items list is opened
     * and the row and its Options... button are pressed here.
     */
    function favOptions() {
        const S = window.wmSettings;
        if (!S) return;
        if (typeof S.openTodayOptions === 'function') { S.openTodayOptions('favorites'); return; }
        if (typeof S.open !== 'function') return;
        S.open('today', 'items');
        let tries = 0;
        const press = () => {
            const pg = [...document.querySelectorAll('#wmShell .wm-page')].find((p) => !p.hidden && p.querySelector('.wm-listbox-row input[name="it-favorites"]'));
            const box = pg && pg.querySelector('input[name="it-favorites"]');
            const row = box && box.closest('.wm-listbox-row');
            if (!row) { if (++tries < 20) setTimeout(press, 100); return; }
            if (!row.classList.contains('is-selected')) row.click();
            const btn = pg.querySelector('.wm-button[data-act="options"]');
            if (btn && !btn.disabled) btn.click();
        };
        setTimeout(press, 0);
    }

    function favMove(key, by) {
        const list = favList().slice();
        const map = favCatalog();
        const i = list.indexOf(key);
        if (i < 0) return;
        if (!by) list.splice(i, 1);
        else {
            // over the next favourite that is on show (one that left Start keeps its place)
            let j = i + by;
            while (j >= 0 && j < list.length && !map.has(list[j])) j += by;
            if (j < 0 || j >= list.length) return;
            list.splice(j, 0, list.splice(i, 1)[0]);
        }
        // (seen is cleared: the same answer from Options... counts again after a change made here)
        favSave(list, {});
        document.dispatchEvent(new CustomEvent('wmSettingsChange', { detail: { keys: [FAV_KEY] } }));
    }

    function favMenu(it, items) {
        const i = items.indexOf(it);
        return [
            { label: 'Open', action: () => favStart(it) },
            '-',
            { label: 'Move Left', disabled: i <= 0, action: () => favMove(it.key, -1) },
            { label: 'Move Right', disabled: i < 0 || i >= items.length - 1, action: () => favMove(it.key, 1) },
            { label: 'Remove', action: () => favMove(it.key, 0) },
            '-',
            { label: 'Options...', action: favOptions }
        ];
    }

    function favTitanium() {
        const items = favPanel;
        if (!items) return null;
        const change = { label: 'Change', action: favOptions };
        // a panel page's small icon is one file: the densest of the set
        const one = (ic) => { const set = String(ic.srcset || '').split(',').map((s) => s.trim().split(' ')[0]).filter(Boolean); return set[set.length - 1] || ic.src; };
        // each page shows its program's own icon where the panel's star is (Yukimi, Nov 12, #777)
        const pages = items.map((it) => ({ icon: one(it.img), smallIcon: one(it.small), title: it.label, softKey: change, onTap: afterTap(() => favStart(it)) }));
        pages.push({ smallIcon: 'ti-2551', title: 'Add/Remove', softKey: change, onTap: afterTap(favOptions) });
        panelChanged('favorites', pages);
        return { label: 'favorites', icon: 'ti-2550', pages, softKey: change, onTap: (pg) => (pg && typeof pg.onTap === 'function' ? pg.onTap() : favOptions()) };
    }

    function renderFavorites(el, { option }) {
        if (itemOff(el, false)) { favPanel = null; return false; }
        if (!window.wmSettings || typeof window.wmSettings.programItems !== 'function') return false;
        const items = favItems();
        favPanel = items;
        if (el.dataset.wtwBuilt !== 'wtw-favs') {
            el.dataset.wtwBuilt = 'wtw-favs';
            el.classList.add('wtw', 'wtw-favs');
            el.innerHTML = `<button type="button" class="wtw-favs-none"><img ${imgSrcset('ie-favorite')} alt=""><span class="wtw-title">Tap here to add favorites</span></button>
                <span class="wtw-favs-strip"></span><span class="wtw-favs-name"></span>`;
            el.querySelector('.wtw-favs-none').addEventListener('click', favOptions);
            const strip = el.querySelector('.wtw-favs-strip');
            const of = (e) => { const b = e.target.closest('.wtw-fav'); return b ? (favPanel || []).find((it) => it.key === b.dataset.key) : null; };
            const name = (it) => { if (!it) return; fav.sel = it.key; setText(el.querySelector('.wtw-favs-name'), it.label); };
            strip.addEventListener('pointerdown', (e) => name(of(e)));
            strip.addEventListener('focusin', (e) => name(of(e)));
            strip.addEventListener('click', (e) => { const it = of(e); if (it) { name(it); favStart(it); } });
            strip.addEventListener('contextmenu', (e) => {
                const it = of(e);
                if (!it) return;
                e.preventDefault();
                name(it);
                sh.menuAt(e.clientX, e.clientY, favMenu(it, favPanel || []));
            });
        }
        const small = option('size') === 'small';
        el.classList.toggle('is-small', small);
        el.classList.toggle('is-empty', !items.length);
        const strip = el.querySelector('.wtw-favs-strip');
        const sig = `${small ? 's' : 'l'}|${items.map((it) => `${it.key}|${it.label}|${it.img.src}`).join('|')}`;
        if (strip.dataset.sig !== sig) {
            strip.dataset.sig = sig;
            strip.innerHTML = items.map((it) => {
                const ic = small ? it.small : it.img;
                return `<button type="button" class="wtw-fav" data-key="${esc(it.key)}" aria-label="${esc(it.label)}"><img src="${esc(ic.src)}"${ic.srcset ? ` srcset="${esc(ic.srcset)}"` : ''} alt="" draggable="false"></button>`;
            }).join('');
        }
        const sel = items.find((it) => it.key === fav.sel) || items[0] || null;
        setText(el.querySelector('.wtw-favs-name'), sel ? sel.label : '');
        return true;
    }

    // ================================================================ registration

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerTodayItem !== 'function') return;
        // the Weather app's data landed (place, unit or a quiet update): Today repaints now, not in 2 s
        // (only this block: wmSettingsChange would also redo the background and the title bar)
        document.addEventListener('wmWeatherChange', () => {
            if (!weatherEl || !weatherEl.isConnected || weatherEl.classList.contains('wm-today-off')) return;
            weatherEl.hidden = renderWeather(weatherEl) === false;
        });
        // order: Tasks, Calendar, Accounts (wmAccounts.js, after 'calendar'), Director, Studio,
        // Daily usage, Weather, Notes, Remote Desktop, Server status. defaultOn: false = off until
        // switched on in Settings > Today > Items (when the shell honours it)
        sh.registerTodayItem({ id: 'calendar', label: 'Calendar', icon: 'today-calendar', after: 'tasks', text: calendarText, onTap: () => open('calendar'), titanium: calendarTitanium });
        const IDLE = { key: 'idle', label: 'While the Director is idle', value: 'show', choices: [['show', 'Show the last session'], ['hide', 'Hide the item']] };
        sh.registerTodayItem({
            id: 'director', label: 'Director', after: 'accounts', render: directorRenderer(null), titanium: directorTitanium(null),
            options: [
                { key: 'show', label: 'Session', value: 'last', choices: [['last', 'Last Director session'], ['workspace', 'Last session in this workspace'], ['wren', 'Yumiya (Wren)'], ['kabuki', 'Chiyo (Kabuki)'], ['xi', 'Yozora (Xi)']] },
                IDLE
            ]
        });
        // one item per persona, off until switched on in Settings > Today > Items. Not offered in
        // 6.5: there they are pages of the Director item, and Daily Usage is a page of Studio's
        const v65 = sh.version === '6.5';
        let prev = 'director';
        if (!v65) PERSONAS.forEach((p) => {
            sh.registerTodayItem({ id: `director-${p}`, label: `Director: ${DIRECTOR_NAMES[p]}`, after: prev, defaultOn: false, render: directorRenderer(p), titanium: directorTitanium(p), options: [IDLE] });
            prev = `director-${p}`;
        });
        sh.registerTodayItem({ id: 'studio', label: 'Studio', after: prev, render: renderStudio, titanium: studioTitanium });
        if (!v65) sh.registerTodayItem({ id: 'usage', label: 'Daily Usage', icon: 'app-studio', after: 'studio', text: usageText, onTap: () => open('studio'), titanium: usageTitanium });
        sh.registerTodayItem({ id: 'weather', label: 'Weather', after: 'usage', render: renderWeather, titanium: weatherTitaniumPages });
        sh.registerTodayItem({ id: 'notes', label: 'Notes', after: 'weather', defaultOn: false, render: renderNotes, titanium: notesTitanium, options: NOTES_OPTIONS });
        sh.registerTodayItem({
            id: 'remote-desktop', label: 'Remote Desktop', icon: 'app-remote-desktop-mobile', after: 'notes', defaultOn: false, text: remoteText, titanium: remoteTitanium,
            onTap: () => { const r = window.wmRemoteDesktop; if (r && typeof r.reconnectLast === 'function') void r.reconnectLast(); else open('remote-desktop-mobile'); }
        });
        sh.registerTodayItem({
            id: 'server', label: 'Server Status', after: 'remote-desktop', defaultOn: false, render: renderServer, titanium: serverTitanium,
            options: [{ key: 'view', label: 'Show', value: 'detailed', choices: [['detailed', 'Details (version, CPU, RAM, disk, workers)'], ['compact', 'One line']] }]
        });
        // Files: off until switched on, as Notes, Remote Desktop and Server Status are
        sh.registerTodayItem({ id: 'files', label: 'Files', icon: 'app-file-explorer', after: 'server', defaultOn: false, render: renderFiles, titanium: filesTitanium, options: FILES_OPTIONS });
        document.addEventListener('wmFilesChange', () => { files.stale = true; });
        // Internet Explorer and Favorites: off until switched on, as Files is
        sh.registerTodayItem({ id: 'ie', label: 'Internet Explorer', icon: 'app-ie', after: 'files', defaultOn: false, render: renderIe, titanium: ieTitanium, options: IE_OPTIONS });
        sh.registerTodayItem({ id: 'favorites', label: 'Favorites', icon: 'ie-favorite', after: 'ie', defaultOn: false, render: renderFavorites, titanium: favTitanium, options: FAV_OPTIONS });
        // the order the Options' boxes are checked in is the order the new favourites take
        document.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || !t.matches || !t.matches('input[name="opt-favapps"], input[name="opt-favandroid"]')) return;
            fav.checked = fav.checked.filter((k) => k !== t.value);
            if (t.checked) fav.checked.push(t.value);
        }, true);
        const tapped = (e) => { if (e.isTrusted) files.tapAt = performance.now(); };
        document.addEventListener('click', tapped, true);
        document.addEventListener('keydown', (e) => { if (e.key === 'Enter') tapped(e); }, true);
    }

    // tests: ask the server again on the next paint
    window.wmTodayWidgets = {
        refetch() {
            server.at = 0; server.infoAt = 0; server.workersAt = 0; server.loadDenied = false;
            director.asked = 0; director.at = { wren: 0, kabuki: 0, xi: 0 };
            files.at = 0;
            ie.at = 0; fav.at = 0;
        }
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
