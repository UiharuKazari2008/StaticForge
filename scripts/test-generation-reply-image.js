#!/usr/bin/env node
// generationReplyImage (#649): the base64 copy of a print stays in generation-family replies
// unless the request asked for imageTransport "http" (the web client), which drops it.
const assert = require('assert');
const { generationReplyImage } = require('../modules/ws/handlers/generationImpl');

const buf = Buffer.from('png-bytes');

assert.strictEqual(generationReplyImage({ type: 'generate_image' }, buf), buf.toString('base64'), 'default keeps the inline image');
assert.strictEqual(generationReplyImage({}, null), null, 'no buffer, no base64');
assert.strictEqual(generationReplyImage(null, buf), buf.toString('base64'), 'missing message keeps the inline image');
assert.strictEqual(generationReplyImage({ imageTransport: 'http' }, buf), null, 'http transport drops the image');
assert.strictEqual(generationReplyImage({ imageTransport: 'http' }, null, 'QUJD'), null, 'http transport drops a pre-encoded image too');
assert.strictEqual(generationReplyImage({ imageTransport: 'inline' }, null, 'QUJD'), 'QUJD', 'pre-encoded image passes through otherwise');
assert.strictEqual(generationReplyImage({ imageTransport: 'HTTP' }, buf), buf.toString('base64'), 'flag is exact-match');

console.log('test-generation-reply-image: ok');
