/**
 * Vista dialog templates, rendered (Yozora #632). Draws a DLGTEMPLATEEX from
 * vistaDialogTemplates.js (Vista's own .mui resources) with the property-sheet controls of
 * taskbar-properties.css (tbp-*), placed by dialog units the way MapDialogRect does on the Vista VM:
 *
 *   MS Shell Dlg 8 (Tahoma 11 px)   x * 6/4, y * 13/8      Segoe UI 9 (12 px)   x * 7/4, y * 15/8
 *   an edge rounds; a bottom edge drops its fraction; a push button's face is 1 px inside its rect
 *
 *   vistaDialogTemplate.openSheet({ id, title, pages: [{ key, title? }], start, owner, icon,
 *                                   init(ctx), apply(ctx) -> Promise?, close() })
 *       a property sheet: tabs, the pane, OK / Cancel / Apply. Apply turns on when a control
 *       changes; apply(ctx) runs on Apply and on OK.
 *   vistaDialogTemplate.openDialog({ id, key, title?, owner, init(ctx), ok(ctx) -> false keeps it open,
 *                                    cancel(ctx) })
 *       a plain dialog: the template's own buttons (IDOK 1, IDCANCEL 2)
 *   ctx.el(id[, pageKey])     the control's element (input, select, button, div)
 *   ctx.get(id) / ctx.set(id, value)   checked for check boxes and radios, value for the rest
 *   ctx.text(id, text)        a static's or a button's label
 *   ctx.options(id, list, value)       fill a combo box or a list box ([{ value, text }] or strings)
 *   ctx.on(id, event, fn)     ctx.dirty()  ctx.close()  ctx.modal  ctx.content
 *   ctx.page(key) / ctx.selectPage(key)
 *
 * Classes the template names but HTML has no control for (calendars, clocks, Mouse's button
 * picture) come out as an empty <div class="vdt-custom" data-class="..."> for the dialog's own
 * script to fill (cplDialogs.js).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;

    const WS_VISIBLE = 0x10000000;
    const WS_DISABLED = 0x08000000;
    const WS_GROUP = 0x00020000;
    const WS_VSCROLL = 0x00200000;
    const WS_BORDER = 0x00800000;
    const WS_EX_CLIENTEDGE = 0x200;
    const WS_EX_STATICEDGE = 0x20000;

    const SYSTEM_ICONS = {
        '#32513': '/static_images/vista-icons/msgbox-error-32.png',
        '#32514': '/static_images/vista-icons/msgbox-question-32.png',
        '#32515': '/static_images/vista-icons/msgbox-warning-32.png',
        '#32516': '/static_images/vista-icons/msgbox-info-32.png'
    };

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /** "&Apply" -> "<u>A</u>pply" (Vista's access keys; "&&" is a literal &). */
    function label(text, noPrefix) {
        const t = String(text == null ? '' : text);
        if (noPrefix) return esc(t);
        let out = '';
        for (let i = 0; i < t.length; i += 1) {
            const ch = t[i];
            if (ch === '&') {
                if (t[i + 1] === '&') { out += '&amp;'; i += 1; continue; }
                if (i + 1 < t.length) { out += `<u>${esc(t[i + 1])}</u>`; i += 1; continue; }
                continue;
            }
            out += ch === '\n' ? '<br>' : esc(ch);
        }
        return out.replace(/\t/g, ' ');
    }

    /** SysLink text: <a>...</a> (and <a id="x">) become links; the rest is text. A SysLink takes
     *  "&" as an access key too ("&How do I customize Sidebar?"), drawn without the underline. */
    function linkText(text) {
        return String(text || '').replace(/&(&?)/g, (m, lit) => (lit ? '\u0000' : '')).replace(/\u0000/g, '&').split(/(<a[^>]*>.*?<\/a>)/i).map((part) => {
            const m = /^<a([^>]*)>(.*?)<\/a>$/i.exec(part);
            if (!m) return esc(part);
            const idm = /id\s*=\s*"?([^"\s>]+)/i.exec(m[1]);
            return `<button type="button" class="tbp-link vdt-link"${idm ? ` data-link="${esc(idm[1])}"` : ''}>${esc(m[2])}</button>`;
        }).join('');
    }

    function units(tpl) {
        const face = (tpl.f && tpl.f[0]) || 'MS Shell Dlg';
        const pt = (tpl.f && tpl.f[1]) || 8;
        if (/segoe/i.test(face) && pt >= 9) return { xu: 7, yu: 15, font: '12px "Segoe UI", Tahoma, sans-serif', segoe: true };
        if (/segoe/i.test(face)) return { xu: 6, yu: 13, font: '11px "Segoe UI", Tahoma, sans-serif', segoe: true };
        return { xu: 6, yu: 13, font: '11px Tahoma, "Segoe UI", sans-serif', segoe: false };
    }

    function px(u, v, axis) {
        return Math.round((v * (axis === 'x' ? u.xu : u.yu)) / (axis === 'x' ? 4 : 8));
    }

    function rect(u, x, y, w, h) {
        const left = px(u, x, 'x');
        const top = px(u, y, 'y');
        const right = px(u, x + w, 'x');
        const bottom = Math.floor(((y + h) * u.yu) / 8);
        return { left, top, width: right - left, height: bottom - top };
    }

    /** A page or dialog's own size rounds (Folder Options' 230 DLU page is 374 px, not 373). */
    function size(tpl) {
        const u = units(tpl);
        return { width: px(u, tpl.w, 'x'), height: px(u, tpl.h, 'y') };
    }

    function style(r, inset = 0) {
        return `left:${r.left + inset}px;top:${r.top + inset}px;width:${r.width - 2 * inset}px;height:${r.height - 2 * inset}px;`;
    }

    // ---- one template's controls ---------------------------------------------------------------

    function renderControls(tpl, prefix, opts = {}) {
        const u = units(tpl);
        const over = opts.overrides || {};
        const out = [];
        let lastEdit = null; // { r, at } the edit an auto-buddy up-down attaches to
        let radioGroup = 0;
        let inRadios = false;
        tpl.c.forEach((c, index) => {
            const [id, cls, x, y, w, h, st, text, ex] = c;
            const o = over[id] || {};
            if (o.skip) return;
            const r = rect(u, x, y, w, h);
            // a program that moves its own control after load: [dx, dy, dw, dh] px from the VM
            if (o.nudge) { r.left += o.nudge[0]; r.top += o.nudge[1]; r.width += o.nudge[2]; r.height += o.nudge[3]; }
            const visible = (st & WS_VISIBLE) !== 0 && !o.hidden;
            const disabled = o.disabled === false ? false : (st & WS_DISABLED) !== 0 || o.disabled === true;
            const dataId = `data-vdt-id="${id}" data-vdt-index="${index}"`;
            const hid = visible ? '' : ' hidden';
            const dis = disabled ? ' disabled' : '';
            const t = o.text !== undefined ? o.text : text;
            const edge = (ex & WS_EX_CLIENTEDGE) || (st & WS_BORDER) ? ' vdt-edge' : '';
            const domId = `${prefix}-${id >= 0 ? id : `x${index}`}`;
            const lowType = st & 0xF;
            const isRadio = cls === 'B' && (lowType === 4 || lowType === 9);
            // radio buttons share a group until the next control with WS_GROUP (group boxes included)
            if (isRadio) {
                if (!inRadios || (st & WS_GROUP)) radioGroup += 1;
                inRadios = true;
            } else if (st & WS_GROUP) {
                inRadios = false;
            }
            if (o.html !== undefined) {
                out.push(`<div class="tbp-ctl vdt-html ${o.cls || ''}" style="${style(r)}" ${dataId}${hid}>${o.html}</div>`);
                return;
            }
            switch (cls) {
                case 'B': {
                    const multi = (st & 0x2000) || r.height > 16 ? ' vdt-multi' : '';
                    if (lowType === 7) {
                        out.push(`<div class="tbp-group" style="${style(r)}" ${dataId}${hid}>${t ? `<span class="tbp-group-label${disabled ? ' is-disabled' : ''}">${label(t)}</span>` : ''}</div>`);
                    } else if (lowType === 2 || lowType === 3 || lowType === 5 || lowType === 6) {
                        // BS_VCENTER (the default for a one-line box) centres the 13 px box
                        const top = (st & 0xC00) === 0x400 ? 0 : Math.max(0, Math.floor((r.height - 13) / 2));
                        out.push(`<div class="tbp-ctl tbp-check vdt-check${multi}" style="${style(r)}padding-top:${multi ? 0 : top}px;" ${dataId}${hid}><input type="checkbox" id="${domId}"${dis}><label for="${domId}"><span>${label(t)}</span></label></div>`);
                    } else if (isRadio) {
                        const top = (st & 0xC00) === 0x400 || multi ? 0 : Math.max(0, Math.floor((r.height - 13) / 2));
                        out.push(`<div class="tbp-ctl tbp-check vdt-check${multi}" style="${style(r)}padding-top:${top}px;" ${dataId}${hid}><input type="radio" id="${domId}" name="${prefix}-g${radioGroup}"${dis}><label for="${domId}"><span>${label(t)}</span></label></div>`);
                    } else {
                        const primary = lowType === 1 ? ' data-dialog-primary="1"' : '';
                        const img = (st & 0xC0) && o.image ? `<img src="${esc(o.image)}" alt="" draggable="false">` : '';
                        out.push(`<button type="button" class="tbp-ctl tbp-button vdt-button" id="${domId}" style="${style(r, 1)}" ${dataId}${primary}${hid}${dis}>${img}${img && !t ? '' : label(t)}</button>`);
                    }
                    break;
                }
                case 'S': {
                    const type = st & 0x1F;
                    const noPrefix = (st & 0x80) !== 0;
                    if (type === 3 || type === 0xE) {
                        // "#104": the icon resource of the template's own module, ripped to vista-dlg/;
                        // "#32513".."#32516" are user32's IDI_HAND / QUESTION / EXCLAMATION / ASTERISK
                        const sys = SYSTEM_ICONS[t];
                        const src = o.image || sys || (/^#\d+$/.test(t) && opts.module ? `/static_images/vista-dlg/${opts.module}-${t.slice(1)}.png` : '');
                        out.push(`<div class="tbp-ctl vdt-image" style="${style(r)}" ${dataId}${hid}>${src ? `<img src="${esc(src)}" alt="" draggable="false" onerror="this.style.visibility='hidden'">` : ''}</div>`);
                    } else if (type === 0x10) {
                        out.push(`<div class="tbp-ctl vdt-etched-h" style="${style(r)}height:2px;" ${dataId}${hid}></div>`);
                    } else if (type === 0x11) {
                        out.push(`<div class="tbp-ctl vdt-etched-v" style="${style(r)}width:2px;" ${dataId}${hid}></div>`);
                    } else if (type >= 4 && type <= 9 || type === 0x12) {
                        out.push(`<div class="tbp-ctl vdt-frame vdt-frame-${type}" style="${style(r)}" ${dataId}${hid}></div>`);
                    } else {
                        const align = type === 1 ? 'center' : type === 2 ? 'right' : 'left';
                        const nowrap = type === 0xB || type === 0xC ? ' vdt-nowrap' : '';
                        const sunken = (st & 0x1000) || (ex & WS_EX_STATICEDGE) ? ' vdt-sunken' : '';
                        // SS_CENTERIMAGE centres a one-line label in its height (WinCal Import's labels)
                        const middle = (st & 0x200) ? ' vdt-middle' : '';
                        out.push(`<div class="tbp-ctl tbp-static vdt-static${nowrap}${sunken}${middle}${disabled ? ' is-disabled' : ''}" style="${style(r)}text-align:${align};" ${dataId}${hid}>${t ? `<span class="vdt-st-text">${label(t, noPrefix)}</span>` : ''}</div>`);
                    }
                    break;
                }
                case 'E': {
                    const ro = (st & 0x800) ? ' readonly' : '';
                    const align = (st & 3) === 2 ? 'right' : (st & 3) === 1 ? 'center' : 'left';
                    if (st & 4) {
                        out.push(`<textarea class="tbp-ctl vdt-textarea${edge}" id="${domId}" style="${style(r)}text-align:${align};" ${dataId}${ro}${dis}${hid} spellcheck="false">${esc(t)}</textarea>`);
                    } else {
                        const type = (st & 0x20) ? 'password' : 'text';
                        lastEdit = { r, at: out.length, align };
                        out.push(`<input type="${type}" class="tbp-ctl tbp-edit vdt-edit${edge}" id="${domId}" style="${style(r)}text-align:${align};" value="${esc(t)}" ${dataId}${ro}${dis}${hid} spellcheck="false" autocomplete="off">`);
                        // an up-down the program attaches at run time (comdlg32's copies box): { spin: [min, max] }
                        if (o.spin) {
                            out[out.length - 1] = out[out.length - 1].replace('class="tbp-ctl tbp-edit vdt-edit', 'class="tbp-ctl tbp-edit vdt-edit vdt-buddy');
                            // the VM's: 17 px over the edit's right edge, its full height, two equal halves
                            const ur = { left: r.left + r.width - 17, top: r.top, width: 17, height: r.height };
                            const half = Math.floor(ur.height / 2);
                            out.push(`<div class="tbp-ctl vdt-updown vdt-spin-over" style="${style(ur)}" data-vdt-id="${id}-spin" data-min="${o.spin[0]}" data-max="${o.spin[1]}"${hid}><span class="tbp-spin tbp-spin-up vdt-up" style="height:${half}px;width:17px"></span><span class="tbp-spin tbp-spin-down vdt-down" style="height:${ur.height - half}px;width:17px"></span></div>`);
                        }
                    }
                    break;
                }
                case 'C': {
                    const kind = st & 3;
                    // a combo box is as tall as its font (21 px), not its template rect (the drop-down)
                    const cr = { ...r, height: 21 };
                    if (kind === 1) {
                        out.push(`<div class="tbp-ctl vdt-listbox${edge}" style="${style(r)}" ${dataId}${hid} tabindex="0"></div>`);
                    } else if (kind === 2) {
                        out.push(`<div class="tbp-ctl vdt-combo-edit" style="${style(cr)}" ${dataId}${hid}><input type="text" class="tbp-edit" id="${domId}" list="${domId}-list"${dis} spellcheck="false" autocomplete="off"><datalist id="${domId}-list"></datalist></div>`);
                    } else {
                        out.push(`<select class="tbp-ctl tbp-select vdt-select" id="${domId}" style="${style(cr)}" ${dataId}${dis}${hid}></select>`);
                    }
                    break;
                }
                case 'L':
                    out.push(`<div class="tbp-ctl vdt-listbox vdt-edge" style="${style(r)}" ${dataId}${hid} tabindex="0" role="listbox"></div>`);
                    break;
                case 'msctls_trackbar32': {
                    // TBS_VERT draws the horizontal bar turned a quarter left (the minimum at the
                    // bottom); TBS_BOTH has the flat 6x19 thumb (aero 789) with ticks on both sides
                    const vertical = (st & 2) !== 0;
                    const both = (st & 8) !== 0 ? ' vdt-both' : '';
                    const ticks = (st & 1) && !(st & 0x10) ? ' vdt-ticks' : '';
                    const inner = `<input type="range" id="${domId}" min="0" max="10" value="0"${dis}><span class="vdt-tickmarks"></span>${both ? '<span class="vdt-tickmarks vdt-tickmarks-top"></span>' : ''}`;
                    out.push(vertical
                        ? `<div class="tbp-ctl vdt-trackbar vdt-vertical${both}${ticks}" style="${style(r)}" ${dataId}${hid}><div class="vdt-rot" style="width:${r.height}px;height:${r.width}px;--vdt-cross:${r.width}px">${inner}</div></div>`
                        : `<div class="tbp-ctl vdt-trackbar${both}${ticks}" style="${style(r)}--vdt-cross:${r.height}px" ${dataId}${hid}>${inner}</div>`);
                    break;
                }
                case 'msctls_updown32': {
                    // UDS_AUTOBUDDY + UDS_ALIGNRIGHT: Vista draws the two 15 px faces inside the
                    // buddy edit's border, 2 px from its right and top (Customize Start Menu's spin box)
                    let ur = r;
                    if ((st & 0x10) && (st & 4) && lastEdit) {
                        const er = lastEdit.r;
                        ur = { left: er.left + er.width - 17, top: er.top + 2, width: 15, height: er.height - 4 };
                        out[lastEdit.at] = out[lastEdit.at].replace('class="tbp-ctl tbp-edit vdt-edit', 'class="tbp-ctl tbp-edit vdt-edit vdt-buddy');
                    }
                    const half = Math.floor(ur.height / 2);
                    out.push(`<div class="tbp-ctl vdt-updown" style="${style(ur)}" ${dataId}${hid}><span class="tbp-spin tbp-spin-up vdt-up" style="height:${half}px"></span><span class="tbp-spin tbp-spin-down vdt-down" style="height:${ur.height - half}px"></span></div>`);
                    break;
                }
                case 'msctls_progress32':
                    out.push(`<div class="tbp-ctl vdt-progress" role="progressbar" style="${style(r)}" ${dataId}${hid}><div class="vdt-progress-fill"></div></div>`);
                    break;
                case 'SysLink':
                    out.push(`<div class="tbp-ctl tbp-link-row vdt-syslink" style="${style(r)}" ${dataId}${hid}>${linkText(t)}</div>`);
                    break;
                case 'SysListView32': {
                    const report = (st & 3) === 1;
                    const noHeader = (st & 0x4000) !== 0;
                    out.push(`<div class="tbp-ctl vdt-listview vdt-edge${report ? ' is-report' : ''}${noHeader ? ' no-header' : ''}" style="${style(r)}" ${dataId}${hid} tabindex="0" role="listbox"><div class="vdt-lv-header"></div><div class="vdt-lv-body"></div></div>`);
                    break;
                }
                case 'SysDateTimePick32': {
                    // DTS_LONGDATEFORMAT 0x4, DTS_RIGHTALIGN 0x20 (the month calendar drops under the right edge)
                    const fmt = (st & 0xC) === 4 ? 'long' : 'short';
                    out.push(`<div class="tbp-ctl vdt-dtp" id="${domId}" style="${style(r)}" ${dataId} data-vdt-fmt="${fmt}"${st & 0x20 ? ' data-vdt-right="1"' : ''}${disabled ? ' aria-disabled="true"' : ''} tabindex="${disabled ? -1 : 0}"${hid}><span class="vdt-dtp-text"></span><span class="vdt-dtp-btn"><span class="vdt-dtp-glyph"></span></span></div>`);
                    break;
                }
                case 'SysTreeView32':
                    out.push(`<div class="tbp-ctl tbp-tree vdt-tree" style="${style(r)}" ${dataId}${hid} tabindex="0" role="tree"></div>`);
                    break;
                case 'RICHEDIT50W':
                    out.push(`<div class="tbp-ctl tbp-static vdt-static vdt-richedit" style="${style(r)}" ${dataId}${hid}>${esc(t)}</div>`);
                    break;
                default:
                    out.push(`<div class="tbp-ctl vdt-custom" data-class="${esc(cls)}" style="${style(r)}" ${dataId}${hid}></div>`);
                    break;
            }
        });
        return out.join('');
    }

    // ---- the date picker (SysDateTimePick32) and its month calendar (SysMonthCal32) -------------
    //
    // Measured on the Vista VM (WinCal's Print dialog): an edit-framed box with the date's fields
    // (one selected in the highlight colour while focused), the calendar button 34 px wide at the
    // right (hot / open faces, the glyph 7 px in), and a 223x158 drop-down: the month title with
    // arrows, Sun..Sat, six rows of 31x15 cells, today boxed in #0066cc, the selection filled, and
    // "Today: <date>" under it. Values are local Dates at midnight.

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const shortDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

    function dtpValue(el) {
        return new Date((el._vdtDate || dayOnly(new Date())).getTime());
    }

    function dtpFields(el) {
        const d = el._vdtDate || dayOnly(new Date());
        if (el.dataset.vdtFmt === 'long') {
            return [['w', DAYS[d.getDay()]], [',', ', '], ['m', MONTHS[d.getMonth()]], [' ', ' '], ['d', String(d.getDate())], [',', ', '], ['y', String(d.getFullYear())]];
        }
        return [['m', String(d.getMonth() + 1)], ['/', '/'], ['d', String(d.getDate())], ['/', '/'], ['y', String(d.getFullYear())]];
    }

    function dtpDraw(el) {
        const text = el.querySelector('.vdt-dtp-text');
        if (!text) return;
        const field = el._vdtField || 'm';
        const focused = doc.activeElement === el && !el.classList.contains('is-open');
        text.innerHTML = dtpFields(el).map(([k, v]) => (/[a-z]/.test(k)
            ? `<span class="vdt-dtp-field${focused && k === field ? ' is-selected' : ''}" data-f="${k}">${esc(v)}</span>`
            : `<span>${esc(v)}</span>`)).join('');
    }

    function dtpSet(el, value, quiet) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return;
        const next = dayOnly(d);
        const changed = !el._vdtDate || el._vdtDate.getTime() !== next.getTime();
        el._vdtDate = next;
        el._vdtTyped = '';
        dtpDraw(el);
        if (changed && !quiet) el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function dtpStep(el, field, delta) {
        const d = dtpValue(el);
        if (field === 'y') d.setFullYear(d.getFullYear() + delta);
        else if (field === 'm') {
            const day = d.getDate();
            d.setDate(1);
            d.setMonth(d.getMonth() + delta);
            d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
        } else d.setDate(d.getDate() + delta);
        dtpSet(el, d);
    }

    function dtpType(el, digit) {
        const field = el._vdtField || 'm';
        if (field === 'w') return;
        const typed = `${el._vdtTyped || ''}${digit}`;
        const d = dtpValue(el);
        const n = Number(typed);
        if (field === 'y') {
            el._vdtTyped = typed.length >= 4 ? '' : typed;
            if (typed.length >= 4 || typed.length === 2) {
                const year = typed.length === 2 ? 2000 + n : n;
                d.setFullYear(year);
                dtpSet(el, d);
                el._vdtTyped = typed.length >= 4 ? '' : typed;
            }
            return;
        }
        const max = field === 'm' ? 12 : new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        if (n < 1 && typed.length < 2) { el._vdtTyped = typed; return; }
        if (n > max) { el._vdtTyped = ''; return; }
        if (field === 'm') { const day = d.getDate(); d.setDate(1); d.setMonth(n - 1); d.setDate(Math.min(day, new Date(d.getFullYear(), n, 0).getDate())); } else d.setDate(n);
        dtpSet(el, d);
        // a second digit (or one that cannot start a two-digit value) finishes the field
        el._vdtTyped = typed.length >= 2 || n * 10 > max ? '' : typed;
    }

    function monthCalHtml(view, selected) {
        const today = dayOnly(new Date());
        const first = new Date(view.getFullYear(), view.getMonth(), 1);
        const start = new Date(first);
        start.setDate(1 - first.getDay());
        let cells = '';
        for (let i = 0; i < 42; i += 1) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const cls = `vdt-mc-day${d.getMonth() !== view.getMonth() ? ' is-other' : ''}${sameDay(d, today) ? ' is-today' : ''}${sameDay(d, selected) ? ' is-selected' : ''}`;
            cells += `<span class="${cls}" style="left:${2 + (i % 7) * 31}px;top:${47 + Math.floor(i / 7) * 15}px" data-t="${d.getTime()}">${d.getDate()}</span>`;
        }
        return `<span class="vdt-mc-prev"></span><span class="vdt-mc-title">${MONTHS[view.getMonth()]}, ${view.getFullYear()}</span><span class="vdt-mc-next"></span>
            ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n, i) => `<span class="vdt-mc-dow" style="left:${2 + i * 31}px">${n}</span>`).join('')}
            <span class="vdt-mc-rule"></span>${cells}
            <span class="vdt-mc-today"><span class="vdt-mc-today-box"></span>Today: ${shortDate(today)}</span>`;
    }

    let dtpPopup = null;

    function dtpClose(commit) {
        if (!dtpPopup) return;
        const { pop, el } = dtpPopup;
        dtpPopup = null;
        pop.remove();
        el.classList.remove('is-open');
        if (commit !== false) try { el.focus(); } catch (_) { /* gone */ }
        dtpDraw(el);
    }

    function dtpOpen(el) {
        if (dtpPopup) { const was = dtpPopup.el; dtpClose(); if (was === el) return; }
        const r = el.getBoundingClientRect();
        const pop = doc.createElement('div');
        pop.className = 'vdt-monthcal';
        const modal = el.closest('.modal');
        const z = modal ? (Number.parseInt(root.getComputedStyle(modal).zIndex, 10) || 1000) + 10 : 100000;
        pop.style.zIndex = String(z);
        const left = el.dataset.vdtRight ? r.right - 223 : r.left;
        pop.style.left = `${Math.round(Math.max(0, Math.min(left, root.innerWidth - 223)))}px`;
        pop.style.top = `${Math.round(r.bottom + 158 > root.innerHeight ? r.top - 158 : r.bottom)}px`;
        const state = { pop, el, view: new Date(dtpValue(el).getFullYear(), dtpValue(el).getMonth(), 1) };
        const draw = () => { pop.innerHTML = monthCalHtml(state.view, dtpValue(el)); };
        draw();
        pop.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const t = ev.target;
            if (t.closest('.vdt-mc-prev')) { state.view = new Date(state.view.getFullYear(), state.view.getMonth() - 1, 1); draw(); return; }
            if (t.closest('.vdt-mc-next')) { state.view = new Date(state.view.getFullYear(), state.view.getMonth() + 1, 1); draw(); return; }
            const day = t.closest('.vdt-mc-day');
            if (day) { dtpSet(el, new Date(Number(day.dataset.t))); dtpClose(); return; }
            if (t.closest('.vdt-mc-today')) { dtpSet(el, new Date()); dtpClose(); }
        });
        doc.body.appendChild(pop);
        el.classList.add('is-open');
        dtpPopup = state;
        dtpDraw(el);
    }

    function dtpWire() {
        if (doc._vdtDtpWired) return;
        doc._vdtDtpWired = true;
        doc.addEventListener('mousedown', (ev) => {
            const el = ev.target.closest && ev.target.closest('.vdt-dtp');
            if (dtpPopup && !(el && el === dtpPopup.el)) dtpClose(false);
            if (!el || el.getAttribute('aria-disabled') === 'true') return;
            ev.preventDefault();
            el.focus();
            if (ev.target.closest('.vdt-dtp-btn')) { dtpOpen(el); return; }
            const f = ev.target.closest('.vdt-dtp-field');
            if (f) el._vdtField = f.dataset.f;
            el._vdtTyped = '';
            dtpDraw(el);
        }, true);
        doc.addEventListener('focusin', (ev) => { if (ev.target.classList && ev.target.classList.contains('vdt-dtp')) dtpDraw(ev.target); });
        doc.addEventListener('focusout', (ev) => {
            const el = ev.target;
            if (el.classList && el.classList.contains('vdt-dtp')) setTimeout(() => dtpDraw(el), 0);
        });
        doc.addEventListener('keydown', (ev) => {
            const el = ev.target;
            if (!el.classList || !el.classList.contains('vdt-dtp')) return;
            const order = dtpFields(el).filter(([k]) => /[a-z]/.test(k)).map(([k]) => k).filter((k) => k !== 'w');
            const field = order.includes(el._vdtField) ? el._vdtField : order[0];
            let handled = true;
            if (dtpPopup && dtpPopup.el === el) {
                if (ev.key === 'Escape') dtpClose();
                else if (ev.key === 'Enter') dtpClose();
                else if (ev.key.startsWith('Arrow')) {
                    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
                    const d = dtpValue(el);
                    d.setDate(d.getDate() + delta);
                    dtpSet(el, d);
                    dtpPopup.view = new Date(d.getFullYear(), d.getMonth(), 1);
                    dtpPopup.pop.innerHTML = monthCalHtml(dtpPopup.view, d);
                } else handled = false;
            } else if (ev.key === 'F4' || (ev.altKey && ev.key === 'ArrowDown')) dtpOpen(el);
            else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') dtpStep(el, field, ev.key === 'ArrowUp' ? 1 : -1);
            else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
                const i = order.indexOf(field) + (ev.key === 'ArrowLeft' ? -1 : 1);
                el._vdtField = order[(i + order.length) % order.length];
                el._vdtTyped = '';
                dtpDraw(el);
            } else if (/^[0-9]$/.test(ev.key)) dtpType(el, ev.key);
            else if (ev.key === '/' || ev.key === '-') {
                el._vdtField = order[Math.min(order.indexOf(field) + 1, order.length - 1)];
                el._vdtTyped = '';
                dtpDraw(el);
            } else handled = false;
            if (handled) { ev.preventDefault(); ev.stopPropagation(); }
        }, true);
    }

    // ---- windows -------------------------------------------------------------------------------

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function makeWindow(id, title, opts = {}) {
        const old = doc.getElementById(id);
        if (old) old.remove();
        const modal = doc.createElement('div');
        modal.className = 'modal hidden on-top tbp-window vdt-window';
        modal.id = id;
        modal.dataset.windowIdentifier = id;
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.dataset.windowFixedSize = 'true';
        modal.dataset.vistaDialog = 'form';
        modal.dataset.windowClient = 'light';
        if (opts.icon) modal.dataset.taskbarIcon = opts.icon;
        else modal.dataset.captionIcon = 'none';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', title);
        modal.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main">${opts.icon && opts.captionIcon ? `<img class="icon-image" src="${esc(opts.icon)}" alt="">` : ''}<span>${esc(title)}</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                ${opts.help ? '<button type="button" class="btn-secondary btn-small vdt-help-btn" title="Help">?</button>' : ''}
                <button type="button" class="btn-danger close-btn btn-small vdt-close" title="Close"><i class="fa-regular fa-xmark-large" aria-hidden="true"></i></button>
            </div>
            <div class="modal-content win7 tbp-client vdt-client${opts.segoe ? ' vdt-segoe' : ''}"></div>`;
        doc.body.appendChild(modal);
        return { modal, content: modal.querySelector('.vdt-client'), close: modal.querySelector('.vdt-close') };
    }

    function show(modal, owner) {
        if (owner && owner.id) modal.dataset.iconOwnerId = owner.id;
        callGlobal('openModal', modal);
        modal.classList.remove('hidden');
        root.requestAnimationFrame(() => {
            const r = modal.getBoundingClientRect();
            let cx = root.innerWidth / 2;
            let cy = (root.innerHeight - 35) / 2;
            if (owner && owner.isConnected && !owner.classList.contains('hidden')) {
                const o = owner.getBoundingClientRect();
                cx = o.left + o.width / 2;
                cy = o.top + o.height / 2;
            }
            callGlobal('setModalOffsetsFromViewportTopLeft', modal, Math.max(0, Math.round(cx - r.width / 2)), Math.max(0, Math.round(cy - r.height / 2)));
        });
    }

    function destroy(modal) {
        try { callGlobal('closeModal', modal); } catch (_) { /* window manager gone */ }
        setTimeout(() => { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 400);
    }

    function makeCtx(state) {
        const find = (id, key) => {
            const scope = key ? state.content.querySelector(`[data-vdt-page="${key}"]`) : state.content;
            if (!scope) return null;
            const holder = scope.querySelector(`[data-vdt-id="${id}"]`);
            if (!holder) return null;
            if (holder.matches('input, select, textarea, button')) return holder;
            return holder.querySelector('input, select, textarea') || holder;
        };
        const ctx = {
            state,
            get modal() { return state.modal; },
            get content() { return state.content; },
            el: find,
            holder(id, key) {
                const scope = key ? state.content.querySelector(`[data-vdt-page="${key}"]`) : state.content;
                return scope ? scope.querySelector(`[data-vdt-id="${id}"]`) : null;
            },
            get(id, key) {
                const e = find(id, key);
                if (!e) return undefined;
                if (e.type === 'checkbox' || e.type === 'radio') return e.checked;
                if (e.type === 'range') return Number(e.value);
                if (e.classList && e.classList.contains('vdt-listbox')) return e.dataset.value || '';
                if (e.classList && e.classList.contains('vdt-dtp')) return dtpValue(e);
                return e.value;
            },
            set(id, value, key) {
                const e = find(id, key);
                if (!e) return;
                if (e.type === 'checkbox' || e.type === 'radio') e.checked = !!value;
                else if (e.classList && e.classList.contains('vdt-listbox')) {
                    e.dataset.value = value;
                    e.querySelectorAll('.vdt-lb-row').forEach((row) => row.classList.toggle('is-selected', row.dataset.value === String(value)));
                } else if (e.classList && e.classList.contains('vdt-dtp')) dtpSet(e, value, true);
                else e.value = value;
            },
            text(id, text, key) {
                const h = ctx.holder(id, key);
                if (!h) return;
                if (h.classList.contains('vdt-static')) {
                    h.innerHTML = text ? `<span class="vdt-st-text">${esc(text)}</span>` : '';
                    return;
                }
                const target = h.matches('button') ? h : (h.querySelector('label span') || h.querySelector('.tbp-group-label') || h);
                target.textContent = text;
            },
            html(id, html, key) {
                const h = ctx.holder(id, key);
                if (h) h.innerHTML = html;
            },
            show(id, on, key) {
                const h = ctx.holder(id, key);
                if (h) h.hidden = !on;
            },
            enable(id, on, key) {
                const h = ctx.holder(id, key);
                if (!h) return;
                const e = find(id, key);
                if (e && 'disabled' in e) e.disabled = !on;
                h.classList.toggle('is-disabled', !on);
                const lbl = h.querySelector('.tbp-group-label');
                if (lbl) lbl.classList.toggle('is-disabled', !on);
            },
            options(id, list, value, key) {
                const e = find(id, key);
                if (!e) return;
                const items = (list || []).map((o) => (typeof o === 'object' ? o : { value: o, text: o }));
                if (e.tagName === 'SELECT') {
                    e.innerHTML = items.map((o) => `<option value="${esc(o.value)}">${esc(o.text)}</option>`).join('');
                    if (value !== undefined) e.value = String(value);
                } else if (e.tagName === 'INPUT' && e.list) {
                    e.list.innerHTML = items.map((o) => `<option value="${esc(o.text)}">`).join('');
                    if (value !== undefined) e.value = String(value);
                } else {
                    e.innerHTML = items.map((o) => `<div class="vdt-lb-row" data-value="${esc(o.value)}" role="option">${o.icon ? `<img src="${esc(o.icon)}" alt="">` : ''}<span>${esc(o.text)}</span></div>`).join('');
                    if (value !== undefined) ctx.set(id, value, key);
                }
            },
            range(id, min, max, value, key, ticks) {
                const e = find(id, key);
                if (!e) return;
                e.min = String(min);
                e.max = String(max);
                if (value !== undefined) e.value = String(value);
                const h = ctx.holder(id, key);
                if (h && ticks !== undefined) h.style.setProperty('--vdt-ticks', String(ticks));
                else if (h) h.style.setProperty('--vdt-ticks', String(max - min));
            },
            on(id, event, fn, key) {
                const h = ctx.holder(id, key);
                if (!h) return;
                h.addEventListener(event, (ev) => fn(ev, ctx));
            },
            dirty() {
                state.dirty = true;
                const apply = state.content.querySelector('[data-vdt-action="apply"]');
                if (apply) apply.disabled = false;
            },
            page(key) {
                return state.content.querySelector(`[data-vdt-page="${key}"]`);
            },
            selectPage(key) {
                selectPage(state, key);
            },
            close() {
                finish(state);
            },
            store: {}
        };
        return ctx;
    }

    function finish(state) {
        if (state.done) return;
        state.done = true;
        if (dtpPopup && state.modal.contains(dtpPopup.el)) dtpClose(false);
        if (typeof state.opts.close === 'function') {
            try { state.opts.close(state.ctx); } catch (err) { console.error(err); }
        }
        destroy(state.modal);
    }

    // ---- multi-row tabs (TCS_MULTILINE: a sheet whose tabs do not fit one row) -------------------

    const TAB_ROW = 18;
    let measureCtx = null;

    /** A tab's width at Tahoma 11 px: the label plus the 4 + 5 px padding and two borders. */
    function tabWidth(text) {
        if (!measureCtx) measureCtx = doc.createElement('canvas').getContext('2d');
        measureCtx.font = '11px Tahoma';
        return Math.ceil(measureCtx.measureText(String(text).replace(/&(.)/g, '$1')).width) + 11;
    }

    /** Tab indexes per row, top row first, each row filled in order to the row width. */
    function tabRows(titles, width) {
        const rows = [[]];
        let used = 0;
        titles.forEach((t, i) => {
            const w = tabWidth(t);
            if (used + w > width && rows[rows.length - 1].length) { rows.push([]); used = 0; }
            rows[rows.length - 1].push({ i, w });
            used += w;
        });
        return rows.map((r) => ({ tabs: r, width }));
    }

    /** Every row is stretched to the full width; the selected tab's row moves next to the pane. */
    function placeTabRows(state, key) {
        const tabs = [...state.content.querySelectorAll('.tbp-tab')];
        const sel = tabs.findIndex((t) => t.dataset.vdtTab === key);
        const order = state.rows.slice();
        const at = order.findIndex((r) => r.tabs.some((t) => t.i === sel));
        if (at >= 0) order.push(order.splice(at, 1)[0]);
        const bar = state.content.querySelector('.tbp-tabs');
        bar.classList.add('vdt-multirow');
        bar.style.height = `${order.length * TAB_ROW}px`;
        order.forEach((row, r) => {
            const natural = row.tabs.reduce((n, t) => n + t.w, 0);
            const spare = row.width - natural;
            let x = 0;
            row.tabs.forEach((t, k) => {
                const w = t.w + Math.floor((spare * (k + 1)) / row.tabs.length) - Math.floor((spare * k) / row.tabs.length);
                const el = tabs[t.i];
                const on = t.i === sel;
                el.style.left = `${x - (on ? 2 : 0)}px`;
                el.style.width = `${w + (on ? 4 : 0)}px`;
                el.style.top = `${r * TAB_ROW - (on ? 2 : 0)}px`;
                x += w;
            });
        });
    }

    function selectPage(state, key) {
        state.content.querySelectorAll('.tbp-tab').forEach((t) => {
            const on = t.dataset.vdtTab === key;
            t.classList.toggle('is-selected', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
        });
        state.content.querySelectorAll('[data-vdt-page]').forEach((p) => { p.hidden = p.dataset.vdtPage !== key; });
        state.current = key;
        if (state.rows) placeTabRows(state, key);
        if (typeof state.opts.pageShown === 'function') state.opts.pageShown(state.ctx, key);
    }

    function wireCommon(state) {
        const { content, modal } = state;
        // date pickers start on today until the program sets them
        dtpWire();
        content.querySelectorAll('.vdt-dtp').forEach((el) => { if (!el._vdtDate) dtpSet(el, new Date(), true); });
        // list boxes and list views select on click
        content.addEventListener('click', (ev) => {
            const row = ev.target.closest('.vdt-lb-row, .vdt-lv-row');
            if (row) {
                const box = row.closest('.vdt-listbox, .vdt-listview');
                box.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
                row.classList.add('is-selected');
                if (box.classList.contains('vdt-listbox')) box.dataset.value = row.dataset.value;
                box.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const spin = ev.target.closest('.vdt-up, .vdt-down');
            if (spin) {
                // the buddy is the control just before the up-down in the template
                const holder = spin.closest('[data-vdt-id]');
                const buddyHolder = holder && holder.previousElementSibling;
                const input = buddyHolder && (buddyHolder.matches('input') ? buddyHolder : buddyHolder.querySelector('input'));
                if (input) {
                    const min = Number(holder.dataset.min || 0);
                    const max = Number(holder.dataset.max || 999);
                    const v = Math.min(max, Math.max(min, (Number(input.value) || 0) + (spin.classList.contains('vdt-up') ? 1 : -1)));
                    input.value = String(v);
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });
        content.addEventListener('change', (ev) => {
            if (ev.target.closest('[data-vdt-id]')) state.ctx.dirty();
        });
        content.addEventListener('input', (ev) => {
            if (ev.target.closest('[data-vdt-id]') && ev.target.matches('input[type="text"], textarea, input[type="range"]')) state.ctx.dirty();
        });
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                state.cancel();
            } else if (ev.key === 'Enter' && !ev.target.matches('button, textarea, select')) {
                ev.preventDefault();
                state.ok();
            }
        });
        modal.querySelector('.vdt-close').addEventListener('click', () => state.cancel());
    }

    function openSheet(opts) {
        if (!doc) return null;
        const T = root.vistaDialogTemplates || {};
        const pages = opts.pages.map((p) => ({ ...p, tpl: T[p.key] })).filter((p) => p.tpl);
        if (!pages.length) {
            console.error('vistaDialogTemplate: no templates for', opts.id);
            return null;
        }
        const u = units(pages[0].tpl);
        // comctl32 never makes a page smaller than PROP_SM_CXDLG x PROP_SM_CYDLG (212 x 188 DLU of
        // MS Shell Dlg): Tablet PC Settings' 200 DLU pages sit in a 354 px window on the VM
        const shell = units({ f: ['MS Shell Dlg', 8] });
        const pw = Math.max(px(shell, 212, 'x'), ...pages.map((p) => size(p.tpl).width));
        const ph = Math.max(px(shell, 188, 'y'), ...pages.map((p) => size(p.tpl).height));
        const rows = tabRows(pages.map((p) => p.title || p.tpl.t), pw + 2);
        const extra = (rows.length - 1) * TAB_ROW;
        const cw = pw + 20;
        const ch = ph + 69 + extra;
        const { modal, content } = makeWindow(opts.id, opts.title, { icon: opts.icon, segoe: u.segoe, help: opts.help });
        content.style.width = `${cw}px`;
        content.style.height = `${ch}px`;
        content.style.font = u.font;
        const bx = cw - 6 - 75;
        content.innerHTML = `
            <div class="tbp-tabs" role="tablist">${pages.map((p) => `<button type="button" class="tbp-tab" role="tab" data-vdt-tab="${esc(p.key)}">${label(p.title || p.tpl.t)}</button>`).join('')}</div>
            <div class="tbp-pane" style="width:${pw + 6}px;height:${ph + 5}px;${extra ? `top:${27 + extra}px;` : ''}">
                ${pages.map((p) => `<div class="tbp-page vdt-page" role="tabpanel" data-vdt-page="${esc(p.key)}" hidden>${renderControls(p.tpl, `${opts.id}-${p.key.replace(/[^a-z0-9]/gi, '_')}`, { overrides: p.overrides, module: p.key.split(':')[0] })}</div>`).join('')}
            </div>
            <button type="button" class="tbp-ctl tbp-button tbp-footer-button vdt-footer" style="left:${bx - 162 + 1}px;top:${ch - 29}px;" data-vdt-action="ok" data-dialog-primary="1">OK</button>
            <button type="button" class="tbp-ctl tbp-button tbp-footer-button vdt-footer" style="left:${bx - 81 + 1}px;top:${ch - 29}px;" data-vdt-action="cancel">Cancel</button>
            ${opts.noApply ? '' : `<button type="button" class="tbp-ctl tbp-button tbp-footer-button vdt-footer" style="left:${bx + 1}px;top:${ch - 29}px;" data-vdt-action="apply" disabled><u>A</u>pply</button>`}`;
        const state = { opts, modal, content, dirty: false, done: false, current: null, rows: rows.length > 1 ? rows : null };
        state.ctx = makeCtx(state);
        const apply = async () => {
            if (typeof opts.apply === 'function') {
                try { await opts.apply(state.ctx); } catch (err) { console.error(`${opts.id}: apply failed`, err); }
            }
            state.dirty = false;
            const a = content.querySelector('[data-vdt-action="apply"]');
            if (a) a.disabled = true;
        };
        state.ok = async () => {
            if (state.dirty) await apply();
            finish(state);
        };
        state.cancel = () => finish(state);
        content.querySelector('.tbp-tabs').addEventListener('click', (ev) => {
            const tab = ev.target.closest('.tbp-tab');
            if (tab) selectPage(state, tab.dataset.vdtTab);
        });
        content.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-vdt-action]');
            if (!b || b.disabled) return;
            if (b.dataset.vdtAction === 'ok') void state.ok();
            else if (b.dataset.vdtAction === 'cancel') state.cancel();
            else if (b.dataset.vdtAction === 'apply') void apply();
        });
        wireCommon(state);
        const start = pages.find((p) => p.key === opts.start) ? opts.start : pages[0].key;
        if (typeof opts.init === 'function') {
            try { opts.init(state.ctx); } catch (err) { console.error(`${opts.id}: init failed`, err); }
        }
        selectPage(state, start);
        state.dirty = false;
        show(modal, opts.owner);
        return state.ctx;
    }

    function openDialog(opts) {
        if (!doc) return null;
        const T = root.vistaDialogTemplates || {};
        const tpl = opts.tpl || T[opts.key];
        if (!tpl) {
            console.error('vistaDialogTemplate: no template', opts.key);
            return null;
        }
        const u = units(tpl);
        const sz = size(tpl);
        const { modal, content } = makeWindow(opts.id, opts.title || tpl.t, { icon: opts.icon, segoe: u.segoe, help: opts.help });
        content.classList.add('vdt-plain');
        content.style.width = `${sz.width}px`;
        content.style.height = `${sz.height}px`;
        content.style.font = u.font;
        content.innerHTML = `<div class="vdt-plain-page" data-vdt-page="${esc(opts.key || 'main')}">${renderControls(tpl, opts.id, { overrides: opts.overrides, module: String(opts.key || '').split(':')[0] })}</div>`;
        const state = { opts, modal, content, dirty: false, done: false };
        state.ctx = makeCtx(state);
        state.ok = async () => {
            if (typeof opts.ok === 'function') {
                let keep = false;
                try { keep = (await opts.ok(state.ctx)) === false; } catch (err) { console.error(`${opts.id}: ok failed`, err); }
                if (keep) return;
            }
            finish(state);
        };
        state.cancel = () => {
            if (typeof opts.cancel === 'function') opts.cancel(state.ctx);
            finish(state);
        };
        content.addEventListener('click', (ev) => {
            const b = ev.target.closest('button[data-vdt-id]');
            if (!b || b.disabled) return;
            const id = Number(b.dataset.vdtId);
            if (opts.buttons && typeof opts.buttons[id] === 'function') {
                opts.buttons[id](state.ctx, ev);
                return;
            }
            if (id === 1) void state.ok();
            else if (id === 2) state.cancel();
        });
        wireCommon(state);
        if (typeof opts.init === 'function') {
            try { opts.init(state.ctx); } catch (err) { console.error(`${opts.id}: init failed`, err); }
        }
        show(modal, opts.owner);
        return state.ctx;
    }

    /**
     * An Aero Wizard (WinCal's Subscribe to a Calendar, measured on the VM): the caption bar with the
     * close box only, a 37 px glass header under it with the icon and the title (the Back orb in
     * front of them from the second page on), the white page with its main instruction (12 pt
     * #003399, 40 px in, 24 px down) over the page's template, and the 40 px footer with Next (or
     * Finish) and Cancel.
     *
     *   pages: [{ key, instruction, next(ctx) -> next page key | false (stay) | Promise, finish }]
     *   init(ctx), finish(ctx) -> false keeps it open, cancel(ctx); ctx.go(key) shows a page
     */
    function openWizard(opts) {
        if (!doc) return null;
        const T = root.vistaDialogTemplates || {};
        const pages = opts.pages.map((p) => ({ ...p, tpl: T[p.key] })).filter((p) => p.tpl);
        if (!pages.length) {
            console.error('vistaDialogTemplate: no wizard pages for', opts.id);
            return null;
        }
        const u = units(pages[0].tpl);
        const pw = Math.max(...pages.map((p) => size(p.tpl).width));
        const ph = Math.max(...pages.map((p) => size(p.tpl).height));
        const { modal, content } = makeWindow(opts.id, opts.title, { icon: opts.icon, captionIcon: true, segoe: u.segoe, help: opts.help });
        modal.classList.add('vdt-wizard');
        const main = modal.querySelector('.modal-window-title-main');
        if (main) main.insertAdjacentHTML('afterbegin', '<button type="button" class="vdt-wizard-back" title="Back" hidden></button>');
        content.classList.add('vdt-wizard-client');
        content.style.width = `${pw + 57}px`;
        // the VM's: the page 56 px down, 40 px of footer and room under the page
        content.style.height = `${ph + 120}px`;
        content.style.font = u.font;
        content.innerHTML = pages.map((p) => `<div class="vdt-wizard-page" data-vdt-page="${esc(p.key)}" hidden>
                <div class="vdt-wizard-instruction">${esc(p.instruction || opts.title || '')}</div>
                <div class="vdt-wizard-body">${renderControls(p.tpl, `${opts.id}-${p.key.replace(/[^a-z0-9]/gi, '_')}`, { overrides: p.overrides, module: p.key.split(':')[0] })}</div>
            </div>`).join('') + `<div class="vdt-wizard-footer">
                <button type="button" class="tbp-ctl tbp-button vdt-wizard-next" data-dialog-primary="1">Next</button>
                <button type="button" class="tbp-ctl tbp-button vdt-wizard-cancel">Cancel</button>
            </div>`;
        const state = { opts, modal, content, dirty: false, done: false, history: [] };
        state.ctx = makeCtx(state);
        const back = modal.querySelector('.vdt-wizard-back');
        const next = content.querySelector('.vdt-wizard-next');
        const cancelBtn = content.querySelector('.vdt-wizard-cancel');
        const showPage = (key, push) => {
            const page = pages.find((p) => p.key === key);
            if (!page) return;
            const was = pages.find((p) => p.key === state.current);
            if (push && state.current && !(was && was.transient)) state.history.push(state.current);
            state.current = key;
            content.querySelectorAll('.vdt-wizard-page').forEach((el) => { el.hidden = el.dataset.vdtPage !== key; });
            if (back) back.hidden = !state.history.length || !!page.noBack;
            next.textContent = page.finish ? 'Finish' : (page.nextText || 'Next');
            next.hidden = !!page.noNext;
            // with Next gone, Cancel is the default button (the VM's error page)
            // Finish is not drawn as the default on the VM (WinCal 5120)
            if (next.hidden) { next.removeAttribute('data-dialog-primary'); cancelBtn.dataset.dialogPrimary = '1'; } else { cancelBtn.removeAttribute('data-dialog-primary'); if (page.finish) next.removeAttribute('data-dialog-primary'); else next.dataset.dialogPrimary = '1'; }
            if (next.hidden) root.requestAnimationFrame(() => { try { cancelBtn.focus(); } catch (_) { /* gone */ } });
            if (typeof page.show === 'function') page.show(state.ctx);
            // the page's first edit takes the focus, as on the VM
            const first = content.querySelector(`[data-vdt-page="${key}"] input:not([type=checkbox]):not([type=radio]):not([disabled]), [data-vdt-page="${key}"] textarea`);
            if (first) root.requestAnimationFrame(() => { try { first.focus(); if (first.select) first.select(); } catch (_) { /* gone */ } });
        };
        state.ctx.go = (key) => showPage(key, true);
        state.ctx.reset = (key) => { state.history = []; showPage(key, false); };
        state.cancel = () => {
            if (typeof opts.cancel === 'function') opts.cancel(state.ctx);
            finish(state);
        };
        next.addEventListener('click', async () => {
            const page = pages.find((p) => p.key === state.current);
            if (!page || next.disabled) return;
            if (page.finish) {
                let keep = false;
                try { keep = typeof opts.finish === 'function' && (await opts.finish(state.ctx)) === false; } catch (err) { console.error(`${opts.id}: finish failed`, err); }
                if (!keep) finish(state);
                return;
            }
            let to = null;
            try { to = typeof page.next === 'function' ? await page.next(state.ctx) : null; } catch (err) { console.error(`${opts.id}: next failed`, err); }
            if (to === false || state.done) return;
            const idx = pages.indexOf(page);
            showPage(to || (pages[idx + 1] && pages[idx + 1].key), true);
        });
        content.querySelector('.vdt-wizard-cancel').addEventListener('click', () => state.cancel());
        // Enter is Next (or Finish), as on the VM
        state.ok = () => (next.hidden ? state.cancel() : next.click());
        if (back) back.addEventListener('click', () => { const k = state.history.pop(); if (k) showPage(k, false); });
        wireCommon(state);
        if (typeof opts.init === 'function') {
            try { opts.init(state.ctx); } catch (err) { console.error(`${opts.id}: init failed`, err); }
        }
        showPage(pages[0].key, false);
        show(modal, opts.owner);
        return state.ctx;
    }

    // ---- ChooseColor (comdlg32 CHOOSECOLOR) ----------------------------------------------------
    //
    // Basic colors, Custom colors, and Define Custom Colors >> with the hue / saturation spectrum,
    // the luminosity bar and the Hue / Sat / Lum / Red / Green / Blue boxes. Paint's Edit Colors and
    // Calendar's Overdue color open it. Resolves with the colour (#rrggbb) or null on Cancel.

    // ChooseColor's 48 basic colors, as Vista lists them (6 rows of 8)
    const CC_BASIC = [
        '#ff8080', '#ffff80', '#80ff80', '#00ff80', '#80ffff', '#0080ff', '#ff80c0', '#ff80ff',
        '#ff0000', '#ffff00', '#80ff00', '#00ff40', '#00ffff', '#0080c0', '#8080c0', '#ff00ff',
        '#804040', '#ff8040', '#00ff00', '#008080', '#004080', '#8080ff', '#800040', '#ff0080',
        '#800000', '#ff8000', '#008000', '#008040', '#0000ff', '#0000a0', '#800080', '#8000ff',
        '#400000', '#804000', '#004000', '#004040', '#000080', '#000040', '#400040', '#400080',
        '#000000', '#808000', '#808040', '#808080', '#408080', '#c0c0c0', '#400040', '#ffffff'
    ];

    function ccHex(r, g, b) {
        return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
    }

    function ccRgb(css) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(css || '').trim());
        if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
        const c = doc.createElement('canvas').getContext('2d');
        c.fillStyle = String(css || '#000');
        c.fillRect(0, 0, 1, 1);
        return Array.from(c.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h /= 6;
        }
        return [h, s, l];
    }

    function hslToRgb(h, s, l) {
        if (s === 0) return [l * 255, l * 255, l * 255];
        const hue = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
    }

    /**
     * opts: { id, title ('Color' by default, Paint says 'Edit Colors'), owner, color, custom (16
     * colours), onCustom(custom) to keep them, full (open with the custom half shown) }
     */
    function chooseColor(opts = {}) {
        return new Promise((resolve) => {
            const custom = (opts.custom && opts.custom.length === 16 ? opts.custom : Array(16).fill('#ffffff')).slice();
            let color = ccHex(...ccRgb(opts.color || '#000000'));
            let customSlot = 0;
            let done = false;
            const num = (v, def) => { const n = Number(String(v).trim()); return Number.isFinite(n) ? n : def; };
            const ctxP = openDialog({
                id: opts.id || 'vdtChooseColor',
                key: 'comdlg32:CHOOSECOLOR',
                title: opts.title || 'Color',
                owner: opts.owner,
                overrides: {
                    1038: { hidden: true }, 713: { hidden: true },
                    // the VM's boxes: 20x17 on a 25x22 pitch, 3 px / 2 px into the frame
                    720: { html: CC_BASIC.map((c, i) => `<button type="button" class="vdt-cc-cell" data-c="${c}" style="--c:${c};left:${3 + (i % 8) * 25}px;top:${2 + Math.floor(i / 8) * 22}px"></button>`).join(''), cls: 'vdt-cc-grid is-basic' },
                    721: { html: custom.map((c, i) => `<button type="button" class="vdt-cc-cell" data-c="${c}" data-slot="${i}" style="--c:${c};left:${3 + (i % 8) * 25}px;top:${2 + Math.floor(i / 8) * 22}px"></button>`).join(''), cls: 'vdt-cc-grid is-custom' },
                    710: { html: '<canvas class="vdt-cc-spectrum" width="177" height="189"></canvas><span class="vdt-cc-cross"></span>' },
                    702: { html: '<canvas class="vdt-cc-lum" width="12" height="189"></canvas><span class="vdt-cc-arrow"></span>' },
                    709: { html: '<div class="vdt-cc-swatch"></div>' }
                },
                init(ctx) {
                    const content = ctx.content;
                    // collapsed, the window is 148 DLU wide (the boxes' 144 and the margin): 222 px on the VM
                    const collapsed = Math.round((148 * 6) / 4) - 16;
                    const full = parseInt(content.style.width, 10);
                    const spec = content.querySelector('.vdt-cc-spectrum');
                    const lum = content.querySelector('.vdt-cc-lum');
                    const sctx = spec.getContext('2d');
                    const img = sctx.createImageData(spec.width, spec.height);
                    for (let y = 0; y < spec.height; y += 1) {
                        for (let x = 0; x < spec.width; x += 1) {
                            const [r, g, b] = hslToRgb(x / spec.width, 1 - y / spec.height, 0.5);
                            const i = (y * spec.width + x) * 4;
                            img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
                        }
                    }
                    sctx.putImageData(img, 0, 0);
                    let hsl = rgbToHsl(...ccRgb(color));
                    const paint = () => {
                        const [r, g, b] = hslToRgb(hsl[0], hsl[1], hsl[2]);
                        color = ccHex(r, g, b);
                        content.querySelector('.vdt-cc-swatch').style.background = color;
                        const lc = lum.getContext('2d');
                        for (let y = 0; y < lum.height; y += 1) {
                            const [lr, lg, lb] = hslToRgb(hsl[0], hsl[1], 1 - y / lum.height);
                            lc.fillStyle = ccHex(lr, lg, lb);
                            lc.fillRect(0, y, lum.width, 1);
                        }
                        content.querySelector('.vdt-cc-cross').style.cssText = `left:${hsl[0] * spec.width - 9}px;top:${(1 - hsl[1]) * spec.height - 9}px`;
                        content.querySelector('.vdt-cc-arrow').style.top = `${(1 - hsl[2]) * lum.height - 4}px`;
                        ctx.set(703, String(Math.round(hsl[0] * 239)));
                        ctx.set(704, String(Math.round(hsl[1] * 240)));
                        ctx.set(705, String(Math.round(hsl[2] * 240)));
                        ctx.set(706, String(Math.round(r)));
                        ctx.set(707, String(Math.round(g)));
                        ctx.set(708, String(Math.round(b)));
                    };
                    if (!opts.full) {
                        content.style.width = `${collapsed}px`;
                        ctx.on(719, 'click', () => {
                            content.style.width = `${full}px`;
                            ctx.enable(719, false);
                            paint();
                        });
                    } else ctx.enable(719, false);
                    // the basic cell that is the colour starts selected, as ChooseColor marks it
                    const start = content.querySelector(`.is-basic .vdt-cc-cell[data-c="${color}"]`) || content.querySelector(`.is-custom .vdt-cc-cell[data-c="${color}"]`);
                    if (start) start.classList.add('is-on');
                    const drag = (el, fn) => el.addEventListener('pointerdown', (ev) => {
                        el.setPointerCapture(ev.pointerId);
                        const at = (e) => { const r = el.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))); paint(); };
                        at(ev);
                        el.onpointermove = (e) => { if (e.buttons) at(e); };
                    });
                    drag(spec, (x, y) => { hsl = [x, 1 - y, hsl[2] === 0 || hsl[2] === 1 ? 0.5 : hsl[2]]; });
                    drag(lum, (x, y) => { hsl = [hsl[0], hsl[1], 1 - y]; });
                    content.addEventListener('click', (ev) => {
                        const cell = ev.target.closest('.vdt-cc-cell');
                        if (!cell) return;
                        content.querySelectorAll('.vdt-cc-cell.is-on').forEach((c) => c.classList.remove('is-on'));
                        cell.classList.add('is-on');
                        if (cell.dataset.slot !== undefined) customSlot = Number(cell.dataset.slot);
                        hsl = rgbToHsl(...ccRgb(cell.dataset.c));
                        paint();
                    });
                    const fromRgb = () => { hsl = rgbToHsl(num(ctx.get(706), 0), num(ctx.get(707), 0), num(ctx.get(708), 0)); paint(); };
                    const fromHsl = () => { hsl = [num(ctx.get(703), 0) / 239, num(ctx.get(704), 0) / 240, num(ctx.get(705), 0) / 240]; paint(); };
                    [706, 707, 708].forEach((id) => ctx.on(id, 'change', fromRgb));
                    [703, 704, 705].forEach((id) => ctx.on(id, 'change', fromHsl));
                    ctx.on(712, 'click', () => {
                        custom[customSlot] = color;
                        const cell = content.querySelector(`.vdt-cc-cell[data-slot="${customSlot}"]`);
                        if (cell) { cell.dataset.c = color; cell.style.setProperty('--c', color); }
                        customSlot = (customSlot + 1) % 16;
                        if (typeof opts.onCustom === 'function') opts.onCustom(custom.slice());
                    });
                    paint();
                },
                ok() { done = true; resolve(color); },
                close() { if (!done) { done = true; resolve(null); } }
            });
            if (!ctxP) resolve(null);
        });
    }

    root.vistaDialogTemplate = { openSheet, openDialog, openWizard, chooseColor, renderControls, size, units, rect, label };
})(typeof window !== 'undefined' ? window : globalThis);
