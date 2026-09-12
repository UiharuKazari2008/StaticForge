/**
 * Copy linkback — one-line agent-readable gen pointer (seed / model / ws / res).
 * Shape: dsref:file:<filename> seed:<n> model:<id> ws:<workspaceId> res:<WxH>
 * Distinct from Copy Lookback (dsap://lookback/img/<filename>) in copyLookback.js.
 */

function linkbackField(value) {
    const raw = value == null ? '' : String(value).trim();
    return raw || '-';
}

function formatLinkbackLine(fields) {
    const src = fields || {};
    return 'dsref:file:' + linkbackField(src.filename)
        + ' seed:' + linkbackField(src.seed)
        + ' model:' + linkbackField(src.model)
        + ' ws:' + linkbackField(src.workspaceId)
        + ' res:' + linkbackField(src.resolution);
}

function pickLinkbackFilename(source) {
    if (!source) return '';
    if (typeof source === 'string') return source.trim();
    return String(
        source.filename
        || source.upscaled
        || source.original
        || (source.metadata && (source.metadata.filename || source.metadata.upscaled || source.metadata.original))
        || ''
    ).trim();
}

function pickLinkbackSeed(source) {
    if (!source) return '';
    const embedded = source.metadata || {};
    const forge = source.forge_data || embedded.forge_data || {};
    if (source.seed !== undefined && source.seed !== null && source.seed !== '') return source.seed;
    if (embedded.seed !== undefined && embedded.seed !== null && embedded.seed !== '') return embedded.seed;
    if (source.layer1Seed !== undefined && source.layer1Seed !== null) return source.layer1Seed;
    if (embedded.layer1Seed !== undefined && embedded.layer1Seed !== null) return embedded.layer1Seed;
    if (forge.layer1_seed !== undefined && forge.layer1_seed !== null) return forge.layer1_seed;
    return '';
}

function pickLinkbackModel(source) {
    if (!source) return '';
    const embedded = source.metadata || {};
    const forge = source.forge_data || embedded.forge_data || {};
    const raw = source.model
        || embedded.model
        || forge.model
        || source.model_display_name
        || embedded.model_display_name
        || '';
    return String(raw).trim().toLowerCase();
}

function pickLinkbackWorkspaceId(source) {
    if (source) {
        const embedded = source.metadata || {};
        const fromImage = source.workspaceId
            || source.workspace
            || embedded.workspaceId
            || embedded.workspace
            || source.generatedWorkspace
            || embedded.generatedWorkspace;
        if (fromImage) return String(fromImage).trim();
    }
    // activeWorkspace: public/scripts/comp/workspaceUtils.js
    if (activeWorkspace) return String(activeWorkspace).trim();
    return 'default';
}

function pickLinkbackResolution(source) {
    if (!source) return '';
    const embedded = source.metadata || {};
    const width = source.actual_width || source.width || embedded.actual_width || embedded.width;
    const height = source.actual_height || source.height || embedded.actual_height || embedded.height;
    if (width && height) return width + 'x' + height;
    const named = String(source.resolution || embedded.resolution || '').trim();
    const match = named.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (match) return match[1] + 'x' + match[2];
    return '';
}

function mergeLinkbackSource(imageOrFilename) {
    if (imageOrFilename == null) return {};
    if (typeof imageOrFilename === 'string') {
        return { filename: imageOrFilename.trim() };
    }
    const image = imageOrFilename;
    const embedded = image.metadata && typeof image.metadata === 'object' ? image.metadata : {};
    const merged = Object.assign({}, embedded, image);
    merged.filename = pickLinkbackFilename(image);
    if (merged.seed === undefined || merged.seed === null || merged.seed === '') {
        merged.seed = pickLinkbackSeed(image);
    }
    if (!merged.model) merged.model = pickLinkbackModel(image);
    if (!merged.workspaceId) {
        merged.workspaceId = image.workspaceId || image.workspace || embedded.workspaceId || embedded.workspace
            || image.generatedWorkspace || embedded.generatedWorkspace;
    }
    if (!merged.width) merged.width = image.actual_width || image.width || embedded.actual_width || embedded.width;
    if (!merged.height) merged.height = image.actual_height || image.height || embedded.actual_height || embedded.height;
    return merged;
}

function linkbackNeedsMetadata(source) {
    return !pickLinkbackSeed(source) || !pickLinkbackModel(source) || !pickLinkbackResolution(source);
}

function writeLinkbackClipboard(line) {
    // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
    copyTextToClipboard(line).then(() => {
        // showGlassToast: public/scripts/comp/toastManager.js
        showGlassToast('success', null, 'Copied linkback', false, 2000, '<i class="fas fa-code"></i>');
    }).catch(() => {
        showGlassToast('error', null, 'Copy linkback failed', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
    });
}

function copyLinkbackFromSource(source) {
    const filename = pickLinkbackFilename(source);
    if (!filename) {
        showGlassToast('info', null, 'No linkback target', false, 2000, '<i class="fas fa-info-circle"></i>');
        return;
    }
    writeLinkbackClipboard(formatLinkbackLine({
        filename: filename,
        seed: pickLinkbackSeed(source),
        model: pickLinkbackModel(source),
        workspaceId: pickLinkbackWorkspaceId(source),
        resolution: pickLinkbackResolution(source)
    }));
}

function copyLinkbackImage(imageOrFilename) {
    const source = mergeLinkbackSource(imageOrFilename);
    const filename = pickLinkbackFilename(source);
    if (!filename) {
        showGlassToast('info', null, 'No linkback target', false, 2000, '<i class="fas fa-info-circle"></i>');
        return;
    }
    if (!linkbackNeedsMetadata(source)) {
        copyLinkbackFromSource(source);
        return;
    }
    // getImageMetadata: public/scripts/comp/galleryView.js
    Promise.resolve(getImageMetadata(filename)).then((loaded) => {
        copyLinkbackFromSource(Object.assign({}, source, loaded || {}));
    }).catch(() => {
        copyLinkbackFromSource(source);
    });
}
