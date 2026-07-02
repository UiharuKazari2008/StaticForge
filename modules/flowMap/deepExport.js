/**
 * Markdown, Mermaid, and JSON export for deep function traces.
 */

const { sanitizeId } = require('./mermaidExport');
const { TERMINUS } = require('./deepTrace');

const TERMINUS_LABELS = {
    [TERMINUS.LEAF]: 'leaf',
    [TERMINUS.EXTERNAL]: 'external',
    [TERMINUS.WS_BOUNDARY]: 'ws_boundary',
    [TERMINUS.CALLBACK_BOUNDARY]: 'callback_boundary',
    [TERMINUS.CYCLE]: 'cycle',
    [TERMINUS.REF]: 'ref',
    [TERMINUS.DEPTH_LIMIT]: 'depth_limit'
};

const TERMINUS_STYLES = {
    [TERMINUS.LEAF]: 'leafNode',
    [TERMINUS.EXTERNAL]: 'extNode',
    [TERMINUS.WS_BOUNDARY]: 'wsNode',
    [TERMINUS.CALLBACK_BOUNDARY]: 'cbNode',
    [TERMINUS.CYCLE]: 'cycleNode',
    [TERMINUS.REF]: 'refNode',
    [TERMINUS.DEPTH_LIMIT]: 'depthNode'
};

function escapeHtml(s) {
    return String(s || '').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
}

function nodeLabel(n) {
    const loc = n.file && n.file !== '(external)' && n.file !== '(websocket)'
        ? `${n.file.split('/').pop()}:${n.line}`
        : '';
    const term = n.terminus ? ` [${TERMINUS_LABELS[n.terminus]}]` : '';
    const site = n.callSite ? ` — ${n.callSite}` : '';
    const main = escapeHtml(n.name) + term;
    if (loc) return `"${main}<br/><small>${escapeHtml(loc)}${escapeHtml(site)}</small>"`;
    return `"${main}"`;
}

/**
 * Flowchart mermaid for a trace tree.
 */
function deepTraceToMermaid(tree, options = {}) {
    const maxNodes = options.maxNodes ?? 200;
    const lines = ['flowchart TD'];
    const nodeMap = new Map();
    let nodeCount = 0;

    lines.push('    classDef leafNode fill:#2d5016,stroke:#6abf4b,color:#fff');
    lines.push('    classDef extNode fill:#4a3728,stroke:#c9a66b,color:#fff');
    lines.push('    classDef wsNode fill:#1a3a5c,stroke:#5ba3d9,color:#fff');
    lines.push('    classDef cbNode fill:#3d2a5c,stroke:#a67bd9,color:#fff');
    lines.push('    classDef cycleNode fill:#5c2a2a,stroke:#d97b7b,color:#fff');
    lines.push('    classDef refNode fill:#3a3a3a,stroke:#888,color:#fff');
    lines.push('    classDef depthNode fill:#5c4a2a,stroke:#d9b67b,color:#fff');

    function allocId(n) {
        if (nodeMap.has(n.id)) return nodeMap.get(n.id);
        const id = `n${nodeCount++}`;
        nodeMap.set(n.id, id);
        return id;
    }

    function walk(n, parentMermaidId) {
        if (nodeCount >= maxNodes) return;
        const mid = allocId(n);
        lines.push(`    ${mid}[${nodeLabel(n)}]`);

        if (n.terminus && TERMINUS_STYLES[n.terminus]) {
            lines.push(`    class ${mid} ${TERMINUS_STYLES[n.terminus]}`);
        }

        if (parentMermaidId) {
            lines.push(`    ${parentMermaidId} --> ${mid}`);
        }

        for (const child of n.children || []) {
            walk(child, mid);
        }
    }

    walk(tree, null);

    if (nodeCount >= maxNodes) {
        lines.push(`    trunc["… truncated at ${maxNodes} nodes"]`);
    }

    return lines.join('\n');
}

function deepTraceToFileSummaryMermaid(traceResult) {
    const files = new Map();

    function collect(node) {
        if (node.file && !['(external)', '(websocket)'].includes(node.file)) {
            if (!files.has(node.file)) files.set(node.file, new Set());
            files.get(node.file).add(node.name);
        }
        for (const c of node.children || []) collect(c);
    }

    const trees = traceResult.trees
        ? traceResult.trees.map((t) => t.tree)
        : [traceResult.tree];

    for (const t of trees) {
        if (t) collect(t);
    }

    const lines = ['flowchart LR'];
    const sideGroups = { client: [], server: [] };

    for (const [file, fns] of files) {
        const side = file.startsWith('public/') ? 'client' : 'server';
        const id = sanitizeId(file);
        const fnList = [...fns].slice(0, 8).join(', ');
        const more = fns.size > 8 ? ` +${fns.size - 8}` : '';
        sideGroups[side].push({
            id,
            label: `${file.split('/').pop()}<br/><small>${fnList}${more}</small>`
        });
    }

    for (const side of ['client', 'server']) {
        if (!sideGroups[side].length) continue;
        lines.push(`    subgraph ${side} ["${side}"]`);
        for (const item of sideGroups[side]) {
            lines.push(`        ${item.id}["${item.label.replace(/"/g, '#quot;')}"]`);
        }
        lines.push('    end');
    }

    return lines.join('\n');
}

function flattenTree(node, depth = 0, rows = []) {
    rows.push({
        depth,
        name: node.name,
        file: node.file,
        line: node.line,
        side: node.side,
        terminus: node.terminus,
        terminusReason: node.terminusReason,
        callSite: node.callSite
    });
    for (const c of node.children || []) flattenTree(c, depth + 1, rows);
    return rows;
}

function deepTraceToMarkdown(wrapped, options = {}) {
    const mode = wrapped.mode || (wrapped.pipeline ? 'pipeline' : 'function');
    const data = wrapped.result || wrapped;
    const sections = [];

    if (mode === 'pipeline' || data.pipeline) {
        sections.push(`# Deep Flow Map: ${data.label || data.pipeline}`);
        sections.push('');
        sections.push(`> Pipeline \`${data.requestType}\` — deep static trace`);
        sections.push(`> Generated: \`${data.tracedAt}\``);
        sections.push('');
        sections.push('## Summary');
        sections.push('');
        sections.push('| Metric | Value |');
        sections.push('| --- | --- |');
        sections.push(`| Roots | ${data.roots?.length || 1} |`);
        sections.push(`| Total nodes | ${data.stats.totalNodes} |`);
        sections.push(`| Max depth | ${data.stats.maxDepth} |`);
        sections.push(`| Leaves | ${data.stats.leaves} |`);
        sections.push(`| External | ${data.stats.external} |`);
        sections.push(`| WS boundaries | ${data.stats.wsBoundary} |`);
        sections.push(`| Callback boundaries | ${data.stats.callbackBoundary} |`);
        sections.push(`| Cycles | ${data.stats.cycles} |`);
        sections.push(`| Refs (deduped revisits) | ${data.stats.refs || 0} |`);
        sections.push('');

        if (data.roots?.length) {
            sections.push('## Entry Points');
            sections.push('');
            sections.push('| Function | File | Line |');
            sections.push('| --- | --- | --- |');
            for (const r of data.roots) {
                sections.push(`| \`${r.name}\` | \`${r.file}\` | ${r.line} |`);
            }
            sections.push('');
        }

        for (let i = 0; i < (data.trees || []).length; i++) {
            const t = data.trees[i];
            sections.push(`## Trace ${i + 1}: ${t.root?.name || t.caller?.callerFn}`);
            sections.push('');
            sections.push('```mermaid');
            sections.push(deepTraceToMermaid(t.tree, options));
            sections.push('```');
            sections.push('');
        }
    } else {
        sections.push(`# Deep Flow Map: ${data.root.name}`);
        sections.push('');
        sections.push(`> \`${data.root.file}:${data.root.line}\` (${data.root.side})`);
        sections.push(`> Generated: \`${data.tracedAt}\``);
        sections.push('');
        sections.push('## Summary');
        sections.push('');
        sections.push('| Metric | Value |');
        sections.push('| --- | --- |');
        sections.push(`| Total nodes | ${data.stats.totalNodes} |`);
        sections.push(`| Max depth | ${data.stats.maxDepth} |`);
        sections.push(`| Leaves | ${data.stats.leaves} |`);
        sections.push(`| External | ${data.stats.external} |`);
        sections.push(`| WS boundaries | ${data.stats.wsBoundary} |`);
        sections.push(`| Callback boundaries | ${data.stats.callbackBoundary} |`);
        sections.push(`| Refs (deduped revisits) | ${data.stats.refs || 0} |`);
        sections.push('');
        sections.push('## Call Tree');
        sections.push('');
        sections.push('```mermaid');
        sections.push(deepTraceToMermaid(data.tree, options));
        sections.push('```');
        sections.push('');
    }

    sections.push('## Files Touched');
    sections.push('');
    sections.push('```mermaid');
    sections.push(deepTraceToFileSummaryMermaid(data));
    sections.push('```');
    sections.push('');

    sections.push('## Flat Trace');
    sections.push('');
    sections.push('```');
    const trees = data.trees ? data.trees.map((t) => t.tree) : [data.tree];
    for (const t of trees) {
        if (!t) continue;
        for (const row of flattenTree(t)) {
            const indent = '  '.repeat(row.depth);
            const term = row.terminus ? ` [${TERMINUS_LABELS[row.terminus]}]` : '';
            sections.push(`${indent}${row.name} (${row.file}:${row.line})${term}`);
        }
    }
    sections.push('```');
    sections.push('');

    if (options.limitations !== false) {
        sections.push('## How Resolution Works');
        sections.push('');
        sections.push('- **AST index**: acorn parses all `public/scripts/` and `modules/` functions.');
        sections.push('- **Same-file + imports**: `require()` bindings resolve cross-file calls on the server.');
        sections.push('- **WS boundaries**: `sendMessage(\'type\')` links to server `regFn` handler, then continues in impl.');
        sections.push('- **Inbound callbacks**: `registerWsInboundHandler` inline bodies trace into `wsClient.*` methods.');
        sections.push('');
        sections.push('## Limitations');
        sections.push('');
        sections.push('- Dynamic calls (`obj[method]()`, runtime-registered handlers) are not resolved.');
        sections.push('- Ambiguous global function names may be marked `external` unless `--file` is specified.');
        sections.push('- Client globals resolve when uniquely named across the index.');
        sections.push('- Event handlers, DOM callbacks, and `triggerEvent` paths are not traced.');
        sections.push('');
    }

    return sections.join('\n');
}

function deepTraceToJson(wrapped) {
    const data = wrapped.result || wrapped;

    function stripAst(node) {
        if (!node) return node;
        const { ast, ...rest } = node;
        return {
            ...rest,
            children: (rest.children || []).map(stripAst)
        };
    }

    if (data.trees) {
        return {
            ...data,
            trees: data.trees.map((t) => ({ ...t, tree: stripAst(t.tree) }))
        };
    }

    return { ...data, tree: stripAst(data.tree) };
}

module.exports = {
    deepTraceToMermaid,
    deepTraceToFileSummaryMermaid,
    deepTraceToMarkdown,
    deepTraceToJson,
    flattenTree,
    TERMINUS_LABELS
};
