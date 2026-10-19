'use strict';

// Path-only route icons and MCP markers. Kept separate from
// test-dovecote-windows.js so these checks run even when older tray
// static asserts in that file are stale.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dovecoteJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/dovecote.js'), 'utf8');
const dovecoteCss = fs.readFileSync(path.join(__dirname, '..', 'public/css/desktop-apps/dovecote.css'), 'utf8');
const mcpFacade = fs.readFileSync(path.join(__dirname, '..', 'modules/mcpAgentFacade.js'), 'utf8');

assert.match(dovecoteJs, /id: 'spam', label: 'Spam'/);
assert.match(dovecoteJs, /Move to Spam/);
assert.match(dovecoteJs, /Not spam/);
assert.match(dovecoteJs, /spam: true/);
assert.match(dovecoteCss, /data-dove-folder="spam"/);
assert.match(dovecoteJs, /data-dove-field="spam"|'spam'/);
assert.match(dovecoteJs, /doveFormatSpamScore/);
assert.match(dovecoteJs, /doveFormatSpamAuth/);
assert.match(dovecoteJs, /dovecote-forged-badge/);
assert.match(dovecoteJs, /LANTIS_FORGED_OURS/);
assert.match(dovecoteJs, /dovecote-spam-report/);
assert.match(dovecoteCss, /dovecote-spam-report/);
assert.match(dovecoteCss, /dovecote-forged-badge/);
assert.match(dovecoteJs, /const doveBuildRouteIcon = function/);
assert.match(dovecoteJs, /dovecote-col-route/);
assert.match(dovecoteJs, /dovecote-oe-route/);
assert.match(dovecoteJs, /Delivered inside the Dreamscape network and never left it/);
assert.match(dovecoteJs, /dataset\.doveRoute/);
assert.match(dovecoteJs, /key: 'route'/);
assert.match(dovecoteJs, /mail\.fromLabel && !mail\.labelSuspicious/);
assert.match(dovecoteJs, /Originally to:/);
assert.match(dovecoteJs, /mail\.originalTo/);
assert.match(dovecoteCss, /data-dove-field="originalTo"/);
assert.match(mcpFacade, /originalTo \(trusted X-Original-To/);
assert.match(dovecoteCss, /dovecote-col-route/);
assert.match(dovecoteCss, /data-dove-route="inbound"/);
assert.match(dovecoteCss, /net-limited-16\.png/);
assert.match(dovecoteCss, /net-internet-recv-16\.png/);
assert.match(dovecoteCss, /net-internet-send-16\.png/);
assert.ok(fs.existsSync(path.join(__dirname, '..', 'public/static_images/vista-icons/net-limited-16.png')));
assert.ok(fs.existsSync(path.join(__dirname, '..', 'public/static_images/vista-icons/net-internet-recv-16.png')));
assert.ok(fs.existsSync(path.join(__dirname, '..', 'public/static_images/vista-icons/net-internet-send-16.png')));

assert.match(mcpFacade, /`external` is true for gateway inbound\/outbound mail/);
assert.match(mcpFacade, /`external` is true for gateway mail/);
assert.match(mcpFacade, /external: route !== 'internal'/);
assert.match(mcpFacade, /route === 'inbound' \|\| mail\.route === 'outbound' \? mail\.route : 'internal'/);

console.log('dovecote route UI / MCP marker tests passed');
