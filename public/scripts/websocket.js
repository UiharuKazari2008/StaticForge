// Banner Manager for WebSocket Status and Updates
class BannerManager {
    constructor() {
        this.websocketToastId = null;
        this.init();
    }
    
    init() {
        // No initialization needed for glass toasts
    }
    
    showWebSocketToast(status, message, icon, autoHide = false, hideDelay = 3000) {
        // If we already have a toast, update it instead of creating a new one
        if (this.websocketToastId && typeof updateGlassToastComplete === 'function') {
            this.updateWebSocketToast(status, message, icon);
            return;
        }
        
        // Create new toast only if we don't have one
        if (typeof showGlassToast === 'function') {
            this.websocketToastId = showGlassToast(
                status === 'connected' ? 'success' : 
                status === 'error' ? 'error' : 
                status === 'warning' ? 'warning' : 'info',
                status === 'connected' ? 'Connected' : 
                status === 'error' ? 'Connection Error' : 
                status === 'warning' ? 'Connection Warning' : 'Connecting',
                message,
                false, // No progress bar
                autoHide ? hideDelay : false, // Only auto-hide if specified
                icon
            );
        }
    }
    
    updateWebSocketToast(status, message, icon) {
        if (!this.websocketToastId || typeof updateGlassToastComplete !== 'function') {
            return;
        }
        
        // Update the existing toast
        updateGlassToastComplete(this.websocketToastId, {
            type: status === 'connected' ? 'success' : 
                  status === 'error' ? 'error' : 
                  status === 'warning' ? 'warning' : 'info',
            title: status === 'connected' ? 'Connected' : 
                   status === 'error' ? 'Connection Error' : 
                   status === 'warning' ? 'Connection Warning' : 'Connecting',
            message: message,
            customIcon: icon
        });
    }
    
    hideWebSocketToast() {
        if (this.websocketToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.websocketToastId);
            this.websocketToastId = null;
        }
    }
    
    // Legacy method names for compatibility
    showWebSocketBanner(status, message, icon, autoHide = false, hideDelay = 3000) {
        this.showWebSocketToast(status, message, icon, autoHide, hideDelay);
    }
    
    hideWebSocketBanner() {
        this.hideWebSocketToast();
    }
    
    updateWebSocketBanner(status, message, icon) {
        this.updateWebSocketToast(status, message, icon);
    }
}

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
        
        // Loading overlay properties
        this.loadingOverlay = null;
        this.initSteps = [];
        this.currentInitStep = 0;
        this.totalInitSteps = 0;
        this.initializationCompleted = false; // Track if initialization has been completed
        
        // Pending requests tracking
        this.pendingRequestsCount = 0;
        this.pendingRequestsSpinner = null;
        this.pendingRequestsBadge = null;
        
        // Banner manager for status updates
        this.bannerManager = new BannerManager();
        
        // Bind methods
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.reconnect = this.reconnect.bind(this);
        this.send = this.send.bind(this);
        
        // Initialize
        this.init();
    }

    // Ping host over HTTP before attempting WebSocket connection
    async pingHost() {
        const maxPingAttempts = 15;
        const pingInterval = 1000; // 1 second between attempts
        
        for (let attempt = 1; attempt <= maxPingAttempts; attempt++) {
            try {
                this.updateLoadingProgress(`Checking Connection (${attempt}/${maxPingAttempts})...`, 5 + (attempt * 2));
                
                // Try to fetch a simple endpoint to ping the host
                const response = await fetch('/', {
                    method: 'HEAD',
                    cache: 'no-cache',
                    signal: AbortSignal.timeout(5000) // 5 second timeout
                });
                
                if (response.ok) {
                    return true;
                }
            } catch (error) {
                console.warn(`⚠️ Ping attempt ${attempt} failed:`, error.message);
                
                if (attempt < maxPingAttempts) {
                    // Wait before next attempt
                    await new Promise(resolve => setTimeout(resolve, pingInterval));
                }
            }
        }
        
        // If all ping attempts failed, throw an error
        throw new Error(`Host not responding after ${maxPingAttempts} attempts`);
    }

    // Loading overlay methods
    showLoadingOverlay(message = 'Connecting...', progress = 0) {
        if (!this.loadingOverlay) {
            this.createLoadingOverlay();
        }
        document.body.classList.add('initializing');
        this.loadingOverlay.classList.remove('hidden');
        this.updateLoadingProgress(message, progress);
    }

    hideLoadingOverlay() {
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.add('hidden');
        }
        document.body.classList.remove('initializing');
    }

    updateLoadingProgress(message, progress) {
        if (!this.loadingOverlay) return;
        
        const messageEl = this.loadingOverlay.querySelector('.loading-message');
        const progressBar = this.loadingOverlay.querySelector('.loading-progress-bar');
        
        if (messageEl) messageEl.textContent = message;
        if (progressBar) progressBar.style.width = `${progress}%`;
    }

    createLoadingOverlay() {
        this.loadingOverlay = document.createElement('div');
        this.loadingOverlay.className = 'loading-overlay';
        this.loadingOverlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-message">Connecting...</div>
                <div class="loading-progress">
                    <div class="loading-progress-bar"></div>
                </div>
            </div>
        `;
        document.body.appendChild(this.loadingOverlay);
    }

    registerInitStep(priority, message, stepFunction, runOnReconnect = false) {
        // Check if step with same message already exists
        const existingStepIndex = this.initSteps.findIndex(step => step.message === message);
        if (existingStepIndex !== -1) {
            this.initSteps[existingStepIndex] = { priority, message, stepFunction, runOnReconnect };
        } else {
            this.initSteps.push({ priority, message, stepFunction, runOnReconnect });
        }
        
        // Sort by priority
        this.initSteps.sort((a, b) => a.priority - b.priority);
        this.totalInitSteps = this.initSteps.length;
    }

    // Method to remove a specific initialization step
    removeInitStep(message) {
        const index = this.initSteps.findIndex(step => step.message === message);
        if (index !== -1) {
            this.initSteps.splice(index, 1);
            this.totalInitSteps = this.initSteps.length;
            return true;
        }
        return false;
    }

    // Method to clear all initialization steps
    clearInitSteps() {
        this.initSteps = [];
        this.totalInitSteps = 0;
        this.initializationCompleted = false;
    }

    // Method to get current WebSocket client status
    getStatus() {
        return {
            connectionState: this.getConnectionState(),
            isConnected: this.isConnected(),
            isConnecting: this.isConnecting,
            reconnectAttempts: this.reconnectAttempts,
            maxReconnectAttempts: this.maxReconnectAttempts,
            initializationCompleted: this.initializationCompleted,
            totalInitSteps: this.totalInitSteps,
            currentInitStep: this.currentInitStep,
            pendingRequestsCount: this.pendingRequestsCount,
            isManualClose: this.isManualClose
        };
    }

    // Method to manually trigger initialization (useful for testing or manual refresh)
    async manualInit() {
        if (this.initializationCompleted) {
            this.initializationCompleted = false;
        }
        return this.executeInitSteps();
    }

    // Get cache manifest from server
    async getCacheManifest() {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        // Use the existing sendMessage pattern that the client already uses
        return this.sendMessage('get_cache_manifest');
    }

    async executeInitSteps() {
        // Prevent duplicate initialization on reconnection
        if (this.initializationCompleted) {
            this.hideLoadingOverlay();
            return;
        }
        
        // Safety check for empty init steps
        if (!this.initSteps || this.initSteps.length === 0) {
            this.initializationCompleted = true;
            this.hideLoadingOverlay();
            return;
        }
        
        this.currentInitStep = 0;
        this.totalInitSteps = this.initSteps.length;
                
        try {
            for (const step of this.initSteps) {
                this.currentInitStep++;
                // Calculate progress: 25% (initial steps) + 75% (registered steps)
                // Each registered step gets a portion of the remaining 75%
                const stepProgress = 25 + ((this.currentInitStep / this.totalInitSteps) * 75);
                this.updateLoadingProgress(step.message, stepProgress);
                
                // On reconnection, only run steps flagged as runOnReconnect
                if (this.initializationCompleted && !step.runOnReconnect) {
                    console.log(`⏭️ Skipping step "${step.message}" on reconnect (not flagged as runOnReconnect)`);
                    continue;
                }
                                
                try {
                    await step.stepFunction();   // run the step
                } catch (error) {
                    console.error(`❌ Error in init step "${step.message}":`, error);
                }
            }
            
            // Mark initialization as completed
            this.initializationCompleted = true;
            
            // Hide overlay after all steps complete
            setTimeout(() => {
                this.hideLoadingOverlay();
            }, 500);
        } catch (error) {
            console.error('❌ Error during initialization:', error);
            this.updateLoadingProgress('Initialization failed', 100);
            setTimeout(() => {
                this.hideLoadingOverlay();
            }, 2000);
        }
    }

    // Initialize the websocket client with proper sequence
    async init() {
        // Show loading overlay immediately
        this.showLoadingOverlay('Initializing...', 0);
        
        // Initialize pending requests spinner
        this.updatePendingRequestsSpinner();
        
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

        // Handle page focus events
        window.addEventListener('focus', () => {
            if (!this.isConnected() && !this.isConnecting) {
                this.connect();
            }
        });
    }

    async connect() {
        if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        this.isConnecting = true;
        this.updateLoadingProgress('Checking connection...', 0);
        
        // Show connecting toast
        this.bannerManager.showWebSocketToast('connecting', 'Connecting...', '<i class="fas fa-signal"></i>');

        try {
            // Step 1: First ping the host over HTTP to ensure it's responsive
            try {
                await this.pingHost();
                this.updateLoadingProgress('Initializing components...', 15);
            } catch (pingError) {
                console.error('❌ Host availability check failed:', pingError.message);
                this.isConnecting = false;
                
                // Show ping failure toast
                this.bannerManager.updateWebSocketToast('error', 'Server not responding. Retrying...', '<i class="fas fa-exclamation-triangle"></i>');
                
                // Retry connection after a delay
                setTimeout(() => {
                    this.reconnect();
                }, 3000);
                return;
            }
            
            // Step 3: Now attempt WebSocket connection
            this.updateLoadingProgress('Connecting to Server...', 25);
            
            // Determine WebSocket URL
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;
            
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('🔌 WebSocket connected successfully');
                this.isConnecting = false;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
                
                // Show connected toast and auto-hide after 3 seconds
                this.bannerManager.updateWebSocketToast('connected', 'Connected to server', '<i class="fas fa-plug"></i>');
                setTimeout(() => {
                    this.bannerManager.hideWebSocketToast();
                }, 3000);
                
                // Trigger connection event
                this.triggerEvent('connected');
                
                // Complete any remaining initialization steps
                if (!this.initializationCompleted) {
                    this.executeInitSteps();
                } else {
                    this.hideLoadingOverlay();
                    // ON CONNECT CHECK IN WITH SERVICE WORKER TO SEE IF IT HAS UPDATES
                }
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
                
                // Reset generation button state if generation was interrupted
                if (typeof updateManualGenerateBtnState === 'function') {
                    updateManualGenerateBtnState();
                }
                
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
                    this.bannerManager.updateWebSocketToast('warning', 'Connection lost. Reconnecting...', '<i class="fas fa-sync-alt"></i>');
                    this.reconnect();
                }
                
                // Trigger disconnect event
                this.triggerEvent('disconnected', event);
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.isConnecting = false;
                
                // Reset generation button state if generation was interrupted
                if (typeof updateManualGenerateBtnState === 'function') {
                    updateManualGenerateBtnState();
                }
                
                if (!this.isManualClose) {
                    this.bannerManager.updateWebSocketToast('error', 'Connection error. Retrying...', '<i class="fas fa-exclamation-triangle"></i>');
                }
            };

        } catch (error) {
            console.error('❌ Failed to create WebSocket connection:', error);
            this.isConnecting = false;
            this.bannerManager.updateWebSocketToast('error', 'Failed to connect', '<i class="fas fa-times-circle"></i>');
        }
    }

    disconnect() {
        this.isManualClose = true;
        this.stopPingInterval();
        
        // Reset pending requests count when disconnecting
        this.pendingRequestsCount = 0;
        this.updatePendingRequestsSpinner();
        
        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        } else {
        }
    }

    reconnect() {
        if (this.isManualClose || this.reconnectAttempts >= this.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.bannerManager.updateWebSocketToast('error', 'Max reconnection attempts reached', '<i class="fas fa-ban"></i>');
            }
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
        
        setTimeout(() => {
            if (!this.isManualClose) {
                this.connect();
            }
        }, delay);
    }

    // Method to force reconnect (used after authentication)
    forceReconnect() {
        this.isManualClose = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        // Don't reset initializationCompleted - we only want to run steps flagged as runOnReconnect
        this.disconnect();
        setTimeout(() => {
            this.connect();
        }, 100);
    }

    // Method to reset initialization flag (useful for manual page refresh scenarios)
    resetInitialization() {
        this.initializationCompleted = false;
    }

    // Method to check if initialization has been completed
    isInitialized() {
        return this.initializationCompleted;
    }

    // Method to execute a specific initialization step by name
    async executeSpecificStep(stepName) {
        const step = this.initSteps.find(s => s.message === stepName);
        if (step) {
            try {
                await step.stepFunction();
                return true;
            } catch (error) {
                console.error(`Error executing specific init step "${stepName}":`, error);
                return false;
            }
        } else {
            console.warn(`⚠️ Init step not found: ${stepName}`);
            return false;
        }
    }

    // Method to get list of available initialization steps
    getInitSteps() {
        return this.initSteps.map(step => ({
            message: step.message,
            priority: step.priority,
            runOnReconnect: step.runOnReconnect,
            completed: this.initializationCompleted
        }));
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
            
            // Handle pong responses with requestId for authentication checking
            if (message.requestId) {
                this.resolveRequest(message.requestId, { success: true }, null);
            }
            return;
        }
        
        // Handle authentication errors
        if (message.type === 'auth_error') {
            console.error('❌ WebSocket authentication error:', message.message);
            this.handleAuthError(message);
            return;
        }
        
        // Handle all response messages that should trigger resolveRequest
        if (message.type.endsWith('_response') || message.type === 'search_characters_complete') {
            if (message.requestId) {
                this.resolveRequest(message.requestId, message.data, message.error);
            }
            
            // Special handling for gallery responses
            if (message.type === 'request_gallery_response') {
                this.handleGalleryResponse(message.data, message.requestId);
            }
            
            return;
        }
        
        // Handle cache refresh response
        if (message.type === 'refresh_server_cache_response') {
            if (message.requestId) {
                this.resolveRequest(message.requestId, message.data, message.error);
            }
            
            // Show success/error message
            if (message.success) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', 'Cache Refreshed', `Server cache refreshed successfully. ${message.data?.assetsCount || 0} assets updated.`, false, 5000, '<i class="fas fa-sync"></i>');
                }
                console.log('✅ Server cache refreshed successfully:', message.data);
            } else {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', 'Cache Refresh Failed', message.error || 'Failed to refresh server cache', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                }
                console.error('❌ Server cache refresh failed:', message.error);
            }
            
            return;
        }
        
        // Handle resource update notifications
        if (message.type === 'resource_update_available') {
            console.log('🔄 Resource update available:', message.data);
            
            // Show update notification with download/later buttons
            if (typeof showGlassToast === 'function') {
                const downloadButton = {
                    text: 'Download Now',
                    type: 'primary',
                    onClick: () => {
                        console.log('User chose to download updates now');
                        // Trigger the service worker update check
                        if (window.serviceWorkerManager) {
                            window.serviceWorkerManager.checkStaticFileUpdates();
                        }
                    },
                    closeOnClick: true
                };
                
                const laterButton = {
                    text: 'Later',
                    type: 'default',
                    onClick: () => {
                        console.log('User chose to download updates later');
                    },
                    closeOnClick: true
                };
                
                showGlassToast(
                    'warning',
                    'Updates Available',
                    message.data.message || 'Resource updates are available for download',
                    false,
                    false,
                    '<i class="fas fa-download"></i>',
                    [downloadButton, laterButton]
                );
            }
            
            return;
        }
        
        // Handle any message with requestId for custom callbacks
        if (message.requestId && this.requestCallbacks && this.requestCallbacks.has(message.requestId)) {
            const callback = this.requestCallbacks.get(message.requestId);
            this.requestCallbacks.delete(message.requestId);
            try {
                callback(message.data, message.error);
            } catch (callbackError) {
                console.error(`❌ Error in custom callback for ${message.requestId}:`, callbackError);
            }
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
                break;
                
            case 'error':
                this.bannerManager.showWebSocketBanner('error', 'WebSocket server error: ' + message.message, '<i class="fas fa-exclamation-triangle"></i>');
                break;
                
            case 'image_generated':
                this.handleGeneratedImage(message.data);
                break;

            case 'gallery_updated':
                this.handleGalleryUpdate(message.data);
                break;

            case 'workspace_updated':
                this.handleWorkspaceUpdate(message.data);
                break;

            case 'workspace_activated':
                this.handleWorkspaceActivation(message.data);
                break;

            case 'preset_updated':
                this.handlePresetUpdate(message.data);
                break;

            case 'queue_update':
                this.handleQueueUpdate(message.data);
                break;
                
            default:
                // Handle custom message types
                this.triggerEvent(message.type, message);
        }
    }

    handleAuthError(message) {
        // Show authentication error toast (won't auto-hide)
        this.bannerManager.updateWebSocketToast('error', 'Authentication required. Please log in.', '<i class="fas fa-lock"></i>');
        
        // Trigger authentication event for other parts of the app to handle
        this.triggerEvent('authentication_required', message);
        
        // Show PIN modal for authentication
        if (typeof window.showPinModal === 'function') {
            window.showPinModal().then(() => {
                // After successful login, hide the toast and reconnect WebSocket
                this.bannerManager.hideWebSocketToast();
                this.forceReconnect();
            }).catch((error) => {
                console.error('❌ PIN modal error:', error);
            });
        } else {
            // Fallback: redirect to login page
            window.location.href = '/';
        }
    }

    handleGeneratedImage(data) {
        this.triggerEvent('imageGenerated', data);
    }

    handleGalleryUpdate(data) {
        this.triggerEvent('galleryUpdated', data);
    }

    handleGalleryResponse(data, requestId) {
        this.triggerEvent('galleryResponse', { data, requestId });
    }

    handleWorkspaceUpdate(data) {
        // Dispatch custom event for workspace updates
        const event = new CustomEvent('workspaceUpdated', {
            detail: data
        });
        document.dispatchEvent(event);
    }

    handleWorkspaceActivation(data) {
        // Dispatch custom event for workspace activation
        const event = new CustomEvent('workspaceActivated', {
            detail: data
        });
        document.dispatchEvent(event);
    }

    handlePresetUpdate(data) {
        // Dispatch custom event for preset updates
        const event = new CustomEvent('presetUpdated', {
            detail: data
        });
        document.dispatchEvent(event);
    }

    handleQueueUpdate(data) {
        // Trigger queue update event
        this.triggerEvent('queue_update', data);
        
        // Update global queue status for the app
        if (window.optionsData) {
            window.optionsData.queue_status = data.value;
        }
        
        // Update generation button state if the function exists
        if (typeof updateManualGenerateBtnState === 'function') {
            updateManualGenerateBtnState();
        }
    }

    // Method to request image upscaling via WebSocket
    async upscaleImage(upscaleParams, requestId = null) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            const result = await this.sendMessage('upscale_image', upscaleParams);
            return result;
        } catch (error) {
            console.error('Upscale image error:', error);
            throw error;
        }
    }

    // Method to request image generation via WebSocket
    async generateImage(generationParams, requestId = null) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            console.log('🔍 WebSocket generateImage called with params:', generationParams);
            if (generationParams.vibe_transfer) {
                console.log('🔍 Vibe transfers in generation params:', generationParams.vibe_transfer);
            }
            const result = await this.sendMessage('generate_image', generationParams);
            return result;
        } catch (error) {
            console.error('Generate image error:', error);
            throw error;
        }
    }

    // Method to request image reroll via WebSocket
    async rerollImage(filename, workspace = null, requestId = null) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            console.log('🎲 WebSocket rerollImage called for filename:', filename, 'workspace:', workspace);
            const result = await this.sendMessage('reroll_image', { filename, workspace });
            return result;
        } catch (error) {
            console.error('Reroll image error:', error);
            throw error;
        }
    }

    // Method to request gallery data via WebSocket
    async requestGallery(viewType = 'images', includePinnedStatus = true) {
        try {
            const result = await this.sendWithCallback('request_gallery', { 
                viewType, 
                includePinnedStatus 
            }, (response, error) => {
                if (error) {
                    console.error('Gallery request callback error:', error);
                }
            });
            return result;
        } catch (error) {
            console.error('Gallery request error:', error);
            throw error;
        }
    }

    // Method to request specific gallery view (scraps, pinned, upscaled)
    async requestGalleryView(viewType) {
        return this.requestGallery(viewType, true);
    }

    // Method to request all images with pinned status
    async requestAllImages() {
        return this.requestGallery('images', true);
    }

    // Method to request image metadata via WebSocket
    async requestImageMetadata(filename) {
        try {
            const result = await this.sendWithCallback('request_image_metadata', { filename }, (response, error) => {
                if (error) {
                    console.error('Image metadata request callback error:', error);
                }
            });
            return result;
        } catch (error) {
            showGlassToast('error', 'Image metadata request error', error.message, false);
            throw error;
        }
    }

    // Method to request URL upload metadata via WebSocket
    async requestUrlUploadMetadata(filename) {
        try {
            const result = await this.sendWithCallback('request_url_upload_metadata', { filename }, (response, error) => {
                if (error) {
                    console.error('URL upload metadata request callback error:', error);
                }
            });
            return result;
        } catch (error) {
            showGlassToast('error', 'URL upload metadata request error', error.message, false);
            throw error;
        }
    }

    // Method to request image by index via WebSocket
    async requestImageByIndex(index, viewType = 'images') {
        try {
            const result = await this.sendWithCallback('request_image_by_index', { index, viewType }, (response, error) => {
                if (error) {
                    console.error('Image by index request callback error:', error);
                }
            });
            return result;
        } catch (error) {
            showGlassToast('error', 'Image by index request error', error.message, false);
            throw error;
        }
    }

    // Method to find image index by filename via WebSocket
    async findImageIndex(filename, viewType = 'images') {
        try {
            const result = await this.sendWithCallback('find_image_index', { filename, viewType }, (response, error) => {
                if (error) {
                    console.error('Find image index callback error:', error);
                }
            });
            return result;
        } catch (error) {
            showGlassToast('error', 'Find image index error', error.message, false);
            throw error;
        }
    }

    // Search methods
    async searchCharacters(query, model) {
        try {
            const result = await this.sendMessage('search_characters', { query, model });
            return result;
        } catch (error) {
            showGlassToast('error', 'Character search error', error.message, false);
            throw error;
        }
    }

    async searchPresets(query) {
        return this.sendMessageWithRequestId('search_presets', this.generateRequestId(), { query });
    }

    async loadPreset(presetName) {
        return this.sendMessageWithRequestId('load_preset', this.generateRequestId(), { presetName });
    }

    async savePreset(presetName, config) {
        return this.sendMessageWithRequestId('save_preset', this.generateRequestId(), { presetName, config });
    }

    async deletePreset(presetName) {
        return this.sendMessageWithRequestId('delete_preset', this.generateRequestId(), { presetName });
    }

    async generatePreset(presetName, workspace = null) {
        return this.sendMessageWithRequestId('generate_preset', this.generateRequestId(), { presetName, workspace });
    }

    async getPresets(page = 1, itemsPerPage = 15, searchTerm = '') {
        return this.sendMessageWithRequestId('get_presets', this.generateRequestId(), { page, itemsPerPage, searchTerm });
    }

    async updatePreset(presetName, presetData) {
        return this.sendMessageWithRequestId('update_preset', this.generateRequestId(), { presetName, ...presetData });
    }

    async regeneratePresetUuid(presetName) {
        return this.sendMessageWithRequestId('regenerate_preset_uuid', this.generateRequestId(), { presetName });
    }

    async searchDatasetTags(query, path = []) {
        try {
            const result = await this.sendMessage('search_dataset_tags', { query, path });
            return result;
        } catch (error) {
            showGlassToast('error', 'Dataset tag search error', error.message, false);
            throw error;
        }
    }

    async getTagsForPath(path = []) {
        try {
            const result = await this.sendMessage('get_dataset_tags_for_path', { path });
            return result;
        } catch (error) {
            showGlassToast('error', 'Get Tags For Path', error.message, false);
            throw error;
        }
    }

    async searchTags(query, singleMatch = false) {
        try {
            const result = await this.sendMessage('search_tags', { query, single_match: singleMatch });
            return result;
        } catch (error) {
            showGlassToast('error', 'Search tags error', error.message, false);
            throw error;
        }
    }

    async addWordToDictionary(word) {
        try {
            const result = await this.sendMessage('spellcheck_add_word', { word });
            return result;
        } catch (error) {
            showGlassToast('error', 'Add word to dictionary error', error.message, false);
            throw error;
        }
    }

    // Search files by metadata (prompts, characters, etc.)
    async searchFiles(query, viewType = 'images') {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            const result = await this.sendMessage('search_files', { 
                query, 
                viewType,
                action: 'search'
            });
            return result;
        } catch (error) {
            console.error('Search files error:', error);
            throw error;
        }
    }
    
    // Get tag suggestions without performing full search
    async getTagSuggestions(query, viewType = 'images', contextTags = []) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            const result = await this.sendMessage('search_files', { 
                query, 
                viewType,
                action: 'suggestions',
                contextTags: contextTags
            });
            return result;
        } catch (error) {
            console.error('Tag suggestions error:', error);
            throw error;
        }
    }
    
    // Initialize search cache for a view type
    async initializeSearchCache(viewType = 'images') {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            const result = await this.sendMessage('search_files', { 
                action: 'start',
                viewType: viewType
            });
            return result;
        } catch (error) {
            console.error('Cache initialization error:', error);
            throw error;
        }
    }
    
    // Clean up search cache
    async cleanupSearchCache() {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            const result = await this.sendMessage('search_files', { 
                action: 'stop'
            });
            return result;
        } catch (error) {
            console.error('Cache cleanup error:', error);
            throw error;
        }
    }
    
    // Request fresh gallery data for search filtering
    async requestGalleryData(viewType = 'images') {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            const result = await this.sendMessage('request_gallery', { 
                viewType: viewType,
                includeMetadata: false // We only need the image list for filtering
            });
            return result;
        } catch (error) {
            console.error('Gallery data request error:', error);
            throw error;
        }
    }

    // Workspace methods
    async getWorkspaces() {
        return this.sendMessage('workspace_list');
    }

    async getWorkspace() {
        return this.sendMessage('workspace_get');
    }

    async createWorkspace(name, color = null) {
        return this.sendMessage('workspace_create', { name, color });
    }

    async renameWorkspace(id, name) {
        return this.sendMessage('workspace_rename', { id, name });
    }

    async deleteWorkspace(id) {
        return this.sendMessage('workspace_delete', { id });
    }

    async setActiveWorkspace(id) {
        return this.sendMessage('workspace_activate', { id });
    }

    async dumpWorkspace(sourceId, targetId) {
        return this.sendMessage('workspace_dump', { sourceId, targetId });
    }

    async getWorkspaceFiles(id) {
        return this.sendMessage('workspace_get_files', { id });
    }

    async moveFilesToWorkspace(filenames, targetWorkspaceId, sourceWorkspaceId = null, moveType = 'files') {
        return this.sendMessage('workspace_move_files', { id: targetWorkspaceId, filenames, sourceWorkspaceId, moveType });
    }

    async getWorkspaceScraps(id) {
        return this.sendMessage('workspace_get_scraps', { id });
    }

    async getWorkspacePinned(id) {
        return this.sendMessage('workspace_get_pinned', { id });
    }

    async addScrap(id, filename) {
        return this.sendMessage('workspace_add_scrap', { id, filename });
    }

    async removeScrap(id, filename) {
        return this.sendMessage('workspace_remove_scrap', { id, filename });
    }

    async addPinned(id, filename) {
        return this.sendMessage('workspace_add_pinned', { id, filename });
    }

    async removePinned(id, filename) {
        return this.sendMessage('workspace_remove_pinned', { id, filename });
    }

    async bulkAddPinned(id, filenames) {
        return this.sendMessage('workspace_bulk_add_pinned', { id, filenames });
    }

    async bulkRemovePinned(id, filenames) {
        return this.sendMessage('workspace_bulk_remove_pinned', { id, filenames });
    }

    async getWorkspaceGroups(id) {
        return this.sendMessage('workspace_get_groups', { id });
    }

    async createGroup(id, name) {
        return this.sendMessage('workspace_create_group', { id, name });
    }

    async getGroup(id, groupId) {
        return this.sendMessage('workspace_get_group', { id, groupId });
    }

    async renameGroup(id, groupId, name) {
        return this.sendMessage('workspace_rename_group', { id, groupId, name });
    }

    async addImagesToGroup(id, groupId, filenames) {
        return this.sendMessage('workspace_add_images_to_group', { id, groupId, filenames });
    }

    async removeImagesFromGroup(id, groupId, filenames) {
        return this.sendMessage('workspace_remove_images_from_group', { id, groupId, filenames });
    }

    async deleteGroup(id, groupId) {
        return this.sendMessage('workspace_delete_group', { id, groupId });
    }

    async getImageGroups(id, filename) {
        return this.sendMessage('workspace_get_image_groups', { id, filename });
    }

    async updateWorkspaceColor(id, color) {
        return this.sendMessage('workspace_update_color', { id, color });
    }

    async updateWorkspaceBackgroundColor(id, backgroundColor) {
        return this.sendMessage('workspace_update_background_color', { id, backgroundColor });
    }

    async updateWorkspacePrimaryFont(id, primaryFont) {
        return this.sendMessage('workspace_update_primary_font', { id, primaryFont });
    }

    async updateWorkspaceTextareaFont(id, textareaFont) {
        return this.sendMessage('workspace_update_textarea_font', { id, textareaFont });
    }

    async updateWorkspaceSettings(id, settings) {
        return this.sendMessage('workspace_update_settings', { id, settings });
    }

    async reorderWorkspaces(workspaceIds) {
        return this.sendMessage('workspace_reorder', { workspaceIds });
    }

    async addScrapBulk(id, filenames) {
        return this.sendMessage('workspace_bulk_add_scrap', { id, filenames });
    }

    async removePinnedBulk(id, filenames) {
        return this.sendMessage('workspace_bulk_remove_pinned', { id, filenames });
    }

    async addPinnedBulk(id, filenames) {
        return this.sendMessage('workspace_bulk_add_pinned', { id, filenames });
    }

    async deleteImagesBulk(filenames) {
        return this.sendMessage('delete_images_bulk', { filenames });
    }

    async sendToSequenziaBulk(filenames) {
        return this.sendMessage('send_to_sequenzia_bulk', { filenames });
    }

    async updateImagePresetBulk(filenames, presetName) {
        return this.sendMessage('update_image_preset_bulk', { filenames, presetName });
    }

    async getReferences() {
        return this.sendMessage('get_references');
    }

    async getReferencesByIds(references) {
        return this.sendMessage('get_references_by_ids', { references });
    }

    async getWorkspaceReferences(workspaceId) {
        return this.sendMessage('get_workspace_references', { workspaceId });
    }

    async deleteReference(hash, workspaceId) {
        return this.sendMessage('delete_reference', { hash, workspaceId });
    }

    async uploadReference(imageData, workspaceId, tempFile = null) {
        return this.sendMessage('upload_reference', { imageData, workspaceId, tempFile });
    }

    async downloadUrlFile(url) {
        try {
            // Add a timeout to prevent hanging
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Download timeout - server took too long to respond')), 10000); // 10 second timeout
            });
            
            const downloadPromise = this.sendMessage('download_url_file', { url });
            
            return await Promise.race([downloadPromise, timeoutPromise]);
        } catch (error) {
            console.error('❌ WebSocket downloadUrlFile error:', error);
            throw error;
        }
    }

    async fetchUrlInfo(url, options = {}, responseType = 'json') {
        return this.sendMessage('fetch_url_info', { url, options, responseType });
    }

    async uploadWorkspaceImage(imageData, workspaceId, originalFilename = null, batchInfo = null, tempFile = null) {
        return this.sendMessage('upload_workspace_image', { imageData, workspaceId, originalFilename, batchInfo, tempFile });
    }

    async moveReferences(hashes, targetWorkspaceId, sourceWorkspaceId) {
        return this.sendMessage('move_references', { hashes, targetWorkspaceId, sourceWorkspaceId });
    }

    async getVibeImage(filename) {
        return this.sendMessage('get_vibe_image', { filename });
    }

    async deleteVibeImage(vibeId, workspaceId) {
        return this.sendMessage('delete_vibe_image', { vibeId, workspaceId });
    }

    async deleteVibeEncodings(vibeId, encodings, workspaceId) {
        return this.sendMessage('delete_vibe_encodings', { vibeId, encodings, workspaceId });
    }

    async bulkDeleteVibeImages(vibesToDelete, encodingsToDelete, workspaceId) {
        return this.sendMessage('bulk_delete_vibe_images', { vibesToDelete, encodingsToDelete, workspaceId });
    }

    async moveVibeImage(vibeId, targetWorkspaceId, sourceWorkspaceId) {
        return this.sendMessage('move_vibe_image', { vibeId, targetWorkspaceId, sourceWorkspaceId });
    }

    async bulkMoveVibeImages(imageIds, targetWorkspaceId, sourceWorkspaceId) {
        return this.sendMessage('bulk_move_vibe_images', { imageIds, targetWorkspaceId, sourceWorkspaceId });
    }

    async encodeVibe(params) {
        return this.sendMessage('encode_vibe', params);
    }

    async importVibeBundle(bundleData, workspaceId, comment = '', tempFile = null) {
        return this.sendMessage('import_vibe_bundle', { bundleData, workspaceId, comment, tempFile });
    }

    async checkVibeEncoding(vibeId, workspaceId) {
        return this.sendMessage('check_vibe_encoding', { vibeId, workspaceId });
    }

    async getAppOptions() {
        return this.sendMessage('get_app_options');
    }

    async pingWithAuth() {
        return this.sendMessage('ping');
    }

    async refreshServerCache() {
        return this.sendMessage('refresh_server_cache');
    }
    
    async broadcastResourceUpdate(updateType, message, files = []) {
        return this.sendMessage('broadcast_resource_update', { updateType, message, files });
    }

    // Wait for connection to be established with better validation
    async waitForConnection(timeout = 10000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, timeout);

            const checkConnection = () => {
                // Check if WebSocket is connected and in a stable state
                if (this.isConnected() && this.getConnectionState() === 'connected') {
                    // Additional validation: ensure the connection has been established for at least 500ms
                    // This helps prevent race conditions where the connection appears ready but isn't fully established
                    setTimeout(() => {
                        if (this.isConnected() && this.getConnectionState() === 'connected') {
                            clearTimeout(timeoutId);
                            resolve(true);
                        } else {
                            // Connection was lost during the stability check
                            reject(new Error('WebSocket connection unstable'));
                        }
                    }, 500);
                } else {
                    setTimeout(checkConnection, 100);
                }
            };

            checkConnection();
        });
    }

    // Send message with request/response handling
    sendMessage(type, data = {}) {
        return new Promise((resolve, reject) => {
            // Enhanced connection validation
            if (!this.isConnectionHealthy()) {
                const error = new Error('WebSocket connection not healthy');
                error.code = 'CONNECTION_UNHEALTHY';
                reject(error);
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

            // Increment pending requests count
            this.incrementPendingRequests();

            try {
                this.send(message);
                
                // Add request timeout handling
                /* const timeoutId = setTimeout(() => {
                    if (this.pendingRequests.has(requestId)) {
                        this.pendingRequests.delete(requestId);
                        this.decrementPendingRequests();
                        const timeoutError = new Error('Request timeout');
                        timeoutError.code = 'REQUEST_TIMEOUT';
                        reject(timeoutError);
                    }
                }, 30000); // 30 second timeout
                
                // Store timeout ID for cleanup
                this.pendingRequests.get(requestId).timeoutId = timeoutId; */
                
            } catch (error) {
                this.pendingRequests.delete(requestId);
                this.decrementPendingRequests();
                reject(error);
            }
        });
    }

    // Send message with custom request ID and callback
    sendMessageWithCallback(type, data = {}, callback = null) {
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

            // Store pending request with callback
            this.pendingRequests = this.pendingRequests || new Map();
            this.pendingRequests.set(requestId, { 
                resolve, 
                reject, 
                callback: callback || null 
            });

            // Increment pending requests count
            this.incrementPendingRequests();

            try {
                this.send(message);
            } catch (error) {
                this.pendingRequests.delete(requestId);
                this.decrementPendingRequests();
                reject(error);
            }
        });
    }

    // Send message with existing request ID (for responses to specific requests)
    sendMessageWithRequestId(type, requestId, data = {}) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        return new Promise((resolve, reject) => {
            // Store the promise for later resolution
            if (!this.pendingRequests) {
                this.pendingRequests = new Map();
            }
            
            this.pendingRequests.set(requestId, { resolve, reject });
            
            // Increment pending requests count
            this.incrementPendingRequests();

            const message = {
                type,
                requestId,
                ...data
            };

            this.send(message);
        });
    }

    // Set callback for a specific request ID
    setRequestCallback(requestId, callback) {
        this.requestCallbacks = this.requestCallbacks || new Map();
        this.requestCallbacks.set(requestId, callback);
    }

    // Remove callback for a specific request ID
    removeRequestCallback(requestId) {
        if (this.requestCallbacks) {
            this.requestCallbacks.delete(requestId);
        }
    }

    // Convenience method to send a message and set up a callback for the response
    sendWithCallback(type, data = {}, callback = null) {
        if (!callback) {
            return this.sendMessage(type, data);
        }
        
        return this.sendMessageWithCallback(type, data, callback);
    }

    // Generate a unique request ID for custom use
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Update pending requests spinner
    updatePendingRequestsSpinner() {
        if (!this.pendingRequestsSpinner) {
            this.pendingRequestsSpinner = document.querySelectorAll('#pendingRequestsSpinner, #manualPendingRequestsSpinner');
            this.pendingRequestsBadge = document.querySelectorAll('#pendingRequestsBadge, #manualPendingRequestsBadge');
        }
        
        if (this.pendingRequestsSpinner && this.pendingRequestsBadge) {
            if (this.pendingRequestsCount > 0) {
                this.pendingRequestsSpinner.forEach(spinner => spinner.classList.remove('hidden'));
                this.pendingRequestsBadge.forEach(badge => badge.textContent = this.pendingRequestsCount);
            } else {
                this.pendingRequestsSpinner.forEach(spinner => spinner.classList.add('hidden'));
            }
        }
    }

    // Increment pending requests count
    incrementPendingRequests() {
        this.pendingRequestsCount++;
        this.updatePendingRequestsSpinner();
    }

    // Decrement pending requests count
    decrementPendingRequests() {
        if (this.pendingRequestsCount > 0) {
            this.pendingRequestsCount--;
            this.updatePendingRequestsSpinner();
        }
    }

    // Resolve pending request
    resolveRequest(requestId, data, error = null) {
        if (this.pendingRequests && this.pendingRequests.has(requestId)) {
            const request = this.pendingRequests.get(requestId);
            this.pendingRequests.delete(requestId);
            
            // Clear timeout if it exists
            if (request.timeoutId) {
                clearTimeout(request.timeoutId);
            }
            
            // Decrement pending requests count
            this.decrementPendingRequests();
            
            // Execute callback if provided
            if (request.callback && typeof request.callback === 'function') {
                try {
                    request.callback(data, error);
                } catch (callbackError) {
                    console.error(`❌ Error in request callback for ${requestId}:`, callbackError);
                }
            }
            
            // Also check for registered callbacks
            if (this.requestCallbacks && this.requestCallbacks.has(requestId)) {
                const callback = this.requestCallbacks.get(requestId);
                this.requestCallbacks.delete(requestId);
                try {
                    callback(data, error);
                } catch (callbackError) {
                    console.error(`❌ Error in registered callback for ${requestId}:`, callbackError);
                }
            }
            
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
    
    // Check if the connection is healthy and ready for requests
    isConnectionHealthy() {
        return this.isConnected() && 
               this.getConnectionState() === 'connected' && 
               !this.isConnecting && 
               this.ws.readyState === WebSocket.OPEN;
    }
    
    // Perform a health check by sending a ping
    async performHealthCheck() {
        if (!this.isConnectionHealthy()) {
            return false;
        }
        
        try {
            // Send a simple ping to test the connection
            const response = await this.pingWithAuth();
            return response && response.success;
        } catch (error) {
            console.warn('⚠️ Health check failed:', error);
            return false;
        }
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