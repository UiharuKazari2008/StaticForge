// Dreamscape Exchange Server desktop console.
// Server: modules/mailExchange.js, modules/ws/handlers/255-mailExchangeHandler.js
// openModal / closeModal / bringModalToFront / restoreMinimizedModal: public/scripts/comp/modalUtils.js
// contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
// showConfirmationDialog: public/scripts/comp/confirmationDialog.js
// wsClient.sendMessage: public/scripts/websocket.js
// Layout: public/css/desktop-apps/exchange.css

const DESKTOP_EXCHANGE_MODAL_ID = 'desktopExchangeModal';
const EXCHANGE_SECTIONS = [
    { id: 'status', label: 'Status', icon: 'fas fa-heart-pulse' },
    { id: 'mailboxes', label: 'Mailboxes', icon: 'fas fa-inbox' },
    { id: 'lists', label: 'Lists', icon: 'fas fa-sitemap' },
    { id: 'signatures', label: 'Signatures', icon: 'fas fa-pen-nib' },
    { id: 'toggles', label: 'Toggles', icon: 'fas fa-toggle-on' },
    { id: 'spam', label: 'Spam', icon: 'fas fa-ban' }
];

const desktopExchange = {
    section: 'status',
    mailboxes: [],
    aliases: [],
    lists: [],
    toggles: null,
    dashboard: null,
    spam: null,
    selectedOwner: 'yukimi',
    lastKey: null,
    statusText: 'Ready'
};

let desktopExchangeEls = null;

function exchangeCreateButton(className, title, iconClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    if (iconClass) {
        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
    }
    return button;
}

function openDesktopExchange() {
    const modal = ensureDesktopExchangeModal();
    if (modal.classList.contains('minimised')) restoreMinimizedModal(modal);
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) openModal(modal);
    bringModalToFront(modal);
    exchangeLoadSection();
}

const ensureDesktopExchangeModal = function () {
    let modal = document.getElementById(DESKTOP_EXCHANGE_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = DESKTOP_EXCHANGE_MODAL_ID;
    modal.className = 'modal resizeable-window toolbar-visible hidden';
    modal.dataset.windowIdentifier = 'desktopExchange';
    modal.dataset.windowClient = 'light';
    modal.dataset.windowDefaultWidth = '960';
    modal.dataset.windowDefaultHeight = '640';
    modal.dataset.windowMinWidth = '720';
    modal.dataset.windowMinHeight = '420';

    const title = document.createElement('div');
    title.className = 'modal-window-title';
    const titleMain = document.createElement('div');
    titleMain.className = 'modal-window-title-main';
    const titleIcon = document.createElement('i');
    titleIcon.className = 'fas fa-building-columns';
    const titleText = document.createElement('span');
    titleText.textContent = 'Dreamscape Exchange Server';
    titleMain.appendChild(titleIcon);
    titleMain.appendChild(titleText);
    title.appendChild(titleMain);

    const commandBar = document.createElement('div');
    commandBar.className = 'explorer-actions-header';
    commandBar.setAttribute('role', 'toolbar');
    const toolbar = document.createElement('div');
    toolbar.className = 'explorer-command-set';
    commandBar.appendChild(toolbar);

    const sectionButtons = {};
    EXCHANGE_SECTIONS.forEach((section, index) => {
        if (index === 4) {
            const divider = document.createElement('div');
            divider.className = 'exchange-toolbar-divider';
            toolbar.appendChild(divider);
        }
        const btn = exchangeCreateButton(
            'btn-secondary btn-small explorer-command-btn indicator',
            section.label,
            section.icon
        );
        btn.append(section.label);
        btn.dataset.exchangeSection = section.id;
        btn.dataset.state = section.id === desktopExchange.section ? 'on' : 'off';
        btn.addEventListener('click', () => exchangeSetSection(section.id));
        toolbar.appendChild(btn);
        sectionButtons[section.id] = btn;
    });

    const refreshBtn = exchangeCreateButton('btn-secondary btn-small explorer-command-btn', 'Refresh', 'fas fa-rotate-right');
    refreshBtn.append('Refresh');
    refreshBtn.addEventListener('click', () => exchangeLoadSection());
    toolbar.appendChild(refreshBtn);

    const controls = document.createElement('div');
    controls.className = 'modal-window-controls';
    const minimizeBtn = exchangeCreateButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize');
    const maximizeBtn = exchangeCreateButton('btn-secondary btn-small modal-work-area-maximize', 'Maximize', 'fa-regular fa-window-maximize');
    const closeBtn = exchangeCreateButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
    controls.appendChild(minimizeBtn);
    controls.appendChild(maximizeBtn);
    controls.appendChild(closeBtn);
    closeBtn.addEventListener('click', () => {
        closeModal(modal);
    });

    const content = document.createElement('div');
    content.className = 'modal-content modal-padding dark';
    const body = document.createElement('div');
    body.className = 'modal-body exchange-body';

    const main = document.createElement('div');
    main.className = 'exchange-main exchange-inset-panel';

    const status = document.createElement('div');
    status.className = 'exchange-status exchange-inset-panel';
    status.textContent = 'Ready';

    body.appendChild(main);
    body.appendChild(status);
    content.appendChild(body);

    modal.appendChild(title);
    modal.appendChild(commandBar);
    modal.appendChild(controls);
    modal.appendChild(content);
    document.body.appendChild(modal);

    desktopExchangeEls = { modal, main, status, sectionButtons };
    return modal;
};

function exchangeSetSection(id) {
    desktopExchange.section = id;
    Object.entries(desktopExchangeEls.sectionButtons).forEach(([key, btn]) => {
        btn.dataset.state = key === id ? 'on' : 'off';
    });
    exchangeLoadSection();
}

function exchangeSetStatus(text, degraded) {
    desktopExchange.statusText = text;
    if (!desktopExchangeEls) return;
    desktopExchangeEls.status.textContent = text;
    desktopExchangeEls.status.classList.toggle('exchange-degraded', !!degraded);
}

async function exchangeSend(type, payload, confirm) {
    const body = Object.assign({}, payload || {});
    if (confirm) body.confirm = true;
    // wsClient.sendMessage: public/scripts/websocket.js
    const data = await wsClient.sendMessage(type, body);
    if (data && data.error) throw new Error(data.error);
    return data;
}

async function exchangeConfirm(message) {
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    return showConfirmationDialog(message, [
        { text: 'Cancel', value: false },
        { text: 'Confirm', value: true, primary: true }
    ]);
}

function exchangeClearMain() {
    desktopExchangeEls.main.replaceChildren();
}

function exchangeHeading(text) {
    const h = document.createElement('h2');
    h.textContent = text;
    return h;
}

async function exchangeLoadSection() {
    if (!desktopExchangeEls) return;
    exchangeSetStatus('Loading…');
    try {
        if (desktopExchange.section === 'status') await exchangeRenderStatus();
        else if (desktopExchange.section === 'mailboxes') await exchangeRenderMailboxes();
        else if (desktopExchange.section === 'lists') await exchangeRenderLists();
        else if (desktopExchange.section === 'signatures') await exchangeRenderSignatures();
        else if (desktopExchange.section === 'toggles') await exchangeRenderToggles();
        else await exchangeRenderSpam();
        exchangeSetStatus(desktopExchange.statusText === 'Loading…' ? 'Ready' : desktopExchange.statusText);
    } catch (err) {
        exchangeSetStatus(err.message || 'Failed', true);
    }
}

function exchangeStat(label, value, extra) {
    const card = document.createElement('div');
    card.className = 'exchange-card';
    const h = document.createElement('h3');
    h.textContent = label;
    const p = document.createElement('div');
    p.textContent = value == null ? '—' : String(value);
    if (extra) p.className = extra;
    card.appendChild(h);
    card.appendChild(p);
    return card;
}

async function exchangeRenderStatus() {
    const dash = await exchangeSend('exchange_dashboard', {});
    desktopExchange.dashboard = dash;
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Status'));
    const grid = document.createElement('div');
    grid.className = 'exchange-grid';
    const intake = dash.intake || {};
    const relay = dash.relay || {};
    const status = relay.status && relay.status.data;
    grid.appendChild(exchangeStat('Intake', intake.enabled ? `${intake.bind}:${intake.port}` : 'disabled'));
    grid.appendChild(exchangeStat(
        'LANTIS Postfix',
        status && status.postfix && status.postfix.up ? 'up' : (relay.status && relay.status.degraded ? 'unreachable' : 'down'),
        relay.status && relay.status.degraded ? 'exchange-degraded' : ''
    ));
    const queue = relay.queue && relay.queue.data;
    grid.appendChild(exchangeStat('Queue deferred', queue ? queue.deferred : '—'));
    const filters = status && status.filters;
    grid.appendChild(exchangeStat('Filters', filters ? Object.entries(filters).map(([k, v]) => `${k}:${v}`).join(' ') : '—'));
    const dkim = relay.dkim || (status && status.oci);
    grid.appendChild(exchangeStat('OCI DKIM', dkim && dkim.dkim ? dkim.dkim : '—'));
    const senders = relay.senders && relay.senders.data;
    const yukimiFrom = senders && senders.submission && senders.submission[0] && senders.submission[0].from
        ? senders.submission[0].from.find((addr) => addr.indexOf('kazari.ops@') === 0)
        : 'kazari.ops@dream.737.jp.net';
    grid.appendChild(exchangeStat('Yukimi From', yukimiFrom));
    const wg = status && status.wireguard;
    grid.appendChild(exchangeStat('WireGuard', wg && wg.up ? 'up' : (relay.status && relay.status.degraded ? 'unknown' : 'down')));
    const bl = relay.blocklists && relay.blocklists.data;
    grid.appendChild(exchangeStat('SA rules', bl && bl.sa_rules_updated ? bl.sa_rules_updated : '—'));
    desktopExchangeEls.main.appendChild(grid);
    const rejects = (relay.rejects && relay.rejects.data && relay.rejects.data.rejects) || [];
    desktopExchangeEls.main.appendChild(exchangeHeading('Recent rejects'));
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['At', 'From', 'To', 'Reason'],
        rejects.map((row) => [row.at, row.from, row.to, row.reason])
    ));
    if (relay.status && relay.status.degraded) {
        exchangeSetStatus('Relay unreachable — showing local state', true);
    }
}

function exchangeTable(headers, rows) {
    const table = document.createElement('table');
    table.className = 'exchange-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    headers.forEach((h) => {
        const th = document.createElement('th');
        th.textContent = h;
        hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach((cols) => {
        const tr = document.createElement('tr');
        cols.forEach((c) => {
            const td = document.createElement('td');
            if (c && c.nodeType === 1) td.appendChild(c);
            else td.textContent = c == null ? '' : String(c);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
}

function exchangeInput(placeholder) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.placeholder = placeholder;
    return input;
}

async function exchangeRenderMailboxes() {
    const data = await exchangeSend('exchange_list_mailboxes', {});
    desktopExchange.mailboxes = data.mailboxes || [];
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Mailboxes'));
    const row = document.createElement('div');
    row.className = 'exchange-row';
    const ownerIn = exchangeInput('owner (bare name)');
    const deptIn = exchangeInput('dept (ops, dev, lab)');
    const createBtn = exchangeCreateButton('btn-primary btn-small explorer-command-btn', 'Create', 'fas fa-plus');
    createBtn.append('Create');
    createBtn.addEventListener('click', async () => {
        const ok = await exchangeConfirm('Create mailbox ' + ownerIn.value + '.' + deptIn.value + '@dream.737.jp.net?');
        if (!ok) return;
        await exchangeSend('exchange_create_mailbox', { owner: ownerIn.value, dept: deptIn.value, confirm: true }, true);
        exchangeLoadSection();
    });
    row.appendChild(ownerIn);
    row.appendChild(deptIn);
    row.appendChild(createBtn);
    desktopExchangeEls.main.appendChild(row);
    if (desktopExchange.lastKey) {
        const once = document.createElement('div');
        once.className = 'exchange-card';
        const h = document.createElement('h3');
        h.textContent = 'Mailbox key (shown once)';
        const pre = document.createElement('div');
        pre.className = 'exchange-key-once';
        pre.textContent = desktopExchange.lastKey;
        once.appendChild(h);
        once.appendChild(pre);
        desktopExchangeEls.main.appendChild(once);
    }
    const actionCell = (box) => {
        const wrap = document.createElement('div');
        wrap.className = 'exchange-row';
        const disable = exchangeCreateButton('btn-secondary btn-small explorer-command-btn', box.enabled ? 'Disable' : 'Enable', 'fas fa-power-off');
        disable.append(box.enabled ? 'Disable' : 'Enable');
        disable.addEventListener('click', async () => {
            const ok = await exchangeConfirm((box.enabled ? 'Disable' : 'Enable') + ' ' + box.address + '?');
            if (!ok) return;
            await exchangeSend('exchange_disable_mailbox', { owner: box.owner, enabled: !box.enabled, confirm: true }, true);
            exchangeLoadSection();
        });
        const keyBtn = exchangeCreateButton('btn-secondary btn-small explorer-command-btn', 'Issue / rotate key', 'fas fa-key');
        keyBtn.append(box.hasKey ? 'Rotate key' : 'Issue key');
        keyBtn.addEventListener('click', async () => {
            const ok = await exchangeConfirm((box.hasKey ? 'Rotate' : 'Issue') + ' key for ' + box.address + '? The secret is shown once.');
            if (!ok) return;
            const result = await exchangeSend(box.hasKey ? 'exchange_rotate_key' : 'exchange_issue_key', { owner: box.owner, confirm: true }, true);
            desktopExchange.lastKey = result && result.key;
            exchangeLoadSection();
        });
        const del = exchangeCreateButton('btn-danger btn-small explorer-command-btn', 'Soft delete', 'fas fa-trash');
        del.append('Delete');
        del.addEventListener('click', async () => {
            // showInputDialog: public/scripts/comp/confirmationDialog.js
            const typed = await showInputDialog('Type DELETE to soft-delete ' + box.address, '', 'DELETE');
            if (typed !== 'DELETE') return;
            await exchangeSend('exchange_delete_mailbox', { owner: box.owner, confirm: true, confirmText: 'DELETE' }, true);
            exchangeLoadSection();
        });
        wrap.appendChild(disable);
        wrap.appendChild(keyBtn);
        wrap.appendChild(del);
        return wrap;
    };
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['Owner', 'Address', 'Enabled', 'In', 'Out', 'Key', 'Actions'],
        desktopExchange.mailboxes.map((box) => [
            box.displayName || box.owner,
            box.address,
            box.deleted ? 'deleted' : (box.enabled ? 'yes' : 'no'),
            box.inboundEnabled ? 'on' : 'off',
            box.outboundEnabled ? 'on' : 'off',
            box.hasKey ? 'yes' : 'no',
            actionCell(box)
        ])
    ));
}

async function exchangeRenderLists() {
    const data = await exchangeSend('exchange_list_aliases', {});
    desktopExchange.aliases = data.aliases || [];
    desktopExchange.lists = data.lists || [];
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Aliases and distribution lists'));
    const row = document.createElement('div');
    row.className = 'exchange-row';
    const localIn = exchangeInput('local-part');
    const targetIn = exchangeInput('target mailbox or local-part');
    const addAlias = exchangeCreateButton('btn-primary btn-small explorer-command-btn', 'Add alias', 'fas fa-plus');
    addAlias.append('Add alias');
    addAlias.addEventListener('click', async () => {
        const ok = await exchangeConfirm('Add alias ' + localIn.value + ' → ' + targetIn.value + '?');
        if (!ok) return;
        await exchangeSend('exchange_upsert_alias', { localPart: localIn.value, target: targetIn.value, confirm: true }, true);
        exchangeLoadSection();
    });
    const membersIn = exchangeInput('list members (comma names)');
    const addList = exchangeCreateButton('btn-secondary btn-small explorer-command-btn', 'Add list', 'fas fa-plus');
    addList.append('Add list');
    addList.addEventListener('click', async () => {
        const ok = await exchangeConfirm('Add distribution list ' + localIn.value + '?');
        if (!ok) return;
        await exchangeSend('exchange_upsert_list', {
            localPart: localIn.value,
            name: localIn.value,
            members: membersIn.value,
            confirm: true
        }, true);
        exchangeLoadSection();
    });
    row.appendChild(localIn);
    row.appendChild(targetIn);
    row.appendChild(addAlias);
    row.appendChild(membersIn);
    row.appendChild(addList);
    desktopExchangeEls.main.appendChild(row);
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['Address', 'Target', 'Kind'],
        desktopExchange.aliases.map((item) => [item.address, item.target, item.kind + (item.note ? ' — ' + item.note : '')])
    ));
}

async function exchangeRenderSignatures() {
    const boxes = (await exchangeSend('exchange_list_mailboxes', {})).mailboxes || [];
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Signatures'));
    const row = document.createElement('div');
    row.className = 'exchange-row';
    const picker = exchangeCreateButton('btn-secondary btn-small explorer-command-btn has-menu', 'Mailbox', 'fas fa-inbox');
    const pickerLabel = document.createElement('span');
    pickerLabel.textContent = desktopExchange.selectedOwner;
    picker.appendChild(pickerLabel);
    const glyph = document.createElement('span');
    glyph.className = 'explorer-command-glyph';
    picker.appendChild(glyph);
    contextMenu.attachClickMenuToElement(picker, () => ({
        sections: [{
            type: 'list',
            items: boxes.map((box) => ({
                text: box.address,
                action: 'pick',
                indicatorStyle: 'dot',
                checked: box.owner === desktopExchange.selectedOwner,
                onSelect: () => {
                    desktopExchange.selectedOwner = box.owner;
                    pickerLabel.textContent = box.address;
                    loadSig();
                }
            }))
        }]
    }));
    row.appendChild(picker);
    desktopExchangeEls.main.appendChild(row);
    const area = document.createElement('textarea');
    area.className = 'form-control prompt-textarea textarea-inset';
    area.rows = 8;
    desktopExchangeEls.main.appendChild(area);
    const save = exchangeCreateButton('btn-primary btn-small explorer-command-btn', 'Save signature', 'fas fa-floppy-disk');
    save.append('Save');
    save.addEventListener('click', async () => {
        const ok = await exchangeConfirm('Save sanitized HTML signature for ' + desktopExchange.selectedOwner + '?');
        if (!ok) return;
        await exchangeSend('exchange_set_signature', {
            owner: desktopExchange.selectedOwner,
            html: area.value,
            confirm: true
        }, true);
        exchangeSetStatus('Signature saved');
    });
    desktopExchangeEls.main.appendChild(save);
    async function loadSig() {
        const sig = await exchangeSend('exchange_get_signature', { owner: desktopExchange.selectedOwner });
        area.value = (sig && sig.html) || '';
    }
    await loadSig();
}

function exchangeToggleButton(label, on, onClick) {
    const btn = exchangeCreateButton('btn-secondary btn-small explorer-command-btn indicator', label, 'fas fa-circle');
    btn.append(label);
    btn.dataset.state = on ? 'on' : 'off';
    btn.addEventListener('click', onClick);
    return btn;
}

async function exchangeRenderToggles() {
    const data = await exchangeSend('exchange_get_toggles', {});
    const toggles = data.toggles || { inbound: true, outbound: true, mailboxes: {}, services: {} };
    desktopExchange.toggles = toggles;
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('External mail toggles'));
    const row = document.createElement('div');
    row.className = 'exchange-row';
    const save = async (patch) => {
        const ok = await exchangeConfirm('Apply toggle change? This also PUTs the LANTIS relay.');
        if (!ok) return;
        await exchangeSend('exchange_set_toggles', Object.assign({ confirm: true }, patch), true);
        exchangeLoadSection();
    };
    row.appendChild(exchangeToggleButton('Global inbound', toggles.inbound !== false, () => save({ inbound: toggles.inbound === false })));
    row.appendChild(exchangeToggleButton('Global outbound', toggles.outbound !== false, () => save({ outbound: toggles.outbound === false })));
    const yozora = !(toggles.services && toggles.services.yozora && toggles.services.yozora.outbound === false);
    row.appendChild(exchangeToggleButton('Yozora outbound', yozora, () => save({
        services: Object.assign({}, toggles.services, { yozora: { outbound: !yozora } })
    })));
    desktopExchangeEls.main.appendChild(row);
    const boxes = (await exchangeSend('exchange_list_mailboxes', {})).mailboxes || [];
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['Mailbox', 'Inbound', 'Outbound'],
        boxes.map((box) => {
            const mb = (toggles.mailboxes && toggles.mailboxes[box.owner]) || {};
            const inOn = mb.inbound !== false;
            const outOn = mb.outbound !== false;
            const inBtn = exchangeToggleButton('In', inOn, () => {
                const next = Object.assign({}, toggles.mailboxes);
                next[box.owner] = { inbound: !inOn, outbound: outOn };
                save({ mailboxes: next });
            });
            const outBtn = exchangeToggleButton('Out', outOn, () => {
                const next = Object.assign({}, toggles.mailboxes);
                next[box.owner] = { inbound: inOn, outbound: !outOn };
                save({ mailboxes: next });
            });
            return [box.address, inBtn, outBtn];
        })
    ));
}

async function exchangeRenderSpam() {
    const data = await exchangeSend('exchange_list_spam', {});
    desktopExchange.spam = data;
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Spam overview'));
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['Mailbox', 'Count'],
        (data.counts || []).map((row) => [row.address || row.owner, String(row.count)])
    ));
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['Mailbox', 'From', 'Subject', 'Actions'],
        (data.recent || []).map((row) => {
            const wrap = document.createElement('div');
            if (row.rescueAllowed) {
                const rescue = exchangeCreateButton('btn-secondary btn-small explorer-command-btn', 'Rescue', 'fas fa-inbox');
                rescue.append('Rescue');
                rescue.addEventListener('click', async () => {
                    const ok = await exchangeConfirm('Rescue this message to Inbox?');
                    if (!ok) return;
                    await exchangeSend('exchange_spam_move', { mailbox: row.mailbox, id: row.id, spam: false, confirm: true }, true);
                    exchangeLoadSection();
                });
                const purge = exchangeCreateButton('btn-danger btn-small explorer-command-btn', 'Keep in Spam', 'fas fa-ban');
                purge.append('Purge');
                purge.addEventListener('click', async () => {
                    const ok = await exchangeConfirm('Leave this message in Spam?');
                    if (!ok) return;
                    await exchangeSend('exchange_spam_move', { mailbox: row.mailbox, id: row.id, spam: true, confirm: true }, true);
                    exchangeLoadSection();
                });
                wrap.appendChild(rescue);
                wrap.appendChild(purge);
            } else {
                wrap.textContent = 'Yukimi Spam-only';
            }
            return [row.mailbox, row.from, row.subject, wrap];
        })
    ));
}

