// Replication inbound WebSocket handlers — maintenance banner + tray indicator.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

registerWsInboundHandler({
    id: 'replication.maintenance',
    type: 'replication_maintenance',
    phase: 'only',
    handler(message, wsClient) {
        const data = message.data || {};
        // replicationDsapApplyMaintenancePush: public/scripts/comp/dataManagementDsapApplet.js
        if (typeof replicationDsapApplyMaintenancePush === 'function') {
            replicationDsapApplyMaintenancePush(data);
        } else if (typeof updateReplicationTrayIndicator === 'function') {
            updateReplicationTrayIndicator(data.active ? { active: true, operation: data.operation || data.reason } : null);
        }
        if (data.active) {
            const label = data.reason || 'Replication in progress — writes disabled';
            wsClient.bannerManager.showWebSocketTicker(
                'warning',
                label,
                'fa-lock',
                false
            );
            return;
        }
        wsClient.bannerManager.hideWebSocketTicker();
    }
});

registerWsInboundHandler({
    id: 'replication.progress',
    type: 'replication_progress',
    phase: 'post',
    handler(message, wsClient) {
        const data = message.data || {};
        if (!data.phase) return;
        // replicationDsapApplyProgressPush: public/scripts/comp/dataManagementDsapApplet.js
        if (typeof replicationDsapApplyProgressPush === 'function') {
            replicationDsapApplyProgressPush(data);
        } else if (typeof updateReplicationTrayIndicator === 'function') {
            updateReplicationTrayIndicator({
                active: true,
                phase: data.phase,
                current: data.current,
                total: data.total,
                path: data.path
            });
        }
        const current = typeof data.current === 'number' ? data.current : 0;
        const total = typeof data.total === 'number' ? data.total : 0;
        const pathLabel = data.path ? ` — ${data.path}` : '';
        const progressLabel = total > 0
            ? `Replication ${data.phase}: ${current}/${total}${pathLabel}`
            : `Replication ${data.phase}${pathLabel}`;
        wsClient.bannerManager.showWebSocketTicker(
            'info',
            progressLabel,
            'fa-arrows-rotate fa-spin',
            false
        );
    }
});
