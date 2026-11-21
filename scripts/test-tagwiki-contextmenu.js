const assert = require('assert');

// mock window/document
// anything: every property and every call answers another anything (iterates empty, coerces to '' / 0)
function fakeEl() {
  const fn = function () {};
  return new Proxy(fn, {
    get: (t, k) => {
      if (k === 'then') return undefined;
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
      if (k === 'length') return 0;
      if (typeof k === 'symbol') return undefined;
      if (!(k in t) || k === 'name' || k === 'prototype') t[k] = fakeEl();
      return t[k];
    },
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => fakeEl(),
    construct: () => fakeEl()
  });
}
global.window = {};
// a tolerant document: the module's init grew (createElement, querySelectorAll, listeners on inner fields ...) since this
// test was written; anything it does not name answers empty, so the test still only guards the contextMenu ReferenceError
global.document = new Proxy({
  readyState: 'complete',
  getElementById: () => fakeEl(),
  createElement: () => fakeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  body: fakeEl(),
  documentElement: fakeEl()
}, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && k !== 'then' ? () => [] : undefined)) });
global.grimoireSyncAlchemyIdentity = () => {};
global.registerKeyboardListener = () => {};
global.attachModalListeners = () => {};

try {
  require('../public/scripts/comp/tagWikiSearchModal.js');
  console.log('PASS');
} catch (err) {
  if (err.name === 'ReferenceError' && err.message.includes('contextMenu')) {
    console.error('FAIL:', err.message);
    process.exit(1);
  }
  throw err;
}
