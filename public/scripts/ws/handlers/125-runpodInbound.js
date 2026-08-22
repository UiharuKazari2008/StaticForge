// Managed RunPod GPU pod status pushes.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js
// applyRunpodTraySnapshot: public/scripts/comp/runpodTray.js

registerWsInboundHandler({
    id: 'runpod.status_update',
    type: 'runpod_pods_status_update',
    phase: 'only',
    handler(message) {
        applyRunpodTraySnapshot(message.data);
    }
});
