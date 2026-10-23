/**
 * Control Panel's property sheets and dialogs (Yozora #632), drawn from Vista's own templates
 * (vistaDialogTemplates.js through vistaDialogTemplate.js). Each one reads and writes Melaton's
 * registry (melatonRegistry.js) under Vista's own key and value names, and drives the desktop
 * where Melaton has the thing it sets (the taskbar clock's time zone, the Sidebar's side, the
 * browser's home page, the speech voices, the game controllers the browser sees).
 *
 *   cplDialogs.open(id, tab, owner)    'mouse' | 'keyboard' | 'date-and-time' | 'folder-options' |
 *                                      'regional' | 'internet-options' | 'sidebar-properties' |
 *                                      'game-controllers' | 'text-to-speech' | 'offline-files' |
 *                                      'tablet-pc' | 'pen-and-input' | 'iscsi' | 'bluetooth' |
 *                                      'phone-and-modem' | 'people-near-me' | ...
 *
 * A field binds a template control to a registry value:
 *   { page, id, key, name, type, def }   type 'check' | 'text' | 'num' | 'range' | 'select'
 *   { page, radios: { <id>: value }, key, name, def }      a radio group
 * read on open, written on Apply / OK (only the values that changed).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const V = () => root.vistaDialogTemplate;
    const R = () => root.melatonRegistry;

    const KEY = {
        mouse: 'HKCU\\Control Panel\\Mouse',
        cursors: 'HKCU\\Control Panel\\Cursors',
        desktop: 'HKCU\\Control Panel\\Desktop',
        keyboard: 'HKCU\\Control Panel\\Keyboard',
        intl: 'HKCU\\Control Panel\\International',
        geo: 'HKCU\\Control Panel\\International\\Geo',
        timedate: 'HKCU\\Control Panel\\TimeDate',
        tz: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation',
        w32time: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\Parameters',
        explorer: 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Explorer\\Advanced',
        cabinet: 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Explorer\\CabinetState',
        search: 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Explorer\\Search\\Preferences',
        speech: 'HKCU\\Software\\Xyridian\\Speech\\Voices',
        speechRec: 'HKCU\\Software\\Xyridian\\Speech\\RecoProfiles',
        csc: 'HKLM\\Software\\Xyridian\\Melaton\\CurrentVersion\\NetCache',
        tablet: 'HKCU\\Software\\Xyridian\\TabletTip\\1.7',
        pen: 'HKCU\\Software\\Xyridian\\Wisp\\Pen\\SysEventParameters',
        iscsi: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\iSCSI',
        bth: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters',
        telephony: 'HKLM\\Software\\Xyridian\\Melaton\\CurrentVersion\\Telephony\\Locations\\Location1',
        p2p: 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\PeerNet\\PNM',
        inet: 'HKCU\\Software\\Xyridian\\Grimoire\\Main',
        inetPrivacy: 'HKCU\\Software\\Xyridian\\Grimoire\\New Windows',
        inetZones: 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Internet Settings',
        sidebar: 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Sidebar'
    };

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function reg(key, name, def) {
        const r = R();
        return r ? r.get(key, name, def) : def;
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function itemIcon(art) {
        return `/static_images/vista-cpl/items/${art}-32.png`;
    }

    // ---- fields ----------------------------------------------------------------------------------

    function readField(ctx, f) {
        if (f.radios) {
            const hit = Object.keys(f.radios).find((id) => ctx.get(Number(id), f.page));
            return hit === undefined ? f.def : f.radios[hit];
        }
        const v = ctx.get(f.id, f.page);
        switch (f.type) {
            case 'check': return f.invert ? !v : !!v;
            case 'num':
            case 'range': return Number(v);
            default: return v;
        }
    }

    function writeField(ctx, f, value) {
        if (f.radios) {
            Object.entries(f.radios).forEach(([id, val]) => ctx.set(Number(id), val === value, f.page));
            return;
        }
        if (f.type === 'range' && f.min !== undefined) ctx.range(f.id, f.min, f.max, value, f.page, f.ticks);
        else if (f.type === 'check') ctx.set(f.id, f.invert ? !value : !!value, f.page);
        else ctx.set(f.id, value, f.page);
    }

    function initFields(ctx, fields) {
        ctx.store.initial = new Map();
        fields.forEach((f) => {
            if (f.options) ctx.options(f.id, typeof f.options === 'function' ? f.options() : f.options, undefined, f.page);
            const value = reg(f.key, f.name, typeof f.def === 'function' ? f.def() : f.def);
            writeField(ctx, f, value);
            ctx.store.initial.set(f, value);
        });
    }

    async function applyFields(ctx, fields) {
        const byKey = {};
        fields.forEach((f) => {
            if (f.readonly) return;
            const value = readField(ctx, f);
            if (value === undefined || value === ctx.store.initial.get(f)) return;
            (byKey[f.key] = byKey[f.key] || {})[f.name] = value;
            ctx.store.initial.set(f, value);
        });
        const r = R();
        if (!r) return byKey;
        await Promise.all(Object.entries(byKey).map(([key, values]) => r.set(key, values)));
        return byKey;
    }

    /** A sheet from a definition: pages, fields, its own init / apply on top. */
    function sheet(def, tab, owner) {
        const fields = def.fields || [];
        return V().openSheet({
            id: def.windowId,
            title: def.title,
            icon: def.icon,
            owner,
            start: def.tabs && tab ? def.tabs[tab] : undefined,
            pages: def.pages,
            noApply: def.noApply,
            init(ctx) {
                initFields(ctx, fields);
                if (def.init) def.init(ctx);
            },
            async apply(ctx) {
                const changed = await applyFields(ctx, fields);
                if (def.apply) await def.apply(ctx, changed);
            },
            pageShown: def.pageShown,
            close: def.close
        });
    }

    /** Vista's Hardware tab (built at run time, so its template is empty): the devices, then Device Properties. */
    function hardwareTab(devices, kind) {
        const rows = devices.map((d, i) => `<div class="vdt-lv-row${i === 0 ? ' is-selected' : ''}" data-dev="${i}"><span style="width:240px"><img src="${esc(d.icon)}" alt="">${esc(d.name)}</span><span>${esc(d.type)}</span></div>`).join('');
        const d = devices[0] || {};
        return `
            <div class="tbp-ctl tbp-static" style="left:11px;top:11px;width:300px;height:13px;">De<u>v</u>ices:</div>
            <div class="tbp-ctl vdt-listview vdt-edge is-report" style="left:11px;top:27px;width:356px;height:110px;" tabindex="0">
                <div class="vdt-lv-header"><span class="vdt-lv-col" style="width:240px">Name</span><span class="vdt-lv-col">Type</span></div>
                <div class="vdt-lv-body">${rows}</div>
            </div>
            <div class="tbp-group" style="left:11px;top:146px;width:357px;height:140px;"><span class="tbp-group-label">Device Properties</span></div>
            <div class="tbp-ctl tbp-static" style="left:22px;top:166px;width:330px;height:13px;">Manufacturer: ${esc(d.maker || 'Xyridian Corporation')}</div>
            <div class="tbp-ctl tbp-static" style="left:22px;top:182px;width:330px;height:13px;">Location: ${esc(d.location || 'on ' + (kind || 'USB Input Device'))}</div>
            <div class="tbp-ctl tbp-static" style="left:22px;top:198px;width:330px;height:13px;">Device status: This device is working properly.</div>
            <button type="button" class="tbp-ctl tbp-button" style="left:278px;top:258px;width:73px;height:21px;" data-hw="properties"><u>P</u>roperties</button>`;
    }

    // ---- Mouse ---------------------------------------------------------------------------------

    // Vista's double-click speed: 10 stops from 900 ms (slow) to 200 ms (fast)
    const DOUBLE_CLICK = (stop) => Math.round(900 - stop * 70);
    // melatonPointerScheme.js draws these with Vista's Aero cursors; (None) keeps the browser's
    const POINTER_SCHEMES = ['(None)', 'Melaton Aero (system scheme)', 'Melaton Aero (large) (system scheme)', 'Melaton Aero (extra large) (system scheme)'];
    const POINTER_ROLES = [
        ['Normal Select', 'aero_arrow'], ['Help Select', 'aero_helpsel'], ['Working In Background', 'aero_working'],
        ['Busy', 'aero_busy'], ['Handwriting', 'aero_pen'],
        ['Unavailable', 'aero_unavail'], ['Vertical Resize', 'aero_ns'], ['Horizontal Resize', 'aero_ew'],
        ['Diagonal Resize 1', 'aero_nwse'], ['Diagonal Resize 2', 'aero_nesw'], ['Move', 'aero_move'],
        ['Alternate Select', 'aero_up'], ['Link Select', 'aero_link']
    ];

    const DIALOGS = {};

    DIALOGS.mouse = {
        windowId: 'cplMouseProperties',
        title: 'Mouse Properties',
        icon: itemIcon('mouse'),
        tabs: { buttons: 'main:100', pointers: 'main:101', options: 'main:103', wheel: 'main:108', hardware: 'main:106' },
        pages: [
            { key: 'main:100', overrides: { 103: { html: '<img class="cpl-mouse-picture" src="/static_images/vista-dlg/main-mouse.png" alt="">' }, 106: { html: '<button type="button" class="cpl-dbl-folder" aria-label="Test folder"></button>' } } },
            { key: 'main:101', overrides: { 110: { html: '<img class="cpl-pointer-preview" alt="">' } } },
            { key: 'main:103' },
            { key: 'main:108' },
            { key: 'main:106', overrides: {} }
        ],
        fields: [
            { page: 'main:100', id: 101, key: KEY.mouse, name: 'SwapMouseButtons', type: 'check', def: false },
            { page: 'main:100', id: 105, key: KEY.mouse, name: 'DoubleClickSpeedStop', type: 'range', min: 0, max: 10, def: 5 },
            { page: 'main:100', id: 114, key: KEY.desktop, name: 'ClickLock', type: 'check', def: false },
            { page: 'main:101', id: 114, key: KEY.cursors, name: 'PointerShadow', type: 'check', def: true },
            { page: 'main:103', id: 101, key: KEY.mouse, name: 'MouseSensitivity', type: 'range', min: 1, max: 20, def: 10, ticks: 10 },
            { page: 'main:103', id: 116, key: KEY.mouse, name: 'EnhancePointerPrecision', type: 'check', def: true },
            { page: 'main:103', id: 109, key: KEY.mouse, name: 'SnapToDefaultButton', type: 'check', def: false },
            { page: 'main:103', id: 103, key: KEY.mouse, name: 'MouseTrailsOn', type: 'check', def: false },
            { page: 'main:103', id: 104, key: KEY.mouse, name: 'MouseTrails', type: 'range', min: 2, max: 7, def: 7 },
            { page: 'main:103', id: 114, key: KEY.desktop, name: 'MouseVanish', type: 'check', def: true },
            { page: 'main:103', id: 115, key: KEY.desktop, name: 'MouseSonar', type: 'check', def: false },
            { page: 'main:108', radios: { 103: 'lines', 104: 'page' }, key: KEY.desktop, name: 'WheelScrollMode', def: 'lines' },
            { page: 'main:108', id: 105, key: KEY.desktop, name: 'WheelScrollLines', type: 'num', def: 3 },
            { page: 'main:108', id: 110, key: KEY.desktop, name: 'WheelScrollChars', type: 'num', def: 3 }
        ],
        init(ctx) {
            ctx.options(113, POINTER_SCHEMES, reg(KEY.cursors, 'Scheme', '(None)'), 'main:101');
            const preview = ctx.page('main:101').querySelector('.cpl-pointer-preview');
            const showScheme = () => {
                const scheme = ctx.get(113, 'main:101');
                const suffix = /extra large/.test(scheme) ? '_xl' : /large/.test(scheme) ? '_l' : '';
                const none = scheme === '(None)';
                ctx.holder(101, 'main:101').querySelectorAll('.cpl-cursor-row img').forEach((img) => {
                    img.style.visibility = none ? 'hidden' : '';
                    img.src = `/static_images/vista-cursors/${img.dataset.file}${suffix}.png`;
                });
                if (preview) { preview.hidden = none; if (!none) preview.src = `/static_images/vista-cursors/aero_arrow${suffix}.png`; }
            };
            ctx.store.showScheme = showScheme;
            ctx.on(113, 'change', showScheme, 'main:101');
            const list = ctx.holder(101, 'main:101');
            if (list) {
                list.classList.add('cpl-cursor-list');
                list.innerHTML = POINTER_ROLES.map(([name, file], i) => `<div class="vdt-lb-row cpl-cursor-row${i === 0 ? ' is-selected' : ''}" data-value="${i}"><span>${esc(name)}</span><img data-file="${file}" alt="" onerror="this.style.visibility='hidden'"></div>`).join('');
            }
            ctx.store.showScheme();
            const updownLimits = (id) => {
                const h = ctx.holder(id, 'main:108');
                if (h) { h.dataset.min = '1'; h.dataset.max = '100'; }
            };
            updownLimits(106);
            updownLimits(111);
            // the double-click test folder opens and closes on a double-click at the chosen speed
            const folder = ctx.holder(106, 'main:100');
            let last = 0;
            if (folder) {
                folder.addEventListener('click', () => {
                    const now = Date.now();
                    const limit = DOUBLE_CLICK(Number(ctx.get(105, 'main:100')));
                    if (now - last <= limit) {
                        folder.classList.toggle('is-open');
                        last = 0;
                    } else last = now;
                });
            }
            ctx.on(103, 'change', () => ctx.enable(104, ctx.get(103, 'main:103'), 'main:103'), 'main:103');
            ctx.enable(104, ctx.get(103, 'main:103'), 'main:103');
            ctx.on(115, 'click', () => openClickLock(ctx), 'main:100');
            ctx.enable(115, ctx.get(114, 'main:100'), 'main:100');
            ctx.on(114, 'change', () => ctx.enable(115, ctx.get(114, 'main:100'), 'main:100'), 'main:100');
            ctx.page('main:106').insertAdjacentHTML('beforeend', hardwareTab([{ name: 'HID-compliant mouse', type: 'Mice and other pointing devices', icon: '/static_images/vista-cpl/items/mouse-16.png' }], 'USB Input Device'));
        },
        async apply(ctx) {
            const scheme = ctx.get(113, 'main:101');
            const r = R();
            if (r) await r.set(KEY.mouse, { DoubleClickSpeed: DOUBLE_CLICK(Number(ctx.get(105, 'main:100'))) });
            if (r && scheme !== reg(KEY.cursors, 'Scheme', '(None)')) await r.set(KEY.cursors, { Scheme: scheme === '(None)' ? null : scheme });
        }
    };

    function openClickLock(owner) {
        V().openDialog({
            id: 'cplClickLockSettings',
            key: 'main:116',
            owner: owner.modal,
            init(ctx) { ctx.range(120, 0, 10, reg(KEY.desktop, 'ClickLockTime', 5)); },
            async ok(ctx) { if (R()) await R().set(KEY.desktop, { ClickLockTime: Number(ctx.get(120)) }); }
        });
    }

    // ---- Keyboard ------------------------------------------------------------------------------

    DIALOGS.keyboard = {
        windowId: 'cplKeyboardProperties',
        title: 'Keyboard Properties',
        icon: itemIcon('keyboard'),
        tabs: { speed: 'main:104', hardware: 'main:106' },
        pages: [{ key: 'main:104', overrides: { 103: { html: '' }, 104: { html: '<span class="cpl-blink-caret"></span>', cls: 'cpl-blink-host' } } }, { key: 'main:106' }],
        fields: [
            { page: 'main:104', id: 100, key: KEY.keyboard, name: 'KeyboardDelay', type: 'range', min: 0, max: 3, def: 1, ticks: 3 },
            { page: 'main:104', id: 101, key: KEY.keyboard, name: 'KeyboardSpeed', type: 'range', min: 0, max: 31, def: 31, ticks: 31 },
            { page: 'main:104', id: 105, key: KEY.desktop, name: 'CursorBlinkStop', type: 'range', min: 0, max: 10, def: 5 }
        ],
        init(ctx) {
            const caret = ctx.page('main:104').querySelector('.cpl-blink-caret');
            const blink = () => {
                const stop = Number(ctx.get(105, 'main:104'));
                caret.style.animationDuration = stop === 0 ? '0s' : `${(1200 - (stop - 1) * 100) * 2}ms`;
                caret.classList.toggle('is-off', stop === 0);
            };
            ctx.on(105, 'input', blink, 'main:104');
            blink();
            ctx.page('main:106').insertAdjacentHTML('beforeend', hardwareTab([{ name: 'Standard PS/2 Keyboard', type: 'Keyboards', icon: '/static_images/vista-cpl/items/keyboard-16.png', location: 'plugged into keyboard port' }]));
            // the on-screen keyboard the Keyboard item used to open (modalUtils.js) is under Ease of Access
        },
        async apply(ctx) {
            const stop = Number(ctx.get(105, 'main:104'));
            if (R()) await R().set(KEY.desktop, { CursorBlinkRate: stop === 0 ? -1 : 1200 - (stop - 1) * 100 });
        }
    };

    // ---- Date and Time -------------------------------------------------------------------------

    function zoneOffset(zone, at = new Date()) {
        try {
            const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName');
            const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(part ? part.value : '');
            if (!m) return 0;
            const h = Number(m[1]);
            return h * 60 + Math.sign(h || 1) * Number(m[2] || 0);
        } catch (_) {
            return 0;
        }
    }

    function zoneLabel(zone) {
        const off = zoneOffset(zone, new Date(new Date().getFullYear(), 0, 1));
        const sign = off < 0 ? '-' : '+';
        const a = Math.abs(off);
        const city = zone.split('/').slice(1).join(', ').replace(/_/g, ' ') || zone;
        return `(GMT${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}) ${city}`;
    }

    let zoneCache = null;
    function zones() {
        if (zoneCache) return zoneCache;
        let list = [];
        try { list = Intl.supportedValuesOf('timeZone'); } catch (_) { list = ['UTC']; }
        zoneCache = list.map((z) => ({ value: z, text: zoneLabel(z), off: zoneOffset(z, new Date(new Date().getFullYear(), 0, 1)) }))
            .sort((a, b) => a.off - b.off || a.text.localeCompare(b.text));
        return zoneCache;
    }

    function browserZone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; }
    }

    /** Melaton's time zone: the registry's, else the browser's (taskbarClock.js reads it the same way). */
    function currentZone() {
        return reg(KEY.tz, 'TimeZoneKeyName', '') || browserZone();
    }

    function fmt(zone, opts, at = new Date()) {
        try { return new Intl.DateTimeFormat('en-US', { timeZone: zone, ...opts }).format(at); } catch (_) { return ''; }
    }

    function clockHtml() {
        // the taskbar clock flyout's art (vista-taskbar.css .taskbar-clock-face), Vista's own face
        return `<div class="taskbar-clock-face cpl-dt-clock">
            <img src="/static_images/vista-taskbar/clock-face.png" alt="" width="128" height="128" draggable="false">
            <svg class="taskbar-clock-hands" viewBox="0 0 128 128" aria-hidden="true">
                <line class="hand-hour" x1="64" y1="64" x2="64" y2="34"></line>
                <line class="hand-minute" x1="64" y1="64" x2="64" y2="20"></line>
                <line class="hand-second" x1="64" y1="72" x2="64" y2="16"></line>
                <circle cx="64" cy="64" r="2.5"></circle>
            </svg>
            <img class="taskbar-clock-gloss" src="/static_images/vista-taskbar/clock-gloss.png" alt="" width="128" height="128" draggable="false">
        </div>`;
    }

    function setHands(host, date) {
        if (!host) return;
        const s = date.getSeconds();
        const m = date.getMinutes() + s / 60;
        const h = (date.getHours() % 12) + m / 60;
        const turn = (cls, deg) => {
            const el = host.querySelector(cls);
            if (el) el.setAttribute('transform', `rotate(${deg.toFixed(2)} 64 64)`);
        };
        turn('.hand-hour', h * 30);
        turn('.hand-minute', m * 6);
        turn('.hand-second', s * 6);
    }

    /** "now" in a zone, as a Date whose local fields read that zone's wall clock. */
    function wallClock(zone, at = new Date()) {
        const parts = {};
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
                .formatToParts(at).forEach((p) => { parts[p.type] = p.value; });
            return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
        } catch (_) {
            return at;
        }
    }

    function nextDstChange(zone) {
        const now = new Date();
        const start = zoneOffset(zone, now);
        for (let d = 1; d <= 400; d += 1) {
            const t = new Date(now.getTime() + d * 86400000);
            if (zoneOffset(zone, t) !== start) {
                // narrow to the hour
                let lo = new Date(t.getTime() - 86400000);
                let hi = t;
                while (hi - lo > 3600000) {
                    const mid = new Date((lo.getTime() + hi.getTime()) / 2);
                    if (zoneOffset(zone, mid) === start) lo = mid; else hi = mid;
                }
                return { at: hi, from: start, to: zoneOffset(zone, hi) };
            }
        }
        return null;
    }

    DIALOGS['date-and-time'] = {
        windowId: 'cplDateAndTime',
        title: 'Date and Time',
        icon: itemIcon('date-and-time'),
        tabs: { clocks: 'timedate:350', internet: 'timedate:2' },
        pages: [
            { key: 'timedate:1', overrides: { 113: { html: clockHtml() }, 118: { html: '<div class="cpl-dt-date"></div>' }, 114: { html: '<div class="cpl-dt-time"></div>' }, 122: { html: '<div class="cpl-dt-zone"></div>' } } },
            { key: 'timedate:350' },
            { key: 'timedate:2' }
        ],
        fields: [
            { page: 'timedate:350', id: 351, key: `${KEY.timedate}\\AdditionalClocks\\1`, name: 'Enable', type: 'check', def: false },
            { page: 'timedate:350', id: 353, key: `${KEY.timedate}\\AdditionalClocks\\1`, name: 'TzRegKeyName', type: 'select', def: () => browserZone() },
            { page: 'timedate:350', id: 355, key: `${KEY.timedate}\\AdditionalClocks\\1`, name: 'DisplayName', type: 'text', def: 'Clock 1' },
            { page: 'timedate:350', id: 352, key: `${KEY.timedate}\\AdditionalClocks\\2`, name: 'Enable', type: 'check', def: false },
            { page: 'timedate:350', id: 354, key: `${KEY.timedate}\\AdditionalClocks\\2`, name: 'TzRegKeyName', type: 'select', def: () => browserZone() },
            { page: 'timedate:350', id: 356, key: `${KEY.timedate}\\AdditionalClocks\\2`, name: 'DisplayName', type: 'text', def: 'Clock 2' },
            { page: 'timedate:1', id: 127, key: KEY.timedate, name: 'DstReminder', type: 'check', def: true }
        ],
        init(ctx) {
            const z = zones();
            ctx.options(353, z, undefined, 'timedate:350');
            ctx.options(354, z, undefined, 'timedate:350');
            // re-run the select fields now that they have options
            ctx.set(353, reg(`${KEY.timedate}\\AdditionalClocks\\1`, 'TzRegKeyName', browserZone()), 'timedate:350');
            ctx.set(354, reg(`${KEY.timedate}\\AdditionalClocks\\2`, 'TzRegKeyName', browserZone()), 'timedate:350');
            const syncClockFields = (n) => {
                const on = ctx.get(350 + n, 'timedate:350');
                [356 + n, 352 + n, 358 + n, 354 + n].forEach((id) => ctx.enable(id, on, 'timedate:350'));
            };
            ctx.on(351, 'change', () => syncClockFields(1), 'timedate:350');
            ctx.on(352, 'change', () => syncClockFields(2), 'timedate:350');
            syncClockFields(1);
            syncClockFields(2);
            const page = ctx.page('timedate:1');
            const tick = () => {
                const zone = currentZone();
                const now = wallClock(zone);
                setHands(page.querySelector('.cpl-dt-clock'), now);
                page.querySelector('.cpl-dt-date').textContent = fmt(zone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                page.querySelector('.cpl-dt-time').textContent = fmt(zone, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
            };
            const zoneText = () => {
                const zone = currentZone();
                page.querySelector('.cpl-dt-zone').textContent = zoneLabel(zone);
                const dst = nextDstChange(zone);
                if (dst) {
                    const delta = (dst.to - dst.from) / 60;
                    const when = fmt(zone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, dst.at);
                    const at = fmt(zone, { hour: 'numeric', minute: '2-digit' }, new Date(dst.at.getTime() - 1000));
                    ctx.text(125, `Daylight Saving Time ${delta > 0 ? 'begins' : 'ends'} on ${when} at ${at}. The clock is set to go ${delta > 0 ? 'forward' : 'back'} 1 hour at that time.`, 'timedate:1');
                    ctx.show(127, true, 'timedate:1');
                } else {
                    ctx.text(125, 'Daylight Saving Time is not observed in this time zone.', 'timedate:1');
                    ctx.show(127, false, 'timedate:1');
                }
            };
            ctx.store.zoneText = zoneText;
            tick();
            zoneText();
            ctx.store.timer = setInterval(tick, 1000);
            ctx.on(116, 'click', () => openDateTimeSettings(ctx), 'timedate:1');
            ctx.on(126, 'click', () => openTimeZone(ctx), 'timedate:1');
            // Internet Time
            const sync = reg(KEY.w32time, 'Type', 'NTP') === 'NTP';
            const server = reg(KEY.w32time, 'NtpServer', 'time.windows.com').replace('time.windows.com', 'time.melaton.dreamscape.jp');
            const last = reg(KEY.w32time, 'LastSync', '');
            ctx.text(820, sync ? `This computer is set to automatically synchronize with '${server}'.` : 'This computer is not set to automatically synchronize.', 'timedate:2');
            ctx.text(823, sync ? 'Next synchronization: when the server is reached.' : '', 'timedate:2');
            ctx.text(825, last ? `The clock was successfully synchronized with ${server} on ${last}.` : 'Melaton keeps its time from the domain controller each time it connects.', 'timedate:2');
            ctx.on(827, 'click', () => openInternetTime(ctx), 'timedate:2');
            ctx.content.querySelectorAll('.vdt-link').forEach((a) => a.addEventListener('click', () => callGlobal('openHelpAndSupport', 'date-and-time')));
        },
        close(ctx) { clearInterval(ctx.store.timer); }
    };

    function openTimeZone(owner) {
        V().openDialog({
            id: 'cplTimeZoneSettings',
            key: 'timedate:4',
            owner: owner.modal,
            init(ctx) {
                ctx.options(122, zones(), currentZone());
                ctx.set(127, reg(KEY.tz, 'DynamicDaylightTimeDisabled', 0) !== 1);
                const sel = ctx.el(122);
                const show = () => ctx.set(401, fmt(sel.value, { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }));
                sel.addEventListener('change', show);
                show();
            },
            async ok(ctx) {
                const zone = ctx.get(122);
                if (R()) await R().set(KEY.tz, { TimeZoneKeyName: zone === browserZone() ? null : zone, DynamicDaylightTimeDisabled: ctx.get(127) ? 0 : 1 });
                if (owner.store.zoneText) owner.store.zoneText();
                // taskbarClock.js redraws in the new zone
                if (root.taskbarClock && typeof root.taskbarClock.refresh === 'function') root.taskbarClock.refresh();
            }
        });
    }

    function openDateTimeSettings(owner) {
        // Melaton keeps the domain controller's time; Vista's dialog is shown with today's date for reference
        V().openDialog({
            id: 'cplDateTimeSettings',
            key: 'timedate:3',
            owner: owner.modal,
            overrides: { 111: { html: '<div class="cpl-month"></div>' }, 113: { html: clockHtml() }, 117: { html: '<input type="text" class="tbp-edit cpl-dt-digital" readonly>' }, 716: { hidden: true } },
            init(ctx) {
                const zone = currentZone();
                const now = wallClock(zone);
                renderMonth(ctx.content.querySelector('.cpl-month'), now);
                const tick = () => {
                    const t = wallClock(zone);
                    setHands(ctx.content.querySelector('.cpl-dt-clock'), t);
                    ctx.content.querySelector('.cpl-dt-digital').value = fmt(zone, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
                };
                tick();
                ctx.store.timer = setInterval(tick, 1000);
                ctx.text(112, `Current time zone: ${zoneLabel(zone).replace(/^\(GMT[^)]*\)\s*/, '')}`);
            },
            cancel(ctx) { clearInterval(ctx.store.timer); },
            ok(ctx) { clearInterval(ctx.store.timer); }
        });
    }

    /** Vista's month calendar (SysMonthCal32): the title with arrows, Su..Sa, six weeks, today ringed. */
    function renderMonth(host, date, shown) {
        if (!host) return;
        const view = shown || new Date(date.getFullYear(), date.getMonth(), 1);
        const first = new Date(view.getFullYear(), view.getMonth(), 1);
        const start = new Date(first);
        start.setDate(1 - first.getDay());
        const cells = [];
        for (let i = 0; i < 42; i += 1) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const other = d.getMonth() !== view.getMonth();
            const today = d.toDateString() === date.toDateString();
            cells.push(`<span class="cpl-month-day${other ? ' is-other' : ''}${today ? ' is-today' : ''}">${d.getDate()}</span>`);
        }
        host.innerHTML = `
            <div class="cpl-month-head"><button type="button" class="cpl-month-prev" aria-label="Previous"></button><span>${first.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span><button type="button" class="cpl-month-next" aria-label="Next"></button></div>
            <div class="cpl-month-dow">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => `<span>${d}</span>`).join('')}</div>
            <div class="cpl-month-grid">${cells.join('')}</div>`;
        host.querySelector('.cpl-month-prev').onclick = () => renderMonth(host, date, new Date(view.getFullYear(), view.getMonth() - 1, 1));
        host.querySelector('.cpl-month-next').onclick = () => renderMonth(host, date, new Date(view.getFullYear(), view.getMonth() + 1, 1));
    }

    function openInternetTime(owner) {
        const servers = ['time.melaton.dreamscape.jp', 'time.nist.gov', 'time-nw.nist.gov', 'time-a.nist.gov', 'time-b.nist.gov', 'pool.ntp.org'];
        V().openDialog({
            id: 'cplInternetTimeSettings',
            key: 'timedate:5',
            owner: owner.modal,
            init(ctx) {
                ctx.set(820, reg(KEY.w32time, 'Type', 'NTP') === 'NTP');
                ctx.options(821, servers, reg(KEY.w32time, 'NtpServer', servers[0]));
                ctx.text(825, '');
                ctx.on(826, 'click', async () => {
                    // the domain controller is Melaton's time source: report the skew it measures
                    const t0 = Date.now();
                    let msg = 'An error occurred while Melaton was synchronizing with the server.';
                    try {
                        const r = await fetch('/', { method: 'HEAD', cache: 'no-store' });
                        const server = Date.parse(r.headers.get('date') || '');
                        if (server) {
                            const when = new Date().toLocaleString('en-US');
                            msg = `The clock was successfully synchronized with ${ctx.get(821)} on ${when}. (Offset ${Math.round((Date.now() + t0) / 2 - server)} ms)`;
                            if (R()) void R().set(KEY.w32time, { LastSync: when });
                        }
                    } catch (_) { /* message above */ }
                    ctx.text(825, msg);
                });
            },
            async ok(ctx) {
                if (R()) await R().set(KEY.w32time, { Type: ctx.get(820) ? 'NTP' : 'NoSync', NtpServer: ctx.get(821) });
            }
        });
    }

    // ---- Folder Options ------------------------------------------------------------------------

    // View > Advanced settings: Vista's tree (shell32's "Advanced settings" list), Windows -> Melaton
    const FOLDER_ADVANCED = [
        { group: 'Files and Folders', icon: 'folder', items: [
            { t: 'Always show icons, never thumbnails', n: 'IconsOnly', d: false },
            { t: 'Always show menus', n: 'AlwaysShowMenus', d: false },
            { t: 'Display file icon on thumbnails', n: 'ShowTypeOverlay', d: true },
            { t: 'Display file size information in folder tips', n: 'FolderContentsInfoTip', d: true },
            { t: 'Display simple folder view in Navigation pane', n: 'NavPaneShowAllFolders', d: true },
            { t: 'Display the full path in the title bar (Classic folders only)', n: 'FullPath', d: false },
            { sub: 'Hidden files and folders', radios: [
                { t: 'Do not show hidden files and folders', v: 2 },
                { t: 'Show hidden files and folders', v: 1 }], n: 'Hidden', d: 2 },
            { t: 'Hide extensions for known file types', n: 'HideFileExt', d: true },
            { t: 'Hide protected operating system files (Recommended)', n: 'ShowSuperHidden', d: true, invert: true },
            { t: 'Launch folder windows in a separate process', n: 'SeparateProcess', d: false },
            { t: 'Remember each folder\'s view settings', n: 'ClassicViewState', d: true, invert: true },
            { t: 'Restore previous folder windows at logon', n: 'PersistBrowsers', d: false },
            { t: 'Show drive letters', n: 'ShowDriveLettersFirst', d: true },
            { t: 'Show encrypted or compressed NTFS files in color', n: 'ShowCompColor', d: true },
            { t: 'Show pop-up description for folder and desktop items', n: 'ShowInfoTip', d: true },
            { t: 'Show preview handlers in preview pane', n: 'ShowPreviewHandlers', d: true },
            { t: 'Use check boxes to select items', n: 'AutoCheckSelect', d: false },
            { t: 'Use Sharing Wizard (Recommended)', n: 'SharingWizardOn', d: true },
            { sub: 'When typing into list view', radios: [
                { t: 'Automatically type into the Search Box', v: 1 },
                { t: 'Select the typed item in the view', v: 0 }], n: 'TypeAhead', d: 0 }] },
        { group: 'Navigation pane', icon: 'nav', items: [
            { t: 'Show all folders', n: 'NavPaneShowAll', d: false },
            { t: 'Automatically expand to current folder', n: 'NavPaneExpandToCurrentFolder', d: false }] }
    ];

    function folderTree(values) {
        const row = (cls, inner) => `<div class="tbp-tree-row ${cls}">${inner}</div>`;
        let n = 0;
        const out = [];
        FOLDER_ADVANCED.forEach((g) => {
            out.push(row('is-node cpl-fo-group', `<img src="/static_images/vista-icons/explorer/folder-16.png" alt="" onerror="this.remove()"><span>${esc(g.group)}</span>`));
            g.items.forEach((it) => {
                if (it.radios) {
                    out.push(row('is-child cpl-fo-sub', `<img src="/static_images/vista-icons/explorer/folder-16.png" alt="" onerror="this.remove()"><span>${esc(it.sub)}</span>`));
                    it.radios.forEach((r) => {
                        n += 1;
                        out.push(row('is-child cpl-fo-radio', `<input type="radio" id="cpl-fo-${n}" name="cpl-fo-${it.n}" data-fo-name="${it.n}" value="${r.v}"${values[it.n] === r.v ? ' checked' : ''}><label for="cpl-fo-${n}">${esc(r.t)}</label>`));
                    });
                } else {
                    n += 1;
                    const on = it.invert ? !values[it.n] : !!values[it.n];
                    out.push(row('is-child', `<input type="checkbox" id="cpl-fo-${n}" data-fo-name="${it.n}"${it.invert ? ' data-fo-invert="1"' : ''}${on ? ' checked' : ''}><label for="cpl-fo-${n}">${esc(it.t)}</label>`));
                }
            });
        });
        return out.join('');
    }

    function folderValues(defaults) {
        const v = {};
        FOLDER_ADVANCED.forEach((g) => g.items.forEach((it) => { v[it.n] = defaults ? it.d : reg(KEY.explorer, it.n, it.d); }));
        return v;
    }

    DIALOGS['folder-options'] = {
        windowId: 'cplFolderOptions',
        title: 'Folder Options',
        icon: itemIcon('folder-options'),
        tabs: { general: 'shell32:29959', view: 'shell32:29960', search: 'shell32:29961' },
        pages: [
            { key: 'shell32:29959', overrides: {
                30109: { image: '/static_images/vista-dlg/fo-tasks.png' },
                30110: { image: '/static_images/vista-dlg/fo-browse.png' },
                30111: { image: '/static_images/vista-dlg/fo-click.png' } } },
            { key: 'shell32:29960', overrides: { 30120: { html: '', cls: 'tbp-tree cpl-fo-tree' } } },
            { key: 'shell32:29961' }
        ],
        fields: [
            { page: 'shell32:29959', radios: { 30098: 'common', 30099: 'classic' }, key: KEY.explorer, name: 'WebView', def: 'common' },
            { page: 'shell32:29959', radios: { 30100: 'same', 30101: 'own' }, key: KEY.cabinet, name: 'NewWindow', def: 'same' },
            { page: 'shell32:29959', radios: { 30102: 'single', 30103: 'double' }, key: KEY.explorer, name: 'ClickMode', def: 'double' },
            { page: 'shell32:29959', radios: { 30104: 'browser', 30105: 'point' }, key: KEY.explorer, name: 'IconUnderline', def: 'point' },
            { page: 'shell32:29961', radios: { 30977: 'indexed', 30978: 'contents', 30979: 'names' }, key: KEY.search, name: 'WhatToSearch', def: 'indexed' },
            { page: 'shell32:29961', id: 30980, key: KEY.search, name: 'SearchSubFolders', type: 'check', def: true },
            { page: 'shell32:29961', id: 30981, key: KEY.search, name: 'WholeFileSystem', type: 'check', def: true },
            { page: 'shell32:29961', id: 30982, key: KEY.search, name: 'EnableNaturalQuerySyntax', type: 'check', def: false },
            { page: 'shell32:29961', id: 30983, key: KEY.search, name: 'DontUseIndex', type: 'check', def: false },
            { page: 'shell32:29961', id: 30984, key: KEY.search, name: 'SystemFolders', type: 'check', def: false },
            { page: 'shell32:29961', id: 30985, key: KEY.search, name: 'ArchivedFiles', type: 'check', def: false }
        ],
        init(ctx) {
            const tree = ctx.holder(30120, 'shell32:29960');
            const fill = (defaults) => { tree.innerHTML = folderTree(folderValues(defaults)); };
            fill(false);
            tree.addEventListener('change', () => ctx.dirty());
            const syncUnderline = () => {
                const single = ctx.get(30102, 'shell32:29959');
                ctx.enable(30104, single, 'shell32:29959');
                ctx.enable(30105, single, 'shell32:29959');
            };
            ctx.page('shell32:29959').addEventListener('change', syncUnderline);
            syncUnderline();
            ctx.on(30107, 'click', () => {
                ctx.set(30098, true, 'shell32:29959'); ctx.set(30100, true, 'shell32:29959');
                ctx.set(30103, true, 'shell32:29959'); ctx.set(30105, true, 'shell32:29959');
                syncUnderline(); ctx.dirty();
            }, 'shell32:29959');
            ctx.on(30121, 'click', () => { fill(true); ctx.dirty(); }, 'shell32:29960');
            ctx.on(30986, 'click', () => {
                ctx.set(30977, true, 'shell32:29961');
                [30980, 30981].forEach((id) => ctx.set(id, true, 'shell32:29961'));
                [30982, 30983, 30984, 30985].forEach((id) => ctx.set(id, false, 'shell32:29961'));
                ctx.dirty();
            }, 'shell32:29961');
            ctx.content.querySelectorAll('.vdt-link').forEach((a) => a.addEventListener('click', () => callGlobal('openHelpAndSupport', 'folder-options')));
        },
        async apply(ctx) {
            const values = {};
            ctx.holder(30120, 'shell32:29960').querySelectorAll('[data-fo-name]').forEach((input) => {
                const name = input.dataset.foName;
                if (input.type === 'radio') {
                    if (input.checked) values[name] = Number(input.value);
                } else values[name] = input.dataset.foInvert ? !input.checked : input.checked;
            });
            if (R()) await R().set(KEY.explorer, values);
            // Cartograph re-reads Folder Options (explorerApplet.js applyFolderOptions)
            if (typeof root.explorerApplyFolderOptions === 'function') root.explorerApplyFolderOptions();
        }
    };

    // ---- Regional and Language Options ---------------------------------------------------------

    const LOCALES = ['af-ZA', 'ar-SA', 'bg-BG', 'ca-ES', 'cs-CZ', 'da-DK', 'de-AT', 'de-CH', 'de-DE', 'el-GR', 'en-AU', 'en-CA', 'en-GB', 'en-IE', 'en-IN', 'en-NZ', 'en-US', 'en-ZA', 'es-ES', 'es-MX', 'et-EE', 'fi-FI', 'fr-BE', 'fr-CA', 'fr-CH', 'fr-FR', 'he-IL', 'hi-IN', 'hr-HR', 'hu-HU', 'id-ID', 'is-IS', 'it-IT', 'ja-JP', 'ko-KR', 'lt-LT', 'lv-LV', 'ms-MY', 'nb-NO', 'nl-BE', 'nl-NL', 'pl-PL', 'pt-BR', 'pt-PT', 'ro-RO', 'ru-RU', 'sk-SK', 'sl-SI', 'sr-Latn-RS', 'sv-SE', 'th-TH', 'tr-TR', 'uk-UA', 'vi-VN', 'zh-CN', 'zh-HK', 'zh-TW'];

    function localeName(tag) {
        try {
            const dn = new Intl.DisplayNames(['en'], { type: 'language' });
            const lang = dn.of(tag.split('-')[0]);
            const region = new Intl.DisplayNames(['en'], { type: 'region' }).of(tag.split('-').pop());
            return `${lang} (${region})`;
        } catch (_) {
            return tag;
        }
    }

    function regionList() {
        const codes = 'AE AR AT AU BE BG BR CA CH CL CN CO CZ DE DK EE EG ES FI FR GB GR HK HR HU ID IE IL IN IS IT JP KR LT LV MX MY NL NO NZ PE PH PL PT RO RS RU SA SE SG SI SK TH TR TW UA US VN ZA'.split(' ');
        let dn = null;
        try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) { /* codes */ }
        return codes.map((c) => ({ value: c, text: dn ? dn.of(c) : c })).sort((a, b) => a.text.localeCompare(b.text));
    }

    function browserLocale() {
        const l = (root.navigator && root.navigator.language) || 'en-US';
        return LOCALES.includes(l) ? l : 'en-US';
    }

    DIALOGS.regional = {
        windowId: 'cplRegionalOptions',
        title: 'Regional and Language Options',
        icon: itemIcon('regional-and-language-options'),
        tabs: { formats: 'intl:101', location: 'intl:600', keyboards: 'intl:102', administrative: 'intl:104' },
        pages: [{ key: 'intl:101', overrides: { 1037: { hidden: true } } }, { key: 'intl:600' }, { key: 'intl:102', overrides: { 1150: { hidden: true }, 1179: { hidden: true }, 1173: { hidden: true }, 1151: { hidden: true }, 1174: { hidden: true }, 1175: { hidden: true }, 1152: { hidden: true }, 1176: { hidden: true } } }, { key: 'intl:104' }],
        fields: [
            { page: 'intl:101', id: 1021, key: KEY.intl, name: 'LocaleName', type: 'select', def: () => browserLocale(), options: () => LOCALES.map((l) => ({ value: l, text: localeName(l) })).sort((a, b) => a.text.localeCompare(b.text)) },
            { page: 'intl:600', id: 1023, key: KEY.geo, name: 'Nation', type: 'select', def: () => browserLocale().split('-').pop(), options: () => regionList() },
            { page: 'intl:102', id: 1178, key: KEY.intl, name: 'PreferredUILanguage', type: 'select', def: 'en-US', options: [{ value: 'en-US', text: 'English' }] }
        ],
        init(ctx) {
            const examples = () => {
                const loc = ctx.get(1021, 'intl:101') || 'en-US';
                const now = new Date();
                const nf = (o) => { try { return new Intl.NumberFormat(loc, o).format(123456789); } catch (_) { return ''; } };
                ctx.set(1032, nf({ minimumFractionDigits: 2 }), 'intl:101');
                let currency = 'USD';
                try { currency = { ja: 'JPY', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', nl: 'EUR', en: loc === 'en-GB' ? 'GBP' : 'USD', zh: 'CNY', ko: 'KRW', ru: 'RUB', pt: loc === 'pt-BR' ? 'BRL' : 'EUR' }[loc.split('-')[0]] || 'USD'; } catch (_) { /* USD */ }
                ctx.set(1033, nf({ style: 'currency', currency }), 'intl:101');
                const df = (o) => { try { return new Intl.DateTimeFormat(loc, o).format(now); } catch (_) { return ''; } };
                ctx.set(1034, df({ hour: 'numeric', minute: '2-digit', second: '2-digit' }), 'intl:101');
                ctx.set(1035, df({ year: 'numeric', month: 'numeric', day: 'numeric' }), 'intl:101');
                ctx.set(1036, df({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), 'intl:101');
            };
            ctx.on(1021, 'change', examples, 'intl:101');
            examples();
            ctx.text(2100, localeName(browserLocale()), 'intl:104');
            ctx.content.querySelectorAll('.vdt-link').forEach((a) => a.addEventListener('click', () => callGlobal('openHelpAndSupport', 'regional')));
        },
        async apply(ctx) {
            // the taskbar clock and the dates in the desktop follow the format (taskbarClock.js)
            if (root.taskbarClock && typeof root.taskbarClock.refresh === 'function') root.taskbarClock.refresh();
        }
    };

    // ---- Melaton Sidebar Properties ------------------------------------------------------------

    /* global vsb, vsbMutate */
    function sidebarState() {
        return typeof vsb !== 'undefined' && vsb && vsb.state ? vsb.state : null;
    }

    DIALOGS['sidebar-properties'] = {
        windowId: 'cplSidebarProperties',
        title: 'Melaton Sidebar Properties',
        icon: itemIcon('sidebar-properties'),
        pages: [{ key: 'sidebar:9000', overrides: { 9003: { cls: '' } } }],
        fields: [
            { page: 'sidebar:9000', id: 9002, key: KEY.sidebar, name: 'StartAtLogon', type: 'check', def: true }
        ],
        init(ctx) {
            const s = sidebarState() || { onTop: false, side: 'right' };
            ctx.set(9001, !!s.onTop, 'sidebar:9000');
            ctx.set(s.side === 'left' ? 9006 : 9007, true, 'sidebar:9000');
            ctx.options(9003, ['1'], '1', 'sidebar:9000');
            ctx.on(9008, 'click', () => openRunningGadgets(ctx), 'sidebar:9000');
            ctx.on(9012, 'click', () => callGlobal('openVistaGadgetGallery'), 'sidebar:9000');
            ctx.content.querySelectorAll('.vdt-link').forEach((a) => a.addEventListener('click', () => callGlobal('openHelpAndSupport', 'sidebar')));
        },
        apply(ctx) {
            const patch = { onTop: !!ctx.get(9001, 'sidebar:9000'), side: ctx.get(9006, 'sidebar:9000') ? 'left' : 'right' };
            // vistaSidebar.js keeps these per workspace on the server (sidebar_save)
            if (typeof vsbMutate === 'function' && sidebarState()) vsbMutate((state) => Object.assign(state, patch));
        }
    };

    function openRunningGadgets(owner) {
        const s = sidebarState();
        const names = s && Array.isArray(s.gadgets) ? s.gadgets.map((g) => g.type) : [];
        callGlobal('showConfirmationDialog', `<div>${names.length ? names.map((n) => esc(n)).join('<br>') : 'No gadgets are running.'}</div>`, [{ text: 'Close', value: true, className: 'btn-standard primary' }], null, { title: 'View Gadgets', width: 320 });
        void owner;
    }

    // ---- Game Controllers ----------------------------------------------------------------------

    DIALOGS['game-controllers'] = {
        plain: true,
        open(tab, owner) {
            return V().openDialog({
                id: 'cplGameControllers',
                key: 'joy:101',
                icon: itemIcon('game-controllers'),
                owner,
                init(ctx) {
                    const lv = ctx.holder(1020);
                    lv.classList.add('is-report');
                    lv.querySelector('.vdt-lv-header').innerHTML = '<span class="vdt-lv-col" style="width:250px">Controller</span><span class="vdt-lv-col">Status</span>';
                    const fill = () => {
                        const pads = (root.navigator && root.navigator.getGamepads ? Array.from(root.navigator.getGamepads()) : []).filter(Boolean);
                        lv.querySelector('.vdt-lv-body').innerHTML = pads.map((p, i) => `<div class="vdt-lv-row${i === 0 ? ' is-selected' : ''}" data-pad="${p.index}"><span style="width:250px"><img src="/static_images/vista-cpl/items/game-controllers-16.png" alt="">${esc(p.id.replace(/\s*\(.*\)$/, ''))}</span><span>${p.connected ? 'OK' : 'Not connected'}</span></div>`).join('');
                        ctx.enable(1002, pads.length > 0);
                    };
                    fill();
                    ctx.store.onPad = fill;
                    root.addEventListener('gamepadconnected', fill);
                    root.addEventListener('gamepaddisconnected', fill);
                    ctx.on(1002, 'click', () => openControllerTest(ctx));
                    ctx.on(1311, 'click', () => {});
                },
                ok(ctx) {
                    root.removeEventListener('gamepadconnected', ctx.store.onPad);
                    root.removeEventListener('gamepaddisconnected', ctx.store.onPad);
                },
                cancel(ctx) {
                    root.removeEventListener('gamepadconnected', ctx.store.onPad);
                    root.removeEventListener('gamepaddisconnected', ctx.store.onPad);
                }
            });
        }
    };

    /** A controller's Properties > Test: its axes and buttons, live. */
    function openControllerTest(owner) {
        const row = owner.content.querySelector('.vdt-lv-row.is-selected');
        if (!row) return;
        const index = Number(row.dataset.pad);
        const id = 'cplControllerTest';
        const tpl = { t: 'Game Controller Properties', w: 252, h: 218, f: ['MS Shell Dlg', 8], c: [[1, 'B', 195, 200, 50, 14, 0x50010001, 'OK', 0]] };
        V().openDialog({
            id,
            tpl,
            owner: owner.modal,
            init(ctx) {
                ctx.content.insertAdjacentHTML('beforeend', `
                    <div class="tbp-group" style="left:11px;top:11px;width:356px;height:150px;"><span class="tbp-group-label">Axes</span></div>
                    <div class="cpl-pad-axes" style="position:absolute;left:24px;top:32px;width:330px;"></div>
                    <div class="tbp-group" style="left:11px;top:170px;width:356px;height:140px;"><span class="tbp-group-label">Buttons</span></div>
                    <div class="cpl-pad-buttons" style="position:absolute;left:24px;top:192px;width:330px;"></div>`);
                const axes = ctx.content.querySelector('.cpl-pad-axes');
                const buttons = ctx.content.querySelector('.cpl-pad-buttons');
                const frame = () => {
                    const pad = root.navigator.getGamepads()[index];
                    if (pad) {
                        axes.innerHTML = pad.axes.map((a, i) => `<div class="cpl-pad-axis"><span>Axis ${i + 1}</span><div class="vdt-progress" role="progressbar"><div class="vdt-progress-fill" style="--vdt-progress:${Math.round((a + 1) * 50)}%"></div></div></div>`).join('');
                        buttons.innerHTML = pad.buttons.map((b, i) => `<span class="cpl-pad-button${b.pressed ? ' is-down' : ''}">${i + 1}</span>`).join('');
                    }
                    ctx.store.raf = root.requestAnimationFrame(frame);
                };
                frame();
            },
            ok(ctx) { root.cancelAnimationFrame(ctx.store.raf); },
            cancel(ctx) { root.cancelAnimationFrame(ctx.store.raf); }
        });
    }

    // ---- Speech Properties (Text to Speech, Speech Recognition) --------------------------------

    function voices() {
        try { return root.speechSynthesis ? root.speechSynthesis.getVoices() : []; } catch (_) { return []; }
    }

    DIALOGS['text-to-speech'] = {
        windowId: 'cplSpeechProperties',
        title: 'Speech Properties',
        icon: itemIcon('text-to-speech'),
        tabs: { tts: 'sapi:116', recognition: 'sapi:117' },
        pages: [
            { key: 'sapi:117', overrides: { 1077: { cls: '' } } },
            { key: 'sapi:116', overrides: { 1017: { html: '<input type="text" class="tbp-edit cpl-tts-text" spellcheck="false">' } } }
        ],
        fields: [
            { page: 'sapi:116', id: 1070, key: KEY.speech, name: 'DefaultTTSRate', type: 'range', min: -10, max: 10, def: 0, ticks: 20 },
            { page: 'sapi:117', id: 1162, key: KEY.speechRec, name: 'RunAtStartup', type: 'check', def: false },
            { page: 'sapi:117', id: 1164, key: KEY.speechRec, name: 'DocumentHarvesting', type: 'check', def: false },
            { page: 'sapi:117', id: 1163, key: KEY.speechRec, name: 'SpacesAfterPunctuation', type: 'select', def: '1', options: ['1', '2'] }
        ],
        init(ctx) {
            const fillVoices = () => {
                const list = voices().map((v) => ({ value: v.voiceURI, text: v.name }));
                ctx.options(1090, list.length ? list : [{ value: '', text: 'Microsoft Anna' }], reg(KEY.speech, 'DefaultTokenId', list[0] ? list[0].value : ''), 'sapi:116');
            };
            fillVoices();
            if (root.speechSynthesis) root.speechSynthesis.onvoiceschanged = fillVoices;
            const input = ctx.page('sapi:116').querySelector('.cpl-tts-text');
            const sel = () => voices().find((v) => v.voiceURI === ctx.get(1090, 'sapi:116'));
            const preview = () => { input.value = `You have selected ${(sel() || {}).name || 'this voice'} as the computer's default voice.`; };
            preview();
            ctx.on(1090, 'change', preview, 'sapi:116');
            ctx.on(1019, 'click', () => {
                const s = root.speechSynthesis;
                if (!s) return;
                if (s.speaking) { s.cancel(); return; }
                const u = new root.SpeechSynthesisUtterance(input.value);
                const v = sel();
                if (v) u.voice = v;
                u.rate = Math.pow(3, Number(ctx.get(1070, 'sapi:116')) / 10);
                s.speak(u);
            }, 'sapi:116');
            ctx.options(1140, ['Speech Recognizer 8.0 for Melaton (English - US)'], undefined, 'sapi:117');
            const lv = ctx.holder(1077, 'sapi:117');
            lv.querySelector('.vdt-lv-body').innerHTML = '<div class="vdt-lv-row is-selected"><span><input type="checkbox" checked disabled> Default Speech Profile</span></div>';
            // the microphone level meter: the browser's microphone, only after the person asks for it
            ctx.on(1165, 'click', () => startMicMeter(ctx), 'sapi:117');
        },
        async apply(ctx) {
            if (R()) await R().set(KEY.speech, { DefaultTokenId: ctx.get(1090, 'sapi:116') });
        },
        close(ctx) {
            if (root.speechSynthesis) { root.speechSynthesis.cancel(); root.speechSynthesis.onvoiceschanged = null; }
            if (ctx.store.mic) ctx.store.mic.getTracks().forEach((t) => t.stop());
            if (ctx.store.raf) root.cancelAnimationFrame(ctx.store.raf);
        }
    };

    async function startMicMeter(ctx) {
        if (ctx.store.mic || !root.navigator.mediaDevices) return;
        try {
            const stream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
            ctx.store.mic = stream;
            const ac = new (root.AudioContext || root.webkitAudioContext)();
            const an = ac.createAnalyser();
            ac.createMediaStreamSource(stream).connect(an);
            const buf = new Uint8Array(an.fftSize);
            const fill = ctx.holder(1084, 'sapi:117').querySelector('.vdt-progress-fill');
            const frame = () => {
                an.getByteTimeDomainData(buf);
                let peak = 0;
                for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i] - 128));
                fill.style.setProperty('--vdt-progress', `${Math.min(100, Math.round((peak / 128) * 140))}%`);
                ctx.store.raf = root.requestAnimationFrame(frame);
            };
            frame();
        } catch (_) { /* no microphone, or the person said no */ }
    }

    // ---- the rest are registered by cplDialogs2.js ----------------------------------------------

    function open(id, tab, owner) {
        const def = DIALOGS[id];
        if (!def) {
            console.warn('cplDialogs: no dialog', id);
            return null;
        }
        if (!V() || !root.vistaDialogTemplates) return null;
        const existing = def.windowId && doc.getElementById(def.windowId);
        if (existing && !existing.classList.contains('hidden')) {
            callGlobal('bringModalToFront', existing);
            return null;
        }
        if (def.plain || typeof def.open === 'function') return def.open(tab, owner);
        return sheet(def, tab, owner);
    }

    root.cplDialogs = { open, DIALOGS, KEY, sheet, hardwareTab, itemIcon, reg, zones, currentZone, zoneLabel, wallClock, fmt, setHands, clockHtml, _test: { readField, applyFields, folderValues, nextDstChange } };
})(typeof window !== 'undefined' ? window : globalThis);
