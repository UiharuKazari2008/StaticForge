/**
 * WebSocket flow scanner — static regex/heuristic extraction of packet registrations,
 * inbound handlers, outbound sends, and server response types.
 */

const fs = require('fs');
const path = require('path');
const { PATHS, CLIENT_SEND_SCAN_DIRS } = require('./constants');

function readText(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (_e) {
        return '';
    }
}

function relPath(absPath) {
    return path.relative(PATHS.root, absPath).replace(/\\/g, '/');
}

function listJsFiles(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            listJsFiles(full, acc);
        } else if (name.endsWith('.js')) {
            acc.push(full);
        }
    }
    return acc;
}

function lineNumberAt(content, index) {
    return content.slice(0, index).split('\n').length;
}

function extractQuotedStrings(text) {
    const results = [];
    const re = /['"]([a-z][a-z0-9_]{2,})['"]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        results.push({ value: m[1], index: m.index });
    }
    return results;
}

/**
 * Scan server handler files for registerWsPacket / regFn registrations.
 * @returns {Array<{type, handlerFn, owner, file, line, side: 'server'}>}
 */
function scanServerPacketRegistrations() {
    const entries = [];
    const files = listJsFiles(PATHS.serverHandlers);

    for (const file of files) {
        const content = readText(file);
        if (!content) continue;

        // regFn('packet_type', handleFn, meta) or reg('packet_type', handleFn)
        const regFnRe = /\bregFn\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g;
        const regShortRe = /\breg\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g;
        let m;
        for (const re of [regFnRe, regShortRe]) {
            re.lastIndex = 0;
            while ((m = re.exec(content)) !== null) {
                if (entries.some((e) => e.file === relPath(file) && e.type === m[1] && e.line === lineNumberAt(content, m.index))) {
                    continue;
                }
                entries.push({
                    side: 'server',
                    role: 'handler',
                    type: m[1],
                    handlerFn: m[2],
                    owner: inferOwnerFromFile(content, file),
                    file: relPath(file),
                    line: lineNumberAt(content, m.index)
                });
            }
        }

        // wsPacketRegistry.registerWsPacket('type', ...)
        const directRe = /registerWsPacket\s*\(\s*['"]([^'"]+)['"]\s*,[\s\S]*?(?:,\s*\{[^}]*owner:\s*['"]([^'"]+)['"])?/g;
        while ((m = directRe.exec(content)) !== null) {
            if (entries.some((e) => e.file === relPath(file) && e.type === m[1] && e.line === lineNumberAt(content, m.index))) {
                continue;
            }
            entries.push({
                side: 'server',
                role: 'handler',
                type: m[1],
                handlerFn: null,
                owner: m[2] || inferOwnerFromFile(content, file),
                file: relPath(file),
                line: lineNumberAt(content, m.index)
            });
        }
    }

    return dedupeBySideTypeFile(entries);
}

/**
 * Legacy handlers still routed via websocketHandlers.js switch (pre-registry migration).
 */
function scanLegacyServerHandlers() {
    const file = path.join(PATHS.root, 'modules/websocketHandlers.js');
    const content = readText(file);
    const entries = [];
    const caseRe = /case\s+['"]([^'"]+)['"]\s*:/g;
    let m;
    while ((m = caseRe.exec(content)) !== null) {
        const type = m[1];
        if (type.length < 3 || type.includes(' ')) continue;
        entries.push({
            side: 'server',
            role: 'handler',
            type,
            handlerFn: '(legacy switch)',
            owner: 'legacy',
            file: relPath(file),
            line: lineNumberAt(content, m.index),
            legacy: true
        });
    }
    return entries;
}

function scanGrimoireDomainPackets() {
    const file = PATHS.grimoireDomainRegistry;
    const content = readText(file);
    const entries = [];
    const blockRe = /registerDomain\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
    let block;
    while ((block = blockRe.exec(content)) !== null) {
        const body = block[1];
        const domainMatch = /domain:\s*['"]([^'"]+)['"]/.exec(body);
        const domain = domainMatch ? domainMatch[1] : 'unknown';
        const packetsMatch = /packets:\s*\{([\s\S]*?)\}/.exec(body);
        if (!packetsMatch) continue;

        const packetBody = packetsMatch[1];
        const pairRe = /(\w+)\s*:\s*['"](\w+)['"]/g;
        let pair;
        while ((pair = pairRe.exec(packetBody)) !== null) {
            entries.push({
                side: 'server',
                role: 'handler',
                type: pair[1],
                handlerFn: pair[2],
                owner: `grimoire:${domain}`,
                file: relPath(file),
                line: lineNumberAt(content, pair.index),
                grimoireDomain: domain
            });
        }
    }
    return entries;
}

function scanServerPacketRegistrationsMerged() {
    const modern = scanServerPacketRegistrations();
    const grimoire = scanGrimoireDomainPackets();
    const legacy = scanLegacyServerHandlers();
    const seen = new Set(modern.map((e) => e.type));
    for (const entry of [...grimoire, ...legacy]) {
        if (!seen.has(entry.type)) {
            modern.push(entry);
            seen.add(entry.type);
        }
    }
    return modern;
}

function inferOwnerFromFile(content, file) {
    const ownerMatch = /owner:\s*['"]([^'"]+)['"]/.exec(content);
    if (ownerMatch) return ownerMatch[1];
    const base = path.basename(file, '.js');
    const domainMatch = /^(\d+)-(\w+)Handler$/.exec(base);
    if (domainMatch) return domainMatch[2];
    return base.replace(/Handler$/, '') || 'unknown';
}

/**
 * Scan client inbound handler registrations.
 * @returns {Array<{id, type, phase, handlerRef, file, line, side: 'client'}>}
 */
function scanClientInboundHandlers() {
    const entries = [];
    const files = listJsFiles(PATHS.clientWsHandlers);

    for (const file of files) {
        const content = readText(file);
        const blockRe = /registerWsInboundHandler\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
        let block;
        while ((block = blockRe.exec(content)) !== null) {
            const body = block[1];
            const id = /id:\s*['"]([^'"]+)['"]/.exec(body);
            const type = /type:\s*['"]([^'"]+)['"]/.exec(body);
            const phase = /phase:\s*['"]([^'"]+)['"]/.exec(body);
            const namedHandler = /handler:\s*(\w+)/.exec(body);
            const inlineHandler = /handler\s*\(/.test(body);

            if (!type) continue;

            entries.push({
                side: 'client',
                role: 'inbound',
                id: id ? id[1] : null,
                type: type[1],
                phase: phase ? phase[1] : 'post',
                handlerRef: namedHandler ? namedHandler[1] : (inlineHandler ? '(inline)' : null),
                file: relPath(file),
                line: lineNumberAt(content, block.index)
            });
        }
    }

    return entries;
}

/**
 * Scan client scripts for outbound WS sends.
 * @returns {Array<{type, method, callerFn, file, line, side: 'client'}>}
 */
function scanClientOutboundSends() {
    const entries = [];
    const sendPatterns = [
        { re: /\.sendMessage\s*\(\s*['"]([^'"]+)['"]/g, method: 'sendMessage' },
        { re: /\.sendMessageWithRequestId\s*\(\s*['"]([^'"]+)['"]/g, method: 'sendMessageWithRequestId' },
        { re: /\.sendMessageWithCallback\s*\(\s*['"]([^'"]+)['"]/g, method: 'sendMessageWithCallback' },
        { re: /\bsendMessage\s*\(\s*['"]([^'"]+)['"]/g, method: 'sendMessage' }
    ];

    const files = new Set();
    for (const dir of CLIENT_SEND_SCAN_DIRS) {
        listJsFiles(dir).forEach((f) => files.add(f));
    }

    for (const file of files) {
        const content = readText(file);
        for (const { re, method } of sendPatterns) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(content)) !== null) {
                entries.push({
                    side: 'client',
                    role: 'outbound',
                    type: m[1],
                    method,
                    callerFn: inferEnclosingFunction(content, m.index),
                    file: relPath(file),
                    line: lineNumberAt(content, m.index)
                });
            }
        }
    }

    return dedupeBySideTypeFile(entries);
}

function inferEnclosingFunction(content, index) {
    const before = content.slice(0, index);

    // Class method: name(...) { or async name(...) {
    const methodRe = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g;
    let methodMatch;
    let lastMethod = null;
    while ((methodMatch = methodRe.exec(before)) !== null) {
        const name = methodMatch[1];
        if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'else'].includes(name)) {
            lastMethod = name;
        }
    }
    if (lastMethod) return lastMethod;

    const fnMatches = [...before.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)];
    if (fnMatches.length) return fnMatches[fnMatches.length - 1][1];

    return '(top-level)';
}

/**
 * Scan server files for sendToClient response types (outbound from server perspective).
 */
function scanServerOutboundTypes() {
    const entries = [];
    const dirs = [PATHS.serverHandlers, path.join(PATHS.root, 'modules')];
    const files = new Set();
    for (const dir of dirs) {
        listJsFiles(dir).forEach((f) => files.add(f));
    }
    files.add(path.join(PATHS.root, 'modules/websocketHandlers.js'));

    for (const file of files) {
        const content = readText(file);
        // sendToClient(ws, { type: 'packet_name', ... })
        const sendBlockRe = /sendToClient\s*\(\s*\w+\s*,\s*\{([\s\S]*?)\}\s*[,)]/g;
        let block;
        while ((block = sendBlockRe.exec(content)) !== null) {
            const typeMatch = /type:\s*['"]([^'"]+)['"]/.exec(block[1]);
            if (!typeMatch) continue;
            entries.push({
                side: 'server',
                role: 'outbound',
                type: typeMatch[1],
                file: relPath(file),
                line: lineNumberAt(content, block.index),
                callerFn: inferEnclosingFunction(content, block.index)
            });
        }

        // shorthand: { type: 'foo_response', requestId: message.requestId
        const inlineRe = /\{\s*\n?\s*type:\s*['"]([a-z][a-z0-9_]{2,})['"]/g;
        let m;
        while ((m = inlineRe.exec(content)) !== null) {
            const t = m[1];
            if (t === 'operation_response' || t === 'error') continue;
            entries.push({
                side: 'server',
                role: 'outbound',
                type: t,
                file: relPath(file),
                line: lineNumberAt(content, m.index),
                callerFn: inferEnclosingFunction(content, m.index)
            });
        }
    }

    return dedupeBySideTypeFile(entries);
}

/**
 * Resolve handler impl file from handler registration (e.g. handleImageGeneration -> generationImpl.js).
 */
function resolveHandlerImplFile(handlerFn, registrationFile) {
    if (!handlerFn) return null;
    const regPath = path.join(PATHS.root, registrationFile);
    const content = readText(regPath);
    const requireRe = /require\(['"]\.\/([^'"]+)['"]\)/g;
    const requires = [...content.matchAll(requireRe)].map((m) => m[1]);
    const implName = requires.find((n) => /Impl/i.test(n));
    if (implName) {
        const implPath = path.join(path.dirname(regPath), implName.endsWith('.js') ? implName : implName + '.js');
        return relPath(implPath);
    }
    const sibling = path.join(path.dirname(regPath), handlerFn.replace(/^handle/, '').toLowerCase() + '.js');
    if (fs.existsSync(sibling)) return relPath(sibling);
    return null;
}

function dedupeBySideTypeFile(entries) {
    const seen = new Set();
    return entries.filter((e) => {
        const key = `${e.side}|${e.type}|${e.file}|${e.line}|${e.role || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Build cross-side links: request type -> server handler -> response types -> client inbound.
 */
function buildWsLinks(serverHandlers, clientInbound, clientOutbound, serverOutbound) {
    const links = [];

    for (const handler of serverHandlers) {
        const implRel = handler.handlerFn
            ? resolveHandlerImplFile(handler.handlerFn, handler.file)
            : null;

        const responses = serverOutbound.filter((o) => {
            if (!implRel) return o.file === handler.file;
            return o.file === implRel || o.file === handler.file;
        });

        const responseTypes = [...new Set(responses.map((r) => r.type))];
        const inbounds = clientInbound.filter((c) => responseTypes.includes(c.type));

        const callers = clientOutbound.filter((c) => c.type === handler.type);

        links.push({
            requestType: handler.type,
            owner: handler.owner,
            server: {
                registration: handler,
                implFile: implRel,
                responses: responses
            },
            client: {
                callers,
                inbounds
            },
            responseTypes
        });
    }

    // Orphan inbound (server push / no registered handler in scan)
    for (const inbound of clientInbound) {
        if (links.some((l) => l.responseTypes.includes(inbound.type))) continue;
        links.push({
            requestType: null,
            responseType: inbound.type,
            owner: 'orphan-inbound',
            server: { responses: serverOutbound.filter((o) => o.type === inbound.type) },
            client: { inbounds: [inbound], callers: [] },
            responseTypes: [inbound.type]
        });
    }

    return links;
}

function scanWsFlow() {
    const serverHandlers = scanServerPacketRegistrationsMerged();
    const clientInbound = scanClientInboundHandlers();
    const clientOutbound = scanClientOutboundSends();
    const serverOutbound = scanServerOutboundTypes();

    const links = buildWsLinks(serverHandlers, clientInbound, clientOutbound, serverOutbound);

    return {
        scannedAt: new Date().toISOString(),
        counts: {
            serverHandlers: serverHandlers.length,
            clientInbound: clientInbound.length,
            clientOutbound: clientOutbound.length,
            serverOutbound: serverOutbound.length,
            links: links.length
        },
        serverHandlers,
        clientInbound,
        clientOutbound,
        serverOutbound,
        links
    };
}

module.exports = {
    scanWsFlow,
    scanServerPacketRegistrations,
    scanClientInboundHandlers,
    scanClientOutboundSends,
    scanServerOutboundTypes,
    buildWsLinks,
    listJsFiles,
    relPath,
    readText
};
