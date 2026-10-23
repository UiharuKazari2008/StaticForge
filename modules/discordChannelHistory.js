'use strict';

/**
 * Read-only Discord channel history from the Alchemy-owned tab.
 * Never posts, reacts, replies, types, or DMs. Cookies stay in Chromium.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const { isDiscordHost, isHttpOrBlank } = require('./alchemyOwnedTab');

const NOVELAI_GUILD_ID = '336642139381301249';
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 80;
const DEFAULT_SCROLL_GAP_MS = 1200;
const MAX_SCROLLS = 12;
const HOST_DIR = path.join(os.homedir(), '.cache', 'dreamscape-agent-client', 'discord-history');

const CHANNELS = Object.freeze([
    {
        slug: 'nai-diffusion-discussion',
        names: ['nai-diffusion-discussion', '#nai-diffusion-discussion', 'diffusion-discussion'],
        guildId: NOVELAI_GUILD_ID,
        official: true
    },
    {
        slug: 'nai-image-posting',
        names: ['nai-image-posting', '#nai-image-posting', 'image-posting'],
        guildId: NOVELAI_GUILD_ID,
        official: true
    },
    {
        slug: 'nsfw-generation',
        names: ['nsfw-generation', '#nsfw-generation'],
        guildId: NOVELAI_GUILD_ID,
        official: true
    },
    {
        slug: 'staff',
        names: ['staff', 'staff-messages', 'nai-staff', '#staff'],
        guildId: NOVELAI_GUILD_ID,
        official: true
    }
]);

function parseUrlSafe(raw) {
    try {
        return new URL(String(raw || ''));
    } catch (_) {
        return null;
    }
}

function normalizeChannelKey(raw) {
    return String(raw || '').trim().toLowerCase().replace(/^#/, '');
}

function parseDiscordChannelUrl(raw) {
    const parsed = parseUrlSafe(raw);
    if (!parsed || !isDiscordHost(parsed.href)) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'channels') return null;
    const guildId = parts[1] || '';
    const channelId = parts[2] || '';
    const messageId = parts[3] || '';
    // Guild channels only: never DMs (@me) or anything that is not a plain id.
    const id = /^\d{16,22}$/;
    if (!id.test(guildId) || !id.test(channelId) || (messageId && !id.test(messageId))) return null;
    return {
        guildId,
        channelId,
        messageId,
        url: `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ''}`
    };
}

function findCatalogChannel(raw) {
    const key = normalizeChannelKey(raw);
    if (!key) return null;
    return CHANNELS.find((row) => row.slug === key || row.names.some((name) => normalizeChannelKey(name) === key)) || null;
}

const SNOWFLAKE_RE = /^\d{16,22}$/;

function resolveChannel(input) {
    const src = input && typeof input === 'object' && !Array.isArray(input) ? input : { channel: input };
    for (const key of ['guildId', 'guild', 'messageId']) {
        if (src[key] != null && src[key] !== '' && !SNOWFLAKE_RE.test(String(src[key]))) {
            return { error: `${key} must be a Discord id (16-22 digits)` };
        }
    }
    const raw = String(src.channel || src.url || src.channelUrl || '').trim();
    if (!raw) {
        return { error: 'channel is required (name, #name, channel id, or discord.com/channels/... URL)' };
    }
    const fromUrl = parseDiscordChannelUrl(raw);
    if (fromUrl) {
        const catalog = CHANNELS.find((row) => row.channelId && row.channelId === fromUrl.channelId) || null;
        return {
            slug: catalog ? catalog.slug : fromUrl.channelId,
            guildId: fromUrl.guildId,
            channelId: fromUrl.channelId,
            messageId: fromUrl.messageId || '',
            url: fromUrl.url,
            catalog
        };
    }
    if (/^\d{16,22}$/.test(raw)) {
        const guildId = String(src.guildId || src.guild || NOVELAI_GUILD_ID);
        return {
            slug: raw,
            guildId,
            channelId: raw,
            messageId: '',
            url: `https://discord.com/channels/${guildId}/${raw}`,
            catalog: null
        };
    }
    const catalog = findCatalogChannel(raw);
    if (catalog && catalog.channelId) {
        const jump = src.messageId ? `/${src.messageId}` : '';
        return {
            slug: catalog.slug,
            guildId: catalog.guildId,
            channelId: catalog.channelId,
            messageId: src.messageId || '',
            url: `https://discord.com/channels/${catalog.guildId}/${catalog.channelId}${jump}`,
            catalog
        };
    }
    if (catalog) {
        return {
            slug: catalog.slug,
            guildId: catalog.guildId,
            channelId: catalog.channelId || '',
            messageId: src.messageId || '',
            url: catalog.guildId ? `https://discord.com/channels/${catalog.guildId}` : 'https://discord.com/channels/@me',
            catalog,
            resolveFromSidebar: true
        };
    }
    return {
        slug: normalizeChannelKey(raw) || 'channel',
        guildId: String(src.guildId || src.guild || NOVELAI_GUILD_ID),
        channelId: '',
        messageId: src.messageId || '',
        url: `https://discord.com/channels/${src.guildId || src.guild || NOVELAI_GUILD_ID}`,
        catalog: null,
        resolveFromSidebar: true,
        unofficial: true
    };
}

function looksLikeSnowflake(raw) {
    return /^\d{17,22}$/.test(String(raw || '').trim());
}

function parseTimestampMs(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
    }
    const text = String(raw).trim();
    if (!text) return null;
    if (/^\d{10}$/.test(text)) return Number(text) * 1000;
    if (/^\d{13}$/.test(text)) return Number(text);
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
}

function parseAfterCursor(input) {
    const src = input && typeof input === 'object' && !Array.isArray(input) ? input : { after: input };
    const after = src.after != null ? src.after : (src.cursor != null ? src.cursor : '');
    const afterMessageId = String(src.afterMessageId || src.after_message_id || src.messageId || '').trim();
    const afterTimestamp = src.afterTimestamp != null ? src.afterTimestamp : src.after_timestamp;
    if (afterMessageId && looksLikeSnowflake(afterMessageId)) {
        return { kind: 'messageId', messageId: afterMessageId, timestampMs: null };
    }
    const afterText = String(after || '').trim();
    if (afterText && looksLikeSnowflake(afterText)) {
        return { kind: 'messageId', messageId: afterText, timestampMs: null };
    }
    const ts = parseTimestampMs(afterTimestamp != null ? afterTimestamp : afterText);
    if (ts != null) {
        return { kind: 'timestamp', messageId: '', timestampMs: ts };
    }
    if (!afterText && !afterMessageId && afterTimestamp == null) {
        return { kind: 'none', messageId: '', timestampMs: null };
    }
    return { error: 'after must be a Discord message id or a timestamp' };
}

function messageIsAfter(message, cursor) {
    if (!cursor || cursor.kind === 'none') return true;
    if (!message) return false;
    if (cursor.kind === 'messageId') {
        try {
            return BigInt(String(message.id || '0')) > BigInt(cursor.messageId);
        } catch (_) {
            return String(message.id || '') > cursor.messageId;
        }
    }
    if (cursor.kind === 'timestamp') {
        const ms = parseTimestampMs(message.timestamp);
        if (ms == null) return false;
        return ms > cursor.timestampMs;
    }
    return false;
}

function clampLimit(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

function uniqueMessages(rows) {
    const seen = new Set();
    const out = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!row || !row.id || seen.has(row.id)) return;
        seen.add(row.id);
        out.push({
            id: String(row.id),
            author: String(row.author || ''),
            timestamp: String(row.timestamp || ''),
            content: String(row.content || ''),
            attachments: Array.isArray(row.attachments)
                ? row.attachments.map((url) => String(url || '')).filter((url) => /^https?:\/\//i.test(url))
                : []
        });
    });
    out.sort((a, b) => {
        try {
            const d = BigInt(a.id) - BigInt(b.id);
            return d > 0n ? 1 : d < 0n ? -1 : 0;
        } catch (_) {
            return a.id.localeCompare(b.id);
        }
    });
    return out;
}

function extractMessagesScript() {
    return `(function(){
        function absUrl(value) {
            if (!value) return '';
            try { return new URL(value, location.href).href; } catch (_) { return String(value); }
        }
        function attachFrom(node) {
            var urls = [];
            var seen = {};
            node.querySelectorAll('a[href], img[src], video[src], source[src]').forEach(function(el) {
                var href = absUrl(el.getAttribute('href') || el.getAttribute('src') || '');
                if (!href || seen[href]) return;
                if (!/cdn\\.discordapp\\.com|media\\.discordapp\\.net|discordapp\\.net\\/attachments/i.test(href)) return;
                seen[href] = true;
                urls.push(href);
            });
            return urls;
        }
        var items = Array.from(document.querySelectorAll('li[id^="chat-messages-"], li[class*="messageListItem"], ol[data-list-id="chat-messages"] > li'));
        var lastAuthor = '';
        var lastTime = '';
        return items.map(function(li) {
            var idAttr = li.id || li.getAttribute('data-list-item-id') || '';
            var parts = String(idAttr).split('-');
            var id = parts.length ? parts[parts.length - 1] : '';
            if (!/^\\d{16,22}$/.test(id)) {
                var contentEl = li.querySelector('[id^="message-content-"]');
                if (contentEl && contentEl.id) id = contentEl.id.replace(/^message-content-/, '');
            }
            var userEl = li.querySelector('[class*="username"], h3 [class*="headerText"] span, [data-cl-username]');
            var author = userEl && userEl.textContent ? userEl.textContent.trim() : '';
            if (author) lastAuthor = author;
            var timeEl = li.querySelector('time');
            var timestamp = timeEl && (timeEl.getAttribute('datetime') || timeEl.dateTime) ? (timeEl.getAttribute('datetime') || timeEl.dateTime) : '';
            if (timestamp) lastTime = timestamp;
            var contentEl = li.querySelector('[id^="message-content-"], [class*="messageContent"]');
            var content = contentEl ? String(contentEl.innerText || contentEl.textContent || '').trim() : '';
            return {
                id: id,
                author: author || lastAuthor,
                timestamp: timestamp || lastTime,
                content: content,
                attachments: attachFrom(li)
            };
        }).filter(function(row) { return row.id; });
    })()`;
}

function detectSessionScript() {
    return `(function(){
        var href = location.href || '';
        var text = (document.body && (document.body.innerText || '')) || '';
        var login = /\\/login/i.test(href)
            || !!document.querySelector('input[name="email"], input[name="password"], form[action*="login"]')
            || /log in|welcome back!/i.test(text.slice(0, 800));
        var messages = document.querySelectorAll('li[id^="chat-messages-"], ol[data-list-id="chat-messages"] > li').length;
        return { href: href, login: login, messages: messages, title: document.title || '' };
    })()`;
}

function findSidebarChannelScript(name) {
    return `(function(){
        var want = ${JSON.stringify(normalizeChannelKey(name))};
        var links = Array.from(document.querySelectorAll('a[href*="/channels/"]'));
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            var href = a.href || a.getAttribute('href') || '';
            var label = String(a.getAttribute('aria-label') || a.textContent || '').toLowerCase();
            var key = label.replace(/^#/, '').trim();
            if (key === want || key.indexOf(want) !== -1 || href.toLowerCase().indexOf('/' + want) !== -1) {
                try { return { href: new URL(href, location.href).href, label: label }; }
                catch (_) { return { href: href, label: label }; }
            }
        }
        return null;
    })()`;
}

function safeHistoryBasename(channel, when) {
    const slug = String(channel || 'channel').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'channel';
    const stamp = String(when || Date.now()).replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 40) || String(Date.now());
    return `${slug}-${stamp}.json`;
}

function resolveHostPath(input, slug) {
    const requested = String((input && (input.hostPath || input.host_path)) || '').trim();
    const name = safeHistoryBasename(slug, new Date().toISOString().replace(/[:.]/g, ''));
    const fallback = path.join(HOST_DIR, name);
    if (!requested) return fallback;
    const abs = path.resolve(requested);
    const root = path.resolve(HOST_DIR);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
        return { error: 'hostPath must stay under ~/.cache/dreamscape-agent-client/discord-history' };
    }
    if (abs === root) return fallback;
    return abs;
}

function writeHostFile(filePath, payload, io) {
    const mkdir = (io && io.mkdir) || ((dir) => fs.mkdirSync(dir, { recursive: true, mode: 0o700 }));
    const write = (io && io.writeFile) || ((file, text) => fs.writeFileSync(file, text, { mode: 0o600 }));
    mkdir(path.dirname(filePath));
    write(filePath, JSON.stringify(payload, null, 2));
    return filePath;
}

function sourceHasWriteAction(src) {
    const text = String(src || '');
    return /message_create|create_message|add.?reaction|reaction\.add|typingStart|\/typing|Send Message|click\\(\\).*send/i.test(text)
        || /Authorization:\s*['"]/.test(text)
        || /Bot\s+[A-Za-z0-9._-]+/.test(text);
}

async function resolveSidebarChannel(tab, channel, sleepFn, gapMs) {
    if (!channel.resolveFromSidebar) return channel;
    await sleepFn(gapMs);
    const hit = await tab.evaluate(findSidebarChannelScript(channel.slug));
    if (!hit || !hit.href || !isHttpOrBlank(hit.href) || !isDiscordHost(hit.href)) {
        return { error: `Channel ${channel.slug} was not visible in the signed-in Discord sidebar` };
    }
    const parsed = parseDiscordChannelUrl(hit.href);
    if (!parsed) return { error: `Sidebar href for ${channel.slug} was not a channel URL` };
    return {
        ...channel,
        guildId: parsed.guildId,
        channelId: parsed.channelId,
        url: parsed.messageId ? hit.href : `https://discord.com/channels/${parsed.guildId}/${parsed.channelId}`,
        resolveFromSidebar: false
    };
}

async function waitForMessages(tab, sleepFn, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 20000);
    let last = null;
    while (Date.now() < deadline) {
        last = await tab.evaluate(detectSessionScript());
        if (last && last.login) return last;
        if (last && last.messages > 0) return last;
        await sleepFn(400);
    }
    return last;
}

async function readHistory(tab, input, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const sleepFn = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const scrollGapMs = Number.isFinite(Number(opts.scrollGapMs)) ? Number(opts.scrollGapMs) : DEFAULT_SCROLL_GAP_MS;
    const maxScrolls = Number.isFinite(Number(opts.maxScrolls)) ? Number(opts.maxScrolls) : MAX_SCROLLS;
    const channel = resolveChannel(input);
    if (channel.error) return { success: false, error: channel.error };
    const cursor = parseAfterCursor(input);
    if (cursor.error) return { success: false, error: cursor.error };
    const limit = clampLimit(input && input.limit);

    let dest = channel;
    const jumpId = cursor.kind === 'messageId' ? cursor.messageId : (channel.messageId || '');
    if (dest.channelId && jumpId) {
        dest = {
            ...dest,
            url: `https://discord.com/channels/${dest.guildId}/${dest.channelId}/${jumpId}`
        };
    }

    await tab.navigate(dest.url);
    let session = await waitForMessages(tab, sleepFn, opts.sessionTimeoutMs);
    if (session && session.login) {
        return {
            success: false,
            code: 'DISCORD_NOT_SIGNED_IN',
            error: 'Alchemy tab is not signed in to Discord. Yukimi signs in once in that tab; bots never receive cookies or tokens.'
        };
    }

    if (dest.resolveFromSidebar) {
        const resolved = await resolveSidebarChannel(tab, dest, sleepFn, scrollGapMs);
        if (resolved.error) return { success: false, error: resolved.error };
        dest = resolved;
        if (jumpId && dest.channelId) {
            dest = {
                ...dest,
                url: `https://discord.com/channels/${dest.guildId}/${dest.channelId}/${jumpId}`
            };
        }
        await tab.navigate(dest.url);
        session = await waitForMessages(tab, sleepFn, opts.sessionTimeoutMs);
        if (session && session.login) {
            return {
                success: false,
                code: 'DISCORD_NOT_SIGNED_IN',
                error: 'Alchemy tab is not signed in to Discord. Yukimi signs in once in that tab; bots never receive cookies or tokens.'
            };
        }
    }

    let collected = uniqueMessages(await tab.evaluate(extractMessagesScript()));
    let scrolls = 0;
    const jumpedToMessage = !!(jumpId && dest.channelId);
    const sawBoundary = () => collected.some((row) => {
        if (cursor.kind === 'messageId') return row.id === cursor.messageId;
        if (cursor.kind === 'timestamp') return !messageIsAfter(row, cursor);
        return true;
    });
    const scrollDirection = jumpedToMessage || cursor.kind === 'none' ? 'down' : 'up';
    while (scrolls < maxScrolls) {
        const after = uniqueMessages(collected).filter((row) => messageIsAfter(row, cursor));
        if (after.length >= limit && (cursor.kind === 'none' || jumpedToMessage || sawBoundary())) break;
        if (scrollDirection === 'up' && sawBoundary() && after.length >= limit) break;
        await sleepFn(scrollGapMs);
        try {
            await tab.scroll({
                direction: scrollDirection,
                amount: 900,
                selector: 'ol[data-list-id="chat-messages"], div[data-list-id="chat-messages"], [class*="scrollerInner"]'
            });
        } catch (_) {
            await tab.scroll({ direction: scrollDirection, amount: 900 });
        }
        const more = uniqueMessages(await tab.evaluate(extractMessagesScript()));
        const beforeCount = collected.length;
        collected = uniqueMessages(collected.concat(more));
        scrolls += 1;
        if (collected.length === beforeCount) break;
    }

    const messages = uniqueMessages(collected).filter((row) => messageIsAfter(row, cursor)).slice(0, limit);
    const page = await tab.info();
    const payload = {
        success: true,
        readonly: true,
        channel: dest.slug,
        guildId: dest.guildId,
        channelId: dest.channelId,
        after: cursor,
        count: messages.length,
        scrolls,
        messages,
        page
    };

    const writeHost = !input || input.writeHost !== false;
    if (writeHost) {
        const hostPath = resolveHostPath(input, dest.slug);
        if (hostPath && hostPath.error) {
            payload.hostWrite = { ok: false, error: hostPath.error };
        } else {
            writeHostFile(hostPath, payload, opts.fs);
            payload.hostPath = hostPath;
            payload.hostWrite = { ok: true, path: hostPath };
        }
    }
    return payload;
}

module.exports = {
    NOVELAI_GUILD_ID,
    CHANNELS,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    DEFAULT_SCROLL_GAP_MS,
    MAX_SCROLLS,
    HOST_DIR,
    resolveChannel,
    findCatalogChannel,
    parseDiscordChannelUrl,
    parseAfterCursor,
    parseTimestampMs,
    messageIsAfter,
    clampLimit,
    uniqueMessages,
    extractMessagesScript,
    detectSessionScript,
    findSidebarChannelScript,
    safeHistoryBasename,
    resolveHostPath,
    writeHostFile,
    sourceHasWriteAction,
    readHistory
};
