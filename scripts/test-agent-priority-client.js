#!/usr/bin/env node
// Priority client (Yukimi, 2026-10-12): a tab registered for development is the only client
// agent REST / non-Director MCP calls bind to; other tabs are never touched; Director's own
// binds are exempt; a reloading priority tab keeps the claim (calls wait, no fallback).
// Run: node scripts/test-agent-priority-client.js
const assert = require('assert');
const WebSocket = require('ws');
const bridge = require('../modules/agentClientBridge');

const sent = [];
function makeClient(id, ip) {
    const ws = { readyState: WebSocket.OPEN, id };
    const info = { clientId: id, authenticated: true, userType: 'admin', connectedAt: Date.now(), lastActivity: Date.now(), ip, clientIP: ip, userAgent: 'test' };
    return [ws, info];
}
const clients = new Map([makeClient('aaaaaaaaaaaa', '192.168.100.8'), makeClient('bbbbbbbbbbbb', '127.0.0.1')]);
const wsServer = { clients, sendToClient: (ws, msg) => sent.push({ to: ws.id, type: msg.type, data: msg.data }) };
const gr = { getWebSocketServer: () => wsServer };
const working = 'aaaaaaaaaaaa';   // the tab Yukimi types in
const dev = 'bbbbbbbbbbbb';       // the tab registered for development

// 1. Without a priority client, an agent auto-binds as before (one of the two).
let r = bridge.autoBindNearest(gr, 'appkey:claude', 'Claude Code', '127.0.0.1');
assert.ok(r.bound && [working, dev].includes(r.clientId), 'normal auto-bind');

// 2. Registering moves the agent's bind onto the priority client and refuses the other tab.
bridge.setPriorityClient(gr, dev, true);
assert.deepStrictEqual(bridge.getPriorityClientState(gr).clientId, dev);
r = bridge.autoBindNearest(gr, 'appkey:claude', 'Claude Code', '192.168.100.8');
assert.strictEqual(r.clientId, dev, 'agent goes to the priority client even from the working tab IP');
assert.throws(() => bridge.bindClient(gr, { clientId: working, bindKey: 'appkey:claude', actorName: 'Claude Code' }),
    (e) => e.status === 423 && e.code === 'PRIORITY_CLIENT', 'explicit bind to another tab is refused');
assert.throws(() => bridge.bindClient(gr, { clientId: working, bindKey: 'appkey:cursor', actorName: 'Cursor' }),
    (e) => e.status === 423, 'a new agent key cannot take the working tab either');

// 3. Director's own binds are exempt (cursorDirector bindDirectorTab, Xi by name).
assert.ok(bridge.bindClient(gr, { clientId: working, bindKey: 'appkey:director', actorName: 'Dreamscape Director', priorityExempt: true }).bound);
r = bridge.autoBindNearest(gr, 'appkey:director', 'Dreamscape Director', '192.168.100.8');
assert.strictEqual(r.clientId, working, 'Director keeps the tab its chat runs in');
assert.ok(bridge.bindClient(gr, { clientId: working, bindKey: 'appkey:xi', actorName: 'Xi' }).bound, 'Xi is exempt by name');

// 4. The priority tab reloads: agent calls wait (no client), they never fall back to the working tab.
const devEntry = [...clients].find(([, info]) => info.clientId === dev);
clients.delete(devEntry[0]);
r = bridge.autoBindNearest(gr, 'appkey:claude', 'Claude Code', '192.168.100.8');
assert.strictEqual(r.bound, false);
assert.strictEqual(r.priorityClientOffline, true, 'offline priority client: no fallback');
assert.ok(bridge.getPriorityClientState(gr).active, 'the claim survives a reload (grace window)');
clients.set(devEntry[0], devEntry[1]);
bridge.setPriorityClient(gr, dev, true);
r = bridge.autoBindNearest(gr, 'appkey:claude', 'Claude Code', '127.0.0.1');
assert.strictEqual(r.clientId, dev, 'back on the priority client after it reconnects');

// 5. listClients marks it; releasing frees agents again.
const listed = bridge.listClients(gr, 'appkey:claude');
assert.ok(listed.find((c) => c.clientId === dev).priority, 'listed as priority');
bridge.setPriorityClient(gr, dev, false);
assert.strictEqual(bridge.getPriorityClientState(gr).active, false);
assert.ok(bridge.bindClient(gr, { clientId: working, bindKey: 'appkey:claude', actorName: 'Claude Code' }).bound, 'released: any client again');

// 6. Wiring: the WS packet, Director's exemption, the client UI.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
assert.ok(read('modules/ws/handlers/168-agentClientHandler.js').includes("reg('agent_priority_client'"), 'WS packet registered');
assert.ok(/bindKey: `appkey:\$\{validation\.applicationKeyId\}`,[\s\S]{0,200}priorityExempt: true/.test(read('modules/cursorDirector.js')), 'Director tab bind is exempt');
assert.ok(read('public/app.html').includes('id="remoteAccessPriorityClientBtn"'), 'Remote Access toggle');
assert.ok(read('public/scripts/comp/runCommandIndex.js').includes('Register this client for development'), 'Run: agent');
assert.ok(read('public/scripts/comp/agentClientBridge.js').includes("window.wsClient.on('connected', announcePriorityClient)"), 're-announced on reconnect');

console.log('test-agent-priority-client: ok');
