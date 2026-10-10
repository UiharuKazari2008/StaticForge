const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGenerationJobQueue } = require('../modules/generationJobQueue');
const {
    createGenerationRequestLog,
    resetGenerationRequestLogsForTests,
    buildDurableGalleryImageUrl,
    queryGenerationRequests,
    handleGenerationRequestsHttp,
    handleMcpGalleryImageDownload,
    LOG_FILENAME
} = require('../modules/generationRequestLog');
const { registerWsPacket, getWsPacketEntry } = require('../modules/ws/wsPacketRegistry');
const facade = require('../modules/mcpAgentFacade');
const pairing = require('../modules/sessionWorkspacePairing');

function textOf(result) {
    assert.ok(result && result.content && result.content[0] && result.content[0].text);
    return JSON.parse(result.content[0].text);
}

function mockRes() {
    const state = { statusCode: 0, headers: {}, body: null };
    const res = {
        status(code) {
            state.statusCode = code;
            return res;
        },
        setHeader(key, value) {
            state.headers[key] = value;
            return res;
        },
        json(obj) {
            state.body = obj;
            return res;
        },
        send(buf) {
            state.body = buf;
            return res;
        }
    };
    return { res, state };
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-gen-requests-'));
    try {
        pairing.setWorkspaceLookupForTests(() => '');
        assert.strictEqual(facade._test.DEFAULT_SYNC_GENERATE_WAIT_MS, 20000);
        assert.ok(facade._test.DEFAULT_SYNC_GENERATE_WAIT_MS < 60000);
        assert.strictEqual(facade._test.rateGroupForTool('list_generation_requests'), 'free');
        assert.strictEqual(facade._test.TOOL_DEFS.find((tool) => tool.name === 'list_generation_requests').core, true);
        assert.ok(require('../modules/mcpModuleRegistry').toolInModule('list_generation_requests', 'core_generation'));
        assert.ok(facade._test.MCP_INSTRUCTIONS.includes('list_generation_requests'));
        assert.ok(facade._test.MCP_INSTRUCTIONS.includes('imageUrl'));
        assert.ok(facade._test.TOOL_DEFS.find((tool) => tool.name === 'generate_image').description.includes('jobId'));

        const logFile = path.join(root, 'unit-log.json');
        const unit = createGenerationRequestLog({ filePath: logFile });
        unit.remember({
            jobId: 'gjob_old',
            status: 'completed',
            type: 'generate_image',
            source: 'mcp',
            caller: 'Other/appkey:key-old',
            callerId: 'key-old',
            workspace: 'other',
            createdAt: Date.parse('2020-01-01T00:00:00.000Z'),
            finishedAt: Date.parse('2020-01-01T00:00:05.000Z'),
            imageIds: ['old.png'],
            imageUrls: ['http://localhost:9220/uuid/gallery/old.png'],
            prompt: 'SECRET_PROMPT_TEXT'
        });
        unit.remember({
            jobId: 'gjob_new',
            status: 'completed',
            caller: 'Guren/appkey:key-guren',
            callerId: 'key-guren',
            workspace: 'atelier',
            createdAt: Date.parse('2026-10-09T12:00:00.000Z'),
            imageIds: ['new.png'],
            imageUrls: ['http://localhost:9220/uuid/gallery/new.png']
        });
        unit.remember({
            jobId: 'gjob_mid',
            status: 'queued',
            caller: 'Guren/appkey:key-guren',
            callerId: 'key-guren',
            workspace: 'atelier',
            createdAt: Date.parse('2026-10-09T11:00:00.000Z'),
            imageIds: []
        });
        const rawLog = fs.readFileSync(logFile, 'utf8');
        assert.ok(!rawLog.includes('SECRET_PROMPT_TEXT'));
        const reloaded = createGenerationRequestLog({ filePath: logFile });
        const guren = reloaded.list({
            caller: 'guren',
            workspace: 'atelier',
            since: '2026-10-09T00:00:00.000Z',
            until: '2026-10-09T18:00:00.000Z'
        });
        assert.strictEqual(guren.total, 2);
        assert.strictEqual(guren.requests[0].jobId, 'gjob_new');
        assert.strictEqual(guren.requests[0].caller, 'Guren/appkey:key-guren');
        assert.deepStrictEqual(guren.requests[0].imageIds, ['new.png']);
        assert.strictEqual(guren.requests[0].imageUrls[0], 'http://localhost:9220/uuid/gallery/new.png');
        assert.strictEqual(guren.requests[1].jobId, 'gjob_mid');
        const page = reloaded.list({ caller: 'key-guren', offset: 1, limit: 1 });
        assert.strictEqual(page.total, 2);
        assert.strictEqual(page.requests.length, 1);
        assert.strictEqual(page.requests[0].jobId, 'gjob_mid');
        assert.throws(() => reloaded.list({ since: 'not-a-time' }), /since must be an ISO time/);

        const durable = buildDurableGalleryImageUrl({
            getConfig: ({ path: key }) => (key === 'public_hostname' ? 'localhost:9220' : null),
            getMcpPathUuid: () => 'test-mcp-uuid'
        }, 'durable.png');
        assert.strictEqual(durable, 'http://localhost:9220/test-mcp-uuid/gallery/durable.png');
        assert.strictEqual(buildDurableGalleryImageUrl({
            getConfig: () => null,
            getMcpPathUuid: () => 'test-mcp-uuid'
        }, '../etc/passwd'), '');
        const hinted = facade._test.attachDurableGalleryFields({
            getConfig: ({ path: key }) => (key === 'public_hostname' ? 'localhost:9220' : null),
            getMcpPathUuid: () => 'test-mcp-uuid'
        }, {
            filename: 'durable.png',
            wrote: false,
            wroteReason: 'remote-sandbox',
            next: 'wrote:false (remote-sandbox).'
        });
        assert.strictEqual(hinted.saved, true);
        assert.strictEqual(hinted.savedTo, 'gallery');
        assert.strictEqual(hinted.imageUrl, durable);
        assert.ok(hinted.next.includes('remote-sandbox'));
        assert.ok(hinted.next.includes('does not expire'));

        const imagesDir = path.join(root, 'images');
        fs.mkdirSync(imagesDir);
        fs.writeFileSync(path.join(imagesDir, 'durable.png'), 'png-bytes');
        const imageGr = { getPath: (key) => (key === 'images' ? imagesDir : path.join(root, key)) };
        const okDownload = mockRes();
        handleMcpGalleryImageDownload(imageGr, {
            applicationAuth: { applicationScopes: ['generation'] },
            params: { filename: 'durable.png' }
        }, okDownload.res);
        assert.strictEqual(okDownload.state.statusCode, 200);
        assert.strictEqual(okDownload.state.headers['Content-Type'], 'image/png');
        assert.strictEqual(String(okDownload.state.body), 'png-bytes');
        assert.ok(!okDownload.state.headers['Cache-Control'].includes('max-age=900'));
        const galleryDownload = mockRes();
        handleMcpGalleryImageDownload(imageGr, {
            applicationAuth: { applicationScopes: ['gallery'] },
            params: { filename: 'durable.png' }
        }, galleryDownload.res);
        assert.strictEqual(galleryDownload.state.statusCode, 200);
        const denied = mockRes();
        handleMcpGalleryImageDownload(imageGr, {
            applicationAuth: { applicationScopes: ['notes'] },
            params: { filename: 'durable.png' }
        }, denied.res);
        assert.strictEqual(denied.state.statusCode, 403);
        const traversal = mockRes();
        handleMcpGalleryImageDownload(imageGr, {
            applicationAuth: { applicationScopes: ['generation'] },
            params: { filename: '../durable.png' }
        }, traversal.res);
        assert.strictEqual(traversal.state.statusCode, 400);

        const queue = createGenerationJobQueue({ delayMinMs: 0, delayMaxMs: 0 });
        let release = null;
        const gate = new Promise((resolve) => { release = resolve; });
        let mode = 'ok';
        const stub = async (ctx) => {
            assert.strictEqual(ctx.message.skipGenerationQueue, true);
            if (mode === 'gate') await gate;
            if (mode === 'delay') await new Promise((resolve) => setTimeout(resolve, 400));
            if (mode === 'error') {
                ctx.ws.send(JSON.stringify({
                    type: 'image_generation_error',
                    requestId: ctx.message.requestId,
                    error: 'boom',
                    data: { message: 'boom' }
                }));
                return;
            }
            ctx.ws.send(JSON.stringify({
                type: 'image_generation_response',
                requestId: ctx.message.requestId,
                data: { filename: 'durable.png', filenames: ['durable.png'], seed: 9 }
            }));
        };
        registerWsPacket('generate_image', stub);
        assert.strictEqual(getWsPacketEntry('generate_image').handler, stub);

        const cacheDir = path.join(root, 'cache');
        fs.mkdirSync(cacheDir);
        let syncWaitMs = 5000;
        resetGenerationRequestLogsForTests();
        const globalResources = {
            getGenerationJobQueue: () => queue,
            getPath: (key) => {
                if (key === 'cache') return cacheDir;
                if (key === 'images') return imagesDir;
                throw new Error(`unexpected path ${key}`);
            },
            getMcpPathUuid: () => 'test-mcp-uuid',
            getConfig: (arg) => {
                const key = arg && arg.path;
                if (key === 'mcp_sync_generate_wait_ms') return syncWaitMs;
                if (key === 'public_hostname') return 'localhost:9220';
                if (!key) {
                    return {
                        userGlobalSettings: {
                            remoteAccess: { openGeneratedImages: 'disabled', defaultGenerationMethod: 'detached' }
                        }
                    };
                }
                return null;
            },
            getWebSocketMessageHandlers: () => ({ isDestructiveOperation: () => false }),
            getWebSocketServer: () => null
        };
        const req = {
            applicationAuth: {
                applicationScopes: ['generation'],
                applicationKeyId: 'key-guren',
                appName: 'Guren'
            },
            authMethod: 'application_key',
            userType: 'admin'
        };
        assert.strictEqual(facade._test.generationCaller(req).caller, 'Guren/appkey:key-guren');
        assert.strictEqual(facade._test.syncGenerateWaitMs(globalResources), 5000);

        const slow = queue.submit({
            run: () => new Promise((resolve) => {
                setTimeout(() => resolve({ success: true, flat: { filename: 'late.png' } }), 80);
            })
        });
        await assert.rejects(() => queue.wait(slow.id, 20), (err) => err && err.code === 'GENERATION_JOB_TIMEOUT');
        assert.strictEqual((await queue.wait(slow.id)).flat.filename, 'late.png');

        mode = 'ok';
        const synced = textOf(await facade._test.callTool(globalResources, req, 'generate_image', {
            prompt: 'SECRET_PROMPT_TEXT',
            workspace: 'atelier'
        }));
        assert.ok(/^gjob_[0-9a-f]{16}$/.test(synced.jobId));
        assert.strictEqual(synced.filename, 'durable.png');
        assert.strictEqual(synced.timedOut, undefined);
        assert.strictEqual(synced.saved, true);
        assert.strictEqual(synced.savedTo, 'gallery');
        assert.strictEqual(synced.imageId, 'durable.png');
        assert.strictEqual(synced.imageUrl, 'http://localhost:9220/test-mcp-uuid/gallery/durable.png');
        assert.ok(!String(synced.imageUrl).includes('expires'));

        mode = 'gate';
        const asyncStarted = Date.now();
        const asyncBody = textOf(await facade._test.callTool(globalResources, req, 'generate_image', {
            prompt: 'SECRET_PROMPT_TEXT',
            workspace: 'atelier',
            async: true
        }));
        assert.ok(Date.now() - asyncStarted < 150);
        assert.ok(asyncBody.jobId);
        assert.notStrictEqual(asyncBody.jobId, synced.jobId);
        assert.strictEqual(asyncBody.filename, undefined);
        release();
        const awaitedAsync = textOf(await facade._test.callTool(globalResources, req, 'await_generation_job', {
            jobId: asyncBody.jobId
        }));
        assert.strictEqual(awaitedAsync.jobId, asyncBody.jobId);
        assert.strictEqual(awaitedAsync.filename, 'durable.png');
        assert.strictEqual(awaitedAsync.imageUrl, synced.imageUrl);

        mode = 'delay';
        syncWaitMs = 40;
        const timeoutStarted = Date.now();
        const timed = textOf(await facade._test.callTool(globalResources, req, 'generate_image', {
            prompt: 'SECRET_PROMPT_TEXT',
            workspace: 'atelier'
        }));
        assert.ok(Date.now() - timeoutStarted < 300);
        assert.ok(timed.jobId);
        assert.strictEqual(timed.timedOut, true);
        assert.strictEqual(timed.filename, undefined);
        const continued = textOf(await facade._test.callTool(globalResources, req, 'await_generation_job', {
            jobId: timed.jobId
        }));
        assert.strictEqual(continued.jobId, timed.jobId);
        assert.strictEqual(continued.filename, 'durable.png');
        assert.strictEqual(continued.imageUrl, synced.imageUrl);

        mode = 'error';
        syncWaitMs = 5000;
        const failedResult = await facade._test.callTool(globalResources, req, 'generate_image', {
            prompt: 'SECRET_PROMPT_TEXT',
            workspace: 'atelier'
        });
        const failed = textOf(failedResult);
        assert.strictEqual(failedResult.isError, true);
        assert.ok(failed.jobId);
        assert.strictEqual(failed.success, false);

        const historyFile = fs.readFileSync(path.join(cacheDir, LOG_FILENAME), 'utf8');
        assert.ok(!historyFile.includes('SECRET_PROMPT_TEXT'));
        assert.ok(historyFile.includes(synced.jobId));

        const listed = textOf(await facade._test.callTool(globalResources, req, 'list_generation_requests', {
            caller: 'Guren',
            workspace: 'atelier',
            since: '2026-01-01T00:00:00.000Z',
            limit: 10
        }));
        assert.strictEqual(listed.success, true);
        const ids = listed.requests.map((row) => row.jobId);
        assert.ok(ids.includes(synced.jobId));
        assert.ok(ids.includes(asyncBody.jobId));
        assert.ok(ids.includes(timed.jobId));
        assert.ok(ids.includes(failed.jobId));
        listed.requests.forEach((row) => {
            assert.ok(row.jobId);
            assert.ok(row.createdAt);
            assert.strictEqual(row.caller, 'Guren/appkey:key-guren');
            assert.strictEqual(row.workspace, 'atelier');
        });
        const doneRow = listed.requests.find((row) => row.jobId === synced.jobId);
        assert.strictEqual(doneRow.status, 'completed');
        assert.deepStrictEqual(doneRow.imageIds, ['durable.png']);
        assert.strictEqual(doneRow.imageUrls[0], synced.imageUrl);
        const none = textOf(await facade._test.callTool(globalResources, req, 'list_generation_requests', {
            caller: 'nobody'
        }));
        assert.strictEqual(none.total, 0);
        const badTime = textOf(await facade._test.callTool(globalResources, req, 'list_generation_requests', {
            since: 'yesterdayish'
        }));
        assert.strictEqual(badTime.success, false);

        const httpOk = mockRes();
        handleGenerationRequestsHttp(globalResources, {
            applicationAuth: { applicationScopes: ['generation'] },
            query: { caller: 'key-guren', workspace: 'atelier', limit: '1', offset: '0' }
        }, httpOk.res);
        assert.strictEqual(httpOk.state.statusCode, 200);
        assert.strictEqual(httpOk.state.body.success, true);
        assert.strictEqual(httpOk.state.body.limit, 1);
        assert.strictEqual(httpOk.state.body.requests.length, 1);
        assert.ok(httpOk.state.body.total >= 4);
        const httpDenied = mockRes();
        handleGenerationRequestsHttp(globalResources, {
            applicationAuth: { applicationScopes: ['gallery'] },
            query: {}
        }, httpDenied.res);
        assert.strictEqual(httpDenied.state.statusCode, 403);
        const httpBad = mockRes();
        handleGenerationRequestsHttp(globalResources, {
            applicationAuth: { applicationScopes: ['universal'] },
            query: { until: 'nope' }
        }, httpBad.res);
        assert.strictEqual(httpBad.state.statusCode, 400);

        const direct = queryGenerationRequests(globalResources, { caller: 'key-guren', workspace: 'other' });
        assert.strictEqual(direct.total, 0);

        console.log('test-generation-requests: ok');
    } finally {
        pairing.setWorkspaceLookupForTests(null);
        resetGenerationRequestLogsForTests();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
