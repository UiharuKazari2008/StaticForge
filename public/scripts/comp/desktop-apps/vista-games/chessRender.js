// Chess Titans, the 3D renderer (Yozora #609). Chess.dll drew the game with Direct3D 9 and the
// effects in Media\Shaders (MeshCommon.fx with MeshGlass / MeshPorcelain / MeshWood.fx, Decal.fx);
// this is that renderer in plain WebGL, on the game's own meshes and textures
// (scripts/build-vista-chess.js -> /static_images/vista-games/chess/):
//
//   - the scene in Direct3D's left-handed world: the board is the 40 x 40 square at y = 0 (5 units a
//     square, a1 at -x -z), the trim ring to 20.31, the table slab to 30 x 1.5 deep
//   - pieces, the look the VM shows (the effects' fixed-function techniques TWhite / TBlack: the
//     albedo times ambient ka + diffuse kd from the light 15 degrees off vertical, the material's
//     specular at power 20 for High gloss shine); porcelain has no albedo. With `environment` on
//     it is PieceVS / PiecePS instead (the albedo scaled by environmentTextureAmount, the
//     environment cube by reflWhite / reflBlack), the look of the pixel-shader path the VM's
//     driver does not take
//   - board: the albedo, the mirrored pieces blended in by ReflectionStrength 0.25 x their alpha
//     (Show reflections); table: the albedo; trim: the trim colour (the reflection at 0.45)
//   - decals (TWorldDecal): textured quads on the board without depth test, their alpha times the
//     gradient texture at the decal's fade (Decal.fx samples Gradient.dds at one u for a whole quad)
//   - the background: the board style's Back*.dds stretched over the view
//
// The tip balloons are drawn by chess.js on a 2D canvas over this one.
(function (root) {
    'use strict';

    const BASE = '/static_images/vista-games/chess/';
    const SQUARE = 5;

    // ---- small matrix helpers (column-major, as WebGL takes them) ---------------------------
    const M = {
        ident() {
            const m = new Float32Array(16);
            m[0] = m[5] = m[10] = m[15] = 1;
            return m;
        },
        mul(a, b) {
            const o = new Float32Array(16);
            for (let c = 0; c < 4; c++) {
                for (let r = 0; r < 4; r++) {
                    let s = 0;
                    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
                    o[c * 4 + r] = s;
                }
            }
            return o;
        },
        // D3DXMatrixLookAtLH
        lookAt(eye, at, up) {
            const z = norm(sub(at, eye));
            const x = norm(cross(up, z));
            const y = cross(z, x);
            const m = M.ident();
            m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[12] = -dot(x, eye);
            m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[13] = -dot(y, eye);
            m[2] = z[0]; m[6] = z[1]; m[10] = z[2]; m[14] = -dot(z, eye);
            return m;
        },
        // D3DXMatrixPerspectiveFovLH, with GL's -w..w depth
        perspective(fovY, aspect, near, far) {
            const f = 1 / Math.tan(fovY / 2);
            const m = new Float32Array(16);
            m[0] = f / aspect;
            m[5] = f;
            m[10] = (far + near) / (far - near);
            m[11] = 1;
            m[14] = -2 * far * near / (far - near);
            return m;
        },
        invert(m) {
            const inv = new Float32Array(16);
            inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
            inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
            inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
            inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
            inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
            inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
            inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
            inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
            inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
            inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
            inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
            inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
            inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
            inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
            inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
            inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
            let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
            if (!det) return M.ident();
            det = 1 / det;
            for (let i = 0; i < 16; i++) inv[i] *= det;
            return inv;
        },
        // rotation (unit quaternion w x y z) then translation, scale s
        fromQuat(q, t, s) {
            const [w, x, y, z] = q;
            const k = s === undefined ? 1 : s;
            const m = M.ident();
            m[0] = (1 - 2 * (y * y + z * z)) * k; m[1] = 2 * (x * y + z * w) * k; m[2] = 2 * (x * z - y * w) * k;
            m[4] = 2 * (x * y - z * w) * k; m[5] = (1 - 2 * (x * x + z * z)) * k; m[6] = 2 * (y * z + x * w) * k;
            m[8] = 2 * (x * z + y * w) * k; m[9] = 2 * (y * z - x * w) * k; m[10] = (1 - 2 * (x * x + y * y)) * k;
            m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
            return m;
        },
        rotY(a) {
            const m = M.ident();
            m[0] = Math.cos(a); m[2] = -Math.sin(a);
            m[8] = Math.sin(a); m[10] = Math.cos(a);
            return m;
        },
        apply(m, v) {
            const x = v[0]; const y = v[1]; const z = v[2]; const w = v[3] === undefined ? 1 : v[3];
            return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w,
                m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];
        },
        mat3(m) {
            return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
        }
    };
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => {
        const l = Math.hypot(a[0], a[1], a[2]) || 1;
        return [a[0] / l, a[1] / l, a[2] / l];
    };

    // ---- the effects' constants (Media\Shaders\Mesh<Style>.fx) ----------------------------------
    const PIECE_FX = {
        glass: { kaWhite: [0.26, 0.26, 0.29], kdWhite: [0.82, 0.82, 0.85], reflWhite: 0.33, kaBlack: [0.2, 0.2, 0.2], kdBlack: [0.45, 0.45, 0.45], reflBlack: 0.14, envAmount: 0.6, albedo: true, tex: ['glasslight', 'glassdark'] },
        porcelain: { kaWhite: [0.317, 0.317, 0.317], kdWhite: [0.651, 0.651, 0.651], reflWhite: 0.08, kaBlack: [0.035, 0.045, 0.055], kdBlack: [0.165, 0.165, 0.165], reflBlack: 0.17, envAmount: 1, albedo: false, tex: [null, null] },
        wood: { kaWhite: [0.317, 0.317, 0.317], kdWhite: [0.8, 0.8, 0.8], reflWhite: 0.1, kaBlack: [0.32, 0.25, 0.22], kdBlack: [1, 1, 1], reflBlack: 0.14, envAmount: 1, albedo: true, tex: ['woodlight', 'wooddark'] }
    };
    const WORLD_LIGHT = [0.259, 0.966, 0]; // "15 degrees over"
    // MeshCommon.fx's trimColor is (0.6, 0.58, 0.5); the VM draws the trim at (211, 206, 185)
    const TRIM_COLOR = [211 / 255, 206 / 255, 185 / 255];
    const ENV_CONTRIBUTION = 0.25;
    const REFLECTION_STRENGTH = 0.25;
    const TRIM_REFLECTION_STRENGTH = 0.45;

    // ---- shaders ------------------------------------------------------------------------------
    const VS_MESH = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv;
uniform mat4 uWorld; uniform mat4 uView; uniform mat4 uProj; uniform mat3 uViewInv3;
uniform vec3 uKa; uniform vec3 uKd; uniform vec3 uLight; uniform vec2 uUvMin; uniform vec2 uUvMax;
uniform float uMirror; uniform float uFlipV; uniform vec3 uSpec;
varying vec3 vSpec; varying vec3 vDiffuse; varying vec2 vUv; varying vec3 vEnv; varying vec4 vRefl;
void main() {
    vec4 wp = uWorld * vec4(aPos, 1.0);
    wp.y *= uMirror;
    vec4 vp = uView * wp;
    gl_Position = uProj * vp;
    vec3 wn = mat3(uWorld) * aNrm;
    wn.y *= uMirror;
    vec3 n = normalize(mat3(uView) * wn);
    vec3 L = mat3(uView) * uLight;
    vDiffuse = uKa + uKd * clamp(dot(n, L), 0.0, 1.0);
    // the fixed-function techniques' specular (MaterialSpecular, MaterialPower 20)
    vec3 h = normalize(normalize(L) - normalize(vp.xyz));
    vSpec = uSpec * pow(max(dot(n, h), 0.0), 20.0);
    vUv = mix(uUvMin, uUvMax, aUv);
    // the board and table meshes' v runs up their textures (matched to the VM: a1 dark, the
    // marble's veins); the pieces' does not
    if (uFlipV > 0.5) vUv.y = 1.0 - vUv.y;
    vec3 r = reflect(normalize(vp.xyz), n);
    vEnv = uViewInv3 * r;
    vRefl = gl_Position;
}`;
    // mode 0 piece, 1 board, 2 table, 3 trim
    const FS_MESH = `
precision mediump float;
uniform sampler2D uAlbedo; uniform samplerCube uEnv; uniform sampler2D uRefl;
uniform int uMode; uniform bool uHasAlbedo; uniform bool uHasEnv; uniform bool uHasRefl;
uniform float uReflAmount; uniform float uEnvAmount; uniform float uAlpha; uniform vec3 uTrim;
varying vec3 vSpec; varying vec3 vDiffuse; varying vec2 vUv; varying vec3 vEnv; varying vec4 vRefl;
void main() {
    vec3 env = uHasEnv ? textureCube(uEnv, vEnv).rgb : vec3(0.0);
    vec4 refl = vec4(0.0);
    if (uHasRefl) {
        vec2 rc = vRefl.xy / vRefl.w * 0.5 + 0.5;
        refl = texture2D(uRefl, rc);
    }
    if (uMode == 0) {
        if (uHasAlbedo) {
            vec3 a = texture2D(uAlbedo, vUv).rgb * (uHasEnv ? uEnvAmount : 1.0);
            gl_FragColor = vec4(vDiffuse * a + env * uReflAmount + vSpec, uAlpha);
        } else {
            gl_FragColor = vec4(vDiffuse + env * uReflAmount + vSpec, uAlpha);
        }
    } else if (uMode == 1) {
        vec3 a = texture2D(uAlbedo, vUv).rgb;
        vec3 c = mix(a, refl.rgb, refl.a * ${REFLECTION_STRENGTH.toFixed(3)});
        gl_FragColor = vec4(c + env * ${ENV_CONTRIBUTION.toFixed(3)}, 1.0);
    } else if (uMode == 2) {
        gl_FragColor = vec4(texture2D(uAlbedo, vUv).rgb + env * 0.0325, 1.0);
    } else {
        vec3 c = mix(uTrim, refl.rgb, refl.a * ${TRIM_REFLECTION_STRENGTH.toFixed(3)});
        gl_FragColor = vec4(c + env * ${ENV_CONTRIBUTION.toFixed(3)}, 1.0);
    }
}`;
    // decals and the background: a textured quad, world or screen space
    const VS_QUAD = `
attribute vec3 aPos; attribute vec2 aUv;
uniform mat4 uMvp; varying vec2 vUv;
void main() { gl_Position = uMvp * vec4(aPos, 1.0); vUv = aUv; }`;
    const FS_QUAD = `
precision mediump float;
uniform sampler2D uTex; uniform sampler2D uGrad; uniform float uFade; uniform vec4 uTint; uniform vec4 uUvRect;
varying vec2 vUv;
void main() {
    vec4 c = texture2D(uTex, uUvRect.xy + vUv * uUvRect.zw);
    float g = texture2D(uGrad, vec2(uFade, 0.5)).a;
    gl_FragColor = vec4(c.rgb * uTint.rgb, c.a * g * uTint.a);
}`;

    function compile(gl, vs, fs) {
        const mk = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('chess shader: ' + gl.getShaderInfoLog(s));
            return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('chess program: ' + gl.getProgramInfoLog(p));
        const prog = { p, u: {}, a: {} };
        const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < nu; i++) {
            const info = gl.getActiveUniform(p, i);
            prog.u[info.name] = gl.getUniformLocation(p, info.name);
        }
        const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < na; i++) {
            const info = gl.getActiveAttrib(p, i);
            prog.a[info.name] = gl.getAttribLocation(p, info.name);
        }
        return prog;
    }

    // meshes-<quality>.bin (scripts/build-vista-chess.js packMeshes)
    function unpackMeshes(buf) {
        const dv = new DataView(buf);
        if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'CHM1') throw new Error('chess meshes: bad file');
        const count = dv.getUint32(4, true);
        let o = 8;
        const out = {};
        const pad = (n) => (n + 3) & ~3;
        for (let k = 0; k < count; k++) {
            const nl = dv.getUint8(o);
            let name = '';
            for (let i = 0; i < nl; i++) name += String.fromCharCode(dv.getUint8(o + 1 + i));
            o += (nl + 4) & ~3;
            const nv = dv.getUint32(o, true);
            const ni = dv.getUint32(o + 4, true);
            const scale = dv.getFloat32(o + 8, true);
            const uvMin = [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true)];
            const uvMax = [dv.getFloat32(o + 20, true), dv.getFloat32(o + 24, true)];
            o += 28;
            const pos = new Float32Array(nv * 3);
            const p16 = new Int16Array(buf, o, nv * 3);
            for (let i = 0; i < nv * 3; i++) pos[i] = p16[i] * scale;
            o += pad(nv * 6);
            const nrm = new Int8Array(buf.slice(o, o + nv * 4));
            o += nv * 4;
            const uv = new Uint16Array(buf.slice(o, o + nv * 4));
            o += nv * 4;
            const idx = new Uint16Array(buf.slice(o, o + ni * 2));
            o += pad(ni * 2);
            let maxY = 0;
            let maxR = 0;
            for (let i = 0; i < nv; i++) {
                maxY = Math.max(maxY, pos[i * 3 + 1]);
                maxR = Math.max(maxR, Math.hypot(pos[i * 3], pos[i * 3 + 2]));
            }
            out[name] = { nv, ni, pos, nrm, uv, idx, uvMin, uvMax, maxY, maxR };
        }
        return out;
    }

    class ChessRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            const opts = { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true };
            const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
            if (!gl) throw new Error('WebGL is not available');
            this.gl = gl;
            this.meshProg = compile(gl, VS_MESH, FS_MESH);
            this.quadProg = compile(gl, VS_QUAD, FS_QUAD);
            this.textures = {};
            this.meshes = { high: null, low: null };
            this.gpu = { high: {}, low: {} };
            this.quad = this.makeQuad();
            this.reflection = null;
            this.settings = { board: 'marble', pieces: 'glass', reflections: true, environment: false, gloss: true, highDetail: true };
            this.ready = false;
            this.onInvalidate = null;
        }

        // the 3D assets: meshes, then the textures the current style needs
        load() {
            if (this.loading) return this.loading;
            const fetchBuf = (u) => fetch(BASE + u, { credentials: 'same-origin' }).then((r) => {
                if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u);
                return r.arrayBuffer();
            });
            this.loading = Promise.all([fetchBuf('meshes-high.bin'), fetchBuf('meshes-low.bin')]).then(([hi, lo]) => {
                this.meshes.high = unpackMeshes(hi);
                this.meshes.low = unpackMeshes(lo);
                ['high', 'low'].forEach((q) => Object.keys(this.meshes[q]).forEach((k) => { this.gpu[q][k] = this.upload(this.meshes[q][k]); }));
                return Promise.all(['gradient', 'chesstrim', 'decal-select', 'decal-action', 'decal-check', 'decal-lastmovesource',
                    'decal-lastmovetarget', 'decal-shadow', 'decal-flat', 'decal-thinky0', 'decal-thinky1', 'decal-thinky2',
                    'decal-thinky3', 'decal-thinky4', 'decal-thinky5'].map((t) => this.texture(t)));
            }).then(() => this.styleTextures()).then(() => {
                this.ready = true;
            });
            return this.loading;
        }

        styleTextures() {
            const s = this.settings;
            const fx = PIECE_FX[s.pieces] || PIECE_FX.glass;
            const list = ['board' + s.board, 'table' + s.board, 'back' + s.board];
            fx.tex.forEach((t) => { if (t) list.push(t); });
            const jobs = list.map((t) => this.texture(t));
            if (s.environment) jobs.push(this.cube(this.envName()));
            return Promise.all(jobs);
        }

        // which environment cube reflects on what: the pixel shader techniques' look. The VM draws
        // the fixed-function techniques (no cube), so the game leaves `environment` off.
        envName() {
            return ChessRenderer.ENV_FOR_BOARD[this.settings.board] || 'checker';
        }

        setStyle(board, pieces) {
            this.settings.board = board;
            this.settings.pieces = pieces;
            return this.styleTextures().then(() => this.invalidate());
        }

        invalidate() {
            if (this.onInvalidate) this.onInvalidate();
        }

        upload(mesh) {
            const gl = this.gl;
            const mk = (data, target) => {
                const b = gl.createBuffer();
                gl.bindBuffer(target || gl.ARRAY_BUFFER, b);
                gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
                return b;
            };
            return { pos: mk(mesh.pos), nrm: mk(mesh.nrm), uv: mk(mesh.uv), idx: mk(mesh.idx, gl.ELEMENT_ARRAY_BUFFER), n: mesh.ni, mesh };
        }

        makeQuad() {
            const gl = this.gl;
            const b = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, b);
            // x y z u v: a unit square in the x/z plane (centre 0), uv 0..1
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -0.5, 0, -0.5, 0, 1, 0.5, 0, -0.5, 1, 1, 0.5, 0, 0.5, 1, 0,
                -0.5, 0, -0.5, 0, 1, 0.5, 0, 0.5, 1, 0, -0.5, 0, 0.5, 0, 0
            ]), gl.STATIC_DRAW);
            return b;
        }

        texture(name) {
            if (this.textures[name]) return this.textures[name].promise;
            const gl = this.gl;
            const tex = gl.createTexture();
            const entry = { tex, ready: false };
            entry.promise = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    gl.bindTexture(gl.TEXTURE_2D, tex);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                    const pot = (img.width & (img.width - 1)) === 0 && (img.height & (img.height - 1)) === 0;
                    if (pot) gl.generateMipmap(gl.TEXTURE_2D);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, pot ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    const wrap = /^(board|table|glass|wood)/.test(name) ? gl.REPEAT : gl.CLAMP_TO_EDGE;
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, pot ? wrap : gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, pot ? wrap : gl.CLAMP_TO_EDGE);
                    entry.ready = true;
                    entry.w = img.width;
                    entry.h = img.height;
                    this.invalidate();
                    resolve(entry);
                };
                img.onerror = () => resolve(entry);
                const png = /^(decal-|gradient|chesstrim)/.test(name);
                img.src = BASE + 'textures/' + name + (png ? '.png' : '.webp');
            });
            this.textures[name] = entry;
            return entry.promise;
        }

        cube(name) {
            const key = 'env-' + name;
            if (this.textures[key]) return this.textures[key].promise;
            const gl = this.gl;
            const tex = gl.createTexture();
            const entry = { tex, ready: false, cube: true };
            const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
            entry.promise = Promise.all(faces.map((f) => new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = BASE + 'textures/env-' + name + '-' + f + '.webp';
            }))).then((imgs) => {
                gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                imgs.forEach((img, i) => {
                    if (img) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                });
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                entry.ready = imgs.every(Boolean);
                this.invalidate();
                return entry;
            });
            this.textures[key] = entry;
            return entry.promise;
        }

        tex(name) {
            const t = this.textures[name];
            return t && t.ready ? t.tex : null;
        }

        // ---- camera ----------------------------------------------------------------------------
        // cam: { yaw (radians, 0 = from white's side), pitch (radians above the board), dist, fov,
        //   target [x y z] }
        setCamera(cam, w, h) {
            const cp = Math.cos(cam.pitch);
            const eye = [
                cam.target[0] - Math.sin(cam.yaw) * cp * cam.dist,
                cam.target[1] + Math.sin(cam.pitch) * cam.dist,
                cam.target[2] - Math.cos(cam.yaw) * cp * cam.dist
            ];
            // looking straight down needs another up
            const up = cam.pitch > 1.5 ? [Math.sin(cam.yaw), 0, Math.cos(cam.yaw)] : [0, 1, 0];
            this.eye = eye;
            this.view = M.lookAt(eye, cam.target, up);
            this.proj = M.perspective(cam.fov, w / h, cam.near || 5, cam.far || 400);
            this.viewInv = M.invert(this.view);
            this.vp = M.mul(this.proj, this.view);
            this.vpInv = M.invert(this.vp);
        }

        // screen (0..1, y down) -> world ray
        ray(sx, sy) {
            const nx = sx * 2 - 1;
            const ny = 1 - sy * 2;
            const a = M.apply(this.vpInv, [nx, ny, -1, 1]);
            const b = M.apply(this.vpInv, [nx, ny, 1, 1]);
            const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
            const p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
            return { o: p0, d: norm(sub(p1, p0)) };
        }

        // world -> screen (0..1, y down)
        project(p) {
            const c = M.apply(this.vp, [p[0], p[1], p[2], 1]);
            return { x: (c[0] / c[3]) * 0.5 + 0.5, y: 0.5 - (c[1] / c[3]) * 0.5, w: c[3] };
        }

        // the board square (0..63, a1 = 0) under a screen point; pieces (as upright cylinders) first
        pick(sx, sy, pieces) {
            const r = this.ray(sx, sy);
            let best = null;
            (pieces || []).forEach((pc) => {
                const mesh = this.meshFor(pc.type);
                if (!mesh || pc.hidden) return;
                const rad = Math.min(2.2, mesh.mesh.maxR * 0.85);
                const hgt = mesh.mesh.maxY;
                // ray / vertical cylinder
                const ox = r.o[0] - pc.x;
                const oz = r.o[2] - pc.z;
                const a = r.d[0] * r.d[0] + r.d[2] * r.d[2];
                const b = 2 * (ox * r.d[0] + oz * r.d[2]);
                const c = ox * ox + oz * oz - rad * rad;
                const disc = b * b - 4 * a * c;
                if (disc < 0 || a < 1e-9) return;
                const t = (-b - Math.sqrt(disc)) / (2 * a);
                const y = r.o[1] + r.d[1] * t;
                let tt = t;
                // the cap: entering from the top
                if (y > hgt && r.d[1] < 0) {
                    tt = (hgt - r.o[1]) / r.d[1];
                    const hx = r.o[0] + r.d[0] * tt - pc.x;
                    const hz = r.o[2] + r.d[2] * tt - pc.z;
                    if (hx * hx + hz * hz > rad * rad) return;
                } else if (y < 0 || y > hgt) return;
                if (!best || tt < best.t) best = { t: tt, square: pc.square };
            });
            if (best) return best.square;
            if (Math.abs(r.d[1]) < 1e-6) return -1;
            const t = -r.o[1] / r.d[1];
            const x = r.o[0] + r.d[0] * t;
            const z = r.o[2] + r.d[2] * t;
            const f = Math.floor(x / SQUARE + 4);
            const k = Math.floor(z / SQUARE + 4);
            if (f < 0 || f > 7 || k < 0 || k > 7) return -1;
            return k * 8 + f;
        }

        meshFor(type) {
            const q = this.settings.highDetail ? 'high' : 'low';
            return this.gpu[q][['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][type]] || null;
        }

        // ---- frame -----------------------------------------------------------------------------
        // scene: { camera, pieces: [{ type, colour (0 / 8), x, y, z, q (quaternion w x y z), yaw,
        //   alpha, square }], decals: [{ tex, x, z, size, fade, tint, rot, uv }], shadows: bool,
        //   screen: [{ tex, x, y, w, h (css px from the top left), alpha }] }
        render(scene) {
            const gl = this.gl;
            const w = this.canvas.width;
            const h = this.canvas.height;
            if (!this.ready) {
                gl.viewport(0, 0, w, h);
                gl.clearColor(0, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
                return;
            }
            this.setCamera(scene.camera, w, h);
            const s = this.settings;
            const reflections = s.reflections && scene.view3d !== false;
            if (reflections) this.renderReflection(scene, w, h);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, w, h);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            this.drawBackground();
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.disable(gl.BLEND);
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);
            // Direct3D's clockwise front faces in a left-handed world
            gl.frontFace(gl.CW);
            const q = s.highDetail ? 'high' : 'low';
            this.drawMesh(this.gpu[q].chesstable, M.ident(), { mode: 2, albedo: 'table' + s.board });
            this.drawMesh(this.gpu[q].chesstrim, M.ident(), { mode: 3, refl: reflections });
            this.drawMesh(this.gpu[q].chessboard, M.ident(), { mode: 1, albedo: 'board' + s.board, refl: reflections });
            // decals on the board (no depth test, as TWorldDecal)
            gl.disable(gl.DEPTH_TEST);
            gl.depthMask(false);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.disable(gl.CULL_FACE);
            (scene.decals || []).forEach((d) => this.drawDecal(d));
            if (scene.shadows !== false && s.pieces !== 'flat') {
                (scene.pieces || []).forEach((pc) => {
                    if (pc.hidden || pc.alpha <= 0) return;
                    const lift = Math.max(0, pc.y || 0);
                    this.drawDecal({ tex: 'decal-shadow', x: pc.x, z: pc.z, size: SQUARE * ChessRenderer.SHADOW_SIZE * (1 + lift * 0.08), fade: 1, tint: [1, 1, 1, (pc.alpha === undefined ? 1 : pc.alpha) * ChessRenderer.SHADOW_ALPHA / (1 + lift * 0.3)] });
                });
            }
            (scene.overDecals || []).forEach((d) => this.drawDecal(d));
            gl.depthMask(true);
            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.CULL_FACE);
            if (s.pieces === 'flat') this.drawFlatPieces(scene);
            else this.drawPieces(scene, 1);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            (scene.screen || []).forEach((d) => this.drawScreen(d, w, h));
            gl.disable(gl.BLEND);
        }

        drawPieces(scene, mirror) {
            const gl = this.gl;
            const s = this.settings;
            const fx = PIECE_FX[s.pieces] || PIECE_FX.glass;
            // opaque first, the fading (captured) ones blended after
            const list = (scene.pieces || []).filter((p) => !p.hidden && (p.alpha === undefined || p.alpha > 0));
            list.sort((a, b) => (a.alpha === undefined ? 1 : a.alpha) < (b.alpha === undefined ? 1 : b.alpha) ? 1 : -1);
            list.forEach((pc) => {
                const mesh = this.meshFor(pc.type);
                if (!mesh) return;
                const black = pc.colour === 8;
                const alpha = pc.alpha === undefined ? 1 : pc.alpha;
                let world = M.fromQuat(pc.q || [1, 0, 0, 0], [pc.x, pc.y || 0, pc.z]);
                world = M.mul(world, M.rotY(pc.yaw || 0));
                if (alpha < 1) {
                    gl.enable(gl.BLEND);
                    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                } else gl.disable(gl.BLEND);
                this.drawMesh(mesh, world, {
                    mode: 0,
                    albedo: fx.albedo ? fx.tex[black ? 1 : 0] : null,
                    ka: black ? fx.kaBlack : fx.kaWhite,
                    kd: black ? fx.kdBlack : fx.kdWhite,
                    reflAmount: black ? fx.reflBlack : fx.reflWhite,
                    spec: s.gloss ? (black ? [0.25, 0.25, 0.25] : [0.15, 0.15, 0.15]) : null,
                    envAmount: fx.envAmount,
                    alpha,
                    mirror
                });
            });
            gl.disable(gl.BLEND);
        }

        // the Flat (2D) set: Decals\Flat.dds, a 4 x 3 sheet of piece pictures, stood up facing the camera
        drawFlatPieces(scene) {
            const gl = this.gl;
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.disable(gl.CULL_FACE);
            gl.depthMask(false);
            const list = (scene.pieces || []).filter((p) => !p.hidden && (p.alpha === undefined || p.alpha > 0));
            // far to near
            list.sort((a, b) => dot(sub([b.x, 0, b.z], this.eye), sub([b.x, 0, b.z], this.eye)) - dot(sub([a.x, 0, a.z], this.eye), sub([a.x, 0, a.z], this.eye)));
            list.forEach((pc) => {
                const cell = ChessRenderer.FLAT_CELL[(pc.colour === 8 ? 6 : 0) + pc.type - 1];
                this.drawDecal({
                    tex: 'decal-flat', x: pc.x, z: pc.z, y: (pc.y || 0) + 0.02, size: SQUARE * 0.98, fade: 1,
                    tint: [1, 1, 1, pc.alpha === undefined ? 1 : pc.alpha],
                    uv: [cell[0] / 4, cell[1] / 4, 0.25, 0.25], rot: scene.flatYaw || 0
                });
            });
            gl.depthMask(true);
        }

        renderReflection(scene, w, h) {
            const gl = this.gl;
            const rw = Math.max(1, w >> 1);
            const rh = Math.max(1, h >> 1);
            let r = this.reflection;
            if (!r || r.w !== rw || r.h !== rh) {
                if (r) {
                    gl.deleteFramebuffer(r.fb);
                    gl.deleteTexture(r.tex);
                    gl.deleteRenderbuffer(r.depth);
                }
                r = { w: rw, h: rh, fb: gl.createFramebuffer(), tex: gl.createTexture(), depth: gl.createRenderbuffer() };
                gl.bindTexture(gl.TEXTURE_2D, r.tex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.bindRenderbuffer(gl.RENDERBUFFER, r.depth);
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, rw, rh);
                gl.bindFramebuffer(gl.FRAMEBUFFER, r.fb);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.tex, 0);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, r.depth);
                this.reflection = r;
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, r.fb);
            gl.viewport(0, 0, rw, rh);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            if (this.settings.pieces === 'flat') return;
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.enable(gl.CULL_FACE);
            // the mirror flips the winding
            gl.frontFace(gl.CCW);
            this.drawPieces(scene, -1);
            gl.frontFace(gl.CW);
        }

        drawMesh(g, world, o) {
            if (!g) return;
            const gl = this.gl;
            const p = this.meshProg;
            gl.useProgram(p.p);
            gl.uniformMatrix4fv(p.u.uWorld, false, world);
            gl.uniformMatrix4fv(p.u.uView, false, this.view);
            gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
            gl.uniformMatrix3fv(p.u.uViewInv3, false, M.mat3(this.viewInv));
            gl.uniform3fv(p.u.uKa, o.ka || [0, 0, 0]);
            gl.uniform3fv(p.u.uKd, o.kd || [1, 1, 1]);
            gl.uniform3fv(p.u.uLight, WORLD_LIGHT);
            gl.uniform3fv(p.u.uSpec, o.spec || [0, 0, 0]);
            gl.uniform2fv(p.u.uUvMin, g.mesh.uvMin);
            gl.uniform2fv(p.u.uUvMax, g.mesh.uvMax);
            gl.uniform1f(p.u.uMirror, o.mirror || 1);
            gl.uniform1i(p.u.uMode, o.mode);
            gl.uniform1f(p.u.uFlipV, o.mode === 0 ? 0 : 1);
            const albedo = o.albedo ? this.tex(o.albedo) : null;
            gl.uniform1i(p.u.uHasAlbedo, albedo ? 1 : 0);
            const env = this.settings.environment ? this.tex('env-' + this.envName()) : null;
            gl.uniform1i(p.u.uHasEnv, env ? 1 : 0);
            const refl = o.refl && this.reflection ? this.reflection.tex : null;
            gl.uniform1i(p.u.uHasRefl, refl ? 1 : 0);
            gl.uniform1f(p.u.uReflAmount, o.reflAmount || 0);
            gl.uniform1f(p.u.uEnvAmount, o.envAmount === undefined ? 1 : o.envAmount);
            gl.uniform1f(p.u.uAlpha, o.alpha === undefined ? 1 : o.alpha);
            gl.uniform3fv(p.u.uTrim, TRIM_COLOR);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, albedo || this.tex('chesstrim'));
            gl.uniform1i(p.u.uAlbedo, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, env);
            gl.uniform1i(p.u.uEnv, 1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, refl);
            gl.uniform1i(p.u.uRefl, 2);
            gl.bindBuffer(gl.ARRAY_BUFFER, g.pos);
            gl.enableVertexAttribArray(p.a.aPos);
            gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, g.nrm);
            gl.enableVertexAttribArray(p.a.aNrm);
            gl.vertexAttribPointer(p.a.aNrm, 3, gl.BYTE, true, 4, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, g.uv);
            gl.enableVertexAttribArray(p.a.aUv);
            gl.vertexAttribPointer(p.a.aUv, 2, gl.UNSIGNED_SHORT, true, 0, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
            gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
            gl.disableVertexAttribArray(p.a.aNrm);
        }

        quadDraw(mvp, texName, o) {
            const gl = this.gl;
            const tex = this.tex(texName);
            if (!tex) return;
            const p = this.quadProg;
            gl.useProgram(p.p);
            gl.uniformMatrix4fv(p.u.uMvp, false, mvp);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(p.u.uTex, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.tex('gradient') || tex);
            gl.uniform1i(p.u.uGrad, 1);
            gl.uniform1f(p.u.uFade, o.fade === undefined ? 1 : o.fade);
            gl.uniform4fv(p.u.uTint, o.tint || [1, 1, 1, 1]);
            gl.uniform4fv(p.u.uUvRect, o.uv || [0, 0, 1, 1]);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
            gl.enableVertexAttribArray(p.a.aPos);
            gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, 20, 0);
            gl.enableVertexAttribArray(p.a.aUv);
            gl.vertexAttribPointer(p.a.aUv, 2, gl.FLOAT, false, 20, 12);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // a decal on the board plane: { tex, x, z, y, size, fade, tint, rot, uv }
        drawDecal(d) {
            let m = M.ident();
            const s = d.size || SQUARE;
            m[0] = s;
            m[10] = s;
            if (d.rot) m = M.mul(M.rotY(d.rot), m);
            m[12] = d.x;
            m[13] = d.y || 0.01;
            m[14] = d.z;
            this.quadDraw(M.mul(this.vp, m), d.tex, d);
        }

        // a screen-space picture: { tex, x, y, w, h } in device px from the top left
        drawScreen(d, w, h) {
            const m = M.ident();
            // unit quad x/z -> clip x/y
            m[0] = d.w / w * 2;
            m[5] = 0;
            m[9] = d.h / h * 2; // quad z (+0.5 is the texture's top row) -> clip y
            m[10] = 0;
            m[12] = ((d.x + d.w / 2) / w) * 2 - 1;
            m[13] = 1 - ((d.y + d.h / 2) / h) * 2;
            m[14] = 0;
            this.quadDraw(m, d.tex, { tint: [1, 1, 1, d.alpha === undefined ? 1 : d.alpha], fade: 1, uv: d.uv });
        }

        drawBackground() {
            const gl = this.gl;
            const name = 'back' + this.settings.board;
            if (!this.tex(name)) return;
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.BLEND);
            gl.disable(gl.CULL_FACE);
            this.drawScreen({ tex: name, x: 0, y: 0, w: this.canvas.width, h: this.canvas.height }, this.canvas.width, this.canvas.height);
        }

        destroy() {
            const ext = this.gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
        }
    }
    // Flat.dds cells [column, row] for white P N B R Q K then black P N B R Q K
    ChessRenderer.FLAT_CELL = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]];
    ChessRenderer.ENV_FOR_BOARD = { marble: 'aurora', porcelain: 'stars', wood: 'checker' };
    ChessRenderer.SQUARE = SQUARE;
    ChessRenderer.SHADOW_SIZE = 0.9;
    ChessRenderer.SHADOW_ALPHA = 0.8;
    ChessRenderer.M = M;

    root.VistaChessRenderer = ChessRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
