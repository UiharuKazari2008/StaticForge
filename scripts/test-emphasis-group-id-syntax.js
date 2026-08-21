#!/usr/bin/env node
/**
 * Smoke tests for modules/emphasisGroupIdSyntax.js (invisible + legacy colon forms).
 * Run: node scripts/test-emphasis-group-id-syntax.js
 */
'use strict';

const m = require('../modules/emphasisGroupIdSyntax.js');

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        console.error('FAIL:', msg);
        failed++;
    } else {
        console.log('ok:', msg);
    }
}

// --- Invisible happy path + fieldHint alias ---
{
    const g3 = m.buildManagedEmphasisGroupText(3, 'red dress');
    const g7 = m.buildManagedEmphasisGroupText(7, 'blue eyes');
    assert(!g3.includes(':'), 'builder emits no colons');
    assert(m.hasManagedEmphasisGroupIds(g3), 'hasManaged on invisible');
    const prompt = `hello ${g3} world ${g7}`;
    const blocks = m.listManagedEmphasisBlocks(prompt);
    assert(blocks.length === 2 && blocks[0].id === 3 && blocks[1].id === 7, 'list blocks ids');
    const prepared = m.prepareEmphasisTextForNovelAI(
        prompt,
        { manualPrompt: { groupsById: { 3: 1.35, 7: { weight: 1.2 } } } },
        'prompt'
    );
    assert(prepared.expanded === 2, 'expanded 2');
    assert(prepared.warnings.length === 0, 'no warnings');
    assert(prepared.text === 'hello 1.35::red dress:: world 1.2::blue eyes::', `expand text got: ${prepared.text}`);
    assert(prepared.strippedLeftoverDelims === 0, 'no leftover');
}

// --- Missing weight fail-closed ---
{
    const g = m.buildManagedEmphasisGroupText(5, 'solo');
    const prepared = m.prepareEmphasisTextForNovelAI(
        `x ${g} y`,
        { manualPrompt: { groupsById: {} } },
        'prompt'
    );
    assert(prepared.text === 'x solo y', `missing weight bare: ${prepared.text}`);
    assert(prepared.warnings.some((w) => w.includes('missing_weight_for_id_5')), 'missing warning');
}

// --- Adjacent ---
{
    const adj = m.buildManagedEmphasisGroupText(1, 'one') + m.buildManagedEmphasisGroupText(2, 'two');
    const prepared = m.prepareEmphasisTextForNovelAI(adj, { groupsById: { 1: 1.1, 2: 1.2 } }, null);
    assert(prepared.text === '1.1::one::1.2::two::', `adjacent: ${prepared.text}`);
}

// --- Unmanaged ZWSP in body ---
{
    const g = m.buildManagedEmphasisGroupText(3, 'tag');
    const dirty = `a\u200Bb${g}c`;
    const prepared = m.prepareEmphasisTextForNovelAI(
        dirty,
        { groupsById: { 3: 1.35 } },
        null
    );
    assert(prepared.text === 'ab1.35::tag::c', `strip unmanaged: ${JSON.stringify(prepared.text)}`);
}

// --- Legacy colon form still expands ---
{
    const bits = m.encodeEmphasisGroupIdBits(9);
    const legacy = `:${m.OPEN_MAGIC}${bits}:inner:${m.CLOSE_MAGIC}${bits}:`;
    assert(legacy.startsWith(':'), 'legacy has colons');
    const delims = m.listManagedEmphasisDelimiters(legacy);
    assert(delims.opens.length === 1 && delims.opens[0].legacy === true, 'legacy open flagged');
    const prepared = m.prepareEmphasisTextForNovelAI(
        legacy,
        { groupsById: { 9: 1.5 } },
        null
    );
    assert(prepared.text === '1.5::inner::', `legacy expand: ${prepared.text}`);
}

// --- Visible mode N:<OPEN>:inner:<CLOSE>: ---
{
    const g = m.buildManagedEmphasisGroupText(4, 'cape', { mode: 'visible', weight: 1.25 });
    assert(g.startsWith('1.25:'), `visible prefix: ${g.slice(0, 12)}`);
    assert(g.includes(':'), 'visible has colons');
    const blocks = m.listManagedEmphasisBlocks(`x ${g} y`);
    assert(blocks.length === 1 && blocks[0].id === 4, 'visible list id');
    assert(blocks[0].textWeight === 1.25, `visible textWeight: ${blocks[0].textWeight}`);
    assert(blocks[0].innerText === 'cape', `visible inner: ${blocks[0].innerText}`);
    const prepared = m.prepareEmphasisTextForNovelAI(
        `x ${g} y`,
        { groupsById: { 4: 1.4 } },
        null
    );
    assert(prepared.text === 'x 1.4::cape:: y', `visible expand prefers forge: ${prepared.text}`);
}

// --- Orphan close heal before expand (must not absorb into classic body) ---
{
    const open = (id) => m.buildEmphasisGroupOpenDelim(id);
    const close = (id) => m.buildEmphasisGroupCloseDelim(id);
    const bags = { groupsById: { 1: { weight: 1.5 }, 9: { weight: 1.2 } } };

    // omit-close + orphan: orphan must not become trailing junk inside N:: body
    const omitOrphan = open(1) + 'openOnly' + ', ' + close(9);
    const p1 = m.prepareEmphasisTextForNovelAI(omitOrphan, bags, 'prompt');
    assert(p1.text === '1.5::openOnly, ', `omit+orphan expand: ${JSON.stringify(p1.text)}`);
    assert(p1.strippedLeftoverDelims === 0, 'omit+orphan no leftover delims after heal');

    // closed + orphan: orphan removed; lone ", " after group kept (no haphazard comma strip)
    const closedOrphan = open(1) + 'openOnly' + close(1) + ', ' + close(9);
    const p2 = m.prepareEmphasisTextForNovelAI(closedOrphan, bags, 'prompt');
    assert(p2.text === '1.5::openOnly::, ', `closed+orphan expand: ${JSON.stringify(p2.text)}`);
    assert(p2.strippedLeftoverDelims === 0, 'closed+orphan no leftover delims after heal');

    const healed = m.removeUnpairedManagedEmphasisCloses(closedOrphan);
    assert(healed.removed === 1 && healed.orphanIds[0] === 9, 'removeUnpaired reports orphan id 9');
    assert(healed.text.endsWith(', '), 'orphan heal keeps trailing ", "');
}

// --- Token-count strip also heals orphans first ---
{
    const open = (id) => m.buildEmphasisGroupOpenDelim(id);
    const close = (id) => m.buildEmphasisGroupCloseDelim(id);
    const counted = m.stripManagedEmphasisDelimitersForCounting(open(1) + 'openOnly' + ', ' + close(9));
    assert(counted === 'openOnly, ', `count strip omit+orphan: ${JSON.stringify(counted)}`);
}

if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
}
console.log('\nAll emphasis group id syntax smoke tests passed.');
