# ReferenceManager.js Inventory

## Major Regions

*   **1-68:** Setup & Unified Upload Workspace Selector Elements (UI)
*   **69-548:** Variables & Mode Selectors (State/UI)
*   **549-1468:** Reference Browser & Image Loading (Unified display functions)
*   **1469-2334:** Vibe/Reference Refresh & Delete Operations (Logic/Network)
*   **2339-2696:** Reference Manager Workspace Dropdowns & Selectors (UI/Logic)
*   **2697-3734:** Context Menu Configurations & Actions (UI/Logic)
*   **3735-4335:** Unified Upload Modal Management API (UI)
*   **4336-5054:** Metadata Transformation (Logic)
*   **5055-5590:** Vibe Detection & Parsing (Logic)
*   **5591-6627:** Combined Vibe Encoding Modal Functions & File Selection (UI/Logic)
*   **6628-7045:** PNG Metadata Extraction (Logic - ZTXT, LSB Stealth, Parsing)
*   **7046-8297:** Preview & Metadata Display / Reset Upload Modal (UI)
*   **8298-8440:** Toolbar Dropdowns for Textareas (UI)
*   **8441-9445:** File Download & Clipboard URL Handling (Logic/UI)
*   **9446-9740:** Paste Handling, Sizing Helpers & Director Session Creation (Logic/UI)
*   **9741-9983:** Expose Functions Globally & Desktop Shortcuts (Exports/Misc)

## Extract Candidates

1.  **PNG Metadata Extraction (Lines 6628 - 7045):** Contains independent image parsing logic (`extractStealthPayloadBits`, `iTXtDecode`, `readPNGMetadata`, `isValidPNGHeader`, etc.).
    *   *Target:* `public/scripts/comp/reference/pngMetadata.js`
2.  **Context Menu Actions (Lines 2697 - 3734):** Deals exclusively with right-click menu setup and actions.
    *   *Target:* `public/scripts/comp/reference/contextMenu.js`
3.  **Vibe Detection & Parsing (Lines 5055 - 5395):** Independent logic for structure validation and client-side parsing.
    *   *Target:* `public/scripts/comp/reference/vibeParser.js`
4.  **Clipboard & URL Download Handling (Lines 8494 - 9486):** Includes file information display, URL download handling, and paste detection.
    *   *Target:* `public/scripts/comp/reference/clipboardUpload.js`


## Dead / Unreachable / Stub Paths

*   No explicit `throw new Error('Not implemented')` or clear `// TODO` or `// FIXME` dead code tags were found in the file.
*   Various error boundaries (e.g. `console.error('Error toggling show all references:', error);` at line 405, `console.warn('Cannot add vibe references during inpainting');` at 1986, 2028) serve as graceful fallbacks rather than unreachable code.
*   Functions related to legacy tags (e.g., `LEGACY_CHARACTER_ONLY_TAG` usage in `isPrecisionReferenceSystemTag` at 185) support backwards compatibility rather than being entirely dead.
