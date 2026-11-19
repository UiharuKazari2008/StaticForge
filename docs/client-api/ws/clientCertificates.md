# WebSocket: Client certificates

Server handler: `modules/ws/handlers/311-clientCertHandler.js` (service: `modules/clientCertificates.js`). Client:
`public/scripts/comp/mmcAppKeys.js` (Key Manager's Client Certificates store). Yozora #922.

The protocol installed clients follow (enrolment, certificate sign-in, renewal, the CRL: all HTTP under
`/api/client-cert`) is `docs/client-certificates.md`. This file is the WebSocket side only.

## `client_cert_list` (admin)

Request: `{}`.

Reply `data`: `{ success, certificates: [record], crlNumber, validityDays, renewDays }`

`record`: `{ serial, deviceId, deviceName, kind ('android' | 'dreamos'), userType, keyStore, fingerprint, notBefore,
notAfter, issuedAt, issuedIp, lastUsedAt, lastUsedIp, replacesSerial, revokedAt, revokeReason, revokedBy,
status ('issued' | 'expired' | 'revoked'), renew }` (times in epoch milliseconds; newest first, at most 500).

## `client_cert_revoke` (admin, destructive)

Request: `{ serial, reason }`; `reason` is `revoked` (default), `key_compromise`, `superseded` or `cessation`.

Reply `data`: `{ success: true, certificate: record }`, or `{ success: false, code, error }` with `code`
`CERT_UNKNOWN` / `ALREADY_REVOKED`.

The revoked client's sessions are destroyed and its sockets told and closed (below). An administrator who revokes
the certificate of their own session gets the reply first, then loses the socket.

## Pushes

| Type | To | `data` |
| --- | --- | --- |
| `client_cert_changed` | administrators' full clients | `{}`: a certificate was issued or revoked; list again |
| `client_cert_revoked` | every socket of the sessions tied to the certificate, and those sessions' Miniport carrier (a carrier-level frame) | `{ serial, reason, at }`; the socket closes a second later (`4004` "Certificate revoked"; the carrier `1008`) |
| `client_cert_crl` | sockets on sessions tied to a certificate | `{ number, added: [ { serial, reason, revokedAt } ] }` |
