#!/usr/bin/env node
'use strict';

/**
 * Tests for modules/permissionPromptPolicy.js (#1351): which Claude Code permission prompts the Supervisor may answer.
 * Plain node + assert, no network, no real state (opts.repoRoot is given so no .git lookup happens).
 *
 *   node scripts/test-permission-prompt-policy.js
 */

const assert = require('assert');
const policy = require('../modules/permissionPromptPolicy');

const OPTS = { cwd: '/home/kanmi/staticforge', home: '/home/kanmi', repoRoot: '/home/kanmi/staticforge' };
const SCR = '/tmp/claude-1000/-home-kanmi-staticforge/abc/scratchpad';

let count = 0;
let failed = 0;

function bashPrompt(cmd, desc) {
    const lines = ['Bash command'];
    for (const l of String(cmd).split('\n')) lines.push('   ' + l);
    if (desc) lines.push('   ' + desc);
    lines.push('This command requires approval');
    return {
        question: 'Do you want to proceed?',
        options: [{ n: 1, text: 'Yes', on: true }, { n: 2, text: 'No', on: false }],
        context: lines,
    };
}

function check(name, got, want, reasonRe) {
    count++;
    try {
        assert.strictEqual(got.decision, want, `decision ${got.decision} (${got.reason}) != ${want}`);
        if (reasonRe) assert.ok(reasonRe.test(got.reason), `reason "${got.reason}" does not match ${reasonRe}`);
        console.log(`ok ${count} - ${name}`);
    } catch (e) {
        failed++;
        console.log(`not ok ${count} - ${name}: ${e.message}`);
    }
}

function bash(name, cmd, want, reasonRe, opts) {
    const r = policy.decide(bashPrompt(cmd, 'Do the thing'), opts || OPTS);
    check(name, r, want, reasonRe);
    return r;
}

function edit(name, q, want, reasonRe) {
    const r = policy.decide({ question: q, options: [{ n: 1, text: 'Yes' }, { n: 2, text: 'No' }], context: ['Edit file', '   x'] }, OPTS);
    check(name, r, want, reasonRe);
    return r;
}

function tool(name, lines, want, reasonRe) {
    const r = policy.decide({ question: 'Do you want to proceed?', options: [{ n: 1, text: 'Yes' }, { n: 2, text: 'No' }], context: ['Tool use'].concat(lines) }, OPTS);
    check(name, r, want, reasonRe);
    return r;
}

// ---------------------------------------------------------------------------------------------------- splitCommand
function split(name, s, want) {
    count++;
    try {
        assert.deepStrictEqual(policy.splitCommand(s), want);
        console.log(`ok ${count} - ${name}`);
    } catch (e) {
        failed++;
        console.log(`not ok ${count} - ${name}: ${e.message}`);
    }
}

split('split: and/or/semicolon/pipe', 'a && b || c ; d | e', ['a', 'b', 'c', 'd', 'e']);
split('split: quoted operators stay', 'echo "a && b" ; echo \'c | d\'', ['echo "a && b"', "echo 'c | d'"]);
split('split: newline and background', 'a\nb &\nc', ['a', 'b', 'c']);
split('split: redirects 2>&1 and &> are not separators', 'cmd 2>&1 | tee x &> y', ['cmd 2>&1', 'tee x &> y']);
split('split: command substitution is one segment', 'echo $(a && b) && c', ['echo $(a && b)', 'c']);
split('split: heredoc body is data', "cat > f <<'EOF'\na && rm -rf /\nEOF\nls", ["cat > f <<'EOF'", 'ls']);

// ---------------------------------------------------------------------------------------------------- bash approve
const sample = policy.decide({
    question: 'Do you want to proceed?',
    options: [{ n: 1, text: 'Yes', on: true }, { n: 2, text: 'No', on: false }],
    context: ['Bash command', '   git -C /home/kanmi/staticforge status', '   Show status', 'This command requires approval'],
}, OPTS);
check('bash: the brief sample (description line dropped)', sample, 'approve');
assert.strictEqual(sample.kind, 'bash');
assert.strictEqual(sample.command, 'git -C /home/kanmi/staticforge status');
assert.strictEqual(sample.approveN, 1);
assert.strictEqual(sample.declineN, 2);

bash('approve: git status/diff/log', 'git status && git diff --stat && git log --oneline -5', 'approve');
bash('approve: git add commit push', 'git add -A && git commit -m "fix: x" && git push origin main', 'approve');
bash('approve: git push -u origin branch', 'git push -u origin wip/agent-1', 'approve');
bash('approve: git checkout branch / switch', 'git checkout feature-x && git switch main', 'approve');
bash('approve: git checkout -b', 'git checkout -b feature-y', 'approve');
bash('approve: git fetch plain', 'git fetch origin', 'approve');
bash('approve: git config --get', 'git config --get user.name', 'approve');
bash('approve: git blame / ls-files / rev-parse', 'git blame -L1,5 modules/x.js; git ls-files | head; git rev-parse HEAD', 'approve');
bash('approve: git branch listing', 'git branch -a', 'approve');
bash('approve: git restore --staged', 'git restore --staged modules/x.js', 'approve');
bash('approve: node and npm', 'node --check modules/x.js && npm test && npm run build && npm ci', 'approve');
bash('approve: node script with args', 'node scripts/check-perf-rules.js --update', 'approve');
bash('approve: npx and python', 'npx eslint . && python3 -I scripts/x.py', 'approve');
bash('approve: bash script under repo', 'bash scripts/reload-server-module.sh modules/x.js', 'approve');
bash('approve: relative script exec', './scripts/aemu-lane/lane.sh aemu-fold-1 status', 'approve');
bash('approve: read-only shell', 'ls -la modules | head -20 && cat package.json | jq .name && grep -rn foo modules | wc -l', 'approve');
bash('approve: sed -n and awk print', "sed -n '1,20p' modules/x.js | awk '{print $1}'", 'approve');
bash('approve: find without delete', 'find modules -name "*.js" -newer package.json', 'approve');
bash('approve: find -exec grep', 'find modules -name "*.js" -exec grep -l foo {} \\;', 'approve');
bash('approve: mkdir touch cp mv inside cwd', 'mkdir -p tmp/x && touch tmp/x/a && cp tmp/x/a tmp/x/b && mv tmp/x/b tmp/x/c', 'approve');
bash('approve: tee and redirects into cwd', 'echo hi | tee out.txt > /dev/null && echo x >> notes.log 2>&1', 'approve');
bash('approve: write into the scratchpad', `echo data > ${SCR}/a.txt && cp a.txt ${SCR}/b.txt`, 'approve');
bash('approve: cd + git', 'cd /home/kanmi/staticforge && git status', 'approve');
bash('approve: curl localhost', 'curl -s http://localhost:3000/api/health', 'approve');
bash('approve: curl yozora with header var-free', 'curl -sS -X POST https://yozora.bluesteel.737.jp.net/api/v1/repos/DreamScape/StaticForge/issues -d \'{"title":"x"}\'', 'approve');
bash('approve: curl 127.0.0.1 -o scratchpad', `curl -o ${SCR}/x.json http://127.0.0.1:8080/x`, 'approve');
bash('approve: sqlite3 read', 'sqlite3 data/app.db "SELECT count(*) FROM t"', 'approve');
bash('approve: tmux capture-pane / list', 'tmux capture-pane -p -t main && tmux list-sessions', 'approve');
bash('approve: env with command', 'env NODE_ENV=test node scripts/x.js', 'approve');
bash('approve: echo HOME and which', 'echo $HOME && which node && pwd && date', 'approve');
bash('approve: ps / du / df / stat', 'ps aux | grep node | head -3; du -sh .; df -h; stat package.json', 'approve');
bash('approve: rm -rf inside cwd', 'rm -rf node_modules/.cache build', 'approve');
bash('approve: rm -rf in the scratchpad', `rm -rf ${SCR}/old`, 'approve');
bash('approve: rm -rf under opts.scratch', 'rm -rf /srv/scratch/run1', 'approve', null, Object.assign({}, OPTS, { scratch: '/srv/scratch' }));
bash('approve: find -delete below cwd subdir', 'find tmp -name "*.tmp" -delete', 'approve');
bash('approve: pm2 list/logs', 'pm2 list && pm2 logs --nostream --lines 20', 'approve');
bash('approve: for loop and test', 'for f in modules/*.js; do node --check "$f"; done', 'approve');
bash('approve: if / [ ] construct', 'if [ -f package.json ]; then echo yes; fi', 'approve');
bash('approve: variable assignment from substitution', 'SHA=$(git rev-parse HEAD) && echo "$SHA"', 'approve');
bash('approve: subshell with cd', '(cd modules && ls)', 'approve');
bash('approve: timeout wrapper', 'timeout 20 node scripts/x.js', 'approve');
bash('approve: kill of a pid this command started', 'node server.js & pid=$!; sleep 1; kill $pid', 'approve');
bash('approve: bash -c with safe inner', "bash -c 'cd modules && git status'", 'approve');
bash('approve: heredoc to cat file', "cat > notes.md <<'EOF'\nhello world\nEOF", 'approve');
bash('approve: python heredoc', "python3 - <<'PY'\nprint('hi')\nPY", 'approve');
bash('approve: commit with heredoc message', "git commit -m \"$(cat <<'EOF'\nfix(x): y\n\nbody text\nEOF\n)\"", 'approve');
bash('approve: quoted && is data', 'echo "a && rm -rf /"', 'approve');
bash('approve: chmod +x inside repo', 'chmod +x scripts/new.sh', 'approve');
bash('approve: xargs with a read-only command', 'git ls-files | xargs grep -l foo', 'approve');

// ---------------------------------------------------------------------------------------------------- adb
bash('adb: emulator-5554 write ok', 'adb -s emulator-5554 install -r app.apk', 'approve');
bash('adb: emulator-5570 write denied', 'adb -s emulator-5570 install -r app.apk', 'deny', /another session/);
bash('adb: emulator-5580 write denied', 'adb -s emulator-5580 shell input tap 1 1', 'deny', /another session/);
bash('adb: A53 write ok', 'adb -s R5CT71TSEMZ shell input keyevent 4', 'approve');
bash('adb: write without -s denied', 'adb install -r app.apk', 'deny', /Fold|pin it with -s/);
bash('adb: shell input without -s denied', 'adb shell input tap 10 10', 'deny', /pin it with -s/);
bash('adb: other serial denied', 'adb -s 192.168.1.50:5555 shell input tap 1 1', 'deny', /off limits/);
bash('adb: read-only devices', 'adb devices', 'approve');
bash('adb: read-only dumpsys no -s', 'adb shell dumpsys battery', 'approve');
bash('adb: read-only getprop/logcat on foreign emulator', 'adb -s emulator-5570 shell getprop ro.build.version.sdk', 'approve');
bash('adb: dumpsys battery set is a write', 'adb shell dumpsys battery set level 5', 'deny');
bash('adb: pipeline of read-only shell', 'adb shell "dumpsys window | grep mCurrentFocus"', 'approve');
bash('adb: pm list packages ok', 'adb shell pm list packages -3', 'approve');
bash('adb: logcat -d ok', 'adb logcat -d | tail -50', 'approve');
bash('adb: connect denied', 'adb connect 10.0.0.5:5555', 'deny', /another machine/);
bash('adb: kill-server denied', 'adb kill-server', 'deny');
bash('adb: wrapper a53.sh ok', '~/.config/a53/a53.sh shell getprop', 'approve');
bash('adb: lane.sh on a foreign emulator denied', 'scripts/aemu-lane/lane.sh x -s emulator-5570 install a.apk', 'deny');

// ---------------------------------------------------------------------------------------------------- bash deny
bash('deny: ~/.secrets', 'cat ~/.secrets/yozora-claude.token', 'deny', /secret/);
bash('deny: .cache/secrets listing', 'ls /home/kanmi/staticforge/.cache/secrets', 'deny', /secret/);
bash('deny: .env', 'cat .env', 'deny', /secret/);
bash('deny: id_rsa and .ssh', 'cat ~/.ssh/id_rsa', 'deny', /secret/);
bash('deny: ruiko-windows-pin', 'cat ruiko-windows-pin', 'deny', /secret/);
bash('deny: echo of a token variable', 'echo $YOZORA_TOKEN', 'deny', /secret/);
bash('deny: curl with token file', 'curl -H "Authorization: token $(cat ~/.secrets/x.token)" http://localhost/x', 'deny', /secret/);
bash('deny: literal token in the command', 'curl -H "Authorization: token ghp_abcdefghijklmnopqrstuvwxyz0123456789" http://localhost/x', 'deny', /literal token/);
bash('deny: bare env dump', 'env | sort', 'deny', /every variable/);
bash('deny: printenv without name', 'printenv', 'deny');
bash('deny: git push --force', 'git push --force origin main', 'deny', /force-pushes/);
bash('deny: git push -f', 'git push -f origin main', 'deny', /force-pushes/);
bash('deny: git push -fu', 'git push -fu origin main', 'deny', /force-pushes/);
bash('deny: git push --force-with-lease', 'git push --force-with-lease origin main', 'deny', /force-pushes/);
bash('deny: git push +refspec', 'git push origin +HEAD:main', 'deny', /force-pushes/);
bash('deny: git push delete', 'git push origin :old-branch', 'deny', /deletes/);
bash('deny: --no-verify commit', 'git commit --no-verify -m x', 'deny', /hooks/);
bash('deny: commit -n', 'git commit -nm x', 'deny', /hooks/);
bash('deny: git stash', 'git stash push -- modules/x.js', 'deny', /stash/);
bash('deny: git reset --hard', 'git reset --hard origin/main', 'deny');
bash('deny: git clean -fd', 'git clean -fd', 'deny', /clean/);
bash('deny: git checkout -- .', 'git checkout -- .', 'deny', /discard/);
bash('deny: git checkout .', 'git checkout .', 'deny', /discard/);
bash('deny: git restore . wholesale', 'git restore .', 'deny', /discard/);
bash('deny: git pull in the live tree', 'git pull --rebase origin main', 'deny', /live/);
bash('deny: git rebase in the live tree', 'git rebase origin/main', 'deny', /live/);
bash('deny: git merge origin in the live tree', 'git merge origin/main', 'deny', /live/);
bash('approve: git pull outside the live tree', 'git pull --ff-only', 'approve', null, { cwd: '/home/kanmi/other', home: '/home/kanmi', repoRoot: '/home/kanmi/other' });
bash('deny: git -c core.hooksPath', 'git -c core.hooksPath=/dev/null commit -m x', 'deny');
bash('deny: HUSKY=0 commit', 'HUSKY=0 git commit -m x', 'deny', /hooks/);
bash('deny: rm -rf /', 'rm -rf /', 'deny', /reaches outside/);
bash('deny: rm -rf the cwd itself', 'rm -rf /home/kanmi/staticforge', 'deny');
bash('deny: rm -rf .', 'rm -rf .', 'deny');
bash('deny: rm -rf *', 'rm -rf *', 'deny');
bash('deny: rm -rf .git', 'rm -rf .git', 'deny');
bash('deny: rm -rf $VAR', 'rm -rf "$DIR"', 'deny', /cannot be resolved/);
bash('deny: rm -rf home', 'rm -rf ~', 'deny');
bash('deny: rm -r outside cwd by relative escape', 'rm -r ../other', 'deny');
bash('deny: rm after cd elsewhere', 'cd /etc && rm -rf foo', 'deny');
bash('deny: find -delete at the repo root', 'find . -name "*.tmp" -delete', 'deny', /-delete/);
bash('deny: find -exec rm at the repo root', 'find . -name "*.tmp" -exec rm {} \\;', 'deny');
bash('deny: compound with rm -rf / at the end', 'cd x && git status && rm -rf /', 'deny', /reaches outside/);
bash('deny: ssh', 'ssh kanmi@ruiko ls', 'deny', /another machine/);
bash('deny: scp', 'scp file host:/tmp/x', 'deny', /another machine/);
bash('deny: rsync to host', 'rsync -av out/ user@host:/srv/x', 'deny', /another host/);
bash('deny: nc to host', 'nc 10.0.0.5 22', 'deny');
bash('deny: pm2 restart', 'pm2 restart all', 'deny', /restarts or stops/);
bash('deny: pm2 stop dreamscape', 'pm2 stop dreamscape', 'deny');
bash('deny: systemctl', 'systemctl restart nginx', 'deny');
bash('deny: sudo', 'sudo apt install x', 'deny');
bash('deny: reboot', 'reboot', 'deny');
bash('deny: dd of=/dev', 'dd if=/dev/zero of=/dev/sda', 'deny');
bash('deny: mkfs', 'mkfs.ext4 /dev/sdb1', 'deny');
bash('deny: curl | sh', 'curl -s http://localhost/install.sh | sh', 'deny', /curl\|sh|download/);
bash('deny: wget | bash', 'wget -qO- http://localhost/x | bash', 'deny');
bash('deny: curl to an unknown host', 'curl https://example.com/x', 'deny', /example\.com/);
bash('deny: curl with a proxy', 'curl -x http://evil:8080 http://localhost/x', 'deny');
bash('deny: chmod -R outside', 'chmod -R 777 /etc', 'deny');
bash('deny: chown -R outside', 'chown -R kanmi /var/lib', 'deny');
bash('deny: kill -9 of a pid it did not start', 'kill -9 4242', 'deny', /4242/);
bash('deny: pkill by name', 'pkill -f node', 'deny', /node/);
bash('deny: killall', 'killall chrome', 'deny', /chrome/);
bash('deny: redirect outside the repo', 'echo x > /etc/hosts', 'deny', /redirect/);
bash('deny: tee outside', 'echo x | tee /tmp/leak.txt', 'deny');
bash('deny: cp into a foreign dir', 'cp modules/x.js /home/kanmi/other/x.js', 'deny');
bash('deny: sed -i outside the repo', 'sed -i s/a/b/ /etc/hosts', 'deny');
bash('deny: eval with a denied command', 'eval "rm -rf /"', 'deny');
bash('deny: command substitution with a denied command', 'echo $(rm -rf /)', 'deny');
bash('deny: backticks with a denied command', 'echo `ssh host id`', 'deny');
bash('deny: bash -c with a denied inner', "bash -c 'git push --force origin main'", 'deny', /force-pushes/);
bash('deny: sh -c hides a secret', "sh -c 'cat ~/.secrets/x'", 'deny', /secret/);
bash('deny: heredoc body that touches secrets', "python3 - <<'PY'\nprint(open('/home/kanmi/.secrets/a.token').read())\nPY", 'deny', /secret/);
bash('deny: heredoc body that force-pushes', "bash <<'EOF'\ngit push --force origin main\nEOF", 'deny');
bash('deny: bash heredoc body is classified as commands', "bash <<'EOF'\nrm -rf /\nEOF", 'deny');
bash('deny: computed command name', '$CMD arg', 'deny', /computed/);
bash('deny: unclosed quote', 'echo "abc', 'deny', /unclosed/);
bash('deny: python reading stdin via bash pipe', 'echo ls | bash', 'deny');
bash('deny: xargs rm', 'ls | xargs rm -rf', 'deny', /xargs/);
bash('deny: tmux send-keys', 'tmux send-keys -t main "rm -rf /" Enter', 'deny', /tmux/);
bash('deny: sqlite3 write', 'sqlite3 data/app.db "DELETE FROM t"', 'deny');
bash('deny: npm install -g', 'npm install -g foo', 'deny');
bash('deny: npm publish', 'npm publish', 'deny');
bash('deny: unknown command', 'frobnicate --all', 'deny', /not recognised as repo work \(frobnicate\)/);
bash('deny: ruby is not on the list', 'ruby -e "puts 1"', 'deny', /not recognised/);
bash('deny: docker run', 'docker run --rm alpine sh', 'deny', /not recognised/);

// ---------------------------------------------------------------------------------------------------- hers
bash('hers: gh auth login', 'gh auth login', 'hers');
bash('hers: npm login', 'npm login', 'hers');
bash('hers: docker login', 'docker login registry.example.com', 'hers');
bash('hers: gcloud auth', 'gcloud auth application-default login', 'hers');
bash('hers: --paid flag', 'node scripts/upscale.js --paid', 'hers');
bash('hers: userApprovedPaidRequest in a curl body', 'curl -X POST http://localhost:3000/mcp -d \'{"userApprovedPaidRequest":true}\'', 'hers');
bash('hers: billing url', 'curl -X POST http://localhost:3000/billing/checkout', 'hers');
bash('hers: creating an account', 'useradd newbie', 'hers');
bash('hers: wins over a later deny', 'gh auth login && rm -rf /', 'hers');

// ---------------------------------------------------------------------------------------------------- edits
edit('edit: file inside cwd', 'Do you want to make this edit to modules/foo.js?', 'approve');
edit('edit: absolute file inside cwd', 'Do you want to make this edit to /home/kanmi/staticforge/public/scripts/a.js?', 'approve');
edit('edit: create inside cwd', 'Do you want to create scripts/new-test.js?', 'approve');
edit('edit: overwrite inside cwd', 'Do you want to overwrite docs/x.md?', 'approve');
edit('edit: file in the scratchpad', `Do you want to make this edit to ${SCR}/plan.md?`, 'approve');
edit('edit: outside cwd denied', 'Do you want to make this edit to /home/kanmi/other/x.js?', 'deny', /outside the repo/);
edit('edit: /etc denied', 'Do you want to make this edit to /etc/hosts?', 'deny');
edit('edit: relative escape denied', 'Do you want to make this edit to ../x/y.js?', 'deny');
edit('edit: secrets path denied', 'Do you want to make this edit to /home/kanmi/.secrets/yozora-claude.token?', 'deny', /secrets/);
edit('edit: .env inside cwd denied', 'Do you want to make this edit to .env?', 'deny', /secrets/);
edit('edit: .git internals denied', 'Do you want to make this edit to .git/hooks/pre-commit?', 'deny', /\.git/);
edit('edit: claude settings denied', 'Do you want to make this edit to .claude/settings.local.json?', 'deny', /permission settings/);
{
    const r = policy.decide({ question: 'Do you want to make this edit to modules/foo.js?', options: [], context: [] }, OPTS);
    assert.strictEqual(r.kind, 'edit');
    assert.strictEqual(r.command, 'modules/foo.js');
}

// ---------------------------------------------------------------------------------------------------- fetch
function fetchP(name, url, want, reasonRe) {
    const r = policy.decide({ question: `Do you want to allow Claude to fetch this content from ${url}?`, options: [{ n: 1, text: 'Yes' }, { n: 2, text: 'No' }], context: ['Fetch', '   ' + url] }, OPTS);
    check(name, r, want, reasonRe);
    assert.strictEqual(r.kind, 'fetch');
}
fetchP('fetch: localhost', 'http://localhost:3000/api/x', 'approve');
fetchP('fetch: yozora', 'https://yozora.bluesteel.737.jp.net/DreamScape/StaticForge/issues/1351', 'approve');
fetchP('fetch: other host denied', 'https://example.com/page', 'deny', /example\.com/);
fetchP('fetch: token in the query denied', 'http://localhost:3000/x?token=abc', 'deny', /secret/);
fetchP('fetch: billing url is hers', 'http://localhost:3000/billing/checkout', 'hers');

// ---------------------------------------------------------------------------------------------------- MCP tools
tool('tool: agent-coord', ['   mcp__agent-coord__coord_claim({"paths":["modules/x.js"]})'], 'approve');
tool('tool: agent-coord display form', ['   agent-coord - coord_inbox() (MCP)'], 'approve');
tool('tool: yozora write', ['   mcp__yozora__issue_write({"method":"comment","index":1351})'], 'approve');
tool('tool: yozora repo delete denied', ['   mcp__yozora__repo_write({"method":"delete"})'], 'deny');
tool('tool: dreamscape get_ read', ['   mcp__dreamscape__get_session_state({})'], 'approve');
tool('tool: dreamscape list_ read', ['   mcp__dreamscape__list_clients({})'], 'approve');
tool('tool: dreamscape write denied', ['   mcp__dreamscape__restart_client({})'], 'deny', /not on the auto-approve list; ask for it explicitly/);
tool('tool: other mcp denied', ['   mcp__claude_ai_Claude_Docs__create({})'], 'deny', /not on the auto-approve list; ask for it explicitly/);
tool('tool: paid dreamscape request is hers', ['   mcp__dreamscape__upscale_image({"userApprovedPaidRequest":true})'], 'hers');
tool('tool: literal token argument denied', ['   mcp__agent-coord__mem_add({"text":"ghp_abcdefghijklmnopqrstuvwxyz0123456789"})'], 'deny');
tool('tool: unreadable tool name denied', ['   something odd'], 'deny');

// ---------------------------------------------------------------------------------------------------- other and shape
{
    const r = policy.decide({ question: 'Do you want to use the skill graphify?', options: [], context: ['Skill graphify'] }, OPTS);
    check('other: unknown prompt kind is denied', r, 'deny', /not recognised as repo work/);
    assert.strictEqual(r.kind, 'other');
}
{
    const r = policy.decide({ question: 'Do you want to proceed?', options: [{ n: 1, text: 'Yes' }, { n: 2, text: 'Yes, and do not ask again' }, { n: 3, text: 'No' }], context: ['Bash command', '   rm -rf /'] }, OPTS);
    check('options: decline number follows the No option', r, 'deny');
    assert.strictEqual(r.declineN, 3);
    assert.strictEqual(r.approveN, 1);
}
{
    const r = policy.decide({ question: 'Do you want to proceed?', options: [{ n: 1, text: 'Allow once' }, { n: 2, text: 'No' }], context: ['Bash command', '   ls'] }, OPTS);
    check('options: no Yes option leaves it to Yukimi', r, 'hers');
}
{
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const r = policy.decide(bashPrompt(`curl -H "Authorization: token ${secret}" http://localhost/x`, 'Call it'), OPTS);
    count++;
    assert.ok(!r.command.includes(secret), 'token must be masked');
    assert.ok(r.command.includes('***'));
    console.log(`ok ${count} - command masks token values`);
    const long = policy.decide(bashPrompt('echo ' + 'a'.repeat(500), 'Print it'), OPTS);
    count++;
    assert.ok(long.command.length <= 300);
    console.log(`ok ${count} - command is capped at 300 chars`);
    count++;
    assert.strictEqual(policy.maskSecrets('password=hunter2 x'), 'password=*** x');
    console.log(`ok ${count} - maskSecrets masks key=value secrets`);
}
{
    count++;
    const r = policy.decide(null, null);
    assert.ok(['deny', 'hers'].includes(r.decision));
    console.log(`ok ${count} - decide never throws on garbage input`);
    count++;
    assert.ok(/^[\x20-\x7e]*$/.test(r.reason));
    console.log(`ok ${count} - reasons are ASCII`);
}

// ---------------------------------------------------------------------------------------------------- end to end
// pane lines -> claudeSessionLauncher.readPermissionPrompt -> decide (the real shape: footer indented by one)
{
    const launcher = require('../modules/claudeSessionLauncher.js');
    const pane = (cmdLines, desc) => [' Bash command', ''].concat(cmdLines.map((l) => '   ' + l), desc ? ['   ' + desc] : [], ['', ' This command requires approval', ' Do you want to proceed?', ' \u276f 1. Yes', '   2. No', '', ' Esc to cancel']).filter(Boolean);
    const e2e = (name, cmdLines, desc, want, cmdIs) => {
        const prompt = launcher.readPermissionPrompt(pane(cmdLines, desc));
        count++;
        if (!prompt) { failed++; console.log(`not ok ${count} - e2e ${name}: no prompt read`); return; }
        const r = policy.decide(prompt, OPTS);
        try {
            assert.strictEqual(r.decision, want, `decision ${r.decision} (${r.reason})`);
            if (cmdIs !== undefined) assert.strictEqual(r.command, cmdIs);
            console.log(`ok ${count} - e2e ${name}`);
        } catch (er) { failed++; console.log(`not ok ${count} - e2e ${name}: ${er.message}`); }
    };
    e2e('git status + description', ['git -C /home/kanmi/staticforge status'], 'Show working tree status', 'approve', 'git -C /home/kanmi/staticforge status');
    e2e('node | tail + description', ['node scripts/x.js 2>&1 | tail -5'], 'Run the script and show the tail', 'approve');
    e2e('reload script with --why + description', ['bash scripts/reload-server-module.sh modules/x.js --why "y"'], 'Reload the module', 'approve');
    e2e('commit && push + description', ['git commit -m "fix: x" && git push origin main'], 'Commit and push', 'approve');
    e2e('python3 heredoc + description', ["python3 - <<'PY'", "print('hi')", 'PY'], 'Run the snippet', 'approve');
    e2e('force push + description', ['git push --force origin main'], 'Push the branch', 'deny');
    e2e('secret cat + description', ['cat ~/.secrets/x.token'], 'Show the token', 'deny');
    e2e('no description', ['git status'], null, 'approve', 'git status');
    e2e('no description, last line git push is kept', ['git add -A', 'git push origin main'], null, 'approve', 'git add -A ; git push origin main');
    e2e('no description, last line force push is seen', ['git add -A', 'git push --force origin main'], null, 'deny');
    e2e('backslash continuation + description', ['git log \\', '  --oneline -3'], 'Show recent commits', 'approve');
    e2e('multi-line cd/git + description', ['cd modules', 'git status'], 'Status in modules', 'approve');
    e2e('description naming a secret path is not hidden', ['ls'], 'List ~/.secrets', 'deny');
    e2e('single unknown lowercase line is kept and denied', ['frobnicate'], null, 'deny');
}

console.log(`\n${count - failed}/${count} passed`);
process.exit(failed ? 1 : 0);
