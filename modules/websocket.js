const WebSocket = require('ws');
const session = require('express-session');

class WebSocketServer {
    constructor(server, sessionStore = null, messageHandler = null) {
        this.wss = new WebSocket.Server({ server });
        this.clients = new Map(); // Map to store client connections with user info
        this.sessionStore = sessionStore;
        this.messageHandler = messageHandler; // Store message handler from web server
        this.setupWebSocket();
    }

    setupWebSocket() {
        this.wss.on('connection', async (ws, req) => {
            console.log('🔌 New WebSocket connection attempt');
            
            // Extract session from request
            const session = await this.extractSession(req);
            
            if (!session || !session.user) {
                console.log('❌ WebSocket connection rejected: No valid session');
                ws.close(1008, 'Authentication required');
                return;
            }

            // Store client with user info
            this.clients.set(ws, {
                userId: session.user.id,
                username: session.user.username,
                connectedAt: new Date()
            });

            console.log(`✅ WebSocket connected: ${session.user.username} (${session.user.id})`);

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
                    console.log('❌ Invalid WebSocket message format:', error);
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
                    console.log(`🔌 WebSocket disconnected: ${clientInfo.username} (${clientInfo.userId}) - Code: ${code}, Reason: ${reason}`);
                    this.clients.delete(ws);
                }
            });

            // Handle errors
            ws.on('error', (error) => {
                const clientInfo = this.clients.get(ws);
                console.log(`❌ WebSocket error for ${clientInfo?.username || 'unknown'}:`, error);
                this.clients.delete(ws);
            });
        });

        console.log('🚀 WebSocket server initialized');
    }

    async extractSession(req) {
        // Parse cookies to get session ID
        const cookies = req.headers.cookie;
        if (!cookies) return null;

        const sessionId = cookies
            .split(';')
            .find(cookie => cookie.trim().startsWith('connect.sid='))
            ?.split('=')[1];

        if (!sessionId) return null;

        try {
            // If we have a session store, verify the session
            if (this.sessionStore) {
                return new Promise((resolve) => {
                    this.sessionStore.get(sessionId, (err, session) => {
                        if (err || !session) {
                            console.log('❌ WebSocket session verification failed:', err);
                            resolve(null);
                            return;
                        }
                        
                        // Check if session has user data
                        if (session.user) {
                            console.log('✅ WebSocket session verified for user:', session.user.username);
                            resolve(session);
                        } else {
                            console.log('❌ WebSocket session has no user data');
                            resolve(null);
                        }
                    });
                });
            } else {
                // Fallback: simple cookie-based verification
                // This is less secure but works without session store
                console.log('⚠️ Using fallback session verification (less secure)');
                return { user: { id: 'user', username: 'user' } };
            }
        } catch (error) {
            console.log('❌ WebSocket session extraction error:', error);
            return null;
        }
    }

    handleMessage(ws, message) {
        const clientInfo = this.clients.get(ws);
        if (!clientInfo) return;

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

    sendToUser(userId, message) {
        this.wss.clients.forEach(client => {
            const clientInfo = this.clients.get(client);
            if (clientInfo && clientInfo.userId === userId && client.readyState === WebSocket.OPEN) {
                this.sendToClient(client, message);
            }
        });
    }

    getConnectedUsers() {
        const users = new Map();
        this.clients.forEach((clientInfo, ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                users.set(clientInfo.userId, clientInfo);
            }
        });
        return Array.from(users.values());
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

    broadcastUserNotification(userId, message, type = 'info') {
        this.sendToUser(userId, {
            type: 'notification',
            data: { message, type },
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