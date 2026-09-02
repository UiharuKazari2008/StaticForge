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

const ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS = [
    'You are Enshutsuka for Dreamscape Studio via the DreamScape MCP connector.',
    'Modes (user says these on grok.com): analyse / analyze my prompt — get_studio_state + get_generated_image, compare prompt to pixels, apply_studio_changes. create — invent from text; no image required. efficiency — same as analyse but tighten tokens / missing tags / stale vs result.',
    'If get_studio_state or get_generated_image includes dynamicGeneration / dynamic_generation or director / director_session_id / a director prompt, you MUST integrate and act on that data. Enable or change dynamic generation with apply_studio_changes dynamicGeneration (enabled, directive, tod, weather, season, location, cacheLocked, contextLocked) or generate_image dynamic_generation. Do not ignore an attached director prompt.',
    'LinkXi persona (account): get_linkxi_persona / save_linkxi_persona (user_name, backstory, default_verbosity 1–5). Use it when the user talks as themselves.',
    'On every Studio edit: get_studio_state first. Compare to the last state you saw this chat. Keep their intervening edits; apply only this message\'s delta.',
    'Delivery priority: apply_studio_changes is the default (autoApply true; autoGenerate if they asked to generate now). Else generate_image. Else emit Change-JSON. Do not dump Positive/UC when Studio MCP works.',
    'Memories: search_memories on every real Studio or prompt job before you invent a technique. Frequently save_memory for proven techniques, and upsert related memories in the same turn. Do not treat a memory as fact unless confidence is high (needsRefinement below 60%; prefer ≥80%). Low confidence is a hypothesis — verify with wiki / NAX / prompt guide / the image, then save_memory on the same name to refine (omit unchanged fields; +0–25% confidence; write evidence in observations). New memories start at 10%. Set model (v4_5 / v5 / …); existing rows are v4_5.'
].join(' ');

function buildMcpConnectorGrimPage(globalResources) {
    const baseUrl = resolveMcpPublicBaseUrl(globalResources);
    let mcpPathUuid = '';
    try {
        mcpPathUuid = globalResources && typeof globalResources.getMcpPathUuid === 'function'
            ? String(globalResources.getMcpPathUuid() || '')
            : '';
    } catch (_err) {
        mcpPathUuid = '';
    }
    const connectorUrl = mcpPathUuid ? `${baseUrl}/${mcpPathUuid}` : '';
    const mcpUrl = connectorUrl ? `${connectorUrl}/mcp` : '';
    const oauthAuthorize = mcpPathUuid ? `${baseUrl}/${mcpPathUuid}/oauth/authorize` : '';
    const oauthToken = mcpPathUuid ? `${baseUrl}/${mcpPathUuid}/oauth/token` : '';
    return {
        title: 'MCP Connector',
        type: 'mcp-connector',
        data: {
            connectorUrl,
            mcpUrl,
            oauthAuthorize,
            oauthToken,
            scopes: 'generation gallery workspace chat',
            recommendedScopes: 'generation gallery workspace autofill wiki presets references search notes chat',
            projectInstructions: ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS
        }
    };
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
    ENSHUTSUKA_GROK_PROJECT_INSTRUCTIONS,
    resolveMcpPublicBaseUrl,
    hashMcpToolsRevision,
    buildMcpServerInfo,
    buildMcpConnectorGrimPage
};
