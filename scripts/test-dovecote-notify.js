'use strict';

// New-mail sound is keyed by inbox message ids, not unread-count deltas.
// A delete / mark / move / bulk action / pagination load that changes the
// count must not ding again for mail this session already saw.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dovecoteJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/dovecote.js'), 'utf8');
const { doveCollectFreshMailIds } = require('../public/scripts/comp/desktop-apps/dovecote.js')._test;

function main() {
    const seen = new Set();
    assert.deepStrictEqual(doveCollectFreshMailIds(seen, [{ id: 'a' }, { id: 'b' }]), ['a', 'b']);
    assert.deepStrictEqual(Array.from(seen), ['a', 'b']);
    // A later refresh of the same inbox (delete, mark, bulk) adds nothing new.
    assert.deepStrictEqual(doveCollectFreshMailIds(seen, [{ id: 'b' }, { id: 'a' }]), []);
    // Pagination brings older rows — they are recorded, but the caller uses announce:false.
    assert.deepStrictEqual(doveCollectFreshMailIds(seen, [{ id: 'old-1' }]), ['old-1']);
    // A genuinely new inbound id is the only fresh hit.
    assert.deepStrictEqual(doveCollectFreshMailIds(seen, [{ id: 'a' }, { id: 'new-9' }]), ['new-9']);
    assert.deepStrictEqual(doveCollectFreshMailIds(seen, null), []);
    assert.deepStrictEqual(doveCollectFreshMailIds(seen, [{ id: '' }, {}]), []);

    assert.match(dovecoteJs, /const doveNotifiedMailIds = new Set\(\)/);
    assert.match(dovecoteJs, /const doveCollectFreshMailIds = function/);
    assert.match(dovecoteJs, /const doveNoteMailIds = function/);
    assert.match(dovecoteJs, /const dovePlayNewMailAlert = function/);
    assert.match(dovecoteJs, /announce && doveNotifiedMailIds\.size > 0/);
    assert.match(dovecoteJs, /if \(announce && fresh\.length\) dovePlayNewMailAlert/);
    assert.match(dovecoteJs, /doveNoteMailIds\(desktopDovecote\.mail, \{ announce: false \}\)/);
    assert.match(dovecoteJs, /doveNoteMailIds\(\(result && result\.mail\) \|\| \[\], \{ announce: false \}\)/);
    assert.match(dovecoteJs, /doveNoteMailIds\(Array\.isArray\(humanUnread\) \? humanUnread : \[\], \{ announce: true \}\)/);
    assert.match(dovecoteJs, /Never plays the new-mail\s+sound/);
    assert.doesNotMatch(dovecoteJs, /const fresh = prev != null && unread > prev/);
    assert.doesNotMatch(dovecoteJs, /if \(reveal && \(!doveHasAnnouncedMail \|\| \(prev != null && unread > prev\)\)\)/);

    console.log('dovecote notify-id tests passed');
}

main();
