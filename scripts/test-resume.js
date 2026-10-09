const cursorDirector = require('../modules/cursorDirector');
const { spawn } = require('child_process');

async function testResume() {
    const paths = cursorDirector.layout();
    const bwrapBin = cursorDirector.findBwrap();
    const agentBin = cursorDirector.findAgent();
    
    // Ensure login is synced
    cursorDirector.syncCursorCliLogin(paths.home);
    
    const mounts = { args: [], readonly: [] };
    const jail = cursorDirector._test.buildJail(bwrapBin, agentBin, paths, mounts);
    
    const cursorId = 'b827a203-1a32-43f0-aab2-17849d152fe5'; // fake uuid
    
    const args = [
        '--print',
        '--output-format', 'stream-json',
        '--stream-partial-output',
        '--sandbox', 'enabled',
        '--trust',
        '--force',
        '--approve-mcps',
        '--workspace', jail.workspace,
        '--model', 'auto',
        '--resume', cursorId,
        '--',
        'Hello!'
    ];
    
    console.log('Spawning cursor-agent with args:', args);
    const child = spawn(jail.bin, jail.args.concat([jail.agent]).concat(args), {
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
testResume().then(() => process.exit(0)).catch(console.error);
