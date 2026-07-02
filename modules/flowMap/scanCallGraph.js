/**
 * Lightweight per-file call graph scanner (function declarations + call edges).
 * Heuristic only — does not resolve cross-file or dynamic calls.
 */

const { readText, relPath } = require('./scanWsFlow');

function extractFunctionBlocks(content) {
    const blocks = [];
    const re = /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        const name = m[1];
        const start = m.index + m[0].length;
        let depth = 1;
        let i = start;
        while (i < content.length && depth > 0) {
            const ch = content[i];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            i += 1;
        }
        blocks.push({
            name,
            body: content.slice(start, i - 1),
            line: content.slice(0, m.index).split('\n').length
        });
    }
    return blocks;
}

function extractClassMethods(content) {
    const methods = [];
    const re = /(\w+)\s*\([^)]*\)\s*\{/g;
    const classRe = /class\s+(\w+)/g;
    if (!classRe.test(content)) return methods;

    let m;
    classRe.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
        const name = m[1];
        if (['if', 'for', 'while', 'switch', 'catch', 'function'].includes(name)) continue;
        const start = m.index + m[0].length;
        let depth = 1;
        let i = start;
        while (i < content.length && depth > 0) {
            const ch = content[i];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            i += 1;
        }
        methods.push({
            name,
            body: content.slice(start, i - 1),
            line: content.slice(0, m.index).split('\n').length
        });
    }
    return methods;
}

/**
 * @param {string} filePath absolute path
 * @returns {{ file, functions: string[], edges: Array<{from,to}> }}
 */
function scanFileCallGraph(filePath) {
    const content = readText(filePath);
    const blocks = [...extractFunctionBlocks(content), ...extractClassMethods(content)];
    const fnNames = [...new Set(blocks.map((b) => b.name))];
    const edges = [];

    for (const block of blocks) {
        for (const callee of fnNames) {
            if (callee === block.name) continue;
            const callRe = new RegExp(`\\b${callee}\\s*\\(`);
            if (callRe.test(block.body)) {
                edges.push({ from: block.name, to: callee, line: block.line });
            }
        }
    }

    return {
        file: relPath(filePath),
        functions: fnNames,
        edges
    };
}

/**
 * Scan multiple files and merge graphs.
 */
function scanCallGraphs(filePaths) {
    return filePaths.map((fp) => scanFileCallGraph(fp));
}

module.exports = {
    scanFileCallGraph,
    scanCallGraphs,
    extractFunctionBlocks
};
