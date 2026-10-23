/**
 * Paint's layers (Yozora #632): the Layers window docked at the right of the canvas (F7), the
 * History window (F8), and the Layers and Adjustments menus.
 *
 *   Layers window   a thumbnail, the name and the visibility check box per layer, top first; the
 *                   active one highlighted; double-click (or Layer Properties) for its name, blend
 *                   mode, opacity, visibility and lock; the buttons Add New Layer, Delete Layer,
 *                   Duplicate Layer, Merge Layer Down, Move Layer Up, Move Layer Down
 *   History window  every step since the picture opened; click one to go back to it
 *   Adjustments     Brightness / Contrast, Hue / Saturation, Black and White, Sepia, Invert Colors,
 *                   Posterize, Blur, Sharpen: over the selection or the whole layer, with a live
 *                   preview in their dialog
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const CMD = '/static_images/vista-cmdbar';
    const BLEND_NAMES = {
        normal: 'Normal', multiply: 'Multiply', additive: 'Additive', 'color-burn': 'Color Burn', 'color-dodge': 'Color Dodge',
        darken: 'Darken', difference: 'Difference', exclusion: 'Exclusion', 'hard-light': 'Glow', lighten: 'Lighten',
        overlay: 'Overlay', screen: 'Screen', 'soft-light': 'Soft Light', hue: 'Hue', saturation: 'Saturation',
        color: 'Color', luminosity: 'Luminosity'
    };

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    // ---- the dock ---------------------------------------------------------------------------

    function dock(w) {
        return w.modal.querySelector('.mp-dock');
    }

    function isOpen(w) {
        return !!dock(w).querySelector('.mp-layers');
    }

    function historyOpen(w) {
        return !!dock(w).querySelector('.mp-history');
    }

    function toggle(w) {
        const d = dock(w);
        const cur = d.querySelector('.mp-layers');
        if (cur) cur.remove();
        else {
            d.insertAdjacentHTML('afterbegin', `<div class="mp-panel mp-layers">
                <div class="mp-panel-cap">Layers</div>
                <div class="mp-layer-list" role="listbox" tabindex="0"></div>
                <div class="mp-panel-bar" role="toolbar">
                    <button type="button" data-layer="add" title="Add New Layer"><img src="${CMD}/add.png" alt=""></button>
                    <button type="button" data-layer="delete" title="Delete Layer"><img src="${CMD}/delete.png" alt=""></button>
                    <button type="button" data-layer="duplicate" title="Duplicate Layer"><img src="${CMD}/copy.png" alt=""></button>
                    <button type="button" data-layer="merge" title="Merge Layer Down"><img src="${CMD}/move-down.png" alt="" style="filter:hue-rotate(90deg)"></button>
                    <button type="button" data-layer="up" title="Move Layer Up"><img src="${CMD}/move-up.png" alt=""></button>
                    <button type="button" data-layer="down" title="Move Layer Down"><img src="${CMD}/move-down.png" alt=""></button>
                    <button type="button" data-layer="properties" title="Layer Properties"><img src="${CMD}/properties.png" alt=""></button>
                    <button type="button" data-layer="group" title="Group Layer (Ctrl+G)"><img src="${CMD}/folder.png" alt=""></button>
                    <button type="button" data-layer="mask" title="Add Layer Mask"><img src="${CMD}/contrast.png" alt=""></button>
                    <button type="button" data-layer="style" title="Layer Style"><img src="${CMD}/paint-ellipse.png" alt=""></button>
                </div>
            </div>`);
            const panel = d.querySelector('.mp-layers');
            panel.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-layer]');
                if (b) { action(w, `layer-${b.dataset.layer}`); return; }
                const grow = ev.target.closest('.mp-group-row');
                if (grow) {
                    const g = w.doc.group(Number(grow.dataset.g));
                    if (!g) return;
                    if (ev.target.closest('.mp-group-twisty')) g.collapsed = !g.collapsed;
                    else if (ev.target.closest('.mp-group-vis')) { g.visible = !g.visible; w.doc.markDirty(); } else {
                        // the group is selected; the tools paint its top layer
                        w.activeGroup = g.id;
                        const top = w.doc.layers.map((x, k) => [x, k]).filter(([x]) => x.groupId === g.id).pop();
                        if (top) w.doc.active = top[1];
                        w.doc.editMask = false;
                    }
                    refresh(w);
                    return;
                }
                w.activeGroup = null;
                const vis = ev.target.closest('.mp-layer-vis');
                const row = ev.target.closest('.mp-layer-row');
                if (!row) return;
                const i = Number(row.dataset.i);
                const maskThumb = ev.target.closest('.mp-layer-mask');
                if (maskThumb && ev.shiftKey) {
                    const m = w.doc.layers[i].mask;
                    m.enabled = !m.enabled;
                    w.doc.markDirty();
                    refresh(w);
                    return;
                }
                if (vis) {
                    w.doc.layers[i].visible = !w.doc.layers[i].visible;
                    w.doc.markDirty();
                    refresh(w);
                    return;
                }
                if (ev.altKey && !maskThumb) {
                    // Alt+click a layer: clip it to the one under it, or release it (Photoshop)
                    action(w, 'layer-clip', i);
                    return;
                }
                w.commitFloating();
                w.doc.active = i;
                // the mask's thumbnail makes the mask what the tools paint (Photoshop)
                w.doc.editMask = !!(maskThumb && w.doc.layers[i].mask);
                refresh(w);
            });
            panel.addEventListener('dblclick', (ev) => {
                const grow = ev.target.closest('.mp-group-row');
                if (grow) { if (!ev.target.closest('.mp-group-twisty, .mp-group-vis')) groupProperties(w, Number(grow.dataset.g)); return; }
                const row = ev.target.closest('.mp-layer-row');
                if (!row) return;
                w.doc.active = Number(row.dataset.i);
                const l = w.doc.activeLayer;
                if (ev.target.closest('.mp-layer-fx') && root.paintPro) root.paintPro.action(w, 'layer-style');
                else if (l.adjust && root.paintPro && !ev.target.closest('.mp-layer-name')) root.paintPro.action(w, 'adjlayer-edit');
                else if (l.text && !ev.target.closest('.mp-layer-name')) { w.setTool('text'); w.startText(null, l); }
                else if (l.smart && root.paintSmart && !ev.target.closest('.mp-layer-name')) void root.paintSmart.editContents(w);
                else properties(w);
            });
        }
        refresh(w);
    }

    function toggleHistory(w) {
        const d = dock(w);
        const cur = d.querySelector('.mp-history');
        if (cur) cur.remove();
        else {
            d.insertAdjacentHTML('beforeend', '<div class="mp-panel mp-history"><div class="mp-panel-cap">History</div><div class="mp-history-list" role="listbox" tabindex="0"></div></div>');
            d.querySelector('.mp-history').addEventListener('click', (ev) => {
                const row = ev.target.closest('.mp-history-row');
                if (!row) return;
                w.commitFloating();
                w.doc.goTo(Number(row.dataset.i));
            });
        }
        refresh(w);
    }

    function refresh(w) {
        const d = dock(w);
        w.modal.classList.toggle('mp-has-dock', !!d.children.length);
        const list = d.querySelector('.mp-layer-list');
        if (list) {
            const rows = w.doc.layers.map((l, i) => ({ l, i })).reverse();
            const onMask = (i) => i === w.doc.active && w.doc.editMask && w.doc.layers[i].mask;
            const doc0 = w.doc;
            // a group's header goes above its top layer; its layers are indented, hidden when it is closed
            const header = (g) => `<div class="mp-layer-row mp-group-row${w.activeGroup === g.id ? ' is-active' : ''}" data-g="${g.id}" role="option">
                <button type="button" class="mp-group-twisty${g.collapsed ? ' is-closed' : ''}" title="${g.collapsed ? 'Expand' : 'Collapse'}"></button>
                <span class="mp-group-icon"></span>
                <span class="mp-layer-name">${esc(g.name)}</span>
                <input type="checkbox" class="mp-group-vis" title="Visible"${g.visible ? ' checked' : ''}>
            </div>`;
            let lastGroup = null;
            // a clipped layer (and its base, whose name Photoshop underlines)
            const clipped = (i) => i > 0 && doc0.layers[i].clip && doc0.layers[i - 1].groupId === doc0.layers[i].groupId;
            const clipBase = (i) => !doc0.layers[i].clip && i + 1 < doc0.layers.length && clipped(i + 1);
            list.innerHTML = rows.map(({ l, i }) => {
                const g = l.groupId ? doc0.group(l.groupId) : null;
                let head = '';
                if (g && g.id !== lastGroup) head = header(g);
                lastGroup = g ? g.id : null;
                const child = (g ? ` is-child${g.collapsed ? ' is-hidden' : ''}` : '') + (clipped(i) ? ' is-clipped' : '') + (clipBase(i) ? ' is-clip-base' : '');
                return `${head}<div class="mp-layer-row${i === w.doc.active && !w.activeGroup ? ' is-active' : ''}${l.mask ? ' has-mask' : ''}${child}" data-i="${i}" role="option">
                ${l.adjust ? `<span class="mp-layer-thumb mp-layer-kind is-adjust" title="Adjustment layer (double-click to change)"></span>` : l.text ? `<span class="mp-layer-thumb mp-layer-kind is-text${i === w.doc.active && !onMask(i) ? ' is-target' : ''}" title="Type layer (double-click to edit)">T</span>` : `<canvas class="mp-layer-thumb${i === w.doc.active && !onMask(i) ? ' is-target' : ''}" width="40" height="30" data-i="${i}"></canvas>`}
                ${l.mask ? `<canvas class="mp-layer-mask${onMask(i) ? ' is-target' : ''}${l.mask.enabled ? '' : ' is-off'}" width="40" height="30" data-i="${i}" title="Layer mask (Shift+click turns it off)"></canvas>` : ''}
                <span class="mp-layer-name">${esc(l.name)}${l.locked ? ' <i class="mp-layer-lock" title="Locked"></i>' : ''}${C().hasEffects(l) ? ' <i class="mp-layer-fx" title="Layer Style (double-click)">fx</i>' : ''}${l.vector ? ' <i class="mp-layer-vec" title="Shape layer (its path stays sharp; painting rasterizes it)"></i>' : ''}${l.smart ? ` <i class="mp-layer-so" title="Smart Object (double-click the thumbnail to edit its contents)${l.smart.filters.length ? `. Smart filters: ${esc(l.smart.filters.map((f) => f.label).join(', '))}` : ''}"></i>` : ''}</span>
                <input type="checkbox" class="mp-layer-vis" title="Visible"${l.visible ? ' checked' : ''}>
            </div>`;
            }).join('');
            thumbs(w, true);
        }
        const hist = d.querySelector('.mp-history-list');
        if (hist) {
            const h = w.doc.history;
            hist.innerHTML = `<div class="mp-history-row${w.doc.historyIndex === -1 ? ' is-active' : ''}" data-i="-1">Open Image</div>`
                + h.map((s, i) => `<div class="mp-history-row${i === w.doc.historyIndex ? ' is-active' : ''}${i > w.doc.historyIndex ? ' is-undone' : ''}" data-i="${i}">${esc(s.label)}</div>`).join('');
            const act = hist.querySelector('.is-active');
            if (act) act.scrollIntoView({ block: 'nearest' });
        }
    }

    // layer thumbnails: redrawn at most every 250 ms while painting
    function thumbs(w, now) {
        const list = dock(w).querySelector('.mp-layer-list');
        if (!list) return;
        if (!now) {
            if (w.thumbTimer) return;
            w.thumbTimer = setTimeout(() => { w.thumbTimer = 0; thumbs(w, true); }, 250);
            return;
        }
        list.querySelectorAll('canvas.mp-layer-thumb, canvas.mp-layer-mask').forEach((c) => {
            const layer = w.doc.layers[Number(c.dataset.i)];
            if (!layer) return;
            const l = c.classList.contains('mp-layer-mask') ? layer.mask : layer;
            if (!l) return;
            const x = c.getContext('2d');
            const s = Math.min(c.width / w.doc.width, c.height / w.doc.height);
            const dw = w.doc.width * s;
            const dh = w.doc.height * s;
            x.clearRect(0, 0, c.width, c.height);
            x.fillStyle = '#fff';
            x.fillRect((c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
            x.drawImage(l.canvas, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
        });
    }

    function detach(w) {
        clearTimeout(w.thumbTimer);
    }

    // ---- Layers menu --------------------------------------------------------------------------

    function menu(w) {
        const d = w.doc;
        return [
            { text: 'Add New Layer', subtext: 'Ctrl+Shift+N', action: 'layer-add' },
            { text: 'New Adjustment Layer', hasSubmenu: true, submenu: root.paintPro ? root.paintPro.adjustLayerMenu() : [] },
            { text: 'Delete Layer', subtext: 'Ctrl+Shift+Del', action: 'layer-delete', disabled: d.layers.length <= 1 },
            { text: 'Duplicate Layer', action: 'layer-duplicate' },
            { text: 'Group Layer', subtext: 'Ctrl+G', action: 'group-new', disabled: !!d.activeLayer.groupId },
            { text: 'Ungroup Layers', subtext: 'Ctrl+Shift+G', action: 'group-ungroup', disabled: !d.activeLayer.groupId },
            { text: 'Delete Group', action: 'group-delete', disabled: !d.activeLayer.groupId },
            { text: 'Group Properties...', action: 'group-properties', disabled: !d.activeLayer.groupId },
            { text: 'Layer via Copy', subtext: 'Ctrl+J', action: 'layer-via-copy' },
            { text: 'Layer via Cut', subtext: 'Ctrl+Shift+J', action: 'layer-via-cut', disabled: !d.selection },
            { text: 'Merge Layer Down', subtext: 'Ctrl+E', action: 'layer-merge', disabled: d.active === 0 },
            { separator: true },
            { text: d.activeLayer.clip ? 'Release Clipping Mask' : 'Create Clipping Mask', subtext: 'Alt+Ctrl+G', action: 'layer-clip', disabled: d.active === 0 },
            { text: 'Import From File...', action: 'layer-import' },
            { separator: true },
            { text: 'Flip Horizontal', action: 'layer-flip-h' },
            { text: 'Flip Vertical', action: 'layer-flip-v' },
            { text: 'Rotate / Zoom...', action: 'layer-rotate' },
            { separator: true },
            { text: 'Move Layer Up', action: 'layer-up', disabled: d.active >= d.layers.length - 1 },
            { text: 'Move Layer Down', action: 'layer-down', disabled: d.active === 0 },
            { text: 'Flatten', subtext: 'Ctrl+Shift+E', action: 'layer-flatten', disabled: d.layers.length <= 1 },
            { separator: true },
            { text: 'Layer Mask', hasSubmenu: true, submenu: [
                { text: 'Reveal All', action: 'mask-reveal-all', disabled: !!d.activeLayer.mask },
                { text: 'Hide All', action: 'mask-hide-all', disabled: !!d.activeLayer.mask },
                { text: 'Reveal Selection', action: 'mask-reveal-sel', disabled: !!d.activeLayer.mask || !d.selection },
                { text: 'Hide Selection', action: 'mask-hide-sel', disabled: !!d.activeLayer.mask || !d.selection },
                { separator: true },
                { text: 'Edit Mask', action: 'mask-edit', showIndicator: true, checked: !!(d.editMask && d.activeLayer.mask), disabled: !d.activeLayer.mask },
                { text: d.activeLayer.mask && !d.activeLayer.mask.enabled ? 'Enable' : 'Disable', action: 'mask-toggle', disabled: !d.activeLayer.mask },
                { text: 'Apply', action: 'mask-apply', disabled: !d.activeLayer.mask },
                { text: 'Delete', action: 'mask-delete', disabled: !d.activeLayer.mask }
            ] },
            { text: 'Layer Style', hasSubmenu: true, submenu: [
                { text: 'Blending Options...', action: 'layer-style' },
                { separator: true },
                { text: 'Copy Layer Style', action: 'style-copy', disabled: !C().hasEffects(d.activeLayer) },
                { text: 'Paste Layer Style', action: 'style-paste', disabled: !w.styleClip },
                { text: 'Clear Layer Style', action: 'style-clear', disabled: !C().hasEffects(d.activeLayer) }
            ] },
            { text: 'Smart Objects', hasSubmenu: true, submenu: root.paintSmart ? root.paintSmart.menu(w) : [] },
            { text: 'Rasterize Type', action: 'layer-rasterize', disabled: !d.activeLayer.text },
            { text: 'Rasterize Shape', action: 'shape-rasterize', disabled: !d.activeLayer.vector },
            { text: 'Layer from Background', action: 'layer-from-bg', disabled: !d.activeLayer.isBackground },
            { text: 'Background from Layer', action: 'layer-to-bg', disabled: d.activeLayer.isBackground || d.layers.some((x) => x.isBackground) || !!d.activeLayer.adjust },
            { separator: true },
            { text: 'Layer Properties...', subtext: 'F4', action: 'layer-properties' }
        ];
    }

    function adjustMenu() {
        return [
            { text: 'Auto-Level', action: 'adj-autolevel' },
            { text: 'Black and White', subtext: 'Ctrl+Shift+G', action: 'adj-bw' },
            { text: 'Brightness / Contrast...', action: 'adj-brightness' },
            { text: 'Hue / Saturation...', action: 'adj-hue' },
            { text: 'Invert Colors', subtext: 'Ctrl+I', action: 'invert' },
            { text: 'Posterize...', action: 'adj-posterize' },
            { text: 'Sepia', subtext: 'Ctrl+Shift+E', action: 'adj-sepia' },
            { separator: true },
            { text: 'Blur', action: 'adj-blur' },
            { text: 'Sharpen', action: 'adj-sharpen' }
        ];
    }

    function structural(w, label, fn) {
        w.commitFloating();
        w.finishText();
        w.doc.snapshotStep(label, fn);
        refresh(w);
    }

    function flipLayer(w, h) {
        if (!w.editable()) return;
        const l = w.doc.layer;
        const r = { x: 0, y: 0, w: w.doc.width, h: w.doc.height };
        const step = w.doc.beginStep(h ? 'Flip Layer Horizontal' : 'Flip Layer Vertical', l, r);
        const copy = C().makeCanvas(r.w, r.h);
        copy.getContext('2d').drawImage(l.canvas, 0, 0);
        l.ctx.save();
        l.ctx.clearRect(0, 0, r.w, r.h);
        l.ctx.translate(h ? r.w : 0, h ? 0 : r.h);
        l.ctx.scale(h ? -1 : 1, h ? 1 : -1);
        l.ctx.drawImage(copy, 0, 0);
        l.ctx.restore();
        w.doc.commitStep(step);
        w.doc.markDirty();
    }

    function action(w, a, at) {
        const d = w.doc;
        switch (a) {
            case 'layer-clip': {
                const i = at === undefined ? d.active : at;
                const l = d.layers[i];
                if (!l || i === 0) return true;
                structural(w, l.clip ? 'Release Clipping Mask' : 'Create Clipping Mask', () => { l.clip = !l.clip; d.markDirty(); d.emit('layers'); });
                return true;
            }
            case 'layer-add': structural(w, 'Add Layer', () => { d.addLayer(`Layer ${d.layers.length + 1}`); }); return true;
            case 'layer-delete': if (d.layers.length > 1) structural(w, 'Delete Layer', () => d.removeLayer(d.active)); return true;
            case 'layer-duplicate': structural(w, 'Duplicate Layer', () => d.duplicateLayer(d.active)); return true;
            case 'layer-merge': if (d.active > 0) structural(w, 'Merge Layer Down', () => d.mergeDown(d.active)); return true;
            case 'layer-up': structural(w, 'Move Layer Up', () => d.moveLayer(d.active, 1)); return true;
            case 'layer-down': structural(w, 'Move Layer Down', () => d.moveLayer(d.active, -1)); return true;
            case 'layer-flatten': structural(w, 'Flatten', () => d.flatten()); return true;
            case 'layer-properties': properties(w); return true;
            case 'layer-flip-h': flipLayer(w, true); return true;
            case 'layer-flip-v': flipLayer(w, false); return true;
            case 'layer-rotate': if (root.paintDialogs) root.paintDialogs.rotateLayer(w); return true;
            case 'layer-import': importLayer(w); return true;
            case 'layer-rasterize': w.rasterizeType(); return true;
            // the Background layer becomes a normal one: erasing then gives transparency (Photoshop)
            case 'layer-from-bg': if (d.activeLayer.isBackground) structural(w, 'Layer from Background', () => { const l = d.activeLayer; l.isBackground = false; if (l.name === 'Background') l.name = 'Layer 0'; }); return true;
            case 'layer-to-bg': if (!d.layers.some((x) => x.isBackground)) structural(w, 'Background from Layer', () => {
                const l = d.activeLayer;
                d.layers.splice(d.active, 1);
                d.layers.unshift(l);
                d.active = 0;
                l.groupId = null;
                d.pruneGroups();
                // its transparent pixels take the background colour
                const c = C().makeCanvas(d.width, d.height);
                const x = c.getContext('2d');
                x.fillStyle = w.bg;
                x.fillRect(0, 0, d.width, d.height);
                x.drawImage(l.canvas, 0, 0);
                l.ctx.clearRect(0, 0, d.width, d.height);
                l.ctx.drawImage(c, 0, 0);
                l.isBackground = true;
                l.name = 'Background';
                l.opacity = 1;
                l.blend = 'normal';
                d.markDirty();
            }); return true;
            case 'layer-group': case 'group-new': if (!d.activeLayer.groupId) { structural(w, 'Group Layer', () => d.groupLayer(d.active)); w.activeGroup = d.activeLayer.groupId; refresh(w); } return true;
            case 'group-ungroup': if (d.activeLayer.groupId) { const id = d.activeLayer.groupId; structural(w, 'Ungroup Layers', () => d.ungroup(id)); w.activeGroup = null; refresh(w); } return true;
            case 'group-delete': if (d.activeLayer.groupId) {
                const id = d.activeLayer.groupId;
                if (d.layers.every((x) => x.groupId === id)) { w.status('A picture keeps at least one layer.'); return true; }
                structural(w, 'Delete Group', () => {
                    d.layers = d.layers.filter((x) => x.groupId !== id);
                    d.active = Math.min(d.active, d.layers.length - 1);
                    d.pruneGroups();
                    d.markDirty();
                });
                w.activeGroup = null;
                refresh(w);
            } return true;
            case 'group-properties': if (d.activeLayer.groupId) groupProperties(w, d.activeLayer.groupId); return true;
            case 'layer-mask': return root.paintPro ? root.paintPro.action(w, d.selection ? 'mask-reveal-sel' : 'mask-reveal-all') : true;
            case 'layer-style': return root.paintPro ? root.paintPro.action(w, 'layer-style') : true;
            case 'adj-bw': w.adjust('Black and White', (r, g, b) => { const v = 0.299 * r + 0.587 * g + 0.114 * b; return [v, v, v]; }); return true;
            case 'adj-sepia': w.adjust('Sepia', (r, g, b) => [Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b), Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b), Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b)]); return true;
            case 'adj-autolevel': autoLevel(w); return true;
            case 'adj-brightness': if (root.paintPro) { root.paintPro.adjustPixels(w, 'brightness'); return true; } adjustDialog(w, 'Brightness / Contrast', [['Brightness', -100, 100, 0], ['Contrast', -100, 100, 0]], ([b, c]) => {
                const f = (259 * (c * 2.55 + 255)) / (255 * (259 - c * 2.55));
                return (r, g, bl) => [f * (r - 128) + 128 + b * 2.55, f * (g - 128) + 128 + b * 2.55, f * (bl - 128) + 128 + b * 2.55];
            }); return true;
            case 'adj-hue': if (root.paintPro) { root.paintPro.adjustPixels(w, 'hue'); return true; } adjustDialog(w, 'Hue / Saturation', [['Hue', -180, 180, 0], ['Saturation', 0, 200, 100], ['Lightness', -100, 100, 0]], ([h, s, l]) => (r, g, b) => {
                const hsl = C().rgbToHsl(r, g, b);
                let hh = (hsl[0] + h / 360) % 1;
                if (hh < 0) hh += 1;
                const ll = l >= 0 ? hsl[2] + (1 - hsl[2]) * (l / 100) : hsl[2] * (1 + l / 100);
                return C().hslToRgb(hh, Math.min(1, hsl[1] * (s / 100)), ll);
            }); return true;
            case 'adj-posterize': if (root.paintPro) { root.paintPro.adjustPixels(w, 'posterize'); return true; } adjustDialog(w, 'Posterize', [['Levels', 2, 64, 16]], ([n]) => {
                const step = 255 / (n - 1);
                return (r, g, b) => [Math.round(r / step) * step, Math.round(g / step) * step, Math.round(b / step) * step];
            }); return true;
            case 'adj-blur': convolve(w, 'Blur', [1, 2, 1, 2, 4, 2, 1, 2, 1], 16); return true;
            case 'adj-sharpen': convolve(w, 'Sharpen', [0, -1, 0, -1, 5, -1, 0, -1, 0], 1); return true;
            default: return false;
        }
    }

    function areaOf(w) {
        const s = w.doc.selection;
        return C().clampRect(s ? { x: s.x, y: s.y, w: s.w, h: s.h } : { x: 0, y: 0, w: w.doc.width, h: w.doc.height }, w.doc.width, w.doc.height);
    }

    function convolve(w, label, kernel, div) {
        w.commitFloating();
        if (!w.editable()) return;
        const r = areaOf(w);
        if (!r) return;
        const step = w.doc.beginStep(label, w.doc.layer, r);
        C().convolve(w.doc.layer.ctx, r, kernel, div);
        w.doc.commitStep(step);
        w.doc.markDirty(r);
    }

    function autoLevel(w) {
        const r = areaOf(w);
        if (!r || !w.editable()) return;
        const d = w.doc.layer.ctx.getImageData(r.x, r.y, r.w, r.h).data;
        let lo = 255;
        let hi = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (!d[i + 3]) continue;
            const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        if (hi - lo < 2) return;
        const k = 255 / (hi - lo);
        w.adjust('Auto-Level', (rr, g, b) => [(rr - lo) * k, (g - lo) * k, (b - lo) * k]);
    }

    /** A slider dialog with a live preview on the canvas; OK keeps it, Cancel puts the pixels back. */
    function adjustDialog(w, title, sliders, makeFn) {
        w.commitFloating();
        if (!w.editable() || !root.vistaDialogTemplate) return;
        const r = areaOf(w);
        if (!r) return;
        const l = w.doc.layer;
        const original = l.ctx.getImageData(r.x, r.y, r.w, r.h);
        const step = w.doc.beginStep(title, l, r);
        const rows = sliders.length;
        const tpl = { t: title, w: 220, h: 34 + rows * 26, f: ['MS Shell Dlg', 8], c: [] };
        sliders.forEach(([label, min, max, def], i) => {
            tpl.c.push([100 + i, 'S', 7, 10 + i * 26, 50, 8, 0x50020000, `${label}:`, 0]);
            tpl.c.push([200 + i, 'msctls_trackbar32', 55, 7 + i * 26, 120, 16, 0x50010000, '', 0]);
            tpl.c.push([300 + i, 'E', 180, 8 + i * 26, 32, 12, 0x50812080, String(def), 0]);
        });
        tpl.c.push([1, 'B', 108, 14 + rows * 26, 50, 14, 0x50010001, 'OK', 0]);
        tpl.c.push([2, 'B', 162, 14 + rows * 26, 50, 14, 0x50010000, 'Cancel', 0]);
        let raf = 0;
        const preview = (ctx) => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const vals = sliders.map((s, i) => Number(ctx.get(200 + i)));
                l.ctx.putImageData(original, r.x, r.y);
                C().mapPixels(l.ctx, r, makeFn(vals), w.doc.selection && w.doc.selection.mask, w.doc.width);
                w.doc.markDirty(r);
            });
        };
        root.vistaDialogTemplate.openDialog({
            id: 'mpAdjustDialog',
            tpl,
            owner: w.modal,
            init(ctx) {
                sliders.forEach(([, min, max, def], i) => {
                    ctx.range(200 + i, min, max, def, undefined, 0);
                    ctx.on(200 + i, 'input', () => { ctx.set(300 + i, String(ctx.get(200 + i))); preview(ctx); });
                    ctx.on(300 + i, 'change', () => { ctx.set(200 + i, Number(ctx.get(300 + i)) || def); preview(ctx); });
                });
            },
            ok() {
                cancelAnimationFrame(raf);
                w.doc.commitStep(step);
            },
            cancel() {
                cancelAnimationFrame(raf);
                l.ctx.putImageData(original, r.x, r.y);
                w.doc.markDirty(r);
            }
        });
    }

    function properties(w) {
        const l = w.doc.activeLayer;
        if (!root.vistaDialogTemplate) return;
        const before = { name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked };
        const tpl = { t: 'Layer Properties', w: 210, h: 112, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 9, 40, 8, 0x50020000, '&Name:', 0],
            [101, 'E', 50, 7, 153, 12, 0x50810080, '', 0],
            [102, 'B', 50, 24, 80, 10, 0x50010003, '&Visible', 0],
            [103, 'B', 130, 24, 80, 10, 0x50010003, '&Locked', 0],
            [-1, 'B', 7, 38, 196, 50, 0x50000007, 'Blending', 0],
            [-1, 'S', 14, 52, 36, 8, 0x50020000, '&Mode:', 0],
            [104, 'C', 52, 50, 145, 100, 0x50210003, '', 0],
            [-1, 'S', 14, 70, 36, 8, 0x50020000, '&Opacity:', 0],
            [105, 'msctls_trackbar32', 50, 67, 112, 16, 0x50010000, '', 0],
            [106, 'E', 165, 68, 32, 12, 0x50812080, '', 0],
            [1, 'B', 99, 94, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 153, 94, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        const live = (ctx) => {
            l.visible = ctx.get(102);
            l.blend = ctx.get(104);
            l.opacity = Number(ctx.get(105)) / 255;
            w.doc.markDirty();
        };
        root.vistaDialogTemplate.openDialog({
            id: 'mpLayerProperties',
            tpl,
            owner: w.modal,
            init(ctx) {
                ctx.set(101, l.name);
                ctx.set(102, l.visible);
                ctx.set(103, l.locked);
                ctx.options(104, Object.entries(BLEND_NAMES).map(([value, text]) => ({ value, text })), l.blend);
                ctx.range(105, 0, 255, Math.round(l.opacity * 255), undefined, 0);
                ctx.set(106, String(Math.round(l.opacity * 255)));
                ctx.on(105, 'input', () => { ctx.set(106, String(ctx.get(105))); live(ctx); });
                ctx.on(106, 'change', () => { ctx.set(105, Math.max(0, Math.min(255, Number(ctx.get(106)) || 0))); live(ctx); });
                ctx.on(102, 'change', () => live(ctx));
                ctx.on(104, 'change', () => live(ctx));
            },
            ok(ctx) {
                const after = { name: String(ctx.get(101) || l.name).slice(0, 60), visible: ctx.get(102), opacity: Number(ctx.get(105)) / 255, blend: ctx.get(104), locked: ctx.get(103) };
                Object.assign(l, before);
                structural(w, 'Layer Properties', () => Object.assign(l, after));
            },
            cancel() {
                Object.assign(l, before);
                w.doc.markDirty();
            }
        });
    }

    /** A group's name, visibility, opacity and blend mode (double-click its header). */
    function groupProperties(w, id) {
        const g = w.doc.group(id);
        if (!g || !root.vistaDialogTemplate) return;
        const before = { ...g };
        const tpl = { t: 'Group Properties', w: 210, h: 100, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 9, 40, 8, 0x50020000, '&Name:', 0],
            [101, 'E', 50, 7, 153, 12, 0x50810080, '', 0],
            [102, 'B', 50, 24, 80, 10, 0x50010003, '&Visible', 0],
            [-1, 'S', 7, 42, 40, 8, 0x50020000, '&Mode:', 0],
            [104, 'C', 50, 40, 153, 100, 0x50210003, '', 0],
            [-1, 'S', 7, 61, 40, 8, 0x50020000, '&Opacity:', 0],
            [105, 'msctls_trackbar32', 46, 58, 120, 16, 0x50010000, '', 0],
            [106, 'E', 170, 59, 32, 12, 0x50812080, '', 0],
            [1, 'B', 99, 82, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 153, 82, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        const live = (ctx) => {
            g.visible = ctx.get(102);
            g.blend = ctx.get(104);
            g.opacity = Number(ctx.get(105)) / 255;
            w.doc.markDirty();
        };
        root.vistaDialogTemplate.openDialog({
            id: 'mpGroupProperties',
            tpl,
            owner: w.modal,
            init(ctx) {
                ctx.set(101, g.name);
                ctx.set(102, g.visible);
                ctx.options(104, [{ value: 'pass', text: 'Pass Through' }, ...Object.entries(BLEND_NAMES).map(([value, text]) => ({ value, text }))], g.blend);
                ctx.range(105, 0, 255, Math.round(g.opacity * 255), undefined, 0);
                ctx.set(106, String(Math.round(g.opacity * 255)));
                ctx.on(105, 'input', () => { ctx.set(106, String(ctx.get(105))); live(ctx); });
                ctx.on(106, 'change', () => { ctx.set(105, Math.max(0, Math.min(255, Number(ctx.get(106)) || 0))); live(ctx); });
                ctx.on(102, 'change', () => live(ctx));
                ctx.on(104, 'change', () => live(ctx));
            },
            ok(ctx) {
                const after = { name: String(ctx.get(101) || g.name).slice(0, 60), visible: ctx.get(102), opacity: Number(ctx.get(105)) / 255, blend: ctx.get(104) };
                Object.assign(g, before);
                structural(w, 'Group Properties', () => Object.assign(w.doc.group(id), after));
            },
            cancel() {
                Object.assign(g, before);
                w.doc.markDirty();
            }
        });
    }

    function importLayer(w) {
        if (typeof root.studioOpenFolderDialog !== 'function') return;
        void root.studioOpenFolderDialog('open-vfs', {
            owner: w.modal,
            host: {
                title: 'Import From File',
                rejectMessage: 'Choose a picture',
                acceptItem: (item) => item && item.targetKind === 'user-file' && /^image\//.test(item.mimeType || ''),
                async onOpen(item) {
                    // with the progress dialog: the download, then the picture read
                    const img = await w.downloadPicture(item, 'Importing');
                    if (!img) return;
                    structural(w, 'Import From File', () => {
                        const layer = w.doc.addLayer(item.name.replace(/\.[^.]+$/, ''));
                        layer.ctx.drawImage(img, 0, 0);
                    });
                }
            }
        });
    }

    /** View > Zoom > Show Thumbnail: the whole picture at normal size in a small window. */
    function thumbnail(w) {
        const old = doc.getElementById(`mpThumb_${w.n}`);
        if (old) { old.remove(); return; }
        const t = doc.createElement('div');
        t.id = `mpThumb_${w.n}`;
        t.className = 'mp-thumbnail';
        t.innerHTML = '<div class="mp-thumbnail-cap">Thumbnail</div><canvas></canvas>';
        w.modal.querySelector('.mp-workspace').appendChild(t);
        const c = t.querySelector('canvas');
        const draw = () => {
            if (!t.isConnected) return;
            const s = Math.min(1, 180 / w.doc.width, 140 / w.doc.height);
            c.width = Math.round(w.doc.width * s);
            c.height = Math.round(w.doc.height * s);
            c.getContext('2d').drawImage(w.view, 0, 0, c.width, c.height);
            setTimeout(draw, 500);
        };
        draw();
    }

    root.paintLayers = { toggle, toggleHistory, refresh, thumbs, detach, isOpen, historyOpen, menu, adjustMenu, action, thumbnail, BLEND_NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
