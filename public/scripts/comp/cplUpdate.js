/**
 * Control Panel's Melaton Update page (Yukimi 2026-10-13): Vista's Windows Update for the
 * client's files. While the page is open, updates run in the foreground: opening it checks the
 * server, and every state the service worker reaches (serviceWorkerManager.js
 * _showServiceWorkerTrayPopup) shows here instead of the tray balloon, background downloads
 * included. Laid out and sized as on the Vista VM: the 580px status box (rgb(189,202,234) edge,
 * the 33px band with a 24px shield and 15px title, the text 34px in, the push button right),
 * then the facts. Band colours from wucltux.dll's UIFILE (red rgb(251,130,129), yellow
 * rgb(252,236,100), green rgb(175,233,176), blue rgb(145,203,211), each into white); shields
 * imageres.dll 98-101; bars are 7.css's [role=progressbar] (classic draws its own).
 *
 * Each state has its own look:
 *   preparing     blue band, no shield, "Preparing system to update...", a marquee bar (server compile)
 *   checking      blue band, no shield, "Checking for updates…", a marquee bar
 *   available     yellow, "Download and install updates for your computer", Install updates
 *   downloading   blue, "Downloading updates…", "Downloading n files (x% complete)", the bar
 *   installing    blue, "Installing updates…", a marquee bar (styles and assets applying live)
 *   ready         yellow, "Install updates for your computer" (they install without a restart), Install updates
 *   restart       yellow, "Restart Melaton to finish installing updates", Restart now
 *   upgrade       yellow, "Upgrade to Service Pack <YY>Q<1-4> <patchid>" (built from the file set), Restart now
 *   uptodate      green, "Melaton is up to date", Check for updates
 *   failed        red, "Melaton could not search for new updates", Try again
 *
 * Balloon wording for the tray (Vista's: only when something needs you) is balloonFor(state).
 *
 * DreamOS (#910): the machine's firmware updates - the OS base and CaféReady's components, which its system agent
 * checks, downloads and installs (dreamosFirmware.js) - get a second box of the same make under Melaton's: checking,
 * downloading (n of N, MB, %), installing, ready (components: Install updates, they need no restart; a base update:
 * Restart now), restart pending (installed, the next start boots it), up to date, failed. Their progress is pushed
 * by the host ('dreamosupdates'); they install at shut down / restart with Melaton's (installUpdatesAtShutdown).
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-cpl';
    let main = null;
    let view = { state: 'checking', message: '', progress: 0, filesTotal: 0 };
    let registered = false;
    let skipNextCheck = false;
    let pendingView = null;

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function sw() {
        return root.serviceWorkerManager || null;
    }

    function stamp(key) {
        let raw = null;
        try { raw = localStorage.getItem(key); } catch (_) { /* private mode */ }
        const n = Number(raw);
        if (!raw || !Number.isFinite(n) || n <= 0) return 'Never';
        const d = new Date(n);
        const today = new Date();
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return d.toDateString() === today.toDateString() ? `Today at ${time}` : `${d.toLocaleDateString()} at ${time}`;
    }

    /** The service worker's state words (preparing | checking | available | downloading | complete) as the page's. */
    function classify(state, message) {
        const m = String(message || '');
        const manager = sw();
        if (state === 'preparing') return 'preparing';
        if (state === 'downloading') return 'downloading';
        if (state === 'available') return 'available';
        if (state === 'upgrade') return 'upgrade';
        if (state === 'complete') {
            if (/apply without restart/i.test(m)) return 'ready';
            return manager && manager.hasPendingUpdates && manager.hasPendingUpdates() ? 'restart' : 'uptodate';
        }
        if (state === 'checking') {
            if (/failed|could not|error/i.test(m)) return 'failed';
            if (/up to date|no new updates/i.test(m)) return 'uptodate';
            return 'checking';
        }
        return 'checking';
    }

    /** Vista's Windows Update balloons: only for something that needs you; null = no balloon. */
    function balloonFor(state, message) {
        switch (state) {
            case 'available': return { title: 'Updates are available for Melaton', body: 'Click here to download and install them.' };
            case 'ready': return { title: 'Updates are ready to install', body: 'Click here to install them.' };
            case 'restart': return { title: 'Restart Melaton to finish installing updates', body: 'Click here to restart now or later.' };
            case 'upgrade': {
                const title = typeof message === 'string' && message.indexOf('Upgrade to Service Pack ') === 0
                    ? message
                    : 'Upgrade to Service Pack';
                return { title, body: 'Restart Melaton to install it.' };
            }
            default: return null;
        }
    }

    /** The tray icon's tooltip while nothing needs you (Vista: "Downloading updates (40%)"). */
    function tooltipFor(state, progress) {
        switch (state) {
            case 'preparing': return 'Preparing system to update...';
            case 'checking': return 'Checking for updates…';
            case 'downloading': return `Downloading updates (${Math.round(progress || 0)}%)`;
            case 'installing': return 'Installing updates…';
            case 'available': return 'Updates are available';
            case 'ready': return 'Updates are ready to install';
            case 'restart': return 'Restart Melaton to finish installing updates';
            case 'upgrade': return 'Upgrade to Service Pack';
            default: return 'Melaton Update';
        }
    }

    /** Where things stand when the page opens, before the check answers. */
    function initialState() {
        const manager = sw();
        if (!manager) return { state: 'failed', message: 'The update service is not running.' };
        if (manager.agentSession) return { state: 'failed', message: 'This is an agent session: its files are updated by the agent that runs it.' };
        if (manager.isUpdating) return { state: 'downloading', progress: manager.updateProgress || 0, filesTotal: (manager.trayPopup && manager.trayPopup.filesTotal) || 0 };
        if (manager.servicePack && manager.servicePack.label) return { state: 'upgrade', message: manager.servicePack.label };
        // the manager's one answer (updateAction, #1022), the same the phone's page and notification read
        const a = typeof manager.updateAction === 'function' ? manager.updateAction() : null;
        if (a && a.kind === 'apply') return { state: 'ready' };
        if (a && a.kind === 'restart') return { state: 'restart' };
        // files that still did not download after the worker's tries and the page's background rounds (#951): wucltux's
        // red "Some updates were not installed", on this page only (never a notification); Try again downloads them now
        if (manager.updateInstallFailure && manager.updateInstallFailure.count > 0) return { state: 'notinstalled', message: String(manager.updateInstallFailure.count) };
        // counted, not downloaded (#951, Check for updates but let me choose)
        const n = typeof manager.availableUpdateCount === 'function' ? manager.availableUpdateCount() : 0;
        if (n > 0) return { state: 'available', message: availableText(n) };
        return { state: 'checking' };
    }

    /** wucltux: "1 important update is available" / "N important updates are available". */
    function availableText(n) {
        return n === 1 ? '1 important update is available' : `${n} important updates are available`;
    }

    function bar(progress) {
        if (progress == null) return '<div class="cpl-wu-progress marquee" role="progressbar" aria-label="Working"></div>';
        const pct = Math.max(0, Math.min(100, Math.round(progress)));
        return `<div class="cpl-wu-progress animate" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>`;
    }

    function box() {
        const s = view.state;
        const files = view.filesTotal || (sw() && sw().pendingUpdateFilesTotal) || 0;
        const fileText = files ? `${files} ${files === 1 ? 'file' : 'files'}` : 'the updated files';
        const kinds = {
            preparing: {
                band: 'blue', title: 'Preparing system to update...',
                body: `<p>Getting the server ready to compile static assets.</p>${view.progress > 0 ? bar(view.progress) : bar(null)}`
            },
            checking: { band: 'blue', title: 'Checking for updates…', body: `<p>Looking for updates on the server.</p>${bar(null)}` },
            available: {
                band: 'yellow', shield: 'shield-warning', title: 'Download and install updates for your computer',
                body: (() => {
                    const n = sw() && typeof sw().availableUpdateCount === 'function' ? sw().availableUpdateCount() : 0;
                    const line = n ? availableText(n) : (view.message || 'Updates to Melaton are available.');
                    return `<p class="cpl-wu-strong">${esc(line)}</p><p>They download and install when you click Install updates, or when you restart or shut down Melaton.</p>`;
                })(),
                button: ['Install updates', 'install']
            },
            downloading: {
                band: 'blue', title: 'Downloading updates…',
                body: `<p>Downloading ${esc(fileText)} (${Math.round(view.progress || 0)}% complete)</p>${bar(view.progress || 0)}`
            },
            installing: { band: 'blue', title: 'Installing updates…', body: `<p>Installing ${esc(fileText)}. Melaton keeps running while they install.</p>${bar(null)}` },
            ready: {
                band: 'yellow', shield: 'shield-warning', title: 'Install updates for your computer',
                body: `<p>${esc(fileText.charAt(0).toUpperCase() + fileText.slice(1))} downloaded. They change styles and assets only, so they install without restarting Melaton.</p>`,
                button: ['Install updates', 'apply']
            },
            restart: {
                band: 'yellow', shield: 'shield-warning', title: 'Restart Melaton to finish installing updates',
                body: `<p>${esc(fileText.charAt(0).toUpperCase() + fileText.slice(1))} downloaded and ready.</p><p>Please save your work and close your windows before restarting.</p>`,
                button: ['Restart now', 'restart']
            },
            upgrade: {
                band: 'yellow', shield: 'shield-warning',
                title: view.message || 'Upgrade to Service Pack',
                body: '<p>This update is too large to install while Melaton is running. Restart to install it.</p><p>Please save your work and close your windows before restarting.</p>',
                button: ['Restart now', 'restart']
            },
            uptodate: { band: 'green', shield: 'shield-ok', title: 'Melaton is up to date', body: '<p>There are no updates available for your computer.</p>', button: ['Check for updates', 'check'] },
            notinstalled: {
                band: 'red', shield: 'shield-error', title: 'Some updates were not installed',
                body: `<p class="cpl-wu-error"><em>Failed updates:</em> ${esc(view.message || '1')}</p><p>Melaton tries them again with the next check. Check the connection to the server, then click Try again.</p>`,
                button: ['Try again', 'install']
            },
            failed: {
                band: 'red', shield: 'shield-error', title: 'Melaton could not search for new updates',
                body: `<p class="cpl-wu-error"><em>Error(s) found:</em></p><p>${esc(view.message || 'The server did not answer.')}</p>`,
                button: ['Try again', 'check']
            }
        };
        const k = kinds[s] || kinds.checking;
        return `
            <div class="cpl-wu-box cpl-wu-box--${esc(s)}">
                <div class="cpl-wu-band cpl-wu-band--${k.band}">
                    ${k.shield ? `<img class="cpl-wu-shield" src="${ART}/${k.shield}.png" alt="">` : ''}
                    <span class="cpl-wu-title">${esc(k.title)}</span>
                </div>
                <div class="cpl-wu-body">
                    <div class="cpl-wu-text">${k.body}</div>
                    ${k.button ? `<button type="button" class="cpl-wu-button" data-cpl-wu="${k.button[1]}">${esc(k.button[0])}</button>` : ''}
                </div>
            </div>`;
    }

    function facts() {
        const domain = typeof root.melatonDomainName === 'function' ? root.melatonDomainName() : 'DREAMSCAPE';
        const rows = [
            ['Most recent check for updates:', stamp('meletonUpdateCheckedAt')],
            ['Updates were installed:', stamp('meletonUpdateInstalledAt')],
            ['You have Melaton set to:', MODE_TEXT[updateSettings().get().mode] || MODE_TEXT.notify],
            ['You receive updates:', `From the ${domain} domain controller (${root.location ? root.location.hostname : 'this server'})`]
        ];
        const f = fw();
        if (f) {
            const s = f.state();
            rows.push(['Most recent check for firmware updates:', fwStamp(s.lastCheck)]);
            rows.push(['Firmware updates were installed:', fwStamp(s.lastInstall)]);
            rows.push(['You receive firmware updates:', `From the ${String(s.channel || '').replace(/^https?:\/\//, '') || 'DreamOS'} channel, checked by CaféReady`]);
        }
        return `<table class="cpl-wu-facts">${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>`;
    }

    // ---- firmware (DreamOS) ----------------------------------------------------------------------------------
    function fw() {
        const f = root.melatonFirmware;
        return f && f.available() ? f : null;
    }

    const mb = (b) => `${(Math.max(0, Number(b) || 0) / 1048576).toFixed(1)} MB`;

    function fwItems(list) {
        const f = fw();
        return `<ul class="cpl-wu-fw-list">${list.map((u) => `<li>${esc(f.label(u))}${u.restart ? ' (restart required)' : ''}${u.size ? ` - ${esc(mb(u.size))}` : ''}</li>`).join('')}</ul>`;
    }

    /** The firmware box: one state from the host's picture (see the header). */
    function fwBox() {
        const f = fw();
        if (!f) return '';
        const s = f.state();
        const p = s.progress || {};
        const running = s.busy && p.state === 'running';
        const available = Array.isArray(s.available) ? s.available : [];
        const staged = f.waiting();
        let k;
        if (running && p.step === 'check') {
            k = { band: 'blue', title: 'Checking for firmware updates…', body: `<p>Asking ${esc(String(s.channel || 'the update channel').replace(/^https?:\/\//, ''))} for new versions of DreamOS and CaféReady.</p>${bar(null)}` };
        } else if (running && (p.step === 'download' || p.step === 'verify')) {
            const pct = p.total > 0 ? (p.done / p.total) * 100 : 0;
            const what = p.step === 'verify' ? `Verifying ${esc(p.item || 'the update')}` : `Downloading ${esc(p.item || 'updates')}`;
            k = { band: 'blue', title: 'Downloading firmware updates…', body: `<p>${what} (${p.index || 1} of ${p.count || 1}, ${esc(mb(p.done))} of ${esc(mb(p.total))}, ${Math.round(pct)}% complete)</p>${bar(pct)}` };
        } else if (running && p.step === 'install') {
            const pct = p.total > 0 ? (p.done / p.total) * 100 : null;
            k = { band: 'blue', title: 'Installing firmware updates…', body: `<p>${esc(p.message || 'Installing')} (${p.index || 1} of ${p.count || 1}). Melaton keeps running while it installs.</p>${bar(pct)}` };
        } else if (staged.length && staged.some((u) => u.restart)) {
            k = { band: 'yellow', shield: 'shield-warning', title: 'Restart your computer to install firmware updates',
                body: `<p>These updates are downloaded and install when the computer shuts down or restarts:</p>${fwItems(staged)}<p>Please save your work and close your windows before restarting.</p>`, button: ['Restart now', 'fw-restart'] };
        } else if (staged.length) {
            k = { band: 'yellow', shield: 'shield-warning', title: 'Install firmware updates for your computer',
                body: `<p>These updates are downloaded. They install without restarting the computer (CaféReady starts again for a moment), or when it shuts down or restarts:</p>${fwItems(staged)}`, button: ['Install updates', 'fw-install'] };
        } else if (f.needsRestart()) {
            k = { band: 'yellow', shield: 'shield-warning', title: 'Restart your computer to finish installing firmware updates',
                body: `<p>DreamOS ${esc(s.nextBoot)} is installed and starts the next time the computer starts. This computer runs ${esc(s.running)} until then.</p>`, button: ['Restart now', 'fw-restart'] };
        } else if (p.state === 'failed' || (s.lastCheckOk === false) || (s.lastError && !(s.lastCheck > (s.lastErrorAt || 0)))) {
            k = { band: 'red', shield: 'shield-error', title: p.phase === 'staged' ? 'Firmware updates could not be installed' : 'DreamOS could not search for new firmware updates',
                body: `<p class="cpl-wu-error"><em>Error(s) found:</em></p><p>${esc(p.message || s.lastError || 'The update channel did not answer.')}</p>`, button: ['Try again', 'fw-check'] };
        } else if (available.length) {
            k = { band: 'yellow', shield: 'shield-warning', title: 'Download firmware updates for your computer', body: fwItems(available), button: ['Download updates', 'fw-check'] };
        } else {
            k = { band: 'green', shield: 'shield-ok', title: 'DreamOS firmware is up to date', body: `<p>There are no firmware updates for this computer. It runs DreamOS ${esc(s.running || '')}.</p>`, button: ['Check for updates', 'fw-check'] };
        }
        return `
            <div class="cpl-wu-box cpl-wu-box--firmware">
                <div class="cpl-wu-band cpl-wu-band--${k.band}">
                    ${k.shield ? `<img class="cpl-wu-shield" src="${ART}/${k.shield}.png" alt="">` : ''}
                    <span class="cpl-wu-title">${esc(k.title)}</span>
                </div>
                <div class="cpl-wu-body">
                    <div class="cpl-wu-text">${k.body}</div>
                    ${k.button ? `<button type="button" class="cpl-wu-button" data-cpl-wu="${k.button[1]}">${esc(k.button[0])}</button>` : ''}
                </div>
            </div>`;
    }

    function fwStamp(sec) {
        const n = Number(sec);
        if (!Number.isFinite(n) || n <= 0) return 'Never';
        const d = new Date(n * 1000);
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return d.toDateString() === new Date().toDateString() ? `Today at ${time}` : `${d.toLocaleDateString()} at ${time}`;
    }

    function paint() {
        if (!main || !main.isConnected) return;
        const host = main.querySelector('.cpl-wu-status');
        if (host) host.innerHTML = box();
        const fh = main.querySelector('.cpl-wu-fw');
        if (fh) fh.innerHTML = fwBox();
        const f = main.querySelector('.cpl-wu-facts-host');
        if (f) f.innerHTML = facts();
    }

    function check(run) {
        const manager = sw();
        if (!manager) return;
        // refreshServerCacheAndCheck: public/scripts/comp/serviceWorkerManager.js
        const start = typeof run === 'function'
            ? run
            : (typeof manager.refreshServerCacheAndCheck === 'function'
                ? () => manager.refreshServerCacheAndCheck()
                : () => manager.checkStaticFileUpdates(false));
        view = { state: 'preparing', message: '', progress: 0, filesTotal: 0 };
        paint();
        // the foreground check (noToast = false): its states come back through foregroundUpdateView
        Promise.resolve(start()).then(() => {
            // a check that found nothing to say (already downloading elsewhere) leaves the box as it was
            if ((view.state === 'checking' || view.state === 'preparing') && !manager.isUpdating) {
                view = initialState();
                if (view.state === 'checking' || view.state === 'preparing') view = { state: 'uptodate' };
                paint();
            }
        });
    }

    function act(what) {
        const manager = sw();
        if (!manager) return;
        if (what === 'fw-check' || what === 'fw-install' || what === 'fw-restart') {
            const f = fw();
            if (!f) return;
            if (what === 'fw-check') void f.check().then(paint);
            else if (what === 'fw-install') void f.install({ componentsOnly: true }).then(paint);
            // the restart installs what is staged on the way down (winlogonPower.js / installUpdatesAtShutdown)
            else if (typeof root.runWinlogonPower === 'function') void root.runWinlogonPower('restart');
            paint();
            return;
        }
        // Install updates / Restart now: the one install flow every update button uses (serviceWorkerManager.installUpdates,
        // #1022). Counted updates download now - what applies live does, the rest waits for the restart (the page then
        // shows Restart now and Vista's restart prompt follows); downloaded styles and pictures install live; a restart
        // goes through forceRestart
        const action = typeof manager.updateAction === 'function' ? manager.updateAction() : null;
        if ((what === 'install' || what === 'apply' || what === 'restart') && action && action.kind !== 'busy'
            && typeof manager.installUpdates === 'function') {
            if (action.kind === 'apply') view = { ...view, state: 'installing' };
            else if (action.kind === 'install') view = { ...view, state: 'downloading', progress: 0 };
            paint();
            Promise.resolve(manager.installUpdates()).then((done) => {
                if (done === 'restart' || manager.isUpdating) return;
                // after a live install: what still waits (counted updates, a restart owed), else up to date
                view = initialState();
                if (view.state === 'checking') view = { state: 'uptodate' };
                paint();
            });
            return;
        }
        if (what === 'check' || what === 'install') {
            // Check for updates looks for firmware too (the host pushes what it finds)
            if (what === 'check' && fw()) void fw().check();
            if (typeof manager.refreshServerCacheAndCheck === 'function') {
                manager.refreshServerCacheAndCheck();
                return;
            }
            check();
        }
    }

    let fwWatch = null;
    function mount(el) {
        main = el;
        if (fwWatch) fwWatch.abort();
        fwWatch = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (fw()) fw().onChange(() => paint(), fwWatch ? fwWatch.signal : null);
        const manager = sw();
        if (manager) {
            const own = (state, info) => {
                view = { state: classify(state, info && info.message), message: info && info.message, progress: info && info.progress, filesTotal: info && info.filesTotal };
                paint();
            };
            // the page closed any way but Control Panel's own close (the taskbar, the window restarted, another page):
            // the manager drops the hook instead of routing every later state and balloon to it (serviceWorkerManager
            // foregroundUpdateView getter, #951)
            own.isAlive = () => !!(main === el && el.isConnected && !el.closest('[hidden], .hidden'));
            manager.foregroundUpdateView = own;
        }
        view = { ...{ message: '', progress: 0, filesTotal: 0 }, ...(pendingView || initialState()) };
        pendingView = null;
        paint();
        if (view.state === 'checking' && !skipNextCheck) check();
        skipNextCheck = false;
        const modal = el.closest('.modal');
        if (modal && !modal.dataset.cplWuWired) {
            modal.dataset.cplWuWired = '1';
            modal.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-cpl-wu]');
                if (b) act(b.dataset.cplWu);
            });
        }
    }

    function unmount() {
        const manager = sw();
        if (manager && manager.foregroundUpdateView) manager.foregroundUpdateView = null;
        if (fwWatch) { fwWatch.abort(); fwWatch = null; }
        main = null;
    }

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerItem({
            id: 'meleton-update',
            name: 'Melaton Update',
            image: `${ART}/windows-update-32.png`,
            description: 'Check for updates to Melaton and install them.',
            open: () => cpl.open('update')
        });
        cpl.registerPage('update', {
            title: () => 'Melaton Update',
            tasks: () => `
                <div class="cpl-task-group">
                    <ul class="cpl-task-list">
                        <li><button type="button" class="cpl-link cpl-link--icon" data-cpl-wu="check"><img src="/static_images/vista-ie/refresh.png" alt="">Check for updates</button></li>
                        <li><button type="button" class="cpl-link" data-cpl-action="nav" data-cpl-arg="update-settings">Change settings</button></li>
                        <li><button type="button" class="cpl-link" data-cpl-action="nav" data-cpl-arg="update-history">View update history</button></li>
                        <li><button type="button" class="cpl-link" data-cpl-action="nav" data-cpl-arg="update-applied">Applied updates</button></li>
                    </ul>
                </div>
                <div class="cpl-task-group cpl-task-group--see-also">
                    <h3 class="cpl-task-heading">See also</h3>
                    <ul class="cpl-task-list">
                        ${cpl.taskLinkHtml('Network and Server Center', 'nav', 'network')}
                        ${cpl.taskLinkHtml('System', 'item', 'system')}
                    </ul>
                </div>`,
            body: () => `
                <div class="cpl-wu-page">
                    <h1 class="cpl-page-title">Melaton Update</h1>
                    <div class="cpl-wu-status"></div>
                    <div class="cpl-wu-fw"></div>
                    <div class="cpl-wu-facts-host"></div>
                </div>`,
            mount,
            unmount
        });
        registerApplied(cpl);
        registerHistory(cpl);
        registerSettings(cpl);
        return true;
    }

    // ---- Change settings (#945, #951): Vista's "Choose how Windows can install updates" (wucltux.dll.mui 1100-1117):
    // its three ways that apply here. Check for updates but let me choose is the default (Yukimi): updates are
    // counted, and a restart or shut down (or Install updates) downloads and installs them.
    const updateSettings = () => root.melatonUpdateSettings || { get: () => ({ mode: 'notify', auto: false, warnMin: 5 }), save: (x) => x };
    const restartPrompt = () => root.melatonRestartPrompt || { settings: () => updateSettings().get(), save: (x) => x, schedule() {}, cancel() {} };
    const MODE_TEXT = {
        auto: 'Install updates automatically (recommended)',
        download: 'Download updates but let me choose whether to install them',
        notify: 'Check for updates but let me choose whether to download and install them'
    };
    const WARN_TEXT = { 1: '1 minute', 5: '5 minutes', 15: '15 minutes' };
    function settingsBody() {
        const st = updateSettings().get();
        const radio = (value, label, desc) => `<div class="cpl-vradio cpl-wu-radio"><input type="radio" name="cpl-wu-mode" id="cpl-wu-mode-${value}" value="${value}"${value === st.mode ? ' checked' : ''}><label for="cpl-wu-mode-${value}">${esc(label)}</label>${desc || ''}</div>`;
        const warn = `<p class="cpl-vtext cpl-wu-warn">Warn me before restarting: <button type="button" class="custom-dropdown-btn vista-combo-list" data-cpl-wu-warn="${st.warnMin}">${esc(WARN_TEXT[st.warnMin])}</button></p>`;
        return `<div class="cpl-vpage cpl-spoke"><div class="cpl-spoke-pane">
                <h1 class="cpl-vtitle">Choose how Melaton can install updates</h1>
                <p class="cpl-vtext">When your computer is online, Melaton can check for important updates and install them using these settings. When new updates are available, you can also install them before shutting down the computer.</p>
                <div class="cpl-vsection"><span>Important updates</span></div>
                ${radio('auto', MODE_TEXT.auto, warn)}
                ${radio('download', MODE_TEXT.download)}
                ${radio('notify', MODE_TEXT.notify)}
                <p class="cpl-vtext">Melaton never restarts while a program has unsaved work: it asks you first, as when you shut down.</p>
            </div>
            <div class="cpl-spoke-commands"><div class="cpl-spoke-buttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-wu-set="ok">OK</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-wu-set="cancel">Cancel</button></div></div></div>`;
    }
    function settingsMount(el) {
        const cpl = root.melatonControlPanel;
        const btn = el.querySelector('[data-cpl-wu-warn]');
        const cm = root.contextMenu;
        // the kit's combo (no native select): 1 / 5 / 15 minutes
        if (btn && cm && typeof cm.attachPickerMenu === 'function') {
            cm.attachPickerMenu(btn, {
                items: () => Object.keys(WARN_TEXT).map((k) => ({ value: k, text: WARN_TEXT[k] })),
                value: () => btn.dataset.cplWuWarn,
                onSelect: (value) => { btn.dataset.cplWuWarn = String(value); btn.textContent = WARN_TEXT[value] || ''; }
            });
        }
        el.querySelectorAll('[data-cpl-wu-set]').forEach((b) => b.addEventListener('click', () => {
            if (b.dataset.cplWuSet === 'ok') {
                const on = el.querySelector('input[name="cpl-wu-mode"]:checked');
                const mode = on ? on.value : 'notify';
                const was = updateSettings().get().mode;
                updateSettings().save({ mode, warnMin: Number(btn ? btn.dataset.cplWuWarn : 5) || 5 });
                // automatic with a restart waiting: the prompt asks now; otherwise no countdown is left running
                const p = restartPrompt();
                if (mode === 'auto') p.schedule(500); else p.cancel();
                // now downloading in the background: what was only counted comes down
                const m = root.serviceWorkerManager;
                if (was === 'notify' && mode !== 'notify' && m && typeof m.installAvailableUpdates === 'function'
                    && typeof m.availableUpdateCount === 'function' && m.availableUpdateCount() > 0) void m.installAvailableUpdates();
            }
            cpl.open('update');
        }));
    }
    function registerSettings(cpl) {
        cpl.registerPage('update-settings', {
            parent: 'update',
            title: () => 'Change settings',
            tasks: () => '',
            body: settingsBody,
            mount: settingsMount
        });
    }

    // ---- View update history (#872): Vista's "Review your update history". Live updates (an app or
    // a program updated without a restart) and the updates installed by a restart, newest first.
    let historyCtl = null;
    function historyBody() {
        const manager = sw();
        let rows = manager && typeof manager.updateHistory === 'function' ? manager.updateHistory() : [];
        // DreamOS: what the system agent installed itself (its components live, a base on the way down)
        const f = fw();
        if (f) {
            const own = (Array.isArray(f.state().history) ? f.state().history : []).map((h) => ({ name: `${h.name} (firmware)`, status: h.status, importance: 'Important', at: Number(h.at) * 1000 }));
            rows = rows.concat(own.filter((h) => !rows.some((r) => r.name === h.name && Math.abs((Number(r.at) || 0) - h.at) < 15 * 60 * 1000)))
                .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
        }
        const date = (at) => { const d = new Date(Number(at) || 0); return Number.isFinite(d.getTime()) && d.getTime() > 0 ? d.toLocaleDateString() : ''; };
        // fixed table layout (cpl-vtable): every cell carries its full text as a tooltip
        const cell = (v) => `<td title="${esc(v)}">${esc(v)}</td>`;
        const body = rows.map((r) => `<tr>${cell(r.name)}${cell(r.status)}${cell(r.importance)}${cell(date(r.at))}</tr>`).join('');
        return `<div class="cpl-vpage cpl-vwide">
            <h1 class="cpl-vtitle">Review your update history</h1>
            <p class="cpl-vtext">Check the Status column to ensure all important updates were successful. Updates for programs install while Melaton runs; the others install when Melaton restarts.</p>
            <table class="cpl-vtable cpl-wu-history"><colgroup><col><col style="width:80px"><col style="width:100px"><col style="width:92px"></colgroup><tr class="is-head"><td>Name</td><td>Status</td><td>Importance</td><td>Date Installed</td></tr>${body || '<tr><td colspan="4">No updates have been installed on this computer yet.</td></tr>'}</table>
        </div>`;
    }
    function registerHistory(cpl) {
        cpl.registerPage('update-history', {
            parent: 'update',
            title: () => 'View update history',
            tasks: () => '',
            body: historyBody,
            mount: (el) => {
                // a live update while the page is open shows at once
                if (historyCtl) historyCtl.abort();
                historyCtl = new AbortController();
                const ctl = historyCtl;
                document.addEventListener('melaton:update-history', () => { if (el.isConnected) cpl.open('update-history'); else ctl.abort(); }, { signal: ctl.signal });
            },
            unmount: () => { if (historyCtl) { historyCtl.abort(); historyCtl = null; } }
        });
    }

    // ---- Applied updates (Yozora #774): the asset packages this computer keeps
    // (assetPackages.js). A computer that also runs Melaton Mobile (a phone with a desktop in DeX)
    // adds Melaton Mobile's packages here, so they are on it before it starts on the phone screen.
    let pkgInfo = null;
    let pkgSel = null;
    let pkgAdding = null;
    const mbText = (b) => `${(Number(b || 0) / 1048576).toFixed(1)} MB`;
    // open() on the page that is already showing only raises the window: repaint it in place
    const repaintApplied = () => {
        const cpl = root.melatonControlPanel;
        if (!cpl) return;
        if (typeof cpl.currentPage === 'function' && cpl.currentPage() === 'update-applied' && typeof cpl.navigate === 'function') cpl.navigate('update-applied', { replace: true });
        else cpl.open('update-applied');
    };
    function appliedBody() {
        const pk = root.melatonPackages;
        if (!pk) return '<div class="cpl-vpage"><h1 class="cpl-vtitle">Applied updates</h1><p class="cpl-vtext">Update packages are not available in this version of Melaton.</p></div>';
        if (!pkgInfo) {
            pkgInfo = [];
            fetch('/install/packages', { cache: 'no-store', credentials: 'same-origin' }).then((r) => r.json())
                .then((j) => { pkgInfo = j && j.packages ? j.packages : []; repaintApplied(); })
                .catch(() => { /* sizes stay blank */ });
        }
        const info = new Map(pkgInfo.map((x) => [x.id, x]));
        const size = (id) => (info.has(id) && info.get(id).bytes > 0 ? mbText(info.get(id).bytes) : '');
        const active = pk.current();
        const auto = new Set(pk.automatic());
        if (pkgAdding) {
            const choices = pk.PACKAGES.filter((p) => !active.includes(p.id));
            const rows = choices.map((p) => `<tr><td><input type="checkbox" id="cpl-pkg-${esc(p.id)}" data-pkg="${esc(p.id)}"${pkgAdding.has(p.id) ? ' checked' : ''}><label for="cpl-pkg-${esc(p.id)}"> ${esc(p.label)}</label></td><td>${esc(size(p.id))}</td></tr>`).join('');
            return `<div class="cpl-vpage cpl-vwide">
                <h1 class="cpl-vtitle">Add an update package from Melaton Update</h1>
                <p class="cpl-vtext">Packages hold Melaton Mobile's pictures for a version and a screen density (HiDPI = 2x, UHiDPI = 4x).</p>
                <table class="cpl-vtable cpl-wu-pkgs"><colgroup><col style="width:80%"><col style="width:20%"></colgroup><tr class="is-head"><td>Name</td><td>Size</td></tr>${rows || '<tr><td colspan="2">Every package is already on this computer.</td></tr>'}</table>
                <div class="cpl-vbuttons"><button type="button" class="tbp-button cpl-vbutton" data-cpl-pkg="add"${choices.length ? '' : ' disabled'}>Add</button><button type="button" class="tbp-button cpl-vbutton" data-cpl-pkg="cancel">Cancel</button></div>
            </div>`;
        }
        const rows = active.map((id) => {
            const p = pk.PACKAGES.find((x) => x.id === id) || { label: id };
            return `<tr data-pkg-row="${esc(id)}"${id === pkgSel ? ' class="is-selected"' : ''}><td>${esc(p.label)}</td><td>${esc(size(id))}</td><td>${auto.has(id) ? 'In use' : 'Added'}</td></tr>`;
        }).join('');
        return `<div class="cpl-vpage cpl-vwide">
            <h1 class="cpl-vtitle">Applied updates</h1>
            <p class="cpl-vtext">The update packages on this computer besides Melaton itself. Packages in use come with the Melaton Mobile this computer runs and its screen.</p>
            <table class="cpl-vtable cpl-wu-pkgs"><colgroup><col style="width:62%"><col style="width:18%"><col style="width:20%"></colgroup><tr class="is-head"><td>Name</td><td>Size</td><td>Status</td></tr>${rows || '<tr><td colspan="3">Only Melaton itself is on this computer.</td></tr>'}</table>
            <div class="cpl-vbuttons">
                <button type="button" class="tbp-button cpl-vbutton" data-cpl-pkg="more">Add an update package from Melaton Update...</button>
                <button type="button" class="tbp-button cpl-vbutton" data-cpl-pkg="remove"${pkgSel && active.includes(pkgSel) && !auto.has(pkgSel) ? '' : ' disabled'}>Remove</button>
            </div>
            <p class="cpl-vtext">Removed packages are deleted the next time Melaton tidies its files.</p>
        </div>`;
    }
    function appliedMount(el) {
        const cpl = root.melatonControlPanel;
        const reopen = repaintApplied;
        el.querySelectorAll('[data-pkg-row]').forEach((tr) => tr.addEventListener('click', () => { pkgSel = tr.dataset.pkgRow; reopen(); }));
        el.querySelectorAll('input[data-pkg]').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) pkgAdding.add(cb.dataset.pkg); else pkgAdding.delete(cb.dataset.pkg); }));
        el.querySelectorAll('[data-cpl-pkg]').forEach((b) => b.addEventListener('click', async () => {
            const pk = root.melatonPackages;
            const what = b.dataset.cplPkg;
            if (what === 'more') { pkgAdding = new Set(); reopen(); return; }
            if (what === 'cancel') { pkgAdding = null; reopen(); return; }
            if (what === 'remove') { if (pkgSel) pk.unpin(pkgSel); pkgSel = null; reopen(); return; }
            if (what === 'add') {
                const ids = [...pkgAdding]; pkgAdding = null;
                let change = null;
                for (const id of ids) { const c = pk.pin(id); change = change ? { added: change.added.concat(c.added), removed: [] } : c; }
                reopen();
                const manager = sw();
                if (change && change.added.length && manager && typeof manager.applyPackageChange === 'function') {
                    const ask = (text) => (typeof root.showConfirmationDialog === 'function'
                        ? root.showConfirmationDialog(text, [{ text: 'Restart now', value: true }, { text: 'Later', value: false }])
                        : Promise.resolve(false));
                    const done = await manager.applyPackageChange(change, { confirmLarge: ({ bytes }) => ask(`The packages are ${mbText(bytes)}. Melaton must restart to install them. Restart now?`) }).catch(() => null);
                    if (done && done.action === 'later' && typeof root.showGlassToast === 'function') root.showGlassToast('info', 'Melaton Update', 'The packages are installed the next time Melaton restarts.', false, 5000);
                }
            }
        }));
    }
    function registerApplied(cpl) {
        cpl.registerPage('update-applied', {
            parent: 'update',
            title: () => 'Applied updates',
            tasks: () => '',
            body: appliedBody,
            mount: appliedMount
        });
    }

    /** Open the page on the prepare stage; refreshServerCacheAndCheck drives compile then check. */
    function beginPrepare() {
        if (!register()) return false;
        skipNextCheck = true;
        pendingView = { state: 'preparing', message: '', progress: 0, filesTotal: 0 };
        view = pendingView;
        root.melatonControlPanel.open('update');
        paint();
        return true;
    }

    /** Open the page; with run (the tray's Check for updates), that check runs in the foreground here. */
    function open(run) {
        if (!register()) return false;
        const cpl = root.melatonControlPanel;
        if (typeof run === 'function') {
            skipNextCheck = true;
            cpl.open('update');
            check(run);
            return true;
        }
        cpl.open('update');
        return true;
    }

    root.cplUpdate = { register, open, beginPrepare, balloonFor, tooltipFor, classify, _test: { classify, balloonFor, tooltipFor, box: (v) => { view = { message: '', progress: 0, filesTotal: 0, ...v }; return box(); } } };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplUpdate;
})(typeof window !== 'undefined' ? window : globalThis);
