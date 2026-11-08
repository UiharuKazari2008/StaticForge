/**
 * Melaton Mobile Settings: System pages (Clock & Alarms, Regional Settings, Power, Backlight, Melaton Update, Remove Programs, About) (Yozora #709).
 * Pages for the Settings app (wmPrograms.js), added through window.wmSettings.registerPage /
 * extendPage and drawn with window.wmSettings.ui so they look like WM 6.1's own pages. Every
 * value is read and saved through the desktop's own store (one source of truth).
 * Styles: public/css/wm-settings-system.css. Runs only on Melaton Mobile (uiShell 'mobile').
 *
 *   clock            Clock & Alarms (Time, More): the desktop's Date and Time (cplDialogs.js): Melaton's
 *                    time zone HKLM\...\TimeZoneInformation TimeZoneKeyName (null = the browser's) and
 *                    DynamicDaylightTimeDisabled, Additional Clock 1 HKCU\Control Panel\TimeDate\
 *                    AdditionalClocks\1 (Enable, TzRegKeyName, DisplayName), DstReminder. WM's Alarms tab
 *                    is left out: Dreamscape has no alarms.
 *   regional         Regional Settings (Region, Number, Currency, Time, Date): HKCU\Control Panel\
 *                    International LocaleName and ...\Geo Nation, the lists from cplDialogs.js's own
 *                    Regional and Language Options fields; the other tabs show the locale's formats
 *                    (Melaton stores only the locale).
 *   power            Power (Battery, Advanced): the Battery API, and Power Options' registry (cplPages.js:
 *                    ...\Power\User\PowerSchemes ActivePowerScheme, <plan> display / sleep minutes).
 *   backlight        Backlight (Battery Power, External Power): the active plan's display minutes.
 *   update           Melaton Update (Update, Schedule): the service worker's own check / install /
 *                    restart calls (serviceWorkerManager.js) with cplUpdate.js's state words.
 *   remove-programs  Remove Programs: Programs and Features' list and its uninstall (cplPages2.js:
 *                    HKLM\...\CurrentVersion\Uninstall Hidden).
 *   about (+ Server, Hardware)  the System page's facts (cplSystem.js) and Device Manager's
 *                    categories (cplDeviceManager.js).
 * The desktop scripts that hold the shared helpers (cplDialogs.js, cplSystem.js, experienceIndex.js,
 * cplDeviceManager.js, cplUpdate.js) are loaded on demand without their styles: they only register
 * with the desktop Control Panel when it exists, so nothing of the desktop opens on the phone.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const wmSettings = window.wmSettings;
    if (!wmSettings || typeof wmSettings.registerPage !== 'function') return;
    const ui = wmSettings.ui;
    const esc = ui.esc;

    const R = () => window.melatonRegistry || null;
    const reg = (key, name, def) => (R() ? R().get(key, name, def) : def);
    const sh = () => window.wmShell || null;

    // ---------------------------------------------------------------- desktop helpers on demand

    const loading = new Map(); // src -> Promise<boolean>

    /** Load desktop scripts (featureLoader's versioned URLs, in order); resolves true when all ran. */
    function need(...srcs) {
        const one = (src) => {
            if (!loading.has(src)) {
                const fl = window.featureLoader;
                const p = fl && typeof fl._loadScript === 'function'
                    ? fl._loadScript(src).then(() => true, (err) => { console.warn('Settings: could not load', src, err); loading.delete(src); return false; })
                    : Promise.resolve(false);
                loading.set(src, p);
            }
            return loading.get(src);
        };
        return srcs.reduce((acc, src) => acc.then((ok) => one(src).then((r) => ok && r)), Promise.resolve(true));
    }

    /** Draft helper: load the scripts, then mark the draft ready and redraw its page. */
    function whenLoaded(d, srcs, after) {
        d.ready = false;
        // WM shows the wait cursor while an applet loads (no "Loading..." text); a cached script
        // resolves before the cursor's delay and nothing shows
        const loaded = need(...srcs);
        const s = sh();
        if (s && typeof s.busy === 'function') s.busy(loaded).catch(() => {});
        loaded.then((ok) => {
            d.ready = true;
            d.loadFailed = !ok;
            try { if (after) after(d); } catch (err) { console.warn('Settings: setup failed', err); }
            if (d.rerender) d.rerender();
        });
        return d;
    }

    const CPL_DIALOGS = 'scripts/comp/cplDialogs.js';

    /**
     * A combo with a long list (time zones, locales): the drop-down is kept inside the page
     * (it scrolls) and opens on the current choice. Call after ui.bindCombo on the same button.
     */
    function longCombo(btn) {
        if (!btn) return;
        btn.addEventListener('click', () => {
            const pop = document.querySelector('#wmShell > .wm-popup');
            const content = document.querySelector('#wmShell > .wm-content');
            if (!pop || pop.hidden || !content) return;
            // one layout of the ~420 rows: size the list, then scroll the choice to the middle
            // (scrollIntoView after the first measure cost a second full layout on a phone)
            const cr = content.getBoundingClientRect();
            const pr = pop.getBoundingClientRect();
            pop.style.maxHeight = `${Math.max(60, cr.bottom - pr.top - 2)}px`;
            // the list stays on the screen: as wide as the room right of it, long names cut
            pop.style.maxWidth = `${Math.max(80, cr.right - pr.left)}px`;
            pop.style.overflowX = 'hidden';
            pop.style.overflowY = 'auto';
            const cur = pop.querySelector('[aria-checked="true"]');
            if (cur) pop.scrollTop = Math.max(0, cur.offsetTop - (pop.clientHeight - cur.offsetHeight) / 2);
        });
    }

    function loadingHtml(d) {
        // still loading: the page stays blank under the shell's wait cursor (whenLoaded)
        return d.loadFailed ? ui.text('This page could not be loaded. Check the connection and try again.') : '';
    }

    // ================================================================ Clock & Alarms

    const TZ_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation';
    const TIMEDATE_KEY = 'HKCU\\Control Panel\\TimeDate';
    const CLOCK1_KEY = `${TIMEDATE_KEY}\\AdditionalClocks\\1`;

    function browserZone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; }
    }

    /** "GMT-5 New York" as WM writes a zone (the desktop's "(GMT-05:00) New York" shortened). */
    function wmZoneText(cd, zone) {
        return wmZoneLabel(cd ? cd.zoneLabel(zone) : zone);
    }

    function wmZoneLabel(label) {
        const m = /^\(GMT([+-])(\d{2}):(\d{2})\)\s*(.*)$/.exec(label);
        if (!m) return label;
        const h = Number(m[2]);
        const off = h || Number(m[3]) ? `${m[1]}${h}${m[3] !== '00' ? `:${m[3]}` : ''}` : '';
        return `GMT${off} ${m[4]}`;
    }

    /**
     * The zone list for the two combos. cplDialogs.zones() makes two Intl formatters per zone
     * (~420 zones: 2+ s in one task on a phone), so the list is built here a few zones per task,
     * with one formatter each, the same labels and order: started in the background when the page
     * draws, finished under the wait cursor if a combo is tapped first. bindCombo maps the options
     * only on its click.
     */
    let zoneOpts = null;
    function zoneOptions(cd, zone) {
        if (!cd) return [[zone, zone]];
        return { map: (f) => (zoneOpts || [[zone, wmZoneText(cd, zone)]]).map(f) };
    }

    let zoneJob = null; // { list, i, rows, jan }

    /** Builds up to `ms` of the zone list (Infinity: the rest); true once it is complete. */
    function zoneStep(ms) {
        if (zoneOpts) return true;
        if (!zoneJob) {
            let list;
            try { list = Intl.supportedValuesOf('timeZone'); } catch (_) { list = ['UTC']; }
            zoneJob = { list, i: 0, rows: [], jan: new Date(new Date().getFullYear(), 0, 1) };
        }
        const j = zoneJob;
        const until = performance.now() + ms;
        for (; j.i < j.list.length && performance.now() < until; j.i++) {
            const z = j.list[j.i];
            let off = 0;
            try {
                const part = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'longOffset' }).formatToParts(j.jan).find((p) => p.type === 'timeZoneName');
                const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(part ? part.value : '');
                if (m) { const h = Number(m[1]); off = h * 60 + Math.sign(h || 1) * Number(m[2] || 0); }
            } catch (_) { /* GMT */ }
            const a = Math.abs(off);
            const city = z.split('/').slice(1).join(', ').replace(/_/g, ' ') || z;
            // cplDialogs.zoneLabel's text
            j.rows.push({ value: z, off, text: `(GMT${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}) ${city}` });
        }
        if (j.i < j.list.length) return false;
        j.rows.sort((x, y) => x.off - y.off || x.text.localeCompare(y.text));
        zoneOpts = j.rows.map((z) => [z.value, wmZoneLabel(z.text)]);
        zoneJob = null;
        return true;
    }

    /** The background build: small steps between other work. */
    let zoneTimer = 0;
    function buildZones() {
        if (zoneOpts || zoneTimer) return;
        const tick = () => { zoneTimer = 0; if (!zoneStep(10)) zoneTimer = setTimeout(tick, 0); };
        zoneTimer = setTimeout(tick, 0);
    }

    /** A zone combo tapped before the list is built: the wait cursor paints, the rest builds, the drop-down opens. */
    function warmZones(cd, btn) {
        if (!cd || !btn) return;
        btn.addEventListener('click', (e) => {
            if (zoneOpts || btn.disabled) return;
            e.stopImmediatePropagation();
            const run = () => { clearTimeout(zoneTimer); zoneTimer = 0; zoneStep(Infinity); if (btn.isConnected) btn.click(); };
            const s = sh();
            if (s && typeof s.busy === 'function') s.busy(run, { paint: true }).catch(() => {});
            else run();
        }, true);
    }

    function clockInit() {
        const d = {
            zone: reg(TZ_KEY, 'TimeZoneKeyName', '') || browserZone(),
            autoDst: reg(TZ_KEY, 'DynamicDaylightTimeDisabled', 0) !== 1,
            c1on: !!reg(CLOCK1_KEY, 'Enable', false),
            c1zone: reg(CLOCK1_KEY, 'TzRegKeyName', browserZone()),
            c1name: reg(CLOCK1_KEY, 'DisplayName', 'Clock 1'),
            dstReminder: !!reg(TIMEDATE_KEY, 'DstReminder', true)
        };
        d.initial = { ...d };
        return whenLoaded(d, [CPL_DIALOGS]);
    }

    function clockRender(el, tab, d, api) {
        d.rerender = api.rerender;
        const cd = window.cplDialogs;
        if (!d.ready) { el.innerHTML = loadingHtml(d); return; }
        if (tab === 'more') {
            let dstText = 'Daylight Saving Time is not observed in this time zone.';
            const next = cd && cd._test && cd._test.nextDstChange ? cd._test.nextDstChange(d.zone) : null;
            if (next) {
                const delta = (next.to - next.from) / 60;
                dstText = `Daylight Saving Time ${delta > 0 ? 'begins' : 'ends'} on ${cd.fmt(d.zone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, next.at)}.`;
            }
            el.innerHTML = `${ui.check('autoDst', 'Automatically adjust clock for Daylight Saving Time', d.autoDst, next ? '' : 'disabled')}
                ${ui.check('dstReminder', 'Notify me when the clock changes', d.dstReminder, next ? '' : 'disabled')}
                ${ui.gap()}${ui.note(dstText)}`;
            el.querySelector('input[name="autoDst"]').addEventListener('change', (e) => { d.autoDst = e.target.checked; });
            el.querySelector('input[name="dstReminder"]').addEventListener('change', (e) => { d.dstReminder = e.target.checked; });
            return;
        }
        const opts = zoneOptions(cd, d.zone);
        const timeOf = (zone) => (cd ? cd.fmt(zone, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '');
        const dateOf = (zone) => (cd ? cd.fmt(zone, { month: 'numeric', day: 'numeric', year: 'numeric' }) : '');
        const off = d.c1on ? '' : ' disabled';
        el.innerHTML = `<div class="wm-sys-clock">
                <div class="wm-sys-clock-side"><b class="wm-sys-clock-name">Home</b></div>
                <div class="wm-sys-clock-fields">
                    ${ui.comboHtml('zone', wmZoneText(cd, d.zone))}
                    <input class="wm-edit" readonly data-f="time-home" value="${esc(timeOf(d.zone))}" aria-label="Time">
                    <input class="wm-edit" readonly data-f="date-home" value="${esc(dateOf(d.zone))}" aria-label="Date">
                </div>
                <div class="wm-sys-clock-side">${ui.check('c1on', 'Visiting', d.c1on, 'class="wm-sys-clock-check"')}</div>
                <div class="wm-sys-clock-fields">
                    ${ui.comboHtml('c1zone', wmZoneText(cd, d.c1zone), !d.c1on)}
                    ${ui.edit('', d.c1name, `maxlength="15" data-f="c1name" aria-label="Clock name"${off}`)}
                    <input class="wm-edit" readonly data-f="time-c1" value="${esc(timeOf(d.c1zone))}" aria-label="Time"${off}>
                    <input class="wm-edit" readonly data-f="date-c1" value="${esc(dateOf(d.c1zone))}" aria-label="Date"${off}>
                </div>
            </div>
            ${ui.note('Home is the time zone the desktop and its clocks use. Visiting is the desktop\'s first additional clock.')}`;
        const zoneBtn = el.querySelector('[data-act="zone"]');
        if (cd && !zoneOpts) buildZones();
        warmZones(cd, zoneBtn);
        warmZones(cd, el.querySelector('[data-act="c1zone"]'));
        ui.bindCombo(zoneBtn, opts, d.zone, (v) => { d.zone = v; api.rerender(); });
        longCombo(zoneBtn);
        const c1Btn = el.querySelector('[data-act="c1zone"]');
        ui.bindCombo(c1Btn, opts, d.c1zone, (v) => { d.c1zone = v; api.rerender(); });
        longCombo(c1Btn);
        el.querySelector('input[name="c1on"]').addEventListener('change', (e) => { d.c1on = e.target.checked; api.rerender(); });
        el.querySelector('[data-f="c1name"]').addEventListener('input', (e) => { d.c1name = e.target.value; });
        // the times run, as on the device
        clearInterval(d.timer);
        d.timer = setInterval(() => {
            if (!el.isConnected) { clearInterval(d.timer); return; }
            if (el.closest('[hidden]')) return; // Settings is behind another app
            const set = (f, v) => { const i = el.querySelector(`[data-f="${f}"]`); if (i && i.value !== v) i.value = v; };
            set('time-home', timeOf(d.zone));
            set('date-home', dateOf(d.zone));
            set('time-c1', timeOf(d.c1zone));
            set('date-c1', dateOf(d.c1zone));
        }, 1000);
    }

    async function clockCommit(d) {
        clearInterval(d.timer);
        const r = R();
        if (!r || !d.ready) return [];
        const i = d.initial;
        // cplDialogs.js openTimeZone: both values together, the zone null when it is the browser's
        if (d.zone !== i.zone || d.autoDst !== i.autoDst) {
            await r.set(TZ_KEY, { TimeZoneKeyName: d.zone === browserZone() ? null : d.zone, DynamicDaylightTimeDisabled: d.autoDst ? 0 : 1 });
        }
        // the Additional Clocks tab writes only the values that changed (applyFields)
        const c1 = {};
        if (d.c1on !== i.c1on) c1.Enable = d.c1on;
        if (d.c1zone !== i.c1zone) c1.TzRegKeyName = d.c1zone;
        if (d.c1name !== i.c1name) c1.DisplayName = d.c1name;
        if (Object.keys(c1).length) await r.set(CLOCK1_KEY, c1);
        if (d.dstReminder !== i.dstReminder) await r.set(TIMEDATE_KEY, { DstReminder: d.dstReminder });
        if (window.taskbarClock && typeof window.taskbarClock.refresh === 'function') window.taskbarClock.refresh();
        d.initial = { ...d, initial: undefined };
        return [];
    }

    wmSettings.registerPage({
        id: 'clock', tab: 'system', label: 'Clock & Alarms', icon: 'set-clock',
        tabs: [['time', 'Time'], ['more', 'More']],
        init: clockInit,
        render: clockRender,
        commit: clockCommit
    });

    // ================================================================ Regional Settings

    const INTL_KEY = 'HKCU\\Control Panel\\International';
    const GEO_KEY = `${INTL_KEY}\\Geo`;

    /** cplDialogs.js DIALOGS.regional's fields: [locale, nation] with their options and defaults. */
    function regionalFields() {
        const def = window.cplDialogs && window.cplDialogs.DIALOGS && window.cplDialogs.DIALOGS.regional;
        const f = def && def.fields;
        if (!f) return null;
        const locale = f.find((x) => x.name === 'LocaleName');
        const nation = f.find((x) => x.name === 'Nation');
        return locale && nation ? { locale, nation } : null;
    }

    const optionList = (field) => (typeof field.options === 'function' ? field.options() : field.options).map((o) => [o.value, o.text]);
    const fieldDefault = (field) => (typeof field.def === 'function' ? field.def() : field.def);

    // the currency each language shows in the desktop's sample (cplDialogs.js regional examples)
    function currencyFor(loc) {
        return { ja: 'JPY', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', nl: 'EUR', en: loc === 'en-GB' ? 'GBP' : 'USD', zh: 'CNY', ko: 'KRW', ru: 'RUB', pt: loc === 'pt-BR' ? 'BRL' : 'EUR' }[loc.split('-')[0]] || 'USD';
    }

    function nf(loc, n, o) {
        try { return new Intl.NumberFormat(loc, o).format(n); } catch (_) { return ''; }
    }

    function df(loc, o, at = new Date()) {
        try { return new Intl.DateTimeFormat(loc, o).format(at); } catch (_) { return ''; }
    }

    function numberParts(loc) {
        const out = { decimal: '.', group: ',', minus: '-' };
        try {
            new Intl.NumberFormat(loc).formatToParts(-1234567.89).forEach((p) => {
                if (p.type === 'decimal') out.decimal = p.value;
                else if (p.type === 'group') out.group = p.value;
                else if (p.type === 'minusSign') out.minus = p.value;
            });
        } catch (_) { /* defaults */ }
        return out;
    }

    function currencySymbol(loc) {
        try {
            const p = new Intl.NumberFormat(loc, { style: 'currency', currency: currencyFor(loc) }).formatToParts(1).find((x) => x.type === 'currency');
            return p ? p.value : currencyFor(loc);
        } catch (_) { return currencyFor(loc); }
    }

    function dayPeriods(loc) {
        const at = (h) => {
            try {
                const p = new Intl.DateTimeFormat(loc, { hour: 'numeric', hour12: true }).formatToParts(new Date(2026, 0, 1, h)).find((x) => x.type === 'dayPeriod');
                return p ? p.value : '';
            } catch (_) { return ''; }
        };
        return { am: at(9), pm: at(21) };
    }

    const show = (s) => (s === '' || s == null ? '(none)' : s.replace(/ | /g, ' ') || '(space)');

    function regionalInit() {
        const d = { locale: reg(INTL_KEY, 'LocaleName', null), nation: reg(GEO_KEY, 'Nation', null) };
        return whenLoaded(d, [CPL_DIALOGS], () => {
            const f = regionalFields();
            if (!f) return;
            // the desktop's defaults when the registry has no value (the browser's locale)
            if (d.locale == null) d.locale = fieldDefault(f.locale);
            if (d.nation == null) d.nation = fieldDefault(f.nation);
            d.initial = { locale: d.locale, nation: d.nation };
        });
    }

    function regionalRender(el, tab, d, api) {
        d.rerender = api.rerender;
        const f = d.ready ? regionalFields() : null;
        if (!f) { el.innerHTML = loadingHtml(d); return; }
        const loc = d.locale || 'en-US';
        const now = new Date();
        const facts = (pairs) => `<div class="wm-sys-facts">${ui.facts(pairs.map(([a, b]) => [a, show(b)]))}</div>`;
        if (tab === 'number') {
            const p = numberParts(loc);
            el.innerHTML = `${facts([
                ['Decimal symbol:', p.decimal],
                ['Digit grouping symbol:', p.group],
                ['Negative sign symbol:', p.minus],
                ['Positive number:', nf(loc, 123456789, { minimumFractionDigits: 2 })],
                ['Negative number:', nf(loc, -123456789, { minimumFractionDigits: 2 })]
            ])}${ui.gap()}${ui.note('The number format follows the region. Change it on the Region tab.')}`;
            return;
        }
        if (tab === 'currency') {
            const c = currencyFor(loc);
            el.innerHTML = `${facts([
                ['Currency symbol:', currencySymbol(loc)],
                ['Currency:', c],
                ['Positive:', nf(loc, 123456789, { style: 'currency', currency: c })],
                ['Negative:', nf(loc, -123456789, { style: 'currency', currency: c })]
            ])}${ui.gap()}${ui.note('The currency format follows the region. Change it on the Region tab.')}`;
            return;
        }
        if (tab === 'time') {
            const per = dayPeriods(loc);
            el.innerHTML = `${facts([
                ['Time:', df(loc, { hour: 'numeric', minute: '2-digit', second: '2-digit' }, now)],
                ['Short time:', df(loc, { hour: 'numeric', minute: '2-digit' }, now)],
                ['AM symbol:', per.am],
                ['PM symbol:', per.pm]
            ])}${ui.gap()}${ui.note('The time format follows the region. Change it on the Region tab.')}`;
            return;
        }
        if (tab === 'date') {
            el.innerHTML = `${facts([
                ['Short date:', df(loc, { year: 'numeric', month: 'numeric', day: 'numeric' }, now)],
                ['Long date:', df(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, now)]
            ])}${ui.gap()}${ui.note('The date format follows the region. Change it on the Region tab.')}`;
            return;
        }
        const locales = optionList(f.locale);
        const nations = optionList(f.nation);
        const label = (list, v) => (list.find(([k]) => k === v) || [v, v])[1];
        const c = currencyFor(loc);
        el.innerHTML = `${ui.sub('Your locale:')}
            ${ui.comboHtml('locale', label(locales, loc))}
            ${ui.sub('Location:')}
            ${ui.comboHtml('nation', label(nations, d.nation))}
            ${ui.gap()}
            <div class="wm-sys-facts">${ui.facts([
                ['Positive numbers:', nf(loc, 123456789, { minimumFractionDigits: 2 })],
                ['Negative numbers:', nf(loc, -123456789, { minimumFractionDigits: 2 })],
                ['Positive currency:', nf(loc, 123456789, { style: 'currency', currency: c })],
                ['Negative currency:', nf(loc, -123456789, { style: 'currency', currency: c })],
                ['Time:', df(loc, { hour: 'numeric', minute: '2-digit', second: '2-digit' }, now)],
                ['Short date:', df(loc, { year: 'numeric', month: 'numeric', day: 'numeric' }, now)],
                ['Long date:', df(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, now)]
            ].map(([a, b]) => [a, show(b)]))}</div>`;
        const lb = el.querySelector('[data-act="locale"]');
        ui.bindCombo(lb, locales, loc, (v) => { d.locale = v; api.rerender(); });
        longCombo(lb);
        const nb = el.querySelector('[data-act="nation"]');
        ui.bindCombo(nb, nations, d.nation, (v) => { d.nation = v; });
        longCombo(nb);
    }

    async function regionalCommit(d) {
        const r = R();
        if (!r || !d.ready || !d.initial) return [];
        if (d.locale !== d.initial.locale) await r.set(INTL_KEY, { LocaleName: d.locale });
        if (d.nation !== d.initial.nation) await r.set(GEO_KEY, { Nation: d.nation });
        // the desktop's Apply: the taskbar clock and the dates follow the format (taskbarClock.js)
        if (window.taskbarClock && typeof window.taskbarClock.refresh === 'function') window.taskbarClock.refresh();
        d.initial = { locale: d.locale, nation: d.nation };
        return [];
    }

    wmSettings.registerPage({
        id: 'regional', tab: 'system', label: 'Regional Settings', icon: 'set-regional',
        tabs: [['region', 'Region'], ['number', 'Number'], ['currency', 'Currency'], ['time', 'Time'], ['date', 'Date']],
        init: regionalInit,
        render: regionalRender,
        commit: regionalCommit
    });

    // ================================================================ Power and Backlight

    // Power Options' registry and plans as cplPages.js keeps them (its PLANS / MINUTES are not
    // exported): the same key, value names and defaults
    const POWER_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes';
    const PLANS = [
        { id: 'balanced', name: 'Balanced', display: 20, sleep: 60 },
        { id: 'saver', name: 'Power saver', display: 20, sleep: 60 },
        { id: 'high', name: 'High performance', display: 20, sleep: 0 }
    ];
    const MINUTES = [1, 2, 3, 5, 10, 15, 20, 25, 30, 45, 60, 120, 180, 240, 300];

    function minuteText(m) {
        if (!m) return 'Never';
        if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
        return `${m / 60} hour${m === 60 ? '' : 's'}`;
    }

    const activePlan = () => reg(POWER_KEY, 'ActivePowerScheme', 'balanced');
    const planOf = (id) => PLANS.find((p) => p.id === id) || PLANS[0];
    const planValue = (id, name) => Number(reg(`${POWER_KEY}\\${planOf(id).id}`, name, planOf(id)[name]));

    /** Every plan's display / sleep as stored, so a plan switch shows that plan's own values. */
    function powerInit() {
        const plans = {};
        PLANS.forEach((p) => { plans[p.id] = { display: planValue(p.id, 'display'), sleep: planValue(p.id, 'sleep') }; });
        const d = { plan: activePlan(), plans, battery: null };
        d.initial = { plan: d.plan, plans: JSON.parse(JSON.stringify(plans)) };
        if (navigator.getBattery) {
            navigator.getBattery().then((b) => {
                d.battery = b;
                const redraw = () => { if (d.rerender && d.tab === 'battery') d.rerender(); };
                ['levelchange', 'chargingchange'].forEach((ev) => b.addEventListener(ev, redraw));
                if (d.rerender) d.rerender();
            }).catch(() => { d.battery = false; if (d.rerender) d.rerender(); });
        } else {
            d.battery = false;
        }
        return d;
    }

    /** "Turn off ... if not used for" + its combo, WM's idiom (unchecked = Never). */
    function minutesControl(el, d, name, label, { onChange } = {}) {
        const cur = d.plans[d.plan][name];
        const host = document.createElement('div');
        host.className = 'wm-sys-minutes';
        const list = MINUTES.slice();
        if (cur && !list.includes(cur)) list.push(cur);
        list.sort((a, b) => a - b);
        host.innerHTML = `${ui.check(`on-${name}`, label, cur > 0)}
            <div class="wm-sys-minutes-combo">${ui.comboHtml(`min-${name}`, minuteText(cur || d[`last_${name}`] || planOf(d.plan)[name] || 3), !cur)}</div>`;
        el.appendChild(host);
        const btn = host.querySelector(`[data-act="min-${name}"]`);
        const remember = cur || d[`last_${name}`] || planOf(d.plan)[name] || 3;
        ui.bindCombo(btn, list.map((m) => [m, minuteText(m)]), remember, (v) => {
            d.plans[d.plan][name] = v;
            d[`last_${name}`] = v;
            if (onChange) onChange();
        });
        host.querySelector(`input[name="on-${name}"]`).addEventListener('change', (e) => {
            d.plans[d.plan][name] = e.target.checked ? (d[`last_${name}`] || remember) : 0;
            btn.disabled = !e.target.checked;
            if (onChange) onChange();
        });
    }

    function batteryHtml(d) {
        const b = d.battery;
        if (b === null) return ui.text('Checking the battery...');
        const level = b ? Math.round(b.level * 100) : null;
        const status = !b ? 'Unknown' : b.charging ? (level >= 100 ? 'Charged' : 'Charging') : 'On battery';
        const bar = level == null ? '' : `<div class="wm-sys-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${level}"><div style="width:${level}%"></div></div>`;
        return `${ui.sub('Main battery:')}
            <div class="wm-sys-battery">${bar}<span>${level == null ? 'Unknown' : `Battery remaining: ${level}%`}</span></div>
            ${ui.value('Status:', status)}
            ${ui.gap()}
            ${b ? '' : ui.note('This browser does not report the battery.')}`;
    }

    function powerRender(el, tab, d, api) {
        d.rerender = api.rerender;
        d.tab = tab;
        if (tab === 'battery') { el.innerHTML = batteryHtml(d); return; }
        el.innerHTML = `${ui.sub('Power plan:')}
            ${PLANS.map((p) => ui.radio('plan', p.id, p.name, p.id === d.plan)).join('')}
            ${ui.gap()}
            <div data-f="min"></div>
            ${ui.note('The plans and this time are the desktop\'s Power Options values.')}`;
        el.querySelectorAll('input[name="plan"]').forEach((r) => r.addEventListener('change', () => {
            if (!r.checked) return;
            d.plan = r.value;
            api.rerender();
        }));
        minutesControl(el.querySelector('[data-f="min"]'), d, 'sleep', 'Turn off device if not used for');
    }

    /** Power Options' own writes: the active plan (handlers['power-options'].change), then the plan's minutes (power-plan save). */
    async function powerCommit(d) {
        const r = R();
        if (!r) return [];
        const i = d.initial;
        if (d.plan !== i.plan) {
            await r.set(POWER_KEY, { ActivePowerScheme: d.plan });
            window.dispatchEvent(new CustomEvent('melaton-power-plan', { detail: { plan: d.plan } }));
        }
        for (const p of PLANS) {
            const now = d.plans[p.id];
            const was = i.plans[p.id];
            if (now.display === was.display && now.sleep === was.sleep) continue;
            const values = { display: now.display, sleep: now.sleep };
            await r.set(`${POWER_KEY}\\${p.id}`, values);
            window.dispatchEvent(new CustomEvent('melaton-power-plan', { detail: { plan: p.id, ...values } }));
        }
        d.initial = { plan: d.plan, plans: JSON.parse(JSON.stringify(d.plans)) };
        return [];
    }

    wmSettings.registerPage({
        id: 'power', tab: 'system', label: 'Power', icon: 'set-power',
        tabs: [['battery', 'Battery'], ['advanced', 'Advanced']],
        init: powerInit,
        render: powerRender,
        commit: powerCommit
    });

    function backlightRender(el, tab, d, api) {
        d.rerender = api.rerender;
        d.tab = tab;
        const ext = tab === 'external';
        el.innerHTML = `${ui.text(ext ? 'On external power:' : 'On battery power:')}
            <div data-f="min"></div>
            ${ui.gap()}
            ${ui.note(`Battery Power and External Power set the same value: the display time of the desktop's active Power Options plan (${planOf(d.plan).name}).`)}`;
        minutesControl(el.querySelector('[data-f="min"]'), d, 'display', 'Turn off backlight if device is not used for');
    }

    wmSettings.registerPage({
        id: 'backlight', tab: 'system', label: 'Backlight', icon: 'set-backlight',
        tabs: [['battery', 'Battery Power'], ['external', 'External Power']],
        init: powerInit,
        render: backlightRender,
        commit: powerCommit
    });

    // ================================================================ Melaton Update

    const swm = () => window.serviceWorkerManager || null;

    /** Where things stand before a check answers (cplUpdate.js initialState). */
    function updateInitialState() {
        const m = swm();
        if (!m) return { state: 'failed', message: 'The update service is not running.' };
        if (m.agentSession) return { state: 'failed', message: 'This is an agent session: its files are updated by the agent that runs it.' };
        if (m.isUpdating) return { state: 'downloading', progress: m.updateProgress || 0, filesTotal: (m.trayPopup && m.trayPopup.filesTotal) || 0 };
        if (m.servicePack && m.servicePack.label) return { state: 'upgrade', message: m.servicePack.label };
        if (m.pendingApplyFiles && m.pendingApplyFiles.length) return { state: 'ready' };
        if (m.hasPendingUpdates && m.hasPendingUpdates()) return { state: 'restart' };
        return { state: 'idle' };
    }

    function stampText(key) {
        let raw = null;
        try { raw = localStorage.getItem(key); } catch (_) { /* private mode */ }
        const n = Number(raw);
        if (!raw || !Number.isFinite(n) || n <= 0) return 'Never';
        const at = new Date(n);
        const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return at.toDateString() === new Date().toDateString() ? `Today at ${time}` : `${at.toLocaleDateString()} at ${time}`;
    }

    // the desktop page's wording per state (cplUpdate.js box())
    function updateView(v) {
        const m = swm();
        const files = v.filesTotal || (m && m.pendingUpdateFilesTotal) || 0;
        const fileText = files ? `${files} ${files === 1 ? 'file' : 'files'}` : 'the updated files';
        const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
        switch (v.state) {
            case 'preparing': return { icon: 'info', title: 'Preparing system to update...', text: 'Getting the server ready.', bar: v.progress > 0 ? v.progress : null };
            case 'checking': return { icon: 'info', title: 'Checking for updates...', text: 'Looking for updates on the server.', bar: null };
            case 'available': return { icon: 'warning', title: 'Updates are available', text: v.message && !/available\.?$/i.test(v.message) ? v.message : 'Updates to Melaton are available.', button: ['install', 'Install'] };
            case 'downloading': return { icon: 'info', title: 'Downloading updates...', text: `Downloading ${fileText} (${Math.round(v.progress || 0)}% complete)`, bar: v.progress || 0 };
            case 'installing': return { icon: 'info', title: 'Installing updates...', text: `Installing ${fileText}. Melaton keeps running while they install.`, bar: null };
            case 'ready': return { icon: 'warning', title: 'Install updates', text: `${cap(fileText)} downloaded. They change styles and assets only, so they install without restarting Melaton.`, button: ['apply', 'Install'] };
            case 'restart': return { icon: 'warning', title: 'Restart to finish installing updates', text: `${cap(fileText)} downloaded and ready. Save your work before restarting.`, button: ['restart', 'Restart'] };
            case 'upgrade': return { icon: 'warning', title: v.message || 'Upgrade to Service Pack', text: 'This update is too large to install while Melaton is running. Restart to install it.', button: ['restart', 'Restart'] };
            case 'uptodate': return { icon: 'info', title: 'Melaton is up to date', text: 'There are no updates available for your device.', button: ['check', 'Check Now'] };
            case 'failed': return { icon: 'error', title: 'Melaton could not search for new updates', text: v.message || 'The server did not answer.', button: ['check', 'Try Again'] };
            default: return { icon: 'info', title: 'Melaton Update', text: 'Check for updates to Melaton and install them.', button: ['check', 'Check Now'] };
        }
    }

    function updateInit() {
        const d = { view: { message: '', progress: 0, filesTotal: 0, ...updateInitialState() } };
        // cplUpdate.js's classify turns the service worker's state words into the page's
        return whenLoaded(d, ['scripts/comp/cplUpdate.js']);
    }

    /** The manager's own fields, while a download runs or after it (the phone has no tray to report them). */
    function pollUpdate(d) {
        const m = swm();
        const st = d.view.state;
        if (!m || !(st === 'checking' || st === 'downloading')) return false;
        let next = null;
        if (m.isUpdating) {
            const progress = m.updateProgress || 0;
            const filesTotal = m.pendingUpdateFilesTotal || (m.trayPopup && m.trayPopup.filesTotal) || d.view.filesTotal || 0;
            if (st !== 'downloading' || progress !== d.view.progress || filesTotal !== d.view.filesTotal) next = { state: 'downloading', message: '', progress, filesTotal };
        } else if (st === 'downloading') {
            // the download ended: install now (styles and assets), restart, or nothing left
            const now = updateInitialState();
            next = now.state === 'idle' ? { state: 'uptodate' } : now;
        }
        if (!next) return false;
        d.view = next;
        return true;
    }

    /**
     * While the page shows, every state the manager reports comes here (the desktop page's hook),
     * and the page's own check runs silently (noToast), so no update bubble comes up over it.
     * Behind another app or gone, the hook is handed back.
     */
    function attachForeground(d, el) {
        const m = swm();
        if (!m) return;
        const view = (state, info) => {
            if (!el.isConnected || el.closest('[hidden]')) { if (m.foregroundUpdateView === view) m.foregroundUpdateView = null; return; }
            const cu = window.cplUpdate;
            const st = cu && typeof cu.classify === 'function' ? cu.classify(state, info && info.message) : state;
            d.view = { state: st, message: info && info.message, progress: info && info.progress, filesTotal: info && info.filesTotal };
            if (d.rerender) d.rerender();
        };
        m.foregroundUpdateView = view;
        clearInterval(d.watch);
        d.watch = setInterval(() => {
            if (!el.isConnected) {
                clearInterval(d.watch);
                if (m.foregroundUpdateView === view) m.foregroundUpdateView = null;
                return;
            }
            if (el.closest('[hidden]')) {
                // Settings is behind Start, Today or another app: states go to the shell again
                if (m.foregroundUpdateView === view) m.foregroundUpdateView = null;
                return;
            }
            if (!m.foregroundUpdateView) m.foregroundUpdateView = view;
            if (pollUpdate(d) && d.rerender) d.rerender();
        }, 500);
    }

    function updateAct(d, what) {
        const m = swm();
        if (!m) return;
        if (what === 'check' || what === 'install') {
            // the desktop page's own check (cplUpdate.js check() without refreshServerCacheAndCheck:
            // that one opens the desktop Control Panel on its prepare stage, which the phone has not).
            // Silent: the phone's toasts are bubbles, and this page shows the progress itself.
            d.view = { state: 'checking', message: '', progress: 0, filesTotal: 0 };
            if (d.rerender) d.rerender();
            Promise.resolve(m.checkStaticFileUpdates(true)).then(() => {
                if (d.view.state !== 'checking' && d.view.state !== 'preparing') return;
                if (m.isUpdating) pollUpdate(d);
                else {
                    const now = updateInitialState();
                    d.view = now.state === 'idle' ? { state: 'uptodate' } : now;
                }
                if (d.rerender) d.rerender();
            });
        } else if (what === 'apply' && typeof m.applyStaticCacheUpdate === 'function') {
            d.view = { ...d.view, state: 'installing' };
            if (d.rerender) d.rerender();
            Promise.resolve(m.applyStaticCacheUpdate(m.pendingApplyFiles || [])).finally(() => {
                try { localStorage.setItem('meletonUpdateInstalledAt', String(Date.now())); } catch (_) { /* private mode */ }
                d.view = { state: 'uptodate' };
                if (d.rerender) d.rerender();
            });
        } else if (what === 'restart' && typeof m.forceRestart === 'function') {
            m.forceRestart();
        }
    }

    function updateRender(el, tab, d, api) {
        d.rerender = api.rerender;
        if (tab === 'schedule') {
            el.innerHTML = `${ui.text('Melaton downloads updates in the background and installs them when Melaton restarts (recommended).')}
                ${ui.radio('sched', 'auto', 'Automatic', true, 'disabled')}
                ${ui.radio('sched', 'manual', 'Manual', false, 'disabled')}
                ${ui.gap()}
                ${ui.value('Last checked:', stampText('meletonUpdateCheckedAt'), { wide: true })}
                ${ui.value('Last installed:', stampText('meletonUpdateInstalledAt'), { wide: true })}
                ${ui.gap()}
                ${ui.note('Melaton has no setting to turn automatic updating off; the desktop updates the same way.')}`;
            return;
        }
        const v = updateView(d.view);
        const pct = v.bar == null ? null : Math.max(0, Math.min(100, Math.round(v.bar)));
        const bar = 'bar' in v ? `<div class="wm-sys-meter${pct == null ? ' is-marquee' : ''}" role="progressbar"${pct == null ? ' aria-label="Working"' : ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"`}><div${pct == null ? '' : ` style="width:${pct}%"`}></div></div>` : '';
        const art = ui.art(`msgbox-${v.icon}`);
        el.innerHTML = `<div class="wm-sys-update">
                <img class="wm-sys-update-icon" src="${esc(art.src)}"${art.srcset ? ` srcset="${esc(art.srcset)}"` : ''} alt="" draggable="false">
                <div class="wm-sys-update-text"><b>${esc(v.title)}</b><p>${esc(v.text)}</p></div>
            </div>
            ${bar}
            ${v.button ? ui.buttons([[v.button[0], v.button[1]]]) : ''}
            ${ui.gap()}
            ${ui.value('Last checked:', stampText('meletonUpdateCheckedAt'), { wide: true })}
            ${ui.value('Last installed:', stampText('meletonUpdateInstalledAt'), { wide: true })}`;
        const btn = el.querySelector('.wm-button');
        if (btn) btn.addEventListener('click', () => updateAct(d, btn.dataset.act));
        attachForeground(d, el);
    }

    wmSettings.registerPage({
        id: 'update', tab: 'system', label: 'Melaton Update', icon: 'set-update',
        tabs: [['update', 'Update'], ['schedule', 'Schedule']],
        init: updateInit,
        render: updateRender,
        commit(d) {
            clearInterval(d.watch);
            const m = swm();
            if (m && m.foregroundUpdateView) m.foregroundUpdateView = null;
            return [];
        }
    });

    // ================================================================ Remove Programs

    const UNINSTALL_KEY = 'HKLM\\Software\\Xyridian\\Melaton\\CurrentVersion\\Uninstall';

    /** Programs and Features' list (cplPages2.js programs()): the Start menu's programs not hidden. */
    function installedPrograms() {
        const list = typeof window.collectStartMenuLaunchableDescriptors === 'function' ? window.collectStartMenuLaunchableDescriptors() : [];
        const hidden = reg(UNINSTALL_KEY, 'Hidden', []);
        return list.filter((p) => p.text && !hidden.includes(p.launchId))
            .map((p) => ({ id: p.launchId, name: p.text }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    function fmtStorage(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n < 0) return 'Unknown';
        if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
        if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)} MB`;
        return `${Math.round(n / 1024).toLocaleString()} KB`;
    }

    function removeInit() {
        const d = { sel: null, est: null };
        if (navigator.storage && typeof navigator.storage.estimate === 'function') {
            navigator.storage.estimate().then((e) => { d.est = e; if (d.rerender) d.rerender(); }).catch(() => {});
        }
        return d;
    }

    function removeRender(el, tab, d, api) {
        d.rerender = api.rerender;
        const list = installedPrograms();
        if (d.sel && !list.some((p) => p.id === d.sel)) d.sel = null;
        const free = d.est && Number.isFinite(d.est.quota) ? d.est.quota - (d.est.usage || 0) : NaN;
        el.innerHTML = `${ui.text('Programs in storage memory:')}
            ${list.length ? ui.listbox(list.map((p) => ({ key: p.id, label: p.name, selected: p.id === d.sel })), { maxHeight: 190 }) : '<div class="wm-listbox wm-sys-empty"></div>'}
            ${ui.buttons([['remove', 'Remove', !d.sel]])}
            ${ui.gap()}
            ${ui.text(`Total storage memory available: ${fmtStorage(free)}`)}
            ${ui.note('Removed programs leave this list and the desktop\'s Programs and Features. The desktop\'s Turn Melaton features on or off brings them back.')}`;
        ui.bindListbox(el.querySelector('.wm-listbox'), (key) => {
            d.sel = key;
            const b = el.querySelector('[data-act="remove"]');
            if (b) b.disabled = false;
        });
        el.querySelector('[data-act="remove"]').addEventListener('click', async () => {
            const p = installedPrograms().find((x) => x.id === d.sel);
            if (!p) return;
            // the desktop's question (cplPages2.js handlers.programs.uninstall), as a WM message box
            const yes = await ui.messageBox({
                title: 'Remove Programs', icon: 'question',
                text: `Are you sure you want to remove ${p.name}? Melaton removes it from the Start menu. You can bring it back from Turn Melaton features on or off.`,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }],
                cancelValue: false
            });
            if (!yes) return;
            const r = R();
            if (!r) {
                await ui.messageBox({ title: 'Remove Programs', icon: 'error', text: `${p.name} could not be removed. Melaton is not connected.` });
                return;
            }
            // WM's wait cursor while the server takes it
            await (window.wmShell && typeof window.wmShell.busy === 'function' ? window.wmShell.busy(() => r.set(UNINSTALL_KEY, { Hidden: reg(UNINSTALL_KEY, 'Hidden', []).concat([p.id]) })) : r.set(UNINSTALL_KEY, { Hidden: reg(UNINSTALL_KEY, 'Hidden', []).concat([p.id]) }));
            d.sel = null;
            api.rerender();
        });
    }

    wmSettings.registerPage({
        id: 'remove-programs', tab: 'system', label: 'Remove Programs', icon: 'set-remove-programs',
        tabs: [],
        init: removeInit,
        render: removeRender
    });

    // ================================================================ About: Server, Hardware

    function aboutInit() {
        // nothing loads or runs (Experience Index, devices, version) until a Server or Hardware tab shows
        return { started: false, ready: false, sys: null, rating: null, ratingFailed: false, cats: null, sysFailed: false };
    }

    function aboutStart(d) {
        d.started = true;
        whenLoaded(d, ['scripts/comp/experienceIndex.js', 'scripts/comp/cplSystem.js', 'scripts/comp/cplDeviceManager.js'], () => {
            // the System page's sources: the cached version info (get_system_info), the session's rating
            const vi = typeof window.getMeletonVersionInfo === 'function' ? window.getMeletonVersionInfo() : null;
            d.version = vi;
            d.sys = vi && vi.systemInfo ? vi.systemInfo : null;
            if (!d.sys && typeof window.loadMeletonVersionInfo === 'function') {
                window.loadMeletonVersionInfo().then((info) => {
                    d.version = info;
                    d.sys = info && info.systemInfo ? info.systemInfo : null;
                    d.sysFailed = !d.sys;
                    if (d.rerender) d.rerender();
                }).catch(() => { d.sysFailed = true; if (d.rerender) d.rerender(); });
            }
            const ei = window.meletonExperienceIndex;
            if (ei) {
                d.rating = ei.cached();
                if (!d.rating) {
                    ei.assess().then((r) => { d.rating = r; if (d.rerender) d.rerender(); })
                        .catch(() => { d.ratingFailed = true; if (d.rerender) d.rerender(); });
                }
            } else {
                d.ratingFailed = true;
            }
            const dm = window.melatonDeviceManager;
            if (dm && typeof dm.categories === 'function') {
                dm.categories().then((c) => { d.cats = c; if (d.rerender) d.rerender(); }).catch(() => { d.cats = []; if (d.rerender) d.rerender(); });
            } else {
                d.cats = [];
            }
        });
    }

    function aboutRender(el, tab, d, api) {
        d.rerender = api.rerender;
        if (!d.started) aboutStart(d);
        if (!d.ready) { el.innerHTML = loadingHtml(d); return; }
        if (tab === 'sys-hardware') {
            if (!d.cats) { el.innerHTML = ui.text('Looking for devices...'); return; }
            const rows = [];
            d.cats.forEach((c, i) => {
                rows.push({ key: `c${i}`, label: c.name, img: c.icon });
                c.devices.forEach((dev, k) => rows.push({ key: `c${i}-${k}`, label: dev, indent: true }));
            });
            el.innerHTML = `${ui.text('Devices this browser can see (Device Manager):')}
                <div class="wm-sys-devices">${ui.listbox(rows, { maxHeight: 240 })}</div>`;
            ui.bindListbox(el.querySelector('.wm-listbox'));
            return;
        }
        const T = window.cplSystem && window.cplSystem._test;
        if (!T) { el.innerHTML = loadingHtml({ loadFailed: true }); return; }
        const host = T.hostFacts(d.sys);
        const pending = !d.sys && !d.sysFailed;
        const v = (s) => s || (pending ? 'Checking...' : 'Not available');
        const ed = T.edition(d.version, d.sys);
        const account = T.novelAiAccount(window.optionsData);
        const pid = T.productId(account);
        let rating = 'Assessing this session...';
        if (d.rating && typeof d.rating.base === 'number') rating = `${d.rating.base.toFixed(1)} Melaton Experience Index`;
        else if (d.ratingFailed || (d.rating && d.rating.base === null)) rating = 'System rating is not available';
        const activation = { activated: 'Melaton is activated', none: 'Melaton is not activated' }[account.state] || 'Checking activation...';
        const net = window.melatonNetworkDialogs && typeof window.melatonNetworkDialogs.connectionInfo === 'function'
            ? window.melatonNetworkDialogs.connectionInfo() : { domain: 'DREAMSCAPE', fqdn: location.hostname };
        el.innerHTML = `<p>${esc(ed.name)}${ed.servicePack ? `<br>${esc(ed.servicePack)}` : ''}</p>
            ${ui.sub('Server')}
            <div class="wm-sys-facts">${ui.facts([
                ['Manufacturer:', T.OEM.manufacturer],
                ['Model:', T.OEM.model],
                ['Rating:', rating],
                ['Processor:', v(host.processor ? `${host.processor}${host.clock ? ` ${host.clock}` : ''}` : '')],
                ['Memory (RAM):', v(host.memory)],
                ['System type:', v(host.type)],
                ['Computer name:', v(host.hostname)],
                ['Full name:', v(net.fqdn)],
                ['Domain:', net.domain || 'DREAMSCAPE']
            ])}</div>
            ${ui.sub('Activation')}
            <div class="wm-sys-facts">${ui.facts([
                ['Status:', activation],
                ['Product ID:', pid || 'Not available']
            ])}</div>`;
    }

    wmSettings.extendPage('about', {
        id: 'sys',
        tabs: [['sys-server', 'Server'], ['sys-hardware', 'Hardware']],
        after: 'device',
        init: aboutInit,
        render: aboutRender
    });
})();
