const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Test that fails before, passes after
// We must mock what glancewellSlides uses.

const codePath = path.join(__dirname, '../public/scripts/comp/mcpActivityClient.js');

async function test() {
    let source = fs.readFileSync(codePath, 'utf8');

    // Mocks for globals used by glancewellSlides
    global.resolveViewerImage = function(name) {
        return {
            filename: name,
            width: 0,
            height: 0,
            metadata: {
                actual_width: 832,
                actual_height: 1216
            }
        };
    };
    global.resolveGalleryFullImageUrl = () => null;
    global.localGalleryImageUrl = () => null;
    global.encodeURIComponent = encodeURIComponent;
    global.glancewellSizeCache = new Map();
    global.probeGlancewellSize = async () => ({ width: 1024, height: 1024 });
    global.Promise = Promise;

    // Extract glancewellSlides using simple string manipulation or eval
    const fnMatch = source.match(/async function glancewellSlides\([\s\S]*?\n\}/);
    if (!fnMatch) throw new Error("Could not find glancewellSlides");

    // We also need to eval the function in the current context
    eval(fnMatch[0]);

    // Call it
    const slides = await glancewellSlides(['test.png']);

    assert.strictEqual(slides.length, 1);
    assert.strictEqual(slides[0].width, 832, `Width should be 832 from metadata, got ${slides[0].width}`);
    assert.strictEqual(slides[0].height, 1216, `Height should be 1216 from metadata, got ${slides[0].height}`);

    console.log("Test passed!");
}

test().catch(err => {
    console.error(err.message);
    process.exit(1);
});
