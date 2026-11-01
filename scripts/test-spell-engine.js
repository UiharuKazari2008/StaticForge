'use strict';

// Regression checks for the prompt spell checker (#689): node scripts/test-spell-engine.js
// Uses the real SCOWL lists and a small synthetic tag table (no database needed).

const assert = require('assert');
const { SpellEngine, tokenizePrompt } = require('../modules/spellEngine');

const engine = new SpellEngine();
engine.loadScowl();
engine.addTagVocabulary([
    { title: 'twintails', category: 0, count: 1037535 },
    { title: 'ahoge', category: 0, count: 788999 },
    { title: 'absurdres', category: 5, count: 900000 },
    { title: 'looking at viewer', category: 0, count: 5142421 },
    { title: 'blonde hair', category: 0, count: 1500000 },
    { title: 'large breasts', category: 0, count: 1800000 },
    { title: 'grabbing another%27s breast', category: 0, count: 880000 },
    { title: 'long sleeves', category: 0, count: 1200000 },
    { title: 'bokeh', category: 0, count: 60000 },
    { title: 'hatsune miku', category: 4, count: 166000 },
    { title: 'brest (azur lane)', category: 4, count: 180 },
    { title: 'wlop', category: 1, count: 5000 },
    { title: 'species:kitsune', category: 6, count: 900 }
]);

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`ok   ${name}`);
    } catch (error) {
        failures++;
        console.log(`FAIL ${name}: ${error.message}`);
    }
}

const unknownWords = (text) => engine.checkPrompt(text).filter((t) => !t.known).map((t) => t.word);

check('modern and British words are known', () => {
    for (const w of ['anime', 'manga', 'selfie', 'emoji', 'smartphone', 'colour', 'café', "don't", "girl's", 'silver-haired']) {
        assert.ok(engine.isKnown(w), w);
    }
});

check('tag words are known, artist names are not vocabulary', () => {
    for (const w of ['twintails', 'ahoge', 'absurdres', 'bokeh', 'miku', 'hatsune', 'kitsune']) assert.ok(engine.isKnown(w), w);
    assert.ok(!engine.isKnown('wlop'), 'artist name leaked into vocabulary');
});

check('obscure name word is flagged alone but passes as its whole tag', () => {
    assert.deepStrictEqual(unknownWords('brest'), ['brest']);
    assert.deepStrictEqual(unknownWords('1girl, brest (azur lane), smile'), []);
});

check('tokenizer skips artist:, expanders, replacements, 1girl tokens, URLs', () => {
    const words = tokenizePrompt('1girl, artist:wlop, artist:ke-ta, <hair_style>, !outfit~, dg_scene, https://x.com/a, 1.3::smile::, NSFW').map((t) => t.word);
    assert.deepStrictEqual(words, ['smile']);
});

check('typos rank the intended word first', () => {
    const cases = {
        beautful: 'beautiful', recieve: 'receive', teh: 'the', blnde: 'blonde', twintalis: 'twintails',
        ahoeg: 'ahoge', loking: 'looking', brest: 'breast', hiar: 'hair', gilr: 'girl', definately: 'definitely',
        seperate: 'separate', wierd: 'weird', backgorund: 'background', dont: "don't", blondehair: 'blonde hair',
        longsleeves: 'long sleeves'
    };
    for (const [typo, want] of Object.entries(cases)) {
        assert.ok(!engine.isKnown(typo), `${typo} should be unknown`);
        const got = engine.suggest(typo);
        assert.strictEqual(got[0], want, `${typo}: got ${JSON.stringify(got)}`);
    }
});

check('sound-alike spellings find the word (#693)', () => {
    const cases = {
        fone: 'phone', kute: 'cute', sizzors: 'scissors', nolij: 'knowledge', kwik: 'quick', skool: 'school',
        pepul: 'people', bewtiful: 'beautiful', eksplosion: 'explosion', jiraf: 'giraffe', choklit: 'chocolate',
        wisper: 'whisper', gost: 'ghost', sertain: 'certain', smyle: 'smile'
    };
    for (const [typed, want] of Object.entries(cases)) {
        const got = engine.suggest(typed);
        assert.strictEqual(got[0], want, `${typed}: got ${JSON.stringify(got)}`);
    }
    assert.notStrictEqual(engine.suggest('fone', 6, { soundAlike: false })[0], 'phone', 'soundAlike:false still matched by sound');
});

check('suggestions keep capitalisation', () => {
    assert.strictEqual(engine.suggest('Beautful')[0], 'Beautiful');
    assert.strictEqual(engine.suggest('LOKING')[0], 'LOOKING');
});

check('derived forms pass, look-alike typos do not', () => {
    for (const w of ['overexaggerated', 'disproportionately', 'unbuttoned', 'see-through']) assert.ok(engine.isKnown(w), w);
    for (const w of ['beautful', 'redish', 'shinely']) assert.ok(!engine.isKnown(w), w);
});

check('a suggestion lookup stays fast', () => {
    const words = ['photorealisticly', 'inconsistancy', 'reflectoins', 'translucant', 'iridesent', 'headphnoes'];
    const start = process.hrtime.bigint();
    for (const w of words) engine.suggest(w + 'x');
    const avg = Number(process.hrtime.bigint() - start) / 1e6 / words.length;
    assert.ok(avg < 25, `avg ${avg.toFixed(1)} ms`);
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
