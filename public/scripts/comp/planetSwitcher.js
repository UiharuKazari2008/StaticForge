// planetSwitcher.js
// Planet switcher: a ring of glass "planet" bubbles (one per workspace) over a star field.
//
// Opening shrinks and fades the desktop layers (#desktopWallpaper, #desktopIcons, #desktopTaskbar)
// and every open window with the Web Animations API. Only `scale` + `opacity` are animated, around
// a transform-origin computed at the viewport centre, so window sizes, positions and their own
// `transform` are never touched. Selecting a planet loads the workspace first (setActiveWorkspace +
// the workspaceSwitchComplete / workspaceChanged events from workspaceUtils.js), then zooms into the
// bubble, fades to black and zooms the desktop back in. Esc / Cancel reverses the opening animation.
//
// Lazy feature "planet_switcher" (featureLoader.js). Entry point: openPlanetSwitcher() in modalUtils.js.
// Monolith globals used: workspaces, activeWorkspace, setActiveWorkspace, wsClient, allImages,
// resolveWorkspaceWallpaperUrl, closeStartMenu, showGlassToast, createWheelTickGate, guardWheelTick,
// applyBlurhashPlaceholder, formatWorkspaceProgressStatusText, preloadWallpaperIntoMemory.

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
    zoomIn: 1500,        // zoom into the bubble + fade to black
    reveal: 1500         // desktop + windows 80% -> 100%, 0% -> 100%
});

const PLANET_SWITCHER_SAMPLE_LIMIT = 5;
const PLANET_SWITCHER_LOAD_IDLE_MS = 60000;

/** Pure ring geometry. Also exercised by scripts/test-planet-switcher-ring.js (node). */
const PlanetRingMath = {
    TAU: Math.PI * 2,
    MAX_STEP: Math.PI / 2.6,

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

    /** Screen placement of planet `index` for ring rotation `ringAngle`. depth 1 = front, -1 = back. */
    place(index, count, ringAngle, radiusX, radiusY) {
        const angle = ringAngle + index * this.step(count);
        const depth = Math.cos(angle);
        const t = (depth + 1) / 2;
        return {
            angle,
            depth,
            x: Math.sin(angle) * radiusX,
            y: -(1 - t) * radiusY,
            scale: 0.42 + 0.58 * t,
            opacity: 0.22 + 0.78 * t,
            z: Math.round(100 + depth * 100)
        };
    },

    easeInOut(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.width = w;
        this.height = h;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const wanted = Math.max(180, Math.min(640, Math.round((w * h) / 3200)));
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
        this.fade = null;
        this.cancelBtn = null;
        this.planets = [];
        this.count = 0;
        this.index = 0;
        this.ringAngle = 0;
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
        this.radiusY = 56;
        this.pointer = null;
        this.suppressClickUntil = 0;
        this.loadKick = null;
        this.prevFocus = null;
        this.allowWheelTick = typeof createWheelTickGate === 'function' ? createWheelTickGate(140) : () => true;
        this._onKeyDown = (e) => this.handleKeyDown(e);
        this._onKeyUp = (e) => this.handleKeyUp(e);
        this._onResize = () => this.handleResize();
        this._frame = (t) => this.frame(t);
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
        // closeStartMenu: public/scripts/comp/modalUtils.js
        if (typeof closeStartMenu === 'function') closeStartMenu({ immediate: true });
        if (typeof contextMenu !== 'undefined' && contextMenu && typeof contextMenu.hideMenu === 'function') {
            contextMenu.hideMenu();
        }
        this.prevFocus = document.activeElement;
        if (this.prevFocus && typeof this.prevFocus.blur === 'function') this.prevFocus.blur();

        document.body.classList.add('planet-switcher-active');
        this.buildDom(list);
        this.layoutRing();
        const currentId = this.currentWorkspaceId();
        this.index = Math.max(0, list.findIndex((ws) => ws.id === currentId));
        this.ringAngle = PlanetRingMath.angleFor(this.index, this.count);
        this.selectU = 0;
        this.applyRing();

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

        const holder = document.createElement('div');
        holder.className = 'planet-switcher-holder';
        const ring = document.createElement('div');
        ring.className = 'planet-switcher-ring';
        holder.appendChild(ring);
        root.appendChild(holder);

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
        hint.textContent = 'Arrow keys, wheel or drag to browse - Enter or click to travel - Esc to cancel';
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
        el.title = ws.name || ws.id;
        const color = typeof ws.color === 'string' && ws.color ? ws.color : '#6366f1';
        el.style.setProperty('--planet-color', color);
        if (ws.id === this.currentWorkspaceId()) el.classList.add('is-current');

        const bubble = document.createElement('div');
        bubble.className = 'planet-switcher-bubble';
        bubble.style.setProperty('--planet-color', color);
        const slides = document.createElement('div');
        slides.className = 'planet-switcher-slides';
        bubble.appendChild(slides);
        ['planet-switcher-tint', 'planet-switcher-veil', 'planet-switcher-gloss'].forEach((cls) => {
            const layer = document.createElement('div');
            layer.className = cls;
            bubble.appendChild(layer);
        });
        el.appendChild(bubble);

        const name = document.createElement('div');
        name.className = 'planet-switcher-name';
        name.textContent = ws.name || ws.id;
        el.appendChild(name);

        const status = document.createElement('div');
        status.className = 'planet-switcher-status';
        el.appendChild(status);

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (performance.now() < this.suppressClickUntil) return;
            this.select(index);
        });

        ring.appendChild(el);
        return {
            id: ws.id,
            ws,
            el,
            bubble,
            slides,
            name,
            status,
            images: [],
            imgs: [],
            front: 0,
            back: 1,
            slideIndex: 0,
            period: 3400 + index * 370,
            nextAt: 0
        };
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
        return Array.from(document.querySelectorAll('.modal, #galleryWindow')).filter((el) => {
            if (el === this.root || el.classList.contains('hidden') || el.classList.contains('hidden-alt')) return false;
            if (el.classList.contains('closing') || el.classList.contains('minimised')) return false;
            return getComputedStyle(el).display !== 'none';
        });
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

    layoutRing() {
        this.radiusX = Math.min(window.innerWidth * 0.36, 560);
        this.radiusY = Math.min(window.innerHeight * 0.07, 64);
    }

    applyRing() {
        const u = this.selectU;
        for (let i = 0; i < this.count; i++) {
            const p = this.planets[i];
            const pos = PlanetRingMath.place(i, this.count, this.ringAngle, this.radiusX, this.radiusY);
            let x = pos.x;
            let y = pos.y;
            let s = pos.scale;
            let o = pos.opacity;
            let z = pos.z;
            if (u > 0) {
                if (i === this.index) {
                    x *= 1 - u;
                    y *= 1 - u;
                    s *= 1 + 0.55 * u;
                    o = 1;
                    z = 400;
                } else {
                    x *= 1 + 0.9 * u;
                    y -= 40 * u;
                    s *= 1 - 0.35 * u;
                    o *= 1 - u;
                }
            }
            p.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
            p.el.style.opacity = o.toFixed(3);
            p.el.style.zIndex = String(z);
            p.el.classList.toggle('is-focused', i === this.index);
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
        this.tween = {
            from: this.ringAngle,
            to,
            fromU: this.selectU,
            toU: options.selectU != null ? options.selectU : this.selectU,
            start: performance.now(),
            duration: options.duration || PLANET_SWITCHER_TIMING.navigate,
            onDone: options.onDone || null
        };
    }

    stepTween(now) {
        const tw = this.tween;
        const p = Math.min(1, (now - tw.start) / tw.duration);
        const e = PlanetRingMath.easeInOut(p);
        this.ringAngle = tw.from + (tw.to - tw.from) * e;
        this.selectU = tw.fromU + (tw.toU - tw.fromU) * e;
        this.applyRing();
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
        if (this.tween) this.stepTween(now);
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
            if (p.images.length < 2 || now < p.nextAt) continue;
            p.nextAt = now + p.period;
            this.advanceSlide(p);
        }
    }

    async loadSamples(list) {
        const gen = ++this.loadGen;
        const ids = list.map((ws) => ws.id);
        let samples = {};
        try {
            if (window.wsClient && wsClient.isConnected() && typeof wsClient.getWorkspacePreviewSamples === 'function') {
                const res = await Promise.race([
                    wsClient.getWorkspacePreviewSamples(ids, PLANET_SWITCHER_SAMPLE_LIMIT),
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
        this.planets.forEach((p, i) => {
            let images = this.normalizeSamples(samples[p.id]);
            if (!images.length && p.id === currentId && typeof allImages !== 'undefined' && Array.isArray(allImages)) {
                images = this.normalizeSamples(allImages.slice(0, PLANET_SWITCHER_SAMPLE_LIMIT));
            }
            if (!images.length) {
                // resolveWorkspaceWallpaperUrl: public/scripts/comp/modalUtils.js
                const url = typeof resolveWorkspaceWallpaperUrl === 'function' ? resolveWorkspaceWallpaperUrl(p.ws.wallpaper) : null;
                if (url) images = [{ url, blurhash: null }];
            }
            if (!images.length) return;
            p.images = images;
            p.nextAt = performance.now() + 1400 + i * 520;
            this.mountFirstSlide(p);
        });
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
        return out.slice(0, PLANET_SWITCHER_SAMPLE_LIMIT);
    }

    createSlideImg(p) {
        const img = document.createElement('img');
        img.className = 'planet-switcher-slide';
        img.alt = '';
        img.draggable = false;
        img.decoding = 'async';
        p.slides.appendChild(img);
        return img;
    }

    mountFirstSlide(p) {
        const first = p.images[0];
        // applyBlurhashPlaceholder: public/scripts/comp/blurhashUtil.js
        if (first.blurhash && typeof applyBlurhashPlaceholder === 'function') {
            applyBlurhashPlaceholder(p.bubble, first.blurhash, 24);
        }
        p.imgs = [this.createSlideImg(p), this.createSlideImg(p)];
        p.front = 0;
        p.back = 1;
        p.slideIndex = 0;
        const img = p.imgs[0];
        img.src = first.url;
        img.dataset.src = first.url;
        this.decodeSlide(img).then((ok) => {
            if (!this.isActive()) return;
            if (ok) {
                img.classList.add('is-visible');
                this.prefetchSlide(p);
            } else {
                this.dropImage(p, 0);
                if (p.images.length) this.mountFirstSlide(p);
            }
        });
    }

    decodeSlide(img) {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve(true);
        return img.decode().then(() => true, () => false);
    }

    prefetchSlide(p) {
        if (p.images.length < 2) return;
        const nextIndex = (p.slideIndex + 1) % p.images.length;
        const url = p.images[nextIndex].url;
        const back = p.imgs[p.back];
        if (back.dataset.src !== url) {
            back.src = url;
            back.dataset.src = url;
        }
    }

    advanceSlide(p) {
        if (p.images.length < 2 || p.imgs.length < 2) return;
        const nextIndex = (p.slideIndex + 1) % p.images.length;
        const url = p.images[nextIndex].url;
        const incoming = p.imgs[p.back];
        if (incoming.dataset.src !== url) {
            incoming.src = url;
            incoming.dataset.src = url;
        }
        this.decodeSlide(incoming).then((ok) => {
            if (!this.isActive() || incoming.dataset.src !== url) return;
            if (!ok) {
                this.dropImage(p, nextIndex);
                return;
            }
            incoming.classList.add('is-visible');
            p.imgs[p.front].classList.remove('is-visible');
            p.front = p.back;
            p.back = 1 - p.back;
            p.slideIndex = nextIndex;
            this.prefetchSlide(p);
        });
    }

    dropImage(p, index) {
        p.images.splice(index, 1);
        if (p.slideIndex >= p.images.length) p.slideIndex = 0;
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
        this.root.classList.add('is-selecting');
        planet.el.classList.add('is-selected');
        planet.status.textContent = 'Preparing...';
        if (this.stars) this.stars.warp(true);

        // Glide the ring's sway back to centre (WAAPI beats the CSS keyframe animation on transform)
        const swayTransform = getComputedStyle(this.ring).transform;
        this.ringSwayAnim = this.ring.animate(
            [{ transform: swayTransform === 'none' ? 'translate3d(0, 0, 0)' : swayTransform }, { transform: 'translate3d(0, 0, 0)' }],
            { duration: PLANET_SWITCHER_TIMING.select, easing: 'ease-in-out', fill: 'forwards' }
        );

        const moved = new Promise((resolve) => {
            this.goTo(index, { selectU: 1, duration: PLANET_SWITCHER_TIMING.select, onDone: resolve });
        });

        let failed = null;
        try {
            await Promise.all([moved, this.loadWorkspace(planet.id)]);
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
        planet.status.textContent = text || 'Loading...';
    }

    abortSelection(planet) {
        this.state = 'browsing';
        this.root.classList.remove('is-selecting');
        planet.el.classList.remove('is-selected');
        planet.status.textContent = '';
        if (this.stars) this.stars.warp(false);
        if (this.ringSwayAnim) {
            this.ringSwayAnim.cancel();
            this.ringSwayAnim = null;
        }
        this.goTo(this.index, { selectU: 0, duration: 420 });
    }

    async zoomIntoBubble(planet) {
        const T = PLANET_SWITCHER_TIMING;
        this.state = 'zooming';
        this.root.classList.remove('is-selecting');
        this.root.classList.add('is-zooming');
        const rect = planet.bubble.getBoundingClientRect();
        const diagonal = Math.hypot(window.innerWidth, window.innerHeight);
        const k = (diagonal / Math.max(1, rect.width)) * 1.04;
        const zoom = planet.bubble.animate(
            [{ transform: 'translateZ(0) scale(1)' }, { transform: `translateZ(0) scale(${k.toFixed(3)})` }],
            { duration: T.zoomIn, easing: 'cubic-bezier(0.65, 0, 0.85, 0.35)', fill: 'forwards' }
        );
        planet.name.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
        planet.status.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
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
        [...this.desktopLayer, ...this.windowLayer].forEach(({ el, opacity }) => {
            if (el.classList.contains('hidden') || el.classList.contains('hidden-alt')) return;
            inAnims.push(el.animate([{ scale: '0.8' }, { scale: '1' }], { duration: T.reveal, easing: ease, fill: 'forwards' }));
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
        if (this.state !== 'browsing' && this.state !== 'opening') return;
        this.state = 'cancelling';
        const T = PLANET_SWITCHER_TIMING;
        this.tween = null;
        this.removeInputListeners();
        clearInterval(this.slideTimer);
        this.slideTimer = 0;

        // Undo from wherever the opening animation got to: read the animated values, run them home fast
        const undo = [];
        [...this.windowLayer, ...this.desktopLayer].forEach(({ el, opacity }) => {
            const cs = getComputedStyle(el);
            const curScale = cs.scale && cs.scale !== 'none' ? cs.scale : '1';
            const curOpacity = parseFloat(cs.opacity);
            undo.push(el.animate([{ scale: curScale }, { scale: '1' }], { duration: T.cancel, easing: 'ease-out', fill: 'forwards' }));
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
        if (this.root && this.root.parentNode) this.root.remove();
        if (this.backdrop && this.backdrop.parentNode) this.backdrop.remove();
        document.body.classList.remove('planet-switcher-active');
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
        this.prevFocus = null;
        this.stars = null;
        this.root = null;
        this.backdrop = null;
        this.holder = null;
        this.ring = null;
        this.fade = null;
        this.cancelBtn = null;
        this.loadGen++;
        this.state = 'idle';
    }
}

var planetSwitcher = typeof window !== 'undefined' ? new PlanetSwitcher() : null;
if (planetSwitcher) {
    window.planetSwitcher = planetSwitcher;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PlanetRingMath, PLANET_SWITCHER_TIMING };
}
