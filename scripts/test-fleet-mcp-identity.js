#!/usr/bin/env node
// #1199: Fleet sessions have MCP keys of their own ("Fleet", "Fleet work items") and the Remote Access notice names them
// instead of "Claude Code". Real code, no mocks of the module under test: the real application auth manager on a temp
// database, the real MCP auth middleware, the real bridge and facade with a fake WebSocket server.
// Run: node scripts/test-fleet-mcp-identity.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-fleet-mcp-'));
process.env.DREAMSCAPE_CLAUDE_DESK_STATE = path.join(tmp, 'state');
process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');

const { initializeApplicationAuthDatabase, getDb } = require('../modules/applicationAuthDatabase');
const { ApplicationAuthManager } = require('../modules/applicationAuthManager');
const scopes = require('../modules/directorAppKeyScopes');
const ident = require('../modules/fleetMcpIdentity');
const bridge = require('../modules/agentClientBridge');
const { createMcpAuthMiddleware } = require('../modules/auth');
const { _test: facade } = require('../modules/mcpAgentFacade');
const mcpActivity = require('../modules/mcpActivity');
const WebSocket = require('ws');

const UA = 'claude-code/2.1.332 (sdk-cli)';
const SESSION_A = '0a1b2c3d-1111-4222-8333-444455556666';
const SESSION_B = '9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff';
const SESSION_C = '12345678-1234-4234-8234-123456789abc';

const sortedCopy = (list) => list.slice().sort();
const reqWith = (appName, headers, extra) => Object.assign({
    applicationAuth: { appName, applicationKeyId: 'kid-1', applicationScopes: ['generation'] },
    headers: headers || {}
}, extra || {});

async function activeKeys(manager, label) {
    const keys = await manager.listApplicationKeys({ includeExpired: true });
    return keys.filter((key) => key.appName === label && key.status !== 'revoked' && key.status !== 'replaced' && !key.revokedAt);
}

async function main() {
    // ---------------------------------------------------------------- 0. scope lists
    assert.deepStrictEqual(scopes.FLEET_KEY_TARGETS, [
        { persona: 'fleet', label: 'Fleet' },
        { persona: 'fleet-items', label: 'Fleet work items' }
    ]);
    assert.ok(!scopes.FLEET_MCP_SCOPES.includes('sfapp_dovecote'), 'no Dovecote mail');
    assert.ok(!scopes.FLEET_MCP_SCOPES.includes('universal'), 'never universal');
    ['sfapp_plaud', 'sfapp_claude_fleet', 'sfapp_mail_exchange', 'sfapp_messaging_bridge', 'sfapp_alchemy_browser'].forEach((scope) => {
        assert.ok(!scopes.FLEET_MCP_SCOPES.includes(scope), `no ${scope}`);
    });
    assert.deepStrictEqual(scopes.FLEET_MCP_SCOPES, scopes.DIRECTOR_MCP_SCOPES.filter((s) => s !== 'sfapp_dovecote'));
    assert.deepStrictEqual(ident.FLEET_MCP_SCOPES, scopes.FLEET_MCP_SCOPES, 'fleetMcpIdentity re-exports the scope list');
    assert.strictEqual(ident.FLEET_SESSION_HEADER, 'x-fleet-session');
    assert.deepStrictEqual(Object.assign({}, ident.FLEET_KEY_LABELS), { fleet: 'Fleet', item: 'Fleet work items' });
    assert.ok(Object.isFrozen(ident.FLEET_KEY_LABELS));
    assert.ok(ident.isFleetLabel('Fleet') && ident.isFleetLabel('Fleet work items'));
    assert.ok(!ident.isFleetLabel('Claude Code') && !ident.isFleetLabel('') && !ident.isFleetLabel(null) && !ident.isFleetLabel('fleet'));

    // ---------------------------------------------------------------- 1. ensureFleetKey on a real manager and database
    const dbDir = path.join(tmp, 'authdb');
    fs.mkdirSync(dbDir, { recursive: true });
    assert.strictEqual(await initializeApplicationAuthDatabase(dbDir), true);
    const manager = new ApplicationAuthManager({ authAuditLog: [] });
    const gr = {
        getApplicationAuthManager: () => manager,
        getMcpPathUuid: () => 'uuid-1234',
        getConfig: ({ path: p }) => (p === 'port' ? 9333 : null),
        getWebSocketServer: () => null
    };

    assert.strictEqual(ident.keyFile('fleet'), path.join(tmp, 'state', 'fleet-mcp', 'fleet.key'));
    assert.strictEqual(ident.keyFile('item'), path.join(tmp, 'state', 'fleet-mcp', 'fleet-items.key'));
    assert.throws(() => ident.keyFile('other'), /kind/);
    assert.strictEqual(ident.mcpUrl(gr), 'http://127.0.0.1:9333/uuid-1234/mcp');
    assert.strictEqual(ident.mcpUrl({ getMcpPathUuid: () => '', getConfig: () => null }), '');
    assert.strictEqual(ident.mcpUrl({ getMcpPathUuid: () => 'u', getConfig: () => null }), 'http://127.0.0.1:9220/u/mcp');
    assert.strictEqual(ident.mcpUrl({}), '');

    await assert.rejects(() => ident.ensureFleetKey({ getApplicationAuthManager: () => null }, 'fleet'), /manager/);
    await assert.rejects(() => ident.ensureFleetKey({}, 'fleet'), /manager/);
    await assert.rejects(() => ident.ensureFleetKey(gr, 'bogus'), /kind/);
    assert.ok(!fs.existsSync(ident.keyFile('fleet')), 'a failed ensure writes nothing');

    // a stray orphan of the same name and user agent (a Cleanup lost the file) is retired by the mint; another UA is not
    const orphan = await manager.createApplicationKey({ appName: 'Fleet', userAgent: ident.FLEET_KEY_UA, scopes: ['gallery'], userType: 'admin', expiresAt: null, refreshIntervalDays: 3650 });
    const handmade = await manager.createApplicationKey({ appName: 'Fleet', userAgent: 'Hand/1.0', scopes: ['gallery'], userType: 'admin', expiresAt: null, refreshIntervalDays: 3650 });

    const first = await ident.ensureFleetKey(gr, 'fleet');
    assert.deepStrictEqual(Object.keys(first).sort(), ['keyFile', 'kind', 'label']);
    assert.strictEqual(first.kind, 'fleet');
    assert.strictEqual(first.label, 'Fleet');
    assert.strictEqual(first.keyFile, ident.keyFile('fleet'));
    const rawFleet = fs.readFileSync(first.keyFile, 'utf8').trim();
    assert.ok(/^sf_app_|^[A-Za-z0-9_-]{20,}/.test(rawFleet), 'a key sits in the file');
    assert.ok(!JSON.stringify(first).includes(rawFleet), 'the raw key is never returned');
    assert.strictEqual(fs.statSync(first.keyFile).mode & 0o777, 0o600, 'key file is 0600');
    assert.strictEqual(fs.statSync(path.dirname(first.keyFile)).mode & 0o777, 0o700, 'key dir is 0700');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(first.keyFile)).filter((n) => n.endsWith('.tmp')), [], 'no temp file left');

    let fleetKeys = await activeKeys(manager, 'Fleet');
    assert.strictEqual(fleetKeys.length, 2, 'the new key and the hand-made one with another user agent');
    assert.ok(fleetKeys.some((k) => k.id === handmade.summary.id), 'a key with another user agent is left alone');
    assert.ok(!fleetKeys.some((k) => k.id === orphan.summary.id), 'the orphan with our user agent was retired');
    const mine = fleetKeys.find((k) => k.userAgent === ident.FLEET_KEY_UA);
    assert.deepStrictEqual(sortedCopy(mine.scopes), sortedCopy(scopes.FLEET_MCP_SCOPES), 'scopes equal FLEET_MCP_SCOPES');
    assert.ok(!mine.scopes.includes('universal'));
    assert.strictEqual(mine.userType, 'admin');
    await manager.revokeApplicationKey(handmade.summary.id);

    // the second call and parallel calls reuse the same key
    const second = await ident.ensureFleetKey(gr, 'fleet');
    assert.deepStrictEqual(second, first);
    assert.strictEqual(fs.readFileSync(first.keyFile, 'utf8').trim(), rawFleet, 'same secret in the file');
    const parallel = await Promise.all([ident.ensureFleetKey(gr, 'item'), ident.ensureFleetKey(gr, 'item'), ident.ensureFleetKey(gr, 'item')]);
    assert.ok(parallel.every((row) => row.keyFile === ident.keyFile('item') && row.kind === 'item' && row.label === 'Fleet work items'));
    const itemKeys = await activeKeys(manager, 'Fleet work items');
    assert.strictEqual(itemKeys.length, 1, 'parallel launches mint one key');
    assert.strictEqual((await activeKeys(manager, 'Fleet')).length, 1, 'one active key per label');
    assert.strictEqual(fs.statSync(ident.keyFile('item')).mode & 0o777, 0o600);
    const rawItem = fs.readFileSync(ident.keyFile('item'), 'utf8').trim();
    assert.notStrictEqual(rawItem, rawFleet, 'the two kinds have different keys');
    assert.deepStrictEqual(sortedCopy(itemKeys[0].scopes), sortedCopy(scopes.FLEET_MCP_SCOPES));

    // a key from before a scope existed is healed (same secret); a loose file mode is tightened
    const fleetId = (await activeKeys(manager, 'Fleet'))[0].id;
    const trimmed = scopes.FLEET_MCP_SCOPES.slice(0, 3);
    assert.strictEqual((await manager.updateApplicationKey(fleetId, { scopes: trimmed }, { source: 'test', actor: 'test' })).success, true);
    fs.chmodSync(first.keyFile, 0o644);
    await ident.ensureFleetKey(gr, 'fleet');
    const healed = (await activeKeys(manager, 'Fleet'))[0];
    assert.strictEqual(healed.id, fleetId, 'same row');
    assert.deepStrictEqual(sortedCopy(healed.scopes), sortedCopy(scopes.FLEET_MCP_SCOPES), 'scopes healed');
    assert.strictEqual(fs.readFileSync(first.keyFile, 'utf8').trim(), rawFleet, 'secret unchanged by the heal');
    assert.strictEqual(fs.statSync(first.keyFile).mode & 0o777, 0o600, 'file mode tightened');

    // the startup widen migrations never touch the Fleet keys
    const widenBefore = JSON.stringify(sortedCopy((await activeKeys(manager, 'Fleet'))[0].scopes));
    await scopes.widenDirectorApplicationKeys(manager);
    assert.strictEqual(JSON.stringify(sortedCopy((await activeKeys(manager, 'Fleet'))[0].scopes)), widenBefore);

    // a key file that holds some other key (Claude Code's) is not trusted: a Fleet key is minted
    const claudeKey = await manager.createApplicationKey({ appName: 'Claude Code', userAgent: 'claude-code/1.0', scopes: ['generation'], userType: 'admin', expiresAt: null, refreshIntervalDays: 3650 });
    fs.writeFileSync(first.keyFile, claudeKey.key, { mode: 0o600 });
    await ident.ensureFleetKey(gr, 'fleet');
    const afterSwap = fs.readFileSync(first.keyFile, 'utf8').trim();
    assert.notStrictEqual(afterSwap, claudeKey.key);
    assert.strictEqual((await activeKeys(manager, 'Fleet')).length, 1, 'the replaced Fleet key was retired as an orphan');
    assert.strictEqual((await activeKeys(manager, 'Claude Code')).length, 1, 'the Claude Code key is untouched');

    // a refresh-overdue key is refreshed (new secret in the file, the old row replaced, one active key)
    await getDb().run('UPDATE application_keys SET refresh_before_at = ? WHERE key_hash IS NOT NULL AND app_name = ? AND status = ?', [Math.floor(Date.now() / 1000) - 5, 'Fleet', 'active']);
    await ident.ensureFleetKey(gr, 'fleet');
    const afterRefresh = fs.readFileSync(first.keyFile, 'utf8').trim();
    assert.notStrictEqual(afterRefresh, afterSwap, 'refresh wrote the new secret');
    assert.strictEqual((await activeKeys(manager, 'Fleet')).length, 1);
    const stillValid = await manager.validateApplicationKey(afterRefresh, ident.FLEET_KEY_UA, { skipUserAgent: true });
    assert.strictEqual(stillValid.valid, true);

    // ---------------------------------------------------------------- 2. the real MCP auth path takes a Fleet key with Claude Code's UA
    const authGr = Object.assign({}, gr);
    const authMw = createMcpAuthMiddleware(authGr);
    const res = { setHeader() {}, on() {}, status() { return this; }, json() { return this; }, end() { return this; } };
    async function authenticate(rawKey, headers) {
        const req = {
            headers: Object.assign({ authorization: `Bearer ${rawKey}`, 'user-agent': UA }, headers || {}),
            query: {}, method: 'POST', url: '/uuid-1234/mcp', originalUrl: '/uuid-1234/mcp',
            socket: { remoteAddress: '127.0.0.1' }, connection: { remoteAddress: '127.0.0.1' }, ip: '127.0.0.1'
        };
        let nexted = false;
        await authMw(req, res, () => { nexted = true; });
        assert.ok(nexted, 'the MCP middleware let the Fleet key through');
        return req;
    }
    const fleetReq = await authenticate(afterRefresh, { 'x-fleet-session': SESSION_A });
    assert.strictEqual(fleetReq.applicationAuth.appName, 'Fleet');
    assert.strictEqual(fleetReq.applicationAuth.authMethod, 'application_key');
    assert.strictEqual(fleetReq.applicationAuth.userAgentBypassed, true, 'claude-code UA is not the key UA: let in by unknownUserAgentBypass');
    assert.deepStrictEqual(sortedCopy(fleetReq.applicationAuth.applicationScopes), sortedCopy(scopes.FLEET_MCP_SCOPES));
    const itemRaw = fs.readFileSync(ident.keyFile('item'), 'utf8').trim();
    const itemReq = await authenticate(itemRaw, { 'x-fleet-session': SESSION_B });
    assert.strictEqual(itemReq.applicationAuth.appName, 'Fleet work items');
    const claudeReq = await authenticate(claudeKey.key, { 'x-fleet-session': SESSION_A });
    assert.strictEqual(claudeReq.applicationAuth.appName, 'Claude Code');

    // ---------------------------------------------------------------- 3. fleetSessionOf / actorLabel / resolveBindKey
    const workRows = { [SESSION_B]: { id: 42, title: 'Make the notice say Fleet' } };
    const agentNames = { [SESSION_A]: 'Fix the notice', [SESSION_B]: 'planner b', [SESSION_C]: '' };
    const lookupCalls = { work: 0, agent: 0 };
    ident._setLookups({
        workForSession: (id) => { lookupCalls.work += 1; return workRows[id] || null; },
        agentName: (id) => { lookupCalls.agent += 1; return agentNames[id] || ''; }
    });

    assert.deepStrictEqual(ident.fleetSessionOf(fleetReq), { sessionId: SESSION_A, kind: 'fleet' });
    assert.deepStrictEqual(ident.fleetSessionOf(itemReq), { sessionId: SESSION_B, kind: 'item' });
    assert.strictEqual(ident.fleetSessionOf(claudeReq), null, 'a header on any other key is ignored');
    assert.strictEqual(ident.fleetSessionOf(reqWith('Fleet', {})), null);
    assert.strictEqual(ident.fleetSessionOf({}), null);
    assert.strictEqual(ident.fleetSessionOf(null), null);

    assert.strictEqual(ident.actorLabel(fleetReq), 'Fleet access "Fix the notice"');
    assert.strictEqual(ident.actorLabel(itemReq), 'Fleet access, work item #42 "Make the notice say Fleet"');
    assert.strictEqual(bridge.resolveActorLabel(fleetReq), 'Fleet access "Fix the notice"');
    assert.strictEqual(bridge.resolveActorName(fleetReq), 'Fleet', 'resolveActorName keeps the raw key name');
    assert.strictEqual(bridge.resolveActorName(itemReq), 'Fleet work items');
    assert.strictEqual(bridge.resolveActorLabel(claudeReq), 'Claude Code');
    assert.strictEqual(ident.actorLabel(claudeReq), 'Claude Code', 'Yukimi\'s own sessions keep Claude Code, header or not');

    assert.strictEqual(bridge.resolveBindKey(fleetReq), `appkey:${fleetReq.applicationAuth.applicationKeyId}:fleet:${SESSION_A}`);
    assert.strictEqual(bridge.resolveBindKey(itemReq), `appkey:${itemReq.applicationAuth.applicationKeyId}:fleet:${SESSION_B}`);
    assert.strictEqual(bridge.resolveBindKey(claudeReq), `appkey:${claudeReq.applicationAuth.applicationKeyId}`, 'other keys bind as before');
    assert.notStrictEqual(bridge.resolveBindKey(fleetReq), bridge.resolveBindKey(await authenticate(afterRefresh, { 'x-fleet-session': SESSION_C })), 'each Fleet session binds on its own');

    // no header, a bad header: generic label, plain key bind
    assert.strictEqual(ident.actorLabel(reqWith('Fleet', {})), 'Fleet access');
    assert.strictEqual(ident.actorLabel(reqWith('Fleet work items', {})), 'Fleet access, work item');
    ['', 'not-a-uuid', SESSION_A.toUpperCase(), `${SESSION_A}, ${SESSION_B}`, `${SESSION_A}x`, ` ${SESSION_A.slice(1)}`].forEach((bad) => {
        const req = reqWith('Fleet', { 'x-fleet-session': bad });
        assert.strictEqual(ident.actorLabel(req), 'Fleet access', `bad header "${bad}"`);
        assert.strictEqual(ident.fleetSessionOf(req), null);
        assert.strictEqual(bridge.resolveBindKey(req), 'appkey:kid-1');
    });
    assert.strictEqual(ident.actorLabel(reqWith('Fleet', { 'x-fleet-session': [SESSION_A] })), 'Fleet access', 'an array is not a header value');
    assert.strictEqual(ident.actorLabel(reqWith('Fleet work items', { 'x-fleet-session': 'zzz' })), 'Fleet access, work item');
    assert.strictEqual(ident.actorLabel(reqWith('Claude Code', { 'x-fleet-session': SESSION_A })), 'Claude Code');
    assert.strictEqual(bridge.resolveBindKey(reqWith('Claude Code', { 'x-fleet-session': SESSION_A })), 'appkey:kid-1');

    // no title anywhere: the first 8 characters of the session id; an item without a row still says work item
    assert.strictEqual(ident.actorLabel(reqWith('Fleet', { 'x-fleet-session': SESSION_C })), 'Fleet access "12345678"');
    assert.strictEqual(ident.actorLabel(reqWith('Fleet work items', { 'x-fleet-session': SESSION_A })), 'Fleet access, work item "Fix the notice"');
    assert.strictEqual(ident.actorLabel(reqWith('Fleet work items', { 'x-fleet-session': SESSION_C })), 'Fleet access, work item "12345678"');
    // a plain Fleet key on a session that has a work row still reads as plain Fleet access (the key decides the kind)
    assert.strictEqual(ident.actorLabel(reqWith('Fleet', { 'x-fleet-session': SESSION_B })), 'Fleet access "planner b"');

    // other keys: exactly resolveActorName
    [{ applicationAuth: { appName: 'Grok' } }, { applicationAuth: { appName: '  ' } }, {}, { applicationAuth: { applicationAppName: 'Z' } },
        { applicationAuth: { appName: ' Xi ' } }, undefined, null].forEach((req) => {
        assert.strictEqual(ident.actorLabel(req), bridge.resolveActorName(req), JSON.stringify(req));
        assert.strictEqual(bridge.resolveActorLabel(req), bridge.resolveActorName(req));
    });
    assert.strictEqual(ident.actorLabel({ get applicationAuth() { throw new Error('boom'); } }), null, 'never throws');

    // titles: quotes and control characters removed, 60-character clip
    workRows[SESSION_B] = { id: 7, title: 'He said "hi" and \u201cyo\u201d\nnow\u0007\tgo' };
    ident._setLookups({ workForSession: (id) => workRows[id] || null, agentName: (id) => agentNames[id] || '' });
    assert.strictEqual(ident.actorLabel(itemReq), 'Fleet access, work item #7 "He said hi and yo now go"');
    agentNames[SESSION_A] = 'x"y"';
    ident._setLookups({ workForSession: () => null, agentName: (id) => agentNames[id] || '' });
    assert.strictEqual(ident.actorLabel(fleetReq), 'Fleet access "xy"');
    agentNames[SESSION_A] = 'a'.repeat(100);
    ident._setLookups({ workForSession: () => null, agentName: (id) => agentNames[id] || '' });
    assert.strictEqual(ident.actorLabel(fleetReq), `Fleet access "${'a'.repeat(60)}"`);
    agentNames[SESSION_A] = '""';
    ident._setLookups({ workForSession: () => null, agentName: (id) => agentNames[id] || '' });
    assert.strictEqual(ident.actorLabel(fleetReq), 'Fleet access "0a1b2c3d"', 'a title that is only quotes falls back to the id');

    // lookups are cached 30 s per session (tools/call runs this on every call) and never throw
    let calls = 0;
    ident._setLookups({ workForSession: () => { calls += 1; throw new Error('db gone'); }, agentName: () => { calls += 1; throw new Error('db gone'); } });
    assert.strictEqual(ident.actorLabel(fleetReq), 'Fleet access "0a1b2c3d"', 'a failing lookup falls back, no throw');
    const callsAfterFirst = calls;
    ident.actorLabel(fleetReq); ident.actorLabel(fleetReq);
    assert.strictEqual(calls, callsAfterFirst, 'cached: no new lookups inside 30 s');
    const realNow = Date.now;
    try {
        Date.now = () => realNow() + 31 * 1000;
        ident.actorLabel(fleetReq);
        assert.ok(calls > callsAfterFirst, 'looked up again after 30 s');
    } finally {
        Date.now = realNow;
    }

    // sessionKind
    ident._setLookups({ workForSession: (id) => (id === SESSION_B ? { id: 1, title: 't' } : null), agentName: () => '' });
    assert.strictEqual(ident.sessionKind(SESSION_A), 'fleet');
    assert.strictEqual(ident.sessionKind(SESSION_A, 12), 'item');
    assert.strictEqual(ident.sessionKind(SESSION_A, '12'), 'item');
    assert.strictEqual(ident.sessionKind(SESSION_A, ''), 'fleet');
    assert.strictEqual(ident.sessionKind(SESSION_A, null), 'fleet');
    assert.strictEqual(ident.sessionKind(SESSION_B), 'item', 'a supervisor_work row names the session');
    assert.strictEqual(ident.sessionKind(), 'fleet');
    ident._setLookups({ workForSession: () => { throw new Error('x'); } });
    assert.strictEqual(ident.sessionKind(SESSION_A), 'fleet', 'never throws');
    assert.strictEqual(ident.sessionKind(SESSION_A, 3), 'item');

    // the real lookups (agent-coord store, supervisor_work) on a temp coord database
    ident._setLookups();
    const store = require('../modules/agentCoord/store');
    store.upsertAgent({ id: `claude-${SESSION_A.slice(0, 8)}`, kind: 'claude', name: 'Real coord title', sessionId: SESSION_A });
    assert.strictEqual(ident.sessionKind(SESSION_A), 'fleet', 'no supervisor_work table yet: plain Fleet, no throw');
    assert.strictEqual(ident.actorLabel(reqWith('Fleet', { 'x-fleet-session': SESSION_A })), 'Fleet access "Real coord title"');
    store.open().exec('CREATE TABLE supervisor_work (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, session_id TEXT, state TEXT)');
    store.open().prepare('INSERT INTO supervisor_work (id, title, session_id, state) VALUES (?, ?, ?, ?)').run(77, 'Real item title', SESSION_B, 'running');
    ident._setLookups();
    assert.strictEqual(ident.sessionKind(SESSION_B), 'item');
    assert.strictEqual(ident.sessionKind(SESSION_A), 'fleet');
    assert.strictEqual(ident.actorLabel(reqWith('Fleet work items', { 'x-fleet-session': SESSION_B })), 'Fleet access, work item #77 "Real item title"');

    // ---------------------------------------------------------------- 4. end to end: bind packets and the activity broadcast carry the label
    ident._setLookups({
        workForSession: (id) => (id === SESSION_B ? { id: 42, title: 'Make the notice say Fleet' } : null),
        agentName: (id) => ({ [SESSION_A]: 'Fix the notice', [SESSION_C]: 'Second agent' }[id] || '')
    });
    const sent = [];
    const broadcasts = [];
    const clients = new Map();
    const addClient = (id, ip) => clients.set({ readyState: WebSocket.OPEN, id }, { clientId: id, authenticated: true, userType: 'admin', connectedAt: Date.now(), lastActivity: Date.now(), ip, clientIP: ip, userAgent: 'test' });
    addClient('c1c1c1c1c1c1', '127.0.0.1');
    addClient('c2c2c2c2c2c2', '127.0.0.1');
    const wsServer = {
        clients,
        sendToClient: (ws, msg) => sent.push({ to: ws.id, type: msg.type, data: msg.data }),
        broadcast: (msg) => broadcasts.push(msg)
    };
    const e2eGr = Object.assign({}, gr, { getWebSocketServer: () => wsServer });

    // 4a. autoBindNearest, the way the REST routes and autoBindIfNeeded call it
    const onlyOne = new Map([...clients].slice(0, 1));
    wsServer.clients = onlyOne;
    let bind = bridge.autoBindNearest(e2eGr, bridge.resolveBindKey(fleetReq), bridge.resolveActorLabel(fleetReq), '127.0.0.1');
    assert.ok(bind.bound && bind.auto);
    const boundPacket = sent.find((p) => p.type === 'agent_session_bound');
    assert.ok(boundPacket, 'the bound client got agent_session_bound');
    assert.strictEqual(boundPacket.to, 'c1c1c1c1c1c1');
    assert.strictEqual(boundPacket.data.actorName, 'Fleet access "Fix the notice"');
    assert.strictEqual(bridge._test.boundActorName(bridge.resolveBindKey(fleetReq)), 'Fleet access "Fix the notice"');
    wsServer.clients = clients;

    // 4b. the REST route /agent/bind (display site) with a second Fleet session on the same key: its own bind, its own label
    const routes = {};
    bridge.registerRoutes({
        get: (p, ...h) => { routes[`GET ${p}`] = h[h.length - 1]; },
        post: (p, ...h) => { routes[`POST ${p}`] = h[h.length - 1]; },
        use: () => {}, delete: () => {}, put: () => {}
    }, { devAuthMiddleware: (q, s, n) => n(), globalResources: e2eGr });
    const secondReq = await authenticate(afterRefresh, { 'x-fleet-session': SESSION_C });
    secondReq.body = { clientId: 'c2c2c2c2c2c2' };
    let jsonBody = null;
    await routes['POST /agent/bind'](secondReq, { json: (b) => { jsonBody = b; return b; }, status() { return this; } });
    assert.ok(jsonBody && jsonBody.bound, 'REST bind worked');
    const restPacket = sent.filter((p) => p.type === 'agent_session_bound').pop();
    assert.strictEqual(restPacket.to, 'c2c2c2c2c2c2');
    assert.strictEqual(restPacket.data.actorName, 'Fleet access "Second agent"');
    assert.strictEqual(bridge.getBoundClientId(bridge.resolveBindKey(fleetReq)), 'c1c1c1c1c1c1', 'the first Fleet session kept its tab');
    assert.strictEqual(bridge.getBoundClientId(bridge.resolveBindKey(secondReq)), 'c2c2c2c2c2c2');

    // 4c. the facade's tools/call handler (bind_session) with the real authenticated request
    mcpActivity.resetActivityLog();
    sent.length = 0;
    const out = await facade.handleJsonRpc(e2eGr, itemReq, {
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bind_session', arguments: { clientId: 'c1c1c1c1c1c1' } }
    });
    assert.strictEqual(out.status, 200);
    assert.ok(!out.body.result.isError, JSON.stringify(out.body).slice(0, 300));
    const itemLabel = 'Fleet access, work item #42 "Make the notice say Fleet"';
    const bound = sent.find((p) => p.type === 'agent_session_bound');
    assert.ok(bound, 'bind_session notified the client');
    assert.strictEqual(bound.data.actorName, itemLabel, 'bind_session carries the display label');
    const activity = broadcasts.filter((m) => m.type === 'mcp_activity');
    assert.ok(activity.length >= 1, 'tools/call broadcast mcp_activity');
    assert.strictEqual(activity[activity.length - 1].data.actorName, itemLabel, 'the activity broadcast (Remote Access notice) carries the label');
    assert.strictEqual(activity[activity.length - 1].data.tool, 'bind_session');
    assert.strictEqual(mcpActivity.getRecent().pop().actorName, itemLabel);
    assert.strictEqual(bridge.getBoundClientId(bridge.resolveBindKey(itemReq)), 'c1c1c1c1c1c1');
    assert.notStrictEqual(bridge.resolveBindKey(itemReq), bridge.resolveBindKey(fleetReq));

    // 4d. a Claude Code key (Yukimi's own session) keeps its name everywhere
    broadcasts.length = 0;
    sent.length = 0;
    const claudeOut = await facade.handleJsonRpc(e2eGr, claudeReq, {
        jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bind_session', arguments: { clientId: 'c2c2c2c2c2c2' } }
    });
    assert.ok(!claudeOut.body.result.isError, JSON.stringify(claudeOut.body).slice(0, 300));
    assert.strictEqual(sent.find((p) => p.type === 'agent_session_bound').data.actorName, 'Claude Code');
    assert.strictEqual(broadcasts.filter((m) => m.type === 'mcp_activity').pop().data.actorName, 'Claude Code');

    // 4e. the tool list still uses the raw key name (tools/list appName is an identity decision), and a Fleet key can list tools
    const listed = await facade.handleJsonRpc(e2eGr, fleetReq, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    assert.ok(listed.body.result.tools.length > 0);
    const fleetTools = listed.body.result.tools.map((t) => t.name);
    const directorTools = facade.listToolsForScopes(scopes.DIRECTOR_MCP_SCOPES, null, { owner: null, appName: 'Xi' }).map((t) => t.name);
    assert.ok(directorTools.includes('clear_mailbox_notify_forward') && !fleetTools.includes('clear_mailbox_notify_forward'), 'no Dovecote mail tools on a Fleet key');
    assert.ok(fleetTools.includes('bind_session') && fleetTools.includes('generate_image'), 'the Studio tools are there');

    // 4e2. autoBindIfNeeded (a tool that auto-binds: get_client_physics) names the label too
    const SESSION_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const autoReq = await authenticate(afterRefresh, { 'x-fleet-session': SESSION_D });
    sent.length = 0;
    wsServer.clients = new Map([...clients].slice(1));
    const physics = await facade.handleJsonRpc(e2eGr, autoReq, {
        jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_client_physics', arguments: {} }
    });
    wsServer.clients = clients;
    assert.strictEqual(physics.status, 200);
    const autoBound = sent.find((p) => p.type === 'agent_session_bound');
    assert.ok(autoBound, 'the tool auto-bound a client');
    assert.strictEqual(autoBound.data.actorName, 'Fleet access "dddddddd"', 'autoBindIfNeeded passes the label');
    assert.strictEqual(bridge.getBoundClientId(bridge.resolveBindKey(autoReq)), 'c2c2c2c2c2c2');

    // 4f. PRIORITY_EXEMPT_ACTORS: a Fleet label is not exempt, exactly like the old "Claude Code" key; Director's keys are
    bridge.setPriorityClient(e2eGr, 'c1c1c1c1c1c1', true);
    const fleetLabel = bridge.resolveActorLabel(fleetReq);
    assert.throws(() => bridge.bindClient(e2eGr, { clientId: 'c2c2c2c2c2c2', bindKey: 'appkey:fleet-priority', actorName: fleetLabel }),
        (e) => e.status === 423 && e.code === 'PRIORITY_CLIENT', 'Fleet is not exempt from the priority client');
    assert.throws(() => bridge.bindClient(e2eGr, { clientId: 'c2c2c2c2c2c2', bindKey: 'appkey:cc-priority', actorName: 'Claude Code' }),
        (e) => e.status === 423, 'neither was Claude Code');
    assert.ok(bridge.bindClient(e2eGr, { clientId: 'c2c2c2c2c2c2', bindKey: 'appkey:xi-priority', actorName: 'Xi' }).bound, 'Xi still is');
    assert.ok(bridge.bindClient(e2eGr, { clientId: 'c2c2c2c2c2c2', bindKey: 'appkey:dd-priority', actorName: bridge.resolveActorLabel(reqWith('Dreamscape Director', {})) }).bound, 'Director key label is its raw name: exempt');
    bridge.setPriorityClient(e2eGr, 'c1c1c1c1c1c1', false);

    // ---------------------------------------------------------------- 5. wiring (the display and identity sites named in #1199)
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const bridgeSrc = read('modules/agentClientBridge.js');
    const facadeSrc = read('modules/mcpAgentFacade.js');
    const routeSection = bridgeSrc.slice(bridgeSrc.indexOf('function registerRoutes('));
    assert.ok(!routeSection.includes('resolveActorName(req)'), 'the REST routes pass the display label, not the raw name');
    assert.ok((routeSection.match(/resolveActorLabel\(req\)/g) || []).length >= 6);
    assert.ok(facadeSrc.includes('const actorName = resolveActorLabel(req);'), 'tools/call uses the label');
    assert.ok(/bindKey: resolveBindKey\(req\),\s*actorName: resolveActorLabel\(req\)/.test(facadeSrc), 'bind_session uses the label');
    assert.ok(/resolveBindKey\(req\),\s*resolveActorLabel\(req\),\s*requestClientIP\(req\)/.test(facadeSrc), 'autoBindIfNeeded uses the label');
    assert.ok(/const appName = resolveActorName\(req\);/.test(facadeSrc), 'tools/list keeps the raw name');
    assert.ok(/const name = resolveActorName\(req\);\s*const auth = req && req\.applicationAuth;/.test(facadeSrc), 'generationCaller keeps the raw name');
    ['modules/dovecoteIdentity.js', 'modules/plaudMcp.js', 'modules/claudeFleetMcp.js'].forEach((file) => {
        assert.ok(!read(file).includes('resolveActorLabel'), `${file} keeps the raw name`);
    });

    console.log('test-fleet-mcp-identity: ok');
}

main().then(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
}).catch((err) => {
    console.error(err);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
});
