'use strict';
// Cellar cards (Oct 6): text_overlays display text skips the keyboard fold;
// stray zero-width chars are stripped from every compiled prompt path.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const {
    normalizeKeyboardPromptChars,
    normalizeKeyboardPromptCharsOutsideDisplayText: foldOutside,
    protectKeyboardDisplayText: protect,
    KEYBOARD_DISPLAY_TEXT_OPEN: OPEN,
    KEYBOARD_DISPLAY_TEXT_CLOSE: CLOSE
} = require('../public/scripts/comp/keyboardPromptChars');
const { compileTextOverlayAppend } = require('../modules/promptTextBoundary');
const {
    stripUnmanagedEmphasisInvisibles,
    buildManagedEmphasisGroupText,
    hasManagedEmphasisGroupIds
} = require('../modules/emphasisGroupIdSyntax');

const noMarkers = (s) => assert.ok(!/[\uE010\uE011]/.test(s), `marker leaked: ${JSON.stringify(s)}`);
const DISPLAY = 'Wait\u2014what\u2026 \u201Cno\u201D';

// (a) display text stays as typed; prompt text still folds
const prompt = `1girl, smile \u2014 blush\uFF0C solo, Text: ${protect(DISPLAY)}`;
const out = foldOutside(prompt);
assert.strictEqual(out, `1girl, smile - blush, solo, Text: ${DISPLAY}`);
noMarkers(out);
assert.strictEqual(foldOutside('a \u2014 b'), normalizeKeyboardPromptChars('a \u2014 b'));
// unmatched / stray markers never leak and fall back to folding
noMarkers(foldOutside(`x ${OPEN}y\u2014`)); assert.strictEqual(foldOutside(`x ${OPEN}y\u2014`), 'x y-');
noMarkers(foldOutside(`x ${CLOSE}y`));
assert.strictEqual(protect(''), '');
assert.strictEqual(protect(`a${OPEN}b`), `${OPEN}ab${CLOSE}`);

// overlay append → fold: each line exact, tags/emphasis unchanged, length heuristic unchanged
const overlays = [{ text: DISPLAY, type: 'speech' }, { text: 'Hi\u2026', type: 'caption' }];
const tags = { speech: { tags: 'english text, speech bubble' }, caption: { tags: 'english text, caption' } };
const bias = (t, w) => `${w}::${t}::`;
const plain = compileTextOverlayAppend(overlays, tags, bias);
const wrapped = compileTextOverlayAppend(overlays, tags, bias, protect);
assert.ok(wrapped.includes(protect(DISPLAY)) && wrapped.includes(protect('Hi\u2026')));
assert.strictEqual(wrapped.replace(/[\uE010\uE011]/g, ''), plain, 'wrapping must not change tags or emphasis');
const compiled = foldOutside(`city street\uFF01${wrapped}`);
assert.ok(compiled.startsWith('city street!'));
assert.ok(compiled.endsWith(`Text: ${DISPLAY}\n\nHi\u2026`), compiled);
noMarkers(compiled);

// (b) zero-width chars around weight colons (Guren's Studio artist line)
const ZW = ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u2060'];
const dirty = `artist:foo, 1.2\u200B::\u2060artist:bar\u200D::\uFEFF, 0.8\u200C::baz\u2060::`;
const clean = stripUnmanagedEmphasisInvisibles(dirty);
assert.strictEqual(clean, 'artist:foo, 1.2::artist:bar::, 0.8::baz::');
ZW.forEach((z) => assert.ok(!clean.includes(z), `U+${z.charCodeAt(0).toString(16)} survived`));
// managed Weight Rack groups keep their delimiters (handled by prepareEmphasisTextForNovelAI)
const managed = buildManagedEmphasisGroupText ? buildManagedEmphasisGroupText(3, 'cat') : null;
if (typeof managed === 'string') {
    assert.ok(hasManagedEmphasisGroupIds(managed));
    assert.ok(hasManagedEmphasisGroupIds(stripUnmanagedEmphasisInvisibles(`${managed}\u200D`)));
}

// wiring: every buildOptions path (MCP generate_image, Studio WS, presets, Change JSON → Studio)
// funnels through sanitizeAndNormalizeText; NAX has its own cleaner.
const gen = fs.readFileSync(path.join(root, 'modules/imageGeneration.js'), 'utf8');
const sanStart = gen.indexOf('const sanitizeAndNormalizeText =');
const san = gen.slice(sanStart, gen.indexOf('\n        };', sanStart));
assert.ok(sanStart > 0 && san.includes('normalizeKeyboardPromptCharsOutsideDisplayText(text)'));
assert.ok(/else if \(typeof out === 'string'\) \{[\s\S]*?stripUnmanagedEmphasisInvisibles\(out\)/.test(san));
assert.ok(san.indexOf('stripUnmanagedEmphasisInvisibles(out)') < san.indexOf('normalizeEmphasisPromptSyntax('),
    'ZW must go before emphasis syntax normalize');
assert.ok(!/normalizeKeyboardPromptChars\(text\)/.test(san), 'raw fold must not be used in sanitize');
assert.ok(/compileTextOverlayAppend\(\s*group, textTags, applyBiasToText,\s*require\('..\/public\/scripts\/comp\/keyboardPromptChars'\)\.protectKeyboardDisplayText/.test(gen));
assert.ok(/baseOptions\.prompt = sanitizeAndNormalizeText\(baseOptions\.prompt/.test(gen));
assert.ok(/prompt: sanitizeAndNormalizeText\(char\.prompt/.test(gen));
const nax = fs.readFileSync(path.join(root, 'modules/naxTagGeneration.js'), 'utf8');
assert.strictEqual((nax.match(/(?:prompt|negative_prompt|uc): cleanNaxPromptText\(/g) || []).length, 4);
assert.ok(!/(?:prompt|negative_prompt|uc): normalizeKeyboardPromptChars\(/.test(nax));
assert.ok(/stripUnmanagedEmphasisInvisibles\(normalizeKeyboardPromptChars\(text\)\)/.test(nax));

console.log('\u2705 test-prompt-display-text-zero-width.js passed');
