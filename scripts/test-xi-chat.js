const cursorDirector = require('../modules/cursorDirector');
const xiDirector = require('../modules/xiDirector');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

async function testXi() {
    console.log('--- Testing Xi (host agent) ---');
    
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
    
    child.stdout.on('data', b => {
        const out = b.toString();
        process.stdout.write(out);
        if (out.includes('-')) {
            console.log('\n[SUCCESS] Extracted UUID! Exiting...');
            process.exit(0);
        }
    });
    child.stderr.on('data', b => process.stdout.write('ERR: ' + b.toString()));
    
    return new Promise(resolve => child.on('close', code => {
        console.log('\nXi exit code:', code);
        resolve();
    }));
}
testXi().catch(console.error);
