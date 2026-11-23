/**
 * Quick Access (StaticForge #1017): the phone's quick settings as a black Vista Sidebar strip that the Melaton Bars
 * service opens over every program with a swipe from the screen's edge (the grip tab follows the finger).
 *
 * The app draws both natively (cursor rule melaton-bars-native-layouts): this file only lays them out so melatonBars
 * can write them down (layoutOf) as the roles
 *   qatab            the grip tab (T1): thin black glass, grip dots, the first six toggles' state glyphs
 *   quickaccess      the panel: Sidebar strip of 1 or 2 columns (P2) or the wide panel (P1); a strip that does not fit
 *   quickaccess.2..  is cut into pages, its last tile turning the page
 * Every control is one tile whose looks are stacked faces, one per state (data-live "qa:<id>:on|off|dim"); the app
 * draws the face of the state it reads itself (QuickAccess.kt), so nothing here needs to run while the panel is up. A
 * tile's line under its name (data-live "qa-sub:<id>") and the sliders' thumbs (vol-thumb:qa-brightness / qa-volume)
 * are filled by the app too; every press is done by the app (data-android "qa:<id>:toggle", hits "slider:qa-*").
 *
 * Settings: window.AndroidQuickAccess.config() (the app keeps them: Settings > Personal > Buttons > Quick Access).
 * Pictures are Android's: the Material glyphs its quick settings use, and an app's tile its own glyph (appassets ?tile=1,
 * which the app draws itself for its copy).
 */
(function (root) {
    'use strict';
    if (root.wmQuickAccess) return;

    // Android's own look (Yukimi, Nov 22 2026: "use the icons from android if possible or something that better represents
    // what it is"): the built-in tiles take the Material glyph Android's quick settings use (scripts/generate-qa-icons.js,
    // white as Android tints them); a control that is another app's tile (Samsung's, WireGuard, Traffic Cone) takes that
    // tile's own glyph from the phone, these files only when the app is not there
    const Q = '/static_images/quickaccess/';
    const ICONS = {
        wifi: { on: `${Q}wifi.png`, off: `${Q}wifi-off.png` },
        bluetooth: { on: `${Q}bluetooth.png`, off: `${Q}bluetooth-off.png` },
        brightness: `${Q}brightness.png`,
        autobrightness: `${Q}brightness-auto.png`,
        adaptivetone: `${Q}adaptive-tone.png`,
        volume: { on: `${Q}volume.png`, off: `${Q}volume-off.png` },
        output: `${Q}output.png`,
        sound: { on: `${Q}sound.png`, off: `${Q}vibrate.png` },
        rotation: { on: `${Q}rotate.png`, off: `${Q}rotate-lock.png` },
        hotspot: { on: `${Q}hotspot.png`, off: `${Q}hotspot-off.png` },
        qr: `${Q}qr.png`,
        dnd: { on: `${Q}dnd.png`, off: `${Q}dnd-off.png` },
        modes: `${Q}modes.png`,
        flashlight: { on: `${Q}flashlight.png`, off: `${Q}flashlight-off.png` },
        powersave: `${Q}power-saving.png`,
        network: `${Q}network.png`,
        dolby: `${Q}dolby.png`,
        eyecomfort: `${Q}eye-comfort.png`,
        record: `${Q}record.png`,
        performance: `${Q}performance.png`,
        powershare: `${Q}power-share.png`,
        wireguard: `${Q}vpn.png`,
        pointerflow: `${Q}pointer-flow.png`
    };
    // the controls that are an app's own tile: its glyph from the phone (catalog id tile:<component>)
    const TILE_GLYPH = {
        qr: 'com.sec.android.app.camera/com.sec.android.app.camera.service.QrTileService',
        modes: 'com.samsung.android.app.routines/com.samsung.android.app.routines.LifestyleModeTile',
        powersave: 'com.samsung.android.lool/com.samsung.android.sm.battery.ui.mode.BatteryModeTile',
        dolby: 'com.sec.android.app.soundalive/com.sec.android.app.soundalive.DolbyTile',
        record: 'com.samsung.android.app.smartcapture/com.samsung.android.app.screenrecorder.view.RecordScreenTile',
        performance: 'com.samsung.android.lool/com.samsung.android.sm.perfopt.PerfOptTile',
        powershare: 'com.samsung.android.lool/com.samsung.android.sm.powershare.PowerShareTileService',
        wireguard: 'com.wireguard.android/com.wireguard.android.QuickTileService',
        network: 'com.radioswitch.app/com.radioswitch.app.tile.RadioTileService'
    };
    // controls with no on / off of their own (a button): never lit (their 'on' face looks as the off one). Modes is not
    // one: it is lit while a mode is on, as Samsung's own tile
    const BUTTONS = new Set(['qr', 'record', 'output']);
    // the strip's short names (the wide panel uses the catalog's labels)
    const SHORT = { wifi: 'Wi-Fi', bluetooth: 'Bluetooth', rotation: 'Rotate', sound: 'Sound', hotspot: 'Hotspot', qr: 'QR code', dnd: 'Do not disturb',
        modes: 'Modes', flashlight: 'Flashlight', powersave: 'Power saving', network: 'Network', dolby: 'Dolby', eyecomfort: 'Eye comfort',
        record: 'Record', performance: 'Performance', powershare: 'Power share', wireguard: 'VPN', pointerflow: 'Pointer Flow', output: 'Output',
        autobrightness: 'Adaptive brightness', adaptivetone: 'Adaptive color tone' };
    // the tiles that show what they are set to under their picture (Yukimi, Nov 23 2026: Traffic Cone "should show the
    // current set state. Right now, just shows the icon"): the app fills the line in (qa-sub:<id>)
    const STATE = new Set(['network']);
    const SLIDERS = { brightness: 'qa-brightness', volume: 'qa-volume' };
    const STEPS = 10;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const host = () => (root.AndroidQuickAccess && typeof root.AndroidQuickAccess.config === 'function' ? root.AndroidQuickAccess : null);
    function read(fn) {
        const h = host();
        if (!h || typeof h[fn] !== 'function') return null;
        try { return JSON.parse(h[fn]()); } catch (_) { return null; }
    }

    /** The settings and what the tiles show now (the app's), and the catalog's names and glyphs for other apps' tiles. */
    function model() {
        const cfg = read('config');
        if (!cfg) return null;
        const st = read('get') || { items: {} };
        const cat = read('catalog') || {};
        const names = {};
        (cat.controls || []).forEach((c) => { names[c.id] = c.label; });
        const tiles = {};
        (cat.tiles || []).forEach((t) => { tiles[t.id] = t; });
        const items = (cfg.items || []).filter((id) => ICONS[id] || id.startsWith('tile:'));
        // (namedIcons: the app looks the apps' own icons up itself and offers only those the phone has, as st[id].icons)
        return { cfg, st: st.items || {}, names, tiles, items, named: !!st.namedIcons };
    }

    const stateOf = (m, id) => {
        const s = m.st[id] || {};
        if (s.available === false) return 'dim';
        return s.on ? 'on' : 'off';
    };
    // Samsung's own quick panel icons, by name from their apps (found in each app's resource table; the app draws them
    // white: /pkg-icon/<package>/drawable/<name>). Yukimi, Nov 22 2026: "use the official icons when possible"
    const PKG = 'https://appassets.androidplatform.net/pkg-icon/';
    const OFFICIAL = {
        // (Sound Assistant's Dolby double-D: its quick panel icon is a raw .spr the app cannot draw)
        dolby: `${PKG}com.sec.android.app.soundalive/drawable/dolby_routine_icon`,
        powersave: `${PKG}com.samsung.android.lool/drawable/ic_quick_panel_icon_battery_mode`,
        performance: `${PKG}com.samsung.android.lool/drawable/ic_quick_panel_icon_performance_profile`,
        powershare: `${PKG}com.samsung.android.lool/drawable/ic_quick_panel_icon_power_share`,
        qr: `${PKG}com.sec.android.app.camera/drawable/quick_panel_icon_qr_scanner`,
        // (Routines' own Modes glyph at full size; its tile's service icon is a small one in a padded square)
        modes: `${PKG}com.samsung.android.app.routines/drawable/routines_ic_modes`,
        record: `${PKG}com.samsung.android.app.smartcapture/drawable/quick_panel_icon_screen_recording`,
        network: `${PKG}com.radioswitch.app/drawable/ic_traffic_cone`,
        wifi: { on: `${PKG}com.android.systemui/drawable/quick_panel_icon_wifi_on`, off: `${PKG}com.android.systemui/drawable/quick_panel_icon_wifi_off` },
        rotation: { on: `${PKG}com.android.systemui/drawable/qs_auto_rotate_icon_on`, off: `${PKG}com.android.systemui/drawable/qs_auto_rotate_icon_off` }
    };
    const iconOf = (m, id, state) => {
        // (a tile whose service declares no glyph: a generic tile, never its app icon painted white)
        if (id.startsWith('tile:')) return (m.tiles[id] && m.tiles[id].icon) || '/static_images/quickaccess/tile.png';
        // Android's own icon for this state where the app has it (SystemUI's tiles: Bluetooth, Sound mode, Flashlight...)
        const official = m.st[id] && m.st[id].icons;
        if (official && (official[state === 'on' ? 'on' : 'off'])) return official[state === 'on' ? 'on' : 'off'];
        // by name, unchecked, only for an app that does not look them up itself: a name the phone's copy of the app does
        // not have drew nothing (Yukimi, Nov 23 2026: "an icon in the quick toggles that is showing up as blank")
        const named = m.named ? null : OFFICIAL[id];
        if (named) return typeof named === 'string' ? named : named[state === 'on' ? 'on' : 'off'];
        const own = TILE_GLYPH[id] && m.tiles[`tile:${TILE_GLYPH[id]}`];
        if (own && own.icon) return own.icon;
        const i = ICONS[id];
        return typeof i === 'string' ? i : (state === 'on' ? i.on : i.off) || i.on;
    };
    const labelOf = (m, id, wide) => {
        if (id.startsWith('tile:')) return (m.tiles[id] && m.tiles[id].label) || 'Tile';
        // the wide panel's two radios and Audio output have room for the full name; its square tiles take the short one
        const full = wide && (id === 'wifi' || id === 'bluetooth' || id === 'output');
        return full ? (m.names[id] || SHORT[id] || id) : (SHORT[id] || m.names[id] || id);
    };

    /** One tile: a button (the app's press) over its stacked faces (the app shows the one of the state it reads). */
    function tile(m, id, wide, span) {
        // every state has its face, buttons too: Modes is on while a mode is (Work, Sleep ...), and with no 'on' face the
        // app drew nothing but its line - a tile with no background (Yukimi's Fold, Nov 23 2026)
        const states = ['on', 'off', 'dim'];
        const button = BUTTONS.has(id);
        const label = labelOf(m, id, wide);
        const sub = (m.st[id] && m.st[id].sub) || '';
        const act = id === 'output' ? 'qa:output' : `qa:${id}:toggle`;
        const faces = states.map((s) => {
            const pic = iconOf(m, id, s);
            // (one element per face: the app draws what an element draws itself, its picture, glass and name)
            const look = button && s === 'on' ? 'off' : s;
            return `<span class="qa-face is-${look}" data-live="qa:${id}:${s}" style="--qa-pic:url('${esc(pic)}')">${wide ? esc(label) : ''}</span>`;
        }).join('');
        const state = STATE.has(id);
        // (a line with nothing in it is not written down for the app: a state not read yet still keeps its place)
        const subLine = wide || state ? `<span class="qa-sub" data-live="qa-sub:${id}">${esc(sub || (state ? '-' : ''))}</span>` : '';
        return `<button type="button" class="qa-tile${wide ? ' is-wide' : ''}${span ? ' is-span' : ''}${state ? ' has-state' : ''}" data-android="${act}" aria-label="${esc(label)}">${faces}${subLine}</button>`;
    }

    /** A slider: Vista's trackbar, vertical in the strip, the app moves its thumb to Android's level. */
    function slider(m, id, horizontal) {
        const kind = SLIDERS[id];
        const v = Math.round(((m.st[id] && Number(m.st[id].value)) || 0) / (100 / STEPS));
        const ticks = Array.from({ length: STEPS + 1 }, (_, i) => `<span class="wm-vol-tick qa-tick" style="--i:${i}"></span>`).join('');
        return `<div class="qa-slider${horizontal ? ' is-h' : ''}" style="--v:${v}">`
            + `<img class="qa-slider-pic" src="${esc(iconOf(m, id, 'on'))}" alt="" draggable="false">`
            + `<div class="qa-track" data-control="slider" data-kind="${kind}" role="slider" aria-label="${esc(labelOf(m, id, true))}" aria-orientation="${horizontal ? 'horizontal' : 'vertical'}" aria-valuemin="0" aria-valuemax="${STEPS}">`
            + `<span class="qa-channel"></span>${ticks}<span class="qa-thumb" data-live="vol-thumb:${kind}:${v}"></span></div></div>`;
    }

    // the controls one page of the strip holds (worked out from the screen when it opens): rows of `cols` cells, a row as
    // tall as its tallest cell (a slider is three tiles tall), the last row of a page kept for the page turner
    // the controls two columns wide in a two-column strip (Yukimi, Nov 22 2026: "a 2 col Samsung mode changer"): its picture,
    // its name and what it is on now, as the wide panel's tiles
    const SPAN = new Set(['modes']);
    // (in a one-column strip the same control is two rows high: its picture, name and mode under each other - Yukimi, Nov 23)
    const spans = (m, id) => m.cfg.layout !== 'wide' && SPAN.has(id);

    function stripPages(m, cols, room) {
        const TILE = 40; // a tile's height with its gap, in WM units (CSS: .qa-tile 36 + gap 4)
        const SLIDE = 116; // a slider's (CSS: .qa-slider 112 + gap 4)
        const pages = [[]];
        let used = 0;
        let row = [];
        let rowH = 0;
        const flush = () => { used += rowH; row = []; rowH = 0; };
        m.items.forEach((id) => {
            const h = SLIDERS[id] ? SLIDE : cols === 1 && spans(m, id) ? 2 * TILE : TILE;
            // a wide one starts its own row (the grid moves it there too, leaving the cell before it empty)
            const span = cols === 2 && spans(m, id) ? 2 : 1;
            if (span === 2 && row.length) flush();
            const nextH = Math.max(rowH, h);
            if (used + nextH > room - TILE) { pages.push([]); used = 0; row = []; rowH = 0; }
            pages[pages.length - 1].push(id);
            row.push(id);
            rowH = Math.max(rowH, h);
            if (row.length + span - 1 >= cols) flush();
        });
        return pages;
    }

    let layer = null;
    function close() {
        if (layer) { layer.remove(); layer = null; }
    }

    /** The bars' rows on this screen (the panel goes between them). */
    function bars(shell) {
        const t = shell.querySelector('.wm-titlebar');
        const s = shell.querySelector('.wm-softkeys');
        const tr = t && t.getClientRects().length ? t.getBoundingClientRect() : null;
        const sr = s && !s.hidden && s.getClientRects().length ? s.getBoundingClientRect() : null;
        // behind a program the page's own bars are put away (the app draws its own): their places by their size, 26 units
        // each - laid out then, the panel ran up over the status bar (Yukimi, Nov 22 2026: "alignment issue")
        const cs = getComputedStyle(document.documentElement);
        const wmpx = parseFloat(cs.getPropertyValue('--wm-px')) || 1;
        // (put away, the soft key bar's height is still known: Android's button row, --wm-soft-h - never a fixed 26 units:
        // the panel laid out so ended short of the Fold's taller bar over Today, a gap at the bottom, Yukimi Nov 23 2026)
        const softH = parseFloat(cs.getPropertyValue('--wm-soft-h')) || 26 * wmpx;
        const titleH = t && t.offsetHeight ? t.offsetHeight : 26 * wmpx;
        const top = tr && tr.bottom > 0 ? tr.bottom : titleH;
        const bottom = sr && sr.top > 0 ? sr.top : root.innerHeight - softH;
        return { top, bottom };
    }

    /**
     * The workspace's colour on the tab and the lit tiles (Yukimi, Nov 22 2026: "the theme color should be based on the
     * active workspace"): --primary-color resolved to rgb once per layout, its lighter and darker steps as variables.
     */
    function tint(el, shell) {
        // (no workspace colour yet: quickaccess.css's own blue stays)
        const ws = getComputedStyle(document.body).getPropertyValue('--primary-color').trim();
        if (!ws) return;
        const probe = document.createElement('span');
        probe.style.color = ws;
        shell.appendChild(probe);
        const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(getComputedStyle(probe).color);
        probe.remove();
        if (!m) return;
        const c = [1, 2, 3].map((i) => Number(m[i]));
        const mix = (t, k) => c.map((v) => Math.round(v + (t - v) * k)).join(', ');
        const base = c.join(', '), hi = mix(255, 0.35), lo = mix(0, 0.35), edge = mix(255, 0.6);
        el.style.setProperty('--qa-ws', `rgb(${base})`);
        el.style.setProperty('--qa-on-1', `rgba(${hi}, 0.6)`);
        el.style.setProperty('--qa-on-2', `rgba(${base}, 0.55)`);
        el.style.setProperty('--qa-on-3', `rgba(${lo}, 0.65)`);
        el.style.setProperty('--qa-on-4', `rgba(${hi}, 0.55)`);
        el.style.setProperty('--qa-on-glow', `rgba(${base}, 0.45)`);
        el.style.setProperty('--qa-on-edge', `rgba(${edge}, 0.8)`);
    }

    /** Lays out role `qatab` / `quickaccess` / `quickaccess.N` for melatonBars to write down; true when it did. */
    function open(role) {
        close();
        const shell = document.getElementById('wmShell');
        const m = model();
        if (!shell || !m) return false;
        const side = m.cfg.side === 'left' ? 'left' : 'right';
        const b = bars(shell);
        const wmpx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
        layer = document.createElement('div');
        layer.className = `wm-popup wm-qa is-${side}`;
        tint(layer, shell);
        layer.style.top = `${b.top}px`;
        layer.style.height = `${Math.max(0, b.bottom - b.top)}px`;
        if (role === 'qatab') {
            // the grip tab at the swipe zone (the app moves it with the finger): six state glyphs between grip dots
            const zoneTop = Math.max(0, Number(m.cfg.zoneTop) || 0.35);
            layer.classList.add('is-tab');
            // (Yukimi, Nov 22 2026: "just a tab with a handle", B/D: frosted, the workspace colour, three dots)
            layer.innerHTML = `<div class="qa-tab" style="--qa-top:${Math.round(zoneTop * (root.innerHeight) - b.top)}px">`
                + '<span class="qa-dot"></span><span class="qa-dot"></span><span class="qa-dot"></span></div>';
            shell.appendChild(layer);
            return true;
        }
        const page = role === 'quickaccess' ? 1 : Math.max(1, parseInt(String(role).split('.')[1], 10) || 1);
        if (m.cfg.layout === 'wide') {
            // P1: everything on one page, the radios wide, the sliders across, the rest four to a row with their names
            layer.classList.add('is-wide');
            const wideIds = m.items.filter((id) => id === 'wifi' || id === 'bluetooth');
            const rest = m.items.filter((id) => !wideIds.includes(id) && !SLIDERS[id]);
            layer.innerHTML = '<div class="qa-panel"><span class="qa-inset"></span>'
                + '<div class="qa-head">Quick Access</div>'
                + (wideIds.length ? `<div class="qa-two">${wideIds.map((id) => tile(m, id, true)).join('')}</div>` : '')
                + (m.items.includes('brightness') ? `<div class="qa-group">${slider(m, 'brightness', true)}<div class="qa-checks">${tile(m, 'autobrightness', true)}${tile(m, 'adaptivetone', true)}</div></div>` : '')
                + (m.items.includes('volume') ? `<div class="qa-group">${slider(m, 'volume', true)}${tile(m, 'output', true)}</div>` : '')
                + `<div class="qa-grid">${rest.filter((id) => id !== 'output').map((id) => tile(m, id, true)).join('')}</div>`
                + '</div>';
            shell.appendChild(layer);
            return true;
        }
        // P2: the Sidebar strip, 1 or 2 columns, in pages when it does not fit
        const cols = Number(m.cfg.columns) === 2 ? 2 : 1;
        layer.classList.add(`is-cols-${cols}`);
        const room = (b.bottom - b.top) / wmpx - 16;
        const pages = stripPages(m, cols, room);
        const ids = pages[Math.min(page, pages.length) - 1] || [];
        const more = pages.length > 1
            ? `<button type="button" class="qa-tile qa-more" data-android="qa-page:${page >= pages.length ? 1 : page + 1}" aria-label="More"><span class="qa-face is-off qa-more-face">${page >= pages.length ? '▲' : '▼'}</span></button>`
            : '';
        // (the screen's shadow first: under the tiles, never over them - Yukimi, Nov 23 2026)
        layer.innerHTML = '<div class="qa-panel"><span class="qa-inset"></span><span class="qa-handle"></span><div class="qa-cells">'
            + ids.map((id) => (SLIDERS[id] ? slider(m, id, false) : spans(m, id) ? tile(m, id, true, true) : tile(m, id, false))).join('')
            + more + '</div></div>';
        shell.appendChild(layer);
        return true;
    }

    /** The strip's roles now (its pages), for melatonBars' push. */
    function roles() {
        const m = model();
        if (!m || !m.cfg.enabled) return [];
        if (m.cfg.layout === 'wide') return ['qatab', 'quickaccess'];
        const shell = document.getElementById('wmShell');
        const wmpx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
        const b = shell ? bars(shell) : { top: 0, bottom: root.innerHeight };
        const n = stripPages(m, Number(m.cfg.columns) === 2 ? 2 : 1, (b.bottom - b.top) / wmpx - 16).length;
        return ['qatab', 'quickaccess'].concat(Array.from({ length: n - 1 }, (_, i) => `quickaccess.${i + 2}`));
    }

    /** What the layouts depend on (the settings and the catalog's tiles): a change pushes them again. */
    function signature() {
        const m = model();
        if (!m) return '';
        // (every tile's picture: a control drawn with an app tile's glyph changes with the catalog too - its kept layout
        // pointed at a glyph the app no longer draws, and the tile showed empty)
        // (f5: every tile's on / off / dim faces, a centred state line, the inset under the tiles, real bar heights, Nov 23
        // 2026 - a new make sends the app the new layouts)
        return JSON.stringify(['f6', getComputedStyle(document.body).getPropertyValue('--primary-color').trim(), m.cfg.enabled, m.cfg.side, m.cfg.zoneTop, m.cfg.layout, m.cfg.columns, m.items, m.items.map((id) => `${iconOf(m, id, 'on')} ${iconOf(m, id, 'off')}`)]);
    }

    // Today and Start show the workspace's wallpaper already (Yukimi, Nov 22 2026): the app brings Quick Access in over them
    // with its shadow instead of pushing the screen aside. It hears which of them shows, on each change only
    const appScope = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
    let homeSent = null;
    function syncHome() {
        const h = host();
        if (!h || typeof h.homeShown !== 'function') return;
        const app = document.documentElement.dataset.wmApp;
        const on = (app === 'today' || app === 'start') && document.visibilityState === 'visible';
        if (on === homeSent) return;
        homeSent = on;
        try { h.homeShown(on); } catch (_) { /* older app */ }
    }
    if (host()) {
        const mo = new MutationObserver(syncHome);
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-wm-app'] });
        document.addEventListener('visibilitychange', syncHome, { signal: appScope });
        if (appScope) appScope.addEventListener('abort', () => mo.disconnect(), { once: true });
        syncHome();
    }

    /**
     * The panel open over Melaton Mobile itself (Yukimi, Nov 22 2026: "in WM push the content but not the background or
     * status bar or softkey bar"): the app asks the page to move its content aside by the panel's width (device px; 0 puts
     * it back), live and in step with the panel. The wallpaper and both bars stay where they are.
     */
    function pushPage(o) {
        const shell = document.getElementById('wmShell');
        const content = shell && shell.querySelector(':scope > .wm-content');
        if (!content) return;
        const dx = Math.round((Number(o && o.dx) || 0) / (root.devicePixelRatio || 1));
        content.style.transition = `transform ${Number(o && o.ms) || 180}ms cubic-bezier(0.2, 0.8, 0.3, 1)`;
        content.style.transform = dx ? `translateX(${dx}px)` : '';
        if (!dx) content.addEventListener('transitionend', () => { if (!content.style.transform) content.style.transition = ''; }, { once: true });
    }

    root.wmQuickAccess = { open, close, roles, signature, pushPage, ICONS };
})(window);
