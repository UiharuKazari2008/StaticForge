const wsPacketRegistry = require('../wsPacketRegistry');
const statusHub = require('../statusHub');
const youtubeService = require('../../youtubeService');
const activeSync = require('../../activeSync');
const kickRelay = require('../../videosKickRelay');

// Melaton Videos, first Melaton Mobile YouTube (Yozora #839, #861): the phone's videos program and its Today item.
// Beside YouTube it shows Kick live streams and the notifications of chosen Android apps (modules/videosSources.js). Everything
// goes through modules/youtubeService.js (YouTube Data API with the household's own Google sign-in
// client). The account is the administrator's: admin (and dev_admin test tabs) may read; only admins
// sign in or out and save.
//
//   youtube_get              {}                        { state }: account, favourites, latest, settings, quota
//   youtube_signin           {}                        admins; starts Google's device sign-in -> { signIn: { userCode, url, expiresAt } }
//   youtube_signin_cancel    {}                        admins; drops a sign-in that was not finished
//   youtube_signout          {}                        admins; forgets and revokes the sign-in -> { state }
//   youtube_subscriptions    { fresh? }                { channels[] }: the subscribed channels, A to Z
//   youtube_feed             { fresh? }                { videos[], at, channels, partial }: newest uploads of the subscriptions
//   youtube_watch_later      { fresh? }                { videos[], unavailable, why }: read in the server's Alchemy browser; why: browser-signin | browser-offline
//   youtube_mark             { id, watched }           admins; Mark as Watched / Unwatched in the account's own YouTube history -> { id, watched, youtube }
//   youtube_later            { id, on }                admins; add to / remove from Watch Later -> { id, later, youtube }
//                                                      youtube: done | failed | browser-signin | browser-offline (the account's own list)
//   youtube_live_modes       {}                        { modes[{ id, label, note, kbit, heavy }] }: the qualities a Kick stream can be watched in
//   youtube_live_start       { slug, mode }            admins; starts (or joins) the server's relay of a listed Kick channel's live stream
//                                                      -> { id, url, mode, state, source, modes } (url: HLS under /api/videos/live/<id>/; modules/videosKickRelay.js)
//   youtube_live_state       { id }                    admins -> { state: live | restarting | ended | error | gone, error }
//   youtube_live_stop        { id }                    admins -> { stopped }
//   youtube_kick_add         { name }                  admins; a Kick channel by its name -> { channel, live, channels[] } (needs Service key `kick`)
//   youtube_kick_notify      { slug, on }              admins; the channel's bell: the server tells when it goes live -> { channels[] }
//   youtube_kick_remove      { slug }                  admins -> { channels[] }
//   youtube_apps_save        { apps[{ package, label }] }  admins; the apps whose phone notifications become feed items -> { apps[] }
//   youtube_notice_remove    { id }                    admins; takes an imported notification out of the feed -> { removed }
//   youtube_import_bell      {}                        admins; channels whose bell is set to All become favourites -> { why, favourites[], found, added, left }
//   youtube_search           { query, page? }          { query, videos[], channels[], next } (100 quota units a page)
//   youtube_channel          { id }                    { channel, videos[], favourite, subscribed }
//   youtube_favourite        { channel, on }           admins; adds or removes a Today favourite -> { favourites[] }
//   youtube_favourites_order { ids[] }                 admins -> { favourites[] }
//   youtube_settings_save    { settings }              admins; { noShorts, rareFirst, todayCount } -> { settings }
//
// Status is pushed, never polled: statusHub feed `youtube` (status_subscribe { feed: 'youtube' } while the
// Today item or the program is on screen) answers { account, favourites, latest, settings } once and then
// pushes youtube_status { changed } only when one of them changes (a sign-in finishing, a new upload).
//
// A video is { id, title, channel, channelId, thumb, at (ms), length (seconds or null), live ('' | live | upcoming),
// watched, progress (percent played when started but not watched), later };
// a channel is { id, title, thumb }.

const canRead = (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || '')));
const isAdmin = (info) => !!(info && info.userType === 'admin');

function reply(handlersCtx, ws, message, data) {
    handlersCtx.sendToClient(ws, {
        type: `${message.type}_response`,
        requestId: message.requestId,
        data,
        timestamp: new Date().toISOString()
    });
}

// one handler shape: guard, run, reply; a failure answers with the service's message and code
function packet(admin, fallback, run) {
    return async (handlersCtx, ws, message, clientInfo) => {
        if (!(admin ? isAdmin(clientInfo) : canRead(clientInfo))) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            reply(handlersCtx, ws, message, await run(message));
        } catch (error) {
            handlersCtx.sendError(ws, (error && error.message) || fallback, (error && error.code) || 'YOUTUBE_ERROR', message.requestId);
        }
    };
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[308-youtubeHandler] registerPackets: missing handlersCtx');
        return;
    }
    youtubeService.bind(handlersCtx.globalResources);
    youtubeService.defineFeed(statusHub);
    // Melaton Videos (#861): the notifications a partnered phone relays feed the chosen apps' items
    const sources = youtubeService.sources();
    activeSync.onDeviceEvent((name, detail, device) => { if (name === 'notify.posted') sources.takeNotification(detail, device && device.id); });
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'youtube', ...meta });
    };
    reg('youtube_get', packet(false, 'YouTube could not be loaded', async () => ({ state: youtubeService.getState() })));
    reg('youtube_signin', packet(true, 'The sign-in could not be started', async () => ({ signIn: await youtubeService.signInStart() })));
    reg('youtube_signin_cancel', packet(true, 'The sign-in could not be cancelled', async () => ({ cancelled: youtubeService.signInCancel() })));
    reg('youtube_signout', packet(true, 'The sign-out failed', async () => ({ state: await youtubeService.signOut() })), { destructive: true });
    reg('youtube_subscriptions', packet(false, 'The subscriptions could not be read', async (m) => ({ channels: await youtubeService.subscriptions({ fresh: !!m.fresh }) })));
    reg('youtube_feed', packet(false, 'The subscriptions could not be read', async (m) => youtubeService.feed({ fresh: !!m.fresh })));
    reg('youtube_watch_later', packet(false, 'Watch Later could not be read', async (m) => youtubeService.watchLater({ fresh: !!m.fresh })));
    reg('youtube_mark', packet(true, 'The mark could not be saved', async (m) => youtubeService.markWatched(String(m.id || ''), m.watched !== false)));
    reg('youtube_later', packet(true, 'Watch Later could not be changed', async (m) => youtubeService.setLater(String(m.id || ''), m.on !== false)));
    // Kick live streams played in the program through the server (#918): only channels on the program's list
    kickRelay.bind({ allowed: (slug) => sources.view().kick.some((c) => c.slug === slug) });
    // a Kick channel with its bell on went live: a notification in the durable inbox (shown at once on a
    // connected phone, posted by the app when the page is not running; #845), once per stream
    sources.setOnLive((channel, item) => {
        require('../../notificationInbox').bind(handlersCtx.globalResources).publish({
            app: 'youtube', id: `videos:live:${channel.slug}`, cls: 'notification', alert: true,
            title: `${channel.name} is live on Kick`, text: item.title || '', actions: [],
            data: { app: 'youtube', open: `kick:${channel.slug}` }, ttlMs: 6 * 60 * 60 * 1000
        });
    });
    sources.watchKick();
    reg('youtube_live_modes', packet(false, 'The qualities could not be read', async () => ({ modes: kickRelay.modes() })));
    reg('youtube_live_start', packet(true, 'The stream could not be started', async (m) => Object.assign(await kickRelay.start(m.slug, m.mode), { modes: kickRelay.modes() })));
    reg('youtube_live_state', packet(true, 'The stream could not be read', async (m) => kickRelay.state(m.id)));
    reg('youtube_live_stop', packet(true, 'The stream could not be stopped', async (m) => ({ stopped: await kickRelay.stop(m.id) })));
    reg('youtube_kick_add', packet(true, 'The Kick channel could not be added', async (m) => sources.kickAdd(m.name)));
    reg('youtube_kick_notify', packet(true, 'The setting could not be saved', async (m) => ({ channels: sources.kickNotify(m.slug, m.on !== false) })));
    reg('youtube_kick_remove', packet(true, 'The Kick channel could not be removed', async (m) => ({ channels: sources.kickRemove(m.slug) })));
    reg('youtube_apps_save', packet(true, 'The apps could not be saved', async (m) => ({ apps: sources.appsSave(m.apps) })));
    reg('youtube_notice_remove', packet(true, 'The item could not be removed', async (m) => ({ removed: sources.noticeRemove(m.id) })));
    reg('youtube_import_bell', packet(true, 'The channels could not be imported', async () => youtubeService.importBellFavourites()));
    reg('youtube_search', packet(false, 'The search failed', async (m) => youtubeService.search(m.query, m.page)));
    reg('youtube_channel', packet(false, 'The channel could not be read', async (m) => youtubeService.channelPage(String(m.id || ''))));
    reg('youtube_favourite', packet(true, 'The favourite could not be saved', async (m) => ({ favourites: await youtubeService.setFavourite(m.channel, m.on !== false) })));
    reg('youtube_favourites_order', packet(true, 'The order could not be saved', async (m) => ({ favourites: await youtubeService.orderFavourites(m.ids) })));
    reg('youtube_settings_save', packet(true, 'The settings could not be saved', async (m) => ({ settings: await youtubeService.saveSettings(m.settings || {}) })));
}

module.exports = {
    registerPackets
};
