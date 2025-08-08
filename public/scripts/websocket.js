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
        
        // Pending requests tracking
        this.pendingRequestsCount = 0;
        this.pendingRequestsSpinner = null;
        this.pendingRequestsBadge = null;
        
        // Bind methods
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.reconnect = this.reconnect.bind(this);
        this.send = this.send.bind(this);
        
        // Initialize
        this.init();
    }

    // Loading overlay methods
    showLoadingOverlay(message = 'Connecting...', progress = 0) {
        if (!this.loadingOverlay) {
            this.createLoadingOverlay();
        }
        
        this.loadingOverlay.style.display = 'flex';
        this.updateLoadingProgress(message, progress);
    }

    hideLoadingOverlay() {
        if (this.loadingOverlay) {
            this.loadingOverlay.style.display = 'none';
        }
    }

    updateLoadingProgress(message, progress) {
        if (!this.loadingOverlay) return;
        
        const messageEl = this.loadingOverlay.querySelector('.loading-message');
        const progressBar = this.loadingOverlay.querySelector('.loading-progress-bar');
        const progressText = this.loadingOverlay.querySelector('.loading-progress-text');
        
        if (messageEl) messageEl.textContent = message;
        if (progressBar) progressBar.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `${Math.round(progress)}%`;
    }

    createLoadingOverlay() {
        this.loadingOverlay = document.createElement('div');
        this.loadingOverlay.className = 'loading-overlay';
        this.loadingOverlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
                <div class="loading-message">Connecting...</div>
                <div class="loading-progress">
                    <div class="loading-progress-bar"></div>
                </div>
                <div class="loading-progress-text">0%</div>
            </div>
        `;
        document.body.appendChild(this.loadingOverlay);
    }

    registerInitStep(priority, message, stepFunction) {
        this.initSteps.push({ priority, message, stepFunction });
        this.initSteps.sort((a, b) => a.priority - b.priority);
        this.totalInitSteps = this.initSteps.length;
    }

    async executeInitSteps() {
        this.currentInitStep = 0;
        
        try {
            for (const step of this.initSteps) {
                this.currentInitStep++;
                const progress = (this.currentInitStep / this.totalInitSteps) * 100;
                this.updateLoadingProgress(step.message, progress);
                
                try {
                    await step.stepFunction();
                } catch (error) {
                    console.error(`Error in init step "${step.message}":`, error);
                    // Continue with next step even if one fails
                }
            }
            
            // Hide overlay after all steps complete
            setTimeout(() => {
                this.hideLoadingOverlay();
            }, 500);
        } catch (error) {
            console.error('Error during initialization:', error);
            this.updateLoadingProgress('Initialization failed', 100);
            setTimeout(() => {
                this.hideLoadingOverlay();
            }, 2000);
        }
    }

    init() {
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
    }

    connect() {
        if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        this.isConnecting = true;
        this.updateLoadingProgress('Connecting to server...', 10);
        
        // Show connecting toast - use global websocket toast ID
        if (typeof showGlassToast === 'function' && typeof window.websocketToastId === 'undefined') {
            window.websocketToastId = showGlassToast('info', null, 'Connecting to server...', false, 5000, '<i class="fas fa-plug"></i>');
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
                
                this.updateLoadingProgress('Connected! Loading page...', 25);
                
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
                            window.websocketToastId = showGlassToast('success', null, 'Connected to server', false, 5000, '<i class="fas fa-plug"></i>');
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
                
                // Execute initialization steps
                this.executeInitSteps();
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
                                window.websocketToastId = showGlassToast('warning', null, 'Connection lost. Reconnecting...', false, 5000, '<i class="fas fa-sync-alt"></i>');
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
                                window.websocketToastId = showGlassToast('error', null, 'Connection error. Retrying...', false);
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
                        window.websocketToastId = showGlassToast('error', null, 'Failed to connect', false, 5000, '<i class="fas fa-times-circle"></i>');
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
        
        // Reset pending requests count when disconnecting
        this.pendingRequestsCount = 0;
        this.updatePendingRequestsSpinner();
        
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
                            window.websocketToastId = showGlassToast('error', null, 'Max reconnection attempts reached', false, 5000, '<i class="fas fa-ban"></i>');
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
                if (message.status === 'connected') {
                    console.log('✅ WebSocket connection confirmed');
                }
                break;
                
            case 'error':
                showGlassToast('error', null, 'WebSocket server error: ' + message.message, false);
                break;
                
            case 'subscribed':
                console.log('✅ Subscribed to channels:', message.channels);
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
                
            default:
                // Handle custom message types
                this.triggerEvent(message.type, message);
        }
    }

    handleAuthError(message) {
        // Show authentication error toast
        if (typeof showGlassToast === 'function') {
            showGlassToast('error', null, 'Authentication required. Please log in.', false, 5000, '<i class="fas fa-lock"></i>');
        }
        
        // Trigger authentication event for other parts of the app to handle
        this.triggerEvent('authentication_required', message);
        
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

    async updateWorkspaceBackgroundImage(id, backgroundImage) {
        return this.sendMessage('workspace_update_background_image', { id, backgroundImage });
    }

    async updateWorkspaceBackgroundOpacity(id, backgroundOpacity) {
        return this.sendMessage('workspace_update_background_opacity', { id, backgroundOpacity });
    }

    async reorderWorkspaces(workspaceIds) {
        return this.sendMessage('workspace_reorder', { workspaceIds });
    }

    // Bulk operations
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

    // References WebSocket Methods
    async getReferences() {
        return this.sendMessage('get_references');
    }

    async getWorkspaceReferences(workspaceId) {
        return this.sendMessage('get_workspace_references', { workspaceId });
    }

    async deleteReference(hash, workspaceId) {
        return this.sendMessage('delete_reference', { hash, workspaceId });
    }

    async uploadReference(imageData, workspaceId) {
        return this.sendMessage('upload_reference', { imageData, workspaceId });
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

    async importVibeBundle(bundleData, workspaceId, comment = '') {
        return this.sendMessage('import_vibe_bundle', { bundleData, workspaceId, comment });
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

    async waitForConnection(timeout = 10000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, timeout);

            const checkConnection = () => {
                if (this.isConnected()) {
                    clearTimeout(timeoutId);
                    resolve(true);
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

        const message = {
            type,
            requestId,
            ...data
        };

        this.send(message);
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
            this.pendingRequestsSpinner = document.getElementById('pendingRequestsSpinner');
            this.pendingRequestsBadge = document.getElementById('pendingRequestsBadge');
        }
        
        if (this.pendingRequestsSpinner && this.pendingRequestsBadge) {
            if (this.pendingRequestsCount > 0) {
                this.pendingRequestsSpinner.classList.remove('hidden');
                this.pendingRequestsBadge.textContent = this.pendingRequestsCount;
            } else {
                this.pendingRequestsSpinner.classList.add('hidden');
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