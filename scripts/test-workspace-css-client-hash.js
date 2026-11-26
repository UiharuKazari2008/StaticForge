// #1248: /css/workspaces.css has had two identities on the wire. The compiled file's header carries the SOURCE
// hash and the ?sha= link / workspaceCssHash used it, while the manifest entry and X-File-Hash name the BYTES
// SERVED (#1243, modules/workspaceCssService.js getManifestEntry). A client that ran the newest copy therefore
// still compared an old-looking sha against the manifest, owed a restart for the file at every start, and
// restarted for ever: the Fold restarted five times in 75 s on 2026-11-26, each time after a one-file update pack
// (100145 bytes - exactly this stylesheet), and a desktop client owed a restart since 02:44Z.
//
// One identity from now on: the bytes served, everywhere a client sees it (the manifest, X-File-Hash, the ?sha=
// link the pages are built with, and the workspaceCssHash sent over the socket). The source hash answers only
// when there is nothing compiled to hash.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const workspaceCssService = require('../modules/workspaceCssService');
const runtimeAssetService = require('../modules/runtimeAssetService');
const runtimeAssetCompiler = require('../modules/runtimeAssetCompiler');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-css-hash-'));
try {
    const compiledPath = workspaceCssService.getCompiledPath(root);
    const sourcePath = workspaceCssService.getSourceCachePath(root);
    fs.mkdirSync(path.dirname(compiledPath), { recursive: true });
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });

    // nothing compiled yet: the source hash is all there is (and it is what both sides answer with)
    fs.writeFileSync(sourcePath, '.sp { color: red; }');
    const sourceHash = sha256('.sp { color: red; }');
    assert.strictEqual(workspaceCssService.resolveSourceHash(root), sourceHash, 'the source file answers with its own sha256');
    assert.strictEqual(workspaceCssService.resolveClientCssHash(root), sourceHash, 'with nothing compiled the source hash is still the answer');
    assert.strictEqual(runtimeAssetService.hashForPageAsset(root, '/css/workspaces.css'), sourceHash, 'the ?sha= link follows it');

    // compiled: the header names the source hash, the bytes are the served copy - the two differ here
    const served = Buffer.from('/* DO NOT EDIT, READ ONLY OPTIMISED VERSION | Source file: virtual/public/css/workspaces.css */ .sp{color:red}\n');
    fs.writeFileSync(compiledPath, Buffer.concat([
        Buffer.from(`/* ${runtimeAssetCompiler.buildHeader('virtual/public/css/workspaces.css', sourceHash).replace(/^\/\* |\*\/$/g, '')} */\n`),
        served
    ]));
    const compiledBytes = fs.readFileSync(compiledPath);
    const servedHash = sha256(compiledBytes);
    const headerSourceHash = runtimeAssetCompiler.readExistingSourceHash(compiledPath);
    assert.strictEqual(headerSourceHash, sourceHash, 'the compiled file still carries the source hash in its header');
    assert.notStrictEqual(servedHash, sourceHash, 'the served bytes are a different hash than the source (the whole point)');

    const entry = workspaceCssService.getManifestEntry(root);
    assert.ok(entry, 'the manifest has an entry for the compiled file');
    assert.strictEqual(entry.hash, servedHash, 'the manifest entry names the bytes served (#1243)');
    assert.strictEqual(workspaceCssService.resolveClientCssHash(root), servedHash, 'the client hash (socket workspaceCssHash) is the same value');
    assert.strictEqual(runtimeAssetService.hashForPageAsset(root, '/css/workspaces.css'), servedHash, 'the ?sha= link is built with the same value');

    // the page the server sends names it too: the client compares the linked sha against the manifest
    const publicRoot = path.join(root, 'public');
    fs.mkdirSync(publicRoot, { recursive: true });
    fs.writeFileSync(path.join(publicRoot, 'app.html'), '<html><head><link rel="stylesheet" href="/css/workspaces.css"></head></html>');
    runtimeAssetService.updateHtmlStylesheetShaLinks(root);
    const servedHtml = fs.readFileSync(path.join(root, '.cache', 'runtime-assets', 'app.html'), 'utf8');
    assert.ok(servedHtml.includes(`/css/workspaces.css?sha=${servedHash}`), `the served page links the served hash, got: ${servedHtml.slice(0, 200)}`);

    // a compiled file that is replaced answers with its new bytes at once (no stale memo)
    fs.writeFileSync(compiledPath, Buffer.concat([runtimeAssetCompiler.buildHeader ? Buffer.from('') : Buffer.from(''), Buffer.from('.sp{color:blue}\n')]));
    const nextHash = sha256(fs.readFileSync(compiledPath));
    assert.strictEqual(workspaceCssService.getManifestEntry(root).hash, nextHash, 'the manifest follows the file');
    assert.strictEqual(workspaceCssService.resolveClientCssHash(root), nextHash, 'and so does the client hash');
    assert.strictEqual(runtimeAssetService.hashForPageAsset(root, '/css/workspaces.css'), nextHash, 'and the ?sha= link');

    console.log('workspace css client hash: ok');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
