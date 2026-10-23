#!/usr/bin/env node
// Control Panel's Desktop Background (Yukimi 2026-10-13): Vista's 36 stock wallpapers by category,
// the Melaton set, earlier uploads with delete. Run: node scripts/test-desktop-background.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// the upload history (server)
const hist = require('../modules/wallpaperHistory.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wallpaper-history-'));
const png = (n) => { const f = path.join(tmp, `${n}.png`); fs.writeFileSync(f, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(String(n))])); return f; };
const a = hist.remember(tmp, png('a'), 'beach.jpg');
const b = hist.remember(tmp, png('b'), 'city.png');
assert.deepStrictEqual(hist.list(tmp).map((i) => i.name), ['city.png', 'beach.jpg'], 'newest first');
hist.remember(tmp, png('a'), 'beach again.jpg');
assert.deepStrictEqual(hist.list(tmp).map((i) => i.id), [a.id, b.id], 'the same picture moves to the top, once');
assert.ok(a.url.startsWith('/cache/wallpapers/history/') && fs.existsSync(path.join(hist.historyDir(tmp), `${a.id}.png`)));
assert.strictEqual(hist.remove(tmp, b.id), true);
assert.strictEqual(hist.remove(tmp, '../../etc'), false, 'ids are checked');
assert.deepStrictEqual(hist.list(tmp).map((i) => i.id), [a.id]);
fs.rmSync(tmp, { recursive: true, force: true });
assert.ok(read('modules/referencesWebSocketHandlers.js').includes('wallpaperHistory.remember(this.globalResources.getPath(\'cache\'), wallpaperPath, message.filename)'), 'every upload is kept');

// the picker (client)
global.window = global;
global.STOCK_DESKTOP_WALLPAPERS = [{ name: 'Melaton Aurora (default)', url: null }, { name: 'Aurora', url: '/static_images/wallpapers/aurora-plain.webp' }];
const galleries = require('../public/scripts/comp/wallpaperGalleries.js');
const db = require('../public/scripts/comp/cplDesktopBackground.js');
assert.strictEqual(db.VISTA_WALLPAPERS.length, 36);
assert.deepStrictEqual(db.CATEGORIES, ['Black and White', 'Light Auras', 'Paintings', 'Textures', 'Vistas', 'Widescreen']);
for (const w of db.VISTA_WALLPAPERS) {
    assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/wallpapers/vista/${w.id}.webp`)), w.id);
    assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/wallpapers/vista/thumbs/${w.id}.webp`)), `${w.id} thumb`);
}
const win = db._test.html({ location: 'windows', selected: '/static_images/wallpapers/vista/img6.webp', collapsed: new Set() });
assert.ok(win.includes('Black and White (4)') && win.includes('Widescreen (7)') && win.includes('is-selected'));
const up = db._test.html({ location: 'uploads', uploads: [{ id: 'abcdef0123456789', url: '/cache/wallpapers/history/abcdef0123456789.png', name: 'beach.jpg' }] });
assert.ok(up.includes('data-cpl-db="remove"') && up.includes('Your Uploads (1)'), 'uploads have a remove button');
assert.strictEqual(db._test.locationFor('/cache/wallpapers/history/x.png'), 'uploads');
assert.strictEqual(db._test.locationFor(null), 'melaton');

// the photo galleries (Yukimi 2026-10-22): Japan, Europe, USA, fukapon, each photo with its credit
assert.deepStrictEqual(galleries.map((g) => g.id), ['japan', 'europe', 'usa', 'fukapon']);
assert.ok(read('public/scripts/comp/featureLoader.js').indexOf('scripts/comp/wallpaperGalleries.js') <
    read('public/scripts/comp/featureLoader.js').indexOf('scripts/comp/cplDesktopBackground.js'), 'the galleries load before the picker');
for (const g of galleries) {
    assert.ok(g.items.length >= 20, `${g.id} has pictures`);
    for (const w of g.items) {
        assert.ok(g.groups[w.g], `${g.id}/${w.f} is in a group`);
        assert.ok(w.a && w.l && /^https:\/\//.test(w.s), `${g.id}/${w.f} has a photographer, license and source`);
        assert.ok(!/\b(NC|ND)\b/.test(w.l), `${g.id}/${w.f} is free to adapt`);
        assert.ok(fs.existsSync(path.join(ROOT, `public${g.dir}/${w.f}.webp`)), `${g.id}/${w.f}`);
        assert.ok(fs.existsSync(path.join(ROOT, `public${g.dir}/thumbs/${w.f}.webp`)), `${g.id}/${w.f} thumb`);
    }
}
const fk = galleries.find((g) => g.id === 'fukapon');
assert.deepStrictEqual(fk.groups, ['Best of fukapon', 'Akihabara Advertisements', 'Akihabara Shop Windows']);
const pic = `${fk.dir}/${fk.items[0].f}.webp`;
assert.strictEqual(db._test.locationFor(pic), 'fukapon');
assert.strictEqual(db._test.creditFor(pic), fk.items[0]);
const fkHtml = db._test.html({ location: 'fukapon', selected: pic, pending: null });
assert.ok(fkHtml.includes('Best of fukapon (') && fkHtml.includes('class="cpl-db-credit"'), 'the gallery lists its groups and a credit line');
assert.ok(fkHtml.includes('View on Flickr') && fkHtml.includes(fk.items[0].s) && fkHtml.includes(fk.items[0].l), 'the selected photo is credited with a link');
assert.ok(!db._test.html({ location: 'windows', selected: null }).includes('cpl-db-credit'), 'Windows Wallpapers has no credit line');
const eu = galleries.find((g) => g.id === 'europe');
assert.ok(db._test.html({ location: 'europe', selected: `${eu.dir}/${eu.items[0].f}.webp` }).includes('View on Wikimedia Commons'));

const mu = read('public/scripts/comp/modalUtils.js');
assert.ok(mu.includes('window.cplDesktopBackground.open();'), "Personalization's Select opens the picker");
assert.ok(read('public/scripts/websocket.js').includes("this.sendMessage('wallpaper_history_list'"));
console.log('test-desktop-background: ok');
