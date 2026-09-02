/**
 * MCP connector setup DSAP — grok.com Custom Connector URLs + Enshutsuka project paste-block.
 * Domain: mcp.dreamscape.jp
 * Depends on: dsapRegistry.js, dsapSmfMarkup.js
 * Server getPage: modules/mcpServerInfo.js buildMcpConnectorGrimPage (live UUID, not hardcoded here)
 */

const MCP_CONNECTOR_DSAP_URL = 'mcp.dreamscape.jp';
const MCP_CONNECTOR_DSAP_ID = 'mcp-connector';

const MCP_CONNECTOR_FALLBACK_INSTRUCTIONS = [
    'You are Enshutsuka for Dreamscape Studio via the DreamScape MCP connector.',
    'Modes (user says these on grok.com): analyse / analyze my prompt — get_studio_state + get_generated_image, compare prompt to pixels, apply_studio_changes. create — invent from text; no image required. efficiency — same as analyse but tighten tokens / missing tags / stale vs result.',
    'If get_studio_state or get_generated_image includes dynamicGeneration / dynamic_generation or director / director_session_id / a director prompt, you MUST integrate and act on that data. Enable or change dynamic generation with apply_studio_changes dynamicGeneration (enabled, directive, tod, weather, season, location, cacheLocked, contextLocked) or generate_image dynamic_generation. Do not ignore an attached director prompt.',
    'LinkXi persona (account): get_linkxi_persona / save_linkxi_persona (user_name, backstory, default_verbosity 1–5). Use it when the user talks as themselves.',
    'On every Studio edit: get_studio_state first. Compare to the last state you saw this chat. Keep their intervening edits; apply only this message\'s delta.',
    'Delivery priority: apply_studio_changes is the default (autoApply true; autoGenerate if they asked to generate now). Else generate_image. Else emit Change-JSON. Do not dump Positive/UC when Studio MCP works.'
].join(' ');

const mcpConnectorDsapCss = `
[data-dsap="mcp-connector"] .mcp-copy-row { margin: 0 0 10px; }
[data-dsap="mcp-connector"] .mcp-copy-row textarea.dsap-smf-input {
    width: 100%;
    min-height: 2.4em;
    font-family: Consolas, "Courier New", monospace;
    resize: vertical;
}
[data-dsap="mcp-connector"] .mcp-copy-row textarea.mcp-copy-tall { min-height: 10em; }
[data-dsap="mcp-connector"] .mcp-copy-actions { margin: 4px 0 0; }
[data-dsap="mcp-connector"] .mcp-copy-label { display: block; margin: 0 0 3px; font-weight: bold; }
`;

function mcpConnectorCopyBlock(id, label, rows) {
    const tall = rows && rows > 3 ? ' mcp-copy-tall' : '';
    return `<div class="mcp-copy-row">
  <span class="mcp-copy-label">${dsapSmfEscapeHtml(label)}</span>
  <textarea class="dsap-smf-input${tall}" id="${dsapSmfEscapeAttr(id)}" readonly rows="${rows || 2}"></textarea>
  <div class="mcp-copy-actions">
    <button type="button" class="dsap-smf-btn dsap-smf-btn-small" data-mcp-copy="${dsapSmfEscapeAttr(id)}">Copy</button>
  </div>
</div>`;
}

function mcpConnectorPageHtml() {
    return `${dsapSmfBuildRootOpen(MCP_CONNECTOR_DSAP_ID)}
${dsapSmfBuildHeader({ branchTitle: DSAP_SMF_BRANCH_MCP, toolTitle: 'Setup' })}
${dsapSmfBuildSectionHdr('Grok Custom Connector')}
${dsapSmfBuildStatusBox('New Connector → Custom. Paste the live URLs from this host. The path UUID is unlisted; do not put it in client JS.')}
${mcpConnectorCopyBlock('mcpConnectorUrl', 'Connector URL', 2)}
${mcpConnectorCopyBlock('mcpConnectorMcpUrl', 'MCP path (optional /mcp)', 2)}
${mcpConnectorCopyBlock('mcpConnectorAuthorize', 'Authorization endpoint', 2)}
${mcpConnectorCopyBlock('mcpConnectorToken', 'Token endpoint', 2)}
${mcpConnectorCopyBlock('mcpConnectorScopes', 'Scopes (Enshutsuka minimum)', 2)}
${dsapSmfBuildSectionHdr('Project instructions')}
${dsapSmfBuildStatusBox('Paste into the grok.com project. Modes are analyse / create / efficiency. Dynamic generation and an attached director prompt are must-act.')}
${mcpConnectorCopyBlock('mcpConnectorInstructions', 'Enshutsuka project paste-block', 8)}
${dsapSmfBuildSectionHdr('LinkXi')}
<p>Persona is MCP <code>get_linkxi_persona</code> / <code>save_linkxi_persona</code>. The in-app editor stays at <a href="dsap://xi.dyna.dreamscape.jp/persona" class="dsap-smf-home-link" data-dsap-smf-home-link="dsap://xi.dyna.dreamscape.jp/persona">xi.dyna.dreamscape.jp/persona</a>.</p>
${dsapSmfBuildRootClose()}`;
}

const mcpConnectorDsapDriver = {
    init(host) {
        this._state = { host };
        const root = host.getRoot();
        root.querySelectorAll('[data-dsap-smf-home-link]').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = link.getAttribute('data-dsap-smf-home-link') || link.getAttribute('href');
                if (target) host.navigate(target);
            });
        });
        root.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mcp-copy]');
            if (!btn) return;
            const fieldId = btn.getAttribute('data-mcp-copy');
            const field = root.querySelector(`#${fieldId}`);
            const text = field ? field.value : '';
            this._copy(text, host);
        });
        this._fill(null);
        this._load();
    },

    destroy() {
        this._state = null;
    },

    refresh() {
        this._load();
    },

    _fill(data) {
        const root = this._state && this._state.host && this._state.host.getRoot();
        if (!root) return;
        const page = data || {};
        const setVal = (id, value) => {
            const el = root.querySelector(`#${id}`);
            if (el) el.value = value || '';
        };
        setVal('mcpConnectorUrl', page.connectorUrl);
        setVal('mcpConnectorMcpUrl', page.mcpUrl);
        setVal('mcpConnectorAuthorize', page.oauthAuthorize);
        setVal('mcpConnectorToken', page.oauthToken);
        setVal('mcpConnectorScopes', page.scopes || 'generation gallery workspace chat');
        setVal('mcpConnectorInstructions', page.projectInstructions || MCP_CONNECTOR_FALLBACK_INSTRUCTIONS);
    },

    async _load() {
        const host = this._state && this._state.host;
        try {
            // sendMessage: public/scripts/websocket.js
            const result = await wsClient.sendMessage('resolve_grimoire_url', {
                url: `dsap://${MCP_CONNECTOR_DSAP_URL}/`
            }, false);
            const page = result && result.page && result.page.data ? result.page.data : null;
            this._fill(page);
        } catch (err) {
            this._fill(null);
            if (host && host.showToast) {
                host.showToast('Could not load live connector URLs', 'error');
            }
        }
    },

    async _copy(text, host) {
        if (!text) return;
        try {
            // writeClipboard: public/scripts/utils/dreamscapeClipboard.js
            await writeClipboard({ text });
            if (host && host.showToast) host.showToast('Copied', 'success');
        } catch (_err) {
            if (host && host.showToast) host.showToast('Copy failed', 'error');
        }
    }
};

function registerMcpConnectorDsapApplet() {
    if (typeof registerDsap !== 'function') return;
    registerDsap({
        url: MCP_CONNECTOR_DSAP_URL,
        getContent() {
            return {
                html: mcpConnectorPageHtml(),
                css: mcpConnectorDsapCss,
                drivers: mcpConnectorDsapDriver,
                theme: 'dsap-smf'
            };
        }
    });
}

registerMcpConnectorDsapApplet();
