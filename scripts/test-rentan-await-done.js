// Rentan: await_rentan_attempt must not return pending forever once the review is settled or the cap attempt was read.
const assert = require('assert');
const wren = require('../modules/dynagenWren');

(async () => {
    const review = wren.createRentanReview({ chatId: 'done-chat', max: 2, capWaitMs: 20, writePreview: async () => {}, log: () => {}, requestBody: { dynamic_generation: {} } });
    review.delivered = true;
    const first = await wren.submitRentanAttempt(review, { buffer: Buffer.from('a'), compiledPrompt: 'a' });
    first.consumed = true;
    const hold = wren.holdRentanPrint({ review, buffer: Buffer.from('b'), compiledPrompt: 'b' });
    while (review.attempts.length < 2) await new Promise((r) => setTimeout(r, 2));
    const cap = await wren.awaitRentanAttempt(review, 10);
    assert.strictEqual(cap.atCap, true);
    const again = await wren.awaitRentanAttempt(review, 10);
    assert.strictEqual(again.pending, false, 'cap attempt already read must not be pending');
    assert.strictEqual(again.done, true);
    const saved = await hold;
    assert.strictEqual(saved.action, 'save');
    assert.strictEqual(review.settled, true);
    const after = await wren.awaitRentanAttempt(review, 10);
    assert.strictEqual(after.done, true);
    assert.ok(/End your turn/.test(after.next));

    const ok = wren.createRentanReview({ chatId: 'ok-chat', max: 5, writePreview: async () => {}, log: () => {} });
    ok.delivered = true;
    await wren.submitRentanAttempt(ok, { buffer: Buffer.from('c'), compiledPrompt: 'c' });
    await wren.awaitRentanAttempt(ok, 10);
    wren.finishRentanReview(ok, { approved: true });
    const okAfter = await wren.awaitRentanAttempt(ok, 10);
    assert.strictEqual(okAfter.done, true);
    const fresh = wren.createRentanReview({ chatId: 'p', max: 5, log: () => {} });
    const pend = await wren.awaitRentanAttempt(fresh, 10);
    assert.strictEqual(pend.pending, true);
    console.log('test-rentan-await-done: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
