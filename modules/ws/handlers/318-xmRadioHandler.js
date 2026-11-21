const wsPacketRegistry = require('../wsPacketRegistry');
const statusHub = require('../statusHub');
const xmRadio = require('../../xmRadio');
const recorder = require('../../xmRadioRecorder');

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
// The cassette deck (modules/xmRadioRecorder.js): recordings made on the server into the workspace's Recordings folder,
// a folder per tape.
//   xmradio_deck_get        { workspaceId? }      { deck: { tape, workspaceId, mode, recordings[], timers[], alerts[], terms[] }, tapes[] }
//   xmradio_deck_set        { tape?, workspaceId?, mode? (song | long) }  admins -> { deck } (a new tape name makes the tape)
//   xmradio_tape_tracks     { workspaceId, tape } { tracks[{ id, name, size, at }] } (played through vfs_download_file)
//   xmradio_rec_start       { channelId, song?, fromStart? }  admins -> { rid, channelId, kind, mode, tape, since, until, url, cut }
//                                                 (song: the phone's one-touch Record, the cut on air, from its start
//                                                 when fromStart; it stops when the cut ends)
//   xmradio_schedule        { channelId }         { now { a, t, at, dur, i } | null, played[] (newest first), shows[{ name, show, at,
//                                                 dur, i, now? }] } (liveUpdate, the last 90 min and the next 8 h; a minute's cache)
//   xmradio_tape_new        { workspaceId?, name }          admins -> { tape }
//   xmradio_tape_rename     { workspaceId?, from, to }      admins -> { tape }
//   xmradio_tape_delete     { workspaceId?, name }          admins -> { tape } (to the Recycle Bin; not while it records)
//   xmradio_track_rename    { id, name }                    admins -> { id, name }
//   xmradio_track_delete    { id }                          admins -> { id } (to the Recycle Bin)
//   xmradio_track_move      { id, tape }                    admins -> { id, tape }
//   GET /api/xmradio/track/<fileId>: a recording on a tape (audio/mp4, Range), for the phone's native player
//   xmradio_phone_watch     { channels[] }        a phone's channels (up to 12) for the feed xmradio_phone
//
// Phones subscribe to statusHub feed `xmradio_phone` instead: { account { signedIn }, lineup { at }, rec[{ rid,
// channelId, kind, since }], 'ch:<id>': { a, t, s, ad, i, at } } for the presets and the watched channels only.
//                                                 (url: the recording's own growing playlist, which the radio plays)
//   xmradio_rec_stop        { rid }               admins -> { rid, filed }
//   xmradio_timers_set      { timers[{ id?, channelId, start 'HH:MM', minutes, days[0-6], date?, mode?, off? }] }  admins
//   xmradio_alert_add       { kind (artist | song), artist, title?, channelId? }  admins -> { alerts }
//   xmradio_alert_remove    { id }                admins -> { alerts }
//   xmradio_terms_set       { terms[{ id?, text, channelId? }] }  admins -> { terms }
//
// What is on is pushed, never polled: statusHub feed `xmradio` (status_subscribe { feed: 'xmradio' } while a radio is
// on) answers { account, lineup { at, n }, deck, 'ch:<channelId>': { a (artist), t (title), s (show), ad, i (art) } } once and then pushes
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
    recorder.init(xmRadio, handlersCtx.globalResources, { changed: () => xmRadio.touch() });
    xmRadio.definePhoneFeed(statusHub);
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
    reg('xmradio_deck_get', packet(false, 'The cassette deck could not be read', async (m) => {
        const deck = recorder.deck();
        return { deck, tapes: await recorder.tapes(String(m.workspaceId || deck.workspaceId)) };
    }));
    reg('xmradio_deck_set', packet(true, 'The cassette deck could not be set', async (m) => ({ deck: recorder.setDeck(m) })));
    reg('xmradio_tape_tracks', packet(false, 'The tape could not be read', async (m) => ({ tracks: await recorder.tracks(String(m.workspaceId || recorder.deck().workspaceId), String(m.tape || recorder.deck().tape)) })));
    reg('xmradio_rec_start', packet(true, 'The recording could not be started', async (m) => (m.song
        ? recorder.recordCut(m.channelId, { fromStart: !!m.fromStart })
        : recorder.start({ channelId: m.channelId, kind: 'manual' }))));
    // a phone's channels for its feed (xmradio_phone): the one it plays and the pages Today shows; fire and forget
    wsPacketRegistry.registerWsPacket('xmradio_phone_watch', async (ctx) => {
        if (!canRead(ctx.clientInfo)) return;
        const m = ctx.message.data != null && typeof ctx.message.data === 'object' ? ctx.message.data : ctx.message;
        const list = xmRadio.setPhoneWatch(ctx.ws, m.channels);
        if (ctx.message.requestId) reply(handlersCtx, ctx.ws, ctx.message, { channels: list });
    }, { owner: 'xmradio' });
    reg('xmradio_rec_stop', packet(true, 'The recording could not be stopped', async (m) => (await recorder.stop(String(m.rid || ''))) || { rid: m.rid, filed: 0 }));
    reg('xmradio_schedule', packet(false, 'The programme could not be read', async (m) => xmRadio.schedule(m.channelId)));
    const wsOf = (m) => String(m.workspaceId || recorder.deck().workspaceId);
    reg('xmradio_tape_new', packet(true, 'The tape could not be made', async (m) => recorder.tapeNew(wsOf(m), m.name)));
    reg('xmradio_tape_rename', packet(true, 'The tape could not be renamed', async (m) => recorder.tapeRename(wsOf(m), String(m.from || ''), m.to)));
    reg('xmradio_tape_delete', packet(true, 'The tape could not be deleted', async (m) => recorder.tapeDelete(wsOf(m), String(m.name || ''))), { destructive: true });
    reg('xmradio_track_rename', packet(true, 'The recording could not be renamed', async (m) => recorder.trackRename(m.id, m.name)));
    reg('xmradio_track_delete', packet(true, 'The recording could not be deleted', async (m) => recorder.trackDelete(m.id)), { destructive: true });
    reg('xmradio_track_move', packet(true, 'The recording could not be moved', async (m) => recorder.trackMove(m.id, m.tape)));
    reg('xmradio_timers_set', packet(true, 'The timers could not be saved', async (m) => ({ timers: recorder.setTimers(m.timers) })));
    reg('xmradio_alert_add', packet(true, 'The alert could not be set', async (m) => ({ alerts: recorder.addAlert(m) })));
    reg('xmradio_alert_remove', packet(true, 'The alert could not be removed', async (m) => ({ alerts: recorder.removeAlert(String(m.id || '')) })));
    reg('xmradio_terms_set', packet(true, 'The search terms could not be saved', async (m) => ({ terms: recorder.setTerms(m.terms) })));
    reg('xmradio_presets_set', packet(true, 'The presets could not be saved', async (m) => ({ presets: xmRadio.setPresets(m.presets) })));
}

module.exports = { registerPackets };
