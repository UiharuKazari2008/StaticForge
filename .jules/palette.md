## 2026-06-15 - [Accessibility & Keyboard Navigation on Login Page]
**Learning:** Interactive non-form elements (like the PIN display div) lack standard keyboard triggers and ARIA states, making them inaccessible to screen readers and keyboard-only users. Using `:focus-visible` is essential for providing clear focus indicators for keyboard users without cluttering the UI for mouse users.
**Action:** Always apply `role="button"`, `tabindex="0"`, and handle `Enter`/`Space` keys for interactive divs. Use `aria-expanded` and `aria-label` to communicate state changes to assistive technologies. Apply high-contrast `:focus-visible` styles to all interactive elements.

## 2026-07-06 - [Dynamic Accessibility & Interaction Feedback]
**Learning:** Appending dynamic state (like digit counts) to an `aria-label` provides essential context for screen reader users on custom interactive components. Visual pulses (using `transform: scale`) for both keyboard and click events create a tactile feel that bridges the gap between physical and digital inputs.
**Action:** Use `aria-label` to communicate internal state of complex custom controls. Implement transient CSS `.active` classes triggered by both mouse and keyboard listeners to ensure consistent tactile feedback across all input methods.
