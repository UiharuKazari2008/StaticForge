/**
 * Boot image preload.
 *
 * Login stage: while the screen is still the teal startup fill (and during the Melaton
 * teal hold, before the logon dialog is allowed up), decode the banner, the window
 * chrome, the one logon background this screen uses, and the fonts the logon actually
 * paints (Noto Sans, Tahoma, icon fonts).
 * A detached Image() does not install a font, and it does not match an icon that
 * later uses srcset. Those files live in #assetPreloadHold, off to the side, so the
 * browser decodes them before the dialog is allowed up.
 *
 * Desktop assets: after the connection's Connected beat, and before the logon hands off
 * to the desktop (websocket.js _startAfterLogon → desktopBoot.begin), the logon dialog
 * says "Preparing your desktop..." and keeps its marquee. That wait decodes only what
 * the first desktop paint shows: the active wallpaper, the desktop icons (drawn into
 * the hidden desktop so the same elements stay decoded), and the taskbar pictures.
 * The startup window does not load them again. It only reveals them.
 * assetPreload.lateAssets() lists anything that still had to fetch after that.
 */
var assetPreload = (function () {
    'use strict';

    var LOGIN_TIMEOUT_MS = 15000;
    var STAGE_TIMEOUT_MS = 20000;
    var IMAGE_TIMEOUT_MS = 12000;

    // Banner and art that can be on screen at the logon, including the connecting dialog
    // and the install wizard. desktop-boot.css also contributes header.png.
    var LOGIN_URLS = [
        '/static_images/header.png',
        '/static_images/logo_icon.png',
        '/static_images/explorer-banner.png',
        '/static_images/melaton/net-laptop.png',
        '/static_images/melaton/net-server.png',
        '/static_images/melaton/net-globe.png'
    ];
    var LOGIN_STYLES = ['desktop-boot.css', 'connection-dial.css', 'modal-window-title-toolbar.css'];
    // Faces the logon paints. Body text is Noto Sans; classic boot copy is Tahoma.
    var LOGIN_FONT_SPECS = [
        '400 16px "Noto Sans"',
        '700 29px "Noto Sans"',
        '400 16px "Noto Sans JP"',
        '400 13px Tahoma',
        '700 29px Tahoma'
    ];
    // Same faces as shellIconFontSpecs in public/scripts/comp/modalUtils.js.
    // Loaded here because the logon chrome and desktop icons use them before that step.
    var ICON_FONT_SPECS = [
        '900 16px "Font Awesome 6 Pro"',
        '400 16px "Font Awesome 6 Pro"',
        '300 16px "Font Awesome 6 Pro"',
        '100 16px "Font Awesome 6 Pro"',
        '900 16px "Font Awesome 6 Duotone"',
        '400 16px "Font Awesome 6 Brands"',
        '900 16px "Font Awesome 6 Sharp"',
        '16px "remixicon"',
        '16px "Material Design Icons"'
    ];
    var ICON_FONT_CLASSES = [
        'fas fa-house',
        'fa-regular fa-house',
        'fa-light fa-house',
        'fa-thin fa-house',
        'fa-duotone fa-house',
        'fa-brands fa-font-awesome',
        'fa-sharp fa-solid fa-house'
    ];

    // Pictures on the taskbar when it is revealed. Not the start menu, not every stylesheet.
    var TASKBAR_URLS = [
        '/static_images/account-pictures/kitten.png',
        '/static_images/account-pictures/guest.png',
        '/static_images/vista-start/usertile-kitten.png',
        '/static_images/vista-start/user-frame.png',
        '/static_images/vista-start/shutdown.png',
        '/static_images/vista-start/lock.png'
    ];

    var URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    var kept = new Map();
    var pinned = [];
    var fontSpecsStarted = new Set();
    var iconGlyphsHeld = false;
    var loginPromise = null;
    var stepsRegistered = false;
    var lateList = [];
    var lateSeen = new Set();
    var primedWallpaperUrl = '';
    var beforeTransitionPromise = null;
    var desktopAssetsPrepared = false;
    var bootIconsDrawn = false;

    function uniqueUrls(urls) {
        var out = [];
        var seen = new Set();
        if (!urls) return out;
        for (var i = 0; i < urls.length; i++) {
            var url = urls[i];
            if (!url || seen.has(url)) continue;
            seen.add(url);
            out.push(url);
        }
        return out;
    }

    function normalizeAssetUrl(raw, base) {
        if (!raw) return '';
        if (raw.indexOf('data:') === 0) return raw.indexOf('data:image/') === 0 ? raw : '';
        try {
            var abs = new URL(raw, base || location.href);
            if (abs.origin !== location.origin) return '';
            return abs.pathname + abs.search;
        } catch (e) {
            return '';
        }
    }

    function isBitmapUrl(url) {
        if (!url) return false;
        if (url.indexOf('data:image/') === 0) return true;
        return /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i.test(url.split('?')[0]);
    }

    function isCursorUrl(url) {
        return /\.(cur|ani)$/i.test(String(url || '').split('?')[0]);
    }

    function ensureHold() {
        var el = document.getElementById('assetPreloadHold');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'assetPreloadHold';
        el.setAttribute('aria-hidden', 'true');
        // Off the screen, still rendered. display:none would skip the font and the decode.
        el.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none;white-space:nowrap;';
        (document.body || document.documentElement).appendChild(el);
        return el;
    }

    function holdImage(url, srcset) {
        if (!url) return Promise.resolve();
        var key = srcset ? (url + '\n' + srcset) : url;
        var existing = kept.get(key);
        if (existing) return existing;
        var job = new Promise(function (resolve) {
            var img = document.createElement('img');
            img.alt = '';
            img.decoding = 'sync';
            if (srcset) {
                img.setAttribute('srcset', srcset);
                img.setAttribute('sizes', '192px');
            }
            ensureHold().appendChild(img);
            pinned.push(img);
            var settled = false;
            function finish() {
                if (settled) return;
                settled = true;
                resolve();
            }
            var timer = setTimeout(finish, IMAGE_TIMEOUT_MS);
            img.onload = function () {
                clearTimeout(timer);
                if (img.decode) img.decode().then(finish).catch(finish);
                else finish();
            };
            img.onerror = function () {
                clearTimeout(timer);
                finish();
            };
            img.src = url;
        });
        kept.set(key, job);
        if (!srcset) kept.set(url, job);
        return job;
    }

    function holdAppIcon(imageIcon) {
        if (!imageIcon) return Promise.resolve();
        // resolveAppIconPath / buildAppIconSrcset: public/scripts/comp/modalUtils.js
        var src = resolveAppIconPath(imageIcon);
        var srcset = buildAppIconSrcset(imageIcon);
        if (!src) return Promise.resolve();
        return holdImage(src, srcset);
    }

    function loadFonts(specs) {
        var hold = ensureHold();
        var loads = [];
        var list = specs || [];
        for (var i = 0; i < list.length; i++) {
            var spec = list[i];
            if (!spec || fontSpecsStarted.has(spec)) continue;
            fontSpecsStarted.add(spec);
            var span = document.createElement('span');
            span.style.font = spec;
            span.textContent = 'Dreamscape';
            hold.appendChild(span);
            if (document.fonts && document.fonts.load) {
                loads.push(document.fonts.load(spec).catch(function () { return []; }));
            }
        }
        if (!iconGlyphsHeld) {
            iconGlyphsHeld = true;
            for (var c = 0; c < ICON_FONT_CLASSES.length; c++) {
                var icon = document.createElement('i');
                icon.className = ICON_FONT_CLASSES[c];
                hold.appendChild(icon);
            }
        }
        if (!loads.length) return Promise.resolve();
        return Promise.race([
            Promise.all(loads),
            new Promise(function (resolve) { setTimeout(resolve, IMAGE_TIMEOUT_MS); })
        ]);
    }

    function preloadOne(url) {
        if (!url) return Promise.resolve();
        var existing = kept.get(url);
        if (existing) return existing;
        if (isCursorUrl(url)) {
            var job = fetch(url, { credentials: 'same-origin' }).then(function (res) {
                return res && res.arrayBuffer ? res.arrayBuffer() : null;
            }).catch(function () { return null; });
            kept.set(url, job);
            return job;
        }
        if (isBitmapUrl(url)) return holdImage(url);
        var skip = Promise.resolve();
        kept.set(url, skip);
        return skip;
    }

    function preloadUrls(urls, options) {
        var opts = options || {};
        var list = uniqueUrls(urls);
        if (!list.length) {
            if (opts.onProgress) opts.onProgress(1);
            return Promise.resolve();
        }
        var limit = opts.concurrency || 6;
        var index = 0;
        var done = 0;
        function worker() {
            if (index >= list.length) return Promise.resolve();
            var url = list[index++];
            return preloadOne(url).then(function () {
                done++;
                if (opts.onProgress) opts.onProgress(done / list.length);
                return worker();
            });
        }
        var runners = [];
        var n = Math.min(limit, list.length);
        for (var i = 0; i < n; i++) runners.push(worker());
        var all = Promise.all(runners);
        if (opts.timeoutMs > 0) {
            all = Promise.race([
                all,
                new Promise(function (resolve) { setTimeout(resolve, opts.timeoutMs); })
            ]);
        }
        return all;
    }

    // The logon marquee stays a marquee. This only changes the status sentence.
    function setLogonPrepareLine(on) {
        if (typeof wsClient === 'undefined' || !wsClient) return;
        wsClient._desktopAssetPreloadMessage = on ? 'Preparing your desktop...' : '';
        var fill = document.getElementById('desktopPreStartupProgressFill');
        if (fill) fill.style.width = '';
        if (wsClient._shouldUsePreStartupDialog && wsClient._shouldUsePreStartupDialog()) {
            wsClient._renderPreStartupDialog();
        }
    }

    function drawBootShortcuts() {
        if (bootIconsDrawn) return Promise.resolve();
        if (typeof desktopShortcuts === 'undefined' || !desktopShortcuts) return Promise.resolve();
        if (!desktopShortcuts.shortcuts || !desktopShortcuts.shortcuts.length) return Promise.resolve();
        if (!desktopShortcuts.gridContainer) desktopShortcuts.init();
        if (!desktopShortcuts.gridContainer) return Promise.resolve();
        desktopShortcuts._bootShortcutsLoaded = false;
        return desktopShortcuts.renderShortcuts().then(function () {
            // applyDesktopWindowPositionsAfterLoad: public/scripts/comp/modalUtils.js
            applyDesktopWindowPositionsAfterLoad();
            bootIconsDrawn = true;
        }).catch(function (error) {
            console.warn('Desktop icon render failed:', error);
        });
    }

    function walkCssRules(rules, base, out) {
        if (!rules) return;
        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i];
            // A media query's cssText lists every nested url. Only the query that
            // matches this screen is on the logon, so the other backgrounds stay unloaded.
            if (rule.media) {
                var mediaText = rule.media.mediaText || '';
                var matches = true;
                try { matches = !mediaText || matchMedia(mediaText).matches; } catch (e) { matches = true; }
                if (matches) walkCssRules(rule.cssRules, base, out);
                continue;
            }
            if (rule.cssRules && !rule.style) {
                walkCssRules(rule.cssRules, base, out);
                continue;
            }
            var text = rule.cssText || '';
            if (text.indexOf('url(') === -1) continue;
            URL_RE.lastIndex = 0;
            var match;
            while ((match = URL_RE.exec(text))) {
                var abs = normalizeAssetUrl(match[2], base);
                if (abs && (isBitmapUrl(abs) || isCursorUrl(abs))) out.push(abs);
            }
        }
    }

    function collectStylesheetUrls(nameParts) {
        var out = [];
        if (!document.styleSheets) return out;
        var sheets = document.styleSheets;
        for (var i = 0; i < sheets.length; i++) {
            var sheet = sheets[i];
            var href = '';
            try { href = sheet.href || ''; } catch (e) { continue; }
            if (nameParts && nameParts.length) {
                var hit = false;
                for (var n = 0; n < nameParts.length; n++) {
                    if (href.indexOf(nameParts[n]) !== -1) hit = true;
                }
                if (!hit) continue;
            }
            var rules;
            try { rules = sheet.cssRules; } catch (e) { continue; }
            walkCssRules(rules, href || document.baseURI, out);
        }
        return out;
    }

    function isWatchedAsset(url) {
        var path = String(url || '').split('?')[0];
        if (path.indexOf('/static_images/') !== 0 && path.indexOf('/dist/') !== 0) return false;
        if (path.indexOf('/previews/') === 0) return false;
        return /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp|cur|ani|woff2?|ttf|otf)$/i.test(path);
    }

    function noteLate(url, type) {
        var path = normalizeAssetUrl(url, location.href);
        if (!path) return;
        path = path.split('?')[0];
        if (!isWatchedAsset(path) || kept.has(path) || lateSeen.has(path)) return;
        lateSeen.add(path);
        lateList.push({ url: path, type: type || '', at: Date.now() });
        console.warn('Asset was not ready: ' + path);
    }

    function startLateWatch() {
        if (typeof PerformanceObserver === 'undefined') return;
        try {
            var observer = new PerformanceObserver(function (list) {
                if (!api.lateWatch) return;
                var entries = list.getEntries();
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    if (!entry || !entry.name) continue;
                    var kind = entry.initiatorType || '';
                    if (kind !== 'img' && kind !== 'image' && kind !== 'css' && kind !== 'font' && kind !== 'other') continue;
                    noteLate(entry.name, kind);
                }
            });
            observer.observe({ type: 'resource', buffered: false });
        } catch (e) { /* this browser has no resource timing */ }
    }

    function armLateWatch() {
        api.lateWatch = true;
    }

    function collectImageSrcs(selector) {
        var out = [];
        if (!document.querySelectorAll) return out;
        var nodes = document.querySelectorAll(selector);
        for (var i = 0; i < nodes.length; i++) {
            var src = nodes[i].getAttribute('src');
            var abs = normalizeAssetUrl(src, location.href);
            if (abs) out.push(abs);
        }
        return out;
    }

    function activeWallpaperUrl() {
        var ws = (typeof workspaces !== 'undefined' && workspaces && typeof activeWorkspace !== 'undefined')
            ? workspaces[activeWorkspace]
            : null;
        if (!ws || !ws.wallpaper) return '';
        // resolveWorkspaceWallpaperUrl: public/scripts/comp/modalUtils.js
        return resolveWorkspaceWallpaperUrl(ws.wallpaper) || '';
    }

    function startLoginStage() {
        if (loginPromise) return loginPromise;
        if (!isDesktop) {
            loginPromise = Promise.resolve();
            api.loginStageReady = true;
            return loginPromise;
        }
        var first = LOGIN_URLS.concat(collectStylesheetUrls(LOGIN_STYLES));
        var sheets = preloadUrls(first, { concurrency: 6 });
        var fonts = loadFonts(LOGIN_FONT_SPECS.concat(ICON_FONT_SPECS));
        var dom = new Promise(function (resolve) {
            function scan() {
                resolve(preloadUrls(collectImageSrcs('.boot-dialog img[src]'), { concurrency: 6 }));
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', scan, { once: true });
            } else {
                scan();
            }
        });
        loginPromise = Promise.all([sheets, dom, fonts]).then(function () {
            api.loginStageReady = true;
        });
        return loginPromise;
    }

    function whenLoginStageReady() {
        if (!isDesktop) {
            api.loginStageReady = true;
            return Promise.resolve();
        }
        return Promise.race([
            startLoginStage(),
            new Promise(function (resolve) { setTimeout(resolve, LOGIN_TIMEOUT_MS); })
        ]).then(function () {
            api.loginStageReady = true;
        });
    }

    function whenSettled(promise, timeoutMs) {
        var finished = false;
        var work = Promise.resolve(promise).then(function (value) {
            finished = value !== false;
        }, function () {});
        return Promise.race([
            work,
            new Promise(function (resolve) { setTimeout(resolve, timeoutMs); })
        ]).then(function () { return finished; });
    }

    function decodeImage(img) {
        if (!img) return Promise.resolve(true);
        function decoded() {
            if (!img.complete) return Promise.resolve(false);
            if (img.decode) return img.decode().then(function () { return true; }).catch(function () { return true; });
            return Promise.resolve(true);
        }
        if (img.complete) return decoded();
        return new Promise(function (resolve) {
            var timer = setTimeout(function () { resolve(false); }, IMAGE_TIMEOUT_MS);
            function finish(ok) {
                clearTimeout(timer);
                if (!ok) {
                    resolve(false);
                    return;
                }
                decoded().then(resolve);
            }
            img.addEventListener('load', function () { finish(true); }, { once: true });
            img.addEventListener('error', function () { finish(true); }, { once: true });
        });
    }

    function decodeImages(nodes) {
        var jobs = [];
        for (var i = 0; i < nodes.length; i++) jobs.push(decodeImage(nodes[i]));
        return Promise.all(jobs).then(function (flags) {
            for (var i = 0; i < flags.length; i++) {
                if (!flags[i]) return false;
            }
            return true;
        });
    }

    function preloadWallpaperStage() {
        if (!isDesktop || desktopAssetsPrepared) return Promise.resolve(true);
        var url = '';
        try {
            url = activeWallpaperUrl() || primedWallpaperUrl;
        } catch (error) {
            console.warn('Wallpaper preload skipped the workspace image:', error);
        }
        if (!url) url = '/static_images/wallpapers/aurora.webp';
        // The held <img> stays in the document so the decode is still there when the
        // wallpaper layer is painted. preloadWallpaperIntoMemory: public/scripts/comp/workspaceUtils.js
        return whenSettled(Promise.all([
            holdImage(url),
            preloadWallpaperIntoMemory(url)
        ]), IMAGE_TIMEOUT_MS).catch(function (error) {
            console.warn('Wallpaper preload failed:', error);
            return false;
        });
    }

    function preloadDesktopIconsStage() {
        if (!isDesktop) return Promise.resolve(true);
        if (desktopAssetsPrepared) return drawBootShortcuts().then(function () { return true; });
        return drawBootShortcuts().then(function () {
            var root = document.getElementById('desktopIcons');
            var imgs = root ? root.querySelectorAll('img') : [];
            return whenSettled(decodeImages(imgs), STAGE_TIMEOUT_MS);
        }).catch(function (error) {
            console.warn('Desktop icon preload failed:', error);
            return false;
        });
    }

    function preloadDesktopAssetsStage() {
        if (!isDesktop || desktopAssetsPrepared) return Promise.resolve(true);
        // Taskbar pictures only. Windows, start menu, and other wallpapers load when opened.
        return whenSettled(preloadUrls(TASKBAR_URLS, { concurrency: 6 }), IMAGE_TIMEOUT_MS).then(function (ok) {
            armLateWatch();
            return ok;
        }).catch(function (error) {
            console.warn('Desktop asset preload failed:', error);
            armLateWatch();
            return false;
        });
    }

    function primeDesktopAssetSources() {
        var workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : '';
        try {
            var known = activeWallpaperUrl();
            if (known) primedWallpaperUrl = known;
        } catch (error) {
            console.warn('Wallpaper target lookup failed:', error);
        }
        var lookup = Promise.resolve();
        if (!primedWallpaperUrl && typeof wsClient !== 'undefined' && wsClient
            && wsClient.getWorkspaces && wsClient.isConnected && wsClient.isConnected()) {
            lookup = wsClient.getWorkspaces().then(function (data) {
                if (!data) return;
                workspaceId = data.activeWorkspace || workspaceId;
                var list = data.workspaces || [];
                for (var i = 0; i < list.length; i++) {
                    var row = list[i];
                    if (!row || row.id !== workspaceId || !row.wallpaper) continue;
                    // resolveWorkspaceWallpaperUrl: public/scripts/comp/modalUtils.js
                    primedWallpaperUrl = resolveWorkspaceWallpaperUrl(row.wallpaper) || '';
                }
            }).catch(function (error) {
                console.warn('Wallpaper target lookup failed:', error);
            });
        }
        return lookup.then(function () {
            if (!workspaceId || typeof desktopShortcuts === 'undefined' || !desktopShortcuts) return;
            if (desktopShortcuts.shortcuts && desktopShortcuts.shortcuts.length) return;
            desktopShortcuts.init();
            desktopShortcuts.currentWorkspace = desktopShortcuts.currentWorkspace || workspaceId;
            return desktopShortcuts.loadShortcuts(workspaceId);
        });
    }

    // After Connected, before desktopBoot.begin. The logon keeps its marquee and the
    // Vista line. Icons are drawn now, while boot-staged still hides the desktop.
    function preloadBeforeDesktopTransition() {
        if (!isDesktop) return Promise.resolve();
        if (beforeTransitionPromise) return beforeTransitionPromise;
        var stages = [
            function () { return preloadWallpaperStage(); },
            function () { return preloadDesktopIconsStage(); },
            function () { return preloadDesktopAssetsStage(); }
        ];
        setLogonPrepareLine(true);
        beforeTransitionPromise = primeDesktopAssetSources().catch(function (error) {
            console.warn('Desktop asset sources failed:', error);
        }).then(function () {
            var ready = true;
            var chain = Promise.resolve();
            stages.forEach(function (run) {
                chain = chain.then(run).then(function (ok) {
                    if (ok === false) ready = false;
                });
            });
            return chain.then(function () {
                if (ready) desktopAssetsPrepared = true;
            });
        }).then(function () {
            setLogonPrepareLine(false);
        }, function (error) {
            setLogonPrepareLine(false);
            console.warn('Desktop asset preload before transition failed:', error);
        });
        return beforeTransitionPromise;
    }

    function installBeforeTransition() {
        if (typeof wsClient === 'undefined' || !wsClient || !isDesktop || wsClient._desktopAssetPreloadWrapped) return;
        if (!wsClient._startAfterLogon || !wsClient._runConnectionBeat || !wsClient._preStartupDisplayText) return;
        wsClient._desktopAssetPreloadWrapped = true;
        var display = wsClient._preStartupDisplayText.bind(wsClient);
        wsClient._preStartupDisplayText = function (phase, statusMessage) {
            if (this._desktopAssetPreloadMessage) return this._desktopAssetPreloadMessage;
            return display(phase, statusMessage);
        };
        var startAfterLogon = wsClient._startAfterLogon.bind(wsClient);
        wsClient._startAfterLogon = function () {
            if (this.initializationCompleted || this.sessionSuspended || this.preStartupHandoffCompleted) {
                return startAfterLogon();
            }
            var self = this;
            return Promise.resolve().then(function () {
                return self._runConnectionBeat('connected');
            }).catch(function (error) {
                console.warn('Connection complete beat failed:', error);
            }).then(function () {
                return preloadBeforeDesktopTransition();
            }).then(function () {
                return startAfterLogon();
            });
        };
    }

    function registerBootPreloadSteps() {
        if (stepsRegistered || typeof wsClient === 'undefined' || !wsClient || !isDesktop) return;
        stepsRegistered = true;
        installBeforeTransition();
        wsClient.registerInitStep(12.2, 'Loading wallpaper', function () {
            return api.preloadWallpaperStage();
        });
        wsClient.registerInitStep(18.2, 'Loading desktop icons', function () {
            return api.preloadDesktopIconsStage();
        });
        wsClient.registerInitStep(18.4, 'Loading desktop assets', function () {
            return api.preloadDesktopAssetsStage();
        });
    }

    var api = {
        loginStageReady: false,
        startLoginStage: startLoginStage,
        whenLoginStageReady: whenLoginStageReady,
        preloadWallpaperStage: preloadWallpaperStage,
        preloadDesktopIconsStage: preloadDesktopIconsStage,
        preloadDesktopAssetsStage: preloadDesktopAssetsStage,
        holdAppIcon: holdAppIcon,
        holdImage: holdImage,
        lateWatch: false,
        lateAssets: function () { return lateList.slice(); }
    };

    startLateWatch();

    if (typeof isDesktop !== 'undefined' && isDesktop) startLoginStage();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', registerBootPreloadSteps);
    } else {
        registerBootPreloadSteps();
    }

    return api;
})();
