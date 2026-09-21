1.  **Refactor `getActiveWorkspaceCacheFiles` in `modules/workspace.js` to use `getMultipleWorkspaceReferences`**
    -   The `getActiveWorkspaceCacheFiles` method currently calls `getWorkspaceReferences` individually for the `default` workspace and the `currentActiveWorkspace`, resulting in multiple database queries.
    -   It can be optimized to use `getMultipleWorkspaceReferences` passing `['default', currentActiveWorkspace]` to reduce the number of queries to a single one.

2.  **Ensure tests pass**
    -   Validate the server still starts.
