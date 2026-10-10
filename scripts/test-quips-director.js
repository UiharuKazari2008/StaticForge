'use strict';

// Dynamic quips generation delivers through a hidden Director chat, not Grok.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const director = require('../modules/cursorDirector');

const t = director._test;
const expected = { terms: ['hatsune miku (vocaloid)', 'rain'], minPhrases: 2, maxPhrases: 3 };

const ok = t.normalizeQuipsAnswer({
    quips: [
        { term: 'Rain', phrases: ['The rain is doing the work for you.', 'Wet streets, one more take.'] },
        { term: 'hatsune miku (vocaloid)', phrases: ['I can feel you hitting generate again.', 'This stage is mine and I want another take.'] }
    ]
}, expected);
assert.strictEqual(ok.length, 2);
assert.strictEqual(ok[0].term, 'hatsune miku (vocaloid)');
assert.strictEqual(ok[0].phrases.length, 2);

assert.throws(() => t.normalizeQuipsAnswer({
    quips: [
        { term: 'hatsune miku (vocaloid)', phrases: ['She wears hatsune miku (vocaloid) again.', 'Another line that is fine.'] },
        { term: 'rain', phrases: ['Wet streets.', 'One more take.'] }
    ]
}, expected), /pastes the raw tag/);

assert.throws(() => t.normalizeQuipsAnswer({
    quips: [{ term: 'rain', phrases: ['Only one line here.', 'And a second.'] }]
}, expected), /Missing terms/);

assert.throws(() => t.normalizeQuipsAnswer({
    quips: [
        { term: 'rain', phrases: ['A', 'B'] },
        { term: 'nope', phrases: ['A', 'B'] }
    ]
}, { terms: ['rain'], minPhrases: 2, maxPhrases: 2 }), /Unknown term keys/);

const long = 'x'.repeat(t.QUIPS_PHRASE_MAX + 1);
assert.throws(() => t.normalizeQuipsAnswer({
    quips: [{ term: 'rain', phrases: [long, 'Short enough.'] }]
}, { terms: ['rain'], minPhrases: 2, maxPhrases: 2 }), /over 120/);

const prompt = t.quipsTurnPrompt(true, {
    chatId: 'dirc_test',
    workspaceName: 'Studio',
    minPhrases: 2,
    maxPhrases: 4,
    topics: '- rain (subject)'
});
assert.ok(prompt.includes('deliver_quips'));
assert.ok(prompt.includes('dirc_test'));
assert.ok(prompt.includes('Do not generate images'));
assert.ok(t.quipsRules(2, 4).includes('2 to 4'));
const tick = t.quipsTurnPrompt(false, { chatId: 'dirc_test', workspaceName: 'Studio', topics: '- rain' });
assert.ok(tick.includes('Same rules'));
assert.ok(!tick.includes('Do not generate images'));

assert.strictEqual(t.chatIsListed({ quips: true, cursorId: 'x', messages: [{ role: 'user' }] }), false);
assert.strictEqual(t.chatIsListed({ dynagen: true, cursorId: 'x' }), false);

t.quipsDeliveries.set('dirc_test', { quips: null, expected: { terms: ['rain'], minPhrases: 2, maxPhrases: 2 } });
const delivered = director.deliverQuips('dirc_test', {
    chatId: 'dirc_test',
    quips: [{ term: 'rain', phrases: ['Bring the storm back.', 'You already know the look.'] }]
});
assert.strictEqual(delivered.terms, 1);
assert.strictEqual(delivered.phrases, 2);
assert.strictEqual(t.quipsDeliveries.get('dirc_test').quips[0].term, 'rain');
t.quipsDeliveries.delete('dirc_test');
assert.throws(() => director.deliverQuips('missing', { quips: [] }), /No Quips turn/);

const root = path.join(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'modules/generationQuipsManager.js'), 'utf8');
assert.ok(manager.includes('runQuipsTurn'));
assert.equal(manager.includes('callXaiNativeForQuips'), false);
assert.equal(manager.includes('callGrokForQuips'), false);
assert.equal(manager.includes("require('zod')"), false);
assert.ok(manager.includes('Director: ${workspaceName}'));

const facade = fs.readFileSync(path.join(root, 'modules/mcpAgentFacade.js'), 'utf8');
assert.ok(facade.includes("name: 'deliver_quips'"));
assert.ok(facade.includes('deliverQuips'));

const limits = t.quipsTurnLimits();
assert.ok(limits.idleMs < limits.hardMs);
assert.ok(limits.hardMs < t.RUN_HARD_MS);

console.log('quips director ok');
