/**
 * Dovecote mail gateway: inbound SMTP/LMTP on :2525 from the LANTIS Postfix
 * relay, and outbound submission to that relay with verified TLS.
 *
 * Off unless config.mailGateway.enabled is true. Internal Dovecote sends
 * (mailbox names) do not go through this module.
 */

'use strict';

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const crypto = require('crypto');
const addresses = require('./mailGatewayAddresses');

const DEFAULT_INBOUND_PORT = 2525;
const DEFAULT_ALLOW_FROM = Object.freeze(['192.168.255.1']);
const DEFAULT_OUTBOUND_HOST = '192.168.255.1';
const DEFAULT_STARTTLS_PORT = 587;
const DEFAULT_IMPLICIT_PORT = 465;
const DEFAULT_AUTH_USER = 'dreamscape@dream.737.jp.net';
const DEFAULT_TLS_SERVERNAME = 'mx.dream.737.jp.net';
const SMTP_TIMEOUT_MS = 30 * 1000;
const MAX_DATA_BYTES = 10 * 1024 * 1024;
const PASSWORD_ENV = 'MAIL_GATEWAY_SMTP_PASSWORD';

class MailGatewayError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code || 'MAIL_GATEWAY_ERROR';
        this.name = 'MailGatewayError';
    }
}

let globalResourcesRef = null;
let inboundServer = null;
let testOverrides = null;

function setTestOverrides(overrides) {
    testOverrides = overrides || null;
}

function resetForTests() {
    testOverrides = null;
    return stop();
}

function getConfigSource() {
    if (testOverrides && testOverrides.config) return testOverrides.config;
    if (!globalResourcesRef || typeof globalResourcesRef.getConfig !== 'function') return {};
    try {
        return (globalResourcesRef.getConfig() || {}).mailGateway || {};
    } catch (_err) {
        return {};
    }
}

function getSecurePassword() {
    if (testOverrides && Object.prototype.hasOwnProperty.call(testOverrides, 'smtpPassword')) {
        return testOverrides.smtpPassword || '';
    }
    const fromEnv = process.env[PASSWORD_ENV];
    if (fromEnv) return String(fromEnv);
    if (!globalResourcesRef || typeof globalResourcesRef.getSecureConfig !== 'function') return '';
    try {
        const secure = globalResourcesRef.getSecureConfig({ path: 'mailGateway' }) || {};
        return secure.smtpPassword ? String(secure.smtpPassword) : '';
    } catch (_err) {
        return '';
    }
}

function resolveConfig(extra) {
    const raw = Object.assign({}, getConfigSource(), extra || {});
    const inbound = raw.inbound && typeof raw.inbound === 'object' ? raw.inbound : {};
    const outbound = raw.outbound && typeof raw.outbound === 'object' ? raw.outbound : {};
    const mode = String(outbound.mode || 'starttls').trim().toLowerCase() === 'implicit'
        ? 'implicit'
        : 'starttls';
    const mapping = addresses.createMapping({
        mailboxes: raw.mailboxes || addresses.DEFAULT_MAILBOXES,
        domain: raw.domain || addresses.DEFAULT_DOMAIN
    });
    return {
        enabled: raw.enabled === true,
        domain: mapping.domain,
        mapping,
        inbound: {
            port: Number.isFinite(Number(inbound.port)) ? Number(inbound.port) : DEFAULT_INBOUND_PORT,
            bind: inbound.bind ? String(inbound.bind) : '0.0.0.0',
            allowFrom: Array.isArray(inbound.allowFrom) && inbound.allowFrom.length
                ? inbound.allowFrom.map(String)
                : DEFAULT_ALLOW_FROM.slice()
        },
        outbound: {
            host: outbound.host ? String(outbound.host) : DEFAULT_OUTBOUND_HOST,
            port: Number.isFinite(Number(outbound.port))
                ? Number(outbound.port)
                : (mode === 'implicit' ? DEFAULT_IMPLICIT_PORT : DEFAULT_STARTTLS_PORT),
            mode,
            authUser: outbound.authUser ? String(outbound.authUser) : DEFAULT_AUTH_USER,
            tlsServername: outbound.tlsServername ? String(outbound.tlsServername) : DEFAULT_TLS_SERVERNAME,
            caPath: outbound.caPath ? String(outbound.caPath) : '',
            rejectUnauthorized: outbound.rejectUnauthorized !== false
        }
    };
}

function isEnabled() {
    return resolveConfig().enabled === true;
}

function tlsVerifyOptions(outbound) {
    const opts = {
        servername: outbound.tlsServername || DEFAULT_TLS_SERVERNAME,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
    };
    if (outbound.caPath) {
        try {
            opts.ca = fs.readFileSync(outbound.caPath);
        } catch (err) {
            throw new MailGatewayError(
                `Mail gateway CA path could not be read: ${err.message}`,
                'TLS_CA_UNREADABLE'
            );
        }
    }
    return opts;
}

function logInfo(message) {
    const logger = globalResourcesRef && globalResourcesRef.logger;
    if (logger && logger.info) logger.info(message);
    else console.log(message);
}

function logError(message) {
    const logger = globalResourcesRef && globalResourcesRef.logger;
    if (logger && logger.error) logger.error(message);
    else console.error(message);
}

function redact(text) {
    return String(text || '')
        .replace(/AUTH\s+\S+\s+\S+/gi, 'AUTH [redacted]')
        .replace(/(password|smtpPassword|PASS)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

function smtpWrite(socket, line) {
    socket.write(`${line}\r\n`);
}

function createLineReader(socket) {
    let buffer = '';
    const queue = [];
    let waiters = [];
    let ended = false;

    function flush() {
        while (queue.length && waiters.length) {
            waiters.shift()(queue.shift());
        }
    }

    function pushLine(line) {
        if (waiters.length) waiters.shift()(line);
        else queue.push(line);
    }

    socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            pushLine(line);
        }
    });
    socket.on('end', () => {
        ended = true;
        if (buffer) {
            pushLine(buffer);
            buffer = '';
        }
        flush();
        waiters.forEach((fn) => fn(null));
        waiters = [];
    });
    socket.on('error', () => {
        ended = true;
        waiters.forEach((fn) => fn(null));
        waiters = [];
    });

    return {
        readLine(timeoutMs) {
            if (queue.length) return Promise.resolve(queue.shift());
            if (ended) return Promise.resolve(null);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    waiters = waiters.filter((fn) => fn !== onLine);
                    reject(new MailGatewayError('SMTP read timed out', 'SMTP_TIMEOUT'));
                }, timeoutMs || SMTP_TIMEOUT_MS);
                const onLine = (line) => {
                    clearTimeout(timer);
                    resolve(line);
                };
                waiters.push(onLine);
            });
        }
    };
}

async function readSmtpReply(reader, timeoutMs) {
    const lines = [];
    while (true) {
        const line = await reader.readLine(timeoutMs);
        if (line == null) {
            throw new MailGatewayError('SMTP connection closed while reading a reply', 'SMTP_CLOSED');
        }
        lines.push(line);
        if (/^\d{3} /.test(line)) break;
        if (!/^\d{3}-/.test(line)) break;
    }
    const code = parseInt(lines[0], 10);
    return { code, lines, text: lines.join('\n') };
}

function capabilitiesOf(reply) {
    const caps = new Set();
    for (const line of reply.lines) {
        const body = line.replace(/^\d{3}[- ]/, '').trim().toUpperCase();
        if (body) caps.add(body.split(/\s+/)[0]);
    }
    return caps;
}

function buildOutboundMessage({ fromAddress, to, cc, subject, body, format }) {
    const date = new Date().toUTCString();
    const messageId = `<${crypto.randomUUID()}@${addresses.DEFAULT_DOMAIN}>`;
    const contentType = format === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    const headers = [
        `From: ${fromAddress}`,
        `Reply-To: ${fromAddress}`,
        `To: ${(to || []).join(', ')}`,
        `Subject: ${String(subject || '').replace(/[\r\n]+/g, ' ')}`,
        `Date: ${date}`,
        `Message-ID: ${messageId}`,
        'MIME-Version: 1.0',
        `Content-Type: ${contentType}`,
        'Content-Transfer-Encoding: 8bit'
    ];
    if (cc && cc.length) headers.splice(3, 0, `Cc: ${cc.join(', ')}`);
    const rawBody = String(body || '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    return `${headers.join('\r\n')}\r\n\r\n${rawBody}`;
}

function stuffDots(message) {
    return message.replace(/^\./gm, '..');
}

function upgradeSocket(socket, tlsOpts) {
    return new Promise((resolve, reject) => {
        const secure = tls.connect(Object.assign({ socket }, tlsOpts), () => {
            if (!secure.authorized && tlsOpts.rejectUnauthorized !== false) {
                const err = secure.authorizationError || new Error('TLS certificate was not authorized');
                secure.destroy();
                reject(wrapTlsError(err));
                return;
            }
            resolve(secure);
        });
        secure.on('error', (err) => reject(wrapTlsError(err)));
    });
}

function wrapTlsError(err) {
    const message = redact(err && err.message ? err.message : String(err));
    return new MailGatewayError(
        `Outbound TLS verification failed: ${message}`,
        'TLS_VERIFY_FAILED'
    );
}

function connectPlain(host, port) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port }, () => resolve(socket));
        socket.setTimeout(SMTP_TIMEOUT_MS, () => {
            socket.destroy();
            reject(new MailGatewayError('SMTP connect timed out', 'SMTP_TIMEOUT'));
        });
        socket.on('error', (err) => {
            reject(new MailGatewayError(`SMTP connect failed: ${redact(err.message)}`, 'SMTP_CONNECT_FAILED'));
        });
    });
}

function connectImplicitTls(host, port, tlsOpts) {
    return new Promise((resolve, reject) => {
        const socket = tls.connect(Object.assign({ host, port }, tlsOpts), () => {
            if (!socket.authorized && tlsOpts.rejectUnauthorized !== false) {
                const err = socket.authorizationError || new Error('TLS certificate was not authorized');
                socket.destroy();
                reject(wrapTlsError(err));
                return;
            }
            resolve(socket);
        });
        socket.setTimeout(SMTP_TIMEOUT_MS, () => {
            socket.destroy();
            reject(new MailGatewayError('SMTP TLS connect timed out', 'SMTP_TIMEOUT'));
        });
        socket.on('error', (err) => reject(wrapTlsError(err)));
    });
}

async function expectCode(reader, socket, allowed, context) {
    const reply = await readSmtpReply(reader);
    if (!allowed.includes(reply.code)) {
        throw new MailGatewayError(
            `${context}: expected ${allowed.join('/')}, got ${reply.code} ${redact(reply.text)}`,
            'SMTP_ERROR'
        );
    }
    return reply;
}

async function submitOutbound(input) {
    const cfg = resolveConfig(input.config);
    const outbound = Object.assign({}, cfg.outbound, input.outbound || {});
    const mapping = input.mapping || cfg.mapping;
    const fromOwner = String(input.fromOwner || '').trim().toLowerCase();
    const fromAddress = input.fromAddress || addresses.toExternal(fromOwner, mapping);
    if (!fromAddress) {
        throw new MailGatewayError(
            `Sender ${fromOwner || '(unknown)'} has no external address mapping`,
            'UNMAPPED_SENDER'
        );
    }
    const to = (input.to || []).map(addresses.normalizeEmail).filter(Boolean);
    const cc = (input.cc || []).map(addresses.normalizeEmail).filter(Boolean);
    const recipients = [...new Set(to.concat(cc))];
    if (!recipients.length) {
        throw new MailGatewayError('At least one external recipient is required', 'EMPTY_RECIPIENTS');
    }
    const password = input.smtpPassword != null ? String(input.smtpPassword) : getSecurePassword();
    if (!password) {
        throw new MailGatewayError(
            `Outbound SMTP password is not set (secureConfig.mailGateway.smtpPassword or ${PASSWORD_ENV})`,
            'SMTP_PASSWORD_MISSING'
        );
    }
    const tlsOpts = tlsVerifyOptions(outbound);
    let socket;
    if (outbound.mode === 'implicit') {
        socket = await connectImplicitTls(outbound.host, outbound.port, tlsOpts);
    } else {
        socket = await connectPlain(outbound.host, outbound.port);
    }
    socket.setTimeout(SMTP_TIMEOUT_MS);
    let reader = createLineReader(socket);
    try {
        await expectCode(reader, socket, [220], 'SMTP greeting');
        smtpWrite(socket, `EHLO ${cfg.domain}`);
        let ehlo = await expectCode(reader, socket, [250], 'EHLO');
        if (outbound.mode !== 'implicit') {
            const caps = capabilitiesOf(ehlo);
            if (!caps.has('STARTTLS')) {
                throw new MailGatewayError(
                    'STARTTLS is required but was not offered by the SMTP server',
                    'STARTTLS_REQUIRED'
                );
            }
            smtpWrite(socket, 'STARTTLS');
            await expectCode(reader, socket, [220], 'STARTTLS');
            socket = await upgradeSocket(socket, tlsOpts);
            socket.setTimeout(SMTP_TIMEOUT_MS);
            reader = createLineReader(socket);
            smtpWrite(socket, `EHLO ${cfg.domain}`);
            ehlo = await expectCode(reader, socket, [250], 'EHLO after STARTTLS');
        }
        const authPlain = Buffer.from(`\0${outbound.authUser}\0${password}`, 'utf8').toString('base64');
        smtpWrite(socket, `AUTH PLAIN ${authPlain}`);
        const auth = await readSmtpReply(reader);
        if (auth.code !== 235) {
            throw new MailGatewayError(
                `SMTP AUTH failed (${auth.code})`,
                'SMTP_AUTH_FAILED'
            );
        }
        smtpWrite(socket, `MAIL FROM:<${fromAddress}>`);
        await expectCode(reader, socket, [250], 'MAIL FROM');
        for (const rcpt of recipients) {
            smtpWrite(socket, `RCPT TO:<${rcpt}>`);
            await expectCode(reader, socket, [250, 251], `RCPT TO ${rcpt}`);
        }
        smtpWrite(socket, 'DATA');
        await expectCode(reader, socket, [354], 'DATA');
        const message = buildOutboundMessage({
            fromAddress,
            to,
            cc,
            subject: input.subject,
            body: input.body,
            format: input.format
        });
        socket.write(`${stuffDots(message)}\r\n.\r\n`);
        await expectCode(reader, socket, [250], 'DATA end');
        smtpWrite(socket, 'QUIT');
        try {
            await readSmtpReply(reader);
        } catch (_err) {
            // QUIT reply is optional; the message already landed.
        }
        return { from: fromAddress, to, cc, envelopeFrom: fromAddress };
    } finally {
        socket.destroy();
    }
}

function parseDataMessage(raw) {
    const text = String(raw || '').replace(/\r\n/g, '\n');
    const split = text.indexOf('\n\n');
    const headerBlock = split === -1 ? text : text.slice(0, split);
    const body = split === -1 ? '' : text.slice(split + 2);
    const headers = Object.create(null);
    let current = '';
    for (const line of headerBlock.split('\n')) {
        if (/^[ \t]/.test(line) && current) {
            headers[current] += ` ${line.trim()}`;
            continue;
        }
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        current = line.slice(0, colon).trim().toLowerCase();
        headers[current] = line.slice(colon + 1).trim();
    }
    const contentType = String(headers['content-type'] || '').toLowerCase();
    const format = contentType.includes('text/html') ? 'html' : 'text';
    return {
        from: addresses.extractAddress(headers.from || ''),
        to: headers.to || '',
        cc: headers.cc || '',
        subject: headers.subject || '',
        body: body.replace(/\n$/, ''),
        format
    };
}

function handleInboundConnection(socket, options) {
    const allowFrom = options.allowFrom;
    const mapping = options.mapping;
    const deliver = options.deliver;
    const peer = addresses.normalizePeerAddress(socket.remoteAddress);
    socket.setEncoding('utf8');
    socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.end());

    if (!addresses.isAllowedPeer(peer, allowFrom)) {
        smtpWrite(socket, '554 5.7.1 Connection refused');
        socket.end();
        return;
    }

    let mode = 'smtp';
    let mailFrom = '';
    let recipients = [];
    let inData = false;
    let dataBuf = '';
    let dataBytes = 0;

    smtpWrite(socket, '220 dreamscape ESMTP/LMTP');

    function resetTransaction() {
        mailFrom = '';
        recipients = [];
        inData = false;
        dataBuf = '';
        dataBytes = 0;
    }

    function reply(line) {
        if (!socket.destroyed) smtpWrite(socket, line);
    }

    async function acceptData() {
        const unstuffed = dataBuf.replace(/^\.\./gm, '.').replace(/\n$/, '');
        const parsed = parseDataMessage(unstuffed);
        const fromAddress = addresses.normalizeEmail(parsed.from || mailFrom);
        const subject = parsed.subject;
        const body = parsed.body;
        const format = parsed.format;
        const results = [];
        for (const owner of recipients) {
            try {
                if (deliver) {
                    await deliver({
                        fromAddress: fromAddress || mailFrom || 'unknown@unknown',
                        toOwner: owner,
                        subject,
                        body,
                        format
                    });
                }
                results.push({ owner, ok: true });
            } catch (err) {
                results.push({ owner, ok: false, error: err });
            }
        }
        if (mode === 'lmtp') {
            results.forEach((item) => {
                if (item.ok) reply(`250 2.1.5 ${item.owner} OK`);
                else reply(`451 4.3.0 ${item.owner} ${redact(item.error.message)}`);
            });
        } else if (results.every((item) => item.ok)) {
            reply('250 2.0.0 Message accepted');
        } else {
            reply(`451 4.3.0 ${redact((results.find((item) => !item.ok) || {}).error && results.find((item) => !item.ok).error.message)}`);
        }
        resetTransaction();
    }

    socket.on('data', (chunk) => {
        if (inData) {
            dataBytes += Buffer.byteLength(chunk);
            if (dataBytes > MAX_DATA_BYTES) {
                reply('552 5.3.4 Message too large');
                resetTransaction();
                return;
            }
            dataBuf += chunk;
            const ended = dataBuf.includes('\r\n.\r\n') || dataBuf.endsWith('\n.\n') || dataBuf === '.\n' || dataBuf === '.\r\n';
            if (!ended) return;
            const cut = dataBuf.lastIndexOf('\n.');
            dataBuf = dataBuf.slice(0, cut).replace(/\r$/, '');
            inData = false;
            Promise.resolve(acceptData()).catch((err) => {
                reply(`451 4.3.0 ${redact(err.message)}`);
                resetTransaction();
            });
            return;
        }

        const lines = chunk.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (inData) {
                dataBuf += lines.slice(i).join('\n');
                if (chunk.endsWith('\n') && !dataBuf.endsWith('\n')) dataBuf += '\n';
                const ended = dataBuf.includes('\r\n.\r\n') || /(^|\n)\.\r?\n/.test(dataBuf);
                if (ended) {
                    const cut = dataBuf.lastIndexOf('\n.');
                    dataBuf = cut >= 0 ? dataBuf.slice(0, cut).replace(/\r$/, '') : dataBuf;
                    inData = false;
                    Promise.resolve(acceptData()).catch((err) => {
                        reply(`451 4.3.0 ${redact(err.message)}`);
                        resetTransaction();
                    });
                }
                break;
            }
            if (!line) continue;
            const command = line.trim();
            const upper = command.toUpperCase();
            const verb = upper.split(/\s+/)[0];

            if (verb === 'LHLO') {
                mode = 'lmtp';
                reply('250-dreamscape');
                reply('250-8BITMIME');
                reply('250 OK');
            } else if (verb === 'EHLO') {
                mode = 'smtp';
                reply('250-dreamscape');
                reply('250-8BITMIME');
                reply('250 OK');
            } else if (verb === 'HELO') {
                mode = 'smtp';
                reply('250 dreamscape');
            } else if (verb === 'MAIL') {
                const match = command.match(/FROM:\s*<([^>]*)>/i);
                mailFrom = match ? addresses.normalizeEmail(match[1]) || match[1] : '';
                recipients = [];
                reply('250 2.1.0 OK');
            } else if (verb === 'RCPT') {
                const match = command.match(/TO:\s*<([^>]+)>/i);
                const addr = match ? match[1] : '';
                const owner = addresses.toMailbox(addr, mapping);
                if (!owner) {
                    reply(`550 5.1.1 <${addr}>: Recipient address rejected: User unknown`);
                } else {
                    if (!recipients.includes(owner)) recipients.push(owner);
                    reply('250 2.1.5 OK');
                }
            } else if (verb === 'DATA') {
                if (!recipients.length) {
                    reply('503 5.5.1 No valid recipients');
                } else {
                    inData = true;
                    dataBuf = '';
                    dataBytes = 0;
                    reply('354 End data with <CR><LF>.<CR><LF>');
                }
            } else if (verb === 'RSET') {
                resetTransaction();
                reply('250 2.0.0 OK');
            } else if (verb === 'NOOP') {
                reply('250 2.0.0 OK');
            } else if (verb === 'QUIT') {
                reply('221 2.0.0 Bye');
                socket.end();
            } else if (verb === 'VRFY') {
                reply('252 2.5.2 Cannot VRFY');
            } else {
                reply('502 5.5.1 Command not implemented');
            }
        }
    });

    socket.on('error', () => {});
}

function startInbound(options) {
    const cfg = resolveConfig(options && options.config);
    const mapping = (options && options.mapping) || cfg.mapping;
    const allowFrom = (options && options.allowFrom) || cfg.inbound.allowFrom;
    const port = options && options.port != null ? options.port : cfg.inbound.port;
    const bind = (options && options.bind) || cfg.inbound.bind;
    const deliver = options && options.deliver;

    return new Promise((resolve, reject) => {
        const server = net.createServer((socket) => {
            handleInboundConnection(socket, { allowFrom, mapping, deliver });
        });
        server.on('error', reject);
        server.listen(port, bind, () => {
            const address = server.address();
            resolve({
                server,
                port: address && address.port,
                host: bind,
                close: () => new Promise((done) => server.close(() => done()))
            });
        });
    });
}

function start(globalResources) {
    globalResourcesRef = globalResources || globalResourcesRef;
    const cfg = resolveConfig();
    if (!cfg.enabled) return null;
    if (inboundServer) return inboundServer;
    const deliver = async (msg) => {
        const dovecoteMail = require('./dovecoteMail');
        return dovecoteMail.deliverInboundMail(msg);
    };
    const pending = startInbound({
        config: cfg,
        mapping: cfg.mapping,
        allowFrom: cfg.inbound.allowFrom,
        port: cfg.inbound.port,
        bind: cfg.inbound.bind,
        deliver
    });
    inboundServer = { pending };
    pending.then((started) => {
        inboundServer = started;
        logInfo(`✓ Mail gateway listening on ${cfg.inbound.bind}:${started.port}`);
    }).catch((err) => {
        inboundServer = null;
        logError(`Mail gateway failed to listen: ${redact(err.message)}`);
    });
    return inboundServer;
}

function stop() {
    const current = inboundServer;
    inboundServer = null;
    if (!current) return Promise.resolve();
    if (current.close) return current.close();
    if (current.pending) {
        return current.pending.then((started) => started.close()).catch(() => {});
    }
    if (current.server) {
        return new Promise((done) => current.server.close(() => done()));
    }
    return Promise.resolve();
}

function classifyRecipients(to, cc) {
    const cfg = resolveConfig();
    const dovecoteMail = require('./dovecoteMail');
    return addresses.classifyRecipients(to, cc, {
        mapping: cfg.mapping,
        enabled: cfg.enabled,
        isValidOwner: dovecoteMail.isValidOwner
    });
}

module.exports = {
    MailGatewayError,
    PASSWORD_ENV,
    DEFAULT_INBOUND_PORT,
    DEFAULT_ALLOW_FROM,
    DEFAULT_TLS_SERVERNAME,
    DEFAULT_AUTH_USER,
    resolveConfig,
    isEnabled,
    classifyRecipients,
    toMailbox: (address, mapping) => addresses.toMailbox(address, mapping || resolveConfig().mapping),
    toExternal: (owner, mapping) => addresses.toExternal(owner, mapping || resolveConfig().mapping),
    submitOutbound,
    startInbound,
    start,
    stop,
    setTestOverrides,
    resetForTests,
    tlsVerifyOptions,
    buildOutboundMessage,
    addresses
};
