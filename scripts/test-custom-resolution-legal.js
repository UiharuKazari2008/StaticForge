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

const parseRatioText = vm.runInContext('parseRatioText', ctx);
const formatAspectRatio = vm.runInContext('formatAspectRatio', ctx);
const nearestLegalCustomResolutionFromRatio = vm.runInContext('nearestLegalCustomResolutionFromRatio', ctx);
const nearestPresetResolution = vm.runInContext('nearestPresetResolution', ctx);
const parseCustomResolutionDims = vm.runInContext('parseCustomResolutionDims', ctx);
const isCustomResolutionMode = vm.runInContext('isCustomResolutionMode', ctx);
const isCustomRatioMode = vm.runInContext('isCustomRatioMode', ctx);
const RESOLUTION_GROUPS = vm.runInContext('RESOLUTION_GROUPS', ctx);

const customGroup = RESOLUTION_GROUPS.find((g) => g.group === 'Custom');
assert.ok(customGroup, 'Custom group stays');
assert.strictEqual(customGroup.options[0].value, 'custom_ratio');
assert.strictEqual(customGroup.options[0].name, 'Custom Ratio');
assert.strictEqual(customGroup.options[1].value, 'custom');
assert.strictEqual(customGroup.options[1].name, 'Custom Resolution');

function assertPair(actual, width, height, label) {
    assert.ok(actual, label);
    assert.strictEqual(actual.width, width, label + ' width');
    assert.strictEqual(actual.height, height, label + ' height');
}

assertPair(parseRatioText('4:3'), 4, 3, '4:3');
assertPair(parseRatioText('2:3'), 2, 3, '2:3');
assertPair(parseRatioText('16/9'), 16, 9, '16/9');
assertPair(parseRatioText('1.5x1'), 1.5, 1, '1.5x1');
assert.strictEqual(parseRatioText('nope'), null);
assert.strictEqual(formatAspectRatio(1152, 864), '4:3');
assert.strictEqual(formatAspectRatio(1024, 1024), '1:1');

assert.ok(isCustomResolutionMode('custom'));
assert.ok(isCustomResolutionMode('custom_ratio'));
assert.ok(isCustomResolutionMode('custom_1216x832'));
assert.ok(isCustomRatioMode('custom_ratio'));
assert.ok(!isCustomRatioMode('custom'));
assert.strictEqual(parseCustomResolutionDims('custom_ratio'), null);
assertPair(parseCustomResolutionDims('custom_1216x832'), 1216, 832, 'custom_1216x832');

const fourThree = nearestLegalCustomResolutionFromRatio(4, 3, CUSTOM_RESOLUTION_AREA.normal);
assert.ok(fourThree.width % 64 === 0 && fourThree.height % 64 === 0);
assert.ok(fourThree.width * fourThree.height <= CUSTOM_RESOLUTION_AREA.normal);
assert.ok(Math.abs(Math.log(fourThree.ratio / (4 / 3))) < 0.08);

const twoThree = nearestLegalCustomResolutionFromRatio(2, 3, CUSTOM_RESOLUTION_AREA.normal);
assert.ok(twoThree.width * twoThree.height <= CUSTOM_RESOLUTION_AREA.normal);
assert.ok(twoThree.height > twoThree.width);

const odd = nearestLegalCustomResolutionFromRatio(7, 1, CUSTOM_RESOLUTION_AREA.normal);
assert.ok(odd.width * odd.height <= CUSTOM_RESOLUTION_AREA.normal);

const portraitPreset = { width: 832, height: 1216 };
const legalFromPreset = nearestLegalCustomResolution(portraitPreset.width, portraitPreset.height, CUSTOM_RESOLUTION_AREA.normal);
assert.strictEqual(legalFromPreset.width, 832);
assert.strictEqual(legalFromPreset.height, 1216);
const ratioHop = nearestLegalCustomResolutionFromRatio(legalFromPreset.width, legalFromPreset.height, CUSTOM_RESOLUTION_AREA.normal);
assert.strictEqual(ratioHop.width, legalFromPreset.width);
assert.strictEqual(ratioHop.height, legalFromPreset.height);
const backToPreset = nearestPresetResolution(ratioHop.width, ratioHop.height, 'normal');
assert.ok(backToPreset);
assert.strictEqual(backToPreset.width, 832);
assert.strictEqual(backToPreset.height, 1216);

const customPair = nearestLegalCustomResolution(1152, 896, CUSTOM_RESOLUTION_AREA.normal);
const hopRes = nearestLegalCustomResolution(customPair.width, customPair.height, CUSTOM_RESOLUTION_AREA.normal);
assert.strictEqual(hopRes.width, customPair.width);
assert.strictEqual(hopRes.height, customPair.height);
const hopRatio = nearestLegalCustomResolutionFromRatio(customPair.width, customPair.height, CUSTOM_RESOLUTION_AREA.normal);
assert.strictEqual(hopRatio.width, customPair.width);
assert.strictEqual(hopRatio.height, customPair.height);
const hopPreset = nearestPresetResolution(customPair.width, customPair.height, 'normal');
assert.ok(hopPreset);
assert.ok(hopPreset.value.indexOf('normal_') === 0);
assert.ok(!(hopPreset.width === 832 && hopPreset.height === 1216 && customPair.width !== 832), 'custom pair must not orphan to default portrait');

const overRatio = nearestLegalCustomResolutionFromRatio(20, 1, CUSTOM_RESOLUTION_AREA.normal);
assert.ok(overRatio.width * overRatio.height <= CUSTOM_RESOLUTION_AREA.normal);

const appHtml = fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf8');
assert.ok(appHtml.includes('id="manualCustomResolutionBtn"'), 'exit btn stays');
assert.ok(appHtml.includes('id="manualRatio"'), 'ratio input in custom bank');
assert.ok(appHtml.includes('id="manualRatioPreview"'), 'ratio preview in custom bank');
assert.ok(appHtml.indexOf('manualCustomResolutionBtn') < appHtml.indexOf('manualRatio'));
assert.ok(!/SCROLL/i.test(appHtml.slice(appHtml.indexOf('manualCustomResolution'), appHtml.indexOf('saveStage0Btn'))));

const stageSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/pipelineStageManager.js'), 'utf8');
assert.ok(stageSrc.includes('${stageId}_ratio'));
assert.ok(stageSrc.includes('${stageId}_ratioPreview'));

console.log('test-custom-resolution-legal: ok', {
    normal: LEGAL_CUSTOM_RESOLUTIONS.normal.length,
    large: LEGAL_CUSTOM_RESOLUTIONS.large.length,
    max: LEGAL_CUSTOM_RESOLUTIONS.max.length,
    largeFromPortrait: `${scaledLarge.width}x${scaledLarge.height}`,
    maxFromPortrait: `${scaledMax.width}x${scaledMax.height}`
});
