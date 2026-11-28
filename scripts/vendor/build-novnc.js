#!/usr/bin/env node
'use strict';
// Builds public/scripts/vendor/novnc/novnc-rfb.js, a classic script that defines window.RFB (noVNC's core RFB client, MPL-2.0).
// Input: the unpacked npm package @novnc/novnc (its CommonJS lib/), e.g.  npm pack @novnc/novnc@1.5.0 && tar xzf novnc-novnc-1.5.0.tgz
// Usage: node scripts/vendor/build-novnc.js <path to the unpacked package dir>
const fs = require('fs');
const path = require('path');
const src = process.argv[2];
if (!src) { console.error('usage: build-novnc.js <unpacked @novnc/novnc package dir>'); process.exit(1); }
const lib = path.join(src, 'lib');
const out = path.join(__dirname, '..', '..', 'public', 'scripts', 'vendor', 'novnc');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) files.push(p); } })(lib);
const version = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
let b = `/* noVNC ${version} core RFB client, bundled for the browser by scripts/vendor/build-novnc.js. MPL-2.0: see LICENSE.txt in this folder. Defines window.RFB. */\n(function (root) {\n'use strict';\nconst defs = {};\n`;
for (const f of files) b += `defs[${JSON.stringify(path.relative(lib, f).split(path.sep).join('/'))}] = function (module, exports, require) {\n${fs.readFileSync(f, 'utf8')}\n};\n`;
b += `const cache = {};
function load(id) {
  if (!defs[id] && id.indexOf('lib/') === 0) id = id.slice(4); // the package's own vendor requires say ../lib/vendor/...
  if (cache[id]) return cache[id].exports;
  if (!defs[id]) throw new Error('novnc: no module ' + id);
  const m = cache[id] = { exports: {} };
  const dir = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
  defs[id](m, m.exports, (r) => {
    const parts = (dir ? dir + '/' + r : r).split('/'); const o = [];
    for (const p of parts) { if (p === '..') o.pop(); else if (p !== '.') o.push(p); }
    return load(o.join('/'));
  });
  return m.exports;
}
root.RFB = load('rfb.js').default;
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "novnc-rfb.js"), b);
// then: node_modules/.bin/terser novnc-rfb.js -c -m --comments "/noVNC/" -o novnc-rfb.js (the shipped file is minified)
for (const f of ['LICENSE.txt', 'AUTHORS']) fs.copyFileSync(path.join(src, f), path.join(out, f));
fs.writeFileSync(path.join(out, 'README.md'), `noVNC ${version} (https://github.com/novnc/noVNC), MPL-2.0 (LICENSE.txt, AUTHORS). novnc-rfb.js is the npm package's lib/ (CommonJS) bundled by scripts/vendor/build-novnc.js; it defines window.RFB. Loaded on demand by the featureLoader feature rack_novnc (Rack Manager's virtual machine console).\n`);
console.log(`wrote ${path.join(out, 'novnc-rfb.js')} (${b.length} bytes, ${files.length} modules)`);
