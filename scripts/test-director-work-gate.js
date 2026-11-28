// #1275: the Director's work gate (modules/directorWorkGate.js): request classifier, shell guard, Stop gate, hook settings,
// the hook process end to end, and the xiDirector wiring (spawn args carry --tools and --settings).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const gate = require('../modules/directorWorkGate');
const GATE_SCRIPT = path.join(__dirname, '..', 'modules', 'directorWorkGate.js');

// ---- classifyRequest
const WORK = [
    'fix modules/foo.js: the dispatch drops the issue',
    'the Fleet window crashes when I open settings, modules/claudeFleetMcp.js line 400 - fix this',
    'implement #1275',
    'modules/xiDirector.js throws a TypeError on reload',
    'Hi Yozora, please refactor scripts/check-perf-rules.js and push it',
    'can you fix modules/foo.js?',
    'Add a retry to services/uploader.kt, it fails on a slow network',
    'bump the version in package.json and deploy it',
    'What is wrong with modules/foo.js? Fix it.'
];
const TALK = [
    'hi Yozora',
    'how are you',
    'why does modules/foo.js crash?',
    'how is work item #12 going?',
    "what's running on Fleet",
    'thanks!',
    'Is modules/foo.js the file that builds the prompt?',
    'any update on #1275?',
    'where is the queue kept',
    'good morning, I had a nice day'
];
WORK.forEach((t) => assert.strictEqual(gate.classifyRequest(t).work, true, `work: ${t} (${gate.classifyRequest(t).why})`));
TALK.forEach((t) => assert.strictEqual(gate.classifyRequest(t).work, false, `not work: ${t} (${gate.classifyRequest(t).why})`));
assert.ok(typeof gate.classifyRequest('implement #1275').why === 'string' && gate.classifyRequest('implement #1275').why.length > 0);
assert.strictEqual(gate.classifyRequest('').work, false);
assert.strictEqual(gate.classifyRequest(undefined).work, false);

// ---- bashGuard
const ALLOW = [
    'ls -la modules',
    'cat modules/xiDirector.js | head -50',
    'git log --oneline | head',
    'git -C /srv/repo diff --stat HEAD~3',
    'git status --short && git branch',
    'git branch -a --list "feat/*"',
    'git branch --show-current',
    'git tag',
    'git tag -l "v1*"',
    'git config --get user.name',
    'git stash list',
    'git remote -v',
    'git rev-parse HEAD && git ls-files modules | wc -l',
    'git diff > /tmp/x.patch',
    'grep foo x 2>&1 | head',
    'grep -rn "claude_dispatch" modules/ | sort | uniq -c',
    'rg -n "bypassPermissions" modules',
    'find modules -name "*.js" -newer package.json',
    'jq .work /tmp/x.json',
    'curl -sS -X POST https://yozora.example/api/v1/repos/a/b/issues -H "Content-Type: application/json" -d @-',
    'curl -sS -o /tmp/out.json https://example.com/x',
    'cat > /tmp/x <<EOF\nhello > not a redirect\nrm -rf /\nEOF',
    'echo hi > /dev/null',
    'echo "$TMPDIR" > $TMPDIR/x.txt',
    'node --check modules/xiDirector.js',
    'node scripts/check-perf-rules.js',
    'node scripts/check-perf-rules.js --dsapp /tmp/tree',
    'node -e "console.log(JSON.parse(require(\'fs\').readFileSync(\'package.json\',\'utf8\')).name)"',
    'python3 -c "print(1+1)"',
    'sed -n 1,20p modules/xiDirector.js',
    'cd modules && ls | head',
    'for f in modules/*.js; do wc -l $f; done',
    'echo "a;b && rm -rf x" | wc -c',
    'tar tf /tmp/a.tgz',
    'wc -l $(git ls-files modules)',
    'timeout 10 grep -c x y',
    'FOO=1 env | sort',
    'adb devices',
    'ls scripts/restart*',
    'cat scripts/restart-dreamscape.sh',
    'sort -u /tmp/a > /tmp/b'
];
const DENY = [
    ['cd modules && sed -i s/a/b/ x.js', 'sed -i'],
    ['sed --in-place s/a/b/ x.js', 'sed -i'],
    ['perl -pi -e s/a/b/ x.js', 'perl -i'],
    ['echo hi > modules/x.js', 'redirect'],
    ['echo hi >> notes.txt', 'redirect'],
    ['cmd &> out.log', 'redirect'],
    ['ls | tee out.txt', 'tee'],
    ['npm test', 'npm'],
    ['npx eslint .', 'npx'],
    ['./gradlew assembleDebug', 'run a file'],
    ['bash scripts/restart-dreamscape.sh', 'bash'],
    ['sh ./x.sh', 'sh'],
    ['ssh host ls', 'ssh'],
    ['./x.sh', 'run a file'],
    ['node scripts/restart-dreamscape.js', 'node'],
    ['git push origin HEAD:main', 'git push'],
    ['git add -A && git commit -m x', 'git add'],
    ['git status && git commit -m x', 'git commit'],
    ['git checkout -- modules/x.js', 'git checkout'],
    ['git stash', 'git stash'],
    ['git reset --hard HEAD', 'git reset'],
    ['git config user.name Yozora', 'git config'],
    ['git tag v1.0', 'git tag'],
    ['git branch newbranch', 'git branch'],
    ['git branch -D old', 'git branch'],
    ['git worktree add /tmp/w', 'git worktree'],
    ['git diff --output=out.patch', 'git diff'],
    ['rm -rf modules/x', 'rm'],
    ['mv a b', 'mv'],
    ['cp a b', 'cp'],
    ['mkdir -p x/y', 'mkdir'],
    ['touch zz-should-not-exist.txt', 'touch'],
    ['chmod +x x.sh', 'chmod'],
    ['ls | xargs rm', 'rm'],
    ['echo $(rm -rf x)', 'rm'],
    ['echo `touch x`', 'touch'],
    ['cat x | bash', 'bash'],
    ['bash -c "rm -rf x"', 'rm'],
    ['sh -c \'git commit -m x\'', 'git commit'],
    ['eval "touch x"', 'touch'],
    ['env FOO=1 rm x', 'rm'],
    ['sudo systemctl restart dreamscape', 'systemctl'],
    ['pm2 restart all', 'pm2'],
    ['kill -9 1234', 'kill'],
    ['pkill node', 'pkill'],
    ['docker ps', 'docker'],
    ['make build', 'make'],
    ['adb install app.apk', 'adb'],
    ['find . -name "*.tmp" -delete', 'find'],
    ['find . -name x -exec rm {} \\;', 'find'],
    ['curl -O https://example.com/x', 'curl'],
    ['curl -o out.json https://example.com/x', 'curl'],
    ['curl -sSo /srv/x https://example.com/x', 'curl'],
    ['node -e "require(\'fs\').writeFileSync(\'x\',\'y\')"', 'node'],
    ['node --eval "fs.unlinkSync(\'x\')"', 'node'],
    ['python3 -c "open(\'x\',\'w\').write(\'y\')"', 'python'],
    ['python -c "import os; os.remove(\'x\')"', 'python'],
    ['node scripts/check-perf-rules.js --update', 'node'],
    ['node scripts/build-thing.js', 'node'],
    ['node <<EOF\nrequire("fs").writeFileSync("x","y")\nEOF', 'node'],
    ['unzip a.zip', 'unzip'],
    ['tar xzf a.tgz', 'tar'],
    ['tar -xf a.tar', 'tar'],
    ['dd if=/dev/zero of=x', 'dd'],
    ['truncate -s 0 x', 'truncate'],
    ['ln -s a b', 'ln'],
    ['sort -o x y', 'sort'],
    ['awk -i inplace "{print}" x', 'awk'],
    ['reload-server-module xiDirector', 'restart'],
    ['scripts/restart-gate', 'run a file'],
    ['echo x > /tmp/../etc/x', 'redirect'],
    ['(cd modules; rm x)', 'rm'],
    ['echo hi |& tee y', 'tee'],
    ['ls && { rm x; }', 'rm'],
    ['if true; then rm x; fi', 'rm']
];
ALLOW.forEach((c) => {
    const g = gate.bashGuard(c);
    assert.strictEqual(g.deny, false, `should allow: ${JSON.stringify(c)} -> ${g.reason}`);
});
DENY.forEach(([c, rule]) => {
    const g = gate.bashGuard(c);
    assert.strictEqual(g.deny, true, `should deny: ${JSON.stringify(c)}`);
    assert.ok(g.reason.startsWith('Yozora does not change the tree, build or restart: hand this to the Supervisor with claude_dispatch (issue, files, acceptance check), or fleet_work_update an existing item. Refused: '), g.reason);
    assert.ok(g.reason.toLowerCase().includes(rule.toLowerCase()), `${JSON.stringify(c)} refused by the wrong rule: ${g.reason}`);
});
// the matched rule is named
assert.ok(gate.bashGuard('git push origin HEAD:main').reason.includes('git push'));
assert.ok(gate.bashGuard('touch x').reason.endsWith('Refused: touch.'));
assert.strictEqual(gate.bashGuard('').deny, false);
assert.strictEqual(gate.bashGuard(undefined).deny, false);

// ---- stopGate
const WORK_REQUEST = 'fix modules/foo.js: the dispatch drops the issue';
const TALK_REQUEST = 'how are you';
const userText = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const use = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: input || {} }] } });
const said = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const result = (id, content, isError) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError === true }] } });
const DISPATCH_JSON = JSON.stringify({ success: true, work: 42, state: 'Waiting', issues: ['DreamScape/StaticForge#1300'], issueUrl: 'https://yozora.example/DreamScape/StaticForge/issues/1300' });

const noHandover = [userText(WORK_REQUEST), said('Looking.'), use('t1', 'Read', { file_path: 'modules/foo.js' }), result('t1', 'code'), use('t2', 'mcp__dreamscape__finish_turn', { summary: 'I fixed it.' }), result('t2', 'ok')];
let v = gate.stopGate({ request: WORK_REQUEST, transcriptEntries: noHandover, stopHookActive: false });
assert.strictEqual(v.block, true);
assert.ok(v.reason.startsWith('This request is work for the Supervisor, and this turn has not handed it over.'));
assert.ok(v.reason.includes('you will not be stopped again'));

const handed = (summary, resultContent) => [
    userText(WORK_REQUEST),
    use('t1', 'mcp__dreamscape__claude_dispatch', { prompt: 'brief', issues: ['DreamScape/StaticForge#1300'] }),
    result('t1', resultContent || [{ type: 'text', text: DISPATCH_JSON }]),
    use('t2', 'mcp__dreamscape__finish_turn', { summary })
];
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: handed('Handed to the Supervisor as work item #42 (Waiting), issue DreamScape/StaticForge#1300.'), stopHookActive: false }).block, false);
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: handed('Queued as item 42.', DISPATCH_JSON), stopHookActive: false }).block, false);
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: handed('See https://yozora.example/DreamScape/StaticForge/issues/1300'), stopHookActive: false }).block, false);
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: handed('Tracked on #1300.'), stopHookActive: false }).block, false);
// wrapped JSON (an MCP envelope whose text holds the JSON)
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: handed('Done: work item #42.', JSON.stringify({ content: [{ type: 'text', text: DISPATCH_JSON }] })), stopHookActive: false }).block, false);
v = gate.stopGate({ request: WORK_REQUEST, transcriptEntries: handed('I have it in hand and will report back.'), stopHookActive: false });
assert.strictEqual(v.block, true);
assert.strictEqual(v.reason, 'Name what you handed over in your reply: work item #N (Waiting / Queued) and its issue link, then end the turn.');
// no finish_turn: the assistant text after the last tool_use is the reply
const textReply = handed('x');
textReply.pop();
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: [...textReply, said('Handed over as work item #42.')], stopHookActive: false }).block, false);
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: [...textReply, said('Handed over.')], stopHookActive: false }).block, true);
// fleet_work_update / start name the item in their input
const updated = [userText(WORK_REQUEST), use('u1', 'mcp__dreamscape__fleet_work_update', { id: 7, appendNote: 'more' }), result('u1', '{"item":{}}'), use('u2', 'finish_turn', { summary: 'Updated work item #7.' })];
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: updated, stopHookActive: false }).block, false);
updated[3] = use('u2', 'finish_turn', { summary: 'Updated it.' });
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: updated, stopHookActive: false }).block, true);
const started = [userText(WORK_REQUEST), use('s1', 'mcp__dreamscape__fleet_work_start', { ids: [8, 9] }), result('s1', '{}'), use('s2', 'finish_turn', { summary: 'Started #8 and #9.' })];
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: started, stopHookActive: false }).block, false);
// ids that cannot be read: no block
const sent = [userText(WORK_REQUEST), use('m1', 'mcp__dreamscape__claude_session_send', { session: 'abc', text: 'go' }), result('m1', 'sent'), use('m2', 'finish_turn', { summary: 'Sent it.' })];
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: sent, stopHookActive: false }).block, false);
// a failed hand-over is not a hand-over
const failed = [userText(WORK_REQUEST), use('f1', 'mcp__dreamscape__claude_dispatch', { prompt: 'x' }), result('f1', 'Dispatches start on Sonnet', true), use('f2', 'finish_turn', { summary: 'It failed.' })];
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: failed, stopHookActive: false }).block, true);
// one nudge per turn, talk, request_form
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: noHandover, stopHookActive: true }).block, false);
assert.strictEqual(gate.stopGate({ request: TALK_REQUEST, transcriptEntries: noHandover, stopHookActive: false }).block, false);
const asked = [userText(WORK_REQUEST), use('q1', 'mcp__dreamscape__request_form', { chatId: 'c' }), result('q1', 'pending'), use('q2', 'finish_turn', { summary: 'Asked.' })];
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: asked, stopHookActive: false }).block, false);
// only this turn counts: a hand-over in an earlier turn does not
const earlier = [...handed('Handed over as work item #42.'), result('t2', 'ok'), userText(WORK_REQUEST), use('n1', 'finish_turn', { summary: 'I did it myself.' })];
assert.strictEqual(gate.stopGate({ request: WORK_REQUEST, transcriptEntries: earlier, stopHookActive: false }).block, true);

// ---- hookSettings
const settings = gate.hookSettings({ gateFile: "/tmp/it's/turn-gate.json", nodeBin: '/usr/bin/node', gateScript: '/srv/x/modules/directorWorkGate.js' });
assert.strictEqual(settings.hooks.PreToolUse.length, 1);
assert.strictEqual(settings.hooks.PreToolUse[0].matcher, 'Bash|Edit|Write|MultiEdit|NotebookEdit|Agent|Task');
assert.deepStrictEqual(settings.hooks.PreToolUse[0].hooks, [{ type: 'command', command: "'/usr/bin/node' '/srv/x/modules/directorWorkGate.js' pre-tool", timeout: 10 }]);
assert.strictEqual(settings.hooks.Stop.length, 1);
assert.strictEqual(settings.hooks.Stop[0].matcher, undefined);
assert.deepStrictEqual(settings.hooks.Stop[0].hooks, [{ type: 'command', command: "'/usr/bin/node' '/srv/x/modules/directorWorkGate.js' stop '/tmp/it'\\''s/turn-gate.json'", timeout: 10 }]);
JSON.parse(JSON.stringify(settings));

// ---- the hook process end to end
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'director-work-gate-'));
function hook(args, input) {
    return spawnSync(process.execPath, [GATE_SCRIPT, ...args], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
}
let r = hook(['pre-tool'], { tool_name: 'Bash', tool_input: { command: 'touch zz.txt' } });
assert.strictEqual(r.status, 0);
let out = JSON.parse(r.stdout);
assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
assert.ok(out.hookSpecificOutput.permissionDecisionReason.endsWith('Refused: touch.'));
r = hook(['pre-tool'], { tool_name: 'Bash', tool_input: { command: 'git log --oneline | head -3' } });
assert.strictEqual(r.status, 0);
assert.strictEqual(r.stdout, '');
['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task'].forEach((tool) => {
    r = hook(['pre-tool'], { tool_name: tool, tool_input: {} });
    assert.strictEqual(r.status, 0);
    const o = JSON.parse(r.stdout);
    assert.strictEqual(o.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(o.hookSpecificOutput.permissionDecisionReason.endsWith(`Refused: ${tool}.`));
});
r = hook(['pre-tool'], { tool_name: 'Read', tool_input: { file_path: 'x' } });
assert.strictEqual(r.stdout, '');
// fail open: garbage on stdin, no stdin payload, an unknown mode
r = hook(['pre-tool'], 'not json');
assert.strictEqual(r.status, 0);
assert.strictEqual(r.stdout, '');
r = hook(['stop', path.join(tmp, 'missing.json')], { transcript_path: path.join(tmp, 'missing.jsonl') });
assert.strictEqual(r.status, 0);
assert.strictEqual(r.stdout, '');

// the Stop hook: a transcript file with an older turn, then this turn without a hand-over
const gateFile = path.join(tmp, 'turn-gate.json');
fs.writeFileSync(gateFile, JSON.stringify({ request: WORK_REQUEST, work: true, at: new Date().toISOString() }));
const transcript = path.join(tmp, 't.jsonl');
const bigFiller = Array.from({ length: 2000 }, (_, i) => JSON.stringify(said(`filler ${i} ${'x'.repeat(200)}`))).join('\n');
fs.writeFileSync(transcript, `${bigFiller}\n${noHandover.map((e) => JSON.stringify(e)).join('\n')}\n`);
r = hook(['stop', gateFile], { transcript_path: transcript, stop_hook_active: false });
assert.strictEqual(r.status, 0);
out = JSON.parse(r.stdout);
assert.strictEqual(out.decision, 'block');
assert.ok(out.reason.startsWith('This request is work for the Supervisor'));
r = hook(['stop', gateFile], { transcript_path: transcript, stop_hook_active: true });
assert.strictEqual(r.stdout, '');
fs.writeFileSync(gateFile, JSON.stringify({ request: TALK_REQUEST, work: false, at: 'now' }));
r = hook(['stop', gateFile], { transcript_path: transcript, stop_hook_active: false });
assert.strictEqual(r.stdout, '');
fs.writeFileSync(gateFile, JSON.stringify({ request: WORK_REQUEST, work: true, at: 'now' }));
fs.writeFileSync(transcript, `${handed('Handed over as work item #42.').map((e) => JSON.stringify(e)).join('\n')}\n`);
r = hook(['stop', gateFile], { transcript_path: transcript, stop_hook_active: false });
assert.strictEqual(r.stdout, '');
// the tail reader finds this turn's start in a file bigger than its first window
fs.writeFileSync(transcript, `${bigFiller}\n${bigFiller}\n${handed('Handed over.').map((e) => JSON.stringify(e)).join('\n')}\n${bigFiller}\n`);
assert.strictEqual(gate.readTurnEntries(transcript)[0].type, 'user');

// ---- xiDirector wiring: the Claude CLI args carry the tool cut and the hooks; the gate file is written fresh each turn
process.env.HOME = tmp;
const xi = require('../modules/xiDirector');
const t = xi._test;
t.setBoundGr({ initialized: true, getPath: () => tmp, getConfig: () => ({ xi: { enabled: true } }) });
const prepared = { prompt: 'hello', standing: 'standing', userText: WORK_REQUEST, claudeFirstTurn: true, claudeSessionId: '11111111-1111-4111-8111-111111111111', model: 'claude-medium' };
const args = t.claudeCliArgs('chat-1', tmp, prepared, 'claude', 'medium');
assert.strictEqual(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash,WebFetch,WebSearch,ToolSearch');
const wired = JSON.parse(args[args.indexOf('--settings') + 1]);
const gatePath = path.join(t.layout().chats, 'chat-1', 'turn-gate.json');
assert.strictEqual(wired.hooks.PreToolUse[0].matcher, gate.PRE_TOOL_MATCHER);
assert.ok(wired.hooks.PreToolUse[0].hooks[0].command.includes(path.join(__dirname, '..', 'modules', 'directorWorkGate.js')));
assert.ok(wired.hooks.PreToolUse[0].hooks[0].command.startsWith(`'${process.execPath}' `));
assert.ok(wired.hooks.Stop[0].hooks[0].command.endsWith(` stop '${gatePath}'`));
assert.ok(args.indexOf('--tools') < args.indexOf('--') && args.indexOf('--settings') < args.indexOf('--'));
assert.strictEqual(args[args.length - 1], 'hello');
let written = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
assert.strictEqual(written.request, WORK_REQUEST);
assert.strictEqual(written.work, true);
assert.ok(written.at);
assert.strictEqual(fs.statSync(gatePath).mode & 0o777, 0o600);
t.claudeCliArgs('chat-1', tmp, Object.assign({}, prepared, { userText: 'hi Yozora' }), 'claude', 'medium');
written = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
assert.strictEqual(written.request, 'hi Yozora');
assert.strictEqual(written.work, false);

// the prompts: the hand-over is structural and near the top; a work request carries the nudge
const chat = { id: 'chat-1', runtime: 'claude' };
const standing = t.buildTurn(chat, 'hello', [], '', {}).standing.split('\n');
assert.ok(/^You are Yozora/.test(standing[0]));
assert.ok(!/same access as a host Claude Code session/.test(standing[0]));
assert.ok(/Fleet sessions under the Supervisor change the code/.test(standing[0]));
assert.ok(/read-only: a hook refuses edits, commits, builds, restarts/.test(standing[1]));
assert.ok(/^Claude fleet: /.test(standing[2]));
assert.ok(!/Commands are already approved/.test(standing.join('\n')));
assert.ok(/Read-only commands need no permission/.test(standing.join('\n')));
['claude', 'tokenrouter', 'cursor'].forEach((rt) => assert.ok(!/same access/.test(t.xiIdentityLine(rt)), rt));
assert.ok(t.buildTurn(chat, WORK_REQUEST, [], '', {}).turn.includes('This request is work for the Supervisor: hand it over in this turn with claude_dispatch'));
assert.ok(!t.buildTurn(chat, 'how are you', [], '', {}).turn.includes('This request is work for the Supervisor'));
const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
fs.mkdirSync(path.join(ws, '.cursor', 'rules'), { recursive: true });
fs.writeFileSync(path.join(ws, '.cursor', 'rules', 'a.mdc'), '---\nalwaysApply: true\n---\nRULE-A\n');
const projectPrompt = t.claudeProjectPrompt(ws);
assert.ok(projectPrompt.startsWith('## Project rules (what the Fleet sessions you brief work under)\nThese rules bind the sessions you hand work to; name the ones that apply in each brief. They do not make you the one who edits, builds or commits.'));
assert.ok(projectPrompt.indexOf('RULE-A') > projectPrompt.indexOf('## Project rules'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('test-director-work-gate: ok');
