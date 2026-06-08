## 2026-05-31 - Modifying Sets During Iteration
**Learning:** When replacing `.includes()` array lookups with `.has()` Set lookups in a loop that mutates the collection (e.g., adding unique elements), it is critical to `.add()` the item to the Set alongside pushing it to the original array. Otherwise, the Set gets stale during iteration, and duplicates from the incoming payload bypass the `.has()` check.
**Action:** Always verify if the collection being optimized is mutated within the same iteration loop. If so, apply the mutation to both the target array and the corresponding Set to maintain synchronization.
## 2025-05-14 - Batch SQLite Move Pattern
**Learning:** N+1 query patterns involving moving data between related tables (like receipts to unattributed_receipts) can be optimized from O(N) queries to O(1) using a single INSERT INTO ... SELECT ... JOIN statement.
**Action:** Always look for set-based SQL operations to move or transform data in batches rather than fetching into application memory and re-inserting.
