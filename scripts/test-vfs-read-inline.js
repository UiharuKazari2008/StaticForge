const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const vfsDatabasePath = require.resolve('../modules/vfsDatabase');
const { canSessionAccessVfsFile } = require('../modules/vfsDatabase');

const FOLDER_ID = 'cake-id';
const WORKSPACE_ID = 'lab-ws';

const folders = [
    {
        id: FOLDER_ID,
        scope: 'workspace',
        workspace_id: WORKSPACE_ID,
        parent_id: null,
        name: 'cake-kit',
        trashed_at: null
    }
];

const files = [];

function fileRow(id, name, hash, mime, textOrBuffer, extra) {
    const buf = Buffer.isBuffer(textOrBuffer) ? textOrBuffer : Buffer.from(String(textOrBuffer));
    const row = {
        id,
        original_name: name,
        mime_type: mime,
        size: buf.length,
        scope: 'workspace',
        workspace_id: WORKSPACE_ID,
        folder_id: FOLDER_ID,
        preview_path: null,
        content_hash: hash,
        trashed_at: null,
        created_at: 1,
        updated_at: 1,
        buf
    };
    if (extra) Object.assign(row, extra);
    files.push(row);
    return row;
}

require.cache[vfsDatabasePath] = {
    id: vfsDatabasePath,
    filename: vfsDatabasePath,
    loaded: true,
    exports: {
        canSessionAccessVfsFile,
        async getFolderById(id) {
            return folders.find((folder) => folder.id === id) || null;
        },
        async getFoldersByParent(scope, workspaceId, parentId) {
            return folders.filter((folder) => {
                if (folder.trashed_at) return false;
                if (folder.scope !== scope) return false;
                if (scope === 'workspace' && folder.workspace_id !== workspaceId) return false;
                return (folder.parent_id || null) === (parentId || null);
            });
        },
        async getEntriesByFolder() {
            return [];
        },
        async getUserFileById(id) {
            return files.find((file) => file.id === id) || null;
        },
        async getUserFilesByLocation(scope, workspaceId, folderId) {
            return files.filter((file) => {
                if (file.trashed_at) return false;
                if (file.scope !== scope) return false;
                if (scope === 'workspace' && file.workspace_id !== workspaceId) return false;
                return (file.folder_id || null) === (folderId || null);
            });
        }
    }
};

const { VfsManager } = require('../modules/vfsManager');
const VfsWebSocketHandlers = require('../modules/vfsWebSocketHandlers');
const express = require('express');
const { registerRoutes, _test } = require('../modules/mcpAgentFacade');

const userFilesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-read-inline-'));
const workspaces = {
    [WORKSPACE_ID]: { name: 'Laboratory', files: [], scraps: [], pinned: [] }
};

const resources = {
    getWorkspaceManager: () => ({
        getWorkspaces: () => workspaces,
        getDesktopShortcuts: () => ({ shortcuts: [] })
    }),
    getPath(key) {
        if (key === 'userFiles') return userFilesDir;
        if (key === 'images') return path.join(userFilesDir, 'images');
        if (key === 'tempDownload') return path.join(userFilesDir, 'tmp');
        throw new Error(`Unexpected path key: ${key}`);
    },
    getConfig({ path: key } = {}) {
        if (key === 'public_hostname') return 'localhost:9220';
        return null;
    },
    getMcpPathUuid: () => 'mcp-test-uuid',
    getVfsPathUuid: () => 'vfs-test-uuid',
    getSystemInfoCache: () => null,
    getReferenceMetadataDatabase: () => ({ getFileCacheForReferences: () => ({}) }),
    getNotesDatabase: () => ({ getNotesByWorkspace: async () => [] }),
    getVfsDatabase: () => require.cache[vfsDatabasePath].exports,
    getVfsManager: () => vfs,
    getWebSocketMessageHandlers: () => handlers,
    getWebSocketServer: () => null,
    getApplicationAuthManager: () => authManager
};

const vfs = new VfsManager(resources);
const handlers = {
    globalResources: resources,
    sendToClient(ws, message) {
        ws.send(JSON.stringify(message));
    },
    sendError(ws, message, details, requestId) {
        this.sendToClient(ws, { type: 'error', message, details, requestId });
    },
    isDestructiveOperation() {
        return false;
    }
};
handlers.vfsHandlers = new VfsWebSocketHandlers(handlers);
VfsWebSocketHandlers.registerVfsPackets(handlers);

const authManager = {
    extractAuthFromRequest(req) {
        const header = req.headers && req.headers['x-staticforge-app-key'];
        if (header) return { type: 'application_key', token: String(header).trim() };
        const authorization = req.headers && req.headers.authorization;
        if (authorization && authorization.startsWith('Bearer ')) {
            const bearer = authorization.slice(7).trim();
            if (bearer.startsWith('sfapp_')) return { type: 'application_key', token: bearer };
        }
        return null;
    },
    async validateApplicationKey(token) {
        if (token === 'sfapp_guren') {
            return {
                valid: true,
                userType: 'admin',
                applicationKeyId: 'guren-key',
                scopes: ['vfs'],
                appName: 'Guren',
                userAgentMatched: true
            };
        }
        if (token === 'sfapp_gallery') {
            return {
                valid: true,
                userType: 'admin',
                applicationKeyId: 'gallery-key',
                scopes: ['gallery'],
                appName: 'Gallery',
                userAgentMatched: true
            };
        }
        return { valid: false, message: 'Invalid application key', code: 'INVALID_APP_KEY' };
    },
    async recordApplicationRequest() {}
};

function toolJson(result) {
    assert.ok(result && result.content && result.content[0], 'tool result missing text');
    return JSON.parse(result.content[0].text);
}

async function call(name, args) {
    return _test.callTool(resources, { applicationAuth: { applicationScopes: ['vfs'] }, userType: 'admin' }, name, args);
}

function writeBlob(row) {
    fs.writeFileSync(path.join(userFilesDir, row.content_hash), row.buf);
}

function httpGet(port, urlPath, headers) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: urlPath,
            method: 'GET',
            headers: headers || {}
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks)
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function listen(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function main() {
    assert.strictEqual(_test.VFS_TEXT_INLINE_MAX_BYTES, 64 * 1024);
    assert.strictEqual(
        _test.vfsInlineTextMime({ name: 'sitting-log.jsonl', mimeType: 'application/octet-stream' }),
        'application/x-ndjson'
    );
    for (const name of ['notes.json', 'page.md', 'plain.txt', 'rows.csv', 'cfg.yaml', 'cfg.yml']) {
        assert.ok(_test.vfsInlineTextMime({ name, mimeType: 'application/octet-stream' }), name);
    }
    assert.strictEqual(_test.vfsInlineTextMime({ name: 'shot.png', mimeType: 'image/png' }), null);
    assert.strictEqual(_test.vfsInlineTextMime({ name: 'log.bin', mimeType: 'application/jsonl' }), 'application/jsonl');

    const capped = _test.clampVfsTextWindow({ offset: -4, limit: 999999 }, 100);
    assert.strictEqual(capped.offset, 0);
    assert.strictEqual(capped.limit, _test.VFS_TEXT_INLINE_MAX_BYTES);
    const past = _test.clampVfsTextWindow({ offset: 500 }, 40);
    assert.strictEqual(past.offset, 40);
    assert.strictEqual(past.length, 0);

    const sample = Buffer.from('aaaébbb', 'utf8');
    const page = _test.sliceUtf8Window(sample.subarray(0, 4 + 3), 0, sample.length, 4);
    assert.strictEqual(page.text, 'aaaé');
    assert.strictEqual(page.nextOffset, 5);
    assert.strictEqual(page.truncated, true);

    const log = '{"seat":1,"note":"café"}\n{"seat":2}\n';
    const bigBody = `${'x'.repeat(_test.VFS_TEXT_INLINE_MAX_BYTES)}TAIL`;
    const chars = 'aaaébbb';
    const rows = [
        fileRow('log-id', 'sitting-log.jsonl', 'hash-log', 'application/octet-stream', log),
        fileRow('json-id', 'eater.json', 'hash-json', 'application/octet-stream', '{"slice":1}'),
        fileRow('md-id', 'notes.md', 'hash-md', 'application/octet-stream', '# cake'),
        fileRow('txt-id', 'plain.txt', 'hash-txt', 'application/octet-stream', 'hello'),
        fileRow('csv-id', 'rows.csv', 'hash-csv', 'application/octet-stream', 'a,b\n1,2\n'),
        fileRow('yaml-id', 'cfg.yaml', 'hash-yaml', 'application/octet-stream', 'kind: cake\n'),
        fileRow('yml-id', 'cfg.yml', 'hash-yml', 'application/octet-stream', 'kind: yml\n'),
        fileRow('big-id', 'big.jsonl', 'hash-big', 'application/octet-stream', bigBody),
        fileRow('chars-id', 'chars.txt', 'hash-chars', 'text/plain', chars),
        fileRow('png-id', 'shot.png', 'hash-png', 'image/png', Buffer.from('PNGDATA')),
        fileRow('missing-id', 'gone.json', 'hash-missing', 'application/json', '{}'),
        fileRow('foreign-id', 'foreign.png', 'hash-foreign', 'image/png', Buffer.from('NOPE'), {
            workspace_id: 'missing-ws'
        })
    ];
    rows.forEach((row) => {
        if (row.id === 'missing-id') return;
        writeBlob(row);
    });

    const readDef = _test.TOOL_DEFS.find((tool) => tool.name === 'vfs_read');
    assert.ok(readDef.inputSchema.properties.offset);
    assert.ok(readDef.inputSchema.properties.limit);

    const sitting = toolJson(await call('vfs_read', {
        path: '/Workspaces/Laboratory/cake-kit/sitting-log.jsonl'
    }));
    assert.strictEqual(sitting.success, true, sitting.error || 'jsonl read failed');
    assert.strictEqual(sitting.text, log);
    assert.strictEqual(sitting.truncated, false);
    assert.strictEqual(sitting.offset, 0);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(sitting, 'url'), false);
    assert.strictEqual(sitting.mimeType, 'application/x-ndjson');

    const byId = toolJson(await call('vfs_read', { fileId: 'log-id' }));
    assert.strictEqual(byId.text, log);

    assert.strictEqual(toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/eater.json' })).text, '{"slice":1}');
    assert.strictEqual(toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/notes.md' })).text, '# cake');
    assert.strictEqual(toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/plain.txt' })).text, 'hello');
    assert.strictEqual(toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/rows.csv' })).text, 'a,b\n1,2\n');
    assert.strictEqual(toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/cfg.yaml' })).text, 'kind: cake\n');
    assert.strictEqual(toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/cfg.yml' })).text, 'kind: yml\n');

    const first = toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/big.jsonl' }));
    assert.strictEqual(first.truncated, true);
    assert.strictEqual(first.offset, 0);
    assert.strictEqual(first.bytes, _test.VFS_TEXT_INLINE_MAX_BYTES);
    assert.strictEqual(first.text, 'x'.repeat(_test.VFS_TEXT_INLINE_MAX_BYTES));
    assert.strictEqual(first.nextOffset, _test.VFS_TEXT_INLINE_MAX_BYTES);
    assert.match(first.next, /offset 65536/);
    const second = toolJson(await call('vfs_read', {
        path: '/Workspaces/Laboratory/cake-kit/big.jsonl',
        offset: first.nextOffset
    }));
    assert.strictEqual(second.text, 'TAIL');
    assert.strictEqual(second.truncated, false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(second, 'nextOffset'), false);

    const wide = toolJson(await call('vfs_read', {
        fileId: 'chars-id',
        limit: 1000000
    }));
    assert.strictEqual(wide.text, chars);
    assert.strictEqual(wide.truncated, false);

    const partial = toolJson(await call('vfs_read', { fileId: 'chars-id', offset: 0, limit: 4 }));
    assert.strictEqual(partial.text, 'aaaé');
    assert.strictEqual(partial.nextOffset, 5);
    const rest = toolJson(await call('vfs_read', { fileId: 'chars-id', offset: partial.nextOffset, limit: 10 }));
    assert.strictEqual(rest.text, 'bbb');
    assert.strictEqual(partial.text + rest.text, chars);

    const empty = toolJson(await call('vfs_read', { fileId: 'chars-id', offset: 9999 }));
    assert.strictEqual(empty.text, '');
    assert.strictEqual(empty.truncated, false);

    const missing = toolJson(await call('vfs_read', { fileId: 'missing-id' }));
    assert.strictEqual(missing.success, false);
    assert.match(missing.error, /missing/i);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(missing, 'url'), false);

    const binary = toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/shot.png' }));
    assert.strictEqual(binary.success, true, binary.error || 'binary read failed');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(binary, 'text'), false);
    assert.ok(binary.url);
    const binaryUrl = new URL(binary.url);
    assert.strictEqual(binaryUrl.pathname, '/mcp-test-uuid/vfs/files/png-id');
    assert.ok(!binary.url.includes('/vfs-test-uuid/files/'));
    assert.match(binary.next, /MCP credential/);

    const app = express();
    registerRoutes(app, { globalResources: resources });
    const server = await listen(app);
    try {
        const port = server.address().port;
        const open = await httpGet(port, binaryUrl.pathname);
        assert.strictEqual(open.status, 401);
        assert.match(open.body.toString('utf8'), /APP_KEY_REQUIRED/);

        const queryAuth = await httpGet(port, `${binaryUrl.pathname}?auth=sfapp_guren`);
        assert.strictEqual(queryAuth.status, 400);

        const authed = await httpGet(port, binaryUrl.pathname, {
            'X-StaticForge-App-Key': 'sfapp_guren'
        });
        assert.strictEqual(authed.status, 200);
        assert.strictEqual(authed.body.toString('utf8'), 'PNGDATA');
        assert.match(String(authed.headers['content-type'] || ''), /image\/png/);

        const bearer = await httpGet(port, binaryUrl.pathname, {
            Authorization: 'Bearer sfapp_guren'
        });
        assert.strictEqual(bearer.status, 200);
        assert.strictEqual(bearer.body.toString('utf8'), 'PNGDATA');

        const gallery = await httpGet(port, binaryUrl.pathname, {
            'X-StaticForge-App-Key': 'sfapp_gallery'
        });
        assert.strictEqual(gallery.status, 403);

        const foreign = await httpGet(port, '/mcp-test-uuid/vfs/files/foreign-id', {
            'X-StaticForge-App-Key': 'sfapp_guren'
        });
        assert.strictEqual(foreign.status, 403);

        const unknown = await httpGet(port, '/mcp-test-uuid/vfs/files/does-not-exist', {
            'X-StaticForge-App-Key': 'sfapp_guren'
        });
        assert.strictEqual(unknown.status, 404);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

main().then(() => {
    fs.rmSync(userFilesDir, { recursive: true, force: true });
    console.log('test-vfs-read-inline: ok');
    process.exit(0);
}).catch((error) => {
    fs.rmSync(userFilesDir, { recursive: true, force: true });
    console.error(error);
    process.exit(1);
});
