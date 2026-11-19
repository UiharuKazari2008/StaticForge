const crypto = require('crypto');
const wsPacketRegistry = require('../wsPacketRegistry');

// The link's maximum data rate (Yozora #952): a client measures how fast this server's answer reaches it (the Café
// Miniport / Nightshade adapter's Speed in its status window), at connect and every 30 minutes, and reports the figure
// so the server knows a slow link (a low rate with a high round trip) and can space its pings and refreshes for it.
//
//   link_speed_probe  { bytes }        -> { payload, bytes }   incompressible bytes (random base64), at most 256 KB
//   link_speed_report { kbps, rttMs }  -> { ok }               kept on this connection (ws._melatonLinkSpeed)

const MAX_BYTES = 256 * 1024;
const MIN_BYTES = 16 * 1024;
const payloads = new Map(); // size -> base64 string, made once (random, so permessage-deflate cannot shrink it)

function payloadOf(bytes) {
    let p = payloads.get(bytes);
    if (!p) {
        p = crypto.randomBytes(Math.ceil(bytes * 3 / 4)).toString('base64').slice(0, bytes);
        if (payloads.size > 4) payloads.clear();
        payloads.set(bytes, p);
    }
    return p;
}

function reply(handlersCtx, ws, message, data) {
    handlersCtx.sendToClient(ws, { type: `${message.type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
}

function handleProbe(handlersCtx, ws, message) {
    const asked = Number(message.data && message.data.bytes) || 128 * 1024;
    const bytes = Math.max(MIN_BYTES, Math.min(MAX_BYTES, Math.round(asked / 1024) * 1024));
    reply(handlersCtx, ws, message, { bytes, payload: payloadOf(bytes) });
}

function handleReport(handlersCtx, ws, message) {
    const d = message.data || {};
    const kbps = Number(d.kbps);
    const rttMs = Number(d.rttMs);
    if (Number.isFinite(kbps) && kbps > 0 && kbps < 10e6) {
        ws._melatonLinkSpeed = { kbps: Math.round(kbps), rttMs: Number.isFinite(rttMs) ? Math.round(rttMs) : null, at: Date.now() };
    }
    reply(handlersCtx, ws, message, { ok: true });
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    const reg = (type, fn) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => { await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo); }, { owner: 'linkSpeed' });
    };
    reg('link_speed_probe', handleProbe);
    reg('link_speed_report', handleReport);
}

module.exports = { registerPackets };
