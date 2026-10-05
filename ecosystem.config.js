/**
 * PM2 process config for Dreamscape (StaticForge server).
 * Referenced by ./restart and ./reload — env vars persist across pm2 restart.
 *
 * I Spy search indexing (phases 2–7) defaults ON in modules/metadataDatabase.js.
 * No env vars required. Optional kill switch: set any USE_* / WRITE_* to '0'.
 * One-shot backfills: scripts/tools/backfill-*.js (see each script header).
 */
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
    }]
};
