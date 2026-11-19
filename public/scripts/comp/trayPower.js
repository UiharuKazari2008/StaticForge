/*
 * The battery meter in the notification area (#932, #910): Vista's power icon (batmeter.dll), its flyout and its
 * balloons, for a computer with a battery.
 *
 *   Source      the 'power' tray provider (trayProviders.js, docs/client-api/tray-providers.md). DreamOS's: the CaféReady host's pushed hardware state (window.DreamOSHardware + 'dreamoshw': the
 *               batteries, AC, battery protection) and window.AndroidHardware.getBattery() for the time left (a
 *               loopback read, done when the host pushes, never on a timer). A browser: the Battery Status API
 *               (navigator.getBattery, its own events). Neither, or a browser that only reports the "always full,
 *               always charging" stand-in a computer without a battery gives: no icon.
 *   Icon        batmeter.dll bitmaps 303 (16 px) / 306 (32 px), 43 cells: 0-9 discharging by tenths, 16 the low
 *               warning and 17 the critical mark laid over it, 18-28 plugged in (18 empty), 29 unknown, 30 no
 *               battery on the charger, 31 plugged in and unknown, 32-41 charging, 42 full. The flyout has its own
 *               bigger set, bitmaps 301 (32 px) / 302 (40 px), 31 cells: green, yellow when low, red when critical,
 *               not present, and its marks (frames() lists them). Painted by vista-taskbar.css from custom properties.
 *   Tooltip     batmeter.dll.mui 121-155 ("2 hr 05 min (64%) remaining", "85% available (plugged in, charging)",
 *               "Fully charged (100%)") and stobject.dll.mui 170 (Current power plan: ...).
 *   Flyout      one click: the status, "Select a power plan:" (stobject 192) with the plans of Power Options
 *               (cplPages.js: melatonRegistry HKLM\...\Power\User\PowerSchemes ActivePowerScheme, event
 *               'melaton-power-plan'; window.melatonPowerPlans when a newer plan source is loaded), "More power
 *               options" (193) and Melaton Mobility Center when it is installed.
 *   Balloons    the battery's own (popupId 'battery', tray-balloons): low (10 %, Vista's default) with Vista's
 *               words (stobject 407), critical (5 %), and DreamOS's battery protection (CaféReady freezes /data
 *               at 3 % on battery and thaws it on the charger above 5 %: files cannot be saved meanwhile).
 *
 * Desktop shell only (the phone's battery is its status bar's). Notifications and the icon are never silenced to
 * save power: they follow the pushed state, nothing else.
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const ICON_ID = 'powerTrayIcon';
    const POPUP_ID = 'battery';
    const LOW = 10;
    const CRITICAL = 5;
    const POWER_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes';
    const PLANS = [
        { id: 'balanced', name: 'Balanced' },
        { id: 'saver', name: 'Power saver' },
        { id: 'high', name: 'High performance' }
    ];
    const ART = '/static_images/vista-power';

    let model = null;        // what the icon shows (null: no battery, no icon)
    let source = 'none';     // 'dreamos' | 'browser' | 'none'
    let browserBattery = null;
    let flyout = null;
    let warned = '';         // the last balloon level said: '', 'low', 'critical'
    let protectSaid = false;

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const pad2 = (n) => String(n).padStart(2, '0');

    // ---- the battery, from either source ------------------------------------------------------------------------

    /** DreamOS: the host's hw snapshot (+ getBattery for the time left). */
    function fromDreamOS(hw) {
        const bats = hw && Array.isArray(hw.batteries) ? hw.batteries : [];
        // a laptop on its charger with the battery taken out: Vista's plug with the red X, "No battery is detected"
        if (!bats.length) return hw && hw.ac === true ? { absent: true, percent: null, plugged: true, charging: false, full: false, protect: hw.protect === true, minutesLeft: null, minutesToFull: null } : null;
        const b = bats[0];
        const status = String(b.status || '');
        const ac = hw.ac === true || status === 'Charging' || status === 'Full' || status === 'Not charging';
        let percent = Number(b.percent);
        if (!Number.isFinite(percent)) percent = null;
        // a pack the firmware calls full (the Mac stops at its own limit) reads as Vista's "Fully charged (100%)"
        const full = status === 'Full';
        // every pack, for the flyout's own row each (stobject.dll.mui 401 / 404: "Battery #2: ...")
        const packs = bats.map((x) => {
            const st = String(x.status || '');
            const pc = Number(x.percent);
            return { percent: st === 'Full' ? 100 : Number.isFinite(pc) ? pc : null, plugged: ac, charging: st === 'Charging', full: st === 'Full', protect: false, minutesLeft: null, minutesToFull: null };
        });
        const m = { packs, percent: full ? 100 : percent, plugged: ac, charging: status === 'Charging', full, protect: hw.protect === true, minutesLeft: null, minutesToFull: null };
        let info = null;
        try {
            const raw = root.AndroidHardware && typeof root.AndroidHardware.getBattery === 'function' ? root.AndroidHardware.getBattery() : null;
            info = raw ? JSON.parse(raw) : null;
        } catch (_) { info = null; }
        if (info) {
            const cur = Math.abs(Number(info.currentUa) || 0);
            const charge = Number(info.chargeCounterUah) || 0;
            if (!ac && cur > 1000 && charge > 0) m.minutesLeft = Math.round(charge / cur * 60);
            if (m.charging && Number(info.chargeTimeRemainingMs) > 0) m.minutesToFull = Math.round(Number(info.chargeTimeRemainingMs) / 60000);
        }
        return m;
    }

    /** A browser's BatteryManager: null for the stand-in a computer without a battery reports. */
    function fromBrowser(bm) {
        if (!bm) return null;
        const percent = Math.round((Number(bm.level) || 0) * 100);
        if (bm.charging && percent >= 100 && !Number(bm.chargingTime) && bm.dischargingTime === Infinity && !browserBattery.moved) return null;
        return {
            percent,
            plugged: !!bm.charging || percent >= 100 && bm.dischargingTime === Infinity,
            charging: !!bm.charging && percent < 100,
            full: !!bm.charging && percent >= 100,
            protect: false,
            minutesLeft: !bm.charging && Number.isFinite(bm.dischargingTime) && bm.dischargingTime > 0 ? Math.round(bm.dischargingTime / 60) : null,
            minutesToFull: bm.charging && Number.isFinite(bm.chargingTime) && bm.chargingTime > 0 ? Math.round(bm.chargingTime / 60) : null
        };
    }

    // ---- words (batmeter.dll.mui) -------------------------------------------------------------------------------

    function statusText(m) {
        if (!m || m.absent) return 'No battery is detected';
        const p = m.percent;
        if (m.full) return 'Fully charged (100%)';
        if (m.plugged) {
            if (p === null) return m.charging ? 'Plugged in and charging' : 'Plugged in and not charging';
            return `${p}% available (plugged in, ${m.charging ? 'charging' : 'not charging'})`;
        }
        if (p === null) return 'Unknown remaining';
        const t = m.minutesLeft;
        if (t === null || t <= 0) return `${p}% remaining`;
        const h = Math.floor(t / 60);
        return h ? `${h} hr ${pad2(t % 60)} min (${p}%) remaining` : `${t} min (${p}%) remaining`;
    }

    function toFullText(m) {
        const t = m && m.charging ? m.minutesToFull : null;
        if (!t) return '';
        const h = Math.floor(t / 60);
        return h ? `${h} hr ${pad2(t % 60)} min to full charge` : `${pad2(t)} min to full charge`;
    }

    // ---- power plans: Power Options' (cplPages.js), or a newer source ----------------------------------------------

    const powerProvider = () => (root.melatonTray && root.melatonTray.provider('power')) || null;

    function plans() {
        const pp = powerProvider();
        if (pp && typeof pp.plans === 'function') {
            try { const l = pp.plans(); if (Array.isArray(l) && l.length) return l.map((p) => ({ id: String(p.id), name: String(p.name) })); } catch (_) { /* fall back */ }
        }
        const api = root.melatonPowerPlans;
        if (api && typeof api.list === 'function') {
            try { const l = api.list(); if (Array.isArray(l) && l.length) return l.map((p) => ({ id: String(p.id), name: String(p.name) })); } catch (_) { /* fall back */ }
        }
        return PLANS;
    }

    function activePlan() {
        const pp = powerProvider();
        if (pp && typeof pp.activePlan === 'function') {
            try { const a = pp.activePlan(); if (a) return String(a); } catch (_) { /* fall back */ }
        }
        const api = root.melatonPowerPlans;
        if (api && typeof api.active === 'function') {
            try { const a = api.active(); if (a) return String(a); } catch (_) { /* fall back */ }
        }
        const reg = root.melatonRegistry;
        return (reg && typeof reg.get === 'function' && reg.get(POWER_KEY, 'ActivePowerScheme', 'balanced')) || 'balanced';
    }

    function planName(id) {
        const p = plans().find((x) => x.id === id);
        return p ? p.name : 'Unknown';
    }

    function setPlan(id) {
        const pp = powerProvider();
        if (pp && typeof pp.setPlan === 'function') {
            try { pp.setPlan(id); return; } catch (_) { /* fall back */ }
        }
        const api = root.melatonPowerPlans;
        if (api && typeof api.setActive === 'function') {
            try { api.setActive(id); return; } catch (_) { /* fall back */ }
        }
        const reg = root.melatonRegistry;
        if (reg && typeof reg.set === 'function') void reg.set(POWER_KEY, { ActivePowerScheme: id });
        try { root.dispatchEvent(new CustomEvent('melaton-power-plan', { detail: { plan: id } })); } catch (_) { /* old engine */ }
    }

    // ---- the icon -----------------------------------------------------------------------------------------------

    /**
     * batmeter.dll's cells. Tray (bitmaps 303 / 306, 43 cells): 0-9 on battery by tenths, 16 / 17 the low / critical
     * marks laid over it, 18 plugged in and empty, 19-28 plugged in by tenths, 29 unknown, 30 plugged in with no
     * battery, 31 plugged in and unknown, 32-41 charging by tenths, 42 plugged in and full.
     * Flyout (bitmaps 301 / 302, 31 cells): 0-9 green by tenths, 10-18 yellow (low), 19-25 red (critical), 26 unknown,
     * 27 not present, and the marks 28 (low), 29 (critical), 30 (plugged in) laid over it.
     */
    function frames(m) {
        if (!m) return { frame: 29, mark: null, big: 26, bigMark: null };
        if (m.absent) return { frame: 30, mark: null, big: 27, bigMark: 30 };
        if (m.percent === null) return { frame: m.plugged ? 31 : 29, mark: null, big: 26, bigMark: m.plugged ? 30 : null };
        const p = m.percent;
        const tenth = Math.max(0, Math.min(9, Math.ceil(p / 10) - 1));
        const level = (n) => Math.max(0, Math.min(n - 1, Math.round(p / 100 * (n - 1))));
        if (m.plugged) {
            const frame = m.full ? 42 : m.charging ? 32 + tenth : (p <= 0 ? 18 : 19 + tenth);
            return { frame, mark: null, big: tenth, bigMark: 30 };
        }
        if (p <= CRITICAL) return { frame: tenth, mark: 17, big: 19 + level(7), bigMark: 29 };
        if (p <= LOW) return { frame: tenth, mark: 16, big: 10 + level(9), bigMark: 28 };
        return { frame: tenth, mark: null, big: tenth, bigMark: null };
    }

    function iconEl() {
        return doc ? doc.getElementById(ICON_ID) : null;
    }

    function paintIcon() {
        const icon = iconEl();
        if (!icon) return;
        const show = !!model;
        if (icon.classList.contains('hidden') === show) icon.classList.toggle('hidden', !show);
        if (!show) return;
        const f = frames(model);
        if (icon.style.getPropertyValue('--power-frame') !== String(f.frame)) icon.style.setProperty('--power-frame', String(f.frame));
        if (f.mark === null) { if (icon.dataset.mark) delete icon.dataset.mark; } else if (icon.dataset.mark !== String(f.mark)) {
            icon.dataset.mark = String(f.mark);
            icon.style.setProperty('--power-mark', String(f.mark));
        }
        const title = `${statusText(model)}${model.protect ? '\nBattery protection is on' : ''}\nCurrent power plan: ${planName(activePlan())}`;
        if (icon.title !== title) icon.title = title;
    }

    // ---- balloons (tray-balloons: PopoverManager, the icon's own, one at a time) --------------------------------

    function balloon(kind, title, text) {
        const icon = iconEl();
        const pm = root.PopoverManager;
        if (!icon || !pm || typeof pm.showPopover !== 'function') return;
        // batmeter.dll bitmap 301: red cell 19 + critical mark 29, yellow cell 10 + low mark 28, green cell 9
        const art = kind === 'critical' || kind === 'protect' ? 'battery-critical-32.png' : kind === 'low' ? 'battery-low-32.png' : 'battery-full-32.png';
        pm.showPopover(icon, kind === 'info' ? 'info' : 'warning', esc(title), esc(text), false, kind === 'info' ? 8000 : 20000,
            `<img src="${ART}/${art}" alt="" width="32" height="32">`, null,
            { popupId: POPUP_ID, position: 'top', arrowPosition: 'bottom-right', onClick: () => showFlyout() });
    }

    function balloons(prev, m) {
        if (!m) return;
        // CaféReady's battery protection (DreamOS): said when it starts and when it ends
        if (m.protect) {
            // it says more than the low and critical balloons would
            if (!protectSaid) {
                protectSaid = true;
                warned = 'critical';
                balloon('protect', 'Battery protection is on', `Your battery is almost empty (${m.percent}%). To protect your files, nothing can be saved until you plug in your computer.`);
            }
            return;
        }
        if (!m.protect && protectSaid) {
            protectSaid = false;
            balloon('info', 'Battery protection is off', 'Your computer is charging. Files can be saved again.');
        }
        if (m.plugged) { warned = ''; return; }
        const p = m.percent;
        if (p === null) return;
        if (p <= CRITICAL && warned !== 'critical') {
            warned = 'critical';
            balloon('critical', 'Your battery is critically low', `Your battery is low (${p}%). If you need to continue using your computer, either plug in your computer, or shut it down and then change the battery.`);
        } else if (p <= LOW && p > CRITICAL && !warned) {
            warned = 'low';
            balloon('low', 'Your battery is running low', `Your battery is low (${p}%). If you need to continue using your computer, either plug in your computer, or shut it down and then change the battery.`);
        }
        void prev;
    }

    // ---- the flyout (a panel, not a balloon: closes on an outside click) ---------------------------------------------

    function flyoutHtml() {
        const m = model;
        const f = frames(m);
        const active = activePlan();
        const extra = toFullText(m);
        const mobility = mobilityAvailable();
        return `
            <div class="network-flyout-body power-flyout-body">
                ${m && Array.isArray(m.packs) && m.packs.length > 1 ? m.packs.map((b, i) => {
                    const bf = frames(b);
                    return `<div class="power-flyout-status">
                    <span class="power-flyout-battery" style="--power-big:${bf.big};--power-big-mark:${bf.bigMark === null ? 0 : bf.bigMark}"${bf.bigMark === null ? '' : ' data-mark="1"'}></span>
                    <div class="network-flyout-text"><span class="network-flyout-sub">Battery #${i + 1}: ${esc(statusText(b))}</span></div>
                </div>`;
                }).join('') : ''}
                <div class="power-flyout-status">
                    <span class="power-flyout-battery" style="--power-big:${f.big};--power-big-mark:${f.bigMark === null ? 0 : f.bigMark}"${f.bigMark === null ? '' : ' data-mark="1"'}></span>
                    <div class="network-flyout-text">
                        <span class="network-flyout-name">${esc(statusText(m))}</span>
                        ${extra ? `<span class="network-flyout-sub">${esc(extra)}</span>` : ''}
                        ${m && m.protect ? '<span class="network-flyout-sub power-flyout-protect">Battery protection is on: files cannot be saved until your computer is plugged in.</span>' : ''}
                    </div>
                </div>
                <div class="power-flyout-plans win7" role="radiogroup" aria-label="Select a power plan">
                    <div class="network-flyout-heading">Select a power plan:</div>
                    ${plans().map((p) => `
                    <label class="power-flyout-plan"><input type="radio" name="power-flyout-plan" value="${esc(p.id)}"${p.id === active ? ' checked' : ''}> ${esc(p.name)}</label>`).join('')}
                </div>
            </div>
            <div class="network-flyout-links">
                <button type="button" class="network-flyout-link" data-power-action="options">More power options</button>
                ${mobility ? '<button type="button" class="network-flyout-link" data-power-action="mobility">Melaton Mobility Center</button>' : ''}
            </div>`;
    }

    function hasItem(id) {
        const cp = root.melatonControlPanel;
        try { return !!(cp && cp._test && Array.isArray(cp._test.items) && cp._test.items.some((i) => i.id === id)); } catch (_) { return false; }
    }

    // Melaton Mobility Center (mobilityCenter.js) comes with the Control Panel feature: offered while that is not
    // loaded yet (it registers the item when it loads), or once the item is there
    function mobilityAvailable() {
        const loader = root.featureLoader;
        if (hasItem('mobility-center')) return true;
        return !!(loader && typeof loader.isLoaded === 'function' && !loader.isLoaded('control_panel') && typeof loader.loadFeature === 'function');
    }

    function openMobility() {
        const cp = root.melatonControlPanel;
        if (cp && hasItem('mobility-center')) { cp.openItem('mobility-center'); return; }
        const loader = root.featureLoader;
        if (loader && typeof loader.loadFeature === 'function') {
            Promise.resolve(loader.loadFeature('control_panel')).then(() => { if (root.melatonControlPanel) root.melatonControlPanel.openItem('mobility-center'); }).catch(() => { /* not available */ });
        }
    }

    function openOptions() {
        const cp = root.melatonControlPanel;
        if (cp && typeof cp.open === 'function') { cp.open('power-options'); return; }
        const loader = root.featureLoader;
        if (loader && typeof loader.loadFeature === 'function') {
            Promise.resolve(loader.loadFeature('control_panel')).then(() => { if (root.melatonControlPanel) root.melatonControlPanel.open('power-options'); }).catch(() => { /* not available */ });
        }
    }

    function ensureFlyout() {
        if (flyout || !doc) return flyout;
        flyout = doc.createElement('div');
        flyout.id = 'powerTrayFlyout';
        flyout.className = 'network-flyout power-flyout hidden';
        flyout.setAttribute('role', 'dialog');
        flyout.setAttribute('aria-label', 'Battery Meter');
        flyout.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const link = ev.target.closest('[data-power-action]');
            if (!link) return;
            hideFlyout();
            if (link.dataset.powerAction === 'options') openOptions();
            else if (link.dataset.powerAction === 'mobility') openMobility();
        });
        flyout.addEventListener('change', (ev) => {
            const r = ev.target;
            if (r && r.name === 'power-flyout-plan' && r.checked) { setPlan(r.value); paintIcon(); }
        });
        doc.body.appendChild(flyout);
        doc.addEventListener('pointerdown', (ev) => {
            if (!flyout || flyout.classList.contains('hidden')) return;
            const icon = iconEl();
            if (flyout.contains(ev.target) || (icon && icon.contains(ev.target))) return;
            hideFlyout();
        }, { capture: true, signal: appScopeSignal });
        doc.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && flyout && !flyout.classList.contains('hidden')) hideFlyout();
        }, { capture: true, signal: appScopeSignal });
        return flyout;
    }

    function renderFlyout() {
        if (!flyout || flyout.classList.contains('hidden')) return;
        const html = flyoutHtml();
        if (flyout.dataset.html !== html) { flyout.dataset.html = html; flyout.innerHTML = html; }
    }

    function positionFlyout() {
        const icon = iconEl();
        if (!flyout || !icon) return;
        const rect = icon.getBoundingClientRect();
        const width = flyout.offsetWidth || 280;
        const margin = 8;
        let left = rect.right + 12 - width;
        left = Math.max(margin, Math.min(root.innerWidth - width - margin, left));
        flyout.style.left = `${left}px`;
        flyout.style.bottom = `${Math.max(margin, root.innerHeight - rect.top + 6)}px`;
    }

    function showFlyout() {
        if (!model || !ensureFlyout()) return;
        // the other tray panels close (Vista shows one at a time)
        try { if (root.melatonControlPanel && root.melatonControlPanel.hideTrayFlyout) root.melatonControlPanel.hideTrayFlyout(); } catch (_) { /* none */ }
        flyout.classList.remove('hidden');
        renderFlyout();
        positionFlyout();
    }

    function hideFlyout() {
        if (flyout) flyout.classList.add('hidden');
    }

    function toggleFlyout() {
        if (flyout && !flyout.classList.contains('hidden')) hideFlyout();
        else showFlyout();
    }

    function attachMenu(icon) {
        const cm = root.contextMenu;
        if (!icon || icon.dataset.powerMenu === '1' || !cm || typeof cm.attachToElement !== 'function') return;
        icon.dataset.powerMenu = '1';
        const items = [{ text: 'Power Options', icon: 'fas fa-plug', action: 'power-options' }];
        if (mobilityAvailable()) items.push({ text: 'Melaton Mobility Center', icon: 'fas fa-laptop', action: 'power-mobility' });
        cm.attachToElement(icon, {
            sections: [{ type: 'list', items }],
            onAction: (action) => {
                hideFlyout();
                if (action === 'power-options') openOptions();
                else if (action === 'power-mobility') openMobility();
            }
        });
    }

    function wireIcon() {
        const icon = iconEl();
        if (!icon || icon.dataset.powerWired === '1') return;
        icon.dataset.powerWired = '1';
        icon.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleFlyout(); });
        attachMenu(icon);
    }

    // ---- updates ------------------------------------------------------------------------------------------------

    function setModel(next) {
        const prev = model;
        model = next;
        paintIcon();
        renderFlyout();
        if (!model) hideFlyout();
        balloons(prev, model);
        try { root.dispatchEvent(new CustomEvent('melaton-battery', { detail: model })); } catch (_) { /* old engine */ }
    }

    function startBrowser() {
        const nav = root.navigator;
        if (!nav || typeof nav.getBattery !== 'function') return;
        nav.getBattery().then((bm) => {
            if (source !== 'none') return;
            source = 'browser';
            browserBattery = { bm, moved: false, first: `${bm.level}|${bm.charging}` };
            const upd = () => {
                if (source !== 'browser') return;
                if (`${bm.level}|${bm.charging}` !== browserBattery.first) browserBattery.moved = true;
                setModel(fromBrowser(bm));
            };
            ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((t) => bm.addEventListener(t, upd, { signal: appScopeSignal }));
            upd();
        }).catch(() => { /* no battery API */ });
    }

    /** A provider's state (docs/client-api/tray-providers.md): DreamOS's hw snapshot, or the plain battery shape. */
    function fromProvider(st) {
        if (!st || typeof st !== 'object') return null;
        if (Array.isArray(st.batteries)) return fromDreamOS(st);
        if (st.present === false) return st.plugged ? { absent: true, percent: null, plugged: true, charging: false, full: false, protect: false, minutesLeft: null, minutesToFull: null } : null;
        const n = (v) => (Number.isFinite(Number(v)) && v !== null ? Math.round(Number(v)) : null);
        return {
            percent: st.full ? 100 : n(st.percent), plugged: !!st.plugged, charging: !!st.charging, full: !!st.full,
            protect: !!st.protect, minutesLeft: n(st.minutesLeft), minutesToFull: n(st.minutesToFull),
            packs: Array.isArray(st.packs) ? st.packs.map((b) => ({ percent: n(b.percent), plugged: !!st.plugged, charging: !!b.charging, full: !!b.full, protect: false, minutesLeft: null, minutesToFull: null })) : undefined
        };
    }

    function start() {
        if (root.uiShell === 'mobile' || !iconEl()) return;
        wireIcon();
        const tray = root.melatonTray;
        const prov = tray && tray.provider('power');
        if (tray) {
            // the provider in use, and one registered later (the Android app's desktop shell registers its own)
            const off = tray.onChange('power', (st) => { source = 'provider'; setModel(fromProvider(st)); });
            if (appScopeSignal) appScopeSignal.addEventListener('abort', off, { once: true });
        }
        if (prov) {
            source = 'provider';
            let st = null;
            try { st = prov.get(); } catch (_) { st = null; }
            setModel(fromProvider(st));
        } else {
            startBrowser();
        }
        // a plan chosen in Power Options shows in the tooltip and the open flyout
        root.addEventListener('melaton-power-plan', () => { paintIcon(); renderFlyout(); }, { signal: appScopeSignal });
    }

    const api = {
        present: () => !!model,
        state: () => model,
        source: () => source,
        statusText: () => statusText(model),
        // the model's batmeter cells and the plans, for Melaton Mobility Center's Battery Status tile
        frames: (m) => frames(m === undefined ? model : m),
        plans,
        activePlan,
        planName,
        setPlan,
        showFlyout,
        hideFlyout,
        _test: { fromDreamOS, fromBrowser, fromProvider, statusText, frames, setModel }
    };
    root.trayPower = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!doc) return;
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true, signal: appScopeSignal });
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
