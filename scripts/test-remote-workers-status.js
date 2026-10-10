'use strict';

/**
 * Remote worker status rows: Ruiko, grimoire-browser, replication master, NovelAI.
 * No live GPU, no NovelAI, no secrets in the payload.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { clearLocalWorkerHealthCache } = require('../modules/localUpscaleWorker');
const {
    collectRemoteWorkerStatuses,
    scrubText,
    publicHostFromUrl,
    REMOTE_WORKER_IDS
} = require('../modules/remoteWorkersStatus');
const { handleRemoteWorkersStatus } = require('../modules/ws/handlers/172-remoteWorkersHandler');

const KEY = 'super-secret-worker-key';
const GRIM = 'grim-secret-token';
const REPL = 'repl-secret-token';

function listen(handler) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function close(server) {
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
}

function resources({ url, key, replication, monitor }) {
    return {
        getSecureConfig() {
            return { url: url || '', key: key || '' };
        },
        getReplicationService() {
            return {
                getReplicationConfig() {
                    return replication || { role: 'standalone', connectivity: 'normal', masterAccessUrl: null };
                }
            };
        },
        getNovelAiStatusMonitor() {
            return monitor || null;
        }
    };
}

function novelMonitor(payload, refresh) {
    return {
        refresh: refresh || (async () => payload),
        getClientPayload() {
            return payload;
        }
    };
}

function assertNoSecrets(value) {
    const blob = JSON.stringify(value);
    assert.ok(!blob.includes(KEY), 'worker key leaked');
    assert.ok(!blob.includes(GRIM), 'grimoire token leaked');
    assert.ok(!blob.includes(REPL), 'replication token leaked');
    assert.ok(!blob.includes('Bearer '), 'authorization leaked');
}

async function main() {
    assert.deepStrictEqual(REMOTE_WORKER_IDS, ['ruiko', 'grimoire-browser', 'replication-master', 'novelai']);
    assert.strictEqual(publicHostFromUrl('http://user:' + KEY + '@192.168.1.9:8188/health?token=' + GRIM), '192.168.1.9:8188');
    const scrubbed = scrubText('Bearer ' + KEY + ' http://user:' + REPL + '@host/x?token=' + GRIM, [KEY, GRIM, REPL]);
    assert.ok(!scrubbed.includes(KEY));
    assert.ok(!scrubbed.includes(GRIM));
    assert.ok(!scrubbed.includes(REPL));

    const hits = { health: 0, models: 0, replication: 0, grim: 0 };
    let delayMs = 0;
    let replicationStatus = 200;
    const server = await listen((req, res) => {
        const url = (req.url || '').split('?')[0];
        const auth = req.headers.authorization || '';
        const finish = (status, body) => {
            const send = () => {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (delayMs > 0) setTimeout(send, delayMs);
            else send();
        };
        if (url === '/health' && auth === 'Bearer ' + KEY) {
            hits.health += 1;
            finish(200, {
                ok: true,
                auth: 'ok',
                version: KEY,
                gpu: KEY,
                queue_length: 0,
                key: KEY,
                token: GRIM
            });
            return;
        }
        if (url === '/health') {
            hits.grim += 1;
            assert.ok(!auth, 'grimoire /health must not send the bearer token');
            finish(200, { ok: true, browser: true, token: GRIM, chrome: '/tmp/' + KEY });
            return;
        }
        if (url === '/models') {
            hits.models += 1;
            assert.strictEqual(auth, 'Bearer ' + KEY);
            finish(200, { models: [{ id: 'RealESRGAN_x4plus', name: 'RealESRGAN x4plus', scale: 4 }] });
            return;
        }
        if (url === '/replication/status') {
            hits.replication += 1;
            assert.strictEqual(req.headers['x-replication-token'], REPL);
            finish(replicationStatus, { success: replicationStatus === 200 });
            return;
        }
        res.writeHead(404);
        res.end();
    });

    const hangHits = { n: 0 };
    const hang = await listen((req, res) => {
        hangHits.n += 1;
        void res;
    });

    const savedOrigin = process.env.GRIMOIRE_BROWSER_ORIGIN;
    const savedToken = process.env.GRIMOIRE_BROWSER_TOKEN;
    const port = server.address().port;
    const base = 'http://127.0.0.1:' + port;
    const hangBase = 'http://127.0.0.1:' + hang.address().port;

    try {
        clearLocalWorkerHealthCache();
        const empty = await collectRemoteWorkerStatuses(resources({}), {
            timeoutMs: 500,
            grimoireConfig: { origin: '', token: '' }
        });
        assert.strictEqual(empty.workers.length, 4);
        assert.strictEqual(empty.workers.find((row) => row.id === 'ruiko').status, 'unconfigured');
        assert.strictEqual(empty.workers.find((row) => row.id === 'grimoire-browser').status, 'unconfigured');
        assert.strictEqual(empty.workers.find((row) => row.id === 'replication-master').status, 'unconfigured');
        assert.strictEqual(empty.workers.find((row) => row.id === 'novelai').status, 'unconfigured');
        empty.workers.forEach((row) => assert.strictEqual(row.latencyMs, null));

        clearLocalWorkerHealthCache();
        const credentialed = await collectRemoteWorkerStatuses(resources({
            url: 'http://user:' + KEY + '@127.0.0.1:' + port,
            key: KEY
        }), {
            workerId: 'ruiko',
            timeoutMs: 1000,
            grimoireConfig: { origin: '', token: '' }
        });
        assertNoSecrets(credentialed);
        assert.strictEqual(credentialed.workers[0].host, '127.0.0.1:' + port);
        assert.ok(!String(credentialed.workers[0].detail).includes('user:'));

        clearLocalWorkerHealthCache();
        const healthy = await collectRemoteWorkerStatuses(resources({
            url: base,
            key: KEY,
            replication: {
                role: 'child',
                connectivity: 'normal',
                masterAccessUrl: base,
                replicationToken: REPL
            },
            monitor: novelMonitor({
                ok: true,
                stale: false,
                overall: { status: 'Operational', statusCode: 100 },
                imageGenerationBlocked: false,
                activeIncident: null
            })
        }), {
            timeoutMs: 2000,
            grimoireConfig: { origin: 'http://user:' + GRIM + '@127.0.0.1:' + port, token: GRIM }
        });
        assertNoSecrets(healthy);
        const ruiko = healthy.workers.find((row) => row.id === 'ruiko');
        const grim = healthy.workers.find((row) => row.id === 'grimoire-browser');
        const repl = healthy.workers.find((row) => row.id === 'replication-master');
        const nai = healthy.workers.find((row) => row.id === 'novelai');
        assert.strictEqual(ruiko.status, 'healthy');
        assert.strictEqual(ruiko.host, '127.0.0.1:' + port);
        assert.ok(ruiko.latencyMs >= 0);
        assert.strictEqual(grim.status, 'healthy');
        assert.strictEqual(grim.host, '127.0.0.1:' + port);
        assert.strictEqual(repl.status, 'healthy');
        assert.strictEqual(repl.host, '127.0.0.1:' + port);
        assert.strictEqual(nai.status, 'healthy');
        assert.strictEqual(nai.host, 'status.novelai.net');
        assert.ok(hits.health >= 1);
        assert.ok(hits.models >= 1, 'Ruiko check must call /models');
        assert.ok(hits.replication >= 1);
        assert.ok(hits.grim >= 1);

        const beforeHang = hangHits.n;
        const onlyRuiko = await collectRemoteWorkerStatuses(resources({
            url: base,
            key: KEY,
            monitor: novelMonitor({ ok: true, overall: { statusCode: 100 } })
        }), {
            workerId: 'ruiko',
            timeoutMs: 2000,
            grimoireConfig: { origin: hangBase, token: GRIM }
        });
        assert.strictEqual(onlyRuiko.workers.length, 1);
        assert.strictEqual(onlyRuiko.workers[0].id, 'ruiko');
        assert.strictEqual(hangHits.n, beforeHang, 'per-row refresh must not contact other hosts');
        assertNoSecrets(onlyRuiko);

        const unknown = await collectRemoteWorkerStatuses(resources({}), {
            workerId: 'sequenzia',
            timeoutMs: 300,
            grimoireConfig: { origin: '', token: '' }
        });
        assert.strictEqual(unknown.error, 'Unknown remote worker');
        assert.deepStrictEqual(unknown.workers, []);

        clearLocalWorkerHealthCache();
        const started = Date.now();
        const dead = await collectRemoteWorkerStatuses(resources({ url: hangBase, key: KEY }), {
            workerId: 'ruiko',
            timeoutMs: 400,
            grimoireConfig: { origin: '', token: '' }
        });
        const elapsed = Date.now() - started;
        assert.ok(elapsed < 2000, 'dead host hung the check (' + elapsed + 'ms)');
        assert.strictEqual(dead.workers[0].status, 'offline');
        assert.strictEqual(dead.workers[0].host, hang.address().address + ':' + hang.address().port);
        assertNoSecrets(dead);

        delayMs = 180;
        clearLocalWorkerHealthCache();
        const slow = await collectRemoteWorkerStatuses(resources({ url: base, key: KEY }), {
            workerId: 'ruiko',
            timeoutMs: 2000,
            slowMs: 50,
            grimoireConfig: { origin: '', token: '' }
        });
        delayMs = 0;
        assert.strictEqual(slow.workers[0].status, 'degraded');
        assert.ok(slow.workers[0].latencyMs >= 150);

        const blocked = await collectRemoteWorkerStatuses(resources({
            monitor: novelMonitor({
                ok: true,
                overall: { status: 'Partial Outage', statusCode: 400 },
                imageGenerationBlocked: true,
                activeIncident: { severity: 'outage', status: 'Partial Outage' }
            })
        }), {
            workerId: 'novelai',
            timeoutMs: 500,
            grimoireConfig: { origin: '', token: '' }
        });
        assert.strictEqual(blocked.workers[0].status, 'offline');

        const airHits = hits.replication;
        const air = await collectRemoteWorkerStatuses(resources({
            replication: {
                role: 'child',
                connectivity: 'airgapped',
                masterAccessUrl: 'http://user:' + REPL + '@127.0.0.1:' + port,
                replicationToken: REPL
            }
        }), {
            workerId: 'replication-master',
            timeoutMs: 500,
            grimoireConfig: { origin: '', token: '' }
        });
        assert.strictEqual(air.workers[0].status, 'degraded');
        assert.strictEqual(air.workers[0].host, '127.0.0.1:' + port);
        assert.strictEqual(air.workers[0].latencyMs, null);
        assert.strictEqual(hits.replication, airHits, 'airgapped must not probe the master');
        assertNoSecrets(air);

        replicationStatus = 500;
        const down = await collectRemoteWorkerStatuses(resources({
            replication: {
                role: 'ephemeral',
                connectivity: 'normal',
                masterAccessUrl: base,
                replicationToken: REPL
            }
        }), {
            workerId: 'replication-master',
            timeoutMs: 1000,
            grimoireConfig: { origin: '', token: '' }
        });
        replicationStatus = 200;
        assert.strictEqual(down.workers[0].status, 'offline');
        assert.strictEqual(down.workers[0].detail, 'HTTP 500');
        assertNoSecrets(down);

        const hungMonitor = await collectRemoteWorkerStatuses(resources({
            monitor: novelMonitor(null, () => new Promise(() => {}))
        }), {
            workerId: 'novelai',
            timeoutMs: 300,
            grimoireConfig: { origin: '', token: '' }
        });
        assert.strictEqual(hungMonitor.workers[0].status, 'offline');
        assert.strictEqual(hungMonitor.workers[0].detail, 'timed out');

        delete process.env.GRIMOIRE_BROWSER_ORIGIN;
        delete process.env.GRIMOIRE_BROWSER_TOKEN;
        process.env.GRIMOIRE_BROWSER_ORIGIN = base;
        process.env.GRIMOIRE_BROWSER_TOKEN = GRIM;
        const sent = [];
        await handleRemoteWorkersStatus({
            globalResources: resources({
                url: base,
                key: KEY,
                replication: {
                    role: 'child',
                    connectivity: 'normal',
                    masterAccessUrl: base,
                    replicationToken: REPL
                },
                monitor: novelMonitor({
                    ok: true,
                    overall: { statusCode: 100 },
                    imageGenerationBlocked: false
                })
            })
        }, {}, { requestId: 'req-remote', workerId: 'grimoire-browser' }, {}, {
            sendToClient(_ws, packet) { sent.push(packet); }
        });
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].type, 'remote_workers_status_response');
        assert.strictEqual(sent[0].requestId, 'req-remote');
        assert.strictEqual(sent[0].data.workers.length, 1);
        assert.strictEqual(sent[0].data.workers[0].id, 'grimoire-browser');
        assertNoSecrets(sent[0]);

        const applet = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/dataManagementDsapApplet.js'), 'utf8');
        assert.ok(applet.includes("dsapSmfBuildSectionHdr('Remote Workers')"));
        assert.ok(applet.includes('data-mgmt-worker-dot-healthy'));
        assert.ok(applet.includes('data-mgmt-worker-dot-degraded'));
        assert.ok(applet.includes('data-mgmt-worker-dot-offline'));
        assert.ok(applet.includes('data-mgmt-worker-dot-unconfigured'));
        assert.ok(applet.includes('data-remote-worker-refresh'));
        assert.ok(applet.includes('dataMgmtRemoteWorkersRefreshAll'));
        const builderStart = applet.indexOf('function dataMgmtDsapBuildRemoteWorkersHtml');
        const builderEnd = applet.indexOf('function dataMgmtDsapRemoteWorkersRender');
        assert.ok(builderStart > 0 && builderEnd > builderStart);
        assert.ok(!applet.slice(builderStart, builderEnd).includes('style='), 'remote worker markup must not use inline styles');

        const auth = fs.readFileSync(path.join(__dirname, '../modules/applicationAuthManager.js'), 'utf8');
        assert.ok(auth.includes("'remote_workers_status'"));

        console.log('test-remote-workers-status: ok');
    } finally {
        if (savedOrigin == null) delete process.env.GRIMOIRE_BROWSER_ORIGIN;
        else process.env.GRIMOIRE_BROWSER_ORIGIN = savedOrigin;
        if (savedToken == null) delete process.env.GRIMOIRE_BROWSER_TOKEN;
        else process.env.GRIMOIRE_BROWSER_TOKEN = savedToken;
        await close(server);
        await close(hang);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
