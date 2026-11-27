#!/usr/bin/env node
'use strict';
/**
 * Accept an Android app release for the household's phones (StaticForge #1371).
 *
 *   node scripts/android/accept-release.js <versionCode> --by <agent id> --why "<what proved it>" [--dry-run] [--lower]
 *
 * A release is the app's main plus every unmerged branch, proven or not (modules/androidBuilds.js). The household's phones
 * are offered only the accepted release: the one whose versionCode is the accepted mark of coord setting 'androidUpdates'
 * (modules/androidAppUpdatePush.js). Accept a release only when EVERY branch it carries passed its acceptance on a device.
 * This sets the mark: it reads data/android-builds/builds.json, prints the release (id, versionName, build/latest sha,
 * sha256 and every carried branch with its sha) so the caller sees what is being accepted, writes
 *   androidUpdates = { hold: false, accepted, liftedBy, liftedAt, why, prev }   (prev: the old value without its own prev)
 * with the agent-coord store, then asks the running server over the android-builds socket (the one dsapp_build uses) to
 * offer: every online phone is considered again now. With no socket the phones get it at their next hello.
 *
 * Refuses (exit 3): a versionCode that is not a release in builds.json, a release whose APK is no longer kept (no phone could
 * be sent it), and a mark below the existing one unless --lower. --dry-run prints what it would write and
 * writes nothing. Usage errors (--by and --why are required) exit 2.
 *
 * Paths (tests): ACCEPT_RELEASE_BUILDS_JSON (default data/android-builds/builds.json), AGENT_ANDROID_BUILDS_SOCKET (default
 * android-builds.sock next to the coord database), AGENT_COORD_DB (the coord database, as everywhere).
 * Exit codes: 0 done (or dry run), 2 usage, 3 refused.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

const USAGE = 'usage: node scripts/android/accept-release.js <versionCode> --by <agent id> --why "<what proved it>" [--dry-run] [--lower]';
const SETTING = 'androidUpdates';

function usage(message) {
    process.stderr.write(`${message ? `${message}\n` : ''}${USAGE}\n`);
    return 2;
}

/** { code, by, why, dryRun, lower } or { error }. */
function parseArgs(argv) {
    const out = { code: null, by: '', why: '', dryRun: false, lower: false };
    const positional = [];
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--dry-run') out.dryRun = true;
        else if (a === '--lower') out.lower = true;
        else if (a === '--by' || a === '--why' || a.startsWith('--by=') || a.startsWith('--why=')) {
            const key = a.startsWith('--by') ? 'by' : 'why';
            let value;
            if (a.includes('=')) value = a.slice(a.indexOf('=') + 1);
            else { value = argv[i + 1]; i += 1; }
            if (value === undefined || value.startsWith('--')) return { error: `--${key} needs a value` };
            out[key] = value.trim();
        } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
        else positional.push(a);
    }
    if (positional.length !== 1 || !/^\d{1,10}$/.test(positional[0]) || Number(positional[0]) <= 0) return { error: 'give exactly one versionCode (a positive whole number)' };
    out.code = Number(positional[0]);
    if (!out.by) return { error: '--by <agent id> is required' };
    if (!out.why) return { error: '--why "<what proved it>" is required' };
    return out;
}

function buildsFile() {
    return process.env.ACCEPT_RELEASE_BUILDS_JSON || path.join(__dirname, '..', '..', 'data', 'android-builds', 'builds.json');
}

function describe(r) {
    const lines = [
        `release ${r.id}: ${r.versionName} (versionCode ${r.versionCode}), built ${r.createdAt || '?'} on ${r.worker || '?'}`,
        `  build/latest sha ${r.sha}`,
        `  apk ${r.apkFile} ${r.size} bytes, sha256 ${r.sha256}`
    ];
    const branches = Array.isArray(r.branches) ? r.branches : [];
    lines.push(`  carried branches (${branches.length}):`);
    for (const b of branches) lines.push(`    ${b.name}  ${b.sha || '(sha unknown)'}`);
    return lines.join('\n');
}

/** The answer of the running server's android-builds socket, or { unreachable: <why> }. */
function askServer(req, file) {
    return new Promise((resolve) => {
        let buf = '';
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const sock = net.createConnection(file, () => sock.write(`${JSON.stringify(req)}\n`));
        sock.setEncoding('utf8');
        sock.setTimeout(20000, () => { sock.destroy(); finish({ unreachable: 'the server did not answer in time' }); });
        sock.on('data', (c) => { buf += c; });
        sock.on('end', () => {
            try { finish(JSON.parse(buf.trim())); } catch (_) { finish({ unreachable: 'the server answered something unreadable' }); }
        });
        sock.on('error', (e) => finish({ unreachable: e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? 'the android-builds socket is not there' : e.message }));
    });
}

async function main(argv) {
    const args = parseArgs(argv);
    if (args.error) return usage(args.error);

    let index;
    try { index = JSON.parse(fs.readFileSync(buildsFile(), 'utf8')); } catch (e) {
        process.stderr.write(`refused: cannot read ${buildsFile()}: ${e.message}\n`);
        return 3;
    }
    const releases = Array.isArray(index && index.releases) ? index.releases : [];
    const release = releases.find((r) => r && Number(r.versionCode) === args.code);
    if (!release) {
        const known = releases.map((r) => r.versionCode).join(', ') || 'none';
        process.stderr.write(`refused: ${args.code} is not a release in ${buildsFile()} (releases: ${known})\n`);
        return 3;
    }
    process.stdout.write(`${describe(release)}\n`);
    if (!release.apkFile || !fs.existsSync(path.join(path.dirname(buildsFile()), 'apk', String(release.apkFile)))) {
        process.stderr.write(`refused: the APK of ${args.code} (${release.apkFile || 'none'}) is no longer kept, so no phone could be sent it\n`);
        return 3;
    }

    const store = require('../../modules/agentCoord/store');
    let old;
    try { old = store.getSetting(SETTING); } catch (e) {
        process.stderr.write(`refused: cannot read coord setting ${SETTING}: ${e.message}\n`);
        return 3;
    }
    const oldMark = old && typeof old === 'object' ? Number(old.accepted) : 0;
    if (oldMark > args.code && !args.lower) {
        process.stderr.write(`refused: the accepted mark is ${oldMark}, above ${args.code}; --lower lowers it\n`);
        return 3;
    }
    let prev = null;
    if (old && typeof old === 'object') { const { prev: _own, ...rest } = old; prev = rest; } else if (old !== null && old !== undefined) prev = old;
    const value = { hold: false, accepted: args.code, liftedBy: args.by, liftedAt: new Date().toISOString(), why: args.why, prev };

    if (args.dryRun) {
        process.stdout.write(`dry run: would write coord setting ${SETTING} =\n${JSON.stringify(value, null, 2)}\nand ask the server to offer; nothing written.\n`);
        return 0;
    }

    try { store.setSetting(SETTING, value); } catch (e) {
        process.stderr.write(`refused: cannot write coord setting ${SETTING}: ${e.message}\n`);
        return 3;
    }
    process.stdout.write(`written: ${SETTING} accepted ${args.code} (${args.lower && oldMark > args.code ? `lowered from ${oldMark}` : oldMark ? `was ${oldMark}` : 'no mark before'}), by ${args.by}\n`);
    const file = process.env.AGENT_ANDROID_BUILDS_SOCKET || path.join(path.dirname(store.dbPath()), 'android-builds.sock');
    const answer = await askServer({ op: 'offer' }, file);
    if (answer.unreachable) process.stdout.write(`the server was not asked (${answer.unreachable}): the phones get it at their next hello\n`);
    else process.stdout.write(`the server answered: ${JSON.stringify(answer)}\n`);
    try { store.close(); } catch (_) { /* the process ends */ }
    return 0;
}

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`${e.stack || e}\n`); process.exitCode = 1; });
}

module.exports = { main, parseArgs };
