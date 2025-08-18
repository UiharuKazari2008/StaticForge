// Shared utilities for reference management

// Convert file to base64 string
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64 = reader.result.split(',')[1]; // Remove data URL prefix
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
}

// Get workspace display name
function getWorkspaceDisplayName(workspaceId) {
    const workspace = workspaces[workspaceId];
    return workspace ? workspace.name.charAt(0).toUpperCase() + workspace.name.slice(1) : 'Default';
}

// Show comment dialog
function showCommentDialog(comment, title) {
    const dialog = document.createElement('div');
    dialog.className = 'modal comment-dialog';
    dialog.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-comment"></i> ${title}</h3>
                <button class="btn-secondary btn-small" onclick="this.closest('.comment-dialog').remove()">
                    <i class="nai-cross"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="comment-content">
                    <p>${comment.replace(/\n/g, '<br>')}</p>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick="this.closest('.comment-dialog').remove()">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    openModal(dialog);
}

// Show multiple vibes comments dialog
function showVibesCommentsDialog(vibes) {
    const dialog = document.createElement('div');
    dialog.className = 'modal comment-dialog';
    
    const commentsHtml = vibes.map(vibe => `
        <div class="vibe-comment-item">
            <h4>${vibe.originalName || 'Vibe'}</h4>
            <p>${vibe.comment.replace(/\n/g, '<br>')}</p>
        </div>
    `).join('');
    
    dialog.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-comments"></i> Vibe Comments</h3>
                <button class="btn-secondary btn-small" onclick="this.closest('.comment-dialog').remove()">
                    <i class="nai-cross"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="vibes-comments-content">
                    ${commentsHtml}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick="this.closest('.comment-dialog').remove()">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    openModal(dialog);
}