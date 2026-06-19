## 2026-06-15 - [Accessibility & Keyboard Navigation on Login Page]
**Learning:** Interactive non-form elements (like the PIN display div) lack standard keyboard triggers and ARIA states, making them inaccessible to screen readers and keyboard-only users. Using `:focus-visible` is essential for providing clear focus indicators for keyboard users without cluttering the UI for mouse users.
**Action:** Always apply `role="button"`, `tabindex="0"`, and handle `Enter`/`Space` keys for interactive divs. Use `aria-expanded` and `aria-label` to communicate state changes to assistive technologies. Apply high-contrast `:focus-visible` styles to all interactive elements.

## 2026-06-19 - [Dynamic PIN feedback and Smooth Transitions]
**Learning:** For elements that are normally hidden with `display: none`, smooth CSS transitions can be achieved by overriding the `.hidden` class for that specific element to use `display: block` combined with transitions on `opacity`, `transform`, and `max-height`. Staggered animations on a group of elements (like PIN dots) provide much more engaging feedback for loading states than a single spinner.
**Action:** Use specific class overrides to enable transitions on hidden elements. Implement dynamic `aria-label` updates that reflect the current count of inputs (e.g., "3 digits entered") to provide better context for screen reader users.
