/**
 * Fatal client error handler: uncaught exceptions, unhandled rejections, and optional
 * script fence verification (see scripts/app.js markers). Loads first so failures in
 * later bundles still surface a recovery UI.
 */
(function () {
    __dreamscapeFatalNavBypass = false;
    __dreamscapeFence = (typeof __dreamscapeFence !== 'undefined' && __dreamscapeFence)
        ? __dreamscapeFence
        : Object.create(null);

    var overlayEl = null;
    var errorRegistry = [];
    var errorNextId = 1;
    var windowNextId = 1;
    var listModalEl = null;
    var listModalInitialized = false;
    var windowTemplate = null;

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseScriptUrlFromStack(stack) {
        if (!stack) return '';
        var lines = String(stack).split('\n');
        var i, m;
        for (i = 0; i < lines.length; i++) {
            m = lines[i].match(/(?:\(|\s)(https?:\/\/[^\s)]+):\d+:\d+/);
            if (m && m[1].indexOf(location.origin) === 0) return m[1];
        }
        for (i = 0; i < lines.length; i++) {
            m = lines[i].match(/\(([^)]+\.js[^)]*):\d+:\d+\)/);
            if (m && m[1].indexOf('http') === 0) return m[1];
        }
        return '';
    }

    function canUseAppErrorUI() {
        try {
            if (!document.getElementById('dreamscapeAppErrorWindowTemplate')) return false;
            if (!document.getElementById('dreamscapeAppErrorModal')) return false;
            if (typeof openModal !== 'function') return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    function normalizeDetail(message, reason, filename, lineno, colno, stack, errorUrl) {
        var fileLine = '';
        if (filename) {
            fileLine = filename + (lineno != null && lineno !== '' ? ':' + lineno : '');
            if (colno != null && colno !== '') fileLine += ':' + colno;
        } else if (errorUrl) {
            fileLine = errorUrl;
        } else {
            fileLine = '(unknown)';
        }
        return {
            message: message || 'Error',
            reason: reason || message || 'Unknown',
            stack: stack || '',
            fileLine: fileLine,
            errorUrl: errorUrl || '',
            timestamp: new Date().toISOString()
        };
    }

    function buildStandaloneDetailHtml(detail) {
        var stack = escapeHtml(detail.stack || '');
        var fileLine = escapeHtml(detail.fileLine || '');
        return (
            '<div class="dreamscape-app-error-detail" data-fatal-root>' +
            '<p class="dreamscape-app-error-lead">Something went wrong. Details below can help support or debugging.</p>' +
            '<dl class="dreamscape-app-error-dl">' +
            '<dt>Message</dt><dd><pre class="dreamscape-app-error-pre">' + escapeHtml(detail.message) + '</pre></dd>' +
            '<dt>Reason</dt><dd><pre class="dreamscape-app-error-pre">' + escapeHtml(detail.reason) + '</pre></dd>' +
            '<dt>File &amp; line</dt><dd><pre class="dreamscape-app-error-pre">' + fileLine + '</pre></dd>' +
            '</dl>' +
            '<div class="dreamscape-app-error-stack-wrap"><div class="dreamscape-app-error-stack-label">Stack trace</div>' +
            '<pre class="dreamscape-app-error-pre dreamscape-app-error-stack">' + stack + '</pre></div>' +
            '</div>'
        );
    }

    function buildOverlayHtml(detail) {
        return buildStandaloneDetailHtml(detail) +
            '<div class="dreamscape-app-error-overlay-actions">' +
            '<button type="button" class="btn-secondary" data-fatal-action="copy">Copy Issue</button>' +
            '<button type="button" class="btn-secondary" data-fatal-action="return">Return</button>' +
            '</div>';
    }

    function relativePathFromUrl(url) {
        if (!url) return '';
        try {
            var parsed = new URL(url, location.href);
            if (parsed.origin !== location.origin) return url;
            return parsed.pathname + parsed.search;
        } catch (e) {
            return url;
        }
    }

    function formatIssueForCursor(detail) {
        var lines = [
            'Fix this application error in the staticforge codebase.',
            '',
            '## Error',
            '',
            '**Message:** ' + (detail.message || 'Error'),
            '**Reason:** ' + (detail.reason || 'Unknown'),
            '**File & line:** ' + (detail.fileLine || '(unknown)'),
            '**Script URL:** ' + (detail.errorUrl || '(unknown)'),
            '**Relative path:** ' + (relativePathFromUrl(detail.errorUrl) || '(unknown)'),
            '**Timestamp:** ' + (detail.timestamp || new Date().toISOString()),
            '**Page:** ' + location.href,
            '',
            '### Stack trace',
            '',
            '```',
            detail.stack || '(no stack trace)',
            '```',
            '',
            'Please investigate the root cause and apply a minimal fix that matches existing project conventions.'
        ];
        return lines.join('\n');
    }

    function copyIssueToClipboard(detail) {
        var text = formatIssueForCursor(detail);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                try {
                    if (typeof showToast === 'function') {
                        showToast('Issue copied to clipboard', 'success');
                    }
                } catch (e) { /* ignore */ }
            }).catch(function () {
                fallbackCopy(text);
            });
            return;
        }
        fallbackCopy(text);
    }

    function fallbackCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (e) { /* ignore */ }
    }

    function registerError(detail) {
        var entry = {
            id: errorNextId++,
            detail: detail,
            windowEl: null
        };
        errorRegistry.push(entry);
        return entry;
    }

    function summarizeError(detail) {
        var msg = detail.message || 'Error';
        if (msg.length > 120) msg = msg.substring(0, 117) + '...';
        return msg;
    }

    function formatErrorTimestamp(detail) {
        if (!detail || !detail.timestamp) return '';
        try {
            return new Date(detail.timestamp).toLocaleString();
        } catch (e) {
            return detail.timestamp;
        }
    }

    function renderErrorList() {
        if (!listModalEl) {
            listModalEl = document.getElementById('dreamscapeAppErrorModal');
        }
        var listEl = document.getElementById('dreamscapeAppErrorList');
        if (!listEl) return;

        if (!errorRegistry.length) {
            listEl.innerHTML = (
                '<div class="dreamscape-app-error-empty">' +
                '<i class="fas fa-check-circle"></i>' +
                '<p>No application errors recorded.</p>' +
                '</div>'
            );
            return;
        }

        var html = '';
        var i;
        for (i = errorRegistry.length - 1; i >= 0; i--) {
            var entry = errorRegistry[i];
            var detail = entry.detail;
            html += (
                '<button type="button" class="dreamscape-app-error-card" data-error-id="' + entry.id + '">' +
                '<div class="dreamscape-app-error-card-icon"><i class="fas fa-triangle-exclamation"></i></div>' +
                '<div class="dreamscape-app-error-card-body">' +
                '<div class="dreamscape-app-error-card-title">' + escapeHtml(summarizeError(detail)) + '</div>' +
                '<div class="dreamscape-app-error-card-meta">' + escapeHtml(detail.fileLine || '(unknown location)') + '</div>' +
                '<div class="dreamscape-app-error-card-time">' + escapeHtml(formatErrorTimestamp(detail)) + '</div>' +
                '</div>' +
                '</button>'
            );
        }
        listEl.innerHTML = html;
    }

    function initListModal() {
        if (listModalInitialized) return;
        listModalInitialized = true;
        listModalEl = document.getElementById('dreamscapeAppErrorModal');
        if (!listModalEl) return;

        var closeBtn = document.getElementById('dreamscapeAppErrorModalCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                // closeModal: public/scripts/comp/modalUtils.js
                if (typeof closeModal === 'function') closeModal(listModalEl);
            });
        }

        listModalEl.addEventListener('click', function (ev) {
            var toolbarBtn = ev.target.closest('[data-fatal-toolbar]');
            if (toolbarBtn) {
                handleToolbarAction(toolbarBtn.getAttribute('data-fatal-toolbar'));
                return;
            }
            var itemBtn = ev.target.closest('.dreamscape-app-error-card');
            if (itemBtn) {
                var errorId = parseInt(itemBtn.getAttribute('data-error-id'), 10);
                openStandaloneForErrorId(errorId);
            }
        });
    }

    function openListModal() {
        initListModal();
        renderErrorList();
        if (listModalEl && typeof openModal === 'function') {
            openModal(listModalEl);
        }
    }

    function getErrorEntryById(errorId) {
        var i;
        for (i = 0; i < errorRegistry.length; i++) {
            if (errorRegistry[i].id === errorId) return errorRegistry[i];
        }
        return null;
    }

    function closeStandaloneWindow(entry) {
        if (!entry || !entry.windowEl) return;
        var el = entry.windowEl;
        entry.windowEl = null;
        try {
            // closeModal: public/scripts/comp/modalUtils.js
            if (typeof closeModal === 'function') {
                closeModal(el).then(function () {
                    if (el.parentNode) el.parentNode.removeChild(el);
                });
            } else {
                el.classList.add('hidden');
                if (el.parentNode) el.parentNode.removeChild(el);
            }
        } catch (e) { /* ignore */ }
    }

    function bringStandaloneToFront(entry) {
        if (!entry || !entry.windowEl) return;
        try {
            // bringModalToFront: public/scripts/comp/modalUtils.js
            if (typeof bringModalToFront === 'function') {
                bringModalToFront(entry.windowEl);
            } else if (typeof openModal === 'function') {
                openModal(entry.windowEl);
            }
        } catch (e) { /* ignore */ }
    }

    function wireStandaloneActions(windowEl, entry) {
        if (!windowEl || !entry) return;

        windowEl.addEventListener('click', function (ev) {
            var toolbarBtn = ev.target.closest('[data-fatal-toolbar]');
            if (toolbarBtn) {
                handleToolbarAction(toolbarBtn.getAttribute('data-fatal-toolbar'));
                return;
            }
            var actionBtn = ev.target.closest('[data-fatal-action]');
            if (!actionBtn) return;
            var act = actionBtn.getAttribute('data-fatal-action');
            if (act === 'copy') {
                copyIssueToClipboard(entry.detail);
            } else if (act === 'return') {
                closeStandaloneWindow(entry);
            }
        });

        var closeBtn = windowEl.querySelector('.dreamscape-app-error-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                closeStandaloneWindow(entry);
            });
        }
    }

    function createStandaloneWindow(entry) {
        if (!windowTemplate) {
            windowTemplate = document.getElementById('dreamscapeAppErrorWindowTemplate');
        }
        if (!windowTemplate) return null;

        var windowId = 'dreamscapeAppErrorWindow_' + (windowNextId++);
        var windowEl = windowTemplate.cloneNode(true);
        windowEl.id = windowId;
        windowEl.classList.remove('hidden');

        var titleEl = windowEl.querySelector('.dreamscape-app-error-window-title');
        if (titleEl) {
            titleEl.textContent = 'Spectator Fault Detection - Error #' + entry.id;
        }

        var bodyEl = windowEl.querySelector('.dreamscape-app-error-body');
        if (bodyEl) {
            bodyEl.innerHTML = buildStandaloneDetailHtml(entry.detail);
        }

        windowEl.dataset.windowIdentifier = 'appErrorWindow:' + entry.id;
        if (typeof transientWindowsWithPositions !== 'undefined') {
            transientWindowsWithPositions.add(windowEl.dataset.windowIdentifier);
        }

        document.body.appendChild(windowEl);
        wireStandaloneActions(windowEl, entry);
        entry.windowEl = windowEl;

        if (typeof openModal === 'function') {
            openModal(windowEl);
        }

        return windowEl;
    }

    function openStandaloneForErrorId(errorId) {
        var entry = getErrorEntryById(errorId);
        if (!entry) return;
        if (entry.windowEl && document.body.contains(entry.windowEl)) {
            bringStandaloneToFront(entry);
            return;
        }
        createStandaloneWindow(entry);
    }

    function closeAllStandaloneWindows() {
        var i;
        for (i = 0; i < errorRegistry.length; i++) {
            closeStandaloneWindow(errorRegistry[i]);
        }
    }

    function presentErrorUI(entry) {
        if (!canUseAppErrorUI()) {
            showOverlay(entry.detail);
            return;
        }

        initListModal();
        renderErrorList();

        if (errorRegistry.length >= 2) {
            closeAllStandaloneWindows();
            openListModal();
            return;
        }

        if (entry.windowEl && document.body.contains(entry.windowEl)) {
            bringStandaloneToFront(entry);
            return;
        }

        createStandaloneWindow(entry);
    }

    function showOverlay(detail) {
        if (overlayEl) return;
        overlayEl = document.createElement('div');
        overlayEl.id = 'dreamscapeFatalErrorRoot';
        overlayEl.setAttribute('role', 'alertdialog');
        overlayEl.setAttribute('aria-modal', 'true');
        overlayEl.innerHTML = buildOverlayHtml(detail);
        document.body.appendChild(overlayEl);
        overlayEl.onclick = function (ev) {
            var btn = ev.target.closest('[data-fatal-action]');
            if (!btn) return;
            var act = btn.getAttribute('data-fatal-action');
            if (act === 'copy') {
                copyIssueToClipboard(detail);
            } else if (act === 'return') {
                dismissFatal();
            }
        };
    }

    function presentFatal(detail) {
        try {
            var entry = registerError(detail);
            presentErrorUI(entry);
        } catch (e2) {
            try {
                console.error('Fatal error UI failed:', e2);
            } catch (e3) { /* ignore */ }
            showOverlay(detail);
        }
    }

    function urlFromFileLine(fileLine) {
        if (!fileLine || fileLine === '(unknown)') return '';
        var str = String(fileLine);
        var m = str.match(/^(https?:\/\/[^\s:]+)/);
        if (m) return m[1];
        if (str.charAt(0) === '/') {
            return location.origin + str.split(':')[0];
        }
        return '';
    }

    function collectRepairUrls() {
        var urls = [];
        var i, detail, url, parsed;

        function addUrl(candidate) {
            if (!candidate || urls.indexOf(candidate) !== -1) return;
            urls.push(candidate);
        }

        for (i = 0; i < errorRegistry.length; i++) {
            detail = errorRegistry[i].detail;
            addUrl(detail.errorUrl);
            addUrl(urlFromFileLine(detail.fileLine));
            if (detail.stack) {
                parsed = parseScriptUrlFromStack(detail.stack);
                addUrl(parsed);
            }
        }
        return urls;
    }

    function normalizeSameOriginUrl(url) {
        try {
            var abs = new URL(url, location.href).href.split('?')[0];
            if (abs.indexOf(location.origin) !== 0) return '';
            return abs;
        } catch (e) {
            return '';
        }
    }

    function ensureServiceWorkerReady(swm) {
        if (!swm) return Promise.resolve(false);
        if (swm.swRegistration && swm.swRegistration.active) return Promise.resolve(true);
        if (typeof swm.waitForServiceWorkerReady === 'function') {
            return swm.waitForServiceWorkerReady().then(function () {
                return !!(swm.swRegistration && swm.swRegistration.active);
            }).catch(function () {
                return false;
            });
        }
        return Promise.resolve(false);
    }

    function repairAllScripts() {
        var urls = collectRepairUrls();
        if (!urls.length) {
            try {
                alert('No script URLs found in the error list. Use Reinstall to reset the application.');
            } catch (e) { /* ignore */ }
            return;
        }

        var swm = typeof serviceWorkerManager !== 'undefined' ? serviceWorkerManager : null;
        if (!swm || typeof swm.deleteAndPrecache !== 'function') {
            try {
                alert('Service worker manager is not ready. Use Reinstall or Restart.');
            } catch (e2) { /* ignore */ }
            return;
        }

        ensureServiceWorkerReady(swm).then(function (ready) {
            if (!ready) {
                try {
                    alert('Service worker is not ready. Use Reinstall or Restart.');
                } catch (e3) { /* ignore */ }
                return;
            }

            var chain = Promise.resolve();
            var j;
            for (j = 0; j < urls.length; j++) {
                (function (url) {
                    chain = chain.then(function () {
                        var abs = normalizeSameOriginUrl(url);
                        if (!abs) return Promise.resolve();
                        // deleteAndPrecache: public/scripts/comp/serviceWorkerManager.js
                        return swm.deleteAndPrecache(abs);
                    });
                })(urls[j]);
            }

            return chain.then(function () {
                restartApplication();
            });
        }).catch(function () {
            try {
                alert('Repair failed for one or more files. Try Reinstall.');
            } catch (e4) { /* ignore */ }
        });
    }

    function restartApplication() {
        __dreamscapeFatalNavBypass = true;
        if (typeof bypassConfirmation !== 'undefined') {
            bypassConfirmation = true;
        }
        if (typeof runClientShutdownSequence === 'function') {
            runClientShutdownSequence(function () { location.reload(); });
            return;
        }
        location.reload();
    }

    function deleteIndexedDatabase(dbName) {
        return new Promise(function (resolve) {
            var deleteReq = indexedDB.deleteDatabase(dbName);
            var timeout = setTimeout(resolve, 2000);
            deleteReq.onsuccess = function () {
                clearTimeout(timeout);
                resolve();
            };
            deleteReq.onerror = function () {
                clearTimeout(timeout);
                resolve();
            };
            deleteReq.onblocked = function () {
                clearTimeout(timeout);
                resolve();
            };
        });
    }

    async function reinstallWebApp() {
        __dreamscapeFatalNavBypass = true;
        if (typeof bypassConfirmation !== 'undefined') {
            bypassConfirmation = true;
        }

        try {
            if ('caches' in window) {
                var cacheNames = await caches.keys();
                var i;
                for (i = 0; i < cacheNames.length; i++) {
                    await caches.delete(cacheNames[i]);
                }
            }
        } catch (e) { /* ignore */ }

        try {
            localStorage.clear();
        } catch (e2) { /* ignore */ }

        try {
            sessionStorage.clear();
        } catch (e3) { /* ignore */ }

        try {
            if ('indexedDB' in window && indexedDB.databases) {
                var databases = await indexedDB.databases();
                var j, dbName;
                for (j = 0; j < databases.length; j++) {
                    dbName = databases[j] && databases[j].name;
                    if (dbName) {
                        await deleteIndexedDatabase(dbName);
                    }
                }
            }
        } catch (e4) { /* ignore */ }

        try {
            if ('serviceWorker' in navigator) {
                var regs = await navigator.serviceWorker.getRegistrations();
                var k;
                for (k = 0; k < regs.length; k++) {
                    await regs[k].unregister();
                }
            }
        } catch (e5) { /* ignore */ }

        location.reload();
    }

    function clearAllErrors() {
        closeAllStandaloneWindows();
        errorRegistry = [];
        renderErrorList();
        if (listModalEl && typeof closeModal === 'function' &&
            !listModalEl.classList.contains('hidden')) {
            closeModal(listModalEl);
        }
    }

    function handleToolbarAction(action) {
        if (action === 'repair') {
            repairAllScripts();
        } else if (action === 'restart') {
            restartApplication();
        } else if (action === 'reinstall') {
            reinstallWebApp();
        } else if (action === 'clear') {
            clearAllErrors();
        }
    }

    function dismissFatal() {
        if (overlayEl && overlayEl.parentNode) {
            overlayEl.parentNode.removeChild(overlayEl);
        }
        overlayEl = null;
    }

    function handleWindowError(msg, url, line, col, err) {
        try {
            var stack = err && err.stack ? err.stack : '';
            var message = err && err.message ? err.message : String(msg);
            var reason = err && err.message ? err.message : String(msg);
            var errorUrl = url || parseScriptUrlFromStack(stack);
            presentFatal(normalizeDetail(message, reason, url || '', line, col, stack, errorUrl));
        } catch (e) { /* ignore */ }
    }

    function onWindowErrorEvent(ev) {
        if (!ev || ev.defaultPrevented || ev.__dreamscapeFatalHandled) return;
        if (ev.error) {
            ev.__dreamscapeFatalHandled = true;
            handleWindowError(ev.message, ev.filename, ev.lineno, ev.colno, ev.error);
            return;
        }
        if (ev.message && ev.filename) {
            ev.__dreamscapeFatalHandled = true;
            handleWindowError(ev.message, ev.filename, ev.lineno, ev.colno, null);
        }
    }

    function handleRejection(ev) {
        try {
            var r = ev.reason;
            var message = 'Unhandled promise rejection';
            var reason = message;
            var stack = '';
            if (r && typeof r === 'object') {
                if (r.message) message = r.message;
                if (r.message) reason = r.message;
                if (r.stack) stack = r.stack;
            } else if (r != null) {
                reason = String(r);
                message = reason;
            }
            var errorUrl = parseScriptUrlFromStack(stack);
            presentFatal(normalizeDetail(message, reason, '', '', '', stack, errorUrl));
        } catch (e) { /* ignore */ }
    }

    function checkFencesOnLoad() {
        var f = __dreamscapeFence;
        if (!f) return;
        var keys = Object.keys(f);
        var k;
        for (k = 0; k < keys.length; k++) {
            if (f[keys[k]] !== true) {
                presentFatal(normalizeDetail(
                    'Incomplete script load',
                    'The script "' + keys[k] + '" did not finish executing (truncated download or parse error).',
                    '',
                    '',
                    '',
                    'Fence state: ' + String(f[keys[k]]),
                    ''
                ));
                return;
            }
        }
    }

    window.addEventListener('error', onWindowErrorEvent, true);

    window.addEventListener('unhandledrejection', handleRejection);

    window.addEventListener('load', function () {
        setTimeout(checkFencesOnLoad, 0);
    });

    window.dismissDreamscapeFatalError = dismissFatal;
    window.openDreamscapeAppErrorModal = openListModal;

    // Directly present application error UI (bypasses window error event)
    window.presentDreamscapeApplicationError = function (message, reason, stack) {
        var err = new Error(message || 'Application error');
        if (stack) err.stack = stack;
        var errStack = err.stack || '';
        presentFatal(normalizeDetail(
            message || err.message,
            reason || err.message,
            '',
            '',
            '',
            errStack,
            parseScriptUrlFromStack(errStack)
        ));
    };

    // Defer throw so DevTools console invocation still hits the page error handler
    window.triggerTestUncaughtException = function (message) {
        var msg = message || 'Test uncaught exception — application error UI verification';
        setTimeout(function () {
            throw new Error(msg);
        }, 0);
    };
})();
