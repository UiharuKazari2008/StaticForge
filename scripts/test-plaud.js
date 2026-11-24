'use strict';

// Plaud account + Yozora-only Plaud tools: node scripts/test-plaud.js (no network: fetch and DNS are stubbed).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plaud-test-'));
process.env.PLAUD_ACCOUNT_FILE = path.join(dir, 'plaud-account.json');

const plaud = require('../modules/plaudClient');
const plaudMcp = require('../modules/plaudMcp');
const { _test: t } = plaud;

function reply(status, body, headers) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { status, text: async () => text, headers: { get: (k) => (headers || {})[k.toLowerCase()] || null } };
}

const calls = [];
let refreshAnswer = { access_token: 'acc2', expires_in: 3600 };
const files = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, name: i % 10 === 0 ? `UI Review ${i}` : `Meeting ${i}`, created_at: '2026-11-20T10:00:00Z', duration: 60000 }));
const segments = [{ start_time: 0, end_time: 4000, speaker: 'Yukimi', content: 'The start menu is too slow.' }, { start_time: 65000, speaker: 'Yukimi', content: 'Fix the clock.' }];

t.setDeps({
    lookup: async (host) => (host === 'evil.test' ? [{ address: '10.0.0.5' }] : [{ address: '52.1.2.3' }]),
    fetch: async (url, init) => {
        const u = new URL(url);
        const auth = (init && init.headers && init.headers.Authorization) || '';
        calls.push({ path: u.pathname, auth, body: init && init.body });
        if (u.pathname.endsWith('/oauth/third-party/access-token')) {
            const body = new URLSearchParams(init.body);
            assert.strictEqual(body.get('code'), 'CODE1');
            assert.ok(body.get('code_verifier'));
            assert.ok(auth.startsWith('Basic '));
            return reply(200, { access_token: 'acc1', refresh_token: 'ref1', expires_in: 3600 });
        }
        if (u.pathname.endsWith('/access-token/refresh')) return refreshAnswer ? reply(200, refreshAnswer) : reply(401, { error: 'no' });
        if (u.pathname.endsWith('/users/current')) return reply(200, { data: { id: 'u1', nickname: 'Yukimi', email: 'y@example.com' } });
        if (u.pathname.endsWith('/users/current/revoke')) return reply(200, {});
        if (u.pathname === '/developer/api/open/third-party/files/') {
            const page = Number(u.searchParams.get('page'));
            const size = Number(u.searchParams.get('page_size'));
            return reply(200, { page, data: files.slice((page - 1) * size, page * size) });
        }
        if (u.pathname === '/developer/api/open/third-party/files/f10') {
            return reply(200, { data: { id: 'f10', name: 'UI Review 10', duration: 120000,
                source_list: [{ data_type: 'transaction', data_link: 'https://store.plaud.test/t.json' }, { data_type: 'mark_memo', data_link: 'https://evil.test/x' }],
                note_list: [{ data_type: 'auto_sum_note', data_title: 'Summary', data_content: '## Summary\n- Start menu slow' }] } });
        }
        if (u.pathname.startsWith('/developer/api/open/third-party/files/')) return reply(404, {});
        if (u.hostname === 'store.plaud.test') return reply(200, JSON.stringify(segments));
        throw new Error(`unexpected ${url}`);
    }
});

(async () => {
    // not signed in
    let st = await plaud.status();
    assert.strictEqual(st.linked, false);
    await assert.rejects(plaud.listRecordings({}), (e) => e.code === 'PLAUD_NOT_LINKED');

    // pasted address parsing
    assert.deepStrictEqual(t.parsePasted('http://localhost:8199/auth/callback?code=abc&state=xyz'), { code: 'abc', state: 'xyz', error: '' });
    assert.deepStrictEqual(t.parsePasted('  rawcode '), { code: 'rawcode', state: '' });

    // sign in: PKCE link, wrong state refused, right one stored
    await assert.rejects(plaud.linkFinish('http://localhost:8199/auth/callback?code=CODE1'), (e) => e.code === 'PLAUD_LINK_GONE');
    const link = plaud.linkStart();
    const q = new URL(link.url).searchParams;
    assert.strictEqual(new URL(link.url).origin, 'https://web.plaud.ai');
    assert.strictEqual(q.get('code_challenge_method'), 'S256');
    assert.strictEqual(q.get('redirect_uri'), t.REDIRECT_URI);
    await assert.rejects(plaud.linkFinish(`${t.REDIRECT_URI}?code=CODE1&state=other`), (e) => e.code === 'PLAUD_LINK_GONE');
    st = await plaud.linkFinish(`${t.REDIRECT_URI}?code=CODE1&state=${q.get('state')}`);
    assert.strictEqual(st.linked, true);
    assert.deepStrictEqual(st.account, { name: 'Yukimi', email: 'y@example.com' });
    assert.ok(!JSON.stringify(st).includes('acc1'), 'status never carries a token');
    const saved = fs.statSync(process.env.PLAUD_ACCOUNT_FILE);
    assert.strictEqual(saved.mode & 0o777, 0o600);

    // list, search
    const page1 = await plaud.listRecordings({ limit: 10 });
    assert.strictEqual(page1.recordings.length, 10);
    assert.strictEqual(page1.more, true);
    const hits = await plaud.listRecordings({ query: 'ui review' });
    assert.deepStrictEqual(hits.recordings.map((r) => r.id), ['f0', 'f10', 'f20']);

    // recording: notes inline, transcript blocks listed
    const rec = await plaud.getRecording('f10');
    assert.strictEqual(rec.source, 'plaud:f10');
    assert.deepStrictEqual(rec.transcriptBlocks, ['transaction', 'mark_memo']);
    assert.ok(rec.notes[0].markdown.includes('Start menu slow'));
    await assert.rejects(plaud.getRecording('nope'), (e) => e.code === 'PLAUD_NOT_FOUND');

    // transcript from data_link, rendered; a private-address link is refused
    const tr = await plaud.getTranscript('f10', {});
    assert.strictEqual(tr.text, '[00:00] Yukimi: The start menu is too slow.\n[01:05] Yukimi: Fix the clock.');
    assert.strictEqual(tr.nextOffset, null);
    await assert.rejects(plaud.getTranscript('f10', { block: 'mark_memo' }), (e) => e.code === 'PLAUD_BAD_LINK');
    assert.strictEqual(t.isPrivateAddress('192.168.1.2'), true);
    assert.strictEqual(t.isPrivateAddress('8.8.8.8'), false);

    // refresh: an expired access token refreshes once, keeps the refresh token
    const stored = JSON.parse(fs.readFileSync(process.env.PLAUD_ACCOUNT_FILE, 'utf8'));
    stored.user.until = 0;
    fs.writeFileSync(process.env.PLAUD_ACCOUNT_FILE, JSON.stringify(stored), { mode: 0o600 });
    t.reset();
    await Promise.all([plaud.listRecordings({}), plaud.listRecordings({})]);
    assert.strictEqual(calls.filter((c) => c.path.endsWith('/refresh')).length, 1, 'one refresh for parallel calls');
    assert.strictEqual(JSON.parse(fs.readFileSync(process.env.PLAUD_ACCOUNT_FILE, 'utf8')).user.refresh, 'ref1');

    // a refused refresh signs the account out
    const again = JSON.parse(fs.readFileSync(process.env.PLAUD_ACCOUNT_FILE, 'utf8'));
    again.user.until = 0;
    fs.writeFileSync(process.env.PLAUD_ACCOUNT_FILE, JSON.stringify(again), { mode: 0o600 });
    t.reset();
    refreshAnswer = null;
    await assert.rejects(plaud.listRecordings({}), (e) => e.code === 'PLAUD_NOT_LINKED');
    assert.strictEqual((await plaud.status()).linked, false);

    // ---- MCP gates: Xi only, literal scope only ----
    plaudMcp._test.setBackend({ listRecordings: async () => ({ recordings: [{ id: 'x' }] }) });
    const req = (appName, scopes) => ({ applicationAuth: { appName, applicationScopes: scopes } });
    const parse = (r) => JSON.parse(r.content[0].text);
    let out = await plaudMcp.handlePlaudTool(req('Xi', ['sfapp_plaud']), 'plaud_list_recordings', {});
    assert.strictEqual(parse(out).success, true);
    out = await plaudMcp.handlePlaudTool(req('Dreamscape Director', ['sfapp_plaud']), 'plaud_list_recordings', {});
    assert.strictEqual(parse(out).code, 'FORBIDDEN');
    out = await plaudMcp.handlePlaudTool(req('Xi', ['universal']), 'plaud_list_recordings', {});
    assert.strictEqual(parse(out).code, 'INSUFFICIENT_SCOPE');
    assert.strictEqual(plaudMcp.scopesHavePlaud(['universal']), false);

    // tools/list: only the Xi key with the scope sees them
    const facade = require('../modules/mcpAgentFacade');
    const list = facade._test && facade._test.listToolsForScopes;
    if (typeof list === 'function') {
        const names = (scopes, appName) => list(scopes, null, { appName }).map((x) => x.name).filter((n) => n.startsWith('plaud_'));
        assert.deepStrictEqual(names(['sfapp_plaud'], 'Xi').sort(), ['plaud_get_recording', 'plaud_get_transcript', 'plaud_list_recordings']);
        assert.deepStrictEqual(names(['sfapp_plaud'], 'Dreamscape Director'), []);
        assert.deepStrictEqual(names(['universal'], 'Xi'), []);
    }
    const rate = require('../modules/mcpRateLimiter');
    const groups = rate.TOOL_RATE_GROUPS || (rate._test && rate._test.TOOL_RATE_GROUPS);
    if (groups) plaudMcp.TOOLS.forEach((x) => assert.ok(groups[x.name], `${x.name} has a rate group`));

    // only the Xi key is widened to the scope
    const scopes = require('../modules/directorAppKeyScopes');
    assert.deepStrictEqual(scopes.PLAUD_KEY_TARGETS.map((x) => x.label), ['Xi']);
    assert.ok(!scopes.DIRECTOR_MCP_SCOPES.includes('sfapp_plaud'));

    fs.rmSync(dir, { recursive: true, force: true });
    console.log('test-plaud: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
