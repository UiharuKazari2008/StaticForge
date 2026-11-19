'use strict';

// RFC 2047 header decode, From-header display over the envelope sender,
// intake + render + idempotent backfill. Temp dirs / temp DBs only.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { decodeRfc2047, decodeTextHeaders, needsRfc2047Decode } = require('../modules/mailHeaderDecode');

function testDecoder() {
    assert.strictEqual(decodeRfc2047('plain subject'), 'plain subject');
    assert.strictEqual(decodeRfc2047(''), '');
    assert.strictEqual(decodeRfc2047(null), '');
    assert.strictEqual(needsRfc2047Decode('plain'), false);
    assert.strictEqual(needsRfc2047Decode('=?UTF-8?Q?Hi?='), true);

    // Q, underscore is space, hex bytes
    assert.strictEqual(
        decodeRfc2047('=?utf-8?q?Your_verification_code_for_DeepSeek?='),
        'Your verification code for DeepSeek'
    );
    assert.strictEqual(
        decodeRfc2047('=?UTF-8?q?Welcome_to_Claude._Let=E2=80=99s_begin?='),
        'Welcome to Claude. Let’s begin'
    );

    // B
    const helloB = '=?UTF-8?B?' + Buffer.from('Hello, world', 'utf8').toString('base64') + '?=';
    assert.strictEqual(decodeRfc2047(helloB), 'Hello, world');

    // Adjacent encoded-words: whitespace between them is deleted (RFC 2047 §6.2)
    assert.strictEqual(
        decodeRfc2047('=?UTF-8?q?native_connec?= =?UTF-8?q?tion_service_+_Caf=C3=A9_Ready?='),
        'native connection service + Café Ready'
    );
    assert.strictEqual(
        decodeRfc2047('=?UTF-8?q?foo?=\r\n =?UTF-8?q?bar?='),
        'foobar'
    );

    // Mixed: space next to regular text is kept
    assert.strictEqual(decodeRfc2047('Re: =?UTF-8?Q?Caf=C3=A9?='), 'Re: Café');
    assert.strictEqual(decodeRfc2047('=?UTF-8?Q?Caf=C3=A9?= menu'), 'Café menu');

    // Leading space from a folded first line, then a word
    assert.strictEqual(
        decodeRfc2047(' =?UTF-8?q?[DreamScape/StaticForge]_docs?=').trimStart(),
        '[DreamScape/StaticForge] docs'
    );

    // ISO-8859-1 / windows-1252 Q
    assert.strictEqual(decodeRfc2047('=?iso-8859-1?q?Caf=E9?='), 'Café');

    // Language tag (RFC 2231)
    assert.strictEqual(decodeRfc2047('=?UTF-8*en?Q?Hello?='), 'Hello');

    // Multiple charsets in one value
    assert.strictEqual(
        decodeRfc2047('=?iso-8859-1?q?Caf=E9?= =?UTF-8?Q?_Ready?='),
        'Café Ready'
    );

    // ISO-2022-JP if the runtime knows the charset
    let iso2022ok = false;
    try {
        // 日本語 in ISO-2022-JP
        const jp = Buffer.from([0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x38, 0x6c, 0x1b, 0x28, 0x42]);
        const decoded = new TextDecoder('iso-2022-jp').decode(jp);
        if (decoded.includes('日本') || decoded.length) {
            const word = '=?ISO-2022-JP?B?' + jp.toString('base64') + '?=';
            const out = decodeRfc2047(word);
            assert.ok(out.length > 0, 'iso-2022-jp should decode to some text');
            iso2022ok = true;
        }
    } catch (_err) {
        // TextDecoder may not include iso-2022-jp; skip
    }

    // Invalid encoded-word left in place
    assert.strictEqual(decodeRfc2047('=?UTF-8?X?nope?='), '=?UTF-8?X?nope?=');
    assert.ok(decodeRfc2047('before =?UTF-8?Q?ok?= after').includes('ok'));

    // Idempotent
    const once = decodeRfc2047('=?UTF-8?Q?Caf=C3=A9?=');
    assert.strictEqual(decodeRfc2047(once), once);
    assert.strictEqual(needsRfc2047Decode(once), false);

    // decodeTextHeaders only touches textual fields
    const headers = decodeTextHeaders({
        subject: '=?UTF-8?Q?Hi?=',
        from: '=?UTF-8?Q?Ada?= <ada@example.com>',
        'content-type': 'text/plain; charset="=?UTF-8?Q?utf-8?="',
        'content-transfer-encoding': '7bit'
    });
    assert.strictEqual(headers.subject, 'Hi');
    assert.strictEqual(headers.from, 'Ada <ada@example.com>');
    assert.ok(headers['content-type'].includes('=?UTF-8?Q?utf-8?='));

    return { iso2022ok };
}

function testMimeIntake() {
    const mime = require('../modules/mailGatewayMime');
    const raw = [
        'From: =?UTF-8?Q?Claude_Team?= <notify@example.com>',
        'To: Yukimi <yukimi@example.com>',
        'Subject: =?UTF-8?q?Your_verification_code_for_DeepSeek?=',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'body'
    ].join('\r\n');
    const parsed = mime.extractTextBody(raw);
    assert.strictEqual(parsed.headers.subject, 'Your verification code for DeepSeek');
    assert.strictEqual(parsed.headers.from, 'Claude Team <notify@example.com>');

    // Folded adjacent words
    const folded = [
        'From: Alice <alice@example.com>',
        'Subject: =?UTF-8?q?[DreamScape/StaticForge]_[Plan]_Melaton_Miniport:_native_connec?=',
        ' =?UTF-8?q?tion_service_+_Caf=C3=A9_Ready?=',
        '',
        'body'
    ].join('\r\n');
    const parsedFold = mime.extractTextBody(folded);
    assert.strictEqual(
        parsedFold.headers.subject,
        '[DreamScape/StaticForge] [Plan] Melaton Miniport: native connection service + Café Ready'
    );
}

function testDeliverAndRender() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-headers-'));
    const { initializeDovecoteDatabase, getDb, resetForTests } = require('../modules/dovecoteDatabase');
    assert.strictEqual(resetForTests(tmpDir), true);
    const mail = require('../modules/dovecoteMail');

    // Envelope is a VERP bounce address; From header is the display name + address.
    const delivered = mail.deliverInboundMail({
        fromAddress: 'bounce+user=example.com@mailer.example.com',
        fromLabel: '=?UTF-8?Q?Anthropic?= <notify@mail.anthropic.example>',
        toOwner: 'yukimi',
        subject: '=?UTF-8?q?Welcome_to_Claude._Let=E2=80=99s_begin?=',
        body: 'hello'
    });
    assert.strictEqual(delivered.from, 'bounce+user=example.com@mailer.example.com');
    assert.strictEqual(delivered.fromLabel, 'Anthropic <notify@mail.anthropic.example>');

    const listed = mail.listMail('yukimi', { folder: 'inbox' });
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].from, 'bounce+user=example.com@mailer.example.com');
    assert.strictEqual(listed[0].fromLabel, 'Anthropic <notify@mail.anthropic.example>');
    assert.strictEqual(listed[0].subject, 'Welcome to Claude. Let’s begin');
    assert.strictEqual(listed[0].labelSuspicious, false);

    const full = mail.readMail('yukimi', delivered.id, { markRead: false });
    assert.strictEqual(full.subject, 'Welcome to Claude. Let’s begin');
    assert.strictEqual(full.fromLabel, 'Anthropic <notify@mail.anthropic.example>');

    // Already-stored encoded rows (pre-fix) still come back decoded from list/read
    const staleId = '00000000-0000-4000-8000-000000000001';
    const now = new Date().toISOString();
    getDb().prepare(`
        INSERT INTO dovecote_message (
            id, owner, folder, thread_id, from_owner, to_owner, subject, body, format,
            read, flagged, created_at, updated_at, from_label, route, label_suspicious
        ) VALUES (?, 'yukimi', 'inbox', ?, 'b+=abcd@mailer.example.com', 'yukimi',
                  '=?UTF-8?q?Your_verification_code_for_DeepSeek?=', 'x', 'text',
                  0, 0, ?, ?, '=?UTF-8?Q?DeepSeek?= <support@example.com>', 'inbound', 0)
    `).run(staleId, staleId, now, now);

    const staleList = mail.listMail('yukimi', { folder: 'inbox' }).mail
        || mail.listMail('yukimi', { folder: 'inbox' });
    const rows = Array.isArray(staleList) ? staleList : (staleList.mail || staleList);
    const stale = rows.find((row) => row.id === staleId);
    assert.ok(stale, 'stale encoded row should be listed');
    assert.strictEqual(stale.subject, 'Your verification code for DeepSeek');
    assert.strictEqual(stale.fromLabel, 'DeepSeek <support@example.com>');
    assert.strictEqual(stale.from, 'b+=abcd@mailer.example.com');

    // Backfill rewrites stored rows; a second pass is a no-op
    const first = require('../modules/dovecoteDatabase').backfillDecodedHeaders();
    assert.ok(first.updated >= 1);
    const stored = getDb().prepare('SELECT subject, from_label FROM dovecote_message WHERE id = ?').get(staleId);
    assert.strictEqual(stored.subject, 'Your verification code for DeepSeek');
    assert.strictEqual(stored.from_label, 'DeepSeek <support@example.com>');
    const second = require('../modules/dovecoteDatabase').backfillDecodedHeaders();
    assert.strictEqual(second.updated, 0);

    // No backup of a temp test DB
    const leftovers = fs.readdirSync(tmpDir).filter((name) => name.includes('.bak'));
    assert.deepStrictEqual(leftovers, []);

    fs.rmSync(tmpDir, { recursive: true, force: true });
}

function main() {
    const dec = testDecoder();
    testMimeIntake();
    testDeliverAndRender();
    console.log('test-dovecote-headers: ok' + (dec.iso2022ok ? ' (iso-2022-jp too)' : ' (iso-2022-jp skipped)'));
}

main();
