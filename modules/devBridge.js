const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const DevBridgeDatabase = require('./devBridgeDatabase');

class DevBridgeServer {
    constructor(config) {
        this.config = config;
        this.wss = null;
        this.clients = new Map();
        this.database = new DevBridgeDatabase();
        this.activeClient = null;
        this.masterClient = null;
        this.masterSessions = new Map(); // Track master sessions
        
        if (config.enable_dev) {
            this.initialize();
        }
    }

    initialize() {
        console.log('🔧 Initializing Development Bridge WebSocket Server...');
        
        // Check if WebSocket server already exists
        if (this.wss) {
            console.log('⚠️ WebSocket server already exists, closing previous instance...');
            this.wss.close();
        }
        
        // Create pure WebSocket server on separate port
        const devPort = this.config.devPort || 9221;
        this.wss = new WebSocket.Server({ port: devPort });
        
        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });
        
        this.wss.on('listening', () => {
            console.log(`✅ Development Bridge WebSocket Server listening on port ${devPort}/devBridge`);
        });

        console.log('✅ Development Bridge WebSocket Server initialized on separate port');
    }

    handleConnection(ws, req) {
        const clientId = uuidv4();
        const clientInfo = {
            id: clientId,
            ws: ws,
            ip: req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            connectedAt: Date.now(),
            sessionId: null,
            url: null,
            isActive: false,
            isMaster: false,
            masterSessionId: null
        };

        this.clients.set(clientId, clientInfo);
        console.log(`🔗 Dev Bridge client connected: ${clientId}`);

        // Send welcome message
        this.sendToClient(clientId, {
            type: 'welcome',
            clientId: clientId,
            message: 'Connected to Development Bridge',
            timestamp: Date.now()
        });

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleMessage(clientId, message);
            } catch (error) {
                console.error('❌ Invalid message from dev bridge client:', error);
                this.sendToClient(clientId, {
                    type: 'error',
                    message: 'Invalid message format',
                    timestamp: Date.now()
                });
            }
        });

        ws.on('close', () => {
            console.log(`🔌 Dev Bridge client disconnected: ${clientId}`);
            
            // If this was the master client, clear it
            if (this.masterClient && this.masterClient.id === clientId) {
                this.masterClient = null;
                console.log('🔧 Master client disconnected');
            }
            
            // If this was the active client, clear it
            if (this.activeClient === clientId) {
                this.activeClient = null;
                console.log('📱 Active client cleared');
            }
            
            this.clients.delete(clientId);
        });

        ws.on('error', (error) => {
            console.error(`❌ Dev Bridge client error (${clientId}):`, error);
        });
    }

    handleMessage(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client) return;

        switch (message.type) {
            case 'log':
                this.handleLogMessage(clientId, message);
                break;
            case 'error':
                this.handleErrorMessage(clientId, message);
                break;
            case 'network':
                this.handleNetworkMessage(clientId, message);
                break;
            case 'screenshot':
                this.handleScreenshotMessage(clientId, message);
                break;
            case 'execute_code':
                this.handleCodeExecution(clientId, message);
                break;
            case 'query_elements':
                this.handleElementQuery(clientId, message);
                break;
            case 'trigger_event':
                this.handleEventTrigger(clientId, message);
                break;
            case 'take_ownership':
                this.handleTakeOwnership(clientId, message);
                break;
            case 'register_master_client':
                this.handleRegisterMasterClient(clientId, message);
                break;
            case 'claim_master':
                this.handleClaimMaster(clientId, message);
                break;
            case 'force_master':
                this.handleForceMaster(clientId, message);
                break;
            case 'check_master_status':
                this.handleCheckMasterStatus(clientId, message);
                break;
            case 'ping':
                this.sendToClient(clientId, { type: 'pong', timestamp: Date.now() });
                break;
            case 'mcp_request':
                this.handleMCPRequest(clientId, message);
                break;
            default:
                console.log(`📨 Unknown message type from dev bridge client: ${message.type}`);
        }
    }

    handleLogMessage(clientId, message) {
        const logData = {
            timestamp: Date.now(),
            type: message.logType || 'log',
            level: message.level || 'info',
            message: message.message || '',
            stackTrace: message.stackTrace || null,
            url: message.url || null,
            userAgent: this.clients.get(clientId)?.userAgent || null,
            sessionId: this.clients.get(clientId)?.sessionId || null,
            clientId: clientId,
            data: message.data || null
        };

        this.database.logMessage(logData).catch(error => {
            console.error('❌ Failed to log message to database:', error);
        });

        // Forward to active client if different
        if (this.activeClient && this.activeClient !== clientId) {
            this.sendToClient(this.activeClient, {
                type: 'client_log',
                clientId: clientId,
                ...logData
            });
        }
    }

    handleErrorMessage(clientId, message) {
        const logData = {
            timestamp: Date.now(),
            type: 'error',
            level: 'error',
            message: message.message || 'Unknown error',
            stackTrace: message.stackTrace || null,
            url: message.url || null,
            userAgent: this.clients.get(clientId)?.userAgent || null,
            sessionId: this.clients.get(clientId)?.sessionId || null,
            clientId: clientId,
            data: message.data || null
        };

        this.database.logMessage(logData).catch(error => {
            console.error('❌ Failed to log error to database:', error);
        });

        // Forward to active client if different
        if (this.activeClient && this.activeClient !== clientId) {
            this.sendToClient(this.activeClient, {
                type: 'client_error',
                clientId: clientId,
                ...logData
            });
        }
    }

    handleNetworkMessage(clientId, message) {
        const networkData = {
            timestamp: Date.now(),
            type: message.networkType || 'request',
            url: message.url || '',
            method: message.method || null,
            statusCode: message.statusCode || null,
            responseTime: message.responseTime || null,
            requestSize: message.requestSize || null,
            responseSize: message.responseSize || null,
            userAgent: this.clients.get(clientId)?.userAgent || null,
            sessionId: this.clients.get(clientId)?.sessionId || null,
            clientId: clientId,
            headers: message.headers || null,
            body: message.body || null
        };

        this.database.logNetworkRequest(networkData).catch(error => {
            console.error('❌ Failed to log network request to database:', error);
        });

        // Forward to active client if different
        if (this.activeClient && this.activeClient !== clientId) {
            this.sendToClient(this.activeClient, {
                type: 'client_network',
                clientId: clientId,
                ...networkData
            });
        }
    }

    handleScreenshotMessage(clientId, message) {
        const screenshotData = {
            timestamp: Date.now(),
            clientId: clientId,
            sessionId: this.clients.get(clientId)?.sessionId || null,
            url: message.url || null,
            screenshotData: message.screenshotData || '',
            elementSelector: message.elementSelector || null,
            width: message.width || null,
            height: message.height || null
        };

        this.database.saveScreenshot(screenshotData).catch(error => {
            console.error('❌ Failed to save screenshot to database:', error);
        });

        // Forward to active client if different
        if (this.activeClient && this.activeClient !== clientId) {
            this.sendToClient(this.activeClient, {
                type: 'client_screenshot',
                clientId: clientId,
                ...screenshotData
            });
        }
    }

    handleCodeExecution(clientId, message) {
        const startTime = Date.now();
        
        // Send code execution request to the client
        this.sendToClient(clientId, {
            type: 'execute_code_request',
            code: message.code,
            requestId: message.requestId || uuidv4(),
            timestamp: startTime
        });
    }

    handleElementQuery(clientId, message) {
        // Send element query request to the client
        this.sendToClient(clientId, {
            type: 'query_elements_request',
            selector: message.selector,
            requestId: message.requestId || uuidv4(),
            timestamp: Date.now()
        });
    }

    handleEventTrigger(clientId, message) {
        // Send event trigger request to the client
        this.sendToClient(clientId, {
            type: 'trigger_event_request',
            selector: message.selector,
            eventType: message.eventType,
            eventData: message.eventData,
            requestId: message.requestId || uuidv4(),
            timestamp: Date.now()
        });
    }

    handleTakeOwnership(clientId, message) {
        const client = this.clients.get(clientId);
        if (client) {
            // Clear previous active client
            if (this.activeClient && this.activeClient !== clientId) {
                const prevClient = this.clients.get(this.activeClient);
                if (prevClient) {
                    prevClient.isActive = false;
                    this.sendToClient(this.activeClient, {
                        type: 'ownership_released',
                        timestamp: Date.now()
                    });
                }
            }

            // Set new active client
            this.activeClient = clientId;
            client.isActive = true;
            client.sessionId = message.sessionId || null;
            client.url = message.url || null;

            console.log(`📱 Client ${clientId} took ownership of debugging session`);
            
            this.sendToClient(clientId, {
                type: 'ownership_granted',
                timestamp: Date.now(),
                message: 'You are now the active debugging client'
            });
        }
    }

    sendToClient(clientId, message) {
        const client = this.clients.get(clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`❌ Failed to send message to client ${clientId}:`, error);
            }
        }
    }

    broadcastToAll(message) {
        this.clients.forEach((client, clientId) => {
            this.sendToClient(clientId, message);
        });
    }

    getActiveClient() {
        return this.activeClient ? this.clients.get(this.activeClient) : null;
    }

    getClientList() {
        return Array.from(this.clients.values()).map(client => ({
            id: client.id,
            ip: client.ip,
            userAgent: client.userAgent,
            connectedAt: client.connectedAt,
            sessionId: client.sessionId,
            url: client.url,
            isActive: client.isActive
        }));
    }

    handleRegisterMasterClient(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client) return;

        client.sessionId = message.sessionId;
        client.url = message.url;
        client.isMaster = message.isMaster || false;
        client.masterSessionId = message.sessionId;

        console.log(`🔧 Master Window: Client ${clientId} registered as ${client.isMaster ? 'master' : 'client'}`);

        // If this client claims to be master, check for conflicts
        if (client.isMaster) {
            this.handleMasterClaim(clientId, message);
        }
    }

    handleClaimMaster(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client) return;

        client.sessionId = message.sessionId;
        client.url = message.url;
        client.masterSessionId = message.sessionId;

        this.handleMasterClaim(clientId, message);
    }

    handleMasterClaim(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client) return;

        // Check if there's already a master client
        if (this.masterClient && this.masterClient.id !== clientId) {
            console.log(`🔧 Master Window: Conflict detected - ${this.masterClient.id} is already master`);
            
            // Send conflict notification to the new client
            this.sendToClient(clientId, {
                type: 'master_conflict',
                currentMaster: {
                    id: this.masterClient.id,
                    sessionId: this.masterClient.masterSessionId,
                    url: this.masterClient.url,
                    connectedAt: this.masterClient.connectedAt
                },
                timestamp: Date.now()
            });
        } else {
            // Grant master status
            this.setMasterClient(clientId);
            this.sendToClient(clientId, {
                type: 'master_granted',
                timestamp: Date.now()
            });
        }
    }

    handleForceMaster(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client) return;

        console.log(`🔧 Master Window: Force master request from ${clientId}`);

        // If there's an existing master, kick it
        if (this.masterClient && this.masterClient.id !== clientId) {
            console.log(`🔧 Master Window: Kicking existing master ${this.masterClient.id}`);
            
            // Send kick notification to existing master
            this.sendToClient(this.masterClient.id, {
                type: 'master_kicked',
                newMaster: {
                    id: clientId,
                    sessionId: message.sessionId,
                    url: message.url
                },
                timestamp: Date.now()
            });

            // Clear master status from existing client
            this.masterClient.isMaster = false;
        }

        // Set new master
        this.setMasterClient(clientId);
        client.sessionId = message.sessionId;
        client.url = message.url;
        client.masterSessionId = message.sessionId;

        this.sendToClient(clientId, {
            type: 'master_granted',
            timestamp: Date.now()
        });
    }

    handleCheckMasterStatus(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client) return;

        // If this client thinks it's master but isn't, notify it
        if (message.isMaster && (!this.masterClient || this.masterClient.id !== clientId)) {
            this.sendToClient(clientId, {
                type: 'master_denied',
                currentMaster: this.masterClient ? {
                    id: this.masterClient.id,
                    sessionId: this.masterClient.masterSessionId,
                    url: this.masterClient.url
                } : null,
                timestamp: Date.now()
            });
        }
    }

    setMasterClient(clientId) {
        const client = this.clients.get(clientId);
        if (!client) return;

        // Clear previous master
        if (this.masterClient) {
            this.masterClient.isMaster = false;
        }

        // Set new master
        this.masterClient = client;
        client.isMaster = true;

        // Also set as active client if not already set
        if (!this.activeClient) {
            this.activeClient = clientId;
            client.isActive = true;
        }

        console.log(`🔧 Master Window: ${clientId} is now the master client`);
    }

    handleMCPRequest(clientId, message) {
        const { requestId, requestType, data, targetClientId } = message;
        const targetClient = targetClientId || this.activeClient;
        
        if (!targetClient) {
            this.sendToClient(clientId, {
                type: 'mcp_response',
                requestId,
                success: false,
                error: 'No active client available'
            });
            return;
        }

        // Handle different MCP request types
        switch (requestType) {
            case 'get_logs':
                this.handleMCPGetLogs(clientId, requestId, data);
                break;
            case 'get_network_logs':
                this.handleMCPGetNetworkLogs(clientId, requestId, data);
                break;
            case 'get_screenshots':
                this.handleMCPGetScreenshots(clientId, requestId, data);
                break;
            case 'get_code_executions':
                this.handleMCPGetCodeExecutions(clientId, requestId, data);
                break;
            case 'get_clients':
                this.handleMCPGetClients(clientId, requestId);
                break;
            case 'screenshot':
                this.handleMCPScreenshot(clientId, requestId, data, targetClient);
                break;
            case 'execute_code':
                this.handleMCPExecuteCode(clientId, requestId, data, targetClient);
                break;
            default:
                this.sendToClient(clientId, {
                    type: 'mcp_response',
                    requestId,
                    success: false,
                    error: `Unknown MCP request type: ${requestType}`
                });
        }
    }

    async handleMCPGetLogs(clientId, requestId, data) {
        try {
            const logs = await this.database.getLogs(data);
            this.sendToClient(clientId, {
                type: 'mcp_response',
                requestId,
                success: true,
                data: { logs, totalCount: logs.length }
            });
        } catch (error) {
            this.sendToClient(clientId, {
                type: 'mcp_response',
                requestId,
                success: false,
                error: error.message
            });
        }
    }

    async handleMCPGetNetworkLogs(clientId, requestId, data) {
        try {
            const logs = await this.database.getNetworkLogs(data);
            this.sendToClient(clientId, {
                type: 'mcp_response',
                requestId,
                success: true,
                data: { logs, totalCount: logs.length }
            });
        } catch (error) {
            this.sendToClient(clientId, {
                type: 'mcp_response',
                requestId,
                success: false,
                error: error.message
            });
        }
    }

    async handleMCPGetScreenshots(clientId, requestId, data) {
        try {
            const screenshots = await this.database.getScreenshots(data);
            this.sendToClient(clientId, {
                type: 'mcp_response',
                requestId,
                success: true,
                data: { screenshots, totalCount: screenshots.length }
            });
        } catch (error) {
            this.sendToClient(clientId, {
                type: 'mcp_response',
                requestId,
                success: false,
                error: error.message
            });
        }
    }

    async handleMCPGetCodeExecutions(clientId, requestId, data) {
        try {
            const executions = await this.database.getCodeExecutions(data);
            this.sendToClient(clientId, {
                type: 'mcp_response',
                requestId,
                success: true,
                data: { executions, totalCount: executions.length }
            });
        } catch (error) {
            this.sendToClient(clientId, {
                type: 'mcp_response',
                requestId,
                success: false,
                error: error.message
            });
        }
    }

    handleMCPGetClients(clientId, requestId) {
        const clients = this.getClientList();
        const activeClient = this.getActiveClient();
        const masterClient = this.getMasterClient();
        
        this.sendToClient(clientId, {
            type: 'mcp_response',
            requestId,
            success: true,
            data: {
                clients,
                activeClient,
                masterClient
            }
        });
    }

    handleMCPScreenshot(clientId, requestId, data, targetClientId) {
        // Send screenshot request to target client
        this.sendToClient(targetClientId, {
            type: 'screenshot_request',
            selector: data.selector,
            requestId: requestId,
            timestamp: Date.now()
        });

        // Send immediate response to MCP client
        this.sendToClient(clientId, {
            type: 'mcp_response',
            requestId,
            success: true,
            data: { message: 'Screenshot request sent to client' }
        });
    }

    handleMCPExecuteCode(clientId, requestId, data, targetClientId) {
        // Send code execution request to target client
        this.sendToClient(targetClientId, {
            type: 'execute_code_request',
            code: data.code,
            requestId: requestId,
            timestamp: Date.now()
        });

        // Send immediate response to MCP client
        this.sendToClient(clientId, {
            type: 'mcp_response',
            requestId,
            success: true,
            data: { message: 'Code execution request sent to client' }
        });
    }

    getMasterClient() {
        return this.masterClient;
    }

    getDatabase() {
        return this.database;
    }

    close() {
        if (this.wss) {
            this.wss.close();
        }
        if (this.database) {
            this.database.close();
        }
    }
}

module.exports = DevBridgeServer;
