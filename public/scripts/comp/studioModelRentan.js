/**
 * studioModel part - Rentan (#860 migration): the Studio calls DreamStudio's Rentan part needs, added
 * with studioModel.extend. Only this file touches the desktop form for them.
 *
 * The desktop keeps Rentan's state on its scene buttons (#todBtn, #weatherBtn, #seasonBtn,
 * #creativeBtn, #novelBtn) and on #dynamicCarousel's data-*; its menus act through
 * handleDynamicGenerationContextMenuAction (dynamicGenerationManager.js). The phone goes through the
 * same handler and the same button clicks, so every side effect (the Directive tab, the status icons,
 * the context resolution) is the desktop's own.
 *
 *   rentan()                        the state the phone draws (see below)
 *   rentanSetEnabled(on)            the generation bar's Rentan toggle (shows / hides the scene group)
 *   rentanDisable()                 the Rentan menu's Disable (clears the scene and the directive)
 *   rentanToggle(id, on)            a scene button on / off: tod | weather | season | creative | novel
 *   rentanAction(action, value)     one of the desktop's Rentan menu actions, by its action name
 *   rentanTimeDate()                { hour, minute, day, month } the Select Date & Time dialog opens on
 *   rentanSetTimeDate(h, m, d, mo)  that dialog's Save (the %HHmm_MMDD override)
 *   rentanLookupCity(name)          Promise { location, display, text } | { error }
 *   rentanSetLocation(loc, display) the location dialog's Save
 *   rentanNovelSet(key, value)      Novel's Tone / Style / Explicitness / Persuasiveness / Auto Generate
 *   rentanNovelDo(what)             'generate' | 'undo' | 'resume' (Resume Story Advancement)
 *   rentanAgent()                   Rentan's engine / model / reasoning / fast and their choices
 *   rentanEraseCache()              Erase Cache without the desktop's confirmation (the phone asks first)
 *   rentanCompile()                 Compile to Prompts' run (an AI run: the phone confirms first) ->
 *                                   Promise { ok, error }; the changes go to the desktop's queue
 *   rentanCompileState()            { inFlight, applying, entries: [{ index, included, change, field,
 *                                   find, text, category, warn, details: [[label, text]] }] }
 *   rentanCompileInclude(i, on)     a change ticked / unticked (i < 0: all of them)
 *   rentanCompileApply(close)       Apply / Apply and Close Rentan -> Promise { success, applied, error }
 *   rentanNovelList()               Promise [{ id, name }] (this workspace's novel notes)
 *   rentanNovelSelect(id)           Select Novel Note's pick: loads it and turns Novel on
 *   rentanNovelNew()                Create New Novel Note
 *   rentanNovelNote()               the open note: { id, name, content, cursor, undo, busy } | null
 *   rentanNovelSave(content)        the editor's save -> Promise true | error text
 *   rentanRules() / rentanSaveRules(list)            Enshutsuka's Director rules (director_load / save_rules)
 *   rentanMemories(q)               list_knowledge_memories { store, search, page, perPage, sort }
 *   rentanMemory(name, store)       get_knowledge_memory -> the memory
 *   rentanMemoryUpdate(name, updates, store) / rentanMemoryDelete(name, store)
 */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;

    const el = (id) => M._el(id) || document.getElementById(id);
    const fn = (name) => (typeof window[name] === 'function' ? window[name] : null);
    const changed = () => { M._emit('change', { id: 'rentan' }); };
    const compiled = () => (window.dynamicGenerationData && window.dynamicGenerationData.compiled_prompt) || null;
    const call = (name, ...args) => { const f = fn(name); if (!f) return undefined; try { return f(...args); } catch (err) { console.warn('[studioModel] rentan', name, err); return undefined; } };

    function rentan() {
        const dc = el('dynamicCarousel');
        const tod = el('todBtn');
        const weather = el('weatherBtn');
        const season = el('seasonBtn');
        const creative = el('creativeBtn');
        const novel = el('novelBtn');
        const ds = (dc && dc.dataset) || {};
        const cp = compiled();
        const locks = call('getDynamicGenerationLockState') || { cacheLocked: false, contextLocked: false };
        const on = (b) => !!(b && b.dataset.state === 'on');
        const stages = el('pipelineStagesContainer');
        const novelSettings = call('novelGetSessionSettings') || {};
        const novelStack = (window.novelSession && ((window.novelSession.metadata && window.novelSession.metadata.undo_stack) || (window.novelSession.note && window.novelSession.note.metadata && window.novelSession.note.metadata.undo_stack))) || null;
        const todDisplay = fn('getCurrentTodDisplay');
        const hasTime = fn('hasTimeOverride');
        const hasDate = fn('hasDateOverride');
        return {
            enabled: !!call('isDynamicGenerationEnabled'),
            tod: {
                on: on(tod),
                override: (tod && tod.getAttribute('data-override')) || '',
                display: todDisplay ? todDisplay() : '',
                hasTime: hasTime ? !!hasTime() : false,
                hasDate: hasDate ? !!hasDate() : false
            },
            weather: {
                on: on(weather),
                override: (weather && weather.getAttribute('data-override')) || '',
                location: (weather && weather.getAttribute('data-location')) || '',
                locationDisplay: (weather && weather.dataset.locationDisplay) || ''
            },
            season: {
                on: on(season),
                override: (season && season.getAttribute('data-override')) || '',
                holiday: !!(season && season.dataset.toggleHoliday === 'true'),
                guidance: !!(season && season.dataset.toggleGuidance === 'true')
            },
            creative: {
                on: on(creative),
                clothing: !!(creative && creative.dataset.toggleClothing === 'true'),
                action: !!(creative && creative.dataset.toggleAction === 'true'),
                level: (creative && creative.dataset.creativeLevel) || 'medium',
                lockSubject: ds.lockSubject === 'true'
            },
            novel: {
                present: !!novel,
                enabled: on(novel),
                // the desktop button is disabled until there is a directive or a novel to go on
                canEnable: !!(novel && !novel.disabled) || !!call('novelCanEnable'),
                resume: !!(novel && novel.dataset.resumeAdvancement === 'true'),
                hasNote: !!(window.novelSession && window.novelSession.noteId),
                hasUndo: !!(novelStack && novelStack.length),
                tone: novelSettings.tone || 'neutral',
                style: novelSettings.style || 'literary',
                explicitness: novelSettings.explicitness || 'moderate',
                persuasiveness: novelSettings.persuasiveness || 'neutral',
                autoGenerate: novelSettings.auto_generate !== false
            },
            flags: {
                forceRefresh: ds.forceRefresh === 'true',
                useCache: dc ? dc.getAttribute('data-use-cache') !== 'false' : true,
                expirePreview: ds.expirePreview === 'true',
                tokenCount: ds.tokenCount === 'true',
                twoStage: ds.twoStage === 'true',
                fastMode: ds.fastMode === 'true',
                pipelineAware: ds.pipelineAware === 'true',
                initialPromptAware: ds.initialPromptAware === 'true',
                cacheLocked: !!locks.cacheLocked,
                contextLocked: !!locks.contextLocked
            },
            compiled: {
                has: !!cp,
                context: !!(cp && cp.context),
                preview: !!(cp && (cp.preview_image_hash || cp.preview_image)),
                original: !!(cp && cp.original_input),
                session: !!(cp && cp.wren_session_id)
            },
            stages: !!(stages && stages.children && stages.children.length > 0),
            reduced: call('getRentanReducedContext') || null
        };
    }

    function rentanSetEnabled(on) {
        const toggle = el('dynamicGenerationToggleBtn');
        // the toggle's own click: it shows / hides the group and runs the desktop's follow-ups
        if (toggle && !!call('isDynamicGenerationEnabled') !== !!on) toggle.click();
        else if (!toggle) call('setDynamicGenerationEnabled', !!on);
        changed();
    }

    function rentanDisable() {
        call('disableDynamicGeneration');
        changed();
    }

    const SCENE = { tod: 'todBtn', weather: 'weatherBtn', season: 'seasonBtn', creative: 'creativeBtn' };

    function rentanToggle(id, on) {
        if (id === 'novel') {
            call('applyStudioNovelConfig', { enabled: !!on });
        } else {
            const b = el(SCENE[id]);
            // the button's click handler turns it on / off and clears its override when off
            if (b && (b.dataset.state === 'on') !== !!on) b.click();
        }
        changed();
    }

    // the desktop says these two in a toast (the phone's message box): the menu's radio rows show them
    // already, so the phone sets them without one
    const QUIET = {
        setRentanReducedContext: (value) => call('setRentanReducedContext', value),
        useRentanAgentDefault: () => call('setRentanAgentOverride', null)
    };

    function rentanAction(action, value) {
        if (QUIET[action]) { QUIET[action](value); changed(); return true; }
        const handler = fn('handleDynamicGenerationContextMenuAction');
        if (!handler) return false;
        let done = false;
        try { done = handler({ detail: { action, target: el('dynamicCarousel'), item: { value } } }); } catch (err) { console.warn('[studioModel] rentan action', action, err); }
        changed();
        return done;
    }

    /** The values the desktop's Select Date & Time dialog opens on (openTimeDateModal's reading). */
    function rentanTimeDate() {
        const tod = el('todBtn');
        const ov = tod ? tod.getAttribute('data-override') : '';
        let d = new Date();
        if (ov && ov.includes('_')) {
            const parts = ov.split('_');
            let t = parts[0] || '';
            const date = parts[1];
            if (t.startsWith('%')) t = t.slice(1);
            const timeOk = /^\d{4}$/.test(t);
            if (timeOk) d.setHours(Number(t.slice(0, 2)), Number(t.slice(2, 4)));
            if (date === 'tomorrow') d.setDate(d.getDate() + 1);
            else if (/^\d{4}$/.test(date || '')) { d.setMonth(Number(date.slice(0, 2)) - 1); d.setDate(Number(date.slice(2, 4))); } else if (date && typeof CLIENT_HOLIDAY_MAP !== 'undefined' && CLIENT_HOLIDAY_MAP[date]) {
                const h = call('getHolidayDateClient', `true_${date}`);
                if (h) { d = h; if (timeOk) d.setHours(Number(t.slice(0, 2)), Number(t.slice(2, 4))); }
            }
        }
        return { hour: d.getHours(), minute: d.getMinutes(), day: d.getDate(), month: d.getMonth() + 1 };
    }

    /** saveTimeDateModal's override: %HHmm_MMDD (the limits are the desktop dialog's). */
    function rentanSetTimeDate(hour, minute, day, month) {
        const ok = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
        if (!ok(hour, 0, 23) || !ok(minute, 0, 59) || !ok(day, 1, 31) || !ok(month, 1, 12)) return false;
        const p = (v) => String(v).padStart(2, '0');
        const tod = el('todBtn');
        if (!tod || !fn('setDynamicOverride')) return false;
        fn('setDynamicOverride')(tod, `%${p(hour)}${p(minute)}_${p(month)}${p(day)}`);
        changed();
        return true;
    }

    /** verifyWeatherLocation's lookup: the server's city search. */
    async function rentanLookupCity(name) {
        const city = String(name || '').trim();
        if (!city) return { error: 'Please enter a city name.' };
        if (!window.wsClient || !window.wsClient.isConnected()) return { error: 'WebSocket not connected' };
        try {
            const r = await window.wsClient.lookupCity(city);
            if (!r || r.longitude === undefined || r.latitude === undefined) return { error: 'City not found. Please try a different name.' };
            // the desktop's 'City, State Country' without the double space an empty state leaves
            const display = [r.city || city, [r.state, r.country].filter(Boolean).join(' ')].filter(Boolean).join(', ');
            let text = `Found: ${display}`;
            if (r.timezone) {
                try { text += ` (Current time: ${new Date().toLocaleTimeString('en-US', { timeZone: r.timezone, hour: '2-digit', minute: '2-digit', hour12: true })})`; } catch (_) { /* unknown zone */ }
            }
            return { location: `${r.longitude}_${r.latitude}`, display, text };
        } catch (err) {
            return { error: (err && err.message) || 'Error searching for city. Please try again.' };
        }
    }

    /** saveWeatherLocation: the location on the weather button, which turns on. */
    function rentanSetLocation(location, display) {
        const w = el('weatherBtn');
        if (!w || !location) return false;
        w.setAttribute('data-location', String(location));
        w.dataset.locationDisplay = String(display || '');
        w.dataset.state = 'on';
        w.classList.add('active');
        call('updatePromptStatusIcons');
        call('createDebouncedContextResolution');
        changed();
        return true;
    }

    const NOVEL_KEYS = { tone: 'tone', style: 'style', explicitness: 'explicitness', persuasiveness: 'persuasiveness', autoGenerate: 'autoGenerate' };

    /** Novel's context menu: the setting on the button, then saved to the novel note. */
    function rentanNovelSet(key, value) {
        const b = el('novelBtn');
        if (!b || !NOVEL_KEYS[key]) return;
        b.dataset[NOVEL_KEYS[key]] = String(value);
        const p = call('novelPersistSettings');
        if (p && typeof p.catch === 'function') p.catch((err) => console.warn('[studioModel] novel settings', err));
        changed();
    }

    function rentanNovelDo(what) {
        const b = el('novelBtn');
        if (what === 'resume' && b) b.dataset.resumeAdvancement = b.dataset.resumeAdvancement === 'true' ? 'false' : 'true';
        else if (what === 'generate') { const s = window.novelSession; if (s && s.noteId) call('novelRunGenerate', { noteId: s.noteId }); } else if (what === 'undo') call('novelRunUndo');
        changed();
    }

    /** Novel's choices (novelManager.js) for the phone's lists: { tone: [[value, label]], ... }. */
    function rentanNovelOptions() {
        // top-level consts of novelManager.js: visible by name to every classic script, not on window
        const pick = (list) => (Array.isArray(list) ? list.map((o) => [o.value, o.label]) : []);
        return {
            tone: pick(typeof NOVEL_TONE_OPTIONS !== 'undefined' ? NOVEL_TONE_OPTIONS : null),
            style: pick(typeof NOVEL_STYLE_OPTIONS !== 'undefined' ? NOVEL_STYLE_OPTIONS : null),
            explicitness: pick(typeof NOVEL_EXPLICITNESS_OPTIONS !== 'undefined' ? NOVEL_EXPLICITNESS_OPTIONS : null),
            persuasiveness: pick(typeof NOVEL_PERSUASIVENESS_OPTIONS !== 'undefined' ? NOVEL_PERSUASIVENESS_OPTIONS : null)
        };
    }

    /**
     * Rentan's engine / model (#409) as the desktop's Wren rows show them: the effective choice, its
     * names, and the lists (models load on request: loading true until the Director has them).
     */
    function rentanAgent() {
        const eff = fn('rentanAgentEffective');
        const d = window.directorInstance || null;
        if (!eff) return null;
        const c = eff();
        const engines = (fn('rentanAgentEngineIds') ? fn('rentanAgentEngineIds')() : ['cursor', 'claude', 'tokenrouter']).map((id) => ({ id, name: fn('rentanAgentEngineName') ? fn('rentanAgentEngineName')(id) : id }));
        const catalog = d ? d.catalogFor(c.engine) : [];
        if (!catalog.length) call('requestRentanAgentModels', c.engine);
        const models = catalog.map((m) => ({ id: m.id, name: m.name, group: d.modelProvider(m) }));
        const efforts = d ? d.retryEfforts(c).map((r) => ({ id: r.id, name: r.name })) : [];
        const base = fn('rentanAgentBaseline');
        const label = fn('rentanAgentLabel');
        return {
            engine: c.engine,
            engineName: fn('rentanAgentEngineName') ? fn('rentanAgentEngineName')(c.engine) : c.engine,
            engines,
            model: c.model,
            modelName: fn('rentanAgentModelName') ? fn('rentanAgentModelName')(c) : (c.model || ''),
            models,
            loading: !catalog.length,
            effort: c.effort,
            efforts,
            fast: c.fast === true,
            fastAvailable: !!(d && d.retryFastAvailable(c)),
            override: !!call('getRentanAgentOverride'),
            defaultLabel: base && label ? label(base()) : ''
        };
    }

    // ---- Erase Cache (clearCompiledPrompt without its dialog: the phone's message box asks)

    function rentanEraseCache() {
        const d = window.dynamicGenerationData;
        if (!d || !d.compiled_prompt) return false;
        delete d.compiled_prompt;
        const dc = el('dynamicCarousel');
        if (dc) dc.setAttribute('data-has-cache', 'false');
        call('clearDynamicGenerationLockState');
        if (window.lastGenerationStageSeeds) delete window.lastGenerationStageSeeds;
        call('updateDynamicGenerationToggleBtn');
        changed();
        return true;
    }

    // ---- Compile to Prompts (compileToPromptsApplet.js): its run, its queue, its Apply. The applet's
    // top-level lets are shared by name with every classic script (typeof guards: the applet may be absent)

    const ctp = {
        has: () => typeof compileToPromptsQueue !== 'undefined',
        queue: () => (typeof compileToPromptsQueue !== 'undefined' && Array.isArray(compileToPromptsQueue) ? compileToPromptsQueue : []),
        inFlight: () => typeof compileToPromptsInFlight !== 'undefined' && !!compileToPromptsInFlight,
        applying: () => typeof compileToPromptsApplying !== 'undefined' && !!compileToPromptsApplying
    };

    async function rentanCompile() {
        if (!ctp.has() || !fn('buildCompileToPromptsRequestBody')) return { ok: false, error: 'Compile to Prompts is not available.' };
        if (!call('isDynamicGenerationEnabled')) return { ok: false, error: 'Enable Rentan before compiling to prompts.' };
        if (ctp.inFlight()) return { ok: false, error: 'Compile already in progress...' };
        if (!window.wsClient || typeof window.wsClient.compileDynamicGeneration !== 'function') return { ok: false, error: 'WebSocket not connected' };
        compileToPromptsInFlight = true;
        changed();
        try {
            const body = buildCompileToPromptsRequestBody();
            compileToPromptsRequestBody = body;
            call('updateDynamicGenerationProgressOverlay', 'starting');
            const result = await window.wsClient.compileDynamicGeneration(body);
            if (!(result && result.success) && result && result.compiled_prompt && result.compiled_prompt.success === false) {
                throw new Error(result.compiled_prompt.error || result.error || 'Compile failed');
            }
            applyCompiledPromptToClient(result.compiled_prompt, result.application_context);
            buildCompileToPromptsQueue(result.compiled_prompt);
            if (typeof compileToPromptsSelectedIndex !== 'undefined') compileToPromptsSelectedIndex = compileToPromptsQueue.length ? 0 : -1;
            return { ok: true };
        } catch (err) {
            call('updateDynamicGenerationProgressOverlay', 'error');
            return { ok: false, error: (err && err.message) || 'Compile to Prompts failed' };
        } finally {
            compileToPromptsInFlight = false;
            changed();
        }
    }

    /** One change as the desktop's list row and details pane word it (plain text). */
    function ctpEntry(entry, index) {
        const r = entry.replacement || {};
        const t = (name, ...a) => { const v = call(name, ...a); return v == null ? '' : String(v); };
        const warnings = fn('getCompileToPromptsWarnings') ? (call('getCompileToPromptsWarnings', entry) || []) : [];
        const action = String(r.action || '').toLowerCase();
        const change = t('describeCompileToPromptsAction', r);
        const field = t('describeCompileToPromptsField', entry);
        const find = t('getCompileToPromptsFindText', r);
        const text = t('getCompileToPromptsWrittenText', r);
        const details = [];
        const add = (label, v) => { if (v) details.push([label, String(v)]); };
        add('Change', `${change} in the ${field}`);
        add('Find', find);
        add(action === 'delete' ? 'Deletes' : 'Text', text || (action === 'delete' ? r.select_text || '' : ''));
        const anchor = (r.anchor_details && r.anchor_details.preview) || r.anchor_text || '';
        if (anchor) add('Anchor', `${anchor}${r.anchor_details && r.anchor_details.source ? ` (${String(r.anchor_details.source).replace(/_/g, ' ')})` : ''}`);
        add('Category', r.replacement_category || '');
        add('Reason', r.reason || '');
        const mit = Array.isArray(r.mitigations) ? r.mitigations : [];
        if (mit.length) add('Adjusted', mit.map((m) => `${String(m.type || '').replace(/_/g, ' ')}${m.description ? `: ${m.description}` : ''}`).join('\n'));
        const refs = Array.isArray(r.references) ? r.references : [];
        if (refs.length) {
            add('Sources', refs.map((ref) => {
                if (ref.type === 'web_search') return `Web: ${ref.query || 'Web search'}`;
                if (ref.type === 'tag_search') return `Tags: ${Array.isArray(ref.tags) ? ref.tags.join(', ') : (ref.query || '')}`;
                if (ref.type === 'tag_description') return `${ref.description || ref.query || 'Tag description'}${Array.isArray(ref.tags) && ref.tags.length ? ` (${ref.tags.join(', ')})` : ''}`;
                if (ref.type === 'tokenizer') return ref.description || 'Token analysis';
                return ref.description || ref.query || ref.type || '';
            }).filter(Boolean).join('\n'));
        }
        if (warnings.length) add('Status', warnings.join('\n'));
        return { index, included: !!entry.included, change, field, find, text, category: r.replacement_category || '', warn: warnings.length > 0, details };
    }

    function rentanCompileState() {
        return { available: ctp.has(), inFlight: ctp.inFlight(), applying: ctp.applying(), entries: ctp.queue().map(ctpEntry) };
    }

    function rentanCompileInclude(index, on) {
        const q = ctp.queue();
        if (index < 0) q.forEach((e) => { e.included = !!on; });
        else if (q[index]) q[index].included = !!on;
        changed();
    }

    /** handleCompileToPromptsApply without its window and toasts (the phone says the result). */
    async function rentanCompileApply(closeRentan) {
        if (!ctp.has() || ctp.applying()) return { success: false, error: '' };
        const selected = call('getCompileToPromptsSelectedReplacements') || [];
        if (!selected.length) return { success: false, error: 'Select at least one change to apply.' };
        compileToPromptsApplying = true;
        changed();
        let result;
        try {
            result = await applyTendaiToEditor(selected, call('getCompileToPromptsApplicationContext'), {
                requestBody: (typeof compileToPromptsRequestBody !== 'undefined' && compileToPromptsRequestBody) || buildCompileToPromptsRequestBody()
            });
        } catch (err) {
            result = { success: false, error: (err && err.message) || String(err) };
        } finally {
            compileToPromptsApplying = false;
        }
        if (!result || !result.success) { changed(); return { success: false, error: (result && result.error) || `Failed to apply ${(result && result.failed) || ''} change(s)` }; }
        if (closeRentan) {
            delete window.dynamicGenerationData;
            const tg = el('dynamicGenerationToggleBtn');
            const grp = el('dynamicGenerationGroup');
            const dc = el('dynamicCarousel');
            if (tg) tg.setAttribute('data-state', 'off');
            if (grp) grp.classList.add('hidden');
            if (dc) dc.setAttribute('data-use-cache', 'true');
            call('clearDynamicGenerationLockState');
            call('updateDynamicGenerationToggleBtn');
            if (window.lockedDynamicReplacements) window.lockedDynamicReplacements = [];
            call('updateMainLockButtonState');
            compileToPromptsQueue = [];
        } else {
            // the applied changes leave the list; what was left unticked stays for another pass
            compileToPromptsQueue = compileToPromptsQueue.filter((e) => !e.included);
        }
        call('refreshTokenBarCounts');
        changed();
        return { success: true, applied: result.applied };
    }

    // ---- Novel notes (novelContextMenu.js / novelManager.js)

    let novelWatched = false;
    /** The novel code repaints its desktop editor on every change: the phone hears it there too. */
    function watchNovel() {
        if (novelWatched) return;
        novelWatched = true;
        ['refreshNovelEditorContent', 'setNovelEditorGenerateDisabled'].forEach((name) => {
            const orig = window[name];
            if (typeof orig !== 'function' || orig._wmRentan) return;
            const wrapped = function (...args) { const r = orig.apply(this, args); M._emit('change', { id: 'novel' }); return r; };
            wrapped._wmRentan = true;
            window[name] = wrapped;
        });
    }
    const workspace = () => (typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default');

    async function rentanNovelList() {
        if (!window.wsClient || typeof window.wsClient.novelList !== 'function') return [];
        const r = await window.wsClient.novelList(workspace());
        const list = (r && (r.novels || (r.data && r.data.novels))) || [];
        return list.map((n) => ({ id: n.id, name: n.name || 'Untitled', updated: n.updated_at || n.updatedAt || '' }));
    }

    function novelOn() {
        const b = el('novelBtn');
        if (b) { b.dataset.state = 'on'; b.classList.add('active'); }
    }

    async function rentanNovelSelect(id) {
        watchNovel();
        if (!id || !fn('novelLoadNote')) return false;
        const note = await novelLoadNote(id);
        if (note) novelOn();
        changed();
        return !!note;
    }

    async function rentanNovelNew() {
        watchNovel();
        if (!fn('novelEnsureNote')) return false;
        window.novelSession = null;
        const note = await novelEnsureNote(workspace());
        changed();
        return !!note;
    }

    function rentanNovelNote() {
        watchNovel();
        const s = window.novelSession;
        if (!s || !s.noteId) return null;
        const note = s.note || {};
        const content = note.content || '';
        const meta = fn('novelNormalizeMetadata') ? novelNormalizeMetadata(note.metadata) : (note.metadata || {});
        const lines = fn('novelCountStoryLines') ? novelCountStoryLines(content) : content.split('\n').length;
        const c = meta.story_cursor_line || 0;
        // novelUpdateEditorCursorLabel's words
        const cursor = c <= 0 ? 'Story cursor: start' : c >= lines ? `Story cursor: end (line ${c})` : `Story cursor: line ${c} of ${lines}`;
        return {
            id: s.noteId,
            name: note.name || '',
            content,
            cursor,
            undo: !!(meta.undo_stack && meta.undo_stack.length),
            busy: typeof novelGenerateInFlight !== 'undefined' && !!novelGenerateInFlight
        };
    }

    async function rentanNovelSave(content) {
        const s = window.novelSession;
        if (!s || !s.noteId) return '';
        if (!window.wsClient || !window.wsClient.isConnected()) return 'Not connected';
        try {
            await window.wsClient.novelUpdate(s.noteId, { content });
            if (s.note) s.note.content = content;
            // the desktop editor (if it is open there) follows
            const ta = document.getElementById('novelEditorTextarea');
            if (ta && ta.value !== content) ta.value = content;
            return true;
        } catch (err) {
            return 'Could not save the story';
        }
    }

    // ---- Enshutsuka: Director rules and knowledge memories (mmcEnshutsuka.js's calls)

    async function send(type, data) {
        const client = window.wsClient;
        if (!client || typeof client.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        const r = await client.sendMessage(type, data || {}, false);
        // the Director's handlers answer { data: { success, ... } } inside the reply
        return r && r.data && typeof r.data === 'object' && r.data.success !== undefined && r.success === undefined ? r.data : r;
    }
    const ok = (r, text) => { if (!(r && r.success)) throw new Error((r && (r.error || r.message)) || text); return r; };

    async function rentanRules() {
        const r = ok(await send('director_load_rules', {}), 'The rules could not be read.');
        return Array.isArray(r.rules) ? r.rules : [];
    }

    async function rentanSaveRules(list) {
        const r = await send('director_save_rules', { rules: list });
        if (r && r.success === false) throw new Error(r.error || r.message || 'The rules were not saved.');
        return true;
    }

    async function rentanMemories(q = {}) {
        const r = ok(await send('list_knowledge_memories', {
            page: q.page || 1,
            perPage: q.perPage || 25,
            search: q.search || '',
            category: q.category || null,
            sort: q.sort || undefined,
            store: q.store || undefined
        }), 'The memories could not be read.');
        const cats = ((r.stats && r.stats.categories) || []).map((x) => (x && typeof x === 'object' ? x.category : x)).filter(Boolean);
        return { memories: Array.isArray(r.memories) ? r.memories : [], total: Number(r.total) || 0, page: Number(r.page) || q.page || 1, categories: cats };
    }

    async function rentanMemory(name, store) {
        const r = ok(await send('get_knowledge_memory', { name, store: store || undefined }), `The memory "${name}" could not be loaded.`);
        if (!r.memory) throw new Error(`The memory "${name}" could not be loaded.`);
        return r.memory;
    }

    async function rentanMemoryUpdate(name, updates, store) {
        ok(await send('update_knowledge_memory', { name, updates, store: store || undefined }), 'The memory was not saved.');
        return true;
    }

    async function rentanMemoryDelete(name, store) {
        ok(await send('delete_knowledge_memory', { name, store: store || undefined }), 'The memory was not deleted.');
        return true;
    }

    M.extend({ rentan, rentanSetEnabled, rentanDisable, rentanToggle, rentanAction, rentanTimeDate, rentanSetTimeDate, rentanLookupCity, rentanSetLocation, rentanNovelSet, rentanNovelDo, rentanNovelOptions, rentanAgent, rentanEraseCache, rentanCompile, rentanCompileState, rentanCompileInclude, rentanCompileApply, rentanNovelList, rentanNovelSelect, rentanNovelNew, rentanNovelNote, rentanNovelSave, rentanRules, rentanSaveRules, rentanMemories, rentanMemory, rentanMemoryUpdate, rentanMemoryDelete });
})();
