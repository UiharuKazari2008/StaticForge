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
        
        // Show connecting toast
        this.showToast('Connecting to server...', 'info', 'connecting');

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
                
                // Hide connecting toast and show connected toast
                this.hideToast('connecting');
                this.showToast('Connected to server', 'success', 'connected');
                
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
                
                // Hide connected toast
                this.hideToast('connected');
                
                if (!this.isManualClose) {
                    this.showToast('Connection lost. Reconnecting...', 'warning', 'reconnecting');
                    this.reconnect();
                }
                
                // Trigger disconnect event
                this.triggerEvent('disconnected', event);
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.isConnecting = false;
                
                // Hide connecting toast
                this.hideToast('connecting');
                
                if (!this.isManualClose) {
                    this.showToast('Connection error. Retrying...', 'error', 'error');
                }
            };

        } catch (error) {
            console.error('❌ Failed to create WebSocket connection:', error);
            this.isConnecting = false;
            this.hideToast('connecting');
            this.showToast('Failed to connect', 'error', 'error');
        }
    }

    disconnect() {
        this.isManualClose = true;
        this.stopPingInterval();
        
        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        }
        
        // Hide all toasts
        this.hideToast('connecting');
        this.hideToast('connected');
        this.hideToast('reconnecting');
        this.hideToast('error');
    }

    reconnect() {
        if (this.isManualClose || this.reconnectAttempts >= this.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.showToast('Max reconnection attempts reached', 'error', 'max-retries');
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
        console.log('📨 WebSocket message received:', message.type);
        
        // Clear ping timeout on pong
        if (message.type === 'pong') {
            if (this.pingTimeout) {
                clearTimeout(this.pingTimeout);
                this.pingTimeout = null;
            }
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
                this.showToast(`Server error: ${message.message}`, 'error', 'server-error');
                break;
                
            case 'subscribed':
                console.log('✅ Subscribed to channels:', message.channels);
                break;

            case 'generation_started':
                console.log('🎨 Image generation started:', message.requestId);
                this.showToast('Image generation started...', 'info', 'generation-started');
                break;

            case 'image_generated':
                console.log('✅ Image generated:', message.requestId);
                this.showToast('Image generated successfully!', 'success', 'image-generated');
                this.handleGeneratedImage(message.data);
                break;

            case 'generation_error':
                console.error('❌ Image generation failed:', message.error);
                this.showToast(`Generation failed: ${message.error}`, 'error', 'generation-error');
                break;

            case 'preview_ready':
                console.log('🖼️ Preview ready:', message.requestId);
                this.showToast('Preview processing completed!', 'success', 'preview-ready');
                break;

            case 'preview_error':
                console.error('❌ Preview processing failed:', message.error);
                this.showToast(`Preview failed: ${message.error}`, 'error', 'preview-error');
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

    // Toast notifications
    showToast(message, type = 'info', id = null) {
        const toast = document.createElement('div');
        toast.className = `glass-toast glass-toast-${type}`;
        toast.innerHTML = `
            <div class="glass-toast-content">
                <div class="glass-toast-message">${message}</div>
                <button class="glass-toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        
        if (id) {
            toast.id = `toast-${id}`;
        }
        
        // Add to toast container
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        
        container.appendChild(toast);
        
        // Auto-remove after 5 seconds for non-persistent toasts
        if (!id || !['connecting', 'connected', 'reconnecting'].includes(id)) {
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 5000);
        }
    }

    hideToast(id) {
        const toast = document.getElementById(`toast-${id}`);
        if (toast) {
            toast.remove();
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

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketClient;
} 