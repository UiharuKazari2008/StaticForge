// Regression test script for galleryView filter indexing performance

const assert = require('assert');

// 1. Emulate the new code in `public/scripts/comp/galleryView.js`
function getFilteredImagesToProcess(windowObj, allImages) {
    if (windowObj.filteredImageIndices && Array.isArray(windowObj.filteredImageIndices) && windowObj.filteredImageIndices.length > 0) {
        const result = new Array(windowObj.filteredImageIndices.length);
        const sourceArray = windowObj.originalAllImages || allImages;
        let count = 0;
        for (let i = 0; i < windowObj.filteredImageIndices.length; i++) {
            const img = sourceArray[windowObj.filteredImageIndices[i]];
            if (img) result[count++] = img;
        }
        result.length = count;
        return result;
    }
    return windowObj.originalAllImages || allImages;
}

// 2. Emulate the original O(N) chained array maps being repeatedly allocated
function originalApproach(windowObj, allImages) {
    return windowObj.filteredImageIndices && windowObj.filteredImageIndices.length > 0
        ? windowObj.filteredImageIndices.map(idx => allImages[idx]).filter(img => img)
        : allImages;
}

// 3. Tests to prove identical output
const testImages = [
    { filename: 'img1.png' },
    { filename: 'img2.png' },
    { filename: 'img3.png' },
    { filename: 'img4.png' }
];

const windowWithFilter = { filteredImageIndices: [0, 2] };
const windowNoFilter = { filteredImageIndices: null };
const testMissingImages = [
    { filename: 'img1.png' },
    undefined,
    { filename: 'img3.png' }
];

assert.deepStrictEqual(
    getFilteredImagesToProcess(windowWithFilter, testImages),
    originalApproach(windowWithFilter, testImages)
);

assert.deepStrictEqual(
    getFilteredImagesToProcess(windowNoFilter, testImages),
    originalApproach(windowNoFilter, testImages)
);

assert.deepStrictEqual(
    getFilteredImagesToProcess({ filteredImageIndices: [0, 1, 2] }, testMissingImages),
    originalApproach({ filteredImageIndices: [0, 1, 2] }, testMissingImages)
);

console.log('All tests passed: Output is identical before and after optimization.');

// 4. Benchmark to demonstrate speedup
const largeImages = [];
for (let i = 0; i < 50000; i++) largeImages.push({ file: 'img' + i });

const largeWindow = { filteredImageIndices: [] };
for (let i = 0; i < 25000; i++) largeWindow.filteredImageIndices.push(i * 2);

console.time('Original approach');
for (let i = 0; i < 200; i++) {
    originalApproach(largeWindow, largeImages);
}
console.timeEnd('Original approach');

console.time('Optimized approach');
for (let i = 0; i < 200; i++) {
    getFilteredImagesToProcess(largeWindow, largeImages);
}
console.timeEnd('Optimized approach');
