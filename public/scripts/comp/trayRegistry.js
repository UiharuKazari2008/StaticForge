// Tray icons and tray popups register here so Taskbar and Start Menu Properties can hide popups
// and tuck icons behind the notification area's chevron. Client-only (this computer).

const TRAY_ICON_CATALOG = [
    { id: 'imageGenerationIndicator', label: 'Image generation' },
    { id: 'mcpActivityIndicator', label: 'Remote Access' },
    { id: 'mcpPhysicsIndicator', label: 'Location' },
    { id: 'replicationTrayIndicator', label: 'Replication' },
    { id: 'phasewalkerTrayIcon', label: 'Phasewalker' },
    { id: 'directorTrayIcon', label: 'Director' },
    { id: 'naxtBagTrayIcon', label: 'Atelier Bag' },
    { id: 'dovecoteTrayIcon', label: 'Mail' },
    { id: 'vistaSidebarTrayIcon', label: 'Windows Sidebar' },
    { id: 'searchIndexingIndicator', label: 'Search indexing' },
    { id: 'walletTrayIcon', label: 'Account Manager' },
    { id: 'workspaceTrayIcon', label: 'Workspace' },
    { id: 'serviceWorkerTrayIcon', label: 'MeletonFX Update' },
    { id: 'alchemyAudioTrayIcon', label: 'Alchemy audio' },
    { id: 'pingWarningIndicator', label: 'Network latency' },
    { id: 'volumeTrayIcon', label: 'Volume' },
    { id: 'modemTrayIcon', label: 'Network' },
    { id: 'generationQuipsTrayIcon', label: 'Generation quips' },
    { id: 'desktopSaveTrayIndicator', label: 'Saving' }
];

const TRAY_POPUP_CATALOG = [
    { id: 'windows-update', label: 'MeletonFX Update' },
    { id: 'mail', label: 'Mail' },
    { id: 'generation-complete', label: 'Generation Complete' },
    { id: 'balance-updated', label: 'Balance Updated' },
    { id: 'remote-access', label: 'Remote Access' },
    { id: 'high-latency', label: 'High Latency Detected' },
    { id: 'operation-receipt', label: 'Operation Receipt' },
    { id: 'generation-receipt', label: 'Generation Receipt' },
    { id: 'upscale-receipt', label: 'Upscaling Receipt' },
    { id: 'vibe-receipt', label: 'Vibe Encoding Receipt' },
    { id: 'deposit-receipt', label: 'Deposit Receipt' }
];

const TRAY_POPUP_MIN_KEY = 'desktop-tray-popup-min-ms';
const TRAY_POPUP_HIDE_KEY = 'desktop-tray-hidden-popups';
const TRAY_ICON_OVERFLOW_KEY = 'desktop-tray-overflow-icons';
const TRAY_POPUP_MIN_DEFAULT_MS = 8000;

let traySyncing = false;

function trayReadSet(key) {
    try {
        const raw = localStorage.getItem(key);
        const list = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(list) ? list : []);
    } catch (_) {
        return new Set();
    }
}

function trayWriteSet(key, set) {
    try {
        localStorage.setItem(key, JSON.stringify(Array.from(set)));
    } catch (_) { /* private mode */ }
}

function trayMinPopupMs() {
    const n = Number(localStorage.getItem(TRAY_POPUP_MIN_KEY));
    if (!Number.isFinite(n) || n < 1000) return TRAY_POPUP_MIN_DEFAULT_MS;
    return n;
}

function traySetMinPopupMs(ms) {
    const n = Number(ms);
    try {
        localStorage.setItem(TRAY_POPUP_MIN_KEY, String(Number.isFinite(n) && n >= 1000 ? n : TRAY_POPUP_MIN_DEFAULT_MS));
    } catch (_) { /* private mode */ }
}

function trayClampPopupTimeout(timeout) {
    if (timeout === false || timeout === null || timeout === undefined) return timeout;
    const n = Number(timeout);
    if (!Number.isFinite(n)) return trayMinPopupMs();
    return Math.max(n, trayMinPopupMs());
}

function trayPopupHidden(id) {
    if (!id) return false;
    return trayReadSet(TRAY_POPUP_HIDE_KEY).has(id);
}

function traySetPopupHidden(id, hidden) {
    const set = trayReadSet(TRAY_POPUP_HIDE_KEY);
    if (hidden) set.add(id);
    else set.delete(id);
    trayWriteSet(TRAY_POPUP_HIDE_KEY, set);
}

// ---- Notification area icons, Vista's way (taskbarSettings.js "Hide inactive icons") ----
// Each icon has a behaviour from Customize Notification Icons: 'show', 'hide', or 'inactive'
// (Hide when inactive: tucked once it has not changed or been clicked for TRAY_INACTIVE_MS).
// Tucked icons wait behind the chevron at the tray's left edge; the chevron expands the tray in
// place (Vista slides them in left of the visible icons) and it folds again TRAY_COLLAPSE_MS after
// the pointer leaves the notification area (measured on the Vista VM: 4-5 s). With "Hide inactive
// icons" off every icon shows and the chevron goes. The system icons (Volume, Network) are not
// in this list: the Notification Area tab turns them on or off as a whole.
const TRAY_ICON_BEHAVIOR_KEY = 'desktop-tray-icon-behavior';
const TRAY_INACTIVE_MS = 10 * 60 * 1000;
const TRAY_COLLAPSE_MS = 4500;
const TRAY_SYSTEM_ICON_IDS = ['volumeTrayIcon', 'modemTrayIcon'];
// state classes this file and the boot reveal set, which are not the icon's own activity
const TRAY_OWN_CLASSES = new Set(['tray-overflow', 'tray-boot-in']);
const TRAY_BEHAVIORS = ['inactive', 'hide', 'show'];

const trayActivity = new Map();
let trayCollapseTimer = 0;
let trayInactiveTimer = 0;

function trayReadBehaviors() {
    try {
        const raw = localStorage.getItem(TRAY_ICON_BEHAVIOR_KEY);
        const map = raw ? JSON.parse(raw) : null;
        return map && typeof map === 'object' && !Array.isArray(map) ? map : null;
    } catch (_) {
        return null;
    }
}

/** 'show' | 'hide' | 'inactive'. Before the first save: the old "not always shown" list
 *  ('hide' for its icons, 'show' for the rest), or Vista's default, Hide when inactive. */
function trayIconBehavior(id) {
    const map = trayReadBehaviors();
    if (map) return TRAY_BEHAVIORS.includes(map[id]) ? map[id] : 'inactive';
    let legacy = null;
    try { legacy = localStorage.getItem(TRAY_ICON_OVERFLOW_KEY); } catch (_) { /* private mode */ }
    if (legacy !== null) return trayReadSet(TRAY_ICON_OVERFLOW_KEY).has(id) ? 'hide' : 'show';
    return 'inactive';
}

/** Save every icon's behaviour at once (Customize Notification Icons OK). */
function traySetIconBehaviors(behaviors) {
    const out = {};
    TRAY_ICON_CATALOG.forEach((row) => {
        if (TRAY_SYSTEM_ICON_IDS.includes(row.id)) return;
        const b = behaviors && behaviors[row.id];
        out[row.id] = TRAY_BEHAVIORS.includes(b) ? b : trayIconBehavior(row.id);
    });
    try {
        localStorage.setItem(TRAY_ICON_BEHAVIOR_KEY, JSON.stringify(out));
    } catch (_) { /* private mode */ }
    traySyncOverflow();
}

function traySetIconBehavior(id, behavior) {
    const all = {};
    TRAY_ICON_CATALOG.forEach((row) => { all[row.id] = trayIconBehavior(row.id); });
    all[id] = behavior;
    traySetIconBehaviors(all);
}

/** Kept for older callers: "not always shown" = anything but Show. */
function trayIconOverflow(id) {
    if (!id) return false;
    return trayIconBehavior(id) !== 'show';
}

function traySetIconOverflow(id, overflow) {
    traySetIconBehavior(id, overflow ? 'hide' : 'show');
}

function trayPopupCatalog() {
    return TRAY_POPUP_CATALOG.slice();
}

/** The icons Customize Notification Icons lists (the system icons have their own checkboxes). */
function trayIconCatalog() {
    return TRAY_ICON_CATALOG.filter((row) => !TRAY_SYSTEM_ICON_IDS.includes(row.id) && document.getElementById(row.id));
}

function trayNotePopup(id, label) {
    if (!id || TRAY_POPUP_CATALOG.some((row) => row.id === id)) return;
    TRAY_POPUP_CATALOG.push({ id, label: label || id });
}

/** An icon changed or was clicked: it counts as active again (Hide when inactive). */
function trayNoteActivity(id) {
    if (!id) return;
    trayActivity.set(id, Date.now());
}

function trayHideInactiveEnabled() {
    // taskbarSettings: public/scripts/comp/taskbarSettings.js (loads after this file)
    if (typeof taskbarSettings !== 'undefined' && taskbarSettings && typeof taskbarSettings.get === 'function') {
        return taskbarSettings.get().hideInactive !== false;
    }
    return true;
}

function trayIconTucked(id, el, now) {
    if (!el || el.classList.contains('hidden') || !trayHideInactiveEnabled()) return false;
    const behavior = trayIconBehavior(id);
    if (behavior === 'show') return false;
    if (behavior === 'hide') return true;
    const seen = trayActivity.get(id);
    return !seen || now - seen >= TRAY_INACTIVE_MS;
}

function trayOverflowButton() {
    return document.getElementById('trayOverflowBtn');
}

function trayTray() {
    return document.querySelector('.taskbar-tray');
}

// Chrome records a class mutation for remove() even when the token is already
// absent. The tray observer would then call this again and never leave the script.
function trayClassRemove(el, token) {
    if (el && el.classList.contains(token)) el.classList.remove(token);
}

function trayClassToggle(el, token, on) {
    if (!el || el.classList.contains(token) === on) return;
    el.classList.toggle(token, on);
}

function trayExpanded() {
    const tray = trayTray();
    return !!(tray && tray.classList.contains('tray-expanded'));
}

function trayCancelCollapse() {
    if (trayCollapseTimer) clearTimeout(trayCollapseTimer);
    trayCollapseTimer = 0;
}

function trayScheduleCollapse() {
    trayCancelCollapse();
    if (!trayExpanded()) return;
    trayCollapseTimer = setTimeout(() => {
        trayCollapseTimer = 0;
        trayCloseOverflow();
    }, TRAY_COLLAPSE_MS);
}

function trayCloseOverflow() {
    trayCancelCollapse();
    const btn = trayOverflowButton();
    trayClassRemove(trayTray(), 'tray-expanded');
    if (btn) {
        trayClassRemove(btn, 'is-open');
        if (btn.title !== 'Show hidden icons') btn.title = 'Show hidden icons';
        btn.setAttribute('aria-expanded', 'false');
    }
}

function trayOpenOverflow() {
    const btn = trayOverflowButton();
    const tray = trayTray();
    if (!btn || !tray) return;
    trayClassToggle(tray, 'tray-expanded', true);
    trayClassToggle(btn, 'is-open', true);
    if (btn.title !== 'Hide') btn.title = 'Hide';
    btn.setAttribute('aria-expanded', 'true');
    // folds again once the pointer has left the notification area
    if (!tray.matches(':hover')) trayScheduleCollapse();
}

function trayToggleOverflow() {
    if (trayExpanded()) trayCloseOverflow();
    else trayOpenOverflow();
}

function traySyncOverflow() {
    if (traySyncing) return;
    traySyncing = true;
    const now = Date.now();
    let any = false;
    let waiting = false;
    TRAY_ICON_CATALOG.forEach((row) => {
        if (TRAY_SYSTEM_ICON_IDS.includes(row.id)) return;
        const el = document.getElementById(row.id);
        if (!el) return;
        const tucked = trayIconTucked(row.id, el, now);
        trayClassToggle(el, 'tray-overflow', tucked);
        if (tucked) any = true;
        else if (!el.classList.contains('hidden') && trayHideInactiveEnabled() && trayIconBehavior(row.id) === 'inactive') waiting = true;
    });
    const btn = trayOverflowButton();
    trayClassToggle(btn, 'hidden', !any);
    if (!any) trayCloseOverflow();
    // an icon that is active now goes inactive later: look again then
    if (waiting && !trayInactiveTimer) {
        trayInactiveTimer = setTimeout(() => {
            trayInactiveTimer = 0;
            traySyncOverflow();
        }, 30000);
    }
    traySyncing = false;
}

/** Activity = a change to the icon's own classes (shown, state) or its tooltip text. */
function trayMutationIsActivity(m) {
    if (m.attributeName === 'title') return true;
    const before = new Set(String(m.oldValue || '').split(/\s+/).filter(Boolean));
    const after = new Set(Array.from(m.target.classList));
    for (const c of before) if (!after.has(c) && !TRAY_OWN_CLASSES.has(c)) return true;
    for (const c of after) if (!before.has(c) && !TRAY_OWN_CLASSES.has(c)) return true;
    return false;
}

function trayWatchIcons() {
    const root = document.querySelector('.taskbar-tray-icons');
    if (!root || root.dataset.trayWatch === '1') return;
    root.dataset.trayWatch = '1';
    const ids = new Set(TRAY_ICON_CATALOG.map((row) => row.id));
    // every icon starts active: Vista shows a new icon before it can go inactive
    ids.forEach((id) => trayNoteActivity(id));
    const obs = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
            const icon = m.target.closest && m.target.closest('.taskbar-tray-icon');
            if (icon && ids.has(icon.id) && (icon !== m.target || trayMutationIsActivity(m))) trayNoteActivity(icon.id);
        });
        traySyncOverflow();
    });
    obs.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'title'] });
    root.addEventListener('pointerdown', (ev) => {
        const icon = ev.target.closest('.taskbar-tray-icon');
        if (icon && ids.has(icon.id)) trayNoteActivity(icon.id);
    }, true);
    const btn = trayOverflowButton();
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            trayToggleOverflow();
        });
    }
    const tray = trayTray();
    if (tray) {
        tray.addEventListener('pointerenter', trayCancelCollapse);
        tray.addEventListener('pointerleave', trayScheduleCollapse);
    }
    traySyncOverflow();
}

function trayPopupTimeChoices() {
    return [3, 5, 8, 10, 15, 30].map((sec) => ({
        value: String(sec * 1000),
        text: sec + (sec === 1 ? ' second' : ' seconds')
    }));
}

function trayPopupTimeLabel(ms) {
    const sec = Math.round(Number(ms) / 1000);
    return sec + (sec === 1 ? ' second' : ' seconds');
}

if (document.querySelector('.taskbar-tray-icons')) trayWatchIcons();
