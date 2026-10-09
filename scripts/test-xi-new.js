const xiDirector = require('../modules/xiDirector');
const { spawn } = require('child_process');
const path = require('path');

async function testXiNewChat() {
    console.log('--- Testing Xi (Host) New Chat with new account ---');
    
    // We are simulating what happens when Xi receives a brand new chat.
    const layout = xiDirector.layout();
    const agentBin = xiDirector.findAgent();
    
    // 1. Set up the env
    const env = Object.assign({}, process.env);
    try {
        const authPath = path.join(layout.configDir, 'auth.json');
        const authData = JSON.parse(require('fs').readFileSync(authPath, 'utf8'));
        if (authData.apiKey) {
            env.CURSOR_API_KEY = authData.apiKey;
        } else if (authData.accessToken) {
            env.CURSOR_AUTH_TOKEN = authData.accessToken;
        }
    } catch (_) {}
    
    // 2. Spawn agent
    const workspace = process.cwd();
    
    console.log('Spawning cursor-agent prompt...');
    const child = spawn(agentBin, [
        '--print',
        '--output-format', 'stream-json',
        '--stream-partial-output',
        '--trust',
        '--force',
        '--workspace', workspace,
        '--model', 'auto',
        '--',
        'Hello!'
    ], {
        env,
        stdio: 'pipe'
    });
    
    child.stdout.on('data', b => process.stdout.write(b.toString()));
    let stderr = '';
    child.stderr.on('data', b => { stderr += b.toString(); });
    
    return new Promise(resolve => {
        child.on('close', code => {
            console.log('\nStderr last line:', stderr.trim().split('\n').pop());
            resolve();
        });
        setTimeout(() => child.kill(), 10000);
    });
}
testXiNewChat().catch(console.error);
