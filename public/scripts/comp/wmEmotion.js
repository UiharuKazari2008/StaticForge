/**
 * Melaton Mobile: eMotion LIVE, a phone version of the desktop's image-to-video app
 * (desktop-apps/emotion.js, Toolbox > eMotion LIVE = openDesktopEmotion), Yozora #732 (parent #709).
 * Not the desktop window re-hosted: the desktop's job path (wsClient.animateImage, the server's
 * per-session job via emotion_current_job, image_animation_progress, cancel_generation) and its
 * backend list (fetchLocalAnimateStatus from emotion.js) on one WM 6.1 form:
 *
 *   form      the picture (tap or Menu > Choose Picture: WM's Open dialog over Pictures, newest first;
 *             or Menu > Studio's Picture), then Motion (the prompt), Model, Frames, Speed (fps), Loop,
 *             and the length they make. Soft keys Start (Stop while it runs) / Menu.
 *   running   a WM progress bar with the stage, step and percent; the server's filmstrip replaces the
 *             picture. It runs on the local animation worker (no Anlas). X asks Close / Minimize /
 *             Cancel; the job keeps going on the server either way, and reopening picks it up again
 *             (the desktop's resume: emotion_current_job).
 *   result    the animation plays in place (muted loop); tap = the GIF in the picture view, Menu > Play
 *             in Windows Media (the WebM / MP4). When it finishes while eMotion is not in front, a WM
 *             notification says so (View). Errors from a tap are message boxes.
 *
 * Every desktop route to the eMotion window (openDesktopEmotion, openEmotion: the picture view's Create
 * Animation, the gallery, Studio's preview menu, Stage Results) opens this app on phones, with the
 * picture they name. Only on phones. Styles: public/css/wm-emotion.css (+ wm-suite-kit.css).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'emotion';
    const TITLE = 'eMotion LIVE';
    const ICON = 'app-emotion';
    const FRAMES = [8, 12, 16, 20, 24, 28, 32];
    const SPEEDS = [4, 6, 8, 10, 12, 16, 20, 24];

    let sh = null;
    let K = null;
    let page = null;
    const st = {
        filename: null,
        workspace: null,
        prompt: '',
        mode: 'ltx',
        frames: 16,
        fps: 8,
        loop: true,
        running: false,
        requestId: null,
        progress: 0,
        label: '',
        previewSeq: -1,
        filmstrip: null,
        result: null, // { filename, formats }
        resultSource: null
    };
    let status = null; // fetchLocalAnimateStatus()
    let poll = null;
    let onProgress = null;
    let resumed = false;

    const isCurrent = () => !!sh && sh.current === APP_ID;
    const esc = (s) => K.esc(s);
    const url = (f) => (typeof window.localGalleryImageUrl === 'function' ? window.localGalleryImageUrl(f) : `/images/${encodeURIComponent(f)}`);
    /** The worker's backends (ids, or { id, name }) named from the desktop's catalog (LOCAL_ANIMATE_BACKENDS). */
    function backends() {
        let known = [];
        try { /* global LOCAL_ANIMATE_BACKENDS */ known = typeof LOCAL_ANIMATE_BACKENDS !== 'undefined' ? LOCAL_ANIMATE_BACKENDS : []; } catch (_) { known = []; }
        if (!known.length) known = [{ id: 'loop', name: 'AnimateDiff Loop (SD1.5)' }, { id: 'wan', name: 'Wan 2.1 I2V 14B (480p)' }, { id: 'ltx', name: 'LTX-Video I2V' }];
        const list = status && Array.isArray(status.backends) && status.backends.length ? status.backends : known;
        return list.map((b) => {
            const id = typeof b === 'string' ? b : (b && b.id);
            const k = known.find((x) => x.id === id);
            return { id, name: (b && typeof b === 'object' && b.name) || (k && k.name) || id };
        }).filter((b) => b.id);
    }
    const backendName = (id) => (backends().find((b) => b.id === id) || { name: id }).name;
    const activeWs = () => { try { /* global activeWorkspace */ return typeof activeWorkspace !== 'undefined' ? activeWorkspace : null; } catch (_) { return null; } };

    // ---------------------------------------------------------------- the desktop's code

    async function ensureFeature() {
        const ok = await K.feature('emotion');
        patchDesktop();
        return ok;
    }

    async function refreshStatus() {
        /* global fetchLocalAnimateStatus */
        if (typeof fetchLocalAnimateStatus !== 'function') return;
        try { status = await fetchLocalAnimateStatus(); } catch (_) { status = null; }
        if (status && !backends().some((b) => b.id === st.mode)) st.mode = backends()[0].id;
        render();
    }

    async function fetchJob() {
        if (!K.connected()) return null;
        try {
            const data = await Promise.race([
                window.wsClient.sendMessage('emotion_current_job', { knownPreviewSeq: st.previewSeq }, false),
                new Promise((resolve) => setTimeout(() => resolve(null), 4000))
            ]);
            return data && data.job ? data.job : null;
        } catch (_) { return null; }
    }

    function applyUpdate(job) {
        if (!job) return;
        const pct = Math.round(Number(job.progress) || 0);
        st.progress = Math.max(st.progress, pct);
        const stage = job.stage ? job.stage.charAt(0).toUpperCase() + job.stage.slice(1) : 'Working';
        st.label = `${stage}${job.step != null && job.totalSteps ? `, step ${job.step} of ${job.totalSteps}` : ''}`;
        if (job.previewBase64 && job.previewSeq > st.previewSeq) {
            st.previewSeq = job.previewSeq;
            st.filmstrip = `data:image/jpeg;base64,${job.previewBase64}`;
        }
        renderStage();
    }

    function restore(job) {
        st.filename = job.sourceFilename || st.filename;
        st.workspace = job.workspace || st.workspace;
        if (job.backend) st.mode = job.backend;
        if (job.frames) st.frames = Number(job.frames);
        if (job.fps) st.fps = Number(job.fps);
        if (job.loop != null) st.loop = !!job.loop;
        if (job.motionPrompt) st.prompt = job.motionPrompt;
    }

    /** The desktop's resume: the server keeps this session's current job. */
    async function resume() {
        if (st.running) return;
        const job = await fetchJob();
        if (!job || st.running) return;
        if (job.status === 'running') {
            restore(job);
            st.running = true;
            st.requestId = job.requestId || 'resumed';
            st.progress = 0;
            st.result = null;
            applyUpdate(job);
            startPoll(st.requestId);
        } else if (job.status === 'completed' && job.result && !st.filename && !st.result) {
            restore(job);
            st.result = { filename: job.result.filename, formats: job.result.formats || {} };
        }
        render();
    }

    // the server pushes the job (emotion_job_update) to this session's sockets; read again on a
    // reconnect and once a minute as a safety net, never every 1.5 s (Yukimi, Nov 13)
    let follow = null;
    function stopFollow() {
        clearInterval(poll);
        poll = null;
        const c = follow && follow.client;
        if (c && typeof c.off === 'function') { c.off('emotion_job_update', follow.onPush); c.off('connected', follow.check); }
        follow = null;
    }

    function startPoll(requestId) {
        stopFollow();
        const apply = (job) => {
            if (!job || !st.running || st.requestId !== requestId) return;
            if (job.requestId && requestId !== 'resumed' && job.requestId !== requestId) return;
            applyUpdate(job);
            if (job.status === 'completed' || job.status === 'failed') finish(requestId, job.status === 'completed' ? job.result : null, job.error);
        };
        const check = async () => {
            if (!st.running || st.requestId !== requestId) { stopFollow(); return; }
            apply(await fetchJob());
        };
        const onPush = (message) => apply(message && message.data);
        const client = window.wsClient;
        if (client && typeof client.on === 'function') { client.on('emotion_job_update', onPush); client.on('connected', check); }
        follow = { client, onPush, check };
        poll = setInterval(check, 60000);
    }

    function finish(requestId, result, error) {
        if (st.requestId !== requestId) return;
        stopFollow();
        if (onProgress && window.wsClient && typeof window.wsClient.off === 'function') window.wsClient.off('image_animation_progress', onProgress);
        onProgress = null;
        st.running = false;
        st.requestId = null;
        st.filmstrip = null;
        if (result && result.filename) st.result = { filename: result.filename, formats: result.formats || {} };
        render();
        if (error) {
            K.tell(APP_ID, { title: TITLE, icon: 'error', text: `The animation could not be made.\n\n${error}` });
            return;
        }
        if (st.result && !isCurrent()) {
            const f = st.result.filename;
            sh.notify({ title: TITLE, icon: 'success', asNote: true, text: 'The animation is ready.', buttons: [{ text: 'View', onClick: () => { sh.open(APP_ID); viewGif(f); } }] });
        }
    }

    // ---------------------------------------------------------------- start / stop (animate_image)

    async function start() {
        if (st.running) return;
        if (!st.filename) { await sh.messageBox({ title: TITLE, icon: 'info', text: 'Choose a picture first (Menu > Choose Picture).' }); return; }
        const ta = page.querySelector('[name="prompt"]');
        st.prompt = ta.value.trim();
        if (!st.prompt) { await sh.messageBox({ title: TITLE, icon: 'info', text: 'Write how the picture should move first.' }); ta.focus(); return; }
        if (!K.connected() || typeof window.wsClient.animateImage !== 'function') { await sh.messageBox({ title: TITLE, icon: 'error', text: 'The server connection is down.' }); return; }
        if (status && status.online === false) {
            const go = await sh.messageBox({ title: TITLE, icon: 'warning', text: `${status.reason || 'The animation worker is offline.'}\n\nStart anyway?`, buttons: [{ text: 'Start', value: true }, { text: 'Cancel', value: false, default: true }] });
            if (!go) return;
        }
        const ws = window.wsClient;
        const params = { filename: st.filename, workspace: st.workspace || activeWs(), motion_prompt: st.prompt, frames: st.frames, fps: st.fps, loop: st.loop, backend: st.mode };
        // the desktop's way to learn the request id (animateImage never returns it): the new key
        const before = new Set(ws.pendingRequests ? ws.pendingRequests.keys() : []);
        const pending = ws.animateImage(params);
        let requestId = null;
        if (ws.pendingRequests) for (const k of ws.pendingRequests.keys()) if (!before.has(k)) { requestId = k; break; }
        st.running = true;
        st.requestId = requestId;
        st.progress = 0;
        st.previewSeq = -1;
        st.filmstrip = null;
        st.result = null;
        st.label = 'Starting...';
        startPoll(requestId);
        onProgress = (m) => { if (m && m.requestId === requestId) applyUpdate(m.data); };
        if (typeof ws.on === 'function') ws.on('image_animation_progress', onProgress);
        render();
        pending.then((result) => finish(requestId, result, null)).catch(async (err) => {
            if (st.requestId !== requestId) return;
            // a dropped socket rejects the request while the job runs on (the poll carries on)
            const job = await fetchJob();
            if (job && job.requestId === requestId && job.status === 'running') return;
            if (job && job.requestId === requestId && job.status === 'completed') { finish(requestId, job.result, null); return; }
            finish(requestId, null, K.errText(err) || 'Animate failed');
        });
    }

    function stop() {
        if (!st.running) return;
        const id = st.requestId;
        stopFollow();
        st.running = false;
        st.requestId = null;
        st.filmstrip = null;
        if (id && window.wsClient && typeof window.wsClient.sendAcklessMessage === 'function') {
            try { window.wsClient.sendAcklessMessage('cancel_generation', { cancelledRequestIds: [id] }); } catch (_) { /* best effort, as on the desktop */ }
        }
        render();
    }

    // ---------------------------------------------------------------- picture

    function setPicture(filename, workspace) {
        if (!filename || st.running) return;
        st.filename = filename;
        st.workspace = workspace || activeWs();
        st.result = null;
        render();
    }

    function choosePicture() {
        if (st.running) return;
        const fd = window.wmFileDialogs;
        if (!fd || typeof fd.open !== 'function') return;
        fd.open({
            title: 'Choose Picture',
            appTitle: TITLE,
            typeLabel: 'Pictures',
            pictures: true,
            accept: (item) => !!pictureOf(item),
            onPick(item) {
                const p = pictureOf(item);
                if (p) setPicture(p.filename, p.workspace);
                return true;
            }
        });
    }

    function pictureOf(item) {
        if (!item || item.kind === 'folder') return null;
        if (item.targetKind === 'image') return { filename: item.previewImageFilename || item.targetId, workspace: item.workspaceId || null };
        if (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) return { filename: item.shortcutData.filename, workspace: item.shortcutData.workspace || null };
        return null;
    }

    function studioPicture() {
        /* global emotionReadStudioCurrentFilename */
        return typeof emotionReadStudioCurrentFilename === 'function' ? emotionReadStudioCurrentFilename() : null;
    }

    function viewGif(filename) {
        /* global showLightbox */
        if (filename && typeof showLightbox === 'function') { try { showLightbox({ filename }); } catch (err) { console.warn('[wmEmotion] viewer', err); } }
    }

    function playInMedia() {
        const r = st.result;
        if (!r || !window.wmMedia) return;
        const f = r.formats.webm || r.formats.mp4;
        if (!f) return;
        // Windows Media's page first (its queue draws into it), then the animation plays there
        sh.open('windows-media');
        window.wmMedia.enqueue([{ name: f.replace(/\.[^.]+$/, ''), url: url(f), kind: 'video' }], true);
    }

    // ---------------------------------------------------------------- rendering

    function lengthText() {
        const secs = st.frames / Math.max(1, st.fps);
        return `${secs.toFixed(1)} s (${st.frames} frames at ${st.fps} fps)`;
    }

    function renderStage() {
        if (!page) return;
        const pic = page.querySelector('.wem-pic');
        const vid = page.querySelector('.wem-video');
        const empty = page.querySelector('.wem-empty');
        const r = st.result;
        const playable = r && (r.formats.webm || r.formats.mp4);
        if (!st.running && playable) {
            const src = url(r.formats.webm || r.formats.mp4);
            if (vid.getAttribute('src') !== src) { vid.src = src; vid.play().catch(() => {}); }
            vid.hidden = false;
            pic.hidden = true;
            empty.hidden = true;
        } else {
            vid.hidden = true;
            if (!vid.paused) vid.pause();
            const src = st.running && st.filmstrip ? st.filmstrip : (st.filename ? url(st.filename) : (r ? url(r.filename) : ''));
            const bad = !!src && pic.dataset.broken === src;
            pic.hidden = !src || bad;
            if (src && pic.getAttribute('src') !== src) pic.src = src;
            empty.hidden = !!src && !bad;
            if (!bad) empty.textContent = 'Tap to choose a picture.';
        }
        const prog = page.querySelector('.wem-progress');
        prog.hidden = !st.running;
        if (st.running) {
            prog.querySelector('.wsk-progress-fill').style.width = `${Math.min(100, st.progress)}%`;
            prog.querySelector('.wsk-progress').classList.toggle('is-marquee', st.progress <= 0);
            prog.querySelector('.wem-progress-text').textContent = `${st.label || 'Working'}${st.progress > 0 ? `  ${st.progress}%` : ''}`;
        }
        const res = page.querySelector('.wem-resultline');
        res.hidden = st.running || !r;
        if (r) res.textContent = `Done: ${r.filename}`;
    }

    function render() {
        if (!page) return;
        renderStage();
        const ta = page.querySelector('[name="prompt"]');
        if (document.activeElement !== ta) ta.value = st.prompt;
        ta.readOnly = st.running;
        page.querySelector('.wem-model .wsk-combo-text').textContent = backendName(st.mode);
        page.querySelector('.wem-frames .wsk-combo-text').textContent = String(st.frames);
        page.querySelector('.wem-fps .wsk-combo-text').textContent = `${st.fps} fps`;
        page.querySelector('[name="loop"]').checked = st.loop;
        page.querySelectorAll('.wem-model, .wem-frames, .wem-fps, [name="loop"]').forEach((el) => { el.disabled = st.running; });
        page.querySelector('.wem-length').textContent = lengthText();
        const worker = page.querySelector('.wem-worker');
        worker.textContent = !status ? '' : status.online ? `Worker online${status.gpu ? ` (${typeof status.gpu === 'string' ? status.gpu : status.gpu.name || ''})` : ''}.` : (status.reason || 'The animation worker is offline.');
        worker.classList.toggle('is-off', !!status && !status.online);
        if (isCurrent()) sh.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- menus / keys

    function menu() {
        const studio = studioPicture();
        return [
            st.running ? { label: 'Stop', action: stop } : { label: 'Start', disabled: !st.filename, action: start },
            '-',
            { label: 'Choose Picture...', disabled: st.running, action: choosePicture },
            { label: "Studio's Picture", disabled: st.running || !studio, action: () => setPicture(studio, activeWs()) },
            '-',
            { label: 'View Animation', disabled: !st.result, action: () => viewGif(st.result && st.result.filename) },
            { label: 'Play in Melaton Media', disabled: !st.result || !window.wmMedia || !(st.result.formats.webm || st.result.formats.mp4), action: playInMedia },
            '-',
            { label: 'Refresh Worker Status', action: refreshStatus }
        ];
    }

    // ---------------------------------------------------------------- desktop routes

    function phoneOpen(options) {
        const opts = typeof options === 'string' ? { filename: options } : (options || {});
        const src = opts.source && typeof opts.source === 'object' ? opts.source : null;
        let filename = opts.filename || (src && (src.original || src.filename || src.upscaled)) || (typeof opts.source === 'string' ? opts.source : null);
        if (!filename && opts.imageUrl) { const last = String(opts.imageUrl).split('#')[0].split('?')[0].split('/').filter(Boolean).pop(); filename = last ? decodeURIComponent(last) : null; }
        sh.open(APP_ID);
        if (filename) setPicture(filename, opts.workspace !== undefined ? opts.workspace : activeWs());
        return filename || null;
    }

    function patchDesktop() {
        // emotion.js sets window.openEmotion when it loads: point it (and the window opener) here again
        if (window.openEmotion !== phoneOpen) window.openEmotion = phoneOpen;
        window.openDesktopEmotion = () => { sh.open(APP_ID); };
    }

    // ---------------------------------------------------------------- page

    function mount(p) {
        page = p;
        p.classList.add('wsk', 'wm-emotion');
        p.innerHTML = `
            <div class="wsk-view wem-form">
                <div class="wem-split">
                    <div class="wem-stage" role="button" aria-label="Picture">
                        <img class="wem-pic" alt="" draggable="false" hidden>
                        <video class="wem-video" muted loop playsinline autoplay hidden></video>
                        <p class="wem-empty">Tap to choose a picture.</p>
                    </div>
                    <div class="wsk-body wem-fields">
                        <div class="wem-progress" hidden><div class="wsk-progress is-marquee"><div class="wsk-progress-fill"></div></div><div class="wem-progress-text"></div></div>
                        <div class="wem-resultline" hidden></div>
                        <label class="wsk-field is-tall"><span class="wsk-flabel">Motion:</span><textarea class="wsk-textarea" name="prompt" autocapitalize="off" spellcheck="false" placeholder="How it moves: hair blowing in the wind, slow blink..."></textarea></label>
                        <div class="wsk-field"><span class="wsk-flabel">Model:</span>${K.comboHtml('wem-model', '')}</div>
                        <div class="wsk-field"><span class="wsk-flabel">Frames:</span>${K.comboHtml('wem-frames', '')}</div>
                        <div class="wsk-field"><span class="wsk-flabel">Speed:</span>${K.comboHtml('wem-fps', '')}</div>
                        <label class="wsk-check"><input type="checkbox" name="loop"><span>Loop</span></label>
                        <div class="wsk-field"><span class="wsk-flabel">Length:</span><span class="wem-length"></span></div>
                        <p class="wem-worker"></p>
                    </div>
                </div>
            </div>`;
        // a picture that is gone (deleted, another workspace's file) says so instead of a broken image
        const pic = p.querySelector('.wem-pic');
        pic.addEventListener('error', () => {
            if (!pic.getAttribute('src') || pic.src.startsWith('data:')) return;
            pic.dataset.broken = pic.getAttribute('src');
            pic.hidden = true;
            const empty = p.querySelector('.wem-empty');
            empty.hidden = false;
            empty.textContent = 'The picture could not be loaded. Tap to choose another.';
        });
        pic.addEventListener('load', () => { delete pic.dataset.broken; });
        const ta = p.querySelector('[name="prompt"]');
        ta.addEventListener('input', () => { st.prompt = ta.value; });
        p.querySelector('.wem-model').addEventListener('click', (e) => K.combo(e.currentTarget, backends().map((b) => ({ value: b.id, label: b.name })), () => st.mode, (v) => { st.mode = v; render(); }));
        p.querySelector('.wem-frames').addEventListener('click', (e) => K.combo(e.currentTarget, FRAMES.map((n) => ({ value: n, label: String(n) })), () => st.frames, (v) => { st.frames = v; render(); }));
        p.querySelector('.wem-fps').addEventListener('click', (e) => K.combo(e.currentTarget, SPEEDS.map((n) => ({ value: n, label: `${n} fps` })), () => st.fps, (v) => { st.fps = v; render(); }));
        p.querySelector('[name="loop"]').addEventListener('change', (e) => { st.loop = e.target.checked; });
        p.querySelector('.wem-stage').addEventListener('click', () => {
            if (st.running) return;
            if (st.result) viewGif(st.result.filename);
            else choosePicture();
        });
        render();
    }

    function register() {
        sh = window.wmShell;
        K = window.wmSuiteKit;
        if (!sh || typeof sh.registerApp !== 'function' || !K) return;
        // the routes before emotion.js has loaded (Toolbox) and after (it resets openEmotion on load)
        window.openEmotion = phoneOpen;
        window.openDesktopEmotion = () => { sh.open(APP_ID); };
        K.afterFeature('emotion', patchDesktop);
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: ICON,
            inStart: 'programs',
            programsFolder: 'toolbox',
            sip: true,
            mount,
            async show() {
                render();
                await sh.busy(async () => {
                    await ensureFeature();
                    if (!resumed) { resumed = true; await resume(); }
                }, { paint: true }).catch(() => {});
                refreshStatus();
            },
            hide() {
                const vid = page && page.querySelector('.wem-video');
                if (vid && !vid.paused) vid.pause();
            },
            titleKind: () => 'close',
            closeQuestion: () => (st.running ? 'The animation is still being made. It keeps going on the server; open eMotion LIVE again to see it.' : null),
            softKeys: () => ({
                left: st.running ? { label: 'Stop', action: stop } : { label: 'Start', disabled: !st.filename, action: start },
                right: { label: 'Menu', menu }
            })
        });
    }

    if (window.wmShell && window.wmSuiteKit) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
