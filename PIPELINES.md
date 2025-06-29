# Pipelines Feature

The pipelines feature allows you to create multi-step image generation workflows that combine two presets with inpainting.

## How Pipelines Work

A pipeline consists of:
1. **Layer 1**: A preset used to generate the base image
2. **Mask**: Either coordinates [x, y, width, height] or a base64 encoded image
3. **Layer 2**: A preset used for inpainting over the masked area
4. **Resolution**: The resolution for both generation steps
5. **Inpainting Strength**: Optional strength parameter for inpainting (default: 0.7)

The workflow:
1. Generate base image using Layer 1 preset
2. Create a mask (black image with white area for inpainting)
3. Use Layer 2 preset to inpaint over the masked area
4. Return the final result

## Pipeline Configuration

Pipelines are defined in `prompt.config.json`:

```json
{
  "pipelines": {
    "example_pipeline": {
      "layer1": "example",
      "mask": [100, 100, 300, 300],
      "layer2": "example_wallpaper", 
      "resolution": "NORMAL_PORTRAIT",
      "inpainting_strength": 0.7
    }
  }
}
```

### Mask Options

**Coordinates Array**: `[x, y, width, height]`
- Creates a black image with a white rectangle at the specified coordinates
- Example: `[100, 100, 300, 300]` creates a 300x300 white box at position (100,100)

**Base64 Image**: String containing base64 encoded PNG/JPG
- Uses the provided image as the mask
- Will be resized to match the pipeline resolution

## Web UI Integration

Pipelines are now integrated into the web UI:

- **Preset Dropdown**: Shows both presets and pipelines (pipelines are marked with 🔗)
- **Resolution**: Optional for pipelines (uses pipeline's resolution if not specified)
- **Mask Preview**: Eye button (👁️) appears when a pipeline is selected
- **Generation**: Works with or without resolution selection

### UI Behavior

- **Presets**: Require resolution selection, no mask preview
- **Pipelines**: Resolution is optional, mask preview available
- **Mask Preview**: Shows the inpainting mask as an image

## API Endpoints

### Generate Pipeline Image
```
GET /pipeline/:name
```

Query parameters:
- `forceGenerate=true` - Skip cache and regenerate
- `optimize=true` - Return JPEG instead of PNG
- `download=true` - Trigger download
- `resolution=<resolution>` - Override pipeline resolution (optional)

### Preview Pipeline Mask
```
GET /pipeline/:name/mask
```

Returns the mask as a PNG image for preview.

### Save New Pipeline
```
POST /pipeline/save
```

Body:
```json
{
  "name": "my_pipeline",
  "layer1": "preset_name",
  "layer2": "another_preset", 
  "resolution": "NORMAL_PORTRAIT",
  "mask": [100, 100, 300, 300],
  "inpainting_strength": 0.7
}
```

### Get Pipeline Info
```
GET /pipeline/:name/info
```

### List All Pipelines
```
GET /pipelines
```

### Delete Pipeline
```
DELETE /pipeline/:name
```

## Example Use Cases

1. **Character Face Swap**: Use one preset for body, another for face
2. **Background Enhancement**: Use one preset for character, another for background
3. **Style Transfer**: Apply different styles to specific areas
4. **Detail Enhancement**: Add details to specific regions

## Notes

- Upscaling is disabled for both pipeline steps
- Both steps use the same resolution (pipeline's or overridden)
- Results are cached like regular presets
- All endpoints require authentication
- Mask preview shows exactly what area will be inpainted
- Resolution can be overridden via query parameter or UI selection 