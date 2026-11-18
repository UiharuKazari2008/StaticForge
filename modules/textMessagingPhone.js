/**
 * Text Messaging on the phone while Dreamscape is not on screen (Yozora #779).
 *
 * A partnered phone's app keeps a background link (ActiveSync speaker "service", modules/activeSync.js)
 * while its WebView sleeps. New text messages reach it as their notification inbox notice (sms:<account>:<chat>,
 * notificationInboxSources, #908: delivered, confirmed by the app and sent again until it is); the app renders
 * those as an Android MessagingStyle notification with a quick reply and Mark as read. (tm.notify, a second
 * copy of the same text, is gone.)
 *
 *   tm.dismiss { accountId, chatGuid }    read somewhere else, or you answered from another device
 *
 * The app answers over the same socket with the ordinary packets: tm_send { accountId, chatGuid, text }
 * and tm_read { accountId, chatGuid } (docs/activesync-protocol.md, Text Messaging).
 */
'use strict';

const textMessaging = require('./textMessaging');
const activeSync = require('./activeSync');

let gr = null;
let started = false;

function summaryText(m) {
    if (!m) return '';
    if (m.text) return m.text.length > 1000 ? `${m.text.slice(0, 1000)}...` : m.text;
    const atts = m.attachments || [];
    if (!atts.length) return '';
    const first = atts[0].mime || '';
    const kind = /^image\//.test(first) ? 'Picture' : /^video\//.test(first) ? 'Video' : /^audio\//.test(first) ? 'Audio message' : 'Attachment';
    return atts.length > 1 ? `${kind} and ${atts.length - 1} more` : kind;
}

function links() {
    try { return activeSync.partnerLinks(gr, null).filter((l) => l.service); } catch (_) { return []; }
}

function onEvent(ev) {
    // an Android app account's messages are that app's own notifications on the phone (#885)
    if (!ev || ev.native) return;
    if (ev.event === 'message' && ev.message) {
        const m = ev.message;
        if (m.fromMe) {
            for (const l of links()) activeSync.sendServerEvent(gr, null, l.service, 'tm.dismiss', { accountId: ev.accountId, chatGuid: ev.chatGuid });
            return;
        }
        // a new text reaches the phone as its inbox notice only (notificationInboxSources sms:, #908): delivered,
        // confirmed and retried, and rendered by the app as the MessagingStyle conversation with Reply and Mark as
        // read. tm.notify was a second copy (two notifications per text) and is no longer sent.
    } else if (ev.event === 'read' && ev.read !== false) {
        for (const l of links()) activeSync.sendServerEvent(gr, null, l.service, 'tm.dismiss', { accountId: ev.accountId, chatGuid: ev.chatGuid });
    }
}

function init(globalResources) {
    if (started) return;
    started = true;
    gr = globalResources || require('./globalResources');
    textMessaging.onEvent(onEvent);
}

module.exports = { init, summaryText, _onEvent: onEvent };
