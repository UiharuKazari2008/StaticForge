// Melaton alarm clock and pomodoro.
// public/scripts/comp/desktop-apps/alarmPomodoro.js
// One .modal window ("Alarm Clock", Yukimi 2026-10-13: the two apps combined) with an Alarm tab and
// a Pomodoro tab on the existing stack. Shell loads this script; no tray icon.

const DESKTOP_POMODORO_FOCUS_MS = 25 * 60 * 1000;
const DESKTOP_POMODORO_BREAK_MS = 5 * 60 * 1000;

const desktopAlarm = {
    modal: null,
    ticker: null,
    deadline: 0,
    armedAt: 0,
    armed: false,
    fired: false,
    armedHours: 0,
    armedMinutes: 0,
    hoursInput: null,
    minutesInput: null,
    remainEl: null,
    statusEl: null,
    barEl: null,
    fillEl: null,
    startBtn: null,
    cancelBtn: null
};

const desktopPomodoro = {
    modal: null,
    ticker: null,
    deadline: 0,
    remainingMs: DESKTOP_POMODORO_FOCUS_MS,
    phase: 'focus',
    running: false,
    sessions: 0,
    remainEl: null,
    phaseEl: null,
    barEl: null,
    fillEl: null,
    startBtn: null,
    pauseBtn: null
};

function desktopUtilityPad2(n) {
    return (n < 10 ? '0' : '') + n;
}

function desktopUtilityClampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

function desktopUtilityFormatClock(hours, minutes) {
    return desktopUtilityPad2(hours) + ':' + desktopUtilityPad2(minutes);
}

function desktopUtilityFormatRemain(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
        return hours + ':' + desktopUtilityPad2(minutes) + ':' + desktopUtilityPad2(seconds);
    }
    return desktopUtilityPad2(minutes) + ':' + desktopUtilityPad2(seconds);
}

function desktopUtilityNotify(type, title, message, iconClass) {
    // showGlassToast: public/scripts/comp/toastManager.js
    showGlassToast(type, title, message, false, 8000, '<i class="' + iconClass + '"></i>');
}

function desktopUtilityCreateModal(spec) {
    const modal = document.createElement('div');
    modal.id = spec.id;
    modal.className = 'modal hidden resizeable-window desktop-timer-window';
    modal.dataset.windowIdentifier = spec.identifier;
    modal.dataset.windowMinWidth = spec.minWidth;
    modal.dataset.windowDefaultWidth = spec.width;
    modal.dataset.windowMaxWidth = '720';
    modal.dataset.windowMaxHeight = '640';
    modal.innerHTML = ''
        + '<div class="modal-window-title">'
        + '<div class="modal-window-title-main">'
        + '<i class="' + spec.iconClass + ' icon-fa"></i>'
        + '<img src="/static_images/app_icons/24/vista-date-time.webp" srcset="/static_images/app_icons/24/vista-date-time.webp 1x, /static_images/app_icons/48/vista-date-time.webp 2x" alt="" class="icon-image">'
        + '<span>' + spec.title + '</span>'
        + '</div>'
        + '</div>'
        + '<div class="modal-focus-overlay"></div>'
        + '<div class="modal-window-controls">'
        + '<button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize">'
        + '<i class="fa-regular fa-window-minimize"></i>'
        + '</button>'
        + '<button type="button" class="btn-danger close-btn btn-small" title="Close">'
        + '<i class="fa-regular fa-xmark-large"></i>'
        + '</button>'
        + '</div>'
        + '<div class="modal-content"></div>';
    const content = modal.querySelector('.modal-content');
    spec.parts.forEach((part) => content.appendChild(part));
    modal.querySelector('.close-btn').addEventListener('click', () => {
        // Hide only. Alarm and pomodoro keep running until cancel, pause, or reset.
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    });
    document.body.appendChild(modal);
    // desktopAppApplyContentHeight: public/scripts/comp/desktop-apps/calculator.js
    desktopAppApplyContentHeight(modal);
    return modal;
}

// Shared face for both windows, the calculator's layout: caption line,
// sunken readout, then the 7.css progress bar (cache-browser.css).
function desktopUtilityBuildFace(prefix, initialText) {
    const body = document.createElement('div');
    body.className = 'modal-body form-col desktop-timer-body';

    const face = document.createElement('div');
    face.className = 'form-col desktop-timer-face';

    const status = document.createElement('div');
    status.id = prefix + 'Status';
    status.className = 'form-hint';

    const remain = document.createElement('div');
    remain.id = prefix + 'Remain';
    remain.className = 'form-control desktop-timer-readout';
    remain.setAttribute('role', 'timer');
    remain.setAttribute('aria-atomic', 'true');
    remain.textContent = initialText;

    const bar = document.createElement('div');
    bar.id = prefix + 'Progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', '0');
    const fill = document.createElement('div');
    bar.appendChild(fill);

    face.appendChild(status);
    face.appendChild(remain);
    face.appendChild(bar);
    body.appendChild(face);
    return { body: body, status: status, remain: remain, bar: bar, fill: fill };
}

// state: 'idle' | 'running' | 'paused' | 'done'
function desktopUtilityRenderBar(bar, fill, fraction, state) {
    const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10;
    fill.style.width = pct + '%';
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    bar.classList.toggle('animate', state === 'running');
    bar.classList.toggle('paused', state === 'paused' || state === 'done');
}

// Command strip: optional left group, then the dialog buttons on the right.
function desktopUtilityBuildFooter(leftButtons, rightButtons) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer modal-footer-colored desktop-timer-footer';
    const left = document.createElement('div');
    left.className = 'modal-footer-left';
    leftButtons.forEach((btn) => left.appendChild(btn));
    const right = document.createElement('div');
    right.className = 'modal-footer-right';
    rightButtons.forEach((btn) => right.appendChild(btn));
    footer.appendChild(left);
    footer.appendChild(right);
    return footer;
}

function desktopUtilityButton(id, className, text, iconClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = className;
    const icon = document.createElement('i');
    icon.className = iconClass;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = text;
    button.appendChild(icon);
    button.appendChild(label);
    return button;
}

function desktopUtilityReveal(modal) {
    if (modal.classList.contains('closing')) {
        // closeModal cleanup finishes on animation end or its 600ms fallback.
        setTimeout(() => {
            if (!modal.classList.contains('closing')) desktopUtilityReveal(modal);
        }, 650);
        return;
    }
    const onScreen = !modal.classList.contains('hidden') && !modal.classList.contains('hidden-alt');
    if (onScreen) {
        if (modal.classList.contains('minimised')) {
            // restoreMinimizedModal, getOrCreateTaskbarItem: public/scripts/comp/modalUtils.js
            restoreMinimizedModal(modal, getOrCreateTaskbarItem(modal));
        }
        // bringModalToFront: public/scripts/comp/modalUtils.js
        bringModalToFront(modal);
        return;
    }
    // openModal: public/scripts/comp/modalUtils.js
    openModal(modal);
    bringModalToFront(modal);
}

function desktopAlarmReadClock(writeBack) {
    const hours = desktopUtilityClampInt(desktopAlarm.hoursInput.value, 0, 23, 0);
    const minutes = desktopUtilityClampInt(desktopAlarm.minutesInput.value, 0, 59, 0);
    if (writeBack) {
        desktopAlarm.hoursInput.value = String(hours);
        desktopAlarm.minutesInput.value = String(minutes);
    }
    return { hours: hours, minutes: minutes };
}

function desktopAlarmNextDeadline(hours, minutes) {
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= Date.now()) {
        target.setDate(target.getDate() + 1);
    }
    return target.getTime();
}

function desktopAlarmSyncControls() {
    if (!desktopAlarm.startBtn) return;
    desktopAlarm.startBtn.disabled = desktopAlarm.armed;
    desktopAlarm.cancelBtn.disabled = !desktopAlarm.armed && !desktopAlarm.fired;
    desktopAlarm.hoursInput.disabled = desktopAlarm.armed;
    desktopAlarm.minutesInput.disabled = desktopAlarm.armed;
    desktopAlarmSyncSteppers();
}

function desktopAlarmSyncSteppers() {
    [desktopAlarm.hoursInput, desktopAlarm.minutesInput].forEach((input) => {
        if (!input || !input.parentElement) return;
        const up = input.parentElement.querySelector('button[data-step="1"]');
        const down = input.parentElement.querySelector('button[data-step="-1"]');
        if (!up || !down) return;
        const n = parseInt(input.value, 10);
        const known = Number.isFinite(n);
        up.disabled = input.disabled || (known && n >= Number(input.max));
        down.disabled = input.disabled || (known && n <= Number(input.min));
    });
}

function desktopAlarmStepInput(input, delta) {
    const min = Number(input.min);
    const max = Number(input.max);
    const current = parseInt(input.value, 10);
    const base = Number.isFinite(current) ? current : min;
    const next = String(desktopUtilityClampInt(base + delta, min, max, min));
    if (input.value === next) return;
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function desktopAlarmRender() {
    if (!desktopAlarm.remainEl) return;
    desktopAlarmSyncControls();
    const armedClock = desktopUtilityFormatClock(desktopAlarm.armedHours, desktopAlarm.armedMinutes);
    if (desktopAlarm.fired) {
        desktopAlarm.remainEl.textContent = '00:00';
        desktopAlarm.statusEl.textContent = 'Alarm went off at ' + armedClock;
        desktopUtilityRenderBar(desktopAlarm.barEl, desktopAlarm.fillEl, 1, 'done');
        return;
    }
    if (desktopAlarm.armed) {
        const now = Date.now();
        const span = desktopAlarm.deadline - desktopAlarm.armedAt;
        desktopAlarm.remainEl.textContent = desktopUtilityFormatRemain(desktopAlarm.deadline - now);
        desktopAlarm.statusEl.textContent = 'Rings at ' + armedClock;
        desktopUtilityRenderBar(desktopAlarm.barEl, desktopAlarm.fillEl,
            span > 0 ? (now - desktopAlarm.armedAt) / span : 0, 'running');
        return;
    }
    const clock = desktopAlarmReadClock(false);
    desktopAlarm.remainEl.textContent = desktopUtilityFormatClock(clock.hours, clock.minutes);
    desktopAlarm.statusEl.textContent = 'Alarm is off';
    desktopUtilityRenderBar(desktopAlarm.barEl, desktopAlarm.fillEl, 0, 'idle');
}

function desktopAlarmStopTicker() {
    if (!desktopAlarm.ticker) return;
    clearInterval(desktopAlarm.ticker);
    desktopAlarm.ticker = null;
}

function desktopAlarmEnsureTicker() {
    if (desktopAlarm.ticker) return;
    desktopAlarm.ticker = setInterval(desktopAlarmOnTick, 250);
}

function desktopAlarmFire() {
    if (!desktopAlarm.armed) return;
    desktopAlarm.armed = false;
    desktopAlarm.fired = true;
    desktopAlarm.deadline = 0;
    desktopAlarmStopTicker();
    desktopAlarmRender();
    desktopTimerSelect('alarm');
    desktopUtilityNotify('warning', 'Alarm', 'Alarm', 'fas fa-bell');
}

function desktopAlarmOnTick() {
    if (!desktopAlarm.armed) return;
    if (desktopAlarm.deadline - Date.now() <= 0) {
        desktopAlarmFire();
        return;
    }
    desktopAlarmRender();
}

function desktopAlarmStart() {
    const clock = desktopAlarmReadClock(true);
    desktopAlarm.fired = false;
    desktopAlarm.armed = true;
    desktopAlarm.armedHours = clock.hours;
    desktopAlarm.armedMinutes = clock.minutes;
    desktopAlarm.armedAt = Date.now();
    desktopAlarm.deadline = desktopAlarmNextDeadline(clock.hours, clock.minutes);
    desktopAlarmEnsureTicker();
    desktopAlarmRender();
}

function desktopAlarmCancel() {
    desktopAlarm.armed = false;
    desktopAlarm.fired = false;
    desktopAlarm.deadline = 0;
    desktopAlarm.armedAt = 0;
    desktopAlarmStopTicker();
    desktopAlarmRender();
}

function desktopAlarmSeedClock() {
    const next = new Date(Date.now() + 60 * 1000);
    desktopAlarm.hoursInput.value = String(next.getHours());
    desktopAlarm.minutesInput.value = String(next.getMinutes());
}

function desktopAlarmBuildTimeGroup(id, text, max) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = text;
    // 7.css text box (.win7 input) with the up-down column beside it, same button chrome as .combobox
    const field = document.createElement('div');
    field.className = 'desktop-timer-number';
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.min = '0';
    input.max = String(max);
    input.step = '1';
    field.appendChild(input);
    [['1', 'Increase'], ['-1', 'Decrease']].forEach((pair) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.step = pair[0];
        button.tabIndex = -1;
        button.setAttribute('aria-label', pair[1] + ' ' + text);
        const mark = document.createElement('span');
        button.appendChild(mark);
        button.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
        });
        button.addEventListener('click', () => {
            desktopAlarmStepInput(input, Number(pair[0]));
        });
        field.appendChild(button);
    });
    group.appendChild(label);
    group.appendChild(field);
    return { group: group, input: input };
}

function desktopAlarmBuildBody() {
    const face = desktopUtilityBuildFace('desktopAlarm', '00:00');

    const row = document.createElement('div');
    row.className = 'form-row';
    const hours = desktopAlarmBuildTimeGroup('desktopAlarmHours', 'Hour', 23);
    const minutes = desktopAlarmBuildTimeGroup('desktopAlarmMinutes', 'Minute', 59);
    row.appendChild(hours.group);
    row.appendChild(minutes.group);
    face.body.appendChild(row);

    const startBtn = desktopUtilityButton('desktopAlarmStartBtn', 'btn-primary', 'Start', 'fas fa-bell');
    const cancelBtn = desktopUtilityButton('desktopAlarmCancelBtn', 'btn-secondary', 'Cancel', 'fas fa-bell-slash');
    const footer = desktopUtilityBuildFooter([], [startBtn, cancelBtn]);

    desktopAlarm.remainEl = face.remain;
    desktopAlarm.statusEl = face.status;
    desktopAlarm.barEl = face.bar;
    desktopAlarm.fillEl = face.fill;
    desktopAlarm.hoursInput = hours.input;
    desktopAlarm.minutesInput = minutes.input;
    desktopAlarm.startBtn = startBtn;
    desktopAlarm.cancelBtn = cancelBtn;

    [hours.input, minutes.input].forEach((input) => {
        input.addEventListener('input', () => {
            if (!desktopAlarm.armed && !desktopAlarm.fired) desktopAlarmRender();
        });
        input.addEventListener('change', () => {
            desktopAlarmReadClock(true);
            if (!desktopAlarm.armed && !desktopAlarm.fired) desktopAlarmRender();
        });
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && !desktopAlarm.armed) desktopAlarmStart();
        });
    });
    startBtn.addEventListener('click', desktopAlarmStart);
    cancelBtn.addEventListener('click', desktopAlarmCancel);
    return { body: face.body, footer: footer };
}

// The window: a Vista tab strip (Alarm, Pomodoro), one page per tab, the page's own buttons in
// the command strip. Both tabs' state lives in desktopAlarm / desktopPomodoro as before.
const desktopTimer = { modal: null, tabs: {}, pages: {}, footers: {} };

function desktopTimerSelect(tab) {
    if (!desktopTimer.modal) return;
    ['alarm', 'pomodoro'].forEach((name) => {
        const on = name === tab;
        desktopTimer.tabs[name].setAttribute('aria-selected', on ? 'true' : 'false');
        desktopTimer.tabs[name].tabIndex = on ? 0 : -1;
        desktopTimer.pages[name].hidden = !on;
        desktopTimer.footers[name].hidden = !on;
    });
}

function desktopTimerEnsure() {
    if (desktopTimer.modal && desktopTimer.modal.isConnected) return desktopTimer.modal;
    const existing = document.getElementById('desktopTimerModal');
    if (existing) {
        desktopTimer.modal = existing;
        return existing;
    }
    const alarmParts = desktopAlarmBuildBody();
    desktopAlarmSeedClock();
    desktopAlarmRender();
    const pomodoroParts = desktopPomodoroBuildBody();
    desktopPomodoroRender(desktopPomodoro.remainingMs);
    desktopPomodoroSyncControls();

    const strip = document.createElement('div');
    strip.className = 'desktop-timer-tabs';
    strip.setAttribute('role', 'tablist');
    const pages = document.createElement('div');
    pages.className = 'desktop-timer-pages';
    [['alarm', 'Alarm', alarmParts], ['pomodoro', 'Pomodoro', pomodoroParts]].forEach(([name, label, parts]) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'desktop-timer-tab';
        tab.id = 'desktopTimerTab-' + name;
        tab.setAttribute('role', 'tab');
        tab.textContent = label;
        tab.addEventListener('click', () => desktopTimerSelect(name));
        tab.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
                const next = name === 'alarm' ? 'pomodoro' : 'alarm';
                desktopTimerSelect(next);
                desktopTimer.tabs[next].focus();
            }
        });
        strip.appendChild(tab);
        const page = document.createElement('div');
        page.className = 'desktop-timer-page win7'; // 7.css styles the page's controls
        page.setAttribute('role', 'tabpanel');
        page.setAttribute('aria-labelledby', tab.id);
        page.appendChild(parts.body);
        pages.appendChild(page);
        desktopTimer.tabs[name] = tab;
        desktopTimer.pages[name] = page;
        desktopTimer.footers[name] = parts.footer;
    });

    desktopTimer.modal = desktopUtilityCreateModal({
        id: 'desktopTimerModal',
        identifier: 'desktop-timer',
        title: 'Alarm Clock',
        iconClass: 'fas fa-alarm-clock',
        minWidth: '300',
        width: '340',
        parts: [strip, pages, alarmParts.footer, pomodoroParts.footer]
    });
    desktopAlarm.modal = desktopTimer.modal;
    desktopPomodoro.modal = desktopTimer.modal;
    desktopTimerSelect('alarm');
    return desktopTimer.modal;
}

function desktopAlarmEnsure() {
    return desktopTimerEnsure();
}

function openDesktopAlarm() {
    const modal = desktopAlarmEnsure();
    desktopAlarmRender();
    desktopTimerSelect('alarm');
    desktopUtilityReveal(modal);
}

function desktopPomodoroPhaseMs() {
    return desktopPomodoro.phase === 'break' ? DESKTOP_POMODORO_BREAK_MS : DESKTOP_POMODORO_FOCUS_MS;
}

function desktopPomodoroPhaseLabel() {
    return desktopPomodoro.phase === 'break' ? 'Break' : 'Focus';
}

function desktopPomodoroSyncControls() {
    if (!desktopPomodoro.startBtn) return;
    desktopPomodoro.startBtn.disabled = desktopPomodoro.running;
    desktopPomodoro.pauseBtn.disabled = !desktopPomodoro.running;
}

function desktopPomodoroRender(ms) {
    if (!desktopPomodoro.remainEl) return;
    const remain = ms == null ? desktopPomodoro.remainingMs : ms;
    const total = desktopPomodoroPhaseMs();
    const fresh = !desktopPomodoro.running && remain >= total;
    let state = 'paused';
    if (desktopPomodoro.running) state = 'running';
    else if (fresh) state = 'idle';
    let status = desktopPomodoroPhaseLabel();
    if (state === 'paused') status += ' (paused)';
    if (desktopPomodoro.sessions > 0) {
        status += ' \u00b7 ' + desktopPomodoro.sessions
            + (desktopPomodoro.sessions === 1 ? ' session' : ' sessions') + ' done';
    }
    desktopPomodoro.remainEl.textContent = desktopUtilityFormatRemain(remain);
    desktopPomodoro.phaseEl.textContent = status;
    desktopUtilityRenderBar(desktopPomodoro.barEl, desktopPomodoro.fillEl, 1 - remain / total, state);
}

function desktopPomodoroStopTicker() {
    if (!desktopPomodoro.ticker) return;
    clearInterval(desktopPomodoro.ticker);
    desktopPomodoro.ticker = null;
}

function desktopPomodoroEnsureTicker() {
    if (desktopPomodoro.ticker) return;
    desktopPomodoro.ticker = setInterval(desktopPomodoroOnTick, 250);
}

function desktopPomodoroAdvance() {
    const finishedFocus = desktopPomodoro.phase !== 'break';
    if (finishedFocus) desktopPomodoro.sessions += 1;
    desktopPomodoro.phase = finishedFocus ? 'break' : 'focus';
    desktopPomodoro.remainingMs = finishedFocus ? DESKTOP_POMODORO_BREAK_MS : DESKTOP_POMODORO_FOCUS_MS;
    desktopPomodoro.deadline = Date.now() + desktopPomodoro.remainingMs;
    desktopPomodoro.running = true;
    desktopPomodoroRender(desktopPomodoro.remainingMs);
    desktopPomodoroSyncControls();
    desktopUtilityNotify(
        'info',
        'Pomodoro',
        finishedFocus ? 'Focus finished. Break started.' : 'Break finished. Focus started.',
        'fas fa-clock'
    );
}

function desktopPomodoroOnTick() {
    if (!desktopPomodoro.running) return;
    const remain = desktopPomodoro.deadline - Date.now();
    if (remain <= 0) {
        desktopPomodoroAdvance();
        return;
    }
    desktopPomodoro.remainingMs = remain;
    desktopPomodoroRender(remain);
}

function desktopPomodoroStart() {
    if (desktopPomodoro.running) return;
    if (desktopPomodoro.remainingMs <= 0) {
        desktopPomodoro.remainingMs = desktopPomodoroPhaseMs();
    }
    desktopPomodoro.running = true;
    desktopPomodoro.deadline = Date.now() + desktopPomodoro.remainingMs;
    desktopPomodoroEnsureTicker();
    desktopPomodoroSyncControls();
    desktopPomodoroRender(desktopPomodoro.remainingMs);
}

function desktopPomodoroPause() {
    if (!desktopPomodoro.running) return;
    desktopPomodoro.remainingMs = Math.max(0, desktopPomodoro.deadline - Date.now());
    desktopPomodoro.running = false;
    desktopPomodoroStopTicker();
    desktopPomodoroSyncControls();
    desktopPomodoroRender(desktopPomodoro.remainingMs);
}

function desktopPomodoroReset() {
    desktopPomodoro.running = false;
    desktopPomodoro.phase = 'focus';
    desktopPomodoro.sessions = 0;
    desktopPomodoro.remainingMs = DESKTOP_POMODORO_FOCUS_MS;
    desktopPomodoro.deadline = 0;
    desktopPomodoroStopTicker();
    desktopPomodoroSyncControls();
    desktopPomodoroRender(desktopPomodoro.remainingMs);
}

function desktopPomodoroBuildBody() {
    const face = desktopUtilityBuildFace('desktopPomodoro', '25:00');
    // Phase caption keeps its old id for anything that already reads it.
    face.status.id = 'desktopPomodoroPhase';

    const resetBtn = desktopUtilityButton('desktopPomodoroResetBtn', 'btn-secondary', 'Reset', 'fas fa-rotate-left');
    const startBtn = desktopUtilityButton('desktopPomodoroStartBtn', 'btn-primary', 'Start', 'fas fa-play');
    const pauseBtn = desktopUtilityButton('desktopPomodoroPauseBtn', 'btn-secondary', 'Pause', 'fas fa-pause');
    pauseBtn.disabled = true;
    const footer = desktopUtilityBuildFooter([resetBtn], [startBtn, pauseBtn]);

    desktopPomodoro.remainEl = face.remain;
    desktopPomodoro.phaseEl = face.status;
    desktopPomodoro.barEl = face.bar;
    desktopPomodoro.fillEl = face.fill;
    desktopPomodoro.startBtn = startBtn;
    desktopPomodoro.pauseBtn = pauseBtn;

    startBtn.addEventListener('click', desktopPomodoroStart);
    pauseBtn.addEventListener('click', desktopPomodoroPause);
    resetBtn.addEventListener('click', desktopPomodoroReset);
    return { body: face.body, footer: footer };
}

function desktopPomodoroEnsure() {
    const modal = desktopTimerEnsure();
    desktopPomodoroRender(desktopPomodoro.running ? desktopPomodoro.deadline - Date.now() : desktopPomodoro.remainingMs);
    return modal;
}

function openDesktopPomodoro() {
    const modal = desktopPomodoroEnsure();
    desktopTimerSelect('pomodoro');
    desktopUtilityReveal(modal);
}
