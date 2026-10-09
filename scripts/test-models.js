const cursorDirector = require('../modules/cursorDirector');
const { spawn } = require('child_process');

async function run() {
    const paths = cursorDirector.layout();
    const bwrapBin = cursorDirector.findBwrap();
    const agentBin = cursorDirector.findAgent();
    const mounts = { args: [], readonly: [] };
    cursorDirector.syncCursorCliLogin(paths.home);
    const jail = cursorDirector._test.buildJail(bwrapBin, agentBin, paths, mounts);
    
    console.log('Spawning models in jail...');
    
    const child = spawn(jail.bin, jail.args.concat([jail.agent, 'models']), {
        cwd: jail.root,
        stdio: 'pipe'
    });
    
    child.stdout.on('data', b => console.log('OUT:', b.toString()));
    child.stderr.on('data', b => console.log('ERR:', b.toString()));
    child.on('close', code => console.log('EXIT:', code));
}
run().catch(console.error);
