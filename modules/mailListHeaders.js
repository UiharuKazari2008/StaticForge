/**
 * List-Unsubscribe / List-Unsubscribe-Post (RFC 2369, RFC 8058) from raw header text.
 * (mailparser files these under headers.get('list'), not 'list-unsubscribe', which is why the
 * mail copy had listUnsubscribe null on every newsletter.)
 */
'use strict';

function headerValues(text, names) {
    const out = {};
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    let cur = null;
    for (const line of lines) {
        if (/^[ \t]/.test(line) && cur) { out[cur] += ` ${line.trim()}`; continue; }
        const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
        cur = null;
        if (!m) continue;
        const k = m[1].toLowerCase();
        if (names.includes(k) && out[k] == null) { out[k] = m[2].trim(); cur = k; }
    }
    return out;
}

/** -> { url, mail, post, oneClick } (null when absent). url: the first http(s) link; mail: the mailto: target. */
function parseListHeaders(headerText) {
    const h = headerValues(headerText, ['list-unsubscribe', 'list-unsubscribe-post']);
    const out = { url: null, mail: null, post: null, oneClick: false };
    if (h['list-unsubscribe']) {
        const items = [];
        h['list-unsubscribe'].replace(/<([^<>]+)>/g, (_, v) => { items.push(v.trim()); return ''; });
        if (!items.length) items.push(...h['list-unsubscribe'].split(',').map((x) => x.trim()).filter(Boolean));
        out.url = items.find((x) => /^https?:\/\//i.test(x)) || null;
        const mail = items.find((x) => /^mailto:/i.test(x));
        out.mail = mail ? mail.replace(/^mailto:/i, '') : null;
    }
    if (h['list-unsubscribe-post']) {
        out.post = h['list-unsubscribe-post'].slice(0, 200);
        out.oneClick = /list-unsubscribe\s*=\s*one-click/i.test(out.post);
    }
    return out;
}

/** What the mail copy keeps in env: the old listUnsubscribe string plus the new fields. */
function envFields(headerText) {
    const p = parseListHeaders(headerText);
    return {
        listUnsubscribe: p.url || (p.mail ? `mailto:${p.mail}` : null),
        listUnsubscribeMail: p.mail,
        listUnsubscribePost: p.post,
        listUnsubscribeOneClick: p.oneClick,
        listHeadersChecked: true
    };
}

module.exports = { parseListHeaders, envFields, headerValues };
