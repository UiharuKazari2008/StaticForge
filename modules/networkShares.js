/**
 * Network: other DreamOS computers in Explorer's Network folder, and the folders they share (Vista's network
 * computers and \\PC shares; DreamOS #910, Yukimi Nov 20 2026: "it should never discover itself, that being dreamos
 * or other CaféReady devices. PCs should show up in the Network folder of the sidebar, and you have to share a
 * folder like in Windows." and "Network should show all computers regardless of if there are shares").
 *
 * A DreamOS machine is an ActiveSync device (modules/cafeReadyHost.js, platform 'cafeready'); it is never a
 * portable device or a drive in Explorer. Its status carries `host.sharing` (DreamOS cafeready shares.rs):
 *   { discovery, fileSharing, shares: [{ name, comment, limit, people [{ account, level }],
 *     permissions [{ account, allow [read|change|full], deny [...] }], available }] }
 * (no local paths: nobody learns where a share lives on the machine).
 *
 * Who sees what (Vista's Network discovery and File sharing, Network and Sharing Center):
 *   - a computer is listed when it is online and its Network discovery is on, to every signed-in page but the
 *     page on that computer itself (the page's socket rides that machine's Miniport: carrier._dsDevice), and to
 *     none at all when the asking page's own machine has Network discovery off;
 *   - every listed computer shows, whether or not it shares anything (an empty \\PC is an empty view);
 *   - its shares are listed only while its File sharing is on; each with the asking user's access
 *     (none | read | change | full).
 * Access (the same rules as shares.rs, and the machine checks again): the user is the session's account
 * (administrator for an admin session, guest for the guest PIN; administrators are not a bypass, shares are
 * user-level) = min(the people level for that account or Everyone: reader = read, contributor = change, co-owner
 * / owner = full, an empty people list = full; the share permissions: allow minus deny for that account or
 * Everyone). Limit the number of simultaneous users: sessions that used the share in the last 10 minutes.
 *
 * Packets (modules/ws/handlers/317-networkSharesHandler.js):
 *   net_computers {}                 -> net_computers_response { success, self, discovery, computers [...] }; the
 *                                       socket is then sent net_computers_updated (same shape) whenever its list
 *                                       changed (computers coming and going, their sharing), never on a timer
 *   net_share_call { deviceId, share, op: list | stat | mkdir | delete | rename, path, paths, name }
 *                                    -> net_share_call_response { success, result } | { success: false, code, error }
 * Files: GET /api/activesync/file/<id>/share/<share>/<path> and POST /api/activesync/upload/<id>/begin { root:
 * 'share', dir: '/<share>/<dir>' ... } (modules/activeSyncTransfers.js) check access here (shareAccessForHttp).
 */
'use strict';

const LEVELS = ['none', 'read', 'change', 'full'];
const PEOPLE_LEVEL = { reader: 'read', contributor: 'change', coowner: 'full', owner: 'full' };
const ACCOUNTS = new Set(['administrator', 'guest', 'everyone']);
const RIGHTS = ['read', 'change', 'full'];
const RECENT_MS = 10 * 60 * 1000;
const PLATFORM = 'cafeready';
const OPS = new Set(['list', 'stat', 'mkdir', 'delete', 'rename']);
const WRITES = new Set(['mkdir', 'delete', 'rename']);

let activeSyncMod = null;
const activeSync = () => (activeSyncMod || (activeSyncMod = require('./activeSync')));
const users = new Map(); // `${deviceId}\n${share lowercased}` -> Map(sessionId -> last use)
const lastKeys = new WeakMap(); // clientInfo -> the list key it last got

function fail(code, message) {
    return Object.assign(new Error(message), { code });
}

function clamp(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

function rank(level) { return Math.max(0, LEVELS.indexOf(level)); }

/** The account a session is: administrator (an admin session) or guest (the guest PIN); null when signed out. */
function accountOf(userType) {
    if (userType === 'admin') return 'administrator';
    if (userType === 'readonly' || userType === 'guest') return 'guest';
    return null;
}

/** host.sharing from a machine's status, every field checked (cafeReadyHost.sanitizeHost keeps this). */
function sanitizeSharing(raw) {
    if (!raw || typeof raw !== 'object') return undefined;
    const rights = (list) => (Array.isArray(list) ? list.filter((r) => RIGHTS.includes(r)) : []);
    const shares = Array.isArray(raw.shares) ? raw.shares.slice(0, 200).filter((s) => s && typeof s === 'object' && clamp(s.name, 80)).map((s) => ({
        name: clamp(s.name, 80),
        comment: clamp(s.comment, 256),
        limit: Math.max(1, Math.min(20, Math.round(Number(s.limit) || 10))),
        available: s.available !== false,
        people: (Array.isArray(s.people) ? s.people : []).slice(0, 16).filter((p) => p && ACCOUNTS.has(p.account) && PEOPLE_LEVEL[p.level])
            .map((p) => ({ account: p.account, level: p.level })),
        permissions: (Array.isArray(s.permissions) ? s.permissions : []).slice(0, 16).filter((p) => p && ACCOUNTS.has(p.account))
            .map((p) => ({ account: p.account, allow: rights(p.allow), deny: rights(p.deny) }))
    })) : [];
    return { discovery: raw.discovery !== false, fileSharing: raw.fileSharing === true, shares };
}

/** The share permissions' level for an account (Advanced Sharing > Permissions: allow minus deny). */
function shareLevel(share, account) {
    const mine = (share.permissions || []).filter((p) => p.account === account || p.account === 'everyone');
    const allow = new Set();
    const deny = new Set();
    for (const p of mine) {
        for (const r of p.allow || []) allow.add(r);
        for (const r of p.deny || []) deny.add(r);
    }
    // full implies change implies read (Vista checks the lower boxes with the higher one)
    if (allow.has('full')) { allow.add('change'); allow.add('read'); }
    if (allow.has('change')) allow.add('read');
    // deny read takes everything, deny change takes change and full
    if (deny.has('read')) return 'none';
    if (deny.has('change')) { allow.delete('change'); allow.delete('full'); }
    if (deny.has('full')) allow.delete('full');
    return allow.has('full') ? 'full' : allow.has('change') ? 'change' : allow.has('read') ? 'read' : 'none';
}

/** The people's level for an account (the File Sharing wizard's list); an empty list restricts nothing. */
function peopleLevel(share, account) {
    const people = share.people || [];
    if (!people.length) return 'full';
    let best = 'none';
    for (const p of people) if ((p.account === account || p.account === 'everyone') && rank(PEOPLE_LEVEL[p.level]) > rank(best)) best = PEOPLE_LEVEL[p.level];
    return best;
}

/** none | read | change | full for this account on this share. */
function access(share, account) {
    if (!share || !account || share.available === false) return 'none';
    const a = shareLevel(share, account);
    const b = peopleLevel(share, account);
    return rank(a) < rank(b) ? a : b;
}

function serverOf(globalResources, wsServer) {
    if (wsServer) return wsServer;
    try { return globalResources && typeof globalResources.getWebSocketServer === 'function' ? globalResources.getWebSocketServer() : null; } catch (_) { return null; }
}

function socketOf(server, clientInfo) {
    if (!server || !server.clients) return null;
    for (const [ws, info] of server.clients) if (info === clientInfo) return ws;
    return null;
}

/** The DreamOS machine a page's socket runs on (it rides that machine's Miniport), else null. */
function machineOfSocket(ws) {
    const c = ws && ws.virtual ? ws.carrier : null;
    return c && c._dsMiniport && c._dsDevice ? String(c._dsDevice).toLowerCase() : null;
}

function sharingOf(device) {
    const h = device && device.status && device.status.host;
    return (h && h.sharing) || { discovery: true, fileSharing: false, shares: [] };
}

/** The DreamOS machines ActiveSync knows: [{ device, sharing }] (online or not). */
function machines(globalResources, server, listed) {
    const data = listed || activeSync().list(globalResources, server);
    return (data.devices || []).filter((d) => d.platform === PLATFORM).map((d) => ({ device: d, sharing: sharingOf(d) }));
}

/**
 * The Network folder for one page: self (this page's machine, if it is one), discovery (this machine's Network
 * discovery; true off DreamOS) and the computers it may see.
 */
function computersFor(globalResources, server, clientInfo, ws, listed) {
    const account = accountOf(clientInfo && clientInfo.userType);
    const self = machineOfSocket(ws || socketOf(server, clientInfo));
    const all = machines(globalResources, server, listed);
    const own = self ? all.find((m) => m.device.deviceId === self) : null;
    const discovery = own ? own.sharing.discovery !== false : true;
    if (!account || !discovery) return { self, discovery, computers: [] };
    const computers = all
        .filter((m) => m.device.online && m.sharing.discovery !== false && m.device.deviceId !== self)
        .map(({ device: d, sharing: s }) => ({
            deviceId: d.deviceId,
            name: d.name,
            model: d.model || '',
            os: d.os || '',
            fileSharing: s.fileSharing === true,
            // every listed computer shows, shares or not; its shares only while File sharing is on there
            shares: s.fileSharing ? s.shares.filter((x) => x.available !== false).map((x) => ({ name: x.name, comment: x.comment, access: access(x, account) })) : []
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { self, discovery, computers };
}

function keyOf(view) {
    return JSON.stringify(view);
}

/** net_computers: the list now; the socket is sent net_computers_updated from here on, when its list changes. */
function watch(globalResources, server, clientInfo, ws) {
    const view = computersFor(globalResources, server, clientInfo, ws);
    clientInfo.netWatch = true;
    lastKeys.set(clientInfo, keyOf(view));
    return view;
}

/** ActiveSync's peer list changed (activeSync.js scheduleUpdated): the pages watching Network get theirs if it moved. */
function peersChanged(globalResources, wsServer, listed) {
    const server = serverOf(globalResources, wsServer);
    if (!server || !server.clients || typeof server.sendToClient !== 'function') return;
    let any = false;
    for (const info of server.clients.values()) if (info && info.netWatch) { any = true; break; }
    if (!any) return;
    for (const [ws, info] of server.clients) {
        if (!info || !info.netWatch || !info.authenticated) continue;
        let view;
        try { view = computersFor(globalResources, server, info, ws, listed); } catch (err) { console.warn('[networkShares] list failed:', err.message); return; }
        const key = keyOf(view);
        if (lastKeys.get(info) === key) continue;
        lastKeys.set(info, key);
        try { server.sendToClient(ws, { type: 'net_computers_updated', data: { success: true, ...view }, timestamp: new Date().toISOString() }); } catch (_) { /* gone */ }
    }
}

/**
 * The share for this session, checked: the computer is listed for it (online, discovery on, not this page's own
 * machine), File sharing is on there, the share exists and the account may at least read it (write: change).
 * Returns { device, share, account, level }.
 */
function check(globalResources, server, { deviceId, shareName, userType, sessionId, self, write }) {
    const id = String(deviceId || '').toLowerCase();
    const account = accountOf(userType);
    if (!account) throw fail('NOT_AUTHENTICATED', 'Sign in first.');
    const m = machines(globalResources, server).find((x) => x.device.deviceId === id);
    if (!m || !m.device.online || m.sharing.discovery === false || (self && self === id)) throw fail('NOT_FOUND', 'Windows cannot access this computer. Check the spelling of the name.');
    if (self) {
        const own = machines(globalResources, server).find((x) => x.device.deviceId === self);
        if (own && own.sharing.discovery === false) throw fail('DISCOVERY_OFF', 'Network discovery is turned off.');
    }
    if (!m.sharing.fileSharing) throw fail('SHARING_OFF', `\\\\${m.device.name} is not accessible. File sharing is turned off on that computer.`);
    const name = clamp(shareName, 80).toLowerCase();
    const share = m.sharing.shares.find((s) => s.name.toLowerCase() === name && s.available !== false);
    if (!share) throw fail('NO_SUCH_SHARE', `\\\\${m.device.name}\\${clamp(shareName, 80)} is not accessible. The network name cannot be found.`);
    const level = access(share, account);
    if (level === 'none') throw fail('ACCESS_DENIED', `\\\\${m.device.name}\\${share.name} is not accessible. You might not have permission to use this network resource. Contact the administrator of this server to find out if you have access permissions.\n\nAccess is denied.`);
    if (write && rank(level) < rank('change')) throw fail('ACCESS_DENIED', 'You need permission to perform this action.');
    noteUser(id, share, sessionId);
    return { device: m.device, share, account, level };
}

/** Limit the number of simultaneous users: the sessions that used the share in the last 10 minutes. */
function noteUser(deviceId, share, sessionId) {
    const key = `${deviceId}\n${share.name.toLowerCase()}`;
    const now = Date.now();
    let map = users.get(key);
    if (!map) { map = new Map(); users.set(key, map); }
    for (const [s, at] of map) if (now - at > RECENT_MS) map.delete(s);
    const sid = String(sessionId || 'anonymous');
    if (!map.has(sid) && map.size >= share.limit) {
        throw fail('TOO_MANY_USERS', 'No more connections can be made to this remote computer at this time because there are already as many connections as the computer can accept.');
    }
    map.set(sid, now);
}

function who(device, account, clientInfo) {
    return `${account === 'administrator' ? 'Administrator' : 'Guest'} on ${clamp((clientInfo && clientInfo.as && clientInfo.as.name) || 'a computer', 40)} (network share)`;
}

/** net_share_call: one folder operation inside a share on another computer. */
async function shareCall(globalResources, wsServer, clientInfo, ws, data) {
    const server = serverOf(globalResources, wsServer);
    const src = data && typeof data === 'object' ? data : {};
    const op = String(src.op || '');
    if (!OPS.has(op)) throw fail('BAD_OP', 'Unknown operation.');
    const c = check(globalResources, server, {
        deviceId: src.deviceId, shareName: src.share, userType: clientInfo && clientInfo.userType,
        sessionId: clientInfo && clientInfo.sessionId, self: machineOfSocket(ws || socketOf(server, clientInfo)), write: WRITES.has(op)
    });
    const args = { root: 'share', share: c.share.name, account: c.account };
    if (op === 'delete') args.paths = (Array.isArray(src.paths) ? src.paths : [src.path]).slice(0, 500).map((p) => String(p || '').slice(0, 4096));
    else args.path = String(src.path || '/').slice(0, 4096);
    if (op === 'rename') args.name = clamp(src.name, 255);
    const result = await activeSync().serverCall(globalResources, server, c.device.deviceId, `storage.${op}`, args, { timeoutMs: 60000, fromName: who(c.device, c.account, clientInfo) });
    return { result, access: c.level };
}

/**
 * The HTTP file routes (activeSyncTransfers.js) for root 'share': the request's session against the share.
 * sharePath: '/<share>/<inside>'. Returns { device, share, account, level, inner, fromName }.
 */
function shareAccessForHttp(globalResources, req, deviceId, sharePath, write) {
    const server = serverOf(globalResources, null);
    const parts = String(sharePath || '').split('/').filter(Boolean);
    const shareName = parts.shift() || '';
    const sessionId = req.sessionId || (req.session && req.session.id) || '';
    const c = check(globalResources, server, { deviceId, shareName, userType: req.userType, sessionId, self: null, write });
    return { ...c, inner: `/${parts.join('/')}`, fromName: `${c.account === 'administrator' ? 'Administrator' : 'Guest'} (network share, ${clamp(req.ip, 40) || 'unknown'})` };
}

function resetForTests() {
    users.clear();
    activeSyncMod = null;
}

module.exports = {
    sanitizeSharing, accountOf, access, shareLevel, peopleLevel, computersFor, watch, peersChanged, shareCall,
    shareAccessForHttp, machineOfSocket, resetForTests
};
