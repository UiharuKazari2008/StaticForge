const wsPacketRegistry = require('../wsPacketRegistry');
const printSpooler = require('../../printSpooler');

// Print queue (Yozora #831 slice 8): generations shown as Vista printing (printer tray icon, print
// queue windows, Print Management). The state is pushed (print_queue_state, modules/printSpooler.js);
// a client reads it once on connect with print_queue_get. Signed-in administrators only.
//
//   print_queue_get                     -> { state, self }   self: this session's owner tag
//   print_queue_cancel { jobId }        -> { success, cancelled?, code?, error? }
//   print_queue_history { limit?, offset? } -> { total, jobs }  (the durable generation request log)

const isAdmin = (info) => !!info && info.authenticated !== false && (info.userType === 'admin' || info.userType === 'dev_admin');

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[306-printQueueHandler] registerPackets: missing handlersCtx');
        return;
    }
    printSpooler.bind(handlersCtx.globalResources);

    const packet = (type, run, failure, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            const { ws, message, clientInfo } = ctx;
            if (!isAdmin(clientInfo)) {
                handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }
            // a refusal is the window's business (its own message box), so it comes back in the reply
            let data;
            try {
                data = await run(message, clientInfo);
            } catch (error) {
                data = { success: false, error: failure, details: error && error.message ? error.message : String(error) };
            }
            handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
        }, { owner: 'printQueue', ...meta });
    };

    packet('print_queue_get', async (message, clientInfo) => {
        if (message && message.refreshPrinters) await printSpooler.refreshWorkerHealth(handlersCtx.globalResources);
        return {
            success: true,
            state: printSpooler.buildState(handlersCtx.globalResources),
            self: printSpooler.sessionTag(clientInfo && clientInfo.sessionId)
        };
    }, 'Failed to read the print queue');

    packet('print_queue_cancel', async (message, clientInfo) => (
        printSpooler.cancelDocument(handlersCtx.globalResources, message && message.jobId, { handlers: handlersCtx, clientInfo })
    ), 'Failed to cancel the document', { destructive: true });

    packet('print_queue_history', async (message) => ({
        success: true,
        ...printSpooler.history(handlersCtx.globalResources, { limit: message && message.limit, offset: message && message.offset })
    }), 'Failed to read the job history');
}

module.exports = { registerPackets };
