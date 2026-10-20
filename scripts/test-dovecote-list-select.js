'use strict';

// Multi-select (Outlook-style) and cursor pagination in the Dovecote list.
// Source checks — the desktop file is browser-only.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dovecoteJs = fs.readFileSync(path.join(root, 'public/scripts/comp/desktop-apps/dovecote.js'), 'utf8');
const handlerJs = fs.readFileSync(path.join(root, 'modules/ws/handlers/250-dovecoteHandler.js'), 'utf8');
const facadeJs = fs.readFileSync(path.join(root, 'modules/mcpAgentFacade.js'), 'utf8');
const mailJs = fs.readFileSync(path.join(root, 'modules/dovecoteMail.js'), 'utf8');

function main() {
    assert.match(dovecoteJs, /selectedIds: \[\]/);
    assert.match(dovecoteJs, /const doveHandleRowActivate = function/);
    assert.match(dovecoteJs, /doveHasModifierSelect\(ev\)/);
    assert.match(dovecoteJs, /ev && ev\.shiftKey/);
    assert.match(dovecoteJs, /const doveSelectRange = function/);
    assert.match(dovecoteJs, /const doveSelectAllVisible = function/);
    assert.match(dovecoteJs, /ctrlKey \|\| ev\.metaKey\) && \(ev\.key === 'a'/);
    assert.match(dovecoteJs, /desktopDovecote\.touchMulti/);
    assert.match(dovecoteJs, /const doveWireListGestures = function/);
    assert.match(dovecoteJs, /contextMenu\._cancelTouchLongPress/);
    assert.match(dovecoteJs, /const doveMarkMailIds = async function/);
    assert.match(dovecoteJs, /ids: list/);
    assert.match(dovecoteJs, /const doveForwardSelected = async function/);
    assert.match(dovecoteJs, /const doveBuildForwardDigest = function/);
    assert.match(dovecoteJs, /Fwd: ' \+ mails\.length \+ ' messages'/);
    assert.match(dovecoteJs, /desktopDovecoteSelectedCount/);
    assert.match(dovecoteJs, /selectedCount\.className = 'indicator'/);
    assert.match(dovecoteJs, /restoreBtn\.dataset\.doveAction = 'restore'/);
    assert.match(dovecoteJs, /' · ' \+ selected \+ ' selected'/);
    assert.match(dovecoteJs, /count \+ ' messages selected\.'/);

    assert.match(dovecoteJs, /const doveLoadMoreFolder = async function/);
    assert.match(dovecoteJs, /cursor: desktopDovecote\.nextCursor/);
    assert.match(dovecoteJs, /IntersectionObserver/);
    assert.match(dovecoteJs, /folderUnread/);
    assert.match(dovecoteJs, /result\.unread/);
    assert.match(handlerJs, /cursor: message\.cursor/);
    assert.match(handlerJs, /listPageMeta/);
    assert.match(handlerJs, /inboxMeta/);
    assert.match(handlerJs, /isBatchIds/);
    assert.match(handlerJs, /markMailBatch/);
    assert.match(handlerJs, /forwardMailBatch/);
    assert.match(mailJs, /function markMailBatch/);
    assert.match(mailJs, /function listCap/);
    assert.match(mailJs, /nextCursor/);
    assert.match(facadeJs, /name: 'delete_mail'/);
    assert.match(facadeJs, /ids: \{ type: 'array'/);
    assert.match(facadeJs, /markMailBatch/);
    assert.doesNotMatch(dovecoteJs, /createElement\(['"]select['"]\)/);

    console.log('dovecote list select / pagination UI tests passed');
}

main();
