// Director mascot (#688): Wren (Nonoka), Kabuki (Chiyo), and Xi (Yozora), layered sprites cut from
// Yukimi's sprite sets (public/static_images/director-mascots/<persona>/manifest.json).
//
// Two views (Yukimi 2026-10-31): "mascot" (the default) is a visual novel: her room fills the chat, she
// stands on her side, and the log (messages, thinking, tool calls) is a glass panel on the other side, top
// most. "messages" keeps the plain log and puts her at the input bar edge (head and shoulders peek while
// idle, she rises while a turn runs). A finished print flies in as a polaroid and she eats it: mouth
// open, a few chews, a gulp, then her belly answers (#742).
//
// Manifest v1: one body + head + expressions. v2: bodies (each names a faceSet), stages (base / bigger /
// ...), transitions (in-between frames between stages), and behaviour (advance rules, kicks, gestures).
// behaviour.growth.steps: in-between sizes inside a stage ({ at: points, suffix }): the stage's bodies
// with that suffix (`base_g1`), warped from the real sprites by scripts/director-mascot-build.js.
// Cues (expression + action) come from the server on director_streaming_update (modules/directorMascot.js).

const DIRECTOR_MASCOT_ROOT = '/static_images/director-mascots';
const DIRECTOR_MASCOT_PREFS_KEY = 'staticforge_director_mascot_v2';   // v2: the visual novel view is the default
const DIRECTOR_MASCOT_TICK_MS = 1000;
const DIRECTOR_MASCOT_SLEEPY_MS = 3 * 60 * 1000;

function directorMascotRand(range, fallback) {
    if (!Array.isArray(range) || range.length < 2) return fallback;
    return range[0] + Math.random() * (range[1] - range[0]);
}

// Growth (#704; reworked 2026-11-06): her stage follows the chat's report cards, not time spent working.
// Each card is one result: its hit ratio (hit 1, partial 0.5, miss 0; the user's rescore wins over the
// agent's marks) earns or costs points, so a long all-hit card no longer jumps her to the top at once and
// a missed goal takes points away. The total, never below zero, picks the stage from behaviour.growth.
const DIRECTOR_MASCOT_ITEM_VALUE = { hit: 1, partial: 0.5, miss: 0 };

function directorMascotCardPoints(ratio) {
    if (ratio >= 0.9) return 2;
    if (ratio >= 0.7) return 1;
    if (ratio >= 0.5) return 0;
    if (ratio >= 0.25) return -1;
    return -2;
}

function directorMascotGrowthPoints(messages) {
    let total = 0;
    (Array.isArray(messages) ? messages : []).forEach((message) => {
        const report = message && message.role === 'assistant' && message.data && message.data.report;
        const items = report && report.card && Array.isArray(report.card.items) ? report.card.items : [];
        if (!items.length) return;
        const reviewed = report.review && Array.isArray(report.review.scores) ? report.review.scores : [];
        const sum = items.reduce((acc, item, at) => {
            const score = reviewed[at] in DIRECTOR_MASCOT_ITEM_VALUE ? reviewed[at] : item && item.score;
            return acc + (DIRECTOR_MASCOT_ITEM_VALUE[score] || 0);
        }, 0);
        total = Math.max(0, total + directorMascotCardPoints(sum / items.length));
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

// The in-between size inside a stage: the suffix of the last step the points have reached ('' = none).
function directorMascotStepFor(manifest, stage, total) {
    const g = manifest && manifest.behaviour && manifest.behaviour.growth;
    const steps = g && g.steps && Array.isArray(g.steps[stage]) ? g.steps[stage] : [];
    let suffix = '';
    steps.forEach((step) => { if (step && total >= step.at) suffix = String(step.suffix || ''); });
    return suffix;
}

// A face set without the asked expression shows the nearest one it has, not a blank neutral.
const DIRECTOR_MASCOT_FACE_FALLBACK = {
    satisfied: ['happy', 'smug'],
    smug: ['satisfied', 'happy'],
    happy: ['satisfied', 'smug'],
    focused: ['thinking'],
    frustrated: ['thinking'],
    surprised: ['thinking'],
    sleepy: ['neutral'],
    eat: ['surprised', 'happy'],
    lick: ['satisfied', 'happy', 'smug']
};

// The line as it was plus the new snapshot's text after the first `visible` characters (markers do
// not count), so markers already typed stay put: feedReader's merge for snapshots that disagree.
function directorMascotKeepMarks(oldRaw, visible, newRaw) {
    let seen = 0;
    let i = 0;
    for (; i < newRaw.length && seen < visible; i++) {
        if (newRaw[i] !== '*') seen += 1;
    }
    const marks = (t) => (t.match(/\*/g) || []).length;
    // the new copy carries at least the markers the old one had: it is the cleaner one, take it whole
    if (marks(newRaw.slice(0, i)) >= marks(oldRaw)) return newRaw;
    const tail = newRaw.slice(i);
    // a marker at the join belongs to the new text; drop the old copy's own trailing markers then,
    // or "*a*" + "* b" would read as "*a** b"
    return (tail.startsWith('*') ? oldRaw.replace(/\*+$/, '') : oldRaw) + tail;
}

// The typed part of a VN line with its emphasis already applied: **bold** and *italic* markers are
// read as they come, the first `count` visible characters are emitted (from `start`), and open tags are
// closed at the cut. Typing never switches between plain text and HTML, so italics do not flicker.
function directorMascotTypedHtml(raw, count, start = 0) {
    const text = String(raw || '');
    const esc = (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c);
    const open = [];
    let out = '';
    let seen = 0;
    let started = start <= 0;
    for (let i = 0; i < text.length && seen < count; i++) {
        const tag = text.startsWith('**', i) ? 'strong' : (text[i] === '*' ? 'em' : '');
        if (tag) {
            if (tag === 'strong') i += 1;
            const at = open.lastIndexOf(tag);
            if (at >= 0) {
                // close back to it, then reopen what was inside
                const inner = open.splice(at);
                inner.slice().reverse().forEach((t) => { if (started) out += `</${t}>`; });
                inner.slice(1).forEach((t) => { open.push(t); if (started) out += `<${t}>`; });
            } else {
                open.push(tag);
                if (started) out += `<${tag}>`;
            }
            continue;
        }
        seen += 1;
        if (!started && seen > start) {
            started = true;
            out += '…' + open.map((t) => `<${t}>`).join('');
        }
        if (started) out += esc(text[i]);
    }
    if (started) out += open.slice().reverse().map((t) => `</${t}>`).join('');
    return out;
}

class DirectorMascot {
    // options.isHosted(): true while she should show (the Director window, not Studio's inline panel).
    constructor(options = {}) {
        this.isHosted = typeof options.isHosted === 'function' ? options.isHosted : () => true;
        this.manifests = new Map();      // persona -> normalized manifest (or null when missing)
        this.persona = null;
        this.manifest = null;
        this.working = false;
        this._thinkAloud = false;
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
        // Quick-menu actions owned by the Director (prints pane, settings).
        this.actions = options.actions && typeof options.actions === 'object' ? options.actions : {};
        this._hud = null;
        this._toolSeen = 0;
        this._rowSeen = -1;
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
            <div class="dm-bubble dm-think hidden" title="Her thinking: hover to peek, click to have her think aloud in the text box"><span class="dm-think-dots"><i></i><i></i><i></i></span><div class="dm-think-full"></div></div>
            <div class="dm-bubble dm-say hidden"><div class="dm-bubble-text"></div></div>
            <div class="dm-tool-pops"></div>
            <div class="dm-banner hidden"><b class="dm-banner-title"></b><span class="dm-banner-sub"></span></div>
            <div class="dm-hud hidden">
                <div class="dm-hud-chip"><b data-hud="turns">0</b><span>turns</span></div>
                <div class="dm-hud-chip"><b data-hud="prints">0</b><span>prints</span></div>
                <div class="dm-hud-chip dm-hud-ring" title="Hit ratio of the last report card"><div class="dm-ring"><span data-hud="ratio">-</span></div></div>
                <div class="dm-hud-chip dm-hud-grow" title="Growth from report cards"><span data-hud="stage"></span><div class="dm-grow-bar"><i data-hud="grow"></i></div><span class="dm-grow-next" data-hud="next"></span></div>
            </div>
            <!-- Font Awesome on purpose (Yukimi 2026-11-06): the VN quick bar is game UI drawn over her
                 scene, not Vista chrome, and the white glyph sits in an accent-coloured disc. -->
            <div class="dm-quick hidden" role="toolbar" aria-label="Director quick menu">
                <button type="button" data-act="reply"><i class="fas fa-comment-dots" aria-hidden="true"></i>Reply</button>
                <button type="button" data-act="card"><i class="fas fa-clipboard-check" aria-hidden="true"></i>Report card</button>
                <button type="button" data-act="log"><i class="fas fa-list" aria-hidden="true"></i>Log</button>
                <button type="button" data-act="prints"><i class="fas fa-images" aria-hidden="true"></i>Prints</button>
                <button type="button" data-act="settings"><i class="fas fa-gear" aria-hidden="true"></i>Settings</button>
            </div>
            <button type="button" class="dm-peek-close hidden" title="Close the log (Esc)">Back to her</button>
            <div class="dm-result dm-dialog hidden" data-tab="reply">
                <i class="dm-dialog-edge" aria-hidden="true"></i>
                <div class="dm-dialog-head">
                    <span class="dm-dialog-name"></span>
                    <div class="dm-dialog-tabs" role="tablist">
                        <button type="button" class="dm-dialog-tab" role="tab" data-tab="reply" aria-selected="true">Reply</button>
                        <button type="button" class="dm-dialog-tab" role="tab" data-tab="card" aria-selected="false">Report card</button>
                    </div>
                    <button type="button" class="dm-dialog-peek" aria-pressed="false" title="Show the message log for a moment">Log</button>
                </div>
                <div class="dm-dialog-body"></div>
                <span class="dm-dialog-working" aria-label="Still working"><i></i><i></i><i></i>working</span>
                <span class="dm-dialog-pager hidden"></span>
                <div class="dm-dialog-suggest"></div>
            </div>`;
        host.appendChild(layer);
        this.layer = layer;
        // The thought cloud belongs to her head (#742): it sits in a layer inside the head element, so
        // the head's sway and every move of the rig (breathing, bounce, nod, chewing) carry it on the
        // compositor. It keeps the .dm-vn-layer class, so the bubble's styles apply unchanged.
        const headLayer = document.createElement('div');
        headLayer.className = 'dm-vn-layer dm-head-layer';
        headLayer.appendChild(layer.querySelector('.dm-think'));
        root.querySelector('.dm-head').appendChild(headLayer);
        this.headLayer = headLayer;
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
            think: headLayer.querySelector('.dm-think'),
            thinkFull: headLayer.querySelector('.dm-think-full'),
            say: layer.querySelector('.dm-say'),
            sayText: layer.querySelector('.dm-say .dm-bubble-text'),
            pops: layer.querySelector('.dm-tool-pops'),
            result: layer.querySelector('.dm-result'),
            dialogName: layer.querySelector('.dm-dialog-name'),
            dialogBody: layer.querySelector('.dm-dialog-body'),
            dialogSuggest: layer.querySelector('.dm-dialog-suggest'),
            tabReply: layer.querySelector('.dm-dialog-tab[data-tab="reply"]'),
            tabCard: layer.querySelector('.dm-dialog-tab[data-tab="card"]'),
            peekBtn: layer.querySelector('.dm-dialog-peek'),
            pager: layer.querySelector('.dm-dialog-pager'),
            peekClose: layer.querySelector('.dm-peek-close')
        };
        this.el.peekClose.addEventListener('click', () => this.togglePeek(false));
        // Click the thought cloud: her live thinking streams into the text box, as if she thinks aloud.
        this.el.think.addEventListener('click', () => this.toggleThinkAloud());
        this.el.banner = layer.querySelector('.dm-banner');
        this.el.hud = layer.querySelector('.dm-hud');
        this.el.quick = layer.querySelector('.dm-quick');
        this.el.quick.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-act]');
            if (btn) this.quickAction(btn.dataset.act);
        });
        this.el.tabReply.addEventListener('click', () => this.showTab('reply'));
        this.el.tabCard.addEventListener('click', () => this.showTab('card'));
        this.el.peekBtn.addEventListener('click', () => this.togglePeek());
        this.el.pager.addEventListener('click', () => this.pageReply());
        // A click on the reply text pages it; links and buttons inside keep their own clicks.
        this.el.dialogBody.addEventListener('click', (event) => {
            if (event.target.closest('a, button, input, select, textarea')) return;
            this.pageReply();
        });
        this.el.dialogBody.addEventListener('scroll', () => this.paintPager(), { passive: true });
        host.addEventListener('keydown', (event) => { if (event.key === 'Escape' && this.peek) this.togglePeek(false); });
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
            // The Director around the chat (list, composer) wears the VN buttons while her view is on.
            const container = this.host.closest('#directorContainer');
            if (container) container.classList.toggle('dm-vn-on', on && this.view === 'mascot');
            if (!(on && this.view === 'mascot' && !this.showLog)) this.host.classList.remove('dm-log-peek');
        }
        if (this.layer) {
            this.layer.classList.toggle('hidden', !(on && this.view === 'mascot' && !this.showLog));
            this.layer.dataset.side = this.manifest && this.manifest.anchor === 'left' ? 'left' : 'right';
        }
        if (this.headLayer) {
            this.headLayer.classList.toggle('hidden', !(on && this.view === 'mascot' && !this.showLog));
            this.headLayer.dataset.side = this.manifest && this.manifest.anchor === 'left' ? 'left' : 'right';
        }
        this.root.dataset.state = this.working ? 'working' : 'idle';
        this.layout();
        this.paintDialogue();
        this.paintChrome();
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

    // Inline custom property on the stage, written only when it changes: an unchanged write still
    // invalidates the stage's style and costs a frame (#735).
    setVar(name, value) {
        const cache = this._vars || (this._vars = new Map());
        if (cache.get(name) === value && this.root.style.getPropertyValue(name) === value) return;
        cache.set(name, value);
        this.root.style.setProperty(name, value);
    }

    setStyle(el, prop, value) {
        if (el && el.style[prop] !== value) el.style[prop] = value;
    }

    layout() {
        // not shown: nothing to measure (applyView lays her out again when she shows)
        if (!this.root || !this.manifest || !this.host || !this._shown) return;
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { this.placeResult(); this.placeChrome(); });
        const hostBox = this.host.getBoundingClientRect();
        const composer = this.host.querySelector('#directorComposer');
        this.fitLogPanel(composer);
        const bar = composer && (composer.querySelector('.director-chat-input') || composer);
        const barBox = bar ? bar.getBoundingClientRect() : { top: hostBox.bottom, left: hostBox.left, right: hostBox.right, width: hostBox.width };
        const inset = 10;
        // Home (centred bar): she stands at the bottom of the chat area behind the bar and shows more of herself.
        const home = this.host.classList.contains('director-composer-center');
        this.root.classList.toggle('dm-home', home);
        this.setVar('--dm-bottom', home ? '0px' : `${Math.max(0, Math.round(hostBox.bottom - barBox.top))}px`);
        this.setVar('--dm-left', `${Math.max(inset, Math.round(barBox.left - hostBox.left) + inset)}px`);
        this.setVar('--dm-right', `${Math.max(inset, Math.round(hostBox.right - barBox.right) + inset)}px`);
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
            this.setVar('--dm-bottom', '0px');
            this.setVar('--dm-left', '0px');
            this.setVar('--dm-right', '0px');
            this.setVar('--dm-w', `${Math.round(Wh)}px`);
            this.setVar('--dm-h', `${Math.round(Hh)}px`);
            this.setVar('--dm-drop', '0px');
            this.setStyle(this.el.canvas, 'width', `${Math.round(W * kv)}px`);
            this.setStyle(this.el.canvas, 'height', `${Math.round(H * kv)}px`);
            this.setStyle(this.el.canvas, 'transform', `translate(${Math.round(px - face[0] * kv)}px, ${Math.round(py - face[1] * kv)}px)`);
            this._k = kv;
            this.root.dataset.anchor = this.manifest.anchor === 'left' ? 'left' : 'right';
            this.root.classList.remove('dm-narrow');
            const [vx, vy] = this.manifest.headPivot || [W / 2, H * 0.4];
            this.setStyle(this.el.head, 'transformOrigin', `${(vx / W) * 100}% ${(vy / H) * 100}%`);
            this.placeThink(face, kv, px - face[0] * kv, py - face[1] * kv, Wh);
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
        this.setVar('--dm-w', `${Math.round(w)}px`);
        this.setVar('--dm-h', `${Math.round(h)}px`);
        this.setVar('--dm-drop', `${Math.round(peek)}px`);
        this.setStyle(this.el.canvas, 'width', `${Math.round(W * k)}px`);
        this.setStyle(this.el.canvas, 'height', `${Math.round(H * k)}px`);
        this.setStyle(this.el.canvas, 'transform', `translate(${-Math.round(cam[0] * k)}px, ${-Math.round(cam[1] * k)}px)`);
        this.root.dataset.anchor = this.manifest.anchor === 'left' ? 'left' : 'right';
        this.root.classList.toggle('dm-narrow', areaW < 360);
        const [px, py] = this.manifest.headPivot || [W / 2, H * 0.4];
        this.setStyle(this.el.head, 'transformOrigin', `${(px / W) * 100}% ${(py / H) * 100}%`);
    }

    // The thought cloud beside her head, in the head's own coordinates (canvas pixels times k): up and
    // out from her face on the side the chat is, under the banner row, never wider than the room left.
    placeThink(face, k, canvasX, canvasY, stageW) {
        const think = this.el && this.el.think;
        if (!think) return;
        const left = this.manifest.anchor === 'left';
        const top0 = parseInt(this.layer.style.getPropertyValue('--dm-top'), 10) || 12;
        const narrow = stageW < 520;
        const minScreenY = top0 + (narrow ? 44 : 72);
        const y = Math.max((face[1] - face[2] * 1.6) * k, minScreenY - canvasY);
        const out = face[2] * (narrow ? 0.75 : 1.05) * k;
        const edge = left ? face[0] * k + out : face[0] * k - out;
        const screenX = canvasX + edge;
        const room = Math.max(120, Math.round((left ? stageW - screenX : screenX) - 12));
        this.setStyle(think, 'top', `${Math.round(y)}px`);
        this.setStyle(think, 'left', left ? `${Math.round(edge)}px` : 'auto');
        this.setStyle(think, 'right', left ? 'auto' : `${Math.round(this.manifest.size[0] * k - edge)}px`);
        this.setStyle(think, 'maxWidth', `${room}px`);
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
        // Faces for every set; bodies only for the stage and size she is at. The growth frames are many
        // (#742) and load when she gets near them (preloadBodies).
        const files = new Set();
        this.preloadBodies(this.stageBodyIds());
        Object.values(manifest.faceSets).forEach((f) => {
            Object.values(f.expressions || {}).forEach((x) => files.add(x));
            if (f.blink) files.add(f.blink);
            if (f.mouth && f.mouth.talk) files.add(f.mouth.talk);
        });
        files.forEach((file) => { const img = new Image(); img.decoding = 'async'; img.src = manifest.base + file; });
    }

    // Body ids the current stage can show, at her size and the next one up.
    stageBodyIds() {
        const m = this.manifest; const st = this.stageState; const def = this.stageDef();
        if (!m || !st || !def) return [];
        const g = m.behaviour && m.behaviour.growth;
        const steps = g && g.steps && Array.isArray(g.steps[st.stage]) ? g.steps[st.stage].map((x) => x.suffix) : [];
        const at = steps.indexOf(st.step || '');
        const sizes = [st.step || '', steps[at + 1]].filter((x) => x != null);
        const ids = [];
        [...new Set(Object.values(def))].forEach((id) => sizes.forEach((sfx) => { if (m.bodies[id + sfx]) ids.push(id + sfx); }));
        return ids;
    }

    // Fetch and decode body sheets ahead of a swap; resolves when they are ready (or failed).
    preloadBodies(ids) {
        const m = this.manifest;
        // SYNC: a thenable that runs at once where there is nothing to wait for (no pictures to
        // load: the node tests), so stage changes there stay in step with the test's clock
        const SYNC = { then(fn) { fn(); return SYNC; } };
        if (!m || typeof Image === 'undefined') return SYNC;
        const cache = m._loaded || (m._loaded = new Map());
        const jobs = [];
        (ids || []).forEach((id) => {
            const b = m.bodies[id];
            if (!b) return;
            [b.body, b.head].filter(Boolean).forEach((file) => {
                if (!cache.has(file)) {
                    const img = new Image();
                    img.decoding = 'async';
                    img.src = m.base + file;
                    cache.set(file, typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve());
                }
                jobs.push(cache.get(file));
            });
        });
        return Promise.all(jobs);
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
            step: '',            // in-between size inside the stage (behaviour.growth.steps suffix)
            eatUntil: 0,         // a print is on its way to her mouth: no mask, no gesture over it
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
        return this.sized(this.poseId(def, st, now));
    }

    poseId(def, st, now) {
        const eating = now < st.eatUntil;
        if (def.celebrate && now < st.celebrateUntil && !eating) return def.celebrate;
        if (def.printed && now < st.printedUntil) return def.printed;
        const alt = def.rub || def.gesture;
        const altKicky = def.rubKicky || def.gestureKicky;
        const kicking = now < st.kickUntil;
        const gesturing = now < st.gestureUntil && !!alt && !eating;
        if (kicking && gesturing && altKicky) return altKicky;
        if (kicking && def.kicky) return def.kicky;
        if (gesturing) return alt;
        return def.body;
    }

    // The pose at her in-between size, when the stage has that frame.
    sized(id) {
        const sfx = this.stageState && this.stageState.step;
        return sfx && this.manifest.bodies[id + sfx] ? id + sfx : id;
    }

    // A stage change morphs: her growth frames up to the edge of this stage, then the next stage's
    // arrival frames (its belly a little smaller), each crossfading into the next. Shrinking plays the
    // same frames backwards. step: the in-between size she lands on in the new stage.
    advanceTo(next, step = '') {
        const m = this.manifest; const st = this.stageState;
        if (!m || !st || !m.stages[next] || st.transition) return;
        const from = st.stage;
        const land = () => {
            st.stage = next;
            st.step = step;
            st.firstKickAt = 0;
            st.nextKickAt = 0;
            this.preloadBodies(this.stageBodyIds());
        };
        const up = m.transitions && m.transitions[`${from}>${next}`];
        const down = m.transitions && m.transitions[`${next}>${from}`];
        const t = up || down;
        st.kickUntil = 0;
        st.gestureUntil = 0;
        this._swapMs = 650;
        let frames = t && Array.isArray(t.frames) ? (t.via ? [t.via] : []).concat(t.frames).filter((id) => m.bodies[id]) : [];
        if (!up && down) frames = frames.slice().reverse();
        // frames she has already passed (she stood at _g1 or _g2) are not played again
        const here = this.currentBodyId();
        const at = frames.indexOf(here);
        if (at >= 0) frames = frames.slice(at + 1);
        if (!frames.length) {
            land();
            this.render();
            return;
        }
        const frameMs = t.frameMs || 420;
        st.transition = { frames, index: 0, to: next };
        const show = () => { this._swapMs = Math.round(frameMs * 1.15); this.render(); };
        const step1 = () => {
            if (!st.transition || this.stageState !== st) return;
            st.transition.index += 1;
            if (st.transition.index >= frames.length) {
                st.transition = null;
                land();
                this.act('bounce');
                this.later(() => this.act('jiggle'), 420);
            } else {
                this.later(step1, frameMs);
            }
            show();
        };
        // every frame decoded first, so no crossfade lands on a picture still loading
        const target = m.stages[next].body;
        this.preloadBodies(frames.concat([target, target + step])).then(() => {
            if (!st.transition || this.stageState !== st) return;
            show();
            this.later(step1, frameMs);
        });
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
        this._rowSeen = -1;
        this._thinking = null;
        this.resetReader();
        this.hideResult();
        this.togglePeek(false);
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
        this._rowSeen = 0;       // a turn this tab started reads every line of it
        this._bubble = { think: '', say: '' };
        this.resetReader();
        this.hideResult();
        this.togglePeek(false);
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
        const tools = rows.filter((row) => row && row.type === 'tool' && row.name !== 'say');
        if (this._toolSeen < 0 || this._toolSeen > tools.length) this._toolSeen = tools.length;
        tools.slice(this._toolSeen).slice(-3).forEach((row) => this.popTool(row));
        this._toolSeen = tools.length;
        // What she says: say lines and reply text, in order, read at human pace. A reload mid-turn
        // starts from now (the first update sets the baseline), so old lines are not read again.
        if (this._rowSeen < 0 || this._rowSeen > rows.length) this._rowSeen = rows.length;
        rows.slice(this._rowSeen).forEach((row) => {
            if (!row) return;
            if (row.type === 'tool' && row.name === 'say' && row.detail) this.feedReader('assistant', row.detail);
            else if (row.type === 'assistant' && row.text) this.feedReader('assistant', row.text);
        });
        this._rowSeen = rows.length;
        const live = payload.live && payload.live.text ? payload.live : null;
        if (live && live.type === 'assistant') this.feedReader('assistant', live.text);
        // What she thinks: the ". . ." cloud; hovering it shows the newest thinking, live.
        let thinking = live && live.type === 'thinking' ? live.text : '';
        for (let i = rows.length - 1; i >= 0 && !thinking; i--) {
            if (rows[i] && rows[i].type === 'thinking' && rows[i].text) thinking = rows[i].text;
        }
        this._thinking = { text: String(thinking || ''), live: !!(live && live.type === 'thinking') };
        this.paintBubbles();
    }

    // ---- paced bubble reader (Yukimi 2026-11-06: human reading speed, and slow enough to fill the time
    // tools take). Thoughts and lines queue; the bubble types the current one at READ_CPS and holds it a
    // moment when done. A row that keeps growing (live text) extends the current item. A long backlog
    // skips ahead to the newest so she never lags a whole turn behind.
    feedReader(kind, text) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!clean) return;
        const r = this._reader || (this._reader = { queue: [], current: null, shown: 0, holdUntil: 0 });
        const last = r.queue.length ? r.queue[r.queue.length - 1] : r.current;
        const plain = clean.replace(/\*+/g, '');
        if (last && last.kind === kind && (plain === last.text || plain.startsWith(last.text) || last.text.startsWith(plain))) {
            // Snapshots of the same line can disagree on its emphasis (a lossy partial without the
            // * markers, then the clean copy): the line keeps the markers it has already been typed
            // with and only takes the new tail, so typed words never flip between plain and italic.
            if (plain.length > last.text.length) {
                last.raw = directorMascotKeepMarks(last.raw, last.text.length, clean);
                last.text = plain;
            } else if (plain === last.text && (clean.match(/\*/g) || []).length > (last.raw.match(/\*/g) || []).length) {
                last.raw = clean;
            }
            this.startReader();
            return;
        }
        r.queue.push({ kind, text: clean.replace(/\*+/g, ''), raw: clean });
        // Over three behind: keep only the newest waiting item.
        if (r.queue.length > 3) r.queue.splice(0, r.queue.length - 1);
        this.startReader();
    }

    startReader() {
        if (this._readerTimer) return;
        const READ_CPS = 20;
        const STEP_MS = 50;
        const tick = () => {
            this._readerTimer = null;
            const r = this._reader;
            if (!r || !this.working) return;
            const now = Date.now();
            if (!r.current || (r.shown >= r.current.text.length && now >= r.holdUntil && r.queue.length)) {
                if (!r.queue.length) { this.paintBubbles(); return; }
                r.current = r.queue.shift();
                r.shown = 0;
            }
            // A very long thought with newer ones waiting: jump to its last few sentences.
            if (r.queue.length && r.current.text.length - r.shown > 500) r.shown = r.current.text.length - 300;
            if (r.shown < r.current.text.length) {
                // Behind on a backlog: read a little faster rather than drop words.
                const speed = READ_CPS * (r.queue.length ? 1.6 : 1);
                r.shown = Math.min(r.current.text.length, r.shown + (speed * STEP_MS) / 1000);
                if (r.shown >= r.current.text.length) {
                    const words = r.current.text.split(' ').length;
                    r.holdUntil = Date.now() + Math.min(4000, 1200 + words * 40);
                }
            }
            this.paintBubbles();
            const waiting = r.shown < r.current.text.length || r.queue.length;
            if (waiting) this._readerTimer = setTimeout(tick, STEP_MS);
        };
        this._readerTimer = setTimeout(tick, 0);
    }

    resetReader() {
        if (this._readerTimer) clearTimeout(this._readerTimer);
        this._readerTimer = null;
        this._reader = { queue: [], current: null, shown: 0, holdUntil: 0 };
    }

    // While she works, her lines (say, reply text) type into the same VN text box the summary uses, in
    // live mode with a working marker (Yukimi 2026-11-06); the turn's result replaces it when she is done.
    startLive() {
        if (!this.el || !this.el.result) return;
        this._result = null;
        this._resultFor = '';
        this._tab = 'reply';
        const box = this.el.result;
        box.dataset.mode = 'live';
        box.dataset.tab = 'reply';
        const name = (this.manifest && this.manifest.name) || '';
        this.el.dialogName.textContent = this._thinkAloud ? `${name} (thinking)` : name;
        this.el.dialogSuggest.replaceChildren();
        const line = document.createElement('div');
        line.className = 'director-message-content dm-dialog-reply dm-dialog-live';
        this.el.dialogBody.replaceChildren(line);
        this.el.liveLine = line;
        this._sayKey = '';
        box.classList.remove('hidden');
        this.placeResult();
        this.paintChrome();
    }

    toggleThinkAloud(on) {
        this._thinkAloud = typeof on === 'boolean' ? on : !this._thinkAloud;
        this._sayKey = '';
        if (this.el && this.el.dialogName) {
            const name = (this.manifest && this.manifest.name) || '';
            this.el.dialogName.textContent = this._thinkAloud && this.working ? `${name} (thinking)` : name;
        }
        this.paintBubbles();
    }

    endLive() {
        if (!this.el || !this.el.result || this.el.result.dataset.mode !== 'live') return;
        this.el.result.dataset.mode = '';
        this.el.liveLine = null;
        this.hideResult();
    }

    paintBubbles() {
        if (!this.el || !this.el.think) return;
        const on = this.vnBubbles() && this.working;
        // The old speech bubble stays hidden: her lines are in the text box now.
        this.el.say.classList.add('hidden');
        if (on && this.el.result.dataset.mode !== 'live') this.startLive();
        if (!on) this.endLive();
        // Boolean on purpose: _thinkAloud starts undefined, and toggle(name, undefined) flips the class on
        // every paint, so her live line blinked between the italic thinking style and plain text all turn.
        const aloud = !!(on && this._thinkAloud && this.el.liveLine);
        this.el.result.classList.toggle('dm-think-aloud', aloud);
        this.el.think.classList.toggle('dm-think-on', on && !!this._thinkAloud);
        if (aloud) {
            // Thinking aloud: the newest thinking, live, kept scrolled to its end.
            const text = this._thinking ? this._thinking.text : '';
            const key = `a:${text.length}`;
            if (this._sayKey !== key) {
                this._sayKey = key;
                this.el.liveLine.textContent = text;
                this.el.dialogBody.scrollTop = this.el.dialogBody.scrollHeight;
            }
        } else if (on && this.el.liveLine) {
            const r = this._reader;
            const item = r && r.current ? r.current : null;
            const shown = item ? Math.floor(r.shown) : 0;
            const typing = !!item && r.shown < item.text.length;
            this.el.result.classList.toggle('dm-typing', typing);
            const key = item ? `${item.raw.length}:${shown}:${typing ? 1 : 0}` : '';
            if (this._sayKey !== key) {
                this._sayKey = key;
                // Long lines keep their last 480 characters in view.
                const from = Math.max(0, shown - 480);
                const html = item ? directorMascotTypedHtml(item.raw, shown, from) : '';
                this.el.liveLine.innerHTML = html ? `\u201c${html}${typing ? '' : '\u201d'}` : '';
                this.el.dialogBody.scrollTop = this.el.dialogBody.scrollHeight;
            }
        }
        // The thought cloud shows ". . ." while she works; its full text only on hover.
        const thinking = on && this._thinking ? this._thinking.text : '';
        this.el.think.classList.toggle('hidden', !on);
        this.el.think.classList.toggle('dm-thinking-live', on && !!(this._thinking && this._thinking.live));
        this.el.think.classList.toggle('dm-has-thought', !!thinking);
        const full = this.el.thinkFull;
        if (full && full.textContent !== thinking) {
            const pinned = full.scrollHeight - full.scrollTop - full.clientHeight < 24;
            full.textContent = thinking;
            if (pinned) full.scrollTop = full.scrollHeight;
        }
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
        this.el.dialogBody.replaceChildren();
        this.el.dialogSuggest.replaceChildren();
        this._resultFor = '';
        this._result = null;
        this.paintChrome();
    }

    // The settled turn as a visual novel dialogue box above the input bar (Yukimi 2026-11-06): her name
    // plate, two tabs (Reply, Report card), the reply paged by click, suggestions under it as buttons, and a
    // Log button that slides the full log in for a moment. renderResult (director.js) builds the parts.
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
        const parts = this.renderResult ? this.renderResult(last) : null;
        if (!parts || !parts.reply) { this.hideResult(); return; }
        this.el.result.dataset.mode = 'result';
        this.el.result.classList.remove('dm-typing');
        this.el.liveLine = null;
        this._resultFor = key;
        this._result = parts;
        this.el.dialogName.textContent = (this.manifest && this.manifest.name) || parts.name || '';
        this.el.tabCard.classList.toggle('hidden', !parts.card);
        this.el.dialogSuggest.replaceChildren(...(parts.suggestions ? [parts.suggestions] : []));
        this.el.result.classList.remove('hidden');
        this.showTab('reply');
        this.placeResult();
        this.paintChrome();
    }

    showTab(tab) {
        const parts = this._result;
        if (!parts || !this.el) return;
        const want = tab === 'card' && parts.card ? 'card' : 'reply';
        this._tab = want;
        this.el.tabReply.setAttribute('aria-selected', want === 'reply' ? 'true' : 'false');
        this.el.tabCard.setAttribute('aria-selected', want === 'card' ? 'true' : 'false');
        this.el.result.dataset.tab = want;
        this.el.dialogBody.replaceChildren(want === 'card' ? parts.card : parts.reply);
        this.el.dialogBody.scrollTop = 0;
        this.paintChrome();
        this.placeResult();
        this.paintPager();
    }

    // Reply paging: a click shows the next page (the box height), the last page goes back to the top.
    pageReply() {
        const body = this.el && this.el.dialogBody;
        if (!body || this._tab !== 'reply') return;
        const page = Math.max(40, body.clientHeight - 24);
        const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
        body.scrollTo({ top: atEnd ? 0 : body.scrollTop + page, behavior: 'smooth' });
        this.later(() => this.paintPager(), 380);
    }

    paintPager() {
        const body = this.el && this.el.dialogBody;
        if (!body) return;
        const pages = Math.max(1, Math.ceil(body.scrollHeight / Math.max(1, body.clientHeight - 24) - 0.05));
        const at = Math.min(pages, Math.floor(body.scrollTop / Math.max(1, body.clientHeight - 24)) + 1);
        const more = this._tab === 'reply' && pages > 1;
        this.el.pager.classList.toggle('hidden', !more);
        this.el.pager.textContent = more ? `${at}/${pages} ▼` : '';
    }

    // The VN GUI takes the chat's workspace colour (Yukimi 2026-11-06): one hex in, the palette out.
    // A very light colour is darkened first so white text on the name plate and buttons still reads.
    setAccent(hex) {
        if (!this.layer) return;
        const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
        const props = ['--dm-teal', '--dm-teal-deep', '--dm-hi', '--dm-line', '--dm-track', '--dm-tint'];
        // On the chat host and the whole Director (chat list, composer) too, so their VN buttons use them.
        const container = this.host ? this.host.closest('#directorContainer') : null;
        const targets = [this.layer, this.headLayer, this.host, container].filter(Boolean);
        if (!m) { targets.forEach((t) => props.forEach((p) => t.style.removeProperty(p))); this._accent = ''; return; }
        let h = m[1];
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        if (this._accent === h) return;
        this._accent = h;
        let rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
        const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
        const mix = (c, to, t) => c.map((v, i) => Math.round(v + (to[i] - v) * t));
        const css = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        while (lum(rgb) > 0.58) rgb = mix(rgb, [0, 0, 0], 0.15);
        const white = [255, 255, 255];
        const black = [0, 0, 0];
        const set = {
            '--dm-teal': css(rgb),
            '--dm-teal-deep': css(mix(rgb, black, 0.3)),
            '--dm-hi': css(mix(rgb, white, 0.28)),
            '--dm-line': css(mix(rgb, white, 0.55)),
            '--dm-track': css(mix(rgb, white, 0.82)),
            '--dm-tint': css(mix(rgb, white, 0.93))
        };
        targets.forEach((t) => Object.entries(set).forEach(([k, v]) => t.style.setProperty(k, v)));
    }

    // ---- VN chrome: quick-menu bar, title banner, session HUD (Yukimi 2026-11-06) ----
    quickAction(act) {
        if (act === 'reply' || act === 'card') {
            if (this.peek) this.togglePeek(false);
            if (this._result) this.showTab(act);
        } else if (act === 'log') {
            this.togglePeek();
        } else if (typeof this.actions[act] === 'function') {
            this.actions[act]();
        }
        this.paintChrome();
    }

    // info: { title, sub, turns, prints, ratio (0..1 or null) } from director.js paintMascotHud.
    updateHud(info) {
        this._hud = info || null;
        this.setAccent(info && info.color);
        this.paintChrome();
    }

    paintChrome() {
        if (!this.el || !this.el.quick) return;
        const on = this.vnBubbles() && !(this.host && this.host.classList.contains('director-composer-center'));
        const hud = on ? this._hud : null;
        this.el.banner.classList.toggle('hidden', !hud);
        this.el.hud.classList.toggle('hidden', !hud);
        this.el.quick.classList.toggle('hidden', !on);
        if (hud) {
            this.el.banner.querySelector('.dm-banner-title').textContent = hud.title || '';
            this.el.banner.querySelector('.dm-banner-sub').textContent = this.working ? `${hud.sub || ''} · WORKING`.replace(/^ · /, '') : (hud.sub || '');
            const set = (key, value) => { const node = this.el.hud.querySelector(`[data-hud="${key}"]`); if (node && node.textContent !== String(value)) node.textContent = String(value); };
            set('turns', hud.turns || 0);
            set('prints', hud.prints || 0);
            const pct = hud.ratio == null ? null : Math.round(hud.ratio * 100);
            set('ratio', pct == null ? '-' : `${pct}%`);
            this.el.hud.querySelector('.dm-ring').style.setProperty('--p', pct == null ? 0 : pct);
            // Growth: points toward the next stage (behaviour.growth).
            const g = this.manifest ? directorMascotGrowth(this.manifest) : { order: [], points: [] };
            const pts = Number(this.growthPoints) || 0;
            let at = 0;
            g.points.forEach((need, i) => { if (pts >= need) at = i; });
            const next = g.points[at + 1];
            const from = g.points[at] || 0;
            set('stage', g.order.length ? `Stage ${at + 1}/${g.order.length}` : 'Stage');
            set('next', next != null ? `${pts} / ${next} pts` : `${pts} pts · max`);
            const fill = next != null ? Math.max(0, Math.min(1, (pts - from) / Math.max(0.01, next - from))) : 1;
            this.el.hud.querySelector('[data-hud="grow"]').style.width = `${Math.round(fill * 100)}%`;
        }
        const tab = this._result && !this.el.result.classList.contains('hidden') ? this._tab : '';
        this.el.quick.querySelectorAll('button[data-act]').forEach((btn) => {
            const act = btn.dataset.act;
            const pressed = act === 'log' ? !!this.peek : (!this.peek && act === tab);
            btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
            if (act === 'card') btn.disabled = !(this._result && this._result.card);
            if (act === 'reply') btn.disabled = !this._result;
        });
        this.placeChrome();
    }

    // The quick bar rides the dialogue's bottom edge, or sits above the input bar when there is no box.
    placeChrome() {
        if (!this.el || !this.el.quick || !this.layer || !this.host) return;
        const composer = this.host.querySelector('#directorComposer');
        const l = this.layer.getBoundingClientRect();
        const c = composer ? composer.getBoundingClientRect() : null;
        const base = c && c.height && l.height ? Math.max(0, Math.round(l.bottom - c.top + 6)) : 10;
        this.el.quick.style.bottom = `${base}px`;
        // The banner row starts under the "This session belongs to ..." strip when it shows.
        const strip = document.getElementById('directorWorkspaceBanner');
        const sb = strip && !strip.classList.contains('hidden') && this.host.contains(strip) ? strip.getBoundingClientRect() : null;
        const top = sb && sb.height && sb.bottom > l.top ? Math.round(sb.bottom - l.top + 8) : 12;
        this.layer.style.setProperty('--dm-top', `${top}px`);
    }

    // Log peek: the full log over the dialogue for a moment; Log again, Escape, or the next send closes it.
    togglePeek(on) {
        this.peek = typeof on === 'boolean' ? on : !this.peek;
        if (this.host) this.host.classList.toggle('dm-log-peek', this.peek && this.vnBubbles());
        if (this.el && this.el.peekBtn) this.el.peekBtn.setAttribute('aria-pressed', this.peek ? 'true' : 'false');
        // While the log is open the dialogue box steps aside (Yukimi: hide, do not overlap); a small
        // Back to her button takes its place.
        // The quick bar's Log button closes it again (the old Back to her button stays hidden).
        if (this.el && this.el.peekClose) this.el.peekClose.classList.add('hidden');
        this.paintChrome();
        if (this.peek && this.host) {
            const list = this.host.querySelector('.director-chat-messages');
            const scroller = list && list.closest('.director-chat-messages-container');
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
        }
    }

    // The box spans the chat above the input bar, a third of the height at most.
    placeResult() {
        const box = this.el && this.el.result;
        if (!box || box.classList.contains('hidden') || !this.host || !this.layer) return;
        const composer = this.host.querySelector('#directorComposer');
        const l = this.layer.getBoundingClientRect();
        if (!l.height) return;
        const c = composer ? composer.getBoundingClientRect() : null;
        const bottom = c && c.height ? Math.max(0, Math.round(l.bottom - c.top + 8)) : 12;
        // The quick bar sits on the box's bottom edge: lift the box by half the bar.
        box.style.bottom = `${bottom + 16}px`;
        if (this._tab === 'card') {
            // Report card: a full view from under the banner row down to the quick bar (Yukimi 2026-11-06).
            const top = (parseInt(this.layer.style.getPropertyValue('--dm-top'), 10) || 12) + 70;
            box.style.top = `${top}px`;
            box.style.maxHeight = 'none';
        } else {
            box.style.top = 'auto';
            // Small hosts (the Studio-docked Director) give the box a larger share of the height.
            const share = l.height < 640 ? 0.55 : 0.42;
            box.style.maxHeight = `${Math.round(Math.max(160, Math.min(l.height * share, 380)))}px`;
        }
        this.paintPager();
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
        const step = target ? directorMascotStepFor(m, target, total) : '';
        const armed = this._growthArmed === true;
        this._growthArmed = false;
        if (!target || st.transition || (target === st.stage && step === (st.step || ''))) return;
        if (!armed) {
            st.stage = target;
            st.step = step;
            st.firstKickAt = 0;
            st.nextKickAt = 0;
            this.preloadBodies(this.stageBodyIds());
            this.render();
            return;
        }
        const { order } = directorMascotGrowth(m);
        const steps = (m.behaviour.growth.steps && m.behaviour.growth.steps[target]) || [];
        const rank = (stage, sfx) => order.indexOf(stage) * 10 + steps.findIndex((x) => x.suffix === sfx) + 1;
        const up = rank(target, step) > rank(st.stage, st.step || '') || order.indexOf(target) > order.indexOf(st.stage);
        // after the celebrate pose, so the turn lands first and the growth reads as its reward
        const cfg = m.behaviour.celebrate || {};
        const wait = ((Number(cfg.durationSec) || 3) * 1000) + 200;
        if (target === st.stage) {
            // an in-between size inside the stage: a slow crossfade into the next frame
            const ids = [...new Set(Object.values(m.stages[target]))].map((id) => id + step);
            this.preloadBodies(ids);
            this.later(() => {
                if (this.stageState !== st || st.stage !== target || st.transition) return;
                this.preloadBodies([m.stages[target].body + step]).then(() => {
                    if (this.stageState !== st || st.stage !== target || st.transition) return;
                    st.step = step;
                    this._swapMs = 900;
                    this.render();
                    this.cue(up ? { expression: 'surprised', action: 'jiggle', holdMs: 1500 } : { expression: 'frustrated', action: 'slump', holdMs: 2500 });
                    this.preloadBodies(this.stageBodyIds());
                    this.paintChrome();
                });
            }, wait);
            return;
        }
        const t = m.transitions && (m.transitions[`${st.stage}>${target}`] || m.transitions[`${target}>${st.stage}`]);
        this.preloadBodies(((t && t.frames) || []).concat([m.stages[target].body + step]));
        this.later(() => {
            if (this.stageState !== st || st.stage === target) return;
            this.advanceTo(target, step);
            this.cue(up ? { expression: 'surprised', action: 'bounce', holdMs: 1800 } : { expression: 'frustrated', action: 'slump', holdMs: 3000 });
        }, wait);
    }

    setWorking(on) {
        // Every stream update says "working" (#735): when nothing changed, the re-layout (forced reflow,
        // inline style writes, chrome placement) only cost a frame per update all turn long.
        if (!!on === !!this.working && this.root && this.root.dataset.state === (on ? 'working' : 'idle')) return;
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
        this.paintChrome();
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
        // a sheet not fetched yet (growth frames load on demand): swap when it is decoded, so the
        // crossfade never fades to nothing
        const loaded = this.manifest._loaded;
        if (old && old !== src && !(loaded && loaded.has(body.body)) && this._pendingBody !== id) {
            this._pendingBody = id;
            const ms = this._swapMs;
            this.preloadBodies([id]).then(() => {
                if (this._pendingBody !== id) return;
                this._pendingBody = null;
                if (this.currentBodyId() !== id) return;
                this._swapMs = ms;
                this.render();
            });
            return;
        }
        if (old !== src) {
            this._pendingBody = null;
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

    // A finished print: a polaroid of it drifts in from the prints strip and she eats it (#742): her
    // mouth opens as it comes close, it goes in, she chews, swallows, and her belly answers (the stage's
    // printed body, a jiggle). A masked or gesturing pose drops first: she eats with her own mouth.
    onPrint(url, options = {}) {
        if (!this.root || !this.manifest || !url || this.root.classList.contains('hidden')) return;
        const st = this.stageState;
        const DURATION = 2400;
        if (st) {
            st.eatUntil = Date.now() + DURATION + 1400;
            this._swapMs = 260;
            this.render();
        }
        const set = this.faceSet();
        const k = this._k || 1;
        const cam = this.camera();
        const canvasBox = this.el.canvas.getBoundingClientRect();
        const stage = this.root.getBoundingClientRect();
        if (!canvasBox.width) return;
        const face = Array.isArray(this.manifest.face) ? this.manifest.face : null;
        const mouth = (set && set.mouthAt) || (face ? [face[0], face[1] + face[2] * 0.3] : [cam[0] + cam[2] / 2, cam[1] + cam[3] * 0.22]);
        const bx = canvasBox.left - stage.left + mouth[0] * k;
        const by = canvasBox.top - stage.top + mouth[1] * k;
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
        // the card's middle (its picture) on the point
        const h = w * 1.16;
        const place = (x, y) => `translate(${Math.round(x - w / 2)}px, ${Math.round(y - h / 2)}px)`;
        const tilt = left ? 7 : -7;
        const has = (key) => !!(set && set.expressions && set.expressions[key]);
        const swallow = () => {
            card.remove();
            if (this.stageState !== st) return;
            // chewing: mouth open and shut a few times, the head nodding with it, then the gulp
            const shut = has('lick') ? 'lick' : (has('satisfied') ? 'satisfied' : 'happy');
            [0, 1, 2].forEach((i) => {
                this.later(() => { this.cue({ expression: shut, holdMs: 400 }); this.act('nod'); }, i * 340);
                this.later(() => this.cue({ expression: 'eat', holdMs: 400 }), i * 340 + 170);
            });
            this.later(() => {
                if (this.stageState !== st) return;
                st.eatUntil = 0;
                this.showFor('printed', 6);
                this.cue({ expression: has('lick') ? 'lick' : shut, action: 'bounce', holdMs: 4000 });
                this.later(() => this.act('jiggle'), 380);
            }, 3 * 340 + 120);
        };
        const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced || typeof card.animate !== 'function') {
            this.cue({ expression: 'eat', holdMs: 900 });
            this.later(swallow, 600);
            return;
        }
        // From the strip: it starts at the thumbnail's size, lifts out, arcs over to her face and goes
        // into her mouth edge first (squeezed flat as it passes her lips).
        const startScale = fromStrip ? Math.max(0.2, Math.min(1, fromBox.width / w)) : 0.6;
        const arcX = fromStrip ? sx + (tx - sx) * 0.45 : sx + (tx - sx) * 0.3;
        const arcY = Math.min(sy, ty) - stage.height * 0.06;
        const nearX = tx + (left ? 1 : -1) * w * 0.34;
        const anim = card.animate([
            { transform: `${place(sx, fromStrip ? sy : sy + 40)} rotate(0deg) scale(${startScale})`, opacity: fromStrip ? 1 : 0 },
            { transform: `${place(fromStrip ? sx + (left ? -12 : 12) : sx, sy)} rotate(${tilt}deg) scale(1)`, opacity: 1, offset: 0.18 },
            { transform: `${place(arcX, arcY)} rotate(${tilt / 2}deg) scale(0.9)`, opacity: 1, offset: 0.45 },
            { transform: `${place(nearX, ty - 4)} rotate(${-tilt}deg) scale(0.42)`, opacity: 1, offset: 0.76 },
            { transform: `${place(tx, ty)} rotate(${-tilt * 2}deg) scale(0.2, 0.14)`, opacity: 1, offset: 0.92 },
            { transform: `${place(tx, ty)} rotate(${-tilt * 2}deg) scale(0.05, 0.02)`, opacity: 0 }
        ], { duration: DURATION, easing: 'ease-in-out', fill: 'forwards' });
        anim.onfinish = swallow;
        this.cue({ expression: 'surprised', holdMs: DURATION * 0.5 });
        // her mouth opens while the print is still on its way, and she leans in to take it
        this.later(() => {
            if (this.stageState !== st) return;
            this.cue({ expression: 'eat', holdMs: DURATION * 0.5 + 400 });
            this.act('lean-in');
        }, DURATION * 0.52);
    }

    // Her grown stage and how far the next one is. director.js stamps it on the send as `mascot`, and
    // the turn prompt then speaks from that stage (modules/directorPersonaVoice.js).
    growthState() {
        const st = this.stageState;
        if (!st || !st.stage) return null;
        const g = this.manifest ? directorMascotGrowth(this.manifest) : { order: [], points: [] };
        const at = Math.max(0, g.order.indexOf(st.stage));
        const nextAt = g.points[at + 1];
        return {
            stage: st.stage,
            points: Number(this.growthPoints) || 0,
            nextAt: Number.isFinite(nextAt) ? nextAt : null
        };
    }

    // Test hook: the stage machine state without the DOM.
    debugState() {
        const st = this.stageState || {};
        return { persona: this.persona, stage: st.stage, body: this.currentBodyId(), transition: st.transition ? st.transition.frames[st.transition.index] : null, working: this.working, expression: this.shownExpression(), view: this.view };
    }
}

if (typeof window !== 'undefined') window.DirectorMascot = DirectorMascot;
if (typeof module !== 'undefined' && module.exports) module.exports = { DirectorMascot, directorMascotTypedHtml, directorMascotGrowthPoints, directorMascotCardPoints, directorMascotStageFor, directorMascotGrowth, directorMascotStepFor };
