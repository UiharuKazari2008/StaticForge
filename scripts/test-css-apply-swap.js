// #1167: the in-place CSS apply must not rewrite a loaded <link>'s href (the sheet is dropped until the new one
// arrives = a flash on every CSS-only update). It loads the new sheet beside the old one and removes the old on load.
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'public/scripts/comp/serviceWorkerManager.js'), 'utf8');
const start = src.indexOf('    refreshStaticStylesheet(pathname, hash) {');
const body = src.slice(start, src.indexOf('    bumpStaticAssetReferences', start));
assert.ok(start > 0 && body.length > 50, 'refreshStaticStylesheet found');
assert.ok(!/\blink\.href\s*=(?!=)/.test(body), 'no in-place href rewrite of a loaded stylesheet');
assert.ok(/cloneNode\(false\)/.test(body) && /link\.after\(fresh\)/.test(body), 'new sheet is added beside the old one');
assert.ok(/addEventListener\('load'/.test(body) && /\(ok \? link : fresh\)\.remove\(\)/.test(body), 'old sheet removed on load, new one dropped on error');
console.log('css apply swap: ok');
