'use strict';

/**
 * Per-account Fleet settings and whether an account is free to take work (#1154, Yukimi Nov 24 2026:
 * "in accounts I should be able to rename an account or change other settings as well as add 'Preferred
 * account' and 'max weekly usage' and 'max session usage'"; "show banners on accounts that are approaching
 * their limits or are now no longer free to schedule work").
 *
 *   settings   config fleet.accounts.<account id> = { preferred, maxWeeklyPct, maxSessionPct, defaultModel,
 *              defaultEffort, defaultMode } (account id = claudeAccountHost's: sha256 of its token, 16 hex);
 *              the name is the CardSpace key's own name (apiKeyManager.updateApiKey). One account is preferred.
 *   availability(usageRow, settings)   from the account's plan usage (claudeUsage rows) and its caps:
 *              exhausted  a limit at 100% (or the API says so)       not schedulable
 *              capped     a limit at or past the account's own max   not schedulable
 *              near       a limit at 80%+, or within 10 points of its max
 *              free / unknown (no usage read yet: schedulable, said so)
 *
 * Yozora's dispatch (claudeFleetMcp) and Fleet's New Session "Auto" pick from schedulable accounts only:
 * the preferred one first while it is free, then the most headroom.
 */

const MODES = new Set(['bypassPermissions', 'acceptEdits', 'auto', 'default', 'plan']);
const EFFORTS = new Set(['', 'low', 'medium', 'high', 'xhigh', 'max']);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;
const NEAR_PCT = 80;
const NEAR_CAP = 10;

const DEFAULTS = { preferred: false, maxWeeklyPct: null, maxSessionPct: null, defaultModel: 'sonnet', defaultEffort: '', defaultMode: 'bypassPermissions' };

function all(gr) {
    try { return (gr && gr.getConfig && gr.getConfig().fleet && gr.getConfig().fleet.accounts) || {}; } catch (_) { return {}; }
}

function get(gr, id) {
    const v = all(gr)[id] || {};
    return {
        preferred: v.preferred === true,
        maxWeeklyPct: Number.isFinite(v.maxWeeklyPct) ? v.maxWeeklyPct : null,
        maxSessionPct: Number.isFinite(v.maxSessionPct) ? v.maxSessionPct : null,
        defaultModel: typeof v.defaultModel === 'string' && v.defaultModel ? v.defaultModel : DEFAULTS.defaultModel,
        defaultEffort: EFFORTS.has(v.defaultEffort) ? v.defaultEffort : DEFAULTS.defaultEffort,
        defaultMode: MODES.has(v.defaultMode) ? v.defaultMode : DEFAULTS.defaultMode
    };
}

const pct = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > 100) throw new Error('A max usage is a percent from 1 to 100 (blank for none)');
    return n;
};

/** Saves an account's settings (and its name). Answers the saved settings. */
async function save(gr, index, patch = {}) {
    const host = require('./claudeAccountHost');
    const acc = host.listAccounts(gr).find((a) => a.index === Number(index));
    if (!acc) throw new Error('No such Claude account');
    if (patch.name !== undefined) {
        const name = String(patch.name || '').trim().slice(0, 60);
        if (!name) throw new Error('An account needs a name');
        if (name !== acc.name) await gr.getApiKeyManager().updateApiKey('claude', acc.index, name, '');
    }
    const cur = get(gr, acc.id);
    const next = Object.assign({}, cur);
    if (patch.preferred !== undefined) next.preferred = patch.preferred === true;
    if (patch.maxWeeklyPct !== undefined) next.maxWeeklyPct = pct(patch.maxWeeklyPct);
    if (patch.maxSessionPct !== undefined) next.maxSessionPct = pct(patch.maxSessionPct);
    if (patch.defaultModel !== undefined) {
        const m = String(patch.defaultModel || '').trim();
        if (m && !MODEL_RE.test(m)) throw new Error('That is not a model name');
        next.defaultModel = m || DEFAULTS.defaultModel;
    }
    if (patch.defaultEffort !== undefined) {
        if (!EFFORTS.has(String(patch.defaultEffort || ''))) throw new Error('effort is low, medium, high, xhigh or max');
        next.defaultEffort = String(patch.defaultEffort || '');
    }
    if (patch.defaultMode !== undefined) {
        if (!MODES.has(patch.defaultMode)) throw new Error('Unknown permission mode');
        next.defaultMode = patch.defaultMode;
    }
    const cfg = gr.modifyConfig('config');
    if (next.preferred) {
        // one preferred account: the others lose it
        for (const [id, v] of Object.entries(all(gr))) {
            if (id !== acc.id && v && v.preferred) await cfg.assign(['fleet', 'accounts', id, 'preferred'], false);
        }
    }
    await cfg.assign(['fleet', 'accounts', acc.id], next);
    return get(gr, acc.id);
}

function limitCap(limit, s) {
    const k = String((limit && limit.kind) || '');
    if (k === 'session' || k === 'five_hour') return s.maxSessionPct;
    if (k.startsWith('weekly') || k.startsWith('seven_day')) return s.maxWeeklyPct;
    return null;
}

/** { state, schedulable, message, resetsAt } for an account from its usage row and its settings. */
function availability(usage, s) {
    const limits = (usage && Array.isArray(usage.limits) ? usage.limits : []).filter((l) => Number.isFinite(l.percent));
    if (!limits.length) return { state: 'unknown', schedulable: true, message: usage && usage.error ? `Usage unknown: ${usage.error}` : 'Usage not read yet', resetsAt: null };
    const label = (l) => l.label || l.short || l.kind;
    const when = (l) => l.resetsAt || null;
    const full = limits.filter((l) => l.percent >= 100 || l.severity === 'exceeded');
    if (full.length) {
        const l = full.sort((a, b) => (when(b) || 0) - (when(a) || 0))[0];
        return { state: 'exhausted', schedulable: false, message: `${label(l)} limit reached (${l.percent}%): no new work until it resets`, resetsAt: when(l) };
    }
    const capped = limits.map((l) => ({ l, cap: limitCap(l, s) })).filter((x) => x.cap && x.l.percent >= x.cap);
    if (capped.length) {
        const { l, cap } = capped[0];
        return { state: 'capped', schedulable: false, message: `${label(l)} at ${l.percent}%, past this account's max of ${cap}%: no new work until it resets`, resetsAt: when(l) };
    }
    const near = limits.map((l) => ({ l, cap: limitCap(l, s) })).filter((x) => x.l.percent >= NEAR_PCT || (x.cap && x.l.percent >= x.cap - NEAR_CAP));
    if (near.length) {
        const { l, cap } = near.sort((a, b) => b.l.percent - a.l.percent)[0];
        return { state: 'near', schedulable: true, message: `${label(l)} at ${l.percent}%${cap ? ` (max ${cap}%)` : ''}: close to its limit`, resetsAt: when(l) };
    }
    return { state: 'free', schedulable: true, message: '', resetsAt: null };
}

/** The usage row for an account index from claudeUsage's last read (no fetch). */
function usageFor(index) {
    try {
        const snap = require('./claudeUsage').cached();
        const row = snap && (snap.accounts || []).find((a) => a.index === index);
        if (!row) return null;
        return { plan: row.plan || '', limits: row.limits || [], at: row.at || null, error: row.error || null };
    } catch (_) { return null; }
}

module.exports = { get, save, availability, usageFor, DEFAULTS, _limitCap: limitCap };
