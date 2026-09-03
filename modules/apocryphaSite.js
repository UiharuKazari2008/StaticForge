'use strict';

/**
 * Apocrypha public zine: generated views under /{apocryphaPathUuid}.
 * Public hostname apocrypha.737.jp.net proxies here (UUID stays unlisted).
 * Window-classic chrome + underground hacker zine interior.
 * Anonymous: public teaser only. Authenticated: Enshutsuka memories visible.
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

function renderApocrypha({ title, isGrimoire }) {
    const grimContent = isGrimoire ? `
            <div class="grim-wrapper">
                <div class="grim-header">GRIM / LOGGED-IN</div>
                <div class="enshutsuka-memories">
                    <p>Enshutsuka memory bodies visible</p>
                </div>
            </div>` : `
            <div class="wrap-public">
                <div class="wrap-public-header">GRIM / LOGIN WRAPPER · omitted from public</div>
                <div class="wrap-public-teaser">Teaser: three Enshutsuka memories exist. Bodies stay in Grim after session.</div>
            </div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body>
<main class="desktop">
<style>
/* Window-classic + zine interior — Chiyo ecf82040 */
@import url('https://fonts.googleapis.com/css2?family=DotGothic16&family=Grenze:wght@400;700&family=Oxanium:wght@400;700&family=Share+Tech+Mono&display=swap');

.desktop {
    background: rgb(58, 110, 165);
    min-height: 100vh;
    padding: 20px;
    box-sizing: border-box;
    margin: 0;
}

.win {
    background: rgb(212, 208, 200);
    border: 2px solid;
    border-color: #ffffff #808080 #808080 #ffffff;
    box-shadow: 1px 1px 0 #000;
    max-width: 1024px;
    margin: 0 auto;
}

.titlebar {
    background: linear-gradient(to right, rgb(10, 36, 106), rgb(166, 202, 240));
    color: #ffffff;
    font-family: 'Tahoma', 'MS Sans Serif', sans-serif;
    font-size: 11px;
    font-weight: bold;
    padding: 2px 4px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 18px;
    user-select: none;
}

.titlebar-text {
    display: flex;
    align-items: center;
    gap: 4px;
}

.titlebar-icon {
    width: 14px;
    height: 14px;
    background: #d7ff9a;
    border-radius: 2px;
    font-size: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #0d0d0d;
    font-weight: bold;
}

.titlebar-controls {
    display: flex;
    gap: 2px;
}

.titlebar-btn {
    width: 16px;
    height: 14px;
    background: rgb(212, 208, 200);
    border: 1px solid;
    border-color: #ffffff #808080 #808080 #ffffff;
    font-family: 'Marlett', sans-serif;
    font-size: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #000;
    cursor: default;
}

.zine {
    background: #0d0d0d;
    color: #d7ff9a;
    font-family: 'Share Tech Mono', 'DotGothic16', monospace;
    font-size: 12px;
    line-height: 1.4;
    padding: 16px;
    min-height: 600px;
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
    .desktop {
        padding: 8px;
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
    <div class="win">
        <div class="titlebar">
            <span class="titlebar-text">
                <span class="titlebar-icon">A</span>
                Apocrypha — MWF digest
            </span>
            <span class="titlebar-controls">
                <span class="titlebar-btn">_</span>
                <span class="titlebar-btn">□</span>
                <span class="titlebar-btn">×</span>
            </span>
        </div>
        <div class="zine">
            <!-- Masthead -->
            <header class="mast">
                <div class="mast-left">
                    <h1 class="mast-title">APOCRYPHA</h1>
                    <span class="stamp">UNOFFICIAL PRESS</span>
                </div>
                <div class="mast-right">
                    MONDAY DIGEST<br>
                    EXAMPLE DATA
                </div>
            </header>

            <!-- Billboard Grid -->
            <section class="billboard">
                <div class="tile hero">
                    <span class="tile-kicker">BILLBOARD · image of the day</span>
                    <div class="tile-title">keep_481516 · atelier-preview</div>
                    <div class="tile-meta">(placeholder tile, not a real gen)</div>
                </div>
                <div class="tile">
                    <span class="tile-kicker">IOD · 2</span>
                    <div class="tile-title">staff crop</div>
                </div>
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
                    <!-- Stats Article -->
                    <div class="article">
                        <span class="article-kicker">MONDAY · WEBAPP r92a1c0e · EXAMPLE</span>
                        <h2 class="article-title">Counts, version, official vs unofficial</h2>
                        
                        <div class="stats-grid">
                            <div class="stat-box">
                                <span class="stat-value">—</span>
                                <span class="stat-label">official</span>
                            </div>
                            <div class="stat-box">
                                <span class="stat-value">—</span>
                                <span class="stat-label">unofficial</span>
                            </div>
                            <div class="stat-box">
                                <span class="stat-value">—</span>
                                <span class="stat-label">Enshutsuka</span>
                            </div>
                            <div class="stat-box">
                                <span class="stat-value">V5</span>
                                <span class="stat-label">default</span>
                            </div>
                        </div>

                        <div class="split">
                            <div class="split-col official">
                                <div class="split-title">official</div>
                                <div class="split-text">
                                    staff: V5 hip weights still unsolved. Quality Tags on. No-text off for signs.
                                </div>
                            </div>
                            <div class="split-col unofficial">
                                <div class="split-title">unofficial</div>
                                <div class="split-text">
                                    community: 1–2 unweighted artists. Contrast over magnitude.
                                </div>
                            </div>
                        </div>

                        ${grimContent}
                    </div>

                    <!-- Images Section -->
                    <div class="images">
                        <span class="images-kicker">IMAGES</span>
                        <h3 class="images-title">Day sheet (placeholders)</h3>
                        <p class="images-note">
                            Three fake crops in the billboard. Real gens wait for Hoshino MWF posts. 
                            Ivory cohesion only after this URL exists.
                        </p>
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
    </div>
</main>
</body>
</html>`;
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

module.exports = { registerRoutes };
