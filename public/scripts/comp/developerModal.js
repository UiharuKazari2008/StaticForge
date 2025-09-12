/**
 * Developer Modal Component
 * Handles the developer mode settings modal and keyboard shortcuts
 */

class DeveloperModal {
    constructor() {
        this.modal = null;
        this.devModeToggle = null;
        this.hostInput = null;
        this.portInput = null;
        this.connectionStatus = null;
        this.masterStatus = null;
        this.sessionId = null;
        this.clientId = null;
        
        this.init();
    }
    
    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }
    
    setup() {
        this.modal = document.getElementById('developerModal');
        this.devModeToggle = document.getElementById('devModeToggle');
        this.hostInput = document.getElementById('devHostInput');
        this.portInput = document.getElementById('devPortInput');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.masterStatus = document.getElementById('masterStatus');
        this.sessionId = document.getElementById('sessionId');
        this.clientId = document.getElementById('clientId');
        
        if (!this.modal) {
            console.warn('Developer modal not found');
            return;
        }
        
        this.setupKeyboardShortcuts();
        this.loadSettings();
        this.updateStatus();
        
        // Listen for dev bridge events
        this.setupDevBridgeListeners();
    }
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // CTRL + LEFT SHIFT + F8
            if (e.ctrlKey && e.shiftKey && e.key === 'F8' && e.location === 1) { // location 1 = left side
                e.preventDefault();
                this.toggleModal();
            }
            
            // ESC to close modal
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.closeModal();
            }
        });
    }
    
    setupDevBridgeListeners() {
        // Listen for dev bridge connection events
        window.addEventListener('devBridgeConnected', () => {
            this.updateStatus();
        });
        
        window.addEventListener('devBridgeDisconnected', () => {
            this.updateStatus();
        });
        
        window.addEventListener('devBridgeMasterChanged', (e) => {
            this.updateMasterStatus(e.detail.isMaster);
        });
        
        window.addEventListener('devBridgeSessionChanged', (e) => {
            this.updateSessionInfo(e.detail);
        });
    }
    
    toggleModal() {
        if (this.modal.classList.contains('hidden')) {
            this.openModal();
        } else {
            this.closeModal();
        }
    }
    
    openModal() {
        this.modal.classList.remove('hidden');
        this.loadSettings();
        this.updateStatus();
        document.body.style.overflow = 'hidden';
    }
    
    closeModal() {
        this.modal.classList.add('hidden');
        document.body.style.overflow = '';
    }
    
    loadSettings() {
        // Load developer mode setting
        const devMode = localStorage.getItem('staticforge_dev_mode') === 'true';
        if (this.devModeToggle) {
            this.devModeToggle.checked = devMode;
        }
        
        // Load host and port settings - only show saved values, not defaults
        const host = localStorage.getItem('staticforge_dev_host') || '';
        const port = localStorage.getItem('staticforge_dev_port') || '';
        
        if (this.hostInput) {
            this.hostInput.value = host;
        }
        if (this.portInput) {
            this.portInput.value = port;
        }
    }
    
    saveSettings() {
        const devMode = this.devModeToggle ? this.devModeToggle.checked : false;
        const host = this.hostInput ? this.hostInput.value.trim() : '';
        const port = this.portInput ? this.portInput.value.trim() : '';
        
        // Save to localStorage
        localStorage.setItem('staticforge_dev_mode', devMode.toString());
        
        // Only save host/port if they have values, otherwise remove from localStorage
        if (host) {
            localStorage.setItem('staticforge_dev_host', host);
        } else {
            localStorage.removeItem('staticforge_dev_host');
        }
        
        if (port) {
            localStorage.setItem('staticforge_dev_port', port);
        } else {
            localStorage.removeItem('staticforge_dev_port');
        }
        
        // Show success message
        this.showToast('Settings saved successfully!', 'success');
        
        // If dev mode was enabled/disabled, reload the page to apply changes
        if (devMode !== (localStorage.getItem('staticforge_dev_mode') === 'true')) {
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        }
    }
    
    resetSettings() {
        // Reset to defaults - clear all settings
        localStorage.setItem('staticforge_dev_mode', 'false');
        localStorage.removeItem('staticforge_dev_host');
        localStorage.removeItem('staticforge_dev_port');
        
        this.loadSettings();
        this.showToast('Settings reset to defaults!', 'info');
    }
    
    refreshStatus() {
        this.updateStatus();
        this.showToast('Status refreshed!', 'info');
    }
    
    updateStatus() {
        // Update connection status
        const isConnected = this.isDevBridgeConnected();
        if (this.connectionStatus) {
            this.connectionStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
            this.connectionStatus.className = `status-value ${isConnected ? 'connected' : 'disconnected'}`;
        }
        
        // Update master status
        const isMaster = this.isMasterClient();
        if (this.masterStatus) {
            this.masterStatus.textContent = isMaster ? 'Yes' : 'No';
            this.masterStatus.className = `status-value ${isMaster ? 'yes' : 'no'}`;
        }
        
        // Update session and client info
        this.updateSessionInfo();
    }
    
    updateMasterStatus(isMaster) {
        if (this.masterStatus) {
            this.masterStatus.textContent = isMaster ? 'Yes' : 'No';
            this.masterStatus.className = `status-value ${isMaster ? 'yes' : 'no'}`;
        }
    }
    
    updateSessionInfo(sessionData = null) {
        if (sessionData) {
            if (this.sessionId) {
                this.sessionId.textContent = sessionData.sessionId || '-';
            }
            if (this.clientId) {
                this.clientId.textContent = sessionData.clientId || '-';
            }
        } else {
            // Try to get from global variables
            if (this.sessionId) {
                this.sessionId.textContent = window.devBridgeSessionId || '-';
            }
            if (this.clientId) {
                this.clientId.textContent = window.devBridgeClientId || '-';
            }
        }
    }
    
    isDevBridgeConnected() {
        // Check if dev bridge is connected
        return window.devBridgeWs && window.devBridgeWs.readyState === WebSocket.OPEN;
    }
    
    isMasterClient() {
        // Check if this is the master client
        return window.isMasterClient === true;
    }
    
    showToast(message, type = 'info') {
        // Use existing toast system if available
        if (window.showToast) {
            window.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Global functions for HTML onclick handlers
function openDeveloperModal() {
    if (window.developerModal) {
        window.developerModal.openModal();
    }
}

function closeDeveloperModal() {
    if (window.developerModal) {
        window.developerModal.closeModal();
    }
}

function toggleDevMode() {
    if (window.developerModal) {
        const isEnabled = window.developerModal.devModeToggle.checked;
        if (isEnabled) {
            window.developerModal.showToast('Developer mode will be enabled after page reload', 'info');
        } else {
            window.developerModal.showToast('Developer mode will be disabled after page reload', 'info');
        }
    }
}

function saveDevSettings() {
    if (window.developerModal) {
        window.developerModal.saveSettings();
    }
}

function refreshStatus() {
    if (window.developerModal) {
        window.developerModal.refreshStatus();
    }
}

function resetDevSettings() {
    if (window.developerModal) {
        window.developerModal.resetSettings();
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.developerModal = new DeveloperModal();
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeveloperModal;
}
