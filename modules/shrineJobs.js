'use strict';

// Yozora's daily shrine job (#1149). Once a day (07:00 ET, the slot the rules reserve for it; config
// shrineJobs.time "HH:MM" server-local, shrineJobs.enabled false turns it off):
//   1. scripts/shrine-job.js --apply does the mechanical tidy-up and prints a JSON report
//      (merged scratch worktrees removed, partial downloads/old logs removed, disk use + growth,
//      fault reports of the last day, and the hand-in decision: only allow-listed Yozora files, only when
//      the checks are green - never other agents' work);
//   2. a Yozora chat (thread "shrine-jobs") gets the report and writes it up: a Dreamscape mail to Yukimi
//      in her own voice, with a picture of herself if she wants to draw one.
// A step that fails is part of the report ("missing"), the rest still run; if the script itself fails,
// Yozora is still asked to mail what happened.

const path = require('path');
const { execFile } = require('child_process');

const HOUR = 3600 * 1000;
const THREAD = 'shrine-jobs';
const REPO = path.join(__dirname, '..');
let timer = null;
let gr = null;
let lastRun = null;

function settings() {
    let cfg = {};
    try { cfg = (gr && gr.config && gr.config.shrineJobs) || {}; } catch (_e) { cfg = {}; }
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(cfg.time || '07:00'));
    return { enabled: cfg.enabled !== false, hour: m ? Math.min(23, +m[1]) : 7, minute: m ? Math.min(59, +m[2]) : 0 };
}

function nextRunAt(from = Date.now()) {
    const s = settings();
    const d = new Date(from);
    d.setHours(s.hour, s.minute, 0, 0);
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    return d.getTime();
}

function runScript() {
    return new Promise((resolve) => {
        execFile(process.execPath, [path.join(REPO, 'scripts', 'shrine-job.js'), '--apply'], { cwd: REPO, timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err && !stdout) return resolve({ ok: false, error: String(stderr || err.message).slice(0, 600) });
            try { resolve({ ok: true, report: JSON.parse(stdout) }); } catch (e) { resolve({ ok: false, error: `unreadable report: ${e.message}` }); }
        });
    });
}

function briefFor(result) {
    const body = result.ok ? JSON.stringify(result.report, null, 1).slice(0, 40000) : `The tidy-up script failed: ${result.error}`;
    return [
        'It is your daily shrine-maiden job (#1149). The tidy-up script has already run; its report is below.',
        'Do not commit or push anything yourself: the script decided that (only allow-listed files of yours, only when the checks are green; anything else is named in handIn.foreign and left to its owners).',
        'Read the report (disk growth, the fault reports worth a look, worktrees removed or kept and why, what could not be done: "missing"), look into the one or two most striking faults if you have the time, and then:',
        '1. send Yukimi a Dreamscape mail (send_mail) with the daily report: what was cleaned, what was found, what stayed open - plain and correct first;',
        '2. add a few sentences in your own voice: how you feel today, how your belly is doing;',
        '3. if you like, draw a picture of yourself and attach it (a file with an address, never an inline data: string).',
        'If a step is missing from the report, say so in the mail; never write that something was done that the report does not show.',
        '',
        '--- report ---',
        body
    ].join('\n');
}

async function runNow() {
    const started = Date.now();
    const result = await runScript();
    let session = null, error = null;
    try {
        const { startDirectorSession } = require('./directorStart');
        session = await startDirectorSession(gr, {
            persona: 'yozora', thread: THREAD, title: `Shrine job ${new Date(started).toISOString().slice(0, 10)}`,
            source: `shrine-job:${new Date(started).toISOString().slice(0, 10)}`, prompt: briefFor(result)
        });
    } catch (e) {
        error = e.message;
        console.warn(`[shrine] could not start Yozora: ${e.message}`);
    }
    lastRun = { at: started, scriptOk: result.ok, missing: result.ok ? result.report.missing : [result.error], sessionId: session && session.sessionId, error };
    return lastRun;
}

function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!settings().enabled) return;
    const wait = Math.min(nextRunAt() - Date.now(), 24 * HOUR);
    timer = setTimeout(async () => {
        timer = null;
        try { await runNow(); } catch (e) { console.warn(`[shrine] ${e.message}`); }
        arm();
    }, Math.max(1000, wait));
    if (timer.unref) timer.unref();
}

function start(globalResources) {
    if (globalResources) gr = globalResources;
    if (timer || process.env.SHRINE_JOBS_OFF) return module.exports;
    arm();
    return module.exports;
}

function stop() { if (timer) clearTimeout(timer); timer = null; }

function status() { return { armed: !!timer, nextAt: settings().enabled ? nextRunAt() : null, lastRun }; }

module.exports = { start, stop, status, runNow, nextRunAt };
