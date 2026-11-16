/**
 * Melaton segments (Yozora #872): code that can be unloaded and loaded again without restarting the
 * page, so one app (and later one feature) updates on its own. An unloaded segment gives back what
 * it held and loses its in-memory variables; only what lives on the server (and the preferences it
 * wrote to localStorage / IndexedDB) remains.
 *
 *   melatonSegments.load({ key, label, scripts, styles, owns }) -> segment
 *       key     unique id ('app:calculator'); scripts / styles are same-origin URLs, run in order
 *       owns    CSS selectors of DOM the segment owns besides [data-melaton-segment="<key>"]
 *   melatonSegments.unload(key, reason) -> what was released ({ globals, kept, nodes, timers, ... })
 *   melatonSegments.get(key) / .loaded() / .current() (the segment whose code is being evaluated)
 *   melatonSegments.report()   every segment and its state: loaded, unloaded (still reachable) or
 *                              reclaimed (collected by the garbage collector)
 *   melatonSegments.ownerOfCaller(depth)  the loaded segment whose code called the function that
 *                              asks (used by core registries; null when core code called it)
 *
 * How a segment is made unloadable:
 *  - Its scripts are fetched and run in a function scope (new Function + //# sourceURL, so stack
 *    traces, programFaults attribution and DevTools still show the real URL), never as a page-global
 *    <script>: top-level const / let / function / class are locals and die with the segment, and a
 *    new version can declare the same names again.
 *  - Globals it does create (window.x = ..., sloppy implicit globals) are found by diffing the window's
 *    own keys around each script and deleted on unload. A key that cannot be deleted is reported.
 *  - Inside the scope, these names are stand-ins that the segment owns and that end with it:
 *    setTimeout / setInterval / requestAnimationFrame / requestIdleCallback (and their clears),
 *    MutationObserver / ResizeObserver / IntersectionObserver, BroadcastChannel, Worker, fetch
 *    (aborted on unload) and URL.createObjectURL (revoked).
 *  - addEventListener called by segment code (found from the caller's stack frame, so it also holds
 *    after an await) gets the segment's AbortSignal: window / document listeners go with it.
 *  - Core registries that keep callbacks are wrapped the same way and undone on unload:
 *    wsClient.on, programFaults.registerProgram, registerKeyboardListener, contextMenu attach*.
 *  - <body> children the segment appended, [data-melaton-segment="<key>"], the owns selectors and its
 *    stylesheets are removed.
 *  - The segment record is watched by a FinalizationRegistry: report() shows whether the garbage
 *    collector really took it (scripts/test-melaton-segments-live.js runs with --expose-gc).
 *
 * Depends on nothing at load. Loads before melatonApps.js (app.html).
 */
(function (root) {
    'use strict';

    const segments = new Map(); // key -> segment (loaded)
    const history = []; // { key, label, state, unloadedAt, ref: WeakRef, released }
    let evaluating = null; // the segment whose script is running right now (define() asks)
    let seq = 0;

    const reclaimWatch = typeof FinalizationRegistry === 'function'
        ? new FinalizationRegistry((token) => {
            const row = history.find((h) => h.token === token);
            if (row) {
                row.state = 'reclaimed';
                row.reclaimedAt = Date.now();
            }
        })
        : null;

    // ---- caller attribution ------------------------------------------------------------------

    function stackLines(limit) {
        const was = Error.stackTraceLimit;
        Error.stackTraceLimit = limit;
        const s = new Error().stack || '';
        Error.stackTraceLimit = was;
        return s.split('\n');
    }

    /**
     * The loaded segment whose code made the call `depth` frames above the caller of this function
     * (depth 1 = the function that called ownerOfCaller was called by ...). Cheap when nothing is
     * loaded; otherwise one short stack capture.
     */
    function ownerOfCaller(depth) {
        if (!segments.size) return null;
        const d = Math.max(1, depth | 0);
        // lines[0] "Error", [1] stackLines, [2] ownerOfCaller, [3] the asker, [3 + d] its caller(s)
        const line = stackLines(3 + d)[3 + d] || '';
        if (!line) return null;
        for (const seg of segments.values()) {
            for (const prefix of seg.urlPrefixes) {
                if (line.indexOf(prefix) >= 0) return seg;
            }
        }
        return null;
    }

    // ---- global hooks (installed once, on the first load) ----------------------------------------

    function withSignal(options, signal) {
        if (options && typeof options === 'object') {
            if (options.signal) {
                if (options.signal === signal || typeof AbortSignal.any !== 'function') return options;
                return Object.assign({}, options, { signal: AbortSignal.any([options.signal, signal]) });
            }
            return Object.assign({}, options, { signal });
        }
        return { capture: options === true, signal };
    }

    /** add -> an addEventListener that gives segment callers the segment's signal. */
    function signalledAdd(add) {
        const fn = function addEventListener(type, listener, options) {
            if (segments.size && listener) {
                const seg = ownerOfCaller(1);
                if (seg && !seg.ctl.signal.aborted) return add.call(this, type, listener, withSignal(options, seg.ctl.signal));
            }
            return add.call(this, type, listener, options);
        };
        fn.__melatonSegmentWrapped = true;
        return fn;
    }

    let hooked = false;
    function installHooks() {
        if (!hooked) {
            hooked = true;
            const proto = root.EventTarget && root.EventTarget.prototype;
            if (proto && proto.addEventListener) proto.addEventListener = signalledAdd(proto.addEventListener);
        }
        // an own addEventListener on document / window (modalKeyboardRegistry.js puts one on document,
        // bound to the native one) would skip the prototype's: wrap it too, on every load (it can
        // arrive later)
        for (const target of [root.document, root]) {
            if (!target || !Object.prototype.hasOwnProperty.call(target, 'addEventListener')) continue;
            const own = target.addEventListener;
            if (typeof own !== 'function' || own.__melatonSegmentWrapped) continue;
            try { target.addEventListener = signalledAdd(own); } catch (_) { /* read-only */ }
        }
    }

    /** Wraps obj[name] so a call made by segment code registers its undo with that segment. */
    function adoptCalls(obj, name, undoOf) {
        if (!obj || typeof obj[name] !== 'function') return;
        const fn = obj[name];
        if (fn.__melatonSegmentWrapped) return;
        const wrapped = function () {
            const result = fn.apply(this, arguments);
            const seg = segments.size ? ownerOfCaller(1) : null;
            if (seg) {
                const undo = undoOf.call(this, arguments, result);
                if (typeof undo === 'function') seg.undo.push(undo);
            }
            return result;
        };
        wrapped.__melatonSegmentWrapped = true;
        try { obj[name] = wrapped; } catch (_) { /* read-only: left alone */ }
    }

    /** Core registries that hold callbacks. Looked up on every load: some arrive late. */
    function wrapRegistries() {
        const ws = root.wsClient;
        if (ws) adoptCalls(ws, 'on', function (args) {
            const [type, handler] = args;
            return () => { if (typeof ws.off === 'function') ws.off(type, handler); };
        });
        const pf = root.programFaults;
        if (pf) adoptCalls(pf, 'registerProgram', function (args) {
            const id = args[0];
            return () => { if (typeof pf.unregisterProgram === 'function') pf.unregisterProgram(id); };
        });
        if (typeof root.registerKeyboardListener === 'function') adoptCalls(root, 'registerKeyboardListener', function (args) {
            const id = args[0] && args[0].id;
            return () => { if (id && typeof root.unregisterKeyboardListener === 'function') root.unregisterKeyboardListener(id); };
        });
        const cm = root.contextMenu;
        if (cm) {
            adoptCalls(cm, 'attachToElement', function (args) {
                const el = args[0];
                return () => { if (typeof cm.detachFromElement === 'function') cm.detachFromElement(el); };
            });
            adoptCalls(cm, 'attachClickMenuToElement', function (args) {
                const el = args[0];
                return () => { if (typeof cm.detachClickMenuFromElement === 'function') cm.detachClickMenuFromElement(el); };
            });
        }
        const body = root.document && root.document.body;
        if (body && !body.__melatonSegmentWrapped) {
            body.__melatonSegmentWrapped = true;
            // <body> children a segment appends are its own (its windows, overlays, popups)
            const own = (node) => {
                if (!segments.size || !node || node.nodeType !== 1) return;
                const seg = ownerOfCaller(2);
                if (seg) seg.nodes.add(node);
            };
            for (const name of ['appendChild', 'insertBefore', 'append', 'prepend']) {
                const fn = body[name];
                body[name] = function (node) {
                    own(node);
                    return fn.apply(this, arguments);
                };
            }
        }
    }

    // ---- the scope a segment's code runs in --------------------------------------------------------

    const SCOPED = [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'BroadcastChannel', 'Worker', 'fetch'
    ];

    function scopeFor(seg) {
        const r = seg.res;
        const live = () => !seg.ctl.signal.aborted;
        const observer = (Base) => (Base ? class extends Base {
            constructor(cb, opts) {
                super(cb, opts);
                r.observers.add(this);
            }
        } : undefined);
        return {
            setTimeout(cb, ms, ...rest) {
                if (!live()) return 0;
                const id = root.setTimeout((...a) => { r.timeouts.delete(id); if (typeof cb === 'function') cb(...a); }, ms, ...rest);
                r.timeouts.add(id);
                return id;
            },
            clearTimeout(id) { r.timeouts.delete(id); root.clearTimeout(id); },
            setInterval(cb, ms, ...rest) {
                if (!live()) return 0;
                const id = root.setInterval(cb, ms, ...rest);
                r.intervals.add(id);
                return id;
            },
            clearInterval(id) { r.intervals.delete(id); root.clearInterval(id); },
            requestAnimationFrame(cb) {
                if (!live()) return 0;
                const id = root.requestAnimationFrame((t) => { r.frames.delete(id); cb(t); });
                r.frames.add(id);
                return id;
            },
            cancelAnimationFrame(id) { r.frames.delete(id); root.cancelAnimationFrame(id); },
            requestIdleCallback: typeof root.requestIdleCallback === 'function' ? (cb, opts) => {
                if (!live()) return 0;
                const id = root.requestIdleCallback((d) => { r.idles.delete(id); cb(d); }, opts);
                r.idles.add(id);
                return id;
            } : undefined,
            cancelIdleCallback: typeof root.cancelIdleCallback === 'function' ? (id) => { r.idles.delete(id); root.cancelIdleCallback(id); } : undefined,
            MutationObserver: observer(root.MutationObserver),
            ResizeObserver: observer(root.ResizeObserver),
            IntersectionObserver: observer(root.IntersectionObserver),
            BroadcastChannel: root.BroadcastChannel ? class extends root.BroadcastChannel {
                constructor(name) {
                    super(name);
                    r.closers.add(this);
                }
            } : undefined,
            Worker: root.Worker ? class extends root.Worker {
                constructor(url, opts) {
                    super(url, opts);
                    r.workers.add(this);
                }
            } : undefined,
            fetch(input, init) {
                const signal = seg.ctl.signal;
                const opts = init && typeof init === 'object' ? init : {};
                return root.fetch(input, withSignal(opts, signal));
            }
        };
    }

    /** URL.createObjectURL made by segment code is revoked on unload. */
    let urlHooked = false;
    function hookObjectUrls() {
        if (urlHooked || !root.URL || typeof root.URL.createObjectURL !== 'function') return;
        urlHooked = true;
        const create = root.URL.createObjectURL;
        root.URL.createObjectURL = function createObjectURL(obj) {
            const url = create.call(this, obj);
            const seg = segments.size ? ownerOfCaller(1) : null;
            if (seg) seg.res.urls.add(url);
            return url;
        };
    }

    /**
     * The page-wide hooks. They live for the page, so they must not be created inside load(): a
     * minifier inlining them there (terser does, for single-use functions) makes every hook closure
     * keep load()'s scope, and so the first segment ever loaded, for good. ensureHooks has no segment
     * in scope and is exported (two uses), so it is not inlined into load().
     */
    function ensureHooks() {
        installHooks();
        hookObjectUrls();
        wrapRegistries();
    }

    // ---- load / unload -----------------------------------------------------------------------------

    function absolute(url) {
        return new URL(url, root.location.href).href;
    }

    function windowKeys() {
        return new Set(Object.getOwnPropertyNames(root));
    }

    async function runScript(seg, url) {
        const abs = absolute(url);
        const res = await root.fetch(abs, { credentials: 'same-origin', cache: 'no-cache' });
        if (!res.ok) throw new Error(`${seg.label}: ${new URL(abs).pathname} did not load (HTTP ${res.status})`);
        const code = await res.text();
        if (seg.ctl.signal.aborted) throw new Error(`${seg.label} was unloaded while loading`);
        const scope = seg.scope;
        const names = SCOPED.filter((n) => scope[n] !== undefined);
        let fn;
        try {
            // eslint-disable-next-line no-new-func
            fn = new Function(...names, `${code}\n//# sourceURL=${abs}`);
        } catch (err) {
            err.message = `${seg.label}: ${new URL(abs).pathname}: ${err.message}`;
            throw err;
        }
        const before = windowKeys();
        evaluating = seg;
        try {
            fn.apply(root, names.map((n) => scope[n]));
        } finally {
            evaluating = null;
            for (const k of Object.getOwnPropertyNames(root)) {
                if (!before.has(k)) seg.globals.add(k);
            }
        }
    }

    function addStyle(seg, href) {
        const link = root.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.melatonSegment = seg.key;
        const done = new Promise((resolve) => {
            link.onload = () => resolve();
            link.onerror = () => resolve();
        });
        root.document.head.appendChild(link);
        seg.styles.add(link);
        return done;
    }

    /**
     * Load a segment: its stylesheets (parallel), then its scripts in order, each in its own function
     * scope. A key that is already loaded resolves with the loaded segment.
     */
    function load(spec) {
        const s = spec || {};
        const key = String(s.key || '');
        if (!key) return Promise.reject(new Error('melatonSegments.load: key required'));
        const existing = segments.get(key);
        if (existing) return existing.ready;
        ensureHooks();

        const scripts = (s.scripts || []).map(absolute);
        const seg = {
            key,
            label: s.label || key,
            loadedAt: Date.now(),
            id: ++seq,
            ctl: new AbortController(),
            globals: new Set(),
            styles: new Set(),
            nodes: new Set(),
            owns: Array.isArray(s.owns) ? s.owns.slice() : [],
            undo: [],
            // stack frames of these URLs belong to the segment (the package folder, or each script)
            urlPrefixes: (s.urlPrefixes && s.urlPrefixes.length ? s.urlPrefixes.map(absolute) : scripts)
                .map((u) => u.split('?')[0]),
            res: {
                timeouts: new Set(), intervals: new Set(), frames: new Set(), idles: new Set(),
                observers: new Set(), closers: new Set(), workers: new Set(), urls: new Set()
            },
            data: s.data || null
        };
        seg.scope = scopeFor(seg);
        segments.set(key, seg);
        seg.ready = (async () => {
            await Promise.all((s.styles || []).map((href) => addStyle(seg, href)));
            for (const url of scripts) await runScript(seg, url);
            return seg;
        })();
        seg.ready.catch(() => {
            // a failed load leaves nothing behind
            if (segments.get(key) === seg) unload(key, 'load-failed');
        });
        return seg.ready;
    }

    /** Run fn as the segment (define() and other evaluation-time lookups see it as current). */
    function run(key, fn) {
        const seg = segments.get(key);
        const was = evaluating;
        evaluating = seg || null;
        try {
            return fn();
        } finally {
            evaluating = was;
        }
    }

    function removeNode(node) {
        try {
            if (root.contextMenu) {
                if (typeof root.contextMenu.detachFromElement === 'function') root.contextMenu.detachFromElement(node);
                if (typeof root.contextMenu.detachClickMenuFromElement === 'function') root.contextMenu.detachClickMenuFromElement(node);
            }
        } catch (_) { /* best effort */ }
        // the window stacks (modalUtils.js) keep removed windows unless told
        if (typeof root.forgetModalElement === 'function') {
            try { root.forgetModalElement(node); } catch (_) { /* best effort */ }
        }
        node.remove();
    }

    /**
     * Unload a segment: abort its signal (its listeners, fetches), stop its timers, observers,
     * channels and workers, revoke its object URLs, undo its registrations, remove its DOM and styles,
     * delete its globals. Returns what was released.
     */
    function unload(key, reason) {
        const seg = segments.get(key);
        if (!seg) return null;
        segments.delete(key);
        const r = seg.res;
        const released = {
            key,
            reason: reason || 'unload',
            timers: r.timeouts.size + r.intervals.size + r.frames.size + r.idles.size,
            observers: r.observers.size,
            undo: seg.undo.length,
            nodes: 0,
            styles: seg.styles.size,
            globals: [],
            kept: []
        };
        try { seg.ctl.abort(new Error(`${seg.label} unloaded`)); } catch (_) { seg.ctl.abort(); }
        r.timeouts.forEach((id) => root.clearTimeout(id));
        r.intervals.forEach((id) => root.clearInterval(id));
        r.frames.forEach((id) => root.cancelAnimationFrame(id));
        if (typeof root.cancelIdleCallback === 'function') r.idles.forEach((id) => root.cancelIdleCallback(id));
        r.observers.forEach((o) => { try { o.disconnect(); } catch (_) { /* gone */ } });
        r.closers.forEach((c) => { try { c.close(); } catch (_) { /* gone */ } });
        r.workers.forEach((w) => { try { w.terminate(); } catch (_) { /* gone */ } });
        r.urls.forEach((u) => { try { root.URL.revokeObjectURL(u); } catch (_) { /* gone */ } });
        for (const undo of seg.undo.splice(0).reverse()) {
            try { undo(); } catch (err) { console.warn(`[segments] ${seg.label}: an undo failed`, err); }
        }

        const doc = root.document;
        const nodes = new Set(seg.nodes);
        doc.querySelectorAll(`[data-melaton-segment="${CSS.escape(key)}"]`).forEach((n) => nodes.add(n));
        for (const sel of seg.owns) {
            try { doc.querySelectorAll(sel).forEach((n) => nodes.add(n)); } catch (_) { /* bad selector */ }
        }
        nodes.forEach((n) => {
            if (n.isConnected) released.nodes++;
            removeNode(n);
        });
        seg.styles.forEach((link) => link.remove());

        for (const k of seg.globals) {
            let gone = false;
            try { gone = delete root[k]; } catch (_) { gone = false; }
            if (gone && !(k in root)) released.globals.push(k);
            else {
                // not configurable (var / function at a page-global top level): drop the value at least
                try { root[k] = undefined; } catch (_) { /* read-only */ }
                released.kept.push(k);
            }
        }
        if (released.kept.length) console.warn(`[segments] ${seg.label}: globals that could not be deleted:`, released.kept);

        // forget everything; only the watch row (a WeakRef) points at the record now
        seg.globals.clear();
        seg.styles.clear();
        seg.nodes.clear();
        Object.values(r).forEach((set) => set.clear());
        seg.scope = null;
        seg.data = null;
        seg.ready = null;

        const token = {};
        const row = {
            key,
            label: seg.label,
            id: seg.id,
            state: 'unloaded',
            loadedAt: seg.loadedAt,
            unloadedAt: Date.now(),
            token,
            ref: typeof WeakRef === 'function' ? new WeakRef(seg) : null,
            released
        };
        history.push(row);
        if (history.length > 64) history.splice(0, history.length - 64);
        if (reclaimWatch) reclaimWatch.register(seg, token);
        return released;
    }

    /** The windows (.modal) a loaded segment owns that are on screen: its appended nodes, tagged ones, owns. */
    function windowsOf(key) {
        const seg = segments.get(key);
        if (!seg) return [];
        const doc = root.document;
        const all = new Set();
        const add = (n) => {
            if (!n || n.nodeType !== 1 || !n.isConnected) return;
            if (n.classList.contains('modal')) all.add(n);
            n.querySelectorAll('.modal').forEach((m) => all.add(m));
        };
        seg.nodes.forEach(add);
        doc.querySelectorAll(`[data-melaton-segment="${CSS.escape(key)}"]`).forEach(add);
        for (const sel of seg.owns) {
            try { doc.querySelectorAll(sel).forEach(add); } catch (_) { /* bad selector */ }
        }
        return Array.from(all).filter((m) => !m.classList.contains('hidden'));
    }

    function report() {
        const rows = [];
        for (const seg of segments.values()) rows.push({ key: seg.key, label: seg.label, id: seg.id, state: 'loaded', loadedAt: seg.loadedAt, globals: Array.from(seg.globals) });
        for (const h of history) {
            if (h.state === 'unloaded' && h.ref && !h.ref.deref()) h.state = 'reclaimed';
            rows.push({ key: h.key, label: h.label, id: h.id, state: h.state, loadedAt: h.loadedAt, unloadedAt: h.unloadedAt, reclaimedAt: h.reclaimedAt || null, released: h.released });
        }
        return rows;
    }

    root.melatonSegments = {
        load,
        unload,
        run,
        report,
        ownerOfCaller,
        ensureHooks,
        windowsOf,
        get: (key) => segments.get(key) || null,
        loaded: () => Array.from(segments.keys()),
        current: () => evaluating
    };
})(window);
