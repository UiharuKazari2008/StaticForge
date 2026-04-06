# Kaze (風) System - Migration Examples

The Kaze (風) system (pronounced "kah-zeh", meaning "wind" in Japanese) provides a unified way to manage data flow between modules, functions, and async processes. Inspired by pneumatic tube systems, it allows data to flow seamlessly through your application like messages traveling through air tubes.

## Basic Usage

```javascript
const globalResources = require('./modules/globalResources');
const kaze = globalResources.getDataPlumbing(); // TODO: Future rename to getKaze()

// Store data (named or UUID)
kaze.set('myData', { value: 123 }, {
    temporary: false,
    description: 'My important data',
    category: 'metadata',
    tags: ['important', 'cache']
});

// Get data
const data = kaze.get('myData');

// Store callback function
kaze.setCallback('onMetadataUpdate', (metadata) => {
    console.log('Metadata updated:', metadata);
}, {
    temporary: false,
    category: 'callbacks',
    tags: ['metadata']
});

// Trigger callback
kaze.trigger('onMetadataUpdate', { filename: 'test.png' });

// Subscribe to live updates (pub/sub)
kaze.subscribe('metadata:updated', (data) => {
    console.log('New metadata:', data);
});

// Publish update
kaze.publish('metadata:updated', { filename: 'test.png', metadata: {} });

// Mailbox system (for async data passing)
// Generate UUID for attempt/request
const attemptId = crypto.randomUUID();

// Send data to mailbox (like sending through pneumatic tube)
kaze.setMailbox(`${attemptId}:analysisResults`, analysisData, {
    category: 'tool_results',
    tags: ['analysis', 'workflow']
});

// Receive data from mailbox (blocks until data arrives)
const results = await kaze.waitForMailbox(`${attemptId}:analysisResults`, 30000);

// Or check non-blocking
if (kaze.hasMailbox(`${attemptId}:analysisResults`)) {
    const results = kaze.getMailbox(`${attemptId}:analysisResults`);
}
```

## Migration Examples

### Example 1: Metadata Database Functions

**Before:**
```javascript
// Direct function calls
const metadata = getCachedMetadata(filename);
const allMetadata = getAllMetadata();
```

**After (using Kaze):**
```javascript
// Store metadata using Kaze
kaze.set(`metadata:${filename}`, metadata, {
    temporary: true, // Will be auto-cleaned up
    maxAgeMs: 60 * 60 * 1000, // 1 hour
    category: 'metadata',
    tags: ['image', 'cache']
});

// Subscribe to metadata updates
kaze.subscribe(`metadata:${filename}:updated`, (newMetadata) => {
    // Update UI, invalidate cache, etc.
});

// When metadata changes, publish update
kaze.publish(`metadata:${filename}:updated`, newMetadata);

// Get metadata
const metadata = kaze.get(`metadata:${filename}`);
```

### Example 2: Callback Registration

**Before:**
```javascript
// Store callbacks in module-level variables
let refreshCallback = null;
function setRefreshCallback(cb) {
    refreshCallback = cb;
}
function triggerRefresh() {
    if (refreshCallback) refreshCallback();
}
```

**After (using Kaze):**
```javascript
// Register callback in Kaze
kaze.setCallback('refreshAccountBalance', async () => {
    // Refresh logic
}, {
    temporary: false,
    category: 'account',
    tags: ['balance', 'refresh']
});

// Trigger callback
await kaze.trigger('refreshAccountBalance');
```

### Example 3: Async Process Coordination

**Before:**
```javascript
// Store promises/callbacks for async operations
const pendingOperations = new Map();
pendingOperations.set(operationId, { callback, timestamp });
```

**After (using Kaze):**
```javascript
// Store async operation state
kaze.set(`operation:${operationId}`, {
    status: 'pending',
    timestamp: Date.now()
}, {
    temporary: true,
    maxAgeMs: 5 * 60 * 1000, // 5 minutes
    category: 'operations',
    tags: ['async']
});

// Subscribe to completion
kaze.subscribe(`operation:${operationId}:completed`, (result) => {
    // Handle completion
}, { once: true }); // Auto-unsubscribe after first call

// Publish completion
kaze.publish(`operation:${operationId}:completed`, result);
```

### Example 4: Tool Result Passing (Mailbox Pattern)

**Before:**
```javascript
// Deep parameter passing and smuggling through buildOptions
let publishedAnalysis = null;
if (toolResult?.published_analysis) {
    publishedAnalysis = toolResult.published_analysis;
}
// Pass through multiple function layers...
```

**After (using Kaze Mailboxes):**
```javascript
// Generate attempt UUID
const attemptId = `attempt-${Date.now()}-${crypto.randomUUID()}`;

// Tool handler sends result to mailbox
if (toolCall.function.name === 'publishAnalysisResults') {
    kaze.setMailbox(`${attemptId}:publishedAnalysis`, toolResult.published_analysis, {
        category: 'tool_results',
        tags: ['workflow', 'analysis'],
        removeAfterRead: true
    });
}

// Main handler receives from mailbox (non-blocking check)
const publishedAnalysis = kaze.getMailbox(`${attemptId}:publishedAnalysis`);
```

## Cleanup Strategy

The Kaze system automatically cleans up:
- Items marked as `temporary: true`
- Items older than `maxAgeMs`
- Items unused for `maxUnusedAgeMs` (default: 30 minutes)
- Mailboxes after they're read (if `removeAfterRead: true`)

Permanent items are never auto-cleaned (unless you call `clearAll({ keepPermanent: false })`).

## Benefits

1. **Unified API** - One system for all data/callback management
2. **Auto-cleanup** - Prevents memory leaks from stale data
3. **Discovery** - Query items by category/tag
4. **Pub/Sub** - Decouple modules that need to communicate
5. **Transform Pipelines** - Chain data transformations
6. **Mailbox System** - Clean async data passing without deep parameter smuggling
7. **Tracking** - See usage counts, last accessed, etc.

## Name Origin

**Kaze (風)** means "wind" in Japanese. The name reflects how data flows through the system like messages traveling through pneumatic tubes - swift, invisible, and efficient. Like a bank's pneumatic tube system where messages zip between teller windows, the Kaze system allows data to flow seamlessly between functions and async processes without complex parameter passing.
