#!/usr/bin/env node
'use strict';

/**
 * Proof harness for cover-site preview (server + Alchemy session).
 * Run: node scripts/prove-cover-preview-alchemy.js
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const slug = process.argv[2] || 'harrowvale-water';

function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            const cookies = res.headers['set-cookie'] || [];
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, cookies, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function main() {
    const siteHomepage = require(path.join(root, 'modules/siteHomepageStorage'));
    const hit = siteHomepage.resolvePreviewSiteDir(root, slug);
    if (!hit) {
        console.error('FAIL: no cover site at resources/site-homepages/' + slug);
        process.exit(1);
    }
    console.log('ok site dir', hit.siteDir);

    // Use live Dreamscape globalResources from PM2 process via minimal load (no second full init if possible)
    process.env.SKIP_HTTP_LISTEN = '1';
    const gr = require(path.join(root, 'modules/globalResources'));
    await gr.initialize({ skipServerListen: true, skipMailGateway: true }).catch(() => gr.initialize());

    const preview = require(path.join(root, 'modules/siteHomepagePreview'));
    const ticket = preview.mintPreviewTicket(gr, slug);
    const previewPath = preview.previewPathForSlug(slug, ticket);
    const previewUrl = 'http://127.0.0.1:9220' + previewPath;

    const page = await httpRequest({
        hostname: '127.0.0.1',
        port: 9220,
        path: previewPath,
        method: 'GET'
    });
    if (page.status !== 200 || !/Harrow Vale|Cross-Connection|Backflow/i.test(page.body)) {
        console.error('FAIL: preview HTML', page.status, page.body.slice(0, 120));
        process.exit(1);
    }
    console.log('ok preview HTML', page.status, page.body.length, 'bytes');

    const loginPin = gr.getSecureConfig({ path: 'loginPin' });
    const loginBody = JSON.stringify({ action: 'login', data: { pin: loginPin } });
    const login = await httpRequest({
        hostname: '127.0.0.1',
        port: 9220,
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) }
    }, loginBody);
    const cookieHeader = (login.cookies || []).map((c) => c.split(';')[0]).join('; ');
    if (!cookieHeader.includes('connect.sid')) {
        console.error('FAIL: login', login.status, login.body.slice(0, 200));
        process.exit(1);
    }
    console.log('ok admin session cookie');

    const sessionBody = JSON.stringify({ url: previewUrl });
    const session = await httpRequest({
        hostname: '127.0.0.1',
        port: 9220,
        path: '/api/grimoire-browser/sessions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(sessionBody),
            Cookie: cookieHeader
        }
    }, sessionBody);

    let sessionJson;
    try {
        sessionJson = JSON.parse(session.body);
    } catch (_err) {
        console.error('FAIL: grimoire session not JSON', session.status, session.body.slice(0, 200));
        process.exit(1);
    }
    if (!sessionJson.sessionId) {
        console.error('FAIL: grimoire session', session.status, session.body.slice(0, 300));
        process.exit(1);
    }
    console.log('ok Alchemy session', sessionJson.sessionId.slice(0, 8) + '...');

    const appletPath = path.join(root, 'public/scripts/comp/siteHomepageDsapApplet.js');
    const appletSrc = fs.readFileSync(appletPath, 'utf8');
    if (appletSrc.includes('openGrimoireUrl(') || !appletSrc.includes('grimoireOpenStandaloneWindow(')) {
        console.error('FAIL: DSAP applet must call grimoireOpenStandaloneWindow, not openGrimoireUrl');
        process.exit(1);
    }
    console.log('ok DSAP source uses grimoireOpenStandaloneWindow');

    console.log('\nprove-cover-preview-alchemy: PASS');
    console.log('Preview URL (paste in desktop web shortcut / Alchemy standalone):');
    console.log(previewUrl);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
