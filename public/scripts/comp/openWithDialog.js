/**
 * Vista's Open With (#954), as the VM's shell draws it (refs ~/.cache/vista-vm/openwith):
 *
 *   cannotOpen(fileName)   "Windows cannot open this file:" (here Melaton): File: <name>, the reason, "What do you
 *                          want to do?" with "Use the Web service to find the correct program" / "Select a program
 *                          from a list of installed programs", OK / Cancel. Resolves 'web' | 'list' | null.
 *   choose({ fileName, programs, selected, always })
 *                          "Open With": "Choose the program you want to use to open this file:", File: <name>, the
 *                          programs as two columns of tiles (32 px icon, name, publisher in grey), "Type a description
 *                          that you want to use for this kind of file:", "Always use the selected program to open this
 *                          kind of file", Browse..., the web line, OK / Cancel. programs: [{ id, name, publisher, icon,
 *                          icon2x | srcset, group?, note? }]. Resolves { id, always, description } | null.
 *                          With a group on the programs ('recommended' | 'other'): the list is openwith.exe's grouped
 *                          view for a known type (~/.cache/vista-vm/openwith/openwith-grouped*.png): "Recommended
 *                          Programs", then "Other Programs" with its chevron, folded while a recommended program is
 *                          picked; no description box (describe: false), the list taller by its height.
 *                          The phone's own apps (#954) come as programs too (explorerPhoneDrive.phoneApps): srcset is
 *                          their icon drawn by Android at the tile's device pixels, note the line that stands in for
 *                          the web line while one is selected (Android lets no app set its defaults).
 *   ANDROID_RUNTIME        the program entry that opens a file on the phone (Melaton Mobile's apps, Android's chooser).
 *
 * Built on the shell's message box (showConfirmationDialog: frame, focus, buttons, Esc) with its own body.
 */
(function (root) {
    'use strict';
    const ICON = '/static_images/vista-dlg/openwith-32.png';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const ANDROID_RUNTIME = {
        id: 'android',
        name: 'Android Runtime',
        publisher: 'Melaton Mobile',
        icon: '/static_images/vista-dlg/android-runtime-32.png',
        icon2x: '/static_images/vista-dlg/android-runtime-64.png'
    };

    function head(fileName, line) {
        return `<div class="mow-head"><img class="mow-icon" src="${ICON}" alt="" draggable="false"><div class="mow-head-text"><div>${esc(line)}</div><div class="mow-file"><span>File:</span><span>${esc(fileName)}</span></div></div></div>`;
    }

    function dialog(html, opts) {
        if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
        return root.showConfirmationDialog(html, [
            { text: 'OK', value: true, className: 'btn-standard primary' },
            { text: 'Cancel', value: false, className: 'btn-standard' }
        ], null, Object.assign({ icon: 'none', sound: false }, opts));
    }

    /** shell32's "cannot open" box (Windows -> Melaton). */
    function cannotOpen(fileName) {
        const html = `<div class="mow mow-cannot">${head(fileName, 'Melaton cannot open this file:')}
            <p class="mow-text">To open this file, Melaton needs to know what program you want to use to open it. Melaton can go online to look it up automatically, or you can manually select from a list of programs that are installed on your computer.</p>
            <p class="mow-text mow-ask">What do you want to do?</p>
            <div class="win7 mow-radio"><input type="radio" name="mow-how" id="mowWeb" value="web" checked><label for="mowWeb">Use the Web service to find the correct program</label></div>
            <div class="win7 mow-radio"><input type="radio" name="mow-how" id="mowList" value="list"><label for="mowList">Select a program from a list of installed programs</label></div>
        </div>`;
        return dialog(html, {
            title: 'Melaton',
            width: 432,
            resolveValue: (v, dlg) => (v ? ((dlg.querySelector('input[name="mow-how"]:checked') || {}).value || 'web') : null)
        });
    }

    /** openwith.exe's chooser. */
    function choose(o) {
        const opts = o || {};
        const programs = Array.isArray(opts.programs) ? opts.programs.filter((p) => p && p.id) : [];
        if (!programs.length) return Promise.resolve(null);
        const selected = programs.some((p) => p.id === opts.selected) ? opts.selected : programs[0].id;
        const srcset = (p) => (p.srcset ? ` srcset="${esc(p.srcset)}"` : p.icon2x ? ` srcset="${esc(p.icon)} 1x, ${esc(p.icon2x)} 2x"` : '');
        const tile = (p) => `<button type="button" class="mow-prog${p.id === selected ? ' is-selected' : ''}" data-prog="${esc(p.id)}" role="option" aria-selected="${p.id === selected}">
                <img src="${esc(p.icon || '/static_images/vista-icons/generic-exe-32.png')}"${srcset(p)} width="32" height="32" alt="" draggable="false">
                <span class="mow-prog-text"><span class="mow-prog-name">${esc(p.name)}</span><span class="mow-prog-pub">${esc(p.publisher || '')}</span></span>
            </button>`;
        // openwith.exe's groups: Recommended Programs, then Other Programs (folded while a recommended one is picked)
        const grouped = programs.some((p) => p.group);
        const rec = grouped ? programs.filter((p) => p.group === 'recommended') : [];
        const other = grouped ? programs.filter((p) => p.group !== 'recommended') : [];
        const folded = grouped && rec.length > 0 && !other.some((p) => p.id === selected);
        const header = (label, kind, fold) => `<div class="mow-group${fold === null ? '' : ' is-foldable'}${fold ? ' is-folded' : ''}" data-group="${kind}"${fold === null ? '' : ` aria-expanded="${!fold}"`}><span class="mow-group-name">${esc(label)}</span><span class="mow-group-rule"></span>${fold === null ? '' : '<span class="mow-group-chevron"></span>'}</div>`;
        // grouped: each group's header over the list's whole inside width, its tiles in a grid of their own
        const tiles = (list, kind, fold) => `<div class="mow-tiles" data-group="${kind}"${fold ? ' hidden' : ''}>${list.map(tile).join('')}</div>`;
        const listBody = !grouped ? programs.map(tile).join('')
            : (rec.length ? header('Recommended Programs', 'recommended', null) + tiles(rec, 'recommended', false) : '')
                + (other.length ? header('Other Programs', 'other', rec.length ? folded : null) + tiles(other, 'other', folded) : '');
        const describe = opts.describe !== undefined ? opts.describe !== false : !grouped;
        const notes = programs.filter((p) => p.note);
        const selNote = (programs.find((p) => p.id === selected) || {}).note || '';
        const html = `<div class="mow mow-choose">${head(opts.fileName, 'Choose the program you want to use to open this file:')}
            <div class="mow-list vdt-edge${grouped ? ' is-grouped' : ''}${describe ? '' : ' is-tall'}" role="listbox" tabindex="0">${listBody}</div>
            ${describe ? `<label class="mow-label" for="mowDesc">Type a description that you want to use for this kind of file:</label>
            <input type="text" id="mowDesc" class="tbp-edit mow-desc" value="${esc(opts.description || '')}" spellcheck="false" autocomplete="off">` : ''}
            <div class="mow-row"><div class="win7 mow-check"><input type="checkbox" id="mowAlways"${opts.always === false ? '' : ' checked'}${opts.allowAlways === false ? ' disabled' : ''}><label for="mowAlways">Always use the selected program to open this kind of file</label></div><button type="button" class="btn-standard mow-browse" disabled>Browse...</button></div>
            <p class="mow-text mow-web"><span class="mow-web-text"${selNote ? ' hidden' : ''}>If the program you want is not in the list or on your computer, you can <span class="mow-link">look for the appropriate program on the Web</span>.</span>${notes.length ? `<span class="mow-web-note"${selNote ? '' : ' hidden'}>${esc(selNote || notes[0].note)}</span>` : ''}</p>
        </div>`;
        // the list's handlers: from onDialogReady, and from the next task as well, because the message box does not call
        // onDialogReady when it opens while its previous run is still settling (its listener scope never closed); once
        // per list (each run draws a new one)
        const wire = () => {
            const dlg = document.getElementById('confirmationDialog');
            const list = dlg && dlg.querySelector('.mow-choose .mow-list');
            if (!list || list.dataset.wired) return;
            list.dataset.wired = '1';
            // the message box is centred with translate(-50%, -50%): at an odd size every icon and line sat on half
            // a pixel (blurred). Once it has opened it is pinned to whole pixels, as settled windows are
            // (settleModalPixelAnchor, modalUtils.js; the next message box clears it when it lays itself out)
            let tries = 0;
            const settle = () => {
                if (!list.isConnected) return; // closed (another message box took the frame)
                if (dlg.classList.contains('hidden') || dlg.classList.contains('opening')) {
                    // still being shown: a few frames at most (its opening animation)
                    if ((tries += 1) < 25) setTimeout(settle, 60);
                    return;
                }
                if (typeof root.settleModalPixelAnchor === 'function') root.settleModalPixelAnchor(dlg);
            };
            setTimeout(settle, 0);
            const noteEl = dlg.querySelector('.mow-web-note');
            const webEl = dlg.querySelector('.mow-web-text');
            const pick = (btn) => {
                list.querySelectorAll('.mow-prog').forEach((b) => { const on = b === btn; b.classList.toggle('is-selected', on); b.setAttribute('aria-selected', String(on)); });
                // the phone's apps: what "Always use" can and cannot do there (Android keeps its own defaults)
                if (noteEl) {
                    const p = programs.find((x) => x.id === btn.dataset.prog);
                    // in the web line's place (its room, two lines): the dialog never changes height
                    if (p && p.note) noteEl.textContent = p.note;
                    noteEl.hidden = !(p && p.note);
                    if (webEl) webEl.hidden = !!(p && p.note);
                }
            };
            // Other Programs' header (its name, rule or chevron) folds and unfolds the group
            const fold = (head) => {
                const folded = !head.classList.contains('is-folded');
                head.classList.toggle('is-folded', folded);
                head.setAttribute('aria-expanded', String(!folded));
                const body = list.querySelector('.mow-tiles[data-group="other"]');
                if (body) body.hidden = folded;
            };
            list.addEventListener('click', (ev) => {
                const head = ev.target.closest('.mow-group.is-foldable');
                if (head) { fold(head); return; }
                const b = ev.target.closest('.mow-prog');
                if (b) pick(b);
            });
            // a double click is OK, as in openwith.exe
            list.addEventListener('dblclick', (ev) => {
                const b = ev.target.closest('.mow-prog');
                if (!b) return;
                pick(b);
                const ok = dlg.querySelector('.btn-standard.primary, button.primary');
                if (ok) ok.click();
            });
        };
        const shown = dialog(html, {
            title: 'Open With',
            width: 590,
            onDialogReady: wire,
            resolveValue: (v, dlg) => {
                if (!v) return null;
                const sel = dlg.querySelector('.mow-prog.is-selected');
                const always = dlg.querySelector('#mowAlways');
                const desc = dlg.querySelector('#mowDesc');
                return sel ? { id: sel.dataset.prog, always: !!(always && always.checked && !always.disabled), description: desc ? desc.value : '' } : null;
            }
        });
        setTimeout(wire, 0);
        return shown;
    }

    root.melatonOpenWith = { cannotOpen, choose, ANDROID_RUNTIME };
})(typeof window !== 'undefined' ? window : globalThis);
