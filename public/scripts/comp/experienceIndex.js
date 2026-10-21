/**
 * MeletonFX Experience Index (Yukimi 2026-10-21: "have the rating number be based on the client
 * browser session and is based on performance metrics, supported features, etc."): Vista's Windows
 * Experience Index for this browser session. Five subscores on Vista's 1.0 - 5.9 scale; the base
 * score is the lowest, as Vista's is.
 *
 *   processor            a fixed integer workload timed on the main thread (best of five short
 *                        rounds), capped by the logical processors (navigator.hardwareConcurrency)
 *   memory               navigator.deviceMemory (the browser rounds it and stops at 8 GB)
 *   graphics             the desktop's needs: WebGL 2, a hardware (not software) renderer, the
 *                        largest texture, backdrop-filter for the frosted glass, WebGPU
 *   gaming               frame pacing: requestAnimationFrame over about half a second (15 fps 1.0,
 *                        30 fps 3.0, 60 fps 5.0, 120 fps 5.9, less for long frames), no higher
 *                        than graphics on a software renderer
 *   disk                 storage: the quota (navigator.storage.estimate), persistence, IndexedDB,
 *                        Cache Storage, the origin private file system, the service worker
 *
 * A subscore the browser cannot measure (no deviceMemory, a hidden tab with no frames) is left
 * out of the base score. The result is kept for the session (sessionStorage), so the number does
 * not move every time the System page opens; assess({ fresh: true }) runs it again. A result taken
 * while the tab was hidden (the browser slows background tabs) is shown but not kept.
 *
 *   meletonExperienceIndex.assess()  -> Promise<{ base, scores: {processor, memory, graphics,
 *                                        gaming, disk}, details, assessedAt }>
 *   meletonExperienceIndex.cached()  -> the session's result or null
 */
(function (root) {
    'use strict';

    const STORAGE_KEY = 'dreamscape.experienceIndex';
    const VERSION = 2;
    const MIN = 1.0;
    const MAX = 5.9;
    let inflight = null;

    function clamp(v) {
        return Math.min(MAX, Math.max(MIN, v));
    }

    /** One decimal, truncated as Vista prints subscores (4.86 -> 4.8). */
    function score(v) {
        if (!Number.isFinite(v)) return null;
        return Math.floor(clamp(v) * 10 + 1e-9) / 10;
    }

    /** Linear on a log scale: lo -> 1.0, hi -> 5.9. */
    function logScale(value, lo, hi) {
        if (!(value > 0)) return MIN;
        const t = (Math.log(value) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
        return MIN + (MAX - MIN) * Math.min(1, Math.max(0, t));
    }

    // ---- processor ------------------------------------------------------------------------------

    /** xorshift mixing, timed in 20k-step slices: steps per millisecond. */
    function cpuRound(ms) {
        const now = () => (root.performance ? root.performance.now() : Date.now());
        let x = 0x9e3779b9 | 0;
        let steps = 0;
        const start = now();
        let elapsed = 0;
        do {
            for (let i = 0; i < 20000; i++) {
                x ^= x << 13;
                x ^= x >>> 17;
                x ^= x << 5;
                x = (x + Math.imul(i, 0x9e3779b1)) | 0;
            }
            steps += 20000;
            elapsed = now() - start;
        } while (elapsed < ms);
        // keep x alive so the loop is not optimised away
        if (x === 0x7fffffff) steps += 1;
        return steps / Math.max(elapsed, 0.001);
    }

    function processorScore(nav, rate) {
        const cores = Number(nav && nav.hardwareConcurrency) || 1;
        // single thread: ~20k steps/ms (an old phone) -> 1.0, ~600k (a current desktop core) -> 5.9
        let s = logScale(rate, 20000, 600000);
        // Vista held single and dual cores back the same way
        const cap = cores <= 1 ? 2.9 : cores <= 2 ? 4.4 : cores <= 4 ? 5.4 : MAX;
        s = Math.min(s, cap);
        return { score: score(s), detail: { stepsPerMs: Math.round(rate), logicalProcessors: cores } };
    }

    // ---- memory ---------------------------------------------------------------------------------

    function memoryScore(nav) {
        const gb = Number(nav && nav.deviceMemory);
        if (!(gb > 0)) return { score: null, detail: { deviceMemoryGB: null } };
        // 0.25 GB -> 1.0 ... 8 GB (the browser's ceiling) -> 5.9
        return { score: score(logScale(gb, 0.25, 8)), detail: { deviceMemoryGB: gb } };
    }

    // ---- graphics -------------------------------------------------------------------------------

    const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software|mesa offscreen/i;

    function probeWebGL(doc) {
        const out = { webgl: 0, renderer: '', software: false, maxTexture: 0 };
        if (!doc || typeof doc.createElement !== 'function') return out;
        let gl = null;
        try {
            const canvas = doc.createElement('canvas');
            gl = canvas.getContext('webgl2') || null;
            if (gl) out.webgl = 2;
            else {
                gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') || null;
                if (gl) out.webgl = 1;
            }
            if (!gl) return out;
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            out.renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
            out.software = SOFTWARE_RENDERER.test(out.renderer);
            out.maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
        } catch (_) {
            /* no GPU context */
        } finally {
            const lose = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        }
        return out;
    }

    function graphicsScore(probe, features) {
        let s;
        if (!probe.webgl) s = 1.0;
        else if (probe.software) s = 2.0;
        else if (probe.webgl === 1) s = 3.0;
        else {
            // WebGL 2 on a GPU: 4.0, +1.0 for 16k textures (scaled from 4k), +0.5 frosted glass, +0.4 WebGPU
            s = 4.0 + Math.min(1, Math.max(0, Math.log2((probe.maxTexture || 4096) / 4096) / 2));
            if (features.backdropFilter) s += 0.5;
            if (features.webgpu) s += 0.4;
        }
        if (!features.backdropFilter) s = Math.min(s, 2.9);
        return {
            score: score(s),
            detail: {
                webgl: probe.webgl,
                renderer: probe.renderer,
                softwareRenderer: probe.software,
                maxTextureSize: probe.maxTexture,
                backdropFilter: features.backdropFilter,
                webgpu: features.webgpu
            }
        };
    }

    // ---- gaming graphics --------------------------------------------------------------------------

    function sampleFrames(durationMs) {
        return new Promise((resolve) => {
            const raf = root.requestAnimationFrame;
            if (typeof raf !== 'function' || (root.document && root.document.hidden)) {
                resolve(null);
                return;
            }
            const gaps = [];
            let last = null;
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                resolve(gaps);
            };
            const tick = (t) => {
                if (done) return;
                if (last !== null) gaps.push(t - last);
                last = t;
                if (gaps.length >= 90) finish();
                else raf(tick);
            };
            raf(tick);
            setTimeout(finish, durationMs);
        });
    }

    function gamingScore(gaps, graphics) {
        if (!gaps || gaps.length < 8) return { score: null, detail: { frames: gaps ? gaps.length : 0 } };
        const sorted = gaps.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const fps = 1000 / Math.max(median, 1);
        const janky = gaps.filter((g) => g > 34).length / gaps.length;
        // 15 fps -> 1.0, 30 -> 3.0, 60 -> 5.0 (a 60 Hz screen at full pace), 120 -> 5.9;
        // each tenth of frames over 34 ms costs 0.5
        let s = fps >= 60 ? 5.0 + Math.min(0.9, ((fps - 60) / 60) * 0.9) : 1.0 + 4.0 * Math.max(0, Math.log2(fps / 15)) / 2;
        s -= janky * 5;
        // frames from a software renderer are not a GPU's
        if (graphics && (graphics.softwareRenderer || !graphics.webgl)) s = Math.min(s, graphics.score);
        return { score: score(s), detail: { fps: Math.round(fps), jankyFrames: Math.round(janky * 100) / 100, frames: gaps.length } };
    }

    // ---- disk -------------------------------------------------------------------------------------

    async function diskScore(nav) {
        const storage = nav && nav.storage;
        const detail = {
            quotaGB: null,
            persisted: false,
            indexedDB: typeof root.indexedDB !== 'undefined',
            cacheStorage: typeof root.caches !== 'undefined',
            opfs: !!(storage && typeof storage.getDirectory === 'function'),
            serviceWorker: !!(nav && nav.serviceWorker && nav.serviceWorker.controller)
        };
        try {
            if (storage && typeof storage.estimate === 'function') {
                const est = await storage.estimate();
                if (est && est.quota) detail.quotaGB = Math.round((est.quota / 1073741824) * 10) / 10;
            }
            if (storage && typeof storage.persisted === 'function') detail.persisted = (await storage.persisted()) === true;
        } catch (_) {
            /* storage API blocked */
        }
        if (!detail.indexedDB) return { score: 1.0, detail };
        // 0.5 GB -> 1.0 ... 100 GB -> 5.4, then +0.5 persistent storage
        let s = detail.quotaGB ? logScale(detail.quotaGB, 0.5, 100) : 2.0;
        s = Math.min(s, 5.4);
        if (detail.persisted) s += 0.5;
        if (!detail.cacheStorage) s = Math.min(s, 3.0);
        if (!detail.opfs) s = Math.min(s, 4.4);
        if (!detail.serviceWorker) s = Math.min(s, 4.9);
        return { score: score(s), detail };
    }

    // ---- the assessment ---------------------------------------------------------------------------

    /** The page's own work first: the window that asked is still opening. */
    function idle() {
        return new Promise((resolve) => {
            if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(() => resolve(), { timeout: 1500 });
            else setTimeout(resolve, 500);
        });
    }

    function features(doc) {
        const css = root.CSS;
        const supports = (p, v) => !!(css && typeof css.supports === 'function' && css.supports(p, v));
        return {
            backdropFilter: supports('backdrop-filter', 'blur(2px)') || supports('-webkit-backdrop-filter', 'blur(2px)'),
            webgpu: !!(root.navigator && root.navigator.gpu)
        };
    }

    function combine(parts) {
        const scores = {};
        const details = {};
        Object.keys(parts).forEach((k) => {
            scores[k] = parts[k].score;
            details[k] = parts[k].detail;
        });
        const rated = Object.values(scores).filter((v) => typeof v === 'number');
        const base = rated.length ? Math.min(...rated) : null;
        return { version: VERSION, base, scores, details, assessedAt: new Date().toISOString() };
    }

    function cached() {
        try {
            const raw = root.sessionStorage && root.sessionStorage.getItem(STORAGE_KEY);
            const v = raw ? JSON.parse(raw) : null;
            return v && v.version === VERSION && typeof v.base === 'number' ? v : null;
        } catch (_) {
            return null;
        }
    }

    function assess(opts = {}) {
        if (!opts.fresh) {
            const hit = cached();
            if (hit) return Promise.resolve(hit);
        }
        if (inflight) return inflight;
        inflight = (async () => {
            const nav = root.navigator || null;
            const doc = root.document || null;
            const hiddenAtStart = !!(doc && doc.hidden);
            // frames once the page has settled (the window that asked is still animating open),
            // then the processor rounds, which block the thread
            await idle();
            await new Promise((resolve) => setTimeout(resolve, 600));
            const [gaps, disk] = await Promise.all([sampleFrames(700), diskScore(nav)]);
            await idle();
            // the first round warms the JIT; the best round is the processor's
            let rate = cpuRound(10);
            for (let i = 0; i < 5; i++) rate = Math.max(rate, cpuRound(20));
            const graphics = graphicsScore(probeWebGL(doc), features(doc));
            const result = combine({
                processor: processorScore(nav, rate),
                memory: memoryScore(nav),
                graphics,
                gaming: gamingScore(gaps, { ...graphics.detail, score: graphics.score }),
                disk
            });
            try {
                const hidden = hiddenAtStart || !!(doc && doc.hidden);
                if (root.sessionStorage && result.base !== null && !hidden) root.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
            } catch (_) {
                /* blocked storage: assess again next time */
            }
            return result;
        })().finally(() => { inflight = null; });
        return inflight;
    }

    const api = {
        assess,
        cached,
        _test: { score, logScale, processorScore, memoryScore, graphicsScore, gamingScore, diskScore, combine }
    };
    root.meletonExperienceIndex = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
