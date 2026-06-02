## 2026-06-02 - Accessible Interactive Toggles
**Learning:** Custom interactive elements (like the `.pin-display` toggle) must be explicitly marked with roles and tabindexes, and must handle 'Enter' and 'Space' keys to be truly accessible to keyboard and screen reader users. Simply adding a click listener is insufficient for semantic accessibility.
**Action:** Always verify that any non-standard interactive element has a valid ARIA role and is reachable via keyboard.
