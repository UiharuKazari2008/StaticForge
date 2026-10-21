const assert = require('assert');
const path = require('path');

// Extracted resolve logic matching web_server.js app.post('/test-bias-adjustment')
function resolveImagePathOriginal(image_source, imagesDir, uploadCacheDir) {
    let imagePath;
    if (image_source.startsWith('file:')) {
        imagePath = path.join(imagesDir, image_source.replace('file:', ''));
    } else if (image_source.startsWith('cache:')) {
        imagePath = path.join(uploadCacheDir, image_source.replace('cache:', ''));
    } else {
        return null;
    }
    return imagePath;
}

function resolveImagePathFixed(image_source, imagesDir, uploadCacheDir) {
    let baseDir;
    let relPath;
    if (image_source.startsWith('file:')) {
        baseDir = imagesDir;
        relPath = image_source.replace('file:', '');
    } else if (image_source.startsWith('cache:')) {
        baseDir = uploadCacheDir;
        relPath = image_source.replace('cache:', '');
    } else {
        return null;
    }

    const resolved = path.resolve(baseDir, relPath);
    if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
        return null; // Path traversal blocked
    }
    return resolved;
}

const imagesDir = path.resolve(__dirname, '../images');
const uploadCacheDir = path.resolve(__dirname, '../cache/upload');

// 1. Test original behavior allows escaping directory
const traversalPayload = 'file:../../package.json';
const unsecurePath = resolveImagePathOriginal(traversalPayload, imagesDir, uploadCacheDir);
assert.ok(unsecurePath, 'Original logic resolved a path');
assert.strictEqual(
    unsecurePath.startsWith(imagesDir + path.sep),
    false,
    'Original logic allowed escaping imagesDir'
);

// 2. Test fixed logic blocks traversal
const securePathTraversal = resolveImagePathFixed(traversalPayload, imagesDir, uploadCacheDir);
assert.strictEqual(securePathTraversal, null, 'Fixed logic blocks path traversal with file: prefix');

const cacheTraversalPayload = 'cache:../../../package.json';
const secureCacheTraversal = resolveImagePathFixed(cacheTraversalPayload, imagesDir, uploadCacheDir);
assert.strictEqual(secureCacheTraversal, null, 'Fixed logic blocks path traversal with cache: prefix');

// 3. Test fixed logic allows valid subpaths
const validFilePayload = 'file:subfolder/test.png';
const validFilePath = resolveImagePathFixed(validFilePayload, imagesDir, uploadCacheDir);
assert.strictEqual(validFilePath, path.join(imagesDir, 'subfolder/test.png'));

console.log('✅ Regression test passed!');
