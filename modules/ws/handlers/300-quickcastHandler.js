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
                data = await run(message);
            } catch (error) {
                data = { error: { message: failure, details: error.message, code: error.code || '' } };
            }
            handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
        }, { owner: 'quickcast' });
    };

    packet('quickcast_info', async () => quickcast.info(), 'Failed to read QuickCast');
    packet('quickcast_status', async () => quickcast.status(), 'Failed to read OBS');
    packet('quickcast_preview', async (d) => quickcast.preview(String(d.cabinet || ''), d.width), 'No preview');
    packet('quickcast_prepare', async (d) => quickcast.prepare(String(d.cabinet || ''), !!d.confirmed), 'Could not get the cabinet ready');
    packet('quickcast_golive', async (d) => quickcast.goLive(String(d.cabinet || ''), d.settings && typeof d.settings === 'object' ? d.settings : undefined), 'Could not go live');
    packet('quickcast_stop', async () => quickcast.stop(), 'Could not stop the stream');
    packet('quickcast_launch', async () => quickcast.launch(), 'Could not start OBS');
    packet('quickcast_encoder', async () => quickcast.getEncoder(), 'Could not read the encoder settings');
    packet('quickcast_setencoder', async (d) => quickcast.setEncoder(d), 'Could not change the encoder settings');
    const yt = quickcast.youtube;
    packet('quickcast_yt_account', async () => ({ account: yt.account(), last: yt.lastSettings(), signIn: yt.signInState() }), 'Could not read the YouTube account');
    packet('quickcast_yt_credentials', async (d) => yt.setCredentials(d), 'Could not save the YouTube credentials');
    packet('quickcast_yt_signin', async () => yt.signInStart(), 'Could not start the YouTube sign-in');
    packet('quickcast_yt_signin_state', async () => ({ signIn: yt.signInState(), account: yt.account() }), 'Could not read the sign-in');
    packet('quickcast_yt_signout', async (d) => yt.signOut(!!d.all), 'Could not sign out');
    packet('quickcast_yt_profile', async (d) => ({ account: await yt.refreshProfile(!!d.force) }), 'Could not read the channel profile');
    packet('quickcast_yt_select', async (d) => yt.selectAccount(String(d.channelId || '')), 'Could not switch the channel');
    packet('quickcast_yt_settings', async (d) => yt.saveSettings(d), 'Could not save the broadcast settings');
    packet('quickcast_chat', async (d) => yt.chatRead(d.since), 'Could not read the live chat');
    packet('quickcast_chat_send', async (d) => yt.chatSend(d.text), 'Could not send the message');
    packet('quickcast_setkey', async (d) => quickcast.setKey(d.key, d.watchUrl), 'Could not save the stream key');
}

module.exports = { registerPackets };
