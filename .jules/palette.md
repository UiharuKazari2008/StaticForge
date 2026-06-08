## 2025-05-14 - Non-disruptive focus rings on custom elements
**Learning:** For custom interactive elements (e.g., a `div` with `role="button"`), applying `padding` and an equal negative `margin` ensures that `:focus-visible` outlines are fully visible and not clipped by parent containers, all without causing layout shifts when the element receives focus.
**Action:** Use the padding/negative-margin pattern for focus rings on elements that lack inherent button sizing to ensure accessibility doesn't compromise visual alignment.
