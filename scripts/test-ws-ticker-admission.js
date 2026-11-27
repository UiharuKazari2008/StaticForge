#!/usr/bin/env node
/**
 * WebSocket ticker admission (Yozora #1350): a request is in the ticker only when it can be named.
 * "If a name cannot be written, it is machinery, and if it is machinery it does not go in the ticker."
 *  - the default is opt-in: showBanner undefined = default, true = the caller asked, false = opted out;
 *  - machinery (no type, ping, silentTicker, TICKER_OFF_TYPES) never shows, even when asked;
 *  - a default request shows when its type has a registry name; an asked nameless one shows as the generic label;
 *  - an opted-out request shows only when it is named AND has been pending past STUCK_TICKER_MS;
 *  - no label is ever a raw identifier (tickerLabel is null for an unknown type).
 * The methods are lifted out of websocket.js (same technique as test-ws-indicator-writes.js).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/websocket.js'), 'utf8');

const bmSrc = src.slice(0, src.indexOf('\nclass WebSocketClient'));
const BM = new Function(`${bmSrc}; return BannerManager;`)();

const WSC = {};
for (const name of ['STUCK_TICKER_MS']) {
    const m = src.match(new RegExp(`static ${name} = (\\d+);`));
    assert.ok(m, `static ${name}`);
    WSC[name] = Number(m[1]);
}
const lbl = src.match(/static TICKER_GENERIC_LABEL = '([^']+)';/);
assert.ok(lbl, 'static TICKER_GENERIC_LABEL');
WSC.TICKER_GENERIC_LABEL = lbl[1];

function lift(name, from = src, proto = false) {
    const at = from.indexOf(`\n    ${name}(`);
    assert.ok(at >= 0, `source has ${name}`);
    let depth = 0;
    let quote = null;
    for (let i = from.indexOf(') {', at) + 2; i < from.length; i++) {
        const ch = from[i];
        if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
        if (ch === '/' && from[i + 1] === '/') { i = from.indexOf('\n', i); continue; }
        if (ch === '/' && from[i + 1] === '*') { i = from.indexOf('*/', i + 2) + 1; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depth++;
        if (ch === '}' && --depth === 0) {
            const text = from.slice(at + 1, i + 1).trim();
            return new Function('WebSocketClient', 'BannerManager', 'window', `return function ${text}`)(WSC, BM, { uiShell: 'desktop' });
        }
    }
    throw new Error(`unbalanced ${name}`);
}

const proto = {};
['isSilentTickerRequest', '_tickerAdmits', '_tickerText', 'getPendingRequestsForTicker'].forEach((n) => { proto[n] = lift(n); });

const client = () => Object.assign(Object.create(proto), {
    bannerManager: new BM(),
    pendingRequests: new Map(),
    paginationGroups: new Map(),
    requestUsesPaginationGroup: () => false
});

const named = 'generate_image';
const nameless = 'zz_unnamed_internal_request';
const machinery = [...BM.TICKER_OFF_TYPES][0];
assert.ok(machinery, 'TICKER_OFF_TYPES is not empty');
assert.ok(BM.REQUEST_TYPE_NAMES[named], 'fixture: generate_image has a name');
assert.ok(!(nameless in BM.REQUEST_TYPE_NAMES), 'fixture: the nameless type has no name');

const STUCK = WSC.STUCK_TICKER_MS;
function rows(requests) {
    const c = client();
    requests.forEach((r, i) => c.pendingRequests.set(`r${i}`, Object.assign({ timestamp: Date.now() }, r)));
    return c.getPendingRequestsForTicker().map((t) => ({ type: t.request.type, label: c._tickerText(t.request.type) }));
}
const old = (ms) => Date.now() - ms - 50;

// (a) no showBanner, no name -> out
assert.deepStrictEqual(rows([{ type: nameless }]), [], 'a nameless default request is not in the ticker');
// (b) the same with a name -> in, with that name
assert.deepStrictEqual(rows([{ type: named }]), [{ type: named, label: BM.REQUEST_TYPE_NAMES[named] }], 'a named default request shows its name');
// (c) asked, nameless -> in, generic label, never the identifier
const asked = rows([{ type: nameless, showBanner: true }]);
assert.strictEqual(asked.length, 1, 'a nameless request that asked is shown');
assert.strictEqual(asked[0].label, WSC.TICKER_GENERIC_LABEL);
assert.notStrictEqual(asked[0].label, nameless, 'and never as its identifier');
// (d) machinery wins even over an explicit true
assert.deepStrictEqual(rows([{ type: machinery, showBanner: true }]), [], 'a TICKER_OFF type is out even when asked');
assert.deepStrictEqual(rows([{ type: named, showBanner: true, silentTicker: true }]), [], 'silentTicker is out even when asked');
// (e) stuck but nameless / machinery with showBanner:false -> still out
assert.deepStrictEqual(rows([{ type: nameless, showBanner: false, timestamp: old(STUCK) }]), [], 'a nameless stuck request stays out');
assert.deepStrictEqual(rows([{ type: machinery, showBanner: false, timestamp: old(STUCK) }]), [], 'a machinery stuck request stays out');
// (f) named, opted out: out before STUCK_TICKER_MS, in after
assert.deepStrictEqual(rows([{ type: named, showBanner: false, timestamp: old(STUCK - 1000) }]), [], 'a named opted-out request is out before the stuck time');
assert.deepStrictEqual(rows([{ type: named, showBanner: false, timestamp: old(STUCK) }]), [{ type: named, label: BM.REQUEST_TYPE_NAMES[named] }], 'and in once it is stuck');
// (g) ping out, in every form
assert.deepStrictEqual(rows([{ type: 'ping' }, { type: 'ping', showBanner: true }, { type: 'ping', showBanner: false, timestamp: old(STUCK) }]), [], 'ping is never in the ticker');
// no type
assert.deepStrictEqual(rows([{ showBanner: true }]), [], 'no type, no row');
// a prototype key is not a name
assert.deepStrictEqual(rows([{ type: 'constructor' }]), [], 'inherited object keys are not request names');
// pagination rows keep working and are named
// request_gallery_paginated is a client-made row type: it is admitted by showBanner:true and drawn with the pagination text, not a registry name
{
    const c = client();
    c.paginationGroups.set('g1', {});
    c.isPaginationGroupComplete = () => false;
    c.getPaginationGroupInfo = () => ({ total: 10 });
    const t = c.getPendingRequestsForTicker();
    assert.strictEqual(t.length, 1, 'an open pagination group still gets its placeholder row');
    assert.ok(c._tickerAdmits(t[0].request, 0), 'and the rule admits its type');
}
// (h) labels: never the identifier; unknown is null
const bm = new BM();
for (const [type, name] of Object.entries(BM.REQUEST_TYPE_NAMES)) {
    const l = bm.tickerLabel(type);
    assert.strictEqual(l, name, `tickerLabel(${type}) is its name`);
    assert.notStrictEqual(l, type, `tickerLabel(${type}) is not the identifier`);
}
assert.strictEqual(bm.tickerLabel('no_such_type'), null, 'an unknown type has no label');
assert.strictEqual(bm.tickerLabel('constructor'), null, 'nor does an inherited key');
// generated block markers sit together around both statics
assert.ok(/ws-names:begin[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*static REQUEST_TYPE_NAMES[\s\S]*?\n\s*static TICKER_OFF_TYPES[\s\S]*?\n\s*\/\/ ws-names:end/.test(src), 'both statics sit inside the generated markers');
assert.ok(!src.includes('SILENT_TICKER_REQUEST_TYPES'), 'the hand-kept silent list is gone');

// barred means barred from the WebSocket Requests window and the metadata dialog too: one registry decision, no raw identifier (#1350)
const modalSrc = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/websocketRequestsModal.js'), 'utf8');
assert.ok(modalSrc.includes('isSilentTickerRequest') && modalSrc.includes('tickerLabel('), 'the requests window filters by the barred set and labels through tickerLabel');
assert.ok(!/bannerManager\.formatRequestType/.test(modalSrc), 'the requests window never falls back to the raw identifier');
const metaSrc = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/metadataDialogManager.js'), 'utf8');
assert.ok(!/bannerManager\.formatRequestType/.test(metaSrc), 'nor does the metadata dialog');

console.log('test-ws-ticker-admission: ok');
