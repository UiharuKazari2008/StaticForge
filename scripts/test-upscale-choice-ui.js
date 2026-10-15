'use strict';

/**
 * Upscale chooser uses the standard picker menu, indicator dot, and inset panel.
 * Source check only. No browser, no Dreamscape restart.
 *
 * Run: node scripts/test-upscale-choice-ui.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const dialog = read('public/scripts/comp/creditCostDialog.js');
const html = read('public/app.html');
const enhance = read('public/scripts/comp/imageExpansion.js');
const docs = read('docs/g10-upscaler.md');
const server = read('services/g10-upscaler/server.js');

assert.ok(dialog.indexOf('function wireUpscaleChoiceMenus') !== -1);
assert.ok(dialog.indexOf('contextMenu.attachPickerMenu') !== -1);
assert.ok(dialog.indexOf('director-expandable-content') !== -1);
assert.ok(dialog.indexOf('indicator') !== -1);
assert.ok(dialog.indexOf("text: 'Instant'") !== -1);
assert.ok(dialog.indexOf("text: 'Fast'") !== -1);
assert.ok(dialog.indexOf("text: 'Slow'") !== -1);
assert.ok(dialog.indexOf('upscaleMethodDropdown') === -1, 'custom upscale dropdown must be gone');
assert.ok(dialog.indexOf('custom-dropdown-option') === -1);

assert.ok(html.indexOf('id="manualUpscaleScaleBtn"') !== -1);
assert.ok(html.indexOf('id="manualUpscaleSpeedBtn"') !== -1);
assert.ok(html.indexOf('manualUpscaleChoices') !== -1);
assert.ok(html.indexOf('director-expandable-content') !== -1);
assert.ok(html.indexOf('<select id="manualUpscaleModel"') === -1);
assert.ok(html.indexOf('<select id="manualUpscaleScale"') === -1);

assert.ok(enhance.indexOf('enhanceUpscaleScaleBtn') !== -1);
assert.ok(enhance.indexOf('enhanceUpscaleSpeedBtn') !== -1);
assert.ok(enhance.indexOf('wireEnhanceUpscaleChoices') !== -1);
assert.ok(enhance.indexOf('<select id="enhanceUpscaleModel"') === -1);

assert.ok(docs.indexOf('localWorkers') !== -1);
assert.ok(docs.indexOf('[Service]') !== -1);
assert.ok(docs.indexOf('watch: false') !== -1);
assert.ok(!/max_memory_restart\s*:/.test(docs));
assert.ok(!/cron_restart\s*:/.test(docs));
assert.ok(docs.indexOf('vkQueueSubmit failed') !== -1);
assert.ok(server.indexOf("server.listen(port, '127.0.0.1'") !== -1);
assert.ok(server.indexOf('SequenziaCore') === -1);
assert.ok(read('modules/localUpscaleWorker.js').indexOf('SequenziaCore') === -1);

console.log('test-upscale-choice-ui: ok');
