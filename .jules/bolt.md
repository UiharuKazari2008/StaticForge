## 2026-05-31 - Modifying Sets During Iteration
**Learning:** When replacing `.includes()` array lookups with `.has()` Set lookups in a loop that mutates the collection (e.g., adding unique elements), it is critical to `.add()` the item to the Set alongside pushing it to the original array. Otherwise, the Set gets stale during iteration, and duplicates from the incoming payload bypass the `.has()` check.
**Action:** Always verify if the collection being optimized is mutated within the same iteration loop. If so, apply the mutation to both the target array and the corresponding Set to maintain synchronization.

## 2026-06-01 - Avoid Synchronous I/O in Async Functions
**Learning:** Using synchronous I/O functions like `fs.readdirSync` in an `async` function causes event loop stalls that block the entire server. In directories with many files (50k+), this can stall the loop for >100ms.
**Action:** Always use `fs.promises.readdir` or other async I/O in `async` functions. Combine with `Set` for O(1) lookups if the file list is used for existence checks in loops.
