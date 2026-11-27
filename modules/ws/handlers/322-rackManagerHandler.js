'use strict';

/**
 * Rack Manager packets (modules/rackManager; docs/client-api/ws/rackManager.md; docs/rack-manager/README.md).
 *   rack_list {}                                     -> rack_list_response {success, servers}
 *   rack_get {server, role, params?}                 -> rack_get_response {success, role, data}      (role: a rackd role, info, jobs)
 *   rack_action {server, role, action, params?}      -> rack_action_response {success, result | job}
 *   rack_ilo {server, what, params?}                 -> rack_ilo_response {success, data}
 *   rack_ilo_action {server, action, params?}        -> rack_ilo_action_response {success, result}
 *   rack_subscribe {server} / rack_unsubscribe {server} -> *_response {success}; pushes rack_event {server, role, kind, id, data}
 *   rack_job {server, id?, cancel?, tail?}           -> rack_job_response {success, job | jobs}
 *   rack_power {server, action: on|off|status, reason, force?} -> rack_power_response {success, state, since, post?, leases, idle, deadline, settings}   (power on demand; docs/rack-manager/README.md)
 *   rack_power_settings {server, settings: {auto?, idleShutdownMin?, wakeOnDemand?}} -> {success, settings, power}
 * rack_get / rack_action / rack_job take wake: true (power the host on and wait); without it a host that is off is refused: code HOST_OFF, power: 'off'.
 * rack_subscribe takes a console lease (purpose 'console') that keeps the host awake until rack_unsubscribe or the socket closes.
 * An expected refusal (rackd not deployed, tunnel down, bad input) is answered in the response:
 * {success:false, refused:true, code, error}; only a guard failure uses error / INSUFFICIENT_PERMISSIONS.
 *
 * SECURITY: the same guard as the Administrator Terminal (320): an administrator with a full sign-in; the stored
 * session is read again at most every GUARD_TTL_MS. These packets run commands as root on the rack hosts.
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const terminal = require('../../adminTerminal');
const rack = require('../../rackManager');

const GUARD_TTL_MS = 10 * 1000;
const verdicts = new WeakMap(); // ws -> { at, ok }
const closeHooked = new WeakSet();

function readSession(handlersCtx, sessionId) {
    return new Promise((resolve) => {
        const gr = handlersCtx && handlersCtx.globalResources;
        const store = gr && typeof gr.getSessionStore === 'function' ? gr.getSessionStore() : null;
        if (!store || typeof store.get !== 'function' || !sessionId) { resolve(null); return; }
        try { store.get(sessionId, (err, sess) => resolve(err ? null : sess || null)); } catch (_) { resolve(null); }
    });
}

async function allowed(handlersCtx, ws, clientInfo, fresh) {
    if (!terminal.fullAdminClient(clientInfo)) { verdicts.delete(ws); return false; }
    const seen = verdicts.get(ws);
    if (!fresh && seen && seen.ok && Date.now() - seen.at < GUARD_TTL_MS) return true;
    const ok = terminal.sessionIsFull(await readSession(handlersCtx, clientInfo.sessionId));
    verdicts.set(ws, { at: Date.now(), ok });
    return ok;
}

const whoOf = (info) => String((info && (info.userName || info.username || info.userId || info.user)) || 'admin').slice(0, 60);

function registerPackets() {
    const reg = (type, fn, meta) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            const { ws, message, clientInfo, handlers } = ctx;
            const m = message || {};
            // writes read the stored session fresh; reads may use a verdict up to GUARD_TTL_MS old
            if (!(await allowed(handlers, ws, clientInfo, !!(meta && meta.write)))) {
                handlers.sendError(ws, 'Rack Manager needs an administrator signed in with a full sign-in', 'INSUFFICIENT_PERMISSIONS', m.requestId);
                return;
            }
            const answer = (data) => ctx.wsServer.sendToClient(ws, { type: `${type}_response`, requestId: m.requestId, data: Object.assign({ success: true }, data), timestamp: new Date().toISOString() });
            try {
                answer(await fn(ctx, m));
            } catch (e) {
                // expected refusals come back in the response, not as an error packet
                answer({ success: false, refused: true, code: e.code || 'FAILED', error: String(e.message || e).slice(0, 400), power: e.power, leases: e.leases, busy: e.busy });
                if (!e.code) console.warn(`[rackManager] ${type}: ${e.message}`);
            }
        }, { owner: 'rackManager', destructive: !!(meta && meta.write), dispatch: 'fifo', ticker: false });
    };
    const ctxOf = (ctx, m) => ({ via: 'ws', who: whoOf(ctx.clientInfo), wake: !!(m && m.wake === true) });

    reg('rack_list', async () => ({ servers: await rack.list() }));
    reg('rack_get', async (ctx, m) => rack.get(m.server, m.role, m.params, { wake: m.wake === true, who: whoOf(ctx.clientInfo) }));
    reg('rack_action', async (ctx, m) => rack.action(m.server, m.role, m.action, m.params, ctxOf(ctx, m)), { write: true });
    reg('rack_ilo', async (ctx, m) => rack.iloGet(m.server, m.what, m.params));
    reg('rack_ilo_action', async (ctx, m) => rack.iloAction(m.server, m.action, m.params, ctxOf(ctx)), { write: true });
    reg('rack_job', async (ctx, m) => rack.job(m.server, m.id, { cancel: m.cancel === true, tail: m.tail }, ctxOf(ctx, m)), { write: true });
    reg('rack_power', async (ctx, m) => {
        const action = String(m.action || 'status');
        return rack.powerAction(m.server, action, { via: 'ws', who: whoOf(ctx.clientInfo), reason: m.reason, force: m.force === true, confirm: true, wait: false });
    }, { write: true });
    reg('rack_power_settings', async (ctx, m) => rack.setPowerSettings(m.server, m.settings, ctxOf(ctx)), { write: true });
    reg('rack_subscribe', async (ctx, m) => {
        const { ws } = ctx;
        if (!closeHooked.has(ws) && typeof ws.once === 'function') { closeHooked.add(ws); ws.once('close', () => rack.unsubscribeAll(ws)); }
        rack.subscribe(m.server, ws, (ev) => ctx.wsServer.sendToClient(ws, { type: 'rack_event', data: ev, timestamp: new Date().toISOString() }), { lease: true });
        return { server: m.server };
    });
    reg('rack_unsubscribe', async (ctx, m) => { rack.serverOf(m.server); rack.unsubscribe(m.server, ctx.ws); return { server: m.server }; });
}

module.exports = { registerPackets, _test: { allowed } };
