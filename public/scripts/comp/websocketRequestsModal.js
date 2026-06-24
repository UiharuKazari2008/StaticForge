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
        this.connectionStatusBadge = null;
        this.connectionStatusValue = null;
        this.connectionSecurityIcon = null;
        this.connectionTrafficUp = null;
        this.connectionTrafficDown = null;
        this.connectionRttValue = null;
        this.connectionVariabilityValue = null;
        this.serviceWorkerIcon = null;
        this.updateInterval = null;
        this.isUpdating = false;
        this.observer = null;
        this.lastActiveHash = null;
        this.lastPreviousHash = null;
        this.renderTarget = null;
        
        this.init();
    }

    setRenderTarget(target) {
        this.renderTarget = target || null;
        this.lastActiveHash = null;
        this.lastPreviousHash = null;
    }

    clearRenderTarget() {
        this.renderTarget = null;
        this.lastActiveHash = null;
        this.lastPreviousHash = null;
    }

    _getLists() {
        if (this.renderTarget) {
            return {
                activeList: this.renderTarget.activeList,
                previousList: this.renderTarget.previousList,
                previousCount: this.renderTarget.previousCount || null,
                activeEmpty: this.renderTarget.activeEmpty || null,
                previousEmpty: this.renderTarget.previousEmpty || null
            };
        }
        return {
            activeList: this.activeRequestsList,
            previousList: this.previousRequestsList,
            previousCount: this.previousRequestsCount,
            activeEmpty: this.activeRequestsEmptyState,
            previousEmpty: this.previousRequestsEmptyState
        };
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
        if (this.observerTimeout) {
            cancelAnimationFrame(this.observerTimeout);
            this.observerTimeout = null;
        }
    }

    teardown() {
        this.stopAutoUpdate();
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    update(force) {
        // Prevent concurrent updates
        if (this.isUpdating) {
            return;
        }
        
        const usingSidebar = !!this.renderTarget;
        if (!usingSidebar && (!this.modal || this.modal.classList.contains('hidden'))) {
            return;
        }
        if (!force && usingSidebar && !this.renderTarget.activeList) {
            return;
        }
        
        this.isUpdating = true;
        
        try {
            if (!window.wsClient) {
                this.renderEmpty();
                return;
            }

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
        const lists = this._getLists();
        const activeRequestsList = lists.activeList;
        if (!activeRequestsList) return;

        const currentHash = requests.map(r => `${r.id}:${r.age}:${r.isPending ? 'p' : 'c'}`).join('|');
        const hashKey = this.renderTarget ? 'sidebar-active' : 'modal-active';
        if (this.lastActiveHash === `${hashKey}:${currentHash}` && activeRequestsList.querySelectorAll('.request-item').length > 0) {
            this.updateActiveRequestAges(requests, activeRequestsList);
            return;
        }
        
        this.lastActiveHash = `${hashKey}:${currentHash}`;

        if (requests.length === 0) {
            const existingItems = activeRequestsList.querySelectorAll('.request-item');
            existingItems.forEach(item => item.remove());
            
            const emptyEl = lists.activeEmpty;
            if (emptyEl) {
                emptyEl.classList.remove('hidden');
            } else if (!activeRequestsList.querySelector('.empty-state')) {
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';
                emptyState.textContent = 'No active requests';
                activeRequestsList.appendChild(emptyState);
            }
            return;
        }

        if (lists.activeEmpty) {
            lists.activeEmpty.classList.add('hidden');
        }
        activeRequestsList.querySelectorAll('.empty-state').forEach((el) => el.classList.add('hidden'));

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
        const existingItems = activeRequestsList.querySelectorAll('.request-item');
        existingItems.forEach(item => item.remove());
        
        if (html) {
            activeRequestsList.insertAdjacentHTML('beforeend', html);
        }

        this.attachRequestItemContextMenus(activeRequestsList, requests);
    }
    
    updateActiveRequestAges(requests, listEl) {
        const activeRequestsList = listEl || this._getLists().activeList;
        if (!activeRequestsList) return;
        requests.forEach(req => {
            const item = activeRequestsList.querySelector(`[data-request-id="${req.id}"]`);
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
        const lists = this._getLists();
        const previousRequestsList = lists.previousList;
        if (!previousRequestsList) return;

        if (lists.previousCount) {
            lists.previousCount.textContent = String(requests.length);
        }

        const currentHash = requests.map(r => `${r.id}:${r.completedAt}`).join('|');
        const hashKey = this.renderTarget ? 'sidebar-prev' : 'modal-prev';
        if (this.lastPreviousHash === `${hashKey}:${currentHash}` && previousRequestsList.querySelectorAll('.request-item').length > 0) {
            return;
        }
        
        this.lastPreviousHash = `${hashKey}:${currentHash}`;

        if (requests.length === 0) {
            if (lists.previousEmpty) {
                lists.previousEmpty.classList.remove('hidden');
            }
            const existingItems = previousRequestsList.querySelectorAll('.request-item');
            existingItems.forEach(item => item.remove());
            return;
        }

        if (lists.previousEmpty) {
            lists.previousEmpty.classList.add('hidden');
        }
        previousRequestsList.querySelectorAll('.empty-state').forEach((el) => el.classList.add('hidden'));

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
        const existingItems = previousRequestsList.querySelectorAll('.request-item');
        existingItems.forEach(item => item.remove());
        
        if (html) {
            previousRequestsList.insertAdjacentHTML('beforeend', html);
        }

        this.attachRequestItemContextMenus(previousRequestsList, requests, false);
    }

    attachRequestItemContextMenus(listEl, requests, allowAbort = true) {
        if (!listEl || !requests || !requests.length) return;
        // contextMenu — public/scripts/comp/contextMenu.js
        if (typeof contextMenu === 'undefined' || !contextMenu) return;

        const requestById = new Map(requests.map((r) => [r.id, r]));

        listEl.querySelectorAll('.request-item[data-request-id]').forEach((itemEl) => {
            const requestId = itemEl.dataset.requestId;
            const req = requestById.get(requestId);
            if (!req) return;

            if (itemEl.dataset.requestContextMenuAttached === requestId) return;
            itemEl.dataset.requestContextMenuAttached = requestId;

            const menuItems = [];
            if (allowAbort && req.isPending) {
                menuItems.push({
                    icon: 'fas fa-ban',
                    text: 'Abort',
                    action: 'abort-request',
                    className: 'context-menu-item-danger'
                });
            }
            if (menuItems.length === 0) return;

            contextMenu.attachToElement(itemEl, {
                sections: [{ type: 'list', items: menuItems }],
                onAction: (action) => {
                    if (action !== 'abort-request') return;
                    if (!window.wsClient || typeof window.wsClient.abortPendingRequest !== 'function') return;
                    window.wsClient.abortPendingRequest(requestId, 'Request aborted');
                    this.update();
                }
            });
        });
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
