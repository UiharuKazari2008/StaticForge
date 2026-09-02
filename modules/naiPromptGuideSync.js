/**
 * Clone / hard-reset DreamScape/nai-prompt-guide into .cache.
 * Trust origin: fetch + reset --hard overwrites local edits in that cache clone only.
 * Grimoire site id is Docubase; the clone folder name stays nai-prompt-guide.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const GIT_TIMEOUT_MS = 20000;

const DEFAULT_REMOTE = 'https://yozora.bluesteel.737.jp.net/DreamScape/nai-prompt-guide.git';
const DEFAULT_BRANCH = 'main';
const CACHE_DIR_NAME = 'nai-prompt-guide';
const SITE_ID = 'docubase';
const SITE_ALIASES = ['nai-prompt-guide'];
const SITE_NAME = 'Docubase';
const SITE_KIND = 'docubase';
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules']);
const SKIP_FILE_NAMES = new Set(['.gitkeep', '.gitignore']);
const PAGE_FILE_RE = /\.(md|ya?ml|json)$/i;

function readGitToken() {
    if (process.env.YOZORA_TOKEN) return String(process.env.YOZORA_TOKEN).trim();
    if (process.env.NAI_PROMPT_GUIDE_TOKEN) return String(process.env.NAI_PROMPT_GUIDE_TOKEN).trim();
    const paths = [
        process.env.YOZORA_TOKEN_FILE,
        '/home/kanmi/.secrets/yozora-grok.cursor.token'
    ].filter(Boolean);
    for (const filePath of paths) {
        try {
            if (fs.existsSync(filePath)) {
                const token = fs.readFileSync(filePath, 'utf8').trim();
                if (token) return token;
            }
        } catch (_) { /* */ }
    }
    return '';
}

function runGit(args, cwd, token) {
    const extra = [];
    if (token) extra.push('-c', `http.extraHeader=Authorization: token ${token}`);
    return new Promise((resolve) => {
        let timedOut = false;
        const child = spawn('git', extra.concat(args), {
            cwd,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, GIT_TIMEOUT_MS);
        let stdout = '';
        let stderr = '';
        if (child.stdout) {
            child.stdout.on('data', (chunk) => { stdout += chunk; });
        }
        if (child.stderr) {
            child.stderr.on('data', (chunk) => { stderr += chunk; });
        }
        child.on('error', (error) => {
            clearTimeout(timer);
            resolve({ status: 1, stdout, stderr: error.message, error });
        });
        child.on('close', (status) => {
            clearTimeout(timer);
            if (timedOut) {
                resolve({
                    status: 1,
                    stdout,
                    stderr: stderr || `git timed out after ${GIT_TIMEOUT_MS}ms`
                });
                return;
            }
            resolve({ status: status == null ? 1 : status, stdout, stderr });
        });
    });
}

function gitError(result, fallback) {
    const text = String((result && (result.stderr || result.stdout)) || fallback || 'git failed');
    return text.replace(/token\s+\S+/gi, 'token ***').slice(0, 300);
}

function isDocubaseSiteId(siteId) {
    const id = String(siteId || '');
    return id === SITE_ID || SITE_ALIASES.includes(id);
}

function getPromptGuideDir(cacheDir) {
    return path.join(cacheDir, CACHE_DIR_NAME);
}

async function syncNaiPromptGuide(cacheDir, options = {}) {
    const dest = getPromptGuideDir(cacheDir);
    const remote = options.remote || DEFAULT_REMOTE;
    const branch = options.branch || DEFAULT_BRANCH;
    const token = readGitToken();
    fs.mkdirSync(cacheDir, { recursive: true });

    const hasGit = fs.existsSync(path.join(dest, '.git'));
    if (!hasGit) {
        if (fs.existsSync(dest)) {
            fs.rmSync(dest, { recursive: true, force: true });
        }
        const clone = await runGit(['clone', '--depth', '1', '--branch', branch, remote, dest], cacheDir, token);
        if (clone.status !== 0) {
            return { ok: false, dest, error: gitError(clone, 'clone failed') };
        }
        return { ok: true, dest, cloned: true };
    }

    await runGit(['remote', 'set-url', 'origin', remote], dest, token);
    const fetch = await runGit(['fetch', '--force', 'origin', branch], dest, token);
    if (fetch.status !== 0) {
        return { ok: false, dest, error: gitError(fetch, 'fetch failed') };
    }
    const reset = await runGit(['reset', '--hard', `origin/${branch}`], dest, token);
    if (reset.status !== 0) {
        return { ok: false, dest, error: gitError(reset, 'reset failed') };
    }
    await runGit(['clean', '-fd'], dest, token);
    return { ok: true, dest, reset: true };
}

function firstMarkdownHeader(file, text) {
    if (!/\.md$/i.test(file || '')) return '';
    const heading = String(text || '').match(/^\s*#{1,6}\s+(.+)$/m);
    if (!heading) return '';
    return heading[1].replace(/\*\*/g, '').replace(/`/g, '').trim();
}

function titleFromSource(file, text) {
    const rel = String(file || '').replace(/\\/g, '/');
    const header = firstMarkdownHeader(rel, text);
    return header ? `${rel} (${header})` : rel;
}

function groupForFile(rel) {
    const pathRel = String(rel || '').replace(/\\/g, '/');
    const slash = pathRel.lastIndexOf('/');
    return slash === -1 ? '.' : pathRel.slice(0, slash);
}

function compareGroups(a, b) {
    if (a === '.' && b !== '.') return -1;
    if (b === '.' && a !== '.') return 1;
    return String(a).localeCompare(String(b));
}

function listPromptGuidePages(cacheDir) {
    const dest = getPromptGuideDir(cacheDir);
    if (!fs.existsSync(dest)) return [];
    const pages = [];
    const walk = (rel) => {
        const abs = rel ? path.join(dest, rel) : dest;
        let entries;
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch (_) {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            if (SKIP_FILE_NAMES.has(entry.name)) continue;
            if (entry.isDirectory()) {
                if (SKIP_DIR_NAMES.has(entry.name)) continue;
                walk(rel ? `${rel}/${entry.name}` : entry.name);
                continue;
            }
            if (!PAGE_FILE_RE.test(entry.name)) continue;
            const file = rel ? `${rel}/${entry.name}` : entry.name;
            const id = file.replace(/\.(md|ya?ml|json)$/i, '');
            let text = '';
            try {
                text = fs.readFileSync(path.join(dest, file), 'utf8');
            } catch (_) { /* */ }
            pages.push({
                id,
                title: titleFromSource(file, text),
                file,
                group: groupForFile(file)
            });
        }
    };
    walk('');
    pages.sort((a, b) => {
        const g = compareGroups(a.group, b.group);
        if (g) return g;
        return a.title.localeCompare(b.title);
    });
    return pages;
}

function readPromptGuidePage(cacheDir, pageId) {
    const dest = getPromptGuideDir(cacheDir);
    const pages = listPromptGuidePages(cacheDir);
    const wanted = String(pageId || 'prompt-optimiser-grok').replace(/\.(md|ya?ml|json)$/i, '');
    const page = pages.find((row) => row.id === wanted || row.file === pageId || row.title === pageId)
        || pages.find((row) => row.id.endsWith(`/${wanted}`) || row.id === wanted);
    if (!page) return null;
    const abs = path.resolve(dest, page.file);
    if (!abs.startsWith(path.resolve(dest) + path.sep)) return null;
    if (!fs.existsSync(abs)) return null;
    const text = fs.readFileSync(abs, 'utf8');
    return {
        siteId: SITE_ID,
        pageId: page.id,
        title: titleFromSource(page.file, text) || page.title,
        file: page.file,
        group: page.group,
        text
    };
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function headingTag(level) {
    return `h${Math.min(6, Math.max(1, Number(level) || 1))}`;
}

function rewriteDocubaseLinks(html, pageIds) {
    const { parse } = require('node-html-parser');
    const ids = pageIds instanceof Set ? pageIds : new Set(pageIds || []);
    const root = parse(String(html || ''), { blockTextElements: { script: false, style: false } });
    root.querySelectorAll('a').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (!href) return;
        if (href.startsWith('#')) {
            a.setAttribute('class', 'tag-wiki-anchor-link');
            return;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
            return;
        }
        let id = href.replace(/^\.\//, '').replace(/\/+$/, '').replace(/\.(md|ya?ml|json)$/i, '');
        if (ids.has(`${id}/README`)) id = `${id}/README`;
        if (!ids.has(id)) return;
        a.setAttribute('href', '#');
        a.setAttribute('class', 'wiki-static-link');
        a.setAttribute('data-wiki-site', SITE_ID);
        a.setAttribute('data-wiki-page', id);
    });
    return root.toString();
}

function inlineMarkdown(text) {
    let s = escapeHtml(text);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, code) => {
        codes.push(`<code>${code}</code>`);
        return `\u0000C${codes.length - 1}\u0000`;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        const url = String(href).replace(/&amp;/g, '&');
        return `<a href="${escapeHtml(url)}">${label}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/\u0000C(\d+)\u0000/g, (_, i) => codes[Number(i)]);
    return s;
}

function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
    let s = String(line || '').trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((cell) => cell.trim());
}

function isFence(line) {
    return /^```/.test(line);
}

function isHeading(line) {
    return /^#{1,6}\s+\S/.test(line);
}

function isHr(line) {
    return /^(\s*)([-*_])\2{2,}\s*$/.test(line) && !/^\s*[-*+]\s+\S/.test(line);
}

function isListLine(line) {
    return /^\s*(?:[-*+]|\d+\.)\s+\S/.test(line);
}

function isBlockStart(line) {
    return isFence(line) || isHeading(line) || isHr(line) || isListLine(line) || /^>\s?/.test(line)
        || (line.includes('|') && isTableSeparator);
}

function consumeTable(lines, start) {
    const header = splitTableRow(lines[start]);
    let i = start + 1;
    if (i >= lines.length || !isTableSeparator(lines[i])) {
        return null;
    }
    i += 1;
    const body = [];
    while (i < lines.length && lines[i].includes('|') && !isFence(lines[i]) && !isHeading(lines[i])) {
        body.push(splitTableRow(lines[i]));
        i += 1;
    }
    const th = header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('');
    const rows = body.map((cells) => `<tr>${cells.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('');
    return {
        html: `<table class="sortable"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`,
        next: i
    };
}

function consumeList(lines, start) {
    const items = [];
    let i = start;
    const ordered = /^\s*\d+\.\s+/.test(lines[start]);
    while (i < lines.length && isListLine(lines[i])) {
        const row = lines[i];
        const match = row.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
        items.push(`<li>${inlineMarkdown(match ? match[1] : row.trim())}</li>`);
        i += 1;
    }
    const tag = ordered ? 'ol' : 'ul';
    return {
        html: `<${tag}>${items.join('')}</${tag}>`,
        next: i
    };
}

function markdownToWikiHtml(src) {
    const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (isFence(line)) {
            const buf = [];
            i += 1;
            while (i < lines.length && !isFence(lines[i])) {
                buf.push(lines[i]);
                i += 1;
            }
            if (i < lines.length) i += 1;
            out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
            continue;
        }
        if (isHr(line)) {
            out.push('<hr>');
            i += 1;
            continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            const tag = headingTag(heading[1].length);
            out.push(`<${tag}>${inlineMarkdown(heading[2])}</${tag}>`);
            i += 1;
            continue;
        }
        if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            const table = consumeTable(lines, i);
            if (table) {
                out.push(table.html);
                i = table.next;
                continue;
            }
        }
        if (/^>\s?/.test(line)) {
            const buf = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) {
                buf.push(lines[i].replace(/^>\s?/, ''));
                i += 1;
            }
            out.push(`<blockquote>${buf.map((row) => `<p>${inlineMarkdown(row)}</p>`).join('')}</blockquote>`);
            continue;
        }
        if (isListLine(line)) {
            const list = consumeList(lines, i);
            out.push(list.html);
            i = list.next;
            continue;
        }
        if (!line.trim()) {
            i += 1;
            continue;
        }
        const buf = [line];
        i += 1;
        while (i < lines.length && lines[i].trim() && !isHeading(lines[i]) && !isFence(lines[i])
            && !isHr(lines[i]) && !isListLine(lines[i]) && !/^>\s?/.test(lines[i])
            && !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))) {
            buf.push(lines[i]);
            i += 1;
        }
        out.push(`<p>${inlineMarkdown(buf.join(' '))}</p>`);
    }
    return out.join('');
}

function wrapPromptGuideHtml(page, pageIds) {
    const raw = String(page.text || '');
    if (/\.(ya?ml|json)$/i.test(page.file || '')) {
        return `<pre><code>${escapeHtml(raw)}</code></pre>`;
    }
    const { normalizeWikiMarkup } = require('../scripts/import-novelai-docs');
    let html = markdownToWikiHtml(raw);
    html = rewriteDocubaseLinks(html, pageIds);
    return normalizeWikiMarkup(html, page.title);
}

function readJsonSafe(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) { /* */ }
    return fallback;
}

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function upsertDocubaseHomeSite(wikiRoot) {
    const homePath = path.join(wikiRoot, 'index.json');
    const home = readJsonSafe(homePath, { sites: [] });
    if (!home.sites) home.sites = [];
    const row = { id: SITE_ID, name: SITE_NAME, kind: SITE_KIND };
    const existing = home.sites.find((s) => s.id === SITE_ID || SITE_ALIASES.includes(s.id));
    if (!existing) home.sites.unshift(row);
    else {
        existing.id = SITE_ID;
        existing.name = SITE_NAME;
        existing.kind = SITE_KIND;
    }
    home.sites = home.sites.filter((s) => s.id !== 'nai-prompt-guide' || SITE_ID === 'nai-prompt-guide');
    writeJson(homePath, home);
}

function materializeDocubaseWiki(cacheDir) {
    const repoDir = getPromptGuideDir(cacheDir);
    if (!fs.existsSync(repoDir)) {
        return { ok: false, error: 'prompt-guide clone missing' };
    }
    const wikiRoot = path.join(cacheDir, 'wiki');
    const siteDir = path.join(wikiRoot, SITE_ID);
    const pagesDir = path.join(siteDir, 'pages');
    fs.rmSync(pagesDir, { recursive: true, force: true });
    fs.mkdirSync(pagesDir, { recursive: true });

    const listed = listPromptGuidePages(cacheDir);
    const pageIds = new Set(listed.map((row) => row.id));
    const index = { pages: [] };
    for (const row of listed) {
        const abs = path.join(repoDir, row.file);
        const text = fs.readFileSync(abs, 'utf8');
        const page = { ...row, text };
        const html = wrapPromptGuideHtml(page, pageIds);
        const dest = path.join(pagesDir, `${row.id}.html`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, html, 'utf8');
        fs.writeFileSync(dest.replace(/\.html$/, '.md'), text, 'utf8');
        writeJson(dest.replace(/\.html$/, '.json'), {
            id: row.id,
            title: row.title,
            group: row.group,
            sourceFile: row.file
        });
        index.pages.push({
            id: row.id,
            title: row.title,
            group: row.group
        });
    }
    writeJson(path.join(siteDir, 'index.json'), index);
    upsertDocubaseHomeSite(wikiRoot);
    return { ok: true, siteId: SITE_ID, pages: index.pages.length };
}

function sortDocubaseGroups(groups) {
    return (groups || []).slice().sort((a, b) => compareGroups(a.name, b.name));
}

module.exports = {
    SITE_ID,
    SITE_ALIASES,
    SITE_NAME,
    SITE_KIND,
    CACHE_DIR_NAME,
    DEFAULT_REMOTE,
    DEFAULT_BRANCH,
    isDocubaseSiteId,
    getPromptGuideDir,
    syncNaiPromptGuide,
    listPromptGuidePages,
    readPromptGuidePage,
    wrapPromptGuideHtml,
    markdownToWikiHtml,
    materializeDocubaseWiki,
    titleFromSource,
    sortDocubaseGroups
};
