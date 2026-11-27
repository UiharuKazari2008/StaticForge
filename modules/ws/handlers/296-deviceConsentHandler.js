const wsPacketRegistry = require('../wsPacketRegistry');
const inbox = require('../../notificationInbox');

// Device consent (Yozora #1284, P3): the household's answer to an agent's request for a phone.
//
//   device_consent_answer  { id, answer: 'allow'|'deny' }  -> { ok, error? }
//     id: the notice id (device-ask:<leaseId>) or the bare lease id. Answered through modules/deviceConsent.js; the ask's
//     notice is cleared at once (modules/deviceConsentNotices.js). Household admin / dev_admin only; a test-lane device
//     (modules/testDevices.js) is refused. Destructive. A request / response only: nothing is broadcast.
//   device_consent_settings_get  {}            -> { ok, settings }
//   device_consent_settings_set  { patch }     -> { ok, settings } | { ok:false, error }
//     The household's consent settings (modules/deviceConsent.js settings() / setSettings(patch)): timeoutSec (10..600),
//     onTimeout (wait|deny|allow), readOnly (ask|allow), consentDevices (list of device ids). Same audience as the answer
//     packet (admin / dev_admin, never the test lane); the set is destructive. Read when Fleet's page opens and after a save.

const ASK_PREFIX = 'device-ask:';
const HOLD_PREFIX = 'device-hold:';
const canUse = (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || '')));
// the household's range for the loud wait (the lease logic itself accepts 1..3600)
const MIN_WAIT_SEC = 10;
const MAX_WAIT_SEC = 600;

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
        const answer = String(f.answer || '').toLowerCase();
        // End on the in-use notice (device-hold:<device>): the holder loses the phone now
        if (leaseId.startsWith(HOLD_PREFIX) && answer === 'end') {
            const ci0 = ctx.clientInfo || {};
            const by0 = `household:${ci0.as && ci0.as.id ? String(ci0.as.id).slice(0, 8) : String(ci0.clientId || ci0.userType || 'client').slice(0, 24)}`;
            let r0;
            try { r0 = require('../../deviceConsent').endHold(leaseId.slice(HOLD_PREFIX.length), by0) || { ok: false, error: 'no answer' }; } catch (e) { r0 = { ok: false, error: e.message }; }
            try { inbox.clear('admin', leaseId, 'server'); } catch (_) { /* gone */ }
            reply(ctx.ws, m, r0.ok ? { ok: true } : { ok: false, error: r0.error || 'refused' });
            return;
        }
        if (leaseId.startsWith(HOLD_PREFIX)) { reply(ctx.ws, m, { ok: false, error: 'bad request' }); return; } // only End answers a hold
        if (leaseId.startsWith(ASK_PREFIX)) leaseId = leaseId.slice(ASK_PREFIX.length);
        if (!leaseId || (answer !== 'allow' && answer !== 'deny')) { reply(ctx.ws, m, { ok: false, error: 'bad request' }); return; }
        const ci = ctx.clientInfo || {};
        const by = `household:${ci.as && ci.as.id ? String(ci.as.id).slice(0, 8) : String(ci.clientId || ci.userType || 'client').slice(0, 24)}`;
        let res;
        try { res = require('../../deviceConsent').answer(leaseId, answer, by) || { ok: false, error: 'no answer' }; } catch (e) { res = { ok: false, error: e.message }; }
        // the question is dealt with whatever came of it (already answered, lapsed): its notice comes down now
        try { require('../../deviceConsentNotices').clearAsk(leaseId); } catch (_) { /* no notice */ }
        reply(ctx.ws, m, res.ok ? { ok: true } : { ok: false, error: res.error || 'refused' });
    }, { owner: 'device-consent', destructive: true });

    const settingsPacket = (type, run, meta) => wsPacketRegistry.registerWsPacket(type, async (ctx) => {
        const m = ctx.message || {};
        if (!canUse(ctx.clientInfo)) {
            handlersCtx.sendError(ctx.ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', m.requestId);
            return;
        }
        if (inbox.userOf(ctx.clientInfo) === 'test') { reply(ctx.ws, m, { ok: false, error: 'test device' }); return; }
        let res;
        try { res = { ok: true, settings: run(m) }; } catch (e) { res = { ok: false, error: e.message || 'refused' }; }
        reply(ctx.ws, m, res);
    }, meta);
    settingsPacket('device_consent_settings_get', () => require('../../deviceConsent').settings(), { owner: 'device-consent' });
    settingsPacket('device_consent_settings_set', (m) => {
        const f = m.data && typeof m.data === 'object' && !Array.isArray(m.data) ? Object.assign({}, m.data, m) : m;
        const patch = f.patch;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('bad request');
        if (patch.timeoutSec !== undefined) {
            const t = Math.round(Number(patch.timeoutSec));
            if (!Number.isFinite(t) || t < MIN_WAIT_SEC || t > MAX_WAIT_SEC) throw new Error(`timeoutSec must be ${MIN_WAIT_SEC} to ${MAX_WAIT_SEC} seconds`);
        }
        return require('../../deviceConsent').setSettings(patch);
    }, { owner: 'device-consent', destructive: true });
}

module.exports = { registerPackets };
