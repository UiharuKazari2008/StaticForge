/**
 * Melaton Mobile: Programs and Settings (Windows Mobile 6.1 Professional), Yozora #709.
 * public/css/wm-programs.css draws them; wmShell.js hosts them (registerApp).
 *
 * Programs: WM's icon grid of the phone's programs (the shell's apps) and the Dreamscape desktop
 * apps that have no phone version yet (modalUtils.js startMenuLaunchables; they keep their own
 * name and icon; a desktop app that has a stock WM counterpart on the phone is listed as that).
 * Games is a folder, as on the device.
 *
 * Settings: Personal / System / Connections grids and WM settings pages (section header, controls,
 * tabs at the bottom, ok in the title bar). Pages are real where Dreamscape has the data.
 *
 * Settings stored in localStorage (the shell reads them; wmSettingsChange { detail: { keys } } on
 * document after each ok):
 *   wmScale            '1' | '1.25' | '1.5' | '1.75' | '2'  (--wm-px; absent = the CSS default)
 *   wmTitleBar         'flat' | 'glossy'                      (absent = flat; html[data-wm-titlebar])
 *   wmTodayUseDesktop  '1' | '0'   (absent: '0' when wmTodayBackground is set, else '1')
 *   wmTodayBackground  same-site preview path ('/previews/...'), written by Pictures and here
 *   wmTodayItems       JSON [{ id, on }] in display order; ids = Today's data-row values
 *   wmStartMenu        JSON [appId] shown in the Start menu (absent = the apps' own inStart)
 *   wmStartSource      'wm' | 'flag' | 'desktop' | 'custom'  (absent = wm: "Start" + Melaton emblem;
 *                      flag = "Start" + WM 6.1's own Windows flag, opt-in at Yukimi's request)
 *   wmStartText        string (the resolved text, also for 'desktop')
 *   wmStartIcon        same-site image path (the resolved icon, also for 'desktop')
 * window.wmSettings.startButton() resolves the Start text and icon live (desktop values change).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const root = document.documentElement;

    const K = {
        scale: 'wmScale',
        titleBar: 'wmTitleBar',
        todayUseDesktop: 'wmTodayUseDesktop',
        todayBackground: 'wmTodayBackground',
        todayItems: 'wmTodayItems',
        startMenu: 'wmStartMenu',
        startSource: 'wmStartSource',
        startText: 'wmStartText',
        startIcon: 'wmStartIcon'
    };
    const SCALES = [1, 1.25, 1.5, 1.75, 2];
    const MELATON_EMBLEM = '/static_images/melaton/melaton-white-256.png';
    // WM 6.1's colour Start flag (shellres.192 icon 4609); a user-chosen exception to the copyright
    // rule's emblem mapping, never the default
    const WM_FLAG = '/static_images/wm61/start-flag.png';
    const WM_FLAG_SRCSET = '/static_images/wm61/start-flag.png 1x, /static_images/wm61/start-flag@2x.png 2x, /static_images/wm61/start-flag@4x.png 4x';

    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const lsSet = (k, v) => {
        try {
            if (v == null) localStorage.removeItem(k);
            else localStorage.setItem(k, String(v));
        } catch (_) { /* storage off */ }
    };
    const lsJson = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
    const changed = (keys) => document.dispatchEvent(new CustomEvent('wmSettingsChange', { detail: { keys } }));
    const sameSite = (p) => typeof p === 'string' && /^\/[^/]/.test(p);

    // ---------------------------------------------------------------- applied at load

    function storedScale() {
        const v = Number(lsGet(K.scale));
        return SCALES.includes(v) ? v : null;
    }

    function applyScale() {
        const s = storedScale();
        if (s) root.style.setProperty('--wm-px', `${s}px`);
        else root.style.removeProperty('--wm-px');
    }

    function currentScale() {
        const v = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        return SCALES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), SCALES[0]);
    }

    function titleBarStyle() {
        return lsGet(K.titleBar) === 'glossy' ? 'glossy' : 'flat';
    }

    function applyTitleBar() {
        root.dataset.wmTitlebar = titleBarStyle();
    }

    applyScale();
    applyTitleBar();

    function todayUsesDesktop() {
        const v = lsGet(K.todayUseDesktop);
        if (v === '1' || v === '0') return v === '1';
        return !lsGet(K.todayBackground);
    }

    // Start button: WM's own ("Start", Melaton emblem), "Start" with the Windows flag, the desktop's
    // (its server-side Taskbar and Start Menu Properties start button), or custom text and icon
    function desktopStartButton() {
        let text = '';
        let icon = '';
        try {
            /* global readDesktopSettingsStartMenuButtonPreference, resolveStartMenuButtonDisplayText, startMenuButtonLogoUrl */
            if (typeof readDesktopSettingsStartMenuButtonPreference === 'function') {
                const p = readDesktopSettingsStartMenuButtonPreference();
                text = resolveStartMenuButtonDisplayText(p.preset, p.customText);
                // the Windows logos (royal / vista) stay on the desktop: the phone shows Melaton's
                icon = p.logo === 'dreamscape' ? startMenuButtonLogoUrl('dreamscape') : MELATON_EMBLEM;
            }
        } catch (_) { /* desktop settings not loaded */ }
        return { text: text || 'Start', icon: icon || MELATON_EMBLEM };
    }

    function startButton() {
        const src = lsGet(K.startSource);
        if (src === 'desktop') return { source: 'desktop', ...desktopStartButton() };
        if (src === 'custom') {
            const icon = lsGet(K.startIcon);
            return { source: 'custom', text: (lsGet(K.startText) || '').trim() || 'Start', icon: sameSite(icon) ? icon : MELATON_EMBLEM };
        }
        if (src === 'flag') return { source: 'flag', text: 'Start', icon: WM_FLAG };
        return { source: 'wm', text: 'Start', icon: MELATON_EMBLEM };
    }

    window.wmSettings = { keys: K, startButton, todayUsesDesktop, titleBarStyle, applyScale, scales: SCALES };

    // ---------------------------------------------------------------- helpers

    let sh = null; // window.wmShell
    let manifest = null; // wm61 art names, for the 32 px (-lg) versions of the shell's icons
    const esc = (s) => sh.escapeHtml(s);

    function loadManifest() {
        if (manifest) return Promise.resolve(manifest);
        return fetch('/static_images/wm61/manifest.json', { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => { manifest = (m && m.items) || {}; return manifest; })
            .catch(() => { manifest = {}; return manifest; });
    }

    /** 32 px art for a shell icon name: its -lg pair when the ROM has one. */
    function wmLargeIcon(name) {
        const n = manifest && manifest[`${name}-lg`] ? `${name}-lg` : name;
        return { src: sh.art.url(n), srcset: sh.art.srcset(n) };
    }

    /** A Dreamscape app icon at 32 px (compiled sizes, modules/appIconRuntimeAssets.js). */
    function appIcon(imageIcon) {
        try {
            /* global resolveAppIconPath */
            if (typeof resolveAppIconPath === 'function') {
                const p = (n) => resolveAppIconPath(imageIcon, n);
                return { src: p(32), srcset: `${p(32)} 1x, ${p(64)} 2x, ${p(96)} 3x` };
            }
        } catch (_) { /* fall through */ }
        const src = `/static_images/app_icons/${imageIcon}`;
        return { src, srcset: '' };
    }

    function iconCell(item, extra = '') {
        const ic = item.img;
        return `<button type="button" class="wm-icongrid-cell" data-key="${esc(item.key)}" ${extra}>
            <span class="wm-icongrid-icon" style="--wm-icon-mask:url('${esc(ic.src)}')"><img src="${esc(ic.src)}"${ic.srcset ? ` srcset="${esc(ic.srcset)}"` : ''} alt="" draggable="false" loading="lazy"></span>
            <span class="wm-icongrid-label"><span>${esc(item.label)}</span></span>
        </button>`;
    }

    /** WM's tap on a grid item: the item is selected (highlight), then opens. */
    function bindGrid(box, onOpen) {
        box.addEventListener('click', (e) => {
            const cell = e.target.closest('.wm-icongrid-cell');
            if (!cell) return;
            box.querySelectorAll('.wm-icongrid-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
            cell.classList.add('is-selected');
            setTimeout(() => onOpen(cell.dataset.key), 90);
        });
    }

    function tabsHtml(tabs, current) {
        return `<div class="wm-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" class="wm-tab" role="tab" data-tab="${esc(id)}" aria-selected="${id === current}">${esc(label)}</button>`).join('')}</div>`;
    }

    function setTitleKind(kind) {
        const btn = document.querySelector('#wmShell .wm-titlebar .wm-title-action');
        if (!btn) return;
        btn.hidden = false;
        btn.dataset.kind = kind;
        btn.setAttribute('aria-label', kind === 'ok' ? 'OK' : 'Close');
    }

    const fmtMB = (bytes) => {
        if (!Number.isFinite(bytes) || bytes < 0) return '\u2014';
        // WM prints MB with two decimals; a browser quota runs to hundreds of GB
        return bytes >= 10 * 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(2)} MB`;
    };

    function previewPath(item) {
        try {
            if (!item || !item.preview) return '';
            /* global getGalleryPreviewUrl */
            const p = typeof getGalleryPreviewUrl === 'function' ? getGalleryPreviewUrl(item.preview) : item.preview;
            return `/previews/${encodeURIComponent(p)}`;
        } catch (_) { return ''; }
    }

    function galleryItems(n) {
        let list = [];
        try {
            /* global allImages */
            if (Array.isArray(window.originalAllImages) && window.originalAllImages.length) list = window.originalAllImages;
            else if (typeof allImages !== 'undefined' && Array.isArray(allImages)) list = allImages;
        } catch (_) { /* gallery not loaded */ }
        return list.filter((it) => it && it.preview).slice(0, n);
    }

    // ---------------------------------------------------------------- Programs

    // desktop apps whose phone version is a stock WM program (Yukimi's mapping): listed as that
    // program when the shell has it, else as themselves
    const MAPPED = {
        workspace: ['gallery'],
        encyclopedia: ['ie', 'iexplore', 'browser', 'internet-explorer'],
        alchemy: ['ie', 'iexplore', 'browser', 'internet-explorer'],
        explorer: ['fileexplorer', 'file-explorer'],
        dovecote: ['messaging'],
        notebook: ['notes'],
        director: ['director'],
        studio: ['studio']
    };
    const SHELL_ONLY = new Set(['today', 'programs', 'settings', 'help']);

    function desktopLaunchables(list) {
        try {
            /* global startMenuLaunchables, startMenuGameLaunchables */
            if (list === 'games') return typeof startMenuGameLaunchables !== 'undefined' ? startMenuGameLaunchables : [];
            return typeof startMenuLaunchables !== 'undefined' ? startMenuLaunchables : [];
        } catch (_) { return []; }
    }

    function programItems(folder) {
        const shellApps = sh.listApps();
        const have = new Set(shellApps.map((a) => a.id));
        const items = [];
        if (folder === 'games') {
            for (const g of desktopLaunchables('games')) {
                if (!g || !g.text || !g.imageIcon) continue;
                items.push({ key: `d:${g.launchId}`, label: g.text, img: appIcon(g.imageIcon), desktop: g.text });
            }
        } else {
            if (desktopLaunchables('games').length) items.push({ key: 'folder:games', label: 'Games', img: wmLargeIcon('app-games'), folder: true });
            for (const a of shellApps) {
                if (!a.inStart || SHELL_ONLY.has(a.id)) continue;
                items.push({ key: `a:${a.id}`, label: a.startLabel || a.title || a.id, img: wmLargeIcon(a.icon || 'app-programs') });
            }
            for (const l of desktopLaunchables()) {
                if (!l || !l.launchId || !l.text || !l.imageIcon) continue;
                const mapped = MAPPED[l.launchId];
                if (mapped && mapped.some((id) => have.has(id))) continue;
                items.push({ key: `d:${l.launchId}`, label: l.text, img: appIcon(l.imageIcon), desktop: l.text });
            }
        }
        const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
        return items.sort((x, y) => (y.folder ? 1 : 0) - (x.folder ? 1 : 0) || coll.compare(x.label, y.label));
    }

    function registerPrograms() {
        let page = null;
        let folder = null; // 'games' while the Games folder is open
        let byKey = new Map();

        function render() {
            if (!page) return;
            const items = programItems(folder);
            byKey = new Map(items.map((i) => [i.key, i]));
            const box = page.querySelector('.wm-icongrid');
            box.innerHTML = items.map((i) => iconCell(i)).join('');
            page.querySelector('.wm-pg-scroll').scrollTop = 0;
            if (sh.current === 'programs') sh.setTitle(folder === 'games' ? 'Games' : 'Programs');
        }

        function openItem(key) {
            const item = byKey.get(key);
            if (!item) return;
            if (item.folder) {
                folder = 'games';
                render();
                sh.syncHistory();
                return;
            }
            if (key.startsWith('a:')) {
                sh.open(key.slice(2));
                return;
            }
            page.querySelectorAll('.wm-icongrid-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
            sh.messageBox({ title: item.desktop, icon: 'info', text: `${item.desktop} is not available on Melaton Mobile yet.` });
        }

        sh.registerApp({
            id: 'programs',
            title: 'Programs',
            icon: 'app-programs',
            inStart: 'system',
            sip: true,
            mount(p) {
                page = p;
                page.classList.add('wm-pg');
                page.innerHTML = '<div class="wm-pg-scroll"><div class="wm-icongrid" role="list"></div></div>';
                bindGrid(page.querySelector('.wm-icongrid'), openItem);
            },
            show() {
                // the Start menu opens Programs at its top level
                folder = null;
                render();
                if (!manifest) loadManifest().then(render);
            },
            hide() { folder = null; },
            softKeys() { return { left: null, right: null }; },
            historyDepth: () => (folder ? 1 : 0),
            onBack() {
                if (!folder) return false;
                folder = null;
                render();
                return true;
            }
        });
    }

    // ---------------------------------------------------------------- Settings pages

    const TODAY_ROWS = [
        ['date', 'Date'],
        ['connection', 'Connection'],
        ['owner', 'Owner Info'],
        ['messages', 'Messaging'],
        ['tasks', 'Tasks'],
        ['novelai', 'NovelAI'],
        ['director', 'Director'],
        ['search', 'Search'],
        ['workspace', 'Workspace'],
        ['prints', 'Recent Pictures']
    ];

    function todayItems() {
        const saved = lsJson(K.todayItems);
        const out = [];
        const seen = new Set();
        if (Array.isArray(saved)) {
            for (const r of saved) {
                const def = r && TODAY_ROWS.find(([id]) => id === r.id);
                if (!def || seen.has(def[0])) continue;
                seen.add(def[0]);
                out.push({ id: def[0], label: def[1], on: r.on !== false });
            }
        }
        for (const [id, label] of TODAY_ROWS) if (!seen.has(id)) out.push({ id, label, on: true });
        return out;
    }

    function startMenuIds() {
        const saved = lsJson(K.startMenu);
        if (Array.isArray(saved)) return new Set(saved.map(String));
        return new Set(sh.listApps().filter((a) => a.inStart === 'top' || a.inStart === 'bottom').map((a) => a.id));
    }

    const START_ICONS = () => {
        const list = [
            { label: 'Melaton', src: MELATON_EMBLEM },
            { label: 'Windows', src: WM_FLAG },
            { label: 'Dreamscape', src: '/static_images/app_icons/48/dreamscape-logo.webp' }
        ];
        for (const l of desktopLaunchables()) {
            if (l && l.imageIcon && l.text) {
                const ic = appIcon(l.imageIcon);
                list.push({ label: l.text, src: ic.src.replace('/32/', '/64/') });
            }
        }
        return list;
    };

    const START_TEXT_PRESETS = () => {
        const out = [['Start', 'Start']];
        try {
            /* global START_MENU_BUTTON_PRESET_ORDER, START_MENU_BUTTON_PRESET_META */
            if (typeof START_MENU_BUTTON_PRESET_ORDER !== 'undefined') {
                for (const id of START_MENU_BUTTON_PRESET_ORDER) {
                    const m = START_MENU_BUTTON_PRESET_META[id];
                    if (m && m.text && !out.some(([, t]) => t === m.text)) out.push([m.text, `${m.text} (${m.label})`]);
                }
            }
        } catch (_) { /* desktop presets not loaded */ }
        return out;
    };

    function check(name, label, checked, attrs = '') {
        return `<label class="wm-check"><input type="checkbox" name="${esc(name)}"${checked ? ' checked' : ''} ${attrs}><span>${esc(label)}</span></label>`;
    }

    function radio(name, value, label, checked) {
        return `<label class="wm-check"><input type="radio" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    }

    // ---- Settings > Today > Wallpaper: this workspace's phone placement (wmShell.js wallpaper;
    // saved on the workspace record as mobileWallpaper, so every phone gets it; the desktop
    // never reads it). 'desktop' = the same as the desktop (no record of its own).

    const WALL_SIZES = [
        ['desktop', 'Same as desktop'],
        ['fill', 'Fill screen'],
        ['fit', 'Fit to screen'],
        ['stretch', 'Stretch'],
        ['tile', 'Tile'],
        ['center', 'Center']
    ];
    const WALL_H = ['left', 'center', 'right'];
    const WALL_V = ['top', 'center', 'bottom'];
    const wallNatural = new Map(); // url -> { w, h }

    function initWall() {
        const own = sh && sh.wallpaper ? sh.wallpaper.mobile() : null;
        const wall = own ? { size: own.size, position: own.position } : { size: 'desktop', position: 'center center' };
        return { ...wall, initial: `${wall.size}|${wall.position}` };
    }

    /** The draft's placement as wmShell takes it (null = same as the desktop). */
    function wallValue(w) {
        return w.size === 'desktop' ? null : { size: w.size, position: w.position };
    }

    async function commitWall(w) {
        if (!w || `${w.size}|${w.position}` === w.initial || !sh.wallpaper) return true;
        try {
            await sh.wallpaper.set(wallValue(w));
            w.initial = `${w.size}|${w.position}`;
            return true;
        } catch (err) {
            await sh.messageBox({ title: 'Today', icon: 'error', text: (err && err.message) || 'The wallpaper setting could not be saved.' });
            return false;
        }
    }

    /** The picture Today would show with this draft: the chosen picture, else the desktop's. */
    function wallPictureFor(d) {
        if (!d.useDesktop && sameSite(d.picture)) return d.picture;
        return sh.wallpaper ? sh.wallpaper.desktop() : null;
    }

    /** Draw the draft placement into the phone-shaped preview (scaled from the Today screen). */
    function paintWallPreview(screen, d) {
        const url = wallPictureFor(d);
        const w = d.wall;
        const placement = w.size === 'desktop' ? { size: 'fill', position: sh.wallpaper.desktopPosition() } : w;
        const todayW = Math.max(1, window.innerWidth);
        const scale = screen.clientWidth / todayW;
        const css = sh.wallpaper.css(placement, url && wallNatural.get(url), scale);
        screen.style.backgroundImage = url ? `url("${url.replace(/["\\\n]/g, encodeURIComponent)}")` : '';
        screen.style.backgroundSize = css.size;
        screen.style.backgroundPosition = css.position;
        screen.style.backgroundRepeat = css.repeat;
        screen.classList.toggle('is-empty', !url);
        if (url && !wallNatural.has(url) && (placement.size === 'tile' || placement.size === 'center')) {
            const img = new Image();
            img.onload = () => {
                wallNatural.set(url, { w: img.naturalWidth, h: img.naturalHeight });
                if (screen.isConnected) paintWallPreview(screen, d);
            };
            img.src = url;
        }
    }

    function renderWall(el, d, api) {
        const w = d.wall;
        const same = w.size === 'desktop';
        const focusOff = same || w.size === 'stretch';
        const [ph, pv] = w.position.split(' ');
        const label = (WALL_SIZES.find(([k]) => k === w.size) || WALL_SIZES[0])[1];
        // the preview frame takes the screen's shape (portrait or landscape)
        const portrait = window.innerHeight >= window.innerWidth;
        el.innerHTML = `<p>Select how the wallpaper is placed on the Today screen of this workspace's phones:</p>
            <div class="wm-form-row"><label>Picture:</label><button type="button" class="wm-combo" data-act="size"><span>${esc(label)}</span></button></div>
            <div class="wm-wall-side">
                <div class="wm-wall-focus-box">
                    <div class="wm-form-sub">Focus:</div>
                    <div class="wm-wall-focus${focusOff ? ' is-disabled' : ''}" role="radiogroup" aria-label="Focus">${WALL_V.map((v) => WALL_H.map((h) => `<button type="button" class="wm-wall-focus-cell${!focusOff && h === ph && v === pv ? ' is-selected' : ''}" data-pos="${h} ${v}" role="radio" aria-checked="${!focusOff && h === ph && v === pv}" aria-label="${esc(`${v} ${h}`)}"${focusOff ? ' disabled' : ''}></button>`).join('')).join('')}</div>
                </div>
                <div class="wm-wall-phone${portrait ? '' : ' is-landscape'}" aria-hidden="true"><div class="wm-wall-screen" data-f="screen"></div></div>
            </div>
            <p class="wm-form-note">${same ? "The phone fills the screen at the desktop's position." : 'The desktop keeps its own setting.'} Applies to a custom Today picture too.</p>`;
        const combo = el.querySelector('[data-act="size"]');
        combo.addEventListener('click', (e) => {
            e.stopPropagation();
            sh.dropdown(combo, WALL_SIZES.map(([k, l]) => ({ label: l, radio: k === w.size, action: () => { w.size = k; api.rerender(); } })), 'left');
        });
        el.querySelectorAll('.wm-wall-focus-cell').forEach((c) => c.addEventListener('click', () => { w.position = c.dataset.pos; api.rerender(); }));
        const screen = el.querySelector('[data-f="screen"]');
        requestAnimationFrame(() => { if (screen.isConnected) paintWallPreview(screen, d); });
    }

    /**
     * Page: { label, icon, tab (grid), tabs [[id, label]], available(), init() -> draft,
     * render(el, tabId, draft, api), commit(draft) -> keys | Promise }.
     */
    const PAGES = [
        {
            id: 'today', tab: 'personal', label: 'Today', icon: 'set-today',
            tabs: [['appearance', 'Appearance'], ['wallpaper', 'Wallpaper'], ['items', 'Items']],
            init: () => ({ useDesktop: todayUsesDesktop(), picture: lsGet(K.todayBackground) || '', titleBar: titleBarStyle(), items: todayItems(), sel: 0, browsing: false, wall: initWall() }),
            render(el, tab, d, api) {
                if (tab === 'wallpaper') { renderWall(el, d, api); return; }
                if (tab === 'items') {
                    el.innerHTML = `<p>Checked items appear on the Today screen.</p>
                        <div class="wm-listbox-side">
                            <div class="wm-listbox" style="max-height:calc(170 * var(--wm-px))">${d.items.map((r, i) => `<div class="wm-listbox-row${i === d.sel ? ' is-selected' : ''}" data-i="${i}">${check(`it-${r.id}`, r.label, r.on)}</div>`).join('')}</div>
                            <div class="wm-buttons"><button type="button" class="wm-button" data-act="up"${d.sel > 0 ? '' : ' disabled'}>Move Up</button><button type="button" class="wm-button" data-act="down"${d.sel < d.items.length - 1 ? '' : ' disabled'}>Move Down</button></div>
                        </div>`;
                    el.querySelectorAll('.wm-listbox-row').forEach((row) => {
                        const i = Number(row.dataset.i);
                        row.addEventListener('click', () => { if (d.sel !== i) { d.sel = i; api.rerender(); } });
                        row.querySelector('input').addEventListener('change', (e) => { d.items[i].on = e.target.checked; });
                    });
                    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
                        const j = d.sel + (b.dataset.act === 'up' ? -1 : 1);
                        if (j < 0 || j >= d.items.length) return;
                        [d.items[d.sel], d.items[j]] = [d.items[j], d.items[d.sel]];
                        d.sel = j;
                        api.rerender();
                    }));
                    return;
                }
                if (d.browsing) {
                    const pics = galleryItems(60);
                    el.innerHTML = `<p>Select a picture for the Today screen.</p>
                        ${pics.length ? `<div class="wm-picker">${pics.map((it) => { const p = previewPath(it); return `<button type="button" class="wm-picker-cell${p === d.picture ? ' is-selected' : ''}" data-path="${esc(p)}" aria-label="${esc(it.filename || '')}"><img src="${esc(p)}" alt="" loading="lazy" draggable="false"></button>`; }).join('')}</div>` : '<p class="wm-form-note">No pictures.</p>'}
                        <div class="wm-buttons is-right"><button type="button" class="wm-button" data-act="done">Done</button></div>`;
                    el.querySelectorAll('.wm-picker-cell').forEach((c) => c.addEventListener('click', () => { d.picture = c.dataset.path; d.useDesktop = false; d.browsing = false; api.rerender(); }));
                    el.querySelector('[data-act="done"]').addEventListener('click', () => { d.browsing = false; api.rerender(); });
                    return;
                }
                el.innerHTML = `<p>Select a title bar style for your device:</p>
                    <div class="wm-listbox-side">
                        <div class="wm-listbox">${[['flat', 'Flat title bar'], ['glossy', 'Glossy title bar']].map(([v, l]) => `<button type="button" class="wm-listbox-row${d.titleBar === v ? ' is-selected' : ''}" data-tb="${v}">${esc(l)}</button>`).join('')}</div>
                        <div class="wm-preview-box" data-f="preview"></div>
                    </div>
                    <div class="wm-form-gap"></div>
                    ${check('desk', 'Use desktop wallpaper', d.useDesktop)}
                    <div class="wm-buttons is-right"><button type="button" class="wm-button" data-act="browse"${d.useDesktop ? ' disabled' : ''}>Browse</button></div>`;
                const prev = el.querySelector('[data-f="preview"]');
                if (!d.useDesktop && sameSite(d.picture)) prev.style.backgroundImage = `url("${d.picture.replace(/["\\\n]/g, encodeURIComponent)}")`;
                else prev.textContent = d.useDesktop ? 'Desktop' : '';
                el.querySelectorAll('[data-tb]').forEach((b) => b.addEventListener('click', () => { d.titleBar = b.dataset.tb; api.rerender(); }));
                el.querySelector('input[name="desk"]').addEventListener('change', (e) => {
                    d.useDesktop = e.target.checked;
                    // a custom picture needs one: Browse opens at once when none is set yet
                    if (!d.useDesktop && !sameSite(d.picture)) d.browsing = true;
                    api.rerender();
                });
                el.querySelector('[data-act="browse"]').addEventListener('click', () => { d.browsing = true; api.rerender(); });
            },
            async commit(d) {
                // the Appearance and Items choices are local: they are kept even when the
                // workspace wallpaper save fails (the page then stays open to retry)
                const useDesktop = d.useDesktop || !sameSite(d.picture);
                lsSet(K.todayUseDesktop, useDesktop ? '1' : '0');
                if (sameSite(d.picture)) lsSet(K.todayBackground, d.picture);
                lsSet(K.todayItems, JSON.stringify(d.items.map((r) => ({ id: r.id, on: r.on }))));
                lsSet(K.titleBar, d.titleBar);
                applyTitleBar();
                const keys = [K.todayUseDesktop, K.todayBackground, K.todayItems, K.titleBar];
                if (!(await commitWall(d.wall))) {
                    changed(keys);
                    return false;
                }
                return keys;
            }
        },
        {
            id: 'owner', tab: 'personal', label: 'Owner Information', icon: 'set-owner',
            tabs: [['identification', 'Identification']],
            available: () => !!(window.meletonAccounts && typeof window.meletonAccounts.name === 'function'),
            init() {
                const acc = window.meletonAccounts;
                const account = typeof acc.current === 'function' ? acc.current() : 'guest';
                return { account, name: acc.name(account), canEdit: account === 'administrator' && typeof acc.setName === 'function' };
            },
            render(el, tab, d) {
                el.innerHTML = `<div class="wm-form-row"><label for="wmOwnerName">Name:</label><input id="wmOwnerName" class="wm-edit" type="text" maxlength="20" autocomplete="off" value="${esc(d.name)}"${d.canEdit ? '' : ' readonly'}></div>
                    <div class="wm-form-row"><span class="wm-form-label">Account:</span><span class="wm-form-value">${esc(d.account === 'administrator' ? 'Administrator' : 'Guest')}</span></div>
                    ${d.canEdit ? '' : '<p class="wm-form-note" style="margin-top:calc(8 * var(--wm-px))">Only an administrator can change the name.</p>'}`;
                el.querySelector('#wmOwnerName').addEventListener('input', (e) => { d.name = e.target.value; });
            },
            async commit(d) {
                const acc = window.meletonAccounts;
                const name = String(d.name || '').trim();
                if (!d.canEdit || !name || name === acc.name(d.account)) return [];
                try {
                    await acc.setName(d.account, name);
                } catch (err) {
                    await sh.messageBox({ title: 'Owner Information', icon: 'error', text: (err && err.message) || 'The name could not be changed.' });
                    return false;
                }
                return [];
            }
        },
        {
            id: 'sounds', tab: 'personal', label: 'Sounds & Notifications', icon: 'set-sounds',
            tabs: [['sounds', 'Sounds']],
            available: () => !!(window.desktopPersonalization && typeof window.desktopPersonalization.get === 'function'),
            init: () => ({ on: window.desktopPersonalization.get().soundScheme !== 'none' }),
            render(el, tab, d) {
                el.innerHTML = `<p>Enable sounds for:</p>${check('events', 'Events (warnings, system events)', d.on)}
                    <p class="wm-form-note" style="margin-top:calc(8 * var(--wm-px))">The sound scheme of this workspace, as set on the desktop.</p>`;
                el.querySelector('input').addEventListener('change', (e) => { d.on = e.target.checked; });
            },
            commit(d) {
                const dp = window.desktopPersonalization;
                if ((dp.get().soundScheme !== 'none') !== d.on) dp.update({ soundScheme: d.on ? 'default' : 'none' });
                return [];
            }
        },
        {
            id: 'menus', tab: 'personal', label: 'Menus', icon: 'set-menus',
            tabs: [['start', 'Start Menu'], ['button', 'Start Button']],
            init() {
                const sb = startButton();
                return { ids: startMenuIds(), source: sb.source, text: sb.source === 'custom' ? sb.text : (lsGet(K.startText) || 'Start'), icon: sb.source === 'custom' ? sb.icon : MELATON_EMBLEM };
            },
            render(el, tab, d, api) {
                if (tab === 'button') {
                    const desk = desktopStartButton();
                    const custom = d.source === 'custom';
                    el.innerHTML = `<p>The Start button's text replaces "Start" on the Today screen.</p>
                        ${radio('src', 'wm', 'Start (Melaton emblem)', d.source === 'wm')}
                        ${radio('src', 'flag', 'Start (Windows flag)', d.source === 'flag')}
                        ${radio('src', 'desktop', `Same as the desktop (${desk.text})`, d.source === 'desktop')}
                        ${radio('src', 'custom', 'Custom', custom)}
                        <div class="wm-form-gap"></div>
                        <div class="wm-form-row"><label for="wmStartTextEdit">Text:</label><div class="wm-combo-edit"><input id="wmStartTextEdit" class="wm-edit" type="text" maxlength="24" autocomplete="off" value="${esc(d.text)}"${custom ? '' : ' disabled'}><button type="button" class="wm-combo" data-act="text" aria-label="Presets"${custom ? '' : ' disabled'}></button></div></div>
                        <div class="wm-form-sub">Icon:</div>
                        <div class="wm-picker is-icons"${custom ? '' : ' hidden'}>${START_ICONS().map((ic) => `<button type="button" class="wm-picker-cell${ic.src === d.icon ? ' is-selected' : ''}" data-src="${esc(ic.src)}" title="${esc(ic.label)}" aria-label="${esc(ic.label)}" style="background:#4a4d4a"><img src="${esc(ic.src)}"${ic.src === WM_FLAG ? ` srcset="${WM_FLAG_SRCSET}"` : ''} alt="" loading="lazy" draggable="false"></button>`).join('')}</div>`;
                    el.querySelectorAll('input[name="src"]').forEach((r) => r.addEventListener('change', () => { d.source = r.value; api.rerender(); }));
                    const edit = el.querySelector('.wm-edit');
                    edit.addEventListener('input', () => { d.text = edit.value; });
                    const combo = el.querySelector('[data-act="text"]');
                    combo.addEventListener('click', (e) => {
                        e.stopPropagation();
                        sh.dropdown(edit.parentElement, START_TEXT_PRESETS().map(([t, l]) => ({ label: l, radio: t === d.text, action: () => { d.text = t; api.rerender(); } })), 'left');
                    });
                    el.querySelectorAll('.wm-picker-cell').forEach((c) => c.addEventListener('click', () => {
                        d.icon = c.dataset.src;
                        el.querySelectorAll('.wm-picker-cell').forEach((x) => x.classList.toggle('is-selected', x === c));
                    }));
                    return;
                }
                const apps = sh.listApps().filter((a) => a.inStart && a.inStart !== 'system' && !SHELL_ONLY.has(a.id));
                el.innerHTML = `<p>Checked items appear in the Start menu. Others appear in Programs.</p>
                    <div class="wm-listbox" style="max-height:calc(190 * var(--wm-px))">${apps.map((a) => `<div class="wm-listbox-row">${check(`sm-${a.id}`, a.startLabel || a.title || a.id, d.ids.has(a.id), `data-id="${esc(a.id)}"`)}</div>`).join('')}</div>`;
                el.querySelectorAll('input[data-id]').forEach((c) => c.addEventListener('change', () => {
                    if (c.checked) d.ids.add(c.dataset.id); else d.ids.delete(c.dataset.id);
                }));
            },
            commit(d) {
                lsSet(K.startMenu, JSON.stringify([...d.ids]));
                lsSet(K.startSource, d.source);
                if (d.source === 'custom') {
                    lsSet(K.startText, String(d.text || '').trim().slice(0, 24) || 'Start');
                    lsSet(K.startIcon, sameSite(d.icon) ? d.icon : MELATON_EMBLEM);
                } else {
                    const sb = d.source === 'desktop' ? desktopStartButton() : { text: 'Start', icon: d.source === 'flag' ? WM_FLAG : MELATON_EMBLEM };
                    lsSet(K.startText, sb.text);
                    lsSet(K.startIcon, sb.icon);
                }
                return [K.startMenu, K.startSource, K.startText, K.startIcon];
            }
        },
        {
            id: 'about', tab: 'system', label: 'About', icon: 'set-about',
            tabs: [['version', 'Version'], ['device', 'Device ID'], ['copyrights', 'Copyrights']],
            init() {
                const d = { info: typeof window.getMeletonVersionInfo === 'function' ? window.getMeletonVersionInfo() : null };
                if (typeof window.loadMeletonVersionInfo === 'function') {
                    window.loadMeletonVersionInfo().then((info) => { d.info = info; if (d.rerender) d.rerender(); }).catch(() => {});
                }
                return d;
            },
            render(el, tab, d, api) {
                d.rerender = api.rerender;
                const info = d.info || { version: '2026 R7', build: 'Unknown', copyrightYear: '2026', copyrightHolder: 'Xyridian Corporation' };
                const build = info.build && info.build !== 'Unknown' ? ` (Build ${info.build})` : '';
                if (tab === 'device') {
                    const uad = navigator.userAgentData;
                    el.innerHTML = `<p>Your device uses this information to identify itself to other computers.</p>
                        <div class="wm-form-row is-wide"><label>Device name:</label><input class="wm-edit" readonly value="${esc((uad && uad.platform) ? `${uad.platform}${uad.mobile ? ' phone' : ''}` : 'Melaton_Mobile')}"></div>
                        <div class="wm-form-row is-wide"><label>Description:</label><input class="wm-edit" readonly value="${esc(navigator.userAgent)}"></div>`;
                    return;
                }
                if (tab === 'copyrights') {
                    el.innerHTML = `<p>Melaton Mobile ${esc(info.version)}<br>\u00a9 ${esc(info.copyrightYear)} ${esc(info.copyrightHolder)}. All rights reserved.</p>
                        <p>Dreamscape, Melaton and the Melaton logo are trademarks of ${esc(info.copyrightHolder)}.</p>
                        <p>Portions of this software use icons and artwork from Windows Mobile 6.1 Professional.</p>`;
                    return;
                }
                const cores = navigator.hardwareConcurrency;
                const mem = navigator.deviceMemory;
                el.innerHTML = `<p>Melaton Mobile\u00ae ${esc(info.version)}</p>
                    <p>Melaton OS ${esc(info.version)}${esc(build)}<br>\u00a9 ${esc(info.copyrightYear)} ${esc(info.copyrightHolder)}.<br>All rights reserved.</p>
                    <p>This computer program is protected by U.S. and international copyright laws.</p>
                    <div class="wm-facts">
                        <span>Processor:</span><span>${esc(cores ? `${cores}-core ${(navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''}`.trim() : 'Unknown')}</span>
                        <span>Memory:</span><span>${esc(mem ? `${mem} GB` : 'Unknown')}</span>
                        <span>Expansion slot:</span><span>Not in use</span>
                    </div>`;
            }
        },
        {
            id: 'clock', tab: 'system', label: 'Clock & Alarms', icon: 'set-clock',
            tabs: [['time', 'Time']],
            init: () => ({}),
            render(el) {
                const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
                const draw = () => {
                    if (!el.isConnected) { clearInterval(timer); return; }
                    const now = new Date();
                    el.innerHTML = `<div class="wm-form-sub">Home</div>
                        <div class="wm-form-row"><span class="wm-form-label">Time Zone:</span><span class="wm-form-value">${esc(zone)}</span></div>
                        <div class="wm-form-row"><span class="wm-form-label">Date:</span><span class="wm-form-value">${esc(now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }))}</span></div>
                        <div class="wm-form-row"><span class="wm-form-label">Time:</span><span class="wm-form-value">${esc(now.toLocaleTimeString())}</span></div>
                        <p class="wm-form-note" style="margin-top:calc(8 * var(--wm-px))">The clock follows this phone's own time and time zone.</p>`;
                };
                const timer = setInterval(draw, 1000);
                draw();
            }
        },
        {
            id: 'memory', tab: 'system', label: 'Memory', icon: 'set-memory',
            tabs: [['main', 'Main']],
            init() {
                const d = { est: null };
                if (navigator.storage && typeof navigator.storage.estimate === 'function') {
                    navigator.storage.estimate().then((e) => { d.est = e; if (d.rerender) d.rerender(); }).catch(() => {});
                }
                return d;
            },
            render(el, tab, d, api) {
                d.rerender = api.rerender;
                const e = d.est;
                const pm = performance.memory;
                let lsBytes = 0;
                try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); lsBytes += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch (_) { /* storage off */ }
                const col = (title, total, used) => `<div class="wm-mem-col"><b>${esc(title)}</b>
                    <span>Total:</span><span>${esc(fmtMB(total))}</span>
                    <span>In use:</span><span>${esc(fmtMB(used))}</span>
                    <span class="is-free">Free:</span><span class="is-free">${esc(fmtMB(total - used))}</span></div>`;
                el.innerHTML = `<div class="wm-mem">${col('Storage', e ? e.quota : NaN, e ? e.usage : NaN)}${pm ? col('Program', pm.jsHeapSizeLimit, pm.usedJSHeapSize) : ''}</div>
                    <div class="wm-form-gap"></div>
                    <p>Settings: ${esc(fmtMB(lsBytes))}</p>`;
            }
        },
        {
            id: 'screen', tab: 'system', label: 'Screen', icon: 'set-screen',
            tabs: [['textsize', 'Text Size']],
            init: () => ({ scale: currentScale() }),
            render(el, tab, d) {
                const n = SCALES.length;
                const pos = (i) => `calc(4 * var(--wm-px) + (100% - 8 * var(--wm-px)) * ${i / (n - 1)})`;
                el.innerHTML = `<p>Adjust the text size to see more content or increase the readability in many programs.</p>
                    <div class="wm-slider-scale"><span>Smallest</span><span>Largest</span></div>
                    <div class="wm-slider" role="slider" tabindex="0" aria-label="Text size" aria-valuemin="0" aria-valuemax="${n - 1}">
                        <div class="wm-slider-track"></div>
                        ${SCALES.map((_, i) => `<div class="wm-slider-tick" style="left:${pos(i)}"></div>`).join('')}
                        <div class="wm-slider-thumb"></div>
                    </div>
                    <div class="wm-form-sub">Example:</div>
                    <p data-f="example">I'll get back to you.</p>`;
                const slider = el.querySelector('.wm-slider');
                const thumb = el.querySelector('.wm-slider-thumb');
                const example = el.querySelector('[data-f="example"]');
                const set = (i) => {
                    i = Math.max(0, Math.min(n - 1, i));
                    d.scale = SCALES[i];
                    thumb.style.left = pos(i);
                    slider.setAttribute('aria-valuenow', String(i));
                    example.style.fontSize = `${12 * d.scale}px`;
                    example.style.lineHeight = `${13 * d.scale}px`;
                };
                const fromX = (x) => {
                    const r = slider.getBoundingClientRect();
                    return Math.round(((x - r.left) / Math.max(1, r.width)) * (n - 1));
                };
                slider.addEventListener('pointerdown', (e) => {
                    slider.setPointerCapture(e.pointerId);
                    set(fromX(e.clientX));
                    const move = (ev) => set(fromX(ev.clientX));
                    const up = () => { slider.removeEventListener('pointermove', move); slider.removeEventListener('pointerup', up); slider.removeEventListener('pointercancel', up); };
                    slider.addEventListener('pointermove', move);
                    slider.addEventListener('pointerup', up);
                    slider.addEventListener('pointercancel', up);
                });
                slider.addEventListener('keydown', (e) => {
                    const i = SCALES.indexOf(d.scale);
                    if (e.key === 'ArrowLeft') { set(i - 1); e.preventDefault(); } else if (e.key === 'ArrowRight') { set(i + 1); e.preventDefault(); }
                });
                set(SCALES.indexOf(d.scale));
            },
            commit(d) {
                if (d.scale === currentScale() && storedScale() !== null) return [];
                lsSet(K.scale, String(d.scale));
                applyScale();
                return [K.scale];
            }
        },
        {
            id: 'connections', tab: 'connections', label: 'Connections', icon: 'set-connections',
            tabs: [['tasks', 'Tasks']],
            init: () => ({}),
            render(el, tab, d, api) {
                const ws = window.wsClient;
                const connected = !!(ws && typeof ws.isConnected === 'function' && ws.isConnected());
                let state = 'Not connected';
                if (connected && ws.initializationCompleted) state = 'Connected';
                else if (connected) state = 'Connecting...';
                else if (ws && ws.connectionPhase && ws.connectionPhase !== 'failed' && ws.connectionPhase !== 'idle') state = (ws.connectionUi && ws.connectionUi.message) || 'Connecting...';
                let host = location.host;
                try { if (ws && ws.ws && ws.ws.url) host = new URL(ws.ws.url).host; } catch (_) { /* page host */ }
                const since = ws && ws.connectionStats && ws.connectionStats.connectedAt;
                el.innerHTML = `<div class="wm-form-sub">Dreamscape server</div>
                    <div class="wm-form-row is-wide"><span class="wm-form-label">Status:</span><span class="wm-form-value">${esc(state)}</span></div>
                    <div class="wm-form-row is-wide"><span class="wm-form-label">Server:</span><span class="wm-form-value">${esc(host)}</span></div>
                    ${since && connected ? `<div class="wm-form-row is-wide"><span class="wm-form-label">Connected since:</span><span class="wm-form-value">${esc(new Date(since).toLocaleTimeString())}</span></div>` : ''}
                    <div class="wm-buttons is-right"><button type="button" class="wm-button" data-act="reconnect">Reconnect</button></div>`;
                el.querySelector('[data-act="reconnect"]').addEventListener('click', () => {
                    if (ws && typeof ws.manualReconnect === 'function') ws.manualReconnect();
                    setTimeout(() => { if (el.isConnected) api.rerender(); }, 1500);
                });
                clearTimeout(d.timer);
                d.timer = setTimeout(() => { if (el.isConnected) api.rerender(); }, 3000);
            }
        },
        {
            id: 'remote', tab: 'connections', label: 'Remote Access', icon: 'set-usb',
            tabs: [['general', 'General']],
            available: () => typeof window.setAgentPriorityClient === 'function' && typeof window.isAgentPriorityClient === 'function',
            init: () => ({ on: !!window.isAgentPriorityClient() }),
            render(el, tab, d) {
                el.innerHTML = `<p>Agents that test the client use the development client first.</p>
                    ${check('prio', 'Use this phone for development testing', d.on)}
                    <p class="wm-form-note" style="margin-top:calc(8 * var(--wm-px))">Applies to this window until it is closed.</p>`;
                el.querySelector('input').addEventListener('change', (e) => { d.on = e.target.checked; });
            },
            commit(d) {
                if (!!window.isAgentPriorityClient() !== d.on) window.setAgentPriorityClient(d.on);
                return [];
            }
        }
    ];

    const SET_TABS = [['personal', 'Personal'], ['system', 'System'], ['connections', 'Connections']];

    function registerSettings() {
        let page = null;
        let gridTab = 'personal';
        let open = null; // { def, tab, draft, el }

        function pagesFor(tab) {
            return PAGES.filter((p) => p.tab === tab && (!p.available || p.available()));
        }

        function renderGrid() {
            if (!page) return;
            const items = pagesFor(gridTab).map((p) => ({ key: p.id, label: p.label, img: { src: sh.art.url(p.icon), srcset: sh.art.srcset(p.icon) } }))
                .sort((a, b) => a.label.localeCompare(b.label));
            page.innerHTML = `<div class="wm-set-scroll"><div class="wm-icongrid" role="list">${items.map((i) => iconCell(i)).join('')}</div></div>${tabsHtml(SET_TABS, gridTab)}`;
            bindGrid(page.querySelector('.wm-icongrid'), openPage);
            page.querySelectorAll('.wm-tab').forEach((t) => t.addEventListener('click', () => { gridTab = t.dataset.tab; renderGrid(); }));
            if (sh.current === 'settings') setTitleKind('close');
        }

        function renderPage() {
            const { def, tab, draft } = open;
            page.innerHTML = `<div class="wm-form-hdr">${esc(def.label)}</div><div class="wm-set-scroll"><div class="wm-form"></div></div>${def.tabs.length ? tabsHtml(def.tabs, tab) : ''}`;
            const el = page.querySelector('.wm-form');
            const api = { rerender: () => { if (open && open.draft === draft) renderPage(); } };
            def.render(el, tab, draft, api);
            page.querySelectorAll('.wm-tab').forEach((t) => t.addEventListener('click', () => { open.tab = t.dataset.tab; renderPage(); }));
            setTitleKind('ok');
        }

        function openPage(id) {
            const def = PAGES.find((p) => p.id === id);
            if (!def) return;
            open = { def, tab: def.tabs[0] ? def.tabs[0][0] : '', draft: def.init() };
            renderPage();
            sh.syncHistory();
        }

        function closePage() {
            open = null;
            renderGrid();
        }

        /** ok (and the back key): save the page, then back to the grid; false keeps it open. */
        async function commitPage() {
            if (!open) return;
            const cur = open;
            let keys = [];
            try {
                keys = typeof cur.def.commit === 'function' ? await cur.def.commit(cur.draft) : [];
            } catch (err) {
                console.warn('Settings: could not save', cur.def.id, err);
            }
            if (keys === false) return;
            if (Array.isArray(keys) && keys.length) changed(keys);
            if (open === cur) { closePage(); sh.syncHistory(); }
        }

        sh.registerApp({
            id: 'settings',
            title: 'Settings',
            icon: 'app-settings',
            inStart: 'system',
            sip: true,
            mount(p) {
                page = p;
                page.classList.add('wm-set');
            },
            show() {
                open = null;
                renderGrid();
            },
            hide() { open = null; },
            softKeys() { return { left: null, right: null }; },
            onTitleAction() {
                if (!open) return true;
                commitPage();
                return false;
            },
            historyDepth: () => (open ? 1 : 0),
            onBack() {
                if (!open) return false;
                // the back key leaves a page as ok does on the device; the entry is already gone
                const cur = open;
                Promise.resolve(typeof cur.def.commit === 'function' ? cur.def.commit(cur.draft) : [])
                    .then((keys) => { if (Array.isArray(keys) && keys.length) changed(keys); })
                    .catch(() => {});
                open = null;
                renderGrid();
                return true;
            }
        });
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        loadManifest();
        registerPrograms();
        registerSettings();
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
