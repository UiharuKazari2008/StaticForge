#!/usr/bin/env node
/**
 * Generate detailed WebSocket packet documentation from server handler source.
 * Usage: node scripts/tools/generate-ws-api-docs.js [--write]
 * Without --write, prints summary to stdout.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DOCS_WS = path.join(ROOT, 'docs/client-api/ws');
const HANDLERS_DIR = path.join(ROOT, 'modules/ws/handlers');

const OWNER_TO_DOC = {
    generation: 'generation.md',
    gallery: 'gallery.md',
    preset: 'presets.md',
    workspace: 'workspace.md',
    search: 'search.md',
    wiki: 'wiki.md',
    chat: 'chat.md',
    director: 'director.md',
    notes: 'notes.md',
    nax: 'nax.md',
    textReplacements: 'textReplacements.md',
    favorites: 'favorites.md',
    quips: 'quips.md',
    knowledge: 'knowledge.md',
    persona: 'persona.md',
    userSettings: 'userSettings.md',
    configEditor: 'configEditor.md',
    cache: 'cache.md',
    system: 'cache.md',
    infrastructure: 'infrastructure.md',
    admin: 'admin.md',
    app: 'account.md',
    references: 'references.md',
    vfs: 'vfs.md',
    applicationAuth: 'admin.md',
    novel: 'notes.md',
};

function readText(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (_e) {
        return '';
    }
}

function loadDestructiveList() {
    const content = readText(path.join(ROOT, 'modules/websocketHandlers.js'));
    const match = content.match(/const destructiveOperations = \[([\s\S]*?)\];/);
    if (!match) return new Set();
    const items = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    return new Set(items);
}

function loadCriticalList() {
    const content = readText(path.join(ROOT, 'modules/websocket.js'));
    const match = content.match(/CRITICAL_MESSAGE_TYPES = \[([\s\S]*?)\];/);
    if (!match) return new Set();
    return new Set([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

function inferOwnerFromFile(content, filename) {
    const ownerMatch = /owner:\s*['"]([^'"]+)['"]/.exec(content);
    if (ownerMatch) return ownerMatch[1];
    const base = path.basename(filename, '.js').replace(/^\d+-/, '').replace(/Handler$/, '');
    return base;
}

function scanRegistrations() {
    const entries = [];
    const files = [];

    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (name.endsWith('.js')) files.push(full);
        }
    }

    walk(HANDLERS_DIR);
    files.push(
        path.join(ROOT, 'modules/referencesWebSocketHandlers.js'),
        path.join(ROOT, 'modules/vfsWebSocketHandlers.js')
    );

    for (const file of files) {
        const content = readText(file);
        if (!content) continue;
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        const defaultOwner = inferOwnerFromFile(content, file);

        const patterns = [
            /\bregFn\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g,
            /\bregCache\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g,
            /\bregSystem\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g,
            /\breg\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]?(\w+)['"]?/g,
            /\breg\s*\(\s*['"]([^'"]+)['"]\s*,\s*\(ctx\)/g,
        ];

        for (const re of patterns) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(content)) !== null) {
                const type = m[1];
                const handlerFn = m[2] || '(inline)';
                const line = content.slice(0, m.index).split('\n').length;
                const lineContent = content.split('\n')[line - 1] || '';
                const destructive = /DESTRUCTIVE|destructive:\s*true/.test(lineContent);
                let owner = defaultOwner;
                const ownerInLine = /owner:\s*['"]([^'"]+)['"]/.exec(lineContent);
                if (ownerInLine) owner = ownerInLine[1];
                if (!entries.some((e) => e.type === type && e.file === rel)) {
                    entries.push({ type, handlerFn, file: rel, line, owner, destructive });
                }
            }
        }

        const directRe = /registerWsPacket\s*\(\s*['"]([^'"]+)['"][\s\S]{0,200}?\{[^}]*owner:\s*['"]([^'"]+)['"]/g;
        let dm;
        while ((dm = directRe.exec(content)) !== null) {
            const type = dm[1];
            const owner = dm[2];
            if (!entries.some((e) => e.type === type && e.file === rel)) {
                entries.push({
                    type,
                    handlerFn: null,
                    file: rel,
                    line: content.slice(0, dm.index).split('\n').length,
                    owner,
                    destructive: false,
                });
            }
        }
    }

    // REFERENCES_PACKETS array
    const refsContent = readText(path.join(ROOT, 'modules/referencesWebSocketHandlers.js'));
    const refsMatch = refsContent.match(/const REFERENCES_PACKETS = \[([\s\S]*?)\];/);
    if (refsMatch) {
        const pairRe = /\['([^']+)',\s*'([^']+)'(?:,\s*REFERENCES_DESTRUCTIVE)?\]/g;
        let rm;
        while ((rm = pairRe.exec(refsMatch[1])) !== null) {
            const type = rm[1];
            const handlerFn = rm[2];
            const destructive = refsMatch[1].slice(rm.index, rm.index + rm[0].length).includes('DESTRUCTIVE');
            if (!entries.some((e) => e.type === type)) {
                entries.push({
                    type,
                    handlerFn,
                    file: 'modules/referencesWebSocketHandlers.js',
                    line: 0,
                    owner: 'references',
                    destructive,
                });
            }
        }
    }

    // Grimoire novel packets
    const grimoire = readText(path.join(ROOT, 'modules/grimoireDomainRegistry.js'));
    const novelBlock = grimoire.match(/packets:\s*\{([\s\S]*?novel_resolve_image[\s\S]*?)\}/);
    if (novelBlock) {
        const pairRe = /(\w+):\s*'(\w+)'/g;
        let nm;
        while ((nm = pairRe.exec(novelBlock[1])) !== null) {
            const type = nm[1];
            if (!type.startsWith('novel_')) continue;
            if (!entries.some((e) => e.type === type)) {
                entries.push({
                    type,
                    handlerFn: nm[2],
                    file: 'modules/websocketHandlers.js',
                    line: 0,
                    owner: 'novel',
                    destructive: ['novel_update', 'novel_generate', 'novel_undo'].includes(type),
                });
            }
        }
    }

    return entries.sort((a, b) => a.type.localeCompare(b.type));
}

function findHandlerBody(content, handlerName) {
    if (!handlerName || handlerName === '(inline)') return null;

    const patterns = [
        new RegExp(`(?:async\\s+)?function\\s+${handlerName}\\s*\\([^)]*\\)\\s*\\{`, 'g'),
        new RegExp(`async\\s+${handlerName}\\s*\\([^)]*\\)\\s*\\{`, 'g'),
    ];

    for (const re of patterns) {
        re.lastIndex = 0;
        const m = re.exec(content);
        if (!m) continue;
        const start = m.index + m[0].length - 1;
        let depth = 0;
        for (let i = start; i < content.length; i++) {
            if (content[i] === '{') depth++;
            else if (content[i] === '}') {
                depth--;
                if (depth === 0) return content.slice(start + 1, i);
            }
        }
    }
    return null;
}

function extractRequestFields(body) {
    const fields = new Set(['requestId']);
    if (!body) return [...fields];

    const destructureRe = /const\s*\{([^}]+)\}\s*=\s*message/g;
    let m;
    while ((m = destructureRe.exec(body)) !== null) {
        for (const part of m[1].split(',')) {
            const name = part.trim().split(':')[0].split('=')[0].trim();
            if (name && name !== '...') fields.add(name);
        }
    }

    const directRe = /message\.(\w+)/g;
    while ((m = directRe.exec(body)) !== null) {
        if (!['requestId', 'type', 'timestamp', 'data'].includes(m[1])) fields.add(m[1]);
    }

    return [...fields].filter((f) => f !== 'type');
}

function extractRequiredFields(body) {
    const required = [];
    if (!body) return required;
    const re = /sendError\([^,]+,\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(body)) !== null) {
        const msg = m[1].toLowerCase();
        if (msg.includes(' is required') || msg.includes(' are required')) {
            required.push(m[1]);
        }
    }
    return required;
}

function extractResponseTypes(body) {
    if (!body) return [];
    const types = new Set();
    const re = /type:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(body)) !== null) {
        types.add(m[1]);
    }
    return [...types];
}

function extractBroadcasts(body) {
    if (!body) return [];
    const types = [];
    const re = /(?:broadcast|wsServer\.broadcast)\(\{[\s\S]*?type:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(body)) !== null) {
        types.push(m[1]);
    }
    return [...new Set(types)];
}

function authLabel(type, destructive, critical) {
    if (critical.has(type)) return 'Critical (no session required)';
    if (destructive.has(type)) return 'Session required. Admin only (destructive — blocked for readonly)';
    return 'Session required';
}

function analyzePacket(entry, destructive, critical) {
    let content = readText(path.join(ROOT, entry.file));
    let body = findHandlerBody(content, entry.handlerFn);

    if (!body && entry.file.includes('generationHandler')) {
        content = readText(path.join(ROOT, 'modules/ws/handlers/generationImpl.js'));
        body = findHandlerBody(content, entry.handlerFn);
    }
    if (!body && entry.file.includes('workspaceHandler')) {
        body = findHandlerBody(content, entry.handlerFn);
    }
    if (!body && entry.file === 'modules/websocketHandlers.js') {
        body = findHandlerBody(content, entry.handlerFn);
    }

    const requestFields = extractRequestFields(body);
    const requiredMsgs = extractRequiredFields(body);
    const responseTypes = extractResponseTypes(body);
    const broadcasts = extractBroadcasts(body);

    const successResponse =
        responseTypes.find((t) => t.endsWith('_response')) ||
        responseTypes.find((t) => t.includes('response')) ||
        `${entry.type}_response`;

    return {
        ...entry,
        requestFields,
        requiredMsgs,
        responseTypes,
        successResponse,
        broadcasts,
        auth: authLabel(entry.type, destructive, critical),
        handlerRef: entry.handlerFn !== '(inline)'
            ? `${entry.file} → \`${entry.handlerFn}\``
            : entry.file,
    };
}

function packetSection(p) {
    const lines = [`### \`${p.type}\``, ''];
    lines.push(`**Auth:** ${p.auth}`);
    lines.push('');
    lines.push(`**Handler:** ${p.handlerRef}`);
    lines.push('');

    if (p.requestFields.length) {
        lines.push('**Request fields:**');
        lines.push('');
        lines.push('| Field | Notes |');
        lines.push('|-------|-------|');
        for (const f of p.requestFields) {
            const reqHint = p.requiredMsgs.some((m) => m.toLowerCase().includes(f.replace(/_/g, ' ')))
                ? 'Required'
                : 'Optional';
            lines.push(`| \`${f}\` | ${reqHint} |`);
        }
        lines.push('');
    }

    if (p.requiredMsgs.length) {
        lines.push('**Validation errors:**');
        for (const msg of p.requiredMsgs) {
            lines.push(`- ${msg}`);
        }
        lines.push('');
    }

    lines.push(`**Success response:** \`${p.successResponse}\``);
    if (p.responseTypes.length > 1) {
        lines.push('');
        lines.push('Additional response/push types from handler:');
        for (const t of p.responseTypes) {
            if (t !== p.successResponse) lines.push(`- \`${t}\``);
        }
    }
    lines.push('');

    if (p.broadcasts.length) {
        lines.push('**Push side effects:**');
        for (const b of p.broadcasts) {
            lines.push(`- \`${b}\``);
        }
        lines.push('');
    }

    lines.push('**Errors:** `type: "error"` via `sendError()` — see [websocket.md](../websocket.md#errors). Readonly users receive `READONLY_RESTRICTED` for destructive packets.');
    lines.push('');
    return lines.join('\n');
}

function buildDetailedSections(packetsByDoc) {
    const out = {};
    for (const [docFile, packets] of Object.entries(packetsByDoc)) {
        const sections = ['---', '', '## Detailed packets', ''];
        for (const p of packets.sort((a, b) => a.type.localeCompare(b.type))) {
            sections.push(packetSection(p));
        }
        out[docFile] = sections.join('\n');
    }
    return out;
}

function updatePacketIndex(existing, packets) {
    const lines = existing.split('\n');
    const start = lines.findIndex((l) => l.startsWith('## Packet index'));
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## ') && !l.includes('Packet index'));
    if (start === -1) return existing;

    const header = lines.slice(0, start + 1);
    const footer = end === -1 ? [] : lines.slice(end);

    const table = ['', '| Request type | Typical response | Auth | Notes |', '|---|---|---|---|'];
    for (const p of packets.sort((a, b) => a.type.localeCompare(b.type))) {
        const authShort = p.auth.includes('Critical') ? 'critical' : p.auth.includes('destructive') ? 'admin/destructive' : 'session';
        table.push(`| \`${p.type}\` | \`${p.successResponse}\` | ${authShort} | Handler: ${p.handlerFn} |`);
    }
    table.push('');

    return [...header, ...table, ...footer].join('\n');
}

function mergeDocFile(docPath, detailedBlock, packets) {
    let existing = readText(docPath);
    if (!existing) return null;

    const detailedMarker = '## Detailed packets';
    const idx = existing.indexOf(detailedMarker);
    if (idx !== -1) {
        existing = existing.slice(0, idx).trimEnd();
    }

    existing = updatePacketIndex(existing, packets);
    return `${existing.trimEnd()}\n\n${detailedBlock}\n`;
}

function main() {
    const write = process.argv.includes('--write');
    const destructive = loadDestructiveList();
    const critical = loadCriticalList();
    const registrations = scanRegistrations();

    const analyzed = registrations.map((e) => {
        const isDest = destructive.has(e.type) || e.destructive;
        return analyzePacket({ ...e, destructive: isDest }, destructive, critical);
    });

    const packetsByDoc = {};
    for (const p of analyzed) {
        const doc = OWNER_TO_DOC[p.owner] || `${p.owner}.md`;
        if (!packetsByDoc[doc]) packetsByDoc[doc] = [];
        packetsByDoc[doc].push(p);
    }

    const detailedSections = buildDetailedSections(packetsByDoc);

    console.log(`Scanned ${analyzed.length} packet types across ${Object.keys(packetsByDoc).length} doc files`);
    console.log(`Destructive: ${destructive.size}, Critical: ${critical.size}`);

    if (!write) {
        console.log('\nDoc file counts:');
        for (const [doc, packets] of Object.entries(packetsByDoc).sort()) {
            console.log(`  ${doc}: ${packets.length}`);
        }
        console.log('\nRun with --write to update docs/client-api/ws/*.md');
        return;
    }

    let updated = 0;
    for (const [docFile, detailed] of Object.entries(detailedSections)) {
        const docPath = path.join(DOCS_WS, docFile);
        const merged = mergeDocFile(docPath, detailed, packetsByDoc[docFile]);
        if (merged) {
            fs.writeFileSync(docPath, merged);
            updated++;
        }
    }

    console.log(`Updated ${updated} domain doc files`);
}

main();
