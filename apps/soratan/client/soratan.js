/**
 * SoraTan: Nanami, the 2009 desktop toy (SoraTan.exe), on the web desktop (Yozora #633).
 *
 * Double-clicking SoraTan.exe in Explorer (loose, or inside SoraTan.iso in Downloads) starts her:
 * explorerApplet.js / explorerArchive.js ask vfsPrograms.js, which lands here.
 *
 * The art and motion are the toy's own, decoded from nanami.sora by scripts/import-soratan.js into
 * /static_images/soratan/nanami-scene.json: meshes over one 512 x 512 texture (口 the mouth, 本体 the
 * body; the nanami mesh never shows), baked vertex frames, and the clips Startup, Anime1, Anime2,
 * DragL, DragR plus the mouth shapes. Format notes: docs/soratan.md.
 *
 * Behaviour as SoraTan.exe does it on the Vista VM:
 *   - a square, transparent, topmost window (500 x 500 by default; Size: 300 / 500 / 700 / 900),
 *     centred along the bottom of the screen with the taskbar over her feet; no taskbar button,
 *     a tray icon (the 16 px clover)
 *   - showing her fades her in while Startup plays, then Anime1 / Anime2 loop, picked at random
 *   - she is dragged sideways only; while she moves she leans (DragL / DragR: their node pose,
 *     eased in over 640 ms; back upright over 5760 ms), and she stands on the taskbar after
 *   - right-click on her or the tray icon: Size, Hide, Auto Hide, Exit (MENU 131); a click on the
 *     tray icon shows her again
 *   - Auto Hide fades her out 2.56 s after she last spoke. The voice (nanami.ogg) is not in this
 *     copy, so with Auto Hide on (the exe's default) the real toy never appears; here it starts off.
 * She is drawn with WebGL; clicks only land on her pixels (alpha hit test), everything else passes
 * through to the desktop and windows.
 *
 * Depends on: contextMenu.js, trayIndicators.js (revealTrayIconElement)
 */

const SORATAN_BASE = '/static_images/soratan/';
const SORATAN_STATE_KEY = 'soratan-state';
const SORATAN_SIZES = [300, 500, 700, 900];
const SORATAN_DEFAULT_SIZE = 500;
// the scene's view: x -256..256, y -512..0 (y up; she stands on the window's bottom edge)
const SORATAN_VIEW = { left: -256, right: 256, bottom: -512, top: 0 };
// mesh position = node + scale * (vertex + mesh offset) + this (fitted on the VM, see the importer)
const SORATAN_SCENE_SHIFT = [0, -256];
// back to front: the body, then the mouth
const SORATAN_DRAW_ORDER = [2, 1];
const SORATAN_IDLE_CLIPS = ['Anime1', 'Anime2'];
const SORATAN_DRAG_IN_MS = 640;
const SORATAN_DRAG_OUT_MS = 5760;
// the exe switches lean when the window moved more than 5 px in one 20 ms tick
const SORATAN_DRAG_STEP_PX = 5;
const SORATAN_DRAG_TICK_MS = 20;
// lifted while carried: her window bottom 8 px under the taskbar's top edge
const SORATAN_DRAG_SINK_PX = 8;
const SORATAN_FADE_MS = 600;
const SORATAN_AUTO_HIDE_MS = 2560;
const SORATAN_HIT_ALPHA = 24;

const soraTan = {
    scene: null,
    clips: null,
    texImage: null,
    texAlpha: null,
    root: null,
    canvas: null,
    gl: null,
    buffers: null,
    running: false,
    hidden: false,
    autoHide: false,
    autoHideTimer: 0,
    size: SORATAN_DEFAULT_SIZE,
    pos: null,
    clip: null,
    clipStart: 0,
    queue: null,
    lean: null,
    raf: 0,
    drag: null,
    pose: null,
    geometry: null,
    trayIcon: null
};

function soraTanLoadState() {
    try {
        const s = JSON.parse(localStorage.getItem(SORATAN_STATE_KEY) || '{}');
        if (SORATAN_SIZES.includes(s.size)) soraTan.size = s.size;
        if (s.pos && Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y)) soraTan.pos = s.pos;
        soraTan.autoHide = !!s.autoHide;
    } catch (_) { /* private mode or bad JSON: defaults */ }
}

function soraTanSaveState() {
    try {
        localStorage.setItem(SORATAN_STATE_KEY, JSON.stringify({ size: soraTan.size, pos: soraTan.pos, autoHide: soraTan.autoHide }));
    } catch (_) { /* private mode */ }
}

async function soraTanLoadAssets() {
    if (soraTan.scene) return;
    const [scene, img] = await Promise.all([
        fetch(SORATAN_BASE + 'nanami-scene.json').then((r) => {
            if (!r.ok) throw new Error(`nanami-scene.json: ${r.status}`);
            return r.json();
        }),
        new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('nanami.png did not load'));
            im.src = SORATAN_BASE + 'nanami.png';
        })
    ]);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    soraTan.texAlpha = { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
    soraTan.scene = scene;
    soraTan.texImage = img;
    soraTan.clips = Object.fromEntries(scene.clips.map((cl) => [cl.name, cl]));
}

// ---- WebGL --------------------------------------------------------------------------------------

const SORATAN_VS = `attribute vec2 aPos; attribute vec2 aUv; uniform vec4 uView; varying vec2 vUv;
void main() { vUv = aUv; gl_Position = vec4((aPos.x - uView.x) / uView.z * 2.0 - 1.0, (aPos.y - uView.y) / uView.w * 2.0 - 1.0, 0.0, 1.0); }`;
const SORATAN_FS = `precision mediump float; uniform sampler2D uTex; varying vec2 vUv;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;

function soraTanInitGl(canvas) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) return false;
    const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, SORATAN_VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, SORATAN_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, soraTan.texImage);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const v = SORATAN_VIEW;
    gl.uniform4f(gl.getUniformLocation(prog, 'uView'), v.left, v.bottom, v.right - v.left, v.top - v.bottom);
    soraTan.gl = gl;
    soraTan.buffers = { pos: gl.createBuffer(), uv: gl.createBuffer(), aPos: gl.getAttribLocation(prog, 'aPos'), aUv: gl.getAttribLocation(prog, 'aUv') };
    return true;
}

// ---- clips --------------------------------------------------------------------------------------

/** The two keys around t (ms) and the blend between them; past the last key holds it. */
function soraTanKeyAt(track, t) {
    const keys = track.keys;
    if (t <= keys[0][0] || keys.length === 1) return { a: keys[0][1], b: keys[0][1], f: 0 };
    for (let i = 1; i < keys.length; i++) {
        if (t < keys[i][0]) {
            const f = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
            return { a: keys[i - 1][1], b: keys[i][1], f };
        }
    }
    const last = keys[keys.length - 1][1];
    return { a: last, b: last, f: 0 };
}

function soraTanVec(track, t, fallback) {
    if (!track) return fallback;
    const k = soraTanKeyAt(track, t);
    return k.a.map((v, i) => v + (k.b[i] - v) * k.f);
}

/** The node pose of a clip at t: position, angle about z (rotation is wxyz), scale. */
function soraTanNode(clip, t, rest) {
    const q = clip.node.rotation ? soraTanVec(clip.node.rotation, t, null) : null;
    return {
        position: soraTanVec(clip.node.position, t, rest.position),
        angle: q ? 2 * Math.atan2(q[3], q[0]) : rest.angle,
        scale: soraTanVec(clip.node.scale, t, rest.scale)
    };
}

function soraTanRestNode() {
    const n = soraTan.scene.node;
    return { position: n.position, angle: 2 * Math.atan2(n.rotation[3], n.rotation[0]), scale: n.scale };
}

/** The pose at clip time t: the node (leaning toward a drag pose) and each mesh's frame and mouth shape. */
function soraTanPose(clip, t, now) {
    const prev = soraTan.pose;
    const rest = prev ? prev.node : soraTanRestNode();
    let node = soraTanNode(clip, t, rest);
    const lean = soraTan.lean;
    if (lean) {
        const target = lean.clip ? soraTanNode(lean.clip, 0, node) : node;
        const w = Math.min(1, (now - lean.start) / lean.ms);
        const from = lean.from;
        const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * w);
        node = {
            position: mix(from.position, target.position),
            angle: from.angle + (target.angle - from.angle) * w,
            scale: mix(from.scale, target.scale)
        };
        if (w >= 1 && !lean.clip) soraTan.lean = null;
    }
    const meshes = clip.meshes.map((m, i) => {
        const p = prev ? prev.meshes[i] : null;
        let frame = p ? p.frame : null;
        if (m.frame) {
            const k = soraTanKeyAt(m.frame, t);
            frame = m.frame.interp === 0x11 ? { a: k.a, b: k.b, f: k.f } : { a: k.a, b: k.a, f: 0 };
        }
        return { frame, shape: m.shape ? soraTanKeyAt(m.shape, t).a : (p ? p.shape : 0) };
    });
    return { node, meshes };
}

function soraTanPlay(name, then) {
    const clip = soraTan.clips[name];
    if (!clip) return;
    soraTan.clip = clip;
    soraTan.clipStart = performance.now();
    soraTan.queue = then || null;
}

function soraTanNextIdle() {
    soraTanPlay(SORATAN_IDLE_CLIPS[Math.random() < 0.5 ? 0 : 1], soraTanNextIdle);
}

/** Lean toward DragL / DragR (name) or back upright (null), from wherever the node is now. */
function soraTanLean(name) {
    const cur = soraTan.lean ? soraTan.lean.clip : null;
    if ((cur && cur.name) === (name || undefined) && soraTan.lean) return;
    if (!name && !soraTan.lean) return;
    soraTan.lean = {
        clip: name ? soraTan.clips[name] : null,
        from: soraTan.pose ? soraTan.pose.node : soraTanRestNode(),
        start: performance.now(),
        ms: name ? SORATAN_DRAG_IN_MS : SORATAN_DRAG_OUT_MS
    };
}

/** Mesh vertices in scene space for a pose: [x, y, ...] and [u, v, ...]. */
function soraTanMeshGeometry(mi, mp, node) {
    const mesh = soraTan.scene.meshes[mi];
    const fa = mesh.frames[mp.frame.a];
    const fb = mesh.frames[mp.frame.b];
    const uv = mesh.uvSets[fa.uv];
    const n = mesh.verts;
    const pos = new Float32Array(n * 2);
    const uvs = new Float32Array(n * 2);
    const cos = Math.cos(node.angle);
    const sin = Math.sin(node.angle);
    const off = mesh.offset || [0, 0];
    const shape = mesh.shapes ? mesh.shapes[mp.shape] : null;
    let cu = 0;
    let cv = 0;
    if (shape) {
        for (let i = 0; i < n; i++) { cu += uv[i * 2]; cv += uv[i * 2 + 1]; }
        cu /= n; cv /= n;
    }
    for (let i = 0; i < n; i++) {
        const vx = fa.pos[i * 2] + (fb.pos[i * 2] - fa.pos[i * 2]) * mp.frame.f;
        const vy = fa.pos[i * 2 + 1] + (fb.pos[i * 2 + 1] - fa.pos[i * 2 + 1]) * mp.frame.f;
        const x = (vx + off[0]) * node.scale[0] + SORATAN_SCENE_SHIFT[0];
        const y = (vy + off[1]) * node.scale[1] + SORATAN_SCENE_SHIFT[1];
        pos[i * 2] = x * cos - y * sin + node.position[0];
        pos[i * 2 + 1] = x * sin + y * cos + node.position[1];
        let u = uv[i * 2];
        let v = uv[i * 2 + 1];
        if (shape) {
            // the shape's UV offset, its scale about the mouth quad's centre
            u = cu + (u - cu) * shape.su + shape.du;
            v = cv + (v - cv) * shape.sv + shape.dv;
        }
        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
    }
    return { pos, uvs, faces: mesh.faces };
}

function soraTanDraw(pose) {
    const gl = soraTan.gl;
    const b = soraTan.buffers;
    gl.viewport(0, 0, soraTan.canvas.width, soraTan.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    soraTan.geometry = [];
    for (const mi of SORATAN_DRAW_ORDER) {
        const mp = pose.meshes[mi];
        if (!mp || !mp.frame || soraTan.scene.meshes[mi].hidden) continue;
        const g = soraTanMeshGeometry(mi, mp, pose.node);
        soraTan.geometry.push(g);
        const tri = [];
        for (const f of g.faces) tri.push(f[0], f[1], f[2], f[0], f[2], f[3]);
        const P = new Float32Array(tri.length * 2);
        const U = new Float32Array(tri.length * 2);
        tri.forEach((vi, k) => {
            P[k * 2] = g.pos[vi * 2]; P[k * 2 + 1] = g.pos[vi * 2 + 1];
            U[k * 2] = g.uvs[vi * 2]; U[k * 2 + 1] = g.uvs[vi * 2 + 1];
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, b.pos);
        gl.bufferData(gl.ARRAY_BUFFER, P, gl.STREAM_DRAW);
        gl.enableVertexAttribArray(b.aPos);
        gl.vertexAttribPointer(b.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.uv);
        gl.bufferData(gl.ARRAY_BUFFER, U, gl.STREAM_DRAW);
        gl.enableVertexAttribArray(b.aUv);
        gl.vertexAttribPointer(b.aUv, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, tri.length);
    }
}

function soraTanTick(now) {
    soraTan.raf = 0;
    if (!soraTan.running || soraTan.hidden) return;
    let t = now - soraTan.clipStart;
    if (t >= soraTan.clip.duration && soraTan.queue) {
        const next = soraTan.queue;
        soraTan.queue = null;
        next();
        t = now - soraTan.clipStart;
    }
    t = Math.min(t, soraTan.clip.duration);
    soraTan.pose = soraTanPose(soraTan.clip, t, now);
    soraTanDraw(soraTan.pose);
    soraTanSchedule();
}

function soraTanSchedule() {
    if (!soraTan.raf && soraTan.running && !soraTan.hidden) soraTan.raf = requestAnimationFrame(soraTanTick);
}

// ---- hit test: her pixels only ------------------------------------------------------------------

function soraTanHit(clientX, clientY) {
    if (!soraTan.running || soraTan.hidden || !soraTan.geometry || !soraTan.root) return false;
    const r = soraTan.root.getBoundingClientRect();
    if (clientX < r.left || clientX >= r.right || clientY < r.top || clientY >= r.bottom) return false;
    const v = SORATAN_VIEW;
    const sx = v.left + (clientX - r.left) / r.width * (v.right - v.left);
    const sy = v.top - (clientY - r.top) / r.height * (v.top - v.bottom);
    const A = soraTan.texAlpha;
    for (let gi = soraTan.geometry.length - 1; gi >= 0; gi--) {
        const g = soraTan.geometry[gi];
        for (const f of g.faces) {
            for (const tri of [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]) {
                const [i0, i1, i2] = tri;
                const ax = g.pos[i0 * 2], ay = g.pos[i0 * 2 + 1];
                const bx = g.pos[i1 * 2], by = g.pos[i1 * 2 + 1];
                const cx = g.pos[i2 * 2], cy = g.pos[i2 * 2 + 1];
                const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
                if (Math.abs(d) < 1e-9) continue;
                const l1 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / d;
                const l2 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / d;
                const l3 = 1 - l1 - l2;
                if (l1 < 0 || l2 < 0 || l3 < 0) continue;
                const u = l1 * g.uvs[i0 * 2] + l2 * g.uvs[i1 * 2] + l3 * g.uvs[i2 * 2];
                const w = l1 * g.uvs[i0 * 2 + 1] + l2 * g.uvs[i1 * 2 + 1] + l3 * g.uvs[i2 * 2 + 1];
                const px = Math.min(A.w - 1, Math.max(0, Math.floor(u * A.w)));
                const py = Math.min(A.h - 1, Math.max(0, Math.floor(w * A.h)));
                if (A.data[(py * A.w + px) * 4 + 3] >= SORATAN_HIT_ALPHA) return true;
            }
        }
    }
    return false;
}

function soraTanOnPointerMove(e) {
    if (soraTan.drag || !soraTan.root) return;
    soraTan.root.classList.toggle('is-hot', soraTanHit(e.clientX, e.clientY));
}

// ---- window -------------------------------------------------------------------------------------

function soraTanTaskbarTop() {
    const taskbar = document.getElementById('taskbar');
    const r = taskbar ? taskbar.getBoundingClientRect() : null;
    return r && r.height ? r.top : document.documentElement.clientHeight;
}

function soraTanPlace() {
    const el = soraTan.root;
    const s = soraTan.size;
    el.style.width = s + 'px';
    el.style.height = s + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    soraTan.canvas.width = Math.round(s * dpr);
    soraTan.canvas.height = Math.round(s * dpr);
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    // the exe starts centred, standing on the bottom of the screen (the taskbar over her)
    if (!soraTan.pos) soraTan.pos = { x: Math.round((vw - s) / 2), y: vh - s };
    soraTan.pos.x = Math.max(-s / 2, Math.min(vw - s / 2, soraTan.pos.x));
    soraTan.pos.y = Math.max(0, Math.min(vh - s, soraTan.pos.y));
    el.style.left = soraTan.pos.x + 'px';
    el.style.top = soraTan.pos.y + 'px';
}

function soraTanBuild() {
    const root = document.createElement('div');
    root.id = 'soraTanToy';
    root.className = 'soratan-toy hidden';
    const canvas = document.createElement('canvas');
    canvas.className = 'soratan-canvas';
    root.appendChild(canvas);
    const icons = document.getElementById('desktopIcons');
    if (icons && icons.parentNode) icons.parentNode.appendChild(root);
    else document.body.appendChild(root);
    soraTan.root = root;
    soraTan.canvas = canvas;
    if (!soraTanInitGl(canvas)) throw new Error('WebGL is not available');

    root.addEventListener('pointerdown', soraTanOnPointerDown);
    document.addEventListener('pointermove', soraTanOnPointerMove, { passive: true });
    window.addEventListener('resize', () => { if (soraTan.running) soraTanPlace(); });
    if (typeof contextMenu !== 'undefined' && contextMenu) contextMenu.attachToElement(root, soraTanMenuConfig());
}

function soraTanOnPointerDown(e) {
    if (e.button !== 0 || !soraTanHit(e.clientX, e.clientY)) return;
    e.preventDefault();
    soraTan.root.setPointerCapture(e.pointerId);
    const d = { id: e.pointerId, sx: e.clientX, ox: soraTan.pos.x, moving: false, lastX: soraTan.pos.x, lastTick: performance.now() };
    soraTan.drag = d;
    soraTan.root.classList.add('is-dragging');
    soraTanArmAutoHide();
    const move = (ev) => {
        if (ev.pointerId !== d.id) return;
        const dx = ev.clientX - d.sx;
        if (!d.moving && Math.abs(dx) < 3) return;
        if (!d.moving) {
            d.moving = true;
            // carried: lifted onto the taskbar, sideways only
            soraTan.pos.y = Math.max(0, soraTanTaskbarTop() - soraTan.size + SORATAN_DRAG_SINK_PX);
            soraTan.root.style.top = soraTan.pos.y + 'px';
        }
        soraTan.pos.x = d.ox + dx;
        soraTan.root.style.left = soraTan.pos.x + 'px';
        const now = performance.now();
        if (now - d.lastTick >= SORATAN_DRAG_TICK_MS) {
            const step = soraTan.pos.x - d.lastX;
            if (step < -SORATAN_DRAG_STEP_PX) soraTanLean('DragL');
            else if (step > SORATAN_DRAG_STEP_PX) soraTanLean('DragR');
            else soraTanLean(null);
            d.lastX = soraTan.pos.x;
            d.lastTick = now;
        }
    };
    const up = (ev) => {
        if (ev.pointerId !== d.id) return;
        soraTan.root.removeEventListener('pointermove', move);
        soraTan.root.removeEventListener('pointerup', up);
        soraTan.root.removeEventListener('pointercancel', up);
        soraTan.root.classList.remove('is-dragging');
        soraTan.drag = null;
        soraTanLean(null);
        if (d.moving) {
            soraTanPlace();
            soraTanSaveState();
        }
    };
    soraTan.root.addEventListener('pointermove', move);
    soraTan.root.addEventListener('pointerup', up);
    soraTan.root.addEventListener('pointercancel', up);
}

/** SoraTan.exe MENU 131, on her and on the tray icon alike. */
function soraTanMenuConfig() {
    const size = (s) => ({
        text: `${s} x ${s}`, action: 'soratan-size', value: s, showIndicator: true, indicatorMark: 'radio',
        loadfn: (item) => { item.checked = soraTan.size === s; }
    });
    return {
        openSubmenusOnHover: true,
        sections: [{
            type: 'list',
            items: [
                { text: 'Size', submenu: SORATAN_SIZES.map(size) },
                { separator: true },
                { text: 'Hide', action: 'soratan-hide' },
                {
                    text: 'Auto Hide', action: 'soratan-autohide', showIndicator: true, indicatorMark: 'check',
                    loadfn: (item) => { item.checked = soraTan.autoHide; }
                },
                { separator: true },
                { text: 'Exit', action: 'soratan-exit' }
            ]
        }],
        onAction: (action, target, item) => soraTanAction(action, item)
    };
}

function soraTanAction(action, item) {
    switch (action) {
        case 'soratan-size':
            if (item && SORATAN_SIZES.includes(item.value) && item.value !== soraTan.size) {
                // keep her feet where they are
                const bottom = soraTan.pos.y + soraTan.size;
                const centre = soraTan.pos.x + soraTan.size / 2;
                soraTan.size = item.value;
                soraTan.pos = { x: Math.round(centre - soraTan.size / 2), y: bottom - soraTan.size };
                soraTanPlace();
                soraTanSaveState();
            }
            break;
        case 'soratan-hide':
            soraTanSetHidden(true);
            break;
        case 'soratan-autohide':
            soraTan.autoHide = !soraTan.autoHide;
            soraTanArmAutoHide();
            soraTanSaveState();
            break;
        case 'soratan-exit':
            closeSoraTan();
            break;
        default:
            break;
    }
}

/** Auto Hide: she fades out a while after she last spoke; she has no voice here, so after she shows. */
function soraTanArmAutoHide() {
    clearTimeout(soraTan.autoHideTimer);
    soraTan.autoHideTimer = 0;
    if (!soraTan.autoHide || soraTan.hidden || !soraTan.running) return;
    soraTan.autoHideTimer = setTimeout(() => {
        soraTan.autoHideTimer = 0;
        if (soraTan.drag) soraTanArmAutoHide();
        else soraTanSetHidden(true);
    }, SORATAN_FADE_MS + SORATAN_AUTO_HIDE_MS);
}

/** Show (fade in while Startup plays) or hide (fade out). */
function soraTanSetHidden(hidden) {
    const el = soraTan.root;
    if (!el) return;
    clearTimeout(soraTan.fadeTimer);
    if (hidden) {
        if (soraTan.hidden) return;
        soraTan.hidden = true;
        el.classList.remove('is-shown', 'is-hot');
        soraTan.fadeTimer = setTimeout(() => {
            if (soraTan.hidden) el.classList.add('hidden');
        }, SORATAN_FADE_MS);
        soraTanArmAutoHide();
        return;
    }
    const wasHidden = soraTan.hidden || el.classList.contains('hidden');
    soraTan.hidden = false;
    el.classList.remove('hidden');
    if (wasHidden) {
        soraTan.pose = null;
        soraTan.lean = null;
        soraTanPlay('Startup', soraTanNextIdle);
        void el.offsetWidth;
    }
    el.classList.add('is-shown');
    soraTanArmAutoHide();
    soraTanSchedule();
}

function soraTanSyncTray() {
    const icon = document.getElementById('soraTanTrayIcon');
    if (!icon) return;
    if (!soraTan.trayIcon) {
        soraTan.trayIcon = icon;
        icon.addEventListener('click', () => soraTanSetHidden(false));
        if (typeof contextMenu !== 'undefined' && contextMenu) contextMenu.attachToElement(icon, soraTanMenuConfig());
    }
    if (soraTan.running) {
        // revealTrayIconElement: public/scripts/comp/trayIndicators.js
        if (icon.classList.contains('hidden') && typeof revealTrayIconElement === 'function') revealTrayIconElement(icon);
        else icon.classList.remove('hidden');
    } else {
        icon.classList.add('hidden');
    }
}

/** Start her (or show her again if she is hidden). */
async function openSoraTan() {
    if (soraTan.running) {
        soraTanSetHidden(false);
        return;
    }
    soraTanLoadState();
    await soraTanLoadAssets();
    if (!soraTan.root) soraTanBuild();
    soraTan.running = true;
    soraTan.hidden = true;
    soraTanPlace();
    soraTanSyncTray();
    soraTanSetHidden(false);
}

function closeSoraTan() {
    soraTan.running = false;
    clearTimeout(soraTan.autoHideTimer);
    clearTimeout(soraTan.fadeTimer);
    if (soraTan.raf) cancelAnimationFrame(soraTan.raf);
    soraTan.raf = 0;
    soraTan.hidden = true;
    if (soraTan.root) soraTan.root.classList.remove('is-shown', 'is-hot');
    if (soraTan.root) soraTan.root.classList.add('hidden');
    soraTanSyncTray();
}

window.openSoraTan = openSoraTan;
window.closeSoraTan = closeSoraTan;
