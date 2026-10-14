# Dedicated server-side agent client

Dreamscape agents use one headless Chromium tab running on the Dreamscape server. The tab opens the existing loopback-only `/agent` bootstrap, runs without a service worker, and registers itself as Dreamscape's priority client.

While that priority registration is active, agent REST and non-Director MCP calls are routed only to this tab. Human browser tabs are not selected as a fallback, including while the dedicated tab is reconnecting. Director and Xi keep their existing explicit exemptions.

## Install

```bash
bash scripts/install-dedicated-agent-client.sh
```

The installer creates and starts the user service `dreamscape-agent-client.service`. It does not restart, reload, stop, or modify the Dreamscape PM2 process.

The installer provisions a persistent application key with only the `infrastructure` scope and stores it at `~/.config/dreamscape-agent-client/app-key` with mode `0600`. The service sends that key only in the loopback `/agent` request header, removes the header before `/app?agent=1` loads, and never places the key in a URL or process argument.

## Operations

```bash
systemctl --user status dreamscape-agent-client.service
journalctl --user -u dreamscape-agent-client.service -f
systemctl --user restart dreamscape-agent-client.service
```

Restarting this user service restarts only the dedicated headless Chromium client. It does not restart Dreamscape or a human browser tab.

The isolated Chromium profile is stored at:

```text
~/.cache/dreamscape-agent-client/chromium
```

The Chromium debugging endpoint listens only on `127.0.0.1:9334`.

## Verification

```bash
node scripts/test-dedicated-agent-client.js
node scripts/test-agent-priority-client.js
systemctl --user is-active dreamscape-agent-client.service
```

The service log reports `ready` only after the app reaches a usable desktop state and the server confirms that this tab owns the priority-client registration.
