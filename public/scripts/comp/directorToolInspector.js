// Director tool inspector: a light Vista window that reads a tool call's parameters and result as
// labelled fields instead of raw JSON (Yukimi 2026-11-01). Opened by director.js openToolPayload.
// Input / Output tabs break the call down; Raw keeps the wrapped JSON for copying.
(function () {
    const ID = 'directorToolInspector';
    const IMAGE_RE = /\.(png|webp|jpe?g|gif)$/i;
    const LONG_TEXT = 110;
    const MAX_ITEMS = 60;
    const MAX_DEPTH = 5;
    // Keys read first when present: what the call was about.
    const LEAD_KEYS = ['filename', 'filenames', 'name', 'title', 'query', 'pattern', 'command', 'prompt', 'uc', 'negativePrompt', 'characters', 'change', 'params', 'error', 'message'];
    const QUIET_KEYS = new Set(['success', 'ok']);
    const BLURBS = {
        apply_studio_changes: 'Changes the Studio: prompt, characters, and settings.',
        print_studio: 'Presses Generate in the Studio.',
        generate_image: 'Prints an image without the Studio.',
        await_generation_job: 'Waits for a print to finish.',
        get_generation_job: 'Reads where a print job is.',
        get_generated_image: 'Reads a saved print and its settings.',
        read_image_metadata: 'Reads the settings stored in an image.',
        get_session_state: 'Reads the clients, windows, and Studio.',
        get_studio_state: 'Reads the Studio.',
        save_memory: 'Saves what worked as a memory.',
        get_memory: 'Reads one memory.',
        search_memories: 'Searches the memories.',
        list_memories: 'Lists the memories.',
        set_session_tasks: 'Sets the task list for this chat.',
        set_session_title: 'Names this chat.',
        show_chat_image: 'Shows an image in the chat.',
        open_in_studio: 'Opens an image in the Studio.',
        search_explore: 'Searches Explore.',
        search_nax: 'Searches NAX tags.',
        search_autofill: 'Looks up tags.',
        get_prompt_guide: 'Reads the prompt guide.',
        get_workspaces: 'Lists the workspaces.',
        request_form: 'Asks you with a form.',
        upscale_image: 'Upscales an image.',
        expand_image: 'Expands an image.',
        animate_image: 'Animates an image.',
        shell: 'Runs a command on Dreamspace.',
        grep: 'Searches files on Dreamspace.',
        read: 'Reads a file on Dreamspace.'
    };

    let dlg = null;

    function el(tag, className, text) {
        const n = document.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined && text !== null) n.textContent = String(text);
        return n;
    }

    function toolKey(name) {
        return String(name || '').replace(/^mcp__/i, '').split('__').pop().replace(/[-\s]+/g, '_').toLowerCase();
    }

    function tryJson(text) {
        if (typeof text !== 'string') return text;
        const t = text.trim();
        if (!t || !/^[[{"]/.test(t)) return text;
        try { return JSON.parse(t); } catch (_) { return text; }
    }

    // MCP results come wrapped: { content: [{ text }] } or { content: [{ text: { text } }] }, the text often JSON.
    function unwrap(value) {
        let v = tryJson(value);
        if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.content)) {
            const parts = v.content.map((item) => {
                if (!item || typeof item !== 'object') return item;
                let t = item.text;
                if (t && typeof t === 'object' && 'text' in t) t = t.text;
                if (typeof t === 'string') return tryJson(t);
                if (item.type === 'image') return `(image, ${item.mimeType || 'data'})`;
                return t !== undefined ? t : item;
            });
            const isError = v.isError === true;
            v = parts.length === 1 ? parts[0] : parts;
            if (isError && v && typeof v === 'object' && !Array.isArray(v)) v = Object.assign({ error: true }, v);
            else if (isError) v = { error: v };
        }
        return v;
    }

    function humanKey(key) {
        const s = String(key)
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .trim();
        const lower = s.toLowerCase();
        return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : String(key);
    }

    function orderedKeys(obj) {
        const keys = Object.keys(obj).filter((k) => !QUIET_KEYS.has(k) || obj[k] === false);
        const lead = LEAD_KEYS.filter((k) => keys.includes(k));
        return lead.concat(keys.filter((k) => !lead.includes(k)));
    }

    function imageUrl(name) {
        if (typeof name !== 'string' || !IMAGE_RE.test(name) || /^https?:|^data:/i.test(name)) return '';
        if (name.startsWith('/')) return name;
        try {
            // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
            if (typeof localGalleryImageUrl === 'function') return localGalleryImageUrl(name);
        } catch (_) { /* fall through */ }
        return `/images/${encodeURIComponent(name)}`;
    }

    function renderValue(value, depth) {
        if (value === null || value === undefined || value === '') return el('span', 'dti-none', 'none');
        if (typeof value === 'boolean') return el('span', value ? 'dti-yes' : 'dti-no', value ? 'Yes' : 'No');
        if (typeof value === 'number') return el('span', 'dti-num', value.toLocaleString());
        if (typeof value === 'string') {
            if (/^data:image\//.test(value)) return el('span', 'dti-none', `(image data, ${Math.round(value.length * 0.75 / 1024)} KB)`);
            const url = imageUrl(value);
            if (url) {
                const fig = el('span', 'dti-image');
                const img = el('img');
                img.loading = 'lazy';
                img.alt = '';
                img.src = url;
                img.addEventListener('error', () => img.remove());
                fig.append(img, el('span', 'dti-image-name', value));
                return fig;
            }
            if (value.length > LONG_TEXT || value.includes('\n')) return el('div', 'dti-text', value);
            return el('span', 'dti-str', value);
        }
        if (depth >= MAX_DEPTH) return el('div', 'dti-text dti-mono', JSON.stringify(value, null, 1));
        if (Array.isArray(value)) {
            if (!value.length) return el('span', 'dti-none', 'none');
            const simple = value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
            if (simple && !value.some((v) => imageUrl(v)) && value.join(', ').length <= 240) {
                const wrap = el('span', 'dti-chips');
                value.forEach((v) => wrap.appendChild(el('span', 'dti-chip', v === null ? 'none' : String(v))));
                return wrap;
            }
            const list = el('div', 'dti-list');
            value.slice(0, MAX_ITEMS).forEach((v, i) => {
                const item = el('div', 'dti-item');
                item.appendChild(el('div', 'dti-item-head', `${i + 1}`));
                const body = el('div', 'dti-item-body');
                body.appendChild(v && typeof v === 'object' && !Array.isArray(v) ? renderTable(v, depth + 1) : renderValue(v, depth + 1));
                item.appendChild(body);
                list.appendChild(item);
            });
            if (value.length > MAX_ITEMS) list.appendChild(el('div', 'dti-more', `${value.length - MAX_ITEMS} more (see Raw)`));
            return list;
        }
        return renderTable(value, depth + 1);
    }

    function renderTable(obj, depth) {
        const keys = orderedKeys(obj);
        if (!keys.length) return el('span', 'dti-none', 'none');
        const table = el('div', 'dti-table');
        keys.forEach((key) => {
            const row = el('div', 'dti-row');
            row.appendChild(el('div', 'dti-key', humanKey(key)));
            const cell = el('div', 'dti-value');
            cell.appendChild(renderValue(obj[key], depth || 0));
            row.appendChild(cell);
            table.appendChild(row);
        });
        return table;
    }

    function renderSide(raw, emptyText) {
        const page = el('div', 'dti-page-body');
        const value = unwrap(raw);
        if (value === '' || value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) {
            page.appendChild(el('div', 'dti-empty', emptyText));
            return { page, value };
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) page.appendChild(renderTable(value, 0));
        else page.appendChild(renderValue(value, 0));
        return { page, value };
    }

    function rawText(value) {
        if (value === undefined || value === null || value === '') return '';
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
    }

    function isErrorResult(value, raw) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (value.error === true || value.success === false || value.ok === false) return true;
            if (typeof value.error === 'string' && value.error) return true;
        }
        return typeof raw === 'string' && /^\s*(error|failed)\b/i.test(raw);
    }

    function build() {
        const modal = el('div', 'modal hidden resizeable-window director-inspector');
        modal.id = ID;
        modal.dataset.windowIdentifier = ID;
        modal.dataset.windowClient = 'light';
        modal.dataset.iconOwnerId = 'directorWindow';
        modal.dataset.windowMinWidth = '380';
        modal.dataset.windowMinHeight = '300';
        modal.setAttribute('role', 'dialog');
        const cap = el('div', 'modal-window-title');
        const main = el('div', 'modal-window-title-main');
        const titleText = el('span', '', 'Tool');
        main.appendChild(titleText);
        cap.appendChild(main);
        const controls = el('div', 'modal-window-controls');
        const close = el('button', 'btn-danger close-btn btn-small');
        close.type = 'button';
        close.title = 'Close';
        const x = el('i', 'fa-regular fa-xmark-large');
        x.setAttribute('aria-hidden', 'true');
        close.appendChild(x);
        controls.appendChild(close);
        const content = el('div', 'modal-content dti-client');
        content.innerHTML = `
            <div class="dti-head">
                <div class="dti-instruction"></div>
                <div class="dti-blurb"></div>
            </div>
            <div class="dti-tabs" role="tablist">
                <button type="button" class="dti-tab" role="tab" data-tab="input">Input</button>
                <button type="button" class="dti-tab" role="tab" data-tab="output">Output</button>
                <button type="button" class="dti-tab" role="tab" data-tab="raw">Raw</button>
            </div>
            <div class="dti-pane">
                <div class="dti-page" data-page="input" role="tabpanel"></div>
                <div class="dti-page" data-page="output" role="tabpanel"></div>
                <div class="dti-page" data-page="raw" role="tabpanel"><pre class="dti-raw selectable"></pre></div>
            </div>
            <div class="dti-footer">
                <span class="dti-status"></span>
                <button type="button" class="btn-secondary" data-action="copy">Copy</button>
                <button type="button" class="btn-primary" data-action="close" data-dialog-primary="1">Close</button>
            </div>`;
        modal.append(cap, el('div', 'modal-focus-overlay'), controls, content);
        document.body.appendChild(modal);
        const shut = () => {
            // closeModal: public/scripts/comp/modalUtils.js
            if (typeof closeModal === 'function') closeModal(modal);
            else modal.classList.add('hidden');
        };
        close.addEventListener('click', shut);
        content.addEventListener('click', (event) => {
            const tab = event.target.closest('.dti-tab');
            if (tab) {
                select(tab.dataset.tab);
                return;
            }
            const action = event.target.closest('[data-action]');
            if (!action) return;
            if (action.dataset.action === 'close') shut();
            if (action.dataset.action === 'copy') copy();
        });
        modal.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') shut();
        });
        dlg = { modal, content, titleText, tab: 'input', rawByTab: {} };
        return dlg;
    }

    function select(tab) {
        if (!dlg) return;
        dlg.tab = tab;
        dlg.content.querySelectorAll('.dti-tab').forEach((t) => {
            const on = t.dataset.tab === tab;
            t.classList.toggle('is-selected', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        dlg.content.querySelectorAll('.dti-page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
        const page = dlg.content.querySelector(`.dti-page[data-page="${tab}"]`);
        if (page) page.scrollTop = 0;
    }

    function copy() {
        if (!dlg) return;
        const text = dlg.rawByTab[dlg.tab] || dlg.rawByTab.raw || '';
        const done = () => {
            if (typeof showGlassToast === 'function') showGlassToast('success', 'Copied', dlg.tab === 'raw' ? 'Parameters and result' : (dlg.tab === 'input' ? 'Parameters' : 'Result'), false, 1200);
        };
        try {
            navigator.clipboard.writeText(text).then(done, () => {});
        } catch (_) { /* no clipboard */ }
    }

    // payload: { name, label, args, result, text, detail }
    function open(payload) {
        const p = payload || {};
        const d = dlg || build();
        const label = p.label || p.name || 'Tool';
        const key = toolKey(p.name || p.label);
        d.titleText.textContent = `${label} - Inspector`;
        d.modal.setAttribute('aria-label', d.titleText.textContent);
        d.content.querySelector('.dti-instruction').textContent = label;
        const blurb = BLURBS[key] || (p.name && p.name !== label ? p.name.replace(/^mcp__/i, '').replace(/__/g, ' / ') : 'Tool call');
        d.content.querySelector('.dti-blurb').textContent = blurb;

        const input = renderSide(p.args, 'This call had no parameters.');
        const hasResult = p.result !== undefined && p.result !== null && p.result !== '';
        const output = renderSide(hasResult ? p.result : (p.text || ''), 'Nothing came back.');
        const failed = isErrorResult(output.value, p.result);
        const inPage = d.content.querySelector('.dti-page[data-page="input"]');
        const outPage = d.content.querySelector('.dti-page[data-page="output"]');
        inPage.replaceChildren(input.page);
        outPage.replaceChildren(output.page);
        if (failed) outPage.prepend(el('div', 'dti-error', 'The tool reported an error.'));
        d.rawByTab = {
            input: rawText(input.value),
            output: rawText(output.value),
            raw: [`Parameters\n${rawText(input.value) || '(none)'}`, `Result\n${rawText(output.value) || '(none)'}`].join('\n\n')
        };
        d.content.querySelector('.dti-raw').textContent = d.rawByTab.raw;
        // detail is the row's one-line preview, already on screen: the status line only says what this window is.
        d.content.querySelector('.dti-status').textContent = failed ? 'Read-only · Error' : 'Read-only';
        select(failed ? 'output' : 'input');
        // openModal / bringModalToFront: public/scripts/comp/modalUtils.js
        if (typeof openModal === 'function') openModal(d.modal);
        d.modal.classList.remove('hidden');
        if (typeof bringModalToFront === 'function') bringModalToFront(d.modal);
    }

    window.DirectorToolInspector = { open, _test: { unwrap, humanKey, toolKey } };
})();
