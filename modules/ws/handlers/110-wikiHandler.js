const path = require('path');
const wsPacketRegistry = require('../wsPacketRegistry');

async function handleSearchTagWiki(handler, ws, message, clientInfo, wsServer) {
    const { query, category, searchType = 'name', source = 'both', includeNonTag = false, limit = 50 } = message;
    const includeOnline = message.includeOnline === true || message.includeOnline === 'true';
    const localLimit = includeOnline && searchType === 'name' ? Math.min(limit, 30) : limit;

    if (!query) {
        handler.sendError(ws, 'Missing query parameter', 'search_tag_wiki', message.requestId);
        return;
    }

    try {
        const tagLookup = handler.globalResources.getTagDatabase();
        if (!tagLookup) {
            throw new Error('Tag lookup service not available');
        }

        const localSearchPromise = (async () => {
            if (searchType === 'description') {
                const searchResults = await tagLookup.handleSearchByDescription({
                    description: query,
                    category: category !== undefined ? category : undefined,
                    limit: limit
                }, {});
                return searchResults.json || [];
            }

            const searchOptions = {
                category: category !== undefined ? category : undefined,
                limit: localLimit
            };
            const tags = await tagLookup.searchTags(query, searchOptions) || [];
            return tagLookup.enrichTagsWithWikiSources(tags);
        })();

        const onlineSearchPromise = (includeOnline && searchType === 'name')
            ? tagLookup.searchOnlineWikiTags(query, { source, limit })
            : Promise.resolve([]);

        const [localResults, onlineResults] = await Promise.all([localSearchPromise, onlineSearchPromise]);

        if (includeOnline && searchType === 'name') {
            console.log(`[Wiki Search] Online search for "${query}": ${onlineResults.length} result(s) (source=${source})`);
        }

        let results = localResults;

        // Filter by source if needed (local results only)
        if (source !== 'both') {
            results = results.filter(tag => {
                const wikiSources = tag.wikiSources || [];
                return wikiSources.includes(source);
            });
        }

        // Include non-tag results if requested
        if (includeNonTag) {
            // Note: Non-tag results would require direct database access
            // This feature can be implemented later if needed
        }

        let mergeMeta = null;
        if (includeOnline && searchType === 'name') {
            mergeMeta = tagLookup.mergeLocalAndOnlineWikiSearch(results, onlineResults);
            results = mergeMeta.results;
        }

        // Project results to include only needed fields
        const projectedResults = results.map(tag => ({
            id: tag.id ?? null,
            title: tag.title || tag.name,
            name: tag.name || tag.title,
            category: tag.category,
            categoryName: tag.categoryName || 'Uncategorized',
            source: tag.source || tag.wikiSources || [],
            hasWiki: tag.hasWiki || false,
            onlineOnly: tag.onlineOnly || false,
            matchType: tag.matchType || (tag.hasWiki ? 'local' : 'no-wiki')
        }));

        handler.sendToClient(ws, {
            type: 'search_tag_wiki_response',
            requestId: message.requestId,
            data: {
                results: projectedResults,
                includeOnline: !!includeOnline,
                sections: mergeMeta ? {
                    merged: mergeMeta.merged.length,
                    localOnly: mergeMeta.localOnly.length,
                    onlineOnly: mergeMeta.onlineWikiOnly.length,
                    onlineTagOnly: mergeMeta.onlineTagOnly.length,
                    noWiki: mergeMeta.noWiki.length
                } : null
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Search tag wiki error:', error);
        handler.sendError(ws, 'Failed to search tag wiki', error.message, message.requestId);
    }
}

async function handleGetTagWikiPage(handler, ws, message, clientInfo, wsServer) {
    console.log(`[Wiki Handler] handleGetTagWikiPage called with tagName="${message.tagName}", source="${message.source}"`);
    
    const { tagName: rawTagName, source, format = 'html' } = message;

    if (!rawTagName) {
        handler.sendError(ws, 'Missing tagName parameter', 'get_tag_wiki_page', message.requestId);
        return;
    }

    try {
        const tagLookup = handler.globalResources.getTagDatabase();
        if (!tagLookup) {
            throw new Error('Tag lookup service not available');
        }

        const tagName = tagLookup.resolveBooruWikiTagName(rawTagName);
        const tagNameDisplay = tagLookup.formatBooruTagDisplayTitle(tagName) || rawTagName;

        // Get tag directly (try raw and booru-normalized forms)
        let tag = await tagLookup.findTagExact(rawTagName);
        if (!tag && tagName !== rawTagName) {
            tag = await tagLookup.findTagExact(tagName);
        }
        if (!tag && tagNameDisplay) {
            tag = await tagLookup.findTagExact(tagNameDisplay);
        }

        const SOURCE_DANBOORU = 1;
        const SOURCE_E621 = 2;
        const forceFresh = !!(message && (message.force || message.forceRefresh));

        // When forcing fresh (explicit user "Refresh from online" or dedicated online lookup),
        // clear the recent failed-fetch cache so a prior failure doesn't short-circuit the live attempt.
        // We still always prefer local DB first for normal loads.
        if (forceFresh) {
            try {
                const ckeyDan = `${tagName}|${SOURCE_DANBOORU}`;
                const ckeyE6 = `${tagName}|${SOURCE_E621}`;
                await tagLookup.clearFailedFetchCache(ckeyDan);
                await tagLookup.clearFailedFetchCache(ckeyE6);
                const resolved = tagLookup.resolveBooruWikiTagName(tagName);
                if (resolved && resolved !== tagName) {
                    await tagLookup.clearFailedFetchCache(`${resolved}|${SOURCE_DANBOORU}`);
                    await tagLookup.clearFailedFetchCache(`${resolved}|${SOURCE_E621}`);
                }
            } catch (e) {
                /* non-fatal; proceed with fetch attempt */
            }
        }

        // Rule: Never bypass the local database/cache for wiki bodies (or the derived image cache)
        // unless the data does not exist locally, OR the user specifically requests an update
        // of the stored copy (forceFresh from explicit refresh or dedicated online-check flow).
        //
        // Normal navigation, desktop shortcuts, history restore, address bar, etc. must use
        // the stored copy if present.

        // If source is 'both' or not specified, get all bodies
        if (source === 'both' || !source) {
            let danbooruBody = null;
            let e621Body = null;
            let danbooruFetchedOnline = false;
            let e621FetchedOnline = false;
            let danbooruWikiId = null;
            let e621WikiId = null;
            
            // Always try local DB first (by tag id if we have the tag, otherwise by title).
            // This respects the cache for normal loads.
            if (tag) {
                const danbooruResult = await tagLookup.getTagWikiBody(tag.id, SOURCE_DANBOORU);
                const e621Result = await tagLookup.getTagWikiBody(tag.id, SOURCE_E621);
                
                if (danbooruResult) {
                    danbooruBody = danbooruResult.body || danbooruResult;
                    danbooruFetchedOnline = danbooruResult.fetchedOnline || false;
                }
                if (e621Result) {
                    e621Body = e621Result.body || e621Result;
                    e621FetchedOnline = e621Result.fetchedOnline || false;
                }
            } else {
                const danbooruResult = await tagLookup.getWikiByTitleAndSource(tagName, SOURCE_DANBOORU);
                const e621Result = await tagLookup.getWikiByTitleAndSource(tagName, SOURCE_E621);
                
                if (danbooruResult) {
                    danbooruBody = danbooruResult.body;
                    danbooruFetchedOnline = danbooruResult.fetchedOnline || false;
                    danbooruWikiId = danbooruResult.wikiId;
                }
                if (e621Result) {
                    e621Body = e621Result.body;
                    e621FetchedOnline = e621Result.fetchedOnline || false;
                    e621WikiId = e621Result.wikiId;
                }
            }

            // Only initiate live fetch if we have nothing locally for that source,
            // OR the user explicitly asked to update the stored copy.
            if (!danbooruBody || forceFresh) {
                const fetched = await tagLookup.fetchAndSaveWikiForTag(tag ? tag.id : null, tagName, SOURCE_DANBOORU);
                if (fetched.body) {
                    danbooruBody = fetched.body;
                    danbooruFetchedOnline = fetched.fetchedOnline || false;
                }
            }
            if (!e621Body || forceFresh) {
                const fetched = await tagLookup.fetchAndSaveWikiForTag(tag ? tag.id : null, tagName, SOURCE_E621);
                if (fetched.body) {
                    e621Body = fetched.body;
                    e621FetchedOnline = fetched.fetchedOnline || false;
                }
            }

            const bodies = [];
            // Get wikiIds for content links lookup
            if (tag) {
                // Tag exists - get wiki IDs from tag-wiki links
                if (!danbooruWikiId) {
                    const danbooruWikiIdResult = await tagLookup.getWikiIdForTag(tag.id, SOURCE_DANBOORU);
                    if (danbooruWikiIdResult) {
                        danbooruWikiId = danbooruWikiIdResult.id || danbooruWikiIdResult;
                        if (!danbooruFetchedOnline) {
                            danbooruFetchedOnline = danbooruWikiIdResult.fetchedOnline || false;
                        }
                    }
                }
                if (!e621WikiId) {
                    const e621WikiIdResult = await tagLookup.getWikiIdForTag(tag.id, SOURCE_E621);
                    if (e621WikiIdResult) {
                        e621WikiId = e621WikiIdResult.id || e621WikiIdResult;
                        if (!e621FetchedOnline) {
                            e621FetchedOnline = e621WikiIdResult.fetchedOnline || false;
                        }
                    }
                }

                // If we just fetched, get the wiki ID
                if (danbooruBody && !danbooruWikiId) {
                    const result = await tagLookup.getWikiIdForTag(tag.id, SOURCE_DANBOORU);
                    if (result) {
                        danbooruWikiId = result.id || result;
                        danbooruFetchedOnline = result.fetchedOnline || false;
                    }
                }
                if (e621Body && !e621WikiId) {
                    const result = await tagLookup.getWikiIdForTag(tag.id, SOURCE_E621);
                    if (result) {
                        e621WikiId = result.id || result;
                        e621FetchedOnline = result.fetchedOnline || false;
                    }
                }
            } else {
                // Tag doesn't exist - wiki IDs should already be set from getWikiByTitleAndSource
                // If we just fetched, get the wiki ID from the fetched result
                if (danbooruBody && !danbooruWikiId) {
                    const result = await tagLookup.getWikiByTitleAndSource(tagName, SOURCE_DANBOORU);
                    if (result) {
                        danbooruWikiId = result.wikiId;
                    }
                }
                if (e621Body && !e621WikiId) {
                    const result = await tagLookup.getWikiByTitleAndSource(tagName, SOURCE_E621);
                    if (result) {
                        e621WikiId = result.wikiId;
                    }
                }
            }

            if (danbooruBody) {
                bodies.push({
                    source: 'danbooru',
                    html: format === 'html' ? await convertWikiMarkupToHtml(handler, danbooruBody, danbooruWikiId, SOURCE_DANBOORU) : tagLookup.convertWikiMarkupToMarkdown(danbooruBody),
                    fetchedOnline: danbooruFetchedOnline
                });
            }
            if (e621Body) {
                bodies.push({
                    source: 'e621',
                    html: format === 'html' ? await convertWikiMarkupToHtml(handler, e621Body, e621WikiId, SOURCE_E621) : tagLookup.convertWikiMarkupToMarkdown(e621Body),
                    fetchedOnline: e621FetchedOnline
                });
            }

            if (bodies.length === 0) {
                handler.sendToClient(ws, {
                    type: 'get_tag_wiki_page_response',
                    requestId: message.requestId,
                    data: { error: `Tag "${tagNameDisplay}" has no wiki page on the selected source(s)` },
                    timestamp: new Date().toISOString()
                });
                return;
            }

            handler.sendToClient(ws, {
                type: 'get_tag_wiki_page_response',
                requestId: message.requestId,
                data: {
                    tagName: tag ? (tag.title || tagNameDisplay) : tagNameDisplay,
                    bodies: bodies,
                    bodySource: 'both',
                    fetchedOnline: danbooruFetchedOnline || e621FetchedOnline
                },
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Single source requested
        let sourceId = SOURCE_DANBOORU;
        if (source === 'e621') {
            sourceId = SOURCE_E621;
        }

        let bodyText = null;
        let fetchedOnline = false;

        // Always try local first (respect cache for the wiki body and derived files).
        if (tag) {
            const bodyResult = await tagLookup.getTagWikiBody(tag.id, sourceId);
            if (bodyResult) {
                bodyText = bodyResult.body || bodyResult;
                fetchedOnline = bodyResult.fetchedOnline || false;
            }
        }
        if (!bodyText && !tag) {
            const bodyResult = await tagLookup.getWikiByTitleAndSource(tagName, sourceId);
            if (bodyResult) {
                bodyText = bodyResult.body;
                fetchedOnline = bodyResult.fetchedOnline || false;
            }
        }

        // Only fetch live if nothing local for the source, or the user specifically requested
        // to update the stored copy (explicit refresh / dedicated online check flow).
        if (!bodyText || forceFresh) {
            const fetched = await tagLookup.fetchAndSaveWikiForTag(tag ? tag.id : null, tagName, sourceId);
            if (fetched.body) {
                bodyText = fetched.body;
                fetchedOnline = fetched.fetchedOnline || false;
            }
        }
        
        if (!bodyText) {
            handler.sendToClient(ws, {
                type: 'get_tag_wiki_page_response',
                requestId: message.requestId,
                data: { error: `Tag "${tagNameDisplay}" has no wiki page for source "${source}"` },
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Get wikiId for content links lookup (only if tag exists)
        let wikiId = null;
        if (tag) {
            const wikiIdResult = await tagLookup.getWikiIdForTag(tag.id, sourceId);
            if (wikiIdResult) {
                wikiId = wikiIdResult.id || wikiIdResult;
                if (!fetchedOnline) {
                    fetchedOnline = wikiIdResult.fetchedOnline || false;
                }
            }
            
            // If we just fetched (or to be safe after local hit), get the wiki ID
            if (bodyText && !wikiId) {
                const result = await tagLookup.getWikiIdForTag(tag.id, sourceId);
                if (result) {
                    wikiId = result.id || result;
                    fetchedOnline = result.fetchedOnline || false;
                }
            }
        }

        // Convert wiki markup directly to HTML
        const html = format === 'html'
            ? await convertWikiMarkupToHtml(handler, bodyText, wikiId, sourceId)
            : tagLookup.convertWikiMarkupToMarkdown(bodyText);

        handler.sendToClient(ws, {
            type: 'get_tag_wiki_page_response',
            requestId: message.requestId,
            data: {
                tagName: tag ? (tag.title || tagName) : tagName,
                html: html,
                bodySource: source,
                fetchedOnline: fetchedOnline
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Wiki Handler] Get tag wiki page error:', error);
        console.error('[Wiki Handler] Error stack:', error.stack);
        handler.sendError(ws, 'Failed to get tag wiki page', error.message, message.requestId);
    }
}

async function handleRefreshTagWikiPage(handler, ws, message, clientInfo, wsServer) {
    const { tagName, source, format = 'html', force = false } = message;

    if (!tagName) {
        handler.sendError(ws, 'Missing tagName parameter', 'refresh_tag_wiki_page', message.requestId);
        return;
    }

    try {
        const tagLookup = handler.globalResources.getTagDatabase();
        if (!tagLookup) {
            throw new Error('Tag lookup service not available');
        }

        // This is the explicit "user wants to update the stored copy" path.
        // Clear failed cache so a prior failure doesn't block the live attempt,
        // then delegate (the handler will now fetch because forceFresh is set).
        if (force) {
            const SOURCE_DANBOORU = 1;
            const SOURCE_E621 = 2;
            let sourceId = source === 'e621' ? SOURCE_E621 : SOURCE_DANBOORU;
            if (source === 'both' || !source) {
                await tagLookup.clearFailedFetchCache(`${tagName}|${SOURCE_DANBOORU}`);
                await tagLookup.clearFailedFetchCache(`${tagName}|${SOURCE_E621}`);
            } else {
                await tagLookup.clearFailedFetchCache(`${tagName}|${sourceId}`);
            }
        }

        // Delegate — force flag will cause live fetch + overwrite of the stored body/images.
        await handleGetTagWikiPage(handler, ws, message, clientInfo, wsServer);
    } catch (error) {
        console.error('[Wiki Handler] Refresh tag wiki page error:', error);
        handler.sendError(ws, 'Failed to refresh tag wiki page', error.message, message.requestId);
    }
}

async function handleGetWikiHome(handler, ws, message, clientInfo, wsServer) {
    try {
        const data = handler.globalResources.getStaticWiki().getWikiHomeData(handler.globalResources);
        handler.sendToClient(ws, {
            type: 'get_wiki_home_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_wiki_home:', error);
        handler.sendError(ws, 'Failed to load wiki home', error.message, message.requestId);
    }
}

async function handleGetStaticWikiSiteIndex(handler, ws, message, clientInfo, wsServer) {
    const { siteId } = message;
    if (!siteId) {
        handler.sendError(ws, 'Missing siteId parameter', 'get_static_wiki_site_index', message.requestId);
        return;
    }
    try {
        const data = handler.globalResources.getStaticWiki().getSiteIndex(handler.globalResources, siteId);
        if (!data) {
            handler.sendError(ws, 'Wiki site not found', 'get_static_wiki_site_index', message.requestId);
            return;
        }
        handler.sendToClient(ws, {
            type: 'get_static_wiki_site_index_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_static_wiki_site_index:', error);
        handler.sendError(ws, 'Failed to load wiki site index', error.message, message.requestId);
    }
}

async function handleGetStaticWikiPage(handler, ws, message, clientInfo, wsServer) {
    const { siteId, pageId } = message;
    if (!siteId || !pageId) {
        handler.sendError(ws, 'Missing siteId or pageId parameter', 'get_static_wiki_page', message.requestId);
        return;
    }
    try {
        const data = handler.globalResources.getStaticWiki().getPageHtml(handler.globalResources, siteId, pageId);
        if (!data) {
            handler.sendError(ws, 'Wiki page not found', 'get_static_wiki_page', message.requestId);
            return;
        }
        handler.sendToClient(ws, {
            type: 'get_static_wiki_page_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_static_wiki_page:', error);
        handler.sendError(ws, 'Failed to load wiki page', error.message, message.requestId);
    }
}

/**
 * Server-side Grimoire pseudo-URL resolver.
 * Returns canonical form, page type hint, and (when available) prebuilt content or instructions.
 * Client Grimoire browser (and future server-prebuilt flows) should prefer this over local string matching.
 */
function getFandomWikiOrError(handler, ws, message, label) {
    const fandomWiki = handler.globalResources.getFandomWiki();
    if (!fandomWiki) {
        handler.sendError(ws, 'Fandom wiki service not available', label, message.requestId);
        return null;
    }
    return fandomWiki;
}

async function handleGetFandomWikiIndex(handler, ws, message, clientInfo, wsServer) {
    try {
        const fandomWiki = getFandomWikiOrError(handler, ws, message, 'get_fandom_wiki_index');
        if (!fandomWiki) return;
        const showAll = message.showAll === true || message.showAll === 'true';
        const data = fandomWiki.getFandomIndex(handler.globalResources, { showAll });
        handler.sendToClient(ws, {
            type: 'get_fandom_wiki_index_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_fandom_wiki_index:', error);
        handler.sendError(ws, 'Failed to load Fandom wiki index', error.message, message.requestId);
    }
}

async function handleGetFandomWikiManager(handler, ws, message, clientInfo, wsServer) {
    try {
        const fandomWiki = getFandomWikiOrError(handler, ws, message, 'get_fandom_wiki_manager');
        if (!fandomWiki) return;
        const data = fandomWiki.getManagerState(handler.globalResources);
        handler.sendToClient(ws, {
            type: 'get_fandom_wiki_manager_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_fandom_wiki_manager:', error);
        handler.sendError(ws, 'Failed to load Fandom wiki manager', error.message, message.requestId);
    }
}

async function handleImportFandomWikiPage(handler, ws, message, clientInfo, wsServer) {
    const { url, followLinks = false, maxPages, group } = message;
    if (!url) {
        handler.sendError(ws, 'Missing url parameter', 'import_fandom_wiki_page', message.requestId);
        return;
    }
    try {
        const fandomWiki = getFandomWikiOrError(handler, ws, message, 'import_fandom_wiki_page');
        if (!fandomWiki) return;
        const result = await fandomWiki.importFandomPage(handler.globalResources, {
            url,
            followLinks: followLinks === true || followLinks === 'true',
            maxPages,
            group,
            recordImport: message.recordImport !== false && message.recordImport !== 'false',
            updateExisting: message.updateExisting === true || message.updateExisting === 'true',
            updateImportId: message.updateImportId,
            onProgress: (progress) => {
                handler.sendToClient(ws, {
                    type: 'fandom_wiki_import_progress',
                    requestId: message.requestId,
                    data: progress,
                    timestamp: new Date().toISOString()
                });
            }
        });
        handler.sendToClient(ws, {
            type: 'import_fandom_wiki_page_response',
            requestId: message.requestId,
            data: { success: true, ...result },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('import_fandom_wiki_page:', error);
        handler.sendError(ws, 'Failed to import Fandom page', error.message, message.requestId);
    }
}

function wikiProgress(handler, ws, requestId, progress, type = 'fandom_wiki_import_progress') {
    handler.sendToClient(ws, {
        type,
        requestId,
        data: progress,
        timestamp: new Date().toISOString()
    });
}

function getWikiCacheRoot(handler) {
    return path.join(handler.globalResources.getPath('cache'), 'wiki');
}

async function handleImportStaticWiki(handler, ws, message, clientInfo, wsServer) {
    const { url, followLinks = false, maxPages, group, site, lang } = message;
    if (!url) {
        handler.sendError(ws, 'Missing url parameter', 'import_static_wiki', message.requestId);
        return;
    }
    try {
        const importer = require('../../../scripts/import-novelai-docs');
        if (!importer.isSupportedUrl(url)) {
            handler.sendError(ws, 'URL must be docs.novelai.net, journal.novelai.net, or a NovelAI blog post', 'import_static_wiki', message.requestId);
            return;
        }
        const result = await importer.importNovelaiDocs({
            urls: [url],
            followLinks: followLinks === true || followLinks === 'true',
            maxPages,
            group: group || 'Imported',
            site: site || 'novelai',
            lang: lang || 'en',
            cacheRoot: getWikiCacheRoot(handler),
            onProgress: (progress) => wikiProgress(handler, ws, message.requestId, progress, 'fandom_wiki_import_progress')
        });
        handler.sendToClient(ws, {
            type: 'import_static_wiki_response',
            requestId: message.requestId,
            data: { success: true, kind: 'novelai', ...result },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('import_static_wiki:', error);
        handler.sendError(ws, 'Failed to import static wiki page', error.message, message.requestId);
    }
}

async function handleUpdateWikiImport(handler, ws, message, clientInfo, wsServer) {
    const importId = Number(message.importId) || 0;
    const siteId = message.siteId ? String(message.siteId) : '';
    if (!importId && !siteId) {
        handler.sendError(ws, 'Missing importId or siteId parameter', 'update_wiki_import', message.requestId);
        return;
    }
    try {
        const onProgress = (progress) => wikiProgress(handler, ws, message.requestId, progress);
        if (importId) {
            const fandomWiki = getFandomWikiOrError(handler, ws, message, 'update_wiki_import');
            if (!fandomWiki) return;
            const result = await fandomWiki.updateImport(handler.globalResources, importId, { onProgress });
            handler.sendToClient(ws, {
                type: 'update_wiki_import_response',
                requestId: message.requestId,
                data: { success: true, kind: 'fandom', ...result },
                timestamp: new Date().toISOString()
            });
            return;
        }
        const fandomWiki = handler.globalResources.getFandomWiki();
        const staticWiki = handler.globalResources.getStaticWiki();
        const siteIndex = staticWiki ? staticWiki.getSiteIndex(handler.globalResources, siteId) : null;
        const kind = siteIndex && siteIndex.kind ? siteIndex.kind : (siteId === 'novelai' ? 'novelai' : null);
        if (kind === 'fandom' && fandomWiki) {
            const result = await fandomWiki.updateFandomSite(handler.globalResources, siteId, { onProgress });
            handler.sendToClient(ws, {
                type: 'update_wiki_import_response',
                requestId: message.requestId,
                data: { success: true, kind: 'fandom', ...result },
                timestamp: new Date().toISOString()
            });
            return;
        }
        const importer = require('../../../scripts/import-novelai-docs');
        const pages = (siteIndex && siteIndex.groups || []).flatMap((g) => g.pages || []);
        // source URLs live on disk index, not the grouped projection
        const siteDir = path.join(getWikiCacheRoot(handler), siteId);
        const fs = require('fs');
        let urls = [];
        try {
            const raw = JSON.parse(fs.readFileSync(path.join(siteDir, 'index.json'), 'utf8'));
            urls = (raw.pages || []).map((pg) => pg.sourceUrl).filter(Boolean);
        } catch (_) { /* none */ }
        if (!urls.length) {
            handler.sendError(ws, 'No stored source URLs to pull for this wiki', 'update_wiki_import', message.requestId);
            return;
        }
        const result = await importer.importNovelaiDocs({
            urls,
            followLinks: false,
            maxPages: urls.length,
            group: message.group || 'Imported',
            site: siteId,
            cacheRoot: getWikiCacheRoot(handler),
            onProgress
        });
        handler.sendToClient(ws, {
            type: 'update_wiki_import_response',
            requestId: message.requestId,
            data: { success: true, kind: kind || 'static', ...result },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('update_wiki_import:', error);
        handler.sendError(ws, 'Failed to update wiki', error.message, message.requestId);
    }
}

async function handleDeleteFandomWikiImport(handler, ws, message, clientInfo, wsServer) {
    const importId = Number(message.importId);
    if (!importId) {
        handler.sendError(ws, 'Missing importId parameter', 'delete_fandom_wiki_import', message.requestId);
        return;
    }
    try {
        const fandomWiki = getFandomWikiOrError(handler, ws, message, 'delete_fandom_wiki_import');
        if (!fandomWiki) return;
        const removeChildren = message.removeChildren !== false && message.removeChildren !== 'false';
        const data = fandomWiki.deleteImport(handler.globalResources, importId, { removeChildren });
        handler.sendToClient(ws, {
            type: 'delete_fandom_wiki_import_response',
            requestId: message.requestId,
            data: { success: true, ...data },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('delete_fandom_wiki_import:', error);
        handler.sendError(ws, 'Failed to delete Fandom import', error.message, message.requestId);
    }
}

async function handleResolveGrimoireUrl(handler, ws, message, clientInfo, wsServer) {
    const { url } = message;
    if (!url) {
        handler.sendError(ws, 'Missing url parameter', 'resolve_grimoire_url', message.requestId);
        return;
    }
    try {
        const reg = handler.globalResources.getGrimoireDomainRegistry();
        const resolved = reg.resolvePseudoUrl ? reg.resolvePseudoUrl(url) : null;

        let page = null;
        if (resolved && resolved.entry && typeof resolved.entry.getPage === 'function') {
            try {
                page = resolved.entry.getPage(resolved, { globalResources: handler.globalResources });
            } catch (e) {
                console.warn('grimoire domain getPage failed:', e.message);
            }
        }

        handler.sendToClient(ws, {
            type: 'resolve_grimoire_url_response',
            requestId: message.requestId,
            data: {
                url,
                resolved: resolved || null,
                page, // may contain { html, title, type, data, ... } for prebuilt shells
                timestamp: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('resolve_grimoire_url:', error);
        handler.sendError(ws, 'Failed to resolve Grimoire URL', error.message, message.requestId);
    }
}

async function convertWikiMarkupToHtml(handler, wikiText, wikiId = null, sourceId = null) {
    if (!wikiText) return '';

    // Try to use polymorphic module (Ruby dtext_rb parser) via globalResources
    // This ensures 100% compatibility with Danbooru's DText implementation
    if (handler.globalResources && handler.globalResources.parseDText) {
        try {
            // Determine source string and base URL from sourceId
            let source = 'danbooru'; // default
            let baseUrl = 'https://danbooru.donmai.us';
            const SOURCE_DANBOORU = 1;
            const SOURCE_E621 = 2;
            if (sourceId === SOURCE_E621) {
                source = 'e621';
                baseUrl = 'https://e621.net';
            } else if (sourceId === SOURCE_DANBOORU) {
                source = 'danbooru';
                baseUrl = 'https://danbooru.donmai.us';
            }

            const rubyResult = await handler.globalResources.parseDText(wikiText, source, baseUrl);
            if (rubyResult) {
                // Post-process the HTML to add our custom classes and attributes
                return postProcessWikiHtml(rubyResult);
            }
        } catch (error) {
            // Log error details for debugging
            console.error('Polymorphic dtext parser failed:', error.message);
            console.error('Error stack:', error.stack);
            console.error('Wiki text length:', wikiText ? wikiText.length : 0);
            console.error('Source ID:', sourceId);
            // Silently fall through to JavaScript implementation
            console.warn('Using JavaScript fallback for wiki markup');
        }
    }
    return wikiText;
}

// Post-process HTML from dtext parser to add custom classes and attributes
// Most processing is now done in Ruby, but we keep this for any edge cases
function postProcessWikiHtml(html) {
    if (!html || typeof html !== 'string') return html;

    // Ruby parser now handles most link processing, but we can add any final touches here if needed
    // All links should already have proper classes and attributes from Ruby

    return html;
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[110-wikiHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'wiki', ...meta });
    };

    regFn('search_tag_wiki', handleSearchTagWiki);
    regFn('get_tag_wiki_page', handleGetTagWikiPage);
    regFn('refresh_tag_wiki_page', handleRefreshTagWikiPage);
    regFn('get_wiki_home', handleGetWikiHome);
    regFn('get_static_wiki_site_index', handleGetStaticWikiSiteIndex);
    regFn('get_static_wiki_page', handleGetStaticWikiPage);
    regFn('get_fandom_wiki_index', handleGetFandomWikiIndex);
    regFn('get_fandom_wiki_manager', handleGetFandomWikiManager);
    regFn('import_fandom_wiki_page', handleImportFandomWikiPage);
    regFn('import_static_wiki', handleImportStaticWiki);
    regFn('update_wiki_import', handleUpdateWikiImport);
    regFn('delete_fandom_wiki_import', handleDeleteFandomWikiImport);
    regFn('resolve_grimoire_url', handleResolveGrimoireUrl);
}

module.exports = {
    registerPackets,
    handleSearchTagWiki,
    handleGetTagWikiPage,
    handleRefreshTagWikiPage,
    handleGetWikiHome,
    handleGetStaticWikiSiteIndex,
    handleGetStaticWikiPage,
    handleGetFandomWikiIndex,
    handleGetFandomWikiManager,
    handleImportFandomWikiPage,
    handleImportStaticWiki,
    handleUpdateWikiImport,
    handleDeleteFandomWikiImport,
    handleResolveGrimoireUrl,
    convertWikiMarkupToHtml,
    postProcessWikiHtml
};
