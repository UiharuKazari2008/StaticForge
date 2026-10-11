'use strict';
// Boot-time CLI update: version before/after, failure text, config off switch.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const d = require('../modules/cursorDirector')._test;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-update-'));
function fakeCli(name, body) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(file, 0o755);
    return file;
}
const state = path.join(dir, 'version');
fs.writeFileSync(state, '1.0.0');
const bumps = fakeCli('bumps', `if [ "$1" = "--version" ]; then cat ${state}; exit 0; fi\n[ "$1" = "update" ] && echo 1.1.0 > ${state}`);
const current = fakeCli('current', 'if [ "$1" = "--version" ]; then echo "2.0.0 (Claude Code)"; exit 0; fi\nexit 0');
const broken = fakeCli('broken', 'if [ "$1" = "--version" ]; then echo 3.0.0; exit 0; fi\necho "network down" >&2; exit 1');

(async () => {
    const up = await d.runCliUpdate('cursor-agent', bumps, ['update']);
    assert.deepStrictEqual([up.ok, up.before, up.after], [true, '1.0.0', '1.1.0']);
    assert.strictEqual(d.describeCliUpdate(up), 'cursor-agent updated 1.0.0 -> 1.1.0');

    const same = await d.runCliUpdate('claude', current, ['update']);
    assert.strictEqual(d.describeCliUpdate(same), 'claude is current (2.0.0)');

    const bad = await d.runCliUpdate('claude', broken, ['update']);
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(d.describeCliUpdate(bad), 'claude update failed: network down');

    const off = await d.updateAgentClis({ getConfig: () => ({ director: { autoUpdateClis: false } }) });
    assert.strictEqual(d.describeCliUpdate(off[0]), 'CLI updates skipped: disabled in config');

    assert.ok(d.cliAtLeast([2, 1, 280], '2.1.280') && !d.cliAtLeast([2, 1, 197], '2.1.280'));
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('director cli autoupdate: ok');
})().catch((err) => { console.error(err); process.exit(1); });
