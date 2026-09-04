/**
 * Global autofill/SmartText ranking config — DSAP-SMF admin applet at autofill.dreamscape.jp.
 * Backed by config.autofillRanking (modules/autofillRankingSettings.js), applied to
 * modules/tag-lookup.js (server ranking) and broadcast so connected clients update
 * public/scripts/comp/autofillRankingConfig.js (client ranking) live.
 */
const wsPacketRegistry = require('../wsPacketRegistry');
const { normalizeAutofillRanking, mergeAutofillRankingPatch } = require('../../autofillRankingSettings');
const { normalizeAutofillSearchSettings } = require('../../autofillSearchSettings');
const { DEFAULT_FORGE_MODEL } = require('../../modelFeatures');

const AUTOFILL_RANKING_DESTRUCTIVE = { destructive: true };

async function handleGetAutofillRanking(handlers, ws, message, clientInfo, wsServer) {
    try {
        const config = handlers.globalResources.getConfig() || {};
        const ranking = normalizeAutofillRanking(config.autofillRanking);
        handlers.sendToClient(ws, {
            type: 'get_autofill_ranking_response',
            requestId: message.requestId,
            data: { ranking },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_autofill_ranking:', error);
        handlers.sendError(ws, 'Failed to load autofill ranking config', error.message, message.requestId);
    }
}

async function handleUpdateAutofillRanking(handlers, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlers.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const patch = message.ranking;
        if (!patch || typeof patch !== 'object') {
            handlers.sendError(ws, 'Missing ranking object', 'update_autofill_ranking', message.requestId);
            return;
        }

        const config = handlers.globalResources.getConfig() || {};
        const previousVersion = normalizeAutofillRanking(config.autofillRanking).rankingVersion;
        const merged = mergeAutofillRankingPatch(config.autofillRanking, patch);
        merged.rankingVersion = previousVersion + 1;

        await handlers.globalResources.modifyConfig('config', (cfg) => {
            cfg.autofillRanking = merged;
            return cfg;
        });

        const tagLookup = handlers.globalResources.getTagDatabase();
        if (tagLookup && typeof tagLookup.setRankingConfig === 'function') {
            tagLookup.setRankingConfig(merged);
        }

        handlers.sendToClient(ws, {
            type: 'update_autofill_ranking_response',
            requestId: message.requestId,
            data: { success: true, ranking: merged },
            timestamp: new Date().toISOString()
        });

        wsServer.broadcastToAll({
            type: 'autofill_ranking_updated',
            data: { ranking: merged },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('update_autofill_ranking:', error);
        handlers.sendError(ws, 'Failed to save autofill ranking config', error.message, message.requestId);
    }
}

/**
 * Run the SAME server search pipeline that live autocomplete uses (searchService.searchCharacters),
 * returning the full mixed result set (characters + tags + text replacements) plus spellcheck.
 * Runs headlessly (ws=null, isolated session key) so it never streams into / clobbers the caller's
 * live autofill session. The client (autofillConfigDsapApplet.js) then applies the real client-side
 * merge/rank path (assembleRankedAutofillResults) with per-result score breakdowns.
 */
async function handleTestAutofillRanking(handlers, ws, message, clientInfo, wsServer) {
    try {
        const query = (message.query || '').trim();
        if (!query) {
            handlers.sendToClient(ws, {
                type: 'test_autofill_ranking_response',
                requestId: message.requestId,
                data: { query: '', results: [], spellCheck: null },
                timestamp: new Date().toISOString()
            });
            return;
        }

        const searchService = handlers.globalResources.getSearchService
            ? handlers.globalResources.getSearchService()
            : null;
        if (!searchService || typeof searchService.searchCharacters !== 'function') {
            handlers.sendError(ws, 'Autofill search not available', 'test_autofill_ranking', message.requestId);
            return;
        }

        const config = handlers.globalResources.getConfig() || {};
        const autofillSettings = normalizeAutofillSearchSettings(
            message.autofillSettings && typeof message.autofillSettings === 'object'
                ? message.autofillSettings
                : config.userGlobalSettings?.autofillSearch
        );

        const model = message.model || DEFAULT_FORGE_MODEL;
        // Isolated session/request keys so the test never supersedes the client's live search turn.
        const isolatedSessionId = `${clientInfo.sessionId || 'anon'}::autofill-ranking-test`;
        const testRequestId = `autofill-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // ws=null → no streaming; searchCharacters still computes and returns the full result set.
        const result = await searchService.searchCharacters(
            query, model, null, isolatedSessionId, null, testRequestId, null,
            { spellCheckText: query, isContinuation: false, autofillSettings }
        );

        handlers.sendToClient(ws, {
            type: 'test_autofill_ranking_response',
            requestId: message.requestId,
            data: {
                query,
                results: (result && Array.isArray(result.results)) ? result.results : [],
                spellCheck: (result && result.spellCheck) ? result.spellCheck : null
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('test_autofill_ranking:', error);
        handlers.sendError(ws, 'Failed to run autofill ranking test search', error.message, message.requestId);
    }
}

/**
 * Register autofill ranking WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[230-autofillRankingHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'autofillRanking', ...meta });
    };

    regFn('get_autofill_ranking', handleGetAutofillRanking);
    regFn('update_autofill_ranking', handleUpdateAutofillRanking, AUTOFILL_RANKING_DESTRUCTIVE);
    regFn('test_autofill_ranking', handleTestAutofillRanking);
}

module.exports = {
    registerPackets
};
