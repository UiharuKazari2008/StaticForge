'use strict';
// #332 reload reopen: Director comes back after a reload only when the page that
// just closed had the window open. A page that unloads before the Director starts
// (logon screen, Welcome, installer bounce) must not carry the flag into the next
// session, and closing the window clears the flag and any reopen still waiting.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');
const keyStart = src.indexOf('const DIRECTOR_REOPEN_KEY');
const keyEnd = src.indexOf('\n', src.indexOf('let directorReopenAtLoad'));
assert.ok(keyStart >= 0 && keyEnd > keyStart, 'reopen key and load-time take');
const start = src.indexOf('class Director {');
const end = src.indexOf('\n}\n', start);
assert.ok(start >= 0 && end > start, 'Director class');

const KEY = 'staticforge_director_reopen';
// One tab: sessionStorage survives every reload, each page gets a fresh script context
const store = new Map();
const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
};

function loadPage() {
    const ctx = { sessionStorage, console, closeModal: () => {} };
    vm.createContext(ctx);
    vm.runInContext(`${src.slice(keyStart, keyEnd + 1)}\n${src.slice(start, end + 2)}\nthis.Director = Director;`, ctx);
    return ctx;
}

// The Director the boot builds at init step 60, after logon
function startDirector(page) {
    const d = Object.create(page.Director.prototype);
    d.directorWindow = { open: false };
    d.directorWindowIsOpen = function () { return this.directorWindow.open; };
    d.mountDirectorInStudio = () => {};
    d.resetToWren = () => {};
    d.updateTrayChrome = () => {};
    d.persona = 'wren';
    d.currentSession = { id: 'chat-1' };
    d._reopenAfterReload = d.takeReopenState();
    return d;
}

// Session with the window open, then a reload: the next session reopens it
let page = loadPage();
let d = startDirector(page);
d.directorWindow.open = true;
d.saveReopenState();
assert.ok(store.get(KEY), 'open window saved at pagehide');
page = loadPage();
assert.strictEqual(store.has(KEY), false, 'taken when the page loads');
d = startDirector(page);
assert.deepStrictEqual(JSON.parse(JSON.stringify(d._reopenAfterReload)), { persona: 'wren', sessionId: 'chat-1' });

// Window open, reload, then the page closes again at the logon screen (no Director yet):
// the session after that must start closed
d.directorWindow.open = true;
d.saveReopenState();
page = loadPage();
// no startDirector: unloaded before init step 60
page = loadPage();
d = startDirector(page);
assert.strictEqual(d._reopenAfterReload, null, 'a page that never started the Director drops the flag');

// Reopen still waiting for the first status, user closes the window: nothing comes back
d.directorWindow.open = true;
d.saveReopenState();
page = loadPage();
d = startDirector(page);
assert.ok(d._reopenAfterReload, 'reopen pending');
d.closeDirectorWindow();
assert.strictEqual(d._reopenAfterReload, null, 'close cancels the pending reopen');

// Closed with the flag on disk (page dies before pagehide): close writes through
store.set(KEY, JSON.stringify({ persona: 'wren', sessionId: 'chat-1' }));
d.closeDirectorWindow();
assert.strictEqual(store.has(KEY), false, 'close clears the flag at once');

// Closed when the page unloads: next session starts closed
d.directorWindow.open = false;
d.saveReopenState();
page = loadPage();
d = startDirector(page);
assert.strictEqual(d._reopenAfterReload, null, 'closed window does not reopen');

// Only the first Director of a page gets the load-time flag
d.directorWindow.open = true;
d.saveReopenState();
page = loadPage();
assert.ok(startDirector(page)._reopenAfterReload, 'first instance');
assert.strictEqual(startDirector(page)._reopenAfterReload, null, 'second instance');

console.log('test-director-reopen: ok');
process.exit(0);
