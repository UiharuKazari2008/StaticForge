#!/usr/bin/env node
'use strict';
// Rack Manager console: loads the console into the harness page (harness-server.js, mocked wsClient), walks every node and
// opens the dialogs and wizards, screenshots each at deviceScaleFactor 1, and checks page errors, polling and native UI.
//   node scripts/rack/test-rack-manager.js [outDir] [--only <prefix>]
const fs = require('fs');
const path = require('path');
const { start } = require('./harness-server');

function playwright() {
    const tries = [() => require('playwright'), () => require(process.env.PLAYWRIGHT_PATH || '/nonexistent')];
    try { const d = path.join(process.env.HOME || '', '.npm/_npx'); for (const x of fs.readdirSync(d)) { const p = path.join(d, x, 'node_modules/playwright'); if (fs.existsSync(p)) tries.push(() => require(p)); } } catch (_) { /* none */ }
    for (const t of tries) { try { return t(); } catch (_) { /* next */ } }
    throw new Error('playwright not found (PLAYWRIGHT_PATH)');
}

const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '/tmp/claude-1000/-home-kanmi-staticforge/2381ca56-dc3c-5327-919d-624c1c42a2f5/scratchpad/rackmgr-shots';
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
    const { chromium } = playwright();
    const { server, port } = await start(0);
    const browser = await chromium.launch({ executablePath: fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1000, height: 740 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${String(e.stack).split('\n').slice(1, 4).join('\n')}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${port}/rack-harness.html`);
    await page.waitForTimeout(500);
    const log = [];
    const wait = (ms) => page.waitForTimeout(ms);
    const shot = async (name) => { if (ONLY && !name.startsWith(ONLY)) return; await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log.push(name); };
    const ev = (fn, arg) => page.evaluate(fn, arg);
    // not awaited in the page: a task dialog's action answers only when the dialog closes
    const act = (a, arg) => ev(({ a, arg }) => { window.mmcConsole.get('rackManager').action(a, arg); return null; }, { a, arg });
    const select = async (id, ms = 700) => { await ev((i) => window.mmcConsole.get('rackManager').select(i, true), id); await wait(ms); };
    const closeDialogs = async () => { await ev(() => document.querySelectorAll('.vdt-window .vdt-close, .vdt-window .vdt-wizard-cancel').forEach((b) => b.click())); await wait(500); };
    const ctx = { page, ev, act, select, shot, wait, closeDialogs, errors, out: OUT, port, log };

    await ev(() => window.mmcRackManager.open());
    await wait(900);
    await ev(() => { const m = window.mmcConsole.get('rackManager').modal; window.setModalOffsetsFromViewportTopLeft(m, 40, 34); });
    await wait(300);
    await require('./scenarios')(ctx);

    console.log(`${log.length} screenshots in ${OUT}`);
    console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
    await browser.close();
    server.close();
    process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
