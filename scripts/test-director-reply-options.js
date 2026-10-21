'use strict';

// Closing paragraph of a Director reply: "A, B, or C" becomes the next-reply buttons
// (public/scripts/comp/director.js directorReplyOptions / paintReplyChoices).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.join(__dirname, '../public/scripts/comp/director.js');
const src = fs.readFileSync(srcPath, 'utf8');
const start = src.indexOf('function directorMaskParens');
const end = src.indexOf('const DIRECTOR_QUICK_STARTS');
assert.ok(start > 0 && end > start, 'reply-option helpers are in director.js');
const sandbox = {};
vm.runInNewContext(src.slice(start, end), sandbox);
const directorReplyOptions = sandbox.directorReplyOptions;
const directorLastOfferText = sandbox.directorLastOfferText;

function same(text, expected) {
    // The helpers run in a vm, so copy the list into this realm before comparing.
    assert.deepStrictEqual([...directorReplyOptions(text)], expected, text);
}

same(
    'Notes about the print.\n\nThe follow-up writes itself \u2014 she answers, or she keeps eating. Or the seam picks this exact moment.',
    ['She answers', 'She keeps eating', 'The seam picks this exact moment']
);
same(
    'If you want the old sharpness back, I would push the weight \u2014 want me to run that, or is this softer read the direction?',
    ['Run that', 'Is this softer read the direction']
);
same(
    'Want the tail trailing straight back and the front legs lengthened to match, or leave the curl?',
    ['The tail trailing straight back and the front legs lengthened to match', 'Leave the curl']
);
same(
    'Want the next beat to be a contraction folding one of them over, or do you want to take the size further still?',
    ['The next beat to be a contraction folding one of them over', 'Take the size further still']
);
same(
    'Seed is locked, so a re-roll keeps this arrangement. Want it unlocked for fresh takes, or should I leave it pinned?',
    ['Unlocked for fresh takes', 'Leave it pinned']
);
same(
    'Want me to push it further \u2014 chest-up portrait so it is mostly face, pull back just enough to give the clock a strip of sky, or darken the hair a notch?',
    [
        'Chest-up portrait so it is mostly face',
        'Pull back just enough to give the clock a strip of sky',
        'Darken the hair a notch'
    ]
);
same(
    'Say the word and I will do any of these: pull the armor back over her hips, reframe wider to get the throne back, or finally chase the red-streak hair.',
    [
        'Pull the armor back over her hips',
        'Reframe wider to get the throne back',
        'Finally chase the red-streak hair'
    ]
);
same(
    'Want me to fire the outfit-lock run on the sailor frame (4 seeds, one job), or the tail clause first as a quick single print?',
    ['Fire the outfit-lock run on the sailor frame (4 seeds, one job)', 'The tail clause first as a quick single print']
);
same(
    'Say which and I will shoot it, or tell me to fix the walk and I will re-cut the camera.',
    ['Say which and I will shoot it', 'Tell me to fix the walk and I will re-cut the camera']
);
same(
    'I can keep the seed and push on either of those. Or I can roll new seeds if you would like a different pose or room around her.',
    [
        'Keep the seed and push on either of those',
        'Roll new seeds if you would like a different pose or room around her'
    ]
);
same(
    'Next could be me talking you into it: you take the first bite with a bucket in each arm. Or skip ahead to halfway through bucket two.',
    ['You take the first bite with a bucket in each arm', 'Skip ahead to halfway through bucket two']
);
same(
    'Next, if you want it: the suit finally loses, or she takes the tray away.',
    ['The suit finally loses', 'She takes the tray away']
);
same(
    'Next frame ought to settle it: her in the finished piece, either swimming in it because they overcorrected, or wearing it properly for the first time. Which?',
    ['Swimming in it because they overcorrected', 'Wearing it properly for the first time']
);
same(
    'Studio is synced. Natural next beat: the debrief while she introduces them, or the medic rushing in. Where to?',
    ['The debrief while she introduces them', 'The medic rushing in']
);
same(
    'Want the tail trailing straight back and the legs lengthened, or leave the curl?',
    ['The tail trailing straight back and the legs lengthened', 'Leave the curl']
);

assert.deepStrictEqual([...directorReplyOptions('One note for next time: the tab dropped, so the last prints came off the server.')], []);
assert.deepStrictEqual([...directorReplyOptions('Want me to take a swing at the spur next? I would change the wording and re-run it.')], []);
assert.deepStrictEqual([...directorReplyOptions('The version I would keep is this one over the suit pass.')], []);
assert.deepStrictEqual([...directorReplyOptions('')], []);

const messages = [
    { role: 'user', content: 'go' },
    { role: 'assistant', trace: [{ type: 'assistant', text: 'Earlier, or not this one.' }] },
    { role: 'user', content: 'again' },
    { role: 'event', message_type: 'chat-image' },
    { role: 'assistant', trace: [
        { type: 'thinking', text: 'hmm' },
        { type: 'assistant', text: 'Done.\n\nWant the wide shot, or the close-up?' }
    ] }
];
assert.strictEqual(directorLastOfferText(messages), 'Done.\n\nWant the wide shot, or the close-up?');
assert.deepStrictEqual([...directorReplyOptions(directorLastOfferText(messages))], ['The wide shot', 'The close-up']);
messages.push({ role: 'user', content: 'the wide shot' });
assert.strictEqual(directorLastOfferText(messages), '');

assert.ok(src.includes('this.paintReplyChoices(messages);'), 'settled messages paint the reply buttons');
assert.ok(src.includes('data-reply-choices'), 'reply buttons use the message actions row');
assert.ok(src.includes('this.sendMessage(label);'), 'a choice sends as the next message');

console.log('director reply options ok');
