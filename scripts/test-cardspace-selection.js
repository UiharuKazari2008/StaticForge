#!/usr/bin/env node
'use strict';
// CardSpace selection state (no DOM): the tray's Service keys link leaves a pending group that
// survives renders before its rows exist and lands on the group's first card.
const assert = require('assert');
const cs = require('../public/scripts/comp/cplAuthentication.js');
const pick = cs._test.resolveSelection;
const svc = [{ key: 'secCursorAccountsTableBody:Wren', kind: 'director' }, { key: 'secKeychainTableBody:NovelAI', kind: 'service' }, { key: 'secKeychainTableBody:OpenAI', kind: 'service' }];

// render before the driver's first load: nothing to pick, the group stays pending
assert.deepStrictEqual(pick(null, 'service', []), { sel: null, pending: 'service', picked: false });
// only other groups loaded so far: still pending
assert.deepStrictEqual(pick(null, 'service', svc.slice(0, 1)), { sel: null, pending: 'service', picked: false });
// Service keys rows arrive: first card of the group, pending cleared
assert.deepStrictEqual(pick(null, 'service', svc), { sel: 'secKeychainTableBody:NovelAI', pending: null, picked: true });
// a later rebuild (balance update, status dots) keeps the selection
assert.deepStrictEqual(pick('secKeychainTableBody:NovelAI', null, svc), { sel: 'secKeychainTableBody:NovelAI', pending: null, picked: false });
// a pending group beats a stale selection from before the link
assert.strictEqual(pick('secCursorAccountsTableBody:Wren', 'service', svc).sel, 'secKeychainTableBody:NovelAI');
// a user's own pick with nothing pending is kept as is
assert.strictEqual(pick('secKeychainTableBody:OpenAI', null, svc).sel, 'secKeychainTableBody:OpenAI');
console.log('test-cardspace-selection: ok');
