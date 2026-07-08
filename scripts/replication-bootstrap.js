#!/usr/bin/env node
/**
 * Apply a separation bundle on a child node (maintenance-wrapped).
 *
 * Usage:
 *   node scripts/replication-bootstrap.js -i ARCHIVE.tar.zst -m MANIFEST.json [--token TOKEN] [--root PATH] [--live]
 *
 * Options:
 *   -i, --archive PATH      Separation tar or tar.zst archive
 *   -m, --manifest PATH     Sidecar manifest JSON
 *   -t, --token TOKEN       Bootstrap confirmation token (from manifest if omitted)
 *   --root PATH             Dreamscape root (default: repo root)
 *   --live                  Initialize server stack for maintenance broadcast
 *   -h, --help
 */

const path = require('path');
const fs = require('fs');
const replicationSeparation = require('../modules/replicationSeparation');
const { readManifestFile } = require('../modules/replication/manifestBuilder');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
    const out = {
        archive: '',
        manifest: '',
        token: '',
        root: ROOT,
        live: false,
        help: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-i' || arg === '--archive') { out.archive = argv[++i] || ''; continue; }
        if (arg === '-m' || arg === '--manifest') { out.manifest = argv[++i] || ''; continue; }
        if (arg === '-t' || arg === '--token') { out.token = argv[++i] || ''; continue; }
        if (arg === '--root') { out.root = path.resolve(argv[++i] || ROOT); continue; }
        if (arg === '--live') { out.live = true; continue; }
        if (arg === '-h' || arg === '--help') { out.help = true; }
    }
    return out;
}

function printHelp() {
    console.log(`Usage: node scripts/replication-bootstrap.js -i ARCHIVE -m MANIFEST [-t TOKEN] [--root PATH] [--live]`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.archive || !args.manifest) {
        printHelp();
        process.exit(args.help ? 0 : 1);
    }

    if (!fs.existsSync(args.archive)) {
        console.error('Archive not found:', args.archive);
        process.exit(1);
    }
    if (!fs.existsSync(args.manifest)) {
        console.error('Manifest not found:', args.manifest);
        process.exit(1);
    }

    const manifest = readManifestFile(args.manifest);
    const confirmToken = args.token || manifest.replicationToken;
    if (!confirmToken) {
        console.error('No confirmation token — pass -t or use a manifest with replicationToken');
        process.exit(1);
    }

    if (args.live) {
        const globalResources = require('../modules/globalResources');
        await globalResources.initialize();
        replicationSeparation.initialize(globalResources);
        const replicationJournal = require('../modules/replicationJournal');
        const replicationAssetRegistry = require('../modules/replicationAssetRegistry');
        await replicationJournal.initialize(globalResources);
        await replicationAssetRegistry.initialize(globalResources);
    } else {
        replicationSeparation.initialize({ getPath: (key) => {
            const paths = {
                root: args.root,
                images: path.join(args.root, 'images'),
                databases: path.join(args.root, '.cache'),
                cache: path.join(args.root, '.cache')
            };
            if (!paths[key]) throw new Error(`Unknown path key: ${key}`);
            return paths[key];
        } });
    }

    console.log('Preview:');
    const preview = await replicationSeparation.previewBootstrap({
        manifestPath: args.manifest,
        archivePath: args.archive
    });
    console.log(JSON.stringify(preview, null, 2));

    console.log('\nApplying bundle under maintenance...');
    const result = await replicationSeparation.applySeparationBundle({
        manifestPath: args.manifest,
        archivePath: args.archive,
        confirmToken,
        root: args.root
    });

    console.log('\nBootstrap complete.');
    console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
    console.error('Bootstrap failed:', err.message || err);
    process.exit(1);
});
