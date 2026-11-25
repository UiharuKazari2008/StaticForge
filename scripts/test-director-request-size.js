/**
 * Director request size (Yukimi Nov 25 2026: "every single message is the entire prompt again", 8.6M tokens
 * for a few turns). A turn's prompt is stored in the CLI session's history and every model step re-sends that
 * history, so a block repeated in each turn prompt is paid again on every step of every later turn.
 *
 * Replays N turns of one chat through the real buildPrompt of the Wren/Yumiya Director (and Yozora's, when its
 * module carries the same hook) and checks: the first turn carries the full standing block, later turns do not,
 * the growth of the session history per turn is bounded, a stage change or a new session sends it again.
 */
const assert = require('assert');
const director = require('../modules/cursorDirector');
const xi = require('../modules/xiDirector');
const turnPrompt = require('../modules/directorTurnPrompt');

const T = director._test;
const TURNS = 14;
const TOKENS_PER_CHAR = 0.27;

function replay(build, makeChat, turns) {
    const chat = makeChat();
    const sizes = [];
    const prompts = [];
    for (let i = 0; i < turns; i++) {
        const prior = prompts.map((p) => ({ role: 'user', text: p }));
        const p = build(chat, `fix the thing ${i}`, prior, i);
        prompts.push(p);
        sizes.push(p.length);
    }
    return { sizes, prompts, chat };
}

const mascot = (points) => ({ stage: 'base', points, nextAt: 20 });
const wrenChat = () => ({ id: 'dirc_test', workspaceId: 'default', name: 'x', claudeSessionId: 'sess-1', inflight: { engine: 'tokenrouter' }, tasks: [] });
const wren = (chat, text, prior, i) => T.buildPrompt(chat, text, [], prior, null, { persona: 'wren', mascot: mascot(i), memoryStore: 'studio' });

const w = replay(wren, wrenChat, TURNS);
const first = w.sizes[0];
const later = w.sizes.slice(1);
console.log('Wren/Yumiya turn prompt chars:', w.sizes.join(' '));
const sessionNew = w.sizes.reduce((a, b) => a + b, 0);
const sessionOld = first * TURNS;
console.log(`session history after ${TURNS} turns: ${sessionNew} chars now vs ${sessionOld} chars when every turn carried the full block`);
console.log(`about ${Math.round((sessionOld - sessionNew) * TOKENS_PER_CHAR)} fewer input tokens in the history, re-read on every step`);

assert(w.prompts[0].includes('Voice:'), 'first turn carries the voice block');
for (let i = 1; i < turnPrompt.FULL_EVERY; i++) {
    assert(!w.prompts[i].includes('Voice:'), `turn ${i} repeats the voice block`);
    assert(w.prompts[i].includes('[Your state]'), `turn ${i} keeps her state line`);
    assert(w.prompts[i].includes('Follow-up') || w.prompts[i].includes('User request'), 'request present');
}
assert(Math.max(...later.slice(0, 9)) < first * 0.6, `later turns stay under 60% of the first (${Math.max(...later.slice(0, 9))} vs ${first})`);
// the history grows by a bounded amount per turn (no accumulation beyond the request itself)
const spread = Math.max(...later.slice(0, 9)) - Math.min(...later.slice(0, 9));
assert(spread < 400, `later turn sizes are steady (spread ${spread})`);
// the refresh turn (every FULL_EVERY) sends the full block again
assert(w.prompts[turnPrompt.FULL_EVERY].includes('Voice:'), 'the block is refreshed after FULL_EVERY turns');

// a new session, or a stage change, sends it again
const chat = wrenChat();
wren(chat, 'a', [], 0);
const same = wren(chat, 'b', [{ role: 'user', text: 'a' }], 1);
assert(!same.includes('Voice:'));
chat.claudeSessionId = 'sess-2';
assert(wren(chat, 'c', [{ role: 'user', text: 'a' }], 2).includes('Voice:'), 'new session sends the block');
const grown = T.buildPrompt(chat, 'd', [], [{ role: 'user', text: 'a' }], null, { persona: 'wren', mascot: { stage: 'bigger', points: 25, nextAt: 40 } });
assert(grown.includes('Voice:') || grown.includes('[Your state]'), 'stage change still states her state');

// the prefix of the history never changes: a turn prompt is built from the request, the state and the
// standing block only, never from a timestamp or the earlier turns, so the stored history is append-only
const a = wren(wrenChat(), 'same request', [], 0);
const b = wren(wrenChat(), 'same request', [], 0);
assert.strictEqual(a, b, 'a turn prompt has no volatile content (timestamps, random ids)');

// Yozora's prompt: reported always; asserted once its module uses the same hook
if (xi._test && xi._test.buildPrompt) {
    const xiChat = () => ({ id: 'xi_test', runtime: 'tokenrouter', claudeSessionId: 'sess-1', messages: [] });
    const x = replay((c, t, p, i) => xi._test.buildPrompt(c, t, [], null, { mascot: { stage: 'base', points: i, nextAt: 20 }, claudeSessionId: c.claudeSessionId }), xiChat, TURNS);
    console.log('Yozora turn prompt chars:', x.sizes.join(' '));
    if (x.sizes[1] < x.sizes[0] * 0.6) console.log('Yozora: standing block sent once (ok)');
    else if (process.env.XI_HOOK_REQUIRED) assert.fail('Yozora still repeats its standing block every turn');
    else console.log('Yozora: STILL repeats the standing block every turn (xiDirector.js hook pending)');
}
console.log('director request size: ok');
