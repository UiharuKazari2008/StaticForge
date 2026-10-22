/**
 * Screen savers (Yukimi 2026-10-21: "Add Screen Saver Support (replaces the focus cover so when
 * its enabled it shows a screensaver or a similar focus cover)").
 *
 * The workspace's choice (desktopPersonalization.js screenSaver { id, wait, resumeLogon }) starts
 * after `wait` minutes with no mouse, key or touch input on the desktop, and also replaces the focus
 * cover: when the Focus Cover toggle covers the screen as the window loses focus
 * (focusOverlayManager.js), the screen saver shows instead. 'focus' is the Dreamscape focus cover
 * itself (#focus-overlay); 'none' leaves the focus cover as it was and never starts on idle.
 *
 * Any input ends it. "On resume, display logon screen" locks the workstation as it ends
 * (desktopBoot.lockWorkstation, the start menu's Lock), when it started on idle.
 *
 * Savers, after Vista's (canvas 2D; Vista's are Direct3D):
 *   aurora   curtains of green and violet light drifting on black
 *   blank    black
 *   bubbles  iridescent soap bubbles drifting over the desktop, bouncing off the edges and each other
 *   logo     the start button's logo fading in and out across a black screen (Windows Logo)
 *   mystify  two four-point polygons with trails, colours cycling, on black
 *   photos   the Vista and Melaton wallpapers, panning and zooming, cross-fading (Photos)
 *   ribbons  twisting lit ribbons that grow and fade on black
 *
 *   screenSaver.preview(id)                full screen until input (the dialog's Preview)
 *   screenSaver.attachPreview(canvas, id)  the dialog's monitor picture; returns { stop() }
 *   screenSaver.showForFocusLoss() / hideForFocusReturn()   focusOverlayManager.js
 *
 * Never on the dedicated agent tab (/app?agent=1), while the workstation is locked or booting, or
 * while something is full screen.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const CHECK_MS = 5000;
    const MOVE_THRESHOLD = 6; // px of mouse travel that ends a saver (Vista ignores a nudge)
    const PHOTO_SECONDS = 7;

    const state = {
        lastInput: Date.now(),
        cover: null,
        canvas: null,
        engine: null,
        showing: null,     // null | 'idle' | 'focus' | 'preview'
        startPoint: null,
        shownAt: 0,
        timer: null,
        bound: false
    };

    // ---- helpers ----

    function settings() {
        const pers = root.desktopPersonalization;
        const p = pers && typeof pers.get === 'function' ? pers.get() : null;
        return (p && p.screenSaver) || { id: 'none', wait: 10, resumeLogon: false };
    }

    function rand(a, b) {
        return a + Math.random() * (b - a);
    }

    function isAgentTab() {
        try {
            return new URLSearchParams(root.location.search).get('agent') === '1';
        } catch (_) {
            return false;
        }
    }

    function blocked() {
        const b = doc && doc.body;
        if (!b || !b.classList.contains('desktop-mode')) return true;
        if (b.classList.contains('workstation-locked') || b.classList.contains('initializing')
            || b.classList.contains('boot-from-launch') || b.classList.contains('windows-startup')) return true;
        if (doc.fullscreenElement) return true;
        const boot = root.desktopBoot;
        if (boot && typeof boot.isWorkstationLocked === 'function' && boot.isWorkstationLocked()) return true;
        return false;
    }

    function wallpaperUrl() {
        if (!doc) return null;
        const read = (name) => {
            try {
                return (getComputedStyle(doc.body).getPropertyValue(name) || '').trim();
            } catch (_) { return ''; }
        };
        const m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(read('--desktop-wallpaper') || read('--desktop-wallpaper-default'));
        return m ? m[2] : null;
    }

    function loadImage(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    // ---- savers ----
    // Each is make(ctx, w, h, { preview }) -> { frame(t, dt), resize?(w, h), transparent? }

    const SAVERS = {};

    SAVERS.blank = () => ({ frame() {} });

    /* Bubbles: each size is drawn once to a sprite (clear middle, a rainbow film toward the rim, a
       window-shaped highlight and a faint lower reflection) and turned slowly as it drifts. */
    SAVERS.bubbles = (ctx, w, h, opts) => {
        const scale = opts.preview ? Math.max(0.12, w / 1920) : 1;
        const count = opts.preview ? 7 : 11;
        const sprites = new Map();
        function sprite(r) {
            const key = Math.round(r);
            if (sprites.has(key)) return sprites.get(key);
            const s = doc.createElement('canvas');
            const size = key * 2 + 4;
            s.width = s.height = size;
            const c = s.getContext('2d');
            const cx = size / 2;
            // the film: clear in the middle, coloured toward the edge
            const film = c.createRadialGradient(cx, cx, key * 0.15, cx, cx, key);
            film.addColorStop(0, 'rgba(255,255,255,0)');
            film.addColorStop(0.72, 'rgba(255,255,255,0.03)');
            film.addColorStop(0.9, 'rgba(255,255,255,0.12)');
            film.addColorStop(1, 'rgba(255,255,255,0.32)');
            c.fillStyle = film;
            c.beginPath();
            c.arc(cx, cx, key, 0, Math.PI * 2);
            c.fill();
            if (typeof c.createConicGradient === 'function') {
                const rainbow = c.createConicGradient(rand(0, Math.PI * 2), cx, cx);
                ['#ff4d6d', '#ffb347', '#fff36b', '#59f28c', '#4dd7ff', '#7b6dff', '#ff6df0', '#ff4d6d']
                    .forEach((col, i, a) => rainbow.addColorStop(i / (a.length - 1), col));
                c.save();
                c.globalCompositeOperation = 'source-atop';
                c.globalAlpha = 0.34;
                c.fillStyle = rainbow;
                c.fillRect(0, 0, size, size);
                c.restore();
                // keep the middle clear of the colour
                c.save();
                c.globalCompositeOperation = 'destination-out';
                const hole = c.createRadialGradient(cx, cx, 0, cx, cx, key);
                hole.addColorStop(0, 'rgba(0,0,0,0.92)');
                hole.addColorStop(0.62, 'rgba(0,0,0,0.75)');
                hole.addColorStop(0.86, 'rgba(0,0,0,0)');
                c.fillStyle = hole;
                c.fillRect(0, 0, size, size);
                c.restore();
            }
            // the rim line
            c.strokeStyle = 'rgba(255,255,255,0.45)';
            c.lineWidth = Math.max(0.6, key * 0.012);
            c.beginPath();
            c.arc(cx, cx, key - c.lineWidth / 2, 0, Math.PI * 2);
            c.stroke();
            // a window reflection, upper left
            c.save();
            c.translate(cx - key * 0.42, cx - key * 0.45);
            c.rotate(-0.6);
            const hl = c.createRadialGradient(0, 0, 0, 0, 0, key * 0.3);
            hl.addColorStop(0, 'rgba(255,255,255,0.95)');
            hl.addColorStop(0.5, 'rgba(255,255,255,0.45)');
            hl.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = hl;
            c.scale(1, 0.55);
            c.beginPath();
            c.arc(0, 0, key * 0.3, 0, Math.PI * 2);
            c.fill();
            c.restore();
            // a dim lower reflection
            c.save();
            c.translate(cx + key * 0.3, cx + key * 0.5);
            c.rotate(-0.5);
            c.scale(1, 0.35);
            const lo = c.createRadialGradient(0, 0, 0, 0, 0, key * 0.32);
            lo.addColorStop(0, 'rgba(255,255,255,0.35)');
            lo.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = lo;
            c.beginPath();
            c.arc(0, 0, key * 0.32, 0, Math.PI * 2);
            c.fill();
            c.restore();
            sprites.set(key, s);
            return s;
        }
        const bubbles = [];
        for (let i = 0; i < count; i++) {
            const r = rand(60, 150) * scale;
            bubbles.push({
                r,
                x: rand(r, Math.max(r + 1, w - r)),
                y: rand(r, Math.max(r + 1, h - r)),
                vx: rand(-1, 1) * 70 * scale,
                vy: rand(-1, 1) * 70 * scale,
                a: rand(0, Math.PI * 2),
                va: rand(-0.25, 0.25),
                img: null
            });
        }
        bubbles.forEach((b) => { b.img = sprite(b.r); });
        return {
            transparent: true,
            resize(nw, nh) { w = nw; h = nh; },
            frame(t, dt) {
                ctx.clearRect(0, 0, w, h);
                for (const b of bubbles) {
                    b.x += b.vx * dt;
                    b.y += b.vy * dt;
                    b.a += b.va * dt;
                    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
                    if (b.x > w - b.r) { b.x = w - b.r; b.vx = -Math.abs(b.vx); }
                    if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }
                    if (b.y > h - b.r) { b.y = h - b.r; b.vy = -Math.abs(b.vy); }
                }
                // elastic bumps, mass by area
                for (let i = 0; i < bubbles.length; i++) {
                    for (let j = i + 1; j < bubbles.length; j++) {
                        const p = bubbles[i];
                        const q = bubbles[j];
                        const dx = q.x - p.x;
                        const dy = q.y - p.y;
                        const dist = Math.hypot(dx, dy) || 1;
                        const min = p.r + q.r;
                        if (dist >= min) continue;
                        const nx = dx / dist;
                        const ny = dy / dist;
                        const overlap = (min - dist) / 2;
                        p.x -= nx * overlap; p.y -= ny * overlap;
                        q.x += nx * overlap; q.y += ny * overlap;
                        const mp = p.r * p.r;
                        const mq = q.r * q.r;
                        const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
                        if (rel > 0) continue;
                        const imp = (2 * rel) / (mp + mq);
                        p.vx += imp * mq * nx; p.vy += imp * mq * ny;
                        q.vx -= imp * mp * nx; q.vy -= imp * mp * ny;
                    }
                }
                for (const b of bubbles) {
                    ctx.save();
                    ctx.translate(b.x, b.y);
                    ctx.rotate(b.a);
                    ctx.drawImage(b.img, -b.img.width / 2, -b.img.height / 2);
                    ctx.restore();
                }
            }
        };
    };

    /* Ribbons: a few ribbons whose heads wander on smooth curves; the strip is wide where it faces
       the viewer and edge-on where it twists, lit by the twist, and the tail fades out. */
    SAVERS.ribbons = (ctx, w, h, opts) => {
        const scale = opts.preview ? Math.max(0.12, w / 1920) : 1;
        const ribbons = [];
        const maxLen = opts.preview ? 90 : 220;
        function addRibbon() {
            ribbons.push({
                hue: rand(0, 360),
                pts: [],
                p: [rand(0, 1000), rand(0, 1000), rand(0, 1000), rand(0, 1000)],
                f: [rand(0.15, 0.35), rand(0.12, 0.3), rand(0.4, 0.9)],
                width: rand(18, 34) * scale,
                life: 0,
                ttl: rand(9, 16)
            });
        }
        for (let i = 0; i < 3; i++) addRibbon();
        return {
            resize(nw, nh) { w = nw; h = nh; },
            frame(t, dt) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                for (let k = ribbons.length - 1; k >= 0; k--) {
                    const r = ribbons[k];
                    r.life += dt;
                    const tt = r.life;
                    const x = w / 2 + Math.sin(tt * r.f[0] * 2.1 + r.p[0]) * w * 0.42 + Math.sin(tt * 1.3 + r.p[2]) * w * 0.05;
                    const y = h / 2 + Math.sin(tt * r.f[1] * 2.6 + r.p[1]) * h * 0.4 + Math.cos(tt * 1.1 + r.p[3]) * h * 0.05;
                    const twist = tt * r.f[2] * 3 + r.p[2];
                    r.pts.push({ x, y, twist });
                    if (r.pts.length > maxLen) r.pts.shift();
                    const fadeOut = r.life > r.ttl ? Math.max(0, 1 - (r.life - r.ttl) / 2) : 1;
                    const fadeIn = Math.min(1, r.life / 0.6);
                    const pts = r.pts;
                    for (let i = 1; i < pts.length - 1; i++) {
                        const a = pts[i - 1];
                        const b = pts[i];
                        const c = pts[i + 1];
                        const tx = c.x - a.x;
                        const ty = c.y - a.y;
                        const len = Math.hypot(tx, ty) || 1;
                        const nx = -ty / len;
                        const ny = tx / len;
                        const face = Math.cos(b.twist);
                        const half = r.width * (0.18 + 0.82 * Math.abs(face)) / 2;
                        const light = 28 + 42 * Math.abs(face) + (face > 0 ? 8 : 0);
                        const age = i / pts.length;
                        ctx.globalAlpha = Math.min(1, age * 1.6) * fadeOut * fadeIn;
                        ctx.fillStyle = `hsl(${(r.hue + i * 0.25) % 360} 85% ${light}%)`;
                        const pa = pts[i - 1];
                        const fa = Math.cos(pa.twist);
                        const ha = r.width * (0.18 + 0.82 * Math.abs(fa)) / 2;
                        ctx.beginPath();
                        ctx.moveTo(pa.x + nx * ha, pa.y + ny * ha);
                        ctx.lineTo(b.x + nx * half, b.y + ny * half);
                        ctx.lineTo(b.x - nx * half, b.y - ny * half);
                        ctx.lineTo(pa.x - nx * ha, pa.y - ny * ha);
                        ctx.closePath();
                        ctx.fill();
                    }
                    ctx.globalAlpha = 1;
                    if (fadeOut <= 0) {
                        ribbons.splice(k, 1);
                        addRibbon();
                    }
                }
            }
        };
    };

    /* Mystify: two polygons whose corners bounce off the edges, each drawn with fading copies. */
    SAVERS.mystify = (ctx, w, h, opts) => {
        const speed = opts.preview ? Math.max(20, w * 0.25) : 260;
        const trails = opts.preview ? 6 : 10;
        const shapes = [0, 1].map((i) => ({
            hue: i * 160 + rand(0, 60),
            pts: Array.from({ length: 4 }, () => ({ x: rand(0, w), y: rand(0, h), vx: rand(-1, 1) * speed, vy: rand(-1, 1) * speed })),
            hist: []
        }));
        let acc = 0;
        return {
            resize(nw, nh) { w = nw; h = nh; },
            frame(t, dt) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                acc += dt;
                const step = acc >= 0.05;
                if (step) acc = 0;
                ctx.lineWidth = opts.preview ? 1 : 1.6;
                ctx.globalCompositeOperation = 'lighter';
                for (const s of shapes) {
                    s.hue = (s.hue + dt * 18) % 360;
                    for (const p of s.pts) {
                        p.x += p.vx * dt;
                        p.y += p.vy * dt;
                        if (p.x < 0 || p.x > w) { p.vx *= -1; p.x = Math.max(0, Math.min(w, p.x)); }
                        if (p.y < 0 || p.y > h) { p.vy *= -1; p.y = Math.max(0, Math.min(h, p.y)); }
                    }
                    if (step) {
                        s.hist.unshift(s.pts.map((p) => ({ x: p.x, y: p.y })));
                        if (s.hist.length > trails) s.hist.pop();
                    }
                    const frames = [s.pts].concat(s.hist);
                    frames.forEach((f, i) => {
                        const a = 1 - i / (trails + 1);
                        ctx.strokeStyle = `hsl(${s.hue} 100% 62% / ${a * 0.25})`;
                        ctx.lineWidth = (opts.preview ? 2 : 5);
                        ctx.beginPath();
                        f.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
                        ctx.closePath();
                        ctx.stroke();
                        ctx.strokeStyle = `hsl(${s.hue} 100% 72% / ${a})`;
                        ctx.lineWidth = opts.preview ? 0.8 : 1.6;
                        ctx.stroke();
                    });
                }
                ctx.globalCompositeOperation = 'source-over';
            }
        };
    };

    /* Aurora: drawn small and scaled up (soft for free): vertical rays along a few drifting
       curtains, green low and violet high, added together. */
    SAVERS.aurora = (ctx, w, h) => {
        const small = doc.createElement('canvas');
        const sc = small.getContext('2d');
        let sw = 0;
        let sh = 0;
        function size() {
            sw = Math.max(48, Math.round(w / 6));
            sh = Math.max(32, Math.round(h / 6));
            small.width = sw;
            small.height = sh;
        }
        size();
        const curtains = Array.from({ length: 4 }, (_, i) => ({
            base: 0.32 + i * 0.1,
            amp: rand(0.05, 0.12),
            k: rand(1.2, 2.6),
            sp: rand(0.05, 0.12) * (i % 2 ? 1 : -1),
            ph: rand(0, 6),
            hue: [135, 155, 185, 275][i],
            len: rand(0.22, 0.4)
        }));
        return {
            resize(nw, nh) { w = nw; h = nh; size(); },
            frame(t) {
                sc.globalCompositeOperation = 'source-over';
                sc.fillStyle = 'rgba(0, 3, 10, 1)';
                sc.fillRect(0, 0, sw, sh);
                sc.globalCompositeOperation = 'lighter';
                for (const c of curtains) {
                    for (let x = 0; x < sw; x++) {
                        const u = x / sw;
                        const y0 = (c.base + Math.sin(u * c.k * 6.28 + t * c.sp * 6 + c.ph) * c.amp
                            + Math.sin(u * 17 + t * 0.7 + c.ph) * 0.012) * sh;
                        const bright = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(u * 23 + t * 0.9 + c.ph * 3) * 0.5 + 0.5), 2);
                        const len = c.len * sh * (0.7 + 0.3 * Math.sin(u * 9 + t * 0.4));
                        const g = sc.createLinearGradient(0, y0 - len, 0, y0 + 4);
                        g.addColorStop(0, `hsla(${c.hue + 70}, 90%, 55%, 0)`);
                        g.addColorStop(0.55, `hsla(${c.hue + 30}, 90%, 50%, ${0.18 * bright})`);
                        g.addColorStop(0.92, `hsla(${c.hue}, 95%, 60%, ${0.55 * bright})`);
                        g.addColorStop(1, `hsla(${c.hue}, 95%, 60%, 0)`);
                        sc.fillStyle = g;
                        sc.fillRect(x, y0 - len, 1, len + 4);
                    }
                }
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(small, 0, 0, w, h);
            }
        };
    };

    /* Photos: Vista and Melaton wallpapers with a slow pan and zoom, cross-fading. */
    SAVERS.photos = (ctx, w, h, opts) => {
        const vista = root.cplDesktopBackground && root.cplDesktopBackground.VISTA_WALLPAPERS;
        const ids = vista ? vista.map((v) => v.id) : ['img24', 'img25', 'img30', 'img31', 'img33', 'img34', 'img20', 'img16'];
        const dir = opts.preview ? '/static_images/wallpapers/vista/thumbs/' : '/static_images/wallpapers/vista/';
        const urls = ids.map((id) => `${dir}${id}.webp`).sort(() => Math.random() - 0.5);
        const own = wallpaperUrl();
        if (own && !opts.preview) urls.unshift(own);
        let index = 0;
        let cur = null;
        let next = null;
        let shownAt = 0;
        let loading = false;
        function fetchNext() {
            if (loading) return;
            loading = true;
            const url = urls[index++ % urls.length];
            loadImage(url).then((img) => {
                loading = false;
                if (img) next = { img, start: null, zoomIn: Math.random() < 0.5, dx: rand(-1, 1), dy: rand(-1, 1) };
            });
        }
        fetchNext();
        function draw(p, t, alpha) {
            const age = t - p.start;
            const k = Math.min(1, age / (PHOTO_SECONDS + 1.5));
            const z = p.zoomIn ? 1.04 + 0.1 * k : 1.14 - 0.1 * k;
            const iw = p.img.naturalWidth;
            const ih = p.img.naturalHeight;
            const cover = Math.max(w / iw, h / ih) * z;
            const dw = iw * cover;
            const dh = ih * cover;
            const x = (w - dw) / 2 + p.dx * (dw - w) * 0.5 * (k - 0.5);
            const y = (h - dh) / 2 + p.dy * (dh - h) * 0.5 * (k - 0.5);
            ctx.globalAlpha = alpha;
            ctx.drawImage(p.img, x, y, dw, dh);
            ctx.globalAlpha = 1;
        }
        return {
            resize(nw, nh) { w = nw; h = nh; },
            frame(t) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                if (!cur && next) {
                    cur = next; cur.start = t; next = null; shownAt = t; fetchNext();
                }
                if (!cur) return;
                const age = t - shownAt;
                if (age > PHOTO_SECONDS && next) {
                    if (next.start === null) next.start = t;
                    const fade = Math.min(1, (t - next.start) / 1.5);
                    draw(cur, t, 1);
                    draw(next, t, fade);
                    if (fade >= 1) {
                        cur = next; next = null; shownAt = t; fetchNext();
                    }
                    return;
                }
                draw(cur, t, 1);
            }
        };
    };

    /* Windows Logo: the start button's logo, fading in at a new place every few seconds. */
    SAVERS.logo = (ctx, w, h, opts) => {
        let img = null;
        // the start button's logo (modalUtils.js startMenuButtonLogoUrl, classic-script globals)
        /* global startMenuButtonLogoUrl, desktopSettingsGlobalState */
        const url = (typeof startMenuButtonLogoUrl === 'function' && typeof desktopSettingsGlobalState !== 'undefined')
            ? startMenuButtonLogoUrl(desktopSettingsGlobalState.startMenuButtonLogo)
            : '/static_images/logo_icon.png';
        loadImage(url.replace('/48/', '/96/')).then((i) => { img = i || null; if (!img) loadImage(url).then((j) => { img = j; }); });
        let spot = null;
        const cycle = 6;
        return {
            resize(nw, nh) { w = nw; h = nh; },
            frame(t) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                if (!img) return;
                const phase = t % cycle;
                if (!spot || phase < spot.phase) {
                    const size = Math.min(w, h) * (opts.preview ? 0.3 : 0.16);
                    spot = { size, x: rand(0, Math.max(1, w - size)), y: rand(0, Math.max(1, h - size)), phase };
                }
                spot.phase = phase;
                const a = phase < 1.5 ? phase / 1.5 : phase > cycle - 1.5 ? (cycle - phase) / 1.5 : 1;
                ctx.globalAlpha = Math.max(0, Math.min(1, a));
                const ratio = img.naturalHeight / (img.naturalWidth || 1);
                ctx.drawImage(img, spot.x, spot.y, spot.size, spot.size * ratio);
                ctx.globalAlpha = 1;
            }
        };
    };

    // ---- engine: one canvas, one saver, one animation frame loop ----

    function makeEngine(canvas, id, opts = {}) {
        const make = SAVERS[id];
        if (!make) return null;
        const ctx = canvas.getContext('2d');
        // full screen at CSS pixels (the savers are soft; 2x would double the fill cost)
        const ratio = opts.preview ? Math.min(2, root.devicePixelRatio || 1) : 1;
        let w = 0;
        let h = 0;
        function fit() {
            const r = canvas.getBoundingClientRect();
            w = Math.max(1, Math.round(r.width || canvas.clientWidth || 1));
            h = Math.max(1, Math.round(r.height || canvas.clientHeight || 1));
            canvas.width = Math.round(w * ratio);
            canvas.height = Math.round(h * ratio);
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        fit();
        const saver = make(ctx, w, h, opts);
        let raf = 0;
        let last = 0;
        let t = 0;
        let stopped = false;
        function loop(now) {
            if (stopped) return;
            const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
            last = now;
            t += dt;
            try { saver.frame(t, dt); } catch (err) { console.error('screenSaver frame', err); stop(); return; }
            raf = root.requestAnimationFrame(loop);
        }
        function onResize() {
            fit();
            if (saver.resize) saver.resize(w, h);
        }
        function stop() {
            stopped = true;
            root.cancelAnimationFrame(raf);
            root.removeEventListener('resize', onResize);
        }
        root.addEventListener('resize', onResize);
        raf = root.requestAnimationFrame(loop);
        return { stop, transparent: !!saver.transparent };
    }

    // ---- the cover ----

    function ensureStyle() {
        if (doc.getElementById('screenSaverStyle')) return;
        const style = doc.createElement('style');
        style.id = 'screenSaverStyle';
        style.textContent = `
#screenSaverCover {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-fullscreen-system, 100000) + 1);
    background: #000;
    cursor: none;
    contain: strict;
}
#screenSaverCover.is-transparent { background: transparent; }
#screenSaverCover canvas { display: block; width: 100%; height: 100%; }`;
        doc.head.appendChild(style);
    }

    function show(id, reason) {
        if (!doc || !SAVERS[id]) return false;
        hide(false);
        ensureStyle();
        const cover = doc.createElement('div');
        cover.id = 'screenSaverCover';
        cover.setAttribute('aria-hidden', 'true');
        const canvas = doc.createElement('canvas');
        cover.appendChild(canvas);
        doc.body.appendChild(cover);
        state.cover = cover;
        state.canvas = canvas;
        state.showing = reason;
        state.shownAt = Date.now();
        state.startPoint = null;
        state.engine = makeEngine(canvas, id);
        if (state.engine && state.engine.transparent) cover.classList.add('is-transparent');
        if (typeof root.closeAllContextMenus === 'function') {
            try { root.closeAllContextMenus(); } catch (_) { /* optional */ }
        }
        return true;
    }

    function hide(fromInput) {
        const was = state.showing;
        if (state.engine) state.engine.stop();
        if (state.cover && state.cover.parentNode) state.cover.parentNode.removeChild(state.cover);
        state.engine = null;
        state.cover = null;
        state.canvas = null;
        state.showing = null;
        if (fromInput && was === 'idle' && settings().resumeLogon) {
            const boot = root.desktopBoot;
            if (boot && typeof boot.lockWorkstation === 'function') boot.lockWorkstation();
        }
    }

    function focusCover() {
        return root.focusCover && typeof root.focusCover.show === 'function' ? root.focusCover : null;
    }

    /** Start the workspace's saver on idle. */
    function startIdle() {
        const s = settings();
        if (s.id === 'none') return false;
        if (s.id === 'focus') {
            const fc = focusCover();
            if (!fc) return false;
            fc.show(true);
            state.showing = 'idle-focus';
            return true;
        }
        return show(s.id, 'idle');
    }

    function onInput(ev) {
        const now = Date.now();
        if (!state.showing) {
            state.lastInput = now;
            return;
        }
        if (state.showing === 'idle-focus') {
            // the focus cover ends itself on click / key (focusOverlayManager.js)
            state.lastInput = now;
            if (ev.type !== 'pointermove' && ev.type !== 'mousemove') {
                state.showing = null;
                if (settings().resumeLogon) {
                    const boot = root.desktopBoot;
                    if (boot && typeof boot.lockWorkstation === 'function') boot.lockWorkstation();
                }
            }
            return;
        }
        if (ev.type === 'pointermove' || ev.type === 'mousemove') {
            // the first move after showing sets the start; only travel past the threshold ends it
            if (now - state.shownAt < 400) return;
            if (!state.startPoint) { state.startPoint = { x: ev.clientX, y: ev.clientY }; return; }
            if (Math.hypot(ev.clientX - state.startPoint.x, ev.clientY - state.startPoint.y) < MOVE_THRESHOLD) return;
        }
        if (state.showing === 'focus') return; // focus return ends it (hideForFocusReturn)
        state.lastInput = now;
        if (ev.cancelable && ev.type !== 'pointermove' && ev.type !== 'mousemove' && ev.type !== 'wheel') {
            ev.preventDefault();
            ev.stopPropagation();
        }
        hide(true);
    }

    function tick() {
        if (state.showing) return;
        const s = settings();
        if (s.id === 'none' || blocked()) return;
        if (Date.now() - state.lastInput >= s.wait * 60000) startIdle();
    }

    function bind() {
        if (state.bound || !doc || isAgentTab()) return;
        state.bound = true;
        ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((type) => {
            doc.addEventListener(type, onInput, { capture: true, passive: type === 'pointermove' || type === 'wheel' || type === 'touchstart' });
        });
        state.timer = root.setInterval(tick, CHECK_MS);
        doc.addEventListener('desktopWorkstationLocked', () => hide(false));
    }

    const api = {
        IDS: Object.keys(SAVERS),
        /** The dialog's Preview: full screen until input (never locks). */
        preview(id) {
            if (id === 'focus') {
                const fc = focusCover();
                if (fc) { fc.show(true); state.showing = 'idle-focus'; }
                return;
            }
            if (show(id, 'preview')) state.lastInput = Date.now();
        },
        /** The dialog's monitor picture. */
        attachPreview(canvas, id) {
            if (!canvas || !SAVERS[id]) return { stop() {} };
            return makeEngine(canvas, id, { preview: true }) || { stop() {} };
        },
        /** focusOverlayManager.js: the Focus Cover shows the workspace's saver when it has one. */
        showForFocusLoss() {
            const s = settings();
            if (s.id === 'none' || s.id === 'focus' || isAgentTab()) return false;
            if (state.showing) return true;
            return show(s.id, 'focus');
        },
        hideForFocusReturn() {
            if (state.showing === 'focus') hide(false);
        },
        isShowing: () => !!state.showing,
        hide: () => hide(false),
        _test: { state, SAVERS, settings }
    };

    root.screenSaver = api;
    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', bind);
        else bind();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
