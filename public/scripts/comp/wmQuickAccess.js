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
 * Pictures are Vista's own (Mobility Center, Device Manager classes, network and sound art); a tile from another app
 * uses that tile's own glyph (appassets ?tile=1). Where Vista has an equivalent that is not ripped yet, the nearest
 * ripped picture stands in, marked TODO(vm) below.
 */
(function (root) {
    'use strict';
    if (root.wmQuickAccess) return;

    const I = '/static_images/';
    // the controls' pictures: one, or { on, off } where the state has its own (Vista's own art for each)
    const ICONS = {
        wifi: { on: `${I}vista-mblctr/wireless-4.png`, off: `${I}vista-mblctr/wireless-off.png` },
        bluetooth: `${I}vista-devmgr/bluetooth-32.png`,
        brightness: `${I}vista-mblctr/brightness.png`,
        autobrightness: `${I}vista-mblctr/brightness.png`,
        adaptivetone: `${I}vista-devmgr/display-adapters-32.png`,
        volume: { on: `${I}vista-mblctr/volume.png`, off: `${I}vista-mblctr/volume-muted.png` },
        output: `${I}vista-sndvol/speakers-32.png`,
        sound: { on: `${I}vista-icons/volume-high-32.png`, off: `${I}vista-icons/volume-mute-32.png` },
        rotation: `${I}vista-mblctr/display-one.png`, // TODO(vm): Mobility Center's Screen Orientation tile (mblctr.exe)
        hotspot: `${I}vista-net/setup-adhoc-32.png`,
        qr: `${I}vista-devmgr/imaging-32.png`,
        dnd: { on: `${I}vista-mblctr/presentation-on.png`, off: `${I}vista-mblctr/presentation-off.png` },
        modes: `${I}vista-mblctr/sync.png`, // TODO(vm): a Vista profile / scheme picture
        flashlight: `${I}vista-devmgr/sensors-32.png`, // TODO(vm): Vista has no torch; a light picture from imageres
        powersave: { on: `${I}vista-power/battery-low-32.png`, off: `${I}vista-power/battery-full-32.png` },
        network: `${I}vista-devmgr/modems-32.png`,
        dolby: `${I}vista-sndvol/digital-32.png`,
        eyecomfort: `${I}vista-devmgr/monitors-32.png`,
        record: `${I}vista-devmgr/portable-32.png`, // TODO(vm): Windows Movie Maker / capture picture
        performance: `${I}vista-devmgr/processors-32.png`,
        powershare: `${I}vista-devmgr/batteries-32.png`,
        wireguard: `${I}vista-net/rasmm-vpn-32.png`,
        pointerflow: `${I}vista-devmgr/mice-32.png`
    };
    // controls with no on / off of their own (a button): one face, never lit
    const BUTTONS = new Set(['qr', 'record', 'modes', 'output']);
    // the strip's short names (the wide panel uses the catalog's labels)
    const SHORT = { wifi: 'Wi-Fi', bluetooth: 'Bluetooth', rotation: 'Rotate', sound: 'Sound', hotspot: 'Hotspot', qr: 'QR code', dnd: 'Do not disturb',
        modes: 'Modes', flashlight: 'Flashlight', powersave: 'Power saving', network: 'Network', dolby: 'Dolby', eyecomfort: 'Eye comfort',
        record: 'Record', performance: 'Performance', powershare: 'Power share', wireguard: 'VPN', pointerflow: 'Pointer Flow', output: 'Output',
        autobrightness: 'Auto bright.', adaptivetone: 'Color tone' };
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
        return { cfg, st: st.items || {}, names, tiles, items };
    }

    const stateOf = (m, id) => {
        const s = m.st[id] || {};
        if (s.available === false) return 'dim';
        return s.on ? 'on' : 'off';
    };
    const iconOf = (m, id, state) => {
        if (id.startsWith('tile:')) return (m.tiles[id] && m.tiles[id].icon) || '';
        const i = ICONS[id];
        return typeof i === 'string' ? i : (state === 'on' ? i.on : i.off) || i.on;
    };
    const labelOf = (m, id, wide) => {
        if (id.startsWith('tile:')) return (m.tiles[id] && m.tiles[id].label) || 'Tile';
        return wide ? (m.names[id] || SHORT[id] || id) : (SHORT[id] || m.names[id] || id);
    };

    /** One tile: a button (the app's press) over its stacked faces (the app shows the one of the state it reads). */
    function tile(m, id, wide) {
        const button = BUTTONS.has(id);
        const states = button ? ['off', 'dim'] : ['on', 'off', 'dim'];
        const label = labelOf(m, id, wide);
        const sub = (m.st[id] && m.st[id].sub) || '';
        const act = id === 'output' ? 'qa:output' : `qa:${id}:toggle`;
        const faces = states.map((s) => {
            const pic = iconOf(m, id, s);
            // (one element per face: the app draws what an element draws itself, its picture, glass and name)
            return `<span class="qa-face is-${s}" data-live="qa:${id}:${s}" style="--qa-pic:url('${esc(pic)}')">${wide ? esc(label) : ''}</span>`;
        }).join('');
        const subLine = wide ? `<span class="qa-sub" data-live="qa-sub:${id}">${esc(sub)}</span>` : '';
        return `<button type="button" class="qa-tile${wide ? ' is-wide' : ''}" data-android="${act}" aria-label="${esc(label)}">${faces}${subLine}</button>`;
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
    function stripPages(m, cols, room) {
        const TILE = 40; // a tile's height with its gap, in WM units (CSS: .qa-tile 36 + gap 4)
        const SLIDE = 116; // a slider's (CSS: .qa-slider 112 + gap 4)
        const pages = [[]];
        let used = 0;
        let row = [];
        let rowH = 0;
        const flush = () => { used += rowH; row = []; rowH = 0; };
        m.items.forEach((id) => {
            const h = SLIDERS[id] ? SLIDE : TILE;
            const nextH = Math.max(rowH, h);
            if (used + nextH > room - TILE) { pages.push([]); used = 0; row = []; rowH = 0; }
            pages[pages.length - 1].push(id);
            row.push(id);
            rowH = Math.max(rowH, h);
            if (row.length >= cols) flush();
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
        const tr = t ? t.getBoundingClientRect() : { bottom: 0 };
        const sr = s ? s.getBoundingClientRect() : { top: root.innerHeight };
        return { top: tr.bottom, bottom: sr.top || root.innerHeight };
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
        layer.style.top = `${b.top}px`;
        layer.style.height = `${Math.max(0, b.bottom - b.top)}px`;
        if (role === 'qatab') {
            // the grip tab at the swipe zone (the app moves it with the finger): six state glyphs between grip dots
            const zoneTop = Math.max(0, Number(m.cfg.zoneTop) || 0.35);
            const shown = m.items.filter((id) => !SLIDERS[id] && !BUTTONS.has(id) && !id.startsWith('tile:')).slice(0, 6);
            layer.classList.add('is-tab');
            layer.innerHTML = `<div class="qa-tab" style="--qa-top:${Math.round(zoneTop * (root.innerHeight) - b.top)}px">`
                + '<span class="qa-grip"></span>'
                + shown.map((id) => `<span class="qa-mini-slot">${['on', 'off', 'dim'].map((s) => `<span class="qa-mini is-${s}" data-live="qa:${id}:${s}" style="--qa-pic:url('${esc(iconOf(m, id, s))}')"></span>`).join('')}</span>`).join('')
                + '<span class="qa-grip"></span></div>';
            shell.appendChild(layer);
            return true;
        }
        const page = role === 'quickaccess' ? 1 : Math.max(1, parseInt(String(role).split('.')[1], 10) || 1);
        if (m.cfg.layout === 'wide') {
            // P1: everything on one page, the radios wide, the sliders across, the rest four to a row with their names
            layer.classList.add('is-wide');
            const wideIds = m.items.filter((id) => id === 'wifi' || id === 'bluetooth');
            const rest = m.items.filter((id) => !wideIds.includes(id) && !SLIDERS[id]);
            layer.innerHTML = '<div class="qa-panel">'
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
        layer.innerHTML = '<div class="qa-panel"><span class="qa-handle"></span><div class="qa-cells">'
            + ids.map((id) => (SLIDERS[id] ? slider(m, id, false) : tile(m, id, false))).join('')
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
        return JSON.stringify([m.cfg.enabled, m.cfg.side, m.cfg.zoneTop, m.cfg.layout, m.cfg.columns, m.items, m.items.filter((id) => id.startsWith('tile:')).map((id) => m.tiles[id] && m.tiles[id].icon)]);
    }

    root.wmQuickAccess = { open, close, roles, signature, ICONS };
})(window);
