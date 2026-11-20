#!/usr/bin/env node
'use strict';
// Glancewell Fix (modules/glancewellFix.js, Yozora #446): a fixed print keeps the original's PNG text chunks.
const assert = require('assert');
const sharp = require('sharp');
const { textChunks, withTextChunks } = require('../modules/glancewellFix');

function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
(async () => {
    const plain = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#f00' } }).png().toBuffer();
    // an "original" with a prompt in tEXt after IHDR
    const ihdrEnd = 8 + 12 + plain.readUInt32BE(8);
    const text = chunk('tEXt', Buffer.from('Comment\0{"prompt":"1girl"}', 'latin1'));
    const original = Buffer.concat([plain.subarray(0, ihdrEnd), text, plain.subarray(ihdrEnd)]);
    assert.strictEqual(textChunks(original).length, 1);
    const fixed = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00f' } }).png().toBuffer();
    const out = withTextChunks(fixed, textChunks(original));
    assert.strictEqual(textChunks(out).length, 1);
    assert.ok(textChunks(out)[0].equals(text));
    const meta = await sharp(out).metadata();
    assert.strictEqual(meta.width, 2);
    assert.ok(out.includes(Buffer.from('1girl')));
    // a fixed picture's own text chunks are replaced, not doubled
    const twice = withTextChunks(out, textChunks(original));
    assert.strictEqual(textChunks(twice).length, 1);
    console.log('glancewell fix: ok');
})().catch((e) => { console.error(e); process.exit(1); });
