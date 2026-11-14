/**
 * Melaton Mobile 6.5: the lock screen (Start screen > Lock).
 *
 * Windows Mobile 6.5's, from the ROM's layout (LS_LockScene_480x640.cpr, LS_Global) and the
 * emulator (480 x 640, recordings at 15 ms a grab):
 *   - the screen comes up in one frame: the Today picture over the whole screen, the title bar
 *     with only its status icons, the slide handle with its caption, the time / date band at the
 *     bottom. No soft key bar. The 21 chevron entry frames play once (28 a second).
 *   - at rest the chevrons either side of the handle run their four loop frames twice at 4 a
 *     second, then stand still for about 6 s, and again.
 *   - pressing the handle fades it to its dark art and fades the chevrons out (done by 300 ms);
 *     the caption stays. The handle follows the finger, 132 px (66 units) either way at most.
 *   - let go before an end (measured at 66, 100 and 120 of 132 px): it runs back to the middle at
 *     once, fast first with a long tail, the light art and the chevrons fading back in.
 *   - let go at either end (left or right): unlocked. Holding it at the end does nothing until the
 *     finger lifts. Then: the soft key bar, the title, and the screen under it in one frame.
 *   - Esc, Enter and the soft keys do nothing while locked; taps on the status icons, the
 *     picture and the time band do nothing.
 *   - Lock on the Start screen closes Start first: unlocking shows what was under it.
 * With notifications the device's handle carries their total ("tap or slide") and pressing it
 * lists them, each a slider of its own that unlocks into its program (cpr ItemSlider /
 * NotificationUnlock). Melaton has one: unread mail (Today's count), which opens Messaging.
 *
 * window.wmLock = { lock(), unlock(opts), isLocked (true / false), locked() }.
 */
(function () {
    'use strict';

    const root = document.documentElement;
    if (root.dataset.wmVersion !== '6.5' || !root.classList.contains('ui-mobile')) return;

    // the device's order after the finger lifts at an end, its emulator times (+230 soft key bar,
    // +430 title, +660 body) scaled to a phone's
    const UNLOCK_KEYS_MS = 80;
    const UNLOCK_TITLE_MS = 160;
    const UNLOCK_BODY_MS = 260;
    const ENTRY_MS = 750; // 21 frames at 28 a second

    let sh = null;
    let shell = null;
    let layer = null;
    let el = null;          // the layer's parts
    let locked = false;
    let unlocking = false;
    let tick = 0;
    let timers = [];
    let lastClock = '';
    let lastWall = '';
    let mailCount = 0;
    let ownPops = 0;        // the shell's own history.go() steps still to arrive while locked
    let swallowed = false;  // a back step was taken while locked: its history entry is put back on unlock
    let patchedGo = false;

    const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const fmtShort = new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });

    /** "8:47" and "PM" apart, as the home screen's clock has them (wmTitanium.js). */
    function timeParts(d) {
        let time = '';
        let ampm = '';
        try {
            for (const p of fmtTime.formatToParts(d)) {
                if (p.type === 'dayPeriod') ampm = p.value;
                else if (p.type !== 'literal' || p.value.trim()) time += p.value;
            }
        } catch (_) { time = fmtTime.format(d); }
        return { time: time.trim(), ampm };
    }

    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

    function sliderHtml(cls, attrs, inner) {
        return `<div class="wm-lock65-slide ${cls}"${attrs}>
                <div class="wm-lock65-path" data-side="l"><i></i></div>
                <div class="wm-lock65-path" data-side="r"><i></i></div>
                <div class="wm-lock65-handle"><i data-art="up"></i><i data-art="dn"></i>${inner}</div>
            </div>`;
    }

    function build() {
        layer = document.createElement('div');
        layer.className = 'wm-lock65';
        layer.hidden = true;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-label', 'Device locked');
        layer.innerHTML = `<div class="wm-lock65-wall"></div>
            <div class="wm-lock65-scene">
                ${sliderHtml('wm-lock65-slider', '', '<span class="wm-lock65-total"></span>')}
                <div class="wm-lock65-caption">slide</div>
                <div class="wm-lock65-list" hidden>
                    ${sliderHtml('wm-lock65-item', ' data-kind="mail"', '<span class="wm-lock65-count"></span>')}
                </div>
                <div class="wm-lock65-time">
                    <span class="wm-lock65-clock"></span><span class="wm-lock65-ampm"></span><span class="wm-lock65-date"></span>
                </div>
            </div>`;
        el = {
            wall: layer.querySelector('.wm-lock65-wall'),
            slider: layer.querySelector('.wm-lock65-slider'),
            total: layer.querySelector('.wm-lock65-total'),
            caption: layer.querySelector('.wm-lock65-caption'),
            list: layer.querySelector('.wm-lock65-list'),
            mail: layer.querySelector('.wm-lock65-item[data-kind="mail"]'),
            mailCount: layer.querySelector('.wm-lock65-count'),
            clock: layer.querySelector('.wm-lock65-clock'),
            ampm: layer.querySelector('.wm-lock65-ampm'),
            date: layer.querySelector('.wm-lock65-date')
        };
        el.slider.querySelector('.wm-lock65-handle').setAttribute('aria-label', 'Slide to unlock');
        // under the workspace switch cover and the splash, which come later in the shell
        const before = shell.querySelector(':scope > .wm-splash');
        if (before) shell.insertBefore(layer, before); else shell.appendChild(layer);

        // 66 units of travel for the handle (slider 192 - handle 60, halved); a notification's
        // slide has 77.5 (222 - 67, halved)
        bindSlide(el.slider, 66, () => unlock(), () => { if (mailCount > 0) showList(); });
        bindSlide(el.mail, 77.5, () => unlock({ app: 'messaging' }));
        // nothing under the layer is reached, and no text is selected or dragged on it
        ['click', 'dblclick', 'contextmenu', 'dragstart', 'selectstart', 'wheel'].forEach((type) => {
            layer.addEventListener(type, (e) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }, { passive: false });
        });
    }

    /**
     * A slide: its handle follows the pointer from where it was pressed, limit units either way.
     * Let go at an end: onEnd. Before it: back to the middle. onPress: the handle was pressed.
     */
    function bindSlide(slide, limit, onEnd, onPress) {
        const handle = slide.querySelector('.wm-lock65-handle');
        let id = null;
        let startX = 0;
        let dx = 0;
        let max = 0;
        let frame = 0;
        const place = () => { frame = 0; handle.style.transform = `translate3d(${dx}px, 0, 0)`; };
        const settle = (e) => {
            if (id == null || (e && e.pointerId !== id)) return;
            try { handle.releasePointerCapture(id); } catch (_) { /* already released */ }
            id = null;
            if (frame) { cancelAnimationFrame(frame); place(); }
            // the end stop (within half a unit: the pointer's own rounding)
            if (e && e.type === 'pointerup' && max > 0 && Math.abs(dx) >= max - (max / limit) * 0.5 && !unlocking) {
                onEnd();
                return;
            }
            rest(slide);
        };
        handle.addEventListener('pointerdown', (e) => {
            if (!locked || unlocking || id != null || (e.pointerType === 'mouse' && e.button !== 0)) return;
            e.preventDefault();
            id = e.pointerId;
            try { handle.setPointerCapture(id); } catch (_) { /* moves still arrive while over the layer */ }
            // one unit in CSS px, from the 13-unit chevron box
            max = limit * (slide.querySelector('.wm-lock65-path').getBoundingClientRect().height / 13 || 1);
            startX = e.clientX;
            dx = 0;
            handle.classList.remove('is-returning');
            slide.classList.remove('is-entry', 'is-idle');
            slide.classList.add('is-pressed');
            if (onPress) onPress();
        });
        handle.addEventListener('pointermove', (e) => {
            if (e.pointerId !== id) return;
            dx = Math.max(-max, Math.min(max, e.clientX - startX));
            if (!frame) frame = requestAnimationFrame(place);
        });
        handle.addEventListener('pointerup', settle);
        handle.addEventListener('pointercancel', settle);
        handle.addEventListener('lostpointercapture', settle);
        slide._reset = () => { id = null; dx = 0; if (frame) { cancelAnimationFrame(frame); frame = 0; } };
    }

    /** A slide at rest in the middle: the handle runs back if it is away, the chevrons stand, then loop. */
    function rest(slide) {
        const handle = slide.querySelector('.wm-lock65-handle');
        handle.classList.add('is-returning');
        handle.style.transform = '';
        slide.classList.remove('is-pressed', 'is-entry', 'is-idle');
        void slide.offsetWidth; // the loop starts over, its still time first
        slide.classList.add('is-idle');
    }

    /** A slide as the screen comes up: handle in the middle, the chevrons' entry frames, then the loop. */
    function enter(slide) {
        const handle = slide.querySelector('.wm-lock65-handle');
        if (slide._reset) slide._reset();
        handle.classList.remove('is-returning');
        handle.style.transform = '';
        slide.classList.remove('is-pressed', 'is-idle', 'is-entry');
        void slide.offsetWidth;
        slide.classList.add('is-entry');
        later(() => { if (slide.classList.contains('is-entry')) { slide.classList.remove('is-entry'); slide.classList.add('is-idle'); } }, ENTRY_MS + 20);
    }

    function showList() {
        if (!el.list.hidden) return;
        el.list.hidden = false;
        enter(el.mail);
    }

    // ---------------------------------------------------------------- what the screen shows

    /** The Today picture: what the shell's .wm-wall65 carries (wmShell.js applyTodayBackground). */
    function paintWall() {
        const wall = shell.querySelector(':scope > .wm-wall65');
        const s = wall && !wall.hidden ? wall.style : null;
        const key = s ? `${s.backgroundImage}|${s.backgroundSize}|${s.backgroundPosition}|${s.backgroundRepeat}` : '';
        if (key === lastWall) return;
        lastWall = key;
        Object.assign(el.wall.style, {
            backgroundImage: s ? s.backgroundImage : '',
            backgroundSize: s ? s.backgroundSize : '',
            backgroundPosition: s ? s.backgroundPosition : '',
            backgroundRepeat: s ? s.backgroundRepeat : ''
        });
    }

    function paintClock() {
        const now = new Date();
        const t = timeParts(now);
        const date = fmtShort.format(now);
        const key = `${t.time}|${t.ampm}|${date}`;
        if (key === lastClock) return;
        lastClock = key;
        el.clock.textContent = t.time;
        el.ampm.textContent = t.ampm;
        el.date.textContent = date;
    }

    /** Unread mail, the count Today knows: on the handle, and a row of its own once the handle is pressed. */
    function paintMail() {
        let n = 0;
        try { const st = sh.todayState(); n = st && Number(st.mailUnread) > 0 ? Number(st.mailUnread) : 0; } catch (_) { n = 0; }
        if (n === mailCount) return;
        mailCount = n;
        el.slider.classList.toggle('has-count', n > 0);
        el.total.textContent = n > 0 ? String(n) : '';
        el.mailCount.textContent = n > 0 ? String(n) : '';
        el.caption.textContent = n > 0 ? 'tap or slide' : 'slide';
        if (!n) el.list.hidden = true;
    }

    function paint() {
        // the lock screen is up while the screen is off: nothing draws then; screen on paints it at once
        const sh = window.wmShell;
        if (sh && sh.onScreen && !sh.onScreen()) return;
        paintWall();
        paintClock();
        paintMail();
    }
    // screen on (or the page shown) while locked: drawn at once, not on the next second's tick
    window.addEventListener('melatonscreen', (e) => { if (tick && e.detail && e.detail.on) paint(); });
    document.addEventListener('visibilitychange', () => { if (tick && !document.hidden) paint(); });

    // ---------------------------------------------------------------- keys and the back button

    /** Keys do nothing while locked (device: Esc, Enter and both soft keys). Browser shortcuts pass. */
    function onKey(e) {
        if (!locked) return;
        if (e.ctrlKey || e.metaKey || e.altKey || /^F(5|1[12])$/.test(e.key)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }

    /**
     * The phone's back button while locked. The shell closes its top layer on a history pop
     * (wmShell.onPopState, called by exitConfirmation.js): while locked a pop inside the shell's
     * entries is taken and closes nothing, and the entry is put back (syncHistory). The shell's
     * own history.go() steps (a layer it closed itself) still reach it.
     */
    function wrapPopState() {
        const orig = sh.onPopState;
        if (typeof orig !== 'function' || orig._wmLock65) return;
        const wrapped = function (e) {
            if (!locked) return orig.call(sh, e);
            if (ownPops > 0) { ownPops--; return orig.call(sh, e); }
            const st = history.state;
            if (st && (st.wm === 'layer' || st.wm === 'root')) {
                // the entry goes back at once (after this pop: the shell pushes none inside one), so
                // the next back step is a history step again and not a direct close (Escape, which
                // is the Android app's back key, closes the top layer itself when no entry is left)
                swallowed = true;
                setTimeout(() => { if (locked && swallowed) { swallowed = false; try { sh.syncHistory(); } catch (_) { /* put back on unlock */ swallowed = true; } } }, 0);
                return true;
            }
            return orig.call(sh, e);
        };
        wrapped._wmLock65 = true;
        sh.onPopState = wrapped;
    }

    function watchHistoryGo(on) {
        if (on && !patchedGo) {
            const go = History.prototype.go;
            try {
                history.go = function (delta) { if (locked && Number(delta) < 0) ownPops++; return go.apply(history, arguments); };
                patchedGo = true;
            } catch (_) { /* a frozen history object: back steps are still taken */ }
        } else if (!on && patchedGo) {
            try { delete history.go; } catch (_) { /* stays, and passes through when not locked */ }
            patchedGo = false;
            ownPops = 0;
        }
    }

    // ---------------------------------------------------------------- lock / unlock

    function ready() {
        sh = window.wmShell;
        shell = document.getElementById('wmShell');
        return !!(sh && shell && sh.version === '6.5');
    }

    function setInert(on) {
        shell.querySelectorAll(':scope > .wm-content, :scope > .wm-softkeys, :scope > .wm-viewbar').forEach((n) => {
            if (on) n.setAttribute('inert', ''); else n.removeAttribute('inert');
        });
    }

    function lock() {
        if (locked) return true;
        if (!ready()) return false;
        // not over the boot (splash, installer) or a desktop surface that has the screen
        if ((root.dataset.wmBoot && root.dataset.wmBoot !== 'done') || root.dataset.wmTakeover) return false;
        if (!layer) build();
        wrapPopState();
        clearTimers();
        try { sh.closeMenus(); sh.closeBubble(); } catch (_) { /* nothing open */ }
        try { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch (_) { /* no focus */ }
        lastClock = '';
        lastWall = '\u0000';
        mailCount = -1;
        el.list.hidden = true;
        paint();
        locked = true;
        unlocking = false;
        swallowed = false;
        layer.style.clipPath = '';
        layer.hidden = false;
        shell.classList.add('wm-locked65', 'wm-locked65-title');
        setInert(true);
        watchHistoryGo(true);
        // Lock closes the Start screen: what was under it is there after unlocking (device)
        try { if (sh.current === 'start') sh.back(); } catch (err) { console.warn('[wmLock65] start', err); }
        enter(el.slider);
        clearInterval(tick);
        tick = setInterval(paint, 1000);
        document.dispatchEvent(new CustomEvent('wmLockChange', { detail: { locked: true } }));
        return true;
    }

    function finish(opts) {
        clearTimers();
        clearInterval(tick);
        tick = 0;
        layer.hidden = true;
        layer.style.clipPath = '';
        shell.classList.remove('wm-locked65', 'wm-locked65-title');
        setInert(false);
        el.slider.classList.remove('is-entry', 'is-idle', 'is-pressed');
        el.mail.classList.remove('is-entry', 'is-idle', 'is-pressed');
        locked = false;
        unlocking = false;
        watchHistoryGo(false);
        try {
            if (swallowed) sh.syncHistory();
            swallowed = false;
            if (opts && opts.app) sh.open(opts.app);
        } catch (err) { console.warn('[wmLock65] unlock', err); }
        document.dispatchEvent(new CustomEvent('wmLockChange', { detail: { locked: false } }));
    }

    /**
     * Unlock: the soft key bar first, then the title, then the screen in one frame (device).
     * opts.app: the program to open once unlocked (a notification's); opts.instant: no steps.
     */
    function unlock(opts) {
        if (!locked || unlocking) return false;
        if (opts && opts.instant) { finish(opts); return true; }
        unlocking = true;
        clearTimers();
        later(() => {
            const keys = shell.querySelector(':scope > .wm-softkeys');
            const h = keys ? keys.offsetHeight : 0;
            if (h) layer.style.clipPath = `inset(0 0 ${h}px 0)`;
        }, UNLOCK_KEYS_MS);
        later(() => shell.classList.remove('wm-locked65-title'), UNLOCK_TITLE_MS);
        later(() => finish(opts), UNLOCK_BODY_MS);
        return true;
    }

    /**
     * The art is fetched ahead: the screen comes up whole in one frame, as the device's does
     * (a first lock straight after a load otherwise shows the texts a moment before the handle
     * and the band).
     */
    function preload() {
        const dpr = window.devicePixelRatio || 1;
        // the densities wm-lock65.css offers: the image-set picks the first one at or above the dpr
        const x2 = dpr > 2 ? '@4x' : dpr > 1 ? '@2x' : '';
        const x4 = dpr > 2 ? '@4x' : '@2x';
        const names = [`ls-lockslider${x2}`, `ls-lockslider-dwn${x2}`, `ls-locksliderlong${x2}`, `ls-locksliderlong-dwn${x2}`,
            'ls-timebg@2x', `ls-arrows-l${x4}`, `ls-arrows-r${x4}`, `ls-icn-em-up${x4}`, `ls-icn-em-dn${x4}`];
        preload.kept = names.map((n) => { const img = new Image(); img.decoding = 'async'; img.src = `/static_images/wm65/${n}.png`; return img; });
    }
    const whenIdle = () => { if (typeof requestIdleCallback === 'function') requestIdleCallback(preload, { timeout: 4000 }); else setTimeout(preload, 1500); };
    if (window.wmShell) whenIdle(); else document.addEventListener('wmShellReady', whenIdle, { once: true });

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('keypress', onKey, true);

    window.wmLock = {
        lock,
        unlock,
        /** true while the lock screen is up. */
        get isLocked() { return locked; },
        locked: () => locked
    };
})();
