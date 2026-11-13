/**
 * Restore Session and Sessions settings (Yozora #756, desktop; the phone's are in wmBrowser.js).
 *
 * When the client starts and its device left IE windows behind (or, with "pass to the next computer", any
 * device did), Restore Session lists those windows and their tabs with check boxes, all ticked, and three
 * buttons: Restore (the ticked tabs come back window by window; live Alchemy pages move here without
 * reloading), New (a new window; the old ones stay stored and are not offered again) and Discard (they go).
 *
 * When it shows (userGlobalSettings.alchemy.sessions): the first time Grimoire (IE) opens, never at
 * startup (Yukimi Nov 13); showAtStartup ("Ask to restore the last session") off = never asks; alwaysRestore skips the question. The times are set in
 * Internet Properties > General > Tabs > Sessions (openSettings).
 *
 * window.browsingRestore = { openSettings(owner), openRestore(reason), restoreWindows(windows), pending() }
 */
(function (root) {
    'use strict';

    const V = () => root.vistaDialogTemplate;
    const ICON = '/static_images/vista-cpl/items/internet-options-32.png';
    const IE_ART = '/static_images/vista-ie';
    const BOOKS_ICON = '/static_images/app_icons/books.webp';

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function toast(kind, text) {
        if (typeof root.showGlassToast === 'function') root.showGlassToast(kind, null, text, false, 4000);
    }

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    /** The dialog renderer and these dialogs' styles (featureLoader.js browsing_sessions_ui). */
    async function ui() {
        if (root.featureLoader) await root.featureLoader.loadFeature('browsing_sessions_ui');
        return !!V();
    }

    // ---- Sessions settings ----------------------------------------------------------------------
    //
    // A dialog of Internet Properties in its own metrics (MS Shell Dlg 8, inetcpl's spacing): two groups,
    // a number with an up-down and a unit for each time, and the pass-on check box.

    const UNITS = { m: 1, h: 60, d: 1440 };
    const SESSION_TPL = { t: 'Browsing Session Settings', w: 262, h: 214, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [
        [-1, 'B', 7, 7, 248, 62, 0x50000007, 'When Grimoire starts', 0],
        [701, 'B', 15, 20, 232, 12, 0x50010003, '&Ask to restore the last session when Grimoire opens', 0],
        [-1, 'S', 27, 32, 220, 9, 0x50020000, 'Otherwise it shows the first time Grimoire opens.', 0],
        [702, 'B', 15, 46, 232, 12, 0x50010003, '&Always restore my last session without asking', 0],
        [-1, 'B', 7, 75, 248, 90, 0x50000007, 'Keeping sessions', 0],
        [-1, 'S', 15, 88, 232, 9, 0x50020000, 'Keep the pages of a disconnected session open for:', 0],
        [711, 'E', 15, 100, 44, 13, 0x50812000, '15', 0],
        [712, 'C', 63, 100, 70, 60, 0x50210003, '', 0],
        [-1, 'S', 15, 120, 232, 9, 0x50020000, 'Then keep their addresses and history for:', 0],
        [713, 'E', 15, 132, 44, 13, 0x50812000, '3', 0],
        [714, 'C', 63, 132, 70, 60, 0x50210003, '', 0],
        [715, 'S', 15, 150, 232, 9, 0x50020000, 'This must be longer than the time pages stay open.', 0],
        [721, 'B', 7, 171, 248, 18, 0x50012003, '&Pass my last session to the next computer or phone I use', 0],
        [1, 'B', 151, 194, 50, 14, 0x50010001, 'OK', 0],
        [2, 'B', 205, 194, 50, 14, 0x50010000, 'Cancel', 0]
    ] };

    /** minutes -> the largest unit it fits exactly ({ n, unit }) */
    function split(minutes, allowed) {
        const units = allowed || ['d', 'h', 'm'];
        for (const u of units) {
            if (minutes % UNITS[u] === 0 && minutes / UNITS[u] >= 1) return { n: minutes / UNITS[u], unit: u };
        }
        return { n: minutes, unit: 'm' };
    }

    async function currentSettings() {
        let s = null;
        try {
            const res = root.browsingSessions ? await root.browsingSessions.list() : null;
            s = res && res.settings;
        } catch (_) { s = null; }
        return Object.assign({ idleMinutes: 15, keepMinutes: 4320, showAtStartup: true, alwaysRestore: false, roam: false }, s || {});
    }

    async function saveSessionSettings(patch) {
        const io = root.cplInternetOptions;
        if (io && typeof io.saveAlchemy === 'function') return io.saveAlchemy({ sessions: patch });
        const ws = root.wsClient;
        const data = ws ? await ws.updateUserGlobalSettings({ alchemy: { sessions: patch } }) : null;
        return data && data.settings ? data.settings.alchemy : null;
    }

    async function openSettings(owner) {
        if (!(await ui())) return null;
        const s = await currentSettings();
        const idle = split(s.idleMinutes, ['h', 'm']);
        const keep = split(s.keepMinutes);
        return V().openDialog({
            id: 'cplInetSessions',
            tpl: SESSION_TPL,
            owner,
            icon: ICON,
            title: SESSION_TPL.t,
            overrides: { 711: { spin: [1, 1440] }, 713: { spin: [1, 99999] } },
            init(ctx) {
                ctx.set(701, !!s.showAtStartup);
                ctx.set(702, !!s.alwaysRestore);
                ctx.set(721, !!s.roam);
                ctx.options(712, [{ value: 'm', text: 'minutes' }, { value: 'h', text: 'hours' }], idle.unit);
                ctx.options(714, [{ value: 'm', text: 'minutes' }, { value: 'h', text: 'hours' }, { value: 'd', text: 'days' }], keep.unit);
                ctx.set(711, String(idle.n));
                ctx.set(713, String(keep.n));
                const sync = () => ctx.enable(701, !ctx.get(702));
                ctx.on(702, 'change', sync);
                sync();
            },
            async ok(ctx) {
                const idleMinutes = Math.round((Number(ctx.get(711)) || 0) * UNITS[ctx.get(712) || 'm']);
                const keepMinutes = Math.round((Number(ctx.get(713)) || 0) * UNITS[ctx.get(714) || 'm']);
                if (idleMinutes < 1 || idleMinutes > 1440) {
                    await msg('Pages can stay open from 1 minute to 24 hours.', 'warning');
                    return false;
                }
                if (keepMinutes <= idleMinutes || keepMinutes < 5) {
                    await msg('Closed sessions must be kept longer than their pages stay open (at least 5 minutes).', 'warning');
                    return false;
                }
                try {
                    await saveSessionSettings({ idleMinutes, keepMinutes, showAtStartup: !!ctx.get(701), alwaysRestore: !!ctx.get(702), roam: !!ctx.get(721) });
                } catch (_) {
                    toast('error', 'Could not save the session settings');
                    return false;
                }
                return true;
            }
        });
    }

    /** A message box in inetcpl's own layout (its Delete Files box: the icon, the text, OK). */
    function msg(text, icon) {
        const sys = icon === 'warning' ? '#32515' : icon === 'error' ? '#32513' : '#32516';
        const lines = Math.max(1, Math.ceil(String(text).length / 42));
        const h = Math.max(22, lines * 9);
        const tpl = { t: 'Grimoire', w: 200, h: h + 32, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [
            [6430, 'S', 7, 7, 20, 20, 0x50000003, sys, 0],
            [-1, 'S', 41, 7, 152, h, 0x50020000, String(text), 0],
            [1, 'B', 143, h + 13, 50, 14, 0x50010001, 'OK', 0]
        ] };
        return ui().then(() => new Promise((resolve) => {
            const d = V() && V().openDialog({ id: 'grimoireSessionMsg', tpl, title: 'Grimoire', bareCaption: true, ok() { resolve(); }, cancel() { resolve(); } });
            if (!d) { toast(icon === 'warning' ? 'warning' : 'info', text); resolve(); }
        }));
    }

    /** Yes / No in inetcpl's Delete Files layout; resolves true for Yes. */
    function confirmBox(text) {
        const lines = Math.max(2, Math.ceil(String(text).length / 40));
        const h = lines * 9;
        const tpl = { t: 'Grimoire', w: 200, h: h + 32, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [
            [6430, 'S', 7, 7, 20, 20, 0x50000003, '#32514', 0],
            [-1, 'S', 41, 7, 152, h, 0x50020000, String(text), 0],
            [6, 'B', 89, h + 13, 50, 14, 0x50010001, '&Yes', 0],
            [7, 'B', 143, h + 13, 50, 14, 0x50010000, '&No', 0]
        ] };
        return ui().then(() => new Promise((resolve) => {
            const d = V() && V().openDialog({
                id: 'grimoireSessionConfirm',
                tpl,
                title: 'Grimoire',
                bareCaption: true,
                buttons: { 6: (ctx) => { ctx.close(); resolve(true); }, 7: (ctx) => { ctx.close(); resolve(false); } },
                cancel() { resolve(false); }
            });
            if (!d) resolve(false);
        }));
    }

    // ---- Restore Session ------------------------------------------------------------------------

    const RESTORE_TPL = { t: 'Restore Session', w: 296, h: 214, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [
        [800, 'S', 7, 7, 21, 20, 0x50000003, '#32516', 0],
        [801, 'S', 36, 7, 253, 24, 0x50020000, 'Grimoire was closed with these webpages open. Select the ones you want to open again.', 0],
        [802, 'SysTreeView32', 7, 34, 282, 148, 0x50010025, '', 0],
        [1, 'B', 131, 192, 50, 14, 0x50010001, '&Restore', 0],
        [803, 'B', 185, 192, 50, 14, 0x50010000, '&New', 0],
        [804, 'B', 239, 192, 50, 14, 0x50010000, '&Discard', 0]
    ] };

    function timeText(ms) {
        if (!ms) return '';
        const d = new Date(ms);
        const today = new Date();
        const sameDay = d.toDateString() === today.toDateString();
        return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function tabIcon(tab) {
        if (tab.kind === 'alchemy') return `${IE_ART}/page-ie.png`;
        return BOOKS_ICON;
    }

    function treeHtml(sessions) {
        let n = 0;
        let winNo = 0;
        return sessions.map((session) => (session.windows || []).map((win) => {
            winNo += 1;
            const tabs = win.tabs || [];
            const where = session.own ? 'this computer' : session.deviceName;
            const head = `Window ${winNo} (${tabs.length} ${tabs.length === 1 ? 'tab' : 'tabs'}, ${esc(where)}${session.lastSeenAt ? ', ' + esc(timeText(session.lastSeenAt)) : ''})`;
            n += 1;
            const winId = `brs-w${n}`;
            const rows = tabs.map((tab) => {
                n += 1;
                const live = tab.alchemyId ? ' <span class="brs-live">(still open)</span>' : '';
                // a page without a title of its own reads as its address once (Grimoire's home: "Grimoire")
                const title = tab.title && tab.title !== tab.url ? tab.title : (/^edtx:\/\/en\.grimoire\.jp\/?(index\.dtxt)?$/i.test(tab.url) ? 'Grimoire' : '');
                return `<div class="tbp-tree-row is-child brs-tab"><input type="checkbox" id="brs-${n}" data-session="${esc(session.id)}" data-tab="${esc(tab.id)}" data-win="${winId}" checked><label for="brs-${n}"><img src="${tabIcon(tab)}" alt="" width="16" height="16"><span class="brs-title">${esc(title || tab.url || 'Untitled')}</span>${live}${title ? `<span class="brs-url">${esc(tab.url)}</span>` : ''}</label></div>`;
            }).join('');
            return `<div class="tbp-tree-row is-node brs-win"><input type="checkbox" id="${winId}" data-win-box="${winId}" checked><label for="${winId}"><img src="${IE_ART}/page.png" alt="" width="16" height="16" onerror="this.remove()"><span>${head}</span></label></div>${rows}`;
        }).join('')).join('');
    }

    let restoreOpen = false;

    /** reason: 'startup' | 'ie' | 'menu'. Resolves once the dialog closes. */
    async function openRestore(reason) {
        if (restoreOpen || !root.browsingSessions) return false;
        let list;
        try { list = await root.browsingSessions.list(); } catch (_) { return false; }
        const sessions = (list && list.restorable) || [];
        if (!sessions.length) {
            if (reason === 'menu') await msg('There is no earlier session to restore.');
            return false;
        }
        if (!(await ui())) return false;
        restoreOpen = true;
        pendingOnOpen = false;
        return new Promise((resolve) => {
            const finish = (v) => { restoreOpen = false; resolve(v); };
            V().openDialog({
                id: 'grimoireRestoreSession',
                tpl: RESTORE_TPL,
                // Internet Explorer's window (Grimoire is IE here): its icon on the caption and the taskbar
                icon: '/static_images/app_icons/vista-iexplore.png',
                title: RESTORE_TPL.t,
                overrides: { 802: { html: treeHtml(sessions), cls: 'tbp-tree brs-tree' } },
                init(ctx) {
                    // the window boxes tick and clear their tabs; a tab box sets its window's to mixed
                    const tree = ctx.content.querySelector('.brs-tree');
                    const syncWin = (winId) => {
                        const boxes = [...tree.querySelectorAll(`input[data-win="${winId}"]`)];
                        const head = tree.querySelector(`input[data-win-box="${winId}"]`);
                        const on = boxes.filter((b) => b.checked).length;
                        head.checked = on === boxes.length;
                        head.indeterminate = on > 0 && on < boxes.length;
                    };
                    const syncButtons = () => ctx.enable(1, !!tree.querySelector('input[data-tab]:checked'));
                    tree.addEventListener('change', (ev) => {
                        const box = ev.target;
                        if (box.dataset.winBox) {
                            tree.querySelectorAll(`input[data-win="${box.dataset.winBox}"]`).forEach((b) => { b.checked = box.checked; });
                            box.indeterminate = false;
                        } else if (box.dataset.win) {
                            syncWin(box.dataset.win);
                        }
                        syncButtons();
                    });
                    syncButtons();
                },
                buttons: {
                    803: async (ctx) => {
                        ctx.close();
                        try { await root.browsingSessions.discard(sessions.map((s) => s.id), true); } catch (_) { /* offline */ }
                        await openBlankWindow();
                        finish('new');
                    },
                    804: async (ctx) => {
                        ctx.close();
                        try { await root.browsingSessions.discard(sessions.map((s) => s.id), false); } catch (_) { toast('error', 'Could not discard the session'); }
                        finish('discard');
                    }
                },
                async ok(ctx) {
                    const pick = {};
                    ctx.content.querySelectorAll('input[data-tab]').forEach((box) => {
                        if (!pick[box.dataset.session]) pick[box.dataset.session] = [];
                        if (box.checked) pick[box.dataset.session].push(box.dataset.tab);
                    });
                    const ids = Object.keys(pick);
                    let res;
                    try {
                        res = await root.browsingSessions.restore(ids, pick);
                    } catch (_) {
                        toast('error', 'Could not restore the session');
                        return false;
                    }
                    setTimeout(() => { restoreWindows((res && res.windows) || []).then(() => finish('restore')); }, 0);
                    return true;
                },
                cancel() { finish('cancel'); }
            });
        });
    }

    async function openBlankWindow() {
        if (typeof root.openGrimoireApplet === 'function') await root.openGrimoireApplet('');
    }

    function targetOf(tab) {
        const url = String(tab.url || '');
        if (tab.session) return { url, session: tab.session };
        if (/^(https?|chrome(-extension)?):/i.test(url)) return { url };
        return url ? { address: url } : {};
    }

    /** The tab's back list as it was: web entries (wiki pages keep only their address). */
    function applyHistory(win, tabObj, data) {
        const list = (data.history || []).filter((h) => h && h.url && h.type === 'web').map((h) => ({ type: 'web', url: h.url, title: h.title || h.url }));
        if (list.length < 2) return;
        const shell = !win.tabs || win.tabs.isActive(tabObj) ? win : tabObj.state;
        if (!shell) return;
        const at = list.findIndex((h) => h.url === data.url);
        shell.history = list;
        shell.historyIndex = at >= 0 ? at : list.length - 1;
        if (shell === win && typeof win.updateNavigationButtons === 'function') win.updateNavigationButtons();
    }

    /** Restore's windows into Grimoire: the first one into the main window if it is closed, the rest as new windows. */
    async function restoreWindows(windows) {
        if (!windows.length) return;
        if (root.featureLoader) await root.featureLoader.loadFeature('grimoire');
        for (let w = 0; w < windows.length; w += 1) {
            const data = windows[w];
            const tabs = data.tabs || [];
            if (!tabs.length) continue;
            const all = typeof root.grimoireAllWindows === 'function' ? root.grimoireAllWindows() : [];
            const main = all[0];
            const mainClosed = main && main.modal && (main.modal.classList.contains('hidden') || main.modal.classList.contains('hidden-alt'));
            let win;
            if (w === 0 && mainClosed) {
                main.open('', { skipInitialHome: true });
                win = main;
                await wait(60);
                if (win.tabs) win.tabs.load(targetOf(tabs[0]));
                else win.navigate(tabs[0].url);
            } else if (typeof TagWikiSearchModal !== 'undefined' && TagWikiSearchModal.openNewWindow) {
                // eslint-disable-next-line no-undef
                win = await TagWikiSearchModal.openNewWindow(targetOf(tabs[0]));
                await wait(80);
            }
            if (!win) continue;
            const made = [win.tabs ? win.tabs.active : null];
            for (let t = 1; t < tabs.length; t += 1) {
                if (win.tabs && win.tabs.available()) made.push(win.tabs.open(targetOf(tabs[t])));
                else if (typeof root.grimoireOpenStandaloneWindow === 'function' && targetOf(tabs[t]).url) root.grimoireOpenStandaloneWindow(tabs[t].url, tabs[t].session || null);
            }
            await wait(700);
            tabs.forEach((tab, i) => { if (made[i] && win.tabs) applyHistory(win, made[i], tab); });
            const activeAt = tabs.findIndex((tab) => tab.active);
            if (win.tabs && activeAt >= 0 && made[activeAt]) win.tabs.activate(made[activeAt]);
        }
        if (root.browsingSessions) root.browsingSessions.changed();
    }

    /** One taken tab (Other Devices, Send to Device) as a new tab of a Grimoire window. */
    async function openTab(win, tab) {
        if (!win || !tab) return null;
        const target = targetOf(tab);
        let made = null;
        if (win.tabs && win.tabs.available()) made = win.tabs.open(target);
        else if (target.url && typeof root.grimoireOpenStandaloneWindow === 'function') root.grimoireOpenStandaloneWindow(target.url, tab.session || null);
        else if (typeof win.navigate === 'function') win.navigate(tab.url);
        if (made) {
            await wait(700);
            applyHistory(win, made, tab);
        }
        if (root.browsingSessions) root.browsingSessions.changed();
        return made;
    }

    async function restoreAll() {
        let list;
        try { list = await root.browsingSessions.list(); } catch (_) { return; }
        const ids = ((list && list.restorable) || []).map((s) => s.id);
        if (!ids.length) return;
        try {
            const res = await root.browsingSessions.restore(ids, null);
            await restoreWindows((res && res.windows) || []);
        } catch (_) {
            toast('error', 'Could not restore the last session');
        }
    }

    // ---- when it shows ----------------------------------------------------------------------------

    let pendingOnOpen = false;

    function desktopUp() {
        const ws = root.wsClient;
        const boot = root.desktopBoot;
        const call = (fn) => { try { return !!(boot && typeof boot[fn] === 'function' && boot[fn]()); } catch (_) { return false; } };
        if (!root.isDesktop || !ws) return false;
        if (call('isSuspended') || call('isWorkstationLocked') || call('isBooting')) return false;
        return !!(ws.preStartupHandoffCompleted && ws.initStartupUiDismissed);
    }

    async function whenDesktopUp() {
        for (let i = 0; i < 600 && !desktopUp(); i += 1) await wait(500);
        // let the startup programs open first
        await wait(1500);
    }

    /** The first Grimoire window of this load asks, when startup did not (showAtStartup off). */
    function hookGrimoireOpen() {
        let tries = 0;
        const hook = () => {
            // eslint-disable-next-line no-undef
            const Cls = typeof TagWikiSearchModal !== 'undefined' ? TagWikiSearchModal : null;
            if (!Cls) { if (tries++ < 1200) setTimeout(hook, 1000); return; }
            if (Cls.prototype._browsingRestoreHooked) return;
            const open = Cls.prototype.open;
            Cls.prototype._browsingRestoreHooked = true;
            Cls.prototype.open = function (...args) {
                const out = open.apply(this, args);
                if (pendingOnOpen) {
                    pendingOnOpen = false;
                    setTimeout(() => openRestore('ie'), 300);
                }
                return out;
            };
        };
        hook();
    }

    function onReady(info) {
        if (!info || !info.first || !info.restorable || root.uiShell === 'mobile') return;
        const s = info.settings || {};
        if (s.alwaysRestore) {
            whenDesktopUp().then(restoreAll);
            return;
        }
        // never at startup (Yukimi Nov 13): the question waits for the first IE window; the box
        // "Ask to restore the last session" (showAtStartup) turns the question off altogether
        if (s.showAtStartup === false) return;
        pendingOnOpen = true;
        hookGrimoireOpen();
    }

    root.browsingRestore = {
        openSettings,
        openRestore,
        restoreWindows,
        restoreAll,
        openTab,
        confirm: confirmBox,
        pending: () => pendingOnOpen
    };

    if (root.browsingSessions) root.browsingSessions.on('ready', onReady);
})(window);
