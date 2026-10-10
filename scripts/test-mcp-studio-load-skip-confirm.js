'use strict';
// MCP/WS loads into Studio skip the replace-current confirmation; user loads keep it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const mm = fs.readFileSync(path.join(root, 'public/scripts/comp/manualModalManager.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'public/scripts/comp/agentClientBridge.js'), 'utf8');
const scj = fs.readFileSync(path.join(root, 'public/scripts/comp/studioChangeJson.js'), 'utf8');

// Run the real gate logic from openManualModalWithContent.
const m = mm.match(/const skipLoadConfirm = [^\n]+\n\s*if \(([^\n]+)\) \{\n\s*if \(!\(await checkManualModalBeforeLoad\(event\)\)\)/);
assert.ok(m, 'skipConfirm gate present before checkManualModalBeforeLoad');
const gate = (content) => vm.runInNewContext(`(() => { ${m[0].split('\n')[0].trim()} return (${m[1]}); })()`,
    { content, hasContentToLoad: true, window: { isDesktop: true }, isRunning: true });
assert.strictEqual(gate({ type: 'image', image: {} }), true, 'user load still asks');
assert.strictEqual(gate({ type: 'image', image: {}, skipConfirm: true, source: 'mcp' }), false, 'MCP load skips');
assert.strictEqual(gate({ type: 'image', skipConfirm: 'yes' }), true, 'only literal true skips');

const fn = bridge.slice(bridge.indexOf('async function openImageFromCommand('), bridge.indexOf('function readDynamicPhysicsConfig('));
assert.ok(/skipConfirm: true/.test(fn), 'open_image (open_in_studio) passes skipConfirm');
// apply_studio / apply_preset_to_studio only open Studio when closed, so no confirm can trigger there.
const ens = scj.slice(scj.indexOf('async function ensureStudioOpenForChange('), scj.indexOf('function ensureStudioCharacterCount('));
assert.ok(/classList\.contains\('hidden'\)\) return;/.test(ens), 'silent apply never reloads an open Studio');
console.log('test-mcp-studio-load-skip-confirm: ok');
