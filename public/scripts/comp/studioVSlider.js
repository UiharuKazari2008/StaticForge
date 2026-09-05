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
    const total = rawStops.length;
    return rawStops.map((stop, index) => {
        if (typeof stop === 'string') {
            const text = stop.trim();
            if (!text) return null;
            const at = total > 1 ? index / (total - 1) : 0.5;
            return { at: studioVSliderClamp01(at), text };
        }
        if (!stop || typeof stop !== 'object') return null;
        const text = stop.text != null ? String(stop.text) : (stop.label != null ? String(stop.label) : (stop.tag != null ? String(stop.tag) : ''));
        if (!text) return null;
        let at = stop.at;
        if (at == null && stop.value != null) at = stop.value;
        if (at == null && stop.position != null) at = stop.position;
        if (at == null) at = total > 1 ? index / (total - 1) : 0.5;
        return { at: studioVSliderClamp01(at), text };
    }).filter(Boolean);
}

function studioVSliderNormalizeTarget(raw) {
    if (typeof raw === 'string') {
        const prefix = raw.trim();
        if (!prefix) return null;
        if (prefix === 'prompt') return { kind: 'prompt' };
        if (studioVSliderIsManagedPrefix(prefix)) return null;
        return { kind: 'expander', prefix };
    }
    if (!raw || typeof raw !== 'object') return null;
    const kind = raw.kind === 'prompt' ? 'prompt' : 'expander';
    const prefix = String(raw.prefix || raw.name || raw.expander || '').trim();
    if (kind === 'expander' && !prefix) return null;
    if (kind === 'expander' && studioVSliderIsManagedPrefix(prefix)) return null;
    return kind === 'prompt' ? { kind: 'prompt' } : { kind: 'expander', prefix };
}

function studioVSliderCoerceAxesList(raw, widgetId) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];
    return Object.keys(raw).map((key) => {
        const entry = raw[key];
        if (!entry || typeof entry !== 'object') return null;
        return { id: key, ...entry };
    }).filter(Boolean);
}

function studioVSliderInferKind(rawKind, axisCount) {
    const kind = String(rawKind || '').trim().toLowerCase();
    if (kind === 'slider' || kind === 'xypad' || kind === 'star' || kind === 'dropdown') return kind;
    if (axisCount === 1) return 'slider';
    if (axisCount === 2) return 'xypad';
    if (axisCount > 2) return 'star';
    return kind || 'slider';
}

function studioVSliderNormalizeAxis(raw, fallbackId, widgetTarget) {
    if (!raw || typeof raw !== 'object') return null;
    const stops = studioVSliderNormalizeStops(
        raw.stops || raw.catalog || raw.points || raw.labels || raw.tags
    );
    if (stops.length < 2) return null;
    const id = String(raw.id || raw.name || fallbackId || 'axis').trim() || fallbackId;
    const median = studioVSliderMedianAt(stops);
    const defaultValue = raw.default != null ? studioVSliderClamp01(raw.default) : median;
    const target = studioVSliderNormalizeTarget(raw.target) || widgetTarget || null;
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
    const id = String(raw.id || raw.name || `widget_${index}`).trim() || `widget_${index}`;
    const title = raw.title != null ? String(raw.title) : id;
    const commit = raw.commit === 'prompt' ? 'prompt' : 'expander';
    const widgetTarget = studioVSliderNormalizeTarget(raw.target || raw.expander || raw.prefix);
    const rawKind = raw.kind || raw.type;
    const axisList = studioVSliderCoerceAxesList(raw.axes, id);
    let kind = String(rawKind || '').trim().toLowerCase();
    if (!kind && Array.isArray(raw.options) && raw.options.length) kind = 'dropdown';
    if (!kind) kind = studioVSliderInferKind('', axisList.length);

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

    const rawAxes = axisList;
    const axes = rawAxes.map((axis, axisIndex) => studioVSliderNormalizeAxis(axis, `${id}_${axisIndex}`, widgetTarget)).filter(Boolean);
    if (kind === 'slider' && axes.length !== 1) return null;
    if (kind === 'xypad' && axes.length !== 2) return null;
    if (kind === 'star' && (axes.length < 2 || axes.length > STUDIO_VSLIDER_STAR_MAX_AXES)) return null;
    if (kind !== 'slider' && kind !== 'xypad' && kind !== 'star') return null;

    const value = {};
    const committedValue = {};
    const rawValue = raw.value;
    axes.forEach((axis) => {
        let next;
        if (typeof rawValue === 'number' && axes.length === 1) {
            next = studioVSliderClamp01(rawValue);
        } else {
            next = studioVSliderReadAxisValue(rawValue, axis.id, axis.default);
        }
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

function studioVSliderCoerceRawList(list) {
    if (!Array.isArray(list)) return [];
    return list.map((entry, index) => {
        if (!entry || typeof entry !== 'object') return entry;
        const next = { ...entry };
        if (!next.kind && !next.type) {
            const axisCount = studioVSliderCoerceAxesList(next.axes, next.id || `widget_${index}`).length;
            next.kind = studioVSliderInferKind('', axisCount);
        }
        if (!next.target && (next.prefix || next.expander)) {
            next.target = { kind: 'expander', prefix: String(next.prefix || next.expander).trim() };
        }
        if (Array.isArray(next.axes)) {
            next.axes = next.axes.map((axis) => {
                if (!axis || typeof axis !== 'object') return axis;
                const axisNext = { ...axis };
                if (!axisNext.stops && axisNext.catalog) axisNext.stops = axisNext.catalog;
                if (!axisNext.target && next.target) axisNext.target = next.target;
                return axisNext;
            });
        }
        return next;
    });
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

/** Human stop readout for chrome (not the N:: blend string). */
function studioVSliderAxisNeighbors(stops, value) {
    const sorted = studioVSliderSortStops(stops).filter((stop) => stop && stop.text != null && stop.text !== '');
    if (!sorted.length) {
        return { mode: 'empty', left: null, right: null, nearer: null, isMedian: false, blendText: '' };
    }
    const v = studioVSliderClamp01(value);
    const median = studioVSliderMedianAt(sorted);
    const isMedian = Math.abs(v - median) <= STUDIO_VSLIDER_EXACT_EPS;
    for (let i = 0; i < sorted.length; i++) {
        if (Math.abs(v - sorted[i].at) <= STUDIO_VSLIDER_EXACT_EPS) {
            return {
                mode: 'exact',
                left: sorted[i],
                right: sorted[i],
                nearer: sorted[i],
                isMedian,
                blendText: String(sorted[i].text)
            };
        }
    }
    if (v <= sorted[0].at) {
        return {
            mode: 'exact',
            left: sorted[0],
            right: sorted[0],
            nearer: sorted[0],
            isMedian,
            blendText: String(sorted[0].text)
        };
    }
    if (v >= sorted[sorted.length - 1].at) {
        const last = sorted[sorted.length - 1];
        return {
            mode: 'exact',
            left: last,
            right: last,
            nearer: last,
            isMedian,
            blendText: String(last.text)
        };
    }
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
    const nearer = t < 0.5 ? left : right;
    return {
        mode: 'between',
        left,
        right,
        nearer,
        isMedian: false,
        blendText: studioVSliderBlendAxis(sorted, v)
    };
}

function studioVSliderAxisStatusHtml(axis, value) {
    const state = studioVSliderAxisNeighbors(axis.stops, value);
    if (state.mode === 'empty') {
        return `<div class="vslider-axis-label" data-vslider-status="${studioVSliderEscape(axis.id)}">—</div>`;
    }
    if (state.mode === 'between') {
        const leftClass = state.nearer === state.left ? ' class="vslider-stop"' : '';
        const rightClass = state.nearer === state.right ? ' class="vslider-stop"' : '';
        return `<div class="vslider-axis-label" data-vslider-status="${studioVSliderEscape(axis.id)}"><strong>between</strong> <span${leftClass}>${studioVSliderEscape(state.left.text)}</span> → <span${rightClass}>${studioVSliderEscape(state.right.text)}</span></div>`;
    }
    const lead = state.isMedian ? '<strong>at median</strong>' : '<strong>at</strong>';
    return `<div class="vslider-axis-label" data-vslider-status="${studioVSliderEscape(axis.id)}">${lead} → <span class="vslider-stop">${studioVSliderEscape(state.nearer.text)}</span></div>`;
}

function studioVSliderAxisBlendHtml(axis, value) {
    const state = studioVSliderAxisNeighbors(axis.stops, value);
    if (state.mode !== 'between' || !state.blendText || state.blendText.indexOf('::') === -1) {
        return `<div class="vslider-blend hidden" data-vslider-blend="${studioVSliderEscape(axis.id)}"></div>`;
    }
    return `<div class="vslider-blend" data-vslider-blend="${studioVSliderEscape(axis.id)}">writes <code>${studioVSliderEscape(state.blendText)}</code></div>`;
}

function studioVSliderWidgetBlending(widget) {
    if (widget.kind === 'dropdown') return false;
    return (widget.axes || []).some((axis) => {
        const state = studioVSliderAxisNeighbors(axis.stops, widget.value[axis.id]);
        return state.mode === 'between' && state.blendText.indexOf('::') !== -1;
    });
}

function studioVSliderKindBadge(widget) {
    if (widget.kind === 'dropdown') return 'dropdown';
    if (widget.kind === 'xypad') return 'xypad';
    if (widget.kind === 'star') return `star · ${widget.axes.length} axes`;
    if (studioVSliderWidgetBlending(widget)) return 'slider · blend';
    return 'slider';
}

function studioVSliderStopTicksHtml(stops, value) {
    const sorted = studioVSliderSortStops(stops);
    const ticks = sorted.map((stop, index) => {
        const half = index === 0 || index === sorted.length - 1 ? ' half-height' : '';
        const active = Math.abs(studioVSliderClamp01(value) - stop.at) <= STUDIO_VSLIDER_EXACT_EPS
            ? ' style="background-color: var(--primary-color);"'
            : '';
        return `<div class="slider-tick${half}" style="--tick-frac: ${stop.at};"${active}></div>`;
    }).join('');
    return `<div class="slider-ticks">${ticks}</div>`;
}

function studioVSliderStopLabelsHtml(stops) {
    const sorted = studioVSliderSortStops(stops);
    const labels = sorted.map((stop) => `<span>${studioVSliderEscape(stop.text)}</span>`).join('');
    return `<div class="vslider-stop-labels">${labels}</div>`;
}

function studioVSliderEndStopText(stops, which) {
    const sorted = studioVSliderSortStops(stops);
    if (!sorted.length) return '';
    if (which === 'first') return String(sorted[0].text);
    return String(sorted[sorted.length - 1].text);
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
    const pct = Math.round(studioVSliderClamp01(value) * 100);
    return `
        <div class="vslider-slider-row" data-vslider-axis-row="${studioVSliderEscape(axis.id)}">
            ${studioVSliderAxisStatusHtml(axis, value)}
            <div class="slider-container emphasis-groups-card-value-host">
                <div class="slider-ticks-container">
                    <input type="range" class="glass-slider" min="0" max="100" step="1"
                        value="${pct}" data-vslider-axis="${studioVSliderEscape(axis.id)}"
                        data-vslider-id="${studioVSliderEscape(widget.id)}">
                    ${studioVSliderStopTicksHtml(axis.stops, value)}
                </div>
            </div>
            ${studioVSliderStopLabelsHtml(axis.stops)}
            ${studioVSliderAxisBlendHtml(axis, value)}
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
        <div class="custom-dropdown dark" data-vslider-dropdown="${studioVSliderEscape(widget.id)}">
            <button type="button" class="custom-dropdown-btn hover-show colored">
                <span data-vslider-dropdown-label>${studioVSliderEscape(label)}</span>
            </button>
            <div class="custom-dropdown-menu hidden">${options}</div>
        </div>
    `;
}

function studioVSliderRenderXyPad(widget) {
    const xAxis = widget.axes[0];
    const yAxis = widget.axes[1];
    const x = studioVSliderClamp01(widget.value[xAxis.id]);
    const y = studioVSliderClamp01(widget.value[yAxis.id]);
    const xState = studioVSliderAxisNeighbors(xAxis.stops, x);
    const yState = studioVSliderAxisNeighbors(yAxis.stops, y);
    return `
        <div class="vslider-pad-wrap">
            <div class="vslider-pad-ylabel">
                <span>${studioVSliderEscape(studioVSliderEndStopText(yAxis.stops, 'last'))}</span>
                <span class="axis-name">${studioVSliderEscape(yAxis.label)}</span>
                <span>${studioVSliderEscape(studioVSliderEndStopText(yAxis.stops, 'first'))}</span>
            </div>
            <div class="vslider-stage" data-vslider-xypad="${studioVSliderEscape(widget.id)}">
                <div class="vslider-grid"></div>
                <div class="vslider-cross"></div>
                <div class="vslider-cross v"></div>
                <div class="vslider-median-dot" title="median default"></div>
                <button type="button" class="character-position-pin" data-vslider-knob
                    style="left:${x * 100}%;top:${(1 - y) * 100}%;">
                    <i class="fas fa-plus" style="font-size: 0.7rem;"></i>
                </button>
            </div>
            <div class="vslider-pad-read">
                <div><b>${studioVSliderEscape(yAxis.label)}</b><span class="vslider-stop" data-vslider-pad-y>${studioVSliderEscape(yState.nearer ? yState.nearer.text : '')}</span></div>
                <div><b>${studioVSliderEscape(xAxis.label)}</b><span class="vslider-stop" data-vslider-pad-x>${studioVSliderEscape(xState.nearer ? xState.nearer.text : '')}</span></div>
                <div style="color: var(--text-muted); font-size: 0.68rem;">grey dot = median</div>
            </div>
            <div class="vslider-pad-xlabel">
                <span>${studioVSliderEscape(studioVSliderEndStopText(xAxis.stops, 'first'))}</span>
                <span class="axis-name">${studioVSliderEscape(xAxis.label)}</span>
                <span>${studioVSliderEscape(studioVSliderEndStopText(xAxis.stops, 'last'))}</span>
            </div>
        </div>
    `;
}

function studioVSliderStarPoint(index, count, radius, value) {
    const angle = (-Math.PI / 2) + (index * 2 * Math.PI / count);
    const r = 40 + (radius - 40) * studioVSliderClamp01(value);
    return {
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        ax: Math.cos(angle) * radius,
        ay: Math.sin(angle) * radius,
        lx: Math.cos(angle) * (radius + 28),
        ly: Math.sin(angle) * (radius + 28),
        angle
    };
}

function studioVSliderRenderStar(widget) {
    const axes = widget.axes;
    const radius = 120;
    const spokes = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, radius, widget.value[axis.id]);
        return `<line x1="0" y1="0" x2="${pt.ax}" y2="${pt.ay}" stroke="rgba(255,255,255,0.16)" stroke-width="1.5"></line>`;
    }).join('');
    const medianRing = `<circle r="${40 + (radius - 40) * 0.5}" fill="none" stroke="rgba(255,69,0,0.35)" stroke-dasharray="3 5"></circle>`;
    const outer = `<circle r="${radius}" fill="none" stroke="rgba(255,255,255,0.08)"></circle>`;
    const polyPts = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, radius, widget.value[axis.id]);
        return `${pt.x},${pt.y}`;
    }).join(' ');
    const dots = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, radius, widget.value[axis.id]);
        const state = studioVSliderAxisNeighbors(axis.stops, widget.value[axis.id]);
        const fill = state.isMedian ? '#fff' : '#ff4500';
        return `<circle cx="${pt.x}" cy="${pt.y}" r="8" fill="${fill}" stroke="#ff4500" stroke-width="2" data-vslider-star-axis="${studioVSliderEscape(axis.id)}"></circle>`;
    }).join('');
    const labels = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, radius, 1);
        const state = studioVSliderAxisNeighbors(axis.stops, widget.value[axis.id]);
        const anchor = Math.abs(pt.lx) < 12 ? 'middle' : (pt.lx > 0 ? 'start' : 'end');
        const stopColor = state.isMedian ? '#ccc' : '#ff4500';
        return `
            <text x="${pt.lx}" y="${pt.ly - 6}" text-anchor="${anchor}" fill="#fff" font-size="13" font-weight="600">${studioVSliderEscape(axis.label)}</text>
            <text x="${pt.lx}" y="${pt.ly + 10}" text-anchor="${anchor}" fill="${stopColor}" font-size="11" data-vslider-star-label="${studioVSliderEscape(axis.id)}">${studioVSliderEscape(state.nearer ? state.nearer.text : '')}</text>
        `;
    }).join('');
    return `
        <div class="vslider-star-stage">
            <svg data-vslider-star="${studioVSliderEscape(widget.id)}" viewBox="-200 -200 400 400" xmlns="http://www.w3.org/2000/svg">
                ${outer}
                ${medianRing}
                ${spokes}
                <polygon points="${polyPts}" fill="rgba(255,69,0,0.18)" stroke="#ff4500" stroke-width="2" data-vslider-star-poly></polygon>
                ${dots}
                ${labels}
            </svg>
        </div>
    `;
}

function studioVSliderRenderCard(widget) {
    let body = '';
    if (widget.kind === 'dropdown') body = studioVSliderRenderDropdown(widget);
    else if (widget.kind === 'xypad') body = studioVSliderRenderXyPad(widget);
    else if (widget.kind === 'star') body = studioVSliderRenderStar(widget);
    else body = widget.axes.map((axis) => studioVSliderRenderSlider(widget, axis)).join('');
    return `
        <article class="vslider-card" data-vslider-card="${studioVSliderEscape(widget.id)}">
            <div class="vslider-card-title">
                ${studioVSliderEscape(widget.title)}
                <span class="vslider-kind" data-vslider-kind>${studioVSliderEscape(studioVSliderKindBadge(widget))}</span>
            </div>
            ${body}
        </article>
    `;
}

function studioVSliderRefreshAxisRow(card, axis, value) {
    const row = card.querySelector(`[data-vslider-axis-row="${axis.id}"]`);
    if (!row) return;
    const statusHost = row.querySelector(`[data-vslider-status="${axis.id}"]`);
    if (statusHost) {
        const tmp = document.createElement('div');
        tmp.innerHTML = studioVSliderAxisStatusHtml(axis, value);
        const next = tmp.firstElementChild;
        if (next) statusHost.replaceWith(next);
    }
    const blendHost = row.querySelector(`[data-vslider-blend="${axis.id}"]`);
    if (blendHost) {
        const tmp = document.createElement('div');
        tmp.innerHTML = studioVSliderAxisBlendHtml(axis, value);
        const next = tmp.firstElementChild;
        if (next) blendHost.replaceWith(next);
    }
    const ticks = row.querySelector('.slider-ticks');
    if (ticks) ticks.outerHTML = studioVSliderStopTicksHtml(axis.stops, value);
}

function studioVSliderRefreshPreviews() {
    studioVSliderWidgets.forEach((widget) => {
        const card = document.querySelector(`[data-vslider-card="${widget.id}"]`);
        if (!card) return;
        const kind = card.querySelector('[data-vslider-kind]');
        if (kind) kind.textContent = studioVSliderKindBadge(widget);
        card.querySelectorAll('.glass-slider[data-vslider-axis]').forEach((slider) => {
            const axisId = slider.getAttribute('data-vslider-axis');
            const axis = (widget.axes || []).find((entry) => entry.id === axisId);
            if (!axis) return;
            const value = widget.value[axisId];
            slider.value = String(Math.round(studioVSliderClamp01(value) * 100));
            studioVSliderRefreshAxisRow(card, axis, value);
        });
        const knob = card.querySelector('[data-vslider-knob]');
        if (knob && widget.axes && widget.axes.length >= 2 && widget.kind === 'xypad') {
            const x = studioVSliderClamp01(widget.value[widget.axes[0].id]);
            const y = studioVSliderClamp01(widget.value[widget.axes[1].id]);
            knob.style.left = `${x * 100}%`;
            knob.style.top = `${(1 - y) * 100}%`;
            const xState = studioVSliderAxisNeighbors(widget.axes[0].stops, x);
            const yState = studioVSliderAxisNeighbors(widget.axes[1].stops, y);
            const xEl = card.querySelector('[data-vslider-pad-x]');
            const yEl = card.querySelector('[data-vslider-pad-y]');
            if (xEl) xEl.textContent = xState.nearer ? xState.nearer.text : '';
            if (yEl) yEl.textContent = yState.nearer ? yState.nearer.text : '';
        }
        const star = card.querySelector('[data-vslider-star]');
        if (star && widget.kind === 'star') {
            const axes = widget.axes;
            const radius = 120;
            const pts = axes.map((axis, index) => studioVSliderStarPoint(index, axes.length, radius, widget.value[axis.id]));
            const poly = star.querySelector('[data-vslider-star-poly]');
            if (poly) poly.setAttribute('points', pts.map((pt) => `${pt.x},${pt.y}`).join(' '));
            star.querySelectorAll('[data-vslider-star-axis]').forEach((dot) => {
                const axisId = dot.getAttribute('data-vslider-star-axis');
                const index = axes.findIndex((axis) => axis.id === axisId);
                if (index < 0) return;
                const state = studioVSliderAxisNeighbors(axes[index].stops, widget.value[axisId]);
                dot.setAttribute('cx', String(pts[index].x));
                dot.setAttribute('cy', String(pts[index].y));
                dot.setAttribute('fill', state.isMedian ? '#fff' : '#ff4500');
                const label = star.querySelector(`[data-vslider-star-label="${axisId}"]`);
                if (label) {
                    label.textContent = state.nearer ? state.nearer.text : '';
                    label.setAttribute('fill', state.isMedian ? '#ccc' : '#ff4500');
                }
            });
        }
    });
    studioVSliderSyncFooter();
}

function studioVSliderWireDropdown(widget, card) {
    const container = card.querySelector(`[data-vslider-dropdown="${widget.id}"]`);
    if (!container) return;
    const button = container.querySelector('.custom-dropdown-btn');
    const menu = container.querySelector('.custom-dropdown-menu');
    const labelEl = container.querySelector('[data-vslider-dropdown-label]');
    // setupDropdown: public/scripts/comp/dropdown.js
    setupDropdown(container, button, menu, () => {}, () => widget.value, { preventFocusTransfer: true });
    menu.querySelectorAll('[data-vslider-option]').forEach((option) => {
        option.addEventListener('click', () => {
            const next = option.getAttribute('data-vslider-option');
            studioVSliderMarkDirty(widget.id, (entry) => {
                entry.value = next;
            });
            if (labelEl) labelEl.textContent = option.textContent;
            else button.textContent = option.textContent;
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
    const radius = Math.min(rect.width, rect.height) / 2 - 40;
    const mag = Math.sqrt(dx * dx + dy * dy);
    const value = studioVSliderClamp01((mag - 40) / Math.max(1, radius - 40));
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
                entry.value[axisId] = studioVSliderClamp01(Number(slider.value) / 100);
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

function studioVSliderFooterSummary() {
    const dirty = studioVSliderWidgets.filter((widget) => widget.dirty);
    if (dirty.length) {
        const names = dirty.map((widget) => {
            if (widget.kind === 'dropdown') return widget.title;
            if (studioVSliderWidgetBlending(widget)) return `${widget.title} blend`;
            return widget.title;
        });
        return { text: `Dirty — ${names.join(' + ')}`, dirty: true };
    }
    if (!studioVSliderWidgets.length) return { text: '', dirty: false };
    const first = studioVSliderWidgets[0];
    if (first.kind === 'dropdown') {
        const opt = (first.options || []).find((entry) => entry.id === first.value);
        return { text: opt ? opt.label : String(first.value || ''), dirty: false };
    }
    if (first.kind === 'slider' && first.axes[0]) {
        const state = studioVSliderAxisNeighbors(first.axes[0].stops, first.value[first.axes[0].id]);
        const name = state.nearer ? state.nearer.text : '';
        if (state.isMedian) return { text: `At median — ${name}`, dirty: false };
        return { text: name, dirty: false };
    }
    return { text: `${studioVSliderWidgets.length} widget${studioVSliderWidgets.length === 1 ? '' : 's'}`, dirty: false };
}

function studioVSliderSyncFooter() {
    const dirty = studioVSliderWidgets.some((widget) => widget.dirty);
    const finaliseBtn = document.getElementById('studioVSliderFinaliseBtn');
    const revertBtn = document.getElementById('studioVSliderRevertBtn');
    if (finaliseBtn) finaliseBtn.disabled = !dirty;
    if (revertBtn) revertBtn.disabled = !dirty;
    const note = document.getElementById('studioVSliderFooterNote');
    if (note) {
        const summary = studioVSliderFooterSummary();
        note.textContent = summary.text;
        note.classList.toggle('dirty', summary.dirty);
    }
    const kindLabel = document.getElementById('studioVSliderKindLabel');
    if (kindLabel) {
        const n = studioVSliderWidgets.length;
        kindLabel.textContent = n ? `${n} widget${n === 1 ? '' : 's'}` : '';
    }
}

function studioVSliderRenderCards() {
    const list = document.getElementById('studioVSliderList');
    if (!list) return;
    if (!studioVSliderWidgets.length) {
        list.innerHTML = '<div class="vslider-empty">No vSlider widgets. Install via Change JSON / MCP <code>vSlider</code>. Reopen from the Studio toolbox or prompt context menu.</div>';
        studioVSliderSyncFooter();
        studioVSliderRefreshScrollbar();
        return;
    }
    list.innerHTML = studioVSliderWidgets.map(studioVSliderRenderCard).join('');
    studioVSliderWidgets.forEach((widget) => {
        const card = list.querySelector(`[data-vslider-card="${widget.id}"]`);
        if (card) studioVSliderWireCard(widget, card);
    });
    studioVSliderSyncFooter();
    studioVSliderRefreshScrollbar();
}

function studioVSliderRefreshScrollbar() {
    const shell = document.querySelector('#studioVSliderTool .vslider-scroll-shell[data-custom-scrollbar]');
    if (!shell) return;
    // customScrollbar: public/scripts/comp/customScrollbar.js
    if (shell.classList.contains('has-custom-scrollbar')) customScrollbar.updateScrollbar(shell);
    else customScrollbar.forceReinit(shell);
}

function studioVSliderOpenWindow() {
    const el = document.getElementById('studioVSliderTool');
    if (!el) return;
    // openModal: public/scripts/comp/modalUtils.js
    openModal(el);
    studioVSliderRenderCards();
}

/** Studio toolbox / context menu — reopen the intensity tool (even if empty). */
function openStudioVSliderTool() {
    studioVSliderOpenWindow();
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

if (typeof window !== 'undefined') {
    window.openStudioVSliderTool = openStudioVSliderTool;
    window.installStudioVSliderWidgets = installStudioVSliderWidgets;
    window.getStudioVSliderSnapshot = getStudioVSliderSnapshot;
    window.normalizeStudioVSliderList = normalizeStudioVSliderList;
}
