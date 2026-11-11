/**
 * Melaton Mobile: Tasks (Windows Mobile 6.1 / 6.5 Professional's Tasks, part of poutlook.exe),
 * Yozora #748.
 *
 * Measured on the Device Emulators (VGA halved; captures in ~/.cache/claude-run/wm65apps/progs/emu61
 * t*.png and emu65 a*.png):
 *   list        the entry bar (a 24 px tint band and a 1 px black rule): the two priority toggles
 *               (17 px cells in a 1 px frame, the one with the focus in a 2 px frame, a pressed one
 *               inverted) and "Tap here to add a new task" (bold, 1 px frame); rows of 17 px: the
 *               15 px check box at x 1, the priority mark at x 19.5, the subject bold from x 34;
 *               an overdue task is red; with "Show start and due dates" a row is 34 px with a
 *               second line and a 1 px #848284 rule under it
 *   soft keys   Complete / Activate (grey with nothing selected; the label stays what it last
 *               was) | Menu: New Task, Beam Task..., Delete Task, Edit > Cut Copy Paste,
 *               Options..., Sort By > Status Priority Subject Start Date Due Date, Filter >
 *               All Tasks, Recently Viewed, No Categories, Active Tasks, Completed Tasks
 *   hold        Create Copy, Delete Task, Beam Task..., High / Normal / Low
 *   a tap       the summary: subject bold, the priority mark and the reminder bell, a chevron
 *               that shows Starts / Due, the notes under a 1 px rule; Edit | Menu (Beam..., Delete)
 *   the form    Subject, Priority, Status, Starts, Due, Occurs, Reminder, Categories,
 *               Sensitivity (labels right-aligned to x 74, values from x 78 on a 1 px #848284
 *               rule, 19.5 px rows), tabs Task | Notes, the month picker over the title bar from
 *               x 34 (170 px wide, "Today:" and "None" rows); ok saves, Menu > Cancel leaves
 *   delete      "Tasks will be permanently deleted. Continue?" Yes / No (No is the default)
 *   Today       "No tasks" / "2 Active tasks" and under it "1 High priority"
 *
 * What it holds: the workspace's tasks, the same ones the desktop's Melaton Calendar lists: the
 * VTODOs of /Workspaces/<workspace>/Calendars/*.ics (subject, start, due, priority, completed,
 * reminder, notes). A change rewrites only that task's VTODO in a fresh copy of the file, so the
 * appointments beside it are never touched. A subscribed calendar's tasks cannot be changed.
 * Occurs, Categories and Sensitivity have no place in that store: the form shows the device's
 * rows with their fixed values. Prints in progress (the generation requests wsClient still waits
 * for) are listed as the read-only category "Printing".
 * Only on phones. Styles: public/css/wm-tasks.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'tasks';
    const REG_KEY = 'HKCU\\Software\\Xyridian\\Melaton\\Windows Calendar';
    const RELOAD_MS = 60000;
    const GEN_TYPES = new Map([['generate_image', 'Print'], ['generate_preset', 'Print'], ['reroll_image', 'Reroll'], ['upscale_image', 'Upscale'],
        ['expand_image', 'Expand'], ['reroll_expanded_image', 'Reroll'], ['enhance_image', 'Enhance'], ['max_enhance_image', 'Enhance'], ['animate_image', 'Animate']]);
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    // the device's Subject drop-down
    const SUBJECT_WORDS = ['Complete', 'Work on', 'Buy', 'Update', 'Create', 'Plan', 'Call', 'Send', 'Schedule', 'Prepare', 'Review'];

    let ws = null;
    let page = null;
    let cals = []; // [{ file: { id, name }, name, readonly, hidden, tasks: [] }]
    let loadedAt = 0;
    let loading = null;
    let loadedFor = null;
    let view = 'list'; // 'list' | 'summary' | 'form' | 'options'
    let sel = null; // uid or 'print:<request id>'
    let lastKey = 'Complete';
    let form = null;
    let fromSummary = false;
    let expanded = false;
    let barPri = 0; // the entry bar's toggle: 0 | 1 (high) | 9 (low)
    let barFocus = 'high';
    let picker = null;
    let printTimer = null;
    let printKey = '';
    const recent = [];

    const esc = (s) => ws.escapeHtml(String(s == null ? '' : s));
    const pad = (n) => String(n).padStart(2, '0');
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const formDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    const shortDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${pad(d.getFullYear() % 100)}`;
    const formTime = (d) => `${(d.getHours() % 12) || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
    const inputTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const newUid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@melaton`;
    const isHigh = (t) => t.priority >= 1 && t.priority <= 4;
    const isLow = (t) => t.priority >= 6;
    const isOverdue = (t) => !t.completed && !!t.due && startOfDay(t.due) < startOfDay(new Date());

    // ---------------------------------------------------------------- settings

    function pref(key, fallback) {
        try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
    }
    function setPref(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
    }
    const options = () => Object.assign({ reminders: true, dates: false, bar: true }, pref('wmTasksOptions', {}));
    const sortBy = () => pref('wmTasksSort', 'priority');
    const filter = () => Object.assign({ show: 'all', status: '' }, pref('wmTasksFilter', {}));

    // ---------------------------------------------------------------- iCalendar (VTODO only)

    const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const icsUnescape = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const icsUtc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

    function parseIcsDate(value) {
        const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value || '').trim());
        if (!m) return null;
        const [, y, mo, d, h, mi, s, z] = m;
        if (h === undefined) return new Date(+y, +mo - 1, +d);
        if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)));
        return new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0));
    }

    function fold(line) {
        const out = [];
        let s = line;
        while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; }
        out.push(s);
        return out.join('\r\n');
    }

    const BLOCK = /BEGIN:VTODO[ \t]*\r?\n[\s\S]*?END:VTODO[ \t]*(?:\r?\n|$)/gi;

    /** One VTODO block to a task; what this program does not know is kept as it stands (extra). */
    function parseTodo(block) {
        const lines = block.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
        const t = { uid: '', summary: '', start: null, due: null, priority: 0, completed: false, completedAt: null, reminderAt: null, description: '', url: '', extra: [] };
        let alarm = null;
        for (const line of lines) {
            if (!line) continue;
            const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
            if (colon < 0) continue;
            const head = line.slice(0, colon);
            const value = line.slice(colon + 1);
            const name = head.split(';')[0].toUpperCase();
            if (name === 'BEGIN' || name === 'END') {
                const what = value.trim().toUpperCase();
                if (what === 'VTODO') continue;
                if (name === 'BEGIN' && what === 'VALARM' && !alarm) { alarm = { lines: [line], at: null }; continue; }
                if (name === 'END' && what === 'VALARM' && alarm) {
                    alarm.lines.push(line);
                    // an absolute trigger is the reminder; any other alarm rides along unchanged
                    if (alarm.at && !t.reminderAt) t.reminderAt = alarm.at; else t.extra.push(...alarm.lines);
                    alarm = null;
                    continue;
                }
            }
            if (alarm) {
                alarm.lines.push(line);
                if (name === 'TRIGGER' && /VALUE=DATE-TIME/i.test(head)) alarm.at = parseIcsDate(value);
                continue;
            }
            switch (name) {
                case 'UID': t.uid = value; break;
                case 'DTSTAMP': break;
                case 'SUMMARY': t.summary = icsUnescape(value); break;
                case 'DESCRIPTION': t.description = icsUnescape(value); break;
                case 'URL': t.url = value; break;
                case 'DTSTART': t.start = parseIcsDate(value); break;
                case 'DUE': t.due = parseIcsDate(value); break;
                case 'PRIORITY': t.priority = parseInt(value, 10) || 0; break;
                case 'STATUS': if (value.trim().toUpperCase() === 'COMPLETED') t.completed = true; else t.extra.push(line); break;
                case 'COMPLETED': { t.completed = true; const d = parseIcsDate(value); if (d) t.completedAt = d.getTime(); break; }
                case 'PERCENT-COMPLETE': if (parseInt(value, 10) >= 100) t.completed = true; break;
                default: t.extra.push(line);
            }
        }
        return t;
    }

    /** A task as the desktop's Calendar writes it (apps/calendar toIcs), its unknown lines after. */
    function todoBlock(t) {
        const L = ['BEGIN:VTODO', `UID:${t.uid}`, `DTSTAMP:${icsUtc(new Date())}`, `SUMMARY:${icsEscape(t.summary)}`];
        if (t.start) L.push(`DTSTART;VALUE=DATE:${icsDate(t.start)}`);
        if (t.due) L.push(`DUE;VALUE=DATE:${icsDate(t.due)}`);
        if (t.priority) L.push(`PRIORITY:${t.priority}`);
        if (t.completed) L.push('STATUS:COMPLETED', 'PERCENT-COMPLETE:100');
        if (t.completed && t.completedAt) L.push(`COMPLETED:${icsUtc(new Date(t.completedAt))}`);
        if (t.description) L.push(`DESCRIPTION:${icsEscape(t.description)}`);
        if (t.url) L.push(`URL:${t.url}`);
        (t.extra || []).forEach((x) => L.push(x));
        if (t.reminderAt) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(t.summary)}`, `TRIGGER;VALUE=DATE-TIME:${icsUtc(t.reminderAt)}`, 'END:VALARM');
        L.push('END:VTODO');
        return `${L.map(fold).join('\r\n')}\r\n`;
    }

    function parseCal(text, file) {
        const flat = String(text || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '');
        const head = flat.split(/\nBEGIN:V(?:EVENT|TODO)/i)[0];
        const prop = (n) => { const m = new RegExp(`^${n}:(.*)$`, 'mi').exec(head); return m ? m[1].trim() : ''; };
        const cal = { file, name: icsUnescape(prop('X-WR-CALNAME')) || String(file.name || 'Calendar').replace(/\.ics$/i, ''), readonly: !!prop('X-MELATON-SOURCE'), hidden: false, tasks: [] };
        (String(text || '').match(BLOCK) || []).forEach((b) => {
            const t = parseTodo(b);
            if (!t.uid) t.uid = newUid();
            t.cal = cal;
            cal.tasks.push(t);
        });
        return cal;
    }

    const uidOf = (block) => { const m = /^UID:(.*)$/mi.exec(block.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '')); return m ? m[1].trim() : ''; };

    /** The file's text with one task put (replaced or added) or removed; everything else as it was. */
    function editText(text, uid, task) {
        let found = false;
        let out = String(text || '').replace(BLOCK, (b) => {
            if (uidOf(b) !== uid) return b;
            if (found) return '';
            found = true;
            return task ? todoBlock(task) : '';
        });
        if (!found && task) {
            const end = out.search(/END:VCALENDAR/i);
            out = end < 0 ? `${out}${todoBlock(task)}` : `${out.slice(0, end)}${todoBlock(task)}${out.slice(end)}`;
        }
        return out;
    }

    function newCalText(name) {
        return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Xyridian//Melaton Calendar for Melaton//EN', 'CALSCALE:GREGORIAN',
            `X-WR-CALNAME:${icsEscape(name)}`, 'X-MELATON-COLOR:#ccffcc', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
    }

    // ---------------------------------------------------------------- files (the workspace's Calendars folder)

    const vfs = () => (typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient) || null; // eslint-disable-line no-undef

    function workspaceId() {
        let w = 'Default';
        try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) w = activeWorkspace; } catch (_) { /* none */ } // eslint-disable-line no-undef
        return w;
    }
    const workspaceRoot = () => `/Workspaces/${workspaceId()}`;
    const folder = () => `${workspaceRoot()}/Calendars`;

    function textB64(t) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(new Blob([t], { type: 'text/calendar' }));
        });
    }

    async function hasFolder() {
        // listing a missing folder raises a server error banner (see wmCalendar.js load): look first
        try {
            const top = await vfs().listDirectory(workspaceRoot(), { offset: 0, limit: 500 });
            return ((top && top.items) || []).some((i) => i && (i.kind === 'folder' || i.targetKind === 'vfs-folder') && String(i.name || '').toLowerCase() === 'calendars');
        } catch (_) { return false; }
    }

    // the four file operations; a test swaps them (window.wmTasks._io) to keep the real files as they are
    const io = {
        async list() {
            if (!vfs()) throw new Error('Files are not available.');
            if (!(await hasFolder())) return [];
            const res = await vfs().listDirectory(folder(), { offset: 0, limit: 200 });
            return ((res && res.items) || []).filter((i) => /\.ics$/i.test(i.name || '') && (i.targetKind === 'user-file' || i.kind === 'file')).map((i) => ({ id: i.id, name: i.name }));
        },
        async read(file) {
            const r = await vfs().downloadFile(file.id);
            return (await fetch(r.downloadUrl, { credentials: 'same-origin', cache: 'no-store' })).text();
        },
        async write(file, text) {
            await vfs().replaceFile(file.id, await textB64(text), 'text/calendar');
        },
        async create(name, text) {
            if (!(await hasFolder())) await vfs().createFolder(workspaceRoot(), 'Calendars');
            const res = await vfs().uploadFile(folder(), await textB64(text), name, 'text/calendar');
            const f = res && (res.file || res.entry || res);
            return { id: (f && (f.id || f.fileId)) || null, name };
        }
    };

    function userName() {
        const a = window.meletonAccounts;
        let n = '';
        try { n = (a && typeof a.displayName === 'function' && a.displayName()) || (a && typeof a.name === 'function' && a.name()) || localStorage.getItem('username') || ''; } catch (_) { n = ''; }
        return n || 'My';
    }

    async function load() {
        const forWs = workspaceId();
        const files = await api._io.list();
        const next = [];
        for (const f of files) {
            try { next.push(parseCal(await api._io.read(f), f)); } catch (err) { console.warn('wmTasks: could not read', f.name, err); }
        }
        let hidden = [];
        try { hidden = JSON.parse(window.melatonRegistry ? window.melatonRegistry.get(REG_KEY, 'Hidden', '[]') : '[]') || []; } catch (_) { hidden = []; }
        next.forEach((c) => { c.hidden = hidden.includes(c.name); });
        cals = next;
        loadedAt = Date.now();
        loadedFor = forWs;
    }

    function changed() {
        try { document.dispatchEvent(new CustomEvent('wmTasksChange')); } catch (_) { /* no events */ }
    }

    function reload(force) {
        if (loading) return loading;
        if (!force && loadedAt && loadedFor === workspaceId() && Date.now() - loadedAt < RELOAD_MS) return Promise.resolve();
        const first = !loadedAt || loadedFor !== workspaceId();
        const shown = () => ws && ws.current === APP_ID;
        const p = load().catch((err) => {
            if (first && shown()) ws.messageBox({ title: 'Tasks', icon: 'error', text: (err && err.message) || 'The tasks could not be opened.' });
            else console.warn('wmTasks: reload failed', err);
        }).finally(() => { loading = null; changed(); if (page && view !== 'form') render(); });
        loading = p;
        if (first && shown()) ws.busy(p, { paint: true, timeout: 30000 });
        return p;
    }

    const allTasks = () => cals.filter((c) => !c.hidden).reduce((a, c) => a.concat(c.tasks), []);
    const taskOf = (uid) => allTasks().find((t) => t.uid === uid) || null;

    /** Put (or with gone, remove) one task in its calendar's file, under the wait cursor. */
    async function store(t, gone) {
        const work = async () => {
            let cal = t.cal;
            if (!cal) {
                cal = cals.find((c) => !c.readonly && !c.hidden) || cals.find((c) => !c.readonly) || null;
                if (!cal) {
                    const name = `${userName()}'s Calendar`;
                    const file = await api._io.create(`${name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.ics`, editText(newCalText(name), t.uid, t));
                    cal = { file, name, readonly: false, hidden: false, tasks: [t] };
                    cals.push(cal);
                    t.cal = cal;
                    return;
                }
            }
            const text = await api._io.read(cal.file);
            await api._io.write(cal.file, editText(text, t.uid, gone ? null : t));
            if (gone) cal.tasks = cal.tasks.filter((x) => x !== t);
            else if (!cal.tasks.includes(t)) cal.tasks.push(t);
            t.cal = cal;
        };
        try {
            await ws.busy(work, { paint: true, timeout: 30000 });
            loadedAt = Date.now();
            // the phone's Calendar holds its own copy of the file: it reads it again
            try { if (window.wmCalendar && typeof window.wmCalendar.reload === 'function') window.wmCalendar.reload(true); } catch (_) { /* not open */ }
            changed();
            return true;
        } catch (err) {
            ws.messageBox({ title: 'Tasks', icon: 'error', text: `The task could not be saved: ${(err && err.message) || err}` });
            reload(true);
            return false;
        }
    }

    function readOnlyNotice(t) {
        ws.messageBox({ title: 'Tasks', icon: 'info', text: `${t.cal.name} is a subscribed calendar and cannot be changed here.` });
    }

    // ---------------------------------------------------------------- prints in progress

    function prints() {
        const c = window.wsClient;
        const out = [];
        if (c && c.pendingRequests && typeof c.pendingRequests.forEach === 'function') {
            c.pendingRequests.forEach((req, id) => {
                if (req && GEN_TYPES.has(req.type)) out.push({ print: true, uid: `print:${id}`, summary: `${GEN_TYPES.get(req.type)} in progress`, start: req.timestamp ? new Date(req.timestamp) : null, due: null, priority: 0, completed: false, description: '' });
            });
        }
        return out;
    }

    // ---------------------------------------------------------------- the list

    function visible() {
        const f = filter();
        let list = f.show === 'printing' ? [] : allTasks();
        if (f.show === 'recent') list = list.filter((t) => recent.includes(t.uid));
        if (f.status === 'active') list = list.filter((t) => !t.completed);
        if (f.status === 'completed') list = list.filter((t) => t.completed);
        const by = sortBy();
        const pri = (t) => (isHigh(t) ? 0 : isLow(t) ? 2 : 1);
        const time = (d) => (d ? startOfDay(d).getTime() : Infinity);
        const name = (a, b) => String(a.summary).localeCompare(String(b.summary), undefined, { sensitivity: 'base' });
        const cmp = {
            status: (a, b) => (a.completed - b.completed) || name(a, b),
            priority: (a, b) => (pri(a) - pri(b)) || name(a, b),
            subject: name,
            start: (a, b) => (time(a.start) - time(b.start)) || name(a, b),
            due: (a, b) => (time(a.due) - time(b.due)) || name(a, b)
        }[by] || name;
        list = list.slice().sort(cmp);
        // prints in progress lead the list: they are what the phone is doing now
        if ((f.show === 'all' || f.show === 'printing') && f.status !== 'completed') list = prints().concat(list);
        return list;
    }

    const current = () => (sel && String(sel).startsWith('print:') ? prints().find((p) => p.uid === sel) : taskOf(sel)) || null;

    function dateLine(t) {
        if (t.print) return t.start ? `Started: ${formTime(t.start)}` : '';
        const parts = [];
        if (t.start) parts.push(`Starts: ${shortDate(t.start)}`);
        if (t.due) parts.push(`Due: ${shortDate(t.due)}`);
        return parts.join('  ');
    }

    function renderList() {
        const o = options();
        const box = page.querySelector('.wtk-rows');
        const list = visible();
        if (sel && !list.some((t) => t.uid === sel)) sel = null;
        page.querySelector('.wtk-bar').hidden = !o.bar;
        box.classList.toggle('has-dates', !!o.dates);
        box.innerHTML = list.map((t) => {
            const cls = ['wtk-row'];
            if (t.uid === sel) cls.push('is-selected');
            if (isOverdue(t)) cls.push('is-overdue');
            if (t.print) cls.push('is-print');
            const mark = isHigh(t) ? 'high' : isLow(t) ? 'low' : '';
            return `<div class="${cls.join(' ')}" data-uid="${esc(t.uid)}" role="option" aria-selected="${t.uid === sel}">`
                + `<span class="wtk-check${t.completed ? ' is-on' : ''}"${t.print ? ' hidden' : ''} role="checkbox" aria-checked="${!!t.completed}" aria-label="Completed"></span>`
                + `<span class="wtk-mark"${mark ? ` data-mark="${mark}"` : ''}></span>`
                + `<span class="wtk-text"><span class="wtk-subject">${esc(t.summary || '(no subject)')}</span>${o.dates ? `<span class="wtk-dates">${esc(dateLine(t))}</span>` : ''}</span></div>`;
        }).join('');
        printKey = prints().map((p) => p.uid).join('|');
    }

    function renderBar() {
        page.querySelectorAll('.wtk-pri button').forEach((b) => {
            const on = (b.dataset.pri === 'high' && barPri === 1) || (b.dataset.pri === 'low' && barPri === 9);
            b.classList.toggle('is-on', on);
            b.classList.toggle('is-focus', b.dataset.pri === barFocus);
            b.setAttribute('aria-pressed', String(on));
        });
    }

    function select(uid) {
        sel = uid;
        const t = current();
        if (t && !t.print) lastKey = t.completed ? 'Activate' : 'Complete';
        page.querySelectorAll('.wtk-row').forEach((r) => {
            const on = r.dataset.uid === sel;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        ws.refreshSoftKeys();
    }

    async function addFromBar() {
        const input = page.querySelector('.wtk-entry');
        const text = input.value.trim();
        if (!text) { input.blur(); return; }
        const t = { uid: newUid(), summary: text, start: null, due: null, priority: barPri, completed: false, completedAt: null, reminderAt: null, description: '', url: '', extra: [], cal: null };
        input.value = '';
        input.blur();
        barPri = 0;
        renderBar();
        if (!(await store(t))) return;
        sel = t.uid;
        lastKey = 'Complete';
        render();
    }

    async function toggleDone(t) {
        if (!t || t.print) return;
        if (t.cal && t.cal.readonly) { readOnlyNotice(t); return; }
        const was = { completed: t.completed, completedAt: t.completedAt };
        t.completed = !t.completed;
        t.completedAt = t.completed ? Date.now() : null;
        if (!(await store(t))) Object.assign(t, was);
        if (t.uid === sel) lastKey = t.completed ? 'Activate' : 'Complete';
        render();
    }

    async function setPriority(t, p) {
        if (!t || t.print) return;
        if (t.cal && t.cal.readonly) { readOnlyNotice(t); return; }
        const was = t.priority;
        t.priority = p;
        if (!(await store(t))) t.priority = was;
        render();
    }

    async function createCopy(t) {
        if (!t || t.print) return;
        const c = Object.assign({}, t, { uid: newUid(), cal: t.cal && !t.cal.readonly ? t.cal : null, extra: (t.extra || []).slice() });
        if (!(await store(c))) return;
        sel = c.uid;
        render();
    }

    async function deleteTask(t) {
        if (!t || t.print) return;
        if (t.cal && t.cal.readonly) { readOnlyNotice(t); return; }
        const yes = await ws.messageBox({ title: 'Tasks', icon: 'warning', text: 'Tasks will be permanently deleted. Continue?', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        if (!(await store(t, true))) return;
        if (sel === t.uid) sel = null;
        view = 'list';
        render();
        ws.syncHistory();
    }

    // ---------------------------------------------------------------- the summary

    function openSummary(uid) {
        sel = uid;
        const t = current();
        if (!t) return;
        if (!t.print) {
            lastKey = t.completed ? 'Activate' : 'Complete';
            const i = recent.indexOf(uid);
            if (i >= 0) recent.splice(i, 1);
            recent.unshift(uid);
        }
        view = 'summary';
        expanded = false;
        render();
        ws.syncHistory();
    }

    function renderSummary() {
        const t = current();
        const box = page.querySelector('.wtk-summary');
        if (!t) { view = 'list'; return; }
        const mark = isHigh(t) ? 'high' : isLow(t) ? 'low' : '';
        const rows = [];
        if (expanded) {
            if (t.print) {
                if (t.start) rows.push(['Started', formTime(t.start)]);
                rows.push(['Category', 'Printing']);
            } else {
                if (t.start) rows.push(['Starts', formDate(t.start)]);
                if (t.due) rows.push(['Due', formDate(t.due)]);
            }
        }
        box.innerHTML = `<div class="wtk-shead${expanded ? ' is-open' : ''}"><div class="wtk-ssubj">${esc(t.summary || '(no subject)')}</div>`
            + `<span class="wtk-sicons">${mark ? `<span class="wtk-mark" data-mark="${mark}"></span>` : ''}${t.reminderAt ? '<span class="wtk-bell"></span>' : ''}</span>`
            + rows.map(([l, v]) => `<div class="wtk-srow"><span>${esc(l)}:</span><span>${esc(v)}</span></div>`).join('')
            + '<button type="button" class="wtk-chev" aria-label="Details"></button></div>'
            + `<div class="wtk-snotes wm-pg-scroll">${esc(t.description || '')}</div>`;
    }

    // ---------------------------------------------------------------- the form

    function openForm(t) {
        if (t && t.print) return;
        if (t && t.cal && t.cal.readonly) { readOnlyNotice(t); return; }
        fromSummary = view === 'summary';
        form = t
            ? { task: t, summary: t.summary, priority: t.priority, completed: t.completed, start: t.start, due: t.due, remind: !!t.reminderAt, reminderAt: t.reminderAt, description: t.description }
            : { task: null, summary: '', priority: 0, completed: false, start: null, due: null, remind: false, reminderAt: null, description: '' };
        view = 'form';
        setTab('task');
        render();
        ws.syncHistory();
        // a new task starts typing in Subject (the tap that opened it gives the focus)
        if (!t) { const s = page.querySelector('.wtk-finput'); if (s) s.focus(); }
    }

    function setTab(tab) {
        const f = page.querySelector('.wtk-form');
        f.dataset.tab = tab;
        f.querySelectorAll('.wm-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    }

    function fieldRow(key, label, value, cls) {
        return `<div class="wtk-field${cls ? ` ${cls}` : ''}" data-key="${key}"><span class="wtk-flabel">${label ? `${esc(label)}:` : ''}</span>${value}</div>`;
    }

    function renderForm() {
        const f = form;
        const val = (k, text) => `<button type="button" class="wtk-fval" data-pick="${k}">${esc(text)}</button>`;
        const fixed = (text) => `<span class="wtk-fval is-static">${esc(text)}</span>`;
        const pri = f.priority >= 1 && f.priority <= 4 ? 'High' : f.priority >= 6 ? 'Low' : 'Normal';
        page.querySelector('.wtk-fbody').innerHTML = [
            fieldRow('subject', 'Subject', `<input type="text" class="wtk-finput" value="${esc(f.summary)}" autocomplete="off" autocapitalize="sentences" aria-label="Subject"><span class="wtk-fdrop" aria-hidden="true"></span>`, 'is-boxed'),
            fieldRow('priority', 'Priority', val('priority', pri)),
            fieldRow('status', 'Status', val('status', f.completed ? 'Completed' : 'Not Completed')),
            fieldRow('starts', 'Starts', val('start', f.start ? formDate(f.start) : 'None')),
            fieldRow('due', 'Due', val('due', f.due ? formDate(f.due) : 'None')),
            fieldRow('occurs', 'Occurs', fixed('Once')),
            fieldRow('reminder', 'Reminder', val('reminder', f.remind ? 'Remind me' : 'None')),
            fieldRow('remwhen', '', f.remind && f.reminderAt
                ? `<span class="wtk-fdt">${val('rem-date', formDate(f.reminderAt))}${val('rem-time', formTime(f.reminderAt))}<input type="time" class="wtk-fnative" value="${inputTime(f.reminderAt)}" tabindex="-1" aria-hidden="true"></span>`
                : fixed('')),
            fieldRow('categories', 'Categories', fixed('No categories...')),
            fieldRow('sensitivity', 'Sensitivity', fixed('Normal'))
        ].join('');
        page.querySelector('.wtk-fnotes').value = f.description;
    }

    function readForm() {
        if (!form) return;
        const s = page.querySelector('.wtk-finput');
        if (s) form.summary = s.value;
        form.description = page.querySelector('.wtk-fnotes').value;
    }

    function defaultReminder(day) {
        const d = startOfDay(day);
        d.setHours(8, 0, 0, 0);
        return d;
    }

    function pick(btn) {
        readForm();
        const f = form;
        const k = btn.dataset.pick;
        const redo = () => renderForm();
        if (k === 'start' || k === 'due') {
            pickDate(btn, f[k], true, (d) => {
                f[k] = d;
                // "Set reminders for new items": a new task's first due date brings its reminder (8:00 AM that day)
                if (k === 'due' && d && !f.task && !f.remind && options().reminders) { f.remind = true; f.reminderAt = defaultReminder(d); }
                redo();
            });
            return;
        }
        if (k === 'rem-date') {
            pickDate(btn, f.reminderAt, false, (d) => { if (d) { d.setHours(f.reminderAt.getHours(), f.reminderAt.getMinutes(), 0, 0); f.reminderAt = d; redo(); } });
            return;
        }
        if (k === 'rem-time') {
            const input = btn.parentElement.querySelector('.wtk-fnative');
            input.onchange = () => {
                const [h, mi] = input.value.split(':').map(Number);
                if (Number.isNaN(h)) return;
                const d = new Date(f.reminderAt);
                d.setHours(h, mi || 0, 0, 0);
                f.reminderAt = d;
                redo();
            };
            try { input.showPicker(); } catch (_) { input.focus(); input.click(); }
            return;
        }
        let items = [];
        if (k === 'priority') items = [['High', 1], ['Normal', 0], ['Low', 9]].map(([l, v]) => ({ label: l, radio: (v === 1 && f.priority >= 1 && f.priority <= 4) || (v === 9 && f.priority >= 6) || (v === 0 && (f.priority === 0 || f.priority === 5)), action: () => { f.priority = v; redo(); } }));
        else if (k === 'status') items = [['Not Completed', false], ['Completed', true]].map(([l, v]) => ({ label: l, radio: f.completed === v, action: () => { f.completed = v; redo(); } }));
        else if (k === 'reminder') {
            items = [['None', false], ['Remind me', true]].map(([l, v]) => ({ label: l, radio: f.remind === v, action: () => {
                f.remind = v;
                if (v && !f.reminderAt) f.reminderAt = defaultReminder(f.due || f.start || new Date());
                redo();
            } }));
        }
        if (items.length) ws.dropdown(btn, items, 'left');
    }

    async function commitForm() {
        readForm();
        const f = form;
        const subject = f.summary.trim();
        // an untouched new task is not kept
        if (!f.task && !subject && !f.due && !f.start && !f.description.trim() && !f.priority && !f.completed) { cancelForm(true); return; }
        const t = f.task || { uid: newUid(), url: '', extra: [], cal: null, completedAt: null };
        const was = Object.assign({}, t);
        t.summary = subject;
        t.priority = f.priority;
        if (t.completed !== f.completed) t.completedAt = f.completed ? Date.now() : null;
        t.completed = f.completed;
        t.start = f.start;
        t.due = f.due;
        t.reminderAt = f.remind ? f.reminderAt : null;
        t.description = f.description;
        if (!(await store(t))) { if (f.task) Object.assign(t, was); return; }
        sel = t.uid;
        lastKey = t.completed ? 'Activate' : 'Complete';
        form = null;
        // the device goes back to the list after an edit, also when it came from the summary
        view = 'list';
        render();
        ws.syncHistory();
    }

    function cancelForm(toList) {
        form = null;
        view = !toList && fromSummary && current() ? 'summary' : 'list';
        render();
        ws.syncHistory();
    }

    // ---------------------------------------------------------------- the month picker

    function closePicker() {
        if (!picker) return;
        document.removeEventListener('pointerdown', picker.away, true);
        picker.el.remove();
        picker = null;
    }

    /** The device's month calendar: over the title bar from x 34; a day, "Today" or "None" picks. */
    function pickDate(anchor, value, withNone, onPick) {
        closePicker();
        const el = document.createElement('div');
        el.className = 'wtk-cal';
        const today = startOfDay(new Date());
        let month = value ? new Date(value.getFullYear(), value.getMonth(), 1) : new Date(today.getFullYear(), today.getMonth(), 1);
        const draw = () => {
            // a month that starts on a Sunday shows the week before it first (the device's month calendar)
            const first = new Date(month.getFullYear(), month.getMonth(), 1 - (month.getDay() || 7));
            let cells = '';
            for (let i = 0; i < 42; i++) {
                const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
                const cls = ['wtk-cal-day'];
                if (d.getMonth() !== month.getMonth()) cls.push('is-other');
                if (+d === +today) cls.push('is-today');
                if (value && +d === +startOfDay(value)) cls.push('is-picked');
                cells += `<button type="button" class="${cls.join(' ')}" data-day="${d.getTime()}">${d.getDate()}</button>`;
            }
            el.innerHTML = `<div class="wtk-cal-head"><button type="button" class="wtk-cal-nav" data-nav="-1" aria-label="Previous month"></button><span>${MONTHS[month.getMonth()]} ${month.getFullYear()}</span><button type="button" class="wtk-cal-nav" data-nav="1" aria-label="Next month"></button></div>`
                + `<div class="wtk-cal-week">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((c) => `<span>${c}</span>`).join('')}</div>`
                + `<div class="wtk-cal-grid">${cells}</div>`
                + `<button type="button" class="wtk-cal-line" data-day="${today.getTime()}">Today: ${shortDate(today)}</button>`
                + (withNone ? '<button type="button" class="wtk-cal-line is-none" data-day="">None</button>' : '');
        };
        draw();
        el.addEventListener('click', (e) => {
            const nav = e.target.closest('[data-nav]');
            if (nav) { month = new Date(month.getFullYear(), month.getMonth() + Number(nav.dataset.nav), 1); draw(); return; }
            const day = e.target.closest('[data-day]');
            if (!day) return;
            const d = day.dataset.day ? new Date(Number(day.dataset.day)) : null;
            closePicker();
            onPick(d);
        });
        const away = (e) => { if (!el.contains(e.target)) { e.preventDefault(); e.stopPropagation(); closePicker(); ws.syncHistory(); } };
        (document.getElementById('wmShell') || document.body).appendChild(el);
        picker = { el, away };
        setTimeout(() => { if (picker && picker.el === el) document.addEventListener('pointerdown', away, true); }, 0);
        ws.syncHistory();
    }

    // ---------------------------------------------------------------- options

    function renderOptions() {
        const o = options();
        const check = (k, label) => `<label class="wm-check"><input type="checkbox" data-opt="${k}"${o[k] ? ' checked' : ''}><span>${label}</span></label>`;
        page.querySelector('.wtk-options').innerHTML = `<div class="wm-form-hdr">Options</div><div class="wtk-opts">${check('reminders', 'Set reminders for new items')}${check('dates', 'Show start and due dates')}${check('bar', 'Show Tasks entry bar')}</div>`;
    }

    // ---------------------------------------------------------------- drawing and input

    function render() {
        if (!page) return;
        if (view === 'summary' && !current()) view = 'list';
        page.dataset.view = view;
        if (view === 'list') { renderList(); renderBar(); } else if (view === 'summary') renderSummary(); else if (view === 'form') renderForm(); else renderOptions();
        ws.refreshTitleAction();
        ws.refreshSoftKeys();
    }

    const entry = () => page.querySelector('.wtk-entry');
    const barActive = () => view === 'list' && document.activeElement === entry();

    async function editCmd(cmd, input) {
        if (!input) return;
        const a = input.selectionStart;
        const b = input.selectionEnd;
        const cut = () => { input.setRangeText('', a, b, 'end'); input.dispatchEvent(new Event('input', { bubbles: true })); };
        try {
            if (cmd === 'copy' || cmd === 'cut') { await navigator.clipboard.writeText(input.value.slice(a, b)); if (cmd === 'cut') cut(); } else if (cmd === 'paste') { const text = await navigator.clipboard.readText(); input.setRangeText(text, a, b, 'end'); } else if (cmd === 'clear') cut(); else if (cmd === 'all') input.select();
        } catch (_) { /* no clipboard here */ }
        input.focus();
    }

    function listMenu() {
        const t = current();
        const f = filter();
        const by = sortBy();
        const input = barActive.last;
        const hasSel = !!(input && input.selectionEnd > input.selectionStart);
        const setFilter = (patch) => { setPref('wmTasksFilter', Object.assign(filter(), patch)); render(); };
        return [
            { label: 'New Task', action: () => openForm(null) },
            // no infrared port to beam to
            { label: 'Beam Task...', disabled: true },
            { label: 'Delete Task', disabled: !t || !!t.print, action: () => deleteTask(t) },
            '-',
            { label: 'Edit', submenu: [
                { label: 'Cut', disabled: !hasSel, action: () => editCmd('cut', input) },
                { label: 'Copy', disabled: !hasSel, action: () => editCmd('copy', input) },
                { label: 'Paste', disabled: !input, action: () => editCmd('paste', input) }
            ] },
            { label: 'Options...', action: () => { view = 'options'; render(); ws.syncHistory(); } },
            { label: 'Sort By', submenu: [['status', 'Status'], ['priority', 'Priority'], ['subject', 'Subject'], ['start', 'Start Date'], ['due', 'Due Date']].map(([v, l]) => ({ label: l, radio: by === v, action: () => { setPref('wmTasksSort', v); render(); } })) },
            { label: 'Filter', submenu: [
                { label: 'All Tasks', checked: f.show === 'all', action: () => setFilter({ show: 'all' }) },
                { label: 'Recently Viewed', checked: f.show === 'recent', action: () => setFilter({ show: 'recent' }) },
                { label: 'No Categories', checked: f.show === 'none', action: () => setFilter({ show: 'none' }) },
                { label: 'Printing', checked: f.show === 'printing', action: () => setFilter({ show: 'printing' }) },
                '-',
                { label: 'Active Tasks', checked: f.status === 'active', action: () => setFilter({ status: f.status === 'active' ? '' : 'active' }) },
                { label: 'Completed Tasks', checked: f.status === 'completed', action: () => setFilter({ status: f.status === 'completed' ? '' : 'completed' }) }
            ] }
        ];
    }

    function formMenu() {
        const notes = page.querySelector('.wtk-form').dataset.tab === 'notes';
        const input = notes ? page.querySelector('.wtk-fnotes') : page.querySelector('.wtk-finput');
        const focused = formMenu.last === input ? input : null;
        const hasSel = !!(focused && focused.selectionEnd > focused.selectionStart);
        const undo = (cmd) => { if (focused) { focused.focus(); try { document.execCommand(cmd); } catch (_) { /* not supported */ } } };
        return [
            { label: 'Undo', disabled: !focused, action: () => undo('undo') },
            { label: 'Redo', disabled: !focused, action: () => undo('redo') },
            '-',
            { label: 'Cut', disabled: !hasSel, action: () => editCmd('cut', focused) },
            { label: 'Copy', disabled: !hasSel, action: () => editCmd('copy', focused) },
            { label: 'Paste', disabled: !focused, action: () => editCmd('paste', focused) },
            { label: 'Clear', disabled: !hasSel, action: () => editCmd('clear', focused) },
            { label: 'Select All', disabled: !focused || !focused.value, action: () => editCmd('all', focused) },
            '-',
            { label: 'Cancel', action: () => cancelForm(true) }
        ];
    }

    function holdMenu(t, x, y) {
        if (t.print) return;
        const pri = isHigh(t) ? 1 : isLow(t) ? 9 : 0;
        ws.menuAt(x, y, [
            { label: 'Create Copy', action: () => createCopy(t) },
            { label: 'Delete Task', action: () => deleteTask(t) },
            { label: 'Beam Task...', disabled: true },
            '-',
            { label: 'High', checked: pri === 1, action: () => setPriority(t, 1) },
            { label: 'Normal', checked: pri === 0, action: () => setPriority(t, 0) },
            { label: 'Low', checked: pri === 9, action: () => setPriority(t, 9) }
        ]);
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-tasks');
        p.innerHTML = '<div class="wtk-listview">'
            + '<div class="wtk-bar"><span class="wtk-pri"><button type="button" data-pri="high" aria-label="High priority"><i></i></button><button type="button" data-pri="low" aria-label="Low priority"><i></i></button></span>'
            + '<input type="text" class="wtk-entry" placeholder="Tap here to add a new task" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" aria-label="New task"></div>'
            + '<div class="wtk-rows wm-pg-scroll" role="listbox" aria-label="Tasks"></div></div>'
            + '<div class="wtk-summary"></div>'
            + '<div class="wtk-form" data-tab="task"><div class="wtk-fbody wm-pg-scroll"></div><textarea class="wtk-fnotes wm-pg-scroll" aria-label="Notes"></textarea>'
            + '<div class="wm-tabs" role="tablist"><button type="button" class="wm-tab" role="tab" data-tab="task" aria-selected="true">Task</button><button type="button" class="wm-tab" role="tab" data-tab="notes" aria-selected="false">Notes</button></div></div>'
            + '<div class="wtk-options"></div>';

        // which text field had the caret when a soft key took the focus (the Edit commands work on it)
        p.addEventListener('focusout', (e) => {
            if (e.target === entry()) barActive.last = e.target;
            if (e.target.matches && e.target.matches('.wtk-finput, .wtk-fnotes')) formMenu.last = e.target;
        });
        p.addEventListener('focusin', (e) => {
            if (e.target !== entry()) barActive.last = null;
            if (!(e.target.matches && e.target.matches('.wtk-finput, .wtk-fnotes'))) formMenu.last = null;
            if (e.target === entry()) ws.refreshSoftKeys();
        });
        entry().addEventListener('blur', () => setTimeout(() => ws.refreshSoftKeys(), 0));
        entry().addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addFromBar(); }
        });

        // tap-and-hold on a task: its menu at the pen (the row is selected first, as on the device)
        let holdTimer = null;
        let held = false;
        let at = null;
        const rows = p.querySelector('.wtk-rows');
        rows.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.wtk-row');
            held = false;
            clearTimeout(holdTimer);
            if (!row || e.target.closest('.wtk-check')) return;
            at = { x: e.clientX, y: e.clientY };
            holdTimer = setTimeout(() => {
                held = true;
                select(row.dataset.uid);
                const t = current();
                if (t) holdMenu(t, at.x, at.y);
            }, (window.wmShell && window.wmShell.holdMs) || 550); // the shell's hold time (it draws the ring of dots)
        });
        rows.addEventListener('pointermove', (e) => { if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 10) clearTimeout(holdTimer); });
        const cancel = () => clearTimeout(holdTimer);
        rows.addEventListener('pointerup', cancel);
        rows.addEventListener('pointercancel', cancel);
        rows.addEventListener('scroll', cancel, { passive: true });
        rows.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const row = e.target.closest('.wtk-row');
            if (!row || held) return;
            clearTimeout(holdTimer);
            held = true;
            select(row.dataset.uid);
            const t = current();
            if (t) holdMenu(t, e.clientX, e.clientY);
        });

        p.addEventListener('click', (e) => {
            const t = e.target;
            if (view === 'list') {
                const pri = t.closest('.wtk-pri button');
                if (pri) {
                    const v = pri.dataset.pri === 'high' ? 1 : 9;
                    barPri = barPri === v ? 0 : v;
                    barFocus = pri.dataset.pri;
                    renderBar();
                    return;
                }
                const row = t.closest('.wtk-row');
                if (!row) return;
                if (held) { held = false; return; }
                if (t.closest('.wtk-check')) { select(row.dataset.uid); toggleDone(current()); return; }
                openSummary(row.dataset.uid);
                return;
            }
            if (view === 'summary') {
                if (t.closest('.wtk-chev')) { expanded = !expanded; renderSummary(); }
                return;
            }
            if (view === 'form') {
                const tab = t.closest('.wm-tab');
                if (tab) { readForm(); setTab(tab.dataset.tab); return; }
                const p2 = t.closest('[data-pick]');
                if (p2) { pick(p2); return; }
                if (t.closest('.wtk-fdrop')) {
                    const input = page.querySelector('.wtk-finput');
                    ws.dropdown(input, SUBJECT_WORDS.map((w) => ({ label: w, action: () => { input.value = `${w} `; input.focus(); } })), 'left');
                }
                return;
            }
            const opt = t.closest('[data-opt]');
            if (opt) setPref('wmTasksOptions', Object.assign(options(), { [opt.dataset.opt]: opt.checked }));
        });

        // a change made elsewhere (the desktop's Calendar, another phone) arrives as vfs_updated
        let liveTimer = null;
        document.addEventListener('wsMessage', (e) => {
            const d = e.detail || {};
            if (d.type !== 'vfs_updated') return;
            const path = String((d.data && d.data.path) || '');
            if (path && !/\/Calendars(\/|$)/i.test(path)) return;
            clearTimeout(liveTimer);
            liveTimer = setTimeout(() => { if (Date.now() - loadedAt > 1500) reload(true); }, 400);
        });
    }

    function show() {
        if (view !== 'form') render();
        reload(loadedFor !== workspaceId());
        clearInterval(printTimer);
        // a print that starts or ends changes the list
        printTimer = setInterval(() => {
            if (view !== 'list' || !page) return;
            if (prints().map((x) => x.uid).join('|') !== printKey) renderList();
        }, 2000);
    }

    function back() {
        if (picker) { closePicker(); return true; }
        if (view === 'form') { cancelForm(false); return true; }
        if (view === 'summary' || view === 'options') { view = 'list'; render(); return true; }
        return false;
    }

    function softKeys() {
        if (view === 'list') {
            const t = current();
            const ok = !!t && !t.print && !barActive();
            return { left: { label: lastKey, disabled: !ok, action: () => toggleDone(current()) }, right: { label: 'Menu', menu: listMenu } };
        }
        if (view === 'summary') {
            const t = current();
            const fixed = !t || t.print;
            return {
                left: { label: 'Edit', disabled: fixed, action: () => openForm(current()) },
                right: { label: 'Menu', menu: () => [{ label: 'Beam...', disabled: true }, { label: 'Delete', disabled: fixed, action: () => deleteTask(current()) }] }
            };
        }
        if (view === 'form') return { left: null, right: { label: 'Menu', menu: formMenu } };
        return { left: null, right: null };
    }

    // ---------------------------------------------------------------- what Today and Search read

    /** { active, high, overdue, printing, text }: Today's row ("2 Active tasks" and "1 High priority" under it). */
    function summary() {
        if (!loading && (!loadedAt || loadedFor !== workspaceId() || Date.now() - loadedAt > RELOAD_MS * 5)) reload(false);
        const open = loadedFor === workspaceId() ? allTasks().filter((t) => !t.completed) : [];
        const active = open.length;
        const high = open.filter(isHigh).length;
        const overdue = open.filter(isOverdue).length;
        const printing = prints().length;
        const lines = [];
        if (active) lines.push(`${active} Active ${active === 1 ? 'task' : 'tasks'}`);
        if (high) lines.push(`${high} High priority`);
        if (printing) lines.push(`${printing} ${printing === 1 ? 'print' : 'prints'} in progress`);
        return { active, high, overdue, printing, text: lines.length ? lines.join('\n') : 'No tasks' };
    }

    function openApp(uid) {
        if (!ws) return;
        ws.open(APP_ID, { fromStart: true });
        if (uid) reload(false).then(() => { if (taskOf(uid)) openSummary(uid); });
    }

    /** Tasks whose subject or notes hold every word of q (for the Search program). */
    async function search(q) {
        const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
        if (!terms.length) return [];
        await reload(false);
        return allTasks().filter((t) => { const hay = `${t.summary}\n${t.description}`.toLowerCase(); return terms.every((w) => hay.includes(w)); })
            .map((t) => ({ uid: t.uid, title: t.summary || '(no subject)', due: t.due, completed: t.completed, open: () => openApp(t.uid) }));
    }

    const api = { summary, open: openApp, search, reload: () => reload(true), _io: io, _state: () => ({ view, sel, cals, form }) };
    window.wmTasks = api;

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: 'Tasks',
            icon: 'app-tasks',
            inStart: 'programs',
            sip: true,
            mount,
            show,
            hide() { clearInterval(printTimer); closePicker(); },
            // the device's title reads "Recent" while the Recently Viewed filter is on
            titleNow: () => (view === 'list' && filter().show === 'recent' ? 'Recent' : 'Tasks'),
            titleKind: () => (view === 'list' ? 'close' : 'ok'),
            onTitleOk() {
                if (picker) closePicker();
                if (view === 'form') { commitForm(); return true; }
                if (view === 'summary' || view === 'options') { view = 'list'; render(); ws.syncHistory(); return true; }
                return false;
            },
            historyDepth: () => (view === 'list' ? 0 : 1) + (picker ? 1 : 0),
            onBack: back,
            onEnd() { view = 'list'; form = null; closePicker(); },
            softKeys
        });
        document.addEventListener('workspaceSwitchComplete', () => { loadedAt = 0; cals = []; sel = null; if (page && ws.current === APP_ID) { view = 'list'; reload(true); } else changed(); });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
