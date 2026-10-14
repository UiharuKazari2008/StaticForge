// planetSwitcher.js
// Planet switcher: a tilted ring of glass "planet" bubbles (one per workspace) around a plasma sun,
// over a star field.
//
// Opening shrinks and fades the desktop layers (#desktopWallpaper, #desktopIcons, #desktopTaskbar)
// and every open window with the Web Animations API. Only `scale` + `opacity` are animated, around
// a transform-origin computed at the viewport centre, so window sizes, positions and their own
// `transform` are never touched. Tapping a planet centres it; tapping the centred planet travels:
// the ring settles first (selection tween), then the workspace loads (setActiveWorkspace + the
// workspaceSwitchComplete / workspaceChanged events from workspaceUtils.js) while the bubble pulses,
// then the view zooms into the bubble, fades to black and zooms the desktop back in. Esc / Cancel
// reverses the opening animation.
//
// Lazy feature "planet_switcher" (featureLoader.js). Entry point: openPlanetSwitcher() in modalUtils.js.
// Monolith globals used: workspaces, activeWorkspace, setActiveWorkspace, wsClient, allImages,
// resolveWorkspaceWallpaperUrl, closeStartMenu, showGlassToast, createWheelTickGate, guardWheelTick,
// formatWorkspaceProgressStatusText, shouldGalleryProgressUseDeterminate, preloadWallpaperIntoMemory.

const PLANET_SWITCHER_TIMING = Object.freeze({
    holderIn: 4500,      // Layer 2 fade + scale in
    windowsScale: 2500,  // open windows 100% -> 75%
    windowsFade: 2000,   // open windows 100% -> 0%
    desktopScale: 3000,  // wallpaper / icons / taskbar 100% -> 50%
    desktopFade: 2950,   // wallpaper / icons / taskbar 100% -> 0%
    starsIn: 2000,       // star field fade in (black backdrop is instant)
    cancel: 520,         // quick undo of the opening animation
    navigate: 480,       // ring rotation per step
    select: 950,         // chosen planet to centre, others away
    settle: 260,         // pause after the selection tween before the real switch starts
    zoomIn: 1500,        // zoom into the bubble + fade to black
    reveal: 1500         // desktop + windows 80% -> 100%, 0% -> 100%
});

const PLANET_SWITCHER_SAMPLE_LIMIT = 12;     // rows requested per list (recent + favourites) per workspace
const PLANET_SWITCHER_PER_SOURCE = 6;        // slides kept from each list after spreading / seed de-duplication
const PLANET_SWITCHER_SLIDES_MAX = 12;       // slides kept per planet
const PLANET_SWITCHER_SLIDE_PERIOD = 6800;   // ms per slide (plus a per-planet stagger)
const PLANET_SWITCHER_SLIDE_FADE = 1600;     // must match .planet-switcher-slide transition
const PLANET_SWITCHER_LOAD_IDLE_MS = 60000;
const PLANET_SWITCHER_SELECT_GROW = 1.9;     // focused bubble scale while loading
const PLANET_SWITCHER_ZOOM_OVERSHOOT = 1.3;  // final zoom: bubble diameter vs viewport diagonal
const PLANET_SWITCHER_TILT_DEG = 12;        // desktop zoom-out: bottom edge recedes faster than the top
const PLANET_SWITCHER_REFLECT = 0.45;        // reflection height as a fraction of the bubble
const PLANET_SWITCHER_WOBBLE = 0.03;         // idle ring rotation amplitude (rad), compositor driven
const PLANET_SWITCHER_WOBBLE_MS = 16000;     // half period of the idle wobble
const PLANET_SWITCHER_TILE_MAX = 72;         // baked slide tiles kept across opens (raised per open to fit every slide)
const PLANET_SWITCHER_BGM = Object.freeze({
    url: '/sounds/planet/innerlight.opus',
    gain: 0.48,          // file is already -20 LUFS; this sits under Vista SFX
    gainActive: 0.62,    // lift when travel starts (Enter / tap again)
    fadeActivate: 560,   // nudge up
    fadeOut: 480,        // cancel overlay
    // zoomIn + reveal is 3000; keep fading after the desktop is back
    fadeTravel: 5200
});

/** Pure ring geometry. Also exercised by scripts/test-planet-switcher-ring.js (node). */
const PlanetRingMath = {
    TAU: Math.PI * 2,
    MAX_STEP: Math.PI / 2.6,
    MIN_SCALE: 0.38,
    MIN_OPACITY: 0.35,

    /** Angular distance between neighbours: a full ring when there are many planets, an arc when few. */
    step(count) {
        if (count <= 1) return 0;
        return Math.min(this.TAU / count, this.MAX_STEP);
    },

    isFullRing(count) {
        return count > 1 && this.TAU / count <= this.MAX_STEP + 1e-9;
    },

    /** Ring rotation that puts planet `index` at the front (angle 0). */
    angleFor(index, count) {
        return -index * this.step(count);
    },

    /** Signed rotation from `from` to `to`; takes the short way round on a full ring. */
    delta(from, to, count) {
        let d = to - from;
        if (this.isFullRing(count)) {
            d = ((d + Math.PI) % this.TAU + this.TAU) % this.TAU - Math.PI;
        }
        return d;
    },

    /** Index after moving by `dir`: wraps on a full ring, clamps on an arc. */
    nextIndex(index, dir, count) {
        if (count <= 0) return 0;
        if (this.isFullRing(count)) return ((index + dir) % count + count) % count;
        return Math.max(0, Math.min(count - 1, index + dir));
    },

    /**
     * Ellipse radii for `count` planets of `size` px so neighbours never bunch up. The ring widens with
     * the count; past `maxRadiusX` the planets shrink instead (sizeScale < 1).
     */
    radii(count, size, maxRadiusX) {
        const perimeterNeeded = Math.max(1, count) * size * 1.08;
        const wanted = Math.max(size * 1.6, perimeterNeeded / 4.64);
        const radiusX = Math.min(wanted, maxRadiusX);
        const sizeScale = wanted > maxRadiusX ? Math.max(0.55, maxRadiusX / wanted) : 1;
        return { radiusX, radiusY: radiusX * 0.32, sizeScale };
    },

    /** Screen placement of planet `index` for ring rotation `ringAngle`. depth 1 = front (low), -1 = back (high). */
    place(index, count, ringAngle, radiusX, radiusY) {
        const angle = ringAngle + index * this.step(count);
        const depth = Math.cos(angle);
        const t = (depth + 1) / 2;
        return {
            angle,
            depth,
            x: Math.sin(angle) * radiusX,
            y: depth * radiusY,
            scale: this.MIN_SCALE + (1 - this.MIN_SCALE) * t,
            opacity: this.MIN_OPACITY + (1 - this.MIN_OPACITY) * t,
            z: Math.round(100 + depth * 100)
        };
    },

    easeInOut(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },

    /** Fisher-Yates on a copy. `random` is injectable for tests. */
    shuffle(list, random = Math.random) {
        const out = list.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            const tmp = out[i];
            out[i] = out[j];
            out[j] = tmp;
        }
        return out;
    },

    /** Same generation batch shares the trailing seed; treat those as one picture. */
    slideKey(item) {
        const url = item && item.url ? String(item.url) : '';
        const m = url.match(/_(\d{6,})(?:%40[^/]*|@[^/]*)?\.webp$/i);
        return m ? `seed:${m[1]}` : url;
    },

    /** Every k-th item of a newest-first list so "recent" spans a stretch of time instead of one batch. */
    spread(list, n) {
        if (!Array.isArray(list) || list.length <= n) return (list || []).slice();
        const out = [];
        const stride = list.length / n;
        for (let i = 0; i < n; i++) out.push(list[Math.min(list.length - 1, Math.floor(i * stride))]);
        return out;
    },

    /** Alternate favourites and recent (both shuffled), unique by picture, so no two neighbours share a source/time. */
    mixSlides(recent, favorites, max, random = Math.random) {
        const a = this.shuffle(favorites, random);
        const b = this.shuffle(recent, random);
        const seen = new Set();
        const out = [];
        let i = 0;
        let j = 0;
        let takeFavorite = a.length > 0;
        while (out.length < max && (i < a.length || j < b.length)) {
            const source = takeFavorite ? a : b;
            const idx = takeFavorite ? i : j;
            if (idx < source.length) {
                const item = source[idx];
                if (takeFavorite) i++; else j++;
                const key = item && item.url ? this.slideKey(item) : null;
                if (key && !seen.has(key) && !seen.has(item.url)) {
                    seen.add(key);
                    seen.add(item.url);
                    out.push(item);
                }
            }
            if (i < a.length && j < b.length) takeFavorite = !takeFavorite;
            else takeFavorite = i < a.length;
        }
        return out;
    }
};

/**
 * Source cache: each slide source is fetched (service worker cache first), decoded and centre-cropped
 * to the tile size with createImageBitmap, which runs off the main thread. The result is consumed
 * by the tile baker and closed; older engines fall back to an Image element.
 */
const planetSwitcherImageCache = {
    entries: new Map(),
    queue: [],
    active: 0,
    concurrency: 6, // service-worker fetches dominate; decode runs off-thread
    maxEntries: 240,

    key(url, size) {
        return `${url}|${size}`;
    },

    ready(url, size) {
        const entry = this.entries.get(this.key(url, size));
        return Boolean(entry && entry.ok && entry.source);
    },

    load(url, size) {
        if (!url) return Promise.resolve(false);
        const key = this.key(url, size);
        const existing = this.entries.get(key);
        if (existing) return existing.promise;
        const entry = { ok: false, source: null, promise: null, failed: false };
        entry.promise = new Promise((resolve) => {
            this.queue.push({ url, size, entry, resolve });
        });
        this.entries.set(key, entry);
        this.trim();
        this.pump();
        return entry.promise;
    },

    take(url, size) {
        const key = this.key(url, size);
        const entry = this.entries.get(key);
        if (!entry || !entry.ok || !entry.source) return null;
        const source = entry.source;
        this.entries.delete(key);
        return source;
    },

    release(source) {
        if (source && typeof source.close === 'function') {
            try { source.close(); } catch (error) { /* already closed */ }
        }
    },

    trim() {
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            const entry = this.entries.get(oldest);
            if (entry && !entry.ok && !entry.failed) break; // still queued; keep order intact
            if (entry) this.release(entry.source);
            this.entries.delete(oldest);
        }
    },

    pump() {
        while (this.active < this.concurrency && this.queue.length) {
            const job = this.queue.shift();
            this.active++;
            this.produce(job.url, job.size).then((source) => {
                job.entry.ok = Boolean(source);
                job.entry.failed = !source;
                job.entry.source = source || null;
                this.active--;
                job.resolve(Boolean(source));
                this.pump();
            });
        }
    },

    async produce(url, size) {
        if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
            try {
                const res = await fetch(url, { credentials: 'same-origin' });
                if (!res.ok) return null;
                const blob = await res.blob();
                const full = await createImageBitmap(blob);
                const side = Math.max(1, Math.min(full.width, full.height));
                const cropped = await createImageBitmap(
                    full,
                    Math.floor((full.width - side) / 2),
                    Math.floor((full.height - side) / 2),
                    side,
                    side,
                    { resizeWidth: size, resizeHeight: size, resizeQuality: 'medium' }
                );
                full.close();
                return cropped;
            } catch (error) {
                return null;
            }
        }
        return new Promise((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
                const decode = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
                decode.then(() => resolve(img), () => resolve(img.naturalWidth > 0 ? img : null));
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }
};

/**
 * Baked slide tiles: the photo is drawn once into a small canvas, desaturated, tinted with the workspace
 * colour, vignetted and glossed. Slides are then plain canvas layers with nothing to filter or blend
 * per frame. Keyed by url + colour + size, small LRU so re-opens show instantly.
 */
const planetSwitcherTileCache = {
    entries: new Map(),
    max: PLANET_SWITCHER_TILE_MAX,

    key(url, color, size) {
        return `${url}|${color}|${size}`;
    },

    get(key) {
        const tile = this.entries.get(key);
        if (!tile) return null;
        this.entries.delete(key);
        this.entries.set(key, tile);
        return tile;
    },

    set(key, tile) {
        this.entries.set(key, tile);
        while (this.entries.size > this.max) {
            this.entries.delete(this.entries.keys().next().value);
        }
    },

    /** Canvas-normalised rgba string for any CSS colour (fillStyle round-trip), with the given alpha. */
    rgba(ctx, color, alpha) {
        ctx.fillStyle = color;
        const normalized = String(ctx.fillStyle);
        let r = 99;
        let g = 102;
        let b = 241;
        const hex = normalized.match(/^#([0-9a-f]{6})$/i);
        const fn = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (hex) {
            r = parseInt(hex[1].slice(0, 2), 16);
            g = parseInt(hex[1].slice(2, 4), 16);
            b = parseInt(hex[1].slice(4, 6), 16);
        } else if (fn) {
            r = Number(fn[1]);
            g = Number(fn[2]);
            b = Number(fn[3]);
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    bake(source, color, size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;
        const iw = source.naturalWidth || source.width || size;
        const ih = source.naturalHeight || source.height || size;
        const scale = Math.max(size / iw, size / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        ctx.drawImage(source, (size - dw) / 2, (size - dh) / 2, dw, dh);
        // desaturate most of the way with a grey 'saturation' blend (cheap, tile-sized)
        ctx.globalCompositeOperation = 'saturation';
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, size, size);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        // flat tint
        ctx.fillStyle = this.rgba(ctx, color, 0.36);
        ctx.fillRect(0, 0, size, size);
        // coloured edge veil
        const veil = ctx.createRadialGradient(size * 0.5, size * 0.45, size * 0.16, size * 0.5, size * 0.5, size * 0.56);
        veil.addColorStop(0, 'rgba(0, 0, 0, 0)');
        veil.addColorStop(1, this.rgba(ctx, color, 0.6));
        ctx.fillStyle = veil;
        ctx.fillRect(0, 0, size, size);
        // dark rim
        const rim = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.28, size * 0.5, size * 0.5, size * 0.5);
        rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
        rim.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
        ctx.fillStyle = rim;
        ctx.fillRect(0, 0, size, size);
        // glass highlight (squashed ellipse, top-left)
        ctx.save();
        ctx.translate(size * 0.32, size * 0.2);
        ctx.scale(1, 0.66);
        const gloss = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.42);
        gloss.addColorStop(0, 'rgba(255, 255, 255, 0.58)');
        gloss.addColorStop(0.52, 'rgba(255, 255, 255, 0.1)');
        gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gloss;
        ctx.fillRect(-size, -size, size * 3, size * 3);
        ctx.restore();
        return canvas;
    }
};

/** Perspective star field on one canvas: slow drift while browsing, warp with trails while loading. */
class PlanetStarField {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });
        this.stars = [];
        this.speed = 0.05;
        this.targetSpeed = 0.05;
        this.width = 0;
        this.height = 0;
        this.dpr = 1;
        this.reduced = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        this.resize();
    }

    resize() {
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        // Half-resolution backing store: soft stars, a quarter of the fill cost
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.25) * 0.5;
        this.width = w;
        this.height = h;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const wanted = Math.max(140, Math.min(300, Math.round((w * h) / 6000)));
        while (this.stars.length < wanted) this.stars.push(this.spawn(true));
        this.stars.length = wanted;
    }

    spawn(anyDepth) {
        const hue = 195 + Math.random() * 70;
        const sat = 15 + Math.random() * 55;
        return {
            x: Math.random() * 2 - 1,
            y: Math.random() * 2 - 1,
            z: anyDepth ? 0.08 + Math.random() * 0.92 : 1,
            twinkle: Math.random() * Math.PI * 2,
            color: `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% 88%)`,
            px: null,
            py: null
        };
    }

    warp(on) {
        this.targetSpeed = on ? (this.reduced ? 0.35 : 1.7) : 0.05;
    }

    step(dt, time) {
        this.speed += (this.targetSpeed - this.speed) * (1 - Math.exp(-dt * 1.4));
        // Idle drift redraws at ~24fps; the warp runs every frame
        this.carry = (this.carry || 0) + dt;
        if (this.speed < 0.14 && this.carry < 0.04) {
            return;
        }
        dt = this.carry;
        this.carry = 0;
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const cx = w / 2;
        const cy = h / 2;
        const trailing = this.speed > 0.14 && !this.reduced;

        if (trailing) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.6, 0.16 + this.speed * 0.22).toFixed(3)})`;
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';
        } else {
            ctx.clearRect(0, 0, w, h);
        }

        const move = this.speed * dt;
        const stars = this.stars;
        for (let i = 0; i < stars.length; i++) {
            let s = stars[i];
            s.z -= move;
            if (s.z <= 0.02) {
                s = stars[i] = this.spawn(false);
            }
            const sx = cx + (s.x / s.z) * cx;
            const sy = cy + (s.y / s.z) * cy;
            if (sx < -4 || sx > w + 4 || sy < -4 || sy > h + 4) {
                stars[i] = this.spawn(false);
                continue;
            }
            const near = 1 - s.z;
            const size = 0.5 + near * near * 2.4;
            const twinkle = 0.72 + 0.28 * Math.sin(time * 0.0025 + s.twinkle);
            ctx.globalAlpha = Math.min(1, (0.14 + near * 0.95) * twinkle);
            if (trailing && s.px !== null) {
                ctx.strokeStyle = s.color;
                ctx.lineWidth = size;
                ctx.beginPath();
                ctx.moveTo(s.px, s.py);
                ctx.lineTo(sx, sy);
                ctx.stroke();
            } else {
                ctx.fillStyle = s.color;
                ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
            }
            s.px = sx;
            s.py = sy;
        }
        ctx.globalAlpha = 1;
    }
}

class PlanetSwitcher {
    constructor() {
        this.state = 'idle';
        this.root = null;
        this.backdrop = null;
        this.holder = null;
        this.ring = null;
        this.sun = null;
        this.fade = null;
        this.cancelBtn = null;
        this.planets = [];
        this.count = 0;
        this.index = 0;
        this.ringAngle = 0;
        this.focusedIndex = -1;
        this.tileSize = 256;
        this.bakeQueue = [];
        this.bakeTimer = 0;
        this.selectU = 0;
        this.tween = null;
        this.layerAnims = [];
        this.overlayAnims = [];
        this.desktopLayer = [];
        this.windowLayer = [];
        this.stars = null;
        this.raf = 0;
        this.lastFrame = 0;
        this.slideTimer = 0;
        this.loadGen = 0;
        this.radiusX = 400;
        this.radiusY = 128;
        this.sizeScale = 1;
        this.pointer = null;
        this.suppressClickUntil = 0;
        this.loadKick = null;
        this.loadStarted = false;
        this.loadStartedAt = 0;
        this.selectResolve = null;
        this.prevFocus = null;
        this.reducedMotion = false;
        this.allowWheelTick = typeof createWheelTickGate === 'function' ? createWheelTickGate(140) : () => true;
        this._onKeyDown = (e) => this.handleKeyDown(e);
        this._onKeyUp = (e) => this.handleKeyUp(e);
        this._onResize = () => this.handleResize();
        this._frame = (t) => this.frame(t);
        this.bgm = null;
        this.bgmFade = null;
        this.bgmTicker = 0;
        this.bgmHold = false;
    }

    isActive() {
        return this.state !== 'idle';
    }

    // ---------- open ----------

    async open() {
        if (this.state !== 'idle') return;
        const desktop = document.body.classList.contains('desktop-mode') || window.isDesktop;
        if (!desktop) {
            this.toast('info', 'Planets', 'Desktop mode required');
            return;
        }
        if (window.isWorkspaceSwitching) {
            this.toast('info', 'Planets', 'A workspace switch is already running');
            return;
        }
        const list = this.collectWorkspaces();
        if (!list.length) {
            this.toast('info', 'Planets', 'No workspaces to switch between');
            return;
        }

        this.state = 'opening';
        this.reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        // closeStartMenu: public/scripts/comp/modalUtils.js
        if (typeof closeStartMenu === 'function') closeStartMenu({ immediate: true });
        if (typeof contextMenu !== 'undefined' && contextMenu && typeof contextMenu.hideMenu === 'function') {
            contextMenu.hideMenu();
        }
        this.prevFocus = document.activeElement;
        if (this.prevFocus && typeof this.prevFocus.blur === 'function') this.prevFocus.blur();

        document.body.classList.add('planet-switcher-active', 'planet-switcher-flat');
        this.count = list.length;
        this.computeRingMetrics();
        this.buildDom(list);
        this.applyRingSize();
        const currentId = this.currentWorkspaceId();
        this.index = Math.max(0, list.findIndex((ws) => ws.id === currentId));
        this.ringAngle = PlanetRingMath.angleFor(this.index, this.count);
        this.selectU = 0;
        this.focusedIndex = -1;
        this.applyRing();
        this.startWobble();

        this.captureLayers();
        this.animateLayersOut();
        this.animateOverlayIn();
        this.startLoop();
        this.startSlides();

        window.addEventListener('keydown', this._onKeyDown, true);
        window.addEventListener('keyup', this._onKeyUp, true);
        window.addEventListener('resize', this._onResize);
        this.root.focus({ preventScroll: true });
        this.state = 'browsing';
        this.loadSamples(list);
        // desktopSounds.play: public/scripts/comp/desktopSounds.js
        desktopSounds.play('planet-enter');
        this.startBgm();
    }

    collectWorkspaces() {
        const data = (typeof workspaces !== 'undefined' && workspaces) ? workspaces : (window.workspaces || {});
        return Object.values(data)
            .filter((ws) => ws && ws.id)
            .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }

    currentWorkspaceId() {
        if (typeof activeWorkspace !== 'undefined' && activeWorkspace) return activeWorkspace;
        return window.currentWorkspace || window.activeWorkspace || 'default';
    }

    toast(type, title, message) {
        if (typeof showGlassToast === 'function') {
            showGlassToast(type, title, message, false, 2500);
        }
    }

    buildDom(list) {
        const backdrop = document.createElement('div');
        backdrop.className = 'planet-switcher-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        const nebula = document.createElement('div');
        nebula.className = 'planet-switcher-nebula';
        const canvas = document.createElement('canvas');
        canvas.className = 'planet-switcher-stars';
        backdrop.appendChild(nebula);
        backdrop.appendChild(canvas);
        document.body.insertBefore(backdrop, document.body.firstChild);
        this.backdrop = backdrop;
        this.nebula = nebula;
        this.canvas = canvas;
        this.stars = new PlanetStarField(canvas);

        const root = document.createElement('div');
        root.className = 'planet-switcher';
        root.id = 'planetSwitcher';
        root.tabIndex = -1;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'Planet switcher');

        const brand = document.createElement('div');
        brand.className = 'planet-switcher-brand';
        const brandText = document.createElement('span');
        brandText.className = 'logo-text';
        brandText.textContent = 'Dreamscape';
        const brandSub = document.createElement('span');
        brandSub.className = 'planet-switcher-brand-sub';
        brandSub.textContent = 'Planets';
        brand.appendChild(brandText);
        brand.appendChild(brandSub);
        root.appendChild(brand);

        const holder = document.createElement('div');
        holder.className = 'planet-switcher-holder';
        const ring = document.createElement('div');
        ring.className = 'planet-switcher-ring';
        holder.appendChild(ring);
        root.appendChild(holder);

        const sun = document.createElement('div');
        sun.className = 'planet-switcher-sun';
        sun.setAttribute('aria-hidden', 'true');
        ['planet-switcher-sun-corona', 'planet-switcher-sun-plasma p1', 'planet-switcher-sun-plasma p2', 'planet-switcher-sun-plasma p3', 'planet-switcher-sun-core']
            .forEach((cls) => {
                const layer = document.createElement('div');
                layer.className = cls;
                sun.appendChild(layer);
            });
        ring.appendChild(sun);

        this.planets = list.map((ws, i) => this.buildPlanet(ws, i, ring));
        this.count = this.planets.length;

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'planet-switcher-cancel';
        cancelBtn.innerHTML = '<i class="fas fa-xmark"></i><span>Cancel</span><kbd>Esc</kbd>';
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.cancel();
        });
        root.appendChild(cancelBtn);

        const hint = document.createElement('div');
        hint.className = 'planet-switcher-hint';
        hint.textContent = 'Arrow keys, wheel or drag to browse - tap a planet to centre it, tap again or Enter to travel - Esc to cancel';
        root.appendChild(hint);

        const fade = document.createElement('div');
        fade.className = 'planet-switcher-fade';
        root.appendChild(fade);

        root.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
        root.addEventListener('pointermove', (e) => this.handlePointerMove(e));
        root.addEventListener('pointerup', (e) => this.handlePointerUp(e));
        root.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
        root.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        root.addEventListener('contextmenu', (e) => e.preventDefault());

        document.body.appendChild(root);
        this.root = root;
        this.holder = holder;
        this.ring = ring;
        this.sun = sun;
        this.cancelBtn = cancelBtn;
        this.hint = hint;
        this.fade = fade;
    }

    buildPlanet(ws, index, ring) {
        const el = document.createElement('div');
        el.className = 'planet-switcher-planet';
        el.dataset.workspaceId = ws.id;
        el.setAttribute('role', 'button');
        el.tabIndex = -1;
        const color = typeof ws.color === 'string' && ws.color ? ws.color : '#6366f1';
        el.style.setProperty('--planet-color', color);
        if (ws.id === this.currentWorkspaceId()) el.classList.add('is-current');

        const orbit = document.createElement('div');
        orbit.className = 'planet-switcher-orbit';
        const wrap = document.createElement('div');
        wrap.className = 'planet-switcher-bubble-wrap';
        const bubble = document.createElement('div');
        bubble.className = 'planet-switcher-bubble';
        bubble.style.setProperty('--planet-color', color);
        const slides = document.createElement('div');
        slides.className = 'planet-switcher-slides';
        bubble.appendChild(slides);
        // Both slots exist from the start (bottom, top) so no layers are added while pictures arrive
        const slots = [this.createSlideSlot(slides), this.createSlideSlot(slides)];
        wrap.appendChild(bubble);
        // Flip 3D style reflection: the bubble's lower cap mirrored, masked by CSS, redrawn only on swaps
        const reflect = document.createElement('canvas');
        reflect.className = 'planet-switcher-reflect';
        reflect.width = this.tileSize;
        reflect.height = Math.round(this.tileSize * PLANET_SWITCHER_REFLECT);
        reflect.setAttribute('aria-hidden', 'true');
        wrap.appendChild(reflect);

        // Text never sits on a scaled layer: the bubble wrap scales with depth, the popover and the
        // labels only translate to follow it, so they stay crisp at every ring position.
        const tip = document.createElement('div');
        tip.className = 'planet-switcher-tip';
        tip.textContent = ws.name || ws.id;
        orbit.appendChild(tip);
        orbit.appendChild(wrap);

        const labels = document.createElement('div');
        labels.className = 'planet-switcher-labels';
        orbit.appendChild(labels);

        const name = document.createElement('div');
        name.className = 'planet-switcher-name';
        name.textContent = ws.name || ws.id;
        labels.appendChild(name);

        const count = document.createElement('div');
        count.className = 'planet-switcher-count';
        count.textContent = this.formatCount(ws.fileCount);
        labels.appendChild(count);

        const status = document.createElement('div');
        status.className = 'planet-switcher-status';
        labels.appendChild(status);

        const progress = document.createElement('div');
        progress.className = 'planet-switcher-progress marquee';
        progress.setAttribute('role', 'progressbar');
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', '100');
        const fill = document.createElement('div');
        fill.className = 'planet-switcher-progress-fill';
        progress.appendChild(fill);
        labels.appendChild(progress);
        el.appendChild(orbit);

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (performance.now() < this.suppressClickUntil) return;
            this.tap(index);
        });

        ring.appendChild(el);
        return {
            id: ws.id,
            ws,
            el,
            orbit,
            wrap,
            reflect,
            tip,
            labels,
            bubble,
            slides,
            name,
            count,
            status,
            progress,
            progressFill: fill,
            color,
            sheet: null,
            sheetImg: null,
            images: [],
            tiles: [],
            slots,
            wobbleAnim: null,
            topShown: false,
            slideIndex: 0,
            shown: false,
            swapping: false,
            period: PLANET_SWITCHER_SLIDE_PERIOD + index * 450,
            nextAt: 0
        };
    }

    formatCount(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return '';
        if (n === 1) return '1 image';
        return `${n.toLocaleString()} images`;
    }

    // ---------- layers (desktop + windows) ----------

    captureLayers() {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const desktopEls = ['desktopWallpaper', 'desktopIcons', 'desktopTaskbar']
            .map((id) => document.getElementById(id))
            .filter(Boolean);
        this.desktopLayer = desktopEls.map((el) => this.prepareLayerEl(el, cx, cy));
        this.windowLayer = this.collectWindowElements().map((el) => this.prepareLayerEl(el, cx, cy));
    }

    collectWindowElements() {
        const candidates = [];
        document.querySelectorAll('.modal, #galleryWindow').forEach((el) => {
            if (el === this.root || el.classList.contains('hidden') || el.classList.contains('hidden-alt')) return;
            if (el.classList.contains('closing') || el.classList.contains('minimised')) return;
            candidates.push(el);
        });
        return candidates.filter((el) => getComputedStyle(el).display !== 'none');
    }

    prepareLayerEl(el, cx, cy) {
        const computed = getComputedStyle(el);
        const rec = {
            el,
            prevOrigin: el.style.transformOrigin,
            opacity: Math.min(1, Math.max(0, parseFloat(computed.opacity) || 1))
        };
        this.setViewportOrigin(el, computed, cx, cy);
        return rec;
    }

    /** transform-origin at the viewport centre, in the element's own (pre-transform) box coordinates. */
    setViewportOrigin(el, computed, cx, cy) {
        const rect = el.getBoundingClientRect();
        let tx = 0;
        let ty = 0;
        let pureTranslate = true;
        const t = computed.transform;
        if (t && t !== 'none') {
            try {
                const m = new DOMMatrixReadOnly(t);
                if (m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1) {
                    tx = m.e;
                    ty = m.f;
                } else {
                    pureTranslate = false;
                }
            } catch (error) {
                pureTranslate = false;
            }
        }
        const left = pureTranslate ? rect.left - tx : el.offsetLeft;
        const top = pureTranslate ? rect.top - ty : el.offsetTop;
        el.style.transformOrigin = `${(cx - left).toFixed(2)}px ${(cy - top).toFixed(2)}px`;
    }

    restoreLayerOrigins() {
        [...this.desktopLayer, ...this.windowLayer].forEach((rec) => {
            rec.el.style.transformOrigin = rec.prevOrigin || '';
        });
    }

    animateLayersOut() {
        const T = PLANET_SWITCHER_TIMING;
        const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
        this.layerAnims = [];
        this.windowLayer.forEach(({ el, opacity }) => {
            this.layerAnims.push(el.animate([{ scale: '1' }, { scale: '0.75' }], { duration: T.windowsScale, easing: ease, fill: 'forwards' }));
            this.layerAnims.push(el.animate([{ opacity }, { opacity: 0 }], { duration: T.windowsFade, easing: 'ease-out', fill: 'forwards' }));
        });
        this.desktopLayer.forEach(({ el, opacity }) => {
            this.layerAnims.push(el.animate([{ scale: '1' }, { scale: '0.5' }], { duration: T.desktopScale, easing: ease, fill: 'forwards' }));
            // Flip-3D style tilt: the bottom edge recedes faster than the top
            this.layerAnims.push(el.animate(
                [{ transform: 'perspective(1400px) rotateX(0deg)' }, { transform: `perspective(1400px) rotateX(${-PLANET_SWITCHER_TILT_DEG}deg)` }],
                { duration: T.desktopScale, easing: ease, fill: 'forwards' }
            ));
            this.layerAnims.push(el.animate([{ opacity }, { opacity: 0 }], { duration: T.desktopFade, easing: 'ease-out', fill: 'forwards' }));
        });
    }

    animateOverlayIn() {
        const T = PLANET_SWITCHER_TIMING;
        this.overlayAnims = [
            this.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out', fill: 'forwards' }),
            this.holder.animate(
                [{ opacity: 0, scale: '0.62' }, { opacity: 1, scale: '1' }],
                { duration: T.holderIn, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
            ),
            this.nebula.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.starsIn, easing: 'ease-out', fill: 'forwards' }),
            this.canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.starsIn, easing: 'ease-out', fill: 'forwards' })
        ];
    }

    // ---------- ring ----------

    /** Mirrors the stylesheet's --planet-size clamp(110px, 16vmin, 200px) without a forced style read. */
    planetSizePx() {
        const vmin = Math.min(window.innerWidth || 0, window.innerHeight || 0);
        return Math.max(110, Math.min(200, vmin * 0.16)) || 180;
    }

    computeRingMetrics() {
        const base = this.planetSizePx();
        const maxRadiusX = Math.max(160, window.innerWidth * 0.46 - base * 0.5);
        const { radiusX, radiusY, sizeScale } = PlanetRingMath.radii(this.count, base, maxRadiusX);
        this.radiusX = radiusX;
        this.radiusY = Math.min(radiusY, window.innerHeight * 0.2);
        this.sizeScale = sizeScale;
        this.planetSize = base * sizeScale;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.tileSize = Math.round(Math.max(192, Math.min(320, base * sizeScale * dpr)));
    }

    applyRingSize() {
        if (this.ring) {
            // Planets shrink (via the CSS size var) once the ring cannot widen any further
            this.ring.style.setProperty('--planet-size', `${this.planetSize.toFixed(1)}px`);
        }
    }

    layoutRing() {
        this.computeRingMetrics();
        this.applyRingSize();
    }

    // ---------- idle wobble (compositor) ----------

    /**
     * Slight ring rotation while browsing, as one transform animation per planet on its orbit wrapper:
     * tangent direction from the planet's angle, so nothing is written from JavaScript per frame.
     */
    startWobble(phaseMs = null) {
        if (this.reducedMotion || !this.count) return;
        const base = this.ringAngle;
        this.planets.forEach((p, i) => {
            const angle = base + i * PlanetRingMath.step(this.count);
            const dx = PLANET_SWITCHER_WOBBLE * Math.cos(angle) * this.radiusX;
            const dy = -PLANET_SWITCHER_WOBBLE * Math.sin(angle) * this.radiusY;
            if (p.wobbleAnim) p.wobbleAnim.cancel();
            p.wobbleAnim = p.orbit.animate(
                [{ transform: `translate3d(${(-dx).toFixed(2)}px, ${(-dy).toFixed(2)}px, 0)` }, { transform: `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)` }],
                { duration: PLANET_SWITCHER_WOBBLE_MS, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' }
            );
            if (phaseMs != null) {
                try { p.wobbleAnim.currentTime = phaseMs; } catch (error) { /* older engines */ }
            }
        });
    }

    /** Ease the wobble out (selection) or stop it outright (teardown). */
    stopWobble(easeMs = 0) {
        this.planets.forEach((p) => {
            if (!p.wobbleAnim) return;
            const current = getComputedStyle(p.orbit).transform;
            p.wobbleAnim.cancel();
            p.wobbleAnim = null;
            if (easeMs > 0 && current && current !== 'none') {
                p.orbit.animate([{ transform: current }, { transform: 'none' }], { duration: easeMs, easing: 'ease-out', fill: 'forwards' });
            }
        });
    }

    applyRing() {
        const u = this.selectU;
        const angle = this.ringAngle;
        for (let i = 0; i < this.count; i++) {
            const p = this.planets[i];
            const pos = PlanetRingMath.place(i, this.count, angle, this.radiusX, this.radiusY);
            let x = pos.x;
            let y = pos.y;
            let s = pos.scale;
            let o = pos.opacity;
            let z = pos.z;
            if (u > 0) {
                if (i === this.index) {
                    x *= 1 - u;
                    y *= 1 - u;
                    s *= 1 + (PLANET_SWITCHER_SELECT_GROW - 1) * u;
                    o = 1;
                    z = 400;
                } else {
                    x *= 1 + 0.9 * u;
                    y -= 40 * u;
                    s *= 1 - 0.35 * u;
                    o *= 1 - u;
                }
            }
            const transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
            const opacity = o.toFixed(3);
            const zIndex = String(z);
            const depth = s.toFixed(3);
            if (p.lastTransform !== transform) { p.el.style.transform = transform; p.lastTransform = transform; }
            if (p.lastDepth !== depth) {
                const belowPivot = this.planetSize * (0.5 + PLANET_SWITCHER_REFLECT) + 4;
                const labelShift = (s - 1) * belowPivot;
                const tipShift = ((1 - s) * this.planetSize) / 2;
                p.wrap.style.transform = `scale(${depth})`;
                p.labels.style.transform = `translate3d(0, ${labelShift.toFixed(1)}px, 0)`;
                p.tip.style.transform = `translate(-50%, ${tipShift.toFixed(1)}px)`;
                p.lastDepth = depth;
            }
            if (p.lastOpacity !== opacity) { p.el.style.opacity = opacity; p.lastOpacity = opacity; }
            if (p.lastZ !== zIndex) { p.el.style.zIndex = zIndex; p.lastZ = zIndex; }
        }
        if (this.focusedIndex !== this.index) {
            if (this.planets[this.focusedIndex]) this.planets[this.focusedIndex].el.classList.remove('is-focused');
            if (this.planets[this.index]) this.planets[this.index].el.classList.add('is-focused');
            this.focusedIndex = this.index;
        }
    }

    navigate(dir) {
        if (this.state !== 'browsing' && this.state !== 'opening') return;
        const next = PlanetRingMath.nextIndex(this.index, dir, this.count);
        if (next === this.index) return;
        this.goTo(next);
    }

    goTo(index, options = {}) {
        if (index < 0 || index >= this.count) return;
        this.index = index;
        const target = PlanetRingMath.angleFor(index, this.count);
        const to = this.ringAngle + PlanetRingMath.delta(this.ringAngle, target, this.count);
        const onDone = options.onDone || null;
        this.tween = {
            from: this.ringAngle,
            to,
            fromU: this.selectU,
            toU: options.selectU != null ? options.selectU : this.selectU,
            start: performance.now(),
            duration: options.duration || PLANET_SWITCHER_TIMING.navigate,
            onDone: () => {
                // The wobble keeps the tangents computed at open: re-aiming it would recreate 14
                // compositor animations on every rotation, and the few px of error are invisible.
                if (typeof onDone === 'function') onDone();
            }
        };
    }

    /** Tap: centre the planet first; a tap on the centred planet travels. */
    tap(index) {
        if (this.state !== 'browsing') return;
        if (index !== this.index) {
            this.goTo(index);
            return;
        }
        this.select(index);
    }

    stepTween(now) {
        const tw = this.tween;
        const p = Math.min(1, (now - tw.start) / tw.duration);
        const e = PlanetRingMath.easeInOut(p);
        this.ringAngle = tw.from + (tw.to - tw.from) * e;
        this.selectU = tw.fromU + (tw.toU - tw.fromU) * e;
        if (p >= 1) {
            this.tween = null;
            if (typeof tw.onDone === 'function') tw.onDone();
        }
    }

    // ---------- loop ----------

    startLoop() {
        this.lastFrame = performance.now();
        this.raf = requestAnimationFrame(this._frame);
    }

    stopLoop() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
    }

    frame(now) {
        if (this.state === 'idle') return;
        const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
        this.lastFrame = now;
        if (this.stars && !document.hidden) this.stars.step(dt, now);
        this.stepBgm(now);
        if (this.tween) {
            this.stepTween(now);
            this.applyRing();
        }
        this.raf = requestAnimationFrame(this._frame);
    }

    handleResize() {
        if (!this.isActive()) return;
        if (this.stars) this.stars.resize();
        this.layoutRing();
        this.applyRing();
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        [...this.desktopLayer, ...this.windowLayer].forEach((rec) => {
            this.setViewportOrigin(rec.el, getComputedStyle(rec.el), cx, cy);
        });
    }

    // ---------- slideshow ----------

    startSlides() {
        this.slideTimer = setInterval(() => this.tickSlides(), 240);
    }

    tickSlides() {
        const now = performance.now();
        for (const p of this.planets) {
            if (!p.shown || p.swapping || this.slideCount(p) < 2 || now < p.nextAt) continue;
            if (this.advanceSlide(p)) {
                p.nextAt = now + p.period;
            } else {
                p.nextAt = now + 900; // nothing decoded yet; look again soon
            }
        }
    }

    async loadSamples(list) {
        const gen = ++this.loadGen;
        const ids = list.map((ws) => ws.id);
        let samples = {};
        try {
            if (window.wsClient && wsClient.isConnected() && typeof wsClient.getWorkspacePreviewSamples === 'function') {
                const res = await Promise.race([
                    wsClient.getWorkspacePreviewSamples(ids, PLANET_SWITCHER_SAMPLE_LIMIT, this.tileSize),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
                ]);
                samples = (res && res.samples) || (res && res.data && res.data.samples) || {};
            }
        } catch (error) {
            // Older server (packet unknown) or slow link: bubbles fall back to the loaded gallery / wallpaper
            samples = {};
        }
        if (gen !== this.loadGen || !this.isActive()) return;

        const currentId = this.currentWorkspaceId();
        this.planets.forEach((p) => {
            const sample = samples[p.id];
            let recent = [];
            let favorites = [];
            p.sheet = null;
            if (Array.isArray(sample)) {
                recent = this.normalizeSamples(sample);
            } else if (sample && typeof sample === 'object') {
                recent = this.normalizeSamples(sample.recent);
                favorites = this.normalizeSamples(sample.favorites);
                if (Number.isFinite(Number(sample.imageCount)) && sample.imageCount >= 0) {
                    p.count.textContent = this.formatCount(sample.imageCount);
                }
                // Server-baked sprite sheet: one strip per planet, nothing to decode or draw here
                const sheet = sample.sheet;
                const slides = this.normalizeSamples(sample.slides);
                if (sheet && typeof sheet.url === 'string' && Number(sheet.count) > 0 && slides.length) {
                    p.sheet = { url: sheet.url, tile: Number(sheet.tile) || this.tileSize, count: Math.min(Number(sheet.count), slides.length) };
                    p.images = slides;
                }
            }
            if (!recent.length && !favorites.length && p.id === currentId && typeof allImages !== 'undefined' && Array.isArray(allImages)) {
                recent = this.normalizeSamples(allImages.slice(0, PLANET_SWITCHER_SAMPLE_LIMIT * 2));
            }
            if (p.sheet) return;
            let images = PlanetRingMath.mixSlides(
                PlanetRingMath.spread(recent, PLANET_SWITCHER_PER_SOURCE),
                favorites.slice(0, PLANET_SWITCHER_PER_SOURCE * 2),
                PLANET_SWITCHER_SLIDES_MAX
            );
            if (!images.length) {
                // resolveWorkspaceWallpaperUrl: public/scripts/comp/modalUtils.js
                const url = typeof resolveWorkspaceWallpaperUrl === 'function' ? resolveWorkspaceWallpaperUrl(p.ws.wallpaper) : null;
                if (url) images = [{ url, blurhash: null }];
            }
            p.images = images;
        });

        // Sheet planets: load the strip (service worker cache first) and show it; fall back to tiles on failure
        this.planets.forEach((p, i) => {
            if (!p.sheet) return;
            p.nextAt = performance.now() + 1400 + i * 520;
            this.mountSheet(p, gen);
        });

        // Warm the source cache round-robin so every planet gets its first picture early; broken files drop out.
        // Baking into tiles happens in small idle batches after the first tile of each planet.
        this.warmTiles(this.planets.filter((p) => !p.sheet), gen);
    }

    /** Client-side path (no sheet): decode sources off-thread round-robin, bake the first tile of each planet now. */
    warmTiles(planets, gen) {
        const totalSlides = this.planets.reduce((sum, p) => sum + p.images.length, 0);
        planetSwitcherTileCache.max = Math.max(PLANET_SWITCHER_TILE_MAX, totalSlides + 8);
        const longest = planets.reduce((max, p) => Math.max(max, p.images.length), 0);
        const size = this.tileSize;
        for (let k = 0; k < longest; k++) {
            planets.forEach((p) => {
                const image = p.images[k];
                if (!image) return;
                planetSwitcherImageCache.load(image.url, size).then((ok) => {
                    if (gen !== this.loadGen) return;
                    if (!ok) {
                        this.dropImage(p, image.url);
                        return;
                    }
                    if (k > 0) this.queueBake(p, image.url);
                });
            });
        }
        planets.forEach((p) => {
            if (!p.images.length) return;
            const i = this.planets.indexOf(p);
            p.nextAt = performance.now() + 1400 + Math.max(0, i) * 520;
            this.mountFirstSlide(p, gen);
        });
    }

    // ---------- sprite sheet slides ----------

    slideCount(p) {
        return p.sheet ? p.sheet.count : p.images.length;
    }

    /** Mirror the lower cap of the current picture into the reflection canvas. */
    paintReflection(p, source, sx, sy, size) {
        const canvas = p.reflect;
        if (!canvas || !source) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        const capRows = Math.round(size * PLANET_SWITCHER_REFLECT);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.setTransform(1, 0, 0, -1, 0, h);
        ctx.drawImage(source, sx, sy + size - capRows, size, capRows, 0, 0, w, h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /** Copy one frame of the decoded strip into a slot (GPU copy; the strip was decoded by the image loader). */
    paintSheetSlot(p, slot, index) {
        const img = p.sheetImg;
        if (!img) return;
        const tile = p.sheet.tile;
        if (slot.width !== tile || slot.height !== tile) {
            slot.width = tile;
            slot.height = tile;
        }
        const ctx = slot.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, tile, tile);
        ctx.drawImage(img, index * tile, 0, tile, tile, 0, 0, tile, tile);
        slot.dataset.frame = String(index);
        this.paintReflection(p, img, index * tile, 0, tile);
    }

    mountSheet(p, gen) {
        const img = new Image();
        img.decoding = 'async';
        let settled = false;
        const fail = () => {
            if (settled || gen !== this.loadGen || !this.isActive()) return;
            settled = true;
            // Older server or missing strip: client-side tiles instead
            p.sheet = null;
            this.warmTiles([p], gen);
        };
        const ready = () => {
            if (settled || gen !== this.loadGen || !this.isActive()) return;
            settled = true;
            p.sheetImg = img;
            const framesInStrip = Math.max(1, Math.floor(img.naturalWidth / p.sheet.tile));
            p.sheet.count = Math.max(1, Math.min(p.sheet.count, framesInStrip));
            p.topShown = false;
            p.slideIndex = Math.floor(Math.random() * p.sheet.count);
            this.paintSheetSlot(p, p.slots[0], p.slideIndex);
            this.revealFirstSlide(p);
        };
        img.onload = () => {
            const decode = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
            decode.then(ready, () => (img.naturalWidth > 0 ? ready() : fail()));
        };
        img.onerror = fail;
        setTimeout(fail, 12000);
        img.src = p.sheet.url;
    }

    tileFor(p, url) {
        return planetSwitcherTileCache.get(planetSwitcherTileCache.key(url, p.color, this.tileSize));
    }

    /** Bake one tile now from a decoded source (consumed and released). Returns the tile or null. */
    bakeTile(p, url) {
        const key = planetSwitcherTileCache.key(url, p.color, this.tileSize);
        const existing = planetSwitcherTileCache.get(key);
        if (existing) return existing;
        const source = planetSwitcherImageCache.take(url, this.tileSize);
        if (!source) return null;
        const tile = planetSwitcherTileCache.bake(source, p.color, this.tileSize);
        planetSwitcherImageCache.release(source);
        planetSwitcherTileCache.set(key, tile);
        return tile;
    }

    /** Make sure a tile exists or is on its way (source load, then an idle bake). */
    ensureTile(p, url) {
        if (this.tileFor(p, url)) return;
        const gen = this.loadGen;
        planetSwitcherImageCache.load(url, this.tileSize).then((ok) => {
            if (gen !== this.loadGen || !this.isActive()) return;
            if (ok) this.queueBake(p, url);
            else this.dropImage(p, url);
        });
    }

    queueBake(p, url) {
        this.bakeQueue.push({ p, url });
        this.pumpBakes();
    }

    /** One tile per idle slice so baking never stalls a frame. */
    pumpBakes() {
        if (this.bakeTimer || !this.bakeQueue.length || !this.isActive()) return;
        const run = () => {
            this.bakeTimer = 0;
            let n = 0;
            while (this.bakeQueue.length && n < 1) {
                const job = this.bakeQueue.shift();
                if (!this.isActive()) return;
                if (job.p.images.some((image) => image.url === job.url)) {
                    this.bakeTile(job.p, job.url);
                    n++;
                }
            }
            if (this.bakeQueue.length) this.pumpBakes();
        };
        if (typeof requestIdleCallback === 'function') {
            this.bakeTimer = requestIdleCallback(run, { timeout: 400 });
        } else {
            this.bakeTimer = setTimeout(run, 24);
        }
    }

    normalizeSamples(raw) {
        if (!Array.isArray(raw)) return [];
        const out = [];
        raw.forEach((item) => {
            if (!item) return;
            if (item.url) {
                out.push({ url: item.url, blurhash: item.blurhash || null });
                return;
            }
            const preview = item.preview || (item.base ? `${item.base}.webp` : null);
            if (!preview) return;
            const base = String(preview).replace(/\.(jpg|jpeg|png|webp)$/i, '');
            out.push({ url: `/previews/${encodeURIComponent(`${base}.webp`)}`, blurhash: item.blurhash || null });
        });
        return out;
    }

    dropImage(p, url) {
        const idx = p.images.findIndex((image) => image.url === url);
        if (idx < 0) return;
        p.images.splice(idx, 1);
        if (p.slideIndex > idx) p.slideIndex -= 1;
        if (p.slideIndex >= p.images.length) p.slideIndex = 0;
    }

    createSlideSlot(container) {
        const canvas = document.createElement('canvas');
        canvas.className = 'planet-switcher-slide';
        canvas.width = this.tileSize;
        canvas.height = this.tileSize;
        canvas.setAttribute('aria-hidden', 'true');
        container.appendChild(canvas);
        return canvas;
    }

    paintSlot(slot, tile, p = null) {
        const ctx = slot.getContext('2d');
        if (!ctx) return;
        if (slot.width !== tile.width || slot.height !== tile.height) {
            slot.width = tile.width;
            slot.height = tile.height;
        }
        ctx.clearRect(0, 0, slot.width, slot.height);
        ctx.drawImage(tile, 0, 0);
        if (p) this.paintReflection(p, tile, 0, 0, tile.width);
    }

    async mountFirstSlide(p, gen) {
        // First picture: the first one that decodes; broken ones are dropped (by url: the list may shift meanwhile)
        while (p.images.length) {
            const url = p.images[0].url;
            const ok = this.tileFor(p, url) ? true : await planetSwitcherImageCache.load(url, this.tileSize);
            if (gen !== this.loadGen || !this.isActive()) return;
            if (ok) break;
            this.dropImage(p, url);
        }
        if (!p.images.length) return;
        const tile = this.bakeTile(p, p.images[0].url);
        if (!tile) return;
        p.topShown = false;
        p.slideIndex = 0;
        this.paintSlot(p.slots[0], tile, p);
        this.revealFirstSlide(p);
    }

    /**
     * Slots stay in DOM order (bottom, top) and never change z-index; a slot's content is only ever
     * changed while it is covered or hidden, and the fade starts one frame later on the top slot
     * alone. Both halves are cheap on their own; doing them in the same frame forced a compositing
     * update across the whole page.
     */
    fadeSlot(slot, to) {
        if (slot.planetFade) {
            try { slot.planetFade.cancel(); } catch (error) { /* already done */ }
        }
        slot.dataset.shown = to > 0 ? '1' : '0';
        slot.planetFade = slot.animate(
            [{ opacity: 1 - to }, { opacity: to }],
            { duration: PLANET_SWITCHER_SLIDE_FADE, easing: 'ease', fill: 'forwards' }
        );
    }

    revealFirstSlide(p) {
        requestAnimationFrame(() => {
            if (!this.isActive()) return;
            this.fadeSlot(p.slots[0], 1);
            if (p.reflect) p.reflect.classList.add('is-shown');
            p.shown = true;
        });
    }

    /**
     * Crossfade to the next slide. Top hidden: paint the top slot, fade it in over the bottom.
     * Top shown: paint the covered bottom slot, fade the top out to reveal it.
     */
    advanceSlide(p) {
        if (this.slideCount(p) < 2 || p.slots.length < 2) return false;
        let nextIndex = -1;
        let tile = null;
        if (p.sheet) {
            nextIndex = (p.slideIndex + 1) % p.sheet.count;
        } else {
            for (let step = 1; step < p.images.length; step++) {
                const candidate = (p.slideIndex + step) % p.images.length;
                const url = p.images[candidate].url;
                tile = this.tileFor(p, url);
                if (!tile) this.ensureTile(p, url);
                if (tile) {
                    nextIndex = candidate;
                    break;
                }
            }
            if (nextIndex < 0 || !tile) return false;
        }
        const bottom = p.slots[0];
        const top = p.slots[1];
        const target = p.topShown ? bottom : top;
        p.swapping = true;
        if (p.sheet) this.paintSheetSlot(p, target, nextIndex);
        else this.paintSlot(target, tile, p);
        const showTop = !p.topShown;
        requestAnimationFrame(() => {
            if (!this.isActive() || !p.slots.length) return;
            this.fadeSlot(top, showTop ? 1 : 0);
        });
        setTimeout(() => {
            p.topShown = showTop;
            p.slideIndex = nextIndex;
            p.swapping = false;
        }, PLANET_SWITCHER_SLIDE_FADE + 100);
        return true;
    }

    // ---------- input ----------

    handleKeyDown(e) {
        if (!this.isActive()) return;
        const key = e.key;
        if (/^F\d{1,2}$/.test(key)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.repeat && (key === 'Enter' || key === ' ' || key === 'Escape')) return;
        switch (key) {
            case 'Escape':
                this.cancel();
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                this.navigate(-1);
                break;
            case 'ArrowRight':
            case 'ArrowDown':
                this.navigate(1);
                break;
            case 'Tab':
                this.navigate(e.shiftKey ? -1 : 1);
                break;
            case 'Home':
                if (this.state === 'browsing') this.goTo(0);
                break;
            case 'End':
                if (this.state === 'browsing') this.goTo(this.count - 1);
                break;
            case 'Enter':
            case ' ':
                this.select(this.index);
                break;
            default:
                break;
        }
    }

    handleKeyUp(e) {
        if (!this.isActive()) return;
        const key = e.key;
        if (key === 'Alt' || key === 'Control' || key === 'Shift' || key === 'Meta') return;
        e.stopImmediatePropagation();
    }

    handleWheel(e) {
        if (this.state !== 'browsing') {
            e.preventDefault();
            return;
        }
        // guardWheelTick: public/scripts/utils/wheelTickGate.js
        const allowed = typeof guardWheelTick === 'function'
            ? guardWheelTick(e, this.allowWheelTick)
            : (e.preventDefault(), this.allowWheelTick());
        if (!allowed) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (d) this.navigate(d > 0 ? 1 : -1);
    }

    handlePointerDown(e) {
        if (e.button !== 0 || this.state !== 'browsing') return;
        this.pointer = { id: e.pointerId, x: e.clientX, lastX: e.clientX, acc: 0, moved: false };
    }

    handlePointerMove(e) {
        const p = this.pointer;
        if (!p || p.id !== e.pointerId) return;
        if (!p.moved) {
            if (Math.abs(e.clientX - p.x) <= 14) return;
            p.moved = true;
            try { this.root.setPointerCapture(e.pointerId); } catch (error) { /* capture is optional */ }
        }
        p.acc += e.clientX - p.lastX;
        p.lastX = e.clientX;
        if (Math.abs(p.acc) >= 110) {
            this.navigate(p.acc > 0 ? -1 : 1);
            p.acc = 0;
        }
    }

    handlePointerUp(e) {
        const p = this.pointer;
        if (!p || p.id !== e.pointerId) return;
        if (p.moved) this.suppressClickUntil = performance.now() + 350;
        try { this.root.releasePointerCapture(e.pointerId); } catch (error) { /* not captured */ }
        this.pointer = null;
    }

    // ---------- select / load / zoom / reveal ----------

    async select(index) {
        if (this.state !== 'browsing') return;
        const planet = this.planets[index];
        if (!planet) return;
        if (planet.id === this.currentWorkspaceId()) {
            this.cancel();
            return;
        }

        this.state = 'selecting';
        this.index = index;
        this.loadStarted = false;
        this.root.classList.add('is-selecting');
        planet.el.classList.add('is-selected');
        this.nudgeBgm();
        // desktopSounds.play: public/scripts/comp/desktopSounds.js
        desktopSounds.play('planet-activate');
        planet.status.textContent = 'Preparing...';
        if (this.stars) this.stars.warp(true);
        this.stopWobble(700);
        if (this.sun) {
            this.sunAnim = this.sun.animate(
                [{ scale: '1', opacity: 1 }, { scale: '1.5', opacity: 0 }],
                { duration: PLANET_SWITCHER_TIMING.select, easing: 'ease-in-out', fill: 'forwards' }
            );
        }

        // Glide the ring's sway back to centre (WAAPI beats the CSS keyframe animation on transform)
        const swayTransform = getComputedStyle(this.ring).transform;
        this.ringSwayAnim = this.ring.animate(
            [{ transform: swayTransform === 'none' ? 'translate3d(0, 0, 0)' : swayTransform }, { transform: 'translate3d(0, 0, 0)' }],
            { duration: PLANET_SWITCHER_TIMING.select, easing: 'ease-in-out', fill: 'forwards' }
        );

        // 1. Let the ring settle completely before any DOM-heavy work starts, so the tween stays smooth
        await new Promise((resolve) => {
            this.selectResolve = resolve;
            this.goTo(index, { selectU: 1, duration: PLANET_SWITCHER_TIMING.select, onDone: resolve });
        });
        this.selectResolve = null;
        if (this.state !== 'selecting') return;
        await new Promise((resolve) => setTimeout(resolve, PLANET_SWITCHER_TIMING.settle));
        if (this.state !== 'selecting') return;

        // 2. Real switch: bubble pulses while the workspace loads
        this.loadStarted = true;
        this.loadStartedAt = performance.now();
        this.root.classList.add('is-loading-workspace');
        planet.el.classList.add('is-loading');
        planet.status.textContent = 'Loading...';

        let failed = null;
        try {
            await this.loadWorkspace(planet.id);
        } catch (error) {
            failed = error;
        }
        if (this.state !== 'selecting') return;

        if (failed) {
            this.toast('error', 'Planets', `Could not switch workspace: ${failed.message || failed}`);
            this.abortSelection(planet);
            return;
        }

        planet.status.textContent = '';
        this.setProgressBar(planet, 1, true);
        await this.zoomIntoBubble(planet);
        if (this.state !== 'zooming') return;
        await this.revealDesktop();
    }

    loadWorkspace(workspaceId) {
        return new Promise((resolve, reject) => {
            let complete = false;
            let changed = false;
            let settled = false;
            let idleTimer = 0;
            let graceTimer = 0;

            const cleanup = () => {
                clearTimeout(idleTimer);
                clearTimeout(graceTimer);
                this.loadKick = null;
                document.removeEventListener('workspaceSwitchComplete', onComplete);
                document.removeEventListener('workspaceChanged', onChanged);
                document.removeEventListener('workspaceSwitchFailed', onFailed);
            };
            const finish = () => {
                if (settled || !complete) return;
                if (!changed) {
                    // The theme/shortcut pass normally lands first; give it a short grace if it is late
                    if (!graceTimer) graceTimer = setTimeout(() => { changed = true; finish(); }, 2500);
                    return;
                }
                settled = true;
                cleanup();
                resolve();
            };
            const fail = (message) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error(message));
            };
            const armIdle = () => {
                clearTimeout(idleTimer);
                idleTimer = setTimeout(() => fail('Timed out while loading the workspace'), PLANET_SWITCHER_LOAD_IDLE_MS);
            };
            const onComplete = (e) => {
                if (e.detail && e.detail.workspaceId === workspaceId) {
                    complete = true;
                    finish();
                }
            };
            const onChanged = (e) => {
                if (e.detail && e.detail.workspaceId === workspaceId) {
                    changed = true;
                    finish();
                }
            };
            const onFailed = (e) => {
                if (e.detail && e.detail.workspaceId === workspaceId) {
                    fail(e.detail.error || 'Workspace switch failed');
                }
            };

            document.addEventListener('workspaceSwitchComplete', onComplete);
            document.addEventListener('workspaceChanged', onChanged);
            document.addEventListener('workspaceSwitchFailed', onFailed);
            this.loadKick = armIdle;
            armIdle();

            if (typeof setActiveWorkspace !== 'function') {
                fail('Workspace switching is not available');
                return;
            }
            // Warm the wallpaper so the reveal paints it immediately
            const ws = (typeof workspaces !== 'undefined' && workspaces) ? workspaces[workspaceId] : null;
            if (ws && ws.wallpaper && typeof resolveWorkspaceWallpaperUrl === 'function' && typeof preloadWallpaperIntoMemory === 'function') {
                preloadWallpaperIntoMemory(resolveWorkspaceWallpaperUrl(ws.wallpaper));
            }
            // setActiveWorkspace: public/scripts/comp/workspaceUtils.js (dispatches the completion events)
            Promise.resolve()
                .then(() => setActiveWorkspace(workspaceId))
                .catch((error) => fail(error && error.message ? error.message : 'Workspace switch failed'));
        });
    }

    /** Called from updateWorkspaceProgress (workspaceUtils.js) while the switcher owns the loading UI. */
    updateProgress(progress) {
        if (this.state !== 'selecting') return;
        if (this.loadKick) this.loadKick();
        const planet = this.planets[this.index];
        if (!planet) return;
        let text = '';
        // formatWorkspaceProgressStatusText: public/scripts/comp/workspaceUtils.js
        if (typeof formatWorkspaceProgressStatusText === 'function') {
            try { text = formatWorkspaceProgressStatusText(progress) || ''; } catch (error) { text = ''; }
        }
        if (!text && progress && typeof progress.percent === 'number') text = `${Math.round(progress.percent)}%`;
        if (!text && progress && typeof progress.progress === 'number') text = `${Math.round(progress.progress * 100)}%`;
        planet.status.textContent = text || 'Loading...';

        let determinate = false;
        // shouldGalleryProgressUseDeterminate: public/scripts/comp/workspaceUtils.js
        if (typeof shouldGalleryProgressUseDeterminate === 'function') {
            try { determinate = shouldGalleryProgressUseDeterminate(progress); } catch (error) { determinate = false; }
        } else {
            determinate = Boolean(progress && typeof progress.progress === 'number');
        }
        let fraction = 0;
        if (progress && typeof progress.progress === 'number') fraction = progress.progress;
        else if (progress && typeof progress.percent === 'number') fraction = progress.percent / 100;
        this.setProgressBar(planet, fraction, determinate);
    }

    setProgressBar(planet, fraction, determinate) {
        const clamped = Math.max(0, Math.min(1, Number(fraction) || 0));
        planet.progress.classList.toggle('marquee', !determinate);
        planet.progressFill.style.width = determinate ? `${Math.round(clamped * 100)}%` : '';
        if (determinate) planet.progress.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
        else planet.progress.removeAttribute('aria-valuenow');
    }

    abortSelection(planet) {
        this.state = 'browsing';
        this.loadStarted = false;
        this.root.classList.remove('is-selecting', 'is-loading-workspace');
        planet.el.classList.remove('is-selected', 'is-loading');
        planet.status.textContent = '';
        this.setProgressBar(planet, 0, false);
        if (this.stars) this.stars.warp(false);
        if (this.ringSwayAnim) {
            this.ringSwayAnim.cancel();
            this.ringSwayAnim = null;
        }
        if (this.sunAnim) {
            this.sunAnim.cancel();
            this.sunAnim = null;
        }
        this.goTo(this.index, { selectU: 0, duration: 420 });
    }

    async zoomIntoBubble(planet) {
        this.bgmHold = true;
        this.fadeBgm(0, PLANET_SWITCHER_BGM.fadeTravel);
        const T = PLANET_SWITCHER_TIMING;
        this.state = 'zooming';
        this.loadStarted = false;
        this.root.classList.remove('is-selecting', 'is-loading-workspace');
        this.root.classList.add('is-zooming');
        const rect = planet.bubble.getBoundingClientRect();
        const diagonal = Math.hypot(window.innerWidth, window.innerHeight);
        const k = (diagonal / Math.max(1, rect.width)) * PLANET_SWITCHER_ZOOM_OVERSHOOT;
        const zoom = planet.bubble.animate(
            [{ transform: 'translateZ(0) scale(1)' }, { transform: `translateZ(0) scale(${k.toFixed(3)})` }],
            { duration: T.zoomIn, easing: 'cubic-bezier(0.65, 0, 0.85, 0.35)', fill: 'forwards' }
        );
        [planet.name, planet.count, planet.status, planet.progress].forEach((el) => {
            el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
        });
        const fade = this.fade.animate(
            [{ opacity: 0 }, { opacity: 0, offset: 0.42 }, { opacity: 1 }],
            { duration: T.zoomIn, easing: 'ease-in', fill: 'forwards' }
        );
        await Promise.all([zoom.finished, fade.finished]).catch(() => {});
    }

    async revealDesktop() {
        const T = PLANET_SWITCHER_TIMING;
        this.state = 'revealing';
        this.stopLoop();
        // desktopSounds.play: public/scripts/comp/desktopSounds.js
        desktopSounds.play('planet-switch');
        clearInterval(this.slideTimer);
        this.slideTimer = 0;
        this.removeInputListeners();

        // Screen is black: drop the ring + star field, lift the pause, then zoom the desktop back in.
        // Windows are re-collected: anything opened during the load joins the reveal.
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const known = new Set(this.windowLayer.map((rec) => rec.el));
        this.collectWindowElements().forEach((el) => {
            if (!known.has(el)) this.windowLayer.push(this.prepareLayerEl(el, cx, cy));
        });
        const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
        const inAnims = [];
        const desktopEls = new Set(this.desktopLayer.map((rec) => rec.el));
        [...this.desktopLayer, ...this.windowLayer].forEach(({ el, opacity }) => {
            if (el.classList.contains('hidden') || el.classList.contains('hidden-alt')) return;
            inAnims.push(el.animate([{ scale: '0.8' }, { scale: '1' }], { duration: T.reveal, easing: ease, fill: 'forwards' }));
            if (desktopEls.has(el)) {
                inAnims.push(el.animate(
                    [{ transform: `perspective(1400px) rotateX(${-PLANET_SWITCHER_TILT_DEG / 2}deg)` }, { transform: 'perspective(1400px) rotateX(0deg)' }],
                    { duration: T.reveal, easing: ease, fill: 'forwards' }
                ));
            }
            inAnims.push(el.animate([{ opacity: 0 }, { opacity }], { duration: T.reveal, easing: 'ease-out', fill: 'forwards' }));
        });
        this.cancelAnimations(this.layerAnims);
        this.cancelAnimations(this.overlayAnims);
        if (this.root) this.root.remove();
        if (this.backdrop) this.backdrop.remove();
        document.body.classList.remove('planet-switcher-active');

        await Promise.all(inAnims.map((a) => a.finished.catch(() => {})));
        this.cancelAnimations(inAnims);
        this.finish();
    }

    // ---------- cancel ----------

    cancel() {
        if (this.state === 'selecting' && !this.loadStarted) {
            // The real switch has not started yet: pull the selection back, then undo the opening
            const planet = this.planets[this.index];
            const release = this.selectResolve;
            this.selectResolve = null;
            this.tween = null;
            if (planet) this.abortSelection(planet);
            this.tween = null;
            this.selectU = 0;
            this.applyRing();
            if (release) release();
        }
        if (this.state !== 'browsing' && this.state !== 'opening') return;
        this.state = 'cancelling';
        this.fadeBgm(0, PLANET_SWITCHER_BGM.fadeOut);
        const T = PLANET_SWITCHER_TIMING;
        this.tween = null;
        this.removeInputListeners();
        clearInterval(this.slideTimer);
        this.slideTimer = 0;

        // Undo from wherever the opening animation got to: read the animated values, run them home fast
        const undo = [];
        const desktopEls = new Set(this.desktopLayer.map((rec) => rec.el));
        [...this.windowLayer, ...this.desktopLayer].forEach(({ el, opacity }) => {
            const cs = getComputedStyle(el);
            const curScale = cs.scale && cs.scale !== 'none' ? cs.scale : '1';
            const curOpacity = parseFloat(cs.opacity);
            undo.push(el.animate([{ scale: curScale }, { scale: '1' }], { duration: T.cancel, easing: 'ease-out', fill: 'forwards' }));
            if (desktopEls.has(el) && cs.transform && cs.transform !== 'none') {
                undo.push(el.animate([{ transform: cs.transform }, { transform: 'perspective(1400px) rotateX(0deg)' }], { duration: T.cancel, easing: 'ease-out', fill: 'forwards' }));
            }
            undo.push(el.animate(
                [{ opacity: Number.isFinite(curOpacity) ? curOpacity : 0 }, { opacity }],
                { duration: T.cancel, easing: 'ease-out', fill: 'forwards' }
            ));
        });
        this.cancelAnimations(this.layerAnims);
        this.layerAnims = undo;
        const out = [
            this.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-in', fill: 'forwards' }),
            this.holder.animate([{ scale: '1' }, { scale: '0.8' }], { duration: 360, easing: 'ease-in', fill: 'forwards' }),
            this.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 480, easing: 'ease-in', fill: 'forwards' })
        ];
        const pending = [...this.layerAnims, ...out].map((a) => a.finished.catch(() => {}));
        Promise.all(pending).then(() => {
            if (this.state !== 'cancelling') return;
            this.stopLoop();
            this.cancelAnimations(this.layerAnims);
            this.cancelAnimations(this.overlayAnims);
            this.cancelAnimations(out);
            if (this.root) this.root.remove();
            if (this.backdrop) this.backdrop.remove();
            document.body.classList.remove('planet-switcher-active');
            const prev = this.prevFocus;
            this.finish();
            if (prev && document.contains(prev) && typeof prev.focus === 'function') {
                try { prev.focus({ preventScroll: true }); } catch (error) { /* focus is best effort */ }
            }
        });
    }

    // ---------- teardown ----------

    removeInputListeners() {
        window.removeEventListener('keydown', this._onKeyDown, true);
        window.removeEventListener('keyup', this._onKeyUp, true);
        window.removeEventListener('resize', this._onResize);
    }

    cancelAnimations(list) {
        (list || []).forEach((anim) => {
            try { anim.cancel(); } catch (error) { /* already gone */ }
        });
    }

    finish() {
        this.stopLoop();
        clearInterval(this.slideTimer);
        this.slideTimer = 0;
        this.removeInputListeners();
        this.restoreLayerOrigins();
        if (this.ringSwayAnim) {
            this.cancelAnimations([this.ringSwayAnim]);
            this.ringSwayAnim = null;
        }
        this.sunAnim = null;
        this.bakeQueue = [];
        this.bakeTimer = 0;
        if (this.root && this.root.parentNode) this.root.remove();
        if (this.backdrop && this.backdrop.parentNode) this.backdrop.remove();
        document.body.classList.remove('planet-switcher-active', 'planet-switcher-flat');
        this.layerAnims = [];
        this.overlayAnims = [];
        this.desktopLayer = [];
        this.windowLayer = [];
        this.planets = [];
        this.count = 0;
        this.tween = null;
        this.selectU = 0;
        this.pointer = null;
        this.loadKick = null;
        this.loadStarted = false;
        this.prevFocus = null;
        this.stars = null;
        this.root = null;
        this.backdrop = null;
        this.holder = null;
        this.ring = null;
        this.sun = null;
        this.fade = null;
        this.cancelBtn = null;
        if (!this.bgmHold) this.stopBgm(true);
        this.loadGen++;
        this.state = 'idle';
    }

    // ---------- bgm (public/sounds/planet/innerlight.opus, gated by desktopSounds) ----------

    startBgm() {
        // desktopSounds.isEnabled: public/scripts/comp/desktopSounds.js
        if (!desktopSounds.isEnabled()) return;
        this.bgmHold = false;
        if (!this.bgm) {
            this.bgm = new Audio(PLANET_SWITCHER_BGM.url);
            this.bgm.loop = true;
            this.bgm.preload = 'auto';
        }
        this.bgm.volume = PLANET_SWITCHER_BGM.gain;
        this.bgm.currentTime = 0;
        this.bgm.play().catch(() => {});
    }

    nudgeBgm() {
        if (!this.bgm || this.bgmHold) return;
        this.fadeBgm(PLANET_SWITCHER_BGM.gainActive, PLANET_SWITCHER_BGM.fadeActivate);
    }

    fadeBgm(to, ms) {
        if (!this.bgm) return;
        const from = this.bgm.volume;
        this.bgmFade = {
            from,
            to,
            start: performance.now(),
            ms: Math.max(1, ms || PLANET_SWITCHER_BGM.fadeOut)
        };
        this.ensureBgmTicker();
        if (!this.raf) this.stepBgm(performance.now());
    }

    ensureBgmTicker() {
        if (this.bgmTicker) return;
        const tick = (now) => {
            this.stepBgm(now);
            if (this.bgmFade) this.bgmTicker = requestAnimationFrame(tick);
            else this.bgmTicker = 0;
        };
        this.bgmTicker = requestAnimationFrame(tick);
    }

    stepBgm(now) {
        if (!this.bgm || !this.bgmFade) return;
        const u = Math.min(1, (now - this.bgmFade.start) / this.bgmFade.ms);
        const vol = this.bgmFade.from + (this.bgmFade.to - this.bgmFade.from) * u;
        this.bgm.volume = Math.max(0, Math.min(1, vol));
        if (u < 1) return;
        this.bgmFade = null;
        if (this.bgm.volume <= 0.001) {
            this.bgm.pause();
            this.bgm.volume = 0;
            this.bgmHold = false;
        }
    }

    stopBgm(immediate) {
        this.bgmHold = false;
        this.bgmFade = null;
        if (this.bgmTicker) {
            cancelAnimationFrame(this.bgmTicker);
            this.bgmTicker = 0;
        }
        if (!this.bgm) return;
        if (immediate) {
            this.bgm.pause();
            this.bgm.volume = 0;
            return;
        }
        this.fadeBgm(0, PLANET_SWITCHER_BGM.fadeOut);
    }
}

var planetSwitcher = typeof window !== 'undefined' ? new PlanetSwitcher() : null;
if (planetSwitcher) {
    window.planetSwitcher = planetSwitcher;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PlanetRingMath, PLANET_SWITCHER_TIMING, PLANET_SWITCHER_BGM, planetSwitcherImageCache, planetSwitcherTileCache };
}
