const assert = require('assert');
const { createGenerationRequestLog } = require('../modules/generationRequestLog');

function runTest() {
    const logStore = createGenerationRequestLog();

    // 1. Correctness & Deduplication Test
    const inputIds = ['img1.png', 'img2.png', 'img1.png', 'img3.png', 'img2.png', '../unsafe.png', 'img4.png'];
    const inputUrls = ['https://example.com/a', 'https://example.com/b', 'https://example.com/a', 'http://test.com/c', 'ftp://bad'];

    const rec = logStore.remember({
        jobId: 'test_job_1',
        imageIds: inputIds,
        imageUrls: inputUrls
    });

    assert.deepStrictEqual(rec.imageIds, ['img1.png', 'img2.png', 'img3.png', 'img4.png']);
    assert.deepStrictEqual(rec.imageUrls, ['https://example.com/a', 'https://example.com/b', 'http://test.com/c']);

    // 2. Performance Verification Test
    const largeList = [];
    for (let i = 0; i < 500; i++) {
        largeList.push(`image_${i % 50}.png`);
    }

    const startTime = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) {
        logStore.remember({
            jobId: `test_job_perf_${i}`,
            imageIds: largeList
        });
    }
    const endTime = process.hrtime.bigint();
    const elapsedMs = Number(endTime - startTime) / 1e6;

    console.log(`✅ Regression test passed! 1000 deduplications over 500 items completed in ${elapsedMs.toFixed(2)} ms.`);
}

runTest();
