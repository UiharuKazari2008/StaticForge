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
    claude: 'Claude'
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
            unread: entry.unread
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
            archiveSubfolder: message.archiveSubfolder
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

async function handleSendMail(handlersCtx, ws, message) {
    try {
        if (!message.to || !message.body) {
            handlersCtx.sendError(ws, 'Recipient and body are required', 'dovecote_send_mail', message.requestId);
            return;
        }
        const result = dovecoteMail.sendMail({
            fromOwner: dovecoteMail.HUMAN_OWNER,
            to: message.to,
            subject: message.subject,
            body: message.body,
            format: message.format,
            replyToId: message.replyTo
        });
        handlersCtx.sendToClient(ws, {
            type: 'dovecote_send_mail_response',
            requestId: message.requestId,
            data: { success: true, ...result },
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

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[250-dovecoteHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'dovecote', ...meta });
    };

    reg('dovecote_list_mailboxes', handleListMailboxes);
    reg('dovecote_list_mail', handleListMail);
    reg('dovecote_get_mail', handleGetMail);
    reg('dovecote_render_body', handleRenderBody);
    reg('dovecote_mark_mail', handleMarkMail, DOVECOTE_DESTRUCTIVE);
    reg('dovecote_send_mail', handleSendMail, DOVECOTE_DESTRUCTIVE);
    reg('dovecote_forward_mail', handleForwardMail, DOVECOTE_DESTRUCTIVE);
    reg('dovecote_set_image_pref', handleSetImagePref);
}

module.exports = {
    registerPackets
};
