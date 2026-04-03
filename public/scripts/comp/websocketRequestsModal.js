// WebSocket Requests Modal
// Displays active and previous WebSocket requests

class WebSocketRequestsModal {
    constructor() {
        this.modal = document.getElementById('websocketRequestsModal');
        this.activeRequestsList = document.getElementById('activeRequestsList');
        this.previousRequestsList = document.getElementById('previousRequestsList');
        this.activeRequestsCount = document.getElementById('activeRequestsCount');
        this.previousRequestsCount = document.getElementById('previousRequestsCount');
        this.activeRequestsEmptyState = document.getElementById('activeRequestsEmptyState');
        this.previousRequestsEmptyState = document.getElementById('previousRequestsEmptyState');
        this.connectionStatusBadge = document.getElementById('connectionStatusBadge');
        this.connectionStatusValue = document.getElementById('connectionStatusValue');
        this.connectionSecurityIcon = document.getElementById('connectionSecurityIcon');
        this.connectionTrafficUp = document.getElementById('connectionTrafficUp');
        this.connectionTrafficDown = document.getElementById('connectionTrafficDown');
        this.connectionRttValue = document.getElementById('connectionRttValue');
        this.connectionVariabilityValue = document.getElementById('connectionVariabilityValue');
        this.serviceWorkerIcon = document.getElementById('serviceWorkerIcon');
        this.updateInterval = null;
        this.isUpdating = false;
        this.observer = null;
        this.lastActiveHash = null;
        this.lastPreviousHash = null;
        this.lastConnectionStatus = null; // Store last connection status to detect changes
        
        this.init();
    }

    init() {
        if (!this.modal) {
            console.warn('WebSocket Requests Modal not found');
            return;
        }

        // Close button handler
        const closeBtn = document.getElementById('closeWebsocketRequestsModalBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.close();
            });
        }

        // Update when modal is opened - use a debounced check
        let lastClassState = this.modal.classList.contains('hidden');
        const checkModalOpen = () => {
            const isHidden = this.modal.classList.contains('hidden');
            // Only react if the state actually changed
            if (isHidden !== lastClassState) {
                lastClassState = isHidden;
                if (!isHidden) {
                    // Modal opened - update and start auto-update
                    this.update();
                    this.startAutoUpdate();
                } else {
                    // Modal closed - stop auto-update
                    this.stopAutoUpdate();
                }
            }
        };

        // Use MutationObserver to watch for class changes (but debounced)
        this.observer = new MutationObserver(() => {
            // Use requestAnimationFrame to debounce rapid mutations
            if (this.observerTimeout) {
                cancelAnimationFrame(this.observerTimeout);
            }
            this.observerTimeout = requestAnimationFrame(checkModalOpen);
        });
        this.observer.observe(this.modal, {
            attributes: true,
            attributeFilter: ['class']
        });

        // Also check on open/close events if they exist
        if (typeof window.addEventListener === 'function') {
            // Listen for custom events if modal system uses them
            this.modal.addEventListener('modal-opened', () => {
                this.update();
                this.startAutoUpdate();
            });

            this.modal.addEventListener('modal-closed', () => {
                this.stopAutoUpdate();
            });
        }
    }

    open() {
        if (!this.modal) return;
        // Update immediately before opening
        this.update();
        if (typeof openModal === 'function') {
            openModal(this.modal);
        } else {
            this.modal.classList.remove('hidden');
        }
        // Start auto-update
        this.startAutoUpdate();
        // Refresh websocket indicators to pick up the traffic arrows
        if (window.wsClient && typeof window.wsClient.refreshWebSocketIndicators === 'function') {
            window.wsClient.refreshWebSocketIndicators();
        }
    }

    close() {
        if (!this.modal) return;
        if (typeof closeModal === 'function') {
            closeModal(this.modal);
        } else {
            this.modal.classList.add('hidden');
        }
    }

    startAutoUpdate() {
        // Stop any existing interval first
        this.stopAutoUpdate();
        
        // Only start if modal is actually visible
        if (!this.modal || this.modal.classList.contains('hidden')) {
            return;
        }
        
        // Update every 2000ms (2 seconds) while modal is open - reduced frequency
        this.updateInterval = setInterval(() => {
            // Double-check modal is still visible before updating
            if (this.modal && !this.modal.classList.contains('hidden')) {
                this.update();
            } else {
                this.stopAutoUpdate();
            }
        }, 2000);
    }

    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    update() {
        // Prevent concurrent updates
        if (this.isUpdating) {
            return;
        }
        
        // Only update if modal is visible
        if (!this.modal || this.modal.classList.contains('hidden')) {
            return;
        }
        
        this.isUpdating = true;
        
        try {
            if (!window.wsClient) {
                this.renderEmpty();
                this.renderConnectionStatus(null);
                this.renderServiceWorkerStatus();
                return;
            }

            // Update connection status
            this.renderConnectionStatus(window.wsClient);
            
            // Update service worker status
            this.renderServiceWorkerStatus();

            // Get active requests (filter out ping)
            const activeRequests = this.getActiveRequests();
            
            // Get previous requests (filter out ping)
            const previousRequests = this.getPreviousRequests();

            this.renderActiveRequests(activeRequests);
            this.renderPreviousRequests(previousRequests);
        } finally {
            // Use requestAnimationFrame to ensure we don't block
            requestAnimationFrame(() => {
                this.isUpdating = false;
            });
        }
    }

    getActiveRequests() {
        const requests = [];
        const now = Date.now();
        const RECENT_COMPLETED_THRESHOLD = 30000; // 30 seconds

        // Get pending requests
        if (window.wsClient && window.wsClient.pendingRequests) {
            for (const [requestId, request] of window.wsClient.pendingRequests) {
                // Filter out ping requests
                if (request.type === 'ping') {
                    continue;
                }

                const age = request.timestamp ? now - request.timestamp : 0;
                requests.push({
                    id: requestId,
                    type: request.type,
                    timestamp: request.timestamp,
                    age: age,
                    showBanner: request.showBanner,
                    isPending: true
                });
            }
        }

        // Get recently completed requests (completed less than 30 seconds ago)
        if (window.wsClient && window.wsClient.completedRequests) {
            for (const req of window.wsClient.completedRequests) {
                // Filter out ping requests
                if (req.type === 'ping') {
                    continue;
                }

                // Check if completed less than 30 seconds ago
                const completedAt = req.completedAt || req.timestamp;
                if (completedAt && (now - completedAt) < RECENT_COMPLETED_THRESHOLD) {
                    requests.push({
                        id: req.id,
                        type: req.type,
                        timestamp: req.timestamp,
                        completedAt: completedAt,
                        age: now - completedAt,
                        duration: req.duration,
                        error: req.error,
                        isPending: false
                    });
                }
            }
        }

        // Sort: active requests first (newest first), then recently completed (newest first)
        return requests.sort((a, b) => {
            // Active requests come before completed
            if (a.isPending && !b.isPending) return -1;
            if (!a.isPending && b.isPending) return 1;
            
            // Within same type, sort by timestamp (newest first)
            // For pending: use timestamp
            // For completed: use completedAt
            const aTime = a.isPending ? (a.timestamp || 0) : (a.completedAt || a.timestamp || 0);
            const bTime = b.isPending ? (b.timestamp || 0) : (b.completedAt || b.timestamp || 0);
            
            return bTime - aTime; // Newest first
        });
    }

    getPreviousRequests() {
        if (!window.wsClient || !window.wsClient.completedRequests) {
            return [];
        }

        const now = Date.now();
        const RECENT_COMPLETED_THRESHOLD = 30000; // 30 seconds

        // Filter out ping requests and requests completed less than 30 seconds ago
        // Return last 10 that are older than 30 seconds
        return window.wsClient.completedRequests
            .filter(req => {
                if (req.type === 'ping') return false;
                const completedAt = req.completedAt || req.timestamp;
                // Only include if completed more than 30 seconds ago
                return completedAt && (now - completedAt) >= RECENT_COMPLETED_THRESHOLD;
            })
            .slice(-10)
            .reverse(); // Most recent first
    }

    formatRequestType(type) {
        if (!window.wsClient || !window.wsClient.bannerManager) {
            return type || 'Unknown';
        }
        return window.wsClient.bannerManager.formatRequestType(type) || type || 'Unknown';
    }

    formatDuration(ms) {
        if (ms < 1000) {
            return `${ms}ms`;
        } else if (ms < 60000) {
            return `${(ms / 1000).toFixed(1)}s`;
        } else {
            const minutes = Math.floor(ms / 60000);
            const seconds = Math.floor((ms % 60000) / 1000);
            return `${minutes}m ${seconds}s`;
        }
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return 'Unknown';
        const date = new Date(timestamp);
        const now = Date.now();
        const diff = now - timestamp;

        if (diff < 60000) {
            return 'Just now';
        } else if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return `${minutes}m`;
        } else {
            return date.toLocaleTimeString();
        }
    }

    renderActiveRequests(requests) {
        if (!this.activeRequestsList) return;

        // Update count (if element exists - header was removed)
        if (this.activeRequestsCount) {
            this.activeRequestsCount.textContent = requests.length;
        }

        // Create a hash of current requests to avoid unnecessary re-renders
        // Include isPending flag to detect when requests transition from pending to completed
        const currentHash = requests.map(r => `${r.id}:${r.age}:${r.isPending ? 'p' : 'c'}`).join('|');
        if (this.lastActiveHash === currentHash && this.activeRequestsList.children.length > 0) {
            // Only update the age for existing items without full re-render
            this.updateActiveRequestAges(requests);
            return;
        }
        
        this.lastActiveHash = currentHash;

        if (requests.length === 0) {
            // Clear any existing request items
            const existingItems = this.activeRequestsList.querySelectorAll('.request-item');
            existingItems.forEach(item => item.remove());
            
            // Show empty state
            if (this.activeRequestsEmptyState) {
                this.activeRequestsEmptyState.classList.remove('hidden');
            } else {
                // Create empty state if it doesn't exist
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';
                emptyState.id = 'activeRequestsEmptyState';
                emptyState.textContent = 'No active requests';
                this.activeRequestsList.appendChild(emptyState);
                this.activeRequestsEmptyState = emptyState;
            }
            return;
        }

        // Hide empty state when there are requests
        if (this.activeRequestsEmptyState) {
            this.activeRequestsEmptyState.classList.add('hidden');
        }

        const html = requests.map(req => {
            const displayName = this.formatRequestType(req.type);
            const age = this.formatDuration(req.age);
            
            // Use spinner for pending, check/cross for recently completed
            let iconClass = 'fas fa-spinner fa-spin';
            if (!req.isPending) {
                iconClass = req.error ? 'fas fa-times-circle' : 'fas fa-check-circle';
            }
            
            // Only show age for pending requests
            const ageDisplay = req.isPending ? `<span class="request-age">${age}</span>` : '';
            
            return `
                <div class="request-item active tag-wiki-result-item" data-request-id="${this.escapeHtml(req.id)}">
                    <div class="request-info">
                        <div class="request-name tag-wiki-result-name">
                            <i class="${iconClass}"></i>
                            <span>${this.escapeHtml(displayName)}</span>
                        </div>
                        <div class="request-meta">
                            <span class="request-type">${this.escapeHtml(req.type)}</span>
                            ${ageDisplay}
                        </div>
                        ${req.error && !req.isPending ? `<div class="request-error">${this.escapeHtml(req.error.message || 'Unknown error')}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Clear existing request items (but keep empty state)
        const existingItems = this.activeRequestsList.querySelectorAll('.request-item');
        existingItems.forEach(item => item.remove());
        
        // Add new request items
        if (html) {
            this.activeRequestsList.insertAdjacentHTML('beforeend', html);
        }
    }
    
    updateActiveRequestAges(requests) {
        // Update ages and icons without full re-render
        requests.forEach(req => {
            const item = this.activeRequestsList.querySelector(`[data-request-id="${req.id}"]`);
            if (item) {
                const ageElement = item.querySelector('.request-age');
                
                // Only update/show age for pending requests
                if (req.isPending) {
                    if (ageElement) {
                        ageElement.textContent = this.formatDuration(req.age);
                    } else {
                        // Add age element if it doesn't exist
                        const metaElement = item.querySelector('.request-meta');
                        if (metaElement) {
                            const typeElement = metaElement.querySelector('.request-type');
                            if (typeElement && typeElement.nextSibling) {
                                const ageSpan = document.createElement('span');
                                ageSpan.className = 'request-age';
                                ageSpan.textContent = this.formatDuration(req.age);
                                typeElement.parentNode.insertBefore(ageSpan, typeElement.nextSibling);
                            }
                        }
                    }
                } else {
                    // Remove age element for completed requests
                    if (ageElement) {
                        ageElement.remove();
                    }
                }
                
                // Update icon if request completed (moved from pending to completed)
                if (!req.isPending) {
                    const iconElement = item.querySelector('.request-name i');
                    if (iconElement) {
                        iconElement.className = req.error ? 'fas fa-times-circle' : 'fas fa-check-circle';
                        // Remove spin class if it exists
                        iconElement.classList.remove('fa-spin');
                    }
                }
            }
        });
    }

    renderPreviousRequests(requests) {
        if (!this.previousRequestsList) return;

        // Update count
        if (this.previousRequestsCount) {
            this.previousRequestsCount.textContent = requests.length;
        }

        // Create a hash of current requests to avoid unnecessary re-renders
        const currentHash = requests.map(r => `${r.id}:${r.completedAt}`).join('|');
        if (this.lastPreviousHash === currentHash && this.previousRequestsList.children.length > 0) {
            // No changes, skip re-render
            return;
        }
        
        this.lastPreviousHash = currentHash;

        if (requests.length === 0) {
            if (this.previousRequestsEmptyState) {
                this.previousRequestsEmptyState.classList.remove('hidden');
            }
            // Clear any existing request items
            const existingItems = this.previousRequestsList.querySelectorAll('.request-item');
            existingItems.forEach(item => item.remove());
            return;
        }

        // Hide empty state when there are requests
        if (this.previousRequestsEmptyState) {
            this.previousRequestsEmptyState.classList.add('hidden');
        }

        const html = requests.map(req => {
            const displayName = this.formatRequestType(req.type);
            const timestamp = this.formatTimestamp(req.completedAt || req.timestamp);
            const errorText = req.error ? this.escapeHtml(req.error.message || 'Unknown error') : '';
            
            // Only show duration if it was longer than 1 second
            const durationDisplay = req.duration && req.duration >= 1000 
                ? `<span class="request-duration">${this.formatDuration(req.duration)}</span>` 
                : '';
            
            return `
                <div class="request-item previous tag-wiki-result-item" data-request-id="${this.escapeHtml(req.id)}">
                    <div class="request-info">
                        <div class="request-name tag-wiki-result-name">
                            <i class="fas fa-${req.error ? 'times-circle' : 'check-circle'}"></i>
                            <span>${this.escapeHtml(displayName)}</span>
                        </div>
                        <div class="request-meta">
                            <span class="request-type">${this.escapeHtml(req.type)}</span>
                            ${durationDisplay}
                            <span class="request-time">${timestamp}</span>
                        </div>
                        ${errorText ? `<div class="request-error">${errorText}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Clear existing request items (but keep empty state)
        const existingItems = this.previousRequestsList.querySelectorAll('.request-item');
        existingItems.forEach(item => item.remove());
        
        // Add new request items
        if (html) {
            this.previousRequestsList.insertAdjacentHTML('beforeend', html);
        }
    }

    renderConnectionStatus(wsClient) {
        // Build current status object
        let currentStatus = {
            hasClient: !!wsClient,
            isConnected: false,
            isConnecting: false,
            statusText: 'Disconnected',
            statusBadgeClass: 'status-badge-disconnected',
            securityIconClass: 'fas fa-unlock',
            rttText: '---',
            variabilityText: '---'
        };

        if (wsClient) {
            const isConnected = typeof wsClient.isConnected === 'function' ? wsClient.isConnected() : (wsClient.ws && wsClient.ws.readyState === WebSocket.OPEN);
            currentStatus.isConnected = isConnected;
            currentStatus.isConnecting = wsClient.isConnecting || false;

            // Connection Status - as badge using websocket-ticker classes
            if (isConnected) {
                currentStatus.statusText = 'Connected';
                currentStatus.statusBadgeClass = 'connected';
            } else if (wsClient.isConnecting) {
                currentStatus.statusText = 'Connecting...';
                currentStatus.statusBadgeClass = 'connecting';
            } else {
                currentStatus.statusText = 'Disconnected';
                currentStatus.statusBadgeClass = 'disconnected';
            }

            // Security (WSS/WS) - icon only, inside badge
            if (wsClient.ws) {
                const url = wsClient.ws.url || '';
                if (url.startsWith('wss://')) {
                    currentStatus.securityIconClass = 'fas fa-lock connection-status-badge-icon';
                } else if (url.startsWith('ws://')) {
                    currentStatus.securityIconClass = 'fas fa-unlock connection-status-badge-icon';
                } else {
                    // Fallback to checking window location
                    const isSecure = window.location.protocol === 'https:';
                    currentStatus.securityIconClass = isSecure ? 'fas fa-lock connection-status-badge-icon' : 'fas fa-unlock connection-status-badge-icon';
                }
            } else {
                currentStatus.securityIconClass = 'fas fa-unlock connection-status-badge-icon';
            }


            // RTT (Ping) - round to nearest 10ms to reduce updates
            let rttText = '---';
            let variabilityText = '';
            
            if (wsClient.currentRtt !== null && wsClient.currentRtt !== undefined) {
                const roundedRtt = Math.round(wsClient.currentRtt / 10) * 10;
                rttText = `${roundedRtt}ms`;
            }

            // Variability - round percentage to reduce updates
            if (wsClient.rttVariability !== null && wsClient.rttVariability !== undefined && wsClient.currentRtt > 0) {
                const variabilityPercent = Math.round((wsClient.rttVariability / wsClient.currentRtt) * 100);
                variabilityText = ` · ${variabilityPercent}%`;
            }
            
            // Combine RTT and variability with a small dot separator
            if (variabilityText) {
                currentStatus.rttText = rttText + variabilityText;
            } else {
                currentStatus.rttText = rttText;
            }
            
            // Keep variabilityText empty since it's now combined
            currentStatus.variabilityText = '';
        }

        // Only update DOM if values actually changed
        if (this.lastConnectionStatus) {
            const hasChanged = 
                currentStatus.statusText !== this.lastConnectionStatus.statusText ||
                currentStatus.statusBadgeClass !== this.lastConnectionStatus.statusBadgeClass ||
                currentStatus.securityIconClass !== this.lastConnectionStatus.securityIconClass ||
                currentStatus.rttText !== this.lastConnectionStatus.rttText;

            if (!hasChanged) {
                return; // No changes, skip DOM updates
            }
        }

        // Update DOM only when values changed
        if (this.connectionStatusValue && this.connectionStatusValue.textContent !== currentStatus.statusText) {
            this.connectionStatusValue.textContent = currentStatus.statusText;
        }
        if (this.connectionStatusBadge) {
            // Use connection-status-badge classes (copied from websocket-ticker styles)
            this.connectionStatusBadge.className = `connection-status-badge ${currentStatus.statusBadgeClass}`;
        }

        if (this.connectionSecurityIcon && this.connectionSecurityIcon.className !== currentStatus.securityIconClass) {
            this.connectionSecurityIcon.className = currentStatus.securityIconClass;
        }

        // Update RTT value with combined RTT and variability
        if (this.connectionRttValue && this.connectionRttValue.textContent !== currentStatus.rttText) {
            this.connectionRttValue.textContent = currentStatus.rttText;
        }

        // Hide variability element since it's now combined with RTT
        if (this.connectionVariabilityValue) {
            this.connectionVariabilityValue.textContent = '';
            // Optionally hide the parent indicator if you want to remove it from view
            const variabilityIndicator = this.connectionVariabilityValue.closest('.connection-status-indicator');
            if (variabilityIndicator) {
                variabilityIndicator.style.display = 'none';
            }
        }

        // Store current status for next comparison
        this.lastConnectionStatus = currentStatus;
    }

    renderServiceWorkerStatus() {
        if (!this.serviceWorkerIcon) {
            return;
        }

        // Get service worker status from serviceWorkerManager
        let swStatus = {
            available: false,
            status: 'Not Available',
            heartbeatMissed: false,
            timeSinceLastHeartbeat: null
        };

        if (window.serviceWorkerManager) {
            swStatus = window.serviceWorkerManager.getServiceWorkerHeartbeatStatus();
        }

        // Build tooltip text and icon
        let tooltipText = 'Service Worker';
        let iconClass = 'fas fa-cog';
        let statusClass = '';

        if (!swStatus.available) {
            tooltipText = 'Service Worker: Not Registered';
            iconClass = 'fas fa-times-circle';
            statusClass = 'sw-unavailable';
        } else if (!swStatus.isResponding) {
            const secondsSinceResponse = swStatus.timeSinceLastPingResponse 
                ? Math.round(swStatus.timeSinceLastPingResponse / 1000) 
                : 0;
            tooltipText = `Service Worker: Stopped (no response for ${secondsSinceResponse}s)`;
            iconClass = 'fas fa-exclamation-triangle';
            statusClass = 'sw-heartbeat-missed';
        } else if (swStatus.heartbeatMissed) {
            const secondsSinceHeartbeat = swStatus.timeSinceLastHeartbeat 
                ? Math.round(swStatus.timeSinceLastHeartbeat / 1000) 
                : 0;
            tooltipText = `Service Worker: Heartbeat Missed (${secondsSinceHeartbeat}s)`;
            iconClass = 'fas fa-exclamation-triangle';
            statusClass = 'sw-heartbeat-missed';
        } else if (swStatus.isUpdating) {
            tooltipText = 'Service Worker: Updating';
            iconClass = 'fas fa-sync fa-spin';
            statusClass = 'sw-updating';
        } else if (swStatus.hasActive) {
            tooltipText = 'Service Worker: Active';
            iconClass = 'fas fa-check-circle';
            statusClass = 'sw-active';
        } else {
            tooltipText = 'Service Worker: Inactive';
            iconClass = 'fas fa-minus-circle';
            statusClass = 'sw-inactive';
        }

        // Update icon class (remove all possible classes and add the current one)
        const possibleClasses = ['fa-cog', 'fa-times-circle', 'fa-exclamation-triangle', 'fa-sync', 'fa-check-circle', 'fa-minus-circle', 'fa-spin'];
        possibleClasses.forEach(cls => this.serviceWorkerIcon.classList.remove(cls));
        
        iconClass.split(' ').forEach(cls => {
            if (cls) this.serviceWorkerIcon.classList.add(cls);
        });

        // Update status class and tooltip on the indicator element
        const indicatorElement = this.serviceWorkerIcon.closest('.connection-status-indicator');
        if (indicatorElement) {
            const possibleStatusClasses = ['sw-unavailable', 'sw-heartbeat-missed', 'sw-updating', 'sw-active', 'sw-inactive'];
            possibleStatusClasses.forEach(cls => indicatorElement.classList.remove(cls));
            if (statusClass) {
                indicatorElement.classList.add(statusClass);
            }
            // Update tooltip
            indicatorElement.setAttribute('title', tooltipText);
        }
    }

    renderEmpty() {
        // Show empty states
        if (this.activeRequestsEmptyState) {
            this.activeRequestsEmptyState.classList.remove('hidden');
        }
        if (this.previousRequestsEmptyState) {
            this.previousRequestsEmptyState.classList.remove('hidden');
        }
        
        // Clear request items
        if (this.activeRequestsList) {
            const existingItems = this.activeRequestsList.querySelectorAll('.request-item');
            existingItems.forEach(item => item.remove());
        }
        if (this.previousRequestsList) {
            const existingItems = this.previousRequestsList.querySelectorAll('.request-item');
            existingItems.forEach(item => item.remove());
        }
        
        // Update counts
        if (this.activeRequestsCount) {
            this.activeRequestsCount.textContent = '0';
        }
        if (this.previousRequestsCount) {
            this.previousRequestsCount.textContent = '0';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the modal manager
let websocketRequestsModal = null;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        websocketRequestsModal = new WebSocketRequestsModal();
    });
} else {
    websocketRequestsModal = new WebSocketRequestsModal();
}
