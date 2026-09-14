#!/usr/bin/env node
/**
 * Fixture checks for modules/melatonPackageStore.js (Yozora #180).
 * Does not start the HTTP/WS server.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const AdmZip = require('adm-zip');
const {
    MelatonPackageStore,
    MelatonPackageError,
    validateManifest
} = require('../modules/melatonPackageStore');

function zipFromFiles(files) {
    const zip = new AdmZip();
    for (const [name, body] of Object.entries(files)) {
        zip.addFile(name, Buffer.from(body));
    }
    return zip.toBuffer();
}

function validManifest(extra) {
    return Object.assign({
        id: 'example-tool',
        version: '1.0.0',
        title: 'Example Tool',
        launchId: 'example-tool',
        format: 'mapz',
        type: 'dsap',
        url: 'example.dreamscape.jp',
        surfaces: ['controlPanel'],
        client: { entry: 'client/index.js', html: 'client/index.html' }
    }, extra);
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'melaton-pkg-'));
    const store = new MelatonPackageStore({ rootDir: root });

    try {
        assert.throws(
            () => validateManifest({
                id: 'example-tool',
                version: '1.0.0',
                title: 'Example Tool',
                launchId: 'example-tool',
                format: 'mapz'
            }),
            (err) => err instanceof MelatonPackageError && err.code === 'PACKAGE_TYPE'
        );

        assert.throws(
            () => validateManifest(validManifest({ launchId: 'studio' })),
            (err) => err.code === 'PACKAGE_LAUNCH_RESERVED'
        );

        assert.throws(
            () => validateManifest(validManifest({ client: { entry: 'client/index.js', styles: ['x.css'] } })),
            (err) => err.code === 'PACKAGE_CSS'
        );

        const good = zipFromFiles({
            'manifest.json': JSON.stringify(validManifest()),
            'client/index.js': '/* example */\n',
            'client/index.html': '<div data-dsap="example-tool"></div>\n'
        });
        const installed = store.installFromBuffer(good, { expectedFormat: 'mapz' });
        assert.strictEqual(installed.id, 'example-tool');
        assert.strictEqual(installed.type, 'dsap');
        assert.strictEqual(installed.enabled, true);
        assert.ok(fs.existsSync(path.join(root, 'example-tool', 'manifest.json')));
        assert.strictEqual(store.list().length, 1);

        const badType = zipFromFiles({
            'manifest.json': JSON.stringify(validManifest({ type: 'hybrid' })),
            'client/index.js': 'x'
        });
        assert.throws(
            () => store.installFromBuffer(badType),
            (err) => err.code === 'PACKAGE_TYPE'
        );
        assert.strictEqual(store.list().length, 1);

        store.setEnabled('example-tool', false);
        assert.strictEqual(store.get('example-tool').enabled, false);
        store.uninstall('example-tool');
        assert.strictEqual(store.list().length, 0);
        assert.ok(!fs.existsSync(path.join(root, 'example-tool')));

        console.log('melaton package store: ok');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main();
