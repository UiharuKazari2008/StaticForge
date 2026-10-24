/**
 * WordPad (Yozora #632), Vista's wordpad.exe as a Melaton system package (apps/wordpad).
 *
 *   the window    File / Edit / View / Insert / Format / Help, the toolbar (New, Open, Save, Print,
 *                 Print Preview, Find, Cut, Copy, Paste, Undo, Date/Time), the format bar (font,
 *                 size, script, Bold, Italic, Underline, Color, the alignments, Bullets), the ruler,
 *                 the page, the status bar
 *   documents     Rich Text Format (.rtf: fonts, sizes, bold / italic / underline / strike, colours,
 *                 alignment, indents, bullets, pictures as \pngblip) and Text (.txt); opened from
 *                 Documents or from Cartograph (launch args { file }), saved back to the VFS
 *   dialogs       Vista's own: Find, Replace, Font, Page Setup (comdlg32), Date and Time, Paragraph
 *
 *   melatonApps.define('wordpad', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Applets\\Wordpad';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const ICON16 = '/static_images/app_icons/16/vista-wordpad.webp';
    const ICON24 = '/static_images/app_icons/24/vista-wordpad.webp';
    const CMD = '/static_images/vista-cmdbar';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const vfs = () => root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef

    const FONTS = ['Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
    const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
    const SCRIPTS = ['Western', 'Greek', 'Turkish', 'Baltic', 'Central European', 'Cyrillic', 'Vietnamese'];
    const COLORS = [['#000000', 'Black'], ['#800000', 'Maroon'], ['#008000', 'Green'], ['#808000', 'Olive'], ['#000080', 'Navy'], ['#800080', 'Purple'], ['#008080', 'Teal'], ['#808080', 'Gray'], ['#c0c0c0', 'Silver'], ['#ff0000', 'Red'], ['#00ff00', 'Lime'], ['#ffff00', 'Yellow'], ['#0000ff', 'Blue'], ['#ff00ff', 'Fuchsia'], ['#00ffff', 'Aqua'], ['#ffffff', 'White']];

    // ---- RTF -> HTML ---------------------------------------------------------------------------

    const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'generator', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'filetbl', 'revtbl', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'fldinst', 'pntext', 'pntxta', 'pntxtb', 'listtext', 'object', 'nonshppict', 'bkmkstart', 'bkmkend', 'mmathPr', 'wgrffmtfilter', 'pgdsctbl', 'userprops', 'docvar']);

    /** Rich Text to HTML (what WordPad shows): runs of character formatting inside paragraphs. */
    function rtfToHtml(rtf) {
        const s = String(rtf || '');
        let i = 0;
        const fonts = {};
        const colors = [null];
        let deff = 0;
        const stack = [];
        let st = { b: 0, i: 0, ul: 0, strike: 0, f: null, fs: 24, cf: 0, skip: false, uc: 1 };
        let para = { align: 'left', li: 0, fi: 0, bullet: false };
        const paras = [];
        let runs = [];
        let text = '';
        let pending = 0; // \uN's fallback characters still to skip
        const flushText = () => {
            if (!text) return;
            runs.push({ text, st: { ...st } });
            text = '';
        };
        const endPara = () => {
            flushText();
            paras.push({ ...para, runs });
            runs = [];
        };
        const readWord = () => {
            let w = '';
            while (i < s.length && /[a-zA-Z]/.test(s[i])) w += s[i++];
            let num = '';
            if (s[i] === '-' || /\d/.test(s[i] || '')) { num += s[i++]; while (i < s.length && /\d/.test(s[i])) num += s[i++]; }
            if (s[i] === ' ') i += 1;
            return { w, n: num === '' ? null : parseInt(num, 10) };
        };
        // the font and colour tables are read where they are
        const readTable = (name) => {
            let depth = 1;
            const start = i;
            while (i < s.length && depth > 0) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === '{') depth += 1; else if (s[i] === '}') depth -= 1; i += 1; }
            const body = s.slice(start, i - 1);
            if (name === 'fonttbl') {
                body.replace(/\\f(\d+)[^;{}]*?(?:\\fcharset\d+)?[^;{}]*?\s([^;{}\\]+);/g, (_, n, nm) => { fonts[n] = nm.trim(); return ''; });
                body.replace(/\{\\f(\d+)[^}]*?([^\\;{}]+);\}/g, (_, n, nm) => { if (!fonts[n]) fonts[n] = nm.trim(); return ''; });
            } else if (name === 'colortbl') {
                body.split(';').slice(0, -1).forEach((c, k) => {
                    if (k === 0 && !/\\red/.test(c)) return;
                    const r = (/\\red(\d+)/.exec(c) || [0, 0])[1];
                    const g = (/\\green(\d+)/.exec(c) || [0, 0])[1];
                    const b = (/\\blue(\d+)/.exec(c) || [0, 0])[1];
                    colors.push(`rgb(${r},${g},${b})`);
                });
            }
        };
        const readPict = () => {
            // {\pict\pngblip\picw..\pich..\picwgoal..\pichgoal.. HEX}
            let depth = 1;
            let kind = '';
            let wg = 0;
            let hg = 0;
            let hex = '';
            while (i < s.length && depth > 0) {
                const ch = s[i];
                if (ch === '\\') {
                    i += 1;
                    const { w, n } = readWord();
                    if (w === 'pngblip') kind = 'png';
                    else if (w === 'jpegblip') kind = 'jpeg';
                    else if (w === 'picwgoal') wg = n;
                    else if (w === 'pichgoal') hg = n;
                    continue;
                }
                if (ch === '{') { depth += 1; i += 1; continue; }
                if (ch === '}') { depth -= 1; i += 1; continue; }
                if (/[0-9a-fA-F]/.test(ch)) hex += ch;
                i += 1;
            }
            if (!kind || !hex) return;
            let bin = '';
            for (let k = 0; k + 1 < hex.length; k += 2) bin += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
            flushText();
            runs.push({ img: `data:image/${kind};base64,${btoa(bin)}`, w: wg ? Math.round(wg / 15) : 0, h: hg ? Math.round(hg / 15) : 0 });
        };
        while (i < s.length) {
            const ch = s[i];
            if (ch === '{') {
                flushText();
                stack.push({ ...st });
                i += 1;
                // a destination: {\*\name ...} or a known table
                if (s[i] === '\\') {
                    const save = i;
                    i += 1;
                    if (s[i] === '*') {
                        // {\*\pn ...}: Word's bullet description (the paragraph is a list item)
                        if (/^\\pn/.test(s.slice(i + 1, i + 4))) para.bullet = true;
                        st.skip = true;
                        i += 1;
                        continue;
                    }
                    const { w } = readWord();
                    if (w === 'fonttbl' || w === 'colortbl') { readTable(w); st = stack.pop(); continue; }
                    if (w === 'pict') { readPict(); st = stack.pop(); continue; }
                    if (SKIP.has(w)) { st.skip = true; }
                    i = save;
                }
                continue;
            }
            if (ch === '}') { flushText(); st = stack.pop() || st; i += 1; continue; }
            if (ch === '\\') {
                i += 1;
                const c2 = s[i];
                if (c2 === '\\' || c2 === '{' || c2 === '}') { if (!st.skip) text += c2; i += 1; continue; }
                if (c2 === "'") { const h = s.substr(i + 1, 2); i += 3; if (pending) { pending -= 1; continue; } if (!st.skip) text += new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(h, 16)])); continue; }
                if (c2 === '~') { i += 1; if (!st.skip) text += '\u00a0'; continue; }
                if (c2 === '-' || c2 === '_') { i += 1; continue; }
                if (c2 === '\n' || c2 === '\r') { i += 1; if (!st.skip) endPara(); continue; }
                const { w, n } = readWord();
                if (st.skip) continue;
                const on = n === null ? 1 : n;
                const fmt = () => flushText();
                switch (w) {
                    case 'par': endPara(); break;
                    case 'line': fmt(); runs.push({ br: true }); break;
                    case 'tab': text += '\t'; break;
                    case 'pard': para = { align: 'left', li: 0, fi: 0, bullet: false }; break;
                    case 'plain': fmt(); Object.assign(st, { b: 0, i: 0, ul: 0, strike: 0, f: null, fs: 24, cf: 0 }); break;
                    case 'b': fmt(); st.b = on; break;
                    case 'i': fmt(); st.i = on; break;
                    case 'ul': fmt(); st.ul = on; break;
                    case 'ulnone': fmt(); st.ul = 0; break;
                    case 'strike': fmt(); st.strike = on; break;
                    case 'f': fmt(); st.f = n; break;
                    case 'deff': deff = n; break;
                    case 'fs': fmt(); st.fs = n || 24; break;
                    case 'cf': fmt(); st.cf = n || 0; break;
                    case 'qc': para.align = 'center'; break;
                    case 'qr': para.align = 'right'; break;
                    case 'qj': para.align = 'justify'; break;
                    case 'ql': para.align = 'left'; break;
                    case 'li': para.li = n || 0; break;
                    case 'fi': para.fi = n || 0; break;
                    case 'pn': case 'pnlvlblt': para.bullet = true; break;
                    case 'bullet': text += '\u2022'; break;
                    case 'emdash': text += '\u2014'; break;
                    case 'endash': text += '\u2013'; break;
                    case 'lquote': text += '\u2018'; break;
                    case 'rquote': text += '\u2019'; break;
                    case 'ldblquote': text += '\u201c'; break;
                    case 'rdblquote': text += '\u201d'; break;
                    case 'uc': st.uc = n || 0; break;
                    case 'u': { let code = n; if (code < 0) code += 65536; text += String.fromCharCode(code); pending = st.uc; break; }
                    default:
                }
                continue;
            }
            if (ch === '\r' || ch === '\n') { i += 1; continue; }
            if (pending) { pending -= 1; i += 1; continue; }
            if (!st.skip) text += ch;
            i += 1;
        }
        if (text || runs.length) endPara();
        // a paragraph list to HTML; bulleted paragraphs in a <ul>
        let html = '';
        let inList = false;
        paras.forEach((p) => {
            const inner = p.runs.map((r) => {
                if (r.br) return '<br>';
                if (r.img) return `<img src="${r.img}"${r.w ? ` width="${r.w}"` : ''}${r.h ? ` height="${r.h}"` : ''} alt="">`;
                const t = r.st;
                const font = fonts[t.f === null ? deff : t.f];
                const css = [font ? `font-family:'${font.replace(/'/g, '')}'` : '', t.fs !== 24 ? `font-size:${t.fs / 2}pt` : '', t.cf && colors[t.cf] ? `color:${colors[t.cf]}` : ''].filter(Boolean).join(';');
                let h = esc(r.text).replace(/\t/g, '<span class="wpad-tab">\t</span>');
                if (t.b) h = `<b>${h}</b>`;
                if (t.i) h = `<i>${h}</i>`;
                if (t.ul) h = `<u>${h}</u>`;
                if (t.strike) h = `<s>${h}</s>`;
                return css ? `<span style="${css}">${h}</span>` : h;
            }).join('') || '<br>';
            const pcss = [p.align !== 'left' ? `text-align:${p.align}` : '', p.li ? `margin-left:${p.li / 15}px` : '', p.fi ? `text-indent:${p.fi / 15}px` : ''].filter(Boolean).join(';');
            if (p.bullet) {
                if (!inList) { html += '<ul>'; inList = true; }
                html += `<li${pcss ? ` style="${pcss}"` : ''}>${inner}</li>`;
                return;
            }
            if (inList) { html += '</ul>'; inList = false; }
            html += `<p${pcss ? ` style="${pcss}"` : ''}>${inner}</p>`;
        });
        if (inList) html += '</ul>';
        return html;
    }

    // ---- HTML -> RTF ---------------------------------------------------------------------------

    function rtfText(t) {
        let out = '';
        for (const ch of t) {
            const c = ch.codePointAt(0);
            if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
            else if (ch === '\t') out += '\\tab ';
            else if (ch === '\u00a0') out += '\\~';
            else if (c < 128) out += ch;
            else if (c < 0x10000) out += `\\u${c > 32767 ? c - 65536 : c}?`;
            else { const s = String.fromCodePoint(c); out += `\\u${s.charCodeAt(0) - 65536}?\\u${s.charCodeAt(1) - 65536}?`; }
        }
        return out;
    }

    /** The page's content as RTF: each block a paragraph, each text run with its computed look. */
    function htmlToRtf(rootEl) {
        const fonts = [];
        const colors = [];
        const fontIx = (f) => { const name = String(f || 'Calibri').split(',')[0].replace(/["']/g, '').trim(); let k = fonts.indexOf(name); if (k < 0) { fonts.push(name); k = fonts.length - 1; } return k; };
        const colorIx = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); const key = m ? `${m[1]},${m[2]},${m[3]}` : '0,0,0'; if (key === '0,0,0') return 0; let k = colors.indexOf(key); if (k < 0) { colors.push(key); k = colors.length - 1; } return k + 1; };
        const body = [];
        const blocks = [];
        const isBlock = (el) => el.nodeType === 1 && /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(el.tagName);
        // the page's direct blocks (loose text and inline nodes make one block)
        const collect = (parent) => {
            let loose = null;
            parent.childNodes.forEach((n) => {
                if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) { loose = null; n.querySelectorAll(':scope > li').forEach((li) => blocks.push({ el: li, bullet: true })); return; }
                if (isBlock(n)) { loose = null; if (n.querySelector('p, div, ul, ol')) collect(n); else blocks.push({ el: n }); return; }
                if (!loose) { loose = { nodes: [] }; blocks.push(loose); }
                loose.nodes.push(n);
            });
        };
        collect(rootEl);
        blocks.forEach((b) => {
            const el = b.el || b.nodes[0].parentNode;
            const cs = getComputedStyle(b.el || rootEl);
            const align = { center: '\\qc', right: '\\qr', justify: '\\qj' }[cs.textAlign] || '\\ql';
            const li = Math.round((parseFloat(cs.marginLeft) || 0) * 15);
            const fi = Math.round((parseFloat(cs.textIndent) || 0) * 15);
            let p = `\\pard${align}${li ? `\\li${li}` : ''}${fi ? `\\fi${fi}` : ''}`;
            if (b.bullet) p += '{\\pntext\\f0\\\'B7\\tab}{\\*\\pn\\pnlvlblt\\pnf0\\pnindent360{\\pntxtb\\\'B7}}\\fi-360\\li720 ';
            else p += ' ';
            const walk = (n) => {
                if (n.nodeType === 3) {
                    if (!n.nodeValue) return;
                    const e = n.parentElement;
                    const c = getComputedStyle(e);
                    const deco = `${c.textDecorationLine || c.textDecoration}`;
                    const fmt = `\\f${fontIx(c.fontFamily)}\\fs${Math.round(parseFloat(c.fontSize) * 0.75 * 2)}${Number(c.fontWeight) >= 600 || c.fontWeight === 'bold' ? '\\b' : '\\b0'}${c.fontStyle === 'italic' ? '\\i' : '\\i0'}${/underline/.test(deco) ? '\\ul' : '\\ulnone'}${/line-through/.test(deco) ? '\\strike' : '\\strike0'}\\cf${colorIx(c.color)}`;
                    p += `{${fmt} ${rtfText(n.nodeValue)}}`;
                    return;
                }
                if (n.nodeType !== 1) return;
                if (n.tagName === 'BR') { p += '\\line '; return; }
                if (n.tagName === 'IMG') { p += pictOf(n); return; }
                n.childNodes.forEach(walk);
            };
            (b.el ? [...b.el.childNodes] : b.nodes).forEach(walk);
            void el;
            body.push(`${p}\\par`);
        });
        const ftbl = (fonts.length ? fonts : ['Calibri']).map((f, k) => `{\\f${k}\\fnil\\fcharset0 ${f};}`).join('');
        const ctbl = `{\\colortbl ;${colors.map((c) => { const [r, g, b] = c.split(','); return `\\red${r}\\green${g}\\blue${b};`; }).join('')}}`;
        return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1033{\\fonttbl${ftbl}}\r\n${ctbl}\r\n{\\*\\generator Melaton WordPad 6.0;}\\viewkind4\\uc1\r\n${body.join('\r\n')}\r\n}\r\n`;
    }

    /** A picture as \pict\pngblip (WordPad's own way to keep one). */
    function pictOf(img) {
        try {
            const c = doc.createElement('canvas');
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            const bin = atob(c.toDataURL('image/png').split(',')[1]);
            let hex = '';
            for (let k = 0; k < bin.length; k += 1) { hex += bin.charCodeAt(k).toString(16).padStart(2, '0'); if (k % 64 === 63) hex += '\r\n'; }
            const w = img.width || c.width;
            const h = img.height || c.height;
            return `{\\pict\\pngblip\\picw${c.width}\\pich${c.height}\\picwgoal${w * 15}\\pichgoal${h * 15}\r\n${hex}}`;
        } catch (_) { return ''; }
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    function workspaceRoot() {
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'Default'; // eslint-disable-line no-undef
        return `/Workspaces/${ws}`;
    }

    // ---- the window ----------------------------------------------------------------------------

    let seq = 0;

    class WordPad {
        constructor(app, file) {
            this.app = app;
            this.n = ++seq;
            this.file = null; // { id, name, path }
            this.name = 'Document';
            this.kind = 'rtf';
            this.dirty = false;
            this.build();
            if (file && file.id) void this.openFile(file);
        }

        build() {
            const W = Math.min(root.innerWidth - 40, 860);
            const H = Math.min(root.innerHeight - 80, 640);
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window wpad-window';
            m.dataset.windowIdentifier = 'melatonWordPad';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = ICON24;
            m.dataset.windowDefaultWidth = String(W);
            m.dataset.windowDefaultHeight = String(H);
            m.dataset.windowMinWidth = '420';
            m.dataset.windowMinHeight = '300';
            m.style.width = `${W}px`;
            m.style.height = `${H}px`;
            m.setAttribute('role', 'dialog');
            const tb = (a, img, title) => `<button type="button" class="wpad-tb" data-a="${a}" title="${esc(title)}"><img src="${CMD}/${img}.png" alt=""></button>`;
            const fb = (a, i, title) => `<button type="button" class="wpad-tb" data-a="${a}" title="${esc(title)}"><span class="wpad-art" style="--i:${i}"></span></button>`;
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span class="wpad-title">Document - WordPad</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small wpad-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 wpad-client">
                    <div class="naxt-menubar wpad-menubar" role="menubar">${['File', 'Edit', 'View', 'Insert', 'Format', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-wpad-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}</div>
                    <div class="wpad-bar wpad-toolbar" role="toolbar">
                        ${tb('new', 'new', 'New')}${tb('open', 'folder', 'Open')}${tb('save', 'save', 'Save')}<span class="wpad-sep"></span>
                        ${tb('print', 'document', 'Print')}${tb('preview', 'find', 'Print Preview')}<span class="wpad-sep"></span>
                        ${tb('find', 'find', 'Find')}<span class="wpad-sep"></span>
                        ${tb('cut', 'cut', 'Cut')}${tb('copy', 'copy', 'Copy')}${tb('paste', 'paste', 'Paste')}${tb('undo', 'undo', 'Undo')}<span class="wpad-sep"></span>
                        ${tb('datetime', 'clock', 'Date/Time')}
                    </div>
                    <div class="wpad-bar wpad-formatbar" role="toolbar">
                        <select class="wpad-font" title="Font">${FONTS.map((f) => `<option>${f}</option>`).join('')}</select>
                        <select class="wpad-size" title="Font Size">${SIZES.map((s) => `<option>${s}</option>`).join('')}</select>
                        <select class="wpad-script" title="Script">${SCRIPTS.map((s) => `<option>${s}</option>`).join('')}</select>
                        <span class="wpad-sep"></span>
                        ${fb('bold', 0, 'Bold')}${fb('italic', 1, 'Italic')}${fb('underline', 2, 'Underline')}
                        <button type="button" class="wpad-tb wpad-color" data-a="color" title="Color"><span class="wpad-art" style="--i:3"></span><span class="wpad-color-bar"></span></button>
                        <span class="wpad-sep"></span>
                        ${fb('left', 4, 'Align Left')}${fb('center', 5, 'Center')}${fb('right', 6, 'Align Right')}<span class="wpad-sep"></span>${fb('bullets', 7, 'Bullets')}
                    </div>
                    <div class="wpad-ruler"><div class="wpad-ruler-in"></div></div>
                    <div class="wpad-stage"><div class="wpad-page" contenteditable="true" spellcheck="false"><p><br></p></div></div>
                    <div class="wpad-status"><span class="wpad-status-text">For Help, press F1</span><span class="wpad-status-num"></span></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.page = m.querySelector('.wpad-page');
            this.el = (q) => m.querySelector(q);
            const p = this.page;
            p.style.fontFamily = 'Calibri';
            p.style.fontSize = '11pt';
            try { doc.execCommand('styleWithCSS', false, true); } catch (_) { /* old engines */ }
            this.wire();
            this.applyView();
            this.drawRuler();
            // before openModal: an id-less window restores the shared 'unknown' geometry
            m.id = `melatonWordPadModal_${this.n}`;
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed) return;
                placed = true;
                const r = m.getBoundingClientRect();
                const k = (this.n - 1) * 24;
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2) + k), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2) + k));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: 'WordPad', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'wordpad' }) });
            }
            this.title();
            setTimeout(() => this.page.focus(), 100);
        }

        wire() {
            const m = this.modal;
            m.querySelector('.wpad-close').addEventListener('click', () => void this.close());
            m.querySelectorAll('[data-wpad-menu]').forEach((t) => {
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.wpadMenu); } }]
                });
            });
            // the toolbar keeps the page's selection: its buttons take no focus
            m.querySelectorAll('.wpad-tb').forEach((b) => {
                b.addEventListener('mousedown', (ev) => ev.preventDefault());
                if (b.dataset.a !== 'color') b.addEventListener('click', () => void this.action(b.dataset.a));
            });
            root.contextMenu.attachClickMenuToElement(m.querySelector('.wpad-color'), {
                onAction: (a) => void this.action(a),
                sections: [{ type: 'list', initfn: (s) => { s.items = COLORS.map(([c, t]) => ({ text: t, action: `color-${c}` })).concat([{ separator: true }, { text: 'Automatic', action: 'color-auto' }]); } }]
            });
            const keepSel = () => { const s = root.getSelection(); if (s && s.rangeCount && this.page.contains(s.anchorNode)) this.saved = s.getRangeAt(0).cloneRange(); };
            this.page.addEventListener('keyup', keepSel);
            this.page.addEventListener('mouseup', keepSel);
            doc.addEventListener('selectionchange', () => { if (this.modal.isConnected && this.page.contains(doc.activeElement === this.page ? (root.getSelection() || {}).anchorNode : null)) { keepSel(); this.syncBars(); } });
            const restore = () => { if (this.saved) { const s = root.getSelection(); s.removeAllRanges(); s.addRange(this.saved); } };
            m.querySelector('.wpad-font').addEventListener('change', (ev) => { restore(); this.exec('fontName', ev.target.value); });
            m.querySelector('.wpad-size').addEventListener('change', (ev) => { restore(); this.setSize(Number(ev.target.value)); });
            this.page.addEventListener('input', () => this.touched());
            this.page.addEventListener('paste', (ev) => {
                // pictures paste as pictures; other HTML as plain text, so the page keeps WordPad's look
                const dt = ev.clipboardData;
                if (!dt) return;
                const imgItem = [...dt.items].find((x) => x.type.startsWith('image/'));
                if (imgItem) {
                    ev.preventDefault();
                    const f = imgItem.getAsFile();
                    const r = new FileReader();
                    r.onload = () => this.exec('insertImage', r.result);
                    r.readAsDataURL(f);
                    return;
                }
                const txt = dt.getData('text/plain');
                if (txt && dt.types.includes('text/html')) { ev.preventDefault(); this.exec('insertText', txt); }
            });
            m.addEventListener('keydown', (ev) => {
                const ctrl = ev.ctrlKey || ev.metaKey;
                let a = null;
                const k = ev.key.toLowerCase();
                if (ctrl && !ev.shiftKey && !ev.altKey) a = { n: 'new', o: 'open', s: 'save', p: 'print', f: 'find', h: 'replace', b: 'bold', i: 'italic', u: 'underline', e: 'center', l: 'left', r: 'right', a: 'select-all' }[k] || null;
                else if (ev.key === 'F3') a = 'find-next';
                else if (ev.key === 'F1') a = 'help';
                if (!a) return;
                ev.preventDefault();
                ev.stopPropagation();
                void this.action(a);
            });
        }

        exec(cmd, val) {
            this.page.focus();
            try { doc.execCommand(cmd, false, val); } catch (_) { /* not here */ }
            this.touched();
            this.syncBars();
        }

        /** A size in points on the selection (execCommand knows only 1-7: size 7, then put the points in). */
        setSize(pt) {
            this.exec('fontSize', 7);
            const made = [];
            this.page.querySelectorAll('font[size="7"]').forEach((f) => { const sp = doc.createElement('span'); sp.style.fontSize = `${pt}pt`; sp.innerHTML = f.innerHTML; f.replaceWith(sp); made.push(sp); });
            this.page.querySelectorAll('span').forEach((sp) => { if (sp.style.fontSize === 'xxx-large') { sp.style.fontSize = `${pt}pt`; made.push(sp); } });
            // the text stays selected (its old nodes were replaced), so the next command takes it too
            if (made.length) {
                const r = doc.createRange();
                r.setStartBefore(made[0]);
                r.setEndAfter(made[made.length - 1]);
                const s = root.getSelection();
                s.removeAllRanges();
                s.addRange(r);
                this.saved = r.cloneRange();
            }
            this.touched();
        }

        syncBars() {
            const s = root.getSelection();
            if (!s || !s.rangeCount || !this.page.contains(s.anchorNode)) return;
            const el = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
            const cs = getComputedStyle(el);
            const font = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
            const f = this.el('.wpad-font');
            if (!FONTS.includes(font) && !f.querySelector(`option[value="${CSS.escape(font)}"]`)) f.insertAdjacentHTML('beforeend', `<option>${esc(font)}</option>`);
            f.value = font;
            const pt = Math.round(parseFloat(cs.fontSize) * 0.75);
            const sz = this.el('.wpad-size');
            if (![...sz.options].some((o) => Number(o.value) === pt)) sz.insertAdjacentHTML('beforeend', `<option>${pt}</option>`);
            sz.value = String(pt);
            const q = (c) => { try { return doc.queryCommandState(c); } catch (_) { return false; } };
            const on = { bold: q('bold'), italic: q('italic'), underline: q('underline'), left: q('justifyLeft'), center: q('justifyCenter'), right: q('justifyRight'), bullets: q('insertUnorderedList') };
            this.modal.querySelectorAll('.wpad-formatbar [data-a]').forEach((b) => b.classList.toggle('is-on', !!on[b.dataset.a]));
            this.el('.wpad-color-bar').style.background = cs.color;
        }

        touched() {
            if (!this.dirty) { this.dirty = true; this.title(); }
        }

        title() {
            const t = `${this.name} - WordPad`;
            this.el('.wpad-title').textContent = t;
            this.modal.setAttribute('aria-label', t);
        }

        applyView() {
            ['Toolbar', 'FormatBar', 'Ruler', 'StatusBar'].forEach((k) => {
                const hide = reg(k, true) === false;
                const sel = { Toolbar: '.wpad-toolbar', FormatBar: '.wpad-formatbar', Ruler: '.wpad-ruler', StatusBar: '.wpad-status' }[k];
                this.el(sel).hidden = hide;
            });
            const wrap = reg('Wrap', 'ruler');
            this.modal.dataset.wrap = wrap;
        }

        /** The ruler: inches, a tick every eighth, numbers at each inch (WordPad's). */
        drawRuler() {
            const host = this.el('.wpad-ruler-in');
            let html = '';
            for (let k = 0; k <= 8 * 7; k += 1) {
                const x = k * 12;
                const cls = k % 8 === 0 ? 'is-inch' : k % 4 === 0 ? 'is-half' : 'is-eighth';
                html += `<span class="wpad-tick ${cls}" style="left:${x}px">${k % 8 === 0 && k ? k / 8 : ''}</span>`;
            }
            host.innerHTML = html;
        }

        menu(name) {
            const sel = (() => { const s = root.getSelection(); return !!(s && !s.isCollapsed && this.page.contains(s.anchorNode)); })();
            switch (name) {
                case 'file': return [
                    { text: 'New...', subtext: 'Ctrl+N', action: 'new' }, { text: 'Open...', subtext: 'Ctrl+O', action: 'open' },
                    { text: 'Save', subtext: 'Ctrl+S', action: 'save' }, { text: 'Save As...', action: 'save-as' },
                    { separator: true },
                    { text: 'Print...', subtext: 'Ctrl+P', action: 'print' }, { text: 'Print Preview', action: 'preview' }, { text: 'Page Setup...', action: 'page-setup' },
                    { separator: true },
                    { text: 'Send...', action: 'send' },
                    { separator: true },
                    { text: 'Exit', action: 'exit' }
                ];
                case 'edit': return [
                    { text: 'Undo', subtext: 'Ctrl+Z', action: 'undo' },
                    { separator: true },
                    { text: 'Cut', subtext: 'Ctrl+X', action: 'cut', disabled: !sel }, { text: 'Copy', subtext: 'Ctrl+C', action: 'copy', disabled: !sel },
                    { text: 'Paste', subtext: 'Ctrl+V', action: 'paste' }, { text: 'Clear', subtext: 'Del', action: 'clear', disabled: !sel },
                    { text: 'Select All', subtext: 'Ctrl+A', action: 'select-all' },
                    { separator: true },
                    { text: 'Find...', subtext: 'Ctrl+F', action: 'find' }, { text: 'Find Next', subtext: 'F3', action: 'find-next' }, { text: 'Replace...', subtext: 'Ctrl+H', action: 'replace' }
                ];
                case 'view': return [
                    { text: 'Toolbar', action: 'view-Toolbar', showIndicator: true, checked: reg('Toolbar', true) !== false },
                    { text: 'Format Bar', action: 'view-FormatBar', showIndicator: true, checked: reg('FormatBar', true) !== false },
                    { text: 'Ruler', action: 'view-Ruler', showIndicator: true, checked: reg('Ruler', true) !== false },
                    { text: 'Status Bar', action: 'view-StatusBar', showIndicator: true, checked: reg('StatusBar', true) !== false },
                    { separator: true },
                    { text: 'Options...', action: 'options' }
                ];
                case 'insert': return [{ text: 'Date and Time...', action: 'datetime' }, { text: 'Object...', action: 'object' }];
                case 'format': return [
                    { text: 'Font...', action: 'font' }, { text: 'Bullet Style', action: 'bullets', showIndicator: true, checked: (() => { try { return doc.queryCommandState('insertUnorderedList'); } catch (_) { return false; } })() },
                    { text: 'Paragraph...', action: 'paragraph' }
                ];
                case 'help': return [{ text: 'Help Topics', action: 'help' }, { separator: true }, { text: 'About WordPad', action: 'about' }];
                default: return [];
            }
        }

        async action(a) {
            if (a.startsWith('color-')) { const c = a.slice(6); this.restoreSel(); this.exec('foreColor', c === 'auto' ? '#000000' : c); return; }
            if (a.startsWith('view-')) { const k = a.slice(5); setReg({ [k]: reg(k, true) === false }); this.applyView(); return; }
            switch (a) {
                case 'new': await this.newDoc(); return;
                case 'open': await this.openDialog(); return;
                case 'save': await this.save(); return;
                case 'save-as': await this.saveAs(); return;
                case 'print': case 'preview': this.print(a === 'preview'); return;
                case 'page-setup': this.pageSetup(); return;
                case 'send': await this.send(); return;
                case 'exit': await this.close(); return;
                case 'undo': this.exec('undo'); return;
                case 'cut': this.exec('cut'); return;
                case 'copy': this.exec('copy'); return;
                case 'paste': {
                    this.page.focus();
                    try {
                        const items = await navigator.clipboard.read();
                        for (const it of items) {
                            const img = it.types.find((t) => t.startsWith('image/'));
                            if (img) { const b = await it.getType(img); this.exec('insertImage', `data:${img};base64,${await blobToBase64(b)}`); return; }
                            if (it.types.includes('text/plain')) { this.exec('insertText', await (await it.getType('text/plain')).text()); return; }
                        }
                    } catch (_) { this.exec('paste'); }
                    return;
                }
                case 'clear': this.exec('delete'); return;
                case 'select-all': this.page.focus(); this.exec('selectAll'); return;
                case 'find': case 'replace': this.findDialog(a === 'replace'); return;
                case 'find-next': if (this.lastFind) this.findNext(this.lastFind); else this.findDialog(false); return;
                case 'bold': this.exec('bold'); return;
                case 'italic': this.exec('italic'); return;
                case 'underline': this.exec('underline'); return;
                case 'left': this.exec('justifyLeft'); return;
                case 'center': this.exec('justifyCenter'); return;
                case 'right': this.exec('justifyRight'); return;
                case 'bullets': this.exec('insertUnorderedList'); return;
                case 'datetime': this.dateTime(); return;
                case 'object': this.insertPicture(); return;
                case 'font': this.fontDialog(); return;
                case 'paragraph': this.paragraphDialog(); return;
                case 'options': this.optionsDialog(); return;
                case 'help': void this.message('WordPad edits Rich Text documents (.rtf) and text files (.txt).\nFormat bar: font, size, bold, italic, underline, colour, alignment and bullets.'); return;
                case 'about': if (typeof root.openAboutMelatoninModal === 'function') root.openAboutMelatoninModal({ program: 'WordPad' }); return;
                default:
            }
        }

        restoreSel() {
            if (!this.saved) return;
            const s = root.getSelection();
            s.removeAllRanges();
            s.addRange(this.saved);
        }

        // ---- files -------------------------------------------------------------------------

        message(text, buttons) {
            return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'WordPad', width: 400 });
        }

        /** Vista: "Do you want to save changes to Document?" Yes / No / Cancel. */
        async confirmDiscard() {
            if (!this.dirty) return true;
            const v = await this.message(`Do you want to save changes to ${this.name}?`, [
                { text: 'Save', value: 'yes', className: 'btn-standard primary' }, { text: "Don't Save", value: 'no', className: 'btn-standard' }, { text: 'Cancel', value: 'cancel', className: 'btn-standard' }
            ]);
            if (v === 'yes') return this.save();
            return v === 'no';
        }

        async newDoc() {
            if (!await this.confirmDiscard()) return;
            // Vista asks the new document's type first
            const V = root.vistaDialogTemplate;
            const kind = await new Promise((resolve) => {
                if (!V) { resolve('rtf'); return; }
                const tpl = { t: 'New', w: 150, h: 92, f: ['MS Shell Dlg', 8], c: [[-1, 'S', 7, 7, 136, 8, 0x50020000, '&New document type:', 0], [101, 'S', 7, 18, 136, 50, 0x5000000e, '', 0], [1, 'B', 39, 72, 50, 14, 0x50010001, 'OK', 0], [2, 'B', 93, 72, 50, 14, 0x50010000, 'Cancel', 0]] };
                let pick = 'rtf';
                V.openDialog({
                    id: 'wpadNew', tpl, owner: this.modal,
                    init: (ctx) => {
                        const host = ctx.el(101);
                        if (!host) return;
                        host.classList.add('wpad-list');
                        const draw = () => { host.innerHTML = [['rtf', 'Rich Text Document'], ['txt', 'Text Document']].map(([k, t]) => `<div class="wpad-list-item${pick === k ? ' is-sel' : ''}" data-k="${k}">${t}</div>`).join(''); };
                        draw();
                        host.addEventListener('click', (ev) => { const r = ev.target.closest('[data-k]'); if (r) { pick = r.dataset.k; draw(); } });
                        host.addEventListener('dblclick', () => { const ok = ctx.el(1); if (ok) ok.click(); });
                    },
                    ok: () => { resolve(pick); return true; },
                    cancel: () => resolve(null),
                    close: () => resolve(null)
                });
            });
            if (!kind) return;
            this.page.innerHTML = '<p><br></p>';
            this.kind = kind;
            this.file = null;
            this.name = 'Document';
            this.dirty = false;
            this.title();
            this.page.focus();
        }

        openDialog() {
            if (typeof root.studioOpenFolderDialog !== 'function') return Promise.resolve();
            return new Promise((resolve) => {
                void root.studioOpenFolderDialog('open-vfs', {
                    owner: this.modal,
                    startPath: workspaceRoot(),
                    host: {
                        title: 'Open',
                        typeLabel: 'All Documents (*.rtf, *.txt)',
                        rejectMessage: 'Choose a Rich Text or text document',
                        acceptItem: (item) => !!item && item.targetKind === 'user-file' && /\.(rtf|txt|text|log|md)$/i.test(item.name || ''),
                        onOpen: async (item, folderPath) => {
                            if (await this.confirmDiscard()) await this.openFile({ id: item.targetId || item.id, name: item.name, path: folderPath });
                            resolve();
                        }
                    }
                });
            });
        }

        async openFile(f) {
            try {
                const r = await vfs().downloadFile(f.id);
                const buf = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).arrayBuffer();
                const text = new TextDecoder('utf-8').decode(buf);
                if (/^\s*\{\\rtf/.test(text)) {
                    // RTF is 7-bit; its 8-bit runs (\'hh) are decoded by the parser
                    this.page.innerHTML = rtfToHtml(new TextDecoder('latin1').decode(buf)) || '<p><br></p>';
                    this.kind = 'rtf';
                } else {
                    this.page.innerHTML = text.split(/\r?\n/).map((l) => `<p>${l ? esc(l) : '<br>'}</p>`).join('') || '<p><br></p>';
                    this.kind = 'txt';
                }
                this.file = { id: f.id, name: f.name, path: f.path || workspaceRoot() };
                this.name = f.name;
                this.dirty = false;
                this.title();
            } catch (err) {
                await this.message(`WordPad cannot open ${f.name}.\n${(err && err.message) || err}`);
            }
        }

        encode(kind) {
            if (kind === 'txt') {
                const lines = [];
                this.page.querySelectorAll(':scope > p, :scope > div, :scope > ul > li, :scope > ol > li').forEach((b) => lines.push(b.innerText.replace(/\n$/, '')));
                const txt = lines.length ? lines.join('\r\n') : this.page.innerText;
                return { blob: new Blob([txt], { type: 'text/plain' }), mime: 'text/plain' };
            }
            return { blob: new Blob([htmlToRtf(this.page)], { type: 'application/rtf' }), mime: 'application/rtf' };
        }

        async save() {
            if (!this.file || !this.file.id) return this.saveAs();
            try {
                const { blob, mime } = this.encode(this.kind);
                await vfs().replaceFile(this.file.id, await blobToBase64(blob), mime);
                this.dirty = false;
                this.title();
                return true;
            } catch (err) {
                await this.message(`WordPad cannot save ${this.name}.\n${(err && err.message) || err}`);
                return false;
            }
        }

        saveAs() {
            if (typeof root.studioOpenFolderDialog !== 'function') return Promise.resolve(false);
            const self = this;
            return new Promise((resolve) => {
                void root.studioOpenFolderDialog('save', {
                    owner: this.modal,
                    startPath: (this.file && this.file.path) || workspaceRoot(),
                    host: {
                        title: 'Save As',
                        typeLabel: 'Rich Text Format (RTF) (*.rtf); Text Document (*.txt)',
                        acceptType: 'user-file',
                        suggestName: () => (self.file ? self.file.name : `Document.${self.kind === 'txt' ? 'txt' : 'rtf'}`),
                        async onSave(info) {
                            let name = String(info.name || '').trim();
                            if (!name) return false;
                            if (!/\.(rtf|txt)$/i.test(name)) name += self.kind === 'txt' ? '.txt' : '.rtf';
                            const kind = /\.txt$/i.test(name) ? 'txt' : 'rtf';
                            if (kind === 'txt' && self.kind === 'rtf' && self.page.querySelector('b, i, u, s, span[style], img, ul, [style*="text-align"]')) {
                                const v = await self.message(`You are about to save the document in a Text-Only format, which will remove all formatting. Are you sure you want to do this?`, [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }]);
                                if (!v) return false;
                            }
                            try {
                                const { blob, mime } = self.encode(kind);
                                const res = await vfs().uploadFile(info.path || '/', await blobToBase64(blob), name, mime);
                                const f = res && (res.file || res.entry || res);
                                self.file = { id: (f && (f.id || f.fileId)) || null, name, path: info.path };
                                self.name = name;
                                self.kind = kind;
                                self.dirty = false;
                                self.title();
                                resolve(true);
                                return true;
                            } catch (err) {
                                await self.message(`WordPad cannot save ${name}.\n${(err && err.message) || err}`);
                                resolve(false);
                                return false;
                            }
                        },
                        onCancel() { resolve(false); }
                    }
                });
            });
        }

        async send() {
            const open = typeof doveOpenComposeWindow === 'function' ? doveOpenComposeWindow : root.doveOpenComposeWindow; // eslint-disable-line no-undef
            if (typeof open !== 'function') { await this.message('Dovecote is not available to send the document.'); return; }
            const { blob, mime } = this.encode(this.kind);
            const name = this.file ? this.file.name : `Document.${this.kind === 'txt' ? 'txt' : 'rtf'}`;
            open({ mode: 'create', to: '', subject: name, body: '', attachments: [{ name, mimeType: mime, size: blob.size, base64: await blobToBase64(blob) }] });
        }

        // ---- printing ------------------------------------------------------------------------

        pageSetup() {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            V.openDialog({
                id: 'wpadPageSetup', key: 'comdlg32:1546', owner: this.modal,
                init: (ctx) => {
                    ctx.options(1137, ['Letter', 'A4', 'Legal'], reg('Paper', 'Letter'));
                    ctx.options(1138, ['Automatically Select'], 'Automatically Select');
                    ctx.set(reg('Landscape', false) ? 1057 : 1056, true);
                    [[1155, 'MarginLeft', 1.25], [1157, 'MarginRight', 1.25], [1156, 'MarginTop', 1], [1158, 'MarginBottom', 1]].forEach(([id, k, d]) => ctx.set(id, String(reg(k, d))));
                },
                ok: (ctx) => {
                    setReg({ Paper: String(ctx.get(1137) || 'Letter'), Landscape: !!ctx.get(1057), MarginLeft: Number(ctx.get(1155)) || 1.25, MarginRight: Number(ctx.get(1157)) || 1.25, MarginTop: Number(ctx.get(1156)) || 1, MarginBottom: Number(ctx.get(1158)) || 1 });
                    return true;
                }
            });
        }

        print(preview) {
            const m = { l: reg('MarginLeft', 1.25), r: reg('MarginRight', 1.25), t: reg('MarginTop', 1), b: reg('MarginBottom', 1) };
            const size = `${reg('Paper', 'Letter') === 'A4' ? 'A4' : reg('Paper', 'Letter') === 'Legal' ? 'legal' : 'letter'} ${reg('Landscape', false) ? 'landscape' : 'portrait'}`;
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(this.name)}</title><style>@page{size:${size};margin:${m.t}in ${m.r}in ${m.b}in ${m.l}in}body{margin:0;font:11pt Calibri,sans-serif}p{margin:0}ul{margin:0}</style></head><body>${this.page.innerHTML}</body></html>`;
            if (preview) {
                const w = root.open('', '_blank', 'width=820,height=900');
                if (w) { w.document.write(html); w.document.close(); }
                return;
            }
            const f = doc.createElement('iframe');
            f.style.cssText = 'position:fixed;left:-10000px;width:900px;height:700px;border:0';
            doc.body.appendChild(f);
            f.contentWindow.document.write(html);
            f.contentWindow.document.close();
            setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) { /* no printing here */ } setTimeout(() => f.remove(), 2000); }, 300);
        }

        // ---- find / replace ----------------------------------------------------------------------

        findDialog(replace) {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const sel = root.getSelection();
            const seed = sel && !sel.isCollapsed && this.page.contains(sel.anchorNode) ? sel.toString() : (this.lastFind && this.lastFind.what) || '';
            V.openDialog({
                id: replace ? 'wpadReplace' : 'wpadFind', key: replace ? 'comdlg32:1541' : 'comdlg32:1540', owner: this.modal,
                init: (ctx) => { ctx.set(1152, seed); if (!replace) ctx.set(1057, true); },
                buttons: {
                    1: (ctx) => { this.lastFind = { what: String(ctx.get(1152) || ''), whole: !!ctx.get(1040), mcase: !!ctx.get(1041), up: !replace && !!ctx.get(1056) }; this.findNext(this.lastFind); },
                    1024: (ctx) => {
                        const f = { what: String(ctx.get(1152) || ''), whole: !!ctx.get(1040), mcase: !!ctx.get(1041) };
                        this.lastFind = f;
                        const s = root.getSelection();
                        if (s && !s.isCollapsed && this.matches(s.toString(), f)) this.exec('insertText', String(ctx.get(1153) || ''));
                        this.findNext(f);
                    },
                    1025: (ctx) => {
                        const f = { what: String(ctx.get(1152) || ''), whole: !!ctx.get(1040), mcase: !!ctx.get(1041) };
                        const s = root.getSelection();
                        s.removeAllRanges();
                        const r = doc.createRange();
                        r.setStart(this.page, 0);
                        r.collapse(true);
                        s.addRange(r);
                        let n = 0;
                        while (this.findNext(f, true) && n < 10000) { this.exec('insertText', String(ctx.get(1153) || '')); n += 1; }
                        this.status(`${n} replacement${n === 1 ? '' : 's'}`);
                    },
                    1038: () => void this.action('help')
                }
            });
        }

        matches(text, f) {
            return f.mcase ? text === f.what : text.toLowerCase() === f.what.toLowerCase();
        }

        /** The next match after the selection (before it, upwards): selected; false when none. */
        findNext(f, quiet) {
            if (!f.what) return false;
            const walker = doc.createTreeWalker(this.page, NodeFilter.SHOW_TEXT);
            const nodes = [];
            let all = '';
            while (walker.nextNode()) { nodes.push({ n: walker.currentNode, at: all.length }); all += walker.currentNode.nodeValue; }
            const hay = f.mcase ? all : all.toLowerCase();
            const needle = f.mcase ? f.what : f.what.toLowerCase();
            const s = root.getSelection();
            const offsetOf = (node, off) => { const e = nodes.find((x) => x.n === node); return e ? e.at + off : 0; };
            let from = 0;
            if (s && s.rangeCount && this.page.contains(s.anchorNode)) { const r = s.getRangeAt(0); from = f.up ? offsetOf(r.startContainer, r.startOffset) : offsetOf(r.endContainer, r.endOffset); }
            const isWord = (k) => !/[\w\u00c0-\u024f]/.test(hay[k] || ' ');
            let k = -1;
            let at = from;
            for (let tries = 0; tries < 10000; tries += 1) {
                k = f.up ? hay.lastIndexOf(needle, at - 1 - (tries ? 0 : 0)) : hay.indexOf(needle, at);
                if (k < 0) break;
                if (!f.whole || (isWord(k - 1) && isWord(k + needle.length))) break;
                at = f.up ? k : k + 1;
            }
            if (k < 0) {
                if (!quiet) void this.message(`WordPad has finished searching the document.`);
                return false;
            }
            const pos = (p) => { for (let j = nodes.length - 1; j >= 0; j -= 1) if (nodes[j].at <= p) return { node: nodes[j].n, off: p - nodes[j].at }; return { node: nodes[0].n, off: 0 }; };
            const a = pos(k);
            const b = pos(k + needle.length);
            const r = doc.createRange();
            r.setStart(a.node, Math.min(a.off, a.node.length));
            r.setEnd(b.node, Math.min(b.off, b.node.length));
            s.removeAllRanges();
            s.addRange(r);
            const el = a.node.parentElement;
            if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
            return true;
        }

        status(t) { const s = this.el('.wpad-status-text'); if (s) s.textContent = t || 'For Help, press F1'; }

        // ---- insert / format dialogs ---------------------------------------------------------------

        dateTime() {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const D = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const h12 = d.getHours() % 12 || 12;
            const ap = d.getHours() < 12 ? 'AM' : 'PM';
            const formats = [`${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`, `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`, `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(2)}`,
                `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`, `${String(d.getFullYear()).slice(2)}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
                `${d.getDate()}-${M[d.getMonth()].slice(0, 3)}-${String(d.getFullYear()).slice(2)}`, `${D[d.getDay()]}, ${M[d.getMonth()]} ${pad(d.getDate())}, ${d.getFullYear()}`, `${M[d.getMonth()]} ${pad(d.getDate())}, ${d.getFullYear()}`,
                `${D[d.getDay()]}, ${pad(d.getDate())} ${M[d.getMonth()]}, ${d.getFullYear()}`, `${pad(d.getDate())} ${M[d.getMonth()]}, ${d.getFullYear()}`,
                `${h12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ap}`, `${pad(h12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ap}`, `${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`];
            const tpl = { t: 'Date and Time', w: 180, h: 166, f: ['MS Shell Dlg', 8], c: [[-1, 'S', 7, 7, 166, 8, 0x50020000, '&Available formats:', 0], [101, 'S', 7, 18, 166, 124, 0x5000000e, '', 0], [1, 'B', 69, 146, 50, 14, 0x50010001, 'OK', 0], [2, 'B', 123, 146, 50, 14, 0x50010000, 'Cancel', 0]] };
            let pick = 0;
            V.openDialog({
                id: 'wpadDate', tpl, owner: this.modal,
                init: (ctx) => {
                    const host = ctx.el(101);
                    if (!host) return;
                    host.classList.add('wpad-list');
                    const draw = () => { host.innerHTML = formats.map((t, k) => `<div class="wpad-list-item${k === pick ? ' is-sel' : ''}" data-k="${k}">${esc(t)}</div>`).join(''); };
                    draw();
                    host.addEventListener('click', (ev) => { const r = ev.target.closest('[data-k]'); if (r) { pick = Number(r.dataset.k); draw(); } });
                    host.addEventListener('dblclick', () => { const ok = ctx.el(1); if (ok) ok.click(); });
                },
                ok: () => { this.restoreSel(); this.exec('insertText', formats[pick]); return true; }
            });
        }

        /** Insert > Object: a picture from Documents or the gallery (WordPad's Paintbrush Picture). */
        insertPicture() {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            const keep = this.saved;
            void root.studioOpenFolderDialog('open-vfs', {
                owner: this.modal,
                startPath: workspaceRoot(),
                host: {
                    title: 'Insert Object',
                    rejectMessage: 'Choose a picture',
                    acceptItem: (item) => !!item && (item.targetKind === 'image' || (item.targetKind === 'user-file' && /^image\//.test(item.mimeType || ''))),
                    onOpen: async (item) => {
                        let url = item.targetKind === 'user-file' ? (await vfs().downloadFile(item.targetId || item.id)).downloadUrl : `/images/${encodeURIComponent(item.previewImageFilename || item.targetId || item.name)}`;
                        // a data: URL so the picture is kept in the document (and saved into the RTF)
                        const img = new Image();
                        img.src = url;
                        await img.decode();
                        const k = Math.min(1, 600 / img.naturalWidth);
                        const c = doc.createElement('canvas');
                        c.width = Math.round(img.naturalWidth * k);
                        c.height = Math.round(img.naturalHeight * k);
                        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                        url = c.toDataURL('image/png');
                        this.saved = keep;
                        this.restoreSel();
                        this.exec('insertImage', url);
                    }
                }
            });
        }

        /** Format > Font: comdlg32's Font dialog on the selection. */
        fontDialog() {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const s = root.getSelection();
            const el = s && s.anchorNode ? (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode) : this.page;
            const cs = getComputedStyle(this.page.contains(el) ? el : this.page);
            const font = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
            const bold = Number(cs.fontWeight) >= 600;
            const italic = cs.fontStyle === 'italic';
            const style = bold && italic ? 'Bold Italic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
            const pt = Math.round(parseFloat(cs.fontSize) * 0.75);
            V.openDialog({
                id: 'wpadFont', key: 'comdlg32:1543', owner: this.modal,
                init: (ctx) => {
                    ctx.options(1136, FONTS, FONTS.includes(font) ? font : 'Calibri');
                    ctx.options(1137, ['Regular', 'Italic', 'Bold', 'Bold Italic'], style);
                    ctx.options(1138, SIZES.map(String), String(pt));
                    ctx.options(1139, COLORS.map(([, t]) => t), 'Black');
                    ctx.options(1140, SCRIPTS, 'Western');
                    const sample = () => {
                        const e = ctx.el(1092);
                        if (!e) return;
                        const st = String(ctx.get(1137) || 'Regular');
                        e.style.fontFamily = `'${ctx.get(1136)}'`;
                        e.style.fontSize = `${ctx.get(1138)}pt`;
                        e.style.fontWeight = /Bold/.test(st) ? 'bold' : 'normal';
                        e.style.fontStyle = /Italic/.test(st) ? 'italic' : 'normal';
                        e.style.textDecoration = `${ctx.get(1041) ? 'underline' : ''} ${ctx.get(1040) ? 'line-through' : ''}`.trim() || 'none';
                        const c = COLORS.find(([, t]) => t === ctx.get(1139));
                        e.style.color = c ? c[0] : '#000';
                    };
                    [1136, 1137, 1138, 1139, 1040, 1041].forEach((id) => ctx.on(id, 'change', sample));
                    sample();
                },
                ok: (ctx) => {
                    this.restoreSel();
                    const st = String(ctx.get(1137) || 'Regular');
                    this.exec('fontName', String(ctx.get(1136)));
                    this.setSize(Number(ctx.get(1138)) || 11);
                    const q = (c) => { try { return doc.queryCommandState(c); } catch (_) { return false; } };
                    if (/Bold/.test(st) !== q('bold')) this.exec('bold');
                    if (/Italic/.test(st) !== q('italic')) this.exec('italic');
                    if (!!ctx.get(1041) !== q('underline')) this.exec('underline');
                    if (!!ctx.get(1040) !== q('strikeThrough')) this.exec('strikeThrough');
                    const c = COLORS.find(([, t]) => t === ctx.get(1139));
                    if (c) this.exec('foreColor', c[0]);
                    return true;
                }
            });
        }

        /** Format > Paragraph: indents (inches) and the alignment of the paragraph the caret is in. */
        paragraphDialog() {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const s = root.getSelection();
            let block = s && s.anchorNode ? (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode) : null;
            while (block && block !== this.page && !/^(P|DIV|LI)$/.test(block.tagName)) block = block.parentElement;
            if (!block || block === this.page) block = this.page.querySelector('p');
            if (!block) return;
            const cs = getComputedStyle(block);
            const inch = (px) => (Math.round(((parseFloat(px) || 0) / 96) * 100) / 100).toString();
            const tpl = { t: 'Paragraph', w: 200, h: 100, f: ['MS Shell Dlg', 8], c: [
                [-1, 'B', 7, 4, 130, 62, 0x50000007, 'Indentation', 0],
                [-1, 'S', 14, 18, 50, 8, 0x50020000, '&Left:', 0], [101, 'E', 70, 16, 50, 12, 0x50810080, '', 0],
                [-1, 'S', 14, 34, 50, 8, 0x50020000, '&Right:', 0], [102, 'E', 70, 32, 50, 12, 0x50810080, '', 0],
                [-1, 'S', 14, 50, 50, 8, 0x50020000, '&First line:', 0], [103, 'E', 70, 48, 50, 12, 0x50810080, '', 0],
                [-1, 'S', 7, 74, 40, 8, 0x50020000, '&Alignment:', 0], [104, 'C', 50, 72, 87, 80, 0x50210003, '', 0],
                [1, 'B', 143, 7, 50, 14, 0x50010001, 'OK', 0], [2, 'B', 143, 25, 50, 14, 0x50010000, 'Cancel', 0]
            ] };
            V.openDialog({
                id: 'wpadPara', tpl, owner: this.modal,
                init: (ctx) => {
                    ctx.set(101, `${inch(cs.marginLeft)}"`);
                    ctx.set(102, `${inch(cs.marginRight)}"`);
                    ctx.set(103, `${inch(cs.textIndent)}"`);
                    ctx.options(104, ['Left', 'Right', 'Center', 'Justify'], { center: 'Center', right: 'Right', justify: 'Justify' }[cs.textAlign] || 'Left');
                },
                ok: (ctx) => {
                    const px = (v) => `${Math.round((parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0) * 96)}px`;
                    block.style.marginLeft = px(ctx.get(101));
                    block.style.marginRight = px(ctx.get(102));
                    block.style.textIndent = px(ctx.get(103));
                    block.style.textAlign = String(ctx.get(104) || 'Left').toLowerCase();
                    this.touched();
                    return true;
                }
            });
        }

        /** View > Options: Vista's word wrap choices (No wrap, Wrap to window, Wrap to ruler). */
        optionsDialog() {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const tpl = { t: 'Options', w: 190, h: 86, f: ['MS Shell Dlg', 8], c: [
                [-1, 'B', 7, 4, 120, 56, 0x50000007, 'Word wrap', 0],
                [101, 'B', 14, 16, 100, 10, 0x50030009, '&No wrap', 0], [102, 'B', 14, 30, 100, 10, 0x50010009, 'Wrap to &window', 0], [103, 'B', 14, 44, 100, 10, 0x50010009, 'Wrap to &ruler', 0],
                [1, 'B', 133, 7, 50, 14, 0x50010001, 'OK', 0], [2, 'B', 133, 25, 50, 14, 0x50010000, 'Cancel', 0]
            ] };
            V.openDialog({
                id: 'wpadOptions', tpl, owner: this.modal,
                init: (ctx) => { ctx.set({ none: 101, window: 102, ruler: 103 }[reg('Wrap', 'ruler')] || 103, true); },
                ok: (ctx) => { setReg({ Wrap: ctx.get(101) ? 'none' : ctx.get(102) ? 'window' : 'ruler' }); this.applyView(); return true; }
            });
        }

        async close() {
            if (!await this.confirmDiscard()) return;
            this.tool.closeWindow(this);
        }

        destroy() {
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 300);
        }
    }

    // ---- the package: one window per launch; the app ends with its last window ------------------

    const windows = new Set();
    let appRef = null;

    const tool = {
        closeWindow(w) {
            w.destroy();
            windows.delete(w);
            if (!windows.size && appRef) appRef.exit();
        }
    };

    async function start(app) {
        if (root.featureLoader && !root.vistaDialogTemplate) { try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* no dialogs */ } }
        const file = app.args && app.args.file;
        // a second launch is a second window (WordPad runs one per document), in this app
        if (appRef && windows.size) {
            const w = new WordPad(appRef, file);
            w.tool = tool;
            windows.add(w);
            app.exit();
            return;
        }
        appRef = app;
        const w = new WordPad(app, file);
        w.tool = tool;
        windows.add(w);
        app.onExit(() => { windows.forEach((x) => x.destroy()); windows.clear(); appRef = null; });
    }

    root.melatonWordPad = { start, rtfToHtml, htmlToRtf, windows };
    if (typeof melatonApps !== 'undefined') melatonApps.define('wordpad', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
