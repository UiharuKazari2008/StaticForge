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
 *   logo     logon.scr (Melaton Logo): the Melaton logo and the flaring glyph in turn across a black screen
 *   mystify  two four-point polygons with trails, colours cycling, on black
 *   photos   Windows Pictures, workspace images, a saved Image Search or a VFS folder, in one of
 *            Vista's slide show themes, optionally in black and white (Photos)
 *   ribbons  twisting lit ribbons that grow and fade on black
 *
 *   screenSaver.preview(id, opts?)         full screen until input (the dialog's Preview)
 *   screenSaver.attachPreview(canvas, id, opts?)  the dialog's monitor picture; returns { stop() }
 *       opts.photos: the Photos settings to show instead of the saved ones (unsaved dialog choices)
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

    /** The dedicated agent tab (/app?agent=1) or any browser driven by automation (WebDriver,
        headless Chrome): no idle start and never a lock. */
    function isAgentTab() {
        try {
            const nav = root.navigator || {};
            if (nav.webdriver === true || /HeadlessChrome/.test(String(nav.userAgent || ''))) return true;
            return new URLSearchParams(root.location.search).get('agent') === '1';
        } catch (_) {
            return false;
        }
    }

    function lockOnResume() {
        if (isAgentTab() || !settings().resumeLogon) return;
        const boot = root.desktopBoot;
        if (boot && typeof boot.lockWorkstation === 'function') boot.lockWorkstation();
    }

    /** A visible video that is playing (Media Player, a gallery video): Vista holds the saver off. */
    function videoPlaying() {
        if (!doc) return false;
        return Array.from(doc.querySelectorAll('video')).some((v) => !v.paused && !v.ended && v.readyState > 2 && v.getClientRects().length > 0);
    }

    function blocked() {
        const b = doc && doc.body;
        if (!b || !b.classList.contains('desktop-mode')) return true;
        // locked, booting (boot-staged, the start-up classes) or held by the server-restart lock
        if (['workstation-locked', 'initializing', 'boot-from-launch', 'windows-startup', 'boot-staged', 'session-suspended']
            .some((c) => b.classList.contains(c))) return true;
        if (doc.fullscreenElement || videoPlaying()) return true;
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

    // the dialog's monitor for (None) and the focus cover: just the desktop (the engine's backdrop)
    const PREVIEW_ONLY = { desktop: () => ({ transparent: true, frame() {} }) };

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

    // ---- Photos: its pictures (photoSource) and Vista's slide show themes ----

    const PHOTO_SECONDS = { slow: 10, medium: 6, fast: 3 };
    const PHOTO_AGE_MS = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5, year: 365 * 864e5 };
    const PHOTO_THEMES = ['classic', 'fade', 'panzoom', 'travel', 'frame', 'stack'];

    function photoSettings() {
        const pers = root.desktopPersonalization;
        const s = settings();
        return pers && typeof pers.normalizePhotos === 'function' ? pers.normalizePhotos(s.photos) : (s.photos || {});
    }

    function galleryUrl(file, base, preview) {
        /* global localGalleryImageUrl, resolveGalleryPreviewUrl */
        if (preview && base && typeof resolveGalleryPreviewUrl === 'function') return resolveGalleryPreviewUrl({ base });
        if (file && typeof localGalleryImageUrl === 'function') return localGalleryImageUrl(file);
        return file ? `/images/${encodeURIComponent(file)}` : null;
    }

    /** Every picture of the chosen workspaces' galleries (newest first), stopping at the age limit. */
    async function workspacePhotoUrls(ps, preview) {
        const client = root.wsClient;
        /* global workspaces, activeWorkspace */
        const all = typeof workspaces !== 'undefined' && workspaces ? Object.keys(workspaces) : [];
        const current = (typeof activeWorkspace !== 'undefined' && activeWorkspace) || 'default';
        const ids = ps.workspace === 'all' ? all : [ps.workspace === 'current' ? current : ps.workspace].filter((id) => all.includes(id) || id === current);
        const cutoff = PHOTO_AGE_MS[ps.age] ? Date.now() - PHOTO_AGE_MS[ps.age] : 0;
        const urls = [];
        if (!client || typeof client.sendMessage !== 'function') return urls;
        for (const workspaceId of ids) {
            for (let offset = 0; offset < 2000 && urls.length < 4000; offset += 200) {
                let data = null;
                try {
                    // request_gallery: modules/ws/handlers/120-galleryHandler.js (newest first, with mtime)
                    data = await client.sendMessage('request_gallery', {
                        viewType: ps.favorites ? 'pinned' : 'images', includePinnedStatus: false, workspaceId, offset, limit: 200, light: true
                    }, false);
                } catch (_) { break; }
                const rows = (data && data.gallery) || [];
                let older = false;
                for (const row of rows) {
                    if (cutoff && Number(row.mtime) < cutoff) { older = true; break; }
                    const url = galleryUrl(row.filename || row.upscaled || row.original, row.base, preview);
                    if (url) urls.push(url);
                }
                if (older || rows.length < 200) break;
            }
        }
        return urls;
    }

    /** The image files of a VFS folder (Explorer's listing, vfsClient.js). */
    async function folderPhotoUrls(ps, preview) {
        /* global vfsClient */
        if (!ps.folder || typeof vfsClient === 'undefined') return [];
        let res = null;
        try { res = await vfsClient.listDirectory(ps.folder.path, { offset: 0, limit: 1000 }); } catch (_) { return []; }
        const urls = [];
        ((res && res.items) || []).forEach((item) => {
            // gallery pictures, scraps, references (they carry a previewUrl) and image files
            const isImage = item.targetKind === 'image' || item.targetKind === 'scrap' || item.targetKind === 'reference'
                || /^image\//.test(item.mimeType || item.mime || '') || /\.(png|jpe?g|webp|gif)$/i.test(item.name || '');
            if (!isImage || item.kind === 'folder') return;
            let url = null;
            if (item.targetKind === 'image' || item.targetKind === 'scrap') {
                const file = item.previewImageFilename || item.targetId;
                url = galleryUrl(file, preview && file ? String(file).replace(/\.(png|jpe?g|webp)$/i, '').replace(/_upscaled$/, '') : null, preview);
            } else {
                url = item.url || item.downloadUrl || item.fileUrl || item.previewUrl || null;
            }
            if (url) urls.push(url);
        });
        return urls;
    }

    /** A picture source: next() resolves the next URL (or null when there are none). */
    function photoSource(ps, preview) {
        let list = null;
        let at = 0;
        let seq = 0;
        const order = (urls) => (ps.shuffle ? urls.sort(() => Math.random() - 0.5) : urls);
        async function ensure() {
            if (list) return list;
            if (ps.source === 'workspace') list = order(await workspacePhotoUrls(ps, preview));
            else if (ps.source === 'folder') list = order(await folderPhotoUrls(ps, preview));
            else {
                const vista = root.cplDesktopBackground && root.cplDesktopBackground.VISTA_WALLPAPERS;
                const ids = vista ? vista.map((v) => v.id) : ['img24', 'img25', 'img30', 'img31', 'img33', 'img34', 'img20', 'img16'];
                const dir = preview ? '/static_images/wallpapers/vista/thumbs/' : '/static_images/wallpapers/vista/';
                list = order(ids.map((id) => `${dir}${id}.webp`));
            }
            return list;
        }
        return {
            async next() {
                if (ps.source === 'search') {
                    const client = root.wsClient;
                    if (!ps.search || !client) return null;
                    try {
                        // sidebar_random_image: modules/ws/handlers/290-sidebarHandler.js (the Slide Show gadget's)
                        const data = await client.sendMessage('sidebar_random_image', {
                            source: 'images', offset: ps.shuffle ? undefined : seq++, search: ps.search
                        }, false);
                        const item = data && data.item;
                        return item ? galleryUrl(item.upscaled || item.original, item.base, preview) : null;
                    } catch (_) { return null; }
                }
                const urls = await ensure();
                if (!urls.length) return null;
                const url = urls[at % urls.length];
                at += 1;
                return url;
            }
        };
    }

    /* Photos: Vista's Photos screen saver. The pictures come from Windows Pictures, workspace
       images, a saved Image Search or a folder; each theme moves them its own way (Classic cuts,
       Fade cross-fades, Pan and zoom drifts, Travel slides across, Frame mounts each in a white
       mat, Stack piles them up); Monotone draws them in black and white. */
    SAVERS.photos = (ctx, w, h, opts) => {
        const ps = opts.photos || photoSettings();
        const hold = PHOTO_SECONDS[ps.speed] || 6;
        const source = photoSource(ps, !!opts.preview);
        const scale = opts.preview ? Math.max(0.1, w / 1920) : 1;
        let cur = null;
        let next = null;
        let shownAt = 0;
        let loading = false;
        let empty = false;
        let misses = 0;
        let dead = false; // the engine stopped: no more fetching or retrying
        const pile = []; // Stack: the pictures already put down
        function themeFor() {
            return ps.theme === 'random' ? PHOTO_THEMES[Math.floor(Math.random() * PHOTO_THEMES.length)] : ps.theme;
        }
        function fetchNext() {
            if (loading || dead) return;
            loading = true;
            source.next().then((url) => (url && !dead ? loadImage(url) : null)).then((img) => {
                loading = false;
                if (dead) return;
                if (!img) {
                    misses += 1;
                    // nothing at all after a few tries: say so; with a picture up, keep trying, slower
                    if (misses > 3 && !cur) empty = true;
                    else setTimeout(fetchNext, misses > 3 ? 10000 : 1500);
                    return;
                }
                misses = 0;
                next = {
                    img, start: null, theme: themeFor(),
                    zoomIn: Math.random() < 0.5, dx: rand(-1, 1), dy: rand(-1, 1), rot: rand(-0.12, 0.12),
                    px: rand(0.3, 0.7), py: rand(0.35, 0.65)
                };
            });
        }
        fetchNext();
        function fit(img, k, cover) {
            const iw = img.naturalWidth;
            const ih = img.naturalHeight;
            const f = (cover ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih)) * k;
            return [iw * f, ih * f];
        }
        function framed(p, size, alpha, x, y, rot) {
            const [dw, dh] = fit(p.img, size, false);
            const mat = Math.max(2, 14 * scale);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 18 * scale;
            ctx.shadowOffsetY = 6 * scale;
            ctx.fillStyle = '#fbfbf8';
            ctx.fillRect(-dw / 2 - mat, -dh / 2 - mat, dw + mat * 2, dh + mat * 2);
            ctx.shadowColor = 'transparent';
            ctx.drawImage(p.img, -dw / 2, -dh / 2, dw, dh);
            ctx.restore();
        }
        function draw(p, t, alpha, enter) {
            const age = t - p.start;
            const k = Math.min(1, age / (hold + 1.5));
            if (p.theme === 'panzoom') {
                const z = p.zoomIn ? 1.04 + 0.1 * k : 1.14 - 0.1 * k;
                const [dw, dh] = fit(p.img, z, true);
                ctx.globalAlpha = alpha;
                ctx.drawImage(p.img, (w - dw) / 2 + p.dx * (dw - w) * 0.5 * (k - 0.5), (h - dh) / 2 + p.dy * (dh - h) * 0.5 * (k - 0.5), dw, dh);
            } else if (p.theme === 'travel') {
                const [dw, dh] = fit(p.img, 0.82, false);
                // slides in from the right, drifts, and leaves to the left as the next comes in
                const inK = Math.min(1, age / 1.2);
                const ease = 1 - Math.pow(1 - inK, 3);
                const x = (w - dw) / 2 + (1 - ease) * w * 0.9 - (enter === false ? (1 - alpha) * w * 0.9 : 0) - k * 30 * scale;
                ctx.globalAlpha = 1;
                ctx.drawImage(p.img, x, (h - dh) / 2, dw, dh);
            } else if (p.theme === 'frame') {
                framed(p, 0.72, alpha, w / 2, h / 2, p.rot * 0.4);
            } else if (p.theme === 'stack') {
                const drop = Math.min(1, age / 0.6);
                framed(p, 0.55, 1, w * p.px, h * p.py - (1 - drop) * 40 * scale, p.rot);
            } else {
                // classic and fade show the whole picture
                const [dw, dh] = fit(p.img, 1, false);
                ctx.globalAlpha = p.theme === 'classic' ? 1 : alpha;
                ctx.drawImage(p.img, (w - dw) / 2, (h - dh) / 2, dw, dh);
            }
            ctx.globalAlpha = 1;
        }
        return {
            resize(nw, nh) { w = nw; h = nh; },
            stop() { dead = true; },
            frame(t) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                ctx.filter = ps.monotone ? 'grayscale(1)' : 'none';
                if (empty) {
                    ctx.filter = 'none';
                    ctx.fillStyle = '#fff';
                    ctx.font = `${Math.max(8, Math.round(16 * scale * 1.4))}px "Segoe UI", Tahoma, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.fillText(opts.preview ? 'No pictures' : 'There are no pictures or videos to play. Change your Photos Screen Saver settings.', w / 2, h / 2);
                    return;
                }
                if (!cur && next) { cur = next; cur.start = t; next = null; shownAt = t; fetchNext(); }
                if (!cur) return;
                if (cur.theme === 'stack' || (next && next.theme === 'stack')) {
                    pile.forEach((p) => framed(p, 0.55, 1, w * p.px, h * p.py, p.rot));
                }
                const age = t - shownAt;
                if (age > hold && next) {
                    if (next.start === null) next.start = t;
                    const dur = next.theme === 'classic' ? 0 : next.theme === 'travel' ? 1.2 : next.theme === 'stack' ? 0.6 : 1.5;
                    const fade = dur ? Math.min(1, (t - next.start) / dur) : 1;
                    if (next.theme !== 'stack') draw(cur, t, next.theme === 'travel' ? 1 - fade : 1, false);
                    else draw(cur, t, 1);
                    draw(next, t, fade, true);
                    if (fade >= 1) {
                        if (cur.theme === 'stack' || next.theme === 'stack') {
                            pile.push(cur);
                            if (pile.length > 6) pile.shift();
                        } else pile.length = 0;
                        cur = next; next = null; shownAt = t; fetchNext();
                    }
                    ctx.filter = 'none';
                    return;
                }
                draw(cur, t, 1);
                ctx.filter = 'none';
            }
        };
    };

    /* Windows Logo (logon.scr, measured on the Vista VM): black, then at a random place either the
       Melaton logo (the flower over the wordmark, where Vista has its flag) or the glyph, the green swoosh a flare of light runs
       along (logon.scr bitmaps IDB_FLARE01-45, IDB_SMALLFLARE for small screens). Each fades in
       over 1.6 s, holds, fades out over 2.7 s, and the screen stays black for 5 s before the next
       one, logo and glyph in turn. */
    const LOGO_ART = '/static_images/vista-personalization';
    SAVERS.logo = (ctx, w, h, opts) => {
        const small = !!opts.preview;
        const art = { logo: null, sheet: null };
        loadImage(`${LOGO_ART}/logo-saver.png`).then((i) => { art.logo = i; });
        loadImage(`${LOGO_ART}/${small ? 'logo-flare-small-sheet.png' : 'logo-flare-sheet.png'}`).then((i) => { art.sheet = i; });
        const FW = small ? 69 : 274;
        const FH = small ? 36 : 144;
        const FADE_IN = 1.6;
        const HOLD = 4.2;
        const FADE_OUT = 2.7;
        const GAP = 5;
        const FLARE_FPS = 15;
        let item = null;
        let count = 0;
        function place(t) {
            const kind = count % 2 === 0 ? 'logo' : 'glyph';
            count += 1;
            const iw = kind === 'logo' ? (small ? 48 : 194) : FW;
            const ih = kind === 'logo' ? (small ? 33 : 135) : FH;
            item = { kind, start: t, iw, ih, x: rand(0, Math.max(1, w - iw)), y: rand(0, Math.max(1, h - ih)) };
        }
        return {
            resize(nw, nh) { w = nw; h = nh; },
            frame(t) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                if (!art.logo || !art.sheet) return;
                if (!item) place(t + (small ? 0.3 : 1.5));
                const age = t - item.start;
                const life = FADE_IN + HOLD + FADE_OUT;
                if (age < 0) return;
                if (age > life + GAP) { place(t); return; }
                if (age > life) return;
                const a = age < FADE_IN ? age / FADE_IN : age > FADE_IN + HOLD ? (life - age) / FADE_OUT : 1;
                ctx.globalAlpha = Math.max(0, Math.min(1, a));
                if (item.kind === 'logo') {
                    ctx.drawImage(art.logo, item.x, item.y, item.iw, item.ih);
                } else {
                    const f = Math.min(44, Math.floor(age * FLARE_FPS));
                    ctx.drawImage(art.sheet, (f % 9) * FW, Math.floor(f / 9) * FH, FW, FH, item.x, item.y, FW, FH);
                }
                ctx.globalAlpha = 1;
            }
        };
    };

    // ---- engine: one canvas, one saver, one animation frame loop ----

    /** opts.backdrop: a picture drawn under a transparent saver inside the canvas itself (the
        dialog's monitor; an accelerated canvas can drop its alpha and show black where it is clear) */
    function makeEngine(canvas, id, opts = {}) {
        const make = SAVERS[id] || (opts.preview ? PREVIEW_ONLY[id] : null);
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
        let backdrop = null;
        if (opts.backdrop && saver.transparent) loadImage(opts.backdrop).then((img) => { backdrop = img; });
        const drawBackdrop = () => {
            if (!backdrop) return;
            const iw = backdrop.naturalWidth;
            const ih = backdrop.naturalHeight;
            const k = Math.max(w / iw, h / ih);
            ctx.drawImage(backdrop, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
        };
        let raf = 0;
        let last = 0;
        let t = 0;
        let stopped = false;
        function loop(now) {
            if (stopped) return;
            const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
            last = now;
            t += dt;
            try {
                saver.frame(t, dt);
                if (backdrop) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'destination-over';
                    drawBackdrop();
                    ctx.restore();
                }
            } catch (err) { console.error('screenSaver frame', err); stop(); return; }
            raf = root.requestAnimationFrame(loop);
        }
        function onResize() {
            fit();
            if (saver.resize) saver.resize(w, h);
        }
        function stop() {
            stopped = true;
            if (typeof saver.stop === 'function') saver.stop();
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

    function show(id, reason, extra) {
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
        state.engine = makeEngine(canvas, id, extra || {});
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
        if (fromInput && was === 'idle') lockOnResume();
    }

    /** The mouse press that ends a saver must not also click what is under it: swallow the rest of
        that press (up, click, menu) for a moment. */
    function swallowRestOfPress() {
        const types = ['pointerup', 'mouseup', 'click', 'auxclick', 'contextmenu', 'dblclick'];
        const eat = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.type === 'click' || ev.type === 'contextmenu') done();
        };
        const done = () => types.forEach((t) => root.removeEventListener(t, eat, true));
        types.forEach((t) => root.addEventListener(t, eat, true));
        setTimeout(done, 700);
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
        if (state.showing === 'idle-focus' || state.showing === 'preview-focus') {
            // the focus cover ends itself on click / key (focusOverlayManager.js); only the one
            // that started on idle locks, never a Preview
            state.lastInput = now;
            if (ev.type !== 'pointermove' && ev.type !== 'mousemove') {
                const was = state.showing;
                state.showing = null;
                if (was === 'idle-focus') lockOnResume();
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
            if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
        }
        if (ev.type === 'pointerdown' || ev.type === 'touchstart') swallowRestOfPress();
        hide(true);
    }

    const INPUT_TYPES = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
    const inputOptions = (type) => ({ capture: true, passive: type === 'pointermove' || type === 'wheel' || type === 'touchstart' });

    /** Typing or pointing inside a same-origin frame (Grimoire pages, applets) counts as input too. */
    function watchFrames() {
        if (!doc) return;
        doc.querySelectorAll('iframe').forEach((frame) => {
            let win = null;
            try { win = frame.contentWindow; void win.document; } catch (_) { return; } // cross-origin
            if (!win || win.__screenSaverWatched) return;
            win.__screenSaverWatched = true;
            INPUT_TYPES.forEach((type) => {
                win.addEventListener(type, () => { state.lastInput = Date.now(); }, inputOptions(type));
            });
        });
    }

    function tick() {
        watchFrames();
        if (state.showing) return;
        const s = settings();
        if (s.id === 'none' || blocked()) return;
        if (Date.now() - state.lastInput >= s.wait * 60000) startIdle();
    }

    function bind() {
        if (state.bound || !doc) return;
        state.bound = true;
        // input always ends a saver (a Preview too); only the idle start stays off on the agent tab.
        // On the window, in capture: ahead of every document-level listener (modalKeyboardRegistry.js),
        // so the key that wakes the screen does nothing else
        INPUT_TYPES.forEach((type) => root.addEventListener(type, onInput, inputOptions(type)));
        if (!isAgentTab()) state.timer = root.setInterval(tick, CHECK_MS);
        doc.addEventListener('desktopWorkstationLocked', () => hide(false));
    }

    const api = {
        IDS: Object.keys(SAVERS),
        /** The dialog's Preview: full screen until input (never locks). */
        preview(id, extra) {
            if (id === 'focus') {
                const fc = focusCover();
                if (fc) { fc.show(true); state.showing = 'preview-focus'; }
                return;
            }
            if (show(id, 'preview', extra)) state.lastInput = Date.now();
        },
        /** The dialog's monitor picture; 'desktop' shows only the desktop picture. */
        attachPreview(canvas, id, extra = {}) {
            if (!canvas || !(SAVERS[id] || PREVIEW_ONLY[id])) return { stop() {} };
            return makeEngine(canvas, id, { preview: true, backdrop: wallpaperUrl(), ...extra }) || { stop() {} };
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
        _test: { state, SAVERS, settings, tick, blocked }
    };

    root.screenSaver = api;
    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', bind);
        else bind();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
