const fs = require('fs');
const path = require('path');
const naiPromptGuideSync = require('./naiPromptGuideSync');

function getWikiBasePath(globalResources) {
    return path.join(globalResources.getPath('cache'), 'wiki');
}

function readJsonSafe(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn('staticWiki readJsonSafe:', filePath, err.message);
        return fallback;
    }
}

function resolveExistingSiteIcon(base, siteId, iconFromMeta) {
    if (!siteId) return null;
    const names = [];
    const meta = String(iconFromMeta || '');
    const named = /\/assets\/([^/?#]+)$/.exec(meta);
    if (named) names.push(named[1]);
    names.push('icon.png', 'icon.webp', 'icon.jpg', 'icon.ico', 'icon.svg');
    const seen = new Set();
    for (const name of names) {
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const abs = path.join(base, siteId, 'assets', name);
        try {
            if (fs.existsSync(abs) && fs.statSync(abs).size > 600) {
                return `/private/wiki/${siteId}/assets/${name}`;
            }
        } catch (_) { /* skip */ }
    }
    return null;
}

function ensureDocubaseMaterialized(globalResources) {
    if (!globalResources || typeof globalResources.getPath !== 'function') return;
    const cacheDir = globalResources.getPath('cache');
    const indexPath = path.join(cacheDir, 'wiki', naiPromptGuideSync.SITE_ID, 'index.json');
    if (!fs.existsSync(indexPath)) {
        naiPromptGuideSync.materializeDocubaseWiki(cacheDir);
    }
}

function resolveRegisteredSite(globalResources, siteId) {
    if (!siteId || typeof siteId !== 'string') {
        return null;
    }
    ensureDocubaseMaterialized(globalResources);
    if (naiPromptGuideSync.isDocubaseSiteId(siteId)) {
        siteId = naiPromptGuideSync.SITE_ID;
    }
    const base = path.resolve(getWikiBasePath(globalResources));
    const homeIndex = readJsonSafe(path.join(base, 'index.json'), { sites: [] });
    const siteMeta = (homeIndex.sites || []).find((s) => s.id === siteId);
    if (!siteMeta) {
        return null;
    }
    const siteDir = path.resolve(base, siteId);
    if (!siteDir.startsWith(base + path.sep)) {
        return null;
    }
    return { base, siteDir, siteMeta };
}

function getWikiHomeData(globalResources) {
    ensureDocubaseMaterialized(globalResources);
    const base = getWikiBasePath(globalResources);
    const index = readJsonSafe(path.join(base, 'index.json'), { sites: [] });
    const sites = (index.sites || []).map((s) => ({
        id: s.id,
        name: s.name,
        icon: resolveExistingSiteIcon(base, s.id, s.icon),
        kind: s.kind || null
    }));
    return { sites };
}

function getSiteIndex(globalResources, siteId) {
    const site = resolveRegisteredSite(globalResources, siteId);
    if (!site) {
        return null;
    }
    const { siteDir, siteMeta } = site;
    const siteIndex = readJsonSafe(path.join(siteDir, 'index.json'), { pages: [] });
    const pages = siteIndex.pages || [];

    const groupMap = new Map();
    for (const page of pages) {
        const groupName = page.group || 'Other';
        if (!groupMap.has(groupName)) {
            groupMap.set(groupName, []);
        }
        groupMap.get(groupName).push({ id: page.id, title: page.title || page.id });
    }

    let groups = Array.from(groupMap.entries()).map(([name, groupPages]) => ({
        name,
        pages: groupPages
    }));
    if (naiPromptGuideSync.isDocubaseSiteId(siteMeta && siteMeta.id)) {
        groups = naiPromptGuideSync.sortDocubaseGroups(groups);
    }

    return {
        siteId: siteMeta && siteMeta.id ? siteMeta.id : siteId,
        name: siteMeta ? siteMeta.name : siteId,
        icon: resolveExistingSiteIcon(site.base, siteMeta && siteMeta.id, siteMeta && siteMeta.icon),
        kind: siteMeta && siteMeta.kind ? siteMeta.kind : (siteId === 'novelai' ? 'novelai' : null),
        fandomHost: siteMeta && siteMeta.fandomHost ? siteMeta.fandomHost : (siteMeta && siteMeta.kind === 'fandom' ? `${siteId}.fandom.com` : null),
        lang: siteMeta && siteMeta.lang ? siteMeta.lang : null,
        origin: siteMeta && siteMeta.origin ? siteMeta.origin : null,
        articlepath: siteMeta && siteMeta.articlepath ? siteMeta.articlepath : null,
        scriptpath: siteMeta && siteMeta.scriptpath ? siteMeta.scriptpath : null,
        apiBase: siteMeta && siteMeta.apiBase ? siteMeta.apiBase : null,
        groups
    };
}

function normalizePageId(pageId) {
    let id = String(pageId || '').trim();
    try { id = decodeURIComponent(id); } catch (_) { /* keep */ }
    id = id.replace(/\.\./g, '').replace(/^\/+/, '');
    return id;
}

function resolvePageFile(pagesDir, pageId) {
    const candidates = [];
    const normalizedId = normalizePageId(pageId);
    if (!normalizedId) return null;
    candidates.push(normalizedId);
    if (normalizedId.includes(' ')) candidates.push(normalizedId.replace(/ /g, '_'));
    if (normalizedId.includes('_')) candidates.push(normalizedId.replace(/_/g, ' '));
    const seen = new Set();
    for (const id of candidates) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const pagePath = path.resolve(pagesDir, `${id}.html`);
        if (!pagePath.startsWith(pagesDir + path.sep)) continue;
        if (fs.existsSync(pagePath)) return { resolved: pagePath, normalizedId: id };
    }
    return null;
}

function siblingMarkdown(htmlPath) {
    const mdPath = htmlPath.replace(/\.html$/i, '.md');
    try {
        if (fs.existsSync(mdPath)) return fs.readFileSync(mdPath, 'utf8');
    } catch (_) { /* */ }
    return null;
}

function getPageHtml(globalResources, siteId, pageId) {
    if (!siteId || !pageId) {
        return null;
    }

    const site = resolveRegisteredSite(globalResources, siteId);
    if (!site) {
        return null;
    }
    const { siteDir, siteMeta } = site;

    const pagesDir = path.resolve(siteDir, 'pages');
    const found = resolvePageFile(pagesDir, pageId);
    if (!found) {
        return null;
    }
    const { resolved, normalizedId } = found;

    const siteIndex = readJsonSafe(path.join(siteDir, 'index.json'), { pages: [] });
    const pageMeta = (siteIndex.pages || []).find((p) => p.id === normalizedId);
    const resolvedSiteId = siteMeta && siteMeta.id ? siteMeta.id : siteId;
    const siteIcon = resolveExistingSiteIcon(site.base, resolvedSiteId, siteMeta && siteMeta.icon);

    const kind = siteMeta && siteMeta.kind ? siteMeta.kind : (resolvedSiteId === 'novelai' ? 'novelai' : null);
    const displayUrl = kind === 'fandom'
        ? `rdf://wiki.fandom.jp/${resolvedSiteId}/${normalizedId}`
        : (kind === 'novelai' || resolvedSiteId === 'novelai')
            ? `rdf://docs.novelai.jp/${normalizedId}`
            : `edtx://en.grimoire.jp/docs/${resolvedSiteId}/${normalizedId}`;
    const addressMode = (kind === 'fandom' || kind === 'novelai' || resolvedSiteId === 'novelai') ? 'rdf' : 'edtx';
    const text = siblingMarkdown(resolved);

    return {
        siteId: resolvedSiteId,
        pageId: normalizedId,
        title: pageMeta ? (pageMeta.title || normalizedId) : normalizedId,
        html: fs.readFileSync(resolved, 'utf8'),
        text,
        siteIcon,
        kind,
        displayUrl,
        addressMode,
        fandomHost: siteMeta && siteMeta.fandomHost ? siteMeta.fandomHost : null,
        lang: siteMeta && siteMeta.lang ? siteMeta.lang : null,
        origin: siteMeta && siteMeta.origin ? siteMeta.origin : null,
        articlepath: siteMeta && siteMeta.articlepath ? siteMeta.articlepath : null,
        scriptpath: siteMeta && siteMeta.scriptpath ? siteMeta.scriptpath : null,
        apiBase: siteMeta && siteMeta.apiBase ? siteMeta.apiBase : null
    };
}

module.exports = {
    getWikiBasePath,
    getWikiHomeData,
    getSiteIndex,
    getPageHtml
};
