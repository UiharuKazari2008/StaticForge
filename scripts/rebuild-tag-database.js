/**
 * Rebuild tag_wiki.db from dumps + datasets.
 * Does not download or load missing wikis — those stay on the existing DB:
 *   node scripts/download-missing-wikis.js
 *
 * Usage:
 *   node scripts/rebuild-tag-database.js
 */

async function main() {
    console.log('1/2 Download tag dumps\n');
    await require('./download-tag-dumps').main();

    console.log('\n2/2 Create tag database\n');
    require('./create-tag-database').main();

    console.log('\n✅ Tag database rebuilt.');
    console.log('   Missing wikis (resume-safe, does not recreate DB):');
    console.log('   node scripts/download-missing-wikis.js');
}

if (require.main === module) {
    main().catch((error) => {
        console.error('❌ Rebuild failed:', error.message || error);
        process.exit(1);
    });
}

module.exports = { main };
