/**
 * StaticForge Flow Map — multi-dimensional function/variable flow mapping.
 *
 * Usage (CLI):
 *   node scripts/tools/flow-map.js scan
 *   node scripts/tools/flow-map.js list --dimension owner
 *   node scripts/tools/flow-map.js pipeline generate_image
 *   node scripts/tools/flow-map.js root generateImage
 *   node scripts/tools/flow-map.js root generate_image
 *   node scripts/tools/flow-map.js root --file public/scripts/websocket.js --fn generateImage
 *
 * Programmatic:
 *   const flowMap = require('./modules/flowMap');
 *   const map = flowMap.buildFlowMap({ includeCallGraphs: true });
 *   const md = flowMap.exportPipelineMarkdown('generate_image', map);
 */

const { buildFlowMap, groupByDimension, resolvePipeline, DIMENSIONS } = require('./buildMap');
const { scanWsFlow } = require('./scanWsFlow');
const { scanFileCallGraph, scanCallGraphs } = require('./scanCallGraph');
const {
    pipelineToSequenceMermaid,
    callGraphToFlowchartMermaid,
    ownerToGraphMermaid,
    pipelineToMarkdown
} = require('./mermaidExport');
const { PATHS, PIPELINE_ALIASES } = require('./constants');
const { buildFunctionIndex, findFunctionsByName } = require('./functionIndex');
const { resolveAndTrace, traceFromRoot, traceFromPipeline } = require('./deepTrace');
const { deepTraceToMarkdown, deepTraceToMermaid, deepTraceToJson } = require('./deepExport');
const path = require('path');

function exportPipelineMarkdown(keyOrType, map, options = {}) {
    const flowMap = map || buildFlowMap({ includeCallGraphs: true });
    const pipeline = resolvePipeline(flowMap, keyOrType);
    if (!pipeline) {
        throw new Error(`Pipeline not found: ${keyOrType}. Known: ${Object.keys(PIPELINE_ALIASES).join(', ')}`);
    }

    let callGraph = null;
    const implFile = pipeline.link?.server?.implFile;
    if (implFile && flowMap.callGraphs) {
        callGraph = flowMap.callGraphs.find((g) => g.file === implFile);
    } else if (implFile) {
        callGraph = scanFileCallGraph(path.join(PATHS.root, implFile));
    }

    return pipelineToMarkdown(pipeline, callGraph, {
        ...options,
        allClientInbound: flowMap.ws?.clientInbound
    });
}

function exportPipelineMermaid(keyOrType, map) {
    const flowMap = map || buildFlowMap();
    const pipeline = resolvePipeline(flowMap, keyOrType);
    if (!pipeline) throw new Error(`Pipeline not found: ${keyOrType}`);
    return pipelineToSequenceMermaid(pipeline, flowMap.ws?.clientInbound);
}

function exportDeepTraceMarkdown(input, options = {}) {
    const wrapped = resolveAndTrace(input, options);
    return deepTraceToMarkdown(wrapped, options);
}

function exportDeepTraceJson(input, options = {}) {
    const wrapped = resolveAndTrace(input, options);
    return deepTraceToJson(wrapped);
}

module.exports = {
    PATHS,
    PIPELINE_ALIASES,
    DIMENSIONS,
    buildFlowMap,
    groupByDimension,
    resolvePipeline,
    scanWsFlow,
    scanFileCallGraph,
    scanCallGraphs,
    buildFunctionIndex,
    findFunctionsByName,
    resolveAndTrace,
    traceFromRoot,
    traceFromPipeline,
    pipelineToSequenceMermaid,
    callGraphToFlowchartMermaid,
    ownerToGraphMermaid,
    pipelineToMarkdown,
    exportPipelineMarkdown,
    exportPipelineMermaid,
    deepTraceToMarkdown,
    deepTraceToMermaid,
    deepTraceToJson,
    exportDeepTraceMarkdown,
    exportDeepTraceJson
};
