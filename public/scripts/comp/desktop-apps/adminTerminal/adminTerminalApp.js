/**
 * Administrator Terminal (Yozora #1133): raw bash on the server in a desktop window. xterm.js draws it
 * (public/scripts/vendor/xterm, the FitAddon fits it to the window and every resize goes to the pty),
 * the server's node-pty runs it (modules/adminTerminal.js). Keys, output and resizes travel on the
 * app's WebSocket (docs/client-api/ws/adminTerminal.md); the server refuses anyone but an
 * administrator with a full sign-in.
 *
 *   window.openMelatonAdminTerminal()   a new window and a new shell every time; closing the window ends its shell
 *
 * Nothing polls: output is pushed, resizes come from a ResizeObserver, the ack that keeps the server
 * from flooding the socket is sent when xterm has written the output. Listeners end with the window
 * (and with this file's Melaton segment).
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const TITLE = 'Administrator: bash';
    const ICON16 = '/static_images/vista-cmd/cmd-16.png';
    const ICON32 = '/static_images/vista-cmd/cmd-32.png';
    const FONT = "Consolas, 'Lucida Console', 'DejaVu Sans Mono', 'Liberation Mono', monospace";
    const FONT_SIZE = 14;
    const START_COLS = 80;
    const START_ROWS = 25;
    const ACK_AT = 32 * 1024;
    const EXIT_CLOSE_MS = 1500;
    // the segment this file loaded in: page listeners end with it (app-scope, #872/#890)
    const segmentSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || null;

    // the console's colours: the console theme's tokens (public/css/themes/vista/console.css), read when a window opens
    const THEME_KEYS = ['background', 'foreground', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
        'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
    function consoleTheme() {
        const cs = root.getComputedStyle(doc.documentElement);
        const token = (key) => cs.getPropertyValue('--console-term-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())).trim();
        const theme = {};
        THEME_KEYS.forEach((key) => { const v = token(key); if (v) theme[key] = v; });
        theme.cursor = theme.foreground;
        theme.cursorAccent = theme.background;
        const sel = token('selection');
        if (sel) theme.selectionBackground = sel;
        return theme;
    }

    let counter = 0;

    function call(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    /** One cell's size in the console font, measured with a probe (the window's default size is 80 x 25 cells). */
    function measureCell() {
        const probe = doc.createElement('span');
        probe.className = 'at-probe';
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${FONT_SIZE}px ${FONT};line-height:normal`;
        probe.textContent = 'W'.repeat(50);
        doc.body.appendChild(probe);
        const r = probe.getBoundingClientRect();
        probe.remove();
        return { w: r.width / 50 || 8, h: Math.ceil(r.height) || 17 };
    }

    class AdminTerminal {
        constructor() {
            counter += 1;
            this.n = counter;
            this.id = `at${Date.now().toString(36)}${counter}`;
            this.ctl = new AbortController();
            if (segmentSignal) {
                if (segmentSignal.aborted) this.ctl.abort();
                else segmentSignal.addEventListener('abort', () => this.teardown(true), { once: true });
            }
            this.opened = false;
            this.exited = false;
            this.closed = false;
            this.ackPending = 0;
            this.writing = 0;
            this.term = null;
            this.fit = null;
            this.build();
        }

        get signal() { return this.ctl.signal; }

        build() {
            const cell = measureCell();
            // desktopAppCreateWindow: public/scripts/comp/desktop-apps/desktopAppWindow.js (the shared builder)
            const w = root.desktopAppCreateWindow({
                id: `adminTerminalModal${this.n}`,
                identifier: `adminTerminal${this.n}`,
                title: TITLE,
                icon16: ICON16,
                taskbarIcon: ICON32,
                className: 'at-window',
                minimize: true
            });
            this.modal = w.modal;
            this.content = w.content;
            this.cell = cell;
            const m = this.modal;
            // an estimate of the frame until the real one is measured at show(): 80 x 25 cells, the scroll bar, the padding
            m.dataset.windowDefaultWidth = String(Math.ceil(START_COLS * cell.w) + 14 + 12 + 16);
            m.dataset.windowDefaultHeight = String(START_ROWS * cell.h + 6 + 42);
            m.dataset.windowMinWidth = '240';
            m.dataset.windowMinHeight = '120';
            this.content.classList.add('at-client');
            this.host = doc.createElement('div');
            this.host.className = 'at-host';
            this.content.appendChild(this.host);
            w.close.addEventListener('click', () => this.close(), { signal: this.signal });
            // the desktop's own shortcuts must not take what is typed into the shell (xterm's textarea is inside the host)
            for (const type of ['keydown', 'keyup', 'keypress']) this.host.addEventListener(type, (ev) => ev.stopPropagation(), { signal: this.signal });
            this.host.addEventListener('mousedown', () => { if (this.term) this.term.focus(); }, { signal: this.signal });
            if (typeof attachModalListeners === 'function') {
                // the window closed by any path (the caption, the taskbar, a program fault): its shell ends too
                attachModalListeners(m, (sig) => sig.addEventListener('abort', () => this.teardown(true), { once: true }));
            }
        }

        show() {
            const m = this.modal;
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed) return;
                placed = true;
                // the frame's real size around the client, then exactly 80 x 25 cells inside it
                // offset sizes: the open animation scales the window, a client rect would read the scaled box
                const r = { width: m.offsetWidth, height: m.offsetHeight };
                const extraW = r.width - this.content.clientWidth;
                const extraH = r.height - this.content.clientHeight;
                const want = {
                    w: Math.ceil(START_COLS * this.cell.w) + 14 + 12 + extraW,
                    h: START_ROWS * this.cell.h + 6 + extraH
                };
                const keptSize = m.hasAttribute('data-window-position-restored') && parseFloat(m.style.width) > 0 && parseFloat(m.style.height) > 0;
                if (!keptSize && Math.abs(want.w - r.width) + Math.abs(want.h - r.height) > 1) {
                    m.style.width = `${Math.round(want.w)}px`;
                    m.style.height = `${Math.round(want.h)}px`;
                }
                const b = { width: m.offsetWidth, height: m.offsetHeight };
                const step = ((this.n - 1) % 8) * 28;
                call('setModalOffsetsFromViewportTopLeft', m,
                    Math.max(0, Math.round((root.innerWidth - b.width) / 2) - 100 + step),
                    Math.max(0, Math.round((root.innerHeight - 35 - b.height) / 3) + step));
                this.start();
            };
            requestAnimationFrame(place);
            setTimeout(place, 80);
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: TITLE, terminate: () => this.close(), relaunch: () => root.openMelatonAdminTerminal() });
            }
        }

        /** xterm in the host, fitted, then the shell with the fitted size. */
        start() {
            if (this.term || this.closed) return;
            const Terminal = root.Terminal;
            const Fit = root.FitAddon && root.FitAddon.FitAddon;
            if (typeof Terminal !== 'function' || typeof Fit !== 'function') {
                this.host.textContent = 'The terminal component could not be loaded.';
                return;
            }
            const term = new Terminal({
                fontFamily: FONT,
                fontSize: FONT_SIZE,
                lineHeight: 1,
                letterSpacing: 0,
                cols: START_COLS,
                rows: START_ROWS,
                scrollback: 5000,
                cursorStyle: 'underline',
                cursorBlink: false,
                theme: consoleTheme(),
                allowProposedApi: false,
                macOptionIsMeta: true,
                ariaLabel: TITLE
            });
            const fit = new Fit();
            term.loadAddon(fit);
            term.open(this.host);
            this.term = term;
            this.fit = fit;
            const refit = () => {
                if (this.closed || !this.host.clientWidth || !this.host.clientHeight) return;
                try { fit.fit(); } catch (_) { /* hidden or gone */ }
            };
            this.refit = refit;
            refit();
            // the fonts decide the cell size: measure again when they are there (xterm remeasures on its own, the fit follows)
            if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(refit, () => {});
            if (typeof ResizeObserver === 'function') {
                const ro = new ResizeObserver(refit);
                ro.observe(this.host);
                this.signal.addEventListener('abort', () => ro.disconnect(), { once: true });
            }
            // every size the fit finds goes to the pty
            term.onResize(({ cols, rows }) => { if (this.opened && !this.exited) this.send('admin_terminal_resize', { cols, rows }); });
            term.onData((data) => { if (this.opened && !this.exited) this.send('admin_terminal_input', { data }); else if (this.exited) this.close(); });
            term.attachCustomKeyEventHandler((ev) => this.onKey(ev));
            this.host.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                if (term.hasSelection()) this.copy();
            }, { signal: this.signal });
            const c = root.wsClient;
            if (c && typeof c.on === 'function') {
                c.on('admin_terminal_output', (msg) => this.onOutput(msg && msg.data), { signal: this.signal });
                c.on('admin_terminal_exit', (msg) => this.onExit(msg && msg.data), { signal: this.signal });
            }
            term.focus();
            void this.spawn();
        }

        send(type, data) {
            const c = root.wsClient;
            if (!c || typeof c.send !== 'function') return false;
            return c.send(Object.assign({ type, id: this.id }, data));
        }

        async spawn() {
            const c = root.wsClient;
            try {
                if (!c || typeof c.sendMessage !== 'function') throw new Error('Not connected to Dreamscape');
                await c.sendMessage('admin_terminal_open', { id: this.id, cols: this.term.cols, rows: this.term.rows }, false);
                if (this.closed) { this.send('admin_terminal_close', {}); return; }
                this.opened = true;
                // a window resized while the shell started
                if (this.fit) { this.refit(); this.send('admin_terminal_resize', { cols: this.term.cols, rows: this.term.rows }); }
            } catch (err) {
                if (this.closed) return;
                this.exited = true;
                this.term.write(`\x1b[31m${String((err && err.message) || 'The shell could not be started').replace(/[\x00-\x1f]/g, ' ')}\x1b[0m\r\n[Process exited]`);
            }
        }

        onOutput(d) {
            if (!d || d.id !== this.id || !this.term || this.closed || typeof d.data !== 'string') return;
            const n = d.data.length;
            this.writing += 1;
            // the ack tells the server this output is on screen: it pauses the shell when the page falls behind
            this.term.write(d.data, () => {
                this.writing -= 1;
                this.ackPending += n;
                if (this.ackPending >= ACK_AT || this.writing === 0) this.sendAck();
            });
        }

        sendAck() {
            if (!this.ackPending || this.closed) return;
            const chars = this.ackPending;
            this.ackPending = 0;
            this.send('admin_terminal_ack', { chars });
        }

        onExit(d) {
            if (!d || d.id !== this.id || this.exited || this.closed) return;
            this.exited = true;
            this.term.write('\r\n[Process exited]');
            // a console closes when its shell ends: a moment to read it, or any key
            const t = setTimeout(() => this.close(), EXIT_CLOSE_MS);
            this.signal.addEventListener('abort', () => clearTimeout(t), { once: true });
        }

        copy() {
            const text = this.term.getSelection();
            if (!text) return;
            try { void navigator.clipboard.writeText(text); } catch (_) { /* not allowed here */ }
            this.term.clearSelection();
        }

        /** xterm's key hook: false = xterm leaves the key alone (the browser does its own, a paste event reaches xterm). */
        onKey(ev) {
            if (ev.type !== 'keydown') return true;
            const k = ev.key;
            if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (k === 'c' || k === 'C')) {
                // Ctrl+C copies a selection, otherwise it is the shell's interrupt; Ctrl+Shift+C always copies
                if (ev.shiftKey || this.term.hasSelection()) { this.copy(); return false; }
                return true;
            }
            // paste: the browser's paste event reaches xterm (bracketed paste included)
            if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (k === 'v' || k === 'V')) return false;
            return true;
        }

        close() {
            if (this.closed) return;
            const m = this.modal;
            this.teardown(true);
            Promise.resolve(call('closeModal', m)).finally(() => setTimeout(() => m.remove(), 400));
        }

        /** End the shell (the window closing, the socket's page going) and every listener. Safe to call twice. */
        teardown(killShell) {
            if (this.closed) return;
            this.closed = true;
            if (killShell && this.opened && !this.exited) this.send('admin_terminal_close', {});
            this.ctl.abort();
            if (this.term) { try { this.term.dispose(); } catch (_) { /* gone */ } this.term = null; }
            if (root.programFaults && root.programFaults.unregisterProgram) {
                try { root.programFaults.unregisterProgram(this.modal.id); } catch (_) { /* optional */ }
            }
        }
    }

    function openMelatonAdminTerminal() {
        const t = new AdminTerminal();
        t.show();
        return t.modal;
    }

    root.openMelatonAdminTerminal = openMelatonAdminTerminal;
})(window);
