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
// 6: the page beyond the view drawn at rest (header: y, h in CSS pixels of the document; body: WebP)
const MSG_PREFILL = 6;
// at rest: no layer update for this long
const REST_MS = 900;
// one pass of drawing ahead (and of the content map) at most this often
const PASS_MS = 4000;
const MAX_CONTENT = 2000;
// Layers under the content as sheets need see-through frames, and Chromium's WebP screencast measured 9.5 frames a
// second against JPEG's 35.9 (1500 x 1650, a page changing every frame, Nov 21): off until the see-through frames
// have a fast path; ALCHEMY_UNDER=1 turns them on to test
const UNDER_ON = process.env.ALCHEMY_UNDER === '1';
// ALCHEMY_AHEAD=0: no drawing ahead (to measure what it costs the page)
const AHEAD_OFF = process.env.ALCHEMY_AHEAD === '0';
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

// The root scroller's layer: the widest that draws (the tallest of those as wide), whose height is the document's at the
// scale its width gives (the tallest layer alone picked a tall inner scroller - Yozora's file tree, 218 x 3216 - and
// every layer was measured against it). null when none fits (the page does not scroll as a whole).
function rootLayer(layers, scroll) {
    let widest = 0;
    for (const l of layers) if (l.drawsContent && l.width > widest) widest = l.width;
    let ref = null;
    for (const l of layers) if (l.drawsContent && l.width >= widest - 2 && (!ref || l.height > ref.height)) ref = l;
    if (!ref || !scroll || !(scroll.viewWidth > 0) || !(scroll.height > 0)) return null;
    const unit = ref.width / scroll.viewWidth;
    if (!(unit > 0.2 && unit < 8) || Math.abs(ref.height / unit - scroll.height) > Math.max(4, scroll.height * 0.02)) return null;
    return { ref, unit };
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
        listSent: '',
        // drawing ahead (the build's content-map patch): document ranges (CSS) drawn since their layers last
        // repainted there, per content layer id; and whether a viewer shows the content map
        restTimer: null,
        passAt: 0,
        passing: false,
        prefilled: new Map(),
        contentWanted: false,
        contentSent: '',
        // layers under the content (Yukimi, Nov 21: "if i scroll this page the background is not fixed in a layer it
        // will shift and jump the client should be given the layer themself"): solid = a scroll layer's one colour
        // (its content map: one flat fill, no text, no images), or 'no'; under = they are sheets now (see-through frames)
        solid: new Map(),
        under: false
    };

    const cdp = () => session.cdp;

    function send(payload) {
        deps.broadcast(session, payload);
    }

    // a sheet for the viewer: x, y where it is now (view, CSS pixels); a sticky one's y follows st at other scrolls
    function entryOf(id, s) {
        const e = { id, gen: s.gen, x: s.x, y: s.y, w: s.w, h: s.h };
        if (s.st) e.st = s.st;
        // under the content (drawn before the frame); a colour instead of a picture (a page background)
        if (s.z === 'under') e.z = 'under';
        if (s.color) e.color = s.color;
        return e;
    }

    function sendList() {
        const list = [];
        for (const [id, s] of state.sheets) {
            if (!s.png && !s.color) continue;
            list.push(entryOf(id, s));
        }
        const text = JSON.stringify(list);
        if (text === state.listSent) return;
        state.listSent = text;
        send({ type: 'sheets', list });
    }

    async function setHidden() {
        // the layers under the content go only all together, once each one's picture is with the viewers (else the
        // page would show its plain colour for a moment)
        const underAll = [...state.sheets.values()].filter((s) => s.z === 'under');
        const under = state.under && underAll.length > 0 && underAll.every((s) => s.png || s.color);
        const ids = [...state.sheets.entries()].filter(([, s]) => (s.png || s.color) && (s.z !== 'under' || under)).map(([id]) => id).sort();
        const key = ids.join(',') + (under ? '|under' : '');
        if (key === state.hidden) return;
        // nothing was hidden yet (a new document before its first sheet): nothing to show again
        if (!key && !state.hidden) return;
        state.hidden = key;
        const params = { layerIds: ids };
        // the frame without a background of its own while the layers under the content are sheets
        if (deps.contentMap) params.transparentBackground = under;
        await cdp().send('LayerTree.alchemySetHiddenLayers', params).catch((err) => deps.log('hide failed:', err.message));
        if (deps.setAlphaFrames) deps.setAlphaFrames(session, under);
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
            // encoded for keeping (it does not move): how much of it is images decides how (deps.encodeSheet)
            let pic = { bytes: png, f: 'png' };
            if (deps.encodeSheet) {
                let imagey = false;
                if (deps.contentMap) {
                    const again = await cdp().send('LayerTree.makeSnapshot', { layerId: id }).catch(() => null);
                    if (again) {
                        const map = await cdp().send('LayerTree.alchemyContentMap', { snapshotId: again.snapshotId }).catch(() => null);
                        cdp().send('LayerTree.releaseSnapshot', { snapshotId: again.snapshotId }).catch(() => {});
                        let area = 0;
                        const im = (map && map.images) || [];
                        for (let i = 0; i + 6 <= im.length; i += 6) area += im[i + 2] * im[i + 3];
                        const l = (state.latest || []).find((q) => q.layerId === id);
                        imagey = !!l && area > l.width * l.height * 0.3;
                    }
                }
                const enc = await deps.encodeSheet(session, png, imagey).catch(() => null);
                if (enc && enc.bytes && enc.bytes.length) pic = enc;
            }
            if (!state.sheets.has(id)) return;
            if (DEBUG) deps.log('sheet', id, pic.f + (pic.d === 0 ? ' lossless' : pic.q ? ' q' + pic.q : pic.d ? ' d' + pic.d : ''), Math.round(pic.bytes.length / 1024) + ' KB (png ' + Math.round(png.length / 1024) + ' KB)');
            s.gen = ++state.gen;
            s.png = pic.bytes;
            s.f = pic.f;
            s.q = pic.q;
            s.d = pic.d;
            deps.broadcast(session, deps.binaryMessage(MSG_SHEET, { id, gen: s.gen, f: s.f, q: s.q, d: s.d }, s.png), true);
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

    // a scroll layer that is one flat colour (a page background): its content map has one fill over (nearly) all of
    // it and no text or images; the answer stays until the layer repaints
    function askSolid(l) {
        state.solid.set(l.layerId, null);
        (async () => {
            const { snapshotId } = await cdp().send('LayerTree.makeSnapshot', { layerId: l.layerId });
            try {
                const map = await cdp().send('LayerTree.alchemyContentMap', { snapshotId });
                const fills = map.fills || [];
                let color = null;
                if (!(map.text || []).length && !(map.images || []).length && fills.length >= 5) {
                    const first = fills[4];
                    const same = fills.every((v, i) => i % 5 !== 4 || v === first);
                    if (same && fills[2] * fills[3] >= l.width * l.height * 0.95) color = first;
                }
                state.solid.set(l.layerId, color == null ? 'no' : color >>> 0);
            } finally {
                cdp().send('LayerTree.releaseSnapshot', { snapshotId }).catch(() => {});
            }
            schedule();
        })().catch(() => state.solid.set(l.layerId, 'no'));
    }

    function cssColor(argb) {
        const a = (argb >>> 24) & 255;
        return 'rgba(' + ((argb >>> 16) & 255) + ', ' + ((argb >>> 8) & 255) + ', ' + (argb & 255) + ', ' + Math.round(a / 255 * 1000) / 1000 + ')';
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
        // the root scroller's layer (rootLayer): its width gives the layer units per CSS pixel
        const root = rootLayer(layers, scroll);
        if (!root) return;
        const ref = root.ref;
        const unit = root.unit;
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
        // under the content: the fixed layers drawn before the content's last scrolling layer, when everything that
        // scrolls under them is a flat colour (then the frames can be see-through: the build's content-map patch)
        let underOk = false;
        if (deps.contentMap && UNDER_ON) {
            const under = [];
            let blocked = false;
            let firstUnder = -1;
            layers.forEach((l, i) => {
                const rec = state.layers.get(l.layerId);
                if (blocked || !rec || !l.drawsContent || rec.kind !== 'fixed' || l.stickyPositionConstraint || i >= lastScroll) return;
                if (!translationOnly(l.transform) || l.width * l.height < MIN_AREA) return;
                if (!state.reasons.has(l.layerId)) { askReasons(l.layerId); blocked = true; return; }
                const reasons = state.reasons.get(l.layerId);
                if (reasons == null) { blocked = true; return; }
                if (NOT_SHEET.test(reasons)) return;
                if (firstUnder < 0) firstUnder = i;
                under.push(l);
            });
            if (!blocked && under.length) {
                // the scrolling layers before the first of them: each one colour
                const below = layers.filter((l, i) => i < firstUnder && l.drawsContent && (state.layers.get(l.layerId) || {}).kind === 'scroll');
                // and no big scrolling layer between them and the content's own (it would end up under them)
                const lastUnder = ix.get(under[under.length - 1].layerId);
                const between = layers.some((l, i) => i > firstUnder && i < lastUnder && l.drawsContent && (state.layers.get(l.layerId) || {}).kind === 'scroll' && l.width * l.height > viewArea * LATER_SCROLL_SHARE);
                let solidOk = !between;
                for (const l of below) {
                    if (!state.solid.has(l.layerId)) { askSolid(l); solidOk = false; continue; }
                    const c = state.solid.get(l.layerId);
                    if (c == null || c === 'no') solidOk = false;
                }
                if (solidOk) {
                    underOk = true;
                    for (const l of below) want.set(l.layerId, { x: 0, y: 0, w: 0, h: 0, st: null, node: 0, z: 'under', color: cssColor(state.solid.get(l.layerId)) });
                    for (const l of under) {
                        const p = placeOf(l);
                        want.set(l.layerId, { x: Math.round(p.x / unit * 100) / 100, y: Math.round(p.y / unit * 100) / 100, w: Math.round(l.width / unit * 100) / 100, h: Math.round(l.height / unit * 100) / 100, st: null, node: l.backendNodeId || 0, z: 'under' });
                    }
                }
            }
        }
        state.under = underOk;
        const rescale = Math.abs(k - state.k) > 1e-3 || Math.abs(unit - state.unit) > 1e-3;
        state.k = k;
        state.unit = unit;
        for (const id of [...state.sheets.keys()]) if (!want.has(id)) dropSheet(id);
        for (const [id, w] of want) {
            const s = state.sheets.get(id);
            if (!s) {
                state.sheets.set(id, Object.assign({ gen: 0, png: null, scale: k / unit, busy: false, again: false, timer: null }, w));
                // a colour needs no picture; a fixed layer's element leaves the page's own scan (an over or under sheet)
                if (w.color) { state.sheets.get(id).gen = ++state.gen; continue; }
                markNode(w.node, true);
                snapshot(id);
                continue;
            }
            Object.assign(s, { x: w.x, y: w.y, w: w.w, h: w.h, st: w.st, z: w.z, color: w.color });
            if (rescale && !w.color) { s.scale = k / unit; snapshot(id); }
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
        armRest();
    }

    function onPainted(ev) {
        // a content layer repainted: what was drawn ahead of it there is stale
        const drawn = ev && state.prefilled.get(ev.layerId);
        if (drawn && ev.clip && state.unit) {
            const l = (state.latest || []).find((q) => q.layerId === ev.layerId);
            const top = l ? docTop(l) : null;
            if (top != null) {
                const y0 = top + ev.clip.y / state.unit;
                const y1 = y0 + ev.clip.height / state.unit;
                state.prefilled.set(ev.layerId, drawn.filter((r) => r[1] <= y0 || r[0] >= y1));
            }
        }
        if (ev && state.solid.has(ev.layerId) && state.solid.get(ev.layerId) !== null) {
            state.solid.delete(ev.layerId);
            schedule();
        }
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

    function armRest() {
        if (!deps.contentMap) return;
        clearTimeout(state.restTimer);
        state.restTimer = setTimeout(atRest, REST_MS);
    }

    // the layers that scroll with the page (in drawing order), and whether a fixed one lies under them (a backdrop:
    // then the content alone is not what shows)
    function contentLayers() {
        const layers = state.latest || [];
        const scroll = session.scroll;
        if (!scroll || !state.unit) return null;
        const viewArea = (scroll.viewWidth || 1) * scroll.view * state.unit * state.unit;
        const list = [];
        let under = false;
        let sawFixed = false;
        for (const l of layers) {
            const rec = state.layers.get(l.layerId);
            if (!rec || !l.drawsContent || !translationOnly(l.transform)) continue;
            if (rec.kind === 'fixed' && !l.stickyPositionConstraint && !state.sheets.has(l.layerId) && l.width * l.height > viewArea * 0.3) sawFixed = true;
            if (rec.kind !== 'scroll' || l.stickyPositionConstraint || state.sheets.has(l.layerId)) continue;
            if (sawFixed) under = true;
            list.push(l);
        }
        return { list, under };
    }

    // the scroll offset now (CSS), from the page's own report
    const scrollY = () => (session.scroll && session.scroll.y) || 0;
    // a scrolling layer's top in the document (CSS): its place against the root scroller's layer (which starts at the
    // document's top), both from the same layer update, so a scroll in between does not move it
    const docTop = (l) => {
        if (!state.unit || !state.latest) return null;
        const root = rootLayer(state.latest, session.scroll);
        return root ? (placeOf(l).y - placeOf(root.ref).y) / state.unit : null;
    };

    async function snapshotOf(id) {
        const r = await cdp().send('LayerTree.makeSnapshot', { layerId: id });
        return r.snapshotId;
    }

    // at rest: the page a screen above the view and a screen below the over-render band, drawn from the content
    // layers' own recordings (LayerTree replay with a clip) onto the page's background; the viewer keeps it where its
    // cache has nothing (the next frames there replace it). Not with a backdrop under the content, nor on pages that
    // do not scroll. And the content map, while a viewer shows it.
    async function atRest() {
        state.restTimer = null;
        const k = deps.frameScale(session);
        const scroll = session.scroll;
        if (!state.on || state.passing || !k || !scroll || !scroll.root || !session.sockets.size) return;
        const now = Date.now();
        if (now - state.passAt < PASS_MS) { state.restTimer = setTimeout(atRest, PASS_MS - (now - state.passAt)); return; }
        const content = contentLayers();
        if (!content || !content.list.length) return;
        state.passing = true;
        state.passAt = now;
        const unit = state.unit;
        const sy = scrollY();
        const view = scroll.view;
        const docH = scroll.height;
        const snaps = new Map();
        const snap = async (l) => {
            if (!snaps.has(l.layerId)) snaps.set(l.layerId, await snapshotOf(l.layerId).catch(() => null));
            return snaps.get(l.layerId);
        };
        try {
            // a backdrop under the content: only once it is a sheet (see-through), else the content alone is wrong there
            if (!AHEAD_OFF && content.list.length && (!content.under || state.under) && deps.sharp && scroll.height > scroll.view + 8) {
                // the way the viewer last went (within 10 s), as far as it was going (one to two screens); else a screen
                // each side
                const t = state.travel && Date.now() - state.travel.at < 10000 ? state.travel : null;
                const reach = t ? Math.max(view, Math.min(view * 2, t.reach)) : view;
                const wanted = !t ? [[sy - view, sy], [sy + view * 1.5, sy + view * 2.5]]
                    : (t.dir > 0 ? [[sy + view * 1.5, sy + view * 1.5 + Math.min(view, reach)], [sy + view * 2.5, sy + view * 1.5 + reach], [sy - view, sy]]
                        : [[sy - Math.min(view, reach), sy], [sy - reach, sy - view], [sy + view * 1.5, sy + view * 2.5]]);
                const ranges = wanted
                    .map((r) => [Math.max(0, Math.round(r[0])), Math.min(docH, Math.round(r[1]))])
                    .filter((r) => r[1] - r[0] >= 8);
                for (const range of ranges) await prefill(range, content.list, snap, k, unit, sy);
            }
            if (state.contentWanted) await sendContent(content.list, snap, unit, sy, view);
        } catch (err) {
            if (DEBUG) deps.log('rest pass:', err.message);
        } finally {
            for (const id of snaps.values()) if (id) cdp().send('LayerTree.releaseSnapshot', { snapshotId: id }).catch(() => {});
            state.passing = false;
        }
    }

    async function prefill(rangeIn, list, snap, k, unit, sy) {
        // on a 64 px grid (CSS), so the same rows asked again a few pixels apart are seen as drawn already
        const range = [Math.floor(rangeIn[0] / 64) * 64, Math.min((session.scroll && session.scroll.height) || rangeIn[1], Math.ceil(rangeIn[1] / 64) * 64)];
        if (range[1] - range[0] < 8) return;
        // only what was not drawn ahead since its layers last repainted there
        const fresh = list.some((l) => !(state.prefilled.get(l.layerId) || []).some((r) => r[0] <= range[0] && r[1] >= range[1]));
        if (!fresh) return;
        const width = Math.round((session.scroll.viewWidth || 0) * k);
        const height = Math.round((range[1] - range[0]) * k);
        if (width < 8 || height < 8 || width * height > 8e6) return;
        const parts = [];
        for (const l of list) {
            const p = placeOf(l);
            const top = docTop(l);
            if (top == null) continue;
            const y0 = Math.max(range[0], top);
            const y1 = Math.min(range[1], top + l.height / unit);
            if (y1 - y0 < 1) continue;
            const id = await snap(l);
            if (!id) continue;
            const shot = await cdp().send('LayerTree.replaySnapshot', {
                snapshotId: id,
                scale: k / unit,
                clip: { x: 0, y: (y0 - top) * unit, width: l.width, height: (y1 - y0) * unit }
            }).catch(() => null);
            if (!shot || !shot.dataURL) continue;
            parts.push({ input: Buffer.from(String(shot.dataURL).replace(/^data:image\/png;base64,/, ''), 'base64'), left: Math.max(0, Math.round(p.x / unit * k)), top: Math.round((y0 - range[0]) * k) });
        }
        if (!parts.length) return;
        // on the page's background, or see-through over the sheets under the content (its colour and backdrop)
        const bg = state.under ? { r: 0, g: 0, b: 0, alpha: 0 } : ((session.layers && session.layers.bg) || '#ffffff');
        const quality = (session.settings && session.settings.regionQuality) || 78;
        const body = await deps.sharp({ create: { width, height, channels: state.under ? 4 : 3, background: bg } })
            .composite(parts).webp({ quality, effort: 2 }).toBuffer();
        deps.broadcast(session, deps.binaryMessage(MSG_PREFILL, { y: range[0], h: range[1] - range[0], w: width, k }, body), true);
        for (const l of list) {
            const drawn = (state.prefilled.get(l.layerId) || []).filter((r) => r[1] <= range[0] || r[0] >= range[1]);
            drawn.push(range);
            state.prefilled.set(l.layerId, drawn.slice(-16));
        }
        if (DEBUG) deps.log('drew ahead', range.join('-'), parts.length + ' layers', body.length + ' B');
    }

    // where the page draws text, images and flat fills around the view (document CSS pixels), for the viewer's
    // content-type check (Alchemy Information)
    async function sendContent(list, snap, unit, sy, view) {
        const out = { type: 'content', text: [], images: [], fills: [] };
        const y0 = Math.max(0, sy - view);
        const y1 = sy + view * 2;
        for (const l of list) {
            const p = placeOf(l);
            const top = docTop(l);
            if (top == null) continue;
            const c0 = Math.max(y0, top);
            const c1 = Math.min(y1, top + l.height / unit);
            if (c1 - c0 < 1) continue;
            const id = await snap(l);
            if (!id) continue;
            const map = await cdp().send('LayerTree.alchemyContentMap', { snapshotId: id, clip: { x: 0, y: (c0 - top) * unit, width: l.width, height: (c1 - c0) * unit } }).catch(() => null);
            if (!map) continue;
            const add = (from, per, into) => {
                for (let i = 0; i + per <= from.length && into.length < MAX_CONTENT * per; i += per) {
                    into.push(Math.round(from[i] / unit + p.x / unit), Math.round(from[i + 1] / unit + top), Math.round(from[i + 2] / unit), Math.round(from[i + 3] / unit));
                    for (let j = 4; j < per; j++) into.push(from[i + j]);
                }
            };
            add(map.text || [], 4, out.text);
            add(map.images || [], 6, out.images);
            add(map.fills || [], 5, out.fills);
        }
        const key = JSON.stringify(out);
        if (key === state.contentSent) return;
        state.contentSent = key;
        send(out);
    }

    // The viewer scrolls (dir, speed, how far it will still go, CSS): what lies ahead that way, past the view and its
    // over-render band, up to two screens (the layers' recordings reach about that far), a screen at a time; one pass
    // at a time, at most every 300 ms
    // While the page scrolls, the replays would hold its main thread just when its scroll needs it (first new frame
    // 234-371 ms with them, 220-259 ms without, Yozora, Nov 21): the viewer's way and reach are kept, and the drawing
    // ahead waits for the page to settle (atRest), that way first. LayerTree replay off the main thread is next.
    function ahead(msg) {
        const dir = msg && (msg.dir === 1 || msg.dir === -1) ? msg.dir : 0;
        if (!dir) return;
        state.travel = { dir, reach: Number(msg.reach) || 0, at: Date.now() };
        state.passAt = 0;
        armRest();
    }

    return {
        get active() { return state.on; },
        ahead(msg) { ahead(msg); },
        // a viewer shows the content map (Alchemy Information) or stopped
        wantContent(on) {
            state.contentWanted = !!on;
            state.contentSent = '';
            if (on) { state.passAt = 0; armRest(); }
        },
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
            state.prefilled.clear();
            state.contentSent = '';
            state.solid.clear();
            state.under = false;
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
                if (s.png) ws.send(deps.binaryMessage(MSG_SHEET, { id, gen: s.gen, f: s.f, q: s.q, d: s.d }, s.png));
            }
            const list = [...state.sheets.entries()].filter(([, s]) => s.png || s.color).map(([id, s]) => entryOf(id, s));
            ws.send(JSON.stringify({ type: 'sheets', list }));
        },
        // LayerTree.disable also shows every hidden layer again (the patch)
        stop() {
            if (!state.on) return;
            state.on = false;
            clearTimeout(state.timer);
            state.timer = null;
            clearTimeout(state.restTimer);
            state.restTimer = null;
            state.prefilled.clear();
            for (const s of state.sheets.values()) clearTimeout(s.timer);
            state.sheets.clear();
            state.layers.clear();
            state.reasons.clear();
            state.refY = null;
            state.latest = null;
            state.hidden = '';
            state.listSent = '';
            state.solid.clear();
            state.under = false;
            if (deps.setAlphaFrames) deps.setAlphaFrames(session, false);
            const c = cdp();
            if (c) {
                c.off('LayerTree.layerTreeDidChange', onTree);
                c.off('LayerTree.layerPainted', onPainted);
                c.send('LayerTree.disable').catch(() => {});
            }
        }
    };
}

module.exports = { createLayerSheets, MSG_SHEET, MSG_PREFILL };
