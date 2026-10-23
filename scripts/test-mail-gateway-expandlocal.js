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

    // Test 2b: alias-only cycle and a mixed list -> alias -> list cycle also throw ALIAS_LOOP
    const throwsLoop = (key, mapping) => assert.throws(() => expandLocal(key, mapping), (err) => err.code === 'ALIAS_LOOP');
    throwsLoop('a1', { mailboxes: {}, lists: {}, aliases: { a1: 'a2', a2: 'a1' } });
    throwsLoop('l1', { mailboxes: { mb: 'owner1' }, lists: { l1: ['mb', 'al'], l2: ['l1'] }, aliases: { al: 'l2' } });
    // ...while an alias that reaches the same mailbox twice through a list is not a loop
    assert.deepStrictEqual(
        expandLocal('l1', { mailboxes: { mb: 'owner1' }, lists: { l1: ['mb', 'al', 'mb'] }, aliases: { al: 'mb' } }),
        ['owner1']
    );

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

    // Test 4: 5,000 distinct mailboxes listed forwards then in reverse.
    // Dedupe must keep exact first-seen owner order (this is the path the Set fix speeds up).
    const mappingLarge = { mailboxes: {}, lists: { large: [] }, aliases: {} };
    const expected = [];
    for (let i = 0; i < 5000; i++) {
        mappingLarge.mailboxes['m' + i] = 'owner' + i;
        expected.push('owner' + i);
    }
    for (let i = 0; i < 5000; i++) mappingLarge.lists.large.push('m' + i);
    for (let i = 4999; i >= 0; i--) mappingLarge.lists.large.push('m' + i); // duplicates in reverse: first-seen order must win
    const resLarge = expandLocal('large', mappingLarge);
    assert.deepStrictEqual(resLarge, expected, "Large list should dedupe and keep first-seen order");

    // Test 5: expandRecipients goes through the same expansion for the public domain only
    assert.deepStrictEqual(expandRecipients('toplist@dream.737.jp.net', mappingDiamond), ['owner1']);
    assert.deepStrictEqual(expandRecipients('TopList@Dream.737.jp.net', mappingDiamond), ['owner1']);
    assert.deepStrictEqual(expandRecipients('toplist@example.com', mappingDiamond), []);

    console.log("All tests passed!");
}

runTests();
