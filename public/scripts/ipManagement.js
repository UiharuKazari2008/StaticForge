// IP Management System
class IPManagementSystem {
    constructor() {
        this.currentPage = 1;
        this.totalPages = 1;
        this.totalCount = 0;
        this.currentIPs = [];
        this.selectedIP = null;
        this.searchTerm = '';
        
        this.init();
    }
    
    init() {
        this.bindEvents();
    }
    
    bindEvents() {
        // IP Management Modal
        document.getElementById('closeIPManagementBtn').addEventListener('click', () => {
            this.closeIPManagementModal();
        });
        
        // Pagination
        document.getElementById('ipPrevBtn').addEventListener('click', () => {
            this.previousPage();
        });
        
        document.getElementById('ipNextBtn').addEventListener('click', () => {
            this.nextPage();
        });
        
        // Search
        document.getElementById('ipSearchInput').addEventListener('input', (e) => {
            this.searchTerm = e.target.value;
            this.searchIPs();
        });
        
        // Refresh
        document.getElementById('refreshIPListBtn').addEventListener('click', () => {
            this.loadIPs();
        });
        
        // IP Details Modal
        document.getElementById('closeIPDetailsBtn').addEventListener('click', () => {
            this.closeIPDetailsModal();
        });
        
        document.getElementById('closeIPDetailsCancelBtn').addEventListener('click', () => {
            this.closeIPDetailsModal();
        });
        
        document.getElementById('unblockIPBtn').addEventListener('click', () => {
            this.unblockSelectedIP();
        });
        
        document.getElementById('exportIPBtn').addEventListener('click', () => {
            this.exportSelectedIP();
        });
    }
    
    async openIPManagementModal() {
        // Check if user is admin
        const userType = localStorage.getItem('userType');
        if (userType !== 'admin') {
            showGlassToast('error', 'Access Denied', 'Admin access required for IP management', false, 5000, '<i class="fas fa-lock"></i>');
            return;
        }
        
        document.getElementById('ipManagementModal').classList.remove('hidden');
        this.loadIPs();
    }
    
    closeIPManagementModal() {
        document.getElementById('ipManagementModal').classList.add('hidden');
        this.searchTerm = '';
        document.getElementById('ipSearchInput').value = '';
    }
    
    async loadIPs(page = 1) {
        try {
            if (!window.wsClient || !window.wsClient.isConnected()) {
                showGlassToast('error', 'Connection Error', 'WebSocket not connected', false, 5000, '<i class="fas fa-wifi"></i>');
                return;
            }
            
            const response = await window.wsClient.getBlockedIPs(page, 15);
            
            if (response.success) {
                this.currentPage = response.pagination.currentPage;
                this.totalPages = response.pagination.totalPages;
                this.totalCount = response.pagination.totalCount;
                this.currentIPs = response.blockedIPs;
                
                this.updateUI();
                this.renderIPList();
            } else {
                showGlassToast('error', 'Error', 'Failed to load blocked IPs', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Error loading IPs:', error);
            showGlassToast('error', 'Error', 'Failed to load blocked IPs', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
    
    updateUI() {
        // Update stats
        document.getElementById('totalBlockedCount').textContent = this.totalCount;
        document.getElementById('currentPageInfo').textContent = `${this.currentPage} of ${this.totalPages}`;
        document.getElementById('ipPageInfo').textContent = `Page ${this.currentPage} of ${this.totalPages}`;
        
        // Update pagination buttons
        document.getElementById('ipPrevBtn').disabled = this.currentPage <= 1;
        document.getElementById('ipNextBtn').disabled = this.currentPage >= this.totalPages;
    }
    
    renderIPList() {
        const container = document.getElementById('ipManagementList');
        container.innerHTML = '';
        
        if (this.currentIPs.length === 0) {
            container.innerHTML = '<div class="no-ips-message">No blocked IPs found</div>';
            return;
        }
        
        this.currentIPs.forEach(ipData => {
            const ipElement = this.createIPElement(ipData);
            container.appendChild(ipElement);
        });
    }
    
    createIPElement(ipData) {
        const div = document.createElement('div');
        div.className = 'ip-item';
        div.innerHTML = `
            <div class="ip-info">
                <div class="ip-header">
                    <div class="ip-address">${ipData.ip}</div>
                    <div class="ip-reason-badge ${this.getReasonBadgeClass(ipData.reason)}">${this.getShortReason(ipData.reason)}</div>
                </div>
                <div class="ip-meta">
                    <span class="ip-attempts">${ipData.attempts} attempts</span>
                    <span class="ip-age">${this.formatAge(ipData.ageMinutes)}</span>
                </div>
            </div>
            <div class="ip-actions">
                <button type="button" class="btn-secondary btn-small" onclick="ipManagement.viewIPDetails('${ipData.ip}')" title="View Details">
                    <i class="fas fa-info-circle"></i>
                </button>
                <button type="button" class="btn-primary btn-small" onclick="ipManagement.unblockIP('${ipData.ip}')" title="Unblock IP">
                    <i class="fas fa-unlock"></i>
                </button>
                <button type="button" class="btn-secondary btn-small" onclick="ipManagement.exportIP('${ipData.ip}')" title="Export to Gateway">
                    <i class="fas fa-upload"></i>
                </button>
            </div>
        `;
        return div;
    }
    
    getShortReason(reason) {
        // Convert long reasons to short badges
        if (reason.includes('Failed login attempts')) {
            return 'Login';
        } else if (reason.includes('Scraping attempts')) {
            return 'Scraping';
        } else if (reason.includes('Invalid URL attempts')) {
            return 'Invalid URLs';
        } else if (reason.includes('Rate limit')) {
            return 'Rate Limit';
        } else if (reason.includes('Suspicious')) {
            return 'Suspicious';
        } else {
            return 'Blocked';
        }
    }
    
    getReasonBadgeClass(reason) {
        // Return appropriate CSS class based on reason type
        if (reason.includes('Failed login attempts')) {
            return 'badge-login';
        } else if (reason.includes('Scraping attempts')) {
            return 'badge-scraping';
        } else if (reason.includes('Invalid URL attempts')) {
            return 'badge-invalid';
        } else if (reason.includes('Rate limit')) {
            return 'badge-rate-limit';
        } else if (reason.includes('Suspicious')) {
            return 'badge-suspicious';
        } else {
            return 'badge-default';
        }
    }
    
    formatAge(minutes) {
        if (minutes < 60) {
            return `${minutes}m ago`;
        } else if (minutes < 1440) {
            const hours = Math.floor(minutes / 60);
            return `${hours}h ago`;
        } else {
            const days = Math.floor(minutes / 1440);
            return `${days}d ago`;
        }
    }
    
    searchIPs() {
        if (!this.searchTerm.trim()) {
            this.renderIPList();
            return;
        }
        
        const filteredIPs = this.currentIPs.filter(ip => 
            ip.ip.includes(this.searchTerm) || 
            ip.reason.toLowerCase().includes(this.searchTerm.toLowerCase())
        );
        
        const container = document.getElementById('ipManagementList');
        container.innerHTML = '';
        
        if (filteredIPs.length === 0) {
            container.innerHTML = '<div class="no-ips-message">No IPs match your search</div>';
            return;
        }
        
        filteredIPs.forEach(ipData => {
            const ipElement = this.createIPElement(ipData);
            container.appendChild(ipElement);
        });
    }
    
    previousPage() {
        if (this.currentPage > 1) {
            this.loadIPs(this.currentPage - 1);
        }
    }
    
    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.loadIPs(this.currentPage + 1);
        }
    }
    
    async viewIPDetails(ip) {
        try {
            if (!window.wsClient || !window.wsClient.isConnected()) {
                showGlassToast('error', 'Connection Error', 'WebSocket not connected', false, 5000, '<i class="fas fa-wifi"></i>');
                return;
            }
            
            const response = await window.wsClient.getIPBlockingReasons(ip);
            
            if (response.success) {
                this.selectedIP = ip;
                this.showIPDetails(response.reasons);
            } else {
                showGlassToast('error', 'Error', 'Failed to load IP details', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Error loading IP details:', error);
            showGlassToast('error', 'Error', 'Failed to load IP details', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
    
    showIPDetails(reasons) {
        document.getElementById('ipDetailsTitle').textContent = `IP Details: ${this.selectedIP}`;
        
        const content = document.getElementById('ipDetailsContent');
        content.innerHTML = `
            <div class="ip-details-section">
                <h4>Blocking Status</h4>
                <div class="detail-item">
                    <span class="detail-label">Blocked:</span>
                    <span class="detail-value ${reasons.isBlocked ? 'blocked' : 'not-blocked'}">${reasons.isBlocked ? 'Yes' : 'No'}</span>
                </div>
                ${reasons.isBlocked ? `
                    <div class="detail-item">
                        <span class="detail-label">Reason:</span>
                        <span class="detail-value">${reasons.blockedReason}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Attempts:</span>
                        <span class="detail-value">${reasons.blockedAttempts}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Blocked At:</span>
                        <span class="detail-value">${new Date(reasons.blockedAt).toLocaleString()}</span>
                    </div>
                ` : ''}
            </div>
            
            <div class="ip-details-section">
                <h4>Suspicious Activity</h4>
                <div class="detail-item">
                    <span class="detail-label">Suspicious:</span>
                    <span class="detail-value ${reasons.isSuspicious ? 'suspicious' : 'not-suspicious'}">${reasons.isSuspicious ? 'Yes' : 'No'}</span>
                </div>
                ${reasons.isSuspicious ? `
                    <div class="detail-item">
                        <span class="detail-label">Attempts:</span>
                        <span class="detail-value">${reasons.suspiciousAttempts}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Patterns:</span>
                        <div class="patterns-list">
                            ${reasons.suspiciousPatterns.map(pattern => `
                                <div class="pattern-item">
                                    <span class="pattern-url">${pattern.url}</span>
                                    <span class="pattern-time">${new Date(pattern.timestamp).toLocaleString()}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
            
            <div class="ip-details-section">
                <h4>Invalid URL Attempts</h4>
                <div class="detail-item">
                    <span class="detail-label">Has Invalid Attempts:</span>
                    <span class="detail-value ${reasons.hasInvalidAttempts ? 'invalid' : 'not-invalid'}">${reasons.hasInvalidAttempts ? 'Yes' : 'No'}</span>
                </div>
                ${reasons.hasInvalidAttempts ? `
                    <div class="detail-item">
                        <span class="detail-label">Count:</span>
                        <span class="detail-value">${reasons.invalidAttempts}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Last Attempt:</span>
                        <span class="detail-value">${new Date(reasons.lastInvalidAttempt).toLocaleString()}</span>
                    </div>
                ` : ''}
            </div>
        `;
        
        document.getElementById('ipDetailsModal').classList.remove('hidden');
    }
    
    closeIPDetailsModal() {
        document.getElementById('ipDetailsModal').classList.add('hidden');
        this.selectedIP = null;
    }
    
    async unblockIP(ip) {
        if (!confirm(`Are you sure you want to unblock IP ${ip}?`)) {
            return;
        }
        
        try {
            if (!window.wsClient || !window.wsClient.isConnected()) {
                showGlassToast('error', 'Connection Error', 'WebSocket not connected', false, 5000, '<i class="fas fa-wifi"></i>');
                return;
            }
            
            const response = await window.wsClient.unblockIP(ip);
            
            if (response.success) {
                showGlassToast('success', 'IP Unblocked', `IP ${ip} has been unblocked`, false, 3000, '<i class="fas fa-unlock"></i>');
                this.loadIPs(this.currentPage);
            } else {
                showGlassToast('error', 'Error', 'Failed to unblock IP', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Error unblocking IP:', error);
            showGlassToast('error', 'Error', 'Failed to unblock IP', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
    
    async unblockSelectedIP() {
        if (this.selectedIP) {
            await this.unblockIP(this.selectedIP);
            this.closeIPDetailsModal();
        }
    }
    
    async exportIP(ip) {
        if (!confirm(`Are you sure you want to export IP ${ip} to the gateway? This will remove it from the block list in 1 hour.`)) {
            return;
        }
        
        try {
            if (!window.wsClient || !window.wsClient.isConnected()) {
                showGlassToast('error', 'Connection Error', 'WebSocket not connected', false, 5000, '<i class="fas fa-wifi"></i>');
                return;
            }
            
            const response = await window.wsClient.exportIPToGateway(ip);
            
            if (response.success) {
                showGlassToast('success', 'IP Exported', `IP ${ip} exported to gateway and will be removed from block list in 1 hour`, false, 5000, '<i class="fas fa-upload"></i>');
                this.loadIPs(this.currentPage);
            } else {
                showGlassToast('error', 'Error', 'Failed to export IP', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        } catch (error) {
            console.error('Error exporting IP:', error);
            showGlassToast('error', 'Error', 'Failed to export IP', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
    
    async exportSelectedIP() {
        if (this.selectedIP) {
            await this.exportIP(this.selectedIP);
            this.closeIPDetailsModal();
        }
    }
}

// Initialize IP Management System
window.ipManagement = new IPManagementSystem();
