/**
 * SoraTan's server half (a session runner, Yozora #638). Like SoraTan.exe, which loads a random
 * .\*.sora from its own folder, it reads the .sora files next to the launched SoraTan.exe through
 * the host (app.call('listLaunchFolder' / 'readLaunchFile')), decodes one (decoder.js) and hands the
 * scene and texture to the client half. With no .sora there it answers as the exe does:
 * "Load Sora file fail!".
 */
'use strict';

const { decodeSora } = require('./decoder');

module.exports = function start(app) {
    app.onMessage(async (msg, instance) => {
        if (!msg || msg.op !== 'load') return;
        try {
            const files = await app.callFor(instance, 'listLaunchFolder');
            const soras = (files || []).filter((f) => /\.sora$/i.test(f.name));
            if (!soras.length) {
                app.send({ op: 'error', caption: 'Error', text: ' Load Sora file fail!' }, instance);
                return;
            }
            const pick = soras[Math.floor(Math.random() * soras.length)];
            const bytes = await app.callFor(instance, 'readLaunchFile', pick.name);
            const { scene, png } = decodeSora(Buffer.from(bytes));
            app.log(`loaded ${pick.name} (${bytes.length} bytes)`);
            app.send({ op: 'scene', name: pick.name, scene, texture: Buffer.from(png).toString('base64') }, instance);
        } catch (err) {
            app.log(`load failed: ${err && err.message}`);
            app.send({ op: 'error', caption: 'Error', text: ' Load Sora file fail!' }, instance);
        }
    });
};
