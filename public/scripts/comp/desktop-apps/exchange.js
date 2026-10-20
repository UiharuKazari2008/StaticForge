// Dreamscape Exchange Server — UI + WS/MCP layer for the Grimoire DSAP.
// Host / tab routing: public/scripts/comp/exchangeDsapApplet.js
// Server: modules/mailExchange.js, modules/ws/handlers/255-mailExchangeHandler.js
// openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
// contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
// showConfirmationDialog / showInputDialog: public/scripts/comp/confirmationDialog.js
// wsClient.sendMessage: public/scripts/websocket.js
// Layout: public/css/desktop-apps/exchange.css

const EXCHANGE_DEPTS = ['ops', 'dev', 'lab'];
const EXCHANGE_DEFAULT_FROM = 'kazari.ops@dream.737.jp.net';

const desktopExchange = {
    section: 'overview',
    mailboxes: [],
    aliases: [],
    lists: [],
    toggles: null,
    dashboard: null,
    spam: null,
    selectedOwner: 'yukimi',
    createDept: 'ops',
    lastKey: null,
    statusText: 'Ready'
};

let desktopExchangeEls = null;

function exchangeBindHost(els) {
    desktopExchangeEls = els || null;
}

function exchangeUnbindHost() {
    desktopExchangeEls = null;
}

function openDesktopExchange() {
    // openDsapInGrimoire: public/scripts/comp/dsapRegistry.js
    openDsapInGrimoire('dsap://exchange.dreamscape.jp/');
}

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

function exchangeSetStatus(text, degraded) {
    desktopExchange.statusText = text;
    if (!desktopExchangeEls || !desktopExchangeEls.status) return;
    desktopExchangeEls.status.textContent = text;
    desktopExchangeEls.status.classList.toggle('exchange-degraded', !!degraded);
}

function exchangeRelayFriendly(result) {
    if (!result || result.ok || result.skipped) return null;
    const code = result.code;
    if (code === 'UNKNOWN_MAILBOX') return 'The LANTIS relay does not know that mailbox.';
    if (code === 'UNKNOWN_SERVICE') return 'The LANTIS relay does not know that service.';
    if (code === 'BAD_BODY') return 'Toggle values must be true or false.';
    if (code === 'ACTOR_REQUIRED') return 'An admin name is required to change relay toggles.';
    if (code === 'RELAY_ADMIN_REQUIRED' || code === 'RELAY_ADMIN_TOKEN_MISSING') {
        return 'The relay rejected this change because the admin token was missing or wrong.';
    }
    if (result.friendly) return result.friendly;
    return result.error || 'The relay rejected that change.';
}

function exchangeFormatAge(iso) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return 'unknown age';
    const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (sec < 60) return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 48) return hr + 'h ago';
    return Math.floor(hr / 24) + 'd ago';
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
    if (!desktopExchangeEls || !desktopExchangeEls.main) return;
    desktopExchangeEls.main.replaceChildren();
}

function exchangeClearToolbarEnd() {
    if (!desktopExchangeEls || !desktopExchangeEls.toolbarEnd) return;
    desktopExchangeEls.toolbarEnd.replaceChildren();
}

function exchangeHeading(text, tag) {
    const h = document.createElement(tag || 'h2');
    h.textContent = text;
    return h;
}

function exchangeInput(title) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    if (title) input.title = title;
    return input;
}

function exchangeField(labelText, control) {
    const field = document.createElement('label');
    field.className = 'exchange-field';
    const caption = document.createElement('span');
    caption.className = 'exchange-field-label';
    caption.textContent = labelText;
    field.appendChild(caption);
    field.appendChild(control);
    return field;
}

function exchangeButtonGroup() {
    const group = document.createElement('div');
    group.className = 'button-group';
    return group;
}

function exchangeMailboxAddress(owner, boxes) {
    const list = boxes || desktopExchange.mailboxes || [];
    const found = list.find((box) => box.owner === owner);
    return (found && found.address) || owner;
}

function exchangeMenuButton(className, title, iconClass, labelText) {
    const button = exchangeCreateButton(className, title, iconClass);
    const label = document.createElement('span');
    label.textContent = labelText;
    button.appendChild(label);
    const glyph = document.createElement('span');
    glyph.className = 'explorer-command-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    button.appendChild(glyph);
    return { button: button, label: label };
}

async function exchangeLoadSection() {
    if (!desktopExchangeEls) return;
    exchangeClearToolbarEnd();
    exchangeSetStatus('Loading…');
    try {
        if (desktopExchange.section === 'overview') await exchangeRenderOverview();
        else if (desktopExchange.section === 'mailboxes') await exchangeRenderMailboxes();
        else if (desktopExchange.section === 'aliases') await exchangeRenderAliases();
        else if (desktopExchange.section === 'signatures') await exchangeRenderSignatures();
        else if (desktopExchange.section === 'toggles') await exchangeRenderToggles();
        else if (desktopExchange.section === 'relay') await exchangeRenderRelay();
        else await exchangeRenderSpam();
        exchangeSetStatus(desktopExchange.statusText === 'Loading…' ? 'Ready' : desktopExchange.statusText);
    } catch (err) {
        exchangeSetStatus(err.message || 'Failed', true);
    }
}

function exchangeStat(label, value, extra) {
    const item = document.createElement('div');
    item.className = 'exchange-stat';
    const name = document.createElement('div');
    name.className = 'exchange-stat-label';
    name.textContent = label;
    const val = document.createElement('div');
    val.className = 'exchange-stat-value';
    val.textContent = value == null ? '—' : String(value);
    if (extra) val.classList.add(extra);
    item.appendChild(name);
    item.appendChild(val);
    return item;
}

function exchangeTable(headers, rows, columnClasses) {
    const wrap = document.createElement('div');
    wrap.className = 'exchange-table-wrap';
    const table = document.createElement('table');
    table.className = 'exchange-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    headers.forEach((h, index) => {
        const th = document.createElement('th');
        th.textContent = h;
        if (columnClasses && columnClasses[index]) th.className = columnClasses[index];
        hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach((cols) => {
        const tr = document.createElement('tr');
        cols.forEach((c, index) => {
            const td = document.createElement('td');
            if (columnClasses && columnClasses[index]) td.className = columnClasses[index];
            if (c && c.nodeType === 1) td.appendChild(c);
            else td.textContent = c == null ? '' : String(c);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

function exchangeFromList(login, from) {
    const addrs = Array.isArray(from) ? from : [];
    const block = document.createElement('div');
    const h = exchangeHeading('Login ' + (login || '—'), 'h3');
    block.appendChild(h);
    const compact = addrs.length > 6 || addrs.some((addr) => String(addr).indexOf('*') !== -1);
    const list = document.createElement('ul');
    list.className = 'exchange-from-addresses';
    addrs.forEach((addr) => {
        const li = document.createElement('li');
        li.textContent = addr;
        list.appendChild(li);
    });
    if (!compact) {
        block.appendChild(list);
        return block;
    }
    const details = document.createElement('details');
    details.className = 'exchange-from-list';
    const summary = document.createElement('summary');
    const wild = addrs.filter((addr) => String(addr).indexOf('*') !== -1)[0];
    summary.textContent = (wild || addrs[0] || 'From') + ' · ' + addrs.length + ' addresses';
    details.appendChild(summary);
    details.appendChild(list);
    block.appendChild(details);
    return block;
}

function exchangeToggleButton(label, on, onClick) {
    const btn = exchangeCreateButton('btn-secondary btn-small indicator', label);
    btn.append(label);
    btn.dataset.state = on ? 'on' : 'off';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.addEventListener('click', onClick);
    return btn;
}

function exchangeDashboardParts(dash) {
    const intake = (dash && dash.intake) || {};
    const relay = (dash && dash.relay) || {};
    const status = relay.status && relay.status.data;
    const queue = relay.queue && relay.queue.data;
    const filters = status && status.filters;
    const dkim = relay.dkim || (status && status.oci);
    const senders = relay.senders && relay.senders.data;
    const snapshotAt = senders && senders.refreshed_at;
    const wg = status && status.wireguard;
    const bl = relay.blocklists && relay.blocklists.data;
    const ociSender = (dkim && dkim.sender) || EXCHANGE_DEFAULT_FROM;
    const yukimiFrom = (status && status.oci && status.oci.sender)
        || (senders && senders.oci && senders.oci.approved && senders.oci.approved[0] && senders.oci.approved[0].email)
        || EXCHANGE_DEFAULT_FROM;
    return {
        intake: intake,
        relay: relay,
        status: status,
        queue: queue,
        filters: filters,
        dkim: dkim,
        senders: senders,
        snapshotAt: snapshotAt,
        wg: wg,
        bl: bl,
        ociSender: ociSender,
        yukimiFrom: yukimiFrom
    };
}

async function exchangeRenderOverview() {
    const dash = await exchangeSend('exchange_dashboard', {});
    desktopExchange.dashboard = dash;
    const parts = exchangeDashboardParts(dash);
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Overview'));
    const grid = document.createElement('div');
    grid.className = 'exchange-stats';
    grid.appendChild(exchangeStat('Intake', parts.intake.enabled ? `${parts.intake.bind}:${parts.intake.port}` : 'disabled'));
    grid.appendChild(exchangeStat(
        'LANTIS Postfix',
        parts.status && parts.status.postfix && parts.status.postfix.up ? 'up' : (parts.relay.status && parts.relay.status.degraded ? 'unreachable' : 'down'),
        parts.relay.status && parts.relay.status.degraded ? 'exchange-degraded' : ''
    ));
    grid.appendChild(exchangeStat('Queue deferred', parts.queue ? parts.queue.deferred : '—'));
    grid.appendChild(exchangeStat('Filters', parts.filters ? Object.entries(parts.filters).map(([k, v]) => `${k}:${v}`).join(' ') : '—'));
    grid.appendChild(exchangeStat(
        'OCI snapshot',
        parts.snapshotAt ? exchangeFormatAge(parts.snapshotAt) + ' (' + parts.snapshotAt + ')' : '—'
    ));
    grid.appendChild(exchangeStat('Yukimi From', parts.yukimiFrom));
    grid.appendChild(exchangeStat('WireGuard', parts.wg && parts.wg.up ? 'up' : (parts.relay.status && parts.relay.status.degraded ? 'unknown' : 'down')));
    desktopExchangeEls.main.appendChild(grid);
    if (parts.relay.status && parts.relay.status.degraded) {
        exchangeSetStatus('Relay unreachable — showing local state', true);
    }
}

async function exchangeRenderRelay() {
    const dash = await exchangeSend('exchange_dashboard', {});
    desktopExchange.dashboard = dash;
    const parts = exchangeDashboardParts(dash);
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Relay'));
    const grid = document.createElement('div');
    grid.className = 'exchange-stats';
    grid.appendChild(exchangeStat('OCI sender', parts.ociSender));
    grid.appendChild(exchangeStat('OCI DKIM', parts.dkim && parts.dkim.dkim ? parts.dkim.dkim : '—'));
    grid.appendChild(exchangeStat('Yukimi From', parts.yukimiFrom));
    grid.appendChild(exchangeStat('SA rules', parts.bl && parts.bl.sa_rules_updated ? parts.bl.sa_rules_updated : '—'));
    desktopExchangeEls.main.appendChild(grid);
    desktopExchangeEls.main.appendChild(exchangeHeading('Blocklists', 'h3'));
    const blNote = document.createElement('p');
    blNote.className = 'exchange-note';
    blNote.textContent = 'Lookup answered correctly is whether the test-point replied. Our IP listed is whether this host is on that list.';
    desktopExchangeEls.main.appendChild(blNote);
    const listMap = (parts.bl && parts.bl.lists) || {};
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['List', 'Lookup answered correctly', 'Our IP listed', 'Checked'],
        Object.keys(listMap).map((name) => {
            const row = listMap[name] || {};
            return [
                name,
                row.ok ? 'yes' : 'no (lookup failed)',
                row.listed ? 'yes — listed' : 'no — not listed',
                row.checked_at || '—'
            ];
        })
    ));
    desktopExchangeEls.main.appendChild(exchangeHeading('Submission From addresses', 'h3'));
    const submissions = (parts.senders && parts.senders.submission) || [];
    if (!submissions.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No submission logins reported.';
        desktopExchangeEls.main.appendChild(empty);
    }
    submissions.forEach((row) => {
        desktopExchangeEls.main.appendChild(exchangeFromList(row.login, row.from));
    });
    const rejects = (parts.relay.rejects && parts.relay.rejects.data && parts.relay.rejects.data.rejects) || [];
    desktopExchangeEls.main.appendChild(exchangeHeading('Recent rejects', 'h3'));
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['At', 'From', 'To', 'Reason'],
        rejects.map((row) => [row.at, row.from, row.to, row.reason]),
        ['', 'exchange-cell-address', 'exchange-cell-address', '']
    ));
    if (parts.relay.status && parts.relay.status.degraded) {
        exchangeSetStatus('Relay unreachable — showing local state', true);
    }
}

async function exchangeRenderMailboxes() {
    const data = await exchangeSend('exchange_list_mailboxes', {});
    desktopExchange.mailboxes = data.mailboxes || [];
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Mailboxes'));
    const row = document.createElement('div');
    row.className = 'exchange-form-row';
    const ownerIn = exchangeInput('Bare mailbox owner name');
    const deptPick = exchangeMenuButton(
        'btn-secondary btn-small has-menu',
        'Department',
        'fas fa-sitemap',
        desktopExchange.createDept
    );
    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(deptPick.button, () => ({
        sections: [{
            type: 'list',
            items: EXCHANGE_DEPTS.map((dept) => ({
                text: dept,
                action: 'pick',
                showIndicator: true,
                indicatorMark: 'radio',
                checked: dept === desktopExchange.createDept,
                onSelect: () => {
                    desktopExchange.createDept = dept;
                    deptPick.label.textContent = dept;
                }
            }))
        }]
    }));
    const createBtn = exchangeCreateButton('btn-primary btn-small', 'Create', 'fas fa-plus');
    createBtn.append('Create');
    createBtn.addEventListener('click', async () => {
        const ok = await exchangeConfirm('Create mailbox ' + ownerIn.value + '.' + desktopExchange.createDept + '@dream.737.jp.net?');
        if (!ok) return;
        await exchangeSend('exchange_create_mailbox', {
            owner: ownerIn.value,
            dept: desktopExchange.createDept,
            confirm: true
        }, true);
        exchangeLoadSection();
    });
    const createGroup = exchangeButtonGroup();
    createGroup.appendChild(createBtn);
    row.appendChild(exchangeField('Owner', ownerIn));
    row.appendChild(exchangeField('Dept', deptPick.button));
    row.appendChild(createGroup);
    desktopExchangeEls.main.appendChild(row);
    if (desktopExchange.lastKey) {
        desktopExchangeEls.main.appendChild(exchangeHeading('Mailbox key (shown once)', 'h3'));
        const pre = document.createElement('div');
        pre.className = 'exchange-key-once';
        pre.textContent = desktopExchange.lastKey;
        desktopExchangeEls.main.appendChild(pre);
    }
    const actionCell = (box) => {
        const group = exchangeButtonGroup();
        const disable = exchangeCreateButton('btn-secondary btn-small', box.enabled ? 'Disable' : 'Enable', 'fas fa-power-off');
        disable.append(box.enabled ? 'Disable' : 'Enable');
        disable.addEventListener('click', async () => {
            const ok = await exchangeConfirm((box.enabled ? 'Disable' : 'Enable') + ' ' + box.address + '?');
            if (!ok) return;
            await exchangeSend('exchange_disable_mailbox', { owner: box.owner, enabled: !box.enabled, confirm: true }, true);
            exchangeLoadSection();
        });
        const keyBtn = exchangeCreateButton('btn-secondary btn-small', 'Issue / rotate key', 'fas fa-key');
        keyBtn.append(box.hasKey ? 'Rotate key' : 'Issue key');
        keyBtn.addEventListener('click', async () => {
            const ok = await exchangeConfirm((box.hasKey ? 'Rotate' : 'Issue') + ' key for ' + box.address + '? The secret is shown once.');
            if (!ok) return;
            const result = await exchangeSend(box.hasKey ? 'exchange_rotate_key' : 'exchange_issue_key', { owner: box.owner, confirm: true }, true);
            desktopExchange.lastKey = result && result.key;
            exchangeLoadSection();
        });
        const del = exchangeCreateButton('btn-danger btn-small', 'Soft delete', 'fas fa-trash');
        del.append('Delete');
        del.addEventListener('click', async () => {
            // showInputDialog: public/scripts/comp/confirmationDialog.js
            const typed = await showInputDialog('Type DELETE to soft-delete ' + box.address, '', 'DELETE');
            if (typed !== 'DELETE') return;
            await exchangeSend('exchange_delete_mailbox', { owner: box.owner, confirm: true, confirmText: 'DELETE' }, true);
            exchangeLoadSection();
        });
        group.appendChild(disable);
        group.appendChild(keyBtn);
        group.appendChild(del);
        return group;
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
        ]),
        ['', 'exchange-cell-address', '', '', '', 'exchange-cell-key', '']
    ));
}

async function exchangeRenderAliases() {
    const data = await exchangeSend('exchange_list_aliases', {});
    desktopExchange.aliases = data.aliases || [];
    desktopExchange.lists = data.lists || [];
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Aliases and distribution lists'));
    const row = document.createElement('div');
    row.className = 'exchange-form-row';
    const localIn = exchangeInput('Local-part of the alias or list');
    const targetIn = exchangeInput('Target mailbox or local-part');
    const membersIn = exchangeInput('Comma-separated member names');
    const addAlias = exchangeCreateButton('btn-primary btn-small', 'Add alias', 'fas fa-plus');
    addAlias.append('Add alias');
    addAlias.addEventListener('click', async () => {
        const ok = await exchangeConfirm('Add alias ' + localIn.value + ' → ' + targetIn.value + '?');
        if (!ok) return;
        await exchangeSend('exchange_upsert_alias', { localPart: localIn.value, target: targetIn.value, confirm: true }, true);
        exchangeLoadSection();
    });
    const addList = exchangeCreateButton('btn-secondary btn-small', 'Add list', 'fas fa-plus');
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
    const actions = exchangeButtonGroup();
    actions.appendChild(addAlias);
    actions.appendChild(addList);
    row.appendChild(exchangeField('Local-part', localIn));
    row.appendChild(exchangeField('Target', targetIn));
    row.appendChild(exchangeField('List members', membersIn));
    row.appendChild(actions);
    desktopExchangeEls.main.appendChild(row);
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['Address', 'Target', 'Kind'],
        desktopExchange.aliases.map((item) => [item.address, item.target, item.kind + (item.note ? ' — ' + item.note : '')]),
        ['exchange-cell-address', 'exchange-cell-address', '']
    ));
}

async function exchangeRenderSignatures() {
    const boxes = (await exchangeSend('exchange_list_mailboxes', {})).mailboxes || [];
    desktopExchange.mailboxes = boxes;
    if (!boxes.some((box) => box.owner === desktopExchange.selectedOwner) && boxes[0]) {
        desktopExchange.selectedOwner = boxes[0].owner;
    }
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Signatures'));
    const picker = exchangeMenuButton(
        'btn-secondary btn-small explorer-command-btn has-menu exchange-mailbox-picker',
        'Mailbox',
        'fas fa-inbox',
        exchangeMailboxAddress(desktopExchange.selectedOwner, boxes)
    );
    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(picker.button, () => ({
        sections: [{
            type: 'list',
            items: boxes.map((box) => ({
                text: box.address,
                action: 'pick',
                showIndicator: true,
                indicatorMark: 'radio',
                checked: box.owner === desktopExchange.selectedOwner,
                onSelect: () => {
                    desktopExchange.selectedOwner = box.owner;
                    picker.label.textContent = box.address;
                    loadSig();
                }
            }))
        }]
    }));
    const save = exchangeCreateButton('btn-primary btn-small explorer-command-btn', 'Save signature', 'fas fa-floppy-disk');
    save.append('Save');
    if (desktopExchangeEls.toolbarEnd) {
        desktopExchangeEls.toolbarEnd.appendChild(picker.button);
        desktopExchangeEls.toolbarEnd.appendChild(save);
    }
    const area = document.createElement('textarea');
    area.className = 'form-control prompt-textarea textarea-inset exchange-signature-input';
    area.rows = 8;
    area.setAttribute('aria-label', 'Signature HTML');
    desktopExchangeEls.main.appendChild(area);
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
    async function loadSig() {
        const sig = await exchangeSend('exchange_get_signature', { owner: desktopExchange.selectedOwner });
        area.value = (sig && sig.html) || '';
    }
    await loadSig();
}

async function exchangeRenderToggles() {
    const data = await exchangeSend('exchange_get_toggles', {});
    const toggles = data.toggles || { inbound: true, outbound: true, mailboxes: {}, services: {} };
    desktopExchange.toggles = toggles;
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('External mail toggles'));
    const row = document.createElement('div');
    row.className = 'exchange-toggle-row';
    const save = async (patch) => {
        const ok = await exchangeConfirm('Apply toggle change? This also PUTs the LANTIS relay.');
        if (!ok) return;
        const result = await exchangeSend('exchange_set_toggles', Object.assign({ confirm: true }, patch), true);
        await exchangeLoadSection();
        const friendly = exchangeRelayFriendly(result && result.relay);
        if (friendly) exchangeSetStatus(friendly, true);
    };
    row.appendChild(exchangeToggleButton('Global inbound', toggles.inbound !== false, () => save({ inbound: toggles.inbound === false })));
    row.appendChild(exchangeToggleButton('Global outbound', toggles.outbound !== false, () => save({ outbound: toggles.outbound === false })));
    const yozora = !(toggles.services && toggles.services.yozora && toggles.services.yozora.outbound === false);
    row.appendChild(exchangeToggleButton('Yozora outbound', yozora, () => save({
        services: { yozora: { outbound: !yozora } }
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
                const one = {};
                one[box.owner] = { inbound: !inOn };
                save({ mailboxes: one });
            });
            const outBtn = exchangeToggleButton('Out', outOn, () => {
                const one = {};
                one[box.owner] = { outbound: !outOn };
                save({ mailboxes: one });
            });
            return [box.address, inBtn, outBtn];
        }),
        ['exchange-cell-address', '', '']
    ));
}

async function exchangeRenderSpam() {
    const data = await exchangeSend('exchange_list_spam', {});
    desktopExchange.spam = data;
    exchangeClearMain();
    desktopExchangeEls.main.appendChild(exchangeHeading('Spam overview'));
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['Mailbox', 'Count'],
        (data.counts || []).map((row) => [row.address || row.owner, String(row.count)]),
        ['exchange-cell-address', '']
    ));
    desktopExchangeEls.main.appendChild(exchangeTable(
        ['Mailbox', 'From', 'Subject', 'Actions'],
        (data.recent || []).map((row) => {
            const group = exchangeButtonGroup();
            if (row.rescueAllowed) {
                const rescue = exchangeCreateButton('btn-secondary btn-small', 'Rescue', 'fas fa-inbox');
                rescue.append('Rescue');
                rescue.addEventListener('click', async () => {
                    const ok = await exchangeConfirm('Rescue this message to Inbox?');
                    if (!ok) return;
                    await exchangeSend('exchange_spam_move', { mailbox: row.mailbox, id: row.id, spam: false, confirm: true }, true);
                    exchangeLoadSection();
                });
                const purge = exchangeCreateButton('btn-danger btn-small', 'Keep in Spam', 'fas fa-ban');
                purge.append('Purge');
                purge.addEventListener('click', async () => {
                    const ok = await exchangeConfirm('Leave this message in Spam?');
                    if (!ok) return;
                    await exchangeSend('exchange_spam_move', { mailbox: row.mailbox, id: row.id, spam: true, confirm: true }, true);
                    exchangeLoadSection();
                });
                group.appendChild(rescue);
                group.appendChild(purge);
            } else {
                const note = document.createElement('span');
                note.textContent = 'Yukimi Spam-only';
                group.appendChild(note);
            }
            return [row.mailbox, row.from, row.subject, group];
        }),
        ['exchange-cell-address', 'exchange-cell-address', '', '']
    ));
}
