// Runs inside Komaki's Guacamole page, not app.html. modules/guacRemoteBridge.js
// adds it to the proxied index.html as /api/desktop-guac/web/dreamscape-frame.js,
// after Guacamole's scripts and before Angular boots.
// Guacamole's status boxes (per-session status, global notifications, logged-out /
// fatal / auto-login-rejected pages) are sent to the hosting window instead of being
// drawn here: mirrorDesktopGuacFrame in public/scripts/comp/desktop-apps/guacRemote.js.
// The connection credentials form stays in the frame.
// dreamscapeGuac (toggleMenu, disconnect, refresh, paste, upload) is the session
// toolbar in guacRemote.js. Last-frame JPEGs post to /api/desktop-guac/preview/:id.
// A blob download goes to the VFS Downloads folder when desktopGuacDownloadTarget is vfs.
(function () {
    // Opened outside a Dreamscape window: leave Guacamole as it is
    const host = frameElement;
    if (!host) return;

    const PAGE_MODALS = ['logged-out-modal', 'fatal-page-error-modal', 'automatic-login-rejected-modal'];
    const send = (kind, payload) => parent.mirrorDesktopGuacFrame(host, kind, payload);
    let nextId = 1;

    const index = angular.module('index');

    // Translates a Guacamole Notification and keeps its countdown running, since the
    // guac-notification directive that normally runs it is no longer rendered.
    index.factory('dreamscapeMirror', ['$translate', '$interval', '$rootScope', function ($translate, $interval, $rootScope) {
        return function (kind, onDismiss) {
            let current = null;
            let payload = null;
            let timer = null;
            return function show(status, fields) {
                if (status === current) {
                    if (fields) send(kind, Object.assign(payload || { id: null }, fields));
                    return;
                }
                current = status;
                if (timer) $interval.cancel(timer);
                timer = null;
                payload = Object.assign({ id: null }, fields);
                if (!status) {
                    send(kind, payload);
                    return;
                }
                const actions = status.actions || [];
                const countdown = status.countdown;
                const keys = [status.title, status.text && status.text.key].concat(actions.map((action) => action.name)).filter(Boolean);
                $translate(keys, status.text && status.text.variables).then((strings) => {
                    if (current !== status) return;
                    Object.assign(payload, {
                        id: nextId++,
                        className: status.className || '',
                        title: status.title ? strings[status.title] : '',
                        text: status.text ? strings[status.text.key] : '',
                        countdown: '',
                        actions: actions.map((action) => ({
                            label: strings[action.name],
                            className: action.className || '',
                            run: () => $rootScope.$apply(action.callback)
                        })),
                        dismiss: onDismiss ? () => $rootScope.$apply(onDismiss) : null
                    });
                    if (!countdown) {
                        send(kind, payload);
                        return;
                    }
                    let remaining = countdown.remaining;
                    const tick = () => $translate(countdown.text, { REMAINING: remaining }).then((text) => {
                        if (current !== status) return;
                        payload.countdown = text;
                        send(kind, payload);
                    });
                    tick();
                    timer = $interval(() => {
                        remaining--;
                        if (remaining <= 0) countdown.callback();
                        else tick();
                    }, 1000, remaining);
                });
            };
        };
    }]);

    index.config(['$provide', function ($provide) {
        $provide.decorator('guacClientNotificationDirective', ['$delegate', function ($delegate) {
            const directive = $delegate[0];
            const deps = directive.controller.slice(0, -1);
            const controller = directive.controller[deps.length];
            delete directive.templateUrl;
            directive.template = '<div class="client-status-modal" ng-class="{ shown: status.className === \'parameters-required\' }">'
                + '<guac-modal ng-if="status.className === \'parameters-required\'"><guac-notification notification="status"></guac-notification></guac-modal>'
                + '</div>';
            directive.controller = deps.concat(['dreamscapeMirror', function () {
                const args = Array.prototype.slice.call(arguments);
                const show = args.pop()('client');
                controller.apply(this, args);
                const $scope = args[deps.indexOf('$scope')];
                $scope.$watchGroup(['client.clientState.connectionState', 'status'], (values) => {
                    const status = values[1];
                    show(status && status.className !== 'parameters-required' ? status : null, { state: values[0] });
                });
                $scope.$on('$destroy', () => show(null, { state: null }));
            }]);
            return $delegate;
        }]);

        $provide.decorator('guacNotification', ['$delegate', 'dreamscapeMirror', function ($delegate, dreamscapeMirror) {
            let shown = false;
            const show = dreamscapeMirror('global', () => $delegate.showStatus(false));
            // Same rule as Guacamole's showStatus: the first status stays until cleared
            $delegate.showStatus = (status) => {
                if (shown && status) return;
                shown = status || false;
                show(status || null);
            };
            return $delegate;
        }]);

        // Page states are index.html markup, so they are read from their rendered text
        $provide.decorator('guacModalDirective', ['$delegate', function ($delegate) {
            const directive = $delegate[0];
            const compile = directive.compile;
            directive.compile = function () {
                const link = compile ? compile.apply(this, arguments) : null;
                return function (scope, element) {
                    if (link) (link.post || link).apply(this, arguments);
                    const box = element.parent()[0];
                    if (!box || !PAGE_MODALS.some((name) => box.classList.contains(name))) return;
                    const modal = element[0];
                    modal.style.display = 'none';
                    const id = nextId++;
                    const read = () => {
                        const heading = modal.querySelector('h1, h2, h3');
                        send('page', {
                            id: id,
                            className: box.classList.contains('fatal-page-error-modal') ? 'error' : '',
                            title: heading ? heading.textContent.trim() : '',
                            text: Array.from(modal.querySelectorAll('p'))
                                .filter((p) => !p.querySelector('button'))
                                .map((p) => p.textContent.trim())
                                .filter(Boolean)
                                .join(' '),
                            countdown: '',
                            actions: Array.from(modal.querySelectorAll('button')).map((button) => ({
                                label: button.textContent.trim(),
                                className: '',
                                run: () => button.click()
                            })),
                            dismiss: null
                        });
                    };
                    const observer = new MutationObserver(read);
                    observer.observe(modal, { childList: true, subtree: true, characterData: true });
                    read();
                    scope.$on('$destroy', () => {
                        observer.disconnect();
                        send('page', { id: null });
                    });
                };
            };
            return $delegate;
        }]);
    }]);

    function clientScope() {
        const el = document.querySelector('.client-view');
        if (!el) return null;
        let scope = angular.element(el).scope();
        while (scope && !scope.menu) scope = scope.$parent;
        return scope;
    }

    function connectionId() {
        const scope = clientScope();
        const id = scope && scope.focusedClient && scope.focusedClient.id;
        return id ? String(id) : '';
    }

    function capturePreview() {
        const scope = clientScope();
        const managed = scope && scope.focusedClient;
        const client = managed && managed.client;
        if (!client || !client.getDisplay) return;
        const state = managed.clientState && managed.clientState.connectionState;
        if (state !== 'CONNECTED') return;
        const display = client.getDisplay();
        if (!display || !display.getWidth()) return;
        const flat = display.flatten();
        if (!flat || !flat.width || !flat.height) return;
        const id = connectionId();
        if (!id) return;
        const scale = Math.min(1, 480 / flat.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(flat.width * scale));
        canvas.height = Math.max(1, Math.round(flat.height * scale));
        canvas.getContext('2d').drawImage(flat, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
            if (!blob) return;
            fetch('/api/desktop-guac/preview/' + encodeURIComponent(id), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'image/jpeg' },
                body: blob
            }).then((response) => {
                if (!response.ok) return;
                // noteDesktopGuacPreview: public/scripts/comp/desktop-apps/guacRemote.js
                if (parent.noteDesktopGuacPreview) parent.noteDesktopGuacPreview(id);
            }).catch(() => {});
        }, 'image/jpeg', 0.72);
    }

    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        const href = String(this.href || '');
        const toFolder = this.hasAttribute('download') && href.indexOf('blob:') === 0
            && localStorage.getItem('desktopGuacDownloadTarget') === 'vfs';
        if (!toFolder) return anchorClick.apply(this, arguments);
        const name = this.getAttribute('download') || 'download';
        const workspaceId = parent.currentWorkspace
            || (parent.desktopShortcuts && parent.desktopShortcuts.currentWorkspace)
            || '';
        if (!workspaceId) return anchorClick.apply(this, arguments);
        fetch(href).then((response) => response.blob()).then((blob) => fetch('/api/desktop-guac/download', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/octet-stream',
                'X-Filename': encodeURIComponent(name),
                'X-Workspace-Id': workspaceId
            },
            body: blob
        })).then((response) => response.json().catch(() => null)).then((payload) => {
            // noteDesktopGuacDownload: public/scripts/comp/desktop-apps/guacRemote.js
            if (parent.noteDesktopGuacDownload) parent.noteDesktopGuacDownload(payload, name);
        }).catch(() => {
            if (parent.noteDesktopGuacDownload) parent.noteDesktopGuacDownload(null, name);
        });
    };

    // Published on the frame window so the Dreamscape session toolbar can call it.
    window.dreamscapeGuac = {
        toggleMenu: function () {
            const scope = clientScope();
            if (!scope || !scope.menu) return false;
            scope.$apply(() => { scope.menu.shown = !scope.menu.shown; });
            return true;
        },
        disconnect: function () {
            const scope = clientScope();
            if (!scope || !scope.disconnect) return false;
            scope.$apply(() => scope.disconnect());
            return true;
        },
        refresh: function () {
            const scope = clientScope();
            const client = scope && scope.focusedClient && scope.focusedClient.client;
            if (!client || !client.getDisplay || !client.sendSize) return false;
            const display = client.getDisplay();
            const width = display.getWidth();
            const height = display.getHeight();
            if (!width || !height) return false;
            const proto = (frameElement && frameElement.dataset.protocol) || '';
            if (proto === 'ssh' || proto === 'telnet' || proto === 'kubernetes') {
                client.sendSize(width, height);
                return true;
            }
            client.sendSize(Math.max(1, width - 1), height);
            setTimeout(() => client.sendSize(width, height), 80);
            return true;
        },
        paste: function (text) {
            const injector = angular.element(document.body).injector();
            if (!injector) return false;
            const root = injector.get('$rootScope');
            root.$apply(() => root.$broadcast('guacClipboard', String(text || '')));
            return true;
        },
        upload: function (files) {
            const scope = clientScope();
            const list = scope && scope.focusedClient && scope.focusedClient.filesystems;
            if (!scope || !list || !list.length) return false;
            const batch = Array.prototype.slice.call(files || []);
            if (!batch.length) return false;
            scope.$apply(() => {
                scope.showFilesystemMenu(list[0]);
                scope.uploadFiles(batch);
            });
            return true;
        }
    };

    setInterval(capturePreview, 8000);
})();
