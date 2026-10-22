'use strict';

const fs = require('fs');
const siteAccess = require('./siteAccess');
const siteHomepage = require('./siteHomepageStorage');
const siteHomepagePreview = require('./siteHomepagePreview');

function packetSlug(message) {
    const body = message && (message.data && typeof message.data === 'object' ? message.data : message);
    return typeof body.slug === 'string' ? body.slug.trim() : '';
}

async function handleGetSiteHomepage(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    const projectRoot = handlersCtx.globalResources.getPath('root');
    const status = siteAccess.publicSiteAccessStatus(handlersCtx.globalResources);
    handlersCtx.sendToClient(ws, {
        type: 'get_site_homepage_response',
        requestId: message.requestId,
        data: {
            success: true,
            configured: status.configured,
            homepage: status.homepage,
            available: siteHomepage.listAvailableSlugs(projectRoot)
        },
        timestamp: new Date().toISOString()
    });
}

async function handleMintSiteHomepagePreviewUrl(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    const slug = packetSlug(message);
    if (!siteHomepage.isSafeSlug(slug)) {
        handlersCtx.sendError(ws, 'Invalid slug', 'INVALID_SLUG', message.requestId);
        return;
    }
    const projectRoot = handlersCtx.globalResources.getPath('root');
    if (!siteHomepage.resolvePreviewSiteDir(projectRoot, slug)) {
        handlersCtx.sendError(ws, 'Preview not found', 'NOT_FOUND', message.requestId);
        return;
    }
    const ticket = siteHomepagePreview.mintPreviewTicket(handlersCtx.globalResources, slug);
    const previewPath = siteHomepagePreview.previewPathForSlug(slug, ticket);
    handlersCtx.sendToClient(ws, {
        type: 'mint_site_homepage_preview_url_response',
        requestId: message.requestId,
        data: { success: true, slug, previewPath, ticket },
        timestamp: new Date().toISOString()
    });
}

async function handleGetSiteHomepagePreview(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    const slug = packetSlug(message);
    if (!siteHomepage.isSafeSlug(slug)) {
        handlersCtx.sendError(ws, 'Invalid slug', 'INVALID_SLUG', message.requestId);
        return;
    }
    const projectRoot = handlersCtx.globalResources.getPath('root');
    const hit = siteHomepage.resolvePreviewSiteDir(projectRoot, slug);
    const html = hit ? fs.readFileSync(hit.resolved.abs, 'utf8') : null;
    if (!html) {
        handlersCtx.sendError(
            ws,
            `Preview not found for "${slug}" (no index.html under resources/site-homepages/${slug}/)`,
            'NOT_FOUND',
            message.requestId
        );
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
    const body = message && (message.data && typeof message.data === 'object' ? message.data : message);
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!siteHomepage.isSafeSlug(slug)) {
        handlersCtx.sendError(ws, 'Invalid homepage slug', 'INVALID_SLUG', message.requestId);
        return;
    }
    const phraseRaw = body.phrase != null ? String(body.phrase) : '';
    const phraseNorm = siteAccess.normalizeAccessPhrase(phraseRaw.trim() ? phraseRaw : '');
    if (phraseRaw.trim() && !phraseNorm) {
        handlersCtx.sendError(
            ws,
            `Access phrase must be at most ${siteAccess.ACCESS_PHRASE_MAX_LEN} characters`,
            'PHRASE_TOO_LONG',
            message.requestId
        );
        return;
    }
    const phrase = phraseNorm != null ? phraseNorm : phraseRaw;
    const projectRoot = handlersCtx.globalResources.getPath('root');
    if (!siteHomepage.slugHasCoverSite(projectRoot, slug)) {
        handlersCtx.sendError(
            ws,
            `No cover site at resources/site-homepages/${slug}/`,
            'NOT_FOUND',
            message.requestId
        );
        return;
    }

    try {
        const existing = siteAccess.readSiteAccessSecure(handlersCtx.globalResources);
        if (!phraseRaw.trim() && !existing.hash) {
            handlersCtx.sendError(ws, 'Access phrase is required when enabling the gate', 'MISSING_PHRASE', message.requestId);
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
            if (phraseNorm) {
                cfg.siteAccess.hash = siteAccess.computeAccessHash(cfg.siteAccess.pepper, phraseNorm);
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
            message: 'Cover site active'
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
    reg('mint_site_homepage_preview_url', handleMintSiteHomepagePreviewUrl);
    reg('get_site_homepage_preview', handleGetSiteHomepagePreview);
    reg('set_site_homepage', handleSetSiteHomepage, ADMIN_DESTRUCTIVE);
    reg('clear_site_homepage', handleClearSiteHomepage, ADMIN_DESTRUCTIVE);
}

module.exports = {
    registerSiteHomepagePackets,
    packetSlug
};
