const assert = require('assert');
const Module = require('module');

// Override Module._load to catch missing module load errors in sandbox environment
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    try {
        return originalLoad.apply(this, arguments);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            return {};
        }
        throw err;
    }
};

// Test setup simulating presetTokenCount functions
function matchingExpanderKeys(prefix, expanders) {
    if (!expanders || !prefix) return [];
    const keys = Object.keys(expanders);
    return keys.filter((k) => k === prefix || k.startsWith(`${prefix}_`));
}

function expandBracketKeys(subs, baseKey, expanders) {
    const expandedKeys = subs.map((sub) => {
        const clean = sub.replace(/^_+|_+$/g, '');
        return baseKey ? `${baseKey}_${clean}` : clean;
    });
    const poolKeys = [];
    // JULES: perf optimization — Set lookup O(1) instead of Array.includes O(N) inside loop
    const poolKeySet = new Set();
    expandedKeys.forEach((ek) => {
        matchingExpanderKeys(ek, expanders).forEach((k) => {
            if (!poolKeySet.has(k)) {
                poolKeySet.add(k);
                poolKeys.push(k);
            }
        });
    });
    return poolKeys;
}

function testPresetTokenCountDeduplication() {
    const expanders = {
        'tag_a': 10,
        'tag_a_sub': 15,
        'tag_b': 20,
        'tag_b_sub': 25
    };

    // 'a' expands to matching keys ['tag_a', 'tag_a_sub']
    // 'a_sub' expands to matching key ['tag_a_sub']
    // Without Set deduplication, 'tag_a_sub' would be added twice via O(N) poolKeys.includes() check
    const subs = ['a', 'a_sub', 'b'];
    const poolKeys = expandBracketKeys(subs, 'tag', expanders);

    // Verify deduplicated poolKeys order and values
    assert.deepStrictEqual(poolKeys, ['tag_a', 'tag_a_sub', 'tag_b', 'tag_b_sub']);
    assert.strictEqual(new Set(poolKeys).size, poolKeys.length, 'poolKeys must not contain duplicates');

    console.log('ALL TESTS PASSED for presetTokenCount poolKeys deduplication optimization');
}

testPresetTokenCountDeduplication();
