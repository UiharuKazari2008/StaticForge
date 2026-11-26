/**
 * Lizumi (Yozora #1252, slice S4): the MMC console for XM Radio recording management, opened from the Start menu
 * as its own window. Read-only in this version. Pages:
 *
 *   Lizumi
 *     Virtual Radios    the four recorder slots (Lizumi-Recorder-1..4): each holds one recording or is on standby,
 *                       with the queue depth beside it
 *     Queue             the common queue in due order
 *     Schedules         timers, search terms and alerts as one list
 *     Recordings        the current tape's tracks
 *     Accounts          the SiriusXM login
 *     Live, Diagnostics later updates (empty states)
 *
 * Data: the admin packet xmradio_mmc_view ({ account, deck, slots }) once, then the statusHub feed `xmradio_mmc`
 * (pushType xmradio_mmc_status, items.deck / items.account) while the window is open; nothing is polled. Channel names
 * come from xmradio_lineup.
 *
 *   window.openLizumi(node?)     opens it (node: a page id)
 *   window.mmcLizumi.def()       the snap-in's def
 */
(function (root) {
    'use strict';

    const ID = 'lizumi';
    const TITLE = 'Lizumi';
    const APP = '/static_images/app_icons/xmradio.png';
    const VI = '/static_images/vista-icons';
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const NODES = [
        { id: 'radios', name: 'Virtual Radios', icon: `${VI}/volume-high-16.png` },
        { id: 'queue', name: 'Queue', icon: `${VI}/service-worker-16.png` },
        { id: 'schedules', name: 'Schedules', icon: `${VI}/windows-update-16.png` },
        { id: 'recordings', name: 'Recordings', icon: `${VI}/search-folder-16.png` },
        { id: 'accounts', name: 'Accounts', icon: `${VI}/account-manager-16.png` },
        { id: 'live', name: 'Live', icon: `${VI}/net-internet-16.png` },
        { id: 'diagnostics', name: 'Diagnostics', icon: `${VI}/problem-reports-16.png` }
    ];

    const state = {
        console: null, account: null, deck: null, slots: { max: 4 }, loaded: false, error: '',
        channels: new Map(), lineupAsked: false,
        tracks: null, tracksFor: '', tracksLoading: false,
        feedOn: false
    };
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
    let wired = false;

    function active(c) {
        return !!c && !!c.modal && c.modal.isConnected && (typeof c.isActive !== 'function' || c.isActive());
    }

    function repaint() {
        const c = state.console;
        if (active(c)) c.refresh();
    }

    async function send(type, data) {
        const ws = root.wsClient;
        if (!ws || typeof ws.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        const r = await ws.sendMessage(type, data || {}, false);
        if (!r || r.success === false) throw new Error((r && r.error) || 'The server did not answer.');
        return r.data && typeof r.data === 'object' ? r.data : r;
    }

    // ---- formatting -------------------------------------------------------------------------------------

    const chName = (id) => state.channels.get(id) || (id ? 'Channel' : '');
    const cutText = (cut) => (cut ? [cut.a, cut.t || cut.s].filter(Boolean).join(' - ') : '');
    const clock = (ms) => (ms ? new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

    function span(sec) {
        const s = Math.max(0, Math.round(Number(sec) || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
    }

    function daysText(days) {
        const d = Array.isArray(days) ? days : [];
        if (!d.length) return '';
        return d.length === 7 ? 'Every day' : d.slice().sort().map((x) => DAYS[x]).join(' ');
    }

    // ---- data: the view once, then the feed -------------------------------------------------------------

    async function loadView() {
        try {
            const r = await send('xmradio_mmc_view', {});
            state.account = r.account || null;
            state.deck = r.deck || null;
            if (r.slots && r.slots.max) state.slots = r.slots;
            state.error = '';
        } catch (err) {
            state.error = (err && err.message) || 'The server did not answer.';
        }
        state.loaded = true;
        repaint();
    }

    async function loadLineup() {
        if (state.lineupAsked) return;
        state.lineupAsked = true;
        try {
            const r = await send('xmradio_lineup', {});
            (r.channels || []).forEach((ch) => state.channels.set(ch.id, ch.number ? `${ch.number} ${ch.name}` : ch.name));
            repaint();
        } catch (_) { state.lineupAsked = false; }
    }

    async function loadTracks(c) {
        const d = state.deck;
        if (!d || state.tracksLoading) return;
        const key = `${d.workspaceId}/${d.tape}/${(d.recordings || []).length}`;
        if (state.tracksFor === key) return;
        state.tracksLoading = true;
        try {
            const r = await send('xmradio_tape_tracks', { workspaceId: d.workspaceId, tape: d.tape });
            state.tracks = r.tracks || [];
        } catch (_) {
            state.tracks = [];
        }
        state.tracksFor = key;
        state.tracksLoading = false;
        if (active(c)) c.refresh();
    }

    function applyItems(items) {
        if (!items) return;
        if (items.deck) state.deck = items.deck;
        if (items.account) state.account = items.account;
    }

    /** Lizumi's own feed (xmradio_mmc, statusHub): only while the console is open; never the radio app's xmradio feed. */
    async function want(on) {
        const ws = root.wsClient;
        if (on === state.feedOn || !ws || typeof ws.sendMessage !== 'function') return;
        state.feedOn = on;
        if (!on) { try { await ws.sendMessage('status_unsubscribe', { feed: 'xmradio_mmc' }, false); } catch (_) { /* gone */ } return; }
        if (!wired && typeof ws.on === 'function') {
            wired = true;
            ws.on('xmradio_mmc_status', (msg) => {
                if (!state.feedOn || !msg) return;
                applyItems((msg.changed || (msg.data && msg.data.changed)) || {});
                repaint();
            }, { signal: appScopeSignal });
            // the server forgets a dropped socket's subscriptions
            ws.on('connected', () => { if (state.feedOn) { state.feedOn = false; void want(true); } }, { signal: appScopeSignal });
        }
        try {
            const r = await ws.sendMessage('status_subscribe', { feed: 'xmradio_mmc' }, false);
            applyItems(r && (r.items || (r.data && r.data.items)));
        } catch (_) {
            state.feedOn = false;
        }
        repaint();
    }

    // ---- pages ------------------------------------------------------------------------------------------

    const EMPTY = 'There are no items to show in this view.';

    function later(c, what) {
        return {
            html: c.listView([{ t: 'Name', w: 300, key: 'name', text: (d) => d.name }], [], { empty: `${what} will be available in a later update.` }),
            list: true
        };
    }

    function radiosPage(c) {
        const d = state.deck || {};
        const recs = Array.isArray(d.recordings) ? d.recordings : [];
        const max = (state.slots && state.slots.max) || 4;
        const now = Date.now();
        const rows = [];
        for (let i = 0; i < max; i++) {
            const r = recs[i] || null;
            rows.push({
                key: `slot:${i + 1}`,
                icon: `${VI}/volume-${r ? 'high' : 'mute'}-16.png`,
                data: r
                    ? { name: `Lizumi-Recorder-${i + 1}`, state: 'Recording', channel: chName(r.channelId), cut: cutText(r.cut), kind: r.kind === 'song' ? 'Song' : 'Channel', running: span((now - (r.since || now)) / 1000), runningS: now - (r.since || now), back: r.back ? span(r.back) : '0:00', buffer: '-', segments: '-' }
                    : { name: `Lizumi-Recorder-${i + 1}`, state: 'Standby', channel: '', cut: '', kind: '', running: '', runningS: 0, back: '', buffer: '-', segments: '-' }
            });
        }
        return {
            html: c.listView([
                { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
                { t: 'State', w: 76, key: 'state', text: (x) => x.state },
                { t: 'Channel', w: 130, key: 'channel', text: (x) => x.channel },
                { t: 'On air', w: 200, key: 'cut', text: (x) => x.cut },
                { t: 'Kind', w: 64, key: 'kind', text: (x) => x.kind },
                { t: 'Running', w: 70, key: 'running', text: (x) => x.running, value: (x) => x.runningS },
                { t: 'Reached back', w: 90, key: 'back', text: (x) => x.back },
                { t: 'Buffer', w: 60, key: 'buffer', text: (x) => x.buffer },
                { t: 'Segments', w: 70, key: 'segments', text: (x) => x.segments }
            ], rows, { sortId: 'lz-radios', empty: EMPTY }),
            list: true
        };
    }

    function queuePage(c) {
        const q = state.deck && Array.isArray(state.deck.queue) ? state.deck.queue : [];
        const rows = q.map((e, i) => ({
            key: `q:${e.id}`,
            icon: `${VI}/service-worker-16.png`,
            data: { n: i + 1, cut: cutText(e), channel: chName(e.channelId), expires: clock(e.expiresAt), expiresAt: e.expiresAt || 0, added: clock(e.addedAt), addedAt: e.addedAt || 0 }
        }));
        return {
            html: c.listView([
                { t: 'Order', w: 50, key: 'n', text: (x) => String(x.n), value: (x) => x.n },
                { t: 'Song', w: 240, key: 'cut', text: (x) => x.cut },
                { t: 'Channel', w: 140, key: 'channel', text: (x) => x.channel },
                { t: 'Expires', w: 120, key: 'expires', text: (x) => x.expires, value: (x) => x.expiresAt },
                { t: 'Added', w: 120, key: 'added', text: (x) => x.added, value: (x) => x.addedAt },
                { t: 'Virtual Radio', w: 100, key: 'radio', text: () => '-' }
            ], rows, { sortId: 'lz-queue', empty: 'The queue is empty.' }),
            list: true
        };
    }

    function schedulesPage(c) {
        const d = state.deck || {};
        const rows = [];
        (d.timers || []).forEach((t) => rows.push({
            key: `t:${t.id}`, icon: `${VI}/windows-update-16.png`,
            data: { kind: 'Timer', channel: chName(t.channelId), start: t.start || '', minutes: t.minutes ? String(t.minutes) : '', days: daysText(t.days), date: t.date || '', mode: t.mode || '', match: '', state: t.off ? 'Off' : 'On' }
        }));
        (d.terms || []).forEach((t) => rows.push({
            key: `s:${t.id}`, icon: `${VI}/search-16.png`,
            data: { kind: 'Search term', channel: t.channelId ? chName(t.channelId) : 'Any channel', start: '', minutes: '', days: '', date: '', mode: '', match: t.text || '', state: 'On' }
        }));
        (d.alerts || []).forEach((a) => rows.push({
            key: `a:${a.id}`, icon: `${VI}/search-16.png`,
            data: { kind: 'Alert', channel: a.channelId ? chName(a.channelId) : 'Any channel', start: '', minutes: '', days: '', date: '', mode: '', match: [a.artist, a.title].filter(Boolean).join(' - '), state: 'On' }
        }));
        return {
            html: c.listView([
                { t: 'Type', w: 80, key: 'kind', text: (x) => x.kind },
                { t: 'Channel', w: 130, key: 'channel', text: (x) => x.channel },
                { t: 'Start', w: 50, key: 'start', text: (x) => x.start },
                { t: 'Minutes', w: 56, key: 'minutes', text: (x) => x.minutes, value: (x) => Number(x.minutes) || 0 },
                { t: 'Days', w: 130, key: 'days', text: (x) => x.days },
                { t: 'Date', w: 76, key: 'date', text: (x) => x.date },
                { t: 'Mode', w: 50, key: 'mode', text: (x) => x.mode },
                { t: 'Matches', w: 180, key: 'match', text: (x) => x.match },
                { t: 'State', w: 44, key: 'state', text: (x) => x.state }
            ], rows, { sortId: 'lz-schedules', empty: EMPTY }),
            list: true
        };
    }

    function recordingsPage(c) {
        const d = state.deck;
        if (d) void loadTracks(c);
        const rows = (state.tracks || []).map((t) => ({
            key: `r:${t.id}`, icon: `${VI}/volume-high-16.png`,
            data: { name: t.name, size: `${Math.max(1, Math.round((t.size || 0) / 1024)).toLocaleString('en-US')} KB`, sizeB: t.size || 0, at: clock(t.at), atMs: t.at || 0 }
        }));
        return {
            html: c.listView([
                { t: 'Name', w: 330, key: 'name', text: (x) => x.name },
                { t: 'Size', w: 80, key: 'size', text: (x) => x.size, value: (x) => x.sizeB },
                { t: 'Recorded', w: 130, key: 'at', text: (x) => x.at, value: (x) => x.atMs }
            ], rows, { sortId: 'lz-recordings', empty: state.tracks ? 'This tape has no recordings.' : 'Reading the tape...' }),
            list: true
        };
    }

    function accountsPage(c) {
        const a = state.account || {};
        const max = (state.slots && state.slots.max) || 4;
        const rows = [];
        for (let i = 0; i < max; i++) {
            const own = i === 0;
            rows.push({
                key: `acc:${i + 1}`, icon: `${VI}/account-manager-16.png`,
                data: {
                    name: `Lizumi-Recorder-${i + 1}`,
                    handle: own ? (a.handle || '') : '',
                    state: own ? (a.signedIn ? 'Signed in' : a.expired ? 'Expired' : 'Signed out') : 'Not set up',
                    since: own && a.since ? clock(a.since) : '', token: '-', entitlement: '-'
                }
            });
        }
        return {
            html: c.listView([
                { t: 'Virtual Radio', w: 130, key: 'name', text: (x) => x.name },
                { t: 'Handle', w: 150, key: 'handle', text: (x) => x.handle },
                { t: 'State', w: 90, key: 'state', text: (x) => x.state },
                { t: 'Signed in since', w: 120, key: 'since', text: (x) => x.since },
                { t: 'Token expiry', w: 90, key: 'token', text: (x) => x.token },
                { t: 'Entitlement', w: 90, key: 'entitlement', text: (x) => x.entitlement }
            ], rows, { sortId: 'lz-accounts', empty: EMPTY }),
            list: true
        };
    }

    function page(n, c) {
        if (n.id === 'root') {
            return {
                html: c.listView([{ t: 'Name', w: 260, key: 'name', text: (x) => x.name }],
                    NODES.map((x) => ({ key: `n:${x.id}`, open: x.id, icon: x.icon, data: { name: x.name } })), { empty: EMPTY }),
                list: true
            };
        }
        if (!state.loaded) return { html: c.listView([{ t: 'Name', w: 300, key: 'name', text: (x) => x.name }], [], { empty: 'Reading XM Radio...' }), list: true };
        if (state.error && !state.deck) return { html: c.listView([{ t: 'Name', w: 300, key: 'name', text: (x) => x.name }], [], { empty: state.error }), list: true };
        switch (n.id) {
            case 'radios': void loadLineup(); return radiosPage(c);
            case 'queue': void loadLineup(); return queuePage(c);
            case 'schedules': void loadLineup(); return schedulesPage(c);
            case 'recordings': return recordingsPage(c);
            case 'accounts': return accountsPage(c);
            case 'live': return later(c, 'Live monitoring');
            case 'diagnostics': return later(c, 'Diagnostics');
            default: return '';
        }
    }

    function status(n) {
        const d = state.deck;
        if (!d || n.id === 'root') return '';
        const r = (d.recordings || []).length;
        const max = (state.slots && state.slots.max) || 4;
        const q = (d.queue || []).length;
        if (n.id === 'recordings') return `Tape: ${d.tape}`;
        return `${r} of ${max} virtual radios recording, ${q} ${q === 1 ? 'entry' : 'entries'} queued`;
    }

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: APP,
            icon32: APP,
            taskbarIcon: APP,
            treeWidth: 170,
            expanded: ['root'],
            about: { version: '1.0', lines: ['Manages the XM Radio recorders, queue, schedules and accounts.'] },
            nodes: () => [{ id: 'root', name: TITLE, icon: APP, children: NODES.map((x) => ({ id: x.id, name: x.name, icon: x.icon })) }],
            page: (n, c) => page(n, c),
            commands: () => [],
            selCommands: () => null,
            action: () => false,
            rowOpen: (key, n, c) => { if (key && key.startsWith('n:')) c.select(key.slice(2), true); },
            status: (n) => status(n),
            viewMenu: () => [],
            onOpen: (c) => {
                state.console = c;
                void loadView();
                void want(true);
            },
            onClose: () => {
                state.console = null;
                void want(false);
            }
        };
    }

    async function openLizumi(node) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        return root.mmcConsole.open(def(), node ? { node } : {});
    }

    root.openLizumi = openLizumi;
    root.mmcLizumi = { open: openLizumi, def, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
