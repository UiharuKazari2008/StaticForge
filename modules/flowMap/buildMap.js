/**
 * Assemble multi-dimensional flow map from WS scan + optional call graphs.
 */

const path = require('path');
const { PIPELINE_ALIASES, PATHS } = require('./constants');
const { scanWsFlow } = require('./scanWsFlow');
const { scanCallGraphs } = require('./scanCallGraph');

const DIMENSIONS = ['side', 'owner', 'file', 'messageType', 'role', 'pipeline'];

/**
 * @param {ReturnType<typeof scanWsFlow>} wsData
 */
function groupByDimension(wsData, dimension) {
    switch (dimension) {
        case 'side':
            return {
                client: {
                    inbound: wsData.clientInbound,
                    outbound: wsData.clientOutbound
                },
                server: {
                    handlers: wsData.serverHandlers,
                    outbound: wsData.serverOutbound
                }
            };

        case 'owner':
            return groupByKey(wsData.serverHandlers, (h) => h.owner || 'unknown');

        case 'file':
            return groupFiles(wsData);

        case 'messageType': {
            const byType = {};
            for (const h of wsData.serverHandlers) {
                byType[h.type] = byType[h.type] || { handlers: [], links: [] };
                byType[h.type].handlers.push(h);
            }
            for (const link of wsData.links) {
                if (link.requestType && byType[link.requestType]) {
                    byType[link.requestType].link = link;
                }
            }
            return byType;
        }

        case 'role':
            return {
                'client-inbound': wsData.clientInbound,
                'client-outbound': wsData.clientOutbound,
                'server-handler': wsData.serverHandlers,
                'server-outbound': wsData.serverOutbound
            };

        case 'pipeline':
            return buildPipelineViews(wsData);

        default:
            throw new Error(`Unknown dimension: ${dimension}. Valid: ${DIMENSIONS.join(', ')}`);
    }
}

function groupByKey(items, keyFn) {
    const out = {};
    for (const item of items) {
        const k = keyFn(item);
        if (!out[k]) out[k] = [];
        out[k].push(item);
    }
    return out;
}

function groupFiles(wsData) {
    const files = {};
    const add = (entry) => {
        const f = entry.file;
        if (!f) return;
        if (!files[f]) files[f] = { inbound: [], outbound: [], handlers: [] };
        if (entry.role === 'inbound') files[f].inbound.push(entry);
        else if (entry.role === 'outbound' && entry.side === 'client') files[f].outbound.push(entry);
        else if (entry.role === 'handler') files[f].handlers.push(entry);
        else if (entry.role === 'outbound' && entry.side === 'server') files[f].outbound.push(entry);
    };
    wsData.clientInbound.forEach(add);
    wsData.clientOutbound.forEach(add);
    wsData.serverHandlers.forEach(add);
    wsData.serverOutbound.forEach(add);
    return files;
}

function buildPipelineViews(wsData) {
    const pipelines = {};

    for (const [key, def] of Object.entries(PIPELINE_ALIASES)) {
        const link = wsData.links.find((l) => l.requestType === def.requestType);
        const relatedLinks = (def.relatedRequestTypes || [])
            .map((t) => wsData.links.find((l) => l.requestType === t))
            .filter(Boolean);

        pipelines[key] = {
            label: def.label,
            requestType: def.requestType,
            responseTypes: def.responseTypes,
            link,
            relatedLinks
        };
    }

    return pipelines;
}

/**
 * Build full flow map including optional call graphs for pipeline impl files.
 */
function buildFlowMap(options = {}) {
    const wsData = scanWsFlow();
    const map = {
        version: 1,
        scannedAt: wsData.scannedAt,
        dimensions: DIMENSIONS,
        counts: wsData.counts,
        ws: wsData,
        views: {}
    };

    for (const dim of DIMENSIONS) {
        map.views[dim] = groupByDimension(wsData, dim);
    }

    if (options.includeCallGraphs) {
        const implFiles = new Set();
        for (const link of wsData.links) {
            if (link.server && link.server.implFile) {
                implFiles.add(path.join(PATHS.root, link.server.implFile));
            }
        }
        map.callGraphs = scanCallGraphs([...implFiles]);
    }

    return map;
}

/**
 * Resolve a single pipeline by key or request message type.
 */
function resolvePipeline(map, keyOrType) {
    const pipelines = map.views.pipeline;
    if (pipelines[keyOrType]) return { key: keyOrType, ...pipelines[keyOrType] };

    for (const [key, pipe] of Object.entries(pipelines)) {
        if (pipe.requestType === keyOrType) return { key, ...pipe };
    }

    const link = map.ws.links.find((l) => l.requestType === keyOrType);
    if (link) {
        return {
            key: keyOrType,
            label: keyOrType,
            requestType: keyOrType,
            responseTypes: link.responseTypes,
            link
        };
    }

    return null;
}

module.exports = {
    DIMENSIONS,
    buildFlowMap,
    groupByDimension,
    resolvePipeline,
    buildPipelineViews
};
