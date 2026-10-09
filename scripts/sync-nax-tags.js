#!/usr/bin/env node
/**
 * Download https://nax.moe/downloads/tags.zip and import only added, changed,
 * or removed tags. Unchanged ETag / Last-Modified / sha256 is a no-op.
 * Does not restart Dreamscape, recompile, or notify the service worker.
 *
 * Cron on the dreamscape host (daily, no restart):
 *   20 5 * * * cd /home/kanmi/staticforge && /usr/bin/node scripts/sync-nax-tags.js >> /home/kanmi/staticforge/logs/nax-tag-sync.log 2>&1
 *
 * Env:
 *   NAX_TAGS_URL      default https://nax.moe/downloads/tags.zip
 *   NAX_TAGS_DB       default <repo>/.cache/nax_tags.db
 *   NAX_TAG_SYNC_DIR  default <repo>/.cache/nax-tag-sync  (last zip + validators)
 */

const path = require('path');
const { syncNaxTags } = require('../modules/naxTagSync');

async function main() {
    const root = path.join(__dirname, '..');
    const result = await syncNaxTags({
        url: process.env.NAX_TAGS_URL || undefined,
        dbPath: process.env.NAX_TAGS_DB || path.join(root, '.cache', 'nax_tags.db'),
        stateDir: process.env.NAX_TAG_SYNC_DIR || path.join(root, '.cache', 'nax-tag-sync')
    });
    if (result.unchanged) {
        console.log(`[nax-tag-sync] unchanged (${result.reason})`);
        return;
    }
    console.log(`[nax-tag-sync] added=${result.added} updated=${result.updated} removed=${result.removed}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('[nax-tag-sync] ERROR:', err && err.message ? err.message : err);
        process.exit(1);
    });
}

module.exports = { main };
