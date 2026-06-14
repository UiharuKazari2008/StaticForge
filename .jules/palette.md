## 2025-05-14 - [Login Accessibility]
**Learning:** Collapsible UI components must manage the 'tabindex' of their children to prevent keyboard users from focusing on hidden elements, which creates a confusing "ghost focus" experience.
**Action:** When toggling a container's visibility or 'minimized' state, also iterate through interactive children and update their 'tabindex' between '0' and '-1' accordingly.
