/**
 * Hosted Sidebar gadgets (Yozora #629): real Windows Sidebar gadgets, run from their own files.
 *
 * scripts/import-vista-gadget.js unpacks a .gadget into public/static_images/vista-gadgets/<id>/
 * (lowercase paths, served by modules/vistaGadgetStatic.js) and lists it in
 * public/static_images/vista-gadgets/catalog.json; vistaSidebar.js turns each entry into a VSB_GADGETS type whose
 * mount / apply / form / destroy land here (feature vista_gadget_host, loaded on first use).
 *
 * Each gadget page runs in an iframe of its own. Every page the importer touched starts with
 * scripts/comp/sidebar-gadgets/gadgetShim.js, which asks vistaGadgetHost.attach(window) for the
 * Sidebar's object model (System.Gadget, System.Sound, System.Time, System.Shell ...), and a CSP
 * that keeps the page on this origin. The sandbox drops popups and top navigation; web links,
 * window.open and form posts become Alchemy tabs (openWebUrl, featureLoader.js).
 *
 * Settings live in the gadget's settings.store (System.Gadget.Settings), saved with the Sidebar
 * (modules/sidebarGadgets.js sanitizeHostedSettings). The gadget's settings page opens in the
 * Options dialog; its flyout opens beside the gadget like the Slide Show's (vsb.flyout).
 */

// no allow-modals: a gadget's alert() is vghNotice, never a modal on the desktop's thread
const VGH_SANDBOX = 'allow-scripts allow-same-origin allow-forms';
const VGH_FRAMES = new WeakMap(); // iframe element -> { ctx, role: 'main' | 'settings' | 'flyout' }
const VGH_SETTINGS_PAD = 34; // the Options dialog's padding around the settings page

const vghCtx = (inst) => inst && inst.vgh;
const vghStore = function (inst) {
    const s = inst.g.settings;
    if (!s.store || typeof s.store !== 'object' || Array.isArray(s.store)) s.store = {};
    return s.store;
};

/** "images\clock.png", "url(images/bg.png)", or an absolute path, against the page that named it. */
const vghResolve = function (win, raw) {
    let value = String(raw == null ? '' : raw).trim();
    const m = /^url\(\s*(['"]?)(.*?)\1\s*\)$/i.exec(value);
    if (m) value = m[2];
    if (!value) return '';
    value = value.replace(/\\/g, '/');
    // a drive path (C:/Windows/Media/ding.wav): Vista's own sounds are served from /sounds/vista
    const drive = /^[a-z]:\//i.exec(value);
    if (drive) {
        const name = value.split('/').pop();
        return /\.wav$/i.test(name) ? '/sounds/vista/' + encodeURIComponent(name) : '';
    }
    try {
        return new URL(value, win.location.href).href;
    } catch (_e) {
        return '';
    }
};

const vghCall = function (fn, thisArg, ...args) {
    if (typeof fn !== 'function') return undefined;
    try {
        return fn.apply(thisArg, args);
    } catch (err) {
        console.warn('[gadget]', err);
        return undefined;
    }
};

// ---------------------------------------------------------------- System.* object model

const vghTimeZone = function (zone) {
    const name = zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const now = new Date();
    let bias = now.getTimezoneOffset();
    if (zone) {
        const local = new Date(now.toLocaleString('en-US', { timeZone: zone }));
        const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
        bias = Math.round((utc - local) / 60000);
    }
    return { name, displayName: name.replace(/_/g, ' '), standardDisplayName: name, daylightDisplayName: name, bias, standardBias: 0, daylightBias: 0 };
};

/** Vista's VT_DATE string for "now" in a zone; gadgets hand it to new Date(). */
const vghLocalTime = function (zone) {
    const tz = zone && (zone.name || zone);
    const d = new Date(tz ? new Date().toLocaleString('en-US', { timeZone: String(tz) }) : Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const vghPlay = function (win, file) {
    const url = vghResolve(win, file);
    if (!url) return;
    const audio = new Audio(url);
    audio.play().catch(() => {});
};

const vghSettings = function (ctx) {
    const inst = ctx.inst;
    const write = (key, value) => {
        const store = vghStore(inst);
        let v = value;
        if (v == null) v = '';
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') v = String(v);
        if (typeof v === 'number' && !Number.isFinite(v)) v = String(v);
        if (store[key] === v) return;
        store[key] = v;
        // only a gadget on the Sidebar saves (a gadget page shown outside it, e.g. a test mount, does not)
        if (vsb.state && vsb.state.gadgets.includes(inst.g)) vsbQueueSave();
    };
    return {
        read: (key) => {
            const v = vghStore(inst)[key];
            return v === undefined ? '' : v;
        },
        readString: (key) => {
            const v = vghStore(inst)[key];
            return v === undefined ? '' : String(v);
        },
        write,
        writeString: (key, value) => write(key, String(value == null ? '' : value))
    };
};

const vghFlyoutApi = function (ctx) {
    const api = { file: '', onShow: null, onHide: null };
    Object.defineProperty(api, 'show', {
        get: () => !!(vsb.flyout && vsb.flyout.vgh === ctx),
        set: (on) => {
            if (on) vghFlyoutOpen(ctx);
            else if (vsb.flyout && vsb.flyout.vgh === ctx) vsbCloseFlyout();
        }
    });
    Object.defineProperty(api, 'document', {
        get: () => (ctx.flyoutFrame && ctx.flyoutFrame.contentDocument) || null
    });
    return api;
};

/** System.Gadget and friends, one per gadget instance; settings and flyout pages share it. */
const vghSystem = function (ctx) {
    if (ctx.system) return ctx.system;
    const inst = ctx.inst;
    const entry = ctx.entry;
    const gadget = {
        name: entry.title,
        version: entry.version,
        path: entry.path,
        platformVersion: '1.0.0.0',
        settingsUI: '',
        background: '',
        opacity: 100,
        onDock: null,
        onUndock: null,
        onSettingsClosing: null,
        onSettingsClosed: null,
        onShowSettings: null,
        visibilityChanged: null,
        Settings: vghSettings(ctx),
        Flyout: vghFlyoutApi(ctx),
        TransitionType: { none: 0, morph: 1 },
        beginTransition: () => {},
        endTransition: () => {},
        close: () => vsbRemoveGadget(inst.g.id),
        Sidebar: { dockSide: 'Right', onDockSideChanged: null },
        SideShow: { enabled: false }
    };
    Object.defineProperty(gadget, 'docked', { get: () => !!inst.g.docked });
    Object.defineProperty(gadget, 'visible', { get: () => !inst.destroyed && vsbIsShown(inst) });
    Object.defineProperty(gadget, 'document', { get: () => (ctx.frame && ctx.frame.contentDocument) || null });
    Object.defineProperty(gadget.Sidebar, 'dockSide', { get: () => (vsb.state && vsb.state.side === 'left' ? 'Left' : 'Right') });
    let background = '';
    Object.defineProperty(gadget, 'background', {
        get: () => background,
        set: (value) => {
            background = String(value || '');
            vghPaintBackground(ctx, background);
        }
    });
    ctx.system = {
        Gadget: gadget,
        Sound: {
            playSound: (file) => vghPlay(ctx.frame.contentWindow || window, file),
            beep: () => vghPlay(window, 'C:/Windows/Media/Windows Ding.wav')
        },
        Time: {
            get currentTimeZone() { return vghTimeZone(''); },
            get timeZones() { return (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC']).map((z) => vghTimeZone(z)); },
            getLocalTime: (zone) => vghLocalTime(zone),
            getUTCTime: () => vghLocalTime('UTC')
        },
        Shell: {
            execute: (target) => vghOpenUrl(ctx.frame.contentWindow || window, target),
            chooseFile: () => null,
            chooseFolder: () => null,
            itemFromPath: () => null,
            itemFromFileDrop: () => null,
            knownFolder: () => null,
            knownFolderPath: () => '',
            RecycleBin: { fileCount: 0, folderCount: 0, sizeUsed: 0, emptyAll: () => {}, showRecycleSettings: () => {} },
            drive: () => null,
            Drive: { list: [] }
        },
        Machine: vghMachine(ctx),
        Network: { Wireless: { signalStrength: 0, ssid: '', connected: false } },
        Diagnostics: { EventLog: { writeEntry: () => {} } },
        Debug: { outputString: (s) => console.debug('[gadget]', entry.id, String(s)) },
        Environment: { getEnvironmentVariable: () => '', machineName: 'MELATON' },
        Contact: { getContactManager: () => null },
        MessageStore: { inbox: null }
    };
    return ctx.system;
};

/**
 * System.Machine from the server's figures (sidebar_host_metrics, the CPU Meter's source):
 * Dreamscape's machine is the server, so CPU and memory are the host's.
 */
const vghMachine = function (ctx) {
    const metrics = { cpu: 0, ram: 0 };
    const poll = () => {
        if (ctx.inst.destroyed) return;
        // sidebar_host_metrics: modules/ws/handlers/290-sidebarHandler.js
        wsClient.sendMessage('sidebar_host_metrics', {}, false).then((data) => {
            if (data) Object.assign(metrics, { cpu: Number(data.cpu) || 0, ram: Number(data.ram) || 0 });
        }).catch(() => {});
    };
    let polling = null;
    const live = () => {
        if (!polling) {
            poll();
            polling = setInterval(poll, 2000);
            ctx.timers.push(polling);
        }
    };
    const totalMemory = 16384;
    return {
        get CPUs() {
            live();
            const cpu = { usagePercentage: metrics.cpu, name: 'Server CPU' };
            return { count: 1, item: () => cpu };
        },
        get totalMemory() { return totalMemory; },
        get availableMemory() { live(); return Math.round(totalMemory * (100 - metrics.ram) / 100); },
        get processorArchitecture() { return 'x64'; },
        PowerStatus: { isBatteryPresent: false, isPowerLineConnected: true, isBatteryCharging: false, batteryPercentRemaining: 100, batteryCapacityRemaining: 0, batteryCapacityTotal: 0, timeRemaining: -1, powerLineStatusChanged: null },
        PowerStatusChanged: null
    };
};

const vghPaintBackground = function (ctx, value) {
    const win = ctx.frame && ctx.frame.contentWindow;
    const body = win && win.document.body;
    if (!body) return;
    const url = value ? vghResolve(win, value) : '';
    body.style.backgroundImage = url ? `url("${url}")` : '';
    body.style.backgroundRepeat = 'no-repeat';
};

/** System.Shell.execute and web links: http(s) opens in Alchemy, anything else is ignored. */
const vghOpenUrl = function (win, target) {
    let url;
    try {
        url = new URL(String(target || '').replace(/\\/g, '/'), win.location.href);
    } catch (_e) {
        return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin === location.origin) return;
    // openWebUrl: public/scripts/comp/featureLoader.js
    void openWebUrl(url.href);
};

// ---------------------------------------------------------------- frames

const vghFrame = function (ctx, role, parent) {
    const frame = vsbEl('iframe', 'vgh-frame', parent);
    frame.setAttribute('sandbox', VGH_SANDBOX);
    frame.setAttribute('allowtransparency', 'true');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('tabindex', '0');
    frame.title = ctx.entry.title;
    VGH_FRAMES.set(frame, { ctx, role });
    return frame;
};

/** Called by gadgetShim.js inside every gadget page, before the page's own scripts. */
const vghAttach = function (win) {
    let frame = null;
    try {
        frame = win.frameElement;
    } catch (_e) {
        return null;
    }
    const hit = frame && VGH_FRAMES.get(frame);
    if (!hit) return null;
    const { ctx } = hit;
    vghPatchWindow(ctx, win);
    return vghSystem(ctx);
};

/** Popups, links and form posts leave through Alchemy; alert() and friends keep the browser's. */
const vghPatchWindow = function (ctx, win) {
    win.open = (url) => {
        vghOpenUrl(win, url);
        return null;
    };
    const doc = win.document;
    doc.addEventListener('click', (e) => {
        const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!link || e.defaultPrevented) return;
        const href = link.getAttribute('href') || '';
        if (/^\s*javascript:/i.test(href) || href.charAt(0) === '#') return;
        let url;
        try { url = new URL(href, win.location.href); } catch (_e) { return; }
        if (url.origin === location.origin && !/^_blank$/i.test(link.target)) return;
        e.preventDefault();
        vghOpenUrl(win, url.href);
    });
    doc.addEventListener('submit', (e) => {
        const form = e.target;
        if (!form || e.defaultPrevented) return;
        e.preventDefault();
        if ((form.method || 'get').toLowerCase() !== 'get' || !form.action) return;
        const url = new URL(form.action, win.location.href);
        new FormData(form).forEach((value, key) => { if (typeof value === 'string') url.searchParams.append(key, value); });
        vghOpenUrl(win, url.href);
    });
};

/** The page's own size: Sidebar gadgets set their body's width and height. */
const vghMeasure = function (win) {
    const doc = win.document;
    const body = doc.body;
    if (!body) return null;
    const cs = win.getComputedStyle(body);
    const px = (v) => parseFloat(v) || 0;
    let w = body.offsetWidth + px(cs.marginLeft) + px(cs.marginRight);
    let h = body.offsetHeight + px(cs.marginTop) + px(cs.marginBottom);
    const bgs = doc.getElementsByTagName('g:background');
    for (let i = 0; i < bgs.length; i++) {
        const r = bgs[i].getBoundingClientRect();
        w = Math.max(w, r.right);
        h = Math.max(h, r.bottom);
    }
    return { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)) };
};

const vghFit = function (ctx) {
    const win = ctx.frame.contentWindow;
    if (!win || ctx.inst.destroyed) return;
    const size = vghMeasure(win);
    if (!size) return;
    const style = ctx.frame.style;
    if (style.width === size.w + 'px' && style.height === size.h + 'px') return;
    style.width = size.w + 'px';
    style.height = size.h + 'px';
    try {
        localStorage.setItem(vghSizeKey(ctx), `${size.w}x${size.h}`);
    } catch (_e) { /* storage off */ }
    clearTimeout(ctx.fitTimer);
    ctx.fitTimer = setTimeout(() => {
        vsbPaginate();
        vsbClampDesktopGadgets();
    }, 50);
};

/** Drag by the gadget's body, its right-click menu, and the click a drag ends with. */
const vghBindInput = function (ctx) {
    const inst = ctx.inst;
    const frame = ctx.frame;
    const doc = frame.contentDocument;
    const toParent = (e) => {
        const r = frame.getBoundingClientRect();
        return { x: e.clientX + r.left, y: e.clientY + r.top };
    };
    doc.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const p = toParent(e);
        vsbDragStart({ button: 0, target: e.target, clientX: p.x, clientY: p.y, pointerId: e.pointerId }, inst);
    });
    const forward = (type) => (e) => {
        const d = vsb.drag;
        if (!d || d.inst !== inst) return;
        const moving = d.moving;
        const p = toParent(e);
        document.dispatchEvent(new PointerEvent(type, {
            clientX: p.x, clientY: p.y, pointerId: e.pointerId, button: e.button, buttons: e.buttons, bubbles: true, cancelable: true
        }));
        if (type !== 'pointermove' && moving) {
            const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
            doc.addEventListener('click', swallow, true);
            setTimeout(() => doc.removeEventListener('click', swallow, true), 0);
        }
    };
    doc.addEventListener('pointermove', forward('pointermove'));
    doc.addEventListener('pointerup', forward('pointerup'));
    doc.addEventListener('pointercancel', forward('pointercancel'));
    doc.addEventListener('contextmenu', (e) => {
        if (e.defaultPrevented || (e.target.closest && e.target.closest('input, textarea'))) return;
        e.preventDefault();
        const p = toParent(e);
        inst.el.dispatchEvent(new MouseEvent('contextmenu', { clientX: p.x, clientY: p.y, button: 2, bubbles: true, cancelable: true }));
    });
};

const vghOnLoad = function (ctx) {
    const win = ctx.frame.contentWindow;
    if (!win || ctx.inst.destroyed) return;
    vghBindInput(ctx);
    if (ctx.resizeObserver) ctx.resizeObserver.disconnect();
    ctx.resizeObserver = new ResizeObserver(() => vghFit(ctx));
    if (win.document.body) ctx.resizeObserver.observe(win.document.body);
    ctx.resizeObserver.observe(win.document.documentElement);
    vghFit(ctx);
    // pages that size themselves in a timer after load
    [100, 400, 1200].forEach((ms) => ctx.timers.push(setTimeout(() => vghFit(ctx), ms)));
};

// ---------------------------------------------------------------- flyout

const vghFlyoutOpen = function (ctx) {
    const sys = vghSystem(ctx);
    const file = sys.Gadget.Flyout.file;
    const win = ctx.frame.contentWindow;
    if (!file || !win) return;
    if (vsb.flyout && vsb.flyout.vgh === ctx) return;
    vsbCloseFlyout();
    const fly = vsbEl('div', 'vsb-flyout vgh-flyout', vsb.root);
    const frame = vghFrame(ctx, 'flyout', fly);
    ctx.flyoutFrame = frame;
    const place = () => {
        const fw = frame.contentWindow;
        const size = fw && vghMeasure(fw);
        if (!size) return;
        frame.style.width = size.w + 'px';
        frame.style.height = size.h + 'px';
        const rect = ctx.inst.el.getBoundingClientRect();
        const toLeft = rect.left + rect.width / 2 > window.innerWidth / 2;
        const left = toLeft ? rect.left - size.w : rect.right;
        // public/scripts/comp/modalUtils.js
        const area = getModalWorkAreaBounds();
        const top = Math.min(Math.max(area.top, rect.top), area.bottom - size.h);
        fly.style.left = Math.max(0, left) + 'px';
        fly.style.top = Math.max(area.top, top) + 'px';
    };
    frame.addEventListener('load', () => {
        place();
        const fw = frame.contentWindow;
        if (fw && fw.document.body) {
            const ro = new ResizeObserver(place);
            ro.observe(fw.document.body);
        }
        vghCall(sys.Gadget.Flyout.onShow, sys.Gadget.Flyout);
    }, { once: true });
    frame.src = vghResolve(win, file);
    vsb.flyout = {
        el: fly,
        inst: ctx.inst,
        vgh: ctx,
        onClose: () => {
            ctx.flyoutFrame = null;
            vghCall(sys.Gadget.Flyout.onHide, sys.Gadget.Flyout);
        }
    };
};

// ---------------------------------------------------------------- VSB_GADGETS hooks

/** The size a gadget drew last time (per docked / undocked), so its loading frame matches it. */
const vghSizeKey = (ctx) => `vgh.size.${ctx.entry.id}.${ctx.inst.g.docked ? 1 : 0}`;
const vghLastSize = function (ctx) {
    try {
        const m = /^(\d+)x(\d+)$/.exec(localStorage.getItem(vghSizeKey(ctx)) || '');
        if (m) return { w: Number(m[1]), h: Number(m[2]) };
    } catch (_e) { /* storage off */ }
    return { w: 130, h: ctx.inst.g.docked ? 100 : 130 };
};

const vghMount = function (inst) {
    if (inst.destroyed || inst.vgh) return;
    const entry = inst.def.hosted;
    // a frame with Vista's busy ring holds the gadget's place until its page has drawn
    const box = vsbEl('div', 'vgh-box is-loading', inst.body);
    const loader = vsbEl('div', 'vgh-loading', box);
    vsbEl('span', 'vgh-loading-ring', loader);
    const ctx = { inst, entry, frame: null, system: null, timers: [], docked: !!inst.g.docked, flyoutFrame: null, settingsFrame: null };
    inst.vgh = ctx;
    ctx.frame = vghFrame(ctx, 'main', box);
    const last = vghLastSize(ctx);
    ctx.frame.style.width = last.w + 'px';
    ctx.frame.style.height = last.h + 'px';
    ctx.loaded = new Promise((resolve) => {
        ctx.frame.addEventListener('load', () => {
            vghOnLoad(ctx);
            if (loader.isConnected) {
                loader.remove();
                box.classList.remove('is-loading');
            }
            resolve();
        });
    });
    ctx.frame.src = entry.page;
    return ctx.loaded;
};

// ---------------------------------------------------------------- install (first add from the gallery)

const VGH_INSTALLED_KEY = 'vgh.installed';
const VGH_INSTALL_PARALLEL = 4;

const vghInstalledMap = function () {
    try {
        return JSON.parse(localStorage.getItem(VGH_INSTALLED_KEY) || '{}') || {};
    } catch (_e) {
        return {};
    }
};

/**
 * Adding a gadget for the first time downloads its package (<id>/__install.json lists the files)
 * into the service worker's cache under Vista's progress dialog, as if from the online gallery.
 * Resolves false when cancelled or failed; true at once when this version is already here.
 */
const vghInstall = async function (entry) {
    if (vghInstalledMap()[entry.id] === entry.version) return true;
    let list;
    try {
        const r = await fetch(`${entry.path}/__install.json`, { cache: 'no-cache' });
        list = r.ok ? await r.json() : null;
    } catch (_e) {
        list = null;
    }
    if (!Array.isArray(list) || !list.length) return true;
    const total = list.reduce((n, f) => n + (Number(f[1]) || 0), 0);
    const item = { name: `${entry.title}.gadget`, size: total };
    let cancelled = false;
    // fileOperationProgress: public/scripts/comp/fileOperationProgress.js
    const fop = window.fileOperationProgress;
    const op = fop && fop.available() ? fop.begin({
        op: 'copy',
        verb: 'Downloading',
        items: [item],
        from: { name: 'gallery.live.com', path: 'http://gallery.live.com/' },
        to: { name: 'Gadgets', path: 'Melaton Sidebar\\Gadgets' },
        onCancel: () => { cancelled = true; }
    }) : null;
    if (op) op.next();
    let done = 0;
    let failed = null;
    const queue = list.slice();
    const worker = async () => {
        while (queue.length && !cancelled && !failed) {
            const [url, size] = queue.shift();
            try {
                const r = await fetch(url);
                if (!r.ok) throw new Error(`${r.status} ${url}`);
                await r.arrayBuffer();
            } catch (err) {
                failed = err;
                return;
            }
            done += Number(size) || 0;
            if (op) op.progress(done, total);
        }
    };
    await Promise.all(Array.from({ length: VGH_INSTALL_PARALLEL }, worker));
    if (op) {
        if (!cancelled && !failed) op.done(item);
        op.finish();
    }
    if (cancelled) return false;
    if (failed) {
        console.warn('[gadget] install failed:', entry.id, failed);
        // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
        void showConfirmationDialog(`<form class="vgh-notice">${escapeHtml(entry.title)} could not be downloaded. Check the connection and try again.</form>`,
            [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Melaton Sidebar', icon: 'fas fa-circle-xmark', showCloseButton: false });
        return false;
    }
    try {
        const map = vghInstalledMap();
        map[entry.id] = entry.version;
        localStorage.setItem(VGH_INSTALLED_KEY, JSON.stringify(map));
    } catch (_e) { /* downloads again next time */ }
    return true;
};

const vghApply = function (inst) {
    const ctx = vghCtx(inst);
    if (!ctx) return;
    const sys = vghSystem(ctx);
    const win = ctx.frame.contentWindow;
    const docked = !!inst.g.docked;
    if (docked !== ctx.docked) {
        ctx.docked = docked;
        vghCall(docked ? sys.Gadget.onDock : sys.Gadget.onUndock, win);
        vghFit(ctx);
    }
    if (ctx.settingsClosed) {
        const action = ctx.settingsClosed;
        ctx.settingsClosed = null;
        vghCall(sys.Gadget.onSettingsClosed, win, vghSettingsEvent(action));
        vghFit(ctx);
    }
};

const vghDestroy = function (inst) {
    const ctx = vghCtx(inst);
    if (!ctx) return;
    ctx.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    clearTimeout(ctx.fitTimer);
    if (ctx.resizeObserver) ctx.resizeObserver.disconnect();
    if (vsb.flyout && vsb.flyout.vgh === ctx) vsbCloseFlyout();
    try {
        ctx.frame.src = 'about:blank';
    } catch (_e) { /* removed with the gadget */ }
};

// ---------------------------------------------------------------- Options (the gadget's settings page)

const vghSettingsEvent = function (action) {
    const Action = { commit: 1, cancel: 0 };
    return { closeAction: action === 'commit' ? 1 : 0, Action, cancel: false, cancellable: action === 'commit' };
};

const vghForm = {
    width() {
        return 320;
    },
    html(set, inst) {
        const ctx = vghCtx(inst);
        const sys = ctx && vghSystem(ctx);
        if (sys) vghCall(sys.Gadget.onShowSettings, ctx.frame.contentWindow);
        ctx.snapshot = JSON.stringify(vghStore(inst));
        // a <form> makes it a task dialog (vistaDialogs.js): no message-box icon, like Vista's settings window
        return '<form class="vgh-settings"></form>';
    },
    ready(dialog, set, inst) {
        const ctx = vghCtx(inst);
        const holder = dialog && dialog.querySelector('.vgh-settings');
        const win = ctx && ctx.frame.contentWindow;
        const file = ctx && vghSystem(ctx).Gadget.settingsUI;
        if (!holder || !win || !file) {
            if (holder) holder.textContent = 'This gadget has no options.';
            return;
        }
        const frame = vghFrame(ctx, 'settings', holder);
        ctx.settingsFrame = frame;
        frame.style.width = '280px';
        frame.style.height = '120px';
        const fit = () => {
            const fw = frame.contentWindow;
            const size = fw && vghMeasure(fw);
            if (!size) return;
            frame.style.width = size.w + 'px';
            frame.style.height = size.h + 'px';
            dialog.style.width = Math.max(260, size.w + VGH_SETTINGS_PAD) + 'px';
        };
        frame.addEventListener('load', () => {
            fit();
            const fw = frame.contentWindow;
            if (fw && fw.document.body) new ResizeObserver(fit).observe(fw.document.body);
            [100, 400].forEach((ms) => setTimeout(fit, ms));
        }, { once: true });
        frame.src = vghResolve(win, file);
    },
    read(dialog, set, inst) {
        const ctx = vghCtx(inst);
        const sw = ctx && ctx.settingsFrame && ctx.settingsFrame.contentWindow;
        const ev = vghSettingsEvent('commit');
        // the settings page writes its values here (System.Gadget.Settings, shared with the gadget)
        if (sw && sw.System) vghCall(sw.System.Gadget.onSettingsClosing, sw, ev);
        if (ev.cancel) {
            vghForm.cancel(dialog, set, inst);
            return null;
        }
        ctx.settingsFrame = null;
        ctx.settingsClosed = 'commit';
        return { store: { ...vghStore(inst) } };
    },
    cancel(dialog, set, inst) {
        const ctx = vghCtx(inst);
        if (!ctx) return;
        const sw = ctx.settingsFrame && ctx.settingsFrame.contentWindow;
        if (sw && sw.System) vghCall(sw.System.Gadget.onSettingsClosing, sw, vghSettingsEvent('cancel'));
        ctx.settingsFrame = null;
        if (ctx.snapshot) {
            inst.g.settings.store = JSON.parse(ctx.snapshot);
            if (vsb.state && vsb.state.gadgets.includes(inst.g)) vsbQueueSave();
        }
        const sys = vghSystem(ctx);
        vghCall(sys.Gadget.onSettingsClosed, ctx.frame.contentWindow, vghSettingsEvent('cancel'));
    }
};

/** alert() / confirm() from a gadget page: the Sidebar's message box, which the page does not wait for. */
const vghNotice = function (win, text) {
    let frame = null;
    try { frame = win.frameElement; } catch (_e) { return; }
    const hit = frame && VGH_FRAMES.get(frame);
    if (!hit || hit.ctx.inst.destroyed) return;
    const body = escapeHtml(String(text == null ? '' : text).slice(0, 500)).replace(/\n/g, '<br>');
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    vsbPlainDialog(true);
    showConfirmationDialog(`<form class="vgh-notice">${body}</form>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, {
        title: hit.ctx.entry.title,
        icon: 'vsb-no-icon',
        showCloseButton: false,
        onDialogReady: () => vsbPlainDialog(true)
    }).finally(() => vsbPlainDialog(false));
};

/** A gadget page's uncaught error: logged once per message, kept on the instance for testing. */
const vghError = function (win, message, file, line) {
    let frame = null;
    try { frame = win.frameElement; } catch (_e) { return; }
    const hit = frame && VGH_FRAMES.get(frame);
    if (!hit) return;
    const errors = hit.ctx.errors || (hit.ctx.errors = []);
    const text = `${hit.role} ${String(file || '').split('/').pop()}:${line || 0} ${message}`;
    if (errors.length < 20 && !errors.includes(text)) {
        errors.push(text);
        console.warn('[gadget]', hit.ctx.entry.id, text);
    }
};

window.vistaGadgetHost = { install: vghInstall, attach: vghAttach, mount: vghMount, apply: vghApply, destroy: vghDestroy, form: vghForm, error: vghError, notice: vghNotice };
// gadgetShim.js reaches the host as parent.vsbGadgetHost
window.vsbGadgetHost = window.vistaGadgetHost;
