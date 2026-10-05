#!/usr/bin/env node
'use strict';

/**
 * Regression test for syncShipCake dedup logic (Yozora #297)
 * Proves that syncShipCake will correctly skip PRs if their PR number OR any of their
 * known commit SHAs match an already delivered reason.
 */

const assert = require('assert');
const pantry = require('../modules/cakePantry');

// We'll mock fetch globally
const globalFetch = global.fetch;

async function runTest() {
    console.log('Running syncShipCake dedup regression test...');

    // Set up mock responses
    const mockIssues = [
        {
            number: 294,
            title: 'Test PR 1 (Manual bank diff sha)',
            closed_at: new Date().toISOString(),
            pull_request: true,
            labels: [],
            assignees: [{ username: 'grok.menma' }],
            user: { username: 'grok.menma' }
        },
        {
            number: 295,
            title: 'Test PR 2 (Same PR num no shared sha)',
            closed_at: new Date().toISOString(),
            pull_request: true,
            labels: [],
            assignees: [{ username: 'grok.menma' }],
            user: { username: 'grok.menma' }
        },
        {
            number: 296,
            title: 'Test PR 3 (Genuinely new)',
            closed_at: new Date().toISOString(),
            pull_request: true,
            labels: [],
            assignees: [{ username: 'grok.menma' }],
            user: { username: 'grok.menma' }
        },
        {
            number: 297,
            title: 'Test PR 4 (Non-numeric shortsha collision test)',
            closed_at: new Date().toISOString(),
            pull_request: true,
            labels: [],
            assignees: [{ username: 'grok.menma' }],
            user: { username: 'grok.menma' }
        }
    ];

    const mockPrs = {
        294: { merge_commit_sha: 'f671a02a0476f55af56ccbdfd66ae29b2cc9f7c8', head: { sha: 'f671a02a0476f55af56ccbdfd66ae29b2cc9f7c8' }, deletions: 100 },
        295: { merge_commit_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', head: { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, deletions: 100 },
        296: { merge_commit_sha: 'cccccccccccccccccccccccccccccccccccccccc', head: { sha: 'cccccccccccccccccccccccccccccccccccccccc' }, deletions: 100 },
        297: { merge_commit_sha: 'dddddddddddddddddddddddddddddddddddddddd', head: { sha: 'dddddddddddddddddddddddddddddddddddddddd' }, deletions: 100 }
    };

    const mockCommits = {
        294: [{ sha: '3768dcef6bacc106c879f98fe7c229585bd9e832' }], // The commit we'll mock as banked
        295: [{ sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }],
        296: [{ sha: 'cccccccccccccccccccccccccccccccccccccccc' }],
        297: [{ sha: 'dddddddddddddddddddddddddddddddddddddddd' }]
    };

    global.fetch = async (url) => {
        if (url.includes('/issues?')) {
            return { json: async () => mockIssues };
        } else if (url.match(/\/pulls\/(\d+)\/commits$/)) {
            const num = url.match(/\/pulls\/(\d+)\/commits$/)[1];
            return { json: async () => mockCommits[num] || [] };
        } else if (url.match(/\/pulls\/(\d+)$/)) {
            const num = url.match(/\/pulls\/(\d+)$/)[1];
            return { json: async () => mockPrs[num] || {} };
        }
        throw new Error('Unknown URL mocked: ' + url);
    };

    // To properly mock everything, we need to mock db behavior
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
            if (sql.includes('SELECT * FROM cake_pantry_log')) return [];
            return [];
        },
        run: async () => ({})
    };

    pantry.setGlobalResources({ getTagDatabase: () => ({ db: mockDb }) });

    try {
        const result = await pantry.syncShipCake('menma', { dry_run: true });

        if (!result.success) {
            console.error(result.error);
        }

        assert.strictEqual(result.success, true);
        const plan = result.plan;

        // We expect PR 294 to be skipped (due to commit sha matching '3768dcef...')
        // We expect PR 295 to be skipped (due to PR number 295 matching 'ship:295:...')
        // We expect PR 296 to be included (genuinely new)
        // We expect PR 297 to be included ('snapshot'/'abcdef0' do not map to PR 297)

        const includedPrs = plan.map(p => p.issue);

        assert.ok(!includedPrs.includes(294), 'Failed (a): PR 294 should be skipped because of commit SHA match');
        assert.ok(!includedPrs.includes(295), 'Failed (b): PR 295 should be skipped because of PR number match');
        assert.ok(includedPrs.includes(296), 'Failed (c): PR 296 should be included as genuinely new');
        assert.ok(includedPrs.includes(297), 'Failed (d): PR 297 should be included; non-numeric token should not collide');

        console.log('✅ Regression test passed.');
    } finally {
        global.fetch = globalFetch;
    }
}

runTest().catch(e => {
    console.error('Test failed', e);
    process.exit(1);
});
