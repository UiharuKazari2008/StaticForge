/**
 * Glancewell's slide show themes: Windows Photo Gallery's 14 (Yozora #446; Yukimi, Nov 20 2026: all of them).
 *
 *   Classic, Fade, Black and white, Sepia     PhotoClassic.dll: the picture fitted on black; Fade and the tinted ones
 *                                              cross-fade, Classic cuts
 *   Pan and zoom                              PhotoCinematic.dll CINEMATICTHEME.XML: each picture drifts and zooms for
 *                                              its aspect class's EffectLength (s) at the chosen speed, half cross-fades
 *   Voyager, Album, Collage, Spin, Flow,      PhotoVoyager.dll's 3D themes, played from their own scene files
 *   Frame, Glass, Stack, Travel               (static_images/vista-photo-gallery/slideshow/<theme>.json, converted from
 *                                              <THEME>.XML): a path of picture groups and transitions; each group's
 *                                              scenes hold (Layout) or move (Motion) a camera over the background plane,
 *                                              its pictures in the slots of the layout pages that fit their shapes
 *
 * The VM's VMware display only runs Vista's basic show, so the 3D themes are rendered from their definitions: a
 * Direct3D left-handed look-at camera with a 45 degree vertical field of view (that framing matches every theme's
 * background rectangle), each quad projected and drawn with a CSS matrix3d (compositor work only; the rAF loop runs
 * only while something moves and stops when the page is hidden).
 *
 *   window.glancewellThemes = {
 *     THEMES, theme(), setTheme(id),
 *     start({ host, slides: [{ src, width, height }], index, speed, shuffle, loop, onIndex(i), onExit() }),
 *     stop() -> index, active(), play(), pause(), next(), back(), setSpeed(s), playing()
 *   }
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const ART = '/static_images/vista-photo-gallery';
    const DATA = `${ART}/slideshow`;
    const THEME_KEY = 'glancewellSlideShowTheme';
    const SPEED_MS = { slow: 10000, medium: 5000, fast: 3000 };
    const SPEED_INDEX = { slow: 0, medium: 1, fast: 2 };
    const FADE_MS = 1000;
    const BAR_IDLE_MS = 3000;
    const FOV = 45 * Math.PI / 180;

    // PhotoClassic / PhotoCinematic / PhotoVoyager .mui strings, in Vista's Themes list order
    const THEMES = [
        { id: 'classic', name: 'Classic', kind: 'flat', fade: false },
        { id: 'fade', name: 'Fade', kind: 'flat', fade: true },
        { id: 'bw', name: 'Black and white', kind: 'flat', fade: true, filter: 'grayscale(1)' },
        { id: 'sepia', name: 'Sepia', kind: 'flat', fade: true, filter: 'sepia(0.9)' },
        { id: 'panzoom', name: 'Pan and zoom', kind: 'panzoom' },
        { id: 'voyager', name: 'Voyager', kind: '3d' },
        { id: 'album', name: 'Album', kind: '3d' },
        { id: 'collage', name: 'Collage', kind: '3d' },
        { id: 'spin', name: 'Spin', kind: '3d' },
        { id: 'flow', name: 'Flow', kind: '3d' },
        { id: 'frame', name: 'Frame', kind: '3d' },
        { id: 'glass', name: 'Glass', kind: '3d' },
        { id: 'stack', name: 'Stack', kind: '3d' },
        { id: 'travel', name: 'Travel', kind: '3d' }
    ];

    // CINEMATICTHEME.XML: aspect classes and their FullScreen Slow / Medium / Fast (Zoom, PanZoom, EffectLength s)
    const PANZOOM = [
        { upTo: 0.5, zoom: 0.2, len: [60, 40, 20] },
        { upTo: 1, zoom: 0.2, len: [18, 14, 8] },
        { upTo: 2, zoom: 0.1, len: [15, 12, 6] },
        { upTo: 3.5, zoom: 0.2, len: [50, 35, 20] },
        { upTo: Infinity, zoom: 0.2, len: [90, 75, 40] }
    ];

    const S = {
        on: false, host: null, layer: null, slides: [], index: 0, speed: 'medium', shuffle: false, loop: true,
        playing: true, timer: 0, raf: 0, onIndex: null, onExit: null, run: 0, theme: null, data: new Map(), bar: null, barTimer: 0
    };

    const theme = () => { try { return root.localStorage.getItem(THEME_KEY) || 'classic'; } catch (_) { return 'classic'; } };
    const themeDef = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

    // ------------------------------------------------------------------ pictures

    const cache = new Map();
    function picture(i) {
        const s = S.slides[((i % S.slides.length) + S.slides.length) % S.slides.length];
        if (!s) return Promise.reject(new Error('none'));
        if (cache.has(s.src)) return cache.get(s.src);
        const p = new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('load'));
            img.src = s.src;
        });
        cache.set(s.src, p);
        if (cache.size > 24) cache.delete(cache.keys().next().value);
        return p;
    }

    function nextIndex(step) {
        const n = S.slides.length;
        if (S.shuffle && step > 0 && n > 2) {
            let j = Math.floor(Math.random() * (n - 1));
            if (j >= S.index) j += 1;
            return j;
        }
        const j = S.index + step;
        if (j >= n || j < 0) return S.loop ? (j + n) % n : -1;
        return j;
    }

    function setIndex(i) {
        S.index = i;
        if (S.onIndex) try { S.onIndex(i); } catch (_) { /* closed */ }
    }

    // ------------------------------------------------------------------ flat themes and Pan and zoom

    function flatFrame(img, def) {
        const W = S.layer.clientWidth; const H = S.layer.clientHeight;
        const k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
        const el = doc.createElement('div');
        el.className = 'wpg-theme-pic';
        const im = img.cloneNode();
        im.style.width = `${Math.round(img.naturalWidth * k)}px`;
        im.style.height = `${Math.round(img.naturalHeight * k)}px`;
        if (def.filter) im.style.filter = def.filter;
        el.appendChild(im);
        return el;
    }

    async function showFlat(i, run) {
        const def = themeDef(S.theme);
        let img;
        try { img = await picture(i); } catch (_) { img = null; }
        if (run !== S.run) return;
        const prev = S.layer.querySelector('.wpg-theme-pic:last-child');
        const el = img ? flatFrame(img, def) : doc.createElement('div');
        el.classList.add('wpg-theme-pic');
        if (def.kind === 'panzoom' && img) startPanZoom(el, img);
        if (def.fade || def.kind === 'panzoom') {
            el.style.opacity = '0';
            S.layer.appendChild(el);
            const ms = def.kind === 'panzoom' ? FADE_MS / 2 : FADE_MS; // HalfCrossFade
            el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, fill: 'forwards', easing: 'linear' });
            if (prev) prev.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }).finished.then(() => prev.remove(), () => prev.remove());
        } else {
            S.layer.appendChild(el);
            if (prev) prev.remove();
        }
        setIndex(i);
        // the next picture is fetched while this one shows
        void picture(nextIndex(1)).catch(() => {});
        schedule(def.kind === 'panzoom' && img ? panZoomLength(img) : SPEED_MS[S.speed]);
    }

    function panZoomClass(img) {
        const r = img.naturalWidth / img.naturalHeight;
        return PANZOOM.find((c) => r <= c.upTo);
    }
    const panZoomLength = (img) => panZoomClass(img).len[SPEED_INDEX[S.speed]] * 1000;

    /** Pan and zoom: from one framing to another, zoomed in by the class's Zoom, panned across what is left. */
    function startPanZoom(el, img) {
        const c = panZoomClass(img);
        const z = 1 + c.zoom;
        const inward = Math.random() < 0.5;
        const dx = (Math.random() - 0.5) * c.zoom * 50;
        const dy = (Math.random() - 0.5) * c.zoom * 50;
        const a = { transform: 'scale(1) translate(0, 0)' };
        const b = { transform: `scale(${z}) translate(${dx.toFixed(2)}%, ${dy.toFixed(2)}%)` };
        el.firstChild.animate(inward ? [a, b] : [b, a], { duration: panZoomLength(img) + FADE_MS, fill: 'forwards', easing: 'linear' });
    }

    function schedule(ms) {
        clearTimeout(S.timer);
        if (!S.playing) return;
        S.timer = setTimeout(() => advance(1), ms);
    }

    function advance(step) {
        if (!S.on) return;
        const def = themeDef(S.theme);
        if (def.kind === '3d') { voyager.skip(step); return; }
        const j = nextIndex(step);
        if (j < 0) { S.playing = false; syncBar(); return; }
        S.run++;
        void showFlat(j, S.run);
    }

    // ------------------------------------------------------------------ the 3D themes

    const v3 = {
        sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
        dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
        cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
        norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
        lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    };
    const ease = (t) => t * t * (3 - 2 * t);

    /** D3DXMatrixLookAtLH + a 45 degree perspective: world point -> screen pixels (or null behind the camera). */
    function projector(cam, W, H) {
        const z = v3.norm(v3.sub(cam.t, cam.p));
        const x = v3.norm(v3.cross(cam.u, z));
        const y = v3.cross(z, x);
        const f = 1 / Math.tan(FOV / 2);
        const aspect = W / H;
        return (P) => {
            const d = v3.sub(P, cam.p);
            const cz = v3.dot(z, d);
            if (cz <= 1e-6) return null;
            const sx = (v3.dot(x, d) / cz) * (f / aspect);
            const sy = (v3.dot(y, d) / cz) * f;
            return [(sx + 1) / 2 * W, (1 - sy) / 2 * H];
        };
    }

    /** The CSS matrix3d that maps a w x h box onto the quad tl, tr, bl, br (a projective map, exact for planes). */
    function quadMatrix(w, h, tl, tr, bl, br) {
        const [x0, y0] = tl; const [x1, y1] = tr; const [x2, y2] = bl; const [x3, y3] = br;
        const dx1 = x1 - x3; const dx2 = x2 - x3; const dx3 = x0 - x1 + x3 - x2;
        const dy1 = y1 - y3; const dy2 = y2 - y3; const dy3 = y0 - y1 + y3 - y2;
        const det = dx1 * dy2 - dx2 * dy1 || 1e-9;
        const g = (dx3 * dy2 - dx2 * dy3) / det;
        const hh = (dx1 * dy3 - dx3 * dy1) / det;
        const a = x1 - x0 + g * x1; const b = x2 - x0 + hh * x2;
        const d = y1 - y0 + g * y1; const e = y2 - y0 + hh * y2;
        // unit square -> quad, then scaled for the element's own size
        const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
        return `matrix3d(${m.map((n) => +n.toFixed(8)).join(',')})`;
    }

    function place(el, w, h, pts) {
        if (pts.some((p) => !p)) { el.style.visibility = 'hidden'; return; }
        el.style.visibility = '';
        el.style.transform = quadMatrix(w, h, pts[0], pts[1], pts[2], pts[3]);
    }

    const flipX = (q, flip) => (flip ? [1 - q[0], q[1], q[2]] : q);
    function flipQuad(q, flip) {
        if (!flip) return q;
        // a mirrored group: left and right swap so the picture is not drawn mirrored
        const m = q.map((p) => flipX(p, true));
        return [m[1], m[0], m[3], m[2]];
    }
    const flipCam = (c, flip) => (flip ? { p: flipX(c.p, true), t: flipX(c.t, true), u: [-c.u[0], c.u[1], c.u[2]] } : c);

    function camAt(scene, t) {
        if (scene.camKeys && scene.camKeys.length) {
            const k = scene.camKeys;
            if (t <= k[0].time) return k[0];
            for (let i = 1; i < k.length; i++) {
                if (t <= k[i].time) {
                    const u = ease((t - k[i - 1].time) / ((k[i].time - k[i - 1].time) || 1));
                    return { p: v3.lerp(k[i - 1].p, k[i].p, u), t: v3.lerp(k[i - 1].t, k[i].t, u), u: v3.norm(v3.lerp(k[i - 1].u, k[i].u, u)) };
                }
            }
            return k[k.length - 1];
        }
        return scene.cam;
    }

    function slotAt(slot, t) {
        if (!slot.keys) return { q: slot.q, a: slot.a };
        const k = slot.keys;
        if (t <= k[0].time) return { q: k[0].q, a: k[0].a };
        for (let i = 1; i < k.length; i++) {
            if (t <= k[i].time) {
                const u = ease((t - k[i - 1].time) / ((k[i].time - k[i - 1].time) || 1));
                return { q: k[i - 1].q.map((p, j) => v3.lerp(p, k[i].q[j], u)), a: k[i - 1].a + (k[i].a - k[i - 1].a) * u };
            }
        }
        return { q: k[k.length - 1].q, a: k[k.length - 1].a };
    }

    const shapeOf = (img) => (img && img.naturalHeight > img.naturalWidth ? 'Portrait' : 'Landscape');
    const fits = (slotType, img) => !slotType || slotType === 'Any' || slotType === shapeOf(img);

    /** The page of a layout set for the pictures from `from`: the most slots the pictures fill, in matching shapes. */
    function choosePage(set, imgs, from) {
        let best = -1; let bestN = -1;
        set.forEach((page, i) => {
            const n = page.length;
            if (n > imgs.length - from) return;
            const ok = page.every((s, k) => fits(s.type, imgs[from + k]));
            if (ok && n > bestN) { best = i; bestN = n; }
        });
        if (best < 0) set.forEach((page, i) => { if (page.length <= imgs.length - from && page.length > bestN) { best = i; bestN = page.length; } });
        return best < 0 ? 0 : best;
    }

    const voyager = {
        step: 0,          // where in the theme's path
        skipTo: null,
        async run(run) {
            const data = await loadTheme(S.theme);
            if (!data || run !== S.run) return;
            const W = () => S.layer.clientWidth; const H = () => S.layer.clientHeight;
            const path = data.path.filter((p) => p.group);
            while (S.on && run === S.run) {
                const pg = path[this.step % path.length];
                const g = data.groups[pg.group];
                const n = Math.min(g.total, S.slides.length);
                // this group's pictures, from the current index on
                const order = [];
                let at = S.index;
                for (let k = 0; k < n; k++) { order.push(at); const j = nextIndex(1); at = j < 0 ? at : j; S.index = at; }
                S.index = order[0];
                const imgs = (await Promise.all(order.map((i) => picture(i).catch(() => null))));
                if (run !== S.run) return;
                const layer = this.buildGroup(pg, g, imgs, data);
                const old = S.layer.querySelector('.wpg-theme-3d.is-current');
                layer.classList.add('is-current');
                S.layer.appendChild(layer);
                const tr = data.transitions[(data.path.find((p) => p.transition) || {}).transition] || { kind: 'fade', ms: [2000, 2000, 2000] };
                const tms = tr.ms[SPEED_INDEX[S.speed]];
                layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: old ? tms : FADE_MS, fill: 'forwards' });
                if (old) {
                    old.classList.remove('is-current');
                    // Page Curl (Voyager): the old page lifts away from its lower left corner
                    const frames = tr.kind === 'curl'
                        ? [{ transform: 'none', opacity: 1 }, { transform: 'perspective(1600px) rotateY(-55deg) rotateZ(-12deg) translate(-30%, -20%)', opacity: 0 }]
                        : [{ opacity: 1 }, { opacity: 0 }];
                    old.style.transformOrigin = '0 100%';
                    old.animate(frames, { duration: tms, fill: 'forwards', easing: 'ease-in' }).finished.then(() => old.remove(), () => old.remove());
                }
                setIndex(order[0]);
                for (let si = 0; si < g.scenes.length && S.on && run === S.run; si++) {
                    const sc = g.scenes[si];
                    const ms = sc.ms[SPEED_INDEX[S.speed]];
                    if (sc.start - 1 < order.length) setIndex(order[Math.min(order.length - 1, sc.start - 1)]);
                    const ok = await this.playScene(layer, pg, g, sc, imgs, ms, run, W, H);
                    if (!ok) break;
                }
                if (run !== S.run) return;
                // the next group starts after this one's pictures
                const j = nextIndex(1);
                if (j < 0 && !S.loop) { S.playing = false; syncBar(); return; }
                S.index = order[order.length - 1];
                setIndex(nextIndex(1) < 0 ? order[0] : nextIndex(1));
                this.step++;
            }
        },
        buildGroup(pg, g, imgs, data) {
            const layer = doc.createElement('div');
            layer.className = 'wpg-theme-3d';
            const bg = doc.createElement('div');
            bg.className = 'wpg-theme-bg';
            if (pg.bg) {
                bg.style.backgroundImage = `url("${DATA}/${pg.bg}")`;
                bg.style.backgroundSize = `${100 / (pg.tile || 1)}% ${100 / (pg.tile || 1)}%`;
                if (pg.flip) bg.classList.add('is-flipped');
            }
            layer.appendChild(bg);
            layer._bg = bg;
            layer._pics = [];
            const [r, gg, b, a] = pg.borderColor || [255, 255, 255, 255];
            imgs.forEach((img) => {
                const el = doc.createElement('div');
                el.className = 'wpg-theme-slot';
                el.style.background = `rgba(${r},${gg},${b},${(a / 255).toFixed(3)})`;
                el.style.padding = `${pg.border[1]}% ${pg.border[0]}%`;
                if (img) { const im = img.cloneNode(); el.appendChild(im); }
                el.style.visibility = 'hidden';
                if (data.shadows) el.classList.add('has-shadow');
                layer.appendChild(el);
                layer._pics.push(el);
            });
            return layer;
        },
        playScene(layer, pg, g, sc, imgs, ms, run, W, H) {
            return new Promise((resolve) => {
                // the slots this scene shows: its layout sets' chosen pages, numbered on from its start index
                const slots = [];
                let k = sc.start - 1;
                for (const name of sc.pages) {
                    const set = g.pages[name];
                    if (!set || !set.length) continue;
                    const page = set[choosePage(set, imgs, k)] || [];
                    page.forEach((s) => { if (k < imgs.length) slots.push({ s, pic: k }); k++; });
                }
                const BW = 1000; const BH = 1000;
                const draw = (t) => {
                    const cam = flipCam(camAt(sc, t), pg.flip);
                    const proj = projector(cam, W(), H());
                    const [x0, y0, x1, y1] = pg.bgRect;
                    const bq = flipQuad([[x0, y0, 0], [x1, y0, 0], [x0, y1, 0], [x1, y1, 0]], false);
                    place(layer._bg, BW, BH, bq.map(proj));
                    const shown = new Set();
                    slots.forEach(({ s, pic }) => {
                        const el = layer._pics[pic];
                        if (!el) return;
                        const at = slotAt(s, t);
                        const q = flipQuad(at.q, pg.flip);
                        place(el, BW, BH, q.map(proj));
                        // the scene files write alpha 0..1; a slot without one is opaque (255 in the converted files)
                        el.style.opacity = String(Math.max(0, Math.min(1, at.a > 1 ? at.a / 255 : at.a)));
                        el.style.zIndex = String(Math.round(1000 + q[0][2] * 100000));
                        shown.add(el);
                    });
                    layer._pics.forEach((el) => { if (!shown.has(el)) el.style.visibility = 'hidden'; });
                };
                const moving = sc.type === 'Motion' || sc.camKeys;
                const t0 = performance.now();
                const done = () => { cancelAnimationFrame(S.raf); clearTimeout(S.timer); resolve(run === S.run); };
                if (!moving) {
                    draw(1);
                    if (!S.playing) { S.resume = () => { S.resume = null; S.timer = setTimeout(done, ms); }; return; }
                    S.timer = setTimeout(done, ms);
                    return;
                }
                let pausedAt = 0; let shift = 0;
                const tick = (now) => {
                    if (run !== S.run) { resolve(false); return; }
                    if (!S.playing) { if (!pausedAt) pausedAt = now; S.raf = requestAnimationFrame(tick); return; }
                    if (pausedAt) { shift += now - pausedAt; pausedAt = 0; }
                    const t = Math.min(1, (now - t0 - shift) / ms);
                    draw(t);
                    if (t >= 1 || doc.hidden) { done(); return; }
                    S.raf = requestAnimationFrame(tick);
                };
                draw(0);
                S.raf = requestAnimationFrame(tick);
            });
        },
        skip(step) {
            // Next / Back in a 3D theme: the next group (or this one again from the picture before)
            cancelAnimationFrame(S.raf);
            clearTimeout(S.timer);
            if (step < 0) { S.index = nextIndex(-1) < 0 ? S.index : nextIndex(-1); this.step = Math.max(0, this.step - 1); }
            else this.step++;
            S.run++;
            void this.run(S.run);
        }
    };

    async function loadTheme(id) {
        if (S.data.has(id)) return S.data.get(id);
        try {
            const r = await fetch(`${DATA}/${id}.json`, { credentials: 'same-origin' });
            const d = await r.json();
            S.data.set(id, d);
            return d;
        } catch (_) { return null; }
    }

    // ------------------------------------------------------------------ the control bar (PhotoViewer PNG 11004-11023)

    function buildBar() {
        const bar = doc.createElement('div');
        bar.className = 'wpg-theme-bar';
        bar.innerHTML = '<button type="button" class="wpg-theme-themes">Themes<span class="wpg-theme-drop"></span></button><span class="wpg-theme-sep"></span>' +
            '<button type="button" class="wpg-theme-prev" title="Previous"></button><button type="button" class="wpg-theme-play" title="Pause"></button><button type="button" class="wpg-theme-next" title="Next"></button>' +
            '<span class="wpg-theme-sep"></span><button type="button" class="wpg-theme-gear" title="Settings"></button><span class="wpg-theme-sep"></span><button type="button" class="wpg-theme-exit">Exit</button>';
        bar.querySelector('.wpg-theme-prev').addEventListener('click', () => api.back());
        bar.querySelector('.wpg-theme-next').addEventListener('click', () => api.next());
        bar.querySelector('.wpg-theme-play').addEventListener('click', () => (S.playing ? api.pause() : api.play()));
        bar.querySelector('.wpg-theme-exit').addEventListener('click', () => { if (S.onExit) S.onExit(); });
        const cm = root.contextMenu;
        if (cm) {
            cm.attachClickMenuToElement(bar.querySelector('.wpg-theme-themes'), {
                sections: [],
                beforeShow: function () { this.sections = [{ type: 'list', items: THEMES.map((t) => ({ text: t.name, action: `gws-theme-${t.id}`, checked: S.theme === t.id, showIndicator: true, indicatorMark: 'radio' })) }]; },
                onAction: (a) => { const id = String(a).replace('gws-theme-', ''); if (themeDef(id).id === id) api.setTheme(id); }
            });
            cm.attachClickMenuToElement(bar.querySelector('.wpg-theme-gear'), {
                sections: [],
                beforeShow: function () {
                    const sp = (k, t) => ({ text: `Slide Show Speed - ${t}`, action: `gws-speed-${k}`, checked: S.speed === k, showIndicator: true, indicatorMark: 'radio' });
                    this.sections = [{ type: 'list', items: [sp('slow', 'Slow'), sp('medium', 'Medium'), sp('fast', 'Fast'), { separator: true },
                        { text: 'Shuffle', action: 'gws-shuffle', checked: S.shuffle, showIndicator: true }, { text: 'Loop', action: 'gws-loop', checked: S.loop, showIndicator: true }] }];
                },
                onAction: (a) => {
                    if (/^gws-speed-/.test(a)) api.setSpeed(a.slice(10));
                    else if (a === 'gws-shuffle') { S.shuffle = !S.shuffle; if (S.onOption) S.onOption('shuffle', S.shuffle); }
                    else if (a === 'gws-loop') { S.loop = !S.loop; if (S.onOption) S.onOption('loop', S.loop); }
                }
            });
        }
        return bar;
    }

    function syncBar() {
        if (!S.bar) return;
        const b = S.bar.querySelector('.wpg-theme-play');
        b.classList.toggle('is-paused', !S.playing);
        b.title = S.playing ? 'Pause' : 'Play';
    }

    function wakeBar() {
        if (!S.bar) return;
        S.bar.classList.add('is-shown');
        clearTimeout(S.barTimer);
        S.barTimer = setTimeout(() => { if (S.bar && !S.bar.matches(':hover')) S.bar.classList.remove('is-shown'); }, BAR_IDLE_MS);
    }

    // ------------------------------------------------------------------ public

    function begin() {
        S.run++;
        cancelAnimationFrame(S.raf);
        clearTimeout(S.timer);
        S.layer.replaceChildren();
        const def = themeDef(S.theme);
        if (def.kind === '3d') { voyager.step = 0; void voyager.run(S.run); }
        else void showFlat(S.index, S.run);
    }

    const api = {
        THEMES,
        theme,
        setTheme(id) {
            try { root.localStorage.setItem(THEME_KEY, id); } catch (_) { /* full */ }
            if (!S.on) return;
            S.theme = id;
            begin();
        },
        start(o) {
            if (S.on) api.stop();
            S.on = true;
            S.host = o.host;
            S.slides = (o.slides || []).filter((s) => s && s.src);
            S.index = Math.max(0, Math.min(S.slides.length - 1, o.index || 0));
            S.speed = o.speed || 'medium';
            S.shuffle = !!o.shuffle;
            S.loop = o.loop !== false;
            S.playing = true;
            S.onIndex = o.onIndex || null;
            S.onExit = o.onExit || null;
            S.onOption = o.onOption || null;
            S.theme = theme();
            S.layer = doc.createElement('div');
            S.layer.className = 'wpg-theme';
            S.bar = buildBar();
            S.host.append(S.layer, S.bar);
            S.wake = () => wakeBar();
            S.host.addEventListener('pointermove', S.wake);
            syncBar();
            wakeBar();
            begin();
        },
        stop() {
            if (!S.on) return S.index;
            S.on = false;
            S.run++;
            cancelAnimationFrame(S.raf);
            clearTimeout(S.timer);
            clearTimeout(S.barTimer);
            if (S.host && S.wake) S.host.removeEventListener('pointermove', S.wake);
            if (S.layer) S.layer.remove();
            if (S.bar) S.bar.remove();
            S.layer = null; S.bar = null; S.host = null;
            cache.clear();
            return S.index;
        },
        active: () => S.on,
        playing: () => S.playing,
        play() {
            if (!S.on) return;
            S.playing = true;
            syncBar();
            if (themeDef(S.theme).kind === '3d') { if (S.resume) S.resume(); }
            else schedule(SPEED_MS[S.speed]);
        },
        pause() {
            if (!S.on) return;
            S.playing = false;
            if (themeDef(S.theme).kind !== '3d') clearTimeout(S.timer);
            syncBar();
        },
        next() { if (S.on) advance(1); },
        back() { if (S.on) advance(-1); },
        setSpeed(s) {
            if (!SPEED_MS[s]) return;
            S.speed = s;
            if (S.onOption) S.onOption('speed', s);
            if (S.on && themeDef(S.theme).kind !== '3d') schedule(SPEED_MS[s]);
        }
    };

    root.glancewellThemes = api;
})(typeof window !== 'undefined' ? window : globalThis);
