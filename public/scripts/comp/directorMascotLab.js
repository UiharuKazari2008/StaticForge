/**
 * Mascot Test (Yozora #767): a panel over the Director to try her expressions, actions, poses, kicks,
 * growth and morphs by hand, on the real mascot in the real layout (desktop window, Studio dock, phone).
 * Director > Tools > Mascot Test... (phone: Menu > Options > Mascot Test...). Loaded on demand
 * (featureLoader 'director_mascot_lab'); it only calls directorMascot.js's own methods, and closing it
 * puts back what it held (frozen morph, paused kicks, overlay).
 *
 * Agents: window.directorMascotLab.open(directorInstance), then .run('<button id>') or the controls.
 */
(() => {
    'use strict';
    const ACTIONS = ['nod', 'bounce', 'lean-in', 'tilt', 'slump', 'shake', 'jiggle'];
    const CSS = `
#directorMascotLab { position: fixed; right: 8px; top: 48px; z-index: 2147483200; width: 300px; max-width: calc(100vw - 16px); max-height: calc(100vh - 110px);
  display: flex; flex-direction: column; background: rgba(18, 20, 30, 0.94); color: #eef; border: 1px solid #7fd0ff; font: 12px/1.35 'Segoe UI', sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.6); }
#directorMascotLab.dml-min .dml-body { display: none; }
html.ui-mobile #directorMascotLab { top: auto; bottom: 46px; left: 4px; right: 4px; width: auto; max-width: none; max-height: 40vh; }
#directorMascotLab .dml-head { display: flex; align-items: center; gap: 6px; padding: 5px 8px; background: #1d2a72; font-weight: 600; cursor: default; }
#directorMascotLab .dml-head span { flex: 1; }
#directorMascotLab .dml-body { overflow-y: auto; padding: 6px 8px 8px; overscroll-behavior: contain; }
#directorMascotLab h4 { margin: 8px 0 3px; font: 600 10px 'Segoe UI', sans-serif; letter-spacing: .1em; text-transform: uppercase; color: #9fd8ff; }
#directorMascotLab .dml-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
#directorMascotLab button { min-height: 26px; padding: 3px 8px; border: 1px solid #5f79d8; border-radius: 0; background: #141c58; color: #eef; font: inherit; cursor: pointer; }
#directorMascotLab button:active, #directorMascotLab button.is-on { background: #d23a22; border-color: #f2664a; }
#directorMascotLab input[type=range] { flex: 1; min-width: 120px; }
#directorMascotLab label { display: inline-flex; align-items: center; gap: 4px; }
#directorMascotLab .dml-note { color: #9fb0dc; font-size: 11px; margin-top: 3px; }
.dml-overlay { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 6; }
.dml-overlay i { position: absolute; border: 2px dashed #3f6; border-radius: 50%; box-sizing: border-box; }
.dml-overlay i.pin { border-color: #f5c; } .dml-overlay i.kick { border-color: #fc3; border-style: solid; }`;

    let director = null;
    let panel = null;
    let overlay = null;
    let overlayTimer = null;
    let frozen = null;      // { real progress } while the morph is held
    let paused = false;

    const mascot = () => (director && director.mascot) || null;
    const gl = () => { const m = mascot(); return m && m.glOn() ? m.glBody : null; };
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function holdKicks() {
        const m = mascot();
        if (m && m.stageState && paused) m.stageState.nextKickAt = Date.now() + 3600000;
    }

    function setStage(id) {
        const m = mascot();
        if (!m || !m.stageState || !m.manifest.stages[id]) return;
        const st = m.stageState;
        st.stage = id; st.step = ''; st.transition = null;
        st.kickUntil = 0; st.gestureUntil = 0; st.celebrateUntil = 0; st.printedUntil = 0;
        m._swapMs = 500;
        m.render();
        holdKicks();
        paint();
    }

    function pose(key, sec) {
        const m = mascot(); const st = m && m.stageState;
        if (!st) return;
        const until = Date.now() + sec * 1000;
        if (key === 'kick') st.kickUntil = until;
        if (key === 'gesture') st.gestureUntil = until;
        if (key === 'celebrate') st.celebrateUntil = until;
        if (key === 'printed') st.printedUntil = until;
        if (key === 'plain') { st.kickUntil = 0; st.gestureUntil = 0; st.celebrateUntil = 0; st.printedUntil = 0; }
        m._swapMs = 450;
        m.render();
        if (key !== 'plain') setTimeout(() => { if (mascot() === m) { m._swapMs = 450; m.render(); } }, sec * 1000 + 40);
    }

    function freeze(on, t) {
        const g = gl();
        if (!g) return;
        if (on) {
            if (!frozen) frozen = { real: g.progress };
            const at = Math.max(0.001, Math.min(0.999, t));
            g.progress = () => at;
            g.draw();
        } else if (frozen) {
            g.progress = frozen.real;
            frozen = null;
            g.kick();
        }
    }

    function eat(kind) {
        const m = mascot();
        if (!m) return;
        if (kind === 'doc' && typeof directorDocumentPrintUrl === 'function') {
            /* global directorDocumentPrintUrl */
            const url = directorDocumentPrintUrl();
            m.onPrint(url, { document: true });
            document.querySelectorAll('.dm-polaroid').forEach((card) => { const img = card.querySelector('img'); if (img && img.getAttribute('src') === url) card.classList.add('dm-document'); });
            return;
        }
        const prints = director && typeof director.sessionPrints === 'function' ? director.sessionPrints() : [];
        const last = prints[prints.length - 1];
        /* global localGalleryImageUrl */
        const url = last && typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(last.filename) : '/static_images/app_icons/director.png';
        m.onPrint(url, {});
    }

    const RUN = {
        bump1: () => mascot().bumpOnce(1),
        bump2: () => mascot().bumpOnce(1.45),
        bump3: () => mascot().bumpOnce(1.9),
        kick: () => mascot().kickEvent(),
        run: () => { [0, 1500, 3000].forEach((ms) => setTimeout(() => mascot() && mascot().kickEvent(), ms)); },
        digest: () => mascot().digest(),
        eatPrint: () => eat('print'),
        eatDoc: () => eat('doc'),
        poseKick: () => pose('kick', 4),
        poseGesture: () => pose('gesture', 5),
        poseCelebrate: () => pose('celebrate', 4),
        posePrinted: () => pose('printed', 6),
        posePlain: () => pose('plain', 0)
    };

    function drawOverlay() {
        const m = mascot();
        if (!overlay || !m || !m.el || !m.el.canvas || !m.manifest) return;
        const canvas = m.el.canvas;
        if (overlay.parentNode !== canvas.parentNode) canvas.parentNode.appendChild(overlay);
        overlay.style.transform = canvas.style.transform;
        overlay.style.width = canvas.style.width; overlay.style.height = canvas.style.height;
        const k = m._k || 1;
        const def = m.stageDef() || {};
        const ring = (cls, cx, cy, rx, ry) => `<i class="${cls}" style="left:${(cx - rx) * k}px;top:${(cy - ry) * k}px;width:${rx * 2 * k}px;height:${ry * 2 * k}px"></i>`;
        let html = '';
        if (Array.isArray(def.belly)) html += ring('', def.belly[0], def.belly[1], def.belly[2], def.belly[2]);
        (def.pin || []).forEach((p) => { html += ring('pin', p[0], p[1], p[2], p[3]); });
        Object.values(m.manifest.kicks || {}).forEach((list) => (Array.isArray(list) ? list : []).forEach((p) => { html += ring('kick', p.c[0], p.c[1], p.R, p.R); }));
        if (overlay.innerHTML !== html) overlay.innerHTML = html;
    }

    function toggleOverlay(on) {
        clearInterval(overlayTimer);
        if (overlay) { overlay.remove(); overlay = null; }
        if (!on) return;
        overlay = document.createElement('div');
        overlay.className = 'dml-overlay';
        drawOverlay();
        overlayTimer = setInterval(drawOverlay, 400);
    }

    function paint() {
        const m = mascot();
        if (!panel) return;
        const body = panel.querySelector('.dml-body');
        if (!m || !m.manifest || !m.stageState) { body.innerHTML = '<p class="dml-note">The mascot is not on screen (Tools > Show Mascot, Visual Novel view).</p>'; return; }
        const man = m.manifest;
        const stages = Object.keys(man.stages);
        const set = typeof m.faceSet === 'function' ? m.faceSet() : null;
        const faces = Object.keys((set && set.expressions) || {});
        const def = m.stageDef() || {};
        const grow = def.grow || { min: 1, max: 1 };
        const has = (k) => !!def[k];
        const personas = ['wren', 'kabuki'].concat(director._xiEnabled ? ['xi'] : []);
        const names = { wren: 'Yumiya', kabuki: 'Chiyo', xi: 'Yozora' };
        const btn = (run, label, on) => `<button type="button" data-run="${esc(run)}"${on ? ' class="is-on"' : ''}>${esc(label)}</button>`;
        body.innerHTML = `
            <h4>Persona</h4><div class="dml-row">${personas.map((p) => btn(`persona:${p}`, names[p], director.persona === p)).join('')}</div>
            <h4>Stage</h4><div class="dml-row">${stages.map((s) => btn(`stage:${s}`, s, m.stageState.stage === s)).join('')}</div>
            <h4>Size in this stage</h4><div class="dml-row"><input type="range" data-in="gain" min="${Math.min(1, grow.min || 1)}" max="${grow.max || 1}" step="0.005" value="${m._gainShown || 1}"><span data-out="gain">${(m._gainShown || 1).toFixed(2)}</span></div>
            <h4>Expressions</h4><div class="dml-row">${faces.map((f) => btn(`face:${f}`, f)).join('')}</div>
            <h4>Actions</h4><div class="dml-row">${ACTIONS.map((a) => btn(`act:${a}`, a)).join('')}</div>
            <h4>Poses</h4><div class="dml-row">${btn('posePlain', 'plain')}${has('kicky') || has('rubKicky') || has('gestureKicky') ? btn('poseKick', 'drawn kick') : ''}${has('rub') || has('gesture') ? btn('poseGesture', 'gesture') : ''}${has('celebrate') ? btn('poseCelebrate', 'celebrate') : ''}${has('printed') ? btn('posePrinted', 'after print') : ''}</div>
            <h4>Kicks</h4><div class="dml-row">${btn('bump1', 'bump')}${btn('bump2', 'bump x1.45')}${btn('bump3', 'bump x1.9')}${btn('kick', 'one kick')}${btn('run', 'run of 3')}${btn('digest', 'after a print')}</div>
            <div class="dml-row" style="margin-top:4px"><label><input type="checkbox" data-in="pause"${paused ? ' checked' : ''}> no random kicks</label></div>
            <h4>Eating</h4><div class="dml-row">${btn('eatPrint', 'eat a print')}${btn('eatDoc', 'eat a document')}</div>
            <h4>Morph</h4><div class="dml-row"><label><input type="checkbox" data-in="freeze"${frozen ? ' checked' : ''}> hold at</label><input type="range" data-in="t" min="0" max="1" step="0.01" value="0.5"></div>
            <p class="dml-note">Tick hold, then pick a pose: the change stops where the slider is.</p>
            <h4>Guides</h4><div class="dml-row"><label><input type="checkbox" data-in="overlay"${overlay ? ' checked' : ''}> belly (green), chest (pink), drawn kicks (yellow)</label></div>
            <p class="dml-note">${m.glOn() ? 'Shader body on.' : 'Shader body OFF: only drawn poses show (no growth, bumps or morphs).'} Stage ${esc(m.stageState.stage)}, sheet ${esc(m._glId || '')}.</p>`;
    }

    function onClick(e) {
        const b = e.target.closest('button[data-run]');
        if (!b) return;
        run(b.dataset.run);
    }

    function run(id) {
        const m = mascot();
        if (!m) return;
        const [kind, arg] = String(id).split(':');
        if (kind === 'persona') { Promise.resolve(director.setPersona(arg)).then(() => setTimeout(paint, 2500)); return; }
        if (kind === 'stage') { setStage(arg); return; }
        if (kind === 'face') { m.cue({ expression: arg, holdMs: 5000 }); return; }
        if (kind === 'act') { m.act(arg); return; }
        if (RUN[kind]) { RUN[kind](); holdKicks(); }
    }

    function onInput(e) {
        const el = e.target.closest('[data-in]');
        const m = mascot();
        if (!el || !m) return;
        const key = el.dataset.in;
        if (key === 'gain') {
            const g = gl(); const v = Number(el.value);
            if (g && m.stageDef() && m.stageDef().grow) { g.setGain(m.stageDef().grow, v, 0); m._gainShown = v; }
            panel.querySelector('[data-out="gain"]').textContent = v.toFixed(2);
        }
        if (key === 'pause') { paused = el.checked; if (paused) holdKicks(); else if (m.stageState) m.stageState.nextKickAt = 0; }
        if (key === 'freeze' || key === 't') freeze(panel.querySelector('[data-in="freeze"]').checked, Number(panel.querySelector('[data-in="t"]').value));
        if (key === 'overlay') toggleOverlay(el.checked);
    }

    function close() {
        freeze(false);
        toggleOverlay(false);
        const m = mascot();
        if (paused && m && m.stageState) m.stageState.nextKickAt = 0;
        paused = false;
        if (panel) panel.remove();
        panel = null;
    }

    function open(d) {
        director = d || window.directorInstance || null;
        if (!director) return null;
        if (panel) { paint(); return panel; }
        if (!document.getElementById('directorMascotLabStyle')) {
            const style = document.createElement('style');
            style.id = 'directorMascotLabStyle';
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        panel = document.createElement('div');
        panel.id = 'directorMascotLab';
        panel.innerHTML = '<div class="dml-head"><span>Mascot Test</span><button type="button" data-do="min" title="Fold">_</button><button type="button" data-do="close" title="Close">x</button></div><div class="dml-body"></div>';
        document.body.appendChild(panel);
        panel.addEventListener('click', (e) => {
            const head = e.target.closest('button[data-do]');
            if (head) { if (head.dataset.do === 'close') close(); else panel.classList.toggle('dml-min'); return; }
            onClick(e);
        });
        panel.addEventListener('input', onInput);
        panel.addEventListener('change', onInput);
        paint();
        return panel;
    }

    window.directorMascotLab = { open, close, run, paint, isOpen: () => !!panel };
})();
