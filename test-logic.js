const assert = require('assert');
const pantry = require('./modules/cakePantry');
const mockDb = {
    get: async (sql, params) => {
        if (sql.includes('SELECT value FROM system_settings')) return { value: '1' };
        if (sql.includes("key = 'imported_at'")) return { value: 'yes' };
        return undefined;
    },
    all: async (sql, params) => {
        if (sql.includes('SELECT key, value FROM cake_pantry_state WHERE account_id = ?')) {
            return [
                { key: 'last_consume_at', value: JSON.stringify(new Date(Date.now() - 1000).toISOString()) },
                { key: 'pending_deliveries', value: JSON.stringify([
                    { reason: 'ship:294:3768dcef6bacc106c879f98fe7c229585bd9e832 config-maps' },
                    { reason: 'ship:295:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
                    { reason: 'ship:snapshot:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
                    { reason: 'ship:abcdef0:ffffffffffffffffffffffffffffffffffffffff' }
                ]) }
            ];
        }
        return [];
    },
    run: async () => ({})
};
pantry.setGlobalResources({ getTagDatabase: () => ({ db: mockDb }) });

async function checkReasons() {
    const state = await pantry.getAccountState('menma');
    const cakeLog = await pantry.getCakeLog('menma', 100) || [];
    const pendingDeliveries = state.pending_deliveries || [];

    const deliveredReasons = new Set();
    const bankedPrNumbers = new Set();
    const bankedShas = new Set();

    const parseReason = (reasonStr) => {
        if (!reasonStr) return;
        deliveredReasons.add(reasonStr);
        // Match ship:<num>:<sha> or ship:<shortsha>:<sha> or ship:snapshot:<sha>
        const match = reasonStr.match(/^ship:([^:]+):([a-f0-9]+)/);
        if (match) {
            const token = match[1];
            const sha = match[2];
            // If the token is strictly numeric, it's a PR number
            if (/^\d+$/.test(token)) {
                bankedPrNumbers.add(parseInt(token, 10));
            }
            bankedShas.add(sha);
            if (sha.length >= 7) bankedShas.add(sha.substring(0, 7));
        }
    };

    for (const d of pendingDeliveries) {
        if (d?.reason) parseReason(d.reason);
    }
    for (const l of cakeLog) {
        if (l) {
            if (l.reason) parseReason(l.reason);
            if (Array.isArray(l.named_for)) {
                for (const name of l.named_for) {
                    if (name) parseReason(name);
                }
            }
        }
    }

    console.log("pr numbers", bankedPrNumbers);
    console.log("shas", bankedShas);
}
checkReasons();
