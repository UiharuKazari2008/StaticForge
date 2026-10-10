#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAuthMiddleware, applyHeaderLoginKey } = require('../modules/auth');
const {
    handleGetApprovedIps,
    handleSetApprovedIps
} = require('../modules/ws/handlers/190-adminHandler');
const {
    applyApprovedIpLogin,
    matchApprovedIp,
    normalizeApprovedIpEntries,
    queryCarriesLoginKey
} = require('../modules/approvedIpAccess');

const LOGIN_KEY = 'test-login-key-not-a-real-secret';
const root = path.join(__dirname, '..');

function resources(entries, extra = {}) {
    return {
        authAuditLog: [],
        getConfig({ path: key } = {}) {
            if (key === 'approvedIps') return entries;
            if (key === 'apocrypha.trustedProxies') return ['192.168.200.121'];
            return undefined;
        },
        getSecureConfig({ path: key } = {}) {
            if (key === 'loginKey') return extra.loginKey === undefined ? LOGIN_KEY : extra.loginKey;
            return undefined;
        },
        getApplicationAuthManager() {
            return extra.applicationAuthManager || null;
        }
    };
}

function request({ remoteAddress, xff, headers = {}, query = {}, session = {}, ua = 'ApprovedIpTest/1.0' } = {}) {
    return {
        socket: { remoteAddress },
        headers: {
            'user-agent': ua,
            ...headers,
            ...(xff ? { 'x-forwarded-for': xff } : {})
        },
        query,
        session
    };
}

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

async function runAuth(gr, req) {
    const res = mockRes();
    let continued = false;
    await createAuthMiddleware(gr)(req, res, () => { continued = true; });
    return { req, res, continued };
}

function pinGate(req, pin) {
    if (req.session && req.session.authenticated) {
        return { ok: true, via: req.session.authMethod || 'session', userType: req.session.userType };
    }
    if (pin === '123456') return { ok: true, via: 'pin', userType: 'admin' };
    return { ok: false, via: 'pin' };
}

async function invokeHandler(handler, gr, userType, message, clientIP) {
    const sent = [];
    const ctx = {
        globalResources: gr,
        sendError(ws, messageText, details, requestId) {
            sent.push({ type: 'error', message: messageText, details, requestId });
        },
        sendToClient(ws, payload) {
            sent.push(payload);
        }
    };
    await handler(ctx, {}, message, { userType, clientIP, sessionId: 'sess-test' });
    return sent;
}

async function main() {
    const home = [{ id: 'home', label: 'Home', cidr: '10.0.0.5/32', enabled: true, userType: 'admin' }];

    console.log('spoofed XFF from an untrusted proxy is rejected');
    const spoofed = request({
        remoteAddress: '203.0.113.8',
        xff: '10.0.0.5',
        session: {}
    });
    const spoofedResult = applyApprovedIpLogin(spoofed, resources(home));
    assert.strictEqual(spoofedResult.applied, false);
    assert.notStrictEqual(spoofed.session.authenticated, true);
    assert.strictEqual(pinGate(spoofed, null).ok, false);
    assert.strictEqual(resources(home).authAuditLog.length, 0);

    console.log('trusted proxy uses the rightmost untrusted hop, not a spoofed left hop');
    const leftSpoof = request({
        remoteAddress: '192.168.200.121',
        xff: '10.0.0.5, 198.51.100.9',
        session: {}
    });
    assert.strictEqual(applyApprovedIpLogin(leftSpoof, resources(home)).applied, false);

    console.log('a match auto-logs-in and is audited');
    const grMatch = resources(home);
    const matched = request({
        remoteAddress: '10.0.0.5',
        xff: '198.51.100.50',
        session: {},
        ua: 'Browser/Approved'
    });
    const matchResult = applyApprovedIpLogin(matched, grMatch);
    assert.strictEqual(matchResult.applied, true);
    assert.strictEqual(matched.session.authenticated, true);
    assert.strictEqual(matched.session.userType, 'admin');
    assert.strictEqual(matched.authMethod, 'approved_ip');
    assert.strictEqual(pinGate(matched, null).ok, true);
    assert.strictEqual(pinGate(matched, null).via, 'approved_ip');
    assert.strictEqual(grMatch.authAuditLog.length, 1);
    assert.strictEqual(grMatch.authAuditLog[0].event, 'approved_ip');
    assert.strictEqual(grMatch.authAuditLog[0].ip, '10.0.0.5');
    assert.strictEqual(grMatch.authAuditLog[0].user, 'admin');
    assert.ok(grMatch.authAuditLog[0].userAgent.includes('Browser/Approved'));
    assert.notStrictEqual(grMatch.authAuditLog[0].ip, '198.51.100.50');

    console.log('trusted proxy XFF client matches');
    const viaProxy = request({
        remoteAddress: '192.168.200.121',
        xff: '10.0.0.5',
        session: {}
    });
    assert.strictEqual(applyApprovedIpLogin(viaProxy, resources(home)).applied, true);
    assert.strictEqual(viaProxy.session.userType, 'admin');

    console.log('a non-match falls through to PIN');
    const stranger = request({ remoteAddress: '198.51.100.20', session: {} });
    assert.strictEqual(applyApprovedIpLogin(stranger, resources(home)).applied, false);
    assert.strictEqual(pinGate(stranger, null).ok, false);
    assert.strictEqual(pinGate(stranger, '123456').via, 'pin');

    console.log('disabled, empty, and implied loopback do not match');
    const disabled = [{ ...home[0], enabled: false }];
    const disabledReq = request({ remoteAddress: '10.0.0.5', session: {} });
    assert.strictEqual(applyApprovedIpLogin(disabledReq, resources(disabled)).applied, false);
    const emptyReq = request({ remoteAddress: '127.0.0.1', session: {} });
    assert.strictEqual(applyApprovedIpLogin(emptyReq, resources([])).applied, false);
    assert.strictEqual(matchApprovedIp([], '127.0.0.1'), null);
    assert.strictEqual(matchApprovedIp([], '::1'), null);
    const loopbackListed = [{ id: 'lo', label: 'Loop', cidr: '127.0.0.1/32', enabled: true, userType: 'readonly' }];
    const loopReq = request({ remoteAddress: '127.0.0.1', session: {} });
    const loopResult = applyApprovedIpLogin(loopReq, resources(loopbackListed));
    assert.strictEqual(loopResult.applied, true);
    assert.strictEqual(loopReq.session.userType, 'readonly');

    console.log('IPv4-mapped IPv6 and IPv6 CIDRs match exactly');
    const mapped = request({ remoteAddress: '::ffff:10.0.0.5', session: {} });
    assert.strictEqual(applyApprovedIpLogin(mapped, resources(home)).applied, true);
    const v6 = [{ id: 'v6', label: 'Docs', cidr: '2001:db8::/64', enabled: true, userType: 'readonly' }];
    const v6req = request({ remoteAddress: '2001:db8::abcd', session: {} });
    assert.strictEqual(applyApprovedIpLogin(v6req, resources(v6)).applied, true);
    assert.strictEqual(v6req.session.userType, 'readonly');
    const outside = request({ remoteAddress: '2001:db8:1::1', session: {} });
    assert.strictEqual(applyApprovedIpLogin(outside, resources(v6)).applied, false);

    console.log('existing session is not replaced');
    const existing = request({
        remoteAddress: '10.0.0.5',
        session: { authenticated: true, userType: 'readonly' }
    });
    assert.strictEqual(applyApprovedIpLogin(existing, resources(home)).applied, false);
    assert.strictEqual(existing.session.userType, 'readonly');

    console.log('header login key downloads; query string is rejected');
    const grHeader = resources(home);
    const download = request({
        remoteAddress: '203.0.113.8',
        xff: '10.0.0.5',
        session: {},
        ua: 'Downloader/2',
        headers: { 'x-dreamscape-login-key': LOGIN_KEY }
    });
    const downloadGate = applyHeaderLoginKey(download, grHeader);
    assert.strictEqual(downloadGate.accepted, true);
    assert.strictEqual(download.authMethod, 'login_key');
    assert.strictEqual(download.session.authenticated, true);
    const headerAuth = await runAuth(grHeader, download);
    assert.strictEqual(headerAuth.continued, true);
    assert.strictEqual(headerAuth.req.userType, 'admin');
    assert.strictEqual(headerAuth.req.authMethod, 'login_key');
    assert.strictEqual(grHeader.authAuditLog.length, 1);
    assert.strictEqual(grHeader.authAuditLog[0].event, 'header_login_key');
    assert.strictEqual(grHeader.authAuditLog[0].ip, '203.0.113.8');
    assert.strictEqual(grHeader.authAuditLog[0].user, 'admin');
    assert.ok(grHeader.authAuditLog[0].userAgent.includes('Downloader/2'));
    assert.notStrictEqual(grHeader.authAuditLog[0].ip, '10.0.0.5');

    const bearer = await runAuth(resources([]), request({
        remoteAddress: '203.0.113.9',
        session: {},
        headers: { authorization: `Bearer ${LOGIN_KEY}` }
    }));
    assert.strictEqual(bearer.continued, true);
    assert.strictEqual(bearer.req.authMethod, 'login_key');

    const queryKey = await runAuth(resources([]), request({
        remoteAddress: '203.0.113.10',
        session: { authenticated: true, userType: 'admin' },
        query: { loginKey: LOGIN_KEY }
    }));
    assert.strictEqual(queryKey.continued, false);
    assert.strictEqual(queryKey.res.statusCode, 400);
    assert.strictEqual(queryKey.res.body.code, 'QUERY_AUTH_FORBIDDEN');

    const queryHeaderName = await runAuth(resources([]), request({
        remoteAddress: '203.0.113.11',
        session: {},
        query: { 'x-dreamscape-login-key': LOGIN_KEY }
    }));
    assert.strictEqual(queryHeaderName.continued, false);
    assert.strictEqual(queryHeaderName.res.statusCode, 400);
    assert.strictEqual(queryCarriesLoginKey(queryHeaderName.req), true);

    const wrong = await runAuth(resources([]), request({
        remoteAddress: '203.0.113.12',
        session: {},
        headers: { 'x-dreamscape-login-key': 'nope' }
    }));
    assert.strictEqual(wrong.continued, false);
    assert.strictEqual(wrong.res.statusCode, 403);

    const shortKey = await runAuth(resources([]), request({
        remoteAddress: '203.0.113.13',
        session: {},
        headers: { authorization: 'Bearer x' }
    }));
    assert.strictEqual(shortKey.continued, false);
    assert.strictEqual(shortKey.res.statusCode, 403);

    console.log('legacy ?auth= still works; session and app key paths stay');
    const legacy = await runAuth(resources([]), request({
        remoteAddress: '203.0.113.14',
        session: {},
        query: { auth: LOGIN_KEY }
    }));
    assert.strictEqual(legacy.continued, true);
    assert.strictEqual(legacy.req.authMethod, 'login_key');

    const sessionOnly = await runAuth(resources([]), request({
        remoteAddress: '203.0.113.15',
        session: { authenticated: true, userType: 'readonly', id: 'sess-1' }
    }));
    assert.strictEqual(sessionOnly.continued, true);
    assert.strictEqual(sessionOnly.req.userType, 'readonly');
    assert.strictEqual(sessionOnly.req.authMethod, 'session');

    const openMode = await runAuth(resources([], { loginKey: null }), request({
        remoteAddress: '203.0.113.16',
        session: {}
    }));
    assert.strictEqual(openMode.continued, true);

    const rejectedApp = await runAuth(resources([], {
        applicationAuthManager: {
            extractAuthFromRequest() {
                return { type: 'application_key', token: 'sfapp_not_real' };
            },
            async validateApplicationKey() {
                return { valid: false, message: 'nope', code: 'APP_KEY_REJECTED' };
            }
        }
    }), request({
        remoteAddress: '203.0.113.17',
        session: {},
        headers: {
            'x-staticforge-app-key': 'sfapp_not_real',
            'x-dreamscape-login-key': LOGIN_KEY
        }
    }));
    assert.strictEqual(rejectedApp.continued, false);
    assert.strictEqual(rejectedApp.res.statusCode, 403);
    assert.strictEqual(rejectedApp.res.body.code, 'APP_KEY_REJECTED');

    console.log('approved IP config is admin-only');
    let stored = [];
    const adminGr = {
        authAuditLog: [],
        getConfig({ path: key } = {}) {
            if (key === 'approvedIps') return stored;
            return undefined;
        },
        modifyConfig() {
            return {
                assign(key, value) {
                    if (key === 'approvedIps') stored = value;
                }
            };
        }
    };
    const denied = await invokeHandler(handleGetApprovedIps, adminGr, 'readonly', { requestId: 'r1' }, '10.0.0.5');
    assert.strictEqual(denied[0].type, 'error');
    assert.strictEqual(denied[0].details, 'INSUFFICIENT_PERMISSIONS');

    const deniedSet = await invokeHandler(handleSetApprovedIps, adminGr, 'readonly', {
        requestId: 'r2',
        entries: home
    }, '10.0.0.5');
    assert.strictEqual(deniedSet[0].details, 'INSUFFICIENT_PERMISSIONS');
    assert.deepStrictEqual(stored, []);

    const badCidr = await invokeHandler(handleSetApprovedIps, adminGr, 'admin', {
        requestId: 'r3',
        entries: [{ label: 'Bad', cidr: '0.0.0.0/0', enabled: true, userType: 'admin' }]
    }, '198.51.100.8');
    assert.strictEqual(badCidr[0].type, 'error');
    assert.strictEqual(badCidr[0].details, 'INVALID_APPROVED_IP');

    const saved = await invokeHandler(handleSetApprovedIps, adminGr, 'admin', {
        requestId: 'r4',
        entries: [{ label: 'Home', cidr: '10.0.0.5', enabled: true, userType: 'user' }]
    }, '10.0.0.5');
    assert.strictEqual(saved[0].data.success, true);
    assert.strictEqual(saved[0].data.matched, true);
    assert.strictEqual(saved[0].data.clientIp, '10.0.0.5');
    assert.strictEqual(stored[0].userType, 'readonly');
    assert.strictEqual(stored[0].cidr, '10.0.0.5/32');
    assert.strictEqual(stored[0].enabled, true);
    const savedAudit = adminGr.authAuditLog.filter((e) => e.event === 'approved_ips_updated');
    assert.strictEqual(savedAudit.length, 1, 'save writes one audit entry');
    assert.strictEqual(savedAudit[0].ip, '10.0.0.5');
    assert.strictEqual(savedAudit[0].actor, 'admin');
    assert.strictEqual(savedAudit[0].sessionId, 'sess-test');
    assert.strictEqual(savedAudit[0].added.length, 1);
    assert.strictEqual(savedAudit[0].added[0].cidr, '10.0.0.5/32');

    const firstId = stored[0].id;
    const changed = await invokeHandler(handleSetApprovedIps, adminGr, 'admin', {
        requestId: 'r4b',
        entries: [
            { id: firstId, label: 'Home 2', cidr: '10.0.0.6', enabled: false, userType: 'admin' },
            { label: 'Office', cidr: '192.0.2.0/24', enabled: true, userType: 'user' }
        ]
    }, '10.0.0.5');
    assert.strictEqual(changed[0].data.success, true);
    const audits = adminGr.authAuditLog.filter((e) => e.event === 'approved_ips_updated');
    const last = audits[audits.length - 1];
    assert.strictEqual(last.added.length, 1);
    assert.strictEqual(last.added[0].label, 'Office');
    assert.strictEqual(last.removed.length, 0);
    assert.strictEqual(last.changed.length, 1);
    assert.deepStrictEqual(last.changed[0].fields.sort(), ['cidr', 'enabled', 'label', 'userType']);
    assert.strictEqual(last.changed[0].before.cidr, '10.0.0.5/32');
    assert.strictEqual(last.changed[0].after.cidr, '10.0.0.6/32');
    const removedSave = await invokeHandler(handleSetApprovedIps, adminGr, 'admin', {
        requestId: 'r4c',
        entries: stored.filter((e) => e.label === 'Office')
    }, '10.0.0.5');
    assert.strictEqual(removedSave[0].data.success, true);
    const rm = adminGr.authAuditLog.filter((e) => e.event === 'approved_ips_updated').pop();
    assert.strictEqual(rm.removed.length, 1);
    assert.strictEqual(rm.removed[0].label, 'Home 2');
    // restore the single entry the rest of the test expects
    await invokeHandler(handleSetApprovedIps, adminGr, 'admin', {
        requestId: 'r4d',
        entries: [{ label: 'Home', cidr: '10.0.0.5', enabled: true, userType: 'user' }]
    }, '10.0.0.5');

    const listed = await invokeHandler(handleGetApprovedIps, adminGr, 'admin', { requestId: 'r5' }, '198.51.100.8');
    assert.strictEqual(listed[0].data.success, true);
    assert.strictEqual(listed[0].data.matched, false);
    assert.strictEqual(listed[0].data.clientIp, '198.51.100.8');
    assert.strictEqual(listed[0].data.entries.length, 1);

    const invalid = normalizeApprovedIpEntries([{ label: '', cidr: '10.0.0.5/32', enabled: true, userType: 'admin' }]);
    assert.strictEqual(invalid.ok, false);

    console.log('Security Center exposes the Approved IPs section');
    const ui = fs.readFileSync(path.join(root, 'public/scripts/comp/securityCenterDsapApplet.js'), 'utf8');
    assert.ok(!ui.includes('data-sec-tab="approved"'), 'Approved IPs is not a top-level tab');
    const authStart = ui.indexOf('id="secAuthView"');
    const authEnd = ui.indexOf('<div class="sec-view', authStart);
    const approvedAt = ui.indexOf('id="secApprovedView"');
    assert.ok(approvedAt > authStart && approvedAt < authEnd, 'Approved IPs sits inside Authentication');
    assert.ok(ui.slice(authStart, authEnd).indexOf('Application Keys') < approvedAt, 'Approved IPs is near the bottom');
    assert.ok(!/id="secApprovedView"[^>]*style=/.test(ui));
    assert.ok(ui.includes('id="secApprovedView"'));
    assert.ok(ui.includes('Signs in as'));
    assert.ok(ui.includes('X-Dreamscape-Login-Key'));
    assert.ok(ui.includes('Loopback is not included'));
    const wsClient = fs.readFileSync(path.join(root, 'public/scripts/websocket.js'), 'utf8');
    assert.ok(wsClient.includes("sendMessage('get_approved_ips'"));
    assert.ok(wsClient.includes("sendMessage('set_approved_ips'"));
    const webServer = fs.readFileSync(path.join(root, 'web_server.js'), 'utf8');
    assert.ok(webServer.includes('applyHeaderLoginKey(req, globalResources)'));
    assert.ok(webServer.includes('createApprovedIpAutoLoginMiddleware(globalResources)'));
    const handlerSrc = fs.readFileSync(path.join(root, 'modules/ws/handlers/190-adminHandler.js'), 'utf8');
    assert.ok(handlerSrc.includes("reg('get_approved_ips', handleGetApprovedIps)"));
    assert.ok(handlerSrc.includes("reg('set_approved_ips', handleSetApprovedIps"));
    const destructive = fs.readFileSync(path.join(root, 'modules/websocketHandlers.js'), 'utf8');
    assert.ok(destructive.includes("'set_approved_ips'"));

    console.log('test-approved-ips: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
