'use strict';

// finish_turn report (#704): server normalize / review fold (modules/cursorDirector.js)
// and the client helpers that draw and rescore the card (public/scripts/comp/director.js).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const director = require('../modules/cursorDirector');

const report = director.normalizeTurnReport({
    summary: 'Printed two seeds; the tail holds, the hands do not.',
    reportCard: {
        request: 'Fox girl, long tail, hands on hips',
        items: [
            { item: 'Long tail', score: 'hit', note: 'reaches the floor' },
            { item: 'Hands on hips', score: 'MISS' },
            { item: 'Fox ears', score: 'partly' },
            { item: '  ', score: 'hit' }
        ].slice(0, 3)
    },
    suggestions: ['Fix the hands', 'fix the hands', 'Try a side view', '', 'Go wider', 'Darker hair', 'One more']
});
assert.strictEqual(report.card.items.length, 3);
assert.deepStrictEqual(report.card.items.map((row) => row.score), ['hit', 'miss', 'partial']);
assert.strictEqual(report.card.request, 'Fox girl, long tail, hands on hips');
assert.deepStrictEqual(report.suggestions, ['Fix the hands', 'Try a side view', 'Go wider', 'Darker hair']);

assert.throws(() => director.normalizeTurnReport({ summary: '' }), /summary is required/);
assert.throws(() => director.normalizeTurnReport({ summary: 'x', reportCard: { items: [{ item: 'a', score: 'great' }] } }), /hit, partial, or miss/);
assert.throws(() => director.normalizeTurnReport({ summary: 'x', reportCard: { items: [{ item: '', score: 'hit' }] } }), /item is required/);
const bare = director.normalizeTurnReport({ summary: 'Saved the memory.' });
assert.strictEqual(bare.card, null);
assert.deepStrictEqual(bare.suggestions, []);

const text = director.turnReportText(report);
assert.ok(text.startsWith('Printed two seeds'));
assert.ok(text.includes('- miss: Hands on hips'));
assert.ok(text.includes('Suggested replies: Fix the hands | Try a side view'));

// Review: only changed items are listed, and the review is saved on the card.
const chat = { messages: [{ id: 'a1', role: 'assistant', data: { report: JSON.parse(JSON.stringify(report)) } }] };
const folded = director.applyReportReview(chat, { messageId: 'a1', scores: ['miss', 'miss', 'bogus'] });
assert.ok(folded.startsWith('Report card review: I rescored'));
assert.ok(folded.includes('- Long tail: miss (you scored hit)'));
assert.ok(!folded.includes('Hands on hips'));
assert.ok(folded.includes('The other 2 items I left as you scored them.'));
assert.deepStrictEqual(chat.messages[0].data.report.review.scores, ['miss', 'miss', 'partial']);
assert.strictEqual(chat.messages[0].data.report.review.changed, 1);
assert.ok(director.applyReportReview(chat, { messageId: 'a1', scores: ['hit', 'miss', 'partial'] }).includes('I agree with every score'));
assert.strictEqual(director.applyReportReview(chat, { messageId: 'nope', scores: [] }), '');
assert.strictEqual(director.applyReportReview(chat, null), '');

// Client helpers run in a vm on the same slice test-director-reply-options uses.
const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');
const start = src.indexOf('function directorMaskParens');
const end = src.indexOf('const DIRECTOR_QUICK_STARTS');
const sandbox = {};
vm.runInNewContext(src.slice(start, end), sandbox);

const clientReport = JSON.parse(JSON.stringify(report));
assert.deepStrictEqual([...sandbox.directorReportBaseline(clientReport)], ['hit', 'miss', 'partial']);
clientReport.review = { scores: ['partial', 'miss', 'partial'] };
assert.deepStrictEqual([...sandbox.directorReportBaseline(clientReport)], ['partial', 'miss', 'partial']);
// Same text the server folds in, so the optimistic bubble matches the saved one.
assert.strictEqual(
    sandbox.directorReportReviewText(report, ['miss', 'miss', 'bogus']),
    folded
);

const messages = [
    { id: 'u1', role: 'user', content: 'go' },
    { id: 'a1', role: 'assistant', data: { report } },
    { id: 'e1', role: 'event', message_type: 'chat-image' }
];
assert.strictEqual(sandbox.directorLastReport(messages).message.id, 'a1');
assert.strictEqual(sandbox.directorLastReport(messages.concat({ id: 'u2', role: 'user' })), null);
assert.strictEqual(sandbox.directorLastReport([{ id: 'a0', role: 'assistant', data: {} }]), null);

console.log('test-director-turn-report: ok');
