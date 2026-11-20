const wsPacketRegistry = require('../wsPacketRegistry');
const statusHub = require('../statusHub');
const xmRadio = require('../../xmRadio');

// XM Radio (Yozora #989): the skeuomorphic SiriusXM radio. The account is the administrator's (admin and dev_admin
// test tabs listen; only admins sign in or out). Everything goes through modules/xmRadio.js.
//
//   xmradio_get             {}                    { account: { signedIn, expired, handle (masked), since, browserSignIn, card, cardRefused } }
//   xmradio_signin_status   { handle }            admins -> { hasPassword, hasPasskey, contacts[{ type, masked }] }
//   xmradio_signin          { handle, password }  admins; signs in with SiriusXM and keeps the login as the CardSpace card
//                                                 -> { account }
//   xmradio_signin_card     {}                    admins; signs in with the CardSpace card (apiKeyManager service siriusxm) -> { account }
//   xmradio_signin_browser  {}                    admins -> { url }: a one-time sign-in page of our own (10 minutes) that the radio
//                                                 opens in Alchemy, where 1Password can fill it; signed in there, the account
//                                                 item is pushed
//   xmradio_signin_browser_cancel {}              admins -> { account }
//   xmradio_signout         {}                    admins -> { account }
//   xmradio_lineup          { fresh? }            { channels[{ id, number, name, sub?, logo? }], presets { A, B, C: [channelId|null] x10 } }
//                                                 (read once a month; fresh: MENU > Refresh Lineup)
//   xmradio_logos           { ids[] }             { logos, backgrounds: { channelId: /api/xmradio/art?... } } (read when first asked, kept)
//   xmradio_presets_set     { presets }           admins -> { presets } (shared by every radio: desktop and phone)
//   xmradio_tune            { channelId, quality? } -> { sid, url, quality, channel } (quality hi | std | low | eco24 | eco16): url is our copy of the channel's HLS
//                                                 playlist (/api/xmradio/live/<sid>/index.m3u8; its key line points at
//                                                 /api/xmradio/key/<sid>/<id>)
//
// What is on is pushed, never polled: statusHub feed `xmradio` (status_subscribe { feed: 'xmradio' } while a radio is
// on) answers { account, lineup { at, n }, 'ch:<channelId>': { a (artist), t (title), s (show), ad, i (art) } } once and then pushes
// xmradio_status { changed } with only the channels whose cut changed.

const canRead = (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || '')));
const isAdmin = (info) => !!(info && info.userType === 'admin');

function reply(handlersCtx, ws, message, data) {
    handlersCtx.sendToClient(ws, { type: `${message.type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
}

function packet(admin, fallback, run) {
    return async (handlersCtx, ws, message, clientInfo) => {
        if (!(admin ? isAdmin(clientInfo) : canRead(clientInfo))) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        const data = message.data != null && typeof message.data === 'object' ? message.data : message;
        try {
            reply(handlersCtx, ws, message, await run(data));
        } catch (error) {
            handlersCtx.sendError(ws, (error && error.message) || fallback, (error && error.code) || 'XMRADIO_ERROR', message.requestId);
        }
    };
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    xmRadio.bind(handlersCtx.globalResources);
    xmRadio.defineFeed(statusHub);
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'xmradio', ...meta });
    };
    reg('xmradio_get', packet(false, 'XM Radio could not be loaded', async () => ({ account: xmRadio.account() })));
    reg('xmradio_signin_status', packet(true, 'SiriusXM could not look up the account', async (m) => xmRadio.signInStatus(m.handle)));
    reg('xmradio_signin', packet(true, 'SiriusXM could not sign you in', async (m) => {
        const account = await xmRadio.signInPassword(m.handle, m.password);
        // the login is kept in CardSpace with the rest (Yukimi, Nov 20 2026)
        try { xmRadio.saveCard(String(m.handle || '').trim(), String(m.password || '')); } catch (_) { /* signed in all the same */ }
        return { account: xmRadio.account() || account };
    }));
    reg('xmradio_signin_card', packet(true, 'SiriusXM could not sign you in', async () => ({ account: await xmRadio.signInWithCard({ force: true }) })));
    reg('xmradio_signin_browser', packet(true, 'The browser sign-in could not be started', async () => xmRadio.signInPageStart()));
    reg('xmradio_signin_browser_cancel', packet(true, 'The browser sign-in could not be stopped', async () => ({ account: xmRadio.signInPageCancel() })));
    reg('xmradio_signout', packet(true, 'The sign-out failed', async () => ({ account: xmRadio.signOut() })), { destructive: true });
    reg('xmradio_tune', packet(false, 'The channel could not be tuned', async (m) => xmRadio.tune(m.channelId, { quality: m.quality })));
    reg('xmradio_lineup', packet(false, 'The channels could not be read', async (m) => ({ channels: await xmRadio.lineup({ fresh: !!m.fresh }), presets: xmRadio.presets() })));
    reg('xmradio_logos', packet(false, 'The channel logos could not be read', async (m) => xmRadio.logos(Array.isArray(m.ids) ? m.ids : [])));
    reg('xmradio_presets_set', packet(true, 'The presets could not be saved', async (m) => ({ presets: xmRadio.setPresets(m.presets) })));
}

module.exports = { registerPackets };
