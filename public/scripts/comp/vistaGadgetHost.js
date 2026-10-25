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
    // Dreamscape's own: a workspace picture for gadgets that show one (catalog "picture": Polaroid)
    Object.defineProperty(gadget, 'picture', { get: () => (ctx.picture && ctx.picture.url) || '' });
    Object.defineProperty(gadget, 'pictureCaption', { get: () => (ctx.picture && ctx.picture.caption) || '' });
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
            itemFromPath: (p) => vghItemFromPath(ctx, p),
            itemFromFileDrop: () => null,
            knownFolder: () => null,
            knownFolderPath: () => '',
            RecycleBin: { fileCount: 0, folderCount: 0, sizeUsed: 0, emptyAll: () => {}, showRecycleSettings: () => {} },
            drive: (letter) => vghDrive(ctx, letter),
            get Drive() { return { list: vghSysUse(ctx, ['disks']).disks.map((d) => d.letter.charAt(0)) }; }
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

// ---------------------------------------------------------------- the machine (server figures, WMI)

/**
 * Gadgets read "this computer": here that is Dreamscape's server, as the CPU Meter shows it.
 * The Sidebar's live feed (system topic of sidebar_live, modules/sidebarLiveFeed.js) feeds every
 * gadget that asked, once a second while the tab is visible, and stops when none is left. Reads are synchronous in
 * JScript, so they answer from the last sample.
 */
const VGH_SYS = { data: null, last: null, users: new Set(), release: null, acc: { disk: new Map(), proc: new Map(), idle: 0, at: 0 } };
const VGH_SYS_EMPTY = {
    cpu: { name: 'Processor', mhz: 0, cores: [0], total: 0 },
    memory: { totalBytes: 0, freeBytes: 0 },
    uptimeSec: 0, disks: [], network: [], processes: [], at: 0
};

/** Raw (cumulative) perf counters from the sampled rates: bytes and 100 ns busy ticks keep adding up. */
const vghSysAccumulate = function (data) {
    const acc = VGH_SYS.acc;
    const dt = acc.at ? Math.max(0, (data.at - acc.at) / 1000) : 0;
    acc.at = data.at;
    data.disks.forEach((d) => {
        const a = acc.disk.get(d.letter) || { rd: 0, wr: 0, busy: 0 };
        a.rd += d.readBps * dt;
        a.wr += d.writeBps * dt;
        a.busy += (d.busy / 100) * dt * 1e7;
        acc.disk.set(d.letter, a);
    });
    data.processes.forEach((p) => {
        const a = acc.proc.get(p.pid) || 0;
        acc.proc.set(p.pid, a + (p.cpu / 100) * dt * 1e7);
    });
    // the System Idle Process: every core's unused time
    if (data.cpu) acc.idle += ((100 - data.cpu.total) / 100) * data.cpu.cores.length * dt * 1e7;
    if (acc.proc.size > 500) acc.proc.clear();
};

/** WMI class -> the sample parts its rows read (vghWmiRows). */
const vghWmiParts = function (cls) {
    const c = String(cls || '').toLowerCase();
    if (/perfproc_process|^win32_process$/.test(c)) return ['processes', 'cpu', 'memory'];
    if (/operatingsystem/.test(c)) return ['memory', 'uptime', 'processes'];
    if (/perfos_system/.test(c)) return ['uptime', 'processes'];
    if (/memory/.test(c)) return ['memory'];
    if (/computersystem/.test(c)) return ['memory', 'cpu'];
    if (/processor/.test(c)) return ['cpu'];
    if (/disk/.test(c)) return ['disks'];
    if (/network|tcpip/.test(c)) return ['network'];
    return [];
};

const vghSysPartsKey = (ctx) => `vgh.sysParts.${ctx.entry && ctx.entry.id}`;

/** Parts the shown gadgets read; the live feed sends only these (Yozora #653). */
const vghSysShownParts = function () {
    const parts = new Set();
    VGH_SYS.users.forEach((ctx) => {
        if (ctx.inst && typeof vsbIsShown === 'function' && !vsbIsShown(ctx.inst)) return;
        (ctx.sysParts || []).forEach((part) => parts.add(part));
    });
    return [...parts];
};

const VGH_SYS_SPEC = { get system() { return vghSysShownParts(); } };

const vghSysOnData = function (data) {
    if (!data || data === VGH_SYS.last) return;
    VGH_SYS.last = data;
    // a push carries only the subscribed parts; the rest keep their last value
    VGH_SYS.data = { ...VGH_SYS_EMPTY, ...(VGH_SYS.data || {}), ...data };
    // counters only add what this push measured, never a held-over part
    vghSysAccumulate({ at: data.at, disks: data.disks || [], processes: data.processes || [], cpu: data.cpu || null });
};

/**
 * The latest sample for the parts this gadget reads (cpu, memory, uptime, disks, network,
 * processes). The first user follows the Sidebar's live feed (vistaSidebar.js vsbLiveUse, one
 * sidebar_live push per second for the tab) and vghDestroy lets go after the last. A part read for
 * the first time is remembered per gadget, so the next start subscribes it up front.
 */
const vghSysUse = function (ctx, parts) {
    if (!ctx.sysParts) {
        let saved = [];
        try { saved = JSON.parse(localStorage.getItem(vghSysPartsKey(ctx)) || '[]'); } catch (_) { saved = []; }
        ctx.sysParts = Array.isArray(saved) ? saved.filter((p) => typeof p === 'string') : [];
    }
    let added = false;
    (parts || []).forEach((part) => {
        if (!ctx.sysParts.includes(part)) { ctx.sysParts.push(part); added = true; }
    });
    if (added) {
        try { localStorage.setItem(vghSysPartsKey(ctx), JSON.stringify(ctx.sysParts)); } catch (_) { /* private mode */ }
    }
    if (!VGH_SYS.users.has(ctx)) {
        VGH_SYS.users.add(ctx);
        added = true;
    }
    if (!VGH_SYS.release && typeof window.vsbLiveUse === 'function') {
        VGH_SYS.release = window.vsbLiveUse('vgh-system', VGH_SYS_SPEC, vghSysOnData);
    } else if (added && typeof vsbLiveSync === 'function') {
        vsbLiveSync(false);
    }
    return VGH_SYS.data || VGH_SYS_EMPTY;
};

const vghSysRelease = function (ctx) {
    VGH_SYS.users.delete(ctx);
    if (!VGH_SYS.users.size && VGH_SYS.release) {
        VGH_SYS.release();
        VGH_SYS.release = null;
    } else if (typeof vsbLiveSync === 'function') {
        vsbLiveSync(false);
    }
};

const vghMachine = function (ctx) {
    const sys = (part) => vghSysUse(ctx, [part]);
    return {
        get CPUs() {
            const cores = sys('cpu').cpu.cores;
            const list = cores.map((pct, i) => ({ usagePercentage: pct, name: `CPU ${i}` }));
            return { count: list.length, item: (i) => list[i] || list[0] };
        },
        // megabytes, as Vista gives them
        get totalMemory() { return Math.round(sys('memory').memory.totalBytes / 1048576); },
        get availableMemory() { return Math.round(sys('memory').memory.freeBytes / 1048576); },
        get processorArchitecture() { return 'x64'; },
        PowerStatus: { isBatteryPresent: false, isPowerLineConnected: true, isBatteryCharging: false, batteryPercentRemaining: 100, batteryCapacityRemaining: 0, batteryCapacityTotal: 0, timeRemaining: -1, powerLineStatusChanged: null },
        PowerStatusChanged: null
    };
};

/** System.Shell.drive("C"): the server's disks, lettered from C: (the root). */
const vghDrive = function (ctx, letter) {
    const id = String(letter || '').charAt(0).toUpperCase() + ':';
    const d = vghSysUse(ctx, ['disks']).disks.find((x) => x.letter === id);
    if (!d) return null;
    // freeSpace and totalSize in megabytes, as Vista's System.Shell.Drive gives them
    return { name: id, path: id + '\\', driveType: 3, isReady: true, volumeLabel: d.label, fileSystem: 'NTFS', freeSpace: Math.floor(d.freeBytes / 1048576), totalSize: Math.floor(d.totalBytes / 1048576) };
};

// ---------------------------------------------------------------- the gadget's own folders (System.Shell items)

/**
 * System.Shell.itemFromPath over the gadget's package (<id>/__install.json): its folders and
 * files as Shell items, so a gadget can list its own pictures (System Animator's animations).
 * Paths are System.Gadget.path + "\\images\\..." as the gadget builds them; looked up without case.
 */
const VGH_FS = new Map(); // entry.id -> Promise of { dirs: Map(rel -> { dirs: Set, files: Map(name -> size) }) }

const vghFsLoad = function (entry) {
    if (!VGH_FS.has(entry.id)) {
        VGH_FS.set(entry.id, fetch(`${entry.path}/__install.json`).then((r) => (r.ok ? r.json() : [])).then((list) => {
            const dirs = new Map([['', { dirs: new Set(), files: new Map() }]]);
            const dir = (rel) => {
                if (!dirs.has(rel)) {
                    dirs.set(rel, { dirs: new Set(), files: new Map() });
                    const up = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
                    dir(up).dirs.add(rel.slice(rel.lastIndexOf('/') + 1));
                }
                return dirs.get(rel);
            };
            const base = entry.path.toLowerCase() + '/';
            list.forEach(([url, size]) => {
                const rel = String(url).toLowerCase().startsWith(base) ? String(url).slice(base.length) : '';
                if (!rel) return;
                const cut = rel.lastIndexOf('/');
                dir(cut < 0 ? '' : rel.slice(0, cut)).files.set(rel.slice(cut + 1), Number(size) || 0);
            });
            return { dirs };
        }).catch(() => ({ dirs: new Map() })));
    }
    return VGH_FS.get(entry.id);
};

/** "/static_images/vista-gadgets/x\\images\\a" or "file:///..." -> "images/a" inside the gadget, or null. */
const vghFsRel = function (ctx, raw) {
    let p = String(raw == null ? '' : raw).replace(/\\/g, '/').replace(/^file:\/+/i, '/');
    try { p = decodeURIComponent(p); } catch (_e) { /* as given */ }
    p = p.toLowerCase().replace(/\/+$/, '');
    const root = ctx.entry.path.toLowerCase();
    if (p === root) return '';
    if (!p.startsWith(root + '/')) return null;
    return p.slice(root.length + 1).split('/').filter((x) => x && x !== '.').join('/');
};

const vghShellItem = function (ctx, rel, isFolder, size) {
    const name = rel ? rel.slice(rel.lastIndexOf('/') + 1) : ctx.entry.id;
    const path = ctx.entry.path + (rel ? '\\' + rel.replace(/\//g, '\\') : '');
    const ext = !isFolder && name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toUpperCase() : '';
    const item = {
        name, path, isFolder, isFileSystem: true, isLink: false, link: null,
        size: isFolder ? 0 : size, type: isFolder ? 'File Folder' : `${ext} File`, modifyDate: new Date(0),
        metadata: () => ''
    };
    if (isFolder) {
        Object.defineProperty(item, 'SHFolder', {
            get: () => {
                const d = ctx.fs && ctx.fs.dirs.get(rel);
                const list = d ? [...[...d.dirs].sort().map((n) => vghShellItem(ctx, rel ? `${rel}/${n}` : n, true, 0)),
                    ...[...d.files].sort((a, b) => a[0].localeCompare(b[0])).map(([n, sz]) => vghShellItem(ctx, rel ? `${rel}/${n}` : n, false, sz))] : [];
                return { Items: { count: list.length, item: (i) => list[i] || null }, Self: item, parse: () => item };
            }
        });
    }
    return item;
};

const vghItemFromPath = function (ctx, raw) {
    const rel = vghFsRel(ctx, raw);
    if (rel === null || !ctx.fs) return null;
    if (ctx.fs.dirs.has(rel)) return vghShellItem(ctx, rel, true, 0);
    const cut = rel.lastIndexOf('/');
    const d = ctx.fs.dirs.get(cut < 0 ? '' : rel.slice(0, cut));
    const name = rel.slice(cut + 1);
    return d && d.files.has(name) ? vghShellItem(ctx, rel, false, d.files.get(name)) : null;
};

const vghWmiDate = function (ms) {
    const d = new Date(ms);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const off = -d.getTimezoneOffset();
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.000000${off >= 0 ? '+' : '-'}${p(Math.abs(off), 3)}`;
};

// uint64 properties come to JScript as strings; everything else as numbers / strings / VBArrays
const vghU64 = (n) => String(Math.max(0, Math.round(Number(n) || 0)));

// one adapter name in every class; no parentheses, which perf counter instance names write as [ ]
const vghNicName = (i) => (i ? `Xyridian Gigabit Ethernet ${i + 1}` : 'Xyridian Gigabit Ethernet');

/** The WMI classes gadgets query, as rows from the latest sample. */
const vghWmiRows = function (cls, d) {
    const now = d.at || Date.now();
    const ts = vghU64(now * 1e4);
    const freq = '10000000';
    const vendor = /amd/i.test(d.cpu.name) ? 'AuthenticAMD' : (/intel/i.test(d.cpu.name) ? 'GenuineIntel' : '');
    const disks = d.disks;
    const nets = d.network;
    switch (cls) {
        case 'win32_processor':
            return [{
                Name: d.cpu.name, Caption: 'x64 Family Processor', Description: d.cpu.name, Manufacturer: vendor, DeviceID: 'CPU0',
                LoadPercentage: d.cpu.total, NumberOfCores: d.cpu.cores.length, NumberOfLogicalProcessors: d.cpu.cores.length,
                CurrentClockSpeed: d.cpu.mhz, MaxClockSpeed: d.cpu.mhz, ExtClock: 100, L2CacheSize: 0, L3CacheSize: 0,
                AddressWidth: 64, DataWidth: 64, Architecture: 9, ProcessorId: '', SocketDesignation: 'CPU 1', Status: 'OK'
            }];
        case 'win32_perfformatteddata_perfos_processor':
            return d.cpu.cores.map((pct, i) => ({ Name: String(i), PercentProcessorTime: vghU64(pct), PercentIdleTime: vghU64(100 - pct) }))
                .concat([{ Name: '_Total', PercentProcessorTime: vghU64(d.cpu.total), PercentIdleTime: vghU64(100 - d.cpu.total) }]);
        case 'win32_operatingsystem':
            return [{
                Caption: 'Melaton Desktop', Name: 'Melaton Desktop', Version: '6.0.6002', BuildNumber: '6002', CSDVersion: 'Service Pack 2',
                ServicePackMajorVersion: 2, OSArchitecture: '64-bit', Manufacturer: 'Xyridian Corporation', CSName: 'MELATON',
                LastBootUpTime: vghWmiDate(now - d.uptimeSec * 1000), LocalDateTime: vghWmiDate(now), InstallDate: vghWmiDate(now - d.uptimeSec * 1000),
                TotalVisibleMemorySize: vghU64(d.memory.totalBytes / 1024), FreePhysicalMemory: vghU64(d.memory.freeBytes / 1024),
                TotalVirtualMemorySize: vghU64(d.memory.totalBytes / 512), FreeVirtualMemory: vghU64(d.memory.freeBytes / 512),
                NumberOfProcesses: d.processes.length
            }];
        case 'win32_perfformatteddata_perfos_system':
        case 'win32_perfrawdata_perfos_system':
            return [{ SystemUpTime: vghU64(d.uptimeSec), Processes: d.processes.length, Threads: 0, Timestamp_Object: ts, Frequency_Object: freq }];
        case 'win32_perfformatteddata_perfos_memory':
            return [{ AvailableBytes: vghU64(d.memory.freeBytes), AvailableMBytes: vghU64(d.memory.freeBytes / 1048576), CommittedBytes: vghU64(d.memory.totalBytes - d.memory.freeBytes), PercentCommittedBytesInUse: vghU64((1 - d.memory.freeBytes / (d.memory.totalBytes || 1)) * 100) }];
        case 'win32_computersystem':
            return [{ Name: 'MELATON', Caption: 'MELATON', Manufacturer: 'Xyridian Corporation', Model: 'Dreamscape', SystemType: 'x64-based PC', TotalPhysicalMemory: vghU64(d.memory.totalBytes), NumberOfProcessors: 1, NumberOfLogicalProcessors: d.cpu.cores.length, UserName: '', Domain: 'WORKGROUP' }];
        case 'win32_bios':
            return [{ Manufacturer: 'Phoenix Technologies LTD', Name: 'PhoenixBIOS 4.0 Release 6.0', Version: 'PTLTD - 6040000', SMBIOSBIOSVersion: '6.00', ReleaseDate: '20061102000000.000000+000', SerialNumber: '' }];
        case 'win32_baseboard':
            return [{ Manufacturer: 'Xyridian Corporation', Product: 'Dreamscape', Version: '1.0', SerialNumber: '' }];
        case 'win32_logicaldisk':
            return disks.map((x) => ({ DeviceID: x.letter, Name: x.letter, Caption: x.letter, VolumeName: x.label, Description: 'Local Fixed Disk', DriveType: 3, MediaType: 12, FileSystem: 'NTFS', Size: vghU64(x.totalBytes), FreeSpace: vghU64(x.freeBytes) }));
        case 'win32_diskdrive':
            return disks.slice(0, 1).map((x, i) => ({ Index: i, Model: 'Xyridian NVMe Disk', Caption: 'Xyridian NVMe Disk', InterfaceType: 'IDE', MediaType: 'Fixed hard disk media', Size: vghU64(x.totalBytes), Status: 'OK' }));
        case 'win32_perfformatteddata_perfdisk_logicaldisk':
            return disks.map((x) => ({
                Name: x.letter, DiskReadBytesPersec: vghU64(x.readBps), DiskWriteBytesPersec: vghU64(x.writeBps), DiskBytesPersec: vghU64(x.readBps + x.writeBps),
                PercentDiskTime: vghU64(x.busy), PercentIdleTime: vghU64(100 - x.busy), PercentFreeSpace: Math.round(x.freeBytes / (x.totalBytes || 1) * 100), FreeMegabytes: Math.round(x.freeBytes / 1048576)
            }));
        case 'win32_perfrawdata_perfdisk_logicaldisk':
            return disks.map((x) => {
                const a = VGH_SYS.acc.disk.get(x.letter) || { rd: 0, wr: 0, busy: 0 };
                return {
                    Name: x.letter, DiskReadBytesPersec: vghU64(a.rd), DiskWriteBytesPersec: vghU64(a.wr), DiskBytesPersec: vghU64(a.rd + a.wr),
                    PercentDiskTime: vghU64(a.busy), PercentFreeSpace: Math.round(x.freeBytes / (x.totalBytes || 1) * 100), FreeMegabytes: Math.round(x.freeBytes / 1048576),
                    Timestamp_Sys100NS: ts, Frequency_Sys100NS: freq, Timestamp_PerfTime: ts, Frequency_PerfTime: freq
                };
            });
        case 'win32_networkadapter':
            return nets.map((n, i) => ({ Index: i, DeviceID: String(i), Name: vghNicName(i), ProductName: 'Xyridian Gigabit Ethernet', NetConnectionID: i ? `Local Area Connection ${i + 1}` : 'Local Area Connection', AdapterType: 'Ethernet 802.3', MACAddress: n.mac.toUpperCase(), Speed: vghU64(n.speedBps), NetEnabled: true, NetConnectionStatus: 2, PhysicalAdapter: true }));
        case 'win32_networkadapterconfiguration':
            return nets.map((n, i) => ({ Index: i, Description: vghNicName(i), Caption: vghNicName(i), IPEnabled: true, DHCPEnabled: true, IPAddress: vghVBArray([n.ip]), IPSubnet: vghVBArray(['255.255.255.0']), DefaultIPGateway: vghVBArray([]), DNSServerSearchOrder: vghVBArray([]), MACAddress: n.mac.toUpperCase() }));
        case 'win32_perfformatteddata_tcpip_networkinterface':
            return nets.map((n, i) => ({ Name: vghNicName(i), BytesReceivedPersec: vghU64(n.rxBps), BytesSentPersec: vghU64(n.txBps), BytesTotalPersec: vghU64(n.rxBps + n.txBps), CurrentBandwidth: vghU64(n.speedBps) }));
        case 'win32_perfrawdata_tcpip_networkinterface':
            return nets.map((n, i) => ({ Name: vghNicName(i), BytesReceivedPersec: vghU64(n.rxBytes), BytesSentPersec: vghU64(n.txBytes), BytesTotalPersec: vghU64(n.rxBytes + n.txBytes), CurrentBandwidth: vghU64(n.speedBps), Timestamp_Sys100NS: ts, Frequency_Sys100NS: freq, Timestamp_PerfTime: ts, Frequency_PerfTime: freq }));
        case 'win32_process':
            return [{ Name: 'System Idle Process', Caption: 'System Idle Process', ProcessId: 0, Handle: '0', WorkingSetSize: '0', PageFileUsage: 0, KernelModeTime: vghU64(VGH_SYS.acc.idle), UserModeTime: '0', ExecutablePath: '', ThreadCount: d.cpu.cores.length }].concat(d.processes.map((p) => ({ Name: `${p.name}.exe`, Caption: `${p.name}.exe`, ProcessId: p.pid, Handle: String(p.pid), WorkingSetSize: vghU64(p.memBytes), PageFileUsage: Math.round(p.memBytes / 1024), KernelModeTime: vghU64(VGH_SYS.acc.proc.get(p.pid) || 0), UserModeTime: '0', ExecutablePath: '', ThreadCount: 1 })));
        case 'win32_perfformatteddata_perfproc_process':
            return [{ Name: '_Total', IDProcess: 0, PercentProcessorTime: vghU64(d.cpu.total * d.cpu.cores.length), WorkingSet: vghU64(d.memory.totalBytes - d.memory.freeBytes) },
                { Name: 'Idle', IDProcess: 0, PercentProcessorTime: vghU64((100 - d.cpu.total) * d.cpu.cores.length), WorkingSet: '0' }]
                .concat(d.processes.map((p) => ({ Name: p.name, IDProcess: p.pid, PercentProcessorTime: vghU64(p.cpu), WorkingSet: vghU64(p.memBytes), WorkingSetPrivate: vghU64(p.memBytes) })));
        case 'win32_perfrawdata_perfproc_process':
            return d.processes.map((p) => ({ Name: p.name, IDProcess: p.pid, PercentProcessorTime: vghU64(VGH_SYS.acc.proc.get(p.pid) || 0), WorkingSet: vghU64(p.memBytes), Timestamp_Sys100NS: ts, Frequency_Sys100NS: freq }));
        case 'win32_videocontroller':
            return [{ Name: 'Xyridian Display Adapter', Caption: 'Xyridian Display Adapter', AdapterRAM: 268435456, DriverVersion: '7.0.0.0', CurrentHorizontalResolution: screen.width, CurrentVerticalResolution: screen.height, Status: 'OK' }];
        default:
            return [];
    }
};

/** A VBScript SAFEARRAY as JScript sees it: new VBArray(x).toArray() */
const vghVBArray = function (list) {
    const a = list.slice();
    return { __vbarray: a, toArray: () => a.slice(), getItem: (i) => a[i], ubound: () => a.length - 1, lbound: () => 0, dimensions: () => 1 };
};

/** WMI properties are case-insensitive; JScript names them as it likes (objItem.loadPercentage). */
const vghWmiObject = function (row) {
    const keys = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
    return new Proxy(row, {
        get(target, prop) {
            if (typeof prop !== 'string') return target[prop];
            if (prop in target) return target[prop];
            const k = keys.get(prop.toLowerCase());
            return k ? target[k] : undefined;
        }
    });
};

/** WHERE with ANDed comparisons: Name = 'C:', Name <> '_Total', IPEnabled = True, Name LIKE '%eth%'. */
const vghWmiFilter = function (where) {
    if (!where) return () => true;
    const terms = where.split(/\s+AND\s+/i).map((t) => {
        const m = /^\s*\(?\s*([A-Za-z_][\w]*)\s*(=|<>|!=|>=|<=|>|<|LIKE)\s*(?:'([^']*)'|"([^"]*)"|(\S+?))\s*\)?\s*$/i.exec(t);
        if (!m) return () => true;
        const prop = m[1].toLowerCase();
        const op = m[2].toUpperCase();
        const raw = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]);
        const want = /^true$/i.test(raw) ? true : (/^false$/i.test(raw) ? false : raw);
        return (row) => {
            const k = Object.keys(row).find((x) => x.toLowerCase() === prop);
            const v = k ? row[k] : undefined;
            const a = typeof v === 'string' ? v.toLowerCase() : v;
            const b = typeof want === 'string' ? want.toLowerCase() : want;
            switch (op) {
                case '=': return typeof b === 'boolean' ? !!v === b : String(a) === String(b);
                case '<>': case '!=': return String(a) !== String(b);
                case '>': return Number(v) > Number(want);
                case '<': return Number(v) < Number(want);
                case '>=': return Number(v) >= Number(want);
                case '<=': return Number(v) <= Number(want);
                case 'LIKE': return new RegExp('^' + String(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i').test(String(v));
                default: return true;
            }
        };
    });
    return (row) => terms.every((t) => t(row));
};

/** SWbemObjectSet: an array the shim's Enumerator walks, with Count and ItemIndex. */
const vghWmiSet = function (rows) {
    const list = rows.map(vghWmiObject);
    list.Count = list.length;
    list.ItemIndex = (i) => list[i];
    return list;
};

/** Network Meter's NetLib (NICGadget.NetworkInformation, a .NET COM DLL) over the same sample. */
const vghNetLib = function (win) {
    let frame = null;
    try { frame = win.frameElement; } catch (_e) { return null; }
    const hit = frame && VGH_FRAMES.get(frame);
    if (!hit) return null;
    const nets = () => vghSysUse(hit.ctx, ['network']).network;
    return {
        // the last interface index: callers loop n = 0 .. Initialize()
        Initialize: () => nets().length - 1,
        Description: (n) => (nets()[n] ? vghNicName(n) : ''),
        BytesReceived: (n) => (nets()[n] ? nets()[n].rxBytes : 0),
        BytesSent: (n) => (nets()[n] ? nets()[n].txBytes : 0),
        Speed: (n) => (nets()[n] ? nets()[n].speedBps : 0)
    };
};

/** GetObject("winmgmts:...") / SWbemLocator.ConnectServer(): an SWbemServices over the server's figures. */
const vghWmi = function (win, moniker) {
    let frame = null;
    try { frame = win.frameElement; } catch (_e) { return null; }
    const hit = frame && VGH_FRAMES.get(frame);
    if (!hit) return null;
    const ctx = hit.ctx;
    const ns = /root\\?\\?(\w+)\s*$/i.exec(String(moniker || ''));
    const cimv2 = !ns || /cimv2/i.test(ns[1]);
    const query = (cls, where) => vghWmiSet(cimv2 ? vghWmiRows(String(cls).toLowerCase(), vghSysUse(ctx, vghWmiParts(cls))).filter(vghWmiFilter(where)) : []);
    return {
        ExecQuery(sql) {
            const m = /^\s*SELECT\s+[\s\S]+?\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+))?$/i.exec(String(sql || ''));
            return m ? query(m[1], m[2]) : vghWmiSet([]);
        },
        InstancesOf: (cls) => query(cls, ''),
        Get(path) {
            const m = /^(\w+)(?:\.(\w+)\s*=\s*["']?([^"']*)["']?)?$/.exec(String(path || ''));
            if (!m) return null;
            const rows = query(m[1], m[2] ? `${m[2]} = '${m[3]}'` : '');
            return rows[0] || null;
        },
        Security_: { ImpersonationLevel: 3 }
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
    // the Sidebar's window is the body's size and clips its background; a body with no size takes the background's
    if (w < 8 || h < 8) {
        const bgs = doc.getElementsByTagName('g:background');
        for (let i = 0; i < bgs.length; i++) {
            const r = bgs[i].getBoundingClientRect();
            w = Math.max(w, r.right);
            h = Math.max(h, r.bottom);
        }
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

/** A random picture of this workspace (sidebar_random_image, the Slide Show's), kept on the gadget. */
const vghPicture = function (ctx) {
    // vsbFetchImage / vsbWorkspaceImageUrl: public/scripts/comp/vistaSidebar.js
    return vsbFetchImage('images').then((data) => {
        const item = data && data.item;
        ctx.picture = item ? { url: vsbWorkspaceImageUrl(item), caption: '' } : null;
    }).catch(() => { ctx.picture = null; });
};

/** "New Picture" on a picture gadget's menu: another workspace picture, the page drawn again. */
const vghNewPicture = function (inst) {
    const ctx = vghCtx(inst);
    if (!ctx) return;
    vghPicture(ctx).then(() => {
        const store = vghStore(inst);
        store.Image = '';
        store.Caption = '';
        if (vsb.state && vsb.state.gadgets.includes(inst.g)) vsbQueueSave();
        try { ctx.frame.contentWindow.location.reload(); } catch (_e) { /* gone */ }
    });
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
    // a gadget that reads the machine or lists its folders starts with them in hand (those reads are synchronous)
    const needs = [];
    if (entry.fs) needs.push(vghFsLoad(entry).then((fs) => { ctx.fs = fs; }));
    if (entry.picture) needs.push(vghPicture(ctx));
    if (entry.group === 'system' && !VGH_SYS.data) {
        vghSysUse(ctx, []);
        if (!ctx.sysParts.length) vghSysUse(ctx, ['cpu', 'memory']);
        needs.push(new Promise((resolve) => {
            let tries = 0;
            const wait = () => {
                if (VGH_SYS.data || inst.destroyed || ++tries > 20) resolve();
                else ctx.timers.push(setTimeout(wait, 100));
            };
            wait();
        }));
    }
    Promise.all(needs).then(() => {
        if (!inst.destroyed) ctx.frame.src = entry.page;
    });
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
    vghSysRelease(ctx);
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

/**
 * FileSystemObject text files (Scribble's scribble.sav, meters' data files): kept per gadget
 * instance in this browser's localStorage, not in the Sidebar state (64 KB for every gadget).
 */
const VGH_FILE_MAX = 256 * 1024;
const vghFileStore = function (win) {
    let frame = null;
    try { frame = win.frameElement; } catch (_e) { return null; }
    const hit = frame && VGH_FRAMES.get(frame);
    if (!hit) return null;
    const prefix = `vgh.file.${hit.ctx.inst.g.id}.`;
    const key = (name) => prefix + String(name || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
    return {
        read(name) {
            try { return localStorage.getItem(key(name)); } catch (_e) { return null; }
        },
        write(name, text) {
            try {
                localStorage.setItem(key(name), String(text).slice(0, VGH_FILE_MAX));
                return true;
            } catch (_e) {
                return false;
            }
        },
        remove(name) {
            try { localStorage.removeItem(key(name)); } catch (_e) { /* storage off */ }
        }
    };
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

window.vistaGadgetHost = { netlib: vghNetLib, newPicture: vghNewPicture, files: vghFileStore, wmi: vghWmi, install: vghInstall, attach: vghAttach, mount: vghMount, apply: vghApply, destroy: vghDestroy, form: vghForm, error: vghError, notice: vghNotice };
// gadgetShim.js reaches the host as parent.vsbGadgetHost
window.vsbGadgetHost = window.vistaGadgetHost;
