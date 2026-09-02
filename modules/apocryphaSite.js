'use strict';

/**
 * Apocrypha public zine: generated views under /{apocryphaPathUuid}.
 * Public hostname apocrypha.737.jp.net proxies here (UUID stays unlisted).
 * Stub until Jules/ingest land real issue views. Not a static HTML drop.
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

function renderScaffold({ title, note }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: "Iowan Old Style", Palatino, "Palatino Linotype", serif;
    background: #120e0a; color: #e7dcc8; }
  main { max-width: 36rem; padding: 2rem; }
  h1 { font-weight: 400; letter-spacing: 0.18em; text-transform: uppercase; font-size: 1.1rem; }
  p { line-height: 1.55; color: #cbbfa8; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(note)}</p>
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

    const sendView = (req, res) => {
        res.status(200).type('html').send(renderScaffold({
            title: 'Apocrypha',
            note: 'Generated view. Scaffold pending. This is not a static HTML drop.'
        }));
    };

    app.use(prefix, (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return next();
        }
        return sendView(req, res);
    });
}

module.exports = { registerRoutes };
