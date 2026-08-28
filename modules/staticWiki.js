const fs = require('fs');
const path = require('path');

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

function resolveRegisteredSite(globalResources, siteId) {
    if (!siteId || typeof siteId !== 'string') {
        return null;
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

    const groups = Array.from(groupMap.entries()).map(([name, groupPages]) => ({
        name,
        pages: groupPages
    }));

    return {
        siteId,
        name: siteMeta ? siteMeta.name : siteId,
        icon: resolveExistingSiteIcon(site.base, siteId, siteMeta && siteMeta.icon),
        kind: siteMeta && siteMeta.kind ? siteMeta.kind : null,
        groups
    };
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

    const normalizedId = String(pageId).replace(/\.\./g, '').replace(/^\/+/, '');
    const pagesDir = path.resolve(siteDir, 'pages');
    const pagePath = path.resolve(pagesDir, `${normalizedId}.html`);
    if (!pagePath.startsWith(pagesDir + path.sep)) {
        return null;
    }
    const resolved = pagePath;

    if (!fs.existsSync(resolved)) {
        return null;
    }

    const siteIndex = readJsonSafe(path.join(siteDir, 'index.json'), { pages: [] });
    const pageMeta = (siteIndex.pages || []).find((p) => p.id === normalizedId);
    const siteIcon = resolveExistingSiteIcon(site.base, siteId, siteMeta && siteMeta.icon);

    const kind = siteMeta && siteMeta.kind ? siteMeta.kind : null;
    const displayUrl = kind === 'fandom'
        ? `rdf://wiki.fandom.jp/${siteId}/${normalizedId}`
        : null;

    return {
        siteId,
        pageId: normalizedId,
        title: pageMeta ? (pageMeta.title || normalizedId) : normalizedId,
        html: fs.readFileSync(resolved, 'utf8'),
        siteIcon,
        kind,
        displayUrl,
        addressMode: kind === 'fandom' ? 'rdf' : null
    };
}

module.exports = {
    getWikiBasePath,
    getWikiHomeData,
    getSiteIndex,
    getPageHtml
};
