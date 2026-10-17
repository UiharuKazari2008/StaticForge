// modules/runtimeDataPaths.js: path resolution and the one-time, non-destructive migration.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const rdp = require('../modules/runtimeDataPaths');

const home = os.homedir();
assert.strictEqual(rdp.getDataRoot({}, {}), path.join(home, 'dreamscape-data'));
assert.strictEqual(rdp.resolveApocryphaDir({}, {}), path.join(home, 'dreamscape-data', 'apocrypha'));
assert.strictEqual(rdp.resolveApocryphaDir({ DREAMSCAPE_DATA_DIR: '/srv/ds' }, {}), '/srv/ds/apocrypha');
assert.strictEqual(rdp.resolveApocryphaDir({}, { dataDir: '~/x' }), path.join(home, 'x', 'apocrypha'));
assert.strictEqual(rdp.resolveApocryphaDir({}, { apocrypha: { dataDir: '/a/b' } }), '/a/b');
assert.strictEqual(rdp.resolveApocryphaDir({ APOCRYPHA_DATA_DIR: '/env/a' }, { apocrypha: { dataDir: '/a/b' } }), '/env/a');
assert.ok(!rdp.resolveApocryphaDir({}, {}).startsWith(path.resolve(__dirname, '..') + path.sep), 'default is outside the repo');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rdp-'));
try {
    const legacy = path.join(tmp, 'legacy'), target = path.join(tmp, 'data', 'apocrypha');
    fs.mkdirSync(path.join(legacy, 'archive'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'current.json'), '{"sections":[]}');
    fs.writeFileSync(path.join(legacy, 'archive', 'old.json'), '{}');
    const quiet = { log() {} };
    assert.strictEqual(rdp.migrateDirOnce(legacy, target, quiet), 'migrated');
    assert.strictEqual(fs.readFileSync(path.join(target, 'current.json'), 'utf8'), '{"sections":[]}');
    assert.ok(fs.existsSync(path.join(target, 'archive', 'old.json')));
    assert.ok(fs.existsSync(path.join(legacy, 'current.json')), 'legacy copy kept');
    fs.writeFileSync(path.join(legacy, 'current.json'), '{"changed":1}');
    assert.strictEqual(rdp.migrateDirOnce(legacy, target, quiet), 'exists');
    assert.strictEqual(fs.readFileSync(path.join(target, 'current.json'), 'utf8'), '{"sections":[]}', 'never overwrites');
    const fresh = path.join(tmp, 'fresh');
    assert.strictEqual(rdp.migrateDirOnce(path.join(tmp, 'nope'), fresh, quiet), 'created');
    assert.ok(fs.existsSync(fresh));
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('test-runtime-data-paths: ok');
