/**
 * Windows Flip 3D (Vista's Win+Tab): the open windows and the desktop stacked in perspective,
 * drawn with WebGL. A lazy feature ("flip3d", featureLoader.js), opened by
 *
 *   flip3d.open('hold')     Win+Tab: keeps going while the Windows key is down, the key's
 *                           release switches (keyboardShortcuts.js windowSwitcherHoldKeyFor)
 *   flip3d.open('sticky')   Ctrl+Win+Tab and Quick Launch's "Switch between windows"
 *                           (taskbarSettings.js): stays until Enter, a click or Esc
 *   flip3d.prewarm()        copies the windows that changed ahead, when the pointer rests on
 *                           the Quick Launch button
 *
 * In it: Tab / Right / Down / wheel down step forward, Shift+Tab / Left / Up / wheel up back,
 * Enter / Space or a click on a window switch to it, Esc (or a click on empty space) goes back
 * to the window that was in front. open() returns false when WebGL is not there, and the
 * callers fall back to the window switcher (keyboardShortcuts.js startWindowSwitcher).
 *
 * Measured on the Vista VM (2026-10-22, the stack fitted to a 1920x1200 capture):
 * - the stack: a camera at the screen centre, f = 1305 px (1200 px high screen); every window
 *   keeps its own pixel size, its bottom-left corner on a line from (16, 697, 2121) stepping
 *   (-350, -161, 315) per slot, turned 20.3 deg about Y (right edge away) and 5.9 deg about X
 *   (top towards you). The camera numbers scale with the screen height.
 * - everything behind the stack (wallpaper, gadgets, the taskbar) is dimmed to half, a linear
 *   fade over ~250 ms; the windows fly from where they are to the stack in the same time.
 * - a step: the front window slides out towards you and fades while it fades in at the back,
 *   the others move up a slot, ~250 ms. The desktop is a card of its own, last in the stack.
 *
 * Each window is a texture made by windowCapture.js (its DOM copied into an SVG picture, kept
 * while the window does not change). A window that changed since its last picture flies with
 * that one and is copied again once the stack stands still; one never copied yet gets up to
 * ~150 ms before the stack shows. Rendering runs only while something moves.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    // the window pictures: windowCapture.js (this feature depends on window_capture)
    const cap = root.windowCapture;

    // ---- the stack (VM fit, 1920x1200) ---------------------------------------------------------

    const VM_H = 1200;
    const STACK = Object.freeze({
        f: 1305.19,
        c0: [15.70, 696.85, 2121.31],
        d: [-349.69, -161.35, 314.97],
        theta: 0.3547,
        phi: 0.1025
    });
    const ANIM_MS = 250;
    const DIM = 0.5;
    const MAX_SLOTS = 16;

    /** The camera for a viewport: focal length and principal point, in CSS px. */
    function camera(vw, vh) {
        const k = vh / VM_H;
        return { f: STACK.f * k, cx: vw / 2, cy: vh / 2, k };
    }

    /** Slot s's pose (s may be fractional; -1 is out in front, the line goes on behind). */
    function slotPose(cam, s) {
        const k = cam.k;
        return {
            x: (STACK.c0[0] + s * STACK.d[0]) * k,
            y: (STACK.c0[1] + s * STACK.d[1]) * k,
            z: (STACK.c0[2] + s * STACK.d[2]) * k,
            theta: STACK.theta,
            phi: STACK.phi
        };
    }

    /** A window where it is on screen: its bottom-left corner at depth f, flat. */
    function flatPose(cam, rect) {
        return { x: rect.left - cam.cx, y: rect.top + rect.height - cam.cy, z: cam.f, theta: 0, phi: 0 };
    }

    function lerpPose(a, b, t) {
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
            theta: a.theta + (b.theta - a.theta) * t,
            phi: a.phi + (b.phi - a.phi) * t
        };
    }

    /** A card's four corners in camera space (TL, TR, BL, BR), w x h px, anchored bottom-left;
     *  `pad` px more all round (the texture's transparent rim). */
    function corners(pose, w, h, pad = 0) {
        const ct = Math.cos(pose.theta), st = Math.sin(pose.theta);
        const cp = Math.cos(pose.phi), sp = Math.sin(pose.phi);
        const out = [];
        [[-pad, -h - pad], [w + pad, -h - pad], [-pad, pad], [w + pad, pad]].forEach(([lx, ly]) => {
            const x = lx * ct, z0 = lx * st;
            const y = ly * cp - z0 * sp;
            const z = ly * sp + z0 * cp;
            out.push([pose.x + x, pose.y + y, pose.z + z]);
        });
        return out;
    }

    function project(cam, p) {
        return [cam.cx + cam.f * p[0] / p[2], cam.cy + cam.f * p[1] / p[2]];
    }

    /** Where card i draws at rotation r (cards: n): one or two [slot, alpha] (a card wrapping
     *  from the front to the back shows leaving in front and arriving behind at once). */
    function cardSlots(i, r, n) {
        if (n <= 1) return [[0, 1]];
        let s = (i - r) % n;
        if (s < 0) s += n;
        if (s === 0) s = 0; // not -0
        if (s <= n - 1) return [[s, 1]];
        const front = s - n; // in (-1, 0)
        return [[front, 1 + front], [s, n - s]].filter((x) => x[1] > 0.001);
    }

    const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    // ---- the window list -----------------------------------------------------------------------

    /** The windows front to back: the active one, then by last use (keyboardShortcuts.js order). */
    function windowOrder() {
        if (!doc) return [];
        const all = Array.from(doc.querySelectorAll('.modal:not(.hidden)')).filter(cap.isWindow);
        let used = [];
        // getWindowUsageStack: public/scripts/comp/modalUtils.js (most recent first)
        if (typeof root.getWindowUsageStack === 'function') used = (root.getWindowUsageStack() || []).filter((m) => all.includes(m));
        const seen = new Set(used);
        const order = used.concat(all.filter((m) => !seen.has(m)));
        const active = doc.querySelector('.modal.active-window:not(.minimised)');
        const ai = order.indexOf(active);
        if (ai > 0) order.unshift(order.splice(ai, 1)[0]);
        return order;
    }

    // ---- WebGL ---------------------------------------------------------------------------------

    let gl = null;
    let glCanvas = null;
    let glProgram = null;
    let glBuffer = null;
    let glLoc = null;
    let glBroken = false;
    let anisotropy = null;

    const VS = `
attribute vec4 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() { vUv = aUv; gl_Position = aPos; }`;
    const FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
void main() { gl_FragColor = texture2D(uTex, vUv) * uAlpha; }`;

    function compile(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
    }

    function ensureGl() {
        if (gl) return !gl.isContextLost();
        if (glBroken || !doc) return false;
        glCanvas = doc.createElement('canvas');
        glCanvas.className = 'flip3d-canvas';
        const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
        try {
            gl = glCanvas.getContext('webgl2', opts) || glCanvas.getContext('webgl', opts);
        } catch (_) { gl = null; }
        if (!gl) {
            glBroken = true;
            return false;
        }
        try {
            glProgram = gl.createProgram();
            gl.attachShader(glProgram, compile(gl.VERTEX_SHADER, VS));
            gl.attachShader(glProgram, compile(gl.FRAGMENT_SHADER, FS));
            gl.linkProgram(glProgram);
            if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProgram));
        } catch (err) {
            console.warn('Flip 3D: WebGL program', err && err.message);
            gl = null;
            glBroken = true;
            return false;
        }
        glLoc = {
            pos: gl.getAttribLocation(glProgram, 'aPos'),
            uv: gl.getAttribLocation(glProgram, 'aUv'),
            tex: gl.getUniformLocation(glProgram, 'uTex'),
            alpha: gl.getUniformLocation(glProgram, 'uAlpha')
        };
        glBuffer = gl.createBuffer();
        anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
        glCanvas.addEventListener('webglcontextlost', (ev) => {
            ev.preventDefault();
            textures.clear();
            if (state) close(null, true);
        });
        glCanvas.addEventListener('webglcontextrestored', () => {
            gl = null;
            glCanvas.remove();
            glCanvas = null;
        });
        return true;
    }

    const textures = new Map(); // source canvas -> WebGLTexture

    function uploadTexture(source) {
        let tex = textures.get(source);
        if (tex) return tex;
        tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        const pot = (n) => (n & (n - 1)) === 0;
        const mips = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext || (pot(source.width) && pot(source.height));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (mips) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        textures.set(source, tex);
        return tex;
    }

    function dropTexture(source) {
        const tex = source && textures.get(source);
        if (!tex) return;
        if (gl) gl.deleteTexture(tex);
        textures.delete(source);
    }

    const verts = new Float32Array(4 * 6);

    function drawCard(cam, vw, vh, tex, pose, w, h, alpha, rim) {
        const c = corners(pose, w, h, rim || 0);
        const uv = [[0, 0], [1, 0], [0, 1], [1, 1]];
        for (let i = 0; i < 4; i++) {
            const [x, y, z] = c[i];
            if (z <= 1) return;
            // clip-space with w = z, so the texture is perspective-correct
            verts[i * 6] = ((cam.cx / vw) * 2 - 1) * z + (2 * cam.f / vw) * x;
            verts[i * 6 + 1] = -(((cam.cy / vh) * 2 - 1) * z + (2 * cam.f / vh) * y);
            verts[i * 6 + 2] = 0;
            verts[i * 6 + 3] = z;
            verts[i * 6 + 4] = uv[i][0];
            verts[i * 6 + 5] = uv[i][1];
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(glLoc.pos);
        gl.vertexAttribPointer(glLoc.pos, 4, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(glLoc.uv);
        gl.vertexAttribPointer(glLoc.uv, 2, gl.FLOAT, false, 24, 16);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(glLoc.tex, 0);
        gl.uniform1f(glLoc.alpha, alpha);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ---- the desktop card ----------------------------------------------------------------------

    let desktopTex = { key: '', canvas: null };

    /** The wallpaper as Vista's desktop card (the screen's shape, a quarter of its pixels). */
    function desktopSource(vw, vh) {
        const cs = root.getComputedStyle(doc.documentElement);
        const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(cs.getPropertyValue('--desktop-wallpaper') || '');
        const bg = root.getComputedStyle(doc.body).backgroundColor || '#3a6ea5';
        const key = `${m ? m[2] : ''}|${vw}x${vh}|${bg}`;
        if (desktopTex.key === key && desktopTex.canvas) return Promise.resolve(desktopTex.canvas);
        const c = cap.rimmedCanvas(vw, vh, 0.5);
        const g = c.getContext('2d');
        g.translate(cap.RIM, cap.RIM);
        const cw = c.width - 2 * cap.RIM;
        const chh = c.height - 2 * cap.RIM;
        g.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#3a6ea5';
        g.fillRect(0, 0, cw, chh);
        const done = () => {
            dropTexture(desktopTex.canvas);
            desktopTex = { key, canvas: c };
            return c;
        };
        if (!m) return Promise.resolve(done());
        return cap.loadImage(m[2]).then((img) => {
            const s = Math.max(cw / img.naturalWidth, chh / img.naturalHeight);
            const w = img.naturalWidth * s, h = img.naturalHeight * s;
            g.save();
            g.beginPath();
            g.rect(0, 0, cw, chh);
            g.clip();
            g.drawImage(img, (cw - w) / 2, (chh - h) / 2, w, h);
            g.restore();
            return done();
        }).catch(done);
    }

    // ---- the session ---------------------------------------------------------------------------

    let state = null;

    function isOpen() {
        return !!state;
    }

    /** Copies the windows that changed ahead (the pointer rests on Switch between windows). */
    function prewarm() {
        if (!doc || state) return;
        cap.prewarm(windowOrder(), () => !!state);
    }

    function viewport() {
        return { vw: root.innerWidth, vh: root.innerHeight };
    }

    function frame() {
        if (!state || !gl) return;
        const s = state;
        // nothing to show before the overlay is up (start())
        if (!s.started) {
            s.raf = 0;
            return;
        }
        const now = performance.now();
        const { vw, vh } = s;
        // rotation: eased from where it was to the target
        if (s.rot.to !== s.rot.from) {
            const t = Math.min(1, (now - s.rot.t0) / ANIM_MS);
            s.r = s.rot.from + (s.rot.to - s.rot.from) * ease(t);
            if (t >= 1) {
                s.r = s.rot.to;
                s.rot.from = s.rot.to;
            }
        }
        // open / close: u 0 = flat where the windows are, 1 = the stack
        // s.freeze (tests, screenshots): hold the open / close at that point
        const ut = s.freeze != null ? s.freeze : Math.max(0, Math.min(1, (now - s.phase.t0) / ANIM_MS));
        const u = s.phase.dir > 0 ? ease(ut) : 1 - ease(ut);
        s.u = u;
        if (s.dimEl) s.dimEl.style.opacity = String((s.phase.dir > 0 ? ut : 1 - ut));
        const cam = s.cam;
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(glProgram);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const n = s.cards.length;
        const draws = [];
        s.cards.forEach((card, i) => {
            cardSlots(i, s.r, n).forEach(([slot, a]) => {
                if (slot > MAX_SLOTS) return;
                draws.push({ card, slot, a });
            });
        });
        // back to front
        draws.sort((p, q) => q.slot - p.slot);
        draws.forEach(({ card, slot, a }) => {
            const stack = slotPose(cam, slot);
            let pose;
            let alpha;
            if (card.flat) {
                pose = lerpPose(card.flat, stack, u);
                alpha = 1 + (a - 1) * u;
            } else {
                pose = stack;
                alpha = a * u;
            }
            if (alpha <= 0.001) return;
            const src = card.source;
            if (!src) return;
            drawCard(cam, vw, vh, uploadTexture(src), pose, card.w, card.h, alpha, src.rim);
        });
        // the first frame uploads the textures (slow on a weak GPU, and the cost lands when it
        // is shown): the flight's clock starts at the frame after, so the open is never half
        // over before it is seen
        if (s.primeFrames > 0 && s.phase.dir > 0) {
            s.primeFrames -= 1;
            if (!s.primeFrames) s.phase.t0 = performance.now();
            s.raf = root.requestAnimationFrame(frame);
            return;
        }
        const moving = s.freeze == null && (s.rot.to !== s.rot.from || ut < 1);
        if (!moving && s.phase.dir < 0) {
            finish();
            return;
        }
        s.raf = moving ? root.requestAnimationFrame(frame) : 0;
    }

    function redraw() {
        if (state && !state.raf) state.raf = root.requestAnimationFrame(frame);
    }

    function setSource(card, source) {
        if (card.source && card.source !== source && card.ownsSource) dropTexture(card.source);
        card.source = source;
        card.ownsSource = true;
        redraw();
    }

    /**
     * Opens Flip 3D. mode 'hold' (Win+Tab: the Windows key's release switches) or 'sticky'.
     * Returns false when WebGL is not there (the caller falls back to the window switcher).
     */
    function open(mode, opts = {}) {
        if (state) return true;
        if (!doc || !ensureGl()) return false;
        cap.forgetClosed();
        const wins = windowOrder();
        const { vw, vh } = viewport();
        const cam = camera(vw, vh);
        // the backing store: the screen's density, at most ~2.25 x a 1920x1200 screen's pixels
        const dpr = Math.min(root.devicePixelRatio || 1, Math.sqrt((1920 * 1200 * 2.25) / (vw * vh)));
        glCanvas.width = Math.round(vw * dpr);
        glCanvas.height = Math.round(vh * dpr);
        const cards = wins.map((win) => {
            const rect = cap.windowRect(win);
            const minimised = win.classList.contains('minimised');
            const pic = cap.cached(win);
            const card = {
                win,
                w: Math.max(1, Math.round(rect.width)),
                h: Math.max(1, Math.round(rect.height)),
                flat: minimised ? null : flatPose(cam, rect),
                source: null,
                ownsSource: false
            };
            card.source = pic ? cap.composite(pic) : cap.placeholder(win, card.w, card.h);
            card.ownsSource = !(pic && card.source === pic.base);
            return card;
        });
        const desk = { win: null, w: vw, h: vh, flat: null, source: null, ownsSource: false, desktop: true };
        cards.push(desk);
        state = {
            mode: mode === 'hold' ? 'hold' : 'sticky',
            holdKey: opts.holdKey || 'Meta',
            cards,
            cam,
            vw,
            vh,
            r: 0,
            rot: { from: 0, to: 0, t0: 0 },
            u: 0,
            phase: { dir: 1, t0: performance.now() },
            raf: 0,
            dimEl: null,
            hidden: [],
            started: false
        };
        const s = state;
        // windows never copied yet: up to ~150 ms before the stack shows (Vista takes about
        // that long too); one that changed since its last copy flies as it was and is copied
        // again once the stack stands still
        cap.hold(wins);
        const missing = cards.filter((c) => c.win && !cap.cached(c.win));
        const t0 = performance.now();
        const first = async () => {
            for (const card of missing) {
                if (state !== s || performance.now() - t0 > 150) return;
                const pic = await cap.capture(card.win);
                if (state === s && pic) setSource(card, cap.composite(pic));
            }
        };
        const desktopReady = desktopSource(vw, vh).then((c) => {
            if (state !== s) return;
            desk.source = c;
            redraw();
        });
        const wallpaperWait = Promise.race([desktopReady, new Promise((r) => setTimeout(r, 300))]);
        Promise.all([missing.length ? first() : null, wallpaperWait]).then(() => {
            start(s);
            refresh(s);
        });
        listen(true);
        return true;
    }

    /** The overlay goes up and the windows fly. */
    function start(s) {
        if (state !== s || s.started) return;
        s.started = true;
        const host = doc.body;
        s.dimEl = doc.createElement('div');
        s.dimEl.className = 'flip3d-dim';
        s.dimEl.style.background = `rgba(0, 0, 0, ${DIM})`;
        s.dimEl.style.opacity = '0';
        host.appendChild(s.dimEl);
        host.appendChild(glCanvas);
        glCanvas.classList.add('is-open');
        s.cards.forEach((c) => {
            if (!c.win) return;
            if (c.win.style.visibility !== 'hidden') {
                c.win.classList.add('flip3d-hidden');
                s.hidden.push(c.win);
            }
        });
        // u = 0 until the first frame is drawn (frame() starts the clock then)
        s.phase = { dir: 1, t0: Infinity };
        s.primeFrames = 2;
        redraw();
    }

    function animating(s) {
        return s.rot.to !== s.rot.from || performance.now() - s.phase.t0 < ANIM_MS;
    }

    /** Resolves when nothing moves and the page has a moment (never copies mid-flight). */
    function still(s) {
        return new Promise((resolve) => {
            const check = () => {
                if (state !== s || s.phase.dir < 0) return resolve(false);
                if (!s.started || animating(s)) return setTimeout(check, 50);
                if (root.requestIdleCallback) root.requestIdleCallback(() => resolve(state === s && !animating(s)), { timeout: 200 });
                else setTimeout(() => resolve(state === s && !animating(s)), 16);
            };
            check();
        });
    }

    /** Copies the windows that changed (front first), between moves. */
    async function refresh(s) {
        for (const card of s.cards) {
            if (!card.win || cap.fresh(card.win)) continue;
            for (;;) {
                if (!(await still(s))) {
                    if (state !== s || s.phase.dir < 0) return;
                    continue;
                }
                break;
            }
            const pic = await cap.capture(card.win);
            if (state === s && pic) setSource(card, cap.composite(pic));
        }
    }

    function step(dir) {
        const s = state;
        if (!s || s.phase.dir < 0 || s.cards.length < 2) return;
        s.rot.from = s.r;
        s.rot.to += dir;
        s.rot.t0 = performance.now();
        redraw();
    }

    function frontIndex() {
        const s = state;
        const n = s.cards.length;
        return ((Math.round(s.rot.to) % n) + n) % n;
    }

    /** Puts the stack away: `pick` is the card switched to (null: back to the window in front). */
    function close(pick, instant) {
        const s = state;
        if (!s || s.phase.dir < 0) return;
        s.pick = pick === undefined ? null : pick;
        listen(false);
        if (instant || !s.started) {
            s.phase = { dir: -1, t0: -Infinity };
            finish();
            return;
        }
        // the closing flight starts from where the opening one is
        const done = s.u;
        s.phase = { dir: -1, t0: performance.now() - (1 - done) * ANIM_MS };
        redraw();
    }

    function finish() {
        const s = state;
        if (!s) return;
        state = null;
        if (s.raf) root.cancelAnimationFrame(s.raf);
        s.hidden.forEach((w) => w.classList.remove('flip3d-hidden'));
        if (s.dimEl) s.dimEl.remove();
        if (glCanvas) {
            glCanvas.classList.remove('is-open');
            glCanvas.remove();
        }
        s.cards.forEach((c) => { if (c.ownsSource) dropTexture(c.source); });
        cap.hold(s.cards.map((c) => c.win), false);
        // pictures kept for next time stay in GPU memory only while open
        textures.forEach((tex, src) => { if (src !== desktopTex.canvas) { gl.deleteTexture(tex); textures.delete(src); } });
        const card = s.pick != null ? s.cards[s.pick] : null;
        if (card) activate(card);
    }

    function activate(card) {
        if (card.desktop) {
            // Vista: picking the desktop shows it (every window minimised)
            const anyUp = anyWindowUp();
            if (anyUp && root.taskbarSettings) root.taskbarSettings.toggleShowDesktop();
            return;
        }
        const m = card.win;
        if (!m || !m.isConnected) return;
        // restoreMinimizedModal / getOrCreateTaskbarItem / openModal: public/scripts/comp/modalUtils.js
        if (m.classList.contains('minimised') && typeof root.restoreMinimizedModal === 'function') {
            root.restoreMinimizedModal(m, typeof root.getOrCreateTaskbarItem === 'function' ? root.getOrCreateTaskbarItem(m) : null);
        }
        if (typeof root.openModal === 'function') root.openModal(m);
    }

    function anyWindowUp() {
        return windowOrder().some((m) => !m.classList.contains('minimised'));
    }

    /** The card under a screen point, front first (null: none). */
    function cardAt(x, y) {
        const s = state;
        if (!s) return null;
        const n = s.cards.length;
        const hits = [];
        s.cards.forEach((card, i) => {
            cardSlots(i, s.r, n).forEach(([slot, a]) => {
                if (a < 0.5 || slot < 0) return;
                const c = corners(slotPose(s.cam, slot), card.w, card.h).map((p) => project(s.cam, p));
                // TL, TR, BR, BL
                if (insideQuad([c[0], c[1], c[3], c[2]], x, y)) hits.push({ i, slot });
            });
        });
        hits.sort((p, q) => p.slot - q.slot);
        return hits.length ? hits[0].i : null;
    }

    function insideQuad(q, x, y) {
        let sign = 0;
        for (let i = 0; i < 4; i++) {
            const [ax, ay] = q[i];
            const [bx, by] = q[(i + 1) % 4];
            const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
            if (cr === 0) continue;
            const sg = cr > 0 ? 1 : -1;
            if (!sign) sign = sg;
            else if (sg !== sign) return false;
        }
        return true;
    }

    // ---- input ---------------------------------------------------------------------------------

    function onKeyDown(ev) {
        const s = state;
        if (!s) return;
        const k = ev.key;
        // every key stays with Flip 3D: nothing types into the windows behind it
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (k === 'Tab') step(ev.shiftKey ? -1 : 1);
        else if (k === 'ArrowRight' || k === 'ArrowDown') step(1);
        else if (k === 'ArrowLeft' || k === 'ArrowUp') step(-1);
        else if ((k === 'Enter' || k === ' ') && !ev.repeat) close(frontIndex());
        else if (k === 'Escape') close(0);
    }

    function onKeyUp(ev) {
        const s = state;
        if (!s) return;
        if (s.mode === 'hold' && ev.key === s.holdKey) close(frontIndex());
        ev.preventDefault();
        ev.stopImmediatePropagation();
    }

    let wheelAcc = 0;

    function onWheel(ev) {
        if (!state) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        wheelAcc += ev.deltaY;
        const notch = ev.deltaMode === 1 ? 3 : 100;
        while (Math.abs(wheelAcc) >= notch) {
            step(wheelAcc > 0 ? 1 : -1);
            wheelAcc -= Math.sign(wheelAcc) * notch;
        }
    }

    function onPointerDown(ev) {
        if (!state) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (ev.button !== 0) return;
        const i = cardAt(ev.clientX, ev.clientY);
        close(i == null ? 0 : i);
    }

    function swallow(ev) {
        if (!state) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
    }

    function onBlur() {
        if (state) close(0, true);
    }

    function listen(on) {
        const fn = on ? 'addEventListener' : 'removeEventListener';
        root[fn]('keydown', onKeyDown, true);
        root[fn]('keyup', onKeyUp, true);
        root[fn]('wheel', onWheel, { capture: true, passive: false });
        root[fn]('pointerdown', onPointerDown, true);
        root[fn]('click', swallow, true);
        root[fn]('contextmenu', swallow, true);
        root[fn]('blur', onBlur);
        wheelAcc = 0;
    }

    const api = {
        open,
        isOpen,
        step,
        prewarm,
        select: () => { if (state) close(frontIndex()); },
        cancel: () => { if (state) close(0); },
        supported: () => ensureGl(),
        _test: { redraw, STACK, camera, slotPose, flatPose, corners, project, cardSlots, ease, insideQuad, windowOrder, state: () => state }
    };
    root.flip3d = api;
})(typeof window !== 'undefined' ? window : globalThis);
