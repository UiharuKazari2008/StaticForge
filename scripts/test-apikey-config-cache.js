const assert = require('assert');
const ApiKeyManager = require('../modules/apiKeyManager');

const globalResources = {
    getConfig: ({ path }) => {
        if (path === 'selectedApiKeys') {
            return {};
        }
        return {};
    },
    modifyConfig: (key) => ({
        assign: (path, value) => {
            console.log("Assigned", path, value);
        }
    })
};

const apiKeyManager = new ApiKeyManager(globalResources);

apiKeyManager.SERVICE_METADATA = {
    'test': { label: 'Test' }
};
apiKeyManager.getServiceKeys = () => ['a', 'b', 'c'];

try {
    apiKeyManager.setSelectedIndexInMemory('test', 1);
    console.log("Success");
} catch (e) {
    if (e.message.includes('configCache is not defined')) {
        console.error('Test failed: configCache is not defined');
        process.exit(1);
    }
    console.error(e.message);
    process.exit(1);
}
