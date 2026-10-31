// Wren's learned rules and the Auto-Repair proposals waiting on the user (#687).
// One JSON file beside index.json: { rules: [...], proposals: [...] }. A proposal
// changes nothing until it is approved; an approved rule joins wrenRules() as
// section 9, an approved guide change is written into the prompt guide clone
// (the existing guide commit/push flow ships it).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX_RULES = 60;
const MAX_PROPOSALS = 200;
const RULE_TEXT_MAX = 600;
const GUIDE_TEXT_MAX = 20000;
const WHY_MAX = 400;
const GUIDE_EXTENSIONS = ['.md', '.yaml', '.yml', '.txt', '.json'];
const GUIDE_OPS = ['create', 'replace', 'append'];
const RULE_OPS = ['add', 'edit', 'remove'];

let fileOverride = null;

function storePath() {
    return fileOverride || path.join(os.homedir(), '.cache', 'dreamscape-director', 'learned-rules.json');
}

function setStorePath(file) {
    fileOverride = file || null;
}

function clip(value, max) {
    return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function oneLine(value, max) {
    return clip(value, max).replace(/\s+/g, ' ');
}

function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function readStore() {
    let raw = null;
    try {
        raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    } catch (_) {
        raw = null;
    }
    const rules = Array.isArray(raw && raw.rules) ? raw.rules : [];
    const proposals = Array.isArray(raw && raw.proposals) ? raw.proposals : [];
    return {
        rules: rules.filter((row) => row && row.id && row.text),
        proposals: proposals.filter((row) => row && row.id && (row.kind === 'rule' || row.kind === 'guide'))
    };
}

function writeStore(store) {
    const file = storePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Decided proposals go first when the list is full; pending ones stay.
    let proposals = store.proposals.slice();
    while (proposals.length > MAX_PROPOSALS) {
        const at = proposals.findIndex((row) => row.status !== 'pending');
        if (at < 0) break;
        proposals.splice(at, 1);
    }
    proposals = proposals.slice(-MAX_PROPOSALS);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ rules: store.rules.slice(-MAX_RULES), proposals }, null, 2));
    fs.renameSync(tmp, file);
}

function approvedRules() {
    return readStore().rules;
}

// wrenRules() section 9. Empty when there is nothing approved.
function rulesSection() {
    const rules = approvedRules();
    if (!rules.length) return '';
    return ['## 9. Learned rules', ...rules.map((row) => `- ${oneLine(row.text, RULE_TEXT_MAX)}`)].join('\n');
}

function payloadError(message) {
    const error = new Error(message);
    error.code = 'BAD_REPAIR_PAYLOAD';
    return error;
}

// A guide path relative to the clone root: no absolute, no .., no .git, text files only.
function cleanGuidePath(value) {
    const raw = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^knowledge\/prompt-guide\//, '');
    if (!raw || raw.startsWith('/') || raw.length > 200) return '';
    const parts = raw.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return '';
    if (!GUIDE_EXTENSIONS.includes(path.extname(raw).toLowerCase())) return '';
    return parts.join('/');
}

function normalizeRuleProposal(row, knownIds) {
    const op = String((row && row.op) || 'add').trim().toLowerCase();
    if (!RULE_OPS.includes(op)) throw payloadError(`ruleProposals op must be add, edit, or remove (got "${op}").`);
    const targetId = String((row && (row.id || row.targetId)) || '').trim();
    if (op !== 'add') {
        if (!targetId) throw payloadError(`ruleProposals ${op} needs the id of an existing learned rule.`);
        if (knownIds && !knownIds.has(targetId)) throw payloadError(`ruleProposals ${op}: no learned rule has id "${targetId}".`);
    }
    const text = clip(row && row.text, RULE_TEXT_MAX);
    if (op !== 'remove' && text.length < 12) throw payloadError('ruleProposals text is the rule itself: one short general sentence.');
    return { op, targetId: op === 'add' ? null : targetId, text, why: oneLine(row && row.why, WHY_MAX) };
}

function normalizeGuideProposal(row) {
    const op = String((row && row.op) || 'append').trim().toLowerCase();
    if (!GUIDE_OPS.includes(op)) throw payloadError(`guideProposals op must be create, replace, or append (got "${op}").`);
    const file = cleanGuidePath(row && row.path);
    if (!file) throw payloadError(`guideProposals path "${String((row && row.path) || '')}" is not a prompt guide text file (relative path, ${GUIDE_EXTENSIONS.join(' ')}).`);
    const text = String((row && row.text) || '').replace(/\r\n/g, '\n').slice(0, GUIDE_TEXT_MAX);
    if (!text.trim()) throw payloadError('guideProposals text is required.');
    return { op, path: file, text, why: oneLine(row && row.why, WHY_MAX) };
}

// Saves the delivered proposals as pending. Returns { ruleIds, guideIds }.
function addProposals(chatId, input) {
    const store = readStore();
    const at = new Date().toISOString();
    const ruleIds = [];
    const guideIds = [];
    (Array.isArray(input && input.ruleProposals) ? input.ruleProposals : []).forEach((row) => {
        const id = newId('lrp');
        store.proposals.push({ id, kind: 'rule', op: row.op, targetId: row.targetId || null, text: row.text, why: row.why || '', chatId: chatId || null, createdAt: at, status: 'pending' });
        ruleIds.push(id);
    });
    (Array.isArray(input && input.guideProposals) ? input.guideProposals : []).forEach((row) => {
        const id = newId('lgp');
        store.proposals.push({ id, kind: 'guide', op: row.op, path: row.path, text: row.text, why: row.why || '', chatId: chatId || null, createdAt: at, status: 'pending' });
        guideIds.push(id);
    });
    if (ruleIds.length || guideIds.length) writeStore(store);
    return { ruleIds, guideIds };
}

function notFound(message) {
    const error = new Error(message);
    error.code = 'NOT_FOUND';
    return error;
}

function applyGuideChange(root, proposal) {
    const rel = cleanGuidePath(proposal.path);
    if (!root || !rel) throw payloadError('That guide path is not valid');
    const base = path.resolve(root);
    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep)) throw payloadError('That guide path is outside the prompt guide');
    const exists = fs.existsSync(file);
    if (proposal.op === 'create' && exists) throw payloadError(`${rel} already exists; approve it as replace or append instead`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // A symlink in the clone must not carry the write outside it.
    const realBase = fs.realpathSync(base);
    const realDir = fs.realpathSync(path.dirname(file));
    if (realDir !== realBase && !realDir.startsWith(realBase + path.sep)) throw payloadError('That guide path is outside the prompt guide');
    if (exists && fs.lstatSync(file).isSymbolicLink()) throw payloadError('That guide file is a link');
    const text = proposal.text.endsWith('\n') ? proposal.text : `${proposal.text}\n`;
    if (proposal.op === 'append' && exists) {
        const prior = fs.readFileSync(file, 'utf8');
        fs.writeFileSync(file, `${prior}${prior.endsWith('\n') || !prior ? '' : '\n'}\n${text}`);
    } else {
        fs.writeFileSync(file, text);
    }
    return rel;
}

// decision approve|reject; text replaces the proposed text (the user edited it).
// options.guideRoot is the prompt guide work clone.
function decideProposal(id, decision, text, options) {
    const store = readStore();
    const proposal = store.proposals.find((row) => row.id === id);
    if (!proposal) throw notFound('Proposal not found');
    if (proposal.status !== 'pending') throw payloadError(`That proposal is already ${proposal.status}`);
    const verdict = String(decision || '').toLowerCase();
    if (verdict !== 'approve' && verdict !== 'reject') throw payloadError('decision must be approve or reject');
    const at = new Date().toISOString();
    if (verdict === 'approve') {
        const edited = text != null && String(text).trim() ? String(text) : null;
        if (proposal.kind === 'rule') {
            const ruleText = clip(edited != null ? edited : proposal.text, RULE_TEXT_MAX);
            if (proposal.op === 'add') {
                if (!ruleText) throw payloadError('The rule text is empty');
                store.rules.push({ id: newId('lr'), text: ruleText, createdAt: at, source: { chatId: proposal.chatId || null, proposalId: proposal.id } });
            } else {
                const rule = store.rules.find((row) => row.id === proposal.targetId);
                if (!rule) throw notFound('The learned rule this proposal changes is gone');
                if (proposal.op === 'edit') {
                    if (!ruleText) throw payloadError('The rule text is empty');
                    rule.text = ruleText;
                    rule.updatedAt = at;
                } else {
                    store.rules = store.rules.filter((row) => row.id !== proposal.targetId);
                }
            }
            if (edited != null) proposal.text = ruleText;
        } else {
            if (edited != null) proposal.text = edited.replace(/\r\n/g, '\n').slice(0, GUIDE_TEXT_MAX);
            proposal.appliedPath = applyGuideChange(options && options.guideRoot, proposal);
        }
    }
    proposal.status = verdict === 'approve' ? 'approved' : 'rejected';
    proposal.decidedAt = at;
    writeStore(store);
    return { proposal, rules: store.rules };
}

function editRule(id, text) {
    const store = readStore();
    const rule = store.rules.find((row) => row.id === id);
    if (!rule) throw notFound('Learned rule not found');
    const next = clip(text, RULE_TEXT_MAX);
    if (!next) throw payloadError('The rule text is empty');
    rule.text = next;
    rule.updatedAt = new Date().toISOString();
    writeStore(store);
    return rule;
}

function removeRule(id) {
    const store = readStore();
    const before = store.rules.length;
    store.rules = store.rules.filter((row) => row.id !== id);
    if (store.rules.length === before) throw notFound('Learned rule not found');
    writeStore(store);
    return { removed: id };
}

module.exports = {
    storePath,
    readStore,
    approvedRules,
    rulesSection,
    addProposals,
    decideProposal,
    editRule,
    removeRule,
    normalizeRuleProposal,
    normalizeGuideProposal,
    cleanGuidePath,
    applyGuideChange,
    RULE_TEXT_MAX,
    GUIDE_TEXT_MAX,
    _test: { setStorePath }
};
