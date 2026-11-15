/**
 * Melaton Mobile: Bin Toss (Yozora #836), an original 3D game for the phone: flick a ball of crumpled
 * paper into the wire waste basket across the room.
 *
 * Play: put a finger on the screen and flick up toward the basket. The direction of the flick aims
 * the throw, its speed sets how hard the paper is thrown (a calm, even flick is about right; a fast
 * one goes long and comes back off the wall). A draught crosses the room and changes after every
 * throw: the ribbon on the stand beside the basket leans with it, and the status row gives its side
 * and strength. Every paper in the basket adds one to the run; a miss ends the run. The draught
 * grows as the run does. Menu: the basket's distance (Near, Middle, Far), Options, Statistics.
 * The room: a sofa against the far wall with a cat on it (a throw that lands on the cat is a miss,
 * and she says so), a floor lamp, and over the sofa a framed picture that is one of the current
 * workspace's own pictures, picked at random each time the program starts. Options > Time of day:
 * Day (sun through the windows), Night (moonlight, the lamp on, the cat asleep) or Automatic (night
 * from 6 pm to 6 am).
 * Statistics: the best run at each distance, throws, papers in the basket.
 * Settings and statistics: localStorage wmGame:bintoss.
 *
 * Drawing: WebGL 2, everything made here (no models or textures to load): a room lit by the sun
 * through a row of windows (the light is followed back from each pixel to the window wall, so the
 * glazing bars fall across the floor, the basket and the far wall), a shadow map with a soft edge,
 * sky light from above and the floor's warmth from below, varnished boards, a wire basket drawn
 * with coverage (its mesh casts its own shadow), and paper balls that are creased spheres shaded by
 * facet. Detail (Options): High, or Low for slow phones (fewer shadow samples, one pixel a point).
 * Only on phones. Styles: public/css/wm-bintoss.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'bintoss';
    const TITLE = 'Bin Toss';
    const DEVELOPER = 'Academy City Research P.S.R.';
    const KEY = 'wmGame:bintoss';

    // ---------------------------------------------------------------- the room (metres)

    const WINDOW_PERIOD = 1.25; // a window every 1.25 m along the right wall
    // distances chosen so the sun through a window lands on the basket and on the thrower's hand
    const DISTANCES = { near: { label: 'Near', d: 2.15 }, middle: { label: 'Middle', d: 3.4 }, far: { label: 'Far', d: 4.65 } };
    const ROOM = { halfW: 2.6, wallH: 3.6, front: 2.4 };
    const BK = { H: 0.36, rTop: 0.2, rBot: 0.145, tube: 0.009 };
    const BALL_R = 0.05;
    const HAND = [0, 0.92, 0.35];
    const EYE = [0, 1.35, 1.15];
    const THROW_ELEV = 42 * Math.PI / 180;
    const GRAV = 9.81;
    const DRAG = 0.28;
    const WIND_ACC = 0.36; // m/s2 sideways for each point of draught
    const SUN = norm([0.75, 0.5, 0.15]); // toward the sun
    const STEP = 1 / 240;
    const MAX_BALLS = 16;
    const WALL_GAP = 1.6; // the far wall behind the basket
    const SOFA = { halfW: 0.95, depth: 0.85, seatTop: 0.45, backTop: 0.88, armTop: 0.61, armW: 0.17 };
    const CAT = { x: 0.42, r: 0.15 };
    const LAMP = { x: -1.32, top: 1.62 };

    function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // ---------------------------------------------------------------- state

    let ws = null;
    let page = null;
    let cv = null;
    let gl = null;
    let R = null; // GL resources
    let view = 'main';
    let draft = null;
    let raf = 0;
    let lastFrame = 0;
    let acc = 0;
    let clock = 0;
    let idleSkip = false;
    let audio = null;

    let dist = DISTANCES.middle.d;
    let throwSpeed = 6; // the speed that lands in the basket in still air
    let balls = []; // { p, v, axis, angle, spin, wind, rest, restT, t, inside, scored, resolved, touched }
    let hand = null; // { x, y, grab } the paper waiting to be thrown
    let handAt = 0; // when the next paper appears
    let wind = 0;
    let windShown = 0; // the ribbon follows the draught with a lag
    let run = 0;
    let press = null;
    let noteTimer = 0;
    let threw = false;
    let solid = { boxes: [], cat: [0, 0, 0] }; // what a paper can land on besides the floor and the basket
    let night = false;
    let meowAt = -10;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ---------------------------------------------------------------- storage

    const DEFAULTS = { distance: 'middle', sounds: true, detail: 'high', time: 'auto' };
    function store() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } }
    function storePut(patch) { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(store(), patch))); } catch (_) { /* private mode */ } }
    function settings() { const s = Object.assign({}, DEFAULTS, store().settings || {}); if (!DISTANCES[s.distance]) s.distance = 'middle'; return s; }
    function blankStats() { return { best: { near: 0, middle: 0, far: 0 }, throws: 0, hits: 0 }; }
    function stats() { const s = Object.assign(blankStats(), store().stats || {}); s.best = Object.assign(blankStats().best, s.best || {}); return s; }

    // ---------------------------------------------------------------- physics

    function bounce(b, n, e, keep) {
        const vn = b.v[0] * n[0] + b.v[1] * n[1] + b.v[2] * n[2];
        if (vn >= 0) return 0;
        for (let i = 0; i < 3; i++) {
            const along = vn * n[i];
            b.v[i] = (b.v[i] - along) * keep - along * e;
        }
        // the knock changes how it tumbles
        b.spin = (b.spin * 0.5) + (Math.random() - 0.5) * Math.min(14, -vn * 6);
        b.touched = true;
        return -vn;
    }

    /** One step of one paper ball. events: { rim, side, floor, wall, bottom } hardest hit speed (sounds). */
    function stepBall(b, dt, basketZ, statics, events) {
        const p = b.p;
        const v = b.v;
        const w = b.touched ? 0 : b.wind;
        v[0] += (WIND_ACC * w - DRAG * v[0]) * dt;
        v[1] += (-GRAV - DRAG * v[1]) * dt;
        v[2] += -DRAG * v[2] * dt;
        p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
        b.angle += b.spin * dt;
        b.t += dt;
        let contact = false;
        const note = (k, s) => { if (events && s > (events[k] || 0)) events[k] = s; };

        // the basket: its rim (a ring), its side (a cone), its bottom
        const dx = p[0];
        const dz = p[2] - basketZ;
        const rad = Math.hypot(dx, dz) || 1e-6;
        const ux = dx / rad;
        const uz = dz / rad;
        {
            const ex = p[0] - ux * BK.rTop;
            const ey = p[1] - BK.H;
            const ez = p[2] - (basketZ + uz * BK.rTop);
            const d = Math.hypot(ex, ey, ez);
            const min = BALL_R + BK.tube;
            if (d < min && d > 1e-6) {
                const n = [ex / d, ey / d, ez / d];
                p[0] += n[0] * (min - d); p[1] += n[1] * (min - d); p[2] += n[2] * (min - d);
                note('rim', bounce(b, n, 0.42, 0.92));
                contact = true;
            }
        }
        b.inside = false;
        if (p[1] < BK.H) {
            const rw = BK.rBot + (BK.rTop - BK.rBot) * clamp(p[1] / BK.H, 0, 1);
            if (rad < rw) {
                b.inside = true;
                if (rad + BALL_R > rw) {
                    const n = [-ux, 0, -uz];
                    const over = rad + BALL_R - rw;
                    p[0] += n[0] * over; p[2] += n[2] * over;
                    note('side', bounce(b, n, 0.25, 0.8));
                    contact = true;
                }
                if (p[1] - BALL_R < 0.014) {
                    p[1] = 0.014 + BALL_R;
                    if (v[1] < 0) { note('bottom', -v[1]); v[1] *= -0.15; v[0] *= 0.6; v[2] *= 0.6; b.touched = true; }
                    contact = true;
                }
                if (!b.scored && p[1] < BK.H - 0.03 && rad < rw - BALL_R * 0.2) b.scored = true;
            } else if (rad - BALL_R < rw) {
                const n = [ux, 0, uz];
                const over = rw - (rad - BALL_R);
                p[0] += n[0] * over; p[2] += n[2] * over;
                note('side', bounce(b, n, 0.35, 0.9));
                contact = true;
            }
        }

        // papers already lying about
        for (const o of statics) {
            if (o === b) continue;
            const ex = p[0] - o.p[0];
            const ey = p[1] - o.p[1];
            const ez = p[2] - o.p[2];
            const d = Math.hypot(ex, ey, ez);
            if (d < BALL_R * 1.9 && d > 1e-6) {
                const n = [ex / d, ey / d, ez / d];
                const over = BALL_R * 1.9 - d;
                p[0] += n[0] * over; p[1] += n[1] * over; p[2] += n[2] * over;
                bounce(b, n, 0.2, 0.8);
                contact = true;
            }
        }

        // the sofa: soft boxes (seat, back, arms); a paper that lands there has missed
        for (const [x0, x1, y0, y1, z0, z1] of solid.boxes) {
            const qx = clamp(p[0], x0, x1);
            const qy = clamp(p[1], y0, y1);
            const qz = clamp(p[2], z0, z1);
            const ex = p[0] - qx;
            const ey = p[1] - qy;
            const ez = p[2] - qz;
            const d = Math.hypot(ex, ey, ez);
            if (d >= BALL_R) continue;
            const n = d > 1e-6 ? [ex / d, ey / d, ez / d] : [0, 1, 0];
            const over = d > 1e-6 ? BALL_R - d : y1 - p[1] + BALL_R;
            p[0] += n[0] * over; p[1] += n[1] * over; p[2] += n[2] * over;
            note('soft', bounce(b, n, 0.22, 0.6));
            if (n[1] > 0.5) { v[0] *= 1 - 4 * dt; v[2] *= 1 - 4 * dt; }
            if (!b.scored) b.landed = true;
            contact = true;
        }
        // the cat
        {
            const ex = p[0] - solid.cat[0];
            const ey = p[1] - solid.cat[1];
            const ez = p[2] - solid.cat[2];
            const d = Math.hypot(ex, ey, ez);
            if (d < CAT.r + BALL_R && d > 1e-6) {
                const n = [ex / d, ey / d, ez / d];
                const over = CAT.r + BALL_R - d;
                p[0] += n[0] * over; p[1] += n[1] * over; p[2] += n[2] * over;
                bounce(b, n, 0.3, 0.7);
                // nothing rests on a cat: it slides off, toward the room when it sits dead on top
                const h = Math.hypot(ex, ez);
                p[0] += (h > 0.02 ? ex / h : 0) * 0.5 * dt;
                p[2] += (h > 0.02 ? ez / h : 1) * 0.5 * dt;
                if (!b.hitCat) { b.hitCat = true; if (events) events.cat = 1; }
                if (!b.scored) b.landed = true;
            }
        }

        // floor and walls
        if (!b.inside && p[1] - BALL_R < 0) {
            p[1] = BALL_R;
            if (v[1] < 0) {
                note('floor', -v[1]);
                bounce(b, [0, 1, 0], 0.36, 0.72);
                if (!b.scored) b.landed = true;
            }
            v[0] *= 1 - 2.5 * dt; v[2] *= 1 - 2.5 * dt;
            contact = true;
        }
        const zWall = basketZ - WALL_GAP;
        if (p[2] - BALL_R < zWall) { p[2] = zWall + BALL_R; note('wall', bounce(b, [0, 0, 1], 0.4, 0.85)); }
        if (p[2] + BALL_R > ROOM.front) { p[2] = ROOM.front - BALL_R; bounce(b, [0, 0, -1], 0.4, 0.85); }
        if (p[0] - BALL_R < -ROOM.halfW) { p[0] = -ROOM.halfW + BALL_R; note('wall', bounce(b, [1, 0, 0], 0.4, 0.85)); }
        if (p[0] + BALL_R > ROOM.halfW) { p[0] = ROOM.halfW - BALL_R; note('wall', bounce(b, [-1, 0, 0], 0.4, 0.85)); }

        const speed = Math.hypot(v[0], v[1], v[2]);
        if (contact && speed < 0.2 && b.t > 0.3) {
            b.restT += dt;
            if (b.restT > 0.2) { b.rest = true; b.spin = 0; v[0] = v[1] = v[2] = 0; }
        } else b.restT = 0;
        if (b.t > 7) { b.rest = true; b.spin = 0; }
    }

    function launchVelocity(speed, yaw) {
        const c = Math.cos(THROW_ELEV);
        return [Math.sin(yaw) * c * speed, Math.sin(THROW_ELEV) * speed, -Math.cos(yaw) * c * speed];
    }

    /** The throw speed that drops the paper into the middle of the basket d metres away, in still air. */
    function solveSpeed(d) {
        const land = (speed) => {
            const b = { p: HAND.slice(), v: launchVelocity(speed, 0), wind: 0, t: 0 };
            for (let i = 0; i < 2400; i++) {
                b.v[1] += (-GRAV - DRAG * b.v[1]) * STEP;
                b.v[2] += -DRAG * b.v[2] * STEP;
                b.p[1] += b.v[1] * STEP; b.p[2] += b.v[2] * STEP;
                if (b.v[1] < 0 && b.p[1] < BK.H + 0.06) return b.p[2];
            }
            return b.p[2];
        };
        let lo = 2;
        let hi = 14;
        for (let i = 0; i < 28; i++) {
            const mid = (lo + hi) / 2;
            if (land(mid) > -d) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    // ---------------------------------------------------------------- the game

    function newDraught() {
        const top = Math.min(3, 0.7 + run * 0.23);
        if (run < 2 && Math.random() < 0.25) { wind = 0; return; }
        const w = (0.3 + Math.random() * (top - 0.3)) * (Math.random() < 0.5 ? -1 : 1);
        wind = Math.round(w * 10) / 10;
    }

    function isNight() {
        const t = settings().time;
        if (t === 'day' || t === 'night') return t === 'night';
        const h = new Date().getHours();
        return h < 6 || h >= 18;
    }

    function setDistance(key, keepRun) {
        const s = settings();
        if (!DISTANCES[key]) key = 'middle';
        if (s.distance !== key) { s.distance = key; storePut({ settings: s }); }
        dist = DISTANCES[key].d;
        night = isNight();
        const zWall = -dist - WALL_GAP;
        const zb = zWall + 0.04;
        const zf = zb + SOFA.depth;
        solid = {
            boxes: [
                [-SOFA.halfW, SOFA.halfW, 0, SOFA.seatTop, zb, zf],
                [-SOFA.halfW, SOFA.halfW, 0, SOFA.backTop, zWall, zb + 0.34],
                [-SOFA.halfW, -SOFA.halfW + SOFA.armW, 0, SOFA.armTop, zb, zf],
                [SOFA.halfW - SOFA.armW, SOFA.halfW, 0, SOFA.armTop, zb, zf]
            ],
            cat: [CAT.x, SOFA.seatTop + 0.08, zf - 0.36]
        };
        throwSpeed = solveSpeed(dist);
        balls = [];
        if (!keepRun) run = 0;
        newDraught();
        windShown = wind;
        hand = { x: 0, y: 0, grab: false };
        handAt = 0;
        if (R) buildRoom();
        renderStatus();
    }

    function newGame() {
        endRun();
        setDistance(settings().distance, false);
        note('');
    }

    function endRun() {
        if (!run) return;
        const st = stats();
        const k = settings().distance;
        if (run > (st.best[k] || 0)) { st.best[k] = run; storePut({ stats: st }); }
        run = 0;
    }

    function throwPaper(yaw, power) {
        if (!hand) return;
        const b = {
            p: [HAND[0] + hand.x, HAND[1] + hand.y, HAND[2]], v: launchVelocity(throwSpeed * power, yaw),
            axis: norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), angle: Math.random() * 6.28, spin: 5 + Math.random() * 6,
            wind, rest: false, restT: 0, t: 0, inside: false, scored: false, landed: false, resolved: false, touched: false
        };
        balls.push(b);
        hand = null;
        handAt = 0;
        threw = true;
        const st = stats();
        st.throws += 1;
        storePut({ stats: st });
        sound('throw');
    }

    function resolve(b) {
        b.resolved = true;
        if (b.scored) {
            run += 1;
            const st = stats();
            st.hits += 1;
            const k = settings().distance;
            if (run > (st.best[k] || 0)) st.best[k] = run;
            storePut({ stats: st });
            sound('in');
            note(run > 1 ? `In! ${run} in a row` : 'In!', true);
        } else {
            if (clock - meowAt < 1) { /* the cat has said it */ } else if (run > 1) note(`Missed. The run ends at ${run}.`);
            else note('Missed');
            endRun();
            sound('miss');
        }
        newDraught();
        handAt = clock + 0.45;
        renderStatus();
    }

    function simulate(dt) {
        acc = Math.min(0.1, acc + dt);
        const events = {};
        while (acc >= STEP) {
            acc -= STEP;
            clock += STEP;
            const statics = balls.filter((b) => b.rest);
            for (const b of balls) {
                if (b.rest) continue;
                stepBall(b, STEP, -dist, statics, events);
                if (!b.resolved && (b.scored || b.landed || b.rest)) resolve(b);
            }
        }
        if (events.rim > 0.5) sound('rim', events.rim);
        else if (events.side > 0.6) sound('rim', events.side * 0.6);
        if (events.floor > 0.6 || events.wall > 0.8 || events.bottom > 0.6) sound('thud', Math.max(events.floor || 0, events.wall || 0, events.bottom || 0));
        else if (events.soft > 0.8) sound('thud', events.soft * 0.5);
        if (events.cat) { meowAt = clock; sound('meow'); note('Sorry, kitty!'); }
        if (!hand && handAt && clock >= handAt) { hand = { x: 0, y: 0, grab: false }; handAt = 0; }
        // old papers on the floor go first when there are too many
        while (balls.length > MAX_BALLS) {
            const i = balls.findIndex((b) => b.rest && !b.inside);
            balls.splice(i >= 0 ? i : 0, 1);
        }
        windShown += (wind - windShown) * Math.min(1, dt * 3);
    }

    // ---------------------------------------------------------------- sound

    function sound(kind, strength) {
        if (!settings().sounds) return;
        try {
            if (ws.sounds && typeof ws.sounds.silent === 'function' && ws.sounds.silent()) return;
            if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
            if (audio.state === 'suspended') audio.resume();
            const now = audio.currentTime;
            const tone = (f, t, d, type, vol) => {
                const o = audio.createOscillator();
                const g = audio.createGain();
                o.type = type; o.frequency.value = f;
                g.gain.setValueAtTime(vol, now + t);
                g.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
                o.connect(g).connect(audio.destination);
                o.start(now + t); o.stop(now + t + d + 0.02);
            };
            // a breath of filtered noise: the paper through the air, on the floor, in the basket
            const hiss = (t, d, freq, q, vol, type) => {
                const n = Math.max(1, Math.floor(audio.sampleRate * d));
                const buf = audio.createBuffer(1, n, audio.sampleRate);
                const data = buf.getChannelData(0);
                for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
                const src = audio.createBufferSource();
                src.buffer = buf;
                const f = audio.createBiquadFilter();
                f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
                const g = audio.createGain();
                g.gain.value = vol;
                src.connect(f).connect(g).connect(audio.destination);
                src.start(now + t);
            };
            const k = clamp((strength || 1) / 4, 0.15, 1);
            if (kind === 'throw') hiss(0, 0.16, 1800, 0.8, 0.10);
            else if (kind === 'rim') { tone(2140, 0, 0.11, 'sine', 0.05 * k); tone(3210, 0, 0.07, 'sine', 0.03 * k); hiss(0, 0.04, 3000, 1, 0.05 * k); }
            else if (kind === 'thud') hiss(0, 0.07, 420, 0.7, 0.16 * k, 'lowpass');
            else if (kind === 'in') { hiss(0, 0.12, 2400, 0.6, 0.09); tone(784, 0.05, 0.1, 'triangle', 0.07); tone(1175, 0.15, 0.18, 'triangle', 0.07); }
            else if (kind === 'miss') tone(196, 0.05, 0.16, 'triangle', 0.05);
            else if (kind === 'meow') {
                // a small voice that rises and falls
                const o = audio.createOscillator();
                const g = audio.createGain();
                const f = audio.createBiquadFilter();
                o.type = 'sawtooth';
                o.frequency.setValueAtTime(620, now);
                o.frequency.linearRampToValueAtTime(980, now + 0.12);
                o.frequency.linearRampToValueAtTime(700, now + 0.38);
                f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 2.5;
                g.gain.setValueAtTime(0.0001, now);
                g.gain.linearRampToValueAtTime(0.09, now + 0.05);
                g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
                o.connect(f).connect(g).connect(audio.destination);
                o.start(now); o.stop(now + 0.45);
            }
        } catch (_) { /* no audio */ }
    }

    // ---------------------------------------------------------------- matrices (column-major)

    function perspective(fovy, aspect, near, far) {
        const f = 1 / Math.tan(fovy / 2);
        const nf = 1 / (near - far);
        return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    }

    function ortho(l, r, b, t, n, f) {
        return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
    }

    function lookAt(eye, at, up) {
        const z = norm([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
        const x = norm([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
        const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        return new Float32Array([
            x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
            -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]), -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]), -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1
        ]);
    }

    function mul(a, b) {
        const o = new Float32Array(16);
        for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
            }
        }
        return o;
    }

    /** Turn about `axis` by `angle`, scale s, then move to t. */
    function trs(axis, angle, t, s) {
        const [x, y, z] = axis;
        const c = Math.cos(angle);
        const si = Math.sin(angle);
        const k = 1 - c;
        return new Float32Array([
            (c + x * x * k) * s, (y * x * k + z * si) * s, (z * x * k - y * si) * s, 0,
            (x * y * k - z * si) * s, (c + y * y * k) * s, (z * y * k + x * si) * s, 0,
            (x * z * k + y * si) * s, (y * z * k - x * si) * s, (c + z * z * k) * s, 0,
            t[0], t[1], t[2], 1
        ]);
    }

    const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    // ---------------------------------------------------------------- meshes (pos 3, normal 3, uv 2)

    function builder() {
        const v = [];
        const put = (p, n, uv) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]);
        const api = {
            v,
            get count() { return v.length / 8; },
            // corners counter-clockwise seen from the side the normal points to
            quad(a, b, c, d, n, uvs) {
                const t = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
                put(a, n, t[0]); put(b, n, t[1]); put(c, n, t[2]);
                put(a, n, t[0]); put(c, n, t[2]); put(d, n, t[3]);
            },
            box(cx, cy, cz, sx, sy, sz) {
                const x0 = cx - sx / 2; const x1 = cx + sx / 2;
                const y0 = cy - sy / 2; const y1 = cy + sy / 2;
                const z0 = cz - sz / 2; const z1 = cz + sz / 2;
                api.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
                api.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
                api.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
                api.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
                api.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
                api.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
            },
            // a cone's side between two rings (the basket, the stand): uv runs around and up
            tube(cx, cz, y0, r0, y1, r1, segs) {
                const slope = (r0 - r1) / (y1 - y0);
                for (let i = 0; i < segs; i++) {
                    const a0 = i / segs * Math.PI * 2;
                    const a1 = (i + 1) / segs * Math.PI * 2;
                    const n0 = norm([Math.cos(a0), slope, Math.sin(a0)]);
                    const n1 = norm([Math.cos(a1), slope, Math.sin(a1)]);
                    const p = (a, r, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
                    put(p(a0, r0, y0), n0, [i / segs, 0]); put(p(a0, r1, y1), n0, [i / segs, 1]); put(p(a1, r1, y1), n1, [(i + 1) / segs, 1]);
                    put(p(a0, r0, y0), n0, [i / segs, 0]); put(p(a1, r1, y1), n1, [(i + 1) / segs, 1]); put(p(a1, r0, y0), n1, [(i + 1) / segs, 0]);
                }
            },
            disc(cx, y, cz, r, segs) {
                for (let i = 0; i < segs; i++) {
                    const a0 = i / segs * Math.PI * 2;
                    const a1 = (i + 1) / segs * Math.PI * 2;
                    put([cx, y, cz], [0, 1, 0], [0.5, 0.5]);
                    put([cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], [0, 1, 0], [1, 1]);
                    put([cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], [0, 1, 0], [1, 0]);
                }
            },
            // a cushion: a box with all its edges rounded (e = 2 a ball, larger squarer), exact normals
            pillow(cx, cy, cz, hx, hy, hz, e) {
                const ball = unitBall();
                const pw = 2 / e;
                const nw = 2 - 2 / e;
                const f = (d, w) => Math.sign(d) * Math.pow(Math.abs(d), w);
                for (let i = 0; i < ball.length; i += 3) {
                    const d = [ball[i], ball[i + 1], ball[i + 2]];
                    put([cx + f(d[0], pw) * hx, cy + f(d[1], pw) * hy, cz + f(d[2], pw) * hz], norm([f(d[0], nw) / hx, f(d[1], nw) / hy, f(d[2], nw) / hz]), [0, 0]);
                }
            },
            // a ring of round wire (the basket's rim and foot)
            torus(cx, y, cz, major, minor, segs, sides) {
                const at = (i, j) => {
                    const a = i / segs * Math.PI * 2;
                    const b = j / sides * Math.PI * 2;
                    const n = [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)];
                    return { p: [cx + Math.cos(a) * major + n[0] * minor, y + n[1] * minor, cz + Math.sin(a) * major + n[2] * minor], n };
                };
                for (let i = 0; i < segs; i++) {
                    for (let j = 0; j < sides; j++) {
                        const a = at(i, j); const b = at(i + 1, j); const c = at(i + 1, j + 1); const d = at(i, j + 1);
                        put(a.p, a.n, [0, 0]); put(d.p, d.n, [0, 1]); put(c.p, c.n, [1, 1]);
                        put(a.p, a.n, [0, 0]); put(c.p, c.n, [1, 1]); put(b.p, b.n, [1, 0]);
                    }
                }
            }
        };
        return api;
    }

    // a sphere of 1280 faces as corner directions (three numbers a corner), made once
    let ballDirs = null;
    function unitBall() {
        if (!ballDirs) {
            const { verts, faces } = icosphere(3);
            ballDirs = [];
            faces.forEach((f) => f.forEach((i) => ballDirs.push(verts[i][0], verts[i][1], verts[i][2])));
        }
        return ballDirs;
    }

    function icosphere(levels) {
        const t = (1 + Math.sqrt(5)) / 2;
        const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
        let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
            [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
        for (let s = 0; s < levels; s++) {
            const mid = new Map();
            const half = (a, b) => {
                const k = a < b ? a + '_' + b : b + '_' + a;
                if (!mid.has(k)) { verts.push(norm([verts[a][0] + verts[b][0], verts[a][1] + verts[b][1], verts[a][2] + verts[b][2]])); mid.set(k, verts.length - 1); }
                return mid.get(k);
            };
            const next = [];
            faces.forEach(([a, b, c]) => { const ab = half(a, b); const bc = half(b, c); const ca = half(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); });
            faces = next;
        }
        return { verts, faces };
    }

    function noise3(x, y, z) {
        const h = (i, j, k) => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
        const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
        const f = (t) => t * t * (3 - 2 * t);
        const xf = f(x - xi); const yf = f(y - yi); const zf = f(z - zi);
        const l = (a, b, t) => a + (b - a) * t;
        return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
            l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf), zf);
    }

    /** A ball of crumpled paper: a sphere of 1280 flat faces pushed in and out; uv.x is how deep a point sits. */
    function paperBall() {
        const ball = icosphere(3);
        let verts = ball.verts;
        const faces = ball.faces;
        // big dents, then folds (ridges where the noise crosses its middle), then fine crinkle
        const depth = verts.map((p) => (noise3(p[0] * 1.9 + 5, p[1] * 1.9, p[2] * 1.9) - 0.5) * 0.36
            - (1 - Math.abs(noise3(p[0] * 4.3, p[1] * 4.3 + 9, p[2] * 4.3) - 0.5) * 2) * 0.13 + 0.07
            + (noise3(p[0] * 9.7 + 3, p[1] * 9.7, p[2] * 9.7 + 1) - 0.5) * 0.1);
        verts = verts.map((p, i) => { const r = 1 + depth[i]; return [p[0] * r, p[1] * r, p[2] * r]; });
        const out = [];
        faces.forEach(([a, b, c]) => {
            [a, b, c].forEach((i) => { const p = verts[i]; const n = norm(p); out.push(p[0], p[1], p[2], n[0], n[1], n[2], depth[i], 0); });
        });
        return out;
    }

    // ---------------------------------------------------------------- shaders

    const GLSL_COMMON = `#version 300 es
precision highp float;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
// the basket's wire mesh: how much of the pixel is wire (uv runs around and up the side)
float wire(vec2 uv) {
    if (uv.y > 0.955 || uv.y < 0.045) return 1.0;
    float a = abs(fract(uv.x * 30.0 + uv.y * 7.5) - 0.5);
    float b = abs(fract(uv.x * 30.0 - uv.y * 7.5) - 0.5);
    float d = max(a, b);
    float w = fwidth(d) * 0.9;
    return smoothstep(0.42 - w, 0.42 + w, d);
}
`;

    const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUv;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat4 uLightVP;
out vec3 vPos;
out vec3 vNrm;
out vec2 vUv;
out vec4 vSh;
void main() {
    vec4 w = uModel * vec4(aPos, 1.0);
    vPos = w.xyz;
    vNrm = mat3(uModel) * aNrm;
    vUv = aUv;
    vSh = uLightVP * w;
    gl_Position = uViewProj * w;
}`;

    const FS_DEPTH = GLSL_COMMON + `
in vec2 vUv;
uniform int uMat;
out vec4 o;
void main() {
    if (uMat == 4 && wire(vUv) < 0.5) discard;
    o = vec4(1.0);
}`;

    const FS = GLSL_COMMON + `
precision highp sampler2DShadow;
in vec3 vPos;
in vec3 vNrm;
in vec2 vUv;
in vec4 vSh;
uniform int uMat;
uniform vec3 uColor;
uniform vec3 uEye;
uniform vec3 uSun;
uniform sampler2DShadow uShadow;
uniform float uShadowTexel;
uniform int uTaps;
uniform vec4 uWin;      // the window wall's x, the first window's centre z, the windows' period, half a window's width
uniform vec3 uBasket;   // x, z, foot radius
uniform vec4 uBalls[10];
uniform int uBallCount;
uniform vec2 uRes;
uniform vec3 uSunCol;   // the sun by day, the moon by night
uniform vec3 uHemiUp;
uniform vec3 uHemiDown;
uniform vec4 uLamp;     // the floor lamp: where, how bright
uniform float uNight;
uniform float uExposure;
uniform sampler2D uPhoto;
uniform float uPhotoOn;
uniform vec4 uSofa;     // its footprint: x0, x1, z0, z1
out vec4 o;

const float WIN_LOW = 0.9;
const float WIN_HIGH = 2.95;

float inWindow(float y, float zz, float blur) {
    float w = 1.0 - smoothstep(uWin.w - blur, uWin.w + blur, abs(zz));
    float v = smoothstep(WIN_LOW - blur, WIN_LOW + blur, y) * (1.0 - smoothstep(WIN_HIGH - blur, WIN_HIGH + blur, y));
    // glazing bars: one upright, two across
    float bars = smoothstep(0.02 - blur, 0.02 + blur, abs(zz))
        * smoothstep(0.02 - blur, 0.02 + blur, abs(y - 1.58))
        * smoothstep(0.02 - blur, 0.02 + blur, abs(y - 2.27));
    return w * v * bars;
}

// the sun reaches a point only through a window: follow its ray back to the window wall
float windowLight(vec3 p) {
    float t = (uWin.x - p.x) / uSun.x;
    if (t <= 0.0) return 0.0;
    vec3 h = p + uSun * t;
    float zz = mod(h.z - uWin.y + uWin.z * 0.5, uWin.z) - uWin.z * 0.5;
    return inWindow(h.y, zz, 0.006 + t * 0.011);
}

float shadow() {
    vec3 c = vSh.xyz / vSh.w * 0.5 + 0.5;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    float s = 0.0;
    float turn = hash(gl_FragCoord.xy) * 6.2832;
    for (int i = 0; i < uTaps; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / float(uTaps)) * 2.4 * uShadowTexel;
        float a = turn + fi * 2.39996;
        s += texture(uShadow, vec3(c.xy + vec2(cos(a), sin(a)) * r, c.z - 0.0016));
    }
    return s / float(uTaps);
}

void main() {
    vec3 N = normalize(vNrm);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(uEye - vPos);
    vec3 albedo = uColor;
    float gloss = 0.0;
    float shine = 24.0;
    float ao = 1.0;
    float alpha = 1.0;
    vec3 glow = vec3(0.0);

    if (uMat == 0) {
        // floor boards: 14 cm wide, staggered, each its own tone, the grain along the board
        vec2 q = vPos.xz;
        float row = floor(q.x / 0.14);
        float off = hash(vec2(row, 7.0)) * 1.7;
        float col = floor((q.y + off) / 1.1);
        float tone = hash(vec2(row, col));
        vec2 f = vec2(fract(q.x / 0.14), fract((q.y + off) / 1.1));
        float grain = fbm(vec2(q.x * 42.0 + tone * 20.0, q.y * 2.4 + tone * 9.0));
        float knots = fbm(vec2(q.x * 9.0 + tone * 5.0, q.y * 1.3));
        albedo = mix(vec3(0.38, 0.20, 0.085), vec3(0.54, 0.31, 0.14), tone) * (0.78 + 0.34 * grain) * (0.9 + 0.2 * knots);
        float gap = smoothstep(0.0, 0.03, f.x) * (1.0 - smoothstep(0.97, 1.0, f.x)) * smoothstep(0.0, 0.004, f.y) * (1.0 - smoothstep(0.996, 1.0, f.y));
        albedo *= mix(0.45, 1.0, gap);
        gloss = 0.5 * (0.5 + 0.5 * grain) * gap;
        shine = 60.0;
        // what stands or lies on the floor darkens it underneath
        float r = length(q - uBasket.xy);
        ao *= 1.0 - 0.5 * exp(-max(r - uBasket.z, 0.0) * 15.0);
        for (int i = 0; i < uBallCount; i++) {
            vec2 d = q - uBalls[i].xz;
            float h = clamp(1.0 - (uBalls[i].y - uBalls[i].w) * 5.0, 0.0, 1.0);
            ao *= 1.0 - 0.5 * h * exp(-dot(d, d) / (uBalls[i].w * uBalls[i].w * 1.6));
        }
        vec2 sd = max(vec2(uSofa.x - q.x, uSofa.z - q.y), vec2(q.x - uSofa.y, q.y - uSofa.w));
        ao *= 1.0 - 0.62 * (1.0 - smoothstep(-0.06, 0.24, max(sd.x, sd.y)));
    } else if (uMat == 1 || uMat == 8) {
        // painted plaster, a touch uneven; darker into the corners along the floor
        vec2 q = abs(N.z) > 0.5 ? vPos.xy : vPos.zy;
        albedo = vec3(0.86, 0.81, 0.70) * (0.95 + 0.1 * fbm(q * 2.6)) * (0.985 + 0.03 * noise(q * 90.0));
        ao *= 0.72 + 0.28 * smoothstep(0.0, 0.7, vPos.y);
        if (uMat == 8) {
            // the window wall: the sky through the panes
            float zz = mod(vPos.z - uWin.y + uWin.z * 0.5, uWin.z) - uWin.z * 0.5;
            float open = inWindow(vPos.y, zz, 0.004);
            vec3 day = mix(vec3(1.5, 1.7, 2.0), vec3(2.6, 2.5, 2.2), smoothstep(1.0, 2.9, vPos.y));
            float star = step(0.9975, hash(floor(vPos.zy * 160.0))) * 0.9;
            vec3 dark = mix(vec3(0.05, 0.08, 0.17), vec3(0.015, 0.025, 0.07), smoothstep(1.0, 2.9, vPos.y)) + star;
            glow = mix(day, dark, uNight) * open;
            albedo *= 1.0 - open;
        }
    } else if (uMat == 3) {
        // paper: mostly the facet the pixel lies on, creases a little darker
        vec3 facet = normalize(cross(dFdx(vPos), dFdy(vPos)));
        if (dot(facet, V) < 0.0) facet = -facet;
        N = normalize(mix(N, facet, 0.8));
        albedo = vec3(0.93, 0.925, 0.90) * (0.74 + 0.8 * clamp(vUv.x + 0.2, 0.0, 0.34));
        ao *= uColor.x;
        gloss = 0.05;
    } else if (uMat == 4) {
        alpha = wire(vUv);
        if (alpha < 0.03) discard;
        albedo = vec3(0.13, 0.14, 0.16);
        gloss = 0.9;
        shine = 48.0;
    } else if (uMat == 5) {
        // the rug: a woven field with a border of two bands
        vec2 e = min(vUv, 1.0 - vUv) * vec2(1.5, 1.05);
        float edge = min(e.x, e.y);
        vec3 field = mix(vec3(0.035, 0.11, 0.17), vec3(0.05, 0.15, 0.21), noise(vUv * vec2(300.0, 14.0)));
        vec3 band = vec3(0.55, 0.48, 0.34);
        albedo = mix(band, field, smoothstep(0.045, 0.05, edge));
        albedo = mix(albedo, vec3(0.40, 0.09, 0.07), smoothstep(0.075, 0.08, edge) * (1.0 - smoothstep(0.105, 0.11, edge)));
        albedo *= 0.9 + 0.2 * noise(vUv * vec2(40.0, 520.0));
        float r = length(vPos.xz - uBasket.xy);
        ao *= 1.0 - 0.5 * exp(-max(r - uBasket.z, 0.0) * 15.0);
        for (int i = 0; i < uBallCount; i++) {
            vec2 d = vPos.xz - uBalls[i].xz;
            float h = clamp(1.0 - (uBalls[i].y - uBalls[i].w) * 5.0, 0.0, 1.0);
            ao *= 1.0 - 0.5 * h * exp(-dot(d, d) / (uBalls[i].w * uBalls[i].w * 1.6));
        }
    } else if (uMat == 7) {
        // the picture: one of the workspace's own, or (none to show) hills under an evening sky
        vec2 u = vUv;
        vec3 sky = mix(vec3(0.95, 0.62, 0.34), vec3(0.22, 0.34, 0.58), smoothstep(0.25, 1.0, u.y));
        float sunDisc = 1.0 - smoothstep(0.07, 0.075, length((u - vec2(0.68, 0.52)) * vec2(1.4, 1.0)));
        vec3 c = mix(sky, vec3(1.0, 0.88, 0.6), sunDisc);
        float h1 = 0.42 + 0.08 * sin(u.x * 7.0 + 1.0) + 0.03 * sin(u.x * 19.0);
        float h2 = 0.28 + 0.06 * sin(u.x * 5.0 + 4.0) + 0.02 * sin(u.x * 23.0);
        c = mix(c, vec3(0.28, 0.30, 0.42), 1.0 - smoothstep(h1 - 0.004, h1 + 0.004, u.y));
        c = mix(c, vec3(0.12, 0.17, 0.22), 1.0 - smoothstep(h2 - 0.004, h2 + 0.004, u.y));
        albedo = c * (0.95 + 0.1 * noise(u * 180.0));
        if (uPhotoOn > 0.5) albedo = pow(texture(uPhoto, u).rgb, vec3(2.2));
        gloss = 0.15;
    } else if (uMat == 9) {
        // upholstery: a fine weave, a little uneven, lighter where it turns away (its nap)
        float weave = noise(vPos.xz * 420.0) * 0.5 + noise(vPos.xy * 420.0) * 0.5;
        albedo = uColor * (0.86 + 0.28 * weave) * (0.9 + 0.2 * fbm(vPos.xy * 6.0 + vPos.z * 5.0));
        albedo += uColor * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.35;
    } else if (uMat == 10) {
        // the cat's coat: tabby stripes across the body, soft at the edge
        float stripe = smoothstep(0.50, 0.60, fbm(vec2(vPos.x * 60.0, vPos.y * 16.0 + vPos.z * 16.0)));
        albedo = mix(uColor, uColor * 0.5, stripe * 0.8);
        albedo += vec3(0.22, 0.17, 0.12) * pow(1.0 - max(dot(N, V), 0.0), 2.5);
    } else if (uMat == 11) {
        // the lamp's shade: lit from inside at night
        glow = uColor * vec3(1.0, 0.78, 0.5) * 2.4 * uNight;
        gloss = 0.05;
    } else if (uMat == 6) {
        gloss = 0.25;
    } else {
        gloss = 0.3;
    }

    float ndl = max(dot(N, uSun), 0.0);
    float sun = ndl * shadow() * windowLight(vPos);
    // sky light from above, the floor's warmth from below
    vec3 hemi = mix(uHemiDown, uHemiUp, N.y * 0.5 + 0.5);
    vec3 H = normalize(V + uSun);
    float spec = pow(max(dot(N, H), 0.0), shine) * gloss * sun;
    // the lamp: warm, falling off with distance, wrapping a little round what it lights
    vec3 toLamp = uLamp.xyz - vPos;
    float ld = dot(toLamp, toLamp);
    float lamp = (max(dot(N, toLamp * inversesqrt(ld)), 0.0) * 0.8 + 0.2) * uLamp.w / (1.0 + ld * 1.3);
    vec3 c = albedo * (hemi * ao + uSunCol * sun + vec3(1.0, 0.60, 0.28) * lamp * (0.5 + 0.5 * ao)) + spec * uSunCol * 0.8 + glow;
    if (uMat == 0) {
        // varnish: the bright end of the room shows in the boards at a low angle
        float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        c += fres * 0.55 * vec3(0.72, 0.76, 0.84) * gloss * 2.0 * ao * mix(1.0, 0.12, uNight);
    }
    c *= uExposure;
    // filmic curve, gamma, a soft vignette, and a grain of noise against banding
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
    vec2 sc = gl_FragCoord.xy / uRes - 0.5;
    c *= 1.0 - 0.55 * dot(sc, sc);
    c += (hash(gl_FragCoord.xy + 3.7) - 0.5) / 255.0;
    o = vec4(c, alpha);
}`;

    // ---------------------------------------------------------------- GL

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
        return s;
    }

    function program(vs, fs, names) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
        const u = {};
        names.forEach((n) => { u[n] = gl.getUniformLocation(p, n); });
        return { p, u };
    }

    function vao(data, usage) {
        const a = gl.createVertexArray();
        const b = gl.createBuffer();
        gl.bindVertexArray(a);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
        gl.bindVertexArray(null);
        return { a, b };
    }

    const RIBBON_SEGS = 16;
    const POLE = { x: 0.62, top: 1.02 };

    function initGL() {
        gl = cv.getContext('webgl2', { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' });
        if (!gl) return false;
        const SHADOW = settings().detail === 'low' ? 1024 : 2048;
        R = {
            main: program(VS, FS, ['uModel', 'uViewProj', 'uLightVP', 'uMat', 'uColor', 'uEye', 'uSun', 'uShadow', 'uShadowTexel', 'uTaps', 'uWin', 'uBasket', 'uBalls', 'uBallCount', 'uRes', 'uSunCol', 'uHemiUp', 'uHemiDown', 'uLamp', 'uNight', 'uExposure', 'uPhoto', 'uPhotoOn', 'uSofa']),
            depth: program(VS, FS_DEPTH, ['uModel', 'uViewProj', 'uLightVP', 'uMat']),
            shadowSize: SHADOW,
            room: null,
            parts: [],
            ball: null,
            ribbon: null,
            cat: null,
            catParts: [],
            photoTex: null,
            photoAspect: 0,
            ribbonData: new Float32Array(RIBBON_SEGS * 6 * 8)
        };
        const paper = paperBall();
        R.ball = Object.assign(vao(new Float32Array(paper)), { count: paper.length / 8 });
        R.ribbon = vao(R.ribbonData, gl.DYNAMIC_DRAW);
        // the shadow map: depth only, compared in the sampler (a soft edge from several samples)
        R.shadowTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, R.shadowTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
        R.shadowFb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, R.shadowFb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, R.shadowTex, 0);
        gl.drawBuffers([gl.NONE]);
        gl.readBuffer(gl.NONE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        buildRoom();
        loadPhoto();
        return true;
    }

    /** The room for the current distance: one buffer, drawn in parts (first, count, material, colour, casts a shadow). */
    function buildRoom() {
        const b = builder();
        const parts = [];
        const part = (mat, color, casts, fill) => { const first = b.count; fill(); parts.push({ first, count: b.count - first, mat, color: color || [1, 1, 1], casts: !!casts }); };
        const bz = -dist;
        const zWall = bz - WALL_GAP;
        const W = ROOM.halfW;
        const Hh = ROOM.wallH;
        part(0, null, false, () => b.quad([-W, 0, ROOM.front], [W, 0, ROOM.front], [W, 0, zWall], [-W, 0, zWall], [0, 1, 0]));
        part(1, null, false, () => {
            b.quad([-W, 0, zWall], [W, 0, zWall], [W, Hh, zWall], [-W, Hh, zWall], [0, 0, 1]);
            b.quad([-W, 0, ROOM.front], [-W, 0, zWall], [-W, Hh, zWall], [-W, Hh, ROOM.front], [1, 0, 0]);
        });
        part(8, null, false, () => b.quad([W, 0, zWall], [W, 0, ROOM.front], [W, Hh, ROOM.front], [W, Hh, zWall], [-1, 0, 0]));
        // skirting boards
        part(2, [0.9, 0.89, 0.85], false, () => {
            b.box(0, 0.05, zWall + 0.008, W * 2, 0.1, 0.016);
            b.box(-W + 0.008, 0.05, (ROOM.front + zWall) / 2, 0.016, 0.1, ROOM.front - zWall);
            b.box(W - 0.008, 0.05, (ROOM.front + zWall) / 2, 0.016, 0.1, ROOM.front - zWall);
        });
        // the rug under the basket
        part(5, null, false, () => b.quad([-0.8, 0.004, bz + 0.55], [0.8, 0.004, bz + 0.55], [0.8, 0.004, bz - 0.55], [-0.8, 0.004, bz - 0.55], [0, 1, 0]));
        // the basket: wire side, rim and foot rings, a plate for a bottom
        part(4, null, true, () => b.tube(0, bz, 0.006, BK.rBot, BK.H, BK.rTop, 56));
        part(2, [0.17, 0.18, 0.2], true, () => {
            b.torus(0, BK.H, bz, BK.rTop, BK.tube, 56, 8);
            b.torus(0, 0.008, bz, BK.rBot, 0.008, 56, 8);
            b.disc(0, 0.012, bz, BK.rBot, 40);
        });
        // the ribbon's stand: a foot, a thin post, a knob
        part(2, [0.22, 0.2, 0.19], true, () => {
            b.tube(POLE.x, bz - 0.12, 0, 0.09, 0.02, 0.075, 24);
            b.disc(POLE.x, 0.02, bz - 0.12, 0.075, 24);
            b.tube(POLE.x, bz - 0.12, 0.02, 0.009, POLE.top, 0.007, 10);
            b.box(POLE.x, POLE.top + 0.008, bz - 0.12, 0.022, 0.022, 0.022);
        });
        // the sofa against the far wall: a frame on short feet, two seat cushions, two back
        // cushions, two arms, a scatter cushion; all rounded
        const zb = zWall + 0.04;
        const zf = zb + SOFA.depth;
        const zm = (zb + zf) / 2;
        const hw = SOFA.halfW;
        const seatHalf = (hw - SOFA.armW) / 2 - 0.004;
        part(2, [0.16, 0.11, 0.07], true, () => {
            [[-1, zb + 0.07], [1, zb + 0.07], [-1, zf - 0.07], [1, zf - 0.07]].forEach(([sx, z]) => b.box(sx * (hw - 0.09), 0.04, z, 0.06, 0.08, 0.06));
        });
        part(9, [0.50, 0.43, 0.35], true, () => {
            b.pillow(0, 0.17, zm, hw, 0.1, SOFA.depth / 2, 7);
            b.pillow(0, 0.47, zb + 0.1, hw, 0.37, 0.1, 7);
            b.pillow(-hw + SOFA.armW / 2, 0.36, zm, SOFA.armW / 2, 0.26, SOFA.depth / 2, 5);
            b.pillow(hw - SOFA.armW / 2, 0.36, zm, SOFA.armW / 2, 0.26, SOFA.depth / 2, 5);
        });
        part(9, [0.58, 0.51, 0.42], true, () => {
            [-1, 1].forEach((sx) => {
                b.pillow(sx * (seatHalf + 0.004), 0.36, zf - 0.345, seatHalf, 0.095, 0.335, 4.5);
                b.pillow(sx * (seatHalf + 0.004), 0.665, zb + 0.27, seatHalf - 0.005, 0.22, 0.105, 3.6);
            });
        });
        part(9, [0.78, 0.50, 0.12], true, () => b.pillow(-0.56, 0.6, zb + 0.4, 0.16, 0.16, 0.065, 2.8));
        part(9, [0.62, 0.22, 0.16], true, () => b.pillow(-0.34, 0.575, zb + 0.44, 0.13, 0.13, 0.055, 2.8));
        // the floor lamp beside the sofa
        const lz = zWall + 0.34;
        part(2, [0.2, 0.18, 0.16], true, () => {
            b.tube(LAMP.x, lz, 0, 0.13, 0.025, 0.11, 28);
            b.disc(LAMP.x, 0.025, lz, 0.11, 28);
            b.tube(LAMP.x, lz, 0.025, 0.011, LAMP.top - 0.12, 0.009, 10);
        });
        part(11, [0.93, 0.86, 0.72], true, () => b.tube(LAMP.x, lz, LAMP.top - 0.27, 0.2, LAMP.top, 0.125, 36));
        // the picture over the sofa, in a frame cut to its shape
        const asp = R.photoAspect || 1.45;
        let pw = 0.92;
        let ph = pw / asp;
        if (ph > 0.74) { ph = 0.74; pw = ph * asp; }
        const py = 1.66;
        part(2, [0.2, 0.13, 0.08], false, () => b.box(0, py, zWall + 0.012, pw + 0.07, ph + 0.07, 0.024));
        part(2, [0.94, 0.93, 0.9], false, () => b.quad([-pw / 2 - 0.012, py - ph / 2 - 0.012, zWall + 0.0245], [pw / 2 + 0.012, py - ph / 2 - 0.012, zWall + 0.0245], [pw / 2 + 0.012, py + ph / 2 + 0.012, zWall + 0.0245], [-pw / 2 - 0.012, py + ph / 2 + 0.012, zWall + 0.0245], [0, 0, 1]));
        part(7, null, false, () => b.quad([-pw / 2, py - ph / 2, zWall + 0.0255], [pw / 2, py - ph / 2, zWall + 0.0255], [pw / 2, py + ph / 2, zWall + 0.0255], [-pw / 2, py + ph / 2, zWall + 0.0255], [0, 0, 1]));
        buildCat();
        if (R.room) { gl.deleteBuffer(R.room.b); gl.deleteVertexArray(R.room.a); }
        R.room = vao(new Float32Array(b.v));
        R.parts = parts;
    }

    /**
     * The cat on the sofa, loafed with her paws tucked in and her tail round her: rounded shapes about
     * the point she sits on (a buffer of its own: she breathes). Eyes open by day, shut at night.
     */
    function buildCat() {
        const b = builder();
        const parts = [];
        const part = (mat, color, fill) => { const first = b.count; fill(); parts.push({ first, count: b.count - first, mat, color }); };
        const coat = [0.86, 0.50, 0.20];
        const cream = [0.96, 0.93, 0.86];
        part(10, coat, () => {
            b.pillow(0, 0.082, 0, 0.17, 0.085, 0.105, 2.3);         // body
            b.pillow(0.115, 0.15, 0.055, 0.074, 0.066, 0.068, 2.1); // head, turned to the room
            // tail, curled along the front
            for (let i = 0; i < 9; i++) {
                const a = i / 8;
                b.pillow(-0.165 + a * 0.2 - 0.03 * Math.sin(a * 3.1), 0.026, 0.07 + 0.045 * Math.sin(a * 2.6), 0.03, 0.022 - a * 0.004, 0.024 - a * 0.004, 2);
            }
        });
        // ears: two little cones, pink inside
        part(10, coat, () => {
            b.tube(0.078, 0.07, 0.196, 0.03, 0.262, 0.001, 10);
            b.tube(0.152, 0.07, 0.196, 0.03, 0.262, 0.001, 10);
        });
        part(2, [0.93, 0.62, 0.6], () => {
            b.pillow(0.079, 0.214, 0.09, 0.014, 0.022, 0.006, 2);
            b.pillow(0.153, 0.214, 0.09, 0.014, 0.022, 0.006, 2);
        });
        part(2, cream, () => {
            b.pillow(0.115, 0.128, 0.112, 0.036, 0.024, 0.018, 2);  // muzzle
            b.pillow(0.07, 0.03, 0.1, 0.03, 0.02, 0.026, 2);        // paws
            b.pillow(0.14, 0.03, 0.105, 0.03, 0.02, 0.026, 2);
            b.pillow(0.06, 0.085, 0.088, 0.05, 0.05, 0.02, 2);      // bib
        });
        part(2, [0.9, 0.45, 0.47], () => b.pillow(0.115, 0.14, 0.129, 0.008, 0.006, 0.005, 2)); // nose
        if (night) {
            // asleep: two dark curves
            part(2, [0.16, 0.09, 0.05], () => {
                b.pillow(0.088, 0.158, 0.116, 0.014, 0.0035, 0.004, 2);
                b.pillow(0.142, 0.158, 0.116, 0.014, 0.0035, 0.004, 2);
            });
        } else {
            part(2, [0.25, 0.42, 0.14], () => {
                b.pillow(0.088, 0.16, 0.113, 0.012, 0.013, 0.008, 2);
                b.pillow(0.142, 0.16, 0.113, 0.012, 0.013, 0.008, 2);
            });
            part(2, [0.03, 0.03, 0.03], () => {
                b.pillow(0.088, 0.16, 0.1195, 0.004, 0.011, 0.003, 2);
                b.pillow(0.142, 0.16, 0.1195, 0.004, 0.011, 0.003, 2);
            });
        }
        if (R.cat) { gl.deleteBuffer(R.cat.b); gl.deleteVertexArray(R.cat.a); }
        R.cat = vao(new Float32Array(b.v));
        R.catParts = parts;
    }

    /** One of the workspace's pictures for the frame over the sofa (the painted hills until it loads, or if there is none). */
    function loadPhoto() {
        let list = [];
        try {
            // the gallery's list for this workspace (galleryView.js); the newest prints before it is all in
            if (Array.isArray(window.originalAllImages) && window.originalAllImages.length) list = window.originalAllImages;
            else if (typeof allImages !== 'undefined' && Array.isArray(allImages)) list = allImages; // eslint-disable-line no-undef
            if (!list.length && Array.isArray(window.galleryHeadItems)) list = window.galleryHeadItems;
        } catch (_) { /* gallery not loaded */ }
        const item = list.length ? list[Math.floor(Math.random() * list.length)] : null;
        const file = item && (item.original || item.filename || item.upscaled);
        if (!file || typeof file !== 'string') return;
        const stem = file.split('/').pop().replace(/\.(png|jpe?g|webp)$/i, '');
        if (!stem) return;
        const img = new Image();
        const mine = R;
        img.onload = () => {
            // the program may have closed, or started again, while the picture came
            if (!gl || R !== mine || !img.naturalWidth) return;
            try {
                const tex = gl.createTexture();
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.activeTexture(gl.TEXTURE0);
                R.photoTex = tex;
                R.photoAspect = clamp(img.naturalWidth / img.naturalHeight, 0.5, 2.2);
                buildRoom();
            } catch (err) { console.error('Bin Toss picture:', err); }
        };
        // the print's fit preview: the whole picture, small (made by the server on first request)
        img.src = `/previews/${encodeURIComponent(`${stem}@fit.webp`)}`;
    }

    /** The ribbon hangs from the stand and streams with the draught (a strip rebuilt every frame). */
    function updateRibbon() {
        const d = R.ribbonData;
        const lean = clamp(windShown * 0.42, -1.25, 1.25); // radians from hanging straight down
        const segLen = 0.3 / RIBBON_SEGS;
        const flutter = 0.02 + Math.abs(windShown) * 0.03;
        const pts = [];
        let x = POLE.x;
        let y = POLE.top;
        const z = -dist - 0.12;
        for (let i = 0; i <= RIBBON_SEGS; i++) {
            const k = i / RIBBON_SEGS;
            const a = lean * (0.35 + 0.65 * k) + Math.sin(clock * (5 + Math.abs(windShown) * 3) - i * 0.75) * flutter * k * 6;
            pts.push([x, y, z + Math.sin(clock * 4.3 - i * 0.6) * 0.012 * k, a]);
            x += Math.sin(a) * segLen;
            y -= Math.cos(a) * segLen;
        }
        let o = 0;
        const put = (p, side, v) => {
            const a = p[3];
            // across the ribbon, in the plane that faces the room
            const wx = Math.cos(a) * 0.016 * side;
            const wy = Math.sin(a) * 0.016 * side;
            d[o++] = p[0] + wx; d[o++] = p[1] + wy; d[o++] = p[2];
            d[o++] = 0.15; d[o++] = 0.15; d[o++] = 0.97;
            d[o++] = side > 0 ? 1 : 0; d[o++] = v;
        };
        for (let i = 0; i < RIBBON_SEGS; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            put(a, -1, i / RIBBON_SEGS); put(a, 1, i / RIBBON_SEGS); put(b, 1, (i + 1) / RIBBON_SEGS);
            put(a, -1, i / RIBBON_SEGS); put(b, 1, (i + 1) / RIBBON_SEGS); put(b, -1, (i + 1) / RIBBON_SEGS);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, R.ribbon.b);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
    }

    function resize() {
        if (!cv) return false;
        const box = cv.parentElement;
        const w = Math.max(1, box.clientWidth);
        const h = Math.max(1, box.clientHeight);
        const dpr = settings().detail === 'low' ? 1 : Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
        return w > 8 && h > 8;
    }

    function render() {
        if (!gl || !R || gl.isContextLost() || !resize()) return;
        updateRibbon();
        const aspect = cv.width / cv.height;
        // a tall screen sees the room through a narrow door: widen the lens until the basket's rug fits
        const fovy = clamp(2 * Math.atan(Math.tan(27 * Math.PI / 180) / Math.min(1, aspect / 0.52)), 0.6, 1.5);
        const eye = EYE;
        const at = [0, 0.52, -dist * 0.78];
        const viewProj = mul(perspective(fovy, aspect, 0.1, 30), lookAt(eye, at, [0, 1, 0]));
        const centre = [0, 0.6, -dist * 0.55];
        const span = dist * 0.5 + 2.2;
        const lightVP = mul(ortho(-span, span, -span, span, 0.5, 30), lookAt([centre[0] + SUN[0] * 12, centre[1] + SUN[1] * 12, centre[2] + SUN[2] * 12], centre, [0, 1, 0]));

        const drawables = [];
        R.parts.forEach((p) => drawables.push({ vao: R.room.a, first: p.first, count: p.count, mat: p.mat, color: p.color, casts: p.casts, model: IDENTITY }));
        drawables.push({ vao: R.ribbon.a, first: 0, count: RIBBON_SEGS * 6, mat: 6, color: [0.82, 0.1, 0.12], casts: true, model: IDENTITY });
        // the cat breathes
        const catModel = trs([0, 1, 0], 0, solid.cat.map((v, i) => (i === 1 ? SOFA.seatTop - 0.004 : v)), 1 + Math.sin(clock * (night ? 1.3 : 1.9)) * 0.012);
        R.catParts.forEach((p) => drawables.push({ vao: R.cat.a, first: p.first, count: p.count, mat: p.mat, color: p.color, casts: true, model: catModel }));
        const shadowBalls = [];
        balls.forEach((b) => {
            // a paper inside the basket sits in its shade
            const deep = b.inside ? 0.62 + 0.38 * clamp(b.p[1] / BK.H, 0, 1) : 1;
            drawables.push({ vao: R.ball.a, first: 0, count: R.ball.count, mat: 3, color: [deep, 0, 0], casts: true, model: trs(b.axis, b.angle, b.p, BALL_R * 0.86) });
            if (!b.inside && b.p[1] < 0.35 && shadowBalls.length < 10) shadowBalls.push(b.p[0], b.p[1], b.p[2], BALL_R);
        });
        if (hand) {
            const bob = hand.grab ? 0 : Math.sin(clock * 2.2) * 0.006;
            drawables.push({ vao: R.ball.a, first: 0, count: R.ball.count, mat: 3, color: [1, 0, 0], casts: true, model: trs([0.3, 0.9, 0.3], 0.6 + clock * 0.25, [HAND[0] + hand.x, HAND[1] + hand.y + bob, HAND[2]], BALL_R * 0.86) });
        }

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);

        // what the sun sees
        gl.bindFramebuffer(gl.FRAMEBUFFER, R.shadowFb);
        gl.viewport(0, 0, R.shadowSize, R.shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.5, 3);
        gl.useProgram(R.depth.p);
        gl.uniformMatrix4fv(R.depth.u.uViewProj, false, lightVP);
        gl.uniformMatrix4fv(R.depth.u.uLightVP, false, lightVP);
        drawables.forEach((d) => {
            if (!d.casts) return;
            gl.bindVertexArray(d.vao);
            gl.uniformMatrix4fv(R.depth.u.uModel, false, d.model);
            gl.uniform1i(R.depth.u.uMat, d.mat);
            gl.drawArrays(gl.TRIANGLES, d.first, d.count);
        });
        gl.disable(gl.POLYGON_OFFSET_FILL);

        // the room
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cv.width, cv.height);
        gl.clearColor(0.05, 0.05, 0.06, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const u = R.main.u;
        gl.useProgram(R.main.p);
        gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
        gl.uniformMatrix4fv(u.uLightVP, false, lightVP);
        gl.uniform3fv(u.uEye, eye);
        gl.uniform3fv(u.uSun, SUN);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, R.shadowTex);
        gl.uniform1i(u.uShadow, 0);
        gl.uniform1f(u.uShadowTexel, 1 / R.shadowSize);
        gl.uniform1i(u.uTaps, settings().detail === 'low' ? 4 : 12);
        // the sun over the basket came through the window at z = basket + (wall - basket x) * sun z / sun x
        gl.uniform4f(u.uWin, ROOM.halfW, -dist + ROOM.halfW * SUN[2] / SUN[0], WINDOW_PERIOD, 0.44);
        gl.uniform3f(u.uBasket, 0, -dist, BK.rBot);
        const bl = new Float32Array(40);
        bl.set(shadowBalls.slice(0, 40));
        gl.uniform4fv(u.uBalls, bl);
        gl.uniform1i(u.uBallCount, Math.min(10, shadowBalls.length / 4));
        gl.uniform2f(u.uRes, cv.width, cv.height);
        const zWall = -dist - WALL_GAP;
        if (night) {
            gl.uniform3f(u.uSunCol, 0.20, 0.27, 0.48);
            gl.uniform3f(u.uHemiUp, 0.050, 0.060, 0.105);
            gl.uniform3f(u.uHemiDown, 0.045, 0.038, 0.036);
            gl.uniform4f(u.uLamp, LAMP.x + 0.1, LAMP.top - 0.2, zWall + 0.5, 3.4);
            gl.uniform1f(u.uExposure, 1.0);
        } else {
            gl.uniform3f(u.uSunCol, 2.7, 2.46, 2.05);
            gl.uniform3f(u.uHemiUp, 0.40, 0.45, 0.56);
            gl.uniform3f(u.uHemiDown, 0.27, 0.20, 0.15);
            gl.uniform4f(u.uLamp, LAMP.x, LAMP.top, zWall + 0.34, 0);
            gl.uniform1f(u.uExposure, 0.74);
        }
        gl.uniform1f(u.uNight, night ? 1 : 0);
        gl.uniform4f(u.uSofa, -SOFA.halfW, SOFA.halfW, zWall, zWall + 0.04 + SOFA.depth);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, R.photoTex);
        gl.uniform1i(u.uPhoto, 1);
        gl.uniform1f(u.uPhotoOn, R.photoTex ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        drawables.forEach((d) => {
            gl.bindVertexArray(d.vao);
            gl.uniformMatrix4fv(u.uModel, false, d.model);
            gl.uniform1i(u.uMat, d.mat);
            gl.uniform3fv(u.uColor, d.color);
            // the wire mesh is drawn by coverage, so its edges are as smooth as the rest
            if (d.mat === 4) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
            gl.drawArrays(gl.TRIANGLES, d.first, d.count);
            if (d.mat === 4) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        });
        gl.bindVertexArray(null);
    }

    function frame(now) {
        raf = 0;
        if (!page || page.hidden || view !== 'main' || document.hidden) return;
        const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
        lastFrame = now;
        simulate(dt);
        // nothing in the air: every other frame is enough for the ribbon
        const busy = balls.some((b) => !b.rest) || (hand && hand.grab) || !hand;
        idleSkip = busy ? false : !idleSkip;
        if (!idleSkip) {
            try { render(); } catch (err) { console.error('Bin Toss:', err); stopLoop(); return; }
        }
        raf = requestAnimationFrame(frame);
    }

    function startLoop() {
        if (raf || !gl) return;
        lastFrame = 0;
        raf = requestAnimationFrame(frame);
    }

    function stopLoop() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    }

    // ---------------------------------------------------------------- status row and notes

    function renderStatus() {
        if (!page) return;
        const set = (k, v) => { const el = page.querySelector(`.wbt-status [data-v="${k}"]`); if (el && el.textContent !== String(v)) el.textContent = v; };
        const key = settings().distance;
        set('run', run);
        set('best', Math.max(stats().best[key] || 0, run));
        const w = page.querySelector('.wbt-wind');
        if (w) {
            w.dataset.side = wind < 0 ? 'left' : wind > 0 ? 'right' : 'calm';
            w.querySelector('i').textContent = wind ? Math.abs(wind).toFixed(1) : 'Calm';
            w.setAttribute('aria-label', wind ? `Draught ${Math.abs(wind).toFixed(1)} to the ${wind < 0 ? 'left' : 'right'}` : 'No draught');
        }
    }

    function note(text, good) {
        if (!page) return;
        const el = page.querySelector('.wbt-note');
        if (!el) return;
        clearTimeout(noteTimer);
        el.textContent = text;
        el.classList.toggle('is-good', !!good);
        el.classList.toggle('is-on', !!text);
        if (text && threw) noteTimer = setTimeout(() => el.classList.remove('is-on'), 1600);
    }

    // ---------------------------------------------------------------- input

    function onDown(e) {
        if (view !== 'main' || !hand) return;
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, trail: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
        hand.grab = true;
    }

    function onMove(e) {
        if (!press || e.pointerId !== press.id || !hand) return;
        const now = performance.now();
        press.trail.push({ x: e.clientX, y: e.clientY, t: now });
        while (press.trail.length > 2 && now - press.trail[0].t > 160) press.trail.shift();
        // the paper follows the finger a little
        const h = cv.clientHeight || 1;
        hand.x = clamp((e.clientX - press.x0) / h * 0.5, -0.14, 0.14);
        hand.y = clamp(-(e.clientY - press.y0) / h * 0.45, -0.06, 0.2);
    }

    function onUp(e) {
        if (!press || e.pointerId !== press.id) return;
        const p = press;
        press = null;
        if (!hand) return;
        const now = performance.now();
        const last = { x: e.clientX, y: e.clientY, t: now };
        // the flick: the last tenth of a second of the finger's path
        let from = p.trail[0];
        for (const s of p.trail) { if (now - s.t <= 110) { from = s; break; } }
        const dt = Math.max(16, last.t - from.t) / 1000;
        const dx = last.x - from.x;
        const up = from.y - last.y;
        const h = cv.clientHeight || 1;
        const speed = Math.hypot(dx, up) / dt / h; // screen heights a second
        const travelled = p.y0 - last.y;
        if (up < 6 || travelled < h * 0.05 || speed < 0.5) {
            // not a throw: the paper goes back to the hand
            hand.grab = false; hand.x = 0; hand.y = 0;
            return;
        }
        const yaw = clamp(Math.atan2(dx, up) * 0.35, -0.42, 0.42);
        const power = 1 + 0.12 * Math.tanh((speed - 2.2) / 2.2 * 1.2);
        note('');
        throwPaper(yaw, power);
    }

    function onCancel() {
        press = null;
        if (hand) { hand.grab = false; hand.x = 0; hand.y = 0; }
    }

    // ---------------------------------------------------------------- pages

    function showView(v) {
        view = v;
        page.dataset.view = v;
        page.querySelectorAll('.wbt-view').forEach((el) => { el.hidden = el.dataset.view !== v; });
        if (v === 'options') renderOptions();
        if (v === 'stats') renderStats();
        if (v === 'about') renderAbout();
        if (v === 'main') startLoop(); else stopLoop();
        ws.refreshTitleAction();
        ws.refreshSoftKeys();
    }

    function openPage(v) {
        if (v === 'options') draft = settings();
        showView(v);
        ws.syncHistory();
    }

    const DETAIL = { high: 'High', low: 'Low' };
    const TIMES = { auto: 'Automatic', day: 'Day', night: 'Night' };

    function renderOptions() {
        const d = draft;
        const box = page.querySelector('.wbt-view[data-view="options"]');
        const check = (k, label) => `<label class="wm-check"><input type="checkbox" data-opt="${k}"${d[k] ? ' checked' : ''}><span>${esc(label)}</span></label>`;
        box.innerHTML = '<div class="wm-form-hdr">Options</div><div class="wm-set-scroll"><div class="wm-form wbt-form">'
            + `<div class="wm-form-row is-wide"><span class="wm-form-label">Distance:</span><button type="button" class="wm-combo" data-act="distance"><span>${DISTANCES[d.distance].label}</span></button></div>`
            + `<div class="wm-form-row is-wide"><span class="wm-form-label">Detail:</span><button type="button" class="wm-combo" data-act="detail"><span>${DETAIL[d.detail] || DETAIL.high}</span></button></div>`
            + `<div class="wm-form-row is-wide"><span class="wm-form-label">Time of day:</span><button type="button" class="wm-combo" data-act="time"><span>${TIMES[d.time] || TIMES.auto}</span></button></div>`
            + `<div class="wbt-checks">${check('sounds', 'Play sounds')}</div>`
            + '</div></div>';
        box.querySelectorAll('[data-opt]').forEach((el) => el.addEventListener('change', () => { d[el.dataset.opt] = el.checked; }));
        box.querySelector('[data-act="distance"]').addEventListener('click', (e) => {
            e.stopPropagation();
            ws.dropdown(e.currentTarget, Object.keys(DISTANCES).map((k) => ({ label: DISTANCES[k].label, radio: d.distance === k, action: () => { d.distance = k; renderOptions(); } })), 'left');
        });
        box.querySelector('[data-act="time"]').addEventListener('click', (e) => {
            e.stopPropagation();
            ws.dropdown(e.currentTarget, Object.keys(TIMES).map((k) => ({ label: TIMES[k], radio: d.time === k, action: () => { d.time = k; renderOptions(); } })), 'left');
        });
        box.querySelector('[data-act="detail"]').addEventListener('click', (e) => {
            e.stopPropagation();
            ws.dropdown(e.currentTarget, Object.keys(DETAIL).map((k) => ({ label: DETAIL[k], radio: d.detail === k, action: () => { d.detail = k; renderOptions(); } })), 'left');
        });
    }

    function commitOptions() {
        if (!draft) return;
        const old = settings();
        const next = draft;
        draft = null;
        const moved = next.distance !== old.distance;
        const detail = next.detail !== old.detail;
        if (moved) endRun();
        storePut({ settings: next });
        if (detail) { dropGL(); startGL(); }
        if (moved) setDistance(next.distance, false);
        else if (isNight() !== night) { night = isNight(); if (R) buildRoom(); }
    }

    function renderStats() {
        const st = stats();
        const box = page.querySelector('.wbt-view[data-view="stats"]');
        const pct = st.throws ? Math.round(st.hits * 100 / st.throws) : 0;
        const rows = [['Papers thrown', st.throws], ['In the basket', st.hits], ['Accuracy', `${pct}%`]];
        box.innerHTML = '<div class="wm-form-hdr">Statistics</div><div class="wm-set-scroll"><div class="wbt-stats">'
            + '<p class="wbt-stats-type">Best runs:</p>'
            + '<table class="wbt-high"><thead><tr><th>Distance</th><th>In a row</th></tr></thead><tbody>'
            + Object.keys(DISTANCES).map((k) => `<tr><td>${esc(DISTANCES[k].label)}</td><td>${Math.max(st.best[k] || 0, k === settings().distance ? run : 0) || '-'}</td></tr>`).join('')
            + '</tbody></table>'
            + `<table class="wbt-totals"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`
            + '<div class="wbt-reset"><button type="button" class="wm-button" data-act="reset">Reset</button></div>'
            + '</div></div>';
        box.querySelector('[data-act="reset"]').addEventListener('click', async () => {
            const yes = await ws.messageBox({
                title: 'Reset Statistics', text: 'Do you want to reset all statistics?', icon: 'question', modal: true, cancelValue: false,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }]
            });
            if (yes) { storePut({ stats: blankStats() }); renderStats(); renderStatus(); }
        });
    }

    function renderAbout() {
        const box = page.querySelector('.wbt-view[data-view="about"]');
        const icon = '/static_images/wm61/app-bintoss-lg';
        box.innerHTML = '<div class="wm-set-scroll"><div class="wbt-about">'
            + `<img class="wbt-logo" src="${icon}@2x.png" srcset="${icon}@2x.png 1x, ${icon}@4x.png 2x" alt="" draggable="false">`
            + `<p>${esc(TITLE)}&trade;</p><p>Designed for Melaton Mobile&trade;</p><p>by ${esc(DEVELOPER)}</p>`
            + '<p class="wbt-copy">Copyright &copy; 2026 Xyridian Corporation. All rights reserved.</p></div></div>';
    }

    function backToGame(apply) {
        if (view === 'options' && apply) commitOptions();
        draft = null;
        showView('main');
        ws.syncHistory();
        return true;
    }

    // ---------------------------------------------------------------- app

    function dropGL() {
        stopLoop();
        if (gl) {
            const ext = gl.getExtension('WEBGL_lose_context');
            if (ext) { try { ext.loseContext(); } catch (_) { /* gone already */ } }
        }
        gl = null;
        R = null;
        // a canvas keeps its context kind: a fresh one for the next start
        if (cv && page) {
            const fresh = cv.cloneNode(false);
            cv.replaceWith(fresh);
            cv = fresh;
            wireCanvas();
        }
    }

    function startGL() {
        let ok = false;
        try { ok = initGL(); } catch (err) { console.error('Bin Toss:', err); ok = false; }
        const field = page.querySelector('.wbt-field');
        field.classList.toggle('is-flat', !ok);
        if (!ok) {
            gl = null;
            R = null;
            page.querySelector('.wbt-none').textContent = 'Bin Toss needs 3D graphics (WebGL 2), which this phone does not offer.';
            return false;
        }
        if (view === 'main' && !page.hidden) startLoop();
        return true;
    }

    function wireCanvas() {
        cv.addEventListener('pointerdown', onDown);
        cv.addEventListener('pointermove', onMove);
        cv.addEventListener('pointerup', onUp);
        cv.addEventListener('pointercancel', onCancel);
        cv.addEventListener('contextmenu', (e) => e.preventDefault());
        // the system took the 3D context back (memory, a sleeping tab): start again when it returns
        cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stopLoop(); });
        cv.addEventListener('webglcontextrestored', () => { gl = null; R = null; startGL(); });
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-bintoss');
        p.dataset.view = 'main';
        p.innerHTML = '<div class="wbt-view" data-view="main">'
            + '<div class="wbt-status"><span><b>Run:</b> <i data-v="run">0</i></span><span><b>Best:</b> <i data-v="best">0</i></span>'
            + '<span class="wbt-wind" data-side="calm"><b>Draught:</b> <s aria-hidden="true"></s><i>Calm</i></span></div>'
            + `<div class="wbt-field" data-wm-no-hold><canvas aria-label="${esc(TITLE)}"></canvas><div class="wbt-note" aria-live="polite"></div><div class="wbt-none"></div></div></div>`
            + '<div class="wbt-view" data-view="options" hidden></div><div class="wbt-view" data-view="stats" hidden></div><div class="wbt-view" data-view="about" hidden></div>';
        cv = p.querySelector('.wbt-field canvas');
        wireCanvas();
        threw = false;
        setDistance(settings().distance, false);
        if (startGL()) note('Flick the paper into the basket');
    }

    function show() {
        renderStatus();
        // Automatic: evening may have come while the program was in the background
        if (isNight() !== night) { night = isNight(); if (R) buildRoom(); }
        if (view === 'main') startLoop();
    }

    function hide() {
        stopLoop();
        onCancel();
    }

    function softKeys() {
        if (view !== 'main') return { left: null, right: null };
        const key = settings().distance;
        return {
            left: { label: 'New Game', action: newGame },
            right: {
                label: 'Menu',
                menu: () => Object.keys(DISTANCES).map((k) => ({
                    label: DISTANCES[k].label, radio: key === k,
                    action: () => { if (k !== settings().distance) { endRun(); setDistance(k, false); note(''); ws.refreshSoftKeys(); } }
                })).concat([
                    '-',
                    { label: 'Options...', action: () => openPage('options') },
                    { label: 'Statistics', action: () => openPage('stats') },
                    '-',
                    { label: 'About', action: () => openPage('about') }
                ])
            }
        };
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: 'app-bintoss',
            inStart: 'programs',
            programsFolder: 'games',
            mount,
            show,
            hide,
            titleKind: () => (view === 'main' ? 'close' : 'ok'),
            onTitleOk: () => (view === 'main' ? false : backToGame(true)),
            historyDepth: () => (view === 'main' ? 0 : 1),
            onBack: () => (view === 'main' ? false : backToGame(view !== 'options')),
            onEnd() {
                endRun();
                hide();
                // give the 3D context back to the phone
                if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) { try { ext.loseContext(); } catch (_) { /* gone */ } } }
                gl = null; R = null; view = 'main'; page = null; cv = null; balls = [];
            },
            softKeys
        });
        document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); else if (page && !page.hidden && view === 'main') startLoop(); });
    }

    // tests
    window.wmBinToss = {
        solveSpeed, stepBall, launchVelocity, BK, BALL_R, DISTANCES,
        get state() { return { run, wind, dist, throwSpeed, balls, hand, gl: !!gl }; },
        setWind(w) { wind = w; windShown = w; renderStatus(); },
        setNight(n) { night = !!n; if (R) buildRoom(); },
        throwPaper, render, newGame
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
