#!/usr/bin/env node

const ParallelPreviewGenerator = require('./modules/parallelPreviewGenerator');
const os = require('os');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
    batchSize: parseInt(args.find(arg => arg.startsWith('--workers='))?.split('=')[1]) || Math.min(os.cpus().length, 6),
    skipExisting: args.includes('--skip-existing'),
    forceRegenerate: args.includes('--force')
};

console.log('🚀 StaticForge Parallel Preview Generator');
console.log(`💻 Using ${options.batchSize} workers (${os.cpus().length} CPU cores available)`);
console.log(`📁 Working directory: ${process.cwd()}`);

if (options.skipExisting) {
    console.log('⏭️  Skipping existing previews');
}

if (options.forceRegenerate) {
    console.log('🔄 Force regenerating all previews');
}

const generator = new ParallelPreviewGenerator({
    ...options,
    onProgress: (processed, total, progress) => {
        // Optional: Add progress bar or other UI updates
    },
    onComplete: (results) => {
        console.log('\n🎉 Generation complete!');
        if (results.errors > 0) {
            console.log(`⚠️  ${results.errors} images failed to process`);
        }
    },
    onError: (basename, error) => {
        // Optional: Log errors to file or send notifications
    }
});

// Run the appropriate generation method
if (args.includes('--new-only')) {
    console.log('🔍 Generating previews for new images only...');
    generator.generatePreviewsForNewImages().catch(console.error);
} else {
    console.log('🔄 Generating all previews...');
    generator.generateAllPreviews().catch(console.error);
}
