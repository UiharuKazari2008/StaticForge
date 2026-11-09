const fs = require('fs');

function extractOriginalCode() {
    return `
        let items = [];
        let selected = new Set();

        function simulate(itemsData, selectedData) {
            items = itemsData;
            selected = new Set(selectedData);

            // ORIGINAL LOGIC
            for (const id of [...selected]) if (!items.some((i) => i.id === id)) selected.delete(id);

            return [...selected];
        }

        module.exports = { simulate };
    `;
}

function extractNewCode() {
    return `
        let items = [];
        let selected = new Set();

        function simulate(itemsData, selectedData) {
            items = itemsData;
            selected = new Set(selectedData);

            // NEW LOGIC
            const itemIds = new Set(items.map((i) => i.id));
            for (const id of [...selected]) if (!itemIds.has(id)) selected.delete(id);

            return [...selected];
        }

        module.exports = { simulate };
    `;
}

function runTest() {
    const itemsData = Array.from({ length: 10000 }, (_, i) => ({ id: i }));
    // Mix of existing and non-existing IDs
    const selectedData = Array.from({ length: 5000 }, (_, i) => i * 2).concat(Array.from({ length: 5000 }, (_, i) => i + 10000));

    const originalSimulate = eval('(() => { const module = {}; ' + extractOriginalCode() + '; return module.exports.simulate; })()');
    const newSimulate = eval('(() => { const module = {}; ' + extractNewCode() + '; return module.exports.simulate; })()');

    console.log("Running original O(N^2) code...");
    const startOrig = Date.now();
    const resultOrig = originalSimulate(itemsData, selectedData);
    const endOrig = Date.now();
    console.log("Original took: " + (endOrig - startOrig) + "ms");

    console.log("Running new O(N) code...");
    const startNew = Date.now();
    const resultNew = newSimulate(itemsData, selectedData);
    const endNew = Date.now();
    console.log("New took: " + (endNew - startNew) + "ms");

    resultOrig.sort();
    resultNew.sort();
    
    if (JSON.stringify(resultOrig) !== JSON.stringify(resultNew)) {
        console.error("FAIL: Results do not match!");
        console.log("Original:", resultOrig.slice(0, 10), "...");
        console.log("New:", resultNew.slice(0, 10), "...");
        process.exit(1);
    }
    
    console.log("PASS: Results match!");
}

runTest();
