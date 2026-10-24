/**
 * Melaton Contacts (Yozora #632), Vista's wab.exe as a Melaton system package (apps/contacts).
 *
 * In Vista the Contacts folder is an Explorer folder, so this package has no window of its own:
 * started plainly (Start menu, Run "wab") it opens Explorer at Workspaces/<ws>/Contacts, where
 * explorerContacts.js gives the folder its columns, tiles, preview pane and command bar; started
 * by that folder with an action it shows Melaton Contacts' own sheets and dialogs, the
 * wab32res.dll.mui templates from the Vista VM (vistaDialogTemplates.js, gentpl.py):
 *
 *   open / edit    the Properties sheet: Summary 6007, Name and E-mail 114, Home 115, Work 116,
 *                  Family 6066, Notes 117, IDs 119; a group's: Contact Group 118, Details 2379
 *   new, new-group the same sheet, empty; OK adds the card
 *   import/export  Import to / Export Melaton Contacts (1101 / 1105): CSV or vCard
 *   print          the contact print options (6047)
 *   email, send    Dovecote to the chosen contacts / with the cards attached (Send Contact)
 *   me             This Is Me: the card that is the person signed in
 *   call           New Call (6012)
 *
 * The data: each contact is a vCard 3.0 file (melatonVCard, vcard.js) in the Contacts folder, its
 * picture in PHOTO; a group is a card with X-ADDRESSBOOKSERVER-KIND:group and its members' UIDs.
 *
 *   melatonApps.launch({ packageId: 'contacts', args: { action, files: [{ id, name }], folder } })
 */
(function (root) {
    'use strict';

    const doc = document;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\Windows Contacts';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const ICON16 = '/static_images/app_icons/16/vista-contacts.webp';
    const ART = '/static_images/vista-contacts';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const vfs = () => root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef
    const VC = () => root.melatonVCard;

    // the sheet's pages: wab32res.dll.mui dialogs, their tab names its strings (4416, 4458, 4016-4018, 4091, 4028, 4457)
    const CONTACT_PAGES = [['wab32res:6007', 'Summary'], ['wab32res:114', 'Name and E-mail'], ['wab32res:115', 'Home'], ['wab32res:116', 'Work'], ['wab32res:6066', 'Family'], ['wab32res:117', 'Notes'], ['wab32res:119', 'IDs']];
    const GROUP_PAGES = [['wab32res:118', 'Contact Group'], ['wab32res:2379', 'Contact Group Details']];
    const P = { sum: 'wab32res:6007', name: 'wab32res:114', home: 'wab32res:115', work: 'wab32res:116', family: 'wab32res:6066', notes: 'wab32res:117', ids: 'wab32res:119', group: 'wab32res:118', gdet: 'wab32res:2379' };

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    const textB64 = (t, type = 'text/vcard') => blobToBase64(new Blob([t], { type }));

    function workspaceRoot() {
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'Default'; // eslint-disable-line no-undef
        return `/Workspaces/${ws}`;
    }

    function account() {
        const a = root.meletonAccounts;
        return (a && typeof a.displayName === 'function' && a.displayName()) || (a && typeof a.name === 'function' && a.name()) || (root.localStorage && root.localStorage.getItem('username')) || '';
    }

    /** Explorer's window, the owner of the sheets when the folder is open. */
    function owner() {
        const m = doc.getElementById('explorerModal');
        return m && !m.classList.contains('hidden') ? m : null;
    }

    function changed() {
        if (root.explorerContacts) root.explorerContacts.changed();
    }

    function message(text, title = 'Melaton Contacts') {
        return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title, width: 400 });
    }

    // ---- the folder ----------------------------------------------------------------------------

    class Folder {
        constructor(path) {
            this.path = path || `${workspaceRoot()}/Contacts`;
            this.items = []; // { c, fileId, fileName }
        }

        async exists() {
            const parent = this.path.replace(/\/[^/]+$/, '');
            const name = this.path.split('/').pop();
            try {
                const top = await vfs().listDirectory(parent, { offset: 0, limit: 500 });
                return ((top && top.items) || []).some((i) => i.name === name && (i.kind === 'folder' || i.targetKind === 'vfs-folder'));
            } catch (_) { return false; }
        }

        /** Vista makes the folder with the person's own contact the first time (wab.exe's first run). */
        async ensure() {
            if (await this.exists()) return false;
            const parent = this.path.replace(/\/[^/]+$/, '');
            try { await vfs().createFolder(parent, this.path.split('/').pop()); } catch (_) { return false; }
            const name = account();
            if (name) {
                const me = VC().blank();
                const bits = name.split(/\s+/);
                me.first = bits[0] || '';
                me.last = bits.length > 1 ? bits[bits.length - 1] : '';
                me.fn = name;
                const it = { c: me, fileId: null, fileName: null };
                this.items.push(it);
                await this.save(it);
                setReg({ MeContact: me.uid });
            }
            return true;
        }

        async load() {
            this.items = [];
            let files = [];
            try {
                const res = await vfs().listDirectory(this.path, { offset: 0, limit: 1000 });
                files = ((res && res.items) || []).filter((i) => /\.vcf$/i.test(i.name || ''));
            } catch (_) { files = []; }
            await Promise.all(files.map(async (f) => {
                try {
                    const id = f.targetId || f.id;
                    const r = await vfs().downloadFile(id);
                    const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).text();
                    VC().parseVcf(text).forEach((c, i) => this.items.push({ c, fileId: i ? null : id, fileName: i ? null : f.name }));
                } catch (err) {
                    console.warn('Contacts: could not read', f.name, err);
                }
            }));
            return this.items;
        }

        byFile(id) { return this.items.find((x) => x.fileId === id) || null; }

        fileNameOf(c) {
            return `${VC().displayName(c).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Contact'}.vcf`;
        }

        async save(it) {
            const data = await textB64(VC().toVcf(it.c));
            try {
                if (it.fileId) await vfs().replaceFile(it.fileId, data, 'text/vcard');
                else {
                    let name = this.fileNameOf(it.c);
                    let n = 2;
                    const used = new Set(this.items.filter((x) => x !== it).map((x) => (x.fileName || '').toLowerCase()));
                    while (used.has(name.toLowerCase())) name = this.fileNameOf(it.c).replace(/\.vcf$/, ` (${n++}).vcf`);
                    const res = await vfs().uploadFile(this.path, data, name, 'text/vcard');
                    const f = res && (res.file || res.entry || res);
                    it.fileId = (f && (f.id || f.fileId)) || null;
                    it.fileName = name;
                }
                return true;
            } catch (err) {
                // wab32res strings 9107 / 9108
                await message(`Changes to this contact could not be saved.\nYou may not have sufficient permissions to change this file or it may be read-only.\n${(err && err.message) || err}`);
                return false;
            }
        }
    }

    // ---- the Properties sheet ------------------------------------------------------------------

    /** A SysListView32 of the template: rows of text, one chosen; the click picks. */
    function listView(ctx, id, page, rows, pick, onPick) {
        const h = ctx.holder(id, page);
        if (!h) return;
        const body = h.querySelector('.vdt-lv-body') || h;
        body.innerHTML = rows.map((r, i) => `<div class="vdt-lv-row${i === pick ? ' is-selected' : ''}" data-i="${i}">${r.icon ? `<img src="${esc(r.icon)}" alt="">` : ''}<span>${esc(r.text)}</span></div>`).join('');
        if (!h.dataset.wired) {
            h.dataset.wired = '1';
            h.addEventListener('click', (ev) => { const r = ev.target.closest('[data-i]'); if (r && h._onPick) h._onPick(Number(r.dataset.i)); });
        }
        h._onPick = onPick;
    }

    /** The picture control (WAB User Tile Control): the framed picture with its drop arrow (PNG 4156-4158). */
    function pictureControl(ctx, page, c, onPick) {
        const h = ctx.holder(2871, page);
        if (!h) return;
        h.classList.add('wcon-tile');
        h.innerHTML = '<span class="wcon-tile-face"></span><img class="wcon-tile-photo" alt="">';
        const img = h.querySelector('.wcon-tile-photo');
        if (root.explorerContacts) void root.explorerContacts.framedPicture(c, 96).then((url) => { img.src = url; });
        if (onPick) h.addEventListener('click', onPick);
        else h.classList.add('is-static');
    }

    /** A SysLink of the template: the text as its link (an e-mail address, a website). */
    function link(ctx, id, page, text, href) {
        const h = ctx.holder(id, page);
        if (!h) return;
        h.innerHTML = text ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : '';
    }

    function properties(folder, it, asGroup) {
        const D = root.vistaDialogTemplate;
        if (!D) return;
        const isNew = !it;
        const c = isNew ? Object.assign(VC().blank(), { group: !!asGroup }) : JSON.parse(JSON.stringify(it.c));
        const name = () => VC().displayName(c);
        const title = `${isNew ? (c.group ? 'New Contact Group' : 'New Contact') : name()} Properties`; // string 4068
        const pages = (c.group ? GROUP_PAGES : CONTACT_PAGES).map(([key, t]) => ({ key, title: t }));
        const set = (ctx, id, v, page) => { const e = ctx.el(id, page); if (e) e.value = v || ''; };
        const get = (ctx, id, page) => { const e = ctx.el(id, page); return e ? String(e.value || '').trim() : ''; };
        const choosePic = (ctx, redraw) => choosePicture(ctx.modal, (data) => { c.photo = data; redraw(); ctx.dirty(); });
        const ctx0 = D.openSheet({
            id: `wconProps_${c.uid.replace(/[^a-z0-9]/gi, '')}`,
            title,
            icon: ICON16,
            owner: owner(),
            pages,
            start: c.group ? P.group : (isNew ? P.name : P.sum),
            init(ctx) {
                if (c.group) {
                    set(ctx, 2360, c.fn, P.group);
                    let pickM = -1;
                    const drawMembers = () => {
                        const rows = c.members.map((u) => { const m = folder.items.find((x) => x.c.uid === u); return { text: m ? `${VC().displayName(m.c)}${VC().email(m.c) ? `  <${VC().email(m.c)}>` : ''}` : '(not in Contacts)', icon: `${ART}/contact-16.png` }; });
                        listView(ctx, 2362, P.group, rows, pickM, (i) => { pickM = i; drawMembers(); });
                        ctx.text(2371, `${c.members.length} Member(s)`, P.group);
                    };
                    drawMembers();
                    ctx.on(2363, 'click', () => pickContacts(folder, ctx.modal, c.members, (uids) => { uids.forEach((u) => { if (!c.members.includes(u)) c.members.push(u); }); drawMembers(); ctx.dirty(); }));
                    ctx.on(2364, 'click', () => { if (pickM >= 0) { c.members.splice(pickM, 1); pickM = -1; drawMembers(); ctx.dirty(); } });
                    // Create New Contact shows the name / e-mail boxes; Create for Group Only adds it
                    const edit = (on) => [2373, 2374, 2375, 2376, 2377, 2378].forEach((id) => { const h = ctx.holder(id, P.group); if (h) h.hidden = !on; });
                    ctx.on(2370, 'click', () => edit(true));
                    ctx.on(2378, 'click', () => { set(ctx, 2374, '', P.group); set(ctx, 2376, '', P.group); edit(false); });
                    ctx.on(2377, 'click', async () => {
                        const n = get(ctx, 2374, P.group);
                        const e = get(ctx, 2376, P.group);
                        if (!n || !e) { await message('Please specify both a Name and an E-mail Address for this entry.'); return; } // 4012
                        const nc = VC().blank();
                        nc.fn = n;
                        nc.emails.push(e);
                        const nit = { c: nc, fileId: null, fileName: null };
                        folder.items.push(nit);
                        await folder.save(nit);
                        c.members.push(nc.uid);
                        set(ctx, 2374, '', P.group);
                        set(ctx, 2376, '', P.group);
                        edit(false);
                        drawMembers();
                        ctx.dirty();
                        changed();
                    });
                    const h = c.home;
                    [[2381, h.street], [2383, h.city], [2385, h.region], [2387, h.postal], [2389, h.country], [2391, h.phone], [2393, h.fax], [2395, h.url], [2366, c.notes]].forEach(([id, v]) => set(ctx, id, v, P.gdet));
                    ctx.on(2396, 'click', () => go(get(ctx, 2395, P.gdet)));
                    return;
                }
                // Summary: read-only, as the contact stands
                const summary = () => {
                    pictureControl(ctx, P.sum, c, null);
                    set(ctx, 2811, name(), P.sum);
                    const mail = VC().email(c);
                    link(ctx, 112, P.sum, mail, `mailto:${mail}`);
                    set(ctx, 2821, c.work.company, P.sum);
                    set(ctx, 2818, c.work.title, P.sum);
                    set(ctx, 2813, c.work.phone, P.sum);
                    link(ctx, 114, P.sum, c.work.url, /^https?:/i.test(c.work.url) ? c.work.url : `https://${c.work.url}`);
                    set(ctx, 2812, c.home.phone, P.sum);
                    set(ctx, 2817, c.home.mobile, P.sum);
                    link(ctx, 113, P.sum, c.home.url, /^https?:/i.test(c.home.url) ? c.home.url : `https://${c.home.url}`);
                    const add = ctx.holder(2778, P.sum);
                    if (add) add.hidden = true; // the card is in Contacts already
                };
                summary();
                // Name and E-mail
                [[2765, c.first], [2769, c.middle], [2766, c.last], [6049, c.prefix], [2770, c.nickname]].forEach(([id, v]) => set(ctx, id, v, P.name));
                const full = ctx.el(67, P.name);
                const fullChoices = () => {
                    const f = c.first;
                    const m = c.middle;
                    const l = c.last;
                    return [...new Set([[f, m, l].filter(Boolean).join(' '), [l, f].filter(Boolean).join(' '), l && f ? `${l}, ${f}` : '', c.fn].filter(Boolean))];
                };
                // Full Name is an editable drop-down (CBS_DROPDOWN): the name parts' orders, or what is typed
                const drawFull = () => {
                    if (!full) return;
                    const list = full.list || (full.getAttribute('list') && doc.getElementById(full.getAttribute('list')));
                    if (list) list.innerHTML = fullChoices().map((x) => `<option value="${esc(x)}"></option>`).join('');
                    if (!full.dataset.typed) full.value = c.fn || fullChoices()[0] || '';
                };
                drawFull();
                if (full) full.addEventListener('input', () => { full.dataset.typed = '1'; c.fn = full.value; ctx.dirty(); });
                [2765, 2769, 2766].forEach((id) => ctx.on(id, 'input', () => {
                    c.first = get(ctx, 2765, P.name);
                    c.middle = get(ctx, 2769, P.name);
                    c.last = get(ctx, 2766, P.name);
                    if (full && !full.dataset.typed) c.fn = '';
                    drawFull();
                    if (full) c.fn = full.value;
                }));
                pictureControl(ctx, P.name, c, () => choosePic(ctx, () => { pictureControl(ctx, P.name, c, null); summary(); }));
                let pickE = -1;
                const drawEmails = () => listView(ctx, 2774, P.name, c.emails.map((e, i) => ({ text: c.emails.length > 1 && i === c.prefEmail ? `${e} (Preferred e-mail)` : e })), pickE, (i) => { pickE = i; set(ctx, 2771, c.emails[i], P.name); drawEmails(); });
                drawEmails();
                ctx.on(2772, 'click', () => { const v = get(ctx, 2771, P.name); if (v) { c.emails.push(v); set(ctx, 2771, '', P.name); pickE = -1; drawEmails(); ctx.dirty(); } });
                ctx.on(2777, 'click', () => { const v = get(ctx, 2771, P.name); if (v && pickE >= 0) { c.emails[pickE] = v; drawEmails(); ctx.dirty(); } });
                ctx.on(2776, 'click', () => { if (pickE >= 0) { c.prefEmail = pickE; drawEmails(); ctx.dirty(); } });
                ctx.on(2775, 'click', () => { if (pickE >= 0) { c.emails.splice(pickE, 1); if (c.prefEmail >= c.emails.length) c.prefEmail = 0; pickE = -1; set(ctx, 2771, '', P.name); drawEmails(); ctx.dirty(); } });
                // Home, Work
                const h = c.home;
                [[2668, h.street], [2669, h.city], [2671, h.region], [2670, h.postal], [2672, h.country], [2674, h.phone], [2675, h.fax], [2676, h.mobile], [2673, h.url]].forEach(([id, v]) => set(ctx, id, v, P.home));
                ctx.on(2677, 'click', () => go(get(ctx, 2673, P.home)));
                const w = c.work;
                [[2571, w.street], [2572, w.city], [2573, w.region], [2574, w.postal], [2575, w.country], [2569, w.company], [2570, w.title], [2579, w.department], [2580, w.office], [2577, w.phone], [2578, w.fax], [2581, w.pager], [2576, w.url]].forEach(([id, v]) => set(ctx, id, v, P.work));
                ctx.on(2586, 'click', () => go(get(ctx, 2576, P.work)));
                // Family: the date pickers stand where the template's blank statics are
                const g = ctx.el(108, P.family);
                if (g && g.tagName === 'SELECT') g.innerHTML = ['Unspecified', 'Male', 'Female'].map((x) => `<option${(c.gender || 'Unspecified') === x ? ' selected' : ''}>${x}</option>`).join('');
                const dateBox = (id, v) => { const host = ctx.holder(id, P.family); if (host) { host.innerHTML = `<input type="date" class="tbp-edit wcon-date" value="${esc(v)}">`; host.querySelector('input').addEventListener('change', () => ctx.dirty()); } };
                dateBox(6061, c.birthday);
                dateBox(6063, c.anniversary);
                set(ctx, 6054, c.spouse, P.family);
                let pickK = -1;
                const drawKids = () => listView(ctx, 6056, P.family, c.children.map((k) => ({ text: k })), pickK, (i) => { pickK = i; drawKids(); });
                drawKids();
                ctx.on(6057, 'click', () => askText(ctx.modal, 'Add Child', '', (v) => { c.children.push(v); drawKids(); ctx.dirty(); }));
                ctx.on(6058, 'click', () => { if (pickK >= 0) askText(ctx.modal, 'Edit Child', c.children[pickK], (v) => { c.children[pickK] = v; drawKids(); ctx.dirty(); }); });
                ctx.on(6059, 'click', () => { if (pickK >= 0) { c.children.splice(pickK, 1); pickK = -1; drawKids(); ctx.dirty(); } });
                set(ctx, 2463, c.notes, P.notes);
                // IDs: the e-mail addresses; no digital IDs are kept
                const ids = ctx.el(96, P.ids);
                if (ids && ids.tagName === 'SELECT') ids.innerHTML = (c.emails.length ? c.emails : ['[None - digital IDs without associated E-mail addresses]']).map((e) => `<option>${esc(e)}</option>`).join(''); // 4306
                listView(ctx, 2475, P.ids, [], -1, () => {});
            },
            async apply(ctx) {
                if (c.group) {
                    c.fn = get(ctx, 2360, P.group) || 'New Contact Group';
                    const h = c.home;
                    [h.street, h.city, h.region, h.postal, h.country, h.phone, h.fax, h.url] = [2381, 2383, 2385, 2387, 2389, 2391, 2393, 2395].map((id) => get(ctx, id, P.gdet));
                    c.notes = (ctx.el(2366, P.gdet) || {}).value || '';
                } else {
                    [c.first, c.middle, c.last, c.prefix, c.nickname] = [2765, 2769, 2766, 6049, 2770].map((id) => get(ctx, id, P.name));
                    const full = ctx.el(67, P.name);
                    c.fn = full && full.value ? full.value : [c.first, c.middle, c.last].filter(Boolean).join(' ');
                    const pending = get(ctx, 2771, P.name);
                    if (pending && !c.emails.includes(pending)) c.emails.push(pending);
                    const h = c.home;
                    [h.street, h.city, h.region, h.postal, h.country, h.phone, h.fax, h.mobile, h.url] = [2668, 2669, 2671, 2670, 2672, 2674, 2675, 2676, 2673].map((id) => get(ctx, id, P.home));
                    const w = c.work;
                    [w.street, w.city, w.region, w.postal, w.country, w.company, w.title, w.department, w.office, w.phone, w.fax, w.pager, w.url] = [2571, 2572, 2573, 2574, 2575, 2569, 2570, 2579, 2580, 2577, 2578, 2581, 2576].map((id) => get(ctx, id, P.work));
                    const g = ctx.el(108, P.family);
                    c.gender = g && g.value !== 'Unspecified' ? g.value : '';
                    const bd = ctx.holder(6061, P.family);
                    const an = ctx.holder(6063, P.family);
                    c.birthday = bd && bd.querySelector('input') ? bd.querySelector('input').value : c.birthday;
                    c.anniversary = an && an.querySelector('input') ? an.querySelector('input').value : c.anniversary;
                    c.spouse = get(ctx, 6054, P.family);
                    c.notes = (ctx.el(2463, P.notes) || {}).value || '';
                }
                let target = it;
                if (!target) {
                    target = { c, fileId: null, fileName: null };
                    folder.items.push(target);
                    it = target;
                } else target.c = c;
                if (await folder.save(target)) changed();
            }
        });
        // a new contact's sheet opens with OK ready (Vista: Apply is not needed to add it)
        if (ctx0 && isNew) ctx0.dirty();
    }

    function go(url) {
        if (url) root.open(/^https?:/i.test(url) ? url : `https://${url}`, '_blank', 'noopener');
    }

    /** A one-line text prompt (the Family page's Add / Edit child). */
    async function askText(ownerEl, title, value, done) {
        const v = await call('showConfirmationDialog', `<input type="text" class="tbp-edit wcon-ask" value="${esc(value)}" style="width:100%">`, [{ text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, {
            title, width: 320, resolveValue: (ok, dialog) => (ok ? (dialog.querySelector('.wcon-ask') || {}).value : null)
        });
        if (v && String(v).trim()) done(String(v).trim());
    }

    /** Add to Contact Group: Vista's contact picker (wab32res 106) without its recipient lists. */
    function pickContacts(folder, ownerEl, already, done) {
        const D = root.vistaDialogTemplate;
        const people = folder.items.filter((x) => !x.c.group && !already.includes(x.c.uid));
        const picked = new Set();
        const hide = { hidden: true };
        D.openDialog({
            id: 'wconPick',
            key: 'wab32res:106',
            title: 'Add Members to Contact Group', // 4030
            icon: ICON16,
            owner: ownerEl,
            overrides: { 7020: hide, 7021: hide, 7022: hide, 7009: hide, 7030: hide, 7031: hide, 7032: hide, 7005: hide, 7034: hide, 7004: hide, 7033: hide, 2786: hide, 7002: hide },
            init: (ctx) => {
                const draw = (q) => {
                    const rows = people.filter((x) => !q || VC().displayName(x.c).toLowerCase().includes(q));
                    const h = ctx.holder(7003);
                    if (!h) return;
                    const body = h.querySelector('.vdt-lv-body') || h;
                    body.innerHTML = rows.map((x) => `<div class="vdt-lv-row${picked.has(x.c.uid) ? ' is-selected' : ''}" data-u="${esc(x.c.uid)}"><img src="${ART}/contact-16.png" alt=""><span>${esc(VC().displayName(x.c))}</span></div>`).join('');
                };
                draw('');
                ctx.on(7001, 'input', () => draw(String(ctx.get(7001) || '').trim().toLowerCase()));
                const h = ctx.holder(7003);
                if (h) h.addEventListener('click', (ev) => { const r = ev.target.closest('[data-u]'); if (!r) return; const u = r.dataset.u; if (ev.ctrlKey || ev.metaKey) { if (picked.has(u)) picked.delete(u); else picked.add(u); } else { picked.clear(); picked.add(u); } draw(String(ctx.get(7001) || '').trim().toLowerCase()); });
            },
            ok: () => { done([...picked]); return true; }
        });
    }

    /** Change picture: "Select a picture for Contact" (string 2876), a 96 px square from the middle. */
    function choosePicture(ownerEl, done) {
        if (typeof root.studioOpenFolderDialog !== 'function') return;
        void root.studioOpenFolderDialog('open-vfs', {
            owner: ownerEl,
            startPath: workspaceRoot(),
            host: {
                title: 'Select a picture for Contact',
                rejectMessage: 'Choose a picture',
                acceptItem: (item) => !!item && (item.targetKind === 'image' || (item.targetKind === 'user-file' && /^image\//.test(item.mimeType || ''))),
                onOpen: async (item) => {
                    try {
                        let url;
                        if (item.targetKind === 'user-file') url = (await vfs().downloadFile(item.targetId || item.id)).downloadUrl;
                        else url = `/images/${encodeURIComponent(item.previewImageFilename || item.targetId || item.name)}`;
                        const img = new Image();
                        img.src = url;
                        await img.decode();
                        const s = Math.min(img.naturalWidth, img.naturalHeight);
                        const cv = doc.createElement('canvas');
                        cv.width = 96;
                        cv.height = 96;
                        cv.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 96, 96);
                        done(cv.toDataURL('image/png'));
                    } catch (err) {
                        await message(`The picture could not be used.\n${(err && err.message) || err}`);
                    }
                }
            }
        });
    }

    // ---- import / export (1101 / 1105) ----------------------------------------------------------

    const FORMATS = [['csv', 'CSV (Comma Separated Values)'], ['vcard', 'vCard (folder of .vcf files)']]; // 1549, 1540

    function formatDialog(kind, done) {
        const D = root.vistaDialogTemplate;
        const imp = kind === 'import';
        let pick = 0;
        D.openDialog({
            id: imp ? 'wconImport' : 'wconExport',
            key: imp ? 'wab32res:1101' : 'wab32res:1105',
            icon: ICON16,
            owner: owner(),
            init: (ctx) => {
                // strings 1501 / 1511
                ctx.text(1116, imp
                    ? 'Select the file format you want to import contacts from, so you can view them in this version of Melaton and store them in your Melaton Contacts folder.'
                    : 'Select the format you want to export contacts to.  This can allow someone using another program or previous version of Melaton to open and view them.');
                const draw = () => {
                    const h = ctx.holder(1117);
                    if (!h) return;
                    h.classList.add('wcon-format-list');
                    h.innerHTML = FORMATS.map(([, t], i) => `<div class="vdt-lb-row${i === pick ? ' is-selected' : ''}" data-i="${i}">${esc(t)}</div>`).join('');
                };
                draw();
                const h = ctx.holder(1117);
                if (h) {
                    h.addEventListener('click', (ev) => { const r = ev.target.closest('[data-i]'); if (r) { pick = Number(r.dataset.i); draw(); } });
                    h.addEventListener('dblclick', () => { done(FORMATS[pick][0]); ctx.state.cancel(); });
                }
                const prog = ctx.holder(1113);
                if (prog) prog.hidden = true;
                // the template disables Import / Export until a format is chosen; the first one is
                const go = ctx.holder(imp ? 1114 : 1118);
                if (go) go.disabled = false;
            },
            buttons: {
                1114: (ctx) => { done(FORMATS[pick][0]); ctx.state.cancel(); },
                1118: (ctx) => { done(FORMATS[pick][0]); ctx.state.cancel(); }
            }
        });
    }

    async function importContacts(folder) {
        await folder.load();
        formatDialog('import', (fmt) => {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            const csv = fmt === 'csv';
            void root.studioOpenFolderDialog('open-vfs', {
                owner: owner(),
                startPath: workspaceRoot(),
                host: {
                    title: csv ? 'CSV Import' : 'Import Business Card (vCard)', // 1110 / 45
                    rejectMessage: csv ? 'Choose a CSV file' : 'Choose a vCard (.vcf) file',
                    acceptItem: (item) => !!item && item.targetKind === 'user-file' && (csv ? /\.(csv|txt)$/i : /\.vcf$/i).test(item.name || ''),
                    onOpen: async (item) => {
                        try {
                            const r = await vfs().downloadFile(item.targetId || item.id);
                            const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).text();
                            const cards = csv ? VC().parseCsv(text) : VC().parseVcf(text);
                            if (!cards.length) { await message(`File ${item.name} does not seem to be a valid business card (vCard).`); return; } // 47
                            const have = new Set(folder.items.map((x) => x.c.uid));
                            for (const c of cards) {
                                if (have.has(c.uid)) continue;
                                const it = { c, fileId: null, fileName: null };
                                folder.items.push(it);
                                await folder.save(it);
                            }
                            changed();
                            // 1506
                            await message('Your contacts have been imported from their previous location and format into your Melaton Contacts folder.', 'Import to Melaton Contacts');
                        } catch (err) {
                            await message(`An error occurred during the import process.\nThe import process could not be completed.\n${(err && err.message) || err}`, 'Import Error'); // 4421
                        }
                    }
                }
            });
        });
    }

    async function exportContacts(folder, list) {
        await folder.load();
        const chosen = list && list.length ? list : folder.items;
        formatDialog('export', (fmt) => {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            const csv = fmt === 'csv';
            const cards = chosen.map((x) => x.c);
            void root.studioOpenFolderDialog('save', {
                owner: owner(),
                startPath: workspaceRoot(),
                host: {
                    title: csv ? 'CSV Export' : 'Select the folder for VCF export.', // 1107 / 1573
                    typeLabel: csv ? 'Comma Separated Values (*.csv)' : 'vCards (*.vcf)',
                    acceptType: 'user-file',
                    suggestName: () => (csv ? 'Contacts.csv' : (cards.length === 1 ? folder.fileNameOf(cards[0]) : 'Contacts.vcf')),
                    async onSave(info) {
                        let name = String(info.name || '').trim();
                        if (!name) return false;
                        try {
                            if (csv) {
                                if (!/\.csv$/i.test(name)) name += '.csv';
                                await vfs().uploadFile(info.path || '/', await textB64(VC().toCsv(cards), 'text/csv'), name, 'text/csv');
                            } else {
                                // a folder of .vcf files: one card each, next to the name chosen
                                const people = cards.filter((c) => !c.group);
                                if (!people.length) { await message('Groups cannot be exported as business cards (vCards).'); return false; } // 50
                                for (const c of people) await vfs().uploadFile(info.path || '/', await textB64(VC().toVcf(c)), people.length === 1 && /\.vcf$/i.test(name) ? name : folder.fileNameOf(c), 'text/vcard');
                            }
                            // 1516
                            await message('Your contacts have been exported in the new format you chose to the location you selected.', 'Export Melaton Contacts');
                            return true;
                        } catch (err) {
                            await message(`An error occurred during the export process.\nThe export process could not be completed.\n${(err && err.message) || err}`, 'Error exporting contacts'); // 4465
                            return false;
                        }
                    },
                    onCancel() {}
                }
            });
        });
    }

    // ---- e-mail, Send Contact, This Is Me, Call, Print ------------------------------------------

    function addresses(folder, list) {
        const out = [];
        list.forEach(({ c }) => {
            if (c.group) c.members.forEach((u) => { const m = folder.items.find((x) => x.c.uid === u); if (m && VC().email(m.c)) out.push(VC().email(m.c)); });
            else if (VC().email(c)) out.push(VC().email(c));
        });
        return [...new Set(out)];
    }

    function compose(opts) {
        const open = typeof doveOpenComposeWindow === 'function' ? doveOpenComposeWindow : root.doveOpenComposeWindow; // eslint-disable-line no-undef
        if (typeof open !== 'function') { void message('An error occurred while attempting to invoke the default e-mail program.'); return; } // 4291
        open(Object.assign({ mode: 'create', subject: '', body: '' }, opts));
    }

    async function email(folder, list) {
        const to = addresses(folder, list);
        if (!to.length) { await message('Entries must have an e-mail address in order to send mail.'); return; } // 4090
        compose({ to });
    }

    async function sendContact(list) {
        const attachments = [];
        for (const { c } of list.filter((x) => !x.c.group)) {
            const text = VC().toVcf(c);
            attachments.push({ name: `${VC().displayName(c)}.vcf`, mimeType: 'text/vcard', size: text.length, base64: await textB64(text) });
        }
        if (attachments.length) compose({ attachments, subject: attachments.length === 1 ? attachments[0].name.replace(/\.vcf$/, '') : '' });
    }

    function newCall(list) {
        const D = root.vistaDialogTemplate;
        const one = list[0];
        if (!one || !D) return;
        const c = one.c;
        const nums = [['Home', c.home.phone], ['Business', c.work.phone], ['Mobile', c.home.mobile]].filter((x) => x[1]); // 4432 / 4433
        D.openDialog({
            id: 'wconCall',
            key: 'wab32res:6012',
            icon: ICON16,
            owner: owner(),
            init: (ctx) => {
                ctx.set(6067, VC().displayName(c));
                const sel = ctx.el(6018);
                if (sel && sel.tagName === 'SELECT') sel.innerHTML = (nums.length ? nums : [['', 'No Phone Numbers Available']]).map(([k, v]) => `<option>${esc(k ? `${k}: ${v}` : v)}</option>`).join(''); // 4446
                const callBtn = ctx.holder(6016);
                if (callBtn) callBtn.disabled = true; // no modem to dial with
                const dialing = ctx.holder(6020);
                if (dialing) dialing.disabled = true;
            },
            buttons: {
                6015: () => properties(new Folder(one.folder), one, false),
                6021: (ctx) => ctx.state.cancel()
            }
        });
    }

    function printDialog(folder, list) {
        const D = root.vistaDialogTemplate;
        const base = root.vistaDialogTemplates && root.vistaDialogTemplates['wab32res:6047'];
        if (!D || !base) return;
        // the options panel under Print's own buttons
        const tpl = { ...base, t: 'Print', h: base.h + 22, c: base.c.concat([[1, 'B', base.w - 108, base.h + 3, 50, 14, 0x50010001, 'Print', 0], [2, 'B', base.w - 54, base.h + 3, 50, 14, 0x50010000, 'Cancel', 0]]) };
        D.openDialog({
            id: 'wconPrint', tpl, icon: ICON16, owner: owner(),
            init: (ctx) => {
                ctx.set(list.length ? 1057 : 1056, true);
                ctx.set(60, true);
                ctx.set(1153, '1');
                if (!list.length) { const e = ctx.el(1057); if (e) e.disabled = true; }
            },
            ok: (ctx) => {
                const chosen = (ctx.get(1057) ? list : folder.items).filter((x) => !x.c.group);
                const style = ctx.get(61) ? 'card' : ctx.get(62) ? 'phone' : 'memo';
                print(chosen, style);
                return true;
            }
        });
    }

    function print(list, style) {
        const V = VC();
        const line = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : '');
        const body = style === 'phone'
            ? `<table class="phones">${list.map(({ c }) => `<tr><td>${esc(V.displayName(c))}</td><td>${esc([c.home.phone && `Home: ${c.home.phone}`, c.work.phone && `Business : ${c.work.phone}`, c.home.mobile && `Mobile: ${c.home.mobile}`].filter(Boolean).join('   '))}</td></tr>`).join('')}</table>`
            : list.map(({ c }) => `<div class="${style}"><h2>${esc(V.displayName(c))}</h2><table>${line('E-mail Address(es):', c.emails.join(', '))}${line('Home Phone:', c.home.phone)}${line('Mobile Phone', c.home.mobile)}${line('Home Address:', [c.home.street, c.home.city, c.home.region, c.home.postal, c.home.country].filter(Boolean).join(', '))}${line('Business Information:', [c.work.company, c.work.department, c.work.title].filter(Boolean).join(', '))}${line('Business Phone:', c.work.phone)}${line('Business Address:', [c.work.street, c.work.city, c.work.region, c.work.postal, c.work.country].filter(Boolean).join(', '))}${style === 'memo' ? line('Notes:', c.notes) : ''}</table></div>`).join('');
        const f = doc.createElement('iframe');
        f.style.cssText = 'position:fixed;left:-10000px;width:900px;height:700px;border:0';
        doc.body.appendChild(f);
        const w = f.contentWindow;
        w.document.open();
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Contacts</title><style>body{font:12px "Segoe UI",Tahoma,sans-serif;margin:16px}h2{font-size:15px;margin:14px 0 4px;border-bottom:1px solid #999}th{text-align:left;padding-right:12px;color:#555;font-weight:normal;vertical-align:top}.card{display:inline-block;width:46%;margin:0 2% 12px 0;padding:8px;border:1px solid #999;vertical-align:top}.phones td{padding:3px 14px 3px 0;border-bottom:1px solid #ddd}</style></head><body>${body}</body></html>`);
        w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch (_) { /* no printing here */ } setTimeout(() => f.remove(), 2000); }, 300);
    }

    // ---- the package ---------------------------------------------------------------------------

    async function openFolder(folder) {
        await folder.ensure();
        if (root.featureLoader) { try { await root.featureLoader.loadFeature('explorer'); } catch (_) { /* below */ } }
        if (typeof root.openExplorerApplet === 'function') await root.openExplorerApplet(folder.path);
    }

    async function run(args) {
        const a = args || {};
        const folder = new Folder(a.folder);
        const action = a.action || 'open-folder';
        if (action === 'open-folder') { await openFolder(folder); return; }
        if (root.featureLoader && !root.vistaDialogTemplate) { try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* no dialogs */ } }
        if (!VC() && root.featureLoader) { try { await root.featureLoader.loadFeature('explorer'); } catch (_) { /* no cards */ } }
        await folder.load();
        const chosen = (a.files || []).map((f) => folder.byFile(f.id)).filter(Boolean);
        chosen.forEach((x) => { x.folder = folder.path; });
        switch (action) {
            case 'open': if (chosen[0]) properties(folder, chosen[0], chosen[0].c.group); return;
            case 'new': properties(folder, null, false); return;
            case 'new-group': properties(folder, null, true); return;
            case 'import': await importContacts(folder); return;
            case 'export': await exportContacts(folder, chosen); return;
            case 'print': printDialog(folder, chosen); return;
            case 'email': await email(folder, chosen); return;
            case 'send': await sendContact(chosen); return;
            case 'call': newCall(chosen); return;
            case 'me': if (chosen[0]) { setReg({ MeContact: chosen[0].c.uid }); changed(); } return;
            default:
        }
    }

    async function start(app) {
        try {
            await run(app.args);
        } catch (err) {
            console.error('Melaton Contacts:', err);
        } finally {
            // the sheets and dialogs are windows of their own; the program has nothing left open
            app.exit();
        }
    }

    root.melatonContacts = { start, run, meContact: () => reg('MeContact', '') };
    if (typeof melatonApps !== 'undefined') melatonApps.define('contacts', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
