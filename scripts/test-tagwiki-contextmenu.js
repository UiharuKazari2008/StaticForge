const assert = require('assert');

// mock window/document
global.window = {};
global.document = {
  readyState: 'complete',
  getElementById: () => ({
    querySelector: () => ({}),
    addEventListener: () => {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    style: {},
    dataset: {}
  }),
  addEventListener: () => {},
  body: {
    classList: { contains: () => false }
  }
};
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
