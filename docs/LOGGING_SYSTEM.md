# Logging System Documentation

## Overview

The StaticForge logging system has been updated to provide more concise console output while maintaining detailed logs in files for debugging purposes.

## Verbosity Levels

The system supports four verbosity levels:

| Level | Value | Description | Use Case |
|-------|-------|-------------|----------|
| **MINIMAL** | 0 | Only essential messages | Production with minimal output |
| **NORMAL** | 1 | Standard messages (default) | Normal operation |
| **DETAILED** | 2 | Detailed messages | Development and troubleshooting |
| **VERBOSE** | 3 | Full verbose output | Deep debugging (original behavior) |

## Configuration

### Set Verbosity Level

#### Option 1: config.json (Recommended)
```json
{
  "log_verbosity": "NORMAL"
}
```

#### Option 2: Environment Variable
```bash
export LOG_VERBOSITY=DETAILED
```

**Note**: Environment variables override config.json settings.

### Available Levels
- `MINIMAL` - Only critical messages
- `NORMAL` - Standard operation (default)
- `DETAILED` - More context for development
- `VERBOSE` - Full debug output (very detailed)

## Log Files

### Generation Detailed Log
**Location**: `logs/generation-detailed.log`

This file contains:
- Full request data for image generation
- **System messages** (prompt instructions, context, rules)
- **User messages** (the actual prompts being processed)
- **AI responses** (full text replacements, reasoning, and structured output)
- Tool execution parameters and full results
- AI API call details (model, iteration, message counts)
- Context compilation data (time, weather, season)
- Token counts and analysis
- Text replacement operations

### Example Entry
```
================================================================================
NEW GENERATION REQUEST: req_1762705294089_eteqzufpj
Timestamp: 2025-11-09T16:21:34.089Z
================================================================================

--- [req_1762705294089_eteqzufpj] REQUEST_DATA (2025-11-09T16:21:34.089Z) ---
{
  "requestId": "req_1762705294089_eteqzufpj",
  "enableStreaming": true,
  "model": "v4_5",
  "resolution": "normal_portrait",
  "steps": 28,
  "guidance": 6.5,
  "sampler": "EULER_ANC",
  "workspace": "default",
  "hasDynamicGen": true
}

--- [req_1762705294089_eteqzufpj] AI_MESSAGES_SENT (2025-11-09T16:21:35.000Z) ---
{
  "iteration": 1,
  "messages": [
    {
      "index": 0,
      "role": "system",
      "contentPreview": "You are the Director AI for dynamic image generation...",
      "contentLength": 15234,
      "fullContent": "..." // Full system message stored here
    },
    {
      "index": 1,
      "role": "user",
      "contentPreview": "Process this prompt with the provided directive...",
      "contentLength": 3456,
      "fullContent": "..." // Full user message stored here
    }
  ]
}

--- [req_1762705294089_eteqzufpj] TOOL_EXECUTION (2025-11-09T16:21:35.123Z) ---
{
  "tool": "searchTagsBatch",
  "parameters": {
    "tags": ["chubby", "cute pose", "adorable expression"]
  },
  "buildOptions": {
    "model": "grok-4-fast-reasoning",
    "temperature": 0.8
  }
}

--- [req_1762705294089_eteqzufpj] AI_RESPONSE_RAW (2025-11-09T16:21:40.456Z) ---
{
  "responseLength": 2345,
  "citationCount": 0,
  "citations": [],
  "fullResponse": "..." // Full AI response text stored here
}

--- [req_1762705294089_eteqzufpj] AI_RESPONSE_PARSED (2025-11-09T16:21:40.789Z) ---
{
  "responseType": "structured_post_tooling",
  "parsedResponse": {
    "text_replacements": { ... },
    "dialogs": [ ... ],
    "insight_memory": [ ... ]
  }
}
```

### Server Log
**Location**: `logs/server.log`

General server operations and standard logging.

### Error Log
**Location**: `logs/error.log`

Error-level messages only.

## Console Output Examples

### NORMAL Level (Default)
```
🚀 Processing image generation: req_xxx | Model: v4_5 | Resolution: normal_portrait | streaming
🎭 Dynamic generation: req_xxx | directive
📊 Context compiled: Waldorf, autumn, daytime
🤖 Calling AI for dynamic generation
🔧 Tool: searchTagsBatch | Researching chubby tag for VTuber integration...
   ✅ Completed (1109ms)
✅ Replacements validated
📊 Tokens: 216/512 prompt (42%) | 339/512 UC (66%)
🔄 Applied 7 text replacements
```

### MINIMAL Level
```
🚀 Processing image generation: req_xxx | Model: v4_5 | Resolution: normal_portrait
🎭 Dynamic generation: req_xxx
🔄 Applied 7 text replacements
```

### DETAILED Level
```
🚀 Processing image generation: req_xxx | Model: v4_5 | Resolution: normal_portrait | streaming
🎬 Starting streaming image generation...
🎭 Dynamic generation: req_xxx | directive
🌤️ Retrieving weather analysis...
⏰ Local time: 11:21 (America/New_York) | 11/9
📊 Context compiled: Waldorf, autumn, daytime
🤖 Calling AI for dynamic generation
🌡️ Temperature: 0.8
📚 Adding 24 global memories to context
🎯 AI: grok-4-fast-reasoning | Iter 1/8 | 2 msgs | 16 tools
🔧 Tool: searchTagsBatch | Researching chubby tag for VTuber integration...
   🔍 Searching tags batch
   ✅ Completed (1109ms)
✅ Replacements validated
📊 Tokens: 216/512 prompt (42%) | 339/512 UC (66%)
🔄 Applied 7 text replacements
```

### VERBOSE Level
Includes all the detailed output you see currently, plus all verbose internal logging.

## Usage in Code

### Standard Logging
```javascript
const logger = require('./logger');

// Always shown
logger.minimal('Critical operation starting');

// Shown at NORMAL and above
logger.normal('Standard operation message');

// Shown at DETAILED and above
logger.detailed('Detailed debugging info');

// Shown only at VERBOSE level
logger.verbose('Very detailed trace information');
```

### Conditional Logging
```javascript
if (logger.shouldLog(logger.VERBOSITY_LEVELS.VERBOSE)) {
    console.log('Expensive logging operation', complexObject);
}
```

### Generation-Specific Logging
```javascript
// Initialize log for a request
logger.initGenerationLog(requestId);

// Log structured data to file
logger.logGeneration('SECTION_NAME', {
    key: 'value',
    data: dataObject
}, requestId);

// Log summary
logger.logGenerationSummary('Operation completed successfully', requestId);
```

## Benefits

1. **Cleaner Console**: Reduced noise in console output for normal operation
2. **Detailed Files**: Full debugging information preserved in log files
3. **Flexible**: Easy to switch verbosity levels without code changes
4. **Organized**: Generation-specific logs separate from general server logs
5. **Performant**: Expensive logging operations only run at appropriate verbosity levels

## Troubleshooting

### Too much console output
Set verbosity to `MINIMAL` or `NORMAL` in config.json

### Need debugging information
- Check `logs/generation-detailed.log` for request-specific details
- Temporarily set verbosity to `DETAILED` or `VERBOSE`

### Log files too large
- Log files automatically rotate at 10MB
- Up to 14 backup files are kept
- Old files are automatically deleted

## Migration Notes

- Existing `console.log()` statements remain unchanged unless explicitly updated
- Updated modules: `websocketHandlers.js`, `grokService.js`, `dynamicGenerationHandlers.js`, `imageGeneration.js`
- All detailed data is still available in log files
- No functionality is lost, only console output is reduced

