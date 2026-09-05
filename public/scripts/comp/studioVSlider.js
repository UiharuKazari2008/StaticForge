/**
 * Studio vSlider — AI intensity widgets (slider / xypad / star / dropdown).
 * public/scripts/comp/studioChangeJson.js
 * public/scripts/comp/requestBodyReplacementsModal.js
 * public/scripts/comp/dropdown.js
 * public/scripts/comp/modalUtils.js
 * public/scripts/comp/textareaUtils.js
 * public/scripts/comp/contextMenu.js
 * Drag is preview. Generate applies live blends into expanders.
 * Finalise bakes !prefix → literal prompt text and removes the widget.
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

/** Live apply into expanders for Generate/compile — keeps widgets for remixing. */
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
    showGlassToast('success', 'vSlider', `Finalised “${widget.title}” into prompt`, false, 2200, '<i class="fas fa-check"></i>');
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
    showGlassToast('success', 'vSlider', `Finalised ${count} widget${count === 1 ? '' : 's'} into prompt`, false, 2200, '<i class="fas fa-check"></i>');
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

function studioVSliderRevertWidget(widgetId) {
    const widget = studioVSliderWidgets.find((entry) => entry.id === widgetId);
    if (!widget) return;
    widget.value = studioVSliderClone(studioVSliderWidgetDefaultsValue(widget));
    widget.dirty = true;
    studioVSliderRenderCards();
}

function studioVSliderRevertAll() {
    studioVSliderWidgets.forEach((widget) => {
        widget.value = studioVSliderClone(studioVSliderWidgetDefaultsValue(widget));
        widget.dirty = true;
    });
    studioVSliderRenderCards();
}

function studioVSliderDeleteWidget(widgetId) {
    studioVSliderWidgets = studioVSliderWidgets.filter((entry) => entry.id !== widgetId);
    studioVSliderStampForgeData(getStudioVSliderSnapshot());
    studioVSliderRenderCards();
}

function studioVSliderClearSession(options) {
    const opts = options || {};
    studioVSliderWidgets = [];
    // Do NOT stamp null onto preview/lastGeneration forge_data — that poisons
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
    const hasWidgets = studioVSliderWidgets.length > 0;
    const dirty = studioVSliderWidgets.some((widget) => widget.dirty);
    const finaliseBtn = document.getElementById('studioVSliderFinaliseBtn');
    const revertBtn = document.getElementById('studioVSliderRevertBtn');
    // Finalise all bakes every remaining widget (permanent), not only dirty
    if (finaliseBtn) finaliseBtn.disabled = !hasWidgets;
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

function studioVSliderAttachCardContextMenu(card, widget) {
    if (!card || !widget) return;
    // contextMenu: public/scripts/comp/contextMenu.js
    if (card.hasAttribute('data-context-menu')) contextMenu.detachFromElement(card);
    const widgetId = widget.id;
    contextMenu.attachToElement(card, {
        sections: [{
            type: 'list',
            items: [
                { icon: 'fas fa-pen', text: 'Edit', action: 'edit' },
                { icon: 'fas fa-plus', text: 'Add new', action: 'add' },
                { icon: 'fas fa-undo', text: 'Revert to default', action: 'revert' },
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
                <div>No vSlider widgets yet.</div>
                <button type="button" class="btn-primary" data-vslider-add-empty>
                    <i class="fas fa-plus"></i> Add widget
                </button>
                <div class="form-hint">Or install via Change JSON / MCP <code>vSlider</code>.</div>
            </div>`;
        const addBtn = list.querySelector('[data-vslider-add-empty]');
        if (addBtn) addBtn.addEventListener('click', () => studioVSliderOpenEditor(null));
        studioVSliderSyncFooter();
        studioVSliderRefreshScrollbar();
        return;
    }
    list.innerHTML = studioVSliderWidgets.map(studioVSliderRenderCard).join('');
    studioVSliderWidgets.forEach((widget) => {
        const card = list.querySelector(`[data-vslider-card="${widget.id}"]`);
        if (!card) return;
        studioVSliderWireCard(widget, card);
        studioVSliderAttachCardContextMenu(card, widget);
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

function studioVSliderRefreshEditorScrollbar() {
    const shell = document.querySelector('#studioVSliderEditorTool .vslider-scroll-shell[data-custom-scrollbar]');
    if (!shell) return;
    if (shell.classList.contains('has-custom-scrollbar')) customScrollbar.updateScrollbar(shell);
    else customScrollbar.forceReinit(shell);
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
    return studioVSliderEditorWidgetId ? `edit · ${draft.kind}` : `new · ${draft.kind}`;
}

function studioVSliderRenderEditor() {
    const body = document.getElementById('studioVSliderEditorBody');
    const kindLabel = document.getElementById('studioVSliderEditorKindLabel');
    if (!body || !studioVSliderEditorDraft) return;
    if (kindLabel) kindLabel.textContent = studioVSliderEditorKindBadge();
    const draft = studioVSliderEditorDraft;
    const targetKind = draft.target && draft.target.kind === 'prompt' ? 'prompt' : 'expander';
    const prefix = draft.target && draft.target.prefix ? draft.target.prefix : '';
    const kindOptions = ['slider', 'xypad', 'star', 'dropdown'].map((kind) => `
        <div class="custom-dropdown-option${draft.kind === kind ? ' selected' : ''}"
            data-vslider-editor-kind="${kind}">${kind}</div>
    `).join('');
    const targetOptions = `
        <div class="custom-dropdown-option${targetKind === 'expander' ? ' selected' : ''}"
            data-vslider-editor-target-kind="expander">expander</div>
        <div class="custom-dropdown-option${targetKind === 'prompt' ? ' selected' : ''}"
            data-vslider-editor-target-kind="prompt">prompt</div>
    `;

    let listsHtml = '';
    if (draft.kind === 'dropdown') {
        const rows = (draft.options || []).map((opt, index) => `
            <div class="vslider-editor-list-row vslider-editor-option-row" data-vslider-editor-option="${index}">
                <input type="text" data-field="id" value="${studioVSliderEscape(opt.id)}" placeholder="id">
                <input type="text" data-field="label" value="${studioVSliderEscape(opt.label)}" placeholder="label">
                <input type="text" data-field="text" value="${studioVSliderEscape(opt.text)}" placeholder="text">
                <button type="button" class="btn-danger btn-small" data-vslider-editor-remove-option title="Remove">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
        listsHtml = `
            <div class="vslider-editor-axis">
                <div class="vslider-editor-axis-title">Options</div>
                <div class="vslider-editor-list" data-vslider-editor-options>${rows}</div>
                <div class="vslider-editor-list-actions">
                    <button type="button" class="btn-secondary btn-small" data-vslider-editor-add-option>
                        <i class="fas fa-plus"></i> Add option
                    </button>
                </div>
            </div>
        `;
    } else {
        listsHtml = (draft.axes || []).map((axis, axisIndex) => {
            const stopRows = (axis.stops || []).map((stop, stopIndex) => `
                <div class="vslider-editor-list-row" data-vslider-editor-stop="${stopIndex}">
                    <input type="number" min="0" max="1" step="0.01" data-field="at"
                        value="${studioVSliderEscape(stop.at)}" title="at (0–1)">
                    <input type="text" data-field="text" value="${studioVSliderEscape(stop.text)}" placeholder="text">
                    <button type="button" class="btn-danger btn-small" data-vslider-editor-remove-stop title="Remove">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `).join('');
            return `
                <div class="vslider-editor-axis" data-vslider-editor-axis="${axisIndex}">
                    <div class="vslider-editor-axis-title">Axis ${axisIndex + 1}</div>
                    <div class="vslider-editor-row">
                        <label>Id</label>
                        <input type="text" data-vslider-editor-axis-id value="${studioVSliderEscape(axis.id)}">
                    </div>
                    <div class="vslider-editor-row">
                        <label>Label</label>
                        <input type="text" data-vslider-editor-axis-label value="${studioVSliderEscape(axis.label)}">
                    </div>
                    <div class="vslider-editor-list" data-vslider-editor-stops>${stopRows}</div>
                    <div class="vslider-editor-list-actions">
                        <button type="button" class="btn-secondary btn-small" data-vslider-editor-add-stop>
                            <i class="fas fa-plus"></i> Add stop
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        if (draft.kind === 'star') {
            listsHtml += `
                <div class="vslider-editor-list-actions">
                    <button type="button" class="btn-secondary btn-small" data-vslider-editor-add-axis
                        ${(draft.axes || []).length >= STUDIO_VSLIDER_STAR_MAX_AXES ? 'disabled' : ''}>
                        <i class="fas fa-plus"></i> Add axis
                    </button>
                    <button type="button" class="btn-secondary btn-small" data-vslider-editor-remove-axis
                        ${(draft.axes || []).length <= 2 ? 'disabled' : ''}>
                        <i class="fas fa-minus"></i> Remove axis
                    </button>
                </div>
            `;
        }
    }

    body.innerHTML = `
        <div class="vslider-editor-row">
            <label>Kind</label>
            <div class="custom-dropdown dark" data-vslider-editor-kind-dd>
                <button type="button" class="custom-dropdown-btn hover-show colored">
                    <span data-vslider-editor-kind-label>${studioVSliderEscape(draft.kind)}</span>
                </button>
                <div class="custom-dropdown-menu hidden">${kindOptions}</div>
            </div>
        </div>
        <div class="vslider-editor-row">
            <label>Title</label>
            <input type="text" data-vslider-editor-title value="${studioVSliderEscape(draft.title)}">
        </div>
        <div class="vslider-editor-row">
            <label>Target</label>
            <div class="custom-dropdown dark" data-vslider-editor-target-dd>
                <button type="button" class="custom-dropdown-btn hover-show colored">
                    <span data-vslider-editor-target-label>${studioVSliderEscape(targetKind)}</span>
                </button>
                <div class="custom-dropdown-menu hidden">${targetOptions}</div>
            </div>
        </div>
        <div class="vslider-editor-row${targetKind === 'prompt' ? ' hidden' : ''}" data-vslider-editor-prefix-row>
            <label>Expander prefix</label>
            <input type="text" data-vslider-editor-prefix value="${studioVSliderEscape(prefix)}" placeholder="body">
        </div>
        ${listsHtml}
    `;
    studioVSliderWireEditor(body);
    studioVSliderRefreshEditorScrollbar();
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
            const prefix = prefixInput.value.trim();
            draft.target = prefix
                ? { kind: 'expander', prefix }
                : { kind: 'expander', prefix: '' };
            (draft.axes || []).forEach((axis) => {
                axis.target = draft.target && draft.target.prefix
                    ? studioVSliderClone(draft.target)
                    : axis.target;
            });
        });
    }

    const kindDd = body.querySelector('[data-vslider-editor-kind-dd]');
    if (kindDd) {
        const btn = kindDd.querySelector('.custom-dropdown-btn');
        const menu = kindDd.querySelector('.custom-dropdown-menu');
        // setupDropdown: public/scripts/comp/dropdown.js
        setupDropdown(kindDd, btn, menu, () => {}, () => draft.kind, { preventFocusTransfer: true });
        menu.querySelectorAll('[data-vslider-editor-kind]').forEach((opt) => {
            opt.addEventListener('click', () => {
                const kind = opt.getAttribute('data-vslider-editor-kind');
                const keptId = draft.id;
                const keptTitle = draft.title;
                studioVSliderEditorDraft = studioVSliderDefaultDraft(kind);
                studioVSliderEditorDraft.id = keptId;
                if (keptTitle) studioVSliderEditorDraft.title = keptTitle;
                // closeDropdown: public/scripts/comp/dropdown.js
                closeDropdown(menu, btn);
                studioVSliderRenderEditor();
            });
        });
    }

    const targetDd = body.querySelector('[data-vslider-editor-target-dd]');
    if (targetDd) {
        const btn = targetDd.querySelector('.custom-dropdown-btn');
        const menu = targetDd.querySelector('.custom-dropdown-menu');
        setupDropdown(targetDd, btn, menu, () => {}, () => (draft.target && draft.target.kind) || 'expander', { preventFocusTransfer: true });
        menu.querySelectorAll('[data-vslider-editor-target-kind]').forEach((opt) => {
            opt.addEventListener('click', () => {
                const kind = opt.getAttribute('data-vslider-editor-target-kind');
                if (kind === 'prompt') draft.target = { kind: 'prompt' };
                else {
                    const prefixEl = body.querySelector('[data-vslider-editor-prefix]');
                    const prefix = (prefixEl && prefixEl.value.trim()) || 'body';
                    draft.target = { kind: 'expander', prefix };
                }
                draft.commit = kind === 'prompt' ? 'prompt' : 'expander';
                closeDropdown(menu, btn);
                studioVSliderRenderEditor();
            });
        });
    }

    body.querySelectorAll('[data-vslider-editor-axis]').forEach((axisEl) => {
        const axisIndex = Number(axisEl.getAttribute('data-vslider-editor-axis'));
        const axis = draft.axes[axisIndex];
        if (!axis) return;
        const idInput = axisEl.querySelector('[data-vslider-editor-axis-id]');
        const labelInput = axisEl.querySelector('[data-vslider-editor-axis-label]');
        if (idInput) idInput.addEventListener('input', () => { axis.id = idInput.value.trim() || axis.id; });
        if (labelInput) labelInput.addEventListener('input', () => { axis.label = labelInput.value; });
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
                removeBtn.addEventListener('click', () => {
                    if (axis.stops.length <= 2) {
                        showGlassToast('info', 'vSlider', 'Need at least 2 stops', false, 2000, '<i class="fas fa-info-circle"></i>');
                        return;
                    }
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
                target: draft.target ? studioVSliderClone(draft.target) : { kind: 'expander', prefix: `axis${n}` },
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
            removeBtn.addEventListener('click', () => {
                if (draft.options.length <= 1) {
                    showGlassToast('info', 'vSlider', 'Need at least 1 option', false, 2000, '<i class="fas fa-info-circle"></i>');
                    return;
                }
                draft.options.splice(index, 1);
                studioVSliderRenderEditor();
            });
        }
    });
    const addOpt = body.querySelector('[data-vslider-editor-add-option]');
    if (addOpt) {
        addOpt.addEventListener('click', () => {
            const id = `opt${(draft.options || []).length + 1}`;
            draft.options.push({ id, label: id, text: id });
            studioVSliderRenderEditor();
        });
    }
}

function studioVSliderSaveEditor() {
    const draft = studioVSliderEditorDraft;
    if (!draft) return;
    if (draft.kind === 'dropdown') {
        draft.options = (draft.options || []).map((opt) => ({
            id: String(opt.id || '').trim(),
            label: String(opt.label || opt.id || '').trim(),
            text: String(opt.text || opt.label || opt.id || '').trim()
        })).filter((opt) => opt.id && opt.text);
        if (!draft.options.length) {
            showGlassToast('error', 'vSlider', 'Dropdown needs at least one option', false, 2500, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        if (!draft.options.some((opt) => opt.id === draft.default)) draft.default = draft.options[0].id;
        draft.value = draft.default;
        draft.commit = draft.target && draft.target.kind === 'prompt' ? 'prompt' : 'expander';
    } else {
        draft.axes = (draft.axes || []).map((axis) => {
            const stops = (axis.stops || []).map((stop) => ({
                at: studioVSliderClamp01(stop.at),
                text: String(stop.text || '').trim()
            })).filter((stop) => stop.text);
            return {
                id: String(axis.id || '').trim() || 'axis',
                label: String(axis.label || axis.id || 'axis'),
                default: axis.default != null ? studioVSliderClamp01(axis.default) : studioVSliderMedianAt(stops),
                target: draft.target && draft.target.kind === 'prompt'
                    ? { kind: 'prompt' }
                    : (draft.target && draft.target.prefix
                        ? { kind: 'expander', prefix: String(draft.target.prefix).trim() }
                        : { kind: 'expander', prefix: String(axis.id || 'axis').trim() }),
                stops
            };
        }).filter((axis) => axis.stops.length >= 2);
        if (draft.kind === 'slider' && draft.axes.length !== 1) {
            showGlassToast('error', 'vSlider', 'Slider needs exactly 1 axis with 2+ stops', false, 2500, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        if (draft.kind === 'xypad' && draft.axes.length !== 2) {
            showGlassToast('error', 'vSlider', 'XY pad needs exactly 2 axes', false, 2500, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        if (draft.kind === 'star' && (draft.axes.length < 2 || draft.axes.length > STUDIO_VSLIDER_STAR_MAX_AXES)) {
            showGlassToast('error', 'vSlider', 'Star needs 2–8 axes', false, 2500, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }
        draft.commit = draft.target && draft.target.kind === 'prompt' ? 'prompt' : 'expander';
        if (!draft.value || typeof draft.value !== 'object') draft.value = {};
        draft.axes.forEach((axis) => {
            if (draft.value[axis.id] == null) draft.value[axis.id] = axis.default;
        });
    }
    if (draft.commit === 'expander' && (!draft.target || !draft.target.prefix)) {
        showGlassToast('error', 'vSlider', 'Expander target needs a prefix', false, 2500, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    const normalized = normalizeStudioVSliderList([draft]);
    if (!normalized.length) {
        showGlassToast('error', 'vSlider', 'Widget failed validation', false, 2500, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }
    const widget = normalized[0];
    const existingIndex = studioVSliderEditorWidgetId
        ? studioVSliderWidgets.findIndex((entry) => entry.id === studioVSliderEditorWidgetId)
        : -1;
    if (existingIndex >= 0) studioVSliderWidgets[existingIndex] = widget;
    else studioVSliderWidgets.push(widget);
    studioVSliderStampForgeData(getStudioVSliderSnapshot());
    studioVSliderCloseEditor();
    studioVSliderOpenWindow();
    studioVSliderRenderCards();
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
}
