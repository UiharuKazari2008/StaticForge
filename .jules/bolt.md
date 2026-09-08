## 2026-05-31 - Modifying Sets During Iteration
**Learning:** When replacing `.includes()` array lookups with `.has()` Set lookups in a loop that mutates the collection (e.g., adding unique elements), it is critical to `.add()` the item to the Set alongside pushing it to the original array. Otherwise, the Set gets stale during iteration, and duplicates from the incoming payload bypass the `.has()` check.
**Action:** Always verify if the collection being optimized is mutated within the same iteration loop. If so, apply the mutation to both the target array and the corresponding Set to maintain synchronization.

## 2026-09-06 - Gitea Ship Scanning
**Learning:** This repository tracks issues and PRs (ships) via a private Gitea instance at `https://yozora.bluesteel.737.jp.net`, not GitHub, despite having a GitHub origin remote. Gitea APIs can be queried using `curl -k` to bypass self-signed cert errors.
**Action:** When asked to "Scan closed StaticForge issues", always query the Gitea instance rather than assuming it's on GitHub. Also handle JSON payloads where arrays might be `undefined`.

## 2026-09-06 - PNPM Local Link Workaround
**Learning:** `pnpm install` will fail with `ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND` if the local `../NekoAI-JS` workspace doesn't exist.
**Action:** Run `npm run nekoai:registry` before installing dependencies or manually patch `package.json` to bypass the local workspace link constraint if `NekoAI-JS` isn't mounted in the container.
