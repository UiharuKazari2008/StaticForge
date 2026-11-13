/**
 * Sound Recorder (Yozora #785): Vista's SoundRecorder.exe, measured on the Vista VM
 * (~/.cache/vista-vm/journal sr1.png ... sr3.png): a 406 x 66 window, caption with the microphone
 * (SoundRecorder.exe icon) and the close box only, one 31-px band in the rebar's gradient with
 * [● Start Recording] (112 x 27, the glyphs are SoundRecorder.exe bitmap 204: record / stop / help),
 * the elapsed time (0:00:00), the input level meter (147 x 27 trough) and Help with its drop arrow.
 * Start Recording becomes [■ Stop Recording] (Alt+S) while it records.
 *
 * Windows Journal opens it for Insert > Voice Recording...: what it records goes onto the note
 * (Vista's Save As is skipped: the note is the file).
 *
 *   window.soundRecorder.record({ owner }) -> Promise<{ blob, ms } | null>  (null: closed unrecorded)
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-journal/';
    // 400 x 31 client in MS Shell Dlg 8 units (x 1.5 px, y 1.625 px)
    const TPL = { t: 'Sound Recorder', w: 267, h: 19, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [[900, 'S', 0, 0, 267, 19, 0x50000000, '', 0]] };
    const V = () => root.vistaDialogTemplate;
    let busy = false;

    function fmt(ms) {
        const s = Math.floor(Math.max(0, ms) / 1000);
        return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    async function ready() {
        if (root.featureLoader) {
            try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* none */ }
        }
        return !!(V() && typeof V().openDialog === 'function');
    }

    function message(text) {
        if (typeof root.showConfirmationDialog === 'function') {
            return root.showConfirmationDialog(`<p>${String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Sound Recorder', width: 360, icon: 'fas fa-circle-xmark' });
        }
        return Promise.resolve();
    }

    async function record(opts = {}) {
        if (busy || !(await ready())) return null;
        busy = true;
        return new Promise((resolve) => {
            let stream = null;
            let rec = null;
            let chunks = [];
            let t0 = 0;
            let timer = null;
            let audioCtx = null;
            let analyser = null;
            let result = null;
            let ctxRef = null;
            const html = '<div class="sr-band">'
                + '<button type="button" class="sr-btn" data-sr="toggle" title="Start Recording (Alt+S)"><span class="sr-glyph"></span><span class="sr-label"><u>S</u>tart Recording</span></button>'
                + '<span class="sr-time">0:00:00</span>'
                + '<span class="sr-meter"><span class="sr-level"></span></span>'
                + '<button type="button" class="sr-help" title="Help" disabled></button><span class="sr-more" aria-hidden="true"></span>'
                + '</div>';

            const stopAll = () => {
                clearInterval(timer);
                timer = null;
                if (stream) stream.getTracks().forEach((t) => t.stop());
                stream = null;
                if (audioCtx) { try { void audioCtx.close(); } catch (_) { /* gone */ } }
                audioCtx = null;
            };

            const paint = (c) => {
                const band = c.content.querySelector('.sr-band');
                const on = !!rec && rec.state === 'recording';
                band.classList.toggle('is-recording', on);
                const btn = band.querySelector('.sr-btn');
                btn.title = on ? 'Stop Recording (Alt+S)' : 'Start Recording (Alt+S)';
                btn.querySelector('.sr-label').innerHTML = on ? '<u>S</u>top Recording' : '<u>S</u>tart Recording';
            };

            const start = async (c) => {
                const md = navigator.mediaDevices;
                if (!md || typeof md.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
                    await message('Sound Recorder cannot record: no microphone is available.');
                    return;
                }
                try {
                    stream = await md.getUserMedia({ audio: true });
                } catch (_) {
                    await message('Sound Recorder cannot record: access to the microphone was refused.');
                    return;
                }
                const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
                rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
                chunks = [];
                rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
                rec.start(250);
                t0 = Date.now();
                try {
                    const AC = root.AudioContext || root.webkitAudioContext;
                    audioCtx = new AC();
                    analyser = audioCtx.createAnalyser();
                    analyser.fftSize = 512;
                    audioCtx.createMediaStreamSource(stream).connect(analyser);
                } catch (_) { analyser = null; }
                const buf = new Uint8Array(512);
                const band = c.content.querySelector('.sr-band');
                timer = setInterval(() => {
                    band.querySelector('.sr-time').textContent = fmt(Date.now() - t0);
                    let level = 0;
                    if (analyser) {
                        analyser.getByteTimeDomainData(buf);
                        let sum = 0;
                        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
                        level = Math.min(1, Math.sqrt(sum / buf.length) * 3);
                    }
                    band.querySelector('.sr-level').style.width = `${Math.round(level * 100)}%`;
                }, 100);
                paint(c);
            };

            const stop = async (c) => {
                if (!rec) return;
                const r = rec;
                await new Promise((res) => { r.onstop = res; try { r.stop(); } catch (_) { res(); } });
                const ms = Date.now() - t0;
                rec = null;
                stopAll();
                const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
                result = blob.size ? { blob, ms } : null;
                paint(c);
                // the note is the file: done once it has a recording
                c.close();
            };

            ctxRef = V().openDialog({
                id: 'soundRecorderWindow',
                tpl: TPL,
                title: 'Sound Recorder',
                icon: `${ART}sound-recorder-16.png`,
                captionIcon: true,
                owner: opts.owner,
                overrides: { 900: { html, cls: 'sr-host' } },
                init(c) {
                    c.content.querySelector('[data-sr="toggle"]').addEventListener('click', () => {
                        if (rec && rec.state === 'recording') void stop(c);
                        else void start(c);
                    });
                    c.modal.addEventListener('keydown', (e) => {
                        if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); c.content.querySelector('[data-sr="toggle"]').click(); }
                    });
                },
                close() {
                    if (rec) { try { rec.stop(); } catch (_) { /* gone */ } rec = null; }
                    stopAll();
                    busy = false;
                    resolve(result);
                }
            });
            if (!ctxRef) { busy = false; resolve(null); }
        });
    }

    root.soundRecorder = { record, isOpen: () => busy };
})(window);
