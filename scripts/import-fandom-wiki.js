/**
 * CLI wrapper for Fandom wiki offline import.
 *
 *   node scripts/import-fandom-wiki.js --url https://genshin-impact.fandom.com/wiki/Character/List
 *   node scripts/import-fandom-wiki.js --url ... --follow-links --max-pages 25 --group Characters
 */

const fandomWiki = require('../modules/fandomWiki');

function parseArgs(argv) {
    const opts = {
        url: null,
        followLinks: false,
        maxPages: null,
        group: 'Imported'
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--url' && argv[i + 1]) opts.url = argv[++i];
        else if (arg === '--follow-links') opts.followLinks = true;
        else if (arg === '--max-pages' && argv[i + 1]) opts.maxPages = Number(argv[++i]);
        else if (arg === '--group' && argv[i + 1]) opts.group = argv[++i];
        else if (arg === '--help' || arg === '-h') {
            console.log('Usage: node scripts/import-fandom-wiki.js --url https://wiki.fandom.com/wiki/Page [--follow-links] [--max-pages N] [--group Name]');
            process.exit(0);
        }
    }
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv);
    if (!opts.url) {
        console.error('Provide --url https://*.fandom.com/wiki/...');
        process.exit(1);
    }
    const result = await fandomWiki.importFandomPage(null, {
        ...opts,
        onProgress: (p) => {
            const extra = p.pageId || p.message || '';
            const counts = p.current != null ? ` ${p.current}/${p.total}` : '';
            console.log(`[${p.phase}]${counts} ${extra}`.trim());
        }
    });
    console.log(JSON.stringify({
        importId: result.importId,
        wikiId: result.wikiId,
        rootPageId: result.rootPageId,
        pages: result.pages.length
    }, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
