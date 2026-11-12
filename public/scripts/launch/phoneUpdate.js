/**
 * Melaton Mobile pre-launch installer (Yozora #760 item 2): a phone start's /launch installs the
 * whole asset set before /app, so Melaton Mobile never boots with half its files. The screen is a
 * phone maker's Software Update page (Samsung Experience's "Downloading updates..." layout, Yukimi
 * Nov 11 2026) in Xyridian's colours: the blue ring for the band and bar, the star orange for the
 * arrow. launch-phone-update.css, markup #phoneUpdate in launch.html.
 *
 * The work is the desktop Setup's (updateEngine.js, #419): check the server manifest against the
 * service worker cache; a small update (needsInstaller false) downloads silently behind the OEM
 * logo; a large one copies the pack (bytes = the bar), expands it and installs both groups. The
 * engine's install state (melatonInstall) survives a reload, so a reload mid-install comes back
 * here. Resolves when /app may start; a failure shows Retry on the same screen.
 */
(function (root) {
    'use strict';

    const CHECK_TIMEOUT_MS = 30000;
    const POLL_MS = 1500;
    const DONE_HOLD_MS = 1200;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function env() {
        const win = root;
        return {
            window: win,
            fetch: win.fetch.bind(win),
            navigator: win.navigator,
            localStorage: (() => { try { return win.localStorage; } catch (_) { return null; } })(),
            caches: win.caches || null,
            now: () => Date.now(),
            sleep
        };
    }

    /** "1.33MB" as the device writes it: two decimals, binary megabytes. */
    function mb(bytes) {
        return `${(Math.max(0, bytes || 0) / 1048576).toFixed(2)}MB`;
    }

    /** "--:--:--" until there is a rate, then hh:mm:ss left. */
    function eta(startedAt, fraction) {
        if (!(fraction > 0.02) || fraction >= 1) return '--:--:--';
        const spent = (Date.now() - startedAt) / 1000;
        const left = Math.max(0, Math.round(spent / fraction - spent));
        const h = Math.floor(left / 3600);
        const m = Math.floor((left % 3600) / 60);
        const s = left % 60;
        return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
    }

    function view() {
        const el = document.getElementById('phoneUpdate');
        if (!el) return null;
        const q = (sel) => el.querySelector(sel);
        return {
            el,
            show() {
                el.hidden = false;
                document.documentElement.classList.add('phone-update-up');
            },
            hide() {
                el.hidden = true;
                document.documentElement.classList.remove('phone-update-up');
            },
            set({ state, title, time, fraction, left, right, button }) {
                if (state) el.dataset.state = state;
                if (title != null) q('.pu-status').textContent = title;
                if (time != null) q('.pu-time').textContent = time;
                if (fraction != null) {
                    const pct = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
                    q('.pu-bar > span').style.width = `${pct}%`;
                    q('.pu-bar').setAttribute('aria-valuenow', String(pct));
                }
                if (left != null) q('.pu-left').textContent = left;
                if (right != null) q('.pu-right').textContent = right;
                const btn = q('.pu-button');
                if (button === undefined) return;
                btn.hidden = !button;
                if (button) btn.textContent = button;
            },
            onButton(fn) {
                q('.pu-button').onclick = fn;
            }
        };
    }

    /** Check until the engine has a file list (a runtime compile has none yet), or give up. */
    async function findUpdates(engine, e) {
        const started = Date.now();
        let workerOk = false;
        for (;;) {
            workerOk = await engine.ensureWorker(e).catch(() => false);
            const found = await engine.check(e).catch(() => null);
            const noList = !found || found.failed || (found.skipped && found.skipped !== 'no-cache-storage');
            if (!noList) return { found, workerOk };
            if (Date.now() - started > CHECK_TIMEOUT_MS) return { found: null, workerOk };
            await sleep(POLL_MS);
        }
    }

    /** A small update behind the logo: the worker's download, then the pack for what it missed. */
    async function silent(engine, e, found, workerOk) {
        let left = found.files;
        if (workerOk) {
            const done = await engine.download(e, found.files, { silent: true }).catch(() => null);
            if (!done || done.ok !== false) left = (await engine.verify(e, found.files).catch(() => null)) || found.files;
        }
        if (!left.length) return;
        const manifest = found.manifest || found.files;
        const copied = await engine.copyPack(e, manifest, { subset: left }).catch(() => null);
        if (!copied || !copied.ok) return;
        const expanded = await engine.expandPack(e, manifest).catch(() => null);
        if (!expanded || !expanded.ok) return;
        for (const group of ['features', 'updates']) await engine.installGroup(e, group).catch(() => null);
    }

    /**
     * The Software Update screen: one bar, download 0-75 % (bytes), then extracting and installing
     * 75-100 % (Yozora #774). The download asks for the files this phone needs (a subset zip, its
     * own package set's pack past updateEngine's subsetMax), never the whole server pack.
     */
    const DOWNLOAD_SHARE = 0.75;
    async function install(engine, e, found, v) {
        const manifest = found.manifest || found.files;
        const total = found.bytes || 0;
        engine.writeState(e, { startedAt: Date.now(), total: found.files.length });
        v.show();
        v.set({ state: 'download', title: 'Downloading updates…', time: '--:--:--', fraction: 0, left: '0%', right: `${mb(0)}/${mb(total)}`, button: null });

        const startedAt = Date.now();
        const copied = await engine.copyPack(e, manifest, {
            subset: found.files,
            onProgress: (p) => {
                const f = p.fraction || 0;
                const got = p.total ? p.received : f * total;
                const of = p.total || total;
                const all = f * DOWNLOAD_SHARE;
                v.set({ fraction: all, left: `${Math.floor(all * 100)}%`, right: `${mb(got)}/${mb(of)}`, time: eta(startedAt, f) });
            }
        }).catch((err) => ({ ok: false, error: String(err && err.message || err) }));
        if (!copied || !copied.ok) return { ok: false, why: copied && copied.stalled ? 'stalled' : 'download' };

        // extracting and installing, 75-100 %: expanding is half of it, the two groups the rest
        const share = { expand: [0, 0.5], features: [0.5, 0.8], updates: [0.8, 1] };
        const step = (name) => (p) => {
            const [a, b] = share[name];
            const f = DOWNLOAD_SHARE + (1 - DOWNLOAD_SHARE) * (a + (b - a) * (p.fraction || 0));
            v.set({ fraction: f, left: `${Math.floor(f * 100)}%` });
        };
        v.set({ state: 'install', title: 'Installing updates…', time: '', fraction: DOWNLOAD_SHARE, left: `${Math.round(DOWNLOAD_SHARE * 100)}%`, right: `${found.files.length} files` });
        const expanded = await engine.expandPack(e, manifest, { onProgress: step('expand') }).catch(() => null);
        if (!expanded || !expanded.ok) return { ok: false, why: 'verify' };
        const stragglers = new Set((expanded.missing || []).concat(copied.absent || []));
        for (const group of ['features', 'updates']) {
            const written = await engine.installGroup(e, group, { onProgress: step(group) }).catch(() => null);
            if (!written || !written.ok) return { ok: false, why: 'verify' };
            (written.mismatched || []).forEach((u) => stragglers.add(u));
        }
        engine.writeRecord(e, { completedAt: Date.now(), files: found.files.length, bytes: total, stragglers: [...stragglers] });
        engine.writeState(e, null);
        try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) { /* best effort */ }
        v.set({ state: 'done', title: 'Software updated', time: '', fraction: 1, left: '100%', right: '', button: null });
        await sleep(DONE_HOLD_MS);
        return { ok: true };
    }

    const FAIL_TEXT = {
        download: 'Couldn’t download updates. Check your connection and try again.',
        stalled: 'The download stopped. Check your connection and try again.',
        verify: 'Couldn’t install updates. Try again.'
    };

    /** Resolves when /app may start (installed, nothing to do, or no way to check here). */
    async function run() {
        const engine = root.melatonUpdateEngine;
        const v = view();
        if (!engine || !v || !root.caches) return { skipped: true };
        const e = env();
        for (;;) {
            const { found, workerOk } = await findUpdates(engine, e);
            if (!found || found.skipped || !found.files || !found.files.length) {
                if (engine.readState(e)) engine.writeState(e, null);
                v.hide();
                return { installed: false };
            }
            if (!engine.needsInstaller(e, found.files)) {
                await silent(engine, e, found, workerOk);
                return { installed: false, silent: true };
            }
            const result = await install(engine, e, found, v);
            if (result.ok) return { installed: true };
            v.set({ state: 'error', title: FAIL_TEXT[result.why] || FAIL_TEXT.download, time: '', button: 'RETRY' });
            await new Promise((resolve) => v.onButton(() => { v.onButton(null); resolve(); }));
        }
    }

    /** Design review: paint a state without doing any work. */
    function preview(state) {
        const v = view();
        if (!v) return;
        v.show();
        const s = state || 'download';
        if (s === 'download') v.set({ state: s, title: 'Downloading updates…', time: '00:03:12', fraction: 0.23, left: '23%', right: `${mb(41.9e6)}/${mb(135.2e6)}`, button: null });
        else if (s === 'install') v.set({ state: s, title: 'Installing updates…', time: '', fraction: 0.86, left: '86%', right: '5725 files', button: null });
        else if (s === 'done') v.set({ state: s, title: 'Software updated', time: '', fraction: 1, left: '100%', right: '', button: null });
        else v.set({ state: 'error', title: FAIL_TEXT.download, time: '', button: 'RETRY' });
    }

    root.melatonPhoneUpdate = { run, preview };
})(typeof window !== 'undefined' ? window : this);
