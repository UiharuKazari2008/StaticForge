/**
 * Replication peer TCP server — fast bulk cargo on port 9221 (default).
 * Protocol: REPL_TAR_BEGIN → raw stream → REPL_TAR_END { sha256 }
 */

const net = require('net');
const replicationTarStream = require('./replicationTarStream');
const replicationMaintenance = require('./replicationMaintenance');
const replicationTokenAuth = require('./replicationTokenAuth');
const { REPLICATION_TOKEN_SCOPES } = require('./replication/replicationContracts');

const DEFAULT_PEER_PORT = 9221;
const MAX_FRAME_BYTES = 64 * 1024;

let globalResourcesRef = null;
let server = null;
let activeSessions = new Map();

function initialize(globalResources) {
    globalResourcesRef = globalResources;
}

function getPeerPort() {
    if (!globalResourcesRef) return DEFAULT_PEER_PORT;
    try {
        const replicationService = globalResourcesRef.getReplicationService();
        const config = replicationService.getReplicationConfig();
        if (config.masterPeerPort && Number.isFinite(Number(config.masterPeerPort))) {
            return Number(config.masterPeerPort);
        }
    } catch (_e) {}
    return DEFAULT_PEER_PORT;
}

function getReplicationToken() {
    if (!globalResourcesRef) return null;
    try {
        const replicationService = globalResourcesRef.getReplicationService();
        return replicationService.getReplicationConfig().replicationToken || null;
    } catch (_e) {
        return null;
    }
}

function validateToken(token) {
    if (!globalResourcesRef) {
        const expected = getReplicationToken();
        if (!expected) return true;
        return token === expected;
    }
    try {
        const replicationService = globalResourcesRef.getReplicationService();
        const config = replicationService.getReplicationConfig();
        return replicationTokenAuth.validateReplicationToken(config, token, {
            scope: REPLICATION_TOKEN_SCOPES.CARGO_WRITE
        });
    } catch (_e) {
        return false;
    }
}

function parseFrameLine(line) {
    if (!line || !line.trim()) return null;
    try {
        return JSON.parse(line);
    } catch (_e) {
        return null;
    }
}

function createReceiveSession(socket, beginFrame, cargoService, initialBuffer) {
    const sessionId = beginFrame.manifestId || `peer-${Date.now()}`;
    const transferMode = beginFrame.transferMode || 'tape-stream-compressed';
    const expectedBytes = beginFrame.totalBytes != null ? Number(beginFrame.totalBytes) : null;
    let receivedBytes = 0;
    let phase = 'stream';
    let frameBuffer = Buffer.alloc(0);
    const chunks = [];

    const session = {
        sessionId,
        transferMode,
        socket,
        receivedBytes: () => receivedBytes,
        abort(err) {
            socket.destroy(err || new Error('Peer session aborted'));
        }
    };

    activeSessions.set(sessionId, session);

    const finishReceive = async (endFrame) => {
        activeSessions.delete(sessionId);
        const raw = Buffer.concat(chunks);
        try {
            const result = await cargoService.handlePeerReceiveComplete({
                manifestId: sessionId,
                transferMode,
                raw,
                expectedSha256: endFrame.sha256,
                expectedBytes,
                receivedBytes: raw.length,
                partnerMaintenanceSessionId: beginFrame.maintenanceSessionId || null,
                partnerInstanceId: beginFrame.instanceId || null
            });
            const maintPayload = replicationMaintenance.buildMaintenanceAckPayload();
            socket.write(replicationTarStream.encodePeerFrame({
                type: 'REPL_ACK',
                manifestId: sessionId,
                ok: true,
                response: result,
                maintenanceSessionId: maintPayload.maintenanceSessionId
            }));
            if (beginFrame.maintenanceSessionId) {
                replicationMaintenance.receivePartnerMaintenanceAck({
                    sessionId: beginFrame.maintenanceSessionId,
                    partnerInstanceId: beginFrame.instanceId || null
                });
            }
            replicationMaintenance.markLocalWorkComplete({ reason: 'peer import complete' });
            socket.write(replicationTarStream.encodePeerFrame({
                type: replicationTarStream.PEER_FRAME.MAINT_ACK,
                manifestId: sessionId,
                maintenanceSessionId: maintPayload.maintenanceSessionId
            }));
        } catch (err) {
            socket.write(replicationTarStream.encodePeerFrame({
                type: 'REPL_ACK',
                manifestId: sessionId,
                ok: false,
                error: err.message
            }));
        }
        socket.end();
    };

    const processBuffer = async () => {
        if (phase === 'stream') {
            if (expectedBytes != null) {
                if (frameBuffer.length < expectedBytes) return;
                const streamPart = frameBuffer.slice(0, expectedBytes);
                frameBuffer = frameBuffer.slice(expectedBytes);
                chunks.push(streamPart);
                receivedBytes = streamPart.length;
                phase = 'end';
            } else {
                chunks.push(frameBuffer);
                receivedBytes += frameBuffer.length;
                frameBuffer = Buffer.alloc(0);
                return;
            }
        }

        if (phase === 'end') {
            const nl = frameBuffer.indexOf(0x0a);
            if (nl < 0) return;
            const line = frameBuffer.slice(0, nl).toString('utf8');
            frameBuffer = frameBuffer.slice(nl + 1);
            const endFrame = parseFrameLine(line);
            if (!endFrame || endFrame.type !== replicationTarStream.PEER_FRAME.TAR_END) {
                session.abort(new Error('Expected REPL_TAR_END frame'));
                return;
            }
            await finishReceive(endFrame);
        }
    };

    const onData = (chunk) => {
        frameBuffer = Buffer.concat([frameBuffer, chunk]);
        processBuffer().catch((err) => session.abort(err));
    };

    if (initialBuffer && initialBuffer.length > 0) {
        onData(initialBuffer);
    }
    socket.on('data', onData);
    socket.on('end', () => {
        if (phase === 'stream' && expectedBytes == null && frameBuffer.length > 0) {
            chunks.push(frameBuffer);
            frameBuffer = Buffer.alloc(0);
            phase = 'end';
            processBuffer().catch((err) => session.abort(err));
        }
    });
    socket.on('error', () => activeSessions.delete(sessionId));
    socket.on('close', () => activeSessions.delete(sessionId));

    return session;
}

async function sendTarStream({ host, port, beginFrame, stream, token, rawForHash }) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port }, () => {
            socket.write(replicationTarStream.encodePeerFrame({
                type: replicationTarStream.PEER_FRAME.TAR_BEGIN,
                manifestId: beginFrame.manifestId,
                transferMode: beginFrame.transferMode,
                totalBytes: beginFrame.totalBytes != null ? beginFrame.totalBytes : null,
                token: token || null,
                maintenanceSessionId: beginFrame.maintenanceSessionId || replicationMaintenance.getMaintenanceSessionId(),
                instanceId: beginFrame.instanceId || null
            }));

            const chunks = [];
            stream.on('data', (chunk) => {
                chunks.push(chunk);
                socket.write(chunk);
            });
            stream.on('end', async () => {
                try {
                    const raw = rawForHash || Buffer.concat(chunks);
                    const sha256 = await replicationTarStream.sha256Buffer(raw);
                    socket.write(replicationTarStream.encodePeerFrame({
                        type: replicationTarStream.PEER_FRAME.TAR_END,
                        manifestId: beginFrame.manifestId,
                        sha256
                    }));
                } catch (err) {
                    reject(err);
                    socket.destroy();
                }
            });
            stream.on('error', (err) => {
                reject(err);
                socket.destroy();
            });
        });

        let ackBuffer = '';
        let ackResolved = false;
        socket.on('data', (chunk) => {
            ackBuffer += chunk.toString('utf8');
            let nl = ackBuffer.indexOf('\n');
            while (nl >= 0) {
                const line = ackBuffer.slice(0, nl);
                ackBuffer = ackBuffer.slice(nl + 1);
                nl = ackBuffer.indexOf('\n');
                const frame = parseFrameLine(line);
                if (!frame) continue;
                if (frame.type === 'REPL_ACK') {
                    if (!frame.ok) {
                        if (!ackResolved) {
                            ackResolved = true;
                            reject(new Error(frame.error || 'Peer rejected cargo'));
                        }
                        socket.end();
                        continue;
                    }
                    if (frame.maintenanceSessionId) {
                        replicationMaintenance.receivePartnerMaintenanceAck({
                            sessionId: frame.maintenanceSessionId
                        });
                    }
                    if (!ackResolved) {
                        ackResolved = true;
                        resolve(frame);
                    }
                } else if (frame.type === replicationTarStream.PEER_FRAME.MAINT_ACK) {
                    replicationMaintenance.receivePartnerMaintenanceAck({
                        sessionId: frame.maintenanceSessionId
                    });
                }
            }
        });
        socket.on('error', reject);
    });
}

function startPeerServer(cargoService) {
    if (server) return server;

    const port = getPeerPort();
    server = net.createServer((socket) => {
        let prelude = '';
        let beginFrame = null;

        const onInitial = (chunk) => {
            prelude += chunk.toString('utf8');
            const nl = prelude.indexOf('\n');
            if (nl < 0) {
                if (prelude.length > MAX_FRAME_BYTES) {
                    socket.destroy();
                }
                return;
            }

            socket.removeListener('data', onInitial);
            const line = prelude.slice(0, nl);
            const remainder = Buffer.from(prelude.slice(nl + 1), 'utf8');
            beginFrame = parseFrameLine(line);

            if (!beginFrame || beginFrame.type !== replicationTarStream.PEER_FRAME.TAR_BEGIN) {
                socket.write(replicationTarStream.encodePeerFrame({
                    type: 'REPL_ERROR',
                    error: 'Expected REPL_TAR_BEGIN frame'
                }));
                socket.end();
                return;
            }

            if (!validateToken(beginFrame.token)) {
                socket.write(replicationTarStream.encodePeerFrame({
                    type: 'REPL_ERROR',
                    error: 'Invalid replication token'
                }));
                socket.end();
                return;
            }

            createReceiveSession(socket, beginFrame, cargoService, remainder);
        };

        socket.on('data', onInitial);
        socket.on('error', () => {});
    });

    server.listen(port, '0.0.0.0', () => {
        if (globalResourcesRef && globalResourcesRef.getLogger) {
            globalResourcesRef.getLogger().info(`✓ Replication peer server listening on :${port}`);
        } else {
            console.log(`✓ Replication peer server listening on :${port}`);
        }
    });

    server.on('error', (err) => {
        if (globalResourcesRef && globalResourcesRef.getLogger) {
            globalResourcesRef.getLogger().error(`Replication peer server error: ${err.message}`);
        }
    });

    return server;
}

function stopPeerServer() {
    if (!server) return;
    server.close();
    server = null;
}

function getActiveSessions() {
    return Array.from(activeSessions.values()).map((s) => ({
        sessionId: s.sessionId,
        transferMode: s.transferMode,
        receivedBytes: s.receivedBytes()
    }));
}

module.exports = {
    DEFAULT_PEER_PORT,
    initialize,
    startPeerServer,
    stopPeerServer,
    sendTarStream,
    getActiveSessions,
    getPeerPort
};
