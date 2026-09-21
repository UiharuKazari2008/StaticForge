const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/utilities.js'), 'utf8');
const fn = src.match(/function formatResolutionSelectedHtml\([\s\S]*?\n\}/);
assert.ok(fn, 'expected formatResolutionSelectedHtml in utilities.js');

const ctx = {};
vm.runInNewContext(fn[0], ctx);
const format = ctx.formatResolutionSelectedHtml;

const normalGroup = { group: 'Normal', free: true };
const largeGroup = { group: 'Large', badge: 'LG' };
const wallpaperGroup = { group: 'Wallpaper', badge: 'WP' };
const maxGroup = { group: 'Maximum', badge: 'XL' };
const smallGroup = { group: 'Small', badge: 'SM', free: true };

const portraitWp = { value: 'normal_wallpaper_portrait', name: 'Wallpaper Portrait' };
const landscapeWp = { value: 'normal_wallpaper_landscape', name: 'Wallpaper Widescreen' };
const normalPortrait = { value: 'normal_portrait', name: 'Portrait' };
const largePortrait = { value: 'large_portrait', name: 'Portrait' };
const paidWp = { value: 'wallpaper_portrait', name: 'Portrait' };
const maxPortrait = { value: 'xlarge_portrait', name: 'Portrait' };
const smallPortrait = { value: 'small_portrait', name: 'Portrait' };

const freeWp = format(portraitWp, normalGroup);
assert.ok(freeWp.includes('Portrait'), freeWp);
assert.ok(!freeWp.includes('Wallpaper'), freeWp);
assert.ok(freeWp.includes('>WP<'), freeWp);
assert.ok(freeWp.includes('free-badge'), freeWp);

const freeWpLand = format(landscapeWp, normalGroup);
assert.ok(freeWpLand.includes('Landscape'), freeWpLand);
assert.ok(!freeWpLand.includes('Widescreen'), freeWpLand);
assert.ok(!freeWpLand.includes('Wallpaper'), freeWpLand);
assert.ok(freeWpLand.includes('>WP<'), freeWpLand);
assert.ok(freeWpLand.includes('free-badge'), freeWpLand);

assert.strictEqual(format(normalPortrait, normalGroup), 'Portrait');
assert.ok(format(largePortrait, largeGroup).includes('Portrait'));
assert.ok(format(largePortrait, largeGroup).includes('>LG<'));
assert.ok(!format(largePortrait, largeGroup).includes('free-badge'));
assert.ok(format(paidWp, wallpaperGroup).includes('Portrait'));
assert.ok(format(paidWp, wallpaperGroup).includes('>WP<'));
assert.ok(!format(paidWp, wallpaperGroup).includes('free-badge'));
assert.ok(format(maxPortrait, maxGroup).includes('>XL<'));
assert.ok(format(smallPortrait, smallGroup).includes('>SM<'));
assert.ok(format(smallPortrait, smallGroup).includes('free-badge'));

const wrapped = format(portraitWp, normalGroup, true);
assert.ok(wrapped.includes('custom-dropdown-text'), wrapped);
assert.ok(wrapped.includes('Portrait'), wrapped);

console.log('test-resolution-selected-display: ok');
