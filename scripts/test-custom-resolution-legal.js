const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/utilities.js'), 'utf8');

const ctx = {
    console,
    document: {
        readyState: 'complete',
        addEventListener() {},
        createElement() { return { textContent: '' }; },
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    },
    window: {},
    showGlassToast() {}
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);

const CUSTOM_RESOLUTION_AREA = vm.runInContext('CUSTOM_RESOLUTION_AREA', ctx);
const LEGAL_CUSTOM_RESOLUTIONS = vm.runInContext('LEGAL_CUSTOM_RESOLUTIONS', ctx);
const nearestLegalCustomResolution = vm.runInContext('nearestLegalCustomResolution', ctx);
const stepLegalCustomResolution = vm.runInContext('stepLegalCustomResolution', ctx);
const nextCustomResolutionAreaLimit = vm.runInContext('nextCustomResolutionAreaLimit', ctx);

assert.ok(LEGAL_CUSTOM_RESOLUTIONS.normal.length > 0);
assert.ok(LEGAL_CUSTOM_RESOLUTIONS.large.length > 0);
assert.ok(LEGAL_CUSTOM_RESOLUTIONS.max.length > 0);

function findSquare(list) {
    return list.find((item) => item.width === item.height);
}

const normalSquare = findSquare(LEGAL_CUSTOM_RESOLUTIONS.normal);
const largeSquare = findSquare(LEGAL_CUSTOM_RESOLUTIONS.large);
const maxSquare = findSquare(LEGAL_CUSTOM_RESOLUTIONS.max);
assert.ok(normalSquare, 'normal legal set must include 1:1');
assert.ok(largeSquare, 'large legal set must include 1:1');
assert.ok(maxSquare, 'max legal set must include 1:1');
assert.strictEqual(normalSquare.width, 1024);
assert.strictEqual(largeSquare.width, 1472);
assert.strictEqual(maxSquare.width, 1728);

for (const [tier, list] of Object.entries(LEGAL_CUSTOM_RESOLUTIONS)) {
    const maxArea = CUSTOM_RESOLUTION_AREA[tier];
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        assert.ok(item.width % 64 === 0, `${tier} width step ${item.width}`);
        assert.ok(item.height % 64 === 0, `${tier} height step ${item.height}`);
        assert.ok(item.width >= 64 && item.height >= 64, `${tier} min side`);
        assert.ok(item.area <= maxArea, `${tier} ${item.width}x${item.height} exceeds ${maxArea}`);
        if (i > 0) {
            assert.ok(list[i - 1].ratio <= item.ratio, `${tier} ratio order`);
        }
    }
}

const over = nearestLegalCustomResolution(2000, 3000, CUSTOM_RESOLUTION_AREA.normal);
assert.ok(over.width * over.height <= CUSTOM_RESOLUTION_AREA.normal, 'typed oversize must snap under normal area');
assert.ok(over.width % 64 === 0 && over.height % 64 === 0);

const portrait = nearestLegalCustomResolution(832, 1216, CUSTOM_RESOLUTION_AREA.normal);
assert.strictEqual(portrait.width, 832);
assert.strictEqual(portrait.height, 1216);

const scaledLarge = nearestLegalCustomResolution(832, 1216, CUSTOM_RESOLUTION_AREA.large);
assert.ok(scaledLarge.width * scaledLarge.height > 832 * 1216, 'large tier must grow 832x1216 to a nearer max-area pair');
assert.ok(scaledLarge.width * scaledLarge.height <= CUSTOM_RESOLUTION_AREA.large);
assert.ok(Math.abs(Math.log(scaledLarge.ratio / (832 / 1216))) < Math.abs(Math.log((832 / 1216) / (1024 / 1536))) + 0.05);

const scaledMax = nearestLegalCustomResolution(832, 1216, CUSTOM_RESOLUTION_AREA.max);
assert.ok(scaledMax.width * scaledMax.height >= scaledLarge.width * scaledLarge.height);
assert.ok(scaledMax.width * scaledMax.height <= CUSTOM_RESOLUTION_AREA.max);

const cycle = nextCustomResolutionAreaLimit(CUSTOM_RESOLUTION_AREA.normal);
assert.strictEqual(cycle.maxArea, CUSTOM_RESOLUTION_AREA.large);
assert.strictEqual(nextCustomResolutionAreaLimit(cycle.maxArea).maxArea, CUSTOM_RESOLUTION_AREA.max);
assert.strictEqual(nextCustomResolutionAreaLimit(CUSTOM_RESOLUTION_AREA.max).maxArea, CUSTOM_RESOLUTION_AREA.normal);

let cur = { width: 832, height: 1216 };
const forward = [];
for (let i = 0; i < 80; i++) {
    cur = stepLegalCustomResolution(cur.width, cur.height, CUSTOM_RESOLUTION_AREA.normal, 1);
    forward.push(`${cur.width}x${cur.height}`);
}
assert.ok(forward.includes('1024x1024'), 'forward ratio walk must reach 1:1');

const last = LEGAL_CUSTOM_RESOLUTIONS.normal[LEGAL_CUSTOM_RESOLUTIONS.normal.length - 1];
cur = { width: last.width, height: last.height };
const reverse = [];
let sawSquare = false;
for (let i = 0; i < LEGAL_CUSTOM_RESOLUTIONS.normal.length + 2; i++) {
    cur = stepLegalCustomResolution(cur.width, cur.height, CUSTOM_RESOLUTION_AREA.normal, -1);
    reverse.push(`${cur.width}x${cur.height}`);
    if (cur.width === cur.height) sawSquare = true;
}
assert.ok(sawSquare, 'reverse walk from landscape extreme must land on 1:1');
assert.strictEqual(
    reverse.filter((dims) => dims === '1024x1024').length > 0,
    true
);

const first = LEGAL_CUSTOM_RESOLUTIONS.normal[0];
cur = { width: first.width, height: first.height };
const fromPortrait = [];
for (let i = 0; i < LEGAL_CUSTOM_RESOLUTIONS.normal.length + 2; i++) {
    cur = stepLegalCustomResolution(cur.width, cur.height, CUSTOM_RESOLUTION_AREA.normal, 1);
    fromPortrait.push(`${cur.width}x${cur.height}`);
}
assert.ok(fromPortrait.includes('1024x1024'), 'walk from portrait extreme must land on 1:1');

const stuck = stepLegalCustomResolution(last.width, last.height, CUSTOM_RESOLUTION_AREA.normal, 1);
assert.strictEqual(stuck.width, last.width);
assert.strictEqual(stuck.height, last.height);

console.log('test-custom-resolution-legal: ok', {
    normal: LEGAL_CUSTOM_RESOLUTIONS.normal.length,
    large: LEGAL_CUSTOM_RESOLUTIONS.large.length,
    max: LEGAL_CUSTOM_RESOLUTIONS.max.length,
    largeFromPortrait: `${scaledLarge.width}x${scaledLarge.height}`,
    maxFromPortrait: `${scaledMax.width}x${scaledMax.height}`
});
