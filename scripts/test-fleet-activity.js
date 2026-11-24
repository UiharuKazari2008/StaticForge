'use strict';
// Fleet activity index (#1154): incremental scan, query paging + filters, detail, masking.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-activity-'));
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');
const SID = '11111111-2222-3333-4444-555555555555';
const dir = path.join(tmp, '.claude', 'projects', '-tmp-proj');
const file = path.join(dir, `${SID}.jsonl`);
const subDir = path.join(dir, SID, 'subagents');
fs.mkdirSync(subDir, { recursive: true });
const sub = path.join(subDir, 'agent-abc123.jsonl');
fs.writeFileSync(path.join(subDir, 'agent-abc123.meta.json'), JSON.stringify({ description: 'Explore the thing' }));

const t0 = Date.now() - 60000;
const iso = (n) => new Date(t0 + n * 1000).toISOString();
const line = (o) => `${JSON.stringify(o)}\n`;
const user = (n, text) => line({ type: 'user', timestamp: iso(n), uuid: `u${n}`, cwd: '/tmp/proj', message: { role: 'user', content: text } });
const use = (n, id, name, input, text) => line({ type: 'assistant', timestamp: iso(n), uuid: `a${n}`, message: { role: 'assistant', content: (text ? [{ type: 'text', text }] : []).concat([{ type: 'tool_use', id, name, input }]) } });
const res = (n, id, content, err) => line({ type: 'user', timestamp: iso(n), uuid: `r${n}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !!err }] } });

fs.writeFileSync(file, line({ type: 'ai-title', aiTitle: 'Fix the widget' })
    + user(1, 'please fix the widget')
    + use(2, 'tu1', 'Bash', { command: 'ls -la\necho hi', description: 'List files' }, 'Looking around first.')
    + res(3, 'tu1', 'file1\nfile2 token sk-ant-api03-ABCDEFGHIJKLMNOP end'));
fs.writeFileSync(sub, use(4, 'tu3', 'Grep', { pattern: 'widget', path: '/tmp/proj' }) + res(5, 'tu3', 'match'));

const ai = require('../modules/agentCoord/activityIndex');
let r1 = ai.scanFile(file, SID, '');
const r2 = ai.scanFile(sub, SID, 'abc123');
assert.strictEqual(r1.rows, 1);
assert.strictEqual(r2.rows, 1);
assert.strictEqual(ai.scanFile(file, SID, '').rows, 0, 'nothing new = nothing read');

fs.appendFileSync(file, use(6, 'tu2', 'Edit', { file_path: '/tmp/proj/a.js', old_string: 'a', new_string: 'b' }) + res(7, 'tu2', 'edited', true) + '{"type":"assis');
r1 = ai.scanFile(file, SID, '');
assert.strictEqual(r1.rows, 1, 'only the new row; the half line waits');
fs.appendFileSync(file, 'tant"}\n');
assert.strictEqual(ai.scanFile(file, SID, '').rows, 0);

const q = ai.query({});
assert.strictEqual(q.total, 3);
assert.deepStrictEqual(q.rows.map((x) => x.tool), ['Edit', 'Grep', 'Bash']);
assert.strictEqual(q.rows[0].error, true);
assert.strictEqual(q.rows[0].kind, 'edit');
assert.strictEqual(q.rows[0].sessionTitle, 'Fix the widget');
assert.strictEqual(q.rows[1].agentId, 'abc123');
assert.strictEqual(q.rows[1].agentDescription, 'Explore the thing');
assert.strictEqual(q.rows[2].summary, 'List files');
assert.strictEqual(q.rows[2].target, 'ls -la');
assert.strictEqual(q.next, null);

const p1 = ai.query({ limit: 2 });
assert.strictEqual(p1.rows.length, 2);
assert.ok(p1.next);
const p2 = ai.query({ limit: 2, before: p1.next });
assert.deepStrictEqual(p2.rows.map((x) => x.tool), ['Bash']);
assert.strictEqual(p2.next, null);
assert.deepStrictEqual(ai.query({ kind: 'shell' }).rows.map((x) => x.tool), ['Bash']);
assert.deepStrictEqual(ai.query({ q: 'a.js' }).rows.map((x) => x.tool), ['Edit']);
assert.strictEqual(ai.query({ q: 'list files' }).rows.length, 1);
assert.strictEqual(ai.query({ sessionId: SID, kind: 'tool' }).rows.length, 1);

const d = ai.detail(q.rows[2].id);
assert.strictEqual(d.input.command, 'ls -la\necho hi');
assert.ok(/file2 token/.test(d.output));
assert.ok(!/ABCDEFGHIJKLMNOP/.test(d.output), 'token masked');
assert.strictEqual(d.why.request, 'please fix the widget');
assert.strictEqual(d.why.assistantText, 'Looking around first.');
assert.strictEqual(d.session.id, SID);
assert.strictEqual(d.session.title, 'Fix the widget');
const e = ai.detail(q.rows[0].id);
assert.strictEqual(e.input.file_path, '/tmp/proj/a.js');
assert.strictEqual(e.output, 'edited');
assert.throws(() => ai.detail(99999));

ai.refresh({ budgetMs: 1000 }).then((r) => {
    assert.strictEqual(r.rows, 0);
    assert.strictEqual(ai.query({}).total, 3);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('fleet activity: ok');
});
