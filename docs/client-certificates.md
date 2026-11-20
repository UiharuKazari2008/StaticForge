# Client certificates for installed clients

Yozora #922 (part of DreamOS #910). Yukimi, Nov 18 2026:

> "You do the initial login at the setup page, then it will be assigned a client certificate that should be stored
> securely, issued by the server's key manager service, used to authenticate with the server. For security we do
> certificate requests so the client holds its private key. The server maintains a CRL for revoked clients that need
> to re-authenticate. If a client has to re-authenticate they can do it inside the app where it messages the service."

This file is the protocol. The server (StaticForge) implements it in `modules/clientCertificates.js`; the Android
app (DSApp-Kotlin `ClientCert.kt`) and DreamOS (CaféReady, `cafeready/`) are its two clients and implement
sections 3 to 8 the same way.

## 1. Summary

| Piece | What |
| --- | --- |
| Issuer | The **Key Manager** service (#831) holds one client CA: ECDSA P-256, self-signed, `CN=Dreamscape Client CA`. |
| Client key | ECDSA P-256, made **on the client**, never leaves it. Android: Android Keystore (StrongBox where the phone has it, not exportable). DreamOS: a key file on `/data` owned by CaféReady (TPM later). |
| Enrolment | After a normal sign-in (PIN), the client sends a PKCS#10 request; the server answers with the certificate. |
| Use | The certificate **signs the client in**: it signs a server challenge and the server opens a session (`connect.sid`), exactly as a PIN would. Every connection the client already makes (the Miniport, ActiveSync, HTTP) then runs on that session. |
| Why not mutual TLS | TLS ends at the reverse proxy on Kuroko; Node serves plain HTTP on 9220 and never sees the handshake. A certificate header from the proxy would have to be trusted blind. The signed challenge needs nothing from the proxy and works on loopback and the LAN alike. |
| Revocation | A CRL kept by the server, published at `/api/client-cert/crl`, and pushed: a revoked client's sessions end and its sockets are told and closed at once. |
| Re-authentication | Inside the running app: the Nightshade Network shows "Sign-in required", the user signs in, the client enrols again. |

**Zero-wait rule (`installed-boot-zero-wait`)**: nothing in this file runs before the desktop / Today is up. Enrolment,
certificate sign-in, renewal and revocation all happen in the running app, driven by the native service
(`cafeready-background`: no step depends on a WebView page being open).

## 2. Server pieces

- CA key `~/.secrets/dreamscape-client-ca.key` (PKCS#8 PEM, mode 0600) and certificate
  `~/.secrets/dreamscape-client-ca.crt`, made on first use. Never in the repository, never logged.
  (`DREAMSCAPE_CLIENT_CA_DIR` moves the folder; the tests use it.)
- Records in Key Manager's database (`application_auth.db`): `client_certificates`, `client_cert_sessions`
  (which sessions a certificate opened), `client_cert_meta` (the CRL number).
- Certificate profile: X.509 v3, ECDSA-SHA256, 128-bit random positive serial, valid **90 days**
  (`clientCertificates.validityDays`), renewal offered in the last **30 days** (`renewDays`).
  - Subject: `CN=<device name>, OU=<kind>, O=Dreamscape, serialNumber=<device id>`
  - Extensions: basicConstraints CA:FALSE (critical), keyUsage digitalSignature (critical), extendedKeyUsage
    clientAuth, subjectAltName URI `urn:dreamscape:device:<kind>:<device id>`, subject / authority key identifiers.
  - The role (`admin` / `readonly`) is **not** in the certificate; it is the server's record of the session that
    enrolled, so it can be changed or revoked without reissuing.
- One live certificate per `(kind, device id)`. Enrolling again replaces the old one (CRL reason `superseded`).

## 3. Identity the client sends

| Field | Rule |
| --- | --- |
| `deviceId` | 16 to 32 lowercase hex. Android: the ActiveSync device id (`ActiveSyncIdentity.deviceId`). DreamOS: the machine id CaféReady already reports as its Android-compatible device id (the same value its ActiveSync / Miniport proxy uses). |
| `deviceName` | 1 to 64 characters, the name the user sees (Android: device name; DreamOS: the computer name). |
| `kind` | `android` or `dreamos`. |
| `keyStore` | Free text for the record, shown in Key Manager: `strongbox`, `tee`, `software`, `file`, `tpm`. |

## 4. HTTP endpoints

All JSON, all under `/api/client-cert`. They sit behind the site gate like every other route: the client sends
what it already sends to pass it (`X-Dreamscape-Access` / the `dsk` cookie, `X-Dreamscape-Client`). Errors are
`{ success:false, code, error }` with the HTTP status given.

### 4.1 `GET /api/client-cert/ca`
The CA certificate, PEM (`application/x-pem-file`). No session needed. Clients keep it and check that the certificate
they are given chains to it.

### 4.2 `POST /api/client-cert/enrol` (signed-in session)
Needs a session that a person opened: PIN sign-in (or the loopback dev login). An application key, a temporary
token or an approved-IP auto login may not enrol (`403 ENROL_NEEDS_SIGN_IN`).

Request:
```json
{ "csr": "-----BEGIN CERTIFICATE REQUEST-----…", "deviceId": "f409…", "deviceName": "Yukimi's Fold7",
  "kind": "android", "keyStore": "strongbox" }
```
- `csr`: PKCS#10, PEM (or base64 DER). Public key ECDSA P-256; signature ecdsa-with-SHA256 by that key (proof of
  possession, checked). The subject in the request is ignored; the server writes its own (section 2).

Answer `200`:
```json
{ "success": true, "certificate": "-----BEGIN CERTIFICATE-----…", "ca": "-----BEGIN CERTIFICATE-----…",
  "serial": "5f0c…", "notBefore": 1795000000000, "notAfter": 1802776000000, "renewAfter": 1800184000000,
  "userType": "admin", "crlNumber": 4 }
```
Times are epoch milliseconds. The session that enrolled is tied to the certificate (revoking it ends that session too).
Errors: `400 BAD_CSR`, `400 BAD_DEVICE`, `401` (no session), `403 ENROL_NEEDS_SIGN_IN`, `429 TOO_MANY`.

### 4.3 `POST /api/client-cert/challenge` (no session)
Request `{ "serial": "5f0c…" }` (optional, for the log). Answer:
```json
{ "success": true, "nonce": "<43 chars base64url>", "expiresAt": 1795000060000, "serverTime": 1795000000000 }
```
A nonce lives 60 seconds and is good for one answer.

### 4.4 `POST /api/client-cert/auth` (no session; this is the sign-in)
```json
{ "certificate": "-----BEGIN CERTIFICATE-----…", "nonce": "…", "signature": "<base64 DER ECDSA signature>" }
```
The signature is ECDSA-SHA256 (ASN.1 DER `Ecdsa-Sig-Value`, as `SHA256withECDSA` on Android and
`ecdsa::Signature::to_der()` in Rust give it) over these UTF-8 bytes, lines joined by one `\n`, no trailing newline:

```
dreamscape-client-auth-v1
<nonce>
<serial, lowercase hex, exactly as the server gave it at enrolment>
```

The server checks: the nonce is its own, unused and in time; the certificate is one it issued (CA signature **and**
its own record, by serial and fingerprint); it is in its validity; it is not revoked; the signature verifies under
the certificate's key. Then it opens a new session with the recorded role and answers `200`:

```json
{ "success": true, "userType": "admin", "serial": "5f0c…", "notAfter": 1802776000000,
  "renew": false, "crlNumber": 4 }
```
with `Set-Cookie: connect.sid=…` (and `dsk` when the site gate is on). **The client keeps those cookies and uses them
on its connections**, as after a PIN sign-in. `renew: true` means the certificate is inside its renewal window:
renew now (4.5).

Failures are `401` with `code`:

| code | Meaning | Client does |
| --- | --- | --- |
| `CERT_REVOKED` | On the CRL (answer carries `reason`). | Delete the certificate **and its key**; show sign-in required; enrol afresh after the user signs in. |
| `CERT_EXPIRED` | Past `notAfter`. | Same as revoked. |
| `CERT_UNKNOWN` | Not issued by this server, or the record is gone. | Same as revoked. |
| `BAD_NONCE` | Unknown, used or timed-out nonce. | Ask for a new challenge once, then give up until the next event. |
| `BAD_SIGNATURE` | Signature did not verify. | Same as revoked (the key and certificate no longer match). |

### 4.5 `POST /api/client-cert/renew` (a session of the certificate)
Request `{ "csr": "…", "keyStore": "strongbox" }`; the device identity is the certificate's. The client may keep its
key or make a new one. Answer as 4.2. The old certificate stays valid until the new one signs in for the first
time, then it is revoked as `superseded` (a lost answer cannot lock the client out). At most one renewal per device
per 10 minutes (`429 TOO_MANY`). The session must be one of the certificate's own: one it opened (4.4) or the
sign-in that enrolled it. Any other gets `403 RENEW_NEEDS_CERT_SESSION`: a session a person opened since (a PIN
sign-in) enrols instead (4.2), which replaces the certificate; make that key beside the old one and drop the old
key only when the new certificate has arrived.

### 4.6 `GET /api/client-cert/crl` and `/api/client-cert/crl.json` (no session)
- `/crl`: the X.509 v2 CRL, DER (`application/pkix-crl`), signed by the CA, `cRLNumber` extension, reason codes.
  `ETag` is the CRL number; `If-None-Match` answers `304`.
- `/crl.json`: `{ "number": 4, "thisUpdate": …, "nextUpdate": …, "revoked": [ { "serial": "…", "revokedAt": …, "reason": "revoked" } ] }`

Entries leave the CRL when their certificate has expired. Clients **do not poll** this (`server-push-not-polling`):
the server tells them (section 5); the file is there for a client that was offline and for checking.

### 4.7 `GET /api/client-cert/mine` (session)
`{ success, certificate: { serial, deviceId, deviceName, kind, notBefore, notAfter, renew, status } | null }` for the
certificate that opened (or was enrolled by) this session. The phone's Settings > System > Certificates lists it
under Personal.

## 5. Push (WebSocket)

| Packet | To | Data |
| --- | --- | --- |
| `client_cert_revoked` | every socket of every session tied to the certificate, **and** the Miniport carrier of those sessions (a carrier-level frame, like `miniport_ready`, so the native side reads it without a page) | `{ serial, reason, at }` |
| `client_cert_crl` | every socket on a certificate-opened session, when the CRL changes | `{ number, added: [ { serial, reason, revokedAt } ] }` |

After `client_cert_revoked` the server destroys those sessions and closes the sockets (page sockets code `4004`
"Certificate revoked"; the Miniport carrier `1008` "Authentication required"). A client that missed the packet finds
out on its next connect: the session is gone (`401` / `1008`), certificate sign-in answers `CERT_REVOKED`.

A client acts on `client_cert_revoked` only when `serial` is the certificate it holds now: a renewal retires the
old certificate with the same packet (`superseded`), and that must not make the client drop its new one.

`reason` is one of `revoked` (an administrator, unspecified), `key_compromise`, `superseded`,
`cessation` (the device was retired).

## 6. Client state machine

Event-driven only; no timers, no polling (`phone-power-native`).

1. **Start**: nothing. The app boots by its own rules.
2. **A connection is refused for authentication** (the Miniport upgrade answers 401/403 or closes 1008, ActiveSync
   says `NOT_AUTHENTICATED`, an HTTP call answers 401):
   - a certificate is held → certificate sign-in (4.3, 4.4), keep the cookies, reconnect;
   - none, or sign-in failed with a code from the table → tell the page / the user: sign-in required.
3. **The connection is up on a session** (Android: `miniport_ready`):
   - no certificate → make the key if needed, build the CSR, enrol (4.2);
   - `renew` was true at sign-in, or `now > renewAfter` → renew (4.5); on `403` enrol (4.2); if that is refused
     too, leave it for six hours or the next sign-in.
4. **`client_cert_revoked` arrives** → delete certificate and key, sign-in required. After the user signs in, step 3
   enrols a new one.
5. **Network errors** in any of these: stop and wait for the next event (the next connect attempt comes from the
   connection's own retry rules).

The user never sees the certificate in normal use: the first PIN sign-in on a device is the only one until the
certificate is revoked, lost, or the device is replaced.

## 7. Administration

Key Manager (Server Manager > Roles > Key Manager, or Start > Administrative Tools) has a **Client Certificates**
store with **Issued Certificates** and **Revoked Certificates**. Revoke is on a certificate's menu and asks for the
reason. WebSocket packets (admin only), documented in `docs/client-api/ws/clientCertificates.md`:
`client_cert_list`, `client_cert_revoke`, and the push `client_cert_changed` to administrators.

## 7a. Log off and sign out

Yukimi, Nov 20 2026:

> "on sign out it should NEVER sign out. CaféReady is cert based accounting. Sign out in the desktop is just close
> everything and return to the login screen, and it's like a lock, not an actual server sign out. The only way to
> sign out when using CaféReady is from the Nightshade client."

| What | On a certificate client | On a plain browser |
| --- | --- | --- |
| The desktop's **Log off** (Start menu, the Shut Down Windows box) | Vista's log off (still-running programs, "Logging off...", the desktop closes) and back to the logon, which asks the password (or logs on by itself, per its settings), offline from the cached logon too. **No request to the server**: the session, the certificate, `connect.sid` and the site key stay. | Signs out of the server, as before. |
| The Nightshade Network client's **Sign Out of Nightshade Network...** (its Connection menu and the tray icon's menu, behind a warning; needs the connection) | The same log off, and the server **revokes this device's certificate** (reason `cessation`, by "signed out on the device"): its sessions end, the page sockets and the Miniport carrier get `client_cert_revoked`, the app deletes key and certificate and does not sign back in by itself (section 6 step 4). The cached logon verifier is forgotten. The next PIN sign-in enrols afresh. | Signs out of the server. |

The page knows a certificate client with no request: the Android app's bridges (`AndroidClientCert`, `AndroidHardware`,
`AndroidDisplay`) or DreamOS' (`DreamOSHardware`) are present (`handleLogout.certificateClient()`, connectionManager.js).
The server knows by the session, and decides on its own (`logoutPlan`, `modules/clientCertificates.js`): a session
the certificate opened (4.4) or the sign-in that enrolled it (4.2) is a certificate session, and `POST /`
`{ action: "logout" }` on one answers `{ success: true, signedOut: false, kept: "certificate" }` and changes nothing,
whoever sent it, unless `data.intent` is `"nightshade-signout"`.

A logon's PIN check on a certificate session (the logon after Log off) still gets a new session id (session
fixation), but the new id is bound to the same certificate and keeps `authMethod: "client_cert"`, so renewal works
and the app does not enrol again.

## 8. What each client implements

### Android (DSApp-Kotlin, `ClientCert.kt`)
- Key: `KeyPairGenerator("EC", "AndroidKeyStore")`, alias `dreamscape_client_cert_v1`, `secp256r1`,
  `PURPOSE_SIGN`, digest SHA-256, StrongBox first then the TEE, **no** user-authentication and **no**
  unlocked-device requirement (the background service signs in while the phone is locked).
- CSR built in the app (DER by hand; no new library). Certificate kept with the alias and in the app's preferences.
- Hooks: Miniport authentication failure → certificate sign-in; `miniport_ready` → enrol / renew; the carrier's
  `client_cert_revoked` → forget and report. Bridge `AndroidClientCert` gives the page the state and an event.

### DreamOS (CaféReady)
- Key: P-256 PKCS#8 file under `/data` (0600, CaféReady's user); TPM-bound later without a protocol change.
- CSR: any PKCS#10 library (`rcgen` / `x509-cert`); subject may be empty.
- `kind: "dreamos"`, `deviceId` as section 3, `keyStore: "file"`.
- Same state machine (section 6) on CaféReady's Miniport proxy: on an authentication refusal sign in with the
  certificate and hand the cookies to the shell's cookie store; on `miniport_ready` enrol or renew; on the carrier's
  `client_cert_revoked` delete key and certificate and raise the shell's sign-in.
- Check the certificate in every enrol / renew answer against the CA from `/api/client-cert/ca` kept at first
  enrolment (trust on first use, over the server's own TLS).

## 9. Tests

`node scripts/test-client-certificates.js`: the DER codec against Node's own X.509 parser, CA creation, enrolment
(good and bad requests), challenge / signature sign-in, replay, renewal and supersede, revocation, the CRL (parsed
back and its signature checked), and the push to a revoked session's sockets.
