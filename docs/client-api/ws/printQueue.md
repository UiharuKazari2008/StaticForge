# WebSocket: Print queue (generations as Vista printing)

Server handler: `modules/ws/handlers/306-printQueueHandler.js` (state in `modules/printSpooler.js`).
Client: `public/scripts/comp/printQueue.js` (the printer tray icon, its balloons, the state), `printQueueWindow.js`
(one print queue window per printer), `mmcPrintManagement.js` (Print Management). Yozora #831 slice 8.

Printers are the generation backends, documents their jobs:

- `novelai`: the global generation FIFO (`modules/generationJobQueue.js`): Studio prints, rerolls, presets, MCP
  `generate_image` / `generate_preset`.
- `local:<worker id>`: each configured local worker (Ruiko, G10; `modules/localUpscaleWorker.js`): upscale and
  animate jobs. A printer carries the worker's host name only, never its URL path or key.

Every packet is admin only (`admin`, `dev_admin`).

## Push

`print_queue_state` (`data`: the state below) goes to every signed-in `admin` / `dev_admin` socket after each
change: a job queued, started, finished, failed or cancelled (FIFO change events, coalesced for 200 ms). There is
no client polling; a client reads the state once on connect.

State: `{ at, printers: [{ id, name, port, driver, provider, kind: novelai/local, isDefault, status:
Ready/Printing/Offline, jobs }], jobs: [document], recent: [document] }`. `jobs` are the documents in the queues
(oldest first), `recent` the ones finished in the last 30 minutes (newest first, at most 30).

Document: `{ id, printer, type, name, status: queued/delayed/running/completed/failed/cancelled, statusText
(printui's: '' / Spooling / Printing / Printed / Error / Deleting), owner (Studio, Melaton Mobile, the MCP agent's
name), self (a one-way tag of the submitting session, or null), pages, size (spool bytes: width x height x 3 x
pages), width, height, submitted, started, finished, workspace, cancellable, error }`.

## Packets

| Request type | Fields | Reply `data` |
|---|---|---|
| `print_queue_get` | `refreshPrinters` (re-probe the local workers, 15 s cached) | `{ success, state, self }`; `self` is this session's tag (compare with a document's `self`) |
| `print_queue_cancel` | `jobId` | `{ success, cancelled: 'queued' / 'running' }`, or `{ success: false, code: NOT_FOUND / ACCESS_DENIED / NOT_SUPPORTED, error }`. A waiting document leaves the FIFO (its generation request is marked cancelled); a Studio print that is printing is cancelled like Studio's own Cancel (`markGenerationCancelled` on its requestId). MCP documents that are printing and local worker jobs cannot be cancelled. `admin` cancels any document, `dev_admin` only its own session's. |
| `print_queue_history` | `limit` (default 100, max 200), `offset` | `{ success, total, jobs: [{ id, printer, type, name, status, statusText, owner, pages, submitted, finished, workspace, images, error }] }`: the durable generation request log (`modules/generationRequestLog.js`), newest first |

The generation request log rows (also MCP `list_generation_requests`) now carry the document's `pages` and
`owner`. The log keeps no prompt text, so a printed document in the history is named by its first gallery file.
