/**
 * Import characters.json into SQLite for the character DB applet / autofill.
 *
 * Usage:
 *   node scripts/import-characters-json.js
 *   node scripts/import-characters-json.js --replace [path/to/file.json]
 *   node scripts/import-characters-json.js --merge [path/to/file.json]
 *
 * Default source: ../characters.json → ../.cache/characters.db
 */

const fs = require('fs');
const path = require('path');

const CharactersDatabase = require('../modules/charactersDatabase');

const ROOT = path.join(__dirname, '..');
const DEFAULT_JSON = path.join(ROOT, 'characters.json');
const DB_PATH = path.join(ROOT, '.cache', 'characters.db');

function parseArgs(argv) {
    let mode = 'replace';
    let jsonPath = DEFAULT_JSON;
    const rest = [];
    for (const arg of argv) {
        if (arg === '--replace') {
            mode = 'replace';
        } else if (arg === '--merge') {
            mode = 'merge';
        } else if (arg === '--help' || arg === '-h') {
            mode = 'help';
        } else if (!arg.startsWith('-')) {
            rest.push(arg);
        } else {
            console.error('Unknown flag:', arg);
            mode = 'help';
        }
    }
    if (rest[0]) {
        jsonPath = path.isAbsolute(rest[0]) ? rest[0] : path.resolve(process.cwd(), rest[0]);
    }
    return { mode, jsonPath };
}

function main() {
    const { mode, jsonPath } = parseArgs(process.argv.slice(2));
    if (mode === 'help') {
        console.log(`Usage:
  node scripts/import-characters-json.js
  node scripts/import-characters-json.js --replace [path/to/file.json]
  node scripts/import-characters-json.js --merge [path/to/file.json]

Default JSON: ${DEFAULT_JSON}
Database:     ${DB_PATH}
`);
        process.exit(0);
    }

    if (!fs.existsSync(jsonPath)) {
        console.error('Missing input file:', jsonPath);
        process.exit(1);
    }

    console.log('Reading', jsonPath, '...');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    const fakeGr = {
        getPath(key) {
            if (key === 'databases' || key === 'cache') return path.join(ROOT, '.cache');
            throw new Error(`Unexpected getPath(${key})`);
        }
    };

    // Open (or create) DB via the same module the server uses
    const db = new CharactersDatabase(fakeGr);
    const replace = mode !== 'merge';
    console.log(replace ? 'Import mode: replace' : 'Import mode: merge');
    const stats = db.importFromJsonData(data, { replace });
    db.close();

    console.log('Done.');
    console.log(`  Copyrights:       ${stats.copyrights}`);
    console.log(`  Characters:       ${stats.characters}`);
    console.log(`  Enhancer groups:  ${stats.enhancerGroups}`);
    console.log(`  Database:         ${DB_PATH}`);
}

main();
