// MeletonFX alarm clock and pomodoro.
// public/scripts/comp/desktop-apps/alarmPomodoro.js
// Two .modal windows on the existing stack. Shell loads this script; no tray icon.

const DESKTOP_POMODORO_FOCUS_MS = 25 * 60 * 1000;
const DESKTOP_POMODORO_BREAK_MS = 5 * 60 * 1000;

const desktopAlarm = {
    modal: null,
    ticker: null,
    deadline: 0,
    armed: false,
    fired: false,
    armedHours: 0,
    armedMinutes: 0,
    hoursInput: null,
    minutesInput: null,
    remainEl: null,
    statusEl: null
};

const desktopPomodoro = {
    modal: null,
    ticker: null,
    deadline: 0,
    remainingMs: DESKTOP_POMODORO_FOCUS_MS,
    phase: 'focus',
    running: false,
    remainEl: null,
    phaseEl: null,
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
    modal.className = 'modal hidden resizeable-window';
    modal.dataset.windowIdentifier = spec.identifier;
    modal.dataset.windowMinWidth = spec.minWidth;
    modal.dataset.windowDefaultWidth = spec.width;
    modal.dataset.windowMaxWidth = '720';
    modal.dataset.windowMaxHeight = '640';
    modal.style.flexDirection = 'column';
    modal.innerHTML = ''
        + '<div class="modal-window-title">'
        + '<div class="modal-window-title-main">'
        + '<i class="' + spec.iconClass + ' icon-fa"></i>'
        + '<img src="/static_images/app_icons/time.png" alt="" class="icon-image">'
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
        + '<div class="modal-content dark"></div>';
    const content = modal.querySelector('.modal-content');
    content.style.flex = '1 1 auto';
    content.style.height = 'auto';
    content.style.minHeight = '0';
    content.appendChild(spec.body);
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

function desktopAlarmRender() {
    if (!desktopAlarm.remainEl) return;
    if (desktopAlarm.fired) {
        desktopAlarm.remainEl.textContent = 'Alarm';
        desktopAlarm.statusEl.textContent = 'Fired';
        return;
    }
    if (desktopAlarm.armed) {
        desktopAlarm.remainEl.textContent = desktopUtilityFormatRemain(desktopAlarm.deadline - Date.now());
        desktopAlarm.statusEl.textContent = 'Rings at ' + desktopUtilityFormatClock(desktopAlarm.armedHours, desktopAlarm.armedMinutes);
        return;
    }
    const clock = desktopAlarmReadClock(false);
    desktopAlarm.remainEl.textContent = desktopUtilityFormatClock(clock.hours, clock.minutes);
    desktopAlarm.statusEl.textContent = 'Set a time';
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
    desktopAlarm.deadline = desktopAlarmNextDeadline(clock.hours, clock.minutes);
    desktopAlarmEnsureTicker();
    desktopAlarmRender();
}

function desktopAlarmCancel() {
    desktopAlarm.armed = false;
    desktopAlarm.fired = false;
    desktopAlarm.deadline = 0;
    desktopAlarmStopTicker();
    desktopAlarmRender();
}

function desktopAlarmSeedClock() {
    const next = new Date(Date.now() + 60 * 1000);
    desktopAlarm.hoursInput.value = String(next.getHours());
    desktopAlarm.minutesInput.value = String(next.getMinutes());
}

function desktopAlarmBuildBody() {
    const section = document.createElement('div');
    section.className = 'form-section';
    section.style.flex = '1 1 auto';
    section.style.minHeight = '0';

    const remain = document.createElement('h2');
    remain.id = 'desktopAlarmRemain';
    remain.textContent = '00:00';
    remain.style.flex = '1 1 auto';
    remain.style.alignItems = 'center';
    remain.style.justifyContent = 'center';
    remain.style.marginBottom = '0';

    const row = document.createElement('div');
    row.className = 'form-row';
    row.style.flex = '0 0 auto';

    const hoursGroup = document.createElement('div');
    hoursGroup.className = 'form-group';
    const hoursLabel = document.createElement('label');
    hoursLabel.htmlFor = 'desktopAlarmHours';
    hoursLabel.textContent = 'Hours';
    const hoursInput = document.createElement('input');
    hoursInput.type = 'number';
    hoursInput.id = 'desktopAlarmHours';
    hoursInput.className = 'form-control hover-show colored';
    hoursInput.min = '0';
    hoursInput.max = '23';
    hoursInput.step = '1';
    hoursGroup.appendChild(hoursLabel);
    hoursGroup.appendChild(hoursInput);

    const minutesGroup = document.createElement('div');
    minutesGroup.className = 'form-group';
    const minutesLabel = document.createElement('label');
    minutesLabel.htmlFor = 'desktopAlarmMinutes';
    minutesLabel.textContent = 'Minutes';
    const minutesInput = document.createElement('input');
    minutesInput.type = 'number';
    minutesInput.id = 'desktopAlarmMinutes';
    minutesInput.className = 'form-control hover-show colored';
    minutesInput.min = '0';
    minutesInput.max = '59';
    minutesInput.step = '1';
    minutesGroup.appendChild(minutesLabel);
    minutesGroup.appendChild(minutesInput);

    row.appendChild(hoursGroup);
    row.appendChild(minutesGroup);

    const status = document.createElement('h3');
    status.id = 'desktopAlarmStatus';
    status.className = 'section-header';
    status.textContent = 'Set a time';
    status.style.flex = '0 0 auto';

    const actions = document.createElement('div');
    actions.className = 'form-row';
    actions.style.flex = '0 0 auto';
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.id = 'desktopAlarmStartBtn';
    startBtn.className = 'btn-primary';
    startBtn.textContent = 'Start';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.id = 'desktopAlarmCancelBtn';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(startBtn);
    actions.appendChild(cancelBtn);

    section.appendChild(remain);
    section.appendChild(row);
    section.appendChild(status);
    section.appendChild(actions);

    desktopAlarm.remainEl = remain;
    desktopAlarm.statusEl = status;
    desktopAlarm.hoursInput = hoursInput;
    desktopAlarm.minutesInput = minutesInput;

    hoursInput.addEventListener('input', () => {
        if (!desktopAlarm.armed && !desktopAlarm.fired) desktopAlarmRender();
    });
    minutesInput.addEventListener('input', () => {
        if (!desktopAlarm.armed && !desktopAlarm.fired) desktopAlarmRender();
    });
    hoursInput.addEventListener('change', () => {
        desktopAlarmReadClock(true);
        if (!desktopAlarm.armed && !desktopAlarm.fired) desktopAlarmRender();
    });
    minutesInput.addEventListener('change', () => {
        desktopAlarmReadClock(true);
        if (!desktopAlarm.armed && !desktopAlarm.fired) desktopAlarmRender();
    });
    startBtn.addEventListener('click', desktopAlarmStart);
    cancelBtn.addEventListener('click', desktopAlarmCancel);
    return section;
}

function desktopAlarmEnsure() {
    if (desktopAlarm.modal && desktopAlarm.modal.isConnected) return desktopAlarm.modal;
    const existing = document.getElementById('desktopAlarmModal');
    if (existing) {
        desktopAlarm.modal = existing;
        return existing;
    }
    desktopAlarm.modal = desktopUtilityCreateModal({
        id: 'desktopAlarmModal',
        identifier: 'desktop-alarm',
        title: 'Alarm',
        iconClass: 'fas fa-bell',
        minWidth: '300',
        width: '380',
        body: desktopAlarmBuildBody()
    });
    desktopAlarmSeedClock();
    desktopAlarmRender();
    return desktopAlarm.modal;
}

function openDesktopAlarm() {
    const modal = desktopAlarmEnsure();
    desktopAlarmRender();
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
    desktopPomodoro.remainEl.textContent = desktopUtilityFormatRemain(remain);
    desktopPomodoro.phaseEl.textContent = desktopPomodoroPhaseLabel();
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
    desktopPomodoro.remainingMs = DESKTOP_POMODORO_FOCUS_MS;
    desktopPomodoro.deadline = 0;
    desktopPomodoroStopTicker();
    desktopPomodoroSyncControls();
    desktopPomodoroRender(desktopPomodoro.remainingMs);
}

function desktopPomodoroBuildBody() {
    const section = document.createElement('div');
    section.className = 'form-section';
    section.style.flex = '1 1 auto';
    section.style.minHeight = '0';

    const remain = document.createElement('h2');
    remain.id = 'desktopPomodoroRemain';
    remain.textContent = '25:00';
    remain.style.flex = '1 1 auto';
    remain.style.alignItems = 'center';
    remain.style.justifyContent = 'center';
    remain.style.marginBottom = '0';

    const phase = document.createElement('h3');
    phase.id = 'desktopPomodoroPhase';
    phase.className = 'section-header';
    phase.textContent = 'Focus';
    phase.style.flex = '0 0 auto';

    const actions = document.createElement('div');
    actions.className = 'form-row';
    actions.style.flex = '0 0 auto';

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.id = 'desktopPomodoroStartBtn';
    startBtn.className = 'btn-primary';
    startBtn.textContent = 'Start';

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.id = 'desktopPomodoroPauseBtn';
    pauseBtn.className = 'btn-secondary';
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = true;

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.id = 'desktopPomodoroResetBtn';
    resetBtn.className = 'btn-secondary';
    resetBtn.textContent = 'Reset';

    actions.appendChild(startBtn);
    actions.appendChild(pauseBtn);
    actions.appendChild(resetBtn);
    section.appendChild(remain);
    section.appendChild(phase);
    section.appendChild(actions);

    desktopPomodoro.remainEl = remain;
    desktopPomodoro.phaseEl = phase;
    desktopPomodoro.startBtn = startBtn;
    desktopPomodoro.pauseBtn = pauseBtn;

    startBtn.addEventListener('click', desktopPomodoroStart);
    pauseBtn.addEventListener('click', desktopPomodoroPause);
    resetBtn.addEventListener('click', desktopPomodoroReset);
    return section;
}

function desktopPomodoroEnsure() {
    if (desktopPomodoro.modal && desktopPomodoro.modal.isConnected) return desktopPomodoro.modal;
    const existing = document.getElementById('desktopPomodoroModal');
    if (existing) {
        desktopPomodoro.modal = existing;
        return existing;
    }
    desktopPomodoro.modal = desktopUtilityCreateModal({
        id: 'desktopPomodoroModal',
        identifier: 'desktop-pomodoro',
        title: 'Pomodoro',
        iconClass: 'fas fa-clock',
        minWidth: '300',
        width: '380',
        body: desktopPomodoroBuildBody()
    });
    desktopPomodoroRender(DESKTOP_POMODORO_FOCUS_MS);
    desktopPomodoroSyncControls();
    return desktopPomodoro.modal;
}

function openDesktopPomodoro() {
    const modal = desktopPomodoroEnsure();
    desktopPomodoroRender(desktopPomodoro.running
        ? desktopPomodoro.deadline - Date.now()
        : desktopPomodoro.remainingMs);
    desktopUtilityReveal(modal);
}
