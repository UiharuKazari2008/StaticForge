'use strict';

const assert = require('assert');
const pairing = require('../modules/sessionWorkspacePairing');
const sw = require('../modules/sessionWorkspaceSwitch');

function testKeepSessionWorkspace() {
    const paired = { workspaceId: 'lab' };
    assert.strictEqual(pairing.keepSessionWorkspace(paired, 'desk'), 'lab');
    assert.strictEqual(paired.workspaceId, 'lab');

    const fresh = { workspaceId: '' };
    assert.strictEqual(pairing.keepSessionWorkspace(fresh, 'desk'), 'desk');
    assert.strictEqual(fresh.workspaceId, 'desk');

    const missing = {};
    assert.strictEqual(pairing.keepSessionWorkspace(missing, '  atelier  '), 'atelier');
    assert.strictEqual(missing.workspaceId, 'atelier');
}

function testWriteScoping() {
    assert.strictEqual(pairing.scopeWriteWorkspace('lab', 'desk'), 'lab');
    assert.strictEqual(pairing.scopeWriteWorkspace('lab', ''), 'lab');
    assert.strictEqual(pairing.scopeWriteWorkspace('', 'desk'), 'desk');
    assert.strictEqual(pairing.scopeWriteWorkspace('  ', 'notes'), 'notes');

    pairing.setWorkspaceLookupForTests(() => 'lab');
    assert.strictEqual(pairing.scopeWriteWorkspaceForTurn('desk'), 'lab');
    assert.strictEqual(pairing.scopeWriteWorkspaceForTurn(''), 'lab');
    pairing.setWorkspaceLookupForTests(() => '');
    assert.strictEqual(pairing.scopeWriteWorkspaceForTurn('desk'), 'desk');
    pairing.setWorkspaceLookupForTests(null);
}

function testInWorkspace() {
    const rows = pairing.annotateClients([
        { clientId: 'a', workspaceId: 'lab' },
        { clientId: 'b', workspaceId: 'desk' },
        { clientId: 'c', workspaceId: '' }
    ], 'lab');
    assert.strictEqual(rows[0].in_workspace, true);
    assert.strictEqual(rows[1].in_workspace, false);
    assert.strictEqual(rows[2].in_workspace, false);
    assert.strictEqual(rows[0].clientId, 'a');

    const open = pairing.annotateClients([{ clientId: 'a', workspaceId: 'desk' }], '');
    assert.strictEqual(open[0].in_workspace, true);

    assert.strictEqual(pairing.studioWriteAllowed('lab', 'lab'), true);
    assert.strictEqual(pairing.studioWriteAllowed('lab', 'desk'), false);
    assert.strictEqual(pairing.studioWriteAllowed('', 'desk'), true);
}

async function testSwitchTimeout() {
    sw.resetWorkspaceSwitchForTests();
    assert.strictEqual(sw.SWITCH_WAIT_MS, 90000);
    const started = sw.beginWorkspaceSwitch({ workspaceId: 'lab', workspaceName: 'Lab' }, 30);
    assert.ok(started.id);
    assert.ok(started.deadline > Date.now());
    const result = await sw.awaitWorkspaceSwitch(started.id);
    assert.strictEqual(result.status, 'timeout');
    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.declined, true);
    assert.strictEqual(result.accepted, false);
    assert.strictEqual(sw.submitWorkspaceSwitch({ id: started.id, status: 'accepted' }), false);
}

async function testSwitchAnswers() {
    sw.resetWorkspaceSwitchForTests();
    const accepted = sw.beginWorkspaceSwitch({ workspaceId: 'lab' }, 5000);
    assert.strictEqual(sw.submitWorkspaceSwitch({ switchId: accepted.id, status: 'accepted' }), true);
    const yes = await sw.awaitWorkspaceSwitch(accepted.id);
    assert.strictEqual(yes.status, 'accepted');
    assert.strictEqual(yes.accepted, true);
    assert.strictEqual(yes.declined, false);

    const declined = sw.beginWorkspaceSwitch({ workspaceId: 'lab' }, 5000);
    const pending = sw.awaitWorkspaceSwitch(declined.id);
    assert.strictEqual(sw.submitWorkspaceSwitch({ id: declined.id, status: 'declined' }), true);
    const no = await pending;
    assert.strictEqual(no.status, 'declined');
    assert.strictEqual(no.declined, true);
    assert.strictEqual(no.accepted, false);
    assert.strictEqual(no.timedOut, false);

    const timed = sw.beginWorkspaceSwitch({ workspaceId: 'lab' }, 5000);
    assert.strictEqual(sw.submitWorkspaceSwitch({ id: timed.id, status: 'timeout' }), true);
    const out = await sw.awaitWorkspaceSwitch(timed.id);
    assert.strictEqual(out.status, 'timeout');
    assert.strictEqual(out.declined, true);
    sw.resetWorkspaceSwitchForTests();
}

async function main() {
    testKeepSessionWorkspace();
    testWriteScoping();
    testInWorkspace();
    await testSwitchTimeout();
    await testSwitchAnswers();
    console.log('test-session-workspace-pairing: ok');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
