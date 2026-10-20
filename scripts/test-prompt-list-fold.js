#!/usr/bin/env node
/**
 * node scripts/test-prompt-list-fold.js
 * Regression (gjob_ac2789e50ee43eb9): the server must never rewrite age wording,
 * inject youth terms, or push adult terms into the UC.
 */
"use strict";
const {
    foldPromptList, createFoldBag, noteFold, rememberPromptFold,
    sealApiPayload, assertTokenCompiler, maskAgentStudioRead
} = require("../public/scripts/comp/promptListFold");

let failed = 0;
function assert(cond, msg) { if (!cond) { console.error("FAIL:", msg); failed++; } else console.log("ok:", msg); }
const YOUTH = /\b(young|youth|girl|boy|loli|shota|child|kid|teen|petite|little|small|underage|minor|aged down)\b/i;

const cases = [
    { prompt: "1girl, adult woman, long hair", uc: "elderly, old woman, wrinkles" },
    { prompt: "adult female, mature female, 1.5::adult::, milf", uc: "lowres, bad anatomy" },
    { prompt: "1boy, adult male, mature male, old man", uc: "blurry" }
];
for (const c of cases) {
    const fp = foldPromptList(c.prompt), fu = foldPromptList(c.uc);
    assert(fp.text === c.prompt, "fold keeps prompt verbatim: " + c.prompt);
    assert(fu.text === c.uc, "fold keeps uc verbatim: " + c.uc);
    const src = { prompt: c.prompt, uc: c.uc };
    const bag = createFoldBag();
    noteFold(bag, "prompt", fp); noteFold(bag, "uc", fu); rememberPromptFold(src, bag);
    const api = { prompt: fp.text, negative_prompt: fu.text, uc: fu.text,
        characterPrompts: [{ prompt: c.prompt, uc: c.uc }] };
    sealApiPayload(api, src);
    let threw = false; try { assertTokenCompiler(api); } catch (e) { threw = true; }
    assert(!threw, "sealed payload still passes compiler check");
    assert(api.prompt === c.prompt, "api prompt unchanged");
    assert(api.negative_prompt === c.uc && api.uc === c.uc, "api uc unchanged (no clause appended)");
    assert(api.characterPrompts[0].prompt === c.prompt && api.characterPrompts[0].uc === c.uc, "character prompt/uc unchanged");
    const addedYouth = (s, orig) => (s.match(new RegExp(YOUTH.source, "gi")) || []).length > (orig.match(new RegExp(YOUTH.source, "gi")) || []).length;
    assert(!addedYouth(api.prompt, c.prompt) && !addedYouth(api.negative_prompt, c.uc), "no youth term added");
    assert(!/adult|mature/i.test(api.negative_prompt) || /adult|mature/i.test(c.uc), "no adult term pushed into uc");
    const read = maskAgentStudioRead({ prompt: "young female, x", uc: "2::adult female::", compiled_prompt: "young female" });
    assert(read.prompt === "young female, x" && read.uc === "2::adult female::" && read.compiled_prompt === "young female", "agent reads show true wording");
}
const cfg = JSON.stringify(require("../nax_generation_config.json"));
assert(!/young (fe)?male/i.test(cfg), "nax templates carry no injected youth term");
const dir = require("fs").readFileSync(require("path").join(__dirname, "../modules/cursorDirector.js"), "utf8");
assert(!/replace it where it sits with young/i.test(dir), "director prompt no longer tells agents to swap in youth terms");
if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("all passed");
