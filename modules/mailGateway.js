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
const inbound = require('./mailGatewayInbound');
const spam = require('./mailGatewaySpam');

const DEFAULT_INBOUND_PORT = 2525;
// vlan10 source toward 192.168.255.1. Do not listen on 0.0.0.0; override inbound.bind if this host uses another NIC.
const DEFAULT_INBOUND_BIND = '192.168.200.101';
const DEFAULT_ALLOW_FROM = Object.freeze(['192.168.255.1']);
const DEFAULT_MAX_CONNECTIONS = 16;
const DEFAULT_OUTBOUND_HOST = '192.168.255.1';
const DEFAULT_STARTTLS_PORT = 587;
const DEFAULT_IMPLICIT_PORT = 465;
const DEFAULT_AUTH_USER = 'dreamscape@dream.737.jp.net';
const DEFAULT_TLS_SERVERNAME = 'mx.dream.737.jp.net';
const DEFAULT_RATE_LIMIT_PER_MINUTE = 30;
const SMTP_TIMEOUT_MS = 30 * 1000;
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
const outboundHits = new Map();

function setTestOverrides(overrides) {
    testOverrides = overrides || null;
}

function resetForTests() {
    testOverrides = null;
    outboundHits.clear();
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
    const inboundCfg = raw.inbound && typeof raw.inbound === 'object' ? raw.inbound : {};
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
            port: Number.isFinite(Number(inboundCfg.port)) ? Number(inboundCfg.port) : DEFAULT_INBOUND_PORT,
            bind: inboundCfg.bind ? String(inboundCfg.bind) : DEFAULT_INBOUND_BIND,
            allowFrom: Array.isArray(inboundCfg.allowFrom) && inboundCfg.allowFrom.length
                ? inboundCfg.allowFrom.map(String)
                : DEFAULT_ALLOW_FROM.slice(),
            maxConnections: Number.isFinite(Number(inboundCfg.maxConnections))
                ? Number(inboundCfg.maxConnections)
                : DEFAULT_MAX_CONNECTIONS,
            sessionTimeoutMs: Number.isFinite(Number(inboundCfg.sessionTimeoutMs))
                ? Number(inboundCfg.sessionTimeoutMs)
                : inbound.DEFAULT_SESSION_TIMEOUT_MS,
            idleTimeoutMs: Number.isFinite(Number(inboundCfg.idleTimeoutMs))
                ? Number(inboundCfg.idleTimeoutMs)
                : inbound.DEFAULT_IDLE_TIMEOUT_MS,
            maxDataBytes: Number.isFinite(Number(inboundCfg.maxDataBytes))
                ? Number(inboundCfg.maxDataBytes)
                : inbound.DEFAULT_MAX_DATA_BYTES
        },
        spam: spam.resolveSpamConfig(raw.spam),
        outbound: {
            host: outbound.host ? String(outbound.host) : DEFAULT_OUTBOUND_HOST,
            port: Number.isFinite(Number(outbound.port))
                ? Number(outbound.port)
                : (mode === 'implicit' ? DEFAULT_IMPLICIT_PORT : DEFAULT_STARTTLS_PORT),
            mode,
            authUser: outbound.authUser ? String(outbound.authUser) : DEFAULT_AUTH_USER,
            tlsServername: outbound.tlsServername ? String(outbound.tlsServername) : DEFAULT_TLS_SERVERNAME,
            caPath: outbound.caPath ? String(outbound.caPath) : '',
            rateLimitPerMinute: Number.isFinite(Number(outbound.rateLimitPerMinute))
                ? Number(outbound.rateLimitPerMinute)
                : DEFAULT_RATE_LIMIT_PER_MINUTE,
            recipientAllowlist: Array.isArray(outbound.recipientAllowlist)
                ? outbound.recipientAllowlist.map(String)
                : []
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

function buildOutboundMessage({ fromAddress, to, cc, subject, body, format, domain }) {
    const date = new Date().toUTCString();
    const host = domain || addresses.DEFAULT_DOMAIN;
    const messageId = `<${crypto.randomUUID()}@${host}>`;
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
            if (!secure.authorized) {
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
            if (!socket.authorized) {
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

function assertOutboundAllowed({ fromOwner, to, cc, config }) {
    const cfg = config || resolveConfig();
    const allowlist = cfg.outbound.recipientAllowlist || [];
    const recipients = [...new Set((to || []).concat(cc || []))];
    for (const addr of recipients) {
        if (!addresses.recipientAllowed(addr, allowlist)) {
            throw new MailGatewayError(
                `Recipient is not on the outbound allowlist: ${addr}`,
                'RECIPIENT_NOT_ALLOWED'
            );
        }
    }
    const limit = cfg.outbound.rateLimitPerMinute;
    if (limit > 0 && fromOwner) {
        const now = Date.now();
        const key = String(fromOwner).toLowerCase();
        const hits = (outboundHits.get(key) || []).filter((ts) => now - ts < 60000);
        if (hits.length >= limit) {
            throw new MailGatewayError(
                `Outbound rate limit exceeded for ${key}`,
                'RATE_LIMITED'
            );
        }
        hits.push(now);
        outboundHits.set(key, hits);
    }
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
    assertOutboundAllowed({ fromOwner, to, cc, config: cfg });
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
            format: input.format,
            domain: cfg.domain
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

function startInbound(options) {
    const cfg = resolveConfig(options && options.config);
    const mapping = (options && options.mapping) || cfg.mapping;
    const allowFrom = (options && options.allowFrom) || cfg.inbound.allowFrom;
    const port = options && options.port != null ? options.port : cfg.inbound.port;
    const bind = (options && options.bind) || cfg.inbound.bind;
    const deliver = options && options.deliver;
    const maxConnections = options && options.maxConnections != null
        ? options.maxConnections
        : cfg.inbound.maxConnections;
    const sessionOpts = {
        allowFrom,
        mapping,
        deliver,
        maxDataBytes: (options && options.maxDataBytes) || cfg.inbound.maxDataBytes,
        sessionTimeoutMs: (options && options.sessionTimeoutMs) || cfg.inbound.sessionTimeoutMs,
        idleTimeoutMs: (options && options.idleTimeoutMs) || cfg.inbound.idleTimeoutMs,
        maxCommandLine: options && options.maxCommandLine,
        maxDataLine: options && options.maxDataLine,
        spam: (options && options.spam) || cfg.spam
    };

    return new Promise((resolve, reject) => {
        let active = 0;
        const server = net.createServer((socket) => {
            if (!addresses.isAllowedPeer(socket.remoteAddress, allowFrom)) {
                // Denied peers never take a slot and are not left half-open.
                socket.end('554 5.7.1 Connection refused\r\n');
                setTimeout(() => socket.destroy(), 1000).unref();
                return;
            }
            if (active >= maxConnections) {
                smtpWrite(socket, '421 4.7.0 Too many connections');
                socket.destroy();
                return;
            }
            active += 1;
            socket.on('close', () => { active = Math.max(0, active - 1); });
            inbound.handleInboundConnection(socket, sessionOpts);
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
    DEFAULT_INBOUND_BIND,
    DEFAULT_ALLOW_FROM,
    DEFAULT_MAX_CONNECTIONS,
    DEFAULT_TLS_SERVERNAME,
    DEFAULT_AUTH_USER,
    resolveConfig,
    isEnabled,
    classifyRecipients,
    toMailbox: (address, mapping) => addresses.toMailbox(address, mapping || resolveConfig().mapping),
    toExternal: (owner, mapping) => addresses.toExternal(owner, mapping || resolveConfig().mapping),
    submitOutbound,
    assertOutboundAllowed,
    startInbound,
    start,
    stop,
    setTestOverrides,
    resetForTests,
    tlsVerifyOptions,
    buildOutboundMessage,
    addresses
};
