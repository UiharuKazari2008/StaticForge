/**
 * Camera for Melaton Mobile (Yozora #788): Pictures & Videos' Camera (its soft key with nothing
 * selected and Menu > Camera, as on WM 6.1). The phone's camera comes into the page through the
 * Android app's WebView (getUserMedia; DSApp grants it to this origin), so taking a picture never
 * leaves Melaton Mobile for Android's own camera app. Pictures and videos are saved on the
 * Storage Card in DCIM\Camera (phoneStorage.write) with Android's file names, so they sit with
 * the phone's own camera roll, and Pictures & Videos shows them at once.
 *
 *   Still: a full-size JPEG through ImageCapture.takePhoto(), else the viewfinder's frame
 *   Video:  MediaRecorder (MP4 where the WebView records it, else WebM), with sound
 *
 * window.wmCamera = { supported(), open() }
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'camera';
    const TITLE = 'Camera';
    const MODE_KEY = 'wmCameraMode';
    const FACING_KEY = 'wmCameraFacing';

    let sh = null;
    let page = null;
    let stream = null;
    let mode = readKey(MODE_KEY, 'still') === 'video' ? 'video' : 'still';
    let facing = readKey(FACING_KEY, 'environment') === 'user' ? 'user' : 'environment';
    let recorder = null;
    let recStart = 0;
    let recTimer = null;
    let saving = false;
    let torch = false;
    let starting = null;

    function readKey(k, d) { try { return localStorage.getItem(k) || d; } catch (_) { return d; } }
    function writeKey(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* this session only */ } }

    const PS = () => window.phoneStorage || null;
    const gallery = () => window.wmPhoneGallery || null;

    function supported() {
        const g = gallery();
        return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && g && g.available() && g.cameraRoll());
    }

    const pad = (n) => String(n).padStart(2, '0');
    function stamp(d = new Date()) {
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    // ---------------------------------------------------------------- stream

    function stopStream() {
        if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) { /* stopped */ } }
        if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) { /* ended */ } });
        stream = null;
        torch = false;
        const v = page && page.querySelector('video');
        if (v) v.srcObject = null;
    }

    async function startStream() {
        if (starting) return starting;
        starting = (async () => {
            stopStream();
            const video = { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } };
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video, audio: mode === 'video' });
            } catch (err) {
                // a camera without sound (the microphone refused) still takes pictures and silent videos
                if (mode === 'video' && err && err.name !== 'NotAllowedError') {
                    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
                } else throw err;
            }
            const v = page.querySelector('video');
            v.srcObject = stream;
            v.classList.toggle('is-mirrored', facing === 'user');
            try { await v.play(); } catch (_) { /* plays when shown */ }
            render();
        })();
        try { await starting; } catch (err) {
            stopStream();
            render();
            const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
            await sh.messageBox({
                title: TITLE, icon: 'error',
                text: denied ? 'The camera cannot be used. Allow Dreamscape to use the camera in the phone\'s settings, then try again.'
                    : `The camera could not be started.${err && err.message ? ` ${err.message}` : ''}`
            });
        } finally { starting = null; }
    }

    const track = () => (stream ? stream.getVideoTracks()[0] || null : null);

    // ---------------------------------------------------------------- capture

    async function saveBlob(blob, name) {
        const g = gallery();
        // the drive's state is read when Pictures & Videos first opens: the Camera may come first
        if (g) await g.init();
        const roll = g && g.cameraRoll();
        const ps = PS();
        if (!roll || !ps) throw { message: 'There is no storage card to save on.' };
        try { await ps.call('mkdir', { root: roll.root, path: roll.path }); } catch (err) { if (!err || err.code !== 'exists') throw err; }
        const file = new File([blob], name, { type: blob.type, lastModified: Date.now() });
        const entry = await ps.write(roll.root, roll.path, file, { name, conflict: 'rename', mtime: Date.now() });
        const path = (entry && entry.path) || `${roll.path}/${name}`;
        g.added(roll.root, path);
        return path;
    }

    function flash() {
        const f = page && page.querySelector('.wcam-flash');
        if (!f) return;
        f.classList.remove('is-on');
        void f.offsetWidth;
        f.classList.add('is-on');
    }

    async function frameJpeg() {
        const v = page.querySelector('video');
        const c = document.createElement('canvas');
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext('2d');
        if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
        ctx.drawImage(v, 0, 0);
        return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92));
    }

    async function takePicture() {
        if (!stream || saving) return;
        saving = true;
        render();
        flash();
        try {
            let blob = null;
            const t = track();
            if (t && typeof window.ImageCapture === 'function') {
                // the sensor's full picture, not the viewfinder's
                try { blob = await new window.ImageCapture(t).takePhoto(); } catch (_) { blob = null; }
            }
            if (!blob) blob = await frameJpeg();
            if (!blob) throw { message: 'The camera gave no picture.' };
            await saveBlob(blob, `IMG_${stamp()}.jpg`);
        } catch (err) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: `The picture was not saved.${err && err.message ? ` ${err.message}` : ''}` });
        } finally { saving = false; render(); }
    }

    function recorderType() {
        const R = window.MediaRecorder;
        if (!R || typeof R.isTypeSupported !== 'function') return '';
        return ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => R.isTypeSupported(t)) || '';
    }

    function startRecording() {
        if (!stream || recorder || typeof window.MediaRecorder !== 'function') return;
        const type = recorderType();
        const chunks = [];
        try {
            recorder = new window.MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8000000 } : undefined);
        } catch (err) {
            recorder = null;
            void sh.messageBox({ title: TITLE, icon: 'error', text: `Video cannot be recorded here.${err && err.message ? ` ${err.message}` : ''}` });
            return;
        }
        const rec = recorder;
        const startedAt = new Date();
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = async () => {
            clearInterval(recTimer);
            recTimer = null;
            recorder = null;
            render();
            if (!chunks.length) return;
            const mime = (rec.mimeType || type || 'video/webm').split(';')[0];
            const blob = new Blob(chunks, { type: mime });
            saving = true;
            render();
            try { await saveBlob(blob, `VID_${stamp(startedAt)}.${/mp4/.test(mime) ? 'mp4' : 'webm'}`); } catch (err) {
                await sh.messageBox({ title: TITLE, icon: 'error', text: `The video was not saved.${err && err.message ? ` ${err.message}` : ''}` });
            } finally { saving = false; render(); }
        };
        rec.start(1000);
        recStart = Date.now();
        recTimer = setInterval(render, 500);
        render();
    }

    function stopRecording() {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
    }

    function shutter() {
        if (mode === 'still') void takePicture();
        else if (recorder) stopRecording();
        else startRecording();
    }

    async function setMode(m) {
        if (m === mode || recorder) return;
        mode = m;
        writeKey(MODE_KEY, m);
        render();
        // video needs the microphone as well
        await startStream();
    }

    async function switchCamera() {
        if (recorder) return;
        facing = facing === 'user' ? 'environment' : 'user';
        writeKey(FACING_KEY, facing);
        await startStream();
    }

    async function setTorch(on) {
        const t = track();
        if (!t || typeof t.applyConstraints !== 'function') return;
        try { await t.applyConstraints({ advanced: [{ torch: on }] }); torch = on; } catch (_) { torch = false; }
        render();
    }

    const hasTorch = () => { const t = track(); try { return !!(t && t.getCapabilities && t.getCapabilities().torch); } catch (_) { return false; } };

    // ---------------------------------------------------------------- page

    function render() {
        if (!page) return;
        const label = page.querySelector('.wcam-mode');
        const secs = recorder ? Math.floor((Date.now() - recStart) / 1000) : 0;
        label.textContent = recorder ? `${Math.floor(secs / 60)}:${pad(secs % 60)}` : (mode === 'video' ? 'Video' : 'Still');
        label.classList.toggle('is-rec', !!recorder);
        page.querySelector('.wcam-saving').hidden = !saving;
        if (sh && sh.refreshSoftKeys && isCurrent()) sh.refreshSoftKeys();
    }

    const isCurrent = () => !!(sh && sh.current === APP_ID);

    function mount(p) {
        page = p;
        page.classList.add('wm-camera');
        page.innerHTML = `
            <video class="wcam-view" playsinline muted autoplay></video>
            <span class="wcam-mode"></span>
            <span class="wcam-saving" hidden>Saving...</span>
            <div class="wcam-flash"></div>`;
        // a tap on the viewfinder is the shutter, as the action key is on the device
        page.querySelector('.wcam-view').addEventListener('click', shutter);
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: 'app-camera',
            mount,
            show() {
                render();
                const g = gallery();
                if (g) void g.init();
                void startStream();
            },
            hide() { stopStream(); clearInterval(recTimer); recTimer = null; },
            softKeys() {
                const left = mode === 'still'
                    ? { label: 'Capture', disabled: !stream || saving, action: shutter }
                    : { label: recorder ? 'Stop' : 'Record', disabled: !stream || (saving && !recorder), action: shutter };
                return {
                    left,
                    right: {
                        label: 'Menu',
                        menu: () => [
                            { label: 'Still', radio: mode === 'still', disabled: !!recorder, action: () => setMode('still') },
                            { label: 'Video', radio: mode === 'video', disabled: !!recorder || typeof window.MediaRecorder !== 'function', action: () => setMode('video') },
                            '-',
                            { label: 'Switch Camera', disabled: !!recorder, action: switchCamera },
                            { label: 'Light', checked: torch, disabled: !hasTorch(), action: () => setTorch(!torch) },
                            '-',
                            { label: 'Pictures & Videos', action: () => { const g = gallery(); const r = g && g.cameraRoll(); sh.open('gallery'); if (r) void g.open(r.root, r.path); } }
                        ]
                    }
                };
            }
        });
    }

    window.wmCamera = {
        supported,
        open() {
            if (!sh) return;
            sh.open(APP_ID);
        }
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
