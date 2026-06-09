#!/usr/bin/env node
/**
 * Extract prompt terms from metadata (per workspace) and generate targeted quips via Grok.
 *
 * Usage:
 *   node scripts/generate-dynamic-quips.js --extract-only
 *   node scripts/generate-dynamic-quips.js --generate-only
 *   node scripts/generate-dynamic-quips.js
 *   node scripts/generate-dynamic-quips.js --workspace <workspaceId>
 */

const globalResources = require('../modules/globalResources');

function parseArgs(argv) {
    const opts = {
        extractOnly: false,
        generateOnly: false,
        workspaceFilter: null
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--extract-only') opts.extractOnly = true;
        else if (arg === '--generate-only') opts.generateOnly = true;
        else if (arg === '--workspace' && argv[i + 1]) {
            opts.workspaceFilter = argv[++i];
        }
    }

    return opts;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    console.log('Initializing StaticForge resources...');
    await globalResources.initialize();

    const manager = globalResources.getGenerationQuipsManager();

    if (opts.extractOnly) {
        const extracted = await manager.extractAllWorkspaceTerms();
        console.log('\n========== EXTRACTED TERMS ==========');
        for (const [wsId, data] of Object.entries(extracted)) {
            console.log(`\n[${data.name}] (${data.fileCount} files, ${data.terms.length} terms)`);
            data.terms.slice(0, 15).forEach((t) => {
                console.log(`  ${t.term} — ${t.occurrenceCount}x [${t.category}] w=${(t.avgWeight || 0).toFixed(1)}`);
            });
            if (data.terms.length > 15) {
                console.log(`  ... +${data.terms.length - 15} more`);
            }
        }
        console.log('\nStats:', manager.getDatabase().getStats());
        process.exit(0);
    }

    const result = await manager.runFullPipeline({
        extractOnly: false,
        generateOnly: opts.generateOnly,
        workspaceFilter: opts.workspaceFilter
    });

    console.log('\n========== GENERATION COMPLETE ==========');
    console.log('Workspaces processed:', Object.keys(result.extracted || {}).length);
    console.log('Total quip term entries:', result.totalQuips);
    console.log('Version hash:', result.versionHash);
    console.log('Stats:', result.stats);
    process.exit(0);
}

main().catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
});
