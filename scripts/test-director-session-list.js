#!/usr/bin/env node
'use strict';
// Wren list and sandbox tray: newest activity first, TokenRouter chats included.
const assert = require('assert');
const d = require('../modules/cursorDirector');
const t = d._test;
const day = (n) => new Date(Date.UTC(2026, 9, n)).toISOString();
const user = (n) => ({ role: 'user', message_type: 'Ask', timestamp: day(n) });
const index = { chats: [
    { id: 'dirc_tr_old', cursorId: null, lastEngine: 'tokenrouter', model: 'minimax/minimax-m3.1-flash',
        choice: { engine: 'tokenrouter', id: 'minimax/minimax-m3.1-flash' }, claudeSessionId: 'x',
        created_at: day(12), updated_at: day(19), messages: [user(19), { role: 'assistant' }] },
    { id: 'dirc_c1', cursorId: 'c1', lastEngine: 'cursor', created_at: day(13), updated_at: day(13), messages: [] },
    { id: 'dirc_c2', cursorId: 'c2', created_at: day(14), updated_at: day(14), messages: [] },
    { id: 'dirc_c3', cursorId: 'c3', created_at: day(15), updated_at: day(15), messages: [] },
    { id: 'dirc_hidden', dynagen: true, created_at: day(18), updated_at: day(18), messages: [user(18)] }
] };
const listed = t.listedChatsByActivity(index).map((c) => c.id);
assert.deepStrictEqual(listed, ['dirc_tr_old', 'dirc_c3', 'dirc_c2', 'dirc_c1']);
const tray = t.traySessions(index, null);
assert.strictEqual(tray.length, 3);
assert.strictEqual(tray[0].id, 'dirc_tr_old', 'recently active TokenRouter chat is in the tray');
assert.strictEqual(tray[0].engine, 'tokenrouter');
assert.strictEqual(tray[0].model, 'minimax/minimax-m3.1-flash');
const pub = t.publicSession(index.chats[0]);
assert.strictEqual(pub.engine, 'tokenrouter');
assert.strictEqual(pub.model, 'minimax/minimax-m3.1-flash');
assert.strictEqual(pub.running, false);
// No lastEngine yet: fall back to the picked engine.
assert.strictEqual(t.publicSession({ id: 'x', choice: { engine: 'tokenrouter', id: 'a/b' }, messages: [] }).engine, 'tokenrouter');
// ---- the client: a session row shows a turn that runs (#1319) ----
// Rows come with `running` (xiDirector listChatBriefs, cursorDirector publicSession) and wear the working mark; the
// status packets (applyDirectorStatus) put it on and take it off in place, without drawing the list again.
{
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');
    const tables = src.indexOf('const DIRECTOR_TRAY_STATES');
    const tablesEnd = src.indexOf('};', src.indexOf('const DIRECTOR_TRAY_ICONS')) + 2;
    const cs = src.indexOf('class Director {');
    const ce = src.indexOf('\n}\n', cs);
    assert.ok(tables >= 0 && tablesEnd > tables && cs > tables && ce > cs, 'tray tables and the Director class');

    const fakeEl = () => {
        const el = {
            dataset: {}, attrs: {}, className: '', title: '', innerHTML: '',
            classList: { add() {}, remove() {}, toggle() {} },
            setAttribute(k, v) { el.attrs[k] = String(v); },
            removeAttribute(k) { delete el.attrs[k]; },
            querySelector() { return null; }
        };
        return el;
    };
    const ctx = {
        console,
        document: { createElement: fakeEl },
        contextMenu: null,
        window: { currentSession: null }
    };
    vm.createContext(ctx);
    vm.runInContext(`${src.slice(tables, tablesEnd)}\n${src.slice(cs, ce + 2)}\nthis.Director = Director;`, ctx);

    function page(persona, sessions) {
        const d = Object.create(ctx.Director.prototype);
        d.persona = persona;
        d.directorSessions = sessions;
        d.currentSession = null;
        d._running = false;
        d._runningSessionId = null;
        d.drawn = 0;
        d.renderDirectorSessions = () => { d.drawn++; };
        d._doRenderDirectorSessions = () => { d.drawn++; };
        ['updateTrayChrome', 'noteCursorLogin', 'showTypingIndicator', 'loadDirectorSessions', 'continueAfterReconnect',
            'afterTurn', 'setImagePending'].forEach((k) => { d[k] = () => {}; });
        d.noteXiEnabled = () => false;
        const rows = sessions.map((session) => d.createSessionItem(session, []));
        rows.forEach((row, i) => { row.dataset.sessionId = String(sessions[i].id); });
        d.directorSessionList = {
            querySelectorAll(sel) {
                assert.strictEqual(sel, '.director-session-item[data-session-id]', 'rows are found by their session id');
                return rows;
            }
        };
        const on = () => rows.filter((row) => row.dataset.running === '1').map((row) => row.dataset.sessionId);
        return { d, rows, on };
    }
    const xiStatus = (ids) => ({ running: false, xi: { enabled: true, running: ids.length > 0, runningSessions: ids, sessionId: ids.length === 1 ? ids[0] : null } });
    const sessions = () => [
        { id: 'a', name: 'First', running: true, updated_at: day(20) },
        { id: 'b', name: 'Second', running: false, updated_at: day(19) },
        { id: 'c', name: 'Third', updated_at: day(18) }
    ];

    // the row built from the list packet: the mark is there, shown for a running chat only
    {
        const { rows, on } = page('xi', sessions());
        assert.deepStrictEqual(on(), ['a'], 'only the running chat\'s row is marked');
        assert.strictEqual(rows[0].attrs['aria-busy'], 'true', 'the marked row is busy to a screen reader');
        assert.strictEqual(rows[1].attrs['aria-busy'], undefined, 'an idle row is not');
        rows.forEach((row) => {
            assert.ok(/class="director-session-running"[^>]*role="img"[^>]*aria-label="Working"[^>]*title="Working"/.test(row.innerHTML), 'the mark is named Working');
            assert.ok(/class="fas fa-spinner"/.test(row.innerHTML), 'it wears the tray icon\'s working glyph');
            assert.ok(!/data:image|base64/.test(row.innerHTML), 'no inline picture');
        });
    }

    // Yozora: status.xi.runningSessions adds and clears marks live, on the same row elements
    {
        const { d, rows, on } = page('xi', sessions());
        const first = rows.slice();
        d.applyDirectorStatus(xiStatus(['a', 'b']));
        assert.deepStrictEqual(on(), ['a', 'b'], 'a status that lists b marks it');
        assert.strictEqual(rows[1].attrs['aria-busy'], 'true');
        d.applyDirectorStatus(xiStatus(['b']));
        assert.deepStrictEqual(on(), ['b'], 'a later status without a clears its mark');
        assert.strictEqual(rows[0].attrs['aria-busy'], undefined, 'and its busy state');
        d.applyDirectorStatus(xiStatus([]));
        assert.deepStrictEqual(on(), [], 'no run: no mark');
        assert.strictEqual(d.drawn, 0, 'the list was not drawn again');
        rows.forEach((row, i) => assert.strictEqual(row, first[i], 'same row elements'));
        // the list the page holds follows, so a later draw (new rows) shows the same
        assert.deepStrictEqual(d.directorSessions.map((s) => s.running), [false, false, false]);
        d.applyDirectorStatus(xiStatus(['c']));
        const drawnLater = d.createSessionItem(d.directorSessions[2], []);
        assert.strictEqual(drawnLater.dataset.running, '1', 'a row drawn after the status wears the mark');
        const idle = d.createSessionItem(d.directorSessions[0], []);
        assert.strictEqual(idle.dataset.running, undefined);
        // a status with nothing about Yozora does not clear what the list said
        const kept = page('xi', sessions());
        kept.d.applyDirectorStatus({ running: false });
        assert.deepStrictEqual(kept.on(), ['a'], 'a packet without xi leaves the marks alone');
        // a single-run xi packet (no runningSessions list)
        const single = page('xi', sessions());
        single.d.applyDirectorStatus({ xi: { enabled: true, running: true, sessionId: 'c' } });
        assert.deepStrictEqual(single.on(), ['c'], 'xi.running + xi.sessionId');
    }

    // Director (cursor): status.running + status.sessionId
    {
        const { d, rows, on } = page('wren', [
            { id: 'w1', name: 'One' }, { id: 'w2', name: 'Two' }, { id: 'w3', name: 'Three' }
        ]);
        d.applyDirectorStatus({ running: true, sessionId: 'w2', xi: { running: false, runningSessions: [] } });
        assert.deepStrictEqual(on(), ['w2'], 'status.running + status.sessionId marks the row');
        // the packet names the first run only: the mark of another run (the list said it) stays until that turn ends
        d.directorSessions[0].running = true;
        rows[0].dataset.running = '1';
        d._runningRowsKey = null;
        d.applyDirectorStatus({ running: true, sessionId: 'w3', xi: { running: false, runningSessions: [] } });
        assert.deepStrictEqual(on(), ['w1', 'w2', 'w3'], 'a first-run-only packet adds, it does not clear');
        d.applyDirectorStatus({ running: false, xi: { running: true, runningSessions: ['x1'] } });
        assert.deepStrictEqual(on(), [], 'idle: the cursor Director marks nothing (a Yozora run is another persona\'s row)');
        // when the packet lists every run it is the whole truth
        d.applyDirectorStatus({ running: true, sessionId: 'w1', runningSessions: ['w1', 'w2'], xi: { running: false } });
        assert.deepStrictEqual(on(), ['w1', 'w2']);
        d.applyDirectorStatus({ running: true, sessionId: 'w2', runningSessions: ['w2'], xi: { running: false } });
        assert.deepStrictEqual(on(), ['w2']);
        assert.strictEqual(d.drawn, 0, 'never drawn again');
    }

    // the turn this page runs keeps its mark through a status from before the run; its end clears it at once
    {
        const { d, on } = page('xi', sessions());
        d._running = true;
        d._runningSessionId = 'b';
        d._runningArmedAt = Date.now();
        d.applyDirectorStatus(xiStatus([]));
        assert.deepStrictEqual(on(), ['b'], 'the local turn is marked, the idle row a is not');
        d.finishTurn('b');
        assert.deepStrictEqual(on(), [], 'finishing the turn clears its row in place');
        assert.strictEqual(d.directorSessions[1].running, false);
        assert.strictEqual(d.drawn, 0);
    }

    // the helper: what each side of a packet says
    {
        const ids = (status, xi) => { const r = ctx.Director.runningSessionIds(status, xi); return r && [Array.from(r.ids), r.complete]; };
        assert.deepStrictEqual(ids(null, true), null);
        assert.deepStrictEqual(ids({ xi: { runningSessions: [1, 2] } }, true), [['1', '2'], true]);
        assert.deepStrictEqual(ids({ running: true, sessionId: 'w' }, false), [['w'], false]);
        assert.deepStrictEqual(ids({ running: false }, false), [[], true]);
        assert.deepStrictEqual(ids({}, false), null);
    }

    // the style: a token colour, the tray's pulse, shown by the attribute; no colour or font literal
    {
        const css = fs.readFileSync(path.join(__dirname, '../public/css/director.css'), 'utf8');
        const from = css.indexOf('.director-session-running {');
        assert.ok(from > 0, 'the mark has a style');
        const block = css.slice(from, css.indexOf('/* The rail shows', from));
        assert.ok(/\[data-running="1"\] \.director-session-running\s*\{\s*display: inline-flex/.test(block), 'shown by [data-running]');
        assert.ok(/var\(--text-accent\)/.test(block), 'a theme token');
        assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|font-family/.test(block), 'no colour or font literal');
    }
}

console.log('test-director-session-list: ok');
process.exit(0);
