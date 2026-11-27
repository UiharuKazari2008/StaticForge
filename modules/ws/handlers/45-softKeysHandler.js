const wsPacketRegistry = require('../wsPacketRegistry');

// AI-generated soft key profiles (StaticForge #1414). docs/client-api/ws/softKeys.md; the work is in modules/softKeyGenerate.js.
//
//   softkeys_engines      {}                                      -> { success, engines: [{ id, name, defaultModel, ready, models }], saved: { engine, model } }
//   softkeys_default_set  { engine, model }                       -> { success, saved }
//   softkeys_generate     { pkg, label, probe, wish, design, engine, model }
//                          -> { success, profile, items, problems, notes, engine, model, ms }
//
// Requests only: nothing here is broadcast or pushed, and no notice, sound or toast is raised (the page shows the answer).

const gen = () => require('../../softKeyGenerate'); // at call time: a hot reload of the module takes effect at once

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[45-softKeysHandler] registerPackets: missing handlersCtx');
        return;
    }
    const ok = (ws, message, data) => handlersCtx.sendToClient(ws, {
        type: `${message.type}_response`,
        requestId: message.requestId || null,
        data: { success: true, ...data },
        timestamp: new Date().toISOString()
    });
    const fail = (ws, message, error, fallback) => handlersCtx.sendError(ws, (error && error.message) || fallback, (error && error.code) || 'SOFTKEYS_ERROR', message.requestId);
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            try {
                await fn(ctx.ws, ctx.message, handlersCtx.globalResources);
            } catch (error) {
                fail(ctx.ws, ctx.message, error, 'Soft key request failed');
            }
        }, { owner: 'softKeys', ...meta });
    };

    reg('softkeys_engines', async (ws, message, gr) => {
        ok(ws, message, await gen().engines(gr));
    }, { name: 'Read Soft Key Engines' });

    reg('softkeys_default_set', async (ws, message, gr) => {
        ok(ws, message, { saved: await gen().saveDefault(gr, message) });
    }, { name: 'Save Soft Key Engine', destructive: true });

    reg('softkeys_generate', async (ws, message, gr) => {
        const answer = await gen().generate(gr, {
            pkg: message.pkg, label: message.label, probe: message.probe, wish: message.wish,
            design: message.design, engine: message.engine, model: message.model
        });
        ok(ws, message, answer);
    }, { name: 'Generate Soft Keys' });
}

module.exports = { registerPackets };

require('../../hotReload').mark(module);
