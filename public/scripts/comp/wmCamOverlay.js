/**
 * Melaton Mobile: the speed camera approach strip (Yozora #1124). A strip at the bottom of the screen, above the soft key
 * bar, over every program: the camera's name and street, the current speed, the limit as a road sign, and a bar from where
 * the approach began to the camera. With it two soft tones (a pulse train for the limit and one for the speed) that beat
 * quicker as the camera nears and drift apart when the car is over the limit.
 *
 *   wmCamOverlay.update(approach)  the approach object of CafeTasks.lib.drive.approachOf (shows the strip, plays the tones);
 *                                  null hides it. show is the same call.
 *   wmCamOverlay.hide()            strip and tones away (the audio output is closed)
 *   wmCamOverlay.sample(dpr, write) the strip laid out once, off screen, for the Android app (melatonBars kit, lists.camOverlay)
 *
 * Power (rule phone-power-client): while no approach shows there is no timer, no audio context and no listener doing work.
 * Shown: one 100 ms look-ahead timer that schedules each pulse 250 ms ahead on the audio clock.
 */
(function () {
    'use strict';

    const ART = '/static_images/wm61/status-camera';
    const AHEAD_S = 0.25; // pulses are scheduled this far ahead on the audio clock
    const TICK_MS = 100;
    const ATTACK_S = 0.008;
    const FADE_S = 0.3;
    const HARMONIC = 0.15;

    let el = null;
    let shownId = '';
    let dismissedId = '';
    let last = null; // the approach on screen

    // ---------------------------------------------------------------- the strip

    function build() {
        const root = document.createElement('div');
        root.className = 'trf-camov';
        root.hidden = true;
        root.setAttribute('role', 'status');
        root.setAttribute('aria-label', 'Speed camera ahead');
        // no touches except a tap that puts it away for this camera
        root.setAttribute('data-wm-no-hold', '');
        const glyph = `<img src="${ART}.png" srcset="${ART}.png 1x, ${ART}@2x.png 2x, ${ART}@4x.png 4x" alt="" draggable="false">`;
        root.innerHTML = `<span class="trf-camov-ico">${glyph}</span>`
            + '<span class="trf-camov-title" data-live="title"></span>'
            + '<span class="trf-camov-street" data-live="street"></span>'
            + '<span class="trf-camov-speed" data-live="speed"></span>'
            + '<span class="trf-camov-sign"><span class="trf-camov-limit" data-live="limit"></span></span>'
            + '<span class="trf-camov-track"><i class="trf-camov-fill"></i></span>'
            + `<span class="trf-camov-end">${glyph}</span>`
            + '<span class="trf-camov-dist" data-live="dist"></span>';
        // app-scope: allow the strip's own element (lives as long as the page)
        root.addEventListener('click', (e) => {
            e.stopPropagation();
            if (last) dismissedId = last.id;
            teardown();
        });
        const host = document.getElementById('wmShell') || document.body;
        host.appendChild(root);
        return root;
    }

    /** The strip sits on the soft key bar (which rises with the keyboard): its top edge is the strip's bottom. */
    function place() {
        const soft = document.querySelector('#wmShell > .wm-softkeys');
        const r = soft && soft.getClientRects().length ? soft.getBoundingClientRect() : null;
        el.style.bottom = `${Math.max(0, Math.round((window.innerHeight - (r ? r.top : window.innerHeight)) * 100) / 100)}px`;
    }

    function paint(a) {
        el.classList.toggle('is-over', !!a.over);
        el.classList.toggle('is-nolimit', !a.limitText);
        const set = (cls, text) => { const n = el.querySelector(cls); if (n.textContent !== text) n.textContent = text; };
        set('.trf-camov-title', a.label || a.title || 'Speed camera');
        set('.trf-camov-street', a.street || '');
        set('.trf-camov-speed', a.speedText || '--');
        set('.trf-camov-limit', a.limitText || '');
        set('.trf-camov-dist', a.distText || '');
        el.querySelector('.trf-camov-fill').style.width = `${Math.round(Math.max(0, Math.min(1, a.progress || 0)) * 1000) / 10}%`;
    }

    // ---------------------------------------------------------------- the tones

    const audio = { ctx: null, master: null, timer: 0, plan: null, limitNext: 0, speedNext: 0, lastLimit: 0, lastSpeed: 0, locked: true, notBefore: 0, closing: null };

    function audioStart() {
        if (audio.ctx || document.visibilityState === 'hidden') return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
            audio.ctx = new AC();
            audio.master = audio.ctx.createGain();
            audio.master.gain.value = 1;
            audio.master.connect(audio.ctx.destination);
            if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => { /* needs a gesture: the tap that hides it is one */ });
        } catch (_) { audio.ctx = null; return; }
        const now = audio.ctx.currentTime;
        audio.limitNext = now + 0.05;
        audio.speedNext = 0;
        audio.lastLimit = audio.lastSpeed = 0;
        audio.locked = true;
        audio.notBefore = 0;
        audio.timer = setInterval(() => { if (document.visibilityState === 'hidden') return; tick(); }, TICK_MS);
        tick();
    }

    /** One pulse: a sine and 15 % of its second harmonic, a short linear attack, then an exponential decay to silence. */
    function pulse(hz, t, plan) {
        const c = audio.ctx;
        const dur = Math.max(0.05, plan.toneMs / 1000);
        const g = c.createGain();
        const peak = Math.max(0.0002, plan.gain / (1 + HARMONIC));
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + ATTACK_S);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur - 0.01);
        g.gain.linearRampToValueAtTime(0, t + dur);
        g.connect(audio.master);
        [[hz, 1], [hz * 2, HARMONIC]].forEach(([f, k]) => {
            const o = c.createOscillator();
            o.type = 'sine';
            o.frequency.value = f;
            const v = c.createGain();
            v.gain.value = k;
            o.connect(v);
            v.connect(g);
            o.start(t);
            o.stop(t + dur + 0.02);
            o.onended = () => { try { o.disconnect(); v.disconnect(); } catch (_) { /* gone */ } };
        });
        setTimeout(() => { try { g.disconnect(); } catch (_) { /* gone */ } }, (dur + 0.3) * 1000 + Math.max(0, (t - c.currentTime) * 1000));
    }

    function tick() {
        const c = audio.ctx;
        const p = audio.plan;
        if (!c || !p) return;
        const now = c.currentTime;
        const horizon = now + AHEAD_S;
        const period = p.periodMs / 1000;
        const sPeriod = Math.max(period * 0.5, p.speedPeriodMs / 1000);
        // a stalled page (throttled timer): never a burst of past pulses, the beat resumes on its own grid
        while (audio.limitNext < now - 0.02) audio.limitNext += period;
        if (!audio.locked) while (audio.speedNext < now - 0.02) audio.speedNext += sPeriod;
        while (audio.limitNext < horizon) {
            const t = audio.limitNext;
            if (p.limitHz > 0) { pulse(p.limitHz, t, p); audio.lastLimit = t; }
            // locked: the speed tone is on the same instant (one chord); after a re-lock it waits until it is 0.5 period
            // from its last pulse
            if (audio.locked && t >= audio.notBefore - 1e-6) { pulse(p.speedHz, t, p); audio.lastSpeed = t; }
            audio.limitNext = t + period;
        }
        if (!audio.locked) {
            while (audio.speedNext < horizon) {
                pulse(p.speedHz, audio.speedNext, p);
                audio.lastSpeed = audio.speedNext;
                audio.speedNext += sPeriod;
            }
        }
    }

    /** New parameters from the next pulse on; locked / drifting / re-lock decided here. */
    function applyPlan(p) {
        if (!p || !audio.ctx) { audio.plan = p || null; return; }
        const wasLocked = audio.locked;
        const lockedNow = p.speedPeriodMs >= p.periodMs;
        const period = p.periodMs / 1000;
        if (wasLocked && !lockedNow) {
            // it runs on its own clock from its last pulse
            audio.speedNext = (audio.lastSpeed || audio.limitNext - period) + p.speedPeriodMs / 1000;
        } else if (!wasLocked && lockedNow) {
            // re-lock: its next pulse lands on the limit train's next pulse, never closer than 0.5 period to its last
            audio.notBefore = audio.lastSpeed + 0.5 * period;
        }
        audio.locked = lockedNow;
        audio.plan = p;
    }

    function audioStop() {
        if (audio.timer) { clearInterval(audio.timer); audio.timer = 0; }
        const c = audio.ctx;
        audio.ctx = null;
        audio.plan = null;
        if (!c) return;
        // fade out over 300 ms, then the output is closed (not just suspended)
        try {
            const m = audio.master;
            m.gain.cancelScheduledValues(c.currentTime);
            m.gain.setValueAtTime(m.gain.value, c.currentTime);
            m.gain.linearRampToValueAtTime(0, c.currentTime + FADE_S);
        } catch (_) { /* closing anyway */ }
        setTimeout(() => { try { c.close(); } catch (_) { /* closed */ } }, FADE_S * 1000 + 50);
    }

    // ---------------------------------------------------------------- the module

    function onVisibility() {
        if (document.visibilityState === 'hidden') audioStop();
        else if (last && el && !el.hidden) { audioStart(); applyPlan(last.tones); }
    }

    function teardown() {
        audioStop();
        document.removeEventListener('visibilitychange', onVisibility);
        if (el) el.hidden = true;
        last = null;
        shownId = '';
    }

    function update(a) {
        if (!a || !a.id) { dismissedId = ''; teardown(); return; }
        if (a.id === dismissedId) return;
        if (!el) el = build();
        const first = !last;
        last = a;
        if (first || shownId !== a.id) { shownId = a.id; place(); }
        if (el.hidden) {
            el.hidden = false;
            // app-scope: allow added while the strip shows, removed in teardown
            document.addEventListener('visibilitychange', onVisibility);
        }
        paint(a);
        audioStart();
        applyPlan(a.tones);
    }

    function hide() { dismissedId = ''; teardown(); }

    // ---------------------------------------------------------------- the kit sample

    /**
     * The strip laid out once, closed, for the app's own copy (melatonBars kit, lists.camOverlay). write(elements) is the bars'
     * drawing-list maker (melatonBars layoutOf); nothing shows: laid out and put back inside the call.
     */
    function sample(dpr, write) {
        const k = Number(dpr) || window.devicePixelRatio || 1;
        const lay = typeof write === 'function' ? write : (window.melatonBars && window.melatonBars.layoutOf ? (els) => window.melatonBars.layoutOf(els, k) : null);
        if (!lay) return null;
        const made = !el;
        if (!el) el = build();
        const wasHidden = el.hidden;
        const wasOver = el.classList.contains('is-over');
        const wasNo = el.classList.contains('is-nolimit');
        const kept = ['.trf-camov-title', '.trf-camov-street', '.trf-camov-speed', '.trf-camov-limit', '.trf-camov-dist'].map((s) => [s, el.querySelector(s).textContent]);
        const fill = el.querySelector('.trf-camov-fill');
        const fillW = fill.style.width;
        const keptBottom = el.style.bottom;
        let out = null;
        try {
            place();
            el.hidden = false;
            el.classList.remove('is-nolimit');
            kept.forEach(([s]) => { el.querySelector(s).textContent = ''; });
            fill.style.width = '100%';
            const box = (n) => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * k * 100) / 100); };
            const root = el.getBoundingClientRect();
            const rel = (n) => { const b = box(n); return [Math.round((b[0] - root.left * k) * 100) / 100, Math.round((b[1] - root.top * k) * 100) / 100, b[2], b[3]]; };
            const shift = (items) => items.map((o) => {
                const c = Object.assign({}, o);
                if (typeof c.x === 'number') c.x = Math.round((c.x - root.left * k) * 100) / 100;
                if (typeof c.y === 'number') c.y = Math.round((c.y - root.top * k) * 100) / 100;
                if (Array.isArray(c.clip)) c.clip = [Math.round((c.clip[0] - root.left * k) * 100) / 100, Math.round((c.clip[1] - root.top * k) * 100) / 100].concat(c.clip.slice(2));
                return c;
            });
            // the frame has no moving part: the fill's place is the bar's box, drawn by the app
            const hideFill = () => { fill.style.visibility = 'hidden'; };
            hideFill();
            el.classList.remove('is-over');
            const frame = shift(lay([el]));
            el.classList.add('is-over');
            const frameOver = shift(lay([el]));
            el.classList.remove('is-over');
            // no limit known: the strip without its road sign
            el.classList.add('is-nolimit');
            const frameNoLimit = shift(lay([el]));
            el.classList.remove('is-nolimit');
            fill.style.visibility = '';
            const field = (sel, align) => {
                const n = el.querySelector(sel);
                const cs = getComputedStyle(n);
                return { box: rel(n), font: 'tahoma', bold: (+cs.fontWeight || 400) >= 600, sizePx: Math.round(parseFloat(cs.fontSize) * k * 100) / 100, color: cs.color, align };
            };
            const speed = field('.trf-camov-speed', 'left');
            el.classList.add('is-over');
            speed.colorOver = getComputedStyle(el.querySelector('.trf-camov-speed')).color;
            el.classList.remove('is-over');
            const barCs = getComputedStyle(fill);
            const track = el.querySelector('.trf-camov-track');
            const tcs = getComputedStyle(track);
            const inner = rel(fill);
            el.classList.add('is-over');
            const fillOver = getComputedStyle(fill).backgroundColor;
            el.classList.remove('is-over');
            out = {
                v: 1,
                w: Math.round(root.width * k * 100) / 100,
                h: Math.round(root.height * k * 100) / 100,
                frame,
                frameOver,
                frameNoLimit,
                fields: { title: field('.trf-camov-title', 'left'), street: field('.trf-camov-street', 'right'), speed, limit: field('.trf-camov-limit', 'center'), dist: field('.trf-camov-dist', 'right') },
                bar: { box: inner, fill: barCs.backgroundColor, fillOver, track: tcs.backgroundColor, radius: Math.round(parseFloat(barCs.borderTopLeftRadius) * k * 100) / 100 }
            };
        } catch (err) {
            console.warn('[wmCamOverlay] sample', err);
            out = null;
        } finally {
            kept.forEach(([s, t]) => { el.querySelector(s).textContent = t; });
            fill.style.width = fillW;
            fill.style.visibility = '';
            el.classList.toggle('is-over', wasOver);
            el.classList.toggle('is-nolimit', wasNo);
            el.style.bottom = keptBottom;
            el.hidden = wasHidden;
            if (made && wasHidden) { el.remove(); el = null; }
        }
        return out;
    }

    // app-scope: allow the shell's own overlay (Melaton Mobile, every program): wmTraffic and melatonBars call it
    window.wmCamOverlay = { show: update, update, hide, sample, shownId: () => (last ? last.id : '') };
})();
