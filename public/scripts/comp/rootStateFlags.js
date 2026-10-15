/**
 * Root state flags: classes on <html> / <body> that stand in for document-wide :has() checks.
 *
 * A non-subject `html:has(X) .y` or `body:has(X) .y` rule makes Chrome flag the root as a :has()
 * anchor, and from then on every element insertion, removal or textContent write anywhere in the
 * page re-evaluates it and recomputes style for the whole document (~45-50 ms per DOM change on
 * the desktop, measured 2026-10-15). The CSS reads these classes instead; this file keeps each
 * one equal to its old :has() argument, synchronously before the next render (MutationObserver
 * callbacks run as microtasks), so nothing paints differently.
 *
 * Flag                                   | old selector
 * html.has-maximized-window              | html:has(.modal.modal-maximized:not(.hidden):not(.hidden-alt))
 * html.has-maximized-gallery-window      | html:has(.gallery-window.modal-maximized.windowed)
 * html.has-maximized-photo-window        | html:has(body.desktop-mode #photoSwipeWindow.photo-swipe-window.modal-maximized.windowed)
 * body.has-active-maximized-window       | body:has(.modal.modal-maximized.active-window:not(.hidden):not(.hidden-alt):not(.minimised))
 * body.taskbar-orb                       | body:has(#desktopTaskbar .taskbar-start-button.orb)
 * body.taskbar-luna                      | body:has(#desktopTaskbar .taskbar-start-button.luna)
 * html.has-desktop-mode                  | html:has(body.desktop-mode)
 *
 * Subject-position html/body :has() (`body:has(x) { --var }`) costs ~4 ms per DOM change too.
 * Do not add new html/body-anchored :has() rules; add a flag here instead.
 */
(function () {
    'use strict';

    const FLAGS = [
        { root: 'html', className: 'has-maximized-window', selector: '.modal.modal-maximized:not(.hidden):not(.hidden-alt)' },
        { root: 'html', className: 'has-maximized-gallery-window', selector: '.gallery-window.modal-maximized.windowed' },
        { root: 'html', className: 'has-maximized-photo-window', selector: 'body.desktop-mode #photoSwipeWindow.photo-swipe-window.modal-maximized.windowed' },
        { root: 'body', className: 'has-active-maximized-window', selector: '.modal.modal-maximized.active-window:not(.hidden):not(.hidden-alt):not(.minimised)' },
        { root: 'body', className: 'taskbar-orb', selector: '#desktopTaskbar .taskbar-start-button.orb' },
        { root: 'body', className: 'taskbar-luna', selector: '#desktopTaskbar .taskbar-start-button.luna' },
        { root: 'html', className: 'has-desktop-mode', selector: 'body.desktop-mode' }
    ];

    // Classes whose presence on an element can change a flag above
    const RELEVANT_CLASS = /(^|\s)(modal|gallery-window|photo-swipe-window|taskbar-start-button)(\s|$)/;
    const RELEVANT_SELECTOR = '.modal, .gallery-window, .photo-swipe-window, .taskbar-start-button';

    function syncRootStateFlags() {
        const body = document.body;
        if (!body) return;
        for (let i = 0; i < FLAGS.length; i++) {
            const flag = FLAGS[i];
            const target = flag.root === 'html' ? document.documentElement : body;
            const on = document.querySelector(flag.selector) !== null;
            if (target.classList.contains(flag.className) !== on) {
                target.classList.toggle(flag.className, on);
            }
        }
    }

    function isRelevantNode(node) {
        if (!node || node.nodeType !== 1) return false;
        return node.matches(RELEVANT_SELECTOR) || node.querySelector(RELEVANT_SELECTOR) !== null;
    }

    function isRelevantMutation(mutation) {
        if (mutation.type === 'attributes') {
            const target = mutation.target;
            if (target === document.body) return true;
            return RELEVANT_CLASS.test(target.getAttribute('class') || '')
                || RELEVANT_CLASS.test(mutation.oldValue || '');
        }
        const added = mutation.addedNodes;
        for (let i = 0; i < added.length; i++) {
            if (isRelevantNode(added[i])) return true;
        }
        const removed = mutation.removedNodes;
        for (let i = 0; i < removed.length; i++) {
            if (isRelevantNode(removed[i])) return true;
        }
        return false;
    }

    function start() {
        syncRootStateFlags();
        const observer = new MutationObserver((mutations) => {
            for (let i = 0; i < mutations.length; i++) {
                if (isRelevantMutation(mutations[i])) {
                    syncRootStateFlags();
                    return;
                }
            }
        });
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class'],
            attributeOldValue: true
        });
    }

    window.syncRootStateFlags = syncRootStateFlags;

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
