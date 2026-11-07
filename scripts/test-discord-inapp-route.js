#!/usr/bin/env node
'use strict';
const assert = require('assert');
const vm = require('vm');
const { AlchemyOwnedTab } = require('../modules/alchemyOwnedTab');
const { readHistory } = require('../modules/discordChannelHistory');
const guild = '336642139381301249';
const channel = '111111111111111111';
const destination = `https://discord.com/channels/${guild}/${channel}`;

// Execute the actual Runtime.evaluate expressions in a DOM fixture. CDP itself is
// mocked: this never opens a browser, socket, live target, or session storage.
function fixture(options = {}) {
    let url = new URL(options.url || 'https://discord.com/channels/@me');
    let now = 1000;
    let rendered = false;
    let polls = 0;
    const calls = [], listeners = new Map(), events = [], clicks = [];
    const location = {};
    for (const key of ['href', 'origin', 'pathname', 'search', 'hash']) {
        Object.defineProperty(location, key, { get: () => url[key] });
    }
    const anchor = {
        origin: 'https://discord.com',
        getAttribute: (key) => key === 'href' ? new URL(destination).pathname : null,
        contains: () => false,
        click() {
            clicks.push(true);
            const event = { target: anchor, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            if (!options.noRouter) url = new URL(destination); // React's bubble handler
            for (const handler of listeners.get('click') || []) handler(event);
            if (!event.defaultPrevented) calls.push({ method: 'NATIVE_DOCUMENT_NAVIGATION' });
        }
    };
    const document = {
        title: 'Discord', readyState: 'complete', body: { innerText: '' },
        querySelectorAll(selector) {
            if (selector === 'a[href]') return options.link ? [anchor] : [];
            if (selector.includes('li')) return rendered ? [{}] : [];
            return [];
        },
        querySelector(selector) {
            if (selector.includes('input[name=')) return options.signedOut ? {} : null;
            polls++;
            rendered = !options.noMessages && !options.noRouter && polls >= (options.renderAfter || 1);
            return rendered ? {} : null;
        }
    };
    const context = vm.createContext({
        location, document,
        history: { state: { key: 'existing' }, pushState(state, unused, route) {
            events.push('pushState'); url = new URL(route, url);
        } },
        window: {
            addEventListener(type, handler) { listeners.set(type, [...(listeners.get(type) || []), handler]); },
            removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) || []).filter((h) => h !== handler)); },
            dispatchEvent(event) { events.push(event.type); }
        },
        PopStateEvent: class { constructor(type, init) { this.type = type; this.state = init.state; } }
    });
    const tab = new AlchemyOwnedTab({
        now: () => now, sleep: async (ms) => { now += ms; }, navTimeoutMs: 600,
        lookup: async () => [{ address: '162.159.135.232' }],
        readState: () => ({}), writeState: () => {},
        requestJson: async () => { throw new Error('must not connect'); }
    });
    tab.connection = {
        isOpen: () => true,
        async send(method, params) {
            calls.push({ method, params });
            if (method === 'Runtime.evaluate') {
                if (options.evaluateError && calls.length > 1) throw new Error('execution context unavailable');
                return { result: { value: vm.runInContext(params.expression, context) } };
            }
            if (method === 'Page.navigate') { url = new URL(params.url); return {}; }
            throw new Error(`unexpected CDP command ${method}`);
        }
    };
    return { tab, calls, events, clicks, listeners, location, polls: () => polls };
}
function noReload(f) {
    assert.deepStrictEqual(f.calls.filter((c) => c.method !== 'Runtime.evaluate'), [], 'no document navigation/reload or native anchor fallback');
}
(async () => {
    const clicked = fixture({ link: true, renderAfter: 2 });
    assert.strictEqual((await clicked.tab.navigate(destination)).url, destination);
    assert.strictEqual(clicked.clicks.length, 1);
    assert.deepStrictEqual(clicked.events, []);
    assert.ok(clicked.polls() >= 2, 'waits for message list, not just updated URL');
    assert.deepStrictEqual(clicked.listeners.get('click'), [], 'temporary default-navigation guard removed');
    noReload(clicked);

    const pushed = fixture();
    assert.strictEqual((await pushed.tab.navigate(destination)).url, destination);
    assert.deepStrictEqual(pushed.events, ['pushState', 'popstate']);
    noReload(pushed);

    const already = fixture({ url: destination });
    await already.tab.navigate(destination);
    assert.deepStrictEqual(already.events, []);
    noReload(already);

    for (const options of [{ noMessages: true }, { link: true, noRouter: true }, { noRouter: true }, { evaluateError: true }]) {
        const failed = fixture(options);
        await assert.rejects(() => failed.tab.navigate(destination), (err) => err.code === 'DISCORD_INAPP_ROUTE_FAILED');
        noReload(failed);
    }
    const external = fixture();
    await assert.rejects(() => external.tab.navigate('https://example.com/'), (err) => err.code === 'DISCORD_INAPP_ROUTE_FAILED');
    noReload(external);

    const blank = fixture({ url: 'about:blank#alchemy-owned' });
    await blank.tab.navigate(destination);
    assert.deepStrictEqual(blank.calls.filter((c) => c.method === 'Page.navigate').map((c) => c.params.url), [destination]);

    const signedOut = fixture({ signedOut: true });
    const result = await readHistory(signedOut.tab, { channel: destination, writeHost: false });
    assert.strictEqual(result.code, 'DISCORD_NOT_SIGNED_IN');
    assert.deepStrictEqual(signedOut.events, [], 'sign-in check does not route');
    assert.strictEqual(signedOut.clicks.length, 0);
    noReload(signedOut);

    const failedRead = fixture({ noMessages: true });
    const failure = await readHistory(failedRead.tab, { channel: destination, writeHost: false });
    assert.strictEqual(failure.success, false);
    assert.strictEqual(failure.code, 'DISCORD_INAPP_ROUTE_FAILED');
    noReload(failedRead);
    console.log('test-discord-inapp-route: ok (click, pushState/popstate, readiness, timeouts, no reload, sign-in, reader error)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
