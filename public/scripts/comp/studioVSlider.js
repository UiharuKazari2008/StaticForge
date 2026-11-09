/**
 * Studio vSlider - SI intensity widgets (slider / xypad / star / dropdown).
 * public/scripts/comp/studioChangeJson.js
 * public/scripts/comp/requestBodyReplacementsModal.js
 * public/scripts/comp/dropdown.js
 * public/scripts/comp/modalUtils.js
 * public/scripts/comp/textareaUtils.js
 * public/scripts/comp/contextMenu.js
 * Drag is preview. Generate applies live blends into expanders.
 * Finalise bakes !prefix into literal prompt text and removes the widget.
 */

const STUDIO_VSLIDER_MANAGED_PREFIXES = { _P: true, _N: true };
const STUDIO_VSLIDER_STAR_MAX_AXES = 8;
const STUDIO_VSLIDER_EXACT_EPS = 1e-4;
/** Omit near-neutral emphasis wrappers (right over / left under). */
const STUDIO_VSLIDER_OMIT_OVER = 1.02;
const STUDIO_VSLIDER_OMIT_UNDER = 0.98;

let studioVSliderWidgets = [];
let studioVSliderWired = false;
let studioVSliderHooksWired = false;
let studioVSliderDirtyPreviewIds = new Set();
let studioVSliderPreviewRaf = 0;

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
    // Crossfade: leaving stop de-emphasises, approaching stop over-emphasises.
    // Both at 1.0-1.5 (old formula) stacked competing tags at high weight.
    const nLeft = studioVSliderRoundN(1 - t * 0.5);  // 1.00 to 0.50
    const nRight = studioVSliderRoundN(1 + t * 0.5); // 1.00 to 1.50
    const parts = [];
    if (nLeft < STUDIO_VSLIDER_OMIT_UNDER) parts.push(`${nLeft}::${left.text}::`);
    if (nRight > STUDIO_VSLIDER_OMIT_OVER) parts.push(`${nRight}::${right.text}::`);
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

/** Words for where an axis sits, for the status line over its track bar (not the N:: blend string). */
function studioVSliderAxisStatusText(axis, value) {
    const state = studioVSliderAxisNeighbors(axis.stops, value);
    const pct = Math.round(studioVSliderClamp01(value) * 100);
    if (state.mode === 'empty') return `Value: ${pct}`;
    if (state.mode === 'between') {
        return `Value: ${pct} (between ${state.left.text} and ${state.right.text}, nearer ${state.nearer.text})`;
    }
    return `Value: ${pct} (${state.nearer.text}${state.isMedian ? ', the median' : ''})`;
}

function studioVSliderAxisStatusHtml(axis, value) {
    return `<div class="vslider-axis-label" data-vslider-status="${studioVSliderEscape(axis.id)}">${studioVSliderEscape(studioVSliderAxisStatusText(axis, value))}</div>`;
}

/** The text a blend writes ("0.8::average::, 1.2::plump::"), or '' at a stop. */
function studioVSliderAxisBlendText(axis, value) {
    const state = studioVSliderAxisNeighbors(axis.stops, value);
    return state.mode === 'between' && state.blendText && state.blendText.indexOf('::') !== -1 ? state.blendText : '';
}

function studioVSliderAxisBlendHtml(axis, value) {
    const text = studioVSliderAxisBlendText(axis, value);
    return `<div class="vslider-blend${text ? '' : ' hidden'}" data-vslider-blend="${studioVSliderEscape(axis.id)}">Writes: <span class="vslider-blend-text selectable">${studioVSliderEscape(text)}</span></div>`;
}

function studioVSliderWidgetBlending(widget) {
    if (widget.kind === 'dropdown') return false;
    return (widget.axes || []).some((axis) => !!studioVSliderAxisBlendText(axis, widget.value[axis.id]));
}

function studioVSliderKindBadge(widget) {
    if (widget.kind === 'dropdown') return 'Drop-down list';
    if (widget.kind === 'xypad') return 'XY pad';
    if (widget.kind === 'star') return `Star, ${widget.axes.length} axes`;
    return studioVSliderWidgetBlending(widget) ? 'Slider, blending' : 'Slider';
}

/** The track bar's tick marks, one per stop at the thumb's centre for that stop (css/studio-vslider.css). */
function studioVSliderStopTicksHtml(stops, value) {
    const sorted = studioVSliderSortStops(stops);
    const ticks = sorted.map((stop, index) => {
        const end = index === 0 || index === sorted.length - 1 ? ' is-end' : '';
        const active = Math.abs(studioVSliderClamp01(value) - stop.at) <= STUDIO_VSLIDER_EXACT_EPS ? ' is-active' : '';
        return `<span class="vslider-tick${end}${active}" style="--tick-frac: ${stop.at};"></span>`;
    }).join('');
    return `<div class="vslider-ticks" aria-hidden="true">${ticks}</div>`;
}

/** Stop names under their ticks (placed by position, not spread evenly). */
function studioVSliderStopLabelsHtml(stops) {
    const sorted = studioVSliderSortStops(stops);
    const labels = sorted.map((stop, index) => {
        const edge = index === 0 ? ' is-first' : (index === sorted.length - 1 ? ' is-last' : '');
        return `<span class="vslider-stop-label${edge}" style="--tick-frac: ${stop.at};">${studioVSliderEscape(stop.text)}</span>`;
    }).join('');
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

function studioVSliderRemoveExpander(prefix) {
    if (!prefix || !Array.isArray(requestBodyReplacements)) return;
    const next = requestBodyReplacements.filter((entry) => !(entry && entry.name === prefix));
    if (next.length === requestBodyReplacements.length) return;
    requestBodyReplacements.length = 0;
    next.forEach((entry) => requestBodyReplacements.push(entry));
    // renderRequestBodyReplacementsList: public/scripts/comp/requestBodyReplacementsModal.js
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

/** Replace !prefix token in prompt with literal baked text (expander lookahead). */
function studioVSliderReplaceExpanderRefInPrompt(prefix, text) {
    if (!prefix) return;
    // getStudioFieldValue / writeStudioFieldValue: public/scripts/comp/studioChangeJson.js
    let prompt = getStudioFieldValue('prompt') || '';
    const escaped = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`!${escaped}(?=[,\\s|\\[\\]{}:]|$)`, 'g');
    if (re.test(prompt)) {
        prompt = prompt.replace(re, text || '');
    } else if (text) {
        prompt = prompt.trim() ? `${prompt.trim()}, ${text}` : text;
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
let studioVSliderEditorDraft = null;
let studioVSliderEditorWidgetId = null;
let studioVSliderCloseObserver = null;

function studioVSliderStampForgeData(list) {
    studioVSliderForge.stamp(list);
}

/** Live apply into expanders for Generate/compile; keeps widgets for remixing. */
function studioVSliderWriteRequestBody(requestBody) {
    if (studioVSliderWidgets.length) {
        studioVSliderWidgets.forEach((widget) => studioVSliderCommitLiveToExpanders(widget));
        studioVSliderStampForgeData(getStudioVSliderSnapshot());
        studioVSliderSyncFooter();
        studioVSliderRefreshPreviews();
        // requestBodyReplacements: public/scripts/comp/requestBodyReplacementsModal.js
        if (Array.isArray(requestBodyReplacements)) {
            requestBody.text_replacements = requestBodyReplacements.slice();
        }
    }
    const snapshot = getStudioVSliderSnapshot();
    if (snapshot && snapshot.length) requestBody.vSlider = snapshot;
    else delete requestBody.vSlider;
}

/** Preview-gen path: write live blend into expander/prompt span; keep widget. */
function studioVSliderCommitLiveToExpanders(widget) {
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

/**
 * Permanent Finalise: bake resolved text into the prompt (replace !prefix),
 * remove the request expander, and delete the widget from the catalog.
 */
function studioVSliderBakeWidget(widget) {
    if (!widget) return false;
    const liveRows = studioVSliderResolvedTexts(widget, true);
    liveRows.forEach((row) => {
        if (!row.target) return;
        if (row.commit === 'prompt' || row.target.kind === 'prompt') {
            studioVSliderReplacePromptSpan('', row.text);
            return;
        }
        if (row.target.kind === 'expander' && row.target.prefix) {
            studioVSliderReplaceExpanderRefInPrompt(row.target.prefix, row.text);
            studioVSliderRemoveExpander(row.target.prefix);
        }
    });
    studioVSliderWidgets = studioVSliderWidgets.filter((entry) => entry.id !== widget.id);
    return true;
}

function studioVSliderFinaliseWidget(widgetId) {
    const widget = studioVSliderWidgets.find((entry) => entry.id === widgetId);
    if (!widget) return;
    studioVSliderBakeWidget(widget);
    studioVSliderStampForgeData(getStudioVSliderSnapshot());
    studioVSliderRenderCards();
    showGlassToast('success', 'vSlider', `Finalised "${widget.title}" into the prompt`, false, 2200, '<i class="fas fa-check"></i>');
}

function studioVSliderFinaliseAll() {
    if (!studioVSliderWidgets.length) {
        showGlassToast('info', 'vSlider', 'Nothing to finalise', false, 2000, '<i class="fas fa-info-circle"></i>');
        return;
    }
    const count = studioVSliderWidgets.length;
    const pending = studioVSliderWidgets.slice();
    pending.forEach((widget) => studioVSliderBakeWidget(widget));
    studioVSliderStampForgeData(getStudioVSliderSnapshot());
    studioVSliderRenderCards();
    showGlassToast('success', 'vSlider', `Finalised ${count} widget${count === 1 ? '' : 's'} into the prompt`, false, 2200, '<i class="fas fa-check"></i>');
}

function studioVSliderWidgetDefaultsValue(widget) {
    if (widget.kind === 'dropdown') {
        return widget.default != null ? widget.default : (widget.options[0] && widget.options[0].id);
    }
    const value = {};
    (widget.axes || []).forEach((axis) => {
        value[axis.id] = axis.default;
    });
    return value;
}

/** Changed = the live value differs from the one the last print wrote (committedValue). */
function studioVSliderIsChanged(widget) {
    if (widget.kind === 'dropdown') return widget.value !== widget.committedValue;
    return (widget.axes || []).some((axis) =>
        Math.abs(studioVSliderClamp01(widget.value[axis.id]) - studioVSliderClamp01(widget.committedValue[axis.id])) > STUDIO_VSLIDER_EXACT_EPS);
}

/** Context menu "Reset to Default": the widget's default values. */
function studioVSliderRevertWidget(widgetId) {
    const widget = studioVSliderWidgets.find((entry) => entry.id === widgetId);
    if (!widget) return;
    widget.value = studioVSliderClone(studioVSliderWidgetDefaultsValue(widget));
    widget.dirty = studioVSliderIsChanged(widget);
    studioVSliderRefreshPreviews();
}

/** Revert: back to the values the last print used (Revert is enabled only while something changed;
 * it used to jump to the defaults instead, which dropped the printed values). */
function studioVSliderRevertAll() {
    studioVSliderWidgets.forEach((widget) => {
        widget.value = studioVSliderClone(widget.committedValue);
        widget.dirty = false;
    });
    studioVSliderRefreshPreviews();
}

function studioVSliderDeleteWidget(widgetId) {
    studioVSliderWidgets = studioVSliderWidgets.filter((entry) => entry.id !== widgetId);
    studioVSliderStampForgeData(getStudioVSliderSnapshot());
    studioVSliderRenderCards();
}

function studioVSliderClearSession(options) {
    const opts = options || {};
    studioVSliderWidgets = [];
    // Do NOT stamp null onto preview/lastGeneration forge_data: that poisons
    // getImageMetadata's in-memory cache so reopen looks like vSlider was never saved.
    // Disk PNG keeps forge_data.vSlider; session widgets alone clear until restore.
    studioVSliderEditorDraft = null;
    studioVSliderEditorWidgetId = null;
    const list = document.getElementById('studioVSliderList');
    if (list) list.innerHTML = '';
    studioVSliderSyncFooter();
    if (opts.closeEditor !== false) {
        studioVSliderCloseEditor({ skipClear: true, skipClose: !!opts.fromHide });
    }
}

function studioVSliderMarkDirty(widgetId, mutator) {
    const widget = studioVSliderWidgets.find((entry) => entry.id === widgetId);
    if (!widget) return;
    mutator(widget);
    widget.dirty = studioVSliderIsChanged(widget);
    studioVSliderDirtyPreviewIds.add(widgetId);
    if (studioVSliderPreviewRaf) return;
    studioVSliderPreviewRaf = requestAnimationFrame(() => {
        studioVSliderPreviewRaf = 0;
        const ids = studioVSliderDirtyPreviewIds;
        studioVSliderDirtyPreviewIds = new Set();
        ids.forEach((id) => studioVSliderRefreshWidgetPreview(id));
        studioVSliderSyncFooter();
    });
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
            <div class="vslider-track">
                <input type="range" min="0" max="100" step="1" value="${pct}"
                    aria-label="${studioVSliderEscape(axis.label)}"
                    data-vslider-axis="${studioVSliderEscape(axis.id)}"
                    data-vslider-id="${studioVSliderEscape(widget.id)}">
                ${studioVSliderStopTicksHtml(axis.stops, value)}
                ${studioVSliderStopLabelsHtml(axis.stops)}
            </div>
            ${studioVSliderAxisBlendHtml(axis, value)}
        </div>
    `;
}

/** A drop-down widget is a Vista combo box (a native select; vista-glass-controls.css draws it). */
function studioVSliderRenderDropdown(widget) {
    const options = (widget.options || []).map((opt) => `
        <option value="${studioVSliderEscape(opt.id)}"${opt.id === widget.value ? ' selected' : ''}>${studioVSliderEscape(opt.label)}</option>
    `).join('');
    return `
        <div class="vslider-dropdown-row">
            <select data-vslider-select="${studioVSliderEscape(widget.id)}" aria-label="${studioVSliderEscape(widget.title)}">${options}</select>
            <span class="vslider-dropdown-text selectable" data-vslider-dropdown-text>${studioVSliderEscape(studioVSliderDropdownText(widget))}</span>
        </div>
    `;
}

/** XY pad: a white sunken pad with a light grid, the default as a grey dot and the colour dialog's
 * cross-hair as the knob (drag, or the arrow keys: 0.05, Shift 0.01). */
function studioVSliderRenderXyPad(widget) {
    const xAxis = widget.axes[0];
    const yAxis = widget.axes[1];
    const x = studioVSliderClamp01(widget.value[xAxis.id]);
    const y = studioVSliderClamp01(widget.value[yAxis.id]);
    const xState = studioVSliderAxisNeighbors(xAxis.stops, x);
    const yState = studioVSliderAxisNeighbors(yAxis.stops, y);
    const dx = studioVSliderClamp01(xAxis.default);
    const dy = studioVSliderClamp01(yAxis.default);
    return `
        <div class="vslider-pad-wrap">
            <div class="vslider-pad-ylabel">
                <span>${studioVSliderEscape(studioVSliderEndStopText(yAxis.stops, 'last'))}</span>
                <span class="axis-name">${studioVSliderEscape(yAxis.label)}</span>
                <span>${studioVSliderEscape(studioVSliderEndStopText(yAxis.stops, 'first'))}</span>
            </div>
            <div class="vslider-stage" data-vslider-xypad="${studioVSliderEscape(widget.id)}" tabindex="0"
                role="slider" aria-label="${studioVSliderEscape(`${xAxis.label} and ${yAxis.label}`)}">
                <div class="vslider-grid"></div>
                <div class="vslider-median-dot" title="Default" style="left:${dx * 100}%;top:${(1 - dy) * 100}%;"></div>
                <span class="vslider-knob" data-vslider-knob style="left:${x * 100}%;top:${(1 - y) * 100}%;"></span>
            </div>
            <dl class="vslider-pad-read">
                <dt>${studioVSliderEscape(yAxis.label)}:</dt>
                <dd data-vslider-pad-y>${studioVSliderEscape(yState.nearer ? yState.nearer.text : '')}</dd>
                <dt>${studioVSliderEscape(xAxis.label)}:</dt>
                <dd data-vslider-pad-x>${studioVSliderEscape(xState.nearer ? xState.nearer.text : '')}</dd>
            </dl>
            <div class="vslider-pad-xlabel">
                <span>${studioVSliderEscape(studioVSliderEndStopText(xAxis.stops, 'first'))}</span>
                <span class="axis-name">${studioVSliderEscape(xAxis.label)}</span>
                <span>${studioVSliderEscape(studioVSliderEndStopText(xAxis.stops, 'last'))}</span>
            </div>
        </div>
    `;
}

const STUDIO_VSLIDER_STAR_RADIUS = 120;
const STUDIO_VSLIDER_STAR_INNER = 40;

function studioVSliderStarPoint(index, count, radius, value) {
    const angle = (-Math.PI / 2) + (index * 2 * Math.PI / count);
    const r = STUDIO_VSLIDER_STAR_INNER + (radius - STUDIO_VSLIDER_STAR_INNER) * studioVSliderClamp01(value);
    return {
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        ax: Math.cos(angle) * radius,
        ay: Math.sin(angle) * radius,
        lx: Math.cos(angle) * (radius + 16),
        ly: Math.sin(angle) * (radius + 16),
        angle
    };
}

/** Star: spokes from 40 to 120 units, the shape in the selection blue; the viewBox is drawn at about
 * 1:1 so the labels are Segoe UI 9 pt (css/studio-vslider.css sizes the svg). */
function studioVSliderRenderStar(widget) {
    const axes = widget.axes;
    const radius = STUDIO_VSLIDER_STAR_RADIUS;
    const spokes = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, radius, 1);
        return `<line class="vslider-star-spoke" x1="0" y1="0" x2="${pt.ax}" y2="${pt.ay}"></line>`;
    }).join('');
    const medianRing = `<circle class="vslider-star-median" r="${STUDIO_VSLIDER_STAR_INNER + (radius - STUDIO_VSLIDER_STAR_INNER) * 0.5}"></circle>`;
    const rings = `<circle class="vslider-star-ring" r="${radius}"></circle><circle class="vslider-star-ring" r="${STUDIO_VSLIDER_STAR_INNER}"></circle>`;
    const polyPts = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, radius, widget.value[axis.id]);
        return `${pt.x},${pt.y}`;
    }).join(' ');
    const dots = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, radius, widget.value[axis.id]);
        const state = studioVSliderAxisNeighbors(axis.stops, widget.value[axis.id]);
        return `<circle class="vslider-star-dot${state.isMedian ? ' is-median' : ''}" cx="${pt.x}" cy="${pt.y}" r="5" data-vslider-star-axis="${studioVSliderEscape(axis.id)}"></circle>`;
    }).join('');
    const labels = axes.map((axis, index) => {
        const pt = studioVSliderStarPoint(index, axes.length, radius, 1);
        const state = studioVSliderAxisNeighbors(axis.stops, widget.value[axis.id]);
        const anchor = Math.abs(pt.lx) < 12 ? 'middle' : (pt.lx > 0 ? 'start' : 'end');
        // labels above the top spoke, below the bottom one, beside the others
        const dy = pt.ly < -radius * 0.7 ? -16 : (pt.ly > radius * 0.7 ? 14 : -2);
        return `
            <text class="vslider-star-name" x="${pt.lx}" y="${pt.ly + dy}" text-anchor="${anchor}">${studioVSliderEscape(axis.label)}</text>
            <text class="vslider-star-stop" x="${pt.lx}" y="${pt.ly + dy + 15}" text-anchor="${anchor}" data-vslider-star-label="${studioVSliderEscape(axis.id)}">${studioVSliderEscape(state.nearer ? state.nearer.text : '')}</text>
        `;
    }).join('');
    return `
        <div class="vslider-star-stage">
            <svg data-vslider-star="${studioVSliderEscape(widget.id)}" viewBox="-210 -175 420 350" xmlns="http://www.w3.org/2000/svg">
                ${rings}
                ${medianRing}
                ${spokes}
                <polygon class="vslider-star-poly" points="${polyPts}" data-vslider-star-poly></polygon>
                ${dots}
                ${labels}
            </svg>
        </div>
    `;
}

/** Each widget is a group box: the title as its caption, the controls inside. */
function studioVSliderRenderCard(widget) {
    let body = '';
    if (widget.kind === 'dropdown') body = studioVSliderRenderDropdown(widget);
    else if (widget.kind === 'xypad') body = studioVSliderRenderXyPad(widget);
    else if (widget.kind === 'star') body = studioVSliderRenderStar(widget);
    else body = widget.axes.map((axis) => studioVSliderRenderSlider(widget, axis)).join('');
    return `
        <fieldset class="vslider-card" data-vslider-card="${studioVSliderEscape(widget.id)}">
            <legend data-vslider-kind title="${studioVSliderEscape(studioVSliderKindBadge(widget))}">${studioVSliderEscape(widget.title)}</legend>
            ${body}
        </fieldset>
    `;
}

function studioVSliderCardEl(widgetId) {
    return document.querySelector(`#studioVSliderList [data-vslider-card="${CSS.escape(String(widgetId))}"]`);
}

function studioVSliderRefreshAxisRow(card, axis, value) {
    const id = CSS.escape(String(axis.id));
    const row = card.querySelector(`[data-vslider-axis-row="${id}"]`);
    if (!row) return;
    const statusHost = row.querySelector(`[data-vslider-status="${id}"]`);
    if (statusHost) statusHost.textContent = studioVSliderAxisStatusText(axis, value);
    const blendHost = row.querySelector(`[data-vslider-blend="${id}"]`);
    if (blendHost) {
        const text = studioVSliderAxisBlendText(axis, value);
        blendHost.classList.toggle('hidden', !text);
        const span = blendHost.querySelector('.vslider-blend-text');
        if (span) span.textContent = text;
    }
    const sorted = studioVSliderSortStops(axis.stops);
    const v = studioVSliderClamp01(value);
    row.querySelectorAll('.vslider-tick').forEach((tick, i) => {
        const stop = sorted[i];
        tick.classList.toggle('is-active', !!stop && Math.abs(v - stop.at) <= STUDIO_VSLIDER_EXACT_EPS);
    });
}

function studioVSliderRefreshWidgetPreview(widgetId) {
    const widget = studioVSliderWidgets.find((entry) => entry.id === widgetId);
    if (!widget) return;
    const card = studioVSliderCardEl(widget.id);
    if (!card) return;
    const legend = card.querySelector('[data-vslider-kind]');
    if (legend) legend.title = studioVSliderKindBadge(widget);
    card.querySelectorAll('input[type="range"][data-vslider-axis]').forEach((slider) => {
        const axisId = slider.getAttribute('data-vslider-axis');
        const axis = (widget.axes || []).find((entry) => entry.id === axisId);
        if (!axis) return;
        const value = widget.value[axisId];
        const next = String(Math.round(studioVSliderClamp01(value) * 100));
        if (slider.value !== next) slider.value = next;
        studioVSliderRefreshAxisRow(card, axis, value);
    });
    if (widget.kind === 'dropdown') {
        const select = card.querySelector('[data-vslider-select]');
        if (select && select.value !== widget.value) select.value = widget.value;
        const text = card.querySelector('[data-vslider-dropdown-text]');
        if (text) text.textContent = studioVSliderDropdownText(widget);
    }
    const knob = card.querySelector('[data-vslider-knob]');
    if (knob && widget.kind === 'xypad') {
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
        const pts = axes.map((axis, index) => studioVSliderStarPoint(index, axes.length, STUDIO_VSLIDER_STAR_RADIUS, widget.value[axis.id]));
        const poly = star.querySelector('[data-vslider-star-poly]');
        if (poly) poly.setAttribute('points', pts.map((pt) => `${pt.x},${pt.y}`).join(' '));
        star.querySelectorAll('[data-vslider-star-axis]').forEach((dot) => {
            const axisId = dot.getAttribute('data-vslider-star-axis');
            const index = axes.findIndex((axis) => axis.id === axisId);
            if (index < 0) return;
            const state = studioVSliderAxisNeighbors(axes[index].stops, widget.value[axisId]);
            dot.setAttribute('cx', String(pts[index].x));
            dot.setAttribute('cy', String(pts[index].y));
            dot.classList.toggle('is-median', state.isMedian);
            const label = star.querySelector(`[data-vslider-star-label="${CSS.escape(axisId)}"]`);
            if (label) label.textContent = state.nearer ? state.nearer.text : '';
        });
    }
}

function studioVSliderRefreshPreviews() {
    studioVSliderWidgets.forEach((widget) => studioVSliderRefreshWidgetPreview(widget.id));
    studioVSliderSyncFooter();
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

/** Pick the spoke nearest the pointer and set it from the distance to the centre, in the svg's own
 * units (the old pixel maths ignored the viewBox scale, so the outer ring read about 0.6). */
function studioVSliderBindStar(svg, widget, fromClient) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = new DOMPoint(fromClient.clientX, fromClient.clientY).matrixTransform(ctm.inverse());
    const angle = Math.atan2(pt.y, pt.x);
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
    const mag = Math.hypot(pt.x, pt.y);
    const value = studioVSliderClamp01((mag - STUDIO_VSLIDER_STAR_INNER) / (STUDIO_VSLIDER_STAR_RADIUS - STUDIO_VSLIDER_STAR_INNER));
    const axis = widget.axes[best];
    studioVSliderMarkDirty(widget.id, (entry) => {
        entry.value[axis.id] = value;
    });
}

function studioVSliderWireCard(widget, card) {
    card.querySelectorAll('input[type="range"][data-vslider-axis]').forEach((slider) => {
        slider.addEventListener('input', () => {
            const axisId = slider.getAttribute('data-vslider-axis');
            studioVSliderMarkDirty(widget.id, (entry) => {
                entry.value[axisId] = studioVSliderClamp01(Number(slider.value) / 100);
            });
        });
    });
    const select = card.querySelector('[data-vslider-select]');
    if (select) {
        select.addEventListener('change', () => {
            const next = select.value;
            studioVSliderMarkDirty(widget.id, (entry) => {
                entry.value = next;
            });
        });
    }
    const pad = card.querySelector('[data-vslider-xypad]');
    if (pad) {
        const drag = (event) => studioVSliderBindPad(pad, widget, event);
        pad.addEventListener('pointerdown', (event) => {
            pad.setPointerCapture(event.pointerId);
            pad.focus({ preventScroll: true });
            drag(event);
        });
        pad.addEventListener('pointermove', (event) => {
            if (event.buttons) drag(event);
        });
        pad.addEventListener('keydown', (event) => {
            const step = event.shiftKey ? 0.01 : 0.05;
            const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
            const move = moves[event.key];
            if (!move) return;
            event.preventDefault();
            studioVSliderMarkDirty(widget.id, (entry) => {
                const [xAxis, yAxis] = entry.axes;
                entry.value[xAxis.id] = studioVSliderClamp01(studioVSliderRoundN(entry.value[xAxis.id] + move[0]));
                entry.value[yAxis.id] = studioVSliderClamp01(studioVSliderRoundN(entry.value[yAxis.id] + move[1]));
            });
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
        return { text: `Changed: ${dirty.map((widget) => widget.title).join(', ')}. The next print uses the new values.`, dirty: true };
    }
    return { text: '', dirty: false };
}

function studioVSliderSyncFooter() {
    const hasWidgets = studioVSliderWidgets.length > 0;
    const dirty = studioVSliderWidgets.some((widget) => widget.dirty);
    const finaliseBtn = document.getElementById('studioVSliderFinaliseBtn');
    const revertBtn = document.getElementById('studioVSliderRevertBtn');
    // Finalise All bakes every remaining widget (permanent), not only the changed ones
    if (finaliseBtn) finaliseBtn.disabled = !hasWidgets;
    if (revertBtn) revertBtn.disabled = !dirty;
    const note = document.getElementById('studioVSliderFooterNote');
    if (note) {
        const summary = studioVSliderFooterSummary();
        note.textContent = summary.text;
        note.title = summary.text;
    }
    const kindLabel = document.getElementById('studioVSliderKindLabel');
    if (kindLabel) {
        const n = studioVSliderWidgets.length;
        kindLabel.textContent = n ? `(${n} widget${n === 1 ? '' : 's'})` : '';
    }
}

function studioVSliderAttachCardContextMenu(card, widget) {
    if (!card || !widget) return;
    // contextMenu: public/scripts/comp/contextMenu.js
    if (card.hasAttribute('data-context-menu')) contextMenu.detachFromElement(card);
    const widgetId = widget.id;
    contextMenu.attachToElement(card, {
        sections: [{
            type: 'list',
            items: [
                { icon: 'fas fa-pen', text: 'Edit...', action: 'edit' },
                { icon: 'fas fa-plus', text: 'Add Widget...', action: 'add' },
                { icon: 'fas fa-undo', text: 'Reset to Default', action: 'revert' },
                { icon: 'fas fa-check', text: 'Finalise', action: 'finalise' },
                { separator: true },
                { icon: 'fas fa-trash', text: 'Delete', action: 'delete', className: 'context-menu-item-danger' }
            ]
        }],
        onAction: (action) => {
            if (action === 'edit') studioVSliderOpenEditor(widgetId);
            else if (action === 'add') studioVSliderOpenEditor(null);
            else if (action === 'revert') studioVSliderRevertWidget(widgetId);
            else if (action === 'finalise') studioVSliderFinaliseWidget(widgetId);
            else if (action === 'delete') studioVSliderDeleteWidget(widgetId);
        }
    });
}

function studioVSliderRenderCards() {
    const list = document.getElementById('studioVSliderList');
    if (!list) return;
    if (!studioVSliderWidgets.length) {
        list.innerHTML = `
            <div class="vslider-empty">
                <p>There are no vSlider widgets for this print.</p>
                <p>Add one here, or send a <code>vSlider</code> list through Change JSON or MCP.</p>
                <button type="button" class="btn-secondary" data-vslider-add-empty>Add Widget...</button>
            </div>`;
        const addBtn = list.querySelector('[data-vslider-add-empty]');
        if (addBtn) addBtn.addEventListener('click', () => studioVSliderOpenEditor(null));
        studioVSliderSyncFooter();
        return;
    }
    list.innerHTML = studioVSliderWidgets.map(studioVSliderRenderCard).join('');
    studioVSliderWidgets.forEach((widget) => {
        const card = list.querySelector(`[data-vslider-card="${CSS.escape(String(widget.id))}"]`);
        if (!card) return;
        studioVSliderWireCard(widget, card);
        studioVSliderAttachCardContextMenu(card, widget);
    });
    studioVSliderSyncFooter();
}

function studioVSliderOpenWindow() {
    const el = document.getElementById('studioVSliderTool');
    if (!el) return;
    // Re-hydrate from Studio metadata if session was cleared but image still has catalog
    if (!studioVSliderWidgets.length) {
        const list = studioVSliderResolveCatalogFromStudio(null);
        if (list && list.length) installStudioVSliderWidgets(list, { open: false });
    }
    // openModal / debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js
    openModal(el);
    if (typeof debouncedUpdateTaskbarWindows === 'function') debouncedUpdateTaskbarWindows();
    studioVSliderRenderCards();
}

/** Studio toolbox / context menu: reopen the intensity tool (even if empty). */
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
    // lastGeneration is often the metadata object itself (forge_data on top)
    const meta = image.metadata || image;
    const forge = (meta && meta.forge_data) || image.forge_data;
    if (forge && Array.isArray(forge.vSlider) && forge.vSlider.length) return forge.vSlider;
    if (meta && Array.isArray(meta.vSlider) && meta.vSlider.length) return meta.vSlider;
    return null;
}

/** Prefer fetched Studio metadata over gallery card stubs. */
function studioVSliderResolveCatalogFromStudio(content) {
    if (window.currentEditMetadata) {
        const fromEdit = studioVSliderReadFromImage({ metadata: window.currentEditMetadata });
        if (fromEdit) return fromEdit;
    }
    const preview = studioVSliderForge.previewImage();
    const fromPreview = studioVSliderReadFromImage(preview);
    if (fromPreview) return fromPreview;
    const fromLast = studioVSliderReadFromImage(window.lastGeneration);
    if (fromLast) return fromLast;
    if (content && content.metadata) {
        const fromContentMeta = studioVSliderReadFromImage({ metadata: content.metadata });
        if (fromContentMeta) return fromContentMeta;
    }
    if (content && content.image) return studioVSliderReadFromImage(content.image);
    return null;
}

function studioVSliderMaybeRestoreFromImage(image) {
    const list = studioVSliderReadFromImage(image);
    if (!list) return;
    installStudioVSliderWidgets(list, { open: true });
}

function studioVSliderMaybeRestoreFromStudio(content, options) {
    const opts = options || {};
    const list = studioVSliderResolveCatalogFromStudio(content);
    if (!list || !list.length) return;
    installStudioVSliderWidgets(list, { open: opts.open !== false });
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
        // After fetch: currentEditMetadata / preview hold full forge_data (incl. vSlider).
        // Gallery content.image is often a stub without forge_data.vSlider.
        studioVSliderMaybeRestoreFromStudio(content, { open: true });
        return result;
    };
}

function studioVSliderNewId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`;
}

function studioVSliderDefaultDraft(kind) {
    const k = kind || 'slider';
    if (k === 'dropdown') {
        return {
            id: studioVSliderNewId('scene'),
            kind: 'dropdown',
            title: 'scene',
            commit: 'expander',
            target: { kind: 'expander', prefix: 'scene' },
            default: 'a',
            value: 'a',
            options: [
                { id: 'a', label: 'option a', text: 'option a' },
                { id: 'b', label: 'option b', text: 'option b' }
            ]
        };
    }
    const axisCount = k === 'xypad' ? 2 : (k === 'star' ? 3 : 1);
    const axes = [];
    for (let i = 0; i < axisCount; i++) {
        const id = axisCount === 1 ? 'weight' : (i === 0 ? 'x' : (i === 1 ? 'y' : `axis${i}`));
        axes.push({
            id,
            label: id,
            default: 0.5,
            target: { kind: 'expander', prefix: id },
            stops: [
                { at: 0, text: 'low' },
                { at: 0.5, text: 'mid' },
                { at: 1, text: 'high' }
            ]
        });
    }
    const value = {};
    axes.forEach((axis) => { value[axis.id] = axis.default; });
    return {
        id: studioVSliderNewId(k),
        kind: k,
        title: k === 'slider' ? 'body weight' : k,
        commit: 'expander',
        target: axes[0].target,
        value,
        axes
    };
}

function studioVSliderOpenEditor(widgetId) {
    const existing = widgetId
        ? studioVSliderWidgets.find((entry) => entry.id === widgetId)
        : null;
    studioVSliderEditorWidgetId = existing ? existing.id : null;
    studioVSliderEditorDraft = existing
        ? studioVSliderClone(existing)
        : studioVSliderDefaultDraft('slider');
    if (!studioVSliderEditorDraft.target && studioVSliderEditorDraft.axes && studioVSliderEditorDraft.axes[0]) {
        studioVSliderEditorDraft.target = studioVSliderClone(studioVSliderEditorDraft.axes[0].target);
    }
    studioVSliderRenderEditor();
    const el = document.getElementById('studioVSliderEditorTool');
    if (!el) return;
    openModal(el);
    if (typeof debouncedUpdateTaskbarWindows === 'function') debouncedUpdateTaskbarWindows();
}

function studioVSliderCloseEditor(options) {
    const opts = options || {};
    const el = document.getElementById('studioVSliderEditorTool');
    if (el && !el.classList.contains('hidden') && !opts.skipClose) {
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(el);
    }
    if (!opts.skipClear) {
        studioVSliderEditorDraft = null;
        studioVSliderEditorWidgetId = null;
    }
}

function studioVSliderEditorKindBadge() {
    const draft = studioVSliderEditorDraft;
    if (!draft) return '';
    return studioVSliderEditorWidgetId ? `(${draft.title || draft.kind})` : '(new widget)';
}

const STUDIO_VSLIDER_KIND_NAMES = { slider: 'Slider', xypad: 'XY pad', star: 'Star', dropdown: 'Drop-down list' };

/** Multi-axis widgets write each axis into its own expander; a slider or a drop-down list has one. */
function studioVSliderEditorPerAxisTargets(draft) {
    return (draft.kind === 'xypad' || draft.kind === 'star') && !(draft.target && draft.target.kind === 'prompt');
}

function studioVSliderEditorAxisPrefix(draft, axis) {
    if (axis.target && axis.target.kind === 'expander' && axis.target.prefix) return axis.target.prefix;
    return axis.id || '';
}

/** The widget editor: a Vista dialog form (css/studio-vslider.css). Labels sit left of their
 * controls; each axis (or the options of a drop-down list) is a group box with a small table. */
function studioVSliderRenderEditor() {
    const body = document.getElementById('studioVSliderEditorBody');
    const kindLabel = document.getElementById('studioVSliderEditorKindLabel');
    if (!body || !studioVSliderEditorDraft) return;
    if (kindLabel) kindLabel.textContent = studioVSliderEditorKindBadge();
    const draft = studioVSliderEditorDraft;
    const esc = studioVSliderEscape;
    const targetKind = draft.target && draft.target.kind === 'prompt' ? 'prompt' : 'expander';
    const perAxis = studioVSliderEditorPerAxisTargets(draft);
    const prefix = draft.target && draft.target.prefix ? draft.target.prefix : '';
    const kindOptions = ['slider', 'xypad', 'star', 'dropdown'].map((kind) =>
        `<option value="${kind}"${draft.kind === kind ? ' selected' : ''}>${STUDIO_VSLIDER_KIND_NAMES[kind]}</option>`).join('');

    let groupsHtml = '';
    if (draft.kind === 'dropdown') {
        const rows = (draft.options || []).map((opt, index) => `
            <div class="vslider-editor-row vslider-editor-option-row" data-vslider-editor-option="${index}">
                <input type="text" data-field="id" value="${esc(opt.id)}" aria-label="Id" autocomplete="off" spellcheck="false">
                <input type="text" data-field="label" value="${esc(opt.label)}" aria-label="Label" autocomplete="off">
                <input type="text" data-field="text" value="${esc(opt.text)}" aria-label="Prompt text" autocomplete="off" spellcheck="false">
                <button type="button" class="btn-secondary" data-vslider-editor-remove-option>Remove</button>
            </div>
        `).join('');
        const defaultOptions = (draft.options || []).filter((opt) => String(opt.id || '').trim()).map((opt) =>
            `<option value="${esc(opt.id)}"${opt.id === draft.default ? ' selected' : ''}>${esc(opt.label || opt.id)}</option>`).join('');
        groupsHtml = `
            <fieldset class="vslider-editor-group">
                <legend>Options</legend>
                <div class="vslider-editor-row vslider-editor-option-row vslider-editor-head" aria-hidden="true">
                    <span>Id</span><span>Label</span><span>Prompt text</span><span></span>
                </div>
                <div class="vslider-editor-list" data-vslider-editor-options>${rows}</div>
                <div class="vslider-editor-actions">
                    <button type="button" class="btn-secondary" data-vslider-editor-add-option>Add Option</button>
                    <label class="vslider-editor-inline-label" for="studioVSliderEditorDefault">Default:</label>
                    <select id="studioVSliderEditorDefault" data-vslider-editor-default>${defaultOptions}</select>
                </div>
            </fieldset>
        `;
    } else {
        groupsHtml = (draft.axes || []).map((axis, axisIndex) => {
            const stopRows = (axis.stops || []).map((stop, stopIndex) => `
                <div class="vslider-editor-row" data-vslider-editor-stop="${stopIndex}">
                    <input type="number" min="0" max="1" step="0.05" data-field="at" value="${esc(stop.at)}" aria-label="Position (0 to 1)">
                    <input type="text" data-field="text" value="${esc(stop.text)}" aria-label="Prompt text" autocomplete="off" spellcheck="false">
                    <button type="button" class="btn-secondary" data-vslider-editor-remove-stop>Remove</button>
                </div>
            `).join('');
            const axisDefault = axis.default != null ? axis.default : studioVSliderMedianAt(axis.stops);
            return `
                <fieldset class="vslider-editor-group" data-vslider-editor-axis="${axisIndex}">
                    <legend>Axis ${axisIndex + 1}</legend>
                    <div class="vslider-editor-form">
                        <label for="vsliderAxisId${axisIndex}">Id:</label>
                        <input type="text" id="vsliderAxisId${axisIndex}" data-vslider-editor-axis-id value="${esc(axis.id)}" autocomplete="off" spellcheck="false">
                        <label for="vsliderAxisLabel${axisIndex}">Label:</label>
                        <input type="text" id="vsliderAxisLabel${axisIndex}" data-vslider-editor-axis-label value="${esc(axis.label)}" autocomplete="off">
                        ${perAxis ? `<label for="vsliderAxisPrefix${axisIndex}">Expander:</label>
                        <input type="text" id="vsliderAxisPrefix${axisIndex}" data-vslider-editor-axis-prefix value="${esc(studioVSliderEditorAxisPrefix(draft, axis))}" placeholder="prefix, without !" autocomplete="off" spellcheck="false">` : ''}
                        <label for="vsliderAxisDefault${axisIndex}">Default:</label>
                        <input type="number" id="vsliderAxisDefault${axisIndex}" class="vslider-editor-number" min="0" max="1" step="0.05" data-vslider-editor-axis-default value="${esc(studioVSliderRoundN(axisDefault))}">
                    </div>
                    <div class="vslider-editor-row vslider-editor-head" aria-hidden="true"><span>Position</span><span>Prompt text</span><span></span></div>
                    <div class="vslider-editor-list" data-vslider-editor-stops>${stopRows}</div>
                    <div class="vslider-editor-actions">
                        <button type="button" class="btn-secondary" data-vslider-editor-add-stop>Add Stop</button>
                    </div>
                </fieldset>
            `;
        }).join('');
        if (draft.kind === 'star') {
            groupsHtml += `
                <div class="vslider-editor-actions">
                    <button type="button" class="btn-secondary" data-vslider-editor-add-axis
                        ${(draft.axes || []).length >= STUDIO_VSLIDER_STAR_MAX_AXES ? 'disabled' : ''}>Add Axis</button>
                    <button type="button" class="btn-secondary" data-vslider-editor-remove-axis
                        ${(draft.axes || []).length <= 2 ? 'disabled' : ''}>Remove Axis</button>
                </div>
            `;
        }
    }

    body.innerHTML = `
        <div class="vslider-editor-form">
            <label for="studioVSliderEditorKind">Kind:</label>
            <select id="studioVSliderEditorKind" data-vslider-editor-kind>${kindOptions}</select>
            <label for="studioVSliderEditorTitle">Title:</label>
            <input type="text" id="studioVSliderEditorTitle" data-vslider-editor-title value="${esc(draft.title)}"
                autocomplete="off" autocapitalize="off" spellcheck="false">
            <label for="studioVSliderEditorTarget">Writes to:</label>
            <select id="studioVSliderEditorTarget" data-vslider-editor-target>
                <option value="expander"${targetKind === 'expander' ? ' selected' : ''}>${perAxis ? 'An expander per axis' : 'An expander'}</option>
                <option value="prompt"${targetKind === 'prompt' ? ' selected' : ''}>The prompt</option>
            </select>
            ${targetKind === 'expander' && !perAxis ? `<label for="studioVSliderEditorPrefix">Expander:</label>
            <input type="text" id="studioVSliderEditorPrefix" data-vslider-editor-prefix value="${esc(prefix)}"
                placeholder="prefix, without !" autocomplete="off" autocapitalize="off" spellcheck="false">` : ''}
        </div>
        ${groupsHtml}
    `;
    studioVSliderWireEditor(body);
}

function studioVSliderWireEditor(body) {
    const draft = studioVSliderEditorDraft;
    if (!draft || !body) return;

    const titleInput = body.querySelector('[data-vslider-editor-title]');
    if (titleInput) {
        titleInput.addEventListener('input', () => {
            draft.title = titleInput.value;
        });
    }
    const prefixInput = body.querySelector('[data-vslider-editor-prefix]');
    if (prefixInput) {
        prefixInput.addEventListener('input', () => {
            draft.target = { kind: 'expander', prefix: prefixInput.value.trim().replace(/^!/, '') };
        });
    }

    const kindSelect = body.querySelector('[data-vslider-editor-kind]');
    if (kindSelect) {
        kindSelect.addEventListener('change', () => {
            const keptId = draft.id;
            const keptTitle = draft.title;
            studioVSliderEditorDraft = studioVSliderDefaultDraft(kindSelect.value);
            studioVSliderEditorDraft.id = keptId;
            if (keptTitle) studioVSliderEditorDraft.title = keptTitle;
            studioVSliderRenderEditor();
        });
    }

    const targetSelect = body.querySelector('[data-vslider-editor-target]');
    if (targetSelect) {
        targetSelect.addEventListener('change', () => {
            if (targetSelect.value === 'prompt') draft.target = { kind: 'prompt' };
            else draft.target = { kind: 'expander', prefix: String(draft.title || (draft.axes && draft.axes[0] && draft.axes[0].id) || 'body').trim().replace(/\W+/g, '_') };
            draft.commit = targetSelect.value === 'prompt' ? 'prompt' : 'expander';
            studioVSliderRenderEditor();
        });
    }

    body.querySelectorAll('[data-vslider-editor-axis]').forEach((axisEl) => {
        const axisIndex = Number(axisEl.getAttribute('data-vslider-editor-axis'));
        const axis = draft.axes[axisIndex];
        if (!axis) return;
        const idInput = axisEl.querySelector('[data-vslider-editor-axis-id]');
        const labelInput = axisEl.querySelector('[data-vslider-editor-axis-label]');
        const axisPrefix = axisEl.querySelector('[data-vslider-editor-axis-prefix]');
        const axisDefault = axisEl.querySelector('[data-vslider-editor-axis-default]');
        if (idInput) idInput.addEventListener('input', () => { axis.id = idInput.value.trim(); });
        if (labelInput) labelInput.addEventListener('input', () => { axis.label = labelInput.value; });
        if (axisPrefix) {
            axisPrefix.addEventListener('input', () => {
                axis.target = { kind: 'expander', prefix: axisPrefix.value.trim().replace(/^!/, '') };
            });
        }
        if (axisDefault) axisDefault.addEventListener('input', () => { axis.default = studioVSliderClamp01(axisDefault.value); });
        axisEl.querySelectorAll('[data-vslider-editor-stop]').forEach((row) => {
            const stopIndex = Number(row.getAttribute('data-vslider-editor-stop'));
            const stop = axis.stops[stopIndex];
            if (!stop) return;
            const atInput = row.querySelector('[data-field="at"]');
            const textInput = row.querySelector('[data-field="text"]');
            if (atInput) atInput.addEventListener('input', () => { stop.at = studioVSliderClamp01(atInput.value); });
            if (textInput) textInput.addEventListener('input', () => { stop.text = textInput.value; });
            const removeBtn = row.querySelector('[data-vslider-editor-remove-stop]');
            if (removeBtn) {
                removeBtn.disabled = axis.stops.length <= 2;
                removeBtn.title = removeBtn.disabled ? 'An axis needs at least 2 stops' : 'Remove this stop';
                removeBtn.addEventListener('click', () => {
                    if (axis.stops.length <= 2) return;
                    axis.stops.splice(stopIndex, 1);
                    studioVSliderRenderEditor();
                });
            }
        });
        const addStop = axisEl.querySelector('[data-vslider-editor-add-stop]');
        if (addStop) {
            addStop.addEventListener('click', () => {
                axis.stops.push({ at: 1, text: 'new' });
                studioVSliderRenderEditor();
            });
        }
    });

    const addAxis = body.querySelector('[data-vslider-editor-add-axis]');
    if (addAxis) {
        addAxis.addEventListener('click', () => {
            if ((draft.axes || []).length >= STUDIO_VSLIDER_STAR_MAX_AXES) return;
            const n = draft.axes.length;
            draft.axes.push({
                id: `axis${n}`,
                label: `axis${n}`,
                default: 0.5,
                target: { kind: 'expander', prefix: `axis${n}` },
                stops: [
                    { at: 0, text: 'low' },
                    { at: 0.5, text: 'mid' },
                    { at: 1, text: 'high' }
                ]
            });
            studioVSliderRenderEditor();
        });
    }
    const removeAxis = body.querySelector('[data-vslider-editor-remove-axis]');
    if (removeAxis) {
        removeAxis.addEventListener('click', () => {
            if ((draft.axes || []).length <= 2) return;
            draft.axes.pop();
            studioVSliderRenderEditor();
        });
    }

    body.querySelectorAll('[data-vslider-editor-option]').forEach((row) => {
        const index = Number(row.getAttribute('data-vslider-editor-option'));
        const opt = draft.options[index];
        if (!opt) return;
        ['id', 'label', 'text'].forEach((field) => {
            const input = row.querySelector(`[data-field="${field}"]`);
            if (input) input.addEventListener('input', () => { opt[field] = input.value; });
        });
        const removeBtn = row.querySelector('[data-vslider-editor-remove-option]');
        if (removeBtn) {
            removeBtn.disabled = draft.options.length <= 1;
            removeBtn.title = removeBtn.disabled ? 'A drop-down list needs at least 1 option' : 'Remove this option';
            removeBtn.addEventListener('click', () => {
                if (draft.options.length <= 1) return;
                draft.options.splice(index, 1);
                studioVSliderRenderEditor();
            });
        }
    });
    const defaultSelect = body.querySelector('[data-vslider-editor-default]');
    if (defaultSelect) defaultSelect.addEventListener('change', () => { draft.default = defaultSelect.value; });
    const addOpt = body.querySelector('[data-vslider-editor-add-option]');
    if (addOpt) {
        addOpt.addEventListener('click', () => {
            const id = `opt${(draft.options || []).length + 1}`;
            draft.options.push({ id, label: id, text: id });
            studioVSliderRenderEditor();
        });
    }
}

function studioVSliderEditorError(message) {
    showGlassToast('error', 'vSlider', message, false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
}

function studioVSliderSaveEditor() {
    const draft = studioVSliderEditorDraft;
    if (!draft) return;
    const toPrompt = !!(draft.target && draft.target.kind === 'prompt');
    draft.commit = toPrompt ? 'prompt' : 'expander';
    const existing = studioVSliderEditorWidgetId
        ? studioVSliderWidgets.find((entry) => entry.id === studioVSliderEditorWidgetId)
        : null;
    // Validate copies: the editor's inputs keep writing into the draft's own axis / option objects,
    // so a failed Save must leave those in place (it used to swap them for cleaned copies, and every
    // fix typed after the error went nowhere).
    if (draft.kind === 'dropdown') {
        const options = (draft.options || []).map((opt) => ({
            id: String(opt.id || '').trim(),
            label: String(opt.label || opt.id || '').trim(),
            text: String(opt.text || opt.label || opt.id || '').trim()
        })).filter((opt) => opt.id && opt.text);
        if (!options.length) {
            studioVSliderEditorError('A drop-down list needs at least one option with an id and a text.');
            return;
        }
        if (new Set(options.map((opt) => opt.id)).size !== options.length) {
            studioVSliderEditorError('Two options have the same id. Each option needs its own id.');
            return;
        }
        if (draft.commit === 'expander' && (!draft.target || !draft.target.prefix)) {
            studioVSliderEditorError('Type the expander this widget writes to.');
            return;
        }
        draft.options = options;
        if (!draft.options.some((opt) => opt.id === draft.default)) draft.default = draft.options[0].id;
        // keep the chosen option when it still exists
        const kept = existing && existing.kind === 'dropdown' ? existing.value : null;
        draft.value = draft.options.some((opt) => opt.id === kept) ? kept : draft.default;
    } else {
        const perAxis = studioVSliderEditorPerAxisTargets(draft);
        const sharedPrefix = draft.target && draft.target.prefix ? String(draft.target.prefix).trim() : '';
        const oldAxes = (existing && existing.axes) || [];
        const nextValue = {};
        const axes = (draft.axes || []).map((axis, index) => {
            const stops = (axis.stops || []).map((stop) => ({
                at: studioVSliderClamp01(stop.at),
                text: String(stop.text || '').trim()
            })).filter((stop) => stop.text);
            const id = String(axis.id || '').trim() || `axis${index}`;
            let target;
            if (toPrompt) target = { kind: 'prompt' };
            else if (perAxis) target = { kind: 'expander', prefix: studioVSliderEditorAxisPrefix(draft, axis).trim() || id };
            else target = { kind: 'expander', prefix: sharedPrefix || id };
            const axisDefault = axis.default != null ? studioVSliderClamp01(axis.default) : studioVSliderMedianAt(stops);
            // carry the axis's current position across an id rename (by its place in the list)
            const old = oldAxes[index];
            nextValue[id] = old && existing && existing.value[old.id] != null ? existing.value[old.id] : axisDefault;
            return { id, label: String(axis.label || id), default: axisDefault, target, stops };
        });
        if (axes.some((axis) => axis.target.kind === 'expander' && studioVSliderIsManagedPrefix(axis.target.prefix))) {
            studioVSliderEditorError('_P and _N are the Studio\'s own expanders. Choose another expander.');
            return;
        }
        if (axes.some((axis) => axis.stops.length < 2)) {
            studioVSliderEditorError('Every axis needs at least 2 stops with a text.');
            return;
        }
        if (new Set(axes.map((axis) => axis.id)).size !== axes.length) {
            studioVSliderEditorError('Two axes have the same id. Each axis needs its own id.');
            return;
        }
        if (!toPrompt && perAxis && new Set(axes.map((axis) => axis.target.prefix)).size !== axes.length) {
            studioVSliderEditorError('Two axes write to the same expander. Give each axis its own expander.');
            return;
        }
        if (draft.kind === 'slider' && axes.length !== 1) {
            studioVSliderEditorError('A slider has exactly one axis.');
            return;
        }
        if (draft.kind === 'xypad' && axes.length !== 2) {
            studioVSliderEditorError('An XY pad has exactly two axes.');
            return;
        }
        if (draft.kind === 'star' && (axes.length < 2 || axes.length > STUDIO_VSLIDER_STAR_MAX_AXES)) {
            studioVSliderEditorError(`A star has 2 to ${STUDIO_VSLIDER_STAR_MAX_AXES} axes.`);
            return;
        }
        draft.axes = axes;
        draft.value = nextValue;
        if (!toPrompt && !perAxis) draft.target = { kind: 'expander', prefix: draft.axes[0].target.prefix };
        if (perAxis) delete draft.target;
    }
    const normalized = normalizeStudioVSliderList([draft]);
    if (!normalized.length) {
        studioVSliderEditorError('The widget is not complete. Check its axes or options.');
        return;
    }
    const widget = normalized[0];
    const existingIndex = existing ? studioVSliderWidgets.indexOf(existing) : -1;
    if (existingIndex >= 0) studioVSliderWidgets[existingIndex] = widget;
    else studioVSliderWidgets.push(widget);
    studioVSliderStampForgeData(getStudioVSliderSnapshot());
    studioVSliderCloseEditor();
    studioVSliderOpenWindow();
    showGlassToast('success', 'vSlider', existingIndex >= 0 ? 'Widget updated' : 'Widget added', false, 1800, '<i class="fas fa-check"></i>');
}

function studioVSliderWatchToolClose(el) {
    if (!el || studioVSliderCloseObserver) return;
    studioVSliderCloseObserver = new MutationObserver(() => {
        if (el.classList.contains('hidden') && !el.classList.contains('minimised') && !el.classList.contains('minimising')) {
            studioVSliderClearSession({ closeEditor: true, fromHide: true });
            const editor = document.getElementById('studioVSliderEditorTool');
            if (editor && !editor.classList.contains('hidden') && !editor.classList.contains('minimised')) {
                // closeModal: public/scripts/comp/modalUtils.js
                closeModal(editor);
            }
        }
    });
    studioVSliderCloseObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
}

function studioVSliderInit() {
    if (studioVSliderWired) return;
    const el = document.getElementById('studioVSliderTool');
    if (!el) return;
    studioVSliderWired = true;
    // transientWindowsWithPositions / linkToolWindowToParent / addResizeHandles: public/scripts/comp/modalUtils.js
    transientWindowsWithPositions.add('studio-vslider-tool');
    transientWindowsWithPositions.add('studio-vslider-editor');
    linkToolWindowToParent(el, document.getElementById('manualModal'));
    if (!el.querySelector('.resize-handle')) addResizeHandles(el);
    studioVSliderWatchToolClose(el);

    const editorEl = document.getElementById('studioVSliderEditorTool');
    if (editorEl) {
        linkToolWindowToParent(editorEl, document.getElementById('manualModal'));
        if (!editorEl.querySelector('.resize-handle')) addResizeHandles(editorEl);
    }

    const closeBtn = document.getElementById('studioVSliderCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            studioVSliderClearSession({ closeEditor: true });
            // closeModal: public/scripts/comp/modalUtils.js
            closeModal(el);
        });
    }
    const minimizeBtn = el.querySelector('.minimize-btn');
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            // Ensure taskbar anchor exists before the global minimize handler animates
            // getOrCreateTaskbarItem / setMinimizeTargetVariables / debouncedUpdateTaskbarWindows:
            // public/scripts/comp/modalUtils.js
            const item = getOrCreateTaskbarItem(el);
            if (item) setMinimizeTargetVariables(el, item);
            if (typeof debouncedUpdateTaskbarWindows === 'function') debouncedUpdateTaskbarWindows();
        }, true);
    }

    const finaliseBtn = document.getElementById('studioVSliderFinaliseBtn');
    if (finaliseBtn) finaliseBtn.addEventListener('click', studioVSliderFinaliseAll);
    const revertBtn = document.getElementById('studioVSliderRevertBtn');
    if (revertBtn) revertBtn.addEventListener('click', studioVSliderRevertAll);
    const addBtn = document.getElementById('studioVSliderAddBtn');
    if (addBtn) addBtn.addEventListener('click', () => studioVSliderOpenEditor(null));

    const editorClose = document.getElementById('studioVSliderEditorCloseBtn');
    if (editorClose) editorClose.addEventListener('click', () => studioVSliderCloseEditor());
    const editorCancel = document.getElementById('studioVSliderEditorCancelBtn');
    if (editorCancel) editorCancel.addEventListener('click', () => studioVSliderCloseEditor());
    const editorSave = document.getElementById('studioVSliderEditorSaveBtn');
    if (editorSave) editorSave.addEventListener('click', studioVSliderSaveEditor);

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
    window.studioVSliderBlendAxis = studioVSliderBlendAxis;
}
