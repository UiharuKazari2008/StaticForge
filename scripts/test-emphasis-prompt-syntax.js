#!/usr/bin/env node
/**
 * Smoke tests for modules/emphasisPromptSyntax.js
 * Run: node scripts/test-emphasis-prompt-syntax.js
 */
'use strict';

const m = require('../modules/emphasisPromptSyntax.js');

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        console.error('FAIL:', msg);
        failed++;
    } else {
        console.log('ok:', msg);
    }
}

// Digits must keep the space before closing "::" (years / bare numbers are not closers).
assert(
    m.normalizeEmphasisPromptSyntax('1.2::red hair 2025 ::') === '1.2::red hair 2025 ::',
    'keep space: year before close at EOS'
);
assert(
    m.normalizeEmphasisPromptSyntax('1.2::red hair 2025 :: 1.5::blue::') === '1.2::red hair 2025 :: 1.5::blue::',
    'keep space: year before next weight group'
);
assert(
    m.normalizeEmphasisPromptSyntax('1.2::red hair 2025 ::, blue') === '1.2::red hair 2025 ::, blue',
    'keep space: year before comma close'
);

// Word closers still glue (intended NovelAI style).
assert(
    m.normalizeEmphasisPromptSyntax('1.2::kicking ::') === '1.2::kicking::',
    'glue word before close'
);
assert(
    m.normalizeEmphasisPromptSyntax('kicking :: 1.1::x') === 'kicking:: 1.1::x',
    'glue word before next group'
);

// Letter-glued digit runs before "::" get a separating space (not parsed as weight).
assert(
    m.normalizeEmphasisPromptSyntax('magion02::tag::') === 'magion02 ::tag::',
    'insert space for letter-glued digits before ::'
);

// Agora sample: closed expand must keep space before :: when body ends in a year.
{
    const idSyn = require('../modules/emphasisGroupIdSyntax.js');
    assert(
        idSyn.formatClassicClosedEmphasisGroup('3', 'year 2025') === '3::year 2025 ::',
        'closed expand year keeps space before ::'
    );
    assert(
        idSyn.formatClassicClosedEmphasisGroup('3', 'pool') === '3::pool::',
        'closed expand word has no extra space'
    );
    const g = idSyn.buildManagedEmphasisGroupText(1, 'year 2025');
    const prepared = idSyn.prepareEmphasisTextForNovelAI(
        g,
        { groupsById: { 1: 3 } },
        null
    );
    assert(prepared.text === '3::year 2025 ::', `prepare year: ${JSON.stringify(prepared.text)}`);
}

if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
}
console.log('\nAll emphasis prompt syntax smoke tests passed.');
