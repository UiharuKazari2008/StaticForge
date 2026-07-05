## 2026-06-15 - [Accessibility & Keyboard Navigation on Login Page]
**Learning:** Interactive non-form elements (like the PIN display div) lack standard keyboard triggers and ARIA states, making them inaccessible to screen readers and keyboard-only users. Using `:focus-visible` is essential for providing clear focus indicators for keyboard users without cluttering the UI for mouse users.
**Action:** Always apply `role="button"`, `tabindex="0"`, and handle `Enter`/`Space` keys for interactive divs. Use `aria-expanded` and `aria-label` to communicate state changes to assistive technologies. Apply high-contrast `:focus-visible` styles to all interactive elements.

## 2026-07-05 - [Tactile Feedback & Dynamic State for PIN entry]
**Learning:** Providing immediate visual feedback for keyboard-driven interactions (like PIN entry) through programmatic state classes (e.g., `.active`) significantly improves the "feel" of an interface. Synchronizing `tabindex` with the visibility of collapsible components prevents keyboard "ghost" focus on hidden elements, enhancing navigation predictability.
**Action:** Use programmatic feedback classes with scale/color transitions for keyboard shortcuts. Always sync `tabindex="-1"` on interactive elements within collapsed/minimized containers.
