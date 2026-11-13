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
    const inGames = (a) => {
        const o = readJson(GAMES_KEY, {});
        return o && Object.prototype.hasOwnProperty.call(o, a.id) ? o[a.id] === true : a.game === true;
    };

    function start(a) {
        let ok = false;
        try { ok = bridge.launch(a.id) === true; } catch (_) { ok = false; }
        if (!ok) void sh.messageBox({ title: a.label, text: `${a.label} could not be started. It may have been removed from the device.`, icon: 'warning' });
    }

    /** Redraw Programs and Start after a change (wmPrograms / wmStart65 listen). */
    function refresh() {
        sync();
        document.dispatchEvent(new CustomEvent('wmAppsChanged'));
    }

    // ---------------------------------------------------------------- tap-and-hold menu

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
        rows.push('-', {
            label: 'Hide program',
            action: async () => {
                const yes = await sh.messageBox({
                    title: 'Hide program', icon: 'question',
                    text: `Hide ${a.label}? It leaves Programs and Start. Settings > Remove Programs > Android shows it again.`,
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
            action: () => { let ok = false; try { ok = bridge.info(a.id) === true; } catch (_) { ok = false; } if (!ok) void sh.messageBox({ title: a.label, icon: 'warning', text: `There is no information for ${a.label}. It may have been removed from the device.` }); }
        }, {
            label: 'End Task',
            disabled: !has('forceStop'),
            action: () => { let ok = false; try { ok = bridge.forceStop(a.id) === true; } catch (_) { ok = false; } if (!ok) void sh.messageBox({ title: 'End Task', icon: 'warning', text: `${a.label} could not be ended.` }); }
        }, '-', {
            label: 'Remove program',
            disabled: !has('uninstall') || a.removable === false,
            // Android asks itself (its uninstall dialog); the list follows its 'androidapps' event
            action: () => { let ok = false; try { ok = bridge.uninstall(a.id) === true; } catch (_) { ok = false; } if (!ok) void sh.messageBox({ title: 'Remove program', icon: 'error', text: `${a.label} could not be removed.` }); }
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
                sh.registerApp({ id: shellId(a), title: 'Android', icon: 'app-android', inStart: false, launch: () => start(a) });
                if (window.wmSettings && typeof window.wmSettings.addLink === 'function') {
                    window.wmSettings.addLink({ id: 'link-android', tab: 'system', label: 'Android', icon: 'app-android', app: shellId(a) });
                }
                continue;
            }
            if (hidden.has(a.id)) continue;
            want.add(shellId(a));
            sh.registerApp({
                id: shellId(a),
                title: role ? ROLES[role].label : a.label,
                icon: (role && ROLES[role].icon) || iconOf(a),
                art65: role ? ROLES[role].art65 : undefined,
                // 'bottom': on Start under the pinned programs; 'programs': in Programs only
                inStart: onStart.has(a.id) ? 'bottom' : 'programs',
                programsFolder: role ? undefined : (inGames(a) ? 'games' : FOLDER),
                launch: () => start(a),
                holdMenu: () => holdRows(a, role)
            });
        }
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
            render(el, tab, d) {
                el.innerHTML = `<p>Checked programs appear in Programs and Start. Clear the ones you never start.</p>
                    <div class="wm-listbox" style="max-height:calc(190 * var(--wm-px))">${d.list.map((a) => `<div class="wm-listbox-row">${ws.ui.check(`aa-h-${a.id}`, a.label, !d.hidden.has(a.id), `data-id="${esc(a.id)}"`)}</div>`).join('')}</div>`;
                el.querySelectorAll('input[data-id]').forEach((c) => c.addEventListener('change', () => {
                    if (c.checked) d.hidden.delete(c.dataset.id); else d.hidden.add(c.dataset.id);
                }));
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
        if (pageShown() && job.live.api) job.live.api.rerender();
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
                    <span class="wm-icongrid-label"><span>${esc(a.label)}</span></span></button>`;
            }).join('');
            const byId = new Map(d.list.map((a) => [a.id, a]));
            const anyWm = [...d.sel].some((id) => byId.has(id) && storeKey(byId.get(id)));
            el.innerHTML = `<p>Select the programs to give Windows Mobile icons, then tap Request. The server makes them; you can close Program Icons meanwhile.</p>
                <div class="wm-pi-scroll"><div class="wm-icongrid wm-pi-grid" role="list">${cells}</div></div>
                ${styleHtml('pi-style', d.mode)}
                ${ui.check('pi-themed', 'Send themed icons (the program\'s own one-colour mark)', d.themed)}
                ${ui.buttons([['request', job.id ? 'Request (busy)' : `Request${d.sel.size ? ` (${d.sel.size})` : ''}`, !d.sel.size || !!job.id], ['original', 'Use Android Icon', !anyWm]])}`;
            bindStyle(el, 'pi-style', (v) => { d.mode = v; try { localStorage.setItem(MODE_KEY, v); } catch (_) { /* this visit only */ } });
            el.querySelector('input[name="pi-themed"]').addEventListener('change', (e) => { d.themed = e.target.checked; try { localStorage.setItem(THEMED_KEY, d.themed ? '1' : '0'); } catch (_) { /* this visit only */ } });
            el.querySelector('.wm-pi-grid').addEventListener('click', (e) => {
                const cell = e.target.closest('.wm-pi-cell');
                if (!cell) return;
                const id = cell.dataset.id;
                if (d.sel.has(id)) d.sel.delete(id); else d.sel.add(id);
                pageApi.rerender();
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
                    <span class="wm-pi-text"><b>${esc(it.label)}</b><span>${esc(it.state === 'failed' ? `Failed: ${it.error || ''}` : `${STATE_TEXT[it.state] || it.state}, ${MODE_LABEL[it.mode] || 'Detailed'}${it.note ? `. ${it.note}` : ''}`)}${it.attempt > 1 && it.state === 'ready' ? ` (try ${it.attempt})` : ''}</span></span></label></div>`;
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
                    if (j.saved && j.saved.length) void sh.messageBox({ title: 'Program Icons', icon: 'info', text: `${j.saved.length} icon${j.saved.length === 1 ? ' was' : 's were'} saved. Other phones get ${j.saved.length === 1 ? 'it' : 'them'} with their next update.` });
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
            tabs: [['pi-programs', 'Programs'], ['pi-results', 'Results']],
            init() {
                const hidden = readSet(HIDDEN_KEY);
                const list = read().filter((a) => a.role !== 'settings' && !ROLES[a.role] && !hidden.has(a.id)).sort((x, y) => coll.compare(x.label, y.label));
                const d = { list, sel: new Set(), keep: new Set(), mode: readMode(), regenMode: readMode(), themed: readThemed() };
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
                else renderPrograms(el, d, pageApi);
            },
            commit() { return []; }
        });
    }

    function register() {
        sh = window.wmShell;
        if (window.wmSettings && typeof window.wmSettings.addProgramFolder === 'function') {
            window.wmSettings.addProgramFolder(FOLDER, { label: 'Android', icon: 'app-folder-android' });
        }
        sync();
        registerRemoveTab();
        registerIconsPage();
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
