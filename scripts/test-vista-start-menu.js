#!/usr/bin/env node
// Vista start menu (Yozora #443): the two-column markup, Vista's art at its sizes, the CSS wiring,
// and the behaviour hooks in modalUtils.js (All Programs in place with Accessories, Start Search on
// the Run index, launch history, the power arrow menu).
// Run: node scripts/test-vista-start-menu.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
    // markup: every element buildStartMenu looks up (ensureStartMenuElements)
    const html = read('public/app.html');
    const menu = html.slice(html.indexOf('<div id="startMenu"'), html.indexOf('<!-- Desktop Taskbar'));
    for (const needle of ['id="startMenuItems"', 'class="start-menu-all-programs"', 'class="start-menu-all-programs-label"',
        'id="startMenuSearchInput"', 'class="start-menu-places"', 'class="start-menu-power"', 'class="start-menu-user-tile"',
        'class="start-menu-user-tile-item"', 'placeholder="Start Search"']) {
        assert.ok(menu.includes(needle), `start menu markup has ${needle}`);
    }
    assert.ok(!menu.includes('start-menu-branding'), 'the vertical branding strip is gone');

    // art: Vista's 120 DPI cells, three states stacked (rest, hover, pressed)
    const art = 'public/static_images/vista-start';
    const sizes = { 'shutdown.png': [70, 90], 'lock.png': [70, 90], 'arrow.png': [28, 90], 'user-frame.png': [64, 64], 'folder-20.png': [20, 20], 'folder-40.png': [40, 40] };
    for (const [file, [w, h]] of Object.entries(sizes)) {
        const meta = await sharp(path.join(ROOT, art, file)).metadata();
        assert.deepStrictEqual([meta.width, meta.height], [w, h], `${file} is ${w}x${h}`);
    }
    const css = read('public/css/desktop-shell.css');
    for (const ref of css.matchAll(/url\('\/static_images\/vista-start\/([^']+)'\)/g)) {
        assert.ok(fs.existsSync(path.join(ROOT, art, ref[1])), `CSS art ${ref[1]} exists`);
    }
    assert.ok(/grid-template-areas:\s*"pane places"\s*"search power"/.test(css), 'two columns over search + power');
    assert.ok(css.includes('minmax(181px, max-content)'), 'places column sizes to its longest name');
    assert.ok(/html\[data-glass="frosted"\] #startMenu\.start-menu/.test(css) && /html\[data-glass="basic"\] #startMenu\.start-menu/.test(css), 'frosted and basic glass');
    assert.ok(!/\.start-menu-popout\b/.test(css), 'old pop-out styles removed');

    // behaviour hooks
    const js = read('public/scripts/comp/modalUtils.js');
    assert.ok(/folderId: 'accessories', text: 'Accessories'/.test(js), 'Toolbox is the Accessories folder in All Programs');
    assert.ok(/startMenuShellConfig\.find\(\(item\) => item\.launchId === 'run'\)/.test(js), 'Run lives in Accessories');
    assert.ok(/searchRunCommands\(query,/.test(js), 'Start Search uses the Run index');
    assert.ok(/execute: \(\) => \{\s*recordStartMenuLaunch\(item\.launchId\);/.test(js), 'Run launches count toward the history');
    for (const text of ['Log Off', 'Lock', 'Restart', 'Shut Down', 'Restart Server']) {
        assert.ok(js.includes(`text: '${text}'`), `power menu has ${text}`);
    }
    for (const text of ['Cartograph', 'Gallery', 'Notion', 'Workspaces', 'Recent Items', 'Network and Server Center', 'Control Panel', 'Remote Access', 'Help and Support']) {
        assert.ok(js.includes(`text: '${text}'`), `places column has ${text}`);
    }
    assert.ok(js.includes("text: 'Remove from this list'") && js.includes("text: 'Pin to Start Menu'"), 'Vista row menu wording');
    assert.ok(!/function (showStartMenuPopout|createStartMenuRowElement|setupStartMenuPowerDropdown)\b/.test(js), 'old pop-out / dropdown code removed');

    console.log('test-vista-start-menu: ok');
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
