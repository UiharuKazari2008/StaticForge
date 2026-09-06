'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Apocrypha public zine: generated views under /{apocryphaPathUuid}.
 * Public hostname apocrypha.737.jp.net proxies here (UUID stays unlisted).
 * Underground hacker zine interior only — no window chrome.
 * Anonymous: public teaser only. Authenticated: Enshutsuka memories visible.
 * Reads data/apocrypha/current.json for issueLabel, webapp, kicker, counts, etc.
 */

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function formatBodyText(text) {
    if (typeof text !== 'string') return '';
    // Split by triple backticks first, then single backticks
    return text.split(/```/).map((block, i) => {
        if (i % 2 === 1) return '<div class="code-block">' + escapeHtml(block) + '</div>';
        return block.split(/`/).map((inline, j) => {
            if (j % 2 === 1) return '<span class="code-inline">' + escapeHtml(inline) + '</span>';
            return escapeHtml(inline).replace(/\n/g, '<br>');
        }).join('');
    }).join('');
}

function getApocryphaFilePath() {
    return path.join(process.cwd(), 'data/apocrypha/current.json');
}

function getApocryphaArchiveDir() {
    return path.join(process.cwd(), 'data/apocrypha/archive');
}

function safeIssueSlug(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function issueDateFromData(data) {
    const dateMatch = String((data && data.kicker) || '').match(/(\d{4}-\d{2}-\d{2})/);
    return dateMatch ? dateMatch[1] : '';
}

function issueSlugFromData(data) {
    const label = safeIssueSlug(data && data.issueLabel) || 'issue';
    const date = issueDateFromData(data);
    return date ? label + '-' + date : label;
}

function shouldArchiveLiveIssue(live, input) {
    if (!live || typeof live !== 'object') return false;
    const incomingLabel = typeof input.issueLabel === 'string' ? input.issueLabel.trim() : '';
    const liveLabel = live.issueLabel ? String(live.issueLabel).trim() : '';
    if (incomingLabel && liveLabel && incomingLabel !== liveLabel) return true;
    const incomingDate = issueDateFromData(input);
    const liveDate = issueDateFromData(live);
    return !!(incomingDate && liveDate && incomingDate !== liveDate);
}

function loadArchivedIssue(slug) {
    const safe = safeIssueSlug(slug);
    if (!safe) return null;
    const archiveDir = getApocryphaArchiveDir();
    const filePath = path.join(archiveDir, safe + '.json');
    if (!filePath.startsWith(archiveDir + path.sep)) return null;
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error('[apocrypha] failed to read archive', safe, e.message);
        return null;
    }
}

function listArchivedIssues() {
    const archiveDir = getApocryphaArchiveDir();
    if (!fs.existsSync(archiveDir)) return [];
    const rows = [];
    for (const name of fs.readdirSync(archiveDir)) {
        if (!name.endsWith('.json')) continue;
        const slug = name.slice(0, -5);
        const data = loadArchivedIssue(slug);
        if (!data) continue;
        rows.push({
            slug: safeIssueSlug(slug),
            issueLabel: data.issueLabel || slug,
            kicker: data.kicker || null
        });
    }
    rows.sort((a, b) => String(b.kicker || b.slug).localeCompare(String(a.kicker || a.slug)));
    return rows;
}

function archiveLiveIssue(live) {
    if (!live || typeof live !== 'object') return null;
    const archiveDir = getApocryphaArchiveDir();
    if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
    }
    let slug = issueSlugFromData(live);
    let n = 2;
    while (fs.existsSync(path.join(archiveDir, slug + '.json'))) {
        slug = issueSlugFromData(live) + '-' + n;
        n += 1;
    }
    const filePath = path.join(archiveDir, slug + '.json');
    fs.writeFileSync(filePath, JSON.stringify(live, null, 2), 'utf8');
    return slug;
}

function getApocryphaData() {
    try {
        const filePath = getApocryphaFilePath();
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('[apocrypha] failed to read/parse current.json:', e.message);
    }
    return null;
}

function writeApocryphaData(data) {
    const filePath = getApocryphaFilePath();
    const dir = path.dirname(filePath);
    const tmpPath = path.join(dir, 'current.tmp.json');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
}

function sectionIdOf(sec) {
    return sec && typeof sec === 'object' ? String(sec.id || '').trim() : '';
}

function collectIncomingSections(input) {
    if (!input || typeof input !== 'object') return [];
    if (Array.isArray(input.sections) && input.sections.length) {
        return input.sections.filter((sec) => sec && typeof sec === 'object');
    }
    if (input.article && typeof input.article === 'object') return [input.article];
    if (input.section && typeof input.section === 'object') return [input.section];
    if (input.id || input.body || (input.title && input.lede)) {
        return [input];
    }
    return [];
}

function appendUniqueBySrc(live, key, items) {
    if (!Array.isArray(items) || !items.length) return;
    if (!Array.isArray(live[key])) live[key] = [];
    const have = new Set(live[key].map((item) => item && item.src).filter(Boolean));
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (item.src && have.has(item.src)) continue;
        live[key].push(item);
        if (item.src) have.add(item.src);
    }
}

function appendEnshutsuka(live, items) {
    if (!Array.isArray(items) || !items.length) return;
    if (!Array.isArray(live.enshutsuka)) live.enshutsuka = [];
    const have = new Set(live.enshutsuka.map((item) => String((item && item.body) || (item && item.teaser) || '')));
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const key = String(item.body || item.teaser || '');
        if (key && have.has(key)) continue;
        live.enshutsuka.push(item);
        if (key) have.add(key);
    }
}

function mergeIssueMeta(live, input) {
    const keys = ['issueLabel', 'webapp', 'kicker', 'lede', 'title', 'rundown', 'official', 'unofficial', 'imagesNote'];
    for (const key of keys) {
        if (typeof input[key] !== 'string' || !input[key]) continue;
        if (!live[key]) live[key] = input[key];
    }
    if (input.counts && typeof input.counts === 'object' && !Array.isArray(input.counts)) {
        live.counts = Object.assign({}, live.counts || {}, input.counts);
    }
    appendUniqueBySrc(live, 'billboard', input.billboard);
    appendUniqueBySrc(live, 'images', input.images);
    appendUniqueBySrc(live, 'grimImages', input.grimImages);
    appendEnshutsuka(live, input.enshutsuka);
}

function publishApocrypha(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { success: false, error: 'payload must be a JSON object' };
    }
    const replace = input.replace === true;
    const incoming = collectIncomingSections(input);
    const issueShaped = !!(input.issueLabel || input.rundown || input.billboard || input.counts || input.official || Array.isArray(input.sections));
    if (!incoming.length && !issueShaped) {
        return { success: false, error: 'pass a new article (id + title/body) or sections[]' };
    }

    let live = getApocryphaData() || {};
    let archived = null;
    if (shouldArchiveLiveIssue(live, input)) {
        archived = archiveLiveIssue(live);
        live = { sections: [] };
    }
    if (!Array.isArray(live.sections)) live.sections = [];
    if (issueShaped) mergeIssueMeta(live, input);

    const added = [];
    const replaced = [];
    const skipped = [];
    for (const sec of incoming) {
        const id = sectionIdOf(sec);
        if (!id) {
            skipped.push({ error: 'section id is required' });
            continue;
        }
        const idx = live.sections.findIndex((row) => sectionIdOf(row) === id);
        const article = Object.assign({}, sec);
        delete article.replace;
        delete article.article;
        delete article.section;
        delete article.sections;
        delete article.issueLabel;
        delete article.webapp;
        delete article.rundown;
        delete article.counts;
        delete article.official;
        delete article.unofficial;
        delete article.billboard;
        delete article.imagesNote;
        delete article.enshutsuka;
        delete article.grimImages;
        if (idx === -1) {
            live.sections.push(article);
            added.push(id);
        } else if (replace) {
            live.sections[idx] = article;
            replaced.push(id);
        } else {
            skipped.push({
                id,
                error: 'already live; call revoke_apocrypha or pass replace:true'
            });
        }
    }

    writeApocryphaData(live);
    return {
        success: true,
        issueLabel: live.issueLabel || null,
        added,
        replaced,
        skipped,
        archived,
        sectionIds: live.sections.map(sectionIdOf).filter(Boolean)
    };
}

function revokeApocryphaSection(input) {
    const id = String((input && (input.id || input.sectionId)) || '').trim();
    if (!id) {
        return { success: false, error: 'id is required' };
    }
    const live = getApocryphaData();
    if (!live || !Array.isArray(live.sections)) {
        return { success: false, error: 'no live issue' };
    }
    const next = live.sections.filter((row) => sectionIdOf(row) !== id);
    if (next.length === live.sections.length) {
        return { success: false, error: 'section not found: ' + id, sectionIds: live.sections.map(sectionIdOf).filter(Boolean) };
    }
    live.sections = next;
    writeApocryphaData(live);
    return {
        success: true,
        revoked: id,
        issueLabel: live.issueLabel || null,
        sectionIds: live.sections.map(sectionIdOf).filter(Boolean)
    };
}

function summarizeSections(data) {
    const sections = data && Array.isArray(data.sections) ? data.sections : [];
    return sections.map((sec) => ({
        id: sectionIdOf(sec) || null,
        kicker: sec && sec.kicker ? sec.kicker : null,
        title: sec && sec.title ? sec.title : null,
        grim: !!(sec && sec.grim === true)
    }));
}

function listApocrypha(input) {
    const slug = String((input && (input.slug || input.issue || input.archive)) || '').trim();
    const archives = listArchivedIssues();
    if (slug) {
        const data = loadArchivedIssue(slug);
        if (!data) {
            return { success: false, error: 'archive not found: ' + slug, archives };
        }
        return {
            success: true,
            slug: safeIssueSlug(slug),
            current: false,
            issueLabel: data.issueLabel || null,
            kicker: data.kicker || null,
            sections: summarizeSections(data),
            archives
        };
    }
    const live = getApocryphaData();
    if (!live) {
        return { success: true, current: true, issueLabel: null, sections: [], archives };
    }
    return {
        success: true,
        current: true,
        issueLabel: live.issueLabel || null,
        kicker: live.kicker || null,
        sections: summarizeSections(live),
        archives
    };
}

function renderPreviousDaysNav(viewingSlug) {
    const archives = listArchivedIssues();
    const liveHref = 'https://apocrypha.737.jp.net/';
    let html = '<div class="sidebar-url"><span class="sidebar-url-label">PREVIOUS DAYS</span>';
    html += '<a href="' + liveHref + '">' + (viewingSlug ? 'live issue' : 'live (this issue)') + '</a>';
    if (!archives.length) {
        html += '<div class="sidebar-text">earlier MWF issues land here after the next day publishes</div>';
    }
    for (const item of archives) {
        const href = liveHref + 'archive/' + encodeURIComponent(item.slug);
        const here = viewingSlug && item.slug === viewingSlug;
        const label = (item.issueLabel || item.slug) + (here ? ' (this issue)' : '');
        html += '<br><a href="' + href + '">' + escapeHtml(label) + '</a>';
        if (item.kicker) {
            html += '<div class="sidebar-text">' + escapeHtml(item.kicker) + '</div>';
        }
    }
    html += '</div>';
    return html;
}

function isHttpSrc(value) {
    return typeof value === 'string' && value.startsWith('http');
}

function renderImageItem(img) {
    if (!img || !isHttpSrc(img.src)) return '';
    const kickerHtml = img.kicker
        ? '<div class="tile-kicker">' + escapeHtml(img.kicker) + '</div>'
        : '';
    const capHtml = img.cap
        ? '<div class="tile-meta">' + escapeHtml(img.cap) + '</div>'
        : '';
    return '<div class="image-item">' +
        '<img referrerpolicy="no-referrer" src="' + escapeHtml(img.src) + '" alt="' + escapeHtml(img.cap || '') + '">' +
        kickerHtml +
        capHtml +
        '</div>';
}

function renderImageGrid(images) {
    if (!Array.isArray(images) || images.length === 0) return '';
    const items = images.map(renderImageItem).filter(Boolean).join('\n');
    if (!items) return '';
    return '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">' + items + '</div>';
}

function renderExcerpts(excerpts) {
    if (!Array.isArray(excerpts) || excerpts.length === 0) return '';
    return excerpts.map((ex) => {
        if (!ex || typeof ex !== 'object') return '';
        const who = [ex.speaker, ex.channel, ex.when].filter(Boolean).join(' · ');
        const meta = who ? '<div class="tile-meta">' + escapeHtml(who) + '</div>' : '';
        const text = ex.text ? escapeHtml(ex.text).replace(/\n/g, '<br>') : '';
        if (!text && !meta) return '';
        return '<blockquote class="split-text">' + text + meta + '</blockquote>';
    }).join('\n');
}

function renderTryThis(tryThis) {
    if (!tryThis || typeof tryThis !== 'object') return '';
    let html = '<div class="try-this-card">';
    html += '<div class="try-this-header">TRY THIS</div>';
    html += '<div class="try-this-body">';
    const rows = [
        { label: 'Settings', val: tryThis.settings },
        { label: tryThis.promptA && tryThis.promptB ? 'Prompt A' : 'Prompt', val: tryThis.promptA || tryThis.prompt },
        { label: 'Prompt B', val: tryThis.promptB },
        { label: 'Look for', val: tryThis.lookFor }
    ];
    for (const r of rows) {
        if (!r.val) continue;
        html += '<div class="try-this-row"><span class="try-this-label">' + escapeHtml(r.label) + ':</span><div class="try-this-prompt">' + formatBodyText(r.val) + '</div></div>';
    }
    html += '</div></div>';
    return html;
}

function renderSectionArticle(sec) {
    if (!sec || typeof sec !== 'object') return '';
    const kicker = sec.kicker ? '<span class="article-kicker">' + escapeHtml(sec.kicker) + '</span>' : '';
    const title = sec.title ? '<h2 class="article-title">' + escapeHtml(sec.title) + '</h2>' : '';
    const lede = sec.lede ? '<p class="split-text">' + formatBodyText(sec.lede) + '</p>' : '';
    const body = sec.body ? '<p class="split-text" style="white-space: pre-wrap; word-break: break-word;">' + formatBodyText(sec.body) + '</p>' : '';
    return '<div class="article">' +
        kicker + title + lede + body +
        renderTryThis(sec.tryThis) +
        renderExcerpts(sec.excerpts) +
        renderImageGrid(sec.images) +
        '</div>';
}

function renderApocrypha({ title, isGrimoire, issueSlug }) {
    const viewingSlug = issueSlug ? safeIssueSlug(issueSlug) : '';
    const data = (viewingSlug ? loadArchivedIssue(viewingSlug) : getApocryphaData()) || {};
    const previousDaysHtml = renderPreviousDaysNav(viewingSlug);

    const issueLabelStr = data.issueLabel ? escapeHtml(data.issueLabel) : 'MONDAY DIGEST';
    const kickerStr = data.kicker ? escapeHtml(data.kicker) : '';
    const ledeStr = data.lede ? escapeHtml(data.lede) : '';
    const articleTitleStr = data.title ? escapeHtml(data.title) : 'Counts, version, official vs unofficial';
    const rundownStr = data.rundown ? '<p class="split-text" style="color: #d7ff9a; margin-bottom: 12px;">' + escapeHtml(data.rundown) + '</p>' : '';

    const counts = data.counts || {};
    const officialCount = counts.official !== undefined ? escapeHtml(String(counts.official)) : '—';
    const unofficialCount = counts.unofficial !== undefined ? escapeHtml(String(counts.unofficial)) : '—';
    const enshutsukaCount = counts.enshutsuka !== undefined ? escapeHtml(String(counts.enshutsuka)) : '—';
    const defaultModel = counts.defaultModel ? escapeHtml(counts.defaultModel) : 'V5';

    const officialText = data.official ? escapeHtml(data.official) : 'staff: V5 hip weights still unsolved. Quality Tags on. No-text off for signs.';
    const unofficialText = data.unofficial ? escapeHtml(data.unofficial) : 'community: 1–2 unweighted artists. Contrast over magnitude.';
    const imagesNoteStr = data.imagesNote ? escapeHtml(data.imagesNote) : 'Awaiting Hoshino MWF posts.';

    let enshutsukaHtml = '';
    if (data.enshutsuka && Array.isArray(data.enshutsuka) && data.enshutsuka.length > 0) {
        if (isGrimoire) {
            enshutsukaHtml = data.enshutsuka.map(item => '<p>' + escapeHtml(item.body || '') + '</p>').join('');
        } else {
            enshutsukaHtml = data.enshutsuka.map(item => '<div class="wrap-public-teaser">' + escapeHtml(item.teaser || '') + '</div>').join('');
        }
    } else {
        if (isGrimoire) {
            enshutsukaHtml = '<p>Enshutsuka memory bodies visible</p>';
        } else {
            enshutsukaHtml = '<div class="wrap-public-teaser">Teaser: Enshutsuka memories exist. Bodies stay in Grim after session.</div>';
        }
    }

    let billboardHtml = '';
    if (data.billboard && Array.isArray(data.billboard) && data.billboard.length > 0) {
        billboardHtml = data.billboard.map(item => {
            const isHero = item.kind === 'hero' ? ' hero' : '';
            const imgHtml = (item.src && typeof item.src === 'string' && item.src.startsWith('http'))
                ? '<img referrerpolicy="no-referrer" src="' + escapeHtml(item.src) + '" alt="' + escapeHtml(item.cap || '') + '" style="max-width: 100%; height: auto; margin-top: 8px; display: block; border: 1px solid #333;">'
                : '';
            const metaHtml = item.cap ? '<div class="tile-meta" style="margin-top: 8px; font-size: 9px; color: #999;">' + escapeHtml(item.cap) + '</div>' : '';
            return '<div class="tile' + isHero + '">\n' +
                   '    <span class="tile-kicker">' + escapeHtml(item.kicker || '') + '</span>\n' +
                   '    <div class="tile-title">' + escapeHtml(item.title || '—') + '</div>\n' +
                   '    ' + imgHtml + '\n' +
                   '    ' + metaHtml + '\n' +
                   '</div>';
        }).join('\n');
    } else {
        billboardHtml = `<div class="tile hero">
                    <span class="tile-kicker">BILLBOARD · image of the day</span>
                    <div class="tile-title">—</div>
                    <div class="tile-meta"></div>
                </div>
                <div class="tile">
                    <span class="tile-kicker">IOD · 2</span>
                    <div class="tile-title">—</div>
                </div>`;
    }

    const imagesGridHtml = renderImageGrid(data.images);
    const sections = Array.isArray(data.sections) ? data.sections : [];
    const publicSectionsHtml = sections.filter((sec) => sec && sec.grim !== true).map(renderSectionArticle).join('\n');
    const grimSectionsHtml = isGrimoire
        ? sections.filter((sec) => sec && sec.grim === true).map(renderSectionArticle).join('\n')
        : '';
    let grimImagesHtml = '';
    if (isGrimoire && Array.isArray(data.grimImages) && data.grimImages.length > 0) {
        const grimGrid = renderImageGrid(data.grimImages);
        if (grimGrid) {
            grimImagesHtml = '<div class="images"><span class="images-kicker">UNOFFICIAL / SPICY KEEPERS</span>' + grimGrid + '</div>';
        }
    }

    const grimContent = isGrimoire ? `
            <div class="grim-wrapper">
                <div class="grim-header">GRIM / LOGGED-IN</div>
                <div class="enshutsuka-memories">
                    ${enshutsukaHtml}
                </div>
                ${grimSectionsHtml}
                ${grimImagesHtml}
            </div>` : `
            <div class="wrap-public">
                <div class="wrap-public-header">GRIM / LOGIN WRAPPER · omitted from public</div>
                ${enshutsukaHtml}
            </div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body>
<main>
<style>
/* Zine interior — Chiyo ecf82040 */
@import url('https://fonts.googleapis.com/css2?family=DotGothic16&family=Grenze:wght@400;700&family=Oxanium:wght@400;700&family=Share+Tech+Mono&display=swap');

html, body {
    margin: 0;
    padding: 0;
    min-height: 100vh;
    background: #0d0d0d;
}

.zine {
    background: #0d0d0d;
    color: #d7ff9a;
    font-family: 'Share Tech Mono', 'DotGothic16', monospace;
    font-size: 12px;
    line-height: 1.4;
    padding: 16px;
    min-height: 100vh;
    max-width: 1024px;
    margin: 0 auto;
    box-sizing: border-box;
}

.mast {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid #333;
}

.mast-left {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.mast-title {
    font-family: 'Grenze', serif;
    font-size: 48px;
    font-weight: 400;
    letter-spacing: 0.08em;
    color: #d7ff9a;
    margin: 0;
    line-height: 1;
}

.stamp {
    display: inline-block;
    background: #e11;
    color: #fff;
    font-family: 'Oxanium', sans-serif;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 2px 6px;
    transform: rotate(-2deg);
    box-shadow: 1px 1px 2px rgba(0,0,0,0.5);
}

.mast-right {
    text-align: right;
    font-size: 10px;
    color: #ffcc66;
}

.mast-right a {
    color: #ffcc66;
    text-decoration: none;
}

.mast-right a:hover {
    text-decoration: underline;
}

.billboard {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: 8px;
    margin-bottom: 16px;
}

.tile {
    border: 1px solid #2a5a2a;
    padding: 8px;
    background: #0a1a0a;
    min-height: 100px;
}

.tile.hero {
    grid-row: span 2;
}

.tile-kicker {
    font-size: 9px;
    color: #e11;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 4px;
}

.tile-title {
    font-size: 11px;
    color: #d7ff9a;
    margin-bottom: 4px;
}

.tile-meta {
    font-size: 9px;
    color: #666;
}

.ad-tile {
    border: 1px dashed #665500;
    padding: 8px;
    background: transparent;
    min-height: 60px;
}

.ad-kicker {
    font-size: 8px;
    color: #665500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 2px;
}

.ad-title {
    font-size: 10px;
    color: #ffcc66;
    margin-bottom: 2px;
}

.ad-tagline {
    font-size: 9px;
    color: #666;
    font-style: italic;
}

.content {
    display: grid;
    grid-template-columns: 1fr 200px;
    gap: 16px;
}

.main-col {
    min-width: 0;
}

.sidebar {
    min-width: 0;
}

.article {
    border: 1px solid #2a5a2a;
    padding: 12px;
    margin-bottom: 12px;
    background: #0a1a0a;
}

.article-kicker {
    font-size: 9px;
    color: #d7ff9a;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
    opacity: 0.7;
}

.article-title {
    font-size: 14px;
    font-weight: bold;
    color: #d7ff9a;
    margin: 0 0 12px 0;
}

.stats-grid {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
}

.stat-box {
    border: 1px solid #333;
    padding: 8px 12px;
    text-align: center;
    min-width: 60px;
}

.stat-value {
    font-size: 20px;
    font-weight: bold;
    color: #d7ff9a;
    display: block;
}

.stat-label {
    font-size: 9px;
    color: #666;
    text-transform: lowercase;
}

.split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 12px;
}

.split-col {
    padding: 8px;
    border-left: 2px solid;
}

.split-col.official {
    border-color: #2a5a2a;
}

.split-col.unofficial {
    border-color: #665500;
}

.split-title {
    font-size: 18px;
    font-weight: bold;
    text-transform: lowercase;
    margin-bottom: 6px;
    color: #d7ff9a;
}

.split-text {
    font-size: 16px;
    color: #999;
    line-height: 2;
}

.wrap-public {
    border: 2px dashed #e11;
    padding: 12px;
    margin: 12px 0;
    background: rgba(225, 17, 17, 0.05);
}

.wrap-public-header {
    font-size: 9px;
    color: #e11;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
}

.wrap-public-teaser {
    font-size: 11px;
    color: #999;
    line-height: 1.5;
}

.grim-wrapper {
    border: 1px solid #2a5a2a;
    padding: 12px;
    margin: 12px 0;
    background: #0a1a0a;
}

.grim-header {
    font-size: 9px;
    color: #2a5a2a;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
}

.grim-header::before {
    content: '●';
    color: #4a4;
}

.enshutsuka-memories {
    font-size: 16px;
    color: #d7ff9a;
    line-height: 1.6;
}

.enshutsuka-memories p {
    margin: 0 0 8px 0;
}

.sidebar-box {
    border: 1px dashed #665500;
    padding: 10px;
    margin-bottom: 12px;
}

.sidebar-kicker {
    font-size: 8px;
    color: #665500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
}

.sidebar-title {
    font-size: 11px;
    color: #ffcc66;
    margin-bottom: 4px;
    font-weight: bold;
}

.sidebar-text {
    font-size: 9px;
    color: #666;
    font-style: italic;
}

.sidebar-url {
    border: 1px solid #333;
    padding: 10px;
    margin-bottom: 12px;
}

.sidebar-url-label {
    font-size: 8px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
}

.sidebar-url a {
    font-size: 10px;
    color: #d7ff9a;
    text-decoration: none;
    word-break: break-all;
}

.sidebar-url a:hover {
    text-decoration: underline;
}

.images {
    border: 1px solid #333;
    padding: 12px;
    margin-top: 16px;
}

.images-kicker {
    font-size: 9px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
}

.images-title {
    font-size: 14px;
    font-weight: bold;
    color: #d7ff9a;
    margin: 0 0 8px 0;
}

.images-note {
    font-size: 10px;
    color: #999;
    line-height: 1.5;
}

.image-item img {
    width: 100%;
    height: auto;
    border: 1px solid #333;
    display: block;
}

.apocrypha-interior .try-this-card { border: 1px solid #ffcc66; margin: 12px 0; background: rgba(102, 85, 0, 0.05); }
.apocrypha-interior .try-this-header { background: #665500; color: #fff; padding: 4px 8px; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.1em; }
.apocrypha-interior .try-this-body { padding: 12px; }
.apocrypha-interior .try-this-row { margin-bottom: 8px; }
.apocrypha-interior .try-this-row:last-child { margin-bottom: 0; }
.apocrypha-interior .try-this-label { font-size: 9px; color: #ffcc66; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 2px; }
.apocrypha-interior .try-this-text { font-size: 14px; color: #d7ff9a; line-height: 1.5; }
.apocrypha-interior .try-this-prompt { font-family: "Share Tech Mono", "DotGothic16", monospace; font-size: 12px; color: #fff; background: #111; padding: 6px; border: 1px solid #333; display: block; white-space: pre-wrap; word-break: break-word; }
.apocrypha-interior .code-inline { background: rgba(255, 255, 255, 0.1); padding: 0 4px; border-radius: 2px; color: #fff; font-family: monospace; }
.apocrypha-interior .code-block { background: #111; padding: 8px; border: 1px solid #333; display: block; white-space: pre-wrap; word-break: break-word; font-family: monospace; margin: 8px 0; color: #fff; }

.article blockquote {
    margin: 8px 0;
    padding: 8px 8px 8px 12px;
    border-left: 2px solid #2a5a2a;
    color: #999;
}

.article blockquote .tile-meta {
    margin-top: 4px;
}

.footer {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid #333;
    font-size: 9px;
    color: #666;
}

.footer a {
    color: #d7ff9a;
    text-decoration: none;
}

.footer a:hover {
    text-decoration: underline;
}

@media (max-width: 768px) {
    .zine {
        padding: 12px;
    }
    
    .billboard {
        grid-template-columns: 1fr 1fr;
    }
    
    .tile.hero {
        grid-column: span 2;
        grid-row: span 1;
    }
    
    .content {
        grid-template-columns: 1fr;
    }
    
    .sidebar {
        order: -1;
    }
    
    .mast {
        flex-direction: column;
        gap: 12px;
    }
    
    .mast-right {
        text-align: left;
    }
    
    .mast-title {
        font-size: 32px;
    }
}
</style>
        <div class="zine">
            <!-- Masthead -->
            <header class="mast">
                <div class="mast-left">
                    <h1 class="mast-title">APOCRYPHA</h1>
                    <span class="stamp">UNOFFICIAL PRESS</span>
                </div>
                <div class="mast-right">
                    ${issueLabelStr}${ledeStr ? '<br><span style="font-size: 9px; color: #999;">' + ledeStr + '</span>' : ''}<br>
                    ${kickerStr}
                </div>
            </header>

            <!-- Billboard Grid -->
            <section class="billboard">
                ${billboardHtml}
                <div class="ad-tile">
                    <span class="ad-kicker">AD · ATELIER</span>
                    <div class="ad-title">NAX faces on the cheap</div>
                </div>
                <div class="ad-tile">
                    <span class="ad-kicker">AD · ZANZOU</span>
                    <div class="ad-title">keep the shot, scrap the ghosts</div>
                </div>
            </section>

            <!-- Main Content -->
            <div class="content">
                <article class="main-col">
                    <div class="article">
                        <span class="article-kicker">${kickerStr || 'MONDAY · WEBAPP'}</span>
                        <h2 class="article-title">${articleTitleStr}</h2>
                        ${rundownStr}
                        <div class="stats-grid">
                            <div class="stat-box">
                                <span class="stat-value">${officialCount}</span>
                                <span class="stat-label">official</span>
                            </div>
                            <div class="stat-box">
                                <span class="stat-value">${unofficialCount}</span>
                                <span class="stat-label">unofficial</span>
                            </div>
                            <div class="stat-box">
                                <span class="stat-value">${enshutsukaCount}</span>
                                <span class="stat-label">Enshutsuka</span>
                            </div>
                            <div class="stat-box">
                                <span class="stat-value">${defaultModel}</span>
                                <span class="stat-label">default</span>
                            </div>
                        </div>

                        <div class="split">
                            <div class="split-col official">
                                <div class="split-title">official</div>
                                <div class="split-text">${officialText}</div>
                            </div>
                            <div class="split-col unofficial">
                                <div class="split-title">unofficial</div>
                                <div class="split-text">${unofficialText}</div>
                            </div>
                        </div>

                        ${grimContent}
                    </div>

                    ${publicSectionsHtml}

                    <div class="images">
                        <span class="images-kicker">IMAGES</span>
                        <h3 class="images-title">Day sheet</h3>
                        <p class="images-note">${imagesNoteStr}</p>
                        ${imagesGridHtml}
                    </div>
                </article>

                <!-- Sidebar -->
                <aside class="sidebar">
                    <div class="sidebar-box">
                        <span class="sidebar-kicker">FAKE AD</span>
                        <div class="sidebar-title">Grimoire encyclopedia</div>
                        <div class="sidebar-text">look it up before you invent a tag</div>
                    </div>

                    <div class="sidebar-box">
                        <span class="sidebar-kicker">FAKE AD</span>
                        <div class="sidebar-title">Enshutsuka remembers</div>
                        <div class="sidebar-text">save_memory or it never happened</div>
                    </div>

                    <div class="sidebar-url">
                        <span class="sidebar-url-label">PUBLIC URL</span>
                        <a href="https://apocrypha.737.jp.net/">apocrypha.737.jp.net</a>
                    </div>
                    ${previousDaysHtml}
                </aside>
            </div>

            <!-- Footer -->
            <footer class="footer">
                Public: <a href="https://apocrypha.737.jp.net/">https://apocrypha.737.jp.net/</a> · 
                Grim-only blocks use the red wrapper.
            </footer>
        </div>
</main>
</body>
</html>`;
}

function getApocryphaInteriorCss() {
    return `
@import url('https://fonts.googleapis.com/css2?family=DotGothic16&family=Grenze:wght@400;700&family=Oxanium:wght@400;700&family=Share+Tech+Mono&display=swap');
.apocrypha-interior { background: #0d0d0d; overflow: auto; max-height: 100%; }
.apocrypha-interior .zine { background: #0d0d0d; color: #d7ff9a; font-family: 'Share Tech Mono', 'DotGothic16', monospace; font-size: 12px; line-height: 1.4; padding: 16px; max-width: 1024px; margin: 0 auto; box-sizing: border-box; }
.apocrypha-interior .mast { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #333; }
.apocrypha-interior .mast-left { display: flex; flex-direction: column; gap: 4px; }
.apocrypha-interior .mast-title { font-family: 'Grenze', serif; font-size: 48px; font-weight: 400; letter-spacing: 0.08em; color: #d7ff9a; margin: 0; line-height: 1; }
.apocrypha-interior .stamp { display: inline-block; background: #e11; color: #fff; font-family: 'Oxanium', sans-serif; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 2px 6px; transform: rotate(-2deg); box-shadow: 1px 1px 2px rgba(0,0,0,0.5); }
.apocrypha-interior .mast-right { text-align: right; font-size: 10px; color: #ffcc66; }
.apocrypha-interior .mast-right a { color: #ffcc66; text-decoration: none; }
.apocrypha-interior .mast-right a:hover { text-decoration: underline; }
.apocrypha-interior .billboard { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
.apocrypha-interior .tile { border: 1px solid #2a5a2a; padding: 8px; background: #0a1a0a; min-height: 100px; }
.apocrypha-interior .tile.hero { grid-row: span 2; }
.apocrypha-interior .tile-kicker { font-size: 9px; color: #e11; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
.apocrypha-interior .tile-title { font-size: 11px; color: #d7ff9a; margin-bottom: 4px; }
.apocrypha-interior .tile-meta { font-size: 9px; color: #666; }
.apocrypha-interior .ad-tile { border: 1px dashed #665500; padding: 8px; background: transparent; min-height: 60px; }
.apocrypha-interior .ad-kicker { font-size: 8px; color: #665500; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
.apocrypha-interior .ad-title { font-size: 10px; color: #ffcc66; margin-bottom: 2px; }
.apocrypha-interior .ad-tagline { font-size: 9px; color: #666; font-style: italic; }
.apocrypha-interior .content { display: grid; grid-template-columns: 1fr 200px; gap: 16px; }
.apocrypha-interior .main-col { min-width: 0; }
.apocrypha-interior .sidebar { min-width: 0; }
.apocrypha-interior .article { border: 1px solid #2a5a2a; padding: 12px; margin-bottom: 12px; background: #0a1a0a; }
.apocrypha-interior .article-kicker { font-size: 9px; color: #d7ff9a; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; opacity: 0.7; }
.apocrypha-interior .article-title { font-size: 14px; font-weight: bold; color: #d7ff9a; margin: 0 0 12px 0; }
.apocrypha-interior .stats-grid { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.apocrypha-interior .stat-box { border: 1px solid #333; padding: 8px 12px; text-align: center; min-width: 60px; }
.apocrypha-interior .stat-value { font-size: 20px; font-weight: bold; color: #d7ff9a; display: block; }
.apocrypha-interior .stat-label { font-size: 9px; color: #666; text-transform: lowercase; }
.apocrypha-interior .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.apocrypha-interior .split-col { padding: 8px; border-left: 2px solid; }
.apocrypha-interior .split-col.official { border-color: #2a5a2a; }
.apocrypha-interior .split-col.unofficial { border-color: #665500; }
.apocrypha-interior .split-title { font-size: 18px; font-weight: bold; text-transform: lowercase; margin-bottom: 6px; color: #d7ff9a; }
.apocrypha-interior .split-text { font-size: 16px; color: #999; line-height: 2; }
.apocrypha-interior .wrap-public { border: 2px dashed #e11; padding: 12px; margin: 12px 0; background: rgba(225, 17, 17, 0.05); }
.apocrypha-interior .wrap-public-header { font-size: 9px; color: #e11; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
.apocrypha-interior .wrap-public-teaser { font-size: 11px; color: #999; line-height: 1.5; }
.apocrypha-interior .grim-wrapper { border: 1px solid #2a5a2a; padding: 12px; margin: 12px 0; background: #0a1a0a; }
.apocrypha-interior .grim-header { font-size: 9px; color: #2a5a2a; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.apocrypha-interior .grim-header::before { content: '●'; color: #4a4; }
.apocrypha-interior .enshutsuka-memories { font-size: 16px; color: #d7ff9a; line-height: 1.6; }
.apocrypha-interior .enshutsuka-memories p { margin: 0 0 8px 0; }
.apocrypha-interior .sidebar-box { border: 1px dashed #665500; padding: 10px; margin-bottom: 12px; }
.apocrypha-interior .sidebar-kicker { font-size: 8px; color: #665500; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.apocrypha-interior .sidebar-title { font-size: 11px; color: #ffcc66; margin-bottom: 4px; font-weight: bold; }
.apocrypha-interior .sidebar-text { font-size: 9px; color: #666; font-style: italic; }
.apocrypha-interior .sidebar-url { border: 1px solid #333; padding: 10px; margin-bottom: 12px; }
.apocrypha-interior .sidebar-url-label { font-size: 8px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.apocrypha-interior .sidebar-url a { font-size: 10px; color: #d7ff9a; text-decoration: none; word-break: break-all; }
.apocrypha-interior .sidebar-url a:hover { text-decoration: underline; }
.apocrypha-interior .images { border: 1px solid #333; padding: 12px; margin-top: 16px; }
.apocrypha-interior .images-kicker { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
.apocrypha-interior .images-title { font-size: 14px; font-weight: bold; color: #d7ff9a; margin: 0 0 8px 0; }
.apocrypha-interior .images-note { font-size: 10px; color: #999; line-height: 1.5; }
.apocrypha-interior .image-item img { width: 100%; height: auto; border: 1px solid #333; display: block; }
.apocrypha-interior .try-this-card { border: 1px solid #ffcc66; margin: 12px 0; background: rgba(102, 85, 0, 0.05); }
.apocrypha-interior .try-this-header { background: #665500; color: #fff; padding: 4px 8px; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.1em; }
.apocrypha-interior .try-this-body { padding: 12px; }
.apocrypha-interior .try-this-row { margin-bottom: 8px; }
.apocrypha-interior .try-this-row:last-child { margin-bottom: 0; }
.apocrypha-interior .try-this-label { font-size: 9px; color: #ffcc66; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 2px; }
.apocrypha-interior .try-this-text { font-size: 14px; color: #d7ff9a; line-height: 1.5; }
.apocrypha-interior .try-this-prompt { font-family: "Share Tech Mono", "DotGothic16", monospace; font-size: 12px; color: #fff; background: #111; padding: 6px; border: 1px solid #333; display: block; white-space: pre-wrap; word-break: break-word; }
.apocrypha-interior .code-inline { background: rgba(255, 255, 255, 0.1); padding: 0 4px; border-radius: 2px; color: #fff; font-family: monospace; }
.apocrypha-interior .code-block { background: #111; padding: 8px; border: 1px solid #333; display: block; white-space: pre-wrap; word-break: break-word; font-family: monospace; margin: 8px 0; color: #fff; }

.apocrypha-interior .article blockquote { margin: 8px 0; padding: 8px 8px 8px 12px; border-left: 2px solid #2a5a2a; color: #999; }
.apocrypha-interior .article blockquote .tile-meta { margin-top: 4px; }
.apocrypha-interior .footer { margin-top: 16px; padding-top: 12px; border-top: 1px solid #333; font-size: 9px; color: #666; }
.apocrypha-interior .footer a { color: #d7ff9a; text-decoration: none; }
.apocrypha-interior .footer a:hover { text-decoration: underline; }
@media (max-width: 768px) { .apocrypha-interior .zine { padding: 12px; } .apocrypha-interior .billboard { grid-template-columns: 1fr 1fr; } .apocrypha-interior .tile.hero { grid-column: span 2; grid-row: span 1; } .apocrypha-interior .content { grid-template-columns: 1fr; } .apocrypha-interior .sidebar { order: -1; } .apocrypha-interior .mast { flex-direction: column; gap: 12px; } .apocrypha-interior .mast-right { text-align: left; } .apocrypha-interior .mast-title { font-size: 32px; } }`;
}

function getApocryphaInterior(options) {
    const full = renderApocrypha(options);
    const startTag = '<main>';
    const endTag = '</main>';
    const startIdx = full.indexOf(startTag);
    const endIdx = full.indexOf(endTag);
    if (startIdx === -1 || endIdx === -1) {
        return '';
    }
    let interior = full.slice(startIdx + startTag.length, endIdx).trim();
    
    // Remove the full-page <style> block (it has html,body rules that leak)
    interior = interior.replace(/<style>[\s\S]*?<\/style>/i, '');
    
    // Add referrerpolicy to all images for cross-origin attachment hosts
    interior = interior.replace(/<img /g, '<img referrerpolicy="no-referrer" ');
    
    // Wrap in scoped container and prepend scoped CSS
    const scopedCss = getApocryphaInteriorCss();
    return '<style>' + scopedCss + '</style>\n<div class="apocrypha-interior">' + interior + '</div>';
}

function registerRoutes(app, { globalResources }) {
    const uuid = globalResources.getApocryphaPathUuid();
    if (!uuid) {
        console.warn('[apocrypha] missing apocryphaPathUuid; routes not mounted');
        return;
    }
    const prefix = `/${uuid}`;

    const sendView = (req, res, isGrimoire, issueSlug) => {
        if (issueSlug && !loadArchivedIssue(issueSlug)) {
            res.status(404).type('html').send('<!DOCTYPE html><title>Apocrypha</title>No such issue.');
            return;
        }
        res.status(200).type('html').send(renderApocrypha({
            title: 'Apocrypha — MWF digest',
            isGrimoire,
            issueSlug
        }));
    };

    app.use(prefix, (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return next();
        }
        const rel = String(req.url || req.path || '/').split('?')[0];
        const archiveMatch = /^\/archive\/([a-z0-9][a-z0-9.-]{0,79})\/?$/i.exec(rel);
        const issueSlug = archiveMatch ? archiveMatch[1] : '';
        const isGrimoire = !!(req.session && req.session.authenticated);
        return sendView(req, res, isGrimoire, issueSlug);
    });
}

module.exports = {
    registerRoutes,
    renderApocrypha,
    getApocryphaInterior,
    getApocryphaData,
    publishApocrypha,
    revokeApocryphaSection,
    listApocrypha,
    listArchivedIssues,
    loadArchivedIssue
};
