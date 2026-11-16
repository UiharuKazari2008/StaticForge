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
    // 6.5.1 (#850): the alarm page, the simple PIN page and the alarms themselves (the last part of this file)
    const R651 = root.dataset.wmRev === '6.5.1';

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
        bindSlide(el.slider, 66, () => slideUnlock(), () => { if (mailCount > 0) showList(); });
        bindSlide(el.mail, 77.5, () => slideUnlock({ app: 'messaging' }));
        if (R651) build651();
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
        if (R651) lock651();
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
        if (R651) unlock651();
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

    // ================================================================ 6.5.1 (#850)
    /*
     * Windows Mobile 6.5.3's lock screen pages, measured on the 6.5.3 emulator (480 x 640, thin 36 px
     * title bar) against the 6.5 one, with the ROM's LS_AlarmScene / LS_SimplePinScene layouts:
     *
     * The alarm page. An alarm that comes due while the device is locked takes the lock scene's
     *   place: the alarm clock (144 px), the alarm's time (Tahoma 22 pt, regular) and "Alarm: "
     *   plus its description ("No description" without one), a green Snooze slide and a red Dismiss
     *   slide, each a 200 x 88 px handle that runs 200 px to the right over three large chevrons.
     *   No slide handle, caption or time band while it is up. Pressing either handle fades both
     *   rows' chevrons out and shows its dark art; let go before the end and it runs back; at the
     *   end the lock scene is back in the next frame (the device stays locked). Snooze brings the
     *   same page back later with the alarm's own time (HKCU ControlPanel\Notifications\Reminders
     *   SnoozeTime 600 s; seen again 10 to 11 device minutes later).
     *   6.5 has the same page with a bold time that does not fit its box ("12:..."), a 192 px
     *   handle and small chevrons. Unlocked, both versions show the classic reminder bubble
     *   ("12:03 | Reminder", Dismiss | Menu) instead: wmShell.js draws that one.
     * The simple PIN page. With a password set (Settings > Lock), the slide's end shows the keypad
     *   in place of the lock scene: a 416 x 36 px entry bar with one dot a digit, keys 1-9, a
     *   backspace arrow, 0 and an X that goes back to the lock scene, and a row of three keys that
     *   check the PIN: unlock, unlock into Contacts, unlock into Messaging. A wrong PIN: the box
     *   "Password Incorrect" / "The password you typed is incorrect.", then an empty entry bar.
     *   6.5's page is the same one, 16 px lower under its taller title bar.
     *   The device's line "Emergency phone calls can be made." is left out: Melaton makes no calls
     *   from here, so it would not be true.
     * The PIN is kept as a salted PBKDF2-SHA-256 hash in this browser's storage (never the digits).
     * It keeps the screen private from someone who picks the phone up; it does not protect the
     * data behind it.
     *
     * Alarms (Settings > Clock & Alarms > Alarms, wmSettingsSystem.js) live on this device
     * (localStorage wmAlarms651): three, each with a time, the days, a description, a sound and how
     * it plays. One timer waits for the next one due; nothing polls. A page that was asleep at the
     * time rings when it wakes (within a day).
     */
    const escHtml = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtAlarm = (ms) => { try { return fmtTime.format(new Date(ms)); } catch (_) { return ''; } };

    // ---------------------------------------------------------------- 6.5.1: the simple PIN
    const PIN_KEY = 'wmLockPin651';
    // the device's "Prompt if phone unused for" list, in minutes
    const PIN_WAITS = [0, 1, 5, 15, 30, 60, 90, 120, 720, 1440];
    const PIN_ITER = 100000;
    let pinDigits = '';
    let pinOpts = null;
    let pinBusy = false;
    let askDone = null;     // pinAsk()'s answer while its keypad is up
    let idleAt = Date.now();
    let idleTimer = 0;
    let idleWatching = false;

    function pinState() {
        try {
            const p = JSON.parse(localStorage.getItem(PIN_KEY) || 'null');
            return p && typeof p.hash === 'string' && typeof p.salt === 'string' && p.hash && p.salt ? p : null;
        } catch (_) { return null; }
    }
    const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const pinCanHash = () => !!(window.crypto && crypto.subtle && typeof crypto.subtle.deriveBits === 'function');

    async function pinHash(pin, salt, iter) {
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
        return toB64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
    }

    /** Why a PIN cannot be used ('' when it can): the device's rule and its wording. */
    function pinProblem(pin) {
        const s = String(pin || '');
        let simple = s.length < 4 || !/^\d+$/.test(s);
        if (!simple) {
            const d = [...s].map(Number);
            const step = d[1] - d[0];
            // one digit repeated, or a run up or down (1111, 1234, 4321)
            if ((step === 0 || step === 1 || step === -1) && d.every((v, i) => i === 0 || v - d[i - 1] === step)) simple = true;
        }
        return simple ? 'Please enter another password. The password must be at least 4 characters and not contain a simple sequence (e.g. 1111 or 1234).' : '';
    }

    /** Set (or change) the PIN: only its salted hash is stored. opts { wait (minutes), hint }. */
    async function pinSet(pin, opts) {
        if (!pinCanHash() || pinProblem(pin)) return false;
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const old = pinState();
        const o = opts || {};
        const rec = {
            v: 1, salt: toB64(salt), iter: PIN_ITER, hash: await pinHash(pin, salt, PIN_ITER),
            wait: PIN_WAITS.includes(o.wait) ? o.wait : (old ? old.wait : 0),
            hint: typeof o.hint === 'string' ? o.hint.slice(0, 200) : (old ? old.hint || '' : '')
        };
        try { localStorage.setItem(PIN_KEY, JSON.stringify(rec)); } catch (_) { return false; }
        idleSync();
        return true;
    }

    /** The wait and the hint of a PIN that is set. */
    function pinUpdate(opts) {
        const p = pinState();
        if (!p) return false;
        if (opts && PIN_WAITS.includes(opts.wait)) p.wait = opts.wait;
        if (opts && typeof opts.hint === 'string') p.hint = opts.hint.slice(0, 200);
        try { localStorage.setItem(PIN_KEY, JSON.stringify(p)); } catch (_) { return false; }
        idleSync();
        return true;
    }

    function pinClear() {
        try { localStorage.removeItem(PIN_KEY); } catch (_) { /* nothing stored */ }
        idleSync();
    }

    async function pinVerify(pin) {
        const p = pinState();
        if (!p) return true;
        if (!pinCanHash()) return false;
        try { return (await pinHash(pin, fromB64(p.salt), Number(p.iter) || PIN_ITER)) === p.hash; } catch (_) { return false; }
    }

    /** The slide reached its end: unlocked, or the PIN page first. */
    function slideUnlock(opts) {
        if (R651 && pinState()) { showPin(opts || null); return; }
        unlock(opts);
    }

    function paintPin() {
        el.pinDots.textContent = '';
        for (let i = 0; i < pinDigits.length; i++) el.pinDots.appendChild(document.createElement('i'));
    }

    function showPin(opts) {
        pinOpts = opts;
        pinDigits = '';
        paintPin();
        el.list.hidden = true;
        el.pin.hidden = false;
        layer.classList.add('is-pin');
    }

    /** The X key: back to the lock scene. */
    function hidePin() {
        if (!el || el.pin.hidden) return;
        el.pin.hidden = true;
        pinDigits = '';
        pinOpts = null;
        layer.classList.remove('is-pin', 'is-ask');
        if (locked && !unlocking && el.alarm.hidden) enter(el.slider);
    }

    async function pinTry(app) {
        if (pinBusy || unlocking) return;
        pinBusy = true;
        let ok = false;
        try { ok = await pinVerify(pinDigits); } finally { pinBusy = false; }
        if (!locked || el.pin.hidden) return;
        if (ok) {
            const o = Object.assign({}, pinOpts || {}, app ? { app } : {});
            pinDigits = '';
            if (askDone) { const done = askDone; askDone = null; unlock({ instant: true }); done(true); return; }
            unlock(o.app ? o : undefined);
            return;
        }
        // device: the box, then an empty entry bar
        pinDigits = '';
        shell.classList.add('wm-lock65-box');
        try {
            // the device's two lines; ours adds where a forgotten PIN is reset (Yukimi, #850): the
            // PIN is kept on this device only, so nothing on the phone itself can give it back
            await sh.messageBox({ title: 'Password Incorrect', text: 'The password you typed is incorrect. If you have forgotten your PIN, go to the Domain Controller to reset the PIN number.', buttons: [{ text: 'OK', value: true }] });
        } catch (_) { /* no box: the bar is empty again */ }
        shell.classList.remove('wm-lock65-box');
        paintPin();
    }

    function pinKey(key) {
        if (pinBusy || unlocking) return;
        if (/^\d$/.test(key)) { if (pinDigits.length < 16) pinDigits += key; paintPin(); }
        else if (key === 'clear') { pinDigits = pinDigits.slice(0, -1); paintPin(); }
        else if (key === 'back') {
            if (askDone) { const done = askDone; askDone = null; unlock({ instant: true }); done(false); } else hidePin();
        }
        else if (key === 'unlock') pinTry('');
        else if (key === 'contacts') pinTry('contacts');
        else if (key === 'messaging') pinTry('messaging');
    }

    /**
     * Ask for the PIN before something that needs it (Settings > Lock; device: the same keypad
     * with one wide "Unlock" key in place of the three). Resolves true when the right PIN was
     * given or none is set, false when the X key backed out.
     */
    function pinAsk() {
        return new Promise((resolve) => {
            if (!pinState()) { resolve(true); return; }
            if (locked || askDone || !lock()) { resolve(false); return; }
            askDone = resolve;
            showPin(null);
            layer.classList.add('is-ask');
        });
    }

    // "Prompt if phone unused for": one timer for the time left, pushed back by a tap or a key;
    // 0 minutes locks when the screen goes off or the page is put away
    const idleTouch = () => { idleAt = Date.now(); };
    function idleArm() {
        clearTimeout(idleTimer);
        idleTimer = 0;
        const p = pinState();
        if (!p || locked || !(p.wait > 0)) return;
        const left = p.wait * 60000 - (Date.now() - idleAt);
        idleTimer = setTimeout(() => {
            idleTimer = 0;
            const q = pinState();
            if (!q || locked || !(q.wait > 0)) return;
            if (Date.now() - idleAt >= q.wait * 60000) lock(); else idleArm();
        }, Math.min(Math.max(1000, left), 0x7fffffff));
    }
    function idleSync() {
        const on = !!pinState();
        if (on && !idleWatching) {
            window.addEventListener('pointerdown', idleTouch, { capture: true, passive: true });
            window.addEventListener('keydown', idleTouch, { capture: true, passive: true });
            idleWatching = true;
            idleAt = Date.now();
        } else if (!on && idleWatching) {
            window.removeEventListener('pointerdown', idleTouch, { capture: true });
            window.removeEventListener('keydown', idleTouch, { capture: true });
            idleWatching = false;
        }
        idleArm();
    }
    /** The screen went off or came back (the page hidden or shown). */
    function idleScreen(on) {
        const p = pinState();
        if (!p || locked) return;
        if (!on) { if (p.wait === 0) lock(); return; }
        if (p.wait > 0 && Date.now() - idleAt >= p.wait * 60000) lock(); else idleArm();
    }

    // ---------------------------------------------------------------- 6.5.1: alarms
    const ALARM_KEY = 'wmAlarms651';
    const DAY_MS = 86400000;
    // the device's list on Alarm Settings (AlarmNotFlags), its default the third
    const ALARM_MODES = [['once', 'Play once'], ['repeat', 'Repeat'], ['repeat-vibrate', 'Repeat and Vibrate'], ['vibrate', 'Vibrate only']];
    const ALARM_SNOOZE_MIN = 10;      // the Snooze slide: SnoozeTime 600 s
    const ALARM_RING_MS = 120000;     // the sound gives up after two minutes; the alarm stays on screen
    // device defaults: 6:00 AM, Monday, Alarm-01, Repeat and Vibrate, off
    const alarmBlank = () => ({ on: false, time: 360, text: '', days: 2, sound: 'Alarm-01.mp3', mode: 'repeat-vibrate', since: 0, last: 0 });
    let alarmTimer = 0;
    let ringing = [];       // alarms on screen: { i, due, text, sound, mode, note }
    let ringSound = null;

    function alarmStore() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(ALARM_KEY) || 'null'); } catch (_) { s = null; }
        s = s && typeof s === 'object' ? s : {};
        const list = Array.isArray(s.list) ? s.list : [];
        return {
            list: [0, 1, 2].map((i) => {
                const a = Object.assign(alarmBlank(), list[i] && typeof list[i] === 'object' ? list[i] : {});
                a.time = Math.max(0, Math.min(1439, Math.round(Number(a.time)) || 0));
                a.days = (Number(a.days) || 0) & 127;
                if (!ALARM_MODES.some(([m]) => m === a.mode)) a.mode = 'repeat-vibrate';
                return a;
            }),
            loud: s.loud === true,
            snoozed: Array.isArray(s.snoozed) ? s.snoozed.filter((z) => z && Number.isFinite(z.at)) : []
        };
    }
    function alarmSave(s) {
        try { localStorage.setItem(ALARM_KEY, JSON.stringify(s)); } catch (_) { /* this session only */ }
    }

    /** The alarm's occurrence next after (dir 1) or last at or before (dir -1) a time; days 0 = any day. */
    function alarmOccurrence(a, from, dir) {
        for (let d = 0; d <= 7; d++) {
            const t = new Date(from);
            t.setDate(t.getDate() + d * dir);
            t.setHours(Math.floor(a.time / 60), a.time % 60, 0, 0);
            const ms = t.getTime();
            if (dir > 0 ? ms <= from : ms > from) continue;
            if (!a.days || (a.days & (1 << t.getDay()))) return ms;
        }
        return 0;
    }

    /** Ring what is due and wait for the next one (one timer; also run when the page wakes). */
    function alarmCheck() {
        clearTimeout(alarmTimer);
        alarmTimer = 0;
        const s = alarmStore();
        const now = Date.now();
        let next = Infinity;
        let dirty = alarmTakeHandled(s);
        const due = [];
        s.list.forEach((a, i) => {
            if (!a.on) return;
            const prev = alarmOccurrence(a, now, -1);
            if (prev && prev > Math.max(a.since || 0, a.last || 0, now - DAY_MS)) {
                a.last = prev;
                dirty = true;
                due.push({ i, due: prev, text: a.text, sound: a.sound, mode: a.mode });
            }
            const n = alarmOccurrence(a, now, 1);
            if (n) next = Math.min(next, n);
        });
        s.snoozed = s.snoozed.filter((z) => {
            if (z.at > now) { next = Math.min(next, z.at); return true; }
            dirty = true;
            due.push({ i: z.i, due: z.due, text: z.text, sound: z.sound, mode: z.mode });
            return false;
        });
        // stored before it rings: a second tab that looks next finds it taken
        if (dirty) alarmSave(s);
        due.forEach(alarmRing);
        if (next < Infinity) alarmTimer = setTimeout(alarmCheck, Math.min(next - now + 50, 0x7fffffff));
        alarmHandOver(s, now);
    }

    /*
     * The Android app rings the alarms while this page sleeps or is gone (#876, DeviceNotices.kt:
     * Android's alarm clock, the WM reminder notification, the alarm's own sound): it gets each alarm's
     * next time, and what was answered on its notification (Dismiss, Snooze) is taken here first, so a
     * dismissed alarm does not ring again when the page wakes.
     */
    const alarmApp = () => (window.AndroidAlarms && typeof window.AndroidAlarms.schedule === 'function' ? window.AndroidAlarms : null);
    let lastHandOver = '';
    function alarmHandOver(s, now) {
        const app = alarmApp();
        if (!app) return;
        const url = (f) => (f ? `${location.origin}/sounds/wm61/${encodeURIComponent(f)}` : '');
        const list = [];
        s.list.forEach((a, i) => {
            if (!a.on) return;
            const n = alarmOccurrence(a, now, 1);
            if (n) list.push({ i, at: n, due: n, text: a.text || '', sound: url(a.sound), mode: a.mode, loud: s.loud });
        });
        s.snoozed.forEach((z) => list.push({ i: z.i, at: z.at, due: z.due, text: z.text || '', sound: url(z.sound), mode: z.mode, loud: s.loud }));
        const json = JSON.stringify(list);
        if (json === lastHandOver) return;
        lastHandOver = json;
        try { app.schedule(json); } catch (_) { /* older app */ }
    }
    function alarmTakeHandled(s) {
        const app = alarmApp();
        if (!app || typeof app.takeHandled !== 'function') return false;
        let list = [];
        try { list = JSON.parse(app.takeHandled() || '[]'); } catch (_) { list = []; }
        if (!Array.isArray(list) || !list.length) return false;
        list.forEach((h) => {
            const a = s.list[h.i];
            if (!a || !Number.isFinite(h.due)) return;
            a.last = Math.max(a.last || 0, h.due);
            s.snoozed = s.snoozed.filter((z) => !(z.i === h.i && z.due === h.due));
            const file = String(h.sound || '').split('/').pop();
            if (Number.isFinite(h.snoozeAt)) s.snoozed.push({ i: h.i, at: h.snoozeAt, due: h.due, text: h.text, sound: file ? decodeURIComponent(file) : a.sound, mode: h.mode || a.mode });
            // already ringing here too (the page woke while it rang): put away as answered
            const r = ringing.find((x) => x.i === h.i && x.due === h.due);
            if (r) { ringing.splice(ringing.indexOf(r), 1); if (r.note) { try { r.note.close(); } catch (_) { /* gone */ } r.note = null; } if (!ringing.length) alarmSoundStop(); }
        });
        return true;
    }

    function alarmSoundStop() {
        const me = ringSound;
        ringSound = null;
        if (!me) return;
        clearTimeout(me.timer);
        try { if (me.src) { me.src.onended = null; me.src.stop(); } } catch (_) { /* ended */ }
    }

    /** The alarm's sound: once, or again a second after it ends ("Repeat"), with the motor where asked. */
    function alarmSoundStart(r) {
        alarmSoundStop();
        const api = sh && sh.sounds;
        const me = { src: null, timer: 0, until: Date.now() + ALARM_RING_MS };
        ringSound = me;
        const audible = r.mode !== 'vibrate' && !!r.sound;
        const buzz = r.mode === 'vibrate' || r.mode === 'repeat-vibrate';
        const repeat = r.mode !== 'once';
        const turn = async () => {
            me.timer = 0;
            if (ringSound !== me) return;
            if (buzz) { try { sh.vibrate('reminder'); } catch (_) { /* no motor */ } }
            let src = null;
            if (audible && api && typeof api.alarm === 'function') {
                try { src = await api.alarm(r.sound, alarmStore().loud); } catch (_) { src = null; }
            }
            if (ringSound !== me) { try { if (src) src.stop(); } catch (_) { /* ended */ } return; }
            me.src = src;
            if (!repeat || Date.now() > me.until) return;
            const again = () => { if (ringSound === me && !me.timer && Date.now() <= me.until) me.timer = setTimeout(turn, 1000); };
            // no sound came (silent mode, audio not unlocked yet): the next turn in four seconds
            if (src) src.onended = again; else me.timer = setTimeout(turn, 4000);
        };
        turn();
    }

    function alarmRing(r) {
        if (!ready()) return;
        // the app's ringing (its notification, sound and motor) gives way to this page's
        const app = alarmApp();
        if (app && typeof app.pageRinging === 'function') { try { app.pageRinging(); } catch (_) { /* older app */ } }
        ringing.push(r);
        alarmSoundStart(r);
        if (locked) alarmToLock(); else alarmNote(r);
    }

    /** Unlocked: the classic reminder notification, Dismiss | Menu (device, both versions). */
    function alarmNote(r) {
        if (r.note || typeof sh.appNote !== 'function') return;
        const at = timeParts(new Date()).time;
        r.note = sh.appNote({
            title: `${at} | Reminder`,
            // the hidden mark keeps two alarms of the same minute and text two notifications ("1 of 2")
            html: `<span class="wm-alarm651-note"><b>${escHtml(`Alarm: ${r.text || 'No description'}`)}</b><br>${escHtml(fmtAlarm(r.due))}<span hidden>${r.i}.${r.due}</span></span>`,
            icon: 'status-reminder',
            silent: true,
            softKeys: () => ({
                left: { label: 'Dismiss', icon: 'dismiss', action: () => alarmDone(r) },
                right: { label: 'Menu', icon: 'menu', menu: () => alarmMenu(r) }
            })
        });
    }

    /** The reminder's Menu, as the device lists it (the two it greys out stay grey: an alarm has no item to open). */
    function alarmMenu(r) {
        const snooze = (label, min) => ({ label, action: () => alarmDone(r, min) });
        return [
            { label: 'Dismiss All', action: () => ringing.slice().forEach((x) => alarmDone(x)) },
            { label: 'Remind 5 mins before', disabled: true },
            snooze('Snooze 5 minutes', 5), snooze('Snooze 10 minutes', 10), snooze('Snooze 15 minutes', 15),
            snooze('Snooze 1 hour', 60), snooze('Snooze 1 day', 1440),
            '-',
            { label: 'View Item', disabled: true }
        ];
    }

    /** Dismiss the alarm, or (minutes) put it off: it rings again then, with its own time. */
    function alarmDone(r, minutes) {
        const at = ringing.indexOf(r);
        if (at < 0) return;
        ringing.splice(at, 1);
        alarmSoundStop();
        if (r.note) { try { r.note.close(); } catch (_) { /* gone */ } r.note = null; }
        if (minutes > 0) {
            const s = alarmStore();
            s.snoozed.push({ i: r.i, at: Date.now() + minutes * 60000, due: r.due, text: r.text, sound: r.sound, mode: r.mode });
            alarmSave(s);
            alarmCheck();
        }
        if (ringing.length) alarmSoundStart(ringing[ringing.length - 1]);
        if (locked) alarmToLock();
    }

    /** Locked: the alarm page for the first alarm ringing, or the lock scene again when none is. */
    function alarmToLock() {
        if (!el || !el.alarm) return;
        const r = ringing[0];
        if (!r) {
            if (el.alarm.hidden) return;
            el.alarm.hidden = true;
            layer.classList.remove('is-alarm');
            if (locked && !unlocking && el.pin.hidden) enter(el.slider);
            return;
        }
        ringing.forEach((x) => { if (x.note) { try { x.note.close(); } catch (_) { /* gone */ } x.note = null; } });
        if (!el.pin.hidden) hidePin();
        el.list.hidden = true;
        el.alarmTime.textContent = fmtAlarm(r.due);
        el.alarmText.textContent = `Alarm: ${r.text || 'No description'}`;
        el.alarm.classList.remove('is-held');
        el.alarm.querySelectorAll('.wm-lock65-aslide').forEach((sl) => {
            if (sl._reset) sl._reset();
            sl.classList.remove('is-pressed', 'is-entry');
            void sl.offsetWidth;
            sl.classList.add('is-entry');
        });
        el.alarm.hidden = false;
        layer.classList.add('is-alarm');
    }

    /** An alarm page slide: the handle follows the pointer to the right, 100 units at most. */
    function bindAlarmSlide(slide, onEnd) {
        const handle = slide.querySelector('.wm-lock65-ahandle');
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
            const done = e && e.type === 'pointerup' && max > 0 && dx >= max - (max / 100) * 0.5;
            slide.classList.remove('is-pressed');
            el.alarm.classList.remove('is-held');
            handle.classList.add('is-returning');
            handle.style.transform = '';
            if (done) onEnd();
        };
        handle.addEventListener('pointerdown', (e) => {
            if (!locked || unlocking || id != null || (e.pointerType === 'mouse' && e.button !== 0)) return;
            e.preventDefault();
            id = e.pointerId;
            try { handle.setPointerCapture(id); } catch (_) { /* moves still arrive while over the layer */ }
            // one unit in CSS px, from the 44-unit slide
            max = 100 * (slide.getBoundingClientRect().height / 44 || 1);
            startX = e.clientX;
            dx = 0;
            handle.classList.remove('is-returning');
            slide.classList.remove('is-entry');
            slide.classList.add('is-pressed');
            el.alarm.classList.add('is-held');
        });
        handle.addEventListener('pointermove', (e) => {
            if (e.pointerId !== id) return;
            dx = Math.max(0, Math.min(max, e.clientX - startX));
            if (!frame) frame = requestAnimationFrame(place);
        });
        handle.addEventListener('pointerup', settle);
        handle.addEventListener('pointercancel', settle);
        handle.addEventListener('lostpointercapture', settle);
        slide._reset = () => { id = null; dx = 0; if (frame) { cancelAnimationFrame(frame); frame = 0; } handle.classList.remove('is-returning'); handle.style.transform = ''; };
    }

    // ---------------------------------------------------------------- 6.5.1: the two pages in the layer
    function build651() {
        const scene = layer.querySelector('.wm-lock65-scene');
        const aslide = (kind, label) => `<div class="wm-lock65-aslide" data-kind="${kind}">
                <div class="wm-lock65-apath"><i></i></div>
                <div class="wm-lock65-ahandle" aria-label="Slide to ${label.toLowerCase()}"><i data-art="up"></i><i data-art="dn"></i><span>${label}</span></div>
            </div>`;
        const key = (k, cls, inner, label) => `<button type="button" class="wm-lock65-key ${cls}" data-key="${k}" aria-label="${label}">${inner}</button>`;
        const digit = (n) => key(n, `is-d${n}`, n, n);
        scene.insertAdjacentHTML('beforeend', `<div class="wm-lock65-alarm" hidden>
                <div class="wm-lock65-form">
                    <i class="wm-lock65-alarm-art"></i>
                    <span class="wm-lock65-alarm-time"></span>
                    <span class="wm-lock65-alarm-text"></span>
                    ${aslide('snooze', 'Snooze')}
                    ${aslide('dismiss', 'Dismiss')}
                </div>
            </div>
            <div class="wm-lock65-pin" hidden>
                <div class="wm-lock65-form">
                    <div class="wm-lock65-pin-area"><span class="wm-lock65-pin-dots"></span></div>
                    <div class="wm-lock65-keys">
                        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => digit(String(n))).join('')}
                        ${key('clear', 'is-clear', '<i></i>', 'Backspace')}${digit('0')}${key('back', 'is-back', '<i></i>', 'Cancel')}
                    </div>
                    <div class="wm-lock65-unlock">
                        ${key('unlock', 'is-unlock', '<i></i><span>Unlock</span>', 'Unlock')}${key('contacts', 'is-contacts', '<i></i>', 'Unlock to Contacts')}${key('messaging', 'is-messaging', '<i></i>', 'Unlock to Messaging')}
                    </div>
                </div>
            </div>`);
        el.alarm = layer.querySelector('.wm-lock65-alarm');
        el.alarmTime = layer.querySelector('.wm-lock65-alarm-time');
        el.alarmText = layer.querySelector('.wm-lock65-alarm-text');
        el.pin = layer.querySelector('.wm-lock65-pin');
        el.pinDots = layer.querySelector('.wm-lock65-pin-dots');
        bindAlarmSlide(el.alarm.querySelector('[data-kind="snooze"]'), () => { if (ringing[0]) alarmDone(ringing[0], ALARM_SNOOZE_MIN); });
        bindAlarmSlide(el.alarm.querySelector('[data-kind="dismiss"]'), () => { if (ringing[0]) alarmDone(ringing[0]); });
        el.pin.querySelectorAll('.wm-lock65-key').forEach((b) => {
            // the layer swallows clicks: the keys act on the pen coming up over them
            b.addEventListener('click', () => pinKey(b.dataset.key));
        });
    }

    /** The lock screen came up: its plain scene, the tall form's layout, a ringing alarm's page. */
    function lock651() {
        el.pin.hidden = true;
        el.alarm.hidden = true;
        layer.classList.remove('is-pin', 'is-alarm', 'is-ask');
        pinDigits = '';
        pinOpts = null;
        clearTimeout(idleTimer);
        idleTimer = 0;
        // the forms of 800 px and taller put the keypad lower (LS_SimplePinScene_480x854: scene 409 units)
        const sc = layer.querySelector('.wm-lock65-scene').getBoundingClientRect();
        const unit = (el.slider.getBoundingClientRect().height / 40) || 1;
        layer.classList.toggle('is-tall', sc.height / unit >= 400);
        if (ringing.length) alarmToLock();
    }

    function unlock651() {
        if (el && el.pin) {
            el.pin.hidden = true;
            el.alarm.hidden = true;
            layer.classList.remove('is-pin', 'is-alarm', 'is-ask');
        }
        // unlocked some other way while pinAsk() waited: not answered
        if (askDone) { const done = askDone; askDone = null; done(false); }
        shell.classList.remove('wm-lock65-box');
        pinDigits = '';
        pinOpts = null;
        idleAt = Date.now();
        idleArm();
        // an alarm still ringing shows as its notification again
        ringing.forEach((r) => alarmNote(r));
    }

    function start651() {
        /** Run once the shell has started and no splash or takeover has the screen. */
        const whenUp = (fn) => {
            const up = () => !!window.wmShell && (!root.dataset.wmBoot || root.dataset.wmBoot === 'done');
            if (up()) { fn(); return; }
            const mo = new MutationObserver(() => { if (up()) { mo.disconnect(); fn(); } });
            mo.observe(root, { attributes: true, attributeFilter: ['data-wm-boot'] });
            document.addEventListener('wmShellReady', () => { if (up()) { mo.disconnect(); fn(); } }, { once: true });
        };
        let started = false;
        whenUp(() => {
            if (started || !ready()) return;
            started = true;
            // a phone that starts with a password set starts locked
            if (pinState()) lock();
            idleSync();
            alarmCheck();
        });
        window.addEventListener('melatonscreen', (e) => { if (!started || !e.detail) return; idleScreen(!!e.detail.on); if (e.detail.on) alarmCheck(); });
        document.addEventListener('visibilitychange', () => { if (!started) return; idleScreen(!document.hidden); if (!document.hidden) alarmCheck(); });
        // another tab of this browser changed the alarms or the PIN
        window.addEventListener('storage', (e) => { if (!started) return; if (e.key === ALARM_KEY) alarmCheck(); else if (e.key === PIN_KEY) idleSync(); });

        Object.assign(window.wmLock, {
            /** The simple PIN (6.5.1): only a salted hash is kept, on this device. */
            pin: {
                isSet: () => !!pinState(),
                canSet: pinCanHash,
                problem: pinProblem,
                set: pinSet,
                verify: pinVerify,
                update: pinUpdate,
                clear: pinClear,
                ask: pinAsk,
                waits: () => PIN_WAITS.slice(),
                settings: () => { const p = pinState(); return { on: !!p, wait: p ? Number(p.wait) || 0 : 0, hint: p ? p.hint || '' : '' }; }
            }
        });
        /** Alarms (6.5.1): Settings > Clock & Alarms > Alarms reads and writes them here. */
        window.wmAlarms = {
            modes: () => ALARM_MODES.map(([value, label]) => ({ value, label })),
            get: () => { const s = alarmStore(); return { list: s.list.map((a) => ({ on: a.on, time: a.time, text: a.text, days: a.days, sound: a.sound, mode: a.mode })), loud: s.loud }; },
            /** Store the three alarms and the "even when silent" switch; an alarm that changed counts from now. */
            set(next) {
                const s = alarmStore();
                const now = Date.now();
                (next && Array.isArray(next.list) ? next.list : []).slice(0, 3).forEach((n, i) => {
                    const a = s.list[i];
                    const was = JSON.stringify([a.on, a.time, a.days]);
                    Object.assign(a, { on: !!n.on, time: Math.max(0, Math.min(1439, Math.round(Number(n.time)) || 0)), text: String(n.text || '').slice(0, 63), days: (Number(n.days) || 0) & 127, sound: String(n.sound || ''), mode: n.mode });
                    if (JSON.stringify([a.on, a.time, a.days]) !== was) { a.since = now; s.snoozed = s.snoozed.filter((z) => z.i !== i); }
                });
                if (next && typeof next.loud === 'boolean') s.loud = next.loud;
                alarmSave(s);
                alarmCheck();
            },
            check: alarmCheck,
            ringing: () => ringing.map((r) => ({ i: r.i, due: r.due, text: r.text })),
            /** The alarm due next: { i, at } or null. */
            next() {
                const s = alarmStore();
                const now = Date.now();
                let best = null;
                s.list.forEach((a, i) => { if (!a.on) return; const n = alarmOccurrence(a, now, 1); if (n && (!best || n < best.at)) best = { i, at: n }; });
                s.snoozed.forEach((z) => { if (!best || z.at < best.at) best = { i: z.i, at: z.at }; });
                return best;
            }
        };
    }

    /**
     * Melaton Bars (#875): the lock screen staged for the app's copy of it (melatonBars.renderLock),
     * shown over the phone's own lock screen while Melaton Mobile's page is behind it. The layer is
     * shown in still frames (.is-copy) and put back as it was by restore(); nothing here locks.
     * Returns { layer, slider, handle, caption, time, wall, pin, area, dots, keys, unit, setTime(ms),
     * pinDots(n), restore() } or null.
     */
    function barsPrep() {
        if (!ready()) return null;
        if (!layer) build();
        // the keypad the phone's own PIN is typed on (6.5's device page is the same as 6.5.1's)
        if (!el.pin) build651();
        const slHandle = el.slider.querySelector('.wm-lock65-handle');
        const was = {
            hidden: layer.hidden, cls: layer.className, clip: layer.style.clipPath,
            slider: el.slider.className, handle: slHandle.style.transform, list: el.list.hidden,
            pin: el.pin.hidden, alarm: el.alarm.hidden, dots: el.pinDots.innerHTML,
            clock: el.clock.textContent, ampm: el.ampm.textContent, date: el.date.textContent
        };
        layer.classList.add('is-copy');
        layer.classList.remove('is-pin', 'is-alarm', 'is-ask');
        layer.style.clipPath = '';
        el.slider.classList.remove('is-entry', 'is-idle', 'is-pressed');
        slHandle.style.transform = '';
        el.list.hidden = true;
        el.pin.hidden = true;
        el.alarm.hidden = true;
        layer.hidden = false;
        // the picture and the mail count as lock() paints them (paint() waits for the screen)
        lastWall = '\u0000';
        mailCount = -1;
        paintWall();
        paintMail();
        const sc = layer.querySelector('.wm-lock65-scene').getBoundingClientRect();
        const unit = (el.slider.getBoundingClientRect().height / 40) || 1;
        layer.classList.toggle('is-tall', sc.height / unit >= 400);
        return {
            layer, slider: el.slider, handle: slHandle, caption: el.caption, wall: el.wall,
            time: layer.querySelector('.wm-lock65-time'),
            pin: el.pin, area: layer.querySelector('.wm-lock65-pin-area'), dots: el.pinDots,
            keys: [...el.pin.querySelectorAll('.wm-lock65-key')],
            // the handle's travel either way: 66 units of the 13-unit chevron box
            travel: 66 * (el.slider.querySelector('.wm-lock65-path').getBoundingClientRect().height / 13 || 1),
            setTime(ms) {
                const d = new Date(ms);
                const t = timeParts(d);
                el.clock.textContent = t.time;
                el.ampm.textContent = t.ampm;
                el.date.textContent = fmtShort.format(d);
            },
            pinDots(n) {
                el.pinDots.textContent = '';
                for (let i = 0; i < n; i++) el.pinDots.appendChild(document.createElement('i'));
            },
            restore() {
                layer.hidden = was.hidden;
                layer.className = was.cls;
                layer.style.clipPath = was.clip;
                el.slider.className = was.slider;
                slHandle.style.transform = was.handle;
                el.list.hidden = was.list;
                el.pin.hidden = was.pin;
                el.alarm.hidden = was.alarm;
                el.pinDots.innerHTML = was.dots;
                el.clock.textContent = was.clock;
                el.ampm.textContent = was.ampm;
                el.date.textContent = was.date;
                lastClock = '';
                el.pin.querySelectorAll('.wm-lock65-key.is-held').forEach((k) => k.classList.remove('is-held'));
            }
        };
    }

    window.wmLock = {
        lock,
        unlock,
        barsPrep,
        /** true while the lock screen is up. */
        get isLocked() { return locked; },
        locked: () => locked
    };
    if (R651) start651();

    // the Android app raises Main Battery Low while this page is not in front (#876, DeviceNotices.kt):
    // it gets the user's level (Settings > Power, wmShell.js wmBatteryLow) at each start
    try {
        if (window.AndroidAlarms && typeof window.AndroidAlarms.config === 'function') {
            const n = parseInt(localStorage.getItem('wmBatteryLow'), 10);
            if (Number.isFinite(n)) window.AndroidAlarms.config(JSON.stringify({ batteryLow: n }));
        }
    } catch (_) { /* older app or no storage */ }
})();
