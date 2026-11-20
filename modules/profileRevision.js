'use strict';

/**
 * The user's profile revision (#910, Yukimi Nov 20 2026): like a domain controller's copy of a roaming profile, the
 * server keeps one revision for the user's settings and desktop (user global settings, workspaces and their settings,
 * desktop shortcuts and folders, window positions, the Start menu layout, the Sidebar). Every write of one of those
 * moves it on and is pushed to every signed-in socket as `profile_changed`, so a client keeps its cached profile
 * current (public/scripts/comp/profileCache.js) without asking.
 *
 * A computer that logged on from its cached profile (the server unreachable) compares the revision its cache was taken
 * at with this one when it reconnects: different = "Your user account is out of sync with the domain controller":
 * nothing from that session is written, and the next logon takes the server's profile.
 *
 *   profile_revision            -> { revision }
 *   push profile_changed        { revision, type }   after any PROFILE_WRITES packet the handler finished
 *
 * The revision lives in .cache/profile-revision.json ({ revision, at }); "<ms>-<seq>" so two writes in one
 * millisecond still differ. A failed write may move it too: that costs at most a needless out-of-sync notice.
 */

const fs = require('fs');
const path = require('path');

let FILE = path.join(__dirname, '..', '.cache', 'profile-revision.json');

/** Packets that change the user's profile (keep in step with websocket.js USER_SETTINGS_WRITES). */
const PROFILE_WRITES = new Set([
    'update_user_global_settings',
    'workspace_update_settings', 'workspace_update_window_positions', 'workspace_update_textarea_font',
    'workspace_update_color', 'workspace_update_background_color', 'workspace_update_primary_font',
    'workspace_create', 'workspace_delete', 'workspace_rename', 'workspace_reorder',
    'desktop_add_shortcut', 'desktop_remove_shortcut', 'desktop_update_shortcut', 'desktop_update_positions',
    'desktop_update_shortcut_folders', 'desktop_create_folder_from_selection', 'desktop_create_empty_folder',
    'start_menu_save_layout', 'start_menu_reset_layout',
    'sidebar_save'
]);

let state = null;
let seq = 0;
let writing = Promise.resolve();

function load(file) {
    file = file || FILE;
    if (state) return state;
    try {
        const s = JSON.parse(fs.readFileSync(file, 'utf8'));
        state = s && typeof s.revision === 'string' ? s : null;
    } catch (_) {
        state = null;
    }
    if (!state) state = { revision: `${Date.now()}-0`, at: new Date().toISOString() };
    return state;
}

function current(file) {
    return load(file).revision;
}

/** Moves the revision on; written behind (async), one write after another. */
function bump(file) {
    file = file || FILE;
    load(file);
    seq = (seq + 1) % 1e6;
    state = { revision: `${Date.now()}-${seq}`, at: new Date().toISOString() };
    const text = JSON.stringify(state);
    writing = writing.then(() => fs.promises.mkdir(path.dirname(file), { recursive: true }))
        .then(() => fs.promises.writeFile(file + '.tmp', text))
        .then(() => fs.promises.rename(file + '.tmp', file))
        .catch((err) => console.error('[profileRevision] could not save:', err.message));
    return state.revision;
}

/**
 * After a packet's handler finished: a profile write moves the revision on and tells every socket.
 * `broadcast(msg)` sends to all signed-in clients (wsServer.broadcast).
 */
function afterPacket(type, broadcast) {
    if (!PROFILE_WRITES.has(type)) return null;
    const revision = bump();
    if (typeof broadcast === 'function') {
        try { broadcast({ type: 'profile_changed', data: { revision, type }, timestamp: new Date().toISOString() }); } catch (_) { /* a socket gone */ }
    }
    return revision;
}

/** Signed-in desktop pages only: phone pages have no desktop profile to keep (phone-power-server). */
function wantsProfile(info) {
    return !!(info && info.userType && info.userType !== 'readonly' && !(info.phone && info.phone.shell === 'mobile'));
}

/** afterPacket with the live WebSocket server's broadcast (routeMessage, agentClientBridge). */
function afterPacketOn(type, wsServer) {
    if (!PROFILE_WRITES.has(type)) return null;
    const send = wsServer && typeof wsServer.broadcast === 'function' ? (msg) => wsServer.broadcast(msg, wantsProfile) : null;
    return afterPacket(type, send);
}

/** For tests: forget the in-memory state; keep the revision in another file. */
function _reset(file) { state = null; seq = 0; if (file) FILE = file; }

module.exports = { PROFILE_WRITES, current, bump, afterPacket, afterPacketOn, wantsProfile, _reset };
