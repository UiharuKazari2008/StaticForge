// JULES: Mock logger module before requiring modules that depend on winston if missing in test environment
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
    if (request === './logger' || request === '../logger') {
        return {
            bootSubStep: () => {},
            error: () => {},
            warn: () => {},
            info: () => {}
        };
    }
    return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const AnimeTagSearch = require('../modules/animeTagSearch');

function testAnimeTagSearchPerf() {
    console.log('Testing AnimeTagSearch.prototype.buildSearchIndex optimization...');

    // Mock global resources
    const mockGlobalResources = {
        getPath: (key) => `/tmp/mock_${key}.json`
    };

    // Instantiate class without loading files by assigning tagData directly
    const instance = Object.create(AnimeTagSearch.prototype);
    instance.globalResources = mockGlobalResources;
    instance.tagData = {
        'hatsune miku': {
            tag_name: 'hatsune miku',
            d_id: 1,
            d_category: 'character',
            d_count: 100,
            words: ['vocaloid', 'singer']
        },
        'hatsune miku (vocaloid)': {
            tag_name: 'hatsune miku (vocaloid)',
            d_id: 2,
            d_category: 'character',
            d_count: 80,
            words: ['vocaloid']
        },
        'miku': {
            tag_name: 'miku',
            d_id: 3,
            d_category: 'character',
            d_count: 50,
            words: []
        }
    };

    instance.buildSearchIndex();

    // Verify index structures and keys
    assert.ok(instance.searchIndex['hatsune miku'], 'searchIndex should contain exact tag name entry');
    assert.deepStrictEqual(instance.searchIndex['hatsune miku'], ['hatsune miku']);

    assert.ok(instance.wordIndex['hatsune'], 'wordIndex should contain "hatsune"');
    assert.deepStrictEqual(instance.wordIndex['hatsune'], ['hatsune miku', 'hatsune miku (vocaloid)']);

    assert.ok(instance.prefixIndex['hat'], 'prefixIndex should contain "hat"');
    assert.ok(instance.prefixIndex['hat'].includes('hatsune miku'));

    assert.ok(instance.suffixIndex['sune'], 'suffixIndex should contain "sune"');
    assert.ok(instance.suffixIndex['sune'].includes('hatsune miku'));

    assert.ok(instance.wordsIndex['vocaloid'], 'wordsIndex should contain "vocaloid"');
    assert.ok(instance.wordsIndex['vocaloid'].includes('hatsune miku'));

    console.log('✅ AnimeTagSearch buildSearchIndex test passed successfully.');
}

testAnimeTagSearchPerf();
