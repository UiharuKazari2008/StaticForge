#!/usr/bin/env node
/**
 * Master separation CLI — interactive clone matrix TUI.
 *
 * Usage:
 *   node scripts/replication-separate.js [options]
 *
 * Options:
 *   --child-name NAME       Child display name
 *   --child-id UUID         Child instance id (generated if omitted)
 *   --transfer-mode MODE    tape-stream | tape-stream-compressed | blocks
 *   --output-dir PATH       Output directory (default: repo root)
 *   --non-interactive       Use defaults / flags only
 *   --yes                   Skip blocks-mode slow warning
 *   --live                  Initialize server stack + enter maintenance (server running)
 *   --set KEY=0|1           Set clone profile flag (repeatable)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const replicationSeparation = require('../modules/replicationSeparation');
const { REPLICATION_TRANSFER_MODES } = require('../modules/replication/replicationContracts');

const ROOT = path.resolve(__dirname, '..');

const CLONE_OPTIONS = [
    {
        key: 'workspaceImages',
        label: 'Workspace Images',
        description: 'images/ full PNG gallery blobs',
        default: false
    },
    {
        key: 'previewCache',
        label: 'Preview Cache',
        description: '.previews/ and .cache/preview/',
        default: true
    },
    {
        key: 'imageMetadata',
        label: 'Image Metadata',
        description: 'metadata.db (auto-linked when Preview on without Images)',
        default: true,
        linked: true
    },
    {
        key: 'referenceBlobs',
        label: 'Reference Blobs',
        description: '.cache/upload/ and .cache/vibe/',
        default: false
    },
    {
        key: 'vfsUserFiles',
        label: 'VFS User Files',
        description: '.cache/userFiles/',
        default: false
    },
    {
        key: 'wikiData',
        label: 'Wiki Data',
        description: 'tag_wiki.db and .cache/wiki/',
        default: true
    },
    {
        key: 'wikiMedia',
        label: 'Wiki Media',
        description: 'Cached wiki / tag-lookup images',
        default: false
    },
    {
        key: 'autoComplete',
        label: 'AutoComplete Service',
        description: 'tag_search.db, dataset_tags*.json, tag caches',
        default: true
    }
];

function parseArgs(argv) {
    const out = {
        childName: '',
        childId: '',
        transferMode: 'tape-stream-compressed',
        outputDir: ROOT,
        nonInteractive: false,
        yes: false,
        live: false,
        profile: {}
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--child-name') { out.childName = argv[++i] || ''; continue; }
        if (arg === '--child-id') { out.childId = argv[++i] || ''; continue; }
        if (arg === '--transfer-mode') { out.transferMode = argv[++i] || out.transferMode; continue; }
        if (arg === '--output-dir') { out.outputDir = path.resolve(argv[++i] || ROOT); continue; }
        if (arg === '--non-interactive') { out.nonInteractive = true; continue; }
        if (arg === '--yes') { out.yes = true; continue; }
        if (arg === '--live') { out.live = true; continue; }
        if (arg === '--set') {
            const pair = argv[++i] || '';
            const eq = pair.indexOf('=');
            if (eq > 0) {
                const key = pair.slice(0, eq);
                const val = pair.slice(eq + 1);
                out.profile[key] = val === '1' || val === 'true';
            }
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            out.help = true;
        }
    }
    return out;
}

function printHelp() {
    console.log(`Usage: node scripts/replication-separate.js [options]

Clone matrix flags: ${CLONE_OPTIONS.map((o) => o.key).join(', ')}
Transfer modes: ${REPLICATION_TRANSFER_MODES.join(', ')}
`);
}

function ask(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}

async function runInteractiveTui(args) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const profile = { ...args.profile };

    for (const opt of CLONE_OPTIONS) {
        if (profile[opt.key] === undefined) {
            profile[opt.key] = opt.default;
        }
    }

    console.log('\n=== Dreamscape Separation — Clone Matrix ===\n');
    console.log('Base shell (always): configs, workspace structure, reference metadata rows,');
    console.log('VFS folder tree, favorites/presets, pairing token.\n');

    for (let i = 0; i < CLONE_OPTIONS.length; i++) {
        const opt = CLONE_OPTIONS[i];
        const linkedNote = opt.linked ? ' [linked to Preview+Images coupling]' : '';
        const current = profile[opt.key] ? 'Y' : 'N';
        const answer = await ask(
            rl,
            `[${i + 1}/${CLONE_OPTIONS.length}] ${opt.label}${linkedNote}\n    ${opt.description}\n    Include? (${current}/y/n): `
        );
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') profile[opt.key] = true;
        else if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') profile[opt.key] = false;
    }

    const normalized = replicationSeparation.normalizeCloneProfile(profile);
    if (normalized.previewCache && !normalized.workspaceImages && normalized.imageMetadata) {
        console.log('\nNote: Preview Cache selected without Workspace Images — Image Metadata auto-included.');
    }

    let transferMode = args.transferMode;
    const modeAnswer = await ask(
        rl,
        `\nTransfer mode [${transferMode}] (${REPLICATION_TRANSFER_MODES.join('/')}): `
    );
    if (modeAnswer && REPLICATION_TRANSFER_MODES.includes(modeAnswer)) {
        transferMode = modeAnswer;
    }

    if (transferMode === 'blocks' && !args.yes) {
        console.log('\n⚠️  Blocks mode is extremely slow for large galleries.');
        const ack = await ask(rl, 'Type SLOW to confirm Blocks mode: ');
        if (ack !== 'SLOW') {
            transferMode = 'tape-stream-compressed';
            console.log('Defaulting to tape-stream-compressed.');
        }
    }

    let childName = args.childName;
    if (!childName) {
        childName = await ask(rl, '\nChild display name: ');
    }

    rl.close();

    return {
        cloneProfile: normalized,
        transferMode,
        childDisplayName: childName || 'child-node',
        childInstanceId: args.childId || undefined,
        outputDir: args.outputDir,
        live: args.live
    };
}

function buildNonInteractiveOptions(args) {
    const profile = {};
    for (const opt of CLONE_OPTIONS) {
        profile[opt.key] = args.profile[opt.key] !== undefined ? args.profile[opt.key] : opt.default;
    }
    return {
        cloneProfile: replicationSeparation.normalizeCloneProfile(profile),
        transferMode: args.transferMode,
        childDisplayName: args.childName || 'child-node',
        childInstanceId: args.childId || undefined,
        outputDir: args.outputDir,
        live: args.live
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    if (args.live) {
        const globalResources = require('../modules/globalResources');
        await globalResources.initialize();
        replicationSeparation.initialize(globalResources);
        const replicationJournal = require('../modules/replicationJournal');
        const replicationAssetRegistry = require('../modules/replicationAssetRegistry');
        await replicationJournal.initialize(globalResources);
        await replicationAssetRegistry.initialize(globalResources);
    }

    const options = args.nonInteractive
        ? buildNonInteractiveOptions(args)
        : await runInteractiveTui(args);

    if (options.transferMode === 'blocks' && !args.yes && args.nonInteractive) {
        console.error('Blocks mode in non-interactive requires --yes');
        process.exit(1);
    }

    console.log('\nCreating separation bundle...');
    console.log('Clone profile:', JSON.stringify(options.cloneProfile, null, 2));

    const result = await replicationSeparation.createSeparationBundle({
        root: ROOT,
        ...options,
        skipMaintenance: !options.live
    });

    console.log('\nDone.');
    console.log('  Archive: ', result.archivePath);
    console.log('  Manifest:', result.manifestPath);
    console.log('  Child ID: ', result.childInstanceId);
    console.log('  Token:    ', result.replicationToken);
    console.log('\nBootstrap on child:');
    console.log(`  node scripts/replication-bootstrap.js -i "${result.archivePath}" -m "${result.manifestPath}"`);
}

main().catch((err) => {
    console.error('Separation failed:', err.message || err);
    process.exit(1);
});
