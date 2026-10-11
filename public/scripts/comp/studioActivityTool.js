// Studio Activity tool window (#studioActivityTool): what was loaded into the
// Studio (Change-JSON applies) and what agents did over the MCP.
// Fed by studioChangeJson.js (noteStudioActivityChange) and
// mcpActivityClient.js recordMcpActivity (noteStudioActivityMcp).

const STUDIO_ACTIVITY_MAX = 120;
const studioActivityEntries = [];
let studioActivityStudioOnly = true;
let studioActivityWired = false;

// MCP tools that read or change the Studio, or print from it.
const STUDIO_ACTIVITY_TOOLS = new Set([
    'apply_studio_changes', 'open_in_studio', 'print_studio', 'get_studio_state', 'get_session_state',
    'create_phasewalker', 'decompile_phasewalker', 'open_application', 'set_window',
    'generate_image', 'await_generation_job', 'request_workspace_switch'
]);

const STUDIO_ACTIVITY_SOURCES = {
    mcp: { label: 'MCP', icon: 'fas fa-plug' },
    rentan: { label: 'Rentan', icon: 'ri-pencil-ai-2-fill' },
    director: { label: 'Director', icon: 'fas fa-clapperboard' },
    paste: { label: 'Paste', icon: 'fas fa-paste' },
    manual: { label: 'Loaded', icon: 'fas fa-file-import' },
    agent: { label: 'Agent', icon: 'fas fa-robot' }
};

function studioActivityClip(value, limit) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const cap = limit || 140;
    return text.length > cap ? `${text.slice(0, cap)}...` : text;
}

function studioActivityOpLine(op) {
    if (!op || typeof op !== 'object') return '';
    const group = op.group || op.label || op.kind || 'Change';
    if (op.kind === 'param') {
        return `${op.label || op.paramId}: ${studioActivityClip(op.fromValue, 40)} -> ${studioActivityClip(op.toValue, 40)}`;
    }
    if (op.kind === 'chunk') {
        const verb = op.action || 'set';
        return `${group}: ${verb} "${studioActivityClip(op.text || op.name, 100)}"`;
    }
    if (op.kind === 'character') {
        return `Character ${op.action || 'set'}: ${studioActivityClip(op.name || op.prompt, 80) || `#${(op.charIndex || 0) + 1}`}`;
    }
    const detail = op.name || op.text || op.value || '';
    return `${group}${op.action ? ` (${op.action})` : ''}${detail ? `: ${studioActivityClip(detail, 80)}` : ''}`;
}

function studioActivityPush(entry) {
    studioActivityEntries.push(entry);
    while (studioActivityEntries.length > STUDIO_ACTIVITY_MAX) studioActivityEntries.shift();
    const tool = document.getElementById('studioActivityTool');
    if (tool && !tool.classList.contains('hidden')) studioActivityRender();
}

// Called after a Change-JSON apply. ops are the enabled ops that were written.
function noteStudioActivityChange(ops, options) {
    const opts = options || {};
    const list = Array.isArray(ops) ? ops : [];
    const source = STUDIO_ACTIVITY_SOURCES[opts.source] ? opts.source : 'agent';
    const lines = list.map(studioActivityOpLine).filter(Boolean);
    if (opts.extras) lines.push('Rentan / Director settings');
    studioActivityPush({
        type: 'change',
        source,
        actor: opts.actorName || '',
        title: opts.title || `${list.length} change${list.length === 1 ? '' : 's'} loaded`,
        lines,
        success: true,
        at: Date.now()
    });
}

// Called for every mcp_activity broadcast (mcpActivityClient.js).
function noteStudioActivityMcp(entry) {
    if (!entry || !entry.tool) return;
    const args = entry.args && typeof entry.args === 'object' ? entry.args : {};
    const lines = Object.keys(args).slice(0, 6).map((key) => {
        const value = args[key];
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        return `${key}: ${studioActivityClip(text, 100)}`;
    });
    if (entry.result) {
        const result = typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result);
        lines.push(`result: ${studioActivityClip(result, 140)}`);
    }
    studioActivityPush({
        type: 'mcp',
        source: 'mcp',
        actor: entry.actorName || '',
        title: entry.tool,
        tool: entry.tool,
        lines,
        success: entry.success !== false,
        at: Number(entry.at) || Date.now()
    });
}

function studioActivityVisible() {
    return studioActivityEntries.filter((entry) => (
        !studioActivityStudioOnly || entry.type === 'change' || STUDIO_ACTIVITY_TOOLS.has(entry.tool)
    ));
}

function studioActivityRender() {
    const log = document.getElementById('studioActivityLog');
    const empty = document.getElementById('studioActivityEmpty');
    if (!log) return;
    const rows = studioActivityVisible().slice().reverse();
    log.replaceChildren();
    if (empty) empty.classList.toggle('hidden', rows.length > 0);
    rows.forEach((entry) => {
        const row = document.createElement('details');
        row.className = `studio-activity-entry studio-activity-${entry.type}${entry.success ? '' : ' studio-activity-failed'}`;
        const head = document.createElement('summary');
        const source = STUDIO_ACTIVITY_SOURCES[entry.source] || STUDIO_ACTIVITY_SOURCES.agent;
        const icon = document.createElement('i');
        icon.className = source.icon;
        const badge = document.createElement('span');
        badge.className = 'studio-activity-source';
        badge.textContent = entry.actor ? `${source.label} - ${entry.actor}` : source.label;
        const title = document.createElement('span');
        title.className = 'studio-activity-title';
        title.textContent = entry.title;
        const time = document.createElement('span');
        time.className = 'studio-activity-time';
        time.textContent = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        head.append(icon, badge, title, time);
        row.appendChild(head);
        if (entry.lines.length) {
            const body = document.createElement('ul');
            body.className = 'studio-activity-lines';
            entry.lines.forEach((line) => {
                const item = document.createElement('li');
                item.textContent = line;
                body.appendChild(item);
            });
            row.appendChild(body);
        }
        log.appendChild(row);
    });
}

function wireStudioActivityTool() {
    const tool = document.getElementById('studioActivityTool');
    if (!tool || studioActivityWired) return tool;
    studioActivityWired = true;
    // transientWindowsWithPositions, addResizeHandles: public/scripts/comp/modalUtils.js
    if (typeof transientWindowsWithPositions !== 'undefined') transientWindowsWithPositions.add('studio-activity-tool');
    if (typeof addResizeHandles === 'function' && !tool.querySelector('.resize-handle')) addResizeHandles(tool);
    const closeBtn = tool.querySelector('.close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal(tool));
    const clearBtn = document.getElementById('studioActivityClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            studioActivityEntries.length = 0;
            studioActivityRender();
        });
    }
    const filter = document.getElementById('studioActivityStudioOnly');
    if (filter) {
        filter.checked = studioActivityStudioOnly;
        filter.addEventListener('change', () => {
            studioActivityStudioOnly = filter.checked;
            studioActivityRender();
        });
    }
    return tool;
}

function openStudioActivityTool() {
    const tool = wireStudioActivityTool();
    if (!tool) return;
    const manualModal = document.getElementById('manualModal');
    // linkToolWindowToParent, openModal, bringModalToFront: public/scripts/comp/modalUtils.js
    if (typeof linkToolWindowToParent === 'function' && manualModal) linkToolWindowToParent(tool, manualModal);
    studioActivityRender();
    openModal(tool);
    if (typeof bringModalToFront === 'function') bringModalToFront(tool);
    const shell = tool.querySelector('[data-custom-scrollbar]');
    // customScrollbar.forceReinit: public/scripts/comp/customScrollbar.js
    if (shell && typeof customScrollbar !== 'undefined' && customScrollbar.forceReinit) customScrollbar.forceReinit(shell);
}
