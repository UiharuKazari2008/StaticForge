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

    M.extend({ rentan, rentanSetEnabled, rentanDisable, rentanToggle, rentanAction, rentanTimeDate, rentanSetTimeDate, rentanLookupCity, rentanSetLocation, rentanNovelSet, rentanNovelDo, rentanNovelOptions, rentanAgent });
})();
