const fs = require('fs');
const path = require('path');
const wsPacketRegistry = require('../wsPacketRegistry');

const ADMIN_DESTRUCTIVE = { destructive: true };

async function handleGetRateLimitingStats(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (handlersCtx.globalResources.initializationProgress.searchService && typeof handlersCtx.globalResources.getSearchService().getRateLimitingStats === 'function') {
            const stats = handlersCtx.globalResources.getSearchService().getRateLimitingStats();
            handlersCtx.sendToClient(ws, {
                type: 'rate_limiting_stats_response',
                requestId: message.requestId,
                data: stats,
                timestamp: new Date().toISOString()
            });
        } else {
            handlersCtx.sendError(ws, 'Rate limiting stats not available', 'get_rate_limiting_stats');
        }
    } catch (error) {
        console.error('Rate limiting stats error:', error);
        handlersCtx.sendError(ws, 'Failed to get rate limiting stats', error.message, message.requestId);
    }
}

async function handleCancelPendingRequests(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (handlersCtx.globalResources.initializationProgress.searchService && typeof handlersCtx.globalResources.getSearchService().cancelAllPendingRequests === 'function') {
            const cancelledCount = handlersCtx.globalResources.getSearchService().cancelAllPendingRequests();
            handlersCtx.sendToClient(ws, {
                type: 'cancel_pending_requests_response',
                requestId: message.requestId,
                data: { cancelledCount },
                timestamp: new Date().toISOString()
            });
        } else {
            handlersCtx.sendError(ws, 'Cancel pending requests not available', 'cancel_pending_requests');
        }
    } catch (error) {
        console.error('Cancel pending requests error:', error);
        handlersCtx.sendError(ws, 'Failed to cancel pending requests', error.message, message.requestId);
    }
}

async function handleGetSessionRateLimitingStats(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { model } = message;
        if (!model) {
            handlersCtx.sendError(ws, 'Missing model parameter', 'get_session_rate_limiting_stats');
            return;
        }

        if (handlersCtx.globalResources.initializationProgress.searchService && typeof handlersCtx.globalResources.getSearchService().getSessionRateLimitingStats === 'function') {
            const stats = handlersCtx.globalResources.getSearchService().getSessionRateLimitingStats(clientInfo.sessionId, model);
            handlersCtx.sendToClient(ws, {
                type: 'session_rate_limiting_stats_response',
                requestId: message.requestId,
                data: stats,
                timestamp: new Date().toISOString()
            });
        } else {
            handlersCtx.sendError(ws, 'Session rate limiting stats not available', 'get_session_rate_limiting_stats');
        }
    } catch (error) {
        console.error('Session rate limiting stats error:', error);
        handlersCtx.sendError(ws, 'Failed to get session rate limiting stats', error.message, message.requestId);
    }
}

async function handleCancelSessionPendingRequests(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { model } = message;
        if (!model) {
            handlersCtx.sendError(ws, 'Missing model parameter', 'cancel_session_pending_requests');
            return;
        }

        if (handlersCtx.globalResources.initializationProgress.searchService && typeof handlersCtx.globalResources.getSearchService().cancelSessionPendingRequests === 'function') {
            const cancelledCount = handlersCtx.globalResources.getSearchService().cancelSessionPendingRequests(clientInfo.sessionId, model);
            handlersCtx.sendToClient(ws, {
                type: 'cancel_session_pending_requests_response',
                requestId: message.requestId,
                data: { cancelledCount },
                timestamp: new Date().toISOString()
            });
        } else {
            handlersCtx.sendError(ws, 'Cancel session pending requests not available', 'cancel_session_pending_requests');
        }
    } catch (error) {
        console.error('Cancel session pending requests error:', error);
        handlersCtx.sendError(ws, 'Failed to cancel session pending requests', error.message, message.requestId);
    }
}

async function handleGetBlockedIPs(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { page = 1, limit = 15 } = message;
        const offset = (page - 1) * limit;

        const blockedIPs = handlersCtx.globalResources.getBlockedIPs();
        const suspiciousIPs = handlersCtx.globalResources.getSuspiciousIPs();
        const invalidURLAttempts = handlersCtx.globalResources.getInvalidURLAttempts();

        const now = Date.now();
        const blockedIPsArray = Array.from(blockedIPs.entries())
            .map(([ip, data]) => ({
                ip,
                blockedAt: data.blockedAt,
                reason: data.reason,
                attempts: data.attempts,
                ageMinutes: Math.round((now - data.blockedAt) / (1000 * 60)),
                ageHours: Math.round((now - data.blockedAt) / (1000 * 60 * 60))
            }))
            .sort((a, b) => b.blockedAt - a.blockedAt);

        const totalCount = blockedIPsArray.length;
        const paginatedIPs = blockedIPsArray.slice(offset, offset + limit);
        const totalPages = Math.ceil(totalCount / limit);

        handlersCtx.sendToClient(ws, {
            type: 'get_blocked_ips_response',
            requestId: message.requestId,
            data: {
                success: true,
                blockedIPs: paginatedIPs,
                pagination: {
                    currentPage: page,
                    totalPages: totalPages,
                    totalCount: totalCount,
                    limit: limit
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error fetching blocked IPs:', error);
        handlersCtx.sendError(ws, 'Failed to fetch blocked IPs', error.message, message.requestId);
    }
}

async function handleGetTelemetry(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { page = 1, limit = 15, search = '', eventType = '' } = message;
        const telemetryDb = handlersCtx.globalResources.getTelemetryDatabase?.();
        if (!telemetryDb?.listTelemetryEvents) {
            handlersCtx.sendError(ws, 'Telemetry database not available', 'get_telemetry');
            return;
        }

        const result = await telemetryDb.listTelemetryEvents({ page, limit, search, eventType });

        handlersCtx.sendToClient(ws, {
            type: 'get_telemetry_response',
            requestId: message.requestId,
            data: {
                success: true,
                events: result.events,
                pagination: result.pagination
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching telemetry:', error);
        handlersCtx.sendError(ws, 'Failed to fetch telemetry', error.message, message.requestId);
    }
}

async function handleReportClientPerf(handlersCtx, ws, message, clientInfo) {
    try {
        const telemetryDb = handlersCtx.globalResources.getTelemetryDatabase?.();
        if (!telemetryDb?.recordTelemetryEvent) {
            handlersCtx.sendError(ws, 'Telemetry database not available', 'report_client_perf', message.requestId);
            return;
        }

        const samples = Array.isArray(message.samples) ? message.samples.slice(0, 20) : [];
        const validSamples = samples.filter((sample) => {
            if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return false;
            return JSON.stringify(sample).length <= 16384;
        });
        if (validSamples.length === 0) {
            handlersCtx.sendError(ws, 'At least one valid performance sample is required', 'INVALID_PERF_SAMPLE', message.requestId);
            return;
        }

        for (const sample of validSamples) {
            await telemetryDb.recordTelemetryEvent({
                eventType: 'client_perf',
                clientTimestamp: Number(sample.timestamp) || null,
                ip: clientInfo.ip || null,
                userType: clientInfo.userType || null,
                sessionId: clientInfo.sessionId || null,
                route: typeof sample.page === 'string' ? sample.page.slice(0, 256) : '/app',
                payload: sample
            });
        }

        if (message.requestId) {
            handlersCtx.sendToClient(ws, {
                type: 'report_client_perf_response',
                requestId: message.requestId,
                data: { success: true, recorded: validSamples.length },
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('❌ Error recording client performance telemetry:', error);
        handlersCtx.sendError(ws, 'Failed to record client performance telemetry', error.message, message.requestId);
    }
}

async function handleUnblockIP(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { ip } = message;
        if (!ip) {
            handlersCtx.sendError(ws, 'IP address is required', 'MISSING_IP', message.requestId);
            return;
        }

        const blockedIPs = handlersCtx.globalResources.getBlockedIPs();
        const suspiciousIPs = handlersCtx.globalResources.getSuspiciousIPs();
        const invalidURLAttempts = handlersCtx.globalResources.getInvalidURLAttempts();

        const wasBlocked = blockedIPs.has(ip);
        const wasSuspicious = suspiciousIPs.has(ip);
        const hadInvalidAttempts = invalidURLAttempts.has(ip);

        blockedIPs.delete(ip);
        suspiciousIPs.delete(ip);
        invalidURLAttempts.delete(ip);

        console.log(`🔓 Admin unblocked IP via WebSocket: ${ip} (was blocked: ${wasBlocked}, was suspicious: ${wasSuspicious}, had invalid attempts: ${hadInvalidAttempts})`);

        handlersCtx.sendToClient(ws, {
            type: 'unblock_ip_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: `IP ${ip} has been unblocked`,
                wasBlocked,
                wasSuspicious,
                hadInvalidAttempts
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error unblocking IP:', error);
        handlersCtx.sendError(ws, 'Failed to unblock IP', error.message, message.requestId);
    }
}

async function handleExportIPToGateway(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { ip } = message;
        if (!ip) {
            handlersCtx.sendError(ws, 'IP address is required', 'MISSING_IP', message.requestId);
            return;
        }

        const exportDir = handlersCtx.globalResources.getPath('ipExports');
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const exportFile = path.join(exportDir, `ip_export_${timestamp}.txt`);

        const exportData = {
            ip: ip,
            exportedAt: new Date().toISOString(),
            exportedBy: clientInfo.sessionId,
            action: 'block',
            reason: 'Exported from StaticForge IP Management'
        };

        fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2));

        setTimeout(() => {
            const blockedIPs = global.blockedIPs || new Map();
            if (blockedIPs.has(ip)) {
                blockedIPs.delete(ip);
                console.log(`🕐 Auto-removed exported IP from block list: ${ip}`);
            }
        }, 60 * 60 * 1000);

        console.log(`📤 IP exported to gateway: ${ip} (file: ${exportFile})`);

        handlersCtx.sendToClient(ws, {
            type: 'export_ip_to_gateway_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: `IP ${ip} exported to gateway and will be removed from block list in 1 hour`,
                exportFile: exportFile,
                exportedAt: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error exporting IP to gateway:', error);
        handlersCtx.sendError(ws, 'Failed to export IP to gateway', error.message, message.requestId);
    }
}

async function handleGetIPBlockingReasons(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { ip } = message;
        if (!ip) {
            handlersCtx.sendError(ws, 'IP address is required', 'MISSING_IP', message.requestId);
            return;
        }

        const blockedIPs = handlersCtx.globalResources.getBlockedIPs();
        const suspiciousIPs = handlersCtx.globalResources.getSuspiciousIPs();
        const invalidURLAttempts = handlersCtx.globalResources.getInvalidURLAttempts();

        const blockedData = blockedIPs.get(ip);
        const suspiciousData = suspiciousIPs.get(ip);
        const invalidData = invalidURLAttempts.get(ip);

        const reasons = {
            isBlocked: !!blockedData,
            blockedReason: blockedData?.reason || null,
            blockedAt: blockedData?.blockedAt || null,
            blockedAttempts: blockedData?.attempts || 0,
            isSuspicious: !!suspiciousData,
            suspiciousAttempts: suspiciousData?.attempts || 0,
            suspiciousPatterns: suspiciousData?.patterns || [],
            hasInvalidAttempts: !!invalidData,
            invalidAttempts: invalidData?.count || 0,
            lastInvalidAttempt: invalidData?.lastAttempt || null
        };

        handlersCtx.sendToClient(ws, {
            type: 'get_ip_blocking_reasons_response',
            requestId: message.requestId,
            data: {
                success: true,
                ip: ip,
                reasons: reasons
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error fetching IP blocking reasons:', error);
        handlersCtx.sendError(ws, 'Failed to fetch IP blocking reasons', error.message, message.requestId);
    }
}

async function handleGetKnownBadPaths(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { page = 1, limit = 25, search = '' } = message;
        const offset = (page - 1) * limit;
        const searchLower = String(search || '').trim().toLowerCase();

        const knownBadPaths = handlersCtx.globalResources.getKnownBadPaths();
        const now = Date.now();

        let pathsArray = Array.from(knownBadPaths.entries())
            .map(([pathKey, meta]) => ({
                path: pathKey,
                firstSeen: meta.firstSeen,
                lastSeen: meta.lastSeen,
                hits: meta.hits || 0,
                ageMinutes: Math.round((now - (meta.lastSeen || meta.firstSeen || now)) / (1000 * 60))
            }))
            .sort((a, b) => b.lastSeen - a.lastSeen);

        if (searchLower) {
            pathsArray = pathsArray.filter((entry) => entry.path.toLowerCase().includes(searchLower));
        }

        const totalCount = pathsArray.length;
        const paginatedPaths = pathsArray.slice(offset, offset + limit);
        const totalPages = Math.max(1, Math.ceil(totalCount / limit));

        handlersCtx.sendToClient(ws, {
            type: 'get_known_bad_paths_response',
            requestId: message.requestId,
            data: {
                success: true,
                paths: paginatedPaths,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalCount,
                    limit
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching known bad paths:', error);
        handlersCtx.sendError(ws, 'Failed to fetch known bad paths', error.message, message.requestId);
    }
}

async function handleDeleteKnownBadPath(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { path: urlPath } = message;
        if (!urlPath || typeof urlPath !== 'string') {
            handlersCtx.sendError(ws, 'Path is required', 'MISSING_PATH', message.requestId);
            return;
        }

        const removed = handlersCtx.globalResources.deleteKnownBadPath(urlPath);

        handlersCtx.sendToClient(ws, {
            type: 'delete_known_bad_path_response',
            requestId: message.requestId,
            data: {
                success: removed,
                message: removed ? `Removed path ${urlPath}` : `Path not found: ${urlPath}`
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error deleting known bad path:', error);
        handlersCtx.sendError(ws, 'Failed to delete known bad path', error.message, message.requestId);
    }
}

async function handleClearKnownBadPaths(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const removedCount = handlersCtx.globalResources.clearKnownBadPaths();

        handlersCtx.sendToClient(ws, {
            type: 'clear_known_bad_paths_response',
            requestId: message.requestId,
            data: {
                success: true,
                removedCount,
                message: `Cleared ${removedCount} known bad path(s)`
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error clearing known bad paths:', error);
        handlersCtx.sendError(ws, 'Failed to clear known bad paths', error.message, message.requestId);
    }
}

async function handleGetPinSettings(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const config = handlersCtx.globalResources.getConfig() || {};
        const secureConfig = handlersCtx.globalResources.getSecureConfig() || {};

        handlersCtx.sendToClient(ws, {
            type: 'get_pin_settings_response',
            requestId: message.requestId,
            data: {
                success: true,
                userPinLoginEnabled: config.userPinLoginEnabled !== false,
                adminPinConfigured: !!(secureConfig.loginPin && String(secureConfig.loginPin).length > 0),
                userPinConfigured: !!(secureConfig.readOnlyPin && String(secureConfig.readOnlyPin).length > 0)
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching PIN settings:', error);
        handlersCtx.sendError(ws, 'Failed to fetch PIN settings', error.message, message.requestId);
    }
}

async function handleSetAdminPin(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { pin } = message;
        if (!pin || typeof pin !== 'string' || pin.trim().length === 0) {
            handlersCtx.sendError(ws, 'Admin PIN is required', 'MISSING_PIN', message.requestId);
            return;
        }

        const trimmed = pin.trim();
        handlersCtx.globalResources.modifyConfig('secureConfig').assign('loginPin', trimmed);

        console.log(`🔐 Admin PIN updated by session ${clientInfo.sessionId}`);

        handlersCtx.sendToClient(ws, {
            type: 'set_admin_pin_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Admin PIN updated'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error setting admin PIN:', error);
        handlersCtx.sendError(ws, 'Failed to set admin PIN', error.message, message.requestId);
    }
}

async function handleSetUserPin(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { pin } = message;
        if (!pin || typeof pin !== 'string' || pin.trim().length === 0) {
            handlersCtx.sendError(ws, 'User PIN is required', 'MISSING_PIN', message.requestId);
            return;
        }

        const trimmed = pin.trim();
        handlersCtx.globalResources.modifyConfig('secureConfig').assign('readOnlyPin', trimmed);

        console.log(`🔐 User PIN updated by session ${clientInfo.sessionId}`);

        handlersCtx.sendToClient(ws, {
            type: 'set_user_pin_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'User PIN updated'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error setting user PIN:', error);
        handlersCtx.sendError(ws, 'Failed to set user PIN', error.message, message.requestId);
    }
}

async function handleSetUserPinLoginEnabled(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { enabled } = message;
        if (typeof enabled !== 'boolean') {
            handlersCtx.sendError(ws, 'enabled must be a boolean', 'INVALID_VALUE', message.requestId);
            return;
        }

        handlersCtx.globalResources.modifyConfig('config').assign('userPinLoginEnabled', enabled);

        console.log(`🔐 User PIN login ${enabled ? 'enabled' : 'disabled'} by session ${clientInfo.sessionId}`);

        handlersCtx.sendToClient(ws, {
            type: 'set_user_pin_login_enabled_response',
            requestId: message.requestId,
            data: {
                success: true,
                userPinLoginEnabled: enabled,
                message: enabled ? 'User PIN login enabled' : 'User PIN login disabled — admin PIN only'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error toggling user PIN login:', error);
        handlersCtx.sendError(ws, 'Failed to update user PIN login setting', error.message, message.requestId);
    }
}

async function handleGetApiKeyServices(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const services = handlersCtx.globalResources.getApiKeyManager().listServiceSummaries().map(service => ({
            ...service,
            keys: Array.isArray(service.keys) ? service.keys.map(key => ({ ...key })) : []
        }));

        handlersCtx.sendToClient(ws, {
            type: 'get_api_key_services_response',
            requestId: message.requestId,
            data: {
                success: true,
                services
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching Service Key services:', error);
        handlersCtx.sendError(ws, 'Failed to load Service Key configuration', error.message, message.requestId);
    }
}

async function handleUpdateApiKeySelections(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const updates = Array.isArray(message.updates) ? message.updates : [];
        const normalized = updates
            .map(update => ({
                service: update?.service || update?.serviceId || update?.id,
                index: Number(update?.index)
            }))
            .filter(update => typeof update.service === 'string' && Number.isInteger(update.index));

        if (normalized.length === 0) {
            handlersCtx.sendError(ws, 'No valid Service Key updates provided', 'INVALID_UPDATES', message.requestId);
            return;
        }

        const result = await handlersCtx.globalResources.getApiKeyManager().applySelectionUpdates(normalized);

        handlersCtx.sendToClient(ws, {
            type: 'update_api_key_selections_response',
            requestId: message.requestId,
            data: {
                success: true,
                updated: result.updated || [],
                restartedServices: result.restartedServices || []
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error updating Service Key selections:', error);
        handlersCtx.sendError(ws, 'Failed to update Service Key selections', error.message, message.requestId);
    }
}

async function handleAddApiKey(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { service, name, apiKey } = message;
        if (!service || typeof service !== 'string') {
            handlersCtx.sendError(ws, 'Service ID is required', 'MISSING_SERVICE', message.requestId);
            return;
        }
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            handlersCtx.sendError(ws, 'Service Key Name is required', 'MISSING_NAME', message.requestId);
            return;
        }
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
            handlersCtx.sendError(ws, 'Service Key or Contract ID is required', 'MISSING_API_KEY', message.requestId);
            return;
        }

        const result = handlersCtx.globalResources.getApiKeyManager().addApiKey(service, name.trim(), apiKey.trim());

        console.log(`✅ Added new Service Key "${name}" for service "${service}"`);

        handlersCtx.sendToClient(ws, {
            type: 'add_api_key_response',
            requestId: message.requestId,
            data: {
                success: true,
                service: service,
                key: result.key
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error adding Service Key:', error);
        handlersCtx.sendError(ws, 'Failed to add Service Key', error.message, message.requestId);
    }
}

async function handleUnlockApiService(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { service } = message;
        if (!service || typeof service !== 'string') {
            handlersCtx.sendError(ws, 'Service ID is required', 'MISSING_SERVICE', message.requestId);
            return;
        }

        const apiKeyManager = handlersCtx.globalResources.getApiKeyManager();
        if (!apiKeyManager.isTripwireService(service)) {
            handlersCtx.sendError(ws, `Service "${service}" does not support tripwire locking`, 'UNSUPPORTED_SERVICE', message.requestId);
            return;
        }

        apiKeyManager.unlockService(service);
        console.log(`🔓 Admin unlocked API service tripwire: ${service} (session ${clientInfo.sessionId})`);

        handlersCtx.sendToClient(ws, {
            type: 'unlock_api_service_response',
            requestId: message.requestId,
            data: {
                success: true,
                service,
                lock: apiKeyManager.getServiceLock(service)
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error unlocking API service:', error);
        handlersCtx.sendError(ws, 'Failed to unlock API service', error.message, message.requestId);
    }
}

async function handleUpdateApiKey(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { service, index, name, apiKey } = message;
        if (!service || typeof service !== 'string') {
            handlersCtx.sendError(ws, 'Service ID is required', 'MISSING_SERVICE', message.requestId);
            return;
        }

        const result = handlersCtx.globalResources.getApiKeyManager().updateApiKey(service, index, name, apiKey);

        console.log(`✅ Updated Service Key for service "${service}" (index ${result.index})`);

        handlersCtx.sendToClient(ws, {
            type: 'update_api_key_response',
            requestId: message.requestId,
            data: {
                success: true,
                service,
                key: result.key
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error updating Service Key:', error);
        handlersCtx.sendError(ws, 'Failed to update Service Key', error.message, message.requestId);
    }
}

/**
 * Register admin WebSocket packet handlers (IP blocking, rate limits, API keys).
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[190-adminHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'admin', ...meta });
    };

    reg('get_blocked_ips', handleGetBlockedIPs);
    reg('get_telemetry', handleGetTelemetry);
    reg('report_client_perf', handleReportClientPerf);
    reg('unblock_ip', handleUnblockIP, ADMIN_DESTRUCTIVE);
    reg('export_ip_to_gateway', handleExportIPToGateway, ADMIN_DESTRUCTIVE);
    reg('get_ip_blocking_reasons', handleGetIPBlockingReasons);

    reg('get_known_bad_paths', handleGetKnownBadPaths);
    reg('delete_known_bad_path', handleDeleteKnownBadPath, ADMIN_DESTRUCTIVE);
    reg('clear_known_bad_paths', handleClearKnownBadPaths, ADMIN_DESTRUCTIVE);

    reg('get_pin_settings', handleGetPinSettings);
    reg('set_admin_pin', handleSetAdminPin, ADMIN_DESTRUCTIVE);
    reg('set_user_pin', handleSetUserPin, ADMIN_DESTRUCTIVE);
    reg('set_user_pin_login_enabled', handleSetUserPinLoginEnabled, ADMIN_DESTRUCTIVE);

    reg('get_rate_limiting_stats', handleGetRateLimitingStats);
    reg('get_session_rate_limiting_stats', handleGetSessionRateLimitingStats);
    reg('cancel_pending_requests', handleCancelPendingRequests, ADMIN_DESTRUCTIVE);
    reg('cancel_session_pending_requests', handleCancelSessionPendingRequests, ADMIN_DESTRUCTIVE);

    reg('get_api_key_services', handleGetApiKeyServices);
    reg('update_api_key_selections', handleUpdateApiKeySelections, ADMIN_DESTRUCTIVE);
    reg('add_api_key', handleAddApiKey, ADMIN_DESTRUCTIVE);
    reg('update_api_key', handleUpdateApiKey, ADMIN_DESTRUCTIVE);
    reg('unlock_api_service', handleUnlockApiService, ADMIN_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
