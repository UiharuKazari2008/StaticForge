const WebSocket = require('ws');

class WebSocketServer {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('WebSocketServer requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        const server = globalResources.getHttpServer();
        this.sessionStore = globalResources.getSessionStore();
        
        this.wss = new WebSocket.Server({ server });
        this.clients = new Map(); // Map to store client connections with user info
        this.pingInterval = null;
        this.queueStatusInterval = null;
        this.indexingSyncInterval = null;
        this.isIndexing = false;
        this.indexingPaused = false; // Track if indexing is paused
        this.runtimeCompileProgressByClient = new Map();
        this.runtimeCompileLogsByClient = new Map();
        this.setupWebSocket();
        this.setupPlumbingSubscriptions();
        this.startIndexingSync();
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
                this.broadcast({
                    type: 'service_worker_cache_update',
                    data: {
                        files: data.files || [],
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
        } catch (error) {
            console.error('❌ Failed to set up WebSocket plumbing subscriptions:', error);
            // Retry after a short delay
            setTimeout(() => this.setupPlumbingSubscriptions(), 1000);
        }
    }

    setupWebSocket() {
        this.wss.on('connection', async (ws, req) => {
            console.log('🔌 New WebSocket connection attempt');
            
            // Extract session from request
            const sessionResult = await this.extractSession(req);
            
            // Get client IP address
            const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                            req.headers['x-real-ip'] ||
                            req.connection?.remoteAddress ||
                            req.socket?.remoteAddress ||
                            req.ip ||
                            false;

            // Allow connection even without authentication for critical messages
            // Store client information (may be unauthenticated initially)
            let clientInfo = {
                sessionId: sessionResult?.sessionId || null,
                authenticated: !!(sessionResult && sessionResult.session),
                userType: sessionResult?.userType || null,
                clientIP: clientIP,
                connectedAt: new Date(),
                lastActivity: new Date()
            };

            this.clients.set(ws, clientInfo);

            if (clientInfo.authenticated) {
                console.log(`✅ WebSocket connected (authenticated): Session ${clientInfo.sessionId}`);
            } else {
                console.log(`🔓 WebSocket connected (unauthenticated): Allowing critical messages only`);
            }

            // Handle incoming messages
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
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
            if (clientInfo.authenticated && clientInfo.userType === 'admin') {
                connectionPayload.logViewerPathUuid = this.globalResources.getLogViewerPathUuid();
            }
            if (clientInfo.authenticated) {
                connectionPayload.vfsPathUuid = this.globalResources.getVfsPathUuid();
            }
            this.sendToClient(ws, connectionPayload);

            // Restore session workspace for reconnection sync (only if authenticated)
            if (clientInfo.authenticated && clientInfo.sessionId) {
                await this.restoreSessionWorkspace(clientInfo.sessionId, ws);
                this.sendGalleryScrollStateFromSession(clientInfo.sessionId, ws);
            }

            // Send current indexing state to newly connected client
            this.sendToClient(ws, {
                type: 'search_indexing_status',
                status: this.indexingPaused ? 'paused' : (this.isIndexing ? 'indexing' : 'idle'),
                message: this.indexingPaused 
                    ? 'Search indexing is paused' 
                    : (this.isIndexing 
                        ? 'Search indexing in progress' 
                        : 'Search index up to date'),
                paused: this.indexingPaused,
                indexing: this.isIndexing,
                timestamp: new Date().toISOString()
            });

            // Handle client disconnect
            ws.on('close', (code, reason) => {
                const clientInfo = this.clients.get(ws);
                if (clientInfo) {
                    console.log(`🔌 WebSocket disconnected: Session ${clientInfo.sessionId} - Code: ${code}, Reason: ${reason}`);

                    const handlers = this.globalResources.getWebSocketMessageHandlers();
                    if (handlers && handlers.detachClientActiveGenerations) {
                        handlers.detachClientActiveGenerations(ws);
                    }

                    // Clean up session workspace
                    this.globalResources.getWorkspaceManager().cleanupSessionWorkspace(clientInfo.sessionId);
                    
                    // Clean up metadata cache for this client
                    if (handlers && handlers.cleanupClientCache) {
                        handlers.cleanupClientCache(clientInfo.sessionId);
                    }
                    
                    this.clearRuntimeCompileProgressThrottleForClient(ws);
                    this.clearRuntimeCompileLogsThrottleForClient(ws);
                    this.clients.delete(ws);
                }
            });

            // Handle errors
            ws.on('error', (error) => {
                const clientInfo = this.clients.get(ws);
                console.error(`❌ WebSocket error for session ${clientInfo?.sessionId || 'unknown'}:`, error);

                const handlers = this.globalResources.getWebSocketMessageHandlers();
                if (handlers && handlers.detachClientActiveGenerations) {
                    handlers.detachClientActiveGenerations(ws);
                }

                // Clean up metadata cache for this client if we have session info
                if (clientInfo && clientInfo.sessionId) {
                    if (handlers && handlers.cleanupClientCache) {
                        handlers.cleanupClientCache(clientInfo.sessionId);
                    }
                }
                
                this.clearRuntimeCompileProgressThrottleForClient(ws);
                this.clearRuntimeCompileLogsThrottleForClient(ws);
                this.clients.delete(ws);
            });
        });

        console.log('✓ WebSocket server initialized');
    }

    /**
     * Push saved gallery scroll positions from express session so client can restore after loadGallery.
     */
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

        // Decode the session ID (remove URL encoding and session prefix)
        let sessionId;
        try {
            // URL decode the session ID
            const decoded = decodeURIComponent(encodedSessionId);
            // Remove the session prefix (e.g., "s:" from "s:sessionId.signature")
            sessionId = decoded.replace(/^s:/, '');
            // Remove the signature part (everything after the dot)
            sessionId = sessionId.split('.')[0];
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
            handlers.handleMessage(ws, message, clientInfo, this);
        } catch (error) {
            console.error('❌ Failed to get WebSocket message handlers:', error.message);
            this.sendToClient(ws, {
                type: 'error',
                message: 'Message handler not available',
                timestamp: new Date().toISOString()
            });
        }
    }

    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
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

        this.wss.clients.forEach((client) => {
            if (client.readyState !== WebSocket.OPEN) {
                return;
            }

            const clientInfo = this.clients.get(client);
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

        this.wss.clients.forEach((client) => {
            if (client.readyState !== WebSocket.OPEN) {
                return;
            }

            const clientInfo = this.clients.get(client);
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
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                if (!filter || filter(this.clients.get(client))) {
                    this.sendToClient(client, message);
                }
            }
        });
    }

    /** Alias used by generation quips and admin resource broadcasts. */
    broadcastToAll(message, filter = null) {
        this.broadcast(message, filter);
    }

    sendToUser(sessionId, message) {
        this.wss.clients.forEach(client => {
            const clientInfo = this.clients.get(client);
            if (clientInfo && clientInfo.sessionId === sessionId && client.readyState === WebSocket.OPEN) {
                this.sendToClient(client, message);
            }
        });
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
            // Filter: only send to clients viewing the same workspace
            const clientWorkspace = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            return clientWorkspace === workspaceId;
        });
        
        console.log(`📢 Broadcast image addition to workspace ${workspaceId}: ${Array.isArray(imageFilenames) ? imageFilenames.length : 1} image(s)`);
    }

    startPingInterval(pingCallback = null) {
        // Clear any existing interval
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }

        // Send ping every 10 seconds
        this.pingInterval = setInterval(() => {
            const serverData = pingCallback ? pingCallback() : null;
            this.broadcastPing(serverData);
        }, 10000);
    }

    stopPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
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
}

module.exports = { 
    WebSocketServer
}; 