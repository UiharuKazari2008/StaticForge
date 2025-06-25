# StaticForge

A Node.js server for generating AI images using NovelAI's API with advanced features including AI upscaling, text replacements, rate limiting, and dynamic configuration.

## Features

- 🎨 **AI Image Generation** using NovelAI API
- 🔄 **AI Upscaling** with waifu2x-node
- 📝 **Text Replacements** for dynamic prompts
- ⚡ **Rate Limiting** (1 request per 5 seconds)
- 📁 **Organized Storage** (original + upscaled images)
- 🔧 **Dynamic Config Reloading**
- 🎯 **Preset System** for quick generation
- 🛡️ **Paid Tier Validation**
- 📊 **Comprehensive Logging**

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd StaticForge
```

2. Install dependencies:
```bash
npm install
```

3. Create a `config.json` file (see Configuration section)

4. Start the server:
```bash
node server.js
```

## Configuration

Create a `config.json` file in the root directory:

```json
{
    "apiKey": "your-novelai-api-key-here",
    "port": 3000,
    "text_replacements": {
        "CHARACTER": "1girl, anime style",
        "STYLE": "masterpiece, best quality",
        "NEGATIVE": "lowres, bad anatomy, bad hands"
    },
    "presets": {
        "example": {
            "prompt": "<CHARACTER>, <STYLE>, detailed",
            "uc": "<NEGATIVE>",
            "model": "v4_5",
            "resolution": "NORMAL_PORTRAIT",
            "steps": 28,
            "guidance": 7.5
        },
        "high_quality": {
            "prompt": "<CHARACTER>, <STYLE>",
            "model": "v4_5",
            "resolution": "NORMAL_PORTRAIT",
            "steps": 28,
            "upscale": 2
        }
    }
}
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `apiKey` | string | Your NovelAI API key (required) |
| `port` | number | Server port (default: 3000) |
| `text_replacements` | object | Key-value pairs for text replacement |
| `presets` | object | Named presets for quick generation |

## API Endpoints

### 1. Generate Image
**POST** `/api/:model/generate`

Generate an image using a specific model.

**Parameters:**
- `model` (path): Model name (e.g., `v4_5`, `v3`, `furry`)

**Request Body:**
```json
{
    "prompt": "beautiful landscape",
    "uc": "lowres, bad anatomy",
    "resolution": "NORMAL_LANDSCAPE",
    "steps": 28,
    "guidance": 7.5,
    "upscale": 2,
    "seed": 123456789,
    "allow_paid": true,
    "no_save": false
}
```

### 2. Generate from Preset
**GET** `/api/preset/:name`

Generate an image using a predefined preset.

**Parameters:**
- `name` (path): Preset name from config

**Query Parameters:**
- `download` (optional): Set to `true` to force download

### 3. Image-to-Image
**POST** `/api/:model/img2img`

Generate an image from an existing image.

**Parameters:**
- `model` (path): Model name

**Request Body:**
```json
{
    "prompt": "enhanced version",
    "image": "base64-encoded-image",
    "strength": 0.5,
    "steps": 28
}
```

### 4. Get Available Options
**GET** `/api/options`

Returns all available models, samplers, resolutions, and presets.

**Response:**
```json
{
    "models": {
        "V4_5": "v4_5",
        "V3": "v3"
    },
    "samplers": {
        "EULER_ANC": "euler_anc"
    },
    "resolutions": {
        "NORMAL_PORTRAIT": "normal_portrait"
    },
    "presets": ["example", "high_quality"],
    "textReplacements": {
        "CHARACTER": "1girl, anime style"
    }
}
```

## Request Parameters

### Core Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | - | Main prompt for image generation |
| `uc` | string | - | Negative prompt (unwanted elements) |
| `model` | string | - | AI model to use |
| `resolution` | string | - | Predefined resolution preset |
| `width` | number | 512 | Custom width (when not using resolution) |
| `height` | number | 768 | Custom height (when not using resolution) |
| `steps` | number | 28 | Number of generation steps |
| `guidance` | number | 7.5 | Guidance scale |
| `seed` | number | random | Seed for reproducible results |

### Advanced Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `upscale` | number | - | AI upscaling factor (2, 3, 4, etc.) |
| `allow_paid` | boolean | false | Allow paid-tier features |
| `no_save` | boolean | false | Don't save image locally |
| `noQualityTags` | boolean | false | Disable quality tags |
| `ucPreset` | number | 100 | UC preset value |
| `dynamicThresholding` | boolean | false | Enable dynamic thresholding |

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `download` | boolean | Force download instead of display |

## Text Replacements

The server supports dynamic text replacements in prompts and negative prompts. Replacements are defined in `config.json` under the `text_replacements` section.

### Basic Usage

Use `<KEY>` syntax in your prompts to reference replacement values:

```
"prompt": "1girl, <CHARACTER>, <HAIR_COLOR>, <EYE_COLOR>"
```

### Array-Based Random Selection

Text replacements can be arrays, in which case a random item is selected each time:

```json
{
  "text_replacements": {
    "HAIR_COLOR": ["blonde hair", "black hair", "brown hair", "red hair", "blue hair", "purple hair", "pink hair"],
    "EYE_COLOR": ["blue eyes", "green eyes", "brown eyes", "red eyes", "purple eyes", "pink eyes"],
    "POSE": ["standing", "sitting", "lying down", "walking", "running", "dancing"],
    "EXPRESSION": ["smile", "serious", "angry", "sad", "surprised", "wink"]
  }
}
```

When using `<HAIR_COLOR>` in a prompt, it will randomly select one of the hair colors each time.

### Model-Specific Replacements

You can define model-specific versions of replacements by appending the model name:

```json
{
  "text_replacements": {
    "CHARACTER": "1girl, anime style",
    "CHARACTER_V4_5": "1girl, anime style, detailed face",
    "CHARACTER_V3": "1girl, anime style, simple"
  }
}
```

When generating with V4.5, `<CHARACTER>` will use "1girl, anime style, detailed face". For other models, it falls back to the base "CHARACTER" value.

### Special Replacements

- `<PRESET_NAME>`: Automatically replaced with the preset name being used
- `<PICK_<NAME>>`: Randomly selects from all text replacement keys that begin with `NAME`
- Quality and UC presets: Pre-defined negative prompt components for different models

#### PICK_<NAME> Usage

The `PICK_<NAME>` replacement allows you to randomly select from a group of related replacements:

```json
{
  "text_replacements": {
    "GIC_F_1": "girl in casual outfit",
    "GIC_F_2": "girl in formal dress", 
    "GIC_F_3": "girl in school uniform",
    "GIC_F_4": "girl in swimsuit",
    "GIC_F_5": "girl in kimono"
  }
}
```

Using `<PICK_GIC_F_>` in a prompt will randomly select one of the GIC_F_* keys. This is useful for organizing related replacements into groups.

**Note**: The system excludes the exact match (e.g., `GIC_F_` itself) and only considers keys that start with the specified name.

### Validation

The server validates all text replacements and will throw an error if an undefined replacement is used. The `/options` endpoint shows which replacements were used in each generation.

## Presets

Presets are predefined configurations stored in `config.json`. They allow you to quickly generate images with consistent settings.

### Using Presets

#### Basic Preset Usage
```
GET /preset/example
POST /preset/example
```

#### Preset with Resolution Override
```
GET /preset/example/NORMAL_PORTRAIT
POST /preset/example/NORMAL_PORTRAIT
```

#### Preset with Body Overrides
You can override preset values by sending a body with additional parameters (POST requests only):

```json
POST /preset/example
{
  "steps": 50,
  "allow_paid": true,
  "seed": 123456789,
  "guidance": 8.0
}
```

#### Preset with Resolution and Body Overrides
```
POST /preset/example/LARGE_PORTRAIT
{
  "steps": 50,
  "allow_paid": true,
  "seed": 123456789
}
```

### Override Rules

- **Prompt Override**: If a `prompt` is provided in the body, it will be **appended** to the preset's prompt (not replaced)
- **UC Override**: The `uc` (negative prompt) from the body is **ignored** - only the preset's UC is used
- **All Other Parameters**: Can be overridden by the body (steps, guidance, seed, allow_paid, etc.)
- **Resolution Override**: Can be specified in the URL path for quick resolution changes

### Example Preset Configuration
```json
{
  "presets": {
    "example": {
      "prompt": "<NQUALITY>, <DETAILS>, <CHARACTER>, <PICK_GGIRL_>, <HAIR_COLOR>, <EYE_COLOR>, <POSE>, <EXPRESSION>, small breasts, 1.5::huge hips, wide hips, thick calves::, full body, three quarter view | <MANSION_ROOM>",
      "uc": "<NUC_3M>",
      "model": "v4_5",
      "resolution": "NORMAL_PORTRAIT",
      "steps": 24,
      "guidance": 5.5,
      "allow_paid": false
    }
  }
}
```

## Rate Limiting

- **1 request per 5 seconds** after completion
- **Queue system** for handling multiple requests
- **Automatic processing** in order received

## File Storage

### Directory Structure
```
StaticForge/
├── images/          # Original generated images
├── upscaled/        # AI-upscaled versions
└── config.json
```

### File Naming
- **Original**: `YYYY-MM-DD_HH-MM_seed.png`
- **Upscaled**: `upscaled_YYYY-MM-DD_HH-MM_seed.png`

## Paid Tier Features

The following features require `"allow_paid": true`:

- **Steps > 28**: Higher step counts for better quality
- **Large Resolutions**: `LARGE_*` and `WALLPAPER_*` presets
- **Custom Dimensions > 1024**: Width or height exceeding 1024px

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Invalid model` | Unknown model name | Check available models with `/api/options` |
| `Steps value X exceeds maximum of 28` | Steps too high | Set `"allow_paid": true` |
| `Resolution "LARGE_PORTRAIT" requires paid tier` | Large resolution | Set `"allow_paid": true` |
| `Invalid text replacement: <UNKNOWN>` | Unknown replacement | Add to `text_replacements` in config |

## Examples

### Basic Generation
```bash
curl -X POST http://localhost:3000/api/v4_5/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "beautiful landscape",
    "resolution": "NORMAL_LANDSCAPE"
  }'
```

### High-Quality Generation
```bash
curl -X POST http://localhost:3000/api/v4_5/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "anime character",
    "resolution": "LARGE_PORTRAIT",
    "steps": 50,
    "upscale": 2,
    "allow_paid": true
  }'
```

### Using Preset
```bash
curl http://localhost:3000/api/preset/example
```

## Logging

The server provides detailed console logging:

- 🔧 **Request Processing**: Input validation and option building
- 🎲 **Seed Generation**: Random or provided seeds
- 🚀 **Image Generation**: Progress and completion
- 🔍 **Upscaling**: AI upscaling progress
- 💾 **File Operations**: Save/load operations
- ⏰ **Rate Limiting**: Queue and timing information

## Dependencies

- `express`: Web server framework
- `nekoai-js`: NovelAI API client
- `waifu2x-node`: AI image upscaling
- `fs`: File system operations
