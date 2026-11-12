/**
 * ActiveSync: clipboard text and links between the desktop and a phone (Yozora #747).
 *
 *   clipboard.set { text }     the text goes on this side's clipboard; -> true
 *   open.url { url }           an http(s) link opens here: in Internet Explorer on the phone
 *                              (wmBrowser), in an Alchemy tab on the desktop (openWebUrl); -> true
 *
 *   activeSyncClipboard.sendClipboard(peerId)   this side's clipboard text to the other side
 *   activeSyncClipboard.sendLink(peerId, url)   a link to open there (asks for it when url is empty)
 *
 * Both wait for an offline partner (the server keeps them). Nothing is asked on the receiving side:
 * the phone's user granted "Clipboard and links" for the connection, and a notification says what
 * arrived. Device Center lists both under Programs and Services; the phone's ActiveSync program has
 * them in its Menu (wmActiveSync.js).
 */
(function (root) {
    'use strict';

    const as = root.activeSync;
    if (!as || !as.kind) return;

    const fn = (name) => {
        try { return typeof root[name] === 'function' ? root[name] : (0, eval)(`typeof ${name} === 'function' ? ${name} : null`); } catch (_) { return null; } // eslint-disable-line no-eval
    };
    const err = (code, message) => ({ code, message });
    const MAX_TEXT = 200000;

    function note(type, text) {
        const sh = root.wmShell;
        if (sh && typeof sh.notify === 'function') { sh.notify({ title: 'ActiveSync', text, icon: type === 'error' ? 'error' : 'info', timeout: 5000 }); return; }
        if (typeof root.showGlassToast === 'function') root.showGlassToast(type === 'error' ? 'error' : 'success', 'ActiveSync', text, false, 5000);
    }

    function webUrl(v) {
        try {
            const u = new URL(String(v || '').trim());
            return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
        } catch (_) { return null; }
    }

    async function writeClipboard(text) {
        const copy = fn('copyTextToClipboard'); // public/scripts/utils/dreamscapeClipboard.js (the app's bridge on a phone)
        if (copy) { const ok = await copy(text); if (ok === false) throw err('CLIPBOARD', 'The clipboard could not be written.'); return; }
        await root.navigator.clipboard.writeText(text);
    }

    async function readClipboard() {
        const read = fn('readClipboardTextFast');
        if (read) return String((await read()) || '');
        return String((await root.navigator.clipboard.readText()) || '');
    }

    let waiting = null; // { text, who } that arrived while this window was not the focused one
    let waitingHooked = false;

    as.registerOp('clipboard.set', async (args, from) => {
        const text = String((args && args.text) || '');
        if (!text) throw err('EMPTY', 'Nothing to copy.');
        if (text.length > MAX_TEXT) throw err('TOO_LARGE', 'The text is too long.');
        const who = (from && from.name) || 'the other device';
        try {
            await writeClipboard(text);
        } catch (e) {
            // a browser only lets the window in use write: the text goes on when this one is used next
            if (as.kind !== 'computer') throw e;
            waiting = { text, who };
            if (!waitingHooked) {
                waitingHooked = true;
                const flush = () => {
                    const w = waiting;
                    if (!w) return;
                    waiting = null;
                    writeClipboard(w.text).then(
                        () => note('info', `Text from ${w.who} is on the clipboard.`),
                        () => { if (!waiting) waiting = w; });
                };
                root.addEventListener('focus', flush);
                document.addEventListener('pointerdown', flush, true);
                document.addEventListener('keydown', flush, true);
            }
            return true;
        }
        waiting = null;
        note('info', `Text from ${who} is on the clipboard.`);
        return true;
    });

    as.registerOp('open.url', async (args, from) => {
        const url = webUrl(args && args.url);
        if (!url) throw err('BAD_URL', 'Not a web address.');
        const who = (from && from.name) || 'the other device';
        if (root.wmBrowser && typeof root.wmBrowser.open === 'function') {
            if (root.wmBrowser.open(url) === false) throw err('BAD_URL', 'The address could not be opened.');
        } else {
            const open = fn('openWebUrl'); // public/scripts/comp/featureLoader.js
            if (!open) throw err('UNSUPPORTED', 'Links cannot be opened here.');
            await open(url);
        }
        note('info', `A link from ${who} was opened.`);
        return true;
    });

    function targets() {
        const st = as.state();
        if (as.kind === 'computer') {
            return st.devices
                .filter((d) => (d.online ? (d.session === 'guest' || d.session === 'partner') : d.partner) && d.permissions.includes('clipboard'))
                .map((d) => ({ id: d.deviceId, name: d.name, online: d.online }));
        }
        if (st.session !== 'guest' && st.session !== 'partner') return [];
        return st.computers.map((c) => ({ id: c.computerId, name: c.name, online: true }));
    }

    const nameOf = (peerId) => { const t = targets().find((x) => x.id === peerId); return (t && t.name) || 'the device'; };

    async function send(peerId, op, args, done, waits) {
        try {
            const res = await as.call(peerId, op, args, { queue: as.kind === 'computer' });
            note('info', res && res.queued ? waits : done);
            return true;
        } catch (e) {
            note('error', (e && e.message) || 'It could not be sent.');
            return false;
        }
    }

    async function sendClipboard(peerId) {
        let text = '';
        try { text = await readClipboard(); } catch (_) { text = ''; }
        if (!text.trim()) { note('error', 'The clipboard holds no text.'); return false; }
        if (text.length > MAX_TEXT) { note('error', 'The text on the clipboard is too long to send.'); return false; }
        const name = nameOf(peerId);
        return send(peerId, 'clipboard.set', { text }, `The clipboard text is on ${name}.`, `The clipboard text waits for ${name}.`);
    }

    async function askLink() {
        let seed = '';
        try { seed = webUrl(await readClipboard()) || ''; } catch (_) { seed = ''; }
        const sh = root.wmShell;
        if (sh && typeof sh.messageBox === 'function') {
            const v = await sh.messageBox({ title: 'ActiveSync', text: 'Address to open on the computer:', modal: true, cancelValue: null, input: { value: seed, placeholder: 'https://' }, buttons: [{ text: 'Send', value: true }, { text: 'Cancel', value: null }] });
            return typeof v === 'string' ? v : null;
        }
        if (typeof root.showConfirmationDialog !== 'function') return null;
        const id = `asLink${Date.now()}`;
        let typed = seed;
        const grab = (ev) => { if (ev.target && ev.target.id === id) typed = ev.target.value; };
        document.addEventListener('input', grab, true);
        try {
            const ok = await root.showConfirmationDialog(
                `<p>Address to open on the device:</p><p><input type="text" id="${id}" class="form-control" style="width:100%" value="${seed.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}" placeholder="https://" spellcheck="false"></p>`,
                [{ text: 'Send', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, { title: 'Melaton Mobile Device Center', width: 420 });
            return ok === true ? typed : null;
        } finally {
            document.removeEventListener('input', grab, true);
        }
    }

    async function sendLink(peerId, url) {
        let target = webUrl(url);
        if (!target) {
            const typed = await askLink();
            if (typed == null) return false;
            target = webUrl(typed) || webUrl(`https://${String(typed).trim()}`);
            if (!target) { note('error', 'That is not a web address.'); return false; }
        }
        const name = nameOf(peerId);
        return send(peerId, 'open.url', { url: target }, `The link is open on ${name}.`, `The link waits for ${name}.`);
    }

    root.activeSyncClipboard = { sendClipboard, sendLink, targets };

    if (as.kind === 'computer') {
        const mas = (root.melatonActiveSync = root.melatonActiveSync || {});
        const add = (tile, task) => (typeof mas.addTask === 'function' ? mas.addTask(tile, task) : (mas.pending = mas.pending || []).push([tile, task]));
        const allowed = (d) => d.permissions.includes('clipboard');
        add('programs', { id: 'clipboard-send', text: 'Send the clipboard text to your device', icon: 'clipboard-32.png', when: allowed, run: (d) => sendClipboard(d.deviceId) });
        add('programs', { id: 'link-send', text: 'Open a link on your device', icon: 'ie-32.png', when: allowed, run: (d) => sendLink(d.deviceId) });
    }
})(typeof window !== 'undefined' ? window : globalThis);
