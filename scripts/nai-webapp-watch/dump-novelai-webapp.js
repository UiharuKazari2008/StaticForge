#!/usr/bin/env node
/**
 * Headed Chrome dump of novelai.net public assets via patched ResourcesSaverExt.
 * Requires: google-chrome-stable (or CHROME_BIN), xvfb-run, playwright devDependency,
 * and tools/ResourcesSaverExt/unpacked2x from setup-dump-deps.sh.
 *
 * Usage:
 *   ./scripts/nai-webapp-watch/setup-dump-deps.sh
 *   ./scripts/nai-webapp-watch/dump-novelai-webapp.sh
 *   node scripts/nai-webapp-watch/dump-novelai-webapp.js --out tmp/nai-webapp-dumps
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_EXT = path.join(ROOT, 'tools', 'ResourcesSaverExt', 'unpacked2x');
const EXT_PATH = process.env.RESOURCES_SAVER_EXT_PATH
    ? path.resolve(process.env.RESOURCES_SAVER_EXT_PATH)
    : DEFAULT_EXT;
const DEFAULT_OUT = path.join(ROOT, 'tmp', 'nai-webapp-dumps');
const TARGET_URL = 'https://novelai.net/';

function parseArgs(argv) {
    const opts = {
        out: DEFAULT_OUT,
        url: TARGET_URL,
        timeoutMs: 120000,
        headless: false
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--out' && argv[i + 1]) opts.out = path.resolve(argv[++i]);
        else if (arg === '--url' && argv[i + 1]) opts.url = argv[++i];
        else if (arg === '--timeout' && argv[i + 1]) opts.timeoutMs = Number(argv[++i]);
        else if (arg === '--help' || arg === '-h') opts.help = true;
    }
    return opts;
}

function resolveChrome() {
    const candidates = [
        process.env.CHROME_BIN,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ].filter(Boolean);
    for (const bin of candidates) {
        if (fs.existsSync(bin)) return bin;
    }
    return null;
}

async function runDump(opts) {
    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch (_) {
        console.error('[nai-webapp-dump] missing automation dependency; see scripts/nai-webapp-watch/README.md');
        process.exit(1);
    }

    if (!fs.existsSync(EXT_PATH)) {
        console.error('[nai-webapp-dump] missing extension at', EXT_PATH);
        console.error('[nai-webapp-dump] run: ./scripts/nai-webapp-watch/setup-dump-deps.sh');
        console.error('[nai-webapp-dump] optional override: RESOURCES_SAVER_EXT_PATH=/path/to/unpacked2x');
        process.exit(1);
    }
    if (!fs.existsSync(path.join(EXT_PATH, 'automation-bridge.js'))) {
        console.error('[nai-webapp-dump] extension found but automation overlay missing');
        console.error('[nai-webapp-dump] re-run: ./scripts/nai-webapp-watch/setup-dump-deps.sh');
        process.exit(1);
    }

    const chromeBin = resolveChrome();
    if (!chromeBin) {
        console.error('[nai-webapp-dump] google-chrome-stable not found');
        process.exit(1);
    }

    fs.mkdirSync(opts.out, { recursive: true });
    const profileDir = path.join(opts.out, '.chrome-profile');
    fs.mkdirSync(profileDir, { recursive: true });

    const context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        executablePath: chromeBin,
        acceptDownloads: true,
        downloadsPath: opts.out,
        args: [
            `--disable-extensions-except=${EXT_PATH}`,
            `--load-extension=${EXT_PATH}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-dev-shm-usage'
        ]
    });

    try {
        const page = context.pages()[0] || await context.newPage();
        await page.goto(opts.url, { waitUntil: 'networkidle', timeout: opts.timeoutMs });
        await page.waitForTimeout(3000);

        const requestId = `save-${Date.now()}`;
        const resultPromise = page.evaluate(({ requestId: rid }) => new Promise((resolve) => {
            function onMessage(event) {
                if (event.source !== window) return;
                const data = event.data;
                if (!data || data.type !== 'RESOURCES_SAVER_AUTOMATION_SAVE_RESULT') return;
                if (data.requestId !== rid) return;
                window.removeEventListener('message', onMessage);
                resolve(data.response || { ok: false, error: 'empty response' });
            }
            window.addEventListener('message', onMessage);
            window.postMessage({ type: 'RESOURCES_SAVER_AUTOMATION_SAVE', requestId: rid }, '*');
        }), { requestId });

        const downloadPromise = page.waitForEvent('download', { timeout: opts.timeoutMs }).catch(() => null);
        const extensionResult = await Promise.race([
            resultPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('extension timeout')), opts.timeoutMs))
        ]);

        let savedPath = null;
        const download = await downloadPromise;
        if (download) {
            const suggested = download.suggestedFilename();
            savedPath = path.join(opts.out, suggested);
            await download.saveAs(savedPath);
        }

        const report = {
            ok: !!(extensionResult && extensionResult.ok),
            url: opts.url,
            extensionResult,
            savedPath,
            outDir: opts.out,
            note: 'Dump stays under tmp/ (gitignored). Never commit JWT/recaptcha captures.'
        };

        console.log('[nai-webapp-dump]', JSON.stringify(report));
        if (!report.ok) process.exit(2);
    } finally {
        await context.close();
    }
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        console.log(`Usage: node scripts/nai-webapp-watch/dump-novelai-webapp.js [--out dir] [--url URL]

Headed Chrome under xvfb-run — use dump-novelai-webapp.sh on Linux.
`);
        process.exit(0);
    }
    await runDump(opts);
}

main().catch((err) => {
    console.error('[nai-webapp-dump] fatal', err.message);
    process.exit(1);
});
