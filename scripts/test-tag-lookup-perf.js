const assert = require('assert');

// Simulate the legacy O(N^2 log N) algorithm
function mergeAndSortOld(nameResults, bodyResults, effectiveLimit) {
    let combinedResults = [...nameResults];

    const seenIds = new Set(nameResults.map(r => r.id).filter(Boolean));
    for (const bodyResult of bodyResults) {
        if (bodyResult.id && !seenIds.has(bodyResult.id)) {
            combinedResults.push(bodyResult);
            seenIds.add(bodyResult.id);
        } else if (!bodyResult.id) {
            const titleKey = (bodyResult.title || bodyResult.displayTitle || '').toLowerCase();
            const alreadyExists = combinedResults.some(r =>
                (r.title || r.displayTitle || '').toLowerCase() === titleKey
            );
            if (!alreadyExists) {
                combinedResults.push(bodyResult);
            }
        }
    }

    combinedResults.sort((a, b) => {
        const aIsNameMatch = nameResults.some(r => r.id === a.id);
        const bIsNameMatch = nameResults.some(r => r.id === b.id);
        if (aIsNameMatch && !bIsNameMatch) return -1;
        if (!aIsNameMatch && bIsNameMatch) return 1;
        const aUsage = (a.d_count || 0) + ((a.e_count || 0) * 4) + ((a.n_count || 0) * 12);
        const bUsage = (b.d_count || 0) + ((b.e_count || 0) * 4) + ((b.n_count || 0) * 12);
        return bUsage - aUsage;
    });

    return combinedResults.slice(0, effectiveLimit);
}

// Simulate the optimized O(N log N) algorithm
function mergeAndSortNew(nameResults, bodyResults, effectiveLimit) {
    let combinedResults = [...nameResults];

    const seenIds = new Set(nameResults.map(r => r.id).filter(Boolean));
    const seenTitles = new Set(nameResults.map(r => (r.title || r.displayTitle || '').toLowerCase()));
    for (const bodyResult of bodyResults) {
        const titleKey = (bodyResult.title || bodyResult.displayTitle || '').toLowerCase();
        if (bodyResult.id && !seenIds.has(bodyResult.id)) {
            combinedResults.push(bodyResult);
            seenIds.add(bodyResult.id);
            seenTitles.add(titleKey);
        } else if (!bodyResult.id) {
            if (!seenTitles.has(titleKey)) {
                combinedResults.push(bodyResult);
                seenTitles.add(titleKey);
            }
        }
    }

    const nameResultIds = new Set(nameResults.map(r => r.id));
    combinedResults.sort((a, b) => {
        const aIsNameMatch = nameResultIds.has(a.id);
        const bIsNameMatch = nameResultIds.has(b.id);
        if (aIsNameMatch && !bIsNameMatch) return -1;
        if (!aIsNameMatch && bIsNameMatch) return 1;
        const aUsage = (a.d_count || 0) + ((a.e_count || 0) * 4) + ((a.n_count || 0) * 12);
        const bUsage = (b.d_count || 0) + ((b.e_count || 0) * 4) + ((b.n_count || 0) * 12);
        return bUsage - aUsage;
    });

    return combinedResults.slice(0, effectiveLimit);
}

// Test dataset 1: Mixed IDs and titles with duplicates
const nameResults1 = [
    { id: '1', title: 'Hatsune Miku', d_count: 100, e_count: 10, n_count: 5 },
    { id: '2', title: 'Kagamine Rin', d_count: 50, e_count: 5, n_count: 2 },
    { id: null, displayTitle: 'Custom Name Tag', d_count: 10, e_count: 0, n_count: 0 }
];

const bodyResults1 = [
    { id: '1', title: 'Hatsune Miku Duplicate', d_count: 999 }, // Should be skipped (ID exists)
    { id: '3', title: 'Megurine Luka', d_count: 80, e_count: 8, n_count: 3 }, // Added (new ID)
    { id: null, displayTitle: 'Custom Name Tag', d_count: 500 }, // Should be skipped (Title exists)
    { id: null, title: 'Brand New Body Tag', d_count: 30, e_count: 1, n_count: 0 }, // Added (new Title)
    { id: null, title: 'Brand New Body Tag', d_count: 200 } // Should be skipped (Title added above)
];

const oldOut1 = mergeAndSortOld(nameResults1, bodyResults1, 10);
const newOut1 = mergeAndSortNew(nameResults1, bodyResults1, 10);

assert.deepStrictEqual(newOut1, oldOut1, 'Test 1: Output must match old output exactly');

// Test dataset 2: Large scale check ensuring performance & correctness
const nameResults2 = [];
for (let i = 0; i < 500; i++) {
    nameResults2.push({ id: `name_${i}`, title: `Name Tag ${i}`, d_count: i, e_count: 0, n_count: 0 });
}
const bodyResults2 = [];
for (let i = 0; i < 500; i++) {
    bodyResults2.push({ id: `body_${i}`, title: `Body Tag ${i}`, d_count: i * 2, e_count: 0, n_count: 0 });
    bodyResults2.push({ id: `name_${i}`, title: `Duplicate Name Tag ${i}`, d_count: 9999 });
}

const oldOut2 = mergeAndSortOld(nameResults2, bodyResults2, 100);
const newOut2 = mergeAndSortNew(nameResults2, bodyResults2, 100);

assert.deepStrictEqual(newOut2, oldOut2, 'Test 2: Large scale output must match exactly');

console.log('✅ All tag lookup performance and deduplication tests passed!');
