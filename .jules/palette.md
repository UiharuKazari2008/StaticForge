## 2025-05-15 - Initial Journal Entry
**Learning:** Found that interactive elements like the PIN display in the login page were implemented as plain divs without ARIA roles or keyboard accessibility, and icon-only buttons lacked descriptive labels for screen readers.
**Action:** Always ensure interactive containers have proper ARIA roles, tabindex, and keyboard listeners, and provide aria-labels for all icon-only interactive elements.
