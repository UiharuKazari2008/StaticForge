const wsPacketRegistry = require('../wsPacketRegistry');
const quickcast = require('../../quickcast');

// QuickCast (apps/quickcast, Yozora #734): one-click YouTube live for an arcade cabinet through OBS
// on Ruiko (obs-websocket, modules/quickcast.js). Administrators only.

const isAdmin = (info) => !!info && (info.userType === 'admin' || info.userType === 'dev_admin');

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[300-quickcastHandler] registerPackets: missing handlersCtx');
        return;
    }
    const packet = (type, run, failure) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            const { ws, message, clientInfo } = ctx;
            if (!isAdmin(clientInfo)) {
                handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }
            // OBS being down or refusing is the program's business (its own message box), so failures
            // come back in the reply, not as an error packet (that raises the Mainframe exception dialog)
            let data;
            try {
                data = await run(message, ws);
            } catch (error) {
                data = { error: { message: failure, details: error.message, code: error.code || '' } };
            }
            handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
        }, { owner: 'quickcast' });
    };

    packet('quickcast_info', async () => quickcast.info(), 'Failed to read QuickCast');
    packet('quickcast_status', async (d) => quickcast.status({ cabinet: String((d && d.cabinet) || '') }), 'Failed to read OBS');
    packet('quickcast_preview', async (d) => quickcast.preview(String(d.cabinet || ''), d.width), 'No preview');
    packet('quickcast_prepare', async (d) => quickcast.prepare(String(d.cabinet || ''), !!d.confirmed), 'Could not get the cabinet ready');
    packet('quickcast_golive', async (d) => quickcast.goLive(String(d.cabinet || ''), d.settings && typeof d.settings === 'object' ? d.settings : undefined), 'Could not go live');
    packet('quickcast_stop', async () => quickcast.stop(), 'Could not stop the stream');
    packet('quickcast_live_ticket', async (d) => quickcast.liveTicket(String(d.cabinet || ''), d.width, d.prev ? String(d.prev) : ''), 'No realtime preview');
    // front panel XLINK key: the cabinet's whole XLink menu, and any of its items
    packet('quickcast_xlink_menu', async (d) => quickcast.cabinetXlinkMenu(String(d.cabinet || ''), !!d.force), 'No XLink menu');
    packet('quickcast_xlink_do', async (d) => quickcast.cabinetXlinkDo({ cabinet: d.cabinet, path: d.path, op: String(d.op || 'send'), value: d.value, confirmed: !!d.confirmed }), 'XLink did not take the command');
    packet('quickcast_obs_off', async () => quickcast.powerOff(), 'Could not shut down the satellite engine');
    // box OSD remote (avOsd.js): target 'sat' (satellite) or 'cab' (the mux PC feeding `cabinet`)
    packet('quickcast_osd_key', async (d) => quickcast.osd.press(d.target === 'sat' ? 'sat' : 'cab', String(d.cabinet || ''), String(d.key || '')), 'The box did not take the key');
    packet('quickcast_osd_view', async (d) => quickcast.osd.view(d.target === 'sat' ? 'sat' : 'cab', String(d.cabinet || '')), 'No box');
    packet('quickcast_launch', async () => quickcast.launch(), 'Could not start the satellite engine');
    packet('quickcast_mute', async (d) => quickcast.setMute(String(d.name || ''), !!d.muted), 'Could not mute the source');
    packet('quickcast_cabinet', async (d) => quickcast.cabinetControls(String(d.cabinet || ''), !!d.force), 'Could not read the cabinet');
    packet('quickcast_cabinet_action', async (d) => quickcast.cabinetAction({ cabinet: d.cabinet, path: d.path, op: String(d.op || ''), value: d.value, confirmed: !!d.confirmed }), 'The cabinet did not accept the command');
    packet('quickcast_encoder', async () => quickcast.getEncoder(), 'Could not read the encoder settings');
    packet('quickcast_setencoder', async (d) => quickcast.setEncoder(d), 'Could not change the encoder settings');
    const yt = quickcast.youtube;
    const signInWaiters = new Set();
    let offSignIn = null;
    packet('quickcast_yt_account', async () => ({ account: yt.account(), last: yt.lastSettings(), signIn: yt.signInState() }), 'Could not read the YouTube account');
    packet('quickcast_yt_credentials', async (d) => yt.setCredentials(d), 'Could not save the YouTube credentials');
    packet('quickcast_yt_signin', async (d, ws) => {
        const r = await yt.signInStart();
        signInWaiters.add(ws);
        if (!offSignIn && typeof yt.onSignIn === 'function') {
            offSignIn = yt.onSignIn(() => {
                const data = { signIn: yt.signInState(), account: yt.account() };
                for (const w of signInWaiters) {
                    if (w.readyState !== 1) continue;
                    try { handlersCtx.sendToClient(w, { type: 'quickcast_yt_signin_push', data, timestamp: new Date().toISOString() }); } catch (_) { /* gone */ }
                }
                signInWaiters.clear();
            });
        }
        return r;
    }, 'Could not start the YouTube sign-in');
    packet('quickcast_yt_signin_state', async () => ({ signIn: yt.signInState(), account: yt.account() }), 'Could not read the sign-in');
    packet('quickcast_yt_signout', async (d) => yt.signOut(!!d.all), 'Could not sign out');
    packet('quickcast_yt_profile', async (d) => ({ account: await yt.refreshProfile(!!d.force) }), 'Could not read the channel profile');
    packet('quickcast_yt_select', async (d) => yt.selectAccount(String(d.channelId || '')), 'Could not switch the channel');
    packet('quickcast_yt_settings', async (d) => yt.saveSettings(d), 'Could not save the broadcast settings');
    packet('quickcast_chat', async (d) => yt.chatRead(d.since), 'Could not read the live chat');
    packet('quickcast_chat_send', async (d) => yt.chatSend(d.text), 'Could not send the message');
    packet('quickcast_setkey', async (d) => quickcast.setKey(d.key, d.watchUrl), 'Could not save the stream key');

    // ---- the live picture of the units, pushed (no client polling, Yukimi Nov 13) ----
    // quickcast_subscribe { cabinet } answers with the status at once; from then on the socket gets
    // quickcast_status_push about once a second and at once when OBS reports a change, and
    // quickcast_meters_push (the program's audio meters, no OBS request) five times a second.
    // quickcast_unsubscribe, or the socket closing, ends it; the OBS link lease follows status().
    packet('quickcast_subscribe', async (d, ws) => subscribe(ws, String((d && d.cabinet) || '')), 'Could not read QuickCast');
    packet('quickcast_unsubscribe', async (d, ws) => { unsubscribe(ws); return { ok: true }; }, 'Could not stop the status feed');

    function sendTo(ws, type, data) {
        if (!ws || ws.readyState !== 1) { unsubscribe(ws); return; }
        try { handlersCtx.sendToClient(ws, { type, data, timestamp: new Date().toISOString() }); } catch (_) { unsubscribe(ws); }
    }

    async function subscribe(ws, cabinet) {
        if (!subs.has(ws)) ws.once('close', () => unsubscribe(ws));
        subs.set(ws, cabinet);
        const st = await quickcast.status({ cabinet });
        lastByCabinet.set(cabinet, st);
        arm();
        return st;
    }

    function unsubscribe(ws) {
        subs.delete(ws);
        if (!subs.size) disarm();
    }

    // ---- Live Chat, pushed: quickcast_chat_subscribe { since } answers like quickcast_chat; new
    // messages and state changes follow as quickcast_chat_push. The server's reader keeps going while
    // a window is subscribed (its lease is held here, not by client polls).
    packet('quickcast_chat_subscribe', async (d, ws) => {
        if (!chatSubs.has(ws)) ws.once('close', () => chatUnsub(ws));
        const r = yt.chatRead(d && d.since);
        chatSubs.set(ws, r.seq);
        chatArm();
        return r;
    }, 'Could not read the live chat');
    packet('quickcast_chat_unsubscribe', async (d, ws) => { chatUnsub(ws); return { ok: true }; }, 'Could not stop the live chat');

    let chatHold = null;
    let offChat = null;
    function chatPush() {
        for (const [ws, since] of chatSubs) {
            if (!ws || ws.readyState !== 1) { chatUnsub(ws); continue; }
            const r = yt.chatRead(since);
            chatSubs.set(ws, r.seq);
            try { handlersCtx.sendToClient(ws, { type: 'quickcast_chat_push', data: r, timestamp: new Date().toISOString() }); } catch (_) { chatUnsub(ws); }
        }
    }
    function chatArm() {
        if (!offChat && typeof yt.onChat === 'function') offChat = yt.onChat(chatPush);
        // the reader's lease (20 s) is held while a window listens; nothing goes to the client here
        if (!chatHold) chatHold = setInterval(() => { if (chatSubs.size) yt.chatRead(Number.MAX_SAFE_INTEGER); }, 10000);
    }
    function chatUnsub(ws) {
        chatSubs.delete(ws);
        if (chatSubs.size) return;
        clearInterval(chatHold); chatHold = null;
        if (offChat) { offChat(); offChat = null; }
    }

    let statusTimer = null;
    let meterTimer = null;
    let statusRunning = false;
    let soonTimer = null;
    let offObs = null;
    let obsSeq = 0;
    const lastByCabinet = new Map();

    async function statusTick() {
        clearTimeout(statusTimer);
        statusTimer = null;
        if (!subs.size) return;
        if (statusRunning) return;
        statusRunning = true;
        try {
            const byCab = new Map();
            for (const [ws, cab] of subs) { if (!byCab.has(cab)) byCab.set(cab, []); byCab.get(cab).push(ws); }
            for (const [cab, list] of byCab) {
                let st;
                try { st = await quickcast.status({ cabinet: cab }); } catch (_) { continue; }
                lastByCabinet.set(cab, st);
                // obsSeq: counts OBS change events; the client reloads its cabinet controls when it moves
                for (const ws of list) if (subs.get(ws) === cab) sendTo(ws, 'quickcast_status_push', { cabinet: cab, status: st, obsSeq });
            }
        } finally {
            statusRunning = false;
            if (subs.size) statusTimer = setTimeout(statusTick, STATUS_PUSH_MS);
        }
    }

    function meterTick() {
        if (!subs.size) return;
        const live = [...lastByCabinet.values()].some((st) => st && st.obs && st.obs.state === 'online');
        if (!live) return;
        let m;
        try { m = quickcast.meterSnapshot(); } catch (_) { return; }
        for (const ws of subs.keys()) sendTo(ws, 'quickcast_meters_push', m);
    }

    function arm() {
        if (!statusTimer && !statusRunning) statusTimer = setTimeout(statusTick, STATUS_PUSH_MS);
        if (!meterTimer) meterTimer = setInterval(meterTick, METER_PUSH_MS);
        if (!offObs && typeof quickcast.onObsEvent === 'function') {
            // a scene, stream, profile or input change: the new status at once (coalesced)
            offObs = quickcast.onObsEvent(() => {
                obsSeq += 1;
                if (soonTimer) return;
                soonTimer = setTimeout(() => { soonTimer = null; void statusTick(); }, 150);
            });
        }
    }

    function disarm() {
        clearTimeout(statusTimer); statusTimer = null;
        clearInterval(meterTimer); meterTimer = null;
        clearTimeout(soonTimer); soonTimer = null;
        if (offObs) { offObs(); offObs = null; }
        lastByCabinet.clear();
    }
}

const subs = new Map(); // ws -> cabinet
const chatSubs = new Map(); // ws -> the last chat seq it has
const STATUS_PUSH_MS = 1000;
const METER_PUSH_MS = 200;

module.exports = { registerPackets };
