#!/usr/bin/env node
/**
 * Parse host-deploy flags from PR labels + body + title.
 *
 * Labels (missing = off):
 *   deploy:restart-server
 *   deploy:push-clients
 *   deploy:restart-clients
 *
 * Reason: first body line matching Reason: / Toast: / Deploy reason:
 * Fallback: PR title. Rejects HTML angle brackets.
 *
 * CLI:
 *   node scripts/ci/parse-deploy-flags.js --labels a,b --body "..." --title "..."
 *   node scripts/ci/parse-deploy-flags.js --self-test
 *   echo '{"labels":[...],"body":"...","title":"..."}' | node scripts/ci/parse-deploy-flags.js --stdin
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LABEL_RESTART_SERVER = 'deploy:restart-server';
const LABEL_PUSH_CLIENTS = 'deploy:push-clients';
const LABEL_RESTART_CLIENTS = 'deploy:restart-clients';

const REASON_LINE_RE = /^\s*(?:Reason|Toast|Deploy\s+reason)\s*:\s*(.+?)\s*$/im;

/**
 * @param {{ labels?: string[]|string, body?: string, title?: string }} input
 * @returns {{
 *   restartServer: boolean,
 *   pushClients: boolean,
 *   restartClients: boolean,
 *   reason: string,
 *   reasonSource: 'body'|'title'|'empty',
 *   error?: string
 * }}
 */
function parseDeployFlags(input) {
    const raw = input && typeof input === 'object' ? input : {};
    let labels = [];
    if (Array.isArray(raw.labels)) {
        labels = raw.labels.map((l) => String(l).trim()).filter(Boolean);
    } else if (typeof raw.labels === 'string') {
        labels = raw.labels.split(/[,;\s]+/).map((l) => l.trim()).filter(Boolean);
    }

    const labelSet = new Set(labels.map((l) => l.toLowerCase()));
    const restartServer = labelSet.has(LABEL_RESTART_SERVER);
    const pushClients = labelSet.has(LABEL_PUSH_CLIENTS);
    const restartClients = labelSet.has(LABEL_RESTART_CLIENTS);

    const body = typeof raw.body === 'string' ? raw.body : '';
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';

    let reason = '';
    let reasonSource = 'empty';
    const match = body.match(REASON_LINE_RE);
    if (match && match[1]) {
        reason = match[1].trim();
        reasonSource = 'body';
    } else if (title) {
        reason = title;
        reasonSource = 'title';
    }

    if (reason && /[<>]/.test(reason)) {
        return {
            restartServer,
            pushClients,
            restartClients,
            reason: '',
            reasonSource: 'empty',
            error: 'reason must be plain text (no < or >)'
        };
    }

    return {
        restartServer,
        pushClients,
        restartClients,
        reason,
        reasonSource
    };
}

function runSelfTest() {
    const fixturesDir = path.join(__dirname, 'fixtures');
    const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort();
    let failed = 0;
    for (const file of files) {
        const full = path.join(fixturesDir, file);
        const fixture = JSON.parse(fs.readFileSync(full, 'utf8'));
        const got = parseDeployFlags(fixture.input || {});
        const expect = fixture.expect || {};
        const keys = ['restartServer', 'pushClients', 'restartClients', 'reason', 'reasonSource', 'error'];
        const diffs = [];
        for (const key of keys) {
            const e = expect[key];
            const g = got[key];
            if (e === undefined && g === undefined) continue;
            if (e === undefined && key === 'error' && g === undefined) continue;
            if (JSON.stringify(e) !== JSON.stringify(g)) {
                diffs.push(`${key}: expected ${JSON.stringify(e)} got ${JSON.stringify(g)}`);
            }
        }
        if (diffs.length) {
            failed += 1;
            console.error(`FAIL ${file}`);
            diffs.forEach((d) => console.error(`  ${d}`));
        } else {
            console.log(`ok ${file}`);
        }
    }
    if (failed) {
        console.error(`${failed} fixture(s) failed`);
        process.exit(1);
    }
    console.log(`All ${files.length} fixtures passed`);
}

function parseArgs(argv) {
    const out = { labels: '', body: '', title: '', stdin: false, selfTest: false, help: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--self-test') out.selfTest = true;
        else if (a === '--stdin') out.stdin = true;
        else if (a === '-h' || a === '--help') out.help = true;
        else if (a === '--labels') out.labels = argv[++i] || '';
        else if (a === '--body') out.body = argv[++i] || '';
        else if (a === '--title') out.title = argv[++i] || '';
        else if (a === '--labels-file') {
            const p = argv[++i];
            out.labels = fs.readFileSync(p, 'utf8');
        } else if (a === '--body-file') {
            const p = argv[++i];
            out.body = fs.readFileSync(p, 'utf8');
        } else {
            console.error(`Unknown arg: ${a}`);
            process.exit(2);
        }
    }
    return out;
}

function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log(`Usage:
  node scripts/ci/parse-deploy-flags.js --labels a,b --body "..." --title "..."
  node scripts/ci/parse-deploy-flags.js --stdin
  node scripts/ci/parse-deploy-flags.js --self-test`);
        process.exit(0);
    }
    if (args.selfTest) {
        runSelfTest();
        return;
    }

    let input;
    if (args.stdin) {
        const raw = fs.readFileSync(0, 'utf8');
        input = JSON.parse(raw || '{}');
    } else {
        let labels = args.labels;
        try {
            const parsed = JSON.parse(labels);
            if (Array.isArray(parsed)) labels = parsed;
        } catch (_) { /* comma list */ }
        input = { labels, body: args.body, title: args.title };
    }

    const result = parseDeployFlags(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.error) process.exit(1);
}

module.exports = { parseDeployFlags, LABEL_RESTART_SERVER, LABEL_PUSH_CLIENTS, LABEL_RESTART_CLIENTS };

if (require.main === module) {
    main();
}
