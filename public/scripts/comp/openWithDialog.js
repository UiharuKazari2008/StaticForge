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
 *                          icon2x }]. Resolves { id, always, description } | null.
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
        const tile = (p) => `<button type="button" class="mow-prog${p.id === selected ? ' is-selected' : ''}" data-prog="${esc(p.id)}" role="option" aria-selected="${p.id === selected}">
                <img src="${esc(p.icon || '/static_images/vista-icons/generic-exe-32.png')}"${p.icon2x ? ` srcset="${esc(p.icon)} 1x, ${esc(p.icon2x)} 2x"` : ''} alt="" draggable="false">
                <span class="mow-prog-text"><span class="mow-prog-name">${esc(p.name)}</span><span class="mow-prog-pub">${esc(p.publisher || '')}</span></span>
            </button>`;
        const html = `<div class="mow mow-choose">${head(opts.fileName, 'Choose the program you want to use to open this file:')}
            <div class="mow-list vdt-edge" role="listbox" tabindex="0">${programs.map(tile).join('')}</div>
            <label class="mow-label" for="mowDesc">Type a description that you want to use for this kind of file:</label>
            <input type="text" id="mowDesc" class="tbp-edit mow-desc" value="${esc(opts.description || '')}" spellcheck="false" autocomplete="off">
            <div class="mow-row"><div class="win7 mow-check"><input type="checkbox" id="mowAlways"${opts.always === false ? '' : ' checked'}${opts.allowAlways === false ? ' disabled' : ''}><label for="mowAlways">Always use the selected program to open this kind of file</label></div><button type="button" class="btn-standard mow-browse" disabled>Browse...</button></div>
            <p class="mow-text mow-web">If the program you want is not in the list or on your computer, you can <span class="mow-link">look for the appropriate program on the Web</span>.</p>
        </div>`;
        return dialog(html, {
            title: 'Open With',
            width: 590,
            onDialogReady: () => {
                const dlg = document.getElementById('confirmationDialog');
                const list = dlg && dlg.querySelector('.mow-list');
                if (!list) return;
                const pick = (btn) => {
                    list.querySelectorAll('.mow-prog').forEach((b) => { const on = b === btn; b.classList.toggle('is-selected', on); b.setAttribute('aria-selected', String(on)); });
                };
                list.addEventListener('click', (ev) => { const b = ev.target.closest('.mow-prog'); if (b) pick(b); });
                // a double click is OK, as in openwith.exe
                list.addEventListener('dblclick', (ev) => {
                    const b = ev.target.closest('.mow-prog');
                    if (!b) return;
                    pick(b);
                    const ok = dlg.querySelector('.btn-standard.primary, button.primary');
                    if (ok) ok.click();
                });
            },
            resolveValue: (v, dlg) => {
                if (!v) return null;
                const sel = dlg.querySelector('.mow-prog.is-selected');
                const always = dlg.querySelector('#mowAlways');
                const desc = dlg.querySelector('#mowDesc');
                return sel ? { id: sel.dataset.prog, always: !!(always && always.checked && !always.disabled), description: desc ? desc.value : '' } : null;
            }
        });
    }

    root.melatonOpenWith = { cannotOpen, choose, ANDROID_RUNTIME };
})(typeof window !== 'undefined' ? window : globalThis);
