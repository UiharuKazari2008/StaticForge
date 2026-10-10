const assert = require('assert');
const { MCP_INSTRUCTIONS, ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS } = require('../modules/mcpInstructions');
for (const s of [MCP_INSTRUCTIONS, ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS]) {
    assert(/effort/.test(s) && /medium/.test(s) && /high/.test(s), 'effort guidance');
    assert(s.includes('nai-diffusion-5-full-medium'), 'medium model id');
    assert(s.includes('Prefer effort medium by default'), 'medium default');
    assert(s.includes('V5 Medium effort testing'), 'testing memory name');
}
console.log('ok: mcp instructions include V5 effort guidance');
