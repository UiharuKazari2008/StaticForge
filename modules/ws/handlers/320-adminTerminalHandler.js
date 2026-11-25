'use strict';

/**
 * Administrator Terminal packets (Yozora #1133; modules/adminTerminal.js; docs/client-api/ws/adminTerminal.md).
 *   admin_terminal_open   {id, cols, rows}  -> admin_terminal_open_response {success, id, pid, cols, rows}
 *   admin_terminal_input  {id, data}        (keys typed or pasted)
 *   admin_terminal_resize {id, cols, rows}
 *   admin_terminal_ack    {id, chars}       (output written into xterm: flow control)
 *   admin_terminal_close  {id}
 * Pushed to the owner's socket: admin_terminal_output {id, data}, admin_terminal_exit {id, exitCode, signal}.
 *
 * SECURITY: raw bash on the server. Every packet needs an administrator's full sign-in
 * (modules/adminTerminal.js fullAdminClient: userType admin, no application key / certificate-only /
 * approved-IP sign-in); the stored session is read again at open and at most every GUARD_TTL_MS after.
 * Anyone else is refused and nothing is spawned. Nothing typed is ever logged.
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const terminal = require('../../adminTerminal');

const GUARD_TTL_MS = 10 * 1000;
const verdicts = new WeakMap(); // ws -> { at, ok }

function readSession(handlersCtx, sessionId) {
    return new Promise((resolve) => {
        const gr = handlersCtx && handlersCtx.globalResources;
        const store = gr && typeof gr.getSessionStore === 'function' ? gr.getSessionStore() : null;
        if (!store || typeof store.get !== 'function' || !sessionId) { resolve(null); return; }
        try { store.get(sessionId, (err, sess) => resolve(err ? null : sess || null)); } catch (_) { resolve(null); }
    });
}

/** True for an administrator's full sign-in. `fresh` reads the stored session now (open); otherwise a verdict up to GUARD_TTL_MS old is used. */
async function allowed(handlersCtx, ws, clientInfo, fresh) {
    if (!terminal.fullAdminClient(clientInfo)) { verdicts.delete(ws); return false; }
    const seen = verdicts.get(ws);
    if (!fresh && seen && seen.ok && Date.now() - seen.at < GUARD_TTL_MS) return true;
    const ok = terminal.sessionIsFull(await readSession(handlersCtx, clientInfo.sessionId));
    verdicts.set(ws, { at: Date.now(), ok });
    return ok;
}

function registerPackets() {
    const reg = (type, fresh, fn) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            const { ws, message, clientInfo, handlers } = ctx;
            const m = message || {};
            if (!(await allowed(handlers, ws, clientInfo, fresh))) {
                handlers.sendError(ws, 'The Administrator Terminal needs an administrator signed in with a full sign-in', 'INSUFFICIENT_PERMISSIONS', m.requestId);
                return;
            }
            try {
                await fn(ctx, m);
            } catch (error) {
                handlers.sendError(ws, error.message, error.code || 'ADMIN_TERMINAL_FAILED', m.requestId);
            }
        }, { owner: 'adminTerminal', destructive: true, dispatch: 'fifo' });
    };
    const send = (ctx) => (type, data) => ctx.wsServer.sendToClient(ctx.ws, { type, data, timestamp: new Date().toISOString() });

    reg('admin_terminal_open', true, (ctx, m) => {
        const info = terminal.open(ctx.ws, ctx.clientInfo.sessionId, { id: m.id, cols: m.cols, rows: m.rows }, send(ctx));
        ctx.wsServer.sendToClient(ctx.ws, { type: 'admin_terminal_open_response', requestId: m.requestId, data: Object.assign({ success: true }, info), timestamp: new Date().toISOString() });
    });
    reg('admin_terminal_input', false, (ctx, m) => { terminal.write(ctx.ws, m.id, m.data); });
    reg('admin_terminal_resize', false, (ctx, m) => { terminal.resize(ctx.ws, m.id, m.cols, m.rows); });
    reg('admin_terminal_ack', false, (ctx, m) => { terminal.ack(ctx.ws, m.id, m.chars); });
    reg('admin_terminal_close', false, (ctx, m) => { terminal.close(ctx.ws, m.id); });
}

module.exports = { registerPackets, _test: { allowed } };
