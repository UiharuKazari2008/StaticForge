const assert = require('assert');
const { createGenerationJobQueue } = require('../modules/generationJobQueue');

async function main() {
    const order = [];
    const queue = createGenerationJobQueue({ delayMinMs: 0, delayMaxMs: 0 });

    const first = queue.submit({
        type: 'generate_image',
        source: 'test',
        requestId: 'r1',
        run: async () => {
            order.push('a-start');
            await new Promise((resolve) => setTimeout(resolve, 30));
            order.push('a-end');
            return { success: true, flat: { filename: 'a.png' } };
        }
    });
    const second = queue.submit({
        type: 'generate_image',
        source: 'test',
        requestId: 'r2',
        run: async () => {
            order.push('b-start');
            return { success: true, flat: { filename: 'b.png' } };
        }
    });

    assert.ok(/^gjob_[0-9a-f]{16}$/.test(first.id));
    assert.strictEqual(first.position, 0);
    assert.ok(second.position >= 1);

    const a = await first.promise;
    const b = await second.promise;
    assert.deepStrictEqual(order, ['a-start', 'a-end', 'b-start']);
    assert.strictEqual(a.flat.filename, 'a.png');
    assert.strictEqual(b.flat.filename, 'b.png');
    assert.strictEqual(queue.get(first.id).status, 'completed');

    const delayed = createGenerationJobQueue({ delayMinMs: 40, delayMaxMs: 40 });
    const t0 = Date.now();
    await delayed.submit({
        run: async () => ({ success: true, flat: { filename: 'one.png' } })
    }).promise;
    await delayed.submit({
        run: async () => ({ success: true, flat: { filename: 'two.png' } })
    }).promise;
    assert.ok(Date.now() - t0 >= 40, 'second job must wait the inter-generation gap');

    const cancellable = createGenerationJobQueue({ delayMinMs: 0, delayMaxMs: 0 });
    let ran = false;
    const blocker = cancellable.submit({
        requestId: 'keep',
        run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return { success: true };
        }
    });
    const queued = cancellable.submit({
        requestId: 'drop-me',
        run: async () => {
            ran = true;
            return { success: true };
        }
    });
    const cancelledWait = assert.rejects(() => queued.promise, /cancelled/i);
    assert.strictEqual(cancellable.cancelByRequestId('drop-me'), 1);
    await blocker.promise;
    await cancelledWait;
    assert.strictEqual(ran, false);

    const waiter = createGenerationJobQueue({ delayMinMs: 0, delayMaxMs: 0 });
    const job = waiter.submit({
        run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
            return { success: true, flat: { filename: 'wait.png' } };
        }
    });
    const waited = await waiter.wait(job.id);
    assert.strictEqual(waited.flat.filename, 'wait.png');
    await assert.rejects(() => waiter.wait('missing'), /Unknown generation jobId/);

    console.log('test-generation-job-queue: ok');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
