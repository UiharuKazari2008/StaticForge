'use strict';

const fs = require('fs');
const siteAccess = require('./siteAccess');
const siteHomepage = require('./siteHomepageStorage');
const siteHomepagePreview = require('./siteHomepagePreview');
const { verifyPin } = require('./pinAuth');

/*
 * Front Gate (Yozora #828; the MMC snap-in public/scripts/comp/mmcFrontGate.js). The access phrase
 * is kept in the secure config next to its hash (siteAccess.phrase) so an administrator can reveal
 * it; a phrase set before #828 has only its hash until it is changed. Turning the gate off and
 * turning it back on need the admin PIN (secureConfig.loginPin); turning it back on also needs
 * the current access phrase. The first time (no phrase yet) the phrase is set while enabling.
 */

function packetBody(message) {
    return message && (message.data && typeof message.data === 'object' ? message.data : message) || {};
}

function adminPinOk(handlersCtx, pin) {
    const stored = handlersCtx.globalResources.getSecureConfig({ path: 'loginPin' });
    return typeof pin === 'string' && pin.length > 0 && verifyPin(pin, stored);
}

/** The gate's full state for the console (admin only). */
function frontGateState(handlersCtx) {
    const projectRoot = handlersCtx.globalResources.getPath('root');
    const cfg = siteAccess.readSiteAccessSecure(handlersCtx.globalResources);
    const raw = handlersCtx.globalResources.getSecureConfig({ path: 'siteAccess' }) || {};
    const status = siteAccess.publicSiteAccessStatus(handlersCtx.globalResources);
    return {
        configured: status.configured,
        homepage: status.homepage,
        enabled: status.configured,
        cover: cfg.homepage || null,
        phraseSet: !!cfg.hash,
        phraseKnown: !!(cfg.hash && typeof raw.phrase === 'string' && raw.phrase),
        available: siteHomepage.listAvailableSlugs(projectRoot).map((slug) => ({ slug, title: siteHomepage.coverTitle ? siteHomepage.coverTitle(projectRoot, slug) : null }))
    };
}

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
        data: Object.assign({
            success: true,
            configured: status.configured,
            homepage: status.homepage,
            available: siteHomepage.listAvailableSlugs(projectRoot)
        }, { frontGate: frontGateState(handlersCtx) }),
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

/**
 * set_site_homepage { slug, phrase?, adminPin?, mode? }
 *   mode 'cover' (the gate is on): another cover site, nothing else changes
 *   otherwise it turns the gate on. With no phrase stored yet the phrase is required and becomes
 *   the access phrase. With one stored (turning it back on) the admin PIN and the current
 *   phrase are both required.
 */
async function handleSetSiteHomepage(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    const body = packetBody(message);
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

    const existing = siteAccess.readSiteAccessSecure(handlersCtx.globalResources);
    const coverOnly = body.mode === 'cover';
    if (coverOnly && !existing.configured) {
        handlersCtx.sendError(ws, 'Front Gate is turned off', 'GATE_OFF', message.requestId);
        return;
    }
    let setPhrase = false;
    if (!coverOnly && !existing.configured) {
        if (existing.hash) {
            // turning it back on: the admin PIN and the access phrase it had
            if (!adminPinOk(handlersCtx, body.adminPin)) {
                handlersCtx.sendError(ws, 'The admin PIN is incorrect.', 'BAD_ADMIN_PIN', message.requestId);
                return;
            }
            const candidate = phraseNorm ? siteAccess.computeAccessHash(existing.pepper, phraseNorm) : null;
            if (!candidate || !siteAccess.validateAccessToken(candidate, Object.assign({}, existing, { configured: true }))) {
                handlersCtx.sendError(ws, 'The access phrase is incorrect.', 'BAD_PHRASE', message.requestId);
                return;
            }
        } else {
            if (!phraseNorm) {
                handlersCtx.sendError(ws, 'Access phrase is required when enabling the gate', 'MISSING_PHRASE', message.requestId);
                return;
            }
            setPhrase = true;
        }
    }

    try {
        handlersCtx.globalResources.modifyConfig('secureConfig', (cfg) => {
            if (!cfg.siteAccess || typeof cfg.siteAccess !== 'object') {
                cfg.siteAccess = {};
            }
            cfg.siteAccess.enabled = true;
            cfg.siteAccess.homepage = slug;
            if (!cfg.siteAccess.pepper) {
                cfg.siteAccess.pepper = siteAccess.generatePepper();
            }
            if (setPhrase) {
                cfg.siteAccess.hash = siteAccess.computeAccessHash(cfg.siteAccess.pepper, phraseNorm);
                cfg.siteAccess.phrase = phraseNorm;
            } else if (!coverOnly && phraseNorm && !cfg.siteAccess.phrase) {
                // turned back on with the right phrase: now it can be shown
                cfg.siteAccess.phrase = phraseNorm;
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
            frontGate: frontGateState(handlersCtx),
            message: 'Cover site active'
        },
        timestamp: new Date().toISOString()
    });
}

/** clear_site_homepage { adminPin }: Front Gate off (the cover and the phrase are kept). */
async function handleClearSiteHomepage(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    if (!adminPinOk(handlersCtx, packetBody(message).adminPin)) {
        handlersCtx.sendError(ws, 'The admin PIN is incorrect.', 'BAD_ADMIN_PIN', message.requestId);
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
        data: { success: true, configured: false, homepage: null, frontGate: frontGateState(handlersCtx) },
        timestamp: new Date().toISOString()
    });
}

/** get_site_access_phrase: the stored access phrase for Reveal (null when only its hash is kept). */
async function handleGetSiteAccessPhrase(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    const raw = handlersCtx.globalResources.getSecureConfig({ path: 'siteAccess' }) || {};
    const known = raw.hash && typeof raw.phrase === 'string' && raw.phrase ? raw.phrase : null;
    handlersCtx.sendToClient(ws, {
        type: 'get_site_access_phrase_response',
        requestId: message.requestId,
        data: { success: true, phrase: known, phraseSet: !!raw.hash },
        timestamp: new Date().toISOString()
    });
}

/**
 * set_site_access_phrase { phrase }: a new access phrase. Every client that holds the old key must
 * enter the new phrase once (the BIOS Gateway Password or the cover's door).
 */
async function handleSetSiteAccessPhrase(handlersCtx, ws, message, clientInfo) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
        return;
    }
    const raw = packetBody(message).phrase;
    const phrase = siteAccess.normalizeAccessPhrase(raw != null && String(raw).trim() ? String(raw) : '');
    if (!phrase) {
        handlersCtx.sendError(ws, `Type an access phrase of 1 to ${siteAccess.ACCESS_PHRASE_MAX_LEN} characters.`, 'BAD_PHRASE', message.requestId);
        return;
    }
    try {
        handlersCtx.globalResources.modifyConfig('secureConfig', (cfg) => {
            if (!cfg.siteAccess || typeof cfg.siteAccess !== 'object') cfg.siteAccess = { enabled: false };
            if (!cfg.siteAccess.pepper) cfg.siteAccess.pepper = siteAccess.generatePepper();
            cfg.siteAccess.hash = siteAccess.computeAccessHash(cfg.siteAccess.pepper, phrase);
            cfg.siteAccess.phrase = phrase;
            return cfg;
        });
    } catch (err) {
        handlersCtx.sendError(ws, err.message || 'Could not save the access phrase', 'SAVE_FAILED', message.requestId);
        return;
    }
    try {
        await handlersCtx.globalResources.generateLoginSpriteSheet();
    } catch (_err) { /* non-fatal */ }
    handlersCtx.sendToClient(ws, {
        type: 'set_site_access_phrase_response',
        requestId: message.requestId,
        data: { success: true, frontGate: frontGateState(handlersCtx) },
        timestamp: new Date().toISOString()
    });
}

function registerSiteHomepagePackets(handlersCtx, reg, ADMIN_DESTRUCTIVE) {
    reg('get_site_homepage', handleGetSiteHomepage);
    reg('mint_site_homepage_preview_url', handleMintSiteHomepagePreviewUrl);
    reg('get_site_homepage_preview', handleGetSiteHomepagePreview);
    reg('set_site_homepage', handleSetSiteHomepage, ADMIN_DESTRUCTIVE);
    reg('clear_site_homepage', handleClearSiteHomepage, ADMIN_DESTRUCTIVE);
    reg('get_site_access_phrase', handleGetSiteAccessPhrase);
    reg('set_site_access_phrase', handleSetSiteAccessPhrase, ADMIN_DESTRUCTIVE);
}

module.exports = {
    registerSiteHomepagePackets,
    packetSlug,
    frontGateState
};
