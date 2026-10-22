// Request form presented by MCP request_form (modules/requestForm.js).
// Inline in the Director chat when that chat asked, otherwise #requestFormWindow (on the Vista
// desktop a property-sheet dialog: check boxes, drop-down lists, OK-style button first).

function requestFormVista() {
    return document.body.classList.contains('desktop-mode') && !document.body.classList.contains('windows-classic-theme');
}

function requestFormFieldValue(row) {
    const type = row.dataset.type;
    if (type === 'bool') {
        const check = row.querySelector('input[type="checkbox"]');
        if (check) return check.checked;
        const button = row.querySelector('button');
        return !!(button && button.dataset.state === 'on');
    }
    if (type === 'select') {
        const button = row.querySelector('button[data-value]');
        return button ? button.dataset.value : '';
    }
    if (type === 'int' || type === 'number') {
        const input = row.querySelector('input');
        if (!input || input.value === '') return null;
        const value = type === 'int' ? parseInt(input.value, 10) : Number(input.value);
        return Number.isFinite(value) ? value : null;
    }
    const box = row.querySelector('textarea, input');
    return box ? box.value : '';
}

function requestFormCollect(host) {
    const values = {};
    let missing = '';
    host.querySelectorAll('[data-field-id]').forEach((row) => {
        const id = row.dataset.fieldId;
        const value = requestFormFieldValue(row);
        const required = row.dataset.required === '1';
        const empty = value == null || value === '';
        if (required && empty && !missing) missing = row.dataset.label || id;
        values[id] = value;
    });
    return { values, missing };
}

function requestFormSend(spec, values, cancelled) {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        showGlassToast('error', null, 'WebSocket not connected');
        return;
    }
    window.wsClient.send({
        type: 'request_form_submit',
        requestId: Date.now().toString(),
        id: spec.id,
        values: values || null,
        cancelled: cancelled === true
    });
}

function requestFormOptions(data) {
    return (data.options || []).map((option) => {
        if (typeof option === 'string' || typeof option === 'number') {
            const value = String(option);
            return { value, label: value };
        }
        if (!option || typeof option !== 'object') return null;
        const value = option.value != null ? String(option.value) : String(option.label || '');
        if (!value) return null;
        return { label: option.label != null ? String(option.label) : value, value };
    }).filter(Boolean);
}

function requestFormSelect(data, vista) {
    const options = requestFormOptions(data);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = vista ? 'custom-dropdown-btn' : 'btn-secondary';
    const initial = options.find((option) => data.default != null && String(data.default) === option.value) || options[0];
    button.dataset.value = initial ? initial.value : '';
    button.textContent = initial ? initial.label : 'Choose';
    if (!contextMenu) return button;
    if (vista) {
        // the drop-down list as the Vista dialogs' combos open it (personalizationDialogs.js wireCombo)
        contextMenu.attachPickerMenu(button, {
            items: () => options.map((option) => ({ value: option.value, text: option.label })),
            value: () => button.dataset.value,
            onSelect: (value, item) => {
                button.dataset.value = value;
                button.textContent = (item && item.text) || value;
            }
        });
        return button;
    }
    const config = {
        position: 'anchor',
        anchorAlign: 'start',
        sections: [{ type: 'list', className: 'context-menu-section-wrap', items: [] }],
        beforeShow: () => {
            config.sections[0].items = options.map((option) => ({
                text: option.label,
                value: option.value,
                icon: option.value === button.dataset.value ? 'fas fa-check' : 'far fa-circle',
                action: 'request-form-pick'
            }));
        },
        onAction: (_action, _target, item) => {
            if (!item || item.value == null) return;
            button.dataset.value = item.value;
            button.textContent = item.text || item.value;
        }
    };
    contextMenu.attachClickMenuToElement(button, config);
    return button;
}

function requestFormBuildControl(field, vista) {
    const data = field.data || {};
    if (field.type === 'bool' && vista) {
        const label = document.createElement('label');
        label.className = 'request-form-check';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = data.default === true;
        label.append(check, document.createTextNode(field.label));
        return label;
    }
    if (field.type === 'bool') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-secondary toggle-btn indicator';
        button.dataset.state = data.default === true ? 'on' : 'off';
        button.textContent = data.default === true ? 'On' : 'Off';
        button.addEventListener('click', () => {
            const on = button.dataset.state !== 'on';
            button.dataset.state = on ? 'on' : 'off';
            button.textContent = on ? 'On' : 'Off';
        });
        return button;
    }
    if (field.type === 'select') {
        return requestFormSelect(data, vista);
    }
    if (field.type === 'int' || field.type === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'form-control';
        if (data.min != null) input.min = String(data.min);
        if (data.max != null) input.max = String(data.max);
        input.step = String(data.step != null ? data.step : (field.type === 'int' ? 1 : 'any'));
        if (data.default != null && data.default !== '') input.value = String(data.default);
        if (data.placeholder) input.placeholder = data.placeholder;
        // createWheelTickGate / guardWheelTick: public/scripts/utils/wheelTickGate.js
        const allowTick = createWheelTickGate();
        input.addEventListener('wheel', (event) => {
            if (!guardWheelTick(event, allowTick, { stop: true })) return;
            const step = Number(input.step) || 1;
            const dir = event.deltaY < 0 ? 1 : -1;
            let next = (Number(input.value) || 0) + (step * dir);
            if (data.min != null) next = Math.max(data.min, next);
            if (data.max != null) next = Math.min(data.max, next);
            if (field.type === 'int') next = Math.round(next);
            input.value = String(next);
        }, { passive: false });
        return input;
    }
    if (field.type === 'prompt' || field.type === 'textmulti') {
        if (field.type === 'textmulti') {
            const area = document.createElement('textarea');
            area.className = 'form-control';
            area.rows = 3;
            if (data.placeholder) area.placeholder = data.placeholder;
            if (data.default != null) area.value = String(data.default);
            return area;
        }
        const wrap = document.createElement('div');
        wrap.className = 'prompt-textarea-container';
        const background = document.createElement('div');
        background.className = 'prompt-textarea-background';
        const emphasis = document.createElement('div');
        emphasis.className = 'prompt-textarea-emphasis-wrap';
        const area = document.createElement('textarea');
        area.className = 'form-control prompt-textarea';
        area.rows = 4;
        area.spellcheck = false;
        area.autocapitalize = 'off';
        area.autocomplete = 'off';
        if (data.placeholder) area.placeholder = data.placeholder;
        if (data.default != null) area.value = String(data.default);
        emphasis.appendChild(area);
        wrap.append(background, emphasis);
        // wirePromptTextareaVisualUpdates: public/scripts/comp/textareaUtils.js
        wirePromptTextareaVisualUpdates(area, { minHeight: 72 });
        // attachPromptTextareaContextMenu: public/scripts/comp/promptTextareaContextMenu.js
        attachPromptTextareaContextMenu(area);
        return wrap;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    if (data.placeholder) input.placeholder = data.placeholder;
    if (data.default != null) input.value = String(data.default);
    return input;
}

function renderRequestForm(host, spec, onDone, footer) {
    host.replaceChildren();
    const vista = !!footer && requestFormVista();
    (spec.fields || []).forEach((field) => {
        const group = document.createElement('div');
        group.className = 'form-group';
        group.dataset.fieldId = field.id;
        group.dataset.type = field.type;
        group.dataset.label = field.label;
        group.dataset.required = field.data && field.data.required ? '1' : '';
        if (!(vista && field.type === 'bool')) {
            const label = document.createElement('label');
            label.textContent = field.label;
            group.appendChild(label);
        }
        if (field.sub) {
            const sub = document.createElement('p');
            sub.className = 'desktop-settings-hint';
            sub.textContent = field.sub;
            group.appendChild(sub);
        }
        const control = requestFormBuildControl(field, vista);
        // a Vista check box carries its own label; the hint goes under it
        if (vista && field.type === 'bool') group.prepend(control);
        else group.appendChild(control);
        host.appendChild(group);
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-secondary';
    cancel.innerHTML = '<span>Cancel</span>';
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'btn-primary';
    send.innerHTML = `<span>${spec.submitLabel || 'Send'}</span>`;
    const finish = (values, cancelled) => {
        const scope = footer || host;
        scope.querySelectorAll('button, input, textarea').forEach((el) => { el.disabled = true; });
        if (onDone) onDone(values, cancelled);
    };
    cancel.addEventListener('click', () => finish(null, true));
    send.addEventListener('click', () => {
        const collected = requestFormCollect(host);
        if (collected.missing) {
            showGlassToast('error', null, `${collected.missing} is required`);
            return;
        }
        finish(collected.values, false);
    });
    if (footer) {
        footer.replaceChildren();
        const left = document.createElement('div');
        left.className = 'modal-footer-left';
        const right = document.createElement('div');
        right.className = 'modal-footer-right';
        if (vista) {
            // Vista: the buttons right-aligned, the default one first
            send.dataset.dialogPrimary = '1';
            right.append(send, cancel);
        } else {
            left.appendChild(cancel);
            right.appendChild(send);
        }
        footer.append(left, right);
        return;
    }
    const actions = document.createElement('div');
    actions.className = 'director-message-actions';
    actions.append(cancel, send);
    host.appendChild(actions);
}

function openRequestFormWindow(spec) {
    const modal = document.getElementById('requestFormWindow');
    const body = document.getElementById('requestFormBody');
    const title = document.getElementById('requestFormTitle');
    if (!modal || !body) return;
    if (title) title.textContent = spec.title || 'Form';
    renderRequestForm(body, spec, (values, cancelled) => {
        modal.dataset.formId = '';
        requestFormSend(spec, values, cancelled);
        const footer = document.getElementById('requestFormFooter');
        if (footer) footer.replaceChildren();
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    }, document.getElementById('requestFormFooter'));
    const closeBtn = document.getElementById('requestFormCloseBtn');
    if (closeBtn && closeBtn.dataset.formWired !== '1') {
        closeBtn.dataset.formWired = '1';
        closeBtn.addEventListener('click', () => {
            const current = modal.dataset.formId;
            if (current) requestFormSend({ id: current }, null, true);
            closeModal(modal);
        });
    }
    modal.dataset.formId = spec.id || '';
    // openModal: public/scripts/comp/modalUtils.js
    openModal(modal);
}

function presentRequestForm(spec) {
    if (!spec || !spec.id) return;
    const director = window.directorInstance;
    const sameChat = spec.chatId && director && director.currentSession
        && String(director.currentSession.id) === String(spec.chatId);
    if (sameChat && director.directorSurfaceOpen()) {
        const host = director.mountInlineForm(spec);
        if (host) {
            renderRequestForm(host, spec, (values, cancelled) => {
                requestFormSend(spec, values, cancelled);
                host.remove();
            });
            return;
        }
    }
    openRequestFormWindow(spec);
}

if (window.wsClient && window.wsClient.on) {
    window.wsClient.on('request_form', (data) => {
        presentRequestForm((data && data.data) || data || {});
    });
}
