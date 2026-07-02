const geo2city = require('geo2city');
const wsPacketRegistry = require('../wsPacketRegistry');
const { getTimezoneByCoordinates } = require('../../dynamicGenerationHandlers');
const { normalizeAutofillSearchSettings } = require('../../autofillSearchSettings');
const omegasearchFilters = require('../../omegasearchFilters');

const SEARCH_DESTRUCTIVE = { destructive: true };

/** Session-scoped file-list cache for gallery tag search (search_files). */
const searchCache = new Map();

/** Server-side Omegasearch result sessions — full match list cached for pagination. */
const omegasearchSearchSessions = new Map();
const OMEGASEARCH_SESSION_TTL_MS = 30 * 60 * 1000;
const OMEGASEARCH_SESSION_MAX_PER_CLIENT = 12;

function buildOmegasearchServerQueryKey(normalizedBlocks, normalizedFilters, workspaceId, viewType, promptSource, blockOptions) {
    return JSON.stringify({
        blocks: normalizedBlocks,
        filters: normalizedFilters || {},
        workspaceId: workspaceId == null || workspaceId === '' ? '*' : workspaceId,
        viewType: viewType || 'images',
        promptSource: normalizedFilters?.promptSource || promptSource || 'both',
        defaultMatchMode: blockOptions?.defaultMatchMode || 'substring'
    });
}

function pruneOmegasearchSearchSessions() {
    const now = Date.now();
    for (const [id, session] of omegasearchSearchSessions.entries()) {
        if (!session || session.expiresAt < now) {
            omegasearchSearchSessions.delete(id);
        }
    }
}

function pruneOmegasearchSessionsForClient(clientSessionId) {
    const entries = [];
    for (const [id, session] of omegasearchSearchSessions.entries()) {
        if (session?.clientSessionId === clientSessionId) {
            entries.push({ id, createdAt: session.createdAt || 0 });
        }
    }
    if (entries.length <= OMEGASEARCH_SESSION_MAX_PER_CLIENT) return;
    entries.sort((a, b) => a.createdAt - b.createdAt);
    const removeCount = entries.length - OMEGASEARCH_SESSION_MAX_PER_CLIENT;
    for (let i = 0; i < removeCount; i += 1) {
        omegasearchSearchSessions.delete(entries[i].id);
    }
}

async function enrichOmegasearchPageResults(metadataDb, pageResults, viewType) {
    const enriched = [];
    for (const result of pageResults) {
        const row = { filename: result.filename, matchScore: result.matchScore || 0 };
        const metadata = await metadataDb.getCachedMetadata(result.filename);
        if (metadata) {
            if (viewType === 'upscaled' && !metadata.upscaled) {
                continue;
            }
            row.metadata = {
                width: metadata.width,
                height: metadata.height,
                upscaled: metadata.upscaled,
                size: metadata.size,
                mtime: metadata.mtime
            };
        }
        enriched.push(row);
    }
    return enriched;
}

async function filterOmegasearchResultsForView(metadataDb, searchResults, viewType) {
    if (viewType !== 'upscaled') {
        return searchResults.map((row) => ({
            filename: row.filename,
            matchScore: row.matchScore || 0
        }));
    }
    const upscaled = [];
    for (const result of searchResults) {
        const metadata = await metadataDb.getCachedMetadata(result.filename);
        if (metadata && metadata.upscaled) {
            upscaled.push({ filename: result.filename, matchScore: result.matchScore || 0 });
        }
    }
    return upscaled;
}

async function handleCityLookup(handlers, ws, message, clientInfo, wsServer) {
        const { cityName, requestId } = message;

        if (!cityName || typeof cityName !== 'string') {
            handlers.sendError(ws, 'Missing or invalid cityName parameter', 'lookup_city', requestId);
            return;
        }

        const trimmedCityName = cityName.trim();
        if (!trimmedCityName) {
            handlers.sendError(ws, 'City name cannot be empty', 'lookup_city', requestId);
            return;
        }

        try {
            // Search for the city coordinates
            const coordinates = await geo2city.search(trimmedCityName);

            if (coordinates && coordinates.length === 2) {
                const [latitude, longitude] = coordinates;

                // Try to get additional location data by reverse geocoding
                let locationData = {};
                try {
                    const reverseResult = await geo2city.reverse([latitude, longitude]);
                    if (reverseResult) {
                        locationData = {
                            city: reverseResult.city || trimmedCityName,
                            state: reverseResult.city ? '' : '', // State info might not be available
                            country: reverseResult.country || '',
                            latitude: reverseResult.latitude,
                            longitude: reverseResult.longitude,
                            timezone: getTimezoneByCoordinates(latitude, longitude)
                        };
                    } else {
                        // Reverse geocoding returned null/undefined
                        locationData = {
                            city: trimmedCityName,
                            state: '',
                            country: '',
                            latitude: latitude,
                            longitude: longitude,
                            timezone: getTimezoneByCoordinates(latitude, longitude)
                        };
                    }
                } catch (reverseError) {
                    console.warn('Reverse geocoding failed, using basic coordinates:', reverseError.message);
                    locationData = {
                        city: trimmedCityName,
                        state: '',
                        country: '',
                        latitude: latitude,
                        longitude: longitude,
                        timezone: getTimezoneByCoordinates(latitude, longitude)
                    };
                }

                // Send success response
                handlers.sendToClient(ws, {
                    type: 'lookup_city_response',
                    data: locationData,
                    timestamp: new Date().toISOString(),
                    requestId: requestId
                });
            } else {
                // City not found
                handlers.sendError(ws, 'City not found', 'lookup_city', requestId);
            }
        } catch (error) {
            console.error('City lookup error:', error);
            handlers.sendError(ws, 'Failed to lookup city: ' + error.message, 'lookup_city', requestId);
        }
    }

async function handleCharacterSearch(handlers, ws, message, clientInfo, wsServer) {
        const { query, model, requestId, autofillSessionId, spellCheckText, isContinuation, autofillSettings } = message;

        if (!query) {
            handlers.sendError(ws, 'Missing query parameter', 'search_characters');
            return;
        }

        try {
            const config = handlers.globalResources.getConfig() || {};
            const persisted = normalizeAutofillSearchSettings(config.userGlobalSettings?.autofillSearch);
            const resolvedSettings = normalizeAutofillSearchSettings(
                autofillSettings && typeof autofillSettings === 'object' ? autofillSettings : persisted
            );
            if (clientInfo) {
                clientInfo.autofillSearch = resolvedSettings;
            }

            const result = await handlers.globalResources.getSearchService().searchCharacters(
                query, model, ws, clientInfo.sessionId, null, requestId, autofillSessionId,
                { spellCheckText, isContinuation, autofillSettings: resolvedSettings }
            );

            if (result && result.superseded) {
                return;
            }

            // Send final complete response (ack-less)
            handlers.sendToClient(ws, {
                type: 'search_characters_complete',
                data: result,
                timestamp: new Date().toISOString(),
                requestId: requestId,
                autofillSessionId: autofillSessionId || null
            });
        } catch (error) {
            // Only log errors that aren't cancellation
            if (error.name !== 'AbortError' && !error.message.includes('superseded')) {
                console.error('Character search error:', error);
                handlers.sendError(ws, 'Search failed', error.message);
            }
        }
    }

async function handleFetchAutofillWikiPreviews(handlers, ws, message, clientInfo, wsServer) {
        const { tagIds, requestId, autofillSessionId, model } = message;
        if (!Array.isArray(tagIds) || tagIds.length === 0) {
            return;
        }
        try {
            const config = handlers.globalResources.getConfig() || {};
            const settings = normalizeAutofillSearchSettings(
                clientInfo?.autofillSearch || config.userGlobalSettings?.autofillSearch
            );
            if (!settings.wikiPreviews) {
                return;
            }
            await handlers.globalResources.getSearchService().fetchAutofillWikiPreviews(
                tagIds, model, ws, requestId, autofillSessionId, settings
            );
        } catch (error) {
            console.error('fetch_autofill_wiki_previews:', error);
        }
    }

async function handleDatasetTagSearch(handlers, ws, message, clientInfo, wsServer) {
        const { query, path = [] } = message;

        if (!query) {
            handlers.sendError(ws, 'Missing query parameter', 'search_dataset_tags');
            return;
        }

        try {
            const result = await handlers.globalResources.getDatasetTagService().searchDatasetTags(query, path);
            handlers.sendToClient(ws, {
                type: 'search_dataset_tags_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Dataset tag search error:', error);
            handlers.sendError(ws, 'Search failed', error.message, message.requestId);
        }
    }

async function handleGetDatasetTagsForPath(handlers, ws, message, clientInfo, wsServer) {
        const { path = [] } = message;

        try {
            const tags = await handlers.globalResources.getDatasetTagService().getTagsForPath(path);
            handlers.sendToClient(ws, {
                type: 'get_dataset_tags_for_path_response',
                requestId: message.requestId,
                data: { tags },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Get dataset tags for path error:', error);
            handlers.sendError(ws, 'Failed to get tags', error.message, message.requestId);
        }
    }

async function handleSearchTags(handlers, ws, message, clientInfo, wsServer) {
        const { query, single_match = false } = message;

        if (!query) {
            handlers.sendError(ws, 'Missing query parameter', 'search_tags');
            return;
        }

        try {
            const results = await handlers.globalResources.getDatasetTagService().searchTags(query, single_match);
            handlers.sendToClient(ws, {
                type: 'search_tags_response',
                requestId: message.requestId,
                data: { results },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Search tags error:', error);
            handlers.sendError(ws, 'Failed to search tags', error.message, message.requestId);
        }
    }

async function handleAddWordToDictionary(handlers, ws, message, clientInfo, wsServer) {
        const { word } = message;

        if (!word) {
            handlers.sendError(ws, 'Missing word parameter', 'spellcheck_add_word');
            return;
        }

        try {
            const result = await handlers.globalResources.getSearchService().addWordToDictionary(word);

            handlers.sendToClient(ws, {
                type: 'spellcheck_add_word_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Add word to dictionary error:', error);
            handlers.sendError(ws, 'Failed to add word', error.message, message.requestId);
        }
    }

async function handleFileSearch(handlers, ws, message, clientInfo, wsServer) {
        try {
            const { query, viewType = 'images', action = 'search' } = message;

            if (action === 'start') {
                // Broadcast that cache initialization is starting
                wsServer.broadcast({
                    type: 'search_indexing_status',
                    status: 'cache_init',
                    message: `Preparing search cache for ${viewType} view...`,
                    viewType: viewType,
                    timestamp: new Date().toISOString()
                });
                
                // Initialize search cache for the session
                await initializeSearchCache(handlers, clientInfo.sessionId, viewType);
                
                // Broadcast that cache initialization is complete
                wsServer.broadcast({
                    type: 'search_indexing_status',
                    status: 'cache_ready',
                    message: 'Search cache ready',
                    viewType: viewType,
                    timestamp: new Date().toISOString()
                });
                
                wsServer.sendToClient(ws, {
                    type: 'search_files_response',
                    data: {
                        status: 'cache_ready',
                        viewType: viewType,
                        timestamp: new Date().toISOString()
                    },
                    requestId: message.requestId
                });
                return;
            }

            if (action === 'stop') {
                // Clean up search cache for the session
                cleanupSearchCache(clientInfo.sessionId);
                wsServer.sendToClient(ws, {
                    type: 'search_files_response',
                    data: {
                        status: 'cache_cleared',
                        timestamp: new Date().toISOString()
                    },
                    requestId: message.requestId
                });
                return;
            }

            if (action === 'suggestions') {
                // Get tag suggestions without performing full search
                const contextTags = message.contextTags || [];

                // Ensure cache is initialized
                if (!searchCache.has(clientInfo.sessionId)) {
                    await initializeSearchCache(handlers, clientInfo.sessionId, viewType);
                }

                // For context-aware suggestions or regular suggestions, use the new database method
                const tagSuggestions = await getTagSuggestions(handlers, query || '', viewType, clientInfo.sessionId, 20, contextTags);

                wsServer.sendToClient(ws, {
                    type: 'search_files_response',
                    data: {
                        status: 'suggestions',
                        query: query || '',
                        viewType: viewType,
                        tagSuggestions: tagSuggestions,
                        timestamp: new Date().toISOString()
                    },
                    requestId: message.requestId
                });
                return;
            }

            if (!query || query.trim() === '') {
                handlers.sendError(ws, 'Missing query parameter', 'search_files');
                return;
            }

            // File search request received

            // Perform the tag-based search using cached data
            const searchResults = await searchFilesByTags(handlers, query, viewType, clientInfo.sessionId);

            // Search complete

            // Send search results (only one response)
            wsServer.sendToClient(ws, {
                type: 'search_files_response',
                data: {
                    status: 'complete',
                    query: query,
                    viewType: viewType,
                    results: searchResults.results,
                    count: searchResults.results.length,
                    tagSuggestions: searchResults.tagSuggestions,
                    timestamp: new Date().toISOString()
                },
                requestId: message.requestId
            });

        } catch (error) {
            console.error('File search error:', error);
            handlers.sendError(ws, 'Search failed', error.message, message.requestId);
        }
    }

async function initializeSearchCache(handlers, sessionId, viewType) {
        try {
            // Initialize search cache for this session and view
            // Now we only store the workspace file list, not all metadata

            // Get the active workspace for this session
            const activeWorkspaceId = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(sessionId);
            const activeWorkspace = handlers.globalResources.getWorkspaceManager().getWorkspace(activeWorkspaceId);

            if (!activeWorkspace) {
                throw new Error(`Active workspace not found for session ${sessionId}`);
            }

            // Get files for the current view type from the active workspace
            let workspaceFiles = [];
            switch (viewType) {
                case 'scraps':
                    workspaceFiles = activeWorkspace.scraps || [];
                    break;
                case 'pinned':
                    workspaceFiles = activeWorkspace.pinned || [];
                    break;
                case 'upscaled':
                    // For upscaled, query database for upscaled files
                    // We'll filter in the database query
                    const metadataDb = handlers.globalResources.getMetadataDatabase();
                    const allFilenames = await metadataDb.getAllFilenames();
                    // Get metadata for all files to check upscaled status
                    // Actually, we can query the database for upscaled files directly
                    workspaceFiles = allFilenames; // Will be filtered by database query
                    break;
                default: // 'images'
                    workspaceFiles = activeWorkspace.files || [];
                    break;
            }

            // Store in cache - only file list, not metadata
            searchCache.set(sessionId, {
                viewType,
                files: workspaceFiles,
                timestamp: Date.now(),
                workspaceId: activeWorkspaceId
            });

            console.log(`✅ Search cache initialized for session ${sessionId}: ${workspaceFiles.length} files, view: ${viewType}`);

        } catch (error) {
            console.error('❌ Error initializing search cache:', error);
            throw error;
        }
    }

function cleanupSearchCache(sessionId) {
        if (searchCache.has(sessionId)) {
            const cacheInfo = searchCache.get(sessionId);
            console.log(`🧹 Cleaning up search cache for session ${sessionId}`);
            searchCache.delete(sessionId);
        }
    }

async function handlePrepareSearchCache(handlers, ws, message, clientInfo, wsServer) {
        try {
            const { viewType = 'images' } = message;
            
            // Broadcast that cache initialization is starting
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'cache_init',
                message: `Preparing search cache for ${viewType} view...`,
                viewType: viewType,
                timestamp: new Date().toISOString()
            });

            // Initialize search cache
            await initializeSearchCache(handlers, clientInfo.sessionId, viewType);
            
            // Broadcast that cache initialization is complete
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'cache_ready',
                message: 'Search cache ready',
                viewType: viewType,
                timestamp: new Date().toISOString()
            });

            wsServer.sendToClient(ws, {
                type: 'search_index_prepare_cache_response',
                data: {
                    status: 'success',
                    viewType: viewType,
                    message: 'Search cache prepared successfully'
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error preparing search cache:', error);
            wsServer.sendToClient(ws, {
                type: 'search_index_prepare_cache_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

async function handleClearSearchIndexCache(handlers, ws, message, clientInfo, wsServer) {
        try {
            cleanupSearchCache(clientInfo.sessionId);

            wsServer.sendToClient(ws, {
                type: 'search_index_clear_cache_response',
                data: {
                    status: 'success',
                    message: 'Search cache cleared'
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error clearing search cache:', error);
            wsServer.sendToClient(ws, {
                type: 'search_index_clear_cache_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

async function handleToggleIndexingPause(handlers, ws, message, clientInfo, wsServer) {
        try {
            // Use the wsServer parameter which is the WebSocketServer instance
            const currentlyPaused = wsServer.isIndexingPaused();
            wsServer.setIndexingPaused(!currentlyPaused);

            wsServer.sendToClient(ws, {
                type: 'search_index_toggle_pause_response',
                data: {
                    status: 'success',
                    paused: !currentlyPaused,
                    message: !currentlyPaused ? 'Indexing paused' : 'Indexing resumed'
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error toggling indexing pause:', error);
            wsServer.sendToClient(ws, {
                type: 'search_index_toggle_pause_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

async function handleTriggerIndexing(handlers, ws, message, clientInfo, wsServer) {
        try {
            // Use the wsServer parameter which is the WebSocketServer instance
            // Trigger indexing sync
            await wsServer.triggerIndexingSync();

            wsServer.sendToClient(ws, {
                type: 'search_index_trigger_response',
                data: {
                    status: 'success',
                    message: 'Indexing triggered successfully'
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error triggering indexing:', error);
            wsServer.sendToClient(ws, {
                type: 'search_index_trigger_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

async function handleRebuildAllIndexes(handlers, ws, message, clientInfo, wsServer) {
        try {
            const metadataDb = handlers.globalResources.getMetadataDatabase();
            
            // Check if indexing is paused
            if (wsServer.isIndexingPaused()) {
                wsServer.sendToClient(ws, {
                    type: 'search_index_rebuild_all_response',
                    data: {
                        status: 'error',
                        error: 'Cannot rebuild indexes while indexing is paused'
                    },
                    requestId: message.requestId,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Note: We check isIndexing but don't prevent rebuild if it's running sync,
            // because rebuild is a deliberate full rebuild operation
            // However, we should still prevent concurrent rebuilds
            // The isIndexing flag will be set by this handler
            
            // Set indexing flag to prevent concurrent operations
            if (wsServer.isIndexing) {
                wsServer.sendToClient(ws, {
                    type: 'search_index_rebuild_all_response',
                    data: {
                        status: 'error',
                        error: 'Indexing operation is already in progress'
                    },
                    requestId: message.requestId,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Set indexing flag
            wsServer.isIndexing = true;

            // Broadcast that rebuild is starting
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'starting',
                message: 'Starting full search index rebuild...',
                timestamp: new Date().toISOString()
            });

            // Throttled progress callback setup (same as runIndexingSync)
            let lastProgressSent = null;
            let lastProgressTime = 0;
            const MIN_PROGRESS_INTERVAL_MS = 2000;
            const DEFAULT_ITEMS_INTERVAL = 100;
            let progressUpdateInterval = DEFAULT_ITEMS_INTERVAL;
            let firstProgress = true;

            // Rebuild all indexes with progress callback
            const result = await metadataDb.rebuildSearchIndexes(null, (progress) => {
                const now = Date.now();
                const timeSinceLastUpdate = now - lastProgressTime;
                const itemsSinceLastUpdate = lastProgressSent ? (progress.current - lastProgressSent.current) : progress.current;
                
                const shouldSend = 
                    firstProgress ||
                    itemsSinceLastUpdate >= progressUpdateInterval ||
                    timeSinceLastUpdate >= MIN_PROGRESS_INTERVAL_MS;

                if (shouldSend) {
                    if (!firstProgress && lastProgressTime > 0 && lastProgressSent && progress.current > 0) {
                        const actualProcessingRate = itemsSinceLastUpdate / (timeSinceLastUpdate / 1000);
                        if (actualProcessingRate > 0) {
                            const targetInterval = Math.round(actualProcessingRate * (MIN_PROGRESS_INTERVAL_MS / 1000));
                            progressUpdateInterval = Math.max(10, Math.min(500, targetInterval));
                        }
                    }

                    firstProgress = false;
                    lastProgressTime = now;
                    lastProgressSent = progress;

                    const percentage = progress.total > 0 
                        ? Math.round((progress.current / progress.total) * 100) 
                        : 0;
                    
                    wsServer.broadcast({
                        type: 'search_indexing_status',
                        status: 'indexing',
                        message: `Rebuilding: ${progress.current}/${progress.total} files (${percentage}%)`,
                        current: progress.current,
                        total: progress.total,
                        percentage: percentage,
                        filename: progress.filename,
                        updatedCount: progress.updatedCount,
                        errorCount: progress.errorCount,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            // Broadcast completion
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'complete',
                message: `Search index rebuild complete: ${result.updatedCount} files indexed`,
                updatedCount: result.updatedCount,
                errorCount: result.errorCount,
                totalFiles: result.totalFiles,
                timestamp: new Date().toISOString()
            });

            wsServer.sendToClient(ws, {
                type: 'search_index_rebuild_all_response',
                data: {
                    status: 'success',
                    message: `Rebuild complete: ${result.updatedCount} files indexed, ${result.errorCount} errors`,
                    updatedCount: result.updatedCount,
                    errorCount: result.errorCount,
                    totalFiles: result.totalFiles
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error rebuilding all indexes:', error);
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'error',
                message: `Search index rebuild error: ${error.message}`,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            wsServer.sendToClient(ws, {
                type: 'search_index_rebuild_all_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } finally {
            wsServer.isIndexing = false;
        }
    }

async function getTagSuggestions(handlers, query, viewType, sessionId, limit = 20, contextTags = []) {
        try {
            // Get cached data for this session
            const cacheData = searchCache.get(sessionId);
            if (!cacheData) {
                throw new Error('Search cache not initialized. Call search_files with action="start" first.');
            }

            // Get workspace files for filtering
            let workspaceFiles = cacheData.files || [];
            
            // For upscaled view, we need to filter by upscaled status later
            const metadataDb = handlers.globalResources.getMetadataDatabase();
            
            // Get suggestions from database
            let suggestions = await metadataDb.getTagSuggestionsFromDatabase(query, workspaceFiles, limit * 2); // Get more for context filtering
            
            // Filter by upscaled status if needed
            if (viewType === 'upscaled') {
                const filteredSuggestions = [];
                for (const suggestion of suggestions) {
                    // Check if any file in this suggestion is upscaled
                    // For now, we'll include all suggestions and filter at search time
                    filteredSuggestions.push(suggestion);
                }
                suggestions = filteredSuggestions;
            }

            // Apply context-aware ranking if context tags are provided
            if (contextTags && contextTags.length > 0) {
                console.log('🔍 Backend: Applying context-aware ranking with tags:', contextTags);
                
                // For each suggestion, find files that match both the suggestion and context tags
                for (const suggestion of suggestions) {
                    let contextScore = 0;
                    
                    // Query database for files that match both this suggestion and context tags
                    const contextQuery = [...contextTags, suggestion.originalTag || suggestion.tag].join(',');
                    const contextMatchingFiles = await metadataDb.searchFilesInDatabase(contextQuery, workspaceFiles, viewType);
                    contextScore = contextMatchingFiles.length;

                    // Boost score for context-relevant suggestions (base rank matches non-context suggestions)
                    suggestion.contextScore = contextScore;
                    suggestion.boostedScore = handlers.globalResources.getMetadataDatabase().computeTagSuggestionRankScore(suggestion, workspaceFiles.length) + (contextScore * 10);
                }

                console.log('🔍 Backend: Context scores applied, sorting by boosted scores');

                // Sort by boosted score (context relevance + diversity-aware base rank)
                suggestions.sort((a, b) => {
                    const scoreA = a.boostedScore != null ? a.boostedScore : handlers.globalResources.getMetadataDatabase().computeTagSuggestionRankScore(a, workspaceFiles.length);
                    const scoreB = b.boostedScore != null ? b.boostedScore : handlers.globalResources.getMetadataDatabase().computeTagSuggestionRankScore(b, workspaceFiles.length);
                    if (scoreA !== scoreB) return scoreB - scoreA;
                    return (a.originalTag || a.tag).localeCompare(b.originalTag || b.tag);
                });
            }

            return suggestions.slice(0, limit);

        } catch (error) {
            console.error('Error getting tag suggestions:', error);
            // Fallback to empty array on error
            return [];
        }
    }

function collectWorkspaceFilesForViewType(workspace, viewType, metadataDb) {
    switch (viewType) {
        case 'scraps':
            return workspace.scraps || [];
        case 'pinned':
            return workspace.pinned || [];
        case 'upscaled':
            return null;
        default:
            return workspace.files || [];
    }
}

const USE_WORKSPACE_MEMBERSHIP = process.env.USE_WORKSPACE_MEMBERSHIP !== '0'
    && process.env.USE_WORKSPACE_MEMBERSHIP !== 'false';

function viewTypeToMembershipBucket(viewType) {
    switch (viewType) {
        case 'scraps':
            return 'scraps';
        case 'pinned':
            return 'pinned';
        default:
            return 'files';
    }
}

async function resolveWorkspaceFilesForSearch(handlers, sessionId, workspaceId, viewType = 'images') {
    const wsManager = handlers.globalResources.getWorkspaceManager();
    const metadataDb = handlers.globalResources.getMetadataDatabase();
    const isGlobal = workspaceId == null || workspaceId === '' || workspaceId === '*' || workspaceId === 'all';

    if (USE_WORKSPACE_MEMBERSHIP && viewType !== 'upscaled') {
        if (isGlobal) {
            const allWorkspaces = wsManager.getWorkspaces() || {};
            return {
                workspaceId: '*',
                files: null,
                workspaceScope: {
                    workspaceIds: Object.keys(allWorkspaces),
                    bucket: viewTypeToMembershipBucket(viewType)
                }
            };
        }

        const activeWorkspaceId = workspaceId || wsManager.getActiveWorkspace(sessionId);
        const workspace = wsManager.getWorkspace(activeWorkspaceId);
        if (!workspace) {
            throw new Error(`Workspace not found: ${activeWorkspaceId}`);
        }

        return {
            workspaceId: activeWorkspaceId,
            files: null,
            workspaceScope: {
                workspaceIds: [activeWorkspaceId],
                bucket: viewTypeToMembershipBucket(viewType)
            }
        };
    }

    if (isGlobal) {
        const allWorkspaces = wsManager.getWorkspaces() || {};
        const fileSet = new Set();

        if (viewType === 'upscaled') {
            const allFiles = await metadataDb.getAllFilenames();
            return { workspaceId: '*', files: allFiles };
        }

        for (const workspace of Object.values(allWorkspaces)) {
            const files = collectWorkspaceFilesForViewType(workspace, viewType, metadataDb) || [];
            files.forEach((filename) => fileSet.add(filename));
        }

        return {
            workspaceId: '*',
            files: Array.from(fileSet)
        };
    }

    const activeWorkspaceId = workspaceId || wsManager.getActiveWorkspace(sessionId);
    const workspace = wsManager.getWorkspace(activeWorkspaceId);

    if (!workspace) {
        throw new Error(`Workspace not found: ${activeWorkspaceId}`);
    }

    let workspaceFiles = collectWorkspaceFilesForViewType(workspace, viewType, metadataDb) || [];
    if (viewType === 'upscaled') {
        workspaceFiles = await metadataDb.getAllFilenames();
    }

    return {
        workspaceId: activeWorkspaceId,
        files: workspaceFiles
    };
}

async function handleOmegasearchQuery(handlers, ws, message, clientInfo, wsServer) {
    const {
        blocks,
        workspaceId,
        viewType = 'images',
        offset = 0,
        limit = 60,
        usageLimit = 120,
        filters,
        promptSource,
        blockOptions,
        searchSessionId,
        forceRefresh = false
    } = message;

    const metadataDb = handlers.globalResources.getMetadataDatabase();
    const normalizedBlocks = metadataDb.normalizeSearchBlocks(blocks, blockOptions || {});
    const normalizedFilters = omegasearchFilters.normalizeOmegasearchFilters(filters, { promptSource });

    if (normalizedBlocks.length === 0) {
        handlers.sendError(ws, 'Missing blocks parameter', 'omegasearch_query', message.requestId);
        return;
    }

    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 60));

    try {
        const { workspaceId: resolvedWorkspaceId, files: workspaceFiles, workspaceScope } = await resolveWorkspaceFilesForSearch(
            handlers,
            clientInfo.sessionId,
            workspaceId,
            viewType
        );

        const searchOptions = {
            filters: normalizedFilters,
            promptSource: normalizedFilters.promptSource || promptSource,
            blockOptions: blockOptions || {},
            workspaceScope: workspaceScope || null
        };

        const queryKey = buildOmegasearchServerQueryKey(
            normalizedBlocks,
            normalizedFilters,
            resolvedWorkspaceId,
            viewType,
            searchOptions.promptSource,
            searchOptions.blockOptions
        );

        pruneOmegasearchSearchSessions();

        const sendOmegasearchResponse = async (sessionRow, fromCache) => {
            const pageSlice = sessionRow.results.slice(safeOffset, safeOffset + safeLimit);
            const pageResults = await enrichOmegasearchPageResults(metadataDb, pageSlice, viewType);
            sessionRow.expiresAt = Date.now() + OMEGASEARCH_SESSION_TTL_MS;

            wsServer.sendToClient(ws, {
                type: 'omegasearch_query_response',
                data: {
                    blocks: omegasearchFilters.flattenBlocksForDisplay(normalizedBlocks),
                    blocksStructured: normalizedBlocks,
                    filters: normalizedFilters,
                    workspaceId: sessionRow.workspaceId,
                    viewType: sessionRow.viewType,
                    total: sessionRow.total,
                    offset: safeOffset,
                    limit: safeLimit,
                    results: pageResults,
                    usages: sessionRow.usages,
                    corpusSize: sessionRow.corpusSize,
                    searchSessionId: sessionRow.id,
                    fromCache: !!fromCache,
                    timestamp: new Date().toISOString()
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        };

        if (searchSessionId && !forceRefresh) {
            const cached = omegasearchSearchSessions.get(searchSessionId);
            if (
                cached
                && cached.clientSessionId === clientInfo.sessionId
                && cached.queryKey === queryKey
                && Array.isArray(cached.results)
            ) {
                await sendOmegasearchResponse(cached, true);
                return;
            }
        }

        let searchResults = await metadataDb.searchFilesWithBlocks(
            normalizedBlocks,
            workspaceFiles,
            viewType,
            searchOptions
        );

        const storedResults = await filterOmegasearchResultsForView(metadataDb, searchResults, viewType);
        const matchingFilenames = storedResults.map((row) => row.filename);
        const usages = await metadataDb.getBlockPromptUsages(
            normalizedBlocks,
            matchingFilenames,
            {
                limit: Math.min(300, Number(usageLimit) || 120),
                promptSource: searchOptions.promptSource,
                blockOptions: searchOptions.blockOptions,
                filters: normalizedFilters
            }
        );

        let corpusSize = workspaceFiles ? workspaceFiles.length : null;
        if (corpusSize == null && workspaceScope) {
            corpusSize = await metadataDb.countWorkspaceCorpusFiles(workspaceScope);
        }

        const newSessionId = `ispy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const sessionRow = {
            id: newSessionId,
            clientSessionId: clientInfo.sessionId,
            queryKey,
            results: storedResults,
            total: storedResults.length,
            usages,
            corpusSize,
            workspaceId: resolvedWorkspaceId,
            viewType,
            createdAt: Date.now(),
            expiresAt: Date.now() + OMEGASEARCH_SESSION_TTL_MS
        };

        omegasearchSearchSessions.set(newSessionId, sessionRow);
        pruneOmegasearchSessionsForClient(clientInfo.sessionId);

        await sendOmegasearchResponse(sessionRow, false);
    } catch (error) {
        console.error('Omegasearch query error:', error);
        handlers.sendError(ws, 'Omegasearch query failed', error.message, message.requestId);
    }
}

async function searchFilesByTags(handlers, query, viewType, sessionId) {
        const searchTerms = query.toLowerCase().trim().split(',').map(term => term.trim()).filter(term => term.length > 0);
        console.log('🔍 Search: Processing search terms:', searchTerms);

        try {
            // Get cached data for this session
            const cacheData = searchCache.get(sessionId);
            if (!cacheData) {
                throw new Error('Search cache not initialized. Call search_files with action="start" first.');
            }

            if (cacheData.viewType !== viewType) {
                throw new Error(`View type mismatch. Cache initialized for ${cacheData.viewType}, but searching in ${viewType}`);
            }

            // Get workspace files for filtering
            let workspaceFiles = cacheData.files || [];
            
            // For upscaled view, we need to filter by upscaled status
            // We'll do this after getting search results from database
            const metadataDb = handlers.globalResources.getMetadataDatabase();
            
            // Use database query for search
            const searchResults = await metadataDb.searchFilesInDatabase(query, workspaceFiles, viewType);
            
            // Filter by upscaled status if needed
            let filteredResults = searchResults;
            if (viewType === 'upscaled') {
                // Get metadata for results to check upscaled status
                const resultsWithMetadata = [];
                for (const result of searchResults) {
                    const metadata = await metadataDb.getCachedMetadata(result.filename);
                    if (metadata && metadata.upscaled) {
                        result.metadata = {
                            width: metadata.width,
                            height: metadata.height,
                            upscaled: metadata.upscaled,
                            size: metadata.size,
                            mtime: metadata.mtime
                        };
                        resultsWithMetadata.push(result);
                    }
                }
                filteredResults = resultsWithMetadata;
            } else {
                // Get metadata for all results
                for (const result of filteredResults) {
                    const metadata = await metadataDb.getCachedMetadata(result.filename);
                    if (metadata) {
                        result.metadata = {
                            width: metadata.width,
                            height: metadata.height,
                            upscaled: metadata.upscaled,
                            size: metadata.size,
                            mtime: metadata.mtime
                        };
                    }
                }
            }

            // Get tag suggestions for the first term (for display purposes)
            const tagSuggestions = searchTerms.length > 0 
                ? await getTagSuggestions(handlers, searchTerms[0], viewType, sessionId, 20) 
                : [];

            console.log(`🔍 Search: Final results: ${filteredResults.length} files match ALL terms (AND condition)`);

            return {
                results: filteredResults,
                tagSuggestions: tagSuggestions,
                query: query
            };

        } catch (error) {
            console.error('Error performing tag-based file search:', error);
            throw error;
        }
    }

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[70-searchHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'search', ...meta });
    };

    regFn('lookup_city', handleCityLookup);
    regFn('search_characters', handleCharacterSearch);
    regFn('fetch_autofill_wiki_previews', handleFetchAutofillWikiPreviews);
    regFn('search_tags', handleSearchTags);
    regFn('search_files', handleFileSearch);
    regFn('omegasearch_query', handleOmegasearchQuery);
    regFn('search_index_prepare_cache', handlePrepareSearchCache);
    regFn('search_index_clear_cache', handleClearSearchIndexCache);
    regFn('search_index_toggle_pause', handleToggleIndexingPause);
    regFn('search_index_trigger', handleTriggerIndexing);
    regFn('search_index_rebuild_all', handleRebuildAllIndexes);
    regFn('spellcheck_add_word', handleAddWordToDictionary, SEARCH_DESTRUCTIVE);
    regFn('search_dataset_tags', handleDatasetTagSearch);
    regFn('get_dataset_tags_for_path', handleGetDatasetTagsForPath);
}

module.exports = { registerPackets };
