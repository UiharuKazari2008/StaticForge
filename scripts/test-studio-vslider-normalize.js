const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(require('path').join(__dirname, '../public/scripts/comp/studioVSlider.js'), 'utf8')
    .replace(/document\.addEventListener\([\s\S]*$/, '');

const ctx = {
    console,
    document: { readyState: 'complete', addEventListener() {} },
    window: {},
    openModal() {},
    closeModal() {},
    showGlassToast() {},
    requestBodyReplacements: [],
    renderRequestBodyReplacementsList() {},
    getStudioFieldValue() { return ''; },
    writeStudioFieldValue() {},
    addSharedFieldsToRequestBody() {},
    openManualModalWithContent: async () => {},
    transientWindowsWithPositions: new Set(),
    linkToolWindowToParent() {},
    addResizeHandles() {},
    renderDropdown() {},
    initDropdowns() {}
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);

const { normalizeStudioVSliderList, studioVSliderCoerceRawList, studioVSliderBlendAxis } = ctx;

const bodySlider = normalizeStudioVSliderList([{
    id: 'body_weight',
    kind: 'slider',
    target: 'body',
    value: 0.55,
    axes: [{
        id: 'weight',
        default: 0.55,
        stops: ['skinny', 'slightly chubby', 'fat']
    }]
}]);
assert.strictEqual(bodySlider.length, 1);
assert.strictEqual(bodySlider[0].kind, 'slider');
assert.strictEqual(bodySlider[0].axes[0].stops.length, 3);

const coerced = normalizeStudioVSliderList(studioVSliderCoerceRawList([{
    id: 'body',
    prefix: 'body',
    axes: {
        weight: {
            catalog: [
                { at: 0, text: 'thin' },
                { at: 1, text: 'thick' }
            ],
            default: 0.4
        }
    }
}]));
assert.strictEqual(coerced.length, 1);
assert.strictEqual(coerced[0].axes[0].target.prefix, 'body');

assert.strictEqual(normalizeStudioVSliderList([{ kind: 'slider', axes: [{ stops: [{ at: 0, text: 'a' }] }] }]).length, 0);

const stops = [
    { at: 0, text: 'skinny' },
    { at: 0.5, text: 'chubby' },
    { at: 1, text: 'fat' }
];
assert.strictEqual(studioVSliderBlendAxis(stops, 0.5), 'chubby');
assert.strictEqual(studioVSliderBlendAxis(stops, 0), 'skinny');
const midLow = studioVSliderBlendAxis(stops, 0.25);
assert.ok(midLow.includes('0.75::skinny::'), midLow);
assert.ok(midLow.includes('1.25::chubby::'), midLow);
assert.ok(!midLow.includes('1.25::skinny::') && !midLow.includes('0.75::chubby::'), midLow);

console.log('test-studio-vslider-normalize: ok');
