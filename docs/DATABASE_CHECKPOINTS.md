# Database and config checkpoints

StaticForge keeps local rollback points for mutable JSON config files and SQLite
databases. The goal is recovery from bad saves, failed restores, or local data
corruption without waking every database or growing `.cache` without bound.

## Architecture

| Layer | Source | Responsibility |
|-------|--------|----------------|
| Retention engine | `modules/checkpointGrandfathering.js` | Hour/day/month tiers, per-resource overrides, legacy migration, SQLite sidecar cleanup |
| JSON snapshots | `modules/jsonCheckpoint.js`, `modules/configManager.js` | Snapshot config files before saves and expose restore helpers |
| SQLite snapshots | `modules/databaseCheckpoint.js`, `modules/sqliteAsyncWrapper.js` | Snapshot dirty databases, copy/restore WAL sidecars, verify database integrity |
| Bundle operations | `modules/checkpointManagementService.js` | Create/list/restore/delete manual bundles across config files and databases |
| Config editor API | `modules/ws/handlers/20-configEditorHandler.js` | `config_editor_checkpoints_*` WebSocket actions for admins |

Checkpoint files are stored under the cache checkpoint root by resource:

```text
.cache/checkpoints/<resource>/hour/<timestamp>.<ext>
.cache/checkpoints/<resource>/day/<timestamp>.<ext>
.cache/checkpoints/<resource>/month/<timestamp>.<ext>
.cache/checkpoints/bundles/hour/<uuid>.json
```

SQLite databases use the same resource layout when the database lives in
`.cache`; the path helper is `dirname(dbPath)/checkpoints/<dbStem>/`. A
checkpointed WAL-mode database may also have sibling sidecars:

```text
2026-10-05_16-00-00.000.db
2026-10-05_16-00-00.000.db-wal
2026-10-05_16-00-00.000.db-shm
```

Sidecars move and delete with their main checkpoint. They are never counted as
checkpoint records and are ignored when detecting a resource's checkpoint
extension.

## Creation flow

### JSON config files

- `ConfigManager` wraps mutable configs with `JSONCheckpointManager`.
- A save marks the file dirty, creates a checkpoint of the current file before
  overwrite, then writes the new JSON.
- Checkpoint creation is skipped when the content is unchanged or when the
  latest checkpoint is younger than the resource save policy
  (`snapshotMinAgeMs`, usually 5 minutes; workspace files use 30 minutes).
- Forced bundle snapshots bypass the age gate.

### SQLite databases

- `AsyncSQLiteDatabase` marks itself dirty after mutating SQL.
- Dirty databases checkpoint before idle unload (`handleIdleTimeout`) and during
  periodic checkpoint cycles only when the wrapper is already open. Idle
  databases are not opened just to create a scheduled checkpoint.
- Before copying, the wrapper runs `PRAGMA wal_checkpoint(TRUNCATE)` so WAL
  changes are folded into the main database when possible.
- `DatabaseCheckpointManager` can also use the `better-sqlite3` backup API for
  forced/manual snapshots.
- `replication_changelog.db` opts out of checkpointing because it is a derived
  sync log, not primary data.

### Manual bundles

`CheckpointManagementService.createCheckpoint()` flushes pending config saves,
forces snapshots for known JSON resources and registered database managers, and
writes a bundle manifest in `.cache/checkpoints/bundles/hour/`. The manifest
references existing resource checkpoint filenames instead of embedding data.

## Retention model

Retention is controlled by `config.checkpoints` and surfaced in the config map
as **Checkpoints**.

Default effective settings:

```json
{
  "checkpoints": {
    "enabled": true,
    "grandfathering": {
      "hour": { "max": 4, "rollover": null, "perBucketMax": 1 },
      "day": { "max": 0, "rollover": null, "perBucketMax": 1 },
      "month": { "max": 0, "rollover": null, "perBucketMax": 1 }
    },
    "overrides": {}
  }
}
```

Terminology:

- `max` is the number of time buckets to keep at that tier.
- `perBucketMax` is the number of newest checkpoints kept inside one bucket.
- `rollover` moves excess checkpoints to the next tier instead of deleting
  them. Supported rollover directions are hour -> day/month and day -> month.
- `max: 0` purges that tier.
- `enabled: false` does not disable checkpoint creation; it disables tiered
  grandfathering and falls back to each manager's fixed newest-N cap.

Example: keep four recent hourly snapshots, seven daily snapshots, and three
monthly snapshots globally, but keep only two hourly snapshots for `tag_wiki`:

```json
{
  "checkpoints": {
    "enabled": true,
    "grandfathering": {
      "hour": { "max": 4, "rollover": "day", "perBucketMax": 1 },
      "day": { "max": 7, "rollover": "month", "perBucketMax": 1 },
      "month": { "max": 3, "rollover": null, "perBucketMax": 1 }
    },
    "overrides": {
      "tag_wiki": {
        "hour": { "max": 2, "rollover": null, "perBucketMax": 1 }
      }
    }
  }
}
```

Override keys are resource names:

- JSON config file stems, such as `config`, `secure.config`,
  `prompt.config`, or `workspace_desktop`.
- Database checkpoint names, such as `tag_wiki`, `notes`, `vfs`,
  `application_auth`, `knowledge_memory`, or `tag_search`.
- `bundles` for manual bundle manifests.

With tiered retention enabled, database cleanup also enforces a hard safety cap
of `max(maxCheckpoints * 2, 50)` after grandfathering so a high-retention config
cannot leave an unbounded number of database files.

## Boot reconciliation and legacy files

`GlobalResources.initializeGlobalCheckpointManager()`:

1. Registers JSON and database checkpoint managers.
2. Starts the staggered hourly checkpoint cycle.
3. Runs `reconcileAllCheckpointRetention()`.

Boot reconciliation scans `.cache/checkpoints/`, applies the current retention
policy to each resource, migrates flat timestamped checkpoints into `hour/`,
cleans legacy database checkpoint filenames once tiered files exist, and removes
orphan `-wal` / `-shm` files.

## Restore workflow

Use the config editor checkpoint actions rather than copying files by hand:

| Action | Auth | Notes |
|--------|------|-------|
| `config_editor_checkpoints_list` | session | Lists bundle and per-config checkpoints, retention settings, and included resources |
| `config_editor_checkpoints_get` | admin | Loads manifest/detail for review |
| `config_editor_checkpoints_create` | admin/destructive | Creates a manual bundle snapshot |
| `config_editor_checkpoints_restore` | admin/destructive | Validates files, creates a safety checkpoint by default, closes affected databases, restores JSON and database files, broadcasts `config_checkpoint_restored` |
| `config_editor_checkpoints_delete` | admin/destructive | Deletes bundle manifests and unreferenced resource checkpoint files |

Single config-file restores are supported with `file:<resource>:<filename>`
checkpoint ids. Bundle restores validate JSON checkpoints and run SQLite
`integrity_check` before replacing live files.

## Troubleshooting

### Checkpoint directory keeps growing

1. Inspect `config.checkpoints.grandfathering` and resource overrides.
2. Confirm the resource key matches the checkpoint directory name.
3. Run the retention-focused tests:

   ```bash
   node scripts/test-checkpoint-retention.js
   node scripts/test-checkpoint-cap.js
   ```

4. Check for orphan sidecars. They should disappear on boot reconciliation or
   the next cleanup pass.

### New database has no scheduled checkpoints

Register its checkpoint manager in
`GlobalResources.initializeGlobalCheckpointManager()` or make sure it is managed
through `asyncSQLiteManager.getDatabase()`. Scheduled checkpoints skip databases
that are closed/idle or not dirty.

### Restore fails validation

- Missing files in a bundle manifest mean the referenced resource checkpoint was
  removed or never created.
- JSON failures come from the resource validation callback.
- Database failures come from SQLite `integrity_check`.
- Prefer creating a fresh manual bundle before retrying so there is a current
  safety checkpoint.

### Sidecar files look like checkpoints

Files ending in `-wal`, `-shm`, or `-journal` are SQLite companions, not
checkpoint records. Do not tune retention around them; fix the main checkpoint
record or let cleanup remove orphan sidecars.
