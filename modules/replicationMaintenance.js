/**
 * Replication maintenance mode — blocks writes during separation, Upsert, and Sync.
 */

const crypto = require('crypto');
const {
    REPLICATION_WS_PUSH,
    REPLICATION_MAINTENANCE_ALLOWED_PACKETS,
    REPLICATION_ERROR_CODES
} = require('./replication/replicationContracts');

const DEFAULT_MAINTENANCE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_PARTNER_ACK_WAIT_MS = 10 * 60 * 1000;

let globalResourcesRef = null;
let maintenanceTimer = null;
let partnerAckWaiter = null;
let state = {
    active: false,
    operation: null,
    partnerInstanceId: null,
    reason: null,
    transferMode: null,
    startedAt: null,
    maintenanceSessionId: null,
    localWorkComplete: false,
    partnerAcknowledged: false,
    pendingExitReason: null
};

function clearPartnerAckWaiter() {
    if (partnerAckWaiter) {
        if (partnerAckWaiter.timer) {
            clearTimeout(partnerAckWaiter.timer);
        }
        partnerAckWaiter = null;
    }
}

function getMaintenanceSessionId() {
    return state.maintenanceSessionId;
}

function buildMaintenanceAckPayload(extra = {}) {
    return {
        maintenanceSessionId: state.maintenanceSessionId,
        operation: state.operation,
        partnerInstanceId: state.partnerInstanceId,
        instanceId: globalResourcesRef && globalResourcesRef.getReplicationService
            ? globalResourcesRef.getReplicationService().getReplicationConfig().instanceId
            : null,
        ...extra
    };
}

function attemptPairedExit() {
    if (!state.active || !state.localWorkComplete) {
        return false;
    }
    if (!state.partnerInstanceId || state.partnerAcknowledged) {
        const reason = state.pendingExitReason || (state.partnerInstanceId ? 'paired release' : 'complete');
        exitMaintenance({ reason });
        return true;
    }
    return false;
}

function markLocalWorkComplete({ reason = null } = {}) {
    if (!state.active) return { ok: false };
    state.localWorkComplete = true;
    if (reason) {
        state.pendingExitReason = reason;
    }
    attemptPairedExit();
    return { ok: true, exited: !state.active };
}

function receivePartnerMaintenanceAck({
    sessionId = null,
    partnerInstanceId = null,
    operation = null
} = {}) {
    if (!state.active) {
        return { ok: false, reason: 'not-active' };
    }
    if (sessionId && state.maintenanceSessionId && sessionId !== state.maintenanceSessionId) {
        return { ok: false, reason: 'session-mismatch' };
    }
    if (partnerInstanceId && state.partnerInstanceId && partnerInstanceId !== state.partnerInstanceId) {
        return { ok: false, reason: 'partner-mismatch' };
    }
    if (operation && state.operation && operation !== state.operation) {
        return { ok: false, reason: 'operation-mismatch' };
    }
    state.partnerAcknowledged = true;
    if (partnerAckWaiter && typeof partnerAckWaiter.resolve === 'function') {
        partnerAckWaiter.resolve({ acked: true });
    }
    clearPartnerAckWaiter();
    attemptPairedExit();
    return { ok: true, exited: !state.active };
}

function waitForPartnerMaintenanceAck({ timeoutMs = DEFAULT_PARTNER_ACK_WAIT_MS } = {}) {
    if (!state.active) {
        return Promise.resolve({ acked: false, reason: 'not-active' });
    }
    if (state.partnerAcknowledged) {
        return Promise.resolve({ acked: true });
    }
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            clearPartnerAckWaiter();
            resolve({ acked: false, timedOut: true });
        }, timeoutMs);
        if (timer && typeof timer.unref === 'function') {
            timer.unref();
        }
        partnerAckWaiter = {
            timer,
            resolve: (result) => {
                clearTimeout(timer);
                partnerAckWaiter = null;
                resolve(result);
            }
        };
    });
}

async function exitMaintenanceAfterPartnerAck({
    reason = null,
    sendPartnerAck = null,
    waitForAck = true,
    waitTimeoutMs = DEFAULT_PARTNER_ACK_WAIT_MS
} = {}) {
    markLocalWorkComplete({ reason });
    if (typeof sendPartnerAck === 'function') {
        try {
            await sendPartnerAck(buildMaintenanceAckPayload());
        } catch (_err) {}
    }
    if (!waitForAck) {
        return { exited: !state.active, waiting: false };
    }
    const waitResult = await waitForPartnerMaintenanceAck({ timeoutMs: waitTimeoutMs });
    if (waitResult.acked) {
        attemptPairedExit();
    }
    return {
        exited: !state.active,
        waiting: state.active && state.localWorkComplete && !state.partnerAcknowledged,
        timedOut: waitResult.timedOut === true
    };
}

function initialize(globalResources) {
    globalResourcesRef = globalResources;
}

function getState() {
    return { ...state };
}

function isActive() {
    return state.active === true;
}

function isWriteBlocked() {
    return state.active === true;
}

function isPacketAllowedDuringMaintenance(packetType) {
    if (!state.active) return true;
    return REPLICATION_MAINTENANCE_ALLOWED_PACKETS.includes(packetType);
}

function shouldBlockPacket(packetType, isDestructiveFn) {
    if (!state.active) return false;
    if (isPacketAllowedDuringMaintenance(packetType)) return false;
    if (typeof isDestructiveFn === 'function' && isDestructiveFn(packetType)) return true;
    return false;
}

function clearMaintenanceWatchdog() {
    if (maintenanceTimer) {
        clearTimeout(maintenanceTimer);
        maintenanceTimer = null;
    }
}

function scheduleMaintenanceWatchdog() {
    clearMaintenanceWatchdog();
    maintenanceTimer = setTimeout(() => {
        if (!state.active) return;
        const snapshot = { ...state };
        const logMsg = `Replication maintenance timeout (${snapshot.operation || 'unknown'}) — partner did not complete`;
        if (globalResourcesRef && globalResourcesRef.getLogger) {
            globalResourcesRef.getLogger().warn(`⚠️ ${logMsg}`);
        } else {
            console.warn(`⚠️ ${logMsg}`);
        }
        exitMaintenance({ reason: 'timeout' });
        if (globalResourcesRef) {
            let wsServer;
            try {
                wsServer = globalResourcesRef.getWebSocketServer();
            } catch (_e) {
                return;
            }
            if (wsServer && typeof wsServer.broadcastToAll === 'function') {
                wsServer.broadcastToAll({
                    type: REPLICATION_WS_PUSH.MAINTENANCE,
                    data: {
                        active: false,
                        operation: snapshot.operation,
                        partnerInstanceId: snapshot.partnerInstanceId,
                        reason: 'timeout',
                        transferMode: snapshot.transferMode,
                        startedAt: snapshot.startedAt,
                        timedOut: true
                    },
                    timestamp: new Date().toISOString()
                });
            }
        }
    }, DEFAULT_MAINTENANCE_TIMEOUT_MS);
    if (maintenanceTimer && typeof maintenanceTimer.unref === 'function') {
        maintenanceTimer.unref();
    }
}

function broadcastMaintenance(active) {
    if (!globalResourcesRef) return;
    let wsServer;
    try {
        wsServer = globalResourcesRef.getWebSocketServer();
    } catch (_e) {
        return;
    }
    if (!wsServer || typeof wsServer.broadcastToAll !== 'function') return;

    wsServer.broadcastToAll({
        type: REPLICATION_WS_PUSH.MAINTENANCE,
        data: {
            active,
            operation: state.operation,
            partnerInstanceId: state.partnerInstanceId,
            reason: state.reason,
            transferMode: state.transferMode,
            startedAt: state.startedAt
        },
        timestamp: new Date().toISOString()
    });
}

function enterMaintenance({ operation, partnerInstanceId = null, reason = null, transferMode = null } = {}) {
    if (state.active) {
        return { ...state, alreadyActive: true };
    }
    state = {
        active: true,
        operation: operation || 'unknown',
        partnerInstanceId: partnerInstanceId || null,
        reason: reason || 'Replication in progress — writes disabled',
        transferMode: transferMode || null,
        startedAt: new Date().toISOString(),
        maintenanceSessionId: crypto.randomUUID(),
        localWorkComplete: false,
        partnerAcknowledged: false,
        pendingExitReason: null
    };
    broadcastMaintenance(true);
    scheduleMaintenanceWatchdog();
    if (globalResourcesRef && globalResourcesRef.getLogger) {
        globalResourcesRef.getLogger().info(
            `🔒 Replication maintenance entered (${state.operation})`
        );
    }
    return { ...state };
}

function exitMaintenance({ reason = null } = {}) {
    if (!state.active) {
        return { active: false };
    }
    const prev = { ...state };
    clearMaintenanceWatchdog();
    clearPartnerAckWaiter();
    state = {
        active: false,
        operation: null,
        partnerInstanceId: null,
        reason: null,
        transferMode: null,
        startedAt: null,
        maintenanceSessionId: null,
        localWorkComplete: false,
        partnerAcknowledged: false,
        pendingExitReason: null
    };
    broadcastMaintenance(false);
    if (globalResourcesRef && globalResourcesRef.getLogger) {
        globalResourcesRef.getLogger().info(
            `🔓 Replication maintenance exited (${prev.operation})${reason ? `: ${reason}` : ''}`
        );
    }
    return { active: false, previous: prev };
}

function buildMaintenanceErrorResponse(requestId) {
    return {
        type: 'error',
        message: state.reason || 'Replication maintenance in progress — writes disabled',
        code: REPLICATION_ERROR_CODES.MAINTENANCE,
        requestId: requestId || null,
        data: {
            operation: state.operation,
            partnerInstanceId: state.partnerInstanceId
        },
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    initialize,
    getState,
    getMaintenanceSessionId,
    buildMaintenanceAckPayload,
    isActive,
    isWriteBlocked,
    isPacketAllowedDuringMaintenance,
    shouldBlockPacket,
    markLocalWorkComplete,
    receivePartnerMaintenanceAck,
    waitForPartnerMaintenanceAck,
    exitMaintenanceAfterPartnerAck,
    enterMaintenance,
    exitMaintenance,
    buildMaintenanceErrorResponse
};
