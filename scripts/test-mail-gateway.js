'use strict';

const assert = require('assert');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-gateway-'));
const { initializeDovecoteDatabase } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const mail = require('../modules/dovecoteMail');
const gateway = require('../modules/mailGateway');
const addresses = require('../modules/mailGatewayAddresses');

function mapping() {
    return addresses.createMapping({
        mailboxes: addresses.DEFAULT_MAILBOXES,
        domain: addresses.DEFAULT_DOMAIN
    });
}

function writeCert(dir, commonName) {
    fs.mkdirSync(dir, { recursive: true });
    const keyPath = path.join(dir, `${commonName.replace(/[^a-z0-9]+/gi, '_')}.key`);
    const certPath = path.join(dir, `${commonName.replace(/[^a-z0-9]+/gi, '_')}.crt`);
    const result = spawnSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', keyPath, '-out', certPath,
        '-days', '1', '-nodes',
        '-subj', `/CN=${commonName}`,
        '-addext', `subjectAltName=DNS:${commonName}`
    ], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`openssl failed: ${result.stderr || result.stdout}`);
    }
    return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        keyPath,
        certPath
    };
}

function createLineReader(socket) {
    let buffer = '';
    const queue = [];
    let waiters = [];
    socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (waiters.length) waiters.shift()(line);
            else queue.push(line);
        }
    });
    socket.on('end', () => waiters.splice(0).forEach((fn) => fn(null)));
    return {
        readLine() {
            if (queue.length) return Promise.resolve(queue.shift());
            return new Promise((resolve) => waiters.push(resolve));
        }
    };
}

async function readReply(reader) {
    const lines = [];
    while (true) {
        const line = await reader.readLine();
        if (line == null) break;
        lines.push(line);
        if (/^\d{3} /.test(line)) break;
    }
    return { code: lines[0] ? parseInt(lines[0], 10) : 0, lines, text: lines.join('\n') };
}

function startMockSmtp(options) {
    const recorded = { mailFrom: null, rcpt: [], data: '', authed: false, ehloCount: 0 };
    const password = options.password || 'secret';
    const user = options.authUser || 'dreamscape@dream.737.jp.net';
    const advertiseStarttls = options.advertiseStarttls !== false;
    const implicit = options.implicit === true;

    function attachSession(socket, onReady) {
        let reader = createLineReader(socket);
        let secureDone = false;

        async function loop() {
            try {
                socket.write('220 mock ESMTP\r\n');
                while (true) {
                    const line = await reader.readLine();
                    if (line == null) return;
                    const upper = line.toUpperCase();
                    if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
                        recorded.ehloCount += 1;
                        if (advertiseStarttls && !secureDone && !implicit) {
                            socket.write('250-mock\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n');
                        } else {
                            socket.write('250-mock\r\n250 AUTH PLAIN\r\n');
                        }
                    } else if (upper === 'STARTTLS') {
                        if (!advertiseStarttls || implicit) {
                            socket.write('502 STARTTLS not available\r\n');
                            continue;
                        }
                        socket.write('220 ready to start TLS\r\n');
                        socket.removeAllListeners('data');
                        const secure = new tls.TLSSocket(socket, {
                            isServer: true,
                            key: options.key,
                            cert: options.cert
                        });
                        await new Promise((resolve, reject) => {
                            secure.once('secure', resolve);
                            secure.once('error', reject);
                        });
                        secureDone = true;
                        socket = secure;
                        reader = createLineReader(secure);
                    } else if (upper.startsWith('AUTH PLAIN')) {
                        const decoded = Buffer.from(line.slice(11).trim(), 'base64').toString('utf8');
                        const parts = decoded.split('\0');
                        const authUser = parts[1] || '';
                        const authPass = parts[2] || '';
                        if (authUser === user && authPass === password) {
                            recorded.authed = true;
                            socket.write('235 2.7.0 OK\r\n');
                        } else {
                            socket.write('535 5.7.8 Authentication failed\r\n');
                        }
                    } else if (upper.startsWith('MAIL FROM:')) {
                        recorded.mailFrom = (line.match(/<([^>]*)>/) || [])[1] || '';
                        socket.write('250 OK\r\n');
                    } else if (upper.startsWith('RCPT TO:')) {
                        recorded.rcpt.push((line.match(/<([^>]+)>/) || [])[1] || '');
                        socket.write('250 OK\r\n');
                    } else if (upper === 'DATA') {
                        socket.write('354 go\r\n');
                        const chunks = [];
                        while (true) {
                            const dataLine = await reader.readLine();
                            if (dataLine == null || dataLine === '.') break;
                            chunks.push(dataLine.startsWith('.') ? dataLine.slice(1) : dataLine);
                        }
                        recorded.data = chunks.join('\n');
                        socket.write('250 queued\r\n');
                    } else if (upper === 'QUIT') {
                        socket.write('221 bye\r\n');
                        socket.end();
                        return;
                    } else {
                        socket.write('502 unimplemented\r\n');
                    }
                }
            } catch (_err) {
                socket.destroy();
            }
        }

        loop();
        if (onReady) onReady();
    }

    return new Promise((resolve, reject) => {
        const server = implicit
            ? tls.createServer({ key: options.key, cert: options.cert }, (socket) => attachSession(socket))
            : net.createServer((socket) => attachSession(socket));
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                recorded,
                close: () => new Promise((done) => server.close(() => done()))
            });
        });
    });
}

async function smtpTalk(port, script) {
    const socket = await new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port }, () => resolve(s));
        s.on('error', reject);
    });
    const reader = createLineReader(socket);
    const replies = [];
    try {
        replies.push(await readReply(reader));
        for (const command of script) {
            socket.write(`${command}\r\n`);
            replies.push(await readReply(reader));
        }
    } finally {
        socket.end();
    }
    return replies;
}

function testMapping() {
    const map = mapping();
    assert.strictEqual(addresses.toMailbox('sala.ops@dream.737.jp.net', map), 'sala');
    assert.strictEqual(addresses.toMailbox('Menma.Dev@Dream.737.jp.net', map), 'menma');
    assert.strictEqual(addresses.toMailbox('rook.dev@dream.737.jp.net', map), 'rook');
    assert.strictEqual(addresses.toMailbox('cursor.dev@dream.737.jp.net', map), 'cursor');
    assert.strictEqual(addresses.toMailbox('claude.dev@dream.737.jp.net', map), 'claude');
    assert.strictEqual(addresses.toMailbox('frost.dev@dream.737.jp.net', map), 'frost');
    assert.strictEqual(addresses.toMailbox('hoshino.apocrypha@dream.737.jp.net', map), 'hoshino');
    assert.strictEqual(addresses.toMailbox('ivory.studio@dream.737.jp.net', map), 'ivory');
    assert.strictEqual(addresses.toMailbox('guren.lab@dream.737.jp.net', map), 'guren');
    assert.strictEqual(addresses.toMailbox('chiyo.web@dream.737.jp.net', map), 'chiyo');
    assert.strictEqual(addresses.toMailbox('tifa.ops@dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('pyra.dev@dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('unknown@dream.737.jp.net', map), null);
    assert.strictEqual(addresses.toMailbox('menma@gmail.com', map), null);

    assert.strictEqual(addresses.toExternal('sala', map), 'sala.ops@dream.737.jp.net');
    assert.strictEqual(addresses.toExternal('menma', map), 'menma.dev@dream.737.jp.net');
    assert.strictEqual(addresses.toExternal('rook', map), 'rook.dev@dream.737.jp.net');
    assert.strictEqual(addresses.toExternal('tifa', map), null);
    assert.strictEqual(addresses.toExternal('pyra', map), null);
    assert.strictEqual(addresses.toExternal('yukimi', map), null);

    const classified = addresses.classifyRecipients(
        ['rook', 'alice@example.com', 'menma.dev@dream.737.jp.net'],
        'yukimi',
        { mapping: map, enabled: true, isValidOwner: mail.isValidOwner }
    );
    assert.deepStrictEqual(classified.toList, ['rook', 'menma']);
    assert.deepStrictEqual(classified.ccList, ['yukimi']);
    assert.deepStrictEqual(classified.externalTo, ['alice@example.com']);

    assert.throws(
        () => addresses.classifyRecipients('tifa.ops@dream.737.jp.net', [], {
            mapping: map, enabled: true, isValidOwner: mail.isValidOwner
        }),
        (err) => err.code === 'UNKNOWN_RECIPIENT'
    );
}

async function testAllowlistReject() {
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['192.168.255.1'],
        mapping: mapping()
    });
    try {
        const replies = await smtpTalk(inbound.port, []);
        assert.strictEqual(replies[0].code, 554);
        assert.match(replies[0].text, /Connection refused|5\.7\.1/);
    } finally {
        await inbound.close();
    }
}

async function testUnknownRecipientReject() {
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping()
    });
    try {
        const replies = await smtpTalk(inbound.port, [
            'LHLO postfix',
            'MAIL FROM:<alice@example.com>',
            'RCPT TO:<nobody@dream.737.jp.net>',
            'RCPT TO:<tifa.ops@dream.737.jp.net>',
            'RCPT TO:<pyra.dev@dream.737.jp.net>'
        ]);
        assert.strictEqual(replies[0].code, 220);
        assert.strictEqual(replies[1].code, 250);
        assert.strictEqual(replies[2].code, 250);
        assert.strictEqual(replies[3].code, 550);
        assert.strictEqual(replies[4].code, 550);
        assert.strictEqual(replies[5].code, 550);
        assert.match(replies[3].text, /User unknown/);
    } finally {
        await inbound.close();
    }
}

async function testInboundDelivery() {
    const delivered = [];
    const inbound = await gateway.startInbound({
        port: 0,
        bind: '127.0.0.1',
        allowFrom: ['127.0.0.1'],
        mapping: mapping(),
        deliver: async (msg) => { delivered.push(msg); }
    });
    try {
        const socket = await new Promise((resolve, reject) => {
            const s = net.connect({ host: '127.0.0.1', port: inbound.port }, () => resolve(s));
            s.on('error', reject);
        });
        const reader = createLineReader(socket);
        assert.strictEqual((await readReply(reader)).code, 220);
        socket.write('EHLO test\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('MAIL FROM:<Alice <alice@example.com>>\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('RCPT TO:<menma.dev@dream.737.jp.net>\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('DATA\r\n');
        assert.strictEqual((await readReply(reader)).code, 354);
        socket.write('From: Alice <alice@example.com>\r\n');
        socket.write('To: menma.dev@dream.737.jp.net\r\n');
        socket.write('Subject: hello menma\r\n');
        socket.write('\r\n');
        socket.write('body from the outside\r\n');
        socket.write('.\r\n');
        assert.strictEqual((await readReply(reader)).code, 250);
        socket.write('QUIT\r\n');
        await readReply(reader);
        socket.end();
    } finally {
        await inbound.close();
    }
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].fromAddress, 'alice@example.com');
    assert.strictEqual(delivered[0].toOwner, 'menma');
    assert.strictEqual(delivered[0].subject, 'hello menma');
    assert.match(delivered[0].body, /body from the outside/);

    const stored = mail.deliverInboundMail({
        fromAddress: 'bob@outside.example',
        toOwner: 'ivory',
        subject: 'stored full',
        body: 'ping'
    });
    const inbox = mail.listMail('ivory', { folder: 'inbox' });
    assert.strictEqual(inbox[0].from, 'bob@outside.example');
    assert.strictEqual(inbox[0].id, stored.id);
}

async function testOutboundRewrite() {
    const certs = writeCert(tmpDir, 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        advertiseStarttls: true,
        password: 'test-pass'
    });
    try {
        const result = await gateway.submitOutbound({
            fromOwner: 'menma',
            to: ['alice@example.com'],
            cc: ['cc@example.com'],
            subject: 'rewrite me',
            body: 'hello alice',
            smtpPassword: 'test-pass',
            mapping: mapping(),
            outbound: {
                host: '127.0.0.1',
                port: mock.port,
                mode: 'starttls',
                tlsServername: 'mx.dream.737.jp.net',
                caPath: certs.certPath,
                authUser: 'dreamscape@dream.737.jp.net',
                rejectUnauthorized: true
            }
        });
        assert.strictEqual(result.envelopeFrom, 'menma.dev@dream.737.jp.net');
        assert.strictEqual(mock.recorded.mailFrom, 'menma.dev@dream.737.jp.net');
        assert.deepStrictEqual(mock.recorded.rcpt, ['alice@example.com', 'cc@example.com']);
        assert.match(mock.recorded.data, /^From: menma\.dev@dream\.737\.jp\.net/m);
        assert.match(mock.recorded.data, /^Reply-To: menma\.dev@dream\.737\.jp\.net/m);
        assert.match(mock.recorded.data, /^To: alice@example\.com/m);
        assert.match(mock.recorded.data, /hello alice/);
        assert.ok(mock.recorded.authed);
    } finally {
        await mock.close();
    }
}

async function testMissingStarttls() {
    const certs = writeCert(tmpDir, 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        advertiseStarttls: false,
        password: 'test-pass'
    });
    try {
        await assert.rejects(
            () => gateway.submitOutbound({
                fromOwner: 'rook',
                to: ['alice@example.com'],
                subject: 'no tls',
                body: 'x',
                smtpPassword: 'test-pass',
                mapping: mapping(),
                outbound: {
                    host: '127.0.0.1',
                    port: mock.port,
                    mode: 'starttls',
                    tlsServername: 'mx.dream.737.jp.net',
                    caPath: certs.certPath
                }
            }),
            (err) => err.code === 'STARTTLS_REQUIRED' && /STARTTLS is required/.test(err.message)
        );
        assert.strictEqual(mock.recorded.mailFrom, null);
    } finally {
        await mock.close();
    }
}

async function testCertVerificationFailure() {
    const wrong = writeCert(tmpDir, 'wrong.example');
    const expected = writeCert(path.join(tmpDir, 'expected'), 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: wrong.key,
        cert: wrong.cert,
        advertiseStarttls: true,
        password: 'test-pass'
    });
    try {
        await assert.rejects(
            () => gateway.submitOutbound({
                fromOwner: 'guren',
                to: ['alice@example.com'],
                subject: 'bad cert',
                body: 'x',
                smtpPassword: 'test-pass',
                mapping: mapping(),
                outbound: {
                    host: '127.0.0.1',
                    port: mock.port,
                    mode: 'starttls',
                    tlsServername: 'mx.dream.737.jp.net',
                    caPath: expected.certPath
                }
            }),
            (err) => err.code === 'TLS_VERIFY_FAILED'
        );
        assert.strictEqual(mock.recorded.mailFrom, null);
    } finally {
        await mock.close();
    }
}

async function testImplicitTls() {
    const certs = writeCert(path.join(tmpDir, 'implicit'), 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        implicit: true,
        password: 'test-pass'
    });
    try {
        const result = await gateway.submitOutbound({
            fromOwner: 'chiyo',
            to: ['bob@example.com'],
            subject: 'implicit',
            body: 'via 465',
            smtpPassword: 'test-pass',
            mapping: mapping(),
            outbound: {
                host: '127.0.0.1',
                port: mock.port,
                mode: 'implicit',
                tlsServername: 'mx.dream.737.jp.net',
                caPath: certs.certPath
            }
        });
        assert.strictEqual(result.from, 'chiyo.web@dream.737.jp.net');
        assert.strictEqual(mock.recorded.mailFrom, 'chiyo.web@dream.737.jp.net');
        assert.match(mock.recorded.data, /^Reply-To: chiyo\.web@dream\.737\.jp\.net/m);
    } finally {
        await mock.close();
    }
}

function testInternalUnchangedAndDisabled() {
    gateway.setTestOverrides({ config: { enabled: false } });
    const before = mail.sendMail({ fromOwner: 'menma', to: 'rook', subject: 'internal-off', body: 'same' });
    assert.deepStrictEqual(before.to, ['rook']);
    assert.strictEqual(before.outbound, undefined);
    assert.strictEqual(mail.listMail('rook', { folder: 'inbox' }).filter((row) => row.subject === 'internal-off').length, 1);
    assert.throws(
        () => mail.sendMail({ fromOwner: 'menma', to: 'alice@example.com', subject: 'ext-off', body: 'nope' }),
        (err) => err.code === 'UNKNOWN_RECIPIENT'
    );

    gateway.setTestOverrides({
        config: {
            enabled: true,
            domain: 'dream.737.jp.net',
            mailboxes: addresses.DEFAULT_MAILBOXES
        }
    });
    const stillInternal = mail.sendMail({ fromOwner: 'menma', to: 'sala', cc: 'rook', subject: 'internal-on', body: 'still local' });
    assert.deepStrictEqual(stillInternal.to, ['sala']);
    assert.deepStrictEqual(stillInternal.cc, ['rook']);
    assert.strictEqual(stillInternal.outbound, undefined);
    assert.strictEqual(mail.listMail('sala', { folder: 'inbox' }).filter((row) => row.subject === 'internal-on').length, 1);
    assert.strictEqual(mail.listMail('rook', { folder: 'inbox' }).filter((row) => row.subject === 'internal-on').length, 1);

    const mappedInternal = mail.sendMail({
        fromOwner: 'cursor',
        to: 'ivory.studio@dream.737.jp.net',
        subject: 'mapped-internal',
        body: 'stays inside'
    });
    assert.deepStrictEqual(mappedInternal.to, ['ivory']);
    assert.strictEqual(mappedInternal.outbound, undefined);
    assert.strictEqual(mail.listMail('ivory', { folder: 'inbox' }).some((row) => row.subject === 'mapped-internal'), true);

    gateway.setTestOverrides({ config: { enabled: false } });
}

async function testSendMailOutboundHook() {
    const certs = writeCert(path.join(tmpDir, 'hook'), 'mx.dream.737.jp.net');
    const mock = await startMockSmtp({
        key: certs.key,
        cert: certs.cert,
        password: 'hook-pass'
    });
    gateway.setTestOverrides({
        config: {
            enabled: true,
            domain: 'dream.737.jp.net',
            mailboxes: addresses.DEFAULT_MAILBOXES,
            outbound: {
                host: '127.0.0.1',
                port: mock.port,
                mode: 'starttls',
                tlsServername: 'mx.dream.737.jp.net',
                caPath: certs.certPath,
                authUser: 'dreamscape@dream.737.jp.net'
            }
        },
        smtpPassword: 'hook-pass'
    });
    try {
        const result = mail.sendMail({
            fromOwner: 'frost',
            to: 'friend@example.net',
            subject: 'from sendMail',
            body: 'external path'
        });
        assert.ok(result.outbound);
        await result.outbound;
        assert.deepStrictEqual(result.to, ['friend@example.net']);
        assert.strictEqual(mock.recorded.mailFrom, 'frost.dev@dream.737.jp.net');
        assert.match(mock.recorded.data, /^From: frost\.dev@dream\.737\.jp\.net/m);
        const sent = mail.listMail('frost', { folder: 'sent' }).find((row) => row.subject === 'from sendMail');
        assert.ok(sent);
        assert.deepStrictEqual(sent.to, ['friend@example.net']);
    } finally {
        gateway.setTestOverrides({ config: { enabled: false } });
        await mock.close();
    }
}

async function main() {
    testMapping();
    await testAllowlistReject();
    await testUnknownRecipientReject();
    await testInboundDelivery();
    await testOutboundRewrite();
    await testMissingStarttls();
    await testCertVerificationFailure();
    await testImplicitTls();
    testInternalUnchangedAndDisabled();
    await testSendMailOutboundHook();
    await gateway.resetForTests();
    console.log('mail gateway tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
