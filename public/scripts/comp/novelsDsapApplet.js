/**
 * Novels DSAP — workspace novel notes browser at novels.dyna.dreamscape.jp
 * Depends on: dsapRegistry.js, novelManager.js, websocket.js
 */

const NOVELS_DSAP_URL = 'novels.dyna.dreamscape.jp';

function novelsDsapEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function novelsDsapResolveWorkspaceId(host) {
    const segments = host.getPathSegments();
    if (segments[0] && segments[0] !== 'novel') return decodeURIComponent(segments[0]);
    const fromQuery = host.getQueryParam('workspace') || host.getQueryParam('ws');
    if (fromQuery) return fromQuery;
    return typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
}

const novelsDsapScopedCss = `
[data-dsap="novels"] { padding: 1rem; color: #eee; }
[data-dsap="novels"] .novels-header { margin-bottom: 1rem; }
[data-dsap="novels"] .novels-list-item { display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0.75rem; margin-bottom:0.35rem; border-radius:6px; background:rgba(0,0,0,0.2); cursor:pointer; }
[data-dsap="novels"] .novels-list-item:hover { background:rgba(0,0,0,0.35); }
[data-dsap="novels"] .novels-editor-textarea { width:100%; min-height:280px; margin:0.5rem 0; font-family:monospace; line-height:1.5; }
[data-dsap="novels"] .novels-actions { display:flex; gap:0.35rem; flex-wrap:wrap; margin-top:0.5rem; }
`;

const novelsDsapDriver = {
    _state: null,

    init(host) {
        this._state = { host, workspaceId: novelsDsapResolveWorkspaceId(host) };
        const root = host.getRoot();
        root.addEventListener('click', (e) => this._onClick(e));
        this._render(host);
    },

    refresh(host) {
        this.destroy(host);
        this.init(host);
    },

    destroy(host) {
        this._state = null;
    },

    async _loadNovels() {
        if (!wsClient) return [];
        const result = await wsClient.novelList(this._state.workspaceId);
        return result?.novels || result?.data?.novels || [];
    },

    async _render(host) {
        const root = host.getRoot();
        const segments = host.getPathSegments();
        const noteId = segments[0] === 'novel' && segments[1] ? decodeURIComponent(segments[1]) : null;

        if (noteId) {
            const result = await wsClient.novelGet(noteId);
            const note = result?.note || result?.data?.note;
            root.innerHTML = `
                <div data-dsap="novels">
                    <div class="novels-header">
                        <button type="button" class="btn-secondary btn-small" data-novels-action="back"><i class="fas fa-arrow-left"></i></button>
                        <strong>${novelsDsapEscapeHtml(note?.name || 'Novel')}</strong>
                    </div>
                    <textarea class="novels-editor-textarea form-control director-prompt" data-novels-field="content">${novelsDsapEscapeHtml(note?.content || '')}</textarea>
                    <div class="novels-actions">
                        <button type="button" class="btn-secondary btn-small" data-novels-action="save"><i class="fas fa-save"></i> Save</button>
                        <button type="button" class="btn-secondary btn-small" data-novels-action="generate"><i class="fas fa-pen-fancy"></i> Generate</button>
                        <button type="button" class="btn-secondary btn-small" data-novels-action="undo"><i class="fas fa-undo"></i> Undo</button>
                    </div>
                </div>`;
            this._state.currentNoteId = noteId;
            return;
        }

        const novels = await this._loadNovels();
        const items = novels.length
            ? novels.map((n) => `
                <div class="novels-list-item" data-novels-id="${novelsDsapEscapeHtml(n.id)}">
                    <span>${novelsDsapEscapeHtml(n.name)}</span>
                    <span class="text-muted">${novelsDsapEscapeHtml(n.updated_at ? new Date(n.updated_at * 1000).toLocaleDateString() : '')}</span>
                </div>`).join('')
            : '<p>No novel notes in this workspace.</p>';

        root.innerHTML = `
            <div data-dsap="novels">
                <div class="novels-header"><h3>Novels</h3></div>
                <div class="novels-list">${items}</div>
            </div>`;
    },

    async _onClick(e) {
        const item = e.target.closest('[data-novels-id]');
        if (item) {
            const id = item.dataset.novelsId;
            this._state.host.navigate(`dsap://${NOVELS_DSAP_URL}/novel/${encodeURIComponent(id)}`);
            return;
        }
        const btn = e.target.closest('[data-novels-action]');
        if (!btn || !this._state) return;
        const action = btn.dataset.novelsAction;
        const noteId = this._state.currentNoteId;
        const root = this._state.host.getRoot();
        const textarea = root.querySelector('[data-novels-field="content"]');

        if (action === 'back') {
            this._state.host.navigate(`dsap://${NOVELS_DSAP_URL}/${encodeURIComponent(this._state.workspaceId)}`);
        } else if (action === 'save' && noteId && textarea) {
            await wsClient.novelUpdate(noteId, { content: textarea.value });
            this._state.host.showToast('Saved', 'success');
        } else if (action === 'generate' && noteId) {
            if (typeof novelRunGenerate === 'function') {
                await novelRunGenerate({ noteId });
            }
        } else if (action === 'undo' && noteId) {
            await wsClient.novelUndo(noteId);
            this._state.host.refresh();
        }
    }
};

function registerNovelsDsapApplet() {
    if (typeof registerDsap !== 'function') return;

    registerDsap({
        url: NOVELS_DSAP_URL,
        getContent() {
            return {
                html: '<div class="novels-dsap-root"></div>',
                css: novelsDsapScopedCss,
                drivers: novelsDsapDriver,
                baseBackground: '#1a1a2e'
            };
        }
    });
}

registerNovelsDsapApplet();
