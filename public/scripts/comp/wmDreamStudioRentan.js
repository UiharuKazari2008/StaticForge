/**
 * Melaton Mobile: DreamStudio part - Rentan (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelRentan.js adds what it needs).
 *
 * Menu > Rentan is the desktop's Rentan menu (the Wren rows, Enshutsuka Data, the Freeze / Cache
 * groups as submenus, as Win32 menus have them) plus Enable / Disable and Options...; Options... (also
 * in the editor's toolbox) is the scene group the desktop shows beside the prompt: Weather, Time of
 * Day, Season, Creative and Novel, each a check box (the button's on / off) and a combo whose list is
 * that button's context menu. The choices, labels and limits are the desktop's.
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;

    // the desktop's lists (dynamicGenerationManager.js setupDynamicGenerationContextMenus); the phone
    // rows show the name before the desktop's " - description" (a phone list has no room for both)
    const TIMES = [['dawn', 'Dawn'], ['sunrise', 'Sunrise'], ['morning', 'Morning'], ['latemorning', 'Late Morning'], ['daytime', 'Daytime'], ['afternoon', 'Afternoon'], ['lateafternoon', 'Late Afternoon'], ['goldenhour', 'Golden Hour'], ['evening', 'Evening'], ['sunset', 'Sunset'], ['dusk', 'Dusk'], ['night', 'Night'], ['midnight', 'Midnight']];
    const HOLIDAYS = [['nearest', 'Nearest Holiday'], ['christmas', 'Christmas'], ['newyears', 'New Year\'s'], ['halloween', 'Halloween'], ['thanksgiving', 'Thanksgiving'], ['independenceday', 'Independence Day'], ['valentinesday', 'Valentine\'s Day'], ['easter', 'Easter'], ['chinesenewyear', 'Chinese New Year'], ['setsubun', 'Setsubun'], ['hinamatsuri', 'Hinamatsuri'], ['summerfestival', 'Summer Festival'], ['japanesenewyear', 'Japanese New Year'], ['cherryblossom', 'Cherry Blossom'], ['tanabatafestival', 'Tanabata Festival'], ['goldenweek', 'Golden Week'], ['childrensday', 'Children\'s Day'], ['tsukimi', 'Mid-Autumn Festival'], ['obonfestival', 'Obon Festival']];
    // '-' where the desktop's Conditions list has its separators
    const CONDITIONS = [['clear_sky', 'Clear Sky'], ['few_clouds', 'Few Clouds'], ['partly_cloudy', 'Partly Cloudy'], ['fair', 'Fair Weather'], '-',
        ['scattered_clouds', 'Scattered Clouds'], ['broken_clouds', 'Broken Clouds'], ['overcast', 'Overcast'], ['mostly_cloudy', 'Mostly Cloudy'], '-',
        ['light_rain', 'Light Rain'], ['moderate_rain', 'Moderate Rain'], ['heavy_rain', 'Heavy Rain'], ['light_snow', 'Light Snow'], ['moderate_snow', 'Moderate Snow'], ['heavy_snow', 'Heavy Snow'], ['freezing_rain', 'Freezing Rain'], ['sleet', 'Sleet'], '-',
        ['thunderstorm', 'Thunderstorm'], ['severe_thunderstorm', 'Severe Thunderstorm'], ['tornado', 'Tornado'], ['hurricane', 'Hurricane'], ['tropical_storm', 'Tropical Storm'], '-',
        ['mist', 'Mist'], ['fog', 'Fog'], ['dense_fog', 'Dense Fog'], ['haze', 'Haze'], ['dust', 'Dust'], ['volcanic_ash', 'Volcanic Ash'], ['sand', 'Sand'], ['squalls', 'Squalls'], '-',
        ['rainbow', 'Rainbow'], ['blizzard', 'Blizzard'], ['high_surf', 'High Surf'], ['heat_wave', 'Heat Wave'], ['cold_wave', 'Cold Wave']];
    const SEASONS = [[1, 'Spring'], [2, 'Summer'], [3, 'Autumn'], [4, 'Winter']];
    const LEVELS = [['light', 'Light'], ['medium', 'Medium'], ['high', 'High']];
    const REDUCED = [['off', 'Disabled'], ['indoor', 'Indoor'], ['outdoor', 'Outdoor']];
    // the desktop buttons' glyphs (app.html #dynamicGenerationGroup)
    const SCENE = [
        ['weather', 'Weather', 'fa-regular fa-cloud-sun'],
        ['tod', 'Time of Day', 'fa-regular fa-clock'],
        ['season', 'Season', 'fas fa-leaf-maple'],
        ['creative', 'Creative', 'fas fa-paintbrush-pencil'],
        ['novel', 'Novel', 'fas fa-book-open']
    ];

    window.wmDreamStudio.extend('Rentan', (api, reg) => {
        const M = api.M;
        if (!M || typeof M.rentan !== 'function') return;
        const { ui, sh, esc } = api;
        const nameOf = (list, v) => { const hit = list.find((x) => Array.isArray(x) && String(x[0]) === String(v)); return hit ? hit[1] : ''; };
        // every change repaints the program (the Directive tab follows creative mode) and the dialog
        let refill = null;
        const after = () => { api.refresh(); api.paint(); if (refill) refill(); };
        const act = (action, value) => () => { M.rentanAction(action, value); after(); };

        // ---- the scene buttons' context menus as drop-down rows

        function todRows() {
            const s = M.rentan().tod;
            // the time part of the override ('dawn', 'dawn_christmas') and its date part
            const parts = s.override.split('_');
            const time = s.override.includes('_') ? parts[0] : s.override;
            const date = s.override.includes('_') ? parts[1] : '';
            return [
                { label: 'Select Date & Time...', action: timeDateDialog },
                ...(s.hasTime ? [{ label: 'Use Current Time', action: act('clearTodTimeOverride') }] : []),
                { label: 'Tomorrow', radio: date === 'tomorrow', action: act('setTodDateOverride', 'tomorrow') },
                ...(s.hasDate ? [{ label: 'Use Current Date', action: act('clearTodDateOverride') }] : []),
                '-',
                { label: 'Time of Day', submenu: () => TIMES.map(([v, l]) => ({ label: l, radio: s.on && time === v, action: act('setTodTimeOverride', v) })) },
                { label: 'Holiday', submenu: () => HOLIDAYS.map(([v, l]) => ({ label: l, radio: s.on && date === v, action: act('setTodDateOverride', v) })) }
            ];
        }

        function weatherRows() {
            const s = M.rentan().weather;
            const loc = s.location;
            const gps = !!loc && loc !== 'CLIENT' && /^Current Location \(-?\d/.test(s.locationDisplay);
            return [
                { label: 'Forecast', checked: s.override === 'forecast', action: act('toggleWeatherForecast') },
                { label: 'Conditions', submenu: () => CONDITIONS.map((c) => (c === '-' ? '-' : { label: c[1], radio: s.on && s.override === c[0], action: act('setWeatherOverride', c[0]) })) },
                '-',
                { label: 'Auto Location (IP)', radio: loc === 'CLIENT', action: act('setIPLocation') },
                { label: 'Static Location (Lookup)...', radio: !!loc && loc !== 'CLIENT' && !gps, action: locationDialog },
                { label: 'Static Location (GPS)', radio: gps, action: act('setCurrentLocation') },
                { label: 'Static Location (Server)', radio: !loc, disabled: !loc, action: act('clearWeatherLocation') }
            ];
        }

        function seasonRows() {
            const s = M.rentan().season;
            return [
                { label: 'Holidays', checked: s.holiday, action: act('toggleObserveHoliday') },
                '-',
                ...(s.override ? [{ label: 'Use Date', action: act('setSeasonOverride', false) }] : []),
                ...SEASONS.map(([v, l]) => ({ label: l, radio: s.on && String(s.override) === String(v), action: act('setSeasonOverride', v) }))
            ];
        }

        function creativeRows() {
            const r = M.rentan();
            const s = r.creative;
            return [
                { label: 'Lock Subject', checked: s.lockSubject, action: act('toggleLockSubject') },
                { label: 'Adapt Clothing', checked: s.clothing, action: act('toggleClothing') },
                { label: 'Adapt Action Verbs', checked: s.action, action: act('toggleAction') },
                { label: 'Seasonal Guidance', checked: r.season.guidance, disabled: !r.season.on, action: act('toggleGuidance') },
                { label: 'Creativity', submenu: () => LEVELS.map(([v, l]) => ({ label: l, radio: s.level === v, action: act('setCreativeLevel', v) })) }
            ];
        }

        function novelRows() {
            const s = M.rentan().novel;
            const opts = M.rentanNovelOptions();
            const pick = (key, list) => list.map(([v, l]) => ({ label: l, radio: s[key] === v, action: () => { M.rentanNovelSet(key, v); after(); } }));
            return [
                { label: 'Generate', disabled: !s.hasNote, action: () => { M.rentanNovelDo('generate'); after(); } },
                { label: 'Undo Last Generation', disabled: !s.hasUndo, action: () => { M.rentanNovelDo('undo'); after(); } },
                { label: 'Resume Story Advancement', checked: s.resume, action: () => { M.rentanNovelDo('resume'); after(); } },
                '-',
                { label: 'Tone', submenu: () => pick('tone', opts.tone) },
                { label: 'Style', submenu: () => pick('style', opts.style) },
                { label: 'Explicitness', submenu: () => pick('explicitness', opts.explicitness) },
                { label: 'Persuasiveness', submenu: () => pick('persuasiveness', opts.persuasiveness) },
                { label: 'Auto Generate', submenu: () => [true, false].map((v) => ({ label: v ? 'On' : 'Off', radio: s.autoGenerate === v, action: () => { M.rentanNovelSet('autoGenerate', v ? 'true' : 'false'); after(); } })) }
            ];
        }

        const ROWS = { weather: weatherRows, tod: todRows, season: seasonRows, creative: creativeRows, novel: novelRows };

        /** What each combo shows: the button's override, or Auto when it follows the live value. */
        function sceneValue(id, r) {
            // the desktop's title reads 'auto on Halloween' for a date with the live time: the date alone here
            // and '%0703 on Oct 31' for a set time (its HHmm test misses the % of the dialog's form): 7:03
            if (id === 'tod') return r.tod.on && r.tod.override ? String(r.tod.display || r.tod.override).replace(/^auto on /, '').replace(/^%(\d\d)(\d\d)/, (_, h, m) => `${Number(h)}:${m}`) : 'Auto';
            if (id === 'weather') {
                if (r.weather.override === 'forecast') return 'Forecast';
                return (r.weather.on && nameOf(CONDITIONS, r.weather.override)) || 'Auto';
            }
            if (id === 'season') return (r.season.on && nameOf(SEASONS, r.season.override)) || 'Auto';
            if (id === 'creative') return nameOf(LEVELS, r.creative.level) || 'Medium';
            if (id === 'novel') { const o = M.rentanNovelOptions(); return `${nameOf(o.tone, r.novel.tone)}, ${nameOf(o.style, r.novel.style)}`; }
            return '';
        }

        function sceneOn(id, r) { return id === 'novel' ? r.novel.enabled : r[id].on; }

        // ---- Options...: Rentan on / off, then a row per scene button

        function optionsDialog() {
            const el = api.openDlg('Rentan', 'wds-rtdlg', '');
            const body = el.querySelector('.wds-dlg-body');
            const fill = () => {
                if (!el.isConnected) { refill = null; return; }
                const r = M.rentan();
                const off = !r.enabled;
                const check = (key, label, icon, on, disabled) => `<label class="wm-check"><input type="checkbox" data-rt="${key}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}><span>${icon ? api.toolIcon(icon) : ''}${esc(label)}</span></label>`;
                body.innerHTML = `<div class="wds-wt-row wds-rt-main">${check('enabled', 'Dynamic Generation', '', r.enabled, false)}</div>`
                    + SCENE.map(([id, label, icon]) => {
                        const noNovel = id === 'novel' && (!r.novel.present || (!r.novel.canEnable && !r.novel.enabled));
                        return `<div class="wds-wt-row wds-rt-row">${check(id, label, icon, sceneOn(id, r), off || noNovel)}${ui.comboHtml(`rt-${id}`, sceneValue(id, r), off || (id === 'novel' && !r.novel.present))}</div>`;
                    }).join('');
            };
            refill = fill;
            fill();
            body.addEventListener('change', (e) => {
                const t = e.target;
                if (!t || !t.dataset || !t.dataset.rt) return;
                if (t.dataset.rt === 'enabled') M.rentanSetEnabled(!!t.checked);
                else M.rentanToggle(t.dataset.rt, !!t.checked);
                after();
            });
            body.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('.wm-combo[data-act^="rt-"]');
                if (!b || b.disabled) return;
                e.stopPropagation();
                const id = b.dataset.act.slice(3);
                if (ROWS[id]) sh.dropdown(b, ROWS[id](), 'right');
            });
        }

        // ---- Select Date & Time (the desktop's Time & Date dialog): Hour, Minute, Day, Month as LCD +
        // jog rows, a tap on the LCD types the value; Save sets the time of day button to it

        function timeDateDialog() {
            const v = M.rentanTimeDate();
            const ROWS4 = [['hour', 'Hour', 0, 23], ['minute', 'Minute', 0, 59], ['day', 'Day', 1, 31], ['month', 'Month', 1, 12]];
            const el = api.openDlg('Time & Date', 'wds-rtdlg wds-rttime', ROWS4.map(([k, l]) => `<div class="wds-wt-row is-on" data-td="${k}"><span class="wds-wt-name">${l}</span><button type="button" class="wds-wt-lcd wm-lcd" data-pad="${k}" aria-label="${l}: type a value"></button></div>`).join('')
                + '<div class="wm-msgbox-buttons"><button type="button" data-td-act="save">Save</button></div>');
            refill = null;
            const jogs = {};
            const show = (k) => ui.segText(el.querySelector(`[data-pad="${k}"]`), String(v[k]).padStart(2, '0'));
            ROWS4.forEach(([k, l, lo, hi]) => {
                show(k);
                jogs[k] = ui.jogWheel(el.querySelector(`[data-td="${k}"]`), { label: l, value: v[k], min: lo, max: hi, step: 1, stepPx: 18, zeroStop: 0, onChange: (x) => { v[k] = x; show(k); } });
            });
            el.addEventListener('click', (e) => {
                const pad = e.target.closest && e.target.closest('[data-pad]');
                if (pad) {
                    const row = ROWS4.find((x) => x[0] === pad.dataset.pad);
                    ui.numPad({
                        title: row[1],
                        value: String(v[row[0]]),
                        max: 2,
                        onOk: (text) => {
                            const n = Number(text);
                            if (!Number.isInteger(n) || n < row[2] || n > row[3]) return;
                            v[row[0]] = n;
                            jogs[row[0]].set(n);
                            show(row[0]);
                        }
                    });
                    return;
                }
                if (e.target.closest && e.target.closest('[data-td-act="save"]')) {
                    M.rentanSetTimeDate(v.hour, v.minute, v.day, v.month);
                    optionsDialog();
                    after();
                }
            });
        }

        // ---- Static Location (Lookup) (the desktop's Weather Location dialog): a city, Verify, Save

        function locationDialog() {
            const el = api.openDlg('Weather Location', 'wds-rtdlg wds-rtloc', `<div class="wds-rt-city">${ui.edit('', '', 'data-loc-city maxlength="80" placeholder="City" aria-label="City name"')}<button type="button" class="wm-button" data-loc-act="verify">Verify</button></div>`
                + `${ui.note('Enter a city name and tap Verify to see the matched location.')}<div class="wm-msgbox-buttons"><button type="button" data-loc-act="save" disabled>Save</button></div>`);
            refill = null;
            const note = el.querySelector('.wm-form-note');
            const save = el.querySelector('[data-loc-act="save"]');
            const input = el.querySelector('[data-loc-city]');
            let found = null;
            const verify = async () => {
                found = null;
                save.disabled = true;
                note.textContent = 'Searching...';
                const r = await M.rentanLookupCity(input.value);
                if (!el.isConnected) return;
                if (r.error) { note.textContent = r.error; return; }
                found = r;
                note.textContent = r.text;
                save.disabled = false;
            };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verify(); } });
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-loc-act]');
                if (!b || b.disabled) return;
                if (b.dataset.locAct === 'verify') { verify(); return; }
                if (found) { M.rentanSetLocation(found.location, found.display); optionsDialog(); after(); }
            });
        }

        // ---- Menu > Rentan (the desktop's Rentan menu)

        function agentRows() {
            const r = M.rentan();
            const a = M.rentanAgent();
            const rows = [{ label: 'Reduced Prompt Context', submenu: () => REDUCED.map(([v, l]) => ({ label: l, radio: (r.reduced || 'off') === v, action: act('setRentanReducedContext', v) })) }];
            if (!a) return rows;
            rows.push(
                { label: 'Engine', submenu: () => a.engines.map((x) => ({ label: x.name, radio: a.engine === x.id, action: act('setRentanAgentEngine', x.id) })) },
                {
                    label: 'Model',
                    submenu: () => {
                        const now = M.rentanAgent();
                        if (!now || !now.models.length) return [{ label: 'Loading models...', disabled: true }];
                        // the provider groups the desktop heads with separators: a rule between groups
                        const out = [];
                        let group = null;
                        now.models.forEach((m) => {
                            if (group !== null && m.group !== group) out.push('-');
                            group = m.group;
                            out.push({ label: m.name, radio: now.model === m.id, action: act('setRentanAgentModel', m.id) });
                        });
                        return out;
                    }
                }
            );
            if (a.efforts.length) rows.push({ label: 'Reasoning', submenu: () => a.efforts.map((x) => ({ label: x.name, radio: a.effort === x.id, action: act('setRentanAgentEffort', x.id) })) });
            rows.push(
                { label: 'Fast', checked: a.fast, disabled: !a.fastAvailable, action: act('toggleRentanAgentFast') },
                { label: 'Save as Default', disabled: !a.override, action: act('saveRentanAgentDefault') }
            );
            if (a.override) rows.push({ label: 'Use Default', action: act('useRentanAgentDefault') });
            return rows;
        }

        function rentanMenu() {
            const r = M.rentan();
            if (!r.enabled) {
                return [
                    { label: 'Enable', action: () => { M.rentanSetEnabled(true); after(); } },
                    { label: 'Options...', action: optionsDialog },
                    '-',
                    { label: 'Inspector', action: () => api.setTab('inspector') }
                ];
            }
            const f = r.flags;
            const c = r.compiled;
            return [
                { label: 'Options...', action: optionsDialog },
                '-',
                ...agentRows(),
                '-',
                { label: 'Inspector', action: () => api.setTab('inspector') },
                { label: 'Restore Input Prompt', disabled: !c.original, action: act('restoreRentanInputPrompt') },
                { label: 'Refresh', checked: f.forceRefresh, disabled: !c.has, action: act('toggleForceRefresh') },
                {
                    label: 'Freeze Data',
                    submenu: () => [
                        { label: 'Freeze Context', checked: f.contextLocked || f.cacheLocked, disabled: !c.context || f.cacheLocked, action: act('toggleLockContext') },
                        { label: 'Freeze Changes', checked: f.cacheLocked, disabled: !c.has, action: act('toggleLockResults') }
                    ]
                },
                {
                    label: 'Cache Controls',
                    submenu: () => [
                        { label: 'Change Cache', checked: f.useCache, action: act('toggleUseCache') },
                        { label: 'Preview Cache', checked: !f.expirePreview, disabled: !c.preview, action: act('toggleExpirePreview') },
                        { label: 'Erase Cache', disabled: !c.has, action: act('clearCompiledPrompt') }
                    ]
                },
                {
                    label: 'Optimization',
                    submenu: () => [
                        { label: 'Optimize Tokens', checked: f.tokenCount, action: act('toggleTokenCount') },
                        { label: 'Dual Pass', checked: f.twoStage, disabled: f.fastMode, action: act('toggleTwoStage') },
                        { label: 'Pass Pipeline Stage Preview', checked: f.pipelineAware, disabled: !r.stages, action: act('togglePipelineAware') },
                        { label: 'Provide Initial Prompt Preview', checked: f.initialPromptAware, action: act('toggleInitialPromptAware') }
                    ]
                },
                { label: 'Creative Options', submenu: creativeRows },
                '-',
                { label: 'Disable', action: () => { M.rentanDisable(); after(); } }
            ];
        }

        // Menu > Rentan (the program builds the top-level menu from these rows)
        reg.menu('rentan', rentanMenu);
        reg.menu('toolbox', () => [{ label: 'Rentan...', action: optionsDialog }]);
    });
})();
