/**
 * State flags: classes that stand in for :has() checks Chrome would otherwise re-run on every
 * DOM change.
 *
 * A :has() whose anchor sits above busy DOM (`html:has(X) .y`, `.gallery:has(X) .item`) makes
 * Chrome re-evaluate it, and recompute style under the anchor, for every element insertion,
 * removal or textContent write below it: ~45-50 ms per DOM change for html/body anchors, ~25 ms
 * for anything inside the gallery window, ~4 ms in the taskbar (measured 2026-10-15). The CSS
 * reads these classes instead; this file keeps each one equal to its old :has() argument,
 * synchronously before the next render (MutationObserver callbacks run as microtasks), so
 * nothing paints differently.
 *
 * Flag (on)                              | old selector
 * html.has-maximized-window              | html:has(.modal.modal-maximized:not(.hidden):not(.hidden-alt))
 * html.has-maximized-gallery-window      | html:has(.gallery-window.modal-maximized.windowed)
 * html.has-maximized-photo-window        | html:has(body.desktop-mode #photoSwipeWindow.photo-swipe-window.modal-maximized.windowed)
 * html.has-desktop-mode                  | html:has(body.desktop-mode)
 * body.has-active-maximized-window       | body:has(.modal.modal-maximized.active-window:not(.hidden):not(.hidden-alt):not(.minimised))
 * body.taskbar-orb                       | body:has(#desktopTaskbar .taskbar-start-button.orb)
 * body.taskbar-luna                      | body:has(#desktopTaskbar .taskbar-start-button.luna)
 * .gallery.has-context-open-item,
 * .gallery-container-wrapper.has-context-open-item | :has(.gallery-item.context-open)
 * .desktop-taskbar.net-send / net-recv   | set from websocket.js _syncTaskbarNetFlags (not observed)
 * .desktop-taskbar.net-limited           | .desktop-taskbar:has(#taskbarWsStatus:is(.ping-response-wait, .ping-warning))
 * .modal.window-has-caption              | .modal:has(> .modal-window-title)   (CSS uses it inside :where(), same specificity)
 * .manual-preview-container.has-workspace-overlay | :has(.manual-preview-workspace-overlay:not(.hidden))
 * .manual-preview-content.has-quickstart-placeholder | :has(#manualPreviewPlaceholder.has-quickstart:not(.hidden))
 * .manual-preview-content.has-reasoning-items | :has(.progress-reasoning-container .progress-reasoning-item)
 *
 * Do not add new :has() rules anchored on html/body or on a big container with a descendant
 * part after them; add a flag here instead (scripts/test-root-state-flags.js checks html/body).
 */
(function () {
    'use strict';

    // host: 'html' | 'body' (document-wide check) or a selector (each match checks its own subtree).
    // watch: class names whose appearance or removal anywhere can change the flag.
    const FLAGS = [
        { host: 'html', className: 'has-maximized-window', selector: '.modal.modal-maximized:not(.hidden):not(.hidden-alt)', watch: ['modal'] },
        { host: 'html', className: 'has-maximized-gallery-window', selector: '.gallery-window.modal-maximized.windowed', watch: ['modal', 'gallery-window'] },
        { host: 'html', className: 'has-maximized-photo-window', selector: 'body.desktop-mode #photoSwipeWindow.photo-swipe-window.modal-maximized.windowed', watch: ['modal', 'photo-swipe-window'] },
        { host: 'html', className: 'has-desktop-mode', selector: 'body.desktop-mode', watch: [] },
        { host: 'body', className: 'has-active-maximized-window', selector: '.modal.modal-maximized.active-window:not(.hidden):not(.hidden-alt):not(.minimised)', watch: ['modal'] },
        { host: 'body', className: 'taskbar-orb', selector: '#desktopTaskbar .taskbar-start-button.orb', watch: ['taskbar-start-button'] },
        { host: 'body', className: 'taskbar-luna', selector: '#desktopTaskbar .taskbar-start-button.luna', watch: ['taskbar-start-button'] },
        { host: '.gallery, .gallery-container-wrapper', className: 'has-context-open-item', selector: '.gallery-item.context-open', watch: ['context-open', 'gallery', 'gallery-container-wrapper'] },
        { host: '.desktop-taskbar', className: 'net-limited', selector: '#taskbarWsStatus:is(.ping-response-wait, .ping-warning)', watch: ['ping-response-wait', 'ping-warning', 'desktop-taskbar'] },
        { host: '.modal', className: 'window-has-caption', selector: ':scope > .modal-window-title', watch: ['modal-window-title', 'modal'] },
        { host: '.manual-preview-container', className: 'has-workspace-overlay', selector: '.manual-preview-workspace-overlay:not(.hidden)', watch: ['manual-preview-workspace-overlay', 'manual-preview-container'] },
        { host: '.manual-preview-content', className: 'has-quickstart-placeholder', selector: '#manualPreviewPlaceholder.has-quickstart:not(.hidden)', watch: ['has-quickstart', 'manual-preview-content'] },
        { host: '.manual-preview-content', className: 'has-reasoning-items', selector: '.progress-reasoning-container .progress-reasoning-item', watch: ['progress-reasoning-item', 'progress-reasoning-container', 'manual-preview-content'] }
    ];

    FLAGS.forEach((flag) => {
        flag.watchClass = flag.watch.length
            ? new RegExp('(^|\\s)(' + flag.watch.join('|') + ')(\\s|$)')
            : null;
        flag.watchSelector = flag.watch.map((name) => '.' + name).join(', ');
    });

    // Union of every flag's watch list: most mutations (text, unrelated classes) stop at this check
    const ALL_WATCH = [...new Set(FLAGS.flatMap((flag) => flag.watch))];
    const ALL_WATCH_CLASS = new RegExp('(^|\\s)(' + ALL_WATCH.join('|') + ')(\\s|$)');
    const ALL_WATCH_SELECTOR = ALL_WATCH.map((name) => '.' + name).join(', ');

    function mutationMayMatter(mutation) {
        if (mutation.type === 'attributes') {
            return mutation.target === document.body
                || ALL_WATCH_CLASS.test(mutation.target.getAttribute('class') || '')
                || ALL_WATCH_CLASS.test(mutation.oldValue || '');
        }
        const lists = [mutation.addedNodes, mutation.removedNodes];
        for (let l = 0; l < 2; l++) {
            const nodes = lists[l] || [];
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (node.nodeType === 1 && (node.matches(ALL_WATCH_SELECTOR) || node.querySelector(ALL_WATCH_SELECTOR) !== null)) return true;
            }
        }
        return false;
    }

    function setClass(el, className, on) {
        if (el.classList.contains(className) !== on) {
            el.classList.toggle(className, on);
        }
    }

    function syncFlag(flag) {
        if (flag.host === 'html' || flag.host === 'body') {
            const target = flag.host === 'html' ? document.documentElement : document.body;
            setClass(target, flag.className, document.querySelector(flag.selector) !== null);
            return;
        }
        const hosts = document.querySelectorAll(flag.host);
        for (let i = 0; i < hosts.length; i++) {
            setClass(hosts[i], flag.className, hosts[i].querySelector(flag.selector) !== null);
        }
    }

    // Container flags: re-check only the hosts a mutation can affect (the target's host ancestors and
    // hosts inside inserted nodes), not every host in the page (there are ~90 .modal hosts).
    function syncHost(flag, host) {
        setClass(host, flag.className, host.querySelector(flag.selector) !== null);
    }

    function syncHostsAround(flag, node) {
        for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
            if (el.matches(flag.host)) syncHost(flag, el);
        }
    }

    function syncHostsWithin(flag, node) {
        if (!node || node.nodeType !== 1) return;
        if (node.matches(flag.host)) syncHost(flag, node);
        const hosts = node.querySelectorAll(flag.host);
        for (let i = 0; i < hosts.length; i++) syncHost(flag, hosts[i]);
    }

    // No argument: every flag, every host. With an element: page flags plus the container flags in
    // and around it (openModal calls this so a window built and measured in one task has its flags).
    function syncRootStateFlags(root) {
        if (!document.body) return;
        for (let i = 0; i < FLAGS.length; i++) {
            const flag = FLAGS[i];
            if (!root || flag.host === 'html' || flag.host === 'body') {
                syncFlag(flag);
            } else {
                syncHostsAround(flag, root);
                syncHostsWithin(flag, root);
            }
        }
    }

    function nodeTouchesFlag(node, flag) {
        if (!node || node.nodeType !== 1 || !flag.watchSelector) return false;
        return node.matches(flag.watchSelector) || node.querySelector(flag.watchSelector) !== null;
    }

    function mutationTouchesFlag(mutation, flag) {
        if (mutation.type === 'attributes') {
            if (mutation.target === document.body) return true;
            if (!flag.watchClass) return false;
            return flag.watchClass.test(mutation.target.getAttribute('class') || '')
                || flag.watchClass.test(mutation.oldValue || '');
        }
        const added = mutation.addedNodes;
        for (let i = 0; i < added.length; i++) {
            if (nodeTouchesFlag(added[i], flag)) return true;
        }
        const removed = mutation.removedNodes;
        for (let i = 0; i < removed.length; i++) {
            if (nodeTouchesFlag(removed[i], flag)) return true;
        }
        return false;
    }

    function onMutations(allMutations) {
        const mutations = allMutations.filter(mutationMayMatter);
        if (!mutations.length) return;
        for (let f = 0; f < FLAGS.length; f++) {
            const flag = FLAGS[f];
            const scoped = flag.host !== 'html' && flag.host !== 'body';
            for (let i = 0; i < mutations.length; i++) {
                const mutation = mutations[i];
                if (!mutationTouchesFlag(mutation, flag)) continue;
                if (!scoped || mutation.target === document.body) {
                    syncFlag(flag);
                    break;
                }
                syncHostsAround(flag, mutation.target);
                const added = mutation.addedNodes || [];
                for (let n = 0; n < added.length; n++) syncHostsWithin(flag, added[n]);
            }
        }
    }

    function start() {
        syncRootStateFlags();
        new MutationObserver(onMutations).observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class'],
            attributeOldValue: true
        });
    }

    function setDesktopTaskbarNetFlags(flags) {
        const bar = document.querySelector('.desktop-taskbar');
        if (!bar) return;
        setClass(bar, 'net-send', !!flags.send);
        setClass(bar, 'net-recv', !!flags.recv);
        if (flags.limited !== undefined) setClass(bar, 'net-limited', !!flags.limited);
    }

    window.syncRootStateFlags = syncRootStateFlags;
    window.setDesktopTaskbarNetFlags = setDesktopTaskbarNetFlags;

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
