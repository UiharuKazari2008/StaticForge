/**
 * Inbound SMTP/LMTP session: CRLF-only line-buffered state machine.
 * Commands and DATA lines are assembled across TCP chunks. DATA ends only
 * on <CRLF>.<CRLF> (a lone LF-dot does not terminate). Oversize DATA stays
 * in discard until that marker, then 552 — leftover bytes are not commands.
 *
 * Optional STARTTLS (RFC 3207): advertised on EHLO/LHLO when inbound.tls
 * has cert+key. After 220, leftover plaintext is discarded (injection
 * probe) and SMTP state is reset. requireTls refuses MAIL until upgraded.
 */

'use strict';

const tls = require('tls');
const addresses = require('./mailGatewayAddresses');
const mime = require('./mailGatewayMime');
const spam = require('./mailGatewaySpam');

const CRLF = Buffer.from('\r\n');
const DEFAULT_MAX_COMMAND_LINE = 512;
const DEFAULT_MAX_DATA_LINE = 1000;
const DEFAULT_MAX_DATA_BYTES = 10 * 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_SESSION_TIMEOUT_MS = 120 * 1000;

function smtpWrite(socket, line) {
    if (!socket.destroyed) socket.write(`${line}\r\n`);
}

class CrlfBuffer {
    constructor() {
        this.buf = Buffer.alloc(4096);
        this.start = 0;
        this.end = 0;
    }

    get length() {
        return this.end - this.start;
    }

    push(chunk) {
        const add = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!add.length) return;
        this.ensure(add.length);
        add.copy(this.buf, this.end);
        this.end += add.length;
    }

    ensure(need) {
        const used = this.end - this.start;
        if (this.buf.length - this.end >= need) return;
        if (this.start > 0 && this.buf.length - used >= need) {
            this.buf.copyWithin(0, this.start, this.end);
            this.start = 0;
            this.end = used;
            return;
        }
        const next = Buffer.alloc(Math.max(this.buf.length * 2, used + need));
        this.buf.copy(next, 0, this.start, this.end);
        this.buf = next;
        this.start = 0;
        this.end = used;
    }

    /**
     * Next CRLF-terminated line. Bare LF is not a delimiter.
     * overflow: true when the unterminated prefix already exceeds maxBytes,
     * or a terminated line is longer than maxBytes (line is discarded).
     */
    nextLine(maxBytes) {
        const idx = this.buf.indexOf(CRLF, this.start);
        if (idx === -1 || idx >= this.end) {
            if (this.length > maxBytes) return { overflow: true, waiting: true };
            return null;
        }
        const lineBuf = this.buf.subarray(this.start, idx);
        this.start = idx + 2;
        if (lineBuf.length > maxBytes) return { overflow: true, waiting: false };
        return { line: lineBuf.toString('utf8') };
    }

    // Drop an overlong unterminated prefix but keep a trailing CR so a split
    // CRLF can still complete the line.
    trimWaitingOverflow() {
        if (!this.length) return;
        const keepCr = this.buf[this.end - 1] === 0x0d;
        this.buf[0] = 0x0d;
        this.start = 0;
        this.end = keepCr ? 1 : 0;
    }
}

function redact(text) {
    return String(text || '').replace(/AUTH\s+\S+\s+\S+/gi, 'AUTH [redacted]');
}

function handleInboundConnection(plainSocket, options) {
    const allowFrom = options.allowFrom;
    const mapping = options.mapping;
    const deliver = options.deliver;
    const spamConfig = options.spam;
    const tlsContext = options.tls && options.tls.enabled ? options.tls : { enabled: false, requireTls: false };
    const maxCommandLine = options.maxCommandLine || DEFAULT_MAX_COMMAND_LINE;
    const maxDataLine = options.maxDataLine || DEFAULT_MAX_DATA_LINE;
    const maxDataBytes = options.maxDataBytes || DEFAULT_MAX_DATA_BYTES;
    const idleTimeoutMs = options.idleTimeoutMs || DEFAULT_IDLE_TIMEOUT_MS;
    const sessionTimeoutMs = options.sessionTimeoutMs || DEFAULT_SESSION_TIMEOUT_MS;
    const peer = addresses.normalizePeerAddress(plainSocket.remoteAddress);

    if (!addresses.isAllowedPeer(peer, allowFrom)) {
        smtpWrite(plainSocket, '554 5.7.1 Connection refused');
        plainSocket.end();
        return;
    }

    let socket = plainSocket;
    let crlf = new CrlfBuffer();
    let state = 'command';
    let mode = 'smtp';
    let mailFrom = '';
    let recipients = [];
    let dataLines = [];
    let dataBytes = 0;
    let discarding = false;
    let closed = false;
    let busy = false;
    let skipLineTail = false;
    let secured = false;
    let upgrading = false;

    socket.setTimeout(idleTimeoutMs, () => closeSession());
    const sessionTimer = setTimeout(() => {
        smtpWrite(socket, '421 4.4.2 Session timeout');
        closeSession();
    }, sessionTimeoutMs);

    smtpWrite(socket, '220 dreamscape ESMTP/LMTP');

    function closeSession() {
        if (closed) return;
        closed = true;
        clearTimeout(sessionTimer);
        socket.end();
    }

    function resetTransaction() {
        mailFrom = '';
        recipients = [];
        dataLines = [];
        dataBytes = 0;
        discarding = false;
        skipLineTail = false;
        state = 'command';
    }

    function reply(line) {
        smtpWrite(socket, line);
    }

    function advertiseHello(kind) {
        if (kind === 'helo') {
            reply('250 dreamscape');
            return;
        }
        reply('250-dreamscape');
        if (tlsContext.enabled && !secured) reply('250-STARTTLS');
        reply('250-8BITMIME');
        reply('250 OK');
    }

    // RFC 3207: leftover plaintext after STARTTLS is discarded (not commands,
    // not handshake). Pre-TLS EHLO / MAIL / RCPT are forgotten.
    function resetAfterStarttls() {
        crlf = new CrlfBuffer();
        resetTransaction();
        mode = 'smtp';
    }

    function upgradeToTls() {
        upgrading = true;
        socket.removeListener('data', onData);
        resetAfterStarttls();
        const secure = new tls.TLSSocket(socket, {
            isServer: true,
            key: tlsContext.key,
            cert: tlsContext.cert,
            rejectUnauthorized: false,
            requestCert: false,
            minVersion: 'TLSv1.2'
        });
        socket = secure;
        secure.setTimeout(idleTimeoutMs, () => closeSession());
        secure.on('data', onData);
        secure.on('error', () => closeSession());
        secure.on('end', () => closeSession());
        secure.once('secure', () => {
            if (closed) return;
            secured = true;
            upgrading = false;
            state = 'command';
            pump();
        });
    }

    function handleCommand(command) {
        const upper = command.toUpperCase();
        const verb = upper.split(/\s+/)[0];

        if (verb === 'LHLO') {
            mode = 'lmtp';
            advertiseHello('lhlo');
        } else if (verb === 'EHLO') {
            mode = 'smtp';
            advertiseHello('ehlo');
        } else if (verb === 'HELO') {
            mode = 'smtp';
            advertiseHello('helo');
        } else if (verb === 'STARTTLS') {
            if (!tlsContext.enabled) {
                reply('502 5.5.1 Command not implemented');
                return;
            }
            if (secured) {
                reply('503 5.5.1 Already using TLS');
                return;
            }
            reply('220 2.0.0 Ready to start TLS');
            upgradeToTls();
        } else if (verb === 'MAIL') {
            if (tlsContext.enabled && tlsContext.requireTls && !secured) {
                reply('530 5.7.0 Must issue a STARTTLS command first');
                return;
            }
            const match = command.match(/^MAIL\s+FROM:\s*(.*)$/i);
            const raw = match ? match[1] : '';
            const checked = addresses.validateEnvelopeSender(raw, mapping);
            if (!checked.ok) {
                mailFrom = '';
                recipients = [];
                reply(`${checked.code} ${checked.message}`);
                return;
            }
            mailFrom = checked.address;
            recipients = [];
            reply('250 2.1.0 OK');
        } else if (verb === 'RCPT') {
            if (!mailFrom) {
                reply('503 5.5.1 Need MAIL FROM first');
                return;
            }
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
            if (!mailFrom) {
                reply('503 5.5.1 Need MAIL FROM first');
            } else if (!recipients.length) {
                reply('503 5.5.1 No valid recipients');
            } else {
                state = 'data';
                dataLines = [];
                dataBytes = 0;
                discarding = false;
                skipLineTail = false;
                reply('354 End data with <CR><LF>.<CR><LF>');
            }
        } else if (verb === 'RSET') {
            resetTransaction();
            reply('250 2.0.0 OK');
        } else if (verb === 'NOOP') {
            reply('250 2.0.0 OK');
        } else if (verb === 'QUIT') {
            reply('221 2.0.0 Bye');
            closeSession();
        } else if (verb === 'VRFY') {
            reply('252 2.5.2 Cannot VRFY');
        } else {
            reply('502 5.5.1 Command not implemented');
        }
    }

    function finishData() {
        if (discarding) {
            reply('552 5.3.4 Message too large');
            resetTransaction();
            return;
        }
        const raw = dataLines.join('\r\n');
        const parsed = mime.extractTextBody(raw);
        const headerEnd = raw.indexOf('\r\n\r\n');
        const headerBlock = headerEnd === -1 ? raw : raw.slice(0, headerEnd);
        const spamMark = spam.isInboundSpam(headerBlock, spamConfig);
        const originalTo = spam.trustedOriginalTo(headerBlock, spamConfig);
        const fromCheck = addresses.validateFromHeader(parsed.headers.from, mapping);
        if (!fromCheck.ok) {
            reply(`${fromCheck.code} ${fromCheck.message}`);
            resetTransaction();
            return;
        }
        const to = addresses.parseAddressList(parsed.headers.to);
        const cc = addresses.parseAddressList(parsed.headers.cc);
        const subject = parsed.headers.subject || '';
        const body = parsed.body;
        const format = parsed.format;
        const jobs = recipients.map((owner) => Promise.resolve().then(() => {
            if (!deliver) return { owner, ok: true };
            return Promise.resolve(deliver({
                fromAddress: mailFrom,
                fromLabel: fromCheck.label,
                toOwner: owner,
                to,
                cc,
                subject,
                body,
                format,
                spam: spamMark.spam,
                spamMeta: spam.displayMeta(spamMark),
                originalTo
            })).then(() => ({ owner, ok: true }));
        }).catch((err) => ({ owner, ok: false, error: err })));

        busy = true;
        Promise.all(jobs).then((results) => {
            if (mode === 'lmtp') {
                results.forEach((item) => {
                    if (item.ok) reply(`250 2.1.5 ${item.owner} OK`);
                    else reply(`451 4.3.0 ${item.owner} ${redact(item.error.message)}`);
                });
            } else if (results.every((item) => item.ok)) {
                reply('250 2.0.0 Message accepted');
            } else {
                const failed = results.find((item) => !item.ok);
                reply(`451 4.3.0 ${redact(failed && failed.error && failed.error.message)}`);
            }
        }).catch((err) => {
            reply(`451 4.3.0 ${redact(err.message)}`);
        }).finally(() => {
            resetTransaction();
            busy = false;
            pump();
        });
    }

    function handleDataLine(line) {
        if (line === '.') {
            // Leave DATA immediately so leftover bytes in this buffer are
            // commands, not a second message body.
            state = 'command';
            finishData();
            return;
        }
        const unstuffed = line.startsWith('.') ? line.slice(1) : line;
        if (!discarding) {
            const nextBytes = dataBytes + Buffer.byteLength(unstuffed) + 2;
            if (nextBytes > maxDataBytes) {
                discarding = true;
                dataLines = [];
            } else {
                dataLines.push(unstuffed);
                dataBytes = nextBytes;
            }
        }
    }

    function pump() {
        while (!closed && !busy && !upgrading) {
            if (state === 'command') {
                const item = crlf.nextLine(maxCommandLine);
                if (!item) return;
                if (item.overflow) {
                    reply('500 5.5.3 Line too long');
                    if (item.waiting) {
                        closeSession();
                        return;
                    }
                    continue;
                }
                if (!item.line) continue;
                handleCommand(item.line);
            } else if (state === 'data') {
                const item = crlf.nextLine(maxDataLine);
                if (!item) return;
                if (item.overflow) {
                    discarding = true;
                    if (item.waiting) {
                        // The rest of this overlong line is still to come; its
                        // tail must never be read as a line (e.g. a lone ".").
                        skipLineTail = true;
                        crlf.trimWaitingOverflow();
                        return;
                    }
                    skipLineTail = false;
                    continue;
                }
                if (skipLineTail) {
                    skipLineTail = false;
                    continue;
                }
                handleDataLine(item.line);
            } else {
                return;
            }
        }
    }

    function onData(chunk) {
        if (closed) return;
        crlf.push(chunk);
        if (!upgrading) pump();
    }

    socket.on('data', onData);
    socket.on('error', () => closeSession());
    socket.on('end', () => closeSession());
}

module.exports = {
    CRLF,
    DEFAULT_MAX_COMMAND_LINE,
    DEFAULT_MAX_DATA_LINE,
    DEFAULT_MAX_DATA_BYTES,
    DEFAULT_IDLE_TIMEOUT_MS,
    DEFAULT_SESSION_TIMEOUT_MS,
    CrlfBuffer,
    handleInboundConnection
};
