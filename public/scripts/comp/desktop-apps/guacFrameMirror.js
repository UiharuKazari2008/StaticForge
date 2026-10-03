// Runs inside Komaki's Guacamole page, not app.html. modules/guacRemoteBridge.js
// adds it to the proxied index.html as /api/desktop-guac/web/dreamscape-frame.js,
// after Guacamole's scripts and before Angular boots.
// Guacamole's status boxes (per-session status, global notifications, logged-out /
// fatal / auto-login-rejected pages) are sent to the hosting window instead of being
// drawn here: mirrorDesktopGuacFrame in public/scripts/comp/desktop-apps/guacRemote.js.
// The connection credentials form stays in the frame.
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
})();
