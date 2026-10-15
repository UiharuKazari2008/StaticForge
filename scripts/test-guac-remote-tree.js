#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { flattenGuacTree, guacIdOk } = require('../modules/guacRemoteBridge');

const tree = {
    identifier: 'ROOT',
    name: 'ROOT',
    childConnections: [
        { identifier: '1', name: 'Root SSH', protocol: 'ssh', parentIdentifier: 'ROOT' }
    ],
    childConnectionGroups: [
        {
            identifier: '2',
            name: 'Core',
            childConnections: [
                { identifier: '3', name: 'Box', protocol: 'rdp', parentIdentifier: '2' }
            ],
            childConnectionGroups: [
                {
                    identifier: '4',
                    name: 'Nested',
                    childConnections: [
                        { identifier: '5', name: 'Inner', protocol: 'vnc', parentIdentifier: '4' }
                    ],
                    childConnectionGroups: []
                }
            ]
        }
    ]
};

const flat = flattenGuacTree(tree);
assert.strictEqual(flat.connections.length, 3);
assert.strictEqual(flat.groups[0].name, 'Connections');
assert.strictEqual(flat.groups[0].connections[0].id, '1');
assert.strictEqual(flat.groups[1].name, 'Core');
assert.strictEqual(flat.groups[1].connections[0].groupName, 'Core');
assert.strictEqual(flat.groups[2].name, 'Core / Nested');
assert.deepStrictEqual(flat.groupOptions.map((group) => group.id), ['2', '4']);
assert.strictEqual(guacIdOk('12'), true);
assert.strictEqual(guacIdOk('ROOT'), true);
assert.strictEqual(guacIdOk('../x'), false);
assert.strictEqual(guacIdOk(''), false);

const empty = flattenGuacTree({ identifier: 'ROOT', name: 'ROOT' });
assert.strictEqual(empty.connections.length, 0);
assert.strictEqual(empty.groups.length, 0);

console.log('guac tree ok');
