/**
 * Boot image preload.
 *
 * Login stage: while the screen is still the teal startup fill (and during the Melaton
 * teal hold, before the logon dialog is allowed up), decode the banner and every image
 * the logon dialog, the connecting dialog, or the install wizard can show.
 *
 * Desktop stage: after the logon hands off, the startup window's loading bar runs three
 * steps in order (public/scripts/websocket.js updateCurrentInitStepProgress):
 *   1. Loading wallpaper       the workspace wallpaper, then the default
 *   2. Loading desktop icons   every desktop shortcut image, then the icons are drawn
 *   3. Loading desktop assets  start menu, taskbar, window controls, cursors, shell icons
 * desktopBoot.js reveals wallpaper, icons, and the taskbar only after the matching step.
 */
var assetPreload = (function () {
    'use strict';

    var LOGIN_TIMEOUT_MS = 8000;
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
    var LOGIN_STYLES = ['desktop-boot.css', 'connection-dial.css'];

    var SHELL_STYLES = [
        'desktop-shell.css',
        'desktop-cursors.css',
        'vista-glass-controls.css',
        'modal-window-title-toolbar.css'
    ];
    var SHELL_URLS = [
        '/static_images/wallpapers/aurora.webp',
        '/static_images/account-pictures/kitten.png',
        '/static_images/account-pictures/guest.png',
        '/static_images/vista-start/usertile-kitten.png'
    ];
    var VISTA_ICON_KINDS = ['folder', 'recycle', 'file', 'internet-shortcut'];

    var URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    var kept = new Map();
    var pinned = [];
    var loginPromise = null;
    var stepsRegistered = false;

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

    function preloadOne(url) {
        if (!url) return Promise.resolve();
        var existing = kept.get(url);
        if (existing) return existing;
        var job;
        if (isCursorUrl(url)) {
            job = fetch(url, { credentials: 'same-origin' }).then(function (res) {
                return res && res.arrayBuffer ? res.arrayBuffer() : null;
            }).catch(function () { return null; });
        } else if (isBitmapUrl(url)) {
            job = new Promise(function (resolve) {
                var img = new Image();
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
        } else {
            job = Promise.resolve();
        }
        kept.set(url, job);
        return job;
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

    function reportProgress(fraction) {
        // updateCurrentInitStepProgress: public/scripts/websocket.js
        if (typeof wsClient !== 'undefined' && wsClient && wsClient.updateCurrentInitStepProgress) {
            wsClient.updateCurrentInitStepProgress(fraction);
        }
    }

    function walkCssRules(rules, base, out) {
        if (!rules) return;
        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i];
            var text = rule.cssText || '';
            if (text.indexOf('url(') !== -1) {
                URL_RE.lastIndex = 0;
                var match;
                while ((match = URL_RE.exec(text))) {
                    var abs = normalizeAssetUrl(match[2], base);
                    if (abs && (isBitmapUrl(abs) || isCursorUrl(abs))) out.push(abs);
                }
            }
            if (rule.cssRules) walkCssRules(rule.cssRules, base, out);
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

    function vistaDesktopIconUrls() {
        var urls = [];
        var sizes = ['64', '256'];
        for (var s = 0; s < sizes.length; s++) {
            for (var i = 0; i < VISTA_ICON_KINDS.length; i++) {
                urls.push('/static_images/vista-icons/explorer/' + VISTA_ICON_KINDS[i] + '-' + sizes[s] + '.png');
            }
        }
        return urls;
    }

    function pushAppIcon(urls, imageIcon) {
        if (!imageIcon) return;
        // appIconMemoryUrl / resolveAppIconPath: public/scripts/comp/modalUtils.js
        var sized = appIconMemoryUrl(imageIcon);
        var plain = resolveAppIconPath(imageIcon);
        if (sized) urls.push(sized);
        if (plain && plain !== sized) urls.push(plain);
    }

    function galleryShortcutUrl(data) {
        if (!data) return '';
        if (data.preview) {
            // getGalleryPreviewUrl: public/scripts/utils/deviceUtils.js
            var name = getGalleryPreviewUrl(data.preview);
            if (name) return '/previews/' + encodeURIComponent(name);
        }
        if (data.filename) {
            // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
            return localGalleryImageUrl(data.filename);
        }
        return '';
    }

    function collectDesktopIconUrls(shortcuts) {
        var urls = vistaDesktopIconUrls();
        var list = Array.isArray(shortcuts) ? shortcuts : [];
        for (var i = 0; i < list.length; i++) {
            var shortcut = list[i];
            if (!shortcut || shortcut._isDeleted) continue;
            var data = shortcut.data || {};
            var type = shortcut.type;
            if (type === 'image') {
                urls.push(galleryShortcutUrl(data));
            } else if (type === 'studio-change') {
                urls.push(galleryShortcutUrl({
                    filename: data.iconFilename || data.filename,
                    preview: data.preview
                }));
            } else if (type === 'reference' && data.hash) {
                // localCachePreviewUrl: public/scripts/comp/assetUrlResolver.js
                if (data.preview) urls.push(localCachePreviewUrl(data.preview));
                else urls.push(localCachePreviewUrl(data.hash + '.webp'));
            } else if (type === 'applet' && data.launchId && typeof desktopShortcuts !== 'undefined' && desktopShortcuts) {
                var applet = desktopShortcuts.findAppletById(data.launchId);
                if (applet && applet.imageIcon) pushAppIcon(urls, applet.imageIcon);
            } else if (type === 'dsap' && data.imageIcon) {
                pushAppIcon(urls, data.imageIcon);
            } else if (type === 'bracket-generation') {
                pushAppIcon(urls, 'stack.png');
            } else if (type === 'request' && data.preview) {
                urls.push('data:image/png;base64,' + data.preview);
            } else if (type === 'static-wiki-page' && data.siteId) {
                urls.push('/private/wiki/' + data.siteId + '/assets/icon.png');
            } else if (type === 'web-page' && data.icon) {
                urls.push(normalizeAssetUrl(data.icon, location.href));
            } else if (type === 'nax-tag' && typeof desktopShortcuts !== 'undefined' && desktopShortcuts) {
                urls.push(desktopShortcuts.naxTagImageUrl(data));
            }
        }
        return uniqueUrls(urls);
    }

    function activeWallpaperUrl() {
        var ws = (typeof workspaces !== 'undefined' && workspaces && typeof activeWorkspace !== 'undefined')
            ? workspaces[activeWorkspace]
            : null;
        if (!ws || !ws.wallpaper) return '';
        // resolveWorkspaceWallpaperUrl: public/scripts/comp/modalUtils.js
        return resolveWorkspaceWallpaperUrl(ws.wallpaper) || '';
    }

    function preloadWallpaperList(urls, mapProgress) {
        var list = uniqueUrls(urls);
        if (!list.length) {
            reportProgress(mapProgress ? mapProgress(1) : 1);
            return Promise.resolve();
        }
        var index = 0;
        var done = 0;
        function worker() {
            if (index >= list.length) return Promise.resolve();
            var url = list[index++];
            // preloadWallpaperIntoMemory: public/scripts/comp/workspaceUtils.js
            return Promise.race([
                preloadWallpaperIntoMemory(url),
                new Promise(function (resolve) { setTimeout(resolve, IMAGE_TIMEOUT_MS); })
            ]).then(function () {
                done++;
                var fraction = done / list.length;
                reportProgress(mapProgress ? mapProgress(fraction) : fraction);
                return worker();
            });
        }
        var runners = [];
        var n = Math.min(2, list.length);
        for (var i = 0; i < n; i++) runners.push(worker());
        return Promise.race([
            Promise.all(runners),
            new Promise(function (resolve) { setTimeout(resolve, STAGE_TIMEOUT_MS); })
        ]);
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
        loginPromise = Promise.all([sheets, dom]).then(function () {
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

    function preloadWallpaperStage() {
        if (!isDesktop) return Promise.resolve();
        var urls = ['/static_images/wallpapers/aurora.webp'];
        try {
            var active = activeWallpaperUrl();
            if (active) urls.unshift(active);
        } catch (error) {
            console.warn('Wallpaper preload skipped the workspace image:', error);
        }
        return preloadWallpaperList(urls).catch(function (error) {
            console.warn('Wallpaper preload failed:', error);
        });
    }

    function preloadDesktopIconsStage() {
        if (!isDesktop) return Promise.resolve();
        var shortcuts = (typeof desktopShortcuts !== 'undefined' && desktopShortcuts)
            ? desktopShortcuts.shortcuts
            : [];
        var urls = [];
        try {
            urls = collectDesktopIconUrls(shortcuts);
        } catch (error) {
            console.warn('Desktop icon list failed:', error);
            urls = vistaDesktopIconUrls();
        }
        return preloadUrls(urls, {
            concurrency: 6,
            timeoutMs: STAGE_TIMEOUT_MS,
            onProgress: reportProgress
        }).catch(function (error) {
            console.warn('Desktop icon preload failed:', error);
        }).then(function () {
            if (!desktopShortcuts || !desktopShortcuts._bootShortcutsLoaded) return;
            desktopShortcuts._bootShortcutsLoaded = false;
            return desktopShortcuts.renderShortcuts().then(function () {
                // applyDesktopWindowPositionsAfterLoad: public/scripts/comp/modalUtils.js
                applyDesktopWindowPositionsAfterLoad();
            }).catch(function (error) {
                console.warn('Desktop icon render failed:', error);
            });
        });
    }

    function preloadDesktopAssetsStage() {
        if (!isDesktop) return Promise.resolve();
        var urls = SHELL_URLS.concat(collectStylesheetUrls(SHELL_STYLES));
        if (document.images) {
            for (var i = 0; i < document.images.length; i++) {
                var src = document.images[i].getAttribute('src');
                if (src && src.indexOf('/static_images/') !== -1) urls.push(normalizeAssetUrl(src, location.href));
            }
        }
        // collectWorkspaceWallpaperUrls: public/scripts/comp/workspaceUtils.js
        var wallpapers = (typeof workspaces !== 'undefined' && workspaces) ? collectWorkspaceWallpaperUrls() : [];
        return preloadUrls(urls, {
            concurrency: 8,
            timeoutMs: STAGE_TIMEOUT_MS,
            onProgress: function (fraction) { reportProgress(fraction * 0.8); }
        }).then(function () {
            return preloadWallpaperList(wallpapers, function (fraction) { return 0.8 + (fraction * 0.1); });
        }).then(function () {
            // preloadShellIconsAndFonts: public/scripts/comp/modalUtils.js
            return Promise.race([
                preloadShellIconsAndFonts(),
                new Promise(function (resolve) { setTimeout(resolve, 8000); })
            ]);
        }).then(function () {
            reportProgress(1);
        }).catch(function (error) {
            console.warn('Desktop asset preload failed:', error);
        });
    }

    function registerBootPreloadSteps() {
        if (stepsRegistered || typeof wsClient === 'undefined' || !wsClient || !isDesktop) return;
        stepsRegistered = true;
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
        collectDesktopIconUrls: collectDesktopIconUrls
    };

    if (typeof isDesktop !== 'undefined' && isDesktop) startLoginStage();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', registerBootPreloadSteps);
    } else {
        registerBootPreloadSteps();
    }

    return api;
})();
