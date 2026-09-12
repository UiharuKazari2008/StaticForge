const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/copyLinkback.js'), 'utf8');

let copied = null;
let toasts = [];
let metadataCalls = 0;

const ctx = {
    console,
    activeWorkspace: 'atelier',
    copyTextToClipboard(text) {
        copied = text;
        return Promise.resolve();
    },
    showGlassToast(type, title, message) {
        toasts.push({ type, title, message });
    },
    getImageMetadata(filename) {
        metadataCalls += 1;
        return Promise.resolve({
            filename,
            seed: 4242,
            model: 'v4_5',
            workspaceId: 'atelier',
            width: 832,
            height: 1216
        });
    }
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

assert.strictEqual(
    ctx.formatLinkbackLine({
        filename: 'foo.png',
        seed: 99,
        model: 'v4_5',
        workspaceId: 'atelier',
        resolution: '832x1216'
    }),
    'dsref:file:foo.png seed:99 model:v4_5 ws:atelier res:832x1216'
);

assert.strictEqual(
    ctx.formatLinkbackLine({ filename: 'bar.png' }),
    'dsref:file:bar.png seed:- model:- ws:- res:-'
);

async function tick() {
    await Promise.resolve();
    await Promise.resolve();
}

(async () => {
    ctx.copyLinkbackImage({
        filename: 'ready.png',
        seed: 7,
        model: 'V4_5',
        workspaceId: 'ws-1',
        width: 1024,
        height: 1024
    });
    assert.strictEqual(metadataCalls, 0);
    await tick();
    assert.strictEqual(
        copied,
        'dsref:file:ready.png seed:7 model:v4_5 ws:ws-1 res:1024x1024'
    );
    assert.ok(toasts.some((t) => t.message === 'Copied linkback'));

    copied = null;
    toasts = [];
    ctx.copyLinkbackImage('needs-meta.png');
    assert.ok(metadataCalls >= 1);
    await tick();
    assert.strictEqual(
        copied,
        'dsref:file:needs-meta.png seed:4242 model:v4_5 ws:atelier res:832x1216'
    );

    ctx.copyLinkbackImage(null);
    assert.ok(toasts.some((t) => t.message === 'No linkback target'));

    const nested = ctx.mergeLinkbackSource({
        filename: 'nested.png',
        metadata: { seed: 11, model: 'v5', width: 640, height: 640 },
        workspace: 'nested-ws'
    });
    assert.strictEqual(ctx.pickLinkbackSeed(nested), 11);
    assert.strictEqual(ctx.pickLinkbackModel(nested), 'v5');
    assert.strictEqual(ctx.pickLinkbackWorkspaceId(nested), 'nested-ws');
    assert.strictEqual(ctx.pickLinkbackResolution(nested), '640x640');

    console.log('test-copy-linkback: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
