## 2026-06-06 - [Static Asset Verification & Dynamic Error Announcements]
**Learning:** Absolute path references (e.g., /static_images/) in static HTML fail to resolve when verifying via the 'file://' protocol in Playwright. Additionally, dynamic error messages in PIN pad components are invisible to screen readers without explicit live regions.
**Action:** Always serve the 'public' directory via 'python3 -m http.server' for frontend verification of static apps, and apply 'aria-live="polite"' to error containers to ensure accessible feedback.
