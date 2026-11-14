/**
 * ActiveSync: the Studio session between the desktop and a phone (Yozora #747).
 *
 * A session travels as the request body Studio saves into a request shortcut
 * (saveRequestAsDesktopShortcut: public/scripts/comp/manualModalManager.js) and opens the way such a
 * shortcut does (desktopShortcuts.handleRequestClick), so every field a shortcut keeps crosses over:
 * prompt and characters, model, sampler, resolution, seed, vibes, references, pipeline, the
 * image-to-image source and its mask. The paid-request switch never travels.
 *
 *   studio.getSession          -> { session: { name, requestBody } } | throws EMPTY
 *   studio.setSession { session }   asks this side's user, then opens it (Studio's own overwrite
 *                                   question follows when it holds unsaved work); -> { accepted }
 *
 *   activeSyncStudio.sendTo(peerId)     this Studio's session to a phone (waits for an offline
 *                                       partner) or to a computer; -> { accepted } | { queued }
 *   activeSyncStudio.getFrom(peerId)    the other side's session opens here
 *   activeSyncStudio.targets()          [{ id, name, online }] this tab may send to
 *
 * Studio's File menu lists Send To and Get Session From (imageGenerationSettings.js), and Device
 * Center lists both under Programs and Services.
 */
(function (root) {
    'use strict';

    const as = root.activeSync;
    if (!as || !as.kind) return;

    const fn = (name) => {
        try { return typeof root[name] === 'function' ? root[name] : (0, eval)(`typeof ${name} === 'function' ? ${name} : null`); } catch (_) { return null; } // eslint-disable-line no-eval
    };
    // globals declared with let / const in classic scripts are not window properties
    const glob = (name) => {
        try { return root[name] !== undefined ? root[name] : (0, eval)(`typeof ${name} !== 'undefined' ? ${name} : undefined`); } catch (_) { return undefined; } // eslint-disable-line no-eval
    };
    const err = (code, message) => ({ code, message });

    /** The form as a request body, as a request shortcut keeps it (no dialogs, no validation prompts). */
    function snapshot() {
        const collect = fn('collectManualFormValues');
        const shared = fn('addSharedFieldsToRequestBody');
        const resolution = fn('processResolutionValue');
        if (!collect || !shared || !resolution) throw err('UNSUPPORTED', 'Studio is not available here.');
        const values = collect();
        if (!values || !values.model || !String(values.prompt || '').trim()) throw err('EMPTY', 'Studio has no session to send: the prompt is empty.');
        const body = { prompt: values.prompt, steps: values.steps, guidance: values.guidance, rescale: values.rescale };
        const res = resolution(values.resolutionValue);
        if (res && res.isCustom) { body.width = res.width; body.height = res.height; } else if (res) { body.resolution = res.resolution; }
        const up = root.uploadedImageData;
        const edit = root.currentEditMetadata;
        if (up || (edit && edit.isVariationEdit)) {
            const num = (el, d) => { const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : d; };
            const image = up && !up.isPlaceholder ? up.image_source : (edit && edit.sourceFilename ? `file:${edit.sourceFilename}` : null);
            if (image) {
                body.image = image;
                body.strength = num(document.getElementById('manualStrengthValue'), 0.8);
                body.noise = num(document.getElementById('manualNoiseValue'), 0.1);
                if (up) body.image_bias = up.image_bias || up.bias;
                const mask = root.currentMaskCompressed || (root.currentMaskData && fn('saveMaskCompressed') ? fn('saveMaskCompressed')() : null);
                if (mask) body.mask_compressed = String(mask).replace('data:image/png;base64,', '');
            }
        }
        shared(body, values);
        body.model = String(values.model).toLowerCase();
        delete body.skip_pipeline_stages;
        delete body.allow_paid;
        const nameEl = document.getElementById('manualPresetName');
        return { name: (nameEl && nameEl.value.trim()) || '', requestBody: body };
    }

    async function open(session) {
        const shortcuts = glob('desktopShortcuts');
        if (!session || !session.requestBody || !shortcuts || typeof shortcuts.handleRequestClick !== 'function') throw err('UNSUPPORTED', 'Studio is not available here.');
        const body = Object.assign({}, session.requestBody);
        delete body.allow_paid;
        await shortcuts.handleRequestClick({ name: session.name || 'Studio session', type: 'request', data: { requestBody: body } });
    }

    function ask(title, text) {
        const sh = root.wmShell;
        if (sh && typeof sh.messageBox === 'function') {
            return sh.messageBox({ title, text, icon: 'question', modal: true, cancelValue: false, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }] });
        }
        if (typeof root.showConfirmationDialog === 'function') {
            return Promise.resolve(root.showConfirmationDialog(`<p>${String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/\n/g, '<br>')}</p>`, [
                { text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }
            ], null, { title, width: 400 })).then((v) => v === true);
        }
        return Promise.resolve(false);
    }

    function note(type, text) {
        const sh = root.wmShell;
        if (sh && typeof sh.notify === 'function') { sh.notify({ title: 'ActiveSync', text, icon: type === 'error' ? 'error' : 'info', timeout: 5000 }); return; }
        if (typeof root.showGlassToast === 'function') root.showGlassToast(type === 'error' ? 'error' : 'success', 'ActiveSync', text, false, 5000);
    }

    as.registerOp('studio.getSession', () => ({ session: snapshot() }));

    as.registerOp('studio.setSession', async (args, from) => {
        const session = args && args.session;
        if (!session || !session.requestBody) throw err('BAD_SESSION', 'No session was sent.');
        const who = (from && from.name) || (as.kind === 'device' ? 'the computer' : 'the device');
        const yes = await ask('ActiveSync', `Open the Studio session sent from ${who}?`);
        if (yes !== true) return { accepted: false };
        // answered now: Studio asks its own question before it replaces unsaved work (Save / Continue /
        // Cancel), and the sender must not wait on that
        open(session).catch((e) => note('error', (e && e.message) || 'The session could not be opened.'));
        return { accepted: true };
    });

    function targets() {
        const st = as.state();
        if (as.kind === 'computer') {
            return st.devices
                .filter((d) => (d.online ? (d.session === 'guest' || d.session === 'partner') && d.permissions.includes('session') : d.partner && d.permissions.includes('session')))
                .map((d) => ({ id: d.deviceId, name: d.name, online: d.online }));
        }
        if (st.session !== 'guest' && st.session !== 'partner') return [];
        return st.computers.map((c) => ({ id: c.computerId, name: c.name, online: true }));
    }

    async function sendTo(peerId) {
        const t = targets().find((x) => x.id === peerId);
        let res;
        try {
            // the other side's user reads a question: give them the two minutes a partnership gets
            res = await as.call(peerId, 'studio.setSession', { session: snapshot() }, { timeoutMs: 120000, queue: as.kind === 'computer' });
        } catch (e) {
            note('error', (e && e.message) || 'The session could not be sent.');
            return null;
        }
        const name = (t && t.name) || 'the device';
        if (res && res.queued) note('info', `The Studio session waits for ${name}.`);
        else if (res && res.accepted) note('info', `The Studio session is open on ${name}.`);
        else note('info', `${name} did not open the Studio session.`);
        return res;
    }

    async function getFrom(peerId) {
        try {
            const res = await as.call(peerId, 'studio.getSession', {}, { timeoutMs: 20000 });
            await open(res && res.session);
            return true;
        } catch (e) {
            note('error', (e && e.message) || 'The session could not be read.');
            return false;
        }
    }

    /** Studio's File menu rows (imageGenerationSettings.js getStudioFileMenuItems); none without a target. */
    function menuItems() {
        const all = targets();
        if (!all.length) return [];
        const online = all.filter((t) => t.online);
        const items = [{ text: 'Send To', optionsfn: () => all.map((t) => ({ text: t.online ? t.name : `${t.name} (when it connects)`, action: `studio-as-send:${t.id}` })) }];
        if (online.length) items.push({ text: 'Get Session From', optionsfn: () => online.map((t) => ({ text: t.name, action: `studio-as-get:${t.id}` })) });
        return items;
    }

    /** handleImageGenerationSettingsMenuAction's hook: true when the action was one of ours. */
    function handleMenuAction(action) {
        const a = String(action || '');
        if (a.startsWith('studio-as-send:')) { void sendTo(a.slice(15)); return true; }
        if (a.startsWith('studio-as-get:')) { void getFrom(a.slice(14)); return true; }
        return false;
    }

    root.activeSyncStudio = { snapshot, open, sendTo, getFrom, targets, menuItems, handleMenuAction };

    // Device Center's Pictures, Music and Video (apps/activesync; tasks queue until it loads): a
    // Studio session is a picture's recipe (#827), with WMDC's own import / add-media art
    if (as.kind === 'computer') {
        const mas = (root.melatonActiveSync = root.melatonActiveSync || {});
        const add = (tile, task) => (typeof mas.addTask === 'function' ? mas.addTask(tile, task) : (mas.pending = mas.pending || []).push([tile, task]));
        const allowed = (d) => d.permissions.includes('session');
        add('media', { id: 'studio-get', text: 'Get the Studio session from your device', icon: 'import-pictures-32.png', when: (d) => allowed(d) && d.online, run: (d) => getFrom(d.deviceId) });
        add('media', { id: 'studio-send', text: 'Send the Studio session to your device', icon: 'add-media-32.png', when: allowed, run: (d) => sendTo(d.deviceId) });
    }
})(typeof window !== 'undefined' ? window : globalThis);
