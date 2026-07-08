/**
 * Replication maintenance paired ACK — HTTP endpoint for partner release.
 */

const replicationMaintenance = require('../../replicationMaintenance');
const replicationTokenAuth = require('../../replicationTokenAuth');
const { REPLICATION_ERROR_CODES, REPLICATION_TOKEN_SCOPES } = require('../replicationContracts');

function sendReplicationError(res, status, err) {
    res.status(status).json({
        success: false,
        error: err.message || 'Replication maintenance error',
        code: err.code || REPLICATION_ERROR_CODES.MAINTENANCE,
        timestamp: new Date().toISOString()
    });
}

function register(app, globalResources) {
    app.post('/replication/maintenance/ack', async (req, res) => {
        try {
            const config = globalResources.getReplicationService().getReplicationConfig();
            const token = replicationTokenAuth.getReplicationTokenFromRequest(req);
            if (!replicationTokenAuth.validateReplicationToken(config, token, {
                scope: REPLICATION_TOKEN_SCOPES.CARGO_WRITE
            })) {
                return sendReplicationError(res, 401, Object.assign(new Error('Invalid replication token'), {
                    code: REPLICATION_ERROR_CODES.TOKEN_INVALID
                }));
            }

            const body = req.body || {};
            const ackResult = replicationMaintenance.receivePartnerMaintenanceAck({
                sessionId: body.maintenanceSessionId || body.sessionId || null,
                partnerInstanceId: body.partnerInstanceId || body.instanceId || null,
                operation: body.operation || null
            });

            if (!ackResult.ok) {
                return sendReplicationError(res, 409, new Error(ackResult.reason || 'Maintenance ACK rejected'));
            }

            res.json({
                success: true,
                data: {
                    acknowledged: true,
                    exited: ackResult.exited === true,
                    maintenance: replicationMaintenance.buildMaintenanceAckPayload()
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });
}

module.exports = { register };
