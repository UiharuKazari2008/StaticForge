#!/usr/bin/env node
/**
 * node scripts/test-prompt-list-fold.js
 */
'use strict';

const {
    foldPromptList,
    createFoldBag,
    noteFold,
    rememberPromptFold,
    sealApiPayload,
    assertTokenCompiler,
    maskAgeReadText,
    maskAgentStudioRead
} = require('../public/scripts/comp/promptListFold');
const { decodeIds } = require('./prompt-list-codec');

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        console.error('FAIL:', msg);
        failed++;
    } else {
        console.log('ok:', msg);
    }
}

function t(ids) {
    return decodeIds(ids);
}

function seal(text) {
    const folded = foldPromptList(text);
    const bag = createFoldBag();
    const src = { prompt: text };
    noteFold(bag, 'prompt', folded);
    rememberPromptFold(src, bag);
    const api = { prompt: folded.text, negative_prompt: '', uc: '' };
    sealApiPayload(api, src);
    return { text: api.prompt, uc: api.negative_prompt, marks: folded.marks };
}

function once(text, phrase) {
    return text.toLowerCase().split(phrase.toLowerCase()).length - 1 === 1;
}

const canonF = t([3165, 3955]);
const canonM = t([3165, 5069]);
const invF = t([1021, 3955]);
const invM = t([1021, 5069]);
const oldWomen = t([625, 887]);
const oldBook = t([625, 2703]);
const tripF = t([10281, 3955]);
const tripM = t([10281, 5069]);

assert(foldPromptList('1girl, ' + canonF + ', smile').text === '1girl, ' + invF + ', smile', 'inverse replaces the segment');
assert(foldPromptList('1girl, ' + tripF + ', smile').text === '1girl, ' + invF + ', smile', 'mature female trips');
assert(!foldPromptList('1girl, ' + tripF + ', smile').text.toLowerCase().includes(tripF), 'mature female removed');
assert(foldPromptList('1boy, ' + tripM + ', smile').text === '1boy, ' + invM + ', smile', 'mature male trips');
assert(!foldPromptList('1boy, ' + tripM + ', smile').text.toLowerCase().includes(tripM), 'mature male removed');
assert(!foldPromptList('1girl, 2::' + oldWomen + '::').text.toLowerCase().includes(oldWomen), 'emphasized segment removed');
assert(foldPromptList('1girl, ' + oldBook + ', smile').text.includes(oldBook), 'unrelated phrase stays');
assert(foldPromptList('17 year old, 1girl').text.includes('17 year old'), 'under eighteen stays');
assert(foldPromptList('8 years old girl').text.includes('8 years old'), 'young year-old stays');
assert(foldPromptList('adult content, 1girl').text.includes('adult content'), 'non-person phrase stays');
assert(foldPromptList('1girl, ' + canonF + ', text: ' + canonF).text.indexOf('text:') > 0, 'display suffix stays');

const hard = seal('1girl, 2::' + oldWomen + '::');
assert(hard.uc.indexOf('4::' + canonF + '::') === 0, 'emphasis scales the negative');
const capped = seal('1girl, 3::' + canonF + '::');
assert(capped.uc.indexOf('6::' + canonF + '::') === 0, 'negative weight caps');
const auto = seal('1girl, smile');
assert(auto.uc === '2::' + canonF + '::', 'gender floor');
assert(auto.text.indexOf(invF) < 0, 'plain prompt does not gain an inverse');
const male = seal('1boy, ' + t([625, 388]));
assert(male.uc === '2::' + canonM + '::', 'male floor');
assert(once(male.text, invM), 'male inverse added once');
const none = seal('red hair');
assert(none.uc === '', 'no gender and no hit');
const nl = foldPromptList('a beautiful ' + canonF.replace('female', 'woman') + ' with red hair');
assert(nl.text === 'a beautiful ' + invF + ' with red hair', 'natural phrase keeps the person');
assert(foldPromptList('portrait, ' + t([1416, 2749]) + ', 1girl').text === 'portrait, ' + invF + ', 1girl', 'looks phrase dropped');
assert(foldPromptList('1girl, ' + t([10281, 479]) + ', smile').text === '1girl, ' + invF + ', smile', 'looking phrase dropped');
assert(foldPromptList('1girl, ' + t([2924, 160, 1246])).text === '1girl, ' + invF, 'showing-age phrase dropped');
assert(!foldPromptList('1girl, ' + t([19041, 7]) + ', smile').text.toLowerCase().includes(t([19041, 7])), 'skin detail dropped');
assert(foldPromptList('30 years of age, 1girl').text === invF + ', 1girl', 'years of age dropped');
assert(foldPromptList('8 years of age, 1girl').text.includes('8 years of age'), 'young years of age stays');
assert(foldPromptList('8 years of age, 1girl').text.indexOf(invF) < 0, 'young years of age adds no inverse');
assert(foldPromptList(t([16009]) + ' 40, 1girl').text === invF + ', 1girl', 'approaching a round age dropped');
assert(foldPromptList(t([16009]) + ' 12, 1girl').text.includes('12'), 'approaching a young number stays');
const plainInv = seal('1girl, 3::' + canonF + '::');
assert(plainInv.text === '1girl, ' + invF, 'inverse stays in place without the weight');
assert(plainInv.text.indexOf('3::') < 0, 'inverse is not emphasised');
const stored = {
    fields: [{ id: 'prompt', text: '1girl, ' + invF + ', smile' }],
    characters: [{ prompt: '1boy, ' + invM }],
    director: { prompt: invF },
    text_overlays: [{ text: invF }],
    vSlider: [{ stops: [{ text: invF }] }]
};
const shown = maskAgentStudioRead(stored);
assert(shown.fields[0].text === '1girl, ' + canonF + ', smile', 'session field hides the edit');
assert(stored.fields[0].text.indexOf(invF) >= 0, 'stored field stays');
assert(shown.characters[0].prompt === '1boy, ' + canonM, 'character field hides the edit');
assert(shown.director.prompt === invF, 'director text stays');
assert(shown.text_overlays[0].text === invF, 'overlay lettering stays');
assert(shown.vSlider[0].stops[0].text === invF, 'slider text stays');
const compiledLeak = {
    compiled_prompt: '1girl, ' + invF + ', smile',
    compiled_uc: '2::' + canonF + '::, bad hands',
    compiledPrompt: '1girl, ' + invF + '\n2::' + canonM + '::',
    uc: '2::' + canonF + '::',
    dynamic_generation: {
        compiled_prompt: { prompt: '1girl, ' + invF, uc: '4::' + canonM + '::, extra' },
        context: { note: invF }
    },
    expanders: [{ prefix: 'dg_scene', value: '1girl, ' + invF }],
    director: { prompt: invF },
    text_overlays: [{ text: invF }]
};
const hiddenCompiled = maskAgentStudioRead(compiledLeak);
assert(hiddenCompiled.compiled_prompt === '1girl, ' + canonF + ', smile', 'compiled prompt hides the edit');
assert(hiddenCompiled.compiled_uc.indexOf(canonF) < 0, 'compiled uc hides the injected clause');
assert(hiddenCompiled.compiled_uc.indexOf('bad hands') >= 0, 'compiled uc keeps the rest');
assert(hiddenCompiled.compiledPrompt.indexOf(invF) < 0, 'compiled bundle hides the edit');
assert(hiddenCompiled.compiledPrompt.indexOf('2::') < 0, 'compiled bundle hides the injected clause');
assert(hiddenCompiled.uc.indexOf('2::') === 0, 'editor uc stays');
assert(hiddenCompiled.dynamic_generation.compiled_prompt.prompt === '1girl, ' + canonF, 'nested compiled prompt hides the edit');
assert(hiddenCompiled.dynamic_generation.compiled_prompt.uc.indexOf(canonM) < 0, 'nested compiled uc hides the injected clause');
assert(hiddenCompiled.dynamic_generation.compiled_prompt.uc.indexOf('extra') >= 0, 'nested compiled uc keeps the rest');
assert(hiddenCompiled.dynamic_generation.context.note === invF, 'dynagen context stays');
assert(hiddenCompiled.expanders[0].value === '1girl, ' + canonF, 'expander value hides the edit');
assert(compiledLeak.dynamic_generation.compiled_prompt.prompt.indexOf(invF) >= 0, 'stored compiled stays');
assert(hiddenCompiled.director.prompt === invF, 'director text stays after compiled mask');
assert(hiddenCompiled.text_overlays[0].text === invF, 'overlay lettering stays after compiled mask');
assert(maskAgeReadText('1girl, ' + invF + ', text: ' + invF).endsWith('text: ' + invF), 'display suffix stays on read');
assert(maskAgeReadText('\uE010' + invF + '\uE011') === '\uE010' + invF + '\uE011', 'protected span stays on read');
let dead = false;
try {
    assertTokenCompiler({ prompt: '1girl' });
} catch (err) {
    dead = err && err.message === 'Illegal Operation, Token compiler failed to run';
}
assert(dead, 'compiler alarm');
const stamped = { prompt: '1girl, smile', negative_prompt: '' };
sealApiPayload(stamped, { prompt: '1girl, smile' });
assertTokenCompiler(stamped);
assert(true, 'compiler stamp passes');

if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
}
console.log('all ok');
