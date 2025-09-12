/**
 * Master Window Client
 * Provides early master window management and conflict resolution
 * Loads before body to capture events early
 */

(function() {
    'use strict';
    
    // Early initialization - don't wait for DOM
    const MASTER_WINDOW_KEY = 'staticforge_master_window';
    const MASTER_SESSION_KEY = 'staticforge_master_session';
    const CONFLICT_CHECK_INTERVAL = 5000; // 5 seconds
    
    let masterWindowClient = {
        isMaster: false,
        sessionId: null,
        ws: null,
        conflictCheckInterval: null,
        toastContainer: null,
        
        init() {
            this.checkMasterStatus();
            this.setupWebSocket();
            this.createToastContainer();
            this.startConflictCheck();
        },
        
        checkMasterStatus() {
            const masterData = localStorage.getItem(MASTER_WINDOW_KEY);
            if (masterData) {
                try {
                    const data = JSON.parse(masterData);
                    this.isMaster = data.isMaster || false;
                    this.sessionId = data.sessionId || this.generateSessionId();
                    
                    if (this.isMaster) {
                        console.log('🔧 Master Window: This window is marked as master');
                        this.claimMasterShip();
                    }
                } catch (error) {
                    console.error('🔧 Master Window: Error parsing master data:', error);
                    this.clearMasterStatus();
                }
            } else {
                this.sessionId = this.generateSessionId();
            }
        },
        
        generateSessionId() {
            return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        },
        
        setupWebSocket() {
            // Only connect if we're in development mode
            if (!this.isDevelopmentMode()) {
                return;
            }
            
            const devHost = localStorage.getItem('staticforge_dev_host') || window.location.hostname;
            const devPort = localStorage.getItem('staticforge_dev_port');
            
            if (!devPort) {
                console.error('🔧 Dev port not found in localStorage. Please refresh the page.');
                return;
            }
            
            const wsUrl = `ws://${devHost}:${devPort}`;
            
            try {
                this.ws = new WebSocket(wsUrl);
                
                this.ws.onopen = () => {
                    console.log('🔧 Master Window: Connected to dev bridge');
                    this.registerAsClient();
                };
                
                this.ws.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };
                
                this.ws.onclose = () => {
                    console.log('🔧 Master Window: Disconnected from dev bridge');
                    this.ws = null;
                    // Attempt to reconnect after a delay
                    setTimeout(() => this.setupWebSocket(), 3000);
                };
                
                this.ws.onerror = (error) => {
                    console.error('🔧 Master Window: WebSocket error:', error);
                };
                
            } catch (error) {
                console.error('🔧 Master Window: Failed to connect to dev bridge:', error);
            }
        },
        
        registerAsClient() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'register_master_client',
                    sessionId: this.sessionId,
                    isMaster: this.isMaster,
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    timestamp: Date.now()
                }));
            }
        },
        
        handleMessage(data) {
            switch (data.type) {
                case 'welcome':
                    this.clientId = data.clientId;
                    this.registerAsClient();
                    break;
                    
                case 'master_conflict':
                    this.handleMasterConflict(data);
                    break;
                    
                case 'master_kicked':
                    this.handleMasterKicked(data);
                    break;
                    
                case 'master_granted':
                    this.handleMasterGranted(data);
                    break;
                    
                case 'master_denied':
                    this.handleMasterDenied(data);
                    break;
            }
        },
        
        claimMasterShip() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'claim_master',
                    sessionId: this.sessionId,
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    timestamp: Date.now()
                }));
            }
        },
        
        handleMasterConflict(data) {
            console.log('🔧 Master Window: Conflict detected with another master window');
            this.showConflictToast(data);
        },
        
        handleMasterKicked(data) {
            console.log('🔧 Master Window: This window was kicked by another master');
            this.clearMasterStatus();
            this.showKickedToast();
        },
        
        handleMasterGranted(data) {
            console.log('🔧 Master Window: Master status granted');
            this.setMasterStatus(true);
            this.hideConflictToast();
        },
        
        handleMasterDenied(data) {
            console.log('🔧 Master Window: Master status denied');
            this.clearMasterStatus();
        },
        
        setMasterStatus(isMaster) {
            this.isMaster = isMaster;
            const masterData = {
                isMaster: isMaster,
                sessionId: this.sessionId,
                timestamp: Date.now()
            };
            localStorage.setItem(MASTER_WINDOW_KEY, JSON.stringify(masterData));
            localStorage.setItem(MASTER_SESSION_KEY, this.sessionId);
            
            // Update global variables for developer modal
            window.isMasterClient = isMaster;
            window.devBridgeSessionId = this.sessionId;
            window.devBridgeClientId = this.clientId;
            
            // Emit event for developer modal
            window.dispatchEvent(new CustomEvent('devBridgeMasterChanged', {
                detail: { isMaster: isMaster, sessionId: this.sessionId, clientId: this.clientId }
            }));
            
            // Update UI if available
            this.updateMasterUI();
        },
        
        clearMasterStatus() {
            this.isMaster = false;
            localStorage.removeItem(MASTER_WINDOW_KEY);
            localStorage.removeItem(MASTER_SESSION_KEY);
            
            // Update global variables for developer modal
            window.isMasterClient = false;
            
            // Emit event for developer modal
            window.dispatchEvent(new CustomEvent('devBridgeMasterChanged', {
                detail: { isMaster: false, sessionId: this.sessionId, clientId: this.clientId }
            }));
            
            this.updateMasterUI();
        },
        
        updateMasterUI() {
            // Update any UI elements that show master status
            const masterIndicators = document.querySelectorAll('.master-indicator');
            masterIndicators.forEach(indicator => {
                if (this.isMaster) {
                    indicator.textContent = '🔧 Master';
                    indicator.style.color = '#4CAF50';
                } else {
                    indicator.textContent = '⚪ Client';
                    indicator.style.color = '#666';
                }
            });
        },
        
        createToastContainer() {
            this.toastContainer = document.createElement('div');
            this.toastContainer.id = 'master-window-toast-container';
            this.toastContainer.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: none;
                justify-content: center;
                align-items: center;
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            `;
            document.documentElement.appendChild(this.toastContainer);
        },
        
        showConflictToast(conflictData) {
            const toast = document.createElement('div');
            toast.style.cssText = `
                background: white;
                border-radius: 12px;
                padding: 24px;
                max-width: 400px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                text-align: center;
            `;
            
            toast.innerHTML = `
                <div style="font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #333;">
                    🔧 Master Window Conflict
                </div>
                <div style="font-size: 14px; color: #666; margin-bottom: 20px; line-height: 1.4;">
                    Another browser window is currently the master debugging client.<br>
                    <strong>Current Master:</strong> ${conflictData.currentMaster?.url || 'Unknown'}<br>
                    <strong>Session:</strong> ${conflictData.currentMaster?.sessionId || 'Unknown'}
                </div>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="force-master-btn" style="
                        background: #f44336;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                    ">Force Ownership</button>
                    <button id="cancel-master-btn" style="
                        background: #666;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                    ">Cancel</button>
                </div>
            `;
            
            this.toastContainer.appendChild(toast);
            this.toastContainer.style.display = 'flex';
            
            // Add event listeners
            document.getElementById('force-master-btn').onclick = () => {
                this.forceMasterOwnership();
                this.hideConflictToast();
            };
            
            document.getElementById('cancel-master-btn').onclick = () => {
                this.hideConflictToast();
            };
        },
        
        showKickedToast() {
            const toast = document.createElement('div');
            toast.style.cssText = `
                background: #ffebee;
                border: 1px solid #f44336;
                border-radius: 8px;
                padding: 16px;
                max-width: 300px;
                text-align: center;
                color: #c62828;
                font-size: 14px;
            `;
            
            toast.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 8px;">
                    🔧 Master Window Kicked
                </div>
                <div>
                    Another browser window has taken master ownership. This window is now a regular client.
                </div>
            `;
            
            this.toastContainer.appendChild(toast);
            this.toastContainer.style.display = 'flex';
            
            // Auto-hide after 5 seconds
            setTimeout(() => {
                this.hideConflictToast();
            }, 5000);
        },
        
        hideConflictToast() {
            this.toastContainer.style.display = 'none';
            this.toastContainer.innerHTML = '';
        },
        
        forceMasterOwnership() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'force_master',
                    sessionId: this.sessionId,
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    timestamp: Date.now()
                }));
            }
        },
        
        startConflictCheck() {
            this.conflictCheckInterval = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'check_master_status',
                        sessionId: this.sessionId,
                        timestamp: Date.now()
                    }));
                }
            }, CONFLICT_CHECK_INTERVAL);
        },
        
        isDevelopmentMode() {
            // Check localStorage for dev mode flag
            const devMode = localStorage.getItem('staticforge_dev_mode');
            return devMode === 'true';
        },
        
        // Public API
        setAsMaster() {
            this.setMasterStatus(true);
            this.claimMasterShip();
        },
        
        clearMaster() {
            this.clearMasterStatus();
        },
        
        isMasterWindow() {
            return this.isMaster;
        },
        
        getSessionId() {
            return this.sessionId;
        }
    };
    
    // Initialize immediately
    masterWindowClient.init();
    
    // Make it globally available
    window.masterWindowClient = masterWindowClient;
    
    // Add global functions for easy access
    window.setAsMasterWindow = () => masterWindowClient.setAsMaster();
    window.clearMasterWindow = () => masterWindowClient.clearMaster();
    window.isMasterWindow = () => masterWindowClient.isMasterWindow();
    
    // Dev mode functions are now in app.js for global availability
    
    console.log('🔧 Master Window Client initialized');
    
})();
