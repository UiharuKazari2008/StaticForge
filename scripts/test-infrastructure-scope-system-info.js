// Jules GH #392: app keys with the infrastructure scope may send get_system_info; other scopes still may not.
'use strict';
const assert = require('assert');
const { scopesAllowPacket, getPacketScopes } = require('../modules/applicationAuthManager');

assert.ok(getPacketScopes('get_system_info').includes('infrastructure'), 'get_system_info maps to infrastructure');
assert.strictEqual(scopesAllowPacket(['infrastructure'], 'get_system_info'), true);
assert.strictEqual(scopesAllowPacket(['infrastructure'], 'server_status'), true, 'existing infrastructure packets unchanged');
assert.strictEqual(scopesAllowPacket([], 'get_system_info'), false, 'no scopes still denied');
const other = getPacketScopes('exchange_list_mailboxes');
if (other.length) assert.strictEqual(scopesAllowPacket(other, 'get_system_info'), other.includes('infrastructure'));
console.log('ok infrastructure scope allows get_system_info');
