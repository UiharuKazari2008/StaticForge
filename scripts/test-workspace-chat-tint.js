'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const directorSrc = fs.readFileSync(path.join(root, 'public/scripts/comp/director.js'), 'utf8');
const directorCss = fs.readFileSync(path.join(root, 'public/css/director.css'), 'utf8');

function extractMethod(src, signature) {
    const at = src.indexOf(signature);
    assert.ok(at >= 0, 'missing ' + signature);
    const brace = src.indexOf('{', at);
    let depth = 0;
    for (let i = brace; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return 'function ' + src.slice(at, i + 1);
        }
    }
    throw new Error('unclosed ' + signature);
}

function element() {
    const attrs = {};
    const styleProps = {};
    const classes = new Set();
    return {
        attrs,
        styleProps,
        textContent: '',
        classList: {
            add(name) { classes.add(name); },
            remove(name) { classes.delete(name); },
            contains(name) { return classes.has(name); }
        },
        setAttribute(name, value) { attrs[name] = String(value); },
        removeAttribute(name) { delete attrs[name]; },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
        },
        style: {
            setProperty(name, value) { styleProps[name] = value; },
            removeProperty(name) { delete styleProps[name]; }
        }
    };
}

function paint(session, openWorkspace) {
    const chat = element();
    const banner = element();
    const text = element();
    banner.classList.add('hidden');
    const host = {
        directorSessionChat: chat,
        currentSession: session,
        sessionWorkspaceMeta(row) {
            if (!row || !row.workspaceId) return null;
            return { id: row.workspaceId, name: row.workspaceName || row.workspaceId, color: '#ff4fa3' };
        },
        currentWorkspaceId() { return openWorkspace; }
    };
    const document = {
        getElementById(id) {
            if (id === 'directorWorkspaceBanner') return banner;
            if (id === 'directorWorkspaceBannerText') return text;
            return null;
        }
    };
    const code = extractMethod(directorSrc, 'paintWorkspaceBanner() {');
    vm.runInNewContext(`(${code}).call(host);`, { host, document });
    return { chat, banner, text };
}

function testPairedWorkspaceClass() {
    const mismatched = paint({ workspaceId: 'lab', workspaceName: 'Lab' }, 'desk');
    assert.strictEqual(mismatched.chat.getAttribute('data-workspace'), 'lab');
    assert.deepStrictEqual(mismatched.chat.styleProps, {});
    assert.strictEqual(mismatched.banner.classList.contains('hidden'), false);
    assert.strictEqual(mismatched.text.textContent, 'This session belongs to Lab');

    const home = paint({ workspaceId: 'lab', workspaceName: 'Lab' }, 'lab');
    assert.strictEqual(home.chat.getAttribute('data-workspace'), 'lab');
    assert.strictEqual(home.banner.classList.contains('hidden'), true);
    assert.deepStrictEqual(home.chat.styleProps, {});

    const unpaired = paint({ workspaceId: '' }, 'desk');
    assert.strictEqual(unpaired.chat.getAttribute('data-workspace'), null);
    assert.strictEqual(unpaired.banner.classList.contains('hidden'), true);

    const draft = paint({ workspaceId: 'lab', draft: true }, 'desk');
    assert.strictEqual(draft.chat.getAttribute('data-workspace'), null);
}

function testNoInlineTint() {
    assert.strictEqual(directorSrc.includes('workspaceTint'), false);
    assert.strictEqual(directorSrc.includes('--director-workspace'), false);
    assert.strictEqual(directorSrc.includes('data-workspace-tint'), false);
    assert.strictEqual(directorCss.includes('data-workspace-tint'), false);
    assert.strictEqual(directorCss.includes('--director-workspace'), false);
    assert.strictEqual(directorCss.includes('color-mix(in srgb, var(--director-workspace)'), false);
    assert.ok(directorCss.includes('--header-bg'), 'banner uses the workspace glass header fill');
    assert.ok(directorSrc.includes("setAttribute('data-workspace'"), 'chat root sets the compiled workspace attribute');
}

function main() {
    testPairedWorkspaceClass();
    testNoInlineTint();
    console.log('test-workspace-chat-tint: ok');
}

main();
