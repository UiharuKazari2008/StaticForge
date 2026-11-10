/**
 * Melaton Mobile: Teleport (Yozora #732). The desktop's Teleport (planetSwitcher.js) is a tilted ring
 * of glass planet bubbles, one per workspace, over a star field: tap a planet to centre it, tap the
 * centred one to travel (it pulses while the workspace loads, then the view zooms into it and fades
 * to black). Yukimi, Nov 10: the phone keeps that behaviour, drawn as an early-2009 phone 3D UI.
 *
 * Here: a black star field (canvas, ~30 fps, drifting toward the viewer, warp on travel) with a 3D
 * carousel of glossy planet orbs (CSS 3D, perspective) standing on a mirrored floor. Each orb shows
 * its workspace's pictures as a slow cross-fade (the desktop's samples: wsClient
 * .getWorkspacePreviewSamples, the wallpaper as fallback), ringed in the workspace colour, with a
 * specular highlight and a floor reflection. Flick spins the carousel with momentum and snaps to a
 * planet (kinetic, as 2009 touch UIs did); a tap on a side planet centres it; a tap on the centred
 * planet, Enter or the left soft key (Teleport) travels: setActiveWorkspace (the desktop's own
 * switch) while the orb pulses (the WM wait cursor joins after 1.5 s), then zoom + fade to Today.
 * The name, picture count and "Current workspace" sit under the ring with page dots. The desktop's
 * music (innerlight) plays under it at the tab's volume unless muted.
 *
 * Every desktop route to the planet switcher (Start menu, power menu, Run 'teleport') opens this app;
 * Programs lists it in place of the desktop's Teleport (wmPrograms.js MAPPED). All art is drawn here
 * (no third-party skin). Only on phones. Styles: public/css/wm-host.css (.wm-teleport).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'teleport';
    const TAU = Math.PI * 2;
    const MAX_STEP = Math.PI / 2.6; // as the desktop ring: an arc when there are few planets
    const SLIDE_MS = 6800;
    const BGM = { url: '/sounds/planet/innerlight.opus', gain: 0.48, fade: 480 };

    let ws = null;
    let page = null;
    let els = null; // { stage, ring, caption, name, count, note, dots, fade, stars }
    let planets = []; // [{ ws, el, orb, imgs: [a, b], images: [], slide, top, nextAt }]
    let pos = 0; // carousel position (planet index, fractional while moving)
    let vel = 0; // planets per ms
    let anim = null; // rAF / timer id of the motion loop
    let target = null; // snap target index
    let drag = null; // { x, y, pos, t, moved, samples }
    let traveling = false;
    let shown = false;
    let metrics = { size: 120, radius: 150, step: 0, full: false };
    let loadGen = 0;
    let slideTimer = null;
    let audio = null;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const now = () => performance.now();
    const raf = (fn) => (document.hidden ? setTimeout(fn, 16) : requestAnimationFrame(fn));

    function workspaceList() {
        try {
            /* global workspaces */
            if (typeof workspaces === 'undefined' || !workspaces) return [];
            return Object.values(workspaces).filter(Boolean)
                .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)));
        } catch (_) { return []; }
    }

    function activeId() {
        try {
            /* global activeWorkspace */
            return typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
        } catch (_) { return null; }
    }

    const count = () => planets.length;
    const wrapIndex = (i) => { const n = count(); return n ? ((Math.round(i) % n) + n) % n : 0; };
    const centred = () => (metrics.full ? wrapIndex(pos) : Math.max(0, Math.min(count() - 1, Math.round(pos))));

    function formatCount(n) {
        n = Number(n);
        if (!Number.isFinite(n) || n < 0) return '';
        return n === 1 ? '1 picture' : `${n.toLocaleString()} pictures`;
    }

    // ---------------------------------------------------------------- build

    function build() {
        const list = workspaceList();
        const cur = activeId();
        page.innerHTML = `
            <canvas class="wmt-stars" aria-hidden="true"></canvas>
            <div class="wmt-floor" aria-hidden="true"></div>
            <div class="wmt-stage"><div class="wmt-ring" role="listbox" aria-label="Workspaces"></div></div>
            <div class="wmt-caption" aria-live="polite">
                <div class="wmt-name"></div>
                <div class="wmt-count"></div>
                <div class="wmt-note"></div>
                <div class="wmt-dots" aria-hidden="true"></div>
            </div>
            <div class="wmt-fade" aria-hidden="true"></div>`;
        els = {
            stage: page.querySelector('.wmt-stage'),
            ring: page.querySelector('.wmt-ring'),
            name: page.querySelector('.wmt-name'),
            count: page.querySelector('.wmt-count'),
            note: page.querySelector('.wmt-note'),
            dots: page.querySelector('.wmt-dots'),
            fade: page.querySelector('.wmt-fade'),
            stars: page.querySelector('.wmt-stars')
        };
        planets = list.map((w, i) => {
            const el = document.createElement('div');
            el.className = `wmt-planet${w.id === cur ? ' is-current' : ''}`;
            el.dataset.i = String(i);
            el.setAttribute('role', 'option');
            el.setAttribute('aria-label', w.name || w.id);
            el.style.setProperty('--wmt-color', typeof w.color === 'string' && w.color ? w.color : '#6a7bd8');
            el.innerHTML = '<div class="wmt-orb"><img class="wmt-slide" alt="" draggable="false"><img class="wmt-slide" alt="" draggable="false"><span class="wmt-shade"></span><span class="wmt-gloss"></span></div>';
            els.ring.appendChild(el);
            const imgs = [...el.querySelectorAll('.wmt-slide')];
            return { ws: w, el, orb: el.querySelector('.wmt-orb'), imgs, images: [], slide: 0, top: 0, nextAt: now() + 1500 + i * 450, imageCount: w.fileCount };
        });
        els.dots.innerHTML = planets.map(() => '<span></span>').join('');
        if (!planets.length) els.name.textContent = 'No workspaces';
        const at = planets.findIndex((p) => p.ws.id === cur);
        pos = at >= 0 ? at : 0;
        target = null;
        vel = 0;
        measure();
        layout();
        paintCaption();
        loadSamples();
    }

    function measure() {
        const r = page.getBoundingClientRect();
        const w = r.width || 320;
        const h = r.height || 400;
        const n = count();
        let step = n <= 1 ? 0 : Math.min(TAU / n, MAX_STEP);
        let full = n > 1 && TAU / n <= MAX_STEP + 1e-9;
        // portrait turns the ring top to bottom (Yukimi: there is more room up and down); landscape
        // keeps it side to side over the floor
        const vertical = h > w * 1.1;
        const size = Math.round(Math.max(64, vertical ? Math.min(w * 0.44, h * 0.23) : Math.min(w * 0.44, h * 0.42)));
        // the ring's depth: the side planets sit about a half orb outside the centred one
        let radius = full ? Math.max(size * 1.1, (size * 0.82) / Math.sin(step)) : size * 1.5;
        if (vertical && n > 1) {
            // a wide ring seen in part (Yukimi): planets spaced apart along a big arc that runs off
            // the top and bottom of the screen; a full ring only when there are enough planets
            const spacing = size * 1.12;
            // five or more planets close the ring (it wraps, as on the desktop); fewer sit on an arc
            full = n >= 5;
            radius = full ? Math.max(h * 0.5, (n * spacing) / TAU) : Math.max(h * 0.8, size * 2);
            step = full ? TAU / n : 2 * Math.asin(Math.min(1, spacing / (2 * radius)));
        }
        metrics = { size, radius: vertical ? radius : Math.min(radius, size * 4), step, full, w, h, vertical };
        page.style.setProperty('--wmt-size', `${size}px`);
        page.classList.toggle('is-vertical', vertical);
    }

    /** Place every planet for the current position (only transforms and opacity change). */
    function layout() {
        const { step, radius, full, vertical } = metrics;
        const n = count();
        for (let i = 0; i < n; i++) {
            let d = i - pos;
            if (full) d = ((d % n) + n + n / 2) % n - n / 2; // shortest way round
            const a = d * step;
            const z = (Math.cos(a) - 1) * radius;
            // a tilted ring, as on the desktop: the far side rises (sideways ring) or leans right
            // (upright ring), so the wheel reads in depth
            const x = vertical ? -z * 0.6 - metrics.size * 0.18 : Math.sin(a) * radius;
            const y = vertical ? Math.sin(a) * radius : z * 0.2;
            const facing = Math.cos(a);
            const p = planets[i];
            const visible = facing > (vertical ? 0.2 : -0.2) && Math.abs(a) < Math.PI * 0.75;
            p.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px)`;
            p.el.style.opacity = visible ? String(Math.max(0, Math.min(1, 0.25 + 0.75 * facing))).slice(0, 5) : '0';
            p.el.style.zIndex = String(Math.round(1000 + z));
            p.el.style.visibility = visible ? 'visible' : 'hidden';
            p.el.classList.toggle('is-centred', Math.abs(d) < 0.5);
        }
    }

    function paintCaption() {
        if (!planets.length) return;
        const i = centred();
        const p = planets[i];
        els.name.textContent = p.ws.name || p.ws.id;
        els.count.textContent = formatCount(p.imageCount);
        els.note.textContent = p.ws.id === activeId() ? 'Current workspace' : '';
        [...els.dots.children].forEach((d, k) => d.classList.toggle('is-on', k === i));
        planets.forEach((q, k) => q.el.setAttribute('aria-selected', k === i ? 'true' : 'false'));
    }

    // ---------------------------------------------------------------- motion

    function startLoop() {
        if (anim) return;
        let last = now();
        const tick = () => {
            anim = null;
            const t = now();
            const dt = Math.min(48, t - last);
            last = t;
            if (!drag) {
                if (target != null) {
                    // ease out to the snap target
                    vel = 0;
                    pos += (target - pos) * (1 - Math.pow(0.8, dt / 16));
                    if (Math.abs(target - pos) < 0.002) { pos = target; target = null; settle(); }
                } else if (Math.abs(vel) > 0.00005) {
                    pos += vel * dt;
                    vel *= Math.pow(0.9955, dt); // friction
                    if (!metrics.full) {
                        const lo = -0.35;
                        const hi = count() - 0.65;
                        if (pos < lo || pos > hi) vel *= 0.6;
                    }
                    if (Math.abs(vel) < 0.0006) snapTo(Math.round(pos + vel * 120));
                }
            }
            layout();
            paintCaption();
            if (drag || target != null || Math.abs(vel) > 0.00005) anim = raf(tick);
        };
        anim = raf(tick);
    }

    function clampIndex(i) {
        return metrics.full ? i : Math.max(0, Math.min(count() - 1, i));
    }

    function snapTo(i) {
        target = clampIndex(i);
        startLoop();
    }

    function goTo(i) {
        if (traveling || !count()) return;
        // the shortest way round on a full ring
        if (metrics.full) {
            const n = count();
            let d = ((i - pos) % n + n) % n;
            if (d > n / 2) d -= n;
            i = Math.round(pos + d);
        }
        snapTo(i);
    }

    function settle() {
        // keep the position small on a full ring (no float drift after many spins)
        if (metrics.full) pos = wrapIndex(pos);
        layout();
        paintCaption();
    }

    function onPointerDown(e) {
        if (traveling || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const along = metrics.vertical ? e.clientY : e.clientX;
        drag = { x: e.clientX, y: e.clientY, a: along, pos, moved: false, samples: [[now(), along]] };
        target = null;
        vel = 0;
        try { page.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
        startLoop();
    }

    function onPointerMove(e) {
        if (!drag) return;
        const along = metrics.vertical ? e.clientY : e.clientX;
        const dx = along - drag.a;
        if (!drag.moved && Math.abs(dx) > 8) drag.moved = true;
        if (!drag.moved) return;
        let p = drag.pos - dx / (metrics.size * 0.95);
        if (!metrics.full) {
            // rubber band past the ends
            const lo = 0;
            const hi = count() - 1;
            if (p < lo) p = lo - (lo - p) * 0.35;
            if (p > hi) p = hi + (p - hi) * 0.35;
        }
        pos = p;
        drag.samples.push([now(), along]);
        if (drag.samples.length > 6) drag.samples.shift();
    }

    function onPointerUp(e) {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (!d.moved) {
            const el = e.target.closest && e.target.closest('.wmt-planet');
            if (!el) { snapTo(Math.round(pos)); return; }
            const i = Number(el.dataset.i);
            if (i === centred() && target == null) travel();
            else goTo(i);
            return;
        }
        const [t0, x0] = d.samples[0];
        const [t1, x1] = d.samples[d.samples.length - 1];
        const v = t1 > t0 ? -((x1 - x0) / (t1 - t0)) / (metrics.size * 0.95) : 0;
        vel = Math.max(-0.012, Math.min(0.012, v));
        if (Math.abs(vel) < 0.0006) snapTo(Math.round(pos));
        startLoop();
    }

    function onKey(e) {
        if (!shown || ws.current !== APP_ID || traveling) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goTo(Math.round(pos) - 1); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goTo(Math.round(pos) + 1); }
        else if (e.key === 'Enter') { e.preventDefault(); travel(); }
    }

    // ---------------------------------------------------------------- pictures

    function normalize(raw) {
        if (!Array.isArray(raw)) return [];
        const out = [];
        for (const item of raw) {
            if (!item) continue;
            if (item.url) { out.push(item.url); continue; }
            const preview = item.preview || (item.base ? `${item.base}.webp` : null);
            if (!preview) continue;
            const base = String(preview).replace(/\.(jpg|jpeg|png|webp)$/i, '');
            out.push(`/previews/${encodeURIComponent(`${base}.webp`)}`);
        }
        return out;
    }

    // the last pictures each workspace got (kept across opens: a reopen, or an open while the server
    // connection is down, shows them at once)
    const sampleCache = new Map();
    let retryTimer = null;

    async function loadSamples() {
        const gen = ++loadGen;
        clearTimeout(retryTimer);
        // what we already have first
        if (sampleCache.size) applySamples(Object.fromEntries(sampleCache), true);
        let samples = null;
        try {
            const c = window.wsClient;
            if (c && c.isConnected() && typeof c.getWorkspacePreviewSamples === 'function') {
                const res = await Promise.race([
                    c.getWorkspacePreviewSamples(planets.map((p) => p.ws.id), 8, 256),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
                ]);
                samples = (res && res.samples) || (res && res.data && res.data.samples) || null;
            }
        } catch (_) { samples = null; }
        if (gen !== loadGen || !shown) return;
        if (!samples) {
            // not connected (a server restart, the phone's link), slow or failed: ask again while open
            retryTimer = setTimeout(() => { if (shown && gen === loadGen) loadSamples(); }, 3000);
            if (!sampleCache.size) applySamples({}, false);
            return;
        }
        Object.entries(samples).forEach(([id, v]) => sampleCache.set(id, v));
        applySamples(samples, false);
    }

    function applySamples(samples, cached) {
        for (const p of planets) {
            const s = samples[p.ws.id];
            // a fresh answer for a planet already showing these pictures keeps its slide
            if (!cached && s && p.samplesFrom === s) continue;
            if (s) p.samplesFrom = s;
            else if (p.images.length) continue;
            let list = [];
            if (Array.isArray(s)) list = normalize(s);
            else if (s && typeof s === 'object') {
                const recent = normalize(s.recent);
                const fav = normalize(s.favorites);
                // recent and favourites taken in turn, no repeats
                for (let k = 0; k < Math.max(recent.length, fav.length); k++) {
                    if (recent[k] && !list.includes(recent[k])) list.push(recent[k]);
                    if (fav[k] && !list.includes(fav[k])) list.push(fav[k]);
                }
                if (Number.isFinite(Number(s.imageCount)) && s.imageCount >= 0) p.imageCount = s.imageCount;
            }
            if (!list.length && p.ws.id === activeId()) {
                // the workspace on screen: the gallery the phone already has loaded
                try {
                    /* global allImages */
                    const loaded = Array.isArray(window.originalAllImages) && window.originalAllImages.length ? window.originalAllImages
                        : (typeof allImages !== 'undefined' && Array.isArray(allImages) ? allImages : []);
                    list = normalize(loaded.filter((it) => it && (it.preview || it.base)).slice(0, 10));
                } catch (_) { /* not loaded */ }
            }
            if (!list.length) {
                try {
                    /* global resolveWorkspaceWallpaperUrl */
                    const url = typeof resolveWorkspaceWallpaperUrl === 'function' ? resolveWorkspaceWallpaperUrl(p.ws.wallpaper) : null;
                    if (url) list = [url];
                } catch (_) { /* none */ }
            }
            p.images = list.slice(0, 10);
            if (p.images.length) showSlide(p, 0, true);
        }
        paintCaption();
    }

    function showSlide(p, k, instant) {
        const url = p.images[k % p.images.length];
        if (!url) return;
        const next = instant ? p.imgs[p.top] : p.imgs[1 - p.top];
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
            if (!page || !p.el.isConnected) return;
            next.src = url;
            if (instant) { next.classList.add('is-on'); return; }
            next.classList.add('is-on');
            p.imgs[p.top].classList.remove('is-on');
            p.top = 1 - p.top;
        };
        img.src = url;
        p.slide = k;
    }

    function slideTick() {
        if (!shown || document.hidden || traveling) return;
        const t = now();
        for (const p of planets) {
            if (p.images.length < 2 || t < p.nextAt) continue;
            p.nextAt = t + SLIDE_MS + Math.random() * 900;
            showSlide(p, p.slide + 1, false);
        }
    }

    // ---------------------------------------------------------------- stars

    const stars = { list: [], timer: null, warp: 0, ctx: null, w: 0, h: 0, dpr: 1 };

    function starsResize() {
        const c = els && els.stars;
        if (!c) return;
        const r = page.getBoundingClientRect();
        stars.dpr = Math.min(2, window.devicePixelRatio || 1);
        stars.w = Math.max(1, Math.round(r.width));
        stars.h = Math.max(1, Math.round(r.height));
        c.width = Math.round(stars.w * stars.dpr);
        c.height = Math.round(stars.h * stars.dpr);
        stars.ctx = c.getContext('2d');
        if (!stars.list.length) for (let i = 0; i < 140; i++) stars.list.push(spawnStar(true));
    }

    function spawnStar(anyDepth) {
        return { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: anyDepth ? Math.random() * 0.95 + 0.05 : 1 };
    }

    function starsFrame() {
        stars.timer = null;
        if (!shown || !stars.ctx) return;
        const { ctx, w, h, dpr } = stars;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        const speed = 0.0016 + stars.warp * 0.03;
        const cx = w / 2;
        const cy = h * 0.42;
        const f = Math.max(w, h) * 0.6;
        for (const s of stars.list) {
            const pz = s.z;
            s.z -= speed;
            if (s.z <= 0.03) { Object.assign(s, spawnStar(false)); continue; }
            const x = cx + (s.x / s.z) * f;
            const y = cy + (s.y / s.z) * f;
            if (x < -4 || x > w + 4 || y < -4 || y > h + 4) { Object.assign(s, spawnStar(false)); continue; }
            const b = Math.min(1, (1 - s.z) * 1.4);
            ctx.fillStyle = `rgba(${200 + Math.round(55 * b)},${210 + Math.round(45 * b)},255,${b.toFixed(2)})`;
            if (stars.warp > 0.05) {
                // streaks while travelling
                const px = cx + (s.x / pz) * f;
                const py = cy + (s.y / pz) * f;
                ctx.strokeStyle = ctx.fillStyle;
                ctx.lineWidth = 1 + b;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(x, y);
                ctx.stroke();
            } else {
                const r = 0.4 + b * 1.3;
                ctx.fillRect(x - r / 2, y - r / 2, r, r);
            }
        }
        // ~30 fps, the era's frame rate; nothing runs while hidden
        stars.timer = setTimeout(starsFrame, 33);
    }

    function starsStart() {
        starsResize();
        if (!stars.timer) starsFrame();
    }

    function starsStop() {
        clearTimeout(stars.timer);
        stars.timer = null;
    }

    // ---------------------------------------------------------------- music

    function musicLevel() {
        try {
            const tv = window.tabVolume;
            if (tv && typeof tv.isMuted === 'function' && tv.isMuted()) return 0;
            const lv = tv && typeof tv.getLevel === 'function' ? Number(tv.getLevel()) : 100;
            return Math.max(0, Math.min(1, (Number.isFinite(lv) ? lv : 100) / 100)) * BGM.gain;
        } catch (_) { return BGM.gain; }
    }

    function fadeAudio(to, ms, then) {
        if (!audio) return;
        const from = audio.volume;
        const t0 = now();
        const step = () => {
            if (!audio) return;
            const k = Math.min(1, (now() - t0) / ms);
            audio.volume = Math.max(0, Math.min(1, from + (to - from) * k));
            if (k < 1) setTimeout(step, 30);
            else if (then) then();
        };
        step();
    }

    function musicStart() {
        const level = musicLevel();
        if (level <= 0) return;
        try {
            if (!audio) {
                audio = new Audio(BGM.url);
                audio.loop = true;
                audio.preload = 'auto';
            }
            audio.volume = 0;
            const p = audio.play();
            if (p && typeof p.catch === 'function') p.catch(() => { /* no gesture yet: silent */ });
            fadeAudio(level, BGM.fade);
        } catch (_) { /* no audio */ }
    }

    function musicStop(ms = BGM.fade) {
        if (!audio) return;
        const a = audio;
        fadeAudio(0, ms, () => { try { a.pause(); } catch (_) { /* gone */ } });
    }

    // ---------------------------------------------------------------- travel

    async function travel() {
        if (traveling || !count()) return;
        const i = centred();
        const p = planets[i];
        if (!p) return;
        if (p.ws.id === activeId()) { ws.back(); return; }
        /* global setActiveWorkspace */
        if (typeof setActiveWorkspace !== 'function') return;
        traveling = true;
        page.classList.add('is-traveling');
        p.el.classList.add('is-loading');
        if (audio) fadeAudio(Math.min(1, musicLevel() * 1.3), 560);
        let failed = null;
        try {
            // the pulse is the feedback; the WM wait cursor joins a slow switch
            await ws.busy(Promise.resolve().then(() => setActiveWorkspace(p.ws.id)), { delay: 1500, timeout: 30000 });
        } catch (err) { failed = err; }
        p.el.classList.remove('is-loading');
        if (failed) {
            traveling = false;
            page.classList.remove('is-traveling');
            ws.notify({ title: 'Teleport', icon: 'error', text: (failed && failed.message) || 'The workspace could not be opened.' });
            return;
        }
        // zoom into the planet, stars streak, fade to black, then Today in the new workspace
        stars.warp = 1;
        p.el.classList.add('is-arriving');
        page.classList.add('is-arriving');
        musicStop(1400);
        await new Promise((r) => setTimeout(r, 900));
        traveling = false;
        ws.open('today');
    }

    // ---------------------------------------------------------------- app

    function menuItems() {
        const items = [
            { label: 'Teleport', disabled: !count(), action: travel },
            '-',
            { label: 'Previous', disabled: count() < 2, action: () => goTo(Math.round(pos) - 1) },
            { label: 'Next', disabled: count() < 2, action: () => goTo(Math.round(pos) + 1) }
        ];
        if (count()) {
            items.push('-', {
                label: 'Go To',
                submenu: () => planets.map((p, k) => ({ label: p.ws.name || p.ws.id, radio: k === centred(), action: () => goTo(k) }))
            });
        }
        items.push('-', { label: 'Cancel', action: () => ws.back() });
        return items;
    }

    function register() {
        ws = window.wmShell;
        // every desktop route to the planet switcher (Start menu, power menu, Run 'teleport') opens this app
        if (typeof window.openPlanetSwitcher === 'function') window.openPlanetSwitcher = async function () { ws.open(APP_ID); };
        document.addEventListener('keydown', onKey, true);
        ws.registerApp({
            id: APP_ID,
            title: 'Teleport',
            icon: '/static_images/app_icons/vista-teleport.png',
            inStart: 'programs',
            mount(p) {
                page = p;
                p.classList.add('wm-teleport');
                p.addEventListener('pointerdown', onPointerDown);
                p.addEventListener('pointermove', onPointerMove);
                p.addEventListener('pointerup', onPointerUp);
                p.addEventListener('pointercancel', onPointerUp);
                if (typeof ResizeObserver === 'function') {
                    new ResizeObserver(() => { if (shown && els) { measure(); layout(); starsResize(); } }).observe(p);
                }
            },
            show() {
                shown = true;
                traveling = false;
                stars.warp = 0;
                page.classList.remove('is-traveling', 'is-arriving');
                page.classList.add('is-opening');
                build();
                starsStart();
                musicStart();
                clearInterval(slideTimer);
                slideTimer = setInterval(slideTick, 500);
                // the ring comes in from the stars
                setTimeout(() => { if (page) page.classList.remove('is-opening'); }, 30);
            },
            hide() {
                shown = false;
                drag = null;
                clearInterval(slideTimer);
                slideTimer = null;
                starsStop();
                musicStop();
                loadGen++;
                clearTimeout(retryTimer);
            },
            softKeys() {
                return {
                    left: { label: 'Teleport', disabled: !count(), action: travel },
                    right: { label: 'Menu', menu: menuItems }
                };
            }
        });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
