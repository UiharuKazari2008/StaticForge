/**
 * Windows Contacts (Yozora #632), Vista's Contacts folder (wab.exe) as a Melaton system package
 * (apps/contacts).
 *
 *   the window      an Explorer folder: Back / address / search, the command bar (Organize, Views,
 *                   New Contact, New Contact Group, Import, Export, Print, E-mail), Favorite Links,
 *                   the contacts (Details, Tiles, Icons) and the Details pane under them
 *   Properties      Vista's sheet: Summary, Name and E-mail, Home, Work, Family, Notes, IDs; a
 *                   contact group's: Contact Group (members) and Contact Group Details
 *   the data        each contact is a vCard 3.0 file in Workspaces/<ws>/Contacts/<name>.vcf (its picture
 *                   in PHOTO); a group is a vCard with X-ADDRESSBOOKSERVER-KIND:group and its members
 *   Import / Export vCard (.vcf, several in one file) and CSV (Outlook's columns); E-mail opens
 *                   Dovecote to the chosen contacts; Print lists them (Memo, Business Card, Phone List)
 *
 *   melatonApps.define('contacts', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\Windows Contacts';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const ICON16 = '/static_images/app_icons/16/vista-contacts.webp';
    const ICON24 = '/static_images/app_icons/24/vista-contacts.webp';
    const CMD = '/static_images/vista-cmdbar';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const vfs = () => root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef

    // ---- vCard -------------------------------------------------------------------------------

    const vEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const vUnesc = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\:])/g, '$1');
    const splitSemi = (v) => { const out = []; let cur = ''; for (let i = 0; i < v.length; i += 1) { const ch = v[i]; if (ch === '\\' && i + 1 < v.length) { cur += ch + v[i + 1]; i += 1; } else if (ch === ';') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(vUnesc); };

    function blank() {
        return {
            uid: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, group: false, members: [],
            first: '', middle: '', last: '', prefix: '', suffix: '', nickname: '', fn: '', emails: [], prefEmail: 0,
            home: { street: '', city: '', region: '', postal: '', country: '', phone: '', fax: '', mobile: '', url: '' },
            work: { company: '', title: '', department: '', office: '', street: '', city: '', region: '', postal: '', country: '', phone: '', fax: '', pager: '', url: '' },
            gender: '', birthday: '', anniversary: '', spouse: '', children: [], notes: '', photo: ''
        };
    }

    /** A .vcf text to its cards (a file may hold several). */
    function parseVcf(text) {
        const lines = String(text || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
        const cards = [];
        let c = null;
        for (const line of lines) {
            const colon = line.indexOf(':');
            if (colon < 0) continue;
            const head = line.slice(0, colon);
            const value = line.slice(colon + 1);
            const parts = head.split(';');
            const name = parts[0].replace(/^item\d+\./i, '').toUpperCase();
            const params = parts.slice(1).join(';').toUpperCase();
            const types = (params.match(/(?:TYPE=)?([A-Z,]+)/g) || []).join(',').replace(/TYPE=/g, '').split(',');
            const is = (t) => types.includes(t);
            if (name === 'BEGIN' && value.toUpperCase() === 'VCARD') { c = blank(); continue; }
            if (name === 'END' && value.toUpperCase() === 'VCARD') { if (c) { if (!c.fn) c.fn = [c.first, c.middle, c.last].filter(Boolean).join(' '); cards.push(c); } c = null; continue; }
            if (!c) continue;
            switch (name) {
                case 'UID': c.uid = value.replace(/^urn:uuid:/i, ''); break;
                case 'FN': c.fn = vUnesc(value); break;
                case 'N': { const [l, f, m, p, s] = splitSemi(value); c.last = l || ''; c.first = f || ''; c.middle = m || ''; c.prefix = p || ''; c.suffix = s || ''; break; }
                case 'NICKNAME': c.nickname = vUnesc(value); break;
                case 'EMAIL': c.emails.push(value.trim()); if (is('PREF') || /PREF=1/.test(params)) c.prefEmail = c.emails.length - 1; break;
                case 'TEL': {
                    const v = value.trim();
                    if (is('FAX')) { if (is('WORK')) c.work.fax = v; else c.home.fax = v; } else if (is('PAGER')) c.work.pager = v; else if (is('CELL')) c.home.mobile = v; else if (is('WORK')) c.work.phone = v; else c.home.phone = c.home.phone || v;
                    break;
                }
                case 'ADR': {
                    const [, , street, city, region, postal, country] = splitSemi(value);
                    const into = is('WORK') ? c.work : c.home;
                    Object.assign(into, { street: street || '', city: city || '', region: region || '', postal: postal || '', country: country || '' });
                    break;
                }
                case 'ORG': { const [co, dep] = splitSemi(value); c.work.company = co || ''; c.work.department = dep || ''; break; }
                case 'TITLE': c.work.title = vUnesc(value); break;
                case 'X-OFFICE': c.work.office = vUnesc(value); break;
                case 'URL': if (is('WORK')) c.work.url = value; else c.home.url = value; break;
                case 'BDAY': c.birthday = value.replace(/T.*$/, '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'); break;
                case 'ANNIVERSARY': case 'X-ANNIVERSARY': c.anniversary = value.replace(/T.*$/, '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'); break;
                case 'X-GENDER': case 'GENDER': c.gender = /^f/i.test(value) ? 'Female' : /^m/i.test(value) ? 'Male' : ''; break;
                case 'X-SPOUSE': c.spouse = vUnesc(value); break;
                case 'X-CHILD': c.children.push(vUnesc(value)); break;
                case 'NOTE': c.notes = vUnesc(value); break;
                case 'PHOTO': {
                    if (/^data:/i.test(value)) c.photo = value;
                    else if (/ENCODING=B|ENCODING=BASE64/.test(params)) c.photo = `data:image/${/JPE?G/.test(params) ? 'jpeg' : /GIF/.test(params) ? 'gif' : 'png'};base64,${value.trim()}`;
                    break;
                }
                case 'X-ADDRESSBOOKSERVER-KIND': case 'KIND': c.group = /group/i.test(value); break;
                case 'X-ADDRESSBOOKSERVER-MEMBER': case 'MEMBER': c.members.push(value.replace(/^urn:uuid:/i, '')); break;
                default:
            }
        }
        return cards;
    }

    function fold(line) {
        const out = [];
        let s = line;
        while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; }
        out.push(s);
        return out.join('\r\n');
    }

    function toVcf(c) {
        const L = ['BEGIN:VCARD', 'VERSION:3.0', `UID:${c.uid}`, `FN:${vEsc(displayName(c))}`];
        if (c.group) {
            L.push('X-ADDRESSBOOKSERVER-KIND:group', `N:${vEsc(displayName(c))};;;;`);
            c.members.forEach((m) => L.push(`X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:${m}`));
        } else {
            L.push(`N:${[c.last, c.first, c.middle, c.prefix, c.suffix].map(vEsc).join(';')}`);
            if (c.nickname) L.push(`NICKNAME:${vEsc(c.nickname)}`);
            c.emails.forEach((e, i) => L.push(`EMAIL;TYPE=INTERNET${i === c.prefEmail ? ',PREF' : ''}:${e}`));
            const h = c.home;
            const w = c.work;
            if (h.phone) L.push(`TEL;TYPE=HOME,VOICE:${h.phone}`);
            if (h.mobile) L.push(`TEL;TYPE=CELL:${h.mobile}`);
            if (h.fax) L.push(`TEL;TYPE=HOME,FAX:${h.fax}`);
            if (w.phone) L.push(`TEL;TYPE=WORK,VOICE:${w.phone}`);
            if (w.fax) L.push(`TEL;TYPE=WORK,FAX:${w.fax}`);
            if (w.pager) L.push(`TEL;TYPE=PAGER:${w.pager}`);
            if (h.street || h.city || h.region || h.postal || h.country) L.push(`ADR;TYPE=HOME:;;${[h.street, h.city, h.region, h.postal, h.country].map(vEsc).join(';')}`);
            if (w.street || w.city || w.region || w.postal || w.country) L.push(`ADR;TYPE=WORK:;;${[w.street, w.city, w.region, w.postal, w.country].map(vEsc).join(';')}`);
            if (w.company || w.department) L.push(`ORG:${vEsc(w.company)};${vEsc(w.department)}`);
            if (w.title) L.push(`TITLE:${vEsc(w.title)}`);
            if (w.office) L.push(`X-OFFICE:${vEsc(w.office)}`);
            if (h.url) L.push(`URL;TYPE=HOME:${h.url}`);
            if (w.url) L.push(`URL;TYPE=WORK:${w.url}`);
            if (c.birthday) L.push(`BDAY:${c.birthday}`);
            if (c.anniversary) L.push(`X-ANNIVERSARY:${c.anniversary}`);
            if (c.gender) L.push(`X-GENDER:${c.gender}`);
            if (c.spouse) L.push(`X-SPOUSE:${vEsc(c.spouse)}`);
            c.children.forEach((k) => L.push(`X-CHILD:${vEsc(k)}`));
            const m = /^data:image\/(png|jpeg|gif);base64,(.+)$/.exec(c.photo || '');
            if (m) L.push(`PHOTO;ENCODING=b;TYPE=${m[1].toUpperCase()}:${m[2]}`);
        }
        if (c.notes) L.push(`NOTE:${vEsc(c.notes)}`);
        L.push(`REV:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`, 'END:VCARD');
        return `${L.map(fold).join('\r\n')}\r\n`;
    }

    function displayName(c) {
        return c.fn || [c.first, c.middle, c.last].filter(Boolean).join(' ') || c.nickname || (c.emails[0] || '') || (c.group ? 'New Contact Group' : 'New Contact');
    }

    // ---- CSV (Outlook's columns, what Vista's CSV export writes) ---------------------------------

    const CSV_COLS = [
        ['First Name', (c) => c.first, (c, v) => { c.first = v; }], ['Middle Name', (c) => c.middle, (c, v) => { c.middle = v; }], ['Last Name', (c) => c.last, (c, v) => { c.last = v; }],
        ['Name', (c) => displayName(c), (c, v) => { c.fn = v; }], ['Nickname', (c) => c.nickname, (c, v) => { c.nickname = v; }],
        ['E-mail Address', (c) => c.emails[c.prefEmail] || c.emails[0] || '', (c, v) => { if (v) c.emails.push(v); }],
        ['Home Street', (c) => c.home.street, (c, v) => { c.home.street = v; }], ['Home City', (c) => c.home.city, (c, v) => { c.home.city = v; }],
        ['Home Postal Code', (c) => c.home.postal, (c, v) => { c.home.postal = v; }], ['Home State', (c) => c.home.region, (c, v) => { c.home.region = v; }],
        ['Home Country/Region', (c) => c.home.country, (c, v) => { c.home.country = v; }], ['Home Phone', (c) => c.home.phone, (c, v) => { c.home.phone = v; }],
        ['Mobile Phone', (c) => c.home.mobile, (c, v) => { c.home.mobile = v; }], ['Personal Web Page', (c) => c.home.url, (c, v) => { c.home.url = v; }],
        ['Business Street', (c) => c.work.street, (c, v) => { c.work.street = v; }], ['Business City', (c) => c.work.city, (c, v) => { c.work.city = v; }],
        ['Business Postal Code', (c) => c.work.postal, (c, v) => { c.work.postal = v; }], ['Business State', (c) => c.work.region, (c, v) => { c.work.region = v; }],
        ['Business Country/Region', (c) => c.work.country, (c, v) => { c.work.country = v; }], ['Business Web Page', (c) => c.work.url, (c, v) => { c.work.url = v; }],
        ['Business Phone', (c) => c.work.phone, (c, v) => { c.work.phone = v; }], ['Business Fax', (c) => c.work.fax, (c, v) => { c.work.fax = v; }],
        ['Pager', (c) => c.work.pager, (c, v) => { c.work.pager = v; }], ['Company', (c) => c.work.company, (c, v) => { c.work.company = v; }],
        ['Job Title', (c) => c.work.title, (c, v) => { c.work.title = v; }], ['Department', (c) => c.work.department, (c, v) => { c.work.department = v; }],
        ['Office Location', (c) => c.work.office, (c, v) => { c.work.office = v; }], ['Notes', (c) => c.notes, (c, v) => { c.notes = v; }]
    ];

    function csvCell(v) {
        const s = String(v == null ? '' : v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }

    function toCsv(list) {
        return [CSV_COLS.map((c) => c[0]).join(',')].concat(list.filter((c) => !c.group).map((c) => CSV_COLS.map((col) => csvCell(col[1](c))).join(','))).join('\r\n') + '\r\n';
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let cell = '';
        let q = false;
        const t = String(text || '').replace(/^\uFEFF/, '');
        for (let i = 0; i < t.length; i += 1) {
            const ch = t[i];
            if (q) {
                if (ch === '"' && t[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
            } else if (ch === '"') q = true;
            else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && t[i + 1] === '\n') i += 1;
                row.push(cell); cell = '';
                if (row.some((x) => x !== '')) rows.push(row);
                row = [];
            } else cell += ch;
        }
        if (cell || row.length) { row.push(cell); if (row.some((x) => x !== '')) rows.push(row); }
        if (!rows.length) return [];
        const head = rows[0].map((h) => h.trim().toLowerCase());
        return rows.slice(1).map((r) => {
            const c = blank();
            CSV_COLS.forEach(([name, , set]) => { const i = head.indexOf(name.toLowerCase()); if (i >= 0 && r[i]) set(c, r[i].trim()); });
            if (!c.fn && head.includes('e-mail address') === false && r[0]) c.fn = r[0];
            return c;
        });
    }

    // ---- files -------------------------------------------------------------------------------

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

    // ---- the Properties sheet's pages (DLGTEMPLATEEX in MS Shell Dlg units, like Vista's) ----------

    const E = 0x50810080; // edit, border, auto-scroll
    const EM = 0x50a11044; // multi-line edit
    const S = 0x50020000; // static
    const B = 0x50010000; // push button
    const G = 0x50000007; // group box
    const CB = 0x50210003; // drop-down list
    const PIC = 0x5000000e; // a picture (filled by the script)
    const row = (id, label, y, x = 72, w = 170) => [[-1, 'S', 7, y + 2, 62, 8, S, label, 0], [id, 'E', x, y, w, 12, E, '', 0]];

    function registerPages() {
        const T = root.vistaDialogTemplates;
        if (!T || T['contacts:summary']) return;
        const f = ['MS Shell Dlg', 8];
        T['contacts:summary'] = { t: 'Summary', w: 252, h: 218, f, c: [[101, 'S', 7, 7, 60, 60, PIC, '', 0], [102, 'S', 75, 7, 170, 204, PIC, '', 0]] };
        T['contacts:name'] = { t: 'Name and E-mail', w: 252, h: 218, f, c: [
            ...row(103, '&First:', 7, 62, 112), ...row(104, '&Middle:', 23, 62, 112), ...row(105, '&Last:', 39, 62, 112),
            ...row(106, 'Personal &Title:', 55, 62, 112), ...row(107, '&Nickname:', 71, 62, 112), ...row(108, 'F&ull Name:', 87, 62, 112),
            [109, 'S', 183, 7, 62, 62, PIC, '', 0], [110, 'B', 183, 73, 62, 14, B, 'C&hange picture...', 0],
            [-1, 'S', 7, 110, 50, 8, S, '&E-mail:', 0], [111, 'E', 62, 108, 128, 12, E, '', 0], [112, 'B', 195, 107, 50, 14, B, '&Add', 0],
            [113, 'S', 7, 126, 183, 84, PIC, '', 0],
            [114, 'B', 195, 126, 50, 14, B, 'E&dit', 0], [115, 'B', 195, 144, 50, 14, B, '&Set Preferred', 0], [116, 'B', 195, 162, 50, 14, B, '&Remove', 0]
        ] };
        T['contacts:home'] = { t: 'Home', w: 252, h: 218, f, c: [
            [-1, 'S', 7, 9, 62, 8, S, '&Street:', 0], [120, 'E', 72, 7, 170, 24, EM, '', 0],
            ...row(121, '&City:', 35), ...row(122, 'State/&Province:', 51), ...row(123, 'Postal &Code:', 67), ...row(124, 'C&ountry/Region:', 83),
            [-1, 'B', 7, 102, 238, 4, 0x50000010, '', 0],
            ...row(125, '&Phone:', 112), ...row(126, '&Fax:', 128), ...row(127, '&Mobile:', 144),
            ...row(128, '&Website:', 160, 72, 140), [129, 'B', 216, 159, 26, 14, B, '&Go', 0]
        ] };
        T['contacts:work'] = { t: 'Work', w: 252, h: 218, f, c: [
            ...row(130, 'C&ompany:', 7), ...row(131, '&Job Title:', 23), ...row(132, '&Department:', 39), ...row(133, 'O&ffice:', 55),
            [-1, 'S', 7, 73, 62, 8, S, '&Street:', 0], [134, 'E', 72, 71, 170, 12, E, '', 0],
            ...row(135, '&City:', 87, 72, 70), [-1, 'S', 148, 89, 30, 8, S, 'State:', 0], [136, 'E', 178, 87, 64, 12, E, '', 0],
            ...row(137, 'Postal &Code:', 103, 72, 70), [-1, 'S', 148, 105, 30, 8, S, 'Country:', 0], [138, 'E', 178, 103, 64, 12, E, '', 0],
            ...row(139, '&Phone:', 123), ...row(140, '&Fax:', 139), ...row(141, 'Pa&ger:', 155),
            ...row(142, '&Website:', 171, 72, 140), [143, 'B', 216, 170, 26, 14, B, '&Go', 0]
        ] };
        T['contacts:family'] = { t: 'Family', w: 252, h: 218, f, c: [
            [-1, 'S', 7, 9, 62, 8, S, '&Gender:', 0], [150, 'C', 72, 7, 90, 80, CB, '', 0],
            [-1, 'S', 7, 27, 62, 8, S, '&Birthday:', 0], [151, 'S', 72, 25, 90, 13, PIC, '', 0],
            [-1, 'S', 7, 45, 62, 8, S, '&Anniversary:', 0], [152, 'S', 72, 43, 90, 13, PIC, '', 0],
            ...row(153, '&Spouse/Partner:', 63),
            [-1, 'S', 7, 83, 62, 8, S, '&Children:', 0], [154, 'E', 72, 81, 116, 12, E, '', 0], [155, 'B', 192, 80, 50, 14, B, 'A&dd', 0],
            [156, 'S', 72, 98, 116, 70, PIC, '', 0], [157, 'B', 192, 98, 50, 14, B, '&Remove', 0]
        ] };
        T['contacts:notes'] = { t: 'Notes', w: 252, h: 218, f, c: [[-1, 'S', 7, 7, 238, 8, S, '&Notes:', 0], [160, 'E', 7, 18, 238, 192, EM, '', 0]] };
        T['contacts:ids'] = { t: 'IDs', w: 252, h: 218, f, c: [
            [-1, 'S', 7, 7, 238, 16, S, 'Digital IDs let others send you encrypted e-mail and check that a message is from you.', 0],
            [170, 'S', 7, 28, 238, 150, PIC, '', 0], [-1, 'S', 7, 184, 238, 24, S, 'Melaton keeps no digital IDs for contacts yet; a vCard\'s KEY is left as it was.', 0]
        ] };
        T['contacts:group'] = { t: 'Contact Group', w: 252, h: 218, f, c: [
            [-1, 'S', 7, 9, 60, 8, S, '&Group Name:', 0], [180, 'E', 70, 7, 175, 12, E, '', 0],
            [181, 'S', 7, 26, 238, 120, PIC, '', 0],
            [182, 'B', 7, 150, 100, 14, B, '&Add to Contact Group', 0], [183, 'B', 111, 150, 100, 14, B, '&Remove Selected Contacts', 0],
            [-1, 'B', 7, 168, 238, 44, G, 'Create a contact for this group only', 0],
            [-1, 'S', 14, 182, 30, 8, S, '&Name:', 0], [184, 'E', 46, 180, 80, 12, E, '', 0],
            [-1, 'S', 130, 182, 30, 8, S, '&E-mail:', 0], [185, 'E', 160, 180, 80, 12, E, '', 0], [186, 'B', 186, 195, 54, 14, B, '&Create', 0]
        ] };
        T['contacts:groupdetails'] = { t: 'Contact Group Details', w: 252, h: 218, f, c: [
            [-1, 'S', 7, 9, 62, 8, S, '&Street:', 0], [190, 'E', 72, 7, 170, 24, EM, '', 0],
            ...row(191, '&City:', 35), ...row(192, 'State/&Province:', 51), ...row(193, 'Postal &Code:', 67), ...row(194, 'C&ountry/Region:', 83),
            ...row(195, '&Phone:', 103), ...row(196, '&Fax:', 119), ...row(197, '&Website:', 135),
            [-1, 'S', 7, 155, 62, 8, S, '&Notes:', 0], [198, 'E', 72, 153, 170, 56, EM, '', 0]
        ] };
    }

    // ---- the app -----------------------------------------------------------------------------

    class Contacts {
        constructor(app) {
            this.app = app;
            this.items = []; // { c, fileId, fileName }
            this.sel = new Set();
            this.viewMode = reg('View', 'details');
            this.sort = { key: 'name', dir: 1 };
            this.search = '';
            this.build();
            void this.load();
        }

        folder() { return `${workspaceRoot()}/Contacts`; }

        async load() {
            const V = vfs();
            let files = [];
            let has = false;
            try {
                const top = await V.listDirectory(workspaceRoot(), { offset: 0, limit: 500 });
                has = ((top && top.items) || []).some((i) => i.name === 'Contacts' && (i.kind === 'folder' || i.targetKind === 'vfs-folder'));
            } catch (_) { has = false; }
            if (!has) {
                try { await V.createFolder(workspaceRoot(), 'Contacts'); } catch (_) { /* not allowed here */ }
            } else {
                try { const res = await V.listDirectory(this.folder(), { offset: 0, limit: 1000 }); files = ((res && res.items) || []).filter((i) => /\.vcf$/i.test(i.name || '')); } catch (_) { files = []; }
            }
            for (const f of files) {
                try {
                    const r = await V.downloadFile(f.id);
                    const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).text();
                    const cards = parseVcf(text);
                    cards.forEach((c, i) => this.items.push({ c, fileId: i ? null : f.id, fileName: i ? null : f.name }));
                } catch (err) {
                    console.warn('Contacts: could not read', f.name, err);
                }
            }
            // Vista's Contacts folder starts with the person's own contact
            if (!this.items.length && !has) {
                const me = blank();
                const name = account();
                if (name) {
                    const bits = name.split(/\s+/);
                    me.first = bits[0] || '';
                    me.last = bits.length > 1 ? bits[bits.length - 1] : '';
                    me.fn = name;
                    const it = { c: me, fileId: null, fileName: null };
                    this.items.push(it);
                    await this.save(it);
                }
            }
            this.render();
        }

        fileNameOf(c) {
            return `${displayName(c).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Contact'}.vcf`;
        }

        async save(it) {
            const V = vfs();
            const data = await textB64(toVcf(it.c));
            try {
                if (it.fileId) await V.replaceFile(it.fileId, data, 'text/vcard');
                else {
                    let name = this.fileNameOf(it.c);
                    let n = 2;
                    const used = new Set(this.items.filter((x) => x !== it).map((x) => (x.fileName || '').toLowerCase()));
                    while (used.has(name.toLowerCase())) name = this.fileNameOf(it.c).replace(/\.vcf$/, ` (${n++}).vcf`);
                    const res = await V.uploadFile(this.folder(), data, name, 'text/vcard');
                    const f = res && (res.file || res.entry || res);
                    it.fileId = (f && (f.id || f.fileId)) || null;
                    it.fileName = name;
                }
            } catch (err) {
                this.status(`${displayName(it.c)} could not be saved: ${(err && err.message) || err}`);
            }
        }

        async trash(it) {
            if (!it.fileId && !it.fileName) return;
            const V = vfs();
            try {
                const res = await V.listDirectory(this.folder(), { offset: 0, limit: 1000 });
                const f = ((res && res.items) || []).find((i) => i.id === it.fileId || i.targetId === it.fileId || i.name === it.fileName);
                if (f) await V.moveToTrash([{ id: f.id, name: f.name, kind: f.kind, targetKind: f.targetKind, targetId: f.targetId, workspaceId: f.workspaceId }], this.folder());
            } catch (err) {
                this.status(`${displayName(it.c)} could not be moved to the Recycle Bin: ${(err && err.message) || err}`);
            }
        }

        // ---- the window ------------------------------------------------------------------

        build() {
            const W = Math.min(root.innerWidth - 40, 860);
            const H = Math.min(root.innerHeight - 80, 600);
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window wcon-window';
            m.dataset.windowIdentifier = 'melatonWindowsContacts';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = ICON24;
            m.dataset.windowDefaultWidth = String(W);
            m.dataset.windowDefaultHeight = String(H);
            m.dataset.windowMinWidth = '520';
            m.dataset.windowMinHeight = '360';
            m.style.width = `${W}px`;
            m.style.height = `${H}px`;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'Contacts');
            const btn = (a, label, img) => `<button type="button" class="wcon-cmd" data-a="${a}">${img ? `<img src="${CMD}/${img}.png" alt="">` : ''}<span>${label}</span></button>`;
            const who = account() || 'Contacts';
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span>Contacts</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small wcon-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 wcon-client">
                    <div class="wcon-nav">
                        <span class="wcon-travel"><span class="wcon-back" title="Back"></span><span class="wcon-fwd" title="Forward"></span></span>
                        <div class="wcon-address"><img src="${ICON16}" alt=""><span class="wcon-crumb">${esc(who)}</span><span class="wcon-crumb-sep"></span><span class="wcon-crumb">Contacts</span></div>
                        <label class="wcon-search"><input type="search" placeholder="Search" aria-label="Search"></label>
                    </div>
                    <div class="wcon-cmdbar" role="toolbar">
                        <button type="button" class="wcon-cmd wcon-organize"><img src="/static_images/vista-explorer/organize.png" alt=""><span>Organize</span><span class="wcon-arrow"></span></button>
                        <button type="button" class="wcon-cmd wcon-views"><img src="${CMD}/display.png" alt=""><span>Views</span><span class="wcon-arrow"></span></button>
                        ${btn('new', 'New Contact', 'contacts')}
                        ${btn('new-group', 'New Contact Group', 'add')}
                        ${btn('import', 'Import', 'download')}
                        ${btn('export', 'Export', 'upload')}
                        ${btn('print', 'Print', 'document')}
                        ${btn('email', 'E-mail', 'mail')}
                    </div>
                    <div class="wcon-body">
                        <div class="wcon-links">
                            <div class="wcon-links-head">Favorite Links</div>
                            <div class="wcon-link is-on"><img src="${CMD}/contacts.png" alt="">Contacts</div>
                        </div>
                        <div class="wcon-list" tabindex="0"></div>
                    </div>
                    <div class="wcon-details"></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.el = (s) => m.querySelector(s);
            this.wire();
            // before openModal: an id-less window restores the shared 'unknown' geometry
            m.id = 'melatonWindowsContactsModal';
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed) return;
                placed = true;
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: 'Windows Contacts', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'contacts' }) });
            }
            this.render();
        }

        wire() {
            const m = this.modal;
            m.querySelector('.wcon-close').addEventListener('click', () => this.app.exit());
            m.querySelectorAll('.wcon-cmd[data-a]').forEach((b) => b.addEventListener('click', () => void this.action(b.dataset.a)));
            root.contextMenu.attachClickMenuToElement(m.querySelector('.wcon-organize'), {
                onAction: (a) => void this.action(a),
                sections: [{ type: 'list', initfn: (s) => { s.items = this.organizeItems(); } }]
            });
            root.contextMenu.attachClickMenuToElement(m.querySelector('.wcon-views'), {
                onAction: (a) => void this.action(a),
                sections: [{ type: 'list', initfn: (s) => { s.items = [['tiles', 'Tiles'], ['details', 'Details'], ['icons', 'Medium Icons']].map(([v, t]) => ({ text: t, action: `view-${v}`, showIndicator: true, checked: this.viewMode === v })); } }]
            });
            const search = m.querySelector('.wcon-search input');
            search.addEventListener('input', () => { this.search = search.value.trim().toLowerCase(); this.render(); });
            const list = m.querySelector('.wcon-list');
            list.addEventListener('click', (ev) => {
                const h = ev.target.closest('[data-sort]');
                if (h) { const k = h.dataset.sort; this.sort = { key: k, dir: this.sort.key === k ? -this.sort.dir : 1 }; this.render(); return; }
                const row = ev.target.closest('[data-uid]');
                if (!row) { this.sel.clear(); this.render(); return; }
                const uid = row.dataset.uid;
                if (ev.ctrlKey || ev.metaKey) { if (this.sel.has(uid)) this.sel.delete(uid); else this.sel.add(uid); } else if (ev.shiftKey && this.anchor) {
                    const ids = this.visible().map((x) => x.c.uid);
                    const a = ids.indexOf(this.anchor);
                    const b = ids.indexOf(uid);
                    this.sel = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
                } else this.sel = new Set([uid]);
                this.anchor = uid;
                this.render();
            });
            list.addEventListener('dblclick', (ev) => {
                const row = ev.target.closest('[data-uid]');
                if (row) this.properties(this.items.find((x) => x.c.uid === row.dataset.uid));
            });
            list.addEventListener('contextmenu', (ev) => {
                const row = ev.target.closest('[data-uid]');
                if (row && !this.sel.has(row.dataset.uid)) { this.sel = new Set([row.dataset.uid]); this.render(); }
            });
            if (root.contextMenu.attachToElement) {
                root.contextMenu.attachToElement(list, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.sel.size ? [{ text: 'Open', action: 'open' }, { text: 'Send E-mail', action: 'email' }, { separator: true }, { text: 'Export', action: 'export' }, { text: 'Print...', action: 'print' }, { separator: true }, { text: 'Delete', action: 'delete' }, { text: 'Rename', action: 'rename', disabled: this.sel.size !== 1 }, { separator: true }, { text: 'Properties', action: 'open' }] : [{ text: 'View', hasSubmenu: true, submenu: [['tiles', 'Tiles'], ['details', 'Details'], ['icons', 'Medium Icons']].map(([v, t]) => ({ text: t, action: `view-${v}`, showIndicator: true, checked: this.viewMode === v })) }, { text: 'Sort By', hasSubmenu: true, submenu: this.sortItems() }, { separator: true }, { text: 'New Contact', action: 'new' }, { text: 'New Contact Group', action: 'new-group' }, { separator: true }, { text: 'Import', action: 'import' }]; } }]
                });
            }
            m.addEventListener('keydown', (ev) => {
                if (ev.target.closest('input, textarea, select')) return;
                if (ev.key === 'Delete') { ev.preventDefault(); void this.action('delete'); } else if (ev.key === 'Enter') { ev.preventDefault(); void this.action('open'); } else if (ev.key === 'F2') { ev.preventDefault(); void this.action('rename'); } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') { ev.preventDefault(); this.sel = new Set(this.visible().map((x) => x.c.uid)); this.render(); }
            });
        }

        sortItems() {
            return [['name', 'Name'], ['email', 'E-mail Address'], ['work', 'Business Phone'], ['home', 'Home Phone']].map(([k, t]) => ({ text: t, action: `sort-${k}`, showIndicator: true, checked: this.sort.key === k }));
        }

        organizeItems() {
            const one = this.sel.size === 1;
            return [
                { text: 'Cut', action: 'none', disabled: true }, { text: 'Copy', action: 'none', disabled: true },
                { separator: true },
                { text: 'Select All', subtext: 'Ctrl+A', action: 'select-all' },
                { separator: true },
                { text: 'Delete', action: 'delete', disabled: !this.sel.size },
                { text: 'Rename', action: 'rename', disabled: !one },
                { separator: true },
                { text: 'Properties', action: 'open', disabled: !one },
                { separator: true },
                { text: 'Close', action: 'close' }
            ];
        }

        selected() { return this.items.filter((x) => this.sel.has(x.c.uid)); }

        async action(a) {
            if (a.startsWith('view-')) { this.viewMode = a.slice(5); setReg({ View: this.viewMode }); this.render(); return; }
            if (a.startsWith('sort-')) { const k = a.slice(5); this.sort = { key: k, dir: this.sort.key === k ? -this.sort.dir : 1 }; this.render(); return; }
            switch (a) {
                case 'new': this.properties(null, false); return;
                case 'new-group': this.properties(null, true); return;
                case 'open': { const s = this.selected(); if (s.length) this.properties(s[0]); return; }
                case 'delete': await this.deleteSelected(); return;
                case 'rename': { const s = this.selected(); if (s.length === 1) this.properties(s[0]); return; }
                case 'select-all': this.sel = new Set(this.visible().map((x) => x.c.uid)); this.render(); return;
                case 'import': this.importDialog(); return;
                case 'export': this.exportDialog(); return;
                case 'print': this.printDialog(); return;
                case 'email': this.email(); return;
                case 'close': this.app.exit(); return;
                default:
            }
        }

        status(text) { const d = this.el('.wcon-details'); if (d && text) d.dataset.status = text; this.renderDetails(text); }

        // ---- the list ----------------------------------------------------------------------

        visible() {
            const q = this.search;
            const key = (c) => {
                if (this.sort.key === 'email') return (c.emails[c.prefEmail] || c.emails[0] || '').toLowerCase();
                if (this.sort.key === 'work') return c.work.phone;
                if (this.sort.key === 'home') return c.home.phone;
                return displayName(c).toLowerCase();
            };
            return this.items.filter((x) => !q || JSON.stringify([displayName(x.c), x.c.emails, x.c.home, x.c.work, x.c.notes]).toLowerCase().includes(q))
                .sort((a, b) => (key(a.c) < key(b.c) ? -1 : key(a.c) > key(b.c) ? 1 : 0) * this.sort.dir);
        }

        picture(c) {
            if (c.photo) return c.photo;
            return this.app.url(c.group ? 'assets/contact-group.png' : 'assets/contact.png');
        }

        render() {
            const list = this.el('.wcon-list');
            if (!list) return;
            const items = this.visible();
            list.className = `wcon-list is-${this.viewMode}`;
            if (this.viewMode === 'details') {
                const head = [['name', 'Name'], ['email', 'E-mail Address'], ['work', 'Business Phone'], ['home', 'Home Phone']];
                list.innerHTML = `<div class="wcon-head">${head.map(([k, t]) => `<button type="button" class="wcon-col${this.sort.key === k ? (this.sort.dir > 0 ? ' is-up' : ' is-down') : ''}" data-sort="${k}">${t}</button>`).join('')}</div>`
                    + items.map(({ c }) => `<div class="wcon-row${this.sel.has(c.uid) ? ' is-sel' : ''}" data-uid="${esc(c.uid)}"><span class="wcon-name"><img src="${esc(this.picture(c))}" alt="">${esc(displayName(c))}</span><span>${esc(c.group ? '' : (c.emails[c.prefEmail] || c.emails[0] || ''))}</span><span>${esc(c.work.phone)}</span><span>${esc(c.home.phone)}</span></div>`).join('');
            } else {
                list.innerHTML = items.map(({ c }) => `<div class="wcon-tile${this.sel.has(c.uid) ? ' is-sel' : ''}" data-uid="${esc(c.uid)}"><img src="${esc(this.picture(c))}" alt=""><span class="wcon-tile-text"><span class="wcon-tile-name">${esc(displayName(c))}</span>${this.viewMode === 'tiles' ? `<span class="wcon-tile-sub">${esc(c.group ? `${c.members.length} member${c.members.length === 1 ? '' : 's'}` : (c.emails[c.prefEmail] || c.emails[0] || c.work.company || ''))}</span><span class="wcon-tile-sub">${esc(c.group ? 'Contact Group' : (c.home.phone || c.work.phone || ''))}</span>` : ''}</span></div>`).join('');
            }
            this.renderDetails();
        }

        /** The Details pane: the one contact (its picture and main fields), or how many are chosen. */
        renderDetails(note) {
            const d = this.el('.wcon-details');
            if (!d) return;
            const s = this.selected();
            if (s.length === 1) {
                const c = s[0].c;
                const fields = c.group ? [['Members', String(c.members.length)]] : [['E-mail', c.emails[c.prefEmail] || c.emails[0] || ''], ['Business Phone', c.work.phone], ['Home Phone', c.home.phone], ['Mobile Phone', c.home.mobile], ['Company', c.work.company], ['Job Title', c.work.title]].filter((x) => x[1]);
                d.innerHTML = `<img class="wcon-details-pic" src="${esc(this.picture(c))}" alt=""><div class="wcon-details-main"><div class="wcon-details-name">${esc(displayName(c))}</div><div class="wcon-details-kind">${c.group ? 'Contact Group' : 'Contact'}</div></div><div class="wcon-details-grid">${fields.map(([k, v]) => `<div class="wcon-details-pair"><span>${esc(k)}:</span><span>${esc(v)}</span></div>`).join('')}</div>`;
            } else {
                d.innerHTML = `<img class="wcon-details-pic" src="${esc(this.app.url('assets/contacts.png'))}" alt=""><div class="wcon-details-main"><div class="wcon-details-name">${s.length ? `${s.length} items selected` : `${this.items.length} item${this.items.length === 1 ? '' : 's'}`}</div>${note ? `<div class="wcon-details-kind">${esc(note)}</div>` : ''}</div>`;
            }
        }

        // ---- Properties --------------------------------------------------------------------

        /** A contact's (or a group's) Properties; a new one is added when OK is pressed. */
        properties(it, asGroup) {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            registerPages();
            const isNew = !it;
            const c = isNew ? Object.assign(blank(), { group: !!asGroup }) : JSON.parse(JSON.stringify(it.c));
            const title = `${isNew ? (c.group ? 'New Contact Group' : 'New Contact') : displayName(c)} Properties`;
            const pic = (src, w, h) => `<img class="wcon-sheet-pic" src="${esc(src)}" alt="" style="width:${w}px;height:${h}px">`;
            const pages = c.group
                ? [{ key: 'contacts:group' }, { key: 'contacts:groupdetails' }]
                : ['summary', 'name', 'home', 'work', 'family', 'notes', 'ids'].map((k) => ({ key: `contacts:${k}` }));
            const set = (ctx, id, v, page) => { const e = ctx.el(id, page); if (e) e.value = v || ''; };
            const get = (ctx, id, page) => { const e = ctx.el(id, page); return e ? String(e.value || '').trim() : ''; };
            const listBox = (ctx, id, page, items, selIdx, pref) => {
                const host = ctx.el(id, page);
                if (!host) return;
                host.classList.add('wcon-sheet-list');
                host.innerHTML = items.map((t, i) => `<div class="wcon-sheet-item${i === selIdx ? ' is-sel' : ''}" data-i="${i}">${esc(t)}${pref === i ? ' <i>(Preferred e-mail)</i>' : ''}</div>`).join('');
            };
            const self = this;
            const ctx0 = V.openSheet({
                id: `wconProps_${c.uid.replace(/[^a-z0-9]/gi, '')}`,
                title,
                icon: ICON16,
                owner: this.modal,
                pages,
                start: c.group ? 'contacts:group' : (isNew ? 'contacts:name' : 'contacts:summary'),
                init(ctx) {
                    if (c.group) {
                        set(ctx, 180, c.fn || '', 'contacts:group');
                        let pickM = -1;
                        const drawMembers = () => {
                            const names = c.members.map((u) => { const m = self.items.find((x) => x.c.uid === u); return m ? `${displayName(m.c)}${m.c.emails[0] ? `   <${m.c.emails[m.c.prefEmail] || m.c.emails[0]}>` : ''}` : '(not in Contacts)'; });
                            listBox(ctx, 181, 'contacts:group', names, pickM);
                        };
                        drawMembers();
                        const host = ctx.el(181, 'contacts:group');
                        if (host) host.addEventListener('click', (ev) => { const r = ev.target.closest('[data-i]'); if (r) { pickM = Number(r.dataset.i); drawMembers(); } });
                        ctx.on(182, 'click', () => self.pickContacts(ctx.modal, c.members, (uids) => { uids.forEach((u) => { if (!c.members.includes(u)) c.members.push(u); }); drawMembers(); ctx.dirty(); }));
                        ctx.on(183, 'click', () => { if (pickM >= 0) { c.members.splice(pickM, 1); pickM = -1; drawMembers(); ctx.dirty(); } });
                        ctx.on(186, 'click', async () => {
                            const n = get(ctx, 184, 'contacts:group');
                            const e = get(ctx, 185, 'contacts:group');
                            if (!n && !e) return;
                            const nc = blank();
                            nc.fn = n || e;
                            if (e) nc.emails.push(e);
                            const nit = { c: nc, fileId: null, fileName: null };
                            self.items.push(nit);
                            await self.save(nit);
                            c.members.push(nc.uid);
                            set(ctx, 184, '', 'contacts:group');
                            set(ctx, 185, '', 'contacts:group');
                            drawMembers();
                            ctx.dirty();
                            self.render();
                        });
                        const h = c.home;
                        [[190, h.street], [191, h.city], [192, h.region], [193, h.postal], [194, h.country], [195, h.phone], [196, h.fax], [197, h.url], [198, c.notes]].forEach(([id, v]) => set(ctx, id, v, 'contacts:groupdetails'));
                        return;
                    }
                    // Summary
                    const sum = () => {
                        const p = ctx.el(101, 'contacts:summary');
                        if (p) p.innerHTML = pic(c.photo || self.app.url('assets/contact.png'), 88, 88);
                        const t = ctx.el(102, 'contacts:summary');
                        if (!t) return;
                        const rows = [['Name', displayName(c)], ['E-mail', c.emails.join(', ')], ['Home phone', c.home.phone], ['Mobile phone', c.home.mobile], ['Home address', [c.home.street, c.home.city, c.home.region, c.home.postal, c.home.country].filter(Boolean).join(', ')],
                            ['Company', c.work.company], ['Job title', c.work.title], ['Work phone', c.work.phone], ['Work address', [c.work.street, c.work.city, c.work.region, c.work.postal, c.work.country].filter(Boolean).join(', ')],
                            ['Birthday', c.birthday], ['Website', c.home.url || c.work.url]].filter((r) => r[1]);
                        t.classList.add('wcon-summary');
                        t.innerHTML = rows.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('') || '<div>No information yet.</div>';
                    };
                    sum();
                    // Name and E-mail
                    [[103, c.first], [104, c.middle], [105, c.last], [106, c.prefix], [107, c.nickname], [108, c.fn]].forEach(([id, v]) => set(ctx, id, v, 'contacts:name'));
                    const drawPic = () => { const p = ctx.el(109, 'contacts:name'); if (p) p.innerHTML = pic(c.photo || self.app.url('assets/contact.png'), 92, 92); };
                    drawPic();
                    let pickE = -1;
                    const drawEmails = () => listBox(ctx, 113, 'contacts:name', c.emails, pickE, c.emails.length > 1 ? c.prefEmail : -1);
                    drawEmails();
                    const elist = ctx.el(113, 'contacts:name');
                    if (elist) elist.addEventListener('click', (ev) => { const r = ev.target.closest('[data-i]'); if (r) { pickE = Number(r.dataset.i); set(ctx, 111, c.emails[pickE], 'contacts:name'); drawEmails(); } });
                    ctx.on(112, 'click', () => { const v = get(ctx, 111, 'contacts:name'); if (v) { c.emails.push(v); set(ctx, 111, '', 'contacts:name'); pickE = -1; drawEmails(); ctx.dirty(); } });
                    ctx.on(114, 'click', () => { const v = get(ctx, 111, 'contacts:name'); if (v && pickE >= 0) { c.emails[pickE] = v; drawEmails(); ctx.dirty(); } });
                    ctx.on(115, 'click', () => { if (pickE >= 0) { c.prefEmail = pickE; drawEmails(); ctx.dirty(); } });
                    ctx.on(116, 'click', () => { if (pickE >= 0) { c.emails.splice(pickE, 1); if (c.prefEmail >= c.emails.length) c.prefEmail = 0; pickE = -1; set(ctx, 111, '', 'contacts:name'); drawEmails(); ctx.dirty(); } });
                    ctx.on(110, 'click', () => self.choosePicture(ctx.modal, (data) => { c.photo = data; drawPic(); sum(); ctx.dirty(); }));
                    // the name parts make the full name until it is typed over (Vista)
                    const autoFull = () => { const f = ctx.el(108, 'contacts:name'); if (f && !f.dataset.typed) f.value = [get(ctx, 103, 'contacts:name'), get(ctx, 104, 'contacts:name'), get(ctx, 105, 'contacts:name')].filter(Boolean).join(' '); };
                    [103, 104, 105].forEach((id) => ctx.on(id, 'input', autoFull));
                    ctx.on(108, 'input', () => { const f = ctx.el(108, 'contacts:name'); if (f) f.dataset.typed = '1'; });
                    if (!c.fn) autoFull();
                    // Home, Work
                    const h = c.home;
                    [[120, h.street], [121, h.city], [122, h.region], [123, h.postal], [124, h.country], [125, h.phone], [126, h.fax], [127, h.mobile], [128, h.url]].forEach(([id, v]) => set(ctx, id, v, 'contacts:home'));
                    const w = c.work;
                    [[130, w.company], [131, w.title], [132, w.department], [133, w.office], [134, w.street], [135, w.city], [136, w.region], [137, w.postal], [138, w.country], [139, w.phone], [140, w.fax], [141, w.pager], [142, w.url]].forEach(([id, v]) => set(ctx, id, v, 'contacts:work'));
                    const go = (id, page) => () => { const u = get(ctx, id, page); if (u) root.open(/^https?:/i.test(u) ? u : `https://${u}`, '_blank', 'noopener'); };
                    ctx.on(129, 'click', go(128, 'contacts:home'));
                    ctx.on(143, 'click', go(142, 'contacts:work'));
                    // Family
                    const g = ctx.el(150, 'contacts:family');
                    if (g) { g.innerHTML = ['Unspecified', 'Female', 'Male'].map((x) => `<option${(c.gender || 'Unspecified') === x ? ' selected' : ''}>${x}</option>`).join(''); }
                    const dateBox = (id, v) => { const host = ctx.el(id, 'contacts:family'); if (host) { host.innerHTML = `<input type="date" class="tbp-edit wcon-date" value="${esc(v)}">`; host.querySelector('input').addEventListener('change', () => ctx.dirty()); } };
                    dateBox(151, c.birthday);
                    dateBox(152, c.anniversary);
                    set(ctx, 153, c.spouse, 'contacts:family');
                    let pickK = -1;
                    const drawKids = () => listBox(ctx, 156, 'contacts:family', c.children, pickK);
                    drawKids();
                    const klist = ctx.el(156, 'contacts:family');
                    if (klist) klist.addEventListener('click', (ev) => { const r = ev.target.closest('[data-i]'); if (r) { pickK = Number(r.dataset.i); drawKids(); } });
                    ctx.on(155, 'click', () => { const v = get(ctx, 154, 'contacts:family'); if (v) { c.children.push(v); set(ctx, 154, '', 'contacts:family'); drawKids(); ctx.dirty(); } });
                    ctx.on(157, 'click', () => { if (pickK >= 0) { c.children.splice(pickK, 1); pickK = -1; drawKids(); ctx.dirty(); } });
                    set(ctx, 160, c.notes, 'contacts:notes');
                    const ids = ctx.el(170, 'contacts:ids');
                    if (ids) { ids.classList.add('wcon-sheet-list'); ids.innerHTML = '<div class="wcon-sheet-item is-empty">(none)</div>'; }
                },
                async apply(ctx) {
                    if (c.group) {
                        c.fn = get(ctx, 180, 'contacts:group') || 'New Contact Group';
                        const h = c.home;
                        [h.street, h.city, h.region, h.postal, h.country, h.phone, h.fax, h.url] = [190, 191, 192, 193, 194, 195, 196, 197].map((id) => get(ctx, id, 'contacts:groupdetails'));
                        c.notes = get(ctx, 198, 'contacts:groupdetails');
                    } else {
                        [c.first, c.middle, c.last, c.prefix, c.nickname, c.fn] = [103, 104, 105, 106, 107, 108].map((id) => get(ctx, id, 'contacts:name'));
                        const pending = get(ctx, 111, 'contacts:name');
                        if (pending && !c.emails.includes(pending)) c.emails.push(pending);
                        const h = c.home;
                        [h.street, h.city, h.region, h.postal, h.country, h.phone, h.fax, h.mobile, h.url] = [120, 121, 122, 123, 124, 125, 126, 127, 128].map((id) => get(ctx, id, 'contacts:home'));
                        const w = c.work;
                        [w.company, w.title, w.department, w.office, w.street, w.city, w.region, w.postal, w.country, w.phone, w.fax, w.pager, w.url] = [130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142].map((id) => get(ctx, id, 'contacts:work'));
                        const g = ctx.el(150, 'contacts:family');
                        c.gender = g && g.value !== 'Unspecified' ? g.value : '';
                        const bd = ctx.el(151, 'contacts:family');
                        const an = ctx.el(152, 'contacts:family');
                        c.birthday = bd && bd.querySelector('input') ? bd.querySelector('input').value : c.birthday;
                        c.anniversary = an && an.querySelector('input') ? an.querySelector('input').value : c.anniversary;
                        c.spouse = get(ctx, 153, 'contacts:family');
                        c.notes = (ctx.el(160, 'contacts:notes') || {}).value || '';
                    }
                    let target = it;
                    if (!target) {
                        target = { c, fileId: null, fileName: null };
                        self.items.push(target);
                        it = target;
                    } else target.c = c;
                    await self.save(target);
                    self.sel = new Set([c.uid]);
                    self.render();
                }
            });
            // a new contact's sheet opens with OK ready (Vista: Apply is not needed to add it)
            if (ctx0 && isNew) ctx0.dirty();
        }

        /** Contact Group > Add to Contact Group: Vista's contact picker. */
        pickContacts(owner, already, done) {
            const V = root.vistaDialogTemplate;
            const tpl = { t: 'Add Members to Contact Group', w: 230, h: 190, f: ['MS Shell Dlg', 8], c: [
                [-1, 'S', 7, 7, 216, 8, S, 'Choose the contacts to add:', 0], [101, 'S', 7, 18, 216, 146, PIC, '', 0],
                [1, 'B', 119, 170, 50, 14, 0x50010001, 'Add', 0], [2, 'B', 173, 170, 50, 14, B, 'Cancel', 0]
            ] };
            const picked = new Set();
            V.openDialog({
                id: 'wconPick', tpl, owner,
                init: (ctx) => {
                    const host = ctx.el(101);
                    if (!host) return;
                    host.classList.add('wcon-sheet-list');
                    const people = this.items.filter((x) => !x.c.group && !already.includes(x.c.uid));
                    host.innerHTML = people.map((x) => `<label class="wcon-sheet-item"><input type="checkbox" data-u="${esc(x.c.uid)}"> ${esc(displayName(x.c))}</label>`).join('') || '<div class="wcon-sheet-item is-empty">No other contacts.</div>';
                    host.addEventListener('change', (ev) => { const u = ev.target.dataset.u; if (!u) return; if (ev.target.checked) picked.add(u); else picked.delete(u); });
                },
                ok: () => { done([...picked]); return true; }
            });
        }

        /** Change picture: a picture from Documents, made a 96 px square (Vista crops to the middle). */
        choosePicture(owner, done) {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            void root.studioOpenFolderDialog('open-vfs', {
                owner,
                startPath: workspaceRoot(),
                host: {
                    title: 'Select a Picture for This Contact',
                    rejectMessage: 'Choose a picture',
                    acceptItem: (item) => !!item && (item.targetKind === 'image' || (item.targetKind === 'user-file' && /^image\//.test(item.mimeType || ''))),
                    onOpen: async (item) => {
                        try {
                            let url;
                            if (item.targetKind === 'user-file') url = (await vfs().downloadFile(item.id)).downloadUrl;
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
                            this.status(`The picture could not be used: ${(err && err.message) || err}`);
                        }
                    }
                }
            });
        }

        async deleteSelected() {
            const s = this.selected();
            if (!s.length) return;
            const v = await call('showConfirmationDialog', `<p>Are you sure you want to move ${s.length === 1 ? `"${esc(displayName(s[0].c))}"` : `these ${s.length} items`} to the Recycle Bin?</p>`, [
                { text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }
            ], null, { title: s.length === 1 ? 'Delete File' : 'Delete Multiple Items', width: 400 });
            if (!v) return;
            for (const it of s) {
                await this.trash(it);
                this.items = this.items.filter((x) => x !== it);
                // groups forget the contact
                for (const g of this.items.filter((x) => x.c.group && x.c.members.includes(it.c.uid))) { g.c.members = g.c.members.filter((u) => u !== it.c.uid); await this.save(g); }
            }
            this.sel.clear();
            this.render();
        }

        // ---- import / export / e-mail / print -------------------------------------------------

        importDialog() {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            void root.studioOpenFolderDialog('open-vfs', {
                owner: this.modal,
                startPath: workspaceRoot(),
                host: {
                    title: 'Import to Windows Contacts',
                    rejectMessage: 'Choose a vCard (.vcf) or CSV (.csv) file',
                    acceptItem: (item) => !!item && item.targetKind === 'user-file' && /\.(vcf|csv)$/i.test(item.name || ''),
                    onOpen: async (item) => {
                        try {
                            const r = await vfs().downloadFile(item.id);
                            const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).text();
                            const cards = /\.csv$/i.test(item.name) ? parseCsv(text) : parseVcf(text);
                            const have = new Set(this.items.map((x) => x.c.uid));
                            let n = 0;
                            for (const c of cards) {
                                if (have.has(c.uid)) continue;
                                const it = { c, fileId: null, fileName: null };
                                this.items.push(it);
                                await this.save(it);
                                n += 1;
                            }
                            this.render();
                            this.status(`${n} contact${n === 1 ? '' : 's'} imported from ${item.name}.`);
                        } catch (err) {
                            this.status(`The file could not be imported: ${(err && err.message) || err}`);
                        }
                    }
                }
            });
        }

        exportDialog() {
            const list = this.sel.size ? this.selected() : this.items;
            if (!list.length || typeof root.studioOpenFolderDialog !== 'function') return;
            const self = this;
            void root.studioOpenFolderDialog('save', {
                owner: this.modal,
                startPath: workspaceRoot(),
                host: {
                    title: 'Export Windows Contacts',
                    typeLabel: 'vCards (*.vcf); CSV (Comma Separated Values) (*.csv)',
                    acceptType: 'user-file',
                    suggestName: () => (list.length === 1 ? self.fileNameOf(list[0].c) : 'Contacts.vcf'),
                    async onSave(info) {
                        let name = String(info.name || '').trim();
                        if (!name) return false;
                        if (!/\.(vcf|csv)$/i.test(name)) name += '.vcf';
                        const csv = /\.csv$/i.test(name);
                        try {
                            const text = csv ? toCsv(list.map((x) => x.c)) : list.map((x) => toVcf(x.c)).join('');
                            await vfs().uploadFile(info.path || '/', await textB64(text, csv ? 'text/csv' : 'text/vcard'), name, csv ? 'text/csv' : 'text/vcard');
                            return true;
                        } catch (err) {
                            self.status(`The contacts could not be exported: ${(err && err.message) || err}`);
                            return false;
                        }
                    },
                    onCancel() {}
                }
            });
        }

        /** The addresses of the chosen contacts (a group gives its members'). */
        addresses(list) {
            const out = [];
            list.forEach(({ c }) => {
                if (c.group) c.members.forEach((u) => { const m = this.items.find((x) => x.c.uid === u); if (m && m.c.emails.length) out.push(m.c.emails[m.c.prefEmail] || m.c.emails[0]); });
                else if (c.emails.length) out.push(c.emails[c.prefEmail] || c.emails[0]);
            });
            return [...new Set(out)];
        }

        email() {
            const open = typeof doveOpenComposeWindow === 'function' ? doveOpenComposeWindow : root.doveOpenComposeWindow; // eslint-disable-line no-undef
            if (typeof open !== 'function') { this.status('Dovecote is not available to send e-mail.'); return; }
            const to = this.addresses(this.selected());
            if (!to.length && this.sel.size) { this.status('The chosen contacts have no e-mail address.'); return; }
            open({ mode: 'create', to, subject: '', body: '' });
        }

        /** Print: Vista's three styles, as a page of their own (the browser's print dialog). */
        printDialog() {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const tpl = { t: 'Print', w: 200, h: 98, f: ['MS Shell Dlg', 8], c: [
                [-1, 'B', 7, 4, 186, 34, G, 'Print range', 0], [101, 'B', 14, 16, 70, 10, 0x50030009, '&All contacts', 0], [102, 'B', 90, 16, 90, 10, 0x50010009, '&Selected contacts', 0],
                [-1, 'B', 7, 42, 186, 30, G, 'Print style', 0], [103, 'B', 14, 54, 40, 10, 0x50030009, '&Memo', 0], [104, 'B', 60, 54, 60, 10, 0x50010009, '&Business Card', 0], [105, 'B', 126, 54, 60, 10, 0x50010009, '&Phone List', 0],
                [1, 'B', 89, 78, 50, 14, 0x50010001, 'Print', 0], [2, 'B', 143, 78, 50, 14, B, 'Cancel', 0]
            ] };
            V.openDialog({
                id: 'wconPrint', tpl, owner: this.modal,
                init: (ctx) => { ctx.set(this.sel.size ? 102 : 101, true); ctx.set(103, true); if (!this.sel.size) { const e = ctx.el(102); if (e) e.disabled = true; } },
                ok: (ctx) => {
                    const list = (ctx.get(102) ? this.selected() : this.visible()).filter((x) => !x.c.group);
                    const style = ctx.get(104) ? 'card' : ctx.get(105) ? 'phone' : 'memo';
                    this.print(list, style);
                    return true;
                }
            });
        }

        print(list, style) {
            const line = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : '');
            const body = style === 'phone'
                ? `<table class="phones">${list.map(({ c }) => `<tr><td>${esc(displayName(c))}</td><td>${esc([c.home.phone && `Home: ${c.home.phone}`, c.work.phone && `Work: ${c.work.phone}`, c.home.mobile && `Mobile: ${c.home.mobile}`].filter(Boolean).join('   '))}</td></tr>`).join('')}</table>`
                : list.map(({ c }) => `<div class="${style}"><h2>${esc(displayName(c))}</h2><table>${line('E-mail', c.emails.join(', '))}${line('Home phone', c.home.phone)}${line('Mobile', c.home.mobile)}${line('Home', [c.home.street, c.home.city, c.home.region, c.home.postal, c.home.country].filter(Boolean).join(', '))}${line('Company', [c.work.company, c.work.department].filter(Boolean).join(', '))}${line('Job title', c.work.title)}${line('Work phone', c.work.phone)}${line('Work', [c.work.street, c.work.city, c.work.region, c.work.postal, c.work.country].filter(Boolean).join(', '))}${style === 'memo' ? line('Notes', c.notes) : ''}</table></div>`).join('');
            const f = doc.createElement('iframe');
            f.style.cssText = 'position:fixed;left:-10000px;width:900px;height:700px;border:0';
            doc.body.appendChild(f);
            const w = f.contentWindow;
            w.document.open();
            w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Contacts</title><style>body{font:12px "Segoe UI",Tahoma,sans-serif;margin:16px}h2{font-size:15px;margin:14px 0 4px;border-bottom:1px solid #999}th{text-align:left;padding-right:12px;color:#555;font-weight:normal;vertical-align:top}.card{display:inline-block;width:46%;margin:0 2% 12px 0;padding:8px;border:1px solid #999;vertical-align:top}.phones td{padding:3px 14px 3px 0;border-bottom:1px solid #ddd}</style></head><body>${body || '<p>No contacts.</p>'}</body></html>`);
            w.document.close();
            setTimeout(() => { try { w.focus(); w.print(); } catch (_) { /* no printing here */ } setTimeout(() => f.remove(), 2000); }, 300);
        }

        destroy() {
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 300);
        }
    }

    // ---- the package ---------------------------------------------------------------------------

    let running = null;

    async function start(app) {
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        if (root.featureLoader && !root.vistaDialogTemplate) { try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* no dialogs */ } }
        const c = new Contacts(app);
        running = c;
        app.onExit(() => { running = null; c.destroy(); });
    }

    root.melatonContacts = { start, parseVcf, toVcf, parseCsv, toCsv, displayName, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('contacts', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
