'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/studioChangeJson.js'), 'utf8');
const start = src.indexOf('function studioChangePromptWrite(');
const end = src.indexOf('function emptyStudioChangePayload(');
assert.ok(start > 0 && end > start, 'token limit helpers are in studioChangeJson.js');
const helpers = new Function(`${src.slice(start, end)}; return { studioChangeOverTokenLimit, studioChangeTokenLimitRestore };`)();
const { studioChangeOverTokenLimit, studioChangeTokenLimitRestore } = helpers;

const over = {
    limit: 512,
    prompt: { total: 600, overLimit: true, overRecommended: true },
    uc: { total: 40, overLimit: false, overRecommended: false }
};

const promptFail = studioChangeOverTokenLimit({ prompt: 'a very long prompt' }, over);
assert.strictEqual(promptFail.code, 'TOKEN_LIMIT');
assert.ok(promptFail.error.includes('600/512'));
assert.deepStrictEqual(promptFail.sides, ['prompt']);

const paramsOk = studioChangeOverTokenLimit({ params: { steps: 28 } }, over);
assert.strictEqual(paramsOk, null);

const softOk = studioChangeOverTokenLimit({ prompt: 'still fine' }, {
    limit: 512,
    prompt: { total: 400, overLimit: false, overRecommended: true },
    uc: { total: 10, overLimit: false }
});
assert.strictEqual(softOk, null);

const ucFail = studioChangeOverTokenLimit({ uc: 'too much' }, {
    limit: 256,
    prompt: { total: 10, overLimit: false },
    uc: { total: 300, overLimit: true }
});
assert.strictEqual(ucFail.code, 'TOKEN_LIMIT');
assert.ok(ucFail.error.startsWith('UC is over'));

const restore = studioChangeTokenLimitRestore({
    fields: [
        { id: 'prompt', action: 'replace', chunks: [{ name: 'Prompt', text: 'short' }] },
        { id: 'uc', action: 'replace', chunks: [{ name: 'UC', text: 'keep' }] },
        { id: 'seed', action: 'set' }
    ],
    characters: [{ index: 0, prompt: 'girl' }],
    expanders: [{ prefix: 'hair', value: 'long hair' }]
}, promptFail.written);
assert.deepStrictEqual(restore.fields.map((field) => field.id), ['prompt']);
assert.strictEqual(restore.characters, undefined);
assert.strictEqual(restore.expanders, undefined);

const charFail = studioChangeOverTokenLimit({
    characters: [{ index: 0, action: 'replace', prompt: 'huge' }]
}, over);
const charRestore = studioChangeTokenLimitRestore({
    characters: [{ index: 0, prompt: 'girl' }],
    expanders: []
}, charFail.written);
assert.strictEqual(charRestore.overwrite, true);
assert.strictEqual(charRestore.characters.length, 1);
assert.deepStrictEqual(charRestore.expanders, undefined);

const facade = fs.readFileSync(path.join(__dirname, '../modules/mcpAgentFacade.js'), 'utf8');
assert.ok(facade.includes("data.code === 'TOKEN_LIMIT'"), 'apply_studio_changes fails the tool on TOKEN_LIMIT');
const instructions = fs.readFileSync(path.join(__dirname, '../modules/mcpInstructions.js'), 'utf8');
assert.ok(instructions.includes('over the hard token limit fails'), 'agents are told the apply fails');

console.log('test-studio-token-limit: ok');
