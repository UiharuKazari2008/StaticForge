'use strict';

/**
 * Unit regression for Alchemy address-bar snap-back during slow navigations.
 * Mirrors publishLocation / endNavigating / requestNavigate navTarget behavior
 * from services/grimoire-browser/server.js without launching Chromium.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../services/grimoire-browser/server.js'), 'utf8');

function mustInclude(snippet, label) {
    if (!code.includes(snippet)) throw new Error('server.js missing ' + label);
}

mustInclude('session.navTarget', 'navTarget field');
mustInclude('livePageUrl', 'livePageUrl helper');
mustInclude("cdp.on('Page.frameNavigated'", 'mainFrameId sync');
mustInclude('session.navigating && session.navTarget && next !== session.navTarget', 'stale framenavigated guard');
mustInclude('session.navRunning && session.navTarget', 'endNavigating deferral while navigate outstanding');

// Simulate the fixed advertise + settle rules with a mock session.
function makeSession(liveUrl) {
    return {
        id: 's1',
        url: liveUrl,
        navTarget: '',
        navigating: false,
        navRunning: false,
        navSettle: null,
        title: '',
        page: { url: () => liveUrl },
        broadcasts: []
    };
}

function livePageUrl(session) {
    try {
        const current = session.page.url();
        if (/^(https?:|chrome(-extension)?:)/i.test(current)) return current;
    } catch (_) {}
    return '';
}

function broadcast(session, payload) {
    session.broadcasts.push(payload);
}

function publishLocation(session) {
    const live = livePageUrl(session);
    if (live) {
        if (session.navTarget && session.navigating && live !== session.navTarget) {
            // keep
        } else {
            session.url = live;
            if (session.navTarget && live === session.navTarget) session.navTarget = '';
        }
    }
    const url = (session.navigating && session.navTarget) || session.url || live || '';
    broadcast(session, {
        type: session.navigating ? 'navigating' : 'location',
        url,
        title: session.title || '',
        navigating: !!session.navigating
    });
}

function endNavigating(session) {
    clearTimeout(session.navSettle);
    session.navSettle = null;
    if (session.navRunning && session.navTarget) {
        const live = livePageUrl(session);
        if (!live || live !== session.navTarget) {
            session.navSettle = setTimeout(() => endNavigating(session), 2000);
            return;
        }
    }
    session.navigating = false;
    session.navTarget = '';
    publishLocation(session);
}

function beginNavigating(session) {
    session.navigating = true;
    clearTimeout(session.navSettle);
    session.navSettle = setTimeout(() => endNavigating(session), 4000);
    broadcast(session, {
        type: 'navigating',
        url: session.navTarget || session.url || '',
        title: session.title || '',
        navigating: true
    });
}

function requestNavigate(session, url) {
    session.url = url;
    session.navTarget = url;
    session.navRunning = true;
    beginNavigating(session);
}

const oldUrl = 'http://127.0.0.1:9/';
const newUrl = 'http://127.0.0.1:9/stall';
const session = makeSession(oldUrl);

requestNavigate(session, newUrl);
assert.strictEqual(session.broadcasts.at(-1).url, newUrl, 'beginNavigating advertises target');

// Stale live URL while navigate is outstanding must not snap the advertised URL.
session.page.url = () => oldUrl;
publishLocation(session);
assert.strictEqual(session.broadcasts.at(-1).url, newUrl, 'publishLocation keeps target while live lags');
assert.strictEqual(session.url, newUrl, 'session.url stays on target while navigating');

// 4s settle must not clear navigating / snap back while Page.navigate is still running.
endNavigating(session);
assert.strictEqual(session.navigating, true, 'endNavigating defers while navRunning');
assert.ok(session.navSettle, 'endNavigating re-armed settle timer');
assert.strictEqual(session.navTarget, newUrl, 'navTarget retained across deferred settle');

// Simulate commit.
session.page.url = () => newUrl;
session.navRunning = false;
session.url = newUrl;
session.navTarget = '';
session.navigating = false;
publishLocation(session);
assert.strictEqual(session.broadcasts.at(-1).url, newUrl, 'committed location keeps new URL');
assert.strictEqual(session.broadcasts.at(-1).type, 'location');

clearTimeout(session.navSettle);
console.log('grimoire nav-target ok');
