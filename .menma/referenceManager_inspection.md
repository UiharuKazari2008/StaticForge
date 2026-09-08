# Deep Inspection of `public/scripts/comp/referenceManager.js`

## Overview
`referenceManager.js` is a monolithic file (9565 lines) handling multiple distinct domains of the application. The file contains a massive mix of global variable initialization, event bindings, context menus, drag/drop UI handling, API communication, and feature-specific logic.

## Major Regions Mapped
1. **Global Variable Initializations (Lines 1-93)**: UI element selectors for modals (Cache Browser, Cache Manager, Vibe Manager, Unified Upload).
2. **Precise References (Lines 124-385, 996-1468)**: Functions handling precise reference types (character/style tags, UI rendering, toggles).
3. **Cache Browser / Unified Image Displays (Lines 386-995, 1478-1545)**: Image grid rendering, cache image loading, fetching data, filtering.
4. **Vibe Core / Manager (Lines 1546-2187, 5055-5590)**: Managing vibe references, structure validation, parsing vibe JSONs.
5. **Context Menus (Lines 2697-3734)**: Right-click menu configs, event handling, and actions for Reference Browser and Cache Manager.
6. **Unified Upload System (Lines 3754-5054)**: Drag & drop, URL importing, reading file contents, parsing EXIF/metadata, importing blueprints.
7. **Vibe Encoding Modal (Lines 5591-6426)**: UI and API communication specifically for vibe encoding operations.
8. **Initialization / Event Wiring (Lines 7306-7935)**: Wiring keyboard shortcuts, modal listeners, click events, drag-and-drop global listeners.
9. **Utility Functions (Lines 8407-8620, 9111-9125)**: File type detection from bytes, file size/content type formatters.

## Extractable Slices (Proposals)
Here are four safe extractable boundaries that won't require behavior changes or major rewriting:

1. **Context Menu Module (`referenceContextMenu.js`)**
   - **Range:** Lines 2697 - 3734
   - **Scope:** Context menu configs (`createReferenceManagerContextMenuConfig`), attachment/detachment functions, and action handlers (`handleReferenceManagerContextMenuAction`).
   - **Why:** Purely functional UI overlay code that has clear entry and exit points. Uses external cache arrays, but these can remain global or be passed in.

2. **Precise Reference Module (`preciseReferences.js`)**
   - **Range:** Lines 124 - 385, and 996 - 1468
   - **Scope:** Helper checks (`isPrecisionReferenceMetadata`), toggle state handling (`applyPreciseTypeToggleClick`), and creating DOM elements for precise references.
   - **Why:** Highly encapsulated logic specific to handling Lumen-specific reference types.

3. **Unified Upload & File Parsing Module (`unifiedUploadManager.js`)**
   - **Range:** Lines 3754 - 5054
   - **Scope:** `unifiedUploadModalManager` object, file change handlers, metadata transformation logic (`transformRawMetadataForEditor`).
   - **Why:** Distinct logical block handling file uploads and imports (Vibes, Blueprints). Very little coupling with the core cache browser logic.

4. **Vibe Core Utilities (`vibeUtils.js`)**
   - **Range:** Lines 5055 - 5590
   - **Scope:** `detectAndParseVibeFile`, `validateVibeStructure`, `importDownloadedVibeBundle`.
   - **Why:** Data parsing and validation logic that does not heavily depend on the DOM.

## Dead Code & Stubs (Line Ranges)
While the file is highly active, standard empty stub patterns (e.g., empty functions, clearly marked dead paths) are minimal. However, large portions of legacy context menu configs or duplicated DOM query selector logic (`document.getElementById`) are heavily redundant.
