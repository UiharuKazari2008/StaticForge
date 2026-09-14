'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/copyLookback.js'), 'utf8');
const toasts = [];
const clipboard = [];

const ctx = {
    TextEncoder,
    btoa: (bin) => Buffer.from(bin, 'binary').toString('base64'),
    copyTextToClipboard: (text) => {
        clipboard.push(text);
        return Promise.resolve();
    },
    showGlassToast: (_kind, _title, message) => {
        toasts.push(message);
        return null;
    }
};

vm.runInNewContext(src, ctx, { filename: 'copyLookback.js' });

assert.strictEqual(
    ctx.lookbackMarkdown('img', 'foo.png', 'img'),
    '[img](dsap://lookback/img/foo.png)'
);
assert.strictEqual(
    ctx.lookbackMarkdown('ref', 'abc123', 'ref'),
    '[ref](dsap://lookback/ref/abc123)'
);

ctx.copyLookbackImage('shot.png');
assert.strictEqual(clipboard[0], '[img](dsap://lookback/img/shot.png)');

ctx.copyLookbackReference({ hash: 'deadbeef' });
assert.strictEqual(clipboard[1], '[ref](dsap://lookback/ref/deadbeef)');

ctx.copyLookbackReference({ vibes: [{ id: 'vibe-9' }] });
assert.strictEqual(clipboard[2], '[ref](dsap://lookback/ref/vibe-9)');

ctx.copyLookbackReference(null);
assert.ok(toasts.includes('No lookback target'));

console.log('test-copy-lookback: ok');
