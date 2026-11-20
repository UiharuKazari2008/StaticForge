/**
 * Sharing a folder on a DreamOS computer, as Vista shares one (#910, Yukimi Nov 20 2026: "you have to share a folder
 * like in Windows"). The shares are kept by the machine itself (CaféReady shares.rs, through the shell bridge's
 * window.DreamOSShares); other computers see them in Explorer's Network (explorerNetwork.js, modules/networkShares.js).
 * Every dialog is Vista's own template from the VM (ntshrui.dll.mui, aclui.dll.mui; ~/.cache/vista-vm/netshare):
 *
 *   File Sharing wizard   Share... on a folder's menu or the command bar: "Choose people to share with" (ntshrui 3002:
 *                         the people combo, Add, Name / Permission Level with Reader, Contributor, Co-owner, Remove; the
 *                         owner is Owner), "Sharing items..." (3004), "Your folder is shared." (3005, the \\NAME\share
 *                         link, e-mail / copy). A folder already shared opens on "This folder is already shared." (3001:
 *                         Change sharing permissions / Stop sharing), and Stop sharing ends on "You have stopped sharing
 *                         the selected folder."
 *   Properties            the folder's General page and Sharing (ntshrui 1000): Shared / Not Shared, Network Path,
 *                         Share..., Advanced Sharing..., Password Protection
 *   Advanced Sharing      ntshrui 1009: Share this folder, Share name (Add / Remove another name, ntshrui 1018 New
 *                         Share), Limit the number of simultaneous users to (default 10), Comments, Permissions
 *   Permissions for X     aclui 103 as ntshrui lays it out (one "Share Permissions" tab): the names, Full Control /
 *                         Change / Read with Allow and Deny. A share made here starts with Everyone: Read; one made by
 *                         the wizard leaves the share open and restricts by its people.
 *
 * People are this server's accounts: the Administrator (an admin session, by the name User Accounts gives it), the Guest
 * (the guest PIN) and Everyone. Administrators are no bypass: what a share's people and permissions allow is what each
 * account gets, and the server and the machine both check it.
 *
 *   vistaFileSharing.openWizard({ drive, path, name, location }, { owner })
 *   vistaFileSharing.openProperties({ drive, path, name, location, letter }, { owner })
 *   vistaFileSharing.sharesOf(drive, path)     the shares of that folder (from DreamOSShares.get())
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-file-sharing';
    const SHIELD = '/static_images/vista-cpl/shield-uac-16.png';
    const LEVELS = [['reader', 'Reader'], ['contributor', 'Contributor'], ['coowner', 'Co-owner']];
    const LEVEL_NAME = { reader: 'Reader', contributor: 'Contributor', coowner: 'Co-owner', owner: 'Owner' };
    // ntshrui 3746-3749
    const LEVEL_TIP = {
        reader: 'Reader allows people to open, but not change files',
        contributor: 'Contributor allows people to create new files and change them, but only open other files',
        coowner: 'Co-owner allows people to open, change and create files',
        owner: 'Owner allows people to open, change and create files'
    };
    const RIGHTS = [['full', 'Full Control'], ['change', 'Change'], ['read', 'Read']];
    const PASSWORD_TEXT = 'People must have a user account and password for this computer to access shared folders.\n\nTo change this setting, use the <a>Network and Sharing Center</a>.';

    // ntshrui.dll.mui / aclui.dll.mui dialog templates (the VM's, ~/.cache/vista-vm/netshare/templates.json)
    const TPL = {
        "ntshrui:1000": {"t":"","w":227,"h":234,"f":["MS Shell Dlg",8],"s":2160599112,"c":[[-1,"B",6,7,215,83,1342177287,"Network File and Folder Sharing",0],[1021,"S",13,21,21,20,1342179854,"",0],[1058,"S",43,21,171,9,1342308480,"Documents",0],[4407,"S",43,30,171,9,1342308352,"Shared",0],[-1,"S",13,46,199,8,1342308352,"&Network Path:",0],[4406,"E",13,56,199,12,1342179456,"",0],[1059,"B",13,69,49,14,1342242816,"&Share...",0],[-1,"B",6,96,215,58,1342177287,"Advanced Sharing",0],[-1,"S",13,108,201,25,1342308352,"Set custom permissions, create multiple shares, and set other advanced sharing options.",0],[1060,"B",13,133,95,14,1342242816,"&Advanced Sharing...",0],[1056,"B",6,160,215,60,1342177287,"Password Protection",0],[1061,"SysLink",13,174,201,40,1342242816,"",0]]},
        "ntshrui:1009": {"t":"Advanced Sharing","w":234,"h":204,"f":["MS Shell Dlg",8],"s":2160591048,"c":[[1020,"B",10,10,204,8,1342242819,"&Share this folder",0],[-1,"B",10,25,214,151,1342177287,"Settings",0],[1003,"S",22,38,41,8,1342308352,"S&hare name:",0],[1001,"E",22,49,192,12,1350631552,"",0],[1015,"C",22,49,192,76,1344340227,"",0],[1017,"B",22,65,42,14,1342242816,"&Add",0],[1012,"B",64,65,42,14,1342242816,"&Remove",0],[1016,"S",22,84,147,18,1342308352,"&Limit the number of simultaneous users to:",0],[1011,"E",176,84,37,12,1350639744,"",0],[1010,"msctls_updown32",202,84,11,12,1342177462,"",0],[1004,"S",22,105,66,8,1342308352,"C&omments:",0],[1002,"E",22,113,192,36,1350631492,"",0],[1008,"B",22,153,54,14,1342242816,"&Permissions",0],[1019,"B",79,153,54,14,1342242816,"&Caching",0],[1,"B",66,183,50,14,1342242817,"OK",0],[2,"B",120,183,50,14,1342242816,"Cancel",0],[1024,"B",174,183,50,14,1342242816,"Apply",0]]},
        "ntshrui:1018": {"t":"New Share","w":249,"h":83,"f":["MS Shell Dlg",8],"s":2429026496,"c":[[1003,"S",6,8,46,8,1342308352,"&Share name:",0],[1001,"E",56,6,125,12,1350631552,"",0],[1004,"S",6,22,46,8,1342308352,"&Description:",0],[1002,"E",56,20,125,12,1350631552,"",0],[1005,"B",6,37,175,42,1342308359,"User limit",0],[1006,"B",12,49,87,10,1342373897,"Ma&ximum allowed",0],[1007,"B",12,62,110,10,1342177289,"Allo&w this number of users:",0],[1011,"E",125,60,43,12,1350639744,"",0],[1010,"msctls_updown32",81,60,6,12,1342177462,"",0],[1,"B",189,6,54,14,1342373889,"OK",0],[2,"B",189,23,54,14,1342242816,"Cancel",0],[1008,"B",189,40,54,14,1342242816,"&Permissions",0]]},
        "ntshrui:3001": {"t":"Property Page","w":317,"h":143,"f":["Segoe UI",9],"s":1086324808,"c":[[4051,"B",0,0,270,38,1342242830,"&Change sharing permissions\nChoose this to add people, remove people, or change permissions.",0],[4050,"B",0,43,270,38,1342242830,"&Stop sharing\nChoose this to remove the permissions for all the people you have shared with.",0]]},
        "ntshrui:3002": {"t":"Property Page","w":317,"h":143,"f":["Segoe UI",9],"s":1086324808,"c":[[4004,"SysLink",0,0,317,27,1342242816,"",0],[4005,"C",0,27,241,12,1344340290,"",0],[4015,"B",244,27,50,12,1342242817,"&Add",0],[4006,"SysListView32",0,43,294,86,1350631437,"",0],[4016,"SysLink",0,132,317,9,1342242816,"<a href=\"Help\">Tell me about different ways to share in Melaton.</a>",0]]},
        "ntshrui:3004": {"t":"Property Page","w":317,"h":143,"f":["Segoe UI",9],"s":1086324808,"c":[[-1,"S",0,0,294,8,1342308352,"This may take a few minutes.",0],[4021,"msctls_progress32",58,20,201,8,1350565888,"",0]]},
        "ntshrui:3005": {"t":"Property Page","w":317,"h":143,"f":["Segoe UI",9],"s":1086324808,"c":[[4101,"SysLink",0,0,317,27,1342242816,"",0],[4102,"SysListView32",0,27,317,106,1350631424,"",32],[4103,"S",0,122,9,9,1342177795,"",0],[4104,"SysLink",12,122,309,9,1342242816,"",0],[4105,"SysLink",0,134,317,9,1342242816,"",0]]},
        "aclui:103": {"t":"Security","w":227,"h":215,"f":["MS Shell Dlg",8],"s":1354760256,"c":[[1014,"S",7,7,50,8,1208090624,"Object name:",0],[1015,"E",60,7,160,8,1207961728,"",0],[1016,"S",7,30,8,8,1207959555,"",0],[1012,"S",20,30,199,32,1073872896,"The requested security information is either unavailable or can’t be displayed.",0],[1013,"S",7,25,213,8,1342308352,"&Group or user names:",0],[1000,"SysListView32",7,35,213,43,1344389149,"",512],[6040,"E",7,35,213,43,1084229636,"",0],[6027,"S",7,82,150,8,1208090624,"To change permissions, click Edit.",0],[1001,"B",116,82,50,14,1342242816,"A&dd...",0],[1002,"B",170,82,50,14,1342242816,"&Remove",0],[1003,"B",160,82,60,14,1208025088,"&Edit...",0],[1010,"S",176,104,32,8,1342308353,"Deny",0],[1009,"S",135,104,32,8,1342308353,"Allow",0],[6024,"S",7,96,105,16,1342308352,"",0],[1008,"S",7,104,105,8,1342308352,"",0],[1004,"CHECKLIST_ACLUI",7,114,213,61,1342177282,"",66048],[1005,"B",160,179,60,14,1342242816,"Ad&vanced",0],[6026,"S",7,179,148,24,1342308352,"For special permissions or advanced settings, click Advanced.",0],[6021,"Link Window",7,204,213,8,1342242816,"<A>Learn about access control and permissions</A>",0]]},
        // the folder's General page (shell32's, laid out as the VM draws it, props-general.png): Melaton keeps no
        // creation time or attributes for a drive's folder, so the page shows what the drive knows
        "melaton:folder-general": {"t":"General","w":227,"h":234,"f":["MS Shell Dlg",8],"s":2160599112,"c":[[1021,"S",9,8,21,20,1342177283,"",0],[1022,"E",57,11,163,12,1350633600,"",0],[-1,"S",7,32,213,1,1342177296,"",0],[-1,"S",7,41,48,8,1342308352,"Type:",0],[1030,"S",57,41,160,8,1342308352,"",0],[-1,"S",7,57,48,8,1342308352,"Location:",0],[1031,"S",57,57,160,8,1342308352,"",0],[-1,"S",7,73,48,8,1342308352,"Size:",0],[1032,"S",57,73,160,8,1342308352,"",0],[-1,"S",7,89,48,8,1342308352,"Contains:",0],[1034,"S",57,89,160,8,1342308352,"",0],[-1,"S",7,104,213,1,1342177296,"",0],[-1,"S",7,113,48,8,1342308352,"Modified:",0],[1035,"S",57,113,160,8,1342308352,"",0]]}
    };

    let cssDone = false;
    function kit() {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : Promise.resolve();
        return Promise.resolve(ready).then(() => {
            if (!root.vistaDialogTemplate) throw new Error('vistaDialogTemplate is not loaded');
            root.vistaDialogTemplates = root.vistaDialogTemplates || {};
            Object.assign(root.vistaDialogTemplates, TPL);
            if (!cssDone && doc) {
                cssDone = true;
                const link = doc.createElement('link');
                link.rel = 'stylesheet';
                link.href = '/css/vista-file-sharing.css';
                doc.head.appendChild(link);
            }
            return root.vistaDialogTemplate;
        });
    }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function message(text, title, icon) {
        if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
        const cls = { error: 'fas fa-circle-xmark', warning: 'fas fa-triangle-exclamation', info: 'fas fa-circle-info' }[icon || 'error'];
        return root.showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-primary' }], null, { title: title || 'File Sharing', icon: cls });
    }

    // ---- the machine's shares ------------------------------------------------------------------------------------

    const S = () => root.DreamOSShares || null;
    function state() {
        try { const s = S(); return (s && typeof s.get === 'function' && s.get()) || {}; } catch (_) { return {}; }
    }
    function sharesOf(drive, path) {
        const st = state();
        return (Array.isArray(st.shares) ? st.shares : []).filter((x) => x.drive === drive && (x.path || '/') === (path || '/'));
    }
    function computerName() {
        const st = state();
        return String(st.computerName || 'THIS-COMPUTER').toUpperCase();
    }
    function uncOf(share) { return `\\\\${computerName()}\\${share}`; }
    /** The bridge's answer, or throws its error (with Vista's words where it has them). */
    async function ask(promise) {
        const r = await promise;
        if (!r || (typeof r.error === 'string' && r.error)) throw Object.assign(new Error((r && r.error) || 'The computer did not answer.'), { code: r && r.code });
        return r;
    }

    // ---- the accounts (meletonAccounts.js) ---------------------------------------------------------------------------

    const ACC = () => root.meletonAccounts || null;
    function me() {
        const a = ACC();
        const cur = a && typeof a.current === 'function' ? a.current() : 'administrator';
        return cur === 'guest' ? 'guest' : 'administrator';
    }
    function accountName(account) {
        if (account === 'everyone') return 'Everyone';
        const a = ACC();
        const n = a && typeof a.name === 'function' ? a.name(account) : '';
        return n || (account === 'guest' ? 'Guest' : 'Administrator');
    }
    function accountIcon(account) { return `${ART}/${account === 'everyone' ? 'group' : 'user'}-16.png`; }
    /** The wizard's combo: the accounts, then Everyone (ntshrui 3329 "%1 (All users in this list)"). */
    function comboAccounts() {
        return [
            { value: 'administrator', text: accountName('administrator') },
            { value: 'guest', text: accountName('guest') },
            { value: 'everyone', text: 'Everyone (All users in this list)' }
        ];
    }
    function accountFromText(text) {
        const t = String(text || '').trim().toLowerCase();
        if (!t) return null;
        if (t === 'everyone' || t.startsWith('everyone (')) return 'everyone';
        for (const a of ['administrator', 'guest']) if (t === accountName(a).toLowerCase() || t === a) return a;
        return null;
    }

    // ---- the File Sharing wizard -------------------------------------------------------------------------------------

    const P_ALREADY = 'ntshrui:3001';
    const P_PEOPLE = 'ntshrui:3002';
    const P_PROGRESS = 'ntshrui:3004';
    const P_DONE = 'ntshrui:3005';

    function linkHtml(text) {
        // <a href="X">label</a> / <A>label</A> -> the kit's link buttons, data-link = X (or the label)
        return String(text).split(/(<a[^>]*>.*?<\/a>)/i).map((part) => {
            const m = /^<a([^>]*)>(.*?)<\/a>$/i.exec(part);
            if (!m) return esc(part).replace(/\n/g, '<br>');
            const h = /href\s*=\s*"([^"]*)"/i.exec(m[1]);
            return `<button type="button" class="tbp-link vdt-link" data-link="${esc(h ? h[1] : m[2])}">${esc(m[2])}</button>`;
        }).join('');
    }

    async function openWizard(folder, opts = {}) {
        const V = await kit();
        const owner = opts.owner || null;
        const existing = sharesOf(folder.drive, folder.path);
        // the people: the owner first (Owner), then what the folder's share has
        const ownerAccount = me();
        let people = [{ account: ownerAccount, level: 'owner' }];
        const shared = existing[0];
        if (shared && Array.isArray(shared.people)) {
            people = shared.people.slice();
            if (!people.some((p) => p.level === 'owner')) people.unshift({ account: ownerAccount, level: 'owner' });
        }
        let result = null;
        let stopping = false;
        let resolveDone;
        const done = new Promise((r) => { resolveDone = r; });

        const drawPeople = (ctx) => {
            const lv = ctx.holder(4006, P_PEOPLE);
            if (!lv) return;
            lv.querySelector('.vdt-lv-header').innerHTML = '<div class="vdt-lv-col" style="width:357px">Name</div><div class="vdt-lv-col">Permission Level</div>';
            // Everyone sorts first, then by name (the VM after Add)
            const rows = people.slice().sort((a, b) => (a.account === 'everyone' ? -1 : b.account === 'everyone' ? 1 : accountName(a.account).localeCompare(accountName(b.account))));
            lv.querySelector('.vdt-lv-body').innerHTML = rows.map((p) => `<div class="vdt-lv-row vfs-person" data-account="${esc(p.account)}">`
                + `<span class="vfs-person-name" style="width:357px"><img src="${accountIcon(p.account)}" alt="">${esc(accountName(p.account))}</span>`
                + `<span class="vfs-person-level"><button type="button" class="vfs-level" data-account="${esc(p.account)}" title="${esc(LEVEL_TIP[p.level] || '')}">${esc(LEVEL_NAME[p.level] || p.level)}<span class="vfs-level-arrow" aria-hidden="true"></span></button></span></div>`).join('');
            const cm = root.contextMenu;
            lv.querySelectorAll('.vfs-level').forEach((b) => {
                const acc = b.dataset.account;
                const p = people.find((x) => x.account === acc);
                // ntshrui MENU 5001: Reader / Contributor / Co-owner / Remove; the current level checked; the owner's row no ✓
                if (cm && typeof cm.attachClickMenuToElement === 'function') {
                    cm.attachClickMenuToElement(b, {
                        sections: [{ type: 'list', items: LEVELS.map(([v, t]) => ({ text: t, action: v, checked: p.level === v, showIndicator: true, indicatorMark: 'check' }))
                            .concat([{ separator: true }, { text: 'Remove', action: 'remove', disabled: p.level === 'owner' }]) }],
                        onAction: (a) => {
                            if (a === 'remove') people = people.filter((x) => x.account !== acc);
                            else p.level = a;
                            drawPeople(ctx);
                        }
                    });
                }
            });
        };

        const share = async () => {
            const s = S();
            const list = people.map((p) => ({ account: p.account, level: p.level }));
            if (shared) await ask(s.update(shared.name, { people: list }));
            else await ask(s.share({ drive: folder.drive, path: folder.path, people: list }));
            const now = sharesOf(folder.drive, folder.path);
            const st = now[0] || (await (s.refresh ? s.refresh() : null), sharesOf(folder.drive, folder.path)[0]);
            return st ? st.name : folder.name;
        };

        V.openWizard({
            id: 'vistaFileSharingWizard',
            title: 'File Sharing',
            icon: `${ART}/shared-folder-ntshrui-116-16.png`,
            owner,
            // the first page is where it opens: "already shared" for a folder that is
            pages: ((list) => (existing.length ? list : [list[1], list[0]].concat(list.slice(2))))([
                {
                    key: P_ALREADY, instruction: 'This folder is already shared.', noNext: true,
                    show: (ctx) => { ctx.holder(4050, P_ALREADY).classList.add('vfs-shield-link'); }
                },
                {
                    key: P_PEOPLE, instruction: 'Choose people to share with', nextText: 'Share',
                    show: (ctx) => {
                        const n = ctx.content.querySelector('.vdt-wizard-next');
                        if (n) n.innerHTML = `<img class="vfs-shield" src="${SHIELD}" alt="">S<u>h</u>are`;
                        drawPeople(ctx);
                    },
                    next: () => P_PROGRESS
                },
                {
                    key: P_PROGRESS, instruction: stopping ? 'Stop sharing...' : 'Sharing items...', noNext: true, noBack: true, transient: true,
                    show: (ctx) => {
                        const ins = ctx.content.querySelector(`[data-vdt-page="${P_PROGRESS}"] .vdt-wizard-instruction`);
                        if (ins) ins.textContent = stopping ? 'Stop sharing...' : 'Sharing items...';
                        const bar = ctx.holder(4021, P_PROGRESS);
                        if (bar) bar.classList.add('is-marquee');
                        (async () => {
                            try {
                                if (stopping) { await ask(S().stop({ drive: folder.drive, path: folder.path })); result = { stopped: true }; } else result = { name: await share() };
                            } catch (err) { result = { error: err }; }
                            ctx.go(P_DONE);
                        })();
                    }
                },
                {
                    key: P_DONE, finish: true, noBack: true, nextText: 'Done',
                    show: (ctx) => {
                        const n = ctx.content.querySelector('.vdt-wizard-next');
                        if (n) n.innerHTML = '<u>D</u>one';
                        const cancel = ctx.content.querySelector('.vdt-wizard-cancel');
                        if (cancel) cancel.hidden = true;
                        const ins = ctx.content.querySelector(`[data-vdt-page="${P_DONE}"] .vdt-wizard-instruction`);
                        const lv = ctx.holder(4102, P_DONE);
                        ctx.show(4103, false, P_DONE);
                        ctx.show(4104, false, P_DONE);
                        ctx.show(4105, false, P_DONE);
                        if (result && result.error) {
                            if (ins) ins.textContent = stopping ? 'You could not stop sharing the selected folder.' : 'Your folder could not be shared.';
                            ctx.html(4101, esc(result.error.message || String(result.error)), P_DONE);
                            if (lv) lv.hidden = true;
                            return;
                        }
                        if (stopping) {
                            if (ins) ins.textContent = 'You have stopped sharing the selected folder.';
                            ctx.html(4101, '', P_DONE);
                            if (lv) lv.hidden = true;
                            return;
                        }
                        if (ins) ins.textContent = 'Your folder is shared.';
                        ctx.html(4101, linkHtml('You may <A href="EmailLinks">e-mail</A> these links to notify people that you have shared these files, or <A href="CopyLinks">copy</A> the links onto the Melaton clipboard, where you can paste them into any program you choose.'), P_DONE);
                        if (lv) {
                            lv.classList.add('vfs-done-list');
                            lv.querySelector('.vdt-lv-body').innerHTML = `<div class="vdt-lv-row vfs-done-tile"><img src="/static_images/vista-explorer/net-share-32.png" alt=""><span class="vfs-done-text"><span>${esc(result.name)} (\\\\${esc(computerName())})</span><span class="vfs-done-path">${esc(uncOf(result.name))}</span></span></div>`;
                        }
                    }
                }
            ]),
            init: (ctx) => {
                // the people page: the note, the combo with its accounts, Add only with a name typed or picked
                ctx.html(4004, linkHtml('People must have a user account and password for this computer to access files you have shared.  To change this setting, use the <a href="NSC">Network and Sharing Center</a>.'), P_PEOPLE);
                ctx.options(4005, comboAccounts(), '', P_PEOPLE);
                ctx.set(4005, '', P_PEOPLE);
                ctx.html(4016, '', P_PEOPLE);
                ctx.enable(4015, false, P_PEOPLE);
                const combo = ctx.el(4005, P_PEOPLE);
                const sync = () => ctx.enable(4015, !!String(ctx.get(4005, P_PEOPLE) || '').trim(), P_PEOPLE);
                if (combo) { combo.addEventListener('input', sync); combo.addEventListener('change', sync); }
                const add = () => {
                    const raw = ctx.get(4005, P_PEOPLE);
                    const acc = ['administrator', 'guest', 'everyone'].includes(raw) ? raw : accountFromText(raw);
                    if (!acc) { void message(`Unable to locate user ${String(raw || '').trim()}`, 'File Sharing'); return; }
                    // a new row is a Reader (the VM)
                    if (!people.some((p) => p.account === acc)) people.push({ account: acc, level: 'reader' });
                    ctx.set(4005, '', P_PEOPLE);
                    sync();
                    drawPeople(ctx);
                };
                ctx.on(4015, 'click', add, P_PEOPLE);
                // the command links of "already shared"
                ctx.on(4051, 'click', () => ctx.go(P_PEOPLE), P_ALREADY);
                ctx.on(4050, 'click', () => { stopping = true; ctx.go(P_PROGRESS); }, P_ALREADY);
                ctx.content.addEventListener('click', (ev) => {
                    const l = ev.target.closest('[data-link]');
                    if (!l) return;
                    const what = l.dataset.link;
                    if (what === 'NSC') openSharingCenter();
                    else if ((what === 'CopyLinks' || what === 'EmailLinks') && result && result.name) copyText(uncOf(result.name));
                });
            },
            finish: () => { resolveDone(result); },
            cancel: () => { resolveDone(null); }
        });
        return done;
    }

    function copyText(text) {
        try { if (root.navigator && root.navigator.clipboard) void root.navigator.clipboard.writeText(text); } catch (_) { /* no clipboard */ }
    }

    function openSharingCenter() {
        const loader = root.featureLoader;
        Promise.resolve(loader && typeof loader.loadFeature === 'function' ? loader.loadFeature('control_panel') : null)
            .then(() => { if (root.melatonControlPanel) root.melatonControlPanel.open('network'); })
            .catch((err) => console.error('Network and Sharing Center', err));
    }

    // ---- Properties: General and Sharing ------------------------------------------------------------------------------

    const K_GENERAL = 'melaton:folder-general';
    const K_SHARING = 'ntshrui:1000';

    function bytes(n) {
        const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
        let v = Number(n) || 0;
        let i = 0;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
        const short = i === 0 ? `${v} bytes` : `${v >= 100 ? Math.floor(v) : v >= 10 ? (Math.floor(v * 10) / 10).toFixed(1) : (Math.floor(v * 100) / 100).toFixed(2)} ${units[i]}`;
        return i === 0 ? short : `${short} (${Number(n).toLocaleString('en-US')} bytes)`;
    }

    /** Size and Contains, counted through the drive (a few thousand entries at most, as the page waits). */
    async function measure(drive, path, onStep) {
        const D = root.DreamOSDrives;
        const out = { size: 0, files: 0, folders: 0 };
        const queue = [path];
        let seen = 0;
        while (queue.length && seen < 20000) {
            const p = queue.shift();
            const r = D ? await D.list(drive, p) : null;
            if (!r || r.error) continue;
            for (const e of r.entries || []) {
                if (e.system) continue;
                seen += 1;
                if (e.dir) { out.folders += 1; queue.push(e.path); } else { out.files += 1; out.size += Number(e.size) || 0; }
            }
            onStep(out);
        }
        return out;
    }

    async function openProperties(folder, opts = {}) {
        const V = await kit();
        let onChange = null;
        const syncSharing = (ctx) => {
            const list = sharesOf(folder.drive, folder.path);
            ctx.text(1058, folder.name, K_SHARING);
            ctx.text(4407, list.length ? 'Shared' : 'Not Shared', K_SHARING);
            ctx.set(4406, list.length ? uncOf(list[0].name) : 'Not Shared', K_SHARING);
        };
        V.openSheet({
            id: 'vistaFolderProperties',
            title: `${folder.name} Properties`,
            icon: '/static_images/vista-icons/explorer/folder-16.png',
            captionIcon: true,
            owner: opts.owner || null,
            pages: [
                { key: K_GENERAL, title: 'General', overrides: { 1021: { image: '/static_images/vista-icons/explorer/folder-32.png' } } },
                {
                    key: K_SHARING, title: 'Sharing',
                    overrides: {
                        1021: { image: '/static_images/vista-icons/explorer/folder-32.png' },
                        1060: { shield: true },
                        1061: { html: linkHtml(PASSWORD_TEXT.replace('<a>', '<a href="NSC">')) }
                    }
                }
            ],
            start: opts.page === 'sharing' ? K_SHARING : K_GENERAL,
            init: (ctx) => {
                const loc = folder.location || '';
                ctx.set(1022, folder.name, K_GENERAL);
                ctx.el(1022, K_GENERAL).readOnly = true;
                ctx.text(1030, 'File Folder', K_GENERAL);
                ctx.text(1031, loc, K_GENERAL);
                ctx.text(1032, 'Calculating...', K_GENERAL);
                ctx.text(1034, '', K_GENERAL);
                ctx.text(1035, folder.mtime ? new Date(folder.mtime).toLocaleString() : '', K_GENERAL);
                void measure(folder.drive, folder.path, (m) => {
                    ctx.text(1032, bytes(m.size), K_GENERAL);
                    ctx.text(1034, `${m.files.toLocaleString('en-US')} Files, ${m.folders.toLocaleString('en-US')} Folders`, K_GENERAL);
                });
                const ro = ctx.el(4406, K_SHARING);
                if (ro) ro.readOnly = true;
                syncSharing(ctx);
                ctx.on(1059, 'click', async () => { await openWizard(folder, { owner: ctx.modal }); syncSharing(ctx); }, K_SHARING);
                ctx.on(1060, 'click', async () => { await openAdvanced(folder, ctx.modal); syncSharing(ctx); }, K_SHARING);
                ctx.content.addEventListener('click', (ev) => { const l = ev.target.closest('[data-link="NSC"]'); if (l) openSharingCenter(); });
                onChange = () => { if (ctx.modal && ctx.modal.isConnected) syncSharing(ctx); };
                root.addEventListener('dreamosshares', onChange);
            },
            apply: () => true,
            // the window's listener goes with it
            close: () => { if (onChange) root.removeEventListener('dreamosshares', onChange); }
        });
    }

    // ---- Advanced Sharing (ntshrui 1009), New Share (1018) ----------------------------------------------------------

    const K_ADV = 'ntshrui:1009';
    const K_NEW = 'ntshrui:1018';

    function validName(name) {
        const n = String(name || '').trim();
        return n && n.length <= 80 && !/[\\/[\]:|<>+=;,?*"\u0000-\u001f]/.test(n) && !/^[. ]+$/.test(n);
    }

    async function openAdvanced(folder, owner) {
        const V = await kit();
        let list = sharesOf(folder.drive, folder.path).map((x) => ({ ...x, permissions: (x.permissions || []).map((p) => ({ ...p })) }));
        let current = list[0] ? list[0].name : null;
        const removed = [];
        const added = [];
        let resolveDone;
        const done = new Promise((r) => { resolveDone = r; });
        const fill = (ctx) => {
            const on = ctx.get(1020);
            const many = list.length > 0;
            // a folder with a share shows the names in a combo, a new one the name in an edit
            ctx.show(1015, many && on);
            ctx.show(1001, !(many && on));
            [1003, 1001, 1015, 1016, 1011, 1010, 1004, 1002, 1008].forEach((id) => ctx.enable(id, on));
            ctx.enable(1017, on && many);
            ctx.enable(1012, on && list.length > 1);
            ctx.enable(1019, false);
            const s = list.find((x) => x.name === current);
            if (many) ctx.options(1015, list.map((x) => x.name), current);
            if (!on) { ctx.set(1011, ''); return; }
            ctx.set(1011, String(s ? s.limit || 10 : 10));
            ctx.set(1002, s ? s.comment || '' : '');
        };
        const save = async (ctx) => {
            const sh = S();
            const on = ctx.get(1020);
            const limit = Math.max(1, Math.min(20, Number(ctx.get(1011)) || 10));
            const comment = String(ctx.get(1002) || '');
            if (!on) {
                if (list.length) await ask(sh.stop({ drive: folder.drive, path: folder.path }));
                return true;
            }
            if (!list.length) {
                const name = String(ctx.get(1001) || '').trim();
                if (!validName(name)) { await message('The share name contains invalid characters.', 'Advanced Sharing'); return false; }
                // Advanced Sharing's own default: Everyone, Read (no people: the share permissions decide)
                await ask(sh.share({ drive: folder.drive, path: folder.path, name, comment, limit, people: [], permissions: pending.perms || [{ account: 'everyone', allow: ['read'], deny: [] }] }));
                return true;
            }
            for (const n of removed) await ask(sh.stop(n));
            for (const a of added) await ask(sh.share({ drive: folder.drive, path: folder.path, name: a.name, comment: a.comment, limit: a.limit, people: [], permissions: a.permissions }));
            const s = list.find((x) => x.name === current);
            if (s && !added.some((a) => a.name === s.name)) await ask(sh.update(s.name, { comment, limit, permissions: s.permissions }));
            return true;
        };
        const pending = { perms: null };
        // Apply is on once something changed (Vista's), off again after it saved
        const changed = (ctx) => { ctx.enable(1024, true); };
        V.openDialog({
            id: 'vistaAdvancedSharing',
            key: K_ADV,
            owner,
            bareCaption: true,
            overrides: { 1008: { text: '&Permissions' } },
            init: (ctx) => {
                ctx.enable(1024, false);
                ['1011', '1002'].forEach((id) => { const e = ctx.el(Number(id)); if (e) e.addEventListener('input', () => changed(ctx)); });
                ctx.set(1020, list.length > 0);
                if (!list.length) ctx.set(1001, folder.name);
                fill(ctx);
                ctx.on(1020, 'change', () => { if (ctx.get(1020) && !list.length) ctx.set(1001, folder.name); fill(ctx); changed(ctx); });
                ctx.on(1015, 'change', () => { current = ctx.get(1015); fill(ctx); });
                ctx.on(1017, 'click', async () => {
                    const n = await newShare(ctx.modal, folder);
                    if (!n) return;
                    if (list.some((x) => x.name.toLowerCase() === n.name.toLowerCase())) { await message('The share name already exists on this resource. Please choose another share name.', 'Advanced Sharing'); return; }
                    const s = { ...n, permissions: [{ account: 'everyone', allow: ['read'], deny: [] }] };
                    list.push(s);
                    added.push(s);
                    current = s.name;
                    fill(ctx);
                    changed(ctx);
                });
                ctx.on(1012, 'click', () => {
                    if (!current || list.length < 2) return;
                    if (!added.some((a) => a.name === current)) removed.push(current);
                    list = list.filter((x) => x.name !== current);
                    current = list[0] ? list[0].name : null;
                    fill(ctx);
                    changed(ctx);
                });
                ctx.on(1008, 'click', async () => {
                    const s = list.find((x) => x.name === current);
                    const name = s ? s.name : String(ctx.get(1001) || folder.name);
                    const perms = s ? s.permissions : (pending.perms || [{ account: 'everyone', allow: ['read'], deny: [] }]);
                    const next = await openPermissions(name, perms, ctx.modal);
                    if (!next) return;
                    if (s) s.permissions = next; else pending.perms = next;
                    changed(ctx);
                });
                ctx.on(1024, 'click', async () => { if (await save(ctx)) { list = sharesOf(folder.drive, folder.path).map((x) => ({ ...x })); removed.length = 0; added.length = 0; fill(ctx); ctx.enable(1024, false); } });
            },
            ok: async (ctx) => {
                try { if (!(await save(ctx))) return false; } catch (err) { await message(err.message || String(err), 'Advanced Sharing'); return false; }
                resolveDone(true);
                return true;
            },
            cancel: () => resolveDone(false)
        });
        return done;
    }

    async function newShare(owner, folder) {
        const V = await kit();
        return new Promise((resolve) => {
            V.openDialog({
                id: 'vistaNewShare',
                key: K_NEW,
                owner,
                bareCaption: true,
                init: (ctx) => {
                    ctx.set(1006, true);
                    ctx.set(1011, '10');
                    ctx.enable(1011, false);
                    ctx.enable(1010, false);
                    ctx.enable(1008, false);
                    const sync = () => { const on = ctx.get(1007); ctx.enable(1011, on); ctx.enable(1010, on); };
                    ctx.on(1006, 'change', sync);
                    ctx.on(1007, 'change', sync);
                },
                ok: async (ctx) => {
                    const name = String(ctx.get(1001) || '').trim();
                    if (!validName(name)) { await message('The share name contains invalid characters.', 'New Share'); return false; }
                    // Maximum allowed: Vista's client limit (20 here, the machine's own ceiling)
                    resolve({ name, comment: String(ctx.get(1002) || ''), limit: ctx.get(1007) ? Math.max(1, Math.min(20, Number(ctx.get(1011)) || 10)) : 20, drive: folder.drive, path: folder.path });
                    return true;
                },
                cancel: () => resolve(null)
            });
        });
    }

    // ---- Permissions for <share> (aclui 103, one "Share Permissions" tab) ------------------------------------------

    const K_ACL = 'aclui:103';

    async function openPermissions(shareName, permissions, owner) {
        const V = await kit();
        let rows = (permissions || []).map((p) => ({ account: p.account, allow: (p.allow || []).slice(), deny: (p.deny || []).slice() }));
        let sel = rows[0] ? rows[0].account : null;
        let result = null;
        return new Promise((resolve) => {
            const draw = (ctx) => {
                const lv = ctx.holder(1000, K_ACL);
                if (lv) {
                    lv.querySelector('.vdt-lv-body').innerHTML = rows.map((r) => `<div class="vdt-lv-row${r.account === sel ? ' is-selected' : ''}" data-account="${esc(r.account)}"><span><img src="${accountIcon(r.account)}" alt="">${esc(accountName(r.account))}</span></div>`).join('');
                }
                ctx.text(1008, sel ? `Permissions for ${accountName(sel)}` : 'Permissions', K_ACL);
                const r = rows.find((x) => x.account === sel);
                ctx.html(1004, RIGHTS.map(([k, t]) => `<div class="vfs-acl-row"><span>${esc(t)}</span>`
                    + `<input type="checkbox" class="tbp-check vfs-acl-allow" data-right="${k}"${r && r.allow.includes(k) ? ' checked' : ''}${r ? '' : ' disabled'}>`
                    + `<input type="checkbox" class="tbp-check vfs-acl-deny" data-right="${k}"${r && r.deny.includes(k) ? ' checked' : ''}${r ? '' : ' disabled'}></div>`).join(''), K_ACL);
                ctx.enable(1002, !!r);
            };
            V.openSheet({
                id: 'vistaSharePermissions',
                title: `Permissions for ${shareName}`,
                owner,
                noApply: false,
                pages: [{
                    key: K_ACL, title: 'Share Permissions',
                    overrides: {
                        1014: { hidden: true }, 1015: { hidden: true }, 1016: { hidden: true }, 1012: { hidden: true }, 6040: { hidden: true },
                        6027: { hidden: true }, 1003: { hidden: true }, 1005: { hidden: true }, 6026: { hidden: true }, 6024: { hidden: true }, 6021: { hidden: true },
                        // ntshrui moves aclui's controls at run time; these put them where the VM has them
                        // (share-permissions-everyone.png: names 82-182, Add / Remove 193, the check list 245-382)
                        1013: { nudge: [0, -34, 0, 0] }, 1000: { nudge: [0, -33, 0, 30] },
                        1008: { nudge: [0, 5, 0, 0] }, 1009: { nudge: [0, 5, 0, 0] }, 1010: { nudge: [0, 5, 0, 0] },
                        1004: { html: '', cls: 'vfs-acl', nudge: [0, 2, 0, 38] }
                    }
                }],
                init: (ctx) => {
                    draw(ctx);
                    const lv = ctx.holder(1000, K_ACL);
                    if (lv) lv.addEventListener('click', (ev) => { const row = ev.target.closest('.vdt-lv-row'); if (row) { sel = row.dataset.account; draw(ctx); } });
                    ctx.content.addEventListener('change', (ev) => {
                        const b = ev.target.closest('.vfs-acl-allow, .vfs-acl-deny');
                        const r = b && rows.find((x) => x.account === sel);
                        if (!r) return;
                        const list = b.classList.contains('vfs-acl-allow') ? r.allow : r.deny;
                        const k = b.dataset.right;
                        const order = ['read', 'change', 'full'];
                        // Vista: Full Control checks the boxes under it; clearing one clears the ones above
                        if (b.checked) order.slice(0, order.indexOf(k) + 1).forEach((x) => { if (!list.includes(x)) list.push(x); });
                        else order.slice(order.indexOf(k)).forEach((x) => { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); });
                        // the same right is never both allowed and denied
                        const other = b.classList.contains('vfs-acl-allow') ? r.deny : r.allow;
                        list.forEach((x) => { const i = other.indexOf(x); if (i >= 0) other.splice(i, 1); });
                        draw(ctx);
                        ctx.dirty();
                    });
                    ctx.on(1001, 'click', (ev) => {
                        const cm = root.contextMenu;
                        const free = ['everyone', 'administrator', 'guest'].filter((a) => !rows.some((r) => r.account === a));
                        if (!free.length || !cm) return;
                        const btn = ev.currentTarget || ctx.holder(1001, K_ACL);
                        cm.attachClickMenuToElement(btn, { sections: [{ type: 'list', items: free.map((a) => ({ text: accountName(a), action: a })) }], onAction: (a) => { rows.push({ account: a, allow: ['read'], deny: [] }); sel = a; draw(ctx); ctx.dirty(); } });
                        cm.openClickMenu(btn);
                    }, K_ACL);
                    ctx.on(1002, 'click', () => { rows = rows.filter((r) => r.account !== sel); sel = rows[0] ? rows[0].account : null; draw(ctx); ctx.dirty(); }, K_ACL);
                },
                apply: () => { result = rows.map((r) => ({ ...r })); return true; },
                close: () => resolve(result)
            });
        });
    }

    root.vistaFileSharing = { openWizard, openProperties, openAdvanced, openPermissions, sharesOf, _test: { accountFromText, validName, bytes } };
})(typeof window !== 'undefined' ? window : globalThis);
