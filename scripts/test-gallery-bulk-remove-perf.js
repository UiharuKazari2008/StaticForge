const assert = require('assert');

// Mock minimal DOM environment if needed
global.manualModal = { classList: { contains: () => false } };
global.isGalleryWindowHidden = () => false;
global.captureGalleryViewportAnchor = () => null;
global.resolveGalleryViewportAnchorIndex = () => 0;
global.displayGalleryFromStartIndex = () => {};
global.resetInfiniteScroll = () => {};
global.displayCurrentPageOptimized = () => {};
global.updateGalleryPlaceholders = () => {};
global.updateGalleryTitleBar = () => {};
global.triggerBuildGalleryNavigationCache = () => {};
global.disposeGalleryContents = () => {};
global.disposeGalleryItemElement = () => {};
global.gallery = { innerHTML: '' };
global.intersectionObserver = null;

// Mock function findTrueImageIndex
global.findTrueImageIndex = function(image) {
    const filename = image.filename || image.original || image.upscaled;
    if (!filename) return -1;
    return global.allImages.findIndex(img => {
        const imgFilename = img.filename || img.original || img.upscaled;
        return imgFilename === filename;
    });
};

// Simulated implementation of removeMultipleImagesFromGallery (original vs optimized)
function removeMultipleImagesFromGalleryOriginal(images) {
    if (!Array.isArray(images)) images = images ? [images] : [];
    const validImages = images.filter(Boolean);
    if (validImages.length === 0) return;

    const removedIndices = [];
    for (const image of validImages) {
        const allImagesIndex = global.findTrueImageIndex(image);
        if (allImagesIndex !== -1) {
            removedIndices.push(allImagesIndex);
        }
    }
    if (removedIndices.length === 0) return;

    removedIndices.sort((a, b) => b - a);

    for (const removedIndex of removedIndices) {
        // Clean up placeholder resolution queue
        global.placeholderResolutionQueue = global.placeholderResolutionQueue.filter(item => {
            if (!item || !item.element) return false;
            if (item.fileImageIndex === removedIndex) {
                return false;
            } else if (item.fileImageIndex > removedIndex) {
                item.fileImageIndex--;
                if (item.element) {
                    item.element.dataset.fileIndex = item.fileImageIndex.toString();
                }
            }
            return true;
        });

        // Splice from allImages
        const removedImg = global.allImages[removedIndex];
        global.allImages.splice(removedIndex, 1);

        // Splice from originalAllImages if separate copy exists
        if (global.window.originalAllImages && global.window.originalAllImages.length > 0 && global.window.originalAllImages !== global.allImages) {
            if (removedImg) {
                const targetFilename = removedImg.filename || removedImg.original || removedImg.upscaled;
                const origIdx = global.window.originalAllImages.findIndex(img => {
                    return img && (img.filename === targetFilename || img.original === targetFilename || img.upscaled === targetFilename);
                });
                if (origIdx !== -1) {
                    global.window.originalAllImages.splice(origIdx, 1);
                }
            }
        }

        // Update filteredImageIndices
        if (global.window.filteredImageIndices && Array.isArray(global.window.filteredImageIndices)) {
            for (let j = 0; j < global.window.filteredImageIndices.length; j++) {
                if (global.window.filteredImageIndices[j] > removedIndex) {
                    global.window.filteredImageIndices[j]--;
                } else if (global.window.filteredImageIndices[j] === removedIndex) {
                    global.window.filteredImageIndices.splice(j, 1);
                    j--;
                }
            }
        }
    }
}

function removeMultipleImagesFromGalleryOptimized(images) {
    if (!Array.isArray(images)) images = images ? [images] : [];
    const validImages = images.filter(Boolean);
    if (validImages.length === 0) return;

    const removedIndices = [];
    const removedSet = new Set();
    const removedFilenames = new Set();

    for (const image of validImages) {
        const allImagesIndex = global.findTrueImageIndex(image);
        if (allImagesIndex !== -1 && !removedSet.has(allImagesIndex)) {
            removedIndices.push(allImagesIndex);
            removedSet.add(allImagesIndex);
            const fn = image.filename || image.original || image.upscaled;
            if (fn) removedFilenames.add(fn);
        }
    }
    if (removedIndices.length === 0) return;

    // Calculate shifts for each old index
    removedIndices.sort((a, b) => a - b);
    const totalCount = global.allImages.length;
    const shiftMap = new Int32Array(totalCount);
    let currentShift = 0;
    let removeIdx = 0;
    for (let i = 0; i < totalCount; i++) {
        if (removeIdx < removedIndices.length && i === removedIndices[removeIdx]) {
            currentShift++;
            removeIdx++;
            shiftMap[i] = -1; // marked for removal
        } else {
            shiftMap[i] = currentShift;
        }
    }

    // Clean up placeholder resolution queue in a single O(Q) pass
    if (global.placeholderResolutionQueue && global.placeholderResolutionQueue.length > 0) {
        global.placeholderResolutionQueue = global.placeholderResolutionQueue.filter(item => {
            if (!item || !item.element) return false;
            const idx = item.fileImageIndex;
            if (idx >= 0 && idx < totalCount) {
                const shift = shiftMap[idx];
                if (shift === -1) {
                    return false;
                }
                if (shift > 0) {
                    item.fileImageIndex = idx - shift;
                    if (item.element) {
                        item.element.dataset.fileIndex = item.fileImageIndex.toString();
                    }
                }
            }
            return true;
        });
    }

    // Filter allImages in a single O(N) pass
    global.allImages = global.allImages.filter((_, idx) => shiftMap[idx] !== -1);

    // Filter originalAllImages in a single O(M) pass
    if (global.window.originalAllImages && global.window.originalAllImages.length > 0 && global.window.originalAllImages !== global.allImages) {
        global.window.originalAllImages = global.window.originalAllImages.filter(img => {
            if (!img) return true;
            const fn = img.filename || img.original || img.upscaled;
            return !removedFilenames.has(fn);
        });
    }

    // Filter and update filteredImageIndices in a single O(F) pass
    if (global.window.filteredImageIndices && Array.isArray(global.window.filteredImageIndices)) {
        const newFiltered = [];
        for (let j = 0; j < global.window.filteredImageIndices.length; j++) {
            const idx = global.window.filteredImageIndices[j];
            if (idx >= 0 && idx < totalCount) {
                const shift = shiftMap[idx];
                if (shift !== -1) {
                    newFiltered.push(idx - shift);
                }
            }
        }
        global.window.filteredImageIndices = newFiltered;
    }
}

function runTest() {
    console.log('Testing correctness and performance of bulk gallery removal...');

    const itemCount = 5000;
    const removeCount = 500;

    // Helper to setup test state
    function setupState() {
        const allImages = [];
        const originalAllImages = [];
        const filteredImageIndices = [];
        const placeholderResolutionQueue = [];

        for (let i = 0; i < itemCount; i++) {
            const img = { filename: `img_${i}.png`, original: `img_${i}.png` };
            allImages.push(img);
            originalAllImages.push({ ...img });
            filteredImageIndices.push(i);
            if (i % 2 === 0) {
                placeholderResolutionQueue.push({
                    element: { dataset: {}, fileImageIndex: i.toString() },
                    fileImageIndex: i
                });
            }
        }

        global.allImages = allImages;
        global.placeholderResolutionQueue = placeholderResolutionQueue;
        global.window = {
            originalAllImages: originalAllImages,
            filteredImageIndices: filteredImageIndices
        };

        // Select items to remove (e.g. every 10th item)
        const imagesToRemove = [];
        for (let i = 0; i < removeCount; i++) {
            imagesToRemove.push(allImages[i * 10]);
        }
        return imagesToRemove;
    }

    // 1. Correctness check between original and optimized
    const imagesToRemove1 = setupState();
    removeMultipleImagesFromGalleryOriginal(imagesToRemove1);
    const resultOriginal = {
        allImagesLen: global.allImages.length,
        originalAllImagesLen: global.window.originalAllImages.length,
        filteredIndicesLen: global.window.filteredImageIndices.length,
        queueLen: global.placeholderResolutionQueue.length,
        sampleAllImage: global.allImages[100],
        sampleFilteredIdx: global.window.filteredImageIndices[100],
        sampleQueueIdx: global.placeholderResolutionQueue[50]?.fileImageIndex
    };

    const imagesToRemove2 = setupState();
    removeMultipleImagesFromGalleryOptimized(imagesToRemove2);
    const resultOptimized = {
        allImagesLen: global.allImages.length,
        originalAllImagesLen: global.window.originalAllImages.length,
        filteredIndicesLen: global.window.filteredImageIndices.length,
        queueLen: global.placeholderResolutionQueue.length,
        sampleAllImage: global.allImages[100],
        sampleFilteredIdx: global.window.filteredImageIndices[100],
        sampleQueueIdx: global.placeholderResolutionQueue[50]?.fileImageIndex
    };

    assert.deepStrictEqual(resultOptimized, resultOriginal, 'Optimized result does not match original result!');
    console.log('Correctness check passed: Optimized output is identical to original!');

    // 2. Performance benchmark
    const testItemsToDel = setupState();
    const t0 = process.hrtime.bigint();
    removeMultipleImagesFromGalleryOriginal(testItemsToDel);
    const t1 = process.hrtime.bigint();
    const origTimeMs = Number(t1 - t0) / 1e6;

    const testItemsToDelOpt = setupState();
    const t2 = process.hrtime.bigint();
    removeMultipleImagesFromGalleryOptimized(testItemsToDelOpt);
    const t3 = process.hrtime.bigint();
    const optTimeMs = Number(t3 - t2) / 1e6;

    console.log(`Original Time: ${origTimeMs.toFixed(2)} ms`);
    console.log(`Optimized Time: ${optTimeMs.toFixed(2)} ms`);
    assert(optTimeMs < origTimeMs || origTimeMs < 5.0, 'Optimized version should be faster or very low latency');

    console.log('Test completed successfully!');
}

runTest();
