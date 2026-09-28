const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { VfsSystemProvider } = require('../modules/vfsSystemProvider');

const ALLOWED = [
    { pathKey: 'characters', name: 'characters.json' },
    { pathKey: 'datasetTagGroups', name: 'dataset_tag_groups.json' },
    { pathKey: 'datasetTags', name: 'dataset_tags.json' },
    { pathKey: 'datasetTagsFurry', name: 'dataset_tags_furry.json' },
    { pathKey: 'naxGenerationConfig', name: 'nax_generation_config.json' }
];

const BLOCKED = [
    'config',
    'secureConfig',
    'promptConfig',
    'directorConfig',
    't5Vocabulary',
    'sessions',
    'root',
    'securePrompts',
    '../config',
    '..\\config',
    'characters/../config',
    'config/../characters',
    './characters',
    'characters/',
    ' characters',
    'characters ',
    'CONFIG',
    'Characters',
    '..',
    '/',
    'notARealKey'
];

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-rootjson-'));
const getPathCalls = [];

const pathMap = {
    characters: path.join(fixtureDir, 'characters.json'),
    datasetTagGroups: path.join(fixtureDir, 'dataset_tag_groups.json'),
    datasetTags: path.join(fixtureDir, 'dataset_tags.json'),
    datasetTagsFurry: path.join(fixtureDir, 'dataset_tags_furry.json'),
    naxGenerationConfig: path.join(fixtureDir, 'nax_generation_config.json'),
    config: path.join(fixtureDir, 'config.json'),
    secureConfig: path.join(fixtureDir, 'secure.config.json'),
    promptConfig: path.join(fixtureDir, 'prompt.config.json'),
    directorConfig: path.join(fixtureDir, 'director.config.json'),
    t5Vocabulary: path.join(fixtureDir, 't5-vocabulary.json'),
    sessions: path.join(fixtureDir, 'sessions'),
    root: fixtureDir,
    securePrompts: path.join(fixtureDir, 'securePrompts')
};

for (const entry of ALLOWED) {
    fs.writeFileSync(pathMap[entry.pathKey], JSON.stringify({ dummy: true, file: entry.name }));
}
fs.writeFileSync(pathMap.config, JSON.stringify({ dummy: true, file: 'config.json', secret: 'should-not-be-read' }));
fs.writeFileSync(pathMap.secureConfig, JSON.stringify({ dummy: true, file: 'secure.config.json', secret: 'should-not-be-read' }));
fs.writeFileSync(pathMap.promptConfig, JSON.stringify({ dummy: true, file: 'prompt.config.json' }));
fs.writeFileSync(pathMap.directorConfig, JSON.stringify({ dummy: true, file: 'director.config.json' }));
fs.writeFileSync(pathMap.t5Vocabulary, JSON.stringify({ dummy: true, file: 't5-vocabulary.json' }));
fs.mkdirSync(pathMap.sessions);
fs.mkdirSync(pathMap.securePrompts);

const provider = new VfsSystemProvider({
    getPath(key) {
        getPathCalls.push(key);
        if (!pathMap[key]) {
            throw new Error(`Unknown path key: ${key}`);
        }
        return pathMap[key];
    }
});

function resetGetPathCalls() {
    getPathCalls.length = 0;
}

function assertNotFound(systemFileKey) {
    resetGetPathCalls();
    return provider.readFile(systemFileKey).then(
        () => {
            throw new Error(`expected not-found for ${systemFileKey}`);
        },
        (err) => {
            assert.strictEqual(err.message, 'File not found', systemFileKey);
            assert.ok(
                !getPathCalls.includes('config') && !getPathCalls.includes('secureConfig'),
                `getPath must not look up secrets for ${systemFileKey}`
            );
            const requested = systemFileKey.slice('rootjson:'.length);
            if (!ALLOWED.some((entry) => entry.pathKey === requested)) {
                assert.ok(
                    !getPathCalls.includes(requested),
                    `getPath must not be called for blocked key ${requested}`
                );
            }
        }
    );
}

async function run() {
    for (const entry of ALLOWED) {
        resetGetPathCalls();
        const result = await provider.readFile(`rootjson:${entry.pathKey}`);
        assert.strictEqual(result.kind, 'text');
        assert.strictEqual(result.name, entry.name);
        assert.strictEqual(result.mimeType, 'application/json');
        assert.strictEqual(result.syntax, 'json');
        assert.strictEqual(result.readOnly, true);
        const parsed = JSON.parse(result.content);
        assert.strictEqual(parsed.dummy, true);
        assert.strictEqual(parsed.file, entry.name);
        assert.deepStrictEqual(getPathCalls, [entry.pathKey]);
    }

    for (const key of BLOCKED) {
        await assertNotFound(`rootjson:${key}`);
    }

    resetGetPathCalls();
    const listed = await provider.listDirectory(['Config']);
    const rootJsonItems = listed.filter((item) => String(item.systemFileKey || '').startsWith('rootjson:'));
    assert.deepStrictEqual(
        rootJsonItems.map((item) => item.systemFileKey).sort(),
        ALLOWED.map((entry) => `rootjson:${entry.pathKey}`).sort()
    );
    assert.ok(getPathCalls.every((key) => ALLOWED.some((entry) => entry.pathKey === key)));

    resetGetPathCalls();
    const stats = provider.getPathStats(['Config']);
    assert.strictEqual(typeof stats.itemCount, 'number');
    assert.ok(stats.itemCount >= ALLOWED.length);
    assert.ok(getPathCalls.every((key) => ALLOWED.some((entry) => entry.pathKey === key)));
    let expectedSize = 0;
    for (const entry of ALLOWED) {
        expectedSize += fs.statSync(pathMap[entry.pathKey]).size;
    }
    assert.strictEqual(stats.totalSizeBytes, expectedSize);

    resetGetPathCalls();
    const nestedStats = provider.getPathStats(['Config', 'config']);
    assert.deepStrictEqual(nestedStats, { itemCount: 0, totalSizeBytes: 0 });
    assert.deepStrictEqual(getPathCalls, []);
}

run().then(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    console.log('test-vfs-rootjson-allowlist: ok');
}).catch((error) => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    console.error(error);
    process.exit(1);
});
