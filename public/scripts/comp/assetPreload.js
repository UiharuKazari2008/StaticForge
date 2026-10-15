/**
 * Boot image preload.
 *
 * Login stage: while the screen is still the teal startup fill (and during the Melaton
 * teal hold, before the logon dialog is allowed up), decode the banner, the window
 * chrome, the one logon background this screen uses, and the fonts the logon actually
 * paints (Noto Sans, Tahoma, icon fonts).
 * A detached Image() does not install a font, and it does not match an icon that
 * later uses srcset. Those files live in #assetPreloadHold for the whole session.
 * The hold is a 1px strip: off the page visually, still painted, so the browser
 * keeps the decode. opacity:0 or a box parked off the screen is treated as lazy
 * and comes back as a placeholder the next time the bitmap is shown.
 *
 * After the connection's Connected beat, and before the logon hands off to the desktop
 * (websocket.js _startAfterLogon → desktopBoot.begin), the logon dialog says "Preparing
 * your desktop..." and keeps its marquee while the active workspace's wallpaper decodes.
 * Nothing else is fetched there.
 *
 * The startup window then loads the desktop in stages, each revealed when its own
 * assets are ready (desktopBoot.onStepDone):
 *   12.2 Loading wallpaper      → wallpaper shows
 *   18   Loading Desktop Shortcuts (desktopShortcuts.js) fetches the list
 *   18.2 Loading desktop icons  → icons drawn into the hidden desktop, decoded, shown
 *   18.4 Loading desktop assets → taskbar pictures, tray glyphs, sidebar chrome, start
 *        menu art and the start menu's own icons, the clock face and the workspace
 *        fonts; then the taskbar shows
 * The other workspaces' wallpapers are a background pass after the desktop
 * (workspaceUtils.js preloadOtherWorkspaceWallpapers).
 * Scrollbar bitmaps are not fetched here. They are inlined in vista-scrollbars.css:
 * ::-webkit-scrollbar paints a flat placeholder until a file url arrives, and it
 * does not use this hold.
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
        '/static_images/explorer-banner.png',
        '/static_images/melaton/net-laptop.png',
        '/static_images/melaton/net-server.png',
        '/static_images/melaton/net-globe.png',
        '/static_images/apple-touch-icon.png'
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

    // Pictures on the taskbar when it is revealed. Not every stylesheet.
    var TASKBAR_URLS = [
        '/static_images/account-pictures/kitten.png',
        '/static_images/account-pictures/guest.png',
        '/static_images/vista-start/usertile-kitten.png',
        '/static_images/vista-start/user-frame.png',
        '/static_images/vista-start/shutdown.png',
        '/static_images/vista-start/lock.png'
    ];
    // Tray glyphs (vista-glass-controls.css) and sidebar chrome (vistaSidebar.js
    // starts when the taskbar is shown).
    var DESKTOP_STYLES = ['vista-glass-controls.css', 'vista-sidebar.css'];
    // Start menu art. desktop-shell.css also names the default wallpaper, which is
    // not chrome. Folder icons are chosen in script, not in that sheet
    // (modalUtils.js START_MENU_ART). The start button's orb / logo is whatever its
    // <img> shows (held from the taskbar's DOM); the other styles' art is not loaded.
    var LUNA_START_URLS = [
        '/static_images/xp-mce-start.png',
        '/static_images/xp-mce-start-hot.png',
        '/static_images/xp-mce-start-pressed.png'
    ];
    var START_MENU_URLS = [
        '/static_images/vista-start/folder-20.png',
        '/static_images/vista-start/folder-40.png',
        '/static_images/vista-start/programs-arrow.png',
        '/static_images/vista-start/back-arrow.png',
        '/static_images/vista-start/search-glyph.png',
        '/static_images/vista-start/arrow.png'
    ];
    // Taskbar clock: public/css/desktop-shell.css .taskbar-clock
    var SHELL_FONT_SPECS = [
        '300 18px "Red Hat Display"'
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
    var primedFontFamilies = [];
    var pinLayoutBound = false;
    var beforeTransitionPromise = null;
    var wallpaperPrepared = false;
    var shellPrepared = false;
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
        // 1px tall, barely opaque, above every window. display:none, opacity:0, and a
        // box left of the screen are not painted, so the browser drops the decode and
        // the next paint of that bitmap shows a placeholder first.
        el.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:1px;overflow:hidden;opacity:0.02;pointer-events:none;z-index:2147483646;';
        (document.body || document.documentElement).appendChild(el);
        if (!pinLayoutBound) {
            pinLayoutBound = true;
            window.addEventListener('resize', layoutPinned);
        }
        return el;
    }

    function layoutPinned() {
        var width = window.innerWidth || document.documentElement.clientWidth || 2;
        var slots = width > 1 ? width - 1 : 1;
        for (var i = 0; i < pinned.length; i++) {
            pinned[i].style.left = (i % slots) + 'px';
        }
    }

    // srcset / sizes must be the live element's own, or the browser picks another file.
    function holdImage(url, srcset, sizes) {
        if (!url) return Promise.resolve();
        var key = srcset ? (url + '\n' + srcset + '\n' + (sizes || '')) : url;
        var existing = kept.get(key);
        if (existing) return existing;
        var job = new Promise(function (resolve) {
            var img = document.createElement('img');
            img.alt = '';
            img.decoding = 'sync';
            // Eager: an off-screen img is otherwise swapped for a placeholder and never decoded.
            img.loading = 'eager';
            img.style.position = 'absolute';
            img.style.top = '0';
            if (srcset) {
                img.setAttribute('srcset', srcset);
                if (sizes) img.setAttribute('sizes', sizes);
            }
            ensureHold().appendChild(img);
            pinned.push(img);
            layoutPinned();
            var settled = false;
            function finish() {
                if (settled) return;
                settled = true;
                resolve();
            }
            var timer = setTimeout(finish, IMAGE_TIMEOUT_MS);
            img.onload = function () {
                clearTimeout(timer);
                var chosen = normalizeAssetUrl(img.currentSrc || '', location.href).split('?')[0];
                if (chosen && !kept.has(chosen)) kept.set(chosen, Promise.resolve());
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

    // displayPx: the size the icon is drawn at (renderAppIconImg's displayPx).
    function holdAppIcon(imageIcon, displayPx) {
        if (!imageIcon) return Promise.resolve();
        // resolveAppIconPath / buildAppIconSrcset / appIconSizesAttr: public/scripts/comp/modalUtils.js
        var src = resolveAppIconPath(imageIcon);
        var srcset = buildAppIconSrcset(imageIcon);
        if (!src) return Promise.resolve();
        return holdImage(src, srcset, appIconSizesAttr(displayPx));
    }

    // Every <img> in markup built by the live renderer (getIconHTML and friends), held
    // as is, so src, srcset and sizes are exactly what the real element will ask for.
    function holdMarkupImages(html) {
        if (!html) return Promise.resolve();
        var tpl = document.createElement('template');
        tpl.innerHTML = html;
        var imgs = tpl.content.querySelectorAll('img');
        var jobs = [];
        for (var i = 0; i < imgs.length; i++) {
            var src = imgs[i].getAttribute('src');
            if (!src) continue;
            jobs.push(holdImage(src, imgs[i].getAttribute('srcset') || '', imgs[i].getAttribute('sizes') || ''));
        }
        return Promise.all(jobs);
    }

    function parseFontSpec(spec) {
        var named = /^(?:(\d+)\s+)?[\d.]+px\s+"([^"]+)"/.exec(spec || '');
        if (!named) return null;
        return { weight: named[1] ? Number(named[1]) : 0, family: named[2] };
    }

    function fontWeightMatches(declared, weight) {
        if (!weight) return true;
        var parts = String(declared || '400').trim().split(/\s+/).map(Number).filter(function (n) { return n > 0; });
        if (parts.length >= 2) return weight >= parts[0] && weight <= parts[1];
        if (parts.length === 1) return parts[0] === weight;
        return true;
    }

    // Mark the @font-face files before document.fonts.load fetches them, so the
    // late watch does not report the same file when CSS uses the face.
    function markFontFaceFiles(family, weight) {
        if (!family || !document.styleSheets) return;
        var sheets = document.styleSheets;
        for (var i = 0; i < sheets.length; i++) {
            var href = '';
            try { href = sheets[i].href || ''; } catch (e) { continue; }
            if (href.indexOf('fonts.css') === -1) continue;
            var rules;
            try { rules = sheets[i].cssRules; } catch (e) { continue; }
            for (var r = 0; r < rules.length; r++) {
                var rule = rules[r];
                if (!rule.style || !rule.style.getPropertyValue) continue;
                var fam = (rule.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim();
                if (fam !== family) continue;
                var declared = rule.style.getPropertyValue('font-weight') || '400';
                if (!fontWeightMatches(declared, weight)) continue;
                var src = rule.style.getPropertyValue('src') || rule.cssText || '';
                URL_RE.lastIndex = 0;
                var match;
                while ((match = URL_RE.exec(src))) {
                    var abs = normalizeAssetUrl(match[2], href);
                    if (!abs) continue;
                    abs = abs.split('?')[0];
                    if (!kept.has(abs)) kept.set(abs, Promise.resolve());
                }
            }
        }
    }

    function loadFonts(specs) {
        var hold = ensureHold();
        var loads = [];
        var list = specs || [];
        for (var i = 0; i < list.length; i++) {
            var spec = list[i];
            if (!spec || fontSpecsStarted.has(spec)) continue;
            fontSpecsStarted.add(spec);
            var parsed = parseFontSpec(spec);
            if (parsed) markFontFaceFiles(parsed.family, parsed.weight);
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
            if (skipLogonRule(rule)) continue;
            URL_RE.lastIndex = 0;
            var match;
            while ((match = URL_RE.exec(text))) {
                var abs = normalizeAssetUrl(match[2], base);
                if (abs && (isBitmapUrl(abs) || isCursorUrl(abs))) out.push(abs);
            }
        }
    }

    // The Vista Welcome screen's art only when that screen is on, and never its
    // per-aspect backgrounds: websocket.js _whenVistaLogonArtReady holds the one the
    // aspect queries picked (the default rule would add a second, unused one).
    function skipLogonRule(rule) {
        var selector = rule.selectorText || '';
        if (selector.indexOf('.vista-logon') === -1) return false;
        if (rule.style && rule.style.getPropertyValue && rule.style.getPropertyValue('--vista-logon-bg')) return true;
        var b = document.body;
        return !(b && b.classList.contains('vista-logon'));
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

    // Hold each <img> as it is in the document, srcset and sizes included, so the
    // file the element will pick is the one that is decoded.
    // skipHidden: leave out pictures under a .hidden box (the start button styles not in use).
    function holdDomImages(selector, skipHidden) {
        if (!document.querySelectorAll) return Promise.resolve();
        var nodes = document.querySelectorAll(selector);
        var jobs = [];
        for (var i = 0; i < nodes.length; i++) {
            if (skipHidden && nodes[i].closest && nodes[i].closest('.hidden')) continue;
            var src = normalizeAssetUrl(nodes[i].getAttribute('src'), location.href);
            if (!src) continue;
            jobs.push(holdImage(src, nodes[i].getAttribute('srcset') || '', nodes[i].getAttribute('sizes') || ''));
        }
        return Promise.all(jobs);
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
                resolve(holdDomImages('.boot-dialog img[src]'));
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

    // Logon (after Connected) and step 12.2. holdImage is per url, so the second call only
    // waits when Loading Workspaces moved the active wallpaper.
    function preloadWallpaperStage() {
        if (!isDesktop) return Promise.resolve(true);
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
        ]), IMAGE_TIMEOUT_MS).then(function (ok) {
            if (ok) wallpaperPrepared = true;
            return ok;
        }).catch(function (error) {
            console.warn('Wallpaper preload failed:', error);
            return false;
        });
    }

    // Step 18.2, after step 18 fetched the shortcut list: draw the icons into the hidden
    // desktop and wait for their bitmaps; the icons stage reveals them.
    function preloadDesktopIconsStage() {
        if (!isDesktop) return Promise.resolve(true);
        return drawBootShortcuts().then(function () {
            var root = document.getElementById('desktopIcons');
            var imgs = root ? root.querySelectorAll('img') : [];
            return whenSettled(decodeImages(imgs), STAGE_TIMEOUT_MS);
        }).catch(function (error) {
            console.warn('Desktop icon preload failed:', error);
            return false;
        });
    }

    // The start menu's first view (pinned and frequent rows, drawn when it opens) with the
    // renderer's own markup. getStartMenuPinnedItems / getStartMenuFrequentItems /
    // isStartMenuListedItem / getIconHTML / START_MENU_ROW_ICON_PX: public/scripts/comp/modalUtils.js
    function holdStartMenuIcons() {
        var jobs = [];
        try {
            var items = getStartMenuPinnedItems().filter(isStartMenuListedItem).concat(getStartMenuFrequentItems());
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (!item || item.folder || item.color || !item.imageIcon) continue;
                jobs.push(holdMarkupImages(getIconHTML(item.icon, item.imageIcon, '', START_MENU_ROW_ICON_PX.large)));
            }
        } catch (error) {
            console.warn('Start menu icon preload skipped:', error);
        }
        return Promise.all(jobs);
    }

    // Step 18.4: taskbar, tray, sidebar and start menu; the taskbar stage reveals them.
    function preloadDesktopAssetsStage() {
        if (!isDesktop || shellPrepared) return Promise.resolve(true);
        // Start menu, then taskbar, tray, and sidebar.
        // Each bitmap stays in #assetPreloadHold after this stage.
        var shellFonts = SHELL_FONT_SPECS.slice();
        for (var f = 0; f < primedFontFamilies.length; f++) {
            var family = primedFontFamilies[f];
            shellFonts.push('300 16px "' + family + '"');
            shellFonts.push('400 16px "' + family + '"');
            shellFonts.push('500 16px "' + family + '"');
            shellFonts.push('600 16px "' + family + '"');
            shellFonts.push('700 16px "' + family + '"');
        }
        var startBtn = document.getElementById('taskbarStartBtn');
        var shellUrls = START_MENU_URLS.concat(
            startBtn && startBtn.classList.contains('luna') ? LUNA_START_URLS : [],
            TASKBAR_URLS,
            collectStylesheetUrls(DESKTOP_STYLES)
        );
        return whenSettled(Promise.all([
            preloadUrls(shellUrls, { concurrency: 6 }),
            holdDomImages('#desktopTaskbar img[src]', true),
            holdStartMenuIcons(),
            loadFonts(shellFonts)
        ]), IMAGE_TIMEOUT_MS).then(function (ok) {
            if (ok) shellPrepared = true;
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
        try {
            var liveWorkspace = (typeof workspaces !== 'undefined' && workspaces && typeof activeWorkspace !== 'undefined')
                ? workspaces[activeWorkspace]
                : null;
            if (liveWorkspace) {
                if (liveWorkspace.primaryFont) primedFontFamilies.push(liveWorkspace.primaryFont);
                if (liveWorkspace.textareaFont && liveWorkspace.textareaFont !== liveWorkspace.primaryFont) {
                    primedFontFamilies.push(liveWorkspace.textareaFont);
                }
            }
        } catch (error) {
            console.warn('Workspace font lookup failed:', error);
        }
        var lookup = Promise.resolve();
        if ((!primedWallpaperUrl || !primedFontFamilies.length) && typeof wsClient !== 'undefined' && wsClient
            && wsClient.getWorkspaces && wsClient.isConnected && wsClient.isConnected()) {
            lookup = wsClient.getWorkspaces().then(function (data) {
                if (!data) return;
                workspaceId = data.activeWorkspace || workspaceId;
                var list = data.workspaces || [];
                for (var i = 0; i < list.length; i++) {
                    var row = list[i];
                    if (!row || row.id !== workspaceId) continue;
                    if (row.primaryFont) primedFontFamilies.push(row.primaryFont);
                    if (row.textareaFont && row.textareaFont !== row.primaryFont) primedFontFamilies.push(row.textareaFont);
                    if (!row.wallpaper) continue;
                    // resolveWorkspaceWallpaperUrl: public/scripts/comp/modalUtils.js
                    primedWallpaperUrl = resolveWorkspaceWallpaperUrl(row.wallpaper) || '';
                }
            }).catch(function (error) {
                console.warn('Wallpaper target lookup failed:', error);
            });
        }
        // The shortcut list is step 18's job (Loading Desktop Shortcuts), in the startup window.
        return lookup;
    }

    // After Connected, before desktopBoot.begin. The logon keeps its marquee and the
    // Vista line while the active workspace's wallpaper decodes; nothing else loads here.
    function preloadBeforeDesktopTransition() {
        if (!isDesktop) return Promise.resolve();
        if (beforeTransitionPromise) return beforeTransitionPromise;
        setLogonPrepareLine(true);
        beforeTransitionPromise = primeDesktopAssetSources().catch(function (error) {
            console.warn('Desktop asset sources failed:', error);
        }).then(function () {
            return preloadWallpaperStage();
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
        holdMarkupImages: holdMarkupImages,
        isWallpaperPrepared: function () { return wallpaperPrepared; },
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
