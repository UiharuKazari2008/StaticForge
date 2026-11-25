// Studio Activity tool window (#studioActivityTool): what was loaded into the Studio (Change-JSON
// applies) and what agents did over the MCP, laid out as Vista's Event Viewer shows a log: a grey
// band with the log name and event count, the events in a list (Level, Date and Time, Source, User,
// Action), and the preview pane under it with General / Details tabs (css/studio-activity-tool.css).
// Fed by studioChangeJson.js (noteStudioActivityChange) and mcpActivityClient.js
// recordMcpActivity (noteStudioActivityMcp). The log lives in this tab only (the server keeps no
// history of Studio changes, and its MCP ring is 2 minutes long).

const STUDIO_ACTIVITY_MAX = 200;
const studioActivityEntries = [];
let studioActivitySeq = 0;
let studioActivityStudioOnly = true;
let studioActivityWired = false;
let studioActivitySelectedId = 0;
let studioActivityTab = 'general';

// MCP tools that read or change the Studio, or print from it. open_application / set_window count
// only when they name the Studio (studioActivityTouchesStudio).
const STUDIO_ACTIVITY_TOOLS = new Set([
    'apply_studio_changes', 'open_in_studio', 'print_studio', 'get_studio_state', 'get_session_state',
    'create_phasewalker', 'decompile_phasewalker', 'generate_image', 'generate_preset',
    'apply_preset_to_studio', 'save_preset', 'await_generation_job', 'get_generation_job',
    'request_workspace_switch', 'count_prompt_tokens'
]);
const STUDIO_ACTIVITY_WINDOW_TOOLS = new Set(['open_application', 'set_window']);

const STUDIO_ACTIVITY_SOURCES = {
    mcp: 'MCP',
    rentan: 'Rentan',
    director: 'Director',
    paste: 'Paste',
    manual: 'Change JSON',
    agent: 'Agent'
};

const STUDIO_ACTIVITY_LEVELS = {
    info: { label: 'Information', icon: '/static_images/vista-icons/info-16.png' },
    warning: { label: 'Warning', icon: '/static_images/vista-icons/warning-16.png' },
    error: { label: 'Error', icon: '/static_images/vista-icons/error-16.png' }
};

function studioActivityClip(value, limit) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const cap = limit || 140;
    return text.length > cap ? `${text.slice(0, cap)}...` : text;
}

function studioActivityStamp(at) {
    try {
        return new Date(at).toLocaleString([], {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: '2-digit', second: '2-digit'
        });
    } catch (_err) {
        return '';
    }
}

function studioActivityDuration(ms) {
    if (!(ms >= 0)) return '';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

// One line per op, as the Apply Studio Change dialog words it (describeStudioChangeOp in
// studioChangeJson.js); unchanged params are left out by the caller.
function studioActivityOpLine(op) {
    if (!op || typeof op !== 'object') return '';
    // describeStudioChangeOp: public/scripts/comp/studioChangeJson.js
    if (typeof describeStudioChangeOp === 'function') {
        const { title, detail, verb } = describeStudioChangeOp(op);
        const head = verb && op.kind !== 'param' ? `${verb} ${title}` : title;
        return detail ? `${head}: ${studioActivityClip(detail, 160)}` : head;
    }
    return studioActivityClip(op.label || op.name || op.text || op.kind || 'Change', 160);
}

// A compact copy of an op for the Details tab (no DOM, no huge strings).
function studioActivityOpData(op) {
    const out = {};
    Object.keys(op || {}).forEach((key) => {
        if (key === 'enabled' || key === 'key') return;
        const value = op[key];
        if (typeof value === 'function' || value === undefined) return;
        out[key] = typeof value === 'string' && value.length > 400 ? `${value.slice(0, 400)}...` : value;
    });
    return out;
}

function studioActivityTouchesStudio(entry) {
    if (entry.type === 'change') return true;
    const tool = entry.tool || '';
    if (STUDIO_ACTIVITY_TOOLS.has(tool)) return true;
    const args = entry.args || {};
    if (tool === 'advanced_tools') {
        return STUDIO_ACTIVITY_TOOLS.has(String(args.name || args.tool || ''));
    }
    if (STUDIO_ACTIVITY_WINDOW_TOOLS.has(tool)) {
        return /studio|manualModal/i.test(JSON.stringify(args));
    }
    return false;
}

function studioActivityToolOpen() {
    const tool = document.getElementById('studioActivityTool');
    return !!(tool && !tool.classList.contains('hidden'));
}

function studioActivityPush(entry) {
    entry.id = ++studioActivitySeq;
    studioActivityEntries.push(entry);
    let dropped = false;
    while (studioActivityEntries.length > STUDIO_ACTIVITY_MAX) {
        studioActivityEntries.shift();
        dropped = true;
    }
    if (!studioActivityToolOpen()) return;
    if (dropped || !studioActivityVisibleEntry(entry)) {
        studioActivityRender();
        return;
    }
    studioActivityInsertRow(entry);
}

// Called after a Change-JSON apply. ops are the enabled ops that were written; options.unapplied
// lists the payload paths the Studio could not take (characters past the slots, ...).
function noteStudioActivityChange(ops, options) {
    const opts = options || {};
    const list = (Array.isArray(ops) ? ops : []).filter((op) => op && op.enabled !== false);
    const changed = list.filter((op) => !(op.kind === 'param' && op.unchanged));
    const source = STUDIO_ACTIVITY_SOURCES[opts.source] ? opts.source : 'agent';
    const lines = changed.map(studioActivityOpLine).filter(Boolean);
    if (opts.extras) lines.push('Rentan / Director settings');
    const unapplied = Array.isArray(opts.unapplied) ? opts.unapplied.filter(Boolean) : [];
    const count = changed.length;
    studioActivityPush({
        type: 'change',
        source,
        actor: opts.actorName || '',
        action: opts.title || `${count} change${count === 1 ? '' : 's'} loaded`,
        lines,
        unapplied,
        level: unapplied.length ? 'warning' : 'info',
        data: { source, title: opts.title || '', ops: list.map(studioActivityOpData), unapplied },
        at: Date.now()
    });
}

function studioActivityMcpSucceeded(entry) {
    if (entry.success === false) return false;
    return !(entry.result && typeof entry.result === 'object' && entry.result.success === false);
}

// The result field of an MCP row: the error, the saved file(s), a job id, a count, or OK.
function studioActivityMcpResult(result, running) {
    if (running) return 'Running';
    if (!result || typeof result !== 'object') return '';
    if (result.error) return `Error: ${studioActivityClip(result.error, 160)}`;
    const files = Array.isArray(result.filenames) && result.filenames.length
        ? result.filenames
        : (result.filename ? [result.filename] : []);
    if (files.length) return files.length === 1 ? files[0] : `${files[0]} (+${files.length - 1} more)`;
    const preview = result.preview && typeof result.preview === 'object' ? result.preview : {};
    if (preview.jobId) return `Job ${preview.jobId}`;
    if (result.count != null) return `${result.count} item${result.count === 1 ? '' : 's'}`;
    if (preview.warning) return studioActivityClip(preview.warning, 160);
    return result.success === false ? 'Failed' : 'OK';
}

function studioActivityMcpLines(args) {
    return Object.keys(args).map((key) => {
        const value = args[key];
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        return `${key}: ${studioActivityClip(text, 200)}`;
    });
}

// Called for every mcp_activity broadcast (mcpActivityClient.js). A generating tool is broadcast
// twice (started, then finished): the finish updates the started row instead of adding another.
function noteStudioActivityMcp(entry) {
    if (!entry || !entry.tool) return;
    const args = entry.args && typeof entry.args === 'object' ? entry.args : {};
    const at = Number(entry.at) || Date.now();
    const actor = entry.actorName || '';
    const ok = studioActivityMcpSucceeded(entry);
    if (entry.generating === false) {
        for (let i = studioActivityEntries.length - 1; i >= 0; i--) {
            const row = studioActivityEntries[i];
            if (row.type !== 'mcp' || !row.running || row.tool !== entry.tool || row.actor !== actor) continue;
            row.running = false;
            row.level = ok ? 'info' : 'error';
            row.result = studioActivityMcpResult(entry.result, false);
            row.durationMs = at - row.at;
            row.data = { ...row.data, result: entry.result || null, success: ok, finishedAt: at };
            studioActivityRefreshRow(row);
            return;
        }
    }
    const running = entry.generating === true;
    studioActivityPush({
        type: 'mcp',
        source: 'mcp',
        actor,
        tool: entry.tool,
        action: entry.tool,
        args,
        lines: studioActivityMcpLines(args),
        running,
        result: studioActivityMcpResult(running ? null : entry.result, running),
        level: running || ok ? 'info' : 'error',
        data: { tool: entry.tool, actorName: actor || null, args, result: running ? null : (entry.result || null), success: ok },
        at
    });
}

function studioActivityVisibleEntry(entry) {
    return !studioActivityStudioOnly || studioActivityTouchesStudio(entry);
}

function studioActivityVisible() {
    return studioActivityEntries.filter(studioActivityVisibleEntry);
}

function studioActivityFind(id) {
    return studioActivityEntries.find((entry) => entry.id === id) || null;
}

// ---- list ----------------------------------------------------------------------------------

function studioActivityCell(className, text) {
    const cell = document.createElement('span');
    cell.className = `studio-activity-cell ${className}`;
    cell.textContent = text;
    return cell;
}

function studioActivityBuildRow(entry) {
    const row = document.createElement('div');
    row.className = 'studio-activity-row';
    row.setAttribute('role', 'row');
    row.dataset.entryId = String(entry.id);
    studioActivityFillRow(row, entry);
    return row;
}

function studioActivityFillRow(row, entry) {
    const level = STUDIO_ACTIVITY_LEVELS[entry.level] || STUDIO_ACTIVITY_LEVELS.info;
    const levelCell = studioActivityCell('studio-activity-col-level', level.label);
    const icon = document.createElement('img');
    icon.src = level.icon;
    icon.alt = '';
    icon.width = 16;
    icon.height = 16;
    levelCell.prepend(icon);
    const action = entry.running ? `${entry.action} (running)` : entry.action;
    row.replaceChildren(
        levelCell,
        studioActivityCell('studio-activity-col-time', studioActivityStamp(entry.at)),
        studioActivityCell('studio-activity-col-source', STUDIO_ACTIVITY_SOURCES[entry.source] || 'Agent'),
        studioActivityCell('studio-activity-col-user', entry.actor || 'N/A'),
        studioActivityCell('studio-activity-col-action', action)
    );
    row.title = entry.action;
    const selected = entry.id === studioActivitySelectedId;
    row.classList.toggle('is-selected', selected);
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
}

function studioActivityUpdateBand(shown) {
    const count = document.getElementById('studioActivityCount');
    if (!count) return;
    const total = studioActivityEntries.length;
    const word = (n) => `${n.toLocaleString()} Event${n === 1 ? '' : 's'}`;
    count.textContent = shown === total ? word(total) : `Showing ${shown.toLocaleString()} of ${word(total)}`;
}

function studioActivityRender() {
    const log = document.getElementById('studioActivityLog');
    const empty = document.getElementById('studioActivityEmpty');
    if (!log) return;
    const rows = studioActivityVisible().reverse();
    if (!rows.some((entry) => entry.id === studioActivitySelectedId)) {
        studioActivitySelectedId = rows.length ? rows[0].id : 0;
    }
    const frag = document.createDocumentFragment();
    rows.forEach((entry) => frag.appendChild(studioActivityBuildRow(entry)));
    log.replaceChildren(frag);
    if (empty) empty.classList.toggle('hidden', rows.length > 0);
    studioActivityUpdateBand(rows.length);
    studioActivityRenderPreview();
}

// A new event goes on top without rebuilding the list; the selection stays where it was unless
// the newest event was selected (Event Viewer keeps the selected event too).
function studioActivityInsertRow(entry) {
    const log = document.getElementById('studioActivityLog');
    if (!log) return;
    const followNewest = !studioActivitySelectedId || log.firstElementChild?.classList.contains('is-selected');
    if (followNewest) {
        const prev = log.querySelector('.studio-activity-row.is-selected');
        if (prev) {
            prev.classList.remove('is-selected');
            prev.setAttribute('aria-selected', 'false');
        }
        studioActivitySelectedId = entry.id;
    }
    log.prepend(studioActivityBuildRow(entry));
    const empty = document.getElementById('studioActivityEmpty');
    if (empty) empty.classList.add('hidden');
    studioActivityUpdateBand(log.childElementCount);
    if (followNewest) studioActivityRenderPreview();
}

function studioActivityRefreshRow(entry) {
    if (!studioActivityToolOpen()) return;
    const row = document.querySelector(`#studioActivityLog > [data-entry-id="${entry.id}"]`);
    if (row) studioActivityFillRow(row, entry);
    if (entry.id === studioActivitySelectedId) studioActivityRenderPreview();
}

function studioActivitySelect(id, options) {
    const log = document.getElementById('studioActivityLog');
    if (!log || !id || id === studioActivitySelectedId) return;
    const prev = log.querySelector('.studio-activity-row.is-selected');
    if (prev) {
        prev.classList.remove('is-selected');
        prev.setAttribute('aria-selected', 'false');
    }
    const row = log.querySelector(`[data-entry-id="${id}"]`);
    studioActivitySelectedId = id;
    if (row) {
        row.classList.add('is-selected');
        row.setAttribute('aria-selected', 'true');
        if (options && options.scroll) row.scrollIntoView({ block: 'nearest' });
    }
    studioActivityRenderPreview();
}

function studioActivityStep(delta) {
    const log = document.getElementById('studioActivityLog');
    if (!log || !log.childElementCount) return;
    const rows = Array.from(log.children);
    const at = rows.findIndex((row) => row.classList.contains('is-selected'));
    let next;
    if (delta === -Infinity) next = 0;
    else if (delta === Infinity) next = rows.length - 1;
    else next = Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + delta));
    studioActivitySelect(Number(rows[next].dataset.entryId), { scroll: true });
}

// ---- preview pane --------------------------------------------------------------------------

function studioActivityFields(entry) {
    const level = STUDIO_ACTIVITY_LEVELS[entry.level] || STUDIO_ACTIVITY_LEVELS.info;
    const fields = [
        ['Source:', STUDIO_ACTIVITY_SOURCES[entry.source] || 'Agent'],
        ['Logged:', studioActivityStamp(entry.at)],
        ['Level:', level.label],
        ['User:', entry.actor || 'N/A']
    ];
    if (entry.type === 'mcp') {
        fields.push(['Tool:', entry.tool]);
        fields.push(['Result:', entry.result || (entry.running ? 'Running' : 'OK')]);
        if (entry.durationMs != null) fields.push(['Duration:', studioActivityDuration(entry.durationMs)]);
    } else {
        fields.push(['Changes:', String(entry.lines.length)]);
        if (entry.unapplied.length) fields.push(['Not applied:', entry.unapplied.join(', ')]);
    }
    return fields;
}

function studioActivityDescription(entry) {
    const who = entry.actor ? `"${entry.actor}"` : 'An agent';
    if (entry.type === 'mcp') {
        let head = `${who} called ${entry.tool}.`;
        if (entry.running) head = `${who} called ${entry.tool}. The generation is still running.`;
        else if (entry.level === 'error') head = `${who} called ${entry.tool}. The call failed: ${entry.result.replace(/^Error: /, '')}`;
        return [head, ...entry.lines];
    }
    const source = STUDIO_ACTIVITY_SOURCES[entry.source] || 'Agent';
    const by = entry.actor ? ` by "${entry.actor}"` : '';
    const head = `${source}${by} loaded ${entry.lines.length || 'no'} change${entry.lines.length === 1 ? '' : 's'} into the Studio${entry.action && !/ loaded$/.test(entry.action) ? ` (${entry.action})` : ''}.`;
    const tail = entry.unapplied.length ? [`The Studio could not take: ${entry.unapplied.join(', ')}`] : [];
    return [head, ...entry.lines, ...tail];
}

function studioActivityDetailsText(entry) {
    const data = { logged: new Date(entry.at).toISOString(), ...entry.data };
    if (entry.durationMs != null) data.durationMs = entry.durationMs;
    try {
        return JSON.stringify(data, null, 2);
    } catch (_err) {
        return String(entry.action || '');
    }
}

// Copy Details as Text (Event Viewer's Copy): the description, the fields, then the raw data.
function studioActivityCopyText(entry) {
    const fields = studioActivityFields(entry).map(([label, value]) => `${label} ${value}`);
    return [...studioActivityDescription(entry), '', ...fields, '', studioActivityDetailsText(entry)].join('\n');
}

function studioActivityRenderPreview() {
    const pane = document.getElementById('studioActivityPreview');
    if (!pane) return;
    const entry = studioActivityFind(studioActivitySelectedId);
    const title = document.getElementById('studioActivityPreviewTitle');
    const desc = document.getElementById('studioActivityDesc');
    const grid = document.getElementById('studioActivityFields');
    const details = document.getElementById('studioActivityDetails');
    pane.classList.toggle('is-empty', !entry);
    if (!entry) {
        if (title) title.textContent = '';
        if (desc) desc.textContent = '';
        if (grid) grid.replaceChildren();
        if (details) details.textContent = '';
        return;
    }
    if (title) title.textContent = `${entry.action}, ${STUDIO_ACTIVITY_SOURCES[entry.source] || 'Agent'}`;
    if (desc) desc.textContent = studioActivityDescription(entry).join('\n');
    if (grid) {
        const frag = document.createDocumentFragment();
        studioActivityFields(entry).forEach(([label, value]) => {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = value;
            dd.title = value;
            frag.append(dt, dd);
        });
        grid.replaceChildren(frag);
    }
    // the raw data is only built while its tab is showing
    if (details) details.textContent = studioActivityTab === 'details' ? studioActivityDetailsText(entry) : '';
}

function studioActivitySetTab(name) {
    const tool = document.getElementById('studioActivityTool');
    if (!tool) return;
    studioActivityTab = name === 'details' ? 'details' : 'general';
    tool.querySelectorAll('.studio-activity-tabs > [role="tab"]').forEach((tab) => {
        const on = tab.dataset.tab === studioActivityTab;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
    });
    tool.querySelectorAll('.studio-activity-page').forEach((page) => {
        page.classList.toggle('hidden', page.dataset.tab !== studioActivityTab);
    });
    studioActivityRenderPreview();
}

// The splitter between the list and the preview pane: the pane keeps its height while the
// window is resized, as Event Viewer's does.
function studioActivityWireSplitter(tool) {
    const splitter = tool.querySelector('.studio-activity-splitter');
    const pane = document.getElementById('studioActivityPreview');
    if (!splitter || !pane) return;
    splitter.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startY = event.clientY;
        const startH = pane.offsetHeight;
        const content = tool.querySelector('.studio-activity-content');
        const maxH = Math.max(120, (content ? content.clientHeight : 400) - 120);
        splitter.setPointerCapture(event.pointerId);
        const move = (e) => {
            const next = Math.max(110, Math.min(maxH, startH - (e.clientY - startY)));
            tool.style.setProperty('--studio-activity-preview-height', `${Math.round(next)}px`);
        };
        const up = () => {
            splitter.removeEventListener('pointermove', move);
            splitter.removeEventListener('pointerup', up);
            splitter.removeEventListener('pointercancel', up);
        };
        splitter.addEventListener('pointermove', move);
        splitter.addEventListener('pointerup', up);
        splitter.addEventListener('pointercancel', up);
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
            studioActivitySelectedId = 0;
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
    const list = tool.querySelector('.studio-activity-list');
    const log = document.getElementById('studioActivityLog');
    if (log) {
        log.addEventListener('mousedown', (event) => {
            const row = event.target.closest('.studio-activity-row');
            if (row) studioActivitySelect(Number(row.dataset.entryId));
        });
    }
    if (list) {
        list.addEventListener('keydown', (event) => {
            const steps = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10, Home: -Infinity, End: Infinity };
            if (event.key in steps) {
                event.preventDefault();
                studioActivityStep(steps[event.key]);
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
                const entry = studioActivityFind(studioActivitySelectedId);
                if (!entry || !navigator.clipboard) return;
                event.preventDefault();
                navigator.clipboard.writeText(studioActivityCopyText(entry)).catch(() => {});
            }
        });
    }
    tool.querySelectorAll('.studio-activity-tabs > [role="tab"]').forEach((tab) => {
        tab.addEventListener('click', () => studioActivitySetTab(tab.dataset.tab));
    });
    studioActivityWireSplitter(tool);
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
}
