// Tray icons and tray popups register here so Taskbar settings can hide popups
// and tuck icons behind the overflow chevron. Client-only (this computer).

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

const trayIconHomes = new WeakMap();
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

function trayIconOverflow(id) {
    if (!id) return false;
    return trayReadSet(TRAY_ICON_OVERFLOW_KEY).has(id);
}

function traySetIconOverflow(id, overflow) {
    const set = trayReadSet(TRAY_ICON_OVERFLOW_KEY);
    if (overflow) set.add(id);
    else set.delete(id);
    trayWriteSet(TRAY_ICON_OVERFLOW_KEY, set);
    traySyncOverflow();
}

function trayPopupCatalog() {
    return TRAY_POPUP_CATALOG.slice();
}

function trayIconCatalog() {
    return TRAY_ICON_CATALOG.filter((row) => document.getElementById(row.id));
}

function trayNotePopup(id, label) {
    if (!id || TRAY_POPUP_CATALOG.some((row) => row.id === id)) return;
    TRAY_POPUP_CATALOG.push({ id, label: label || id });
}

function trayRememberHome(el) {
    if (!el || trayIconHomes.has(el)) return;
    trayIconHomes.set(el, { parent: el.parentNode, next: el.nextSibling });
}

function trayRestoreHome(el) {
    const home = trayIconHomes.get(el);
    if (!home || !home.parent) return;
    if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(el, home.next);
    else home.parent.appendChild(el);
}

function trayOverflowButton() {
    return document.getElementById('trayOverflowBtn');
}

function trayOverflowFlyout() {
    return document.getElementById('trayOverflowFlyout');
}

// Chrome records a class mutation for remove() even when the token is already
// absent. The tray observer would then call this again and never leave the script.
function trayClassRemove(el, token) {
    if (el && el.classList.contains(token)) el.classList.remove(token);
}

function trayCloseOverflow() {
    const fly = trayOverflowFlyout();
    const btn = trayOverflowButton();
    if (fly) {
        Array.from(fly.children).forEach(trayRestoreHome);
        trayClassRemove(fly, 'is-open');
    }
    if (btn) {
        trayClassRemove(btn, 'is-open');
        btn.title = 'Show hidden icons';
    }
}

function trayOpenOverflow() {
    const fly = trayOverflowFlyout();
    const btn = trayOverflowButton();
    if (!fly || !btn) return;
    TRAY_ICON_CATALOG.forEach((row) => {
        const el = document.getElementById(row.id);
        if (!el || !el.classList.contains('tray-overflow') || el.classList.contains('hidden')) return;
        trayRememberHome(el);
        fly.appendChild(el);
    });
    const rect = btn.getBoundingClientRect();
    fly.style.left = Math.max(8, rect.right - fly.offsetWidth) + 'px';
    if (!fly.classList.contains('is-open')) fly.classList.add('is-open');
    const flyRect = fly.getBoundingClientRect();
    fly.style.top = Math.max(8, rect.top - flyRect.height - 6) + 'px';
    fly.style.left = Math.max(8, rect.right - flyRect.width) + 'px';
    if (!btn.classList.contains('is-open')) btn.classList.add('is-open');
    btn.title = 'Hide icons';
}

function trayToggleOverflow() {
    const fly = trayOverflowFlyout();
    if (fly && fly.classList.contains('is-open')) trayCloseOverflow();
    else trayOpenOverflow();
}

function traySyncOverflow() {
    if (traySyncing) return;
    traySyncing = true;
    let any = false;
    TRAY_ICON_CATALOG.forEach((row) => {
        const el = document.getElementById(row.id);
        if (!el) return;
        const overflow = trayIconOverflow(row.id) && !el.classList.contains('hidden');
        el.classList.toggle('tray-overflow', overflow);
        if (overflow) any = true;
        else if (el.parentNode && el.parentNode.id === 'trayOverflowFlyout') trayRestoreHome(el);
    });
    const btn = trayOverflowButton();
    if (btn) btn.classList.toggle('hidden', !any);
    if (!any) trayCloseOverflow();
    else if (trayOverflowFlyout() && trayOverflowFlyout().classList.contains('is-open')) trayOpenOverflow();
    traySyncing = false;
}

function trayWatchIcons() {
    const root = document.querySelector('.taskbar-tray-icons');
    if (!root || root.dataset.trayWatch === '1') return;
    root.dataset.trayWatch = '1';
    const fly = trayOverflowFlyout();
    if (fly && fly.parentNode !== document.body) document.body.appendChild(fly);
    const obs = new MutationObserver(() => traySyncOverflow());
    obs.observe(root, { subtree: true, attributes: true, attributeFilter: ['class'] });
    const btn = trayOverflowButton();
    if (btn) {
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            trayToggleOverflow();
        });
    }
    document.addEventListener('mousedown', (ev) => {
        const fly = trayOverflowFlyout();
        if (!fly || !fly.classList.contains('is-open')) return;
        if (fly.contains(ev.target) || (btn && btn.contains(ev.target))) return;
        trayCloseOverflow();
    });
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
