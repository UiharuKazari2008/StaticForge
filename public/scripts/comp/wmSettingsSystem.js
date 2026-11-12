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
 *                    (Melaton stores the locale and the time style; app.html regionalFormats applies them).
 *   power            Power (Battery, Advanced): the Battery API, and Power Options' registry (cplPages.js:
 *                    ...\Power\User\PowerSchemes ActivePowerScheme, <plan> display / sleep minutes).
 *   backlight        Backlight (Battery Power, External Power): the active plan's display minutes.
 *   update           Melaton Update (Update, Schedule, Version): the service worker's own check /
 *                    install / restart calls (serviceWorkerManager.js) with cplUpdate.js's state
 *                    words; Version picks the Melaton Mobile UI version (6.1 / 6.5, #739).
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

    /**
     * The time styles a locale offers, as Windows writes them: 12 or 24 hours, with or without a
     * leading zero, in the locale's own separator and AM / PM place. The first is the locale's own.
     */
    function timeStyles(loc) {
        const own = timePicture(loc);
        const s = own.sep;
        const lead = /^tt/.test(own.pic);
        const h12 = (h) => (lead ? `tt ${h}${s}mm${s}ss` : `${h}${s}mm${s}ss tt`);
        const all = [h12('h'), h12('hh'), `H${s}mm${s}ss`, `HH${s}mm${s}ss`];
        const norm = (p) => p.replace(/\s+/g, ' ').trim();
        const mine = all.find((p) => norm(p) === norm(own.pic)) || own.pic;
        return [mine, ...all.filter((p) => p !== mine)];
    }

    /** Intl options for a time picture ("HH:mm:ss"): the hour cycle and the hour's leading zero. */
    function timeOpts(pic, o) {
        if (!pic) return o;
        return Object.assign({}, o, { hourCycle: /H/.test(pic) ? 'h23' : 'h12', hour: /hh/i.test(pic) ? '2-digit' : 'numeric' });
    }

    function regionalInit() {
        const d = { locale: reg(INTL_KEY, 'LocaleName', null), nation: reg(GEO_KEY, 'Nation', null), time: reg(INTL_KEY, 'sTimeFormat', null) || null };
        return whenLoaded(d, [CPL_DIALOGS], () => {
            const f = regionalFields();
            if (!f) return;
            // the desktop's defaults when the registry has no value (the browser's locale)
            if (d.locale == null) d.locale = fieldDefault(f.locale);
            if (d.nation == null) d.nation = fieldDefault(f.nation);
            d.initial = { locale: d.locale, nation: d.nation, time: d.time };
        });
    }

    // ---- 6.1: the device's own Regional Settings pages (Region, Number, Currency, Time, Date as
    // captured on the emulator), filled with the locale's real formats. Melaton stores the
    // locale and the time style; every other format combo lists the one value the region gives it.

    /** Windows' picture of the locale's time ("h:mm:ss tt") and its separator. */
    function timePicture(loc) {
        try {
            const fmt = new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
            const h12 = !!fmt.resolvedOptions().hour12;
            const parts = fmt.formatToParts(new Date(2026, 0, 2, 3, 4, 5));
            const pic = parts.map((p) => {
                if (p.type === 'hour') return (p.value.length > 1 ? (h12 ? 'hh' : 'HH') : (h12 ? 'h' : 'H'));
                if (p.type === 'minute') return 'mm';
                if (p.type === 'second') return 'ss';
                if (p.type === 'dayPeriod') return 'tt';
                return p.value;
            }).join('');
            const i = parts.findIndex((p) => p.type === 'hour');
            const sep = parts[i + 1] && parts[i + 1].type === 'literal' ? parts[i + 1].value : ':';
            return { pic, sep };
        } catch (_) { return { pic: 'h:mm:ss tt', sep: ':' }; }
    }

    /** Windows' picture of a date format ("M/d/yyyy", "dddd, MMMM d, yyyy") and its first separator. */
    function datePicture(loc, o) {
        try {
            const parts = new Intl.DateTimeFormat(loc, o).formatToParts(new Date(2026, 0, 2));
            const pic = parts.map((p) => {
                if (p.type === 'weekday') return 'dddd';
                if (p.type === 'month') return /^\d+$/.test(p.value) ? (p.value.length > 1 ? 'MM' : 'M') : 'MMMM';
                if (p.type === 'day') return p.value.length > 1 ? 'dd' : 'd';
                if (p.type === 'year') return p.value.length > 2 ? 'yyyy' : 'yy';
                return p.value;
            }).join('');
            const lit = parts.find((p) => p.type === 'literal');
            return { pic, sep: lit ? lit.value : '/' };
        } catch (_) { return { pic: '', sep: '/' }; }
    }

    /** Digits in the last group of a large number (3 for "123,456,789"). */
    function groupSize(loc) {
        try {
            const ints = new Intl.NumberFormat(loc).formatToParts(123456789).filter((p) => p.type === 'integer');
            return ints.length > 1 ? String(ints[ints.length - 1].value.length) : '0';
        } catch (_) { return '3'; }
    }

    /** A currency amount as the device shows its formats: the symbol as the universal sign. */
    function currencyShape(loc, n) {
        try {
            return new Intl.NumberFormat(loc, { style: 'currency', currency: currencyFor(loc), minimumFractionDigits: 1, maximumFractionDigits: 1 })
                .formatToParts(n).map((p) => (p.type === 'currency' ? '\u00a4' : p.value)).join('');
        } catch (_) { return ''; }
    }

    function currencyDigits(loc) {
        try { return String(new Intl.NumberFormat(loc, { style: 'currency', currency: currencyFor(loc) }).resolvedOptions().maximumFractionDigits); } catch (_) { return '2'; }
    }

    function measurementSystem(loc) {
        let region = '';
        try { region = new Intl.Locale(loc).maximize().region || ''; } catch (_) { /* metric */ }
        return ['US', 'LR', 'MM'].includes(region) ? 'U.S.' : 'Metric';
    }

    function regionalRender61(el, tab, d, f) {
        const loc = d.locale || 'en-US';
        const now = new Date();
        // "Label: [combo]" rows; a row's value is the region's own, the only one its list holds
        const rows = (list) => list.map(([label, value, off], i) => `<div class="wm-sys-rrow"><span>${esc(label)}</span>${ui.comboHtml(`fx-${i}`, show(value), !!off)}</div>`).join('');
        const bindRows = (own = -1) => el.querySelectorAll('.wm-sys-rrow > .wm-combo:not(:disabled)').forEach((btn, i) => {
            if (i === own) return; // a row with a list of its own (Time style)
            const v = btn.textContent;
            ui.bindCombo(btn, [[v, v]], v, () => {});
        });
        const p = numberParts(loc);
        if (tab === 'number') {
            el.innerHTML = `<div class="wm-sys-reg is-number">${rows([
                ['Decimal symbol:', p.decimal],
                ['No. of decimal places:', '2'],
                ['Digit grouping symbol:', p.group],
                ['No. of digits in group:', groupSize(loc)],
                ['List separators:', p.decimal === ',' ? ';' : ','],
                ['Negative sign symbol:', p.minus],
                ['Negative number format:', nf(loc, -1.1, { minimumFractionDigits: 1 })],
                ['Display leading zero:', nf(loc, 0.7, { minimumFractionDigits: 1 })],
                ['Measurement system:', measurementSystem(loc)]
            ])}</div>`;
            bindRows();
            return;
        }
        if (tab === 'currency') {
            el.innerHTML = `<div class="wm-sys-reg is-number">${rows([
                ['Currency symbol:', currencySymbol(loc)],
                ['Currency symbol position:', currencyShape(loc, 1.1)],
                ['Decimal symbol:', p.decimal],
                ['No. of decimal places:', currencyDigits(loc)],
                ['Digit grouping symbol:', p.group],
                ['No. of digits in group:', groupSize(loc)],
                ['Negative number format:', currencyShape(loc, -1.1)]
            ])}<div class="wm-sys-reg-key">\u00a4 = Universal currency symbol</div></div>`;
            bindRows();
            return;
        }
        if (tab === 'time') {
            const per = dayPeriods(loc);
            const t = timePicture(loc);
            // Time style is a real choice (12 or 24 hours, leading zero): stored as sTimeFormat
            const styles = timeStyles(loc);
            const pic = d.time && styles.includes(d.time) ? d.time : styles[0];
            el.innerHTML = `<div class="wm-sys-reg is-time">
                <div class="wm-sys-reg-sample"><b>Time sample:</b><span>${esc(df(loc, timeOpts(pic, { hour: 'numeric', minute: '2-digit', second: '2-digit' }), now))}</span></div>
                ${rows([
                    ['Time style:', pic],
                    ['Time separator:', t.sep],
                    ['AM symbol:', per.am],
                    ['PM symbol:', per.pm]
                ])}</div>`;
            bindRows(0);
            ui.bindCombo(el.querySelector('.wm-sys-rrow > .wm-combo'), styles.map((x) => [x, x]), pic, (v) => { d.time = v === styles[0] ? null : v; d.rerender(); });
            return;
        }
        if (tab === 'date') {
            const sd = datePicture(loc, { year: 'numeric', month: 'numeric', day: 'numeric' });
            const ld = datePicture(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            el.innerHTML = `<div class="wm-sys-reg is-date">
                <div class="wm-sys-reg-dates"><span>Short date:</span><span>${esc(df(loc, { year: 'numeric', month: 'numeric', day: 'numeric' }, now))}</span><span>Long date:</span><span>${esc(df(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, now))}</span></div>
                ${rows([
                    ['Short date:', sd.pic],
                    ['Date separator:', sd.sep],
                    ['Long date:', ld.pic],
                    ['Calendar type:', 'Gregorian Calendar', true]
                ])}</div>`;
            bindRows();
            return;
        }
        const locales = optionList(f.locale);
        const nations = optionList(f.nation);
        const label = (list, v) => (list.find(([k]) => k === v) || [v, v])[1];
        const c = currencyFor(loc);
        el.innerHTML = `<div class="wm-sys-reg is-region">
            ${ui.comboHtml('locale', label(locales, loc))}
            <div class="wm-sys-reg-head">Appearance samples</div>
            <div class="wm-sys-reg-samples">${[
                ['Positive numbers:', nf(loc, 123456789, { minimumFractionDigits: 2 })],
                ['Positive currency:', nf(loc, 123456789, { style: 'currency', currency: c })],
                ['Time:', df(loc, timeOpts(d.time, { hour: 'numeric', minute: '2-digit', second: '2-digit' }), now)],
                ['Short date:', df(loc, { year: 'numeric', month: 'numeric', day: 'numeric' }, now)],
                ['Long date:', df(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, now)]
            ].map(([a, b]) => `<span>${esc(a)}</span><span>${esc(show(b))}</span>`).join('')}</div>
            <div class="wm-sys-rrow is-location"><span>Location:</span>${ui.comboHtml('nation', label(nations, d.nation))}</div>
        </div>`;
        const lb = el.querySelector('[data-act="locale"]');
        ui.bindCombo(lb, locales, loc, (v) => { d.locale = v; d.time = null; d.rerender(); });
        longCombo(lb);
        const nb = el.querySelector('[data-act="nation"]');
        ui.bindCombo(nb, nations, d.nation, (v) => { d.nation = v; });
        longCombo(nb);
    }

    function regionalRender(el, tab, d, api) {
        d.rerender = api.rerender;
        const f = d.ready ? regionalFields() : null;
        if (!f) { el.innerHTML = loadingHtml(d); return; }
        if (!(window.wmShell && window.wmShell.version === '6.5')) { regionalRender61(el, tab, d, f); return; }
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
            const styles = timeStyles(loc);
            const pic = d.time && styles.includes(d.time) ? d.time : styles[0];
            el.innerHTML = `${ui.sub('Time style:')}
                ${ui.comboHtml('timestyle', pic)}
                ${ui.gap()}${facts([
                ['Time:', df(loc, timeOpts(pic, { hour: 'numeric', minute: '2-digit', second: '2-digit' }), now)],
                ['Short time:', df(loc, timeOpts(pic, { hour: 'numeric', minute: '2-digit' }), now)],
                ['AM symbol:', per.am],
                ['PM symbol:', per.pm]
            ])}`;
            ui.bindCombo(el.querySelector('[data-act="timestyle"]'), styles.map((x) => [x, x]), pic, (v) => { d.time = v === styles[0] ? null : v; api.rerender(); });
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
                ['Time:', df(loc, timeOpts(d.time, { hour: 'numeric', minute: '2-digit', second: '2-digit' }), now)],
                ['Short date:', df(loc, { year: 'numeric', month: 'numeric', day: 'numeric' }, now)],
                ['Long date:', df(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, now)]
            ].map(([a, b]) => [a, show(b)]))}</div>`;
        const lb = el.querySelector('[data-act="locale"]');
        ui.bindCombo(lb, locales, loc, (v) => { d.locale = v; d.time = null; api.rerender(); });
        longCombo(lb);
        const nb = el.querySelector('[data-act="nation"]');
        ui.bindCombo(nb, nations, d.nation, (v) => { d.nation = v; });
        longCombo(nb);
    }

    async function regionalCommit(d) {
        const r = R();
        if (!r || !d.ready || !d.initial) return [];
        const formats = d.locale !== d.initial.locale || (d.time || null) !== (d.initial.time || null);
        if (d.locale !== d.initial.locale) await r.set(INTL_KEY, { LocaleName: d.locale });
        if ((d.time || null) !== (d.initial.time || null)) await r.set(INTL_KEY, { sTimeFormat: d.time || '' });
        if (d.nation !== d.initial.nation) await r.set(GEO_KEY, { Nation: d.nation });
        // the desktop's Apply: the taskbar clock and the dates follow the format (taskbarClock.js)
        if (window.taskbarClock && typeof window.taskbarClock.refresh === 'function') window.taskbarClock.refresh();
        d.initial = { locale: d.locale, nation: d.nation, time: d.time };
        // dates and times are written through formatters made when the programs started
        // (app.html regionalFormats): the new formats show after a restart
        const rf = window.regionalFormats;
        if (formats && rf && typeof rf.store === 'function' && rf.store(d.locale, d.time)) {
            const yes = await ui.messageBox({
                title: 'Regional Settings', icon: 'question',
                text: 'Melaton Mobile must restart to use the new regional settings. Restart now?',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }]
            });
            if (yes) {
                const m = swm();
                if (m && typeof m.forceRestart === 'function') m.forceRestart(); else location.reload();
            }
        }
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
        const sh0 = sh();
        const d = { plan: activePlan(), plans, battery: null, low: sh0 && typeof sh0.batteryLowLevel === 'function' ? sh0.batteryLowLevel() : 25 };
        d.initial = { plan: d.plan, plans: JSON.parse(JSON.stringify(plans)), low: d.low };
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

    // The low battery warning's level (Melaton's own row: the device has a fixed level). The shell
    // shows "Main Battery Low" at or under it (wmShell.js batteryLowCheck); the icon has its own stages.
    const LOW_LEVELS = [5, 10, 15, 20, 25, 30];
    const lowHtml = (d) => `${ui.sub('Low battery warning at:')}${ui.comboHtml('low', `${d.low}%`)}`;
    function bindLow(el, d) {
        const btn = el.querySelector('[data-act="low"]');
        if (!btn) return;
        const list = LOW_LEVELS.includes(d.low) ? LOW_LEVELS : LOW_LEVELS.concat(d.low).sort((a, b) => a - b);
        ui.bindCombo(btn, list.map((n) => [n, `${n}%`]), d.low, (v) => { d.low = Number(v); btn.textContent = `${d.low}%`; });
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
            ${lowHtml(d)}
            ${b ? '' : ui.note('This browser does not report the battery.')}`;
    }

    // ---- 6.1: the device's Power pages (emulator captures). Battery: "Main battery:" with the
    // state where the device names the cell type, "Battery power remaining:" over the 0..100 bar.
    // Advanced: "On battery power:" and "On external power:", each a check box beside its combo;
    // Melaton has one sleep time per plan, so both groups show and set that one value (as
    // Backlight's two tabs do), and the desktop's power plans follow under them.

    function batteryHtml61(d) {
        const b = d.battery;
        if (b === null) return ui.text('Checking the battery...');
        const level = b ? Math.round(b.level * 100) : null;
        const status = !b ? 'Unknown' : b.charging ? (level >= 100 ? 'Charged' : 'Charging') : 'On battery';
        return `<div class="wm-sys-pow">
            <div class="wm-sys-pow-main"><b>Main battery:</b><b>${esc(status)}</b></div>
            <div class="wm-sys-pow-rem">Battery power remaining:${level == null ? '' : ` ${level}%`}</div>
            <div class="wm-sys-pow-bar"><span>0</span><div class="wm-sys-pow-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100"${level == null ? '' : ` aria-valuenow="${level}"`}><div style="width:${level == null ? 0 : level}%"></div></div><span>100</span></div>
            ${b ? '' : `<div class="wm-sys-pow-plan">${ui.note('This browser does not report the battery.')}</div>`}
            <div class="wm-sys-pow-plan">${lowHtml(d)}</div>
        </div>`;
    }

    function powerAdvanced61(el, d, api) {
        const cur = d.plans[d.plan].sleep;
        const remember = cur || d.last_sleep || planOf(d.plan).sleep || 3;
        const list = MINUTES.slice();
        if (cur && !list.includes(cur)) list.push(cur);
        list.sort((a, b) => a - b);
        const group = (key, head) => `<div class="wm-sys-pow-head">${esc(head)}</div>
            <div class="wm-sys-pow-row">${ui.check(`on-${key}`, 'Turn off device if not used for', cur > 0)}${ui.comboHtml(`min-${key}`, minuteText(remember), !cur)}</div>`;
        el.innerHTML = `<div class="wm-sys-pow">
            ${group('battery', 'On battery power:')}
            ${group('external', 'On external power:')}
            <div class="wm-sys-pow-plan">${ui.sub('Power plan:')}
                ${PLANS.map((p) => ui.radio('plan', p.id, p.name, p.id === d.plan)).join('')}
                ${ui.gap()}
                ${ui.note('The plans and this time are the desktop\'s Power Options values.')}</div>
        </div>`;
        ['battery', 'external'].forEach((key) => {
            ui.bindCombo(el.querySelector(`[data-act="min-${key}"]`), list.map((m) => [m, minuteText(m)]), remember, (v) => {
                d.plans[d.plan].sleep = v;
                d.last_sleep = v;
                api.rerender();
            });
            el.querySelector(`input[name="on-${key}"]`).addEventListener('change', (e) => {
                d.plans[d.plan].sleep = e.target.checked ? remember : 0;
                if (e.target.checked) d.last_sleep = remember;
                api.rerender();
            });
        });
        el.querySelectorAll('input[name="plan"]').forEach((r) => r.addEventListener('change', () => {
            if (!r.checked) return;
            d.plan = r.value;
            api.rerender();
        }));
    }

    /**
     * Restart (#760, Yukimi): a cold boot without closing the app, which is the only other way to
     * restart Melaton Mobile on a phone. The Android app replays its start (AndroidDisplay.coldBoot:
     * the maker's logo, the server check, /launch with its installer, the splash); a browser, or an
     * app build without the bridge, goes through /launch the same way.
     */
    function coldBoot() {
        try { if (typeof suppressWebSocketReconnectForReload === 'function') suppressWebSocketReconnectForReload(); } catch (_) { /* reload anyway */ }
        // the leave guard reads the window property; app.js's own flag is a top-level let
        window.bypassConfirmation = true;
        try { if (typeof bypassConfirmation !== 'undefined') bypassConfirmation = true; } catch (_) { /* window flag is enough */ }
        window.melatonRestarting = true;
        const a = window.AndroidDisplay;
        if (a && typeof a.coldBoot === 'function') {
            try { a.coldBoot(); return; } catch (_) { /* fall back to /launch */ }
        }
        location.replace('/launch');
    }

    async function askColdBoot() {
        const yes = await ui.messageBox({
            title: 'Restart', icon: 'question',
            text: 'Melaton Mobile will restart. Programs that are open will close. Restart now?',
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }]
        });
        if (yes) coldBoot();
    }

    function powerRender(el, tab, d, api) {
        d.rerender = api.rerender;
        d.tab = tab;
        if (tab === 'restart') {
            el.innerHTML = `${ui.text('Restart Melaton Mobile. It starts again from the beginning, as when the device is turned on. Programs that are open will close.')}
                ${ui.gap()}
                ${ui.buttons([['restart', 'Restart']], false)}`;
            el.querySelector('[data-act="restart"]').addEventListener('click', () => { void askColdBoot(); });
            return;
        }
        if (!(window.wmShell && window.wmShell.version === '6.5')) {
            if (tab === 'battery') { el.innerHTML = batteryHtml61(d); bindLow(el, d); }
            else powerAdvanced61(el, d, api);
            return;
        }
        if (tab === 'battery') { el.innerHTML = batteryHtml(d); bindLow(el, d); return; }
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
        const i = d.initial;
        const keys = [];
        if (d.low !== i.low) {
            const sh1 = sh();
            const key = (sh1 && sh1.batteryLowKey) || 'wmBatteryLow';
            try { localStorage.setItem(key, String(d.low)); keys.push(key); i.low = d.low; } catch (_) { /* storage off */ }
            if (sh1 && typeof sh1.refreshStatus === 'function') sh1.refreshStatus();
        }
        if (!r) return keys;
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
        return keys;
    }

    // ================================================================ Messaging > Tools > Options
    // A page of Messaging's own (hidden: not in the Settings grids), opened from its menu; the device's
    // four tabs (Yozora #757, screenshots 165113-165157): Accounts (the accounts, "Display account
    // picker when opening Messaging"), Message (reply with the body, warn before deleting, what follows
    // a delete, and Melaton's own unread icon choice), Address and Storage. wmMessaging.js reads the
    // same keys. The title bar reads "Messaging" as on the device.
    const MSG = {
        picker: 'wmMsgPicker', replyBody: 'wmMsgReplyBody', warnDelete: 'wmMsgWarnDelete',
        afterDelete: 'wmMsgAfterDelete', emptyDeleted: 'wmMsgEmptyDeleted'
    };
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const lsPut = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } };

    function messagingOptionsInit() {
        const key = (sh() && sh().mailIconAllKey) || 'wmMailIconAll';
        const d = {
            key,
            all: lsGet(key) === '1',
            picker: lsGet(MSG.picker) !== '0',
            replyBody: lsGet(MSG.replyBody) !== '0',
            warnDelete: lsGet(MSG.warnDelete) !== '0',
            afterDelete: lsGet(MSG.afterDelete) === 'list' ? 'list' : 'next',
            emptyDeleted: lsGet(MSG.emptyDeleted) === 'immediate' ? 'immediate' : 'manual',
            acctSel: 'mail'
        };
        d.initial = JSON.stringify(d);
        return d;
    }

    function messagingAccounts() {
        const m = window.wmMessaging;
        const items = m && typeof m.accountItems === 'function' ? m.accountItems('mail') : [];
        return items;
    }

    /**
     * Options > Accounts > Signatures... (device: the account, "Use signature with this account", "Use when
     * replying and forwarding", the signature box) and Security... (device: encrypt / sign outgoing
     * messages, algorithms, certificates). They open over the Accounts tab; ok goes back to it. The
     * signature is Dovecote Express's (userGlobalSettings.mail), so the desktop and the phone share one.
     */
    function messagingSubRender(el, d) {
        if (d.sub === 'signatures') {
            const g = d.sig || { signature: '', signatureOutgoing: true, signatureSkipReplies: false };
            el.innerHTML = `${ui.text('Select an account:')}
                ${ui.comboHtml('sigAcct', 'Dreamscape Mail', true)}
                ${ui.check('sigUse', 'Use signature with this account', g.signatureOutgoing !== false)}
                ${ui.check('sigReply', 'Use when replying and forwarding', !g.signatureSkipReplies)}
                <textarea class="wm-edit wm-msgopt-sig" name="sig" rows="7" spellcheck="false" aria-label="Signature"></textarea>`;
            const box = el.querySelector('textarea[name="sig"]');
            box.value = g.signature || '';
            const sync = () => { box.disabled = !el.querySelector('input[name="sigUse"]').checked; el.querySelector('input[name="sigReply"]').disabled = box.disabled; };
            el.querySelector('input[name="sigUse"]').addEventListener('change', (e) => { g.signatureOutgoing = e.target.checked; sync(); });
            el.querySelector('input[name="sigReply"]').addEventListener('change', (e) => { g.signatureSkipReplies = !e.target.checked; });
            box.addEventListener('input', () => { g.signature = box.value; });
            d.sig = g;
            sync();
            return;
        }
        // security: no certificates on this phone, so the device's choices show unavailable
        el.innerHTML = `${ui.check('enc', 'Encrypt outgoing messages', false, 'disabled')}
            ${ui.check('sign', 'Sign outgoing messages', false, 'disabled')}
            ${ui.buttons([['alg', 'Choose Algorithm...', true]], false)}
            ${ui.gap()}
            ${ui.check('rev', 'Check sender certificate revocation', false, 'disabled')}
            ${ui.buttons([['cert', 'Choose Certificate...', true]], false)}
            ${ui.note('No certificates are installed on this device.')}`;
    }

    function messagingOptionsRender(el, tab, d, api) {
        d.rerender = api.rerender;
        if (tab === 'accounts' && d.sub) { messagingSubRender(el, d); return; }
        if (tab === 'accounts') {
            const rows = messagingAccounts().map((a) => ({ key: a.label, label: `${a.radio ? '* ' : '\u2002 '}${a.label}`, selected: d.acctSel === a.label }));
            rows.push({ key: '__new', label: '\u2002 New Account...', selected: d.acctSel === '__new' });
            el.innerHTML = `${ui.text('Tap an account to change settings.')}
                ${ui.listbox(rows, { maxHeight: 210 }).replace('class="wm-listbox"', 'class="wm-listbox wm-msgopt-accts"')}
                ${ui.buttons([['security', 'Security...'], ['signatures', 'Signatures...']])}
                ${ui.check('picker', 'Display account picker when opening Messaging', d.picker)}`;
            ui.bindListbox(el.querySelector('.wm-listbox'), async (key) => {
                d.acctSel = key;
                const m = window.wmMessaging;
                if (key === '__new' && m && typeof m.setupAccount === 'function') m.setupAccount();
                // the device opens a tapped account's settings: Text Messages' own pages (#763);
                // what was changed here is kept first (ok on those pages comes back to this tab)
                if (key === 'Text Messages' && typeof wmSettings.openChatOptions === 'function') {
                    const keys = await messagingOptionsCommit(d);
                    if (Array.isArray(keys) && keys.length) ui.changed(keys);
                    wmSettings.openChatOptions('messaging-options');
                }
            });
            el.querySelector('input[name="picker"]').addEventListener('change', (e) => { d.picker = e.target.checked; });
            el.querySelector('[data-act="security"]').addEventListener('click', () => { d.sub = 'security'; api.rerender(); });
            el.querySelector('[data-act="signatures"]').addEventListener('click', async () => {
                if (!d.sig) {
                    try {
                        const c = window.wsClient;
                        const data = c && typeof c.getUserGlobalSettings === 'function' ? await c.getUserGlobalSettings() : null;
                        d.sig = Object.assign({ signature: '', signatureOutgoing: true, signatureSkipReplies: false }, (data && data.settings && data.settings.mail) || {});
                    } catch (_) { d.sig = { signature: '', signatureOutgoing: true, signatureSkipReplies: false }; }
                    d.sigInitial = JSON.stringify(d.sig);
                }
                d.sub = 'signatures';
                api.rerender();
            });
            return;
        }
        if (tab === 'message') {
            el.innerHTML = `${ui.check('replyBody', 'When replying to e-mail, include body', d.replyBody)}
                ${ui.check('keepSent', 'Keep copies of sent items in Sent folder', true, 'disabled')}
                ${ui.check('warnDelete', 'Warn when deleting messages in the message list', d.warnDelete)}
                ${ui.gap()}
                ${ui.text('After deleting or moving a message:')}
                ${ui.comboHtml('afterDelete', d.afterDelete === 'list' ? 'Return to message list' : 'Show next message')}
                ${ui.gap()}
                ${ui.check('mail-icon-all', 'Show the unread message icon for any unread message', d.all)}
                ${ui.note('When this is off, the icon shows only for messages received since Melaton Mobile started. Dreamscape Mail always keeps a copy of what you send.')}`;
            ['replyBody', 'warnDelete'].forEach((k) => el.querySelector(`input[name="${k}"]`).addEventListener('change', (e) => { d[k] = e.target.checked; }));
            el.querySelector('input[name="mail-icon-all"]').addEventListener('change', (e) => { d.all = e.target.checked; });
            ui.bindCombo(el.querySelector('[data-act="afterDelete"]'), [['next', 'Show next message'], ['list', 'Return to message list']], d.afterDelete, (v) => { d.afterDelete = v; });
            return;
        }
        if (tab === 'address') {
            el.innerHTML = `${ui.text('In Contacts, get e-mail addresses from:')}
                ${ui.comboHtml('addrField', 'All e-mail fields', true)}
                ${ui.text('Check names using these address books:')}
                <div class="wm-msgopt-books">
                    <div class="wm-listbox wm-msgopt-booklist" style="height:calc(232 * var(--wm-px))"></div>
                    ${ui.buttons([['add', 'Add...', true]], false)}
                </div>`;
            return;
        }
        // storage
        el.innerHTML = `${ui.text('Main memory (... MB free)').replace('<p>', '<p data-f="mem">')}
            ${ui.text('Current size of attachments (0.00 MB)')}
            ${ui.check('card', 'When available, use this storage card to store attachments', false, 'disabled')}
            ${ui.text('Empty deleted items:')}
            ${ui.comboHtml('emptyDeleted', d.emptyDeleted === 'immediate' ? 'Immediately' : 'Manually')}`;
        ui.bindCombo(el.querySelector('[data-act="emptyDeleted"]'), [['manual', 'Manually'], ['immediate', 'Immediately']], d.emptyDeleted, (v) => { d.emptyDeleted = v; });
        const mem = el.querySelector('[data-f="mem"]');
        if (navigator.storage && typeof navigator.storage.estimate === 'function') {
            navigator.storage.estimate().then((e) => {
                if (!mem.isConnected) return;
                const free = Math.max(0, (Number(e.quota) || 0) - (Number(e.usage) || 0)) / 1048576;
                mem.textContent = `Main memory (${free.toFixed(2)} MB free)`;
            }).catch(() => { mem.textContent = 'Main memory'; });
        } else mem.textContent = 'Main memory';
        void api;
    }

    async function messagingOptionsCommit(d) {
        // ok on Signatures / Security: save the signature, back to the Accounts tab
        if (d.sub) {
            if (d.sub === 'signatures' && d.sig && JSON.stringify(d.sig) !== d.sigInitial) {
                try {
                    const c = window.wsClient;
                    if (c) await c.updateUserGlobalSettings({ mail: { signature: d.sig.signature, signatureOutgoing: d.sig.signatureOutgoing !== false, signatureSkipReplies: !!d.sig.signatureSkipReplies } });
                    d.sigInitial = JSON.stringify(d.sig);
                    if (window.wmMessaging && typeof window.wmMessaging.loadSignature === 'function') window.wmMessaging.loadSignature();
                } catch (_) {
                    const s1 = sh();
                    if (s1 && typeof s1.messageBox === 'function') await s1.messageBox({ title: 'Messaging', icon: 'error', text: 'The signature could not be saved.' });
                    return false;
                }
            }
            d.sub = null;
            if (typeof d.rerender === 'function') d.rerender();
            return false;
        }
        const was = JSON.parse(d.initial);
        const keys = [];
        if (d.all !== was.all && lsPut(d.key, d.all ? '1' : '0')) {
            keys.push(d.key);
            const s1 = sh();
            if (s1 && typeof s1.refreshStatus === 'function') s1.refreshStatus();
        }
        const put = (k, v, old) => { if (v !== old && lsPut(MSG[k], v)) keys.push(MSG[k]); };
        put('picker', d.picker ? '1' : '0', was.picker ? '1' : '0');
        put('replyBody', d.replyBody ? '1' : '0', was.replyBody ? '1' : '0');
        put('warnDelete', d.warnDelete ? '1' : '0', was.warnDelete ? '1' : '0');
        put('afterDelete', d.afterDelete, was.afterDelete);
        put('emptyDeleted', d.emptyDeleted, was.emptyDeleted);
        d.initial = JSON.stringify(Object.assign({}, d, { initial: undefined, sub: undefined, sig: undefined, sigInitial: undefined, rerender: undefined }));
        return keys;
    }

    wmSettings.registerPage({
        id: 'messaging-options', tab: 'personal', label: 'Options', icon: 'app-messaging', hidden: true,
        title: 'Messaging',
        tabs: [['accounts', 'Accounts'], ['message', 'Message'], ['address', 'Address'], ['storage', 'Storage']],
        init: messagingOptionsInit,
        render: messagingOptionsRender,
        commit: messagingOptionsCommit
    });

    // ================================================================ Messaging > Options > Text Messages
    // Yozora #763: the Text Messages account's own settings (tap "Text Messages" on Options' Accounts
    // tab, or Text Messages' Menu > Tools > Account Options...), three tabs in WM 6.1's Messaging
    // Options style: Messages (what a thread shows of a reply, the default verbosity of new chats),
    // My Info (the name, picture and backstory the personas know the user by: persona_settings, the
    // same store as Memories' LinkXi persona) and Engine (the chat engine, model and reasoning effort,
    // shared with the desktop Control Panel's Chat page: get/save_chat_engine_settings). ok saves and
    // goes back to Options' Accounts tab when it was opened from there.
    const CHAT_KEYS = { actions: 'wmChatShowActions', events: 'wmChatShowEvents' };
    const CHAT_VERBOSITY = [['1', 'Brief'], ['2', 'Direct'], ['3', 'Expressive'], ['4', 'Elaborate'], ['5', 'Poetic']];
    const CHAT_EFFORTS = { default: 'Default', none: 'None', low: 'Low', medium: 'Medium', high: 'High' };
    let chatOptsFrom = null; // 'messaging-options' when Options' Accounts tab opened the page

    /** The chat engine calls (agent A's wsClient methods; the bare packets when this client's copy predates them). */
    const chatEngine = {
        data: (r) => (r && r.data && typeof r.data === 'object' && r.data.success !== undefined ? r.data : r),
        async get() {
            const c = window.wsClient;
            if (!c) throw new Error('Not connected.');
            if (typeof c.getChatEngineSettings === 'function') return c.getChatEngineSettings();
            return this.data(await c.sendMessage('get_chat_engine_settings', {}, false));
        },
        async save(settings) {
            const c = window.wsClient;
            if (!c) throw new Error('Not connected.');
            if (typeof c.saveChatEngineSettings === 'function') return c.saveChatEngineSettings(settings);
            return this.data(await c.sendMessage('save_chat_engine_settings', { settings }, false));
        },
        async models(provider) {
            const c = window.wsClient;
            if (!c || !provider) return { models: [] };
            if (typeof c.getChatEngineModels === 'function') return c.getChatEngineModels(provider);
            const b = this.data(await c.sendMessage('director_get_models', { engine: `custom:${provider}`, force: false }, false)) || {};
            return { models: Array.isArray(b.models) ? b.models.map((m) => ({ id: m.id, name: m.name || m.id, default: m.default === true })) : [], error: b.error || null };
        }
    };

    function chatOptionsInit() {
        const d = {
            actions: lsGet(CHAT_KEYS.actions) === '1',
            events: lsGet(CHAT_KEYS.events) === '1',
            from: chatOptsFrom,
            persona: null, // persona_settings as read (null until it comes)
            me: { user_name: '', backstory: '', default_verbosity: '3', photo: '' },
            engine: null, // get_chat_engine_settings as read
            pick: { provider: '', model: '', effort: 'default' },
            models: {}, // provider -> [{ id, name, default }] | 'loading' | 'error'
            loadError: ''
        };
        chatOptsFrom = null;
        d.initial = { actions: d.actions, events: d.events };
        chatOptionsLoad(d);
        return d;
    }

    async function chatOptionsLoad(d) {
        const c = window.wsClient;
        const [p, e] = await Promise.allSettled([
            c && typeof c.getPersonaSettings === 'function' ? c.getPersonaSettings() : Promise.reject(new Error('Not connected.')),
            chatEngine.get()
        ]);
        if (p.status === 'fulfilled' && p.value && p.value.success !== false) {
            const s = p.value.settings || {};
            d.persona = s;
            d.me = { user_name: s.user_name || '', backstory: s.backstory || '', default_verbosity: String(s.default_verbosity || '3'), photo: s.profile_photo_base64 || '' };
            if (!CHAT_VERBOSITY.some(([v]) => v === d.me.default_verbosity)) d.me.default_verbosity = '3';
            d.meInitial = JSON.stringify(d.me);
        } else d.loadError = 'Your information could not be read.';
        if (e.status === 'fulfilled' && e.value && e.value.success !== false) {
            d.engine = e.value;
            const s = e.value.settings || {};
            d.pick = { provider: s.provider || '', model: s.model || '', effort: s.effort || 'default' };
            d.pickInitial = JSON.stringify(d.pick);
            chatOptionsModels(d, chatProviderOf(d));
        } else d.engineError = 'The chat engine settings could not be read.';
        if (typeof d.rerender === 'function') d.rerender();
    }

    /** The provider a pick means ('' = the server's default engine). */
    function chatProviderOf(d) {
        const e = d.engine || {};
        return d.pick.provider || (e.serverDefault && e.serverDefault.provider) || (e.effective && e.effective.provider) || '';
    }

    async function chatOptionsModels(d, provider) {
        if (!provider || Array.isArray(d.models[provider]) || d.models[provider] === 'loading') return;
        d.models[provider] = 'loading';
        try {
            const r = await chatEngine.models(provider);
            d.models[provider] = Array.isArray(r && r.models) ? r.models : [];
        } catch (_) { d.models[provider] = 'error'; }
        if (typeof d.rerender === 'function') d.rerender();
    }

    /** A gallery picture as My Info's photo: its preview, cut square to 160 px, as JPEG base64. */
    function chatPhotoFrom(filename) {
        return new Promise((resolve, reject) => {
            const stem = String(filename).replace(/\.(png|jpe?g|webp)$/i, '');
            const img = new Image();
            img.onload = () => {
                try {
                    const s = Math.min(img.naturalWidth, img.naturalHeight);
                    const cv = document.createElement('canvas');
                    cv.width = 160; cv.height = 160;
                    // the face is near the top of a portrait print
                    cv.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, Math.max(0, (img.naturalHeight - s) * 0.2), s, s, 0, 0, 160, 160);
                    resolve(cv.toDataURL('image/jpeg', 0.85).split(',')[1]);
                } catch (err) { reject(err); }
            };
            img.onerror = () => reject(new Error('The picture could not be read.'));
            img.src = `/previews/${encodeURIComponent(`${stem}.webp`)}`;
        });
    }

    function chatPickPhoto(d) {
        const fd = window.wmFileDialogs;
        if (!fd || typeof fd.open !== 'function') return;
        const fileOf = (i) => {
            if (!i) return null;
            if (i.targetKind === 'image' || i.targetKind === 'scrap') return i.previewImageFilename || i.targetId || null;
            if (i.shortcutType === 'image' && i.shortcutData && i.shortcutData.filename) return i.shortcutData.filename;
            return null;
        };
        fd.open({
            title: 'Choose a Picture',
            appTitle: 'Messaging',
            typeLabel: 'Pictures',
            pictures: true,
            accept: (i) => !!fileOf(i),
            onPick(item) {
                const f = fileOf(item);
                if (!f) return false;
                chatPhotoFrom(f).then((b64) => { d.me.photo = b64; if (typeof d.rerender === 'function') d.rerender(); }, () => {
                    const s1 = sh();
                    if (s1) s1.messageBox({ title: 'Messaging', icon: 'error', text: 'The picture could not be used.', modal: true });
                });
                return true;
            }
        });
    }

    function chatOptionsRender(el, tab, d, api) {
        d.rerender = api.rerender;
        if (tab === 'messages') {
            const verb = (CHAT_VERBOSITY.find(([v]) => v === d.me.default_verbosity) || CHAT_VERBOSITY[2])[1];
            el.innerHTML = `${ui.check('actions', 'Show actions and sound effects', d.actions)}
                ${ui.check('events', 'Show 4th wall events (memory, emotion, plans)', d.events)}
                ${ui.check('receipt', 'Request message delivery notification', false, 'disabled')}
                ${ui.gap()}
                ${ui.text('Verbosity of new conversations:')}
                ${ui.comboHtml('verbosity', verb, !d.persona)}`;
            el.querySelector('input[name="actions"]').addEventListener('change', (e) => { d.actions = e.target.checked; });
            el.querySelector('input[name="events"]').addEventListener('change', (e) => { d.events = e.target.checked; });
            ui.bindCombo(el.querySelector('[data-act="verbosity"]'), CHAT_VERBOSITY, d.me.default_verbosity, (v) => { d.me.default_verbosity = v; });
            return;
        }
        if (tab === 'myinfo') {
            if (!d.persona) { el.innerHTML = ui.text(d.loadError || 'Reading your information...'); return; }
            const pic = d.me.photo ? `data:image/jpeg;base64,${d.me.photo}` : '';
            const nameId = ui.uid('wmChatMe');
            el.innerHTML = `${ui.row('Name:', ui.edit(nameId, d.me.user_name, 'name="user_name" placeholder="How the personas call you"'), { wide: true, for: nameId })}
                <div class="wm-chatopt-pic">
                    <span class="wm-chatopt-photo">${pic ? `<img src="${pic}" alt="" draggable="false">` : ''}</span>
                    ${ui.buttons([['photo', 'Change...'], ['nophoto', 'Remove', !d.me.photo]], false)}
                </div>
                ${ui.sub('Backstory:')}
                <textarea class="wm-edit wm-chatopt-area" name="backstory" rows="6" aria-label="Backstory" placeholder="Who you are to the personas"></textarea>`;
            const box = el.querySelector('textarea[name="backstory"]');
            box.value = d.me.backstory;
            box.addEventListener('input', () => { d.me.backstory = box.value; });
            el.querySelector('input[name="user_name"]').addEventListener('input', (e) => { d.me.user_name = e.target.value; });
            el.querySelector('[data-act="photo"]').addEventListener('click', () => chatPickPhoto(d));
            el.querySelector('[data-act="nophoto"]').addEventListener('click', () => { d.me.photo = ''; api.rerender(); });
            return;
        }
        // engine
        if (!d.engine) { el.innerHTML = ui.text(d.engineError || 'Reading the chat engine settings...'); return; }
        const e = d.engine;
        const def = e.serverDefault || {};
        const provs = (Array.isArray(e.providers) ? e.providers : []).filter((p) => p && p.hasKey !== false);
        const engines = [['', `Default (${def.providerName || def.provider || 'server'})`]].concat(provs.map((p) => [p.id, p.name || p.id]));
        const provider = chatProviderOf(d);
        const row = provs.find((p) => p.id === provider);
        const list = d.models[provider];
        const defModel = (row && row.defaultModel) || (Array.isArray(list) && (list.find((m) => m.default) || {}).id) || '';
        const models = [['', `Default${defModel ? ` (${defModel})` : ''}`]].concat(Array.isArray(list) ? list.map((m) => [m.id, m.name && m.name !== m.id ? `${m.name}` : m.id]) : []);
        if (d.pick.model && !models.some(([v]) => v === d.pick.model)) models.push([d.pick.model, d.pick.model]);
        const efforts = (Array.isArray(e.efforts) && e.efforts.length ? e.efforts : Object.keys(CHAT_EFFORTS)).map((k) => [k, CHAT_EFFORTS[k] || k]);
        const labelOf = (opts, v) => (opts.find(([k]) => k === v) || opts[0] || ['', ''])[1];
        const modelLabel = list === 'loading' ? 'Reading the models...' : labelOf(models, d.pick.model);
        el.innerHTML = `${ui.text('Engine:')}
            ${ui.comboHtml('engine', labelOf(engines, d.pick.provider))}
            ${ui.gap()}
            ${ui.text('Model:')}
            ${ui.comboHtml('model', modelLabel, list === 'loading')}
            ${ui.gap()}
            ${ui.text('Reasoning effort:')}
            ${ui.comboHtml('effort', labelOf(efforts, d.pick.effort))}
            ${list === 'error' ? ui.note('The models could not be read. The engine\'s default model is used.') : ''}
            ${ui.note('Used by every Text Messages conversation and the desktop Chat.')}`;
        ui.bindCombo(el.querySelector('[data-act="engine"]'), engines, d.pick.provider, (v) => {
            if (v === d.pick.provider) return;
            d.pick.provider = v;
            d.pick.model = '';
            chatOptionsModels(d, chatProviderOf(d));
            api.rerender();
        });
        ui.bindCombo(el.querySelector('[data-act="model"]'), models, d.pick.model, (v) => { d.pick.model = v; });
        ui.bindCombo(el.querySelector('[data-act="effort"]'), efforts, d.pick.effort, (v) => { d.pick.effort = v; });
    }

    async function chatOptionsCommit(d) {
        const keys = [];
        const s1 = sh();
        const fail = async (text) => { if (s1) await s1.messageBox({ title: 'Messaging', icon: 'error', text, modal: true }); };
        if (d.actions !== d.initial.actions && lsPut(CHAT_KEYS.actions, d.actions ? '1' : '0')) keys.push(CHAT_KEYS.actions);
        if (d.events !== d.initial.events && lsPut(CHAT_KEYS.events, d.events ? '1' : '0')) keys.push(CHAT_KEYS.events);
        d.initial = { actions: d.actions, events: d.events };
        const c = window.wsClient;
        if (d.persona && JSON.stringify(d.me) !== d.meInitial) {
            const was = JSON.parse(d.meInitial);
            const changed = {};
            if (d.me.user_name !== was.user_name) changed.user_name = d.me.user_name.trim();
            if (d.me.backstory !== was.backstory) changed.backstory = d.me.backstory;
            if (d.me.default_verbosity !== was.default_verbosity) changed.default_verbosity = parseInt(d.me.default_verbosity, 10) || 3;
            if (d.me.photo !== was.photo) changed.profile_photo_base64 = d.me.photo;
            try {
                const r = c ? await c.savePersonaSettings(changed) : null;
                if (!r || r.success === false) throw new Error((r && (r.message || r.error)) || 'refused');
                d.meInitial = JSON.stringify(d.me);
                // the desktop chat (and Text Messages' "Me" picture) read this copy
                const cs = window.chatSystem;
                if (cs) cs.personaSettings = Object.assign({}, cs.personaSettings || {}, changed);
            } catch (_) {
                await fail('Your information could not be saved.');
                return false;
            }
        }
        if (d.engine && JSON.stringify(d.pick) !== d.pickInitial) {
            try {
                const r = await chatEngine.save({ provider: d.pick.provider, model: d.pick.model, effort: d.pick.effort });
                if (!r || r.success === false) throw new Error((r && r.error) || 'refused');
                d.pickInitial = JSON.stringify(d.pick);
            } catch (err) {
                await fail(`The chat engine could not be changed.${err && err.message && err.message !== 'refused' ? `\n\n${err.message}` : ''}`);
                return false;
            }
        }
        window.dispatchEvent(new CustomEvent('wmChatOptionsChange', { detail: { keys } }));
        // back to Options' Accounts tab when that is where it was opened from
        if (d.from === 'messaging-options' && typeof wmSettings.open === 'function') {
            if (keys.length) ui.changed(keys);
            wmSettings.open('messaging-options', 'accounts', { direct: true });
            return [];
        }
        return keys;
    }

    wmSettings.registerPage({
        id: 'chat-options', tab: 'personal', label: 'Text Messages', icon: 'app-messaging', hidden: true,
        title: 'Messaging',
        tabs: [['messages', 'Messages'], ['myinfo', 'My Info'], ['engine', 'Engine']],
        init: chatOptionsInit,
        render: chatOptionsRender,
        commit: chatOptionsCommit
    });

    /** Open the Text Messages account's settings (from Options' Accounts tab: ok comes back there). */
    wmSettings.openChatOptions = (from, tab) => {
        chatOptsFrom = from || null;
        return wmSettings.open('chat-options', tab || null, { direct: true });
    };

    wmSettings.registerPage({
        id: 'power', tab: 'system', label: 'Power', icon: 'set-power',
        tabs: [['battery', 'Battery'], ['advanced', 'Advanced'], ['restart', 'Restart']],
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
        const d = { view: { message: '', progress: 0, filesTotal: 0, ...updateInitialState() }, version: wmSettings.storedVersion() };
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

    // Version (#739): which Melaton Mobile the phone runs, the Windows Mobile 6.1 style or the 6.5
    // one (Start screen, Melaton Default home screen). The page runs one version for its whole
    // life (app.html reads wmVersion before the first paint), so a change restarts Melaton Mobile.
    function versionRender(el, d) {
        const names = new Map(wmSettings.versions);
        el.innerHTML = `${ui.sub('Select the version of Melaton Mobile to use:')}
            ${wmSettings.versions.map(([id, name]) => ui.radio('wm-version', id, name, id === d.version)).join('')}
            ${ui.gap()}
            ${ui.value('Current version:', names.get(wmSettings.version()), { wide: true })}
            ${ui.gap()}
            ${ui.note('Melaton Mobile restarts to change its version, and installs the new version\'s pictures as it starts. Your settings and programs are kept.')}`;
        el.querySelectorAll('input[name="wm-version"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) d.version = r.value; }));
    }

    async function versionCommit(d) {
        if (!d.version || d.version === wmSettings.storedVersion()) return [];
        try { localStorage.setItem(wmSettings.keys.version, d.version); } catch (_) { return []; }
        if (d.version === wmSettings.version()) return [wmSettings.keys.version]; // back to the running one
        const name = new Map(wmSettings.versions).get(d.version);
        const yes = await ui.messageBox({
            title: 'Melaton Update', icon: 'question',
            text: `Melaton Mobile must restart to change to ${name}. Restart now?`,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }]
        });
        if (yes) {
            const m = swm();
            if (m && typeof m.forceRestart === 'function') m.forceRestart(); else location.reload();
        }
        return [wmSettings.keys.version];
    }

    // Applied Updates (Yozora #774): the asset packages on this device (assetPackages.js), the
    // automatic ones (this Melaton Mobile's version and screen density: "in use") and the ones
    // added here; "Add an update package from Melaton Update" picks more (a phone that also runs a
    // desktop, a screen that changes scale). Adding downloads now when small, else asks to restart.
    const mb = (b) => `${(Number(b || 0) / 1048576).toFixed(1)} MB`;
    function appliedRender(el, d) {
        const pk = window.melatonPackages;
        if (!pk) { el.innerHTML = ui.text('Update packages are not available in this version of Melaton.'); return; }
        if (!d.pkgInfo && !d.pkgLoading) {
            d.pkgLoading = true;
            fetch('/install/packages', { cache: 'no-store', credentials: 'same-origin' })
                .then((r) => r.json()).then((j) => { d.pkgInfo = j && j.packages ? j.packages : []; })
                .catch(() => { d.pkgInfo = []; })
                .finally(() => { d.pkgLoading = false; if (d.rerender) d.rerender(); });
        }
        const info = new Map((d.pkgInfo || []).map((x) => [x.id, x]));
        const label = (id) => (pk.PACKAGES.find((p) => p.id === id) || { label: id }).label;
        const size = (id) => (info.has(id) && info.get(id).bytes > 0 ? mb(info.get(id).bytes) : '');
        const active = pk.current();
        const auto = new Set(pk.automatic());
        if (d.addPkgs) {
            const choices = pk.PACKAGES.filter((p) => !active.includes(p.id));
            el.innerHTML = `${ui.sub('Add an update package from Melaton Update')}
                ${choices.length ? ui.listbox(choices.map((p) => ({ key: p.id, label: `${p.label}${size(p.id) ? `  (${size(p.id)})` : ''}`, checked: d.addPkgs.has(p.id) })), { maxHeight: 220 }) : ui.text('Every package is already on this device.')}
                ${ui.note('Packages hold Melaton Mobile\'s pictures for a version and a screen density (HiDPI = 2x, UHiDPI = 4x).')}
                ${ui.buttons([['pkg-cancel', 'Cancel'], ['pkg-add', 'Add', !choices.length]])}`;
            const box = el.querySelector('.wm-listbox');
            if (box) ui.bindListbox(box, null, (key, on) => { if (on) d.addPkgs.add(key); else d.addPkgs.delete(key); });
            el.querySelector('[data-act="pkg-cancel"]').addEventListener('click', () => { d.addPkgs = null; d.rerender(); });
            el.querySelector('[data-act="pkg-add"]').addEventListener('click', async () => {
                const ids = [...d.addPkgs]; d.addPkgs = null;
                let change = null;
                for (const id of ids) { const c = pk.pin(id); change = change ? { added: change.added.concat(c.added), removed: [] } : c; }
                d.rerender();
                const m = swm();
                if (change && change.added.length && m && typeof m.applyPackageChange === 'function') {
                    const done = await m.applyPackageChange(change, {
                        confirmLarge: ({ bytes }) => ui.messageBox({ title: 'Melaton Update', icon: 'question', text: `The packages are ${mb(bytes)}. Melaton Mobile must restart to install them. Restart now?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }] })
                    }).catch(() => null);
                    if (done && done.action === 'later') ui.messageBox({ title: 'Melaton Update', icon: 'info', text: 'The packages are installed the next time Melaton Mobile restarts.' });
                }
            });
            return;
        }
        // the name, and (added) for the ones picked here: in use is the rule, said once below
        const rows = active.map((id) => ({ key: id, label: `${label(id)}${auto.has(id) ? '' : ' (added)'}`, selected: id === d.pkgSel }));
        el.innerHTML = `${ui.sub('Applied Updates')}
            ${rows.length ? ui.listbox(rows, { maxHeight: 200 }) : ui.text(d.pkgLoading ? 'Checking Melaton Update...' : 'Only the core of Melaton is on this device.')}
            ${ui.buttons([['pkg-remove', 'Remove', !(d.pkgSel && !auto.has(d.pkgSel) && active.includes(d.pkgSel))]])}
            ${ui.gap()}
            <div class="wm-sys-pkg-more">${ui.buttons([['pkg-more', 'Add an update package from Melaton Update...']], false)}</div>
            ${ui.note('Packages in use come with this Melaton Mobile and its screen. Removed packages are deleted the next time Melaton tidies its files.')}`;
        const box = el.querySelector('.wm-listbox');
        if (box) ui.bindListbox(box, (key) => { d.pkgSel = key; d.rerender(); });
        el.querySelector('[data-act="pkg-more"]').addEventListener('click', () => { d.addPkgs = new Set(); d.rerender(); });
        el.querySelector('[data-act="pkg-remove"]').addEventListener('click', () => { if (d.pkgSel) pk.unpin(d.pkgSel); d.pkgSel = null; d.rerender(); });
    }

    function updateRender(el, tab, d, api) {
        d.rerender = api.rerender;
        if (tab === 'version') { versionRender(el, d); return; }
        if (tab === 'applied') { appliedRender(el, d); return; }
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
        tabs: [['update', 'Update'], ['schedule', 'Schedule'], ['applied', 'Applied Updates'], ['version', 'Version']],
        init: updateInit,
        render: updateRender,
        commit(d) {
            clearInterval(d.watch);
            const m = swm();
            if (m && m.foregroundUpdateView) m.foregroundUpdateView = null;
            return versionCommit(d);
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
        // the phone's Android programs add an Android tab (wmAndroidApps.js, #773)
        ownTab: ['programs', 'Programs'],
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
