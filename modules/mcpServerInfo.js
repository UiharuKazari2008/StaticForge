/**
 * MCP initialize serverInfo for Grok connector cards.
 * name/title include a tools-catalog revision so a stale Grok cache is obvious.
 */

const crypto = require('crypto');

const MCP_SERVER_TITLE = 'DreamScape';
const MCP_SERVER_PUBLISHER = 'Academy City Research P.S.R.';
const MCP_SERVER_ICON_PATH = '/static_images/apple-touch-icon.png';

function resolveMcpPublicBaseUrl(globalResources) {
    let publicHost = 'localhost:9220';
    try {
        if (globalResources && globalResources.getConfig) {
            publicHost = globalResources.getConfig({ path: 'public_hostname' }) || publicHost;
        }
    } catch (_err) {
        publicHost = 'localhost:9220';
    }
    const host = String(publicHost).replace(/^https?:\/\//, '');
    const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
    return `${protocol}://${host}`;
}

function hashMcpToolsRevision(parts) {
    const hash = crypto.createHash('sha256');
    (parts || []).forEach((part) => {
        hash.update(typeof part === 'string' ? part : JSON.stringify(part));
        hash.update('\0');
    });
    return hash.digest('hex').slice(0, 8);
}

function buildMcpServerInfo(globalResources, revision) {
    const rev = String(revision || '0');
    const displayName = `${MCP_SERVER_TITLE} r${rev}`;
    const baseUrl = resolveMcpPublicBaseUrl(globalResources);
    return {
        name: displayName,
        title: displayName,
        version: rev,
        description: MCP_SERVER_PUBLISHER,
        websiteUrl: baseUrl,
        icons: [
            {
                src: `${baseUrl}${MCP_SERVER_ICON_PATH}`,
                mimeType: 'image/png',
                sizes: ['180x180']
            }
        ]
    };
}

module.exports = {
    MCP_SERVER_TITLE,
    MCP_SERVER_PUBLISHER,
    MCP_SERVER_ICON_PATH,
    resolveMcpPublicBaseUrl,
    hashMcpToolsRevision,
    buildMcpServerInfo
};
