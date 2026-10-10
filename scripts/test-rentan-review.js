'use strict';

// #351: Wren reviews each Rentan attempt before it is saved. Cap is 5.
// The approved (or picked) attempt is the only one kept, and the only wren_change.

const assert = require('assert');
const wren = require('../modules/dynagenWren');

function scene(n) {
    return {
        expanders: [{ prefix: 'dg_weather', value: `rain ${n}`, reason: 'sky' }],
        summary: `scene ${n}`,
        applied: { weather: `rain ${n}` },
        characters: [],
        prompt: `1girl, scene ${n}`
    };
}

assert.strictEqual(wren.RENTAN_MAX_ATTEMPTS, 5);
assert.strictEqual(wren.rentanReviewStatus(2, 5), 'Wren is reviewing attempt 2/5');

const studio = { dynamic_generation: { enabled: true } };
assert.strictEqual(wren.rentanReviewApplies(studio), true);
assert.strictEqual(wren.rentanReviewApplies({ dynamic_generation: { enabled: true }, source: 'agent' }), false);
assert.strictEqual(wren.rentanReviewApplies({
    dynamic_generation: { enabled: true, compiled_prompt: { source: 'agent' } }
}), false);
assert.strictEqual(wren.rentanReviewApplies({ dynamic_generation: { enabled: true }, mcp_generated: true }), false);
assert.strictEqual(wren.rentanReviewApplies({ dynamic_generation: { enabled: true }, pipeline: [{}] }), false);
assert.strictEqual(wren.rentanReviewApplies({
    dynamic_generation: { enabled: true },
    pipeline: [{}],
    skip_pipeline_stages: true
}), true);
assert.strictEqual(wren.rentanReviewApplies({ dynamic_generation: { enabled: true }, no_save: true }), false);
assert.strictEqual(wren.rentanReviewApplies({ dynamic_generation: { enabled: true }, compile_only: true }), false);
assert.strictEqual(wren.rentanReviewApplies({ dynamic_generation: { enabled: true }, stageIndex: 1 }), false);
studio.dynamic_generation._rentanReviewDone = true;
assert.strictEqual(wren.rentanReviewApplies(studio), false, 'later copies reuse the approved change');

function review(extra) {
    const logs = [];
    const written = [];
    const created = wren.createRentanReview({
        chatId: 'rentan-chat',
        max: 5,
        waitMs: 30,
        capWaitMs: 40,
        writePreview: async (info) => { written.push(info.relativePath); },
        log: (message) => logs.push(message),
        requestBody: {
            prompt: 'old',
            uc: '',
            text_replacements: [],
            allCharacterPrompts: [],
            dynamic_generation: { enabled: true },
            _dynagenContext: {}
        },
        ...extra
    });
    return { review: created, logs, written };
}

async function untilAttempt(review, n) {
    for (let i = 0; i < 40; i++) {
        if (review.current && review.current.n === n && !review.current.consumed) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`attempt ${n} did not arrive`);
}

async function main() {
    const { review: open, written, logs } = review();
    const first = wren.noteRentanDelivery(open, scene(1));
    assert.strictEqual(first.first, true);
    assert.strictEqual(first.rebuild, false);
    const refined = wren.noteRentanDelivery(open, scene(1));
    assert.strictEqual(refined.rebuild, false, 'a second deliver before any print updates the scene');

    const pending = await wren.awaitRentanAttempt(open, 20);
    assert.strictEqual(pending.pending, true);

    const previews = [];
    const holding = wren.holdRentanPrint({
        review: open,
        buffer: Buffer.from('png-1'),
        compiledPrompt: '1girl, rain',
        snapshot: { prompt: '1girl, rain', seed: 11 },
        imageData: 'aaa',
        onPreview: (info) => previews.push(info)
    });
    await untilAttempt(open, 1);
    const got = await wren.awaitRentanAttempt(open, 50);
    assert.strictEqual(got.pending, false);
    assert.strictEqual(got.attempt, 1);
    assert.strictEqual(got.max, 5);
    assert.strictEqual(got.path, '/home/director/rentan/1.webp');
    assert.strictEqual(got.compiledPrompt, '1girl, rain');
    assert.deepStrictEqual(written, ['rentan/1.webp']);
    assert.strictEqual(previews[0].status, 'Wren is reviewing attempt 1/5');
    assert.strictEqual(previews[0].imageData, 'aaa');

    wren.noteRentanDelivery(open, scene(2));
    const rebuilt = await holding;
    assert.strictEqual(rebuilt.action, 'rebuild');
    assert.strictEqual(rebuilt.change.prompt, '1girl, scene 2');
    assert.strictEqual(open.requestBody.dynamic_generation._rentanReviewDone, undefined);

    const holding2 = wren.holdRentanPrint({
        review: open,
        buffer: Buffer.from('png-2'),
        compiledPrompt: '1girl, night',
        snapshot: { prompt: '1girl, night', seed: 22, dynamic_generation: { enabled: true } }
    });
    await untilAttempt(open, 2);
    const got2 = await wren.awaitRentanAttempt(open, 50);
    assert.strictEqual(got2.attempt, 2);
    assert.throws(() => wren.finishRentanReview(open, { pick: 1 }), /pick is only available/);
    const approved = wren.finishRentanReview(open, { approved: true });
    assert.strictEqual(approved.attempt, 2);
    const saved = await holding2;
    assert.strictEqual(saved.action, 'save');
    assert.strictEqual(saved.approved, true);
    assert.strictEqual(saved.attempt.buffer.toString(), 'png-2');
    assert.strictEqual(saved.attempt.snapshot.seed, 22);
    assert.strictEqual(open.requestBody.dynamic_generation._rentanReviewDone, true);

    const sent = [];
    wren.emitApprovedRentanChange({
        sendToClient: (_ws, message) => sent.push(message)
    }, {}, open, saved.attempt.change);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].phase, 'wren_change');
    assert.ok(sent[0].data.change.prompt.includes('1girl, scene 2'));
    assert.ok(sent[0].data.change.prompt.includes('!dg_weather'));
    assert.ok(Array.isArray(sent[0].data.change.expanders));

    const capLogs = [];
    const cap = wren.createRentanReview({
        chatId: 'cap-chat',
        max: 5,
        capWaitMs: 30,
        writePreview: async () => {},
        log: (message) => capLogs.push(message),
        requestBody: { dynamic_generation: { enabled: true }, prompt: '', text_replacements: [], _dynagenContext: {} }
    });
    cap.delivered = true;
    for (let n = 1; n <= 4; n++) {
        const attempt = await wren.submitRentanAttempt(cap, {
            buffer: Buffer.from(`buf-${n}`),
            compiledPrompt: `prompt-${n}`,
            snapshot: { seed: n }
        });
        attempt.consumed = true;
        cap.change = scene(n);
    }
    const lastHold = wren.holdRentanPrint({
        review: cap,
        buffer: Buffer.from('buf-5'),
        compiledPrompt: 'prompt-5',
        snapshot: { seed: 5 }
    });
    await untilAttempt(cap, 5);
    const atCap = await wren.awaitRentanAttempt(cap, 50);
    assert.strictEqual(atCap.atCap, true);
    assert.strictEqual(atCap.attempt, 5);
    const picked = wren.finishRentanReview(cap, { pick: 2 });
    assert.strictEqual(picked.pick, 2);
    const chosen = await lastHold;
    assert.strictEqual(chosen.action, 'save');
    assert.strictEqual(chosen.attempt.n, 2);
    assert.strictEqual(chosen.attempt.buffer.toString(), 'buf-2');

    const forcedLogs = [];
    const forced = wren.createRentanReview({
        chatId: 'forced-chat',
        max: 5,
        capWaitMs: 25,
        writePreview: async () => {},
        log: (message) => forcedLogs.push(message),
        requestBody: { dynamic_generation: {} }
    });
    forced.delivered = true;
    for (let n = 1; n <= 4; n++) {
        const attempt = await wren.submitRentanAttempt(forced, {
            buffer: Buffer.from(`x-${n}`),
            compiledPrompt: 'c',
            snapshot: { seed: n }
        });
        attempt.consumed = true;
    }
    const forcedSave = await wren.holdRentanPrint({
        review: forced,
        buffer: Buffer.from('x-5'),
        compiledPrompt: 'last',
        snapshot: { seed: 5 }
    });
    assert.strictEqual(forcedSave.forced, true);
    assert.strictEqual(forcedSave.attempt.n, 5);
    assert.ok(forcedLogs.some((line) => line.includes('Saving attempt 5')));
    assert.strictEqual(logs.length, 0);

    console.log('test-rentan-review: ok');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
