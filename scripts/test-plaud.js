'use strict';

// Plaud account + Yozora-only Plaud tools: node scripts/test-plaud.js (no network: fetch and DNS are stubbed).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plaud-test-'));
process.env.PLAUD_ACCOUNT_FILE = path.join(dir, 'plaud-account.json');
process.env.PLAUD_DEVICE_FILE = path.join(dir, 'plaud-device.json');

const plaud = require('../modules/plaudClient');
const plaudMcp = require('../modules/plaudMcp');
const { _test: t } = plaud;

function reply(status, body, headers) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { status, text: async () => text, headers: { get: (k) => (headers || {})[k.toLowerCase()] || null } };
}

const calls = [];
let failNet = false;
let refreshAnswer = { access_token: 'acc2', expires_in: 3600 };
const files = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, name: i % 10 === 0 ? `UI Review ${i}` : `Meeting ${i}`, created_at: '2026-11-20T10:00:00Z', duration: 60000 }));
const segments = [{ start_time: 0, end_time: 4000, speaker: 'Yukimi', content: 'The start menu is too slow.' }, { start_time: 65000, speaker: 'Yukimi', content: 'Fix the clock.' }];

t.setDeps({
    lookup: async (host) => (host === 'evil.test' ? [{ address: '10.0.0.5' }] : [{ address: '52.1.2.3' }]),
    fetch: async (url, init) => {
        if (failNet) throw new Error('offline');
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

    // sign in again through the :8199 callback the server listens on (the remote browser runs on this host)
    await plaud.unlink();
    const pushed = [];
    plaud.bind((x) => pushed.push(x));
    const link2 = plaud.linkStart();
    const st2 = new URL(link2.url).searchParams.get('state');
    for (let i = 0; i < 50 && !t.listening(); i++) await new Promise((r) => setTimeout(r, 20));
    if (t.listening()) {
        const get = (q) => new Promise((resolve, reject) => {
            require('http').get(`http://127.0.0.1:8199/auth/callback?${q}`, (res) => {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => resolve({ status: res.statusCode, body }));
            }).on('error', reject);
        });
        const wrong = await get('code=CODE1&state=nope');
        assert.strictEqual(wrong.status, 400);
        assert.strictEqual((await plaud.status()).linked, false, 'a stranger\'s state does not sign in');
        const ok = await get(`code=CODE1&state=${encodeURIComponent(st2)}`);
        assert.strictEqual(ok.status, 200);
        assert.ok(ok.body.includes('signed in to Plaud'));
        assert.strictEqual((await plaud.status()).linked, true);
        for (let i = 0; i < 50 && !pushed.length; i++) await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(pushed[pushed.length - 1].linked, true, 'CardSpace is told');
        assert.strictEqual(t.listening(), 0, 'the port is let go');
    } else {
        console.warn('test-plaud: port 8199 is taken here, callback case skipped');
        plaud.linkCancel();
        await plaud.linkFinish(`${t.REDIRECT_URI}?code=CODE1&state=x`).catch(() => {});
        const l3 = plaud.linkStart();
        await plaud.linkFinish(`${t.REDIRECT_URI}?code=CODE1&state=${new URL(l3.url).searchParams.get('state')}`);
    }
    plaud.bind(null);

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

    // ---- Today's Plaud item: list freshness and the one-press review ----
    const today = require('../modules/plaudToday');
    // the recorder is read through the server's browser: never the real one from a test
    require('../modules/plaudDevice')._test.setDeps({ browserRead: async () => { throw Object.assign(new Error('off'), { code: 'PLAUD_DEVICE_BROWSER' }); } });
    refreshAnswer = { access_token: 'acc2', expires_in: 3600 };
    t.reset();
    const l4 = plaud.linkStart();
    await plaud.linkFinish(`${t.REDIRECT_URI}?code=CODE1&state=${new URL(l4.url).searchParams.get('state')}`);
    const started = [];
    const tagged = [];
    let chatSources = [];
    today._test.setDeps({
        directorStart: {
            startDirectorSession: async (gr, input) => { started.push(input); return { sessionId: 'chat1', started: true }; },
            getDirectorSession: () => ({ status: 'running', issues: [] })
        },
        xiDirector: {
            listChatBriefs: () => (chatSources.length ? [{ id: 'chat1', sources: chatSources }] : []),
            tagStartedChat: async (id, patch) => { tagged.push([id, patch.source]); }
        }
    });
    const before = Date.now();
    const l1 = await today.list();
    assert.strictEqual(l1.stale, false);
    assert.strictEqual(l1.device, null);
    assert.strictEqual(l1.battery, null);
    assert.ok(l1.lastRead >= before && l1.lastRead <= Date.now());
    failNet = true;
    const l2 = await today.list();
    failNet = false;
    assert.strictEqual(l2.stale, true);
    assert.strictEqual(l2.lastRead, l1.lastRead);
    assert.deepStrictEqual(l2.recordings.map((x) => x.id), l1.recordings.map((x) => x.id));

    // nothing unread: nothing starts
    chatSources = l1.recordings.map((x) => x.source);
    const none = await today.reviewNew({});
    assert.deepStrictEqual(none, { started: false, none: true, count: 0, waiting: 0 });
    assert.strictEqual(started.length, 0);

    // two unread: one session on the newest source, every id in the prompt, the other tagged
    chatSources = l1.recordings.slice(2).map((x) => x.source);
    const two = await today.reviewNew({});
    assert.strictEqual(started.length, 1);
    assert.strictEqual(started[0].source, `plaud:${l1.recordings[0].id}`);
    assert.strictEqual(started[0].persona, 'xi');
    assert.ok(started[0].prompt.includes(`plaud:${l1.recordings[0].id}`) && started[0].prompt.includes(`plaud:${l1.recordings[1].id}`));
    assert.ok(started[0].prompt.includes(require('../modules/plaudActionsPrompt').BODY));
    assert.strictEqual(started[0].title, 'Plaud: 2 new recordings');
    assert.deepStrictEqual(tagged, [['chat1', `plaud:${l1.recordings[1].id}`]]);
    assert.strictEqual(two.count, 2);
    assert.strictEqual(two.sessionId, 'chat1');
    today._test.reset();


    // ---- the recorder, read from Plaud's page in the server's browser (no token leaves it) ----
    const dev = require('../modules/plaudDevice');
    const notices = [];
    const cleared = [];
    const devPushes = [];
    let reads = 0;
    let page = { signedIn: false };
    dev._test.reset();
    dev._test.setDeps({
        browserRead: async () => { reads += 1; if (page instanceof Error) throw page; return page; },
        inbox: { publish: (n) => { notices.push(n); return n; }, clear: (u, id) => { cleared.push(id); } }
    });
    dev.bind(() => devPushes.push(1));
    assert.strictEqual(dev.state(), 'unknown');

    // the browser is not signed in to Plaud: nothing shown, one notice asks for it
    const lNo = await today.list('gr');
    assert.deepStrictEqual([lNo.device, lNo.battery, lNo.lastSync, lNo.deviceLogin], [null, null, null, 'missing']);
    await today.list('gr');
    assert.strictEqual(reads, 1, 'a failed read is not repeated for 10 minutes');
    assert.strictEqual(notices.length, 1, 'the notice is published once');
    assert.ok(notices[0].title === 'Plaud' && /Sign in at Plaud/.test(notices[0].text));
    assert.strictEqual(fs.statSync(process.env.PLAUD_DEVICE_FILE).mode & 0o777, 0o600);

    // signed in (the shape seen live Nov 25 2026): name, model, firmware; no battery, no last sync
    page = { signedIn: true, devices: [{ sn: '8810000000001884', name: 'Hoshino Ai', model: '881', version_number: 67585, workspace_id: 'ws_x', owner_member_id: 'm', info: { auth_mode_lock: false, timezone_iana: '' }, prot_version: 0 }] };
    await dev.refresh();
    assert.strictEqual(dev.state(), 'ok');
    assert.deepStrictEqual(cleared, ['plaud:device-login'], 'a good read clears the notice');
    assert.ok(devPushes.length >= 1, 'a change push');
    const l5 = await today.list('gr');
    assert.deepStrictEqual(l5.device, { name: 'Hoshino Ai', model: '881' });
    assert.deepStrictEqual([l5.battery, l5.lastSync, l5.deviceLogin], [null, null, 'ok']);
    assert.deepStrictEqual(dev.status().recorders, [{ name: 'Hoshino Ai', model: '881', serial: '...1884', firmware: '67585', battery: null, lastSync: null }]);
    assert.ok(!fs.readFileSync(process.env.PLAUD_DEVICE_FILE, 'utf8').includes('8810000000001884'), 'the whole serial is not kept');
    assert.deepStrictEqual(dev._test.fields(), ['info', 'model', 'name', 'owner_member_id', 'prot_version', 'sn', 'version_number', 'workspace_id']);
    const n = reads;
    await today.list('gr');
    assert.strictEqual(reads, n, 'read at most once a day');

    // the file survives a restart; the browser being off keeps what is known
    dev._test.reset();
    page = Object.assign(new Error('The server\'s browser (Alchemy) is not running'), { code: 'PLAUD_DEVICE_BROWSER' });
    assert.strictEqual(dev.state(), 'ok');
    assert.strictEqual((await dev.recorder()).name, 'Hoshino Ai');
    await dev.refresh();
    assert.strictEqual((await today.list('gr')).device.name, 'Hoshino Ai');
    assert.ok(/not running/.test(dev.status().lastError));

    // a battery / last sync field is taken only when Plaud really sends one (also inside info)
    assert.deepStrictEqual(dev._test.mapDevice({ sn: 'S', name: 'P', model: 'm', version_number: 'v1', battery_level: 64, info: { last_sync_time: 1790000000 } }),
        { name: 'P', model: 'm', serial: '...S', firmware: 'v1', battery: 64, lastSync: 1790000000000 });
    assert.strictEqual(dev._test.mapDevice({ battery_low_flag: 1, connect_count: 5 }).battery, null);
    assert.strictEqual(dev._test.mapDevice({ battery_low_flag: 1, connect_count: 5 }).lastSync, null);

    fs.rmSync(dir, { recursive: true, force: true });
    console.log('test-plaud: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
