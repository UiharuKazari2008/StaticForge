const cursorDirector = require('../modules/cursorDirector');
const xiDirector = require('../modules/xiDirector');
const { spawn } = require('child_process');

async function testWrenNewChat() {
    console.log('--- Testing Wren (bwrap jail) New Chat with new account ---');
    
    // We are simulating what happens when Wren receives a brand new chat.
    const paths = cursorDirector.layout();
    const bwrapBin = cursorDirector.findBwrap();
    const agentBin = cursorDirector.findAgent();
    
    // 1. Sync the active account
    cursorDirector.syncCursorCliLogin(paths.home);
    
    // 2. Build the jail
    const mounts = { args: [], readonly: [] };
    const jail = cursorDirector._test.buildJail(bwrapBin, agentBin, paths, mounts);
    jail.args.push('--setenv', 'CURSOR_AUTH_TOKEN', 'invalid_token_12345');
    
    console.log('Spawning cursor-agent create-chat in bwrap for Wren...');
    const child = spawn(jail.bin, jail.args.concat([jail.agent, 'create-chat', '--workspace', jail.workspace]), {
        cwd: jail.root,
        stdio: 'pipe'
    });
    
    child.stdout.on('data', b => process.stdout.write(b.toString()));
    let stderr = '';
    child.stderr.on('data', b => { stderr += b.toString(); });
    
    return new Promise(resolve => {
        child.on('close', code => {
            console.log('\nStderr lines:');
            console.log(stderr.trim().split('\n'));
            console.log('\nLast line (what runCursorTurn sees):');
            console.log(stderr.trim().split('\n').pop());
            resolve();
        });
        setTimeout(() => child.kill(), 10000);
    });
}
testWrenNewChat().catch(console.error);
