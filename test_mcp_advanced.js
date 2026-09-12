const { TOOL_DEFS } = require('./modules/mcpAgentFacade');
const { MODULE_DEFS } = require('./modules/mcpModuleRegistry');

console.log(MODULE_DEFS.core_generation.tools.includes('run_client_js'));
console.log(MODULE_DEFS.core_generation.tools.includes('inspect_elements'));
