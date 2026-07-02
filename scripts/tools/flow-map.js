#!/usr/bin/env node
/**
 * StaticForge Flow Map CLI
 *
 * Maps WebSocket pipelines, handler registrations, and client↔server callbacks.
 * Deep function-to-function tracing via acorn AST (cross-file + WS boundaries).
 *
 * Usage:
 *   node scripts/tools/flow-map.js scan [--json] [--out file.json]
 *   node scripts/tools/flow-map.js list [--dimension owner|side|file|messageType|pipeline]
 *   node scripts/tools/flow-map.js pipeline <name> [--out docs/flow-maps/examples/name.md]
 *   node scripts/tools/flow-map.js root <name> [--file path] [--fn name] [--json] [--out path]
 *   node scripts/tools/flow-map.js mermaid <name>
 *   node scripts/tools/flow-map.js owner <owner>   (mermaid graph for domain)
 *
 * Examples:
 *   pnpm flow-map root generateImage
 *   pnpm flow-map root --file public/scripts/websocket.js --fn generateImage
 *   pnpm flow-map root generate_image --out docs/flow-maps/examples/generateImage-deep.md
 *   pnpm flow-map pipeline generate_image
 *   pnpm flow-map list --dimension pipeline
 *   pnpm flow-map scan --json | head
 */

const fs = require('fs');
const path = require('path');

const flowMap = require('../../modules/flowMap');

function printUsage() {
    console.log(`StaticForge Flow Map

Commands:
  scan [--json] [--out path] [--call-graphs]   Full WS map scan
  list [--dimension dim]                       Grouped summary
  pipeline <name> [--out path]                 Shallow pipeline markdown (WS round-trip)
  root <name|pipeline> [options]             Deep function-to-function trace
  mermaid <name>                               Sequence diagram only
  owner <owner>                                Mermaid graph for WS owner/domain

Root options:
  --file <path>        Disambiguate function by file
  --fn <name>          Function name (with --file)
  --json               JSON output
  --out <path>         Write markdown or JSON to file
  --max-depth <n>      Max recursion depth (default: 80)
  --max-nodes <n>      Max mermaid nodes (default: 200)

Dimensions: ${flowMap.DIMENSIONS.join(', ')}

Known pipelines: ${Object.keys(flowMap.PIPELINE_ALIASES).join(', ')}
`);
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const cmd = args[0];
    const flags = {};
    const positional = [];

    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a === '--json') flags.json = true;
        else if (a === '--call-graphs') flags.callGraphs = true;
        else if (a === '--out' && args[i + 1]) {
            flags.out = args[++i];
        } else if (a === '--dimension' && args[i + 1]) {
            flags.dimension = args[++i];
        } else if (a === '--file' && args[i + 1]) {
            flags.file = args[++i];
        } else if (a === '--fn' && args[i + 1]) {
            flags.fn = args[++i];
        } else if (a === '--max-depth' && args[i + 1]) {
            flags.maxDepth = parseInt(args[++i], 10);
        } else if (a === '--max-nodes' && args[i + 1]) {
            flags.maxNodes = parseInt(args[++i], 10);
        } else if (a.startsWith('--')) {
            console.error('Unknown flag:', a);
            process.exit(1);
        } else {
            positional.push(a);
        }
    }

    return { cmd, flags, positional };
}

function ensureDirForFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function cmdScan(flags) {
    const map = flowMap.buildFlowMap({ includeCallGraphs: !!flags.callGraphs });

    if (flags.out) {
        ensureDirForFile(flags.out);
        fs.writeFileSync(flags.out, JSON.stringify(map, null, 2), 'utf8');
        console.log('Wrote', flags.out);
        return;
    }

    if (flags.json) {
        console.log(JSON.stringify(map, null, 2));
        return;
    }

    const fnIndex = flowMap.buildFunctionIndex();
    console.log('Flow Map Scan');
    console.log('-------------');
    console.log('Scanned:', map.scannedAt);
    console.log('Counts:', map.counts);
    console.log('Function index:', fnIndex.counts);
    console.log('');
    console.log('Top owners (server handlers):');
    const byOwner = map.views.owner;
    Object.keys(byOwner)
        .sort((a, b) => byOwner[b].length - byOwner[a].length)
        .slice(0, 12)
        .forEach((owner) => {
            console.log(`  ${owner}: ${byOwner[owner].length} handlers`);
        });
    console.log('');
    console.log('Known pipelines:');
    for (const [key, pipe] of Object.entries(map.views.pipeline)) {
        const ok = pipe.link ? '✓' : '○';
        console.log(`  ${ok} ${key} (${pipe.label})`);
    }
}

function cmdList(flags) {
    const dim = flags.dimension || 'pipeline';
    const map = flowMap.buildFlowMap();

    if (!flowMap.DIMENSIONS.includes(dim)) {
        console.error('Invalid dimension. Valid:', flowMap.DIMENSIONS.join(', '));
        process.exit(1);
    }

    const view = map.views[dim];

    if (dim === 'pipeline') {
        for (const [key, pipe] of Object.entries(view)) {
            const callers = pipe.link?.client?.callers?.length || 0;
            const inbounds = pipe.link?.client?.inbounds?.length || 0;
            console.log(`${key}\t${pipe.requestType}\tcallers:${callers}\tinbound:${inbounds}`);
        }
        return;
    }

    if (dim === 'owner') {
        for (const [owner, handlers] of Object.entries(view)) {
            console.log(`${owner}\t${handlers.length} handlers`);
        }
        return;
    }

    if (dim === 'messageType') {
        const types = Object.keys(view).sort();
        console.log(`${types.length} message types`);
        types.slice(0, 30).forEach((t) => console.log(' ', t));
        if (types.length > 30) console.log(`  ... and ${types.length - 30} more`);
        return;
    }

    console.log(JSON.stringify(view, null, 2));
}

function cmdPipeline(name, flags) {
    if (!name) {
        console.error('Usage: flow-map pipeline <name> [--out path]');
        process.exit(1);
    }

    const map = flowMap.buildFlowMap({ includeCallGraphs: true });
    const md = flowMap.exportPipelineMarkdown(name, map);
    const outPath = flags.out || path.join(flowMap.PATHS.defaultOutputDir, 'examples', `${name}.md`);

    ensureDirForFile(outPath);
    fs.writeFileSync(outPath, md, 'utf8');
    console.log('Wrote', outPath);
}

function cmdRoot(name, flags) {
    const rootName = flags.fn || name;
    if (!rootName) {
        console.error('Usage: flow-map root <name|pipeline> [--file path] [--fn name] [--json] [--out path]');
        process.exit(1);
    }

    const traceOptions = {
        file: flags.file,
        fn: flags.fn,
        maxDepth: flags.maxDepth,
        maxNodes: flags.maxNodes
    };

    let wrapped;
    try {
        wrapped = flowMap.resolveAndTrace(rootName, traceOptions);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }

    if (flags.json) {
        const json = flowMap.deepTraceToJson(wrapped);
        const output = JSON.stringify(json, null, 2);
        if (flags.out) {
            ensureDirForFile(flags.out);
            fs.writeFileSync(flags.out, output, 'utf8');
            console.log('Wrote', flags.out);
        } else {
            console.log(output);
        }
        return;
    }

    const md = flowMap.deepTraceToMarkdown(wrapped, traceOptions);
    const defaultName = wrapped.mode === 'pipeline'
        ? `${rootName}-deep`
        : `${rootName}-deep`;
    const outPath = flags.out || path.join(flowMap.PATHS.defaultOutputDir, 'examples', `${defaultName}.md`);

    if (flags.out || !flags.json) {
        ensureDirForFile(outPath);
        fs.writeFileSync(outPath, md, 'utf8');
        console.log('Wrote', outPath);
    }

    const data = wrapped.result;
    console.log('');
    console.log('Deep trace summary');
    console.log('------------------');
    console.log('Mode:', wrapped.mode);
    if (data.root) {
        console.log('Root:', `${data.root.name} (${data.root.file}:${data.root.line})`);
    } else if (data.pipeline) {
        console.log('Pipeline:', data.pipeline, '→', data.requestType);
        console.log('Roots:', data.roots?.length || 0);
    }
    console.log('Stats:', data.stats);
}

function cmdMermaid(name) {
    if (!name) {
        console.error('Usage: flow-map mermaid <name>');
        process.exit(1);
    }
    console.log(flowMap.exportPipelineMermaid(name));
}

function cmdOwner(owner) {
    if (!owner) {
        console.error('Usage: flow-map owner <owner>');
        process.exit(1);
    }
    const ws = flowMap.scanWsFlow();
    console.log(flowMap.ownerToGraphMermaid(owner, ws.links));
}

function main() {
    const { cmd, flags, positional } = parseArgs(process.argv);

    if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
        printUsage();
        process.exit(cmd ? 0 : 1);
    }

    switch (cmd) {
        case 'scan':
            cmdScan(flags);
            break;
        case 'list':
            cmdList(flags);
            break;
        case 'pipeline':
            cmdPipeline(positional[0], flags);
            break;
        case 'root':
            cmdRoot(positional[0], flags);
            break;
        case 'mermaid':
            cmdMermaid(positional[0]);
            break;
        case 'owner':
            cmdOwner(positional[0]);
            break;
        default:
            console.error('Unknown command:', cmd);
            printUsage();
            process.exit(1);
    }
}

main();
