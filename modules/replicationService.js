/**
 * Replication service facade — coordinates maintenance, changelog, and future cargo/sync/delegation agents.
 */

const crypto = require('crypto');
const {
    normalizeReplicationConfig,
    isReplicationEnabled,
    REPLICATION_WS_PUSH,
    REPLICATION_DELEGATED_PACKETS,
    DEFAULT_CLONE_PROFILE
} = require('./replication/replicationContracts');
const replicationMaintenance = require('./replicationMaintenance');
const replicationChangelog = require('./replicationChangelog');
const replicationJournal = require('./replicationJournal');
const replicationAssetRegistry = require('./replicationAssetRegistry');
const replicationSeparation = require('./replicationSeparation');

let globalResourcesRef = null;
let cargoService = null;
let syncService = null;
const delegationStatus = {
    wikiData: 'local',
    autoComplete: 'local',
    wikiMedia: 'local',
    masterWsConnected: false
};

/**
 * Foundation init order: maintenance → changelog → journal → asset registry → separation → config.
 * Cargo and sync services register later via HTTP route registration (after journal is ready).
 */
async function initialize(globalResources) {
    globalResourcesRef = globalResources;
    const replicationChangelog = require('./replicationChangelog');

    replicationMaintenance.initialize(globalResources);
    await replicationChangelog.initialize(globalResources);
    await replicationJournal.initialize(globalResources);
    await replicationAssetRegistry.initialize(globalResources);
    replicationSeparation.initialize(globalResources);
    ensureReplicationConfig();
    return true;
}

function ensureReplicationConfig() {
    if (!globalResourcesRef || !globalResourcesRef.configManager) return;
    const configManager = globalResourcesRef.configManager;
    const secure = configManager._getReactiveConfig('secureConfig');
    if (!secure) return;

    let modified = false;
    if (!secure.replication || typeof secure.replication !== 'object') {
        secure.replication = normalizeReplicationConfig(null);
        modified = true;
    } else {
        const normalized = normalizeReplicationConfig(secure.replication);
        if (!secure.replication.instanceId) {
            normalized.instanceId = crypto.randomUUID();
            modified = true;
        }
        if (JSON.stringify(normalized) !== JSON.stringify(secure.replication)) {
            secure.replication = normalized;
            modified = true;
        }
    }

    if (modified) {
        configManager.saveConfig('secureConfig', secure, { skipCheckpoint: false, force: true });
    }
}

function getReplicationConfig() {
    if (!globalResourcesRef) return normalizeReplicationConfig(null);
    const secure = globalResourcesRef.getSecureConfig ? globalResourcesRef.getSecureConfig() : null;
    return normalizeReplicationConfig(secure && secure.replication ? secure.replication : null);
}

function resolveDelegationStatus(config) {
    const profile = config.cloneProfile || DEFAULT_CLONE_PROFILE;
    const connectivity = config.connectivity || 'normal';
    const airgapped = connectivity === 'airgapped';

    const resolveService = (key, profileKey) => {
        if (profile[profileKey] === true) return 'local';
        if (airgapped) return 'unavailable';
        if (!config.masterWsUrl && !config.masterAccessUrl) return 'unavailable';
        return delegationStatus[key] || 'delegated';
    };

    return {
        wikiData: resolveService('wikiData', 'wikiData'),
        autoComplete: resolveService('autoComplete', 'autoComplete'),
        wikiMedia: resolveService('wikiMedia', 'wikiMedia'),
        masterWsConnected: delegationStatus.masterWsConnected === true
    };
}

function getStatus() {
    const config = getReplicationConfig();
    const maintenance = replicationMaintenance.getState();
    return {
        enabled: isReplicationEnabled(config),
        role: config.role,
        connectivity: config.connectivity,
        instanceId: config.instanceId,
        displayName: config.displayName || '',
        pairedAt: config.pairedAt,
        separationManifestId: config.separationManifestId,
        masterAccessUrl: config.masterAccessUrl,
        masterWsUrl: config.masterWsUrl,
        masterPeerHost: config.masterPeerHost,
        masterPeerPort: config.masterPeerPort,
        cloneProfile: config.cloneProfile,
        transferMode: config.transferMode,
        gallerySharedDefault: config.gallerySharedDefault,
        children: config.children || [],
        lastAppliedRemoteLsn: config.lastAppliedRemoteLsn || {},
        maintenance: {
            active: maintenance.active,
            operation: maintenance.operation,
            partnerInstanceId: maintenance.partnerInstanceId,
            reason: maintenance.reason,
            transferMode: maintenance.transferMode,
            startedAt: maintenance.startedAt
        },
        delegation: resolveDelegationStatus(config),
        changelogReady: replicationChangelog.isInitialized()
    };
}

function registerCargoService(service) {
    cargoService = service || null;
}

function registerSyncService(service) {
    syncService = service || null;
}

function getCargoService() {
    return cargoService;
}

function getSyncService() {
    return syncService;
}

function updateDelegationStatus(patch) {
    if (!patch || typeof patch !== 'object') return { ...delegationStatus };
    if (typeof patch.wikiData === 'string') delegationStatus.wikiData = patch.wikiData;
    if (typeof patch.autoComplete === 'string') delegationStatus.autoComplete = patch.autoComplete;
    if (typeof patch.wikiMedia === 'string') delegationStatus.wikiMedia = patch.wikiMedia;
    if (typeof patch.masterWsConnected === 'boolean') {
        delegationStatus.masterWsConnected = patch.masterWsConnected;
    }
    return { ...delegationStatus };
}

function getDelegatedPacketTable() {
    return { ...REPLICATION_DELEGATED_PACKETS };
}

function isDelegatedPacket(packetType) {
    return Object.prototype.hasOwnProperty.call(REPLICATION_DELEGATED_PACKETS, packetType);
}

function buildStatusResponse(requestId) {
    return {
        type: REPLICATION_WS_PUSH.STATUS_RESPONSE,
        requestId: requestId || null,
        data: {
            success: true,
            ...getStatus()
        },
        timestamp: new Date().toISOString()
    };
}

function getMaintenance() {
    return replicationMaintenance;
}

function getJournal() {
    return replicationJournal;
}

function getAssetRegistry() {
    return replicationAssetRegistry;
}

function getSeparation() {
    return replicationSeparation;
}

module.exports = {
    initialize,
    getReplicationConfig,
    getStatus,
    buildStatusResponse,
    registerCargoService,
    registerSyncService,
    getCargoService,
    getSyncService,
    updateDelegationStatus,
    getDelegatedPacketTable,
    isDelegatedPacket,
    ensureReplicationConfig,
    getMaintenance,
    getJournal,
    getAssetRegistry,
    getSeparation
};
