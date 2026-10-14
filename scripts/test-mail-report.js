'use strict';

// mail-report helper: HTML body, signature, job tail, and a key that never
// shows up in an error. No live send.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const report = require('./mail-report');

function main() {
    const html = report.renderReportHtml('hello');
    assert.ok(html.includes('<pre>hello</pre>'));
    assert.ok(html.includes('Dreamscape job report'));
    assert.strictEqual(report.renderReportHtml(html), html, 'signature is not doubled');
    const already = report.renderReportHtml('<p>note</p>');
    assert.ok(already.startsWith('<p>note</p>'));
    assert.ok(already.includes('-- Cursor'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-report-'));
    const jsonl = path.join(dir, 'job.jsonl');
    fs.writeFileSync(jsonl, [
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'early' }] } }),
        JSON.stringify({ type: 'result', subtype: 'success', result: 'line one\nfinal tail of the agent' })
    ].join('\n') + '\n');
    const body = report.buildJobReportBody({
        name: 'perf-2',
        rc: 0,
        started: '2026-10-14T12:00:00-04:00',
        ended: '2026-10-14T13:00:00-04:00',
        jsonl: jsonl
    });
    assert.ok(body.includes('Job: perf-2'));
    assert.ok(body.includes('Exit: 0'));
    assert.ok(body.includes('Started: 2026-10-14T12:00:00-04:00'));
    assert.ok(body.includes('Ended: 2026-10-14T13:00:00-04:00'));
    assert.ok(body.includes('final tail of the agent'));
    assert.ok(body.includes('Dreamscape job report'));
    const short = report.readAgentTail(jsonl, 8);
    assert.strictEqual(short, 'he agent');

    const args = report.parseArgs([
        'node', 'mail-report.js',
        '--subject', 'done',
        '--to', 'sala',
        '--cc', '',
        '--key-file', path.join(dir, 'missing.key')
    ]);
    assert.strictEqual(args.subject, 'done');
    assert.deepStrictEqual(args.to, ['sala']);
    assert.deepStrictEqual(args.cc, []);
    assert.strictEqual(args.keyFile, path.join(dir, 'missing.key'));

    const secret = 'sfapp_SUPERSECRETVALUE';
    const keyFile = path.join(dir, 'cursor.key');
    fs.writeFileSync(keyFile, secret + '\n', { mode: 0o600 });
    const secure = path.join(dir, 'secure.config.json');
    fs.writeFileSync(secure, JSON.stringify({ mcpPathUuid: '11111111-1111-4111-8111-111111111111', other: 'do-not-print' }));
    const endpoint = report.resolveEndpoint(null, secure);
    assert.strictEqual(endpoint, 'http://127.0.0.1:9220/11111111-1111-4111-8111-111111111111/mcp');

    return report.sendJobReport({
        subject: 'should fail closed',
        body: 'x',
        keyFile: keyFile,
        apiBase: 'http://127.0.0.1:1',
        timeoutMs: 500
    }).then(() => {
        throw new Error('closed port should not send');
    }, (err) => {
        const text = String(err && err.message);
        assert.ok(!text.includes(secret), 'error must not contain the key');
        assert.ok(!text.includes('SUPERSECRETVALUE'), 'error must not contain the key');
        assert.ok(!text.includes('do-not-print'));
        console.log('mail-report tests passed');
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
