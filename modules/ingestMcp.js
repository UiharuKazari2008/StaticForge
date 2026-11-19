/**
 * Ingest Controller MCP tools (scope sfapp_messaging_bridge, merged into modules/messagingBridgeMcp.js:
 * the same two gates - the key names the scope, the key is Tsubame or Yukimi - and the same audit).
 *
 *   ingest_list_accounts   every mail / text / Exchange account with its mode and pipeline
 *   ingest_set_mode        bypass | process (starts dry-run); applying on needs confirm:true
 *   ingest_list_modules    the module catalog; with an account: its pipeline, settings, spamd probe
 *   ingest_configure_module  enable / settings / order of one module (accountId "*": every account of the source)
 *   ingest_dry_run         run a stored or supplied message through the pipeline, nothing applied
 *   ingest_log             what the pipeline decided lately (no bodies, no codes)
 *
 * Switching to process, enabling applying, and enabling a module that deletes or forwards need confirm:true.
 */
'use strict';

const str = { type: 'string' };
const bool = { type: 'boolean' };
const num = { type: 'number' };
const SOURCE = { type: 'string', enum: ['email', 'sms', 'exchange'], description: 'email = IMAP bridge accounts (iCloud ...), sms = text accounts, exchange = DS Exchange mailboxes' };

function tool(name, description, properties, required, scope, role) {
    return {
        name,
        core: true,
        role,
        scope,
        description: `Ingest Controller (Tsubame, Yukimi's mail and texts). ${description}`,
        inputSchema: { type: 'object', additionalProperties: false, required: required || [], properties: properties || {} }
    };
}

function buildTools(scope, role) {
    const t = (n, d, p, r) => tool(n, d, p, r, scope, role);
    return [
        t('ingest_list_accounts', 'List every account the controller covers (bridge mail, text accounts, Exchange mailboxes): source, accountId, mode (bypass|process), applying, dryRun, ordered modules.', { source: SOURCE }),
        t('ingest_set_mode', 'Set an account\'s mode. bypass = as today. process = its pipeline runs on new messages, starting in DRY-RUN (intended actions only logged). applying:true makes the actions real. process and applying need confirm:true. accountId "*" = every account of that source.', {
            source: SOURCE, accountId: str, mode: { type: 'string', enum: ['bypass', 'process'] }, applying: bool, confirm: bool
        }, ['source', 'accountId', 'mode']),
        t('ingest_list_modules', 'Module catalog (spamFilter, codeExtraction, routing) with defaults; give source + accountId for that account\'s pipeline and settings. probe:true pings spamd.', { source: SOURCE, accountId: str, probe: bool }),
        t('ingest_configure_module', 'Enable / disable, configure or reorder one module for an account. settings merge into the current ones (reset:true starts from defaults). spamFilter: { host, port, threshold, action: junk|trash, allowFrom[], spamNumbers[], textThreshold, textAction: silence|delete }. codeExtraction: { links, markRead }. routing: { groups: { name: [patterns] }, includeLegacyRules, rules: [{ name, enabled, stop, match: { all|any|none: [{ field: from|to|subject|body|header|any, op: contains|equals|startsWith|endsWith|regex|in|exists, value, group, header, not }] }, actions: { moveTo, delete, markRead, flag, forwardTo, handTo, notify, silence } }] }. Enabling a module that deletes / forwards (delete, forwardTo, action trash), or any module on an account that is applying, needs confirm:true. accountId "*" = every account of the source.', {
            source: SOURCE, accountId: str, module: { type: 'string', enum: ['spamFilter', 'codeExtraction', 'routing'] }, enabled: bool, settings: { type: 'object' }, position: num, reset: bool, confirm: bool
        }, ['source', 'accountId', 'module']),
        t('ingest_dry_run', 'Run one message through the account\'s pipeline and show every module\'s decision and the actions that would be applied. Nothing is applied. Give ref (email { folder, uid }, exchange { id }, sms { chatGuid, guid }) for a stored message, or message { from, fromName, to, cc, subject, text, headers, known, isGroup } to try one (keep real verification codes out of supplied text). allModules:true also runs disabled modules; scoreSpam:false skips spamd.', {
            source: SOURCE, accountId: str, ref: { type: 'object' }, message: { type: 'object' }, allModules: bool, scoreSpam: bool
        }, ['source', 'accountId']),
        t('ingest_log', 'Recent pipeline decisions (intended when dry-run, applied when live): sender, subject (codes redacted), actions.', { source: SOURCE, accountId: str, limit: num })
    ];
}

const NAMES = new Set(['ingest_list_accounts', 'ingest_set_mode', 'ingest_list_modules', 'ingest_configure_module', 'ingest_dry_run', 'ingest_log']);
function isIngestTool(name) { return NAMES.has(name); }

let controller = null;
function ctl() { return controller || require('./ingestController'); }

async function dispatch(name, input, actor) {
    const c = ctl();
    switch (name) {
        case 'ingest_list_accounts': return c.listAccounts({ source: input.source || null });
        case 'ingest_set_mode': return c.setMode({ source: input.source, accountId: input.accountId, mode: input.mode, applying: input.applying, confirm: input.confirm, actor });
        case 'ingest_list_modules': return c.listModules({ source: input.source || null, accountId: input.accountId, probe: input.probe === true });
        case 'ingest_configure_module': return c.configureModule(Object.assign({}, input, { actor }));
        case 'ingest_dry_run': return c.dryRun(input);
        case 'ingest_log': return c.recentLog(input);
        default: throw Object.assign(new Error('Unknown ingest tool'), { code: 'UNKNOWN_TOOL' });
    }
}

module.exports = { buildTools, isIngestTool, dispatch, NAMES, _test: { setController: (x) => { controller = x || null; } } };
