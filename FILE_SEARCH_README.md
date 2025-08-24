# File Search Functionality

## Overview
The file search functionality allows users to search through their image gallery by searching metadata including prompts, character prompts, model names, and other image attributes. The search is performed in real-time via WebSocket communication with debounced input for optimal performance.

## Features

### Search Capabilities
- **Prompt Search**: Search through main generation prompts
- **Character Prompts**: Search through character-specific prompts and names
- **Negative Prompts**: Search through undesired content (UC) prompts
- **Model Names**: Search through AI model names used for generation
- **Preset Names**: Search through preset configurations
- **Receipt Data**: Search through generation receipt information

### Search Modes
- **Images View**: Search through all images
- **Scraps View**: Search through scrap images in current workspace
- **Pinned View**: Search through pinned images in current workspace
- **Upscaled View**: Search through upscaled images only

### User Experience Features
- **Debounced Input**: 300ms delay to prevent excessive API calls
- **Real-time Results**: Instant search results via WebSocket
- **Result Highlighting**: Search terms are highlighted in results
- **Match Scoring**: Results are ranked by relevance
- **Clear Search**: Easy way to clear search and restore gallery
- **Search Indicators**: Visual feedback showing search status and result count

## Usage

### Basic Search
1. Type in the search input field in the gallery header
2. Search results appear automatically after typing stops
3. Gallery filters to show only matching images
4. Use Escape key or clear button to reset search

### Advanced Search
- **Character Names**: Search for specific character names (e.g., "anime girl")
- **Model Types**: Search for specific models (e.g., "nai-diffusion")
- **Prompt Elements**: Search for specific prompt elements (e.g., "masterpiece")
- **Combined Terms**: Use multiple words for more specific results

### Keyboard Shortcuts
- **Enter**: Execute search immediately
- **Escape**: Clear search and restore gallery
- **Tab**: Navigate to next form element

## Technical Implementation

### Backend Components
- **WebSocket Handler**: `handleFileSearch()` in `websocketHandlers.js`
- **Search Engine**: `performFileSearch()` method with metadata parsing
- **Metadata Integration**: Searches through PNG metadata and cache data
- **Cache Management**: Session-based metadata caching for performance

### Frontend Components
- **Search Input**: Debounced input with clear functionality
- **Results Display**: Real-time result count and search indicators
- **Gallery Integration**: Seamless filtering and restoration of gallery state
- **Cache Coordination**: Automatic cache initialization and cleanup

### Search Algorithm
1. **Cache Initialization**: Pre-cache workspace-specific metadata for the current view
2. **Input Processing**: Debounced query processing
3. **Metadata Scanning**: Parse cached PNG metadata and cache data
4. **Pattern Matching**: Case-insensitive substring search
5. **Scoring System**: Rank results by relevance and field importance
6. **Result Filtering**: Apply view-specific filters (scraps, pinned, upscaled)
7. **Cache Cleanup**: Automatic cleanup when search is closed or view changes

### Performance Features
- **Debouncing**: Prevents excessive API calls during typing
- **Session-Based Caching**: Caches workspace-specific metadata for fast searches
- **WebSocket**: Real-time communication without HTTP overhead
- **Efficient Filtering**: Optimized file filtering algorithms
- **Cache Management**: Automatic cache initialization and cleanup

## Configuration

### Debounce Delay
The search debounce delay can be adjusted in `fileSearch.js`:
```javascript
this.debounceDelay = 300; // 300ms debounce
```

### Search Fields and Weights
Search field weights can be modified in `websocketHandlers.js`:
- Character names: 15 points
- Character prompts: 12 points
- Main prompts: 10 points
- Negative prompts: 8 points
- Receipt prompts: 8 points
- Preset names: 7 points
- Model names: 5 points

## Integration Points

### Workspace System
- Integrates with active workspace for scraps and pinned views
- Maintains workspace context during search operations
- Restores original gallery state when search is cleared
- Session-based workspace identification for proper file filtering

### Caching System
- **Session-Based Cache**: Each user session has its own metadata cache
- **View-Specific Caching**: Cache is initialized for the current gallery view
- **Automatic Initialization**: Cache is built on first search request
- **Smart Cleanup**: Cache is cleared when search is closed or view changes
- **Performance Optimization**: Eliminates repeated metadata parsing for subsequent searches

### Gallery System
- Filters `allImages` array for search results
- Preserves original gallery state for restoration
- Updates gallery display in real-time

### WebSocket System
- Uses existing WebSocket infrastructure
- Implements new message type: `search_files`
- Handles search responses and errors

## Error Handling

### Search Errors
- Network timeouts (30 second limit)
- WebSocket connection issues
- Metadata parsing errors
- Workspace integration failures

### Fallback Behavior
- Graceful degradation when workspace functions fail
- Search all files if view-specific filtering fails
- Clear error messages for user feedback

## Future Enhancements

### Potential Improvements
- **Advanced Filters**: Date ranges, resolution filters, model combinations
- **Search History**: Save and reuse previous searches
- **Search Suggestions**: Auto-complete for common terms
- **Export Results**: Save search results to file
- **Batch Operations**: Apply actions to search results
- **Search Analytics**: Track popular search terms

### Performance Optimizations
- **Indexing**: Pre-index metadata for faster searches
- **Pagination**: Handle large result sets more efficiently
- **Caching**: Cache search results for repeated queries
- **Background Processing**: Process searches in background threads

## Troubleshooting

### Common Issues
1. **Search not working**: Check WebSocket connection status
2. **No results**: Verify search terms and metadata availability
3. **Slow performance**: Check metadata cache size and system resources
4. **View filtering issues**: Verify workspace configuration

### Debug Information
- Check browser console for search-related logs
- Monitor WebSocket message traffic
- Verify metadata cache loading
- Check workspace state and permissions
