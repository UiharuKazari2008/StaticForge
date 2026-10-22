/**
 * Melaton boot: the Windows loading on /launch for desktop starts (PWA and browser tabs).
 *
 *   bios     Phoenix BIOS POST first (phoenixBios.js, #611): the logo splash with the Starting
 *            bar for ~2 s, F2 = Setup Utility, ESC = Boot Menu, F12 = network boot, F8 held
 *            for the Boot Manager. Its boot order decides what starts: the Hard Drive is
 *            Melaton when it is installed (an install record, or a populated static cache);
 *            the CD-ROM Drive is the installation media. A device with nothing installed falls
 *            through to the media like a real PC with the DVD in the drive.
 *   loading  "MeletonFX is loading files..." (Vista's bootmgr bar from the DVD) while the
 *            installer's base assets land: the server answers, /sw.js registers, the manifest
 *            arrives and the Setup window's own files are fetched. Then black, then Setup.
 *   setup    Windows Setup in Vista Basic on the aurora, page by page as Vista's: language,
 *            Install now, "Which type of installation do you want?" (Upgrade: the manifest
 *            digest is forgotten, a full check, every differing file installed; Custom
 *            (advanced): "Where do you want to install MeletonFX?" with Drive options whose
 *            Format wipes this device), then after a format "Setup is restarting..." with a
 *            countdown and a reboot that comes straight back into the installer with the
 *            server's current installer files (localStorage melatonSetup.resume = install).
 *   boot     Vista boot screen (black, Enso, green marquee) while the checks run:
 *            offline → menu. /status: any JSON answer counts as connected, so a starting
 *            server keeps the marquee running until it says ready (no cap). A client-side
 *            timeout means alive but busy (menu after busyTimeoutMs without an answer).
 *            Network / proxy errors: menu after maxFailures in a row. Then the session
 *            (OPTIONS /app: 401/403 → login page, other errors → menu). F8 opens the menu.
 *   handoff  success: cut to black for modeSwitchMs (Windows switching graphics modes),
 *            then /app, which opens on teal; the logon dialog waits until tealHoldMs after
 *            that (app.html + websocket.js _deferPreStartupForTealHold)
 *   menu     failure: cut to black, Boot Manager text screen, countdownSec → retry.
 *            Melaton Recovery boots the installation media: loading → Setup.
 *   updates  after the session check, under the boot screen (updateEngine.js): the worker's
 *            cache diffed against the server manifest. Up to 20 files download silently behind
 *            the marquee, then the handoff. If that quiet download does not finish the cache,
 *            the worker is not controlling the page, or the set is larger (or an install a
 *            reload interrupted), cut to black and open the installer. A missed file list
 *            stays on the boot screen until it arrives. The installer writes the cache
 *            itself, so a missing controlling worker must not leave for /app.
 *   install  Windows Setup in Vista Basic on the aurora: "Install MeletonFX", Installing
 *            MeletonFX..., the automatic checklist (Copying files = one compressed pack from the
 *            server, Expanding files = manifest vs the service worker, store only mismatches,
 *            Installing features = the code group, post-write hash check, Installing updates =
 *            the other group, same check, Completing installation = install record + persistent
 *            storage), Vista's two-step strip. Failure: a Vista Basic message box, Retry / Cancel
 *            (→ boot menu). Done: the window closes, it lingers, cuts to black and reboots
 *            /launch, which then boots normally.
 *
 * Design mode (/launch?design=1) previews every screen: no checks, no wipe, no navigation.
 * Yozora #411 (plan), #416 (S2), #417 (S3), #419 (S4), #611 (BIOS, Setup pages). Test: scripts/test-melaton-boot.js.
 */
(function (root) {
    'use strict';

    const config = {
        minBootMs: 2500,        // the boot screen shows at least this long
        pollMs: 2000,
        probeTimeoutMs: 4000,
        sessionTimeoutMs: 8000,
        maxFailures: 6,         // network / proxy errors in a row (~12 s) before the menu
        busyTimeoutMs: 120000,  // client timeouts with no answer before the menu
        blackCutMs: 600,
        modeSwitchMs: 1500,     // black between the boot screen and /app (graphics mode switch)
        countdownSec: 10,
        tealHoldMs: 2000,
        recoverStepMs: 350,     // each recovery line stays at least this long
        installStepMs: 900,     // each installer checklist line stays at least this long
        installTolerance: 10,   // files still missing after Expanding that do not fail the install
        installArriveMs: 1000,  // aurora alone before the setup window opens
        installLingerMs: 2000,  // after the installer window closes: the aurora alone this long
        rebootBlackMs: 3000,    // then black this long before /launch (a real restart's dark seconds)
        loadingMinMs: 1500,     // "MeletonFX is loading files..." shows at least this long
        loadingStepMs: 120,     // each installer asset counts for at least this long on the bar
        keyCheckMs: 2000,       // the product key page with a configured key moves on after this
        restartSec: 10,         // "Setup is restarting..." countdown after a format
        osCacheRows: 50,        // a static cache with at least this many rows counts as installed
        loadingBarCells: 76,    // the loading bar is 76 character cells (912 px / 12 px Lucida Console)
        loadingBarCellPx: 12,
        biosProbeMs: 1500,      // the POST waits at most this long for the server's first answer
        biosBlackMs: 700        // black between the POST and whatever boots (the video mode switch)
    };
    const INSTALLED_KEY = 'melatonInstalled';   // set by the desktop's last boot step (desktopBoot.js finish)

    // Files the Setup window needs before it opens (fetched under the loading bar; the HTTP
    // cache and the worker keep them). Fonts and the aurora come first so nothing pops in.
    const INSTALLER_ASSETS = [
        '/css/launch-install.css',
        '/css/vista-fonts.css',
        '/dist/fonts/vista/segoeui.woff2',
        '/dist/fonts/vista/segoeuib.woff2',
        '/static_images/wallpapers/aurora-plain.webp',
        '/static_images/vista-logon/basic-close.png',
        '/static_images/logo_icon.png',
        '/static_images/vista-icons/msgbox-warning-32.png',
        '/static_images/vista-icons/msgbox-question-32.png',
        '/protected/fflate.js',
        '/launch-games.html'
    ];

    // Setup window pages, in the order Vista shows them (install = the checklist, restart = after a format)
    const SETUP_PAGES = ['language', 'start', 'key', 'license', 'type', 'where', 'restart', 'install'];

    // Progress shares of the loading bar
    const LOADING_STEPS = [
        { id: 'server', weight: 0.25 },
        { id: 'worker', weight: 0.25 },
        { id: 'manifest', weight: 0.2 },
        { id: 'assets', weight: 0.3 }
    ];
    const SETUP_RESUME_KEY = 'melatonSetup';

    // Vista "Installing Windows..." checklist; weight = share of the strip's second bar
    const INSTALL_STEPS = [
        { id: 'copy', label: 'Copying MeletonFX files', weight: 0.8 },
        { id: 'expand', label: 'Expanding MeletonFX files', weight: 0.08 },
        { id: 'features', label: 'Installing features', weight: 0.03 },
        { id: 'updates', label: 'Installing updates', weight: 0.06 },
        { id: 'complete', label: 'Completing installation', weight: 0.03 }
    ];

    const INSTALL_ERRORS = {
        download: 'MeletonFX could not copy the files it needs to install. The connection to the server was interrupted.',
        stalled: 'MeletonFX could not copy the files it needs to install. The server stopped sending files.',
        mismatch: 'MeletonFX could not copy the files it needs to install. The installation files changed on the server while they were being copied. Retry downloads the current files.',
        verify: 'MeletonFX could not expand the installation files. Some files did not arrive intact.',
        worker: 'MeletonFX could not start the offline service it installs into.'
    };

    const ENTRIES = [
        { id: 'melaton', label: 'Dreamscape Melaton' },
        { id: 'restore', label: 'Dreamscape Melaton (via System Restore)' },
        { id: 'safe', label: 'Dreamscape Melaton (Safe Mode with Networking)' },
        { id: 'recovery', label: 'Melaton Recovery' }
    ];

    const INFO = {
        offline: 'This device is not connected to a network.',
        unreachable: 'The server did not respond.',
        busy: 'The server stopped responding while it was starting.',
        session: 'The server could not confirm this session.',
        install: 'The installation of MeletonFX was cancelled.',
        cache: 'The offline cache is not a complete copy.',
        media: 'The installation media could not be read.'
    };

    // weight = share of the formatting progress bar
    const RECOVERY_STEPS = [
        { id: 'caches', label: 'Removing downloaded files', weight: 0.45 },
        { id: 'serviceWorker', label: 'Removing the offline service', weight: 0.1 },
        { id: 'storage', label: 'Clearing settings', weight: 0.1 },
        { id: 'indexedDb', label: 'Removing local databases', weight: 0.35 }
    ];

    function timeoutSignal(ms) {
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            return AbortSignal.timeout(ms);
        }
        if (typeof AbortController === 'undefined') return undefined;
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), ms);
        return ctrl.signal;
    }

    /** One /status probe → { kind: 'json' | 'http' | 'timeout' | 'network' | 'offline' } */
    /**
     * User Accounts "Use Vista Logon" (server-owned): /app picks Vista or Classic from this copy
     * of the last /status answer before its own /status lands (same key as websocket.js
     * VISTA_LOGON_STORAGE_KEY: the logon picture path while on, no key while off).
     */
    function rememberVistaLogon(env, data) {
        if (!env.localStorage || typeof data.useVistaLogon !== 'boolean') return;
        try {
            if (data.useVistaLogon && data.logonPicture) env.localStorage.setItem('dreamscapeUseVistaLogon', data.logonPicture);
            else env.localStorage.removeItem('dreamscapeUseVistaLogon');
        } catch (_) { /* /app keeps the previous copy until its own /status */ }
    }

    async function probeStatus(env) {
        if (env.navigator && env.navigator.onLine === false) return { kind: 'offline' };
        try {
            const res = await env.fetch('/status', {
                method: 'OPTIONS',
                cache: 'no-cache',
                signal: timeoutSignal(config.probeTimeoutMs)
            });
            if (!res.ok) return { kind: 'http', status: res.status };
            let data = null;
            try {
                data = await res.json();
            } catch (_) {
                return { kind: 'http', status: res.status };
            }
            if (!data || typeof data !== 'object' || typeof data.isReady !== 'boolean') {
                return { kind: 'http', status: res.status };
            }
            return { kind: 'json', data };
        } catch (err) {
            const name = err && err.name;
            if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout' };
            return { kind: 'network' };
        }
    }

    /** OPTIONS /app → 'ok' | 'login' | 'error' */
    async function checkSession(env) {
        try {
            const res = await env.fetch('/app', {
                method: 'OPTIONS',
                cache: 'no-cache',
                signal: timeoutSignal(config.sessionTimeoutMs)
            });
            if (res.ok) return 'ok';
            if (res.status === 401 || res.status === 403) return 'login';
            return 'error';
        } catch (_) {
            return 'error';
        }
    }

    function withTimeout(promise, ms) {
        return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))]);
    }

    /**
     * Clean install: everything this device holds for Dreamscape. onStep(id, state) reports
     * 'start' / 'done' / 'failed' per RECOVERY_STEPS entry; a failed step does not stop the rest.
     * onProgress(fraction 0..1) drives the formatting bar (step weights, per cache / database
     * inside the big steps).
     */
    async function cleanInstall(env, onStep, onProgress) {
        const w = env.window || {};
        let base = 0;
        let current = null;
        const report = (within) => {
            if (!onProgress || !current) return;
            onProgress(Math.min(1, base + current.weight * Math.max(0, Math.min(1, within))));
        };
        const eachWithProgress = async (items, fn) => {
            let done = 0;
            await Promise.all(items.map(async (item) => {
                await fn(item);
                done += 1;
                report(done / items.length);
            }));
        };
        const actions = {
            async caches() {
                if (!w.caches) return;
                const names = await w.caches.keys();
                await eachWithProgress(names, (name) => w.caches.delete(name));
            },
            async serviceWorker() {
                const sw = w.navigator && w.navigator.serviceWorker;
                if (!sw || typeof sw.getRegistrations !== 'function') return;
                const regs = await sw.getRegistrations();
                await Promise.all(regs.map((reg) => reg.unregister()));
            },
            async storage() {
                try { if (w.localStorage) w.localStorage.clear(); } catch (_) { /* blocked */ }
                try { if (w.sessionStorage) w.sessionStorage.clear(); } catch (_) { /* blocked */ }
            },
            async indexedDb() {
                const idb = w.indexedDB;
                if (!idb || typeof idb.databases !== 'function') return;
                const dbs = (await idb.databases()).filter((db) => db && db.name);
                await eachWithProgress(dbs, (db) => withTimeout(new Promise((resolve) => {
                    const req = idb.deleteDatabase(db.name);
                    req.onsuccess = req.onerror = req.onblocked = () => resolve();
                }), 2000));
            }
        };
        const results = {};
        for (const step of RECOVERY_STEPS) {
            current = step;
            if (onStep) onStep(step.id, 'start');
            report(0);
            const started = env.now();
            let ok = true;
            try {
                await actions[step.id]();
            } catch (err) {
                ok = false;
                if (typeof console !== 'undefined' && console.warn) console.warn(`Melaton Recovery: ${step.id} failed`, err);
            }
            const rest = config.recoverStepMs - (env.now() - started);
            if (rest > 0) await env.sleep(rest);
            results[step.id] = ok;
            report(1);
            base += step.weight;
            if (onStep) onStep(step.id, ok ? 'done' : 'failed');
        }
        if (onProgress) onProgress(1);
        return results;
    }

    function readSetupResume(env) {
        try {
            const raw = env.localStorage && env.localStorage.getItem(SETUP_RESUME_KEY);
            const data = raw ? JSON.parse(raw) : null;
            return data && data.resume ? data : null;
        } catch (_) {
            return null;
        }
    }

    function writeSetupResume(env, data) {
        try {
            if (!env.localStorage) return;
            if (data) env.localStorage.setItem(SETUP_RESUME_KEY, JSON.stringify(data));
            else env.localStorage.removeItem(SETUP_RESUME_KEY);
        } catch (_) { /* the next boot asks again */ }
    }

    /**
     * Is Melaton on the disk? An install record, or a static cache with enough rows that the
     * app would start from it. A device the installer never ran on still counts as installed
     * when its worker already filled the cache (it will not be sent through Setup for that).
     */
    async function hasOsOnDisk(env) {
        if (hasInstallRecord(env)) return true;
        try {
            if (!env.caches) return false;
            const name = (engine && engine.STATIC_CACHE) || 'static-cache-v1';
            if (!(await env.caches.has(name))) return false;
            const cache = await env.caches.open(name);
            const keys = await cache.keys();
            return keys.length >= config.osCacheRows;
        } catch (_) {
            return false;
        }
    }

    /** An existing installation: the installer's record, or the bit the desktop sets when it has fully booted. */
    function hasInstallRecord(env) {
        const engine = env.engine;
        if (engine && typeof engine.readRecord === 'function' && engine.readRecord(env)) return true;
        try {
            return !!(env.localStorage && env.localStorage.getItem(INSTALLED_KEY));
        } catch (_) {
            return false;
        }
    }

    /** Whole cells of the loading bar for a 0..1 progress: the bar never shows part of a character. */
    function loadingBarCells(progress) {
        return Math.floor(Math.max(0, Math.min(1, progress || 0)) * config.loadingBarCells);
    }

    /** Disk sizes for "Where do you want to install MeletonFX?" (navigator.storage.estimate). */
    async function diskFacts(env) {
        let quota = 0;
        let usage = 0;
        try {
            const storage = env.navigator && env.navigator.storage;
            if (storage && typeof storage.estimate === 'function') {
                const est = await storage.estimate();
                quota = Number(est.quota) || 0;
                usage = Number(est.usage) || 0;
            }
        } catch (_) { /* unknown sizes */ }
        return { quota, usage };
    }

    function createController(env, view) {
        const ctl = {
            screen: null,
            runId: 0,
            selected: 0,
            countdown: null,
            countdownTimer: null,
            info: null,
            lastProbe: null,
            serverStatus: null,
            install: null,
            setup: null,        // the Setup window outside the checklist (page, disk, msgbox, countdown)
            loading: null,      // { progress, label }
            bios: null,
            biosF8: false,      // F8 during the POST: the Boot Manager after it
            disk: { quota: 0, usage: 0 },
            bootMode: 'normal'
        };

        function show(screen, data) {
            ctl.screen = screen;
            view.render(screen, data || {});
        }

        function menuData() {
            return { entries: ENTRIES, selected: ctl.selected, countdown: ctl.countdown, info: ctl.info };
        }

        function stopCountdown() {
            if (ctl.countdownTimer) env.clearInterval(ctl.countdownTimer);
            ctl.countdownTimer = null;
            if (ctl.countdown != null) {
                ctl.countdown = null;
                if (ctl.screen === 'menu') show('menu', menuData());
            }
        }

        function startCountdown() {
            stopCountdown();
            ctl.countdown = config.countdownSec;
            ctl.countdownTimer = env.setInterval(() => {
                if (ctl.screen !== 'menu') return stopCountdown();
                ctl.countdown -= 1;
                if (ctl.countdown <= 0) {
                    const pick = ctl.selected;
                    stopCountdown();
                    choose(pick);
                    return;
                }
                show('menu', menuData());
            }, 1000);
        }

        async function cutToBlack() {
            show('black');
            await env.sleep(config.blackCutMs);
        }

        async function openMenu(reason, options = {}) {
            ctl.runId += 1; // cancels a running check loop
            ctl.info = reason && INFO[reason] ? INFO[reason] : null;
            ctl.selected = 0;
            if (options.cut !== false) await cutToBlack();
            show('menu', { entries: ENTRIES, selected: 0, countdown: config.countdownSec, info: ctl.info });
            if (options.countdown !== false) startCountdown();
            else show('menu', menuData());
        }

        /** Boot screen → black (the graphics mode switch) → /app, which opens on teal. */
        async function handOff() {
            show('black');
            if (env.designMode) return;
            await env.sleep(config.modeSwitchMs);
            try {
                env.sessionStorage.setItem('dreamscapeLaunchHandoff', 'teal');
                env.sessionStorage.setItem('dreamscapeBootTealHoldUntil', String(env.now() + config.tealHoldMs));
                if (ctl.bootMode === 'safe') env.sessionStorage.setItem('melatonSafeMode', '1');
                else env.sessionStorage.removeItem('melatonSafeMode');
            } catch (_) { /* the logon dialog just shows without the hold */ }
            env.location.replace('/app');
        }

        // ---------- the BIOS (phoenixBios.js, #611) ----------

        function ensureBios() {
            if (ctl.bios || !env.bios || typeof env.bios.createBios !== 'function') return ctl.bios;
            ctl.bios = env.bios.createBios(Object.assign({}, env, { get storageQuota() { return ctl.disk.quota; } }), env.paintBios || null);
            return ctl.bios;
        }

        /**
         * The POST, with the work a real one does under its bar (the disk probe, the cache scan
         * for an installation, the first word from the server), then the device its boot order
         * picks: 'hdd' (Melaton, the boot screen) or 'cdrom' (the installation media, the
         * loading bar and Setup). No BIOS module: the same work, no screen.
         */
        async function runBios(run) {
            ctl.biosF8 = false;
            show('bios');
            const tasks = [
                { id: 'disk', run: async () => { ctl.disk = await diskFacts(env); return ctl.disk; } },
                { id: 'os', run: () => hasOsOnDisk(env) },
                { id: 'resume', run: async () => readSetupResume(env) || (env.engine && env.engine.readState(env) ? { resume: 'install' } : null) },
                // the network card's init: the first word from the server, but a hung server does not hold the POST
                { id: 'server', run: () => Promise.race([
                    probeStatus(env).then((probe) => { ctl.lastProbe = probe; if (probe.kind === 'json') { ctl.serverStatus = probe.data; rememberVistaLogon(env, probe.data); } return probe; }),
                    env.sleep(config.biosProbeMs).then(() => null)
                ]) }
            ];
            const hasOsAfter = (results) => !!results.os && !results.resume;
            const bios = ensureBios();
            if (!bios) {
                const results = {};
                for (const task of tasks) results[task.id] = await task.run();
                if (run !== ctl.runId) return 'cancelled';
                ctl.biosWork = results;
                return { device: hasOsAfter(results) ? 'hdd' : 'cdrom', via: 'none' };
            }
            const outcome = await bios.post({ tasks, hasOsAfter, run: { cancelled: () => run !== ctl.runId } });
            if (outcome === 'cancelled' || run !== ctl.runId) return 'cancelled';
            ctl.biosWork = bios.work || {};
            return outcome;
        }

        async function runChecks() {
            const run = ++ctl.runId;
            if (!env.designMode && globalThis.melatonBootInterrupt) {
                globalThis.melatonBootInterrupt = false;
                await openMenu(null, { cut: false, countdown: false });
                return 'menu';
            }
            if (env.designMode) {
                show('bios');
                return 'design';
            }
            const device = await runBios(run);
            if (device === 'cancelled') return 'cancelled';
            const resume = (ctl.biosWork && ctl.biosWork.resume) || null;
            if (ctl.biosF8) {
                ctl.biosF8 = false;
                await openMenu(null, { cut: false, countdown: false });
                return 'menu';
            }
            // the BIOS hands over on a black screen, like the video mode switch on a real PC
            show('black');
            await env.sleep(config.biosBlackMs);
            if (run !== ctl.runId) return 'cancelled';
            if (device.device === 'cdrom') return bootMedia(run, { resume: resume ? resume.resume : null });
            return bootDisk(run);
        }

        /** The Hard Drive: Vista's boot screen while the server, the session and updates are checked. */
        async function bootDisk(run) {
            const startedAt = env.now();
            let failures = 0;
            let busySince = null;
            show('boot');
            for (;;) {
                const probe = await probeStatus(env);
                if (run !== ctl.runId) return 'cancelled';
                ctl.lastProbe = probe;
                if (probe.kind === 'offline') {
                    await openMenu('offline');
                    return 'menu';
                }
                if (probe.kind === 'json') {
                    failures = 0;
                    busySince = null;
                    ctl.serverStatus = probe.data;
                    rememberVistaLogon(env, probe.data);
                    if (probe.data.isReady) break;
                } else if (probe.kind === 'timeout') {
                    if (busySince == null) busySince = env.now();
                    if (env.now() - busySince >= config.busyTimeoutMs) {
                        await openMenu('busy');
                        return 'menu';
                    }
                } else {
                    failures += 1;
                    if (failures >= config.maxFailures) {
                        await openMenu('unreachable');
                        return 'menu';
                    }
                }
                await env.sleep(config.pollMs);
                if (run !== ctl.runId) return 'cancelled';
            }
            const session = await checkSession(env);
            if (run !== ctl.runId) return 'cancelled';
            if (session === 'error') {
                await openMenu('session');
                return 'menu';
            }
            const rest = startedAt + config.minBootMs - env.now();
            if (rest > 0) await env.sleep(rest);
            if (run !== ctl.runId) return 'cancelled';
            if (session === 'login') {
                env.location.replace('/');
                return 'login';
            }
            if (ctl.bootMode === 'restore') {
                if (env.engine && env.engine.writeState) env.engine.writeState(env, null);
                await handOff();
                return run === ctl.runId ? 'teal' : 'cancelled';
            }
            const updated = await runUpdates(run);
            if (updated !== 'handoff') return updated;
            await handOff();
            if (run !== ctl.runId) return 'cancelled';
            return 'teal';
        }

        // ---------- updates and the installer (updateEngine.js, #419) ----------

        /** 'handoff' (boot on), 'reboot' (installed), 'error' (message box up) or 'cancelled'. */
        async function runUpdates(run) {
            const engine = env.engine;
            if (!engine || env.designMode) return 'handoff';
            const resumed = engine.readState(env);
            const started = env.now();
            let found = null;
            let workerOk = false;
            while (run === ctl.runId) {
                workerOk = await engine.ensureWorker(env);
                if (run !== ctl.runId) return 'cancelled';
                found = await engine.check(env);
                if (run !== ctl.runId) return 'cancelled';
                // A timeout or a runtime compile has no list yet. Stay on this page.
                // Handing off to /app is what showed the retry dialog instead of Setup.
                const noList = !found || found.failed || (found.skipped && found.skipped !== 'no-cache-storage');
                if (!noList) break;
                if (env.now() - started >= config.busyTimeoutMs) {
                    await openMenu('cache');
                    return 'menu';
                }
                await env.sleep(config.pollMs);
            }
            if (run !== ctl.runId) return 'cancelled';
            if (!found || found.skipped === 'no-cache-storage') {
                if (resumed) engine.writeState(env, null);
                return 'handoff';
            }
            if (!found.files || !found.files.length) {
                if (resumed) engine.writeState(env, null);
                return 'handoff';
            }
            // The installer uses fetch and Cache Storage. It does not need a controlling
            // worker. The quiet path does, so a missing worker opens Setup instead.
            if (workerOk && !engine.needsInstaller(env, found.files)) {
                const downloaded = await engine.download(env, found.files, { silent: true });
                if (downloaded && downloaded.ok === false) {
                    return installFromDisk(found, run);
                }
                if (typeof engine.verify === 'function') {
                    const still = await engine.verify(env, found.files);
                    if (still && still.length) {
                        return installFromDisk({ ...found, files: still, bytes: 0 }, run);
                    }
                }
                return 'handoff';
            }
            return installFromDisk(found, run);
        }

        /** A large update found by the boot screen: the loading bar (the worker and Setup's files), then the checklist. */
        async function installFromDisk(found, run) {
            await cutToBlack();
            if (run !== ctl.runId) return 'cancelled';
            const loaded = await loadingScreen(run, { steps: ['worker', 'assets'], found });
            if (loaded !== 'ok') return loaded;
            return install(found, run);
        }

        // ---------- the installation media: loading bar and Setup (#611) ----------

        function showLoading(progress, label) {
            ctl.loading = { progress: Math.max(0, Math.min(1, progress)), label: label || 'MeletonFX is loading files...' };
            show('loading', ctl.loading);
        }

        /**
         * "MeletonFX is loading files...": the server answers, /sw.js registers, the manifest
         * arrives, Setup's own files are fetched. Returns 'ok' (ctl.setupFound holds the file
         * list), 'menu' (the media could not be read) or 'cancelled'.
         */
        async function loadingScreen(run, opts = {}) {
            const engine = env.engine;
            const steps = opts.steps || LOADING_STEPS.map((s) => s.id);
            const startedAt = env.now();
            let base = 0;
            const weightOf = (id) => (LOADING_STEPS.find((s) => s.id === id) || { weight: 0 }).weight;
            const total = steps.reduce((n, id) => n + weightOf(id), 0) || 1;
            const report = (id, within) => showLoading((base + weightOf(id) * Math.max(0, Math.min(1, within))) / total);
            showLoading(0);
            let found = opts.found || null;
            for (const id of steps) {
                report(id, 0);
                if (id === 'server') {
                    let failures = 0;
                    let busySince = null;
                    for (;;) {
                        const probe = await probeStatus(env);
                        if (run !== ctl.runId) return 'cancelled';
                        ctl.lastProbe = probe;
                        if (probe.kind === 'offline') {
                            await openMenu('offline');
                            return 'menu';
                        }
                        if (probe.kind === 'json') {
                            ctl.serverStatus = probe.data;
                            rememberVistaLogon(env, probe.data);
                            if (probe.data.isReady) break;
                            report(id, typeof probe.data.progressPercent === 'number' ? probe.data.progressPercent / 100 : 0.3);
                            failures = 0;
                            busySince = null;
                        } else if (probe.kind === 'timeout') {
                            if (busySince == null) busySince = env.now();
                            if (env.now() - busySince >= config.busyTimeoutMs) {
                                await openMenu('media');
                                return 'menu';
                            }
                        } else {
                            failures += 1;
                            if (failures >= config.maxFailures) {
                                await openMenu('media');
                                return 'menu';
                            }
                        }
                        await env.sleep(config.pollMs);
                        if (run !== ctl.runId) return 'cancelled';
                    }
                } else if (id === 'worker') {
                    if (engine) await engine.ensureWorker(env);
                    if (run !== ctl.runId) return 'cancelled';
                } else if (id === 'manifest') {
                    const started = env.now();
                    while (engine && run === ctl.runId) {
                        found = await engine.check(env);
                        if (run !== ctl.runId) return 'cancelled';
                        const noList = !found || found.failed || (found.skipped && found.skipped !== 'no-cache-storage');
                        if (!noList) break;
                        if (env.now() - started >= config.busyTimeoutMs) {
                            await openMenu('media');
                            return 'menu';
                        }
                        await env.sleep(config.pollMs);
                    }
                    if (run !== ctl.runId) return 'cancelled';
                } else if (id === 'assets') {
                    const list = env.installerAssets || INSTALLER_ASSETS;
                    for (let i = 0; i < list.length; i++) {
                        const t0 = env.now();
                        try {
                            await env.fetch(list[i], { cache: 'force-cache' });
                        } catch (_) { /* the page already has it, or Setup fetches it later */ }
                        if (run !== ctl.runId) return 'cancelled';
                        const rest = config.loadingStepMs - (env.now() - t0);
                        if (rest > 0) await env.sleep(rest);
                        report(id, (i + 1) / list.length);
                    }
                }
                report(id, 1);
                base += weightOf(id);
            }
            const rest = startedAt + config.loadingMinMs - env.now();
            if (rest > 0) await env.sleep(rest);
            if (run !== ctl.runId) return 'cancelled';
            showLoading(1);
            ctl.setupFound = found;
            return 'ok';
        }

        function setupData() {
            const s = ctl.setup || {};
            return {
                page: s.page || 'language',
                phase: 'setup',
                upgradeAllowed: !!s.upgradeAllowed,
                driveOptions: !!s.driveOptions,
                formatted: !!s.formatted,
                formatting: s.formatting || null,
                msgbox: s.msgbox || null,
                countdown: s.countdown,
                keyConfigured: s.keyConfigured !== false,
                keyError: s.keyError || null,
                keyBusy: !!s.keyBusy,
                license: s.license || null,
                licenseAccepted: !!s.licenseAccepted,
                disk: s.disk || diskRows(),
                diskSelected: s.diskSelected == null ? 0 : s.diskSelected,
                steps: [],
                overall: 0,
                error: null
            };
        }

        function mb(n) {
            return `${(n / 1048576).toFixed(1)} MB`;
        }

        /** The rows of "Where do you want to install MeletonFX?": one disk, one partition when something is on it. */
        function diskRows() {
            const quota = ctl.disk.quota || 0;
            const usage = ctl.disk.usage || 0;
            const installed = !!(ctl.setup && ctl.setup.hasOs) && !(ctl.setup && ctl.setup.formatted);
            if (installed) {
                return [{ name: 'Disk 0 Partition 1 (Melaton)', total: mb(quota), free: mb(Math.max(0, quota - usage)), type: 'System', selectable: true }];
            }
            return [{ name: 'Disk 0 Unallocated Space', total: mb(quota), free: mb(quota), type: '', selectable: true }];
        }

        function showSetup(page) {
            if (!ctl.setup) ctl.setup = { page: 'language', hasOs: false, upgradeAllowed: false, driveOptions: false, formatted: false, msgbox: null, countdown: null };
            if (page) ctl.setup.page = page;
            ctl.setup.disk = diskRows();
            show('install', setupData());
        }

        /**
         * The CD-ROM Drive: loading bar, then Setup. A resume (a format just happened, or an
         * install a reload interrupted) goes straight to the checklist with the current files.
         */
        async function bootMedia(run, opts = {}) {
            if (ctl.screen !== 'black') await cutToBlack();
            if (run !== ctl.runId) return 'cancelled';
            const loaded = await loadingScreen(run);
            if (loaded !== 'ok') return loaded;
            await cutToBlack();
            if (run !== ctl.runId) return 'cancelled';
            const found = ctl.setupFound || { files: [], bytes: 0 };
            if (opts.resume === 'install') {
                writeSetupResume(env, null);
                return install(found, run);
            }
            const hasOs = await hasOsOnDisk(env);
            if (run !== ctl.runId) return 'cancelled';
            const status = ctl.serverStatus || {};
            // Upgrade only over an existing installation (the record, the desktop's installed bit,
            // or a static cache the app already runs from)
            const upgradeAllowed = hasOs;
            ctl.setup = { page: 'language', hasOs, upgradeAllowed, driveOptions: false, formatted: false, msgbox: null, countdown: null, found, keyConfigured: status.novelaiKeyConfigured !== false, license: null, licenseAccepted: false };
            show('install', { ...setupData(), phase: 'arrive' });
            await env.sleep(config.installArriveMs);
            if (run !== ctl.runId) return 'cancelled';
            showSetup('language');
            return 'setup';
        }

        /** Upgrade: forget the synced digest, a full check, then the checklist with everything that differs. */
        async function upgrade() {
            const run = ++ctl.runId;
            const engine = env.engine;
            if (engine && typeof engine.forgetManifest === 'function') engine.forgetManifest(env);
            let found = null;
            if (engine) {
                const started = env.now();
                for (;;) {
                    found = await engine.check(env);
                    if (run !== ctl.runId) return 'cancelled';
                    const noList = !found || found.failed || (found.skipped && found.skipped !== 'no-cache-storage');
                    if (!noList) break;
                    if (env.now() - started >= config.busyTimeoutMs) {
                        await openMenu('media');
                        return 'menu';
                    }
                    await env.sleep(config.pollMs);
                }
            }
            return install(found || { files: [], bytes: 0 }, run, { keepWindow: true });
        }

        /**
         * Format: the clean install (Cache Storage, the worker, storage, databases) under a
         * progress dialog. The BIOS settings and the resume flag survive it; the next boot has no
         * OS on the disk, boots the media and goes straight to the checklist.
         */
        async function formatDisk() {
            const run = ++ctl.runId;
            const s = ctl.setup;
            s.msgbox = null;
            s.formatting = { progress: 0 };
            showSetup();
            let cmos = null;
            try { cmos = env.localStorage ? env.localStorage.getItem('melatonCmos') : null; } catch (_) { /* no CMOS */ }
            const onProgress = (fraction) => {
                if (run !== ctl.runId) return;
                s.formatting = { progress: fraction };
                showSetup();
            };
            if (env.designMode) {
                let base = 0;
                for (const step of RECOVERY_STEPS) {
                    await env.sleep(config.recoverStepMs);
                    base += step.weight;
                    onProgress(base);
                }
            } else {
                await cleanInstall(env, null, onProgress);
            }
            if (run !== ctl.runId) return 'cancelled';
            try { if (cmos && env.localStorage) env.localStorage.setItem('melatonCmos', cmos); } catch (_) { /* defaults next boot */ }
            writeSetupResume(env, { resume: 'install', at: env.now() });
            s.formatting = null;
            s.formatted = true;
            s.hasOs = false;
            s.upgradeAllowed = false;
            s.driveOptions = false;
            return restartCountdown(run);
        }

        /** A restart: black for rebootBlackMs (the mode switch), then /launch, which POSTs again. */
        async function rebootCut() {
            show('black');
            await env.sleep(config.rebootBlackMs);
            if (!env.designMode) env.location.replace('/launch');
        }

        /** "Setup is restarting...": a countdown, Restart now, the window closes, the aurora alone, black, /launch. */
        function restartCountdown(run) {
            const s = ctl.setup;
            s.countdown = config.restartSec;
            showSetup('restart');
            return new Promise((resolve) => {
                const finish = async () => {
                    if (s.countdownTimer) env.clearInterval(s.countdownTimer);
                    s.countdownTimer = null;
                    s.restartNow = null;
                    show('install', { ...setupData(), phase: 'linger' });
                    await env.sleep(config.installLingerMs);
                    await rebootCut();
                    resolve('restart');
                };
                s.restartNow = finish;
                s.countdownTimer = env.setInterval(() => {
                    if (run !== ctl.runId || ctl.screen !== 'install') {
                        env.clearInterval(s.countdownTimer);
                        s.countdownTimer = null;
                        resolve('cancelled');
                        return;
                    }
                    s.countdown -= 1;
                    if (s.countdown <= 0) {
                        finish();
                        return;
                    }
                    showSetup();
                }, 1000);
            });
        }

        function setupMsgbox(kind) {
            const boxes = {
                cancel: { title: 'Install MeletonFX', icon: null, message: 'To install MeletonFX, you must run MeletonFX installation. If you cancel the installation, your computer might restart.', detail: 'Are you sure you want to cancel MeletonFX installation?', buttons: [['Yes', 'setup-cancel-yes'], ['No', 'setup-msgbox-close']] },
                format: { title: 'Install MeletonFX', icon: 'warning', message: 'If you format this partition, any data stored on it will be deleted. Downloaded files, the offline service, settings and local databases on this device are removed. Your images and data on the server are not affected.', detail: 'You might have to sign in again when MeletonFX starts.', buttons: [['OK', 'setup-format-ok'], ['Cancel', 'setup-msgbox-close']] },
                know: { title: 'Install MeletonFX', icon: 'info', message: 'Upgrade keeps everything on this device and installs the files on the server that differ from the ones here. Custom (advanced) lets you format this device first: every downloaded file, setting and local database is removed before MeletonFX is installed again.', detail: 'Your images and data stay on the server either way.', buttons: [['OK', 'setup-msgbox-close']] },
                driver: { title: 'Load Driver', icon: 'info', message: 'MeletonFX runs on the browser’s own storage drivers. No additional driver is needed to access this device.', detail: '', buttons: [['OK', 'setup-msgbox-close']] }
            };
            return boxes[kind] || null;
        }

        /** The Setup window's own buttons and links (page by page). Returns a promise for the flows that run. */
        function setupAction(action) {
            const s = ctl.setup;
            if (!s || ctl.screen !== 'install') return null;
            if (s.msgbox) {
                if (action === 'setup-msgbox-close') { s.msgbox = null; showSetup(); return null; }
                if (action === 'setup-cancel-yes') return setupCancel();
                if (action === 'setup-format-ok') return formatDisk();
                return null;
            }
            if (s.formatting) return null;
            switch (action) {
                case 'setup-close':
                    if (s.page === 'restart') return null;
                    s.msgbox = setupMsgbox('cancel');
                    showSetup();
                    return null;
                case 'setup-next':
                    if (s.page === 'language') showSetup('start');
                    else if (s.page === 'key') return keyNext();
                    else if (s.page === 'license') { if (s.licenseAccepted) showSetup('type'); }
                    else if (s.page === 'where') return installHere();
                    return null;
                case 'setup-back':
                    if (s.page === 'key') showSetup('start');
                    else if (s.page === 'license') showSetup('key');
                    else if (s.page === 'type') showSetup('license');
                    else if (s.page === 'where') showSetup('type');
                    return null;
                case 'setup-install':
                    return keyPage();
                case 'setup-license-accept':
                    s.licenseAccepted = !s.licenseAccepted;
                    showSetup();
                    return null;
                case 'setup-know':
                    s.msgbox = setupMsgbox('know');
                    showSetup();
                    return null;
                case 'setup-repair':
                    return openMenu(null, { countdown: false });
                case 'setup-upgrade':
                    if (!s.upgradeAllowed) return null;
                    return upgrade();
                case 'setup-custom':
                    showSetup('where');
                    return null;
                case 'setup-refresh':
                    showSetup();
                    return null;
                case 'setup-driver':
                    s.msgbox = setupMsgbox('driver');
                    showSetup();
                    return null;
                case 'setup-drive-options':
                    s.driveOptions = true;
                    showSetup();
                    return null;
                case 'setup-format':
                    if (!s.driveOptions || s.formatted) return null;
                    s.msgbox = setupMsgbox('format');
                    showSetup();
                    return null;
                case 'setup-restart-now':
                    if (typeof s.restartNow === 'function') s.restartNow();
                    return null;
                default:
                    return null;
            }
        }

        /**
         * "Type your product key": a configured NovelAI key shows starred out in a disabled field
         * and the page moves on by itself after keyCheckMs; none at all (initial server setup)
         * takes a key and stores it through POST /install/product-key.
         */
        async function keyPage() {
            const s = ctl.setup;
            showSetup('key');
            if (s.keyConfigured === false) return null;
            const run = ctl.runId;
            await env.sleep(config.keyCheckMs);
            if (run !== ctl.runId || ctl.setup !== s || s.page !== 'key') return null;
            return licensePage();
        }

        async function keyNext() {
            const s = ctl.setup;
            if (s.keyConfigured !== false) return licensePage();
            const value = typeof env.readProductKey === 'function' ? String(env.readProductKey() || '').trim() : '';
            if (!value) {
                s.keyError = 'Type the product key (the NovelAI API key) to continue.';
                showSetup();
                return null;
            }
            s.keyBusy = true;
            s.keyError = null;
            showSetup();
            let ok = false;
            let error = null;
            try {
                const res = await env.fetch('/install/product-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: value }) });
                ok = res.ok || res.status === 409;
                if (!ok) {
                    try { error = (await res.json()).error || null; } catch (_) { error = null; }
                }
            } catch (_) {
                ok = false;
            }
            if (ctl.setup !== s) return null;
            s.keyBusy = false;
            if (!ok) {
                s.keyError = error || 'The product key could not be stored. Check the connection to the server and try again.';
                showSetup();
                return null;
            }
            s.keyConfigured = true;
            return licensePage();
        }

        /** "Please read the license terms": the README, with the checkbox that unlocks Next. */
        async function licensePage() {
            const s = ctl.setup;
            if (s.license == null) {
                s.license = '';
                try {
                    const res = await env.fetch('/install/license.txt', { cache: 'no-cache' });
                    if (res.ok) s.license = await res.text();
                } catch (_) { /* the page shows without text */ }
                if (ctl.setup !== s) return null;
            }
            showSetup('license');
            return null;
        }

        /** Next on "Where do you want to install": into the partition as it is (an upgrade of what is there). */
        function installHere() {
            const s = ctl.setup;
            if (s.hasOs) return upgrade();
            const run = ++ctl.runId;
            return install(s.found || ctl.setupFound || { files: [], bytes: 0 }, run, { keepWindow: true });
        }

        /** The window's close box: back to the BIOS (a device with nothing installed boots the media again). */
        async function setupCancel() {
            ctl.runId += 1;
            if (ctl.setup && ctl.setup.countdownTimer) env.clearInterval(ctl.setup.countdownTimer);
            if (env.engine) env.engine.writeState(env, null);
            show('install', { ...setupData(), phase: 'linger' });
            ctl.setup = null;
            await env.sleep(config.installLingerMs);
            await rebootCut();
            return 'reboot';
        }

        // ---------- the checklist: Installing MeletonFX... ----------

        function installData() {
            const st = ctl.install;
            return {
                page: 'install',
                steps: st.steps.map((s) => ({ ...s })),
                overall: st.overall,
                phase: st.phase,
                error: st.error,
                resumed: !!st.resumed
            };
        }

        function setStep(id, state, fraction) {
            const st = ctl.install;
            let overall = 0;
            st.steps.forEach((step) => {
                if (step.id === id) {
                    step.state = state;
                    step.fraction = state === 'active' ? fraction : null;
                }
                const def = INSTALL_STEPS.find((d) => d.id === step.id);
                if (step.state === 'done') overall += def.weight;
                else if (step.state === 'active' && typeof step.fraction === 'number') overall += def.weight * step.fraction;
            });
            st.overall = Math.min(1, overall);
            show('install', installData());
        }

        // a game coming off the installation media (launchGames.js): Setup waits for it
        async function gamesGate() {
            if (env.games) await env.games.gate();
        }

        async function stepAtLeast(started) {
            const rest = config.installStepMs - (env.now() - started);
            if (rest > 0) await env.sleep(rest);
        }

        function installFailed(reason, detail) {
            const st = ctl.install;
            st.phase = 'error';
            st.error = { reason, message: INSTALL_ERRORS[reason] || INSTALL_ERRORS.download, detail: detail || null };
            show('install', installData());
            return 'error';
        }

        /** opts.keepWindow: Setup's window is already up (a wizard page), no arrive pause. An empty list still runs every line. */
        async function install(found, run, opts = {}) {
            const engine = env.engine;
            const resumed = !!engine.readState(env);
            const nothing = !found.files || !found.files.length;
            // a finished install before this one: this is an upgrade (the restart notice says so)
            const upgrade = !!(typeof engine.readRecord === 'function' && engine.readRecord(env));
            engine.writeState(env, { startedAt: env.now(), total: found.files.length, bytes: found.bytes });
            writeSetupResume(env, null);
            ctl.setup = null;
            if (ctl.screen !== 'install') await cutToBlack();
            ctl.install = {
                steps: INSTALL_STEPS.map((s) => ({ id: s.id, label: s.label, state: 'pending', fraction: null })),
                overall: 0,
                phase: opts.keepWindow ? 'installing' : 'arrive',
                error: null,
                resumed
            };
            show('install', installData());
            if (!opts.keepWindow) {
                await env.sleep(config.installArriveMs);
                if (run !== ctl.runId) return 'cancelled';
            }
            ctl.install.phase = 'installing';
            show('install', installData());
            // the Games toolbar (launchGames.js): something to play while the files land
            if (env.games) env.games.show();

            const manifest = found.manifest || found.files;

            // 1 Copying: one compressed pack, by bytes received. A short list is its own zip.
            let started = env.now();
            setStep('copy', 'active', 0);
            const copied = nothing ? { ok: true, absent: [] } : await engine.copyPack(env, manifest, {
                subset: found.files,
                onProgress: (p) => { if (run === ctl.runId) setStep('copy', 'active', p.fraction); }
            });
            if (run !== ctl.runId) return 'cancelled';
            if (!copied.ok) {
                const kind = copied.stalled ? 'stalled' : (copied.error === 'pack-hash' ? 'mismatch' : 'download');
                return installFailed(kind, copied.error || null);
            }
            await stepAtLeast(started);
            setStep('copy', 'done');

            // 2 Expanding: manifest vs the cache, store only the files that differ
            await gamesGate();
            if (run !== ctl.runId) return 'cancelled';
            started = env.now();
            setStep('expand', 'active', 0);
            const expanded = nothing ? { ok: true, missing: [] } : await engine.expandPack(env, manifest, {
                onProgress: (p) => { if (run === ctl.runId) setStep('expand', 'active', p.fraction); }
            });
            if (run !== ctl.runId) return 'cancelled';
            if (!expanded.ok) return installFailed(expanded.stalled ? 'stalled' : 'verify', expanded.error || null);
            const tolerance = Math.max(config.installTolerance, Math.ceil(found.files.length * 0.1));
            const tooMany = (urls) => urls.length > tolerance;
            const detailFor = (urls) => `${urls.length} file(s): ${urls.slice(0, 3).join(', ')}`;
            // A few files the cache will not keep do not stop the install; they are fetched at
            // runtime and remembered so later boots stay silent
            // Files the server answered 404 for (#507) are not counted as missing; they are
            // recorded as stragglers so later boots stay silent
            const absent = new Set(copied.absent || []);
            // Only this install's list counts. Expanding compares the whole manifest, so it
            // also finds the stragglers an earlier install recorded (requiredFiles left them
            // out of the list, and a subset pack never carries them): they stay stragglers
            // instead of failing every later upgrade
            const requested = new Set(found.files.map((file) => file.url));
            const prior = (expanded.missing || []).filter((url) => !requested.has(url) && !absent.has(url));
            let missing = (expanded.missing || []).filter((url) => requested.has(url) && !absent.has(url));
            if (tooMany(missing)) return installFailed('verify', detailFor(missing));
            await stepAtLeast(started);
            setStep('expand', 'done');

            // 3 Installing features: code and markup that were written, then a post-write hash check
            await gamesGate();
            if (run !== ctl.runId) return 'cancelled';
            started = env.now();
            setStep('features', 'active', 0);
            const features = await engine.installGroup(env, 'features', {
                onProgress: (p) => { if (run === ctl.runId) setStep('features', 'active', p.fraction); }
            });
            if (run !== ctl.runId) return 'cancelled';
            if (!features.ok) return installFailed('verify', features.error || null);
            missing = missing.concat(features.mismatched || []);
            if (tooMany(missing)) return installFailed('verify', detailFor(missing));
            await stepAtLeast(started);
            setStep('features', 'done');

            // 4 Installing updates: the other group, same post-write check
            await gamesGate();
            if (run !== ctl.runId) return 'cancelled';
            started = env.now();
            setStep('updates', 'active', 0);
            const updates = await engine.installGroup(env, 'updates', {
                onProgress: (p) => { if (run === ctl.runId) setStep('updates', 'active', p.fraction); }
            });
            if (run !== ctl.runId) return 'cancelled';
            if (!updates.ok) return installFailed('verify', updates.error || null);
            missing = missing.concat(updates.mismatched || []);
            if (tooMany(missing)) return installFailed('verify', detailFor(missing));
            await stepAtLeast(started);
            setStep('updates', 'done');
            ctl.install.stragglers = missing.concat(prior, Array.from(absent)).filter((url, i, all) => all.indexOf(url) === i);

            // 5 Completing installation: the install record, storage the browser keeps
            await gamesGate();
            if (run !== ctl.runId) return 'cancelled';
            started = env.now();
            setStep('complete', 'active');
            // the lighter copies the games came off the media with become the full files
            if (env.games && typeof env.games.upgradeLite === 'function') {
                await env.games.upgradeLite((f) => { if (run === ctl.runId) setStep('complete', 'active', f); }).catch(() => null);
                if (run !== ctl.runId) return 'cancelled';
            }
            engine.writeRecord(env, {
                completedAt: env.now(),
                files: found.files.length,
                bytes: found.bytes,
                stragglers: ctl.install.stragglers || []
            });
            try {
                const storage = env.navigator && env.navigator.storage;
                if (storage && typeof storage.persist === 'function') await storage.persist();
            } catch (_) { /* best effort */ }
            try {
                // The old /app install wizard's resume key and its reboot guard
                env.sessionStorage.removeItem('dreamscapeOsInstallWizard');
                env.sessionStorage.setItem('melatonInstallRebootAt', String(env.now()));
            } catch (_) { /* best effort */ }
            engine.writeState(env, null);
            await stepAtLeast(started);
            setStep('complete', 'done');

            // The window closes, a few seconds on the bare aurora, black, reboot. A game still
            // open holds the restart: a message box behind it offers Restart now instead.
            ctl.install.phase = 'linger';
            show('install', installData());
            if (env.games && env.games.busy()) {
                ctl.install.phase = 'held';
                await env.games.holdRestart({ upgrade });
                if (run !== ctl.runId) return 'cancelled';
            } else {
                await env.sleep(config.installLingerMs);
                if (run !== ctl.runId) return 'cancelled';
            }
            if (env.games) env.games.close();
            await rebootCut();
            return 'reboot';
        }

        /**
         * Message box on the installer: Retry stays in Setup and runs the update work again (the
         * files that already landed are skipped); nothing left to install → the normal handoff.
         */

        /**
         * Message box on the installer: Retry stays in Setup and runs the update work again (the
         * files that already landed are skipped); nothing left to install → the normal handoff.
         */
        async function installRetry() {
            if (!ctl.install || ctl.install.phase !== 'error') return null;
            const run = ++ctl.runId;
            ctl.install.error = null;
            ctl.install.phase = 'installing';
            show('install', installData());
            // Bypass the stored digest/list so Retry works from the server's current files.
            if (env.engine && typeof env.engine.forgetManifest === 'function') env.engine.forgetManifest(env);
            const outcome = await runUpdates(run);
            if (outcome !== 'handoff') return outcome;
            await handOff();
            return run === ctl.runId ? 'teal' : 'cancelled';
        }

        function installCancel() {
            if (!ctl.install || ctl.install.phase !== 'error') return null;
            if (env.games) env.games.hide();
            env.engine.writeState(env, null);
            ctl.install = null;
            return openMenu('install');
        }

        async function retry() {
            stopCountdown();
            await cutToBlack();
            return runChecks();
        }

        function choose(index) {
            const entry = ENTRIES[index];
            if (!entry || ctl.screen !== 'menu') return null;
            ctl.selected = index;
            stopCountdown();
            if (entry.id === 'melaton' || entry.id === 'restore' || entry.id === 'safe') {
                ctl.bootMode = entry.id === 'melaton' ? 'normal' : entry.id;
                return retry();
            }
            // Melaton Recovery: the installation media, Setup asks the rest
            const run = ++ctl.runId;
            return bootMedia(run);
        }

        /** Keyboard: returns true when the key was used. ch is the printable character, if any. */
        function handleKey(key, ch) {
            if (ctl.screen === 'bios') {
                if (key === 'F8') {
                    ctl.biosF8 = true;
                    return true;
                }
                return ctl.bios ? ctl.bios.handleKey(key, ch) : false;
            }
            if (ctl.screen === 'loading') return false;
            if (ctl.screen === 'install') {
                if (ctl.install && ctl.install.phase === 'error') {
                    if (key === 'Enter') { installRetry(); return true; }
                    if (key === 'Escape') { installCancel(); return true; }
                    return true;
                }
                if (ctl.setup && !ctl.install) {
                    const s = ctl.setup;
                    if (s.msgbox) {
                        if (key === 'Enter') setupAction(s.msgbox.buttons[0][1]);
                        else if (key === 'Escape') setupAction('setup-msgbox-close');
                        return true;
                    }
                    if (key === 'Escape') { setupAction('setup-close'); return true; }
                    if (key === 'Enter') {
                        const defaults = { language: 'setup-next', start: 'setup-install', key: 'setup-next', license: 'setup-next', type: s.upgradeAllowed ? 'setup-upgrade' : 'setup-custom', where: 'setup-next', restart: 'setup-restart-now' };
                        if (defaults[s.page]) setupAction(defaults[s.page]);
                        return true;
                    }
                }
                return true; // the installer runs by itself
            }
            if (ctl.screen === 'boot') {
                if (key === 'F8') {
                    // No countdown, and no black hold: the menu has to replace the boot screen now.
                    openMenu(null, { cut: false, countdown: false });
                    return true;
                }
                return false;
            }
            if (ctl.screen === 'menu') {
                stopCountdown(); // any key stops the countdown, like Windows
                if (key === 'ArrowUp') {
                    ctl.selected = Math.max(0, ctl.selected - 1);
                } else if (key === 'ArrowDown') {
                    ctl.selected = Math.min(ENTRIES.length - 1, ctl.selected + 1);
                } else if (key === 'Enter') {
                    choose(ctl.selected);
                    return true;
                }
                show('menu', menuData());
                return true;
            }
            return false;
        }

        /**
         * Touch / mouse: a tap on an entry chooses it; any press on the menu stops the countdown.
         * Setup's buttons and links come in as their data-action names.
         */
        function handlePointer(action, index, pointerType) {
            void pointerType;
            if (ctl.screen === 'install') {
                if (action === 'install-retry') return installRetry();
                if (action === 'install-cancel') return installCancel();
                if (typeof action === 'string' && action.indexOf('setup-') === 0) return setupAction(action);
                return null;
            }
            if (ctl.screen === 'menu') {
                stopCountdown();
                if (action === 'choose') return choose(typeof index === 'number' ? index : ctl.selected);
                return null;
            }
            return null;
        }

        /** Design mode: show one screen without running anything. */
        function preview(name) {
            ctl.runId += 1;
            stopCountdown();
            if (ctl.setup && ctl.setup.countdownTimer) env.clearInterval(ctl.setup.countdownTimer);
            ctl.setup = null;
            ctl.install = null;
            if (name === 'bios' || name === 'bios-setup' || name === 'bios-menu' || name === 'bios-diag') {
                show('bios');
                const bios = ensureBios();
                if (bios) bios.preview({ bios: 'splash', 'bios-setup': 'setup', 'bios-menu': 'bootmenu', 'bios-diag': 'diag' }[name]);
                return undefined;
            }
            if (name === 'loading') return showLoading(0.62);
            if (name === 'boot') return show('boot');
            if (name === 'black') return show('black');
            if (name === 'teal') return show('teal');
            if (name === 'menu' || name === 'menu-info') {
                ctl.info = name === 'menu-info' ? INFO.unreachable : null;
                ctl.selected = 0;
                ctl.countdown = config.countdownSec;
                return show('menu', menuData());
            }
            if (name.indexOf('setup') === 0) {
                const page = { setup: 'language', 'setup-start': 'start', 'setup-key': 'key', 'setup-key-entry': 'key', 'setup-license': 'license', 'setup-type': 'type', 'setup-type-fresh': 'type', 'setup-where': 'where', 'setup-where-options': 'where', 'setup-format': 'where', 'setup-formatting': 'where', 'setup-cancel': 'start', 'setup-restart': 'restart' }[name] || 'language';
                ctl.setup = { page, hasOs: name !== 'setup-type-fresh', upgradeAllowed: name !== 'setup-type-fresh', driveOptions: name === 'setup-where-options' || name === 'setup-format' || name === 'setup-formatting', formatted: false, msgbox: null, countdown: config.restartSec };
                if (name === 'setup-format') ctl.setup.msgbox = setupMsgbox('format');
                if (name === 'setup-cancel') ctl.setup.msgbox = setupMsgbox('cancel');
                if (name === 'setup-formatting') ctl.setup.formatting = { progress: 0.42 };
                ctl.setup.keyConfigured = name !== 'setup-key-entry';
                if (name === 'setup-license') ctl.setup.license = 'Dreamscape\n\nThe README is shown here on a live server (GET /install/license.txt).';
                return showSetup(page);
            }
            if (name.startsWith('install')) {
                const steps = INSTALL_STEPS.map((s) => ({ id: s.id, label: s.label, state: 'pending', fraction: null }));
                ctl.install = { steps, overall: 0, phase: 'installing', error: null };
                const at = { install: 'copy', 'install-expand': 'expand', 'install-updates': 'updates', 'install-error': 'copy', 'install-linger': null, 'install-games': 'updates', 'install-held': null }[name];
                const fraction = { copy: 0.42, expand: 0.6, updates: 0.3 };
                let reached = at == null;
                steps.forEach((step) => {
                    if (step.id === at) { reached = true; step.state = 'active'; step.fraction = fraction[at]; }
                    else if (!reached) step.state = 'done';
                });
                if (name === 'install-linger' || name === 'install-held') {
                    steps.forEach((step) => { step.state = 'done'; });
                    ctl.install.phase = 'linger';
                }
                // the Games toolbar; held: Setup finished under an open game (launchGames.js)
                if (env.games) {
                    if (name === 'install-games' || name === 'install-held') env.games.show();
                    else env.games.hide();
                    if (name === 'install-held') env.games.holdRestart({ upgrade: true });
                }
                if (name === 'install-error') {
                    ctl.install.phase = 'error';
                    ctl.install.error = { reason: 'stalled', message: INSTALL_ERRORS.stalled, detail: '/scripts/comp/modalUtils.js' };
                }
                let overall = 0;
                steps.forEach((step) => {
                    const def = INSTALL_STEPS.find((d) => d.id === step.id);
                    if (step.state === 'done') overall += def.weight;
                    else if (step.state === 'active') overall += def.weight * (step.fraction || 0);
                });
                ctl.install.overall = overall;
                return show('install', installData());
            }
            return null;
        }

        // (install, the function, is not put on ctl: ctl.install is the checklist's state)
        Object.assign(ctl, { runChecks, runBios, bootDisk, bootMedia, loadingScreen, runUpdates, installChecklist: install, installRetry, installCancel, upgrade, formatDisk, keyPage, keyNext, licensePage, setupAction, setupCancel, openMenu, retry, choose, handleKey, handlePointer, preview, stopCountdown, handOff, ensureBios });
        return ctl;
    }

    // ---------- DOM view ----------

    function el(doc, tag, cls, text) {
        const node = doc.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function textScreen(doc, title, bodyNodes, footerButtons) {
        const frag = doc.createDocumentFragment();
        frag.appendChild(el(doc, 'div', 'melaton-text-band', title));
        const body = el(doc, 'div', 'melaton-text-body');
        bodyNodes.forEach((n) => body.appendChild(n));
        frag.appendChild(body);
        const footer = el(doc, 'div', 'melaton-text-band melaton-text-footer');
        if (!footerButtons.length) footer.textContent = '\u00a0'; // the band keeps its line
        footerButtons.forEach(([label, action]) => {
            const btn = el(doc, 'button', 'melaton-text-key', label);
            btn.type = 'button';
            btn.dataset.action = action;
            footer.appendChild(btn);
        });
        frag.appendChild(footer);
        return frag;
    }

    function percentText(fraction) {
        return `${Math.max(0, Math.min(100, Math.floor((fraction || 0) * 100)))}%`;
    }

    /** Windows Setup in Vista Basic on the aurora (#melatonInstall in launch.html). */
    /** Vista Basic message box inside Setup (install errors and the wizard's questions). */
    function renderMsgbox(doc, box, data) {
        if (!box) return;
        const err = data.phase === 'error' ? data.error : null;
        const spec = err
            ? { title: 'Install MeletonFX', icon: 'error', message: err.message, detail: err.detail ? `Details: ${err.detail}` : '', buttons: [['Retry', 'install-retry'], ['Cancel', 'install-cancel']] }
            : data.msgbox;
        box.hidden = !spec;
        if (!spec) return;
        const title = box.querySelector('.mi-msgbox-title');
        if (title) title.textContent = spec.title || 'Install MeletonFX';
        const icon = box.querySelector('.mi-msgbox-icon');
        if (icon) {
            icon.hidden = !spec.icon;
            icon.dataset.icon = spec.icon || '';
        }
        const msg = box.querySelector('.mi-msgbox-message');
        const detail = box.querySelector('.mi-msgbox-detail');
        if (msg) msg.textContent = spec.message || '';
        if (detail) detail.textContent = spec.detail || '';
        const buttons = box.querySelector('.mi-msgbox-buttons');
        if (buttons) {
            buttons.replaceChildren(...spec.buttons.map(([label, action]) => {
                const btn = el(doc, 'button', null, label);
                btn.type = 'button';
                btn.dataset.action = action;
                return btn;
            }));
            const first = buttons.querySelector('button');
            // preventScroll: the VGA frame clips (overflow hidden) but still scrolls to a
            // focused control; a plain focus() shifted the whole frame sideways
            if (first && doc.activeElement !== first) setTimeout(() => first.focus({ preventScroll: true }), 0);
        }
    }

    /** Windows Setup on the aurora (#melatonInstall in launch.html): the page, the strip, the checklist, the message box. */
    function renderInstall(doc, data) {
        const host = doc.getElementById('melatonInstall');
        if (!host) return;
        const page = data.page || 'install';
        host.dataset.phase = data.phase;
        host.dataset.page = page;
        host.querySelectorAll('.mi-page').forEach((node) => {
            node.hidden = node.dataset.page !== page;
        });
        // Vista's strip (1 Collecting information / 2 Installing) appears from the third page on
        host.dataset.strip = page === 'language' || page === 'start' ? 'none' : (page === 'install' ? 'install' : 'collect');
        if (page === 'type') {
            // no existing installation: no Upgrade, and Custom (advanced) reads Install
            const up = host.querySelector('[data-action="setup-upgrade"]');
            if (up) up.hidden = !data.upgradeAllowed;
            const desc = host.querySelector('[data-action="setup-custom"] .mi-option-desc');
            if (desc) desc.textContent = data.upgradeAllowed
                ? 'Install a clean copy of MeletonFX, select where you want to install it, or make changes to disks and partitions. This option does not keep your downloaded files, settings, and local databases.'
                : 'Install MeletonFX on this device. Select where you want to install it, or make changes to disks and partitions first.';
        }
        if (page === 'where') {
            const rows = host.querySelector('.mi-disk-rows');
            if (rows) {
                rows.replaceChildren(...(data.disk || []).map((row, i) => {
                    const tr = el(doc, 'tr', i === data.diskSelected ? 'mi-disk-row mi-disk-row--selected' : 'mi-disk-row');
                    const name = el(doc, 'td', 'mi-disk-name');
                    name.appendChild(el(doc, 'span', 'mi-disk-icon'));
                    name.appendChild(el(doc, 'span', null, row.name));
                    tr.appendChild(name);
                    tr.appendChild(el(doc, 'td', 'mi-disk-size', row.total));
                    tr.appendChild(el(doc, 'td', 'mi-disk-size', row.free));
                    tr.appendChild(el(doc, 'td', 'mi-disk-type', row.type));
                    return tr;
                }));
            }
            const options = host.querySelector('.mi-drive-options');
            if (options) options.hidden = !data.driveOptions;
            const opener = host.querySelector('[data-action="setup-drive-options"]');
            if (opener) opener.hidden = !!data.driveOptions;
            const format = host.querySelector('[data-action="setup-format"]');
            if (format) format.disabled = !!data.formatted || !(data.disk || []).some((row) => row.type);
            const next = host.querySelector('.mi-page[data-page="where"] [data-action="setup-next"]');
            if (next) next.disabled = !!data.formatting;
            const dlg = host.querySelector('.mi-format-dialog');
            if (dlg) {
                dlg.hidden = !data.formatting;
                const bar = dlg.querySelector('[role="progressbar"] > div');
                if (bar && data.formatting) {
                    const pct = Math.round(Math.max(0, Math.min(1, data.formatting.progress || 0)) * 1000) / 10;
                    bar.style.width = pct + '%';
                    bar.parentNode.setAttribute('aria-valuenow', String(Math.round(pct)));
                }
            }
        }
        if (page === 'key') {
            const input = host.querySelector('.mi-key-input');
            if (input) {
                input.disabled = !!data.keyConfigured || !!data.keyBusy;
                if (data.keyConfigured) input.value = '*****-*****-*****-*****-*****';
                else if (input.value === '*****-*****-*****-*****-*****') input.value = '';
            }
            const err = host.querySelector('.mi-key-error');
            if (err) {
                err.hidden = !data.keyError;
                err.textContent = data.keyError || '';
            }
            const checking = host.querySelector('.mi-key-checking');
            if (checking) checking.hidden = !data.keyConfigured;
            // a configured key moves on by itself: Next is off and the window shows the wait cursor
            const next = host.querySelector('.mi-page[data-page="key"] [data-action="setup-next"]');
            if (next) next.disabled = !!data.keyBusy || !!data.keyConfigured;
        }
        host.dataset.busy = page === 'key' && (data.keyBusy || data.keyConfigured) ? '1' : '';
        const back = host.querySelector('.mi-title-back');
        if (back) back.disabled = !(page === 'key' || page === 'license' || page === 'type' || page === 'where');
        if (page === 'license') {
            const text = host.querySelector('.mi-license-text');
            if (text && text.dataset.shown !== String(data.license == null ? '' : data.license.length)) {
                text.textContent = data.license || '';
                text.dataset.shown = String(data.license == null ? '' : data.license.length);
                text.scrollTop = 0;
            }
            const box = host.querySelector('.mi-license-accept input');
            if (box) box.checked = !!data.licenseAccepted;
            const next = host.querySelector('.mi-page[data-page="license"] [data-action="setup-next"]');
            if (next) next.disabled = !data.licenseAccepted;
        }
        if (page === 'restart') {
            const count = host.querySelector('.mi-restart-count');
            if (count) count.textContent = data.countdown == null ? '' : `Restarting in ${data.countdown} second${data.countdown === 1 ? '' : 's'}...`;
        }
        const list = host.querySelector('.mi-steps');
        if (list && page === 'install') {
            list.replaceChildren(...data.steps.map((step) => {
                const li = el(doc, 'li', `mi-step mi-step--${step.state}`);
                const mark = el(doc, 'span', 'mi-step-mark');
                mark.setAttribute('aria-hidden', 'true');
                li.appendChild(mark);
                const label = step.state === 'active' && typeof step.fraction === 'number'
                    ? `${step.label} (${percentText(step.fraction)})`
                    : step.label;
                li.appendChild(el(doc, 'span', 'mi-step-label', label));
                return li;
            }));
        }
        const bar = host.querySelector('.mi-bar-install > div');
        if (bar) {
            const pct = page === 'install' ? Math.round((data.overall || 0) * 1000) / 10 : 0;
            bar.style.width = pct + '%';
            if (bar.parentNode) bar.parentNode.setAttribute('aria-valuenow', String(Math.round(pct)));
        }
        const collect = host.querySelector('.mi-bar-collect > div');
        if (collect) {
            const share = { key: 0.2, license: 0.35, type: 0.5, where: 0.7, restart: 1 }[page];
            collect.style.width = (page === 'install' ? 100 : Math.round((share || 0.2) * 100)) + '%';
        }
        renderMsgbox(doc, host.querySelector('.mi-msgbox'), data);
    }

    function createDomView(doc) {
        const rootEl = doc.getElementById('melatonBoot');
        const textEl = doc.getElementById('melatonBootText');
        const loadingEl = doc.getElementById('melatonLoading');
        return {
            render(screen, data) {
                if (!rootEl) return;
                rootEl.dataset.screen = screen;
                if (screen === 'install') {
                    renderInstall(doc, data);
                    if (textEl) textEl.replaceChildren();
                    return;
                }
                if (screen === 'loading') {
                    if (loadingEl) {
                        const fill = loadingEl.querySelector('.melaton-loading-bar > div');
                        const cells = loadingBarCells(data.progress);
                        if (fill) fill.style.width = (cells * config.loadingBarCellPx) + 'px';
                        const bar = loadingEl.querySelector('.melaton-loading-bar');
                        if (bar) bar.setAttribute('aria-valuenow', String(Math.round(cells / config.loadingBarCells * 100)));
                        const label = loadingEl.querySelector('.melaton-loading-label');
                        if (label && data.label) label.textContent = data.label;
                    }
                    if (textEl) textEl.replaceChildren();
                    return;
                }
                if (!textEl) return;
                if (screen === 'menu') {
                    const list = el(doc, 'ul', 'melaton-boot-entries');
                    data.entries.forEach((entry, i) => {
                        const li = el(doc, 'li', i === data.selected ? 'selected' : '', entry.label);
                        li.dataset.index = String(i);
                        li.setAttribute('role', 'option');
                        li.setAttribute('aria-selected', i === data.selected ? 'true' : 'false');
                        list.appendChild(li);
                    });
                    list.setAttribute('role', 'listbox');
                    const nodes = [
                        el(doc, 'p', 'melaton-text-tight', 'Choose an operating system to start:'),
                        el(doc, 'p', null, '(Use the arrow keys to highlight your choice, then press ENTER.)'),
                        list,
                        el(doc, 'p', 'melaton-boot-countdown', data.countdown != null
                            ? `Seconds until the highlighted choice will be started automatically: ${data.countdown}`
                            : ' ')
                    ];
                    if (data.info) nodes.push(el(doc, 'p', 'melaton-boot-info', `Info: ${data.info}`));
                    textEl.replaceChildren(textScreen(doc, 'Melaton Boot Manager', nodes, [['ENTER=Choose', 'choose']]));
                } else {
                    textEl.replaceChildren();
                }
            }
        };
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** Wire the controller to the page (launch.html). */
    function start(win) {
        const doc = win.document;
        const biosCanvas = doc.getElementById('melatonBiosCanvas');
        const biosModule = win.MelatonPhoenixBios || null;
        const biosFont = win.MelatonBiosFont || null;
        const env = {
            window: win,
            fetch: win.fetch.bind(win),
            navigator: win.navigator,
            sessionStorage: win.sessionStorage,
            localStorage: (() => { try { return win.localStorage; } catch (_) { return null; } })(),
            caches: win.caches || null,
            engine: win.melatonUpdateEngine || null,
            // the Games toolbar while Setup runs (public/scripts/launch/launchGames.js)
            games: win.MelatonLaunchGames || null,
            // the Phoenix BIOS (phoenixBios.js) painted into its own 640 x 480 canvas
            bios: biosModule,
            paintBios: biosModule && biosCanvas && biosFont
                ? biosModule.createCanvasPainter(biosCanvas, biosFont, doc.querySelector('.melaton-boot-enso'))
                : null,
            location: win.location,
            readProductKey: () => {
                const input = doc.querySelector('#melatonInstall .mi-key-input');
                return input ? input.value : '';
            },
            now: () => Date.now(),
            sleep,
            setInterval: win.setInterval.bind(win),
            clearInterval: win.clearInterval.bind(win),
            designMode: !!win.dreamscapeDesignModeActive
        };
        const ctl = createController(env, createDomView(doc));
        win.melatonBoot = Object.assign(win.melatonBoot || {}, { controller: ctl, preview: ctl.preview });

        // Keys the document head caught before this script loaded (F2 / Esc / F12 during the POST)
        const early = Array.isArray(globalThis.melatonBiosKeys) ? globalThis.melatonBiosKeys.splice(0) : [];
        win.addEventListener('keydown', (ev) => {
            if (ev.repeat && ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
            if (ctl.handleKey(ev.key, ev.key.length === 1 ? ev.key : null)) ev.preventDefault();
        });
        const text = doc.getElementById('melatonBootText');
        if (text) {
            text.addEventListener('pointerdown', () => ctl.stopCountdown());
            text.addEventListener('click', (ev) => {
                const entry = ev.target.closest('[data-index]');
                if (entry) {
                    ctl.handlePointer('choose', Number(entry.dataset.index), ev.pointerType || 'mouse');
                    return;
                }
                const key = ev.target.closest('[data-action]');
                if (key) ctl.handlePointer(key.dataset.action, undefined, ev.pointerType || 'mouse');
            });
        }
        const installer = doc.getElementById('melatonInstall');
        if (installer) {
            installer.addEventListener('click', (ev) => {
                // the language page's combo boxes open; their one entry is what they already show
                const combo = ev.target.closest('.mi-dropdown');
                installer.querySelectorAll('.mi-dropdown--open').forEach((node) => { if (node !== combo) node.classList.remove('mi-dropdown--open'); });
                if (combo) {
                    combo.classList.toggle('mi-dropdown--open');
                    return;
                }
                const btn = ev.target.closest('[data-action]');
                if (btn && !btn.disabled) ctl.handlePointer(btn.dataset.action, undefined, ev.pointerType || 'mouse');
            });
        }
        if (biosCanvas) {
            // a tap on the BIOS: cell under the pointer (the canvas is stretched to the window)
            biosCanvas.addEventListener('pointerdown', (ev) => {
                if (!ctl.bios) return;
                const rect = biosCanvas.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                const col = Math.floor((ev.clientX - rect.left) / rect.width * 640 / 8);
                const row = Math.floor((ev.clientY - rect.top) / rect.height * 480 / 19);
                if (ctl.bios.handlePointer(col, row)) ev.preventDefault();
            });
        }
        const started = ctl.runChecks();
        if (early.length) {
            // the POST is up by the next tick; replay what the head caught
            win.setTimeout(() => early.forEach((key) => ctl.handleKey(key)), 0);
        }
        void started;
        if (env.designMode) {
            // /launch?design=1&screen=menu opens one screen directly (review links, screenshots)
            let screen = null;
            try { screen = new URLSearchParams(win.location.search || '').get('screen'); } catch (_) { /* ignore */ }
            if (screen) ctl.preview(screen);
        }
        return ctl;
    }

    const api = { config, ENTRIES, INFO, RECOVERY_STEPS, INSTALL_STEPS, INSTALL_ERRORS, INSTALLER_ASSETS, LOADING_STEPS, SETUP_PAGES, SETUP_RESUME_KEY, INSTALLED_KEY, probeStatus, checkSession, cleanInstall, hasOsOnDisk, hasInstallRecord, loadingBarCells, readSetupResume, writeSetupResume, createController, createDomView, start };
    if (root) {
        root.melatonBoot = Object.assign(root.melatonBoot || {}, api);
        const doc = root.document;
        const active = doc && doc.documentElement && doc.documentElement.classList.contains('melaton-boot');
        if (active) {
            if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => start(root));
            else start(root);
        }
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
