/**
 * The notification area's clock, Vista's way (measured on the Vista Aero VM, 96 dpi):
 *   - the time in the system's short format ("1:52 PM"), Segoe UI 9 pt (modalUtils.js
 *     updateTaskbarClock writes it; taskbarClockText() is the format)
 *   - hover: the clock tooltip, timedate.cpl's calendar icon and the long date
 *   - click: the Date and Time flyout, a month calendar and the analog clock with the time under
 *     it, over a link band
 * Art: public/static_images/vista-taskbar/ (timedate.cpl PNGFILE 5000/5001, icon 0); styles:
 * public/css/vista-taskbar.css. The Notification Area tab's Clock box hides the whole clock
 * (taskbarSettings.js, .tray-no-clock).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-taskbar';
    const TOOLTIP_DELAY_MS = 500;

    function taskbarClockText(date) {
        return (date || new Date()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function longDate(date) {
        return (date || new Date()).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    function clockEl() {
        return doc ? doc.getElementById('taskbarClock') : null;
    }

    // ---- tooltip -------------------------------------------------------------------------------

    let tip = null;
    let tipTimer = 0;

    function ensureTip() {
        if (tip) return tip;
        tip = doc.createElement('div');
        tip.className = 'taskbar-clock-tooltip hidden';
        tip.setAttribute('role', 'tooltip');
        tip.innerHTML = `<img src="${ART}/calendar-32.png" alt="" width="32" height="32" draggable="false"><span class="taskbar-clock-tooltip-date"></span>`;
        doc.body.appendChild(tip);
        return tip;
    }

    function showTip() {
        const clock = clockEl();
        if (!clock || flyoutOpen()) return;
        const el = ensureTip();
        el.querySelector('.taskbar-clock-tooltip-date').textContent = longDate();
        el.classList.remove('hidden');
        const r = clock.getBoundingClientRect();
        const w = el.offsetWidth;
        el.style.left = `${Math.round(Math.max(4, Math.min(root.innerWidth - w - 3, r.right - w)))}px`;
        el.style.bottom = `${Math.round(root.innerHeight - r.top)}px`;
    }

    function hideTip() {
        if (tipTimer) clearTimeout(tipTimer);
        tipTimer = 0;
        if (tip) tip.classList.add('hidden');
    }

    // ---- flyout --------------------------------------------------------------------------------

    let flyout = null;
    let shownMonth = null; // { y, m }
    let tickTimer = 0;

    function flyoutOpen() {
        return !!(flyout && !flyout.classList.contains('hidden'));
    }

    function ensureFlyout() {
        if (flyout) return flyout;
        flyout = doc.createElement('div');
        flyout.className = 'taskbar-clock-flyout hidden';
        flyout.setAttribute('role', 'dialog');
        flyout.setAttribute('aria-label', 'Date and Time');
        flyout.innerHTML = `
            <div class="taskbar-clock-flyout-client">
                <button type="button" class="taskbar-clock-flyout-today"></button>
                <div class="taskbar-clock-flyout-main">
                    <div class="taskbar-clock-cal" role="grid" aria-label="Calendar">
                        <div class="taskbar-clock-cal-head">
                            <button type="button" class="taskbar-clock-cal-prev" aria-label="Previous month"></button>
                            <span class="taskbar-clock-cal-title"></span>
                            <button type="button" class="taskbar-clock-cal-next" aria-label="Next month"></button>
                        </div>
                        <div class="taskbar-clock-cal-days"></div>
                        <div class="taskbar-clock-cal-grid"></div>
                    </div>
                    <div class="taskbar-clock-analog">
                        <div class="taskbar-clock-face">
                            <img src="${ART}/clock-face.png" alt="" width="128" height="128" draggable="false">
                            <svg class="taskbar-clock-hands" viewBox="0 0 128 128" aria-hidden="true">
                                <line class="hand-hour" x1="64" y1="64" x2="64" y2="34"></line>
                                <line class="hand-minute" x1="64" y1="64" x2="64" y2="20"></line>
                                <line class="hand-second" x1="64" y1="72" x2="64" y2="16"></line>
                                <circle cx="64" cy="64" r="2.5"></circle>
                            </svg>
                            <img class="taskbar-clock-gloss" src="${ART}/clock-gloss.png" alt="" width="128" height="128" draggable="false">
                        </div>
                        <div class="taskbar-clock-digital"></div>
                    </div>
                </div>
            </div>
            <div class="taskbar-clock-flyout-links">
                <button type="button" class="taskbar-clock-flyout-link">Open Alarm Clock</button>
            </div>`;
        flyout.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (ev.target.closest('.taskbar-clock-cal-prev')) moveMonth(-1);
            else if (ev.target.closest('.taskbar-clock-cal-next')) moveMonth(1);
            else if (ev.target.closest('.taskbar-clock-flyout-today')) {
                shownMonth = null;
                renderCalendar();
            } else if (ev.target.closest('.taskbar-clock-flyout-link')) {
                hideFlyout();
                // the Alarm Clock (Date and Time's icon): public/scripts/comp/desktop-apps/alarmPomodoro.js
                const item = typeof findStartMenuLaunchableById === 'function' ? findStartMenuLaunchableById('alarm') : null;
                if (item && typeof launchStartMenuItem === 'function') launchStartMenuItem(item);
            }
        });
        doc.body.appendChild(flyout);
        doc.addEventListener('pointerdown', (ev) => {
            if (!flyoutOpen()) return;
            const clock = clockEl();
            if (flyout.contains(ev.target) || (clock && clock.contains(ev.target))) return;
            hideFlyout();
        }, true);
        doc.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && flyoutOpen()) hideFlyout();
        }, true);
        return flyout;
    }

    function moveMonth(step) {
        const now = new Date();
        const cur = shownMonth || { y: now.getFullYear(), m: now.getMonth() };
        const d = new Date(cur.y, cur.m + step, 1);
        shownMonth = { y: d.getFullYear(), m: d.getMonth() };
        renderCalendar();
    }

    /** The six weeks Vista's month calendar shows: the month, with the days around it greyed. */
    function monthGrid(year, month, firstDay) {
        const first = new Date(year, month, 1);
        const lead = (first.getDay() - firstDay + 7) % 7;
        // a month that starts on the first column still shows a week of the month before
        const start = new Date(year, month, 1 - (lead || 7));
        const out = [];
        for (let i = 0; i < 42; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            out.push({ date: d, day: d.getDate(), inMonth: d.getMonth() === month });
        }
        return out;
    }

    function renderCalendar() {
        if (!flyout) return;
        const now = new Date();
        const y = shownMonth ? shownMonth.y : now.getFullYear();
        const m = shownMonth ? shownMonth.m : now.getMonth();
        flyout.querySelector('.taskbar-clock-flyout-today').textContent = longDate(now);
        flyout.querySelector('.taskbar-clock-cal-title').textContent = new Date(y, m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
            .replace(/^(\S+) (\d{4})$/, '$1, $2');
        const days = flyout.querySelector('.taskbar-clock-cal-days');
        if (!days.childElementCount) {
            const base = new Date(2023, 0, 1); // a Sunday
            for (let i = 0; i < 7; i++) {
                const s = doc.createElement('span');
                s.textContent = new Date(2023, 0, base.getDate() + i).toLocaleDateString([], { weekday: 'short' }).slice(0, 2);
                days.appendChild(s);
            }
        }
        const grid = flyout.querySelector('.taskbar-clock-cal-grid');
        grid.textContent = '';
        monthGrid(y, m, 0).forEach((cell) => {
            const s = doc.createElement('span');
            s.textContent = String(cell.day);
            s.setAttribute('role', 'gridcell');
            if (!cell.inMonth) s.className = 'is-other';
            if (cell.date.toDateString() === now.toDateString()) s.classList.add('is-today');
            grid.appendChild(s);
        });
    }

    function renderTime() {
        if (!flyoutOpen()) return;
        const now = new Date();
        const s = now.getSeconds();
        const mi = now.getMinutes() + s / 60;
        const h = (now.getHours() % 12) + mi / 60;
        const set = (cls, deg) => {
            const el = flyout.querySelector(cls);
            if (el) el.setAttribute('transform', `rotate(${deg.toFixed(2)} 64 64)`);
        };
        set('.hand-hour', h * 30);
        set('.hand-minute', mi * 6);
        set('.hand-second', s * 6);
        flyout.querySelector('.taskbar-clock-digital').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    }

    function showFlyout() {
        const clock = clockEl();
        if (!clock) return;
        hideTip();
        const el = ensureFlyout();
        shownMonth = null;
        el.classList.remove('hidden');
        renderCalendar();
        renderTime();
        clock.classList.add('is-open');
        const tb = doc.getElementById('desktopTaskbar');
        const top = tb ? tb.getBoundingClientRect().top : root.innerHeight - 35;
        el.style.right = '2px';
        el.style.bottom = `${Math.round(root.innerHeight - top + 2)}px`;
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = setInterval(() => {
            if (!flyoutOpen()) {
                clearInterval(tickTimer);
                tickTimer = 0;
                return;
            }
            renderTime();
        }, 1000);
    }

    function hideFlyout() {
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = 0;
        if (flyout) flyout.classList.add('hidden');
        const clock = clockEl();
        if (clock) clock.classList.remove('is-open');
    }

    function init() {
        const clock = clockEl();
        if (!clock || clock.dataset.vistaClock === '1') return;
        clock.dataset.vistaClock = '1';
        clock.setAttribute('role', 'button');
        clock.tabIndex = 0;
        clock.addEventListener('pointerenter', (ev) => {
            if (ev.pointerType === 'touch') return;
            if (tipTimer) clearTimeout(tipTimer);
            tipTimer = setTimeout(showTip, TOOLTIP_DELAY_MS);
        });
        clock.addEventListener('pointerleave', hideTip);
        clock.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (flyoutOpen()) hideFlyout();
            else showFlyout();
        });
        clock.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault();
            if (flyoutOpen()) hideFlyout();
            else showFlyout();
        });
    }

    root.taskbarClockText = taskbarClockText;
    root.taskbarClockFlyout = { show: showFlyout, hide: hideFlyout, isOpen: flyoutOpen, _test: { monthGrid, longDate, taskbarClockText } };

    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
        else init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
