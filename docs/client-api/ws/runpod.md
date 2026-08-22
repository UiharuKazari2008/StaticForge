# WebSocket: Managed RunPod Pods

Server handler: `modules/ws/handlers/175-runpodHandler.js`

Manager: `modules/runpodPodManager.js`

See [WebSocket protocol](../websocket.md) for envelope format, auth, and error handling.

These packets control **dedicated GPU Pods** listed in `secure.config.json` → `runpod.managedPods`. They are not the serverless ESRGAN worker (`runpod.esrganWorkerId`).

## Packet index

| Request type | Typical response | Auth | Notes |
|---|---|---|---|
| `runpod_pod_start` | `runpod_pod_start_response` | admin/destructive | Handler: handleRunpodPodStart |
| `runpod_pod_stop` | `runpod_pod_stop_response` | admin/destructive | Handler: handleRunpodPodStop |
| `runpod_pods_status` | `runpod_pods_status_response` | session | Handler: handleRunpodPodsStatus |

## Response envelope

Successful replies use:

```json
{
  "type": "<request_type>_response",
  "requestId": "<same as request>",
  "data": {
    "success": true,
    "pods": [
      {
        "id": "<podId>",
        "name": "Prompt naturalizer",
        "status": "running",
        "autoShutdown": true,
        "idleMinutes": 15,
        "lastUsageAt": 0,
        "costPerHr": 0.69,
        "sessionCost": 1.24,
        "lastStartedAt": "2026-08-21T06:00:00.000Z",
        "gpuName": "NVIDIA GeForce RTX 4090",
        "error": null
      }
    ],
    "loggedInUsers": 1,
    "fetchedAt": 0,
    "configured": true,
    "hasApiKey": true
  },
  "timestamp": "<ISO-8601>"
}
```

`status` is `running`, `stopped`, `terminated`, `starting`, `stopping`, or `unknown`.

Errors use `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors).

## Server push

| Type | When | Payload |
|------|------|---------|
| `runpod_pods_status_update` | After start/stop and on idle-watch status changes | Same `data` shape as the status response (no `requestId`) |

## Auto-shutdown

A managed pod with `autoShutdown: true` is stopped when **all** of the following hold:

- no authenticated Dreamscape WebSocket sessions
- no start/stop/`noteUsage` activity for `idleMinutes` (default 15, overridable per pod or `runpod.idleMinutes`)

Logged-in sessions keep pods running even if the GPU is idle. The tray starts and stops pods; login does not auto-start a stopped pod.

Logs: Periscope source `runpod` (`logs/runpod.log`).

## Read-only restrictions

`runpod_pod_start` and `runpod_pod_stop` are in `isDestructiveOperation()` and return `READONLY_RESTRICTED` for `userType: "readonly"` sessions.

---

---

## Detailed packets

### `runpod_pod_start`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/175-runpodHandler.js → `handleRunpodPodStart`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `podId` | Required |

**Validation errors:**
- podId is required

**Success response:** `runpod_pod_start_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `runpod_pod_stop`

**Auth:** Session required. Admin only (destructive — blocked for readonly)

**Handler:** modules/ws/handlers/175-runpodHandler.js → `handleRunpodPodStop`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |
| `podId` | Required |

**Validation errors:**
- podId is required

**Success response:** `runpod_pod_stop_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

### `runpod_pods_status`

**Auth:** Session required

**Handler:** modules/ws/handlers/175-runpodHandler.js → `handleRunpodPodsStatus`

**Request fields:**

| Field | Notes |
|-------|-------|
| `requestId` | Optional |

**Success response:** `runpod_pods_status_response`

**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.

