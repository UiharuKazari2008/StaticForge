/**
 * Master–child replication contracts — shared constants for server, client docs, and later agents.
 */

const REPLICATION_ROLES = Object.freeze(['master', 'child', 'ephemeral', 'standalone']);
const REPLICATION_CONNECTIVITY = Object.freeze(['normal', 'airgapped', 'delegated-only']);
const REPLICATION_TRANSFER_MODES = Object.freeze(['tape-stream', 'tape-stream-compressed', 'blocks']);
const REPLICATION_GALLERY_SHARED_DEFAULTS = Object.freeze(['always', 'never', 'manual']);
const REPLICATION_CHANGE_ORIGINS = Object.freeze(['user', 'system', 'replication']);

const DEFAULT_CLONE_PROFILE = Object.freeze({
    wikiData: true,
    wikiMedia: false,
    autoComplete: true,
    workspaceImages: false,
    previewCache: true,
    imageMetadata: true
});

const DEFAULT_REPLICATION_CONFIG = Object.freeze({
    role: 'standalone',
    connectivity: 'normal',
    instanceId: null,
    displayName: '',
    pairedAt: null,
    separationManifestId: null,
    masterAccessUrl: null,
    masterWsUrl: null,
    masterPeerHost: null,
    masterPeerPort: null,
    replicationToken: null,
    replicationReadToken: null,
    cloneProfile: { ...DEFAULT_CLONE_PROFILE },
    transferMode: 'tape-stream-compressed',
    gallerySharedDefault: 'manual',
    children: [],
    lastAppliedRemoteLsn: {}
});

/** WebSocket request packet names (client → server). */
const REPLICATION_WS_REQUESTS = Object.freeze({
    STATUS: 'replication_status',
    SYNC_BEGIN: 'replication_sync_begin',
    SYNC_STATUS: 'replication_sync_status',
    SYNC_APPLY: 'replication_sync_apply',
    SEPARATION_PREPARE: 'replication_separation_prepare',
    SEPARATION_STATUS: 'replication_separation_status',
    SEPARATION_BOOTSTRAP_PREVIEW: 'replication_separation_bootstrap_preview',
    SEPARATION_BOOTSTRAP_APPLY: 'replication_separation_bootstrap_apply',
    DELEGATE: 'replication_delegate',
    DELEGATION_STATUS: 'replication_delegation_status',
    AUTHENTICATE: 'authenticate_replication',
    REMOTE_GALLERY: 'replication_request_remote_gallery'
});

/** WebSocket response packet names (server → client, request/reply). */
const REPLICATION_WS_RESPONSES = Object.freeze({
    STATUS: 'replication_status_response',
    SYNC_BEGIN: 'replication_sync_begin_response',
    SYNC_STATUS: 'replication_sync_status_response',
    SYNC_APPLY: 'replication_sync_apply_response',
    SYNC_COMPLETE: 'replication_sync_complete',
    SEPARATION_PREPARE: 'replication_separation_prepare_response',
    SEPARATION_STATUS: 'replication_separation_status_response',
    SEPARATION_BOOTSTRAP_PREVIEW: 'replication_separation_bootstrap_preview_response',
    SEPARATION_BOOTSTRAP_APPLY: 'replication_separation_bootstrap_apply_response',
    DELEGATE: 'replication_delegate_response',
    DELEGATION_STATUS: 'replication_delegation_status_response',
    AUTHENTICATED: 'replication_authenticated',
    REMOTE_GALLERY: 'replication_request_remote_gallery_response'
});

/** WebSocket response / server push packet names. */
const REPLICATION_WS_PUSH = Object.freeze({
    STATUS_RESPONSE: REPLICATION_WS_RESPONSES.STATUS,
    MAINTENANCE: 'replication_maintenance',
    PROGRESS: 'replication_progress',
    SYNC_STATUS: 'replication_sync_status',
    SYNC_COMPLETE: REPLICATION_WS_RESPONSES.SYNC_COMPLETE
});

/**
 * Replication token scopes (authenticate_replication / paired HTTP).
 * - read: asset GET + status probes (X-Replication-Token)
 * - wiki / autocomplete: delegated WS reads on master
 * - cargo-write: peer TCP + /replication/sync/* partner routes (same token today)
 */
const REPLICATION_TOKEN_SCOPES = Object.freeze({
    READ: 'read',
    WIKI: 'wiki',
    AUTOCOMPLETE: 'autocomplete',
    CARGO_WRITE: 'cargo-write'
});

/** Blocks transfer mode requires this exact confirmation string (DSAP, CLI, API). */
const BLOCKS_SLOW_PATH_CONFIRMATION = 'Transforming cargo as Blocks (file-by-file) may be extremely slow for large galleries. Prefer Tape Stream (Compressed) unless you need a single file.';

/** Packets allowed while maintenance is active (in addition to non-destructive reads). */
const REPLICATION_MAINTENANCE_ALLOWED_PACKETS = Object.freeze([
    'ping',
    'pong',
    'server_status',
    'replication_status',
    'replication_sync_status',
    'replication_separation_status',
    'get_system_info',
    'version_check',
    'check_updates'
]);

/**
 * Destructive replication WS packets — merged into websocketHandlers.isDestructiveOperation().
 * Cargo/upsert use HTTP routes; no WS packet names for those operations.
 */
const REPLICATION_DESTRUCTIVE_WS_PACKETS = Object.freeze([
    REPLICATION_WS_REQUESTS.SYNC_BEGIN,
    REPLICATION_WS_REQUESTS.SYNC_APPLY,
    REPLICATION_WS_REQUESTS.SEPARATION_PREPARE,
    REPLICATION_WS_REQUESTS.SEPARATION_BOOTSTRAP_APPLY
]);

function isReplicationDestructivePacket(packetType) {
    return REPLICATION_DESTRUCTIVE_WS_PACKETS.includes(packetType);
}

/** Structured error codes surfaced to clients and cargo handlers. */
const REPLICATION_ERROR_CODES = Object.freeze({
    MAINTENANCE: 'REPLICATION_MAINTENANCE',
    ASSET_UNAVAILABLE: 'REPLICATION_ASSET_UNAVAILABLE',
    ROLE_MISMATCH: 'REPLICATION_ROLE_MISMATCH',
    CONNECTIVITY_BLOCKED: 'REPLICATION_CONNECTIVITY_BLOCKED',
    TOKEN_INVALID: 'REPLICATION_TOKEN_INVALID',
    TRANSFER_ABORTED: 'REPLICATION_TRANSFER_ABORTED'
});

/**
 * Packets delegated to master WebSocket when cloneProfile omits local service data.
 * Value: service key matching cloneProfile field.
 */
const REPLICATION_DELEGATED_PACKETS = Object.freeze({
    search_tag_wiki: 'wikiData',
    get_tag_wiki_page: 'wikiData',
    resolve_grimoire_url: 'wikiData',
    search_tags: 'autoComplete',
    search_characters: 'autoComplete',
    get_tag_autofill: 'autoComplete'
});

/** Static wiki packets delegated when cloneProfile.wikiData is false. */
const REPLICATION_DELEGATED_STATIC_WIKI_PACKETS = Object.freeze({
    get_wiki_home: 'wikiData',
    get_static_wiki_site_index: 'wikiData',
    get_static_wiki_page: 'wikiData'
});

/** Ack-less autofill packets delegated when cloneProfile.autoComplete is false. */
const REPLICATION_DELEGATED_ACKLESS_PACKETS = Object.freeze({
    search_characters: 'autoComplete',
    fetch_autofill_wiki_previews: 'autoComplete'
});

function getReplicationDelegatedPacketMap() {
    return {
        ...REPLICATION_DELEGATED_PACKETS,
        ...REPLICATION_DELEGATED_STATIC_WIKI_PACKETS,
        ...REPLICATION_DELEGATED_ACKLESS_PACKETS
    };
}

function isReplicationDelegatedPacket(packetType) {
    return Object.prototype.hasOwnProperty.call(getReplicationDelegatedPacketMap(), packetType);
}

/** Named tar entries inside replication cargo archives. */
const REPLICATION_TAR_ENTRIES = Object.freeze({
    MANIFEST: '/_replication/manifest.json',
    CHANGELOG_SQL: '/_replication/changelog.sql',
    CHANGELOG_JSON: '/_replication/changelog.json'
});

/** SQLite databases tracked via sqliteAsyncWrapper changelog hooks. */
const REPLICATION_TRACKED_SQLITE_DBS = Object.freeze([
    'metadata.db',
    'reference_metadata.db',
    'vfs.db',
    'notes.db'
]);

/** JSON config stores tracked via configManager changelog hooks. */
const REPLICATION_TRACKED_CONFIG_TYPES = Object.freeze([
    'workspaces',
    'favorites',
    'promptConfig',
    'directorConfig'
]);

const REPLICATION_CONFIG_JSON_NAMES = Object.freeze({
    workspaces: 'workspace.json',
    favorites: 'favorites.json',
    promptConfig: 'prompt.config.json',
    directorConfig: 'director.config.json'
});

function isReplicationRole(value) {
    return REPLICATION_ROLES.includes(value);
}

function isReplicationConnectivity(value) {
    return REPLICATION_CONNECTIVITY.includes(value);
}

function isReplicationTransferMode(value) {
    return REPLICATION_TRANSFER_MODES.includes(value);
}

function normalizeReplicationConfig(raw) {
    const base = JSON.parse(JSON.stringify(DEFAULT_REPLICATION_CONFIG));
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    const merged = { ...base, ...raw };
    if (!isReplicationRole(merged.role)) {
        merged.role = 'standalone';
    }
    if (!isReplicationConnectivity(merged.connectivity)) {
        merged.connectivity = 'normal';
    }
    if (!isReplicationTransferMode(merged.transferMode)) {
        merged.transferMode = 'tape-stream-compressed';
    }
    if (!REPLICATION_GALLERY_SHARED_DEFAULTS.includes(merged.gallerySharedDefault)) {
        merged.gallerySharedDefault = 'manual';
    }
    merged.cloneProfile = {
        ...DEFAULT_CLONE_PROFILE,
        ...(raw.cloneProfile && typeof raw.cloneProfile === 'object' ? raw.cloneProfile : {})
    };
    merged.children = Array.isArray(raw.children) ? raw.children : [];
    merged.lastAppliedRemoteLsn = raw.lastAppliedRemoteLsn && typeof raw.lastAppliedRemoteLsn === 'object'
        ? raw.lastAppliedRemoteLsn
        : {};
    if (raw.replicationReadToken != null && raw.replicationReadToken !== '') {
        merged.replicationReadToken = String(raw.replicationReadToken);
    } else {
        merged.replicationReadToken = null;
    }
    return merged;
}

function isReplicationEnabled(config) {
    const role = config && config.role ? config.role : 'standalone';
    return role !== 'standalone';
}

/** Ephemeral nodes export cargo manually; full changelog sync is child-only. */
function canRunReplicationAutoSync(config) {
    const role = config && config.role ? config.role : 'standalone';
    return role === 'child';
}

/** Bulk cargo/sync/peer push to master — blocked in airgapped and delegated-only modes. */
function canRunReplicationBulkTransfer(config) {
    const connectivity = config && config.connectivity ? config.connectivity : 'normal';
    return connectivity !== 'airgapped' && connectivity !== 'delegated-only';
}

module.exports = {
    REPLICATION_ROLES,
    REPLICATION_CONNECTIVITY,
    REPLICATION_TRANSFER_MODES,
    REPLICATION_GALLERY_SHARED_DEFAULTS,
    REPLICATION_CHANGE_ORIGINS,
    DEFAULT_CLONE_PROFILE,
    DEFAULT_REPLICATION_CONFIG,
    REPLICATION_WS_REQUESTS,
    REPLICATION_WS_RESPONSES,
    REPLICATION_WS_PUSH,
    REPLICATION_TOKEN_SCOPES,
    BLOCKS_SLOW_PATH_CONFIRMATION,
    REPLICATION_MAINTENANCE_ALLOWED_PACKETS,
    REPLICATION_DESTRUCTIVE_WS_PACKETS,
    REPLICATION_ERROR_CODES,
    REPLICATION_DELEGATED_PACKETS,
    REPLICATION_DELEGATED_STATIC_WIKI_PACKETS,
    REPLICATION_DELEGATED_ACKLESS_PACKETS,
    REPLICATION_TAR_ENTRIES,
    REPLICATION_TRACKED_SQLITE_DBS,
    REPLICATION_TRACKED_CONFIG_TYPES,
    REPLICATION_CONFIG_JSON_NAMES,
    getReplicationDelegatedPacketMap,
    isReplicationDelegatedPacket,
    isReplicationRole,
    isReplicationConnectivity,
    isReplicationTransferMode,
    normalizeReplicationConfig,
    isReplicationEnabled,
    canRunReplicationAutoSync,
    canRunReplicationBulkTransfer,
    isReplicationDestructivePacket
};
