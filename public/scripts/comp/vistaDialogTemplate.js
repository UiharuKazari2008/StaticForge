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

    /** SysLink text: <a>...</a> (and <a id="x">) become links; the rest is text. */
    function linkText(text) {
        return String(text || '').split(/(<a[^>]*>.*?<\/a>)/i).map((part) => {
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
            const visible = (st & WS_VISIBLE) !== 0 && !o.hidden;
            const disabled = (st & WS_DISABLED) !== 0 || o.disabled === true;
            const dataId = `data-vdt-id="${id}" data-vdt-index="${index}"`;
            const hid = visible ? '' : ' hidden';
            const dis = disabled ? ' disabled' : '';
            const t = o.text !== undefined ? o.text : text;
            const edge = (ex & WS_EX_CLIENTEDGE) || (st & WS_BORDER) ? ' vdt-edge' : '';
            const domId = `${prefix}-${id >= 0 ? id : `x${index}`}`;
            const lowType = st & 0xF;
            const isRadio = cls === 'B' && (lowType === 4 || lowType === 9);
            if (isRadio) {
                if (!inRadios || (st & WS_GROUP)) radioGroup += 1;
                inRadios = true;
            } else if (cls === 'B' && lowType !== 7 && (st & WS_GROUP)) {
                inRadios = false;
            } else if (cls !== 'B' && (st & WS_GROUP)) {
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
                        // "#104": the icon resource of the template's own module, ripped to vista-dlg/
                        const src = o.image || (/^#\d+$/.test(t) && opts.module ? `/static_images/vista-dlg/${opts.module}-${t.slice(1)}.png` : '');
                        out.push(`<div class="tbp-ctl vdt-image" style="${style(r)}" ${dataId}${hid}>${src ? `<img src="${esc(src)}" alt="" draggable="false">` : ''}</div>`);
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
                        out.push(`<div class="tbp-ctl tbp-static vdt-static${nowrap}${sunken}${disabled ? ' is-disabled' : ''}" style="${style(r)}text-align:${align};" ${dataId}${hid}>${label(t, noPrefix)}</div>`);
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
                    const vertical = (st & 2) !== 0;
                    const ticks = (st & 1) && !(st & 0x10) ? ' vdt-ticks' : '';
                    out.push(`<div class="tbp-ctl vdt-trackbar${vertical ? ' is-vertical' : ''}${ticks}" style="${style(r)}" ${dataId}${hid}><input type="range" id="${domId}" min="0" max="10" value="0"${dis}><span class="vdt-tickmarks"></span></div>`);
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
                return e.value;
            },
            set(id, value, key) {
                const e = find(id, key);
                if (!e) return;
                if (e.type === 'checkbox' || e.type === 'radio') e.checked = !!value;
                else if (e.classList && e.classList.contains('vdt-listbox')) {
                    e.dataset.value = value;
                    e.querySelectorAll('.vdt-lb-row').forEach((row) => row.classList.toggle('is-selected', row.dataset.value === String(value)));
                } else e.value = value;
            },
            text(id, text, key) {
                const h = ctx.holder(id, key);
                if (!h) return;
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
        if (typeof state.opts.close === 'function') {
            try { state.opts.close(state.ctx); } catch (err) { console.error(err); }
        }
        destroy(state.modal);
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
        if (typeof state.opts.pageShown === 'function') state.opts.pageShown(state.ctx, key);
    }

    function wireCommon(state) {
        const { content, modal } = state;
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
        const pw = Math.max(...pages.map((p) => size(p.tpl).width));
        const ph = Math.max(...pages.map((p) => size(p.tpl).height));
        const cw = pw + 20;
        const ch = ph + 69;
        const { modal, content } = makeWindow(opts.id, opts.title, { icon: opts.icon, segoe: u.segoe, help: opts.help });
        content.style.width = `${cw}px`;
        content.style.height = `${ch}px`;
        content.style.font = u.font;
        const bx = cw - 6 - 75;
        content.innerHTML = `
            <div class="tbp-tabs" role="tablist">${pages.map((p) => `<button type="button" class="tbp-tab" role="tab" data-vdt-tab="${esc(p.key)}">${label(p.title || p.tpl.t)}</button>`).join('')}</div>
            <div class="tbp-pane" style="width:${pw + 6}px;height:${ph + 5}px;">
                ${pages.map((p) => `<div class="tbp-page vdt-page" role="tabpanel" data-vdt-page="${esc(p.key)}" hidden>${renderControls(p.tpl, `${opts.id}-${p.key.replace(/[^a-z0-9]/gi, '_')}`, { overrides: p.overrides, module: p.key.split(':')[0] })}</div>`).join('')}
            </div>
            <button type="button" class="tbp-ctl tbp-button tbp-footer-button vdt-footer" style="left:${bx - 162 + 1}px;top:${ch - 29}px;" data-vdt-action="ok" data-dialog-primary="1">OK</button>
            <button type="button" class="tbp-ctl tbp-button tbp-footer-button vdt-footer" style="left:${bx - 81 + 1}px;top:${ch - 29}px;" data-vdt-action="cancel">Cancel</button>
            ${opts.noApply ? '' : `<button type="button" class="tbp-ctl tbp-button tbp-footer-button vdt-footer" style="left:${bx + 1}px;top:${ch - 29}px;" data-vdt-action="apply" disabled><u>A</u>pply</button>`}`;
        const state = { opts, modal, content, dirty: false, done: false, current: null };
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

    root.vistaDialogTemplate = { openSheet, openDialog, renderControls, size, units, rect, label };
})(typeof window !== 'undefined' ? window : globalThis);
