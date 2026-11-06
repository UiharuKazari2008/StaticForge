'use strict';

// A Studio print the agent started can fail (server error, or Studio refuses it before sending).
// The apply job then reads failed with the error, so await_generation_job stops waiting (#708).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const r = require('../modules/mcpReliability');

r.resetApplyGenerateJobs();
const job = r.rememberApplyGenerateJob({ bindKey: 'k', workspaceId: 'ws1' });
assert.strictEqual(job.status, 'running');
assert.strictEqual(r.failApplyGenerateFromWorkspace('other', 'nope'), null, 'another workspace is not touched');
const failed = r.failApplyGenerateFromWorkspace('ws1', 'Studio: Please enter a prompt', 'STUDIO_PRINT_REFUSED');
assert.strictEqual(failed.jobId, job.jobId);
assert.deepStrictEqual([job.status, job.code, job.error], ['failed', 'STUDIO_PRINT_REFUSED', 'Studio: Please enter a prompt']);
assert.strictEqual(r.failApplyGenerateJob(job.jobId, 'again'), null, 'a failed job stays as it failed');
assert.strictEqual(r.completeApplyGenerateFromWorkspace('ws1', ['1794000000000_x.png']), null, 'no running job left to complete');
const done = r.rememberApplyGenerateJob({ bindKey: 'k', workspaceId: 'ws1' });
r.completeApplyGenerateJob(done.jobId, 'a.png');
assert.strictEqual(r.failApplyGenerateJob(done.jobId, 'late error'), null, 'a saved print is never marked failed');

const facade = fs.readFileSync(path.join(__dirname, '../modules/mcpAgentFacade.js'), 'utf8');
assert.ok(facade.includes("if (ready.status === 'failed') {"), 'await_generation_job returns the failure');
const gen = fs.readFileSync(path.join(__dirname, '../modules/ws/handlers/generationImpl.js'), 'utf8');
assert.ok(gen.includes('failApplyGenerateFromWorkspace(message && message.workspace'), 'server generation errors fail the job');
const ws = fs.readFileSync(path.join(__dirname, '../modules/ws/handlers/168-agentClientHandler.js'), 'utf8');
assert.ok(ws.includes("reg('agent_print_failed'"), 'client refusals are reported');
const bridge = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/agentClientBridge.js'), 'utf8');
assert.ok(/armAgentPrintWatch\(filenameBefore\);\s*\n\s*if \(typeof clickManualGenerateForAgent/.test(bridge), 'the agent click arms the watch');
r.resetApplyGenerateJobs();
console.log('test-studio-print-failure: ok');
