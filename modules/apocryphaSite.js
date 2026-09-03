'use strict';

/**
 * Apocrypha public zine: generated views under /{apocryphaPathUuid}.
 * Public hostname apocrypha.737.jp.net proxies here (UUID stays unlisted).
 * Underground hacker zine interior only — no window chrome.
 * Anonymous: public teaser only. Authenticated: Enshutsuka memories visible.
 * Template slots stay for #95 JSON ingest (issueLabel, webapp, kicker, counts, etc.).
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
                    <!-- #95: enshutsuka[].body fills here -->
                    <p>Enshutsuka memory bodies visible</p>
                </div>
            </div>` : `
            <div class="wrap-public">
                <div class="wrap-public-header">GRIM / LOGIN WRAPPER · omitted from public</div>
                <!-- #95: enshutsuka[].teaser fills here -->
                <div class="wrap-public-teaser">Teaser: Enshutsuka memories exist. Bodies stay in Grim after session.</div>
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
                    <!-- #95: issueLabel fills here -->
                    MONDAY DIGEST<br>
                    <!-- #95: webapp kicker fills here -->
                </div>
            </header>

            <!-- Billboard Grid — #95: billboard[] fills here -->
            <section class="billboard">
                <div class="tile hero">
                    <span class="tile-kicker">BILLBOARD · image of the day</span>
                    <div class="tile-title">—</div>
                    <div class="tile-meta"></div>
                </div>
                <div class="tile">
                    <span class="tile-kicker">IOD · 2</span>
                    <div class="tile-title">—</div>
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
                    <!-- Stats Article — #95: counts, webapp, kicker fill here -->
                    <div class="article">
                        <span class="article-kicker">MONDAY · WEBAPP</span>
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

                    <!-- Images Section — #95: imagesNote fills here -->
                    <div class="images">
                        <span class="images-kicker">IMAGES</span>
                        <h3 class="images-title">Day sheet</h3>
                        <p class="images-note">
                            Awaiting Hoshino MWF posts.
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

    const sendView = (req, res, isGrimoire, { cors = false } = {}) => {
        if (cors) {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Access-Control-Allow-Origin', 'https://staticforge.737.jp.net');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.status(200).type('html').send(renderApocrypha({
            title: 'Apocrypha — MWF digest',
            isGrimoire
        }));
    };

    app.get('/dsap/zine/apocrypha', (req, res) => {
        const isGrimoire = !!(req.session && req.session.authenticated);
        if (!isGrimoire) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        return sendView(req, res, true);
    });

    app.use(prefix, (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return next();
        }
        const isGrimoire = !!(req.session && req.session.authenticated);
        return sendView(req, res, isGrimoire, { cors: true });
    });
}

module.exports = { registerRoutes };
