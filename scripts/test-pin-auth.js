#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { hashPin, verifyPin, isHashed, isPinConfigured } = require('../modules/pinAuth');

const plain = '24681357';
const hash = hashPin(plain);

assert.ok(isHashed(hash), 'hashPin produces scrypt prefix');
assert.ok(isPinConfigured(hash), 'configured hash');
assert.ok(!isPinConfigured(''), 'empty not configured');

assert.strictEqual(verifyPin(plain, hash), true, 'scrypt verify ok');
assert.strictEqual(verifyPin('wrong', hash), false, 'scrypt verify reject');
assert.strictEqual(verifyPin(plain, plain), true, 'legacy plaintext ok');
assert.strictEqual(verifyPin('nope', plain), false, 'legacy plaintext reject');
assert.strictEqual(verifyPin(plain, ''), false, 'missing stored');

console.log('test-pin-auth: ok');
