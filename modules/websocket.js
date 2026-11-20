const crypto = require('crypto');
const WebSocket = require('ws');
const { PromptIndexService } = require('./promptIndexService');
const { realClientIp, trustedProxiesFromResources } = require('./clientAddress');
const {
    HEARTBEAT_INTERVAL_MS,
    createSocketHeartbeatEntry,
    reapSocketHeartbeats,
    quietWindowFor,
    watchSocketFrames,
    formatWsDisconnectLog,
    isDormantPage
} = require('./wsSocketHeartbeat');

// held for a dormant phone page: 'last' keeps the newest only, 'path' one per folder, 'all' every one in order;
// a function returns the hold key (the newest per key waits), null (send now) or false (dropped: a sleeping
// page has no use for it, and a copy delivered on waking would be stale)
const DORMANT_HOLD = new Map([
    ['ping', 'last'],
    ['claude_remote_control_status', 'last'],
    ['claude_account_login_status', 'last'],
    ['dovecote_mailbox_updated', 'last'],
    ['as_peers_updated', 'last'],
    ['runpod_pods_status_update', 'last'],
    ['browsing_sessions_changed', 'last'],
    ['runtime_compile_progress', 'last'],
    ['vfs_updated', 'path'],
    ['xlink_status', 'all'],
    ['lapis_updated', 'last'],
    ['traffic_updated', (d) => `dir:${d.direction || ''}`],
    // settings pushes (#907): the whole state each time, so the newest only
    ['traffic_settings_changed', 'last'],
    ['location_places_changed', 'last'],
    // mail accounts: sync / flags / folders / account changes wait; new mail ('new') goes at once
    ['ma_event', (d) => (d.event === 'new' ? null : `${d.event || ''}:${d.accountId || ''}`)],
    ['service_worker_cache_update', 'all'],
    ['runtime_compile_complete', 'all'],
    // state pushes (#890): the page uses only the newest
    ['queue_update', 'last'],
    ['search_indexing_status', 'last'],
    // Director's status (#890): Melaton Mobile's "Director replied" note (wmDirector noteTurns) is driven
    // by a turn starting or ending, so a status whose running turns differ from what the page last had
    // goes at once; any other (a rename, an idle shutdown) waits as the newest only
    ['director_computer_status', (d, info) => directorRunHoldKey(d, info)],
    // MCP activity (#890): the generating flag (the print indicator) and the log line wait apart, newest only
    ['mcp_activity', (d) => (d.generating === true || d.generating === false ? 'gen' : 'log')],
    // Program Icons jobs (#890 P15): each push is the job's whole state, so the newest per job
    ['wm_program_icons_job', (d) => `job:${(d && d.job && d.job.id) || ''}`],
    // Text Messaging (#890 round 5, W5): see tmEventHoldKey
    ['tm_event', (d) => tmEventHoldKey(d)],
    // the notification inbox (#890 round 5, W7): a new notice goes at once (reminders and missed notices
    // wake the page); an ack made elsewhere skips a sleeping page, which lists what changed when it wakes
    // (inbox_list since)
    ['inbox_updated', (d) => (d.reason === 'ack' ? false : null)],
    // the envelope icons' "new since last opened" (#907, messageNew.js): whole state, the newest only
    ['msg_new_state', 'last'],
    // Messaging account order and names (#978, messagingAccountPrefs.js): whole state, the newest only
    ['msg_account_prefs', 'last'],
    // weather (#890 round 5): whole-state pushes, the page keeps only the newest of each; the alert and
    // the rain alarm notifications (weather_alert_issued, weather_rain_alarm) are never held
    ['weather_rain_status', 'last'],
    ['weather_alerts_changed', 'last'],
    ['weather_places_changed', 'last'],
    // a watched place's forecast change (W1 stage 2): weatherWatch.js computes a held copy against what the
    // page had before it slept, so the newest per place is all it needs on waking
    ['weather_delta', (d) => `wx:${d.key || ''}`],
    // whole-state pushes (#890 round 5 burn-down): only the newest matters to a page that wakes
    ['traffic_settings_changed', 'last'],
    ['account_data_health_updated', 'last'],
    ['account_pictures_changed', 'last'],
    ['director_rentan_agent_default_changed', 'last'],
    ['runtime_compile_error', 'last'],
    ['workspace_css_updated', (d) => `css:${d.webPath || ''}`],
    ['app_package_updated', (d) => `pkg:${d.packageId || ''}`],
    // incremental changes (a shortcut added, a note edited): every one, in order
    ['desktop_shortcut_added', 'all'],
    ['desktop_shortcut_updated', 'all'],
    ['desktop_shortcut_removed', 'all'],
    ['desktop_positions_updated', 'all'],
    ['note_created', 'all'],
    ['note_updated', 'all'],
    ['note_deleted', 'all'],
    // a note's content changed (the page reads it again): the newest per note
    ['note_content_updated', (d) => `note:${d.noteId || ''}`],
    // a novel note's new text after a generate or undo (each push carries the whole note): the newest per note
    ['novel_updated', (d) => `novel:${d.noteId || ''}`]
]);
const DORMANT_HOLD_MAX = 300;

// tm_event subtypes that wait for a sleeping page as the newest per account (W5): the page re-reads its
// accounts / chats / settings from them, so only the last one counts
const TM_HELD_EVENTS = new Set(['account', 'resync', 'settings', 'sync', 'syncprogress', 'sendreceive']);

/**
 * DORMANT_HOLD for tm_event (#890 round 5, W5). Texts, edits, reactions, reads, new chats, pairing and a
 * lost sign-in go at once (the page wakes for its notes and badges); 'typing' never reaches a sleeping page
 * (false: an "is typing..." delivered on waking would be stale); account / resync / settings / sync /
 * syncprogress wait as the newest per account, 'reload' the newest per conversation.
 */
function tmEventHoldKey(d) {
    const ev = String((d && d.event) || '');
    if (ev === 'typing') return false;
    if (ev === 'reload') return `reload:${d.accountId || ''}:${d.chatGuid || ''}`;
    if (TM_HELD_EVENTS.has(ev)) return `${ev}:${d.accountId || ''}`;
    return null;
}

/** The turns a Director status says are running ('' when none): the key that starts or ends a turn. */
function directorRunKey(d) {
    const s = d && typeof d === 'object' ? d : {};
    const xi = s.xi && s.xi.running ? String(s.xi.sessionId || 'xi') : '';
    return `${s.running ? String(s.sessionId || 'run') : ''}|${xi}`;
}

/** DORMANT_HOLD for director_computer_status: null (send now) when the running turns changed. */
function directorRunHoldKey(d, info) {
    const key = directorRunKey(d);
    if (!info) return 'last';
    const had = info.dormantDirectorRun;
    info.dormantDirectorRun = key;
    return had === undefined || had === key ? 'last' : null;
}

// notices a phone gets batched (WebSocketServer.broadcast): small, frequent, nothing waits on them
const PHONE_BATCH_TYPES = new Set(['vfs_updated']);
const PHONE_BATCH_MS = 10000;

// Broadcasts only the desktop reads (#890), never sent to a Melaton Mobile page (agentClientBridge
// info.phone). Each was checked against the phone's scripts: their only readers are desktop programs
// (Server Manager, the MMC quips and SideShow pages, DSAP replication applets, the Novel window, the
// desktop's save tray icon, the print queue tray icon, which printQueue.js never shows on the phone) or
// nothing at all (config_checkpoint_restored, packages_updated). A phone's DeX window is a desktop page
// and gets them. Kept for the phone: mcp_activity (the generating flag), desktop_shortcut_* and
// desktop_positions_updated (the phone's file explorer lists the desktop's shortcuts from the same store),
// autofill_ranking_updated (the phone's SmartText), generation_quips_updated (a failed run shows
// "Generate Quips Failed" on the phone too: generationQuipsTray.js handleGenerationQuipsClientUpdate;
// progress and status only feed the desktop's tray icon and MMC page, whose runs only they start).
const DESKTOP_ONLY_TYPES = new Set([
    'runtime_compile_logs',
    // the user's profile moved on (modules/profileRevision.js, #910): desktops refresh their cached profile; a phone
    // page has no desktop profile, and a sleeping one needs nothing held (its next logon reads the server's)
    'profile_changed',
    // the Media Player library changed (modules/mediaLibrary.js, #956): only desktop pages run Media Player
    'media_library_changed',
    'generation_quips_progress', 'generation_quips_status',
    'print_queue_state',
    'replication_progress', 'replication_maintenance', 'replication_sync_status', 'replication_sync_complete', 'replication_separation_done',
    'novel_progress',
    'workspace_desktop_persisted',
    'devices_updated', 'device_screen_updated',
    'config_checkpoint_restored',
    'packages_updated',
    // #890 round 5: Windows Sidebar (vistaSidebar.js, desktop shell only)
    'sidebar_updated',
    // #922: the Key Manager console, Client Certificates store (mmcAppKeys.js, MMC: desktop only)
    'client_cert_changed',
    // #932: the order of the notification area icons (trayOrder.js, the desktop taskbar only)
    'desktop_tray_order_changed'
]);

// Broadcasts only Melaton Mobile reads (its programs load in the mobile shell only: app.html
// data-shell="mobile"), never sent to a page that reported a desktop (a desktop tab, a DeX window).
// A page that has not said which it is yet still gets them.
// #890 round 5: Traffic's settings and leave-time reports (wmTraffic.js), the notification inbox
// (wmNotificationInbox.js) - all mobile-shell only. #907: msg_new_state (wmShell.js envelope icons).
const PHONE_ONLY_TYPES = new Set([
    'lapis_updated', 'lapis_notice', 'traffic_updated',
    'traffic_settings_changed', 'traffic_report',
    'inbox_updated', 'msg_new_state',
    // Claude Accounts (wmClaudeAccounts.js): Remote Control reconnecting / connected / error, admins only
    'claude_remote_control_status', 'claude_account_login_status'
]);
// Broadcasts every socket gets on purpose (#890, rule phone-power-server.mdc): a new broadcast type goes in
// exactly one of DESKTOP_ONLY_TYPES / PHONE_ONLY_TYPES / BROADCAST_ALL (and in DORMANT_HOLD when a sleeping
// phone or DeX window should get only the newest). scripts/check-perf-rules.js reads these lists and fails a
// file that broadcasts a type none of them names (unclassified-broadcast).
// Each was checked against both shells' scripts (#890 round 5): the shared inbound handlers
// (public/scripts/ws/handlers, appWebSocketHandlers.js) or a script loaded in both shells reads it.
//  - notifications and errors: receipt_notification, agent_notice, system_message, config_refresh_error,
//    runtime_compile_error, weather_alert_issued, weather_rain_alarm (weatherAlerts.js), cursor_account_login_complete
//    (walletTray.js, which the phone's Account Manager wmAccounts.js drives too)
//  - state: account_data_health_updated, account_pictures_changed (meletonAccounts.js), app_package_updated
//    (melatonApps.js live updates), director_rentan_agent_default_changed (dynamicGenerationManager.js),
//    workspace_css_updated, weather_rain_status / weather_alerts_changed / weather_places_changed (wmWeather.js,
//    the phone's Weather and the desktop's Weather window)
//  - lists both shells show: desktop_shortcut_*, desktop_positions_updated, note_* (wmNotes.js and the
//    desktop's Notes), gallery_updated (wmTodayWidgets.js reads append_top), workspace_image_added,
//    dynamic_generation_progress_update
//  - per-account events filtered by subtype at the source: tm_event (textMessaging.js), ma_event (mailAccounts.js)
const BROADCAST_ALL = new Set([
    'receipt_notification', 'agent_notice', 'system_message', 'config_refresh_error', 'runtime_compile_error',
    'weather_alert_issued', 'weather_rain_alarm', 'cursor_account_login_complete',
    'account_data_health_updated', 'account_pictures_changed', 'app_package_updated',
    'director_rentan_agent_default_changed', 'workspace_css_updated',
    'weather_rain_status', 'weather_alerts_changed', 'weather_places_changed',
    'desktop_shortcut_added', 'desktop_shortcut_updated', 'desktop_shortcut_removed', 'desktop_positions_updated',
    'note_created', 'note_updated', 'note_deleted', 'note_content_updated',
    'gallery_updated', 'workspace_image_added', 'dynamic_generation_progress_update',
    'tm_event', 'ma_event',
    // Messaging account order and names (#978): Messaging on the phone, mail and Messenger on the desktop
    'msg_account_prefs',
    // location_places_changed (#907): Home / Work for wmLocation, which desktop pages (Weather, backgrounds) load too
    'location_places_changed',
    // novelManager.js loads in both shells: the desktop Novel window and the phone Dream Studio Rentan
    // novel view (studioModelRentan.js watchNovel) refresh an open note from it
    'novel_updated',
    // #922: the CRL moved, sent only to sessions a client certificate opened (the filter at the source);
    // a revoked phone must hear it asleep too, so it is not held
    'client_cert_crl'
]);
void BROADCAST_ALL;

/** A Melaton Mobile page (it said so in client_desktop_state). */
function isPhonePage(info) {
    return !!(info && info.phone && info.phone.shell === 'mobile');
}

/**
 * A page running the desktop shell: a desktop tab or a phone's DeX window. Only that shell reports
 * 'desktop' or 'logon' (agentClientBridge.js computeDesktopState); a phone page says 'booting' /
 * 'ready' / 'locked', and may say so before its phone state is known, so those never count here.
 */
function isDesktopPage(info) {
    return !!(info && !info.phone && (info.desktopState === 'desktop' || info.desktopState === 'logon'));
}

/**
 * Whether a broadcast (or a message to a whole session) of this type goes to this socket at all.
 *  - The Android app's background link (ActiveSync speaker 'service') reads no broadcast: only its
 *    replies, as_request / as_event / miniport_ring / as_credits, all sent to it directly.
 *  - A light socket (?light=1, the app's widgets and screen saver) gets only the types it subscribed to.
 *  - DESKTOP_ONLY_TYPES skip phone pages, PHONE_ONLY_TYPES skip desktop pages.
 * sessionWide: sendToUser (no per-shell type filter; only the native sockets are left out).
 */
function socketWantsBroadcast(info, type, sessionWide = false) {
    if (!info) return true;
    if (info.as && info.as.speaker === 'service') return false;
    if (info.light) return !!(type && info.lightSubs && info.lightSubs.has(type));
    if (sessionWide || !type) return true;
    if (DESKTOP_ONLY_TYPES.has(type) && isPhonePage(info)) return false;
    if (PHONE_ONLY_TYPES.has(type) && isDesktopPage(info)) return false;
    return true;
}

// Fields of the ping that move with the clock, not with news (#890): they ride along on the next
// real change. novelaiStatus.fetchedAt (every status.novelai.net read), accountSubscriptionLastRefreshAt
// (every subscription refresh), queue_status's counters and countdowns (they decay as time passes;
// queue_update still carries every change of in5min / in15min, startQueueStatusInterval).
const PING_QUEUE_CLOCKS = ['sinceLast', 'nextAllowed', 'in5min', 'in15min'];

/** The ping's status without its clock: two reads with the same key carry the same news. */
function pingStatusKey(data) {
    if (!data || typeof data !== 'object') return JSON.stringify(data);
    const { server_time: _t, ...rest } = data;
    // queue_status.sinceLast is the read's own clock as well
    if (rest.queue_status && typeof rest.queue_status === 'object') {
        const q = { ...rest.queue_status };
        for (const k of PING_QUEUE_CLOCKS) delete q[k];
        rest.queue_status = q;
    }
    if (rest.novelaiStatus && typeof rest.novelaiStatus === 'object') {
        const { fetchedAt: _f, ...n } = rest.novelaiStatus;
        rest.novelaiStatus = n;
    }
    if (rest.accountHealth && typeof rest.accountHealth === 'object') {
        const { accountSubscriptionLastRefreshAt: _r, ...h } = rest.accountHealth;
        rest.accountHealth = h;
    }
    try { return JSON.stringify(rest); } catch (_) { return String(Date.now()); }
}

/** ?name=value on a socket's request URL ('' when absent). */
function requestQuery(req, name) {
    try {
        const url = String((req && req.url) || '');
        const q = url.indexOf('?');
        return q < 0 ? '' : (new URLSearchParams(url.slice(q + 1)).get(name) || '');
    } catch (_) {
        return '';
    }
}

class WebSocketServer {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('WebSocketServer requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        const server = globalResources.getHttpServer();
        this.sessionStore = globalResources.getSessionStore();
        
        // permessage-deflate for messages over 1 KB: get_app_options is ~190 KB of JSON and
        // deflates to ~42 KB; on a slow VPN link the uncompressed copy outran its logon
        // timeout (Yozora #516). Small messages (pings, status) go out as they are.
        this.wss = new WebSocket.Server({
            server,
            perMessageDeflate: {
                threshold: 1024,
                zlibDeflateOptions: { level: 6 },
                concurrencyLimit: 10
            }
        });
        this.clients = new Map(); // Map to store client connections with user info
        this.heartbeatInterval = null;
        this.queueStatusInterval = null;
        this.indexingSyncInterval = null;
        this.isIndexing = false;
        this.indexingPaused = false; // Track if indexing is paused
        this.promptIndexService = new PromptIndexService(globalResources);
        this.promptIndexService.setWsServer(this);
        this.runtimeCompileProgressByClient = new Map();
        this.runtimeCompileLogsByClient = new Map();
        this.setupWebSocket();
        this.setupPlumbingSubscriptions();
        this.startIndexingSync();
        this.startSocketHeartbeat();
    }
    
    /**
     * Set up plumbing subscriptions for WebSocket broadcasts
     * This allows other modules to trigger broadcasts without requiring websocket module
     */
    setupPlumbingSubscriptions() {
        try {
            const plumbing = this.globalResources.getDataPlumbing();
            
            // Subscribe to receipt notification broadcasts
            plumbing.subscribe('ws:broadcast:receipt', (receipt) => {
                this.broadcast({
                    type: 'receipt_notification',
                    receipt: receipt
                });
            });
            
            // Subscribe to queue status broadcasts - directly broadcast queue status from globalResources
            plumbing.subscribe('ws:broadcast:queueStatus', () => {
                try {
                    const queueStatus = this.globalResources.getQueue().getStatus();
                    this.broadcastQueueUpdate(queueStatus);
                } catch (error) {
                    console.warn('⚠️ Failed to get queue status from globalResources:', error.message);
                }
            });
            
            // Subscribe to workspace image addition broadcasts
            plumbing.subscribe('ws:broadcast:workspaceImageAdded', (data) => {
                const { workspaceId, imageFilenames } = data;
                
                this.broadcastWorkspaceImageAdded(workspaceId, imageFilenames);
            });
            
            // Subscribe to progress updates (routed by requestId)
            plumbing.subscribe('ws:progress:update', (data) => {
                const { requestId, ...messageData } = data;
                if (requestId) {
                    this.sendToRequest(requestId, {
                        type: 'dynamic_generation_progress_update',
                        ...messageData,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    // If no requestId, broadcast to all
                    this.broadcast({
                        type: 'dynamic_generation_progress_update',
                        ...messageData,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            // Service worker cache manifest broadcast (CLI / admin refresh)
            plumbing.subscribe('ws:broadcast:serviceWorkerCacheUpdate', (data) => {
                // only the rows that changed since the last broadcast (modules/swManifestDelta.js);
                // an unchanged manifest sends nothing
                const delta = require('./swManifestDelta');
                const d = delta.next(data.files || []);
                if (d.same) return;
                this.broadcast({
                    type: 'service_worker_cache_update',
                    data: {
                        files: d.files,
                        delta: d.delta === true,
                        baseHash: d.baseHash || null,
                        // sw.js's own content (#890): a page asks the browser for a new service worker
                        // (registration.update()) only when this differs from the one it last saw
                        swHash: delta.swScriptHash(),
                        hash: d.hash,
                        silent: data.silent === true,
                        message: data.message || 'Application updates are available',
                        timestamp: data.timestamp || Date.now()
                    },
                    timestamp: new Date().toISOString()
                });
            });

            plumbing.subscribe('ws:broadcast:runtimeCompileError', (data) => {
                this.broadcast({
                    type: 'runtime_compile_error',
                    data: {
                        errors: data.errors || [],
                        compiled: data.compiled || 0,
                        skipped: data.skipped || 0,
                        timestamp: data.timestamp || Date.now()
                    },
                    timestamp: new Date().toISOString()
                });
            });

            plumbing.subscribe('ws:broadcast:runtimeCompileProgress', (data) => {
                this.broadcastRuntimeCompileProgressThrottled(data);
            });

            plumbing.subscribe('ws:broadcast:runtimeCompileComplete', (data) => {
                this.broadcast({
                    type: 'runtime_compile_complete',
                    data: {
                        compiled: data.compiled || 0,
                        failedCount: data.failedCount != null ? data.failedCount : (data.errors ? data.errors.length : 0),
                        errors: data.errors || [],
                        stats: data.stats || null,
                        runId: data.runId || null,
                        timestamp: data.timestamp || Date.now()
                    },
                    timestamp: new Date().toISOString()
                });
            });

            plumbing.subscribe('ws:broadcast:runtimeCompileLogs', (data) => {
                this.broadcastRuntimeCompileLogsThrottled(data);
            });

            plumbing.subscribe('ws:broadcast:workspaceCssUpdated', (data) => {
                this.broadcast({
                    type: 'workspace_css_updated',
                    data: {
                        webPath: data.webPath || '/css/workspaces.css',
                        hash: data.hash || null,
                        sourceHash: data.sourceHash || null,
                        timestamp: data.timestamp || Date.now()
                    },
                    timestamp: new Date().toISOString()
                });
            });

            plumbing.subscribe('ws:broadcast:agentNotice', (data) => {
                try { require('./notificationInboxSources').onSystemNotice({ id: data && data.id, title: data && data.title, message: data && data.message, level: data && data.level }); } catch (_) { /* best effort */ }
                this.broadcast({
                    type: 'agent_notice',
                    data: {
                        id: data.id || null,
                        message: data.message || '',
                        title: data.title || 'Agent',
                        display: data.display === 'dialog' ? 'dialog' : 'toast',
                        level: data.level || 'warning',
                        timeout: data.timeout === false ? false : (data.timeout ?? 10000),
                        restart: data.restart === true,
                        source: data.source || 'agent'
                    },
                    timestamp: new Date().toISOString()
                });
            });
        } catch (error) {
            console.error('❌ Failed to set up WebSocket plumbing subscriptions:', error);
            // Retry after a short delay
            setTimeout(() => this.setupPlumbingSubscriptions(), 1000);
        }
    }

    setupWebSocket() {
        this.wss.on('connection', async (ws, req) => {
            console.log('🔌 New WebSocket connection attempt');
            // an 'error' while the session is looked up (a reset, a bad frame) must not go unhandled:
            // the logging handler below is wired only after that await
            ws.on('error', () => { /* 'close' follows */ });

            // Extract session from request
            const sessionResult = await this.extractSession(req);
            // closed while the session was looked up: its 'close' has already fired, so nothing below
            // may register it (it would stay in this.clients, and a Miniport's heartbeat timer would run on)
            if (ws.readyState !== WebSocket.OPEN) return;

            // Same trusted-proxy walk as web_server.js getRealIP (modules/clientAddress.js).
            const resolvedIp = realClientIp(req, trustedProxiesFromResources(this.globalResources));
            const clientIP = resolvedIp && resolvedIp !== 'unknown' ? resolvedIp : false;

            // Allow connection even without authentication for critical messages
            // Store client information (may be unauthenticated initially)
            let clientInfo = {
                sessionId: sessionResult?.sessionId || null,
                authenticated: !!(sessionResult && sessionResult.session),
                userType: sessionResult?.userType || null,
                clientIP: clientIP,
                clientId: crypto.randomBytes(6).toString('hex'),
                userAgent: String(req.headers['user-agent'] || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                connectedAt: new Date(),
                lastActivity: new Date(),
                heartbeat: createSocketHeartbeatEntry()
            };
            // Dreamscape Frame tablets (modules/slideshowDevices.js) say so before they identify,
            // so agent auto-bind never picks one in between
            // (browsers cannot set headers on a socket: the Device Simulator app passes ?dreamscapeClient=)
            const queryApp = requestQuery(req, 'dreamscapeClient');
            // Melaton Miniport (#815): the Android app's native carrier. Not a client of its own: it only
            // carries its pages' sub-clients (modules/ws/virtualSocket.js), so it never enters this.clients
            // (no boot pushes, no broadcasts of its own, not in any client list)
            const miniportQuery = requestQuery(req, 'miniport') === '1';
            // (a sub-client it carries reuses its request, ?miniport=1 included: that one is a client)
            if (miniportQuery && !ws.virtual) {
                require('./ws/virtualSocket').acceptMiniport(ws, req, clientInfo, (vws, vreq) => this.wss.emit('connection', vws, vreq));
                return;
            }
            const frameApp = [req.headers['x-dreamscape-client'], req.headers['user-agent'], queryApp]
                .map((h) => String(h || '').trim().split(/\s+/)[0]).find((h) => /^(DreamscapeFrame|VirtualSideShow)\//.test(h));
            if (frameApp) clientInfo.deviceApp = frameApp.slice(0, 64);
            // A light client (?light=1, #890): the Android app's widgets and screen saver (DSApp
            // DreamscapeClient). Signed in as usual, but none of a page's boot pushes, and of the
            // broadcasts only the types it subscribed to (gallery_subscribe); replies as always.
            // A light Miniport sub-client (sub_open light, #908): the app's CaféReady task host, the same.
            if ((!ws.virtual && requestQuery(req, 'light') === '1') || (ws.virtual && ws.light)) {
                clientInfo.light = true;
                clientInfo.lightSubs = new Set();
            }
            // every frame it sends counts as liveness (the heartbeat pings only a socket silent a whole window)
            watchSocketFrames(ws, clientInfo.heartbeat);

            this.clients.set(ws, clientInfo);
            // the request a Continuity sub-client of this socket reuses (#798: modules/ws/virtualSocket.js)
            ws._dsReq = req;
            if (ws.virtual) clientInfo.continuitySub = ws.sub;
            try {
                const { parseAgentClientIdQuery, resumeAgentClientId } = require('./agentClientBridge');
                resumeAgentClientId(this, parseAgentClientIdQuery(req), clientInfo);
            } catch (_err) {
                // Resume is optional — a new clientId is already assigned
            }

            if (clientInfo.authenticated) {
                console.log(`✅ WebSocket connected (authenticated): Session ${clientInfo.sessionId}`);
            } else {
                console.log(`🔓 WebSocket connected (unauthenticated): Allowing critical messages only`);
            }

            // Handle incoming messages
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    // Continuity (#798): the DeX window's packets, carried by the phone window's socket
                    if (!ws.virtual && require('./ws/virtualSocket').handle(ws, message, (vws, vreq) => this.wss.emit('connection', vws, vreq))) return;
                    this.handleMessage(ws, message);
                } catch (error) {
                    console.error('❌ Invalid WebSocket message format:', error);
                    this.sendToClient(ws, {
                        type: 'error',
                        message: 'Invalid message format',
                        timestamp: new Date().toISOString()
                    });
                }
            });

            // Send welcome message
            const connectionPayload = {
                type: 'connection',
                status: 'connected',
                message: 'WebSocket connection established',
                authenticated: clientInfo.authenticated,
                timestamp: new Date().toISOString()
            };
            if (clientInfo.authenticated) {
                connectionPayload.userType = clientInfo.userType || 'admin';
            }
            if (clientInfo.clientId) {
                connectionPayload.clientId = clientInfo.clientId;
            }
            if (clientInfo.authenticated && clientInfo.userType === 'admin') {
                connectionPayload.logViewerPathUuid = this.globalResources.getLogViewerPathUuid();
            }
            if (clientInfo.authenticated) {
                connectionPayload.vfsPathUuid = this.globalResources.getVfsPathUuid();
            }
            this.sendToClient(ws, connectionPayload);
            // the server status once; after this it comes only when it changes (startPingInterval)
            if (clientInfo.authenticated && !clientInfo.light) this.sendPingTo(ws);

            // (not a Continuity sub-client: its carrier, the same session, just did, #798; not a light
            // client: the app's widgets are not a sign-in)
            if (clientInfo.authenticated && !ws.virtual && !clientInfo.light) {
                // A logged-in client restarts the 6-hourly Claude usage refresh (modules/claudeUsageProbe.js).
                try {
                    require('./claudeUsageProbe').noteClientLogin(this.globalResources);
                } catch (_err) {
                    // Usage refresh is optional
                }
            }

            if (clientInfo.authenticated && clientInfo.clientId && !clientInfo.light) {
                try {
                    const { onAgentClientConnected } = require('./agentClientBridge');
                    onAgentClientConnected(this.globalResources, clientInfo.clientId);
                } catch (_err) {
                    // Agent bind offers are optional at connect
                }
            }

            // Handle client disconnect (wired before the awaited boot pushes below: a socket that
            // closes while they run is still cleaned up)
            ws.on('close', (code, reason) => {
                // a carrier's Continuity sub-clients end with it (#798)
                if (!ws.virtual) require('./ws/virtualSocket').closeAll(ws);
                const info = this.clients.get(ws) || clientInfo;
                console.log(formatWsDisconnectLog({
                    clientIP: info && info.clientIP,
                    code,
                    reason,
                    sessionId: info && info.sessionId
                }));
                if (this.clients.has(ws)) {

                    const handlers = this.globalResources.getWebSocketMessageHandlers();
                    if (handlers && handlers.detachClientActiveGenerations) {
                        handlers.detachClientActiveGenerations(ws);
                    }

                    // Clean up session workspace (not for a slideshow device: it shares the tab's session)
                    // nor while another client of the session is still up (a Continuity DeX window and its phone, #798)
                    if (!(info.deviceId || info.deviceApp) && !this.hasOtherClientForSession(clientInfo.sessionId, ws)) {
                        this.globalResources.getWorkspaceManager().cleanupSessionWorkspace(clientInfo.sessionId);
                    }
                    
                    // Clean up metadata cache for this client
                    if (handlers && handlers.cleanupClientCache) {
                        handlers.cleanupClientCache(
                            clientInfo.sessionId,
                            ws,
                            this.hasOtherClientForSession(clientInfo.sessionId, ws)
                        );
                    }
                    
                    this.clearRuntimeCompileProgressThrottleForClient(ws);
                    this.clearRuntimeCompileLogsThrottleForClient(ws);
                    this.clients.delete(ws);
                    try {
                        const { onAgentClientDisconnected } = require('./agentClientBridge');
                        onAgentClientDisconnected(this.globalResources, clientInfo.clientId);
                    } catch (_err) {
                        // preferred-testing cleanup is optional
                    }
                    // the tab's Melaton apps end with it (their session runners stop; services stay)
                    require('./ws/handlers/245-melatonAppsHandler').onClientClosed(ws);
                    // a slideshow device is offline from here (Control Panel's SideShow page)
                    require('./slideshowDevices').onSocketClosed(this.globalResources, this, info);
                    // an ActiveSync peer (phone or desktop tab) is gone: its waiting calls fail now
                    require('./activeSync').onSocketClosed(this.globalResources, this, info);
                    // its IE windows go idle, then stored (#756 browsing sessions)
                    require('./browsingSessions').onSocketClosed(info, ws);
                }
            });

            // Handle errors. ws always emits 'close' after 'error', and the close handler above does the
            // cleanup. (This handler used to delete the client first, so the close handler skipped
            // everything: an ActiveSync phone, a SideShow device, an agent bind or an IE window of a
            // socket that ended in an error, a reset or a dead link, was never told it was gone.)
            ws.on('error', (error) => {
                const info = this.clients.get(ws);
                console.error(`❌ WebSocket error for session ${info?.sessionId || 'unknown'}:`, error);
            });

            // ---- boot pushes (a light client gets none of them)
            if (clientInfo.light) {
                // its session's workspace still comes back on the server (its requests read it), unsent
                if (clientInfo.authenticated && clientInfo.sessionId) {
                    try { await this.globalResources.getWorkspaceManager().restoreSessionWorkspace(clientInfo.sessionId); } catch (_err) { /* default workspace */ }
                }
                return;
            }

            // Push boot-time compile failures stored in runtimeAssetService (no clients were connected at compile time)
            this.sendStoredRuntimeCompileErrorsToClient(ws);

            // Restore session workspace for reconnection sync (only if authenticated)
            if (clientInfo.authenticated && clientInfo.sessionId) {
                await this.restoreSessionWorkspace(clientInfo.sessionId, ws);
                this.sendGalleryScrollStateFromSession(clientInfo.sessionId, ws);
                await this.sendGalleryHintToClient(clientInfo.sessionId, ws);
            }

            // Send combined search + prompt FTS indexing snapshot on connect
            void this.sendSearchIndexingSnapshotToClient(ws);
        });

        console.log('✓ WebSocket server initialized');
    }

    /**
     * Every open client socket: the server's own, then Continuity sub-clients (#798,
     * modules/ws/virtualSocket.js), which wss.clients never holds; broadcasts and sendToUser reach them too.
     */
    forEachSocket(fn) {
        // a Miniport carrier is no client (its subs are, below)
        this.wss.clients.forEach((ws) => { if (!ws._dsMiniport) fn(ws); });
        for (const ws of this.clients.keys()) {
            if (ws && ws.virtual) fn(ws);
        }
    }

    hasOtherClientForSession(sessionId, exceptWs) {
        if (!sessionId) return false;
        for (const [otherWs, info] of this.clients) {
            if (otherWs !== exceptWs && info && info.sessionId === sessionId) {
                return true;
            }
        }
        return false;
    }

    /**
     * Send persisted runtime compile errors to a newly connected client.
     * modules/runtimeAssetService.js — compileState.errors, also on OPTIONS /status
     */
    sendStoredRuntimeCompileErrorsToClient(ws) {
        try {
            const runtimeAssetService = require('./runtimeAssetService');
            const status = runtimeAssetService.getPublicStatus();
            const errors = status && Array.isArray(status.errors) ? status.errors : [];
            if (errors.length === 0) {
                return;
            }
            this.sendToClient(ws, {
                type: 'runtime_compile_error',
                data: {
                    errors,
                    compiled: status.compiled || 0,
                    skipped: 0,
                    timestamp: Date.now()
                },
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.warn('sendStoredRuntimeCompileErrorsToClient:', err.message);
        }
    }

    /**
     * Push saved gallery scroll positions from express session so client can restore after loadGallery.
     */
    async sendGalleryHintToClient(sessionId, ws) {
        try {
            const { buildGalleryHint } = require('./ws/handlers/120-galleryHandler');
            let workspaceId = 'default';
            try {
                workspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(sessionId) || 'default';
            } catch (_err) { /* default workspace */ }
            // one build per workspace for a few seconds: a hybrid phone and its DeX window (#798), or tabs
            // reconnecting together after a restart, get the same hint (two metadata queries) relayed
            if (!this._galleryHintCache) this._galleryHintCache = new Map();
            const hit = this._galleryHintCache.get(workspaceId);
            let pending = hit && Date.now() - hit.at < 15000 ? hit.promise : null;
            if (!pending) {
                pending = buildGalleryHint({ globalResources: this.globalResources }, workspaceId);
                this._galleryHintCache.set(workspaceId, { at: Date.now(), promise: pending });
                pending.catch(() => this._galleryHintCache.delete(workspaceId));
            }
            const data = await pending;
            this.sendToClient(ws, {
                type: 'gallery_hint',
                data,
                timestamp: new Date().toISOString()
            });
        } catch (e) {
            console.warn('sendGalleryHintToClient:', e.message);
        }
    }

    sendGalleryScrollStateFromSession(sessionId, ws) {
        try {
            if (!this.sessionStore || typeof this.sessionStore.get !== 'function') return;
            this.sessionStore.get(sessionId, (err, sess) => {
                if (err || !sess) return;
                const data = sess.galleryScrollState && typeof sess.galleryScrollState === 'object'
                    ? sess.galleryScrollState
                    : {};
                this.sendToClient(ws, {
                    type: 'gallery_scroll_state',
                    data,
                    timestamp: new Date().toISOString()
                });
            });
        } catch (e) {
            console.warn('sendGalleryScrollStateFromSession:', e.message);
        }
    }

    // Restore session workspace when user reconnects
    async restoreSessionWorkspace(sessionId, ws) {
        try {
            const restoredWorkspace = await this.globalResources.getWorkspaceManager().restoreSessionWorkspace(sessionId);
            
            if (restoredWorkspace) {
                // Send workspace restoration notification to client
                this.sendToClient(ws, {
                    type: 'workspace_restored',
                    workspace: restoredWorkspace,
                    timestamp: new Date().toISOString()
                });
                
                // Also send the current workspace data
                const workspaceData = this.globalResources.getWorkspaceManager().getActiveWorkspaceData(sessionId);
                if (workspaceData) {
                    this.sendToClient(ws, {
                        type: 'workspace_data',
                        data: workspaceData,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            console.warn(`⚠️ Failed to restore workspace for session ${sessionId}:`, error.message);
        }
    }

    // Verify an express-session signed-cookie value: base64(HMAC-SHA256(value, secret)) with
    // trailing '=' padding stripped, as cookie-signature produces. Timing-safe, and tolerant of
    // a rotated/array secret (compare against each configured secret).
    verifyCookieSignature(value, providedSig) {
        if (!value || !providedSig) return false;
        let secrets = this.globalResources.getSecureConfig({ path: 'sessionSecret' });
        if (!secrets) return false;
        if (!Array.isArray(secrets)) secrets = [secrets];
        const provided = Buffer.from(providedSig);
        for (const secret of secrets) {
            if (!secret) continue;
            const expected = crypto.createHmac('sha256', secret).update(value).digest('base64')
                .replace(/=+$/, '');
            const expectedBuf = Buffer.from(expected);
            if (expectedBuf.length === provided.length &&
                crypto.timingSafeEqual(expectedBuf, provided)) {
                return true;
            }
        }
        return false;
    }

    async extractSession(req) {
        // Parse cookies to get session ID
        const cookies = req.headers.cookie;
        if (!cookies) return null;

        const sessionCookie = cookies
            .split(';')
            .find(cookie => cookie.trim().startsWith('connect.sid='));

        if (!sessionCookie) return null;

        // Extract and decode the session ID
        const encodedSessionId = sessionCookie.split('=')[1];
        if (!encodedSessionId) return null;

        // Decode the signed session cookie and VERIFY its signature before trusting the id.
        // express-session signs with cookie-signature: cookie = "s:" + id + "." + base64(HMAC-SHA256(id, secret)).
        // Stripping the signature without checking it (the previous behaviour) let anyone present an
        // arbitrary session id. We recompute the HMAC and timing-safe compare it.
        let sessionId;
        try {
            const decoded = decodeURIComponent(encodedSessionId);
            if (!decoded.startsWith('s:')) return null; // unsigned cookie: reject
            const body = decoded.slice(2);
            const dot = body.lastIndexOf('.');
            if (dot <= 0) return null;
            const id = body.slice(0, dot);
            const providedSig = body.slice(dot + 1);
            if (!this.verifyCookieSignature(id, providedSig)) {
                console.warn('🔒 WebSocket rejected: session cookie signature invalid');
                return null;
            }
            sessionId = id;
        } catch (error) {
            console.error('❌ Failed to decode session ID:', error);
            return null;
        }

        if (!sessionId) return null;

        try {
            // If we have a session store, verify the session
            if (this.sessionStore) {
                return new Promise((resolve) => {
                    this.sessionStore.get(sessionId, (err, session) => {
                        if (err) {
                            console.error('❌ WebSocket session verification failed:', err);
                            resolve(null);
                            return;
                        }
                        if (!session) {
                            console.log('🔓 WebSocket session not in store (login required or expired cookie)');
                            resolve(null);
                            return;
                        }
                        
                        // Check if session is authenticated (this is the key check)
                        if (session.authenticated === true) {
                            console.log('✅ WebSocket session verified for authenticated session:', sessionId);
                            const userType = session.userType || 'admin'; // Default to admin for backward compatibility
                            resolve({ session, sessionId, userType });
                        } else {
                            console.error('❌ WebSocket session not authenticated:', sessionId);
                            resolve(null);
                        }
                    });
                });
            } else {
                console.error('❌ Fallback session verification: rejecting connection (no session store)');
                return null;
            }
        } catch (error) {
            console.error('❌ WebSocket session extraction error:', error);
            return null;
        }
    }

    // Critical message types that don't require authentication
    static CRITICAL_MESSAGE_TYPES = [
        'ping',
        'pong',
        'server_status',
        'check_updates',
        'refresh_server_cache',
        'version_check',
        'authenticate_application',
        'refresh_application_key',
        'request_application_authorization',
        'check_application_authorization',
        'claim_application_authorization',
        'request_temp_access_token'
    ];

    handleMessage(ws, message) {
        const clientInfo = this.clients.get(ws);
        if (!clientInfo) {
            this.sendToClient(ws, {
                type: 'error',
                message: 'Client not found',
                timestamp: new Date().toISOString()
            });
            return;
        }

        clientInfo.lastActivity = new Date();

        // Allow critical messages without authentication
        const isCriticalMessage = message.type && 
            WebSocketServer.CRITICAL_MESSAGE_TYPES.includes(message.type);

        // Check if client is authenticated (unless it's a critical message)
        if (!clientInfo.authenticated && !isCriticalMessage) {
            this.sendToClient(ws, {
                type: 'auth_error',
                message: 'Authentication required',
                code: 'AUTH_REQUIRED',
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Get message handlers from globalResources
        try {
            const handlers = this.globalResources.getWebSocketMessageHandlers();
            void handlers.handleMessage(ws, message, clientInfo, this).catch((err) => {
                console.error('❌ WebSocket message handler error:', err);
            });
        } catch (error) {
            console.error('❌ Failed to get WebSocket message handlers:', error.message);
            this.sendToClient(ws, {
                type: 'error',
                message: 'Message handler not available',
                timestamp: new Date().toISOString()
            });
        }
    }

    // message may already be a JSON string (broadcast serializes once for every client).
    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            if (this._dormantHold(ws, message)) return;
            ws.send(typeof message === 'string' ? message : JSON.stringify(message));
        }
    }

    // ---- Dormant phone pages (rule server-push-not-polling; the phone reports its screen off or the
    // app behind another, client_dormant): status pushes that nothing waits on are held while it
    // sleeps and delivered when it wakes, newest state only where that is all the page uses. Replies
    // (requestId), texts, mail and Director events are never held. A phone's DeX window that says it
    // sleeps (client_dormant dex: 1, #890 P18) is held for the same way.
    _isDormantPhone(ws) {
        return isDormantPage(this.clients.get(ws));
    }

    /** A sleeping phone page or DeX window (client_dormant): what is sent to it now may be held (DORMANT_HOLD). */
    isDormantSocket(ws) {
        return this._isDormantPhone(ws);
    }

    /** True when the message was held for a dormant phone page (sent later by setDormant(ws, false)). */
    _dormantHold(ws, message) {
        if (!this._isDormantPhone(ws)) return false;
        let type = null;
        let rid = false;
        if (typeof message === 'string') {
            const m = /^\{"type":"([a-z0-9_]+)"/.exec(message);
            type = m ? m[1] : null;
            rid = message.includes('"requestId"');
        } else if (message && typeof message === 'object') {
            type = message.type;
            rid = !!message.requestId;
        }
        if (!type || rid || !DORMANT_HOLD.has(type)) return false;
        const mode = DORMANT_HOLD.get(type);
        const dataOf = () => { try { const o = typeof message === 'string' ? JSON.parse(message) : message; return (o && o.data) || {}; } catch (_) { return {}; } };
        if (!this._dormantHeld) this._dormantHeld = new WeakMap();
        let key;
        if (mode === 'last') key = type;
        else if (mode === 'path') key = `${type}|${dataOf().path || ''}`;
        else if (typeof mode === 'function') {
            const k = mode(dataOf(), this.clients.get(ws));
            // dropped for a sleeping page: nothing is kept, nothing goes on waking
            if (k === false) return true;
            if (k == null) {
                // this one goes at once; an older held copy kept as the newest ('last') would land after it
                const was = this._dormantHeld.get(ws);
                if (was) was.delete(`${type}|last`);
                return false;
            }
            key = `${type}|${k}`;
        } else key = `${type}|${(this._dormantSeq = (this._dormantSeq || 0) + 1)}`;
        let held = this._dormantHeld.get(ws);
        if (!held) { held = new Map(); this._dormantHeld.set(ws, held); }
        held.delete(key); // a newer copy goes to the end
        held.set(key, message);
        if (held.size > DORMANT_HOLD_MAX) held.delete(held.keys().next().value);
        return true;
    }

    /** The page went to sleep (on) or woke (off): on waking, what was held goes out in order. */
    setDormant(ws, on, why = '') {
        const info = this.clients.get(ws);
        if (!info) return;
        const was = !!info.dormant;
        info.dormant = !!on;
        if (on && !was) {
            info.dormantAt = Date.now();
            // the Director turns the page last had (directorRunHoldKey): the newest status broadcast
            info.dormantDirectorRun = this._directorRunKey || directorRunKey(null);
        }
        const held = !on && this._dormantHeld ? this._dormantHeld.get(ws) : null;
        if (was !== !!on) {
            const ua = String(info.userAgent || '');
            const device = /SM-F9\d\d/.test(ua) ? 'Fold' : /SM-A53/.test(ua) ? 'A53' : (/Android/.test(ua) ? 'Android' : 'other');
            console.log(`📱 ${on ? 'asleep' : 'awake'} ${device}${info.dexWindow ? ' DeX' : ''} ip=${info.ip || info.clientIP || '?'}${on ? '' : ` held=${held ? held.size : 0}`}${why ? ` (${why})` : ''}`);
        }
        if (on) return;
        if (!held) return;
        this._dormantHeld.delete(ws);
        const weatherKeys = [];
        for (const [k, m] of held) {
            if (ws.readyState !== WebSocket.OPEN) break;
            try { ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch (_) { break; }
            if (k.startsWith('weather_delta|wx:')) weatherKeys.push(k.slice('weather_delta|wx:'.length));
        }
        // the held forecast copies it now holds become its base for the next delta (weatherWatch.js)
        if (weatherKeys.length) {
            try { require('./weatherWatch').delivered(ws, weatherKeys); } catch (_) { /* not loaded */ }
        }
    }

    getRuntimeCompileProgressIntervalMs(clientInfo) {
        // Matches public/scripts/websocket.js pingWarningThreshold (500ms)
        const highRttThresholdMs = 500;
        const rtt = clientInfo && typeof clientInfo.lastClientRttMs === 'number'
            ? clientInfo.lastClientRttMs
            : null;
        if (rtt !== null && rtt > highRttThresholdMs) {
            return 1000;
        }
        return 500;
    }

    isRuntimeCompileProgressFinal(data) {
        if (data.inProgress === false) {
            return true;
        }
        const current = data.current || 0;
        const total = data.total || 0;
        if (total > 0 && current >= total) {
            return true;
        }
        return (data.percent || 0) >= 100;
    }

    buildRuntimeCompileProgressMessage(data) {
        return {
            type: 'runtime_compile_progress',
            data: {
                current: data.current || 0,
                total: data.total || 0,
                file: data.file || null,
                percent: data.percent || 0,
                stats: data.stats || null,
                inProgress: data.inProgress === true,
                timestamp: data.timestamp || Date.now()
            },
            timestamp: new Date().toISOString()
        };
    }

    clearRuntimeCompileProgressThrottleForClient(ws) {
        const state = this.runtimeCompileProgressByClient.get(ws);
        if (!state) {
            return;
        }
        if (state.flushTimer) {
            clearTimeout(state.flushTimer);
        }
        this.runtimeCompileProgressByClient.delete(ws);
    }

    sendRuntimeCompileProgressToClient(ws, data) {
        const state = this.runtimeCompileProgressByClient.get(ws) || {
            lastSentAt: 0,
            pendingData: null,
            flushTimer: null
        };
        this.sendToClient(ws, this.buildRuntimeCompileProgressMessage(data));
        state.lastSentAt = Date.now();
        state.pendingData = null;
        if (state.flushTimer) {
            clearTimeout(state.flushTimer);
            state.flushTimer = null;
        }
        this.runtimeCompileProgressByClient.set(ws, state);
    }

    broadcastRuntimeCompileProgressThrottled(data) {
        const now = Date.now();
        const isFinal = this.isRuntimeCompileProgressFinal(data);

        this.forEachSocket((client) => {
            if (client.readyState !== WebSocket.OPEN) {
                return;
            }

            const clientInfo = this.clients.get(client);
            // the same audience as broadcast() (#890): not the app's native links
            if (!socketWantsBroadcast(clientInfo, 'runtime_compile_progress')) return;
            let state = this.runtimeCompileProgressByClient.get(client);
            if (!state) {
                state = { lastSentAt: 0, pendingData: null, flushTimer: null };
                this.runtimeCompileProgressByClient.set(client, state);
            }

            if (isFinal) {
                this.sendRuntimeCompileProgressToClient(client, data);
                return;
            }

            const intervalMs = this.getRuntimeCompileProgressIntervalMs(clientInfo);
            const elapsed = state.lastSentAt === 0 ? intervalMs : now - state.lastSentAt;

            if (elapsed >= intervalMs) {
                this.sendRuntimeCompileProgressToClient(client, data);
                return;
            }

            state.pendingData = data;
            if (state.flushTimer) {
                return;
            }

            const delay = intervalMs - elapsed;
            state.flushTimer = setTimeout(() => {
                state.flushTimer = null;
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                if (state.pendingData) {
                    const pending = state.pendingData;
                    state.pendingData = null;
                    this.sendRuntimeCompileProgressToClient(client, pending);
                }
            }, delay);
        });
    }

    mergeRuntimeCompileLogPayload(existing, incoming) {
        if (!existing) {
            return {
                entries: [...(incoming.entries || [])],
                runId: incoming.runId || null,
                timestamp: incoming.timestamp || Date.now()
            };
        }
        return {
            entries: [...(existing.entries || []), ...(incoming.entries || [])],
            runId: incoming.runId || existing.runId || null,
            timestamp: incoming.timestamp || Date.now()
        };
    }

    buildRuntimeCompileLogsMessage(data) {
        return {
            type: 'runtime_compile_logs',
            data: {
                entries: data.entries || [],
                runId: data.runId || null,
                timestamp: data.timestamp || Date.now()
            },
            timestamp: new Date().toISOString()
        };
    }

    clearRuntimeCompileLogsThrottleForClient(ws) {
        const state = this.runtimeCompileLogsByClient.get(ws);
        if (!state) {
            return;
        }
        if (state.flushTimer) {
            clearTimeout(state.flushTimer);
        }
        this.runtimeCompileLogsByClient.delete(ws);
    }

    sendRuntimeCompileLogsToClient(ws, data) {
        const state = this.runtimeCompileLogsByClient.get(ws) || {
            lastSentAt: 0,
            pendingData: null,
            flushTimer: null
        };
        this.sendToClient(ws, this.buildRuntimeCompileLogsMessage(data));
        state.lastSentAt = Date.now();
        state.pendingData = null;
        if (state.flushTimer) {
            clearTimeout(state.flushTimer);
            state.flushTimer = null;
        }
        this.runtimeCompileLogsByClient.set(ws, state);
    }

    broadcastRuntimeCompileLogsThrottled(data) {
        const now = Date.now();

        this.forEachSocket((client) => {
            if (client.readyState !== WebSocket.OPEN) {
                return;
            }

            const clientInfo = this.clients.get(client);
            // the same audience as broadcast() (#890): desktops only (Server Manager's log), no native links
            if (!socketWantsBroadcast(clientInfo, 'runtime_compile_logs')) return;
            let state = this.runtimeCompileLogsByClient.get(client);
            if (!state) {
                state = { lastSentAt: 0, pendingData: null, flushTimer: null };
                this.runtimeCompileLogsByClient.set(client, state);
            }

            const intervalMs = this.getRuntimeCompileProgressIntervalMs(clientInfo);
            const elapsed = state.lastSentAt === 0 ? intervalMs : now - state.lastSentAt;

            if (elapsed >= intervalMs) {
                this.sendRuntimeCompileLogsToClient(client, data);
                return;
            }

            state.pendingData = this.mergeRuntimeCompileLogPayload(state.pendingData, data);
            if (state.flushTimer) {
                return;
            }

            const delay = intervalMs - elapsed;
            state.flushTimer = setTimeout(() => {
                state.flushTimer = null;
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                if (state.pendingData) {
                    const pending = state.pendingData;
                    state.pendingData = null;
                    this.sendRuntimeCompileLogsToClient(client, pending);
                }
            }, delay);
        });
    }

    broadcast(message, filter = null) {
        const type = message && message.type;
        let to = [];
        this.forEachSocket(client => {
            if (client.readyState !== WebSocket.OPEN) return;
            const info = this.clients.get(client);
            // who reads this type at all (#890: native links, light clients, desktop- / phone-only types)
            if (!socketWantsBroadcast(info, type)) return;
            if (!filter || filter(info)) to.push(client);
        });
        // a dormant phone page: held for it (setDormant), not sent over its carrier now
        if (message && DORMANT_HOLD.has(type) && !message.requestId) {
            // only the sockets whose copy was really held leave the list (new mail is not held)
            const sleeping = new Set(to.filter((ws) => this._isDormantPhone(ws) && this._dormantHold(ws, message)));
            if (sleeping.size) to = to.filter((ws) => !sleeping.has(ws));
        }
        // a phone gets frequent small notices (file changes) in one go every few seconds instead of a
        // radio wakeup each (rule server-push-not-polling); desktops keep getting them at once
        if (message && PHONE_BATCH_TYPES.has(type)) {
            const phones = new Set(to.filter((ws) => isPhonePage(this.clients.get(ws))));
            if (phones.size) {
                phones.forEach((ws) => this._batchForPhone(ws, message));
                to = to.filter((ws) => !phones.has(ws));
            }
        }
        // the Director turns now running, for a phone page that falls asleep next (directorRunHoldKey)
        if (type === 'director_computer_status') this._directorRunKey = directorRunKey(message.data);
        // a Continuity carrier and its sub-client: one copy over the phone's socket (#798). The dormant
        // hold was decided above for every socket left, so they are sent as they are (sendToClient would
        // ask a stateful hold rule a second time)
        require('./ws/virtualSocket').sendCoalesced(to, message, (ws, payload) => this._sendNow(ws, payload));
    }

    /** One already-serialised packet to an open socket, past the dormant hold (broadcast decided it). */
    _sendNow(ws, payload) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(payload);
    }

    _batchForPhone(ws, message) {
        if (!this._phoneBatches) this._phoneBatches = new Map();
        let b = this._phoneBatches.get(ws);
        if (!b) {
            b = new Map();
            this._phoneBatches.set(ws, b);
            const t = setTimeout(() => {
                const batch = this._phoneBatches.get(ws);
                this._phoneBatches.delete(ws);
                if (!batch || ws.readyState !== WebSocket.OPEN) return;
                for (const m of batch.values()) { try { this.sendToClient(ws, m); } catch (_) { /* gone */ } }
            }, PHONE_BATCH_MS);
            if (t.unref) t.unref();
        }
        // the same notice twice in a batch (the same folder changed again) goes once
        b.set(`${message.type}|${JSON.stringify(message.data || {})}`, message);
    }

    /** Alias used by generation quips and admin resource broadcasts. */
    broadcastToAll(message, filter = null) {
        this.broadcast(message, filter);
    }

    sendToUser(sessionId, message) {
        let to = [];
        const type = message && message.type;
        // a packet with a requestId may be a reply routed to the whole session (sendToRequest): a light
        // client still gets it (its own request's answer)
        const reply = !!(message && message.requestId);
        this.forEachSocket(client => {
            const clientInfo = this.clients.get(client);
            if (clientInfo && clientInfo.sessionId === sessionId && client.readyState === WebSocket.OPEN
                && ((reply && clientInfo.light) || socketWantsBroadcast(clientInfo, type, true))) to.push(client);
        });
        // the dormant hold is decided per socket before the Continuity copies are put together, as in
        // broadcast(): a sleeping DeX window leaves its carrier's copy (sendCoalesced), and a sleeping
        // phone page's held copy no longer takes the awake DeX window's _cc with it
        if (message && DORMANT_HOLD.has(type) && !reply) {
            const sleeping = new Set(to.filter((ws) => this._isDormantPhone(ws) && this._dormantHold(ws, message)));
            if (sleeping.size) to = to.filter((ws) => !sleeping.has(ws));
        }
        require('./ws/virtualSocket').sendCoalesced(to, message, (ws, payload) => this._sendNow(ws, payload));
    }
    
    /**
     * Send message to client by requestId
     * Uses requestId -> sessionId mapping stored in plumbing system
     */
    sendToRequest(requestId, message) {
        try {
            const plumbing = this.globalResources.getDataPlumbing();
            // Get sessionId from requestId mapping
            const requestData = plumbing.get(`request:${requestId}`);
            if (requestData && requestData.sessionId) {
                this.sendToUser(requestData.sessionId, message);
            } else {
                // Fallback: broadcast to all if requestId not found
                // This handles cases where requestId mapping wasn't set up
                console.warn(`⚠️ RequestId ${requestId} not found in mapping, broadcasting to all`);
                this.broadcast(message);
            }
        } catch (error) {
            // Fallback to broadcast if plumbing fails
            this.broadcast(message);
        }
    }

    getConnectedUsers() {
        const sessions = new Map();
        this.clients.forEach((clientInfo, ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                sessions.set(clientInfo.sessionId, clientInfo);
            }
        });
        return Array.from(sessions.values());
    }

    getConnectionCount() {
        return this.wss.clients.size;
    }

    broadcastQueueUpdate(queueStatus) {
        this.broadcast({
            type: 'queue_update',
            data: queueStatus,
            timestamp: new Date().toISOString()
        });
    }

    broadcastSystemMessage(message, level = 'info') {
        // warnings and errors reach the phone page or no page (notificationInboxSources, #908)
        try { require('./notificationInboxSources').onSystemNotice({ message, level }); } catch (_) { /* best effort */ }
        this.broadcast({
            type: 'system_message',
            data: { message, level },
            timestamp: new Date().toISOString()
        });
    }

    broadcastGalleryUpdate(galleryData, viewType = 'images') {
        this.broadcast({
            type: 'gallery_updated',
            data: { gallery: galleryData, viewType },
            timestamp: new Date().toISOString()
        });
    }

    broadcastUserNotification(sessionId, message, type = 'info') {
        this.sendToUser(sessionId, {
            type: 'notification',
            data: { message, type },
            timestamp: new Date().toISOString()
        });
    }

    // Broadcast image addition to workspace (workspace-aware)
    broadcastWorkspaceImageAdded(workspaceId, imageFilenames) {
        // Broadcast to all clients viewing the same workspace
        this.broadcast({
            type: 'workspace_image_added',
            data: { 
                workspaceId, 
                imageFilenames: Array.isArray(imageFilenames) ? imageFilenames : [imageFilenames]
            },
            timestamp: new Date().toISOString()
        }, (clientInfo) => {
            if (!clientInfo || !clientInfo.sessionId) return false;
            try {
                const clientWorkspace = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
                return (clientWorkspace || 'default') === (workspaceId || 'default');
            } catch (_err) {
                return false;
            }
        });
        
        console.log(`📢 Broadcast image addition to workspace ${workspaceId}: ${Array.isArray(imageFilenames) ? imageFilenames.length : 1} image(s)`);
    }

    startSocketHeartbeat() {
        if (this.socketHeartbeatTimer) {
            clearInterval(this.socketHeartbeatTimer);
        }
        this.socketHeartbeatTimer = setInterval(() => {
            const openClients = [];
            for (const [ws, info] of this.clients) {
                openClients.push({ ws, info, heartbeat: info && info.heartbeat });
            }
            reapSocketHeartbeats(openClients, {
                isOpen: (client) => client.ws && client.ws.readyState === WebSocket.OPEN,
                // a socket heard from within its window is not pinged (#890, wsSocketHeartbeat.js)
                windowFor: (client) => quietWindowFor(client.ws, client.info),
                ping: (client) => {
                    try {
                        client.ws.ping();
                    } catch (_err) {
                        // Socket already closing
                    }
                },
                terminate: (client) => {
                    try {
                        client.ws.terminate();
                    } catch (_err) {
                        // Already gone
                    }
                }
            });
        }, HEARTBEAT_INTERVAL_MS);
        if (this.socketHeartbeatTimer.unref) this.socketHeartbeatTimer.unref();
    }

    startPingInterval(pingCallback = null) {
        // Clear any existing interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        // The server's status (balance, usage, account health, subscription, NovelAI status, queue,
        // image count) is read every 10 s and broadcast only when it changed (rule
        // server-push-not-polling): it used to go to every socket every 10 s whatever happened, which
        // woke every phone's radio 8,640 times a day. A socket that connects gets it once (sendPingTo).
        this._pingCallback = pingCallback;
        this._lastPingKey = null;
        this.heartbeatInterval = setInterval(() => {
            const serverData = pingCallback ? pingCallback() : null;
            // the same read for other status pushes (addStatusTap: ActiveSync's as_credits, #890)
            if (this._statusTaps) {
                for (const fn of this._statusTaps) { try { fn(serverData); } catch (err) { console.warn('[ws] status tap failed:', err.message); } }
            }
            const key = pingStatusKey(serverData);
            if (key === this._lastPingKey) return;
            this._lastPingKey = key;
            this.broadcastPing(serverData);
        }, 10000);
    }

    /** fn(serverStatus) on every 10 s status read; it decides itself whether anything changed. */
    addStatusTap(fn) {
        if (typeof fn !== 'function') return;
        if (!this._statusTaps) this._statusTaps = [];
        this._statusTaps.push(fn);
    }

    /** The current server status to one socket (a new connection), outside the change broadcast. */
    sendPingTo(ws) {
        if (!this._pingCallback || !ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            this.sendToClient(ws, { type: 'ping', data: this._pingCallback(), timestamp: new Date().toISOString() });
        } catch (_err) { /* the next change reaches it */ }
    }

    stopPingInterval() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    startQueueStatusInterval() {
        // Clear any existing queue status interval
        if (this.queueStatusInterval) {
            clearInterval(this.queueStatusInterval);
        }

        // Check queue status every minute and broadcast if changed
        this.queueStatusInterval = setInterval(() => {
            const queue = this.globalResources.getQueue();
            if (queue.hasStatusChanged()) {
                const queueStatus = queue.getStatus();
                this.broadcastQueueUpdate(queueStatus);
                return true; // Status was broadcast
            }
        }, 60000); // Every minute
    }

    stopQueueStatusInterval() {
        if (this.queueStatusInterval) {
            clearInterval(this.queueStatusInterval);
            this.queueStatusInterval = null;
        }
    }

    broadcastPing(serverData = null) {
        this.broadcast({
            type: 'ping',
            data: serverData,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Start automatic indexing sync after 1 minute delay
     * Runs sync to index files that don't have search indexes yet
     */
    startIndexingSync() {
        // Wait 1 minute after server start before running initial sync
        setTimeout(() => {
            this.runIndexingSync();
        }, 60000); // 60 seconds = 1 minute
    }

    /**
     * Run indexing sync and broadcast progress updates
     */
    async runIndexingSync() {
        if (this.isIndexing) {
            console.log('⚠️ Indexing sync already in progress, skipping...');
            return;
        }

        if (this.indexingPaused) {
            console.log('⏸️ Indexing is paused, skipping sync...');
            return;
        }

        try {
            this.isIndexing = true;
            const metadataDb = this.globalResources.getMetadataDatabase();
            
            // Broadcast that indexing is starting
            this.broadcast({
                type: 'search_indexing_status',
                job: 'search_sync',
                status: 'starting',
                message: 'Starting search index sync...',
                timestamp: new Date().toISOString()
            });

            // Throttled progress callback setup
            let lastProgressSent = null;
            let lastProgressTime = 0;
            const MIN_PROGRESS_INTERVAL_MS = 2000; // 2 seconds minimum between progress updates
            const DEFAULT_ITEMS_INTERVAL = 100; // Send every 100 items by default
            let progressUpdateInterval = DEFAULT_ITEMS_INTERVAL; // Auto-adjusts based on rate
            let firstProgress = true;

            // Run sync with progress callback
            const result = await metadataDb.syncSearchIndexes((progress) => {
                // Broadcast progress updates with throttling
                if (progress.status === 'indexing') {
                    const now = Date.now();
                    const timeSinceLastUpdate = now - lastProgressTime;
                    const itemsSinceLastUpdate = lastProgressSent ? (progress.current - lastProgressSent.current) : progress.current;
                    
                    // Determine if we should send this update
                    const shouldSend = 
                        firstProgress || // Always send first progress
                        itemsSinceLastUpdate >= progressUpdateInterval || // Every N items (auto-adjusted)
                        timeSinceLastUpdate >= MIN_PROGRESS_INTERVAL_MS; // At least 2 seconds since last update

                    if (shouldSend) {
                        // Auto-adjust interval based on processing rate to maintain ~2 second intervals
                        if (!firstProgress && lastProgressTime > 0 && lastProgressSent && progress.current > 0) {
                            const actualProcessingRate = itemsSinceLastUpdate / (timeSinceLastUpdate / 1000); // items per second
                            
                            if (actualProcessingRate > 0) {
                                // Calculate interval to send updates roughly every 2 seconds
                                // If processing 50 items/sec, we want to send every 100 items (every 2 seconds)
                                const targetInterval = Math.round(actualProcessingRate * (MIN_PROGRESS_INTERVAL_MS / 1000));
                                progressUpdateInterval = Math.max(10, Math.min(500, targetInterval));
                            }
                        }

                        firstProgress = false;
                        lastProgressTime = now;
                        lastProgressSent = progress;

                        const percentage = progress.total > 0 
                            ? Math.round((progress.current / progress.total) * 100) 
                            : 0;
                        
                        this.broadcast({
                            type: 'search_indexing_status',
                            job: 'search_sync',
                            status: 'indexing',
                            message: `Indexing: ${progress.current}/${progress.total} files (${percentage}%)`,
                            current: progress.current,
                            total: progress.total,
                            percentage: percentage,
                            filename: progress.filename,
                            updatedCount: progress.updatedCount,
                            errorCount: progress.errorCount,
                            timestamp: new Date().toISOString()
                        });
                    }
                } else if (progress.status === 'complete') {
                    // Always send completion
                    this.broadcast({
                        type: 'search_indexing_status',
                        job: 'search_sync',
                        status: 'complete',
                        message: `Search index sync complete: ${progress.updatedCount} files indexed`,
                        updatedCount: progress.updatedCount,
                        errorCount: progress.errorCount,
                        totalFiles: progress.total,
                        timestamp: new Date().toISOString()
                    });
                    // Reset progress tracking
                    lastProgressSent = null;
                    lastProgressTime = 0;
                    progressUpdateInterval = DEFAULT_ITEMS_INTERVAL;
                    firstProgress = true;
                } else if (progress.status === 'error') {
                    // Always send errors
                    this.broadcast({
                        type: 'search_indexing_status',
                        job: 'search_sync',
                        status: 'error',
                        message: `Search index sync error: ${progress.error || 'Unknown error'}`,
                        error: progress.error,
                        timestamp: new Date().toISOString()
                    });
                    // Reset progress tracking
                    lastProgressSent = null;
                    lastProgressTime = 0;
                    progressUpdateInterval = DEFAULT_ITEMS_INTERVAL;
                    firstProgress = true;
                } else if (progress.status === 'up_to_date') {
                    // Always send up_to_date status
                    this.broadcast({
                        type: 'search_indexing_status',
                        job: 'search_sync',
                        status: 'up_to_date',
                        message: 'Search index up to date',
                        timestamp: new Date().toISOString()
                    });
                    // Reset progress tracking
                    lastProgressSent = null;
                    lastProgressTime = 0;
                    progressUpdateInterval = DEFAULT_ITEMS_INTERVAL;
                    firstProgress = true;
                }
            });


        } catch (error) {
            console.error('❌ Error running indexing sync:', error);
            this.broadcast({
                type: 'search_indexing_status',
                job: 'search_sync',
                status: 'error',
                message: `Search index sync failed: ${error.message}`,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Set indexing pause state
     */
    setIndexingPaused(paused) {
        this.indexingPaused = paused;
        // Also update metadata database pause state
        const metadataDb = this.globalResources.getMetadataDatabase();
        if (metadataDb && typeof metadataDb.setIndexingPaused === 'function') {
            metadataDb.setIndexingPaused(paused);
        }
        
        // Broadcast pause state change
        this.broadcast({
            type: 'search_indexing_status',
            job: 'search_sync',
            status: paused ? 'paused' : 'resumed',
            message: paused ? 'Search indexing paused' : 'Search indexing resumed',
            timestamp: new Date().toISOString()
        });

        // If resuming and not currently indexing, trigger a scan
        if (!paused && !this.isIndexing) {
            // Wait a moment then run sync
            setTimeout(() => {
                this.runIndexingSync();
            }, 1000);
        }
    }

    /**
     * Check if indexing is paused
     */
    isIndexingPaused() {
        return this.indexingPaused;
    }

    /**
     * Manually trigger indexing sync
     */
    async triggerIndexingSync() {
        if (this.indexingPaused) {
            console.log('⏸️ Cannot trigger indexing sync - indexing is paused');
            return;
        }
        await this.runIndexingSync();
    }

    getPromptIndexService() {
        return this.promptIndexService;
    }

    async sendSearchIndexingSnapshotToClient(ws) {
        const status = this.indexingPaused ? 'paused' : (this.isIndexing ? 'indexing' : 'idle');
        const message = this.indexingPaused
            ? 'Search indexing is paused'
            : (this.isIndexing
                ? 'Search indexing in progress'
                : 'Search index up to date');

        let promptFts = null;
        try {
            promptFts = await this.promptIndexService.getStatusForConnect();
        } catch (error) {
            console.warn('⚠️ Failed to load prompt FTS index status for connect snapshot:', error.message);
        }

        this.sendToClient(ws, {
            type: 'search_indexing_status',
            status,
            message,
            paused: this.indexingPaused,
            indexing: this.isIndexing,
            promptFts,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = { 
    WebSocketServer,
    // tests (scripts/test-ws-phone-round2.js): who reads which broadcast, what waits for a sleeping page
    isPhonePage,
    _test: { socketWantsBroadcast, isPhonePage, isDesktopPage, DORMANT_HOLD, DESKTOP_ONLY_TYPES, PHONE_ONLY_TYPES, BROADCAST_ALL, tmEventHoldKey }
}; 