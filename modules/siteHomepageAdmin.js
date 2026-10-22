'use strict';

const fs = require('fs');
const siteAccess = require('./siteAccess');
const siteHomepage = require('./siteHomepageStorage');

function readPreviewIndex(projectRoot, slug) {
    const installed = siteHomepage.installedDir(projectRoot, slug);
    const avail = siteHomepage.availableDir(projectRoot, slug);
    let siteDir = installed;
    if (!fs.existsSync(siteDir)) {
        siteDir = avail;
    }
    if (!fs.existsSync(siteDir)) {
        return null;
    }
    const resolved = siteHomepage.resolveSiteFile(siteDir, '/');
    if (resolved.kind !== 'file') return null;
    return fs.readFileSync(resolved.abs, 'utf8');
}

async function handleGetSiteHomepage(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    const projectRoot = handlersCtx.globalResources.getPath('root');
    siteHomepage.ensureAvailableCatalog(projectRoot);
    const status = siteAccess.publicSiteAccessStatus(handlersCtx.globalResources);
    handlersCtx.sendToClient(ws, {
        type: 'get_site_homepage_response',
        requestId: message.requestId,
        data: {
            success: true,
            configured: status.configured,
            homepage: status.homepage,
            available: siteHomepage.listAvailableSlugs(projectRoot),
            doorFailures: handlersCtx.globalResources.getDataPlumbing ?
                undefined : undefined
        },
        timestamp: new Date().toISOString()
    });
}

async function handleGetSiteHomepagePreview(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    const slug = typeof message.slug === 'string' ? message.slug.trim() : '';
    if (!siteHomepage.isSafeSlug(slug)) {
        handlersCtx.sendError(ws, 'Invalid slug', 'INVALID_SLUG', message.requestId);
        return;
    }
    const projectRoot = handlersCtx.globalResources.getPath('root');
    const html = readPreviewIndex(projectRoot, slug);
    if (!html) {
        handlersCtx.sendError(ws, 'Preview not found', 'NOT_FOUND', message.requestId);
        return;
    }
    handlersCtx.sendToClient(ws, {
        type: 'get_site_homepage_preview_response',
        requestId: message.requestId,
        data: { success: true, slug, html },
        timestamp: new Date().toISOString()
    });
}

async function handleSetSiteHomepage(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    const slug = typeof message.slug === 'string' ? message.slug.trim() : '';
    if (!siteHomepage.isSafeSlug(slug)) {
        handlersCtx.sendError(ws, 'Invalid homepage slug', 'INVALID_SLUG', message.requestId);
        return;
    }
    const phrase = message.phrase != null ? String(message.phrase) : '';
    const projectRoot = handlersCtx.globalResources.getPath('root');
    try {
        siteHomepage.installHomepage(projectRoot, slug);
    } catch (err) {
        handlersCtx.sendError(ws, err.message || 'Install failed', 'INSTALL_FAILED', message.requestId);
        return;
    }

    try {
        const existing = siteAccess.readSiteAccessSecure(handlersCtx.globalResources);
        if (!phrase.trim() && !existing.hash) {
            handlersCtx.sendError(ws, 'Access phrase is required on first install', 'MISSING_PHRASE', message.requestId);
            return;
        }
        handlersCtx.globalResources.modifyConfig('secureConfig', (cfg) => {
            if (!cfg.siteAccess || typeof cfg.siteAccess !== 'object') {
                cfg.siteAccess = {};
            }
            cfg.siteAccess.enabled = true;
            cfg.siteAccess.homepage = slug;
            if (!cfg.siteAccess.pepper) {
                cfg.siteAccess.pepper = siteAccess.generatePepper();
            }
            if (phrase.trim()) {
                cfg.siteAccess.hash = siteAccess.computeAccessHash(cfg.siteAccess.pepper, phrase.trim());
            }
            return cfg;
        });
    } catch (err) {
        handlersCtx.sendError(ws, err.message || 'Could not save site homepage', 'SAVE_FAILED', message.requestId);
        return;
    }

    try {
        await handlersCtx.globalResources.generateLoginSpriteSheet();
    } catch (_err) { /* non-fatal */ }

    const status = siteAccess.publicSiteAccessStatus(handlersCtx.globalResources);
    handlersCtx.sendToClient(ws, {
        type: 'set_site_homepage_response',
        requestId: message.requestId,
        data: {
            success: true,
            configured: status.configured,
            homepage: status.homepage,
            message: 'Site homepage installed'
        },
        timestamp: new Date().toISOString()
    });
}

async function handleClearSiteHomepage(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    handlersCtx.globalResources.modifyConfig('secureConfig', (cfg) => {
        if (!cfg.siteAccess || typeof cfg.siteAccess !== 'object') {
            cfg.siteAccess = { enabled: false };
        } else {
            cfg.siteAccess.enabled = false;
        }
        return cfg;
    });
    try {
        await handlersCtx.globalResources.generateLoginSpriteSheet();
    } catch (_err) { /* non-fatal */ }
    handlersCtx.sendToClient(ws, {
        type: 'clear_site_homepage_response',
        requestId: message.requestId,
        data: { success: true, configured: false, homepage: null },
        timestamp: new Date().toISOString()
    });
}

function registerSiteHomepagePackets(handlersCtx, reg, ADMIN_DESTRUCTIVE) {
    reg('get_site_homepage', handleGetSiteHomepage);
    reg('get_site_homepage_preview', handleGetSiteHomepagePreview);
    reg('set_site_homepage', handleSetSiteHomepage, ADMIN_DESTRUCTIVE);
    reg('clear_site_homepage', handleClearSiteHomepage, ADMIN_DESTRUCTIVE);
}

module.exports = {
    registerSiteHomepagePackets,
    readPreviewIndex
};
