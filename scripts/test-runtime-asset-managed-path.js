#!/usr/bin/env node
/**
 * isManagedWebPath answers "may the runtime compiler build this?", and it must agree with the
 * boot walk (walkManagedFilesAsync), which only ever collects .css and .js under public/css and
 * public/scripts.
 *
 * It used to check the first path segment alone, so everything under public/scripts counted as a
 * managed asset: /scripts/tasks/manifest.json, /scripts/graphify-out/cache/*.json and
 * /scripts/README-BlockContainer.md were handed to the JS compiler on every request for them,
 * which failed and logged "[Runtime Compile] <file>: Unexpected token: punc (:)" about a thousand
 * times each (4074 lines, a fifth of Dreamscape-error.log).
 *
 * A non-asset under a managed root must be false. A real stylesheet or script must stay true, and
 * a leftover managed-looking name outside the managed roots must stay false.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const compiler = require(path.join(ROOT, 'modules/runtimeAssetCompiler.js'));

function main() {
    const notManaged = [
        // The bug: non-assets under a managed root.
        '/scripts/tasks/manifest.json',
        '/scripts/graphify-out/cache/stat-index.json',
        '/scripts/graphify-out/cache/semantic/b18eee4e69f209c456fd79126e6fb928338ebf499c98ad767453f186318ecd57.json',
        '/scripts/README-BlockContainer.md',
        '/scripts/tasks/manifest.json?cache=1'.split('?')[0],
        '/css/fonts/NotoSans.woff2',
        '/css/theme.json',
        '/scripts/comp/app.html',
        // Managed root missing or wrong.
        '/images/wallpapers/dark.jpg',
        '/static_images/vista-logon/background.jpg',
        '/sounds/vista/ding.wav',
        '/api/status',
        '',
        null,
        undefined,
        // A .js outside the managed roots is not ours to compile.
        '/data/scripts/thing.js',
        '/vendor/thing.js',
    ];

    const managed = [
        '/scripts/comp/wmShell.js',
        '/scripts/vendor/fflate.js',
        '/scripts/tasks/status-order.js',
        '/css/desktop-mode.css',
        '/css/wm-programs.css',
        // No leading slash is the other shape callers use.
        'scripts/comp/wmShell.js',
        'css/wm-studio.css',
    ];

    for (const webPath of notManaged) {
        assert.strictEqual(
            compiler.isManagedWebPath(webPath),
            false,
            `${JSON.stringify(webPath)} must not be a managed asset (the compiler would try to compile it)`
        );
    }

    for (const webPath of managed) {
        assert.strictEqual(
            compiler.isManagedWebPath(webPath),
            true,
            `${webPath} must stay a managed asset`
        );
    }

    // The two answers must not drift apart again: every file the boot walk collects is managed,
    // and nothing it skips is.
    const walkerFilter = (name) => name.endsWith('.css') || name.endsWith('.js');
    const samples = [
        'loader.js', 'loader.json', 'notes.md', 'a.css', 'a.css.map', 'b.min.js', 'README',
    ];
    for (const name of samples) {
        const managedByRoot = compiler.isManagedWebPath(`/scripts/${name}`);
        assert.strictEqual(
            managedByRoot,
            walkerFilter(name),
            `/scripts/${name}: isManagedWebPath disagrees with the boot walk's filter`
        );
    }

    console.log('runtime asset managed-path ok');
}

main();
