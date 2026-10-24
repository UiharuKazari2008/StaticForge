/**
 * vCard 3.0 and CSV for Melaton Contacts (Yozora #632): the Contacts folder in Explorer
 * (explorerContacts.js) and the contacts package (apps/contacts) both read and write the cards here.
 *
 *   melatonVCard.parseVcf(text) -> [card]      a file may hold several
 *   melatonVCard.toVcf(card) -> text           folded, CRLF
 *   melatonVCard.displayName(card)
 *   melatonVCard.parseCsv(text) / toCsv(list)  Outlook's columns (what Vista's CSV export writes)
 *   melatonVCard.blank()                       an empty card with a fresh UID
 *
 * A group is a card with X-ADDRESSBOOKSERVER-KIND:group and its members' UIDs.
 */
(function (root) {
    'use strict';

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

    /** The preferred e-mail address, or the first. */
    function email(c) {
        return (c && c.emails && (c.emails[c.prefEmail] || c.emails[0])) || '';
    }

    const api = { blank, parseVcf, toVcf, displayName, parseCsv, toCsv, email, CSV_COLS };
    root.melatonVCard = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
