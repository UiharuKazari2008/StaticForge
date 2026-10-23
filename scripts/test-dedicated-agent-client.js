#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const client = read('scripts/dedicated-agent-client.js');
const installer = read('scripts/install-dedicated-agent-client.sh');
const provisioner = read('scripts/provision-dedicated-agent-client-key.js');

assert.ok(client.includes("'.config', 'dreamscape-agent-client', 'app-key'"), 'dedicated key is read from a private user config file');
assert.ok(client.includes("headers: { 'X-StaticForge-App-Key': key }"), 'application key is sent in a request header');
assert.ok(client.includes("connection.send('Network.setExtraHTTPHeaders', { headers: {} })"), 'authentication header is cleared');
assert.ok(client.includes("'x-staticforge-app-key'"), 'app request removes the application key header');
assert.ok(!client.includes('?auth='), 'application key is never placed in a query string');
assert.ok(!client.includes('sfapp_') || client.includes("startsWith('sfapp_')"), 'no application key literal is embedded');
assert.ok(client.includes("'http://127.0.0.1:9220'"), 'Dreamscape connection is loopback-only by default');
assert.ok(client.includes("const CDP_HOST = '127.0.0.1'"), 'Chromium debugging is loopback-only');
assert.ok(client.includes("require('../modules/alchemyOwnedTab')"), 'supervisor shares Alchemy tab targeting');
assert.ok(client.includes('pickDreamscapeAgentTarget'), 'Dreamscape agent tab is preferred over the Alchemy-owned tab');
assert.ok(client.includes('ensureAlchemyOwnedTab'), 'supervisor opens the Alchemy-owned tab on the same profile');
assert.ok(client.includes('ALCHEMY_BLANK_URL'), 'Alchemy-owned tab uses the persistent marker URL');
assert.ok(client.includes("'--headless=new'"), 'dedicated client is headless');
assert.ok(client.includes("'--window-size=1920,1200'"), 'dedicated client has a stable test viewport');
assert.ok(client.includes("sessionStorage.setItem('dreamscape.priorityClient', '1')"), 'dedicated tab persists priority registration');
assert.ok(client.includes('setAgentPriorityClient(true)'), 'dedicated tab registers with the server');
assert.ok(client.includes("process.on('SIGTERM', shutdown)"), 'service termination closes only its Chromium child');
assert.ok(!client.includes('pm2'), 'client supervisor never controls Dreamscape');
assert.ok(!installer.includes('pm2'), 'installer never controls Dreamscape');
assert.ok(provisioner.includes("scopes: ['infrastructure']"), 'dedicated key receives only infrastructure scope');
assert.ok(provisioner.includes('persistent: true'), 'dedicated key does not require disruptive refreshes');
assert.ok(provisioner.includes("mode: 0o600"), 'dedicated key is written with private permissions');
assert.ok(installer.includes('provision-dedicated-agent-client-key.js'), 'installer provisions a dedicated credential');
assert.ok(installer.includes('systemctl --user enable dreamscape-agent-client.service'), 'installer enables only the dedicated client service');
assert.ok(installer.includes('systemctl --user restart dreamscape-agent-client.service'), 'installer applies changes only to the dedicated client service');
assert.ok(installer.includes('Restart=always'), 'systemd supervises the dedicated client');
assert.ok(installer.includes('NoNewPrivileges=true'), 'service applies process hardening');

console.log('test-dedicated-agent-client: ok');
