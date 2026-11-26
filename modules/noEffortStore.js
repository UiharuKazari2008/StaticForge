/**
 * Engine|model pairs that refuse reasoning_effort (TokenRouter answers 400 InvalidParameter for DeepSeek),
 * learned once and kept on disk so a restart does not relearn it (#1230: 6326 "Bad request" lines).
 * One Set per process, shared by every caller of agentSupervisor.callEngine (session titles, task lists,
 * fleet memory...). File: DREAMSCAPE_NO_EFFORT_FILE or ~/.local/state/dreamscape-agents/no-effort-models.json.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const file = () => process.env.DREAMSCAPE_NO_EFFORT_FILE || path.join(os.homedir(), '.local', 'state', 'dreamscape-agents', 'no-effort-models.json');
let set = null;

function load() {
    if (set) return set;
    set = new Set();
    try {
        const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
        (Array.isArray(j) ? j : []).forEach((k) => { if (typeof k === 'string' && k) set.add(k); });
    } catch (_) { /* none learned yet */ }
    return set;
}
const has = (key) => load().has(key);
/** true when the pair is new (the caller warns once); the file is rewritten only then. */
function add(key) {
    const s = load();
    if (s.has(key)) return false;
    s.add(key);
    try {
        const f = file();
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(`${f}.tmp`, JSON.stringify([...s].sort()));
        fs.renameSync(`${f}.tmp`, f);
    } catch (_) { /* memory still holds it for this run */ }
    return true;
}
const reset = () => { set = null; };

module.exports = { has, add, reset, file };
