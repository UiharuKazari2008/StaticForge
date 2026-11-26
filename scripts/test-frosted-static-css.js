#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const app = read('public/app.html');
const aero = stripComments(read('public/css/aero-glass.css'));

const frostedRoot = aero.match(/html\[data-glass="frosted"\]\s*\{([\s\S]*?)\}/);
assert.ok(frostedRoot, 'frosted mode has a root performance contract');
for (let level = 0; level <= 5; level++) {
    assert.match(
        frostedRoot[1],
        new RegExp(`--glass-blur-${level}:\\s*none\\s*;`),
        `frosted disables glass blur level ${level}`
    );
    assert.match(
        frostedRoot[1],
        new RegExp(`--glass-blur-circle-${level}:\\s*none\\s*;`),
        `frosted disables circular glass blur level ${level}`
    );
}

const staticRule = aero.match(
    /html\[data-glass="frosted"\],\s*html\[data-glass="frosted"\]\s*:where\(body,\s*body \*\),\s*html\[data-glass="frosted"\] body::before,\s*html\[data-glass="frosted"\] body::after,\s*html\[data-glass="frosted"\] body \*::before,\s*html\[data-glass="frosted"\] body \*::after\s*\{([\s\S]*?)\}/
);
// Pseudo-elements are invalid inside :is() / :where(); a forgiving list drops them silently (#406)
assert.ok(!/:(?:where|is)\([^)]*::(?:before|after)/.test(aero), 'aero-glass.css never puts ::before / ::after inside :where() / :is()');
assert.ok(staticRule, 'frosted covers the root, body, descendants and generated surfaces');
assert.match(staticRule[1], /-webkit-backdrop-filter:\s*none\s*!important\s*;/);
assert.match(staticRule[1], /backdrop-filter:\s*none\s*!important\s*;/);
assert.match(
    aero,
    /html\[data-glass="frosted"\]\s*:where\(#focus-overlay,\s*\.websocket-ticker\)\s*\{[^}]*transform:\s*none\s*;[^}]*backface-visibility:\s*visible\s*;/,
    'frosted removes live-glass compositor layers'
);
assert.match(
    aero,
    /html\[data-glass="frosted"\]\s*:where\(\s*\.manual-loading-overlay,\s*\.manual-loading-overlay\.return\s*\)\s*\{[^}]*will-change:\s*opacity\s*;/,
    'frosted loading overlays do not reserve backdrop-filter layers'
);
assert.match(
    aero,
    /html\[data-glass="frosted"\]\s*:where\(\s*\.manual-preview-blur-background,\s*\.image-viewer-blur-background,\s*\.spellbook-blur-background\s*\)\s*\{[^}]*display:\s*none\s*;[^}]*filter:\s*none\s*;[^}]*will-change:\s*auto\s*;/,
    'frosted does not keep changing image backdrops as live CSS blur surfaces'
);
assert.match(
    aero,
    /html\[data-glass="frosted"\]\s*\.gallery\.has-context-open-item\s*\.gallery-item:not\(\.context-open\)\s*\{[^}]*filter:\s*none\s*;/,
    'frosted context focus does not blur every gallery tile'
);

// Basic: generated boxes lose their blur too; html.disable-blur * (gallery-move.css) reaches elements only (#406)
assert.match(
    aero,
    /html\[data-glass="basic"\] body::before,\s*html\[data-glass="basic"\] body::after,\s*html\[data-glass="basic"\] body \*::before,\s*html\[data-glass="basic"\] body \*::after\s*\{[^}]*-webkit-backdrop-filter:\s*none\s*!important\s*;[^}]*backdrop-filter:\s*none\s*!important\s*;/,
    'basic removes backdrop-filter from every ::before / ::after on the shell'
);
// Basic and reduced motion: star fields and tray pulses run no animation (#406)
const idleSelectors = /:where\(\.star-field \.star,\s*\.focus-star,\s*\.preview-star\)[\s\S]*?\.taskbar-tray-icons \*,\s*(?:html\[data-glass="basic"\]\s*)?\.taskbar-tray-icons \*::before,\s*(?:html\[data-glass="basic"\]\s*)?\.taskbar-tray-icons \*::after\s*\{[^}]*animation:\s*none\s*!important\s*;/;
assert.match(aero, new RegExp('html\\[data-glass="basic"\\]\\s*' + idleSelectors.source), 'basic stops the star fields and tray pulses');
const reducedMotion = aero.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\}\s*)\}/);
assert.ok(reducedMotion && idleSelectors.test(reducedMotion[1]), 'reduced motion stops the star fields and tray pulses');

const cssLinks = [...app.matchAll(/<link[^>]+href="\/css\/([^"]+\.css)"/g)]
    .map((match) => `public/css/${match[1]}`);
const aeroIndex = cssLinks.indexOf('public/css/aero-glass.css');
assert.ok(aeroIndex >= 0, 'app loads aero-glass.css');

const positiveImportant = /(?:-webkit-)?backdrop-filter\s*:\s*(?!none(?:\s|!|;))[^;]+!important\s*;/g;
for (const file of cssLinks.slice(aeroIndex + 1)) {
    const css = stripComments(read(file));
    assert.ok(
        !positiveImportant.test(css),
        `${file} must not override the terminal frosted no-filter contract`
    );
    positiveImportant.lastIndex = 0;
}

console.log('test-frosted-static-css: all assertions passed');
