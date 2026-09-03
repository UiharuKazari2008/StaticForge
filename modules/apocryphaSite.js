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
                <div class="apocrypha-grim-wrapper">
                    <div class="apocrypha-grim-header">GRIM / LOGGED-IN</div>
                    <div class="apocrypha-enshutsuka-memories">
                        <p>Enshutsuka memory bodies visible.</p>
                        <p>Three Enshutsuka memories exist. Bodies stay in Grim after session.</p>
                    </div>
                </div>` : `
                <div class="apocrypha-wrap-public">
                    <div class="apocrypha-wrap-public-header">GRIM / LOGIN WRAPPER · omitted from public</div>
                    <div class="apocrypha-wrap-public-teaser">Teaser: three Enshutsuka memories exist. Bodies stay in Grim after session.</div>
                </div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DotGothic16&family=Grenze:wght@400;700&family=Oxanium:wght@400;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/apocrypha.css">
</head>
<body>
<main class="apocrypha-desktop">
    <div class="apocrypha-win">
        <div class="apocrypha-titlebar">
            <span class="apocrypha-titlebar-text">
                <span class="apocrypha-titlebar-icon">A</span>
                Apocrypha — MWF digest
            </span>
            <span class="apocrypha-titlebar-controls">
                <span class="apocrypha-titlebar-btn">_</span>
                <span class="apocrypha-titlebar-btn">□</span>
                <span class="apocrypha-titlebar-btn">×</span>
            </span>
        </div>
        <div class="apocrypha-zine">
            <!-- Masthead -->
            <header class="apocrypha-masthead">
                <div class="apocrypha-masthead-left">
                    <h1 class="apocrypha-title">APOCRYPHA</h1>
                    <span class="apocrypha-stamp">UNOFFICIAL PRESS</span>
                </div>
                <div class="apocrypha-masthead-right">
                    MONDAY DIGEST<br>
                    EXAMPLE DATA<br>
                    <a href="#">r92a1c0e</a><br>
                    public + /apocrypha
                </div>
            </header>

            <!-- Billboard Grid -->
            <section class="apocrypha-billboard">
                <div class="apocrypha-billboard-tile hero">
                    <span class="apocrypha-billboard-kicker">BILLBOARD · image of the day</span>
                    <div class="apocrypha-billboard-title">keep_481516 · atelier-preview</div>
                    <div class="apocrypha-billboard-meta">(placeholder tile, not a real gen)</div>
                </div>
                <div class="apocrypha-billboard-tile">
                    <span class="apocrypha-billboard-kicker">IOD · 2</span>
                    <div class="apocrypha-billboard-title">staff crop</div>
                </div>
                <div class="apocrypha-ad-tile">
                    <span class="apocrypha-ad-kicker">AD · ATELIER</span>
                    <div class="apocrypha-ad-title">NAX faces on the cheap</div>
                </div>
                <div class="apocrypha-ad-tile">
                    <span class="apocrypha-ad-kicker">AD · ZANZOU</span>
                    <div class="apocrypha-ad-title">keep the shot, scrap the ghosts</div>
                </div>
            </section>

            <!-- Main Content -->
            <div class="apocrypha-content">
                <article class="apocrypha-main">
                    <!-- Stats Article -->
                    <div class="apocrypha-article">
                        <span class="apocrypha-article-kicker">MONDAY · WEBAPP r92a1c0e · EXAMPLE</span>
                        <h2 class="apocrypha-article-title">Counts, version, official vs unofficial</h2>
                        
                        <div class="apocrypha-stats-grid">
                            <div class="apocrypha-stat-box">
                                <span class="apocrypha-stat-value">12</span>
                                <span class="apocrypha-stat-label">official</span>
                            </div>
                            <div class="apocrypha-stat-box">
                                <span class="apocrypha-stat-value">7</span>
                                <span class="apocrypha-stat-label">unofficial</span>
                            </div>
                            <div class="apocrypha-stat-box">
                                <span class="apocrypha-stat-value">3</span>
                                <span class="apocrypha-stat-label">Enshutsuka</span>
                            </div>
                            <div class="apocrypha-stat-box">
                                <span class="apocrypha-stat-value">V5</span>
                                <span class="apocrypha-stat-label">default</span>
                            </div>
                        </div>

                        <div class="apocrypha-split">
                            <div class="apocrypha-split-col official">
                                <div class="apocrypha-split-title">official</div>
                                <div class="apocrypha-split-text">
                                    staff: V5 hip weights still unsolved. Quality Tags on. No-text off for signs.
                                </div>
                            </div>
                            <div class="apocrypha-split-col unofficial">
                                <div class="apocrypha-split-title">unofficial</div>
                                <div class="apocrypha-split-text">
                                    community: 1–2 unweighted artists. Contrast over magnitude.
                                </div>
                            </div>
                        </div>

                        ${grimContent}
                    </div>

                    <!-- Images Section -->
                    <div class="apocrypha-images">
                        <span class="apocrypha-images-kicker">IMAGES</span>
                        <h3 class="apocrypha-images-title">Day sheet (placeholders)</h3>
                        <p class="apocrypha-images-note">
                            Three fake crops in the billboard. Real gens wait for Hoshino MWF posts. 
                            Ivory cohesion only after this URL exists.
                        </p>
                    </div>
                </article>

                <!-- Sidebar -->
                <aside class="apocrypha-sidebar">
                    <div class="apocrypha-sidebar-box">
                        <span class="apocrypha-sidebar-kicker">FAKE AD</span>
                        <div class="apocrypha-sidebar-title">Grimoire encyclopedia</div>
                        <div class="apocrypha-sidebar-text">look it up before you invent a tag</div>
                    </div>

                    <div class="apocrypha-sidebar-box">
                        <span class="apocrypha-sidebar-kicker">FAKE AD</span>
                        <div class="apocrypha-sidebar-title">Enshutsuka remembers</div>
                        <div class="apocrypha-sidebar-text">save_memory or it never happened</div>
                    </div>

                    <div class="apocrypha-sidebar-url">
                        <span class="apocrypha-sidebar-url-label">PUBLIC URL</span>
                        <a href="https://apocrypha.dreamscape.jp">apocrypha.dreamscape.jp</a>
                        <div class="apocrypha-sidebar-path">APP PATH<br>/apocrypha</div>
                    </div>
                </aside>
            </div>

            <!-- Footer -->
            <footer class="apocrypha-footer">
                Public: <a href="https://apocrypha.dreamscape.jp">https://apocrypha.dreamscape.jp</a> · 
                in-app: /apocrypha · 
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
