#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const alchemy = require('../modules/alchemyOwnedTab');
const discord = require('../modules/discordChannelHistory');
const registry = require('../modules/mcpModuleRegistry');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function fixtureMessages() {
    return [
        {
            id: '1000000000000000001',
            author: 'Ada',
            timestamp: '2026-10-17T20:43:00.000Z',
            content: 'first look',
            attachments: ['https://cdn.discordapp.com/attachments/1/a.png']
        },
        {
            id: '1000000000000000002',
            author: 'Ada',
            timestamp: '2026-10-19T10:42:00.000Z',
            content: 'later note',
            attachments: []
        },
        {
            id: '1000000000000000003',
            author: 'Bea',
            timestamp: '2026-10-19T11:00:00.000Z',
            content: 'staff ping',
            attachments: ['https://media.discordapp.net/attachments/2/b.webp']
        }
    ];
}

function fakeTab(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const tab = {
        url: opts.url || 'about:blank#alchemy-owned',
        title: 'Alchemy owned',
        signedIn: opts.signedIn !== false,
        messages: (opts.messages || fixtureMessages()).slice(),
        sidebar: opts.sidebar || {
            href: 'https://discord.com/channels/336642139381301249/111111111111111111',
            label: 'nai-diffusion-discussion'
        },
        navigations: [],
        scrolls: [],
        async navigate(url) {
            this.url = url;
            this.navigations.push(url);
            return this.info();
        },
        async info() {
            return { url: this.url, title: this.title, readyState: 'complete', owned: true };
        },
        async scroll(input) {
            this.scrolls.push(input);
            return { top: this.scrolls.length * 900, left: 0 };
        },
        async evaluate(expression) {
            const src = String(expression || '');
            if (src.includes('welcome back')) {
                return {
                    href: this.url,
                    login: this.signedIn === false,
                    messages: this.signedIn === false ? 0 : this.messages.length,
                    title: this.title
                };
            }
            if (src.includes('message-content')) {
                return this.messages.slice();
            }
            if (src.includes('/channels/') && src.includes('aria-label')) {
                return this.sidebar;
            }
            if (src.includes('location.href')) {
                return { url: this.url, title: this.title, readyState: 'complete' };
            }
            return null;
        }
    };
    return tab;
}

(function testTargetPicking() {
    const agent = { type: 'page', url: 'http://127.0.0.1:9220/app?agent=1', title: 'Dreamscape' };
    const owned = { type: 'page', url: 'about:blank#alchemy-owned', title: 'Alchemy owned' };
    const discordPage = { type: 'page', url: 'https://discord.com/channels/336642139381301249/1', title: 'Discord' };
    assert.ok(alchemy.isDreamscapeAgentTarget(agent));
    assert.ok(!alchemy.isAlchemyOwnedTarget(agent));
    assert.ok(alchemy.isAlchemyOwnedTarget(owned));
    assert.strictEqual(alchemy.pickDreamscapeAgentTarget([owned, agent]), agent);
    assert.strictEqual(alchemy.pickAlchemyOwnedTarget([agent, owned, discordPage]), owned);
    // After navigating, the marker hash is gone: the recorded target id keeps ownership,
    // and an unrecorded page is never adopted.
    const navigated = { id: 'T-OWNED', type: 'page', url: 'https://discord.com/channels/336642139381301249/111111111111111111', title: 'Discord' };
    const stranger = { id: 'T-OTHER', type: 'page', url: 'https://example.com/', title: 'Other' };
    assert.strictEqual(alchemy.pickAlchemyOwnedTarget([agent, stranger, navigated], 'T-OWNED'), navigated);
    assert.ok(alchemy.isAlchemyOwnedTarget(navigated, 'T-OWNED'));
    assert.ok(!alchemy.isAlchemyOwnedTarget(stranger, 'T-OWNED'));
    assert.strictEqual(alchemy.pickAlchemyOwnedTarget([agent, discordPage]), null);
    assert.strictEqual(alchemy.pickAlchemyOwnedTarget([agent, stranger], 'T-GONE'), null);
    assert.strictEqual(alchemy.pickAlchemyOwnedTarget([{ ...agent, id: 'T-A' }], 'T-A'), null, 'never the agent tab, even by id');
    assert.strictEqual(alchemy.pickAlchemyOwnedTarget([agent]), null);
})();

(function testPacingAndGuards() {
    let now = 1000;
    const waits = [];
    const pacer = alchemy.createPacer({
        minGapMs: 500,
        now: () => now,
        sleep: async (ms) => { waits.push(ms); now += ms; }
    });
    return pacer.wait().then(() => pacer.wait()).then((secondWait) => {
        assert.ok(secondWait >= 500 || waits.includes(500) || waits.some((ms) => ms > 0));
        assert.ok(alchemy.isDiscordWriteSelector('[aria-label="Send Message"]'));
        assert.ok(alchemy.isDiscordWriteSelector('[data-slate-editor="true"]'));
        assert.ok(alchemy.isDiscordWriteSelector('[aria-label="Add Reaction"]'));
        assert.ok(!alchemy.isDiscordWriteSelector('a[href*="/channels/"]'));
        assert.ok(alchemy.isHttpOrBlank('https://discord.com/channels/1/2'));
        assert.ok(!alchemy.isHttpOrBlank('javascript:alert(1)'));
        assert.ok(!alchemy.isHttpOrBlank('file:///etc/passwd'));
    });
})().then(async () => {
    const tab = new alchemy.AlchemyOwnedTab({
        requestJson: async () => { throw new Error('offline'); }
    });
    await assert.rejects(() => tab.connect(), (err) => err.code === 'ALCHEMY_CDP_OFFLINE');

    const clickTab = {
        info: async () => ({ url: 'https://discord.com/channels/1/2', title: 'Discord' }),
        evaluate: async () => { throw new Error('should not evaluate write click'); },
        send: async () => { throw new Error('should not mouse-click Discord'); },
        pacer: { wait: async () => 0 }
    };
    Object.setPrototypeOf(clickTab, alchemy.AlchemyOwnedTab.prototype);
    clickTab.pacer = alchemy.createPacer({ minGapMs: 0, sleep: async () => {} });
    await assert.rejects(
        () => alchemy.AlchemyOwnedTab.prototype.click.call(clickTab, { selector: '[aria-label="Send Message"]' }),
        (err) => err.code === 'DISCORD_WRITE_REFUSED'
    );
    await assert.rejects(
        () => alchemy.AlchemyOwnedTab.prototype.click.call(clickTab, { x: 10, y: 20 }),
        (err) => err.code === 'DISCORD_WRITE_REFUSED'
    );
    // Any click on Discord is refused, not just known compose/react selectors
    // (message menus can delete, pin, join or block).
    await assert.rejects(
        () => alchemy.AlchemyOwnedTab.prototype.click.call(clickTab, { selector: 'div[id^="message-"] button:nth-child(3)' }),
        (err) => err.code === 'DISCORD_WRITE_REFUSED'
    );

    // Navigation guard: the profile also holds the Dreamscape agent session and the CDP port.
    for (const bad of [
        'http://127.0.0.1:9220/api/session', 'http://localhost:9334/json/list', 'http://[::1]:9220/',
        'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.20.0.1/', 'http://169.254.169.254/latest/meta-data/',
        'http://100.64.0.1/', 'http://0.0.0.0:9220/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/',
        'http://dreamscape/', 'http://printer.local/', 'http://router.lan/', 'https://user:pw@discord.com/',
        'file:///etc/passwd', 'javascript:alert(1)', 'about:srcdoc', 'view-source:https://discord.com/', 'chrome://settings'
    ]) {
        assert.ok(alchemy.blockedUrlReason(bad), `must refuse ${bad}`);
    }
    for (const good of ['https://discord.com/channels/336642139381301249/111111111111111111', 'https://novelai.net/', 'about:blank', 'about:blank#alchemy-owned']) {
        assert.strictEqual(alchemy.blockedUrlReason(good), '', `must allow ${good}`);
    }
    await assert.rejects(
        () => alchemy.assertNavigableUrl('https://rebind.example.com/', async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }]),
        (err) => err.code === 'ALCHEMY_URL_REFUSED' && /private/.test(err.message),
        'DNS that resolves to loopback is refused'
    );
    await assert.rejects(
        () => alchemy.assertNavigableUrl('https://nx.example.com/', async () => { throw new Error('ENOTFOUND'); }),
        (err) => err.code === 'ALCHEMY_URL_REFUSED'
    );
    await alchemy.assertNavigableUrl('https://discord.com/app', async () => [{ address: '162.159.135.232' }]);

    // A public URL that redirects to loopback is caught on the landed URL and the tab is blanked.
    const sent = [];
    let landedUrl = 'http://127.0.0.1:9220/app?agent=1';
    const navTab = new alchemy.AlchemyOwnedTab({
        minGapMs: 0,
        sleep: async () => {},
        lookup: async () => [{ address: '93.184.216.34' }],
        readState: () => ({}),
        writeState: () => { throw new Error('must not record a refused page'); }
    });
    navTab.send = async (method, params) => {
        sent.push([method, params && params.url]);
        if (method === 'Page.navigate') landedUrl = params.url === alchemy.ALCHEMY_BLANK_URL ? params.url : landedUrl;
        return {};
    };
    navTab.evaluate = async (src) => (String(src).includes('location.href')
        ? { url: landedUrl, title: '', readyState: 'complete' } : 'complete');
    await assert.rejects(() => navTab.navigate('https://redirector.example.com/'), (err) => err.code === 'ALCHEMY_URL_REFUSED');
    assert.deepStrictEqual(sent.map((row) => row[1]), ['https://redirector.example.com/', alchemy.ALCHEMY_BLANK_URL]);
    await assert.rejects(() => navTab.navigate('http://127.0.0.1:9220/'), (err) => err.code === 'ALCHEMY_URL_REFUSED');
    assert.strictEqual(sent.length, 2, 'a refused URL is never sent to Chromium');

    // connect() records the owned target id so ownership survives navigation.
    const states = [];
    const fakeConn = function () {};
    fakeConn.prototype.open = async () => {};
    fakeConn.prototype.send = async () => ({});
    fakeConn.prototype.isOpen = () => true;
    fakeConn.prototype.close = () => {};
    const connTab = new alchemy.AlchemyOwnedTab({
        requestJson: async (url) => {
            if (url.endsWith('/json/list')) {
                return [
                    { id: 'A', type: 'page', url: 'http://127.0.0.1:9220/app?agent=1', webSocketDebuggerUrl: 'ws://x/A' },
                    { id: 'S', type: 'page', url: 'https://example.com/', webSocketDebuggerUrl: 'ws://x/S' }
                ];
            }
            return { id: 'N', type: 'page', url: alchemy.ALCHEMY_BLANK_URL, webSocketDebuggerUrl: 'ws://x/N' };
        },
        CdpConnection: fakeConn,
        readState: () => ({}),
        writeState: (state) => states.push(state)
    });
    connTab.info = async () => ({ url: alchemy.ALCHEMY_BLANK_URL, title: '', owned: true });
    await connTab.connect();
    assert.strictEqual(connTab.target.id, 'N', 'opens a new owned tab instead of adopting example.com');
    assert.strictEqual(states[0].targetId, 'N');

    // The real CDP connection must construct the ws client (regression: `new loadWebSocket()(url)`
    // and a bare WebSocket.OPEN reference both threw before any socket was opened).
    const conn = new alchemy.CdpConnection('ws://127.0.0.1:9/devtools/page/none');
    await assert.rejects(() => conn.open(), (err) => !(err instanceof TypeError) && !(err instanceof ReferenceError));
    assert.strictEqual(conn.isOpen(), false);
    await assert.rejects(() => conn.send('Runtime.evaluate'), /not open/);
    conn.close();

    // Discord ids: guild channels only, never DMs, no path injection through guildId/messageId.
    assert.ok(discord.resolveChannel('https://discord.com/channels/@me/1111111111111111111').unofficial, 'DM URL is not treated as a channel');
    assert.ok(discord.resolveChannel({ channel: '1111111111111111111', guildId: '../../invite/x' }).error);
    assert.ok(discord.resolveChannel({ channel: 'nai-image-posting', messageId: '1/../../x' }).error);

    const channel = discord.resolveChannel('#nai-image-posting');
    assert.strictEqual(channel.slug, 'nai-image-posting');
    assert.strictEqual(channel.guildId, discord.NOVELAI_GUILD_ID);
    assert.strictEqual(channel.resolveFromSidebar, true);

    const fromUrl = discord.resolveChannel('https://discord.com/channels/336642139381301249/2222222222222222222/3333333333333333333');
    assert.strictEqual(fromUrl.channelId, '2222222222222222222');
    assert.strictEqual(fromUrl.messageId, '3333333333333333333');

    const unofficial = discord.resolveChannel('unofficial-lab');
    assert.strictEqual(unofficial.unofficial, true);
    assert.strictEqual(unofficial.slug, 'unofficial-lab');

    const afterId = discord.parseAfterCursor({ after: '1000000000000000002' });
    assert.strictEqual(afterId.kind, 'messageId');
    const afterTs = discord.parseAfterCursor({ after: '2026-10-19T06:42:00-04:00' });
    assert.strictEqual(afterTs.kind, 'timestamp');
    assert.ok(afterTs.timestampMs > 0);

    const msgs = fixtureMessages();
    assert.strictEqual(discord.messageIsAfter(msgs[2], afterId), true);
    assert.strictEqual(discord.messageIsAfter(msgs[0], afterId), false);
    assert.strictEqual(discord.messageIsAfter(msgs[2], afterTs), true);
    assert.strictEqual(discord.clampLimit(400), discord.MAX_LIMIT);
    assert.strictEqual(discord.clampLimit(0), 1);

    const host = discord.resolveHostPath({ hostPath: path.join(discord.HOST_DIR, 'ok.json') }, 'nai-image-posting');
    assert.ok(String(host).startsWith(discord.HOST_DIR));
    const refused = discord.resolveHostPath({ hostPath: '/tmp/nope.json' }, 'x');
    assert.ok(refused.error);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alchemy-discord-'));
    const writes = [];
    const history = await discord.readHistory(fakeTab({
        url: 'https://discord.com/channels/336642139381301249/111111111111111111',
        sidebar: {
            href: 'https://discord.com/channels/336642139381301249/111111111111111111',
            label: 'nai-diffusion-discussion'
        }
    }), {
        channel: 'nai-diffusion-discussion',
        after: '1000000000000000001',
        limit: 10,
        hostPath: path.join(tmp, 'out.json')
    }, {
        sleep: async () => {},
        scrollGapMs: 0,
        maxScrolls: 2,
        fs: {
            mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
            writeFile: (file, text) => {
                writes.push(file);
                fs.writeFileSync(file, text);
            }
        }
    });
    assert.strictEqual(history.success, true);
    assert.strictEqual(history.readonly, true);
    assert.strictEqual(history.messages.length, 2);
    assert.deepStrictEqual(history.messages[0].attachments, []);
    assert.strictEqual(history.messages[1].author, 'Bea');
    assert.ok(history.messages.every((row) => row.id && 'author' in row && 'timestamp' in row && 'content' in row && Array.isArray(row.attachments)));
    assert.ok(writes.length === 0, 'hostPath outside the cache tree must not write');
    assert.ok(history.hostWrite && history.hostWrite.ok === false);

    const okPath = path.join(discord.HOST_DIR, 'test-alchemy-owned-tab.json');
    const written = await discord.readHistory(fakeTab({
        url: 'https://discord.com/channels/336642139381301249/111111111111111111'
    }), {
        channel: 'https://discord.com/channels/336642139381301249/111111111111111111',
        after: '1000000000000000002',
        writeHost: true,
        hostPath: okPath
    }, {
        sleep: async () => {},
        scrollGapMs: 0,
        maxScrolls: 1
    });
    assert.strictEqual(written.success, true);
    assert.strictEqual(written.messages.length, 1);
    assert.strictEqual(written.messages[0].id, '1000000000000000003');
    assert.ok(fs.existsSync(okPath));
    const saved = JSON.parse(fs.readFileSync(okPath, 'utf8'));
    assert.strictEqual(saved.readonly, true);
    assert.strictEqual(saved.messages[0].content, 'staff ping');
    fs.unlinkSync(okPath);

    const signedOut = await discord.readHistory(fakeTab({ signedIn: false }), {
        channel: 'https://discord.com/channels/336642139381301249/111111111111111111',
        writeHost: false
    }, { sleep: async () => {}, scrollGapMs: 0, sessionTimeoutMs: 10 });
    assert.strictEqual(signedOut.success, false);
    assert.strictEqual(signedOut.code, 'DISCORD_NOT_SIGNED_IN');

    const histSrc = read('modules/discordChannelHistory.js');
    assert.ok(!/discord\.com\/api/.test(histSrc), 'history reader must not call the Discord HTTP API');
    assert.ok(!/headers\s*:\s*\{[^}]*Authorization/.test(histSrc), 'no Discord token header');
    assert.ok(!/Bot\s+[A-Za-z0-9._-]{20,}/.test(histSrc), 'no bot token literal');
    assert.ok(!/\.click\(/.test(histSrc), 'history reader never clicks');
    assert.ok(!/insertText|dispatchKeyEvent|typeText/.test(histSrc), 'history reader never types');
    assert.ok(histSrc.includes('Never posts'), 'read-only contract is documented');

    const ownedSrc = read('modules/alchemyOwnedTab.js');
    assert.ok(ownedSrc.includes("127.0.0.1"));
    assert.ok(ownedSrc.includes('ALCHEMY_CDP_OFFLINE'));
    assert.ok(ownedSrc.includes('does not launch another Chrome') || ownedSrc.includes('Does not launch another Chrome'));
    assert.ok(!ownedSrc.includes('spawn('), 'Alchemy module must not start Chromium');

    const client = read('scripts/dedicated-agent-client.js');
    assert.ok(client.includes("require('../modules/alchemyOwnedTab')"));
    assert.ok(client.includes('pickDreamscapeAgentTarget'));
    assert.ok(client.includes('ensureAlchemyOwnedTab'));
    assert.ok(client.includes('ALCHEMY_BLANK_URL'));

    assert.ok(registry.toolInModule('alchemy_browser', 'alchemy_browser'));
    assert.ok(registry.toolInModule('read_discord_channel_history', 'alchemy_browser'));
    assert.ok(!registry.toolInModule('alchemy_browser', 'core_generation'), 'not on the generation scope');

    // Scope + identity gate: the tab carries Yukimi's Discord session.
    const { _test } = require('../modules/mcpAgentFacade');
    const listed = (scopes, owner) => _test.listToolsForScopes(scopes, null, { owner }).map((tool) => tool.name);
    assert.ok(listed(['sfapp_alchemy_browser'], 'hoshino').includes('read_discord_channel_history'));
    assert.ok(listed(['sfapp_alchemy_browser'], 'yukimi').includes('alchemy_browser'));
    assert.ok(!listed(['sfapp_alchemy_browser'], 'guren').includes('alchemy_browser'), 'scope alone is not enough');
    assert.ok(!listed(['universal'], 'menma').includes('alchemy_browser'), 'universal bot keys are not allowlisted');
    assert.ok(!listed(['generation'], 'hoshino').includes('alchemy_browser'), 'generation no longer grants it');
    const denied = await _test.handleJsonRpc({}, {
        applicationAuth: { appName: 'Guren', applicationScopes: ['sfapp_alchemy_browser'] },
        authMethod: 'application_key'
    }, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'alchemy_browser', arguments: { op: 'info' } } });
    assert.ok(JSON.stringify(denied.body).includes('ALCHEMY_BROWSER_DENIED') || JSON.stringify(denied.body).includes('not allowed'),
        `non-allowlisted key is refused at call time: ${JSON.stringify(denied.body).slice(0, 300)}`);
    const noScope = await _test.handleJsonRpc({}, {
        applicationAuth: { appName: 'Hoshino', applicationScopes: ['generation'] },
        authMethod: 'application_key'
    }, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'read_discord_channel_history', arguments: { channel: 'staff' } } });
    assert.ok(/scope/i.test(JSON.stringify(noScope.body)), 'scope is still required at call time');
    const scopes = require('../modules/directorAppKeyScopes');
    assert.strictEqual(scopes.ALCHEMY_BROWSER_SCOPE, 'sfapp_alchemy_browser');
    assert.deepStrictEqual(scopes.ALCHEMY_BROWSER_KEY_TARGETS.map((row) => row.label), ['Hoshino']);
    assert.ok(require('../modules/applicationAuthManager').AVAILABLE_SCOPES.some((row) => row.id === 'sfapp_alchemy_browser'));

    const facadeSrc = read('modules/mcpAgentFacade.js');
    assert.ok(facadeSrc.includes("name: 'alchemy_browser'"));
    assert.ok(facadeSrc.includes("name: 'read_discord_channel_history'"));
    assert.ok(facadeSrc.includes("require('./alchemyOwnedTab')"));
    assert.ok(facadeSrc.includes("require('./discordChannelHistory')"));
    const limiterSrc = read('modules/mcpRateLimiter.js');
    assert.ok(limiterSrc.includes('alchemy_browser: \'studio\''));
    assert.ok(limiterSrc.includes('read_discord_channel_history: \'search\''));
    const instructions = read('modules/mcpInstructions.js');
    assert.ok(instructions.includes('alchemy_browser'));
    assert.ok(instructions.includes('read_discord_channel_history'));
    assert.ok(instructions.includes('Never post'));

    console.log('test-alchemy-owned-tab: ok');
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
