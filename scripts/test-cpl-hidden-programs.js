const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.join(__dirname, '../public/scripts/comp/cplPages2.js');
const srcText = fs.readFileSync(srcPath, 'utf8');

// Regression check: verify that we replaced `.includes()` with a Set `.has()` in the hidden items filtering
assert.ok(!srcText.includes('!hidden.includes(p.launchId)'), 'regression: hidden.includes() still exists in programs()');
assert.ok(!srcText.includes('hidden.includes(p.launchId) ?'), 'regression: hidden.includes() still exists in openFeatures()');
assert.ok(srcText.includes('!hiddenSet.has(p.launchId)'), 'missing hiddenSet.has() in programs()');
assert.ok(srcText.includes('hiddenSet.has(p.launchId) ?'), 'missing hiddenSet.has() in openFeatures()');

const MOCK_ROOT = {
    collectStartMenuLaunchableDescriptors: () => [
        { launchId: 'app1', text: 'App 1', imageIcon: 'icon1' },
        { launchId: 'app2', text: 'App 2', imageIcon: 'icon2' },
        { launchId: 'app3', text: 'App 3', imageIcon: 'icon3' },
    ],
    resolveAppIconPath: (icon, size) => `${icon}-${size}.png`
};

const MOCK_REG = (key, val, def) => {
    if (key === 'HKLM\\Software\\Xyridian\\Melaton\\CurrentVersion\\Uninstall' && val === 'Hidden') {
        return ['app2', 'app99'];
    }
    return def;
};

const CP_MOCK = { registerPage: () => {}, pageArg: () => null, currentPage: () => null };
MOCK_ROOT.cplPages = {
    tasks: () => '',
    help: () => '',
    handlers: {},
    msg: () => '',
    esc: (s) => String(s),
    reg: MOCK_REG
};
MOCK_ROOT.melatonRegistry = { set: () => {} };
MOCK_ROOT.melatonControlPanel = CP_MOCK;

// Sandbox setup
const sandbox = {
    window: MOCK_ROOT, // The script uses window if defined
    globalThis: MOCK_ROOT,
    document: {
        addEventListener: () => {}
    },
    setTimeout: (cb, t) => cb(),
    console,
    Date: Date,
    callGlobal: () => Promise.resolve(['app1']),
};

// Also attach it to MOCK_ROOT
MOCK_ROOT.callGlobal = sandbox.callGlobal;

vm.createContext(sandbox);

// We run the script in the context. Since it uses an IIFE passing `window` or `globalThis`,
// it binds itself to `root`. It exposes `root.cplPages2.pages`.
const wrappedSrc = `
    function callGlobal(...args) { return root.callGlobal(...args); }
    ${srcText}
`;
vm.runInContext(wrappedSrc, sandbox);

// The script exposes `cplPages2.pages` which contains the page definitions.
// However, the `programs` function is private. We can access it indirectly by evaluating the view properties.

const pages = MOCK_ROOT.cplPages2.pages;
assert.ok(pages.programs);

// Mock `S` (root.cplSort) before calling `body()` which triggers `programs()` internally via `handlers.programs.sel` or similar.
// Wait, `programs()` is only called when we call the `body()` function for the programs page? No, `programs()` is called inside `pages.programs.body`.
// Actually, `pages.programs.body` renders the list of programs.

let renderCount = 0;
MOCK_ROOT.showConfirmationDialog = (...args) => {
    const [html] = args;
    // Verify openFeatures sets checkboxes correctly based on hiddenSet
    assert.ok(html.includes('value="app2"'), 'App2 is hidden, so checkbox is unchecked');
    assert.ok(html.includes('value="app1" checked'), 'App1 is not hidden, checkbox is checked');
    return Promise.resolve(['app1']); // mock then
};

const html = pages.programs.body();
// `programs()` will filter out 'app2' (since MOCK_REG returns 'app2', 'app99' for Hidden)
// so the body HTML should contain app1 and app3, but not app2.
assert.ok(html.includes('App 1'), 'App 1 should be rendered');
assert.ok(html.includes('App 3'), 'App 3 should be rendered');
assert.ok(!html.includes('App 2'), 'App 2 is hidden, should not be rendered');

// Test openFeatures
// We can invoke it by triggering the features handler
const cplPages = MOCK_ROOT.cplPages;
assert.ok(cplPages.handlers.programs.features, 'openFeatures handler exists');

cplPages.handlers.programs.features();

console.log('test-cpl-hidden-programs.js: ok');

// Behavior identity: Set.has matches Array.includes for normal arrays (SameValueZero),
// including string/number launchId mismatches. Non-arrays are treated as empty.
function wouldHide(hiddenRaw, launchId) {
    const hidden = Array.isArray(hiddenRaw) ? hiddenRaw : [];
    return new Set(hidden).has(launchId);
}
assert.strictEqual(wouldHide(['app2'], 'app2'), ['app2'].includes('app2'));
assert.strictEqual(wouldHide(['app2'], 'app1'), ['app2'].includes('app1'));
assert.strictEqual(wouldHide(['2'], 2), ['2'].includes(2));
assert.strictEqual(wouldHide([2], '2'), [2].includes('2'));
assert.strictEqual(wouldHide(null, 'app1'), false);
assert.strictEqual(wouldHide(undefined, 'app1'), false);
