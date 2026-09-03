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

function getApocryphaData() {
    try {
        const filePath = path.join(process.cwd(), 'data/apocrypha/current.json');
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('[apocrypha] failed to read/parse current.json:', e.message);
    }
    return null;
}

function renderApocrypha({ title, isGrimoire }) {
    const data = getApocryphaData() || {};

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

    let imagesGridHtml = '';
    if (data.images && Array.isArray(data.images) && data.images.length > 0) {
        imagesGridHtml = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">';
        imagesGridHtml += data.images.map(img => {
            if (img.src && typeof img.src === 'string' && img.src.startsWith('http')) {
                const kickerHtml = img.kicker ? '<div style="font-size: 8px; color: #665500; text-transform: uppercase; margin-top: 4px;">' + escapeHtml(img.kicker) + '</div>' : '';
                const capHtml = img.cap ? '<div style="font-size: 9px; color: #999; margin-top: 2px;">' + escapeHtml(img.cap) + '</div>' : '';
                return '<div class="image-item">\n' +
                       '    <img referrerpolicy="no-referrer" src="' + escapeHtml(img.src) + '" alt="' + escapeHtml(img.cap || '') + '" style="width: 100%; height: auto; border: 1px solid #333; display: block;">\n' +
                       '    ' + kickerHtml + '\n' +
                       '    ' + capHtml + '\n' +
                       '</div>';
            }
            return '<div class="tile"><span class="tile-kicker">PLACEHOLDER</span><div class="tile-title">—</div></div>';
        }).join('\n');
        imagesGridHtml += '</div>';
    }
    const grimContent = isGrimoire ? `
            <div class="grim-wrapper">
                <div class="grim-header">GRIM / LOGGED-IN</div>
                <div class="enshutsuka-memories">
                    ${enshutsukaHtml}
                </div>
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
    font-size: 10px;
    font-weight: bold;
    text-transform: lowercase;
    margin-bottom: 6px;
    color: #d7ff9a;
}

.split-text {
    font-size: 10px;
    color: #999;
    line-height: 1.5;
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
    font-size: 11px;
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
.apocrypha-interior .split-title { font-size: 10px; font-weight: bold; text-transform: lowercase; margin-bottom: 6px; color: #d7ff9a; }
.apocrypha-interior .split-text { font-size: 10px; color: #999; line-height: 1.5; }
.apocrypha-interior .wrap-public { border: 2px dashed #e11; padding: 12px; margin: 12px 0; background: rgba(225, 17, 17, 0.05); }
.apocrypha-interior .wrap-public-header { font-size: 9px; color: #e11; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
.apocrypha-interior .wrap-public-teaser { font-size: 11px; color: #999; line-height: 1.5; }
.apocrypha-interior .grim-wrapper { border: 1px solid #2a5a2a; padding: 12px; margin: 12px 0; background: #0a1a0a; }
.apocrypha-interior .grim-header { font-size: 9px; color: #2a5a2a; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.apocrypha-interior .grim-header::before { content: '●'; color: #4a4; }
.apocrypha-interior .enshutsuka-memories { font-size: 11px; color: #d7ff9a; line-height: 1.6; }
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

    const sendView = (req, res, isGrimoire) => {
        res.status(200).type('html').send(renderApocrypha({
            title: 'Apocrypha — MWF digest',
            isGrimoire
        }));
    };

    app.use(prefix, (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return next();
        }
        const isGrimoire = !!(req.session && req.session.authenticated);
        return sendView(req, res, isGrimoire);
    });
}

module.exports = { registerRoutes, renderApocrypha, getApocryphaInterior };
