// Jules GH #389: Glancewell slides fall back to metadata width/height only when the image's own size is missing.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/mcpActivityClient.js'), 'utf8');
const start = source.indexOf('async function glancewellSlides(');
const end = source.indexOf('\nasync function syncDirectorGlancewell(', start);
assert.ok(start >= 0 && end > start, 'glancewellSlides found');

async function slidesFor(image, opts = {}) {
    const probes = [];
    const ctx = vm.createContext({
        Promise, Number, encodeURIComponent,
        resolveViewerImage: () => image,
        resolveGalleryFullImageUrl: () => null,
        localGalleryImageUrl: (n) => '/images/' + n,
        glancewellSizeCache: new Map(opts.cache ? [['/images/a.png', opts.cache]] : []),
        probeGlancewellSize: async (src) => { probes.push(src); return opts.probe || null; }
    });
    vm.runInContext(source.slice(start, end), ctx);
    const [slide] = await ctx.glancewellSlides(['a.png']);
    return { w: slide.width, h: slide.height, probes: probes.length };
}

(async () => {
    // Own size wins over metadata.
    assert.deepStrictEqual(await slidesFor({ width: 640, height: 480, metadata: { width: 832, height: 1216 } }), { w: 640, h: 480, probes: 0 });
    // Missing own size: metadata (actual_* first).
    assert.deepStrictEqual(await slidesFor({ metadata: { actual_width: 832, actual_height: 1216, width: 1, height: 1 } }), { w: 832, h: 1216, probes: 0 });
    assert.deepStrictEqual(await slidesFor({ width: 0, height: 0, metadata: { width: '1216', height: '832' } }), { w: 1216, h: 832, probes: 0 });
    // Missing or zero metadata: same as before (cache, then probe, then 1024).
    assert.deepStrictEqual(await slidesFor({}), { w: 1024, h: 1024, probes: 1 });
    assert.deepStrictEqual(await slidesFor({ metadata: null }, { probe: { width: 300, height: 200 } }), { w: 300, h: 200, probes: 1 });
    assert.deepStrictEqual(await slidesFor({ metadata: { width: 0, height: 0 } }, { cache: { width: 50, height: 60 } }), { w: 50, h: 60, probes: 0 });
    // Half metadata is not mixed in.
    assert.deepStrictEqual(await slidesFor({ metadata: { width: 832 } }, { probe: { width: 300, height: 200 } }), { w: 300, h: 200, probes: 1 });
    console.log('ok glancewell metadata size fallback');
})().catch((err) => { console.error(err); process.exit(1); });
