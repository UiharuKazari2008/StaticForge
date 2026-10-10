#!/usr/bin/env node
'use strict';

// Launch the Cursor agent as the active Xi account.
// Reads cursorAccounts.xi.activeAccountId from secure.config.json, starts in a
// clean environment (no inherited CURSOR_*), and passes that account's key
// through a file inside a fresh HOME. Switching the active Xi account takes
// effect on the next launch.
//
//   node scripts/xi-agent-launch.js -- agent --print --workspace ~/staticforge -- hello
//   node scripts/xi-agent-launch.js --workspace ~/staticforge --home-access ~/xi-batches -- agent -p "..."

const xiLaunch = require('../modules/xiLaunch');

function usage() {
    console.error('Usage: node scripts/xi-agent-launch.js [--workspace dir] [--home-access dir] -- [agent args...]');
}

function parse(argv) {
    const opts = { agentArgs: [] };
    const args = argv.slice(2);
    const split = args.indexOf('--');
    const flags = split === -1 ? args : args.slice(0, split);
    opts.agentArgs = split === -1 ? [] : args.slice(split + 1);
    for (let i = 0; i < flags.length; i++) {
        const flag = flags[i];
        if (flag === '--workspace') {
            opts.projectDir = flags[++i];
        } else if (flag === '--home-access') {
            opts.homeAccessDir = flags[++i];
        } else if (flag === '--help' || flag === '-h') {
            opts.help = true;
        } else {
            console.error(`Unknown argument: ${flag}`);
            opts.bad = true;
        }
    }
    return opts;
}

function main() {
    const opts = parse(process.argv);
    if (opts.help || opts.bad || !opts.agentArgs.length) {
        usage();
        process.exit(opts.help && !opts.bad ? 0 : 2);
    }
    let child;
    try {
        child = xiLaunch.spawnLaunch({
            projectDir: opts.projectDir,
            homeAccessDir: opts.homeAccessDir,
            agentArgs: opts.agentArgs,
            detach: false
        });
    } catch (err) {
        console.error(err.message || 'Xi launch failed');
        process.exit(1);
    }
    child.on('exit', (code) => {
        process.exit(code == null ? 1 : code);
    });
}

main();
