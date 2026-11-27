'use strict';
// Replica mode (Rack Manager role `replicas`, docs/rack-manager/replicas.md): a replica server does nothing that reaches the
// outside world or other agents on its own. Unset DREAMSCAPE_REPLICA = the live server, nothing changes.
//   DREAMSCAPE_REPLICA=1                      replica
//   DREAMSCAPE_REPLICA_ALLOW=novelai,mail,... features the replica may use anyway (a per-replica opt-in)
const on = (v) => v === '1' || v === 'true';
const allowed = () => new Set(String(process.env.DREAMSCAPE_REPLICA_ALLOW || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

/** True inside a replica container. */
function isReplica() { return on(process.env.DREAMSCAPE_REPLICA); }
/** True when this server may use `feature`: always on the live server, only when listed on a replica. */
function allow(feature) { return !isReplica() || allowed().has(String(feature).toLowerCase()); }
/** The one-line gate: `if (replicaMode.off('supervisor')) return;` - true on a replica that has not allowed the feature. */
function off(feature) { return !allow(feature); }

module.exports = { isReplica, allow, off };
