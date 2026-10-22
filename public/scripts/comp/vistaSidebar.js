/**
 * Windows Sidebar (Yozora #486): Vista's docked gadget pane on the desktop, admin only.
 *
 * State lives per workspace on the server (modules/ws/handlers/290-sidebarHandler.js):
 *   sidebar_get / sidebar_save        { enabled, closed, side, onTop, gadgets[] }
 *   sidebar_updated (push)            another admin tab saved the same workspace
 *   sidebar_random_image              Slide Show and Picture Puzzle (workspace images or favorites)
 *   sidebar_weather                   Weather from the client IP, like dynamic generation
 *   sidebar_host_metrics              CPU Meter, the same host figures as Periscope
 *   sidebar_fx                        Currency (ECB rates)
 *   sidebar_quotes                    Stocks
 *   sidebar_feed                      Feed Headlines (https feeds only)
 * Mail and Sidebar Outlook read Dovecote (dovecote_list_mail / dovecote_list_mailboxes).
 * Calculator, Desktop Calculator, Timer, HTC Hero Clock, Clipboard, and Contacts are client-only.
 *
 * Layers: #vistaSidebar holds the pane and every desktop gadget; each is position: fixed with
 * its own z-index (public/css/vista-sidebar.css), so the pane and "Always on Top" gadgets can
 * sit above windows while the rest stay under them. The planet switcher
 * (public/scripts/comp/planetSwitcher.js) drops them under windows, scales them with the
 * desktop, and slides them right as they fade out.
 */

const VSB_ASSETS = '/static_images/vista-sidebar/';
const VSB_SAVE_DELAY_MS = 600;
const VSB_DOCK_GAP = 10;
const VSB_DRAG_THRESHOLD = 4;
const VSB_DEFAULT_GADGETS = ['clock', 'slideshow', 'mail'];
const VSB_IMAGE_SOURCES = [['images', 'All images'], ['pinned', 'Favorites only']];
const VSB_WEATHER_PLACE_ALTS = [['none', 'Nothing'], ['hilo', 'High / Low'], ['rain', 'Chance of rain'], ['condition', 'Condition name'], ['uv', 'UV index (today\'s peak)']];
const VSB_SLIDE_SHAPES = [['landscape', 'Landscape'], ['square', 'Square'], ['portrait', 'Portrait']];
const VSB_SLIDE_SCALE_MIN = 1;
const VSB_SLIDE_SCALE_MAX = 2.5;

const vsb = {
    root: null,
    pane: null,
    dock: null,
    prevBtn: null,
    nextBtn: null,
    trayIcon: null,
    started: false,
    workspaceId: null,
    state: null,
    saved: false,
    instances: new Map(),
    page: 0,
    pages: 1,
    saveTimer: null,
    saveWorkspaceId: null,
    loadSeq: 0,
    drag: null,
    flyout: null
};

// ---------------------------------------------------------------- helpers

const vsbEl = function (tag, className, parent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (parent) parent.appendChild(el);
    return el;
};

const vsbImg = function (src, className, parent) {
    const img = vsbEl('img', className, parent);
    img.alt = '';
    img.draggable = false;
    if (src) img.src = VSB_ASSETS + src;
    return img;
};

const vsbButton = function (className, title, parent) {
    const btn = vsbEl('button', className, parent);
    btn.type = 'button';
    if (title) btn.title = title;
    return btn;
};

const vsbOptions = function (pairs, current) {
    return pairs.map(([value, label]) => `<option value="${escapeHtmlAttribute(String(value))}"${String(value) === String(current) ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
};

const vsbNewId = function () {
    return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
};

const vsbPad2 = (n) => String(n).padStart(2, '0');

const vsbWorkspaceImageUrl = function (item) {
    // resolveGalleryPreviewUrl: public/scripts/comp/assetUrlResolver.js
    return item && item.base ? resolveGalleryPreviewUrl({ base: item.base }) : '';
};

const vsbFetchImage = async function (source, offset, search) {
    // sidebar_random_image: modules/ws/handlers/290-sidebarHandler.js
    const data = await wsClient.sendMessage('sidebar_random_image', {
        workspaceId: vsb.workspaceId,
        source,
        offset: Number.isInteger(offset) ? offset : undefined,
        search: search || undefined
    }, false);
    return data || { total: 0, item: null };
};

const vsbLoadImage = function (url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
};

// ---------------------------------------------------------------- gadget definitions

const VSB_GADGETS = {
    calendar: { title: 'Calendar', icon: 'calendar/icon.png', desc: 'Browse the days of the calendar.', author: 'Xyridian Corporation' },
    calculator: { title: 'Calculator', icon: 'calculator/icon.png', desc: 'Perform basic arithmetic tasks with this calculator.', author: 'Xyridian Corporation', options: true },
    clipboard: { title: 'Clipboard', icon: 'clipboard/icon.png', desc: 'Keep the text you copy in Dreamscape and paste it back with one click.', author: 'Jan Zeman' },
    clock: { title: 'Clock', icon: 'clock/icon.png', desc: 'Watch the clock in your own time zone or any city in the world.', author: 'Xyridian Corporation', options: true },
    contacts: { title: 'Contacts', icon: 'contacts/icon.png', desc: 'Keep names, e-mail addresses, and phone numbers on the Sidebar.', author: 'Xyridian Corporation', options: true },
    cpu: { title: 'CPU Meter', icon: 'cpu/icon.png', desc: 'See the server\'s current CPU and system memory (RAM), the same figures as Periscope.', author: 'Xyridian Corporation' },
    currency: { title: 'Currency', icon: 'currency/icon.png', desc: 'Convert an amount from one currency to another.', author: 'Xyridian Corporation' },
    deskcalc: { title: 'Desktop Calculator', icon: 'deskcalc/icon.png', desc: 'A calculator for the Sidebar. Undock it for scientific keys.', author: 'Home Cooked Gadgets', options: true },
    feed: { title: 'Feed Headlines', icon: 'feed/icon.png', desc: 'See headlines from a web feed. Click a headline to open it.', author: 'Xyridian Corporation', options: true },
    hero: { title: 'HTC Hero Clock', icon: 'hero/icon.png', desc: 'Nine clock faces based on the HTC Hero.', author: 'Marc22', options: true },
    mail: { title: 'Mail', iconUrl: '/static_images/app_icons/vista-mail.webp', desc: 'See your latest Dovecote Inbox messages and how many are unread. Click a message to read it.', author: 'Dreamscape', options: true },
    outlook: { title: 'Sidebar Outlook', icon: 'outlook/icon.png', desc: 'Watch your Dovecote Inbox from the desktop. Click a message to read it.', author: 'Edward J. Boelzner', options: true },
    notes: { title: 'Notes', icon: 'notes/icon.png', desc: 'Capture ideas, notes, and reminders in a quick and easy way.', author: 'Xyridian Corporation', options: true },
    puzzle: { title: 'Picture Puzzle', icon: 'puzzle/icon.png', desc: 'Move the pieces of the puzzle and try to put them in order. The picture comes from this workspace.', author: 'Xyridian Corporation', options: true },
    slideshow: { title: 'Slide Show', icon: 'slideshow/icon.png', desc: 'Show a continuous slide show of the pictures in this workspace.', author: 'Xyridian Corporation', options: true },
    stocks: { title: 'Stocks', icon: 'stocks/icon.png', desc: 'Watch the latest price of the symbols you choose.', author: 'Xyridian Corporation', options: true },
    timer: { title: 'Timer', icon: 'timer/icon.png', desc: 'Use this countdown timer to time almost anything.', author: 'Xyridian Corporation' },
    weather: { title: 'Weather', icon: 'weather/icon.png', desc: 'See what the weather looks like where you are.', author: 'Xyridian Corporation', options: true }
};

const vsbGadgetIconUrl = (type) => VSB_GADGETS[type].iconUrl || VSB_ASSETS + VSB_GADGETS[type].icon;

// ---------------------------------------------------------------- clock

// [face, highlights, font, color, size pt, name top, name left, name width, hand w, hand h, hand top, hand left]
const VSB_CLOCK_THEMES = [
    ['trad', 'trad', 'Constantia, "Segoe UI", sans-serif', '#2F2E2E', 10, -3, -1, 66, 13, 129, -1, 57],
    ['system', 'system', '"Arial Narrow", "Segoe UI", sans-serif', '#666666', 10, 3, 1, 72, 13, 129, 0, 58],
    ['cronometer', 'cronometer', '"Arial Narrow", "Segoe UI", sans-serif', '#FF0000', 10, 6, 0, 70, 13, 129, -1, 57],
    ['diner', null, '"Segoe Script", "Segoe UI", sans-serif', '#D3D9E3', 9, 0, 0, 56, 13, 129, -1, 58],
    ['flower', null, '"Arial Rounded MT Bold", "Segoe UI", sans-serif', '#FE8E08', 9, 2, 2, 71, 13, 129, 0, 59],
    ['modern', null, '"Arial Narrow", "Segoe UI", sans-serif', '#FFFFFF', 10, 3, 0, 74, 13, 129, -1, 58],
    ['square', 'square', 'Calibri, "Segoe UI", sans-serif', '#000000', 9, 0, 0, 70, 13, 129, -1, 57],
    ['novelty', null, 'Calibri, "Segoe UI", sans-serif', '#6dadff', 10, 18, 0, 60, 7, 81, 46, 59]
];

const VSB_HERO_THEMES = ['blue1', 'blue2', 'blue3', 'newv1', 'newv2', 'wmc', 'live', 'wmp', 'cd'].map((name) => (
    [name, null, '"Segoe UI", sans-serif', '#ffffff', 9, -8, 0, 100, 13, 129, 0, 58]
));

const vsbClockPack = (inst) => (inst.g.type === 'hero'
    ? { themes: VSB_HERO_THEMES, asset: 'hero/' }
    : { themes: VSB_CLOCK_THEMES, asset: 'clock/' });

let vsbTimeZoneList = null;

const vsbTimeZones = function () {
    if (vsbTimeZoneList) return vsbTimeZoneList;
    const now = new Date();
    const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC']).map((zone) => {
        const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
            .formatToParts(now).find((p) => p.type === 'timeZoneName');
        const label = part ? part.value : 'GMT';
        const m = /GMT([+-])(\d{2}):(\d{2})/.exec(label);
        const minutes = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
        return { zone, minutes, label: `(${m ? label : 'GMT'}) ${zone.replace(/_/g, ' ')}` };
    });
    zones.sort((a, b) => a.minutes - b.minutes || a.zone.localeCompare(b.zone));
    vsbTimeZoneList = zones;
    return zones;
};

// One formatter per zone: building an Intl.DateTimeFormat on every clock tick cost up to ~56 ms
const vsbZoneFormats = new Map();
const vsbZoneTime = function (zone) {
    const now = new Date();
    if (!zone) return { h: now.getHours(), m: now.getMinutes(), s: now.getSeconds() };
    let format = vsbZoneFormats.get(zone);
    if (!format) {
        format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
        vsbZoneFormats.set(zone, format);
    }
    const parts = format.formatToParts(now);
    const get = (type) => Number((parts.find((p) => p.type === type) || {}).value || 0);
    return { h: get('hour'), m: get('minute'), s: get('second') };
};

const vsbClockMount = function (inst) {
    const face = vsbEl('div', 'vsb-clock', inst.body);
    inst.parts = {
        face,
        highlights: vsbImg(null, 'vsb-clock-highlights', face),
        name: vsbEl('div', 'vsb-clock-name', face),
        h: vsbImg(null, 'vsb-clock-hand', face),
        m: vsbImg(null, 'vsb-clock-hand', face),
        s: vsbImg(null, 'vsb-clock-hand', face),
        dot: vsbImg(null, 'vsb-clock-hand', face)
    };
    vsbClockApply(inst);
};

const vsbClockApply = function (inst) {
    const set = inst.g.settings;
    const pack = vsbClockPack(inst);
    const t = pack.themes[set.theme] || pack.themes[0];
    const p = inst.parts;
    p.face.style.backgroundImage = `url(${VSB_ASSETS}${pack.asset}${t[0]}.png)`;
    p.highlights.src = t[1] ? `${VSB_ASSETS}${pack.asset}${t[1]}_highlights.png` : `${VSB_ASSETS}clock/spacer_highlights.png`;
    p.highlights.classList.toggle('hidden', !t[1]);
    ['h', 'm', 's', 'dot'].forEach((k) => {
        p[k].src = `${VSB_ASSETS}${pack.asset}${t[0]}_${k}.png`;
        Object.assign(p[k].style, { width: t[8] + 'px', height: t[9] + 'px', top: t[10] + 'px', left: t[11] + 'px' });
    });
    p.s.classList.toggle('hidden', !set.seconds);
    p.name.textContent = set.name;
    p.name.classList.toggle('hidden', !set.name);
    Object.assign(p.name.style, {
        fontFamily: t[2], color: t[3], fontSize: t[4] + 'pt', top: (83 + t[5]) + 'px', left: t[6] + 'px', padding: `0 ${(130 - t[7]) / 2}px`
    });
    vsbClockTick(inst);
};

const vsbClockTick = function (inst) {
    clearTimeout(inst.timer);
    const set = inst.g.settings;
    const { h, m, s } = vsbZoneTime(set.timeZone);
    const p = inst.parts;
    p.h.style.transform = `rotate(${(h % 12) * 30 + m / 2}deg)`;
    p.m.style.transform = `rotate(${m * 6 + s / 10}deg)`;
    p.s.style.transform = `rotate(${s * 6}deg)`;
    // Changes once a minute; an identical write every second still wakes every MutationObserver
    const title = `${set.name ? set.name + ' - ' : ''}${vsbPad2(h % 12 || 12)}:${vsbPad2(m)} ${h < 12 ? 'AM' : 'PM'}`;
    if (p.face.title !== title) p.face.title = title;
    const wait = set.seconds ? 1000 - (Date.now() % 1000) : (60 - s) * 1000;
    inst.timer = setTimeout(() => vsbClockTick(inst), wait);
};

const vsbClockOptions = {
    html(set) {
        const zones = [['', 'Current computer time']].concat(vsbTimeZones().map((z) => [z.zone, z.label]));
        return `<div class="vsb-options vsb-clock-options">
            <div class="vsb-options-preview">
                <span class="vsb-options-arrow" data-vsb-step="-1" title="Previous"></span>
                <div class="vsb-options-preview-image" id="vsbClockPreview"></div>
                <span class="vsb-options-arrow vsb-options-arrow-next" data-vsb-step="1" title="Next"></span>
            </div>
            <div class="vsb-options-count" id="vsbClockThemeCount"></div>
            <div class="group"><label for="vsbClockName">Clock name:</label>
                <input type="text" id="vsbClockName" maxlength="30" value="${escapeHtmlAttribute(set.name)}"></div>
            <div class="group"><label for="vsbClockZone">Time zone:</label>
                <select id="vsbClockZone">${vsbOptions(zones, set.timeZone)}</select></div>
            <div><input type="checkbox" id="vsbClockSeconds"${set.seconds ? ' checked' : ''}><label for="vsbClockSeconds">Show the second hand</label></div>
        </div>`;
    },
    ready(dialog, set, inst) {
        const pack = vsbClockPack(inst);
        const theme = Math.max(0, Math.min(set.theme, pack.themes.length - 1));
        vsbStepperReady(dialog, theme, pack.themes.length, '#vsbClockPreview', '#vsbClockThemeCount',
            (i) => `url(${VSB_ASSETS}${pack.asset}${pack.themes[i][0]}_settings.png)`);
    },
    read(dialog, set) {
        return {
            ...set,
            theme: Number(dialog.querySelector('#vsbClockPreview').dataset.index),
            name: dialog.querySelector('#vsbClockName').value.trim(),
            timeZone: dialog.querySelector('#vsbClockZone').value,
            seconds: dialog.querySelector('#vsbClockSeconds').checked
        };
    }
};

/** The "< picture >  n of N" chooser the Clock and Notes options share. */
const vsbStepperReady = function (dialog, start, count, previewSel, countSel, bgFor) {
    const preview = dialog.querySelector(previewSel);
    const counter = dialog.querySelector(countSel);
    const show = (i) => {
        preview.dataset.index = String(i);
        preview.style.backgroundImage = bgFor(i);
        counter.textContent = `${i + 1} of ${count}`;
        dialog.querySelectorAll('[data-vsb-step]').forEach((btn) => {
            btn.classList.toggle('is-disabled', (btn.dataset.vsbStep === '-1' && i === 0) || (btn.dataset.vsbStep === '1' && i === count - 1));
        });
    };
    dialog.querySelectorAll('[data-vsb-step]').forEach((btn) => {
        btn.addEventListener('click', () => show(Math.min(count - 1, Math.max(0, Number(preview.dataset.index) + Number(btn.dataset.vsbStep)))));
    });
    show(start);
};

// ---------------------------------------------------------------- calendar

const VSB_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const VSB_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const vsbSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const vsbCalendarMount = function (inst) {
    const cal = vsbEl('div', 'vsb-cal', inst.body);
    inst.shown = new Date();
    inst.parts = { cal };
    cal.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-vsb-cal]');
        if (!btn) return;
        const act = btn.dataset.vsbCal;
        const d = inst.shown;
        if (act === 'prev-month' || act === 'next-month') {
            inst.shown = new Date(d.getFullYear(), d.getMonth() + (act === 'next-month' ? 1 : -1), 1);
        } else if (act === 'prev-day' || act === 'next-day') {
            inst.shown = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (act === 'next-day' ? 1 : -1));
        } else if (act === 'today') {
            inst.shown = new Date();
        } else if (act === 'date') {
            inst.shown = new Date(d.getFullYear(), d.getMonth(), Number(btn.dataset.day));
            if (inst.g.docked) vsbSetSettings(inst, { view: 'day' });
        } else if (act === 'toggle' && inst.g.docked) {
            vsbSetSettings(inst, { view: inst.g.settings.view === 'day' ? 'month' : 'day' });
            return;
        }
        vsbCalendarRender(inst);
    });
    vsbCalendarApply(inst);
};

const vsbCalendarApply = function (inst) {
    vsbCalendarRender(inst);
    clearTimeout(inst.timer);
    const tick = () => {
        const now = new Date();
        if (!vsbSameDay(now, inst.today || now)) {
            if (vsbSameDay(inst.shown, inst.today)) inst.shown = now;
            vsbCalendarRender(inst);
        }
        inst.timer = setTimeout(tick, 60000);
    };
    inst.timer = setTimeout(tick, 60000);
};

const vsbCalendarDayHtml = function (d, isToday) {
    return `<div class="vsb-cal-page vsb-cal-day${isToday ? ' is-today' : ''}" data-vsb-cal="toggle">
        <button type="button" class="vsb-cal-arrow vsb-cal-prev" data-vsb-cal="prev-day" title="Previous day"></button>
        <button type="button" class="vsb-cal-arrow vsb-cal-next" data-vsb-cal="next-day" title="Next day"></button>
        <div class="vsb-cal-day-month">${VSB_MONTHS[d.getMonth()]} ${d.getFullYear()}</div>
        <div class="vsb-cal-day-number">${d.getDate()}</div>
        <div class="vsb-cal-day-weekday">${VSB_DAYS[d.getDay()]}</div>
        ${isToday ? '' : '<button type="button" class="vsb-cal-curl" data-vsb-cal="today" title="Today"></button>'}
    </div>`;
};

const vsbCalendarMonthHtml = function (d, today) {
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    let cells = VSB_DAYS.map((name) => `<span class="vsb-cal-wd">${name[0]}</span>`).join('');
    for (let i = 0; i < 42; i++) {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const inMonth = day.getMonth() === d.getMonth();
        const cls = ['vsb-cal-date'];
        if (!inMonth) cls.push('is-other');
        if (vsbSameDay(day, today)) cls.push('is-today');
        if (inMonth && vsbSameDay(day, d)) cls.push('is-shown');
        cells += inMonth
            ? `<button type="button" class="${cls.join(' ')}" data-vsb-cal="date" data-day="${day.getDate()}">${day.getDate()}</button>`
            : `<span class="${cls.join(' ')}">${day.getDate()}</span>`;
    }
    return `<div class="vsb-cal-page vsb-cal-month">
        <div class="vsb-cal-month-head">
            <button type="button" class="vsb-cal-arrow vsb-cal-prev" data-vsb-cal="prev-month" title="Previous month"></button>
            <span>${VSB_MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}</span>
            <button type="button" class="vsb-cal-arrow vsb-cal-next" data-vsb-cal="next-month" title="Next month"></button>
        </div>
        <div class="vsb-cal-grid">${cells}</div>
    </div>`;
};

const vsbCalendarRender = function (inst) {
    const today = new Date();
    inst.today = today;
    const d = inst.shown;
    const isToday = vsbSameDay(d, today);
    const cal = inst.parts.cal;
    cal.dataset.today = isToday ? '1' : '0';
    if (inst.g.docked) {
        const view = inst.g.settings.view;
        cal.dataset.view = view;
        cal.innerHTML = view === 'month' ? vsbCalendarMonthHtml(d, today) : vsbCalendarDayHtml(d, isToday);
    } else {
        cal.dataset.view = 'both';
        cal.innerHTML = vsbCalendarMonthHtml(d, today) + vsbCalendarDayHtml(d, isToday);
    }
};

// ---------------------------------------------------------------- CPU meter

const vsbCpuMount = function (inst) {
    const cpu = vsbEl('div', 'vsb-cpu', inst.body);
    inst.parts = {
        cpu,
        cpuDial: vsbImg(null, 'vsb-cpu-dial vsb-cpu-dial-cpu', cpu),
        ramDial: vsbImg(null, 'vsb-cpu-dial vsb-cpu-dial-ram', cpu),
        dot: vsbImg(null, 'vsb-cpu-dot', cpu),
        glass: vsbImg(null, 'vsb-cpu-glass', cpu),
        cpuText: vsbEl('div', 'vsb-cpu-text vsb-cpu-text-cpu', cpu),
        ramText: vsbEl('div', 'vsb-cpu-text vsb-cpu-text-ram', cpu)
    };
    inst.metrics = { cpu: 0, ram: 0 };
    vsbCpuApply(inst);
    vsbCpuPoll(inst);
};

const vsbCpuApply = function (inst) {
    const p = inst.parts;
    const lrg = inst.g.docked ? '' : '_lrg';
    p.cpuDial.src = `${VSB_ASSETS}cpu/dial${lrg}.png`;
    p.ramDial.src = `${VSB_ASSETS}cpu/dial${inst.g.docked ? '_sml' : '_lrg_sml'}.png`;
    p.dot.src = `${VSB_ASSETS}cpu/dialdot${lrg}.png`;
    p.glass.src = `${VSB_ASSETS}cpu/glass${lrg}.png`;
    p.cpu.style.backgroundImage = `url(${VSB_ASSETS}cpu/back${lrg}.png)`;
    vsbCpuPaint(inst);
};

const vsbCpuPaint = function (inst) {
    const p = inst.parts;
    const { cpu, ram } = inst.metrics;
    p.cpuDial.style.transform = `rotate(${cpu * 2.5 - 125}deg)`;
    p.ramDial.style.transform = `rotate(${ram * 2.5 - 125}deg)`;
    p.cpuText.textContent = vsbPad2(Math.round(cpu)) + '%';
    p.ramText.textContent = vsbPad2(Math.round(ram)) + '%';
    p.cpuText.classList.toggle('is-full', Math.round(cpu) >= 100);
    p.ramText.classList.toggle('is-full', Math.round(ram) >= 100);
    p.cpu.title = `CPU usage: ${Math.round(cpu)}%\nMemory usage: ${Math.round(ram)}%`;
};

const vsbCpuPoll = async function (inst) {
    clearTimeout(inst.timer);
    if (inst.destroyed) return;
    if (!document.hidden && vsbIsShown(inst)) {
        try {
            // sidebar_host_metrics: modules/ws/handlers/290-sidebarHandler.js
            const data = await wsClient.sendMessage('sidebar_host_metrics', {}, false);
            if (data) {
                inst.metrics = { cpu: Math.min(100, Math.max(0, Number(data.cpu) || 0)), ram: Math.min(100, Math.max(0, Number(data.ram) || 0)) };
                vsbCpuPaint(inst);
            }
        } catch (_) {
            // keep the last reading
        }
    }
    if (!inst.destroyed) inst.timer = setTimeout(() => vsbCpuPoll(inst), 2000);
};

// ---------------------------------------------------------------- notes

const VSB_NOTE_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'white'];
const VSB_NOTE_FONTS = [
    'Segoe Print', 'Segoe Script', 'Segoe UI', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia', 'Corbel',
    'Arial', 'Tahoma', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS',
    'Noto Sans', 'Atkinson Hyperlegible Next', 'Trebuchet MS',
    'Zen Kurenaido', 'Kaisei Decol', 'Zen Antique', 'Solway', 'Eczar', 'Bodoni Moda', 'Texturina',
    'Space Grotesk', 'Share Tech Mono', 'IBM Plex Mono', 'DotGothic16'
];
/* value is px, label is the point size. Large sizes are only offered while the note is undocked. */
const VSB_NOTE_SIZES = [[8, '6'], [9, '7'], [11, '8'], [12, '9'], [13, '10'], [15, '11'], [16, '12'], [18, '14'], [20, '15'], [22, '16']];
const VSB_NOTE_SIZES_LARGE = [[24, '18'], [27, '20'], [32, '24'], [37, '28'], [48, '36']];
const VSB_NOTE_SIZE_MAX_DOCKED = 22;

const vsbNotesMount = function (inst) {
    const note = vsbEl('div', 'vsb-notes', inst.body);
    const area = vsbEl('textarea', 'vsb-notes-text', note);
    area.spellcheck = false;
    area.maxLength = 1000;
    const bar = vsbEl('div', 'vsb-notes-bar', note);
    const del = vsbButton('vsb-notes-btn vsb-notes-delete', 'Delete', bar);
    const well = vsbEl('div', 'vsb-notes-well', bar);
    const prev = vsbButton('vsb-notes-btn vsb-notes-prev', 'Previous', well);
    const count = vsbEl('span', 'vsb-notes-count', well);
    const next = vsbButton('vsb-notes-btn vsb-notes-next', 'Next', well);
    const add = vsbButton('vsb-notes-btn vsb-notes-add', 'Add', bar);
    inst.parts = { note, area, del, prev, next, add, count };

    const set = () => inst.g.settings;
    area.addEventListener('input', () => {
        if (set().readOnly) return;
        if (set().noteId) {
            inst.notionDirty = true;
            clearTimeout(inst.notionTimer);
            inst.notionTimer = setTimeout(() => vsbNotesSaveLinked(inst), 800);
            return;
        }
        set().notes[set().current] = area.value;
        vsbQueueSave();
    });
    area.addEventListener('blur', () => {
        if (inst.notionDirty) {
            clearTimeout(inst.notionTimer);
            vsbNotesSaveLinked(inst);
        }
    });
    const go = (index) => {
        const s = set();
        s.current = Math.max(0, Math.min(s.notes.length - 1, index));
        vsbNotesPaint(inst);
        vsbQueueSave();
    };
    prev.addEventListener('click', () => go(set().current - 1));
    next.addEventListener('click', () => go(set().current + 1));
    add.addEventListener('click', () => {
        const s = set();
        if (s.notes.length >= 10) return;
        s.notes.push('');
        go(s.notes.length - 1);
        area.focus();
    });
    del.addEventListener('click', async (e) => {
        const s = set();
        if (s.notes[s.current] && s.notes[s.current].trim()) {
            // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
            const ok = await showConfirmationDialog('Are you sure you want to delete this note?', [
                { text: 'Yes', value: true, className: 'btn-standard primary' },
                { text: 'No', value: false, className: 'btn-standard' }
            ], e, { title: 'Notes', icon: 'fas fa-question-circle' });
            if (!ok) return;
        }
        s.notes.splice(s.current, 1);
        if (!s.notes.length) s.notes.push('');
        go(Math.min(s.current, s.notes.length - 1));
    });
    vsbNotesApply(inst);
};

const vsbNotesPx = function (inst) {
    const listed = VSB_NOTE_SIZES.concat(VSB_NOTE_SIZES_LARGE);
    const size = Number(inst.g.settings.size);
    const px = listed.some(([n]) => n === size) ? size : 12;
    if (inst.g.docked) return Math.min(px, VSB_NOTE_SIZE_MAX_DOCKED);
    return px <= VSB_NOTE_SIZE_MAX_DOCKED ? Math.round(px * 1.3) : px;
};

const vsbNotesApply = function (inst) {
    const s = inst.g.settings;
    const p = inst.parts;
    p.note.style.backgroundImage = `url(${VSB_ASSETS}notes/sticky_${s.color}${inst.g.docked ? '_docked' : ''}.png)`;
    p.area.style.fontFamily = `"${s.font}", "Segoe UI", sans-serif`;
    p.area.style.fontSize = vsbNotesPx(inst) + 'px';
    p.area.readOnly = !!s.readOnly;
    p.note.classList.toggle('is-linked', !!s.noteId);
    if (s.noteId) {
        p.area.removeAttribute('maxlength');
        if (inst.linkedId !== s.noteId) {
            inst.linkedId = s.noteId;
            inst.notionDirty = false;
            vsbNotesLoadLinked(inst);
        }
        return;
    }
    inst.linkedId = null;
    p.area.title = s.readOnly ? 'Read only' : '';
    p.area.maxLength = 1000;
    vsbNotesPaint(inst);
};

/** A Notion note (notepadManager.js notebook): read it, unless the gadget has unsaved typing. */
const vsbNotesLoadLinked = async function (inst) {
    const id = inst.g.settings.noteId;
    let note = null;
    try {
        // getNote: public/scripts/websocket.js
        note = (await wsClient.getNote(id) || {}).note || null;
    } catch (_) {
        note = null;
    }
    if (inst.destroyed || inst.g.settings.noteId !== id || inst.notionDirty) return;
    const area = inst.parts.area;
    area.readOnly = !note || !!inst.g.settings.readOnly;
    area.title = note ? `Notion: ${note.name || 'Untitled'}` : '';
    const content = note ? (note.content || '') : 'This Notion note is no longer available.';
    if (area.value !== content) area.value = content;
};

const vsbNotesSaveLinked = async function (inst) {
    const id = inst.g.settings.noteId;
    if (!id || !inst.notionDirty || inst.destroyed) return;
    const content = inst.parts.area.value;
    inst.notionDirty = false;
    try {
        // saveNoteContent: public/scripts/websocket.js
        await wsClient.saveNoteContent(id, content);
    } catch (_) {
        if (inst.parts.area.value === content) inst.notionDirty = true;
    }
};

/** note_content_updated / note_updated / note_deleted from modules/ws/handlers/30-notesHandler.js */
const vsbNotesOnNoteChange = function (msg) {
    const data = msg && (msg.data || msg);
    if (!data || !data.noteId) return;
    vsb.instances.forEach((inst) => {
        if (inst.g.type === 'notes' && inst.g.settings.noteId === data.noteId) vsbNotesLoadLinked(inst);
    });
};

const vsbNotesPaint = function (inst) {
    const s = inst.g.settings;
    const p = inst.parts;
    if (document.activeElement !== p.area || p.area.value !== s.notes[s.current]) p.area.value = s.notes[s.current] || '';
    p.count.textContent = `${s.current + 1}/${s.notes.length}`;
    p.prev.disabled = s.current === 0;
    p.next.disabled = s.current >= s.notes.length - 1;
    p.add.disabled = s.notes.length >= 10;
};

const vsbNotesOptions = {
    html(set, inst) {
        const docked = !inst || inst.g.docked;
        const sizes = docked ? VSB_NOTE_SIZES.slice() : VSB_NOTE_SIZES.concat(VSB_NOTE_SIZES_LARGE);
        const known = VSB_NOTE_SIZES.concat(VSB_NOTE_SIZES_LARGE);
        if (!sizes.some(([px]) => px === Number(set.size))) {
            const hit = known.find(([px]) => px === Number(set.size));
            if (hit) sizes.push(hit);
        }
        return `<div class="vsb-options vsb-notes-options">
            <div class="vsb-options-preview">
                <span class="vsb-options-arrow" data-vsb-step="-1" title="Previous"></span>
                <div class="vsb-options-preview-image vsb-notes-preview" id="vsbNotesPreview"><span class="vsb-notes-font-preview" id="vsbNotesFontPreview">The quick brown fox</span></div>
                <span class="vsb-options-arrow vsb-options-arrow-next" data-vsb-step="1" title="Next"></span>
            </div>
            <div class="vsb-options-count" id="vsbNotesColorCount"></div>
            <div class="group"><label for="vsbNotesFont">Font:</label>
                <select id="vsbNotesFont">${vsbOptions(VSB_NOTE_FONTS.map((f) => [f, f]), set.font)}</select></div>
            <div class="group"><label for="vsbNotesSize">Size:</label>
                <select id="vsbNotesSize">${vsbOptions(sizes, set.size)}</select></div>
            <div><input type="checkbox" id="vsbNotesReadOnly"${set.readOnly ? ' checked' : ''}><label for="vsbNotesReadOnly">Read only</label></div>
            <div class="group"><label for="vsbNotesLink">Show a Notion note:</label>
                <select id="vsbNotesLink"><option value="">None (notes kept in this gadget)</option>${set.noteId ? `<option value="${escapeHtmlAttribute(set.noteId)}" selected>Loading...</option>` : ''}</select></div>
        </div>`;
    },
    ready(dialog, set) {
        vsbStepperReady(dialog, Math.max(0, VSB_NOTE_COLORS.indexOf(set.color)), VSB_NOTE_COLORS.length, '#vsbNotesPreview', '#vsbNotesColorCount',
            (i) => `url(${VSB_ASSETS}notes/sticky_${VSB_NOTE_COLORS[i]}_docked.png)`);
        const preview = dialog.querySelector('#vsbNotesFontPreview');
        const fontSelect = dialog.querySelector('#vsbNotesFont');
        const sizeSelect = dialog.querySelector('#vsbNotesSize');
        const paintFont = () => {
            preview.style.fontFamily = `"${fontSelect.value}", "Segoe UI", sans-serif`;
            preview.style.fontSize = (Number(sizeSelect.value) || 12) + 'px';
        };
        fontSelect.addEventListener('change', paintFont);
        sizeSelect.addEventListener('change', paintFont);
        paintFont();
        const select = dialog.querySelector('#vsbNotesLink');
        // getNotesByWorkspace: public/scripts/websocket.js; novels keep a session, not plain text
        wsClient.getNotesByWorkspace(activeWorkspace).then((res) => {
            const notes = ((res && res.notes) || []).filter((n) => n.note_kind !== 'novel');
            select.innerHTML = vsbOptions([['', 'None (notes kept in this gadget)'], ...notes.map((n) => [n.id, n.name || 'Untitled'])], set.noteId || '');
        }).catch(() => {});
    },
    read(dialog, set) {
        return {
            ...set,
            color: VSB_NOTE_COLORS[Number(dialog.querySelector('#vsbNotesPreview').dataset.index)],
            font: dialog.querySelector('#vsbNotesFont').value,
            size: Number(dialog.querySelector('#vsbNotesSize').value),
            readOnly: dialog.querySelector('#vsbNotesReadOnly').checked,
            noteId: dialog.querySelector('#vsbNotesLink').value
        };
    }
};

// ---------------------------------------------------------------- picture puzzle

const VSB_PUZZLE_TILE = 27;

const vsbPuzzleMount = function (inst) {
    const box = vsbEl('div', 'vsb-puzzle', inst.body);
    const timer = vsbButton('vsb-puzzle-btn vsb-puzzle-timer', 'Pause the timer', box);
    const time = vsbEl('span', 'vsb-puzzle-time', box);
    const hint = vsbButton('vsb-puzzle-btn vsb-puzzle-hint', 'Show picture', box);
    const shuffle = vsbButton('vsb-puzzle-btn vsb-puzzle-shuffle', 'Shuffle the pieces', box);
    const pad = vsbEl('div', 'vsb-puzzle-pad', box);
    const picture = vsbEl('div', 'vsb-puzzle-picture hidden', box);
    const win = vsbEl('div', 'vsb-puzzle-win hidden', box);
    win.textContent = 'Congratulations! You win !!';
    const empty = vsbImg('puzzle/tile_drop_shadow.png', 'vsb-puzzle-empty', pad);
    const tiles = [];
    for (let i = 0; i < 15; i++) {
        const tile = vsbEl('div', 'vsb-puzzle-tile', pad);
        tile.dataset.tile = String(i);
        tile.style.backgroundPosition = `-${(i % 4) * VSB_PUZZLE_TILE}px -${Math.floor(i / 4) * VSB_PUZZLE_TILE}px`;
        vsbImg('puzzle/tile_bezel.png', null, tile);
        tiles.push(tile);
    }
    inst.parts = { box, time, timer, hint, shuffle, pad, picture, win, empty, tiles };
    inst.paused = false;

    pad.addEventListener('click', (e) => {
        const tile = e.target.closest('.vsb-puzzle-tile');
        if (tile) vsbPuzzleMove(inst, Number(tile.dataset.tile));
    });
    shuffle.addEventListener('click', () => vsbPuzzleShuffle(inst));
    timer.addEventListener('click', () => {
        inst.paused = !inst.paused;
        timer.title = inst.paused ? 'Start the timer' : 'Pause the timer';
        vsbPuzzleClock(inst);
    });
    const showHint = (on) => picture.classList.toggle('hidden', !on);
    hint.addEventListener('pointerdown', () => showHint(true));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => hint.addEventListener(ev, () => showHint(false)));
    win.addEventListener('click', () => (box.dataset.empty ? vsbPuzzleNewPicture(inst) : vsbPuzzleShuffle(inst)));
    vsbPuzzleApply(inst);
};

const vsbPuzzleApply = async function (inst) {
    const s = inst.g.settings;
    if (!s.base) {
        await vsbPuzzleNewPicture(inst);
        return;
    }
    if (inst.loadedBase !== s.base) {
        inst.loadedBase = s.base;
        try {
            const img = await vsbLoadImage(vsbWorkspaceImageUrl({ base: s.base }));
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = VSB_PUZZLE_TILE * 4;
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
            const url = `url(${canvas.toDataURL('image/jpeg', 0.9)})`;
            inst.parts.tiles.forEach((t) => { t.style.backgroundImage = url; });
            inst.parts.picture.style.backgroundImage = url;
        } catch (_) {
            inst.loadedBase = null;
        }
    }
    if (!s.tiles) {
        vsbPuzzleShuffle(inst);
        return;
    }
    vsbPuzzlePaint(inst);
    vsbPuzzleClock(inst);
};

const vsbPuzzleNewPicture = async function (inst) {
    try {
        const data = await vsbFetchImage(inst.g.settings.source);
        if (!data.item) {
            inst.parts.box.dataset.empty = '1';
            inst.parts.win.textContent = 'No pictures in this workspace';
            inst.parts.win.classList.remove('hidden');
            return;
        }
        delete inst.parts.box.dataset.empty;
        inst.parts.win.textContent = 'Congratulations! You win !!';
        vsbSetSettings(inst, { base: data.item.base, tiles: null, seconds: 0 });
    } catch (_) {
        // offline: try again with the next apply
    }
};

const vsbPuzzleSolved = (tiles) => tiles.every((v, i) => v === i);

const vsbPuzzleShuffle = function (inst) {
    const tiles = Array.from({ length: 16 }, (_, i) => i);
    let empty = 15;
    let last = -1;
    for (let n = 0; n < 160 || vsbPuzzleSolved(tiles); n++) {
        const r = Math.floor(empty / 4);
        const c = empty % 4;
        const moves = [];
        if (r > 0) moves.push(empty - 4);
        if (r < 3) moves.push(empty + 4);
        if (c > 0) moves.push(empty - 1);
        if (c < 3) moves.push(empty + 1);
        const options = moves.filter((m) => m !== last);
        const pick = options[Math.floor(Math.random() * options.length)];
        [tiles[empty], tiles[pick]] = [tiles[pick], tiles[empty]];
        last = empty;
        empty = pick;
    }
    inst.g.settings.tiles = tiles;
    inst.g.settings.seconds = 0;
    inst.started = false;
    inst.parts.win.classList.add('hidden');
    vsbPuzzlePaint(inst);
    vsbPuzzleClock(inst);
    vsbQueueSave();
};

const vsbPuzzlePaint = function (inst) {
    const tiles = inst.g.settings.tiles;
    const p = inst.parts;
    tiles.forEach((tile, pos) => {
        const left = (pos % 4) * VSB_PUZZLE_TILE + 'px';
        const top = Math.floor(pos / 4) * VSB_PUZZLE_TILE + 'px';
        const el = tile === 15 ? p.empty : p.tiles[tile];
        el.style.left = left;
        el.style.top = top;
    });
    const s = inst.g.settings.seconds;
    p.time.textContent = `${vsbPad2(Math.floor(s / 60))}:${vsbPad2(s % 60)}`;
};

const vsbPuzzleMove = function (inst, tile) {
    const s = inst.g.settings;
    if (!s.tiles || vsbPuzzleSolved(s.tiles)) return;
    const pos = s.tiles.indexOf(tile);
    const empty = s.tiles.indexOf(15);
    const adjacent = (Math.abs(pos - empty) === 4) || (Math.abs(pos - empty) === 1 && Math.floor(pos / 4) === Math.floor(empty / 4));
    if (!adjacent) return;
    [s.tiles[pos], s.tiles[empty]] = [s.tiles[empty], s.tiles[pos]];
    inst.started = true;
    vsbPuzzlePaint(inst);
    if (vsbPuzzleSolved(s.tiles)) inst.parts.win.classList.remove('hidden');
    vsbPuzzleClock(inst);
    vsbQueueSave();
};

const vsbPuzzleClock = function (inst) {
    clearInterval(inst.timer);
    const s = inst.g.settings;
    const running = inst.started && !inst.paused && s.tiles && !vsbPuzzleSolved(s.tiles);
    inst.parts.timer.classList.toggle('is-paused', inst.paused);
    if (!running) return;
    inst.timer = setInterval(() => {
        s.seconds = Math.min(359999, s.seconds + 1);
        vsbPuzzlePaint(inst);
        if (s.seconds % 15 === 0) vsbQueueSave();
    }, 1000);
};

const vsbSourceOptions = {
    html(set) {
        return `<div class="vsb-options">
            <div class="group"><label for="vsbImageSource">Pictures from this workspace:</label>
                <select id="vsbImageSource">${vsbOptions(VSB_IMAGE_SOURCES, set.source)}</select></div>
        </div>`;
    },
    read(dialog, set) {
        const source = dialog.querySelector('#vsbImageSource').value;
        return source === set.source ? set : { ...set, source, base: '', tiles: null, seconds: 0 };
    }
};

// ---------------------------------------------------------------- slide show

const VSB_SLIDE_SECONDS = [[5, '5 seconds'], [10, '10 seconds'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']];
const VSB_SLIDE_TRANSITIONS = [['none', 'None'], ['random', 'Random'], ['fade', 'Fade'], ['wipe', 'Wipe'], ['iris', 'Iris'], ['slide', 'Slide'], ['push', 'Push']];

const vsbSlideMount = function (inst) {
    const frame = vsbEl('div', 'vsb-slide', inst.body);
    const view = vsbEl('div', 'vsb-slide-view', frame);
    const a = vsbImg(null, 'vsb-slide-img', view);
    const b = vsbImg(null, 'vsb-slide-img', view);
    const glass = vsbEl('div', 'vsb-slide-glass', frame);
    const empty = vsbEl('div', 'vsb-slide-empty hidden', frame);
    empty.textContent = 'No pictures';
    const bar = vsbEl('div', 'vsb-slide-bar', frame);
    const prev = vsbButton('vsb-slide-btn vsb-slide-prev', 'Previous', bar);
    const play = vsbButton('vsb-slide-btn vsb-slide-play', 'Pause', bar);
    const next = vsbButton('vsb-slide-btn vsb-slide-next', 'Next', bar);
    const reveal = vsbButton('vsb-slide-btn vsb-slide-reveal', 'View', bar);
    const grip = vsbEl('div', 'vsb-slide-resize', frame);
    inst.parts = { frame, view, layers: [a, b], front: 0, glass, empty, play };
    grip.addEventListener('pointerdown', (e) => vsbSlideResizeStart(e, inst));
    inst.history = [];
    inst.cursor = -1;
    inst.seq = 0;
    inst.paused = false;

    prev.addEventListener('click', () => vsbSlideStep(inst, -1));
    next.addEventListener('click', () => vsbSlideStep(inst, 1));
    play.addEventListener('click', () => {
        inst.paused = !inst.paused;
        play.classList.toggle('is-paused', inst.paused);
        play.title = inst.paused ? 'Play' : 'Pause';
        vsbSlideSchedule(inst);
    });
    reveal.addEventListener('click', () => { vsbSlideOpenGlancewell(inst); });
    view.addEventListener('click', () => vsbSlideFlyout(inst));
    vsbSlideApply(inst);
};

const vsbSlideApply = function (inst) {
    const docked = inst.g.docked;
    const s = inst.g.settings;
    inst.parts.frame.dataset.shape = s.shape || 'landscape';
    inst.parts.frame.style.zoom = docked ? '' : String(s.scale || 1);
    const source = s.search ? JSON.stringify(s.search) : s.source;
    if (inst.appliedSource !== source) {
        inst.appliedSource = source;
        inst.history = [];
        inst.cursor = -1;
        inst.seq = 0;
        vsbSlideStep(inst, 1);
    } else {
        vsbSlideSchedule(inst);
    }
};

/** Undocked frames scale from the bottom-right corner, keeping the frame's shape, within the work area. */
const vsbSlideResizeStart = function (e, inst) {
    if (inst.g.docked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const frame = inst.parts.frame;
    const start = inst.g.settings.scale || 1;
    const rect = frame.getBoundingClientRect();
    const baseW = rect.width / start;
    const baseH = rect.height / start;
    // public/scripts/comp/modalUtils.js
    const area = getModalWorkAreaBounds();
    const max = Math.max(VSB_SLIDE_SCALE_MIN, Math.min(VSB_SLIDE_SCALE_MAX, (area.right - rect.left) / baseW, (area.bottom - rect.top) / baseH));
    const move = (ev) => {
        const grow = Math.max((ev.clientX - e.clientX) / baseW, (ev.clientY - e.clientY) / baseH);
        inst.g.settings.scale = Math.round(Math.min(max, Math.max(VSB_SLIDE_SCALE_MIN, start + grow)) * 100) / 100;
        frame.style.zoom = String(inst.g.settings.scale);
    };
    const end = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', end);
        grip.removeEventListener('pointercancel', end);
        if (inst.g.settings.scale !== start) vsbQueueSave();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
};

/** Match a frame picture against the gallery rows already in memory. */
const vsbGalleryHit = function (names) {
    const lists = [];
    if (Array.isArray(allImages)) lists.push(allImages);
    if (typeof originalAllImages !== 'undefined' && Array.isArray(originalAllImages)) lists.push(originalAllImages);
    for (let i = 0; i < lists.length; i++) {
        const hit = lists[i].find((img) => img && names.some((name) => img.filename === name || img.original === name || img.upscaled === name));
        if (hit) return hit;
    }
    return null;
};

const vsbSlideOpenGlancewell = function (inst) {
    const image = vsbSlideImage(inst);
    if (!image) return;
    const names = [image.upscaled, image.original, image.filename].filter(Boolean);
    const hit = vsbGalleryHit(names);
    // showLightbox: public/scripts/comp/lightbox.js
    if (hit) {
        showLightbox({ filename: hit.filename || hit.upscaled || hit.original });
        return;
    }
    // Workspaces defers its catalog until the window opens (galleryImagesLoad.js),
    // so the frame's picture is often not in allImages yet. Open that file directly.
    // resolveGalleryFullImageUrl: public/scripts/comp/assetUrlResolver.js
    const item = inst.history[inst.cursor];
    const url = resolveGalleryFullImageUrl(item || image);
    if (!url) return;
    showLightbox({
        url,
        width: (item && item.width) || image.width,
        height: (item && item.height) || image.height
    });
};

/** The picture on screen as the gallery's own image object when it is loaded, otherwise built from the frame's item. */
const vsbSlideImage = function (inst) {
    const item = inst.history[inst.cursor];
    const filename = item && (item.upscaled || item.original);
    if (!filename) return null;
    // findImageByFilename: public/scripts/comp/galleryView.js
    return findImageByFilename(filename) || { filename, original: item.original || filename, upscaled: item.upscaled || undefined, base: item.base, width: item.width, height: item.height, metadata: null };
};

const vsbSlideMenu = function (inst) {
    const image = vsbSlideImage(inst);
    const items = [{ text: 'Next Picture', action: 'vsb-slide-next' }, { text: 'Previous Picture', action: 'vsb-slide-prev' }];
    if (!image) return items;
    items.push({ separator: true },
        { text: 'Go to Photo', icon: 'fas fa-images', action: 'vsb-slide-goto' },
        { text: 'Open in Studio', icon: 'fas fa-compass-drafting', action: 'vsb-slide-studio' },
        { text: 'Properties', icon: 'fas fa-glasses-round', action: 'vsb-slide-properties' },
        // checkIfImageIsPinned: public/scripts/comp/galleryView.js (local gallery data only)
        { text: 'Favorite', action: 'vsb-slide-favorite', showIndicator: true, checked: !!checkIfImageIsPinned(image.filename) });
    return items;
};

const vsbSlidePhotoAction = function (inst, action, event) {
    const image = vsbSlideImage(inst);
    if (!image) return;
    const search = inst.g.settings.search;
    switch (action) {
        case 'vsb-slide-goto':
            // jumpToGalleryImage: public/scripts/comp/galleryView.js
            jumpToGalleryImage(image.filename, search && search.workspaceId !== '*' ? search.workspaceId : vsb.workspaceId);
            break;
        case 'vsb-slide-studio':
            // openManualModalWithContent: public/scripts/comp/manualModalManager.js
            openManualModalWithContent({ type: 'image', image, metadata: image.metadata || null }, event);
            break;
        case 'vsb-slide-properties':
            // featureLoader: public/scripts/comp/featureLoader.js; openImagePromptInspector: public/scripts/comp/imagePromptInspector.js
            void featureLoader.loadFeature('image_prompt_inspector').then(() => openImagePromptInspector(image));
            break;
        case 'vsb-slide-favorite':
            // togglePinImage: public/scripts/comp/galleryView.js (pins in the active workspace)
            togglePinImage(image);
            break;
        default: break;
    }
};

/** Image Search's "Show in photo frame" (omegasearchDsapApplet.js): the frame shows that search instead of the workspace pictures. */
const vsbSetFrameSearch = function (gadgetId, search) {
    const inst = vsb.instances.get(gadgetId);
    if (!inst || inst.g.type !== 'slideshow') return false;
    vsbSetSettings(inst, { search });
    return true;
};

const vsbSlideSchedule = function (inst) {
    clearTimeout(inst.timer);
    if (inst.paused || inst.destroyed) return;
    inst.timer = setTimeout(() => {
        if (document.hidden || !vsbIsShown(inst)) vsbSlideSchedule(inst);
        else vsbSlideStep(inst, 1);
    }, inst.g.settings.seconds * 1000);
};

const vsbSlideStep = async function (inst, dir) {
    clearTimeout(inst.timer);
    const s = inst.g.settings;
    let item = null;
    if (dir < 0 && inst.cursor > 0) {
        inst.cursor -= 1;
        item = inst.history[inst.cursor];
    } else if (dir > 0 && inst.cursor < inst.history.length - 1) {
        inst.cursor += 1;
        item = inst.history[inst.cursor];
    } else if (dir > 0) {
        try {
            const data = await vsbFetchImage(s.source, s.shuffle ? undefined : inst.seq, s.search);
            inst.seq += 1;
            item = data.item;
            if (item) {
                inst.history.push(item);
                if (inst.history.length > 30) inst.history.shift();
                inst.cursor = inst.history.length - 1;
            }
        } catch (_) {
            item = null;
        }
    }
    if (inst.destroyed) return;
    inst.parts.empty.classList.toggle('hidden', !!(item || inst.history.length));
    if (item) await vsbSlideShow(inst, item);
    vsbSlideSchedule(inst);
};

const vsbSlideShow = async function (inst, item) {
    const url = vsbWorkspaceImageUrl(item);
    try {
        await vsbLoadImage(url);
    } catch (_) {
        return;
    }
    const p = inst.parts;
    clearTimeout(inst.fxTimer);
    p.layers.forEach((layer, i) => {
        layer.classList.remove('is-leaving');
        layer.classList.toggle('is-front', i === p.front);
        layer.dataset.fx = '';
    });
    const back = p.layers[1 - p.front];
    const front = p.layers[p.front];
    let kind = inst.g.settings.transition;
    if (kind === 'random') kind = ['fade', 'wipe', 'iris', 'slide', 'push'][Math.floor(Math.random() * 5)];
    back.src = url;
    if (kind === 'none' || !front.getAttribute('src')) {
        back.classList.add('is-front');
        front.classList.remove('is-front');
    } else {
        back.dataset.fx = kind + '-in';
        if (kind === 'push') front.dataset.fx = 'push-out';
        back.classList.add('is-front');
        front.classList.add('is-leaving');
        inst.fxTimer = setTimeout(() => {
            front.classList.remove('is-front', 'is-leaving');
            front.dataset.fx = '';
        }, 900);
    }
    p.front = 1 - p.front;
    if (vsb.flyout && vsb.flyout.inst === inst) vsbSlideFlyout(inst, true);
};

/** The larger picture beside the gadget, toward the middle of the screen. */
const vsbSlideFlyout = function (inst, refresh) {
    const item = inst.history[inst.cursor];
    if (vsb.flyout && vsb.flyout.inst === inst && !refresh) {
        vsbCloseFlyout();
        return;
    }
    if (!item) return;
    vsbCloseFlyout();
    const fly = vsbEl('div', 'vsb-flyout', vsb.root);
    const img = vsbEl('img', 'vsb-flyout-img', fly);
    img.alt = '';
    img.draggable = false;
    img.src = vsbWorkspaceImageUrl(item);
    const max = 420;
    const ratio = item.width && item.height ? item.width / item.height : 4 / 3;
    const w = ratio >= 1 ? max : Math.round(max * ratio);
    const h = ratio >= 1 ? Math.round(max / ratio) : max;
    img.style.width = w + 'px';
    img.style.height = h + 'px';
    const rect = inst.el.getBoundingClientRect();
    const fullW = w + 16;
    const fullH = h + 16;
    const toLeft = rect.left + rect.width / 2 > window.innerWidth / 2;
    const left = toLeft ? rect.left - fullW - 4 : rect.right + 4;
    // public/scripts/comp/modalUtils.js
    const area = getModalWorkAreaBounds();
    const top = Math.min(Math.max(area.top + 4, rect.top), area.bottom - fullH - 4);
    fly.style.left = Math.max(4, left) + 'px';
    fly.style.top = Math.max(area.top + 4, top) + 'px';
    fly.addEventListener('click', vsbCloseFlyout);
    vsb.flyout = { el: fly, inst };
};

const vsbCloseFlyout = function () {
    if (!vsb.flyout) return;
    vsb.flyout.el.remove();
    vsb.flyout = null;
};

const vsbSlideOptions = {
    html(set) {
        return `<div class="vsb-options">
            <div class="group"><label for="vsbSlideSource">Pictures from this workspace:</label>
                <select id="vsbSlideSource"${set.search ? ' disabled' : ''}>${vsbOptions(VSB_IMAGE_SOURCES, set.source)}</select></div>
            <div class="group"><label for="vsbSlideSearch">Or pictures from an Image Search:</label>
                <input type="text" id="vsbSlideSearch" readonly placeholder="No search" value="${escapeHtmlAttribute(set.search ? set.search.label || 'Saved search' : '')}">
                <div><button type="button" id="vsbSlideSearchOpen">Image Search...</button>
                <button type="button" id="vsbSlideSearchClear"${set.search ? '' : ' disabled'}>Use workspace pictures</button></div></div>
            <div class="group"><label for="vsbSlideShape">Shape:</label>
                <select id="vsbSlideShape">${vsbOptions(VSB_SLIDE_SHAPES, set.shape || 'landscape')}</select></div>
            <div class="group"><label for="vsbSlideSeconds">Show each picture:</label>
                <select id="vsbSlideSeconds">${vsbOptions(VSB_SLIDE_SECONDS, set.seconds)}</select></div>
            <div class="group"><label for="vsbSlideTransition">Transition between pictures:</label>
                <select id="vsbSlideTransition">${vsbOptions(VSB_SLIDE_TRANSITIONS, set.transition)}</select></div>
            <div><input type="checkbox" id="vsbSlideShuffle"${set.shuffle ? ' checked' : ''}><label for="vsbSlideShuffle">Shuffle pictures</label></div>
        </div>`;
    },
    ready(dialog, set, inst) {
        const field = dialog.querySelector('#vsbSlideSearch');
        const clear = dialog.querySelector('#vsbSlideSearchClear');
        clear.addEventListener('click', () => {
            field.dataset.cleared = '1';
            field.value = '';
            clear.disabled = true;
            dialog.querySelector('#vsbSlideSource').disabled = false;
        });
        dialog.querySelector('#vsbSlideSearchOpen').addEventListener('click', async () => {
            const search = field.dataset.cleared ? null : set.search;
            // the search may replace this frame's pictures, so the dialog applies its choices and closes first
            dialog.querySelector('.btn-standard.primary').click();
            // resolveDsap, loadDsapEntryAssets: public/scripts/comp/dsapRegistry.js (Image Search loads on demand)
            await loadDsapEntryAssets(resolveDsap('dsap://ispy.dreamscape.jp/').entry);
            // openIspyDsap: public/scripts/comp/omegasearchDsapApplet.js
            openIspyDsap(search
                ? { ...search, view: 'gallery', frame: inst.g.id }
                : { workspaceId: vsb.workspaceId, view: 'search', frame: inst.g.id });
        });
    },
    read(dialog, set) {
        return {
            ...set,
            search: dialog.querySelector('#vsbSlideSearch').dataset.cleared ? null : set.search,
            source: dialog.querySelector('#vsbSlideSource').value,
            seconds: Number(dialog.querySelector('#vsbSlideSeconds').value),
            shape: dialog.querySelector('#vsbSlideShape').value,
            transition: dialog.querySelector('#vsbSlideTransition').value,
            shuffle: dialog.querySelector('#vsbSlideShuffle').checked
        };
    }
};

// ---------------------------------------------------------------- weather

// WMO weather code -> [Vista sky state, condition text]
const vsbWeatherState = function (code) {
    if (code <= 1) return ['sun', code === 0 ? 'Clear' : 'Mostly Clear'];
    if (code === 2) return ['partly-cloudy', 'Partly Cloudy'];
    if (code === 3) return ['cloudy', 'Cloudy'];
    if (code === 45 || code === 48) return ['foggy', 'Fog'];
    if (code >= 51 && code <= 57) return ['few-showers', 'Drizzle'];
    if (code === 66 || code === 67) return ['hail', 'Freezing Rain'];
    if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return ['rainy', code >= 80 ? 'Rain Showers' : 'Rain'];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', code >= 85 ? 'Snow Showers' : 'Snow'];
    if (code >= 95) return ['thunderstorm', 'Thunderstorm'];
    return ['cloudy', 'Cloudy'];
};

const VSB_SKY_CODES = { sun: 32, 'partly-cloudy': 30, cloudy: 26, foggy: 20, 'few-showers': 39, rainy: 12, hail: 6, snow: 16, thunderstorm: 4, windy: 24 };
const VSB_MOON_PHASES = ['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent'];

const vsbMoonPhase = function () {
    const days = (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    const age = ((days % 29.530588853) + 29.530588853) % 29.530588853;
    return VSB_MOON_PHASES[Math.round(age / 29.530588853 * 8) % 8];
};

const vsbWeatherMount = function (inst) {
    const wx = vsbEl('div', 'vsb-wx', inst.body);
    inst.parts = { wx };
    inst.data = null;
    vsbWeatherApply(inst);
    vsbWeatherPoll(inst);
};

const vsbWeatherApply = function (inst) {
    const wx = inst.parts.wx;
    const docked = inst.g.docked;
    const mode = docked ? 'docked' : 'undocked';
    const data = inst.data;
    const s = inst.g.settings;
    const unit = s.unit;
    const temp = (c) => Math.round(unit === 'C' ? c : c * 9 / 5 + 32) + '°';
    // apparent temperatures are missing from weather cached before they were fetched
    const pickC = (real, feels) => (s.feelsLike && feels != null ? feels : real);
    if (!data || !data.available || !data.current) {
        wx.dataset.sky = 'BLUE';
        wx.style.backgroundImage = `url(${VSB_ASSETS}weather/BLUE${docked ? 'DOCKED' : ''}-base.png)`;
        wx.innerHTML = data
            ? `<div class="vsb-wx-message"><img src="${VSB_ASSETS}weather/info.png" alt=""> Service not available</div>`
            : `<img class="vsb-wx-layer" src="${VSB_ASSETS}weather/${mode}-loading.png" alt="">`;
        return;
    }
    const [state, condition] = vsbWeatherState(data.current.code);
    const night = data.current.isDay === false;
    const gray = ['cloudy', 'foggy', 'rainy', 'snow', 'thunderstorm', 'hail', 'few-showers'].includes(state);
    const sky = night ? 'BLACK' : (gray ? 'GRAY' : 'BLUE');
    const moon = night && (state === 'sun' || state === 'partly-cloudy');
    const base = `${VSB_ASSETS}weather/${sky}${docked ? 'DOCKED' : ''}`;
    const loc = data.location || {};
    const today = (data.daily || [])[0];
    const hi = (day) => temp(pickC(day.maxC, day.feelsMaxC));
    const lo = (day) => temp(pickC(day.minC, day.feelsMinC));
    const place = s.hidePlace
        ? vsbWeatherPlaceAlt(s.placeAlt, today, condition, hi, lo)
        : [loc.city, loc.region || loc.country].filter(Boolean).join(', ') || 'Unknown location';
    const current = temp(pickC(data.current.tempC, data.current.feelsC));
    wx.dataset.sky = sky;
    wx.style.backgroundImage = `url(${base}-base.png)`;
    let html = '';
    if (moon) html += `<img class="vsb-wx-layer" src="${VSB_ASSETS}weather/${mode}_moon-${vsbMoonPhase()}.png" alt="">`;
    if (!(moon && state === 'sun')) html += `<img class="vsb-wx-layer" src="${VSB_ASSETS}weather/${mode}_${state}.png" alt="">`;
    html += `<img class="vsb-wx-highlight" src="${base}-highlight-01.png" alt="">`;
    html += `<div class="vsb-wx-temp">${current}</div>`;
    if (place) html += `<div class="vsb-wx-place" title="${escapeHtmlAttribute(place)}">${escapeHtml(place)}</div>`;
    if (!docked) {
        html += `<div class="vsb-wx-condition">${escapeHtml(condition)}</div>`;
        if (today) html += `<div class="vsb-wx-today"><span>${hi(today)}</span><span>/</span><span>${lo(today)}</span></div>`;
        html += '<div class="vsb-wx-forecast"><div class="vsb-wx-days">' + (data.daily || []).slice(1, 4).map((day) => {
            const [dayState] = vsbWeatherState(day.code);
            const name = VSB_DAYS[new Date(day.date + 'T12:00:00').getDay()];
            return `<div class="vsb-wx-day"><div class="vsb-wx-day-name">${name}</div>
                <div class="vsb-wx-range"><span class="vsb-wx-hi">${hi(day)}</span><span class="vsb-wx-lo">${lo(day)}</span></div>
                <img src="${VSB_ASSETS}weather/${VSB_SKY_CODES[dayState] || 26}.png" alt=""></div>`;
        }).join('') + '</div><div class="vsb-wx-attribution">Data provided by Open-Meteo</div></div>';
    }
    html += `<img class="vsb-wx-highlight vsb-wx-highlight-top" src="${base}-highlight-02.png" alt="">`;
    wx.innerHTML = html;
    wx.title = [s.hidePlace ? '' : place, `${condition}, ${current}${unit}${s.feelsLike ? ' (feels like)' : ''}`].filter(Boolean).join('\n');
};

const VSB_UV_LEVELS = [[3, 'Low'], [6, 'Moderate'], [8, 'High'], [11, 'Very High'], [Infinity, 'Extreme']];

/** What the place line shows when Hide location name is on. */
const vsbWeatherPlaceAlt = function (alt, today, condition, hi, lo) {
    if (alt === 'condition') return condition;
    if (!today) return '';
    if (alt === 'hilo') return `${hi(today)} / ${lo(today)}`;
    if (alt === 'rain' && today.rainChance != null) return `${Math.round(today.rainChance)}% chance of rain`;
    if (alt === 'uv' && today.uvMax != null) {
        const uv = Math.round(today.uvMax);
        return `UV index ${uv} ${VSB_UV_LEVELS.find(([below]) => uv < below)[1]}`;
    }
    return '';
};

const vsbWeatherPoll = async function (inst) {
    clearTimeout(inst.timer);
    if (inst.destroyed) return;
    try {
        // sidebar_weather: modules/ws/handlers/290-sidebarHandler.js (client IP, then the configured home)
        inst.data = await wsClient.sendMessage('sidebar_weather', {}, false) || { available: false };
    } catch (_) {
        inst.data = { available: false };
    }
    if (inst.destroyed) return;
    vsbWeatherApply(inst);
    inst.timer = setTimeout(() => vsbWeatherPoll(inst), 15 * 60000);
};

const vsbWeatherOptions = {
    html(set) {
        return `<div class="vsb-options">
            <div>Location: found from your connection</div>
            <div class="group"><div>Show temperature in:</div>
                <div><input type="radio" id="vsbWeatherUnitF" name="vsbWeatherUnit" value="F"${set.unit === 'F' ? ' checked' : ''}><label for="vsbWeatherUnitF">Fahrenheit</label></div>
                <div><input type="radio" id="vsbWeatherUnitC" name="vsbWeatherUnit" value="C"${set.unit === 'C' ? ' checked' : ''}><label for="vsbWeatherUnitC">Celsius</label></div></div>
            <div><input type="checkbox" id="vsbWeatherFeels"${set.feelsLike ? ' checked' : ''}><label for="vsbWeatherFeels">Use feels-like temperature</label></div>
            <div><input type="checkbox" id="vsbWeatherHidePlace"${set.hidePlace ? ' checked' : ''}><label for="vsbWeatherHidePlace">Hide location name</label></div>
            <div class="group"><label for="vsbWeatherPlaceAlt">Show in its place:</label>
                <select id="vsbWeatherPlaceAlt"${set.hidePlace ? '' : ' disabled'}>${vsbOptions(VSB_WEATHER_PLACE_ALTS, set.placeAlt || 'none')}</select></div>
        </div>`;
    },
    ready(dialog) {
        const hide = dialog.querySelector('#vsbWeatherHidePlace');
        hide.addEventListener('change', () => { dialog.querySelector('#vsbWeatherPlaceAlt').disabled = !hide.checked; });
    },
    read(dialog, set) {
        const picked = dialog.querySelector('input[name="vsbWeatherUnit"]:checked');
        return {
            ...set,
            unit: picked ? picked.value : set.unit,
            feelsLike: dialog.querySelector('#vsbWeatherFeels').checked,
            hidePlace: dialog.querySelector('#vsbWeatherHidePlace').checked,
            placeAlt: dialog.querySelector('#vsbWeatherPlaceAlt').value
        };
    }
};

// ---------------------------------------------------------------- mail

const vsbMailMount = function (inst) {
    const box = vsbEl('div', 'vsb-mail', inst.body);
    vsbEl('div', 'vsb-mail-glass', box);
    const head = vsbButton('vsb-mail-head', 'Open Dovecote', box);
    head.innerHTML = '<span>Inbox</span><span class="vsb-mail-unread"></span>';
    const list = vsbEl('div', 'vsb-mail-list', box);
    const message = vsbEl('div', 'vsb-mail-message hidden', box);
    const nav = vsbEl('div', 'vsb-mail-nav', box);
    const up = vsbButton('vsb-mail-btn vsb-mail-up', 'Previous', nav);
    const pos = vsbEl('span', 'vsb-mail-pos', nav);
    const down = vsbButton('vsb-mail-btn vsb-mail-down', 'Next', nav);
    const icon = vsbButton('vsb-mail-icon', 'Open Dovecote', box);
    inst.parts = { box, head, list, message, nav, up, down, pos, icon, unread: head.querySelector('.vsb-mail-unread') };
    inst.mail = [];
    inst.offset = 0;
    inst.paint = vsbMailPaint;
    box.style.setProperty('--vsb-mail-n', String(vsbMailPageSize(inst)));

    // openDesktopDovecote: public/scripts/comp/desktop-apps/dovecote.js
    head.addEventListener('click', () => openDesktopDovecote());
    icon.addEventListener('click', () => openDesktopDovecote());
    up.addEventListener('click', () => { inst.offset = Math.max(0, inst.offset - vsbMailPageSize(inst)); vsbMailPaint(inst); });
    down.addEventListener('click', () => { inst.offset += vsbMailPageSize(inst); vsbMailPaint(inst); });
    list.addEventListener('click', (e) => {
        const row = e.target.closest('[data-mail-id]');
        if (!row) return;
        // doveOpenReaderWindow: public/scripts/comp/desktop-apps/dovecote.js (reading marks it read; the mailbox push refreshes this list)
        doveOpenReaderWindow(row.dataset.mailId);
    });
    vsbMailRefresh(inst);
};

const vsbMailCount = function (settings) {
    const n = Number(settings && settings.count);
    return n >= 3 && n <= 6 ? n : 3;
};

const vsbMailPageSize = (inst) => vsbMailCount(inst.g.settings);

const vsbMailSender = function (from) {
    const raw = String(from || '').trim();
    const named = raw.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
    if (named) return named.includes('@') ? named.split('@')[0] : named;
    return raw.replace(/[<>]/g, '').split('@')[0] || 'Unknown';
};

const vsbMailDate = function (iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    if (vsbSameDay(d, new Date())) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const vsbMailPaint = function (inst) {
    const p = inst.parts;
    const size = vsbMailPageSize(inst);
    p.box.style.setProperty('--vsb-mail-n', String(size));
    const total = inst.mail.length;
    inst.offset = Math.max(0, Math.min(inst.offset, Math.max(0, total - 1) - (Math.max(0, total - 1) % size)));
    p.unread.textContent = inst.unread ? `${inst.unread} unread` : '';
    if (inst.error || !total) {
        p.list.innerHTML = '';
        p.message.textContent = inst.error ? 'Dovecote is not available' : (inst.g.settings.unreadOnly ? 'No unread messages' : 'No messages');
        p.message.classList.remove('hidden');
    } else {
        p.message.classList.add('hidden');
        p.list.innerHTML = inst.mail.slice(inst.offset, inst.offset + size).map((m) => {
            const unread = m.read ? '' : ' is-unread';
            const attached = m.attachments && m.attachments.length ? ' has-attachment' : '';
            return `
            <button type="button" class="vsb-mail-item${unread}${attached}" data-mail-id="${escapeHtmlAttribute(String(m.id))}" title="${escapeHtmlAttribute(m.subject || '(no subject)')}">
                <span class="vsb-mail-subject">${escapeHtml(m.subject || '(no subject)')}</span>
                <span class="vsb-mail-meta"><span class="vsb-mail-from">${escapeHtml(vsbMailSender(m.from))}</span><span class="vsb-mail-date">${escapeHtml(vsbMailDate(m.createdAt))}</span></span>
            </button>`;
        }).join('');
    }
    p.pos.textContent = total ? `${inst.offset + 1}-${Math.min(total, inst.offset + size)}/${total}` : '0';
    p.pos.title = total ? `${inst.offset + 1}-${Math.min(total, inst.offset + size)} of ${total}` : '';
    p.up.disabled = inst.offset === 0;
    p.down.disabled = inst.offset + size >= total;
    inst.painted = true;
};

// A pushed update already carries the human inbox. Returns false when the gadget still has to ask.
const vsbMailApplyPush = function (inst, data) {
    if (!data || !Array.isArray(data.mailboxes)) return false;
    // DESKTOP_DOVECOTE_HUMAN_OWNER: public/scripts/comp/desktop-apps/dovecote.js
    const owner = DESKTOP_DOVECOTE_HUMAN_OWNER;
    const mine = data.mailboxes.find((box) => box.owner === owner);
    const unreadOnly = inst.g.settings.unreadOnly === true;
    const rows = unreadOnly ? (data.unreadInbox && data.unreadInbox[owner]) : (data.inbox && data.inbox[owner]);
    if (!mine || !Array.isArray(rows)) return false;
    inst.mailToken = (inst.mailToken || 0) + 1;
    inst.mail = rows.slice(0, 24);
    inst.unread = mine.unread || 0;
    inst.error = false;
    (inst.paint || vsbMailPaint)(inst);
    return true;
};

const vsbMailRefresh = async function (inst, pushed) {
    if (!inst || inst.destroyed) return;
    if (pushed && vsbMailApplyPush(inst, pushed)) return;
    const token = (inst.mailToken = (inst.mailToken || 0) + 1);
    const paint = inst.paint || vsbMailPaint;
    // height follows the count before the fetch, so the sidebar pages the new size immediately
    if (inst.painted) paint(inst);
    try {
        // dovecote_list_mail / dovecote_list_mailboxes: modules/ws/handlers/250-dovecoteHandler.js
        const [list, boxes] = await Promise.all([
            wsClient.sendMessage('dovecote_list_mail', { folder: 'inbox', limit: 24, unreadOnly: inst.g.settings.unreadOnly === true }, false),
            wsClient.sendMessage('dovecote_list_mailboxes', {}, false)
        ]);
        if (inst.destroyed || inst.mailToken !== token) return;
        inst.mail = (list && list.mail) || [];
        const owner = list && list.owner;
        const mine = ((boxes && boxes.mailboxes) || []).find((b) => b.owner === owner);
        inst.unread = mine ? mine.unread || 0 : inst.mail.filter((m) => !m.read).length;
        inst.error = false;
    } catch (_) {
        if (inst.destroyed || inst.mailToken !== token) return;
        inst.error = true;
    }
    if (inst.destroyed || inst.mailToken !== token) return;
    paint(inst);
};

const vsbRefreshMailGadgets = function (pushed) {
    if (!vsb.instances) return;
    vsb.instances.forEach((inst) => {
        if (inst.destroyed) return;
        if (inst.g.type !== 'mail' && inst.g.type !== 'outlook') return;
        vsbMailRefresh(inst, pushed);
    });
};

const vsbMailOptions = {
    html(set) {
        const count = vsbMailCount(set);
        return `<div class="vsb-options">
            <div class="group"><label for="vsbMailCount">Messages to show:</label>
                <select id="vsbMailCount">${vsbOptions([3, 4, 5, 6].map((n) => [n, String(n)]), count)}</select></div>
            <div class="group"><div>Show:</div>
                <div><input type="radio" id="vsbMailShowAll" name="vsbMailShow" value="all"${set.unreadOnly ? '' : ' checked'}><label for="vsbMailShowAll">All Inbox messages</label></div>
                <div><input type="radio" id="vsbMailShowUnread" name="vsbMailShow" value="unread"${set.unreadOnly ? ' checked' : ''}><label for="vsbMailShowUnread">Unread messages only</label></div></div>
        </div>`;
    },
    read(dialog, set) {
        const picked = dialog.querySelector('input[name="vsbMailShow"]:checked');
        const count = Number(dialog.querySelector('#vsbMailCount').value);
        return { ...set, unreadOnly: !!picked && picked.value === 'unread', count: count >= 3 && count <= 6 ? count : 3 };
    }
};

// ---------------------------------------------------------------- calculator (Microsoft + Desktop Calculator)

const VSB_CALC_COLORS = [['grey', 'Grey'], ['pink', 'Pink'], ['yellow', 'Yellow']];
// Desktop Calculator's back colour (its PerSettings "backcolor", default #1F202A): any colour, drawn by
// tinting bg_*.png with the gadget's own colour layers (vsbDeskTint). The names are the presets offered.
const VSB_DESK_COLORS = [['plain', 'Classic', '#1F202A'], ['black', 'Black', '#101010'], ['blue', 'Blue', '#1C3A78'],
    ['aqua', 'Aqua', '#17707C'], ['green', 'Green', '#1E5E2A'], ['red', 'Red', '#7A1C1C'], ['pink', 'Pink', '#8C2A62'],
    ['yellow', 'Yellow', '#8A7414'], ['white', 'White', '#C8C8CC']];

const vsbCalcDefaults = () => ({ entry: '0', acc: null, op: '', fresh: true, memory: null, history: [] });

const vsbCalcNum = (s) => {
    const n = Number(s.entry);
    return Number.isFinite(n) ? n : 0;
};

const vsbCalcShow = (s, n) => {
    if (!Number.isFinite(n)) {
        s.entry = 'Error';
        s.fresh = true;
        s.acc = null;
        s.op = '';
        return;
    }
    let t = String(Math.round(n * 1e10) / 1e10);
    if (t.length > 12) t = n.toExponential(5);
    s.entry = t;
    s.fresh = true;
};

const vsbCalcCompute = (s) => {
    const b = vsbCalcNum(s);
    if (s.acc == null || !s.op) return b;
    switch (s.op) {
        case '+': return s.acc + b;
        case '-': return s.acc - b;
        case '*': return s.acc * b;
        case '/': return b === 0 ? NaN : s.acc / b;
        case 'pow': return Math.pow(s.acc, b);
        default: return b;
    }
};

const vsbCalcAct = (inst, op) => {
    const s = inst.g.settings;
    if (s.entry === 'Error' && op !== 'c') {
        s.entry = '0';
        s.fresh = true;
    }
    if (/^[0-9]$/.test(op)) {
        if (s.fresh || s.entry === '0') s.entry = op;
        else if (s.entry.replace('-', '').replace('.', '').length < 12) s.entry += op;
        s.fresh = false;
    } else if (op === 'dot') {
        if (s.fresh) s.entry = '0.';
        else if (!s.entry.includes('.')) s.entry += '.';
        s.fresh = false;
    } else if (op === 'sign') {
        if (s.entry.startsWith('-')) s.entry = s.entry.slice(1) || '0';
        else if (s.entry !== '0') s.entry = '-' + s.entry;
    } else if (op === 'bk') {
        if (!s.fresh) s.entry = s.entry.length > 1 ? s.entry.slice(0, -1) : '0';
    } else if (op === 'c') {
        s.entry = '0';
        s.acc = null;
        s.op = '';
        s.fresh = true;
    } else if (/^(sqrt|sq|inv|pct|a?(sin|cos|tan)|ln|log|fact)$/.test(op)) {
        const n = vsbCalcNum(s);
        // Desktop Calculator's Settings > Function: degrees (default) or radians
        const toRad = s.angles === 'rad' ? 1 : Math.PI / 180;
        const rad = n * toRad;
        const fact = (x) => {
            if (x < 0 || x > 170 || Math.floor(x) !== x) return NaN;
            let r = 1;
            for (let i = 2; i <= x; i++) r *= i;
            return r;
        };
        const fns = {
            asin: () => Math.asin(n) / toRad,
            acos: () => Math.acos(n) / toRad,
            atan: () => Math.atan(n) / toRad,
            fact: () => fact(n),
            sqrt: () => Math.sqrt(n),
            sq: () => n * n,
            inv: () => 1 / n,
            pct: () => (s.acc == null ? n / 100 : s.acc * n / 100),
            sin: () => Math.sin(rad),
            cos: () => Math.cos(rad),
            tan: () => Math.tan(rad),
            ln: () => Math.log(n),
            log: () => Math.log10(n)
        };
        vsbCalcShow(s, fns[op]());
    } else if (op === 'pi') {
        s.entry = String(Math.PI).slice(0, 12);
        s.fresh = true;
    } else if (op === 'ms') {
        s.memory = vsbCalcNum(s);
    } else if (op === 'mp') {
        s.memory = (s.memory || 0) + vsbCalcNum(s);
    } else if (op === 'mr') {
        if (s.memory != null) {
            vsbCalcShow(s, s.memory);
        }
    } else if (op === 'mc') {
        s.memory = null;
    } else if (op === 'eq') {
        if (s.op) {
            const r = vsbCalcCompute(s);
            s.history = [`${s.acc} ${s.op} ${s.entry}`.slice(0, 40), ...(s.history || [])].slice(0, 8);
            vsbCalcShow(s, r);
            s.acc = null;
            s.op = '';
        }
    } else if (op === '+' || op === '-' || op === '*' || op === '/' || op === 'pow') {
        if (s.acc != null && s.op && !s.fresh) vsbCalcShow(s, vsbCalcCompute(s));
        if (s.entry !== 'Error') s.acc = vsbCalcNum(s);
        s.op = op;
        s.fresh = true;
    }
    if (inst.g.type === 'deskcalc') vsbDeskPaint(inst);
    else vsbCalcPaint(inst);
    vsbQueueSave();
};

const vsbCalcBind = (root, inst) => {
    root.tabIndex = 0;
    root.addEventListener('pointerdown', () => root.focus());
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-calc]');
        if (btn) vsbCalcAct(inst, btn.dataset.calc);
    });
    root.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea')) return;
        let op = null;
        if (/^[0-9]$/.test(e.key)) op = e.key;
        else if (e.key === '.') op = 'dot';
        else if (e.key === 'Enter' || e.key === '=') op = 'eq';
        else if (e.key === 'Escape') op = 'c';
        else if (e.key === 'Backspace') op = 'bk';
        else if (e.key === '%') op = 'pct';
        else if ('+-*/'.includes(e.key)) op = e.key;
        else if (e.key === '^' && inst.g.type === 'deskcalc') op = 'pow';
        else if (e.key === '!' && inst.g.type === 'deskcalc') op = 'fact';
        if (!op) return;
        e.preventDefault();
        vsbCalcAct(inst, op);
    });
};

const vsbCalcKey = (label, op, parent, className) => {
    const btn = vsbButton(className || 'vsb-calc-key', label, parent);
    btn.dataset.calc = op;
    btn.textContent = label;
    return btn;
};

const vsbCalcMount = function (inst) {
    const root = vsbEl('div', 'vsb-calc', inst.body);
    const history = vsbEl('div', 'vsb-calc-history', root);
    const screen = vsbEl('div', 'vsb-calc-screen', root);
    const memflag = vsbEl('span', 'vsb-calc-memflag', screen);
    memflag.textContent = 'M';
    const readout = vsbEl('div', 'vsb-calc-readout', screen);
    const mem = vsbEl('div', 'vsb-calc-memrow', screen);
    [['C', 'c'], ['M', 'ms'], ['M+', 'mp'], ['MR', 'mr'], ['MC', 'mc']].forEach(([label, op]) => {
        vsbCalcKey(label, op, mem, 'vsb-calc-memkey');
    });
    const dock = vsbEl('div', 'vsb-calc-pad vsb-calc-pad-dock', root);
    [['7', '7'], ['8', '8'], ['9', '9'], ['/', '/'], ['<', 'bk'],
        ['4', '4'], ['5', '5'], ['6', '6'], ['*', '*'], ['sqrt', 'sqrt'],
        ['1', '1'], ['2', '2'], ['3', '3'], ['-', '-'], ['%', 'pct'],
        ['0', '0'], ['.', 'dot'], ['+/-', 'sign'], ['+', '+'], ['=', 'eq']
    ].forEach(([label, op]) => vsbCalcKey(label, op, dock));
    const wide = vsbEl('div', 'vsb-calc-pad vsb-calc-pad-wide', root);
    [['7', '7'], ['8', '8'], ['9', '9'], ['sqrt', 'sqrt'], ['<', 'bk'], ['+', '+', 'vsb-calc-key vsb-calc-plus'],
        ['4', '4'], ['5', '5'], ['6', '6'], ['x2', 'sq'], ['/', '/'],
        ['1', '1'], ['2', '2'], ['3', '3'], ['1/x', 'inv'], ['*', '*'], ['=', 'eq', 'vsb-calc-key vsb-calc-eq'],
        ['0', '0'], ['+/-', 'sign'], ['.', 'dot'], ['%', 'pct'], ['-', '-']
    ].forEach(([label, op, className]) => vsbCalcKey(label, op, wide, className));
    inst.parts = { root, history, readout, memflag };
    vsbCalcBind(root, inst);
    vsbCalcPaint(inst);
};

const vsbCalcPaint = function (inst) {
    const s = inst.g.settings;
    const p = inst.parts;
    p.root.dataset.color = s.color || 'grey';
    p.root.classList.toggle('is-history', s.historyOn !== false);
    p.readout.textContent = s.entry || '0';
    p.memflag.classList.toggle('hidden', s.memory == null);
    p.history.innerHTML = (s.history || []).slice().reverse().map((line) => `<div>${escapeHtml(line)}</div>`).join('');
};

const vsbCalcOptions = {
    html(set) {
        return `<div class="vsb-options">
            <div class="group"><label for="vsbCalcColor">Color:</label>
                <select id="vsbCalcColor">${vsbOptions(VSB_CALC_COLORS, set.color || 'grey')}</select></div>
            <div><input type="checkbox" id="vsbCalcHistory"${set.historyOn !== false ? ' checked' : ''}><label for="vsbCalcHistory">Show history when undocked</label></div>
        </div>`;
    },
    read(dialog, set) {
        return { ...set, color: dialog.querySelector('#vsbCalcColor').value, historyOn: dialog.querySelector('#vsbCalcHistory').checked };
    }
};

// Desktop Calculator (tmp/gadget/DesktopCalculator.gadget, Home Cooked Gadgets 1.5), laid out as its
// Calculator.html draws itself: bg_*.png tinted to the back colour by four colour layers, then each key as
// its 3-slice art (bs_* 20 px docked, bb_* 36 px undocked: middle / edges for normal, hot and pressed),
// then cover_*.png on top with the LCD and every key's label; the number is Arial on the LCD.
// Docked 130x186 (24 keys), undocked 398x335 (36: the 24 plus pi, n! and ten scientific keys).
const VSB_DESK_KEYS = [
    ['mp', 'memory', 'M+'], ['mr', 'memory', 'MR'], ['mc', 'memory', 'MC'], ['c', 'clear', 'C'],
    ['inv', 'operations', '1/x'], ['pct', 'operations', '%'], ['sqrt', 'operations', 'Square root'], ['/', 'operations', 'Divide'],
    ['7', 'numbers'], ['8', 'numbers'], ['9', 'numbers'], ['*', 'operations', 'Multiply'],
    ['4', 'numbers'], ['5', 'numbers'], ['6', 'numbers'], ['-', 'operations', 'Subtract'],
    ['1', 'numbers'], ['2', 'numbers'], ['3', 'numbers'], ['+', 'operations', 'Add'],
    ['0', 'numbers'], ['sign', 'numbers', 'Change sign'], ['dot', 'numbers', 'Decimal point'], ['eq', 'equals', 'Equals']
];
const VSB_DESK_EXTRA = [['pi', 'pi'], ['fact', 'n!'], ['sin', 'sin'], ['asin', 'asin'], ['cos', 'cos'], ['acos', 'acos'],
    ['tan', 'tan'], ['atan', 'atan'], ['log', 'log'], ['ln', 'ln'], ['sq', 'x squared'], ['pow', 'x to the power y']];
// PerSettings.sDefaults: the art for each key group
const VSB_DESK_INK = { memory: 'blue', clear: 'red', operations: 'gray', numbers: 'black', equals: 'green', extra: 'beige' };

// addOverBoxes(): each key's rectangle, docked and undocked
const vsbDeskRects = function (docked) {
    const rects = [];
    if (docked) {
        for (let i = 0; i < 24; i++) {
            const col = i % 4;
            const row = Math.floor(i / 4);
            rects.push({ x: 8 + col * 29, y: row === 0 ? 45 : 70 + (row - 1) * 22, w: 28, h: 20 });
        }
        return rects;
    }
    for (let i = 0; i < 24; i++) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        rects.push({ x: 11 + col * 54, y: row === 0 ? 77 : 123 + (row - 1) * 41, w: 50, h: 36 });
    }
    rects.push({ x: 233, y: 77, w: 75, h: 36 }, { x: 312, y: 77, w: 75, h: 36 });
    for (let i = 0; i < 10; i++) rects.push({ x: 233 + (i % 2) * 79, y: 123 + Math.floor(i / 2) * 41, w: 75, h: 36 });
    return rects;
};

// One key: the two rounded ends and the stretched middle of its sprite, under the label cover
const vsbDeskKey = function (parent, op, group, title, rect) {
    const btn = vsbButton('vsb-desk-key', title || op, parent);
    btn.dataset.calc = op;
    btn.dataset.ink = VSB_DESK_INK[group];
    btn.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;--k:${rect.h}px`;
    vsbEl('span', 'vsb-desk-key-l', btn);
    vsbEl('span', 'vsb-desk-key-m', btn);
    vsbEl('span', 'vsb-desk-key-r', btn);
    return btn;
};

const vsbDeskMount = function (inst) {
    const root = vsbEl('div', 'vsb-desk', inst.body);
    const tint = vsbEl('div', 'vsb-desk-tint', root);
    const layers = {};
    ['base', 'main', 'color', 'white', 'black'].forEach((name) => {
        layers[name] = vsbEl('div', 'vsb-desk-layer', tint);
        layers[name].dataset.layer = name;
    });
    [true, false].forEach((docked) => {
        const pad = vsbEl('div', 'vsb-desk-pad ' + (docked ? 'is-docked' : 'is-undocked'), root);
        const rects = vsbDeskRects(docked);
        VSB_DESK_KEYS.forEach(([op, group, title], i) => vsbDeskKey(pad, op, group, title, rects[i]));
        if (!docked) VSB_DESK_EXTRA.forEach(([op, title], i) => vsbDeskKey(pad, op, 'extra', title, rects[24 + i]));
    });
    vsbEl('div', 'vsb-desk-cover', root);
    const memflag = vsbEl('span', 'vsb-desk-mem', root);
    memflag.textContent = 'M';
    const readout = vsbEl('div', 'vsb-desk-readout', root);
    inst.parts = { root, readout, memflag, layers };
    vsbCalcBind(root, inst);
    vsbDeskPaint(inst);
};

// setColorLayers(): the strongest channel picks the colour layer, the order of the other two the main
// layer; the colour, white and black layers' opacities mix the rest
const vsbDeskTint = function (hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const v = parseInt(m ? m[1] : '1F202A', 16);
    const r = (v >> 16) & 255;
    const g = (v >> 8) & 255;
    const b = v & 255;
    let color; let main; let v1; let v2; let v3;
    if (r > g && r > b) {
        color = 'red';
        if (g > b) { main = 'yellow'; v1 = r; v2 = g; v3 = b; } else { main = 'pink'; v1 = r; v2 = b; v3 = g; }
    } else if (g > b) {
        color = 'green';
        if (r > b) { main = 'yellow'; v1 = g; v2 = r; v3 = b; } else { main = 'aqua'; v1 = g; v2 = b; v3 = r; }
    } else {
        color = 'blue';
        if (g > r) { main = 'aqua'; v1 = b; v2 = g; v3 = r; } else { main = 'pink'; v1 = b; v2 = r; v3 = g; }
    }
    const share = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
    return { main, color, colorOpacity: share((v2 - v1) / (v3 - v1)), whiteOpacity: share(v3 / v1), blackOpacity: share(1 - v1 / 255) };
};

const vsbDeskHex = function (s) {
    if (/^#[0-9a-f]{6}$/i.test(s.backcolor || '')) return s.backcolor;
    const preset = VSB_DESK_COLORS.find(([id]) => id === s.color);
    return preset ? preset[2] : VSB_DESK_COLORS[0][2];
};

// format_disp_num(): a trailing point, thousands grouped, at most 10 (docked) / 20 characters, else
// rounded or in exponent form
const vsbDeskFormat = function (entry, docked) {
    if (entry === 'Error') return 'Error';
    const max = docked ? 10 : 20;
    const group = (t) => {
        const neg = t.startsWith('-');
        const body = neg ? t.slice(1) : t;
        const dot = body.indexOf('.');
        const int = dot === -1 ? body : body.slice(0, dot);
        const frac = dot === -1 ? '.' : body.slice(dot);
        return (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac;
    };
    let text = String(entry);
    if (!/e/i.test(text)) {
        const shown = group(text);
        if (shown.length <= max) return shown;
        const n = Number(text);
        const dot = text.replace('-', '').indexOf('.');
        if (dot > -1 && dot < max) {
            const scale = Math.pow(10, Math.max(0, max - dot - 1));
            const rounded = group(String(Math.round(n * scale) / scale));
            if (rounded.length <= max) return rounded;
        }
    }
    const n = Number(text);
    if (!Number.isFinite(n)) return 'Error';
    for (let digits = max - 5; digits >= 0; digits--) {
        text = n.toExponential(digits);
        if (text.length <= max) return text;
    }
    return text;
};

const vsbDeskPaint = function (inst) {
    const s = inst.g.settings;
    const p = inst.parts;
    const docked = !!inst.g.docked;
    const size = docked ? 'small' : 'big';
    const tint = vsbDeskTint(vsbDeskHex(s));
    const art = (name) => `url(${VSB_ASSETS}deskcalc/bg_${size}${name ? '_' + name : ''}.png)`;
    p.layers.base.style.backgroundImage = art('');
    p.layers.main.style.backgroundImage = art(tint.main);
    p.layers.color.style.backgroundImage = art(tint.color);
    p.layers.color.style.opacity = String(tint.colorOpacity);
    p.layers.white.style.backgroundImage = art('white');
    p.layers.white.style.opacity = String(tint.whiteOpacity);
    p.layers.black.style.backgroundImage = art('black');
    p.layers.black.style.opacity = String(tint.blackOpacity);
    p.readout.textContent = vsbDeskFormat(s.entry || '0', docked);
    p.memflag.classList.toggle('hidden', !s.memory);
};

const vsbDeskOptions = {
    html(set) {
        const current = VSB_DESK_COLORS.some(([id]) => id === set.color) ? set.color : 'plain';
        return `<div class="vsb-options">
            <div class="group"><label for="vsbDeskColor">Color:</label>
                <select id="vsbDeskColor">${vsbOptions(VSB_DESK_COLORS.map(([id, label]) => [id, label]), current)}</select></div>
            <div class="group"><label for="vsbDeskAngles">Angles:</label>
                <select id="vsbDeskAngles">${vsbOptions([['deg', 'Degrees'], ['rad', 'Radians']], set.angles === 'rad' ? 'rad' : 'deg')}</select></div>
            <p>Undock the calculator for scientific keys.</p>
        </div>`;
    },
    read(dialog, set) {
        const next = { ...set, color: dialog.querySelector('#vsbDeskColor').value, angles: dialog.querySelector('#vsbDeskAngles').value };
        delete next.backcolor;
        return next;
    }
};

// ---------------------------------------------------------------- timer

const vsbTimerSound = (inst, name) => {
    const now = Date.now();
    if (name.indexOf('wind') === 0 && now - (inst.soundAt || 0) < 90) return;
    inst.soundAt = now;
    if (!inst.sounds) inst.sounds = {};
    const audio = inst.sounds[name] || (inst.sounds[name] = new Audio(`${VSB_ASSETS}timer/${name}.wav`));
    audio.currentTime = 0;
    audio.play().catch(() => {});
};

const vsbTimerStop = (inst) => {
    if (!inst.sounds) return;
    Object.values(inst.sounds).forEach((audio) => audio.pause());
};

const vsbTimerPlace = (ring, value) => {
    ring.querySelectorAll('.vsb-timer-num').forEach((n) => {
        const base = Number(n.dataset.deg);
        const radius = n.dataset.radius;
        const angle = base - value * 6;
        n.style.transform = `rotate(${angle}deg) translateY(-${radius}) rotate(${-angle}deg)`;
    });
};

const vsbTimerPaint = function (inst) {
    const s = inst.g.settings;
    const running = s.endAt > Date.now();
    const left = running ? Math.max(0, (s.endAt - Date.now()) / 1000) : (s.mins * 60 + s.secs);
    const mins = Math.min(60, left / 60);
    const secs = left % 60;
    const radius = inst.g.docked ? ['22px', '34px'] : ['32px', '48px'];
    inst.parts.secs.querySelectorAll('.vsb-timer-num').forEach((n) => { n.dataset.radius = radius[0]; });
    inst.parts.mins.querySelectorAll('.vsb-timer-num').forEach((n) => { n.dataset.radius = radius[1]; });
    vsbTimerPlace(inst.parts.secs, secs);
    vsbTimerPlace(inst.parts.mins, mins);
    const show = `${vsbPad2(Math.floor(left / 60))}:${vsbPad2(Math.floor(left % 60))}`;
    inst.parts.readout.textContent = show;
    inst.parts.root.title = show;
    inst.parts.root.classList.toggle('is-ringing', !!s.ringing && !running);
};

const vsbTimerArm = function (inst) {
    clearTimeout(inst.timer);
    if (inst.destroyed || inst.g.settings.ringing) return;
    if (!(inst.g.settings.endAt > Date.now())) return;
    inst.timer = setTimeout(() => vsbTimerTick(inst), 100);
};

const vsbTimerTick = function (inst) {
    const s = inst.g.settings;
    const left = (s.endAt - Date.now()) / 1000;
    if (!(left > 0)) {
        s.endAt = 0;
        s.mins = 0;
        s.secs = 0;
        s.ringing = true;
        vsbTimerPaint(inst);
        vsbTimerSound(inst, 'done');
        vsbQueueSave();
        return;
    }
    const sec = Math.ceil(left);
    if (inst.lastSec != null && sec !== inst.lastSec && left > 1 && sec % 5 === 0) vsbTimerSound(inst, 'tick');
    inst.lastSec = sec;
    s.mins = Math.floor(left / 60);
    s.secs = Math.floor(left % 60);
    vsbTimerPaint(inst);
    vsbTimerArm(inst);
};

const vsbTimerWind = function (inst, band, event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const s = inst.g.settings;
    s.endAt = 0;
    s.ringing = false;
    vsbTimerStop(inst);
    const startX = event.clientX;
    const start = band === 'mins' ? s.mins : s.secs;
    const move = (ev) => {
        const max = band === 'mins' ? 60 : 59;
        const next = Math.max(0, Math.min(max, Math.round(start + (ev.clientX - startX) * 0.35)));
        s[band] = next;
        vsbTimerPaint(inst);
        vsbTimerSound(inst, band === 'mins' ? 'windMins' : 'windSecs');
    };
    const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        const total = s.mins * 60 + s.secs;
        s.endAt = total > 0 ? Date.now() + total * 1000 : 0;
        inst.lastSec = null;
        vsbTimerPaint(inst);
        vsbTimerArm(inst);
        vsbQueueSave();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
};

const vsbTimerMount = function (inst) {
    const root = vsbEl('div', 'vsb-timer', inst.body);
    const makeRing = (band, radius) => {
        const ring = vsbEl('div', 'vsb-timer-ring', root);
        for (let i = 0; i < 12; i++) {
            const n = vsbEl('span', 'vsb-timer-num', ring);
            const number = i * 5;
            n.textContent = vsbPad2(number);
            n.dataset.deg = String(180 + number * 6);
            n.dataset.radius = radius;
        }
        return ring;
    };
    const secs = makeRing('secs', '22px');
    const mins = makeRing('mins', '34px');
    const readout = vsbEl('div', 'vsb-timer-readout', root);
    const hitSecs = vsbEl('div', 'vsb-timer-hit vsb-timer-hit-secs', root);
    const hitMins = vsbEl('div', 'vsb-timer-hit vsb-timer-hit-mins', root);
    const reset = vsbButton('vsb-timer-reset', 'Reset', root);
    inst.parts = { root, secs, mins, readout };
    hitSecs.addEventListener('pointerdown', (e) => vsbTimerWind(inst, 'secs', e));
    hitMins.addEventListener('pointerdown', (e) => vsbTimerWind(inst, 'mins', e));
    reset.addEventListener('click', () => {
        const s = inst.g.settings;
        s.endAt = 0;
        s.mins = 0;
        s.secs = 0;
        s.ringing = false;
        vsbTimerStop(inst);
        clearTimeout(inst.timer);
        vsbTimerPaint(inst);
        vsbQueueSave();
    });
    vsbTimerPaint(inst);
    vsbTimerArm(inst);
};

const vsbTimerApply = function (inst) {
    vsbTimerPaint(inst);
    vsbTimerArm(inst);
};

// ---------------------------------------------------------------- clipboard

const vsbClipPaint = function (inst) {
    const items = inst.g.settings.items || [];
    const q = (inst.filter || '').trim().toLowerCase();
    const shown = items.map((text, index) => ({ text, index })).filter((row) => !q || row.text.toLowerCase().includes(q));
    inst.parts.list.innerHTML = shown.length
        ? shown.map((row) => `<button type="button" class="vsb-clip-item" data-clip="${row.index}" title="${escapeHtmlAttribute(row.text)}">${escapeHtml(row.text)}</button>`).join('')
        : '<div class="vsb-clip-empty">Nothing copied yet</div>';
};

const vsbClipPush = function (raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!text || !vsb.state) return;
    let changed = false;
    vsb.state.gadgets.forEach((g) => {
        if (g.type !== 'clipboard') return;
        const items = g.settings.items || [];
        if (items[0] === text) return;
        g.settings.items = [text, ...items.filter((item) => item !== text)].slice(0, 16);
        changed = true;
        const live = vsb.instances.get(g.id);
        if (live) vsbClipPaint(live);
    });
    if (changed) vsbQueueSave();
};

const vsbClipOnCopy = function (e) {
    if (e.target && e.target.closest && e.target.closest('input[type="password"]')) return;
    let text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!text) {
        const sel = getSelection();
        text = sel ? String(sel) : '';
    }
    vsbClipPush(text);
};

const vsbClipMount = function (inst) {
    const box = vsbEl('div', 'vsb-clip', inst.body);
    const bar = vsbEl('div', 'vsb-clip-bar', box);
    const clear = vsbButton('vsb-clip-clear', 'Clear history', bar);
    clear.textContent = 'Clear';
    const grab = vsbButton('vsb-clip-grab', 'Read the clipboard', bar);
    grab.textContent = 'Paste in';
    const list = vsbEl('div', 'vsb-clip-list', box);
    const filter = vsbEl('input', 'vsb-clip-filter', box);
    filter.type = 'search';
    filter.placeholder = 'Filter';
    filter.setAttribute('aria-label', 'Filter clips');
    inst.parts = { list, filter };
    inst.filter = '';
    clear.addEventListener('click', () => {
        inst.g.settings.items = [];
        vsbClipPaint(inst);
        vsbQueueSave();
    });
    grab.addEventListener('click', () => {
        navigator.clipboard.readText().then(vsbClipPush).catch(() => {
            showGlassToast('warning', 'Clipboard', 'The browser did not allow reading the clipboard.', false, 4000);
        });
    });
    filter.addEventListener('input', () => {
        inst.filter = filter.value;
        vsbClipPaint(inst);
    });
    list.addEventListener('click', (e) => {
        const row = e.target.closest('[data-clip]');
        if (!row) return;
        const text = (inst.g.settings.items || [])[Number(row.dataset.clip)];
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => vsbClipPush(text)).catch(() => {
            showGlassToast('warning', 'Clipboard', 'Could not write to the clipboard.', false, 4000);
        });
    });
    vsbClipPaint(inst);
};

const vsbClipApply = function (inst) {
    vsbClipPaint(inst);
};

// ---------------------------------------------------------------- sidebar outlook (Dovecote)

const vsbOutlookPage = (inst) => (inst.g.docked ? 4 : 7);

const vsbOutlookPaint = function (inst) {
    const p = inst.parts;
    const size = vsbOutlookPage(inst);
    const total = inst.mail.length;
    inst.offset = Math.max(0, Math.min(inst.offset, Math.max(0, total - size)));
    p.unread.textContent = inst.unread ? String(inst.unread) : '';
    if (inst.error || !total) {
        p.list.innerHTML = '';
        p.message.textContent = inst.error ? 'Dovecote is not available' : (inst.g.settings.unreadOnly ? 'No unread messages' : 'No messages');
        p.message.classList.remove('hidden');
    } else {
        p.message.classList.add('hidden');
        p.list.innerHTML = inst.mail.slice(inst.offset, inst.offset + size).map((m) => `
            <button type="button" class="vsb-out-item${m.read ? '' : ' is-unread'}" data-mail-id="${escapeHtmlAttribute(String(m.id))}">
                <span class="vsb-out-from">${escapeHtml(vsbMailSender(m.from))}</span>
                <span class="vsb-out-date">${escapeHtml(vsbMailDate(m.createdAt))}</span>
                <span class="vsb-out-subject">${escapeHtml(m.subject || '(no subject)')}</span>
            </button>`).join('');
    }
    p.up.disabled = inst.offset === 0;
    p.down.disabled = inst.offset + size >= total;
    inst.painted = true;
};

const vsbOutlookMount = function (inst) {
    const box = vsbEl('div', 'vsb-out', inst.body);
    const unread = vsbEl('div', 'vsb-out-unread', box);
    const tools = vsbEl('div', 'vsb-out-tools', box);
    const neu = vsbButton('vsb-out-tool', 'New message', tools);
    const sync = vsbButton('vsb-out-tool', 'Send and receive', tools);
    const open = vsbButton('vsb-out-tool', 'Open Inbox', tools);
    const up = vsbButton('vsb-out-scroll vsb-out-up', 'Previous', box);
    const list = vsbEl('div', 'vsb-out-list', box);
    const message = vsbEl('div', 'vsb-out-message hidden', box);
    const down = vsbButton('vsb-out-scroll vsb-out-down', 'Next', box);
    inst.parts = { unread, list, message, up, down };
    inst.mail = [];
    inst.offset = 0;
    inst.paint = vsbOutlookPaint;
    // doveOpenCompose / openDesktopDovecote: public/scripts/comp/desktop-apps/dovecote.js
    neu.addEventListener('click', () => doveOpenCompose('create', null));
    sync.addEventListener('click', () => vsbMailRefresh(inst));
    open.addEventListener('click', () => openDesktopDovecote());
    up.addEventListener('click', () => { inst.offset = Math.max(0, inst.offset - vsbOutlookPage(inst)); vsbOutlookPaint(inst); });
    down.addEventListener('click', () => { inst.offset += vsbOutlookPage(inst); vsbOutlookPaint(inst); });
    list.addEventListener('click', (e) => {
        const row = e.target.closest('[data-mail-id]');
        if (!row) return;
        // doveOpenReaderWindow: public/scripts/comp/desktop-apps/dovecote.js
        doveOpenReaderWindow(row.dataset.mailId);
    });
    vsbMailRefresh(inst);
};

const vsbOutlookOptions = {
    html(set) {
        return `<div class="vsb-options">
            <div class="group"><div>Show:</div>
                <div><input type="radio" id="vsbOutAll" name="vsbOutShow" value="all"${set.unreadOnly ? '' : ' checked'}><label for="vsbOutAll">All Inbox messages</label></div>
                <div><input type="radio" id="vsbOutUnread" name="vsbOutShow" value="unread"${set.unreadOnly ? ' checked' : ''}><label for="vsbOutUnread">Unread messages only</label></div></div>
        </div>`;
    },
    read(dialog, set) {
        const picked = dialog.querySelector('input[name="vsbOutShow"]:checked');
        return { ...set, unreadOnly: !!picked && picked.value === 'unread' };
    }
};

// ---------------------------------------------------------------- currency, stocks, feed, contacts

const VSB_FX = [
    ['USD', 'US Dollar'], ['EUR', 'Euro'], ['GBP', 'British Pound'], ['JPY', 'Japanese Yen'],
    ['AUD', 'Australian Dollar'], ['BRL', 'Brazilian Real'], ['CAD', 'Canadian Dollar'], ['CHF', 'Swiss Franc'],
    ['CNY', 'Chinese Yuan'], ['CZK', 'Czech Koruna'], ['DKK', 'Danish Krone'], ['HKD', 'Hong Kong Dollar'],
    ['HUF', 'Hungarian Forint'], ['IDR', 'Indonesian Rupiah'], ['ILS', 'Israeli New Shekel'], ['INR', 'Indian Rupee'],
    ['ISK', 'Icelandic Krona'], ['KRW', 'South Korean Won'], ['MXN', 'Mexican Peso'], ['MYR', 'Malaysian Ringgit'],
    ['NOK', 'Norwegian Krone'], ['NZD', 'New Zealand Dollar'], ['PHP', 'Philippine Peso'], ['PLN', 'Polish Zloty'],
    ['RON', 'Romanian Leu'], ['SEK', 'Swedish Krona'], ['SGD', 'Singapore Dollar'], ['THB', 'Thai Baht'],
    ['TRY', 'Turkish Lira'], ['ZAR', 'South African Rand']
];
const VSB_FEED_DEFAULT = 'https://feeds.bbci.co.uk/news/rss.xml';

const vsbFxText = function (n) {
    if (!Number.isFinite(n)) return '--';
    const digits = Math.abs(n) >= 100 ? 2 : 4;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits });
};

const vsbFxMount = function (inst) {
    const box = vsbEl('div', 'vsb-fx', inst.body);
    const amount = vsbEl('input', 'vsb-fx-amount', box);
    amount.type = 'text';
    amount.inputMode = 'decimal';
    amount.maxLength = 16;
    const from = vsbEl('select', 'vsb-fx-code', box);
    const eq = vsbEl('div', 'vsb-fx-eq', box);
    eq.textContent = 'equals';
    const result = vsbEl('div', 'vsb-fx-result', box);
    const to = vsbEl('select', 'vsb-fx-code', box);
    const meta = vsbEl('div', 'vsb-fx-meta', box);
    VSB_FX.forEach(([code, label]) => {
        from.add(new Option(code + '  ' + label, code));
        to.add(new Option(code + '  ' + label, code));
    });
    const savePair = () => {
        inst.g.settings.from = from.value;
        inst.g.settings.to = to.value;
        vsbQueueSave();
        vsbFxPoll(inst);
    };
    from.addEventListener('change', savePair);
    to.addEventListener('change', savePair);
    amount.addEventListener('change', () => {
        const n = Number(String(amount.value).replace(/,/g, ''));
        inst.g.settings.amount = Number.isFinite(n) && n >= 0 && n <= 1e12 ? Math.round(n * 10000) / 10000 : 1;
        amount.value = String(inst.g.settings.amount);
        vsbQueueSave();
        vsbFxPaint(inst);
    });
    inst.parts = { amount, from, to, result, meta };
    inst.refresh = () => vsbFxPoll(inst);
    vsbFxPaint(inst);
    vsbFxPoll(inst);
};

const vsbFxPaint = function (inst) {
    const s = inst.g.settings;
    const p = inst.parts;
    if (document.activeElement !== p.amount) p.amount.value = String(s.amount);
    if (document.activeElement !== p.from) p.from.value = s.from;
    if (document.activeElement !== p.to) p.to.value = s.to;
    const rate = inst.rate && inst.rate.from === s.from && inst.rate.to === s.to ? inst.rate.rate : null;
    p.result.textContent = rate == null ? (inst.rate === false ? 'Not available' : '...') : vsbFxText(s.amount * rate);
    p.meta.textContent = rate == null ? '' : (inst.rate.date || '');
};

const vsbFxPoll = async function (inst) {
    clearTimeout(inst.timer);
    if (inst.destroyed) return;
    const from = inst.g.settings.from;
    const to = inst.g.settings.to;
    try {
        // sidebar_fx: modules/ws/handlers/290-sidebarHandler.js
        const data = await wsClient.sendMessage('sidebar_fx', { from, to }, false);
        if (inst.destroyed || inst.g.settings.from !== from || inst.g.settings.to !== to) return;
        inst.rate = data && data.available ? data : false;
    } catch (_) {
        if (inst.destroyed) return;
        inst.rate = false;
    }
    vsbFxPaint(inst);
    inst.timer = setTimeout(() => vsbFxPoll(inst), 6 * 60 * 60 * 1000);
};

const vsbStockList = function (raw) {
    const symbols = [];
    String(raw || '').split(/[\s,]+/).forEach((part) => {
        const sym = part.trim().toUpperCase();
        if (/^[A-Z0-9.^]{1,12}$/.test(sym) && !symbols.includes(sym) && symbols.length < 4) symbols.push(sym);
    });
    return symbols;
};

const vsbQuotesMount = function (inst) {
    inst.parts = { box: vsbEl('div', 'vsb-quotes', inst.body) };
    inst.quotes = [];
    inst.refresh = () => vsbQuotesPoll(inst);
    vsbQuotesPaint(inst);
    vsbQuotesPoll(inst);
};

const vsbQuotesPaint = function (inst) {
    const symbols = inst.g.settings.symbols || [];
    if (!symbols.length) {
        inst.parts.box.innerHTML = '<div class="vsb-quotes-empty">Add a symbol in Options</div>';
        return;
    }
    const by = new Map((inst.quotes || []).map((q) => [q.symbol, q]));
    inst.parts.box.innerHTML = symbols.map((sym) => {
        const q = by.get(sym);
        if (!q || !q.available) {
            return `<div class="vsb-quote"><span class="vsb-quote-sym">${escapeHtml(sym)}</span><span class="vsb-quote-px">--</span></div>`;
        }
        const chg = q.prev ? (q.price - q.prev) / q.prev * 100 : null;
        const cls = chg == null || Math.abs(chg) < 0.005 ? '' : (chg > 0 ? ' is-up' : ' is-down');
        const chgText = chg == null ? '' : (chg > 0 ? '+' : '') + chg.toFixed(2) + '%';
        return `<div class="vsb-quote" title="${escapeHtmlAttribute(q.name || sym)}">
            <span class="vsb-quote-sym">${escapeHtml(sym)}</span>
            <span class="vsb-quote-px">${escapeHtml(vsbFxText(q.price))}</span>
            <span class="vsb-quote-chg${cls}">${escapeHtml(chgText)}</span></div>`;
    }).join('');
};

const vsbQuotesPoll = async function (inst) {
    clearTimeout(inst.timer);
    if (inst.destroyed) return;
    const symbols = (inst.g.settings.symbols || []).slice();
    if (!symbols.length) {
        inst.quotes = [];
        vsbQuotesPaint(inst);
        return;
    }
    try {
        // sidebar_quotes: modules/ws/handlers/290-sidebarHandler.js
        const data = await wsClient.sendMessage('sidebar_quotes', { symbols }, false);
        if (inst.destroyed) return;
        inst.quotes = (data && data.quotes) || [];
    } catch (_) {
        if (inst.destroyed) return;
        inst.quotes = symbols.map((symbol) => ({ symbol, available: false }));
    }
    vsbQuotesPaint(inst);
    inst.timer = setTimeout(() => vsbQuotesPoll(inst), 3 * 60 * 1000);
};

const vsbQuotesOptions = {
    html(set) {
        return `<div class="vsb-options">
            <div class="group"><label for="vsbStockSymbols">Symbols, separated by commas (up to 4):</label>
                <input type="text" id="vsbStockSymbols" maxlength="60" value="${escapeHtmlAttribute((set.symbols || []).join(', '))}"></div>
        </div>`;
    },
    read(dialog, set) {
        return { ...set, symbols: vsbStockList(dialog.querySelector('#vsbStockSymbols').value) };
    }
};

const vsbFeedMount = function (inst) {
    const box = vsbEl('div', 'vsb-mail', inst.body);
    vsbEl('div', 'vsb-mail-glass', box);
    const head = vsbButton('vsb-mail-head', 'Open this feed', box);
    head.innerHTML = '<span>Feed Headlines</span><span class="vsb-mail-unread"></span>';
    const list = vsbEl('div', 'vsb-mail-list', box);
    const message = vsbEl('div', 'vsb-mail-message hidden', box);
    const nav = vsbEl('div', 'vsb-mail-nav', box);
    const up = vsbButton('vsb-mail-btn vsb-mail-up', 'Previous', nav);
    const pos = vsbEl('span', 'vsb-mail-pos', nav);
    const down = vsbButton('vsb-mail-btn vsb-mail-down', 'Next', nav);
    inst.parts = { box, head, list, message, up, down, pos, title: head.querySelector('span'), host: head.querySelector('.vsb-mail-unread') };
    inst.items = [];
    inst.offset = 0;
    inst.feedTitle = 'Feed Headlines';
    box.style.setProperty('--vsb-mail-n', String(vsbMailCount(inst.g.settings)));
    // openGrimoireUrl: public/scripts/comp/featureLoader.js
    head.addEventListener('click', () => { if (inst.g.settings.url) openGrimoireUrl(inst.g.settings.url); });
    up.addEventListener('click', () => { inst.offset = Math.max(0, inst.offset - vsbMailCount(inst.g.settings)); vsbFeedPaint(inst); });
    down.addEventListener('click', () => { inst.offset += vsbMailCount(inst.g.settings); vsbFeedPaint(inst); });
    list.addEventListener('click', (e) => {
        const row = e.target.closest('[data-feed-link]');
        if (row && row.dataset.feedLink) openGrimoireUrl(row.dataset.feedLink);
    });
    inst.refresh = () => vsbFeedPoll(inst);
    vsbFeedPoll(inst);
};

const vsbFeedPaint = function (inst) {
    const p = inst.parts;
    const size = vsbMailCount(inst.g.settings);
    p.box.style.setProperty('--vsb-mail-n', String(size));
    p.title.textContent = inst.feedTitle || 'Feed Headlines';
    let host = '';
    try { host = inst.g.settings.url ? new URL(inst.g.settings.url).hostname.replace(/^www\./, '') : ''; } catch (_) { host = ''; }
    p.host.textContent = host;
    const total = inst.items.length;
    inst.offset = Math.max(0, Math.min(inst.offset, Math.max(0, total - 1) - (Math.max(0, total - 1) % size)));
    if (!inst.g.settings.url || inst.error || !total) {
        p.list.innerHTML = '';
        p.message.textContent = !inst.g.settings.url ? 'Set a feed address in Options' : (inst.error ? 'Feed is not available' : 'No headlines');
        p.message.classList.remove('hidden');
    } else {
        p.message.classList.add('hidden');
        p.list.innerHTML = inst.items.slice(inst.offset, inst.offset + size).map((item) => `
            <button type="button" class="vsb-mail-item" data-feed-link="${escapeHtmlAttribute(item.link || '')}" title="${escapeHtmlAttribute(item.title)}">
                <span class="vsb-mail-subject">${escapeHtml(item.title)}</span>
                <span class="vsb-mail-meta"><span class="vsb-mail-date">${escapeHtml(item.date ? vsbMailDate(item.date) : '')}</span></span>
            </button>`).join('');
    }
    p.pos.textContent = total ? `${inst.offset + 1}-${Math.min(total, inst.offset + size)}/${total}` : '0';
    p.up.disabled = inst.offset === 0;
    p.down.disabled = inst.offset + size >= total;
};

const vsbFeedApply = function (inst) {
    if (inst.loadedUrl !== inst.g.settings.url) vsbFeedPoll(inst);
    else vsbFeedPaint(inst);
};

const vsbFeedPoll = async function (inst) {
    clearTimeout(inst.timer);
    if (inst.destroyed) return;
    const url = inst.g.settings.url;
    inst.loadedUrl = url;
    if (!url) {
        inst.items = [];
        inst.error = false;
        inst.feedTitle = 'Feed Headlines';
        vsbFeedPaint(inst);
        return;
    }
    try {
        // sidebar_feed: modules/ws/handlers/290-sidebarHandler.js
        const data = await wsClient.sendMessage('sidebar_feed', { url }, false);
        if (inst.destroyed || inst.g.settings.url !== url) return;
        inst.error = !data || !data.available;
        inst.items = (data && data.items) || [];
        inst.feedTitle = (data && data.title) || 'Feed Headlines';
    } catch (_) {
        if (inst.destroyed || inst.g.settings.url !== url) return;
        inst.error = true;
    }
    vsbFeedPaint(inst);
    inst.timer = setTimeout(() => vsbFeedPoll(inst), 10 * 60 * 1000);
};

const vsbFeedOptions = {
    html(set) {
        const count = vsbMailCount(set);
        return `<div class="vsb-options">
            <div class="group"><label for="vsbFeedUrl">Feed address:</label>
                <input type="url" id="vsbFeedUrl" maxlength="300" value="${escapeHtmlAttribute(set.url || '')}"></div>
            <div class="group"><label for="vsbFeedCount">Headlines to show:</label>
                <select id="vsbFeedCount">${vsbOptions([3, 4, 5, 6].map((n) => [n, String(n)]), count)}</select></div>
        </div>`;
    },
    read(dialog, set) {
        const count = Number(dialog.querySelector('#vsbFeedCount').value);
        return { ...set, url: dialog.querySelector('#vsbFeedUrl').value.trim(), count: count >= 3 && count <= 6 ? count : 3 };
    }
};

const vsbPeopleMount = function (inst) {
    const box = vsbEl('div', 'vsb-people', inst.body);
    const name = vsbEl('div', 'vsb-people-name', box);
    const email = vsbButton('vsb-people-mail', 'Send mail', box);
    const phone = vsbEl('div', 'vsb-people-phone', box);
    const nav = vsbEl('div', 'vsb-people-nav', box);
    const prev = vsbButton('vsb-options-arrow', 'Previous', nav);
    const pos = vsbEl('span', 'vsb-people-pos', nav);
    const next = vsbButton('vsb-options-arrow vsb-options-arrow-next', 'Next', nav);
    inst.parts = { name, email, phone, prev, next, pos };
    const go = (delta) => {
        const s = inst.g.settings;
        s.current = Math.max(0, Math.min(s.cards.length - 1, (s.current || 0) + delta));
        vsbPeoplePaint(inst);
        vsbQueueSave();
    };
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    // doveOpenCompose: public/scripts/comp/desktop-apps/dovecote.js
    email.addEventListener('click', () => {
        const card = inst.g.settings.cards[inst.g.settings.current];
        if (card && card.email) doveOpenCompose('create', null, card.email);
    });
    vsbPeoplePaint(inst);
};

const vsbPeoplePaint = function (inst) {
    const s = inst.g.settings;
    const cards = s.cards && s.cards.length ? s.cards : [{ name: '', email: '', phone: '' }];
    s.current = Math.max(0, Math.min(cards.length - 1, s.current || 0));
    const card = cards[s.current];
    const p = inst.parts;
    p.name.textContent = card.name || 'No name';
    p.name.classList.toggle('is-empty', !card.name);
    p.email.textContent = card.email || 'No e-mail';
    p.email.disabled = !card.email;
    p.phone.textContent = card.phone || '';
    p.phone.classList.toggle('hidden', !card.phone);
    p.pos.textContent = (s.current + 1) + ' / ' + cards.length;
    p.prev.disabled = s.current === 0;
    p.next.disabled = s.current >= cards.length - 1;
    p.prev.classList.toggle('is-disabled', p.prev.disabled);
    p.next.classList.toggle('is-disabled', p.next.disabled);
};

let vsbPeopleDraft = null;

const vsbPeopleFields = function () {
    const d = vsbPeopleDraft;
    const card = d.cards[d.current] || { name: '', email: '', phone: '' };
    return `<div class="group"><label for="vsbPeopleName">Name:</label>
            <input type="text" id="vsbPeopleName" maxlength="40" value="${escapeHtmlAttribute(card.name)}"></div>
        <div class="group"><label for="vsbPeopleEmail">E-mail:</label>
            <input type="text" id="vsbPeopleEmail" maxlength="80" value="${escapeHtmlAttribute(card.email)}"></div>
        <div class="group"><label for="vsbPeoplePhone">Phone:</label>
            <input type="text" id="vsbPeoplePhone" maxlength="24" value="${escapeHtmlAttribute(card.phone)}"></div>
        <div class="vsb-options-preview">
            <span class="vsb-options-arrow${d.current === 0 ? ' is-disabled' : ''}" id="vsbPeoplePrev" title="Previous"></span>
            <span id="vsbPeopleCount">${d.current + 1} of ${d.cards.length}</span>
            <span class="vsb-options-arrow vsb-options-arrow-next${d.current >= d.cards.length - 1 ? ' is-disabled' : ''}" id="vsbPeopleNext" title="Next"></span>
        </div>
        <div>
            <button type="button" class="btn-standard" id="vsbPeopleAdd"${d.cards.length >= 8 ? ' disabled' : ''}>Add</button>
            <button type="button" class="btn-standard" id="vsbPeopleRemove">Remove</button>
        </div>`;
};

const vsbPeopleReadFields = function (dialog) {
    const card = vsbPeopleDraft && vsbPeopleDraft.cards[vsbPeopleDraft.current];
    const name = dialog.querySelector('#vsbPeopleName');
    if (!card || !name) return;
    card.name = name.value.slice(0, 40);
    card.email = dialog.querySelector('#vsbPeopleEmail').value.slice(0, 80);
    card.phone = dialog.querySelector('#vsbPeoplePhone').value.slice(0, 24);
};

const vsbPeopleOptions = {
    html(set) {
        const cards = (set.cards || []).map((c) => ({ name: c.name || '', email: c.email || '', phone: c.phone || '' }));
        if (!cards.length) cards.push({ name: '', email: '', phone: '' });
        vsbPeopleDraft = { cards, current: Math.max(0, Math.min(cards.length - 1, set.current || 0)) };
        return `<div class="vsb-options" id="vsbPeopleForm">${vsbPeopleFields()}</div>`;
    },
    ready(dialog) {
        const root = () => dialog.querySelector('#vsbPeopleForm');
        const paint = () => { root().innerHTML = vsbPeopleFields(); wire(); };
        const wire = () => {
            const form = root();
            form.querySelector('#vsbPeoplePrev').addEventListener('click', () => {
                if (vsbPeopleDraft.current === 0) return;
                vsbPeopleReadFields(dialog);
                vsbPeopleDraft.current -= 1;
                paint();
            });
            form.querySelector('#vsbPeopleNext').addEventListener('click', () => {
                if (vsbPeopleDraft.current >= vsbPeopleDraft.cards.length - 1) return;
                vsbPeopleReadFields(dialog);
                vsbPeopleDraft.current += 1;
                paint();
            });
            form.querySelector('#vsbPeopleAdd').addEventListener('click', () => {
                if (vsbPeopleDraft.cards.length >= 8) return;
                vsbPeopleReadFields(dialog);
                vsbPeopleDraft.cards.push({ name: '', email: '', phone: '' });
                vsbPeopleDraft.current = vsbPeopleDraft.cards.length - 1;
                paint();
            });
            form.querySelector('#vsbPeopleRemove').addEventListener('click', () => {
                vsbPeopleDraft.cards.splice(vsbPeopleDraft.current, 1);
                if (!vsbPeopleDraft.cards.length) vsbPeopleDraft.cards.push({ name: '', email: '', phone: '' });
                vsbPeopleDraft.current = Math.min(vsbPeopleDraft.current, vsbPeopleDraft.cards.length - 1);
                paint();
            });
        };
        wire();
    },
    read(dialog, set) {
        vsbPeopleReadFields(dialog);
        const cards = vsbPeopleDraft.cards
            .filter((c) => c.name.trim() || c.email.trim() || c.phone.trim())
            .map((c) => ({ name: c.name.trim(), email: c.email.trim(), phone: c.phone.trim() }));
        if (!cards.length) cards.push({ name: '', email: '', phone: '' });
        return { ...set, cards, current: Math.max(0, Math.min(cards.length - 1, vsbPeopleDraft.current)) };
    }
};

// ---------------------------------------------------------------- gadget hooks

Object.assign(VSB_GADGETS.calendar, { mount: vsbCalendarMount, apply: vsbCalendarApply });
Object.assign(VSB_GADGETS.calculator, { mount: vsbCalcMount, apply: vsbCalcPaint, form: vsbCalcOptions });
Object.assign(VSB_GADGETS.clipboard, { mount: vsbClipMount, apply: vsbClipApply });
Object.assign(VSB_GADGETS.clock, { mount: vsbClockMount, apply: vsbClockApply, form: vsbClockOptions });
Object.assign(VSB_GADGETS.contacts, { mount: vsbPeopleMount, apply: vsbPeoplePaint, form: vsbPeopleOptions });
Object.assign(VSB_GADGETS.cpu, { mount: vsbCpuMount, apply: vsbCpuApply });
Object.assign(VSB_GADGETS.currency, { mount: vsbFxMount, apply: vsbFxPaint, menu: [{ text: 'Refresh', action: 'vsb-refresh' }] });
Object.assign(VSB_GADGETS.deskcalc, { mount: vsbDeskMount, apply: vsbDeskPaint, form: vsbDeskOptions });
Object.assign(VSB_GADGETS.feed, {
    mount: vsbFeedMount,
    apply: vsbFeedApply,
    form: vsbFeedOptions,
    menu: [{ text: 'Refresh', action: 'vsb-refresh' }]
});
Object.assign(VSB_GADGETS.hero, { mount: vsbClockMount, apply: vsbClockApply, form: vsbClockOptions });
Object.assign(VSB_GADGETS.mail, {
    mount: vsbMailMount,
    apply: (inst) => vsbMailRefresh(inst),
    form: vsbMailOptions,
    menu: [{ text: 'Open Dovecote', action: 'vsb-mail-open' }, { text: 'Refresh', action: 'vsb-mail-refresh' }]
});
Object.assign(VSB_GADGETS.notes, { mount: vsbNotesMount, apply: vsbNotesApply, form: vsbNotesOptions });
Object.assign(VSB_GADGETS.outlook, { mount: vsbOutlookMount, apply: (inst) => vsbMailRefresh(inst), form: vsbOutlookOptions });
Object.assign(VSB_GADGETS.puzzle, {
    mount: vsbPuzzleMount,
    apply: vsbPuzzleApply,
    form: vsbSourceOptions,
    menu: [{ text: 'New Picture', action: 'vsb-puzzle-new' }]
});
Object.assign(VSB_GADGETS.stocks, {
    mount: vsbQuotesMount,
    apply: (inst) => { vsbQuotesPaint(inst); vsbQuotesPoll(inst); },
    form: vsbQuotesOptions,
    menu: [{ text: 'Refresh', action: 'vsb-refresh' }]
});
Object.assign(VSB_GADGETS.slideshow, {
    mount: vsbSlideMount,
    apply: vsbSlideApply,
    form: vsbSlideOptions,
    menu: vsbSlideMenu
});
Object.assign(VSB_GADGETS.weather, { mount: vsbWeatherMount, apply: vsbWeatherApply, form: vsbWeatherOptions });
Object.assign(VSB_GADGETS.timer, { mount: vsbTimerMount, apply: vsbTimerApply });

// ---------------------------------------------------------------- instances

const vsbIsShown = function (inst) {
    return !!(vsb.state && vsb.state.enabled && !inst.el.classList.contains('hidden') && !(inst.g.docked && vsb.state.closed));
};

const vsbCreateInstance = function (g) {
    const def = VSB_GADGETS[g.type];
    const el = vsbEl('div', 'vsb-gadget');
    el.dataset.type = g.type;
    el.dataset.gadgetId = g.id;
    const body = vsbEl('div', 'vsb-gadget-body', el);
    const tools = vsbEl('div', 'vsb-gadget-tools', el);
    const close = vsbButton('vsb-tool vsb-tool-close', 'Close', tools);
    if (def.form) vsbButton('vsb-tool vsb-tool-options', 'Options', tools);
    const grip = vsbEl('span', 'vsb-tool vsb-tool-grip', tools);
    grip.title = 'Drag gadget';
    const inst = { g, def, el, body, timer: null, destroyed: false };
    el.dataset.docked = g.docked ? '1' : '0';
    close.addEventListener('click', () => vsbRemoveGadget(g.id));
    tools.addEventListener('click', (e) => {
        if (e.target.closest('.vsb-tool-options')) vsbOpenOptions(inst, e);
    });
    el.addEventListener('pointerdown', (e) => vsbDragStart(e, inst));
    // contextMenu.attachToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachToElement(el, vsbGadgetMenuConfig);
    def.mount(inst);
    return inst;
};

const vsbDestroyInstance = function (inst) {
    if (inst.notionDirty) {
        clearTimeout(inst.notionTimer);
        vsbNotesSaveLinked(inst);
    }
    inst.destroyed = true;
    clearTimeout(inst.timer);
    clearInterval(inst.timer);
    if (inst.sounds) Object.values(inst.sounds).forEach((audio) => audio.pause());
    if (vsb.flyout && vsb.flyout.inst === inst) vsbCloseFlyout();
    contextMenu.detachFromElement(inst.el);
    inst.el.remove();
};

const vsbSetSettings = function (inst, patch) {
    Object.assign(inst.g.settings, patch);
    inst.def.apply(inst);
    vsbQueueSave();
    vsbPaginate();
};

const vsbOpenOptions = async function (inst, event) {
    const form = inst.def.form;
    if (!form) return;
    const settings = inst.g.settings;
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    const next = await showConfirmationDialog(form.html(settings, inst), [
        { text: 'OK', value: true, className: 'btn-standard primary' },
        { text: 'Cancel', value: false, className: 'btn-standard' }
    ], event, {
        title: inst.def.title,
        icon: 'fas fa-gear',
        width: 320,
        showCloseButton: false,
        // onDialogReady gets the listener AbortSignal, not the dialog
        onDialogReady: () => { if (form.ready) form.ready(document.getElementById('confirmationDialog'), settings, inst); },
        resolveValue: (value, dialog) => (value ? form.read(dialog, settings) : null)
    });
    if (!next || inst.destroyed) return;
    vsbSetSettings(inst, next);
};

// ---------------------------------------------------------------- render

const vsbBuildRoot = function () {
    const root = vsbEl('div', 'vsb hidden');
    root.id = 'vistaSidebar';
    const pane = vsbEl('div', 'vsb-pane', root);
    const bar = vsbEl('div', 'vsb-bar', pane);
    const add = vsbButton('vsb-bar-btn vsb-bar-add', 'Add Gadgets', bar);
    vsbEl('span', 'vsb-bar-divider', bar);
    const prev = vsbButton('vsb-bar-btn vsb-bar-prev', 'Previous', bar);
    const next = vsbButton('vsb-bar-btn vsb-bar-next', 'Next', bar);
    const dock = vsbEl('div', 'vsb-dock', pane);
    add.addEventListener('click', () => openVistaGadgetGallery());
    prev.addEventListener('click', () => { vsb.page = Math.max(0, vsb.page - 1); vsbPaginate(); });
    next.addEventListener('click', () => { vsb.page = Math.min(vsb.pages - 1, vsb.page + 1); vsbPaginate(); });
    contextMenu.attachToElement(pane, vsbPaneMenuConfig);
    const icons = document.getElementById('desktopIcons');
    if (icons) icons.after(root);
    else document.body.appendChild(root);
    Object.assign(vsb, { root, pane, dock, prevBtn: prev, nextBtn: next });
    new ResizeObserver(() => vsbPaginate()).observe(pane);
    window.addEventListener('resize', () => vsbClampDesktopGadgets());
    document.addEventListener('copy', vsbClipOnCopy);
    document.addEventListener('pointerdown', (e) => {
        if (vsb.flyout && !e.target.closest('.vsb-flyout, .vsb-slide-view')) vsbCloseFlyout();
        if (root.classList.contains('vsb-raised') && !e.target.closest('#vistaSidebar, #vistaSidebarTrayIcon')) root.classList.remove('vsb-raised');
    }, true);
};

const vsbRender = function () {
    const state = vsb.state;
    if (!vsb.root) vsbBuildRoot();
    const on = !!(state && state.enabled);
    vsb.root.classList.toggle('hidden', !on);
    vsbSyncTray();
    if (!on) {
        vsb.instances.forEach(vsbDestroyInstance);
        vsb.instances.clear();
        vsbCloseFlyout();
        return;
    }
    vsb.root.dataset.side = state.side;
    vsb.root.toggleAttribute('data-closed', !!state.closed);
    vsb.pane.classList.toggle('is-on-top', !!state.onTop);

    const live = new Set();
    state.gadgets.forEach((g) => {
        live.add(g.id);
        let inst = vsb.instances.get(g.id);
        if (inst && inst.g.type !== g.type) {
            vsbDestroyInstance(inst);
            inst = null;
        }
        if (!inst) {
            inst = vsbCreateInstance(g);
            vsb.instances.set(g.id, inst);
        } else if (inst.g !== g || inst.el.dataset.docked !== (g.docked ? '1' : '0')) {
            inst.g = g;
            inst.el.dataset.docked = g.docked ? '1' : '0';
            inst.def.apply(inst);
        }
        inst.el.dataset.docked = g.docked ? '1' : '0';
        inst.el.classList.toggle('is-on-top', !g.docked && g.onTop);
        inst.el.style.setProperty('--vsb-opacity', g.docked ? '1' : String(g.opacity / 100));
        if (g.docked) {
            inst.el.style.left = '';
            inst.el.style.top = '';
            vsb.dock.appendChild(inst.el);
        } else {
            inst.el.style.left = g.x + 'px';
            inst.el.style.top = g.y + 'px';
            if (inst.el.parentNode !== vsb.root) vsb.root.appendChild(inst.el);
        }
    });
    vsb.instances.forEach((inst, id) => {
        if (!live.has(id)) {
            vsbDestroyInstance(inst);
            vsb.instances.delete(id);
        }
    });
    vsbClampDesktopGadgets();
    vsbPaginate();
};

const vsbPaginate = function () {
    if (!vsb.dock || !vsb.state || !vsb.state.enabled) return;
    const docked = vsb.state.gadgets.filter((g) => g.docked).map((g) => vsb.instances.get(g.id)).filter(Boolean);
    const room = Math.max(1, vsb.pane.clientHeight - vsb.dock.offsetTop - VSB_DOCK_GAP);
    let page = 0;
    let used = 0;
    const pageOf = new Map();
    docked.forEach((inst) => {
        inst.el.classList.remove('hidden');
        const h = inst.el.offsetHeight + VSB_DOCK_GAP;
        if (used > 0 && used + h > room) {
            page += 1;
            used = 0;
        }
        used += h;
        pageOf.set(inst, page);
    });
    vsb.pages = page + 1;
    vsb.page = Math.min(vsb.page, vsb.pages - 1);
    docked.forEach((inst) => inst.el.classList.toggle('hidden', pageOf.get(inst) !== vsb.page));
    vsb.prevBtn.disabled = vsb.page === 0;
    vsb.nextBtn.disabled = vsb.page >= vsb.pages - 1;
};

const vsbClampDesktopGadgets = function () {
    // public/scripts/comp/modalUtils.js
    const area = getModalWorkAreaBounds();
    vsb.instances.forEach((inst) => {
        if (inst.g.docked) return;
        const w = inst.el.offsetWidth || 150;
        const h = inst.el.offsetHeight || 100;
        inst.el.style.left = Math.max(0, Math.min(inst.g.x, area.right - w)) + 'px';
        inst.el.style.top = Math.max(area.top, Math.min(inst.g.y, area.bottom - h)) + 'px';
    });
};

// ---------------------------------------------------------------- state

const vsbMarkDesktopSync = function (state) {
    // desktopShortcuts: public/scripts/comp/desktopShortcuts.js
    if (!desktopShortcuts) return;
    if (state === 'pending') {
        desktopShortcuts.updateSaveTrayIndicator('pending');
        return;
    }
    if (desktopShortcuts.hasPendingDesktopChanges()) {
        desktopShortcuts.refreshSaveTrayIndicator();
        return;
    }
    desktopShortcuts.updateSaveTrayIndicator(state);
};

const vsbQueueSave = function () {
    clearTimeout(vsb.saveTimer);
    vsb.saveWorkspaceId = vsb.workspaceId;
    vsbMarkDesktopSync('pending');
    vsb.saveTimer = setTimeout(vsbFlushSave, VSB_SAVE_DELAY_MS);
};

const vsbFlushSave = async function () {
    clearTimeout(vsb.saveTimer);
    vsb.saveTimer = null;
    const workspaceId = vsb.saveWorkspaceId;
    if (!workspaceId || !vsb.state) return;
    vsb.saveWorkspaceId = null;
    try {
        // sidebar_save: modules/ws/handlers/290-sidebarHandler.js
        await wsClient.sendMessage('sidebar_save', { workspaceId, sidebar: vsb.state }, false);
        vsb.saved = true;
        if (!vsb.saveTimer) vsbMarkDesktopSync('saved');
    } catch (error) {
        console.warn('[sidebar] save failed:', error);
        vsb.saveWorkspaceId = workspaceId;
        vsbMarkDesktopSync('pending');
        if (!vsb.saveRetry) {
            vsb.saveRetry = true;
            vsb.saveTimer = setTimeout(() => {
                vsb.saveRetry = false;
                vsbFlushSave();
            }, 2000);
        }
    }
};

const vsbLoad = async function (workspaceId) {
    if (vsb.saveTimer) await vsbFlushSave();
    const seq = ++vsb.loadSeq;
    try {
        // sidebar_get: modules/ws/handlers/290-sidebarHandler.js
        const data = await wsClient.sendMessage('sidebar_get', { workspaceId }, false);
        if (seq !== vsb.loadSeq || !data) return;
        vsb.workspaceId = data.workspaceId;
        vsb.state = data.sidebar;
        vsb.saved = !!data.saved;
        vsb.page = 0;
        vsb.instances.forEach(vsbDestroyInstance);
        vsb.instances.clear();
        vsbRender();
    } catch (error) {
        console.warn('[sidebar] load failed:', error);
    }
};

const vsbMutate = function (fn) {
    fn(vsb.state);
    vsbRender();
    vsbQueueSave();
};

const vsbNewGadget = function (type, docked, x, y) {
    return { id: vsbNewId(), type, docked, x: Math.round(x || 0), y: Math.round(y || 0), onTop: false, opacity: 100, settings: vsbDefaultSettings(type) };
};

const vsbDefaultSettings = function (type) {
    switch (type) {
        case 'clock':
        case 'hero': return { theme: 0, name: '', timeZone: '', seconds: false };
        case 'calculator': return { ...vsbCalcDefaults(), color: 'grey', historyOn: true };
        case 'deskcalc': return { ...vsbCalcDefaults(), color: 'plain', angles: 'deg' };
        case 'timer': return { endAt: 0, mins: 0, secs: 0, ringing: false };
        case 'clipboard': return { items: [] };
        case 'outlook': return { unreadOnly: false };
        case 'contacts': return { cards: [{ name: '', email: '', phone: '' }], current: 0 };
        case 'currency': return { amount: 1, from: 'USD', to: 'EUR' };
        case 'feed': return { url: VSB_FEED_DEFAULT, count: 3 };
        case 'stocks': return { symbols: ['MSFT'] };
        case 'calendar': return { view: 'day' };
        case 'notes': return { color: 'yellow', font: 'Segoe Print', size: 12, readOnly: false, notes: [''], current: 0 };
        case 'puzzle': return { source: 'images', base: '', tiles: null, seconds: 0 };
        case 'slideshow': return { source: 'images', seconds: 15, transition: 'none', shuffle: true, scale: 1, search: null, shape: 'landscape' };
        case 'weather': return { unit: 'F', feelsLike: false, hidePlace: false, placeAlt: 'none' };
        case 'mail': return { unreadOnly: false, count: 3 };
        default: return {};
    }
};

const vsbAddGadget = function (type, options) {
    const opts = options || {};
    if (!vsb.state) return;
    if (vsb.state.gadgets.length >= 24) {
        showGlassToast('warning', 'Melaton Sidebar', 'The Sidebar is full. Close a gadget first.', false, 5000);
        return;
    }
    vsbMutate((state) => {
        state.enabled = true;
        const g = vsbNewGadget(type, opts.docked !== false, opts.x, opts.y);
        if (g.docked) {
            state.closed = false;
            state.gadgets.unshift(g);
            vsb.page = 0;
        } else {
            state.gadgets.push(g);
        }
    });
};

const vsbRemoveGadget = function (id) {
    vsbMutate((state) => {
        state.gadgets = state.gadgets.filter((g) => g.id !== id);
    });
};

const vsbPatchGadget = function (id, patch) {
    vsbMutate((state) => {
        const g = state.gadgets.find((x) => x.id === id);
        if (g) Object.assign(g, patch);
    });
};

/** Start menu > Accessories > Windows Sidebar, and the tray icon's Open. */
function openVistaSidebar() {
    if (!vsb.state) return;
    vsbMutate((state) => {
        if (!state.enabled && !vsb.saved && !state.gadgets.length) {
            state.gadgets = VSB_DEFAULT_GADGETS.map((type) => vsbNewGadget(type, true));
        }
        state.enabled = true;
        state.closed = false;
    });
    vsb.root.classList.add('vsb-raised');
}

// ---------------------------------------------------------------- drag

const vsbDragStart = function (e, inst) {
    if (e.button !== 0 || vsb.drag) return;
    const onGrip = !!e.target.closest('.vsb-tool-grip');
    if (!onGrip && e.target.closest('button, input, textarea, select, a, .vsb-puzzle-pad, .vsb-timer-hit')) return;
    vsb.drag = { inst, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, moving: false };
    const move = (ev) => vsbDragMove(ev);
    const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        vsbDragEnd(ev);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
};

const vsbDragMove = function (e) {
    const d = vsb.drag;
    if (!d) return;
    if (!d.moving) {
        if (Math.abs(e.clientX - d.startX) < VSB_DRAG_THRESHOLD && Math.abs(e.clientY - d.startY) < VSB_DRAG_THRESHOLD) return;
        const rect = d.inst.el.getBoundingClientRect();
        d.moving = true;
        d.offsetX = d.startX - rect.left;
        d.offsetY = d.startY - rect.top;
        d.wasDocked = d.inst.g.docked;
        if (d.wasDocked) {
            d.placeholder = vsbEl('div', 'vsb-placeholder');
            d.placeholder.style.height = rect.height + 'px';
            d.inst.el.after(d.placeholder);
        }
        d.inst.el.classList.add('is-dragging');
        vsb.root.appendChild(d.inst.el);
        vsbCloseFlyout();
    }
    e.preventDefault();
    d.inst.el.style.left = (e.clientX - d.offsetX) + 'px';
    d.inst.el.style.top = (e.clientY - d.offsetY) + 'px';
    vsbDragPlace(e.clientX, e.clientY, d);
};

/** Over the pane: a placeholder shows where the gadget would dock. */
const vsbDragPlace = function (x, y, d) {
    const r = vsb.pane.getBoundingClientRect();
    const over = !vsb.state.closed && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (!over) {
        if (d.placeholder) d.placeholder.remove();
        return;
    }
    if (!d.placeholder) {
        d.placeholder = vsbEl('div', 'vsb-placeholder');
        d.placeholder.style.height = Math.min(140, d.inst.el.offsetHeight) + 'px';
    }
    const visible = Array.from(vsb.dock.children).filter((c) => c !== d.placeholder && !c.classList.contains('hidden'));
    const before = visible.find((c) => {
        const cr = c.getBoundingClientRect();
        return y < cr.top + cr.height / 2;
    });
    if (before) vsb.dock.insertBefore(d.placeholder, before);
    else if (visible.length) visible[visible.length - 1].after(d.placeholder);
    else vsb.dock.appendChild(d.placeholder);
};

const vsbDragEnd = function () {
    const d = vsb.drag;
    vsb.drag = null;
    if (!d || !d.moving) return;
    // the click that ends a drag is not a click on the gadget
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', swallow, true);
    setTimeout(() => document.removeEventListener('click', swallow, true), 0);
    const el = d.inst.el;
    el.classList.remove('is-dragging');
    const g = d.inst.g;
    const docked = !!(d.placeholder && d.placeholder.parentNode);
    if (docked) {
        d.placeholder.replaceWith(el);
        g.docked = true;
        const order = Array.from(vsb.dock.querySelectorAll(':scope > .vsb-gadget')).map((c) => c.dataset.gadgetId);
        vsb.state.gadgets.sort((a, b) => {
            const ia = a.docked ? order.indexOf(a.id) : Infinity;
            const ib = b.docked ? order.indexOf(b.id) : Infinity;
            return ia - ib;
        });
    } else {
        if (d.placeholder) d.placeholder.remove();
        const rect = el.getBoundingClientRect();
        g.docked = false;
        g.x = Math.max(0, Math.round(rect.left));
        g.y = Math.max(0, Math.round(rect.top));
    }
    if (g.docked !== d.wasDocked) {
        el.dataset.docked = g.docked ? '1' : '0';
        d.inst.def.apply(d.inst);
    }
    vsbRender();
    vsbQueueSave();
};

// ---------------------------------------------------------------- menus

const vsbPaneMenuConfig = {
    sections: [],
    beforeShow: () => {
        vsbPaneMenuConfig.sections = [{
            type: 'list',
            items: [
                { text: 'Add Gadgets...', icon: 'fas fa-plus', action: 'vsb-add' },
                { separator: true },
                { text: 'Properties', icon: 'fas fa-sliders', action: 'vsb-properties' },
                { text: 'Close Sidebar', icon: 'fas fa-xmark', action: 'vsb-close' }
            ]
        }];
    },
    onAction: (action, target, item, event) => vsbHandleMenuAction(action, null, event)
};

const vsbGadgetMenuConfig = {
    sections: [],
    beforeShow: (event, target) => {
        const el = (event && event.target.closest('.vsb-gadget')) || target;
        const inst = el ? vsb.instances.get(el.dataset.gadgetId) : null;
        vsbGadgetMenuConfig.target = inst;
        if (!inst) {
            vsbGadgetMenuConfig.sections = [];
            return;
        }
        const g = inst.g;
        const items = [{ text: 'Add Gadgets...', icon: 'fas fa-plus', action: 'vsb-add' }];
        // a gadget menu is a fixed list, or built per picture (vsbSlideMenu)
        const menu = inst.def.menu || [];
        (Array.isArray(menu) ? menu : menu(inst)).forEach((m) => items.push(m));
        items.push({ separator: true });
        items.push({ text: g.docked ? 'Detach from Sidebar' : 'Attach to Sidebar', action: g.docked ? 'vsb-detach' : 'vsb-attach' });
        if (!g.docked) {
            items.push({ text: 'Always on Top', action: 'vsb-on-top', showIndicator: true, checked: !!g.onTop });
            items.push({
                text: 'Opacity',
                submenu: [20, 40, 60, 80, 100].map((v) => ({ text: v + '%', action: 'vsb-opacity', vsbOpacity: v, showIndicator: true, indicatorMark: 'radio', checked: g.opacity === v }))
            });
        }
        if (inst.def.form) items.push({ text: 'Options', icon: 'fas fa-gear', action: 'vsb-options' });
        items.push({ separator: true });
        items.push({ text: 'Close Gadget', icon: 'fas fa-xmark', action: 'vsb-remove' });
        vsbGadgetMenuConfig.sections = [{ type: 'list', items }];
    },
    onAction: (action, target, item, event) => vsbHandleMenuAction(action, vsbGadgetMenuConfig.target, event, item)
};

const vsbHandleMenuAction = function (action, inst, event, item) {
    switch (action) {
        case 'vsb-add': openVistaGadgetGallery(); break;
        case 'vsb-properties': vsbOpenProperties(event); break;
        case 'vsb-close': vsbMutate((s) => { s.closed = true; }); break;
        case 'vsb-open': openVistaSidebar(); break;
        case 'vsb-front': vsb.root.classList.add('vsb-raised'); break;
        case 'vsb-exit': vsbMutate((s) => { s.enabled = false; }); break;
        default: break;
    }
    if (!inst) return;
    const g = inst.g;
    switch (action) {
        case 'vsb-detach': {
            const rect = inst.el.getBoundingClientRect();
            const x = vsb.state.side === 'right' ? rect.left - 220 : rect.right + 40;
            vsbPatchGadget(g.id, { docked: false, x: Math.max(0, x), y: Math.max(0, rect.top) });
            break;
        }
        case 'vsb-attach': vsbMutate((s) => { g.docked = true; s.closed = false; }); break;
        case 'vsb-on-top': vsbPatchGadget(g.id, { onTop: !g.onTop }); break;
        case 'vsb-opacity': if (item && item.vsbOpacity) vsbPatchGadget(g.id, { opacity: item.vsbOpacity }); break;
        case 'vsb-options': vsbOpenOptions(inst, event); break;
        case 'vsb-remove': vsbRemoveGadget(g.id); break;
        case 'vsb-mail-open': openDesktopDovecote(); break;
        case 'vsb-mail-refresh': vsbMailRefresh(inst); break;
        case 'vsb-refresh': if (inst.refresh) inst.refresh(); break;
        case 'vsb-puzzle-new': vsbPuzzleNewPicture(inst); break;
        case 'vsb-slide-next': vsbSlideStep(inst, 1); break;
        case 'vsb-slide-prev': vsbSlideStep(inst, -1); break;
        case 'vsb-slide-goto':
        case 'vsb-slide-studio':
        case 'vsb-slide-properties':
        case 'vsb-slide-favorite': vsbSlidePhotoAction(inst, action, event); break;
        default: break;
    }
};

const vsbOpenProperties = async function (event) {
    const s = vsb.state;
    const running = s.gadgets.map((g) => VSB_GADGETS[g.type].title);
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    const result = await showConfirmationDialog(`<div class="vsb-options vsb-properties">
        <fieldset><legend>Arrangement</legend>
            <div><input type="checkbox" id="vsbPropOnTop"${s.onTop ? ' checked' : ''}><label for="vsbPropOnTop">Sidebar is always on top of other windows</label></div>
            <div>Display Sidebar on this side of screen:</div>
            <div><input type="radio" id="vsbPropSideRight" name="vsbPropSide" value="right"${s.side === 'right' ? ' checked' : ''}><label for="vsbPropSideRight">Right</label></div>
            <div><input type="radio" id="vsbPropSideLeft" name="vsbPropSide" value="left"${s.side === 'left' ? ' checked' : ''}><label for="vsbPropSideLeft">Left</label></div></fieldset>
        <fieldset><legend>Maintenance</legend>
            <div>Running gadgets (${running.length}):</div>
            <div class="vsb-properties-list">${running.length ? escapeHtml(running.join(', ')) : 'None'}</div></fieldset>
    </div>`, [
        { text: 'OK', value: true, className: 'btn-standard primary' },
        { text: 'Cancel', value: false, className: 'btn-standard' }
    ], event, {
        title: 'Melaton Sidebar Properties',
        icon: 'fas fa-sliders',
        width: 360,
        showCloseButton: false,
        resolveValue: (value, dialog) => (value ? {
            onTop: dialog.querySelector('#vsbPropOnTop').checked,
            side: (dialog.querySelector('input[name="vsbPropSide"]:checked') || {}).value || s.side
        } : null)
    });
    if (result) vsbMutate((state) => Object.assign(state, result));
};

// ---------------------------------------------------------------- tray

const vsbSyncTray = function () {
    const icon = vsb.trayIcon || document.getElementById('vistaSidebarTrayIcon');
    if (!icon) return;
    if (!vsb.trayIcon) {
        vsb.trayIcon = icon;
        icon.addEventListener('click', () => openVistaSidebar());
        contextMenu.attachToElement(icon, {
            sections: [{
                type: 'list',
                items: [
                    { text: 'Open', action: 'vsb-open' },
                    { text: 'Add Gadgets...', icon: 'fas fa-plus', action: 'vsb-add' },
                    { text: 'Bring Gadgets to Front', action: 'vsb-front' },
                    { separator: true },
                    { text: 'Properties', icon: 'fas fa-sliders', action: 'vsb-properties' },
                    { text: 'Exit', icon: 'fas fa-power-off', action: 'vsb-exit' }
                ]
            }],
            onAction: (action, target, item, event) => vsbHandleMenuAction(action, null, event)
        });
    }
    const on = !!(vsb.state && vsb.state.enabled);
    if (on && icon.classList.contains('hidden')) {
        // revealTrayIconElement: public/scripts/comp/trayIndicators.js
        revealTrayIconElement(icon);
    } else if (!on) {
        icon.classList.add('hidden');
    }
};

// ---------------------------------------------------------------- gadget gallery

const VSB_GALLERY_ID = 'vistaGadgetGallery';
const VSB_GALLERY_PAGE = 12;
const vsbGallery = { page: 0, query: '', selected: null };

function openVistaGadgetGallery() {
    if (!vsb.state) return;
    const modal = vsbEnsureGallery();
    vsbGalleryRender();
    if (modal.classList.contains('minimised')) {
        // restoreMinimizedModal: public/scripts/comp/modalUtils.js
        restoreMinimizedModal(modal);
    }
    if (modal.classList.contains('hidden')) {
        // openModal: public/scripts/comp/modalUtils.js
        openModal(modal);
    }
    // bringModalToFront: public/scripts/comp/modalUtils.js
    bringModalToFront(modal);
}

const vsbEnsureGallery = function () {
    let modal = document.getElementById(VSB_GALLERY_ID);
    if (modal) return modal;
    modal = vsbEl('div', 'modal toolbar-visible vsb-gallery-window hidden');
    modal.id = VSB_GALLERY_ID;
    modal.dataset.windowIdentifier = 'vistaGadgetGallery';
    modal.dataset.windowClient = 'light';
    modal.innerHTML = `
        <div class="modal-window-title">
            <div class="modal-window-title-main"><img class="icon-image vsb-gallery-title-icon" src="/static_images/app_icons/24/vista-sidebar.webp" srcset="/static_images/app_icons/24/vista-sidebar.webp 1x, /static_images/app_icons/48/vista-sidebar.webp 2x" alt=""><span>Gadget Gallery</span></div>
            <div class="modal-window-title-toolbar win7">
                <div class="vsb-gallery-pager">
                    <span class="vsb-gallery-page-btn vsb-gallery-page-prev" title="Previous page"></span>
                    <span class="vsb-gallery-page-text"></span>
                    <span class="vsb-gallery-page-btn vsb-gallery-page-next" title="Next page"></span>
                </div>
                <input type="search" class="vsb-gallery-search" placeholder="Search all gadgets" spellcheck="false">
            </div>
        </div>
        <div class="modal-focus-overlay"></div>
        <div class="modal-window-controls">
            <button type="button" class="btn-danger close-btn btn-small" title="Close"><i class="fa-regular fa-xmark-large" aria-hidden="true"></i></button>
        </div>
        <div class="modal-content vsb-gallery win7">
            <div class="vsb-gallery-grid"></div>
            <div class="vsb-gallery-details hidden"></div>
        </div>
        <div class="vsb-gallery-footer">
            <span class="vsb-gallery-details-toggle" tabindex="0"><span class="vsb-gallery-chevron"></span><span class="vsb-gallery-details-label">Show details</span></span>
        </div>`;
    document.body.appendChild(modal);
    const grid = modal.querySelector('.vsb-gallery-grid');
    modal.querySelector('.close-btn').addEventListener('click', () => closeModal(modal));
    modal.querySelector('.vsb-gallery-page-prev').addEventListener('click', () => { vsbGallery.page -= 1; vsbGalleryRender(); });
    modal.querySelector('.vsb-gallery-page-next').addEventListener('click', () => { vsbGallery.page += 1; vsbGalleryRender(); });    modal.querySelector('.vsb-gallery-search').addEventListener('input', (e) => {
        vsbGallery.query = e.target.value.trim().toLowerCase();
        vsbGallery.page = 0;
        vsbGalleryRender();
    });
    modal.querySelector('.vsb-gallery-details-toggle').addEventListener('click', () => {
        modal.classList.toggle('vsb-gallery-show-details');
        vsbGalleryRender();
    });
    grid.addEventListener('click', (e) => {
        const tile = e.target.closest('[data-vsb-type]');
        vsbGallery.selected = tile ? tile.dataset.vsbType : null;
        vsbGalleryRender();
    });
    grid.addEventListener('dblclick', (e) => {
        const tile = e.target.closest('[data-vsb-type]');
        if (tile) vsbAddGadget(tile.dataset.vsbType);
    });
    grid.addEventListener('pointerdown', (e) => vsbGalleryDragStart(e));
    contextMenu.attachToElement(grid, {
        sections: [],
        beforeShow(event) {
            const tile = event && event.target.closest('[data-vsb-type]');
            this.vsbType = tile ? tile.dataset.vsbType : null;
            this.sections = tile ? [{ type: 'list', items: [{ text: 'Add', icon: 'fas fa-plus', action: 'vsb-gallery-add' }] }] : [];
        },
        onAction(action) {
            if (action === 'vsb-gallery-add' && this.vsbType) vsbAddGadget(this.vsbType);
        }
    });
    return modal;
};

const vsbGalleryRender = function () {
    const modal = document.getElementById(VSB_GALLERY_ID);
    if (!modal) return;
    const types = Object.keys(VSB_GADGETS).filter((t) => !vsbGallery.query || VSB_GADGETS[t].title.toLowerCase().includes(vsbGallery.query));
    const pages = Math.max(1, Math.ceil(types.length / VSB_GALLERY_PAGE));
    vsbGallery.page = Math.max(0, Math.min(vsbGallery.page, pages - 1));
    const shown = types.slice(vsbGallery.page * VSB_GALLERY_PAGE, (vsbGallery.page + 1) * VSB_GALLERY_PAGE);
    modal.querySelector('.vsb-gallery-page-text').textContent = `Page ${vsbGallery.page + 1} of ${pages}`;
    modal.querySelector('.vsb-gallery-page-prev').classList.toggle('is-disabled', vsbGallery.page === 0);
    modal.querySelector('.vsb-gallery-page-next').classList.toggle('is-disabled', vsbGallery.page >= pages - 1);
    modal.querySelector('.vsb-gallery-grid').innerHTML = shown.length
        ? shown.map((t) => `<div class="vsb-gallery-tile${vsbGallery.selected === t ? ' is-selected' : ''}" tabindex="0" data-vsb-type="${t}" title="${escapeHtmlAttribute(VSB_GADGETS[t].desc)}">
            <img src="${vsbGadgetIconUrl(t)}" alt="" draggable="false"><span>${escapeHtml(VSB_GADGETS[t].title)}</span></div>`).join('')
        : '<div class="vsb-gallery-none">No gadgets match your search.</div>';
    const showDetails = modal.classList.contains('vsb-gallery-show-details');
    const details = modal.querySelector('.vsb-gallery-details');
    details.classList.toggle('hidden', !showDetails);
    modal.querySelector('.vsb-gallery-details-label').textContent = showDetails ? 'Hide details' : 'Show details';
    const sel = VSB_GADGETS[vsbGallery.selected];
    details.innerHTML = sel
        ? `<img src="${vsbGadgetIconUrl(vsbGallery.selected)}" alt=""><div><div class="vsb-gallery-details-name">${escapeHtml(sel.title)}</div>
            <div class="vsb-gallery-details-version">Version: 1.0</div><div class="vsb-gallery-details-desc">${escapeHtml(sel.desc)}</div>
            <div class="vsb-gallery-details-author">${escapeHtml(sel.author)}</div></div>`
        : '<div class="vsb-gallery-details-desc">Select a gadget to see its details. Double-click it, or drag it to the Sidebar or the desktop, to add it.</div>';
};

/** Drag a gallery tile onto the Sidebar (docked) or the desktop (detached). */
const vsbGalleryDragStart = function (e) {
    const tile = e.target.closest('[data-vsb-type]');
    if (!tile || e.button !== 0) return;
    const type = tile.dataset.vsbType;
    const sx = e.clientX;
    const sy = e.clientY;
    let ghost = null;
    const move = (ev) => {
        if (!ghost) {
            if (Math.abs(ev.clientX - sx) < VSB_DRAG_THRESHOLD && Math.abs(ev.clientY - sy) < VSB_DRAG_THRESHOLD) return;
            ghost = vsbEl('img', 'vsb-gallery-ghost', document.body);
            ghost.src = vsbGadgetIconUrl(type);
            ghost.alt = '';
        }
        ghost.style.left = (ev.clientX - 32) + 'px';
        ghost.style.top = (ev.clientY - 32) + 'px';
    };
    const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (!ghost) return;
        ghost.remove();
        const gallery = document.getElementById(VSB_GALLERY_ID).getBoundingClientRect();
        if (ev.clientX >= gallery.left && ev.clientX <= gallery.right && ev.clientY >= gallery.top && ev.clientY <= gallery.bottom) return;
        const pane = vsb.pane.getBoundingClientRect();
        const onPane = vsb.state.enabled && !vsb.state.closed && ev.clientX >= pane.left && ev.clientX <= pane.right;
        vsbAddGadget(type, onPane ? {} : { docked: false, x: ev.clientX - 65, y: ev.clientY - 40 });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
};

// ---------------------------------------------------------------- boot

const vsbStart = function () {
    if (vsb.started || localStorage.getItem('userType') !== 'admin') return;
    vsb.started = true;
    // wsClient.on: public/scripts/websocket.js
    ['note_content_updated', 'note_updated', 'note_deleted'].forEach((type) => wsClient.on(type, vsbNotesOnNoteChange));
    document.addEventListener('dovecoteMailboxUpdated', (ev) => vsbRefreshMailGadgets(ev.detail));
    wsClient.on('sidebar_updated', (msg) => {
        const data = msg && (msg.data || msg);
        if (!data || data.workspaceId !== vsb.workspaceId || vsb.saveTimer || vsb.drag) return;
        vsb.state = data.sidebar;
        vsb.saved = true;
        vsb.instances.forEach(vsbDestroyInstance);
        vsb.instances.clear();
        vsbRender();
    });
    document.addEventListener('workspaceChanged', (e) => {
        const id = e.detail && e.detail.workspaceId;
        if (id && id !== vsb.workspaceId) vsbLoad(id);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && vsb.saveTimer) vsbFlushSave();
    });
    window.addEventListener('pagehide', () => { if (vsb.saveTimer) vsbFlushSave(); });
    vsb.firstLoad = vsbLoad(activeWorkspace);
};

/**
 * Staged boot (Yozora #521): the startup step "Loading gadgets" (assetPreload.js, 18.6) starts
 * the sidebar while desktop-boot.css still hides #vistaSidebar, waits for its gadgets to render,
 * decodes what they drew, and the gadgets stage reveals it. Resolves the root, or null when
 * there is no sidebar for this user.
 */
const vsbStartForBoot = async function () {
    if (localStorage.getItem('userType') !== 'admin') return null;
    vsbStart();
    if (vsb.firstLoad) await vsb.firstLoad;
    return vsb.root && !vsb.root.classList.contains('hidden') ? vsb.root : null;
};
window.vistaSidebarBoot = { start: vsbStartForBoot };

document.addEventListener('DOMContentLoaded', () => {
    // Started by the boot's gadget step; this is the fallback (non-staged loads, a skipped step)
    // desktopBoot.whenTaskbarVisible: public/scripts/comp/desktopBoot.js
    desktopBoot.whenTaskbarVisible('vista-sidebar', vsbStart);
});
