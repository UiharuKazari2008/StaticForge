/**
 * Fatal client error handler: uncaught exceptions, unhandled rejections, and optional
 * script fence verification (see scripts/app.js markers). Loads first so failures in
 * later bundles still surface a recovery UI.
 */

// Hover capability for CSS (manual preview, loupe, etc.): html.can-hover / html.no-hover.
// Some browsers report (hover: none) with maxTouchPoints === 0 on a normal mouse PC.
// Markup defaults to can-hover; this script corrects to no-hover only for real touch-only.
(function applyDreamscapeHoverCapability() {
    function mq(query) {
        try {
            return !!(window.matchMedia && window.matchMedia(query).matches);
        } catch (e) {
            return false;
        }
    }
    function computeCanHover() {
        if (mq('(any-hover: hover)')) return true;
        // An Android WebView reports (hover: hover) for its primary pointer until the first touch
        // while (any-hover: hover) is already false: a touch screen without any hovering pointer
        // is no-hover from load (#709)
        if ((navigator.maxTouchPoints || 0) > 0 && mq('(any-pointer: coarse)')) return false;
        if (mq('(hover: hover)')) return true;
        // No touch hardware but MQ says no-hover → broken desktop report
        if ((navigator.maxTouchPoints || 0) === 0) return true;
        return false;
    }
    function applyHoverCapability(forceCanHover) {
        var can = forceCanHover === true ? true : computeCanHover();
        var root = document.documentElement;
        root.classList.toggle('can-hover', can);
        root.classList.toggle('no-hover', !can);
        window.__dreamscapeCanHover = can;
    }
    applyHoverCapability(false);
    window.addEventListener('pointermove', function onDreamscapePtr(e) {
        if (e.pointerType === 'mouse' && !window.__dreamscapeCanHover) {
            applyHoverCapability(true);
            window.removeEventListener('pointermove', onDreamscapePtr, true);
        }
    }, true);
    try {
        var hoverMq = window.matchMedia('(any-hover: hover)');
        if (hoverMq) {
            var onHoverMq = function () { applyHoverCapability(false); };
            if (hoverMq.addEventListener) hoverMq.addEventListener('change', onHoverMq);
            else if (hoverMq.addListener) hoverMq.addListener(onHoverMq);
        }
    } catch (e) { /* ignore */ }
})();

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
    var connectivityWindowEl = null;
    var connectivityOverlayEl = null;
    var connectivityTemplate = null;
    var connectivityDetail = null;
    var connectivityErrorEntry = null;

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

    function canUseConnectivityUI() {
        try {
            if (!document.getElementById('dreamscapeConnectivityErrorTemplate')) return false;
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
            'The application encountered an error:',
            '## Error',
            '**Message:** ' + (detail.message || 'Error'),
            '**Reason:** ' + (detail.reason || 'Unknown'),
            '**File & line:** ' + (detail.fileLine || '(unknown)'),
            '**Script URL:** ' + (detail.errorUrl || '(unknown)'),
            '**Relative path:** ' + (relativePathFromUrl(detail.errorUrl) || '(unknown)'),
            '**Timestamp:** ' + (detail.timestamp || new Date().toISOString()),
            '**Page:** ' + location.href,
        ];
        if (detail.stack) {
            lines.push(
                '',
                '### Stack trace',
                '```',
                detail.stack,
                '```'
            );
        }
        lines.push('');
        return lines.join('\n');
    }

    function copyIssueToClipboard(detail) {
        var text = formatIssueForCursor(detail);
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        if (typeof copyTextToClipboard === 'function') {
            copyTextToClipboard(text).then(function () {
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
                '<img src="/static_images/vista-icons/info-32.png" alt="" draggable="false">' +
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
                '<div class="dreamscape-app-error-card-icon"><img src="/static_images/vista-icons/error-32.png" alt="" draggable="false"></div>' +
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
            titleEl.textContent = entry.connectivityOnly
                ? 'Spectator Fault Detection'
                : ('Spectator Fault Detection - Error #' + entry.id);
        }

        var bodyEl = windowEl.querySelector('.dreamscape-app-error-body');
        if (bodyEl) {
            bodyEl.innerHTML = buildStandaloneDetailHtml(entry.detail);
        }

        windowEl.dataset.windowIdentifier = entry.connectivityOnly
            ? 'appErrorWindow:connectivity'
            : ('appErrorWindow:' + entry.id);
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

    // ---------------------------------------------------------------------------------------
    // Error capture (Yozora #833): every client fault reaches the server's fault store
    // (POST /api/fault-reports, modules/programFaultReports.js), desktop and phone alike, so
    // modules/faultAutoFix.js can start a Claude run on it. The "has stopped working" dialog
    // (programFaults.js) saves its own faults; this covers the rest:
    //   uncaught   window errors no program dialog took (Spectator's list)
    //   rejection  unhandled promise rejections no program dialog took
    //   swallowed  errors a catch block handed over (programFaults.report, init steps)
    //   resource   one of our scripts / stylesheets failed to load (online only)
    //   logged     console.error(...) with an Error that has a frame of ours
    //   animation  an animation that runs unseen or without end (the animation watchdog in
    //              scripts/utils/offscreenAnimationPause.js, #930): not an error, a cost to fix
    // One fault (program + error + message + top frame) is posted once per page load; repeats
    // are counted and posted again with the same occurrenceId at most every REPEAT_MS, so the
    // server folds them into that occurrence. At most MAX_FAULTS distinct faults per page load.
    // Lives here, not in its own file, so a cached app.html still gets it with SW updates.
    //   window.dreamscapeErrorCapture.capture(detail, { kind, error, program, source })
    //   window.dreamscapeErrorCapture.captureError(error, { kind, source })
    // ---------------------------------------------------------------------------------------
    var errorCapture = (function () {
        var REPORT_URL = '/api/fault-reports';
        var FIRST_POST_MS = 1500;
        var REPEAT_MS = 30000;
        var MAX_FAULTS = 25;
        var faults = {};
        var faultCount = 0;
        var flushTimer = 0;
        var seq = 0;
        var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
        var posting = false;

        function markSeen(err) {
            try { if (seen && err && typeof err === 'object') seen.add(err); } catch (e) { /* frozen */ }
        }

        function wasSeen(err) {
            try { return !!(seen && err && typeof err === 'object' && seen.has(err)); } catch (e) { return false; }
        }

        function surface() {
            try {
                var d = document.documentElement;
                if (window.uiShell === 'mobile' || (d && d.classList && d.classList.contains('ui-mobile'))) return 'mobile';
            } catch (e) { /* desktop */ }
            return 'desktop';
        }

        function ownFrames(stack) {
            var out = [];
            var lines = String(stack || '').split('\n');
            for (var i = 0; i < lines.length && out.length < 3; i++) {
                var m = lines[i].match(/(?:https?:\/\/[^\/\s)]+)?(\/(?:scripts|apps|css)\/[^\s?):]+)/);
                if (m) out.push(m[1]);
            }
            return out;
        }

        function programFor(stack, surf) {
            try {
                if (window.programFaults && typeof window.programFaults.attribute === 'function') {
                    var p = window.programFaults.attribute({ stack: stack || '' });
                    if (p && (p.key || p.name)) {
                        return { key: p.key || p.name, name: p.name || p.key, launchId: p.launchId || null, game: p.game || null, core: !!p.core };
                    }
                }
            } catch (e) { /* the attribution itself may be what broke */ }
            return surf === 'mobile'
                ? { key: 'shell:mobile', name: 'Melaton Mobile', core: true }
                : { key: 'shell:desktop', name: 'Melaton Desktop', core: true };
        }

        function errorNameOf(message, err) {
            if (err && typeof err === 'object' && err.name && err.name !== 'Error') return String(err.name);
            var m = /^([A-Z][A-Za-z]*(?:Error|Exception))\b/.exec(String(message || ''));
            return m ? m[1] : 'Error';
        }

        function clientInfo(surf) {
            var desktopState = '';
            try { if (typeof window.getClientDesktopState === 'function') desktopState = String(window.getClientDesktopState()); } catch (e) { /* ignore */ }
            var nav = window.navigator || {};
            return {
                url: location.pathname,
                userAgent: nav.userAgent || '',
                viewport: window.innerWidth ? window.innerWidth + 'x' + window.innerHeight : '',
                uptimeMs: window.performance && performance.now ? Math.round(performance.now()) : null,
                desktopState: desktopState,
                shell: surf
            };
        }

        function post(entry, final) {
            entry.sent = entry.repeats;
            entry.sentAt = Date.now();
            entry.body.repeats = entry.repeats;
            var body;
            try { body = JSON.stringify(entry.body); } catch (e) { return; }
            if (body.length > 60000) {
                entry.body.stack = String(entry.body.stack || '').slice(0, 8000);
                body = JSON.stringify(entry.body);
            }
            posting = true;
            try {
                if (final && navigator.sendBeacon && typeof Blob === 'function') {
                    navigator.sendBeacon(REPORT_URL, new Blob([body], { type: 'application/json' }));
                } else if (typeof fetch === 'function') {
                    fetch(REPORT_URL, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: body.length < 60000 })
                        .catch(function () { entry.sent = 0; });
                }
            } catch (e) { /* the report is best effort */ }
            posting = false;
        }

        function flush(final) {
            flushTimer = 0;
            var now = Date.now();
            var wait = 0;
            for (var k in faults) {
                if (!Object.prototype.hasOwnProperty.call(faults, k)) continue;
                var f = faults[k];
                if (f.repeats <= f.sent) continue;
                var due = f.sent === 0 ? 0 : (f.sentAt + REPEAT_MS - now);
                if (final || due <= 0) post(f, final);
                else wait = wait ? Math.min(wait, due) : due;
            }
            if (wait && !final) flushTimer = setTimeout(function () { flush(false); }, wait);
        }

        function scheduleFlush(ms) {
            if (flushTimer) return;
            flushTimer = setTimeout(function () { flush(false); }, ms);
        }

        function capture(detail, opts) {
            try {
                if (posting) return false;
                var d = detail || {};
                var o = opts || {};
                var err = o.error;
                if (err && wasSeen(err) && o.kind === 'logged') return false;
                markSeen(err);
                var message = String(d.message || (err && err.message) || '');
                var reason = String(d.reason || '');
                if (reason && reason !== message && message.indexOf(reason) < 0) message = message ? message + ': ' + reason : reason;
                var stack = String(d.stack || (err && err.stack) || '');
                if (!message && !stack) return false;
                if (isResizeObserverLoopNotice(message)) return false;
                var surf = surface();
                var program = o.program || programFor(stack, surf);
                var frames = ownFrames(stack);
                var errorName = o.errorName || errorNameOf(message, err);
                var sig = [program.key, errorName, message.replace(/\d+/g, '#').slice(0, 200), frames[0] || d.fileLine || ''].join('|');
                var entry = faults[sig];
                if (entry) {
                    entry.repeats += 1;
                    scheduleFlush(REPEAT_MS);
                    return true;
                }
                if (faultCount >= MAX_FAULTS) return false;
                faultCount += 1;
                faults[sig] = {
                    repeats: 1,
                    sent: 0,
                    sentAt: 0,
                    body: {
                        occurrenceId: Date.now().toString(36) + '-c' + (++seq).toString(36) + '-' + Math.random().toString(36).slice(2, 7),
                        at: d.timestamp || new Date().toISOString(),
                        surface: surf,
                        kind: o.kind || 'uncaught',
                        program: program,
                        errorName: errorName,
                        message: message.slice(0, 2000),
                        stack: stack,
                        fileLine: d.fileLine && d.fileLine !== '(unknown)' ? d.fileLine : '',
                        source: o.source || d.source || '',
                        scripts: frames,
                        // the animation watchdog's finding (offscreenAnimationPause.js, kind 'animation')
                        animation: o.animation || undefined,
                        page: 'capture',
                        client: clientInfo(surf)
                    }
                };
                scheduleFlush(FIRST_POST_MS);
                return true;
            } catch (e) {
                return false;
            }
        }

        function captureError(error, opts) {
            var err = error instanceof Error ? error : new Error(String(error));
            return capture({ message: err.message, stack: err.stack || '' }, Object.assign({ error: err }, opts || {}));
        }

        // our scripts / stylesheets failing to load (capture phase: these events do not bubble)
        window.addEventListener('error', function (ev) {
            try {
                var t = ev && ev.target;
                if (!t || t === window || !t.tagName) return;
                var tag = t.tagName.toUpperCase();
                var url = tag === 'SCRIPT' ? t.src : (tag === 'LINK' && /stylesheet/i.test(t.rel || '') ? t.href : '');
                if (!url || url.indexOf(location.origin) !== 0) return;
                if (navigator.onLine === false) return;
                var p = url.slice(location.origin.length).split('?')[0];
                if (!/^\/(scripts|css|apps)\//.test(p)) return;
                capture({ message: 'Failed to load ' + (tag === 'SCRIPT' ? 'script ' : 'stylesheet ') + p, fileLine: p }, { kind: 'resource' });
            } catch (e) { /* ignore */ }
        }, true);

        // console.error(..., error) from catch blocks: kind "logged" (not auto-fixed by default)
        try {
            var origConsoleError = console.error;
            if (origConsoleError && !origConsoleError.__dreamscapeCapture) {
                var wrappedConsoleError = function () {
                    try {
                        for (var i = 0; i < arguments.length; i++) {
                            var a = arguments[i];
                            if (a instanceof Error && ownFrames(a.stack).length) {
                                var note = '';
                                for (var j = 0; j < arguments.length; j++) if (typeof arguments[j] === 'string') note += (note ? ' ' : '') + arguments[j];
                                capture({ message: a.message, stack: a.stack || '' }, { kind: 'logged', error: a, source: note.slice(0, 120) || 'console.error' });
                                break;
                            }
                        }
                    } catch (e) { /* never break logging */ }
                    return origConsoleError.apply(console, arguments);
                };
                wrappedConsoleError.__dreamscapeCapture = true;
                // app-scope: allow fault capture for the page's whole life; forwards to the original
                console.error = wrappedConsoleError;
            }
        } catch (e) { /* console is read-only here */ }

        window.addEventListener('pagehide', function () { flush(true); });
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });

        return { capture: capture, captureError: captureError, markSeen: markSeen, flush: flush, _faults: function () { return faults; } };
    })();
    window.dreamscapeErrorCapture = errorCapture;

    function presentFatal(detail, context) {
        try {
            var entry = registerError(detail);
            var ctx = context || {};
            errorCapture.markSeen(ctx.error);
            // A fault in one desktop program: Vista's "<program> has stopped working" for that
            // program (programFaults.js). It stays in Spectator's list for the details.
            // The dialog saves its own report; anything else is captured here (#833).
            if (window.programFaults && window.programFaults.present(detail, context)) {
                renderErrorList();
                return;
            }
            errorCapture.capture(detail, { kind: ctx.kind || 'uncaught', error: ctx.error, source: ctx.source || '' });
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

    /**
     * A notice from the fault and boot paths. The Vista message box (showConfirmationDialog,
     * confirmationDialog.js) shows it whenever that script has loaded and no other box is up.
     * The browser's own alert() is kept as the last resort on purpose (no-native-browser-ui.mdc
     * exception): this file runs when the application failed to load, so there may be no script,
     * stylesheet or window manager of ours left to draw anything, and saying nothing is worse.
     * This is the only native dialog call left in the desktop client.
     */
    function lastResortNotice(text, title) {
        try {
            var box = document.getElementById('confirmationDialog');
            var free = !box || box.classList.contains('hidden');
            // showConfirmationDialog: public/scripts/comp/confirmationDialog.js (one dialog: a second
            // call would take it over and leave the first caller's promise unsettled, so only when free)
            if (free && typeof showConfirmationDialog === 'function' && document.body && document.body.classList.contains('desktop-mode')) {
                showConfirmationDialog(String(text), [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: title || 'Dreamscape OS' })
                    .catch(function () { /* closed */ });
                return;
            }
        } catch (e) { /* fall through to the browser's box */ }
        try {
            window.alert(`${text}`);
        } catch (e2) { /* ignore */ }
    }
    window.dreamscapeLastResortNotice = lastResortNotice;

    function repairAllScripts() {
        var urls = collectRepairUrls();
        if (!urls.length) {
            lastResortNotice('No script URLs found in the error list. Use Reinstall to reset the application.', 'Repair');
            return;
        }

        var swm = typeof serviceWorkerManager !== 'undefined' ? serviceWorkerManager : null;
        if (!swm || typeof swm.deleteAndPrecache !== 'function') {
            lastResortNotice('Service worker manager is not ready. Use Reinstall or Restart.', 'Repair');
            return;
        }

        ensureServiceWorkerReady(swm).then(function (ready) {
            if (!ready) {
                lastResortNotice('Service worker is not ready. Use Reinstall or Restart.', 'Repair');
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
            lastResortNotice('Repair failed for one or more files. Try Reinstall.', 'Repair');
        });
    }

    function restartApplication() {
        __dreamscapeFatalNavBypass = true;
        // runWinlogonPower: public/scripts/comp/winlogonPower.js
        runWinlogonPower('restart').catch(function () {
            // restartClientNavigate: public/scripts/comp/modalUtils.js
            restartClientNavigate();
        });
    }

    function retryConnectivityRecovery() {
        dismissConnectivityError();
        // manualReconnect: public/scripts/websocket.js
        if (wsClient && typeof wsClient.manualReconnect === 'function') {
            wsClient.connectionDialView = 'transient';
            wsClient.manualReconnect();
            return;
        }
        restartApplication();
    }

    function exitApplication() {
        __dreamscapeFatalNavBypass = true;
        // runWinlogonPower: public/scripts/comp/winlogonPower.js
        runWinlogonPower('shutdown');
    }

    function dismissConnectivityError() {
        if (connectivityWindowEl) {
            var el = connectivityWindowEl;
            connectivityWindowEl = null;
            try {
                // closeModal: public/scripts/comp/modalUtils.js
                if (typeof closeModal === 'function') {
                    closeModal(el).then(function () {
                        if (el.parentNode) el.parentNode.removeChild(el);
                    });
                } else if (el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            } catch (e) { /* ignore */ }
        }
        if (connectivityOverlayEl && connectivityOverlayEl.parentNode) {
            connectivityOverlayEl.parentNode.removeChild(connectivityOverlayEl);
        }
        connectivityOverlayEl = null;
    }

    function dismissConnectionDialogs() {
        var connModal = document.getElementById('connectionDialModal');
        var preStartup = document.getElementById('desktopPreStartupModal');
        try {
            // closeModal: public/scripts/comp/modalUtils.js
            if (typeof closeModal === 'function') {
                if (connModal && !connModal.classList.contains('hidden')) closeModal(connModal);
                if (preStartup && !preStartup.classList.contains('hidden')) closeModal(preStartup);
            } else {
                if (connModal) connModal.classList.add('hidden');
                if (preStartup) preStartup.classList.add('hidden');
            }
        } catch (e) { /* ignore */ }
    }

    function showConnectivitySpectatorDetail() {
        if (!connectivityDetail) return;
        if (!canUseAppErrorUI()) {
            showOverlay(connectivityDetail);
            return;
        }
        if (connectivityErrorEntry && connectivityErrorEntry.windowEl &&
            document.body.contains(connectivityErrorEntry.windowEl)) {
            var bodyEl = connectivityErrorEntry.windowEl.querySelector('.dreamscape-app-error-body');
            if (bodyEl) {
                bodyEl.innerHTML = buildStandaloneDetailHtml(connectivityDetail);
            }
            bringStandaloneToFront(connectivityErrorEntry);
            return;
        }
        connectivityErrorEntry = {
            id: null,
            detail: connectivityDetail,
            windowEl: null,
            connectivityOnly: true
        };
        createStandaloneWindow(connectivityErrorEntry);
    }

    function wireConnectivityActions(rootEl) {
        if (!rootEl) return;

        rootEl.addEventListener('click', function (ev) {
            var btn = ev.target.closest('[data-connectivity-action]');
            if (!btn) return;
            var act = btn.getAttribute('data-connectivity-action');
            if (act === 'details') {
                showConnectivitySpectatorDetail();
            } else if (act === 'retry') {
                retryConnectivityRecovery();
            } else if (act === 'restart') {
                restartApplication();
            } else if (act === 'exit') {
                exitApplication();
            }
        });

        var closeBtn = rootEl.querySelector('.dreamscape-connectivity-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                exitApplication();
            });
        }
    }

    function populateConnectivityRecoveryButton(rootEl, options) {
        var recoveryBtn = rootEl.querySelector('.dreamscape-connectivity-recovery-btn');
        if (!recoveryBtn) return;
        var isRetry = options.recoveryMode === 'retry';
        recoveryBtn.setAttribute('data-connectivity-action', isRetry ? 'retry' : 'restart');
        recoveryBtn.textContent = isRetry ? 'Retry' : 'Restart';
        recoveryBtn.title = isRetry ? 'Try connecting again' : 'Reload the application';
    }

    function populateConnectivityContent(rootEl, options) {
        var windowTitle = options.windowTitle || 'No Connection';
        var headline = options.headline || 'Could not connect';
        var simpleMessage = options.simpleMessage || 'Check your network connection and try again.';
        var detail = options.detail;

        var titleEl = rootEl.querySelector('.dreamscape-connectivity-window-title');
        if (titleEl) titleEl.textContent = windowTitle;

        var headlineEl = rootEl.querySelector('.dreamscape-connectivity-headline');
        if (headlineEl) headlineEl.textContent = headline;

        var summaryEl = rootEl.querySelector('.dreamscape-connectivity-summary');
        if (summaryEl) summaryEl.textContent = simpleMessage;

        populateConnectivityRecoveryButton(rootEl, options);
    }

    function bringConnectivityToFront() {
        if (!connectivityWindowEl) return;
        try {
            // bringModalToFront / openModal: public/scripts/comp/modalUtils.js
            if (typeof bringModalToFront === 'function') {
                bringModalToFront(connectivityWindowEl);
            } else if (typeof openModal === 'function') {
                openModal(connectivityWindowEl);
            }
        } catch (e) { /* ignore */ }
    }

    function showConnectivityWindow(options) {
        dismissConnectionDialogs();

        if (connectivityWindowEl && document.body.contains(connectivityWindowEl)) {
            populateConnectivityContent(connectivityWindowEl, options);
            bringConnectivityToFront();
            return;
        }

        if (!connectivityTemplate) {
            connectivityTemplate = document.getElementById('dreamscapeConnectivityErrorTemplate');
        }
        if (!connectivityTemplate) {
            showConnectivityOverlay(options);
            return;
        }

        var windowEl = connectivityTemplate.cloneNode(true);
        windowEl.id = 'dreamscapeConnectivityErrorWindow';
        windowEl.classList.remove('hidden');
        windowEl.dataset.windowIdentifier = 'connectivityError';

        populateConnectivityContent(windowEl, options);
        wireConnectivityActions(windowEl);

        document.body.appendChild(windowEl);
        connectivityWindowEl = windowEl;

        // openModal: public/scripts/comp/modalUtils.js
        if (typeof openModal === 'function') {
            openModal(windowEl);
        }
    }

    function showConnectivityOverlay(options) {
        dismissConnectivityError();
        dismissConnectionDialogs();

        var windowTitle = options.windowTitle || 'No Connection';
        var headline = options.headline || 'Could not connect';
        var simpleMessage = options.simpleMessage || 'Check your network connection and try again.';
        var detail = options.detail;

        var root = document.createElement('div');
        root.id = 'dreamscapeConnectivityErrorOverlay';
        root.setAttribute('role', 'alertdialog');
        root.setAttribute('aria-modal', 'true');
        root.innerHTML = (
            '<div class="dreamscape-connectivity-overlay-card">' +
            '<div class="modal-body modal-padding">' +
            '<div class="dreamscape-connectivity-message-row">' +
            '<div class="dreamscape-connectivity-icon" aria-hidden="true"><i class="fas fa-plug-circle-xmark"></i></div>' +
            '<div class="dreamscape-connectivity-message-text">' +
            '<p class="dreamscape-connectivity-headline">' + escapeHtml(headline) + '</p>' +
            '<p class="dreamscape-connectivity-summary">' + escapeHtml(simpleMessage) + '</p>' +
            '</div></div></div>' +
            '<div class="modal-footer modal-footer-colored modal-footer-padded" style="margin-top:0">' +
            '<div class="modal-footer-left">' +
            '<button type="button" class="btn-secondary btn-small" data-connectivity-action="details" title="Open technical details">Details</button>' +
            '</div>' +
            '<div class="modal-footer-right">' +
            '<button type="button" class="btn-secondary btn-small dreamscape-connectivity-recovery-btn" data-connectivity-action="restart" title="Reload the application">Restart</button>' +
            '<button type="button" class="btn-danger btn-small" data-connectivity-action="exit" title="Close the application">Shutdown</button>' +
            '</div></div></div>'
        );

        wireConnectivityActions(root);
        populateConnectivityRecoveryButton(root, options);
        document.body.appendChild(root);
        connectivityOverlayEl = root;
    }

    function presentConnectivityError(headline, simpleMessage, reason, stack, userOptions) {
        var errStack = stack || '';
        var detail = normalizeDetail(
            headline || 'Could not connect',
            reason || simpleMessage || 'Connection failed',
            '',
            '',
            '',
            errStack,
            parseScriptUrlFromStack(errStack)
        );
        var options = {
            windowTitle: 'No Connection',
            headline: headline || 'Could not connect',
            simpleMessage: simpleMessage || 'The application could not connect. Check your network and try again.',
            detail: detail,
            recoveryMode: (userOptions && userOptions.recoveryMode) || 'reload'
        };
        connectivityDetail = detail;
        connectivityErrorEntry = null;

        try {
            if (canUseConnectivityUI()) {
                showConnectivityWindow(options);
            } else {
                showConnectivityOverlay(options);
            }
        } catch (e) {
            showConnectivityOverlay(options);
        }
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

        // runWinlogonPower: public/scripts/comp/winlogonPower.js
        await runWinlogonPower('restart');
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

    // Browser notice, not an app exception. Fired when a ResizeObserver callback
    // changes layout and leftover notifications wait for the next frame.
    // Reported against the page URL at line 0 (no script stack).
    // Chrome: "ResizeObserver loop completed with undelivered notifications."
    // Older Chrome: "ResizeObserver loop limit exceeded"
    function isResizeObserverLoopNotice(message) {
        return String(message || '').indexOf('ResizeObserver loop') === 0;
    }

    function handleWindowError(msg, url, line, col, err) {
        try {
            var stack = err && err.stack ? err.stack : '';
            var message = err && err.message ? err.message : String(msg);
            if (isResizeObserverLoopNotice(message) || isResizeObserverLoopNotice(msg)) return;
            var reason = err && err.message ? err.message : String(msg);
            var errorUrl = url || parseScriptUrlFromStack(stack);
            presentFatal(normalizeDetail(message, reason, url || '', line, col, stack, errorUrl), { error: err, filename: url || '' });
        } catch (e) { /* ignore */ }
    }

    function onWindowErrorEvent(ev) {
        if (!ev || ev.defaultPrevented || ev.__dreamscapeFatalHandled) return;
        var notice = ev.message || (ev.error && ev.error.message) || '';
        if (isResizeObserverLoopNotice(notice)) {
            ev.__dreamscapeFatalHandled = true;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            return;
        }
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
            if (isResizeObserverLoopNotice(message) || isResizeObserverLoopNotice(reason)) {
                ev.preventDefault();
                return;
            }
            // already told in its own words (featureLoader.js tellCannotOpen: a program whose files could not be
            // reached while the server was away): no "has stopped working" on top
            if (r && typeof r === 'object' && r.melatonShown === true) {
                ev.preventDefault();
                return;
            }
            var errorUrl = parseScriptUrlFromStack(stack);
            presentFatal(normalizeDetail(message, reason, '', '', '', stack, errorUrl), { error: r, kind: 'rejection' });
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
                ), { kind: 'resource' });
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
        ), { kind: 'swallowed', source: 'presentDreamscapeApplicationError' });
    };

    // Boot / network connectivity failure — simple UI with expandable technical details
    window.presentDreamscapeConnectivityError = function (headline, simpleMessage, reason, stack, options) {
        presentConnectivityError(headline, simpleMessage, reason, stack, options);
    };

    window.dismissDreamscapeConnectivityError = dismissConnectivityError;

    // Defer throw so DevTools console invocation still hits the page error handler
    window.triggerTestUncaughtException = function (message) {
        var msg = message || 'Test uncaught exception — application error UI verification';
        setTimeout(function () {
            throw new Error(msg);
        }, 0);
    };
})();
