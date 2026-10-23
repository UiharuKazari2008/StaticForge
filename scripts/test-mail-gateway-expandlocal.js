const assert = require('assert');
const { expandLocal, expandRecipients } = require('../modules/mailGatewayAddresses');

function runTests() {
    console.log("Running expandLocal tests...");

    // Test 1: Diamond pattern is not a loop and dedupes correctly
    const mappingDiamond = {
        mailboxes: { 'target': 'owner1' },
        lists: {
            'toplist': ['midlist1', 'midlist2'],
            'midlist1': ['target'],
            'midlist2': ['target']
        },
        aliases: {}
    };

    const resDiamond = expandLocal('toplist', mappingDiamond);
    assert.deepStrictEqual(resDiamond, ['owner1'], "Diamond pattern should return owner once");

    // Test 2: Real cycle throws ALIAS_LOOP
    const mappingCycle = {
        mailboxes: {},
        lists: {
            'list1': ['list2'],
            'list2': ['list3'],
            'list3': ['list1']
        },
        aliases: {}
    };

    let threwCycle = false;
    try {
        expandLocal('list1', mappingCycle);
    } catch (err) {
        if (err.code === 'ALIAS_LOOP') {
            threwCycle = true;
        }
    }
    assert.strictEqual(threwCycle, true, "Real cycle must throw ALIAS_LOOP");

    // Test 3: Bare owner rule works at depth > 1 and returns [] at depth 1
    const mappingBareOwner = {
        mailboxes: { 'mailbox1': 'owner1' },
        lists: {
            'list1': ['owner1', 'unknown']
        },
        aliases: {}
    };

    const resTop = expandLocal('owner1', mappingBareOwner);
    assert.deepStrictEqual(resTop, [], "Bare owner at top level should return []");

    const resDepth = expandLocal('list1', mappingBareOwner);
    assert.deepStrictEqual(resDepth, ['owner1'], "Bare owner at depth > 1 should return [key]");

    // Test 4: Large list with duplicates keeps first-seen order and dedupes efficiently
    const mappingLarge = {
        mailboxes: {
            'm1': 'owner1',
            'm2': 'owner2',
            'm3': 'owner3'
        },
        lists: {
            'large': []
        }
    };

    // Add 10,000 members alternating between m1, m2, m3
    for (let i = 0; i < 10000; i++) {
        mappingLarge.lists.large.push(i % 3 === 0 ? 'm1' : (i % 3 === 1 ? 'm2' : 'm3'));
    }

    const start = Date.now();
    const resLarge = expandLocal('large', mappingLarge);
    const end = Date.now();
    assert.deepStrictEqual(resLarge, ['owner1', 'owner2', 'owner3'], "Large list should dedupe and keep order");
    console.log(`Large list (10k items) test took ${end - start}ms`);

    console.log("All tests passed!");
}

runTests();
