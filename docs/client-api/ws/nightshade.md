# WebSocket: Nightshade Network addresses (DHCP)

Server handler: `modules/ws/handlers/314-nightshadeLeaseHandler.js`, pool `modules/nightshadeAddressPool.js`.
Client: `public/scripts/comp/melatonNetworkDialogs.js` (`nightshadeLease()`, `nightshadeNic()`, `requestNightshadeLease()`,
event `melaton-nightshade-lease`); shown by `dreamosWifi.js` (the Café Miniport adapter's Status > Details, the
Nightshade VPN's Details tab) and Server Manager > Clients (`IP Address`). Yozora #952.

The server is the DHCP server of every client's Nightshade / Café Miniport adapter. A client is one computer's adapter:
the page keeps its adapter's physical address (`melaton.nightshade.nic` in localStorage, 12 hex digits, locally
administered) and asks each time its connection comes up. The Android app's phone page and DeX window share that
storage, so they are one computer with one address.

## `nightshade_dhcp`

Request: `{ nic, host? }` (`host`: the computer's name, for the server's lists). Signed-in clients only.

Reply `data`: `{ success, lease: { nic, ip, mask, prefix, gateway, dhcpServer, dns[], obtainedAt, expiresAt, host, user,
firstSeen, lastSeen, domain } }`, or `{ success: false, error }`.

- `ip`: a random free address in 172.18.1.1 - 172.18.254.254 (no .0 / .255), kept for this `nic`.
- `mask` 255.255.0.0 (`prefix` 16); `gateway`, `dhcpServer` and `dns` are the server, 172.18.0.1.
- `obtainedAt` / `expiresAt`: an 8-day lease (Windows Server's default), renewed at a request once half of it has run.
- An address stays with its adapter while the lease runs and 30 days after it ran out; then it is free again.
- `domain`: the server's FQDN (config `public_hostname`): the adapter's Connection-specific DNS Suffix.
- The connection keeps `{ ip, nic, host }` (`clientInfo.nightshadeLease`): `server_clients` rows carry `nightshadeIp`
  and `computer`, agentClientBridge's client list `nightshadeIp`.

Leases are kept in `data/nightshade-leases.json` (not in git).
