/**
 * Control Panel's MeletonFX Update page (Yukimi 2026-10-13): Vista's Windows Update for the
 * client's files. While the page is open, updates run in the foreground: opening it checks the
 * server, and every state the service worker reaches (serviceWorkerManager.js
 * _showServiceWorkerTrayPopup) shows here instead of the tray balloon, background downloads
 * included. The page is Vista's: the status box with the coloured band and shield (wucltux.dll
 * UIFILE: red rgb(251,130,129), yellow rgb(252,236,100), green rgb(175,233,176), blue
 * rgb(145,203,211), each into white, rgb(189,202,234) edge; imageres.dll shields 98-101), then
 * the facts: most recent check, when updates were installed, how updates are set, where they come from.
 *
 *   checking      blue, "Checking for updates…", a marquee bar
 *   available     yellow, "Download and install updates for your computer", Install updates
 *   downloading   blue, "Downloading updates…", the bar and the file count
 *   ready         yellow, "Install updates for your computer" (CSS and assets apply live), Install updates
 *   restart       yellow, "Restart MeletonFX to finish installing updates", Restart now
 *   uptodate      green, "MeletonFX is up to date"
 *   failed        red, "MeletonFX could not search for new updates", Try again
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-cpl';
    let main = null;
    let view = { state: 'checking', message: '', progress: 0, filesTotal: 0 };
    let registered = false;

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

    /** The service worker's state words (checking | available | downloading | complete) as the page's. */
    function classify(state, message) {
        const m = String(message || '');
        const manager = sw();
        if (state === 'downloading') return 'downloading';
        if (state === 'available') return 'available';
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

    /** Where things stand when the page opens, before the check answers. */
    function initialState() {
        const manager = sw();
        if (!manager) return { state: 'failed', message: 'The update service is not running.' };
        if (manager.agentSession) return { state: 'failed', message: 'This is an agent session: its files are updated by the agent that runs it.' };
        if (manager.isUpdating) return { state: 'downloading', progress: manager.updateProgress || 0, filesTotal: (manager.trayPopup && manager.trayPopup.filesTotal) || 0 };
        if (manager.pendingApplyFiles && manager.pendingApplyFiles.length) return { state: 'ready' };
        if (manager.hasPendingUpdates && manager.hasPendingUpdates()) return { state: 'restart' };
        return { state: 'checking' };
    }

    function box() {
        const s = view.state;
        const files = view.filesTotal || (sw() && sw().pendingUpdateFilesTotal) || 0;
        const fileText = files ? `${files} ${files === 1 ? 'file' : 'files'}` : 'files';
        const kinds = {
            checking: { band: 'blue', shield: null, title: 'Checking for updates…', body: '<div class="cpl-wu-bar cpl-wu-bar--marquee"><span></span></div>' },
            available: { band: 'yellow', shield: 'shield-warning', title: 'Download and install updates for your computer', body: `<p>${esc(view.message || 'Updates to MeletonFX are available.')}</p>`, button: ['Install updates', 'install'] },
            downloading: {
                band: 'blue',
                shield: null,
                title: 'Downloading updates…',
                body: `<p>Downloading ${esc(fileText)} (${Math.round(view.progress || 0)}% complete)</p><div class="cpl-wu-bar"><span style="width:${Math.max(0, Math.min(100, Math.round(view.progress || 0)))}%"></span></div>`
            },
            ready: { band: 'yellow', shield: 'shield-warning', title: 'Install updates for your computer', body: '<p>The updates change styles and assets only, so they install without a restart.</p>', button: ['Install updates', 'apply'] },
            restart: { band: 'yellow', shield: 'shield-warning', title: 'Restart MeletonFX to finish installing updates', body: `<p>${esc(fileText.charAt(0).toUpperCase() + fileText.slice(1))} downloaded. Save your work before restarting.</p>`, button: ['Restart now', 'restart'] },
            uptodate: { band: 'green', shield: 'shield-ok', title: 'MeletonFX is up to date', body: '<p>There are no updates available for this computer.</p>' },
            failed: { band: 'red', shield: 'shield-error', title: 'MeletonFX could not search for new updates', body: `<p class="cpl-wu-error"><em>Error(s) found:</em></p><p>${esc(view.message || 'The server did not answer.')}</p>`, button: ['Try again', 'check'] }
        };
        const k = kinds[s] || kinds.checking;
        return `
            <div class="cpl-wu-box">
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

    function check() {
        const manager = sw();
        if (!manager || typeof manager.checkStaticFileUpdates !== 'function') return;
        view = { state: 'checking', message: '', progress: 0, filesTotal: 0 };
        paint();
        // the foreground check (noToast = false): its states come back through foregroundUpdateView
        manager.checkStaticFileUpdates(false).then(() => {
            // a check that found nothing to say (already downloading elsewhere) leaves the box as it was
            if (view.state === 'checking' && !manager.isUpdating) {
                view = initialState();
                if (view.state === 'checking') view = { state: 'uptodate' };
                paint();
            }
        });
    }

    function act(what) {
        const manager = sw();
        if (!manager) return;
        if (what === 'check' || what === 'install') {
            check();
        } else if (what === 'apply' && typeof manager.applyStaticCacheUpdate === 'function') {
            manager.applyStaticCacheUpdate(manager.pendingApplyFiles || []);
            view = { state: 'uptodate' };
            paint();
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
        view = { ...{ message: '', progress: 0, filesTotal: 0 }, ...initialState() };
        paint();
        if (view.state === 'checking') check();
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

    root.cplUpdate = { register, open: () => register() && root.melatonControlPanel.open('update'), _test: { classify } };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplUpdate;
})(typeof window !== 'undefined' ? window : globalThis);
