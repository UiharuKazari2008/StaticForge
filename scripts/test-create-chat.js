const cursorDirector = require('../modules/cursorDirector');
const xiDirector = require('../modules/xiDirector');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

async function testWren() {
    console.log('--- Testing Wren (bwrap jail) ---');
    const paths = cursorDirector.layout();
    const bwrapBin = cursorDirector.findBwrap();
    const agentBin = cursorDirector.findAgent();
    
    // Ensure login is synced
    cursorDirector.syncCursorCliLogin(paths.home);
    
    // Minimal mock for mounts
    const mounts = { args: [], readonly: [] };
    const jail = cursorDirector._test.buildJail(bwrapBin, agentBin, paths, mounts);
    
    console.log('Spawning cursor-agent create-chat in bwrap for Wren...');
    const child = spawn(jail.bin, jail.args.concat([jail.agent, 'create-chat', '--workspace', jail.workspace]), {
        cwd: jail.root,
        stdio: 'pipe'
    });
    
    child.stdout.on('data', b => process.stdout.write(b.toString()));
    child.stderr.on('data', b => process.stdout.write('ERR: ' + b.toString()));
    
    return new Promise(resolve => child.on('close', code => {
        console.log('\nWren exit code:', code);
        resolve();
    }));
}

async function testXi() {
    console.log('\n--- Testing Xi (host agent) ---');
    
    const root = path.join(os.homedir(), '.cache', 'dreamscape-xi');
    const configDir = path.join(root, 'cursor-config');
    
    // Set up Xi config dir
    cursorDirector.installUnrestrictedCli(configDir);
    
    const env = Object.assign({}, process.env);
    env.CURSOR_CONFIG_DIR = configDir;
    env.NO_OPEN_BROWSER = '1';
    env.GIT_TERMINAL_PROMPT = '0';
    env.NO_COLOR = '1';
    
    const workspace = process.cwd(); // mock workspace
    const agentBin = cursorDirector.findAgent();
    
    console.log('Spawning cursor-agent create-chat directly on host for Xi...');
    const child = spawn(agentBin, ['create-chat', '--workspace', workspace], {
        cwd: workspace,
        env,
        stdio: 'pipe'
    });
    
    child.stdout.on('data', b => process.stdout.write(b.toString()));
    child.stderr.on('data', b => process.stdout.write('ERR: ' + b.toString()));
    
    return new Promise(resolve => child.on('close', code => {
        console.log('\nXi exit code:', code);
        resolve();
    }));
}

async function run() {
    await testWren();
    await testXi();
}

run().catch(console.error);
