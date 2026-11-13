/**
 * Melaton Mobile: the phone's own Android programs (Yozora #747, #773), before the app becomes a launcher.
 *
 * The Dreamscape app lists the phone's launcher programs (window.AndroidApps, DSApp-Kotlin
 * AndroidApps.kt: list / launch / info / forceStop / uninstall, icons as files, the window event
 * 'androidapps'). Here each becomes a program of the shell that starts instead of showing a page
 * (registerApp({ launch })):
 *
 *   Programs > Android      every program that is not hidden, under its own name and icon
 *   Programs > Games        the programs that are games (Android's category), unless moved out
 *   Programs                the phone's own Phone, Camera and store ("Marketplace"), linked out of the folder
 *   Settings > System       "Android": the phone's own Settings
 *   Start                   the programs added to Start from their tap-and-hold menu
 *
 * Tap-and-hold on a program (Programs, 6.5 Start): Add to Start / Remove from Start, Move to Games /
 * Remove from Games, Hide program, Program Info (Android's App info), End Task (stops its background
 * processes), Remove program (Android's uninstall). Hidden programs are listed again on
 * Settings > System > Remove Programs > Android.
 *
 * Icons: the program's own launcher icon (the app reads it unthemed, no icon pack), or its Windows
 * Mobile icon from the shared Program Icons store when it has one (modules/wmProgramIcons.js).
 * Settings > Personal > Program Icons asks the server for those: pick programs, Request, and the
 * server makes them in the background; a notification says when they are ready; keep or regenerate,
 * then Done saves the kept ones for every phone.
 *
 * Stored on the phone: wmAndroidHidden, wmAndroidStart (JSON arrays of "package/activity"),
 * wmAndroidGames (JSON { id: true | false }: a choice that overrides Android's category),
 * wmAndroidIconStore (the store's manifest, last seen), wmProgramIconsJob (the open batch),
 * wmProgramIconsMode (Program Icons' Style: Simple = the app's mark or one object, Detailed = characters
 * and signature objects).
 * Only inside the app, on phones.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;
    const bridge = window.AndroidApps;
    if (!bridge || typeof bridge.list !== 'function') return;

    const HIDDEN_KEY = 'wmAndroidHidden';
    const START_KEY = 'wmAndroidStart';
    const GAMES_KEY = 'wmAndroidGames';
    const NAMES_KEY = 'wmAndroidNames';      // { id: name } the user gave a program (#776)
    const DEFAULTS_KEY = 'wmDefaultPrograms'; // { system app id: android program id } (#776)
    // system programs an Android program can stand in for (Android Bridge), by their shell titles
    const REPLACEABLE = ['Melaton Media', 'Calendar', 'Calculator', 'Contacts', 'Messaging', 'Internet Explorer', 'Pictures & Videos', 'Notes', 'Tasks', 'Weather', 'File Explorer', 'Search'];
    const STORE_KEY = 'wmAndroidIconStore';
    const JOB_KEY = 'wmProgramIconsJob';
    const MODE_KEY = 'wmProgramIconsMode'; // 'simple' | 'detailed': the last Style picked
    const MODES = [['simple', 'Simple'], ['detailed', 'Detailed']];
    const readMode = () => (localStorage.getItem(MODE_KEY) === 'simple' ? 'simple' : 'detailed');
    // send each program's themed icon (Android 13's one-colour mark) along: Simple builds from it
    const THEMED_KEY = 'wmProgramIconsThemed'; // '0' = off; absent = on
    const readThemed = () => localStorage.getItem(THEMED_KEY) !== '0';
    const START_MENU_KEY = 'wmStartMenu'; // Settings > Menus' own list (wmPrograms.js)
    const FOLDER = 'android';
    const API = '/api/wm-program-icons';
    const PAGE_ID = 'program-icons';
    // linked out of the folder under the device's names and with Windows Mobile's own pictures
    // (icon: the 6.1 set, art65: the 6.5 Start icon), never Android's
    const ROLES = {
        phone: { label: 'Phone', icon: 'app-phone', art65: 'phone' },
        camera: { label: 'Camera', icon: 'app-camera', art65: 'camera' },
        store: { label: 'Marketplace', icon: 'app-marketplace', art65: 'marketplace' }
    };
    let sh = null;
    let apps = [];
    const registered = new Set();
    let store = readStore();

    const readJson = (key, fallback) => {
        try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (_) { return fallback; }
    };
    const writeJson = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* this session only */ } };
    const readSet = (key) => { const v = readJson(key, []); return new Set(Array.isArray(v) ? v.map(String) : []); };
    const writeSet = (key, set) => writeJson(key, [...set]);
    const shellId = (a) => `android:${a.id}`;
    const has = (fn) => typeof bridge[fn] === 'function';

    function readStore() {
        try {
            const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
            return v && v.icons && typeof v.icons === 'object' ? v : { version: 0, icons: {} };
        } catch (_) { return { version: 0, icons: {} }; }
    }

    function read() {
        try {
            const list = JSON.parse(bridge.list());
            return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string' && a.label) : [];
        } catch (_) { return []; }
    }

    /** The icon a program shows: its Windows Mobile one from the store, else its own launcher icon. */
    // the program's entry in the store: its exact "package/activity", else one for its package (an
    // entry saved by package name, or from a phone whose launcher activity has another name)
    const storeKey = (a) => {
        if (store.icons[a.id]) return a.id;
        if (store.icons[a.package]) return a.package;
        return Object.keys(store.icons).find((k) => store.icons[k] && store.icons[k].package === a.package) || null;
    };
    const storeIcon = (a) => { const k = storeKey(a); return (k && store.icons[k].icon) || null; };
    const iconOf = (a) => storeIcon(a) || a.icon;
    /** The name the program shows: the user's, else its own. */
    const labelOf = (a) => { const n = readJson(NAMES_KEY, {}); return (n && typeof n[a.id] === 'string' && n[a.id].trim()) || a.label; };
    const inGames = (a) => {
        const o = readJson(GAMES_KEY, {});
        return o && Object.prototype.hasOwnProperty.call(o, a.id) ? o[a.id] === true : a.game === true;
    };

    function start(a) {
        let ok = false;
        try { ok = bridge.launch(a.id) === true; } catch (_) { ok = false; }
        if (!ok) void sh.messageBox({ title: labelOf(a), text: `${labelOf(a)} could not be started. It may have been removed from the device.`, icon: 'warning' });
    }

    /** Redraw Programs and Start after a change (wmPrograms / wmStart65 listen). */
    function refresh() {
        sync();
        document.dispatchEvent(new CustomEvent('wmAppsChanged'));
    }

    // ---------------------------------------------------------------- tap-and-hold menu

    /** WM's rename box; an empty name gives the program its own name back. */
    async function renameProgram(a) {
        const v = await sh.messageBox({
            title: 'Rename', icon: null, text: `New name for ${a.label}:`,
            input: { value: labelOf(a), placeholder: a.label },
            buttons: [{ text: 'OK', value: true }, { text: 'Cancel', value: false }], cancelValue: false
        });
        if (v === false || v == null || v === true) return false;
        const n = readJson(NAMES_KEY, {}) || {};
        const name = String(v).trim().slice(0, 60);
        if (!name || name === a.label) delete n[a.id]; else n[a.id] = name;
        writeJson(NAMES_KEY, n);
        refresh();
        return true;
    }

    function holdRows(a, role) {
        const onStart = readSet(START_KEY).has(a.id);
        const rows = [{
            label: onStart ? 'Remove from Start' : 'Add to Start',
            action: () => {
                const s = readSet(START_KEY);
                if (onStart) s.delete(a.id); else s.add(a.id);
                writeSet(START_KEY, s);
                refresh();
            }
        }];
        if (!role) {
            const games = inGames(a);
            rows.push({
                label: games ? 'Remove from Games' : 'Move to Games',
                action: () => {
                    const o = readJson(GAMES_KEY, {});
                    // back to Android's own category: no stored choice
                    if (!games === (a.game === true)) delete o[a.id]; else o[a.id] = !games;
                    writeJson(GAMES_KEY, o);
                    refresh();
                }
            });
        }
        rows.push('-', { label: 'Rename...', action: () => { void renameProgram(a); } }, {
            label: 'Hide program',
            action: async () => {
                const yes = await sh.messageBox({
                    title: 'Hide program', icon: 'question',
                    text: `Hide ${labelOf(a)}? It leaves Programs and Start. Settings > Remove Programs > Android shows it again.`,
                    buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }], cancelValue: false
                });
                if (!yes) return;
                const h = readSet(HIDDEN_KEY);
                h.add(a.id);
                writeSet(HIDDEN_KEY, h);
                const s = readSet(START_KEY);
                s.delete(a.id);
                writeSet(START_KEY, s);
                refresh();
            }
        }, {
            label: 'Program Info',
            disabled: !has('info'),
            action: () => { let ok = false; try { ok = bridge.info(a.id) === true; } catch (_) { ok = false; } if (!ok) void sh.messageBox({ title: labelOf(a), icon: 'warning', text: `There is no information for ${labelOf(a)}. It may have been removed from the device.` }); }
        }, {
            label: 'End Task',
            disabled: !has('forceStop'),
            action: () => { let ok = false; try { ok = bridge.forceStop(a.id) === true; } catch (_) { ok = false; } if (!ok) void sh.messageBox({ title: 'End Task', icon: 'warning', text: `${labelOf(a)} could not be ended.` }); }
        }, '-', {
            label: 'Remove program',
            disabled: !has('uninstall') || a.removable === false,
            // Android asks itself (its uninstall dialog); the list follows its 'androidapps' event
            action: () => { let ok = false; try { ok = bridge.uninstall(a.id) === true; } catch (_) { ok = false; } if (!ok) void sh.messageBox({ title: 'Remove program', icon: 'error', text: `${labelOf(a)} could not be removed.` }); }
        });
        return rows;
    }

    // ---------------------------------------------------------------- the shell's programs

    /** Programs, Start and Settings follow the phone's list and the stored choices. */
    function sync() {
        apps = read();
        const hidden = readSet(HIDDEN_KEY);
        const onStart = readSet(START_KEY);
        const want = new Set();
        for (const a of apps) {
            const role = ROLES[a.role] ? a.role : null;
            // the phone's own Settings is "Android" in Settings, never a program of Programs
            if (a.role === 'settings') {
                want.add(shellId(a));
                sh.registerApp({ id: shellId(a), title: 'Android Settings', icon: 'app-android', inStart: false, launch: () => start(a) });
                if (window.wmSettings && typeof window.wmSettings.addLink === 'function') {
                    window.wmSettings.addLink({ id: 'link-android', tab: 'system', label: 'Android Settings', icon: 'app-android', app: shellId(a) });
                }
                continue;
            }
            if (hidden.has(a.id)) continue;
            want.add(shellId(a));
            sh.registerApp({
                id: shellId(a),
                title: role ? ROLES[role].label : labelOf(a),
                icon: (role && ROLES[role].icon) || iconOf(a),
                art65: role ? ROLES[role].art65 : undefined,
                // 'bottom': on Start under the pinned programs; 'programs': in Programs only
                inStart: onStart.has(a.id) ? 'bottom' : 'programs',
                programsFolder: role ? undefined : (inGames(a) ? 'games' : FOLDER),
                launch: () => start(a),
                holdMenu: () => holdRows(a, role)
            });
        }
        applyDefaults();
        for (const id of [...registered]) if (!want.has(id)) sh.removeApp(id);
        registered.clear();
        want.forEach((id) => registered.add(id));
        // Settings > Menus keeps one list of what Start shows: the picks here are part of it once it exists
        try {
            const saved = JSON.parse(localStorage.getItem(START_MENU_KEY) || 'null');
            if (Array.isArray(saved)) {
                const next = saved.filter((id) => !String(id).startsWith('android:'));
                for (const a of apps) if (onStart.has(a.id) && !hidden.has(a.id)) next.push(shellId(a));
                if (JSON.stringify(next) !== JSON.stringify(saved)) localStorage.setItem(START_MENU_KEY, JSON.stringify(next));
            }
        } catch (_) { /* Start shows the programs' own places */ }
    }

    // ---------------------------------------------------------------- Android Bridge (Default Programs, #776)

    /** System programs by title -> their shell ids (the files name them with their own constants). */
    function systemApps() {
        const list = sh.listApps();
        return REPLACEABLE.map((t) => list.find((x) => x.title === t && !String(x.id).startsWith('android:'))).filter(Boolean);
    }

    /** Each system program set to an Android program starts that program instead (shell replaceApp). */
    function applyDefaults() {
        if (typeof sh.replaceApp !== 'function') return;
        const map = readJson(DEFAULTS_KEY, {}) || {};
        for (const sys of systemApps()) {
            const a = map[sys.id] ? apps.find((x) => x.id === map[sys.id]) : null;
            sh.replaceApp(sys.id, a ? () => start(a) : null);
        }
    }

    async function api(pathname, opts = {}) {
        const res = await fetch(`${API}${pathname}`, {
            method: opts.method || 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
            body: opts.body ? JSON.stringify(opts.body) : undefined
        });
        let j = null;
        try { j = await res.json(); } catch (_) { j = null; }
        if (!res.ok || !j || j.success === false) {
            const err = new Error((j && j.error) || (res.status === 403 ? 'Only an administrator can change program icons.' : `The server answered ${res.status}.`));
            err.status = res.status;
            throw err;
        }
        return j;
    }

    /** The store's manifest: what every phone draws for programs that have a Windows Mobile icon. */
    function applyStore(m) {
        if (!m || !m.icons || typeof m.icons !== 'object') return;
        const before = JSON.stringify(store.icons);
        store = { version: m.version || 0, icons: m.icons };
        writeJson(STORE_KEY, store);
        if (JSON.stringify(store.icons) !== before && sh) refresh();
    }

    function loadStore() {
        api('/manifest').then(applyStore).catch(() => { /* the last copy stays */ });
    }

    // ---------------------------------------------------------------- Remove Programs > Android

    function registerRemoveTab() {
        const ws = window.wmSettings;
        if (!ws || typeof ws.extendPage !== 'function' || !ws.ui) return;
        const esc = (s) => sh.escapeHtml(s);
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        ws.extendPage('remove-programs', {
            id: 'android',
            tabs: [['android-hidden', 'Android']],
            init() {
                const list = read().filter((a) => a.role !== 'settings').sort((x, y) => coll.compare(x.label, y.label));
                return { list, hidden: readSet(HIDDEN_KEY) };
            },
            render(el, tab, d, pageApi) {
                el.innerHTML = `<p>Checked programs appear in Programs and Start. Clear the ones you never start.</p>
                    ${ws.ui.listbox(d.list.map((a) => ({ key: a.id, label: labelOf(a), checked: !d.hidden.has(a.id), selected: a.id === d.sel })), { maxHeight: 190 })}
                    ${ws.ui.buttons([['aa-rename', 'Rename...', !d.sel]])}`;
                const btn = el.querySelector('[data-act="aa-rename"]');
                ws.ui.bindListbox(el.querySelector('.wm-listbox'), (key) => { d.sel = key; btn.disabled = false; }, (key, on) => {
                    if (on) d.hidden.delete(key); else d.hidden.add(key);
                });
                btn.addEventListener('click', async () => {
                    const a = d.list.find((x) => x.id === d.sel);
                    if (a && await renameProgram(a)) pageApi.rerender();
                });
            },
            commit(d) {
                // a program that left the phone leaves the lists with it
                const have = new Set(d.list.map((a) => a.id));
                const hidden = new Set([...d.hidden].filter((id) => have.has(id)));
                writeSet(HIDDEN_KEY, hidden);
                writeSet(START_KEY, new Set([...readSet(START_KEY)].filter((id) => have.has(id) && !hidden.has(id))));
                refresh();
                return [HIDDEN_KEY, START_KEY, START_MENU_KEY];
            }
        });
    }

    // ---------------------------------------------------------------- Program Icons

    const job = { id: readJson(JOB_KEY, null), data: null, timer: null, live: null, lastState: null };

    // Custom's choices survive the trip to the Open dialog (the page draws a new draft on return)
    let customKept = null;

    /** Where an Open dialog item's picture is: a phone file, a gallery picture or scrap, a Dreamscape file. */
    async function pictureUrl(item) {
        if (item.phoneFile && window.phoneStorage) return window.phoneStorage.fileUrl(item.phoneFile.root, item.phoneFile.path);
        const galleryFile = (item.targetKind === 'image' || item.targetKind === 'scrap') ? (item.previewImageFilename || item.targetId)
            : (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) || null;
        if (galleryFile) return `/images/${encodeURIComponent(galleryFile)}`;
        /* global vfsClient */
        if (item.targetKind === 'user-file' && (item.targetId || item.id) && typeof vfsClient !== 'undefined') {
            const r = await vfsClient.downloadFile(item.targetId || item.id);
            return (r && r.downloadUrl) || null;
        }
        return null;
    }
    const pictureReadable = (i) => !!(i && (i.phoneFile || i.targetKind === 'image' || i.targetKind === 'scrap' || (i.shortcutType === 'image' && i.shortcutData) || i.targetKind === 'user-file'));

    /** A picture the Open dialog gave (a Dreamscape file, a gallery picture or a phone file) as a data URL. */
    async function pictureData(item) {
        try {
            const url = await pictureUrl(item);
            if (!url) return null;
            const res = await fetch(url, { credentials: 'same-origin' });
            if (!res.ok) return null;
            const blob = await res.blob();
            if (blob.size > 12 * 1024 * 1024) return null;
            return await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
        } catch (_) { return null; }
    }

    /** The program's own launcher icon (or with themed, its themed layer) as a data URL, 512 px. */
    async function iconData(a, themed) {
        try {
            const src = String(a.icon || '');
            const abs = src.startsWith('//') ? `${location.protocol}${src}` : src;
            const res = await fetch(`${abs}${abs.includes('?') ? '&' : '?'}s=512${themed ? '&mono=1' : ''}`);
            if (!res.ok) return null;
            const blob = await res.blob();
            return await new Promise((resolve) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = () => resolve(null);
                fr.readAsDataURL(blob);
            });
        } catch (_) { return null; }
    }

    function pageShown() {
        const el = job.live && job.live.el;
        return !!(el && el.isConnected && !el.closest('[hidden]') && sh.current === 'settings');
    }

    function rerenderLive() {
        // never under the user's typing (Custom's text box): the next poll redraws
        const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.wm-pi-direction');
        if (pageShown() && job.live.api && !typing) job.live.api.rerender();
    }

    function setJob(id, data) {
        job.id = id || null;
        job.data = data || null;
        if (id) writeJson(JOB_KEY, id); else { try { localStorage.removeItem(JOB_KEY); } catch (_) { /* gone */ } }
    }

    /** Watch the open batch: the page redraws as icons arrive; closed, a notification says when they are ready. */
    function poll(soon) {
        clearTimeout(job.timer);
        if (!job.id) return;
        job.timer = setTimeout(async () => {
            let j = null;
            try { j = await api(`/jobs/${encodeURIComponent(job.id)}`); } catch (err) {
                if (err.status === 404 || err.status === 403) { setJob(null); rerenderLive(); return; }
                poll(false);
                return;
            }
            if (!j.job || !Array.isArray(j.job.items)) { setJob(null); rerenderLive(); return; }
            const was = job.lastState;
            job.data = j.job;
            job.lastState = j.job.state;
            if (j.job.state === 'done' || j.job.state === 'cancelled') { setJob(null); rerenderLive(); return; }
            rerenderLive();
            if (j.job.state === 'working') { poll(false); return; }
            if (was === 'working' && !pageShown()) {
                const ready = j.job.items.filter((it) => it.state === 'ready').length;
                sh.notify({
                    title: 'Program Icons', icon: 'success', asNote: true,
                    text: `${ready} of ${j.job.items.length} program icon${j.job.items.length === 1 ? ' is' : 's are'} ready to review.`,
                    buttons: [{ text: 'View', onClick: () => { window.wmSettings.open(PAGE_ID, 'pi-results'); } }, { text: 'Dismiss' }]
                });
            }
        }, soon ? 300 : (pageShown() ? 3000 : 8000));
    }

    function registerIconsPage() {
        const ws = window.wmSettings;
        if (!ws || typeof ws.registerPage !== 'function' || !ws.ui) return;
        const ui = ws.ui;
        const esc = (s) => sh.escapeHtml(s);
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        const STATE_TEXT = { queued: 'Waiting', working: 'Making...', ready: 'Ready', failed: 'Failed' };
        const MODE_LABEL = Object.fromEntries(MODES);
        /** Style: Simple (the app's mark or one object) | Detailed (characters, signature objects). */
        const styleHtml = (name, now) => `<div class="wm-pi-style"><span>Style:</span>${MODES.map(([v, l]) => `<label class="wm-check"><input type="radio" name="${name}" value="${v}"${v === now ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
        const bindStyle = (el, name, set) => el.querySelectorAll(`input[name="${name}"]`).forEach((r) => r.addEventListener('change', () => { if (r.checked) set(r.value); }));

        function renderPrograms(el, d, pageApi) {
            const cells = d.list.map((a) => {
                const ic = iconOf(a);
                const src = sh.art.isSet && sh.art.isSet(ic) ? `${ic}-lg@4x.png` : ic;
                return `<button type="button" class="wm-icongrid-cell wm-pi-cell${d.sel.has(a.id) ? ' is-checked' : ''}" data-id="${esc(a.id)}" aria-pressed="${d.sel.has(a.id)}">
                    <span class="wm-icongrid-icon"><img src="${esc(src)}" alt="" draggable="false" loading="lazy"><i class="wm-pi-check"></i></span>
                    <span class="wm-icongrid-label"><span>${esc(labelOf(a))}</span></span></button>`;
            }).join('');
            const byId = new Map(d.list.map((a) => [a.id, a]));
            const anyWm = [...d.sel].some((id) => byId.has(id) && storeKey(byId.get(id)));
            el.innerHTML = `<p>Select the programs to give Windows Mobile icons, then tap Request. The server makes them; you can close Program Icons meanwhile.</p>
                <div class="wm-listbox wm-pi-scroll"><div class="wm-icongrid wm-pi-grid" role="list">${cells}</div></div>
                ${styleHtml('pi-style', d.mode)}
                ${ui.check('pi-themed', 'Send themed icons (the program\'s own one-colour mark)', d.themed)}
                ${ui.buttons([['request', job.id ? 'Request (busy)' : `Request${d.sel.size ? ` (${d.sel.size})` : ''}`, !d.sel.size || !!job.id], ['original', 'Use Android Icon', !anyWm]])}`;
            bindStyle(el, 'pi-style', (v) => { d.mode = v; try { localStorage.setItem(MODE_KEY, v); } catch (_) { /* this visit only */ } });
            el.querySelector('input[name="pi-themed"]').addEventListener('change', (e) => { d.themed = e.target.checked; try { localStorage.setItem(THEMED_KEY, d.themed ? '1' : '0'); } catch (_) { /* this visit only */ } });
            // a tap marks the cell where it is (no redraw: the grid keeps its scroll position)
            const syncButtons = () => {
                const req = el.querySelector('[data-act="request"]');
                req.textContent = job.id ? 'Request (busy)' : `Request${d.sel.size ? ` (${d.sel.size})` : ''}`;
                req.disabled = !d.sel.size || !!job.id;
                el.querySelector('[data-act="original"]').disabled = ![...d.sel].some((id) => byId.has(id) && storeKey(byId.get(id)));
            };
            el.querySelector('.wm-pi-grid').addEventListener('click', (e) => {
                const cell = e.target.closest('.wm-pi-cell');
                if (!cell) return;
                const id = cell.dataset.id;
                if (d.sel.has(id)) d.sel.delete(id); else d.sel.add(id);
                cell.classList.toggle('is-checked', d.sel.has(id));
                cell.setAttribute('aria-pressed', String(d.sel.has(id)));
                syncButtons();
            });
            el.querySelector('[data-act="request"]').addEventListener('click', async () => {
                const chosen = d.list.filter((a) => d.sel.has(a.id));
                if (!chosen.length || job.id) return;
                try {
                    const items = await sh.busy(async () => Promise.all(chosen.map(async (a) => ({ id: a.id, label: a.label, category: a.category || null, game: a.game === true, icon: await iconData(a), themed: d.themed && a.themed === true ? await iconData(a, true) : null }))), { paint: true, timeout: 30000 });
                    const j = await sh.busy(() => api('/jobs', { method: 'POST', body: { mode: d.mode, items } }), { paint: true, timeout: 60000 });
                    setJob(j.job.id, j.job);
                    job.lastState = 'working';
                    d.sel.clear();
                    poll(false);
                    await sh.messageBox({ title: 'Program Icons', icon: 'info', text: `The server is making ${j.job.items.length} icon${j.job.items.length === 1 ? '' : 's'}. You can close Program Icons: Melaton Mobile tells you when they are ready.` });
                    if (d.goTab) d.goTab('pi-results');
                } catch (err) {
                    void sh.messageBox({ title: 'Program Icons', icon: 'error', text: `The icons could not be requested. ${err.message}` });
                }
            });
            el.querySelector('[data-act="original"]').addEventListener('click', async () => {
                // the store keys these programs draw from (exact, or their package's)
                const ids = [...new Set([...d.sel].map((id) => byId.get(id)).filter(Boolean).map(storeKey).filter(Boolean))];
                if (!ids.length) return;
                const yes = await sh.messageBox({
                    title: 'Program Icons', icon: 'question',
                    text: `Use the Android icon again for ${ids.length === 1 ? 'this program' : `these ${ids.length} programs`}? Every phone goes back to it.`,
                    buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }], cancelValue: false
                });
                if (!yes) return;
                try {
                    let last = null;
                    await sh.busy(async () => { for (const id of ids) last = await api(`/store?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); }, { paint: true, timeout: 30000 });
                    if (last) applyStore(last);
                    d.sel.clear();
                    pageApi.rerender();
                } catch (err) {
                    void sh.messageBox({ title: 'Program Icons', icon: 'error', text: `The icons could not be changed. ${err.message}` });
                }
            });
        }

        /**
         * Custom: one program, a Style and what the icon should be, in the user's words (Yukimi,
         * Nov 12: "Apple Music: not the black and white icon, an iTunes-like one"). The server
         * follows the direction even where it conflicts with the program's own art.
         */
        function renderCustom(el, d, pageApi) {
            if (!d.customSel && d.sel.size === 1) d.customSel = [...d.sel][0];
            const rows = d.list.map((a) => {
                const ic = iconOf(a);
                return { key: a.id, label: labelOf(a), selected: a.id === d.customSel, img: sh.art.isSet && sh.art.isSet(ic) ? `${ic}.png` : ic };
            });
            el.innerHTML = `<p>Choose one program and a Style, then describe the icon you want.</p>
                ${ui.listbox(rows, { maxHeight: 120 }).replace('class="wm-listbox"', 'class="wm-listbox wm-pi-custom-list"')}
                ${styleHtml('pi-custom-style', d.customMode)}
                <textarea class="wm-edit wm-pi-direction" rows="4" maxlength="600" placeholder="For example: not the black and white icon, an iTunes-like one">${esc(d.customText || '')}</textarea>
                <div class="wm-pi-atts">${d.customAtt.length ? `Pictures: ${d.customAtt.map((x) => esc(x.name)).join(', ')}` : 'No pictures attached.'}</div>
                ${ui.buttons([['custom-attach', 'Attach...', d.customAtt.length >= 3], ['custom-clear', 'Clear', !d.customAtt.length], ['custom-request', job.id ? 'Request (busy)' : 'Request', true]])}`;
            const btn = el.querySelector('[data-act="custom-request"]');
            const sync = () => { btn.disabled = !!job.id || !d.customSel || !String(d.customText || '').trim(); };
            ui.bindListbox(el.querySelector('.wm-pi-custom-list'), (key) => { d.customSel = key; sync(); });
            bindStyle(el, 'pi-custom-style', (v) => { d.customMode = v; });
            el.querySelector('.wm-pi-direction').addEventListener('input', (e) => { d.customText = e.target.value; sync(); });
            sync();
            // a picture for the request from Dreamscape's files or the phone's storage (WM's Open dialog)
            el.querySelector('[data-act="custom-attach"]').addEventListener('click', () => {
                if (!window.wmFileDialogs || d.customAtt.length >= 3) return;
                customKept = { customSel: d.customSel, customMode: d.customMode, customText: d.customText, customAtt: d.customAtt };
                void window.wmFileDialogs.open({
                    title: 'Attach Picture', typeLabel: 'Pictures', pictures: true, phone: true,
                    accept: (i) => pictureReadable(i) && (i.targetKind === 'image' || i.targetKind === 'scrap' || /^image\//i.test(String(i.mimeType || '')) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(i.name || ''))),
                    onPick: async (item) => {
                        const data = await sh.busy(() => pictureData(item), { paint: true, timeout: 30000 });
                        if (!data) { await sh.messageBox({ title: 'Program Icons', icon: 'error', text: `"${item.name}" could not be read.` }); return false; }
                        customKept.customAtt = customKept.customAtt.concat([{ name: item.name, data }]);
                        if (window.wmSettings) window.wmSettings.open(PAGE_ID, 'pi-custom');
                        return true;
                    }
                });
            });
            el.querySelector('[data-act="custom-clear"]').addEventListener('click', () => { d.customAtt = []; pageApi.rerender(); });
            btn.addEventListener('click', async () => {
                const a = d.list.find((x) => x.id === d.customSel);
                const text = String(d.customText || '').trim();
                if (!a || !text || job.id) return;
                try {
                    const item = await sh.busy(async () => ({ id: a.id, label: a.label, category: a.category || null, game: a.game === true, direction: text, attachments: d.customAtt.map((x) => ({ name: x.name, data: x.data })), icon: await iconData(a), themed: d.themed && a.themed === true ? await iconData(a, true) : null }), { paint: true, timeout: 30000 });
                    const j = await sh.busy(() => api('/jobs', { method: 'POST', body: { mode: d.customMode, items: [item] } }), { paint: true, timeout: 60000 });
                    setJob(j.job.id, j.job);
                    job.lastState = 'working';
                    d.customText = '';
                    d.customAtt = [];
                    poll(false);
                    await sh.messageBox({ title: 'Program Icons', icon: 'info', text: `The server is making ${labelOf(a)}'s icon. You can close Program Icons: Melaton Mobile tells you when it is ready.` });
                    if (d.goTab) d.goTab('pi-results');
                } catch (err) {
                    void sh.messageBox({ title: 'Program Icons', icon: 'error', text: `The icon could not be requested. ${err.message}` });
                }
            });
        }

        function renderResults(el, d, pageApi) {
            const jd = job.id ? job.data : null;
            if (!jd) {
                el.innerHTML = `${job.id ? '<p>Reading the batch...</p>' : '<p>No icons are being made. Select programs on the Programs tab and tap Request.</p>'}`;
                return;
            }
            const items = jd.items;
            // a ready icon can be kept or made again; a failed one only made again
            const pickable = items.filter((it) => it.state === 'ready' || it.state === 'failed');
            for (const k of [...d.keep]) if (!pickable.some((it) => it.key === k)) d.keep.delete(k);
            const keepReady = () => [...d.keep].filter((k) => items.some((it) => it.key === k && it.state === 'ready'));
            const busy = jd.state === 'working';
            const done = items.filter((it) => it.state === 'ready' || it.state === 'failed').length;
            const rows = items.map((it) => {
                const pv = it.preview;
                const can = it.state === 'ready' || it.state === 'failed';
                return `<div class="wm-listbox-row wm-pi-row">
                    <label class="wm-check wm-pi-pick">${can ? `<input type="checkbox" data-key="${esc(it.key)}"${d.keep.has(it.key) ? ' checked' : ''}><span></span>` : '<span class="wm-pi-nobox"></span>'}
                    <span class="wm-pi-thumbs">${it.original ? `<img class="wm-pi-orig" src="${esc(it.original)}" alt="">` : ''}${pv ? `<img class="wm-pi-big" src="${esc(pv[128])}" alt=""><img class="wm-pi-small" src="${esc(pv[16])}" alt="">` : '<span class="wm-pi-big wm-pi-empty"></span>'}</span>
                    <span class="wm-pi-text"><b>${esc(it.label)}</b><span>${esc(it.state === 'failed' ? `Failed: ${it.error || ''}` : `${STATE_TEXT[it.state] || it.state}, ${MODE_LABEL[it.mode] || 'Detailed'}${it.direction ? ', custom' : ''}${it.note ? `. ${it.note}` : ''}`)}${it.attempt > 1 && it.state === 'ready' ? ` (try ${it.attempt})` : ''}</span></span></label></div>`;
            }).join('');
            el.innerHTML = `<p>${busy ? `Making icons: ${done} of ${items.length} finished. You can close Program Icons.` : 'Check the icons to keep, or to make again in the Style below, then tap Done or Regenerate.'}</p>
                <div class="wm-listbox wm-pi-list" style="max-height:calc(230 * var(--wm-px))">${rows}</div>
                ${styleHtml('pi-regen-style', d.regenMode)}
                ${ui.buttons([['regen', 'Regenerate', !d.keep.size], ['done', 'Done', busy || !items.some((it) => it.state === 'ready')], ['discard', 'Discard', false]])}`;
            // Regenerate makes the checked icons again in this Style (each row says which it has now)
            bindStyle(el, 'pi-regen-style', (v) => { d.regenMode = v; });
            el.querySelectorAll('input[data-key]').forEach((c) => c.addEventListener('change', () => {
                if (c.checked) d.keep.add(c.dataset.key); else d.keep.delete(c.dataset.key);
                pageApi.rerender();
            }));
            el.querySelector('[data-act="regen"]').addEventListener('click', async () => {
                if (!d.keep.size) return;
                try {
                    const j = await sh.busy(() => api(`/jobs/${encodeURIComponent(job.id)}/regenerate`, { method: 'POST', body: { keys: [...d.keep], mode: d.regenMode } }), { paint: true, timeout: 20000 });
                    job.data = j.job;
                    job.lastState = 'working';
                    d.keep.clear();
                    pageApi.rerender();
                    poll(false);
                } catch (err) { void sh.messageBox({ title: 'Program Icons', icon: 'error', text: `The icons could not be made again. ${err.message}` }); }
            });
            el.querySelector('[data-act="done"]').addEventListener('click', async () => {
                const keep = keepReady();
                const yes = await sh.messageBox({
                    title: 'Program Icons', icon: 'question',
                    text: keep.length
                        ? `Keep ${keep.length} icon${keep.length === 1 ? '' : 's'} for every phone? The others are discarded.`
                        : 'No icon is checked. Discard the whole batch?',
                    buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }], cancelValue: false
                });
                if (!yes) return;
                try {
                    const j = await sh.busy(() => api(`/jobs/${encodeURIComponent(job.id)}/done`, { method: 'POST', body: { accept: keep } }), { paint: true, timeout: 60000 });
                    setJob(null);
                    d.keep.clear();
                    applyStore(j.manifest);
                    pageApi.rerender();
                    if (j.saved && j.saved.length) {
                        await sh.messageBox({ title: 'Program Icons', icon: 'info', text: `${j.saved.length} icon${j.saved.length === 1 ? ' was' : 's were'} saved. Melaton Mobile now updates to get ${j.saved.length === 1 ? 'it' : 'them'}; other phones get ${j.saved.length === 1 ? 'it' : 'them'} with their next update.` });
                        // the server recompiled before answering: this phone's own update (Updates
                        // ready, then Restart Now) fetches the new icon files
                        try { const m = window.serviceWorkerManager; if (m && typeof m.checkStaticFileUpdates === 'function') void m.checkStaticFileUpdates(false); } catch (_) { /* the next update gets them */ }
                    }
                } catch (err) { void sh.messageBox({ title: 'Program Icons', icon: 'error', text: `The icons could not be saved. ${err.message}` }); }
            });
            el.querySelector('[data-act="discard"]').addEventListener('click', async () => {
                const yes = await sh.messageBox({
                    title: 'Program Icons', icon: 'question', text: 'Discard this batch? No icon is saved.',
                    buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }], cancelValue: false
                });
                if (!yes) return;
                try { await api(`/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' }); } catch (_) { /* gone already */ }
                setJob(null);
                d.keep.clear();
                pageApi.rerender();
            });
        }

        ws.registerPage({
            id: PAGE_ID, tab: 'personal', label: 'Program Icons', icon: 'app-program-icons',
            tabs: [['pi-programs', 'Programs'], ['pi-custom', 'Custom'], ['pi-results', 'Results']],
            init() {
                const hidden = readSet(HIDDEN_KEY);
                const list = read().filter((a) => a.role !== 'settings' && !ROLES[a.role] && !hidden.has(a.id)).sort((x, y) => coll.compare(x.label, y.label));
                const d = { list, sel: new Set(), keep: new Set(), mode: readMode(), regenMode: readMode(), themed: readThemed(), customSel: null, customMode: readMode(), customText: '', customAtt: [] };
                if (customKept) { Object.assign(d, customKept); customKept = null; }
                // a batch another phone started (or one this phone forgot): the newest open one
                if (!job.id) {
                    api('/jobs').then((j) => {
                        const first = j.jobs && j.jobs[0];
                        if (first && !job.id) { setJob(first.id, first); job.lastState = first.state; poll(true); rerenderLive(); }
                    }).catch(() => {});
                } else {
                    poll(true);
                }
                loadStore();
                return d;
            },
            render(el, tab, d, pageApi) {
                job.live = { el, api: pageApi };
                // the Request button moves to Results: the Settings host opens the page there
                d.goTab = (t) => { if (window.wmSettings) window.wmSettings.open(PAGE_ID, t); };
                if (tab === 'pi-results') renderResults(el, d, pageApi);
                else if (tab === 'pi-custom') renderCustom(el, d, pageApi);
                else renderPrograms(el, d, pageApi);
            },
            commit() { return []; }
        });
    }

    // ---------------------------------------------------------------- Android Bridge page (#776)

    const PHONE_DATA_KEY = 'wmPhoneData'; // { calendar: 'off' | 'show' | 'sync', contacts: ... }
    const PHONE_DATA = [['off', 'Off'], ['show', 'Show on this phone'], ['sync', 'Synchronize to Melaton']];

    function registerDefaultsPage() {
        const ws = window.wmSettings;
        if (!ws || typeof ws.registerPage !== 'function' || !ws.ui) return;
        const ui = ws.ui;
        const esc = (s) => sh.escapeHtml(s);
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        const pim = () => window.AndroidPim || null;
        ws.registerPage({
            id: 'default-programs', tab: 'system', label: 'Android Bridge', icon: 'app-android-bridge',
            // Phone Data lives in ActiveSync (Menu > Phone Data..., Yukimi, Nov 12, #777)
            tabs: [],
            init() {
                const hidden = readSet(HIDDEN_KEY);
                return {
                    map: Object.assign({}, readJson(DEFAULTS_KEY, {}) || {}),
                    list: read().filter((a) => a.role !== 'settings' && !hidden.has(a.id)).sort((x, y) => coll.compare(labelOf(x), labelOf(y)))
                };
            },
            render(el, tab, d) {
                const opts = [['', 'Melaton (built in)']].concat(d.list.map((a) => [a.id, labelOf(a)]));
                const sys = systemApps();
                el.innerHTML = `<p>Choose the program that opens for each of these. Built in opens Melaton Mobile's own.</p>
                    ${sys.map((x, i) => `<div class="wm-form-row is-wide"><span class="wm-form-label">${esc(x.title)}:</span>${ui.comboHtml(`dp-${i}`, (opts.find(([v]) => v === (d.map[x.id] || '')) || opts[0])[1])}</div>`).join('')}`;
                sys.forEach((x, i) => ui.bindCombo(el.querySelector(`[data-act="dp-${i}"]`), opts, d.map[x.id] || '', (v) => { if (v) d.map[x.id] = v; else delete d.map[x.id]; }));
            },
            commit(d) {
                writeJson(DEFAULTS_KEY, d.map);
                applyDefaults();
                return [DEFAULTS_KEY];
            }
        });
    }

    // ---------------------------------------------------------------- phone calendar and contacts (#776)

    /**
     * window.wmPhoneData: the phone's own calendar and contacts (DSApp AndroidPim, read only) for
     * Calendar (wmCalendar.js) and Contacts (wmNotes.js), per Android Bridge > Phone Data:
     *   show  merged in on this phone only (a read-only "Phone" calendar, the phone's contacts)
     *   sync  mirrored into the workspace: Calendars/Phone (<device>).ics (X-MELATON-SOURCE phone:,
     *         so read-only on every client) and Contacts/Phone contacts (<device>).vcf, rewritten
     *         from the phone (one way) at start, when switched on and every few hours
     */
    const phoneData = (() => {
        const pim = () => window.AndroidPim || null;
        const SYNC_EVERY_MS = 4 * 3600 * 1000;
        const PAST_MS = 60 * 86400000;
        const AHEAD_MS = 400 * 86400000;
        let syncing = null;
        const mode = (kind) => { const m = (readJson(PHONE_DATA_KEY, {}) || {})[kind]; return m === 'show' || m === 'sync' ? m : 'off'; };
        const available = () => !!(pim() && typeof pim().events === 'function');
        const granted = (kind) => { try { return !!JSON.parse(pim().status())[kind]; } catch (_) { return false; } };
        const device = () => { try { return (window.AndroidActiveSync && window.AndroidActiveSync.getDeviceName && window.AndroidActiveSync.getDeviceName()) || 'Phone'; } catch (_) { return 'Phone'; } };
        const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Phone';

        /** Android's permission, asked once; resolves true/false. */
        function access(kind) {
            if (!available()) return Promise.resolve(false);
            if (granted(kind)) return Promise.resolve(true);
            return new Promise((resolve) => {
                const done = (ok) => { window.removeEventListener('androidpim', on); clearTimeout(t); resolve(ok); };
                const on = (e) => { const d = e.detail || {}; if (d.kind === kind) done(!!d.granted); };
                const t = setTimeout(() => done(granted(kind)), 120000);
                window.addEventListener('androidpim', on);
                try { pim().request(kind); } catch (_) { done(false); }
            });
        }

        function events(from, to) {
            if (!available() || !granted('calendar')) return [];
            try { const l = JSON.parse(pim().events(from, to)); return Array.isArray(l) ? l : []; } catch (_) { return []; }
        }

        function contacts() {
            if (!available() || !granted('contacts')) return [];
            try { const l = JSON.parse(pim().contacts()); return Array.isArray(l) ? l : []; } catch (_) { return []; }
        }

        /** Calendar's event model (wmCalendar adopt()) for each phone occurrence. */
        function calendarEvents(from, to) {
            return events(from, to).map((e) => {
                const start = new Date(Number(e.start));
                let end = new Date(Number(e.end) || Number(e.start));
                // Android keeps all-day events at UTC midnight: the local date of that day
                const day = (d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
                return {
                    uid: `phone-${e.eventId}-${e.start}`, summary: e.title || '(no subject)', location: e.location || '', description: e.description || '', url: '',
                    start: e.allDay ? day(start) : start, end: e.allDay ? day(end) : end, allDay: !!e.allDay,
                    rrule: null, exdates: [], reminder: null, reminderAt: null, attendees: []
                };
            });
        }

        /** melatonVCard cards for the phone's contacts (marked with X-MELATON-PHONE). */
        function cards(VC) {
            return contacts().map((p) => {
                const c = VC.blank();
                c.uid = `phone-${device()}-${p.id}`.replace(/\s+/g, '-');
                c.first = p.given || '';
                c.last = p.family || '';
                c.fn = p.name || '';
                c.emails = (p.emails || []).map((x) => x.address).filter(Boolean);
                for (const ph of p.phones || []) {
                    if (ph.type === 'mobile' && !c.home.mobile) c.home.mobile = ph.number;
                    else if (ph.type === 'work' && !c.work.phone) c.work.phone = ph.number;
                    else if (!c.home.phone) c.home.phone = ph.number;
                    else if (!c.home.mobile) c.home.mobile = ph.number;
                }
                c.work.company = p.org || '';
                c.work.title = p.title || '';
                c.notes = p.note || '';
                c.birthday = p.birthday || '';
                c.categories = ['Phone'];
                c.extra = [`X-MELATON-PHONE:${device()}`];
                return c;
            });
        }

        const b64 = (text) => new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(new Blob([text], { type: 'text/plain' })); });
        /* global vfsClient, activeWorkspace */
        const wsRoot = () => { let w = 'Default'; try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) w = activeWorkspace; } catch (_) { /* none */ } return `/Workspaces/${w}`; };

        async function writeFile(folder, name, text, mime) {
            if (typeof vfsClient === 'undefined') throw new Error('Files are not available.');
            const root = wsRoot();
            const leaf = folder.slice(root.length + 1);
            try {
                const top = await vfsClient.listDirectory(root, { offset: 0, limit: 500 });
                if (!((top && top.items) || []).some((i) => i.kind === 'folder' && String(i.name).toLowerCase() === leaf.toLowerCase())) await vfsClient.createFolder(root, leaf);
            } catch (_) { /* the upload says */ }
            const res = await vfsClient.listDirectory(folder, { offset: 0, limit: 1000 });
            const old = ((res && res.items) || []).find((i) => i.name === name && i.kind !== 'folder');
            const data = await b64(text);
            if (old && typeof vfsClient.replaceFile === 'function') await vfsClient.replaceFile(old.targetId || old.id, data, mime);
            else await vfsClient.uploadFile(folder, data, name, mime);
        }

        /** Mirror the phone into the workspace (sync mode); one run at a time. */
        function syncNow(kinds) {
            if (syncing) return syncing;
            syncing = (async () => {
                const want = (kinds || ['calendar', 'contacts']).filter((k) => mode(k) === 'sync');
                for (const kind of want) {
                    if (!await access(kind)) continue;
                    try {
                        if (kind === 'calendar') {
                            if (!window.melatonApps || typeof window.melatonApps.ensureLoaded !== 'function') continue;
                            await window.melatonApps.ensureLoaded('calendar');
                            const MC = window.melatonCalendar;
                            if (!MC || typeof MC.toIcs !== 'function') continue;
                            const now = Date.now();
                            const cal = { name: `Phone (${device()})`, color: '#99ccff', source: `phone:${device()}`, refresh: 0, events: calendarEvents(now - PAST_MS, now + AHEAD_MS), tasks: [] };
                            await writeFile(`${wsRoot()}/Calendars`, `${safe(cal.name)}.ics`, MC.toIcs(cal), 'text/calendar');
                        } else {
                            if (!window.melatonVCard && window.featureLoader) await window.featureLoader._loadScript('scripts/comp/vcard.js');
                            const VC = window.melatonVCard;
                            if (!VC) continue;
                            const text = cards(VC).map((c) => VC.toVcf(c)).join('');
                            await writeFile(`${wsRoot()}/Contacts`, `${safe(`Phone contacts (${device()})`)}.vcf`, text, 'text/vcard');
                        }
                        try { localStorage.setItem(`wmPhoneDataSynced:${kind}`, String(Date.now())); } catch (_) { /* no record */ }
                    } catch (err) { console.warn('[wmPhoneData] sync', kind, err); }
                }
                document.dispatchEvent(new CustomEvent('wmPhoneDataUpdated', { detail: { kinds: want } }));
            })().finally(() => { syncing = null; });
            return syncing;
        }

        function start() {
            if (!available()) return;
            document.addEventListener('wmPhoneDataChange', async (e) => {
                const d = (e && e.detail) || {};
                for (const kind of ['calendar', 'contacts']) if (d[kind] && d[kind] !== 'off') await access(kind);
                await syncNow();
                document.dispatchEvent(new CustomEvent('wmPhoneDataUpdated', { detail: { kinds: ['calendar', 'contacts'] } }));
            });
            // at start (after the desktop work settles) and every few hours while the app runs
            setTimeout(() => { void syncNow(); }, 20000);
            setInterval(() => { void syncNow(); }, SYNC_EVERY_MS);
        }

        return { available, mode, access, granted, calendarEvents, cards, contacts, syncNow, start, device };
    })();
    window.wmPhoneData = phoneData;

    function register() {
        sh = window.wmShell;
        if (window.wmSettings && typeof window.wmSettings.addProgramFolder === 'function') {
            window.wmSettings.addProgramFolder(FOLDER, { label: 'Android', icon: 'app-folder-android' });
        }
        sync();
        registerRemoveTab();
        registerIconsPage();
        registerDefaultsPage();
        // system programs that register after this file still get their stand-in
        setTimeout(applyDefaults, 2500);
        phoneData.start();
        loadStore();
        if (job.id) poll(true);
        // a program was installed, removed or changed
        let timer = null;
        window.addEventListener('androidapps', () => { clearTimeout(timer); timer = setTimeout(refresh, 800); });
    }

    window.wmAndroidApps = { sync, refresh, list: () => apps.slice(), store: () => store };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
