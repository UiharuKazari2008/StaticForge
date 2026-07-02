/**
 * StaticForge Flow Map — shared paths and scan targets.
 * Entry: node scripts/tools/flow-map.js
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const PATHS = {
    root: ROOT,
    serverHandlers: path.join(ROOT, 'modules/ws/handlers'),
    serverWsRegistry: path.join(ROOT, 'modules/ws/wsPacketRegistry.js'),
    clientWsHandlers: path.join(ROOT, 'public/scripts/ws/handlers'),
    clientWsRegistry: path.join(ROOT, 'public/scripts/ws/wsInboundRegistry.js'),
    clientScripts: path.join(ROOT, 'public/scripts'),
    websocketClient: path.join(ROOT, 'public/scripts/websocket.js'),
    grimoireDomainRegistry: path.join(ROOT, 'modules/grimoireDomainRegistry.js'),
    defaultOutputDir: path.join(ROOT, 'docs/flow-maps')
};

/** Directories scanned for outbound sendMessage / triggerEvent usage. */
const CLIENT_SEND_SCAN_DIRS = [
    path.join(ROOT, 'public/scripts'),
    path.join(ROOT, 'public/scripts/comp'),
    path.join(ROOT, 'public/scripts/ws/handlers')
];

/** Known pipeline aliases — extend as needed. */
const PIPELINE_ALIASES = {
    generate_image: {
        label: 'Image Generation',
        requestType: 'generate_image',
        responseTypes: [
            'image_generation_progress',
            'image_generation_response',
            'image_generation_error'
        ],
        relatedRequestTypes: ['cancel_generation']
    },
    novel_generate: {
        label: 'Novel Generate',
        requestType: 'novel_generate',
        responseTypes: ['novel_generate_response', 'novel_generate_complete'],
        relatedRequestTypes: ['novel_get', 'novel_update']
    },
    get_blocked_ips: {
        label: 'Security Center — Blocked IPs',
        requestType: 'get_blocked_ips',
        responseTypes: ['get_blocked_ips_response'],
        relatedRequestTypes: ['get_known_bad_paths', 'list_pins']
    }
};

module.exports = {
    PATHS,
    CLIENT_SEND_SCAN_DIRS,
    PIPELINE_ALIASES
};
