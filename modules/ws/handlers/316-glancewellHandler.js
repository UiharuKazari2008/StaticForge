const wsPacketRegistry = require('../wsPacketRegistry');
const store = require('../../glancewellStore');

// Glancewell (Windows Photo Gallery, Yozora #446): tags, captions, date taken, Pictures Favorites and the Folders
// watched list (modules/glancewellStore.js). Writes push glancewell_changed to every signed-in client; nothing polls.

let gr = null;

const canUse = (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || '')));

function reply(handlersCtx, ws, message, data) {
    handlersCtx.sendToClient(ws, {
        type: `${message.type}_response`,
        requestId: message.requestId,
        data: Object.assign({ success: true }, data),
        timestamp: new Date().toISOString()
    });
}

function changed(payload) {
    try {
        const srv = gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
        if (!srv || typeof srv.broadcast !== 'function') return;
        srv.broadcast({ type: 'glancewell_changed', data: payload, timestamp: new Date().toISOString() },
            (info) => !!(info && info.authenticated !== false && canUse(info)));
    } catch (e) {
        console.warn(`[316-glancewellHandler] broadcast skipped: ${e.message}`);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[316-glancewellHandler] registerPackets: missing handlersCtx');
        return;
    }
    gr = handlersCtx.globalResources;
    try { store.init(gr); } catch (e) { console.warn(`[316-glancewellHandler] store: ${e.message}`); }
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            const { ws, message, clientInfo } = ctx;
            if (!canUse(clientInfo)) {
                handlersCtx.sendError(ws, 'Not allowed', 'Glancewell needs a signed-in account', message.requestId);
                return;
            }
            try {
                reply(handlersCtx, ws, message, await fn(message));
            } catch (error) {
                handlersCtx.sendError(ws, error.message || 'Glancewell request failed', error.message, message.requestId);
            }
        }, { owner: 'glancewell', ...meta });
    };

    // the Tags tree: [{ id, name, parentId, count }]
    reg('glancewell_tags', (m) => ({ tags: store.listTags(m.source) }));
    // create / rename / delete / merge / move a tag
    reg('glancewell_tag_edit', (m) => {
        const out = store.editTag(m);
        if (!out.conflict) changed({ what: 'tags' });
        return out;
    }, { destructive: true });
    // pictures under a Tags node (sub-tags included)
    reg('glancewell_tag_items', (m) => ({ items: store.tagItems(m.tagIds || m.tagId, m.source) }));
    // what the gallery keeps about these pictures: [{ source, key, caption, tags, taken, favorite }]
    reg('glancewell_meta_get', (m) => ({ items: store.getMeta(m.items) }));
    // one change over the selection (caption, addTags, removeTags, clearTags, taken, takenShiftHours, favorite)
    reg('glancewell_meta_set', (m) => {
        const out = store.setMeta(m.items, m.change);
        changed({ what: 'meta', items: out.items, tags: Array.isArray(m.change && m.change.addTags) && m.change.addTags.some((t) => typeof t !== 'number') });
        return out;
    });
    // a whole source's tags, captions, favourites and moved dates (Not Tagged, caption search, the Favorites node)
    reg('glancewell_source_index', (m) => store.sourceIndex(m.source));
    // Pictures Favorites (the phone keeps its Pictures & Videos Favorites from this)
    reg('glancewell_favorites', (m) => ({ items: store.favorites(m.source) }));
    // Folders: the watched VFS folders
    reg('glancewell_watched', () => ({ folders: store.watched() }));
    reg('glancewell_watched_set', (m) => {
        const folders = store.setWatched({ add: m.add, remove: m.remove });
        changed({ what: 'watched' });
        return { folders };
    });
    // a picture deleted for good: forget its tags, caption, date and favourite
    reg('glancewell_forget', (m) => {
        const n = store.forget(m.items);
        if (n) changed({ what: 'meta', forgot: m.items });
        return { forgot: n };
    }, { destructive: true });
}

module.exports = {
    registerPackets
};
