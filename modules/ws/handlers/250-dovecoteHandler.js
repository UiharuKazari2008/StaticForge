const wsPacketRegistry = require('../wsPacketRegistry');
const dovecoteMail = require('../../dovecoteMail');
const { renderMailBody } = require('../../dovecoteRender');

const DOVECOTE_DESTRUCTIVE = { destructive: true };

const MAILBOX_LABELS = {
    yukimi: 'Yukimi (you)',
    rook: 'Rook',
    menma: 'Menma',
    hoshino: 'Hoshino',
    ivory: 'Ivory',
    guren: 'Guren',
    chiyo: 'Chiyo',
    frost: 'Frost',
    sala: 'Sala',
    tifa: 'Tifa',
    pyra: 'Pyra',
    cursor: 'Cursor',
    claude: 'Claude',
    tsubame: 'Tsubame'
};

// Only read operations (list/get/render) may view another mailbox, and only
// as an explicit admin view — never the default. Every write from the
// browser acts as Yukimi's own mailbox regardless of what the client sends.
function resolveViewOwner(message) {
    const requested = message && message.viewAsOwner ? String(message.viewAsOwner).trim().toLowerCase() : null;
    if (requested && dovecoteMail.isBotOwner(requested)) return requested;
    return dovecoteMail.HUMAN_OWNER;
}

async function handleListMailboxes(handlersCtx, ws, message) {
    try {
        const mailboxes = dovecoteMail.listMailboxes().map((entry) => ({
            owner: entry.owner,
            label: MAILBOX_LABELS[entry.owner] || entry.owner,
            unread: entry.unread,
            spamUnread: entry.spamUnread || 0
        }));
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_list_mailboxes_response',
            requestId: message.requestId,
            data: { mailboxes },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to list mailboxes', error.message, message.requestId);
    }
}

async function handleListMail(handlersCtx, ws, message) {
    try {
        const owner = resolveViewOwner(message);
        const mail = dovecoteMail.listMail(owner, {
            folder: message.folder,
            unreadOnly: message.unreadOnly === true,
            limit: message.limit
        });
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_list_mail_response',
            requestId: message.requestId,
            data: { owner, mail },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to list mail', error.message, message.requestId);
    }
}

async function handleGetMail(handlersCtx, ws, message) {
    try {
        if (!message.id) {
            handlersCtx.sendError(ws, 'Message id is required', 'dovecote_get_mail', message.requestId);
            return;
        }
        const owner = resolveViewOwner(message);
        const mail = dovecoteMail.readMail(owner, message.id);
        if (!mail) {
            handlersCtx.sendError(ws, 'Message not found', 'MESSAGE_NOT_FOUND', message.requestId);
            return;
        }
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_get_mail_response',
            requestId: message.requestId,
            data: { owner, mail },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to read mail', error.message, message.requestId);
    }
}

async function handleRenderBody(handlersCtx, ws, message) {
    try {
        if (!message.id) {
            handlersCtx.sendError(ws, 'Message id is required', 'dovecote_render_body', message.requestId);
            return;
        }
        const owner = resolveViewOwner(message);
        const mail = dovecoteMail.readMail(owner, message.id);
        if (!mail) {
            handlersCtx.sendError(ws, 'Message not found', 'MESSAGE_NOT_FOUND', message.requestId);
            return;
        }
        const alwaysLoadSenders = dovecoteMail.getAlwaysLoadSenders(owner);
        const rendered = renderMailBody({
            body: mail.body,
            format: mail.format,
            sender: mail.from,
            allowRemoteImages: message.allowRemoteImages === true,
            alwaysLoadSenders
        });
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_render_body_response',
            requestId: message.requestId,
            data: { id: message.id, ...rendered },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to render mail body', error.message, message.requestId);
    }
}

async function handleMarkMail(handlersCtx, ws, message) {
    try {
        if (!message.id) {
            handlersCtx.sendError(ws, 'Message id is required', 'dovecote_mark_mail', message.requestId);
            return;
        }
        const mail = dovecoteMail.markMail(dovecoteMail.HUMAN_OWNER, {
            id: message.id,
            read: typeof message.read === 'boolean' ? message.read : undefined,
            archived: typeof message.archived === 'boolean' ? message.archived : undefined,
            deleted: typeof message.deleted === 'boolean' ? message.deleted : undefined,
            archiveSubfolder: message.archiveSubfolder,
            spam: typeof message.spam === 'boolean' ? message.spam : undefined
        });
        if (!mail) {
            handlersCtx.sendError(ws, 'Message not found', 'MESSAGE_NOT_FOUND', message.requestId);
            return;
        }
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_mark_mail_response',
            requestId: message.requestId,
            data: { mail },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to mark mail', error.message, message.requestId);
    }
}

// message.attachments (optional): [{ name, mimeType, base64 }] — the compose window
// reads the user's picked files client-side (fileToBase64) and sends raw base64 here.
function decodeAttachments(list) {
    if (!Array.isArray(list) || !list.length) return undefined;
    return list.map((file) => ({
        name: file && file.name,
        mimeType: file && file.mimeType,
        data: Buffer.from((file && file.base64) || '', 'base64')
    }));
}

async function handleSendMail(handlersCtx, ws, message) {
    try {
        if (message.body == null || message.body === '') {
            handlersCtx.sendError(ws, 'Body is required', 'dovecote_send_mail', message.requestId);
            return;
        }
        const result = dovecoteMail.sendMail({
            fromOwner: dovecoteMail.HUMAN_OWNER,
            to: message.to,
            cc: message.cc,
            subject: message.subject,
            body: message.body,
            format: message.format,
            replyToId: message.replyTo,
            attachments: decodeAttachments(message.attachments)
        });
        if (result.outbound) await result.outbound;
        const { outbound: _outbound, ...data } = result;
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_send_mail_response',
            requestId: message.requestId,
            data: { success: true, ...data },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        if (error instanceof dovecoteMail.DovecoteError) {
            handlersCtx.sendError(ws, error.message, error.code, message.requestId);
            return;
        }
        handlersCtx.sendError(ws, 'Failed to send mail', error.message, message.requestId);
    }
}

async function handleForwardMail(handlersCtx, ws, message) {
    try {
        if (!message.id || !message.to) {
            handlersCtx.sendError(ws, 'Message id and recipient are required', 'dovecote_forward_mail', message.requestId);
            return;
        }
        const result = dovecoteMail.forwardMail(dovecoteMail.HUMAN_OWNER, { id: message.id, to: message.to });
        if (!result) {
            handlersCtx.sendError(ws, 'Message not found', 'MESSAGE_NOT_FOUND', message.requestId);
            return;
        }
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_forward_mail_response',
            requestId: message.requestId,
            data: { success: true, ...result },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        if (error instanceof dovecoteMail.DovecoteError) {
            handlersCtx.sendError(ws, error.message, error.code, message.requestId);
            return;
        }
        handlersCtx.sendError(ws, 'Failed to forward mail', error.message, message.requestId);
    }
}

async function handleSetImagePref(handlersCtx, ws, message) {
    try {
        if (!message.sender) {
            handlersCtx.sendError(ws, 'Sender is required', 'dovecote_set_image_pref', message.requestId);
            return;
        }
        dovecoteMail.setImagePref(dovecoteMail.HUMAN_OWNER, message.sender, message.alwaysLoad === true);
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_set_image_pref_response',
            requestId: message.requestId,
            data: { success: true },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to save image preference', error.message, message.requestId);
    }
}

async function handleGetAttachment(handlersCtx, ws, message) {
    try {
        if (!message.id) {
            handlersCtx.sendError(ws, 'Attachment id is required', 'dovecote_get_attachment', message.requestId);
            return;
        }
        const owner = resolveViewOwner(message);
        const attachment = dovecoteMail.getAttachment(owner, message.id);
        if (!attachment) {
            handlersCtx.sendError(ws, 'Attachment not found', 'ATTACHMENT_NOT_FOUND', message.requestId);
            return;
        }
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_get_attachment_response',
            requestId: message.requestId,
            data: {
                attachment: {
                    id: attachment.id,
                    name: attachment.name,
                    mimeType: attachment.mimeType,
                    size: attachment.size,
                    base64: attachment.data.toString('base64')
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to read attachment', error.message, message.requestId);
    }
}

// Inbox rows pushed with the change notice. 50 matches listMail's default cap;
// 24 matches the sidebar gadgets' unread page.
const PUSH_INBOX_LIMIT = 50;
const PUSH_UNREAD_LIMIT = 24;

function isMailboxSnapshotRecipient(clientInfo) {
    if (!clientInfo || clientInfo.authenticated !== true) return false;
    if (clientInfo.authMethod === 'application_key' || clientInfo.authMethod === 'replication_token') return false;
    if (clientInfo.applicationKeyId || clientInfo.applicationScopes || clientInfo.applicationAuth || clientInfo.replicationReadOnly) return false;
    const sid = String(clientInfo.sessionId || '');
    if (!sid || sid.startsWith('appkey:') || sid.startsWith('replication:')) return false;
    return clientInfo.userType === 'admin' || clientInfo.userType === 'readonly';
}

function bindMailboxPush(handlersCtx) {
    // setMailboxChangedListener: modules/dovecoteMail.js — WS and MCP writes share this
    dovecoteMail.setMailboxChangedListener((owners) => {
        const gr = handlersCtx && handlersCtx.globalResources;
        const wsServer = gr && gr.getWebSocketServer ? gr.getWebSocketServer() : null;
        if (!wsServer || typeof wsServer.broadcast !== 'function') return;
        try {
            const mailboxes = dovecoteMail.listMailboxes().map((entry) => ({
                owner: entry.owner,
                label: MAILBOX_LABELS[entry.owner] || entry.owner,
                unread: entry.unread,
                spamUnread: entry.spamUnread || 0
            }));
            const inbox = {};
            const unreadInbox = {};
            owners.forEach((owner) => {
                // silent: this snapshot is the browser push, not a mailbox-owner list_mail.
                inbox[owner] = dovecoteMail.listMail(owner, { folder: 'inbox', limit: PUSH_INBOX_LIMIT, silent: true });
                unreadInbox[owner] = dovecoteMail.listMail(owner, { folder: 'inbox', unreadOnly: true, limit: PUSH_UNREAD_LIMIT, silent: true });
            });
            // All-mailbox snapshot: Yukimi's own cookie-session sockets only
            // (browser / user login). Never app-key (sfapp_) or replication
            // sockets; bots use the per-mailbox webhook (#598).
            wsServer.broadcast({
                type: 'dovecote_mailbox_updated',
                data: { owners, mailboxes, inbox, unreadInbox },
                timestamp: new Date().toISOString()
            }, isMailboxSnapshotRecipient);
        } catch (err) {
            console.error('Dovecote mailbox push failed:', err.message);
        }
    });
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[250-dovecoteHandler] registerPackets: missing handlersCtx');
        return;
    }
    bindMailboxPush(handlersCtx);

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'dovecote', ...meta });
    };

    reg('dovecote_list_mailboxes', handleListMailboxes);
    reg('dovecote_list_mail', handleListMail);
    reg('dovecote_get_mail', handleGetMail);
    reg('dovecote_render_body', handleRenderBody);
    reg('dovecote_get_attachment', handleGetAttachment);
    reg('dovecote_mark_mail', handleMarkMail, DOVECOTE_DESTRUCTIVE);
    reg('dovecote_send_mail', handleSendMail, DOVECOTE_DESTRUCTIVE);
    reg('dovecote_forward_mail', handleForwardMail, DOVECOTE_DESTRUCTIVE);
    reg('dovecote_set_image_pref', handleSetImagePref, DOVECOTE_DESTRUCTIVE);
}

module.exports = {
    isMailboxSnapshotRecipient,
    registerPackets
};
