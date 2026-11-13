/**
 * Text Messaging on the phone while Dreamscape is not on screen (Yozora #779).
 *
 * A partnered phone's app keeps a background link (ActiveSync speaker "service", modules/activeSync.js)
 * while its WebView sleeps. New text messages that should notify (textMessaging's notify rule) go to
 * that link as as_event 'tm.notify' when no WebView of the phone is in the foreground; the app posts
 * an Android MessagingStyle notification with a quick reply and Mark as read. When the page is on
 * screen the Melaton Mobile shell shows its own notification instead.
 *
 *   tm.notify  { accountId, chatGuid, guid, title, sender, address, text, isGroup, date, service, account }
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
    if (!ev) return;
    if (ev.event === 'message' && ev.message) {
        const m = ev.message;
        if (m.fromMe) {
            for (const l of links()) activeSync.sendServerEvent(gr, null, l.service, 'tm.dismiss', { accountId: ev.accountId, chatGuid: ev.chatGuid });
            return;
        }
        if (!ev.notify) return;
        let account = null;
        try { account = textMessaging.listAccounts().accounts.find((a) => a.id === ev.accountId) || null; } catch (_) { account = null; }
        const sender = (m.sender && (m.sender.name || m.sender.address)) || 'Unknown';
        const detail = {
            accountId: ev.accountId,
            chatGuid: ev.chatGuid,
            guid: m.guid,
            title: ev.chatTitle || sender,
            sender,
            address: (m.sender && m.sender.address) || '',
            text: summaryText(m),
            isGroup: !!ev.isGroup,
            date: m.date || Date.now(),
            service: m.service || (account && account.service) || '',
            account: account ? (account.identity || account.service || 'Text Messaging') : 'Text Messaging'
        };
        for (const l of links()) {
            if (l.foreground) continue;
            activeSync.sendServerEvent(gr, null, l.service, 'tm.notify', detail);
        }
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
