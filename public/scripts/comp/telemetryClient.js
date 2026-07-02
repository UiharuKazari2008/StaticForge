// Client telemetry capture — shared by login page and /app load.

function checkTelemetryStorageSupport(type) {
    try {
        const storage = window[type];
        const testKey = '__storage_test__';
        storage.setItem(testKey, 'test');
        storage.removeItem(testKey);
        return true;
    } catch (e) {
        return false;
    }
}

function checkTelemetryWebGLSupport() {
    try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch (e) {
        return false;
    }
}

function checkTelemetryWebPSupport() {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) {
        return false;
    }
}

function collectClientTelemetryData(options = {}) {
    const telemetry = {
        timestamp: Date.now(),
        eventType: options.eventType || 'login',
        page: options.page || null,
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
        screen: {
            width: screen.width || window.innerWidth,
            height: screen.height || window.innerHeight,
            colorDepth: screen.colorDepth,
            pixelDepth: screen.pixelDepth
        },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        connection: null,
        serviceWorker: {
            supported: 'serviceWorker' in navigator,
            registered: false,
            scope: null
        },
        storage: {
            localStorage: checkTelemetryStorageSupport('localStorage'),
            sessionStorage: checkTelemetryStorageSupport('sessionStorage'),
            indexedDB: 'indexedDB' in window
        },
        features: {
            webGL: checkTelemetryWebGLSupport(),
            webp: checkTelemetryWebPSupport(),
            touch: 'ontouchstart' in window,
            geolocation: 'geolocation' in navigator
        }
    };

    if ('connection' in navigator) {
        const conn = navigator.connection;
        telemetry.connection = {
            effectiveType: conn.effectiveType,
            downlink: conn.downlink,
            rtt: conn.rtt,
            saveData: conn.saveData
        };
    }

    if (telemetry.serviceWorker.supported) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
            if (registrations.length > 0) {
                telemetry.serviceWorker.registered = true;
                telemetry.serviceWorker.scope = registrations[0].scope;
            }
        }).catch(() => {
            // Service worker check failed
        });
    }

    return telemetry;
}

async function sendClientTelemetryPing(options = {}) {
    const telemetryData = collectClientTelemetryData(options);

    const response = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'ping',
            data: telemetryData
        })
    });

    if (!response.ok) return null;
    return response.json();
}

function sendAppTelemetryPing() {
    sendClientTelemetryPing({ eventType: 'app', page: '/app' }).catch((error) => {
        console.error('❌ Error sending app telemetry ping:', error);
    });
}
