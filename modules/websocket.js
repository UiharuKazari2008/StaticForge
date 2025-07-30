const WebSocket = require('ws');
const session = require('express-session');

class WebSocketServer {
    constructor(server, sessionStore = null, messageHandler = null) {
        this.wss = new WebSocket.Server({ server });
        this.clients = new Map(); // Map to store client connections with user info
        this.sessionStore = sessionStore;
        this.messageHandler = messageHandler; // Store message handler from web server
        this.pingInterval = null;
        this.setupWebSocket();
    }

    setupWebSocket() {
        this.wss.on('connection', async (ws, req) => {
            console.log('🔌 New WebSocket connection attempt');
            
            // Extract session from request
            const sessionResult = await this.extractSession(req);
            
            if (!sessionResult || !sessionResult.session) {
                console.error('❌ WebSocket connection rejected: No valid session');
                ws.close(1008, 'Authentication required');
                return;
            }

            const { session, sessionId } = sessionResult;

            // Store client with session info (no user object needed)
            this.clients.set(ws, {
                sessionId: sessionId, // Use the decoded session ID we already have
                authenticated: true,
                connectedAt: new Date()
            });

            console.log(`✅ WebSocket connected: Session ${sessionId}`);

            // Send welcome message
            this.sendToClient(ws, {
                type: 'connection',
                status: 'connected',
                message: 'WebSocket connection established',
                timestamp: new Date().toISOString()
            });

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

            // Handle client disconnect
            ws.on('close', (code, reason) => {
                const clientInfo = this.clients.get(ws);
                if (clientInfo) {
                    console.log(`🔌 WebSocket disconnected: Session ${clientInfo.sessionId} - Code: ${code}, Reason: ${reason}`);
                    this.clients.delete(ws);
                }
            });

            // Handle errors
            ws.on('error', (error) => {
                const clientInfo = this.clients.get(ws);
                console.error(`❌ WebSocket error for session ${clientInfo?.sessionId || 'unknown'}:`, error);
                this.clients.delete(ws);
            });
        });

        console.log('🚀 WebSocket server initialized');
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
                        if (err || !session) {
                            console.error('❌ WebSocket session verification failed:', err);
                            resolve(null);
                            return;
                        }
                        
                        // Check if session is authenticated (this is the key check)
                        if (session.authenticated === true) {
                            console.log('✅ WebSocket session verified for authenticated session:', sessionId);
                            resolve({ session, sessionId });
                        } else {
                            console.error('❌ WebSocket session not authenticated:', sessionId);
                            resolve(null);
                        }
                    });
                });
            } else {
                // Fallback: simple cookie-based verification
                // This is less secure but works without session store
                console.log('⚠️ Using fallback session verification (less secure)');
                // For fallback, we can't verify the session content, so we reject all connections
                // This ensures security when no session store is available
                console.error('❌ Fallback session verification: rejecting connection (no session store)');
                return null;
            }
        } catch (error) {
            console.error('❌ WebSocket session extraction error:', error);
            return null;
        }
    }

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

        // Check if client is authenticated
        if (!clientInfo.authenticated) {
            this.sendToClient(ws, {
                type: 'auth_error',
                message: 'Authentication required',
                code: 'AUTH_REQUIRED',
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Use the message handler passed from web server if available
        if (this.messageHandler) {
            this.messageHandler(ws, message, clientInfo, this);
            return;
        }

        // Fallback to default message handling
        switch (message.type) {
            case 'ping':
                this.sendToClient(ws, {
                    type: 'pong',
                    timestamp: new Date().toISOString()
                });
                break;

            case 'subscribe':
                // Handle subscription to specific events
                this.sendToClient(ws, {
                    type: 'subscribed',
                    channels: message.channels || [],
                    timestamp: new Date().toISOString()
                });
                break;

            default:
                this.sendToClient(ws, {
                    type: 'error',
                    message: 'Unknown message type',
                    timestamp: new Date().toISOString()
                });
        }
    }



    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
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

    sendToUser(sessionId, message) {
        this.wss.clients.forEach(client => {
            const clientInfo = this.clients.get(client);
            if (clientInfo && clientInfo.sessionId === sessionId && client.readyState === WebSocket.OPEN) {
                this.sendToClient(client, message);
            }
        });
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

    // Method to update message handler
    updateMessageHandler(newMessageHandler) {
        this.messageHandler = newMessageHandler;
        console.log('🔄 WebSocket message handler updated');
    }

    // Method to get current message handler
    getMessageHandler() {
        return this.messageHandler;
    }

    // Utility methods for broadcasting specific events
    broadcastImageGenerated(imageData) {
        this.broadcast({
            type: 'image_generated',
            data: imageData,
            timestamp: new Date().toISOString()
        });
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

    broadcastUserNotification(sessionId, message, type = 'info') {
        this.sendToUser(sessionId, {
            type: 'notification',
            data: { message, type },
            timestamp: new Date().toISOString()
        });
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

    broadcastPing(serverData = null) {
        this.broadcast({
            type: 'ping',
            data: serverData,
            timestamp: new Date().toISOString()
        });
    }
}

// Global instance for use in other modules
let globalWsServer = null;

function setGlobalWsServer(wsServer) {
    globalWsServer = wsServer;
}

function getGlobalWsServer() {
    return globalWsServer;
}

module.exports = { WebSocketServer, setGlobalWsServer, getGlobalWsServer }; 