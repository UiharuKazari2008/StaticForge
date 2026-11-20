/**
 * The device's own load for "this computer" views on a device client (Yozora #946): Task Manager, Reliability and
 * Performance Monitor, the Sidebar's CPU Meter and hosted gadgets' System.Machine / WMI. Before, those showed the
 * Dreamscape server as if it were the phone, the DeX window or the DreamOS laptop. The server's figures belong in
 * Server Manager; a plain desktop browser (no bridge) keeps the server's, since a browser cannot measure its machine.
 *
 *   window.melatonDevicePerf
 *     available()                     a device bridge is here (window.AndroidHardware with getCpuFrequencies: the
 *                                     Android app, and DreamOS's shell bridge, which serves the same contract)
 *     subscribe({ intervalMs, isActive }, onSample) -> release()
 *                                     onSample(sample) at the subscriber's own speed while isActive() says its view
 *                                     shows and the page is seen (document.hidden, html[data-screen-off]); nothing
 *                                     runs while none is
 *     wake()                          a subscriber's view showed or hid: look again now
 *     latest()                        the last sample, or null
 *     refresh()                       one read now (Task Manager's Refresh Now), the sample or null
 *     info()                          the bridge's getInfo() (storage, SoC), kept 5 minutes
 *
 * Sources, best first:
 *   push     AndroidHardware.startPerformance(ms) (DSApp claude/device-perf, PerformanceSampler.kt): the app samples on
 *            its own thread and dispatches 'androidperformance'; the page renews it while it shows and stops it when
 *            it does not (the app ends a sampler 60 s after its last renewal, should the page vanish)
 *   bridge   older apps and DreamOS: getCpuFrequencies() once a tick (~10 ms on the Fold) and the memory from
 *            getInfo() every MEM_MS (it re-reads every device: ~170 ms on the Fold), only while a view shows
 *
 * sample = { at, source, host, cpu: { name, total, cores[], mhz[], maxMhz[], freqPct, gpu },
 *            memory: { total, available, free, cached, buffers, paged, nonpaged, swapTotal, swapFree, committed,
 *                      commitLimit, low } (bytes; null where the device does not say),
 *            uptimeSec, threads, processes: [{ pid, name, user, cpu, memKB, privateKB, threads, command }],
 *            network: [{ name, state, speedMbps, bitsPerSecond, rxBps, txBps, rxBytes, txBytes, utilization }],
 *            hardFaults (per second, or null) }
 */
(function (root) {
    'use strict';

    const doc = document;
    const EVENT = 'androidperformance';
    const MEM_MS = 30000;
    const RENEW_MS = 20000;
    const INFO_MS = 5 * 60 * 1000;
    const hw = () => root.AndroidHardware || null;
    const has = (name) => { const h = hw(); return !!(h && typeof h[name] === 'function'); };
    // A synchronous read waits for its answer with the page stopped. On DreamOS the shell bridge's reads queued behind
    // the host's other requests while CaféReady waited on a dead Wi-Fi firmware (Nov 20 2026, #910): each tick froze the
    // page for up to 25 s and every click made meanwhile opened at once afterwards. A read that takes longer than
    // SLOW_READ_MS (a healthy one is ~1 ms on DreamOS, ~170 ms for getInfo on the Fold) stops the bridge's reads for
    // STALL_MS; the views keep their last sample until then.
    const SLOW_READ_MS = 400;
    const STALL_MS = 60000;
    let stalledUntil = 0;
    const stalled = () => Date.now() < stalledUntil;
    const json = (name) => {
        if (stalled()) return null;
        const t0 = performance.now();
        try { return JSON.parse(hw()[name]()); } catch (_) { return null; } finally {
            const took = performance.now() - t0;
            if (took > SLOW_READ_MS) {
                stalledUntil = Date.now() + STALL_MS;
                console.warn(`[devicePerf] AndroidHardware.${name}() took ${Math.round(took)} ms: the bridge's reads stop for ${STALL_MS / 1000} s`);
            }
        }
    };
    const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

    const subs = new Set();
    let last = null;
    let prev = null; // the previous raw sample: rates from counters
    let timer = null;
    let pushMs = 0;
    let renewedAt = 0;
    let memAt = 0;
    let memCache = null;
    let fixed = null; // name, cores and the like: read once
    let listening = false;

    const seen = () => !doc.hidden && doc.documentElement.dataset.screenOff === undefined;
    const activeSubs = () => [...subs].filter((s) => { try { return !s.isActive || s.isActive(); } catch (_) { return false; } });

    function hostName() {
        try {
            const id = root.melatonDeviceIdentity && typeof root.melatonDeviceIdentity.get === 'function' ? root.melatonDeviceIdentity.get() : null;
            if (id && id.name) return id.name;
        } catch (_) { /* below */ }
        const d = fixed && fixed.device;
        return (d && (d.marketName || d.model)) || 'This device';
    }

    /** The parts that never change, from one getInfo() (only when no sample said them yet). */
    function fixedInfo(info) {
        if (fixed) return fixed;
        const i = info || json('getInfo');
        // no answer (the bridge's reads stopped, see json): this once, without keeping it
        if (!i) return { device: null, name: 'Processor', arch: '' };
        fixed = { device: i.device || null, name: (i.soc && (i.soc.name || i.soc.model)) || (i.cpu && i.cpu.model) || 'Processor', arch: (i.soc && i.soc.arch) || '' };
        if (!memCache && i.memory) { memCache = i.memory; memAt = Date.now(); }
        return fixed;
    }

    /** A raw snapshot (the app's PerformanceSampler shape) into the views' sample. */
    function normalise(raw, source) {
        const at = num(raw.at) || Date.now();
        const f = raw.cpu || {};
        const cores = Array.isArray(f.cores) ? f.cores : [];
        const loads = cores.map((c) => (c && c.online !== false ? Math.max(0, Math.min(100, num(c.loadPct) || 0)) : 0));
        const total = num(f.loadPct) !== null ? num(f.loadPct) : (loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0);
        const mhz = cores.map((c) => num(c && c.curMHz) || 0);
        const maxMhz = cores.map((c) => num(c && c.maxMHz) || 0);
        const fr = cores.map((c, i) => (maxMhz[i] ? mhz[i] / maxMhz[i] : null)).filter((v) => v !== null);
        const m = raw.memory || {};
        const slab = num(m.slabBytes);
        const reclaim = num(m.slabReclaimableBytes);
        const kernelOther = (num(m.kernelStackBytes) || 0) + (num(m.pageTablesBytes) || 0);
        const memory = {
            total: num(m.totalBytes) || 0,
            available: num(m.availBytes) || 0,
            free: num(m.freeBytes),
            cached: num(m.cachedBytes),
            buffers: num(m.buffersBytes),
            // Vista's kernel pools, from the slab: reclaimable = paged, the rest (and kernel stacks, page tables) = nonpaged
            paged: reclaim,
            nonpaged: slab !== null ? slab - (reclaim || 0) + kernelOther : null,
            swapTotal: num(m.swapTotalBytes),
            swapFree: num(m.swapFreeBytes),
            committed: num(m.committedBytes),
            commitLimit: num(m.commitLimitBytes),
            low: !!m.lowMemory
        };
        // rates over at least a quarter second: a Refresh Now just after a push would make a spike of a few bytes
        const short = !!(prev && at - prev.at < 250 && last);
        const dt = prev && !short ? (at - prev.at) / 1000 : 0;
        const network = (Array.isArray(raw.net) ? raw.net : []).map((n) => {
            if (short) { const was = last.network.find((x) => x.name === n.name); if (was) return was; }
            const p = prev && Array.isArray(prev.net) ? prev.net.find((x) => x.name === n.name) : null;
            const rx = num(n.rxBytes) || 0;
            const tx = num(n.txBytes) || 0;
            const rxBps = p && dt ? Math.max(0, (rx - (num(p.rxBytes) || 0)) / dt) : 0;
            const txBps = p && dt ? Math.max(0, (tx - (num(p.txBytes) || 0)) / dt) : 0;
            const speedMbps = num(n.linkMbps);
            const bits = (rxBps + txBps) * 8;
            return {
                name: n.name, state: n.up ? 'up' : 'down', speedMbps, speedBps: speedMbps ? speedMbps * 1e6 : 0, bitsPerSecond: bits,
                rxBps, txBps, rxBytes: rx, txBytes: tx, utilization: speedMbps ? Math.min(100, (bits / (speedMbps * 1e6)) * 100) : 0
            };
        });
        const faultsNow = raw.faults && num(raw.faults.majorTotal);
        const faultsWas = prev && prev.faults && num(prev.faults.majorTotal);
        const processes = (Array.isArray(raw.processes) ? raw.processes : []).map((p) => ({
            // "jp.net.seventhreeseven.dreamscape:cafetasks" -> "dreamscape:cafetasks" (the whole name is the description)
            pid: p.pid, name: String(p.name || p.pid).replace(/^(?:[\w-]+\.)+(?=[\w-]+(?::|$))/, ''), user: 'Melaton', cpu: num(p.cpuPct) || 0,
            memKB: num(p.privateKB) !== null ? num(p.privateKB) : num(p.rssKB), privateKB: num(p.privateKB), rssKB: num(p.rssKB),
            threads: num(p.threads) || 0, command: String(p.name || '')
        }));
        if (!short) prev = raw.at ? raw : { ...raw, at };
        const fx = fixed || {};
        return {
            at, source, host: hostName(), device: true,
            cpu: { name: fx.name || 'Processor', arch: fx.arch || '', total, cores: loads, mhz, maxMhz, freqPct: fr.length ? (fr.reduce((a, b) => a + b, 0) / fr.length) * 100 : null, gpu: f.gpu || null },
            memory,
            // the device's own up time (older apps do not say it: null, never the page's)
            uptimeSec: num(raw.uptimeMs) !== null ? Math.floor(num(raw.uptimeMs) / 1000) : null,
            threads: processes.reduce((t, p) => t + p.threads, 0) || null,
            processes,
            network,
            hardFaults: short ? last.hardFaults : faultsNow !== null && faultsWas !== null && dt ? Math.max(0, (faultsNow - faultsWas) / dt) : null
        };
    }

    /** One read through the synchronous bridge (older apps, DreamOS). */
    function readBridge() {
        const now = Date.now();
        fixedInfo();
        if (!memCache || now - memAt > MEM_MS) {
            const i = json('getInfo');
            if (i && i.memory) memCache = i.memory;
            memAt = now;
        }
        return { at: now, cpu: json('getCpuFrequencies') || { cores: [] }, memory: memCache || {}, uptimeMs: null, processes: [], net: [] };
    }

    function deliver(sample, force) {
        last = sample;
        const now = Date.now();
        activeSubs().forEach((s) => {
            // each view at its own speed (a 4 s Task Manager beside the Sidebar's 2 s meter)
            if (!force && s.at && now - s.at < s.ms * 0.8) return;
            s.at = now;
            try { s.onSample(sample); } catch (err) { console.warn('devicePerf subscriber failed:', err); }
        });
    }

    function onPush(ev) {
        const raw = ev && ev.detail;
        if (!raw || typeof raw !== 'object') return;
        if (!activeSubs().length || !seen()) { sync(); return; }
        fixedInfo();
        // the app's lease: renewed now and then while a view shows (a cheap call: it sets a time)
        if (Date.now() - renewedAt > RENEW_MS) { renewedAt = Date.now(); try { hw().startPerformance(pushMs); } catch (_) { /* gone */ } }
        deliver(normalise(raw, 'push'), false);
    }

    function listen(on) {
        if (on === listening) return;
        listening = on;
        const f = on ? 'addEventListener' : 'removeEventListener';
        doc[f]('visibilitychange', sync);
        root[f]('melatonscreen', sync);
        root[f](EVENT, onPush);
    }

    /** Start, re-time or stop the source for the views that show now. */
    function sync() {
        const act = seen() ? activeSubs() : [];
        const ms = act.length ? Math.max(500, Math.min(...act.map((s) => s.ms))) : 0;
        listen(subs.size > 0);
        if (has('startPerformance')) {
            if (ms && ms !== pushMs) {
                pushMs = ms;
                renewedAt = Date.now();
                try { hw().startPerformance(ms); } catch (_) { pushMs = 0; }
            } else if (!ms && pushMs) {
                pushMs = 0;
                try { hw().stopPerformance(); } catch (_) { /* gone */ }
            }
            return;
        }
        if (timer && (!ms || timer.ms !== ms)) { clearInterval(timer.id); timer = null; }
        if (ms && !timer) {
            const id = setInterval(() => { // perf: allow a live view's sampling at its update speed while it shows (older apps without startPerformance)
                if (!seen() || !activeSubs().length) { sync(); return; }
                if (stalled()) return;
                deliver(normalise(readBridge(), 'bridge'), false);
            }, ms);
            timer = { id, ms };
        }
    }

    function subscribe(opts, onSample) {
        const s = { ms: Math.max(500, Number(opts && opts.intervalMs) || 1000), isActive: opts && opts.isActive, onSample, at: 0 };
        subs.add(s);
        sync();
        // the first figures at once (a load needs two reads: the first sample's CPU reads 0 until the next)
        if (last && Date.now() - last.at < s.ms * 2) { s.at = Date.now(); setTimeout(() => { if (subs.has(s)) onSample(last); }, 0); }
        return () => { subs.delete(s); sync(); };
    }

    function refresh() {
        if (!available()) return null;
        if (stalled()) return last;
        let raw = null;
        if (has('getPerformance')) { raw = json('getPerformance'); if (raw) fixedInfo(); }
        const sample = normalise(raw || readBridge(), raw ? 'push' : 'bridge');
        deliver(sample, true);
        return sample;
    }

    function available() { return has('getCpuFrequencies'); }

    /** getInfo() (storage volumes, SoC, device), read when asked and kept INFO_MS: it is ~170 ms on the Fold. */
    let infoCache = null;
    let infoAt = 0;
    function info() {
        if (!available()) return null;
        if (!infoCache || Date.now() - infoAt > INFO_MS) {
            infoCache = json('getInfo') || infoCache;
            infoAt = Date.now();
            if (infoCache) fixedInfo(infoCache);
        }
        return infoCache;
    }

    root.melatonDevicePerf = { available, subscribe, wake: sync, latest: () => last, refresh, info, _normalise: normalise };
})(typeof window !== 'undefined' ? window : globalThis);
