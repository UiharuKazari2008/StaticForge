const { SearchService, setGlobalResources } = require('../modules/searchService');

const mockGlobalResources = {
    getPromptConfig: (opts) => {
        if (opts.path === 'presets') {
            return {
                'Test Preset 1': { model: 'test-model-1' },
                'Another Preset': { model: 'test-model-2' }
            };
        }
        return null;
    }
};

setGlobalResources(mockGlobalResources);

async function run() {
    const service = new SearchService(mockGlobalResources);
    try {
        console.log('Testing searchPresets...');
        const results = await service.searchPresets('test');
        console.log('Success!', results);
        process.exit(0);
    } catch (err) {
        console.error('Failed!', err);
        process.exit(1);
    }
}

run();
