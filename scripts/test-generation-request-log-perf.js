// Regression guard for GH #383: cleanImageIds / cleanImageUrls dedupe with a Set.
// Loads the real module (no mocks, no file path so nothing is written to disk).
const assert = require('assert');
const { createGenerationRequestLog } = require('../modules/generationRequestLog');

const log = createGenerationRequestLog();
let n = 0;
const remember = (imageIds, imageUrls) => log.remember({ jobId: `t${++n}`, imageIds, imageUrls });

// 1. Duplicates collapse in first-seen order; unsafe names and non-http(s) URLs are dropped.
let rec = remember(
    ['img1.png', 'img2.png', 'img1.png', 'img3.png', 'img2.png', '../unsafe.png', 'a/b.png', { filename: 'img4.png' }, { filename: 'img1.png' }, null, ''],
    ['https://example.com/a', 'https://example.com/b', ' https://example.com/a ', 'http://test.com/c', 'ftp://bad', '', null]
);
assert.deepStrictEqual(rec.imageIds, ['img1.png', 'img2.png', 'img3.png', 'img4.png']);
assert.deepStrictEqual(rec.imageUrls, ['https://example.com/a', 'https://example.com/b', 'http://test.com/c']);

// 2. Dedupe is exact (case-sensitive) and URLs are compared after trimming.
rec = remember(['A.png', 'a.png', 'A.png'], ['HTTPS://E.com/x', 'https://e.com/x', '  HTTPS://E.com/x']);
assert.deepStrictEqual(rec.imageIds, ['A.png', 'a.png']);
assert.deepStrictEqual(rec.imageUrls, ['HTTPS://E.com/x', 'https://e.com/x']);

// 3. Non-array, null and empty inputs.
assert.deepStrictEqual(remember('one.png', 'https://e.com/one').imageIds, ['one.png']);
assert.deepStrictEqual(remember('one.png', 'https://e.com/one').imageUrls, ['https://e.com/one']);
assert.deepStrictEqual(remember(null, null).imageIds, []);
assert.deepStrictEqual(remember([], []).imageUrls, []);
assert.deepStrictEqual(remember('', '').imageIds, []);

// 4. URLs over 500 characters are dropped.
const long = 'https://' + 'x'.repeat(493); // 501 chars
rec = remember([], [long, long.slice(0, 500), long.slice(0, 500)]);
assert.deepStrictEqual(rec.imageUrls, [long.slice(0, 500)]);

// 5. Large input: 5,000 distinct names forwards, then the same names in reverse.
//    Dedupe runs before the 32 cap, so the result is exactly the first 32 first-seen names.
const ids = [];
for (let i = 0; i < 5000; i++) ids.push(`m${i}.png`);
for (let i = 4999; i >= 0; i--) ids.push(`m${i}.png`);
const urls = ids.map((x) => `https://e.com/${x}`);
const expectedIds = ids.slice(0, 32);
rec = remember(ids, urls);
assert.deepStrictEqual(rec.imageIds, expectedIds);
assert.deepStrictEqual(rec.imageUrls, expectedIds.map((x) => `https://e.com/${x}`));

// 6. 40 distinct names, each repeated: duplicates never use up the cap.
const repeated = [];
for (let i = 0; i < 40; i++) repeated.push(`r${i}.png`, `r${i}.png`, 'r0.png');
rec = remember(repeated, []);
assert.deepStrictEqual(rec.imageIds, Array.from({ length: 32 }, (_, i) => `r${i}.png`));

console.log('test-generation-request-log-perf: ok');
