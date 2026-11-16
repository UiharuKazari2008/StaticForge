/**
 * studioModel part - Expanders (#860 migration): the Studio calls DreamStudio's Expanders part needs, added
 * with studioModel.extend. Only this file touches the desktop form for them.
 *
 * Global expanders (prompt.config.json text_replacements, the !name expanders): the desktop Text Expanders
 * console's own server calls (mmcExpanders.js): get_text_replacements / save_text_replacements /
 * delete_text_replacement, favorites_get / favorites_add / favorites_remove; after a change the
 * text_replacements app options chunk is read again (autocomplete, Run, the token counter).
 *
 *   expLoad()                    Promise of { map: { key: string | string[] }, favs: [{ id, name, placeholder,
 *                                replacementValue, dateAdded }] }
 *   expSave(key, value)          one expander (one choice = text, several = a list)
 *   expSaveMany(map)             several at once (Import)
 *   expDelete(key)
 *   expFavAdd(key, value)        favorites_add (writes the expander too, as the server does)
 *   expFavRemove(id)             favorites_remove (the server deletes the expander as well: save it again after)
 *   expChanged()                 the client's shared copy of the expanders again
 *
 * Local expanders (Text Expanders [Embedded]: requestBodyReplacementsModal.js requestBodyReplacements, sent
 * with the request and merged with the global ones there):
 *
 *   localList()                  [{ index, name, value, extend, stages, managed }]
 *   localStages()                the stage names a rule can be limited to (index = stage number; 0 Base Layer)
 *   localAdd(rule)               { name, value, extend, stages } as the desktop's Create dialog makes it
 *   localUpdate(index, rule)     as the desktop's inline Save (managed rows are refused)
 *   localRemove(index)
 *   localGroups()                the rows Make Global offers: one per name, merged as the server merges them
 *   localMakeGlobal(names, mode, removeAfter)
 *                                expanderMakeGlobalWizard.js's save: mode 'merge' | 'replace' | 'skip' for a
 *                                name that is already global; Promise of { saved: [{ name, value, existed }],
 *                                skipped: [name] }
 */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;

    /* global requestBodyReplacements, renderRequestBodyReplacementsList, getAvailableStages, refreshAppOptionsChunk,
       ensureAppOptionsChunk, appOptionsChunkPresent */

    const toList = (v) => (Array.isArray(v) ? v.map(String) : (v == null || v === '' ? [] : [String(v)]));
    const fromList = (list) => (list.length === 1 ? list[0] : list.slice());

    // ---- the server (the desktop console's calls) -------------------------------------------------------

    function wsc() {
        const c = window.wsClient;
        if (!c || typeof c.sendMessage !== 'function' || (typeof c.isConnected === 'function' && !c.isConnected())) throw new Error('Melaton is not connected to the server.');
        return c;
    }
    async function send(type, data, banner = true) {
        const r = await wsc().sendMessage(type, data || {}, banner);
        return r && r.data && typeof r.data === 'object' && r.success === undefined ? r.data : r;
    }
    const okOf = (r) => !!(r && (r.success || (r.data && r.data.success)));
    const msgOf = (r, d) => (r && (r.error || r.message || (r.data && (r.data.error || r.data.message)))) || d;

    async function expLoad() {
        const [a, b] = await Promise.all([
            send('get_text_replacements', { page: 1, itemsPerPage: 1000000, searchTerm: '' }, false),
            send('favorites_get', {}, false).catch(() => null)
        ]);
        const f = (b && b.favorites) || (b && b.data && b.data.favorites) || {};
        return { map: (a && a.textReplacements) || {}, favs: Array.isArray(f.textReplacements) ? f.textReplacements : [] };
    }

    async function expSaveMany(map) {
        const r = await send('save_text_replacements', { textReplacements: map });
        if (!okOf(r)) throw new Error(msgOf(r, 'The expander was not saved.'));
    }

    async function expDelete(key) {
        const r = await send('delete_text_replacement', { key });
        if (!okOf(r)) throw new Error(msgOf(r, 'The expander was not deleted.'));
    }

    async function expFavAdd(key, value) {
        const item = { type: 'textReplacement', name: key, originalName: key, placeholder: key, displayName: `!${key}`, replacementValue: value, description: toList(value).join(', ') };
        const r = await send('favorites_add', { favoriteType: 'textReplacements', item });
        if (!okOf(r)) throw new Error(msgOf(r, 'The expander was not added to Favorites.'));
    }

    async function expFavRemove(id) {
        const r = await send('favorites_remove', { favoriteType: 'textReplacements', itemId: id });
        if (!okOf(r)) throw new Error(msgOf(r, 'The favorite was not removed.'));
    }

    async function expChanged() {
        if (typeof refreshAppOptionsChunk === 'function') { try { await refreshAppOptionsChunk('text_replacements'); } catch (_) { /* the list only */ } }
    }

    // ---- local expanders (the request's embedded ones) --------------------------------------------------

    const rows = () => (typeof requestBodyReplacements !== 'undefined' && Array.isArray(requestBodyReplacements) ? requestBodyReplacements : []);
    // the desktop's list again (its token bar counts follow it), then the views
    function localChanged() {
        try { if (typeof renderRequestBodyReplacementsList === 'function') renderRequestBodyReplacementsList(); } catch (_) { /* the counts only */ }
        M._emit('change', { id: 'requestBodyReplacements' });
    }
    const copyStages = (s) => (Array.isArray(s) ? s.slice() : (s && typeof s === 'object' ? { ...s } : undefined));

    function localList() {
        return rows().map((r, index) => ({ index, name: String(r.name || ''), value: Array.isArray(r.value) ? r.value.slice() : r.value, extend: !!r.extend, stages: copyStages(r.stages), managed: !!r.managed }));
    }

    function localStages() {
        try { if (typeof getAvailableStages === 'function') return getAvailableStages(); } catch (_) { /* below */ }
        return ['Base Layer'];
    }

    const clean = (rule) => ({ name: String(rule.name || '').trim(), value: rule.value, extend: !!rule.extend, stages: copyStages(rule.stages) });

    function localAdd(rule) {
        if (typeof requestBodyReplacements === 'undefined') return false;
        rows().push(clean(rule));
        localChanged();
        return true;
    }

    function localUpdate(index, rule) {
        const r = rows()[index];
        if (!r || r.managed) return false;
        const c = clean(rule);
        r.name = c.name;
        r.value = c.value;
        r.extend = c.extend;
        r.stages = c.stages;
        localChanged();
        return true;
    }

    function localRemove(index) {
        const r = rows()[index];
        if (!r || r.managed) return false;
        rows().splice(index, 1);
        localChanged();
        return true;
    }

    const hasStages = (s) => (s == null ? false : Array.isArray(s) ? s.length > 0 : typeof s === 'object' && (s.start !== undefined || s.end !== undefined));

    /** expanderMakeGlobalWizard.js groupEmbedded: one per name, Phasewalker's managed rows left out. */
    function localGroups() {
        const byName = new Map();
        rows().forEach((e) => {
            if (!e || e.managed || !e.name) return;
            if (!byName.has(e.name)) byName.set(e.name, []);
            byName.get(e.name).push(e);
        });
        return Array.from(byName.entries()).map(([name, entries]) => {
            let value;
            if (entries.length === 1) value = entries[0].value;
            else {
                const all = [];
                let anyList = false;
                entries.forEach((e) => { if (Array.isArray(e.value)) anyList = true; all.push(...toList(e.value)); });
                value = anyList ? all : all.join(', ');
            }
            return { name, count: entries.length, value: Array.isArray(value) ? fromList(value) : value, staged: entries.some((e) => hasStages(e.stages)), extend: entries.some((e) => e.extend), merged: entries.length > 1 };
        });
    }

    async function loadGlobals() {
        try {
            if (typeof appOptionsChunkPresent === 'function' && appOptionsChunkPresent('text_replacements')) await refreshAppOptionsChunk('text_replacements');
            else if (typeof ensureAppOptionsChunk === 'function') await ensureAppOptionsChunk('text_replacements');
        } catch (_) { /* the cached map, if any */ }
        return (window.optionsData && window.optionsData.textReplacements) || {};
    }

    function finalValue(item, globals, mode) {
        const has = Object.prototype.hasOwnProperty.call(globals, item.name);
        if (!has) return fromList(toList(item.value));
        if (mode === 'skip') return undefined;
        if (mode === 'replace') return fromList(toList(item.value));
        const out = [];
        [...toList(globals[item.name]), ...toList(item.value)].forEach((v) => { if (!out.includes(v)) out.push(v); });
        return fromList(out);
    }

    /** The globals as they are now (another window may have changed them). */
    async function localGlobals() { return loadGlobals(); }

    async function localMakeGlobal(names, mode, removeAfter) {
        const want = new Set(names);
        const items = localGroups().filter((it) => want.has(it.name));
        const globals = await loadGlobals();
        const payload = {};
        const saved = [];
        const skipped = [];
        items.forEach((it) => {
            const value = finalValue(it, globals, mode);
            if (value === undefined) { skipped.push(it.name); return; }
            payload[it.name] = value;
            saved.push({ name: it.name, value, existed: Object.prototype.hasOwnProperty.call(globals, it.name) });
        });
        if (saved.length) {
            const res = await wsc().sendMessage('save_text_replacements', { textReplacements: payload });
            if (!res || !res.success) throw new Error((res && res.error) || 'The server did not save them.');
        }
        if (removeAfter && saved.length) {
            const gone = new Set(saved.map((s) => s.name));
            const list = rows();
            const keep = list.filter((e) => !(e && !e.managed && gone.has(e.name)));
            list.length = 0;
            keep.forEach((e) => list.push(e));
            localChanged();
        }
        if (saved.length) await expChanged();
        return { saved, skipped };
    }

    function localPreview(names, mode, globals) {
        const want = new Set(names);
        return localGroups().filter((it) => want.has(it.name)).map((it) => ({ name: it.name, existed: Object.prototype.hasOwnProperty.call(globals, it.name), value: finalValue(it, globals, mode), staged: it.staged, extend: it.extend }));
    }

    M.extend({
        expLoad,
        expSave: (key, value) => expSaveMany({ [key]: value }),
        expSaveMany,
        expDelete,
        expFavAdd,
        expFavRemove,
        expChanged,
        localList,
        localStages,
        localAdd,
        localUpdate,
        localRemove,
        localGroups,
        localGlobals,
        localPreview,
        localMakeGlobal
    });
})();
