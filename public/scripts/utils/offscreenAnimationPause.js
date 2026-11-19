/**
 * Pause looping CSS animations while their element is outside the viewport.
 *
 * Chrome cannot composite an animation it judges to have no visible change (an element laid out
 * off-screen), so it runs it on the main thread instead: a style pass, pre-paint and commit every
 * frame, ~60 fps, for something nobody can see (measured 2026-10-16: three typing dots parked
 * off-screen = 118 main-thread frames in 2.5 s; on-screen, hidden, zero-size or scrolled out of
 * a scroller = 5-16). Yukimi's Director-turn trace showed exactly that pattern: 7 elements
 * restyled per frame, no paint, ~35 fps for the whole turn.
 *
 * Every element that starts an infinite animation is watched with one IntersectionObserver;
 * outside the viewport (plus a margin) it gets .offscreen-paused (public/css/hidden.css:
 * animation-play-state: paused), and the class comes off as soon as it is back in view. A
 * looping animation resumes from where it paused, which is invisible.
 *
 * One-shot animations (gallery fade-in, Director row arrive, context menus) are ignored so
 * they do not join the observer. Class toggles are flushed on rAF; which elements loop is checked
 * when the page is idle (never inside the animation events: getAnimations() forces a style pass).
 *
 * The second half of this file is the animation watchdog (window.animationWatchdog, #930): it finds
 * animations that run unseen or without end, pauses the unseen ones and reports them to the server's
 * fault reports. It lives here, not in its own file, so a cached app.html gets it with a normal update.
 */
(function () {
    'use strict';

    if (typeof IntersectionObserver !== 'function') return;

    const PAUSED_CLASS = 'offscreen-paused';
    const watched = new WeakSet();
    const pending = [];
    let flushRaf = 0;
    const SKIP_ANIMATION = {
        'fade-in': true,
        'fadeIn': true,
        'slide-in': true,
        'slideIn': true,
        'director-row-arrive': true,
        'director-composer-fade-in': true,
        'submenuFadeIn': true,
        'contextMenuFadeIn': true,
        'contextMenuFadeOut': true,
        'confettiFall': true,
        'sakuraPetalFall': true
    };

    const io = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
            const el = entries[i].target;
            const off = !entries[i].isIntersecting;
            if (el.classList.contains(PAUSED_CLASS) !== off) pending.push([el, off]);
        }
        if (!pending.length || flushRaf) return;
        flushRaf = requestAnimationFrame(() => {
            flushRaf = 0;
            for (let i = 0; i < pending.length; i++) {
                const pair = pending[i];
                if (!watched.has(pair[0])) continue;
                if (pair[0].classList.contains(PAUSED_CLASS) !== pair[1]) {
                    pair[0].classList.toggle(PAUSED_CLASS, pair[1]);
                }
            }
            pending.length = 0;
        });
    }, { rootMargin: '64px' });

    function hasInfiniteAnimation(el) {
        if (typeof el.getAnimations !== 'function') return false;
        const list = el.getAnimations();
        for (let i = 0; i < list.length; i++) {
            const effect = list[i].effect;
            if (effect && effect.target === el && effect.getTiming().iterations === Infinity) return true;
        }
        return false;
    }

    function watch(el) {
        if (!el || el.nodeType !== 1 || watched.has(el) || !hasInfiniteAnimation(el)) return;
        watched.add(el);
        io.observe(el);
    }

    function unwatchIfDone(el) {
        if (!el || !watched.has(el) || (el.isConnected && hasInfiniteAnimation(el))) return;
        watched.delete(el);
        io.unobserve(el);
        if (el.classList.contains(PAUSED_CLASS)) el.classList.remove(PAUSED_CLASS);
    }

    // The checks run later, batched, when the page is idle: el.getAnimations() inside the event made the browser
    // restyle the page on the spot, in the middle of the frames that started the animation (A53, the return to
    // Today: 54 ms of forced style through the entrance's rise, Nov 18). A loop off-screen for a moment longer
    // before it pauses costs nothing anyone sees.
    const toCheck = new Set();
    let checkQueued = false;
    const whenIdle = typeof requestIdleCallback === 'function'
        ? (fn) => requestIdleCallback(fn, { timeout: 1000 })
        : (fn) => setTimeout(fn, 250);
    function runChecks() {
        checkQueued = false;
        const list = Array.from(toCheck);
        toCheck.clear();
        for (let i = 0; i < list.length; i++) {
            const el = list[i];
            if (watched.has(el)) unwatchIfDone(el);
            else if (el.isConnected) watch(el);
        }
    }
    function checkLater(event) {
        if (SKIP_ANIMATION[event.animationName]) return;
        const el = event.target;
        if (!el || el.nodeType !== 1) return;
        toCheck.add(el);
        if (!checkQueued) { checkQueued = true; whenIdle(runChecks); }
    }
    function onAnimationEvent(event) {
        if (event.type === 'animationstart') watchdogNoteStart(event.animationName);
        checkLater(event);
    }
    document.addEventListener('animationstart', onAnimationEvent, true);
    document.addEventListener('animationend', onAnimationEvent, true);
    document.addEventListener('animationcancel', onAnimationEvent, true);

    // Animations that started before this script ran. Not while the page is still being parsed:
    // document.getAnimations() makes the browser style the half-built document on the spot
    // (~75 ms of a phone boot, #817). In the first frame after the document is in, that style
    // work is the frame's own; anything starting in between fires animationstart above.
    if (typeof document.getAnimations === 'function') {
        const sweep = () => requestAnimationFrame(() => {
            document.getAnimations().forEach((animation) => {
                const target = animation.effect && animation.effect.target;
                if (target) watch(target);
            });
        });
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep, { once: true });
        else sweep();
    }

    // =====================================================================================================
    // Animation watchdog (Yozora #930, Yukimi Nov 19 2026: "fix all the CSS animation issues where they're
    // allowed to keep running without any regulation ... monitor for animations that have been running and
    // have not stopped, or animations that are running on a hidden element ... report them to the server").
    //
    // Why: any running animation keeps the compositor ticking on every display refresh, whatever it shows.
    // Measured Nov 19 on an idle desktop (5 s, 60 Hz; nothing running = 59 compositor frames, 49 ms of
    // compositor thread): one infinite animation that is visible 263 frames / 354 ms; under opacity 0
    // 297 / 250 ms; off screen 281 / 225 ms; covered by something opaque 259 / 298 ms (and drawn every
    // frame); a steps() clock hand 300 / 118 ms. Only display: none, visibility: hidden and
    // content-visibility: hidden stop the ticking (26-72 frames), so those states are left alone.
    //
    // What it does, for every shell (desktop, phone, DreamOS), each scan:
    //   (a) hidden   a looping or long animation whose target cannot be seen (an ancestor at opacity 0,
    //                off screen, zero size, behind another window's opaque content, or a script-driven
    //                animation while the page sleeps) is PAUSED here at once and reported when it has
    //                stayed hidden for REPORT_AFTER_MS. A looping script animation whose element was taken out of
    //                the page without cancel() keeps ticking for good (the timeline keeps it alive and
    //                document.getAnimations() no longer lists it): the ones a scan saw are remembered,
    //                paused when their element is gone, and cancelled after DETACHED_SCANS scans;
    //   (b) endless  a looping animation (or one with over LONG_MS left) that has run for LONG_MS in
    //                view and is not in ALLOW below is reported; it is not touched;
    //   (c) restarts one animation name started RESTART_MAX times between two scans is reported.
    //
    // Cost: no per-frame work and no timer under 60 s. A scan is one document.getAnimations() plus a few
    // reads per running animation, in requestIdleCallback. It runs after something was hidden or shown
    // (visibilitychange, the phone's screen and wmawake / wmAppChange, a window opened, closed, minimised
    // or restored: taskbarWindowsUpdated, the screen saver's cover: melatoncover, animationWatchdog.check()
    // from a feature), and from one 60 s timer that is armed only while the page is seen AND an animation
    // started since the last scan or the last scan found one running. A still page has no timer at all.
    // There is no Worker: getAnimations() and the visibility reads exist only on the main thread, and what
    // is left (grouping a handful of rows) is microseconds; a worker would cost a thread and memory to save
    // nothing.
    //
    // Pausing safely:
    //   - only loops and animations with over LONG_MS left are paused, never a short one-shot (code waits
    //     for their animationend: a window minimising, a row arriving);
    //   - a CSS animation is paused with the .offscreen-paused class on its element (hidden.css:
    //     animation-play-state: paused, also for its ::before / ::after), never with animation.pause():
    //     that would cut the animation loose from the animation-play-state its own code sets. Taking the
    //     class off resumes it where it stood; code that rewrites className just loses the class and the
    //     next scan sets it again;
    //   - a script (Web Animations) animation is paused with pause() and resumed with play() only if it is
    //     still paused and still the one this file paused;
    //   - transitions are never touched;
    //   - while anything is held, a MutationObserver watches the attributes of the held element's
    //     ancestors and of the window that covers it, and pointerup / keyup / transitionrun are heard: any
    //     of them rescans within RECHECK_MS, so a spinner that comes into view does not stay frozen. The
    //     observer and the listeners exist only while something is held.
    //
    // Reports go through the fault pipeline (window.dreamscapeErrorCapture, kind 'animation' ->
    // POST /api/fault-reports -> data/fault-reports, modules/programFaultReports.js), grouped by owner +
    // animation name + target + reason, so they show in Problem Reports and Solutions with the faults and
    // can be handed to the fixer. At most MAX_GROUPS groups per page load; a group is sent once per load.
    //
    //   animationWatchdog.check(reason)   ask for a scan soon (a feature that just hid or showed something)
    //   animationWatchdog.status()        { scans, running, held, reported, lastScanMs, timer }
    //   animationWatchdog.scan()          scan now and return the findings (tests, DevTools)
    // =====================================================================================================
    const LONG_MS = 120000;       // "has not stopped": two minutes of running in view
    const PERIOD_MS = 60000;      // the only repeating timer, and only while there is something to watch
    const EVENT_GAP_MS = 5000;    // scans asked for by show / hide events are at least this far apart
    const RECHECK_MS = 400;       // ... or this far, while something is held paused (it may have come into view)
    const RESTART_MAX = 60;       // starts of one animation name between two scans
    const MAX_GROUPS = 8;         // report groups per page load (the fault capture keeps 25 for everything)
    const EDGE = 64;              // px outside the viewport before a target counts as off screen
    const REPORT_AFTER_MS = 10000; // a target must stay unseen this long before it is reported (fades in and out are not faults)
    const DETACHED_SCANS = 5;     // scans a paused animation's element may stay out of the page before cancel()

    // Animations that are meant to run for as long as they show, and show rarely: (b) never reports them.
    // They are still paused and reported when hidden. Every entry says why it may run on.
    const ALLOW = {
        // boot and logon screens: on screen only while the system starts, gone with the screen
        'melatonBootSweep': 'boot screen progress sweep',
        'desktop-prestartup-marquee': 'startup window marquee, removed when the desktop is up',
        'vista-logon-wait': 'Welcome screen wait ring, only until the desktop shows',
        'pu-ripple': 'phone update screen, only while an update installs',
        // progress marquees: an indeterminate bar exists only while its job runs
        'classic-progress-marquee': 'classic progress bar while a job runs',
        'progressbar': 'Windows 7 kit progress bar while a job runs',
        'wm-pb-marquee': 'phone progress box while a job runs',
        'wsk-marquee': 'phone suite kit progress bar while a job runs',
        'wpp-marquee': 'PayPass progress bar while a payment runs',
        'wm-ds-marquee': 'phone Dreamscape settings progress bar while a job runs',
        'wm-sys-marquee': 'phone system settings progress bar while a job runs',
        'wm-ti-super-marquee': 'Super Bar progress while a job runs',
        'asw-marquee': 'ActiveSync wizard progress while it connects',
        'wkm-marquee': 'Wiki console progress while it loads',
        'rdc-banner-marquee': 'Remote Desktop connecting banner, only while connecting',
        'manual-preview-download-indeterminate': 'Studio preview download bar while the download runs',
        // busy cursors / wait rings: shown only while the thing they stand on is busy
        'vgh-wait': 'gadget host wait ring while a gadget loads',
        'grimoire-ie-ring': 'browser tab busy ring while the page loads',
        'wmb-busy': 'phone browser busy ring while the page loads',
        'was-sync': 'ActiveSync sync arrows while a sync runs',
        'yt-spin': 'Videos busy ring while a list loads',
        'ex-spin': 'Explore refresh button while a refresh runs',
        'nv-marquee': 'Vibes progress bar while a vibe job runs',
        'vpn-spin': 'Nightshade connecting ring while it connects',
        'cpl-map-busy': 'Network map busy ring while it scans',
        // a job the user started and watches
        'pulse-generation': 'Generate button while a print is being made',
        'director-typing': 'Director typing dots while a reply streams',
        'dm-dot': 'Director thinking dots while a turn runs',
        'vistaUpdatePulse': 'update tray icon while an update downloads',
        'pulse-credits': 'update tray icon while an update downloads',
        'vistaNetConnecting': 'network tray icon while the link connects',
        'nightshadeTrayConnecting': 'Nightshade tray icon while it connects',
        'mp-ants': 'Paint selection marquee: marching ants are the selection, while one exists'
    };

    // Animations that belong to the window having the keyboard: Vista pulses the default button of the
    // active window only, and with the browser window in the background no window of ours is active.
    // They are held while document.hasFocus() is false and run again on focus. Never reported for that.
    const FOCUS_BOUND = {
        'vista-button-default-pulse': 'default push button glow (vista-glass-controls.css)',
        'vista-default-pulse': 'About box default button glow',
        'director-send-pulse': 'Director Send button default glow'
    };

    const scopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined;
    const rootEl = document.documentElement;
    const held = new Map();        // element -> { reason, cause, seen, reported } (CSS animations, by class)
    const heldScript = new Map();  // Animation -> { reason, target } (Web Animations, by pause())
    const scriptSeen = new Set();  // looping script animations a scan saw running (they are alive anyway while they run)
    const startCounts = new Map(); // animation name -> starts since the last scan
    const reported = new Set();    // group keys sent this page load
    const keyframeSource = new Map(); // animation name -> stylesheet path ('' unknown)
    const wd = { scans: 0, running: 0, lastScanAt: 0, lastScanMs: 0, dirty: true, timer: 0, queued: 0, queuedAt: 0, watch: null, inputBound: null };

    function watchdogNoteStart(name) {
        if (!name) return;
        startCounts.set(name, (startCounts.get(name) || 0) + 1);
        if (!wd.dirty) { wd.dirty = true; armTimer(); }
    }

    /** The page is not seen at all: hidden, the phone's screen off, behind an Android program, or under an opaque screen saver. */
    function pageAsleep() {
        const d = rootEl.dataset;
        return document.hidden || d.screenOff !== undefined || d.wmBehind !== undefined || d.saverCover !== undefined;
    }

    function armTimer() {
        if (wd.timer || document.hidden || !(wd.dirty || wd.running > 0 || held.size > 0 || heldScript.size > 0 || scriptSeen.size > 0)) return;
        wd.timer = setTimeout(() => { wd.timer = 0; requestScan('timer', 0); }, PERIOD_MS);
    }

    function requestScan(reason, gap) {
        const wait = Math.max(0, wd.lastScanAt + (gap == null ? EVENT_GAP_MS : gap) - Date.now());
        if (wd.queued) {
            // a sooner request replaces a later one; an equal or later one rides along
            if (Date.now() + wait >= wd.queuedAt) return;
            clearTimeout(wd.queued);
        }
        wd.queuedAt = Date.now() + wait;
        wd.queued = setTimeout(() => {
            wd.queued = 0;
            whenIdle(() => { try { scan(reason); } catch (err) { /* the watchdog never breaks the page */ } });
        }, wait);
    }

    function nameOf(animation) {
        if (animation.animationName) return animation.animationName;
        if (animation.transitionProperty) return 'transition:' + animation.transitionProperty;
        return animation.id || 'script-animation';
    }

    function describe(el, pseudo) {
        if (!el || el.nodeType !== 1) return '?';
        let out = el.localName || 'node';
        if (el.id) out += '#' + el.id;
        const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter((c) => c && c !== PAUSED_CLASS).slice(0, 3) : [];
        if (cls.length) out += '.' + cls.join('.');
        return out + (pseudo || '');
    }

    function windowOf(el) {
        return el && el.closest ? el.closest('.modal, .wm-page, .vsb-gadget') : null;
    }

    function shellKind() {
        return window.uiShell === 'mobile' || rootEl.classList.contains('ui-mobile') ? 'mobile' : 'desktop';
    }

    function clientKind() {
        const ua = String(navigator.userAgent || '');
        if (/ DreamOS\//.test(ua)) return 'dreamos';
        if (window.AndroidHardware || /; wv\)/.test(ua)) return 'android-app';
        try { if (window.matchMedia('(display-mode: standalone)').matches) return 'installed'; } catch (_) { /* old engine */ }
        return 'browser';
    }

    /** The app or feature a target belongs to: its window's program (programFaults), a Sidebar gadget, a phone program, else the shell. */
    function ownerOf(el) {
        const shell = shellKind();
        try {
            const gadget = el.closest('.vsb-gadget');
            if (gadget) return { key: 'gadget:' + (gadget.dataset.type || 'sidebar'), name: 'Sidebar gadget: ' + (gadget.dataset.type || '?'), core: false };
            const segment = el.closest('[data-melaton-segment]');
            const win = el.closest('.modal');
            if (win && window.programFaults && typeof window.programFaults.attribute === 'function') {
                const p = window.programFaults.attribute({ eventWindow: win });
                if (p && (p.key || p.name)) return { key: p.key || p.name, name: p.name || p.key, launchId: p.launchId || null, game: p.game || null, core: !!p.core, windowId: win.id || null };
            }
            if (segment) return { key: 'segment:' + segment.dataset.melatonSegment, name: segment.dataset.melatonSegment, core: false };
            if (shell === 'mobile') {
                const page = el.closest('.wm-page');
                const app = (page && (page.dataset.app || page.id)) || rootEl.dataset.wmApp;
                if (app) return { key: 'wm:' + app, name: 'Melaton Mobile: ' + app, core: false };
            }
        } catch (_) { /* fall through to the shell */ }
        return shell === 'mobile' ? { key: 'shell:mobile', name: 'Melaton Mobile', core: true } : { key: 'shell:desktop', name: 'Melaton Desktop', core: true };
    }

    /** An opaque box of another window lies over all of rect (its centre and four inset corners). Returns that window, or null. */
    function coveredBy(el, rect) {
        if (shellKind() !== 'desktop' || typeof document.elementFromPoint !== 'function') return null;
        const own = el.closest('.modal');
        const inset = Math.min(2, rect.width / 4, rect.height / 4);
        const points = [
            [rect.left + rect.width / 2, rect.top + rect.height / 2],
            [rect.left + inset, rect.top + inset], [rect.right - inset, rect.top + inset],
            [rect.left + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset]
        ];
        let cover = null;
        for (let i = 0; i < points.length; i++) {
            const x = Math.max(0, Math.min(window.innerWidth - 1, points[i][0]));
            const y = Math.max(0, Math.min(window.innerHeight - 1, points[i][1]));
            const hit = document.elementFromPoint(x, y);
            if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return null;
            const win = hit.closest('.modal');
            if (!win || win === own || win.contains(el)) return null;
            if (cover && cover !== win) return null;
            // glass frames and clear panes show what is behind them: the hit, or a box between it and
            // its window, must be painted solid
            let solid = false;
            for (let node = hit, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
                const cs = getComputedStyle(node);
                if (Number(cs.opacity) < 1) { solid = false; break; }
                const m = /^rgba?\(([^)]+)\)$/.exec(cs.backgroundColor);
                if (m) {
                    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
                    if (parts.length < 4 || Number(parts[3]) >= 1) solid = true;
                }
                if (node === win) { if (solid && (cs.backdropFilter && cs.backdropFilter !== 'none')) solid = false; break; }
                if (solid) {
                    // solid here, but a translucent box further up would still let it show
                    let up = node.parentElement;
                    let clear = true;
                    for (let d2 = 0; up && d2 < 8; up = up.parentElement, d2++) {
                        if (Number(getComputedStyle(up).opacity) < 1) { clear = false; break; }
                        if (up === win) break;
                    }
                    if (!clear) solid = false;
                    break;
                }
            }
            if (!solid) return null;
            cover = win;
        }
        return cover;
    }

    /** Why a target cannot be seen ({ reason, cause: the element to watch for it changing }), or null when it can (or costs nothing). */
    function hiddenState(el, animation, keyframeProps) {
        if (!el.isConnected) return null;
        if (FOCUS_BOUND[animation.animationName] && typeof document.hasFocus === 'function' && !document.hasFocus()) {
            return { reason: 'window not focused', cause: null, quiet: true };
        }
        if (typeof el.checkVisibility === 'function') {
            // display: none never gets here; visibility / content-visibility: hidden do not tick the compositor
            if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return null;
            // the nearest ancestor with a box: checkVisibility() is false for a display: contents element
            // whatever its opacity (the Welcome screen's wait ring was reported and paused in view, #931)
            let parent = el.parentElement;
            while (parent && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
            if (parent && !parent.checkVisibility({ opacityProperty: true })) {
                // only when an ancestor really is at opacity 0
                for (let node = parent, depth = 0; node && depth < 40; node = node.parentElement, depth++) {
                    if (Number(getComputedStyle(node).opacity) === 0) return { reason: 'under opacity 0', cause: node };
                }
            }
        }
        const rect = el.getBoundingClientRect();
        const pseudo = animation.effect && animation.effect.pseudoElement;
        if (!pseudo && rect.width === 0 && rect.height === 0 && el.scrollWidth === 0 && el.scrollHeight === 0) return { reason: 'zero size', cause: el.parentElement };
        if (rect.right < -EDGE || rect.bottom < -EDGE || rect.left > window.innerWidth + EDGE || rect.top > window.innerHeight + EDGE) {
            return { reason: 'off screen', cause: el.parentElement };
        }
        if (rect.width > 0 && rect.height > 0 && !keyframeProps.moves) {
            const cover = coveredBy(el, rect);
            if (cover) return { reason: 'behind another window', cause: cover };
        }
        return null;
    }

    function keyframeInfo(animation) {
        const out = { moves: false, props: '' };
        try {
            const frames = animation.effect.getKeyframes();
            const props = new Set();
            for (let i = 0; i < frames.length; i++) {
                for (const k in frames[i]) {
                    if (k !== 'offset' && k !== 'easing' && k !== 'composite' && k !== 'computedOffset') props.add(k);
                }
            }
            out.props = Array.from(props).slice(0, 6).join(',');
            // something that travels (translate, left ...) may be covered at one end and in view at the other
            out.moves = /translate|left|right|top|bottom|offset|margin/i.test(out.props)
                || frames.some((f) => typeof f.transform === 'string' && /translate|matrix/.test(f.transform));
        } catch (_) { /* a custom effect */ }
        return out;
    }

    /** The stylesheet that declares @keyframes <name>, looked up once per name (only for a group about to be reported). */
    function sourceOf(name) {
        if (keyframeSource.has(name)) return keyframeSource.get(name);
        let found = '';
        try {
            const sheets = document.styleSheets;
            for (let i = 0; i < sheets.length && !found; i++) {
                let rules;
                try { rules = sheets[i].cssRules; } catch (_) { continue; }
                for (let j = 0; rules && j < rules.length; j++) {
                    if (rules[j].type === 7 && rules[j].name === name) {
                        const href = sheets[i].href || '';
                        try { found = href ? new URL(href).pathname : 'inline <style>'; } catch (_) { found = href; }
                        break;
                    }
                }
            }
        } catch (_) { /* unreadable sheets */ }
        keyframeSource.set(name, found);
        return found;
    }

    function hold(el, state) {
        const was = held.get(el);
        if (was) { was.reason = state.reason; was.cause = state.cause; was.seen += 1; return was; }
        const entry = { reason: state.reason, cause: state.cause, seen: 1, since: Date.now() };
        held.set(el, entry);
        if (!el.classList.contains(PAUSED_CLASS)) el.classList.add(PAUSED_CLASS);
        return entry;
    }

    function release(el) {
        held.delete(el);
        // the viewport observer above owns the class for the elements it watches
        if (watched.has(el)) { io.unobserve(el); io.observe(el); return; }
        if (el.classList.contains(PAUSED_CLASS)) el.classList.remove(PAUSED_CLASS);
    }

    /** While something is held: hear the changes that can bring it into view, and nothing otherwise. */
    function syncHoldWatch() {
        const need = held.size > 0 || heldScript.size > 0;
        if (wd.watch) wd.watch.disconnect();
        if (!need) {
            wd.watch = null;
            if (wd.inputBound) { wd.inputBound.abort(); wd.inputBound = null; }
            return;
        }
        if (!wd.watch && typeof MutationObserver === 'function') wd.watch = new MutationObserver(() => requestScan('held-changed', RECHECK_MS));
        if (wd.watch) {
            const seen = new Set();
            const observe = (node) => {
                if (!node || node.nodeType !== 1 || node === rootEl || seen.has(node)) return;
                seen.add(node);
                wd.watch.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
            };
            const chain = (el, cause) => {
                let depth = 0;
                for (let node = el.parentElement; node && node !== rootEl && depth < 40; node = node.parentElement, depth++) observe(node);
                observe(cause);
            };
            held.forEach((entry, el) => chain(el, entry.cause));
            heldScript.forEach((entry) => { if (entry.target) chain(entry.target, entry.cause); });
        }
        if (!wd.inputBound) {
            wd.inputBound = new AbortController();
            const opts = { capture: true, passive: true, signal: wd.inputBound.signal };
            const again = () => requestScan('held-input', RECHECK_MS);
            document.addEventListener('pointerup', again, opts);
            document.addEventListener('keyup', again, opts);
            document.addEventListener('transitionrun', again, opts);
        }
    }

    function report(group) {
        const capture = window.dreamscapeErrorCapture;
        if (!capture || typeof capture.capture !== 'function') return false;
        if (reported.has(group.key) || reported.size >= MAX_GROUPS) return false;
        reported.add(group.key);
        const source = group.name.indexOf('transition:') === 0 || group.kind === 'script' ? '' : sourceOf(group.name);
        const what = group.type === 'restarts'
            ? `Animation "${group.name}" restarted ${group.count} times in ${Math.round(group.windowMs / 1000)} s`
            : group.type === 'hidden'
                ? `Animation "${group.name}" runs on a target that is not seen (${group.reason}): ${group.target}`
                : `Animation "${group.name}" runs without end in view: ${group.target}`;
        return capture.capture({
            message: what,
            // no script stack: the "frames" name the stylesheet, so the report points at the file to fix
            stack: source ? `AnimationWatchdog: ${what}\n    at keyframes ${group.name} (${source}:1:1)` : '',
            fileLine: source
        }, {
            kind: 'animation',
            errorName: 'AnimationWatchdog',
            program: group.owner,
            source: 'animationWatchdog',
            animation: {
                type: group.type,
                name: group.name,
                kind: group.kind,
                target: group.target,
                window: group.window || '',
                reason: group.reason || '',
                properties: group.props || '',
                iterations: group.iterations,
                durationMs: group.durationMs,
                runMs: group.runMs,
                targets: group.count,
                paused: !!group.paused,
                allowed: group.allowed || '',
                source: source,
                shell: shellKind(),
                client: clientKind()
            }
        });
    }

    function scan(reason) {
        if (typeof document.getAnimations !== 'function') return [];
        const t0 = performance.now();
        wd.scans += 1;
        wd.lastScanAt = Date.now();
        const asleep = pageAsleep();
        const findings = [];
        const groups = new Map();
        const stillHidden = new Set();
        const stillScript = new Set();
        let running = 0;
        const add = (g) => {
            const had = groups.get(g.key);
            if (had) { had.count += 1; had.runMs = Math.max(had.runMs, g.runMs); return had; }
            g.count = 1;
            groups.set(g.key, g);
            return g;
        };
        // a hidden page gets no frames at all, and CSS pauses CSS animations in the other sleep states:
        // only script animations are left to stop there
        const list = document.hidden ? [] : document.getAnimations();
        for (let i = 0; i < list.length; i++) {
            const animation = list[i];
            const effect = animation.effect;
            const el = effect && effect.target;
            if (!el || el.nodeType !== 1) continue;
            const isCss = !!animation.animationName;
            const isTransition = !!animation.transitionProperty;
            const wasHeldScript = heldScript.has(animation);
            if (animation.playState !== 'running' && !(wasHeldScript && animation.playState === 'paused') && !(isCss && held.has(el))) continue;
            let timing;
            try { timing = effect.getComputedTiming(); } catch (_) { continue; }
            const endless = timing.iterations === Infinity || timing.endTime === Infinity;
            const now = Number(animation.currentTime) || 0;
            const left = endless ? Infinity : Math.max(0, Number(timing.endTime) - now);
            if (animation.playState === 'running') running += 1;
            // short one-shots are never looked at: they end by themselves and code waits for their end
            if (!endless && left < LONG_MS) continue;
            const name = nameOf(animation);
            const pseudo = effect.pseudoElement || '';
            if (!isCss && !isTransition) scriptSeen.add(animation);
            const info = keyframeInfo(animation);
            let state = null;
            if (asleep) state = isCss || isTransition ? null : { reason: 'the page is not seen', cause: null };
            else state = hiddenState(el, animation, info);
            const base = {
                name, kind: isCss ? 'css' : isTransition ? 'transition' : 'script', target: describe(el, pseudo),
                window: describe(windowOf(el)), props: info.props,
                iterations: timing.iterations === Infinity ? 'infinite' : String(timing.iterations),
                durationMs: Math.round(Number(timing.duration) || 0), runMs: Math.round(now)
            };
            if (state) {
                let entry = null;
                if (isCss) { entry = hold(el, state); stillHidden.add(el); }
                else if (!isTransition) {
                    entry = heldScript.get(animation);
                    if (!entry) { entry = { reason: state.reason, cause: state.cause, target: el, seen: 0, since: Date.now() }; heldScript.set(animation, entry); try { animation.pause(); } catch (_) { /* finished meanwhile */ } }
                    entry.seen += 1;
                    stillScript.add(animation);
                }
                const finding = Object.assign({ type: 'hidden', reason: state.reason, paused: !!entry, seen: entry ? entry.seen : 1 }, base);
                findings.push(finding);
                // reported once it has stayed hidden for a while: a target on its way in or out is not a fault
                if (entry && !state.quiet && entry.seen >= 2 && Date.now() - entry.since >= REPORT_AFTER_MS) {
                    const owner = ownerOf(el);
                    add(Object.assign({ key: [owner.key, 'hidden', name, base.target.replace(/\d+/g, '#'), state.reason].join('|'), owner }, finding));
                }
                continue;
            }
            if (asleep || animation.playState !== 'running' || isTransition) continue;
            if (now >= LONG_MS) {
                const finding = Object.assign({ type: 'endless', allowed: ALLOW[name] || '' }, base);
                findings.push(finding);
                if (!ALLOW[name]) {
                    const owner = ownerOf(el);
                    add(Object.assign({ key: [owner.key, 'endless', name, base.target.replace(/\d+/g, '#')].join('|'), owner }, finding));
                }
            }
        }
        // looping script animations seen before whose element has left the page: nothing lists them any
        // more, and they tick until someone cancels them
        if (!document.hidden) {
            const listed = new Set(list);
            scriptSeen.forEach((animation) => {
                const target = animation.effect && animation.effect.target;
                const state = animation.playState;
                if (state === 'idle' || state === 'finished' || !target) { scriptSeen.delete(animation); heldScript.delete(animation); return; }
                if (listed.has(animation) || target.isConnected) return;
                let entry = heldScript.get(animation);
                if (!entry) {
                    entry = { reason: 'its element left the page', cause: null, target: null, seen: 0, since: Date.now() };
                    heldScript.set(animation, entry);
                    try { animation.pause(); } catch (_) { /* gone */ }
                }
                entry.seen += 1;
                stillScript.add(animation);
                const finding = {
                    type: 'hidden', reason: entry.reason, paused: true, seen: entry.seen, name: nameOf(animation), kind: 'script',
                    target: describe(target, ''), window: '', props: keyframeInfo(animation).props, iterations: 'infinite',
                    durationMs: 0, runMs: Math.round(Number(animation.currentTime) || 0)
                };
                findings.push(finding);
                if (entry.seen >= 2 && Date.now() - entry.since >= REPORT_AFTER_MS) {
                    const owner = shellKind() === 'mobile' ? { key: 'shell:mobile', name: 'Melaton Mobile', core: true } : { key: 'shell:desktop', name: 'Melaton Desktop', core: true };
                    add(Object.assign({ key: [owner.key, 'hidden', finding.name, finding.target.replace(/\d+/g, '#'), entry.reason].join('|'), owner }, finding));
                }
                if (entry.seen >= DETACHED_SCANS) {
                    // not coming back: free it (and the element it keeps alive)
                    try { animation.cancel(); } catch (_) { /* gone */ }
                    scriptSeen.delete(animation);
                    heldScript.delete(animation);
                    stillScript.delete(animation);
                }
            });
        }
        // what was held and is in view again (or gone): let it run
        if (!document.hidden) {
            Array.from(held.keys()).forEach((el) => { if (!stillHidden.has(el)) release(el); });
            Array.from(heldScript.keys()).forEach((animation) => {
                if (stillScript.has(animation)) return;
                heldScript.delete(animation);
                try { if (animation.playState === 'paused') animation.play(); } catch (_) { /* cancelled meanwhile */ }
            });
        }
        // (c) restarts since the last scan
        const windowMs = wd.restartSince ? Date.now() - wd.restartSince : 0;
        startCounts.forEach((count, name) => {
            if (count < RESTART_MAX || !windowMs || count / (windowMs / 1000) < 0.5) return;
            const owner = shellKind() === 'mobile' ? { key: 'shell:mobile', name: 'Melaton Mobile', core: true } : { key: 'shell:desktop', name: 'Melaton Desktop', core: true };
            const finding = { type: 'restarts', name, kind: 'css', target: '', count, windowMs, runMs: windowMs, allowed: ALLOW[name] || '' };
            findings.push(finding);
            const g = add(Object.assign({ key: [owner.key, 'restarts', name].join('|'), owner }, finding));
            g.count = count;
        });
        startCounts.clear();
        wd.restartSince = Date.now();
        wd.running = running;
        wd.dirty = false;
        syncHoldWatch();
        groups.forEach((g) => report(g));
        wd.lastScanMs = Math.round((performance.now() - t0) * 100) / 100;
        wd.lastReason = reason || '';
        if (wd.timer) { clearTimeout(wd.timer); wd.timer = 0; }
        armTimer();
        return findings;
    }

    const onShowHide = (event) => requestScan(event && event.type, held.size || heldScript.size ? RECHECK_MS : undefined);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { if (wd.timer) { clearTimeout(wd.timer); wd.timer = 0; } return; }
        onShowHide({ type: 'visibilitychange' });
    }, { signal: scopeSignal });
    ['taskbarWindowsUpdated', 'wmAppChange', 'wmawake', 'wmBehind', 'melatoncover'].forEach((type) => {
        document.addEventListener(type, onShowHide, { signal: scopeSignal });
    });
    window.addEventListener('melatonscreen', onShowHide, { signal: scopeSignal });
    // the browser window losing or getting the keyboard (FOCUS_BOUND); blur also fires when focus moves
    // into an iframe of ours, and hasFocus() is read in the scan, a task later
    window.addEventListener('blur', onShowHide, { signal: scopeSignal });
    window.addEventListener('focus', onShowHide, { signal: scopeSignal });
    wd.restartSince = Date.now();
    // the first look, once the boot is over (the boot's own animations are short-lived)
    armTimer();

    // app-scope: allow page-lifetime shell runtime: the watchdog's entry for features that hide or show something
    window.animationWatchdog = {
        check(reason) { requestScan(reason || 'check', held.size || heldScript.size ? RECHECK_MS : undefined); },
        scan() { return scan('manual'); },
        status() {
            return {
                scans: wd.scans, running: wd.running, held: held.size + heldScript.size, reported: Array.from(reported),
                lastScanMs: wd.lastScanMs, lastReason: wd.lastReason || '', timer: !!wd.timer
            };
        },
        allow: ALLOW,
        focusBound: FOCUS_BOUND
    };
})();
