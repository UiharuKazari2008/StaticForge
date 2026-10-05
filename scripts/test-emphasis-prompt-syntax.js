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

// Inner spacing is valid and kept, incl. a space before the closing "::" (Yukimi 2026-10-05).
assert(m.normalizeEmphasisPromptSyntax('1.2::kicking ::') === '1.2::kicking ::', 'keep space before close');
assert(m.normalizeEmphasisPromptSyntax('1.5:: cat ::') === '1.5:: cat ::', 'keep inner spacing both sides');
assert(m.normalizeEmphasisPromptSyntax('kicking :: 1.1::x') === 'kicking :: 1.1::x', 'keep space before close, next group');
assert(m.normalizeEmphasisPromptSyntax('{ cat }, [ dog ]') === '{ cat }, [ dog ]', 'keep inner spacing in {} and []');
// Only syntax-breaking spaces go: weight → opening "::", and split delimiters.
assert(m.normalizeEmphasisPromptSyntax('1.5 ::cat::') === '1.5::cat::', 'weight space before opener removed');
assert(m.normalizeEmphasisPromptSyntax('1.5 :: cat ::') === '1.5:: cat ::', 'opener fixed, inner spacing kept');
assert(m.normalizeEmphasisPromptSyntax('-1 :: cat ::') === '-1:: cat ::', 'negative weight opener fixed');
assert(m.normalizeEmphasisPromptSyntax('1.5: :cat::') === '1.5::cat::', 'split opener joined');
assert(m.normalizeEmphasisPromptSyntax('1.5::cat: :') === '1.5::cat::', 'split closer joined');
assert(m.normalizeEmphasisPromptSyntax('1.5 : : cat : :') === '1.5:: cat ::', 'split + weight space, inner kept');
assert(m.normalizeEmphasisPromptSyntax('1.5::cat:: 2 ::dog ::') === '1.5::cat:: 2::dog ::', 'second group opener fixed');
assert(m.normalizeEmphasisPromptSyntax('a::b:::c') === 'a::b:::c', 'triple colon untouched');
assert(m.normalizeEmphasisPromptSyntax('cat , ::') === 'cat ::', 'comma removed, inner space kept');

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

// Server and client copies stay in lockstep
{
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/emphasisParse.js'), 'utf8');
    // top-level functions end at the first column-0 "}" line
    const pick = (name) => {
        const s = src.indexOf(`\nfunction ${name}(`) + 1;
        return src.slice(s, src.indexOf('\n}\n', s) + 2);
    };
    const names = ['isValidEmphasisWeightBeforeDelimiter', 'needsSpaceBeforeDoubleColon', 'fixEmphasisDigitBeforeDoubleColon',
        'fixEmphasisSplitDelimiters', 'fixEmphasisWeightOpenerSpacing', 'fixEmphasisGroupCommaViolations', 'normalizeEmphasisPromptSyntax'];
    const ctx = {};
    vm.runInNewContext('const EMPHASIS_WEIGHT_BEFORE_DELIMITER = /^-?(?:0(?:\\.\\d+)?|[1-9]\\d*(?:\\.\\d+)?|\\.\\d+)$/;\n'
        + names.map(pick).join('\n') + '\nthis.n = normalizeEmphasisPromptSyntax;', ctx);
    const samples = ['1.5:: cat ::', '1.5 ::cat::', '-1 :: cat ::', '1.5: :cat::', '1.2::red hair 2025 ::',
        'kicking :: 1.1::x', 'magion02::tag::', 'cat , ::', '{ cat }', '1.5 : : cat : :'];
    for (const s of samples) {
        const a = m.normalizeEmphasisPromptSyntax(s, { fixCommas: true });
        const b = ctx.n(s, { fixCommas: true });
        assert(a === b, `client mirror matches server: ${JSON.stringify(s)} → ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
    }
}

// Client blur trim (emphasisGroupIdCodec.trimClassicEmphasisInnerEdges): keep spaces, clean commas only
{
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/emphasisGroupIdCodec.js'), 'utf8');
    const pick = (name) => {
        const s = src.indexOf(`\nfunction ${name}(`) + 1;
        assert(s > 0, `codec has ${name}`);
        return src.slice(s, src.indexOf('\n}\n', s) + 2);
    };
    const ctx = {};
    vm.runInNewContext(['formatClassicClosedEmphasisGroup', 'hasAdjacentCommaAt', 'trimClassicEmphasisInnerEdges']
        .map(pick).join('\n') + '\nthis.trim = trimClassicEmphasisInnerEdges;', ctx);
    const cases = [
        ['1.5:: cat ::', '1.5:: cat ::', 'blur keeps inner spacing'],
        ['1.2::alpha ::1.3::beta::', '1.2::alpha ::1.3::beta::', 'blur keeps space before close'],
        ['1.5::cat,::', '1.5::cat::, ', 'blur moves trailing comma outside'],
        ['1.5:: cat ,::', '1.5:: cat ::, ', 'blur moves comma, keeps spaces'],
        ['1.5::, cat::', '1.5:: cat::', 'blur drops leading comma, keeps the space'],
        ['3::year 2025::', '3::year 2025::', 'no comma: untouched']
    ];
    for (const [input, want, label] of cases) {
        const got = ctx.trim(input);
        assert(got === want, `${label}: ${JSON.stringify(input)} → ${JSON.stringify(got)}`);
    }
}

if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
}
console.log('\nAll emphasis prompt syntax smoke tests passed.');
