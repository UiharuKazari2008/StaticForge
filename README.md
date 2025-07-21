# StaticForge

A Node.js Express server for generating AI images using NovelAI's API with advanced features including AI upscaling, text replacements, rate limiting, authentication, and dynamic configuration.

## Preface
> **⚠️ Important Notice:**  
>  
> You are **not permitted** to host this server in an unauthenticated manner or share access with anyone other than yourself.  
>  
> **Per NovelAI Terms of Service, Section 9 (Misconduct):**  
> - You may **not** enable or allow others to use the Services or Software using your account information.  
> - You may **not** host, sublicense, or resell the Services.  
> - Unauthorized sharing or public hosting of this server is a violation of NovelAI's ToS and may result in account termination.  
>  
> **This project is for personal, private use only.**  
>  
> **You must only use this application from your home IP address.**  
> If you access the interface remotely, you must protect it with a PIN number (login key) and never expose it to the public internet without authentication.  
>  
> See [NovelAI ToS Section 9](https://novelai.net/terms-of-service) for details.



## Features

- 🎨 **AI Image Generation** using NovelAI API
- 🔄 **AI Upscaling** with NovelAI's Image Upscaler API
- 📝 **Text Replacements** for dynamic prompts
- ⚡ **Advanced Rate Limiting** with Bottleneck
- 📁 **Organized Storage** (original + upscaled images)
- 🔧 **Dynamic Config Reloading**
- 🎯 **Preset System** for quick generation
- 🛡️ **Authentication** with optional login key
- 📊 **Comprehensive Logging**
- 🔍 **Prompt Preview Endpoints**
- 🎲 **Upscale Override** via query parameters
- 🎞 **Image Optimization** to compress images to JPEG at 75% quality

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

3. Create configuration files (see Configuration section)

4. Start the server:
```bash
node server.js
```

## Configuration

### Main Configuration (`config.json`)

Create a `config.json` file in the root directory:

```json
{
    "apiKey": "your-novelai-api-key-here",
    "port": 3000,
    "loginKey": "your-secret-key-here",
    "allow_paid": true,
    "rateLimit": {
        "generation": {
            "maxConcurrent": 1,
            "minTime": 2000
        },
        "upscaling": {
            "maxConcurrent": 1,
            "minTime": 1000
        }
    }
}
```

### Prompt Configuration (`prompt.config.json`)

Create a `prompt.config.json` file for presets and text replacements:

```json
{
    "text_replacements": {
        "CHARACTER": "1girl, anime style",
        "STYLE": "masterpiece, best quality",
        "NEGATIVE": "lowres, bad anatomy, bad hands",
        "HAIR_COLOR": ["blonde hair", "black hair", "brown hair", "red hair"],
        "EYE_COLOR": ["blue eyes", "green eyes", "brown eyes", "red eyes"],
        "{{hair}}": ["blonde", "brunette", "redhead"],
        "{{eyes}}": ["blue", "green", "brown"]
    },
    "presets": {
        "example": {
            "prompt": "<CHARACTER>, <STYLE>, <HAIR_COLOR>, <EYE_COLOR>",
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
        },
        "anime": {
            "model": "nai-diffusion-3",
            "prompt": "anime girl with {{hair}} hair and {{eyes}} eyes",
            "negative_prompt": "nsfw, nude, naked",
            "resolution": "PORTRAIT"
        }
    }
}
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `apiKey` | string | Your NovelAI API key (required) |
| `port` | number | Server port (default: 3000) |
| `loginKey` | string | Optional authentication key |
| `allow_paid` | boolean | Allow paid-tier features |
| `rateLimit` | object | Rate limiting configuration |

## Authentication

If `loginKey` is set in `config.json`, all requests require authentication:

```
GET /preset/example?auth=your-secret-key
POST /kayra/generate?auth=your-secret-key
```

- **No `loginKey`**: Authentication is disabled
- **With `loginKey`**: All requests must include `?auth=<loginKey>`

## API Endpoints

### 1. Generate Image
**POST** `/:model/generate`

Generate an image using a specific model.

**Parameters:**
- `model` (path): Model name (e.g., `kayra`, `v4_5`, `v3`, `furry`)

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

**Query Parameters:**
- `upscale` (optional): Override upscaling (`true` for 4x, or number like `2`, `1.5`)
- `optimize` (optional): Compress image to JPEG at 75% quality
- `download` (optional): Set to `true` to force download
- `auth` (optional): Authentication key if enabled

### 2. Generate from Preset
**GET** `/preset/:name`

Generate an image using a predefined preset.

**Parameters:**
- `name` (path): Preset name from prompt config

**Query Parameters:**
- `upscale` (optional): Override upscaling
- `optimize` (optional): Compress image to JPEG at 75% quality
- `download` (optional): Force download
- `auth` (optional): Authentication key

### 3. Preset with Resolution Override
**GET** `/preset/:name/:resolution`

Generate using preset with specific resolution.

**Parameters:**
- `name` (path): Preset name
- `resolution` (path): Resolution preset (e.g., `LARGE_PORTRAIT`)

### 4. Image-to-Image
**POST** `/:model/img2img`

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

### 5. Prompt Preview Endpoints

#### Get Processed Prompt (Preset)
**GET** `/preset/:name/prompt`

Returns the processed prompt and negative prompt for a preset.

**Query Parameters:**
- `resolution` (optional): Override resolution
- `upscale` (optional): Override upscaling

#### Get Processed Prompt (Preset with Overrides)
**POST** `/preset/:name/prompt`

Returns processed prompt with body overrides applied.

#### Get Processed Prompt (Direct Model)
**POST** `/:model/prompt`

Returns processed prompt for direct model generation.

### 6. Get Available Options
**GET** `/options`

Returns all available models, samplers, resolutions, presets, and text replacements.

**Response:**
```json
{
    "models": {
        "KAYRA": "kayra",
        "V4_5": "v4_5",
        "V3": "v3"
    },
    "samplers": {
        "EULER_ANC": "euler_anc"
    },
    "resolutions": {
        "NORMAL_PORTRAIT": "normal_portrait"
    },
    "presets": ["example", "high_quality", "anime"],
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
| `width` | number | 1024 | Custom width (when not using resolution) |
| `height` | number | 1024 | Custom height (when not using resolution) |
| `steps` | number | 24 | Number of generation steps |
| `guidance` | number | 5.5 | Guidance scale |
| `seed` | number | random | Seed for reproducible results |

### Advanced Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `upscale` | boolean/number | - | AI upscaling (`true` for 4x, or number) |
| `allow_paid` | boolean | false | Allow paid-tier features |
| `no_save` | boolean | false | Don't save image locally |
| `noQualityTags` | boolean | false | Disable quality tags |
| `ucPreset` | number | 100 | UC preset value |
| `dynamicThresholding` | boolean | false | Enable dynamic thresholding |

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `upscale` | string | Override upscaling (`true` or number) |
| `optimize` | boolean | Compress image to JPEG at 75% quality |
| `download` | boolean | Force download instead of display |
| `auth` | string | Authentication key (if enabled) |

## Upscale Override

You can override upscaling settings per request using query parameters:

### Examples:
```bash
# Default 4x upscaling
GET /preset/example?upscale=true

# Custom 2x upscaling
GET /preset/example?upscale=2

# Custom 1.5x upscaling
POST /kayra/generate?upscale=1.5

# Combine with other params
GET /preset/example?upscale=4&auth=your-key
```

### Priority Order:
1. **Query parameter** (`?upscale=...`) - Highest priority
2. **Body parameter** (`"upscale": ...`) - Medium priority  
3. **Preset setting** (`preset.upscale`) - Lowest priority

## Text Replacements

The server supports dynamic text replacements in prompts and negative prompts. Replacements are defined in `prompt.config.json` under the `text_replacements` section.

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

Using `<PICK_GIC_F_>` in a prompt will randomly select one of the GIC_F_* keys.

### Validation

The server validates all text replacements and will throw an error if an undefined replacement is used.

## Presets

Presets are predefined configurations stored in `prompt.config.json`. They allow you to quickly generate images with consistent settings.

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

### Override Rules

- **Prompt Override**: If a `prompt` is provided in the body, it will be **appended** to the preset's prompt
- **UC Override**: The `uc` (negative prompt) from the body is **ignored** - only the preset's UC is used
- **All Other Parameters**: Can be overridden by the body
- **Resolution Override**: Can be specified in the URL path
- **Upscale Override**: Can be specified via query parameter

## Rate Limiting

The server uses Bottleneck for advanced rate limiting:

- **First 3 requests**: 5-second minimum delay between requests
- **10-minute window**: Limits concurrent requests
- **Queue system**: Requests are queued instead of rejected
- **Separate limiters**: Different limiters for generation and upscaling

## File Storage

### Directory Structure
```
StaticForge/
├── images/          # All generated images (original + upscaled)
├── config.json      # Main configuration
└── prompt.config.json # Presets and text replacements
```

### File Naming
- **Original**: `YYYY-MM-DD_HH-MM_seed.png`
- **Upscaled**: `upscaled_YYYY-MM-DD_HH-MM_seed.png`

## Paid Tier Features

The following features require `"allow_paid": true`:

- **Steps > 28**: Higher step counts for better quality
- **Large Resolutions**: `LARGE_*` and `WALLPAPER_*` presets
- **Custom Dimensions > 1024**: Width or height exceeding 1024px
- **Upscaling**: Any upscaling requires Opus credits

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Invalid model` | Unknown model name | Check available models with `/options` |
| `Steps value X exceeds maximum of 28` | Steps too high | Set `"allow_paid": true` |
| `Resolution "LARGE_PORTRAIT" requires Opus credits` | Large resolution | Set `"allow_paid": true` |
| `Invalid text replacement: <UNKNOWN>` | Unknown replacement | Add to `text_replacements` in prompt config |
| `Authentication required` | Missing auth parameter | Add `?auth=<loginKey>` to request |

## Examples

### Basic Generation
```bash
curl -X POST "http://localhost:3000/kayra/generate?auth=your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "beautiful landscape",
    "resolution": "NORMAL_LANDSCAPE"
  }'
```

### High-Quality Generation with Upscaling
```bash
curl -X POST "http://localhost:3000/kayra/generate?auth=your-key&upscale=2" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "anime character",
    "resolution": "LARGE_PORTRAIT",
    "steps": 50,
    "allow_paid": true
  }'
```

### Using Preset with Upscale Override
```bash
curl "http://localhost:3000/preset/example?auth=your-key&upscale=true"
```

### Prompt Preview
```bash
curl "http://localhost:3000/preset/example/prompt?auth=your-key"
```

## Logging

The server provides detailed console logging:

- 🔧 **Request Processing**: Input validation and option building
- 🎲 **Seed Generation**: Random or provided seeds
- 🚀 **Image Generation**: Progress and completion
- 🔍 **Upscaling**: AI upscaling progress with NovelAI API
- 💾 **File Operations**: Save/load operations
- ⏰ **Rate Limiting**: Queue and timing information
- 🔐 **Authentication**: Auth validation and success/failure

## Dependencies

- `express`: Web server framework
- `nekoai-js`: NovelAI API client
- `sharp`: Image processing and metadata extraction
- `bottleneck`: Advanced rate limiting
- `adm-zip`: ZIP file extraction for upscaled images
- `fs`: File system operations (built-in)
- `path`: Path utilities (built-in)
- `https`: HTTPS requests (built-in)

## Recent Updates

- ✅ **NovelAI Upscaling**: Replaced waifu2x with NovelAI's Image Upscaler API
- ✅ **Authentication**: Added optional login key authentication
- ✅ **Config Separation**: Moved presets and text replacements to `prompt.config.json`
- ✅ **Advanced Rate Limiting**: Implemented Bottleneck with separate limiters
- ✅ **Upscale Override**: Added query parameter support for per-request upscaling
- ✅ **Prompt Preview**: Added endpoints to preview processed prompts
- ✅ **ZIP Extraction**: Added support for NovelAI's ZIP response format
- ✅ **Code Cleanup**: Removed unused dependencies and optimized code
- ✅ **Image Optimization**: Added support for compressing images to JPEG at 75% quality
