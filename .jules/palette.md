## 2026-06-15 - [Accessibility & Keyboard Navigation on Login Page]
**Learning:** Interactive non-form elements (like the PIN display div) lack standard keyboard triggers and ARIA states, making them inaccessible to screen readers and keyboard-only users. Using `:focus-visible` is essential for providing clear focus indicators for keyboard users without cluttering the UI for mouse users.
**Action:** Always apply `role="button"`, `tabindex="0"`, and handle `Enter`/`Space` keys for interactive divs. Use `aria-expanded` and `aria-label` to communicate state changes to assistive technologies. Apply high-contrast `:focus-visible` styles to all interactive elements.

## 2026-06-16 - [Dynamic Feedback and Intentional Layout Shifts]
**Learning:** For collapsible or multi-state components (like the PIN pad), visual and programmatic feedback (like ARIA labels) must stay in sync with both user input and the component's visibility. Automatically expanding a minimized component when the user starts typing is a highly intuitive way to handle implicit intent.
**Action:** Ensure `updateAriaAttributes` or similar methods are called whenever the underlying data change (like PIN length), not just on visibility toggles. Use programmatic state triggers (like `togglePinPad(true)`) to react to user keyboard input.
