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
    assert.strictEqual(alchemy.pickAlchemyOwnedTarget([agent, discordPage]), discordPage);
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

    const channel = discord.resolveChannel('#nai-image-posting');
    assert.strictEqual(channel.slug, 'nai-image-posting');
    assert.strictEqual(channel.guildId, discord.NOVELAI_GUILD_ID);
    assert.strictEqual(channel.resolveFromSidebar, true);

    const fromUrl = discord.resolveChannel('https://discord.com/channels/336642139381301249/222/333');
    assert.strictEqual(fromUrl.channelId, '222');
    assert.strictEqual(fromUrl.messageId, '333');

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
        channel: 'https://discord.com/channels/336642139381301249/1',
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

    assert.ok(registry.toolInModule('alchemy_browser', 'core_generation'));
    assert.ok(registry.toolInModule('read_discord_channel_history', 'core_generation'));

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
    assert.ok(!instructions.toLowerCase().includes(' years old'));

    console.log('test-alchemy-owned-tab: ok');
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
