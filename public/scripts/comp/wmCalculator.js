/**
 * Melaton Mobile: Calculator (WM 6.1 Professional's MobileCalculator), Yozora #732, parent #709.
 *
 * Measured on the Device Emulator (VGA halved; refs in ~/.cache/wm61/ref-apps/calc*.png): the memory
 * box (M when memory holds a value), the display and the back arrow on one 26 px row, then 6 x 4
 * round keys (35 px, 39 px apart, rows 45 px apart) drawn as GDI ellipses: white, 1 px black ring,
 * digits blue, C / memory / operators dark red; a pressed key is black with a white glyph.
 * Soft keys: Edit (Copy, Paste) and the input panel button; no right key.
 * Behaviour as the device: 10 significant digits, integers show a trailing dot, "Error" on a
 * division by zero (any key after it clears), operators chain left to right (2 + 3 x 4 = 20).
 * Programs lists it in place of the desktop's Calculator (wmPrograms.js MAPPED). Only on phones.
 * Styles: public/css/wm-calculator.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'calculator';
    const MAX_DIGITS = 10;
    let ws = null;
    let page = null;

    // ---------------------------------------------------------------- the engine

    const st = {
        entry: '0', // what is shown while typing (no trailing dot)
        value: 0, // the shown number once an operation produced it
        typing: false, // the display is an entry being typed
        acc: null, // the left operand waiting for its operator
        op: null, // '+', '-', '*', '/'
        lastOp: null, // repeat '=' (op and right operand)
        lastArg: null,
        memory: 0,
        error: false
    };

    function fmt(x) {
        if (!Number.isFinite(x)) return 'Error';
        if (x === 0) return '0.';
        const ax = Math.abs(x);
        // ten digit characters in all (the 0 of 0.333333333 counts, as on the device)
        const intLen = String(Math.trunc(ax)).length;
        if (ax >= 10 ** MAX_DIGITS || ax < 1e-9) {
            // too wide for 10 digits: scientific, the mantissa to fit
            const [m, e] = x.toExponential(MAX_DIGITS - 5).split('e');
            return `${m.replace(/\.?0+$/, '')}e${e}`;
        }
        let s = x.toFixed(Math.max(0, MAX_DIGITS - intLen));
        if (s.includes('.')) s = s.replace(/0+$/, '');
        if (/^-?0\.?$/.test(s)) return '0.';
        return s.includes('.') ? s : `${s}.`;
    }

    function shown() {
        if (st.error) return 'Error';
        if (st.typing) return st.entry.includes('.') ? st.entry : `${st.entry}.`;
        return fmt(st.value);
    }

    function current() {
        return st.typing ? Number(st.entry) : st.value;
    }

    function apply(a, op, b) {
        switch (op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return b === 0 ? NaN : a / b;
            default: return b;
        }
    }

    function setValue(x) {
        // results carry 10 significant digits, as shown
        if (!Number.isFinite(x)) { st.error = true; st.typing = false; return; }
        st.value = Number(x.toPrecision(MAX_DIGITS));
        st.typing = false;
    }

    function clearAll() {
        Object.assign(st, { entry: '0', value: 0, typing: false, acc: null, op: null, lastOp: null, lastArg: null, error: false });
    }

    function digit(d) {
        if (!st.typing) { st.entry = '0'; st.typing = true; }
        const digits = st.entry.replace(/[-.]/g, '').length;
        if (d === '.') {
            if (!st.entry.includes('.')) st.entry += '.';
            return;
        }
        if (digits >= MAX_DIGITS && !(st.entry === '0' || st.entry === '-0')) return;
        if (st.entry === '0') st.entry = d;
        else if (st.entry === '-0') st.entry = `-${d}`;
        else st.entry += d;
    }

    function operator(op) {
        const x = current();
        if (st.op && st.typing) setValue(apply(st.acc, st.op, x));
        else if (!st.op || st.typing) setValue(x);
        if (st.error) return;
        st.acc = st.value;
        st.op = op;
        st.lastOp = null;
    }

    function equals() {
        if (st.op) {
            const b = current();
            st.lastOp = st.op;
            st.lastArg = b;
            setValue(apply(st.acc, st.op, b));
            st.op = null;
            st.acc = null;
        } else if (st.lastOp) {
            setValue(apply(current(), st.lastOp, st.lastArg));
        } else setValue(current());
    }

    function unary(kind) {
        const x = current();
        if (kind === 'neg') {
            if (st.typing) { st.entry = st.entry.startsWith('-') ? st.entry.slice(1) : `-${st.entry}`; return; }
            setValue(-x);
            return;
        }
        if (kind === 'sqrt') setValue(x < 0 ? NaN : Math.sqrt(x));
        else if (kind === 'inv') setValue(x === 0 ? NaN : 1 / x);
        else if (kind === 'pct') setValue(st.op ? (st.acc * x) / 100 : x / 100);
    }

    function backspace() {
        if (!st.typing) return;
        st.entry = st.entry.slice(0, -1);
        if (st.entry === '' || st.entry === '-') st.entry = '0';
    }

    function press(k) {
        if (st.error) {
            // after Error any key starts over (C does only that)
            clearAll();
            if (k === 'c') { render(); return; }
        }
        if (/^[0-9.]$/.test(k)) digit(k);
        else if (k === '+' || k === '-' || k === '*' || k === '/') operator(k);
        else if (k === '=') equals();
        else if (k === 'c') clearAll();
        else if (k === 'back') backspace();
        else if (k === 'mc') st.memory = 0;
        else if (k === 'mr') { st.value = st.memory; st.typing = false; }
        else if (k === 'm+') { const x = current(); setValue(x); st.memory = Number((st.memory + st.value).toPrecision(MAX_DIGITS)); }
        else if (k === 'neg' || k === 'sqrt' || k === 'inv' || k === 'pct') unary(k);
        render();
    }

    // ---------------------------------------------------------------- the page

    // the device's key order, row by row; kind 'f' = dark red (C, memory, operators)
    const KEYS = [
        ['c', 'C', 'f'], ['7', '7', 'd'], ['8', '8', 'd'], ['9', '9', 'd'], ['/', '÷', 'f'], ['inv', '1/x', 'b'],
        ['mc', 'MC', 'f'], ['4', '4', 'd'], ['5', '5', 'd'], ['6', '6', 'd'], ['*', '×', 'f'], ['pct', '%', 'b'],
        ['mr', 'MR', 'f'], ['1', '1', 'd'], ['2', '2', 'd'], ['3', '3', 'd'], ['-', '-', 'f'], ['sqrt', '√‾', 'b'],
        ['m+', 'M+', 'f'], ['0', '0', 'd'], ['.', '.', 'd'], ['=', '=', 'f'], ['+', '+', 'f'], ['neg', '+/-', 'b']
    ];

    function render() {
        if (!page) return;
        page.querySelector('.wmc-display').textContent = shown();
        page.querySelector('.wmc-mem').textContent = st.memory !== 0 ? 'M' : '';
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-calculator');
        p.innerHTML = `
            <div class="wmc-top">
                <div class="wmc-mem" aria-label="Memory"></div>
                <div class="wmc-display" role="status" aria-live="polite">0.</div>
                <button type="button" class="wmc-back" data-k="back" aria-label="Backspace"><span class="wmc-back-arrow"></span></button>
            </div>
            <div class="wmc-keys">${KEYS.map(([k, label, kind]) => `<div class="wmc-cell"><button type="button" class="wmc-key is-${kind}${k === 'sqrt' ? ' is-sqrt' : ''}" data-k="${ws.escapeHtml(k)}" aria-label="${ws.escapeHtml(label)}"><span>${k === 'sqrt' ? '√<i></i>' : ws.escapeHtml(label)}</span></button></div>`).join('')}</div>`;
        // pressed = black while the stylus is down, the key acts on the press (as the device)
        p.addEventListener('pointerdown', (e) => {
            const b = e.target.closest('[data-k]');
            if (!b) return;
            b.classList.add('is-down');
            press(b.dataset.k);
        });
        const up = () => p.querySelectorAll('.is-down').forEach((b) => b.classList.remove('is-down'));
        p.addEventListener('pointerup', up);
        p.addEventListener('pointercancel', up);
        p.addEventListener('pointerleave', up);
        render();
    }

    // a hardware keyboard types into the calculator while it is the current app
    const KEYMAP = { Enter: '=', '=': '=', Backspace: 'back', Delete: 'c', '+': '+', '-': '-', '*': '*', x: '*', '/': '/', '%': 'pct', ',': '.', '.': '.' };
    function onKey(e) {
        if (!ws || ws.current !== APP_ID || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.querySelector('#wmShell .wm-popup, #wmShell .wm-msgbox-layer:not([hidden])')) return;
        const k = /^[0-9]$/.test(e.key) ? e.key : KEYMAP[e.key];
        if (!k) return;
        e.preventDefault();
        press(k);
    }

    async function copy() {
        const text = shown().replace(/\.$/, '');
        try { await navigator.clipboard.writeText(text); } catch (_) { /* no clipboard here */ }
    }

    async function paste() {
        let text = '';
        try { text = await navigator.clipboard.readText(); } catch (_) { return; }
        const n = Number(String(text).trim().replace(/,/g, ''));
        if (!Number.isFinite(n)) return;
        if (st.error) clearAll();
        st.value = Number(n.toPrecision(MAX_DIGITS));
        st.typing = false;
        render();
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: 'Calculator',
            icon: 'app-calculator',
            inStart: 'programs',
            sip: true,
            mount,
            show: render,
            softKeys() {
                return {
                    left: { label: 'Edit', menu: () => [{ label: 'Copy', action: copy }, { label: 'Paste', action: paste }] },
                    right: null
                };
            }
        });
        document.addEventListener('keydown', onKey);
    }

    window.wmCalculator = { press, shown: () => shown(), _state: st };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
