const wsPacketRegistry = require('../wsPacketRegistry');
const inbox = require('../../notificationInbox');

// Device consent (Yozora #1284, P3): the household's answer to an agent's request for a phone.
//
//   device_consent_answer  { id, answer: 'allow'|'deny' }  -> { ok, error? }
//     id: the notice id (device-ask:<leaseId>) or the bare lease id. Answered through modules/deviceConsent.js; the ask's
//     notice is cleared at once (modules/deviceConsentNotices.js). Household admin / dev_admin only; a test-lane device
//     (modules/testDevices.js) is refused. Destructive. A request / response only: nothing is broadcast.

const ASK_PREFIX = 'device-ask:';
const canUse = (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || '')));

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[296-deviceConsentHandler] registerPackets: missing handlersCtx');
        return;
    }
    const reply = (ws, m, data) => handlersCtx.sendToClient(ws, { type: `${m.type}_response`, requestId: m.requestId, data, timestamp: new Date().toISOString() });
    wsPacketRegistry.registerWsPacket('device_consent_answer', async (ctx) => {
        const m = ctx.message || {};
        if (!canUse(ctx.clientInfo)) {
            handlersCtx.sendError(ctx.ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', m.requestId);
            return;
        }
        // the Android app's background link sends its fields in data (as the inbox buttons do)
        const f = m.data && typeof m.data === 'object' && !Array.isArray(m.data) ? Object.assign({}, m.data, m) : m;
        if (inbox.userOf(ctx.clientInfo) === 'test') { reply(ctx.ws, m, { ok: false, error: 'test device' }); return; }
        let leaseId = String(f.id || f.leaseId || '').trim();
        if (leaseId.startsWith(ASK_PREFIX)) leaseId = leaseId.slice(ASK_PREFIX.length);
        const answer = String(f.answer || '').toLowerCase();
        if (!leaseId || (answer !== 'allow' && answer !== 'deny')) { reply(ctx.ws, m, { ok: false, error: 'bad request' }); return; }
        const ci = ctx.clientInfo || {};
        const by = `household:${ci.as && ci.as.id ? String(ci.as.id).slice(0, 8) : String(ci.clientId || ci.userType || 'client').slice(0, 24)}`;
        let res;
        try { res = require('../../deviceConsent').answer(leaseId, answer, by) || { ok: false, error: 'no answer' }; } catch (e) { res = { ok: false, error: e.message }; }
        // the question is dealt with whatever came of it (already answered, lapsed): its notice comes down now
        try { require('../../deviceConsentNotices').clearAsk(leaseId); } catch (_) { /* no notice */ }
        reply(ctx.ws, m, res.ok ? { ok: true } : { ok: false, error: res.error || 'refused' });
    }, { owner: 'device-consent', destructive: true });
}

module.exports = { registerPackets };
