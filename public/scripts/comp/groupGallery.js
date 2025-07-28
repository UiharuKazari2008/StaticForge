// groupGallery.js
// Handles group-aware gallery rendering for StaticForge

// Assumes groupManager is loaded and provides window.groupManager.groups

function getDisplayList(allImages) {
    // Build a map of filename -> groupId for quick lookup
    let groupMap = {};
    let groupLatestImage = {};
    let groupData = {};
    const groups = (window.groupManager && window.groupManager.groups) || [];
    groups.forEach(group => {
        group.images.forEach(filename => {
            groupMap[filename] = group.id;
            groupData[group.id] = group;
        });
    });
    // Find the latest image for each group
    Object.values(groupData).forEach(group => {
        let latest = null;
        group.images.forEach(filename => {
            const img = allImages.find(img => (img.filename || img.original || img.upscaled) === filename);
            if (img && (!latest || img.mtime > latest.mtime)) {
                latest = img;
            }
        });
        if (latest) {
            groupLatestImage[group.id] = latest;
        }
    });
    // Build display list: only show group preview at latest image's position, skip other group images
    const displayList = [];
    const usedGroupIds = new Set();
    for (let i = 0; i < allImages.length; i++) {
        const img = allImages[i];
        const filename = img.filename || img.original || img.upscaled;
        const groupId = groupMap[filename];
        if (groupId) {
            // Only show group preview at latest image's position
            if (groupLatestImage[groupId] && groupLatestImage[groupId] === img && !usedGroupIds.has(groupId)) {
                displayList.push({ type: 'group', group: groupData[groupId], image: img, index: i });
                usedGroupIds.add(groupId);
            }
            // else skip
        } else {
            displayList.push({ type: 'image', image: img, index: i });
        }
    }
    return displayList;
}

function isGroupPreview(item) {
    return item && item.type === 'group';
}

function renderGroupPreview(group, image, index) {
    const item = document.createElement('div');
    item.className = 'gallery-item group-preview fade-in';
    item.dataset.groupId = group.id;
    item.dataset.filename = image.filename || image.original || image.upscaled;
    item.dataset.time = image.mtime || 0;
    item.dataset.index = index;

    // Group preview UI
    const groupIcon = document.createElement('div');
    groupIcon.className = 'group-preview-icon';
    groupIcon.innerHTML = '<i class="fas fa-layer-group"></i>';

    const groupName = document.createElement('div');
    groupName.className = 'group-preview-name';
    groupName.textContent = group.name || 'Group';

    const groupCount = document.createElement('div');
    groupCount.className = 'group-preview-count';
    groupCount.textContent = `${group.images.length} images`;

    item.appendChild(groupIcon);
    item.appendChild(groupName);
    item.appendChild(groupCount);

    // Click handler to open group overlay
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.groupManager && window.groupManager.openGroupView) {
            window.groupManager.openGroupView(group.id);
        }
    });
    return item;
}

function setupGroupGalleryIntegration() {
    // Placeholder for any future hooks or event listeners
}

// Export to window for app.js to use
window.groupGallery = {
    getDisplayList,
    renderGroupPreview,
    isGroupPreview,
    setupGroupGalleryIntegration
}; 