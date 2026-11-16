/**
 * studioModel part - Session (#860 migration): the Studio calls DreamStudio's Session part needs, added
 * with studioModel.extend. Only this file touches the desktop form for them.
 *
 *   studioModel.workspaces() / setWorkspace(id)
 *                                       the session's target workspace (#manualWorkspaceDropdown):
 *                                       [{ id, name, color, files, active }]; a pick switches the
 *                                       workspace as the desktop's combo does (a promise)
 *   studioModel.upscaleChoices() / setUpscaleChoice('scale' | 'speed', value) / refreshUpscaleStatus()
 *                                       Upscale Each Print's choices (#manualUpscaleChoices: scale and
 *                                       delivery, the desktop's own pickers and their rows):
 *                                       { on, scale: [{ value, label, sub, radio, disabled }], speed: [...] }
 *   studioModel.money()                 the next print's Anlas (the desktop price badge's sum: the
 *                                       print plus a NovelAI upscale), the balance (free / paid), the
 *                                       24 h print count and the subscription usage:
 *                                       { price, fixed, paid, total, count, usage, usageTitle, deferred }
 *   studioModel.vsList() / vsHydrate() / vsSet(id, axis, value) / vsReset(id) / vsFinalise(id) /
 *   vsDelete(id) / vsRevertAll() / vsFinaliseAll() / vsDraft(id | null, kind) / vsSave(draft, id)
 *                                       vSlider (studioVSlider.js): the widgets as plain rows with the
 *                                       desktop's readouts, their values, the card menu's commands and
 *                                       the widget editor's draft and Save (its checks, word for word);
 *                                       vsSave answers '' or the desktop's error text
 *   studioModel.activity() / activityClear() / activityStudioOnly(on?)
 *                                       Studio Activity (studioActivityTool.js): the log newest first,
 *                                       each with the desktop preview's description, fields and Details
 *                                       text; 'activity' events say a row came or changed
 *   studioModel.quickstart(mode) / openQuickstart(mode, key)
 *                                       the empty preview's gallery: 'quickstart' (NovelAI's Quick Start
 *                                       pictures) or 'explorer' (the Explore feed), rows { key, thumb,
 *                                       label, section }; a pick opens its settings as the session
 */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;

    /* global workspaces, activeWorkspace, getStudioWorkspaceMenuItems, handleStudioMenuBarAction,
       contextMenu, refreshLocalUpscaleSelects, calculateUpscaleInfo, getDimensionsFromResolution,
       manualSelectedResolution, isCustomResolutionMode, usageToolManager, isAccountDataDeferred,
       studioVSliderWidgets, studioVSliderMarkDirty, studioVSliderRevertWidget, studioVSliderFinaliseWidget,
       studioVSliderDeleteWidget, studioVSliderRevertAll, studioVSliderFinaliseAll, studioVSliderBlendAxis,
       studioVSliderAxisStatusText, studioVSliderAxisBlendText, studioVSliderKindBadge, studioVSliderAxisNeighbors,
       studioVSliderResolveCatalogFromStudio, installStudioVSliderWidgets, studioVSliderDefaultDraft,
       studioVSliderClamp01, studioVSliderMedianAt, studioVSliderIsManagedPrefix, normalizeStudioVSliderList,
       studioVSliderStampForgeData, getStudioVSliderSnapshot, studioVSliderIsChanged, studioVSliderFooterSummary,
       studioVSliderDropdownText, STUDIO_VSLIDER_STAR_MAX_AXES,
       studioActivityEntries, studioActivityStudioOnly, studioActivityVisibleEntry, studioActivityDescription,
       studioActivityFields, studioActivityDetailsText, studioActivityCopyText, studioActivityStamp,
       STUDIO_ACTIVITY_SOURCES, STUDIO_ACTIVITY_LEVELS, studioActivitySelectedId, studioActivityRender,
       loadQuickstartPresets, applyQuickstartRequestBody, loadExplorerFeed, loadExplorerPostIntoStudio */

    const el = (id) => document.getElementById(id);
    const fn = (name) => typeof window[name] === 'function';
    const changed = (id) => M._emit('change', { id });

    // ---------------------------------------------------------------- workspace

    function workspaceList() {
        let list = [];
        try { list = Object.values(typeof workspaces !== 'undefined' && workspaces ? workspaces : {}); } catch (_) { list = []; }
        let active = '';
        try { active = typeof activeWorkspace !== 'undefined' ? activeWorkspace : ''; } catch (_) { active = ''; }
        return list.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).map((w) => ({
            id: w.id,
            name: String(w.name || w.id),
            // '' = none set (the desktop dot then shows its own default)
            color: String(w.color || ''),
            files: Number(w.fileCount) || 0,
            active: w.id === active
        }));
    }

    function setWorkspace(id) {
        if (!id || typeof handleStudioMenuBarAction !== 'function') return Promise.resolve(false);
        const row = (typeof getStudioWorkspaceMenuItems === 'function' ? getStudioWorkspaceMenuItems() : []).find((r) => r.value === id);
        if (!row) return Promise.resolve(false);
        let out;
        try { out = handleStudioMenuBarAction(row.action, M._el('manualWorkspaceDropdownBtn'), row); } catch (err) { console.warn('[studioModel] workspace', err); }
        // the switch itself is selectManualWorkspace's (async): the views read again once it is over
        return Promise.resolve(out).then(() => new Promise((r) => setTimeout(r, 400))).then(() => { changed('workspace'); return true; });
    }

    // ---------------------------------------------------------------- upscale choices

    /** The desktop picker on a button (contextMenu.attachPickerMenu): its rows as they are now. */
    function picker(btnId) {
        const btn = el(btnId);
        const cfg = btn && typeof contextMenu !== 'undefined' && contextMenu && contextMenu.clickMenuConfigs && contextMenu.clickMenuConfigs[btn.dataset.clickMenu];
        if (!cfg) return null;
        try { if (typeof cfg.beforeShow === 'function') cfg.beforeShow(btn); } catch (_) { return null; }
        const items = [];
        (cfg.sections || []).forEach((s) => (s.items || []).forEach((it) => { if (it && !it.separator) items.push(it); }));
        return { btn, cfg, items };
    }

    const val = (v) => { try { return typeof v === 'function' ? v() : v; } catch (_) { return undefined; } };

    function upscaleChoices() {
        const up = el('manualUpscale');
        const rows = (id) => {
            const p = picker(id);
            return p ? p.items.map((it) => ({ value: it.value, label: String(it.text || it.value), sub: String(it.subtext || ''), radio: !!it.checked, disabled: !!val(it.disabled) })) : [];
        };
        return { on: !!(up && up.getAttribute('data-state') === 'on'), available: !!(up && !up.disabled), scale: rows('manualUpscaleScaleBtn'), speed: rows('manualUpscaleSpeedBtn') };
    }

    function setUpscaleChoice(kind, value) {
        const p = picker(kind === 'speed' ? 'manualUpscaleSpeedBtn' : 'manualUpscaleScaleBtn');
        const item = p && p.items.find((it) => String(it.value) === String(value));
        if (!item || val(item.disabled)) return false;
        try { p.cfg.onAction('picker-select', p.btn, item); } catch (err) { console.warn('[studioModel] upscale choice', err); return false; }
        changed('upscale');
        return true;
    }

    /** Asks the local upscale worker what it has (the 8x scale comes with a worker that can). */
    function refreshUpscaleStatus() {
        if (typeof refreshLocalUpscaleSelects !== 'function') return Promise.resolve();
        return Promise.resolve(refreshLocalUpscaleSelects()).catch(() => {});
    }

    // ---------------------------------------------------------------- Anlas, balance, usage

    function printSize() {
        let width = 1024;
        let height = 1024;
        try {
            const res = typeof manualSelectedResolution !== 'undefined' ? manualSelectedResolution : '';
            if (typeof isCustomResolutionMode === 'function' && isCustomResolutionMode(res)) {
                width = parseInt(el('manualWidth') && el('manualWidth').value, 10) || 1024;
                height = parseInt(el('manualHeight') && el('manualHeight').value, 10) || 1024;
            } else if (res && typeof getDimensionsFromResolution === 'function') {
                const d = getDimensionsFromResolution(res);
                if (d) { width = d.width; height = d.height; }
            }
        } catch (_) { /* the default area */ }
        return { width, height };
    }

    const num = (id) => { const e = el(id); const n = e ? Number(String(e.textContent).replace(/[^\d.-]/g, '')) : NaN; return Number.isFinite(n) ? n : null; };

    function money() {
        // the price badge's sum (updateManualPriceDisplay): the print, and a NovelAI upscale on top
        let price = M.cost();
        try {
            const up = el('manualUpscale');
            const speed = el('manualUpscaleSpeed');
            const local = speed && (speed.value === 'fast' || speed.value === 'slow');
            if (up && up.getAttribute('data-state') === 'on' && !local && typeof calculateUpscaleInfo === 'function') {
                const s = printSize();
                const info = calculateUpscaleInfo(s.width, s.height);
                if (info && info.available) price += Number(info.cost) || 0;
            }
        } catch (_) { /* the print alone */ }
        let deferred = false;
        try { deferred = typeof isAccountDataDeferred === 'function' && !!isAccountDataDeferred(); } catch (_) { deferred = false; }
        let usage = '';
        let usageTitle = '';
        try {
            if (typeof usageToolManager !== 'undefined' && usageToolManager && typeof usageToolManager.getSnapshot === 'function') {
                const snap = usageToolManager.getSnapshot();
                usage = snap && snap.isOpus ? String(snap.compactLabel || '') : '';
                usageTitle = snap ? String(snap.title || '') : '';
            }
        } catch (_) { /* none */ }
        const fixed = num('manualBalanceFixed');
        const paid = num('manualBalancePaid');
        return { price, fixed, paid, total: fixed == null && paid == null ? null : (fixed || 0) + (paid || 0), count: num('manualGenCount'), usage, usageTitle, deferred };
    }

    // ---------------------------------------------------------------- vSlider

    const vsReady = () => typeof studioVSliderWidgets !== 'undefined' && Array.isArray(studioVSliderWidgets);
    const vsFind = (id) => (vsReady() ? studioVSliderWidgets.find((w) => w.id === id) : null);
    const clone = (v) => JSON.parse(JSON.stringify(v));

    /** The widgets of the print, read again from Studio when the session list is empty (as the tool's opening does). */
    let hydratedFrom = null;
    function vsHydrate() {
        wireActivity();
        if (!vsReady() || studioVSliderWidgets.length || typeof studioVSliderResolveCatalogFromStudio !== 'function') return;
        try {
            const list = studioVSliderResolveCatalogFromStudio(null);
            // once per list: one that comes to nothing must not be installed over and over
            if (list && list.length && list !== hydratedFrom) { hydratedFrom = list; installStudioVSliderWidgets(list, { open: false }); }
        } catch (err) { console.warn('[studioModel] vSlider', err); }
    }

    function vsAxis(w, axis) {
        const v = studioVSliderClamp01(w.value[axis.id]);
        const st = studioVSliderAxisNeighbors(axis.stops, v);
        return {
            id: axis.id,
            label: axis.label,
            value: v,
            def: axis.default,
            stops: axis.stops.map((s) => ({ at: s.at, text: s.text })),
            status: studioVSliderAxisStatusText(axis, v),
            nearer: st && st.nearer ? String(st.nearer.text) : '',
            blend: studioVSliderAxisBlendText(axis, v),
            first: axis.stops.length ? String(axis.stops.slice().sort((a, b) => a.at - b.at)[0].text) : '',
            last: axis.stops.length ? String(axis.stops.slice().sort((a, b) => b.at - a.at)[0].text) : ''
        };
    }

    function vsList() {
        if (!vsReady()) return null;
        const summary = typeof studioVSliderFooterSummary === 'function' ? studioVSliderFooterSummary() : { text: '' };
        return {
            note: summary.text || '',
            dirty: studioVSliderWidgets.some((w) => w.dirty),
            widgets: studioVSliderWidgets.map((w) => ({
                id: w.id,
                kind: w.kind,
                title: w.title,
                badge: studioVSliderKindBadge(w),
                dirty: !!w.dirty,
                value: w.kind === 'dropdown' ? w.value : null,
                options: w.kind === 'dropdown' ? w.options.map((o) => ({ id: o.id, label: o.label, text: o.text })) : null,
                text: w.kind === 'dropdown' ? studioVSliderDropdownText(w) : '',
                axes: w.kind === 'dropdown' ? [] : w.axes.map((a) => vsAxis(w, a))
            }))
        };
    }

    /** A value moved (a slider's 0 - 1, or a drop-down list's option id): the desktop's own mark-dirty. */
    function vsSet(id, axisId, value) {
        const w = vsFind(id);
        if (!w || typeof studioVSliderMarkDirty !== 'function') return false;
        studioVSliderMarkDirty(id, (x) => {
            if (x.kind === 'dropdown') x.value = String(value);
            else x.value[axisId] = studioVSliderClamp01(value);
        });
        return true;
    }

    const vsRun = (name, ...args) => { if (!fn(name)) return false; try { window[name](...args); } catch (err) { console.warn('[studioModel] vSlider', name, err); return false; } changed('vslider'); return true; };

    /** The widget editor's draft: a copy of a widget, or a new one of `kind` (the editor's defaults). */
    function vsDraft(id, kind) {
        const w = id ? vsFind(id) : null;
        if (w) {
            const d = clone(w);
            if (!d.target && d.axes && d.axes[0]) d.target = clone(d.axes[0].target);
            return d;
        }
        return typeof studioVSliderDefaultDraft === 'function' ? studioVSliderDefaultDraft(kind || 'slider') : null;
    }

    const perAxisTargets = (d) => (d.kind === 'xypad' || d.kind === 'star') && !(d.target && d.target.kind === 'prompt');
    const axisPrefix = (d, axis) => (axis.target && axis.target.kind === 'expander' && axis.target.prefix ? axis.target.prefix : axis.id || '');

    /** Save of the widget editor (studioVSliderSaveEditor), its checks and messages as they are there. */
    function vsSave(draft0, id) {
        if (!vsReady() || !draft0) return 'vSlider is not ready.';
        const draft = clone(draft0);
        const toPrompt = !!(draft.target && draft.target.kind === 'prompt');
        draft.commit = toPrompt ? 'prompt' : 'expander';
        const existing = id ? vsFind(id) : null;
        if (draft.kind === 'dropdown') {
            const options = (draft.options || []).map((opt) => ({
                id: String(opt.id || '').trim(),
                label: String(opt.label || opt.id || '').trim(),
                text: String(opt.text || opt.label || opt.id || '').trim()
            })).filter((opt) => opt.id && opt.text);
            if (!options.length) return 'A drop-down list needs at least one option with an id and a text.';
            if (new Set(options.map((opt) => opt.id)).size !== options.length) return 'Two options have the same id. Each option needs its own id.';
            if (draft.commit === 'expander' && (!draft.target || !draft.target.prefix)) return 'Type the expander this widget writes to.';
            draft.options = options;
            if (!draft.options.some((opt) => opt.id === draft.default)) draft.default = draft.options[0].id;
            const kept = existing && existing.kind === 'dropdown' ? existing.value : null;
            draft.value = draft.options.some((opt) => opt.id === kept) ? kept : draft.default;
        } else {
            const perAxis = perAxisTargets(draft);
            const sharedPrefix = draft.target && draft.target.prefix ? String(draft.target.prefix).trim() : '';
            const oldAxes = (existing && existing.axes) || [];
            const nextValue = {};
            const axes = (draft.axes || []).map((axis, index) => {
                const stops = (axis.stops || []).map((stop) => ({ at: studioVSliderClamp01(stop.at), text: String(stop.text || '').trim() })).filter((stop) => stop.text);
                const aid = String(axis.id || '').trim() || `axis${index}`;
                let target;
                if (toPrompt) target = { kind: 'prompt' };
                else if (perAxis) target = { kind: 'expander', prefix: axisPrefix(draft, axis).trim() || aid };
                else target = { kind: 'expander', prefix: sharedPrefix || aid };
                const axisDefault = axis.default != null ? studioVSliderClamp01(axis.default) : studioVSliderMedianAt(stops);
                const old = oldAxes[index];
                nextValue[aid] = old && existing && existing.value[old.id] != null ? existing.value[old.id] : axisDefault;
                return { id: aid, label: String(axis.label || aid), default: axisDefault, target, stops };
            });
            const max = typeof STUDIO_VSLIDER_STAR_MAX_AXES !== 'undefined' ? STUDIO_VSLIDER_STAR_MAX_AXES : 8;
            if (axes.some((axis) => axis.target.kind === 'expander' && studioVSliderIsManagedPrefix(axis.target.prefix))) return '_P and _N are the Studio\'s own expanders. Choose another expander.';
            if (axes.some((axis) => axis.stops.length < 2)) return 'Every axis needs at least 2 stops with a text.';
            if (new Set(axes.map((axis) => axis.id)).size !== axes.length) return 'Two axes have the same id. Each axis needs its own id.';
            if (!toPrompt && perAxis && new Set(axes.map((axis) => axis.target.prefix)).size !== axes.length) return 'Two axes write to the same expander. Give each axis its own expander.';
            if (draft.kind === 'slider' && axes.length !== 1) return 'A slider has exactly one axis.';
            if (draft.kind === 'xypad' && axes.length !== 2) return 'An XY pad has exactly two axes.';
            if (draft.kind === 'star' && (axes.length < 2 || axes.length > max)) return `A star has 2 to ${max} axes.`;
            draft.axes = axes;
            draft.value = nextValue;
            if (!toPrompt && !perAxis) draft.target = { kind: 'expander', prefix: draft.axes[0].target.prefix };
            if (perAxis) delete draft.target;
        }
        const normalized = normalizeStudioVSliderList([draft]);
        if (!normalized.length) return 'The widget is not complete. Check its axes or options.';
        const widget = normalized[0];
        const at = existing ? studioVSliderWidgets.indexOf(existing) : -1;
        if (at >= 0) studioVSliderWidgets[at] = widget;
        else studioVSliderWidgets.push(widget);
        studioVSliderStampForgeData(getStudioVSliderSnapshot());
        changed('vslider');
        return '';
    }

    // ---------------------------------------------------------------- Studio Activity

    const actReady = () => typeof studioActivityEntries !== 'undefined' && Array.isArray(studioActivityEntries);

    function activity() {
        wireActivity();
        if (!actReady()) return null;
        const levels = typeof STUDIO_ACTIVITY_LEVELS !== 'undefined' ? STUDIO_ACTIVITY_LEVELS : {};
        const sources = typeof STUDIO_ACTIVITY_SOURCES !== 'undefined' ? STUDIO_ACTIVITY_SOURCES : {};
        const shown = studioActivityEntries.filter((e) => studioActivityVisibleEntry(e)).reverse();
        return {
            total: studioActivityEntries.length,
            studioOnly: !!studioActivityStudioOnly,
            rows: shown.map((e) => {
                const lv = levels[e.level] || levels.info || {};
                return {
                    id: e.id,
                    level: e.level || 'info',
                    levelLabel: lv.label || '',
                    icon: lv.icon || '',
                    action: e.running ? `${e.action} (running)` : e.action,
                    title: `${e.action}, ${sources[e.source] || 'Agent'}`,
                    when: studioActivityStamp(e.at),
                    source: sources[e.source] || 'Agent',
                    actor: e.actor || 'N/A',
                    description: studioActivityDescription(e),
                    fields: studioActivityFields(e),
                    details: () => studioActivityDetailsText(e),
                    copy: () => studioActivityCopyText(e)
                };
            })
        };
    }

    function activityClear() {
        if (!actReady()) return;
        studioActivityEntries.length = 0;
        try { studioActivitySelectedId = 0; } catch (_) { /* the desktop list picks again */ }
        M._emit('activity', {});
    }

    function activityStudioOnly(on) {
        if (!actReady()) return false;
        if (typeof on === 'boolean') {
            try { studioActivityStudioOnly = on; } catch (_) { return false; }
            const box = el('studioActivityStudioOnly');
            if (box) box.checked = on;
            M._emit('activity', {});
        }
        return !!studioActivityStudioOnly;
    }

    // a row comes (or a running one finishes): the desktop renders only while its window is open; the
    // phone page hears of it here (the two noters are called by name, through the window's properties)
    function wireActivity() {
        ['noteStudioActivityChange', 'noteStudioActivityMcp'].forEach((name) => {
            const orig = window[name];
            if (typeof orig !== 'function' || orig._wmSession) return;
            const wrapped = function () { const r = orig.apply(this, arguments); try { M._emit('activity', {}); } catch (_) { /* listeners */ } return r; };
            wrapped._wmSession = true;
            window[name] = wrapped;
        });
        // a vSlider list sent in (Change JSON, MCP, a print opened): the page reads the widgets again
        const install = window.installStudioVSliderWidgets;
        if (typeof install === 'function' && !install._wmSession) {
            const wrapped = function () { const r = install.apply(this, arguments); try { changed('vslider'); } catch (_) { /* listeners */ } return r; };
            wrapped._wmSession = true;
            window.installStudioVSliderWidgets = wrapped;
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireActivity, { once: true });
    else wireActivity();

    // ---------------------------------------------------------------- Quick Start / Explorer

    const qsRows = { quickstart: null, explorer: null };

    function quickstart(mode) {
        if (mode === 'explorer') {
            if (typeof loadExplorerFeed !== 'function') return Promise.resolve([]);
            return Promise.resolve(loadExplorerFeed()).then((rows) => {
                qsRows.explorer = rows || [];
                return qsRows.explorer.map((r) => ({ key: String(r.id || ''), thumb: r.thumbnailUrl || '', label: r.title || 'Load into Studio', section: r.period === 'month' ? 'Top for Month' : '' }));
            }).catch(() => []);
        }
        if (typeof loadQuickstartPresets !== 'function') return Promise.resolve([]);
        return Promise.resolve(loadQuickstartPresets()).then((rows) => {
            qsRows.quickstart = rows || [];
            return qsRows.quickstart.map((r) => ({ key: r.file, thumb: r.tiny || r.src, full: r.src, label: r.prompt ? String(r.prompt).slice(0, 140) : 'Load quickstart prompt', section: '' }));
        }).catch(() => []);
    }

    function openQuickstart(mode, key) {
        let p = null;
        if (mode === 'explorer') { if (typeof loadExplorerPostIntoStudio === 'function' && key) p = loadExplorerPostIntoStudio(key); } else {
            const row = (qsRows.quickstart || []).find((r) => r.file === key);
            if (row && typeof applyQuickstartRequestBody === 'function') p = applyQuickstartRequestBody(row);
        }
        if (!p) return Promise.resolve(false);
        return Promise.resolve(p).then(() => { changed('session'); return true; }).catch(() => false);
    }

    M.extend({
        workspaces: workspaceList,
        setWorkspace,
        upscaleChoices,
        setUpscaleChoice,
        refreshUpscaleStatus,
        money,
        vsList,
        vsHydrate,
        vsSet,
        vsReset: (id) => vsRun('studioVSliderRevertWidget', id),
        vsFinalise: (id) => vsRun('studioVSliderFinaliseWidget', id),
        vsDelete: (id) => vsRun('studioVSliderDeleteWidget', id),
        vsRevertAll: () => vsRun('studioVSliderRevertAll'),
        vsFinaliseAll: () => vsRun('studioVSliderFinaliseAll'),
        vsDraft,
        vsSave,
        activity,
        activityClear,
        activityStudioOnly,
        quickstart,
        openQuickstart
    });
})();
