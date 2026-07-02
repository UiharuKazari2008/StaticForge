const wsPacketRegistry = require('../wsPacketRegistry');

const WORKSPACE_DESTRUCTIVE = { destructive: true };

class WorkspaceWebSocketHandlers {
    constructor(handlersCtx) {
        this.handlers = handlersCtx;
        this.globalResources = handlersCtx.globalResources;
    }

    broadcast(wsServer, payload) {
        if (wsServer && typeof wsServer.broadcast === 'function') {
            wsServer.broadcast(payload);
        }
    }

    broadcastTrashDesktopShortcutSync(wsServer, workspaceId, syncResult) {
        if (!wsServer || !syncResult?.changed) {
            return;
        }

        const timestamp = new Date().toISOString();
        switch (syncResult.action) {
            case 'added':
                this.broadcast(wsServer, {
                    type: 'desktop_shortcut_added',
                    data: { workspaceId, shortcut: syncResult.shortcut },
                    timestamp
                });
                break;
            case 'removed':
                this.broadcast(wsServer, {
                    type: 'desktop_shortcut_removed',
                    data: { workspaceId, shortcutId: syncResult.shortcutId },
                    timestamp
                });
                break;
            case 'updated':
                this.broadcast(wsServer, {
                    type: 'desktop_shortcut_updated',
                    data: {
                        workspaceId,
                        shortcutId: syncResult.shortcutId,
                        updates: syncResult.updates || {}
                    },
                    timestamp
                });
                break;
            default:
                break;
        }
    }

    async handleWorkspaceList(ws, message, clientInfo, wsServer) {
        try {
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            const activeWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);

            // Get cache file counts from database for all workspaces in one batch query
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            const workspaceIds = Object.keys(workspaces);
            const workspaceCacheCounts = refDb.getWorkspaceReferenceCounts(workspaceIds);
            
            // Transform to include workspace metadata
            const workspaceList = Object.entries(workspaces).map(([id, workspace]) => ({
                id,
                name: workspace.name,
                color: workspace.color || '#102040',
                backgroundColor: workspace.backgroundColor,
                primaryFont: typeof workspace.primaryFont !== 'undefined' ? workspace.primaryFont : null,
                textareaFont: typeof workspace.textareaFont !== 'undefined' ? workspace.textareaFont : null,
                wallpaper: workspace.wallpaper || null,
                wallpaperPosition: workspace.wallpaperPosition || null,
                sort: workspace.sort || 0, // Include sort field
                fileCount: workspace.files.length,
                presetCount: workspace.presets.length,
                cacheFileCount: workspaceCacheCounts[id] || 0, // Use database count
                isActive: id === activeWorkspaceId,
                isDefault: id === 'default'
            }));

            this.handlers.sendToClient(ws, {
                type: 'workspace_list_response',
                requestId: message.requestId,
                data: {
                    workspaces: workspaceList,
                    activeWorkspace: activeWorkspaceId
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace list error:', error);
            this.handlers.sendError(ws, 'Failed to get workspace list', error.message, message.requestId);
        }
    }

    async handleWorkspaceGet(ws, message, clientInfo, wsServer) {
        try {
            const activeId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(activeId);

            if (!workspace) {
                this.handlers.sendError(ws, 'Active workspace not found', 'workspace_get', message.requestId);
                return;
            }

            // Get cache file count from database
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            const cacheFileCount = refDb.getWorkspaceReferences(activeId).length;
            
            this.handlers.sendToClient(ws, {
                type: 'workspace_get_response',
                requestId: message.requestId,
                data: {
                    id: activeId,
                    name: workspace.name,
                    color: workspace.color || '#102040',
                    backgroundColor: workspace.backgroundColor,
                    primaryFont: typeof workspace.primaryFont !== 'undefined' ? workspace.primaryFont : null,
                    textareaFont: typeof workspace.textareaFont !== 'undefined' ? workspace.textareaFont : null,
                    sort: workspace.sort || 0, // Include sort field
                    fileCount: workspace.files.length,
                    presetCount: workspace.presets.length,
                    cacheFileCount: cacheFileCount // Use database count
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get error:', error);
            this.handlers.sendError(ws, 'Failed to get workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceCreate(ws, message, clientInfo, wsServer) {
        try {
            const { name, color } = message;

            if (!name || !name.trim()) {
                this.handlers.sendError(ws, 'Workspace name is required', 'workspace_create', message.requestId);
                return;
            }

            // Validate color format if provided
            if (color && color.trim()) {
                const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
                if (!colorRegex.test(color.trim())) {
                    this.handlers.sendError(ws, 'Invalid color format. Use hex format (e.g., #ff4500)', 'workspace_create', message.requestId);
                    return;
                }
            }

            const workspaceId = this.globalResources.getWorkspaceManager().createWorkspace(name.trim(), color ? color.trim() : null);

            // Get the complete workspace object to return to client
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(workspaceId);

            const responseData = {
                success: true,
                id: workspaceId,
                name: name.trim(),
                workspace: workspace // Include complete workspace object
            };
            console.log('Sending workspace_create_response:', responseData);

            this.handlers.sendToClient(ws, {
                type: 'workspace_create_response',
                requestId: message.requestId,
                data: responseData,
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients with complete data
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: {
                    action: 'created',
                    workspaceId,
                    name: name.trim(),
                    workspace: workspace // Include complete workspace object
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace create error:', error);
            this.handlers.sendError(ws, 'Failed to create workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceRename(ws, message, clientInfo, wsServer) {
        try {
            const { id, name } = message;

            if (!name || !name.trim()) {
                this.handlers.sendError(ws, 'New name is required', 'workspace_rename', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().renameWorkspace(id, name.trim());

            this.handlers.sendToClient(ws, {
                type: 'workspace_rename_response',
                requestId: message.requestId,
                data: { success: true, message: `Workspace renamed to "${name.trim()}"` },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'renamed', workspaceId: id, name: name.trim() },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace rename error:', error);
            this.handlers.sendError(ws, 'Failed to rename workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceDelete(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;

            // Get workspace info before deletion for broadcast
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);
            if (!workspace) {
                this.handlers.sendError(ws, 'Workspace not found', 'workspace_delete', message.requestId);
                return;
            }

            const movedCount = this.globalResources.getWorkspaceManager().deleteWorkspace(id);

            // Clear metadata cache for deleted workspace
            this.handlers.metadataCache.clearWorkspace(id);

            this.handlers.sendToClient(ws, {
                type: 'workspace_delete_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: `Workspace deleted and ${movedCount} items moved to default`,
                    deletedWorkspaceId: id,
                    deletedWorkspaceName: workspace.name,
                    movedCount: movedCount
                },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients with complete data
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: {
                    action: 'deleted',
                    workspaceId: id,
                    deletedWorkspaceName: workspace.name,
                    movedCount: movedCount
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace delete error:', error);
            this.handlers.sendError(ws, 'Failed to delete workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceActivate(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            const oldWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);

            this.globalResources.getWorkspaceManager().setActiveWorkspace(id, clientInfo.sessionId);

            // Track new workspace usage
            this.handlers.metadataCache.trackClientWorkspace(clientInfo.sessionId, id);
            
            // Note: We don't clear the old workspace cache immediately - it may be used by other clients
            // The periodic cleanup will handle unused workspace caches

            this.handlers.sendToClient(ws, {
                type: 'workspace_activate_response',
                requestId: message.requestId,
                data: { success: true, activeWorkspace: id },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace activate error:', error);
            this.handlers.sendError(ws, 'Failed to activate workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceDump(ws, message, clientInfo, wsServer) {
        try {
            const { sourceId, targetId } = message;

            if (!targetId) {
                this.handlers.sendError(ws, 'Target workspace ID is required', 'workspace_dump', message.requestId);
                return;
            }

            // Get workspace info before dump for broadcast
            const sourceWorkspace = this.globalResources.getWorkspaceManager().getWorkspace(sourceId);
            const targetWorkspace = this.globalResources.getWorkspaceManager().getWorkspace(targetId);

            if (!sourceWorkspace || !targetWorkspace) {
                this.handlers.sendError(ws, 'Source or target workspace not found', 'workspace_dump', message.requestId);
                return;
            }

            const result = this.globalResources.getWorkspaceManager().dumpWorkspace(sourceId, targetId);

            this.handlers.sendToClient(ws, {
                type: 'workspace_dump_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Workspace dumped successfully',
                    sourceWorkspaceId: sourceId,
                    sourceWorkspaceName: sourceWorkspace.name,
                    targetWorkspaceId: targetId,
                    targetWorkspaceName: targetWorkspace.name,
                    movedCount: result || 0
                },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients with complete data
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: {
                    action: 'dumped',
                    sourceId,
                    targetId,
                    sourceWorkspaceName: sourceWorkspace.name,
                    targetWorkspaceName: targetWorkspace.name,
                    movedCount: result || 0
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace dump error:', error);
            this.handlers.sendError(ws, 'Failed to dump workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetFiles(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.handlers.sendError(ws, 'Workspace not found', 'workspace_get_files', message.requestId);
                return;
            }

            // Get workspace files (including default workspace files)
            const workspaceFiles = new Set();

            // Always include default workspace files
            const defaultWorkspace = this.globalResources.getWorkspaceManager().getWorkspace('default');
            if (defaultWorkspace && defaultWorkspace.files) {
                defaultWorkspace.files.forEach(file => workspaceFiles.add(file));
            }

            // Include current workspace files if not default
            if (id !== 'default' && workspace.files) {
                workspace.files.forEach(file => workspaceFiles.add(file));
            }

            this.handlers.sendToClient(ws, {
                type: 'workspace_get_files_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    files: Array.from(workspaceFiles)
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get files error:', error);
            this.handlers.sendError(ws, 'Failed to get workspace files', error.message, message.requestId);
        }
    }

    async handleWorkspaceMoveFiles(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames, sourceWorkspaceId, moveType = 'files' } = message;

            if (!id) {
                this.handlers.sendError(ws, 'Workspace ID is required', 'workspace_move_files', message.requestId);
                return;
            }

            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.handlers.sendError(ws, 'Filenames array is required', 'workspace_move_files', message.requestId);
                return;
            }

            // Validate that the target workspace exists
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);
            if (!workspace) {
                this.handlers.sendError(ws, `Target workspace ${id} not found`, 'workspace_move_files', message.requestId);
                return;
            }

            // Get source workspace info if provided
            let sourceWorkspace = null;
            if (sourceWorkspaceId) {
                sourceWorkspace = this.globalResources.getWorkspaceManager().getWorkspace(sourceWorkspaceId);
                if (!sourceWorkspace) {
                    this.handlers.sendError(ws, `Source workspace ${sourceWorkspaceId} not found`, 'workspace_move_files', message.requestId);
                    return;
                }
            }

            // Use the appropriate move function based on moveType
            let movedCount;
            switch (moveType) {
                case 'scraps':
                    movedCount = this.globalResources.getWorkspaceManager().moveToWorkspaceArray('scraps', filenames, id, sourceWorkspaceId);
                    break;
                case 'pinned':
                    movedCount = this.globalResources.getWorkspaceManager().moveToWorkspaceArray('pinned', filenames, id, sourceWorkspaceId);
                    break;
                case 'files':
                default:
                    movedCount = this.globalResources.getWorkspaceManager().moveFilesToWorkspace(filenames, id, sourceWorkspaceId);
                    break;
            }

            this.handlers.sendToClient(ws, {
                type: 'workspace_move_files_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: `Moved ${movedCount} files to workspace`,
                    movedCount,
                    targetWorkspaceId: id,
                    targetWorkspaceName: workspace.name,
                    sourceWorkspaceId: sourceWorkspaceId || null,
                    sourceWorkspaceName: sourceWorkspace ? sourceWorkspace.name : null,
                    moveType: moveType
                },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients with complete data
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: {
                    action: 'files_moved',
                    workspaceId: id,
                    movedCount,
                    targetWorkspaceName: workspace.name,
                    sourceWorkspaceId: sourceWorkspaceId || null,
                    sourceWorkspaceName: sourceWorkspace ? sourceWorkspace.name : null,
                    moveType: moveType
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace move files error:', error);
            this.handlers.sendError(ws, 'Failed to move files to workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetScraps(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.handlers.sendError(ws, 'Workspace not found', 'workspace_get_scraps', message.requestId);
                return;
            }

            // Get scraps for the requested workspace (scraps are shared across workspaces)
            const scraps = this.globalResources.getWorkspaceManager().getActiveWorkspaceScraps(clientInfo.sessionId);

            this.handlers.sendToClient(ws, {
                type: 'workspace_get_scraps_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    scraps: scraps
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get scraps error:', error);
            this.handlers.sendError(ws, 'Failed to get workspace scraps', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetPinned(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.handlers.sendError(ws, 'Workspace not found', 'workspace_get_pinned', message.requestId);
                return;
            }

            // Get pinned images for the requested workspace
            const pinned = this.globalResources.getWorkspaceManager().getActiveWorkspacePinned(clientInfo.sessionId);

            this.handlers.sendToClient(ws, {
                type: 'workspace_get_pinned_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    pinned: pinned
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get pinned error:', error);
            this.handlers.sendError(ws, 'Failed to get workspace pinned images', error.message, message.requestId);
        }
    }

    async handleWorkspaceAddScrap(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;

            if (!id) {
                this.handlers.sendError(ws, 'Workspace ID is required', 'workspace_add_scrap', message.requestId);
                return;
            }

            if (!filename) {
                this.handlers.sendError(ws, 'Filename is required', 'workspace_add_scrap', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().addToWorkspaceArray('scraps', filename, id);

            this.handlers.sendToClient(ws, {
                type: 'workspace_add_scrap_response',
                requestId: message.requestId,
                data: { success: true, message: 'File added to scraps' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'scrap_added', workspaceId: id, filename },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace add scrap error:', error);
            this.handlers.sendError(ws, 'Failed to add file to scraps', error.message, message.requestId);
        }
    }

    async handleWorkspaceRemoveScrap(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;

            if (!id) {
                this.handlers.sendError(ws, 'Workspace ID is required', 'workspace_remove_scrap', message.requestId);
                return;
            }

            if (!filename) {
                this.handlers.sendError(ws, 'Filename is required', 'workspace_remove_scrap', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().removeFromWorkspaceArray('scraps', filename, id);

            this.handlers.sendToClient(ws, {
                type: 'workspace_remove_scrap_response',
                requestId: message.requestId,
                data: { success: true, message: 'File removed from scraps' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'scrap_removed', workspaceId: id, filename },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace remove scrap error:', error);
            this.handlers.sendError(ws, 'Failed to remove file from scraps', error.message, message.requestId);
        }
    }

    async handleWorkspaceAddPinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;

            if (!id) {
                this.handlers.sendError(ws, 'Workspace ID is required', 'workspace_add_pinned', message.requestId);
                return;
            }

            if (!filename) {
                this.handlers.sendError(ws, 'Filename is required', 'workspace_add_pinned', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().addToWorkspaceArray('pinned', filename, id);

            this.handlers.sendToClient(ws, {
                type: 'workspace_add_pinned_response',
                requestId: message.requestId,
                data: { success: true, message: 'File added to pinned' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'pinned_added', workspaceId: id, filename },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace add pinned error:', error);
            this.handlers.sendError(ws, 'Failed to add file to pinned', error.message, message.requestId);
        }
    }

    async handleWorkspaceRemovePinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;

            if (!id) {
                this.handlers.sendError(ws, 'Workspace ID is required', 'workspace_remove_pinned', message.requestId);
                return;
            }

            if (!filename) {
                this.handlers.sendError(ws, 'Filename is required', 'workspace_remove_pinned', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().removeFromWorkspaceArray('pinned', filename, id);

            this.handlers.sendToClient(ws, {
                type: 'workspace_remove_pinned_response',
                requestId: message.requestId,
                data: { success: true, message: 'File removed from pinned' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'pinned_removed', workspaceId: id, filename },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace remove pinned error:', error);
            this.handlers.sendError(ws, 'Failed to remove file from pinned', error.message, message.requestId);
        }
    }

    async handleWorkspaceBulkPinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames } = message;

            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.handlers.sendError(ws, 'Filenames array is required', 'workspace_bulk_pinned', message.requestId);
                return;
            }

            let addedCount = 0;
            for (const filename of filenames) {
                this.globalResources.getWorkspaceManager().addToWorkspaceArray('pinned', filename, id);
                addedCount++;
            }

            this.handlers.sendToClient(ws, {
                type: 'workspace_bulk_pinned_response',
                requestId: message.requestId,
                data: { success: true, message: `Added ${addedCount} files to pinned`, addedCount },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'bulk_pinned_added', workspaceId: id, addedCount },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace bulk pinned error:', error);
            this.handlers.sendError(ws, 'Failed to add files to pinned', error.message, message.requestId);
        }
    }

    async handleWorkspaceBulkRemovePinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames } = message;

            if (!id) {
                this.handlers.sendError(ws, 'Workspace ID is required', 'workspace_bulk_remove_pinned', message.requestId);
                return;
            }

            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.handlers.sendError(ws, 'Filenames array is required', 'workspace_bulk_remove_pinned', message.requestId);
                return;
            }

            let successCount = 0;

            for (const filename of filenames) {
                try {
                    this.globalResources.getWorkspaceManager().removeFromWorkspaceArray('pinned', filename, id);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to remove ${filename} from pinned:`, error);
                }
            }

            this.handlers.sendToClient(ws, {
                type: 'workspace_bulk_remove_pinned_response',
                requestId: message.requestId,
                data: { success: true, removedCount: successCount },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'bulk_remove_pinned', workspaceId: id, removedCount: successCount },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace bulk remove pinned error:', error);
            this.handlers.sendError(ws, 'Failed to bulk remove from pinned', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetGroups(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.handlers.sendError(ws, 'Workspace not found', 'workspace_get_groups', message.requestId);
                return;
            }

            const groups = this.globalResources.getWorkspaceManager().getWorkspaceGroups(id);

            this.handlers.sendToClient(ws, {
                type: 'workspace_get_groups_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    groups: groups
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get groups error:', error);
            this.handlers.sendError(ws, 'Failed to get workspace groups', error.message, message.requestId);
        }
    }

    async handleWorkspaceCreateGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, name } = message;

            if (!name || !name.trim()) {
                this.handlers.sendError(ws, 'Group name is required', 'workspace_create_group', message.requestId);
                return;
            }

            const groupId = this.globalResources.getWorkspaceManager().createGroup(id, name.trim());

            this.handlers.sendToClient(ws, {
                type: 'workspace_create_group_response',
                requestId: message.requestId,
                data: { success: true, groupId, name: name.trim() },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'group_created', workspaceId: id, groupId, name: name.trim() },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace create group error:', error);
            this.handlers.sendError(ws, 'Failed to create group', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId } = message;
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.handlers.sendError(ws, 'Workspace not found', 'workspace_get_group', message.requestId);
                return;
            }

            const group = this.globalResources.getWorkspaceManager().getGroup(id, groupId);

            if (!group) {
                this.handlers.sendError(ws, 'Group not found', 'workspace_get_group', message.requestId);
                return;
            }

            this.handlers.sendToClient(ws, {
                type: 'workspace_get_group_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    group: group
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get group error:', error);
            this.handlers.sendError(ws, 'Failed to get group', error.message, message.requestId);
        }
    }

    async handleWorkspaceRenameGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId, name } = message;

            if (!name || !name.trim()) {
                this.handlers.sendError(ws, 'New group name is required', 'workspace_rename_group', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().renameGroup(id, groupId, name.trim());

            this.handlers.sendToClient(ws, {
                type: 'workspace_rename_group_response',
                requestId: message.requestId,
                data: { success: true, message: `Group renamed to "${name.trim()}"` },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'group_renamed', workspaceId: id, groupId, name: name.trim() },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace rename group error:', error);
            this.handlers.sendError(ws, 'Failed to rename group', error.message, message.requestId);
        }
    }

    async handleWorkspaceAddImagesToGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId, filenames } = message;

            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.handlers.sendError(ws, 'Filenames array is required', 'workspace_add_images_to_group', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().addImagesToGroup(id, groupId, filenames);

            this.handlers.sendToClient(ws, {
                type: 'workspace_add_images_to_group_response',
                requestId: message.requestId,
                data: { success: true, message: `Added ${filenames.length} images to group` },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'images_added_to_group', workspaceId: id, groupId, count: filenames.length },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace add images to group error:', error);
            this.handlers.sendError(ws, 'Failed to add images to group', error.message, message.requestId);
        }
    }

    async handleWorkspaceRemoveImagesFromGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId, filenames } = message;

            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.handlers.sendError(ws, 'Filenames array is required', 'workspace_remove_images_from_group', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().removeImagesFromGroup(id, groupId, filenames);

            this.handlers.sendToClient(ws, {
                type: 'workspace_remove_images_from_group_response',
                requestId: message.requestId,
                data: { success: true, message: `Removed ${filenames.length} images from group` },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'images_removed_from_group', workspaceId: id, groupId, count: filenames.length },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace remove images from group error:', error);
            this.handlers.sendError(ws, 'Failed to remove images from group', error.message, message.requestId);
        }
    }

    async handleWorkspaceDeleteGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId } = message;

            this.globalResources.getWorkspaceManager().deleteGroup(id, groupId);

            this.handlers.sendToClient(ws, {
                type: 'workspace_delete_group_response',
                requestId: message.requestId,
                data: { success: true, message: 'Group deleted' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'group_deleted', workspaceId: id, groupId },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace delete group error:', error);
            this.handlers.sendError(ws, 'Failed to delete group', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetImageGroups(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.handlers.sendError(ws, 'Workspace not found', 'workspace_get_image_groups', message.requestId);
                return;
            }

            const groups = this.globalResources.getWorkspaceManager().getGroupsForImage(id, filename);

            this.handlers.sendToClient(ws, {
                type: 'workspace_get_image_groups_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    filename: filename,
                    groups: groups
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get image groups error:', error);
            this.handlers.sendError(ws, 'Failed to get image groups', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateColor(ws, message, clientInfo, wsServer) {
        try {
            const { id, color } = message;

            if (!color || !color.trim()) {
                this.handlers.sendError(ws, 'Color is required', 'workspace_update_color', message.requestId);
                return;
            }

            // Validate color format
            const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
            if (!colorRegex.test(color.trim())) {
                this.handlers.sendError(ws, 'Invalid color format. Use hex format (e.g., #ff4500)', 'workspace_update_color', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().updateWorkspaceColor(id, color.trim());

            this.handlers.sendToClient(ws, {
                type: 'workspace_update_color_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace color updated' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'color_updated', workspaceId: id, settings: { color: color.trim() } },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update color error:', error);
            this.handlers.sendError(ws, 'Failed to update workspace color', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateBackgroundColor(ws, message, clientInfo, wsServer) {
        try {
            const { id, backgroundColor } = message;

            this.globalResources.getWorkspaceManager().updateWorkspaceBackgroundColor(id, backgroundColor);

            this.handlers.sendToClient(ws, {
                type: 'workspace_update_background_color_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace background color updated' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'background_color_updated', workspaceId: id, settings: { backgroundColor } },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update background color error:', error);
            this.handlers.sendError(ws, 'Failed to update workspace background color', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdatePrimaryFont(ws, message, clientInfo, wsServer) {
        try {
            const { id, primaryFont } = message;
            // Allow null to reset
            this.globalResources.getWorkspaceManager().updateWorkspacePrimaryFont(id, primaryFont || null);

            this.handlers.sendToClient(ws, {
                type: 'workspace_update_primary_font_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace primary font updated' },
                timestamp: new Date().toISOString()
            });

            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'primary_font_updated', workspaceId: id, settings: { primaryFont: primaryFont || null } },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update primary font error:', error);
            this.handlers.sendError(ws, 'Failed to update workspace primary font', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateTextareaFont(ws, message, clientInfo, wsServer) {
        try {
            const { id, textareaFont } = message;
            // Allow null to reset
            this.globalResources.getWorkspaceManager().updateWorkspaceTextareaFont(id, textareaFont || null);

            this.handlers.sendToClient(ws, {
                type: 'workspace_update_textarea_font_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace textarea font updated' },
                timestamp: new Date().toISOString()
            });

            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'textarea_font_updated', workspaceId: id, settings: { textareaFont: textareaFont || null } },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update textarea font error:', error);
            this.handlers.sendError(ws, 'Failed to update workspace textarea font', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateSettings(ws, message, clientInfo, wsServer) {
        try {
            const { id, settings } = message;
            if (!id || !settings || typeof settings !== 'object') {
                this.handlers.sendError(ws, 'Workspace ID and settings object are required', 'workspace_update_settings', message.requestId);
                return;
            }

            // Validate color if provided
            if (settings.color) {
                const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
                if (!colorRegex.test(settings.color.trim())) {
                    this.handlers.sendError(ws, 'Invalid color format. Use hex format (e.g., #ff4500)', 'workspace_update_settings', message.requestId);
                    return;
                }
            }

            // Validate wallpaper format if provided (client should already normalize)
            if (settings.wallpaper !== undefined && settings.wallpaper !== null) {
                if (typeof settings.wallpaper !== 'string') {
                    this.handlers.sendError(ws, 'Wallpaper must be a string in format "type:id"', 'workspace_update_settings', message.requestId);
                    return;
                }
                
                // Validate that wallpaper is in correct 2-part format (type:id)
                const correctFormatPattern = /^(file|cache|cache-preview|vibe|wallpaper|url):.+$/;
                if (!correctFormatPattern.test(settings.wallpaper)) {
                    this.handlers.sendError(ws, 'Invalid wallpaper format. Use "type:id" (e.g., "file:image.png", "cache:hash123", "url:https://example.com/bg.jpg")', 'workspace_update_settings', message.requestId);
                    return;
                }
            }

            if (settings.wallpaperPosition !== undefined && settings.wallpaperPosition !== null) {
                if (typeof settings.wallpaperPosition !== 'string') {
                    this.handlers.sendError(ws, 'Wallpaper position must be a string', 'workspace_update_settings', message.requestId);
                    return;
                }
                
                // Position format: "horizontal vertical" where each can be a keyword or percentage
                // Keywords: center, top, bottom, left, right
                // Percentages: 0% to 100%
                // Examples: "center center", "50% 75%", "left 25%", "80% top"
                const parts = settings.wallpaperPosition.trim().split(/\s+/);
                if (parts.length !== 2) {
                    this.handlers.sendError(ws, 'Invalid wallpaper position format. Use "horizontal vertical" (e.g., "center center", "50% 75%", "left 25%")', 'workspace_update_settings', message.requestId);
                    return;
                }
                
                const [horizontal, vertical] = parts;
                const keywordPattern = /^(center|top|bottom|left|right)$/;
                const percentagePattern = /^(100|[1-9]?\d)%$/;
                
                // Validate horizontal (can be left, center, right, or percentage)
                const validHorizontalKeyword = ['left', 'center', 'right'].includes(horizontal);
                const validHorizontalPercentage = percentagePattern.test(horizontal);
                if (!validHorizontalKeyword && !validHorizontalPercentage) {
                    this.handlers.sendError(ws, 'Invalid horizontal position. Use "left", "center", "right", or a percentage (0%-100%)', 'workspace_update_settings', message.requestId);
                    return;
                }
                
                // Validate vertical (can be top, center, bottom, or percentage)
                const validVerticalKeyword = ['top', 'center', 'bottom'].includes(vertical);
                const validVerticalPercentage = percentagePattern.test(vertical);
                if (!validVerticalKeyword && !validVerticalPercentage) {
                    this.handlers.sendError(ws, 'Invalid vertical position. Use "top", "center", "bottom", or a percentage (0%-100%)', 'workspace_update_settings', message.requestId);
                    return;
                }
            }

            if (settings.trashDesktopShortcut !== undefined && typeof settings.trashDesktopShortcut !== 'boolean') {
                this.handlers.sendError(ws, 'trashDesktopShortcut must be a boolean', 'workspace_update_settings', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().updateWorkspaceSettings(id, settings);

            if (settings.trashDesktopShortcut !== undefined) {
                const syncResult = this.globalResources.getWorkspaceManager().syncTrashDesktopShortcut(id);
                this.broadcastTrashDesktopShortcutSync(wsServer, id, syncResult);
            }

            this.handlers.sendToClient(ws, {
                type: 'workspace_update_settings_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace settings updated' },
                timestamp: new Date().toISOString()
            });

            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'settings_updated', workspaceId: id, settings },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update settings error:', error);
            this.handlers.sendError(ws, 'Failed to update workspace settings', error.message, message.requestId);
        }
    }

    async handleWorkspaceReorder(ws, message, clientInfo, wsServer) {
        try {
            const { workspaceIds } = message;

            if (!Array.isArray(workspaceIds) || workspaceIds.length === 0) {
                this.handlers.sendError(ws, 'Workspace IDs array is required for reordering', 'workspace_reorder', message.requestId);
                return;
            }

            this.globalResources.getWorkspaceManager().reorderWorkspaces(workspaceIds);

            this.handlers.sendToClient(ws, {
                type: 'workspace_reorder_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace order updated' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'reordered', workspaceIds },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace reorder error:', error);
            this.handlers.sendError(ws, 'Failed to reorder workspaces', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateWindowPositions(ws, message, clientInfo, wsServer) {
        try {
            const { id, windowPositions } = message;
            
            if (!windowPositions || typeof windowPositions !== 'object') {
                // This is an ackless message, so we don't send errors back
                console.warn('Invalid window positions update:', { id, windowPositions });
                return;
            }

            // Save window positions to workspaceDesktop config as global object (not per-workspace)
            // id is ignored now since positions are global
            const desktopConfig = this.globalResources.getWorkspaceDesktopConfig() || {};
            const existing = desktopConfig.windowPositions || {};
            const merged = { ...existing, ...windowPositions };
            this.globalResources.queueWorkspaceDesktopWindowPositions(merged);

            // Broadcast to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'window_positions_updated', windowPositions: merged }, // No workspaceId, positions are global
                timestamp: new Date().toISOString()
            });

            if (message.requestId) {
                this.handlers.sendToClient(ws, {
                    type: 'workspace_update_window_positions_response',
                    requestId: message.requestId,
                    data: { success: true },
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            if (message.requestId) {
                this.handlers.sendError(ws, 'Failed to update window positions', error.message, message.requestId);
            } else {
                console.error('Workspace update window positions error:', error);
            }
        }
    }

    async handleWorkspaceBulkAddScrap(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames } = message;

            if (!id) {
                this.handlers.sendError(ws, 'Workspace ID is required', 'workspace_bulk_add_scrap', message.requestId);
                return;
            }

            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.handlers.sendError(ws, 'Filenames array is required', 'workspace_bulk_add_scrap', message.requestId);
                return;
            }

            let successCount = 0;

            for (const filename of filenames) {
                try {
                    this.globalResources.getWorkspaceManager().addToWorkspaceArray('scraps', filename, id);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to add ${filename} to scraps:`, error);
                }
            }

            this.handlers.sendToClient(ws, {
                type: 'workspace_bulk_add_scrap_response',
                requestId: message.requestId,
                data: { success: true, addedCount: successCount },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'bulk_add_scrap', workspaceId: id, addedCount: successCount },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace bulk add scrap error:', error);
            this.handlers.sendError(ws, 'Failed to bulk add to scraps', error.message, message.requestId);
        }
    }

    async handleWorkspaceBulkAddPinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames } = message;

            if (!id) {
                this.handlers.sendError(ws, 'Workspace ID is required', 'workspace_bulk_add_pinned', message.requestId);
                return;
            }

            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.handlers.sendError(ws, 'Filenames array is required', 'workspace_bulk_add_pinned', message.requestId);
                return;
            }

            let successCount = 0;

            for (const filename of filenames) {
                try {
                    this.globalResources.getWorkspaceManager().addToWorkspaceArray('pinned', filename, id);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to add ${filename} to pinned:`, error);
                }
            }

            this.handlers.sendToClient(ws, {
                type: 'workspace_bulk_add_pinned_response',
                requestId: message.requestId,
                data: { success: true, addedCount: successCount },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            this.broadcast(wsServer, {
                type: 'workspace_updated',
                data: { action: 'bulk_add_pinned', workspaceId: id, addedCount: successCount },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace bulk add pinned error:', error);
            this.handlers.sendError(ws, 'Failed to bulk add to pinned', error.message, message.requestId);
        }
    }
}

/**
 * Register workspace_* WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[90-workspaceHandler] registerPackets: missing handlersCtx');
        return;
    }

    const workspace = new WorkspaceWebSocketHandlers(handlersCtx);

    const reg = (type, methodName, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await workspace[methodName](ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'workspace', ...meta });
    };

    reg('workspace_list', 'handleWorkspaceList');
    reg('workspace_get', 'handleWorkspaceGet');
    reg('workspace_create', 'handleWorkspaceCreate', WORKSPACE_DESTRUCTIVE);
    reg('workspace_rename', 'handleWorkspaceRename', WORKSPACE_DESTRUCTIVE);
    reg('workspace_delete', 'handleWorkspaceDelete', WORKSPACE_DESTRUCTIVE);
    reg('workspace_activate', 'handleWorkspaceActivate');
    reg('workspace_dump', 'handleWorkspaceDump');
    reg('workspace_get_files', 'handleWorkspaceGetFiles');
    reg('workspace_move_files', 'handleWorkspaceMoveFiles', WORKSPACE_DESTRUCTIVE);
    reg('workspace_get_scraps', 'handleWorkspaceGetScraps');
    reg('workspace_get_pinned', 'handleWorkspaceGetPinned');
    reg('workspace_add_scrap', 'handleWorkspaceAddScrap', WORKSPACE_DESTRUCTIVE);
    reg('workspace_remove_scrap', 'handleWorkspaceRemoveScrap', WORKSPACE_DESTRUCTIVE);
    reg('workspace_add_pinned', 'handleWorkspaceAddPinned', WORKSPACE_DESTRUCTIVE);
    reg('workspace_remove_pinned', 'handleWorkspaceRemovePinned', WORKSPACE_DESTRUCTIVE);
    reg('workspace_bulk_pinned', 'handleWorkspaceBulkPinned', WORKSPACE_DESTRUCTIVE);
    reg('workspace_bulk_remove_pinned', 'handleWorkspaceBulkRemovePinned', WORKSPACE_DESTRUCTIVE);
    reg('workspace_get_groups', 'handleWorkspaceGetGroups');
    reg('workspace_create_group', 'handleWorkspaceCreateGroup', WORKSPACE_DESTRUCTIVE);
    reg('workspace_get_group', 'handleWorkspaceGetGroup');
    reg('workspace_rename_group', 'handleWorkspaceRenameGroup', WORKSPACE_DESTRUCTIVE);
    reg('workspace_add_images_to_group', 'handleWorkspaceAddImagesToGroup', WORKSPACE_DESTRUCTIVE);
    reg('workspace_remove_images_from_group', 'handleWorkspaceRemoveImagesFromGroup', WORKSPACE_DESTRUCTIVE);
    reg('workspace_delete_group', 'handleWorkspaceDeleteGroup', WORKSPACE_DESTRUCTIVE);
    reg('workspace_get_image_groups', 'handleWorkspaceGetImageGroups');
    reg('workspace_update_color', 'handleWorkspaceUpdateColor', WORKSPACE_DESTRUCTIVE);
    reg('workspace_update_background_color', 'handleWorkspaceUpdateBackgroundColor', WORKSPACE_DESTRUCTIVE);
    reg('workspace_update_settings', 'handleWorkspaceUpdateSettings', WORKSPACE_DESTRUCTIVE);
    reg('workspace_update_window_positions', 'handleWorkspaceUpdateWindowPositions');
    reg('workspace_update_primary_font', 'handleWorkspaceUpdatePrimaryFont', WORKSPACE_DESTRUCTIVE);
    reg('workspace_update_textarea_font', 'handleWorkspaceUpdateTextareaFont', WORKSPACE_DESTRUCTIVE);
    reg('workspace_reorder', 'handleWorkspaceReorder', WORKSPACE_DESTRUCTIVE);
    reg('workspace_bulk_add_scrap', 'handleWorkspaceBulkAddScrap', WORKSPACE_DESTRUCTIVE);
    reg('workspace_bulk_add_pinned', 'handleWorkspaceBulkAddPinned', WORKSPACE_DESTRUCTIVE);
}

module.exports = {
    registerPackets,
    WorkspaceWebSocketHandlers
};
