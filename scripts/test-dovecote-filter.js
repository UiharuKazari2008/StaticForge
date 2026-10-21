const assert = require('assert');

// Mock state
global.desktopDovecote = {
    mail: Array.from({ length: 1000 }, (_, i) => ({ id: i, subject: `Mail ${i}`, read: i % 2 === 0, folder: 'inbox' }))
};

// Original
function getRowsOriginal(ids) {
    return desktopDovecote.mail.filter((mail) => ids.includes(String(mail.id)));
}

// Optimized
function getRowsOptimized(ids) {
    const idSet = new Set(ids);
    return desktopDovecote.mail.filter((mail) => idSet.has(String(mail.id)));
}

const testIds = Array.from({ length: 100 }, (_, i) => String(i * 10));

const start1 = performance.now();
for (let i = 0; i < 1000; i++) {
    getRowsOriginal(testIds);
}
const end1 = performance.now();

const start2 = performance.now();
for (let i = 0; i < 1000; i++) {
    getRowsOptimized(testIds);
}
const end2 = performance.now();

assert.deepStrictEqual(getRowsOriginal(testIds), getRowsOptimized(testIds));

console.log(`Original: ${end1 - start1}ms`);
console.log(`Optimized: ${end2 - start2}ms`);
