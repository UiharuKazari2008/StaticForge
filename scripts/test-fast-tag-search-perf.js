const assert = require('assert');
const FastTagSearch = require('../modules/fastTagSearch');

// Mock globalResources for FastTagSearch testing
const mockAnimeTagData = {
    "1girl": { tag_name: "1girl", n_count: 100000, d_count: 50000, d_group: ["character"] },
    "solo": { tag_name: "solo", n_count: 80000, d_count: 40000, d_group: ["composition"] },
    "bra": { tag_name: "bra", n_count: 15000, d_count: 3000, d_group: ["attire"] },
    "strapless bra": { tag_name: "strapless bra", n_count: 4000, d_count: 800, d_group: ["attire"] }
};

const mockTagSearch = {
    tagData: mockAnimeTagData,
    searchIndex: {
        "1girl": ["1girl"],
        "solo": ["solo"],
        "bra": ["bra"],
        "strapless bra": ["strapless bra"]
    }
};

const mockGlobalResources = {
    getAnimeTagSearch: () => mockTagSearch,
    getFurryTagSearch: () => mockTagSearch
};

// Instantiate FastTagSearch
const fastTagSearch = new FastTagSearch(mockGlobalResources);

console.log("Testing FastTagSearch exactOnly performance optimization...");

// Test 1: searchTagGroups with exactOnly: true
const exactMatchRes = fastTagSearch.searchTagGroups("bra", { exactOnly: true });
assert.ok(exactMatchRes, "Should find exact match for 'bra'");
assert.ok(exactMatchRes.exactMatches.length >= 1, "Should find at least 1 exact match entry");
assert.strictEqual(exactMatchRes.containingGroups.length, 0, "containingGroups should be empty when exactOnly: true");
assert.strictEqual(exactMatchRes.exactMatches[0].tag, "bra");

// Test 2: searchTagGroups without exactOnly should include containingGroups
const fullRes = fastTagSearch.searchTagGroups("bra");
assert.ok(fullRes, "Should find results for 'bra'");
assert.ok(fullRes.exactMatches.length >= 1);
assert.ok(fullRes.containingGroups.length >= 1, "containingGroups should include containing tags when exactOnly is not true");

// Test 3: exactMatch function
const exactRes = fastTagSearch.exactMatch("bra", "anime");
assert.ok(exactRes, "exactMatch should return tag info for 'bra'");
assert.strictEqual(exactRes.tag, "bra");
assert.strictEqual(exactRes.confidence, 100);

// Test 4: greedySearch
const greedyRes = fastTagSearch.greedySearch("1girl solo bra", "anime");
assert.ok(Array.isArray(greedyRes), "greedySearch should return array");
assert.ok(greedyRes.length >= 2, "greedySearch should find matching tags");

console.log("✅ All FastTagSearch tests passed successfully!");
