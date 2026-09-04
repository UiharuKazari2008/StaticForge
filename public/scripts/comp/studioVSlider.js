/**
 * Studio vSlider — AI intensity widgets (slider / xypad / star / dropdown).
 * public/scripts/comp/studioChangeJson.js
 * public/scripts/comp/requestBodyReplacementsModal.js
 * public/scripts/comp/dropdown.js
 * public/scripts/comp/modalUtils.js
 * public/scripts/comp/textareaUtils.js
 * Drag is preview only. Finalise writes NovelAI emphasis N::text:: (or dropdown text).
 */

const STUDIO_VSLIDER_MANAGED_PREFIXES = { _P: true, _N: true };
const STUDIO_VSLIDER_STAR_MAX_AXES = 8;
const STUDIO_VSLIDER_EXACT_EPS = 1e-4;
const STUDIO_VSLIDER_OMIT_N = 1.02;

let studioVSliderWidgets = [];
let studioVSliderWired = false;
let studioVSliderHooksWired = false;

function studioVSliderClamp01(n) {
    const value = Number(n);
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function studioVSliderRoundN(n) {
    return Math.round(n * 100) / 100;
}

function studioVSliderSortStops(stops) {
    return (stops || []).slice().sort((a, b) => a.at - b.at);
}

function studioVSliderMedianAt(stops) {
    const sorted = studioVSliderSortStops(stops);
    if (!sorted.length) return 0.5;
    return sorted[Math.floor((sorted.length - 1) / 2)].at;
}

function studioVSliderIsManagedPrefix(prefix) {
    return !!STUDIO_VSLIDER_MANAGED_PREFIXES[String(prefix || '')];
}

function studioVSliderBlendAxis(stops, value) {
    const sorted = studioVSliderSortStops(stops).filter((stop) => stop && stop.text != null && stop.text !== '');
    if (!sorted.length) return '';
    const v = studioVSliderClamp01(value);
    for (let i = 0; i < sorted.length; i++) {
        if (Math.abs(v - sorted[i].at) <= STUDIO_VSLIDER_EXACT_EPS) {
            return String(sorted[i].text);
        }
    }
    if (v <= sorted[0].at) return String(sorted[0].text);
    if (v >= sorted[sorted.length - 1].at) return String(sorted[sorted.length - 1].text);
    let left = sorted[0];
    let right = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
        if (v >= sorted[i].at && v <= sorted[i + 1].at) {
            left = sorted[i];
            right = sorted[i + 1];
            break;
        }
    }
    const span = right.at - left.at;
    const t = span === 0 ? 0 : (v - left.at) / span;
    const nLeft = studioVSliderRoundN(1 + (1 - t) * 0.5);
    const nRight = studioVSliderRoundN(1 + t * 0.5);
    const parts = [];
    if (nLeft > STUDIO_VSLIDER_OMIT_N) parts.push(`${nLeft}::${left.text}::`);
    if (nRight > STUDIO_VSLIDER_OMIT_N) parts.push(`${nRight}::${right.text}::`);
    if (!parts.length) return String(t < 0.5 ? left.text : right.text);
    return parts.join(', ');
}

function studioVSliderNormalizeStops(rawStops) {
    if (!Array.isArray(rawStops)) return [];
    return rawStops.map((stop) => {
        if (!stop || typeof stop !== 'object') return null;
        const text = stop.text != null ? String(stop.text) : '';
        if (!text) return null;
        return { at: studioVSliderClamp01(stop.at), text };
    }).filter(Boolean);
}

function studioVSliderNormalizeTarget(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = raw.kind === 'prompt' ? 'prompt' : 'expander';
    const prefix = String(raw.prefix || raw.name || '').trim();
    if (kind === 'expander' && !prefix) return null;
    if (kind === 'expander' && studioVSliderIsManagedPrefix(prefix)) return null;
    return kind === 'prompt' ? { kind: 'prompt' } : { kind: 'expander', prefix };
}

function studioVSliderNormalizeAxis(raw, fallbackId) {
    if (!raw || typeof raw !== 'object') return null;
    const stops = studioVSliderNormalizeStops(raw.stops);
    if (stops.length < 2) return null;
    const id = String(raw.id || fallbackId || 'axis').trim() || fallbackId;
    const median = studioVSliderMedianAt(stops);
    const defaultValue = raw.default != null ? studioVSliderClamp01(raw.default) : median;
    const target = studioVSliderNormalizeTarget(raw.target);
    return {
        id,
        label: raw.label != null ? String(raw.label) : id,
        target,
        default: defaultValue,
        stops
    };
}

function studioVSliderReadAxisValue(valueMap, axisId, fallback) {
    if (valueMap == null) return fallback;
    if (typeof valueMap === 'number') return studioVSliderClamp01(valueMap);
    if (typeof valueMap === 'object') {
        if (valueMap[axisId] != null) return studioVSliderClamp01(valueMap[axisId]);
        if (axisId === 'x' && valueMap.x != null) return studioVSliderClamp01(valueMap.x);
        if (axisId === 'y' && valueMap.y != null) return studioVSliderClamp01(valueMap.y);
    }
    return fallback;
}

function studioVSliderNormalizeWidget(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = String(raw.kind || '').trim();
    const id = String(raw.id || `widget_${index}`).trim() || `widget_${index}`;
    const title = raw.title != null ? String(raw.title) : id;
    const commit = raw.commit === 'prompt' ? 'prompt' : 'expander';
    const widgetTarget = studioVSliderNormalizeTarget(raw.target);

    if (kind === 'dropdown') {
        const options = Array.isArray(raw.options) ? raw.options.map((opt) => {
            if (!opt || typeof opt !== 'object') return null;
            const optId = String(opt.id || '').trim();
            if (!optId) return null;
            return {
                id: optId,
                label: opt.label != null ? String(opt.label) : optId,
                text: opt.text != null ? String(opt.text) : ''
            };
        }).filter(Boolean) : [];
        if (!options.length) return null;
        const defaultId = raw.default != null ? String(raw.default) : options[0].id;
        const fallback = options.some((opt) => opt.id === defaultId) ? defaultId : options[0].id;
        const value = raw.value != null ? String(raw.value) : fallback;
        const chosen = options.some((opt) => opt.id === value) ? value : fallback;
        return {
            id,
            kind: 'dropdown',
            title,
            commit,
            target: widgetTarget,
            default: fallback,
            value: chosen,
            options,
            dirty: false,
            committedValue: chosen
        };
    }

    const rawAxes = Array.isArray(raw.axes) ? raw.axes : [];
    const axes = rawAxes.map((axis, axisIndex) => studioVSliderNormalizeAxis(axis, `${id}_${axisIndex}`)).filter(Boolean);
    if (kind === 'slider' && axes.length !== 1) return null;
    if (kind === 'xypad' && axes.length !== 2) return null;
    if (kind === 'star' && (axes.length < 2 || axes.length > STUDIO_VSLIDER_STAR_MAX_AXES)) return null;
    if (kind !== 'slider' && kind !== 'xypad' && kind !== 'star') return null;

    const value = {};
    const committedValue = {};
    axes.forEach((axis) => {
        const next = studioVSliderReadAxisValue(raw.value, axis.id, axis.default);
        value[axis.id] = next;
        committedValue[axis.id] = next;
    });
    return {
        id,
        kind,
        title,
        commit,
        target: widgetTarget,
        axes,
        value,
        dirty: false,
        committedValue
    };
}

function normalizeStudioVSliderList(list) {
    if (!Array.isArray(list)) return [];
    return list.map((entry, index) => studioVSliderNormalizeWidget(entry, index)).filter(Boolean);
}

function studioVSliderClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getStudioVSliderSnapshot() {
    if (!studioVSliderWidgets.length) return null;
    return studioVSliderWidgets.map((widget) => {
        const out = {
            id: widget.id,
            kind: widget.kind,
            title: widget.title,
            commit: widget.commit,
            default: widget.default,
            value: studioVSliderClone(widget.value)
        };
        if (widget.target) out.target = studioVSliderClone(widget.target);
        if (widget.options) out.options = studioVSliderClone(widget.options);
        if (widget.axes) {
            out.axes = widget.axes.map((axis) => ({
                id: axis.id,
                label: axis.label,
                default: axis.default,
                stops: studioVSliderClone(axis.stops),
                target: axis.target ? studioVSliderClone(axis.target) : undefined
            }));
        }
        return out;
    });
}

function studioVSliderDropdownText(widget) {
    const opt = (widget.options || []).find((entry) => entry.id === widget.value);
    return opt ? opt.text : '';
}

function studioVSliderResolvedTexts(widget, live) {
    const source = live ? widget.value : widget.committedValue;
    if (widget.kind === 'dropdown') {
        const opt = (widget.options || []).find((entry) => entry.id === source);
        return [{
            commit: widget.commit,
            target: widget.target,
            text: opt ? opt.text : '',
            key: widget.id
        }];
    }
    return (widget.axes || []).map((axis) => ({
        commit: widget.commit,
        target: axis.target || widget.target,
        text: studioVSliderBlendAxis(axis.stops, source[axis.id]),
        key: `${widget.id}:${axis.id}`
    }));
}

function studioVSliderPreviewLabel(widget) {
    return studioVSliderResolvedTexts(widget, true).map((entry) => entry.text).filter(Boolean).join(' · ');
}

function studioVSliderWriteExpander(prefix, text) {
    if (!prefix || studioVSliderIsManagedPrefix(prefix)) return;
    // requestBodyReplacements / renderRequestBodyReplacementsList: public/scripts/comp/requestBodyReplacementsModal.js
    const existing = requestBodyReplacements.find((entry) => entry && entry.name === prefix);
    if (existing) {
        existing.value = text;
    } else {
        requestBodyReplacements.push({ name: prefix, value: text, extend: false });
    }
    renderRequestBodyReplacementsList();
}

function studioVSliderReplacePromptSpan(previous, next) {
    // getStudioFieldValue / writeStudioFieldValue: public/scripts/comp/studioChangeJson.js
    let prompt = getStudioFieldValue('prompt') || '';
    if (previous && prompt.indexOf(previous) !== -1) {
        prompt = prompt.replace(previous, next);
    } else if (next) {
        prompt = prompt.trim() ? `${prompt.trim()}, ${next}` : next;
    }
    writeStudioFieldValue('prompt', prompt);
}

class StudioVSliderForge {
    previewImage() {
        return window.currentManualPreviewImage;
    }

    lastImage() {
        return window.lastGeneration;
    }

    stamp(list) {
        const payload = list && list.length ? studioVSliderClone(list) : null;
        const preview = this.previewImage();
        if (preview) {
            if (!preview.metadata) preview.metadata = {};
            if (!preview.metadata.forge_data) preview.metadata.forge_data = {};
            if (payload) preview.metadata.forge_data.vSlider = payload;
            else delete preview.metadata.forge_data.vSlider;
        }
        const last = this.lastImage();
        if (last) {
            if (!last.forge_data) last.forge_data = {};
            if (payload) last.forge_data.vSlider = payload;
            else delete last.forge_data.vSlider;
        }
    }
}

const studioVSliderForge = new StudioVSliderForge();

function studioVSliderStampForgeData(list) {
    studioVSliderForge.stamp(list);
}

function studioVSliderWriteRequestBody(requestBody) {
    const snapshot = getStudioVSliderSnapshot();
    if (snapshot && snapshot.length) requestBody.vSlider = snapshot;
    else delete requestBody.vSlider;
}

function studioVSliderCommitWidget(widget) {
    const liveRows = studioVSliderResolvedTexts(widget, true);
    const committedRows = studioVSliderResolvedTexts(widget, false);
    liveRows.forEach((row, index) => {
        const prev = committedRows[index] ? committedRows[index].text : '';
        if (!row.target) return;
        if (row.commit === 'prompt' || row.target.kind === 'prompt') {
            studioVSliderReplacePromptSpan(prev, row.text);
            return;
        }
        if (row.target.kind === 'expander') {
            studioVSliderWriteExpander(row.target.prefix, row.text);
        }
    });
    widget.committedValue = studioVSliderClone(widget.value);
    widget.dirty = false;
}

function studioVSliderFinaliseAll() {
    const dirty = studioVSliderWidgets.filter((widget) => widget.dirty);
    if (!dirty.length) {
        showGlassToast('info', 'vSlider', 'Nothing to finalise', false, 2000, '<i class="fas fa-info-circle"></i>');
        return;
    }
    dirty.forEach((widget) => studioVSliderCommitWidget(widget));
    studioVSliderStampForgeData(getStudioVSliderSnapshot());
    studioVSliderSyncFooter();
    studioVSliderRefreshPreviews();
    showGlassToast('success', 'vSlider', `Finalised ${dirty.length} widget${dirty.length === 1 ? '' : 's'}`, false, 2000, '<i class="fas fa-check"></i>');
}

function studioVSliderRevertAll() {
    studioVSliderWidgets.forEach((widget) => {
        widget.value = studioVSliderClone(widget.committedValue);
        widget.dirty = false;
    });
    studioVSliderRenderCards();
}

function studioVSliderMarkDirty(widgetId, mutator) {
    const widget = studioVSliderWidgets.find((entry) => entry.id === widgetId);
    if (!widget) return;
    mutator(widget);
    widget.dirty = true;
    studioVSliderSyncFooter();
    studioVSliderRefreshPreviews();
}

function studioVSliderEscape(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function studioVSliderRenderSlider(widget, axis) {
    const value = widget.value[axis.id];
    return `
        <div class="form-group">
            <label>${studioVSliderEscape(axis.label)}</label>
            <div class="slider-container">
                <input type="range" class="glass-slider" min="0" max="1" step="0.01"
                    value="${value}" data-vslider-axis="${studioVSliderEscape(axis.id)}"
                    data-vslider-id="${studioVSliderEscape(widget.id)}">
                <span class="slider-value">${studioVSliderEscape(studioVSliderBlendAxis(axis.stops, value))}</span>
            </div>
        </div>
    `;
}

function studioVSliderRenderDropdown(widget) {
    const current = (widget.options || []).find((opt) => opt.id === widget.value);
    const label = current ? current.label : widget.value;
    const options = (widget.options || []).map((opt) => `
        <div class="custom-dropdown-option${opt.id === widget.value ? ' selected' : ''}"
            data-vslider-option="${studioVSliderEscape(opt.id)}">${studioVSliderEscape(opt.label)}</div>
    `).join('');
    return `
        <div class="form-group">
            <label>${studioVSliderEscape(widget.title)}</label>
            <div class="custom-dropdown dark" data-vslider-dropdown="${studioVSliderEscape(widget.id)}">
                <button type="button" class="custom-dropdown-btn hover-show colored">${studioVSliderEscape(label)}</button>
                <div class="custom-dropdown-menu hidden">${options}</div>
            </div>
        </div>
    `;
}

function studioVSliderRenderXyPad(widget) {
    const xAxis = widget.axes[0];
    const yAxis = widget.axes[1];
    const x = widget.value[xAxis.id];
    const y = widget.value[yAxis.id];
    return `
        <div class="form-group">
            <label>${studioVSliderEscape(xAxis.label)} / ${studioVSliderEscape(yAxis.label)}</label>
            <div class="token-progress-bar" data-vslider-xypad="${studioVSliderEscape(widget.id)}"
                style="position:relative;height:180px;cursor:pointer;">
                <button type="button" class="round-button btn-secondary" data-vslider-knob
                    style="position:absolute;left:${x * 100}%;top:${(1 - y) * 100}%;transform:translate(-50%,-50%);width:22px;height:22px;padding:0;pointer-events:none;"></button>
            </div>
        </div>
        ${studioVSliderRenderSlider(widget, xAxis)}
        ${studioVSliderRenderSlider(widget, yAxis)}
    `;
}

function studioVSliderStarPoint(index, count, radius, value) {
    const angle = (-Math.PI / 2) + (index * 2 * Math.PI / count);
    const r = 16 + (radius - 16) * studioVSliderClamp01(value);
    return {
        x: 90 + Math.cos(angle) * r,
        y: 90 + Math.sin(angle) * r,
        ax: 90 + Math.cos(angle) * radius,
        ay: 90 + Math.sin(angle) * radius
    };
}

function studioVSliderRenderStar(widget) {
    const axes = widget.axes;
    const spokes = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, 74, widget.value[axis.id]);
        return `<line x1="90" y1="90" x2="${pt.ax}" y2="${pt.ay}" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"></line>`;
    }).join('');
    const dots = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, 74, widget.value[axis.id]);
        return `<circle cx="${pt.x}" cy="${pt.y}" r="5" fill="currentColor" data-vslider-star-axis="${studioVSliderEscape(axis.id)}"></circle>`;
    }).join('');
    const poly = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, 74, widget.value[axis.id]);
        return `${pt.x},${pt.y}`;
    }).join(' ');
    const sliders = axes.map((axis) => studioVSliderRenderSlider(widget, axis)).join('');
    return `
        <div class="form-group">
            <label>${studioVSliderEscape(widget.title)}</label>
            <svg class="icon-fa" data-vslider-star="${studioVSliderEscape(widget.id)}"
                viewBox="0 0 180 180" width="180" height="180" style="display:block;margin:0 auto;">
                ${spokes}
                <polygon points="${poly}" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="1.5"></polygon>
                ${dots}
            </svg>
        </div>
        ${sliders}
    `;
}

function studioVSliderRenderCard(widget) {
    let body = '';
    if (widget.kind === 'dropdown') body = studioVSliderRenderDropdown(widget);
    else if (widget.kind === 'xypad') body = studioVSliderRenderXyPad(widget);
    else if (widget.kind === 'star') body = studioVSliderRenderStar(widget);
    else body = widget.axes.map((axis) => studioVSliderRenderSlider(widget, axis)).join('');
    return `
        <div class="form-section" data-vslider-card="${studioVSliderEscape(widget.id)}">
            <div class="form-row">
                <div class="form-group">
                    <label>${studioVSliderEscape(widget.title)}${widget.dirty ? ' · dirty' : ''}</label>
                    <span class="slider-value" data-vslider-preview>${studioVSliderEscape(studioVSliderPreviewLabel(widget))}</span>
                </div>
            </div>
            ${body}
        </div>
    `;
}

function studioVSliderRefreshPreviews() {
    studioVSliderWidgets.forEach((widget) => {
        const card = document.querySelector(`[data-vslider-card="${widget.id}"]`);
        if (!card) return;
        const preview = card.querySelector('[data-vslider-preview]');
        if (preview) preview.textContent = studioVSliderPreviewLabel(widget);
        const label = card.querySelector('.form-row .form-group label');
        if (label) label.textContent = `${widget.title}${widget.dirty ? ' · dirty' : ''}`;
        card.querySelectorAll('.glass-slider[data-vslider-axis]').forEach((slider) => {
            const axisId = slider.getAttribute('data-vslider-axis');
            const axis = (widget.axes || []).find((entry) => entry.id === axisId);
            if (!axis) return;
            slider.value = String(widget.value[axisId]);
            const valueEl = slider.parentElement && slider.parentElement.querySelector('.slider-value');
            if (valueEl) valueEl.textContent = studioVSliderBlendAxis(axis.stops, widget.value[axisId]);
        });
        const knob = card.querySelector('[data-vslider-knob]');
        if (knob && widget.axes && widget.axes.length === 2) {
            const x = widget.value[widget.axes[0].id];
            const y = widget.value[widget.axes[1].id];
            knob.style.left = `${x * 100}%`;
            knob.style.top = `${(1 - y) * 100}%`;
        }
        const star = card.querySelector('[data-vslider-star]');
        if (star && widget.kind === 'star') {
            const axes = widget.axes;
            const pts = axes.map((axis, index) => studioVSliderStarPoint(index, axes.length, 74, widget.value[axis.id]));
            const poly = star.querySelector('polygon');
            if (poly) poly.setAttribute('points', pts.map((pt) => `${pt.x},${pt.y}`).join(' '));
            star.querySelectorAll('[data-vslider-star-axis]').forEach((dot) => {
                const axisId = dot.getAttribute('data-vslider-star-axis');
                const index = axes.findIndex((axis) => axis.id === axisId);
                if (index < 0) return;
                dot.setAttribute('cx', String(pts[index].x));
                dot.setAttribute('cy', String(pts[index].y));
            });
        }
    });
}

function studioVSliderWireDropdown(widget, card) {
    const container = card.querySelector(`[data-vslider-dropdown="${widget.id}"]`);
    if (!container) return;
    const button = container.querySelector('.custom-dropdown-btn');
    const menu = container.querySelector('.custom-dropdown-menu');
    // setupDropdown: public/scripts/comp/dropdown.js
    setupDropdown(container, button, menu, () => {}, () => widget.value, { preventFocusTransfer: true });
    menu.querySelectorAll('[data-vslider-option]').forEach((option) => {
        option.addEventListener('click', () => {
            const next = option.getAttribute('data-vslider-option');
            studioVSliderMarkDirty(widget.id, (entry) => {
                entry.value = next;
            });
            button.textContent = option.textContent;
            menu.querySelectorAll('.custom-dropdown-option').forEach((node) => {
                node.classList.toggle('selected', node === option);
            });
            // closeDropdown: public/scripts/comp/dropdown.js
            closeDropdown(menu, button);
        });
    });
}

function studioVSliderBindPad(pad, widget, fromClient) {
    const rect = pad.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = studioVSliderClamp01((fromClient.clientX - rect.left) / rect.width);
    const y = studioVSliderClamp01(1 - ((fromClient.clientY - rect.top) / rect.height));
    studioVSliderMarkDirty(widget.id, (entry) => {
        entry.value[entry.axes[0].id] = x;
        entry.value[entry.axes[1].id] = y;
    });
}

function studioVSliderBindStar(svg, widget, fromClient) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = fromClient.clientX - cx;
    const dy = fromClient.clientY - cy;
    const angle = Math.atan2(dy, dx);
    const count = widget.axes.length;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < count; i++) {
        const spoke = (-Math.PI / 2) + (i * 2 * Math.PI / count);
        let delta = angle - spoke;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const dist = Math.abs(delta);
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    const radius = Math.min(rect.width, rect.height) / 2 - 8;
    const mag = Math.sqrt(dx * dx + dy * dy);
    const value = studioVSliderClamp01((mag - 16) / Math.max(1, radius - 16));
    const axis = widget.axes[best];
    studioVSliderMarkDirty(widget.id, (entry) => {
        entry.value[axis.id] = value;
    });
}

function studioVSliderWireCard(widget, card) {
    card.querySelectorAll('.glass-slider[data-vslider-axis]').forEach((slider) => {
        slider.addEventListener('input', () => {
            const axisId = slider.getAttribute('data-vslider-axis');
            studioVSliderMarkDirty(widget.id, (entry) => {
                entry.value[axisId] = studioVSliderClamp01(slider.value);
            });
        });
    });
    if (widget.kind === 'dropdown') studioVSliderWireDropdown(widget, card);
    const pad = card.querySelector('[data-vslider-xypad]');
    if (pad) {
        const drag = (event) => studioVSliderBindPad(pad, widget, event);
        pad.addEventListener('pointerdown', (event) => {
            pad.setPointerCapture(event.pointerId);
            drag(event);
        });
        pad.addEventListener('pointermove', (event) => {
            if (event.buttons) drag(event);
        });
    }
    const star = card.querySelector('[data-vslider-star]');
    if (star) {
        const drag = (event) => studioVSliderBindStar(star, widget, event);
        star.addEventListener('pointerdown', (event) => {
            star.setPointerCapture(event.pointerId);
            drag(event);
        });
        star.addEventListener('pointermove', (event) => {
            if (event.buttons) drag(event);
        });
    }
}

function studioVSliderSyncFooter() {
    const dirty = studioVSliderWidgets.some((widget) => widget.dirty);
    const finaliseBtn = document.getElementById('studioVSliderFinaliseBtn');
    const revertBtn = document.getElementById('studioVSliderRevertBtn');
    if (finaliseBtn) finaliseBtn.disabled = !dirty;
    if (revertBtn) revertBtn.disabled = !dirty;
}

function studioVSliderRenderCards() {
    const list = document.getElementById('studioVSliderList');
    if (!list) return;
    if (!studioVSliderWidgets.length) {
        list.innerHTML = '<div class="form-group"><label>No vSlider widgets</label></div>';
        studioVSliderSyncFooter();
        return;
    }
    list.innerHTML = studioVSliderWidgets.map(studioVSliderRenderCard).join('');
    studioVSliderWidgets.forEach((widget) => {
        const card = list.querySelector(`[data-vslider-card="${widget.id}"]`);
        if (card) studioVSliderWireCard(widget, card);
    });
    studioVSliderSyncFooter();
}

function studioVSliderOpenWindow() {
    const el = document.getElementById('studioVSliderTool');
    if (!el) return;
    // openModal: public/scripts/comp/modalUtils.js
    openModal(el);
    studioVSliderRenderCards();
}

function installStudioVSliderWidgets(list, options) {
    const opts = options || {};
    studioVSliderWidgets = normalizeStudioVSliderList(list);
    studioVSliderStampForgeData(getStudioVSliderSnapshot());
    if (!studioVSliderWidgets.length) {
        const el = document.getElementById('studioVSliderTool');
        if (el && !el.classList.contains('hidden')) {
            // closeModal: public/scripts/comp/modalUtils.js
            closeModal(el);
        }
        return studioVSliderWidgets;
    }
    if (opts.open !== false) studioVSliderOpenWindow();
    else studioVSliderRenderCards();
    return studioVSliderWidgets;
}

function studioVSliderReadFromImage(image) {
    if (!image) return null;
    const meta = image.metadata || image;
    const forge = (meta && meta.forge_data) || image.forge_data;
    if (forge && Array.isArray(forge.vSlider)) return forge.vSlider;
    if (meta && Array.isArray(meta.vSlider)) return meta.vSlider;
    return null;
}

function studioVSliderMaybeRestoreFromImage(image) {
    const list = studioVSliderReadFromImage(image);
    if (!list) return;
    installStudioVSliderWidgets(list, { open: true });
}

function studioVSliderWireHooks() {
    if (studioVSliderHooksWired) return;
    studioVSliderHooksWired = true;
    const prevShared = addSharedFieldsToRequestBody;
    addSharedFieldsToRequestBody = function (requestBody, values) {
        prevShared(requestBody, values);
        studioVSliderWriteRequestBody(requestBody);
    };
    const prevOpen = openManualModalWithContent;
    openManualModalWithContent = async function (content, event) {
        const result = await prevOpen(content, event);
        const image = content && content.image ? content.image : studioVSliderForge.previewImage();
        studioVSliderMaybeRestoreFromImage(image);
        return result;
    };
}

function studioVSliderInit() {
    if (studioVSliderWired) return;
    const el = document.getElementById('studioVSliderTool');
    if (!el) return;
    studioVSliderWired = true;
    // transientWindowsWithPositions / linkToolWindowToParent / addResizeHandles: public/scripts/comp/modalUtils.js
    transientWindowsWithPositions.add('studio-vslider-tool');
    linkToolWindowToParent(el, document.getElementById('manualModal'));
    if (!el.querySelector('.resize-handle')) addResizeHandles(el);
    const closeBtn = document.getElementById('studioVSliderCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeModal(el);
        });
    }
    const finaliseBtn = document.getElementById('studioVSliderFinaliseBtn');
    if (finaliseBtn) finaliseBtn.addEventListener('click', studioVSliderFinaliseAll);
    const revertBtn = document.getElementById('studioVSliderRevertBtn');
    if (revertBtn) revertBtn.addEventListener('click', studioVSliderRevertAll);
    studioVSliderWireHooks();
    studioVSliderSyncFooter();
}

document.addEventListener('DOMContentLoaded', studioVSliderInit);
if (document.readyState !== 'loading') studioVSliderInit();
