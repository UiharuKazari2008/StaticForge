/**
 * Front Gate(TM) (Yozora #828): the MMC snap-in that replaced the Site Homepage DSAP
 * (dsap://site.dreamscape.jp/ opens it). Front Gate puts a public cover site in front of
 * Dreamscape: anyone without the access key sees an ordinary static website, and the access phrase
 * typed into the cover's own search box (or the BIOS Gateway Password) lets a browser in.
 *
 *   Front Gate (Local)   the gate at a glance: on or off, the cover, how to sign in, the phrase
 *     Cover Sites        a panel of every cover site under resources/site-homepages/ (a live
 *                        preview of each); select one, Use as Cover Site / Preview in Alchemy
 *     Access Phrase      the phrase masked, Reveal / Hide, Change Access Phrase...
 *
 * Turning it on is an Aero Wizard: what changes and how to sign in (an information page), then
 * the access phrase the first time (none set yet) or the current access phrase and the admin PIN
 * when it is turned back on. Turning it off is a danger page, then the admin PIN. The server
 * checks the PIN and the phrase (modules/siteHomepageAdmin.js); admin only.
 *
 *   window.openFrontGate(node?)   node: 'root' | 'covers' | 'phrase'
 */
(function (root) {
    'use strict';

    const ID = 'frontGate';
    const TITLE = 'Front Gate';
    const ITEMS = '/static_images/vista-cpl/items';
    const ICON16 = `${ITEMS}/firewall-16.png`;
    const ICON32 = `${ITEMS}/firewall-32.png`;
    const ICON48 = `${ITEMS}/firewall-48.png`;
    const DEF = '/static_images/vista-defender';
    const VI = '/static_images/vista-icons';
    const SS = 0x50020000; // static, SS_LEFT
    const EDIT = 0x50010080; // WS_TABSTOP | ES_AUTOHSCROLL
    const PASS = 0x500100a0; // + ES_PASSWORD
    const CHECK = 0x50010003; // BS_AUTOCHECKBOX
    const COMBO = 0x50010003; // CBS_DROPDOWNLIST
    const EDGE = 0x200; // WS_EX_CLIENTEDGE

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const ws = () => root.wsClient || null;

    const state = {
        gate: null,        // the server's frontGate state
        error: '',
        revealed: null,    // the phrase while Reveal is on
        previews: new Map(), // slug -> previewPath
        pick: null         // the cover selected in Cover Sites
    };

    async function send(type, data) {
        const client = ws();
        if (!client || typeof client.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        return client.sendMessage(type, data || {}, false);
    }

    async function load(c) {
        try {
            const data = await send('get_site_homepage', {});
            state.gate = (data && data.frontGate) || {
                enabled: !!(data && data.configured), cover: data && data.homepage, phraseSet: !!(data && data.configured), phraseKnown: false,
                available: ((data && data.available) || []).map((slug) => ({ slug, title: null }))
            };
            state.error = '';
            if (!state.pick || !covers().some((x) => x.slug === state.pick)) state.pick = state.gate.cover || (covers()[0] && covers()[0].slug) || null;
        } catch (err) {
            state.error = (err && err.message) || 'The server did not answer.';
        }
        if (c) c.refresh();
    }

    const covers = () => (state.gate && Array.isArray(state.gate.available) ? state.gate.available : []);
    const coverName = (slug) => { const x = covers().find((v) => v.slug === slug); return x ? (x.title || slug) : (slug || ''); };
    const isOn = () => !!(state.gate && state.gate.enabled);

    async function previewPath(slug) {
        if (state.previews.has(slug)) return state.previews.get(slug);
        const data = await send('mint_site_homepage_preview_url', { slug });
        const p = data && data.previewPath;
        if (p) state.previews.set(slug, p);
        return p || null;
    }

    async function openPreview(slug) {
        // a fresh ticket: the thumbnail's may be spent
        state.previews.delete(slug);
        const p = await previewPath(slug);
        if (!p) throw new Error('The preview could not be started.');
        if (root.featureLoader) await root.featureLoader.loadFeature('grimoire');
        // grimoireOpenStandaloneWindow: public/scripts/comp/grimoireRemoteBrowser.js
        if (typeof root.grimoireOpenStandaloneWindow !== 'function') throw new Error('Alchemy is not available.');
        root.grimoireOpenStandaloneWindow(`${location.origin}${p}`, null, `Cover preview: ${coverName(slug)}`);
    }

    // ---- the console ----------------------------------------------------------------------------

    function nodes() {
        return [{
            id: 'root',
            name: `${TITLE} (Local)`,
            icon: ICON16,
            children: [
                { id: 'covers', name: 'Cover Sites', icon: `${ITEMS}/internet-options-16.png` },
                { id: 'phrase', name: 'Access Phrase', icon: '/static_images/vista-cpl/key-16.png' }
            ]
        }];
    }

    function phraseHtml(c) {
        const g = state.gate;
        if (!g || !g.phraseSet) return '<i>No access phrase is set.</i>';
        if (state.revealed) return `<span class="fg-phrase is-shown">${esc(state.revealed)}</span> <span class="mmc-link" data-act="hide">Hide</span>`;
        if (!g.phraseKnown) return '<span class="fg-phrase">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</span> <span class="mmc-hint">(set before it could be shown; change it to see it here)</span>';
        return '<span class="fg-phrase">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</span> <span class="mmc-link" data-act="reveal">Reveal</span>';
    }

    function rootPage(c) {
        const g = state.gate;
        if (!g) {
            return c.page(TITLE, state.error ? '' : 'Reading data, please wait...', [{ id: 'fg-load', title: 'Front Gate', body: state.error ? `<p>${c.state(false, `The gate's settings could not be read. ${state.error}`)}</p>` : '<p>Reading data, please wait...</p>' }]);
        }
        const banner = isOn()
            ? `<div class="fg-banner is-on"><img src="${DEF}/shield-ok-48.png" alt=""><div><b>Front Gate is on</b><p>Visitors without the access key see the cover site <b>${esc(coverName(g.cover))}</b>. Dreamscape's sign-in page is hidden from them.</p></div></div>`
            : `<div class="fg-banner is-off"><img src="${DEF}/shield-error-48.png" alt=""><div><b>Front Gate is off</b><p>Anyone who opens this server's address sees the Dreamscape sign-in page.</p></div></div>`;
        return c.page(TITLE, isOn() ? `Cover site: ${coverName(g.cover)}` : 'Turned off', [
            { id: 'fg-status', title: 'Status', body: banner + `<div class="mmc-buttons">${isOn()
                ? '<button type="button" class="btn-standard" data-act="disable">Turn Off Front Gate...</button>'
                : '<button type="button" class="btn-standard" data-act="enable">Turn On Front Gate...</button>'}</div>` },
            { id: 'fg-summary', title: 'Summary', body: c.props([
                ['Front Gate', isOn() ? 'On' : 'Off'],
                ['Cover site', g.cover ? esc(coverName(g.cover)) + (isOn() ? '' : ' <span class="mmc-hint">(used when Front Gate is on)</span>') : '<i>None chosen</i>'],
                ['Cover sites installed', String(covers().length)],
                ['Access phrase', phraseHtml(c)]
            ]) },
            { id: 'fg-howto', title: 'How to sign in while Front Gate is on', body: `
                <p>Open the server's address as usual. The cover site appears. Type the access phrase into the cover site's own search or lookup box and submit it: the browser is let in, Melaton starts, and you sign in with your PIN as before. The browser remembers the key, so the cover is skipped next time.</p>
                <p>Installed Melaton programs (the desktop app and the phone app) ask for the <b>Gateway Password</b> when they start without a valid key. Type the access phrase there.</p>
                <p>After 10 wrong phrases in an hour, an address is locked out of the gate for the rest of that hour.</p>` }
        ]);
    }

    function coversPage(c) {
        const list = covers();
        const g = state.gate || {};
        const tiles = list.map((x) => {
            const active = g.cover === x.slug;
            return `<div class="fg-cover${active ? ' is-active' : ''}" data-cover="${esc(x.slug)}" tabindex="0">
                <div class="fg-cover-frame"><iframe class="fg-cover-preview" data-slug="${esc(x.slug)}" tabindex="-1" loading="lazy" sandbox="allow-same-origin" title="${esc(x.title || x.slug)}"></iframe><div class="fg-cover-shield"></div></div>
                <div class="fg-cover-name" title="${esc(x.title || x.slug)}">${esc(x.title || x.slug)}</div>
                <div class="fg-cover-slug">${esc(x.slug)}${active ? (isOn() ? ' &middot; <b>Active cover</b>' : ' &middot; Chosen cover') : ''}</div>
            </div>`;
        }).join('');
        const html = `<div class="mmc-page-title"><b>Cover Sites</b><span>${list.length} installed</span></div>
            <div class="mmc-page-body fg-covers" data-mmc-scroll>${list.length ? tiles : '<p class="mmc-empty">No cover sites are installed. Each folder under resources/site-homepages/ with an index.html is one.</p>'}</div>`;
        return {
            html,
            mount: (pane) => {
                // the selection is marked here, not in the markup: a new selection must not reload the previews
                markTile(pane, c.sel || state.pick);
                pane.querySelectorAll('.fg-cover-preview').forEach((frame) => {
                    void previewPath(frame.dataset.slug).then((p) => { if (p && frame.isConnected) frame.src = p; }).catch(() => {});
                });
            }
        };
    }

    function markTile(pane, slug) {
        pane.querySelectorAll('[data-cover]').forEach((t) => t.classList.toggle('is-selected', t.dataset.cover === slug));
    }

    function phrasePage(c) {
        const g = state.gate;
        const body = !g ? '<p>Reading data, please wait...</p>' : `${c.overview('/static_images/vista-cpl/key-32.png', [
            'The access phrase opens the gate. Type it into the cover site\'s search box, or as the Gateway Password in an installed Melaton program.',
            'Changing it signs every browser and program out of the gate: each one must enter the new phrase once.'
        ])}<div class="fg-phrase-row">${c.props([['Access phrase', phraseHtml(c)]])}</div>
            <div class="mmc-buttons"><button type="button" class="btn-standard" data-act="change-phrase">Change Access Phrase...</button></div>`;
        return c.page('Access Phrase', g && g.phraseSet ? (g.phraseKnown ? 'Set' : 'Set (hidden)') : 'Not set', [{ id: 'fg-phrase', title: 'Access Phrase', body }]);
    }

    function commands(node) {
        const out = [];
        const g = state.gate;
        if (node.id === 'root' || node.id === 'covers') {
            out.push(isOn()
                ? { text: 'Turn Off Front Gate...', action: 'disable', icon: `${DEF}/shield-warning-32.png` }
                : { text: 'Turn On Front Gate...', action: 'enable', icon: `${DEF}/shield-ok-32.png`, disabled: !g || !covers().length });
        }
        if (node.id === 'root' || node.id === 'phrase') {
            out.push({ text: 'Change Access Phrase...', action: 'change-phrase', disabled: !g });
            if (g && g.phraseKnown) out.push(state.revealed ? { text: 'Hide Access Phrase', action: 'hide' } : { text: 'Reveal Access Phrase', action: 'reveal' });
        }
        return out;
    }

    function selCommands(node, key) {
        if (node.id !== 'covers' || !key) return null;
        const g = state.gate || {};
        const active = g.cover === key;
        const items = [];
        if (isOn()) items.push({ text: 'Use as Cover Site', action: 'use-cover', disabled: active });
        else items.push({ text: 'Turn On Front Gate with This Cover...', action: 'enable' });
        items.push({ text: 'Preview in Alchemy', action: 'preview' });
        return { title: coverName(key), items };
    }

    async function action(a, c) {
        switch (a) {
            case 'refresh': state.previews.clear(); await load(c); return true;
            case 'reveal': {
                const data = await send('get_site_access_phrase', {});
                state.revealed = data && data.phrase ? data.phrase : null;
                if (!state.revealed) await c.box('<p>The access phrase was set before Front Gate could keep it, so it cannot be shown. Change it to see the new one here.</p>', null, { icon: 'info' });
                c.refresh();
                return true;
            }
            case 'hide': state.revealed = null; c.refresh(); return true;
            case 'enable': enableWizard(c); return true;
            case 'disable': disableWizard(c); return true;
            case 'change-phrase': phraseWizard(c); return true;
            case 'use-cover': {
                const slug = c.sel;
                if (!slug) return true;
                const data = await send('set_site_homepage', { slug, mode: 'cover' });
                if (data && data.frontGate) state.gate = data.frontGate;
                c.note(`The cover site is now ${coverName(slug)}.`);
                c.refresh();
                return true;
            }
            case 'preview': await openPreview(c.sel || state.pick); return true;
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('front-gate'); return true;
            default: return false;
        }
    }

    // ---- wizards ----------------------------------------------------------------------------------

    function templates() {
        const T = {
            // what changes when Front Gate is on, and the cover site
            'fg:info': { t: '', w: 300, h: 200, f: ['MS Shell Dlg', 8], s: 0, c: [
                [100, 'S', 0, 0, 290, 152, SS, '', 0],
                [101, 'S', 0, 160, 70, 8, SS, '&Cover site:', 0],
                [102, 'C', 72, 158, 218, 120, COMBO, '', 0]
            ] },
            // the first time: the access phrase
            'fg:newphrase': { t: '', w: 300, h: 200, f: ['MS Shell Dlg', 8], s: 0, c: [
                [200, 'S', 0, 0, 290, 34, SS, 'Visitors type this phrase into the cover site\'s search box to reach Dreamscape. Use words nobody would search for on that site. Up to 512 characters.', 0],
                [201, 'S', 0, 44, 290, 8, SS, '&Access phrase:', 0],
                [202, 'E', 0, 55, 220, 14, PASS, '', EDGE],
                [203, 'S', 0, 76, 290, 8, SS, 'C&onfirm access phrase:', 0],
                [204, 'E', 0, 87, 220, 14, PASS, '', EDGE],
                [205, 'B', 0, 108, 200, 10, CHECK, '&Show characters', 0],
                [206, 'S', 0, 126, 290, 24, SS, '', 0]
            ] },
            // turning it back on: the current phrase and the admin PIN
            'fg:verify': { t: '', w: 300, h: 200, f: ['MS Shell Dlg', 8], s: 0, c: [
                [300, 'S', 0, 0, 290, 26, SS, 'To turn Front Gate back on, type the access phrase it had and the administrator\'s PIN.', 0],
                [301, 'S', 0, 34, 290, 8, SS, '&Access phrase:', 0],
                [302, 'E', 0, 45, 220, 14, PASS, '', EDGE],
                [303, 'S', 0, 66, 290, 8, SS, 'Administrator &PIN:', 0],
                [304, 'E', 0, 77, 120, 14, PASS, '', EDGE],
                [305, 'S', 0, 98, 290, 34, SS, 'Forgot the access phrase? Cancel, then use Change Access Phrase in Front Gate first.', 0],
                [306, 'S', 0, 136, 290, 24, SS, '', 0]
            ] },
            'fg:done': { t: '', w: 300, h: 200, f: ['MS Shell Dlg', 8], s: 0, c: [
                [400, 'S', 0, 0, 290, 160, SS, '', 0]
            ] },
            // turning it off: the danger page, then the PIN
            'fg:danger': { t: '', w: 300, h: 200, f: ['MS Shell Dlg', 8], s: 0, c: [
                [500, 'S', 0, 0, 290, 170, SS, '', 0]
            ] },
            'fg:pin': { t: '', w: 300, h: 200, f: ['MS Shell Dlg', 8], s: 0, c: [
                [600, 'S', 0, 0, 290, 18, SS, 'Type the administrator\'s PIN to turn off Front Gate.', 0],
                [601, 'S', 0, 26, 290, 8, SS, 'Administrator &PIN:', 0],
                [602, 'E', 0, 37, 120, 14, PASS, '', EDGE],
                [603, 'S', 0, 60, 290, 24, SS, '', 0]
            ] },
            // a new access phrase
            'fg:change': { t: '', w: 300, h: 200, f: ['MS Shell Dlg', 8], s: 0, c: [
                [700, 'S', 0, 0, 290, 34, SS, 'Every browser and Melaton program that is let in now must enter the new phrase once. Up to 512 characters.', 0],
                [701, 'S', 0, 44, 290, 8, SS, '&New access phrase:', 0],
                [702, 'E', 0, 55, 220, 14, PASS, '', EDGE],
                [703, 'S', 0, 76, 290, 8, SS, 'C&onfirm new access phrase:', 0],
                [704, 'E', 0, 87, 220, 14, PASS, '', EDGE],
                [705, 'B', 0, 108, 200, 10, CHECK, '&Show characters', 0],
                [706, 'S', 0, 126, 290, 24, SS, '', 0]
            ] }
        };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, T);
    }

    function wizardApi() {
        const api = root.vistaDialogTemplate;
        if (!api || typeof api.openWizard !== 'function') throw new Error('The wizard could not be shown.');
        templates();
        return api;
    }

    /** A message line on a page (#c00 with Vista's error icon, as a wizard's inline error). */
    function pageError(ctx, id, key, text) {
        ctx.html(id, text ? `<span class="fg-wiz-error"><img src="${VI}/error-16.png" alt="">${esc(text)}</span>` : '', key);
    }

    function showChars(ctx, key, box, ids) {
        const box0 = ctx.el(box, key);
        if (!box0) return;
        box0.addEventListener('change', () => ids.forEach((id) => { const e = ctx.el(id, key); if (e) e.type = box0.checked ? 'text' : 'password'; }));
    }

    function infoHtml() {
        return `<div class="fg-wiz-text">
            <p>While Front Gate is on, anyone who opens this server's address without the access key sees the cover site instead of Dreamscape.</p>
            <p><b>To sign in:</b> open the address, type the access phrase into the cover site's search box and submit it. Melaton starts and asks for your PIN as before. Installed Melaton programs ask for it as the Gateway Password.</p>
            <p><b>What may not work as expected:</b> scripts, custom API clients and programs that are not Melaton's own get the cover site (web pages and "not found" answers) instead of Dreamscape's API until they send the access key (the <span class="fg-nowrap">X-Dreamscape-Access</span> header, or <span class="fg-nowrap">?k=</span> in the address). Application keys still work from this computer itself. The MCP connector, replication partners and Apocrypha links keep their own paths. Live connections without the key are refused.</p>
        </div>`;
    }

    function enableWizard(c) {
        const g = state.gate;
        if (!g) return;
        const api = wizardApi();
        const first = !g.phraseSet;
        const pickInit = (c.node === 'covers' && c.sel) || g.cover || state.pick || (covers()[0] && covers()[0].slug);
        let chosen = pickInit;
        let phrase = '';
        api.openWizard({
            id: 'frontGateEnableWizard',
            title: 'Turn On Front Gate',
            icon: ICON32,
            owner: c.modal,
            init: (ctx) => {
                ctx.html(100, infoHtml(), 'fg:info');
                const sel = ctx.el(102, 'fg:info');
                if (sel) {
                    sel.innerHTML = covers().map((x) => `<option value="${esc(x.slug)}"${x.slug === pickInit ? ' selected' : ''}>${esc(x.title || x.slug)}</option>`).join('');
                }
                showChars(ctx, 'fg:newphrase', 205, [202, 204]);
            },
            pages: [
                { key: 'fg:info', instruction: 'Before you turn on Front Gate', next: (ctx) => { chosen = ctx.get(102, 'fg:info') || chosen; return first ? 'fg:newphrase' : 'fg:verify'; } },
                {
                    key: 'fg:newphrase', instruction: 'Choose an access phrase', nextText: 'Turn On',
                    next: async (ctx) => {
                        const a = ctx.get(202, 'fg:newphrase') || '';
                        const b = ctx.get(204, 'fg:newphrase') || '';
                        if (!a.trim()) { pageError(ctx, 206, 'fg:newphrase', 'Type an access phrase.'); return false; }
                        if (a !== b) { pageError(ctx, 206, 'fg:newphrase', 'The phrases do not match. Type the same phrase in both boxes.'); return false; }
                        try {
                            const data = await send('set_site_homepage', { slug: chosen, phrase: a });
                            if (data && data.frontGate) state.gate = data.frontGate;
                            phrase = a;
                        } catch (err) { pageError(ctx, 206, 'fg:newphrase', (err && err.message) || 'Front Gate could not be turned on.'); return false; }
                        return 'fg:done';
                    }
                },
                {
                    key: 'fg:verify', instruction: 'Confirm that it is you', nextText: 'Turn On',
                    next: async (ctx) => {
                        const p = ctx.get(302, 'fg:verify') || '';
                        const pin = ctx.get(304, 'fg:verify') || '';
                        if (!p) { pageError(ctx, 306, 'fg:verify', 'Type the access phrase.'); return false; }
                        if (!pin) { pageError(ctx, 306, 'fg:verify', 'Type the administrator\'s PIN.'); return false; }
                        try {
                            const data = await send('set_site_homepage', { slug: chosen, phrase: p, adminPin: pin });
                            if (data && data.frontGate) state.gate = data.frontGate;
                            phrase = p;
                        } catch (err) {
                            pageError(ctx, 306, 'fg:verify', (err && err.message) || 'Front Gate could not be turned on.');
                            const pinEl = ctx.el(304, 'fg:verify');
                            if (pinEl) { pinEl.value = ''; pinEl.focus(); }
                            return false;
                        }
                        return 'fg:done';
                    }
                },
                {
                    key: 'fg:done', instruction: 'Front Gate is on', finish: true, noBack: true,
                    show: (ctx) => ctx.html(400, `<div class="fg-wiz-text"><div class="fg-wiz-banner is-on"><img src="${DEF}/shield-ok-32.png" alt=""><span>Visitors now see <b>${esc(coverName(chosen))}</b>.</span></div>
                        <p>This browser stays signed in. Other browsers and Melaton programs need the access phrase${phrase ? '' : ''} once.</p>
                        <p>To sign in from somewhere else, open the address and type the access phrase into the cover site's search box.</p></div>`, 'fg:done')
                }
            ],
            finish: () => { state.revealed = null; void load(c); }
        });
    }

    function disableWizard(c) {
        const api = wizardApi();
        api.openWizard({
            id: 'frontGateDisableWizard',
            title: 'Turn Off Front Gate',
            icon: ICON32,
            owner: c.modal,
            init: (ctx) => {
                ctx.html(500, `<div class="fg-wiz-text"><div class="fg-wiz-banner is-danger"><img src="${DEF}/shield-error-48.png" alt=""><span><b>Your sign-in page will be open to the Internet.</b></span></div>
                    <p>With Front Gate off, anyone who finds this server's address sees the Dreamscape sign-in page instead of the cover site, and scanners can find Dreamscape's API.</p>
                    <p>Your PIN is then the only thing between a stranger and your workspaces, prints and accounts. Turn it off only while you are fixing something, and turn it back on when you are done.</p>
                    <p>The cover site and the access phrase are kept for when you turn it back on.</p></div>`, 'fg:danger');
            },
            pages: [
                { key: 'fg:danger', instruction: 'Are you sure you want to turn off Front Gate?', nextText: 'Turn Off' },
                {
                    key: 'fg:pin', instruction: 'Confirm that it is you', finish: true,
                    show: (ctx) => { const n = ctx.content.querySelector('.vdt-wizard-next'); if (n) n.textContent = 'Turn Off'; }
                }
            ],
            finish: async (ctx) => {
                const pin = ctx.get(602, 'fg:pin') || '';
                if (!pin) { pageError(ctx, 603, 'fg:pin', 'Type the administrator\'s PIN.'); return false; }
                try {
                    const data = await send('clear_site_homepage', { adminPin: pin });
                    if (data && data.frontGate) state.gate = data.frontGate;
                } catch (err) {
                    pageError(ctx, 603, 'fg:pin', (err && err.message) || 'Front Gate could not be turned off.');
                    const pinEl = ctx.el(602, 'fg:pin');
                    if (pinEl) { pinEl.value = ''; pinEl.focus(); }
                    return false;
                }
                state.revealed = null;
                void load(c);
                return true;
            }
        });
    }

    function phraseWizard(c) {
        const api = wizardApi();
        api.openWizard({
            id: 'frontGatePhraseWizard',
            title: 'Change Access Phrase',
            icon: ICON32,
            owner: c.modal,
            init: (ctx) => showChars(ctx, 'fg:change', 705, [702, 704]),
            pages: [{
                key: 'fg:change', instruction: 'Type a new access phrase', finish: true,
                show: (ctx) => { const n = ctx.content.querySelector('.vdt-wizard-next'); if (n) n.textContent = 'Change Phrase'; }
            }],
            finish: async (ctx) => {
                const a = ctx.get(702, 'fg:change') || '';
                const b = ctx.get(704, 'fg:change') || '';
                if (!a.trim()) { pageError(ctx, 706, 'fg:change', 'Type an access phrase.'); return false; }
                if (a !== b) { pageError(ctx, 706, 'fg:change', 'The phrases do not match. Type the same phrase in both boxes.'); return false; }
                try {
                    const data = await send('set_site_access_phrase', { phrase: a });
                    if (data && data.frontGate) state.gate = data.frontGate;
                } catch (err) { pageError(ctx, 706, 'fg:change', (err && err.message) || 'The access phrase was not changed.'); return false; }
                state.revealed = null;
                c.note('The access phrase was changed.');
                void load(c);
                return true;
            }
        });
    }

    // ---- open -------------------------------------------------------------------------------------

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            nodes,
            page: (node, c) => (node.id === 'covers' ? coversPage(c) : node.id === 'phrase' ? phrasePage(c) : rootPage(c)),
            commands,
            selCommands,
            toolbar: (node) => (node.id === 'root' ? [] : [{ id: 'refresh', i: 3, title: 'Refresh' }]),
            action,
            rowOpen: () => {},
            onSelectRow: (key) => { state.pick = key; },
            status: (node) => {
                if (state.error) return 'The server did not answer.';
                if (!state.gate) return 'Reading data, please wait...';
                if (node.id === 'covers') return `${covers().length} cover site${covers().length === 1 ? '' : 's'}`;
                return isOn() ? 'Front Gate is on' : 'Front Gate is off';
            },
            about: { version: '1.0.0', lines: ['Front Gate puts a cover site in front of Dreamscape.'] },
            onOpen: (c) => {
                // the cover panel is not a list: a tile picks like a row
                const pick = (ev) => {
                    const tile = ev.target.closest('[data-cover]');
                    if (!tile) return;
                    c.selectRow(tile.dataset.cover);
                    markTile(c.el('.mmc-result'), tile.dataset.cover);
                };
                c.el('.mmc-result').addEventListener('click', pick);
                c.el('.mmc-result').addEventListener('mousedown', (ev) => { if (ev.button === 2) pick(ev); });
                c.el('.mmc-result').addEventListener('dblclick', (ev) => {
                    const tile = ev.target.closest('[data-cover]');
                    if (tile) void action('preview', c).catch(() => {});
                });
                void load(c);
            },
            onClose: () => { state.revealed = null; }
        };
    }

    async function openFrontGate(node) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        return root.mmcConsole.open(def(), node ? { node } : {});
    }

    root.openFrontGate = openFrontGate;
    root.mmcFrontGate = { open: openFrontGate, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
