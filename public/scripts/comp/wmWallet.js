/**
 * Melaton Mobile: Wallet (Yozora #874). Quick access to the phone's cards from Today; it never
 * goes round Samsung Wallet's fingerprint / PIN or any other check.
 *
 *   cards     favourite payment cards drawn as small cards (name, ••last 4, network). Pay Now opens
 *             Samsung Wallet's pay sheet already on that card: samsungpay://launch?action=
 *             pay_using_card&cardName=<the card's name in Wallet> (Wallet matches it among its Quick
 *             Access cards, "contains"); with no Wallet name, samsungpay://simplepay/sidekey (the
 *             default card). Wallet then asks for the fingerprint and the phone goes to the reader.
 *   barcodes  membership barcodes drawn here (bwip-js, loaded on first use) so the store scans the
 *             phone's screen, no Samsung Wallet; full screen at full brightness on a tap. Added by
 *             typing the number or with the camera (BarcodeDetector).
 *   IDs       the driver licence and other IDs stay in Samsung Wallet (it presents them); the page
 *             opens Wallet.
 *
 * Client-side only (Yukimi, Nov 16 2026): everything stays on the phone, in the Android app's
 * encrypted store under the namespace 'wallet' (window.AndroidSecureStore: AES-256-GCM under an
 * Android Keystore key, not backed up; DSApp SecureStore.kt, docs/ANDROID_BRIDGE.md). Nothing goes to
 * the server, localStorage or IndexedDB; the server keeps only Settings > Today's on / off for the
 * item. Without the app (a test tab) the list lives in this page's memory and is gone on reload.
 * A card's picture is a photo taken here with the camera (cropped to a card, kept in the store) or
 * drawn from its colour.
 *
 * Today: registerTodayItem 'cards' (label Wallet). 6.1: a block, the selected item as
 * [card picture] nickname / its name in Wallet ••last 4 (a tap pays), < > to page; a barcode drawn
 * big enough to scan under its name. 6.5: a Titanium panel, a page each (the card's picture,
 * nickname, name ••last 4), right soft key Pay Now / Show. Program: Wallet (Start > Programs) lists, adds, edits and orders
 * them. Styles: public/css/wm-wallet.css. Phones only.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'wallet';
    const TITLE = 'Wallet';
    const ICON = 'app-wallet'; // scripts/generate-wm-wallet-art.js
    const BWIP_URL = '/scripts/vendor/bwip-js.min.js';
    const SPAY = 'com.samsung.android.spay';
    const FORMATS = [
        ['code128', 'Code 128'], ['code39', 'Code 39'], ['ean13', 'EAN-13'], ['upca', 'UPC-A'],
        ['interleaved2of5', 'Interleaved 2 of 5'], ['qrcode', 'QR Code'], ['pdf417', 'PDF417'],
        ['azteccode', 'Aztec'], ['datamatrix', 'Data Matrix']
    ];
    const TWO_D = new Set(['qrcode', 'pdf417', 'azteccode', 'datamatrix']);
    // BarcodeDetector's names for the formats above
    const DETECTED = { code_128: 'code128', code_39: 'code39', ean_13: 'ean13', upc_a: 'upca', itf: 'interleaved2of5', qr_code: 'qrcode', pdf417: 'pdf417', aztec: 'azteccode', data_matrix: 'datamatrix' };
    const NETWORKS = [['visa', 'Visa'], ['mastercard', 'Mastercard'], ['amex', 'American Express'], ['discover', 'Discover'], ['other', 'Other']];
    const COLORS = [['#1c2a4a', 'Navy'], ['#2b2b2b', 'Black'], ['#8a8f98', 'Silver'], ['#b08a3e', 'Gold'], ['#1f6b3a', 'Green'], ['#7a1f2b', 'Red'], ['#4b2a7a', 'Purple'], ['#1e6fa8', 'Blue']];

    let sh = null;
    let page = null;
    let els = null;
    let data = { v: 1, items: [] };
    let loaded = false;
    let storeNote = ''; // why the store cannot be read now ('' when it can)
    let layers = []; // 'edit' | 'show' | 'scan'
    let form = null; // the item being edited (a copy) and whether it is new
    let showing = null; // the item shown full screen
    let todayAt = 0; // the selected item on Today (index)
    let scan = null; // { stream, timer }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const uid = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const label = (list, v) => (list.find((x) => x[0] === v) || list[list.length - 1])[1];

    // ---------------------------------------------------------------- store (on the phone only)

    const NS = 'wallet';
    function store() { return window.AndroidSecureStore || null; }

    function load() {
        loaded = true;
        const s = store();
        if (!s || typeof s.get !== 'function') { storeNote = 'memory'; return; }
        let text = '';
        try { text = String(s.get(NS) || ''); } catch (_) { text = '!error'; }
        if (text === '!locked') { storeNote = 'locked'; loaded = false; return; }
        if (text.startsWith('!error')) { storeNote = 'error'; return; }
        storeNote = '';
        if (!text) { data = { v: 1, items: [] }; return; }
        try {
            const d = JSON.parse(text);
            data = { v: 1, items: Array.isArray(d.items) ? d.items.filter((x) => x && x.id && x.kind) : [] };
        } catch (_) { storeNote = 'error'; }
    }

    function save() {
        const s = store();
        if (s && typeof s.put === 'function' && storeNote !== 'error') {
            let ok = false;
            try { ok = s.put(NS, JSON.stringify(data)) === true; } catch (_) { ok = false; }
            if (!ok && sh) sh.messageBox({ title: TITLE, icon: 'error', text: 'The wallet could not be saved on this phone. Unlock the phone, then try again.' });
        }
        cardArt.clear();
        if (sh && typeof sh.refreshToday === 'function') sh.refreshToday();
    }

    function items() { if (!loaded) load(); return data.items; }

    // ---------------------------------------------------------------- pictures

    let bwipLoad = null;
    function bwip() {
        if (window.bwipjs && window.bwipjs.toCanvas) return Promise.resolve(window.bwipjs);
        if (!bwipLoad) {
            bwipLoad = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = BWIP_URL;
                s.async = true;
                s.onload = () => (window.bwipjs ? resolve(window.bwipjs) : reject(new Error('bwip-js')));
                s.onerror = () => { bwipLoad = null; reject(new Error('bwip-js')); };
                document.head.appendChild(s);
            });
        }
        return bwipLoad;
    }

    // drawn barcodes by format + value + size (data URLs), so Today's repaint draws nothing twice
    const codeArt = new Map();
    function barcodeKey(it, big) { return `${it.format}|${it.value}|${big ? 1 : 0}`; }
    /** The barcode as a PNG data URL (null while bwip-js loads; Today repaints when it is ready). */
    function barcodeUrl(it, big) {
        const k = barcodeKey(it, big);
        if (codeArt.has(k)) return codeArt.get(k);
        codeArt.set(k, null);
        bwip().then((b) => {
            const c = document.createElement('canvas');
            const two = TWO_D.has(it.format);
            try {
                b.toCanvas(c, {
                    bcid: it.format,
                    text: String(it.value),
                    scale: big ? (two ? 8 : 4) : (two ? 4 : 3),
                    height: two ? undefined : (big ? 22 : 14),
                    includetext: !two,
                    textxalign: 'center',
                    textsize: big ? 11 : 9,
                    paddingwidth: two ? 4 : 10,
                    paddingheight: 4,
                    backgroundcolor: 'FFFFFF'
                });
                codeArt.set(k, c.toDataURL('image/png'));
            } catch (err) {
                codeArt.set(k, 'bad');
                console.warn('[wmWallet] barcode', it.format, err && err.message);
            }
            if (sh && typeof sh.refreshToday === 'function') sh.refreshToday();
            if (layers[layers.length - 1] === 'show' && showing === it) renderShow();
            if (!layers.length && page && page.isConnected) renderList();
        }).catch(() => { codeArt.delete(k); });
        return null;
    }

    // a card's picture for the 6.5 panel and the list (canvas: the panel takes an image)
    const cardArt = new Map();
    function cardUrl(it) {
        if (it.photo) return it.photo;
        const k = JSON.stringify([it.name, it.last4, it.network, it.color]);
        if (cardArt.has(k)) return cardArt.get(k);
        const c = document.createElement('canvas');
        c.width = 172; c.height = 108;
        const g = c.getContext('2d');
        const r = 10;
        g.beginPath();
        g.roundRect(1, 1, 170, 106, r);
        const grad = g.createLinearGradient(0, 0, 172, 108);
        grad.addColorStop(0, it.color || COLORS[0][0]);
        grad.addColorStop(1, '#000000');
        g.fillStyle = grad;
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,.35)';
        g.stroke();
        g.fillStyle = '#ffffff';
        g.font = 'bold 15px Tahoma, Segoe UI, sans-serif';
        g.fillText(String(it.name || 'Card').slice(0, 18), 12, 26);
        g.font = '15px Tahoma, Segoe UI, sans-serif';
        g.fillText(`\u2022\u2022\u2022\u2022 ${it.last4 || ''}`, 12, 92);
        g.font = 'bold italic 14px Tahoma, Segoe UI, sans-serif';
        g.textAlign = 'right';
        g.fillText(it.network && it.network !== 'other' ? label(NETWORKS, it.network).toUpperCase().replace('AMERICAN EXPRESS', 'AMEX') : '', 160, 92);
        const url = c.toDataURL('image/png');
        cardArt.set(k, url);
        return url;
    }

    // ---------------------------------------------------------------- actions

    function openWallet(url) {
        const l = window.AndroidLinks;
        let ok = false;
        try { ok = !!(l && typeof l.openNative === 'function' && l.openNative(url, SPAY)); } catch (_) { ok = false; }
        if (!ok && sh) sh.messageBox({ title: TITLE, icon: 'info', text: 'Samsung Wallet could not be opened. It needs the Melaton app on a phone with Samsung Wallet.' });
        return ok;
    }

    /** Samsung Wallet's pay sheet on the card (its Wallet name), else on the default card. */
    function pay(it) {
        const name = it && String(it.walletName || '').trim();
        return openWallet(name ? `samsungpay://launch?action=pay_using_card&cardName=${encodeURIComponent(name)}` : 'samsungpay://simplepay/sidekey');
    }

    function activate(it) {
        if (!it) return;
        if (it.kind === 'card') pay(it);
        else if (it.kind === 'barcode') show(it);
        else openWallet('samsungpay://launch?action=main');
    }

    function show(it) {
        if (!sh) return;
        showing = it;
        sh.open(APP_ID);
        if (layers[layers.length - 1] !== 'show') layers.push('show');
        sync();
    }

    let bright = false;
    function brightness(full) {
        if (bright === !!full) return;
        bright = !!full;
        const d = window.AndroidDisplay;
        try { if (d && typeof d.setFullBrightness === 'function') d.setFullBrightness(bright); } catch (_) { /* older app */ }
    }

    // ---------------------------------------------------------------- Today

    function lineOf(it) {
        if (it.kind === 'card') return it.name || it.walletName || 'Card';
        if (it.kind === 'barcode') return it.name || 'Membership';
        return it.name || 'ID';
    }
    /** The second line: a card's name in Wallet (else its network) and the last 4; a barcode's number. */
    function subOf(it) {
        if (it.kind === 'card') return [it.walletName || (it.network && it.network !== 'other' ? label(NETWORKS, it.network) : ''), it.last4 ? `\u2022\u2022${it.last4}` : ''].filter(Boolean).join(' ');
        if (it.kind === 'barcode') return it.number || (TWO_D.has(it.format) ? '' : it.value) || '';
        return 'Open in Samsung Wallet';
    }

    let todayKey = '';
    function todayRender(el) {
        const list = items();
        if (storeNote === 'locked') { if (todayKey !== 'locked') { todayKey = 'locked'; el.innerHTML = `<div class="wwl-row"><span class="wwl-lines"><span class="wwl-title">${TITLE}</span><span class="wwl-sub">Unlock the phone to show your cards.</span></span></div>`; } return true; }
        if (!list.length) return false;
        if (todayAt >= list.length) todayAt = 0;
        const it = list[todayAt];
        const art = it.kind === 'barcode' ? barcodeUrl(it, false) : null;
        const pic = it.kind === 'card' ? cardUrl(it) : '';
        const key = JSON.stringify([todayAt, list.length, it.id, it.name, it.last4, it.color, it.network, it.walletName, it.value, it.number, it.format, art, pic.length]);
        if (key === todayKey) return true;
        todayKey = key;
        // [card picture] nickname / its name in Wallet ••last 4; a tap on it pays (or shows, or opens)
        const act = it.kind === 'card' ? 'pay' : it.kind === 'barcode' ? 'show' : 'id';
        const lead = it.kind === 'card' ? `<img class="wwl-pic" src="${esc(pic)}" alt="" draggable="false">` : `<img class="wwl-pic is-icon" src="/static_images/wm61/${ICON}.png" srcset="/static_images/wm61/${ICON}@2x.png 2x, /static_images/wm61/${ICON}@4x.png 4x" alt="" draggable="false">`;
        const row = `<div class="wwl-row">
                <button type="button" class="wwl-item" data-act="${act}">${lead}<span class="wwl-lines"><span class="wwl-title">${esc(lineOf(it))}</span><span class="wwl-sub">${esc(subOf(it))}</span></span></button>
                ${list.length > 1 ? `<span class="wwl-pager"><button type="button" class="wwl-arrow" data-act="prev" aria-label="Previous">\u2039</button><button type="button" class="wwl-arrow" data-act="next" aria-label="Next">\u203a</button></span>` : ''}
            </div>`;
        const code = it.kind === 'barcode' ? `<button type="button" class="wwl-code${TWO_D.has(it.format) ? ' is-2d' : ''}" data-act="show" aria-label="Show ${esc(it.name || 'barcode')} full screen">
                ${art && art !== 'bad' ? `<img src="${art}" alt="">` : `<span class="wwl-code-wait">${art === 'bad' ? 'This number cannot be drawn as the chosen barcode.' : 'Drawing the barcode...'}</span>`}
            </button>` : '';
        el.innerHTML = row + code;
        if (!el.dataset.wired) {
            el.dataset.wired = '1';
            el.addEventListener('click', (e) => {
                const b = e.target.closest('[data-act]');
                if (!b) return;
                const cur = items()[todayAt];
                const act = b.dataset.act;
                if (act === 'prev' || act === 'next') { const n = items().length; todayAt = (todayAt + (act === 'next' ? 1 : -1) + n) % n; todayRender(el); return; }
                if (act === 'pay') pay(cur);
                else if (act === 'show') show(cur);
                else if (act === 'id') activate(cur);
            });
        }
        return true;
    }


    function todayTitanium() {
        const list = items();
        if (storeNote === 'locked') return { label: 'wallet', icon: `x:${ICON}-lg`, pages: [{ title: 'Wallet', line2: 'Unlock the phone to show your cards' }] };
        if (!list.length) return null;
        return {
            label: 'wallet',
            icon: `x:${ICON}-lg`,
            pages: list.map((it) => {
                const go = () => activate(it);
                const image = it.kind === 'card' ? cardUrl(it) : it.kind === 'barcode' ? (barcodeUrl(it, false) || undefined) : undefined;
                const line2 = subOf(it) || (it.kind === 'barcode' ? it.value : '');
                return { title: lineOf(it), line2, image: image === 'bad' ? undefined : image, bare: it.kind === 'card', softKey: { label: it.kind === 'card' ? 'Pay Now' : it.kind === 'barcode' ? 'Show' : 'Open', action: go }, onTap: go };
            })
        };
    }

    // ---------------------------------------------------------------- program

    function build() {
        page.innerHTML = `<div class="wwl-app">
            <div class="wwl-list" data-layer="list"></div>
            <div class="wwl-edit wm-form" data-layer="edit" hidden></div>
            <div class="wwl-show" data-layer="show" hidden></div>
            <div class="wwl-scan" data-layer="scan" hidden><video playsinline muted></video><span class="wwl-scan-guide"></span><p class="wwl-scan-note">Hold the barcode inside the frame.</p></div>
        </div>`;
        els = {
            list: page.querySelector('[data-layer="list"]'),
            edit: page.querySelector('[data-layer="edit"]'),
            show: page.querySelector('[data-layer="show"]'),
            scan: page.querySelector('[data-layer="scan"]'),
            video: page.querySelector('.wwl-scan video')
        };
    }

    function top() { return layers[layers.length - 1] || 'list'; }

    function sync() {
        if (!els) return;
        const t = top();
        for (const k of ['list', 'edit', 'show', 'scan']) els[k].hidden = k !== t;
        page.classList.toggle('is-show', t === 'show');
        brightness(t === 'show');
        if (t !== 'scan') stopScan();
        if (t === 'list') renderList();
        else if (t === 'show') renderShow();
        if (sh) { if (sh.refreshSoftKeys) sh.refreshSoftKeys(); if (sh.refreshTitleAction) sh.refreshTitleAction(); }
    }

    function push(l) { layers.push(l); sync(); }
    function pop() { const was = layers.pop(); if (was === 'edit') form = null; if (was === 'show') showing = null; sync(); return true; }

    let selected = null;
    function renderList() {
        const list = items();
        const ui = window.wmSettings && window.wmSettings.ui;
        if (!ui) return;
        const note = storeNote === 'locked' ? 'Unlock the phone to show your cards.'
            : storeNote === 'error' ? 'The wallet saved on this phone cannot be read (the phone\'s lock screen was reset). Delete All starts it again.'
                : storeNote === 'memory' ? 'This device has no Melaton app: the wallet is kept until the page closes.' : '';
        const rows = list.map((it) => ({ key: it.id, label: `${lineOf(it)}${it.kind === 'barcode' ? ` (${label(FORMATS, it.format)})` : it.kind === 'id' ? ' (ID)' : ''}`, selected: it.id === selected, img: it.kind === 'card' ? cardUrl(it) : undefined }));
        els.list.innerHTML = `${note ? ui.note(note) : ''}
            ${list.length ? ui.listbox(rows) : `<p class="wwl-empty">No cards yet. Menu > New Card, New Barcode or New ID adds one.</p>`}
            ${ui.note('Cards open Samsung Wallet\'s pay sheet; it asks for your fingerprint, then hold the phone to the reader. Barcodes show here for the store to scan. Everything stays on this phone, encrypted.')}`;
        ui.bindListbox(els.list.querySelector('.wm-listbox'), (k) => { selected = k; if (sh.refreshSoftKeys) sh.refreshSoftKeys(); });
        els.list.querySelectorAll('.wm-listbox-row').forEach((row) => row.addEventListener('dblclick', () => { const it = list.find((x) => x.id === row.dataset.key); if (it) activate(it); }));
    }

    function renderShow() {
        const it = showing;
        if (!it) { pop(); return; }
        const art = barcodeUrl(it, true);
        els.show.innerHTML = `<div class="wwl-show-name">${esc(it.name || 'Membership')}</div>
            <div class="wwl-show-code${TWO_D.has(it.format) ? ' is-2d' : ''}">${art && art !== 'bad' ? `<img src="${art}" alt="${esc(it.value)}">` : `<span>${art === 'bad' ? 'This number cannot be drawn as the chosen barcode.' : 'Drawing the barcode...'}</span>`}</div>
            ${it.number || TWO_D.has(it.format) ? `<div class="wwl-show-num">${esc(it.number || it.value)}</div>` : ''}`;
    }

    function editItem(it, kind) {
        form = it ? { isNew: false, item: Object.assign({}, it) } : { isNew: true, item: { id: uid(), kind, name: '', color: COLORS[0][0], network: 'visa', format: 'code128' } };
        push('edit');
        renderEdit();
    }

    function renderEdit() {
        const ui = window.wmSettings && window.wmSettings.ui;
        const f = form && form.item;
        if (!ui || !f) return;
        let html = '';
        if (f.kind === 'card') {
            html = `<div class="wwl-edit-pic"><img src="${esc(cardUrl(f))}" alt="" draggable="false"></div>
                ${ui.buttons([['photo', 'Take Picture...'], ['nophoto', 'Remove Picture', !f.photo]])}
                ${ui.row('Nickname:', ui.edit('wwlName', f.name || '', 'maxlength="32"'), { for: 'wwlName' })}
                ${ui.row('Card name:', ui.edit('wwlWallet', f.walletName || '', 'maxlength="40"'), { for: 'wwlWallet' })}
                ${ui.row('Last 4:', ui.edit('wwlLast4', f.last4 || '', 'maxlength="4" inputmode="numeric"'), { for: 'wwlLast4' })}
                ${ui.row('Network:', ui.comboHtml('net', label(NETWORKS, f.network)))}
                ${ui.row('Colour:', ui.comboHtml('color', label(COLORS, f.color)))}
                ${ui.note('Card name is the card\'s name in Samsung Wallet ("X Card"). Pay Now opens the pay sheet on it when it is one of Wallet\'s Quick Access cards; blank opens the default card. Only the last 4 digits are kept, never the card number. The picture is a photo of the card taken here, else one drawn in the colour.')}`;
        } else if (f.kind === 'barcode') {
            html = `${ui.row('Name:', ui.edit('wwlName', f.name || '', 'maxlength="32"'), { for: 'wwlName' })}
                ${ui.row('Barcode:', ui.comboHtml('format', label(FORMATS, f.format)))}
                ${ui.row('Code:', ui.edit('wwlValue', f.value || '', 'maxlength="600"'), { for: 'wwlValue' })}
                ${ui.row('Shown as:', ui.edit('wwlNumber', f.number || '', 'maxlength="40"'), { for: 'wwlNumber' })}
                ${'BarcodeDetector' in window ? ui.buttons([['scan', 'Scan...']]) : ''}
                ${ui.note('Code is what the barcode holds, as printed under it on the card. Shown as is the number written under a QR or PDF417 code (optional).')}`;
        } else {
            html = `${ui.row('Name:', ui.edit('wwlName', f.name || 'Driver License', 'maxlength="32"'), { for: 'wwlName' })}
                ${ui.note('IDs stay in Samsung Wallet, which shows and presents them after your fingerprint. This page opens Samsung Wallet.')}`;
        }
        els.edit.innerHTML = html;
        const bind = (act, list, key) => ui.bindCombo(els.edit.querySelector(`[data-act="${act}"]`), list, f[key], (v) => { f[key] = v; });
        bind('net', NETWORKS, 'network');
        bind('color', COLORS, 'color');
        bind('format', FORMATS, 'format');
        const sc = els.edit.querySelector('[data-act="scan"]');
        if (sc) sc.addEventListener('click', () => { readEdit(); startScan(); });
        const ph = els.edit.querySelector('[data-act="photo"]');
        if (ph) ph.addEventListener('click', () => { readEdit(); startScan('photo'); });
        const np = els.edit.querySelector('[data-act="nophoto"]');
        if (np) np.addEventListener('click', () => { readEdit(); delete f.photo; renderEdit(); });
    }

    function readEdit() {
        const f = form && form.item;
        if (!f) return;
        const v = (id) => { const e = els.edit.querySelector(`#${id}`); return e ? e.value.trim() : undefined; };
        const set = (k, id) => { const x = v(id); if (x !== undefined) f[k] = x; };
        set('name', 'wwlName');
        set('last4', 'wwlLast4');
        set('walletName', 'wwlWallet');
        set('value', 'wwlValue');
        set('number', 'wwlNumber');
        if (f.last4) f.last4 = f.last4.replace(/\D/g, '').slice(-4);
    }

    function saveEdit() {
        readEdit();
        const f = form && form.item;
        if (!f) return;
        if (f.kind === 'barcode' && !f.value) { sh.messageBox({ title: TITLE, icon: 'info', text: 'Enter the code the barcode holds, or scan it.' }); return; }
        if (f.kind === 'card' && !f.name && !f.walletName) { sh.messageBox({ title: TITLE, icon: 'info', text: 'Enter a nickname or the card\'s name.' }); return; }
        const list = items();
        const i = list.findIndex((x) => x.id === f.id);
        if (i >= 0) list[i] = f; else list.push(f);
        selected = f.id;
        save();
        pop();
    }

    async function remove(all) {
        const list = items();
        const it = list.find((x) => x.id === selected);
        if (!all && !it) return;
        const ok = await sh.messageBox({ title: TITLE, icon: 'question', text: all ? 'Delete every card, barcode and ID from this phone\'s wallet?' : `Delete "${lineOf(it)}"?`, buttons: [{ text: 'Delete', value: true }, { text: 'Cancel', value: false }] });
        if (!ok) return;
        if (all) { data.items = []; storeNote = storeNote === 'error' ? '' : storeNote; const s = store(); try { if (s && s.remove) s.remove(NS); } catch (_) { /* ignore */ } } else data.items = list.filter((x) => x !== it);
        selected = null;
        save();
        renderList();
    }

    function move(d) {
        const list = items();
        const i = list.findIndex((x) => x.id === selected);
        const j = i + d;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        save();
        renderList();
    }

    // ---------------------------------------------------------------- camera scan

    async function startScan(mode) {
        const photo = mode === 'photo';
        if (!photo && !('BarcodeDetector' in window)) return;
        push('scan');
        els.scan.classList.toggle('is-photo', photo);
        const note = els.scan.querySelector('.wwl-scan-note');
        if (note) note.textContent = photo ? 'Fill the frame with the card, then Capture.' : 'Hold the barcode inside the frame.';
        let det = null;
        try {
            if (!photo) {
                const supported = await window.BarcodeDetector.getSupportedFormats();
                det = new window.BarcodeDetector({ formats: Object.keys(DETECTED).filter((f) => supported.includes(f)) });
            }
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
            scan = { stream, timer: null, photo };
            els.video.srcObject = stream;
            await els.video.play();
            if (sh.refreshSoftKeys) sh.refreshSoftKeys();
        } catch (err) {
            stopScan();
            if (top() === 'scan') pop();
            sh.messageBox({ title: TITLE, icon: 'error', text: 'The camera could not be started.' });
            return;
        }
        if (photo) return; // Capture (the left soft key) takes the picture
        const look = async () => {
            if (!scan || top() !== 'scan') return;
            let found = null;
            try { const r = await det.detect(els.video); found = r && r[0]; } catch (_) { found = null; }
            if (found && form && form.item) {
                form.item.value = found.rawValue;
                form.item.format = DETECTED[found.format] || form.item.format;
                stopScan();
                pop();
                renderEdit();
                return;
            }
            // one look every 250 ms while the camera shows (not a frame loop)
            scan.timer = setTimeout(look, 250);
        };
        look();
    }

    /** The camera's frame inside the card-shaped guide, as the card's picture (344 x 216, JPEG). */
    function capture() {
        const v = els && els.video;
        if (!scan || !v || !v.videoWidth || !form || !form.item) return;
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        // the guide on screen (wm-wallet.css: 7 % in from each side, 1.586 : 1, centred) mapped into
        // the camera frame, which the video shows scaled to cover its box
        const r = v.getBoundingClientRect();
        const scale = Math.max(r.width / vw, r.height / vh);
        const gw = r.width * 0.86;
        const gh = gw / 1.586;
        const sx = (r.width * 0.07 - (r.width - vw * scale) / 2) / scale;
        const sy = ((r.height - gh) / 2 - (r.height - vh * scale) / 2) / scale;
        const c = document.createElement('canvas');
        c.width = 344;
        c.height = 216;
        c.getContext('2d').drawImage(v, sx, sy, gw / scale, gh / scale, 0, 0, c.width, c.height);
        form.item.photo = c.toDataURL('image/jpeg', 0.8);
        stopScan();
        pop();
        renderEdit();
    }

    function stopScan() {
        if (!scan) return;
        clearTimeout(scan.timer);
        try { scan.stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ }
        if (els && els.video) els.video.srcObject = null;
        scan = null;
    }

    // ---------------------------------------------------------------- registration

    const APP = {
        id: APP_ID,
        title: TITLE,
        icon: ICON,
        art65: 'wallet',
        inStart: 'programs',
        sip: true,
        mount(p) { page = p; p.classList.add('wm-wallet'); build(); },
        show() { if (!loaded || storeNote === 'locked') load(); sync(); },
        hide() { brightness(false); stopScan(); },
        historyDepth: () => layers.length,
        onBack: () => (layers.length ? pop() : false),
        titleKind: () => (layers.length ? 'ok' : 'close'),
        onTitleOk: () => { if (top() === 'edit') saveEdit(); else pop(); },
        onTitleClose() { layers = []; form = null; showing = null; brightness(false); stopScan(); },
        softKeys() {
            const t = top();
            if (t === 'edit') return { left: { label: 'Save', action: saveEdit }, right: { label: 'Cancel', action: pop } };
            if (t === 'scan') return { left: scan && scan.photo ? { label: 'Capture', action: capture } : { label: '', action: () => {} }, right: { label: 'Cancel', action: pop } };
            if (t === 'show') {
                const list = items().filter((x) => x.kind === 'barcode');
                const next = () => { const i = list.indexOf(showing); showing = list[(i + 1) % list.length]; renderShow(); };
                return { left: { label: 'Done', action: pop }, right: list.length > 1 ? { label: 'Next', action: next } : { label: '', action: () => {} } };
            }
            const sel = items().find((x) => x.id === selected);
            const n = items().length;
            const i = sel ? items().indexOf(sel) : -1;
            return {
                left: sel ? { label: sel.kind === 'card' ? 'Pay Now' : sel.kind === 'barcode' ? 'Show' : 'Open', action: () => activate(sel) } : { label: 'New', action: () => editItem(null, 'card') },
                right: {
                    label: 'Menu',
                    menu: () => [
                        { label: 'New Card...', action: () => editItem(null, 'card') },
                        { label: 'New Barcode...', action: () => editItem(null, 'barcode') },
                        { label: 'New ID...', action: () => editItem(null, 'id') },
                        '-',
                        { label: 'Edit...', disabled: !sel, action: () => editItem(sel) },
                        { label: 'Move Up', disabled: !sel || i <= 0, action: () => move(-1) },
                        { label: 'Move Down', disabled: !sel || i >= n - 1, action: () => move(1) },
                        { label: 'Delete', disabled: !sel, action: () => remove(false) },
                        '-',
                        { label: 'Delete All', disabled: !n && storeNote !== 'error', action: () => remove(true) }
                    ]
                }
            };
        }
    };

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        sh.registerApp(APP);
        if (typeof sh.registerTodayItem === 'function') {
            sh.registerTodayItem({ id: 'cards', label: TITLE, icon: ICON, after: 'lapis', render: todayRender, titanium: todayTitanium });
        }
    }

    // the phone was unlocked: a store that was locked can be read now
    window.addEventListener('melatonscreen', (e) => { if (e.detail && e.detail.on && storeNote === 'locked') { load(); todayKey = ''; if (sh && sh.refreshToday) sh.refreshToday(); } });

    window.wmWallet = { open: () => sh && sh.open(APP_ID), pay: (i) => pay(items()[i]), show: (i) => show(items()[i]) };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
