# Tag Search Rate Limiting

This document describes the enhanced **session-based** rate limiting system implemented to prevent timeout errors when making tag suggestion API requests to NovelAI.

## Problem

Previously, the system was experiencing frequent timeout errors:
```
Tag suggestion API error for nai-diffusion-4-5-full: Tag suggestion API request timed out after 5 seconds
```

This happened because:
1. Multiple rapid tag search requests could be made simultaneously from the same user session
2. The API has rate limits that weren't being properly enforced
3. Old requests weren't being cancelled when new ones came in
4. **Rate limiting was tracked by query, but in live search the query changes with every keystroke**

## Solution

Implemented a **session+model-based** rolling window rate limiting system with the following features:

### 1. Rate Limiting
- **Throttle**: Maximum 1 request per 650ms between completed requests
- **Session+Model-Based**: Rate limiting is tracked per user session and model combination
- **Queue System**: Requests are queued when rate limit is hit, not cancelled
- **Automatic Cleanup**: Old session+model rate limiters are automatically cleaned up after 5 minutes

### 2. Request Management
- **AbortController**: Uses native AbortController to cancel HTTP requests
- **Request Tracking**: Maintains a map of pending requests by session ID and request ID
- **Smart Cancellation**: Each new request cancels any previous request for that session+model combination
- **Queue System**: Requests wait in a queue when rate limit is hit, maintaining order
- **Session+Model Isolation**: Each user session+model combination has independent rate limiting

### 3. New Cache System
- **Efficient Structure**: `query_idx: { "MODEL_query": [tag_id...] }` and `tags: { "MODEL": { tag_id: { data... } } }`
- **Auto-Incrementing IDs**: Each model maintains its own `n_idx` counter for unique tag IDs
- **Smart Saving**: Debounced saves every 15 minutes with maximum 30-minute intervals
- **Automatic Cleanup**: Removes old entries (24+ hours) and orphaned queries
- **API-Only Caching**: Only caches results from external API calls, not local file searches
- **WebSocket Consistency**: Cached results are sent via WebSocket just like fresh API results



### 4. Enhanced Logging
- **Request Lifecycle**: Logs when requests start, complete, fail, or are queued
- **Performance Metrics**: Tracks timing and success rates per session+model combination
- **Debug Information**: Provides detailed status for troubleshooting per session+model combination
- **Queue Status**: Shows how many requests are waiting in each session+model queue

## Implementation Details

### Core Methods

#### `throttleTagRequest(sessionId, query, model, requestId, ws)`
- Enforces session-based rate limiting
- Queues requests when rate limit is hit
- Sends 'stalled' status to client via WebSocket
- Returns an AbortSignal when request can be processed

#### `markRequestCompleted(sessionId, requestId)`
- Marks a request as completed
- Processes the next request in the session's queue
- Sends 'searching' status to the next queued request

#### `getSessionRateLimitingStats(sessionId)`
- Returns rate limiting status for a specific session
- Shows queue length and processing status
- Useful for monitoring individual user sessions

#### `cancelSessionPendingRequests(sessionId)`
- Manually cancels all pending requests for a specific session
- Clears the session's request queue
- Useful for cleaning up individual user sessions

#### `makeLocalFurryTagRequests(query, model, tagSuggestionsCache, queryHash, ws)`
- Searches local furry tag database (no caching needed)
- Returns results immediately from local files
- No rate limiting required for local searches
- Operates as independent service with its own WebSocket communication

#### `makeLocalAnimeTagRequests(query, model, tagSuggestionsCache, queryHash, ws)`
- Searches local anime tag database (no caching needed)
- Returns results immediately from local files
- No rate limiting required for local searches
- Operates as independent service with its own WebSocket communication

#### `makeTagRequests(query, model, tagSuggestionsCache, queryHash, ws, sessionId)`
- Orchestrates all tag search services (API + local)
- API calls use rate limiting and request cancellation
- Local services run independently without rate limiting
- Combines results from all services
- Manages centralized completion signaling

#### Cache WebSocket Behavior
- **Fresh API Results**: Sent via WebSocket with real-time status updates
- **Cached Results**: Also sent via WebSocket for consistent user experience
- **Status Flow**: `searching` → `search_results_update` → `completed` → `search_results_complete`
- **Same Format**: Cached and fresh results use identical WebSocket message structure
- **Per-Model Caching**: Cache is checked for each individual API model, not globally

#### Service Architecture
- **API Services**: Use rate limiting, caching, and queueing (slower, external calls)
- **Local Services**: Run independently without rate limiting (fast, local files)
- **Service Coordination**: Main method orchestrates all services and manages completion
- **Independent Communication**: Each service handles its own WebSocket status updates
- **Centralized Completion**: Final completion signal sent after all services finish

### WebSocket Integration

New WebSocket message types for monitoring and control:

#### `get_rate_limiting_stats`
```json
{
  "type": "get_rate_limiting_stats",
  "requestId": "unique-id"
}
```

Response:
```json
{
  "type": "rate_limiting_stats_response",
  "data": {
    "totalSessionModels": 3,
    "requestThrottleMs": 650,
    "sessionModelStats": {
      "session123_nai-diffusion-4-5-full": {
        "sessionId": "session123",
        "model": "nai-diffusion-4-5-full",
        "hasRateLimiter": true,
        "lastCompletedRequest": 1234567890,
        "timeSinceLastCompleted": 500,
        "isProcessing": false,
        "pendingRequestCount": 0,
        "queuedRequestsCount": 2,
        "canProcessNext": false
      }
    }
  }
}
```

#### `get_session_rate_limiting_stats`
```json
{
  "type": "get_session_rate_limiting_stats",
  "requestId": "unique-id",
  "model": "nai-diffusion-4-5-full"
}
```

Response:
```json
{
  "type": "session_rate_limiting_stats_response",
  "data": {
    "sessionId": "session123",
    "model": "nai-diffusion-4-5-full",
    "hasRateLimiter": true,
    "lastCompletedRequest": 1234567890,
    "timeSinceLastCompleted": 500,
    "isProcessing": false,
    "pendingRequestCount": 0,
    "queuedRequestsCount": 2,
    "canProcessNext": false
  }
}
```

#### `cancel_pending_requests`
```json
{
  "type": "cancel_pending_requests",
  "requestId": "unique-id"
}
```

Response:
```json
{
  "type": "cancel_pending_requests_response",
  "data": {
    "cancelledCount": 3
  }
}
```

#### `cancel_session_pending_requests`
```json
{
  "type": "cancel_session_pending_requests",
  "requestId": "unique-id",
  "model": "nai-diffusion-4-5-full"
}
```

Response:
```json
{
  "type": "cancel_session_pending_requests_response",
  "data": {
    "cancelledCount": 2
  }
}
```

#### `get_cache_stats`
```json
{
  "type": "get_cache_stats",
  "requestId": "unique-id"
}
```

Response:
```json
{
  "type": "cache_stats_response",
  "data": {
    "queries": 45,
    "totalTags": 1234,
    "models": ["V4-FULL", "NAI-DIFFUSION-FURRY-3"],
    "isDirty": false,
    "lastSaveTime": 1234567890,
    "timeSinceLastSave": 300000,
    "modelStats": {
      "V4-FULL": {
        "tags": 567,
        "queries": 23,
        "nextTagId": 568
      }
    }
  }
}
```

## Configuration

The rate limiting can be configured by modifying these properties in the `SearchService` class:

```javascript
this.requestThrottleMs = 650; // 650ms between completed requests
```

## Monitoring

### Console Logs
The system provides detailed logging with emojis for easy identification:

- 🔄 **Cancelling**: Previous request being cancelled for same session/model
- ⏹️ **Aborted**: Request was superseded by newer search
- ✅ **Success**: Request completed successfully
- ❌ **Error**: Request failed
- ⏰ **Timeout**: Request timed out
- 🔄 **Cleanup**: Old requests being cleaned up
- ⏳ **Queued**: Request queued due to rate limiting
- 🔄 **Processing**: Processing queued request

### Metrics
Monitor these key metrics per session:
- `pendingRequestCount`: Number of active requests
- `queuedRequestsCount`: Number of requests waiting in queue
- `timeSinceLastCompleted`: Time since last completed request
- `canProcessNext`: Whether the next request can be processed
- `isProcessing`: Whether a request is currently being processed

## Testing

Run the test script to verify functionality:

```bash
node test_rate_limiting.js
```

This will test:
1. Basic rate limiting (650ms delay)
2. Request queuing
3. Session isolation
4. Statistics reporting
5. Cleanup functionality

## Benefits

1. **Eliminates Timeout Errors**: Prevents multiple simultaneous requests that cause timeouts
2. **Smart Request Management**: Each new request automatically cancels the previous one for that session+model combination
3. **Better User Experience**: Requests are queued and processed in order when rate limit is hit
4. **Session+Model Isolation**: Each user+model combination has independent rate limiting, preventing cross-session interference
5. **Live Search Friendly**: Works with changing queries in real-time search
6. **Resource Efficiency**: Cancels outdated requests early, queues only when necessary

8. **Monitoring**: Provides visibility into API usage patterns per session+model combination
9. **Debugging**: Detailed logging helps troubleshoot issues per session+model combination

## Troubleshooting

### High Pending Request Count
If you see many pending requests:
1. Check if searches are being triggered rapidly
2. Use `cancel_session_pending_requests` to clear a specific session's queue
3. Monitor session rate limiting stats for throttling issues
4. Check queue lengths to see if requests are backing up

### Requests Still Timing Out
1. Verify the rate limiting is enabled
2. Check console logs for queuing and processing messages
3. Ensure the AbortController is working properly
4. Check if requests are stuck in the queue

### Performance Issues
1. Monitor the `requestThrottleMs` setting (currently 650ms)
2. Check if cleanup is working (should see cleanup logs)
3. Verify request lifecycle logging is present
4. Monitor queue lengths to ensure requests aren't backing up
5. Check session isolation to ensure one user isn't blocking others

## Future Enhancements

Potential improvements:
1. **Adaptive Rate Limiting**: Adjust based on API response times
2. **Request Prioritization**: Handle different types of requests differently
3. **Circuit Breaker**: Stop requests if API is consistently failing
4. **Metrics Dashboard**: Web interface for monitoring rate limiting per session
5. **Query Similarity**: Skip outdated requests based on query similarity rather than exact match
