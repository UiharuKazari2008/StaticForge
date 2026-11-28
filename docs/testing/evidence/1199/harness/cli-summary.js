// prints the dreamscape mcp_servers entry of the init event and each tool_use with the first 300 chars of its result
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
const init = lines.find((e) => e.type === 'system' && e.subtype === 'init');
if (!init) console.log('no init event');
else {
    const s = (init.mcp_servers || []).find((x) => x.name === 'dreamscape');
    console.log('mcp_servers dreamscape:', JSON.stringify(s || null));
    console.log('claude_code_version:', init.claude_code_version || '?', ' model:', init.model || '?');
}
const uses = new Map();
for (const e of lines) {
    const c = e.message && Array.isArray(e.message.content) ? e.message.content : [];
    for (const p of c) {
        if (p.type === 'tool_use') uses.set(p.id, { name: p.name, result: null });
        if (p.type === 'tool_result' && uses.has(p.tool_use_id)) {
            const t = Array.isArray(p.content) ? p.content.map((x) => x.text || '').join('') : String(p.content);
            uses.get(p.tool_use_id).result = t;
        }
    }
}
if (!uses.size) console.log('no tool_use');
for (const u of uses.values()) console.log('tool_use', u.name, '->', u.result === null ? '(no result)' : u.result.slice(0, 300).replace(/\n/g, ' '));
const res = lines.find((e) => e.type === 'result');
if (res) console.log('result:', res.subtype, 'is_error', res.is_error, String(res.result || '').slice(0, 200).replace(/\n/g, ' '));
