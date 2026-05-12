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

    var fatalActive = false;
    var overlayEl = null;
    var wikiInstance = null;
    var lastErrorUrl = '';

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

    function canOpenFatalWikiWindow() {
        try {
            if (typeof wikiWindowManager === 'undefined' || wikiWindowManager == null) return false;
            if (typeof wikiWindowManager.createWindow !== 'function') return false;
            if (!document.getElementById('tagWikiWindowTemplate')) return false;
            if (typeof openModal !== 'function') return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    function dismissFatal() {
        fatalActive = false;
        lastErrorUrl = '';
        if (overlayEl && overlayEl.parentNode) {
            overlayEl.parentNode.removeChild(overlayEl);
        }
        overlayEl = null;
        if (wikiInstance && typeof wikiInstance.close === 'function') {
            try {
                wikiInstance.close();
            } catch (e) { /* ignore */ }
        }
        wikiInstance = null;
    }

    function wireActions(root) {
        if (!root) return;
        root.onclick = function (ev) {
            var t = ev.target;
            if (!t || !t.getAttribute) return;
            var btn = t.closest('[data-fatal-action]');
            if (!btn) return;
            var act = btn.getAttribute('data-fatal-action');
            if (act === 'return') {
                dismissFatal();
            } else if (act === 'restart') {
                __dreamscapeFatalNavBypass = true;
                if (typeof bypassConfirmation !== 'undefined') {
                    bypassConfirmation = true;
                }
                location.reload();
            } else if (act === 'redownload') {
                redownloadFailedScript();
            } else if (act === 'reinstall') {
                reinstallWebApp();
            }
        };
    }

    function buildPanelHtml(detail) {
        lastErrorUrl = detail.errorUrl || '';
        var stack = escapeHtml(detail.stack || '');
        var fileLine = escapeHtml(detail.fileLine || '');
        return (
            '<div class="dreamscape-fatal-panel" data-fatal-root>' +
            '<h1 class="dreamscape-fatal-title">Application error</h1>' +
            '<p class="dreamscape-fatal-lead">Something went wrong. Details below can help support or debugging.</p>' +
            '<dl class="dreamscape-fatal-dl">' +
            '<dt>Message</dt><dd><pre class="dreamscape-fatal-pre">' + escapeHtml(detail.message) + '</pre></dd>' +
            '<dt>Reason</dt><dd><pre class="dreamscape-fatal-pre">' + escapeHtml(detail.reason) + '</pre></dd>' +
            '<dt>File &amp; line</dt><dd><pre class="dreamscape-fatal-pre">' + fileLine + '</pre></dd>' +
            '</dl>' +
            '<div class="dreamscape-fatal-stack-wrap"><div class="dreamscape-fatal-stack-label">Stack trace</div>' +
            '<pre class="dreamscape-fatal-pre dreamscape-fatal-stack">' + stack + '</pre></div>' +
            '<div class="dreamscape-fatal-actions">' +
            '<button type="button" class="btn-secondary" data-fatal-action="return">Return</button>' +
            '<button type="button" class="btn-secondary" data-fatal-action="restart">Restart</button>' +
            '<button type="button" class="btn-secondary" data-fatal-action="redownload">Redownload file</button>' +
            '<button type="button" class="btn-danger" data-fatal-action="reinstall">Reinstall</button>' +
            '</div></div>'
        );
    }

    function showOverlay(detail) {
        if (overlayEl) return;
        overlayEl = document.createElement('div');
        overlayEl.id = 'dreamscapeFatalErrorRoot';
        overlayEl.setAttribute('role', 'alertdialog');
        overlayEl.setAttribute('aria-modal', 'true');
        overlayEl.innerHTML = buildPanelHtml(detail);
        document.body.appendChild(overlayEl);
        wireActions(overlayEl);
    }

    function showWikiWindow(detail) {
        var html = buildPanelHtml(detail);
        var content = { title: 'Application error', tagName: 'Application error', html: html };
        var tag = { name: 'application-error', title: 'Application error' };
        wikiInstance = wikiWindowManager.createWindow(content, tag);
    }

    function presentFatal(detail) {
        if (fatalActive) return;
        fatalActive = true;
        wikiInstance = null;
        try {
            if (canOpenFatalWikiWindow()) {
                try {
                    showWikiWindow(detail);
                    if (wikiInstance && wikiInstance.displayArea) {
                        wireActions(wikiInstance.displayArea);
                        return;
                    }
                } catch (e) {
                    wikiInstance = null;
                }
            }
            showOverlay(detail);
        } catch (e2) {
            try {
                console.error('Fatal error UI failed:', e2);
            } catch (e3) { /* ignore */ }
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
            errorUrl: errorUrl || ''
        };
    }

    function handleWindowError(msg, url, line, col, err) {
        if (fatalActive) return;
        try {
            var stack = err && err.stack ? err.stack : '';
            var message = err && err.message ? err.message : String(msg);
            var reason = err && err.message ? err.message : String(msg);
            var errorUrl = url || parseScriptUrlFromStack(stack);
            presentFatal(normalizeDetail(message, reason, url || '', line, col, stack, errorUrl));
        } catch (e) { /* ignore */ }
    }

    function handleRejection(ev) {
        if (fatalActive) return;
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

    function redownloadFailedScript() {
        var url = lastErrorUrl;
        if (!url) {
            try {
                alert('Could not determine which file failed. Use Reinstall to refresh the app.');
            } catch (e) { /* ignore */ }
            return;
        }
        var abs;
        try {
            abs = new URL(url, location.href).href;
        } catch (e) {
            return;
        }
        if (abs.indexOf(location.origin) !== 0) {
            try {
                alert('Failed file is not same-origin; Redownload is not available.');
            } catch (e2) { /* ignore */ }
            return;
        }
        var swm = typeof serviceWorkerManager !== 'undefined' ? serviceWorkerManager : null;
        if (!swm || typeof swm.deleteAndPrecache !== 'function') {
            try {
                alert('Service worker manager is not ready. Use Restart or Reinstall.');
            } catch (e3) { /* ignore */ }
            return;
        }
        swm.deleteAndPrecache(abs).then(function () {
            __dreamscapeFatalNavBypass = true;
            if (typeof bypassConfirmation !== 'undefined') {
                bypassConfirmation = true;
            }
            location.reload();
        }).catch(function () {
            try {
                alert('Redownload failed. Try Reinstall.');
            } catch (e4) { /* ignore */ }
        });
    }

    async function reinstallWebApp() {
        __dreamscapeFatalNavBypass = true;
        if (typeof bypassConfirmation !== 'undefined') {
            bypassConfirmation = true;
        }
        try {
            if ('caches' in window) {
                var names = await caches.keys();
                var i;
                for (i = 0; i < names.length; i++) {
                    await caches.delete(names[i]);
                }
            }
        } catch (e) { /* ignore */ }
        try {
            if ('serviceWorker' in navigator) {
                var regs = await navigator.serviceWorker.getRegistrations();
                var j;
                for (j = 0; j < regs.length; j++) {
                    await regs[j].unregister();
                }
            }
        } catch (e2) { /* ignore */ }
        location.reload();
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

    window.addEventListener('error', function (ev) {
        if (!ev || ev.defaultPrevented) return;
        handleWindowError(ev.message, ev.filename, ev.lineno, ev.colno, ev.error);
    });

    window.addEventListener('unhandledrejection', handleRejection);

    window.addEventListener('load', function () {
        setTimeout(checkFencesOnLoad, 0);
    });

    window.dismissDreamscapeFatalError = dismissFatal;
})();
