/**
 * Paint's options bar (Yozora #632), Photoshop's: the active tool's icon, then only that tool's
 * settings, laid out the way Photoshop's Options bar has them. While Free Transform is on it is
 * the transform's bar (X, Y, W, H, angle, Commit, Cancel); with a crop box, the crop's.
 *
 *   paintBar.render(w)    rebuild for the tool / state (setTool, a transform starting or ending)
 *   paintBar.update(w)    refresh the values in place (the fields being typed in keep theirs)
 *
 * A tool's items, in order: { k: 'slider' | 'num' | 'check' | 'select' | 'seg' | 'btn' | 'sep' |
 * 'label' | 'color', key (an option in w.opt) or get / set, label, min, max, unit, options, ... }.
 * Values live in w.opt, the same ones the Vista options box under the tool box uses.
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-paint/options-bar.png';
    const SELMODE_ART = '/static_images/vista-paint/select-modes.png';
    const FONTS = ['Arial', 'Comic Sans MS', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
    const MODES = [['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'],
        ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'], ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'], ['difference', 'Difference'],
        ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    const art = (i) => `<span class="mp-bar-art" style="background-position:${-i * 16}px 0"></span>`;
    const selArt = (i) => `<span class="mp-bar-art" style="background-image:url('${SELMODE_ART}');background-position:${-i * 16}px 0"></span>`;

    const SELMODE = { k: 'seg', key: 'selMode', options: [['new', 'New Selection', selArt(0)], ['add', 'Add to Selection (Shift)', selArt(1)], ['subtract', 'Subtract from Selection (Alt)', selArt(2)], ['intersect', 'Intersect with Selection (Shift+Alt)', selArt(3)]], after: (w) => w.setSelMode(w.opt.selMode) };
    const FEATHER = { k: 'num', key: 'feather', label: 'Feather:', min: 0, max: 250, unit: 'px', title: 'Selections made now get soft edges this wide' };
    const AA = { k: 'check', key: 'antialias', label: 'Anti-alias' };
    const SIZE = { k: 'slider', label: 'Size:', min: 1, max: 500, unit: 'px', get: (w) => Math.round(w.toolDiameter()), set: (w, v) => { w.opt.size = v; } };
    const HARD = { k: 'slider', key: 'hardness', label: 'Hardness:', min: 0, max: 100, unit: '%' };
    const OPACITY = (label = 'Opacity:') => ({ k: 'slider', key: 'opacity', label, min: 1, max: 100, unit: '%' });
    const MODE = { k: 'select', key: 'paintMode', label: 'Mode:', options: MODES };
    const TOL = { k: 'num', key: 'tolerance', label: 'Tolerance:', min: 0, max: 100 };
    const ALL = { k: 'check', key: 'sampleAll', label: 'Sample All Layers' };
    const SEP = { k: 'sep' };
    const ZOOM_BTNS = [{ k: 'btn', label: '100%', title: 'Actual Pixels (Ctrl+1)', action: 'zoom-actual' }, { k: 'btn', label: 'Fit Screen', title: 'Fit on Screen (Ctrl+0)', action: 'zoom-fit' }];
    const SHAPE_FILL = { k: 'seg', key: 'shape', options: [['outline', 'Outline', '<span class="mp-opt-shape is-outline"></span>'], ['both', 'Outline and fill', '<span class="mp-opt-shape is-both"></span>'], ['fill', 'Fill', '<span class="mp-opt-shape is-fill"></span>']] };
    const WEIGHT = { k: 'num', key: 'lineWidth', label: 'Weight:', min: 1, max: 100, unit: 'px', set: (w, v) => { w.opt.lineWidth = v; w.opt.size = 0; } };

    // Photoshop's tool mode for the shape tools: a shape layer, a path, or pixels (Vista's)
    const SHAPE_MODE = { k: 'select', key: 'shapeMode', label: '', title: 'Pick tool mode', options: [['pixels', 'Pixels'], ['shape', 'Shape'], ['path', 'Path']] };

    /** A shape layer's Fill and Stroke (when the active layer is one). */
    function vectorItems(w) {
        const l = w.doc && w.doc.activeLayer;
        if (!l || !l.vector || !root.paintPath) return [];
        const V = root.paintPath;
        return [SEP,
            { k: 'check', label: 'Fill:', title: 'Fill the shape', get: (ww) => !!ww.doc.activeLayer.vector.fill, set: (ww, v) => V.setVector(ww, (vec) => { vec.fill = v ? ww.fg : null; }, 'Change Fill') },
            { k: 'color', title: 'Fill color', get: (ww) => ww.doc.activeLayer.vector.fill || '#ffffff00', set: (ww, c) => V.setVector(ww, (vec) => { vec.fill = c; }, 'Change Fill') },
            { k: 'check', label: 'Stroke:', title: 'Stroke the shape', get: (ww) => !!ww.doc.activeLayer.vector.stroke, set: (ww, v) => V.setVector(ww, (vec) => { vec.stroke = v ? { color: ww.fg, width: Math.max(1, ww.brushSize()) } : null; }, 'Change Stroke') },
            { k: 'color', title: 'Stroke color', get: (ww) => (ww.doc.activeLayer.vector.stroke || {}).color || '#ffffff00', set: (ww, c) => V.setVector(ww, (vec) => { vec.stroke = { width: 3, ...(vec.stroke || {}), color: c }; }, 'Change Stroke') },
            { k: 'num', label: '', min: 0, max: 288, unit: 'px', title: 'Stroke width', get: (ww) => (ww.doc.activeLayer.vector.stroke || {}).width || 0, set: (ww, v) => V.setVector(ww, (vec) => { vec.stroke = v > 0 ? { color: ww.fg, ...(vec.stroke || {}), width: v } : null; }, 'Change Stroke') }];
    }

    /** The items of a tool's bar. */
    function toolItems(w) {
        const t = w.tool;
        switch (t) {
            case 'select': case 'ellipseselect':
                return [SELMODE, SEP, FEATHER, ...(t === 'ellipseselect' ? [AA] : []), SEP,
                    { k: 'select', key: 'selStyle', label: 'Style:', options: [['normal', 'Normal'], ['ratio', 'Fixed Ratio'], ['size', 'Fixed Size']], after: (ww) => ww.renderBar() },
                    ...(w.opt.selStyle === 'ratio' || w.opt.selStyle === 'size' ? [
                        { k: 'num', key: 'selW', label: 'Width:', min: 1, max: 16384, unit: w.opt.selStyle === 'size' ? 'px' : '' },
                        { k: 'btn', icon: art(13), title: 'Swap width and height', run: (ww) => { [ww.opt.selW, ww.opt.selH] = [ww.opt.selH, ww.opt.selW]; ww.renderBar(); } },
                        { k: 'num', key: 'selH', label: 'Height:', min: 1, max: 16384, unit: w.opt.selStyle === 'size' ? 'px' : '' }] : []),
                    SEP, { k: 'btn', label: 'Refine Edge...', title: 'Select > Modify > Feather', action: 'pro-sel-feather' }];
            case 'freeselect': case 'polylasso':
                return [SELMODE, SEP, FEATHER, AA];
            case 'wand':
                return [SELMODE, SEP, TOL, AA, { k: 'check', key: 'contiguous', label: 'Contiguous' }, ALL];
            case 'move':
                return [{ k: 'check', key: 'autoSelect', label: 'Auto-Select Layer', title: 'A click picks the top layer with pixels under the pointer' },
                    { k: 'check', key: 'showControls', label: 'Show Transform Controls', after: (ww) => ww.drawAnts() },
                    { k: 'check', key: 'keepRatio', label: 'Keep Proportions', title: 'Corner handles keep the shape; Shift does the other' }, SEP,
                    { k: 'label', text: 'Align:' },
                    ...[['left', 'Align left edges'], ['hcenter', 'Align horizontal centers'], ['right', 'Align right edges'], ['top', 'Align top edges'], ['vcenter', 'Align vertical centers'], ['bottom', 'Align bottom edges']]
                        .map(([a, title], i) => ({ k: 'btn', icon: art(i), title: `${title} (to the selection, else the canvas)`, action: `align-${a}` }))];
            case 'crop':
                return [{ k: 'select', key: 'cropRatio', label: 'Ratio:', options: [['free', 'Unconstrained'], ['original', 'Original Ratio'], ['1:1', '1:1 (Square)'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['5:4', '5:4']] },
                    { k: 'btn', icon: art(13), title: 'Swap the ratio', run: (ww) => { ww.opt.cropSwap = !ww.opt.cropSwap; ww.renderBar(); } },
                    ...(w.cropBox ? [SEP, { k: 'label', text: `${Math.round(w.cropBox.w)} x ${Math.round(w.cropBox.h)} px` }, SEP,
                        { k: 'btn', icon: art(12), title: 'Cancel the crop (Esc)', action: 'escape' }, { k: 'btn', icon: art(11), title: 'Commit the crop (Enter)', action: 'enter' }] : [])];
            case 'brush': {
                const B = root.paintBrush;
                if (!B) return [SIZE, HARD, SEP, MODE, OPACITY()];
                const set = (ww) => B.settings(ww);
                return [{ k: 'custom', title: 'Brush Preset picker', mount: (ww, el) => B.picker(ww, el) }, SIZE, HARD, SEP, MODE, OPACITY(),
                    { k: 'slider', label: 'Flow:', min: 1, max: 100, unit: '%', title: 'How much paint each dab lays down', get: (ww) => set(ww).flow, set: (ww, v) => { set(ww).flow = v; B.refreshPanel(ww); } },
                    { k: 'toggle', label: '<span class="mp-pen is-size"></span>', title: 'Always use pressure for size (pen)', get: (ww) => set(ww).pressureSize, set: (ww, v) => { set(ww).pressureSize = v; B.refreshPanel(ww); } },
                    { k: 'toggle', label: '<span class="mp-pen is-flow"></span>', title: 'Always use pressure for flow (pen)', get: (ww) => set(ww).pressureFlow, set: (ww, v) => { set(ww).pressureFlow = v; B.refreshPanel(ww); } }];
            }
            case 'pencil':
                return [{ k: 'num', label: 'Size:', min: 1, max: 100, unit: 'px', get: (ww) => (ww.opt.size > 0 ? ww.opt.size : 1), set: (ww, v) => { ww.opt.size = v; } }, SEP, MODE, OPACITY()];
            case 'airbrush':
                return [SIZE, SEP, OPACITY('Flow:')];
            case 'eraser':
                return [SIZE, HARD, SEP, OPACITY()];
            case 'fill':
                return [OPACITY(), SEP, TOL, { k: 'check', key: 'contiguous', label: 'Contiguous' }, ALL];
            case 'gradient':
                return [{ k: 'seg', key: 'gradient', options: [['linear', 'Linear Gradient', art(6)], ['radial', 'Radial Gradient', art(7)], ['reflected', 'Reflected Gradient', art(8)]] }, SEP,
                    MODE, OPACITY(), { k: 'check', key: 'gradReverse', label: 'Reverse' }];
            case 'text': case 'vtext': case 'textmask': case 'vtextmask': {
                const f = w.textFont();
                const T = root.paintType;
                return [
                    { k: 'btn', icon: art(15), title: 'Toggle text orientation', run: (ww) => ww.toggleTextOrientation() },
                    SEP,
                    { k: 'custom', title: 'Font family', mount: (ww, el) => T && T.fontPicker(ww, el, () => ww.textFont().face, (v) => ww.setTextFont({ TextFace: v })) },
                    { k: 'custom', title: 'Font style', mount: (ww, el) => T && T.stylePicker(ww, el, () => ww.textFont(), (s) => ww.setTextFont({ TextWeight: s.weight, TextItalic: s.italic, TextBold: s.weight >= 600 })) },
                    { k: 'select', label: '', title: 'Font size', options: [6, 8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96, 144].map((n) => [String(n), `${n} pt`]).concat(/^(6|8|9|10|11|12|14|18|24|30|36|48|60|72|96|144)$/.test(String(f.size)) ? [] : [[String(f.size), `${f.size} pt`]]), get: (ww) => String(ww.textFont().size), set: (ww, v) => { ww.setTextFont({ TextSize: Number(v) }); } },
                    { k: 'select', label: '', title: 'Anti-aliasing method', options: [['smooth', 'Smooth'], ['none', 'None']], get: (ww) => ww.textFont().aa, set: (ww, v) => ww.setTextFont({ TextAA: v }) },
                    SEP,
                    { k: 'seg', title: 'Alignment', options: [['left', 'Left align text', '<span class="mp-al is-left"></span>'], ['center', 'Center text', '<span class="mp-al is-center"></span>'], ['right', 'Right align text', '<span class="mp-al is-right"></span>']], get: (ww) => ww.textFont().align, set: (ww, v) => ww.setTextFont({ TextAlign: v }) },
                    SEP,
                    { k: 'toggle', label: '<u>T</u>', title: 'Underline', get: (ww) => !!ww.textFont().underline, set: (ww, v) => ww.setTextFont({ TextUnderline: v }) },
                    { k: 'toggle', label: '<s>T</s>', title: 'Strikethrough', get: (ww) => !!ww.textFont().strike, set: (ww, v) => ww.setTextFont({ TextStrike: v }) },
                    { k: 'color', title: 'Text Color', get: (ww) => (ww.text ? ww.text.color : ww.fg), set: (ww, c) => { if (ww.text) { ww.text.color = c; ww.restyleText(); } else { ww.fg = c; ww.renderColors(); } } },
                    { k: 'btn', label: 'Character', title: 'The Character window: leading, tracking, caps ...', action: 'character' },
                    ...(w.text ? [SEP, { k: 'btn', icon: art(12), title: 'Cancel (Esc)', run: (ww) => ww.cancelText() }, { k: 'btn', icon: art(11), title: 'Commit the text', run: (ww) => ww.finishText() }] : [])];
            }
            case 'rect': case 'ellipse':
                return [SHAPE_MODE, SEP, SHAPE_FILL, SEP, WEIGHT, OPACITY(), ...vectorItems(w)];
            case 'polygon':
                return [SHAPE_FILL, SEP, WEIGHT, OPACITY()];
            case 'roundrect':
                return [SHAPE_MODE, SEP, SHAPE_FILL, SEP, WEIGHT, { k: 'num', key: 'radius', label: 'Radius:', min: 0, max: 500, unit: 'px' }, OPACITY(), ...vectorItems(w)];
            case 'line':
                return [SHAPE_MODE, SEP, WEIGHT, SEP, OPACITY(), ...vectorItems(w)];
            case 'curve':
                return [WEIGHT, SEP, OPACITY()];
            case 'pen':
                return [{ k: 'select', key: 'penMode', label: '', title: 'Pick tool mode', options: [['path', 'Path'], ['shape', 'Shape']] }, SEP,
                    { k: 'label', text: 'Make:' },
                    { k: 'btn', label: 'Selection...', title: 'Load the path as a selection (Ctrl+Enter)', action: 'path-select' },
                    { k: 'btn', label: 'Fill', title: 'Fill the path with the drawing color', action: 'path-fill' },
                    { k: 'btn', label: 'Stroke', title: 'Stroke the path with the brush', action: 'path-stroke' }, ...vectorItems(w)];
            case 'pathselect': case 'directselect':
                return [{ k: 'btn', label: 'Selection...', title: 'Load the path as a selection (Ctrl+Enter)', action: 'path-select' },
                    { k: 'btn', label: 'Paths', title: 'Show or hide the Paths window', action: 'paths' }, ...vectorItems(w)];
            case 'clone':
                return [SIZE, HARD, SEP, OPACITY(), { k: 'check', key: 'cloneAligned', label: 'Aligned', title: 'Every stroke keeps the same distance to its source' }, ALL];
            case 'heal':
                return [SIZE, SEP, { k: 'label', text: 'Type: Content-Aware' }];
            case 'blur':
                return [SIZE, SEP, OPACITY('Strength:')];
            case 'smudge':
                return [SIZE, HARD, SEP, OPACITY('Strength:')];
            case 'dodge': case 'burn':
                return [SIZE, HARD, SEP, { k: 'select', key: 'toneRange', label: 'Range:', options: [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']] }, OPACITY('Exposure:')];
            case 'sponge':
                return [SIZE, HARD, SEP, { k: 'select', key: 'spongeMode', label: 'Mode:', options: [['saturate', 'Saturate'], ['desaturate', 'Desaturate']] }, OPACITY('Flow:')];
            case 'picker':
                return [{ k: 'select', key: 'sampleSize', label: 'Sample Size:', options: [['1', 'Point Sample'], ['3', '3 by 3 Average'], ['5', '5 by 5 Average'], ['11', '11 by 11 Average']] },
                    { k: 'select', label: 'Sample:', options: [['layer', 'Current Layer'], ['all', 'All Layers']], get: (ww) => (ww.opt.sampleAll ? 'all' : 'layer'), set: (ww, v) => { ww.opt.sampleAll = v === 'all'; } }];
            case 'magnifier':
                return [{ k: 'seg', key: 'zoomOut', options: [[false, 'Zoom In', art(9)], [true, 'Zoom Out (Alt)', art(10)]] }, SEP, ...ZOOM_BTNS];
            case 'hand':
                return [...ZOOM_BTNS, SEP, { k: 'label', text: 'Hold Space with any tool to scroll' }];
            default:
                return [];
        }
    }

    /** Free Transform's bar: the box's place, size and angle, Commit and Cancel. */
    function transformItems(w) {
        const t = w.xf;
        const deg = () => { let a = ((t.angle * 180) / Math.PI) % 360; if (a > 180) a -= 360; if (a <= -180) a += 360; return Math.round(a * 10) / 10; };
        const redraw = (ww) => ww.drawXf();
        return [
            { k: 'num', label: 'X:', unit: 'px', min: -100000, max: 100000, get: () => Math.round(t.cx), set: (ww, v) => { t.cx = v; }, after: redraw },
            { k: 'num', label: 'Y:', unit: 'px', min: -100000, max: 100000, get: () => Math.round(t.cy), set: (ww, v) => { t.cy = v; }, after: redraw },
            SEP,
            { k: 'num', label: 'W:', unit: '%', min: 1, max: 10000, step: 0.1, get: () => Math.round((t.w / t.src.width) * 1000) / 10, set: (ww, v) => { const k = v / 100; if (ww.opt.keepRatio !== false) t.h = t.h * ((t.src.width * k) / t.w); t.w = t.src.width * k; }, after: (ww) => { ww.drawXf(); ww.updateBar(); } },
            { k: 'check', key: 'keepRatio', label: art(14), title: 'Keep the proportions' },
            { k: 'num', label: 'H:', unit: '%', min: 1, max: 10000, step: 0.1, get: () => Math.round((t.h / t.src.height) * 1000) / 10, set: (ww, v) => { const k = v / 100; if (ww.opt.keepRatio !== false) t.w = t.w * ((t.src.height * k) / t.h); t.h = t.src.height * k; }, after: (ww) => { ww.drawXf(); ww.updateBar(); } },
            SEP,
            { k: 'num', label: 'Angle:', unit: '\u00b0', min: -360, max: 360, step: 0.1, get: deg, set: (ww, v) => { t.angle = (v * Math.PI) / 180; }, after: redraw },
            SEP,
            { k: 'btn', icon: art(12), title: 'Cancel the transform (Esc)', action: 'escape' },
            { k: 'btn', icon: art(11), title: 'Commit the transform (Enter)', action: 'enter' }
        ];
    }

    function items(w) {
        if (w.xf) return { title: 'Free Transform', list: transformItems(w) };
        if (w.warp) {
            return { title: { distort: 'Distort', perspective: 'Perspective', warp: 'Warp', puppet: 'Puppet Warp' }[w.warp.kind], list: [
                { k: 'label', text: w.warp.kind === 'puppet' ? 'Click to add a pin; Alt+click removes it' : 'Drag the points' }, SEP,
                { k: 'btn', icon: art(12), title: 'Cancel (Esc)', action: 'escape' }, { k: 'btn', icon: art(11), title: 'Commit (Enter)', action: 'enter' }] };
        }
        return { title: (root.melatonPaint.TOOLS.find((x) => x[0] === w.tool) || [])[1] || '', list: toolItems(w) };
    }

    function valueOf(w, it) {
        if (it.get) return it.get(w);
        return w.opt[it.key];
    }

    function setValue(w, it, v) {
        if (it.set) it.set(w, v); else w.opt[it.key] = v;
        if (it.after) it.after(w);
        w.renderOptions();
    }

    function html(w, it, i) {
        const v = valueOf(w, it);
        const label = it.label ? `<span class="mp-bar-label">${it.label}</span>` : '';
        const title = it.title ? ` title="${esc(it.title)}"` : '';
        switch (it.k) {
            case 'sep': return '<span class="mp-bar-sep"></span>';
            case 'label': return `<span class="mp-bar-text">${esc(it.text)}</span>`;
            case 'num':
                return `<label class="mp-bar-item"${title}>${label}<input type="number" class="tbp-edit mp-bar-num" data-i="${i}" min="${it.min}" max="${it.max}" step="${it.step || 1}" value="${esc(v)}">${it.unit ? `<span class="mp-bar-unit">${it.unit}</span>` : ''}</label>`;
            case 'slider':
                return `<label class="mp-bar-item"${title}>${label}<input type="number" class="tbp-edit mp-bar-num" data-i="${i}" min="${it.min}" max="${it.max}" value="${esc(v)}"><span class="mp-bar-unit">${it.unit || ''}</span><input type="range" class="mp-bar-range" data-i="${i}" min="${it.min}" max="${it.max}" value="${esc(v)}"></label>`;
            case 'check':
                return `<label class="mp-bar-item mp-bar-check"${title}><input type="checkbox" data-i="${i}"${v ? ' checked' : ''}><span>${it.label}</span></label>`;
            case 'select':
                return `<label class="mp-bar-item"${title}>${label}<select class="mp-bar-select" data-i="${i}">${it.options.map(([ov, ot]) => `<option value="${esc(ov)}"${String(ov) === String(v) ? ' selected' : ''}>${esc(ot)}</option>`).join('')}</select></label>`;
            case 'seg':
                return `<span class="mp-bar-seg" role="group">${it.options.map(([ov, ot, inner], k) => `<button type="button" class="mp-bar-btn${String(ov) === String(v) ? ' is-on' : ''}" data-i="${i}" data-k="${k}" title="${esc(ot)}">${inner}</button>`).join('')}</span>`;
            case 'toggle':
                return `<button type="button" class="mp-bar-btn mp-bar-toggle${v ? ' is-on' : ''}" data-i="${i}"${title}>${it.label}</button>`;
            case 'btn':
                return `<button type="button" class="mp-bar-btn${it.icon ? '' : ' is-text'}" data-i="${i}"${title}>${it.icon || esc(it.label)}</button>`;
            case 'custom':
                return `<span class="mp-bar-custom" data-c="${i}"${title}></span>`;
            case 'color':
                return `<button type="button" class="mp-bar-btn mp-bar-color" data-i="${i}"${title}><span style="background:${root.paintColor ? root.paintColor.swatchBg(v) : v}"></span></button>`;
            default: return '';
        }
    }

    function render(w) {
        const bar = w.modal.querySelector('.mp-settings');
        if (!bar) return;
        const { title, list } = items(w);
        bar.dataset.context = w.xf ? 'transform' : w.tool;
        const tool = root.melatonPaint.TOOLS.findIndex((x) => x[0] === w.tool);
        const icon = w.xf
            ? '<span class="mp-bar-tool" title="Free Transform"><span class="mp-tool-art is-extra" style="--i:0"></span></span>'
            : `<span class="mp-bar-tool" title="${esc(title)}"><span class="mp-tool-art${tool >= 16 ? ' is-extra' : ''}" style="--i:${tool < 16 ? tool : tool - 16}"></span></span>`;
        bar.innerHTML = icon + '<span class="mp-bar-sep"></span>' + list.map((it, i) => html(w, it, i)).join('');
        bar.mpItems = list;
        bar.querySelectorAll('.mp-bar-custom').forEach((el) => { const it = list[Number(el.dataset.c)]; if (it && it.mount) it.mount(w, el); });
        if (!bar.mpWired) {
            bar.mpWired = true;
            const itemOf = (el) => bar.mpItems[Number(el.dataset.i)];
            const field = (el) => {
                const it = itemOf(el);
                if (!it) return;
                let v = Number(el.value);
                if (!Number.isFinite(v)) return;
                v = Math.max(it.min, Math.min(it.max, v));
                setValue(w, it, v);
                // the number box and the slider move together
                bar.querySelectorAll(`[data-i="${el.dataset.i}"]`).forEach((o) => { if (o !== el && (o.type === 'number' || o.type === 'range')) o.value = String(v); });
            };
            bar.addEventListener('input', (ev) => {
                const el = ev.target;
                if (el.type === 'range' || el.type === 'number') field(el);
            });
            bar.addEventListener('change', (ev) => {
                const el = ev.target;
                const it = itemOf(el);
                if (!it) return;
                if (el.type === 'checkbox') setValue(w, it, el.checked);
                else if (el.tagName === 'SELECT') setValue(w, it, el.value);
                else if (el.type === 'number') { field(el); w.updateBar(); }
            });
            // the bar's buttons keep a text box's focus
            bar.addEventListener('mousedown', (ev) => { if (ev.target.closest('button') && w.text) ev.preventDefault(); });
            bar.addEventListener('click', (ev) => {
                const b = ev.target.closest('button[data-i]');
                if (!b) return;
                const it = itemOf(b);
                if (!it) return;
                if (it.k === 'seg') {
                    const [ov] = it.options[Number(b.dataset.k)];
                    setValue(w, it, ov);
                    w.renderBar();
                } else if (it.k === 'toggle') {
                    setValue(w, it, !valueOf(w, it));
                    w.renderBar();
                } else if (it.k === 'color') {
                    if (root.paintColor) root.paintColor.picker(w, 'fg', { color: valueOf(w, it), title: it.title, onPick: (c) => { setValue(w, it, c); w.renderBar(); } });
                } else if (it.run) it.run(w);
                else if (it.action) void w.action(it.action);
            });
            // Enter in a field applies it (and must not commit the transform under it)
            bar.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && ev.target.type === 'number') { ev.stopPropagation(); ev.target.blur(); }
                if (ev.key === 'Escape') ev.target.blur();
            });
        }
    }

    /** New values into the bar without rebuilding it (the field being typed in keeps its text). */
    function update(w) {
        const bar = w.modal.querySelector('.mp-settings');
        if (!bar || !bar.mpItems) return;
        if ((w.xf ? 'transform' : w.tool) !== bar.dataset.context || bar.querySelector('.mp-bar-custom')) { render(w); return; }
        bar.querySelectorAll('[data-i]').forEach((el) => {
            const it = bar.mpItems[Number(el.dataset.i)];
            if (!it || el === document.activeElement) return;
            const v = valueOf(w, it);
            if (el.type === 'number' || el.type === 'range') el.value = String(v);
            else if (el.type === 'checkbox') el.checked = !!v;
            else if (el.tagName === 'SELECT') el.value = String(v);
        });
    }

    root.paintBar = { render, update };
})(typeof window !== 'undefined' ? window : globalThis);
