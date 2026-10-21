#!/usr/bin/env node
// Control Panel's System page (Yukimi 2026-10-21): Vista's Control Panel > System with real facts:
// the server host from get_system_info (host.*), this client from navigator, the session's
// Experience Index (experienceIndex.js), activation and the Product ID from the NovelAI account,
// and Remote Access Properties (remoteAccessProperties.js). Run: node scripts/test-cpl-system.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

global.window = global;
const sys = require('../public/scripts/comp/cplSystem.js');
const t = sys._test;

// Vista's StrFormatByteSize: three digits, truncated
assert.strictEqual(t.formatMemory(4 * 1024 ** 3), '4.00 GB');
assert.strictEqual(t.formatMemory(14591455232), '13.5 GB', '13.59 GiB truncates, it does not round');
assert.strictEqual(t.formatMemory(128 * 1024 ** 3), '128 GB');
assert.strictEqual(t.formatMemory(512 * 1024 ** 2), '512 MB');
assert.strictEqual(t.formatMemory(0), '');
assert.strictEqual(t.formatClock(2100), '2.10 GHz');
assert.strictEqual(t.formatClock(null), '');
assert.strictEqual(t.systemType('x64'), '64-bit Operating System');
assert.strictEqual(t.systemType('arm64'), '64-bit Operating System (ARM64)', 'the server architecture, ARM named');
assert.strictEqual(t.systemType('arm'), '32-bit Operating System (ARM)');
assert.strictEqual(t.systemType('ppc64'), '64-bit Operating System (ppc64)');
assert.strictEqual(t.systemType('ia32'), '32-bit Operating System');
assert.strictEqual(t.systemType(''), '');

// host.* from a restarted server; cpu / ram strings from an older one
const host = t.hostFacts({
    cpu: 'AMD Ryzen 5 3500U with Radeon Vega Mobile Gfx (8 cores)',
    ram: '13.59 GB',
    host: { hostname: 'dreamscape', arch: 'x64', cpuModel: 'AMD Ryzen 5 3500U with Radeon Vega Mobile Gfx', cpuMHz: 2100, totalMemBytes: 14591455232 }
});
assert.deepStrictEqual(host, {
    processor: 'AMD Ryzen 5 3500U with Radeon Vega Mobile Gfx',
    clock: '2.10 GHz',
    memory: '13.5 GB',
    type: '64-bit Operating System',
    hostname: 'dreamscape'
});
const old = t.hostFacts({ cpu: 'AMD Ryzen 5 3500U with Radeon Vega Mobile Gfx (8 cores)', ram: '13.59 GB' });
assert.strictEqual(old.processor, 'AMD Ryzen 5 3500U with Radeon Vega Mobile Gfx', 'the core count leaves the model');
assert.strictEqual(old.memory, '13.59 GB');
assert.strictEqual(old.type, '');
assert.strictEqual(t.hostFacts(null).processor, '');

// the client from navigator
assert.strictEqual(t.browserText({
    userAgentData: { brands: [{ brand: 'Not)A;Brand', version: '8' }, { brand: 'Chromium', version: '155' }, { brand: 'Google Chrome', version: '155' }], platform: 'Windows' },
    userAgent: ''
}), 'Google Chrome 155 on Windows');
assert.strictEqual(t.browserText({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0' }), 'Firefox 140 on Windows');
assert.strictEqual(t.deviceText({ hardwareConcurrency: 8, deviceMemory: 8 }), '8 logical processors, 8 GB of memory or more');
assert.strictEqual(t.deviceText({ hardwareConcurrency: 1, deviceMemory: 2 }), '1 logical processor, 2 GB of memory');

// the edition from the shared version source (About Windows), the build when there is no service pack
assert.deepStrictEqual(t.edition({ fullName: 'MeletonFX Desktop', edition: '2026 R7', copyright: 'Copyright © 2026 Academy City Research P.S.R.  All rights reserved.', servicePack: '', build: '7bbd242' }), {
    name: 'MeletonFX Desktop 2026 R7',
    copyright: 'Copyright © 2026 Academy City Research P.S.R.  All rights reserved.',
    servicePack: 'Build 7bbd242'
});
assert.strictEqual(t.edition({ servicePack: 'Service Pack 26Q4 abcd1234' }, null).servicePack, 'Service Pack 26Q4 abcd1234');
assert.strictEqual(t.edition(null, { gitHash: 'abc1234' }).servicePack, 'Build abc1234', 'falls back to the server build');

// activation: the NovelAI account (optionsData.user is NovelAI's /user/data)
const account = (created, tier = 3, extra = {}) => ({
    user: { ok: true, subscription: { tier, accountType: 0, active: true }, information: { accountCreatedAt: created } },
    userDataValid: true,
    ...extra
});
assert.deepStrictEqual(t.novelAiAccount(undefined), { state: 'checking' });
assert.deepStrictEqual(t.novelAiAccount({ accountDataDeferred: true, user: {} }), { state: 'checking' }, 'deferred account data is not "no account"');
assert.deepStrictEqual(t.novelAiAccount({ user: { ok: false, reason: 'missing_api_key' } }), { state: 'none' }, 'no NovelAI key: not activated');
assert.deepStrictEqual(t.novelAiAccount({ user: null }), { state: 'none' });
assert.strictEqual(t.novelAiAccount(account(1700000000)).state, 'activated');
const pid = t.productId(t.novelAiAccount(account(1700000000)));
assert.ok(/^\d{5}-OPS-\d{7}-\d{5}$/.test(pid), `Vista's Product ID shape, the tier as channel: ${pid}`);
assert.strictEqual(t.productId(t.novelAiAccount(account(1700000000))), pid, 'the same account, the same Product ID');
assert.notStrictEqual(t.productId(t.novelAiAccount(account(1700000001))), pid, 'another account, another Product ID');
assert.ok(/-TBL-/.test(t.productId(t.novelAiAccount(account(1700000000, 1)))), 'Tablet');
assert.ok(!pid.includes('1700000000'), 'the Product ID does not spell out the account');
assert.strictEqual(t.productId({ state: 'none' }), '');

// the page: Vista's sections in order, real values in, markup escaped
global.optionsData = account(1700000000);
const rated = { base: 4.8, scores: { processor: 5.4, memory: 5.9, graphics: 4.8, gaming: 5, disk: null } };
const html = t.render({ fullName: 'MeletonFX Desktop', edition: '2026 R7', copyright: 'Copyright', build: 'abc1234' }, {
    host: { hostname: 'dream<scape', arch: 'x64', cpuModel: 'Test CPU', cpuMHz: 3000, totalMemBytes: 8 * 1024 ** 3 }
}, rated);
const order = ['View basic information about your computer', 'Windows edition', 'System', 'Computer name, domain, and workgroup settings', 'Session', 'Windows activation'];
let at = -1;
order.forEach((text) => {
    const i = html.indexOf(text, at + 1);
    assert.ok(i > at, `${text} in order`);
    at = i;
});
['Rating:', 'Processor:', 'Memory (RAM):', 'System type:', 'Computer name:', 'Full computer name:', 'Computer description:', 'Domain:',
    'Signed in as:', 'Browser:', 'Device:', 'Client version:', 'Product ID:', 'Change settings', 'Change product key'].forEach((label) => {
    assert.ok(html.includes(label), label);
});
assert.ok(html.includes('Test CPU<span class="cpl-sys-clock">3.00 GHz</span>'));
assert.ok(html.includes('8.00 GB') && html.includes('64-bit Operating System') && html.includes('Build abc1234'));
assert.ok(html.includes('dream&lt;scape') && !html.includes('dream<scape'), 'host names are escaped');
assert.ok(html.includes('system-logo.png') && html.includes('wei-rated.png'));
assert.ok(html.includes('<span class="cpl-sys-wei-num">4.8</span>') && html.includes('MeletonFX Experience Index</span>'), 'the base score on the badge');
assert.ok(html.includes('Primary hard disk: Not rated') && html.includes('Gaming graphics: 5.0'), 'the subscores in the tooltip');
assert.ok(html.includes('data-cpl-action="customize"'), 'Change settings is Customize network');
assert.ok(html.includes('MeletonFX is activated') && html.includes(pid), 'an account: activated, its Product ID');
global.optionsData = { user: { ok: false, reason: 'missing_api_key' } };
const none = t.render(null, null, null);
assert.ok(none.includes('MeletonFX is not activated') && none.includes('Activate MeletonFX now'), 'no account: not activated');
assert.ok(/Product ID:<\/span><span class="cpl-sys-pid-value"><span class="cpl-sys-na">Not available/.test(none), 'no account, no Product ID');
assert.ok(none.includes('Assessing this session...') && !none.includes('cpl-sys-wei-num'), 'no badge while the session is assessed');
delete global.optionsData;
const unknown = t.render(null, null, { base: null, scores: {} });
assert.ok(unknown.includes('MeletonFX is not connected to the domain controller'), 'account unknown and no session: say why');
assert.ok(unknown.includes('System rating is not available'), "nothing measurable: Vista's wording");

// wiring: the feature bundle, the Classic View item, the server's host facts and the docs
const loader = read('public/scripts/comp/featureLoader.js');
assert.ok(/'scripts\/comp\/melatonControlPanel\.js',\s*'scripts\/comp\/experienceIndex\.js',\s*'scripts\/comp\/cplSystem\.js',\s*'scripts\/comp\/remoteAccessProperties\.js'/.test(loader), 'the System page and Remote Access Properties load with the Control Panel');
assert.ok(loader.includes("'css/cpl-system.css'") && loader.includes("'css/remote-access-properties.css'") && loader.includes("'css/taskbar-properties.css'"));
const cplJs = read('public/scripts/comp/melatonControlPanel.js');
assert.ok(/id: 'system',[\s\S]{0,400}pages\.system \? navigate\('system'\)/.test(cplJs), 'the System item opens the page');
assert.ok(/id: 'remote-access',[\s\S]{0,400}root\.remoteAccessProperties\.open\(\)/.test(cplJs), 'the Remote Access item opens Remote Access Properties');
assert.ok(read('public/scripts/comp/cplSystem.js').includes("shieldLink('Remote settings', 'item', 'remote-access')"), "System's Remote settings opens it too");
assert.ok(/async function openRemoteAccessSettingsModal\(\) \{[\s\S]{0,300}window\.remoteAccessProperties\.open\(\)/.test(read('public/scripts/comp/modalUtils.js')), 'and every openRemoteAccessSettingsModal caller');
const gr = read('modules/globalResources.js');
assert.ok(gr.includes('host: hostInfo') && /hostname: os\.hostname\(\)/.test(gr) && /arch: os\.arch\(\)/.test(gr), 'get_system_info carries host.*');
const docs = read('docs/client-api/ws/infrastructure.md');
assert.ok(docs.includes('`host.cpuModel`') && docs.includes('`host.totalMemBytes`'), 'the response is documented');

// the Experience Index: Vista's 1.0 - 5.9 scale, truncated; the base score is the lowest subscore
const ei = require('../public/scripts/comp/experienceIndex.js')._test;
assert.strictEqual(ei.score(4.86), 4.8, 'truncated like Vista');
assert.strictEqual(ei.score(9), 5.9);
assert.strictEqual(ei.score(0.2), 1);
assert.strictEqual(ei.score(NaN), null);
assert.strictEqual(ei.processorScore({ hardwareConcurrency: 1 }, 10 ** 7).score, 2.9, 'one core holds the processor back');
assert.strictEqual(ei.processorScore({ hardwareConcurrency: 8 }, 600000).score, 5.9);
assert.ok(ei.processorScore({ hardwareConcurrency: 8 }, 60000).score < 4, 'a slow main thread rates low');
assert.strictEqual(ei.memoryScore({ deviceMemory: 8 }).score, 5.9);
assert.strictEqual(ei.memoryScore({}).score, null, 'no deviceMemory (Firefox, Safari): not rated');
assert.strictEqual(ei.graphicsScore({ webgl: 0 }, { backdropFilter: true }).score, 1);
assert.strictEqual(ei.graphicsScore({ webgl: 2, software: true, maxTexture: 8192 }, { backdropFilter: true, webgpu: true }).score, 2, 'SwiftShader is software');
assert.strictEqual(ei.graphicsScore({ webgl: 2, maxTexture: 16384 }, { backdropFilter: true, webgpu: true }).score, 5.9);
assert.strictEqual(ei.graphicsScore({ webgl: 2, maxTexture: 16384 }, { backdropFilter: false }).score, 2.9, 'no frosted glass, no Aero');
const frames = (ms, n = 60) => Array.from({ length: n }, () => ms);
assert.strictEqual(ei.gamingScore(frames(1000 / 60), { webgl: 2, score: 5.9 }).score, 5, '60 fps');
assert.strictEqual(ei.gamingScore(frames(1000 / 120), { webgl: 2, score: 5.9 }).score, 5.9, '120 fps');
assert.strictEqual(ei.gamingScore(frames(1000 / 30), { webgl: 2, score: 5.9 }).score, 3, '30 fps');
assert.strictEqual(ei.gamingScore(frames(1000 / 60), { webgl: 2, softwareRenderer: true, score: 2 }).score, 2, 'software frames are capped');
assert.strictEqual(ei.gamingScore(null).score, null, 'a hidden tab has no frames');
const janky = frames(1000 / 60, 50).concat(frames(50, 10));
assert.ok(ei.gamingScore(janky, { webgl: 2, score: 5.9 }).score < 5, 'long frames cost');
const combined = ei.combine({ processor: { score: 5.4 }, memory: { score: null }, graphics: { score: 4.1 }, gaming: { score: 5 }, disk: { score: 5.9 } });
assert.strictEqual(combined.base, 4.1, 'the base score is the lowest rated subscore');
assert.strictEqual(ei.combine({ processor: { score: null } }).base, null);

console.log('cpl system tests passed');
