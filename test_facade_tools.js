// Fake requires to bypass missing modules for this simple test
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'express-rate-limit') return () => {};
    if (id === 'express') return () => {};
    try {
        return originalRequire.apply(this, arguments);
    } catch (e) {
        return {};
    }
};

const facade = require('./modules/mcpAgentFacade');
const registry = require('./modules/mcpModuleRegistry');

console.log("TOOL_DEFS count:", facade.TOOL_DEFS ? facade.TOOL_DEFS.length : 0);

const hasRunClient = facade.TOOL_DEFS.some(t => t.name === 'run_client_js');
const hasInspect = facade.TOOL_DEFS.some(t => t.name === 'inspect_elements');

console.log("has run_client_js:", hasRunClient);
console.log("has inspect_elements:", hasInspect);

if (hasRunClient) {
    const t = facade.TOOL_DEFS.find(t => t.name === 'run_client_js');
    console.log("run_client_js scope:", t.scope);
}

const mod = registry.MODULE_DEFS.core_generation;
console.log("core_generation module tools length:", mod.tools.length);
console.log("core_generation has run_client_js:", mod.tools.includes('run_client_js'));
console.log("core_generation has inspect_elements:", mod.tools.includes('inspect_elements'));
