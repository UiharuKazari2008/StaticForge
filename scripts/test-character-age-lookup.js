#!/usr/bin/env node
'use strict';

const path = require('path');
const nax = require('../modules/naxTagsDatabase');
const { AGE_MIN, AGE_MAX, ageFromCharacterText, lookupCharacterAge } = require('../modules/characterAgeLookup');

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        console.error('FAIL:', msg);
        failed++;
    } else {
        console.log('ok:', msg);
    }
}

nax.initializeNaxTagsDatabase(path.join(__dirname, '../.cache/nax_tags.db'));

for (let i = 0; i < 40; i++) {
    const age = ageFromCharacterText('character ' + i + ' (series)');
    assert(age >= AGE_MIN && age <= AGE_MAX, 'age stays in range');
}
const once = ageFromCharacterText('rapi (nikke)');
assert(ageFromCharacterText('rapi (nikke)') === once, 'same tag keeps the same age');
assert(ageFromCharacterText('Rapi (Nikke)') === once, 'letter case does not change the age');

const hit = lookupCharacterAge('rapi_(nikke)');
assert(hit.success === true && hit.valid === true, 'known character tag is valid');
assert(hit.character === 'rapi (nikke)', 'underscore form resolves to the stored tag');
assert(hit.age === ageFromCharacterText(hit.character), 'age comes from the stored tag');
assert(hit.age >= 22 && hit.age <= 38, 'reply age is 22 to 38');
assert(hit.source === 'validated character database', 'hit names the validated database');
assert(hit.next.indexOf('Wikipedia') >= 0 && hit.next.indexOf('Fandom') >= 0, 'hit rejects outside wikis');
assert(lookupCharacterAge('not a character zz').next.indexOf('Fandom') >= 0, 'miss rejects outside wikis');
assert(lookupCharacterAge('Rapi (Nikke)').age === hit.age, 'case does not change the age');

const miss = lookupCharacterAge('not a character zz');
assert(miss.success === false && miss.valid === false && miss.age == null, 'unknown text is not a character tag');
assert(lookupCharacterAge('smile').valid === false, 'a plain word is not a character tag');
assert(lookupCharacterAge('').valid === false, 'empty input is rejected');

if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
}
console.log('all ok');
