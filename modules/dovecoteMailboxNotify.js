/**
 * Per-mailbox notify-forward address for Dovecote deliveries.
 *
 * Each mailbox can register one external address. On inbox delivery the
 * server sends a short plain notice through the outbound relay:
 *   "You have new mail in <mailbox>: <from> — <subject>"
 * No original body, no attachments. Notices carry X-Dovecote-Notify-Forward
 * so a bounced or looped copy never notifies again.
 *
 * Stored in dovecote.db next to the per-mailbox webhook. Live immediately.
 *
 * Delivery publishes mailbox_new_mail (modules/dovecoteMailboxEvents.js).
 * This dispatcher consumes that stream — it does not hook sendMail.
 */

'use strict';

const { getDb } = require('./dovecoteDatabase');
const addresses = require('./mailGatewayAddresses');

const MAX_ADDRESS_LENGTH = 254;
const DEFAULT_COALESCE_MS = 2 * 60 * 1000;
const DEFAULT_GLOBAL_PER_MINUTE = 20;
const LOOP_HEADER = 'X-Dovecote-Notify-Forward';
const LOOP_HEADER_KEY = 'x-dovecote-notify-forward';
// local@labels.tld — no spaces, no own-domain check happens after this.
const EMAIL_RE = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

let testOverrides = null;
let eventBound = false;
const pending = new Map();
const lastSentAt = new Map();
const timers = new Map();
const inflight = new Set();
const noticeHits = [];

function setTestOverrides(overrides) {
    testOverrides = overrides || null;
}

function resetForTests() {
    testOverrides = null;
    eventBound = false;
    pending.clear();
    lastSentAt.clear();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    inflight.clear();
    noticeHits.length = 0;
}

function nowIso() {
    return new Date().toISOString();
}

function nowMs() {
    if (testOverrides && typeof testOverrides.now === 'function') return testOverrides.now();
    return Date.now();
}

function notifyConfig() {
    if (testOverrides && testOverrides.config) return testOverrides.config;
    try {
        const gr = require('./globalResources');
        const cfg = gr.getConfig() || {};
        return (cfg.dovecote && cfg.dovecote.notify) || {};
    } catch (_err) {
        return {};
    }
}

function coalesceMs() {
    if (testOverrides && testOverrides.coalesceMs != null) {
        const value = Number(testOverrides.coalesceMs);
        return Number.isFinite(value) && value >= 0 ? value : DEFAULT_COALESCE_MS;
    }
    const value = Number(notifyConfig().coalesceMs);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_COALESCE_MS;
}

function globalPerMinute() {
    if (testOverrides && testOverrides.globalPerMinute != null) {
        const value = Number(testOverrides.globalPerMinute);
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_GLOBAL_PER_MINUTE;
    }
    const value = Number(notifyConfig().globalPerMinute);
    return Number.isFinite(value) && value > 0 ? Math.min(120, Math.floor(value)) : DEFAULT_GLOBAL_PER_MINUTE;
}

function dovecoteMail() {
    // isValidOwner / DovecoteError / audit: modules/dovecoteMail.js
    return require('./dovecoteMail');
}

function notifyRow(owner) {
    return getDb().prepare(
        'SELECT owner, address, updated_at FROM dovecote_mailbox_notify_forward WHERE owner = ?'
    ).get(owner) || null;
}

function publicNotifyView(owner, row) {
    return {
        mailbox: owner,
        address: row ? row.address : null
    };
}

function validateNotifyAddress(raw) {
    const mail = dovecoteMail();
    const text = String(raw == null ? '' : raw).trim();
    if (!text) throw new mail.DovecoteError('Notify forward address is required', 'INVALID_NOTIFY_ADDRESS');
    if (text.length > MAX_ADDRESS_LENGTH) {
        throw new mail.DovecoteError('Notify forward address is too long', 'INVALID_NOTIFY_ADDRESS');
    }
    if (/[\r\n]/.test(text)) {
        throw new mail.DovecoteError('Notify forward address is not valid', 'INVALID_NOTIFY_ADDRESS');
    }
    const email = addresses.normalizeEmail(text);
    if (!email || !EMAIL_RE.test(email)) {
        throw new mail.DovecoteError('Notify forward address is not valid', 'INVALID_NOTIFY_ADDRESS');
    }
    const parts = addresses.splitLocalDomain(email);
    if (!parts) {
        throw new mail.DovecoteError('Notify forward address is not valid', 'INVALID_NOTIFY_ADDRESS');
    }
    if (addresses.isOurPublicDomain(parts.domain)) {
        throw new mail.DovecoteError(
            'Notify forward address cannot be on the Dreamscape domain',
            'INVALID_NOTIFY_ADDRESS'
        );
    }
    if (addresses.isInternalDisplayDomain(parts.domain)) {
        throw new mail.DovecoteError(
            'Notify forward address cannot be an internal mailbox address',
            'INVALID_NOTIFY_ADDRESS'
        );
    }
    return email;
}

function setMailboxNotifyForward(owner, { address } = {}) {
    const mail = dovecoteMail();
    if (!mail.isValidOwner(owner)) throw new mail.DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    const email = validateNotifyAddress(address);
    getDb().prepare(`
        INSERT INTO dovecote_mailbox_notify_forward (owner, address, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(owner) DO UPDATE SET address = excluded.address, updated_at = excluded.updated_at
    `).run(owner, email, nowIso());
    mail.audit(owner, 'set_mailbox_notify_forward', null, true, `address=${email}`);
    return publicNotifyView(owner, notifyRow(owner));
}

function getMailboxNotifyForward(owner) {
    const mail = dovecoteMail();
    if (!mail.isValidOwner(owner)) throw new mail.DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    return publicNotifyView(owner, notifyRow(owner));
}

function clearMailboxNotifyForward(owner) {
    const mail = dovecoteMail();
    if (!mail.isValidOwner(owner)) throw new mail.DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    dropPending(owner);
    getDb().prepare('DELETE FROM dovecote_mailbox_notify_forward WHERE owner = ?').run(owner);
    mail.audit(owner, 'clear_mailbox_notify_forward', null, true, null);
    return publicNotifyView(owner, null);
}

function sanitizeHeaderPart(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

function noticeSubject(mailbox, state) {
    if (state.count > 1) {
        return `You have ${state.count} new messages in ${mailbox}`;
    }
    const from = sanitizeHeaderPart(state.from) || '(unknown)';
    const subject = sanitizeHeaderPart(state.subject) || '(no subject)';
    return `You have new mail in ${mailbox}: ${from} — ${subject}`;
}

function isNotifyLoopHeader(headers) {
    if (!headers || typeof headers !== 'object') return false;
    const raw = headers[LOOP_HEADER_KEY] != null ? headers[LOOP_HEADER_KEY] : headers[LOOP_HEADER];
    if (raw == null) return false;
    const value = String(Array.isArray(raw) ? raw[0] : raw).trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
}

function ownExternalAddress(mailbox) {
    try {
        return addresses.normalizeEmail(require('./mailGateway').toExternal(mailbox) || '');
    } catch (_err) {
        return '';
    }
}

function isSelfSent(mailbox, from) {
    const src = String(from || '').trim().toLowerCase();
    if (!src) return false;
    if (src === mailbox) return true;
    const extracted = addresses.normalizeEmail(from);
    if (extracted && extracted === mailbox) return true;
    const own = ownExternalAddress(mailbox);
    if (own && (src === own || extracted === own)) return true;
    return false;
}

function shouldSkipDelivery(delivery) {
    if (!delivery || !delivery.mailbox) return true;
    if (delivery.folder === 'spam' || delivery.spam === true) return true;
    if (delivery.notifyLoop === true) return true;
    if (isNotifyLoopHeader(delivery.headers)) return true;
    if (isSelfSent(delivery.mailbox, delivery.from)) return true;
    return false;
}

function remainingWindowMs(mailbox) {
    const last = lastSentAt.get(mailbox);
    if (!last) return 0;
    const window = coalesceMs();
    const elapsed = nowMs() - last;
    if (elapsed >= window) return 0;
    return window - elapsed;
}

function dropPending(mailbox) {
    const timer = timers.get(mailbox);
    if (timer) clearTimeout(timer);
    timers.delete(mailbox);
    pending.delete(mailbox);
}

function scheduleFlush(mailbox, wait) {
    if (timers.has(mailbox)) return;
    const job = new Promise((resolve) => {
        const run = () => {
            timers.delete(mailbox);
            Promise.resolve()
                .then(() => flushMailbox(mailbox))
                .catch((err) => {
                    console.error('Dovecote mailbox notify failed:', err.message);
                })
                .finally(resolve);
        };
        const delay = wait > 0 ? wait : 0;
        const timer = setTimeout(run, delay);
        timers.set(mailbox, timer);
    });
    inflight.add(job);
    job.finally(() => inflight.delete(job));
}

function enqueueDelivery(delivery) {
    const mailbox = delivery.mailbox;
    if (!notifyRow(mailbox)) return;
    let state = pending.get(mailbox);
    if (!state) {
        state = { count: 0, from: '', subject: '' };
        pending.set(mailbox, state);
        scheduleFlush(mailbox, remainingWindowMs(mailbox));
    }
    state.count += 1;
    if (state.count === 1) {
        state.from = String(delivery.from || '');
        state.subject = String(delivery.subject || '');
    }
}

function nextNoticeWaitMs() {
    const now = nowMs();
    const cap = globalPerMinute();
    const recent = noticeHits.filter((ts) => now - ts < 60000);
    noticeHits.length = 0;
    recent.forEach((ts) => noticeHits.push(ts));
    if (noticeHits.length < cap) return 0;
    return Math.max(0, 60000 - (now - noticeHits[0]));
}

function noteNoticeSent() {
    noticeHits.push(nowMs());
}

async function flushMailbox(mailbox) {
    const state = pending.get(mailbox);
    pending.delete(mailbox);
    if (!state || !state.count) return { skipped: true };
    const row = notifyRow(mailbox);
    if (!row) return { skipped: true };
    const wait = nextNoticeWaitMs();
    if (wait > 0) {
        pending.set(mailbox, state);
        scheduleFlush(mailbox, wait);
        return { delayed: true };
    }
    lastSentAt.set(mailbox, nowMs());
    noteNoticeSent();
    return sendNotice(mailbox, row.address, state);
}

function submitFn() {
    if (testOverrides && testOverrides.submitOutbound) return testOverrides.submitOutbound;
    return require('./mailGateway').submitOutbound;
}

async function sendNotice(mailbox, address, state) {
    const subject = noticeSubject(mailbox, state);
    const extraHeaders = {};
    extraHeaders[LOOP_HEADER] = '1';
    try {
        await submitFn()({
            fromOwner: mailbox,
            to: [address],
            subject,
            body: '',
            format: 'text',
            skipSignature: true,
            extraHeaders
        });
        dovecoteMail().audit(
            'system',
            'mailbox_notify_forward',
            null,
            true,
            `mailbox=${mailbox} dest=${address} count=${state.count}`
        );
        return { ok: true, count: state.count };
    } catch (err) {
        const message = err && err.message ? err.message : 'notify send failed';
        dovecoteMail().audit(
            'system',
            'mailbox_notify_forward',
            null,
            false,
            `mailbox=${mailbox} dest=${address} count=${state.count} error=${String(message).slice(0, 180)}`
        );
        return { ok: false, error: message };
    }
}

function onMailboxNewMail(event) {
    if (shouldSkipDelivery(event)) return;
    try {
        enqueueDelivery(event);
    } catch (err) {
        console.error('Dovecote mailbox notify enqueue failed:', err.message);
    }
}

function notifyDeliveries(deliveries) {
    if (!Array.isArray(deliveries) || !deliveries.length) return;
    deliveries.forEach(onMailboxNewMail);
}

function bindEventStream() {
    eventBound = true;
    // subscribe: modules/dovecoteMailboxEvents.js — Set.add is idempotent
    require('./dovecoteMailboxEvents').subscribe(onMailboxNewMail);
}

async function waitForIdle() {
    while (inflight.size) {
        await Promise.all(Array.from(inflight));
    }
}

async function handleMailboxNotifyTool(name, owner, input) {
    if (name === 'get_mailbox_notify_forward') {
        return { success: true, ...getMailboxNotifyForward(owner) };
    }
    if (name === 'clear_mailbox_notify_forward') {
        return { success: true, ...clearMailboxNotifyForward(owner) };
    }
    return { success: true, ...setMailboxNotifyForward(owner, input || {}) };
}

function hasMailboxNotifyScope(scopes) {
    if (!Array.isArray(scopes)) return false;
    return scopes.includes('universal')
        || scopes.includes('sfapp_dovecote')
        || scopes.includes('sfapp_dovecote:notify');
}

module.exports = {
    LOOP_HEADER,
    DEFAULT_COALESCE_MS,
    DEFAULT_GLOBAL_PER_MINUTE,
    setTestOverrides,
    resetForTests,
    validateNotifyAddress,
    setMailboxNotifyForward,
    getMailboxNotifyForward,
    clearMailboxNotifyForward,
    notifyDeliveries,
    onMailboxNewMail,
    bindEventStream,
    waitForIdle,
    handleMailboxNotifyTool,
    hasMailboxNotifyScope,
    publicNotifyView,
    isNotifyLoopHeader,
    isSelfSent
};
