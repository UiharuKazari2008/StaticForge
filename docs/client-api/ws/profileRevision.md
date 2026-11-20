# Profile revision (client WS)

Module: `modules/ws/handlers/201-profileRevisionHandler.js` + `modules/profileRevision.js` (#910, Nov 20 2026). The
server keeps one revision of the user's profile (user global settings, workspaces and their settings, desktop
shortcuts and folders, window positions, the Start menu layout, the Sidebar), like a domain controller's copy of a
roaming profile. A client stores it with its cached profile (`public/scripts/comp/profileCache.js`); a computer that
logged on from its cache compares it when it reconnects, and a different revision means "out of sync with the domain
controller" (nothing from that session is written).

| Packet | Direction | Fields | Notes |
| --- | --- | --- | --- |
| `profile_revision` | client -> server | none | Answers `profile_revision_response` `data: { revision }`. `revision` is a string `"<ms>-<seq>"`. |
| `profile_changed` | server -> client | `data: { revision, type }` | Sent after any profile write packet finishes (`PROFILE_WRITES` in `profileRevision.js`; `type` is that packet). Signed-in, non-readonly desktop pages only (not the phone shell). |

The revision is kept in `.cache/profile-revision.json`. A failed write may move it too (at most a needless out-of-sync
notice).
