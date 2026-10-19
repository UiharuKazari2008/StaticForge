#!/usr/bin/env node
'use strict';

// Scripts that open the exchange DB (or globalResources) must close those
// handles and exit. Host CI timed out on test-mail-exchange* (Yozora #566).

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const exchangeSrc = fs.readFileSync(path.join(__dirname, 'test-mail-exchange.js'), 'utf8');
const r1Src = fs.readFileSync(path.join(__dirname, 'test-mail-exchange-r1.js'), 'utf8');
assert.match(exchangeSrc, /mailExchangeDatabase'\)\.close/);
assert.match(exchangeSrc, /process\.exit\(0\)/);
assert.match(exchangeSrc, /closeHandlesForTests/);
assert.match(r1Src, /mailExchangeDatabase'\)\.close/);
assert.match(r1Src, /process\.exit\(0\)/);

const dbSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/mailExchangeDatabase.js'), 'utf8');
assert.match(dbSrc, /function close\(/);
assert.match(dbSrc, /resetForTests\(databasesPath\) \{\n    close\(\);/);

const grSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/globalResources.js'), 'utf8');
assert.match(grSrc, /async closeHandlesForTests\(/);
assert.match(grSrc, /lruCleanupInterval\.unref/);
assert.match(grSrc, /systemInfoRefreshInterval\.unref/);

console.log('test-mail-exchange-handles: ok');
process.exit(0);
