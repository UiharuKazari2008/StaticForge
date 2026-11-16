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
                { label: 'Open Editor', action: openNovelEditor },
                { label: 'Generate', disabled: !s.hasNote, action: () => { M.rentanNovelDo('generate'); after(); } },
                { label: 'Undo Last Generation', disabled: !s.hasUndo, action: () => { M.rentanNovelDo('undo'); after(); } },
                { label: 'Resume Story Advancement', checked: s.resume, action: () => { M.rentanNovelDo('resume'); after(); } },
                { label: 'Select Novel Note...', action: openNovelPicker },
                { label: 'Create New Novel Note', action: newNovelNote },
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

        // ---- small helpers for the pages below

        const box = (title, text, icon = 'info') => sh.messageBox({ title, text, icon, modal: true });
        const ask = (title, text, yes = 'Yes', no = 'No', icon = 'question') => sh.messageBox({ title, text, icon, modal: true, buttons: [{ text: yes, value: true }, { text: no, value: false, default: true }], cancelValue: false });
        const busy = (p) => { try { if (sh.busy) sh.busy(p).catch(() => {}); } catch (_) { /* no busy cursor */ } return p; };
        const isView = (name) => String(api.view()) === `x:${name}`;
        const repaintIf = (name) => { if (isView(name)) api.paint(); };

        /**
         * A number row in a dialog: the LCD (a tap types the value on the number pad) and the jog.
         * o: { key, label, value, min, max, step, fineStep, digits, onChange }
         */
        const numRowHtml = (key, label) => `<div class="wds-wt-row is-on" data-num="${key}"><span class="wds-wt-name">${esc(label)}</span><button type="button" class="wds-wt-lcd wm-lcd" data-pad="${key}" aria-label="${esc(label)}: type a value"></button></div>`;
        function bindNum(dlg, o) {
            const row = dlg.querySelector(`[data-num="${o.key}"]`);
            const lcd = row.querySelector('.wm-lcd');
            let v = o.value;
            const show = () => ui.segText(lcd, Number(v).toFixed(o.digits || 0));
            show();
            const jog = ui.jogWheel(row, { label: o.label, value: v, min: o.min, max: o.max, step: o.step, fineStep: o.fineStep || 0, stepPx: 18, zeroStop: 0, onChange: (x) => { v = x; show(); o.onChange(x); } });
            lcd.addEventListener('click', () => ui.numPad({
                title: o.label,
                value: String(v),
                point: !!o.digits,
                max: 6,
                onOk: (text) => {
                    const n = Number(text);
                    if (!Number.isFinite(n) || n < o.min || n > o.max) return;
                    v = n;
                    if (jog && jog.set) jog.set(n);
                    show();
                    o.onChange(n);
                }
            }));
        }

        // ---- Erase Cache: the desktop's question as the phone's message box

        function eraseCache() {
            ask('Erase Cache', 'Are you sure you want to erase the compiled prompt?', 'Erase', 'Cancel', 'warning').then((yes) => {
                if (yes) { M.rentanEraseCache(); after(); }
            });
        }

        // ---- Compile to Prompts: run Rentan without a print, then the changes it would make as a list
        // to tick (the desktop's report list); a tap on a change shows its details

        function compileToPrompts() {
            api.closeDlg();
            ask('Compile to Prompts', 'Rentan compiles the scene to prompts now, without making a print. This is an AI run. Continue?').then((yes) => {
                if (!yes) return;
                api.openView('rtcompile');
                const p = M.rentanCompile().then((r) => {
                    api.refresh();
                    if (!r.ok) {
                        if (isView('rtcompile')) api.closeView();
                        box('Compile to Prompts', r.error, 'error');
                        return;
                    }
                    repaintIf('rtcompile');
                });
                busy(p);
            });
        }

        function compileApply(close) {
            busy(M.rentanCompileApply(close).then((r) => {
                api.refresh();
                api.edReload();
                if (!r.success) { if (r.error) box('Compile to Prompts', r.error, 'error'); api.paint(); return; }
                if (close || !M.rentanCompileState().entries.length) { if (isView('rtcompile')) api.closeView(); else api.paint(); return; }
                api.paint();
            }));
        }

        function compileDetails(i) {
            const e = M.rentanCompileState().entries[i];
            if (!e) return;
            api.openDlg(`${e.change} - ${e.field}`, 'wds-rtdlg wds-ctpdlg', `<dl class="wds-ctp-pairs">${e.details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
        }

        reg.view('rtcompile', {
            title: 'Compile Prompts',
            mount(el) {
                el.addEventListener('change', (e) => {
                    const c = e.target.closest && e.target.closest('[data-ctp-check]');
                    if (c) { M.rentanCompileInclude(Number(c.dataset.ctpCheck), !!c.checked); api.paint(); }
                });
                el.addEventListener('click', (e) => {
                    if (e.target.closest('label')) return;
                    const row = e.target.closest && e.target.closest('[data-ctp]');
                    if (row) compileDetails(Number(row.dataset.ctp));
                });
            },
            draw(el) {
                const st = M.rentanCompileState();
                if (st.inFlight) { el.innerHTML = '<p class="wds-none">Rentan is compiling the scene...</p>'; return; }
                if (!st.entries.length) { el.innerHTML = '<p class="wds-none">There are no changes to apply.</p>'; return; }
                const warn = api.toolIcon('fas fa-triangle-exclamation wm-icon-warn');
                el.innerHTML = `<div class="wm-listbox wds-ctp">${st.entries.map((e) => `<div class="wm-listbox-row wds-ctp-row" data-ctp="${e.index}"><label class="wm-check"><input type="checkbox" data-ctp-check="${e.index}"${e.included ? ' checked' : ''}${st.applying ? ' disabled' : ''} aria-label="Apply this change"><span></span></label>`
                    + `<span class="wds-ctp-text"><b>${e.warn ? warn : ''}${esc(e.change)} - ${esc(e.field)}${e.category ? ` <small>${esc(e.category)}</small>` : ''}</b><span>${e.find ? `${esc(e.find)} -&gt; ` : ''}${esc(e.text)}</span></span></div>`).join('')}</div>`;
            },
            softKeys() {
                const st = M.rentanCompileState();
                const chosen = st.entries.filter((e) => e.included).length;
                const off = st.inFlight || st.applying || !chosen;
                return {
                    left: { label: 'Apply', disabled: off, action: () => compileApply(false) },
                    right: {
                        label: 'Menu',
                        menu: () => [
                            { label: 'Select All', checked: !!st.entries.length && chosen === st.entries.length, disabled: !st.entries.length || st.applying, action: () => { M.rentanCompileInclude(-1, chosen !== st.entries.length); api.paint(); } },
                            '-',
                            { label: 'Apply and Close Rentan', disabled: off, action: () => compileApply(true) }
                        ]
                    }
                };
            }
        });

        // ---- Novel: the editor (the desktop's Novel tool window) and Select Novel Note

        let novelTimer = 0;
        let novelState = '';
        function novelStatus(el) {
            const n = M.rentanNovelNote();
            const s = el.querySelectorAll('.wds-nv-status > span');
            if (!s.length) return;
            s[0].textContent = n ? n.cursor : 'No novel note is open.';
            s[1].textContent = novelState;
        }
        function novelSaveSoon(el) {
            clearTimeout(novelTimer);
            novelState = 'Not saved';
            novelStatus(el);
            const ta = el.querySelector('textarea');
            novelTimer = setTimeout(async () => {
                novelTimer = 0;
                novelState = 'Saving...';
                novelStatus(el);
                const r = await M.rentanNovelSave(ta.value);
                novelState = r === true ? 'Saved' : String(r || '');
                novelStatus(el);
            }, 1500);
        }

        const novelMenuRows = () => {
            const n = M.rentanNovelNote();
            const s = M.rentan().novel;
            return [
                { label: 'Undo Last Generation', disabled: !n || !n.undo || n.busy, action: () => { M.rentanNovelDo('undo'); after(); } },
                { label: 'Resume Story Advancement', checked: s.resume, action: () => { M.rentanNovelDo('resume'); after(); } },
                '-',
                { label: 'Select Novel Note...', action: openNovelPicker },
                { label: 'Create New Novel Note', action: newNovelNote }
            ];
        };

        reg.view('rtnovel', {
            title: () => { const n = M.rentanNovelNote(); return n && n.name ? `${n.name} - Novel` : 'Novel'; },
            mount(el) {
                el.innerHTML = '<textarea class="wm-edit wds-nv-text" spellcheck="true" autocapitalize="sentences" placeholder="Your story... Use { what you want to happen } for intent blocks." aria-label="Story"></textarea><div class="wds-nv-status"><span></span><span></span></div>';
                el.querySelector('textarea').addEventListener('input', () => novelSaveSoon(el));
            },
            draw(el) {
                const n = M.rentanNovelNote();
                const ta = el.querySelector('textarea');
                ta.disabled = !n;
                const content = n ? n.content : '';
                // a generation only adds at the end: the caret stays; typing in flight is never overwritten
                if (!novelTimer && ta.value !== content && (document.activeElement !== ta || content.startsWith(ta.value))) {
                    const caret = ta.selectionStart;
                    ta.value = content;
                    if (document.activeElement === ta) ta.setSelectionRange(caret, caret);
                }
                novelStatus(el);
            },
            softKeys() {
                const n = M.rentanNovelNote();
                return { left: { label: 'Generate', disabled: !n || n.busy, action: () => { M.rentanNovelDo('generate'); after(); } }, right: { label: 'Menu', menu: novelMenuRows } };
            }
        });

        function openNovelEditor() {
            api.closeDlg();
            novelState = '';
            api.openView('rtnovel');
        }

        let novels = null;
        function openNovelPicker() {
            api.closeDlg();
            novels = null;
            if (isView('rtnovel')) api.closeView();
            api.openView('rtnovels');
            busy(M.rentanNovelList().then((list) => { novels = list; }).catch(() => { novels = []; }).then(() => repaintIf('rtnovels')));
        }

        function newNovelNote() {
            api.closeDlg();
            busy(M.rentanNovelNew().then((ok) => {
                if (!ok) { box('Novel', 'The novel note could not be created.', 'error'); return; }
                if (isView('rtnovels')) api.closeView();
                if (!isView('rtnovel')) openNovelEditor(); else api.paint();
                after();
            }));
        }

        reg.view('rtnovels', {
            title: 'Select Novel Note',
            mount(el) {
                el.addEventListener('click', (e) => {
                    const row = e.target.closest && e.target.closest('[data-key]');
                    if (!row) return;
                    busy(M.rentanNovelSelect(row.dataset.key).then((ok) => {
                        if (!ok) { box('Novel', 'The novel note could not be opened.', 'error'); return; }
                        api.closeView();
                        openNovelEditor();
                        after();
                    }));
                });
            },
            draw(el) {
                if (!novels) { el.innerHTML = '<p class="wds-none">Reading the novel notes...</p>'; return; }
                if (!novels.length) { el.innerHTML = '<p class="wds-none">No novel notes in this workspace</p>'; return; }
                const cur = M.rentanNovelNote();
                el.innerHTML = ui.listbox(novels.map((n) => ({ key: n.id, label: n.name, selected: !!cur && String(cur.id) === String(n.id) })));
            },
            menu: () => [{ label: 'Create New Novel Note', action: newNovelNote }]
        });

        // ---- Enshutsuka: Director Rules (the static rules: New / Edit / Delete, saved at once)

        let rules = null;
        let rulesError = '';
        function loadRules() {
            rules = null;
            rulesError = '';
            busy(M.rentanRules().then((list) => { rules = list; }).catch((err) => { rules = []; rulesError = (err && err.message) || 'The rules could not be read.'; }).then(() => repaintIf('rtrules')));
        }
        async function saveRules(next) {
            try { await busy(M.rentanSaveRules(next)); rules = next; return true; } catch (err) {
                await box('Director Rules', `The Director rules could not be saved. ${(err && err.message) || ''}`.trim(), 'error');
                return false;
            }
        }

        function ruleDialog(rule) {
            const el = api.openDlg(rule ? 'Edit Rule' : 'New Rule', 'wds-rtdlg wds-rtrule', `<textarea class="wm-edit wds-rt-area" spellcheck="true" aria-label="Rule">${esc(rule ? rule.text || '' : '')}</textarea>`
                + `<div class="wm-msgbox-buttons">${rule ? '<button type="button" data-rule-act="delete">Delete</button>' : ''}<button type="button" data-rule-act="save">Save</button></div>`);
            el.addEventListener('click', async (e) => {
                const b = e.target.closest && e.target.closest('[data-rule-act]');
                if (!b) return;
                const list = (rules || []).slice();
                if (b.dataset.ruleAct === 'delete') {
                    if (!(await ask('Delete Rule', 'Are you sure you want to delete this rule?', 'Yes', 'No', 'warning'))) return;
                    if (await saveRules(list.filter((r) => r !== rule))) { api.closeDlg(); repaintIf('rtrules'); }
                    return;
                }
                const text = String(el.querySelector('textarea').value || '').trim();
                if (!text) { box(rule ? 'Edit Rule' : 'New Rule', 'Type the rule.', 'warning'); return; }
                if (rule) { const at = list.indexOf(rule); if (at >= 0) list[at] = { ...rule, text }; } else list.push({ id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, text, created: new Date().toISOString() });
                if (await saveRules(list)) { api.closeDlg(); repaintIf('rtrules'); }
            });
        }

        reg.view('rtrules', {
            title: 'Director Rules',
            mount(el) {
                el.addEventListener('click', (e) => {
                    const row = e.target.closest && e.target.closest('[data-key]');
                    const rule = row && (rules || []).find((r) => String(r.id) === row.dataset.key);
                    if (rule) ruleDialog(rule);
                });
            },
            draw(el) {
                if (!rules) { el.innerHTML = '<p class="wds-none">Reading data, please wait...</p>'; return; }
                if (rulesError) { el.innerHTML = `<p class="wds-none">${esc(rulesError)}</p>`; return; }
                if (!rules.length) { el.innerHTML = '<p class="wds-none">No static rules are defined. Menu &gt; New Rule adds one.</p>'; return; }
                el.innerHTML = `<div class="wm-listbox wds-rt-rules">${rules.map((r) => `<button type="button" class="wm-listbox-row" data-key="${esc(r.id)}"><span>${esc(r.text || '')}</span></button>`).join('')}</div>`;
            },
            menu: () => [{ label: 'New Rule...', action: () => ruleDialog(null) }, { label: 'Refresh', action: loadRules }]
        });

        // ---- Enshutsuka: the knowledge memories (Default / Private), a memory's page with its lists

        const SORTS = [['', 'Most used'], ['name', 'Name'], ['updated', 'Updated'], ['confidence', 'Confidence'], ['category', 'Category'], ['model', 'Model']];
        const PER_PAGE = [10, 25, 50, 100];
        const STORES = [['', 'Default'], ['obliterated', 'Private']];
        const mq = { store: '', search: '', category: '', page: 1, perPage: 25, sort: '', data: null, error: '' };
        function loadMemories() {
            mq.error = '';
            busy(M.rentanMemories(mq).then((d) => {
                // a page past the end after a delete: the last page
                if (!d.memories.length && d.total && mq.page > 1) { mq.page = Math.max(1, Math.ceil(d.total / mq.perPage)); loadMemories(); return; }
                mq.data = d;
            }).catch((err) => { mq.data = { memories: [], total: 0, page: 1, categories: [] }; mq.error = (err && err.message) || 'The server did not answer.'; }).then(() => repaintIf('rtmem')));
        }
        const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;

        reg.view('rtmem', {
            title: 'Memories',
            mount(el) {
                el.innerHTML = `<div class="wds-rt-find">${ui.edit('', '', 'data-mem-find maxlength="200" placeholder="Find" aria-label="Find a memory" enterkeyhint="search"')}${ui.comboHtml('rt-store', 'Default')}</div><div class="wds-rt-mems"></div>`;
                const find = el.querySelector('[data-mem-find]');
                find.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); mq.search = find.value.trim(); mq.page = 1; loadMemories(); } });
                el.addEventListener('click', (e) => {
                    const st = e.target.closest && e.target.closest('[data-act="rt-store"]');
                    if (st) {
                        e.stopPropagation();
                        sh.dropdown(st, STORES.map(([v, l]) => ({ label: l, radio: mq.store === v, action: () => { mq.store = v; mq.page = 1; mq.category = ''; mq.data = null; loadMemories(); api.paint(); } })), 'right');
                        return;
                    }
                    const row = e.target.closest && e.target.closest('[data-key]');
                    if (row) openMemory(row.dataset.key);
                });
            },
            draw(el) {
                el.querySelector('[data-act="rt-store"] > span').textContent = STORES.find((s) => s[0] === mq.store)[1];
                const list = el.querySelector('.wds-rt-mems');
                const d = mq.data;
                if (!d) { list.innerHTML = '<p class="wds-none">Reading data, please wait...</p>'; return; }
                if (mq.error) { list.innerHTML = `<p class="wds-none">${esc(mq.error)}</p>`; return; }
                if (!d.memories.length) { list.innerHTML = `<p class="wds-none">${mq.search || mq.category ? 'No memories match the search or the category.' : 'There are no memories in this store.'}</p>`; return; }
                list.innerHTML = `<div class="wm-listbox wds-rt-memlist">${d.memories.map((m) => `<button type="button" class="wm-listbox-row" data-key="${esc(m.name)}"><span><b>${esc(m.name)}</b><small>${esc([m.category, pct(m.confidence), m.usage_count ? `${m.usage_count}x` : ''].filter(Boolean).join(' - '))}</small></span></button>`).join('')}</div>`;
            },
            menu() {
                const d = mq.data;
                const pages = d ? Math.max(1, Math.ceil(d.total / mq.perPage)) : 1;
                const cats = (d && d.categories) || [];
                const go = (fn) => () => { fn(); loadMemories(); };
                return [
                    { label: 'Previous Page', disabled: mq.page <= 1, action: go(() => { mq.page -= 1; }) },
                    { label: 'Next Page', disabled: mq.page >= pages, action: go(() => { mq.page += 1; }) },
                    '-',
                    { label: 'Category', disabled: !cats.length, submenu: () => [{ label: 'All', radio: !mq.category, action: go(() => { mq.category = ''; mq.page = 1; }) }, ...cats.slice().sort((a, b) => String(a).localeCompare(String(b))).map((c) => ({ label: c, radio: mq.category === c, action: go(() => { mq.category = c; mq.page = 1; }) }))] },
                    { label: 'Sort By', submenu: () => SORTS.map(([v, l]) => ({ label: l, radio: mq.sort === v, action: go(() => { mq.sort = v; mq.page = 1; }) })) },
                    { label: 'Items per Page', submenu: () => PER_PAGE.map((n) => ({ label: String(n), radio: mq.perPage === n, action: go(() => { mq.perPage = n; mq.page = 1; }) })) },
                    '-',
                    { label: 'Refresh', action: loadMemories }
                ];
            }
        });

        // one memory: its fields, then Observations / Entities / Relations (a tap edits one); Save sends it
        let mem = null; // { original, store, work, row }
        function openMemory(name) {
            busy(M.rentanMemory(name, mq.store).then((m) => {
                const work = JSON.parse(JSON.stringify(m));
                // the list row has the dates get_knowledge_memory leaves out
                const row = ((mq.data && mq.data.memories) || []).find((x) => x.name === name);
                if (row) ['updated_at', 'last_used_at', 'usage_count', 'model'].forEach((k) => { if (work[k] == null && row[k] != null) work[k] = row[k]; });
                ['entities', 'relations', 'observations'].forEach((k) => { if (!Array.isArray(work[k])) work[k] = []; });
                mem = { original: m.name, store: mq.store, work };
                if (memEl) memEl.dataset.sig = '';
                api.openView('rtmemone');
            }).catch((err) => box('Memories', (err && err.message) || `The memory "${name}" could not be loaded.`, 'error')));
        }

        const LISTS = {
            observations: { label: 'Observation', text: (o) => `${o.content || ''}${o.importance != null ? ` (${pct(o.importance)})` : ''}` },
            entities: { label: 'Entity', text: (e) => `${e.name || ''}${e.type ? ` - ${e.type}` : ''}` },
            relations: { label: 'Relation', text: (r) => `${r.from || ''} ${r.type || ''} ${r.to || ''} (${r.weight != null ? Number(r.weight).toFixed(2) : '1.00'})` }
        };
        // mmcEnshutsuka.js stamp(): seconds or milliseconds, a number or a date string
        const when = (v) => {
            if (!v) return 'Never';
            const n = typeof v === 'number' ? v : (/^\d+$/.test(String(v)) ? Number(v) : Date.parse(v));
            return Number.isFinite(n) && n ? new Date(n < 1e10 ? n * 1000 : n).toLocaleString() : 'Never';
        };

        function memoryHtml(w) {
            const lists = Object.keys(LISTS).map((k) => `<div class="wds-rt-memhead">${esc(k === 'observations' ? 'Observations' : k === 'entities' ? 'Entities' : 'Relations')}</div>`
                + (w[k].length ? `<div class="wm-listbox">${w[k].map((x, i) => `<button type="button" class="wm-listbox-row" data-item="${k}:${i}"><span>${esc(LISTS[k].text(x))}</span></button>`).join('')}</div>` : `<p class="wds-none">None</p>`)).join('');
            return `<div class="wds-rt-memform">${ui.row('Name:', ui.edit('', w.name || '', 'data-mf="name" maxlength="200"'))}${ui.row('Category:', ui.edit('', w.category || '', 'data-mf="category" maxlength="80"'))}`
                + `${numRowHtml('confidence', 'Confidence')}<textarea class="wm-edit wds-rt-area" data-mf="description" spellcheck="true" placeholder="Description" aria-label="Description">${esc(w.description || '')}</textarea>`
                + `${ui.note(`Used ${w.usage_count || 0} times; last ${when(w.last_used_at)}; updated ${when(w.updated_at)}; model ${w.model || '(any)'}`)}</div>${lists}`;
        }

        /** Add / Edit one item of a memory's list (the desktop's item dialogs and their checks). */
        function itemDialog(kind, i) {
            const w = mem.work;
            const item = i >= 0 ? w[kind][i] : null;
            const title = `${item ? 'Edit' : 'Add'} ${LISTS[kind].label}`;
            let body = '';
            const vals = {};
            if (kind === 'observations') {
                vals.importance = Math.round((item && item.importance != null ? Number(item.importance) : 0.5) * 100);
                body = `<textarea class="wm-edit wds-rt-area" data-if="content" spellcheck="true" aria-label="Observation">${esc(item ? item.content || '' : '')}</textarea>${numRowHtml('importance', 'Importance')}`;
            } else if (kind === 'entities') {
                body = `${ui.row('Name:', ui.edit('', item ? item.name || '' : '', 'data-if="name"'))}${ui.row('Type:', ui.edit('', item ? item.type || '' : '', 'data-if="type"'))}<textarea class="wm-edit wds-rt-area" data-if="attributes" spellcheck="false" aria-label="Attributes (JSON)">${esc(item && item.attributes && Object.keys(item.attributes).length ? JSON.stringify(item.attributes, null, 2) : '{}')}</textarea>`;
            } else {
                vals.weight = item && item.weight != null ? Number(item.weight) : 1;
                body = `${ui.row('From:', ui.edit('', item ? item.from || '' : '', 'data-if="from"'))}${ui.row('Relation:', ui.edit('', item ? item.type || '' : '', 'data-if="type"'))}${ui.row('To:', ui.edit('', item ? item.to || '' : '', 'data-if="to"'))}${numRowHtml('weight', 'Weight')}`;
            }
            const el = api.openDlg(title, 'wds-rtdlg wds-rtitem', `${body}<div class="wm-msgbox-buttons">${item ? '<button type="button" data-if-act="remove">Remove</button>' : ''}<button type="button" data-if-act="save">${item ? 'Save' : 'Add'}</button></div>`);
            if (kind === 'observations') bindNum(el, { key: 'importance', label: 'Importance', value: vals.importance, min: 0, max: 100, step: 5, fineStep: 1, onChange: (v) => { vals.importance = v; } });
            if (kind === 'relations') bindNum(el, { key: 'weight', label: 'Weight', value: vals.weight, min: 0, max: 1, step: 0.05, fineStep: 0.01, digits: 2, onChange: (v) => { vals.weight = v; } });
            const f = (k) => String((el.querySelector(`[data-if="${k}"]`) || {}).value || '').trim();
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-if-act]');
                if (!b) return;
                if (b.dataset.ifAct === 'remove') { w[kind].splice(i, 1); api.closeDlg(); return; }
                let next;
                if (kind === 'observations') {
                    if (!f('content')) { box(title, 'Type the observation.', 'warning'); return; }
                    // pictures and a finding stay with the observation
                    next = Object.assign({}, item || {}, { content: f('content'), importance: Math.max(0, Math.min(100, vals.importance)) / 100 });
                } else if (kind === 'entities') {
                    if (!f('name')) { box(title, 'Type a name.', 'warning'); return; }
                    let attributes = {};
                    if (f('attributes')) {
                        try { attributes = JSON.parse(f('attributes')); } catch (_) { box(title, 'The attributes are not valid JSON.', 'warning'); return; }
                        if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) { box(title, 'The attributes must be a JSON object.', 'warning'); return; }
                    }
                    next = { name: f('name'), type: f('type'), attributes };
                } else {
                    if (!f('from') || !f('type') || !f('to')) { box(title, 'Type From, Relation and To.', 'warning'); return; }
                    next = { from: f('from'), type: f('type'), to: f('to'), weight: Math.max(0, Math.min(1, vals.weight)) };
                }
                if (item) w[kind][i] = next; else w[kind].push(next);
                api.closeDlg();
            });
        }

        /** The page's fields into the working copy (before a dialog or Save). */
        function readMemoryForm(el) {
            if (!mem) return;
            const w = mem.work;
            el.querySelectorAll('[data-mf]').forEach((x) => { w[x.dataset.mf] = x.value; });
        }

        function saveMemory(el) {
            readMemoryForm(el);
            const w = mem.work;
            const name = String(w.name || '').trim() || mem.original;
            const updates = {
                name,
                description: String(w.description || '').trim(),
                category: String(w.category || '').trim() || null,
                confidence: w.confidence,
                entities: w.entities.filter((e) => e && e.name),
                relations: w.relations.filter((r) => r && r.from && r.type && r.to),
                observations: w.observations.filter((o) => o && o.content)
            };
            busy(M.rentanMemoryUpdate(mem.original, updates, mem.store).then(() => {
                mem = null;
                api.closeView();
                loadMemories();
            }).catch((err) => box('Memories', `The memory could not be saved. ${(err && err.message) || ''}`.trim(), 'error')));
        }

        function deleteMemory() {
            const name = mem.original;
            ask('Delete Memory', `Are you sure you want to permanently delete the memory ${name}? This cannot be undone.`, 'Yes', 'No', 'warning').then((yes) => {
                if (!yes) return;
                busy(M.rentanMemoryDelete(name, mem.store).then(() => { mem = null; api.closeView(); loadMemories(); })
                    .catch((err) => box('Memories', `The memory could not be deleted. ${(err && err.message) || ''}`.trim(), 'error')));
            });
        }

        let memEl = null;
        reg.view('rtmemone', {
            title: () => (mem ? `${mem.work.name || 'Memory'} Properties` : 'Memory'),
            mount(el) {
                memEl = el;
                el.addEventListener('input', () => readMemoryForm(el));
                el.addEventListener('click', (e) => {
                    const b = e.target.closest && e.target.closest('[data-item]');
                    if (!b || !mem) return;
                    readMemoryForm(el);
                    const [k, i] = b.dataset.item.split(':');
                    itemDialog(k, Number(i));
                });
            },
            draw(el) {
                if (!mem) { el.innerHTML = ''; return; }
                // drawn again only for a new memory or after its lists changed (a dialog closed)
                const sig = JSON.stringify([mem.original, mem.work.observations, mem.work.entities, mem.work.relations]);
                if (el.dataset.sig === sig) return;
                el.dataset.sig = sig;
                const top = el.scrollTop;
                el.innerHTML = memoryHtml(mem.work);
                el.scrollTop = top;
                bindNum(el, { key: 'confidence', label: 'Confidence', value: Math.round((Number(mem.work.confidence) || 0) * 100), min: 0, max: 100, step: 5, fineStep: 1, onChange: (v) => { if (mem) mem.work.confidence = Math.max(0, Math.min(100, v)) / 100; } });
            },
            softKeys() {
                return {
                    left: { label: 'Save', disabled: !mem, action: () => saveMemory(memEl) },
                    right: {
                        label: 'Menu',
                        menu: () => (mem ? [
                            { label: 'Add Observation...', action: () => { readMemoryForm(memEl); itemDialog('observations', -1); } },
                            { label: 'Add Entity...', action: () => { readMemoryForm(memEl); itemDialog('entities', -1); } },
                            { label: 'Add Relation...', action: () => { readMemoryForm(memEl); itemDialog('relations', -1); } },
                            '-',
                            { label: 'Delete Memory', action: deleteMemory }
                        ] : [])
                    }
                };
            }
        });

        function openRules() { loadRules(); api.openView('rtrules'); }
        function openMemories() { mq.data = null; mq.page = 1; loadMemories(); api.openView('rtmem'); }

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
                { label: 'Open Session in Director', disabled: !c.session, action: act('openRentanSession') },
                { label: 'Restore Input Prompt', disabled: !c.original, action: act('restoreRentanInputPrompt') },
                { label: 'Compile to Prompts', action: compileToPrompts },
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
                        { label: 'Erase Cache', disabled: !c.has, action: eraseCache }
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
        // Tools > Enshutsuka (the desktop's Enshutsuka launchers: the memories and the Director Rules)
        reg.menu('tools', () => [{ label: 'Enshutsuka', submenu: () => [{ label: 'Memories', action: openMemories }, { label: 'Director Rules', action: openRules }] }]);
    });
})();
