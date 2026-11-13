/**
 * PM2 process config for Dreamscape (StaticForge server).
 * Referenced by ./restart and ./reload — env vars persist across pm2 restart.
 *
 * I Spy search indexing (phases 2–7) defaults ON in modules/metadataDatabase.js.
 * No env vars required. Optional kill switch: set any USE_* / WRITE_* to '0'.
 * One-shot backfills: scripts/tools/backfill-*.js (see each script header).
 *
 * grimoire-browser is the Grimoire remote browser (docs/grimoire-remote-browser.md).
 * ./restart and ./reload use --only Dreamscape so open browser sessions survive.
 */
const fs = require('fs');
const path = require('path');

function grimoireBrowserToken() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'secure.config.json'), 'utf8')).grimoireBrowserToken || '';
    } catch (_) {
        return '';
    }
}

module.exports = {
    apps: [{
        name: 'Dreamscape',
        script: './web_server.js',
        cwd: __dirname,
        autorestart: true,
        watch: false,
        // No PM2 io agent. PM2 injects @pm2/io unless pmx:false, and its 5.0.2 config
        // merge calls util._extend, which Node 24 deprecates: DEP0060 pairs in pm2:err
        // at every boot (newest 2026-11-01T12:32:47, pid 1883172). Nothing in this
        // repo uses pmx metrics, so turning the agent off removes the call itself.
        pmx: false,
        // Timestamp every log line (SQLITE_IOERR on 2026-10-15 could not be dated).
        time: true,
        // Cap glibc arenas (Oct 4 mem investigation: ~1.46GB across ~103 arenas).
        // Do NOT add max_memory_restart / cron_restart / watch.
        env: {
            MALLOC_ARENA_MAX: "2",
            NODE_ENV: "production"
        }
    }, {
        name: 'grimoire-browser',
        script: './server.js',
        cwd: path.join(__dirname, 'services', 'grimoire-browser'),
        autorestart: true,
        watch: false,
        // Timestamp every log line (SQLITE_IOERR on 2026-10-15 could not be dated).
        time: true,
        // Give Chromium time to save its profile on restart (shutdown waits up to 6s + 1.5s).
        kill_timeout: 10000,
        // Signal the wrapper only: pm2's tree kill also sent SIGINT straight to Chromium, which then died
        // without its clean exit (profile exit_type Crashed, unsaved cookies lost) before the wrapper's
        // browser.close() could run (Nov 13 2026). The wrapper closes Chromium itself.
        treekill: false,
        env: {
            HOST: '127.0.0.1',
            PORT: '9330',
            GRIMOIRE_BROWSER_TOKEN: grimoireBrowserToken()
        }
    }]
};
