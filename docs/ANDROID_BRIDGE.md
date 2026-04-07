# DreamScape Android WebView bridges

This document describes the JavaScript interfaces exposed to the PWA and the **background notification refresh** contract for server-side integration.

## Global objects

| Object | Purpose |
|--------|---------|
| `AndroidCaption` | Window caption bar insets, drag regions, overlay colors (desktop/window controls). |
| `AndroidNotification` | Heads-up / progress notifications from the web app. |
| `AndroidPersistentNotification` | Persistent status notification (foreground service): body lines, large icon, lock flow. |
| `AndroidBlobSave` | Save `blob:` images to the user-picked folder (internal). |
| `AndroidBackgroundRefresh` | Register native **HTTP JSON** polling for the persistent notification while the WebView is paused. |

---

## `AndroidBackgroundRefresh` (background notification manifest)

While the user is away from the app, the Android WebView is **paused** (`Activity.onPause`). The native layer can then refresh the persistent notification by **GET**ting a JSON document from your server and filling **title** and **body** templates.

### Registration

The web app registers a same-origin probe URL (session cookie) and templates for **DreamScape** title and credit / subscription line:

```javascript
AndroidBackgroundRefresh.registerManifest(JSON.stringify({
  "uri": "https://your-host:9220/android/background-notification",
  "title": "DreamScape",
  "body": "{{free}} Free / {{paid}} Paid Credits / {{daysLeft}} Days Left",
  "internal": false,
  "intervalMinutes": 15
}));
```

Generic example (custom server):

```javascript
AndroidBackgroundRefresh.registerManifest(JSON.stringify({
  "uri": "https://api.example.com/v1/dreamscape/status",
  "title": "{{status.headline}}",
  "body": "{{user.name}} · {{status.detail}}",
  "internal": false,
  "intervalMinutes": 15
}));
```

Clear the manifest (native polling stops for this feature):

```javascript
AndroidBackgroundRefresh.clearManifest();
```

### Manifest fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uri` | string (URL) | **Yes** | HTTPS GET endpoint. Response body must be a **JSON object** (`{}`) at the root (not a bare array). |
| `title` | string | No | Notification title template. Default if omitted: app name (`DreamScape`). |
| `body` | string | No | Notification body template (single line in the collapsed notification). |
| `internal` | boolean | No | Default `false`. If `true`, the notification uses **secret** visibility (more sensitive on lock screen). |
| `intervalMinutes` | integer | No | Polling interval while paused, default **15**, clamped between **1** and **1440**. |

### Template syntax (`title` and `body`)

- Placeholders use double curly braces: `{{path.to.field}}`.
- `path` is dot-separated. Each segment is either:
  - A **string key** on a JSON **object**, or
  - A **non-negative integer** index on a JSON **array** (e.g. `items.0.title`).
- If a path is missing, the placeholder is replaced with an **empty string**.
- Values are rendered as: strings as-is; numbers and booleans as text; nested objects/arrays as `JSONObject`/`JSONArray` `toString()` (usually avoid—design flat fields for UI).

**Example response (Staticforge `/android/background-notification`):**

```json
{
  "free": "120",
  "paid": "3400",
  "daysLeft": "14"
}
```

Rendered notification:

- Title: `DreamScape`
- Body: `120 Free / 3400 Paid Credits / 14 Days Left`

If subscription expiry is unknown, `daysLeft` may be an empty string (the template still fills `free` and `paid`).

**Example response (generic nested example):**

```json
{
  "status": {
    "headline": "DreamScape",
    "detail": "All systems nominal"
  },
  "user": {
    "name": "Ada"
  }
}
```

With the generic manifest `title` / `body` above, the notification shows:

- Title: `DreamScape`
- Body: `Ada · All systems nominal`

### HTTP behavior

- Method: **GET** only.
- Headers: `Accept: application/json`, `User-Agent` matching the in-app WebView (stored when the activity creates the WebView; falls back to the system default WebView UA if missing).
- Cookies: uses Android’s shared [`CookieManager`](https://developer.android.com/reference/android/webkit/CookieManager) (the same store as the WebView). Before each request the client **flushes** cookie persistence and reads the `Cookie` header on the **main thread** (then performs the HTTP call on a background thread) so session cookies set by the WebView are included. If no cookies match the exact request URL, the client tries the URL **origin** (`https://host:port`) and `origin/` as fallbacks.
- Timeouts: connect **15s**, read **20s** (client-side).

### Lifecycle (important)

- Polling runs only while the **WebView is paused** (user left the activity).
- When the user returns, native clears the “fetched” title/body overlay and the persistent notification returns to data set via `AndroidPersistentNotification` until the next pause + successful fetch.
- The manifest JSON is stored in app preferences until cleared or overwritten.

### Android 14+ foreground service (`dataSync`)

The persistent notification is backed by a **foreground service** declared as type `dataSync`. The OS may apply **time limits and start/stop rules** to this type. If users hit system limits, options include: shorter polling intervals only when needed, reducing notification churn, or (product-level) a different foreground-service type with Play policy compliance. Client-side, notification work and network fetch run **off the main thread** to satisfy stop timeouts.

---

## `AndroidPersistentNotification` (summary)

Existing APIs (unchanged in spirit):

- `setBody(partsJson)` — JSON array of strings; joined with ` · ` in the notification when native background fetch is **not** showing.
- `setImageDataUrl` / `setImageUrl` / `clearImage` — large icon.
- `canLock()`, `lockApp()`, and callbacks `onLockRequested` / `onUnlocked` for the lock flow.

See inline comments in `MainActivity.kt` (`PersistentNotificationBridge`) for full JS signatures.

---

## `AndroidNotification` (summary)

`showNotification`, `updateNotification`, `updateNotificationProgress`, `completeNotification`, `dismissNotification`, and action buttons that invoke `window.AndroidNotification.onAction(id, key)`. See `MainActivity.kt` (`NotificationBridge`).

---

## Versioning

Document the **app `versionName`** when relying on new fields. Server responses should ignore unknown fields; clients should tolerate optional fields.
