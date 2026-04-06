# Local Prompt Optimizer

## Overview

The Local Prompt Optimizer is a pre-processing system that optimizes prompts **before** they are sent to the AI in the dynamic generation system. It uses **Moby Thesaurus** for comprehensive synonym lookups and balances token count reduction with semantic strength improvements while **respecting NovelAI emphasis syntax**.

The optimizer provides **multiple ranked alternatives** to the AI, allowing context-aware decision making rather than forcing a single mechanical replacement.

## Key Features

- **Moby Thesaurus Integration**: Uses comprehensive synonym database (72 synonyms for "beautiful", 700+ for "good")
- **Balanced Optimization**: Balances token reduction with semantic strength improvements
- **NovelAI Emphasis Aware**: Respects `#.#::text::`, `{text}`, and `[text]` emphasis syntax
- **Multiple Alternatives**: Provides top 5 alternatives to AI for context-aware decisions
- **Strength-Based Selection**: Uses T5 tokenizer strength ratings to pick powerful replacements
- **Capitalization Handling**: Preserves original capitalization patterns (ALL CAPS, Title Case, lowercase)
- **Context-Aware**: Specialized for image generation prompts (lighting, composition, quality descriptors, etc.)
- **Fully Local**: No AI calls required - uses Moby Thesaurus and vocabulary lookup
- **Selective on Emphasis**: More selective with emphasized text, protecting intentional weighting

## Balanced Scoring System

The optimizer uses a **three-tier scoring strategy** that balances token reduction with strength improvements:

### **Tier 1: Token Reduction (Highest Priority)**
```
Score = (tokens_saved × 100) + strength
```
- Prioritizes saving tokens while considering strength
- For emphasized text (weight > 1.2): rejects if strength decreases

**Example**: "very large" → "huge" (saves 1 token, strength 9.5)  
Score: `(1 × 100) + 9.5 = 109.5` ✅ Always wins

### **Tier 2: Strength Upgrade (Medium Priority)**
```
Score = strength  (if strength_gain ≥ 2.0)
```
- Same token count but significantly stronger
- For emphasized text: requires higher gain based on emphasis weight

**Example**: "nice" (strength 6.0) → "lovely" (strength 8.5)  
Gain: +2.5, Score: `8.5` ✅ Approved

### **Tier 3: Token-for-Strength Trade (Low Priority)**
```
Score = strength - 50  (if strength_gain ≥ 3.0 and tokens_added = 1)
```
- Trades 1 token for major strength improvement
- For emphasized text: requires exceptional gain

**Example**: "good" → "excellent" (+1 token, gain +3.0)  
Score: `10.0 - 50 = -40` ✅ Only if nothing better

## NovelAI Emphasis Handling

The optimizer understands and respects NovelAI emphasis syntax:

### **Numeric Emphasis**
```
1.5::text::     weight = 1.5x
2.0::text::     weight = 2.0x
```

### **Brace Emphasis**
```
{text}          weight = 1.05x (1 pair)
{{text}}        weight = 1.10x (2 pairs)
{{{text}}}      weight = 1.16x (3 pairs)
```

### **Bracket De-emphasis**
```
[text]          weight = 0.95x (1 pair)
[[text]]        weight = 0.90x (2 pairs)
```

### **Combined Emphasis**
```
1.5::{{{text}}}::   weight = 1.5 × 1.16 = 1.74x
```

### **Selectivity Rules**

For emphasized text, the optimizer becomes more selective:

| Emphasis Weight | Token Reduction | Same-Token Upgrade | Token Trade |
|-----------------|-----------------|-------------------|-------------|
| 1.0x (normal) | Any saving | Gain ≥ 2.0 | Gain ≥ 3.0 |
| 1.2x (light) | No weakening | Gain ≥ 2.4 | Gain ≥ 3.4 |
| 1.5x (medium) | No weakening | Gain ≥ 3.0 | Gain ≥ 4.0 |
| 2.0x (heavy) | No weakening | Gain ≥ 4.0 | Gain ≥ 5.0 |

**Result**: Heavily emphasized text is protected - only replaced with exceptionally strong alternatives.

## How It Works

### 1. Initialization
```javascript
const localPromptOptimizer = require('./modules/localPromptOptimizer');
await localPromptOptimizer.initialize();
```

The optimizer loads:
- T5 tokenizer vocabulary with strength ratings
- Moby Thesaurus database (offline synonym lookups)
- Token index for fast lookups

### 2. Optimization Process

When optimize is enabled in dynamic generation:

1. **Token Counting**: Count tokens in original prompts
2. **Phrase Extraction**: Extract all possible phrases (2-6 words) from the prompt
3. **Emphasis Parsing**: Detect NovelAI emphasis syntax and calculate weights
4. **Synonym Lookup**: Query Moby Thesaurus for synonyms (cached for performance)
5. **Strength Analysis**: Look up each synonym in T5 vocabulary for strength ratings
6. **Balanced Scoring**: Score alternatives using three-tier system
7. **Multi-Alternative Collection**: Keep top 5 alternatives per phrase
8. **Best Selection**: Apply highest-scoring alternative locally
9. **AI Alternatives**: Format all alternatives for AI to reconsider
10. **Token Recalculation**: Update token counts after optimization

### 3. Integration with Dynamic Generation

Located in `dynamicGenerationHandlers.js` around line 9292, the optimizer runs:

1. **After** token counting
2. **Before** AI processing
3. **Only when** optimize is enabled

```javascript
if (optimizeEnabled) {
    const optimizationResult = localPromptOptimizer.optimizeGenerationRequest(
        prompt,
        uc,
        characterPrompts,
        {
            minTokenSavings: 1,      // Minimum tokens to save
            minStrength: 5.0,        // Minimum strength score
            preserveCase: true       // Preserve capitalization
        }
    );
}
```

## Replacement Examples

### Quality Descriptors
- `best quality` → `masterpiece` (saves 1 token, strength: 9.4)
- `high quality` → `quality` (saves 1 token, strength: 9.1)
- `highly detailed` → `detailed` (saves 1 token, strength: 9.6)

### Action Phrases
- `is standing` → `stands` (saves 1 token, strength: 9.0)
- `is sitting` → `sits` (saves 1 token, strength: 9.0)
- `is looking at` → `watches` (saves 2 tokens, strength: 8.5)

### Lighting Terms
- `natural lighting` → `daylight` (saves 1 token, strength: 9.5)
- `soft lighting` → `diffused light` (saves 1 token, strength: 8.0)
- `dramatic lighting` → `chiaroscuro` (saves 1 token, strength: 9.0)

### Composition
- `in the center` → `central` (saves 2 tokens, strength: 9.6)
- `in the foreground` → `foreground` (saves 2 tokens, strength: 5.0)
- `out of focus` → `blurred` (saves 1 token, strength: 5.0)

### Descriptive Terms
- `very beautiful` → `stunning` (saves 1 token, strength: 9.6)
- `very large` → `massive` (saves 1 token, strength: 9.5)
- `very bright` → `brilliant` (saves 1 token, strength: 9.4)

## Capitalization Handling

The optimizer preserves the original capitalization pattern:

- **ALL CAPS**: `VERY BEAUTIFUL` → `STUNNING`
- **Title Case**: `Very Beautiful` → `Stunning`
- **lowercase**: `very beautiful` → `stunning`

This ensures the token selection remains appropriate for the model (capitalization affects tokenization).

## Configuration Options

```javascript
{
    minTokenSavings: 1,        // Minimum tokens to save for replacement
    minStrength: 5.0,          // Minimum strength score for alternatives
    preserveCase: true,        // Preserve original capitalization
    maxReplacements: null      // Maximum replacements (null = unlimited)
}
```

## Performance

- **Initialization**: One-time load of vocabulary (~32,000 tokens)
- **Optimization**: < 10ms for typical prompts
- **Memory**: ~5MB for vocabulary and synonym maps
- **Token Savings**: Typically 3-15 tokens per generation request

## Benefits

1. **Reduced Token Count**: Prompts start with fewer tokens before AI processing
2. **Faster AI Processing**: Shorter prompts = faster AI responses
3. **More Headroom**: More room for AI to add context and details
4. **Better Quality**: Replacements use stronger tokens with better semantic weight
5. **Consistent**: Deterministic replacements (same input = same output)
6. **No AI Costs**: Runs locally without API calls

## Example Workflow

### Before Local Optimization
```
Original Prompt: "1girl, very beautiful, is standing in the center, natural lighting, best quality, high quality"
Token Count: 21 tokens
```

### After Local Optimization
```
Optimized Prompt: "1girl, stunning, stands central, daylight, masterpiece, quality"
Token Count: 14 tokens
Tokens Saved: 7 tokens
```

### Then AI Processing
The AI receives the optimized prompt and can add more details within the 512 token limit.

## Extending the Optimizer

### Adding New Replacements

Edit `buildSynonymMappings()` in `localPromptOptimizer.js`:

```javascript
const commonReplacements = [
    // Add your new replacements here
    ['your phrase', ['alternative1', 'alternative2', 'alternative3']],
    // ...
];
```

Alternatives should be ordered by preference (stronger/better first).

### Custom Optimization Strategies

The optimizer can be extended with custom strategies:

1. **Domain-Specific**: Add replacements specific to your use case
2. **Style-Specific**: Different replacements for different art styles
3. **Model-Specific**: Optimize for specific AI models
4. **Language-Specific**: Support for non-English prompts

## Debugging

Enable detailed logging by checking console output:

```
🔧 Applying local pre-optimization to prompts...
✅ Local optimization applied:
   Total tokens saved: 7
   Total changes: 6
   [prompt] 6 replacements, 7 tokens saved
      "very beautiful" → "stunning" (1 tokens, strength: 9.6)
      "is standing" → "stands" (1 tokens, strength: 9.0)
      ...
```

## Limitations

1. **Vocabulary Dependency**: Requires T5 vocabulary file at `securePrompts/t5-vocabulary.json`
2. **English Only**: Current synonym mappings are English-specific
3. **Context Insensitive**: Doesn't understand prompt context (applies rules mechanically)
4. **Static Mappings**: Synonym map must be manually updated
5. **No Semantic Validation**: Doesn't verify semantic equivalence

## Future Enhancements

Potential improvements:

1. **Machine Learning**: Learn optimal replacements from successful generations
2. **Context-Aware**: Consider surrounding words when selecting replacements
3. **Multi-Language**: Support for other languages
4. **Dynamic Strength**: Adjust strength scores based on actual generation results
5. **User Preferences**: Allow users to customize replacement preferences
6. **A/B Testing**: Compare optimized vs non-optimized results

## Integration Points

The optimizer integrates at these points:

1. **Dynamic Generation** (`dynamicGenerationHandlers.js` line 9292): Main integration point
2. **Standalone Usage**: Can be used independently for prompt optimization
3. **API Endpoint**: Could be exposed as a standalone optimization endpoint

## API Reference

### `initialize()`
Initializes the optimizer with vocabulary and synonym mappings.
```javascript
await localPromptOptimizer.initialize();
```

### `optimizePrompt(text, options)`
Optimizes a single prompt text.
```javascript
const result = localPromptOptimizer.optimizePrompt(
    "very beautiful girl is standing",
    { minTokenSavings: 1, minStrength: 5.0 }
);
// result.optimized: "stunning girl stands"
// result.tokensSaved: 2
// result.changes: [...]
```

### `optimizeGenerationRequest(prompt, uc, characterPrompts, options)`
Optimizes a full generation request.
```javascript
const result = localPromptOptimizer.optimizeGenerationRequest(
    prompt,
    uc,
    characterPrompts,
    { minTokenSavings: 1, minStrength: 5.0 }
);
// result.prompt: optimized prompt
// result.uc: optimized UC
// result.characterPrompts: optimized character prompts
// result.stats: optimization statistics
```

## Conclusion

The Local Prompt Optimizer provides a fast, efficient, and deterministic way to reduce token count in prompts before AI processing. It complements the AI-based optimization by providing an initial reduction pass, giving the AI more room to add context and details within token limits.

