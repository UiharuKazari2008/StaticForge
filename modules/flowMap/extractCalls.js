/**
 * Extract call expressions from a function body AST node.
 */

const walk = require('acorn-walk');

const WS_SEND_METHODS = new Set([
    'sendMessage',
    'sendMessageWithCallback',
    'sendMessageWithRequestId'
]);

const WS_SERVER_SEND = new Set(['sendToClient']);

/**
 * @param {import('acorn').Node} fnNode function/method AST node
 * @returns {Array<{ kind, name, object, property, line, wsType, calleeText }>}
 */
function extractCallsFromFunction(fnNode) {
    const body = fnNode.body;
    if (!body) return [];

    const calls = [];
    const root = body.type === 'BlockStatement' ? body : fnNode;

    walk.simple(root, {
        CallExpression(node) {
            const info = describeCallee(node.callee);
            if (!info) return;

            info.line = node.loc ? node.loc.start.line : null;
            info.calleeText = sliceCallee(node.callee);

            if (info.kind === 'member' && WS_SEND_METHODS.has(info.property)) {
                info.wsOutbound = true;
                info.wsType = extractFirstStringArg(node.arguments);
            }

            if (info.kind === 'member' && WS_SERVER_SEND.has(info.property)) {
                info.wsServerOutbound = true;
                info.wsType = extractWsTypeFromSendToClient(node.arguments);
            }

            if (info.kind === 'member' && info.property === 'registerWsInboundHandler') {
                info.registerInbound = true;
            }

            calls.push(info);
        },

        NewExpression(node) {
            const info = describeCallee(node.callee);
            if (!info) return;
            info.line = node.loc ? node.loc.start.line : null;
            info.isNew = true;
            info.calleeText = sliceCallee(node.callee);
            calls.push(info);
        }
    });

    return calls;
}

function describeCallee(callee) {
    if (callee.type === 'Identifier') {
        return { kind: 'identifier', name: callee.name, object: null, property: callee.name };
    }

    if (callee.type === 'MemberExpression') {
        const property = callee.property.type === 'Identifier'
            ? callee.property.name
            : (callee.property.type === 'Literal' ? String(callee.property.value) : null);
        if (!property) return null;

        return {
            kind: 'member',
            name: property,
            object: memberChain(callee.object),
            property
        };
    }

    return null;
}

function memberChain(node) {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'ThisExpression') return 'this';
    if (node.type === 'MemberExpression') {
        const base = memberChain(node.object);
        const prop = node.property.type === 'Identifier'
            ? node.property.name
            : (node.property.type === 'Literal' ? String(node.property.value) : '?');
        return `${base}.${prop}`;
    }
    return '(expr)';
}

function sliceCallee(callee) {
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression') {
        return `${memberChain(callee.object)}.${callee.property.name || '?'}`;
    }
    return '(unknown)';
}

function extractFirstStringArg(args) {
    if (!args || !args.length) return null;
    const arg = args[0];
    if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value;
    return null;
}

function extractWsTypeFromSendToClient(args) {
    if (!args || args.length < 2) return null;
    const payload = args[1];
    if (!payload || payload.type !== 'ObjectExpression') return null;
    for (const prop of payload.properties) {
        if (prop.type !== 'Property') continue;
        if (prop.key.type === 'Identifier' && prop.key.name === 'type') {
            if (prop.value.type === 'Literal' && typeof prop.value.value === 'string') {
                return prop.value.value;
            }
        }
    }
    return null;
}

/**
 * Extract inline handler body calls from registerWsInboundHandler source block.
 * @param {string} content file content
 * @param {number} blockStart index of registerWsInboundHandler call
 * @param {string} [expectedType] optional WS message type to match block
 */
function extractInlineHandlerCalls(content, blockStart, expectedType) {
    const slice = content.slice(blockStart);
    const blockEndMatch = /registerWsInboundHandler\s*\(\s*\{/.exec(slice);
    if (!blockEndMatch) return [];

    const blockHead = slice.slice(0, 400);
    if (expectedType) {
        const typeMatch = /type:\s*['"]([^'"]+)['"]/.exec(blockHead);
        if (typeMatch && typeMatch[1] !== expectedType) return [];
    }

    const handlerMatch = /handler\s*\(\s*[^)]*\)\s*\{/.exec(slice);
    if (!handlerMatch) return [];

    const bodyStart = blockStart + handlerMatch.index + handlerMatch[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < content.length && depth > 0) {
        const ch = content[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        i += 1;
    }

    const bodySrc = `(function handler() { ${content.slice(bodyStart, i - 1)} })`;
    try {
        const acorn = require('acorn');
        const ast = acorn.parse(bodySrc, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
        return extractCallsFromFunction(ast.body[0].expression);
    } catch (_e) {
        return [];
    }
}

/**
 * Find registerWsInboundHandler block start for a given line or message type.
 */
function findInboundBlockIndex(content, line, expectedType) {
    const regRe = /registerWsInboundHandler\s*\(\s*\{/g;
    let match;
    let lineMatch = -1;
    let typeMatch = -1;

    while ((match = regRe.exec(content)) !== null) {
        const blockLine = content.slice(0, match.index).split('\n').length;
        if (blockLine === line) lineMatch = match.index;

        if (expectedType) {
            const head = content.slice(match.index, match.index + 500);
            const typeField = /type:\s*['"]([^'"]+)['"]/.exec(head);
            if (typeField && typeField[1] === expectedType) {
                typeMatch = match.index;
            }
        }
    }

    if (typeMatch >= 0) return typeMatch;
    return lineMatch;
}

module.exports = {
    extractCallsFromFunction,
    extractInlineHandlerCalls,
    findInboundBlockIndex,
    WS_SEND_METHODS,
    WS_SERVER_SEND,
    describeCallee,
    memberChain
};
