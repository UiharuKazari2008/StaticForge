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
    const CAMERA_PINNED_KEY = 'wmCameraStartPinned'; // the Camera was put on a saved Start list once (#788)
    const FOLDER = 'android';
    // a work profile's programs (DSApp: profile 'work', id ...@u<serial>) in a folder of their own (#777)
    const WORK_FOLDER = 'work';
    let workFolderAdded = false;
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
        if (!role && a.profile !== 'work') {
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
            // another profile's processes (a work program) are not this app's to stop
            disabled: !has('forceStop') || a.profile === 'work',
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
        // the Work folder once the phone has a work profile with programs (wmSettings.addProgramFolder)
        if (!workFolderAdded && apps.some((a) => a.profile === 'work') && window.wmSettings && typeof window.wmSettings.addProgramFolder === 'function') {
            window.wmSettings.addProgramFolder(WORK_FOLDER, { label: 'Work', icon: 'app-folder-work' });
            workFolderAdded = true;
        }
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
                // 'bottom': on Start under the pinned programs; 'programs': in Programs only. The
                // phone's camera is WM's Camera, pinned on the Start menu (Yukimi #788)
                inStart: role === 'camera' ? 'top' : (onStart.has(a.id) ? 'bottom' : 'programs'),
                programsFolder: role ? undefined : a.profile === 'work' ? WORK_FOLDER : (inGames(a) ? 'games' : FOLDER),
                // the Camera through wmCamera.js: Pictures & Videos reads the cards again on return
                launch: () => (role === 'camera' && window.wmCamera ? window.wmCamera.open() : start(a)),
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
                // the Camera (role camera) stays where Settings > Menus has it; it joins the list once
                const cam = apps.find((a) => a.role === 'camera' && !hidden.has(a.id));
                const camId = cam ? shellId(cam) : null;
                const next = saved.filter((id) => !String(id).startsWith('android:') || id === camId);
                if (camId && !next.includes(camId) && localStorage.getItem(CAMERA_PINNED_KEY) !== '1') next.push(camId);
                if (camId) localStorage.setItem(CAMERA_PINNED_KEY, '1');
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
        const PHOTO_URL = /^https:\/\/appassets\.androidplatform\.net\/contact-photo\//;
        let syncing = null;
        const mode = (kind) => { const m = (readJson(PHONE_DATA_KEY, {}) || {})[kind]; return m === 'show' || m === 'sync' ? m : 'off'; };
        const available = () => !!(pim() && typeof pim().events === 'function');
        const st = () => { try { return JSON.parse(pim().status()) || {}; } catch (_) { return {}; } };
        const granted = (kind) => !!st()[kind];
        const canWrite = (kind) => !!st()[kind === 'calendar' ? 'calendarWrite' : 'contactsWrite'] && typeof pim()[kind === 'calendar' ? 'saveEvent' : 'saveContact'] === 'function';
        const device = () => { try { return (window.AndroidActiveSync && window.AndroidActiveSync.getDeviceName && window.AndroidActiveSync.getDeviceName()) || 'Phone'; } catch (_) { return 'Phone'; } };
        const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Phone';
        const parse = (fn, ...a) => { try { const v = JSON.parse(pim()[fn](...a)); return v; } catch (_) { return null; } };
        /** On this phone, Calendar and Contacts use the phone's data live (Show and Synchronize alike). */
        const live = (kind) => available() && mode(kind) !== 'off' && granted(kind);

        /** Android's permission (read + write), asked once; resolves true/false. */
        function access(kind) {
            if (!available()) return Promise.resolve(false);
            if (granted(kind) && (canWrite(kind) || typeof pim().saveEvent !== 'function')) return Promise.resolve(true);
            return new Promise((resolve) => {
                const done = (ok) => { window.removeEventListener('androidpim', on); clearTimeout(t); resolve(ok); };
                const on = (e) => { const d = e.detail || {}; if (d.kind === kind) done(!!d.granted); };
                const t = setTimeout(() => done(granted(kind)), 120000);
                window.addEventListener('androidpim', on);
                try { pim().request(kind); } catch (_) { done(false); }
            });
        }

        // ---------------------------------------------------------------- calendar

        const MCx = () => window.melatonCalendar || null;
        /** Android's RRULE text as the calendar package's rule ({ freq, interval, count, until, byday ... }). */
        function ruleOf(text) {
            const MC = MCx();
            if (!text || !MC) return null;
            try { return (MC.parseIcs(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20000101T000000Z\r\nRRULE:${text}\r\nEND:VEVENT\r\nEND:VCALENDAR`).events[0] || {}).rrule || null; } catch (_) { return null; }
        }
        function ruleText(r) {
            const MC = MCx();
            if (!r || !MC) return null;
            try {
                const ics = MC.toIcs({ name: 'x', color: '#ffffff', source: '', refresh: 0, tasks: [], events: [{ uid: 'x', summary: '', location: '', description: '', url: '', start: new Date(0), end: new Date(3600000), allDay: false, rrule: r, exdates: [], reminder: null, reminderAt: null, attendees: [] }] });
                const m = /RRULE:([^\r\n]+)/.exec(ics);
                return m ? m[1] : null;
            } catch (_) { return null; }
        }
        // "P3600S", "PT1H30M", "P1D", "P2W"
        const durMs = (d) => {
            const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(d || ''));
            if (!m) return 3600000;
            return ((+m[1] || 0) * 604800 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0)) * 1000;
        };
        // Android keeps all-day times at UTC midnight: the local date of that day, and back
        const dayOf = (ms) => { const d = new Date(ms); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
        const utcDay = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
        const icsTime = (ms, allDay) => (allDay ? new Date(ms).toISOString().slice(0, 10).replace(/-/g, '') : new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''));
        const exParse = (text, allDay) => String(text || '').split(/[,;\n]/).map((x) => x.replace(/^.*:/, '').trim()).filter(Boolean).map((x) => {
            const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(x);
            if (!m) return null;
            if (!m[4]) return allDay ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : Date.UTC(+m[1], +m[2] - 1, +m[3]);
            return m[7] ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
        }).filter((x) => x != null);

        /** One Android event as Calendar's model; the original rides along for the write back. */
        function eventModel(e) {
            const allDay = !!e.allDay;
            const startMs = Number(e.start);
            const endMs = e.end != null ? Number(e.end) : startMs + durMs(e.duration);
            const alert = (e.reminders || []).find((r) => r.method === 1 || r.method === 0);
            const own = exParse(e.exdate, allDay);
            return {
                uid: `phone-${e.id}`, summary: e.title || '', location: e.location || '', description: e.description || '', url: '',
                start: allDay ? dayOf(startMs) : new Date(startMs), end: allDay ? dayOf(endMs) : new Date(endMs), allDay,
                rrule: ruleOf(e.rrule), exdates: own.slice(), reminder: alert ? Number(alert.minutes) || 0 : null, reminderAt: null,
                attendees: (e.attendees || []).filter((a) => a.email && a.relationship !== 2).map((a) => ({ name: a.name || '', email: a.email })),
                phone: { id: e.id, orig: e, ownExdates: own }
            };
        }

        /** The phone's calendars for Calendar (one per Android calendar it shows), events from-to. */
        function calendarSets(from, to) {
            if (!live('calendar')) return [];
            const cals = (parse('calendars') || []).filter((c) => c.visible);
            const events = parse('events', from, to) || [];
            const byCal = new Map(cals.map((c) => [c.id, []]));
            const models = new Map();
            for (const e of events) {
                if (!byCal.has(e.calendarId)) continue;
                const m = eventModel(e);
                models.set(e.id, m);
                byCal.get(e.calendarId).push(m);
            }
            // an exception replaces one occurrence of its series: the series skips that start
            for (const e of events) {
                if (e.originalId == null || e.originalStart == null) continue;
                const s = models.get(e.originalId);
                if (!s) continue;
                const t = e.originalAllDay ? dayOf(Number(e.originalStart)).getTime() : Number(e.originalStart);
                s.exdates.push(t);
                (s.phone._exc = s.phone._exc || []).push(t);
            }
            return cals.map((c) => ({ cal: c, events: byCal.get(c.id) || [] }));
        }

        const evSig = (ev) => JSON.stringify([ev.summary, ev.location, ev.description, +new Date(ev.start), +new Date(ev.end), !!ev.allDay, ev.rrule || null, (ev.exdates || []).slice().sort(), ev.reminder, ev.reminderAt ? +new Date(ev.reminderAt) : null, (ev.attendees || []).map((a) => a.email)]);

        /** Calendar's model back to Android's row, keeping what Calendar does not show. */
        function androidEvent(ev, calendarId) {
            const o = (ev.phone && ev.phone.orig) || {};
            const allDay = !!ev.allDay;
            const start = allDay ? utcDay(new Date(ev.start)) : +new Date(ev.start);
            const end = allDay ? utcDay(new Date(ev.end)) : +new Date(ev.end);
            const out = { calendarId, title: ev.summary || '', location: ev.location || '', description: ev.description || '', start, end, allDay, timezone: allDay ? 'UTC' : (o.allDay ? '' : o.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone };
            if (ev.phone) out.id = ev.phone.id;
            // the rule: Android's own text when the form left it as it was (it may hold parts Calendar
            // has no field for), else the rule written again
            const origRule = ruleOf(o.rrule);
            out.rrule = ev.rrule ? (o.rrule && JSON.stringify(origRule) === JSON.stringify(ev.rrule) ? o.rrule : ruleText(ev.rrule)) : null;
            if (out.rrule) out.duration = `P${Math.max(60, Math.round((end - start) / 1000))}S`;
            // the series' own skipped dates (the exceptions' starts are Android's to keep)
            const own = ev.phone ? ev.phone.ownExdates : [];
            const added = (ev.exdates || []).filter((x) => !(ev.phone && ev.phone._exc && ev.phone._exc.includes(x)));
            out.exdate = JSON.stringify(added.slice().sort()) === JSON.stringify(own.slice().sort()) ? (o.exdate || null) : (added.length ? added.map((x) => icsTime(x, allDay)).join(',') : null);
            // reminders: the first alert is Calendar's; the others stay
            const rest = (o.reminders || []).filter((r, i, a) => r !== a.find((x) => x.method === 1 || x.method === 0));
            const minutes = ev.reminderAt ? Math.max(0, Math.round((start - +new Date(ev.reminderAt)) / 60000)) : ev.reminder;
            out.reminders = (minutes != null ? [{ minutes, method: 1 }] : []).concat(rest);
            // attendees: the organizer and every known one keep their status
            const known = new Map((o.attendees || []).map((a) => [String(a.email).toLowerCase(), a]));
            out.attendees = (o.attendees || []).filter((a) => a.relationship === 2)
                .concat((ev.attendees || []).map((a) => Object.assign({ status: 0, type: 1, relationship: 1 }, known.get(String(a.email).toLowerCase()) || {}, { name: a.name || '', email: a.email })));
            ['availability', 'accessLevel'].forEach((k) => { if (o[k] != null) out[k] = o[k]; });
            return out;
        }

        /** wmCalendar save(cal) for a phone calendar: what changed since it was read goes to Android. */
        async function saveCalendar(cal) {
            if (!canWrite('calendar')) throw new Error('Melaton Mobile may not change the phone\'s calendar. Allow it in ActiveSync > Menu > Phone Data...');
            const snap = cal.phoneSnap || new Map();
            const now = new Map(cal.events.map((ev) => [ev.uid, ev]));
            for (const ev of cal.events) {
                const was = snap.get(ev.uid);
                if (was && was === evSig(ev)) continue;
                const r = JSON.parse(pim().saveEvent(JSON.stringify(androidEvent(ev, cal.phone.calendarId))));
                if (!r || !r.ok) throw new Error(`The appointment could not be saved on the phone${r && r.error ? ` (${r.error})` : ''}.`);
                if (!ev.phone) { ev.phone = { id: r.id, orig: null, ownExdates: [] }; ev.uid = `phone-${r.id}`; }
            }
            for (const [uid] of snap) {
                if (now.has(uid)) continue;
                const id = Number(String(uid).replace(/^phone-/, ''));
                if (id && !pim().deleteEvent(id)) throw new Error('The appointment could not be deleted on the phone.');
            }
            cal.phoneSnap = new Map(cal.events.map((ev) => [ev.uid, evSig(ev)]));
            document.dispatchEvent(new CustomEvent('wmPhoneDataLocalChange', { detail: { kind: 'calendar' } }));
            return true;
        }

        /** Calendar's calendars from the phone (wmCalendar load), each with its snapshot for saving. */
        function calendarModels(from, to, nextId) {
            const writable = canWrite('calendar');
            return calendarSets(from, to).map(({ cal, events }, i) => ({
                id: nextId(i), name: cal.name || 'Phone', color: cal.color || '#99ccff', source: `phone:${device()}`, refresh: 0, fileId: null, fileName: null,
                events, tasks: [], visible: true, readonly: !(writable && cal.writable), phone: { calendarId: cal.id },
                phoneSnap: new Map(events.map((ev) => [ev.uid, evSig(ev)]))
            }));
        }

        // ---------------------------------------------------------------- contacts

        // Android type numbers (ContactsContract.CommonDataKinds)
        const PH = { HOME: 1, MOBILE: 2, WORK: 3, FAX_WORK: 4, FAX_HOME: 5, PAGER: 6, OTHER: 7, MAIN: 12, WORK_MOBILE: 17, WORK_PAGER: 18 };
        const PHONE_SLOTS = [['home', 'phone', [PH.HOME, PH.MAIN, PH.OTHER]], ['home', 'mobile', [PH.MOBILE]], ['home', 'fax', [PH.FAX_HOME]], ['work', 'phone', [PH.WORK, PH.WORK_MOBILE]], ['work', 'fax', [PH.FAX_WORK]], ['work', 'pager', [PH.PAGER, PH.WORK_PAGER]]];
        const SLOT_TYPE = { 'home.phone': PH.HOME, 'home.mobile': PH.MOBILE, 'home.fax': PH.FAX_HOME, 'work.phone': PH.WORK, 'work.fax': PH.FAX_WORK, 'work.pager': PH.PAGER };
        const ADDR = { HOME: 1, WORK: 2 };
        const WEB = { HOMEPAGE: 1, HOME: 4, WORK: 5 };
        const EVT = { ANNIVERSARY: 1, BIRTHDAY: 3 };
        const REL = { CHILD: 3, PARTNER: 10, SPOUSE: 14 };

        /** One Android contact as a Melaton card; .map says which Android rows went into which field. */
        function cardOf(VC, p) {
            const c = VC.blank();
            const map = { phones: {}, addresses: {}, websites: {}, events: {}, relations: [] };
            c.uid = `phone-${p.id}`;
            const n = p.name || {};
            c.first = n.given || ''; c.middle = n.middle || ''; c.last = n.family || ''; c.prefix = n.prefix || ''; c.suffix = n.suffix || '';
            c.fn = n.display || [c.first, c.middle, c.last].filter(Boolean).join(' ');
            c.nickname = p.nickname || '';
            c.emails = (p.emails || []).map((x) => x.address).filter(Boolean);
            const phones = p.phones || [];
            const used = new Set();
            for (const [grp, key, types] of PHONE_SLOTS) {
                const i = phones.findIndex((x, k) => !used.has(k) && types.includes(Number(x.type)));
                if (i >= 0) { c[grp][key] = phones[i].number; used.add(i); map.phones[`${grp}.${key}`] = i; }
            }
            // other voice numbers fill the voice fields still empty (never a fax or pager field: no
            // number shows under a wrong name); what still has no field stays on the phone as it is
            const VOICE = new Set(['home.phone', 'home.mobile', 'work.phone']);
            phones.forEach((x, k) => {
                if (used.has(k) || [PH.FAX_HOME, PH.FAX_WORK, PH.PAGER, PH.WORK_PAGER].includes(Number(x.type))) return;
                const slot = PHONE_SLOTS.find(([grp, key]) => VOICE.has(`${grp}.${key}`) && !c[grp][key] && !(`${grp}.${key}` in map.phones));
                if (slot) { c[slot[0]][slot[1]] = x.number; used.add(k); map.phones[`${slot[0]}.${slot[1]}`] = k; }
            });
            const addrs = p.addresses || [];
            const ai = { home: addrs.findIndex((a) => Number(a.type) === ADDR.HOME), work: addrs.findIndex((a) => Number(a.type) === ADDR.WORK) };
            if (ai.home < 0) ai.home = addrs.findIndex((a, k) => k !== ai.work);
            for (const grp of ['home', 'work']) {
                const a = addrs[ai[grp]];
                if (!a) continue;
                Object.assign(c[grp], { street: [a.street, a.pobox, a.neighborhood].filter(Boolean).join('\n'), city: a.city || '', region: a.region || '', postal: a.postcode || '', country: a.country || '' });
                map.addresses[grp] = ai[grp];
            }
            const org = p.org || {};
            Object.assign(c.work, { company: org.company || '', title: org.title || '', department: org.department || '', office: org.office || '' });
            const webs = p.websites || [];
            const wi = { work: webs.findIndex((w) => Number(w.type) === WEB.WORK) };
            wi.home = webs.findIndex((w, k) => k !== wi.work);
            for (const grp of ['home', 'work']) if (webs[wi[grp]]) { c[grp].url = webs[wi[grp]].url; map.websites[grp] = wi[grp]; }
            const evs = p.events || [];
            const bi = evs.findIndex((e) => Number(e.type) === EVT.BIRTHDAY);
            const an = evs.findIndex((e) => Number(e.type) === EVT.ANNIVERSARY);
            const day = (s) => String(s || '').replace(/^--/, '1604-');
            if (bi >= 0) { c.birthday = day(evs[bi].date); map.events.birthday = bi; }
            if (an >= 0) { c.anniversary = day(evs[an].date); map.events.anniversary = an; }
            (p.relations || []).forEach((r, k) => {
                const t = Number(r.type);
                if ((t === REL.SPOUSE || t === REL.PARTNER) && !c.spouse) { c.spouse = r.name; map.relations.push(k); } else if (t === REL.CHILD) { c.children.push(r.name); map.relations.push(k); }
            });
            c.notes = p.note || '';
            c.photo = p.photo || '';
            c.categories = ['Phone'];
            c.extra = [`X-MELATON-PHONE:${device()}`];
            return { card: c, map };
        }

        /** The card back as the full Android contact: changed fields replaced, rows with no field kept. */
        function androidContact(c, orig, map) {
            const o = orig ? JSON.parse(JSON.stringify(orig)) : { phones: [], emails: [], addresses: [], websites: [], ims: [], events: [], relations: [], org: {}, name: {} };
            map = map || { phones: {}, addresses: {}, websites: {}, events: {}, relations: [] };
            o.name = Object.assign({}, o.name, { prefix: c.prefix, given: c.first, middle: c.middle, family: c.last, suffix: c.suffix, display: c.fn || [c.first, c.middle, c.last].filter(Boolean).join(' ') });
            o.nickname = c.nickname || null;
            o.note = c.notes || null;
            // phones: the six fields, then the numbers that had no field
            const keepPhones = (o.phones || []).filter((_, k) => !Object.values(map.phones).includes(k));
            const slotPhones = Object.keys(SLOT_TYPE).map((slot) => {
                const [grp, key] = slot.split('.');
                const v = c[grp][key];
                if (!v) return null;
                const was = map.phones[slot] != null ? orig.phones[map.phones[slot]] : null;
                return was && was.number === v ? was : { number: v, type: was ? was.type : SLOT_TYPE[slot], label: was ? was.label : undefined };
            }).filter(Boolean);
            o.phones = slotPhones.concat(keepPhones);
            const byAddr = new Map((orig ? orig.emails : []).map((e) => [String(e.address).toLowerCase(), e]));
            o.emails = c.emails.filter(Boolean).map((a) => byAddr.get(String(a).toLowerCase()) || { address: a, type: 1 });
            const keepAddr = (o.addresses || []).filter((_, k) => !Object.values(map.addresses).includes(k));
            const addr = ['home', 'work'].map((grp) => {
                const g = c[grp];
                if (!(g.street || g.city || g.region || g.postal || g.country)) return null;
                const was = map.addresses[grp] != null ? orig.addresses[map.addresses[grp]] : null;
                return Object.assign({}, was || {}, { street: g.street || '', pobox: '', neighborhood: '', city: g.city || '', region: g.region || '', postcode: g.postal || '', country: g.country || '', type: was ? was.type : ADDR[grp.toUpperCase()] });
            }).filter(Boolean);
            o.addresses = addr.concat(keepAddr);
            o.org = Object.assign({}, o.org, { company: c.work.company, title: c.work.title, department: c.work.department, office: c.work.office });
            const keepWeb = (o.websites || []).filter((_, k) => !Object.values(map.websites).includes(k));
            o.websites = ['home', 'work'].map((grp) => (c[grp].url ? { url: c[grp].url, type: grp === 'work' ? WEB.WORK : WEB.HOMEPAGE } : null)).filter(Boolean).concat(keepWeb);
            const keepEv = (o.events || []).filter((_, k) => !Object.values(map.events).includes(k));
            const undayed = (s) => String(s || '').replace(/^1604-/, '--');
            o.events = [c.birthday ? { date: undayed(c.birthday), type: EVT.BIRTHDAY } : null, c.anniversary ? { date: undayed(c.anniversary), type: EVT.ANNIVERSARY } : null].filter(Boolean).concat(keepEv);
            const keepRel = (o.relations || []).filter((_, k) => !map.relations.includes(k));
            o.relations = (c.spouse ? [{ name: c.spouse, type: REL.SPOUSE }] : []).concat((c.children || []).filter(Boolean).map((k) => ({ name: k, type: REL.CHILD }))).concat(keepRel);
            // the photo: unchanged is left out (kept), a new picture sent, a removed one cleared
            if (!c.photo) { if (orig && orig.photo) o.photo = null; else delete o.photo; } else if (/^data:image\//.test(c.photo)) o.photo = c.photo; else delete o.photo;
            return o;
        }

        /** Contacts' entries from the phone (wmNotes load); each keeps its Android contact. */
        function contactEntries(VC) {
            if (!live('contacts')) return [];
            const writable = canWrite('contacts');
            return (parse('contacts') || []).filter((p) => p && ((p.name && p.name.display) || (p.phones || []).length || (p.emails || []).length)).map((p) => {
                const { card, map } = cardOf(VC, p);
                return { c: card, key: `phone:${p.id}`, fileId: null, index: 0, count: 1, fileName: null, item: null, path: null, phone: { id: p.id, orig: p, map, writable } };
            });
        }

        /** Contacts' save for a phone entry (or a new card for the phone): Android gets the whole contact. */
        function saveContact(card, phone) {
            if (!canWrite('contacts')) throw new Error('Melaton Mobile may not change the phone\'s contacts. Allow it in ActiveSync > Menu > Phone Data...');
            const r = JSON.parse(pim().saveContact(JSON.stringify(androidContact(card, phone && phone.orig, phone && phone.map))));
            if (!r || !r.ok) throw new Error(`The contact could not be saved on the phone${r && r.error ? ` (${r.error})` : ''}.`);
            document.dispatchEvent(new CustomEvent('wmPhoneDataLocalChange', { detail: { kind: 'contacts' } }));
            return r;
        }

        function deleteContact(phone) {
            if (!canWrite('contacts')) throw new Error('Melaton Mobile may not change the phone\'s contacts. Allow it in ActiveSync > Menu > Phone Data...');
            if (!pim().deleteContact(Number(phone.id))) throw new Error('The contact could not be deleted on the phone.');
            document.dispatchEvent(new CustomEvent('wmPhoneDataLocalChange', { detail: { kind: 'contacts' } }));
            return true;
        }

        // ---------------------------------------------------------------- the mirror (Synchronize)

        const b64 = (text) => new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(new Blob([text], { type: 'text/plain' })); });
        /* global vfsClient, activeWorkspace */
        const wsRoot = () => { let w = 'Default'; try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) w = activeWorkspace; } catch (_) { /* none */ } return `/Workspaces/${w}`; };

        async function listOf(folder) {
            try { const r = await vfsClient.listDirectory(folder, { offset: 0, limit: 1000 }); return (r && r.items) || []; } catch (_) { return []; }
        }

        async function writeFile(folder, name, text, mime) {
            if (typeof vfsClient === 'undefined') throw new Error('Files are not available.');
            const root = wsRoot();
            const leaf = folder.slice(root.length + 1);
            const top = await listOf(root);
            if (!top.some((i) => i.kind === 'folder' && String(i.name).toLowerCase() === leaf.toLowerCase())) { try { await vfsClient.createFolder(root, leaf); } catch (_) { /* the upload says */ } }
            const old = (await listOf(folder)).find((i) => i.name === name && i.kind !== 'folder');
            const data = await b64(text);
            if (old && typeof vfsClient.replaceFile === 'function') await vfsClient.replaceFile(old.targetId || old.id, data, mime);
            else await vfsClient.uploadFile(folder, data, name, mime);
        }

        /** A contact photo as a small data URL for the mirror's vCard (256 px JPEG). */
        async function photoData(url) {
            try {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
                const s = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
                const cv = document.createElement('canvas');
                cv.width = Math.max(1, Math.round(img.naturalWidth * s));
                cv.height = Math.max(1, Math.round(img.naturalHeight * s));
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                return cv.toDataURL('image/jpeg', 0.85);
            } catch (_) { return ''; }
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
                            const MC = MCx();
                            if (!MC || typeof MC.toIcs !== 'function') continue;
                            const now = Date.now();
                            const folder = `${wsRoot()}/Calendars`;
                            const written = new Set();
                            // one file per calendar the phone shows: "Phone - <name> (<device>).ics"
                            for (const { cal, events } of calendarSets(now - PAST_MS, now + AHEAD_MS)) {
                                // a calendar with nothing in the window gets no file (an old one is trashed below)
                                if (!events.length) continue;
                                const name = `${safe(`Phone - ${cal.name || 'Calendar'} (${device()})`)}.ics`;
                                const out = { name: `${cal.name || 'Calendar'} (${device()})`, color: cal.color || '#99ccff', source: `phone:${device()}`, refresh: 0, tasks: [], events: events.map((ev) => Object.assign({}, ev, { phone: undefined })) };
                                await writeFile(folder, name, MC.toIcs(out), 'text/calendar');
                                written.add(name);
                            }
                            // calendars the phone no longer shows (and the first single-file mirror) go
                            const suffix = `(${safe(device())}).ics`;
                            const stale = (await listOf(folder)).filter((i) => i.kind !== 'folder' && String(i.name).endsWith(suffix) && /^Phone( - |\s*\()/.test(i.name) && !written.has(i.name));
                            if (stale.length && typeof vfsClient.moveToTrash === 'function') { try { await vfsClient.moveToTrash(stale.map((i) => ({ id: i.id, name: i.name, kind: i.kind, targetKind: i.targetKind, targetId: i.targetId, isShortcut: false, isUserFileLink: false, isDesktopShortcut: false, isVfsShortcutEntry: false, workspaceId: i.workspaceId, size: i.size, modifiedAt: i.modifiedAt, mimeType: i.mimeType || undefined })), folder); } catch (_) { /* next time */ } }
                        } else {
                            if (!window.melatonVCard && window.featureLoader) await window.featureLoader._loadScript('scripts/comp/vcard.js');
                            const VC = window.melatonVCard;
                            if (!VC) continue;
                            const cards = contactEntries(VC).map((e) => e.c);
                            // every field, the photo too (as a small JPEG in the card)
                            for (const c of cards) if (PHOTO_URL.test(c.photo || '')) c.photo = await photoData(c.photo);
                            await writeFile(`${wsRoot()}/Contacts`, `${safe(`Phone contacts (${device()})`)}.vcf`, cards.map((c) => VC.toVcf(c)).join(''), 'text/vcard');
                        }
                        try { localStorage.setItem(`wmPhoneDataSynced:${kind}`, String(Date.now())); } catch (_) { /* no record */ }
                    } catch (err) { console.warn('[wmPhoneData] sync', kind, err); }
                }
                document.dispatchEvent(new CustomEvent('wmPhoneDataUpdated', { detail: { kinds: want } }));
            })().finally(() => { syncing = null; });
            return syncing;
        }

        /** The mirror file of this phone (read live on the phone instead). */
        function isOwnMirror(name, source) {
            const d = device();
            if (source && source === `phone:${d}`) return true;
            return String(name || '') === `${safe(`Phone contacts (${d})`)}.vcf`;
        }

        function start() {
            if (!available()) return;
            document.addEventListener('wmPhoneDataChange', async (e) => {
                const d = (e && e.detail) || {};
                for (const kind of ['calendar', 'contacts']) if (d[kind] && d[kind] !== 'off') await access(kind);
                await syncNow();
                document.dispatchEvent(new CustomEvent('wmPhoneDataUpdated', { detail: { kinds: ['calendar', 'contacts'] } }));
            });
            // an edit made here reaches the mirror soon after
            let soon = null;
            document.addEventListener('wmPhoneDataLocalChange', (e) => {
                const kind = e.detail && e.detail.kind;
                clearTimeout(soon);
                soon = setTimeout(() => { void syncNow(kind ? [kind] : undefined); }, 4000);
            });
            setTimeout(() => { void syncNow(); }, 20000);
            setInterval(() => { void syncNow(); }, SYNC_EVERY_MS);
        }

        return { available, mode, live, access, granted, canWrite, calendarModels, saveCalendar, contactEntries, saveContact, deleteContact, syncNow, start, device, isOwnMirror, PHOTO_URL };
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
