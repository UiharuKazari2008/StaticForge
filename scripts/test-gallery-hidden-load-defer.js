const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'scripts', 'comp', 'galleryImagesLoad.js'),
    'utf8'
);

const context = {
    console,
    window: {},
    isGalleryWindowHidden: () => true
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'galleryImagesLoad.js' });
const finalizeGalleryImagesLoad = context.finalizeGalleryImagesLoad;

async function run() {
    let fetchCount = 0;
    let finalizeCount = 0;
    const decisions = [];

    context.fetchGalleryBlocksInto = async () => {
        fetchCount += 1;
    };
    context.finalizeGalleryImagesLoad = async () => {
        finalizeCount += 1;
    };
    context.isGalleryLoadTokenCurrent = () => true;

    const deferred = await context.fetchAndFinalizeGalleryBlocks(
        'images',
        'default',
        19254,
        {},
        0,
        null,
        { step: (decision) => decisions.push(decision) },
        1
    );

    assert.strictEqual(deferred, false);
    assert.strictEqual(fetchCount, 0);
    assert.strictEqual(finalizeCount, 0);
    assert.deepStrictEqual(decisions, ['block-fetch-deferred']);

    context.isGalleryWindowHidden = () => false;
    context.fetchGalleryBlocksInto = async (...args) => {
        fetchCount += 1;
        args[4].push({ base: 'one' });
    };

    const loaded = await context.fetchAndFinalizeGalleryBlocks(
        'images',
        'default',
        1,
        {},
        0,
        null,
        { step() {} },
        2
    );

    assert.strictEqual(loaded, true);
    assert.strictEqual(fetchCount, 1);
    assert.strictEqual(finalizeCount, 1);

    let slimCount = 0;
    let activeItems = null;
    context.applyPinnedIndexesOverlay = () => {};
    context.slimGalleryList = (items) => {
        slimCount += 1;
        return items.map((item) => ({ ...item }));
    };
    context.setActiveGalleryList = (items) => {
        activeItems = items;
    };
    context.markGalleryImagesSyncState = () => {};

    const alreadySlim = [{ base: 'slim' }];
    await finalizeGalleryImagesLoad(
        alreadySlim,
        { pinnedIndexes: [] },
        'default',
        'images',
        0,
        { step() {} },
        3,
        true
    );
    assert.strictEqual(slimCount, 0);
    assert.strictEqual(activeItems, alreadySlim);

    await finalizeGalleryImagesLoad(
        [{ base: 'raw' }],
        { pinnedIndexes: [] },
        'default',
        'images',
        0,
        { step() {} },
        4
    );
    assert.strictEqual(slimCount, 1);

    console.log('test-gallery-hidden-load-defer: ok');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
