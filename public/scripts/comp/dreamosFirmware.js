/**
 * DreamOS firmware updates for the page (#910): the machine's OS base and CaféReady's components, which CaféReady
 * (the system agent, DreamOS cafeready firmware.rs) checks, downloads and installs. The page only shows them and
 * says when: Melaton Update (cplUpdate.js) lists them with their progress, Control Panel > Firmware (cplFirmware.js)
 * shows the agent's state, and the shut down / restart screen (serviceWorkerManager.installUpdatesAtShutdown,
 * winlogonPower.js) installs what is waiting, as Vista installs updates on the way down.
 *
 * Everything comes from window.DreamOSUpdates / window.DreamOSFirmware (the DreamOS shell bridge): the state is
 * pushed by the host as 'dreamosupdates' while a job moves - nothing here polls. Inert on every other client.
 *
 *   melatonFirmware.available()        this is a DreamOS machine with a system agent
 *   melatonFirmware.state()            the host's picture (DreamOSUpdates.get())
 *   melatonFirmware.waiting()          the updates downloaded and staged: [{ id, kind, version, from, size, restart }]
 *   melatonFirmware.needsRestart()     a staged base update, or one installed that the next start boots
 *   melatonFirmware.label(item)        "DreamOS 0.2.27" / "CaféReady system agent 0.1.0+abc"
 *   melatonFirmware.check()            look at the channel now (and download what is new)
 *   melatonFirmware.install({ componentsOnly, onProgress(p) }) -> { ok, installed, failed, message }
 *   melatonFirmware.onChange(fn, signal)   fn(state) on every push, until signal (an AbortSignal) aborts
 */
(function (root) {
    'use strict';

    const api = () => root.DreamOSUpdates || null;
    // an install at shut down: a base update writes a 2 GB slot and checks it through verity (a minute or two on the
    // Mac's SSD, longer on a USB stick); past this the power-off goes ahead and the host installs it on the way down
    const INSTALL_MAX_MS = 20 * 60 * 1000;
    // the host restarts during a component update (its new copy starts): the job's progress comes back with it
    const QUIET_MAX_MS = 90 * 1000;

    const NAMES = { base: 'DreamOS', cafeready: 'CaféReady system agent', 'forge-shell': 'Forge Shell' };

    function available() {
        const a = api();
        return !!(a && typeof a.get === 'function' && typeof a.check === 'function');
    }

    function state() {
        const a = api();
        try { return (a && a.get()) || {}; } catch (_) { return {}; }
    }

    function list(v) { return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : []; }

    function waiting() {
        const s = state();
        return s.stagedForPowerOff === false ? [] : list(s.staged);
    }

    function needsRestart() {
        const s = state();
        if (waiting().some((u) => u.kind === 'base')) return true;
        return !!(s.nextBoot && s.running && s.nextBoot !== s.running);
    }

    function label(item) {
        if (!item) return '';
        const name = NAMES[item.kind === 'base' ? 'base' : item.id] || item.id;
        return `${name} ${item.version || ''}`.trim();
    }

    function check() {
        const a = api();
        if (!a) return Promise.resolve({ error: 'This computer has no system agent.' });
        return Promise.resolve().then(() => a.check()).catch((err) => ({ error: (err && err.message) || 'CaféReady did not answer.' }));
    }

    /** fn(state) on every push until signal aborts (each caller owns its listener: the page that shows it) */
    function onChange(fn, signal) {
        if (typeof root.addEventListener !== 'function' || !signal) return;
        root.addEventListener('dreamosupdates', (ev) => { try { fn((ev && ev.detail) || state()); } catch (err) { console.warn('[firmware]', err); } }, { signal });
    }

    /**
     * Install the staged updates now and follow the job to its end. The host may restart in the middle (a component
     * update replaces it): its event stream comes back with the whole picture, and the job (its own unit) goes on.
     */
    function install(opts = {}) {
        const a = api();
        if (!a) return Promise.resolve({ ok: false, installed: 0, failed: 0, message: 'This computer has no system agent.' });
        const items = waiting();
        const report = (p) => { try { if (typeof opts.onProgress === 'function') opts.onProgress(p); } catch (_) { /* the screen is the caller's */ } };
        return new Promise((resolve) => {
            const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            let job = null;
            let settled = false;
            let quiet = null;
            const end = (r) => {
                if (settled) return;
                settled = true;
                clearTimeout(quiet);
                clearTimeout(cap);
                if (ctl) ctl.abort();
                resolve(r);
            };
            const cap = setTimeout(() => end({ ok: false, installed: 0, failed: items.length, message: 'The update is still installing; it finishes as the computer shuts down.' }), INSTALL_MAX_MS);
            const arm = () => {
                clearTimeout(quiet);
                quiet = setTimeout(() => {
                    // nothing heard for a while: ask once (a host that came back may have missed nothing but sent nothing)
                    Promise.resolve().then(() => (typeof a.refresh === 'function' ? a.refresh() : state())).then(look, () => end({ ok: false, installed: 0, failed: items.length, message: 'CaféReady did not answer.' }));
                }, QUIET_MAX_MS);
            };
            const look = (s) => {
                const p = (s && s.progress) || {};
                if (!job || p.job !== job) { arm(); return; }
                report(p);
                if (p.state === 'done' || p.state === 'failed') {
                    const failed = p.state === 'failed' ? 1 : 0;
                    end({ ok: !failed, installed: Math.max(0, (p.count || items.length) - failed), failed, message: p.message || '' });
                } else arm();
            };
            onChange(look, ctl ? ctl.signal : null);
            Promise.resolve().then(() => (opts.componentsOnly ? a.installComponents() : a.install())).then((r) => {
                if (!r || r.error) { end({ ok: false, installed: 0, failed: items.length, message: (r && r.error) || 'The update could not start.' }); return; }
                if (r.busy) {
                    // another job runs (a download): follow it, then install
                    end({ ok: false, busy: true, installed: 0, failed: 0, message: 'CaféReady is still downloading updates.' });
                    return;
                }
                job = String(r.job || '');
                look(state());
            }, (err) => end({ ok: false, installed: 0, failed: items.length, message: (err && err.message) || 'CaféReady did not answer.' }));
        });
    }

    root.melatonFirmware = { available, state, waiting, needsRestart, label, check, install, onChange };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.melatonFirmware;
})(typeof window !== 'undefined' ? window : globalThis);
