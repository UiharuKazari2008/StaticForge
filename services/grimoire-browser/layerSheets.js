'use strict';
// Layer sheets (Yukimi, Nov 21 2026: "the layer extraction is not done as full "sheets" with transparent backgrounds so
// that the layers can stack on the client and will prevent smearing or unesnnary updates ... Were thining more in terms
// of Z-Index and positions that are setup to move and scroll or animate async from each other").
//
// Chromium's compositor already splits a page into layers. With the Alchemy build's layer-sheets patch
// (LayerTree.alchemySetHiddenLayers), a fixed layer drawn over the content - a header, a side bar, a floating button -
// leaves the frames and goes to the viewer once as its own transparent picture (a LayerTree snapshot, at the frame's
// pixel ratio), sent again only when Chromium repaints it (LayerTree.layerPainted). The viewer stacks each sheet over
// the content, where it stays while the content scrolls under it: no copy of the header moves with the page, and a
// scroll no longer repaints it.
//
// Which layers are fixed: a layer that keeps its place while the root scroller's layer moves (each layer tree update
// gives every layer's offset; a scroll of 2 px or more decides it). A sticky layer (a header that scrolls, then sticks)
// is a sheet once it has been seen stuck: the viewer places it at any scroll from where it sits in the flow, where it
// sticks and where its container ends (LayerTree's sticky constraint), as Chromium does. Not sheets: layers that move
// with the page, nested sticky layers, layers under the content (a backdrop: the content over it would need transparent
// frames), animated, video, canvas, plugin, iframe and backdrop-filter layers (their pictures change without a
// repaint), rotated or scaled ones, and full-screen ones.

const MSG_SHEET = 5;
// a layer smaller than this (layer units squared) is not worth a sheet (a caret, a 1 px line)
const MIN_AREA = 64;
// over this share of the view a fixed layer is a cover (a dialog): it stays in the frames
const MAX_SHARE = 0.9;
// a scroll layer after a fixed one, over this share of the view, draws over it: that fixed layer is not on top
const LATER_SCROLL_SHARE = 0.02;
const NOT_SHEET = /Animation|Video|Canvas|Plugin|IFrame|BackdropFilter|Scrollbar|Root|Viewport|OverflowScrolling/;
const PROCESS_MS = 150;
const DEBUG = process.env.ALCHEMY_DEBUG_SHEETS === '1';
const REPAINT_MS = 120;

function translationOnly(t) {
    if (!t) return true;
    return Math.abs(t[0] - 1) < 1e-6 && Math.abs(t[5] - 1) < 1e-6 && Math.abs(t[1]) < 1e-6 && Math.abs(t[4]) < 1e-6
        && Math.abs(t[10] - 1) < 1e-6;
}

function placeOf(l) {
    const t = l.transform;
    return { x: (Number(l.offsetX) || 0) + (t ? t[12] : 0), y: (Number(l.offsetY) || 0) + (t ? t[13] : 0) };
}

/**
 * @param {object} session  the Alchemy tab (session.cdp, session.scroll, session.scrollContextId)
 * @param {object} deps     broadcast(session, payload, binary), binaryMessage(kind, header, body), frameScale(session)
 *                          -> frame pixels per CSS pixel (0: not a desktop page), log(...)
 */
function createLayerSheets(session, deps) {
    const state = {
        on: false,
        layers: new Map(),     // id -> { kind: 'scroll' | 'fixed' | 'moving' | undefined, y }
        reasons: new Map(),    // id -> compositing reasons (string), or null while asked
        refY: null,
        latest: null,          // the newest layer list
        timer: null,
        sheets: new Map(),     // id -> { gen, x, y, w, h, scale, png, node, busy, again, timer }
        hidden: '',
        unit: 0,
        k: 0,
        gen: 0,
        listSent: ''
    };

    const cdp = () => session.cdp;

    function send(payload) {
        deps.broadcast(session, payload);
    }

    // a sheet for the viewer: x, y where it is now (view, CSS pixels); a sticky one's y follows st at other scrolls
    function entryOf(id, s) {
        const e = { id, gen: s.gen, x: s.x, y: s.y, w: s.w, h: s.h };
        if (s.st) e.st = s.st;
        return e;
    }

    function sendList() {
        const list = [];
        for (const [id, s] of state.sheets) {
            if (!s.png) continue;
            list.push(entryOf(id, s));
        }
        const text = JSON.stringify(list);
        if (text === state.listSent) return;
        state.listSent = text;
        send({ type: 'sheets', list });
    }

    async function setHidden() {
        const ids = [...state.sheets.entries()].filter(([, s]) => s.png).map(([id]) => id).sort();
        const key = ids.join(',');
        if (key === state.hidden) return;
        // nothing was hidden yet (a new document before its first sheet): nothing to show again
        if (!key && !state.hidden) return;
        state.hidden = key;
        await cdp().send('LayerTree.alchemySetHiddenLayers', { layerIds: ids }).catch((err) => deps.log('hide failed:', err.message));
    }

    // the page's own scan (watchScroll) leaves a sheet's element out of its bars and layers
    async function markNode(backendNodeId, on) {
        const contextId = session.scrollContextId;
        if (!backendNodeId || !contextId) return;
        try {
            const { object } = await cdp().send('DOM.resolveNode', { backendNodeId, executionContextId: contextId });
            if (!object || !object.objectId) return;
            await cdp().send('Runtime.callFunctionOn', {
                objectId: object.objectId,
                functionDeclaration: 'function (on) { if (typeof globalThis.__alchemySheet === "function") globalThis.__alchemySheet(this, on); }',
                arguments: [{ value: !!on }]
            });
            await cdp().send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
        } catch (_) { /* gone with its document */ }
    }

    async function snapshot(id) {
        const s = state.sheets.get(id);
        if (!s || !state.on) return;
        if (s.busy) { s.again = true; return; }
        s.busy = true;
        try {
            const { snapshotId } = await cdp().send('LayerTree.makeSnapshot', { layerId: id });
            let shot;
            try {
                shot = await cdp().send('LayerTree.replaySnapshot', { snapshotId, scale: s.scale });
            } finally {
                cdp().send('LayerTree.releaseSnapshot', { snapshotId }).catch(() => {});
            }
            if (!state.sheets.has(id) || !shot || !shot.dataURL) return;
            const png = Buffer.from(String(shot.dataURL).replace(/^data:image\/png;base64,/, ''), 'base64');
            s.gen = ++state.gen;
            s.png = png;
            deps.broadcast(session, deps.binaryMessage(MSG_SHEET, { id, gen: s.gen }, png), true);
            sendList();
            await setHidden();
        } catch (err) {
            // the layer went (a new layer tree): the next update decides again
            state.sheets.delete(id);
            sendList();
        } finally {
            s.busy = false;
            if (s.again && state.sheets.has(id)) { s.again = false; snapshot(id); }
        }
    }

    function dropSheet(id) {
        const s = state.sheets.get(id);
        if (!s) return;
        clearTimeout(s.timer);
        state.sheets.delete(id);
        markNode(s.node, false);
    }

    function askReasons(id) {
        state.reasons.set(id, null);
        cdp().send('LayerTree.compositingReasons', { layerId: id }).then((r) => {
            state.reasons.set(id, (r.compositingReasonIds || r.compositingReasons || []).join(','));
            schedule();
        }).catch(() => state.reasons.set(id, 'gone'));
    }

    function process() {
        state.timer = null;
        const layers = state.latest;
        const scroll = session.scroll;
        const k = deps.frameScale(session);
        if (DEBUG) deps.log('process', layers ? layers.length + ' layers' : 'no layers', scroll ? 'scroll ' + scroll.y + '/' + scroll.height + ' view ' + scroll.view + ' root ' + scroll.root : 'no scroll', 'k', k);
        if (!state.on || !layers || !scroll || !scroll.root || !(scroll.height > scroll.view + 8) || !k) {
            if (state.sheets.size) clear();
            return;
        }
        // the root scroller's layer: the tallest that draws; its height is the document's, in layer units
        let ref = null;
        for (const l of layers) if (l.drawsContent && (!ref || l.height > ref.height)) ref = l;
        if (!ref || !(ref.height > 0)) return;
        const unit = ref.height / scroll.height;
        if (!(unit > 0.2 && unit < 8)) return;
        const viewArea = (scroll.viewWidth || ref.width / unit) * scroll.view * unit * unit;
        const refY = placeOf(ref).y;
        // a scroll of 2 px or more tells the layers that move with it from those that stay
        const moved = state.refY != null && Math.abs(refY - state.refY) >= 2 ? refY - state.refY : 0;
        const seen = new Set();
        for (const l of layers) {
            seen.add(l.layerId);
            const y = placeOf(l).y;
            let rec = state.layers.get(l.layerId);
            if (!rec) { rec = { kind: undefined, y }; state.layers.set(l.layerId, rec); }
            if (moved) {
                const dy = y - rec.y;
                if (Math.abs(dy - moved) < 0.6) rec.kind = 'scroll';
                else if (Math.abs(dy) < 0.6) rec.kind = rec.kind === 'moving' ? undefined : 'fixed';
                else rec.kind = 'moving';
            }
            rec.y = y;
            // where a sticky layer sticks: its place in the view while it stays put
            if (l.stickyPositionConstraint && rec.kind === 'fixed') rec.stickTop = y;
        }
        if (moved || state.refY == null) state.refY = refY;
        for (const id of state.layers.keys()) if (!seen.has(id)) { state.layers.delete(id); state.reasons.delete(id); }
        // the order Chromium draws them in: a fixed layer is on top when nothing that scrolls draws after it
        const ix = new Map(layers.map((l, i) => [l.layerId, i]));
        let lastScroll = -1;
        layers.forEach((l, i) => {
            const rec = state.layers.get(l.layerId);
            if (l.drawsContent && rec && rec.kind === 'scroll' && !l.stickyPositionConstraint && l.width * l.height > viewArea * LATER_SCROLL_SHARE) lastScroll = i;
        });
        if (DEBUG) {
            deps.log('ref', ref.layerId, ref.width + 'x' + ref.height, 'unit', unit.toFixed(3), 'moved', moved, 'lastScroll', lastScroll,
                layers.filter((l) => l.drawsContent).map((l) => l.layerId + ':' + ((state.layers.get(l.layerId) || {}).kind || '?') + ':' + Math.round(l.width) + 'x' + Math.round(l.height) + ':' + (state.reasons.get(l.layerId) || '-')).join(' '));
        }
        if (lastScroll < 0) return;
        const want = new Map();
        for (const l of layers) {
            const rec = state.layers.get(l.layerId);
            if (!rec || !l.drawsContent) continue;
            const sc = l.stickyPositionConstraint;
            let st = null;
            if (sc) {
                // seen stuck, and not inside another sticky box
                if (rec.stickTop == null || sc.nearestLayerShiftingStickyBox || sc.nearestLayerShiftingContainingBlock) continue;
                const box = sc.stickyBoxRect;
                const block = sc.containingBlockRect;
                if (!box || !block) continue;
                // [stick top in the view, top in the flow, container bottom, height] (CSS pixels; the last three in the document)
                st = [rec.stickTop / unit, box.y / unit, (block.y + block.height) / unit, box.height / unit].map((v) => Math.round(v * 100) / 100);
            } else if (rec.kind !== 'fixed') {
                continue;
            }
            if (ix.get(l.layerId) < lastScroll || !translationOnly(l.transform)) {
                if (DEBUG) deps.log('not on top or not flat', l.layerId, ix.get(l.layerId), lastScroll, JSON.stringify(l.transform || null));
                continue;
            }
            const area = l.width * l.height;
            if (area < MIN_AREA || area > viewArea * MAX_SHARE) continue;
            if (!state.reasons.has(l.layerId)) { askReasons(l.layerId); continue; }
            const reasons = state.reasons.get(l.layerId);
            if (DEBUG) deps.log('candidate', l.layerId, 'reasons', reasons, 'transform', JSON.stringify(l.transform || null));
            if (reasons == null || NOT_SHEET.test(reasons)) continue;
            const p = placeOf(l);
            want.set(l.layerId, {
                x: Math.round(p.x / unit * 100) / 100,
                y: Math.round(p.y / unit * 100) / 100,
                w: Math.round(l.width / unit * 100) / 100,
                h: Math.round(l.height / unit * 100) / 100,
                st,
                node: l.backendNodeId || 0
            });
        }
        const rescale = Math.abs(k - state.k) > 1e-3 || Math.abs(unit - state.unit) > 1e-3;
        state.k = k;
        state.unit = unit;
        for (const id of [...state.sheets.keys()]) if (!want.has(id)) dropSheet(id);
        for (const [id, w] of want) {
            const s = state.sheets.get(id);
            if (!s) {
                state.sheets.set(id, Object.assign({ gen: 0, png: null, scale: k / unit, busy: false, again: false, timer: null }, w));
                markNode(w.node, true);
                snapshot(id);
                continue;
            }
            Object.assign(s, { x: w.x, y: w.y, w: w.w, h: w.h, st: w.st });
            if (rescale) { s.scale = k / unit; snapshot(id); }
        }
        sendList();
        setHidden().catch(() => {});
    }

    function schedule() {
        if (!state.timer) state.timer = setTimeout(process, PROCESS_MS);
    }

    function onTree(ev) {
        if (DEBUG && !state.latest) deps.log('first layer tree', ev && Array.isArray(ev.layers) ? ev.layers.length : 'none');
        if (!state.on || !ev || !Array.isArray(ev.layers)) return;
        state.latest = ev.layers;
        schedule();
    }

    function onPainted(ev) {
        const s = ev && state.sheets.get(ev.layerId);
        if (!s || !s.png) return;
        clearTimeout(s.timer);
        s.timer = setTimeout(() => snapshot(ev.layerId), REPAINT_MS);
    }

    function clear() {
        for (const id of [...state.sheets.keys()]) dropSheet(id);
        state.listSent = '';
        sendList();
        setHidden().catch(() => {});
    }

    return {
        get active() { return state.on; },
        async start() {
            if (state.on) return;
            state.on = true;
            cdp().on('LayerTree.layerTreeDidChange', onTree);
            cdp().on('LayerTree.layerPainted', onPainted);
            await cdp().send('DOM.getDocument', { depth: 0 }).catch(() => {});
            await cdp().send('LayerTree.enable');
        },
        // a new document: its layers are new (the old ids are gone with it)
        reset() {
            state.layers.clear();
            state.reasons.clear();
            state.refY = null;
            state.latest = null;
            if (state.sheets.size || state.listSent !== '[]') clear();
            // a new document can be a new renderer, whose agents start off: LayerTree (and DOM, for the nodes) again
            if (state.on) {
                cdp().send('DOM.getDocument', { depth: 0 }).catch(() => {});
                cdp().send('LayerTree.enable').catch(() => {});
            }
        },
        // a viewer that joins gets every sheet and the list
        attach(ws) {
            for (const [id, s] of state.sheets) {
                if (s.png) ws.send(deps.binaryMessage(MSG_SHEET, { id, gen: s.gen }, s.png));
            }
            const list = [...state.sheets.entries()].filter(([, s]) => s.png).map(([id, s]) => entryOf(id, s));
            ws.send(JSON.stringify({ type: 'sheets', list }));
        },
        // LayerTree.disable also shows every hidden layer again (the patch)
        stop() {
            if (!state.on) return;
            state.on = false;
            clearTimeout(state.timer);
            state.timer = null;
            for (const s of state.sheets.values()) clearTimeout(s.timer);
            state.sheets.clear();
            state.layers.clear();
            state.reasons.clear();
            state.refY = null;
            state.latest = null;
            state.hidden = '';
            state.listSent = '';
            const c = cdp();
            if (c) {
                c.off('LayerTree.layerTreeDidChange', onTree);
                c.off('LayerTree.layerPainted', onPainted);
                c.send('LayerTree.disable').catch(() => {});
            }
        }
    };
}

module.exports = { createLayerSheets, MSG_SHEET };
