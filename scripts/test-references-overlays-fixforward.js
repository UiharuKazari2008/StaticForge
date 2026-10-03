#!/usr/bin/env node
/**
 * #251 regressions: chat ingests rawResponse only without structured data,
 * director stringifies unknown legacy measurement objects, and text overlay
 * data picks up programmatic textarea edits.
 * Run: node scripts/test-references-overlays-fixforward.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const compDir = path.join(__dirname, '../public/scripts/comp');
const read = (name) => fs.readFileSync(path.join(compDir, name), 'utf8');

function extractBlock(src, header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, `missing ${header}`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced ${header}`);
}

function loadMethod(file, header, name, globals = {}) {
    const ctx = Object.assign({}, globals);
    vm.createContext(ctx);
    vm.runInContext(`const holder = { ${extractBlock(read(file), header)} };`, ctx);
    return vm.runInContext(`holder.${name}`, ctx);
}

// Chat: raw string passes through untouched when jsonData is present.
{
    const handle = loadMethod('chatSystem.js', '    handleChatMessageResponse(message) {', 'handleChatMessageResponse');
    let ingestCalls = 0;
    let added = null;
    const chat = {
        currentChatId: 'c1',
        isChatInterfaceModalOpen: () => true,
        ingestMessageContent: (raw) => { ingestCalls++; return { messageContent: `parsed:${raw}` }; },
        addMessageToUI: (type, content, jsonData) => { added = { type, content, jsonData }; },
        scrollToBottom() {},
        resetSendButton() {},
        loadChatMessages() {}
    };
    const jsonData = { speech: 'hi' };
    handle.call(chat, { data: { success: true, chatId: 'c1', rawResponse: '{"x":1}', response: jsonData } });
    assert.strictEqual(ingestCalls, 0, 'no parse when structured response is present');
    assert.strictEqual(added.content, '{"x":1}', 'raw string passed as before');
    assert.strictEqual(added.jsonData, jsonData);

    handle.call(chat, { data: { success: true, chatId: 'c1', rawResponse: '{"x":2}', response: null } });
    assert.strictEqual(ingestCalls, 1, 'parse once without structured response');
    assert.strictEqual(added.content._chatIngest.messageContent, 'parsed:{"x":2}');
    console.log('ok: chat ingest only without jsonData');
}

// Director: unknown legacy objects use JSON.stringify(value, null, 2).
{
    const format = loadMethod('director.js', '    formatLegacyMeasurementValue(value) {', 'formatLegacyMeasurementValue');
    const value = { waist: 60, extra: { a: 1 } };
    assert.strictEqual(format(value).displayValue, JSON.stringify(value, null, 2), 'unknown object stringified');
    assert.strictEqual(format({ imperial: '5ft', metric: '152cm' }).displayValue, '5ft / 152cm', 'known shape unchanged');
    console.log('ok: director legacy object stringify');
}

// Text overlays: programmatic .value on an unfocused textarea is not missed.
{
    const src = read('textOverlayManager.js');
    const makeItem = (id, value, originalValue) => {
        const textarea = { value, placeholder: '', dataset: originalValue === undefined ? {} : { originalValue } };
        const enabledBtn = { getAttribute: () => 'on' };
        return {
            id,
            dataset: { targetIndex: '0', stages: '00', textType: 'speech' },
            classList: { contains: () => false },
            _textArea: textarea,
            _enabledBtn: enabledBtn
        };
    };
    const empty = makeItem('o1', '');
    const shown = makeItem('o2', 'line one ⏎ line two', 'line one\nline two');
    const ctx = {
        textOverlaysContainer: { querySelectorAll: () => [empty, shown] },
        document: { activeElement: null, getElementById: () => null }
    };
    vm.createContext(ctx);
    vm.runInContext(extractBlock(src, 'function textOverlayNewlinesToDisplay(') + '\n'
        + extractBlock(src, 'function textOverlayDisplayToNewlines(') + '\n'
        + extractBlock(src, 'function ensureTextOverlayModel(') + '\n'
        + extractBlock(src, 'function getTextOverlayData('), ctx);
    const getData = vm.runInContext('getTextOverlayData', ctx);

    let data = getData();
    assert.deepStrictEqual(Array.from(data, (d) => d.text), ['line one\nline two'], 'initial model');

    empty._textArea.value = 'programmatic text';
    shown._textArea.value = 'edited ⏎ by script';
    data = getData();
    assert.deepStrictEqual(Array.from(data, (d) => d.text), ['programmatic text', 'edited\nby script'],
        'programmatic edits picked up (display form converted)');

    shown._textArea.value = 'hello ⏎';
    empty._textArea.value = 'a ⏎ ⏎ b';
    data = getData();
    assert.deepStrictEqual(Array.from(data, (d) => d.text), ['a\n\nb', 'hello'],
        'trimmed and collapsed display marks become newlines');
    assert.ok(!data.some((d) => d.text.includes('⏎')), 'display mark is not sent');
    console.log('ok: overlay text falls back to textarea value');
}

console.log('\ntest-references-overlays-fixforward: all passed');
