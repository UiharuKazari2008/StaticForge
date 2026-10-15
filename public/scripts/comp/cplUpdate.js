/**
 * Control Panel's MeletonFX Update page (Yukimi 2026-10-13): Vista's Windows Update for the
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
 *   restart       yellow, "Restart MeletonFX to finish installing updates", Restart now
 *   upgrade       yellow, "Upgrade to Service Pack <YY>Q<1-4> <patchid>" (built from the file set), Restart now
 *   uptodate      green, "MeletonFX is up to date", Check for updates
 *   failed        red, "MeletonFX could not search for new updates", Try again
 *
 * Balloon wording for the tray (Vista's: only when something needs you) is balloonFor(state).
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
            case 'available': return { title: 'Updates are available for MeletonFX', body: 'Click here to download and install them.' };
            case 'ready': return { title: 'Updates are ready to install', body: 'Click here to install them.' };
            case 'restart': return { title: 'Restart MeletonFX to finish installing updates', body: 'Click here to restart now or later.' };
            case 'upgrade': {
                const title = typeof message === 'string' && message.indexOf('Upgrade to Service Pack ') === 0
                    ? message
                    : 'Upgrade to Service Pack';
                return { title, body: 'Restart MeletonFX to install it.' };
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
            case 'restart': return 'Restart MeletonFX to finish installing updates';
            case 'upgrade': return 'Upgrade to Service Pack';
            default: return 'MeletonFX Update';
        }
    }

    /** Where things stand when the page opens, before the check answers. */
    function initialState() {
        const manager = sw();
        if (!manager) return { state: 'failed', message: 'The update service is not running.' };
        if (manager.agentSession) return { state: 'failed', message: 'This is an agent session: its files are updated by the agent that runs it.' };
        if (manager.isUpdating) return { state: 'downloading', progress: manager.updateProgress || 0, filesTotal: (manager.trayPopup && manager.trayPopup.filesTotal) || 0 };
        if (manager.servicePack && manager.servicePack.label) return { state: 'upgrade', message: manager.servicePack.label };
        if (manager.pendingApplyFiles && manager.pendingApplyFiles.length) return { state: 'ready' };
        if (manager.hasPendingUpdates && manager.hasPendingUpdates()) return { state: 'restart' };
        return { state: 'checking' };
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
                body: `<p>${esc(view.message && !/available\.?$/i.test(view.message) ? view.message : 'Updates to MeletonFX are available.')}</p>`,
                button: ['Install updates', 'install']
            },
            downloading: {
                band: 'blue', title: 'Downloading updates…',
                body: `<p>Downloading ${esc(fileText)} (${Math.round(view.progress || 0)}% complete)</p>${bar(view.progress || 0)}`
            },
            installing: { band: 'blue', title: 'Installing updates…', body: `<p>Installing ${esc(fileText)}. MeletonFX keeps running while they install.</p>${bar(null)}` },
            ready: {
                band: 'yellow', shield: 'shield-warning', title: 'Install updates for your computer',
                body: `<p>${esc(fileText.charAt(0).toUpperCase() + fileText.slice(1))} downloaded. They change styles and assets only, so they install without restarting MeletonFX.</p>`,
                button: ['Install updates', 'apply']
            },
            restart: {
                band: 'yellow', shield: 'shield-warning', title: 'Restart MeletonFX to finish installing updates',
                body: `<p>${esc(fileText.charAt(0).toUpperCase() + fileText.slice(1))} downloaded and ready.</p><p>Please save your work and close your windows before restarting.</p>`,
                button: ['Restart now', 'restart']
            },
            upgrade: {
                band: 'yellow', shield: 'shield-warning',
                title: view.message || 'Upgrade to Service Pack',
                body: '<p>This update is too large to install while MeletonFX is running. Restart to install it.</p><p>Please save your work and close your windows before restarting.</p>',
                button: ['Restart now', 'restart']
            },
            uptodate: { band: 'green', shield: 'shield-ok', title: 'MeletonFX is up to date', body: '<p>There are no updates available for your computer.</p>', button: ['Check for updates', 'check'] },
            failed: {
                band: 'red', shield: 'shield-error', title: 'MeletonFX could not search for new updates',
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
            ['You have MeletonFX set to:', 'Download updates in the background and install them when MeletonFX restarts (recommended)'],
            ['You receive updates:', `From the ${domain} domain controller (${root.location ? root.location.hostname : 'this server'})`]
        ];
        return `<table class="cpl-wu-facts">${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>`;
    }

    function paint() {
        if (!main || !main.isConnected) return;
        const host = main.querySelector('.cpl-wu-status');
        if (host) host.innerHTML = box();
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
        if (what === 'check' || what === 'install') {
            if (typeof manager.refreshServerCacheAndCheck === 'function') {
                manager.refreshServerCacheAndCheck();
                return;
            }
            check();
        } else if (what === 'apply' && typeof manager.applyStaticCacheUpdate === 'function') {
            view = { ...view, state: 'installing' };
            paint();
            Promise.resolve(manager.applyStaticCacheUpdate(manager.pendingApplyFiles || [])).finally(() => {
                try { localStorage.setItem('meletonUpdateInstalledAt', String(Date.now())); } catch (_) { /* private mode */ }
                view = { state: 'uptodate' };
                paint();
            });
        } else if (what === 'restart' && typeof manager.forceRestart === 'function') {
            manager.forceRestart();
        }
    }

    function mount(el) {
        main = el;
        const manager = sw();
        if (manager) {
            manager.foregroundUpdateView = (state, info) => {
                view = { state: classify(state, info && info.message), message: info && info.message, progress: info && info.progress, filesTotal: info && info.filesTotal };
                paint();
            };
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
        main = null;
    }

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerItem({
            id: 'meleton-update',
            name: 'MeletonFX Update',
            image: `${ART}/windows-update-32.png`,
            description: 'Check for updates to MeletonFX and install them.',
            open: () => cpl.open('update')
        });
        cpl.registerPage('update', {
            title: () => 'MeletonFX Update',
            tasks: () => `
                <div class="cpl-task-group">
                    <ul class="cpl-task-list">
                        <li><button type="button" class="cpl-link cpl-link--icon" data-cpl-wu="check"><img src="/static_images/vista-ie/refresh.png" alt="">Check for updates</button></li>
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
                    <h1 class="cpl-page-title">MeletonFX Update</h1>
                    <div class="cpl-wu-status"></div>
                    <div class="cpl-wu-facts-host"></div>
                </div>`,
            mount,
            unmount
        });
        return true;
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
