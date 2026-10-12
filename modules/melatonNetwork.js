/**
 * Melaton as a domain-joined PC (Yozora #425 / #427 / #429): what the client's Windows-style
 * connection dialogs say about its link to the server ("domain controller").
 *
 *   domain          userGlobalSettings.desktop.domainName in config.json (personalisation),
 *                   default DREAMSCAPE
 *   connectionName  userGlobalSettings.desktop.connectionName, the network interface the
 *                   client connects through (Windows' connection name), default VPN Connection
 *   connectionType  'Ethernet' when the client reached us from a private address (the LAN,
 *                   through the local nginx), 'WAN' when it came over the Internet
 *   device          'L-PPoP' (LANTIS Public Point of Presence, the FireStorm load balancer)
 *
 * Served on the public OPTIONS /status (the dialogs need it before logon). The client shows
 * "Connecting to <fqdn> using '<connectionType> Miniport (L-PPoP)'...".
 */

const DEFAULT_DOMAIN = 'DREAMSCAPE';
const DEFAULT_CONNECTION_NAME = 'VPN Connection';
const DEVICE = 'L-PPoP';

function desktopSetting(config, key, fallback) {
    const value = config && config.userGlobalSettings && config.userGlobalSettings.desktop
        ? config.userGlobalSettings.desktop[key]
        : null;
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : fallback;
}

function domainName(config) {
    return desktopSetting(config, 'domainName', DEFAULT_DOMAIN);
}

function connectionName(config) {
    return desktopSetting(config, 'connectionName', DEFAULT_CONNECTION_NAME);
}

function isPrivateAddress(address) {
    let ip = String(address || '').trim().toLowerCase();
    if (!ip) return false;
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (ip === '::1' || ip === 'localhost') return true;
    if (ip.includes(':')) {
        // IPv6: unique local fc00::/7, link-local fe80::/10
        return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
    }
    const parts = ip.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = parts;
    return a === 10
        || a === 127
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 169 && b === 254)
        || (a === 100 && b >= 64 && b <= 127); // CGNAT / overlay VPNs (Tailscale): not the open Internet
}

/** address: the trusted client IP (web_server getRealIP, modules/clientAddress.js). */
function describeConnection(address, config) {
    return {
        domain: domainName(config),
        connectionName: connectionName(config),
        connectionType: isPrivateAddress(address) ? 'Ethernet' : 'WAN',
        device: DEVICE
    };
}

module.exports = {
    DEFAULT_DOMAIN,
    DEFAULT_CONNECTION_NAME,
    DEVICE,
    domainName,
    connectionName,
    isPrivateAddress,
    describeConnection
};
