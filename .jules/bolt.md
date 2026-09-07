## 2024-05-30 - NovelAI Explore API Filters
**Learning:** The NovelAI Explore API (`/post/search`) uses a `oneof` validation pattern that rejects adding fields like `model` or `aspect` directly to the `selectors` array. Filtering by these characteristics requires pushing a `tag` field selector with specific `system:` prefix values.
**Action:** Always verify unknown or assumed API payload structures against the actual upstream API using direct requests (e.g. `curl`) before modifying internal backend schemas.
