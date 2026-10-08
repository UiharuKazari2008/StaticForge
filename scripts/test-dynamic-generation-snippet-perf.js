const assert = require('assert');
const fs = require('fs');

// Standalone test for scoreMemoryRelevance without requiring external dependencies (like zod/express)
const content = fs.readFileSync('modules/dynamicGenerationHandlers.js', 'utf8');
const start = content.indexOf('function scoreMemoryRelevance(');
const end = content.indexOf('function selectRelevantMemories(');
const fnCode = content.slice(start, end);

const scoreMemoryRelevance = new Function(
    'memory', 'prompt', 'uc', 'directive', 'context',
    fnCode + '\nreturn scoreMemoryRelevance(memory, prompt, uc, directive, context);'
);

console.log('Testing scoreMemoryRelevance performance & correctness...');

// 1. Basic relevance check
const memory = {
    name: 'Weather Memory',
    description: 'The rainy autumn weather brings dark clouds and cool wind over the city.',
    category: 'weather',
    usage_count: 5,
    confidence: 0.9
};

const result = scoreMemoryRelevance(
    memory,
    'a girl standing in rainy autumn weather',
    'ugly, low quality',
    'golden hour',
    { weather: { condition: 'rain' } }
);

assert.ok(result.score > 0, 'Score should be positive for matching keywords');
assert.ok(result.highlightedDescription.length > 0, 'Highlighted description should be non-empty');
assert.ok(
    result.highlightedDescription.includes('rainy') || result.highlightedDescription.includes('weather'),
    'Snippet should contain relevant matched keywords'
);

// 2. Large description performance test
const longDesc = 'In a quiet mountain village, the morning mist clears as autumn leaves fall softly. '.repeat(100);
const largeMemory = {
    name: 'Village Memory',
    description: longDesc,
    category: 'environment',
    usage_count: 2,
    confidence: 0.8
};

const startTime = Date.now();
const perfResult = scoreMemoryRelevance(
    largeMemory,
    'mountain village with autumn leaves falling in morning mist',
    '',
    '',
    {}
);
const elapsed = Date.now() - startTime;

assert.ok(perfResult.score > 0, 'Score should be computed for long description');
assert.ok(elapsed < 100, `Execution should be fast (took ${elapsed}ms)`);

console.log(`✅ scoreMemoryRelevance regression test passed (${elapsed}ms).`);
