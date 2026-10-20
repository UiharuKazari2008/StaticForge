'use strict';

// New-mail sound is keyed by inbox message ids, not unread-count deltas.
// A delete / mark / move / bulk action / pagination load that changes the
// count must not ding again for mail this session already saw.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dovecoteJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/dovecote.js'), 'utf8');
const { doveCollectFreshMailIds } = require('../public/scripts/comp/desktop-apps/dovecote.js')._test;

function has(snippet, label) {
    assert.ok(dovecoteJs.includes(snippet), label || snippet);
}

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

    // Delete-then-push: remaining unread ids were already notified this session.
    const session = new Set();
    doveCollectFreshMailIds(session, [{ id: 'keep' }, { id: 'gone' }, { id: 'also' }]);
    assert.deepStrictEqual(doveCollectFreshMailIds(session, [{ id: 'keep' }, { id: 'also' }]), []);
    assert.deepStrictEqual(doveCollectFreshMailIds(session, [{ id: 'inbound-new' }]), ['inbound-new']);

    // First snapshot in a session seeds the set. Announce is gated on size>0
    // so that seed never plays the sound.
    has("const announce = !!(options && options.announce) && doveNotifiedMailIds.size > 0;");
    has('if (announce && fresh.length) dovePlayNewMailAlert(fresh.length);');
    has('doveNoteMailIds(desktopDovecote.mail, { announce: false });');
    has('doveNoteMailIds((result && result.mail) || [], { announce: false });');
    has('doveNoteMailIds(Array.isArray(humanUnread) ? humanUnread : [], { announce: true });');
    has('Never plays the new-mail');
    assert.ok(!dovecoteJs.includes('const fresh = prev != null && unread > prev'), 'unread-count delta must not drive the sound');
    assert.ok(!dovecoteJs.includes('unread > prev'), 'tray badge must not ding on unread > prev');

    console.log('dovecote notify-id tests passed');
}

main();
