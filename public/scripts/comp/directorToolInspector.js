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
    // Code, paths, and command output read in a fixed-width face.
    const MONO_KEYS = new Set(['command', 'stdout', 'stderr', 'interleavedOutput', 'script', 'diffString', 'old_string', 'new_string',
        'streamContent', 'afterFullFileContent', 'contents', 'pattern', 'glob', 'globPattern', 'path', 'file_path', 'filePath',
        'workingDirectory', 'targetDirectory', 'output', 'diff', 'code', 'css', 'html', 'js', 'json']);
    // A very long string (a whole file) shows its start; Raw has all of it.
    const MAX_TEXT = 12000;
    const BLURBS = {
        advanced_tools: 'Finds or runs one of the less common Dreamscape tools.',
        agent: 'Hands part of the work to a helper agent.',
        animate_image: 'Animates an image.',
        apply_studio_changes: 'Changes the Studio: prompt, characters, and settings.',
        askquestion: 'Asks you a question.',
        await_generation_job: 'Waits for a print to finish.',
        bind_session: 'Picks which open Dreamscape tab the chat works with.',
        browser_navigate: 'Opens a page in the Dreamspace browser.',
        browser_tabs: 'Lists or switches the Dreamspace browser tabs.',
        close_session_tasks: 'Clears the task list for this chat.',
        count_prompt_tokens: 'Counts how many tokens a prompt uses.',
        create_phasewalker: 'Sets up a Phasewalker (a prompt that changes per phase).',
        create_shortcut: 'Puts a shortcut on the desktop.',
        decompile_phasewalker: 'Turns a Phasewalker back into one plain prompt.',
        delete_nax_tag: 'Deletes a NAX tag.',
        edit: 'Edits a file on Dreamspace.',
        ensure_artifact: 'Saves a print as a file on Dreamspace.',
        expand_image: 'Expands an image.',
        generate_image: 'Prints an image without the Studio.',
        generate_nax_tag: 'Writes a NAX tag from a reference.',
        get_character_card: 'Reads what is known about a character.',
        get_character_db_entry: 'Reads a character database entry.',
        get_client_physics: 'Reads the body sliders the client would use.',
        get_generated_image: 'Reads a saved print and its settings.',
        get_generation_job: 'Reads where a print job is.',
        get_memory: 'Reads a memory.',
        get_note: 'Reads a note.',
        get_open_windows: 'Lists the windows open in Dreamscape.',
        get_prompt_guide: 'Reads the prompt guide.',
        get_session_state: 'Reads the clients, windows, and Studio.',
        get_session_tasks: 'Reads the task list for this chat.',
        get_studio_state: 'Reads the Studio.',
        get_wiki_page: 'Reads a tag wiki page.',
        get_workspace_config: 'Reads the settings of a workspace.',
        get_workspaces: 'Lists the workspaces.',
        getdynamictools: 'Looks up the tools a server offers.',
        glob: 'Finds files on Dreamspace by name.',
        grep: 'Searches files on Dreamspace.',
        inspect_elements: 'Looks at elements in the Dreamscape page.',
        ledge: 'Opens or changes a ledge (a desk of prints).',
        list_clients: 'Lists the Dreamscape tabs that are connected.',
        list_generation_requests: 'Lists recent print requests.',
        list_mail: 'Lists mail in Dovecote.',
        list_memories: 'Lists the memories.',
        list_notes: 'Lists the notes.',
        lookup_character_age: 'Looks up the age of a character.',
        mcp: 'Calls a tool on an MCP server.',
        offer_director_window: 'Offers to open the Director in its own window.',
        omegasearch: 'Searches the gallery.',
        open_application: 'Opens an app in Dreamscape.',
        open_in_lumen: 'Opens an image in Lumen.',
        open_in_studio: 'Opens an image in the Studio.',
        print_studio: 'Presses Generate in the Studio.',
        read: 'Reads a file on Dreamspace.',
        read_image_metadata: 'Reads the settings stored in an image.',
        report_issue: 'Reports a problem.',
        request_form: 'Asks you with a form.',
        request_workspace_switch: 'Asks to switch workspace.',
        resolve_lookback: 'Reads the print a lookback link points at.',
        restart_client: 'Restarts the Dreamscape tab.',
        run_client_js: 'Runs a script in the Dreamscape tab.',
        save_character_db_entry: 'Saves a character database entry.',
        save_memory: 'Saves what worked as a memory.',
        save_note_content: 'Writes a note.',
        save_preset: 'Saves a Studio preset.',
        search_autofill: 'Looks up tags.',
        search_character_db: 'Searches the character database.',
        search_explore: 'Searches Explore.',
        search_memories: 'Searches the memories.',
        search_nax: 'Searches NAX tags.',
        search_wiki: 'Searches the tag wiki.',
        send_mail: 'Sends mail from Dovecote.',
        set_session_task: 'Ticks or changes one task.',
        set_session_tasks: 'Sets the task list for this chat.',
        set_session_title: 'Names this chat.',
        set_session_type: 'Sets how long this chat is kept.',
        set_window: 'Moves or sizes a window.',
        shell: 'Runs a command on Dreamspace.',
        show_chat_image: 'Shows an image in the chat.',
        tool: 'A tool call.',
        toolsearch: 'Looks up which tools exist.',
        update_client: 'Updates the Dreamscape tab.',
        upscale_image: 'Upscales an image.',
        vfs_delete: 'Deletes a file in the virtual drive.',
        vfs_list: 'Lists a folder in the virtual drive.',
        web_fetch_exa: 'Reads a web page.',
        web_search_exa: 'Searches the web.',
        webfetch: 'Reads a web page.',
        websearch: 'Searches the web.',
        write: 'Writes a file on Dreamspace.'
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

    // Close a JSON text that was cut off (payloads were stored capped at 4,000 characters): finish the open
    // string, then close the open objects and arrays. When that does not parse, fall back to the last point
    // where a value had ended (before a comma, or just after an opener). undefined when nothing is usable.
    function repairJson(text) {
        const stack = [];
        const safe = [];
        let inStr = false;
        let esc = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inStr) {
                if (esc) esc = false;
                else if (ch === '\\') esc = true;
                else if (ch === '"') inStr = false;
                continue;
            }
            if (ch === '"') inStr = true;
            else if (ch === '{' || ch === '[') {
                stack.push(ch);
                safe.push({ at: i + 1, stack: stack.slice() });
            } else if (ch === '}' || ch === ']') stack.pop();
            else if (ch === ',') safe.push({ at: i, stack: stack.slice() });
        }
        const close = (body, open) => body + open.slice().reverse().map((c) => (c === '{' ? '}' : ']')).join('');
        const attempt = (body) => {
            try { return { ok: true, value: JSON.parse(body) }; } catch (_) { return { ok: false }; }
        };
        let body = text;
        if (inStr) body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/\\$/, '') + '"';
        let tried = attempt(close(body, stack));
        if (tried.ok) return tried.value;
        // a cut key or a key without its value: drop the dangling tail
        tried = attempt(close(body.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, ''), stack));
        if (tried.ok) return tried.value;
        for (let k = safe.length - 1, n = 0; k >= 0 && n < 60; k--, n++) {
            tried = attempt(close(text.slice(0, safe[k].at), safe[k].stack));
            if (tried.ok) return tried.value;
        }
        return undefined;
    }

    // Parse a payload text the way the tools left it. ctx collects what was off about it.
    function tryJson(text, ctx) {
        if (typeof text !== 'string') return text;
        let t = text.trim();
        if (!t) return text;
        const note = ctx || {};
        // Claude appends the images it was shown: "...}\n[Image: source: /path]"
        const images = [];
        t = t.replace(/(?:\s*\[Image: source: ([^\]\n]+)\])+\s*$/g, (all) => {
            all.replace(/\[Image: source: ([^\]\n]+)\]/g, (_, src) => { images.push(src.trim()); return ''; });
            return '';
        }).trim();
        if (images.length) note.images = (note.images || []).concat(images);
        // "Error: {json}" and "Error: <tool_use_error>...</tool_use_error>"
        const err = /^error:\s*/i.exec(t);
        if (err) {
            note.error = true;
            t = t.slice(err[0].length).replace(/^<tool_use_error>([\s\S]*?)<\/tool_use_error>$/, '$1').trim();
        }
        if (!/^[[{]/.test(t)) {
            if (/^"/.test(t)) {
                try { return JSON.parse(t); } catch (_) { /* plain text */ }
            }
            return images.length || err ? t : text;
        }
        try { return JSON.parse(t); } catch (_) { /* cut off? */ }
        const cut = t.replace(/\s*(?:\u2026|\.\.\.)$/, '');
        const repaired = repairJson(cut);
        if (repaired !== undefined) {
            note.truncated = Math.max(note.truncated || 0, text.length);
            return repaired;
        }
        return err || images.length ? t : text;
    }

    function imagePart(item) {
        const src = item && typeof item === 'object' ? (item.image && typeof item.image === 'object' ? item.image : item) : null;
        if (!src || typeof src.data !== 'string' || !src.data) return '';
        const mime = typeof src.mimeType === 'string' && /^image\//.test(src.mimeType) ? src.mimeType : 'image/png';
        return `data:${mime};base64,${src.data}`;
    }

    // MCP results come wrapped: { content: [{ text }] } or { content: [{ text: { text } }] }, the text often JSON,
    // sometimes beside an image part ({ data, mimeType }).
    function unwrap(value, ctx) {
        const note = ctx || {};
        let v = tryJson(value, note);
        if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.content)) {
            const parts = [];
            v.content.forEach((item) => {
                if (!item || typeof item !== 'object') {
                    if (item !== undefined && item !== null && item !== '') parts.push(item);
                    return;
                }
                const image = imagePart(item);
                if (image) {
                    parts.push(image);
                    return;
                }
                let t = item.text;
                if (t && typeof t === 'object' && 'text' in t) {
                    const rest = Object.assign({}, t);
                    delete rest.text;
                    t = t.text;
                    // Cursor saves a big result to a file and leaves the text empty: say where it went.
                    if (!t && Object.keys(rest).length) {
                        parts.push(rest);
                        return;
                    }
                }
                if (typeof t === 'string') {
                    if (t !== '') parts.push(tryJson(t, note));
                    return;
                }
                if (t !== undefined) parts.push(t);
                else if (item.type !== 'text') parts.push(item);
            });
            const isError = v.isError === true || note.error === true;
            v = parts.length === 1 ? parts[0] : (parts.length ? parts : '');
            if (isError) note.error = true;
        } else if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.content === 'string' && Object.keys(v).length === 1) {
            // { content: "<json>" } (Cursor's dynamic tool listing)
            const inner = tryJson(v.content, note);
            if (inner && typeof inner === 'object') v = inner;
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
        const keys = Object.keys(obj).filter((k) => {
            if (QUIET_KEYS.has(k)) return obj[k] === false;
            // empty reminder lists are noise
            if (k === 'systemReminders' || k === 'relatedCursorRules' || k === 'relatedCursorRulePaths') return Array.isArray(obj[k]) ? obj[k].length > 0 : !!obj[k];
            return true;
        });
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

    function renderValue(value, depth, key) {
        if (value === null || value === undefined || value === '') return el('span', 'dti-none', 'none');
        if (typeof value === 'boolean') return el('span', value ? 'dti-yes' : 'dti-no', value ? 'Yes' : 'No');
        if (typeof value === 'number') return el('span', 'dti-num', value.toLocaleString());
        if (typeof value === 'string') {
            if (/^data:image\/[a-z+.-]+;base64,/i.test(value)) {
                const fig = el('span', 'dti-image');
                const img = el('img');
                img.alt = '';
                img.src = value;
                img.addEventListener('error', () => img.remove());
                fig.append(img, el('span', 'dti-image-name', `Image, ${Math.round(value.length * 0.75 / 1024).toLocaleString()} KB`));
                return fig;
            }
            if (/^data:/i.test(value)) return el('span', 'dti-none', `(data, ${Math.round(value.length * 0.75 / 1024).toLocaleString()} KB)`);
            // JSON inside a string (a script's return value, a listing): show its fields
            const trimmed = value.trim();
            if (depth < MAX_DEPTH && trimmed.length > 2 && /^[[{]/.test(trimmed)) {
                try {
                    const inner = JSON.parse(trimmed);
                    if (inner && typeof inner === 'object') return renderValue(inner, depth + 1, key);
                } catch (_) { /* text after all */ }
            }
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
            // broken JSON (a string cut off in the middle when it was saved) still reads best fixed-width
            const mono = MONO_KEYS.has(String(key || '')) || /^[[{]/.test(trimmed);
            if (value.length > MAX_TEXT) {
                const box = el('div', `dti-text${mono ? ' dti-mono' : ''}`, value.slice(0, MAX_TEXT));
                box.appendChild(el('div', 'dti-more', `${(value.length - MAX_TEXT).toLocaleString()} more characters (see Raw)`));
                return box;
            }
            if (value.length > LONG_TEXT || value.includes('\n')) return el('div', `dti-text${mono ? ' dti-mono' : ''}`, value);
            return el('span', `dti-str${mono ? ' dti-mono' : ''}`, value);
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
                body.appendChild(v && typeof v === 'object' && !Array.isArray(v) ? renderTable(v, depth + 1) : renderValue(v, depth + 1, key));
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
        // From the third level down the label sits above its value, so deep settings never run out of width.
        const table = el('div', depth >= 2 ? 'dti-table dti-deep' : 'dti-table');
        keys.forEach((key) => {
            const row = el('div', 'dti-row');
            row.appendChild(el('div', 'dti-key', humanKey(key)));
            const cell = el('div', 'dti-value');
            cell.appendChild(renderValue(obj[key], depth || 0, key));
            row.appendChild(cell);
            table.appendChild(row);
        });
        return table;
    }

    function renderSide(raw, emptyText) {
        const page = el('div', 'dti-page-body');
        const note = {};
        const value = unwrap(raw, note);
        if (note.truncated) {
            page.appendChild(el('div', 'dti-note', `This was saved cut off at ${note.truncated.toLocaleString()} characters; the fields below stop where it ends.`));
        }
        if (value === '' || value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) {
            page.appendChild(el('div', 'dti-empty', emptyText));
        } else if (value && typeof value === 'object' && !Array.isArray(value)) page.appendChild(renderTable(value, 0));
        else page.appendChild(renderValue(value, 0));
        if (note.images && note.images.length) {
            const row = el('div', 'dti-table dti-attached');
            const r = el('div', 'dti-row');
            r.appendChild(el('div', 'dti-key', note.images.length > 1 ? 'Images shown' : 'Image shown'));
            const cell = el('div', 'dti-value');
            note.images.forEach((src) => cell.appendChild(el('div', 'dti-str dti-mono', src)));
            r.appendChild(cell);
            row.appendChild(r);
            page.appendChild(row);
        }
        return { page, value, note };
    }

    function rawText(value) {
        if (value === undefined || value === null || value === '') return '';
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
    }

    function isErrorResult(value, raw, note) {
        if (note && note.error) return true;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            // a job that is still running answers success:false with pending:true; ok:false beside success:true is a no-op
            if (value.pending === true && !value.error) return false;
            if (value.error === true || value.success === false || (value.ok === false && value.success !== true) || value.failure) return true;
            if (typeof value.error === 'string' && value.error) return true;
            if (value.error && typeof value.error === 'object') return true;
            if (typeof value.exitCode === 'number' && value.exitCode !== 0) return true;
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
        // vfs_*, browser_* and other families without their own line fall back to the tool's own name
        const blurb = BLURBS[key] || (p.name && p.name !== label ? p.name.replace(/^mcp__/i, '').replace(/__/g, ' / ') : 'A tool call.');
        d.content.querySelector('.dti-blurb').textContent = blurb;

        const input = renderSide(p.args, 'This call had no parameters.');
        const hasResult = p.result !== undefined && p.result !== null && p.result !== '';
        const output = renderSide(hasResult ? p.result : (p.text || ''), 'Nothing came back.');
        const failed = isErrorResult(output.value, p.result, output.note);
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

    window.DirectorToolInspector = { open, _test: { unwrap, humanKey, toolKey, repairJson, isErrorResult } };
})();
