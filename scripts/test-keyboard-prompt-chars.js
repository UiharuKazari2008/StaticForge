#!/usr/bin/env node
/**
 * Smoke tests for public/scripts/comp/keyboardPromptChars.js
 * Run: node scripts/test-keyboard-prompt-chars.js
 */
'use strict';

const { normalizeKeyboardPromptChars } = require('../public/scripts/comp/keyboardPromptChars.js');

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        console.error('FAIL:', msg);
        failed++;
    } else {
        console.log('ok:', msg);
    }
}

assert(normalizeKeyboardPromptChars('blue\u2013eyes') === 'blue-eyes', 'en dash to hyphen');
assert(normalizeKeyboardPromptChars('a\u2014b') === 'a-b', 'em dash to hyphen');
assert(normalizeKeyboardPromptChars('2\u00D7') === '2x', 'multiplication sign to x');
assert(normalizeKeyboardPromptChars('2\u2715') === '2x', 'heavy multiplication to x');
assert(normalizeKeyboardPromptChars('\u201Cquote\u201D') === '"quote"', 'smart double quotes');
assert(normalizeKeyboardPromptChars('girl\u2019s') === "girl's", 'smart apostrophe');
assert(normalizeKeyboardPromptChars('wait\u2026') === 'wait...', 'ellipsis');
assert(normalizeKeyboardPromptChars('a\u00A0b') === 'a b', 'nbsp to space');
assert(normalizeKeyboardPromptChars('\uFF11\uFF47\uFF49\uFF52\uFF4C\uFF0C') === '1girl,', 'fullwidth ascii');
assert(normalizeKeyboardPromptChars('\uFB01re') === 'fire', 'fi ligature');
assert(normalizeKeyboardPromptChars('1\u22122') === '1-2', 'minus sign');

const zw = '\u2060\u2063\u200B\u200C';
assert(
    normalizeKeyboardPromptChars('a\u2013b' + zw + '\u00D7') === 'a-b' + zw + 'x',
    'managed emphasis invisibles stay'
);
assert(normalizeKeyboardPromptChars('\u5C11\u5973') === '\u5C11\u5973', 'cjk stays');
assert(normalizeKeyboardPromptChars('wave\u301C') === 'wave\u301C', 'wave dash stays');
assert(normalizeKeyboardPromptChars('star\u2605') === 'star\u2605', 'star stays');
assert(normalizeKeyboardPromptChars('\u2013\uD83D\uDE00') === '-\uD83D\uDE00', 'emoji surrogate stays');
assert(normalizeKeyboardPromptChars('1girl, solo') === '1girl, solo', 'ascii unchanged');
assert(normalizeKeyboardPromptChars('') === '', 'empty');
assert(normalizeKeyboardPromptChars(null) === null, 'null passthrough');

if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
}
console.log('all passed');
