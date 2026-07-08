#!/usr/bin/env node
/**
 * Export replication cargo to a tar stream file (airgapped or manual transfer).
 *
 * Usage:
 *   node scripts/replication-export-cargo.js --out ./dreamscape-cargo.tar.zst [--mode tape-stream-compressed]
 *   node scripts/replication-export-cargo.js --out ./cargo.blocks.json --mode blocks --blocks-ack "..."
 */

const path = require('path');
const globalResources = require('../modules/globalResources');
const replicationCargoService = require('../modules/replicationCargoService');
const replicationTarStream = require('../modules/replicationTarStream');

function parseArgs(argv) {
    const opts = {
        out: '',
        mode: 'tape-stream-compressed',
        blocksAck: null,
        operation: 'ephemeral-export'
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--out') { opts.out = argv[++i]; continue; }
        if (a === '--mode') { opts.mode = argv[++i]; continue; }
        if (a === '--blocks-ack') { opts.blocksAck = argv[++i]; continue; }
        if (a === '--operation') { opts.operation = argv[++i]; continue; }
        if (a === '--help' || a === '-h') { opts.help = true; continue; }
    }
    return opts;
}

function printHelp() {
    console.log(`Usage: node scripts/replication-export-cargo.js --out FILE [options]

Options:
  --mode <tape-stream|tape-stream-compressed|blocks>   Transfer mode (default: tape-stream-compressed)
  --blocks-ack <string>                              Required exact confirmation for blocks mode
  --operation <ephemeral-export|upsert>              Cargo operation label (default: ephemeral-export)

Blocks confirmation string:
  ${replicationTarStream.BLOCKS_SLOW_PATH_CONFIRMATION}
`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help || !opts.out) {
        printHelp();
        process.exit(opts.out ? 0 : 1);
    }

    await globalResources.initialize();
    replicationCargoService.initialize(globalResources);

    const outPath = path.resolve(opts.out);
    const result = await replicationCargoService.exportToFile({
        outPath,
        transferMode: opts.mode,
        blocksAck: opts.blocksAck,
        operation: opts.operation
    });

    console.log(JSON.stringify({
        success: true,
        manifestId: result.manifestId,
        outPath: result.outPath,
        manifestPath: result.manifestPath || null,
        sha256: result.sha256 || null,
        entryCount: result.manifest?.entries?.length || 0
    }, null, 2));
}

main().catch((err) => {
    console.error(err.message || err);
    if (err.confirmationRequired) {
        console.error('\nBlocks mode requires --blocks-ack with the exact confirmation string.');
    }
    process.exit(1);
});
