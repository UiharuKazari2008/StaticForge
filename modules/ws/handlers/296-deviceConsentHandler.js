const wsPacketRegistry = require('../wsPacketRegistry');
const inbox = require('../../notificationInbox');

// Device consent (Yozora #1284, P3): the household's answer to an agent's request for a phone.
//
//   device_consent_answer  { id, answer: 'allow'|'deny' }  -> { ok, error? }
//     id: the notice id (device-ask:<leaseId>) or the bare lease id. Answered through modules/deviceConsent.js; the ask's
//     notice is cleared at once (modules/deviceConsentNotices.js). Household admin / dev_admin only. A test-lane client
//     (modules/testDevices.js) answers only an ask on the test lane (a lease on a testConsentDevices device); an admin client
//     answers either. A client an agent drives (a tab it ran client JS on in the last 120 s, a headless tab) is refused:
//     'An agent cannot answer for Yukimi'. Destructive. A request / response only: nothing is broadcast.
//     End on the in-use notice (id device-hold:<device>, answer end): ends only the lease that notice is about (its data.leaseId;
//     a packet leaseId must match it) while it is still the held, allowed one, else { ok:false, error:'That hold is over' }.
//   device_consent_settings_get  {}            -> { ok, settings }
//   device_consent_settings_set  { patch }     -> { ok, settings } | { ok:false, error }
//     The household's consent settings (modules/deviceConsent.js settings() / setSettings(patch)): timeoutSec (10..600),
//     onTimeout (wait|deny|allow), readOnly (ask|allow), consentDevices (list of device ids), testConsentDevices (list of test
//     device ids that go through the full flow on the test lane; never the Fold). Same audience as the answer packet (admin /
//     dev_admin, never the test lane, never an agent-driven client for the set); the set is destructive. Read when Fleet's page
//     opens and after a save.

const ASK_PREFIX = 'device-ask:';
const HOLD_PREFIX = 'device-hold:';
const canUse = (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || '')));
const AGENT_REFUSAL = 'An agent cannot answer for Yukimi';
/** True when an agent drives this client (it ran client JS on it lately, or it is a headless agent tab): its answers are never Yukimi's. Unknown -> refused. */
function agentDriven(info) {
    try { return require('../../agentClientBridge').isAgentDrivenClient(info) === true; } catch (e) { console.warn(`[device-consent] agent-driven check unavailable (${e && e.message}): the answer is refused`); return true; }
}
const whoIs = (info) => String((info && (info.clientId || info.userType)) || 'client').slice(0, 24);
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
        // only a person's tap counts (#1305 S4): a client an agent drives (client JS lately, a headless agent tab) never answers or ends
        if (agentDriven(ctx.clientInfo)) {
            console.warn(`[device-consent] refused an answer from an agent-driven client ${whoIs(ctx.clientInfo)}: ${String(f.id || f.leaseId || '').slice(0, 40)} ${String(f.answer || '').slice(0, 10)}`);
            reply(ctx.ws, m, { ok: false, error: AGENT_REFUSAL });
            return;
        }
        const lane = inbox.userOf(ctx.clientInfo) === 'test' ? 'test' : 'admin';
        const dc = () => require('../../deviceConsent');
        let leaseId = String(f.id || f.leaseId || '').trim();
        const answer = String(f.answer || '').toLowerCase();
        // End on the in-use notice (device-hold:<device>): the holder loses the phone now - only the lease the notice is about
        if (leaseId.startsWith(HOLD_PREFIX) && answer === 'end') {
            const ci0 = ctx.clientInfo || {};
            const by0 = `household:${ci0.as && ci0.as.id ? String(ci0.as.id).slice(0, 8) : String(ci0.clientId || ci0.userType || 'client').slice(0, 24)}`;
            const device0 = leaseId.slice(HOLD_PREFIX.length);
            let r0;
            let noticeUser = '';
            let noticeLease = '';
            try {
                const mod = dc();
                const devLane = typeof mod.laneOfDevice === 'function' ? mod.laneOfDevice(device0) : 'admin';
                if (lane === 'test' && devLane !== 'test') {
                    r0 = { ok: false, error: 'test device' }; // a test client never ends a household's hold
                } else {
                    // the lease the notice was about (its data.leaseId): a stale End ends nothing (#1305 S2)
                    const users = lane === 'test' ? ['test'] : (devLane === 'test' ? ['test', 'admin'] : ['admin', 'test']);
                    for (const u of users) {
                        let n = null;
                        try { n = inbox.get(u, leaseId); } catch (_) { n = null; }
                        if (n) { noticeUser = u; noticeLease = n.data && n.data.leaseId != null ? String(n.data.leaseId) : ''; break; }
                    }
                    const sent = f.leaseId !== undefined && f.leaseId !== null && f.leaseId !== '' ? String(f.leaseId) : null;
                    if (sent !== null && sent !== noticeLease) { noticeUser = ''; r0 = { ok: false, error: 'That hold is over' }; } // the client saw another lease: the notice is the newer hold's, it stays
                    else if (!noticeLease) r0 = { ok: false, error: 'That hold is over' };
                    else r0 = mod.endHold(device0, by0, { leaseId: noticeLease, clientLane: lane }) || { ok: false, error: 'no answer' };
                }
            } catch (e) { r0 = { ok: false, error: e.message }; }
            // the notice of the lease just dealt with comes down (ended, or already over); a newer lease's notice stays
            if (noticeLease && noticeUser) { try { inbox.clear(noticeUser, leaseId, 'server'); } catch (_) { /* gone */ } }
            reply(ctx.ws, m, r0.ok ? { ok: true } : { ok: false, error: r0.error || 'refused' });
            return;
        }
        if (leaseId.startsWith(HOLD_PREFIX)) { reply(ctx.ws, m, { ok: false, error: 'bad request' }); return; } // only End answers a hold
        if (leaseId.startsWith(ASK_PREFIX)) leaseId = leaseId.slice(ASK_PREFIX.length);
        if (!leaseId || (answer !== 'allow' && answer !== 'deny')) { reply(ctx.ws, m, { ok: false, error: 'bad request' }); return; }
        if (lane === 'test') {
            // a test device answers its own lane's asks only; a household ask stays refused
            let al = 'admin';
            try { const mod = dc(); al = typeof mod.askLane === 'function' ? mod.askLane(leaseId) : 'admin'; } catch (_) { al = 'admin'; }
            if (al === 'admin') { reply(ctx.ws, m, { ok: false, error: 'test device' }); return; }
        }
        const ci = ctx.clientInfo || {};
        const by = `household:${ci.as && ci.as.id ? String(ci.as.id).slice(0, 8) : String(ci.clientId || ci.userType || 'client').slice(0, 24)}`;
        let res;
        try { res = dc().answer(leaseId, answer, by, { clientLane: lane }) || { ok: false, error: 'no answer' }; } catch (e) { res = { ok: false, error: e.message }; }
        // the question is dealt with whatever came of it (already answered, lapsed): its notice comes down now
        // (a refusal for the lane keeps it: the question is still open)
        if (res.error !== 'test device') { try { require('../../deviceConsentNotices').clearAsk(leaseId); } catch (_) { /* no notice */ } }
        reply(ctx.ws, m, res.ok ? { ok: true } : { ok: false, error: res.error || 'refused' });
    }, { owner: 'device-consent', destructive: true });

    const settingsPacket = (type, run, meta) => wsPacketRegistry.registerWsPacket(type, async (ctx) => {
        const m = ctx.message || {};
        if (!canUse(ctx.clientInfo)) {
            handlersCtx.sendError(ctx.ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', m.requestId);
            return;
        }
        if (inbox.userOf(ctx.clientInfo) === 'test') { reply(ctx.ws, m, { ok: false, error: 'test device' }); return; }
        // the set changes what is allowed (onTimeout allow, the lists): never from a client an agent drives (#1305 S4)
        if (meta && meta.destructive && agentDriven(ctx.clientInfo)) {
            console.warn(`[device-consent] refused a settings change from an agent-driven client ${whoIs(ctx.clientInfo)}`);
            reply(ctx.ws, m, { ok: false, error: AGENT_REFUSAL });
            return;
        }
        let res;
        try { res = { ok: true, settings: run(m) }; } catch (e) { res = { ok: false, error: e.message || 'refused' }; }
        reply(ctx.ws, m, res);
    }, meta);
    settingsPacket('device_consent_settings_get', () => require('../../deviceConsent').settings(), { owner: 'device-consent' });
    settingsPacket('device_consent_settings_set', (m) => {
        const f = m.data && typeof m.data === 'object' && !Array.isArray(m.data) ? Object.assign({}, m.data, m) : m;
        const patch = f.patch;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('bad request');
        if (patch.testConsentDevices !== undefined && !Array.isArray(patch.testConsentDevices)) throw new Error('testConsentDevices must be a list of device ids');
        if (patch.timeoutSec !== undefined) {
            const t = Math.round(Number(patch.timeoutSec));
            if (!Number.isFinite(t) || t < MIN_WAIT_SEC || t > MAX_WAIT_SEC) throw new Error(`timeoutSec must be ${MIN_WAIT_SEC} to ${MAX_WAIT_SEC} seconds`);
        }
        return require('../../deviceConsent').setSettings(patch);
    }, { owner: 'device-consent', destructive: true });
}

module.exports = { registerPackets };
