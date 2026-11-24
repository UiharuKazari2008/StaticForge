'use strict';

/**
 * The Plaud Actions brief for Yozora (#1154): Fleet's New Session wizard (claude_fleet_plaud start) sends it
 * for one recording; Yozora's Plaud Actions quick task (public/scripts/comp/director.js
 * DIRECTOR_XI_QUICK_STARTS xi-plaud-actions) is the same text for every recording not worked yet. Change both.
 */

const BODY = "Go through my Plaud recordings that are not worked yet, newest first (plaud_list_recordings; if I named a recording or a date in this message, only those). A recording is worked when a Yozora issue or comment, or an item in my calendars, already names source plaud:<id>: search Yozora and calendar_list_items for it before you start, and skip it or add only what is missing. For each one read the AI notes (plaud_get_recording) and the WHOLE transcript (plaud_get_transcript, every block). Pull out every actionable item, whatever project it belongs to, not only Dreamscape. Only what I said I will do, want done, or agreed to: nothing invented, nothing from small talk.\n1. Project work: file it on the Yozora repo of that project. List the repos first (GET /api/v1/repos/search?limit=50 and each org's repos) and pick the one the item is about; DreamScape/StaticForge only for Dreamscape itself. Check its open issues and comment on a match instead of filing a duplicate. English, Goal / Context / Scope checklist / Acceptance, the quote it came from, source plaud:<id>, type / priority / status labels where the repo has them. When no repo fits, make it a task (3) with the project name as its category and say so in the report.\n2. Appointments, meetings, calls and deadlines with a date or a time: calendar_add_items with kind event (never vfs_write on a calendar: the tool writes only the agents' own Yozora calendar, merges by UID and never touches my calendars). uid plaud-<id>-<n>@dreamscape, start / end as YYYY-MM-DDTHH:MM in my time (America/New_York) or YYYY-MM-DD for all day, summary, location when said, description with the quote and source plaud:<id>, reminderMinutes when I asked for a reminder. Resolve relative dates (\"next Tuesday\") from the recording's own date, not today.\n3. To-dos for me that are not project work (call, buy, send, book, check): calendar_add_items with kind task: uid plaud-<id>-t<n>@dreamscape, summary, due when a date was said, priority (1 high, 5 normal, 9 low), categories (the project or area), description with the quote and source plaud:<id>. They show in Calendar and Tasks on the phone and the desktop. Before adding, calendar_list_items with search plaud:<id> (and the day) so nothing goes in twice and nothing clashes with what I already have.\nAnything unclear (which project, which day, whether it is really a commitment): one request_form with all the questions, not one per item. Finish with a table: item, where it went (issue link, event with date and time, or task), and the recording it came from.";

/** The brief for one recording (or, without an id, the quick task as it is). */
function plaudActionsPrompt(recording) {
    if (!recording || !recording.id) return BODY;
    const name = String(recording.name || '').replace(/\s+/g, ' ').slice(0, 120);
    return `Only recording plaud:${recording.id}${name ? ` (${name})` : ''}, sent from Fleet.\n${BODY}`;
}

module.exports = { plaudActionsPrompt, BODY };
