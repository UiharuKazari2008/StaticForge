'use strict';

// Times `cursor-agent create-chat` inside the Wren bwrap jail: when the chat id
// appears on stdout vs. when (if ever) the process exits.

const { spawn } = require('child_process');
const cursorDirector = require('../modules/cursorDirector');

const paths = cursorDirector.layout();
cursorDirector.syncCursorCliLogin(paths.home);
const jail = cursorDirector._test.buildJail(cursorDirector.findBwrap(), cursorDirector.findAgent(), paths, { args: [], readonly: [] });
const started = Date.now();
const t = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`;
const child = spawn(jail.bin, jail.args.concat([jail.agent, 'create-chat', '--workspace', jail.workspace]), {
    cwd: jail.root,
    env: { PATH: process.env.PATH || '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', (b) => console.log(`${t()} stdout: ${JSON.stringify(b.toString())}`));
child.stderr.on('data', (b) => console.log(`${t()} stderr: ${JSON.stringify(b.toString())}`));
child.on('close', (code, signal) => { console.log(`${t()} close code=${code} signal=${signal}`); process.exit(0); });
setTimeout(() => { console.log(`${t()} still running after 40s; killing`); child.kill('SIGKILL'); }, 40000);
