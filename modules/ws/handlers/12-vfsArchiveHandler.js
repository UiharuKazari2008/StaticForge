/**
 * 7-Zip in Explorer (modules/vfsArchive.js, public/scripts/comp/explorerArchive.js, Yozora #626).
 *
 *   vfs_archive_describe  { fileId, password? }        -> { archive } | { needsPassword, wrongPassword }
 *   vfs_archive_extract   { fileId, entries?, base?, targetPath, subfolder?, pathMode?, overwrite?,
 *                           eliminateRoot?, password? } -> { opId }
 *   vfs_archive_create    { items, sourcePath, targetPath?, archiveName, format, level, method, ... }
 *   vfs_archive_test      { fileId, entries?, password? }
 *   vfs_archive_hash      { items, method }
 *   vfs_archive_pack      { fileId, entries?, base?, password? } (extract and download)
 *   vfs_archive_control   { opId, action: pause|resume|background|foreground|cancel|answer, answer? }
 *   vfs_archive_caps      {} -> { cpus, totalMem } (Add to Archive's threads and memory lines: 7-Zip runs here)
 *
 * An operation answers at once with its opId; vfs_archive_progress { opId, state, ... } follows to
 * the same connection until state is done / error / cancelled.
 */
const os = require('os');
const wsPacketRegistry = require('../wsPacketRegistry');

function payloadOf(message) {
    return message.data != null ? message.data : message;
}

function registerPackets(handlersCtx) {
    const gr = handlersCtx.globalResources;
    const archive = () => gr.getVfsManager().getArchive();
    const vfsDb = () => gr.getVfsDatabase();
    const workspaceExists = (id) => !!gr.getWorkspaceManager().getWorkspaces()[id];

    async function assertFileAccess(fileId, clientInfo) {
        const file = await vfsDb().getUserFileById(String(fileId || ''));
        if (!file || file.trashed_at) throw new Error('The archive is no longer available.');
        const session = {
            userType: (clientInfo && clientInfo.userType) || 'admin',
            applicationScopes: clientInfo && clientInfo.applicationScopes
        };
        if (!vfsDb().canSessionAccessVfsFile(session, file, { workspaceExists })) throw new Error('Access denied');
        return file;
    }

    function reply(ctx, type, data) {
        handlersCtx.sendToClient(ctx.ws, {
            type: `${type}_response`,
            requestId: ctx.message.requestId,
            data: { success: true, ...data },
            timestamp: new Date().toISOString()
        });
    }

    function startOp(ctx, kind, params) {
        const opId = archive().start(kind, params, {
            send: (data) => handlersCtx.sendToClient(ctx.ws, {
                type: 'vfs_archive_progress',
                data,
                timestamp: new Date().toISOString()
            }),
            broadcast: (pathHint) => {
                if (ctx.wsServer && ctx.wsServer.broadcast) {
                    ctx.wsServer.broadcast({ type: 'vfs_updated', data: { path: pathHint }, timestamp: new Date().toISOString() });
                }
            },
            session: ctx.clientInfo
        });
        return opId;
    }

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            try {
                await fn(ctx, payloadOf(ctx.message));
            } catch (err) {
                handlersCtx.sendError(ctx.ws, err.message || 'Archive operation failed', type, ctx.message.requestId);
            }
        }, { owner: 'vfs', ...meta });
    };

    reg('vfs_archive_describe', async (ctx, p) => {
        await assertFileAccess(p.fileId, ctx.clientInfo);
        reply(ctx, 'vfs_archive_describe', await archive().describe(p.fileId, p.password || ''));
    });

    reg('vfs_archive_extract', async (ctx, p) => {
        await assertFileAccess(p.fileId, ctx.clientInfo);
        reply(ctx, 'vfs_archive_extract', { opId: startOp(ctx, 'extract', p) });
    }, { destructive: true });

    reg('vfs_archive_create', async (ctx, p) => {
        reply(ctx, 'vfs_archive_create', { opId: startOp(ctx, 'create', p) });
    }, { destructive: true });

    reg('vfs_archive_test', async (ctx, p) => {
        await assertFileAccess(p.fileId, ctx.clientInfo);
        reply(ctx, 'vfs_archive_test', { opId: startOp(ctx, 'test', p) });
    });

    reg('vfs_archive_hash', async (ctx, p) => {
        reply(ctx, 'vfs_archive_hash', { opId: startOp(ctx, 'hash', p) });
    });

    reg('vfs_archive_pack', async (ctx, p) => {
        await assertFileAccess(p.fileId, ctx.clientInfo);
        reply(ctx, 'vfs_archive_pack', { opId: startOp(ctx, 'pack', p) });
    });

    reg('vfs_archive_caps', async (ctx) => {
        reply(ctx, 'vfs_archive_caps', { cpus: os.cpus().length, totalMem: os.totalmem() });
    });

    reg('vfs_archive_control', async (ctx, p) => {
        reply(ctx, 'vfs_archive_control', { found: archive().control(p.opId, p.action, p.answer) });
    });
}

module.exports = {
    registerPackets
};
