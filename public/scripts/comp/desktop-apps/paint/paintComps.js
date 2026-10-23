/**
 * Paint's history snapshots and layer comps (Yozora #632), Photoshop's.
 *
 *   snapshots   doc.snaps [{ id, name, state, paths, thumb }]: the whole document kept at a moment,
 *               listed at the top of the History window; a click goes back to it (one Undo step)
 *   layer comps doc.comps [{ id, name, comment, visibility, appearance, layers: [[id, props]]}]:
 *               which layers show and how (opacity, blend, style), applied from the Layer Comps
 *               window (Window > Layer Comps); Photoshop's Position is not kept (Paint's layers
 *               are the canvas's size)
 *
 *   paintComps.historyRows(w) / historyBar() / historyClick(w, ev)   the History window's parts
 *   paintComps.togglePanel(w) / panelOpen(w) / applyProps(doc, list) / action(w, a)
 */
(function (root) {
    'use strict';

    const C = () => root.PaintCore;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

    // ---- snapshots ---------------------------------------------------------------------------------

    function snaps(d) { if (!d.snaps) d.snaps = []; return d.snaps; }

    function thumbOf(d) {
        const c = C().makeCanvas(32, 24);
        const x = c.getContext('2d');
        const k = Math.min(32 / d.width, 24 / d.height);
        x.fillStyle = '#fff';
        x.fillRect(0, 0, 32, 24);
        x.drawImage(d.flattened(), (32 - d.width * k) / 2, (24 - d.height * k) / 2, d.width * k, d.height * k);
        return c.toDataURL();
    }

    /** History > New Snapshot: the document as it is now. */
    function newSnapshot(w, name) {
        const d = w.doc;
        w.commitFloating();
        w.finishText();
        const n = snaps(d).length + 1;
        snaps(d).push({ id: Date.now(), name: name || `Snapshot ${n}`, state: d.snapshot(), paths: root.paintPath ? root.paintPath.state(d) : null, thumb: thumbOf(d) });
        refreshHistory(w);
    }

    function restoreSnapshot(w, id) {
        const d = w.doc;
        const s = snaps(d).find((x) => x.id === id);
        if (!s) return;
        w.commitFloating();
        w.finishText();
        if (w.xf) w.cancelTransform();
        d.snapshotStep(s.name, () => d.restore(s.state));
        if (s.paths && root.paintPath) root.paintPath.applyState(d, s.paths);
        if (root.paintLayers) root.paintLayers.refresh(w);
    }

    function deleteSnapshot(w) {
        const d = w.doc;
        if (!w.snapPick) { w.status('Click a snapshot in the History window first.'); return; }
        d.snaps = snaps(d).filter((x) => x.id !== w.snapPick);
        w.snapPick = null;
        refreshHistory(w);
    }

    function refreshHistory(w) { if (root.paintLayers) root.paintLayers.refresh(w); }

    /** The snapshot rows over the History window's steps. */
    function historyRows(w) {
        return snaps(w.doc).map((s) => `<div class="mp-history-row is-snap${w.snapPick === s.id ? ' is-picked' : ''}" data-snap="${s.id}" title="Click to go back to this snapshot"><img src="${s.thumb}" alt="">${esc(s.name)}</div>`).join('');
    }

    function historyBar() {
        return `<div class="mp-history-bar">
            <button type="button" class="mp-paths-btn" data-h="snap" title="Create new snapshot"><span class="mp-paths-art" style="--i:6"></span></button>
            <button type="button" class="mp-paths-btn" data-h="snap-delete" title="Delete the chosen snapshot"><span class="mp-paths-art" style="--i:5"></span></button></div>`;
    }

    /** A click in the History window: a snapshot row or a bar button (true when it was one). */
    function historyClick(w, ev) {
        const b = ev.target.closest('[data-h]');
        if (b) { action(w, b.dataset.h === 'snap' ? 'history-snapshot' : 'history-snapshot-delete'); return true; }
        const row = ev.target.closest('[data-snap]');
        if (!row) return false;
        w.snapPick = Number(row.dataset.snap);
        restoreSnapshot(w, w.snapPick);
        return true;
    }

    // ---- layer comps -------------------------------------------------------------------------------

    function comps(d) { if (!d.comps) d.comps = []; return d.comps; }

    function propsOf(l, comp) {
        const p = {};
        if (!comp || comp.visibility) p.visible = l.visible;
        if (!comp || comp.appearance) { p.opacity = l.opacity; p.blend = l.blend; p.styles = clone(l.styles); }
        return p;
    }

    function record(d, comp) {
        comp.layers = d.layers.map((l) => [l.id, propsOf(l, comp)]);
        comp.groups = comp.visibility ? d.groups.map((g) => [g.id, g.visible]) : [];
    }

    /** paintCore's apply for a 'props' step: layers' (and groups') visibility and appearance. */
    function applyProps(d, s) {
        s.layers.forEach(([id, p]) => {
            const l = d.layers.find((x) => x.id === id);
            if (!l) return;
            if ('visible' in p) l.visible = p.visible;
            if ('opacity' in p) l.opacity = p.opacity;
            if ('blend' in p) l.blend = p.blend;
            if ('styles' in p) l.styles = clone(p.styles);
        });
        (s.groups || []).forEach(([id, v]) => { const g = d.group(id); if (g) g.visible = v; });
        d.markDirty();
        d.emit('layers');
    }

    function applyComp(w, id) {
        const d = w.doc;
        const c = comps(d).find((x) => x.id === id);
        if (!c) return;
        const before = { layers: d.layers.map((l) => [l.id, propsOf(l, null)]), groups: d.groups.map((g) => [g.id, g.visible]) };
        applyProps(d, c);
        const after = { layers: d.layers.map((l) => [l.id, propsOf(l, null)]), groups: d.groups.map((g) => [g.id, g.visible]) };
        d.push({ label: `Apply Layer Comp`, kind: 'props', before, after, bytes: 1000 });
        w.compPick = id;
        refreshPanel(w);
    }

    function compDialog(w, title, def) {
        const V = root.vistaDialogTemplate;
        if (!V) return Promise.resolve(def);
        const tpl = { t: title, w: 260, h: 118, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 9, 30, 8, 0x50020000, '&Name:', 0],
            [103, 'E', 44, 7, 150, 12, 0x50810080, def.name, 0],
            [-1, 'B', 7, 24, 187, 50, 0x50000007, 'Apply To Layers', 0],
            [104, 'B', 14, 36, 80, 10, 0x50010003, '&Visibility', 0],
            [105, 'B', 14, 48, 80, 10, 0x50010003, '&Appearance (Layer Style)', 0],
            [106, 'B', 14, 60, 170, 10, 0x58010003, '&Position (not kept by Paint)', 0],
            [-1, 'S', 7, 82, 40, 8, 0x50020000, '&Comment:', 0],
            [107, 'E', 44, 80, 150, 30, 0x50a11044, def.comment || '', 0],
            [1, 'B', 203, 7, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 203, 25, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        return new Promise((resolve) => {
            let done = false;
            const end = (v) => { if (!done) { done = true; resolve(v); } };
            V.openDialog({
                id: 'mpLayerComp', tpl, owner: w.modal,
                init: (ctx) => { ctx.set(104, def.visibility !== false); ctx.set(105, def.appearance !== false); },
                ok: (ctx) => end({ name: String(ctx.get(103) || '').trim() || def.name, visibility: !!ctx.get(104), appearance: !!ctx.get(105), comment: String(ctx.get(107) || '') }),
                cancel: () => end(null),
                close: () => end(null)
            });
        });
    }

    async function newComp(w) {
        const d = w.doc;
        const r = await compDialog(w, 'New Layer Comp', { name: `Layer Comp ${comps(d).length + 1}` });
        if (!r) return;
        const c = { id: Date.now(), ...r };
        record(d, c);
        comps(d).push(c);
        w.compPick = c.id;
        if (!panelOpen(w)) togglePanel(w); else refreshPanel(w);
    }

    function updateComp(w) {
        const c = comps(w.doc).find((x) => x.id === w.compPick);
        if (!c) { w.status('Click a layer comp first.'); return; }
        record(w.doc, c);
        w.status(`${c.name} now holds the layers as they are.`);
    }

    function deleteComp(w) {
        const d = w.doc;
        d.comps = comps(d).filter((x) => x.id !== w.compPick);
        w.compPick = null;
        refreshPanel(w);
    }

    function stepComp(w, dir) {
        const list = comps(w.doc);
        if (!list.length) return;
        const at = list.findIndex((x) => x.id === w.compPick);
        const next = list[(at + dir + list.length) % list.length];
        applyComp(w, next.id);
    }

    async function editComp(w, id) {
        const c = comps(w.doc).find((x) => x.id === id);
        if (!c) return;
        const r = await compDialog(w, 'Layer Comp Options', c);
        if (!r) return;
        Object.assign(c, r);
        refreshPanel(w);
    }

    function dock(w) { return w.modal.querySelector('.mp-dock'); }
    function panelOpen(w) { return !!dock(w).querySelector('.mp-comps'); }

    function togglePanel(w) {
        const d = dock(w);
        const cur = d.querySelector('.mp-comps');
        if (cur) { cur.remove(); w.modal.classList.toggle('mp-has-dock', !!d.children.length); return; }
        d.insertAdjacentHTML('beforeend', `<div class="mp-panel mp-comps"><div class="mp-panel-cap">Layer Comps</div><div class="mp-comps-list" role="listbox"></div>
            <div class="mp-paths-bar">
                <button type="button" class="mp-paths-btn" data-c="prev" title="Apply the previous layer comp"><span class="mp-comps-art is-prev"></span></button>
                <button type="button" class="mp-paths-btn" data-c="next" title="Apply the next layer comp"><span class="mp-comps-art is-next"></span></button>
                <button type="button" class="mp-paths-btn" data-c="update" title="Update the layer comp from the layers"><span class="mp-comps-art is-update"></span></button>
                <button type="button" class="mp-paths-btn" data-c="new" title="Create new layer comp"><span class="mp-paths-art" style="--i:4"></span></button>
                <button type="button" class="mp-paths-btn" data-c="delete" title="Delete layer comp"><span class="mp-paths-art" style="--i:5"></span></button>
            </div></div>`);
        w.modal.classList.add('mp-has-dock');
        const panel = d.querySelector('.mp-comps');
        panel.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-c]');
            if (b) { action(w, `comp-${b.dataset.c}`); return; }
            const row = ev.target.closest('.mp-comps-row');
            if (!row) return;
            const id = Number(row.dataset.id);
            // the box at the left applies it; the name picks it (Photoshop)
            if (ev.target.closest('.mp-comps-apply')) applyComp(w, id);
            else { w.compPick = id; refreshPanel(w); }
        });
        panel.addEventListener('dblclick', (ev) => {
            const row = ev.target.closest('.mp-comps-row');
            if (row) void editComp(w, Number(row.dataset.id));
        });
        refreshPanel(w);
    }

    function refreshPanel(w) {
        const host = dock(w) && dock(w).querySelector('.mp-comps .mp-comps-list');
        if (!host) return;
        host.innerHTML = `<div class="mp-comps-row is-last" title="The layers as they are now"><span class="mp-comps-apply${w.compPick ? '' : ' is-on'}"></span><i>Last Document State</i></div>`
            + comps(w.doc).map((c) => `<div class="mp-comps-row${w.compPick === c.id ? ' is-active' : ''}" data-id="${c.id}" title="${esc(c.comment || '')}"><span class="mp-comps-apply${w.compPick === c.id ? ' is-on' : ''}" title="Apply this layer comp"></span>${esc(c.name)}</div>`).join('');
    }

    function action(w, a) {
        switch (a) {
            case 'history-snapshot': newSnapshot(w); return true;
            case 'history-snapshot-delete': deleteSnapshot(w); return true;
            case 'layer-comps': togglePanel(w); return true;
            case 'comp-new': void newComp(w); return true;
            case 'comp-update': updateComp(w); return true;
            case 'comp-delete': deleteComp(w); return true;
            case 'comp-prev': stepComp(w, -1); return true;
            case 'comp-next': stepComp(w, 1); return true;
            default: return false;
        }
    }

    root.paintComps = { historyRows, historyBar, historyClick, newSnapshot, restoreSnapshot, applyProps, applyComp, togglePanel, panelOpen, refreshPanel, action, snaps, comps };
})(typeof window !== 'undefined' ? window : globalThis);
