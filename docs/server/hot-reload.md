# Reloading a server module without a restart (#1292)

Yukimi, 26.11.2026: "we need a high priority task to develop a way to separate and reload modules in the server independently".
A full `pm2 restart Dreamscape` waits on every agent with uncommitted server files and drops phones for up to ~40 s. Most
changes touch one module: only that module reloads.

## Which modules reload

| Reloadable (once marked) | Never reloaded (restart) |
| --- | --- |
| Fleet: `agentSupervisor.js`, `fleetDeps.js`, `fleetLanding.js`, `fleetKill.js`, `fleetMaintenance.js` | `hotReload.js` itself, `web_server.js`, `globalResources` / `bootstrap/*` |
| WS handlers in `modules/ws/handlers/` that are marked | `websocketHandlers.js`, `ws/registerAllWsHandlers.js`, `ws/wsPacketRegistry.js`, `ws/wsMessageDispatcher.js` (they hold the sockets and the packet table) |
| Stateless helpers that are marked | DB openers (`agentCoord/store*.js`, `bootstrap/databases.js`), socket / HTTP owners, pm2-level services |

A module is reloadable only when it marks itself. Unmarked = not reloadable: the reload script says which file needs
`scripts/restart-dreamscape.sh` instead.

## The hot API (`modules/hotReload.js`)

```js
module.exports = { start, stop, review /* ... */ };          // set module.exports first
require('./hotReload').mark(module, {
    dispose(ctx) { /* give everything up */ return state; },  // timers, intervals, fs watchers, listeners on other modules
    accept(state, ctx) { /* take it back, re-arm */ },         // state may be null; never mutate state's objects
    group: ['./fleetDeps'],                                    // optional: reloaded together, in this order
    dependents: ['./ws/handlers/314-claudeDeskHandler.js']     // optional: the light gate asks their editors too
});
// a module with no long-lived state: require('./hotReload').mark(module);
```

- **dispose(ctx)** stops every interval, timeout, fs watcher and listener the module started, and returns the state the next
  version needs: Maps of work in progress, which subsystems were started (`started: true` + the `gr` it got), handed-over
  servers (a listening `net.Server` is handed over, not closed: accept swaps its `connection` listener).
- **accept(state, ctx)** copies the state into the new version's own variables (it does not mutate the objects: a rollback
  gives the same state to the old version) and re-arms what was started. One-shot timers are re-armed as a fresh check
  (their checks are idempotent), not with their old due time. `ctx.rollback` is true when the old version is re-armed.
- After N reloads the process has the same number of intervals, timeouts, watchers, sockets and listeners as after one
  (`scripts/test-hot-reload-leaks.js` counts them).

## Callers never keep stale code

1. **The exports object keeps its identity.** A reload copies the new version's exports onto the same object, so
   `const sup = require('./agentSupervisor')` taken at load time calls the new code after a reload.
2. **Never destructure functions** out of a reloadable module at load time (`const { review } = require('./agentSupervisor')`
   keeps the old function). Call `sup.review()` or `require('./agentSupervisor').review()` at call time.
   `node scripts/check-hot-imports.js` lists every such import.
3. **Callbacks given to longer-lived code are late-bound**: `require('./hotReload').late(module, 'pumpWork')` calls whatever
   `module.exports.pumpWork` is now. Register such a callback once (keep the "hooked" flag in the hand-over state), never
   again in each version.
4. A module that exports a function (not an object) cannot be patched in place: it is not reloadable unless it sets
   `replaceExports: true` and every caller requires it at call time.

## A reload

`hotReload.reload(files, { by, why })`, one at a time per process:

1. Refuse the whole batch when any loaded file is not marked (a restart is needed) - nothing is touched.
2. Compile the new source (a syntax error touches nothing).
3. `old.hot.dispose()` -> state; drop the old module from `require.cache`; `require` the file again.
4. Copy the new exports onto the old exports object; `new.hot.accept(state)`; the loader hooks (the WS handler loader
   unregisters that file's packet types and calls its `registerPackets` again).
5. Any throw (load, a missing marker, `accept`, a loader) rolls back: the old module object and exports come back,
   `old.hot.accept(state, { rollback: true })` re-arms it, and earlier files of the same batch roll back in reverse
   order. The server keeps running the old code; the answer says what failed.
6. The old module object is dropped from every parent's `children`, so old versions are garbage collected.

## Entry points

- `bash scripts/reload-server-module.sh <file...> --why "<reason>"`: `node --check`, the plan (any non-reloadable file ->
  exit 50 naming it: use `scripts/restart-dreamscape.sh`), the light gate, the reload, the result. Use it instead of a
  restart whenever every changed server file is reloadable.
- agent-coord MCP `server_reload_module {paths, why}` runs the same script.
- The server listens on `hot-reload.sock` beside the agent-coord DB (owner only): one JSON line in, one out,
  ops `plan`, `reload`, `list`, `history`.

## The light gate

A reload is not a restart: it asks only the agents holding uncommitted edits (or claims with uncommitted files under
them) in the reloaded files and their declared dependents - never the whole tree, never the Director idle check (no
connection drops). It waits for a running `dreamscape-restart` or another `module-reload` build, and is denied when a file
fails `node --check`. `node scripts/restart-gate.js --reload <file,...>` decides; the reload is recorded as an agent-coord
build with target `module-reload` (who, files, why, result), like builds.
