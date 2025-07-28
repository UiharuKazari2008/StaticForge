// groupManager.js
// Image group management for StaticForge frontend

// Group state
let groups = [];
let activeGroup = null;
let isInGroupView = false;
let groupGalleryImages = [];
let groupGalleryContainer = null;
let groupOverlay = null;

// Initialize group manager
function initializeGroupManager() {
    loadGroups();
    setupGroupUI();
    setupGroupEventListeners();
}

// Load groups for current workspace
async function loadGroups() {
    try {
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/groups`);
        if (!response.ok) throw new Error('Failed to load groups');

        const data = await response.json();
        groups = data.groups || [];
        
        updateGroupUI();
        console.log('✅ Loaded groups:', groups.length);
    } catch (error) {
        console.error('Error loading groups:', error);
        showError('Failed to load groups: ' + error.message);
    }
}

// Setup group UI elements
function setupGroupUI() {
    // Create group overlay
    groupOverlay = document.createElement('div');
    groupOverlay.id = 'groupOverlay';
    groupOverlay.className = 'group-overlay';
    groupOverlay.style.display = 'none';
    
    // Create group gallery container
    groupGalleryContainer = document.createElement('div');
    groupGalleryContainer.id = 'groupGalleryContainer';
    groupGalleryContainer.className = 'group-gallery-container';
    
    // Create group header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    groupHeader.innerHTML = `
        <div class="group-header-left">
            <button id="closeGroupBtn" class="btn-secondary">
                <i class="fas fa-arrow-left"></i> Back to Gallery
            </button>
            <h3 id="groupTitle">Group Gallery</h3>
        </div>
        <div class="group-header-right">
            <button id="renameGroupBtn" class="btn-secondary">
                <i class="fas fa-edit"></i> Rename
            </button>
            <button id="deleteGroupBtn" class="btn-danger">
                <i class="fas fa-trash"></i> Delete Group
            </button>
        </div>
    `;
    
    // Create group gallery
    const groupGallery = document.createElement('div');
    groupGallery.id = 'groupGallery';
    groupGallery.className = 'group-gallery';
    
    groupGalleryContainer.appendChild(groupHeader);
    groupGalleryContainer.appendChild(groupGallery);
    groupOverlay.appendChild(groupGalleryContainer);
    
    // Add to body
    document.body.appendChild(groupOverlay);
}

// Setup event listeners
function setupGroupEventListeners() {
    // Close group view
    document.addEventListener('click', (e) => {
        if (e.target.id === 'closeGroupBtn') {
            closeGroupView();
        }
    });
    
    // Rename group
    document.addEventListener('click', (e) => {
        if (e.target.id === 'renameGroupBtn') {
            showRenameGroupModal();
        }
    });
    
    // Delete group
    document.addEventListener('click', (e) => {
        if (e.target.id === 'deleteGroupBtn') {
            showDeleteGroupModal();
        }
    });
    
    // Add group button to bulk actions
    document.addEventListener('click', (e) => {
        if (e.target.id === 'bulkCreateGroupBtn') {
            showCreateGroupModal();
        }
    });
}

// Update group UI
function updateGroupUI() {
    // Update group indicators in gallery
    updateGroupIndicators();
    
    // Update bulk actions bar
    updateBulkActionsForGroups();
}

// Update group indicators in gallery
function updateGroupIndicators() {
    const galleryItems = document.querySelectorAll('.gallery-item');
    
    galleryItems.forEach(item => {
        const filename = item.dataset.filename;
        if (!filename) return;
        
        // Remove existing group indicators
        const existingIndicator = item.querySelector('.group-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        // Check if image is in any groups
        const imageGroups = groups.filter(group => group.images.includes(filename));
        
        if (imageGroups.length > 0) {
            const indicator = document.createElement('div');
            indicator.className = 'group-indicator';
            indicator.innerHTML = `
                <i class="fas fa-layer-group"></i>
                <span class="group-count">${imageGroups.length}</span>
            `;
            
            // Add click handler to open first group
            indicator.addEventListener('click', (e) => {
                e.stopPropagation();
                openGroupView(imageGroups[0].id);
            });
            
            item.appendChild(indicator);
        }
    });
}

// Update bulk actions for groups
function updateBulkActionsForGroups() {
    const bulkActionsBar = document.getElementById('bulkActionsBar');
    if (!bulkActionsBar) return;
    
    // Check if create group button already exists
    let createGroupBtn = document.getElementById('bulkCreateGroupBtn');
    
    if (!createGroupBtn && selectedImages.size > 0) {
        createGroupBtn = document.createElement('button');
        createGroupBtn.id = 'bulkCreateGroupBtn';
        createGroupBtn.className = 'btn-secondary';
        createGroupBtn.innerHTML = '<i class="fas fa-layer-group"></i> Create Group';
        
        // Insert before the last button (clear selection)
        const buttonsContainer = bulkActionsBar.querySelector('.bulk-actions-buttons');
        const clearBtn = buttonsContainer.querySelector('#clearSelectionBtn');
        if (clearBtn) {
            buttonsContainer.insertBefore(createGroupBtn, clearBtn);
        } else {
            buttonsContainer.appendChild(createGroupBtn);
        }
    } else if (createGroupBtn && selectedImages.size === 0) {
        createGroupBtn.remove();
    }
}

// Show create group modal
function showCreateGroupModal() {
    if (selectedImages.size === 0) {
        showError('No images selected');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Create Image Group</h3>
                <button class="close-dialog">&times;</button>
            </div>
            <div class="modal-body">
                <p>Create a new group with <span id="createGroupSelectedCount">${selectedImages.size}</span> selected image(s):</p>
                <div class="form-group">
                    <label for="groupNameInput">Group Name:</label>
                    <input type="text" id="groupNameInput" class="form-control" placeholder="Enter group name..." maxlength="50">
                </div>
            </div>
            <div class="modal-footer">
                <button id="createGroupConfirmBtn" class="btn-primary">Create Group</button>
                <button class="btn-secondary close-dialog">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    openModal(modal);
    
    // Focus on input
    const nameInput = modal.querySelector('#groupNameInput');
    nameInput.focus();
    
    // Handle create
    modal.querySelector('#createGroupConfirmBtn').addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
            showError('Group name is required');
            return;
        }
        
        try {
            const imageFilenames = Array.from(selectedImages);
            const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/groups`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, imageFilenames })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create group');
            }
            
            const result = await response.json();
            showGlassToast('success', null, `Group "${name}" created with ${imageFilenames.length} images`);
            
            // Clear selection and reload
            clearSelection();
            await loadGroups();
            closeModal(modal);
            
        } catch (error) {
            console.error('Error creating group:', error);
            showError('Failed to create group: ' + error.message);
        }
    });
    
    // Handle close
    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('close-dialog')) {
            closeModal(modal);
        }
    });
}

// Open group view
async function openGroupView(groupId) {
    try {
        const group = groups.find(g => g.id === groupId);
        if (!group) {
            throw new Error('Group not found');
        }
        
        activeGroup = group;
        isInGroupView = true;
        
        // Load group images
        await loadGroupImages(group);
        
        // Update UI
        document.getElementById('groupTitle').textContent = group.name;
        
        // Show overlay
        groupOverlay.style.display = 'flex';
        
        // Add group view class to main gallery
        const mainGallery = document.getElementById('gallery');
        if (mainGallery) {
            mainGallery.classList.add('group-view-active');
        }
        
        // Disable main gallery scroll
        document.body.style.overflow = 'hidden';
        
    } catch (error) {
        console.error('Error opening group view:', error);
        showError('Failed to open group: ' + error.message);
    }
}

// Load group images
async function loadGroupImages(group) {
    try {
        // Get all images and filter to group images
        const allImagesResponse = await fetchWithAuth('/images');
        if (!allImagesResponse.ok) throw new Error('Failed to load images');
        
        const allImages = await allImagesResponse.json();
        groupGalleryImages = allImages.filter(img => {
            const filename = img.filename || img.original || img.upscaled;
            return group.images.includes(filename);
        });
        
        // Sort by newest first
        groupGalleryImages.sort((a, b) => b.mtime - a.mtime);
        
        // Display group gallery
        displayGroupGallery();
        
    } catch (error) {
        console.error('Error loading group images:', error);
        showError('Failed to load group images: ' + error.message);
    }
}

// Display group gallery
function displayGroupGallery() {
    const groupGallery = document.getElementById('groupGallery');
    if (!groupGallery) return;
    
    groupGallery.innerHTML = '';
    
    if (groupGalleryImages.length === 0) {
        groupGallery.innerHTML = '<div class="no-images">No images in this group</div>';
        return;
    }
    
    groupGalleryImages.forEach((image, index) => {
        const galleryItem = createGroupGalleryItem(image, index);
        groupGallery.appendChild(galleryItem);
    });
}

// Create group gallery item
function createGroupGalleryItem(image, index) {
    const item = document.createElement('div');
    item.className = 'group-gallery-item fade-in';
    const filename = image.filename || image.original || image.upscaled;
    item.dataset.filename = filename;
    item.dataset.time = image.mtime || 0;
    item.dataset.index = index;
    
    // Use preview image
    const img = document.createElement('img');
    img.src = `/previews/${image.preview}`;
    img.alt = image.base;
    img.loading = 'lazy';
    
    const overlay = document.createElement('div');
    overlay.className = 'group-gallery-item-overlay';
    
    // Create info container
    const infoContainer = document.createElement('div');
    infoContainer.className = 'group-gallery-item-info-container';
    
    // Extract preset name and seeds from filename
    let presetName = 'generated';
    let seed = '';
    
    if (filename) {
        const presetMatch = filename.match(/([^_]+)_\d+_\d+/);
        if (presetMatch) {
            presetName = presetMatch[1];
        }
        
        const seedMatch = filename.match(/_(\d+)_/);
        if (seedMatch) {
            seed = seedMatch[1];
        }
    }
    
    // Create preset badge
    const presetBadge = document.createElement('div');
    presetBadge.className = 'group-gallery-item-preset-badge';
    presetBadge.textContent = presetName;
    
    // Create seed badge
    const seedBadge = document.createElement('div');
    seedBadge.className = 'group-gallery-item-seed-badge';
    seedBadge.textContent = seed;
    
    infoContainer.appendChild(presetBadge);
    infoContainer.appendChild(seedBadge);
    
    // Create remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'group-gallery-item-remove-btn';
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.title = 'Remove from group';
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeImageFromGroup(filename);
    });
    
    overlay.appendChild(infoContainer);
    overlay.appendChild(removeBtn);
    
    item.appendChild(img);
    item.appendChild(overlay);
    
    return item;
}

// Remove image from group
async function removeImageFromGroup(filename) {
    if (!activeGroup) return;
    
    try {
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/groups/${activeGroup.id}/images`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageFilenames: [filename] })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to remove image from group');
        }
        
        const result = await response.json();
        showGlassToast('success', null, 'Image removed from group');
        
        // Reload group
        await loadGroups();
        await loadGroupImages(activeGroup);
        
    } catch (error) {
        console.error('Error removing image from group:', error);
        showError('Failed to remove image: ' + error.message);
    }
}

// Close group view
function closeGroupView() {
    isInGroupView = false;
    activeGroup = null;
    groupGalleryImages = [];
    
    // Hide overlay
    groupOverlay.style.display = 'none';
    
    // Remove group view class from main gallery
    const mainGallery = document.getElementById('gallery');
    if (mainGallery) {
        mainGallery.classList.remove('group-view-active');
    }
    
    // Re-enable main gallery scroll
    document.body.style.overflow = '';
}

// Show rename group modal
function showRenameGroupModal() {
    if (!activeGroup) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Rename Group</h3>
                <button class="close-dialog">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="renameGroupInput">New Name:</label>
                    <input type="text" id="renameGroupInput" class="form-control" value="${activeGroup.name}" maxlength="50">
                </div>
            </div>
            <div class="modal-footer">
                <button id="renameGroupConfirmBtn" class="btn-primary">Rename</button>
                <button class="btn-secondary close-dialog">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    openModal(modal);
    
    // Focus on input
    const nameInput = modal.querySelector('#renameGroupInput');
    nameInput.focus();
    nameInput.select();
    
    // Handle rename
    modal.querySelector('#renameGroupConfirmBtn').addEventListener('click', async () => {
        const newName = nameInput.value.trim();
        if (!newName) {
            showError('Group name is required');
            return;
        }
        
        try {
            const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/groups/${activeGroup.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to rename group');
            }
            
            const result = await response.json();
            showGlassToast('success', null, `Group renamed to "${newName}"`);
            
            // Update active group and UI
            activeGroup = result.group;
            document.getElementById('groupTitle').textContent = newName;
            
            // Reload groups
            await loadGroups();
            closeModal(modal);
            
        } catch (error) {
            console.error('Error renaming group:', error);
            showError('Failed to rename group: ' + error.message);
        }
    });
    
    // Handle close
    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('close-dialog')) {
            closeModal(modal);
        }
    });
}

// Show delete group modal
async function showDeleteGroupModal() {
    if (!activeGroup) return;
    
    const confirmed = await showConfirmationDialog(
        `Are you sure you want to delete the group "${activeGroup.name}"? This will not delete the images, only remove them from the group.`,
        'Delete Group',
        'Cancel'
    );
    
    if (!confirmed) return;
    
    deleteGroup(activeGroup.id);
}

// Delete group
async function deleteGroup(groupId) {
    try {
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/groups/${groupId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete group');
        }
        
        showGlassToast('success', null, 'Group deleted');
        
        // Close group view and reload
        closeGroupView();
        await loadGroups();
        
    } catch (error) {
        console.error('Error deleting group:', error);
        showError('Failed to delete group: ' + error.message);
    }
}

// Add new images to current group when in group view
function addNewImagesToCurrentGroup(imageFilenames) {
    if (!isInGroupView || !activeGroup) return;
    
    addImagesToGroup(activeGroup.id, imageFilenames);
}

// Add images to group
async function addImagesToGroup(groupId, imageFilenames) {
    try {
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/groups/${groupId}/images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageFilenames })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to add images to group');
        }
        
        const result = await response.json();
        
        // If in group view, reload the group
        if (isInGroupView && activeGroup && activeGroup.id === groupId) {
            await loadGroupImages(result.group);
        }
        
        // Reload groups
        await loadGroups();
        
        return result.addedCount;
        
    } catch (error) {
        console.error('Error adding images to group:', error);
        showError('Failed to add images to group: ' + error.message);
        return 0;
    }
}

// Get groups for image
async function getGroupsForImage(filename) {
    try {
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/images/${encodeURIComponent(filename)}/groups`);
        if (!response.ok) throw new Error('Failed to get groups for image');
        
        const data = await response.json();
        return data.groups || [];
    } catch (error) {
        console.error('Error getting groups for image:', error);
        return [];
    }
}

// Create group from selection (called from bulk actions)
async function createGroupFromSelection(groupName, imageFilenames) {
    try {
        const response = await fetchWithAuth(`/workspaces/${activeWorkspace}/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: groupName, imageFilenames })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create group');
        }
        
        const result = await response.json();
        
        // Reload groups to get the new group
        await loadGroups();
        
        return result;
        
    } catch (error) {
        console.error('Error creating group from selection:', error);
        throw error;
    }
}

// Export functions
window.groupManager = {
    initializeGroupManager,
    loadGroups,
    openGroupView,
    closeGroupView,
    addNewImagesToCurrentGroup,
    addImagesToGroup,
    getGroupsForImage,
    createGroupFromSelection,
    updateGroupUI,
    isInGroupView: () => isInGroupView,
    getActiveGroup: () => activeGroup
};