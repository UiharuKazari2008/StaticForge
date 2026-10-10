'use strict';
// Explicit effort (UI, change JSON, MCP) must beat a loaded v5_medium model; Studio menu disables locked rows.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { explicitEffortModelKey, resolveMediumLock } = require('../modules/v5MediumLock');

assert.strictEqual(explicitEffortModelKey('v5_medium', 'high'), 'v5');
assert.strictEqual(explicitEffortModelKey('v5_medium_inp', 'high'), 'v5_inp');
assert.strictEqual(explicitEffortModelKey('v5_medium', 'medium'), 'v5');
assert.strictEqual(explicitEffortModelKey('v5_medium', undefined), 'v5_medium');
assert.strictEqual(explicitEffortModelKey('v5', 'high'), 'v5');
assert.strictEqual(resolveMediumLock(explicitEffortModelKey('v5_medium', 'high'), 'high'), null, 'high must not lock');
assert.ok(resolveMediumLock(explicitEffortModelKey('v5_medium', 'medium'), 'medium'), 'medium still locks');
assert.ok(resolveMediumLock('v5_medium', undefined), 'loaded v5_medium without explicit effort keeps its lock');

const root = path.join(__dirname, '..');
const gen = fs.readFileSync(path.join(root, 'modules/imageGeneration.js'), 'utf8');
assert.ok(gen.includes('explicitEffortModelKey(forgeModelKey, body.effort)'), 'server remaps before lock');
const mm = fs.readFileSync(path.join(root, 'public/scripts/comp/manualModalManager.js'), 'utf8');
const set = mm.slice(mm.indexOf('function setManualEffort('), mm.indexOf('function syncManualEffortChrome('));
assert.ok(/fixedSettings[\s\S]*selectManualModel\('v5'/.test(set), 'setManualEffort maps v5_medium to V5 Full');
const ui = fs.readFileSync(path.join(root, 'public/scripts/comp/imageGenerationSettings.js'), 'utf8');
assert.ok(/text: 'Effort',[\s\S]{0,400}disabled: studioEffortMenuDisabled/.test(ui), 'Effort menu item, disabled off V5 Full');
assert.ok(ui.includes("action === 'studio-select-effort'") && /studio-select-effort'[\s\S]{0,120}setManualEffort\(row\.value\)/.test(ui), 'effort action wired');
assert.ok(/getStudioSamplerMenuItems,[\s\S]{0,120}studioMediumLocked\('sampler'\)/.test(ui), 'sampler disabled in Medium');
assert.ok(/getStudioUcPresetMenuItems,[\s\S]{0,80}studioMediumLocked\('uc'\)/.test(ui), 'UC disabled in Medium');
assert.ok(/disabled: locked,/.test(ui), 'steps/rescale rows disabled in Medium');
console.log('test-effort-explicit-wins: ok');
