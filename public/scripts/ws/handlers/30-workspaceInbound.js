// Workspace inbound WebSocket handlers — workspace push types and gallery scroll restore.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function handleWorkspaceUpdateData(data) {
    if (data.action === 'settings_updated' && data.settings && typeof workspaces !== 'undefined') {
        const workspaceId = data.workspaceId;
        if (workspaces && workspaces[workspaceId]) {
            Object.assign(workspaces[workspaceId], data.settings);
        }
    }

    if (data.action === 'window_positions_updated' && data.windowPositions) {
        Object.assign(globalWindowPositions, data.windowPositions);
        if (typeof desktopShortcuts !== 'undefined'
            && desktopShortcuts
            && !desktopShortcuts.pendingWindowPositionSave
            && typeof commitWindowPositionsSnapshot === 'function') {
            commitWindowPositionsSnapshot();
        }
    }

    document.dispatchEvent(new CustomEvent('workspaceUpdated', {
        detail: data
    }));
}

function handleWorkspaceActivationData(data) {
    document.dispatchEvent(new CustomEvent('workspaceActivated', {
        detail: data
    }));
}

function handleWorkspaceImageAddedMessage(message) {
    document.dispatchEvent(new CustomEvent('workspaceImageAdded', {
        detail: {
            workspaceId: message.data.workspaceId,
            imageFilenames: message.data.imageFilenames,
            timestamp: message.timestamp
        }
    }));
}

function handleWorkspaceCssUpdatedMessage(message) {
    const data = message.data || {};
    const webPath = data.webPath || '/css/workspaces.css';
    const hash = data.hash || data.sourceHash;
    if (!hash) {
        return;
    }
    if (window.serviceWorkerManager) {
        window.serviceWorkerManager.cacheStaticFilesSilent([{ url: webPath, hash }]).then(() => {
            // applyWorkspaceCssFromServer: public/scripts/comp/workspaceUtils.js
            applyWorkspaceCssFromServer(hash, webPath);
        }).catch(() => {
            applyWorkspaceCssFromServer(hash, webPath);
        });
    }
}

function handleGalleryScrollStateData(data) {
    const incoming = data && typeof data === 'object' ? data : {};
    window.galleryScrollStateFromSession = { ...(window.galleryScrollStateFromSession || {}), ...incoming };
    // applyGallerySessionRestoreIfReady: public/scripts/comp/galleryView.js
    if (typeof window.applyGallerySessionRestoreIfReady === 'function') {
        window.applyGallerySessionRestoreIfReady();
    }
}

function handleWorkspaceDesktopPersisted() {
    if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts &&
        typeof desktopShortcuts.handleWorkspaceDesktopPersisted === 'function') {
        desktopShortcuts.handleWorkspaceDesktopPersisted();
    }
}

function handleWorkspaceRestoredMessage(message) {
    // isAppDataReady: public/scripts/appInitSteps.js
    if (!isAppDataReady()) {
        return;
    }

    if (message.workspace && message.message) {
        if (window.updateWorkspaceUI) {
            window.updateWorkspaceUI(message.workspace);
        }
    }
}

function handleWorkspaceDataMessage(message) {
    if (!isAppDataReady()) {
        return;
    }

    if (message.data) {
        if (typeof activeWorkspace !== 'undefined' && message.data.id && activeWorkspace !== message.data.id) {
            activeWorkspace = message.data.id;
        }
        if (window.currentWorkspace !== message.data.id) {
            window.currentWorkspace = message.data.id;

            const workspaceSelector = document.getElementById('workspace-selector');
            if (workspaceSelector) {
                workspaceSelector.value = message.data.id;
            }

            const workspaceNameElement = document.getElementById('workspace-name');
            if (workspaceNameElement) {
                workspaceNameElement.textContent = message.data.name || message.data.id;
            }
        }
    }
}

registerWsInboundHandler({
    id: 'workspace.image_added',
    type: 'workspace_image_added',
    phase: 'only',
    handler(message) {
        handleWorkspaceImageAddedMessage(message);
    }
});

registerWsInboundHandler({
    id: 'workspace.css_updated',
    type: 'workspace_css_updated',
    phase: 'only',
    handler(message) {
        handleWorkspaceCssUpdatedMessage(message);
    }
});

registerWsInboundHandler({
    id: 'workspace.gallery_scroll_state',
    type: 'gallery_scroll_state',
    phase: 'only',
    handler(message) {
        handleGalleryScrollStateData(message.data);
    }
});

registerWsInboundHandler({
    id: 'workspace.updated',
    type: 'workspace_updated',
    phase: 'only',
    handler(message) {
        handleWorkspaceUpdateData(message.data);
    }
});

registerWsInboundHandler({
    id: 'workspace.desktop_persisted',
    type: 'workspace_desktop_persisted',
    phase: 'only',
    handler() {
        handleWorkspaceDesktopPersisted();
    }
});

registerWsInboundHandler({
    id: 'workspace.activated',
    type: 'workspace_activated',
    phase: 'only',
    handler(message) {
        handleWorkspaceActivationData(message.data);
    }
});

registerWsInboundHandler({
    id: 'workspace.restored',
    type: 'workspace_restored',
    phase: 'only',
    handler(message, wsClient) {
        handleWorkspaceRestoredMessage(message);
        wsClient.triggerEvent('workspace_restored', message);
    }
});

registerWsInboundHandler({
    id: 'workspace.data',
    type: 'workspace_data',
    phase: 'only',
    handler(message, wsClient) {
        handleWorkspaceDataMessage(message);
        wsClient.triggerEvent('workspace_data', message);
    }
});
