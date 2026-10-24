/**
 * Sound Recorder (Yozora #632), Vista's SoundRecorder.exe as a Melaton system package (apps/soundrec).
 *
 *   the window   Start Recording / Stop Recording, the time (0:00:00), the level meter, Help
 *   recording    the microphone (the browser asks the first time) captured as 16-bit PCM;
 *                Stop opens Save As (Wave Sound, .wav) in Documents; Cancel there gives Vista's
 *                Resume Recording, which carries on in the same recording
 *
 *   melatonApps.define('soundrec', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const ICON16 = '/static_images/app_icons/16/vista-sound-recorder.webp';
    const ICON24 = '/static_images/app_icons/24/vista-sound-recorder.webp';
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const vfs = () => root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    /** PCM chunks (Float32, mono) to a 16-bit WAV file. */
    function wav(chunks, rate) {
        const n = chunks.reduce((s, c) => s + c.length, 0);
        const buf = new ArrayBuffer(44 + n * 2);
        const v = new DataView(buf);
        const str = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
        str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        str(36, 'data'); v.setUint32(40, n * 2, true);
        let o = 44;
        chunks.forEach((c) => { for (let i = 0; i < c.length; i += 1) { const s = Math.max(-1, Math.min(1, c[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; } });
        return new Blob([buf], { type: 'audio/wav' });
    }

    const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

    class Recorder {
        constructor(app) {
            this.app = app;
            this.state = 'idle'; // idle | recording | paused (Save As was cancelled)
            this.chunks = [];
            this.elapsed = 0;
            this.build();
        }

        build() {
            const m = doc.createElement('div');
            m.className = 'modal hidden srec-window';
            m.dataset.windowIdentifier = 'melatonSoundRecorder';
            m.dataset.windowClient = 'light';
            m.dataset.windowFixedSize = 'true';
            m.dataset.windowRestoreSize = 'false';
            m.dataset.taskbarIcon = ICON24;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'Sound Recorder');
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span>Sound Recorder</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small srec-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 srec-client">
                    <button type="button" class="srec-rec"><span class="srec-glyph"></span><span class="srec-label">Start Recording</span></button>
                    <span class="srec-time">0:00:00</span>
                    <span class="srec-meter" aria-hidden="true"><span class="srec-meter-fill"></span></span>
                    <button type="button" class="srec-help" title="Help"></button>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            m.querySelector('.srec-close').addEventListener('click', () => void this.close());
            m.querySelector('.srec-rec').addEventListener('click', () => void (this.state === 'recording' ? this.stop() : this.record()));
            m.querySelector('.srec-help').addEventListener('click', () => this.help());
            m.addEventListener('keydown', (ev) => {
                // Vista: Alt+S starts, Alt+S stops (the button's access key)
                if (ev.altKey && ev.key.toLowerCase() === 's') { ev.preventDefault(); m.querySelector('.srec-rec').click(); }
            });
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed) return;
                placed = true;
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 3)));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                m.id = 'melatonSoundRecorderModal';
                root.programFaults.registerProgram(m.id, { name: 'Sound Recorder', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'soundrec' }) });
            }
            this.sync();
        }

        sync() {
            const b = this.modal.querySelector('.srec-rec');
            const rec = this.state === 'recording';
            b.classList.toggle('is-stop', rec);
            this.modal.querySelector('.srec-label').textContent = rec ? 'Stop Recording' : this.state === 'paused' ? 'Resume Recording' : 'Start Recording';
            this.modal.querySelector('.srec-time').textContent = clock(this.elapsed + (rec ? performance.now() - this.t0 : 0));
        }

        async openMic() {
            if (this.stream) return true;
            const md = navigator.mediaDevices;
            if (!md || !md.getUserMedia) { await this.message('No microphone can be used here.'); return false; }
            try {
                this.stream = await md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
            } catch (err) {
                await this.message(`Sound Recorder cannot use the microphone.\n${(err && err.message) || err}`);
                return false;
            }
            if (!this.ac) { const AC = root.AudioContext || root.webkitAudioContext; this.ac = new AC(); }
            this.rate = this.ac.sampleRate;
            this.src = this.ac.createMediaStreamSource(this.stream);
            this.analyser = this.ac.createAnalyser();
            this.analyser.fftSize = 1024;
            this.proc = this.ac.createScriptProcessor(4096, 1, 1);
            this.proc.onaudioprocess = (e) => { if (this.state === 'recording') this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
            this.src.connect(this.analyser);
            this.src.connect(this.proc);
            // the processor must reach the destination to run; it writes silence
            this.proc.connect(this.ac.destination);
            return true;
        }

        async record() {
            // the audio context is made in the click itself, before the microphone prompt
            const AC = root.AudioContext || root.webkitAudioContext;
            if (!this.ac && AC) this.ac = new AC();
            if (!await this.openMic()) return;
            // resume() waits for a user gesture (the click is one); the window must not hang on it
            if (this.ac.state === 'suspended') void this.ac.resume().catch(() => {});
            if (this.state === 'idle') { this.chunks = []; this.elapsed = 0; }
            this.state = 'recording';
            this.t0 = performance.now();
            this.sync();
            const fill = this.modal.querySelector('.srec-meter-fill');
            const data = new Float32Array(this.analyser.fftSize);
            clearInterval(this.timer);
            this.timer = setInterval(() => {
                this.sync();
                this.analyser.getFloatTimeDomainData(data);
                let peak = 0;
                for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
                // Vista's meter: green segments, a log-ish scale
                fill.style.width = `${Math.min(100, Math.round(Math.sqrt(peak) * 100))}%`;
            }, 80);
        }

        async stop() {
            if (this.state !== 'recording') return;
            this.elapsed += performance.now() - this.t0;
            this.state = 'paused';
            clearInterval(this.timer);
            this.modal.querySelector('.srec-meter-fill').style.width = '0';
            this.sync();
            const saved = await this.save();
            if (saved) { this.state = 'idle'; this.chunks = []; this.elapsed = 0; this.release(); }
            this.sync();
        }

        /** Vista's Save As straight after Stop; Cancel keeps the recording to resume. */
        save() {
            if (typeof root.studioOpenFolderDialog !== 'function') return Promise.resolve(false);
            const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : ''; // eslint-disable-line no-undef
            const self = this;
            return new Promise((resolve) => {
                void root.studioOpenFolderDialog('save', {
                    owner: this.modal,
                    startPath: ws ? `/Workspaces/${ws}` : '/',
                    host: {
                        title: 'Save As',
                        typeLabel: 'Wave Sound (*.wav)',
                        acceptType: 'user-file',
                        suggestName: () => 'Sound Recording.wav',
                        async onSave(info) {
                            let name = String(info.name || '').trim();
                            if (!name) return false;
                            if (!/\.wav$/i.test(name)) name += '.wav';
                            try {
                                const blob = wav(self.chunks, self.rate || 44100);
                                await vfs().uploadFile(info.path || '/', await blobToBase64(blob), name, 'audio/wav');
                                resolve(true);
                                return true;
                            } catch (err) {
                                await self.message(`The recording could not be saved.\n${(err && err.message) || err}`);
                                resolve(false);
                                return false;
                            }
                        },
                        onCancel() { resolve(false); }
                    }
                });
            });
        }

        release() {
            clearInterval(this.timer);
            try { if (this.proc) this.proc.disconnect(); if (this.src) this.src.disconnect(); } catch (_) { /* gone */ }
            if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
            if (this.ac) void this.ac.close().catch(() => {});
            this.stream = null;
            this.ac = null;
        }

        message(text, buttons) {
            return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Sound Recorder', width: 380 });
        }

        help() {
            void this.message('Click Start Recording, speak into the microphone, then click Stop Recording and save the sound.\nIf you cancel the Save As box, Resume Recording carries on in the same recording.');
        }

        /** Vista asks before throwing a recording away. */
        async close() {
            if (this.state === 'recording') await this.stop();
            if (this.state === 'paused' && this.chunks.length) {
                const v = await this.message('Do you want to save the sound you recorded?', [
                    { text: 'Yes', value: 'yes', className: 'btn-standard primary' }, { text: 'No', value: 'no', className: 'btn-standard' }, { text: 'Cancel', value: 'cancel', className: 'btn-standard' }
                ]);
                if (v === 'cancel' || v === null || v === undefined || v === false) return;
                if (v === 'yes' && !await this.save()) return;
            }
            this.app.exit();
        }

        destroy() {
            this.release();
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 300);
        }
    }

    let running = null;

    function start(app) {
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        const r = new Recorder(app);
        running = r;
        app.onExit(() => { running = null; r.destroy(); });
    }

    root.melatonSoundRecorder = { start, wav, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('soundrec', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
