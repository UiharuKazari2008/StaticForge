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
 * #modemTrayIconGlyph[data-net=send|recv] | set from websocket.js _syncTaskbarNetFlags (not observed)
 * .desktop-taskbar.net-limited           | set from websocket.js _syncTaskbarNetFlags (not observed). It followed the
 *                                          ping dot until #998; since #895 the globe is the computer's own link, and the
 *                                          two writers flipped the taskbar's class at every traffic blink
 * .modal.window-has-caption              | .modal:has(> .modal-window-title)   (CSS uses it inside :where(), same specificity)
 * .manual-preview-container.has-workspace-overlay | :has(.manual-preview-workspace-overlay:not(.hidden))
 * .manual-preview-content.has-quickstart-placeholder | :has(#manualPreviewPlaceholder.has-quickstart:not(.hidden))
 * .manual-preview-content.has-reasoning-items | :has(.progress-reasoning-container .progress-reasoning-item)
 * .modal.push-button-focused             | .modal:has(button:focus:is(<push button>):not(<default/tab/...>))
 *                                          (focusin/focusout, not observed; used as :not(.modal.push-button-focused *),
 *                                          whose :has() form cost ~220 ms per change inside the gallery, #647)
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
        { host: '.modal', className: 'window-has-caption', selector: ':scope > .modal-window-title', watch: ['modal-window-title', 'modal'] },
        { host: '.manual-preview-container', className: 'has-workspace-overlay', selector: '.manual-preview-workspace-overlay:not(.hidden)', watch: ['manual-preview-workspace-overlay', 'manual-preview-container'] },
        { host: '.manual-preview-content', className: 'has-quickstart-placeholder', selector: '#manualPreviewPlaceholder.has-quickstart:not(.hidden)', watch: ['has-quickstart', 'manual-preview-content'] },
        { host: '.manual-preview-content', className: 'has-reasoning-items', selector: '.progress-reasoning-container .progress-reasoning-item', watch: ['progress-reasoning-item', 'progress-reasoning-container', 'manual-preview-content'] }
    ];

    FLAGS.forEach((flag) => {
        flag.watchSelector = flag.watch.map((name) => '.' + name).join(', ');
        // every class its host or selector names: a class change can move the flag only through one of these
        flag.tokens = new Set(((flag.host + ' ' + flag.selector).match(/\.[\w-]+/g) || []).map((t) => t.slice(1)));
    });

    // The class tokens a class mutation changed (old value against the current one). With several records
    // for one element in a batch, the first record's set holds the net change, so nothing is missed (#998).
    function changedClassTokens(mutation) {
        const split = (v) => new Set(String(v || '').split(/\s+/).filter(Boolean));
        const before = split(mutation.oldValue);
        const after = split(mutation.target.getAttribute('class'));
        const out = [];
        for (const t of before) if (!after.has(t)) out.push(t);
        for (const t of after) if (!before.has(t)) out.push(t);
        return out;
    }

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
        if (root && root.nodeType === 1) {
            syncWindowChrome(root.closest('.modal'));
            syncWindowChromeWithin(root);
        } else {
            const modals = document.getElementsByClassName('modal');
            for (let i = 0; i < modals.length; i++) syncWindowChrome(modals[i]);
        }
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

    // ---- Window chrome: the active state on the parts that draw it -------------------------------
    // .window-inactive on a window's own title bar, its toolbar / main / controls and the Director's
    // command bar = the window lacks .active-window; .dialog-active on a light / Vista dialog (or one
    // holding .win7 content) = it is the active one. The CSS reads these instead of
    // .modal(:not)(.active-window): Chrome builds a class's invalidation set from the rightmost parts of
    // every rule naming it, so ".modal:not(.active-window) .modal-window-title-toolbar > .btn-secondary"
    // and ".modal-window-title-main span" made every .btn-* / span / button / i / img in a window a
    // candidate at each focus change: ~630-1,330 elements restyled per window click on Modernia, Studio
    // 1,237 of them (Nov 19 2026). A title bar is a few dozen elements.
    const WINDOW_CHROME = '.modal-window-title, .modal-window-title-toolbar, .modal-window-title-main, .modal-window-controls, .director-window-command-bar';
    const DIALOG_WINDOW = '[data-window-client="light"], [data-vista-dialog]';
    const ACTIVE_RE = /(^|\s)active-window(\s|$)/;

    function syncWindowChrome(modal) {
        if (!modal || modal.nodeType !== 1 || !modal.classList.contains('modal')) return;
        const inactive = !modal.classList.contains('active-window');
        const hosts = modal.querySelectorAll(WINDOW_CHROME);
        for (let i = 0; i < hosts.length; i++) {
            // a window inside this one has its own chrome and state
            if (hosts[i].closest('.modal') === modal) setClass(hosts[i], 'window-inactive', inactive);
        }
        const dialog = modal.matches(DIALOG_WINDOW) || modal.classList.contains('win7') || modal.querySelector('.win7') !== null;
        setClass(modal, 'dialog-active', dialog && !inactive);
    }

    function syncWindowChromeWithin(node) {
        if (!node || node.nodeType !== 1) return;
        if (node.classList.contains('modal')) syncWindowChrome(node);
        else if (node.matches(WINDOW_CHROME) || node.querySelector(WINDOW_CHROME) !== null) syncWindowChrome(node.closest('.modal'));
        const inner = node.getElementsByClassName('modal');
        for (let i = 0; i < inner.length; i++) syncWindowChrome(inner[i]);
    }

    function windowChromeMutation(mutation) {
        if (mutation.type === 'attributes') {
            const target = mutation.target;
            if (target.classList && target.classList.contains('modal')
                && ACTIVE_RE.test(mutation.oldValue || '') !== target.classList.contains('active-window')) {
                syncWindowChrome(target);
            }
            return;
        }
        const added = mutation.addedNodes || [];
        for (let i = 0; i < added.length; i++) syncWindowChromeWithin(added[i]);
    }

    function nodeTouchesFlag(node, flag) {
        if (!node || node.nodeType !== 1 || !flag.watchSelector) return false;
        return node.matches(flag.watchSelector) || node.querySelector(flag.watchSelector) !== null;
    }

    function mutationTouchesFlag(mutation, flag, changed) {
        if (mutation.type === 'attributes') {
            // Only a class the flag names can move it. Any class change on a window used to re-run the
            // three document-wide maximized-window queries (each focus click, #998); a <body> class
            // change used to re-check every flag (137 ms of a phone boot, #817).
            for (let i = 0; i < changed.length; i++) if (flag.tokens.has(changed[i])) return true;
            return false;
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
        for (let i = 0; i < allMutations.length; i++) windowChromeMutation(allMutations[i]);
        const mutations = allMutations.filter(mutationMayMatter);
        if (!mutations.length) return;
        const changed = mutations.map((m) => (m.type === 'attributes' ? changedClassTokens(m) : null));
        for (let f = 0; f < FLAGS.length; f++) {
            const flag = FLAGS[f];
            const scoped = flag.host !== 'html' && flag.host !== 'body';
            for (let i = 0; i < mutations.length; i++) {
                const mutation = mutations[i];
                if (!mutationTouchesFlag(mutation, flag, changed[i])) continue;
                if (!scoped) {
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

    // Traffic lights the tray globe several times a second: the flag sits on the glyph itself
    // (data-net), not on .desktop-taskbar, whose class flips restyled every taskbar icon
    // (idle perf pass 2026-11-04). Both ways at once shows receiving, as the old class rules did.
    let netGlyph = null;
    let netBar = null;
    function setDesktopTaskbarNetFlags(flags) {
        // no taskbar on Melaton Mobile (#849)
        if (window.uiShell === 'mobile') return;
        if (!netGlyph || !netGlyph.isConnected) netGlyph = document.getElementById('modemTrayIconGlyph');
        if (netGlyph) {
            const net = flags.recv ? 'recv' : (flags.send ? 'send' : '');
            if ((netGlyph.getAttribute('data-net') || '') !== net) {
                if (net) netGlyph.setAttribute('data-net', net);
                else netGlyph.removeAttribute('data-net');
            }
        }
        if (flags.limited !== undefined) {
            // the taskbar is one element for the life of the page: looked up once, not per message
            if (!netBar || !netBar.isConnected) netBar = document.querySelector('.desktop-taskbar');
            if (netBar) setClass(netBar, 'net-limited', !!flags.limited);
        }
    }

    // .modal.push-button-focused: every .modal around a focused non-default push button (Vista moves the
    // default ring to it, vista-glass-controls.css). Focus is not a mutation, so it follows focusin /
    // focusout: the element gaining focus is the event target, or relatedTarget when focus leaves.
    const PUSH_BUTTON_FOCUSED = 'push-button-focused';
    const PUSH_BUTTON_SELECTOR = 'button:is(.btn-secondary, .btn-danger, .btn-warning, .btn-standard, .btn, .cpl-wu-button, .tbp-button, :not([class])):not(.btn-primary, [data-dialog-primary="1"], .primary, [role="tab"], [role="menuitem"], .round-button, .close-btn, .custom-dropdown-btn, .hover-show, .toolbar-btn, .explorer-command-btn)';
    let pushButtonFocusModals = [];

    function syncPushButtonFocus(focused) {
        const next = [];
        if (focused && focused.nodeType === 1 && focused.matches(PUSH_BUTTON_SELECTOR)) {
            for (let m = focused.closest('.modal'); m; m = m.parentElement && m.parentElement.closest('.modal')) next.push(m);
        }
        for (let i = 0; i < pushButtonFocusModals.length; i++) {
            if (!next.includes(pushButtonFocusModals[i])) setClass(pushButtonFocusModals[i], PUSH_BUTTON_FOCUSED, false);
        }
        for (let i = 0; i < next.length; i++) setClass(next[i], PUSH_BUTTON_FOCUSED, true);
        pushButtonFocusModals = next;
    }

    document.addEventListener('focusin', (event) => syncPushButtonFocus(event.target), true);
    document.addEventListener('focusout', (event) => syncPushButtonFocus(event.relatedTarget), true);

    window.syncRootStateFlags = syncRootStateFlags;
    // a window's dialog-ness changed without an active-window flip (vistaDialogs.js tags / untags a message box, #1059: the
    // box was already the active window when it was tagged, so .dialog-active never came and its default button never glowed)
    // (on the existing export, no page global of its own: window.syncRootStateFlags.windowChrome(modal))
    syncRootStateFlags.windowChrome = (modal) => syncWindowChrome(modal);
    window.setDesktopTaskbarNetFlags = setDesktopTaskbarNetFlags;

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
