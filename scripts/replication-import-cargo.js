#!/usr/bin/env node
/**
 * Import replication cargo from a tar stream file.
 *
 * Usage:
 *   node scripts/replication-import-cargo.js --in ./dreamscape-cargo.tar.zst [--mode tape-stream-compressed]
 *   node scripts/replication-import-cargo.js --in ./cargo.blocks.json --mode blocks --blocks-ack "..."
 */

const path = require('path');
const fs = require('fs');
const globalResources = require('../modules/globalResources');
const replicationCargoService = require('../modules/replicationCargoService');
const replicationTarStream = require('../modules/replicationTarStream');

function parseArgs(argv) {
    const opts = {
        inPath: '',
        mode: 'tape-stream-compressed',
        blocksAck: null
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--in') { opts.inPath = argv[++i]; continue; }
        if (a === '--mode') { opts.mode = argv[++i]; continue; }
        if (a === '--blocks-ack') { opts.blocksAck = argv[++i]; continue; }
        if (a === '--help' || a === '-h') { opts.help = true; continue; }
    }
    return opts;
}

function printHelp() {
    console.log(`Usage: node scripts/replication-import-cargo.js --in FILE [options]

Options:
  --mode <tape-stream|tape-stream-compressed|blocks>   Transfer mode (default: tape-stream-compressed)
  --blocks-ack <string>                              Required exact confirmation for blocks mode

Writes response JSON beside input: dreamscape-cargo-response-<manifestId>.json
`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help || !opts.inPath) {
        printHelp();
        process.exit(opts.inPath ? 0 : 1);
    }

    await globalResources.initialize();
    replicationCargoService.initialize(globalResources);

    const filePath = path.resolve(opts.inPath);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Cargo file not found: ${filePath}`);
    }

    const response = await replicationCargoService.importFromFile({
        filePath,
        transferMode: opts.mode,
        blocksAck: opts.blocksAck
    });

    const responsePath = path.join(
        path.dirname(filePath),
        `dreamscape-cargo-response-${response.manifestId}.json`
    );
    fs.writeFileSync(responsePath, JSON.stringify(response, null, 2));

    console.log(JSON.stringify({
        success: true,
        manifestId: response.manifestId,
        responsePath,
        accepted: response.accepted?.length || 0,
        skipped: response.skipped?.length || 0
    }, null, 2));
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
