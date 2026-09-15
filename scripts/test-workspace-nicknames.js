const assert = require('assert');
const {
    normalizeWorkspaceAlias,
    normalizeWorkspaceNicknames,
    resolveWorkspaceRef,
    nextDesktopGridPosition
} = require('../modules/workspace');

assert.strictEqual(normalizeWorkspaceAlias('The Lab'), 'lab');
assert.strictEqual(normalizeWorkspaceAlias('  the   dumpster '), 'dumpster');
assert.deepStrictEqual(
    normalizeWorkspaceNicknames(['lab', 'The Lab', 'dumpster', '', 'x'.repeat(50)]),
    ['lab', 'dumpster']
);
assert.deepStrictEqual(
    normalizeWorkspaceNicknames('pregnant, prego\nmaternity'),
    ['pregnant', 'prego', 'maternity']
);

const workspaces = {
    default: { name: 'Default', nicknames: [] },
    'lab-id': { name: 'Laboratory', nicknames: ['lab', 'the dumpster'] },
    'mat-id': { name: 'Maternity Ward', nicknames: ['pregnant', 'prego'] }
};

assert.strictEqual(resolveWorkspaceRef(workspaces, 'default'), 'default');
assert.strictEqual(resolveWorkspaceRef(workspaces, 'lab-id'), 'lab-id');
assert.strictEqual(resolveWorkspaceRef(workspaces, 'Laboratory'), 'lab-id');
assert.strictEqual(resolveWorkspaceRef(workspaces, 'the lab'), 'lab-id');
assert.strictEqual(resolveWorkspaceRef(workspaces, 'dumpster'), 'lab-id');
assert.strictEqual(resolveWorkspaceRef(workspaces, 'the dumpster'), 'lab-id');
assert.strictEqual(resolveWorkspaceRef(workspaces, 'prego'), 'mat-id');
assert.strictEqual(resolveWorkspaceRef(workspaces, 'pregnant'), 'mat-id');
assert.strictEqual(resolveWorkspaceRef(workspaces, 'unknown-id'), 'unknown-id');

assert.deepStrictEqual(nextDesktopGridPosition([]), { index: 0, pos: 0 });
assert.deepStrictEqual(nextDesktopGridPosition([
    { position: { index: 0, pos: 0 } },
    { position: { index: 0, pos: 1 } }
]), { index: 0, pos: 2 });
assert.deepStrictEqual(nextDesktopGridPosition([
    { position: { index: 0, pos: 0 } },
    { position: { index: 0, pos: 2 } }
]), { index: 0, pos: 1 });

console.log('test-workspace-nicknames: ok');
