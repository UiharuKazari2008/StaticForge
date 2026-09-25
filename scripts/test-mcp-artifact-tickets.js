const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tickets = require('../modules/mcpArtifactTickets');

const bytes = Buffer.from('webp-fixture');
const remote = tickets.tryWriteSandboxDest('artifacts/shot.webp', bytes);
assert.strictEqual(remote.wrote, false);
assert.strictEqual(remote.reason, 'remote-sandbox');
assert.strictEqual(remote.bytes, bytes.length);

const empty = tickets.tryWriteSandboxDest('artifacts/shot.webp', Buffer.alloc(0), '/tmp');
assert.strictEqual(empty.reason, 'no-bytes');

const missingRoot = tickets.tryWriteSandboxDest('artifacts/shot.webp', bytes, path.join(os.tmpdir(), 'mcp-sandbox-missing-' + Date.now()));
assert.strictEqual(missingRoot.wrote, false);
assert.strictEqual(missingRoot.reason, 'no-sandbox');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sandbox-'));
try {
    const written = tickets.tryWriteSandboxDest('artifacts/shot.webp', bytes, tmpRoot);
    assert.strictEqual(written.wrote, true);
    assert.strictEqual(written.dest_path, 'artifacts/shot.webp');
    assert.ok(fs.existsSync(path.join(tmpRoot, 'artifacts', 'shot.webp')));

    const escaped = tickets.tryWriteSandboxDest('../etc/passwd', bytes, tmpRoot);
    assert.strictEqual(escaped.wrote, false);
    assert.strictEqual(escaped.reason, 'bad-dest');

    const next = tickets.destPathNext('artifacts/shot.webp', false, {
        url: 'https://example.test/a/b/artifacts/ticket',
        reason: 'remote-sandbox'
    });
    assert.ok(next.includes('curl -fsSL https://example.test/a/b/artifacts/ticket -o /home/workdir/artifacts/shot.webp'));
    assert.ok(!next.includes('ensure_artifact'));

    const gr = {
        getMcpPathUuid: () => 'test-uuid-1234',
        getConfig: ({ path: key }) => key === 'public_hostname' ? 'staticforge.737.jp.net' : null
    };
    tickets.resetArtifactTickets();
    const attached = tickets.attachDestPathMeta(gr, { filename: 'keep.png' }, {
        bytes,
        mimeType: 'image/webp'
    }, 'artifacts/shot.webp');
    assert.strictEqual(attached.wrote, false);
    assert.strictEqual(attached.wroteReason, 'remote-sandbox');
    assert.ok(attached.curl.startsWith('curl -fsSL '));
    assert.ok(!attached.next.includes('ensure_artifact'));
} finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    tickets.resetArtifactTickets();
}

console.log('test-mcp-artifact-tickets: ok');
