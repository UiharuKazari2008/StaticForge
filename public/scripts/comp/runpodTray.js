// Managed RunPod GPU Pods for the desktop tray: pod snapshot, start/stop, Periscope logs.
// The wallet tray icon (public/scripts/comp/walletTray.js, Yozora #430) shows the pods in its
// RunPod row and puts buildRunpodTrayMenuItems in its right-click menu; there is no RunPod icon.
// featureLoader: public/scripts/comp/featureLoader.js
// logViewerApplet: public/scripts/comp/logViewerApplet.js

let runpodTraySnapshot = {
    pods: [],
    loggedInUsers: 0,
    fetchedAt: 0,
    configured: false,
    hasApiKey: false
};
let runpodTrayWired = false;
let runpodTrayBusy = false;

function applyRunpodTraySnapshot(data) {
    if (!data) return;
    runpodTraySnapshot = {
        pods: Array.isArray(data.pods) ? data.pods : [],
        loggedInUsers: Number(data.loggedInUsers) || 0,
        fetchedAt: data.fetchedAt || Date.now(),
        configured: data.configured === true,
        hasApiKey: data.hasApiKey !== false
    };
    updateRunpodTrayChrome();
}

function getRunpodTraySnapshot() {
    return runpodTraySnapshot;
}

function updateRunpodTrayChrome() {
    // walletTray.update: public/scripts/comp/walletTray.js
    if (window.walletTray) window.walletTray.update();
}

function formatRunpodUsd(n) {
    if (n == null || !Number.isFinite(n)) return null;
    if (n > 0 && n < 0.01) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(2)}`;
}

function runpodSessionCost(pod) {
    const rate = Number(pod && pod.costPerHr);
    if (!Number.isFinite(rate) || rate < 0) return null;
    if (pod.status !== 'running' && pod.status !== 'starting') return null;
    const started = Date.parse(pod.lastStartedAt);
    if (Number.isFinite(started)) {
        return rate * Math.max(0, (Date.now() - started) / 3600000);
    }
    const cached = Number(pod.sessionCost);
    return Number.isFinite(cached) ? cached : null;
}

function formatRunpodPodCost(pod) {
    const rate = Number(pod && pod.costPerHr);
    if (!Number.isFinite(rate)) return '';
    const hr = `${formatRunpodUsd(rate)}/hr`;
    const session = runpodSessionCost(pod);
    if (session != null) return `${hr} · ${formatRunpodUsd(session)} this run`;
    return hr;
}

function buildRunpodTrayMenuItems() {
    const items = [];
    const pods = runpodTraySnapshot.pods || [];
    if (!pods.length) {
        items.push({
            icon: 'fas fa-server',
            text: 'No managed pods',
            disabled: true,
            tooltip: 'Add runpod.managedPods in secure config'
        });
    } else {
        for (const pod of pods) {
            const running = pod.status === 'running' || pod.status === 'starting';
            const busy = pod.status === 'starting' || pod.status === 'stopping';
            const costLabel = formatRunpodPodCost(pod);
            const tipParts = [pod.gpuName, costLabel, pod.id, pod.error].filter(Boolean);
            items.push({
                icon: running ? 'fas fa-stop' : 'fas fa-play',
                text: busy
                    ? `${pod.name} (${pod.status})`
                    : running
                        ? `Stop ${pod.name}`
                        : `Start ${pod.name}`,
                subtext: costLabel || undefined,
                action: running ? 'runpod-pod-stop' : 'runpod-pod-start',
                podId: pod.id,
                disabled: busy || runpodTrayBusy,
                tooltip: tipParts.join(' · ')
            });
        }
    }
    items.push({ separator: true });
    items.push({
        icon: 'fas fa-wave-square',
        text: 'Open Periscope logs',
        action: 'runpod-open-logs',
        tooltip: 'RunPod source in Event Viewer'
    });
    items.push({
        icon: 'fas fa-sync',
        text: 'Refresh status',
        action: 'runpod-refresh',
        disabled: runpodTrayBusy
    });
    return items;
}

async function refreshRunpodTrayStatus() {
    if (!wsClient || !wsClient.isConnected()) return;
    try {
        const data = await wsClient.sendMessage('runpod_pods_status', {}, false);
        applyRunpodTraySnapshot(data);
    } catch (error) {
        console.error('RunPod tray status failed:', error);
    }
}

async function startRunpodPodFromTray(podId) {
    if (!podId || !wsClient || !wsClient.isConnected()) return;
    runpodTrayBusy = true;
    updateRunpodTrayChrome();
    try {
        const data = await wsClient.sendMessage('runpod_pod_start', { podId });
        applyRunpodTraySnapshot(data);
        showGlassToast('success', null, 'RunPod start requested', false, 3000, '<i class="fas fa-play"></i>');
    } catch (error) {
        showGlassToast('error', null, error.message || 'Failed to start RunPod', false, 5000, '<i class="fas fa-exclamation-circle"></i>');
        await refreshRunpodTrayStatus();
    } finally {
        runpodTrayBusy = false;
        updateRunpodTrayChrome();
    }
}

async function stopRunpodPodFromTray(podId) {
    if (!podId || !wsClient || !wsClient.isConnected()) return;
    runpodTrayBusy = true;
    updateRunpodTrayChrome();
    try {
        const data = await wsClient.sendMessage('runpod_pod_stop', { podId });
        applyRunpodTraySnapshot(data);
        showGlassToast('info', null, 'RunPod stop requested', false, 3000, '<i class="fas fa-stop"></i>');
    } catch (error) {
        showGlassToast('error', null, error.message || 'Failed to stop RunPod', false, 5000, '<i class="fas fa-exclamation-circle"></i>');
        await refreshRunpodTrayStatus();
    } finally {
        runpodTrayBusy = false;
        updateRunpodTrayChrome();
    }
}

async function openRunpodLogsInPeriscope() {
    await featureLoader.loadFeature('log_viewer');
    await logViewerApplet.open({ source: 'runpod' });
}

function handleRunpodTrayAction(action, item) {
    if (action === 'runpod-pod-start') {
        startRunpodPodFromTray(item && item.podId);
        return;
    }
    if (action === 'runpod-pod-stop') {
        stopRunpodPodFromTray(item && item.podId);
        return;
    }
    if (action === 'runpod-open-logs') {
        openRunpodLogsInPeriscope();
        return;
    }
    if (action === 'runpod-refresh') {
        refreshRunpodTrayStatus();
    }
}

function initializeRunpodTray() {
    if (runpodTrayWired || !isDesktop) return;
    runpodTrayWired = true;
    refreshRunpodTrayStatus();
    wsClient.registerRefreshCallback('runpod-tray', 80, refreshRunpodTrayStatus);
}

window.getRunpodTraySnapshot = getRunpodTraySnapshot;
window.buildRunpodTrayMenuItems = buildRunpodTrayMenuItems;
window.handleRunpodTrayAction = handleRunpodTrayAction;
