// Auto-Repair Session (#687): learned-rule store, repaired opening, deliver_repair, auto trigger.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'director-repair-'));
const learned = require('../modules/directorLearned');
learned._test.setStorePath(path.join(tmp, 'learned-rules.json'));
const t = require('../modules/cursorDirector')._test;

// ---- proposals store ----
assert.strictEqual(learned.rulesSection(), '', 'no section while nothing is approved');
assert.ok(!t.wrenRules().includes('## 9. Learned rules'));
const ruleAdd = learned.normalizeRuleProposal({ op: 'add', text: 'Read the reference again before every correction print.', why: 'ignored refs' }, new Set());
const guide = learned.normalizeGuideProposal({ path: 'knowledge/prompt-guide/prompts/body-shapes.md', op: 'create', text: '# Body shapes\n\nKeep one fact per phrase.', why: 'missing page' });
assert.strictEqual(guide.path, 'prompts/body-shapes.md', 'mount prefix stripped');
assert.throws(() => learned.normalizeGuideProposal({ path: '../secrets.md', op: 'create', text: 'x' }), /not a prompt guide text file/);
assert.throws(() => learned.normalizeGuideProposal({ path: '.git/config.md', op: 'append', text: 'x' }), /not a prompt guide text file/);
assert.throws(() => learned.normalizeGuideProposal({ path: 'tool.sh', op: 'append', text: 'x' }), /not a prompt guide text file/);
assert.throws(() => learned.normalizeRuleProposal({ op: 'edit', id: 'lr_missing', text: 'Some new text here.' }, new Set()), /no learned rule/);
const first = learned.addProposals('dirc_a', { ruleProposals: [ruleAdd, { ...ruleAdd, text: 'Never print the same prompt on a new seed after a correction.' }], guideProposals: [guide] });
assert.strictEqual(first.ruleIds.length, 2);
assert.strictEqual(first.guideIds.length, 1);
assert.ok(learned.readStore().proposals.every((row) => row.status === 'pending'));
assert.strictEqual(learned.rulesSection(), '', 'pending proposals change nothing');

const approved = learned.decideProposal(first.ruleIds[0], 'approve', null, {});
assert.strictEqual(approved.proposal.status, 'approved');
assert.strictEqual(approved.rules.length, 1);
assert.throws(() => learned.decideProposal(first.ruleIds[0], 'approve', null, {}), /already approved/);
const rejected = learned.decideProposal(first.ruleIds[1], 'reject', null, {});
assert.strictEqual(rejected.proposal.status, 'rejected');
assert.strictEqual(learned.approvedRules().length, 1, 'rejected adds nothing');
const rules = t.wrenRules();
assert.ok(rules.includes('## 9. Learned rules\n- Read the reference again before every correction print.'), 'approved rule in wrenRules');
assert.ok(rules.indexOf('## 9. Learned rules') > rules.indexOf('## 8. Tools'), 'section 9 comes last');
assert.ok(t.projectPrompt().includes('## 9. Learned rules'));

const ruleId = learned.approvedRules()[0].id;
learned.editRule(ruleId, 'Read the reference file again before each correction print.');
assert.ok(t.wrenRules().includes('- Read the reference file again before each correction print.'));
// edit and remove proposals target an existing rule; an edited approval uses the user's text
const editProp = learned.normalizeRuleProposal({ op: 'edit', id: ruleId, text: 'Proposed wording of the rule.' }, new Set([ruleId]));
const removeProp = learned.normalizeRuleProposal({ op: 'remove', id: ruleId }, new Set([ruleId]));
const second = learned.addProposals('dirc_a', { ruleProposals: [editProp, removeProp] });
learned.decideProposal(second.ruleIds[0], 'approve', 'Wording the user typed instead.', {});
assert.strictEqual(learned.approvedRules()[0].text, 'Wording the user typed instead.');
learned.decideProposal(second.ruleIds[1], 'approve', null, {});
assert.strictEqual(learned.approvedRules().length, 0, 'remove proposal removes the rule');
assert.ok(!t.wrenRules().includes('## 9. Learned rules'), 'section gone when empty');
const third = learned.addProposals('dirc_a', { ruleProposals: [ruleAdd] });
learned.decideProposal(third.ruleIds[0], 'approve', null, {});
learned.removeRule(learned.approvedRules()[0].id);
assert.strictEqual(learned.approvedRules().length, 0);
assert.throws(() => learned.removeRule('lr_nope'), /not found/);

// guide approval writes into the clone, never outside it, and never commits
const clone = path.join(tmp, 'prompt-guide-work');
fs.mkdirSync(path.join(clone, 'prompts'), { recursive: true });
learned.decideProposal(first.guideIds[0], 'approve', null, { guideRoot: clone });
assert.strictEqual(fs.readFileSync(path.join(clone, 'prompts/body-shapes.md'), 'utf8'), '# Body shapes\n\nKeep one fact per phrase.\n');
const appendIds = learned.addProposals('dirc_a', { guideProposals: [learned.normalizeGuideProposal({ path: 'prompts/body-shapes.md', op: 'append', text: '- Check three views.' })] });
learned.decideProposal(appendIds.guideIds[0], 'approve', null, { guideRoot: clone });
assert.ok(fs.readFileSync(path.join(clone, 'prompts/body-shapes.md'), 'utf8').endsWith('phrase.\n\n- Check three views.\n'));
const createAgain = learned.addProposals('dirc_a', { guideProposals: [guide] });
assert.throws(() => learned.decideProposal(createAgain.guideIds[0], 'approve', null, { guideRoot: clone }), /already exists/);
assert.strictEqual(learned.readStore().proposals.find((row) => row.id === createAgain.guideIds[0]).status, 'pending', 'a failed approval stays pending');
fs.symlinkSync(tmp, path.join(clone, 'out'));
const escape = learned.addProposals('dirc_a', { guideProposals: [learned.normalizeGuideProposal({ path: 'out/escape.md', op: 'create', text: 'x' })] });
assert.throws(() => learned.decideProposal(escape.guideIds[0], 'approve', null, { guideRoot: clone }), /outside the prompt guide/);
assert.ok(!fs.existsSync(path.join(tmp, 'escape.md')));

// ---- buildPrompt: the repaired opening replaces the transcript, once ----
const opening = 'Make the knight from ref.png again: same armor, three-quarter view, keep going up to 12 prints.';
const chat = { id: 'dirc_x', workspaceId: 'w', name: 'Knight', messages: [], repairedOpening: { text: opening, at: '2026-10-31T00:00:00.000Z', cardId: 'card1' } };
const prior = [{ role: 'user', user_input: 'old ask that filled the context' }];
const repairedPrompt = t.buildPrompt(chat, 'also make it night', [], prior, null, { handoff: true });
assert.ok(repairedPrompt.startsWith(`${t.REPAIRED_HEADER}\n${opening}`), 'opening first');
assert.ok(!repairedPrompt.includes('old ask that filled the context'), 'no transcript replay');
assert.ok(!repairedPrompt.includes('Follow-up: the next frame'));
assert.ok(repairedPrompt.endsWith('User request:\nalso make it night'));
assert.strictEqual(t.takeRepairedOpening(chat, 'other-stamp'), false, 'a newer repair is not consumed by an older turn');
assert.strictEqual(t.takeRepairedOpening(chat, '2026-10-31T00:00:00.000Z'), true);
assert.strictEqual(t.takeRepairedOpening(chat, '2026-10-31T00:00:00.000Z'), false, 'consumed once');
const after = t.buildPrompt(chat, 'next frame', [], prior, null, {});
assert.ok(!after.includes(t.REPAIRED_HEADER), 'later turns are normal follow-ups');
assert.ok(after.includes('Follow-up: the next frame'));
// a replay after a used repair starts at the divider
const replayChat = { id: 'dirc_y', replay: true, messages: [] };
const replayPrior = [
    { role: 'user', user_input: 'before the repair' },
    { role: 'event', message_type: 'session-repair', data: { openingRequest: opening } },
    { role: 'user', user_input: 'after the repair' }
];
const replayed = t.buildPrompt(replayChat, 'again', [], replayPrior, null, {});
assert.ok(!replayed.includes('before the repair'));
assert.ok(replayed.includes(`user (the repaired request this session started from): ${opening}`));
assert.ok(replayed.includes('user: after the repair'));

// ---- deliver_repair validation ----
const good = {
    chatId: 'dirc_x',
    summary: 'A knight portrait series; the session looped on the helmet and ignored two corrections about the visor.',
    timeline: ['Asked for the knight from ref.png', 'Rejected print 3: visor wrong', 'Best so far: print 5'],
    references: [{ kind: 'attachment', ref: 'chats/dirc_x/inbox/1-ref.png', note: 'the knight' }, { kind: 'weird', ref: 'print_5.png' }],
    checklist: ['Closed visor with a T slit', 'Blue tabard', 'Three-quarter view'],
    openingRequest: opening + ' Start from print_5.png settings. Do not reuse the open visor from print 3.',
    ruleProposals: [{ op: 'add', text: 'After a correction, Read the reference before the next print.', why: 'twice ignored' }],
    guideProposals: [],
    reports: [{ title: 'read_image_metadata returned no characters', body: 'At message 14 the metadata came back without the character list.' }]
};
const normal = t.normalizeRepairPayload(good, new Set());
assert.strictEqual(normal.references[1].kind, 'other', 'unknown kinds fold into other');
assert.strictEqual(normal.reports.length, 1);
assert.deepStrictEqual(t.normalizeRepairPayload({ ...good, timeline: 'one\n\ntwo' }, new Set()).timeline, ['one', 'two']);
assert.throws(() => t.normalizeRepairPayload({ ...good, summary: 'short' }, new Set()), /summary is required/);
assert.throws(() => t.normalizeRepairPayload({ ...good, checklist: [] }, new Set()), /checklist is required/);
assert.throws(() => t.normalizeRepairPayload({ ...good, openingRequest: 'too short' }, new Set()), /openingRequest is required/);
assert.throws(() => t.normalizeRepairPayload({ ...good, references: 'x' }, new Set()), /references must be an array/);
assert.throws(() => t.normalizeRepairPayload({ ...good, references: [{ kind: 'print' }] }, new Set()), /needs ref/);
assert.throws(() => t.normalizeRepairPayload({ ...good, reports: [{ title: 'x' }] }, new Set()), /title and body/);
assert.throws(() => t.normalizeRepairPayload({ ...good, ruleProposals: [{ op: 'remove', id: 'lr_gone' }] }, new Set()), /no learned rule/);
assert.throws(() => t.normalizeRepairPayload({ ...good, guideProposals: [{ path: '/etc/passwd', op: 'replace', text: 'x' }] }, new Set()), /not a prompt guide/);
try {
    t.normalizeRepairPayload({ ...good, checklist: [] }, new Set());
} catch (error) {
    assert.strictEqual(error.code, 'BAD_REPAIR_PAYLOAD');
}
const director = require('../modules/cursorDirector');
assert.throws(() => director.deliverRepair('dirc_x', good), /No Auto-Repair turn/, 'only a waiting repair turn can deliver');
assert.throws(() => director.readRepairSession('dirc_x', {}), /No Auto-Repair turn/, 'only a waiting repair turn can read');
const slot = { payload: null, repairChatId: 'dirc_repair' };
t.repairDeliveries.set('dirc_x', slot);
assert.strictEqual(director.deliverRepair('dirc_repair', good).chatId, 'dirc_x', 'the repair chat id maps to its target');
const delivered = director.deliverRepair('dirc_x', good);
assert.strictEqual(delivered.checklist, 3);
assert.strictEqual(slot.payload.openingRequest, normal.openingRequest);
assert.throws(() => director.deliverRepair('dirc_x', { ...good, summary: '' }), /summary is required/);
assert.strictEqual(slot.payload.summary, normal.summary, 'a bad redelivery keeps the good one');
t.repairDeliveries.delete('dirc_x');

// ---- read_repair_session rows ----
const userRow = t.repairMessageRow({ role: 'user', user_input: 'Use [knight](dsap://lookback/abc123) please', files: ['chats/x/inbox/a.png'], timestamp: 't' }, 3);
assert.deepStrictEqual(userRow.lookbacks, [{ label: 'knight', link: 'dsap://lookback/abc123' }]);
assert.deepStrictEqual(userRow.files, ['chats/x/inbox/a.png']);
const longReply = 'a'.repeat(5000) + 'SCORECARD';
const botRow = t.repairMessageRow({ role: 'assistant', trace: [{ type: 'thinking', text: 'b'.repeat(2000) }, { type: 'tool', label: 'Generate image' }, { type: 'assistant', text: longReply }], prints: ['p.png'] }, 4);
assert.ok(botRow.text.length <= 3000 && botRow.text.endsWith('SCORECARD'), 'long replies keep their end');
assert.ok(botRow.thinking.length <= 400, 'thinking is a short excerpt');
assert.deepStrictEqual(botRow.tools, ['Generate image']);
assert.deepStrictEqual(botRow.prints, ['p.png']);

// ---- auto trigger ----
const asked = [{ role: 'user', message_type: 'Ask', user_input: 'hi' }];
const on = { enabled: true, threshold: 85 };
assert.strictEqual(t.autoRepairDue({ id: 'a', contextPercent: 86, messages: asked }, on, {}), true);
assert.strictEqual(t.autoRepairDue({ id: 'a', contextPercent: 85, messages: asked }, on, {}), true, 'threshold is inclusive');
assert.strictEqual(t.autoRepairDue({ id: 'a', contextPercent: 84, messages: asked }, on, {}), false);
assert.strictEqual(t.autoRepairDue({ id: 'a', contextPercent: 95, messages: asked }, { enabled: false, threshold: 85 }, {}), false);
assert.strictEqual(t.autoRepairDue({ id: 'a', contextPercent: 95, messages: [] }, on, {}), false, 'nothing to repair');
assert.strictEqual(t.autoRepairDue({ id: 'a', contextPercent: 95, messages: asked }, on, { resume: true }), false);
assert.strictEqual(t.autoRepairDue({ id: 'a', contextPercent: 95, messages: asked }, on, { steer: true }), false);
assert.strictEqual(t.autoRepairDue({ id: 'a', dynagen: true, contextPercent: 95, messages: asked }, on, {}), false, 'hidden chats never auto-repair');
assert.strictEqual(t.autoRepairDue({ id: 'a', contextPercent: 70, messages: asked }, { enabled: true, threshold: 60 }, {}), true);
const gr = (director) => ({ getConfig: () => ({ director }) });
assert.deepStrictEqual(t.autoRepairSettings(gr({})), { enabled: true, threshold: 85 });
assert.deepStrictEqual(t.autoRepairSettings(gr({ autoRepair: { enabled: false, threshold: 70 } })), { enabled: false, threshold: 70 });
assert.deepStrictEqual(t.autoRepairSettings(gr({ autoRepair: { threshold: 5 } })), { enabled: true, threshold: 85 }, 'nonsense threshold falls back');
assert.deepStrictEqual(t.autoRepairSettings({ getConfig: () => { throw new Error('no config'); } }), { enabled: true, threshold: 85 });

// ---- repair engine pick ----
const claudeChat = { lastEngine: 'claude', choice: { engine: 'claude', id: 'claude-opus-5-5', effort: 'medium' } };
const fallback = t.repairAgentFor(gr({}), claudeChat);
assert.strictEqual(fallback.engine, 'claude');
assert.strictEqual(fallback.model, 'claude-opus-5-5');
assert.strictEqual(fallback.effort, 'xhigh', 'Claude repairs at xhigh');
assert.strictEqual(fallback.lane, 'normal');
assert.strictEqual(t.repairAgentFor(gr({}), { lastEngine: 'cursor', choice: { engine: 'cursor', id: 'gpt-5' } }).effort, 'high');
const configured = t.repairAgentFor(gr({ repair: { normal: { engine: 'cursor', model: 'gpt-5' } } }), claudeChat);
assert.deepStrictEqual([configured.engine, configured.model, configured.effort], ['cursor', 'gpt-5', 'high'], 'config pick, effort defaults high');

// ---- the repair prompt carries the note and the rules ----
const prompt = t.repairTurnPrompt({ targetId: 'dirc_x', name: 'Knight', total: 40, reason: 'manual', note: 'rein it in', rules: [{ id: 'lr_1', text: 'Rule one.' }] });
assert.ok(prompt.includes('read_repair_session') && prompt.includes('deliver_repair'));
assert.ok(prompt.includes('Think hard'));
assert.ok(prompt.includes('rein it in'));
assert.ok(prompt.includes('- lr_1: Rule one.'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('test-director-repair: ok');
process.exit(0);
