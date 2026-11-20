/**
 * What keeps the screen on (DreamOS, StaticForge #910). Vista's rule: Windows Media Player asks
 * SetThreadExecutionState(ES_DISPLAY_REQUIRED) for a video only; music asks ES_SYSTEM_REQUIRED, so the screen dims
 * and turns off on its timeout while the music plays on (Yukimi, Nov 20 2026: "It can be allowed to enter full screen
 * off, videos keep screen on").
 *
 * On DreamOS nothing else holds the screen: the compositor gives no client an idle inhibitor (Chromium 156 put one on
 * its window for audio as well), so this page tells CaféReady (window.DreamOSPower.hold, cafeready power.rs), which
 * runs the idle timeouts by it. Only the page knows what is seen; CaféReady owns the duty (rule cafeready-background).
 *
 *   display   a <video> that has a picture (videoWidth > 0), is playing (not paused, not ended) and is seen: in a
 *             shown page, not under display: none (a minimised window), visibility: hidden or opacity 0, inside the
 *             screen and not covered all over by another window. A muted looping video is decoration and does not
 *             count. Full screen counts like any other. Also held while a feature says so: Melaton Photo Gallery's and Lumen's
 *             slide show, the screen saver's Preview (melatonMediaAwake.hold).
 *   system    media playing with sound (not muted, volume above 0, not a looping game or ambient track): music in
 *             Windows Media Player, a video whose window is minimised. The screen dims and turns off as usual; the
 *             machine does not sleep on idle while it plays.
 * A stronger hold is taken at once; a weaker one waits RELEASE_MS, so the gap between two tracks or two videos of a
 * list does not let go. A page that goes (a reload, a crash) lets go by itself: the hold is its open connection.
 *
 * Event driven, nothing polled: the media elements' own events (heard at the document in the capture phase), and,
 * only while a video plays, an IntersectionObserver on it plus the events that can show or hide it (the page's
 * visibility, a window opened, closed, minimised or restored, full screen, the screen saver's cover, a pointer or key
 * release: a window moved or brought forward). With nothing playing it has no listener beyond the media events.
 *
 * Other clients are not changed: without window.DreamOSPower.hold (the shell extension's bridge.js, there before this
 * file runs) it does nothing and window.melatonMediaAwake is not defined; the Android app and browsers keep their own
 * rules, and screenSaver.js its own video check.
 *
 *   melatonMediaAwake.hold(reason, kind)   a feature's own hold: kind 'display' | 'system' | '' (let go)
 *   melatonMediaAwake.videoSeen()          a playing video is seen now (screenSaver.js does not start over one, as
 *                                          Vista's does not while a program holds the display)
 *   melatonMediaAwake.state()              { held: '' | 'display' | 'system', videos, playing, holds }
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const power = () => {
        const P = root.DreamOSPower;
        return P && typeof P.hold === 'function' ? P : null;
    };
    if (!doc || root.melatonMediaAwake || !power()) return;
    // page listeners end with this file's segment (app-scope, #872)
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;

    const REASON = 'media';
    const RELEASE_MS = 1500;
    const CHECK_MS = 120;
    const MEDIA_EVENTS = ['play', 'playing', 'pause', 'ended', 'emptied', 'abort', 'error', 'loadedmetadata', 'resize', 'volumechange'];
    const SHOW_EVENTS = ['taskbarWindowsUpdated', 'melatoncover', 'fullscreenchange', 'visibilitychange'];
    const RANK = { '': 0, system: 1, display: 2 };

    const playing = new Map();   // media elements in the page that are playing -> their own listeners' AbortController
    const inView = new WeakMap(); // video -> its IntersectionObserver answer
    const holds = new Map();     // a feature's own holds: reason -> kind
    let io = null;
    let live = null;             // AbortController of the listeners that run while a video plays
    let checkTimer = 0;
    let releaseTimer = 0;
    let held = '';
    let lastSeen = false;

    const isPlaying = (m) => m.isConnected && !m.paused && !m.ended;
    const hasPicture = (m) => m.localName === 'video' && m.videoWidth > 0 && m.videoHeight > 0;
    const decoration = (m) => m.muted && m.loop;
    const audible = (m) => !m.muted && m.volume > 0 && !m.loop;

    /** The window (or the page) an element belongs to. */
    const windowOf = (el) => (el.closest ? el.closest('.modal') : null);

    /** Another window lies over all of the video (nine points over it, none reaching it or its own window). */
    function covered(v, rect) {
        if (typeof doc.elementFromPoint !== 'function') return false;
        const own = windowOf(v);
        const xs = [rect.left + rect.width * 0.1, rect.left + rect.width / 2, rect.right - rect.width * 0.1];
        const ys = [rect.top + rect.height * 0.1, rect.top + rect.height / 2, rect.bottom - rect.height * 0.1];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const x = Math.max(0, Math.min(root.innerWidth - 1, xs[i]));
                const y = Math.max(0, Math.min(root.innerHeight - 1, ys[j]));
                const hit = doc.elementFromPoint(x, y);
                // the video, its controls drawn over it, or anything of its own window: seen there
                if (!hit || hit === v || v.contains(hit) || hit.contains(v)) return false;
                if (own && (hit === own || own.contains(hit))) return false;
            }
        }
        return true;
    }

    function seen(v) {
        const d = doc.documentElement.dataset;
        if (doc.hidden || d.saverCover !== undefined) return false;
        if (inView.get(v) === false) return false;
        if (typeof v.checkVisibility === 'function' && !v.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
        const rect = v.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= root.innerWidth || rect.top >= root.innerHeight) return false;
        return !covered(v, rect);
    }

    /** What the page asks for now: '' | 'system' | 'display'. */
    function wanted() {
        let display = false;
        let system = false;
        let videos = false;
        for (const m of Array.from(playing.keys())) {
            if (!isPlaying(m)) { forget(m); continue; }
            if (hasPicture(m) && !decoration(m)) {
                videos = true;
                if (!display && seen(m)) display = true;
            }
            if (audible(m)) system = true;
        }
        lastSeen = display;
        syncLive(videos);
        for (const k of holds.values()) {
            if (k === 'display') display = true;
            else if (k === 'system') system = true;
        }
        return display ? 'display' : system ? 'system' : '';
    }

    function apply(kind) {
        if (kind === held) return;
        held = kind;
        const P = power();
        if (P) { try { P.hold(REASON, kind); } catch (_) { /* an older shell extension: nothing to hold with */ } }
    }

    function check() {
        checkTimer = 0;
        const kind = wanted();
        if (RANK[kind] >= RANK[held]) {
            if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
            apply(kind);
            return;
        }
        // weaker: after a moment, if it still is
        if (!releaseTimer) {
            releaseTimer = setTimeout(() => {
                releaseTimer = 0;
                const k = wanted();
                if (RANK[k] < RANK[held]) apply(k);
            }, RELEASE_MS);
        }
    }

    function queue() {
        if (!checkTimer) checkTimer = setTimeout(check, CHECK_MS);
    }

    function forget(m) {
        const own = playing.get(m);
        if (own) own.abort();
        playing.delete(m);
        if (io && m.localName === 'video') io.unobserve(m);
    }

    /** While a video plays: what can show or hide it. Gone again when none plays. */
    function syncLive(videos) {
        if (videos && !live) {
            live = new AbortController();
            const opts = { signal: live.signal, passive: true };
            SHOW_EVENTS.forEach((t) => doc.addEventListener(t, queue, opts));
            // a window dragged over it or brought forward ends with a release
            root.addEventListener('pointerup', queue, opts);
            root.addEventListener('keyup', queue, opts);
            root.addEventListener('resize', queue, opts);
        } else if (!videos && live) {
            live.abort();
            live = null;
        }
    }

    function observe(v) {
        if (typeof IntersectionObserver !== 'function') return;
        if (!io) {
            io = new IntersectionObserver((entries) => {
                for (let i = 0; i < entries.length; i++) inView.set(entries[i].target, entries[i].isIntersecting);
                queue();
            });
        }
        io.observe(v);
    }

    function onMedia(ev) {
        const m = ev.target;
        if (!m || (m.localName !== 'video' && m.localName !== 'audio')) return;
        if (isPlaying(m)) {
            if (!playing.has(m)) {
                // its own listeners too: an element taken out of the page while playing pauses there, where the
                // document no longer hears it
                const own = new AbortController();
                playing.set(m, own);
                ['pause', 'ended', 'emptied'].forEach((t) => m.addEventListener(t, onMedia, { passive: true, signal: own.signal }));
                if (m.localName === 'video') observe(m);
            }
        } else if (playing.has(m)) {
            forget(m);
        }
        queue();
    }

    MEDIA_EVENTS.forEach((t) => doc.addEventListener(t, onMedia, { capture: true, passive: true, signal: appScopeSignal }));
    // what was already playing when this ran
    doc.querySelectorAll('video, audio').forEach((m) => { if (isPlaying(m)) onMedia({ target: m }); });

    root.melatonMediaAwake = Object.freeze({
        hold(reason, kind) {
            const r = String(reason || 'feature');
            if (kind === 'display' || kind === 'system') holds.set(r, kind); else holds.delete(r);
            queue();
        },
        videoSeen() {
            for (const m of playing.keys()) if (isPlaying(m) && hasPicture(m) && !decoration(m) && seen(m)) return true;
            return false;
        },
        state: () => ({ held, videos: lastSeen, playing: playing.size, holds: Object.fromEntries(holds) })
    });
})(typeof window !== 'undefined' ? window : globalThis);
