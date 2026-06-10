## 2025-05-14 - Visual clearance for focus indicators
**Learning:** For custom interactive elements where focus rings are clipped by parent containers (e.g., elements with overflow: hidden), applying matching padding and negative margin (e.g., 'padding: 10px; margin: -10px;') provides visual clearance for focus indicators without affecting the layout flow.
**Action:** Apply padding and negative margin to interactive elements that may have their focus rings clipped by overflow: hidden or tight container bounds.
