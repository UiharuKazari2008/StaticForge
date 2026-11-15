#!/usr/bin/env node
/**
 * modules/youtubeService.js (Yozora #839) without live calls: the device sign-in, token renewal,
 * subscriptions, uploads (long videos first, the plain list as fallback), video details, the merged
 * subscriptions feed, favourites and the Today list, search, Watch Later and the bell import (the
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

const svc = require('../modules/youtubeService');
const T = svc._test;

let pass = 0;
function ok(name, fn) {
    return Promise.resolve().then(fn).then(() => { pass++; console.log(`  ok  ${name}`); }, (e) => { console.error(`  FAIL ${name}\n${e.stack}`); process.exitCode = 1; });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a fake server, Google and YouTube
const keys = { youtube: [{ clientId: 'cid.apps.googleusercontent.com', apiKey: 'secret' }] };
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
    if (u.pathname.endsWith('/channels')) return json(200, { items: [{ id: CH(99), snippet: { title: 'Yukimi &amp; Co', thumbnails: { default: { url: 'https://yt3.ggpht.com/me=s88' } } } }] });
    if (u.pathname.endsWith('/subscriptions')) {
        const page2 = u.searchParams.get('pageToken') === 'p2';
        const items = (page2 ? [3] : [1, 2]).map((n) => ({ snippet: { title: `Channel ${n}`, resourceId: { channelId: CH(n) }, thumbnails: { default: { url: `https://yt3.ggpht.com/c${n}=s88` } } } }));
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

// the Alchemy browser, stood in for
let browserMode = 'ok';
T.setBrowser({ read: async (kind) => {
    if (browserMode === 'offline') throw Object.assign(new Error('not running'), { code: 'ALCHEMY_OFFLINE' });
    if (browserMode === 'signedout') return { signedIn: false };
    if (kind === 'watch-later') return { signedIn: true, ids: [VID(601), VID(602), VID(777), 'not-an-id', VID(601)].filter((v, i, a) => a.indexOf(v) === i) };
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

    await ok('feed: long videos list, merged newest first, details filled, private left out', async () => {
        const f = await svc.feed();
        assert.strictEqual(f.videos.length, 6);
        assert.strictEqual(f.videos[0].id, VID(30));
        assert.ok(f.videos.every((v, i, a) => !i || a[i - 1].at >= v.at));
        assert.strictEqual(f.videos[0].length, 3723);
        assert.ok(calls.filter((c) => c.path.endsWith('/playlistItems')).every((c) => c.q.playlistId.startsWith('UULF')));
        const n = count('/playlistItems');
        await svc.feed();
        assert.strictEqual(count('/playlistItems'), n, 'a second read comes from what is held');
        assert.strictEqual(count('/videos'), 1);
    });

    await ok('favourites and the Today list', async () => {
        await assert.rejects(svc.setFavourite({ id: 'bad' }, true), (e) => e.code === 'YOUTUBE_BAD_CHANNEL');
        await svc.setFavourite({ id: CH(2), title: 'Channel 2', thumb: 'https://yt3.ggpht.com/c2=s88' }, true);
        const favs = await svc.setFavourite({ id: CH(1), title: 'Channel 1', thumb: '' }, true);
        assert.deepStrictEqual(favs.map((f) => f.id), [CH(2), CH(1)]);
        const s = svc.getState();
        assert.deepStrictEqual(s.latest.videos.map((v) => v.id), [VID(20), VID(10), VID(21), VID(11)]);
        assert.strictEqual(s.latest.videos[0].length, 3723);
        assert.deepStrictEqual((await svc.orderFavourites([CH(1), CH(2)])).map((f) => f.id), [CH(1), CH(2)]);
        assert.deepStrictEqual((await svc.setFavourite({ id: CH(2) }, false)).map((f) => f.id), [CH(1)]);
        assert.deepStrictEqual(svc.getState().latest.videos.map((v) => v.id), [VID(10), VID(11)]);
    });

    await ok('a long favourites list is read less often, not cut short', async () => {
        assert.strictEqual(T.latestTtl(), 15 * 60000);
        const st = T.state().acct;
        const keep = st.favourites.slice();
        for (let n = 100; n < 400; n++) st.favourites.push({ id: `UC${String(n).padStart(22, 'b')}`, title: `F${n}`, thumb: '' });
        assert.ok(T.latestTtl() > 2 * 3600000 && T.latestTtl() < 3 * 3600000, `301 favourites: ${Math.round(T.latestTtl() / 60000)} min`);
        st.favourites.length = 0;
        st.favourites.push(...keep);
    });

    await ok('channel page', async () => {
        const c = await svc.channelPage(CH(1));
        assert.strictEqual(c.channel.title, 'Channel 1');
        assert.strictEqual(c.favourite, true);
        assert.strictEqual(c.subscribed, true);
        assert.strictEqual(c.videos.length, 2);
    });

    await ok('Leave Out Shorts off reads the plain uploads list; a missing long list falls back', async () => {
        await svc.saveSettings({ noShorts: false });
        calls.length = 0;
        await svc.channelPage(CH(1));
        assert.ok(calls.some((c) => c.q.playlistId === `UU${CH(1).slice(2)}`));
        await svc.saveSettings({ noShorts: true });
        longListMissing = true;
        calls.length = 0;
        const c = await svc.channelPage(CH(3));
        assert.strictEqual(c.videos.length, 2);
        assert.deepStrictEqual(calls.filter((x) => x.path.endsWith('/playlistItems')).map((x) => x.q.playlistId.slice(0, 4)), ['UULF', `UU${CH(3).slice(2, 4)}`]);
        longListMissing = false;
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
        assert.deepStrictEqual(await svc.watchLater({ fresh: true }), { videos: [], unavailable: true, why: 'browser-signin' });
        browserMode = 'offline';
        assert.strictEqual((await svc.watchLater({ fresh: true })).why, 'browser-offline');
        browserMode = 'ok';
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
        const run = (kind, win, loc) => new Function('window', 'location', 'document', 'crypto', 'fetch', `return ${code}(${JSON.stringify(kind)})`)(win, loc || { hostname: 'www.youtube.com', origin: 'https://www.youtube.com' }, { cookie: '' }, null, null);
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
        await assert.rejects(svc.channelPage(CH(2)), (e) => e.code === 'YOUTUBE_SIGNIN');
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
