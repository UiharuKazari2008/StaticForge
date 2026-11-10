/**
 * Melaton Mobile: Calendar (WM 6.1 Professional's Calendar, poutlook.exe), Yozora #732, parent #709.
 *
 * The data is the desktop Melaton Calendar's (apps/calendar): one iCalendar file per calendar in the
 * workspace's Calendars folder (VFS /Workspaces/<ws>/Calendars/<name>.ics). It is read and written with
 * the package's own parser and writer (window.melatonCalendar.parseIcs / toIcs / occurrences, loaded by
 * melatonApps.ensureLoaded('calendar') without opening its window), so the phone and the desktop share
 * every appointment. Subscribed calendars stay read-only; calendars hidden on the desktop stay hidden.
 *
 * Measured on the Device Emulator (VGA halved; ~/.cache/wm61/ref-apps/cal*.png):
 *   header   22 px tint band + 1 px rule: "Nov 10, 26" and the week's letters (Sunday red, Saturday
 *            blue, the day selected in a highlight box) in Agenda and Day; "November 2026" in Week and
 *            Month, "2026" in Year; then Go to Today, the previous / next arrows (outres.dll 11063)
 *   Agenda   a 10-hour strip (17 px) with the day's appointments as lavender bars, then the day's
 *            appointments: subject (bold) over "12:00p-1:00p (Location)", 33 px, grey rule
 *   Day      17 px hours, working hours (8-5) yellow, the rest grey; appointments as boxes from x 16
 *   Week     Monday to Friday (all seven when a weekend day is picked), the details pane under it
 *   Month    six weeks filling the screen, appointments as corner triangles (morning / afternoon)
 *   Year     the twelve months, three across
 *   the left soft key names the next view (Agenda -> Day -> Week -> Month -> Year -> Agenda), Menu
 *   holds New Appointment, Delete Appointment, Go to Today, Go to Date, View. An appointment opens to
 *   its summary (ok, Menu > Edit / Delete); New and Edit use WM's form (Contacts' metrics) with the
 *   Appointment and Notes tabs, ok saves.
 * Programs lists it in place of the desktop's Melaton Calendar (wmPrograms.js MAPPED). Only on phones.
 * Styles: public/css/wm-calendar.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'calendar';
    const REG_KEY = 'HKCU\\Software\\Xyridian\\Melaton\\Windows Calendar';
    const VIEWS = ['agenda', 'day', 'week', 'month', 'year'];
    const VIEW_LABEL = { agenda: 'Agenda', day: 'Day', week: 'Week', month: 'Month', year: 'Year' };
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const DAYS3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const WORK_START = 8;
    const WORK_END = 17;
    const RELOAD_MS = 30000;

    let ws = null;
    let page = null;
    let MC = null; // window.melatonCalendar
    let cals = [];
    let loadedAt = 0;
    let loading = null;
    let view = 'agenda';
    let date = startOfDay(new Date());
    let selHour = null; // the slot picked in Day / Week (an hour, on `date`)
    let sel = null; // the appointment picked: { ev, cal, start, end }
    let layer = null; // null | 'summary' | 'form'
    let fromSummary = false;
    let form = null; // the appointment being edited

    // ---------------------------------------------------------------- dates and text

    function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()); }
    function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
    const pad = (n) => String(n).padStart(2, '0');
    const esc = (s) => ws.escapeHtml(String(s == null ? '' : s));
    const h12 = (h) => (h % 12) || 12;
    const shortTime = (d) => `${h12(d.getHours())}:${pad(d.getMinutes())}${d.getHours() < 12 ? 'a' : 'p'}`;
    const formTime = (d) => `${h12(d.getHours())}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
    const formDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${pad(d.getFullYear() % 100)}`;
    const headDate = (d) => `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${pad(d.getFullYear() % 100)}`;
    const longDate = (d) => `${DAYS3[d.getDay()]}, ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    const inputDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const inputTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@melaton`;

    function span(o) {
        if (o.ev.allDay) return 'All Day';
        return `${shortTime(o.start)}-${shortTime(o.end)}`;
    }

    // ---------------------------------------------------------------- data (the desktop's .ics files)

    const vfs = () => (typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient) || null; // eslint-disable-line no-undef
    const reg = (n, d) => (window.melatonRegistry ? window.melatonRegistry.get(REG_KEY, n, d) : d);

    function workspaceRoot() {
        let w = 'Default';
        try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) w = activeWorkspace; } catch (_) { /* none */ } // eslint-disable-line no-undef
        return `/Workspaces/${w}`;
    }
    const folder = () => `${workspaceRoot()}/Calendars`;

    async function ensureParser() {
        if (window.melatonCalendar && window.melatonCalendar.parseIcs) return window.melatonCalendar;
        if (!window.melatonApps || typeof window.melatonApps.ensureLoaded !== 'function') throw new Error('Calendar is not installed.');
        await window.melatonApps.ensureLoaded('calendar');
        if (!window.melatonCalendar) throw new Error('Calendar could not be loaded.');
        return window.melatonCalendar;
    }

    /** One calendar as the desktop's Calendar holds it (apps/calendar adopt()). */
    function adopt(parsed, file, n) {
        const cal = {
            id: `c${n}`,
            name: parsed.name || String(file.name || 'Calendar').replace(/\.ics$/i, ''),
            color: parsed.color || '#ccffcc',
            source: parsed.source || '',
            refresh: parsed.refresh || 0,
            fileId: file.id || null,
            fileName: file.name || null,
            events: [],
            tasks: [],
            visible: true
        };
        cal.readonly = !!cal.source;
        parsed.events.forEach((e) => cal.events.push({ uid: e.uid || uid(), summary: e.summary || '', location: e.location || '', description: e.description || '', url: e.url || '', start: e.start, end: e.end, allDay: !!e.allDay, rrule: e.rrule || null, exdates: e.exdates || [], reminder: e.reminder === undefined ? null : e.reminder, reminderAt: e.reminderAt || null, attendees: e.attendees || [] }));
        parsed.tasks.forEach((t) => cal.tasks.push({ uid: t.uid || uid(), summary: t.summary || '', due: t.due || null, start: t.start || null, priority: t.priority || 0, completed: !!t.completed, completedAt: t.completedAt || null, reminderAt: t.reminderAt || null, description: t.description || '', url: t.url || '' }));
        return cal;
    }

    async function load() {
        MC = await ensureParser();
        const V = vfs();
        if (!V) throw new Error('Files are not available.');
        let items = [];
        try {
            const res = await V.listDirectory(folder(), { offset: 0, limit: 200 });
            items = (res && res.items) || [];
        } catch (_) { items = []; } // no Calendars folder yet: nothing to show until the first save
        const files = items.filter((i) => /\.ics$/i.test(i.name || '') && (i.targetKind === 'user-file' || i.kind === 'file'));
        const next = [];
        for (const f of files) {
            try {
                const r = await V.downloadFile(f.id);
                const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin', cache: 'no-store' })).text();
                next.push(adopt(MC.parseIcs(text), f, next.length));
            } catch (err) {
                console.warn('wmCalendar: could not read', f.name, err);
            }
        }
        let hidden = [];
        try { hidden = JSON.parse(reg('Hidden', '[]')) || []; } catch (_) { hidden = []; }
        next.forEach((c) => { c.visible = !hidden.includes(c.name); });
        cals = next;
        loadedAt = Date.now();
        // the selection points at the old objects: find it again by uid
        if (sel) {
            const s = sel;
            sel = null;
            for (const c of cals) {
                const ev = c.events.find((e) => e.uid === s.ev.uid);
                if (ev) { sel = { ev, cal: c, start: s.start, end: s.end }; break; }
            }
        }
    }

    function reload(force) {
        if (loading) return loading;
        if (!force && loadedAt && Date.now() - loadedAt < RELOAD_MS) return Promise.resolve();
        const first = !loadedAt;
        const p = load().catch((err) => {
            ws.notify({ title: 'Calendar', icon: 'error', text: (err && err.message) || 'The calendar could not be opened.' });
        }).finally(() => { loading = null; render(); });
        loading = p;
        // the first open waits under the wait cursor; later refreshes run behind the view
        if (first) ws.busy(p, { paint: true, timeout: 30000 });
        return p;
    }

    function textB64(t) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(new Blob([t], { type: 'text/calendar' }));
        });
    }

    function userName() {
        const a = window.meletonAccounts;
        let n = '';
        try { n = (a && typeof a.displayName === 'function' && a.displayName()) || (a && typeof a.name === 'function' && a.name()) || localStorage.getItem('username') || ''; } catch (_) { n = ''; }
        return n || 'My';
    }

    /** The calendar a new appointment goes to: the first one that can be written (made when none). */
    function writableCal() {
        return cals.find((c) => !c.readonly && c.visible) || cals.find((c) => !c.readonly) || null;
    }

    async function ensureFolder() {
        const V = vfs();
        try {
            const top = await V.listDirectory(workspaceRoot(), { offset: 0, limit: 500 });
            const has = ((top && top.items) || []).some((i) => i.name === 'Calendars' && (i.kind === 'folder' || i.targetKind === 'vfs-folder'));
            if (!has) await V.createFolder(workspaceRoot(), 'Calendars');
        } catch (_) { /* the upload below reports it */ }
    }

    async function save(cal) {
        const V = vfs();
        const data = await textB64(MC.toIcs(cal));
        if (cal.fileId) {
            await V.replaceFile(cal.fileId, data, 'text/calendar');
        } else {
            await ensureFolder();
            const name = `${cal.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Calendar'}.ics`;
            const res = await V.uploadFile(folder(), data, name, 'text/calendar');
            const f = res && (res.file || res.entry || res);
            cal.fileId = (f && (f.id || f.fileId)) || null;
            cal.fileName = name;
        }
        loadedAt = Date.now();
    }

    async function saveUnderCursor(cal) {
        try {
            await ws.busy(() => save(cal), { paint: true, timeout: 30000 });
            return true;
        } catch (err) {
            ws.notify({ title: 'Calendar', icon: 'error', text: `${cal.name} could not be saved: ${(err && err.message) || err}` });
            return false;
        }
    }

    // ---------------------------------------------------------------- occurrences

    function occ(a, b) {
        const out = [];
        if (!MC) return out;
        for (const cal of cals) {
            if (!cal.visible) continue;
            for (const ev of cal.events) {
                for (const o of MC.occurrences(ev, a, b)) out.push({ ev, cal, start: o.start, end: o.end });
            }
        }
        return out.sort((x, y) => (y.ev.allDay - x.ev.allDay) || (x.start - y.start) || String(x.ev.summary).localeCompare(String(y.ev.summary)));
    }

    const dayOcc = (d) => occ(startOfDay(d), addDays(startOfDay(d), 1));
    const isSel = (o) => !!(sel && o && sel.ev === o.ev && +sel.start === +o.start);

    // ---------------------------------------------------------------- the header

    function weekStart(d) { return addDays(startOfDay(d), -d.getDay()); }

    function headerHtml() {
        const today = startOfDay(new Date());
        let left;
        if (view === 'agenda' || view === 'day') {
            const ws0 = weekStart(date);
            const letters = LETTERS.map((l, i) => {
                const d = addDays(ws0, i);
                const cls = `${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}${sameDay(d, date) ? ' is-selected' : ''}${sameDay(d, today) ? ' is-today' : ''}`;
                return `<button type="button" class="wcl-letter${cls}" data-day="${+d}" aria-label="${esc(longDate(d))}">${l}</button>`;
            }).join('');
            left = `<span class="wcl-hdate">${esc(headDate(date))}</span><span class="wcl-letters">${letters}</span>`;
        } else if (view === 'year') {
            left = `<span class="wcl-hdate">${date.getFullYear()}</span>`;
        } else {
            left = `<span class="wcl-hdate">${MONTHS[date.getMonth()]}&nbsp; ${date.getFullYear()}</span>`;
        }
        return `${left}<span class="wcl-hbtns">
            <button type="button" class="wcl-hbtn" data-act="today" aria-label="Go to Today">${ws.art.img('cal-today')}</button>
            <button type="button" class="wcl-hbtn" data-act="prev" aria-label="Previous">${ws.art.img('cal-prev')}</button>
            <span class="wcl-hsep"></span>
            <button type="button" class="wcl-hbtn" data-act="next" aria-label="Next">${ws.art.img('cal-next')}</button></span>`;
    }

    function step(n) {
        if (view === 'agenda' || view === 'day') date = addDays(date, n);
        else if (view === 'week') date = addDays(date, 7 * n);
        else if (view === 'month') date = new Date(date.getFullYear(), date.getMonth() + n, Math.min(date.getDate(), new Date(date.getFullYear(), date.getMonth() + n + 1, 0).getDate()));
        else date = new Date(date.getFullYear() + n, date.getMonth(), Math.min(date.getDate(), new Date(date.getFullYear() + n, date.getMonth() + 1, 0).getDate()));
        sel = null;
        render();
    }

    // ---------------------------------------------------------------- views

    function agendaHtml() {
        const list = dayOcc(date);
        // the strip shows 10 hours from a little before the first appointment (or now)
        const firstTimed = list.find((o) => !o.ev.allDay && sameDay(o.start, date));
        const base = firstTimed ? firstTimed.start.getHours() - 4 : (sameDay(date, new Date()) ? new Date().getHours() - 1 : WORK_START);
        const from = Math.max(0, Math.min(14, base));
        const hours = Array.from({ length: 10 }, (_, i) => from + i);
        const t0 = new Date(date.getFullYear(), date.getMonth(), date.getDate(), from);
        const bars = list.filter((o) => !o.ev.allDay).map((o) => {
            const a = Math.max(0, (o.start - t0) / 3600000);
            const b = Math.min(10, (o.end - t0) / 3600000);
            if (b <= 0 || a >= 10) return '';
            return `<span class="wcl-sbar${isSel(o) ? ' is-selected' : ''}" style="left:${(a * 10).toFixed(3)}%;width:${Math.max(1, (b - a) * 10).toFixed(3)}%"></span>`;
        }).join('');
        const strip = `<div class="wcl-strip">${hours.map((h) => `<span class="wcl-shour">${h12(h)}</span>`).join('')}${bars}</div>`;
        const rows = list.length ? list.map((o, i) => `<div class="wcl-arow${isSel(o) ? ' is-selected' : ''}" data-i="${i}">
                <div class="wcl-asubj">${esc(o.ev.summary || '(No subject)')}</div>
                <div class="wcl-asub">${esc(span(o))}${o.ev.location ? ` (${esc(o.ev.location)})` : ''}</div></div>`).join('')
            : '<div class="wcl-arow is-empty"><div class="wcl-asubj">No appointments.</div></div>';
        return { html: `${strip}<div class="wcl-alist wm-pv-scroll">${rows}</div>`, list };
    }

    function dayHtml() {
        const list = dayOcc(date);
        const allDay = list.filter((o) => o.ev.allDay || !sameDay(o.start, date));
        const timed = list.filter((o) => !(o.ev.allDay || !sameDay(o.start, date)));
        // overlapping appointments share the width, side by side
        const lanes = [];
        timed.forEach((o) => {
            let lane = lanes.findIndex((end) => end <= +o.start);
            if (lane < 0) { lane = lanes.length; lanes.push(0); }
            lanes[lane] = +o.end;
            o.lane = lane;
        });
        const n = Math.max(1, lanes.length);
        const rows = Array.from({ length: 24 }, (_, h) => `<div class="wcl-hour${h >= WORK_START && h < WORK_END ? ' is-work' : ''}${selHour === h && !sel ? ' is-picked' : ''}" data-h="${h}"><span class="wcl-hlabel">${h12(h)}</span></div>`).join('');
        const boxes = timed.map((o) => {
            const i = list.indexOf(o);
            const top = (o.start.getHours() + o.start.getMinutes() / 60);
            const len = Math.max(0.5, Math.min(24 - top, (o.end - o.start) / 3600000));
            return `<div class="wcl-dbox${isSel(o) ? ' is-selected' : ''}" data-i="${i}" style="--t:${top};--l:${len};--lane:${o.lane};--lanes:${n}"><span class="wcl-dbar"></span><span class="wcl-dtext"><b>${esc(o.ev.summary || '(No subject)')}</b>${o.ev.location ? ` (${esc(o.ev.location)})` : ''}</span></div>`;
        }).join('');
        const top = allDay.length ? `<div class="wcl-allday">${allDay.map((o) => `<div class="wcl-adbox${isSel(o) ? ' is-selected' : ''}" data-i="${list.indexOf(o)}"><b>${esc(o.ev.summary || '(No subject)')}</b>${o.ev.location ? ` (${esc(o.ev.location)})` : ''}</div>`).join('')}</div>` : '';
        return { html: `${top}<div class="wcl-dscroll wm-pv-scroll"><div class="wcl-dgrid">${rows}${boxes}</div></div>`, list };
    }

    function weekDays() {
        const d = date.getDay();
        if (d === 0 || d === 6) return Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
        const mon = addDays(startOfDay(date), 1 - d);
        return Array.from({ length: 5 }, (_, i) => addDays(mon, i));
    }

    function weekHtml() {
        const days = weekDays();
        const list = occ(days[0], addDays(days[days.length - 1], 1));
        const today = startOfDay(new Date());
        const head = `<div class="wcl-whead" style="--cols:${days.length}"><span class="wcl-wcorner"></span>${days.map((d) => `<button type="button" class="wcl-wday${sameDay(d, date) ? ' is-selected' : ''}${sameDay(d, today) ? ' is-today' : ''}" data-day="${+d}"><b>${LETTERS[d.getDay()]}</b> ${pad(d.getDate())}</button>`).join('')}</div>`;
        const hours = Array.from({ length: 24 }, (_, h) => `<div class="wcl-whour${h >= WORK_START && h < WORK_END ? ' is-work' : ''}" style="--h:${h}"><span class="wcl-hlabel">${h12(h)}</span>${days.map((d) => `<span class="wcl-wcell${sameDay(d, date) && selHour === h && !sel ? ' is-picked' : ''}" data-day="${+d}" data-h="${h}"></span>`).join('')}</div>`).join('');
        const boxes = list.map((o, i) => {
            const col = days.findIndex((d) => sameDay(d, o.start));
            if (col < 0) return '';
            const top = o.ev.allDay ? 0 : o.start.getHours() + o.start.getMinutes() / 60;
            const len = o.ev.allDay ? 24 : Math.max(0.5, Math.min(24 - top, (o.end - o.start) / 3600000));
            return `<span class="wcl-wbox${isSel(o) ? ' is-selected' : ''}" data-i="${i}" style="--t:${top};--l:${len};--c:${col}"></span>`;
        }).join('');
        const det = sel ? `<b>${esc(sel.ev.summary || '(No subject)')}</b><br>${esc(span(sel))}${sel.ev.location ? ` (${esc(sel.ev.location)})` : ''}` : '<b>No appointment selected.</b>';
        return { html: `${head}<div class="wcl-wscroll wm-pv-scroll"><div class="wcl-wgrid" style="--cols:${days.length}">${hours}${boxes}</div></div><div class="wcl-wdetail">${det}</div>`, list };
    }

    function monthHtml() {
        const first = new Date(date.getFullYear(), date.getMonth(), 1);
        const start = addDays(first, -first.getDay());
        const end = addDays(start, 42);
        const list = occ(start, end);
        const today = startOfDay(new Date());
        const head = LETTERS.map((l, i) => `<span class="wcl-mlet${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}">${l}</span>`).join('');
        let cells = '';
        for (let i = 0; i < 42; i++) {
            const d = addDays(start, i);
            const its = list.filter((o) => sameDay(o.start, d) || (o.ev.allDay && o.start <= d && o.end > d));
            const am = its.some((o) => !o.ev.allDay && o.start.getHours() < 12);
            const pm = its.some((o) => !o.ev.allDay && (o.start.getHours() >= 12 || o.end.getHours() > 12 || !sameDay(o.start, o.end)));
            const ad = its.some((o) => o.ev.allDay);
            const cls = `${d.getMonth() !== date.getMonth() ? ' is-out' : ''}${d.getDay() === 0 ? ' is-sun' : d.getDay() === 6 ? ' is-sat' : ''}${sameDay(d, date) ? ' is-selected' : ''}${sameDay(d, today) ? ' is-today' : ''}`;
            cells += `<button type="button" class="wcl-mcell${cls}" data-day="${+d}"><span class="wcl-mnum">${d.getDate()}</span>${am ? '<i class="wcl-mam"></i>' : ''}${pm ? '<i class="wcl-mpm"></i>' : ''}${ad ? '<i class="wcl-mad"></i>' : ''}</button>`;
        }
        return { html: `<div class="wcl-mhead">${head}</div><div class="wcl-mgrid">${cells}</div>`, list };
    }

    function yearHtml() {
        const y = date.getFullYear();
        const today = startOfDay(new Date());
        let html = '';
        for (let m = 0; m < 12; m++) {
            const first = new Date(y, m, 1);
            const n = new Date(y, m + 1, 0).getDate();
            // five rows, as the device: a date that needs a sixth row shares its cell with the date
            // a week before, drawn as a slash (May 2026: 24/31)
            const slots = Array.from({ length: 35 }, () => []);
            for (let d = 1; d <= n; d++) {
                const at = first.getDay() + d - 1;
                slots[at >= 35 ? at - 7 : at].push(d);
            }
            let cells = '';
            slots.forEach((ds, i) => {
                if (!ds.length) { cells += '<span></span>'; return; }
                const dt = new Date(y, m, ds[0]);
                const wd = i % 7;
                const has = (x) => ds.some((d) => sameDay(new Date(y, m, d), x));
                const cls = `${wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : ''}${has(today) ? ' is-today' : ''}${has(date) ? ' is-selected' : ''}${ds.length > 1 ? ' is-shared' : ''}`;
                cells += `<button type="button" class="wcl-yday${cls}" data-day="${+dt}" aria-label="${ds.join('/')}">${ds.length > 1 ? '' : ds[0]}</button>`;
            });
            html += `<div class="wcl-ymonth"><div class="wcl-yname">${MONTHS[m]}</div><div class="wcl-ydays">${cells}</div></div>`;
        }
        return { html: `<div class="wcl-ygrid">${html}</div>`, list: [] };
    }

    let shownList = [];

    function renderView() {
        const body = page.querySelector('.wcl-body');
        const r = view === 'agenda' ? agendaHtml() : view === 'day' ? dayHtml() : view === 'week' ? weekHtml() : view === 'month' ? monthHtml() : yearHtml();
        shownList = r.list;
        page.querySelector('.wcl-head').innerHTML = headerHtml();
        const keepDay = body.querySelector('.wcl-dscroll, .wcl-wscroll');
        const scroll = keepDay && body.dataset.view === view ? keepDay.scrollTop : null;
        body.dataset.view = view;
        body.className = `wcl-body is-${view}`;
        body.innerHTML = r.html;
        const sc = body.querySelector('.wcl-dscroll, .wcl-wscroll');
        // the week's day header keeps clear of the grid's scroll bar (none when the day fits)
        if (sc) body.style.setProperty('--wcl-gutter', `${sc.offsetWidth - sc.clientWidth}px`);
        if (sc) {
            if (scroll !== null) sc.scrollTop = scroll;
            else {
                // opens on the working day (8 o'clock at the top), or the selection
                const row = sc.querySelector('.wcl-hour, .wcl-whour');
                const h = row ? row.getBoundingClientRect().height : 0;
                const first = sel && !sel.ev.allDay ? sel.start.getHours() : selHour !== null ? selHour : WORK_START;
                sc.scrollTop = Math.max(0, Math.min(first, WORK_START) * h);
            }
        }
    }

    function render() {
        if (!page) return;
        page.querySelector('.wcl-main').hidden = layer !== null;
        page.querySelector('.wcl-summary').hidden = layer !== 'summary';
        page.querySelector('.wcl-form').hidden = layer !== 'form';
        if (layer === null) renderView();
        else if (layer === 'summary') renderSummary();
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    // ---------------------------------------------------------------- summary

    function renderSummary() {
        const box = page.querySelector('.wcl-summary');
        if (!sel) { layer = null; render(); return; }
        const o = sel;
        const when = o.ev.allDay ? longDate(o.start) : `${shortTime(o.start)}-${shortTime(o.end)} ${longDate(o.start)}`;
        const rem = o.ev.reminder !== null && o.ev.reminder !== undefined || !!o.ev.reminderAt;
        box.innerHTML = `<div class="wcl-shead">
                <div class="wcl-ssubj">${esc(o.ev.summary || '(No subject)')}</div>${rem ? `<span class="wcl-sbell">${ws.art.img('cal-bell')}</span>` : ''}
                <div class="wcl-sline">${esc(when)}</div>
                ${o.ev.location ? `<div class="wcl-sline">${esc(o.ev.location)}</div>` : ''}
                ${o.ev.rrule ? `<div class="wcl-sline">${esc(occursText(o.ev.rrule, o.ev.start))}</div>` : ''}
                ${o.cal.readonly ? `<div class="wcl-sline">${esc(o.cal.name)} (read-only)</div>` : ''}
            </div>
            <div class="wcl-snotes">${esc(o.ev.description || '')}</div>`;
    }

    function openSummary(o) {
        sel = o;
        fromSummary = false;
        layer = 'summary';
        render();
        ws.syncHistory();
    }

    // ---------------------------------------------------------------- the form

    const OCCURS = (d) => [
        ['', 'Once'],
        ['WEEKLY', `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]}`],
        ['MONTHLY', `Day ${d.getDate()} of every month`],
        ['YEARLY', `Every ${MONTHS[d.getMonth()]} ${d.getDate()}`],
        ['DAILY', 'Every day']
    ];

    function occursText(r, d) {
        if (!r) return 'Once';
        if (r.freq === 'WEEKLY' && r.byday && r.byday.length > 1) return 'Weekly';
        const hit = OCCURS(d).find(([k]) => k === r.freq);
        return hit ? hit[1] : 'Recurring';
    }

    const UNITS = [[1, 'minute(s)'], [60, 'hour(s)'], [1440, 'day(s)'], [10080, 'week(s)']];

    function remParts(min) {
        if (min === null || min === undefined) return { n: 15, unit: 1 };
        for (const [u] of UNITS.slice().reverse()) if (min && min % u === 0) return { n: min / u, unit: u };
        return { n: min, unit: 1 };
    }

    function newForm(start) {
        const s = start || (() => {
            const d = new Date(date);
            const now = new Date();
            d.setHours(selHour !== null ? selHour : (sameDay(date, now) ? now.getHours() + 1 : WORK_START), 0, 0, 0);
            return d;
        })();
        const rem = remParts(15);
        return { ev: null, cal: null, summary: '', location: '', description: '', start: s, end: new Date(+s + 3600000), allDay: false, freq: '', remind: true, remN: rem.n, remUnit: rem.unit, attendees: [] };
    }

    function editForm(o) {
        const ev = o.ev;
        const rem = remParts(ev.reminder);
        // a recurring appointment is edited as its series (its first start)
        const start = ev.rrule ? ev.start : o.start;
        const end = ev.rrule ? ev.end : o.end;
        return { ev, cal: o.cal, summary: ev.summary || '', location: ev.location || '', description: ev.description || '', start: new Date(start), end: new Date(ev.allDay ? +end - 86400000 : end), allDay: !!ev.allDay, freq: ev.rrule ? ev.rrule.freq : '', rrule: ev.rrule, remind: ev.reminder !== null && ev.reminder !== undefined, remN: rem.n, remUnit: rem.unit, attendees: ev.attendees || [] };
    }

    function fieldRow(key, label, value, opts = {}) {
        const drop = opts.drop ? '<span class="wcl-fdrop" aria-hidden="true"></span>' : '';
        return `<div class="wcl-field${opts.cls ? ` ${opts.cls}` : ''}" data-key="${key}"><span class="wcl-flabel">${label ? `${esc(label)}:` : ''}</span>${value}${drop}</div>`;
    }

    function renderForm() {
        const f = form;
        const box = page.querySelector('.wcl-fbody');
        const st = (k, text, picker) => `<button type="button" class="wcl-fval" data-pick="${k}">${esc(text)}</button>${picker || ''}`;
        const when = (k, d) => `<span class="wcl-fdt">${st(`${k}-date`, formDate(d), `<input type="date" class="wcl-fnative" data-native="${k}-date" value="${inputDate(d)}" tabindex="-1" aria-hidden="true">`)}${f.allDay ? '' : st(`${k}-time`, formTime(d), `<input type="time" class="wcl-fnative" data-native="${k}-time" value="${inputTime(d)}" tabindex="-1" aria-hidden="true">`)}</span>`;
        box.innerHTML = [
            fieldRow('subject', 'Subject', `<input type="text" class="wcl-finput" data-f="summary" value="${esc(f.summary)}" autocomplete="off" aria-label="Subject">`, { drop: true, cls: 'is-boxed' }),
            fieldRow('location', 'Location', `<input type="text" class="wcl-finput" data-f="location" value="${esc(f.location)}" autocomplete="off" aria-label="Location">`, { drop: true }),
            fieldRow('starts', 'Starts', when('start', f.start)),
            fieldRow('ends', 'Ends', when('end', f.end)),
            fieldRow('allday', 'All Day', st('allday', f.allDay ? 'Yes' : 'No')),
            fieldRow('occurs', 'Occurs', st('occurs', f.freq ? occursText(f.rrule && f.rrule.freq === f.freq ? f.rrule : { freq: f.freq }, f.start) : 'Once')),
            fieldRow('reminder', 'Reminder', st('reminder', f.remind ? 'Remind me' : 'None')),
            f.remind ? fieldRow('remwhen', '', `<span class="wcl-fdt is-rem"><input type="number" class="wcl-finput wcl-fnum" data-f="remN" min="0" max="999" value="${esc(f.remN)}" aria-label="Reminder time">${st('remunit', (UNITS.find(([u]) => u === f.remUnit) || UNITS[0])[1])}</span>`) : '',
            fieldRow('categories', 'Categories', '<span class="wcl-fval is-static">No categories...</span>'),
            fieldRow('attendees', 'Attendees', `<span class="wcl-fval is-static">${esc(f.attendees.length ? f.attendees.map((a) => a.name || a.email).join('; ') : 'No attendees...')}</span>`),
            fieldRow('status', 'Status', '<span class="wcl-fval is-static">Busy</span>'),
            fieldRow('sensitivity', 'Sensitivity', '<span class="wcl-fval is-static">Normal</span>')
        ].join('');
        page.querySelector('.wcl-fnotes').value = f.description;
    }

    function openForm(o, start) {
        if (!MC) return;
        if (o && o.cal.readonly) {
            ws.notify({ title: 'Calendar', icon: 'info', text: `${o.cal.name} is a subscribed calendar and cannot be changed here.` });
            return;
        }
        fromSummary = layer === 'summary';
        form = o ? editForm(o) : newForm(start);
        layer = 'form';
        page.querySelector('.wcl-form').dataset.tab = 'appt';
        page.querySelectorAll('.wcl-ftab').forEach((t) => t.classList.toggle('is-selected', t.dataset.tab === 'appt'));
        render();
        renderForm();
        ws.syncHistory();
        // a new appointment starts typing in Subject (the tap that opened it gives the focus)
        if (!o) { const s = page.querySelector('.wcl-finput[data-f="summary"]'); if (s) s.focus(); }
    }

    function readForm() {
        page.querySelectorAll('.wcl-finput[data-f]').forEach((i) => {
            const k = i.dataset.f;
            form[k] = k === 'remN' ? Math.max(0, parseInt(i.value, 10) || 0) : i.value;
        });
        form.description = page.querySelector('.wcl-fnotes').value;
    }

    function setWhen(which, part, value) {
        const f = form;
        const d = new Date(which === 'start' ? f.start : f.end);
        if (part === 'date') { const [y, m, dd] = value.split('-').map(Number); if (!y) return; d.setFullYear(y, m - 1, dd); } else { const [h, mi] = value.split(':').map(Number); if (Number.isNaN(h)) return; d.setHours(h, mi || 0, 0, 0); }
        if (which === 'start') {
            // the end moves with the start (the length stays), as on the device
            const len = f.end - f.start;
            f.start = d;
            f.end = new Date(+d + Math.max(0, len));
        } else {
            f.end = d < f.start ? new Date(f.start) : d;
        }
    }

    function pick(btn) {
        readForm();
        const k = btn.dataset.pick;
        const redo = () => renderForm();
        if (/-(date|time)$/.test(k)) {
            const input = btn.parentElement.querySelector(`[data-native="${k}"]`);
            if (!input) return;
            input.onchange = () => { const [which, part] = k.split('-'); setWhen(which, part, input.value); redo(); };
            try { input.showPicker(); } catch (_) { input.focus(); input.click(); }
            return;
        }
        let items = [];
        if (k === 'allday') items = [['No', false], ['Yes', true]].map(([l, v]) => ({ label: l, radio: form.allDay === v, action: () => { form.allDay = v; if (v) { form.start = startOfDay(form.start); form.end = startOfDay(form.end < form.start ? form.start : form.end); } redo(); } }));
        else if (k === 'occurs') items = OCCURS(form.start).map(([v, l]) => ({ label: l, radio: form.freq === v, action: () => { form.freq = v; redo(); } }));
        else if (k === 'reminder') items = [['None', false], ['Remind me', true]].map(([l, v]) => ({ label: l, radio: form.remind === v, action: () => { form.remind = v; redo(); } }));
        else if (k === 'remunit') items = UNITS.map(([u, l]) => ({ label: l, radio: form.remUnit === u, action: () => { form.remUnit = u; redo(); } }));
        if (items.length) ws.dropdown(btn, items, 'left');
    }

    /** Subject / Location's drop arrow: what earlier appointments used. */
    function recent(key) {
        const seen = new Set();
        const out = [];
        for (const c of cals) for (const ev of c.events) {
            const v = String(ev[key] || '').trim();
            if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
        }
        return out.slice(-12).reverse();
    }

    async function commitForm() {
        readForm();
        const f = form;
        let cal = f.cal;
        if (!cal) {
            cal = writableCal();
            if (!cal) {
                cal = { id: `c${cals.length}`, name: `${userName()}'s Calendar`, color: '#ccffcc', source: '', refresh: 0, fileId: null, fileName: null, events: [], tasks: [], visible: true, readonly: false };
                cals.push(cal);
            }
        }
        const start = f.allDay ? startOfDay(f.start) : f.start;
        const end = f.allDay ? addDays(startOfDay(f.end < f.start ? f.start : f.end), 1) : (f.end < f.start ? f.start : f.end);
        const ev = f.ev || { uid: uid(), url: '', exdates: [], reminderAt: null, attendees: [] };
        ev.summary = f.summary.trim();
        ev.location = f.location.trim();
        ev.description = f.description;
        ev.start = start;
        ev.end = end;
        ev.allDay = f.allDay;
        // keep an advanced rule the form cannot show when Occurs was not changed
        if (!f.freq) ev.rrule = null;
        else if (!(f.rrule && f.rrule.freq === f.freq)) ev.rrule = { freq: f.freq, interval: 1 };
        ev.reminder = f.remind ? f.remN * f.remUnit : null;
        if (!f.remind) ev.reminderAt = null;
        if (!f.ev) cal.events.push(ev);
        const ok = await saveUnderCursor(cal);
        if (!ok) return;
        date = startOfDay(start);
        // the saved appointment is the selection, as on the device
        sel = { ev, cal, start: ev.start, end: ev.end };
        form = null;
        layer = null;
        render();
        ws.syncHistory();
    }

    function cancelForm() {
        form = null;
        layer = fromSummary && sel ? 'summary' : null;
        render();
        ws.syncHistory();
    }

    async function deleteSel() {
        const o = sel;
        if (!o) return;
        if (o.cal.readonly) { ws.notify({ title: 'Calendar', icon: 'info', text: `${o.cal.name} is a subscribed calendar and cannot be changed here.` }); return; }
        const yes = await ws.messageBox({ title: 'Calendar', icon: 'warning', text: 'Permanently delete this appointment?', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }] });
        if (!yes) return;
        const i = o.cal.events.indexOf(o.ev);
        if (i < 0) return;
        o.cal.events.splice(i, 1);
        const ok = await saveUnderCursor(o.cal);
        if (!ok) { o.cal.events.splice(i, 0, o.ev); return; }
        sel = null;
        layer = null;
        render();
        ws.syncHistory();
    }

    // ---------------------------------------------------------------- input

    function onTap(e) {
        const t = e.target;
        const hb = t.closest('.wcl-hbtn');
        if (hb) {
            if (hb.dataset.act === 'today') { date = startOfDay(new Date()); sel = null; render(); } else step(hb.dataset.act === 'prev' ? -1 : 1);
            return;
        }
        const letter = t.closest('.wcl-letter, .wcl-wday');
        if (letter) { date = new Date(Number(letter.dataset.day)); sel = null; selHour = null; render(); return; }
        if (layer === 'form') {
            const p = t.closest('[data-pick]');
            if (p) { pick(p); return; }
            const drop = t.closest('.wcl-fdrop');
            if (drop) {
                readForm();
                const key = drop.closest('.wcl-field').dataset.key === 'subject' ? 'summary' : 'location';
                const list = recent(key);
                if (list.length) ws.dropdown(drop.closest('.wcl-field').querySelector('.wcl-finput'), list.map((v) => ({ label: v, action: () => { form[key] = v; renderForm(); } })), 'left');
                return;
            }
            const tab = t.closest('.wcl-ftab');
            if (tab) {
                readForm();
                page.querySelector('.wcl-form').dataset.tab = tab.dataset.tab;
                page.querySelectorAll('.wcl-ftab').forEach((x) => x.classList.toggle('is-selected', x === tab));
                if (tab.dataset.tab === 'notes') page.querySelector('.wcl-fnotes').focus();
            }
            return;
        }
        if (layer) return;
        const item = t.closest('[data-i]');
        if (item) {
            const o = shownList[Number(item.dataset.i)];
            if (!o) return;
            // the first tap selects, a tap on the selected one opens it (Agenda opens at once)
            if (view === 'agenda' || isSel(o)) { openSummary(o); return; }
            sel = o;
            selHour = null;
            render();
            return;
        }
        const slot = t.closest('.wcl-hour, .wcl-wcell');
        if (slot) {
            const h = Number(slot.dataset.h);
            const d = slot.dataset.day ? new Date(Number(slot.dataset.day)) : date;
            if (selHour === h && sameDay(d, date) && !sel) {
                const s = new Date(d);
                s.setHours(h, 0, 0, 0);
                openForm(null, s);
                return;
            }
            date = startOfDay(d);
            selHour = h;
            sel = null;
            render();
            return;
        }
        const day = t.closest('.wcl-mcell, .wcl-yday');
        if (day) {
            const d = new Date(Number(day.dataset.day));
            if (sameDay(d, date)) { view = 'day'; sel = null; render(); return; }
            date = d;
            sel = null;
            render();
        }
    }

    function goToDate() {
        ws.messageBox({ title: 'Go to Date', text: 'Date (M/D/YY):', icon: null, input: { value: formDate(date) }, buttons: [{ text: 'ok', value: true }, { text: 'Cancel', value: false }] }).then((v) => {
            if (!v || v === true) return;
            const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v).trim());
            if (!m) return;
            let y = Number(m[3]);
            if (y < 100) y += 2000;
            const d = new Date(y, Number(m[1]) - 1, Number(m[2]));
            if (Number.isNaN(+d)) return;
            date = d;
            sel = null;
            render();
        });
    }

    function nextView() {
        view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];
        selHour = null;
        render();
    }

    function viewMenu() {
        return [
            { label: 'New Appointment', action: () => openForm(null) },
            { label: 'Beam Appointment...', disabled: true },
            { label: 'Delete Appointment', action: deleteSel, disabled: !sel || sel.cal.readonly },
            { label: 'Propose New Time', disabled: true },
            '-',
            { label: 'Go to Today', action: () => { date = startOfDay(new Date()); sel = null; render(); } },
            { label: 'Go to Date', action: goToDate },
            '-',
            { label: 'View', submenu: VIEWS.map((v) => ({ label: VIEW_LABEL[v], radio: view === v, action: () => { view = v; render(); } })) },
            { label: 'Refresh', action: () => reload(true) }
        ];
    }

    function editMenu() {
        const exec = (cmd) => () => { try { document.execCommand(cmd); } catch (_) { /* not here */ } };
        return [
            { label: 'Cut', action: exec('cut') },
            { label: 'Copy', action: exec('copy') },
            { label: 'Paste', action: async () => { try { const t = await navigator.clipboard.readText(); document.execCommand('insertText', false, t); } catch (_) { /* no clipboard */ } } },
            { label: 'Select All', action: exec('selectAll') },
            '-',
            { label: 'Cancel', action: cancelForm }
        ];
    }

    // ---------------------------------------------------------------- the app

    function mount(p) {
        page = p;
        p.classList.add('wm-calendar');
        p.innerHTML = `
            <div class="wcl-main">
                <div class="wcl-head"></div>
                <div class="wcl-body"></div>
            </div>
            <div class="wcl-summary" hidden></div>
            <div class="wcl-form" hidden data-tab="appt">
                <div class="wcl-fbody wm-pv-scroll"></div>
                <textarea class="wcl-fnotes" aria-label="Notes"></textarea>
                <div class="wcl-ftabs"><button type="button" class="wcl-ftab is-selected" data-tab="appt">Appointment</button><button type="button" class="wcl-ftab" data-tab="notes">Notes</button></div>
            </div>`;
        p.addEventListener('click', onTap);
        render();
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: 'Calendar',
            icon: 'app-calendar',
            inStart: 'top',
            sip: true,
            mount,
            show() {
                if (!layer) { /* keep the date the user left, as WM */ }
                render();
                reload(false);
            },
            titleKind: () => (layer ? 'ok' : 'close'),
            onTitleOk() {
                if (layer === 'form') { void commitForm(); return true; }
                return false;
            },
            historyDepth: () => (layer === 'form' ? (fromSummary ? 2 : 1) : layer === 'summary' ? 1 : 0),
            onBack() {
                if (layer === 'form') { cancelForm(); return true; }
                if (layer === 'summary') { layer = null; render(); return true; }
                return false;
            },
            softKeys() {
                if (layer === 'form') return { left: null, right: { label: 'Menu', menu: editMenu } };
                if (layer === 'summary') {
                    return {
                        left: { label: 'Reply', disabled: true },
                        right: { label: 'Menu', menu: () => [
                            { label: 'Reply', disabled: true }, { label: 'Reply All', disabled: true }, '-',
                            { label: 'Edit', action: () => openForm(sel), disabled: !sel || sel.cal.readonly },
                            { label: 'Beam...', disabled: true },
                            { label: 'Delete', action: deleteSel, disabled: !sel || sel.cal.readonly },
                            { label: 'Propose New Time', disabled: true }
                        ] }
                    };
                }
                return { left: { label: VIEW_LABEL[VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]], action: nextView }, right: { label: 'Menu', menu: viewMenu } };
            }
        });
    }

    window.wmCalendar = { reload: () => reload(true), _state: () => ({ view, date, cals, layer }) };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
