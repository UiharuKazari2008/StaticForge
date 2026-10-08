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
        // Cap glibc arenas (Oct 4 mem investigation: ~1.46GB across ~103 arenas).
        // Do NOT add max_memory_restart / cron_restart / watch.
        env: {
            MALLOC_ARENA_MAX: "2"
        }
    }, {
        name: 'grimoire-browser',
        script: './server.js',
        cwd: path.join(__dirname, 'services', 'grimoire-browser'),
        autorestart: true,
        watch: false,
        env: {
            HOST: '127.0.0.1',
            PORT: '9330',
            GRIMOIRE_BROWSER_TOKEN: grimoireBrowserToken()
        }
    }]
};
