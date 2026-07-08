/**
 * Replication HTTP status routes.
 */

function register(app, globalResources) {
    const authMiddleware = globalResources.getAuthMiddleware();

    app.get('/replication/status', authMiddleware, (req, res) => {
        try {
            const replicationService = globalResources.getReplicationService();
            res.json({
                success: true,
                data: replicationService.getStatus(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get replication status'
            });
        }
    });
}

module.exports = { register };
