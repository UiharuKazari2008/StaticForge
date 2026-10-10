const fs = require('fs');
const path = require('path');
const wsPacketRegistry = require('../wsPacketRegistry');

const ADMIN_DESTRUCTIVE = { destructive: true };

async function handleGetRateLimitingStats(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        if (handlersCtx.globalResources.initializationProgress.searchService && typeof handlersCtx.globalResources.getSearchService().getRateLimitingStats === 'function') {
            const stats = handlersCtx.globalResources.getSearchService().getRateLimitingStats();
            handlersCtx.sendToClient(ws, {
                type: 'rate_limiting_stats_response',
                requestId: message.requestId,
                data: stats,
                timestamp: new Date().toISOString()
            });
        } else {
            handlersCtx.sendError(ws, 'Rate limiting stats not available', 'get_rate_limiting_stats', message.requestId);
        }
    } catch (error) {
        console.error('Rate limiting stats error:', error);
        handlersCtx.sendError(ws, 'Failed to get rate limiting stats', error.message, message.requestId);
    }
}

async function handleCancelPendingRequests(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        if (handlersCtx.globalResources.initializationProgress.searchService && typeof handlersCtx.globalResources.getSearchService().cancelAllPendingRequests === 'function') {
            const cancelledCount = handlersCtx.globalResources.getSearchService().cancelAllPendingRequests();
            handlersCtx.sendToClient(ws, {
                type: 'cancel_pending_requests_response',
                requestId: message.requestId,
                data: { cancelledCount },
                timestamp: new Date().toISOString()
            });
        } else {
            handlersCtx.sendError(ws, 'Cancel pending requests not available', 'cancel_pending_requests', message.requestId);
        }
    } catch (error) {
        console.error('Cancel pending requests error:', error);
        handlersCtx.sendError(ws, 'Failed to cancel pending requests', error.message, message.requestId);
    }
}

async function handleGetSessionRateLimitingStats(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { model } = message;
        if (!model) {
            handlersCtx.sendError(ws, 'Missing model parameter', 'get_session_rate_limiting_stats', message.requestId);
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
            handlersCtx.sendError(ws, 'Session rate limiting stats not available', 'get_session_rate_limiting_stats', message.requestId);
        }
    } catch (error) {
        console.error('Session rate limiting stats error:', error);
        handlersCtx.sendError(ws, 'Failed to get session rate limiting stats', error.message, message.requestId);
    }
}

async function handleCancelSessionPendingRequests(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { model } = message;
        if (!model) {
            handlersCtx.sendError(ws, 'Missing model parameter', 'cancel_session_pending_requests', message.requestId);
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
            handlersCtx.sendError(ws, 'Cancel session pending requests not available', 'cancel_session_pending_requests', message.requestId);
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
            handlersCtx.sendError(ws, 'Telemetry database not available', 'get_telemetry', message.requestId);
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

function syncDirectorAccountCredentials(handlersCtx, cursorData) {
    const cursorAccountAuthStore = require('../../cursorAccountAuthStore');
    let changed = false;
    for (const persona of ['wren', 'xi']) {
        const slot = cursorData[persona] || {};
        const activeId = slot.activeAccountId || 'default';
        const acc = (cursorData.accounts || []).find((row) => row.id === activeId);
        let result = null;
        try {
            result = cursorAccountAuthStore.syncActiveAccountCredentials(persona, activeId, acc);
        } catch (err) {
            console.warn(`[190-adminHandler] credential sync skipped for ${persona}:`, err.message);
        }
        if (!result || !result.updated) continue;
        const idx = (cursorData.accounts || []).findIndex((row) => row.id === activeId);
        if (idx < 0) continue;
        const email = result.email && !String(result.email).startsWith('(')
            ? result.email
            : cursorData.accounts[idx].email;
        cursorData.accounts[idx] = {
            ...cursorData.accounts[idx],
            email,
            token: result.token || cursorData.accounts[idx].token || '',
            isEmpty: !result.token
        };
        changed = true;
    }
    if (changed && handlersCtx.globalResources && typeof handlersCtx.globalResources.modifyConfig === 'function') {
        handlersCtx.globalResources.modifyConfig('secureConfig').assign('cursorAccounts', cursorData);
    }
    return changed;
}

async function handleGetCursorAccounts(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const secureConfig = handlersCtx.globalResources.getSecureConfig() || {};
        const cursorData = secureConfig.cursorAccounts || {
            wren: { activeAccountId: 'default', customToken: '' },
            xi: { activeAccountId: 'default', customToken: '' },
            accounts: [
                { id: 'default', name: 'Host Account (Default)', email: 'system@cursor.sh', isDefault: true }
            ]
        };

        const cursorDirector = require('../../cursorDirector');
        const xiDirector = require('../../xiDirector');
        const cursorUsage = require('../../cursorUsage');

        let usage = null;
        try {
            usage = await cursorUsage.getCursorUsage('wren');
        } catch (_) {}

        let xiUsage = null;
        try {
            xiUsage = await cursorUsage.getCursorUsage('xi');
        } catch (_) {}

        let wrenStatus = { ok: false, reason: 'unknown' };
        try {
            if (typeof cursorDirector.getLastCursorLogin === 'function') {
                wrenStatus = cursorDirector.getLastCursorLogin();
            } else {
                wrenStatus = { ok: true, reason: null };
            }
        } catch (_) {}

        let xiStatus = { ok: false, reason: 'unknown' };
        try {
            if (typeof xiDirector.runtimeStatus === 'function') {
                const st = xiDirector.runtimeStatus();
                xiStatus = st.cursorLogin || { ok: st.enabled, reason: null };
            } else {
                xiStatus = { ok: true, reason: null };
            }
        } catch (_) {}

        const cursorAccountAuthStore = require('../../cursorAccountAuthStore');
        const hostInfo = cursorAccountAuthStore.getHostAccountInfo();

        const rawAccounts = cursorData.accounts || [
            { id: 'default', name: 'Host Account (Default)', email: hostInfo.email || 'Host Logged-in User', isDefault: true }
        ];

        const accounts = rawAccounts.map((acc) => {
            if (acc.id === 'default' && (!acc.email || acc.email === 'system@cursor.sh')) {
                return { ...acc, email: hostInfo.email || 'Host Logged-in User' };
            }
            return acc;
        });

        syncDirectorAccountCredentials(handlersCtx, { ...cursorData, accounts });
        cursorData.accounts = accounts;

        let xiLive = { hasLive: false, known: false, matchedAccountId: '' };
        try {
            xiLive = cursorAccountAuthStore.describeLiveAccount('xi', accounts);
        } catch (_) {}

        const accountsWithUsage = await Promise.all(accounts.map(async (acc) => {
            let row = null;
            if (usage && usage.activeAccountId === acc.id) row = usage;
            else if (xiUsage && xiUsage.activeAccountId === acc.id) row = xiUsage;
            else {
                try {
                    row = await cursorUsage.getCursorUsageForAccount(acc.id);
                } catch (_) {}
            }
            const meta = cursorAccountAuthStore.readAccountProfileMeta(acc.id);
            const pub = cursorAccountAuthStore.publicCursorAccount(acc) || {};
            return {
                id: pub.id,
                name: pub.name,
                email: pub.email,
                color: pub.color,
                isDefault: pub.isDefault,
                isEmpty: pub.isEmpty,
                identity: pub.identity || '',
                displayName: meta.displayName || '',
                usage: cursorUsage.publicAccountUsage(row)
            };
        }));

        const personaBinding = (row) => ({
            activeAccountId: (row && row.activeAccountId) || 'default'
        });

        handlersCtx.sendToClient(ws, {
            type: 'get_cursor_accounts_response',
            requestId: message.requestId,
            data: {
                success: true,
                wren: personaBinding(cursorData.wren),
                xi: personaBinding(cursorData.xi),
                accounts: accountsWithUsage,
                wrenStatus,
                xiStatus,
                usage,
                xiUsage,
                captureEnabled: !!(xiLive.hasLive && !xiLive.known),
                capturePersona: 'xi',
                xiLiveKnown: xiLive.known === true,
                xiLiveMatchedAccountId: xiLive.matchedAccountId || ''
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching Cursor accounts:', error);
        handlersCtx.sendError(ws, 'Failed to fetch Cursor accounts', error.message, message.requestId);
    }
}

async function handleSwitchCursorAccount(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { persona, accountId, customToken } = message;
        if (!persona || (persona !== 'wren' && persona !== 'xi' && persona !== 'both')) {
            handlersCtx.sendError(ws, 'persona must be "wren", "xi", or "both"', 'INVALID_PERSONA', message.requestId);
            return;
        }
        if (!accountId || typeof accountId !== 'string') {
            handlersCtx.sendError(ws, 'accountId is required', 'MISSING_ACCOUNT_ID', message.requestId);
            return;
        }

        const secureConfig = handlersCtx.globalResources.getSecureConfig() || {};
        const cursorData = secureConfig.cursorAccounts || {
            wren: { activeAccountId: 'default', customToken: '' },
            xi: { activeAccountId: 'default', customToken: '' },
            accounts: [
                { id: 'default', name: 'Host Account (Default)', email: 'system@cursor.sh', isDefault: true }
            ]
        };

        const targets = persona === 'both' ? ['wren', 'xi'] : [persona];
        const cursorAccountAuthStore = require('../../cursorAccountAuthStore');

        for (const target of targets) {
            const prevAccountId = target === 'wren'
                ? (cursorData.wren?.activeAccountId || 'default')
                : (cursorData.xi?.activeAccountId || 'default');
            // Copy out last active paired credentials so no live auth tokens are lost
            if (prevAccountId && prevAccountId !== accountId) {
                try {
                    const captured = cursorAccountAuthStore.captureLivePersonaAuthFiles(target, prevAccountId);
                    const idx = cursorData.accounts.findIndex((row) => row.id === prevAccountId);
                    if (idx >= 0 && captured && captured.token) {
                        const email = captured.email && !String(captured.email).startsWith('(')
                            ? captured.email
                            : cursorData.accounts[idx].email;
                        cursorData.accounts[idx] = {
                            ...cursorData.accounts[idx],
                            email,
                            token: captured.token,
                            isEmpty: false
                        };
                    }
                } catch (err) {
                    console.warn(`[190-adminHandler] Warning saving prev account credentials (${prevAccountId}):`, err.message);
                }
            }
            if (target === 'wren') {
                cursorData.wren = { activeAccountId: accountId, customToken: customToken || '' };
            } else {
                cursorData.xi = { activeAccountId: accountId, customToken: customToken || '' };
            }
        }

        handlersCtx.globalResources.modifyConfig('secureConfig').assign('cursorAccounts', cursorData);

        const cursorDirector = require('../../cursorDirector');
        const xiDirector = require('../../xiDirector');
        const cursorUsage = require('../../cursorUsage');

        if (typeof cursorUsage.invalidateCursorUsage === 'function') {
            cursorUsage.invalidateCursorUsage();
        }

        for (const target of targets) {
            if (target === 'wren') {
                try {
                    if (typeof cursorDirector.abortAllRuns === 'function') {
                        cursorDirector.abortAllRuns();
                    }
                    const jailHome = cursorDirector.layout().home;
                    const wrenConfigDir = path.join(jailHome, '.config', 'cursor');
                    cursorAccountAuthStore.restoreAccountAuthFiles(accountId, wrenConfigDir);
                    cursorDirector.syncCursorCliLogin(jailHome);
                } catch (err) {
                    console.warn('Wren CLI auth sync warning:', err.message);
                }
            } else if (target === 'xi') {
                try {
                    const xiConfigDir = xiDirector.layout ? xiDirector.layout().configDir : null;
                    if (xiConfigDir) {
                        cursorAccountAuthStore.restoreAccountAuthFiles(accountId, xiConfigDir);
                        if (typeof cursorDirector.installUnrestrictedCli === 'function') {
                            cursorDirector.installUnrestrictedCli(xiConfigDir);
                        }
                    }
                } catch (err) {
                    console.warn('Xi CLI auth sync warning:', err.message);
                }
            }
        }

        if (typeof cursorUsage.invalidateCursorUsage === 'function') {
            cursorUsage.invalidateCursorUsage();
        }

        let updatedUsage = null;
        let updatedXiUsage = null;
        if (targets.includes('wren')) {
            try {
                updatedUsage = await cursorUsage.getCursorUsage('wren');
            } catch (_) {}
        }
        if (targets.includes('xi')) {
            try {
                updatedXiUsage = await cursorUsage.getCursorUsage('xi');
            } catch (_) {}
        }

        const who = persona === 'both' ? 'Wren and Xi' : (persona === 'wren' ? 'Wren' : 'Xi');
        console.log(`👤 Cursor account switched for ${who} to profile ${accountId} by session ${clientInfo.sessionId}`);

        handlersCtx.sendToClient(ws, {
            type: 'switch_cursor_account_response',
            requestId: message.requestId,
            data: {
                success: true,
                persona,
                activeAccountId: accountId,
                usage: updatedUsage,
                xiUsage: updatedXiUsage,
                message: `Switched Cursor account for ${who}`
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error switching Cursor account:', error);
        handlersCtx.sendError(ws, 'Failed to switch Cursor account', error.message, message.requestId);
    }
}

async function handleSaveCursorAccount(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { id, name, email, token, persona = 'wren', makeActive = true, color, tokenKind } = message;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            handlersCtx.sendError(ws, 'Profile name is required', 'MISSING_NAME', message.requestId);
            return;
        }

        const secureConfig = handlersCtx.globalResources.getSecureConfig() || {};
        const cursorData = secureConfig.cursorAccounts || {
            wren: { activeAccountId: 'default', customToken: '' },
            xi: { activeAccountId: 'default', customToken: '' },
            accounts: [
                { id: 'default', name: 'Host Account (Default)', email: 'system@cursor.sh', isDefault: true }
            ]
        };

        const profileId = id && id.trim() ? id.trim() : `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const existingIdx = cursorData.accounts.findIndex(a => a.id === profileId);

        const cursorAccountAuthStore = require('../../cursorAccountAuthStore');
        const incomingToken = (token || '').trim();
        const isNewProfile = existingIdx < 0;
        const previous = existingIdx >= 0 ? cursorData.accounts[existingIdx] : null;
        const keepStoredToken = !incomingToken && previous && !previous.isEmpty;
        const tokenStr = keepStoredToken ? String(previous.token || '') : incomingToken;
        const explicitKind = tokenKind === 'apiKey' || tokenKind === 'accessToken' ? tokenKind : '';
        const storedKind = keepStoredToken ? (previous.tokenKind || '') : explicitKind;
        const isEmptyNew = isNewProfile && !tokenStr && profileId !== 'default';
        const targetPersona = (persona === 'xi') ? 'xi' : 'wren';

        if (isNewProfile) {
            // Copy out the last active paired credentials so no live auth tokens are lost
            const prevAccountId = (targetPersona === 'wren' ? cursorData.wren?.activeAccountId : cursorData.xi?.activeAccountId) || 'default';
            if (prevAccountId) {
                try {
                    cursorAccountAuthStore.captureLivePersonaAuthFiles(targetPersona, prevAccountId);
                } catch (err) {
                    console.warn(`[190-adminHandler] Warning saving prev account credentials before creating new profile (${prevAccountId}):`, err.message);
                }
            }
        }

        let extractedEmail = (email || '').trim();
        if (isEmptyNew) {
            extractedEmail = '(Pending Login)';
        } else if (!extractedEmail) {
            extractedEmail = cursorAccountAuthStore.extractEmailFromToken(tokenStr) || cursorAccountAuthStore.getHostAccountInfo().email || '';
        }

        const newAccount = {
            id: profileId,
            name: name.trim(),
            email: extractedEmail,
            token: isEmptyNew ? '' : tokenStr,
            tokenKind: isEmptyNew ? '' : storedKind,
            isEmpty: isNewProfile ? isEmptyNew : (keepStoredToken ? !!previous.isEmpty : !tokenStr),
            isDefault: profileId === 'default',
            color: cursorAccountAuthStore.normalizeAccountColor(color)
        };

        if (existingIdx >= 0) {
            cursorData.accounts[existingIdx] = { ...cursorData.accounts[existingIdx], ...newAccount };
        } else {
            cursorData.accounts.push(newAccount);
        }

        // If creating a new bare profile and makeActive is true, set it active and clear live config dir bare!
        if (isNewProfile && (isEmptyNew || makeActive)) {
            if (targetPersona === 'wren') {
                cursorData.wren = { activeAccountId: profileId, customToken: '' };
            } else {
                cursorData.xi = { activeAccountId: profileId, customToken: '' };
            }
            // Clear live directory bare for new login (pass null for activeAccountId so only live dir is cleared)
            cursorAccountAuthStore.logoutCursorAccount(targetPersona, null);
        }

        handlersCtx.globalResources.modifyConfig('secureConfig').assign('cursorAccounts', cursorData);

        // Save account auth files for profileId
        cursorAccountAuthStore.saveAccountAuthFiles(profileId, { ...newAccount, isNew: isNewProfile }, isEmptyNew ? 'empty' : tokenStr);

        // If tokenStr was provided for a new profile, restore it to live dir
        if (isNewProfile && !isEmptyNew && tokenStr) {
            const cursorDirector = require('../../cursorDirector');
            const xiDirector = require('../../xiDirector');
            if (targetPersona === 'wren') {
                const jailHome = cursorDirector.layout().home;
                const wrenConfigDir = path.join(jailHome, '.config', 'cursor');
                cursorAccountAuthStore.restoreAccountAuthFiles(profileId, wrenConfigDir);
            } else if (targetPersona === 'xi') {
                const xiConfigDir = xiDirector.layout ? xiDirector.layout().configDir : null;
                if (xiConfigDir) {
                    cursorAccountAuthStore.restoreAccountAuthFiles(profileId, xiConfigDir);
                }
            }
        }

        handlersCtx.sendToClient(ws, {
            type: 'save_cursor_account_response',
            requestId: message.requestId,
            data: {
                success: true,
                account: newAccount,
                persona: targetPersona,
                activeAccountId: profileId,
                message: existingIdx >= 0 ? 'Cursor account profile updated' : 'Cursor account profile created and set as active bare profile for new login'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error saving Cursor account profile:', error);
        handlersCtx.sendError(ws, 'Failed to save Cursor account profile', error.message, message.requestId);
    }
}

async function handleLoginCursorAccount(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        const accountId = String(message.accountId || '').trim();
        if (!accountId) {
            handlersCtx.sendError(ws, 'accountId is required', 'MISSING_ACCOUNT_ID', message.requestId);
            return;
        }
        const secureConfig = handlersCtx.globalResources.getSecureConfig() || {};
        const accounts = (secureConfig.cursorAccounts && secureConfig.cursorAccounts.accounts) || [];
        if (!accounts.some((acc) => acc.id === accountId)) {
            handlersCtx.sendError(ws, 'Account profile not found', 'ACCOUNT_NOT_FOUND', message.requestId);
            return;
        }
        const cursorAccountAuthStore = require('../../cursorAccountAuthStore');
        const job = cursorAccountAuthStore.beginCursorAccountLogin(accountId, {
            onDone: (result) => {
                void (async () => {
                    let email = result && result.email ? result.email : '';
                    let provisionError = null;
                    try {
                        const current = handlersCtx.globalResources.getSecureConfig() || {};
                        const cursorData = current.cursorAccounts || { accounts: [] };
                        const recorded = await cursorAccountAuthStore.recordGuidedLogin(cursorData, accountId, result || {});
                        email = recorded.email || email;
                        provisionError = recorded.provisionError;
                        const pending = handlersCtx.globalResources.modifyConfig('secureConfig', undefined, { immediate: true }).assign('cursorAccounts', cursorData);
                        if (pending && typeof pending.then === 'function') await pending;
                        cursorAccountAuthStore.restoreActiveCursorAccounts(handlersCtx.globalResources);
                        try { require('../../cursorUsage').invalidateCursorUsage(); } catch (_) { /* usage refresh is optional */ }
                    } catch (err) {
                        provisionError = err;
                        console.error('Cursor login capture failed:', err);
                    }
                    if (wsServer && typeof wsServer.broadcast === 'function') {
                        wsServer.broadcast({
                            type: 'cursor_account_login_complete',
                            data: {
                                success: !provisionError,
                                accountId,
                                email: email || '',
                                message: provisionError
                                    ? (provisionError.message || 'Login was saved, but the account API key was not created')
                                    : ''
                            },
                            timestamp: new Date().toISOString()
                        });
                    }
                })();
            },
            onFail: (error) => {
                if (wsServer && typeof wsServer.broadcast === 'function') {
                    wsServer.broadcast({
                        type: 'cursor_account_login_complete',
                        data: { success: false, accountId, message: error.message || 'Login failed' },
                        timestamp: new Date().toISOString()
                    });
                }
            }
        });
        const url = job.url || await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Login link did not appear')), 20000);
            job.listeners.push({
                onUrl: (found) => {
                    clearTimeout(timer);
                    resolve(found);
                },
                onFail: (error) => {
                    clearTimeout(timer);
                    reject(error);
                }
            });
            if (job.url) {
                clearTimeout(timer);
                resolve(job.url);
            }
        });
        handlersCtx.sendToClient(ws, {
            type: 'login_cursor_account_response',
            requestId: message.requestId,
            data: {
                success: true,
                accountId,
                url,
                message: 'Finish signing in in the browser tab. Dreamscape will capture that login for this profile.'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Cursor account login failed:', error);
        handlersCtx.sendError(ws, error.message || 'Failed to start Cursor login', error.code || 'LOGIN_FAILED', message.requestId);
    }
}

async function handleDeleteCursorAccount(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { accountId } = message;
        if (!accountId || accountId === 'default') {
            handlersCtx.sendError(ws, 'Cannot delete the default host account profile', 'CANNOT_DELETE_DEFAULT', message.requestId);
            return;
        }

        const secureConfig = handlersCtx.globalResources.getSecureConfig() || {};
        const cursorData = secureConfig.cursorAccounts || {
            wren: { activeAccountId: 'default', customToken: '' },
            xi: { activeAccountId: 'default', customToken: '' },
            accounts: [
                { id: 'default', name: 'Host Account (Default)', email: 'system@cursor.sh', isDefault: true }
            ]
        };

        cursorData.accounts = cursorData.accounts.filter(a => a.id !== accountId);

        if (cursorData.wren && cursorData.wren.activeAccountId === accountId) {
            cursorData.wren.activeAccountId = 'default';
        }
        if (cursorData.xi && cursorData.xi.activeAccountId === accountId) {
            cursorData.xi.activeAccountId = 'default';
        }

        handlersCtx.globalResources.modifyConfig('secureConfig').assign('cursorAccounts', cursorData);

        const cursorAccountAuthStore = require('../../cursorAccountAuthStore');
        cursorAccountAuthStore.deleteAccountAuthFiles(accountId);

        handlersCtx.sendToClient(ws, {
            type: 'delete_cursor_account_response',
            requestId: message.requestId,
            data: {
                success: true,
                accountId,
                message: 'Cursor account profile deleted'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error deleting Cursor account profile:', error);
        handlersCtx.sendError(ws, 'Failed to delete Cursor account profile', error.message, message.requestId);
    }
}

async function handleCaptureCursorAccount(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { accountId, persona } = message;
        if (!accountId || typeof accountId !== 'string') {
            handlersCtx.sendError(ws, 'accountId is required', 'MISSING_ACCOUNT_ID', message.requestId);
            return;
        }

        const targetPersona = persona || 'wren';
        const cursorAccountAuthStore = require('../../cursorAccountAuthStore');
        const capturedInfo = cursorAccountAuthStore.captureLivePersonaAuthFiles(targetPersona, accountId);

        const secureConfig = handlersCtx.globalResources.getSecureConfig() || {};
        const cursorData = secureConfig.cursorAccounts || {
            wren: { activeAccountId: 'default', customToken: '' },
            xi: { activeAccountId: 'default', customToken: '' },
            accounts: []
        };

        const existingIdx = cursorData.accounts.findIndex(a => a.id === accountId);
        const hasValidToken = Boolean(capturedInfo.token);
        const email = capturedInfo.email && !capturedInfo.email.startsWith('(') ? capturedInfo.email : (capturedInfo.token ? (cursorAccountAuthStore.extractEmailFromToken(capturedInfo.token) || capturedInfo.email) : '(Pending Login)');

        if (existingIdx >= 0) {
            const acc = cursorData.accounts[existingIdx];
            const isGenericName = !acc.name || acc.name.startsWith('Captured Account') || acc.name.startsWith('Account ') || acc.name.startsWith('New Profile');
            cursorData.accounts[existingIdx] = {
                ...acc,
                name: (isGenericName && email && !email.startsWith('(')) ? email : acc.name,
                email: email,
                token: capturedInfo.token || '',
                isEmpty: !hasValidToken
            };
        } else {
            cursorData.accounts.push({
                id: accountId,
                name: email && !email.startsWith('(') ? email : `Account (${new Date().toLocaleDateString()})`,
                email: email,
                token: capturedInfo.token || '',
                isEmpty: !hasValidToken
            });
        }

        // Make this profile active for targetPersona and restore auth files into live config dir
        if (targetPersona === 'wren') {
            cursorData.wren = { activeAccountId: accountId, customToken: '' };
        } else {
            cursorData.xi = { activeAccountId: accountId, customToken: '' };
        }

        handlersCtx.globalResources.modifyConfig('secureConfig').assign('cursorAccounts', cursorData);

        const cursorDirector = require('../../cursorDirector');
        const xiDirector = require('../../xiDirector');
        if (targetPersona === 'wren') {
            const jailHome = cursorDirector.layout().home;
            const wrenConfigDir = path.join(jailHome, '.config', 'cursor');
            cursorAccountAuthStore.restoreAccountAuthFiles(accountId, wrenConfigDir);
        } else if (targetPersona === 'xi') {
            const xiConfigDir = xiDirector.layout ? xiDirector.layout().configDir : null;
            if (xiConfigDir) {
                cursorAccountAuthStore.restoreAccountAuthFiles(accountId, xiConfigDir);
            }
        }

        handlersCtx.sendToClient(ws, {
            type: 'capture_cursor_account_response',
            requestId: message.requestId,
            data: {
                success: true,
                accountId,
                email: email,
                message: `Captured & paired account credentials (${email})`
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error capturing Cursor account credentials:', error);
        handlersCtx.sendError(ws, 'Failed to capture Cursor account credentials', error.message, message.requestId);
    }
}

async function handleLogoutCursorAccount(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        if (clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }

        const { persona, accountId } = message;
        const targetPersona = persona || 'wren';

        const secureConfig = handlersCtx.globalResources.getSecureConfig() || {};
        const cursorData = secureConfig.cursorAccounts || { wren: {}, xi: {}, accounts: [] };
        const activeId = accountId || (targetPersona === 'wren' ? cursorData.wren?.activeAccountId : cursorData.xi?.activeAccountId) || 'default';

        const cursorAccountAuthStore = require('../../cursorAccountAuthStore');
        cursorAccountAuthStore.logoutCursorAccount(targetPersona, activeId);

        const existingIdx = cursorData.accounts.findIndex(a => a.id === activeId);
        if (existingIdx >= 0) {
            cursorData.accounts[existingIdx].email = '(Logged Out)';
            cursorData.accounts[existingIdx].token = '';
            cursorData.accounts[existingIdx].isEmpty = true;
            handlersCtx.globalResources.modifyConfig('secureConfig').assign('cursorAccounts', cursorData);
        }

        handlersCtx.sendToClient(ws, {
            type: 'logout_cursor_account_response',
            requestId: message.requestId,
            data: {
                success: true,
                persona: targetPersona,
                accountId: activeId,
                message: `Logged out Cursor account for ${targetPersona === 'wren' ? 'Wren' : 'Xi'}`
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error logging out Cursor account:', error);
        handlersCtx.sendError(ws, 'Failed to log out Cursor account', error.message, message.requestId);
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

    reg('get_cursor_accounts', handleGetCursorAccounts);
    reg('switch_cursor_account', handleSwitchCursorAccount, ADMIN_DESTRUCTIVE);
    reg('save_cursor_account', handleSaveCursorAccount, ADMIN_DESTRUCTIVE);
    reg('login_cursor_account', handleLoginCursorAccount, ADMIN_DESTRUCTIVE);
    reg('capture_cursor_account', handleCaptureCursorAccount, ADMIN_DESTRUCTIVE);
    reg('logout_cursor_account', handleLogoutCursorAccount, ADMIN_DESTRUCTIVE);
    reg('delete_cursor_account', handleDeleteCursorAccount, ADMIN_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};

