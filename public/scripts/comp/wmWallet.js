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
 * Client-side only (Yukimi, Nov 16 2026): everything stays on the phone. The list (names, Wallet
 * names, last 4, membership numbers) is in the Android app's encrypted store under the namespace
 * 'wallet' (window.AndroidSecureStore: AES-256-GCM under an Android Keystore key, not backed up; DSApp
 * SecureStore.kt, docs/ANDROID_BRIDGE.md); the pictures (card art, Wallet's barcode pictures) need no
 * encryption and are kept in this page's IndexedDB. Nothing goes to the server, which keeps only
 * Settings > Today's options for the item. Without the app (a test tab) the list lives in this page's
 * memory and is gone on reload.
 * A card's picture is cut from Samsung Wallet (Import from Samsung Wallet), a photo taken here with
 * the camera (cropped to a card), or drawn from its colour.
 *
 * Import from Samsung Wallet (Menu): the Android app reads Wallet's own screens through Melaton Bars'
 * accessibility service (window.AndroidWalletImport, DSApp WalletImport.kt): every payment card's name,
 * network, last 4 and its card art cut from its details page (exact view bounds, corners cleared), and
 * every membership's name, card art, barcode picture and number. Wallet shows only the last 4 of a
 * card. The page then lists what was found with check boxes; the checked ones are added or updated.
 * A membership's barcode type is read from its picture (BarcodeDetector); when it cannot be, Wallet's
 * own barcode picture is shown as it is (format 'image').
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
        ['azteccode', 'Aztec'], ['datamatrix', 'Data Matrix'], ['image', 'As in Samsung Wallet']
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
    let layers = []; // 'edit' | 'show' | 'scan' | 'import' | 'keys'
    let imported = null; // { running, items, picked: Set(index), reason } while an import runs or is offered
    let form = null; // the item being edited (a copy) and whether it is new
    let showing = null; // the item shown full screen
    let todayAt = 0; // the selected item on Today (index)
    let scan = null; // { stream, timer }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const uid = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const label = (list, v) => (list.find((x) => x[0] === v) || list[list.length - 1])[1];

    // ---------------------------------------------------------------- store (on the phone only)

    // Two stores (Yukimi, Nov 16: only the cards' links / ids need encryption, not the pictures):
    //  - the list, encrypted (AndroidSecureStore 'wallet'): names, Wallet names (Pay Now's link), last 4,
    //    membership numbers, order; a few KB, so a reorder or a rename writes almost nothing
    //  - the pictures, plain, in this page's IndexedDB ('melatonWallet' / 'pics', Blobs keyed
    //    '<id>:photo' card art and '<id>:code' Wallet's barcode picture): asynchronous, never blocks
    //    the page; site data cleared loses them, a new import brings them back
    // (Before, one blocking call re-encrypted every picture on each change and the phone locked up.)
    const NS = 'wallet';
    const pics = new Map(); // id -> { photo, code } blob URLs of the stored pictures
    function store() { return window.AndroidSecureStore || null; }

    let dbOpen = null;
    function picDb() {
        if (!dbOpen) {
            dbOpen = new Promise((resolve, reject) => {
                const r = indexedDB.open('melatonWallet', 1);
                r.onupgradeneeded = () => r.result.createObjectStore('pics');
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
            });
            dbOpen.catch(() => { dbOpen = null; });
        }
        return dbOpen;
    }
    async function picOp(mode, fn) {
        const d = await picDb();
        return new Promise((resolve) => {
            const tx = d.transaction('pics', mode);
            const q = fn(tx.objectStore('pics'));
            tx.oncomplete = () => resolve(q && 'result' in q ? q.result : null);
            tx.onerror = () => resolve(null);
            tx.onabort = () => resolve(null);
        });
    }
    const picGet = (k) => picOp('readonly', (st) => st.get(k)).catch(() => null);
    const picPut = (k, blob) => picOp('readwrite', (st) => st.put(blob, k)).catch(() => null);
    const picDel = (k) => picOp('readwrite', (st) => st.delete(k)).catch(() => null);

    function dataToBlob(dataUrl) {
        const comma = dataUrl.indexOf(',');
        const mime = dataUrl.slice(5, comma).split(';')[0];
        const bin = atob(dataUrl.slice(comma + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }

    function setPic(id, kind, url) {
        const p = pics.get(id) || {};
        if (p[kind] && p[kind] !== url) URL.revokeObjectURL(p[kind]);
        if (url) p[kind] = url; else delete p[kind];
        pics.set(id, p);
    }

    /** The stored pictures, read once after the list; Today and the list repaint as they arrive. */
    async function loadPics() {
        for (const it of data.items) {
            for (const kind of ['photo', 'code']) {
                if (!(kind === 'photo' ? it.hasPhoto : it.hasCode) || (pics.get(it.id) || {})[kind]) continue;
                const blob = await picGet(`${it.id}:${kind}`);
                if (blob) setPic(it.id, kind, URL.createObjectURL(blob));
            }
        }
        todayKey = '';
        todayChanged();
        if (!layers.length && page && page.isConnected && els) renderList();
    }

    function load() {
        loaded = true;
        const s = store();
        if (!s || typeof s.get !== 'function') { storeNote = 'memory'; return; }
        let text = '';
        try { text = String(s.get(NS) || ''); } catch (_) { text = '!error'; }
        if (text === '!locked') { storeNote = 'locked'; loaded = false; return; }
        if (text.startsWith('!error')) { storeNote = 'error'; return; }
        storeNote = '';
        if (!text) { data = { v: 2, items: [] }; return; }
        try {
            const d = JSON.parse(text);
            data = { v: 2, items: Array.isArray(d.items) ? d.items.filter((x) => x && x.id && x.kind) : [] };
        } catch (_) { storeNote = 'error'; return; }
        // a wallet saved before (v1) kept its pictures in the encrypted list: they move to IndexedDB now
        if (data.items.some((it) => it.photo || it.codeImage)) save();
        loadPics();
    }

    // a reorder in the list is kept until OK (Yukimi, Nov 16: like other settings, saved on OK only);
    // leaving the list any other way puts the saved order back
    let pendingOrder = null; // the saved order (ids) while the list holds an unsaved reorder
    function noteReorder() { if (!pendingOrder) pendingOrder = items().map((x) => x.id); }
    function revertOrder() {
        if (!pendingOrder) return;
        const by = new Map(items().map((x) => [x.id, x]));
        data.items = pendingOrder.map((id) => by.get(id)).filter(Boolean).concat(items().filter((x) => !pendingOrder.includes(x.id)));
        pendingOrder = null;
    }

    /** The list (encrypted, small) at once; new or removed pictures to IndexedDB in the background. */
    function save() {
        pendingOrder = null;
        const s = store();
        const work = [];
        for (const it of data.items) {
            for (const [kind, field, flag, gone] of [['photo', 'photo', 'hasPhoto', 'photoRemoved'], ['code', 'codeImage', 'hasCode', 'codeRemoved']]) {
                if (it[field]) {
                    // a new picture (data URL from the import or the camera)
                    const blob = dataToBlob(it[field]);
                    setPic(it.id, kind, URL.createObjectURL(blob));
                    work.push(picPut(`${it.id}:${kind}`, blob));
                    it[flag] = true;
                    delete it[field];
                } else if (it[gone]) {
                    setPic(it.id, kind, null);
                    work.push(picDel(`${it.id}:${kind}`));
                    it[flag] = false;
                }
                delete it[gone];
            }
        }
        // the pictures of cards that are gone
        const ids = new Set(data.items.map((it) => it.id));
        for (const id of [...pics.keys()]) if (!ids.has(id)) { setPic(id, 'photo', null); setPic(id, 'code', null); pics.delete(id); work.push(picDel(`${id}:photo`), picDel(`${id}:code`)); }
        // the unsaved pictures' blob URLs (blobOf) are kept as IndexedDB blobs now (setPic): they go
        for (const url of blobs.values()) { try { URL.revokeObjectURL(url); } catch (_) { /* gone */ } }
        blobs.clear();
        if (s && typeof s.put === 'function' && storeNote !== 'error') {
            let ok = false;
            try { ok = s.put(NS, JSON.stringify({ v: 2, items: data.items })) === true; } catch (_) { ok = false; }
            if (!ok && sh) sh.messageBox({ title: TITLE, icon: 'error', text: 'The wallet could not be saved on this phone. Unlock the phone, then try again.' });
        }
        todayChanged();
        return Promise.all(work);
    }

    /** A card's or membership's art (blob URL), a new one not saved yet included; '' when none. */
    function photoOf(it) { return it.photo ? blobOf(it.photo) : (it.photoRemoved ? '' : ((pics.get(it.id) || {}).photo || '')); }
    /** Samsung Wallet's barcode picture (blob URL); '' when none. */
    function codeOf(it) { return it.codeImage ? blobOf(it.codeImage) : (it.codeRemoved ? '' : ((pics.get(it.id) || {}).code || '')); }

    // pictures shown from blob URLs made once per picture (a data URL in every <img> was re-parsed on
    // each repaint: megabytes of text for a list of imported cards)
    const blobs = new Map();
    function blobOf(dataUrl) {
        if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl || '';
        const have = blobs.get(dataUrl);
        if (have) return have;
        try {
            const comma = dataUrl.indexOf(',');
            const mime = dataUrl.slice(5, comma).split(';')[0];
            const bin = atob(dataUrl.slice(comma + 1));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
            blobs.set(dataUrl, url);
            return url;
        } catch (_) { return dataUrl; }
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
        // Samsung Wallet's own barcode picture, when its type could not be read
        if (it.format === 'image') return codeOf(it) || (it.hasCode ? null : 'bad');
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
            todayChanged();
            if (layers[layers.length - 1] === 'show' && showing === it) renderShow();
            if (!layers.length && page && page.isConnected) renderList();
        }).catch(() => { codeArt.delete(k); });
        return null;
    }

    // HDR barcodes: the drawn code as a PNG whose cICP chunk says BT.2020 / PQ, so white is far above SDR
    // white (the panel shows it at its peak) and black stays black; only the code gets brighter, while
    // the window is in HDR mode (AndroidDisplay.setHdr). Blob URLs by format + value.
    const hdrArt = new Map();
    function crc32(bytes) {
        let c;
        const t = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
        let x = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) x = t[(x ^ bytes[i]) & 0xff] ^ (x >>> 8);
        return (x ^ 0xffffffff) >>> 0;
    }
    /** A PNG (data URL) again with a cICP chunk (9 BT.2020, 16 PQ, 0 RGB, full range) and no colour chunks. */
    async function hdrPng(dataUrl) {
        const src = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
        const out = [src.slice(0, 8)];
        let i = 8;
        while (i < src.length) {
            const len = (src[i] << 24 | src[i + 1] << 16 | src[i + 2] << 8 | src[i + 3]) >>> 0;
            const type = String.fromCharCode(src[i + 4], src[i + 5], src[i + 6], src[i + 7]);
            const end = i + 12 + len;
            if (!['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP'].includes(type)) out.push(src.slice(i, end));
            if (type === 'IHDR') {
                const body = new Uint8Array([0x63, 0x49, 0x43, 0x50, 9, 16, 0, 1]);
                const chunk = new Uint8Array(16);
                chunk.set([0, 0, 0, 4], 0);
                chunk.set(body, 4);
                const crc = crc32(body);
                chunk.set([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], 12);
                out.push(chunk);
            }
            i = end;
        }
        return URL.createObjectURL(new Blob(out, { type: 'image/png' }));
    }
    function hdrUrl(it) {
        const k = `${it.format}|${it.value}|${codeOf(it)}`;
        if (hdrArt.has(k)) return hdrArt.get(k);
        hdrArt.set(k, null);
        const base = barcodeUrl(it, true);
        const make = (u) => hdrPng(u).then((url) => { hdrArt.set(k, url); paintHdr(); }).catch(() => hdrArt.delete(k));
        if (base && base !== 'bad') make(base);
        else hdrArt.delete(k);
        return null;
    }
    let hdrOn = null; // the item whose code is brightened on Today, and when it goes back
    let hdrTimer = null;
    function setHdr(on) {
        const d = window.AndroidDisplay;
        try { if (d && typeof d.setHdr === 'function') d.setHdr(!!on); } catch (_) { /* older app */ }
    }
    /** Today's code brightened (HDR) for 30 s, or back to normal. */
    function toggleHdr(it) {
        clearTimeout(hdrTimer);
        if (hdrOn === it.id) { hdrOn = null; setHdr(false); } else {
            hdrOn = it.id;
            setHdr(true);
            hdrUrl(it);
            hdrTimer = setTimeout(() => { hdrOn = null; setHdr(false); todayKey = ''; todayChanged(); }, 30000);
        }
        todayKey = '';
        todayChanged();
    }
    function paintHdr() { todayKey = ''; todayChanged(); }
    // leaving Today or the screen going off: SDR again
    // app-scope: allow page lifetime (phone shell, loaded once from app.html; not an app package)
    document.addEventListener('visibilitychange', () => { if (document.hidden && hdrOn) { hdrOn = null; clearTimeout(hdrTimer); setHdr(false); } });

    // a card's picture for the 6.5 panel and the list (canvas: the panel takes an image)
    const cardArt = new Map();
    function cardUrl(it) {
        const ph = photoOf(it);
        if (ph) return ph;
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
    /** Only Wallet's Today item drawn again (#890: not the whole of Today); an older shell draws it all. */
    function todayChanged() {
        if (!sh) return;
        if (typeof sh.refreshTodayItem === 'function') sh.refreshTodayItem('cards');
        else if (typeof sh.refreshToday === 'function') sh.refreshToday();
    }
    function todayRender(el, ctx) {
        const list = items();
        const showCode = !ctx || typeof ctx.option !== 'function' || ctx.option('code') !== 'hide';
        if (storeNote === 'locked') { if (todayKey !== 'locked') { todayKey = 'locked'; el.innerHTML = `<div class="wwl-row"><span class="wwl-lines"><span class="wwl-title">${TITLE}</span><span class="wwl-sub">Unlock the phone to show your cards.</span></span></div>`; } return true; }
        if (!list.length) return false;
        if (todayAt >= list.length) todayAt = 0;
        const it = list[todayAt];
        const bright = it.kind === 'barcode' && hdrOn === it.id;
        const art = it.kind === 'barcode' && showCode ? (bright ? (hdrUrl(it) || barcodeUrl(it, false)) : barcodeUrl(it, false)) : null;
        const pic = it.kind === 'card' ? cardUrl(it) : photoOf(it);
        const key = JSON.stringify([todayAt, list.length, it.id, it.name, it.last4, it.color, it.network, it.walletName, it.value, it.number, it.format, art, pic.length, showCode, bright]);
        if (key === todayKey) return true;
        todayKey = key;
        // [card picture] nickname / its name in Wallet ••last 4; a tap on it pays (or shows, or opens)
        const act = it.kind === 'card' ? 'pay' : it.kind === 'barcode' ? 'show' : 'id';
        const lead = pic ? `<img class="wwl-pic" src="${esc(pic)}" alt="" draggable="false">` : `<img class="wwl-pic is-icon" src="/static_images/wm61/${ICON}.png" srcset="/static_images/wm61/${ICON}@2x.png 2x, /static_images/wm61/${ICON}@4x.png 4x" alt="" draggable="false">`;
        const row = `<div class="wwl-row">
                <button type="button" class="wwl-item" data-act="${act}">${lead}<span class="wwl-lines"><span class="wwl-title">${esc(lineOf(it))}</span><span class="wwl-sub">${esc(subOf(it))}</span></span></button>
                ${list.length > 1 ? `<span class="wwl-pager"><button type="button" class="wwl-arrow" data-act="prev" aria-label="Previous">\u2039</button><button type="button" class="wwl-arrow" data-act="next" aria-label="Next">\u203a</button></span>` : ''}
            </div>`;
        // the code on Today (Settings > Today > Items > Wallet: Barcode); a tap brightens just the code (HDR)
        const code = it.kind === 'barcode' && showCode ? `<button type="button" class="wwl-code${TWO_D.has(it.format) ? ' is-2d' : ''}${bright ? ' is-bright' : ''}" data-act="bright" aria-label="${bright ? 'Back to normal brightness' : 'Brighten the barcode'}">
                ${art && art !== 'bad' ? `<img src="${art}" alt="">` : `<span class="wwl-code-wait">${art === 'bad' ? 'This number cannot be drawn as the chosen barcode.' : 'Drawing the barcode...'}</span>`}
            </button>` : '';
        // a membership with its code on Today: [card picture] [the whole barcode] in one row (Yukimi,
        // Nov 16), the picture's tap shows it full screen, the code's tap brightens it (HDR)
        const pager = list.length > 1 ? `<span class="wwl-pager"><button type="button" class="wwl-arrow" data-act="prev" aria-label="Previous">\u2039</button><button type="button" class="wwl-arrow" data-act="next" aria-label="Next">\u203a</button></span>` : '';
        const side = it.kind === 'barcode' && showCode
            ? `<div class="wwl-row is-code">
                <button type="button" class="wwl-item is-pic" data-act="show" aria-label="${esc(lineOf(it))}: full screen">${pic ? `<img class="wwl-pic is-big" src="${esc(pic)}" alt="" draggable="false">` : `<span class="wwl-pic-name">${esc(lineOf(it))}</span>`}</button>
                ${code.replace('class="wwl-code', 'class="wwl-code is-side')}
                ${pager}
            </div>`
            : '';
        el.innerHTML = side || (row + code);
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
                else if (act === 'bright') toggleHdr(cur);
                else if (act === 'id') activate(cur);
            });
        }
        return true;
    }


    function todayTitanium(ctx) {
        const list = items();
        const showCode = !ctx || typeof ctx.option !== 'function' || ctx.option('code') !== 'hide';
        if (storeNote === 'locked') return { label: 'wallet', icon: `x:${ICON}-lg`, pages: [{ title: 'Wallet', line2: 'Unlock the phone to show your cards' }] };
        if (!list.length) return null;
        return {
            label: 'wallet',
            icon: `x:${ICON}-lg`,
            pages: list.map((it) => {
                const go = () => activate(it);
                const code = it.kind === 'barcode' && showCode ? barcodeUrl(it, false) : null;
                const photo = photoOf(it);
                const image = it.kind === 'card' ? cardUrl(it) : it.kind === 'barcode' ? ((code && code !== 'bad' ? code : null) || photo || undefined) : undefined;
                const line2 = subOf(it) || (it.kind === 'barcode' ? it.value : '');
                // wide pictures keep their shape on Today (#903): a card is a card, a barcode as the code is (a QR square)
                const imageAspect = it.kind === 'card' ? 1.586 : (code && image === code) ? 'auto' : undefined;
                return { title: lineOf(it), line2, image: image === 'bad' ? undefined : image, imageAspect, imageFit: code && image === code ? 'contain' : undefined, bare: it.kind === 'card' || (!!photo && image === photo), softKey: { label: it.kind === 'card' ? 'Pay Now' : it.kind === 'barcode' ? 'Show' : 'Open', action: go }, onTap: go };
            })
        };
    }

    // ---------------------------------------------------------------- program

    function build() {
        page.innerHTML = `<div class="wwl-app">
            <div class="wwl-list" data-layer="list"></div>
            <div class="wwl-edit wm-form" data-layer="edit" hidden></div>
            <div class="wwl-show" data-layer="show" hidden></div>
            <div class="wwl-import wm-form" data-layer="import" hidden></div>
            <div class="wwl-keys wm-form" data-layer="keys" hidden></div>
            <div class="wwl-scan" data-layer="scan" hidden><video playsinline muted></video><span class="wwl-scan-guide"></span><p class="wwl-scan-note">Hold the barcode inside the frame.</p></div>
        </div>`;
        els = {
            list: page.querySelector('[data-layer="list"]'),
            edit: page.querySelector('[data-layer="edit"]'),
            show: page.querySelector('[data-layer="show"]'),
            import: page.querySelector('[data-layer="import"]'),
            keys: page.querySelector('[data-layer="keys"]'),
            scan: page.querySelector('[data-layer="scan"]'),
            video: page.querySelector('.wwl-scan video')
        };
    }

    function top() { return layers[layers.length - 1] || 'list'; }

    function sync() {
        if (!els) return;
        const t = top();
        for (const k of ['list', 'edit', 'show', 'scan', 'import', 'keys']) els[k].hidden = k !== t;
        page.classList.toggle('is-show', t === 'show');
        brightness(t === 'show');
        if (t !== 'scan') stopScan();
        if (t === 'list') renderList();
        else if (t === 'show') renderShow();
        else if (t === 'import') renderImport();
        else if (t === 'keys') renderKeys();
        if (sh) { if (sh.refreshSoftKeys) sh.refreshSoftKeys(); if (sh.refreshTitleAction) sh.refreshTitleAction(); }
    }

    function push(l) { layers.push(l); sync(); }
    function pop() { const was = layers.pop(); if (was === 'edit') form = null; if (was === 'show') showing = null; if (was === 'import') imported = null; sync(); return true; }

    let selected = null;
    function renderList() {
        const list = items();
        const ui = window.wmSettings && window.wmSettings.ui;
        if (!ui) return;
        const note = storeNote === 'locked' ? 'Unlock the phone to show your cards.'
            : storeNote === 'error' ? 'The wallet saved on this phone cannot be read (the phone\'s lock screen was reset). Delete All starts it again.'
                : storeNote === 'memory' ? 'This device has no Melaton app: the wallet is kept until the page closes.' : '';
        // each row: its picture and name (a tap selects, a second tap opens it), ▲ / ▼ to reorder in place
        const rows = list.map((it, i) => {
            const img = it.kind === 'card' ? cardUrl(it) : photoOf(it);
            const text = `${lineOf(it)}${it.kind === 'barcode' ? ` (${label(FORMATS, it.format)})` : it.kind === 'id' ? ' (ID)' : ''}`;
            return `<div class="wwl-lrow${it.id === selected ? ' is-selected' : ''}" data-key="${esc(it.id)}">
                <button type="button" class="wwl-lsel">${img ? `<img src="${esc(img)}" alt="" draggable="false">` : '<span class="wwl-lnoimg"></span>'}<span>${esc(text)}</span></button>
                <button type="button" class="wwl-lmove" data-move="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>\u25b2</button>
                <button type="button" class="wwl-lmove" data-move="1" aria-label="Move down"${i === list.length - 1 ? ' disabled' : ''}>\u25bc</button>
            </div>`;
        }).join('');
        els.list.innerHTML = `${note ? ui.note(note) : ''}
            ${list.length ? `<div class="wwl-lrows">${rows}</div>` : '<p class="wwl-empty">No cards yet. Menu > New Card, New Barcode or New ID adds one, or Import from Samsung Wallet.</p>'}
            ${ui.note('Cards open Samsung Wallet\'s pay sheet; it asks for your fingerprint, then hold the phone to the reader. Barcodes show here for the store to scan. ▲ / ▼ set the order Today shows them in; ok saves it.')}`;
        const box = els.list.querySelector('.wwl-lrows');
        if (!box) return;
        box.addEventListener('click', (e) => {
            const row = e.target.closest('.wwl-lrow');
            if (!row) return;
            const id = row.dataset.key;
            const mv = e.target.closest('.wwl-lmove');
            if (mv) { selected = id; markSelected(); move(Number(mv.dataset.move)); return; }
            if (e.target.closest('.wwl-lsel')) {
                if (selected === id) { const it = items().find((x) => x.id === id); if (it) activate(it); return; }
                selected = id;
                markSelected();
            }
        });
    }

    function markSelected() {
        const box = els && els.list && els.list.querySelector('.wwl-lrows');
        if (box) box.querySelectorAll('.wwl-lrow').forEach((r) => r.classList.toggle('is-selected', r.dataset.key === selected));
        if (sh && sh.refreshSoftKeys) sh.refreshSoftKeys();
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
                ${ui.buttons([['photo', 'Take Picture...'], ['nophoto', 'Remove Picture', !photoOf(f)]])}
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
        if (np) np.addEventListener('click', () => { readEdit(); delete f.photo; f.photoRemoved = true; renderEdit(); });
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
        if (all) { data.items = []; storeNote = storeNote === 'error' ? '' : storeNote; } else data.items = list.filter((x) => x !== it);
        selected = null;
        await sh.busy(new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))).then(() => save()), { delay: 0, timeout: 30000 }).catch(() => {});
        renderList();
    }

    /** The list's rows put in data.items' order without drawing them again (their pictures stay decoded). */
    function reorderRows() {
        const box = els && els.list && els.list.querySelector('.wwl-lrows');
        if (!box) { renderList(); return; }
        const rows = new Map([...box.querySelectorAll('.wwl-lrow')].map((r) => [r.dataset.key, r]));
        const list = items();
        list.forEach((it, i) => {
            const r = rows.get(it.id);
            if (!r) return;
            box.appendChild(r);
            const [up, down] = r.querySelectorAll('.wwl-lmove');
            if (up) up.disabled = i === 0;
            if (down) down.disabled = i === list.length - 1;
        });
        const sel = rows.get(selected);
        if (sel) sel.scrollIntoView({ block: 'nearest' });
        if (sh && sh.refreshSoftKeys) sh.refreshSoftKeys();
    }

    /** Cards in Samsung Wallet's order (as the last import found them); the others keep their place after. */
    function orderAsWallet() {
        const list = items();
        const known = list.filter((x) => Number.isFinite(x.walletOrder)).sort((a, b) => a.walletOrder - b.walletOrder);
        noteReorder();
        data.items = known.concat(list.filter((x) => !Number.isFinite(x.walletOrder)));
        reorderRows();
    }

    function moveTo(end) {
        const list = items();
        const i = list.findIndex((x) => x.id === selected);
        if (i < 0) return;
        noteReorder();
        const [it] = list.splice(i, 1);
        if (end === 'top') list.unshift(it); else list.push(it);
        reorderRows();
    }

    function move(d) {
        const list = items();
        const i = list.findIndex((x) => x.id === selected);
        const j = i + d;
        if (i < 0 || j < 0 || j >= list.length) return;
        noteReorder();
        [list[i], list[j]] = [list[j], list[i]];
        reorderRows();
    }

    // ---------------------------------------------------------------- import from Samsung Wallet

    function importer() { return window.AndroidWalletImport || null; }

    async function importStart() {
        const b = importer();
        if (!b) {
            sh.messageBox({ title: TITLE, icon: 'info', text: 'Import from Samsung Wallet needs the newest Melaton app on this phone. It reads Samsung Wallet through Melaton Bars, which the app update adds. Install the update, then try again.' });
            return;
        }
        let av = {};
        try { av = JSON.parse(b.available()); } catch (_) { av = {}; }
        if (!av.service) {
            sh.messageBox({ title: TITLE, icon: 'info', text: 'Import from Samsung Wallet reads Wallet\'s card list through Melaton Bars. Turn on Melaton Bars in Android\'s Settings > Accessibility > Installed apps, then try again.' });
            return;
        }
        const kinds = await sh.messageBox({
            title: 'Import from Samsung Wallet',
            icon: 'question',
            text: 'Samsung Wallet opens and Melaton reads your cards from it: names, the last 4 digits and the card pictures (payment cards), names, card pictures and barcodes (memberships). Please do not touch the screen until it comes back here.\n\nWhat should it import?',
            buttons: [{ text: 'Cards', value: 'payment' }, { text: 'Memberships', value: 'membership' }, { text: 'Both', value: 'all' }],
            cancelValue: null
        });
        if (!kinds) return;
        imported = { running: true, items: [], picked: new Set(), reason: '' };
        let ok = false;
        try { ok = b.start(kinds) === true; } catch (_) { ok = false; }
        if (!ok) { imported = null; sh.messageBox({ title: TITLE, icon: 'error', text: 'The import could not start. Make sure Melaton Bars is on and no import is running.' }); }
    }

    function importTake() {
        const b = importer();
        if (!b || !imported) return;
        let r = null;
        try { r = JSON.parse(b.take()); } catch (_) { r = null; }
        if (!r) return;
        (r.items || []).forEach(importItem);
        if (r.phase === 'error') imported.reason = r.reason || 'failed';
        if (!r.running && imported.running) importDone();
    }

    function importItem(o) {
        if (!imported || !o || !o.walletName) return;
        // the same card from the event and from take(): once
        if (imported.items.some((x) => x.kind === o.kind && x.walletName === o.walletName && (x.last4 || '') === (o.last4 || ''))) return;
        imported.items.push(o);
    }

    function importDone() {
        if (!imported) return;
        imported.running = false;
        if (!imported.items.length) {
            const why = { service: 'Melaton Bars is off.', cancelled: 'It was cancelled.', left: 'Samsung Wallet was left before it finished.' }[imported.reason] || 'No cards were found.';
            imported = null;
            sh.messageBox({ title: TITLE, icon: 'info', text: `Nothing was imported. ${why}` });
            return;
        }
        // tick the cards already here (they are updated), leave the rest for the user to pick
        const have = items();
        imported.items.forEach((o, i) => { if (have.some((x) => sameAs(x, o))) imported.picked.add(i); });
        sh.open(APP_ID);
        if (top() !== 'import') push('import'); else renderImport();
        // the app ends the import with Home, which brings Today up a moment later: come back here
        const t0 = Date.now();
        const back = () => {
            if (!imported || Date.now() - t0 > 4000) return;
            if (sh.currentApp && sh.currentApp() !== APP_ID) sh.open(APP_ID);
            setTimeout(back, 250);
        };
        setTimeout(back, 250);
    }

    function sameAs(x, o) {
        return x.kind === o.kind && norm(x.walletName) === norm(o.walletName) && (o.kind !== 'card' || !o.last4 || x.last4 === o.last4);
    }
    const norm = (v) => String(v || '').trim().toLowerCase();

    function renderImport() {
        const ui = window.wmSettings && window.wmSettings.ui;
        if (!ui || !imported) return;
        const rows = imported.items.map((o, i) => {
            const label = o.kind === 'card' ? `${o.walletName}${o.last4 ? ` \u2022\u2022${o.last4}` : ''}` : `${o.walletName}${o.merchant ? ` (${o.merchant})` : ''}`;
            const img = o.image ? `<img src="${esc(o.image)}" alt="" draggable="false">` : '<span class="wwl-imp-noimg"></span>';
            return `<label class="wm-check wwl-imp-row">${img}<input type="checkbox" data-i="${i}"${imported.picked.has(i) ? ' checked' : ''}><span>${esc(label)}</span></label>`;
        }).join('');
        const n = imported.items.length;
        els.import.innerHTML = `${ui.note(`Found ${n} card${n === 1 ? '' : 's'} in Samsung Wallet. Check the ones to keep on Today; cards already here are updated.`)}
            <div class="wwl-imp-list">${rows}</div>`;
        els.import.querySelectorAll('input[type="checkbox"]').forEach((c) => c.addEventListener('change', () => {
            const i = Number(c.dataset.i);
            if (c.checked) imported.picked.add(i); else imported.picked.delete(i);
        }));
    }

    /** A barcode picture's type and value (BarcodeDetector), or null. */
    async function readCode(dataUrl) {
        if (!dataUrl || !('BarcodeDetector' in window)) return null;
        try {
            const img = new Image();
            img.src = dataUrl;
            await img.decode();
            const det = new window.BarcodeDetector({ formats: (await window.BarcodeDetector.getSupportedFormats()).filter((f) => DETECTED[f]) });
            // Wallet's barcode picture is cut tight to the bars: give it a white quiet zone and double it
            // (without one the reader missed 10 of 12 on the Fold; with it all 12, every value matching)
            const k = 2;
            const pad = 60;
            const c = document.createElement('canvas');
            c.width = img.naturalWidth * k + pad * 2;
            c.height = img.naturalHeight * k + pad * 2;
            const g = c.getContext('2d');
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, c.width, c.height);
            g.imageSmoothingEnabled = false;
            g.drawImage(img, pad, pad, img.naturalWidth * k, img.naturalHeight * k);
            const r = await det.detect(c);
            return r && r[0] && DETECTED[r[0].format] ? { format: DETECTED[r[0].format], value: r[0].rawValue } : null;
        } catch (_) { return null; }
    }

    /** A card picture as WebP (keeps the transparent corners; a tenth of the PNG's size) for the store. */
    async function compact(dataUrl) {
        if (!dataUrl || !/^data:image\/png/.test(dataUrl)) return dataUrl;
        try {
            const img = new Image();
            img.src = dataUrl;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            const out = c.toDataURL('image/webp', 0.9);
            return out.startsWith('data:image/webp') && out.length < dataUrl.length ? out : dataUrl;
        } catch (_) { return dataUrl; }
    }

    async function importSave() {
        if (!imported) return;
        const list = items();
        const pick = imported.items.filter((_, i) => imported.picked.has(i));
        // Samsung Wallet's own order (cards, then memberships), for "Order as in Samsung Wallet"
        imported.items.forEach((o, i) => { o.walletOrder = (o.kind === 'card' ? 0 : 1000) + i; });
        const add = async () => {
            for (const o of pick) {
                let it = list.find((x) => sameAs(x, o));
                const isNew = !it;
                if (isNew) it = { id: uid(), kind: o.kind, name: o.walletName, color: COLORS[0][0] };
                it.walletName = o.walletName;
                it.walletOrder = o.walletOrder;
                if (o.image) it.photo = await compact(o.image);
                if (o.kind === 'card') {
                    if (o.last4) it.last4 = o.last4;
                    const net = norm(o.network);
                    it.network = (NETWORKS.find(([k, l]) => net.includes(k) || net.includes(norm(l))) || ['other'])[0];
                } else {
                    if (o.merchant && isNew) it.name = o.walletName;
                    const code = await readCode(o.barcodeImage);
                    if (code) { it.format = code.format; it.value = code.value; delete it.codeImage; if (it.hasCode) it.codeRemoved = true; } else if (o.barcodeImage || o.barcodeValue) {
                        it.value = o.barcodeValue || it.value || '';
                        if (o.barcodeImage) it.codeImage = o.barcodeImage;
                        it.format = it.codeImage || it.hasCode ? 'image' : (it.format || 'code128');
                    }
                    if (o.barcodeValue) it.number = o.barcodeValue;
                }
                if (isNew) list.push(it);
            }
        };
        // the wait cursor shows before the pictures are written (one frame first, then the work)
        await sh.busy(add().then(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))).then(() => save()), { delay: 0, timeout: 60000 }).catch(() => {});
        imported = null;
        layers = layers.filter((l) => l !== 'import');
        sync();
    }

    // app-scope: allow page lifetime (phone shell, loaded once from app.html; not an app package)
    window.addEventListener('androidwalletimport', (e) => {
        const d = e.detail || {};
        if (!imported) return;
        if (d.phase === 'item') importItem(d);
        else if (d.phase === 'error') { imported.reason = d.reason || 'failed'; importTake(); importDone(); } else if (d.phase === 'done') { importTake(); importDone(); }
    });
    // back from Wallet: what a paused page missed
    // app-scope: allow page lifetime (phone shell, loaded once from app.html; not an app package)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && imported && imported.running) importTake(); });

    // ---------------------------------------------------------------- car keys (wmCarKey.js)

    /** Which of the phone's Samsung Digital Key keys is my car (Lapis uses it) and which are friends'. */
    function renderKeys() {
        const ui = window.wmSettings && window.wmSettings.ui;
        const ck = window.wmCarKey;
        if (!ui || !els) return;
        const list = ck && typeof ck.known === 'function' ? ck.known() : [];
        if (!list.length) {
            els.keys.innerHTML = `${ui.sub('Car Keys')}${ui.note('No car keys yet. Each car whose Samsung Digital Key this phone holds shows here once the phone has been near it (its "Car in range" notification).')}`;
            return;
        }
        els.keys.innerHTML = `${ui.sub('My car')}
            ${list.map((k, i) => ui.radio('wwlMine', String(i), `${k.car}${k.inRange ? '  (in range)' : ''}`, k.mine)).join('')}
            ${ui.radio('wwlMine', '-', 'None of these', !list.some((k) => k.mine))}
            ${ui.note('Your car is the one Lapis Remote controls (its Lock and Unlock use this key when the car is in range). Every other key is kept as a friend\'s car: the car key bubble still locks and unlocks it.')}
            ${ui.check('wwlHideOthers', 'Hide other car keys in quick access', !!(ck.hideOthers && ck.hideOthers()))}
            ${ui.note('Quick access is the car in the title bar and its bubble: with this on they show your car only. Friends\' keys stay here.')}
            ${ui.sub('Forget a key')}
            ${list.map((k, i) => `<div class="wwl-key-row"><span>${esc(k.car)}${k.mine ? ' (my car)' : ' (friend\'s)'}</span>${ui.buttons([[`forget-${i}`, 'Forget']])}</div>`).join('')}`;
        els.keys.querySelectorAll('input[name="wwlMine"]').forEach((r) => r.addEventListener('change', () => {
            if (!r.checked) return;
            if (r.value === '-') { const m = list.find((k) => k.mine); if (m) ck.setFriend(m.car); try { localStorage.removeItem('wmCarKeyMine'); } catch (_) { /* storage off */ } } else ck.setMine(list[Number(r.value)].car);
            renderKeys();
        }));
        const hideBox = els.keys.querySelector('input[name="wwlHideOthers"]');
        if (hideBox) hideBox.addEventListener('change', () => ck.setHideOthers(hideBox.checked));
        els.keys.querySelectorAll('[data-act^="forget-"]').forEach((b) => b.addEventListener('click', () => { ck.forget(list[Number(b.dataset.act.slice(7))].car); renderKeys(); }));
    }

    function openKeys() {
        if (!sh) return;
        sh.open(APP_ID);
        if (top() !== 'keys') push('keys'); else renderKeys();
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
        delete form.item.photoRemoved;
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
        // Settings > Personal > Wallet (wmPrograms SETTINGS_LINKS), not a program in Start (Yukimi, Nov 16)
        inStart: false,
        sip: true,
        mount(p) { page = p; p.classList.add('wm-wallet'); build(); },
        show() { if (!loaded || storeNote === 'locked') load(); sync(); },
        // left without OK: an unsaved reorder is dropped
        hide() { brightness(false); stopScan(); if (pendingOrder) { revertOrder(); if (els) renderList(); } },
        historyDepth: () => layers.length,
        onBack: () => (layers.length ? pop() : false),
        // ok on every view (a settings page): the list's ok saves its order and goes back
        titleKind: () => 'ok',
        onTitleOk: () => {
            if (top() === 'edit') { saveEdit(); return true; }
            if (top() === 'import') { importSave(); return true; }
            if (layers.length) { pop(); return true; }
            if (pendingOrder) save();
            return false;
        },
        onTitleClose() { layers = []; form = null; showing = null; brightness(false); stopScan(); revertOrder(); },
        softKeys() {
            const t = top();
            if (t === 'edit') return { left: { label: 'Save', action: saveEdit }, right: { label: 'Cancel', action: pop } };
            if (t === 'import') return { left: { label: 'Add', action: importSave }, right: { label: 'Cancel', action: pop } };
            if (t === 'keys') return { left: { label: 'Done', action: pop }, right: { label: '', action: () => {} } };
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
                        { label: 'Import from Samsung Wallet...', action: importStart },
                        { label: 'Car Keys...', action: openKeys },
                        '-',
                        { label: 'Edit...', disabled: !sel, action: () => editItem(sel) },
                        { label: 'Move Up', disabled: !sel || i <= 0, action: () => move(-1) },
                        { label: 'Move Down', disabled: !sel || i >= n - 1, action: () => move(1) },
                        { label: 'Move to Top', disabled: !sel || i <= 0, action: () => moveTo('top') },
                        { label: 'Move to Bottom', disabled: !sel || i >= n - 1, action: () => moveTo('bottom') },
                        { label: 'Order as in Samsung Wallet', disabled: !items().some((x) => Number.isFinite(x.walletOrder)), action: orderAsWallet },
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
            sh.registerTodayItem({
                // no clock in it: it draws on its own changes (todayChanged), not on the shell's minute (#890)
                id: 'cards', label: TITLE, icon: ICON, after: 'lapis', wantsMinute: false, render: todayRender, titanium: todayTitanium,
                options: [{ key: 'code', label: 'Barcode', value: 'show', choices: [['show', 'Show the code (tap brightens it)'], ['hide', 'Name only']] }]
            });
        }
    }

    // the phone was unlocked: a store that was locked can be read now
    // app-scope: allow page lifetime (phone shell, loaded once from app.html; not an app package)
    window.addEventListener('melatonscreen', (e) => { if (e.detail && e.detail.on && storeNote === 'locked') { load(); todayKey = ''; todayChanged(); } });

    window.wmWallet = { open: () => sh && sh.open(APP_ID), carKeys: () => openKeys(), pay: (i) => pay(items()[i]), show: (i) => show(items()[i]) };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
