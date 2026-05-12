// Explorer Applet - Windows Vista-style file explorer
// Shows workspaces as drives with progress bars showing image percentage

class ExplorerApplet {
    constructor() {
        this.modal = null;
        this.drivesContainer = null;
        this.totalImageCount = 0;
        this.workspaces = {};
        this.refreshInterval = null;
    }

    init() {
        this.modal = document.getElementById('explorerModal');
        if (!this.modal) {
            console.error('Explorer modal not found');
            return;
        }

        this.drivesContainer = document.getElementById('explorerDrivesContainer');
        if (!this.drivesContainer) {
            console.error('Explorer drives container not found');
            return;
        }

        // Setup close button
        const closeBtn = document.getElementById('closeExplorerBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.close();
            });
        }

        // Setup minimize button handler (handled by modalUtils)
        // Setup window controls
        const minimizeBtn = this.modal.querySelector('.minimize-btn');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                this.modal.classList.add('minimised');
                updateBackdropVisibility(); // public/scripts/comp/modalUtils.js
            });
        }

        console.log('Explorer applet initialized');
    }

    async open() {
        if (!this.modal) {
            this.init();
        }

        if (!this.modal) {
            console.error('Cannot open explorer: modal not found');
            return;
        }

        // Open the modal
        openModal(this.modal);

        // Load and display drives
        await this.loadDrives();
    }

    close() {
        if (this.modal) {
            closeModal(this.modal);
        }
    }

    async loadDrives() {
        try {
            // Get workspaces from client-side data (already loaded)
            // Try multiple ways to access workspaces
            let workspacesData = null;
            if (typeof workspaces !== 'undefined') {
                workspacesData = workspaces;
            } else if (window.workspaces) {
                workspacesData = window.workspaces;
            } else if (window.optionsData && window.optionsData.workspaces) {
                workspacesData = window.optionsData.workspaces;
            }
            
            if (!workspacesData || Object.keys(workspacesData).length === 0) {
                this.showError('No workspaces found');
                return;
            }

            // Get system info for image counts (same way about dialog does)
            let systemInfo = null;
            if (window.wsClient && window.wsClient.isConnected()) {
                try {
                    systemInfo = await window.wsClient.sendMessage('get_system_info', {});
                } catch (error) {
                    console.warn('Failed to get system info, using workspace data only:', error);
                }
            }

            // Build workspace list with image counts from system info
            const workspaceList = {};
            let totalImageCount = 0;

            // Create a map of system info workspaces for quick lookup
            const systemWorkspacesMap = {};
            if (systemInfo && systemInfo.workspaces && Array.isArray(systemInfo.workspaces)) {
                systemInfo.workspaces.forEach(ws => {
                    // System info workspaces may have id or name as identifier
                    if (ws.id) {
                        systemWorkspacesMap[ws.id] = ws;
                    } else if (ws.name) {
                        // Try to match by name as fallback
                        Object.keys(workspacesData).forEach(id => {
                            if (workspacesData[id].name === ws.name) {
                                systemWorkspacesMap[id] = ws;
                            }
                        });
                    }
                });
            }

            Object.entries(workspacesData).forEach(([id, workspace]) => {
                let imageCount = 0;

                // Try to get image count from system info first
                const sysWorkspace = systemWorkspacesMap[id];
                if (sysWorkspace) {
                    imageCount = sysWorkspace.images || 0;
                }

                // Fallback to file count if no system info available
                if (imageCount === 0 && workspace.files && Array.isArray(workspace.files)) {
                    imageCount = workspace.files.length || 0;
                }

                workspaceList[id] = {
                    id: id,
                    name: workspace.name || 'Unknown',
                    color: workspace.color || '#102040',
                    sort: workspace.sort || 0,
                    imageCount: imageCount
                };

                totalImageCount += imageCount;
            });

            this.workspaces = workspaceList;
            this.totalImageCount = totalImageCount || 1; // Avoid division by zero

            // Render drives
            this.renderDrives();
        } catch (error) {
            console.error('Error loading drives:', error);
        }
    }

    renderDrives() {
        if (!this.drivesContainer) return;

        // Clear existing drives
        this.drivesContainer.innerHTML = '';

        // Sort workspaces by sort order
        const sortedWorkspaces = Object.values(this.workspaces).sort((a, b) => {
            return (a.sort || 0) - (b.sort || 0);
        });

        // Create drive items
        sortedWorkspaces.forEach((workspace, index) => {
            const driveItem = this.createDriveItem(workspace, index);
            this.drivesContainer.appendChild(driveItem);
        });

        // If no workspaces, show empty state
        if (sortedWorkspaces.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'explorer-empty-state';
            emptyState.innerHTML = `
                <i class="fas fa-folder-open"></i>
                <p>No workspaces found</p>
            `;
            this.drivesContainer.appendChild(emptyState);
        }
    }

    createDriveItem(workspace, index) {
        const driveItem = document.createElement('div');
        driveItem.className = 'explorer-drive-item';
        driveItem.dataset.workspaceId = workspace.id;

        // Calculate percentage
        const imageCount = workspace.imageCount || 0;
        const percentage = this.totalImageCount > 0 
            ? Math.round((imageCount / this.totalImageCount) * 100) 
            : 0;

        // Generate drive letter (A, B, C, D, etc.)
        const driveLetter = String.fromCharCode(65 + (index % 26)); // A-Z

        // Create drive icon with color
        const workspaceColor = workspace.color || '#102040';

        // Format like Vista: "X images" or show total available
        const freeCount = this.totalImageCount - imageCount;
        const displayText = `${freeCount.toLocaleString()} free of ${this.totalImageCount.toLocaleString()}`;

        driveItem.innerHTML = `
            <div class="explorer-drive-icon-container">
                <div class="explorer-drive-icon" style="color: ${workspaceColor};">
                    <i class="fas fa-hard-drive"></i>
                </div>
            </div>
            <div class="explorer-drive-info">
                <div class="explorer-drive-name">${this.escapeHtml(workspace.name) || 'Workspace'} (${driveLetter}:)</div>
                <div class="explorer-drive-capacity">${displayText}</div>
                <div class="explorer-drive-progress-container">
                    <div class="explorer-drive-progress-bar">
                        <div class="explorer-drive-progress-fill" 
                             style="width: ${percentage}%;"
                             data-percentage="${percentage}"></div>
                    </div>
                </div>
            </div>
        `;

        // Add click handler to open workspace
        driveItem.addEventListener('click', () => {
            setActiveWorkspace(workspace.id);
        });

        return driveItem;
    }

    showError(message) {
        if (!this.drivesContainer) return;
        
        this.drivesContainer.innerHTML = `
            <div class="explorer-error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>${this.escapeHtml(message)}</p>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize explorer applet when DOM is ready
let explorerApplet = null;

function initializeExplorerApplet() {
    if (!explorerApplet) {
        explorerApplet = new ExplorerApplet();
        explorerApplet.init();
    }
    return explorerApplet;
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExplorerApplet);
} else {
    initializeExplorerApplet();
}

// Expose globally
window.explorerApplet = explorerApplet;
window.openExplorerApplet = () => {
    if (!explorerApplet) {
        explorerApplet = initializeExplorerApplet();
    }
    if (explorerApplet) {
        explorerApplet.open();
    }
};
