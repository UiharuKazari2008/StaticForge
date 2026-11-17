const wsPacketRegistry = require('../wsPacketRegistry');
const { isDormantPage } = require('../../wsSocketHeartbeat');

// client_boot_note (Nov 15 2026): a page that just booted says why (public/scripts/comp/modalUtils.js
// melatonBootLog: the restart's reason and the code that asked, or none = started outside the page,
// e.g. the Android app or the OS). One log line per boot, so the reasons phones cold-boot can be
// read from the server's log. Fire-and-forget: no reply.

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').slice(0, n);

function registerPackets() {
    wsPacketRegistry.registerWsPacket('client_boot_note', async (ctx) => {
        const { message, clientInfo } = ctx;
        if (!clientInfo || !clientInfo.authenticated) return;
        const e = (message && message.entry) || {};
        const note = e.note || null;
        const ua = clip(clientInfo.userAgent, 200);
        const device = /SM-F9\d\d/.test(ua) ? 'Fold' : /SM-A53/.test(ua) ? 'A53' : (/Android/.test(ua) ? 'Android' : 'desktop');
        console.log(`📱 boot ${device} ${clip(message.shell, 10)} ip=${clientInfo.ip || clientInfo.clientIP || '?'} desktopMs=${e.desktopMs || '?'} nav=${clip(e.nav, 12)} `
            + (note ? `reason=${clip(note.reason, 30)} hidden=${!!note.hidden} screenOff=${!!note.screenOff} from=${clip(note.from, 900)}` : 'reason=none (started outside the page)'));
    }, { owner: 'clientBootNote' });

    // client_dormant { on, dex? } (Nov 15 2026): a phone page whose screen went off, or that went behind
    // another app, says so; the server then holds status pushes nothing waits on and sends them when
    // it wakes (WebSocketServer.setDormant / DORMANT_HOLD). Fire-and-forget. A phone's DeX window says
    // so too, with dex: 1 (#890 P18): it is held for like a dormant phone page (clientInfo.dexWindow).
    wsPacketRegistry.registerWsPacket('client_dormant', async (ctx) => {
        const { ws, message, clientInfo, wsServer, handlers } = ctx;
        if (!clientInfo || !clientInfo.authenticated || !wsServer || typeof wsServer.setDormant !== 'function') return;
        if (message && message.dex) clientInfo.dexWindow = true;
        const on = !!(message && message.on);
        // a page whose Director stream was held back (cursorDirector.js watchesDirectorStream)
        const wasAsleep = isDormantPage(clientInfo);
        wsServer.setDormant(ws, on);
        // awake again: the Director turn it watches (if one runs) is sent whole, as the updates it
        // missed asleep never went to it
        if (wasAsleep && !on) {
            try { require('../../cursorDirector').resendDirectorStream(handlers || wsServer, ws, clientInfo); } catch (_) { /* the next update reaches it */ }
        }
    }, { owner: 'clientBootNote' });
}

module.exports = { registerPackets };
