#!/usr/bin/env node
/**
 * modules/youtubeService.js (Yozora #839) without live calls: the device sign-in, token renewal,
 * subscriptions, uploads (free channel feeds, long videos first, the API when the feeds are down), video
 * details, the merged subscriptions feed (answered from what is held, re-read by video count), favourites and the Today list, search, Watch Later and the bell import (the
 * Alchemy browser stood in for; its in-page reader run on sample page data), and the daily unit budget.
 * Google and YouTube are answered by a fake fetch.
 *
 *   node scripts/test-youtube-service.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-test-'));
process.env.YOUTUBE_ACCOUNT_FILE = path.join(tmp, 'account.json');
process.env.YOUTUBE_CACHE_FILE = path.join(tmp, 'cache.json');
process.env.YOUTUBE_USAGE_FILE = path.join(tmp, 'usage.json');
process.env.YOUTUBE_QUICKCAST_CONFIG = path.join(tmp, 'quickcast.json');
process.env.YOUTUBE_DEVICE_MIN_S = '0.05';
process.env.VIDEOS_SOURCES_FILE = path.join(tmp, 'sources.json');

const svc = require('../modules/youtubeService');
const T = svc._test;

let pass = 0;
function ok(name, fn) {
    return Promise.resolve().then(fn).then(() => { pass++; console.log(`  ok  ${name}`); }, (e) => { console.error(`  FAIL ${name}\n${e.stack}`); process.exitCode = 1; });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a fake server, Google and YouTube
const keys = { youtube: [{ clientId: 'cid.apps.googleusercontent.com', apiKey: 'secret' }] };
const kickLive = { streamer_one: true, quiet_two: false };
svc.bind({
    getApiKeyManager: () => ({ getServiceKeys: (s) => keys[s] || [], getSelectedIndex: () => 0 }),
    getConfig: () => undefined
});
const pokes = [];
svc.defineFeed({ define: (def) => ({ poke: () => pokes.push(Date.now()), def }) });

const CH = (n) => `UC${String(n).padStart(22, 'a')}`;
const VID = (n) => `v${String(n).padStart(10, '0')}`;
const calls = [];
let authorised = false;
let longListMissing = false;
let rssMode = 'ok';
const videoCount = {};
const newUpload = {};
const day = (n) => new Date(Date.UTC(2026, 10, n, 12)).toISOString();

function json(status, body) {
    return { status, ok: status === 200, json: async () => body };
}

global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const body = typeof opts.body === 'string' && opts.headers && /urlencoded/.test(opts.headers['Content-Type'] || '') ? Object.fromEntries(new URLSearchParams(opts.body)) : null;
    calls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), body });
    if (u.pathname === '/device/code') return json(200, { device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 0.05 });
    if (u.pathname === '/token') {
        if (body.grant_type === 'refresh_token') return body.refresh_token === 'r-1' ? json(200, { access_token: 'a-2', expires_in: 3600 }) : json(400, { error: 'invalid_grant' });
        return authorised ? json(200, { access_token: 'a-1', refresh_token: 'r-1', expires_in: 3600 }) : json(428, { error: 'authorization_pending' });
    }
    if (u.pathname === '/revoke') return json(200, {});
    if (u.hostname === 'id.kick.com') return body.client_secret === 'k-secret' ? json(200, { access_token: 'kick-token', expires_in: 3600 }) : json(401, {});
    if (u.hostname === 'api.kick.com') {
        if (!/kick-token/.test((opts.headers && opts.headers.Authorization) || '')) return json(401, {});
        if (u.pathname.endsWith('/users')) return json(200, { data: u.searchParams.getAll('id').map((id) => ({ user_id: Number(id), name: `Name${id}`, profile_picture: `https://files.kick.com/p${id}.webp` })) });
        return json(200, { data: u.searchParams.getAll('slug').filter((x) => x in kickLive).map((slug, i) => ({ broadcaster_user_id: 100 + Object.keys(kickLive).indexOf(slug), slug, stream_title: `${slug} title`, category: { name: 'Just Chatting' }, stream: { is_live: kickLive[slug], viewer_count: 1200, start_time: day(15), thumbnail: `https://images.kick.com/${slug}.webp` } })) });
    }
    if (u.pathname === '/feeds/videos.xml') {
        if (rssMode === 'down') return { status: 500, text: async () => 'no' };
        const pl = u.searchParams.get('playlist_id');
        if (pl.startsWith('UULF') && longListMissing) return { status: 404, text: async () => '' };
        if (pl.startsWith('UUM')) {
            const n = Number(pl.slice(-1));
            if (pl.startsWith('UUMF') && n !== 3) return { status: 404, text: async () => '' };
            return { status: 200, text: async () => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><yt:videoId>${VID(n * 10 + 8)}</yt:videoId><yt:channelId>${CH(n)}</yt:channelId><title>C${n} members video</title><author><name>Channel ${n}</name></author><published>${day(13)}</published></entry></feed>` };
        }
        const n = Number(pl.slice(-1));
        const entry = (k) => `<entry><id>yt:video:${VID(n * 10 + k)}</id><yt:videoId>${VID(n * 10 + k)}</yt:videoId><yt:channelId>${CH(n)}</yt:channelId><title>C${n} &amp; video ${k}</title><author><name>Channel ${n}</name></author><published>${day(10 + n - k * 3)}</published><media:group><media:thumbnail url="https://i2.ytimg.com/vi/x/hqdefault.jpg"/></media:group></entry>`;
        const extra = newUpload[n] ? `<entry><yt:videoId>${VID(n * 10 + 9)}</yt:videoId><yt:channelId>${CH(n)}</yt:channelId><title>C${n} new</title><author><name>Channel ${n}</name></author><published>${day(14)}</published></entry>` : '';
        return { status: 200, text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${extra}${entry(0)}${entry(1)}</feed>` };
    }
    if (u.pathname.endsWith('/channels') && u.searchParams.get('id')) return json(200, { items: u.searchParams.get('id').split(',').map((id) => ({ id, statistics: { videoCount: String(videoCount[Number(id.slice(-1))] || 2) } })) });
    if (u.pathname.endsWith('/channels')) return json(200, { items: [{ id: CH(99), snippet: { title: 'Yukimi &amp; Co', thumbnails: { default: { url: 'https://yt3.ggpht.com/me=s88' } } } }] });
    if (u.pathname.endsWith('/subscriptions')) {
        const page2 = u.searchParams.get('pageToken') === 'p2';
        const items = (page2 ? [3] : [1, 2]).map((n) => ({ contentDetails: { totalItemCount: videoCount[n] || 2 }, snippet: { title: `Channel ${n}`, resourceId: { channelId: CH(n) }, thumbnails: { default: { url: `https://yt3.ggpht.com/c${n}=s88` } } } }));
        return json(200, page2 ? { items } : { items, nextPageToken: 'p2' });
    }
    if (u.pathname.endsWith('/playlistItems')) {
        const pl = u.searchParams.get('playlistId');
        if (pl.startsWith('UULF') && longListMissing) return json(404, { error: { errors: [{ reason: 'playlistNotFound' }] } });
        const n = Number(pl.slice(-1));
        const items = [0, 1].map((k) => ({ snippet: { title: `C${n} video ${k}`, channelTitle: `Channel ${n}`, channelId: CH(n), thumbnails: { medium: { url: `https://i.ytimg.com/vi/x/${n}${k}.jpg` } } }, contentDetails: { videoId: VID(n * 10 + k), videoPublishedAt: day(10 + n - k * 3) } }));
        items.push({ snippet: { title: 'Private video' }, contentDetails: { videoId: VID(999) } });
        return json(200, { items });
    }
    if (u.pathname.endsWith('/videos')) {
        const ids = u.searchParams.get('id').split(',');
        return json(200, { items: ids.filter((id) => id !== VID(777)).map((id) => ({ id, snippet: { title: `Title ${id}`, channelTitle: 'Somebody', channelId: CH(5), publishedAt: day(1), liveBroadcastContent: 'none' }, contentDetails: { duration: 'PT1H2M3S' } })) });
    }
    if (u.pathname.endsWith('/search')) {
        return json(200, { nextPageToken: 'more', items: [
            { id: { kind: 'youtube#video', videoId: VID(500) }, snippet: { title: 'Tom &amp; Jerry&#39;s &quot;best&quot;', channelTitle: 'Cartoons', channelId: CH(7), publishedAt: day(2), thumbnails: {} } },
            { id: { kind: 'youtube#channel', channelId: CH(7) }, snippet: { title: 'Cartoons', channelTitle: 'Cartoons', thumbnails: { default: { url: 'https://yt3.ggpht.com/c7=s88' } } } }
        ] });
    }
    return json(500, {});
};
const count = (p) => calls.filter((c) => c.path.endsWith(p)).length;
const settle = async () => { let p; while ((p = T.refreshing())) { try { await p; } catch (_) { /* its own test looks */ } } };
const feedReads = () => calls.filter((c) => c.path === '/feeds/videos.xml').map((c) => c.q.playlist_id);

// the Alchemy browser, stood in for
let browserMode = 'ok';
let ytList = [VID(601), VID(602)];
const edits = [];
let ytHistory = [];
let memberOf = ['Premium Lite', 'YouTube TV'];
const watchCalls = [];
T.setBrowser({ watched: async (on, id) => {
    if (browserMode === 'offline') throw Object.assign(new Error('not running'), { code: 'ALCHEMY_OFFLINE' });
    if (browserMode === 'signedout') return { signedIn: false };
    watchCalls.push(`${on ? 'mark' : 'unmark'} ${id}`);
    const had = ytHistory.some((x) => x.id === id);
    ytHistory = ytHistory.filter((x) => x.id !== id);
    if (on) ytHistory.unshift({ id, pct: 100 });
    return on ? { signedIn: true, ok: true } : { signedIn: true, ok: had, found: had };
}, edit: async (action, id) => {
    if (browserMode === 'offline') throw Object.assign(new Error('not running'), { code: 'ALCHEMY_OFFLINE' });
    if (browserMode === 'signedout') return { signedIn: false };
    edits.push(`${action} ${id}`);
    ytList = action === 'add' ? [id, ...ytList.filter((x) => x !== id)] : ytList.filter((x) => x !== id);
    return { signedIn: true, ok: true };
}, read: async (kind) => {
    if (browserMode === 'offline') throw Object.assign(new Error('not running'), { code: 'ALCHEMY_OFFLINE' });
    if (browserMode === 'signedout') return { signedIn: false };
    if (kind === 'watch-later') return { signedIn: true, ids: [...ytList, VID(777), 'not-an-id'] };
    if (kind === 'history') return { signedIn: true, items: ytHistory.slice(), partial: false };
    if (kind === 'memberships') return { signedIn: true, names: memberOf };
    const bell = (b) => (browserMode === 'nobells' ? '' : b);
    return { signedIn: true, channels: [
        { id: CH(1), title: 'Channel 1', thumb: 'https://yt3.ggpht.com/c1=s88', bell: bell('all') },
        { id: CH(2), title: 'Channel 2', thumb: 'https://yt3.ggpht.com/c2=s88', bell: bell('all') },
        { id: CH(3), title: 'Channel 3', thumb: '', bell: bell('some') },
        { id: CH(4), title: 'Channel 4', thumb: '', bell: bell('all') },
        { id: CH(5), title: 'Channel 5', thumb: '', bell: bell('none') }
    ] };
} });

(async () => {
    await ok('helpers', () => {
        assert.strictEqual(T.seconds('PT1H2M3S'), 3723);
        assert.strictEqual(T.seconds('PT45S'), 45);
        assert.strictEqual(T.seconds('P1DT1M'), 86460);
        assert.strictEqual(T.seconds('nope'), null);
        assert.strictEqual(T.plain('Tom &amp; Jerry&#39;s &quot;x&quot; &#x41;'), 'Tom & Jerry\'s "x" A');
        assert.strictEqual(T.cleanChannel({ id: 'nope' }), null);
        assert.strictEqual(T.cleanChannel({ id: CH(1), title: 'A', thumb: 'https://evil.example/x.png' }).thumb, '');
    });

    await ok('not signed in: state says so, reads refuse', async () => {
        const s = svc.getState();
        assert.strictEqual(s.account.configured, true);
        assert.strictEqual(s.account.signedIn, false);
        assert.deepStrictEqual(s.latest.videos, []);
        await assert.rejects(svc.feed(), (e) => e.code === 'YOUTUBE_SIGNIN');
    });

    await ok('device sign-in: code, wait, linked account', async () => {
        const s = await svc.signInStart();
        assert.strictEqual(s.userCode, 'ABCD-EFGH');
        assert.strictEqual(svc.getState().account.signIn.userCode, 'ABCD-EFGH');
        assert.strictEqual((await svc.signInStart()).userCode, 'ABCD-EFGH', 'a second start keeps the running code');
        assert.strictEqual(count('/device/code'), 1);
        await wait(160);
        assert.strictEqual(svc.getState().account.signedIn, false);
        authorised = true;
        await wait(260);
        const a = svc.getState().account;
        assert.strictEqual(a.signedIn, true);
        assert.strictEqual(a.signIn, null);
        assert.strictEqual(a.account.title, 'Yukimi & Co');
        assert.ok(pokes.length >= 2, 'the feed is poked when the sign-in starts and finishes');
        const saved = JSON.parse(fs.readFileSync(process.env.YOUTUBE_ACCOUNT_FILE, 'utf8'));
        assert.strictEqual(saved.token.refreshToken, 'r-1');
        assert.strictEqual(fs.statSync(process.env.YOUTUBE_ACCOUNT_FILE).mode & 0o777, 0o600);
        assert.ok(!JSON.stringify(svc.getState()).includes('r-1'), 'no token in the state');
    });

    await ok('subscriptions: every page, held afterwards', async () => {
        const list = await svc.subscriptions();
        assert.deepStrictEqual(list.map((c) => c.title), ['Channel 1', 'Channel 2', 'Channel 3']);
        await svc.subscriptions();
        assert.strictEqual(count('/subscriptions'), 2);
    });

    await ok('feed: free channel feeds (long videos list), merged newest first, details filled', async () => {
        const f = await svc.feed();
        assert.strictEqual(f.videos.length, 6);
        assert.strictEqual(f.videos[0].id, VID(30));
        assert.strictEqual(f.videos[0].title, 'C3 & video 0');
        assert.ok(f.videos.every((v, i, a) => !i || a[i - 1].at >= v.at));
        assert.strictEqual(f.videos[0].length, 3723);
        assert.strictEqual(feedReads().length, 3);
        assert.ok(feedReads().every((pl) => pl.startsWith('UULF')));
        assert.strictEqual(count('/playlistItems'), 0, 'no quota spent on the lists');
        await svc.feed();
        assert.strictEqual(feedReads().length, 3, 'a second read comes from what is held');
        assert.strictEqual(count('/videos'), 1);
        assert.strictEqual(svc.getState().feed.at, f.at);
        await settle();
    });

    await ok('feed: answers from what is held, then reads only the channel whose video count moved', async () => {
        const units = svc.quota().used;
        calls.length = 0;
        videoCount[2] = 3;
        newUpload[2] = true;
        T.clearFeed();
        T.state().cache.subs.at = 0; // the subscriptions pass is due again
        const quick = await svc.feed();
        assert.strictEqual(quick.refreshing, true);
        assert.strictEqual(quick.videos.length, 6, 'the held list at once');
        await settle();
        assert.deepStrictEqual(feedReads(), [`UULF${CH(2).slice(2)}`], 'one channel read');
        const f = await svc.feed();
        assert.strictEqual(f.refreshing, false);
        assert.strictEqual(f.videos[0].id, VID(29));
        assert.strictEqual(f.videos.length, 7);
        assert.strictEqual(svc.quota().used - units, 3, 'two subscription pages and one details call');
        assert.ok(svc.getState().feed.at >= f.at);
        // nothing moved: the next look costs the subscriptions pass only
        calls.length = 0;
        T.clearFeed();
        T.state().cache.subs.at = 0;
        await svc.feed();
        await settle();
        assert.deepStrictEqual(feedReads(), []);
        await settle();
    });

    await ok('uploads: the API answers while the free feeds are down', async () => {
        rssMode = 'down';
        calls.length = 0;
        videoCount[3] = 5;
        T.clearFeed();
        T.state().cache.subs.at = 0;
        await svc.feed();
        await settle();
        assert.strictEqual(feedReads().length, 1, 'one failed feed read, then no more for 10 minutes');
        assert.deepStrictEqual(calls.filter((c) => c.path.endsWith('/playlistItems')).map((c) => c.q.playlistId), [`UULF${CH(3).slice(2)}`]);
        assert.strictEqual((await svc.feed()).videos.length, 7);
        rssMode = 'ok';
        T.feedsDown(0);
        await settle();
    });

    await ok('favourites and the Today list', async () => {
        await assert.rejects(svc.setFavourite({ id: 'bad' }, true), (e) => e.code === 'YOUTUBE_BAD_CHANNEL');
        await svc.setFavourite({ id: CH(2), title: 'Channel 2', thumb: 'https://yt3.ggpht.com/c2=s88' }, true);
        const favs = await svc.setFavourite({ id: CH(1), title: 'Channel 1', thumb: '' }, true);
        assert.deepStrictEqual(favs.map((f) => f.id), [CH(2), CH(1)]);
        await svc.saveSettings({ rareFirst: false });
        const s = svc.getState();
        assert.deepStrictEqual(s.latest.videos.map((v) => v.id), [VID(29), VID(20), VID(10), VID(21), VID(11)]);
        assert.strictEqual(s.latest.videos[0].length, 3723);
        assert.deepStrictEqual((await svc.orderFavourites([CH(1), CH(2)])).map((f) => f.id), [CH(1), CH(2)]);
        assert.deepStrictEqual((await svc.setFavourite({ id: CH(2) }, false)).map((f) => f.id), [CH(1)]);
        assert.deepStrictEqual(svc.getState().latest.videos.map((v) => v.id), [VID(10), VID(11)]);
        await svc.saveSettings({ rareFirst: true });
        await settle();
    });

    await ok('favourites: one unit says whether any of 50 channels uploaded; only those are read', async () => {
        await settle();
        const st = T.state();
        st.cache.subs.at = 0; // the subscriptions pass is old: the favourites ask channels.list themselves
        T.clearFeed();
        calls.length = 0;
        const units = svc.quota().used;
        videoCount[1] = 7;
        newUpload[1] = true;
        svc.getState();
        await settle();
        assert.strictEqual(calls.filter((c) => c.path.endsWith('/channels') && c.q.id).length, 1);
        assert.deepStrictEqual(feedReads(), [`UULF${CH(1).slice(2)}`]);
        assert.strictEqual(svc.getState().latest.videos[0].id, VID(19));
        assert.ok(svc.quota().used - units <= 2, 'a count call and the new video\'s details');
        calls.length = 0;
        svc.getState();
        await settle();
        assert.strictEqual(calls.length, 0, 'not again inside 15 minutes');
        newUpload[1] = false;
    });

    await ok('Today order: rare uploaders first, newest first when switched off', async () => {
        const D = 86400000;
        const now = Date.UTC(2026, 10, 15);
        const st = T.state();
        const keepF = st.acct.favourites.slice();
        const keepU = Object.assign({}, st.cache.uploads);
        const up = (ch, days) => ({ videos: days.map((d, i) => ({ id: `${ch}v${String(i).padStart(9, '0')}`, title: ch, channel: ch, channelId: ch, thumb: '', at: now - d * D })), max: 5, at: now, triedAt: now });
        st.acct.favourites.length = 0;
        st.acct.favourites.push({ id: 'daily', title: 'Daily' }, { id: 'monthly', title: 'Monthly' }, { id: 'once', title: 'Once' });
        st.cache.uploads = { daily: up('d', [0.04, 1, 2, 3, 4]), monthly: up('m', [3, 33, 64, 95]), once: up('o', [10]) };
        assert.strictEqual(T.cadenceOf(st.cache.uploads.daily.videos), D);
        assert.strictEqual(T.cadenceOf(st.cache.uploads.once.videos), 30 * D);
        assert.ok(Math.abs(T.cadenceOf(st.cache.uploads.monthly.videos) - 31 * D) < D);
        const order = T.latestVideos(now).map((v) => v.id.slice(0, 1) + Number(v.id.slice(2)));
        // an hour-old daily video leads; the monthly channel's 3-day-old one and the lone upload come before yesterday's daily
        assert.deepStrictEqual(order.slice(0, 4), ['d0', 'm0', 'o0', 'd1']);
        const m0 = T.latestVideos(now).find((v) => v.id.startsWith('mv'));
        assert.strictEqual(Math.round(m0.gap / D), 30);
        assert.strictEqual(m0.rank, undefined);
        await svc.saveSettings({ rareFirst: false });
        assert.deepStrictEqual(T.latestVideos(now).map((v) => v.id.slice(0, 1) + Number(v.id.slice(2))).slice(0, 4), ['d0', 'd1', 'd2', 'd3']);
        await svc.saveSettings({ rareFirst: true });
        st.acct.favourites.length = 0;
        st.acct.favourites.push(...keepF);
        st.cache.uploads = keepU;
    });

    await ok('channel page', async () => {
        const c = await svc.channelPage(CH(1));
        assert.strictEqual(c.channel.title, 'Channel 1');
        assert.strictEqual(c.favourite, true);
        assert.strictEqual(c.subscribed, true);
        assert.strictEqual(c.videos.length, 3);
    });

    await ok('Leave Out Shorts off reads the plain uploads list; a missing long list falls back', async () => {
        await svc.saveSettings({ noShorts: false });
        await settle();
        calls.length = 0;
        await svc.channelPage(CH(1));
        assert.ok(feedReads().includes(`UU${CH(1).slice(2)}`));
        await svc.saveSettings({ noShorts: true });
        await settle();
        longListMissing = true;
        calls.length = 0;
        const c = await svc.channelPage(CH(3));
        assert.strictEqual(c.videos.length, 2);
        assert.deepStrictEqual(feedReads().filter((pl) => pl.endsWith(CH(3).slice(2))).map((pl) => pl.slice(0, 4)), ['UULF', `UU${CH(3).slice(2, 4)}`]);
        longListMissing = false;
        await settle();
    });

    await ok('search: entities decoded, channels apart, answers held', async () => {
        const r = await svc.search('  tom  ');
        assert.strictEqual(r.videos[0].title, 'Tom & Jerry\'s "best"');
        assert.strictEqual(r.videos[0].length, 3723);
        assert.strictEqual(r.channels[0].id, CH(7));
        assert.strictEqual(r.next, 'more');
        const n = count('/search');
        await svc.search('TOM');
        assert.strictEqual(count('/search'), n);
        await assert.rejects(svc.search('  '), (e) => e.code === 'YOUTUBE_BAD_QUERY');
    });

    await ok('Watch Later: ids from the browser, details from the API, gone videos dropped', async () => {
        const w = await svc.watchLater();
        assert.strictEqual(w.unavailable, false);
        assert.deepStrictEqual(w.videos.map((v) => v.id), [VID(601), VID(602)]);
        assert.strictEqual(w.videos[0].title, `Title ${VID(601)}`);
    });

    await ok('Watch Later: says why when the browser is signed out or not running', async () => {
        browserMode = 'signedout';
        assert.deepStrictEqual(await svc.watchLater({ fresh: true }), { videos: [], unavailable: true, why: 'browser-signin', partial: false });
        browserMode = 'offline';
        assert.strictEqual((await svc.watchLater({ fresh: true })).why, 'browser-offline');
        browserMode = 'ok';
    });

    await ok('watched: the mark goes to the account\'s YouTube history; watched videos go below the rest of the feed', async () => {
        await settle();
        await svc.feed();
        await settle();
        const before = (await svc.feed()).videos.map((v) => v.id);
        const top = before[0];
        assert.deepStrictEqual(await svc.markWatched(top, true), { id: top, watched: true, youtube: 'done' });
        assert.deepStrictEqual(watchCalls, [`mark ${top}`]);
        const f = await svc.feed();
        assert.strictEqual(f.videos[f.videos.length - 1].id, top, 'the watched video is last');
        assert.strictEqual(f.videos[f.videos.length - 1].watched, true);
        assert.deepStrictEqual(f.videos.slice(0, -1).map((v) => v.id), before.slice(1), 'the rest keep their order');
        assert.ok(f.videos.slice(0, -1).every((v) => v.watched === false));
        assert.deepStrictEqual(await svc.markWatched(top, false), { id: top, watched: false, youtube: 'done' });
        assert.deepStrictEqual((await svc.feed()).videos.map((v) => v.id), before);
        await assert.rejects(svc.markWatched('nope', true), (e) => e.code === 'YOUTUBE_BAD_VIDEO');
    });

    await ok('watched: what was watched in YouTube itself shows here; a started video shows its progress', async () => {
        await svc.feed();
        await settle();
        const list = (await svc.feed()).videos.map((v) => v.id);
        assert.ok(list.length >= 6);
        ytHistory = [{ id: list[1], pct: 100 }, { id: list[2], pct: 25 }, { id: list[3], pct: 72 }];
        const fedAt = svc.getState().feed.at;
        await wait(5);
        assert.strictEqual(await T.syncHistory({ maxAge: 1 }), true);
        assert.ok(svc.getState().feed.at > fedAt, 'the program is told to take the list again');
        const f = await svc.feed();
        const by = new Map(f.videos.map((v) => [v.id, v]));
        assert.strictEqual(by.get(list[1]).watched, true);
        assert.strictEqual(by.get(list[3]).watched, true, 'played 72 %: watched');
        assert.strictEqual(by.get(list[2]).watched, false);
        assert.strictEqual(by.get(list[2]).progress, 25);
        assert.deepStrictEqual(f.videos.slice(-2).map((v) => v.id).sort(), [list[1], list[3]].sort(), 'both sit below the rest');
        assert.strictEqual(await T.syncHistory({ maxAge: 1 }), false, 'nothing changed: nothing pushed');
        // without the browser a mark is kept here, and becomes the account\'s own once the history shows it
        browserMode = 'offline';
        assert.deepStrictEqual(await svc.markWatched(list[0], true), { id: list[0], watched: true, youtube: 'browser-offline' });
        assert.ok(T.state().acct.watched[list[0]] > 0);
        browserMode = 'ok';
        ytHistory.unshift({ id: list[0], pct: 100 });
        await wait(5);
        await T.syncHistory({ maxAge: 1 });
        assert.strictEqual(T.state().acct.watched[list[0]], undefined);
        assert.strictEqual((await svc.feed()).videos.find((v) => v.id === list[0]).watched, true);
        ytHistory = [];
        await wait(5);
        await T.syncHistory({ maxAge: 1 });
        assert.ok((await svc.feed()).videos.every((v) => !v.watched));
    });

    await ok('Today: watched videos are left out; caught up when all of them were watched', async () => {
        await settle();
        const all = svc.getState().latest.videos.map((v) => v.id);
        assert.ok(all.length >= 2);
        ytHistory = [{ id: all[0], pct: 100 }, { id: all[1], pct: 20 }];
        await wait(5);
        await T.syncHistory({ maxAge: 1 });
        let l = svc.getState().latest;
        assert.deepStrictEqual(l.videos.map((v) => v.id), all.slice(1), 'the watched one is gone, the started one stays');
        assert.strictEqual(l.videos[0].progress, 20);
        assert.strictEqual(l.caughtUp, false);
        ytHistory = all.map((id) => ({ id, pct: 100 }));
        await wait(5);
        await T.syncHistory({ maxAge: 1 });
        l = svc.getState().latest;
        assert.deepStrictEqual(l, { videos: [], caughtUp: true });
        ytHistory = [];
        await wait(5);
        await T.syncHistory({ maxAge: 1 });
        assert.deepStrictEqual(svc.getState().latest.videos.map((v) => v.id), all);
    });

    await ok('members-only videos: read for the channels the account is a member of, flagged', async () => {
        await svc.feed();
        await settle();
        assert.ok(!(await svc.feed()).videos.some((v) => v.members), 'none without a membership');
        assert.ok(!feedReads().some((pl) => pl.startsWith('UUM')));
        memberOf = ['Premium Lite', 'channel 3'];
        assert.strictEqual(await T.syncMemberships({ maxAge: 1 }), true);
        T.clearFeed();
        calls.length = 0;
        await svc.feed();
        await settle();
        assert.deepStrictEqual(feedReads().filter((pl) => pl.startsWith('UUM')), [`UUMF${CH(3).slice(2)}`], 'the member channel\'s long members-only list, and no other channel\'s');
        const f = await svc.feed();
        const m = f.videos.filter((v) => v.members);
        assert.deepStrictEqual(m.map((v) => v.id), [VID(38)]);
        assert.strictEqual(m[0].title, 'C3 members video');
        assert.strictEqual(m[0].length, 3723);
        memberOf = [];
        await wait(5);
        await T.syncMemberships({ maxAge: 1 });
        T.state().cache.uploads[CH(3)].at = 0;
        T.clearFeed();
        await svc.feed();
        await settle();
        assert.ok(!(await svc.feed()).videos.some((v) => v.members), 'gone when the membership ends');
    });

    await ok('Watch Later: adding works without the browser, and goes to YouTube\'s list when it can', async () => {
        const id = (await svc.feed()).videos[0].id;
        browserMode = 'signedout';
        const a = await svc.setLater(id, true);
        assert.deepStrictEqual(a, { id, later: true, youtube: 'browser-signin' });
        assert.strictEqual((await svc.feed()).videos[0].later, true, 'flagged in the feed');
        let w = await svc.watchLater({ fresh: true });
        assert.deepStrictEqual(w.videos.map((v) => v.id), [id], 'the list kept here');
        assert.strictEqual(w.unavailable, false);
        assert.strictEqual(w.why, 'browser-signin');
        assert.deepStrictEqual(await svc.setLater(id, false), { id, later: false, youtube: 'browser-signin' });
        browserMode = 'ok';
        assert.strictEqual((await svc.setLater(id, true)).youtube, 'done');
        assert.deepStrictEqual(edits, [`add ${id}`]);
        w = await svc.watchLater({ fresh: true });
        assert.deepStrictEqual(w.videos.map((v) => v.id), [id, VID(601), VID(602)]);
        assert.ok(w.videos.every((v) => v.later));
        // removed on YouTube itself: it leaves the list here too
        ytList = ytList.filter((x) => x !== id);
        w = await svc.watchLater({ fresh: true });
        assert.deepStrictEqual(w.videos.map((v) => v.id), [VID(601), VID(602)]);
        assert.strictEqual((await svc.feed()).videos[0].later, false);
        assert.strictEqual((await svc.setLater(VID(601), false)).youtube, 'done');
        assert.deepStrictEqual((await svc.watchLater({ fresh: true })).videos.map((v) => v.id), [VID(602)]);
        ytList = [VID(601), VID(602)];
        await svc.watchLater({ fresh: true });
    });

    await ok('import: channels with the bell on All become favourites, the rest stay out', async () => {
        const before = svc.getState().favourites.map((f) => f.id);
        assert.deepStrictEqual(before, [CH(1)]);
        const r = await svc.importBellFavourites();
        assert.strictEqual(r.found, 3);
        assert.strictEqual(r.added, 2, 'one of the three was a favourite already');
        assert.deepStrictEqual(r.favourites.map((f) => f.id), [CH(1), CH(2), CH(4)]);
        assert.strictEqual((await svc.importBellFavourites()).added, 0, 'a second import adds nothing');
        browserMode = 'signedout';
        assert.strictEqual((await svc.importBellFavourites()).why, 'browser-signin');
        browserMode = 'nobells';
        await assert.rejects(svc.importBellFavourites(), (e) => e.code === 'YOUTUBE_BROWSER_SHAPE');
        browserMode = 'ok';
        await svc.setFavourite({ id: CH(2) }, false);
        await svc.setFavourite({ id: CH(4) }, false);
    });

    await ok('the in-page reader: playlist ids, bell states, signed-out pages', async () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'youtubeAlchemy.js'), 'utf8');
        const code = eval('`' + /const IN_PAGE = `([\s\S]*?)`;\n/.exec(src)[1] + '`'); // eslint-disable-line no-eval
        const sent = [];
        const page = { doc: { cookie: '' } };
        const fakeCrypto = { subtle: { digest: async () => new Uint8Array([1, 2, 3]).buffer } };
        const fakeFetch = async (url, o) => { sent.push([url, JSON.parse(o.body), o.headers.Authorization]); return { ok: true, json: async () => ({ status: 'STATUS_SUCCEEDED' }) }; };
        const run = (kind, win, loc, arg) => new Function('window', 'location', 'document', 'crypto', 'fetch', `return ${code}(${JSON.stringify(kind)}, ${JSON.stringify(arg || null)})`)(win, loc || { hostname: 'www.youtube.com', origin: 'https://www.youtube.com' }, page.doc, fakeCrypto, fakeFetch);
        const cfg = (logged) => ({ get: (k) => (k === 'LOGGED_IN' ? logged : null) });
        const bell = (cur) => ({ subscribeButtonRenderer: { notificationPreferenceButton: { subscriptionNotificationToggleButtonRenderer: { currentStateId: cur, states: [
            { stateId: 2, state: { buttonRenderer: { icon: { iconType: 'NOTIFICATIONS_ACTIVE' } } } },
            { stateId: 3, state: { buttonRenderer: { icon: { iconType: 'NOTIFICATIONS_NONE' } } } },
            { stateId: 0, state: { buttonRenderer: { icon: { iconType: 'NOTIFICATIONS_OFF' } } } }] } } } });
        const chan = (n, cur) => ({ channelRenderer: { channelId: CH(n), title: { simpleText: `Channel ${n}` }, thumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/a=s88' }, { url: '//yt3.ggpht.com/a=s176' }] }, subscribeButton: cur === null ? {} : bell(cur) } });
        assert.strictEqual(await run('bells', {}, { hostname: '' }), null, 'nothing before the page has loaded');
        assert.deepStrictEqual(await run('bells', {}, { hostname: 'accounts.google.com' }), { signedIn: false });
        assert.deepStrictEqual(await run('bells', { ytcfg: cfg(false), ytInitialData: {} }), { signedIn: false });
        const b = await run('bells', { ytcfg: cfg(true), ytInitialData: { contents: { items: [chan(1, 2), chan(2, 3), chan(3, 0), chan(4, null), chan(1, 2)] } } });
        assert.deepStrictEqual(b.channels.map((c) => c.bell), ['all', 'some', 'none', '']);
        assert.strictEqual(b.channels[0].thumb, 'https://yt3.ggpht.com/a=s176');
        const w = await run('watch-later', { ytcfg: cfg(true), ytInitialData: { side: { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: VID(900) } }, main: { playlistVideoListRenderer: { contents: [
            { playlistVideoRenderer: { videoId: VID(1) } }, { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: VID(2) } }, { playlistVideoRenderer: { videoId: VID(1) } },
            { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'more' } } } }] } } } });
        assert.deepStrictEqual(w.ids, [VID(1), VID(2)], 'the list\'s own videos, in order, not the ones beside it');
        assert.strictEqual(w.partial, true, 'a further part that could not be asked for is reported');
        // the owner's Add to / Remove from Watch Later: the page's own Save request
        const cfgIn = { get: (k) => (k === 'LOGGED_IN' ? true : k === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: '2.0' } } : null) };
        assert.deepStrictEqual(await run('later-add', { ytcfg: cfgIn, ytInitialData: {} }, null, VID(5)), { signedIn: true, ok: false }, 'no session cookie, no request');
        page.doc = { cookie: 'a=1; SAPISID=abc; b=2' };
        assert.deepStrictEqual(await run('later-add', { ytcfg: cfgIn, ytInitialData: {} }, null, VID(5)), { signedIn: true, ok: true });
        assert.deepStrictEqual(await run('later-remove', { ytcfg: cfgIn, ytInitialData: {} }, null, VID(5)), { signedIn: true, ok: true });
        assert.strictEqual(sent[0][0], '/youtubei/v1/browse/edit_playlist?prettyPrint=false');
        assert.deepStrictEqual(sent[0][1].actions, [{ action: 'ACTION_ADD_VIDEO', addedVideoId: VID(5) }]);
        assert.strictEqual(sent[0][1].playlistId, 'WL');
        assert.deepStrictEqual(sent[1][1].actions, [{ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: VID(5) }]);
        assert.ok(/^SAPISIDHASH \d+_010203$/.test(sent[0][2]));
        assert.deepStrictEqual(await run('later-add', { ytcfg: cfg(false), ytInitialData: {} }, null, VID(5)), { signedIn: false });
        page.doc = { cookie: '' };
    });

    await ok('Videos: an app\'s notifications become feed items once the app is chosen', async () => {
        const src = svc.sources();
        const note = (o) => src.takeNotification(Object.assign({ package: 'tv.twitch.android.app', app: 'Twitch', time: Date.now() }, o));
        assert.strictEqual(note({ key: 'k1', title: 'someone is live', text: 'Playing a game' }), false, 'not a chosen app: not kept');
        assert.deepStrictEqual(src.view().seenApps, [{ package: 'tv.twitch.android.app', label: 'Twitch' }], 'but offered for choosing');
        assert.deepStrictEqual(src.appsSave([{ package: 'tv.twitch.android.app' }, { package: 'not a package' }]), [{ package: 'tv.twitch.android.app', label: 'Twitch' }]);
        const at = svc.getState().feed.at;
        await wait(5);
        assert.strictEqual(note({ key: 'k1', title: 'someone is live', text: 'Playing a game' }), true);
        assert.strictEqual(note({ key: 'k1', title: 'someone is live', text: 'Playing a game' }), false, 'posted again: one item');
        assert.strictEqual(src.takeNotification({ package: 'tv.twitch.android.app', app: 'Twitch', time: Date.now(), key: 'k2', title: 'other went live', text: '', opens: true }, 'phone-1'), true);
        assert.ok(svc.getState().feed.at > at, 'the program is told to take the feed again');
        const f = await svc.feed();
        const items = f.videos.filter((v) => v.source === 'app');
        assert.deepStrictEqual(items.map((v) => v.title).sort(), ['other went live', 'someone is live']);
        assert.strictEqual(items[0].channel, 'Twitch');
        assert.strictEqual(items[0].package, 'tv.twitch.android.app');
        const opens = items.find((v) => v.title === 'other went live');
        assert.deepStrictEqual([opens.key, opens.device], ['k2', 'phone-1'], 'the phone can open what the notification opens');
        assert.strictEqual(items.find((v) => v.title === 'someone is live').key, '', 'no key when the phone did not say it opens');
        assert.ok(f.videos.findIndex((v) => v.source === 'app') === 0, 'newest first with the uploads (they are from this minute)');
        const one = items.find((v) => v.title === 'someone is live');
        assert.deepStrictEqual(await svc.markWatched(one.id, true), { id: one.id, watched: true, youtube: '' });
        const g = await svc.feed();
        assert.strictEqual(g.videos[g.videos.length - 1].id, one.id, 'a dismissed item sinks like a watched video');
        assert.strictEqual(src.noticeRemove(one.id), true);
        assert.ok(!(await svc.feed()).videos.some((v) => v.id === one.id));
        src.appsSave([]);
        assert.ok(!(await svc.feed()).videos.some((v) => v.source === 'app'), 'an app taken off the list takes its items with it');
    });

    await ok('Videos: Kick channels by name; who is live leads the feed and Today\'s live list', async () => {
        const src = svc.sources();
        await assert.rejects(src.kickAdd('streamer_one'), (e) => e.code === 'KICK_NO_KEY');
        assert.strictEqual(src.view().kickReady, false);
        keys.kick = [{ clientId: 'kick-client', apiKey: 'k-secret' }];
        await assert.rejects(src.kickAdd('bad name!'), (e) => e.code === 'KICK_BAD_NAME');
        await assert.rejects(src.kickAdd('nobody_here'), (e) => e.code === 'KICK_NOT_FOUND');
        const a = await src.kickAdd('https://kick.com/Streamer_One');
        assert.deepStrictEqual([a.channel.slug, a.channel.name, a.live], ['streamer_one', 'Name100', true]);
        assert.strictEqual((await src.kickAdd('quiet_two')).live, false);
        const f = await svc.feed();
        assert.strictEqual(f.videos[0].id, 'kick:streamer_one');
        assert.deepStrictEqual([f.videos[0].source, f.videos[0].live, f.videos[0].viewers, f.videos[0].note, f.videos[0].url], ['kick', 'live', 1200, 'Just Chatting', 'https://kick.com/streamer_one']);
        assert.strictEqual(f.videos.filter((v) => v.source === 'kick').length, 1, 'only the live one');
        const st = svc.getState();
        assert.deepStrictEqual(st.live.items.map((v) => v.id), ['kick:streamer_one']);
        assert.deepStrictEqual(st.sources.kick.map((c) => [c.slug, c.live]), [['streamer_one', true], ['quiet_two', false]]);
        // the stream ends: a later look takes it out and says so
        kickLive.streamer_one = false;
        Object.values(src._test.live()).forEach((x) => { x.tried = 0; });
        src.liveItems();
        await src._test.busy();
        assert.deepStrictEqual(svc.getState().live.items, []);
        assert.strictEqual(count('/oauth/token'), 1, 'one token for all of it');
        // the bell: told once when the channel goes live, not for a stream that was already on, not twice
        const told = [];
        src.setOnLive((c, item) => told.push(`${c.slug}:${item.title}`));
        kickLive.quiet_two = true;
        Object.values(src._test.live()).forEach((x) => { x.tried = 0; });
        src.liveItems();
        await src._test.busy();
        assert.deepStrictEqual(told, [], 'no bell, no notice');
        assert.deepStrictEqual(src.kickNotify('quiet_two', true).find((c) => c.slug === 'quiet_two').notify, true);
        Object.values(src._test.live()).forEach((x) => { x.tried = 0; });
        src.liveItems();
        await src._test.busy();
        assert.deepStrictEqual(told, [], 'already live when the bell was set: not news');
        src.kickNotify('streamer_one', true);
        kickLive.streamer_one = true;
        for (let i = 0; i < 2; i++) { Object.values(src._test.live()).forEach((x) => { x.tried = 0; }); src.liveItems(); await src._test.busy(); }
        assert.deepStrictEqual(told, ['streamer_one:streamer_one title'], 'once for the stream');
        await assert.rejects(async () => src.kickNotify('nobody_here', true), (e) => e.code === 'KICK_NOT_LISTED');
        src.kickNotify('streamer_one', false);
        src.kickNotify('quiet_two', false);
        assert.deepStrictEqual(src.kickRemove('quiet_two').map((c) => c.slug), ['streamer_one']);
    });

    await ok('the unit budget stops calls with a plain message', async () => {
        const q = svc.quota();
        assert.ok(q.used > 100 && q.used < 400, `units counted (${q.used})`);
        T.setUsage(5950);
        await assert.rejects(svc.search('something new'), (e) => e.code === 'YOUTUBE_BUDGET');
        assert.strictEqual(svc.quota().used, 5950, 'a refused call spends nothing');
        T.setUsage(q.used);
    });

    await ok('a sign-in Google ended asks to sign in again', async () => {
        T.setToken({ refreshToken: 'r-dead', accessToken: '', expiresAt: 0 });
        await assert.rejects(svc.search('needs the sign-in'), (e) => e.code === 'YOUTUBE_SIGNIN');
        assert.strictEqual(svc.getState().account.signedIn, false);
    });

    await ok('sign out forgets the token and revokes it', async () => {
        T.setToken({ refreshToken: 'r-1', accessToken: 'a-1', expiresAt: Date.now() + 3600000 });
        const s = await svc.signOut();
        assert.strictEqual(s.account.signedIn, false);
        assert.strictEqual(count('/revoke'), 1);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(process.env.YOUTUBE_ACCOUNT_FILE, 'utf8')).token, {});
    });

    await wait(2200); // the cache file's delayed save
    console.log(`\n${pass} passed${process.exitCode ? ', with failures' : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
})();
