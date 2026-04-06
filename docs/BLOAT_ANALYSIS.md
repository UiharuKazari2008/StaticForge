# Compiled Prompt Bloat Analysis

## What's Currently Saved to Image Metadata

The entire `finalResults` object is saved as `forge_data.dynamic_generation.compiled_prompt` in PNG metadata.

## Properties Actually Used

### Client-Side Usage (app.js, manualModalManager.js)
- `context` - Used for displaying context cards and updating carousel
- `text_replacements` - Used for displaying and managing text replacements
- `character_names` - Used to populate character name inputs
- `generated_image_name` - Used to display suggested image name
- `dialogs` - Used for displaying character dialogs
- `prompt_hash` - Used for cache validation
- `request_hash` - Used for cache validation
- `directive_hash` - Used for cache validation
- `cache_locked` - Used to set lock button state
- `context_locked` - Used to set context lock state
- `preview_image_hash` - Used to load preview images
- `timestamp` - Used for cache expiration checks (15 minutes)
- `usage` - Used for displaying token usage information

### Server-Side Usage (imageGeneration.js, dynamicGenerationHandlers.js)
- `context` - Used for context sharing between stages
- `prompt_hash` - Used for cache validation
- `request_hash` - Used for cache validation
- `directive_hash` - Used for cache validation
- `previousResponseId` - Used for stateful conversation continuation (caching only)
- `initialResponseId` - Used for tracking initial request (caching only)
- `generation_chain` - Used for incrementing chain numbers (caching only)
- `preview_image_hash` - Used to load preview images
- `preview_metadata` - Used for preview image metadata

## Bloat - Properties NOT Used After Generation

### Internal/Transient Data (not needed in saved metadata)
- `success` - Internal flag, always true if saved
- `processed` - Internal flag, always true if saved
- `errors` - AI-registered errors, not used after generation
- `warnings` - AI-registered warnings, not used after generation
- `reasoning` - AI reasoning text, not used after generation
- `citations` - AI citations, not used after generation
- `modifications_made` - Summary of modifications, not used after generation

### Original Prompts (redundant - compiled versions already in PNG metadata)
- `prompt` - Original base prompt (compiled version already saved as `compiled_prompt` in PNG)
- `uc` - Original negative prompt (compiled version already saved as `compiled_uc` in PNG)
- `characterPrompts` - Original character prompts (compiled version already saved as `compiled_characterPrompts` in PNG)
- `modifiedCharacterPrompts` - Modified character prompts (already applied, not needed)

### Caching-Only Data (not needed in image metadata)
- `previousResponseId` - Only needed for API caching, not for image metadata
- `initialResponseId` - Only needed for API caching, not for image metadata
- `generation_chain` - Only needed for chain tracking, not for image metadata

### Detailed Tracking Data (redundant or too detailed)
- `apiCalls` - Detailed array of all API calls (very large, only `usage` summary needed)
- `totalUsage` - Redundant if `usage` is properly structured
- `applied_preset_controls` - Only used for passing through, not needed in saved metadata
- `prompt_analysis` - NEW field from analyzePromptContext, not used anywhere yet

## Recommended Cleanup

### Properties to Keep in Image Metadata:
```javascript
{
    context: {...},                    // Used by client and server
    text_replacements: {...},          // Used by client
    dialogs: [...],                    // Used by client
    character_names: [...],           // Used by client
    generated_image_name: string,      // Used by client
    prompt_hash: string,               // Used for cache validation
    request_hash: string,              // Used for cache validation
    directive_hash: string,            // Used for cache validation
    cache_locked: boolean,             // Used by client
    context_locked: boolean,            // Used by client
    preview_image_hash: string,        // Used by client and server
    preview_metadata: {...},          // Used by server
    timestamp: number,                 // Used for cache expiration
    usage: {...}                       // Used by client (structured usage data)
}
```

### Properties to Remove from Image Metadata:
- `success`, `processed` - Internal flags
- `errors`, `warnings` - Not used after generation
- `reasoning`, `citations`, `modifications_made` - Not used after generation
- `prompt`, `uc`, `characterPrompts`, `modifiedCharacterPrompts` - Redundant (compiled versions in PNG)
- `previousResponseId`, `initialResponseId`, `generation_chain` - Caching only, not needed in image
- `apiCalls` - Too detailed, only `usage` needed
- `totalUsage` - Redundant if `usage` is structured
- `applied_preset_controls` - Not needed in saved metadata
- `prompt_analysis` - Not used anywhere yet

## Size Impact

The `apiCalls` array can be very large (contains full request/response data for each API call). Removing it and other bloat could significantly reduce PNG metadata size.

