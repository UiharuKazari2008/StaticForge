const assert = require('assert');
const {
    isDefaultCharacterPromptName,
    resolveCharacterPromptApiName,
    mapAllCharacterPromptsToApi
} = require('../modules/characterPromptApiFormat');

function char({
    prompt = '1girl, standing',
    uc = 'lowres',
    enabled = true,
    chara_name,
    name,
    center = { x: 0.5, y: 0.5 }
} = {}) {
    const entry = { prompt, uc, enabled, center };
    if (chara_name !== undefined) entry.chara_name = chara_name;
    if (name !== undefined) entry.name = name;
    return entry;
}

function captionsFromApi(characterPrompts) {
    return characterPrompts.map((ch) => ({
        char_caption: ch.prompt,
        centers: [ch.center]
    }));
}

assert.strictEqual(isDefaultCharacterPromptName('Character 1'), true);
assert.strictEqual(isDefaultCharacterPromptName('  character 2  '), true);
assert.strictEqual(isDefaultCharacterPromptName('Alice'), false);
assert.strictEqual(isDefaultCharacterPromptName(''), true);
assert.strictEqual(isDefaultCharacterPromptName('   '), true);

assert.strictEqual(resolveCharacterPromptApiName(char({ chara_name: 'Alice' })), 'Alice');
assert.strictEqual(resolveCharacterPromptApiName(char({ chara_name: 'Character 1' })), undefined);
assert.strictEqual(resolveCharacterPromptApiName(char({ chara_name: '   ' })), undefined);
assert.strictEqual(resolveCharacterPromptApiName(char({ name: 'Bob' })), 'Bob');

const renamedInput = [char({ prompt: 'alice, red hair', chara_name: 'Alice' })];
const renamedBefore = {
    prompt: 'alice, red hair',
    uc: 'lowres',
    center: { x: 0.5, y: 0.5 },
    enabled: true
};
const renamed = mapAllCharacterPromptsToApi(renamedInput);
assert.deepStrictEqual(renamed.characterPrompts, [{
    ...renamedBefore,
    name: 'Alice'
}]);
assert.ok(!renamed.characterPrompts[0].prompt.includes('Alice'));
assert.deepStrictEqual(captionsFromApi(renamed.characterPrompts), [{
    char_caption: 'alice, red hair',
    centers: [{ x: 0.5, y: 0.5 }]
}]);
assert.ok(!('name' in captionsFromApi(renamed.characterPrompts)[0]));

const defaulted = mapAllCharacterPromptsToApi([
    char({ prompt: 'bob, blue hair', chara_name: 'Character 2' })
]);
assert.strictEqual(defaulted.characterPrompts.length, 1);
assert.ok(!('name' in defaulted.characterPrompts[0]));
assert.strictEqual(defaulted.characterPrompts[0].prompt, 'bob, blue hair');

const blank = mapAllCharacterPromptsToApi([
    char({ prompt: 'carol, green hair', chara_name: '   ' })
]);
assert.ok(!('name' in blank.characterPrompts[0]));

const mixed = mapAllCharacterPromptsToApi([
    char({ prompt: '1girl, alice', uc: 'lowres', chara_name: 'Alice', enabled: true }),
    char({ prompt: '1boy, skip me', uc: 'lowres', chara_name: 'ShouldNotAppear', enabled: false }),
    char({ prompt: '1girl, default slot', uc: 'lowres', chara_name: 'Character 3', enabled: true }),
    char({ prompt: '1girl, blank slot', uc: 'lowres', chara_name: '', enabled: true })
]);
assert.strictEqual(mixed.characterPrompts.length, 3);
assert.strictEqual(mixed.characterPrompts[0].name, 'Alice');
assert.ok(!('name' in mixed.characterPrompts[1]));
assert.ok(!('name' in mixed.characterPrompts[2]));
assert.strictEqual(mixed.characterPrompts[0].prompt, 'girl, alice');
assert.strictEqual(mixed.characterPrompts[1].prompt, 'girl, default slot');
assert.ok(!mixed.characterPrompts.some((ch) => (ch.prompt || '').includes('ShouldNotAppear')));
assert.ok(!mixed.characterPrompts.some((ch) => ch.name === 'ShouldNotAppear'));

const mixedCaptions = captionsFromApi(mixed.characterPrompts);
assert.strictEqual(mixedCaptions.length, mixed.characterPrompts.length);
assert.strictEqual(mixedCaptions[0].char_caption, mixed.characterPrompts[0].prompt);
assert.strictEqual(mixedCaptions[1].char_caption, mixed.characterPrompts[1].prompt);
assert.ok(!('name' in mixedCaptions[0]));
assert.ok(!('name' in mixedCaptions[1]));

console.log('test-character-prompt-api-name: ok');
console.log('renamed before:', JSON.stringify(renamedBefore));
console.log('renamed after:', JSON.stringify(renamed.characterPrompts[0]));
console.log('mixed characterPrompts:', JSON.stringify(mixed.characterPrompts));
