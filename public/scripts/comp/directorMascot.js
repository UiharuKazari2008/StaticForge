// Director mascot (#688): Wren (Nonoka), Kabuki (Chiyo), and Xi (Yozora), layered sprites cut from
// Yukimi's sprite sets (public/static_images/director-mascots/<persona>/manifest.json).
//
// Two views (Yukimi 2026-10-31): "mascot" (the default) is a visual novel: her room fills the chat, she
// stands on her side, and the log (messages, thinking, tool calls) is a glass panel on the other side, top
// most. "messages" keeps the plain log and puts her at the input bar edge (head and shoulders peek while
// idle, she rises while a turn runs). A finished print flies in as a polaroid and fades into her belly.
//
// Manifest v1: one body + head + expressions. v2: bodies (each names a faceSet), stages (base / bigger /
// ...), transitions (in-between frames between stages), and behaviour (advance rules, kicks, gestures).
// Cues (expression + action) come from the server on director_streaming_update (modules/directorMascot.js).

const DIRECTOR_MASCOT_ROOT = '/static_images/director-mascots';
const DIRECTOR_MASCOT_PREFS_KEY = 'staticforge_director_mascot_v2';   // v2: the visual novel view is the default
const DIRECTOR_MASCOT_TICK_MS = 1000;
const DIRECTOR_MASCOT_SLEEPY_MS = 3 * 60 * 1000;

function directorMascotRand(range, fallback) {
    if (!Array.isArray(range) || range.length < 2) return fallback;
    return range[0] + Math.random() * (range[1] - range[0]);
}

// Growth (#704): her stage follows the chat's report cards, not time spent working. Each card adds
// hit 1, partial 0.5, miss -0.5 (the user's rescore wins over the agent's marks); the total, never below
// zero, picks the stage from behaviour.growth (order + points). The stage moves after a turn completes.
const DIRECTOR_MASCOT_SCORE_POINTS = { hit: 1, partial: 0.5, miss: -0.5 };

function directorMascotGrowthPoints(messages) {
    let total = 0;
    (Array.isArray(messages) ? messages : []).forEach((message) => {
        const report = message && message.role === 'assistant' && message.data && message.data.report;
        const items = report && report.card && Array.isArray(report.card.items) ? report.card.items : [];
        if (!items.length) return;
        const reviewed = report.review && Array.isArray(report.review.scores) ? report.review.scores : [];
        items.forEach((item, at) => {
            const score = reviewed[at] in DIRECTOR_MASCOT_SCORE_POINTS ? reviewed[at] : item && item.score;
            total = Math.max(0, total + (DIRECTOR_MASCOT_SCORE_POINTS[score] || 0));
        });
    });
    return total;
}

// behaviour.growth or, without one, the stages in manifest order 3 points apart.
function directorMascotGrowth(manifest) {
    const g = manifest && manifest.behaviour && manifest.behaviour.growth;
    const order = g && Array.isArray(g.order) ? g.order.filter((key) => manifest.stages[key]) : Object.keys((manifest && manifest.stages) || {});
    const points = order.map((_, i) => (g && Array.isArray(g.points) && Number.isFinite(g.points[i]) ? g.points[i] : i * 3));
    return { order, points };
}

function directorMascotStageFor(manifest, total) {
    const { order, points } = directorMascotGrowth(manifest);
    let stage = order[0] || null;
    order.forEach((key, i) => { if (total >= points[i]) stage = key; });
    return stage;
}

// A face set without the asked expression shows the nearest one it has, not a blank neutral.
const DIRECTOR_MASCOT_FACE_FALLBACK = {
    satisfied: ['happy', 'smug'],
    smug: ['satisfied', 'happy'],
    happy: ['satisfied', 'smug'],
    focused: ['thinking'],
    frustrated: ['thinking'],
    surprised: ['thinking'],
    sleepy: ['neutral']
};

class DirectorMascot {
    // options.isHosted(): true while she should show (the Director window, not Studio's inline panel).
    constructor(options = {}) {
        this.isHosted = typeof options.isHosted === 'function' ? options.isHosted : () => true;
        this.manifests = new Map();      // persona -> normalized manifest (or null when missing)
        this.persona = null;
        this.manifest = null;
        this.working = false;
        this.view = 'mascot';
        this.enabled = true;
        this.expression = 'neutral';
        this.expressionUntil = 0;
        this.turnDoneAt = 0;
        this.idleSince = Date.now();
        this.stageState = null;
        this.dialogue = { kind: 'idle', text: '' };
        this._timers = new Set();
        this._tick = null;
        this._blinkTimer = null;
        this._talkUntil = 0;
        this._talkTimer = null;
        this._lastAssistantLength = 0;
        // Visual novel view (#706): the message log stays hidden unless switched on; she thinks, talks,
        // and pops tool calls in bubbles, and the turn's result is its own panel beside her.
        this.showLog = false;
        this.renderResult = typeof options.renderResult === 'function' ? options.renderResult : null;
        this._toolSeen = 0;
        this._bubble = { think: '', say: '' };
        this.loadPrefs();
    }

    // ---- prefs ----
    loadPrefs() {
        try {
            const raw = JSON.parse(localStorage.getItem(DIRECTOR_MASCOT_PREFS_KEY) || '{}');
            if (raw && typeof raw === 'object') {
                if (raw.enabled === false) this.enabled = false;
                if (raw.view === 'messages') this.view = 'messages';
                if (raw.showLog === true) this.showLog = true;
            }
        } catch (_) { /* storage can be blocked */ }
    }

    savePrefs() {
        try {
            localStorage.setItem(DIRECTOR_MASCOT_PREFS_KEY, JSON.stringify({ enabled: this.enabled, view: this.view, showLog: this.showLog }));
        } catch (_) { /* storage can be blocked */ }
    }

    // ---- DOM ----
    mount(host) {
        if (!host || this.root) return;
        this.host = host;
        const root = document.createElement('div');
        root.className = 'director-mascot-stage';
        root.setAttribute('aria-hidden', 'true');
        root.innerHTML = `
            <div class="director-mascot">
                <div class="director-mascot-canvas">
                <div class="director-mascot-rig">
                    <img class="dm-layer dm-body-prev" alt="">
                    <img class="dm-layer dm-body" alt="">
                    <div class="dm-head">
                        <img class="dm-layer dm-head-img" alt="">
                        <img class="dm-layer dm-face" alt="">
                        <img class="dm-layer dm-blink" alt="">
                        <img class="dm-layer dm-mouth" alt="">
                    </div>
                </div>
                </div>
            </div>
            <div class="director-mascot-dialogue">
                <div class="dm-name"></div>
                <div class="dm-text"></div>
            </div>`;
        host.appendChild(root);
        this.root = root;
        // Bubbles, tool popups, and the result panel: outside her clipped stage, so the panel takes clicks.
        const layer = document.createElement('div');
        layer.className = 'dm-vn-layer';
        layer.innerHTML = `
            <div class="dm-bubble dm-think hidden"><div class="dm-bubble-text"></div></div>
            <div class="dm-bubble dm-say hidden"><div class="dm-bubble-text"></div></div>
            <div class="dm-tool-pops"></div>
            <div class="dm-result hidden"></div>`;
        host.appendChild(layer);
        this.layer = layer;
        this.el = {
            mascot: root.querySelector('.director-mascot'),
            canvas: root.querySelector('.director-mascot-canvas'),
            rig: root.querySelector('.director-mascot-rig'),
            bodyPrev: root.querySelector('.dm-body-prev'),
            body: root.querySelector('.dm-body'),
            head: root.querySelector('.dm-head'),
            headImg: root.querySelector('.dm-head-img'),
            face: root.querySelector('.dm-face'),
            blink: root.querySelector('.dm-blink'),
            mouth: root.querySelector('.dm-mouth'),
            dialogue: root.querySelector('.director-mascot-dialogue'),
            name: root.querySelector('.dm-name'),
            text: root.querySelector('.dm-text'),
            think: layer.querySelector('.dm-think'),
            thinkText: layer.querySelector('.dm-think .dm-bubble-text'),
            say: layer.querySelector('.dm-say'),
            sayText: layer.querySelector('.dm-say .dm-bubble-text'),
            pops: layer.querySelector('.dm-tool-pops'),
            result: layer.querySelector('.dm-result')
        };
        this.applyView();
        // She stands on the input bar wherever it sits (centred on a new chat, at the bottom later):
        // anything that moves or resizes it re-lays her out.
        if (typeof ResizeObserver === 'function') {
            this._resize = new ResizeObserver(() => this.layout());
            [host, host.querySelector('#directorComposer'), host.querySelector('.director-chat-input'), host.querySelector('.director-chat-messages-container')]
                .filter(Boolean).forEach((el) => this._resize.observe(el));
        }
        // The bar slides between the centred home and the bottom without resizing anything watched above:
        // follow the chat view's class (director-composer-center) and the composer's own transitions.
        if (typeof MutationObserver === 'function') {
            this._mutation = new MutationObserver(() => this.settleLayout());
            this._mutation.observe(host, { attributes: true, attributeFilter: ['class'] });
        }
        const composer = host.querySelector('#directorComposer');
        if (composer) composer.addEventListener('transitionend', () => this.layout());
        this._tick = setInterval(() => this.tick(), DIRECTOR_MASCOT_TICK_MS);
        this.scheduleBlink();
    }

    setEnabled(on) {
        this.enabled = on !== false;
        this.savePrefs();
        this.applyView();
    }

    setShowLog(on) {
        this.showLog = on === true;
        this.savePrefs();
        this.applyView();
    }

    // Bubbles and the result panel only in the visual novel view with the log hidden.
    vnBubbles() {
        return !!this._shown && this.view === 'mascot' && !this.showLog;
    }

    setView(view) {
        this.view = view === 'mascot' ? 'mascot' : 'messages';
        this.savePrefs();
        this.applyView();
    }

    applyView() {
        if (!this.root) return;
        const on = this.enabled && !!this.manifest && this.isHosted();
        const was = this._shown;
        this._shown = on;
        this.root.classList.toggle('hidden', !on);
        // Her layers are full-canvas sheets (5 x 2726 x 2413 at once, ~130 MB decoded): she holds
        // none while she is not shown (Director docked in Studio, mascot off), idle perf pass 2026-11-04
        if (!on && was !== false) this.releaseLayers();
        if (on && !was) {
            if (this.manifest && !this.manifest._preloaded) {
                this.manifest._preloaded = true;
                this.preload(this.manifest);
            }
            this.render();
        }
        this.root.dataset.view = this.view;
        if (this.host) {
            this.host.classList.toggle('director-mascot-view', on && this.view === 'mascot');
            // Her room behind the visual novel view; the log panel takes the side she does not stand on.
            const room = on && this.manifest.background ? `url("${this.manifest.base}${this.manifest.background}")` : 'none';
            this.host.style.setProperty('--dm-room', room);
            this.host.dataset.dmSide = this.manifest && this.manifest.anchor === 'left' ? 'left' : 'right';
            // Buttons she would cover (quick starts, attachment chips) move under the input bar.
            this.host.classList.toggle('director-mascot-on', on);
            this.host.classList.toggle('dm-log-hidden', on && this.view === 'mascot' && !this.showLog);
        }
        if (this.layer) {
            this.layer.classList.toggle('hidden', !(on && this.view === 'mascot' && !this.showLog));
            this.layer.dataset.side = this.manifest && this.manifest.anchor === 'left' ? 'left' : 'right';
        }
        this.root.dataset.state = this.working ? 'working' : 'idle';
        this.layout();
        this.paintDialogue();
    }

    // Fit the figure above the input bar: height from the view, width from the camera's aspect.
    // Visual novel log panel: the gap above the input bar matches the gap at its top (Yukimi 2026-11-01).
    // The composer floats in the docked view and sits in flow in the window, so measure rather than assume.
    fitLogPanel(composer) {
        const panel = this.host.querySelector('.director-chat-messages-container');
        if (!composer || !panel || this.view !== 'mascot' || this.host.classList.contains('director-composer-center')) return;
        const pb = panel.getBoundingClientRect();
        const cb = composer.getBoundingClientRect();
        if (!pb.height || !cb.height) return;
        const cs = getComputedStyle(panel);
        const top = parseFloat(cs.marginTop) || 0;
        const current = parseFloat(cs.marginBottom) || 0;
        // A larger bottom margin widens the gap one for one, whether the composer floats or sits in flow.
        const want = Math.max(0, Math.round(current + top - (cb.top - pb.bottom)));
        if (Math.abs(want - current) > 1) this.host.style.setProperty('--dm-composer-space', `${want}px`);
    }

    layout() {
        // not shown: nothing to measure (applyView lays her out again when she shows)
        if (!this.root || !this.manifest || !this.host || !this._shown) return;
        const hostBox = this.host.getBoundingClientRect();
        const composer = this.host.querySelector('#directorComposer');
        this.fitLogPanel(composer);
        const bar = composer && (composer.querySelector('.director-chat-input') || composer);
        const barBox = bar ? bar.getBoundingClientRect() : { top: hostBox.bottom, left: hostBox.left, right: hostBox.right, width: hostBox.width };
        const inset = 10;
        // Home (centred bar): she stands at the bottom of the chat area behind the bar and shows more of herself.
        const home = this.host.classList.contains('director-composer-center');
        this.root.classList.toggle('dm-home', home);
        this.root.style.setProperty('--dm-bottom', home ? '0px' : `${Math.max(0, Math.round(hostBox.bottom - barBox.top))}px`);
        this.root.style.setProperty('--dm-left', `${Math.max(inset, Math.round(barBox.left - hostBox.left) + inset)}px`);
        this.root.style.setProperty('--dm-right', `${Math.max(inset, Math.round(hostBox.right - barBox.right) + inset)}px`);
        const areaH = home ? Math.round(hostBox.height) : Math.max(0, Math.round(barBox.top - hostBox.top));
        const areaW = home ? Math.round(hostBox.width * 0.9) : Math.max(0, Math.round(barBox.width) - inset * 2);
        const [W, H] = this.manifest.size;
        const cam = this.camera();
        const vn = this.view === 'mascot';
        if (vn) {
            // Visual novel (Yukimi): her face rests at one spot for every pose and every persona: 24% in from
            // her side, 24% down (head top lands about 12 to 15% down), sized so faces match across personas.
            // The rest of her spills out of frame where it is bigger.
            const face = Array.isArray(this.manifest.face) ? this.manifest.face : [cam[0] + cam[2] / 2, cam[1] + cam[3] * 0.2, cam[2] * 0.15];
            const Wh = hostBox.width, Hh = hostBox.height;
            const kv = (Hh * 0.11) / Math.max(1, face[2]);
            const px = this.manifest.anchor === 'left' ? Wh * 0.24 : Wh * 0.76;
            const py = Hh * 0.24;
            this.root.style.setProperty('--dm-bottom', '0px');
            this.root.style.setProperty('--dm-left', '0px');
            this.root.style.setProperty('--dm-right', '0px');
            this.root.style.setProperty('--dm-w', `${Math.round(Wh)}px`);
            this.root.style.setProperty('--dm-h', `${Math.round(Hh)}px`);
            this.root.style.setProperty('--dm-drop', '0px');
            this.el.canvas.style.width = `${Math.round(W * kv)}px`;
            this.el.canvas.style.height = `${Math.round(H * kv)}px`;
            this.el.canvas.style.transform = `translate(${Math.round(px - face[0] * kv)}px, ${Math.round(py - face[1] * kv)}px)`;
            this._k = kv;
            this.root.dataset.anchor = this.manifest.anchor === 'left' ? 'left' : 'right';
            this.root.classList.remove('dm-narrow');
            const [vx, vy] = this.manifest.headPivot || [W / 2, H * 0.4];
            this.el.head.style.transformOrigin = `${(vx / W) * 100}% ${(vy / H) * 100}%`;
            return;
        }
        const share = home ? 0.9 : 0.62;   // messages view: idle drops below the bar edge (--dm-drop)
        let h = areaH * share;
        let w = h * (cam[2] / cam[3]);
        // Never wider than the room between her anchor and the far edge of the chat area.
        const anchorLeft = this.manifest.anchor === 'left';
        const fromEdge = anchorLeft ? Math.max(inset, Math.round(barBox.left - hostBox.left) + inset) : Math.max(inset, Math.round(hostBox.right - barBox.right) + inset);
        const room = Math.round(hostBox.width) - fromEdge - inset;
        // Visual novel: she keeps the room beside the log panel (measured, so she never slips behind it).
        let vnRoom = hostBox.width * 0.9;
        const panel = this.host.querySelector('.director-chat-messages-container');
        if (vn && !home && panel) {
            const p = panel.getBoundingClientRect();
            if (p.width) vnRoom = anchorLeft ? p.left - hostBox.left - fromEdge - 8 : hostBox.right - p.right - fromEdge - 8;
        }
        const maxW = Math.min(room, vn ? Math.max(120, vnRoom) : areaW * (home ? 1 : 0.7));
        if (w > maxW) { w = maxW; h = w * (cam[3] / cam[2]); }
        const k = h / cam[3];
        const shoulders = Number.isFinite(this.manifest.shouldersY)
            ? Math.max(0.15, Math.min(0.9, (this.manifest.shouldersY - cam[1]) / cam[3]))
            : (this.manifest.peekRatio || 0.4);
        const peek = !vn && !this.working && !home ? (1 - shoulders) * h : 0;
        this._k = k;
        this.root.style.setProperty('--dm-w', `${Math.round(w)}px`);
        this.root.style.setProperty('--dm-h', `${Math.round(h)}px`);
        this.root.style.setProperty('--dm-drop', `${Math.round(peek)}px`);
        this.el.canvas.style.width = `${Math.round(W * k)}px`;
        this.el.canvas.style.height = `${Math.round(H * k)}px`;
        this.el.canvas.style.transform = `translate(${-Math.round(cam[0] * k)}px, ${-Math.round(cam[1] * k)}px)`;
        this.root.dataset.anchor = this.manifest.anchor === 'left' ? 'left' : 'right';
        this.root.classList.toggle('dm-narrow', areaW < 360);
        const [px, py] = this.manifest.headPivot || [W / 2, H * 0.4];
        this.el.head.style.transformOrigin = `${(px / W) * 100}% ${(py / H) * 100}%`;
    }

    // Re-measure every frame for a moment (the bar slides between the centred home and the bottom).
    settleLayout(ms = 800) {
        if (!this._shown) return;
        if (typeof requestAnimationFrame !== 'function') { this.layout(); return; }
        this._settleUntil = Date.now() + ms;
        if (this._settling) return;
        this._settling = true;
        const step = () => {
            this.layout();
            if (Date.now() < this._settleUntil) requestAnimationFrame(step);
            else this._settling = false;
        };
        requestAnimationFrame(step);
    }

    // One camera for every pose of a persona: the union of the bodies' cameras (or the whole canvas), so a
    // stage change never shrinks or shifts her (Yukimi: the three versions stay aligned).
    camera() {
        const m = this.manifest;
        if (!m) return [0, 0, 1, 1];
        // refCamera: her starting pose's framing; bigger poses keep its scale and grow past it.
        if (Array.isArray(m.refCamera) && m.refCamera.length === 4 && m.refCamera[2] > 0 && m.refCamera[3] > 0) return m.refCamera;
        if (m._unionCamera) return m._unionCamera;
        let box = null;
        Object.values(m.bodies).forEach((b) => {
            const c = b && b.camera;
            if (!Array.isArray(c) || c.length !== 4) return;
            box = box ? [Math.min(box[0], c[0]), Math.min(box[1], c[1]), Math.max(box[2], c[0] + c[2]), Math.max(box[3], c[1] + c[3])] : [c[0], c[1], c[0] + c[2], c[1] + c[3]];
        });
        m._unionCamera = box ? [box[0], box[1], box[2] - box[0], box[3] - box[1]] : [0, 0, m.size[0], m.size[1]];
        return m._unionCamera;
    }

    // ---- manifests ----
    static normalize(raw, persona) {
        if (!raw || !Array.isArray(raw.size)) return null;
        const base = `${DIRECTOR_MASCOT_ROOT}/${persona}/`;
        if (raw.bodies) {
            return { ...raw, base };
        }
        // v1: one body, one face set, one stage.
        return {
            ...raw,
            base,
            bodies: { main: { body: raw.layers && raw.layers.body, head: raw.layers && raw.layers.head, faces: 'main' } },
            faceSets: { main: { expressions: raw.expressions || {}, blink: raw.blink, blinkFor: raw.blinkFor, mouth: raw.mouth } },
            stages: { main: { body: 'main' } },
            behaviour: { start: 'main' }
        };
    }

    async loadManifest(persona) {
        if (this.manifests.has(persona)) return this.manifests.get(persona);
        let manifest = null;
        try {
            const res = await fetch(`${DIRECTOR_MASCOT_ROOT}/${persona}/manifest.json`, { cache: 'no-cache' });
            if (res.ok) manifest = DirectorMascot.normalize(await res.json(), persona);
        } catch (_) { manifest = null; }
        this.manifests.set(persona, manifest);
        // preloaded on her first showing (applyView), not with the manifest
        return manifest;
    }

    preload(manifest) {
        const files = new Set();
        Object.values(manifest.bodies).forEach((b) => { if (b.body) files.add(b.body); if (b.head) files.add(b.head); });
        Object.values(manifest.faceSets).forEach((f) => {
            Object.values(f.expressions || {}).forEach((x) => files.add(x));
            if (f.blink) files.add(f.blink);
            if (f.mouth && f.mouth.talk) files.add(f.mouth.talk);
        });
        files.forEach((file) => { const img = new Image(); img.decoding = 'async'; img.src = manifest.base + file; });
    }

    async setPersona(persona) {
        const key = persona === 'xi' || persona === 'kabuki' ? persona : 'wren';
        if (key === this.persona && this.manifest) return;
        this.persona = key;
        // another persona's sheets: the shown check below loads hers instead
        if (this._shown) this._shown = null;
        const manifest = await this.loadManifest(key);
        if (this.persona !== key) return;      // switched again while loading
        this.manifest = manifest;
        this.resetStage();
        if (this.el) this.el.name.textContent = manifest ? manifest.name : '';
        this.applyView();
        this.render();
        this.settleLayout();
    }

    // ---- stage machine ----
    resetStage() {
        const m = this.manifest;
        const start = m && m.behaviour && m.behaviour.start && m.stages[m.behaviour.start] ? m.behaviour.start : (m ? Object.keys(m.stages)[0] : null);
        this.stageState = {
            stage: start,
            workingSince: 0,
            firstKickAt: 0,
            nextKickAt: 0,
            kickUntil: 0,
            gestureUntil: 0,
            printedUntil: 0,     // stage.printed: the body after a print sinks in (Yumiya's vore belly)
            celebrateUntil: 0,   // stage.celebrate: the body when a turn lands (Yumiya's wings)
            transition: null
        };
    }

    stageDef() {
        const m = this.manifest;
        return m && this.stageState ? m.stages[this.stageState.stage] || null : null;
    }

    currentBodyId(now = Date.now()) {
        const st = this.stageState;
        if (!st) return null;
        if (st.transition) return st.transition.frames[st.transition.index] || st.transition.via || null;
        const def = this.stageDef();
        if (!def) return null;
        if (def.celebrate && now < st.celebrateUntil) return def.celebrate;
        if (def.printed && now < st.printedUntil) return def.printed;
        const alt = def.rub || def.gesture;
        const altKicky = def.rubKicky || def.gestureKicky;
        const kicking = now < st.kickUntil;
        const gesturing = now < st.gestureUntil && !!alt;
        if (kicking && gesturing && altKicky) return altKicky;
        if (kicking && def.kicky) return def.kicky;
        if (gesturing) return alt;
        return def.body;
    }

    advanceTo(next) {
        const m = this.manifest; const st = this.stageState;
        if (!m || !st || !m.stages[next] || st.transition) return;
        const from = st.stage;
        const t = m.transitions && m.transitions[`${from}>${next}`];
        st.kickUntil = 0;
        st.gestureUntil = 0;
        this._swapMs = 650;
        if (!t || !Array.isArray(t.frames) || !t.frames.length) {
            st.stage = next;
            st.firstKickAt = 0;
            st.nextKickAt = 0;
            this.render();
            return;
        }
        const frames = (t.via ? [t.via] : []).concat(t.frames);
        st.transition = { frames, index: 0, to: next };
        const step = () => {
            if (!st.transition) return;
            st.transition.index += 1;
            if (st.transition.index >= frames.length) {
                st.transition = null;
                st.stage = next;
                st.firstKickAt = 0;
                st.nextKickAt = 0;
                this.act('bounce');
            } else {
                this.later(step, t.frameMs || 420);
            }
            this.render();
        };
        this.render();
        this.later(step, t.frameMs || 420);
    }

    tick(now = Date.now()) {
        if (!this.manifest || !this.stageState || (typeof document !== 'undefined' && document.hidden)) return;
        const st = this.stageState; const b = this.manifest.behaviour || {};
        if (st.transition) return;
        // Advance rules (old timed growth). A manifest with behaviour.growth grows from report cards instead.
        (b.growth ? [] : (b.advance || [])).forEach((rule) => {
            if (rule.from !== st.stage || st.transition) return;
            if (rule.afterWorkingSec && this.working && st.workingSince && now - st.workingSince >= rule.afterWorkingSec * 1000) this.advanceTo(rule.to);
            else if (rule.afterFirstKickSec && st.firstKickAt && now - st.firstKickAt >= rule.afterFirstKickSec * 1000) this.advanceTo(rule.to);
        });
        if (st.transition) return;
        // Back to the start after a long idle.
        const reset = b.reset;
        if (reset && reset.idleSec && !b.growth && !this.working && now - this.idleSince >= reset.idleSec * 1000 && st.stage !== reset.to) {
            this.resetStage();
            this.render();
            return;
        }
        // Random kicks.
        const kicky = b.kicky;
        if (kicky && kicky.stage === st.stage && this.stageDef() && (this.stageDef().kicky || this.stageDef().rubKicky || this.stageDef().gestureKicky)) {
            if (!st.nextKickAt) st.nextKickAt = now + directorMascotRand(kicky.everySec, 45) * 1000;
            if (now >= st.nextKickAt) {
                st.kickUntil = now + directorMascotRand(kicky.durationMs, 2500);
                if (!st.firstKickAt) st.firstKickAt = now;
                st.nextKickAt = now + directorMascotRand(kicky.everySec, 45) * 1000;
                if (kicky.jiggle) this.act('jiggle');
                // Half the kicks catch her off guard (Yukimi: sometimes surprised / "oh").
                if (Math.random() < 0.5) this.cue({ expression: 'surprised', holdMs: 1400 });
                // The kick fades in and back out instead of popping.
                this._swapMs = 450;
                this.render();
                this.later(() => { this._swapMs = 450; this.render(); }, st.kickUntil - now + 20);
            }
        }
        // Random rubs / gestures (chance per minute).
        const gesture = b.rub || b.gesture;
        const stages = gesture && (gesture.stages || [gesture.stage]);
        // whenWorking: Yumiya's mask is for focus, never for idling.
        const gestureOk = gesture && (!gesture.whenWorking || this.working);
        if (gestureOk && stages.includes(st.stage) && now >= st.gestureUntil && Math.random() < (gesture.chance || 0) / 60) {
            st.gestureUntil = now + directorMascotRand(gesture.durationSec, 8) * 1000;
            this.render();
            this.later(() => this.render(), st.gestureUntil - now + 20);
        }
        // Expression hold ran out: back to the state default.
        if (this.expressionUntil && now >= this.expressionUntil) {
            this.expressionUntil = 0;
            this.renderFace();
        } else if (!this.working && !this.expressionUntil && now - this.idleSince > DIRECTOR_MASCOT_SLEEPY_MS && this.expression !== 'sleepy') {
            this.renderFace();
        }
    }

    // ---- inputs from the Director ----
    onChatChange() {
        const reset = this.manifest && this.manifest.behaviour && this.manifest.behaviour.reset;
        if (reset && reset.onChatChange) this.resetStage();
        this._growthArmed = false;   // the next chat's stage is set quietly from its own cards
        this._bubble = { think: '', say: '' };
        this.hideResult();
        this.dialogue = { kind: 'idle', text: '' };
        this._lastAssistantLength = 0;
        this.setWorking(false);
        this.render();
        this.settleLayout();
    }

    onUserSend() {
        this.dialogue = { kind: 'thinking', text: '' };
        this._lastAssistantLength = 0;
        this._toolSeen = -1;     // the first stream update sets the baseline (a reload mid-turn pops nothing old)
        this._bubble = { think: '', say: '' };
        this.hideResult();
        this.setWorking(true);
        this.paintDialogue();
        this.paintBubbles();
    }

    onStream(payload) {
        if (!payload) return;
        this.setWorking(true);
        if (payload.mascot) this.cue(payload.mascot);
        const live = payload.live;
        if (live && (live.type === 'thinking' || live.type === 'assistant')) {
            const text = String(live.text || '');
            this.dialogue = { kind: live.type, text };
            if (live.type === 'assistant' && text.length > this._lastAssistantLength) this.talk();
            this._lastAssistantLength = live.type === 'assistant' ? text.length : this._lastAssistantLength;
            this.paintDialogue();
        }
        this.streamBubbles(payload);
    }

    // ---- visual novel bubbles ----
    streamBubbles(payload) {
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        const tools = rows.filter((row) => row && row.type === 'tool');
        if (this._toolSeen < 0 || this._toolSeen > tools.length) this._toolSeen = tools.length;
        tools.slice(this._toolSeen).slice(-3).forEach((row) => this.popTool(row));
        this._toolSeen = tools.length;
        // The bubble is her newest thought or line: the live row, else the newest finished thinking or
        // reply row. It stays up while tools run (they pop beside it) until she thinks or talks again.
        const live = payload.live && payload.live.text && (payload.live.type === 'thinking' || payload.live.type === 'assistant') ? payload.live : null;
        let latest = live;
        for (let i = rows.length - 1; i >= 0 && !latest; i--) {
            const row = rows[i];
            if (row && (row.type === 'thinking' || row.type === 'assistant') && row.text) latest = row;
        }
        const lastOf = (type) => (latest && latest.type === type && latest.text ? String(latest.text) : '');
        this._bubble = { think: lastOf('thinking'), say: lastOf('assistant') };
        this.paintBubbles();
    }

    paintBubbles() {
        if (!this.el || !this.el.think) return;
        const on = this.vnBubbles() && this.working;
        const clip = (text, max) => {
            const t = String(text || '').replace(/\s+/g, ' ').trim();
            return t.length > max ? `\u2026${t.slice(-max)}` : t;
        };
        const think = on ? clip(this._bubble.think, 240) : '';
        const say = on ? clip(this._bubble.say, 420) : '';
        // One bubble at a time: talking wins over thinking.
        this.el.think.classList.toggle('hidden', !think || !!say);
        this.el.say.classList.toggle('hidden', !say);
        if (this.el.thinkText.textContent !== think) this.el.thinkText.textContent = think;
        if (this.el.sayText.textContent !== say) this.el.sayText.textContent = say;
    }

    popTool(row) {
        if (!this.el || !this.el.pops || !this.vnBubbles()) return;
        const label = String((row && (row.label || row.name)) || '').replace(/_/g, ' ').trim();
        if (!label) return;
        const pop = document.createElement('div');
        pop.className = 'dm-tool-pop';
        const name = document.createElement('span');
        name.className = 'dm-tool-pop-name';
        name.textContent = label;
        pop.appendChild(name);
        const detail = String((row && row.detail) || '').replace(/\s+/g, ' ').trim();
        if (detail) {
            const more = document.createElement('span');
            more.className = 'dm-tool-pop-detail';
            more.textContent = detail.length > 70 ? `${detail.slice(0, 70)}\u2026` : detail;
            pop.appendChild(more);
        }
        this.el.pops.appendChild(pop);
        while (this.el.pops.children.length > 3) this.el.pops.firstElementChild.remove();
        this.later(() => pop.classList.add('dm-out'), 2600);
        this.later(() => pop.remove(), 3100);
    }

    hideResult() {
        if (!this.el || !this.el.result) return;
        this.el.result.classList.add('hidden');
        this.el.result.replaceChildren();
        this._resultFor = '';
    }

    // The settled turn: its report (summary, card, suggestions) as its own panel beside her; a reply
    // without a report shows as her speech bubble.
    showResult(messages) {
        if (!this.el || !this.el.result) return;
        if (!this.vnBubbles()) { this.hideResult(); return; }
        let last = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (!m || m.role === 'event') continue;
            last = m;
            break;
        }
        if (!last || last.role !== 'assistant') { this.hideResult(); return; }
        const report = last.data && last.data.report;
        const key = `${last.id || last.timestamp}|${report ? (report.review ? 'r' : 'n') : 'x'}`;
        if (this._resultFor === key && !this.el.result.classList.contains('hidden')) return;
        this._resultFor = key;
        const el = this.renderResult ? this.renderResult(last) : null;
        if (!el) { this.hideResult(); return; }
        this.el.result.replaceChildren(el);
        this.el.result.classList.remove('hidden');
        this.el.result.scrollTop = 0;
    }

    // A timed body override for this stage (celebrate / printed), then back.
    showFor(key, fallbackSec) {
        const def = this.stageDef(); const st = this.stageState;
        if (!def || !st || !def[key]) return;
        const cfg = (this.manifest.behaviour || {})[key] || {};
        const until = Date.now() + (Number(cfg.durationSec) || fallbackSec) * 1000;
        st[`${key}Until`] = until;
        this._swapMs = 260;
        this.render();
        this.later(() => { this._swapMs = 260; this.render(); }, until - Date.now() + 20);
    }

    onTurnEnd(ok) {
        // The settled messages (onMessages) carry the new report card; the stage moves then.
        if (ok !== false) this._growthArmed = true;
        if (ok !== false) this.showFor('celebrate', 3);
        this.setWorking(false);
        this.turnDoneAt = Date.now();
        this.cue(ok === false ? { expression: 'frustrated', action: 'slump', holdMs: 4000 } : { expression: 'happy', action: 'bounce', holdMs: 3500 });
    }

    // The settled chat: the last assistant reply stays in the dialogue box until the next ask.
    onMessages(messages) {
        if (this.working || !Array.isArray(messages)) return;
        this.applyGrowth(messages);
        this.paintBubbles();
        this.showResult(messages);
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (!m || m.role !== 'assistant') continue;
            const text = String(m.content || '').trim();
            if (!text) continue;
            this.dialogue = { kind: 'reply', text };
            this.paintDialogue();
            return;
        }
    }

    // Stage from the chat's report cards. After a completed turn she grows (or shrinks after a harsh
    // rescore) with the transition; opening a chat sets the stage quietly.
    applyGrowth(messages) {
        const m = this.manifest; const st = this.stageState;
        if (!m || !st || !m.behaviour || !m.behaviour.growth) return;
        const total = directorMascotGrowthPoints(messages);
        this.growthPoints = total;
        const target = directorMascotStageFor(m, total);
        const armed = this._growthArmed === true;
        this._growthArmed = false;
        if (!target || target === st.stage || st.transition) return;
        if (!armed) {
            st.stage = target;
            st.firstKickAt = 0;
            st.nextKickAt = 0;
            this.render();
            return;
        }
        const { order } = directorMascotGrowth(m);
        const up = order.indexOf(target) > order.indexOf(st.stage);
        // after the celebrate pose, so the turn lands first and the growth reads as its reward
        const cfg = m.behaviour.celebrate || {};
        this.later(() => {
            if (this.stageState !== st || st.stage === target) return;
            this.advanceTo(target);
            this.cue(up ? { expression: 'surprised', action: 'bounce', holdMs: 1800 } : { expression: 'frustrated', action: 'slump', holdMs: 3000 });
        }, ((Number(cfg.durationSec) || 3) * 1000) + 200);
    }

    setWorking(on) {
        const now = Date.now();
        if (on && !this.working) {
            this.working = true;
            if (this.stageState) this.stageState.workingSince = now;
            this.idleSince = 0;
        } else if (!on && this.working) {
            this.working = false;
            if (this.stageState) {
                this.stageState.workingSince = 0;
                const g = this.manifest && this.manifest.behaviour && (this.manifest.behaviour.gesture || this.manifest.behaviour.rub);
                if (g && g.whenWorking) this.stageState.gestureUntil = 0;   // mask down when she stops
            }
            this.idleSince = now;
        }
        if (this.root) this.root.dataset.state = this.working ? 'working' : 'idle';
        this.layout();
        this.renderFace();
        this.paintBubbles();
    }

    cue(cue) {
        if (!cue || typeof cue !== 'object') return;
        if (cue.expression) {
            // Yumiya's mask pose only has three faces: a mood it cannot show ends the gesture early.
            const st = this.stageState; const set = this.faceSet();
            if (st && set && set.expressions && !set.expressions[cue.expression] && Date.now() < st.gestureUntil) {
                st.gestureUntil = 0;
                this._swapMs = 260;
                this.render();
            }
            this.expression = String(cue.expression);
            this.expressionUntil = Date.now() + (Number(cue.holdMs) || 2500);
            this.renderFace(this.expression);
        }
        if (cue.action) this.act(String(cue.action));
    }

    // ---- animation helpers ----
    later(fn, ms) {
        const id = setTimeout(() => { this._timers.delete(id); fn(); }, Math.max(0, ms));
        this._timers.add(id);
        return id;
    }

    act(action) {
        if (!this.el || !/^[a-z-]+$/.test(action)) return;
        // hidden: no keyframe restart (its offsetWidth read forces a layout of the page)
        if (this._shown === false) return;
        const target = this.el.rig;   // the face moves with the body, kicks included
        const cls = `dm-act-${action}`;
        target.classList.remove(cls);
        void target.offsetWidth;      // restart the keyframes
        target.classList.add(cls);
        this.later(() => target.classList.remove(cls), 1600);
    }

    scheduleBlink() {
        clearTimeout(this._blinkTimer);
        this._blinkTimer = setTimeout(() => {
            this.blink();
            this.scheduleBlink();
        }, 2500 + Math.random() * 3500);
    }

    blink() {
        const set = this.faceSet();
        if (!this.el || !set || !set.blink || (typeof document !== 'undefined' && document.hidden)) return;
        // not rendered (Studio's chat pane folded, window closed): no class flips to restyle
        if (typeof this.el.blink.checkVisibility === 'function' && !this.el.blink.checkVisibility()) return;
        const expr = this.shownExpression();
        if (Array.isArray(set.blinkFor) && !set.blinkFor.includes(expr)) return;
        this.el.blink.classList.add('dm-on');
        setTimeout(() => this.el.blink.classList.remove('dm-on'), 140);
    }

    talk() {
        this._talkUntil = Date.now() + 650;
        if (this._talkTimer) return;
        const flap = () => {
            if (!this.el) return;
            if (Date.now() > this._talkUntil) {
                this.el.mouth.classList.remove('dm-on');
                this._talkTimer = null;
                return;
            }
            this.el.mouth.classList.toggle('dm-on');
            this._talkTimer = setTimeout(flap, 120);
        };
        flap();
    }

    // ---- rendering ----
    faceSet() {
        const m = this.manifest; const id = this.currentBodyId();
        const body = m && id ? m.bodies[id] : null;
        return body ? m.faceSets[body.faces] || null : null;
    }

    shownExpression() {
        const now = Date.now();
        if (this.expressionUntil && now < this.expressionUntil) return this.expression;
        if (this.working) return 'focused';
        if (!this.working && this.idleSince && now - this.idleSince > DIRECTOR_MASCOT_SLEEPY_MS) return 'sleepy';
        return 'neutral';
    }

    /** Drops every layer's picture; render() sets them again when she shows. */
    releaseLayers() {
        if (!this.el) return;
        [this.el.bodyPrev, this.el.body, this.el.headImg, this.el.face, this.el.blink, this.el.mouth].forEach((img) => {
            if (img && img.hasAttribute('src')) img.removeAttribute('src');
        });
    }

    renderFace(expr) {
        if (!this.el || !this.manifest || !this._shown) return;
        const set = this.faceSet();
        if (!set) return;
        const want = expr || this.shownExpression();
        const near = (DIRECTOR_MASCOT_FACE_FALLBACK[want] || []).find((key) => set.expressions[key]);
        const file = set.expressions[want] || (near && set.expressions[near]) || set.expressions.neutral || Object.values(set.expressions)[0];
        const url = file ? this.manifest.base + file : '';
        if (this.el.face.getAttribute('src') !== url) this.el.face.setAttribute('src', url);
        const blink = set.blink ? this.manifest.base + set.blink : '';
        if (this.el.blink.getAttribute('src') !== blink) this.el.blink.setAttribute('src', blink);
        const mouth = set.mouth && set.mouth.talk ? this.manifest.base + set.mouth.talk : '';
        if (this.el.mouth.getAttribute('src') !== mouth) this.el.mouth.setAttribute('src', mouth);
    }

    render() {
        if (!this.el || !this.manifest || !this._shown) return;
        const id = this.currentBodyId();
        const body = id ? this.manifest.bodies[id] : null;
        if (!body) return;
        const src = this.manifest.base + body.body;
        const old = this.el.body.getAttribute('src');
        if (old !== src) {
            // Crossfade: the old body fades out over the new one (slow on a stage change, quick for kicks and rubs).
            const ms = this._swapMs || 180;
            this._swapMs = 0;
            if (old) {
                const prev = this.el.bodyPrev;
                prev.style.transition = 'none';
                prev.setAttribute('src', old);
                prev.style.opacity = '1';
                void prev.offsetWidth;
                prev.style.transition = `opacity ${ms}ms ease`;
                prev.style.opacity = '0';
            }
            this.el.body.setAttribute('src', src);
            if (this._camKey !== JSON.stringify(this.camera())) {
                this._camKey = JSON.stringify(this.camera());
                this.layout();
            }
        }
        const head = body.head ? this.manifest.base + body.head : '';
        if (this.el.headImg.getAttribute('src') !== head) this.el.headImg.setAttribute('src', head);
        this.el.head.classList.toggle('dm-no-tilt', !body.head);
        this.root.dataset.stage = this.stageState ? this.stageState.stage || '' : '';
        this.renderFace();
    }

    paintDialogue() {
        if (!this.el) return;
        const d = this.dialogue;
        // The visual novel view shows the log panel instead; the box stays for a log-less layout later.
        const show = false && !!(d.text || d.kind === 'thinking');
        this.el.dialogue.classList.toggle('hidden', !show);
        this.el.dialogue.dataset.kind = d.kind;
        const text = d.text || (d.kind === 'thinking' ? '…' : '');
        if (this.el.text.textContent !== text) {
            this.el.text.textContent = text;
            this.el.text.scrollTop = this.el.text.scrollHeight;
        }
    }

    // A finished print: a polaroid of it drifts in from the log side and fades into her belly; she is
    // pleased with herself.
    onPrint(url, options = {}) {
        if (!this.root || !this.manifest || !url || this.root.classList.contains('hidden')) return;
        const id = this.currentBodyId();
        const body = id ? this.manifest.bodies[id] : null;
        const k = this._k || 1;
        const cam = this.camera();
        const canvasBox = this.el.canvas.getBoundingClientRect();
        const stage = this.root.getBoundingClientRect();
        if (!canvasBox.width) return;
        const belly = (body && body.belly) || [cam[0] + cam[2] / 2, cam[1] + cam[3] * 0.62];
        const bx = canvasBox.left - stage.left + belly[0] * k;
        const by = canvasBox.top - stage.top + belly[1] * k;
        const left = this.manifest.anchor === 'left';
        let sx = left ? stage.width * 0.72 : stage.width * 0.28;
        let sy = stage.height * 0.42;
        // From its thumbnail in the prints strip when that is on screen (Yukimi: the images drop in from there).
        const from = options.from;
        const fromBox = from && (typeof from.checkVisibility !== 'function' || from.checkVisibility()) ? from.getBoundingClientRect() : null;
        const fromStrip = !!(fromBox && fromBox.width > 4 && fromBox.height > 4);
        const card = document.createElement('div');
        card.className = 'dm-polaroid';
        const img = document.createElement('img');
        img.alt = '';
        img.src = (fromStrip && from.currentSrc) || url;
        card.appendChild(img);
        const w = Math.max(110, Math.min(190, stage.width * 0.16));
        let tx = bx;
        let ty = by;
        if (fromStrip) {
            // The strip sits outside her clipped stage: fly on a fixed layer in viewport coordinates.
            card.classList.add('dm-polaroid-fixed');
            document.body.appendChild(card);
            sx = fromBox.left + fromBox.width / 2;
            sy = fromBox.top + fromBox.height / 2;
            tx += stage.left;
            ty += stage.top;
        } else {
            this.root.appendChild(card);
        }
        card.style.width = `${Math.round(w)}px`;
        const place = (x, y) => `translate(${Math.round(x - w / 2)}px, ${Math.round(y - w * 0.6)}px)`;
        const tilt = left ? 7 : -7;
        const done = () => {
            card.remove();
            this.showFor('printed', 6);
            const set = this.faceSet();
            this.cue({ expression: set && set.expressions && set.expressions.satisfied ? 'satisfied' : 'happy', action: 'bounce', holdMs: 4000 });
            this.later(() => this.act('jiggle'), 380);
        };
        const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced || typeof card.animate !== 'function') {
            this.later(done, 600);
            return;
        }
        // From the strip: it starts at the thumbnail's size, lifts out, then arcs down into her belly.
        const startScale = fromStrip ? Math.max(0.2, Math.min(1, fromBox.width / w)) : 0.6;
        const arcX = fromStrip ? sx + (tx - sx) * 0.45 : sx;
        const arcY = fromStrip ? Math.min(sy, ty) - stage.height * 0.06 : sy;
        const anim = card.animate([
            { transform: `${place(sx, fromStrip ? sy : sy + 40)} rotate(0deg) scale(${startScale})`, opacity: fromStrip ? 1 : 0, filter: 'blur(0px)' },
            { transform: `${place(fromStrip ? sx + (left ? -12 : 12) : sx, sy)} rotate(${tilt}deg) scale(1)`, opacity: 1, offset: 0.18 },
            { transform: `${place(arcX, arcY)} rotate(${tilt / 2}deg) scale(0.9)`, opacity: 1, offset: 0.45 },
            { transform: `${place(tx, ty)} rotate(0deg) scale(0.35)`, opacity: 0.85, filter: 'blur(0px)', offset: 0.82 },
            { transform: `${place(tx, ty)} rotate(0deg) scale(0.15)`, opacity: 0, filter: 'blur(3px)' }
        ], { duration: 2600, easing: 'ease-in-out', fill: 'forwards' });
        anim.onfinish = done;
        this.cue({ expression: 'surprised', holdMs: 1200 });
    }

    // Test hook: the stage machine state without the DOM.
    debugState() {
        const st = this.stageState || {};
        return { persona: this.persona, stage: st.stage, body: this.currentBodyId(), transition: st.transition ? st.transition.frames[st.transition.index] : null, working: this.working, expression: this.shownExpression(), view: this.view };
    }
}

if (typeof window !== 'undefined') window.DirectorMascot = DirectorMascot;
if (typeof module !== 'undefined' && module.exports) module.exports = { DirectorMascot, directorMascotGrowthPoints, directorMascotStageFor, directorMascotGrowth };
