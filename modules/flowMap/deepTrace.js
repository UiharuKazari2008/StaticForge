/**
 * Deep function-to-function trace from a root through WS boundaries to leaves.
 */

const path = require('path');
const acorn = require('acorn');
const { PIPELINE_ALIASES, PATHS } = require('./constants');
const { buildFunctionIndex, findFunctionsByName, getFileMeta, fnId, isBuiltin } = require('./functionIndex');
const { extractCallsFromFunction, extractInlineHandlerCalls, findInboundBlockIndex } = require('./extractCalls');
const { scanWsFlow, readText } = require('./scanWsFlow');

const WS_CLIENT_OBJECTS = new Set(['wsClient', 'window.wsClient', 'this']);

const TERMINUS = {
    LEAF: 'leaf',
    EXTERNAL: 'external',
    WS_BOUNDARY: 'ws_boundary',
    CALLBACK_BOUNDARY: 'callback_boundary',
    CYCLE: 'cycle',
    REF: 'ref',
    DEPTH_LIMIT: 'depth_limit'
};

/**
 * @typedef {object} TraceNode
 * @property {string} id
 * @property {string} name
 * @property {string} file
 * @property {number} line
 * @property {string} side
 * @property {string|null} terminus
 * @property {string} [terminusReason]
 * @property {string} [callSite]
 * @property {number} [callLine]
 * @property {object} [meta]
 * @property {TraceNode[]} children
 */

function createTraceNode(fn, options = {}) {
    return {
        id: fn ? fn.id : options.id || 'unknown',
        name: fn ? fn.name : options.name || 'unknown',
        file: fn ? fn.file : options.file || '',
        line: fn ? fn.line : options.line || 0,
        side: fn ? fn.side : options.side || 'unknown',
        kind: fn ? fn.kind : options.kind || 'function',
        className: fn ? fn.className : null,
        terminus: options.terminus || null,
        terminusReason: options.terminusReason || null,
        callSite: options.callSite || null,
        callLine: options.callLine || null,
        meta: options.meta || null,
        children: []
    };
}

function resolveCallTarget(call, ctx) {
    const { fn, fileMeta, index } = ctx;

    if (call.wsOutbound && call.wsType) {
        return { type: 'ws_outbound', wsType: call.wsType, callSite: call.calleeText, callLine: call.line };
    }

    if (call.wsServerOutbound && call.wsType) {
        return { type: 'ws_server_outbound', wsType: call.wsType, callSite: call.calleeText, callLine: call.line };
    }

    if (call.kind === 'identifier') {
        const local = fileMeta.functions.find((f) => f.name === call.name);
        if (local) return { type: 'function', fn: local, callSite: call.name, callLine: call.line };

        const imp = fileMeta.imports[call.name];
        if (imp) {
            const resolved = resolveImportedFunction(imp, call.name, index);
            if (resolved) return { type: 'function', fn: resolved, callSite: call.name, callLine: call.line };
        }

        if (isBuiltin(call.name)) {
            return { type: 'external', name: call.name, reason: 'builtin', callSite: call.name, callLine: call.line };
        }

        const globalMatches = index.byName.get(call.name) || [];
        if (fn.side === 'client') {
            return { type: 'external', name: call.name, reason: 'unresolved client global', callSite: call.name, callLine: call.line };
        }

        if (globalMatches.length === 1) {
            return { type: 'function', fn: globalMatches[0], callSite: call.name, callLine: call.line };
        }
        if (globalMatches.length > 1) {
            const sameSide = globalMatches.filter((f) => f.side === fn.side);
            if (sameSide.length === 1) {
                return { type: 'function', fn: sameSide[0], callSite: call.name, callLine: call.line };
            }
            return {
                type: 'external',
                name: call.name,
                reason: `ambiguous (${globalMatches.length} definitions)`,
                callSite: call.name,
                callLine: call.line
            };
        }

        return { type: 'external', name: call.name, reason: 'unresolved', callSite: call.name, callLine: call.line };
    }

    if (call.kind === 'member') {
        if (call.object === 'this' && fn.className) {
            const method = fileMeta.functions.find(
                (f) => f.className === fn.className && f.name === call.property
            );
            if (method) {
                return { type: 'function', fn: method, callSite: call.calleeText, callLine: call.line };
            }
        }

        if (isWsClientRef(call.object)) {
            const method = findWsClientMethod(call.property, index);
            if (method) {
                return { type: 'function', fn: method, callSite: call.calleeText, callLine: call.line };
            }
        }

        if (call.object === 'handlers' || call.object.startsWith('handlers.')) {
            return {
                type: 'external',
                name: call.calleeText,
                reason: 'server handler delegate',
                callSite: call.calleeText,
                callLine: call.line
            };
        }

        if (isBuiltin(call.property)) {
            return { type: 'external', name: call.calleeText, reason: 'builtin method', callSite: call.calleeText, callLine: call.line };
        }

        const methodMatches = (index.byName.get(call.property) || []).filter((f) => f.kind === 'method');
        if (methodMatches.length === 1) {
            return { type: 'function', fn: methodMatches[0], callSite: call.calleeText, callLine: call.line };
        }

        return { type: 'external', name: call.calleeText, reason: 'unresolved method', callSite: call.calleeText, callLine: call.line };
    }

    return null;
}

function isWsClientRef(object) {
    if (!object) return false;
    if (WS_CLIENT_OBJECTS.has(object)) return true;
    if (object.endsWith('.wsClient')) return true;
    return false;
}

function findWsClientMethod(methodName, index) {
    const wsFile = relPath(PATHS.websocketClient);
    const methods = (index.byName.get(methodName) || []).filter(
        (f) => f.file === wsFile && f.kind === 'method'
    );
    return methods[0] || null;
}

function resolveImportedFunction(imp, localName, index) {
    const exportName = imp.exportName || localName;
    const fileFns = index.byFile.get(imp.file) || [];

    if (imp.kind === 'default') {
        return fileFns.find((f) => f.name === exportName) || fileFns.find((f) => f.name === localName) || null;
    }

    return fileFns.find((f) => f.name === exportName) || null;
}

function getCallsForFunction(fn, fileMeta) {
    if (!fileMeta || !fn.bodyStart || !fn.bodyEnd) return [];
    const slice = fileMeta.content.slice(fn.bodyStart, fn.bodyEnd);
    const wrapped = slice.trimStart().startsWith('{')
        ? `(async function() ${slice})`
        : `(async function(){${slice}})`;
    try {
        const ast = acorn.parse(wrapped, {
            ecmaVersion: 'latest',
            sourceType: 'script',
            locations: true,
            allowReturnOutsideFunction: true
        });
        return extractCallsFromFunction(ast.body[0].expression);
    } catch (_e) {
        return [];
    }
}

function relPath(abs) {
    return path.relative(PATHS.root, abs).replace(/\\/g, '/');
}

function traceFunction(fn, ctx, depth, visitStack) {
    if (ctx.memo.has(fn.id)) {
        const cached = ctx.memo.get(fn.id);
        return createTraceNode(fn, {
            terminus: TERMINUS.REF,
            terminusReason: 'already expanded',
            meta: { ref: cached.id }
        });
    }

    const maxDepth = ctx.options.maxDepth ?? 80;
    const node = createTraceNode(fn);

    if (depth >= maxDepth) {
        node.terminus = TERMINUS.DEPTH_LIMIT;
        node.terminusReason = `max depth ${maxDepth}`;
        return node;
    }

    const stackKey = fn.id;
    if (visitStack.has(stackKey)) {
        node.terminus = TERMINUS.CYCLE;
        node.terminusReason = 'recursive call';
        return node;
    }

    visitStack.add(stackKey);

    const fileMeta = ctx.index.files.get(fn.file);
    if (!fileMeta) {
        node.terminus = TERMINUS.LEAF;
        node.terminusReason = 'no file metadata';
        visitStack.delete(stackKey);
        return node;
    }

    const calls = getCallsForFunction(fn, fileMeta);
    if (!calls.length) {
        node.terminus = TERMINUS.LEAF;
        node.terminusReason = 'no calls';
        ctx.memo.set(fn.id, node);
        visitStack.delete(stackKey);
        return node;
    }

    for (const call of calls) {
        const target = resolveCallTarget(call, { fn, fileMeta, index: ctx.index, ws: ctx.ws });

        if (!target) continue;

        if (target.type === 'ws_outbound') {
            const wsChild = traceWsOutbound(target, ctx, depth + 1, new Set(visitStack));
            wsChild.callSite = target.callSite;
            wsChild.callLine = target.callLine;
            node.children.push(wsChild);
            continue;
        }

        if (target.type === 'ws_server_outbound') {
            const wsChild = traceWsServerOutbound(target, ctx, depth + 1, new Set(visitStack));
            wsChild.callSite = target.callSite;
            wsChild.callLine = target.callLine;
            node.children.push(wsChild);
            continue;
        }

        if (target.type === 'external') {
            node.children.push(createTraceNode(null, {
                id: `external::${target.name}::${target.callLine}`,
                name: target.name,
                file: '(external)',
                line: target.callLine || 0,
                side: fn.side,
                callSite: target.callSite,
                callLine: target.callLine,
                meta: { reason: target.reason },
                terminus: TERMINUS.EXTERNAL,
                terminusReason: target.reason
            }));
            continue;
        }

        if (target.type === 'function') {
            const child = traceFunction(target.fn, ctx, depth + 1, new Set(visitStack));
            child.callSite = target.callSite;
            child.callLine = target.callLine;
            node.children.push(child);
        }
    }

    if (!node.terminus && !node.children.length) {
        node.terminus = TERMINUS.LEAF;
        node.terminusReason = 'calls not resolved';
    }

    ctx.memo.set(fn.id, node);
    visitStack.delete(stackKey);
    return node;
}

function traceWsOutbound(target, ctx, depth, visitStack) {
    const wsType = target.wsType;
    const link = ctx.ws.links.find((l) => l.requestType === wsType);
    const handler = ctx.ws.serverHandlers.find((h) => h.type === wsType);

    const node = createTraceNode(null, {
        id: `ws::outbound::${wsType}`,
        name: `WS → ${wsType}`,
        file: '(websocket)',
        line: target.callLine || 0,
        side: 'client',
        meta: {
            wsType,
            requestType: wsType,
            handler: handler || null,
            implFile: link?.server?.implFile || null
        }
    });
    node.terminus = TERMINUS.WS_BOUNDARY;

    if (!handler || !handler.handlerFn || handler.handlerFn === '(legacy switch)') {
        node.terminusReason = handler ? 'legacy or unknown handler' : 'no server handler registered';
        return node;
    }

    const handlerFn = findHandlerFunction(handler, link, ctx.index);
    if (!handlerFn) {
        node.terminusReason = `handler ${handler.handlerFn} not indexed`;
        return node;
    }

    const handlerNode = traceFunction(handlerFn, ctx, depth, visitStack);
    handlerNode.callSite = `server:${handler.handlerFn}`;
    handlerNode.meta = { ...(handlerNode.meta || {}), registration: handler };
    node.children.push(handlerNode);
    return node;
}

function traceWsServerOutbound(target, ctx, depth, visitStack) {
    const wsType = target.wsType;
    const inbounds = ctx.ws.clientInbound.filter((i) => i.type === wsType);

    const node = createTraceNode(null, {
        id: `ws::inbound::${wsType}`,
        name: `WS ← ${wsType}`,
        file: '(websocket)',
        line: target.callLine || 0,
        side: 'server',
        meta: { wsType, responseType: wsType, inbounds }
    });
    node.terminus = TERMINUS.WS_BOUNDARY;

    if (!inbounds.length) {
        node.terminusReason = 'no client inbound handler';
        return node;
    }

    for (const inbound of inbounds) {
        const cbNode = traceInboundHandler(inbound, ctx, depth, visitStack);
        node.children.push(cbNode);
    }

    return node;
}

function findHandlerFunction(handler, link, index) {
    const name = handler.handlerFn;
    const candidates = [];

    if (link?.server?.implFile) {
        candidates.push(...(index.byFile.get(link.server.implFile) || []).filter((f) => f.name === name));
    }
    candidates.push(...(index.byFile.get(handler.file) || []).filter((f) => f.name === name));

    const all = index.byName.get(name) || [];
    for (const fn of all) {
        if (!candidates.some((c) => c.id === fn.id)) candidates.push(fn);
    }

    return candidates[0] || null;
}

function traceInboundHandler(inbound, ctx, depth, visitStack) {
    const node = createTraceNode(null, {
        id: `inbound::${inbound.type}::${inbound.file}::${inbound.line}`,
        name: `inbound:${inbound.type}`,
        file: inbound.file,
        line: inbound.line,
        side: 'client',
        meta: { inbound }
    });
    node.terminus = TERMINUS.CALLBACK_BOUNDARY;

    if (inbound.handlerRef && inbound.handlerRef !== '(inline)') {
        const handlerFn = findWsClientMethod(inbound.handlerRef, ctx.index)
            || (ctx.index.byName.get(inbound.handlerRef) || [])[0];
        if (handlerFn) {
            const child = traceFunction(handlerFn, ctx, depth + 1, visitStack);
            child.callSite = inbound.handlerRef;
            node.children.push(child);
            return node;
        }
    }

    const content = readText(path.join(PATHS.root, inbound.file));
    const blockIdx = findInboundBlockIndex(content, inbound.line, inbound.type);
    if (blockIdx >= 0) {
        const calls = extractInlineHandlerCalls(content, blockIdx, inbound.type);
        for (const call of calls) {
            const pseudoFn = { file: inbound.file, side: 'client', className: null, ast: { body: { type: 'BlockStatement', body: [] } } };
            const fileMeta = ctx.index.files.get(inbound.file);
            const target = resolveCallTarget(call, { fn: pseudoFn, fileMeta, index: ctx.index });

            if (target?.type === 'function') {
                const resolved = target.fn || findWsClientMethod(call.property || call.name, ctx.index);
                if (resolved) {
                    const child = traceFunction(resolved, ctx, depth + 1, visitStack);
                    child.callSite = call.calleeText;
                    child.callLine = call.line;
                    node.children.push(child);
                }
            } else if (target?.type === 'external') {
                node.children.push(createTraceNode(null, {
                    id: `external::${target.name}::${call.line}`,
                    name: target.name,
                    file: '(external)',
                    line: call.line || 0,
                    side: 'client',
                    callSite: target.callSite,
                    terminus: TERMINUS.EXTERNAL,
                    terminusReason: target.reason
                }));
            }
        }
    }

    if (!node.children.length) {
        node.terminusReason = inbound.handlerRef === '(inline)' ? 'inline handler (unparsed)' : 'handler not resolved';
    }

    return node;
}

function summarizeTree(node, stats = null) {
    const s = stats || {
        totalNodes: 0,
        leaves: 0,
        external: 0,
        wsBoundary: 0,
        callbackBoundary: 0,
        cycles: 0,
        refs: 0,
        maxDepth: 0
    };

    function walk(n, depth) {
        s.totalNodes += 1;
        s.maxDepth = Math.max(s.maxDepth, depth);
        if (n.terminus === TERMINUS.LEAF) s.leaves += 1;
        if (n.terminus === TERMINUS.EXTERNAL) s.external += 1;
        if (n.terminus === TERMINUS.WS_BOUNDARY) s.wsBoundary += 1;
        if (n.terminus === TERMINUS.CALLBACK_BOUNDARY) s.callbackBoundary += 1;
        if (n.terminus === TERMINUS.CYCLE) s.cycles += 1;
        if (n.terminus === TERMINUS.REF) s.refs = (s.refs || 0) + 1;
        for (const c of n.children || []) walk(c, depth + 1);
    }

    walk(node, 0);
    return s;
}

/**
 * Trace from a named function root.
 */
function traceFromRoot(options = {}) {
    const { name, file, side, maxDepth = 80 } = options;
    if (!name) throw new Error('Root function name required');

    const index = buildFunctionIndex({ refresh: options.refresh });
    const ws = options.ws || scanWsFlow();

    const matches = findFunctionsByName(name, { file, side });
    if (!matches.length) {
        throw new Error(`Function not found: ${name}${file ? ` in ${file}` : ''}`);
    }
    if (matches.length > 1 && !file) {
        const listing = matches.map((f) => `  ${f.file}:${f.line} (${f.side})`).join('\n');
        throw new Error(`Ambiguous function "${name}" — use --file:\n${listing}`);
    }

    const rootFn = matches[0];
    const ctx = { index, ws, options: { maxDepth }, memo: new Map() };
    const tree = traceFunction(rootFn, ctx, 0, new Set());

    return {
        root: { name: rootFn.name, file: rootFn.file, line: rootFn.line, side: rootFn.side },
        tree,
        stats: summarizeTree(tree),
        tracedAt: new Date().toISOString()
    };
}

/**
 * Trace full pipeline alias (all client callers + deep expansion).
 */
function traceFromPipeline(keyOrType, options = {}) {
    const aliasKey = Object.keys(PIPELINE_ALIASES).find(
        (k) => k === keyOrType || PIPELINE_ALIASES[k].requestType === keyOrType
    );
    if (!aliasKey) {
        throw new Error(`Unknown pipeline: ${keyOrType}. Known: ${Object.keys(PIPELINE_ALIASES).join(', ')}`);
    }

    const def = PIPELINE_ALIASES[aliasKey];
    const ws = options.ws || scanWsFlow();
    const index = buildFunctionIndex({ refresh: options.refresh });
    const ctx = { index, ws, options: { maxDepth: options.maxDepth ?? 80 }, memo: new Map() };

    const callers = ws.clientOutbound.filter((c) => c.type === def.requestType);
    const uniqueCallers = dedupeCallers(callers);

    const roots = [];
    for (const caller of uniqueCallers) {
        const matches = findFunctionsByName(caller.callerFn, { file: caller.file });
        const fn = matches[0] || findFunctionsByName(caller.callerFn)[0];
        if (fn) {
            roots.push({ caller, fn });
        }
    }

    if (!roots.length) {
        const handler = ws.serverHandlers.find((h) => h.type === def.requestType);
        if (handler) {
            const handlerFn = findHandlerFunction(handler, ws.links.find((l) => l.requestType === def.requestType), index);
            if (handlerFn) {
                const tree = traceFunction(handlerFn, ctx, 0, new Set());
                return {
                    pipeline: aliasKey,
                    label: def.label,
                    requestType: def.requestType,
                    roots: [{ fn: handlerFn, source: 'server-handler' }],
                    trees: [{ root: handlerFn, tree }],
                    stats: summarizeTree(tree),
                    tracedAt: new Date().toISOString()
                };
            }
        }
        throw new Error(`No callers or handler found for pipeline ${aliasKey}`);
    }

    const trees = roots.map(({ caller, fn }) => ({
        root: fn,
        caller,
        tree: traceFunction(fn, ctx, 0, new Set())
    }));

    const combinedStats = {
        totalNodes: 0,
        leaves: 0,
        external: 0,
        wsBoundary: 0,
        callbackBoundary: 0,
        cycles: 0,
        refs: 0,
        maxDepth: 0
    };
    for (const t of trees) {
        const s = summarizeTree(t.tree);
        for (const k of Object.keys(combinedStats)) {
            combinedStats[k] += s[k];
        }
    }

    return {
        pipeline: aliasKey,
        label: def.label,
        requestType: def.requestType,
        responseTypes: def.responseTypes,
        roots: roots.map((r) => ({ name: r.fn.name, file: r.fn.file, line: r.fn.line, caller: r.caller })),
        trees,
        stats: combinedStats,
        tracedAt: new Date().toISOString()
    };
}

function dedupeCallers(callers) {
    const seen = new Set();
    return callers.filter((c) => {
        const k = `${c.file}:${c.callerFn}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/**
 * Resolve root from CLI args: function name, --file/--fn, or pipeline alias.
 */
function resolveAndTrace(input, options = {}) {
    if (PIPELINE_ALIASES[input] || Object.values(PIPELINE_ALIASES).some((p) => p.requestType === input)) {
        return { mode: 'pipeline', result: traceFromPipeline(input, options) };
    }
    return {
        mode: 'function',
        result: traceFromRoot({
            name: options.fn || input,
            file: options.file,
            side: options.side,
            maxDepth: options.maxDepth,
            refresh: options.refresh
        })
    };
}

module.exports = {
    TERMINUS,
    traceFromRoot,
    traceFromPipeline,
    resolveAndTrace,
    summarizeTree,
    createTraceNode
};
