/*
 * CaféReady tasks: the runtime (StaticForge #908, rule cafeready-background).
 *
 * A phone duty that must keep working with the page asleep, killed or never opened (status bar handlers,
 * notification drivers, drive alerts) is a task: plain JavaScript, no DOM, no socket, no timers of its own.
 * The Android app runs the tasks in its CaféReady task host (DSApp CafeTasks: an isolated JavaScript engine
 * started by the app, no WebView page) from the copy bundled into the APK (assets/cafe-tasks, synced by
 * scripts/sync-cafe-tasks.js), so a server change never reaches an installed app's tasks unseen. The page
 * loads the same files for the pure parts (CafeTasks.lib) and reads the app's task output instead of
 * computing its own copy (window.AndroidTasks).
 *
 * A task: CafeTasks.define({ name, api, init(state), on: { <event>: (ctx, data) => {} } }).
 * Events from the host:
 *   start {}                    the task was loaded (app start, the host woke it)
 *   link { connected }          the CaféReady link (Melaton Café Miniport) came up / went
 *   drive { ...getDriveState }  the app's drive state changed (DSApp DriveState)
 *   fix { lat, lon, accuracyM, speed, heading, at }   a position, only while the task asked for one
 *   reply { tag, type, ok, data, error }               the answer to ctx.request
 *   push { type, data }         a server packet of a type the task subscribed to
 *   timer {}                    the time the task asked for (ctx.timer) came
 * ctx: state (kept by the host across restarts; changes are saved after the event), now (epoch ms),
 *   link(on) (the task needs the CaféReady link now: requests, pushes and feeds flow only while some task
 *   asks for it; the host closes it and stops the engine when none does),
 *   notify({ id, kind, title, text }), location('off' | 'low' | 'high'), request(type, data, tag),
 *   subscribe([type]) (broadcast types it hears as push), feed(name, on) (statusHub feeds), output(obj)
 *   (what the app's native parts and the page read), timer(ms) (one, inexact, never repeating; 0 cancels),
 *   log(text).
 * Host -> runtime: CafeTasks.dispatch(name, eventType, dataJson, stateJson?) -> JSON
 *   { patch?: { key: value } (the state's top-level keys that changed), drop?: [key] (keys removed),
 *   actions: [{ op, ... }], error? }. stateJson (the whole state the host kept) only on the first event after
 *   the engine started. A task never throws past dispatch.
 *
 * Versioning: CafeTasks.API is the host interface level these files need; the app refuses tasks whose api
 * is above its own (DSApp CafeTasks.HOST_API) and keeps its native fallbacks.
 */
(function (root) {
    'use strict';
    if (root.CafeTasks && root.CafeTasks.API) return;
    const API = 1;
    const tasks = Object.create(null);
    const states = Object.create(null);
    // each task's state as last handed to the host, per top-level key (only what changed goes back)
    const saved = Object.create(null);

    function snapshot(state) {
        const out = Object.create(null);
        Object.keys(state).forEach((k) => { out[k] = JSON.stringify(state[k]); });
        return out;
    }

    function define(task) {
        if (!task || typeof task.name !== 'string' || !task.on) throw new Error('a task needs a name and handlers');
        tasks[task.name] = task;
    }

    function stateOf(name, stateJson) {
        if (stateJson != null && stateJson !== '') {
            let st = null;
            try { st = JSON.parse(stateJson); } catch (_) { st = null; }
            if (st && typeof st === 'object') {
                // keys a newer task added start from its init
                const t = tasks[name];
                const base = {};
                if (t && typeof t.init === 'function') t.init(base);
                states[name] = Object.assign(base, st);
                saved[name] = snapshot(st);
            }
        }
        if (!states[name]) {
            const t = tasks[name];
            states[name] = {};
            if (t && typeof t.init === 'function') t.init(states[name]);
            saved[name] = Object.create(null);
        }
        return states[name];
    }

    function dispatch(name, type, dataJson, stateJson) {
        const t = tasks[name];
        const actions = [];
        if (!t) return JSON.stringify({ actions, error: `no task ${name}` });
        const state = stateOf(name, stateJson);
        let data = null;
        try { data = typeof dataJson === 'string' ? JSON.parse(dataJson || 'null') : dataJson; } catch (_) { data = null; }
        const ctx = {
            state,
            now: Date.now(),
            notify: (n) => actions.push({ op: 'notify', id: String(n.id || ''), kind: String(n.kind || ''), title: String(n.title || ''), text: String(n.text || '') }),
            link: (on) => actions.push({ op: 'link', on: !!on }),
            location: (level) => actions.push({ op: 'location', level: level === 'high' || level === 'low' ? level : 'off' }),
            request: (rtype, rdata, tag) => actions.push({ op: 'request', type: String(rtype), data: rdata || {}, tag: String(tag || rtype) }),
            subscribe: (types) => actions.push({ op: 'subscribe', types: (types || []).map(String) }),
            feed: (feed, on) => actions.push({ op: 'feed', feed: String(feed), on: !!on }),
            output: (o) => actions.push({ op: 'output', output: o || {} }),
            timer: (ms) => actions.push({ op: 'timer', ms: Math.max(0, Math.round(Number(ms) || 0)) }),
            log: (text) => actions.push({ op: 'log', text: String(text) })
        };
        let error;
        const fn = t.on[type];
        if (typeof fn === 'function') {
            try { fn(ctx, data || {}); } catch (e) { error = `${type}: ${(e && e.stack) || e}`; }
        }
        const out = { actions };
        const was = saved[name];
        const patch = {};
        let changed = false;
        Object.keys(state).forEach((k) => {
            const v = JSON.stringify(state[k]);
            if (was[k] !== v) { was[k] = v; patch[k] = state[k]; changed = true; }
        });
        const drop = Object.keys(was).filter((k) => !(k in state));
        drop.forEach((k) => { delete was[k]; });
        if (changed) out.patch = patch;
        if (drop.length) out.drop = drop;
        if (error) out.error = error;
        return JSON.stringify(out);
    }

    // a lib loaded before the runtime (the page loads status-order.js with wmShell.js, #907) is kept
    const lib = (root.CafeTasks && root.CafeTasks.lib) || {};
    root.CafeTasks = { API, define, dispatch, lib, names: () => Object.keys(tasks) };
})(typeof globalThis !== 'undefined' ? globalThis : this);
