#!/usr/bin/env node
/**
 * The Notification sound picker (StaticForge #1298, public/scripts/comp/wmNotifySound.js) walked on a real phone page
 * (Melaton Mobile inside the Android app, or the same page on a lane emulator), one named step at a time. The hermetic
 * tests are scripts/test-notify-sound-picker.js and scripts/test-notify-sound-choice-page.js; this is the device walk
 * that produced docs/testing/evidence/1298/a53-walk (the A53, release 30, Nov 27 2026).
 *
 *   node scripts/test-notify-sound-picker-device.js <cdpPort> <outDir> '<capture cmd with {file}>' <step[=name]> ...
 *
 *   <cdpPort>   the WebView's DevTools port on 127.0.0.1, forwarded by the caller
 *               (adb forward tcp:<port> localabstract:webview_devtools_remote_<app pid>; a lane: lane.sh <id> cdp)
 *   capture     the device's own full-screen capture, e.g. 'adb -s <serial> exec-out screencap -p > {file}' in a script,
 *               or 'scripts/aemu-lane/lane.sh --agent <id> <instance> shot {file}'
 *   steps       row open category tapcat more search clear preview stop select back ok none default titleok where look;
 *               '=name' names the step's screenshot and its line. A step that fails ends the run.
 *
 * Every user action is a real touch (Input.dispatchTouchEvent at the element's centre, refused when another element
 * covers it); typing is Input.insertText into the tapped box. Runtime.evaluate only READS the page. After each step it
 * prints one JSON line: what it did, the picker's state (heading, soft keys, rows with tick / Play / playing, the search
 * text, the list's scroll box, the visual viewport, AndroidSounds.playing() and get()) and the screenshot's path; the
 * whole run is saved as <outDir>/walk-<time>.json. It asserts nothing by itself: read the lines and LOOK at the pictures.
 *
 * It starts from Settings: the Sounds & Notifications page, the Settings grid, or the 6.5 Start screen's Settings folder
 * must be on screen ('where' says what is). A notice box over the screen is not dismissed for you.
 *
 * SOUND SAFETY: 'preview' taps a sound row of the open category, which plays it through the app. Use it only in the
 * Notifications category, with the notification volume at 0 or 1, never in Ringtones or Alarms. A phone whose own
 * settings give a notification class an Alarm file plays it for any such notice while the page is in front: check
 * wmShell.sounds.eventPrefs('notification') before raising test notices.
 *
 * Example (the A53 run): row=01-row open=02-categories category=03-category more=04-more preview=05-preview
 *   stop=06-stopped select=08-chosen open=09b-reopen tapcat=10-tick search=11-search  (hide the keyboard with the
 *   phone's back key)  back=13-back-to-categories back=14-back-to-page ok=15-saved
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const WebSocket = require('ws');
const [port, out, shotCmd] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((res, rej) => { http.get(url, { timeout: 8000 }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); });
const results = [];
(async () => {
    fs.mkdirSync(out, { recursive: true });
    const pages = (await getJson(`http://127.0.0.1:${port}/json/list`)).filter((p) => p.type === 'page');
    const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    let id = 0;
    const send = (method, params) => new Promise((resolve) => { const my = ++id; const on = (m) => { const d = JSON.parse(m); if (d.id === my) { ws.off('message', on); resolve(d.result || { error: d.error }); } }; ws.on('message', on); ws.send(JSON.stringify({ id: my, method, params })); });
    const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result ? r.result.value : undefined; };
    const VIS = `const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.hidden && !e.closest('[hidden]'); };`;
    const rectOf = (sel, re) => ev(`(function(){ ${VIS} const re = ${JSON.stringify(re || '')} ? new RegExp(${JSON.stringify(re || '')}, 'i') : null; const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => vis(e) && (!re || re.test((e.textContent || '').trim()))); if (!els.length) return null; const e = els[0]; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (e.textContent || '').trim().slice(0, 50), covered: top && !(e === top || e.contains(top) || top.contains(e)) ? (top.tagName + '.' + top.className).slice(0, 60) : '' }; })()`);
    const tap = async (sel, re) => {
        const v = await rectOf(sel, re);
        if (!v) throw new Error(`nothing visible: ${sel} ${re || ''}`);
        if (v.covered) throw new Error(`covered: ${sel} by ${v.covered}`);
        const pt = { x: Math.round(v.x), y: Math.round(v.y), id: 1 };
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
        await sleep(60);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        return v.text;
    };
    const waitFor = async (expr, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = await ev(`(function(){ ${VIS} const $$ = (s) => [...document.querySelectorAll(s)]; return (${expr}); })()`); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(100); } };
    const shot = (name) => { const f = path.join(out, name + '.png'); const r = spawnSync('bash', ['-c', shotCmd.replace('{file}', `'${f}'`)], { timeout: 40000 }); return r.status === 0 ? f : `shot failed ${name}`; };
    const state = () => ev(`(function(){ ${VIS} const $$ = (s) => [...document.querySelectorAll(s)]; const rows = $$('.wmns-list [data-key]').map((r) => ({ key: r.dataset.key, label: (r.querySelector('.wmns-label') || {}).textContent, count: (r.querySelector('.wmns-count') || {}).textContent, sel: r.classList.contains('is-selected'), tick: !!r.querySelector('.wmns-mark.is-chosen'), play: !!r.querySelector('.wmns-play'), playing: !!r.querySelector('.wmns-play.is-playing'), h: Math.round(r.getBoundingClientRect().height * 10) / 10 })); const list = document.querySelector('.wmns-list'); const btn = document.querySelector('[data-act="nsound"]'); const hdr = $$('#wmShell .wm-form-hdr').filter(vis)[0]; const title = document.querySelector('#wmShell .wm-title'); const n = document.querySelector('#wmShell .wm-notify'); return { app: window.wmShell.current, title: title ? title.textContent.trim() : '', heading: hdr ? hdr.textContent.trim() : '', keys: $$('#wmShell .wm-softkey').map((k) => k.textContent.trim()), rowBtn: btn && vis(btn) ? btn.textContent.trim() : null, depth: list ? (document.querySelector('#wmns-q') ? 2 : 1) : 0, nRows: rows.length, rows: rows.slice(0, 8), last: rows.slice(-1), search: document.querySelector('#wmns-q') ? document.querySelector('#wmns-q').value : null, listScroll: list ? { sh: list.scrollHeight, ch: list.clientHeight, top: list.scrollTop, ovf: getComputedStyle(list).overflowY } : null, pageScrolls: document.documentElement.scrollHeight > innerHeight + 1, selects: $$('select').filter(vis).length, vv: Math.round(visualViewport.height), notice: n && !n.hidden ? n.innerText.slice(0, 60) : null, playingId: window.AndroidSounds.playing ? window.AndroidSounds.playing() : '', choice: JSON.parse(window.AndroidSounds.get()) }; })()`);
    const step = async (name, fn) => { const o = { step: name }; try { o.did = await fn(); } catch (e) { o.error = e.message; } await sleep(350); try { o.state = await state(); } catch (e) { o.stateError = e.message; } o.shot = shot(name); results.push(o); console.log(JSON.stringify(o)); return o; };

    const steps = process.argv.slice(5);
    const all = {
        'row': async () => {
            if (!(await waitFor(`$$('[data-act="nsound"]').some(vis)`, 500))) {
                if (!(await waitFor(`$$('.wm-tab[data-tab="sounds"]').some(vis)`, 500))) {
                    if (await waitFor(`$$('.wm-icongrid-cell[data-key="sounds"]').some(vis)`, 500)) await tap('.wm-icongrid-cell[data-key="sounds"]');
                    else if (await waitFor(`$$('#wmShell .wm-s65-cell').some((e) => vis(e) && /Sounds & Notifications/.test(e.textContent))`, 500)) await tap('#wmShell .wm-s65-cell', 'Sounds & Notifications');
                    else throw new Error('neither the Sounds page, the Settings grid nor the Start cell is on screen');
                    await waitFor(`$$('.wm-tab[data-tab="sounds"]').some(vis)`);
                }
                await tap('.wm-tab[data-tab="sounds"]');
                await waitFor(`$$('[data-act="nsound"]').some(vis)`);
            }
            return 'on the Sounds tab';
        },
        'open': async () => { const t0 = Date.now(); await tap('[data-act="nsound"]'); await waitFor(`$$('.wmns-list [data-key]').some(vis)`); return { openMs: Date.now() - t0 }; },
        'category': async () => { await tap('.wmns-list [data-key="cat:notification"]'); await waitFor(`$$('.wmns-list [data-key="cat:notification"].is-selected').length`); const t0 = Date.now(); await tap('#wmShell .wm-softkey[data-side="left"]', '^Select$'); await waitFor(`!!document.querySelector('#wmns-q')`); return { categoryMs: Date.now() - t0 }; },
        'more': async () => { const has = await waitFor(`$$('.wmns-list [data-key="more"]').length`, 400); if (!has) return 'no Show more row'; await tap('.wmns-list [data-key="more"]'); await sleep(400); return 'tapped Show more'; },
        'search': async () => { await tap('#wmns-q'); await sleep(500); await send('Input.insertText', { text: process.env.WALK_QUERY || 'al' }); await sleep(700); return { typed: process.env.WALK_QUERY || 'al' }; },
        'preview': async () => { const key = await ev(`(function(){ const r = [...document.querySelectorAll('.wmns-list [data-key^="s:"]')]; return r.length ? r[Math.min(1, r.length - 1)].dataset.key : ''; })()`); await tap(`.wmns-list [data-key="${key}"]`); await sleep(700); return { tapped: key, playing: await ev('window.AndroidSounds.playing()') }; },
        'stop': async () => { await tap('.wmns-list .wmns-play'); await sleep(400); return { playing: await ev('window.AndroidSounds.playing()') }; },
        'select': async () => { await tap('#wmShell .wm-softkey[data-side="left"]', '^Select$'); await waitFor(`!document.querySelector('.wmns-list') && $$('[data-act="nsound"]').some(vis)`); return { playingAfter: await ev('window.AndroidSounds.playing()') }; },
        'back': async () => { await tap('#wmShell .wm-softkey[data-side="right"]', '^Back$'); await sleep(400); return 'Back'; },
        'ok': async () => { await tap('#wmShell .wm-title-action'); await sleep(900); return { saved: await ev('JSON.parse(window.AndroidSounds.get())') }; },
        'none': async () => { await tap('.wmns-list [data-key="none"]'); await sleep(250); await tap('#wmShell .wm-softkey[data-side="left"]', '^Select$'); await sleep(500); return 'None selected'; },
        'default': async () => { await tap('.wmns-list [data-key="default"]'); await sleep(250); await tap('#wmShell .wm-softkey[data-side="left"]', '^Select$'); await sleep(500); return 'Event sounds selected'; },
        'tapcat': async () => { await tap('.wmns-list [data-key="cat:notification"]'); await waitFor(`!!document.querySelector('#wmns-q')`, 2500); return 'tapped the Notifications row'; },
        'clear': async () => { await tap('#wmns-q'); await sleep(300); for (let i = 0; i < 6; i++) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); } await sleep(700); return 'cleared the search box'; },
        'titleok': async () => { await tap('#wmShell .wm-title-action'); await sleep(900); return 'title ok / close'; },
        'where': async () => ev(`(function(){ ${VIS} const $$ = (s) => [...document.querySelectorAll(s)].filter(vis); return { grid: $$('.wm-icongrid-cell').map((e) => e.dataset.key).slice(0, 40), s65: $$('#wmShell .wm-s65-cell').map((e) => e.textContent.trim()).slice(0, 40), tabs: $$('.wm-tab').map((e) => e.dataset.tab), action: $$('#wmShell .wm-title-action').map((e) => e.dataset.kind) }; })()`),
        'look': async () => 'look'
    };
    for (const s of steps) {
        const [name, label] = s.split('=');
        if (!all[name]) { console.log(JSON.stringify({ step: s, error: 'unknown step' })); continue; }
        const o = await step(label || name, all[name]);
        if (o.error) break;
    }
    fs.writeFileSync(path.join(out, `walk-${Date.now()}.json`), JSON.stringify(results, null, 1));
    ws.close();
    process.exit(0);
})().catch((e) => { console.log(JSON.stringify({ fatal: e.message })); process.exit(1); });
