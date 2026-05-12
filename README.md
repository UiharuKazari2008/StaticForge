# Dreamscape

A powerful, feature-rich NovelAI API proxy and workspace built with modern web technologies. Dreamscape serves as an intelligent server-based proxy that enhances NovelAI's image generation capabilities with advanced prompt engineering tools, workspace management, and comprehensive image organization features. Built for power users who want more control, better organization, and enhanced workflow capabilities than the standard NovelAI interface.

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

## 🌟 Key Features

### 🎨 **NovelAI Image Generation**
- **NovelAI API Integration**: Direct integration with NovelAI's powerful image generation models
- **Enhanced Prompt Engineering**: Sophisticated prompt input with real-time token counting and advanced formatting
- **Image-to-Image Generation**: Transform existing images with strength and noise controls
- **Server-Side Proxy**: Handles image storage, metadata management, and API communication
- **Advanced Non-Destructive Image Biasing**: Precise positioning, scaling, and rotation controls for image-to-image and inpainting workflows
- **Dynamic Bias Adjustment**: Real-time preview of image positioning and cropping with client-side and server-side processing

### 🖼️ **Image Management & Organization**
- **Multi-View Gallery**: Switch between Images, Scraps, Pinned, and Upscaled views
- **Infinite Scroll**: Smooth, performance-optimized infinite scrolling with virtual scrolling
- **Bulk Operations**: Select and manage multiple images simultaneously
- **Advanced Search**: Search by prompts, characters, tags, and metadata
- **Sorting Options**: Chronological sorting (newest/oldest first)
- **Image Metadata**: Comprehensive metadata display and management
- **Lightbox Viewer**: Full-screen image viewing with navigation controls
- **Image Relationships**: Automatic detection of original/upscaled image pairs
- **Metadata Caching**: Efficient metadata storage and retrieval system

### 🏢 **Workspace Management**
- **Multiple Workspaces**: Create and manage separate workspaces for different projects
- **Custom Themes**: Personalized color schemes and background colors per workspace
- **Font Customization**: Choose from 20+ fonts for primary and textarea elements
- **Automatic Backgrounds**: Dynamic background transitions between workspaces
- **Workspace Operations**: Move, merge, and organize content between workspaces
- **Image Groups**: Organize images within workspaces using custom groups
- **Workspace Export/Import**: Dump and restore workspace configurations

### 🔧 **Advanced Tools & Utilities**
- **Inpainting System**: Advanced mask editing with brush tools and preview
- **Vibe Encoding Organization**: Hierarchical storage and management of artistic styles for consistent workflow
- **Dataset Tag System**: Hierarchical tag selection for organized content
- **Text Replacement Manager**: Create and manage text expanders and shortcuts for efficient prompt writing
  - **Dynamic Text Expanders**: Create shortcuts that expand to full phrases or paragraphs
  - **Array-based Expansions**: Support for multiple variations and random selections
- **Preset Management**: Save and load generation presets with workspace targeting
  - **Complete Parameter Storage**: Save all generation settings including model, resolution, and advanced parameters
  - **Workspace Targeting**: Apply presets to specific workspaces for project consistency
  - **Quick Generations**: Generate Images from saved presets with one click for rapid workflow
  - **Preset UUID System**: Unique identifiers for presets with REST API access
- **Favorites System**: Save frequently used tags, text replacements, and characters for quick access
- **Queue Management**: Intelligent request queuing with rate limiting and status monitoring
- **Rate Limiting**: Per-session and global rate limiting with detailed statistics
- **Spell Checker**: Real-time spelling correction with custom dictionary support

### 📝 **Prompt Engineering Tools**
- **Random Prompt Generator**: Generate creative prompts with NSFW filtering
- **Emphasis Management**: Weight-based text emphasis with multiple modes
- **Quick Access**: Fast access to frequently used prompts and phrases
- **Advanced Search Autofill System**: Intelligent prompt suggestions and completions with multiple service integrations
  - **NoveAI Tag Autofill**: NovelAI model-specific tag suggestions and organization
  - **Character Autocomplete**: Intelligent character name suggestions and management
  - **Preset Autocomplete**: Quick access to saved generation presets
  - **Danbooru and e621 Tag Autocomplete**: Hidden tag suggestions for more options
  - **Text Replacement Autofill**: Dynamic text expander integration
  - **Intelligent Spellcheck**: Real-time spelling correction and suggestions within autocomplete
- **Inline Search**: Find and replace text within prompts with real-time highlighting

### 🔍 **Reference Management**
- **Reference Browser**: Integrated reference image management with workspace organization
- **Unified Upload System**: Support for images, URLs, and vibe bundles
- **Comprehensive Storage**: Store reference images and vibe encodings for consistent workflows
- **Workspace Integration**: Organize references by project and workspace for better project management

### 🔌 **External Integrations**
- **Sequenzia Integration**: Send images directly to Sequenzia via FileWorker folder for further processing
- **Bulk Export**: Export multiple images to external systems with workspace organization

### ⌨️ **User Experience Features**
- **Keyboard Shortcuts**: Comprehensive keyboard navigation and shortcuts
- **Responsive Design**: Optimized for desktop and mobile devices
- **Confetti Effects**: Celebration animations for successful generations
- **Glass Toast System**: Modern notification system with progress tracking
- **Background Updates**: Intelligent background image updates with animation awareness
- **Session Validation**: Automatic session validation and reconnection handling

### 🔐 **Security & Authentication**
- **PIN Authentication**: Secure access control system with admin and read-only modes
- **Session Management**: Secure user session handling
- **WebSocket Communication**: Real-time updates and notifications
- **Rate Limiting**: Protection against abuse with configurable limits

## 🚀 Getting Started

### Prerequisites
- NovelAI Account with active **Opus** paid subscription
- Server hosting environment for the proxy

### Installation

#### 1. Clone and Setup
```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
source ~/.bashrc

git clone https://yozora.bluesteel.737.jp.net/UiharuKazari2008/StaticForge dreamscape
cd dreamscape
pnpm install
```

#### 2. Configuration
Create `config.json` in the root directory:

```json
{
  "apiKey": "your_novelai_api_key_here",
  "port": 9220,
  "loginKey": "your_login_key",
  "loginPin": "your_admin_pin",
  "readOnlyPin": "your_readonly_pin",
  "sequenziaFolder": "/path/to/sequenzia/upload/folder"
}
```

#### 3. Start Server
```bash
node web_server.js
```

Access at `http://localhost:9220`

### Configuration Options

- **apiKey**: Your NovelAI API key (required)
- **port**: Server port (default: 9220)
- **loginKey**: Admin login key for web interface
- **loginPin**: Admin PIN for full access
- **readOnlyPin**: Read-only user PIN
- **sequenziaFolder**: Path for external integrations

### Basic Usage
1. **Create Images**: Use the Creator button to open the generation interface
2. **Manage Workspaces**: Switch between workspaces using the dropdown menu
3. **Organize Content**: Use the gallery views to organize your images
4. **Advanced Features**: Explore the various tools and utilities for enhanced workflow

## Troubleshooting

### `SQLITE_ERROR: no such table: worldcities` (or “Failed to get location metadata”)

Reverse geolocation uses the **`geo2city`** dependency, which ships a zipped SQLite database and runs a **`postinstall`** script to extract it and build a full-text search index. If that script never runs or stops halfway, `worldcities.db` can be missing, empty, or incomplete, and you will see SQLite errors or a warning when enriching location context.

**Check the database file (pnpm layout):**

```bash
ls -la node_modules/.pnpm/geo2city@*/node_modules/geo2city/worldcities.db
```

A healthy install is several megabytes (not `0` bytes).

**Fix (usual order):**

1. **Install with lifecycle scripts enabled** — This repo sets `ignore-scripts=false` in `.npmrc` and includes `geo2city` in `pnpm.onlyBuiltDependencies` so pnpm is allowed to run its `postinstall`. Do not use `pnpm install --ignore-scripts` here unless you know you must bypass scripts globally.
2. **Re-run the package setup:**
   ```bash
   pnpm install
   pnpm rebuild geo2city
   ```
3. **If the file is still wrong or missing**, force a fresh copy of the package from the registry (then install again):
   ```bash
   pnpm install geo2city --force
   ```

The repo also applies a **pnpm patch** for `geo2city@0.5.0` (`patches/geo2city@0.5.0.patch`) so `pnpm rebuild geo2city` remains usable after the first successful install (upstream deletes `worldcities.db.zip` after extract, which otherwise breaks rebuilds). If you fork or drop the patch, a broken DB may require `--force` reinstall instead of rebuild.

## 🔌 API Endpoints

### Preset Generation Endpoint

The preset endpoint allows you to generate images directly from saved presets via REST API calls.

**Endpoint**: `GET /preset/:uuid`

**Parameters**:
- `:uuid` - The UUID of the preset to use for generation

**Query Parameters for Generation Overrides**:
- `steps` - Override generation steps (integer, positive)
- `guidance` - Override guidance scale (number, positive)
- `rescale` - Override CFG rescale value (number)
- `resolution` - Override resolution preset (case-insensitive named preset)
- `upscale` - Override upscale multiplier (number > 0 or 'true' for 4x default)
- `seed` - Override random seed (integer)
- `variety` - Override variety toggle ('true'/'false')
- `dyna_tod` - Override time-of-day setting (boolean or string)
- `dyna_weather` - Override weather setting (boolean or string)
- `dyna_season` - Override season setting (boolean, 'nearest', or numeric index)
- `dyna_action` - Override action setting (boolean only)
- `dyna_location` - Override location setting (string)
- `dyna_creative` - Override creative mode setting (boolean)
- `dyna_no_cache` - Skip dynamic generation cache ('true'/'false')

**Query Parameters for Output**:
- `workspace` - Target workspace ID (optional, defaults to preset's target workspace)
- `optimize` - Set to 'true' to return JPEG instead of PNG (optional)
- `download` - Set to 'true' to trigger file download (optional)

**Headers Returned**:
- `X-Generated-Filename` - Name of the generated image file
- `X-Preset-UUID` - UUID of the preset used
- `X-Preset-Name` - Name of the preset used
- `Content-Type` - Image format (image/png or image/jpeg)

**Example Usage**:
```bash
# Method 1: Using session cookie (requires web login first)
curl -H "Cookie: connect.sid=your_session_cookie" \
     "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000"

# Method 2: Using loginKey (no session required - recommended for automation)
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key"

# Generate optimized JPEG
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key&optimize=true"

# Download generated image
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key&download=true" \
     -o "generated_image.png"

# Generate in specific workspace
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key&workspace=my_project"
```

**Authentication**: Requires valid session cookie (login via web interface first) OR use `loginKey` parameter for direct access

**Query Parameters for Authentication**:
- `loginKey` - Your configured login key for direct API access without session

**Example Usage with loginKey**:
```bash
# Generate image from preset using loginKey (no session required)
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key"

# Generate optimized JPEG with loginKey
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key&optimize=true"

# Download generated image with loginKey
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key&download=true" \
     -o "generated_image.png"

# Generate in specific workspace with loginKey
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key&workspace=my_project"

# Override generation parameters
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key&steps=28&guidance=6.0&seed=12345"

# Override resolution and enable dynamic generation
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key&resolution=normal_landscape&dyna_tod=true&dyna_weather=true&dyna_season=nearest&dyna_creative=true"

# Skip dynamic generation cache for fresh AI processing
curl "http://localhost:9220/preset/123e4567-e89b-12d3-a456-426614174000?loginKey=your_login_key&dyna_no_cache=true&dyna_weather=true"
```

**Rate Limiting**: Subject to the same queue system as web interface

**Parameter Validation**: All query parameters are validated for correct types and values. Invalid parameters will return a 400 error with detailed validation messages.

### Scheduled Preset Generation Endpoint

The pending preset endpoint allows you to schedule image generation from saved presets for later execution, useful for creating content at specific times or during optimal generation windows.

**Endpoint**: `GET /pending/preset/:uuid`

**Parameters**:
- `:uuid` - The UUID of the preset to use for generation

**Query Parameters for Scheduling**:
- `window` - Time window in seconds for random scheduling (minimum 60 seconds)

**Query Parameters for Generation Overrides** (same as preset endpoint):
- `steps`, `guidance`, `rescale`, `resolution`, `upscale`, `seed`, `variety`
- `tod`, `weather`, `season`, `action`, `location`, `creative`
- `workspace`, `optimize`, `download`, `loginKey`

**Response**: JSON with request ID and scheduled time

**Example Usage**:
```bash
# Schedule preset generation for immediate execution
curl "http://localhost:9220/pending/preset/123e4567-e89b-12d3-a456-426614174000"

# Schedule preset generation within a 2-hour window (7200 seconds)
curl "http://localhost:9220/pending/preset/123e4567-e89b-12d3-a456-426614174000?window=7200&steps=28&resolution=normal_portrait"

# Check status of scheduled request
curl "http://localhost:9220/pending/retrieval/abc123-def456"
```

**Endpoint**: `GET /pending/retrieval/:requestid`

**Response**: JSON with status information or generated image when complete

**Parameter Validation**: Same validation as the preset endpoint applies to all query parameters.

### Test Bias Adjustment Endpoint

**Endpoint**: `POST /test-bias-adjustment`

**Body Parameters**:
- `image_source` - Image source (format: "file:filename" or "cache:hash")
- `target_width` - Target image width
- `target_height` - Target image height
- `bias` - Bias adjustment object with x, y, scale, and rotate properties

**Returns**: Processed image buffer

## 🎯 Use Cases

### For Artists & Designers
- Create concept art and illustrations using NovelAI's advanced models
- Generate reference materials with enhanced prompt control
- Experiment with different artistic styles and techniques
- Build character and world-building assets with organized workflows

### For Content Creators
- Generate social media content with consistent branding
- Create marketing materials with advanced prompt engineering
- Develop visual storytelling elements with workspace organization
- Produce consistent brand imagery across multiple projects

### For Power Users
- Advanced prompt engineering beyond NovelAI's standard interface
- Efficient workspace management for large-scale projects
- Enhanced image organization and metadata management
- Custom workflows and automation capabilities
- REST API access for integration with external tools

### For Developers & Researchers
- Test NovelAI model capabilities with enhanced controls
- Develop advanced prompt engineering skills and techniques
- Integrate with external image processing pipelines
- Build automated image generation workflows

## 🛠️ Technical Architecture

### Frontend Technologies
- **Vanilla JavaScript**: No framework dependencies for maximum performance
- **CSS3**: Modern styling with CSS custom properties
- **HTML5**: Semantic markup and accessibility features
- **WebSockets**: Real-time communication and updates

### Backend Technologies
- **Server-Side Proxy**: NovelAI API integration and management
- **Image Storage**: Efficient storage and retrieval system
- **Metadata Management**: Comprehensive image metadata handling
- **JSON Databases**: Persistent storage for workspaces and settings
- **Queue System**: Intelligent request queuing with rate limiting
- **Session Management**: Secure user session handling

### Key Components
- **Modular Architecture**: Organized into logical component files
- **Event-Driven Design**: Responsive and interactive user experience
- **Performance Optimized**: Virtual scrolling, lazy loading, and efficient DOM manipulation
- **WebSocket Communication**: Real-time updates and notifications
- **Rate Limiting**: Protection against abuse with detailed statistics

## 📞 Support

- **Documentation**: Comprehensive guides and tutorials
- **Community**: Active user community and forums
- **Issues**: Bug reports and feature requests
- **Contact**: Direct support channels

---

**Dreamscape** - Where creativity meets NovelAI technology. Transform your ideas into stunning visual reality with the most advanced NovelAI proxy and workspace available, designed for power users who demand more control and better organization.
