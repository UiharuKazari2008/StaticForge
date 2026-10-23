/**
 * Melaton apps WS (Yozora #638): run a .msaz from the VFS, or the installed app a VFS file opens
 * with (opens[]), with its client side in the tab and its server half in a sandboxed process.
 *
 *   app_launch     { fileId } | { archiveFileId, entryPath } | { packageId }
 *                  -> { instanceId, runner, server, package: { id, title, version, publisher, icon,
 *                       clientEntry, base } }   base: /melaton-apps/<id or run sha>/
 *   app_opener     { name, size } -> { package: { id, title } | null }   (no launch; Explorer asks first)
 *   app_message    { instanceId, data }          to the app's server half
 *   app_terminate  { instanceId }                the app's last window closed / it exited
 *   app_list       {} -> runner.list()           (admin)
 *   app_service_stop { packageId }               (admin)
 * Pushed to the launching tab: app_message { instanceId, data }, app_exited { instanceId, code,
 * signal, fault, reason }. Every instance of a tab ends when the tab disconnects (websocket.js).
 *
 * A package with a server half starts for admin sessions only; readonly sessions can run
 * client-only apps. Runner and sandbox: modules/melatonApps/runner.js. Docs:
 * docs/client-api/melaton-apps.md.
 */
'use strict';

const path = require('path');
const wsPacketRegistry = require('../wsPacketRegistry');
const { MelatonPackageError } = require('../../melatonPackageStore');
const { MelatonAppError } = require('../../melatonApps/runner');
const { getMelatonApps } = require('../../melatonApps');

const OWNER = { owner: 'melatonApps' };
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const MAX_LAUNCH_FILE_BYTES = 32 * 1024 * 1024;

// wsClient.sendMessage spreads the payload at the top level; other callers may wrap it in data. An
// app_message carries the app's own payload in data, so the top level wins when it names a target.
const TARGET_FIELDS = ['instanceId', 'fileId', 'archiveFileId', 'packageId', 'name'];
function payloadOf(message) {
    if (TARGET_FIELDS.some((k) => message[k] != null)) return message;
    return message.data != null && typeof message.data === 'object' ? message.data : message;
}

function registerPackets(handlersCtx) {
    const gr = handlersCtx.globalResources;
    const vfsDb = () => gr.getVfsDatabase();
    const vfsManager = () => gr.getVfsManager();
    const archive = () => vfsManager().getArchive();
    const workspaceExists = (id) => !!gr.getWorkspaceManager().getWorkspaces()[id];
    const apps = () => getMelatonApps(gr, {
        getReservedPacketTypes: () => wsPacketRegistry.listRegisteredPackets().map((row) => row.type)
    });

    function reply(ctx, type, data) {
        handlersCtx.sendToClient(ctx.ws, {
            type: `${type}_response`,
            requestId: ctx.message.requestId,
            data: Object.assign({ success: true }, data),
            timestamp: new Date().toISOString()
        });
    }

    function fail(ctx, err) {
        const known = err instanceof MelatonAppError || err instanceof MelatonPackageError;
        if (!known) console.error('[melaton apps]', err);
        handlersCtx.sendError(ctx.ws, err.message || 'The program could not start', (err && err.code) || 'APP_ERROR', ctx.message.requestId);
    }

    function isAdmin(ctx) {
        return ctx.clientInfo && ctx.clientInfo.userType === 'admin';
    }

    function session(ctx) {
        return {
            userType: (ctx.clientInfo && ctx.clientInfo.userType) || 'readonly',
            applicationScopes: ctx.clientInfo && ctx.clientInfo.applicationScopes
        };
    }

    async function accessibleFile(ctx, fileId) {
        const file = await vfsDb().getUserFileById(String(fileId || ''));
        if (!file || file.trashed_at) throw new MelatonAppError('The file is no longer available.', 'APP_FILE_NOT_FOUND');
        if (!vfsDb().canSessionAccessVfsFile(session(ctx), file, { workspaceExists })) throw new MelatonAppError('Access denied', 'INSUFFICIENT_PERMISSIONS');
        return file;
    }

    function readBlob(file, max) {
        const fs = require('fs');
        const blob = vfsManager().getFileBlobPath(file.content_hash);
        const st = fs.statSync(blob);
        if (st.size > max) throw new MelatonAppError(`${file.original_name} is too large.`, 'APP_FILE_SIZE');
        return fs.readFileSync(blob);
    }

    /** The folder a loose VFS file sits in: its sibling user files, by name. */
    async function folderLaunch(file) {
        const siblings = async () => (await vfsDb().getUserFilesByLocation(file.scope, file.workspace_id, file.folder_id))
            .filter((f) => !f.trashed_at);
        return {
            file: { name: file.original_name, size: file.size },
            folder: `vfs:${file.folder_id || 'root'}`,
            list: async () => (await siblings()).map((f) => ({ name: f.original_name, size: f.size })),
            readFile: async (name) => {
                const lower = name.toLowerCase();
                const hit = (await siblings()).find((f) => String(f.original_name).toLowerCase() === lower);
                return hit ? readBlob(hit, MAX_LAUNCH_FILE_BYTES) : null;
            }
        };
    }

    /** The archive folder an entry sits in (SoraTan.iso's root for SoraTan.exe). */
    async function archiveLaunch(file, entryPath) {
        const info = await archive().getInfo(file);
        const clean = String(entryPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
        const node = info.byPath.get(clean);
        if (!node || node.isDir) throw new MelatonAppError(`${entryPath} is not in the archive.`, 'APP_FILE_NOT_FOUND');
        const dir = path.posix.dirname(node.path) === '.' ? '' : path.posix.dirname(node.path);
        const siblings = () => Array.from(info.byPath.values())
            .filter((n) => !n.isDir && (path.posix.dirname(n.path) === '.' ? '' : path.posix.dirname(n.path)) === dir);
        return {
            node,
            launch: {
                file: { name: node.name, size: node.size },
                folder: `archive:${file.id}:${dir}`,
                list: async () => siblings().map((n) => ({ name: n.name, size: n.size })),
                readFile: async (name) => {
                    const lower = name.toLowerCase();
                    const hit = siblings().find((n) => n.name.toLowerCase() === lower);
                    return hit ? archive().readEntry(file, hit.path, MAX_LAUNCH_FILE_BYTES) : null;
                }
            }
        };
    }

    function installedPackage(row) {
        const store = apps().store;
        return { id: row.id, dir: path.join(store.rootDir, row.id), manifest: row.manifest, base: `/melaton-apps/${row.id}/`, runSha: null };
    }

    function runPackage(buffer) {
        const run = apps().store.prepareRun(buffer);
        return { id: run.manifest.id, dir: run.dir, manifest: run.manifest, base: `/melaton-apps/${run.sha}/`, runSha: run.sha };
    }

    function opener(name, size) {
        const row = apps().store.findOpener(name, size);
        return row ? installedPackage(row) : null;
    }

    const isMsaz = (name) => /\.msaz$/i.test(String(name || ''));

    async function resolveLaunch(ctx, p) {
        if (p.packageId) {
            const row = apps().store.get(String(p.packageId));
            if (!row || row.enabled === false) throw new MelatonAppError('The program is not installed.', 'APP_NOT_INSTALLED');
            return { pkg: installedPackage(row), launch: null };
        }
        if (p.archiveFileId) {
            const file = await accessibleFile(ctx, p.archiveFileId);
            const { node, launch } = await archiveLaunch(file, p.entryPath);
            if (isMsaz(node.name)) {
                return { pkg: runPackage(await archive().readEntry(file, node.path, MAX_PACKAGE_BYTES)), launch };
            }
            const pkg = opener(node.name, node.size);
            if (!pkg) throw new MelatonAppError(`No program opens ${node.name}.`, 'APP_NO_OPENER');
            return { pkg, launch };
        }
        if (p.fileId) {
            const file = await accessibleFile(ctx, p.fileId);
            const launch = await folderLaunch(file);
            if (isMsaz(file.original_name)) return { pkg: runPackage(readBlob(file, MAX_PACKAGE_BYTES)), launch };
            const pkg = opener(file.original_name, file.size);
            if (!pkg) throw new MelatonAppError(`No program opens ${file.original_name}.`, 'APP_NO_OPENER');
            return { pkg, launch };
        }
        throw new MelatonAppError('fileId, archiveFileId + entryPath or packageId is required', 'APP_ARGS');
    }

    function describe(pkg) {
        const m = pkg.manifest;
        return {
            id: pkg.id,
            title: m.title,
            version: m.version,
            publisher: m.publisher || '',
            icon: m.icon ? `${pkg.base}${m.icon}` : '',
            clientEntry: `${pkg.base}${m.client.entry}`,
            base: pkg.base,
            runner: m.server ? m.server.runner : null
        };
    }

    wsPacketRegistry.registerWsPacket('app_launch', async (ctx) => {
        try {
            const p = payloadOf(ctx.message);
            const { pkg, launch } = await resolveLaunch(ctx, p);
            if (pkg.manifest.server && !isAdmin(ctx)) {
                throw new MelatonAppError(`${pkg.manifest.title} needs an administrator to run.`, 'INSUFFICIENT_PERMISSIONS');
            }
            const ws = ctx.ws;
            const started = apps().runner.launch({
                pkg,
                owner: { key: ws, clientId: ctx.clientInfo && ctx.clientInfo.clientId, sessionId: ctx.clientInfo && ctx.clientInfo.sessionId },
                launch,
                deliver: (msg) => handlersCtx.sendToClient(ws, Object.assign({ timestamp: new Date().toISOString() }, msg))
            });
            reply(ctx, 'app_launch', Object.assign({ package: describe(pkg) }, started));
        } catch (err) {
            fail(ctx, err);
        }
    }, OWNER);

    wsPacketRegistry.registerWsPacket('app_opener', async (ctx) => {
        try {
            const p = payloadOf(ctx.message);
            const pkg = opener(p.name, p.size);
            reply(ctx, 'app_opener', { package: pkg ? { id: pkg.id, title: pkg.manifest.title } : null });
        } catch (err) {
            fail(ctx, err);
        }
    }, OWNER);

    wsPacketRegistry.registerWsPacket('app_message', async (ctx) => {
        try {
            const p = payloadOf(ctx.message);
            apps().runner.message(String(p.instanceId || ''), p.data, ctx.ws);
            reply(ctx, 'app_message', {});
        } catch (err) {
            fail(ctx, err);
        }
    }, Object.assign({ dispatch: 'parallel' }, OWNER));

    wsPacketRegistry.registerWsPacket('app_terminate', async (ctx) => {
        try {
            const p = payloadOf(ctx.message);
            reply(ctx, 'app_terminate', apps().runner.terminate(String(p.instanceId || ''), ctx.ws, 'closed'));
        } catch (err) {
            fail(ctx, err);
        }
    }, OWNER);

    wsPacketRegistry.registerWsPacket('app_list', async (ctx) => {
        if (!isAdmin(ctx)) return fail(ctx, new MelatonAppError('Admin access required', 'INSUFFICIENT_PERMISSIONS'));
        reply(ctx, 'app_list', apps().runner.list());
    }, OWNER);

    wsPacketRegistry.registerWsPacket('app_service_stop', async (ctx) => {
        if (!isAdmin(ctx)) return fail(ctx, new MelatonAppError('Admin access required', 'INSUFFICIENT_PERMISSIONS'));
        const p = payloadOf(ctx.message);
        reply(ctx, 'app_service_stop', apps().runner.stopService(String(p.packageId || '')));
    }, Object.assign({ destructive: true }, OWNER));
}

/** websocket.js close: the tab's apps end with it. */
function onClientClosed(ws) {
    try {
        const { getMelatonApps: get } = require('../../melatonApps');
        // only when apps ran in this server (getMelatonApps is lazy)
        const shared = get.peek ? get.peek() : null;
        if (shared) shared.runner.ownerGone(ws);
    } catch (err) {
        console.error('[melaton apps] disconnect cleanup failed:', err.message);
    }
}

module.exports = { registerPackets, onClientClosed, payloadOf };
