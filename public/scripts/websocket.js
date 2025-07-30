// WebSocket Client with Auto-Reconnection and Glass Toast
class WebSocketClient {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // Start with 1 second
        this.maxReconnectDelay = 30000; // Max 30 seconds
        this.isConnecting = false;
        this.isManualClose = false;
        this.pingInterval = null;
        this.pingTimeout = null;
        this.messageHandlers = new Map();
        
        // Bind methods
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.reconnect = this.reconnect.bind(this);
        this.send = this.send.bind(this);
        
        // Initialize
        this.init();
    }

    init() {
        // Start connection when page loads
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', this.connect);
        } else {
            this.connect();
        }

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.ws) {
                this.connect();
            }
        });

        // Handle beforeunload
        window.addEventListener('beforeunload', () => {
            this.isManualClose = true;
            this.disconnect();
        });
    }

    connect() {
        if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        this.isConnecting = true;
        
        // Show connecting toast - use global websocket toast ID
        if (typeof showGlassToast === 'function' && typeof window.websocketToastId === 'undefined') {
            window.websocketToastId = showGlassToast('info', null, 'Connecting to server...');
        }

        try {
            // Determine WebSocket URL
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;
            
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('🔌 WebSocket connected');
                this.isConnecting = false;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
                
                // Show connected toast - update existing toast
                if (typeof showGlassToast === 'function' && typeof updateGlassToast === 'function') {
                    try {
                        if (window.websocketToastId) {
                            window.websocketToastId = updateGlassToast(window.websocketToastId, 'success', null, 'Connected to server');
                            // Remove after 3 seconds
                            setTimeout(() => {
                                if (typeof removeGlassToast === 'function' && window.websocketToastId) {
                                    removeGlassToast(window.websocketToastId);
                                    window.websocketToastId = null;
                                }
                            }, 3000);
                        } else {
                            window.websocketToastId = showGlassToast('success', null, 'Connected to server');
                            setTimeout(() => {
                                if (typeof removeGlassToast === 'function' && window.websocketToastId) {
                                    removeGlassToast(window.websocketToastId);
                                    window.websocketToastId = null;
                                }
                            }, 3000);
                        }
                    } catch (error) {
                        console.error('Error updating WebSocket toast:', error);
                        // Reset toast ID if there was an error
                        window.websocketToastId = null;
                    }
                }
                
                // Start ping interval
                this.startPingInterval();
                
                // Trigger connection event
                this.triggerEvent('connected');
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('❌ Failed to parse WebSocket message:', error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('🔌 WebSocket disconnected:', event.code, event.reason);
                this.isConnecting = false;
                this.stopPingInterval();
                
                // Handle authentication failure
                if (event.code === 1008 && event.reason === 'Authentication required') {
                    console.error('❌ WebSocket authentication failed');
                    this.handleAuthError({
                        type: 'auth_error',
                        message: 'Authentication required',
                        code: 'AUTH_REQUIRED'
                    });
                    return;
                }
                
                if (!this.isManualClose) {
                    if (typeof showGlassToast === 'function' && typeof updateGlassToast === 'function') {
                        try {
                            if (window.websocketToastId) {
                                window.websocketToastId = updateGlassToast(window.websocketToastId, 'warning', null, 'Connection lost. Reconnecting...');
                            } else {
                                window.websocketToastId = showGlassToast('warning', null, 'Connection lost. Reconnecting...');
                            }
                        } catch (error) {
                            console.error('Error updating WebSocket toast:', error);
                            window.websocketToastId = null;
                        }
                    }
                    this.reconnect();
                }
                
                // Trigger disconnect event
                this.triggerEvent('disconnected', event);
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.isConnecting = false;
                
                if (!this.isManualClose) {
                    if (typeof showGlassToast === 'function' && typeof updateGlassToast === 'function') {
                        try {
                            if (window.websocketToastId) {
                                window.websocketToastId = updateGlassToast(window.websocketToastId, 'error', null, 'Connection error. Retrying...');
                            } else {
                                window.websocketToastId = showGlassToast('error', null, 'Connection error. Retrying...');
                            }
                        } catch (error) {
                            console.error('Error updating WebSocket toast:', error);
                            window.websocketToastId = null;
                        }
                    }
                }
            };

        } catch (error) {
            console.error('❌ Failed to create WebSocket connection:', error);
            this.isConnecting = false;
            if (typeof showGlassToast === 'function' && typeof updateGlassToast === 'function') {
                try {
                    if (window.websocketToastId) {
                        window.websocketToastId = updateGlassToast(window.websocketToastId, 'error', null, 'Failed to connect');
                    } else {
                        window.websocketToastId = showGlassToast('error', null, 'Failed to connect');
                    }
                } catch (error) {
                    console.error('Error updating WebSocket toast:', error);
                    window.websocketToastId = null;
                }
            }
        }
    }

    disconnect() {
        this.isManualClose = true;
        this.stopPingInterval();
        
        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        }
    }

    reconnect() {
        if (this.isManualClose || this.reconnectAttempts >= this.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                if (typeof showGlassToast === 'function' && typeof updateGlassToast === 'function') {
                    try {
                        if (window.websocketToastId) {
                            window.websocketToastId = updateGlassToast(window.websocketToastId, 'error', null, 'Max reconnection attempts reached');
                        } else {
                            window.websocketToastId = showGlassToast('error', null, 'Max reconnection attempts reached');
                        }
                    } catch (error) {
                        console.error('Error updating WebSocket toast:', error);
                        window.websocketToastId = null;
                    }
                }
            }
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
        
        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            if (!this.isManualClose) {
                this.connect();
            }
        }, delay);
    }

    // Method to force reconnect (used after authentication)
    forceReconnect() {
        console.log('🔄 Force reconnecting WebSocket...');
        this.isManualClose = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.disconnect();
        setTimeout(() => {
            this.connect();
        }, 100);
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('⚠️ WebSocket not connected, message not sent:', message);
        }
    }

    ping() {
        this.send({ type: 'ping' });
        
        // Set ping timeout
        this.pingTimeout = setTimeout(() => {
            console.warn('⚠️ Ping timeout, reconnecting...');
            this.ws?.close();
        }, 5000);
    }

    startPingInterval() {
        this.stopPingInterval();
        this.pingInterval = setInterval(() => {
            this.ping();
        }, 30000); // Ping every 30 seconds
    }

    stopPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
            this.pingTimeout = null;
        }
    }

    handleMessage(message) {
        // Clear ping timeout on pong
        if (message.type === 'pong') {
            if (this.pingTimeout) {
                clearTimeout(this.pingTimeout);
                this.pingTimeout = null;
            }
            return;
        }
        
        // Handle authentication errors
        if (message.type === 'auth_error') {
            console.error('❌ WebSocket authentication error:', message.message);
            this.handleAuthError(message);
            return;
        }
        
        // Handle search responses
        if (message.type === 'search_characters_response' || 
            message.type === 'search_presets_response' || 
            message.type === 'search_dataset_tags_response' ||
            message.type === 'get_dataset_tags_for_path_response' ||
            message.type === 'spellcheck_add_word_response' ||
            message.type === 'search_characters_complete') {
            this.resolveRequest(message.requestId, message.data, message.error);
            return;
        }
        
        // Handle realtime search updates
        if (message.type === 'search_results_update' || message.type === 'search_status_update' || message.type === 'search_results_complete') {
            this.triggerEvent(message.type, message);
            return;
        }
        
        // Trigger message event
        this.triggerEvent('message', message);
        
        // Handle specific message types
        switch (message.type) {
            case 'connection':
                if (message.status === 'connected') {
                    console.log('✅ WebSocket connection confirmed');
                }
                break;
                
            case 'error':
                console.error('❌ WebSocket server error:', message.message);
                // Don't show toast for server errors to avoid spam
                break;
                
            case 'subscribed':
                console.log('✅ Subscribed to channels:', message.channels);
                break;

            case 'generation_started':
                console.log('🎨 Image generation started:', message.requestId);
                // Don't show toast for generation start to avoid spam
                break;

            case 'image_generated':
                console.log('✅ Image generated:', message.requestId);
                // Don't show toast here - let the main app handle it
                this.handleGeneratedImage(message.data);
                break;

            case 'generation_error':
                console.error('❌ Image generation failed:', message.error);
                // Don't show toast here - let the main app handle it
                break;

            case 'preview_ready':
                console.log('🖼️ Preview ready:', message.requestId);
                // Don't show toast here - let the main app handle it
                break;

            case 'preview_error':
                console.error('❌ Preview processing failed:', message.error);
                // Don't show toast here - let the main app handle it
                break;

            case 'gallery_updated':
                console.log('🖼️ Gallery updated:', message.data);
                this.handleGalleryUpdate(message.data);
                break;
                
            default:
                // Handle custom message types
                this.triggerEvent(message.type, message);
        }
    }

    handleAuthError(message) {
        // Show authentication error toast
        if (typeof showGlassToast === 'function') {
            showGlassToast('error', null, 'Authentication required. Please log in.');
        }
        
        // Show PIN modal for authentication
        if (typeof window.showPinModal === 'function') {
            window.showPinModal().then(() => {
                // After successful login, reconnect WebSocket
                console.log('🔄 Reconnecting WebSocket after authentication...');
                this.forceReconnect();
            }).catch((error) => {
                console.error('❌ PIN modal error:', error);
            });
        } else {
            // Fallback: redirect to login page
            console.log('🔄 Redirecting to login page...');
            window.location.href = '/';
        }
    }

    handleGeneratedImage(data) {
        // Handle the generated image data
        // This can be customized based on your needs
        console.log('📸 Generated image data:', {
            filename: data.filename,
            hasImage: !!data.image,
            hasMetadata: !!data.metadata
        });

        // Trigger custom event for image generation
        this.triggerEvent('imageGenerated', data);
    }

    handleGalleryUpdate(data) {
        // Handle gallery update
        console.log('🖼️ Gallery update:', data);

        // Trigger custom event for gallery update
        this.triggerEvent('galleryUpdated', data);
    }

    // Method to request image generation via WebSocket
    generateImage(generationParams, requestId = null) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const id = requestId || `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const message = {
            type: 'generate_image',
            requestId: id,
            data: generationParams,
            timestamp: new Date().toISOString()
        };

        this.send(message);
        return id;
    }

    // Search methods
    async searchCharacters(query, model) {
        try {
            const result = await this.sendMessage('search_characters', { query, model });
            return result;
        } catch (error) {
            console.error('Character search error:', error);
            throw error;
        }
    }

    async searchPresets(query) {
        try {
            const result = await this.sendMessage('search_presets', { query });
            return result;
        } catch (error) {
            console.error('Preset search error:', error);
            throw error;
        }
    }

    async searchDatasetTags(query, path = []) {
        try {
            const result = await this.sendMessage('search_dataset_tags', { query, path });
            return result;
        } catch (error) {
            console.error('Dataset tag search error:', error);
            throw error;
        }
    }

    async getTagsForPath(path = []) {
        try {
            const result = await this.sendMessage('get_dataset_tags_for_path', { path });
            return result;
        } catch (error) {
            console.error('Get tags for path error:', error);
            throw error;
        }
    }

    async addWordToDictionary(word) {
        try {
            const result = await this.sendMessage('spellcheck_add_word', { word });
            return result;
        } catch (error) {
            console.error('Add word to dictionary error:', error);
            throw error;
        }
    }

    // Send message with request/response handling
    sendMessage(type, data = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected()) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const message = {
                type,
                requestId,
                ...data
            };

            // Store pending request
            this.pendingRequests = this.pendingRequests || new Map();
            this.pendingRequests.set(requestId, { resolve, reject });

            try {
                this.send(message);
            } catch (error) {
                this.pendingRequests.delete(requestId);
                reject(error);
            }
        });
    }

    // Resolve pending request
    resolveRequest(requestId, data, error = null) {
        if (this.pendingRequests && this.pendingRequests.has(requestId)) {
            const request = this.pendingRequests.get(requestId);
            this.pendingRequests.delete(requestId);
            if (error) {
                request.reject(error);
            } else {
                request.resolve(data);
            }
        }
    }

    // Event handling
    on(event, handler) {
        if (!this.messageHandlers.has(event)) {
            this.messageHandlers.set(event, []);
        }
        this.messageHandlers.get(event).push(handler);
    }

    off(event, handler) {
        const handlers = this.messageHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    triggerEvent(event, data) {
        const handlers = this.messageHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`❌ Error in event handler for ${event}:`, error);
                }
            });
        }
    }

    // Utility methods
    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    getConnectionState() {
        if (!this.ws) return 'disconnected';
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'connecting';
            case WebSocket.OPEN: return 'connected';
            case WebSocket.CLOSING: return 'closing';
            case WebSocket.CLOSED: return 'disconnected';
            default: return 'unknown';
        }
    }
}

// Create global WebSocket instance
window.wsClient = new WebSocketClient();

// Initialize realtime search functionality
if (typeof initializeRealtimeSearch === 'function') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeRealtimeSearch);
    } else {
        initializeRealtimeSearch();
    }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketClient;
} 