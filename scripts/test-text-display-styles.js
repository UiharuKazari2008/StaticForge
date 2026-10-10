#!/usr/bin/env node
/**
 * Text display style catalog: ids, legacy weights, custom tags, change JSON, MCP schema.
 * Run: node scripts/test-text-display-styles.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    TEXT_DISPLAY_STYLES,
    TEXT_DISPLAY_GROUP_ORDER,
    LEGACY_WEIGHTED_TEXT_TAGS,
    resolveTextDisplayStyle,
    tagsForTextOverlay,
    normalizeTextOverlayRow,
    textDisplayStyleEnum,
    groupTextDisplayStyles,
    textOverlayExtractPattern
} = require('../public/scripts/comp/textDisplayStyles');
const { compileTextOverlayAppend } = require('../modules/promptTextBoundary');

const REQUIRED_IDS = [
    'speech', 'thought', 'shout', 'whisper',
    'caption', 'caption_box', 'narration', 'subtitle',
    'sign', 'chalkboard', 'whiteboard', 'neon', 'banner', 'poster', 'shirt',
    'handwritten', 'sticky', 'letter', 'book', 'newspaper',
    'screen', 'phone', 'chat',
    'sfx', 'title', 'logo',
    'graffiti', 'tattoo', 'carved', 'embroidered', 'storefront', 'label',
    'custom'
];

const REQUIRED_GROUPS = [
    'Bubbles',
    'Boxes & captions',
    'Signs & surfaces',
    'Screens & messages',
    'Comic & title',
    'Worn/applied',
    'Custom'
];

const ids = TEXT_DISPLAY_STYLES.map((style) => style.id);
const idSet = new Set(ids);
assert.strictEqual(idSet.size, ids.length, 'style ids are unique');
REQUIRED_GROUPS.forEach((group) => {
    assert.ok(TEXT_DISPLAY_GROUP_ORDER.includes(group), `missing group ${group}`);
    assert.ok(TEXT_DISPLAY_STYLES.some((style) => style.group === group), `no styles in ${group}`);
});
REQUIRED_IDS.forEach((id) => {
    const style = id === 'subtitle' ? resolveTextDisplayStyle('subtitle') : TEXT_DISPLAY_STYLES.find((row) => row.id === id);
    assert.ok(style, `missing style ${id}`);
    assert.ok(style.name, `${id} name`);
    assert.ok(style.group, `${id} group`);
    assert.ok(style.icon && style.icon.includes('fa-'), `${id} icon`);
    if (id !== 'custom') {
        assert.ok(style.tags && style.tags.length > 0, `${id} tags`);
        assert.ok(!/text:/i.test(style.tags), `${id} tags must not contain Text:`);
        assert.ok(!style.tags.includes('::'), `${id} tags are unweighted`);
        assert.strictEqual(style.tags, style.tags.toLowerCase(), `${id} tags are lowercase`);
        assert.ok(style.tags.startsWith('english text'), `${id} starts with english text`);
    }
});

assert.strictEqual(resolveTextDisplayStyle('speech').tags, 'english text, speech bubble');
assert.strictEqual(resolveTextDisplayStyle('thought').tags, 'english text, thought bubble');
assert.strictEqual(resolveTextDisplayStyle('caption').tags, 'english text, caption, subtitle');
assert.strictEqual(resolveTextDisplayStyle('subtitle').id, 'caption');
assert.strictEqual(resolveTextDisplayStyle('SUBTITLE').id, 'caption');
assert.strictEqual(resolveTextDisplayStyle('1.5::speech::').id, 'speech');
assert.strictEqual(resolveTextDisplayStyle('2.0::thought::').id, 'thought');
assert.strictEqual(resolveTextDisplayStyle(LEGACY_WEIGHTED_TEXT_TAGS.speech).id, 'speech');
assert.strictEqual(resolveTextDisplayStyle(LEGACY_WEIGHTED_TEXT_TAGS.thought).id, 'thought');
assert.strictEqual(resolveTextDisplayStyle(LEGACY_WEIGHTED_TEXT_TAGS.caption).id, 'caption');
assert.strictEqual(resolveTextDisplayStyle('3.5::english text, speech bubble::').id, 'speech');
assert.strictEqual(resolveTextDisplayStyle('2.0::english text, 3.0::caption, subtitle::').tags, 'english text, caption, subtitle');

function markBias(input, emphasis) {
    return `${emphasis}::${input}::`;
}

const speech = compileTextOverlayAppend(
    [{ text: 'Hello', type: 'speech' }],
    null,
    markBias
);
assert.ok(speech.includes('1.5::english text, speech bubble::'));
assert.ok(speech.includes('Text: Hello'));
assert.ok(speech.indexOf('english text') < speech.toLowerCase().indexOf('text:'));

const weighted = compileTextOverlayAppend(
    [{ text: 'Hi', type: '2.0::english text, speech bubble::' }],
    null,
    markBias
);
assert.ok(weighted.includes('english text, speech bubble'));
assert.strictEqual((weighted.match(/\btext:/ig) || []).length, 1);

const custom = compileTextOverlayAppend(
    [{ text: 'OPEN', type: 'custom', customText: 'english text, neon sign' }],
    null,
    markBias
);
assert.ok(custom.includes('english text, neon sign'));
assert.ok(!custom.includes('speech bubble'));
assert.ok(custom.includes('Text: OPEN'));

const customAlias = compileTextOverlayAppend(
    [{ text: 'OPEN', type: 'custom', custom: 'english text, graffiti' }],
    null,
    markBias
);
assert.ok(customAlias.includes('english text, graffiti'));

const customEmpty = compileTextOverlayAppend(
    [{ text: 'OPEN', type: 'custom', customText: '   ' }],
    null,
    markBias
);
assert.strictEqual(customEmpty, ', Text: OPEN');
assert.ok(!customEmpty.includes('english text'));
assert.ok(!customEmpty.includes('speech bubble'));
assert.strictEqual(tagsForTextOverlay({ type: 'custom', customText: '' }, null), '');

const wrapped = compileTextOverlayAppend(
    [{ text: 'Hello', type: 'custom', customText: '' }],
    null,
    markBias,
    (text) => `\uE010${text}\uE011`
);
assert.ok(wrapped.includes('\uE010Hello\uE011'));
assert.ok(!wrapped.includes('speech bubble'));

const normalized = normalizeTextOverlayRow({
    text: 'Hi',
    type: '2.0::english text, 3.0::caption, subtitle::',
    target: 0
});
assert.strictEqual(normalized.type, 'caption');
assert.strictEqual(normalized.text, 'Hi');
assert.strictEqual(normalized.target, 0);

const customRow = normalizeTextOverlayRow({
    text: 'OPEN',
    type: 'custom',
    custom: 'english text, neon sign',
    target: 1,
    stages: ['00'],
    disabled: false
});
assert.strictEqual(customRow.type, 'custom');
assert.strictEqual(customRow.customText, 'english text, neon sign');
assert.strictEqual(customRow.custom, undefined);
assert.strictEqual(customRow.target, 1);

const emptyCustomRow = normalizeTextOverlayRow({ text: 'OPEN', type: 'custom' });
assert.strictEqual(emptyCustomRow.type, 'custom');
assert.strictEqual(emptyCustomRow.customText, '');

const groups = groupTextDisplayStyles({});
assert.ok(groups.some((group) => group.group === 'Bubbles' && group.styles.some((style) => style.id === 'speech')));
assert.ok(groups.some((group) => group.group === 'Custom' && group.styles.some((style) => style.id === 'custom')));
const enumIds = textDisplayStyleEnum();
assert.ok(enumIds.includes('custom'));
assert.ok(enumIds.includes('subtitle'));
assert.ok(enumIds.includes('neon'));
TEXT_DISPLAY_STYLES.forEach((style) => assert.ok(enumIds.includes(style.id)));

const extracted = '1girl, english text, neon sign, Text: OPEN'.match(textOverlayExtractPattern());
assert.ok(extracted && extracted[1].trim() === 'OPEN');
const plain = '1girl, Text: Hello'.match(textOverlayExtractPattern());
assert.ok(plain && plain[1].trim() === 'Hello');

const doc = fs.readFileSync(path.join(__dirname, '../docs/studio-change-json.md'), 'utf8');
TEXT_DISPLAY_STYLES.forEach((style) => {
    assert.ok(doc.includes(style.id), `docs missing style id ${style.id}`);
});
assert.ok(doc.includes('customText'));
assert.ok(doc.includes('subtitle'));
assert.ok(doc.includes('no display tag'));

const changeSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/studioChangeJson.js'), 'utf8');
assert.ok(changeSrc.includes('normalizeTextOverlayRow'));
assert.ok(changeSrc.includes('customText'));
assert.ok(changeSrc.includes("type: \"custom\"") || changeSrc.includes('type custom') || changeSrc.includes('custom injects customText'));

const { _test } = require('../modules/mcpAgentFacade');
function overlaySchema(toolName) {
    const tool = _test.TOOL_DEFS.find((row) => row.name === toolName);
    assert.ok(tool, toolName);
    const schema = tool.inputSchema.properties.text_overlays;
    assert.ok(schema && schema.items && schema.items.properties, `${toolName} text_overlays schema`);
    return { tool, schema };
}
const generate = overlaySchema('generate_image');
const apply = overlaySchema('apply_studio_changes');
[generate, apply].forEach(({ tool, schema }) => {
    const typeEnum = schema.items.properties.type.enum;
    assert.ok(Array.isArray(typeEnum));
    textDisplayStyleEnum().forEach((id) => assert.ok(typeEnum.includes(id), `${tool.name} missing ${id}`));
    assert.ok(schema.items.properties.customText, `${tool.name} customText`);
    assert.ok(schema.description.includes('custom'));
    assert.ok(tool.description.includes('custom'));
    assert.ok(tool.description.includes('text_overlays') || schema.description.includes('Styles:'));
});

console.log('test-text-display-styles: ok');
