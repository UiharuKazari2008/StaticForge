const path = require('path');
const globalResources = require('../modules/globalResources');

async function run() {
    const prompt = process.argv.slice(2).join(' ');
    
    if (!prompt) {
        console.error('Please provide a prompt argument');
        console.error('Usage: node scripts/analyze_prompt.js "masterpiece, 1.2::{1girl}, cat ears::, [blurry]"');
        process.exit(1);
    }

    console.log('Initializing resources...');
    await globalResources.initialize({ loadTagSearchServices: true });
    
    console.log(`\nAnalyzing prompt: "${prompt}"`);
    const result = await globalResources.getPromptLogitAnalyzer().analyzePrompt(prompt);
    
    console.log('\n========== ANALYSIS REPORT ==========');
    console.log(`Overall Effectiveness: ${(result.overallEffectiveness * 100).toFixed(1)}%`);
    console.log(`Segments: ${result.segmentCount} | Total Tokens: ${result.tokenCount}`);
    console.log(`Total Attention Mass: ${result.totalAttentionMass}`);
    console.log('=====================================\n');
    
    // Show all segments without group headers
    result.segments.forEach(seg => {
            let scoreColor = '\x1b[31m'; // Red
            if (seg.effectivenessScore > 0.75) scoreColor = '\x1b[32m'; // Green
            else if (seg.effectivenessScore > 0.4) scoreColor = '\x1b[33m'; // Yellow
            
            const reset = '\x1b[0m';
            const dim = '\x1b[2m';
            const cyan = '\x1b[36m';
            
            // Ultra-compact single-line format
            const score = (seg.effectivenessScore * 100).toFixed(0);
            const sharePercent = (seg.attentionShare * 100).toFixed(1);
            const tokenCount = seg.tokens.length;

            // Status symbol
            let statusSymbol = '✓'; // known good tags
            if (seg.status === 'filler') statusSymbol = '▫'; // filler words
            else if (seg.status === 'weak') statusSymbol = '✗';
            else if (seg.status === 'average') statusSymbol = '○';
            else if (!seg.tagSource) statusSymbol = '⚠'; // unknown but good token strength

            // Tag info
            let tagInfo = '';
            if (seg.tagSource) {
                tagInfo = `${seg.tagSource}${seg.isNovelAITrained ? '+novelai' : ''}`;
                if (seg.tagCount) tagInfo += ` @ ${seg.tagCount}`;
            } else if (seg.status === 'filler') {
                tagInfo = 'filler';
            } else if (seg.suggestions && seg.suggestions.api && seg.suggestions.api.length > 0) {
                tagInfo = `partial`;
            } else {
                tagInfo = 'unknown';
            }

            // Multiplier
            const multiplier = seg.totalAttention !== 1.0 ? `x${seg.totalAttention}` : '';

            console.log(`${scoreColor}[${score}%] ${statusSymbol} ${seg.text}${reset} | ${tagInfo} | ${multiplier} | ${cyan}${sharePercent}% ${tokenCount}t${reset}`);

            // Show partial match suggestions if available
            if (seg.suggestions && seg.suggestions.api && seg.suggestions.database) {
                // Show API suggestions first (up to 10)
                const api = seg.suggestions.api.slice(0, 10);
                if (api.length > 0) {
                    console.log(`  ${dim}NovelAI Search:${reset}`);
                    api.forEach(m => {
                        console.log(`    - ${m.tag} (${m.usage} uses, ${(m.matchPercent).toFixed(0)}% match)`);
                    });
                    if (seg.suggestions.api.length > 10) {
                        console.log(`    ... ${seg.suggestions.api.length - 10} more`);
                    }
                }

                // Show database suggestions second (up to 10)
                const dbSuggestions = seg.suggestions.database.slice(0, 10);
                if (dbSuggestions.length > 0) {
                    console.log(`  ${dim}Danbooru/e621 Search:${reset}`);
                    dbSuggestions.forEach(m => {
                        console.log(`    - ${m.tag} (${m.usage} uses, ${(m.matchPercent).toFixed(0)}% match) [${m.source}]`);
                    });
                    if (seg.suggestions.database.length > 10) {
                        console.log(`    ... ${seg.suggestions.database.length - 10} more`);
                    }
                }
            }
        });

    console.log('=====================================');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});