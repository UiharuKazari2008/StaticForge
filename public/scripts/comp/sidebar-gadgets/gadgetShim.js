/**
 * First script of every hosted Sidebar gadget page (Yozora #629; scripts/import-vista-gadget.js
 * puts it there). The page runs in an iframe of the Sidebar (public/scripts/comp/vistaGadgetHost.js).
 *
 *   System                     the Sidebar's object model, from the host (vistaGadgetHost.attach)
 *   IE 7 APIs                  attachEvent / detachEvent, currentStyle, document.parentWindow,
 *                              setCapture / releaseCapture, a few ActiveX objects
 *   <g:background> <g:image>   the Sidebar's image layer: src, opacity, addImageObject,
 *                              addTextObject, removeObjects, and image properties (left, top,
 *                              width, height, opacity, rotation)
 *
 * Plain ES5 on purpose: it shares the page with code written for Internet Explorer 7.
 */
(function () {
    'use strict';

    var host = null;
    try {
        host = window.parent && window.parent !== window ? window.parent.vsbGadgetHost : null;
    } catch (_e) {
        host = null;
    }
    var system = host ? host.attach(window) : null;
    if (!system) {
        // opened on its own: enough of System for the page not to throw
        var store = {};
        system = {
            Gadget: {
                docked: true, visible: true, name: '', version: '', path: '', settingsUI: '', background: '',
                document: document,
                Settings: {
                    read: function (k) { return store[k] === undefined ? '' : store[k]; },
                    readString: function (k) { return store[k] === undefined ? '' : String(store[k]); },
                    write: function (k, v) { store[k] = v; },
                    writeString: function (k, v) { store[k] = String(v); }
                },
                Flyout: { file: '', show: false, document: null },
                beginTransition: function () {}, endTransition: function () {}, TransitionType: { none: 0, morph: 1 }
            },
            Sound: { playSound: function () {}, beep: function () {} },
            Time: { currentTimeZone: {}, getLocalTime: function () { return new Date().toString(); } },
            Shell: { execute: function () {} },
            Debug: { outputString: function () {} }
        };
    }
    window.System = system;
    // the host keeps a gadget's script errors with it (vistaGadgetHost.js vghError)
    if (host && host.error) {
        window.addEventListener('error', function (e) {
            try { host.error(window, e.message, e.filename, e.lineno); } catch (_e) { /* host gone */ }
        });
    }

    // A gadget shares the desktop's thread: a modal alert() would stop all of Dreamscape.
    // The host shows the text without blocking; confirm() says yes, prompt() takes its default.
    window.alert = function (text) {
        if (host && host.notice) host.notice(window, text);
    };
    window.confirm = function (text) {
        if (host && host.notice) host.notice(window, text);
        return true;
    };
    window.prompt = function (_text, value) {
        return value === undefined ? null : String(value);
    };

    // ------------------------------------------------------------ IE 7 APIs

    // The Sidebar ran gadgets in Internet Explorer 7; some refuse "Netscape" outright
    var IE_UA = 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0; SLCC1; .NET CLR 2.0.50727; Media Center PC 5.0; .NET CLR 3.0.04506)';
    [['appName', 'Microsoft Internet Explorer'], ['appVersion', IE_UA.slice(8)], ['userAgent', IE_UA],
        ['appCodeName', 'Mozilla'], ['appMinorVersion', '0'], ['browserLanguage', 'en-us'], ['userLanguage', 'en-us'],
        ['systemLanguage', 'en-us'], ['cpuClass', 'x86'], ['platform', 'Win32']].forEach(function (pair) {
        try {
            Object.defineProperty(Navigator.prototype, pair[0], { configurable: true, get: function () { return pair[1]; } });
        } catch (_e) { /* left as the browser's */ }
    });

    var listeners = typeof WeakMap === 'function' ? new WeakMap() : null;
    function attachEvent(name, fn) {
        if (typeof fn !== 'function') return false;
        var type = String(name).replace(/^on/i, '').toLowerCase();
        var target = this;
        var wrapped = function (e) { return fn.call(target, e); };
        if (listeners) {
            var map = listeners.get(fn) || [];
            map.push({ target: target, type: type, wrapped: wrapped });
            listeners.set(fn, map);
        }
        target.addEventListener(type, wrapped, false);
        return true;
    }
    function detachEvent(name, fn) {
        if (!listeners || typeof fn !== 'function') return;
        var type = String(name).replace(/^on/i, '').toLowerCase();
        var target = this;
        var map = listeners.get(fn) || [];
        for (var i = map.length - 1; i >= 0; i--) {
            if (map[i].target === target && map[i].type === type) {
                target.removeEventListener(type, map[i].wrapped, false);
                map.splice(i, 1);
            }
        }
    }
    [window, Document.prototype, Element.prototype].forEach(function (o) {
        if (!o.attachEvent) {
            o.attachEvent = attachEvent;
            o.detachEvent = detachEvent;
        }
    });
    if (!('currentStyle' in Element.prototype)) {
        Object.defineProperty(Element.prototype, 'currentStyle', {
            configurable: true,
            get: function () { return window.getComputedStyle(this); }
        });
    }
    // IE's runtimeStyle: the element's style here
    if (!('runtimeStyle' in Element.prototype)) {
        Object.defineProperty(Element.prototype, 'runtimeStyle', {
            configurable: true,
            get: function () { return this.style; }
        });
    }
    if (!('parentWindow' in Document.prototype)) {
        Object.defineProperty(Document.prototype, 'parentWindow', {
            configurable: true,
            get: function () { return this.defaultView; }
        });
    }
    // IE let a page keep document.getElementById in a variable and call it bare (var O = document.getElementById)
    ['getElementsByTagName', 'getElementsByName', 'createElement'].forEach(function (name) {
        var orig = Document.prototype[name];
        Document.prototype[name] = function () {
            return orig.apply(this instanceof Document ? this : document, arguments);
        };
    });
    // and IE 7's getElementById ignored case and matched name= too (sDrive1 for 'sdrive1')
    var byId = Document.prototype.getElementById;
    Document.prototype.getElementById = function (id) {
        var doc = this instanceof Document ? this : document;
        var hit = byId.call(doc, id);
        if (hit || id == null || id === '') return hit;
        var q = String(id).replace(/["\\]/g, '\\$&');
        try {
            return doc.querySelector('[id="' + q + '" i]') || doc.querySelector('[name="' + q + '" i]');
        } catch (_e) {
            return null;
        }
    };

    // IE's document.all(name, index): the index-th element with that id or name (Chrome takes one argument)
    var allDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'all');
    if (allDesc && allDesc.get && allDesc.configurable && typeof Proxy === 'function') {
        Object.defineProperty(Document.prototype, 'all', {
            configurable: true,
            get: function () {
                var doc = this;
                if (doc.__gadgetAll) return doc.__gadgetAll;
                var coll = allDesc.get.call(doc);
                var call = function (name, index) {
                    if (typeof name === 'number') return coll[name] || null;
                    var hit = coll.namedItem(String(name));
                    if (hit && !hit.nodeType) return index === undefined ? hit : (hit[index] || null);
                    return index === undefined || index === 0 ? hit : null;
                };
                var all = new Proxy(call, {
                    get: function (_t, key) {
                        if (key === 'tags') return function (tag) { return doc.getElementsByTagName(tag); };
                        if (key === 'item' || key === 'namedItem') return call;
                        var v = coll[key];
                        return typeof v === 'function' ? v.bind(coll) : v;
                    },
                    has: function (_t, key) { return key in coll; }
                });
                doc.__gadgetAll = all;
                return all;
            }
        });
    }
    // MSXML's node.text and node.xml (an XML element has no HTML .text of its own)
    if (!('text' in Element.prototype)) {
        Object.defineProperty(Element.prototype, 'text', {
            configurable: true,
            get: function () { return this.textContent; },
            set: function (v) { this.textContent = v; }
        });
    }
    if (!('xml' in Node.prototype)) {
        Object.defineProperty(Node.prototype, 'xml', {
            configurable: true,
            get: function () { return new XMLSerializer().serializeToString(this); }
        });
    }
    // element.all (IE): the element's descendants, with tags(name)
    if (!('all' in Element.prototype)) {
        Object.defineProperty(Element.prototype, 'all', {
            configurable: true,
            get: function () {
                var list = this.getElementsByTagName('*');
                var el = this;
                return new Proxy(list, {
                    get: function (t, key) {
                        if (key === 'tags') return function (tag) { return el.getElementsByTagName(tag); };
                        if (key === 'item') return function (i) { return typeof i === 'number' ? t[i] : (t.namedItem(i)); };
                        var v = t[key];
                        if (v === undefined && typeof key === 'string' && isNaN(Number(key))) v = t.namedItem(key);
                        return typeof v === 'function' ? v.bind(t) : v;
                    }
                });
            }
        });
    }
    if (!Element.prototype.setCapture) {
        Element.prototype.setCapture = function () {};
        Element.prototype.releaseCapture = function () {};
        Document.prototype.releaseCapture = function () {};
    }
    if (!('filters' in Element.prototype)) {
        // IE's DirectX filters: alpha(opacity=n) maps to opacity, the rest draw nothing
        Object.defineProperty(Element.prototype, 'filters', {
            configurable: true,
            get: function () {
                var el = this;
                var alpha = {
                    get opacity() { var o = parseFloat(el.style.opacity); return isNaN(o) ? 100 : Math.round(o * 100); },
                    set opacity(v) { el.style.opacity = String(Math.max(0, Math.min(100, Number(v) || 0)) / 100); },
                    enabled: true
                };
                return { alpha: alpha, item: function () { return alpha; }, length: 1 };
            }
        });
    }

    // ------------------------------------------------------------ the web (modules/vistaGadgetProxy.js)

    // A gadget's page loads only from Dreamscape (its CSP): remote XML and pictures come through the
    // server's proxy, synchronous XMLHttpRequests included
    var PROXY = '/gadget-proxy?url=';
    function proxied(raw) {
        var s = String(raw == null ? '' : raw).replace(/\\/g, '/');
        // "/wrong.png" set from script meant the gadget's root to the Sidebar
        // (Dreamscape's own picture routes stay: System.Gadget.picture is a /previews/ address)
        if (/^\/(?!\/|static_images\/|gadget-proxy|gadget-stream|scripts\/|sounds\/|previews\/|cache\/|naxCache\/)/.test(s) && system.Gadget && system.Gadget.path) return system.Gadget.path + s;
        // file:/// paths into a gadget package (from System.Shell items' paths): served here
        var local = /^file:\/+(static_images\/vista-gadgets\/.*)$/i.exec(s);
        if (local) return '/' + local[1];
        if (!/^https?:\/\//i.test(s)) return null;
        try {
            if (new URL(s).origin === location.origin) return null;
        } catch (_e) {
            return null;
        }
        return PROXY + encodeURIComponent(s);
    }
    var xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        var via = proxied(url);
        if (via) args[1] = via;
        return xhrOpen.apply(this, args);
    };
    var imgSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (imgSrc && imgSrc.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            configurable: true,
            get: imgSrc.get,
            set: function (v) { imgSrc.set.call(this, proxied(v) || v); }
        });
    }
    // scripts never come from the web, but a gadget's own file:/// paths do load
    function localOnly(raw) {
        var via = proxied(raw);
        return via && via.charAt(0) === '/' && via.indexOf(PROXY) !== 0 ? via : null;
    }
    var scriptSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    if (scriptSrc && scriptSrc.set) {
        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
            configurable: true,
            get: scriptSrc.get,
            set: function (v) { scriptSrc.set.call(this, localOnly(v) || v); }
        });
    }
    var setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if (String(name).toLowerCase() === 'src') {
            var via = this.tagName === 'IMG' ? proxied(value) : (this.tagName === 'SCRIPT' ? localOnly(value) : null);
            if (via) return setAttr.call(this, name, via);
        }
        return setAttr.call(this, name, value);
    };
    // document.write('<script src="file:///...">'): the gadget's own files, by URL
    ['write', 'writeln'].forEach(function (name) {
        var orig = Document.prototype[name];
        Document.prototype[name] = function () {
            var args = Array.prototype.map.call(arguments, function (html) {
                return String(html).replace(/((?:src|href)\s*=\s*["']?)file:\/+(static_images\/vista-gadgets\/)/gi, '$1/$2');
            });
            return orig.apply(this, args);
        };
    });

    // <img src="http://..."> in the page's own markup
    function proxyImages(root) {
        var imgs = root.getElementsByTagName ? root.getElementsByTagName('img') : [];
        for (var i = 0; i < imgs.length; i++) {
            var via = proxied(imgs[i].getAttribute('src'));
            if (via) setAttr.call(imgs[i], 'src', via);
        }
    }
    document.addEventListener('DOMContentLoaded', function () { proxyImages(document); });

    // A web page framed in the gadget (IMDB's results flyout): Alchemy shows it instead, the flyout closes
    function webFrames(node) {
        var frames = node.tagName === 'IFRAME' ? [node] : (node.getElementsByTagName ? node.getElementsByTagName('iframe') : []);
        for (var i = 0; i < frames.length; i++) {
            var src = frames[i].getAttribute('src') || '';
            if (!/^https?:\/\//i.test(src)) continue;
            try { if (new URL(src).origin === location.origin) continue; } catch (_e) { continue; }
            setAttr.call(frames[i], 'src', 'about:blank');
            if (system.Shell && system.Shell.execute) system.Shell.execute(src);
            try {
                if (system.Gadget.document !== document && system.Gadget.Flyout) system.Gadget.Flyout.show = false;
            } catch (_e) { /* not a flyout */ }
        }
    }
    new MutationObserver(function (records) {
        for (var r = 0; r < records.length; r++) {
            for (var n = 0; n < records[r].addedNodes.length; n++) {
                if (records[r].addedNodes[n].nodeType === 1) webFrames(records[r].addedNodes[n]);
            }
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // ------------------------------------------------------------ ActiveX

    function speak(text) {
        if (!window.speechSynthesis) return;
        try {
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(String(text)));
        } catch (_e) { /* no voice */ }
    }

    /** Microsoft.XMLDOM over DOMParser: load (same origin, synchronous like IE), loadXML, selectNodes. */
    function XmlDom() {
        this.async = false;
        this.documentElement = null;
        this.parseError = { errorCode: 0, reason: '' };
        this._doc = null;
    }
    XmlDom.prototype._set = function (doc) {
        this._doc = doc;
        var bad = !doc || doc.getElementsByTagName('parsererror').length;
        // IE's parseError coerces to its errorCode: xmlDoc.parseError != "0"
        var code = bad ? 1 : 0;
        this.parseError = { errorCode: code, reason: bad ? 'parse error' : '', valueOf: function () { return code; }, toString: function () { return String(code); } };
        this.documentElement = bad ? null : doc.documentElement;
        this.xml = bad ? '' : new XMLSerializer().serializeToString(doc);
        return !bad;
    };
    XmlDom.prototype.loadXML = function (text) {
        return this._set(new DOMParser().parseFromString(String(text), 'text/xml'));
    };
    XmlDom.prototype.load = function (url) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', String(url).replace(/\\/g, '/'), false);
            xhr.send();
            return this.loadXML(xhr.responseText);
        } catch (_e) {
            return this._set(null);
        }
    };
    XmlDom.prototype.selectNodes = function (xpath) {
        var out = [];
        if (!this._doc) return out;
        var r = this._doc.evaluate(xpath, this._doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (var i = 0; i < r.snapshotLength; i++) out.push(r.snapshotItem(i));
        out.item = function (n) { return out[n]; };
        return out;
    };
    XmlDom.prototype.selectSingleNode = function (xpath) {
        return this.selectNodes(xpath)[0] || null;
    };
    XmlDom.prototype.getElementsByTagName = function (name) {
        return this._doc ? this._doc.getElementsByTagName(name) : [];
    };
    XmlDom.prototype.setProperty = function () {};

    /**
     * Windows Media Player (WMPlayer.OCX and <object classid="6BF52A52-...">) over an <audio>:
     * URL, controls, settings, playState, status, and its StatusChange / PlayStateChange events.
     * A station on the web plays through the server's relay (/gadget-stream).
     */
    var STREAM = '/gadget-stream?url=';
    function mediaUrl(raw) {
        var s = String(raw == null ? '' : raw).replace(/\\/g, '/').trim();
        if (/^(mms|rtsp|mmsh?):\/\//i.test(s)) s = s.replace(/^[a-z]+:/i, 'http:');
        if (/^https?:\/\//i.test(s)) {
            try { if (new URL(s).origin === location.origin) return s; } catch (_e) { return ''; }
            return STREAM + encodeURIComponent(s);
        }
        return s;
    }
    function MediaPlayer() {
        var audio = new Audio();
        var self = this;
        var handlers = {};
        var state = 0;
        var status = '';
        var url = '';
        this._audio = audio;
        var fire = function (name, arg) {
            (handlers[name] || []).forEach(function (fn) { try { fn(arg); } catch (_e) { /* the gadget's */ } });
        };
        var setState = function (n, text) {
            state = n;
            status = text;
            fire('PlayStateChange', n);
            fire('StatusChange');
        };
        audio.addEventListener('loadstart', function () { if (url) setState(9, 'Connecting...'); });
        audio.addEventListener('waiting', function () { setState(6, 'Buffering...'); });
        audio.addEventListener('playing', function () { setState(3, 'Playing'); });
        audio.addEventListener('pause', function () { if (state !== 1) setState(2, 'Paused'); });
        audio.addEventListener('ended', function () { setState(8, 'Media ended'); });
        audio.addEventListener('error', function () { if (url) setState(10, 'The station could not be played'); });
        this.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); };
        this.controls = {
            play: function () { if (audio.src) audio.play().catch(function () {}); },
            stop: function () { audio.pause(); try { audio.currentTime = 0; } catch (_e) { /* a stream */ } setState(1, 'Stopped'); },
            pause: function () { audio.pause(); },
            isAvailable: function () { return true; },
            get currentPosition() { return audio.currentTime; },
            set currentPosition(v) { audio.currentTime = Number(v) || 0; }
        };
        this.settings = {
            get volume() { return Math.round(audio.volume * 100); },
            set volume(v) { audio.volume = Math.max(0, Math.min(100, Number(v) || 0)) / 100; },
            get mute() { return audio.muted; },
            set mute(v) { audio.muted = !!v; },
            autoStart: true
        };
        Object.defineProperty(this, 'URL', {
            get: function () { return url; },
            set: function (v) {
                url = String(v || '');
                audio.src = mediaUrl(url);
                if (self.settings.autoStart && url) audio.play().catch(function () {});
            }
        });
        Object.defineProperty(this, 'playState', { get: function () { return state; } });
        Object.defineProperty(this, 'status', { get: function () { return status; } });
        Object.defineProperty(this, 'currentMedia', { get: function () { return { name: url.split('/').pop(), duration: audio.duration || 0, durationString: '' }; } });
        this.uiMode = 'none';
        this.close = function () { audio.pause(); audio.removeAttribute('src'); setState(1, 'Stopped'); };
    }

    // <object classid="CLSID:6BF52A52-..."> (Windows Media Player) and its <script for=id event="...">
    function upgradeMediaObjects() {
        var objs = document.getElementsByTagName('object');
        for (var i = 0; i < objs.length; i++) {
            var obj = objs[i];
            var cls = String(obj.getAttribute('classid') || '') + ' ' + String(obj.getAttribute('type') || '');
            if (obj.__wmp || !/6BF52A52|22D6F312|x-ms-wmp|x-mplayer2/i.test(cls)) continue;
            var player = new MediaPlayer();
            obj.__wmp = player;
            ['URL', 'controls', 'settings', 'playState', 'status', 'currentMedia', 'close', 'uiMode'].forEach(function (k) {
                Object.defineProperty(obj, k, {
                    configurable: true,
                    get: function () { return this.__wmp[k]; },
                    set: function (v) { this.__wmp[k] = v; }
                });
            });
            obj.attachEvent = function (name, fn) { this.__wmp.on(String(name).replace(/^on/i, ''), fn); return true; };
            var params = obj.getElementsByTagName('param');
            for (var p = 0; p < params.length; p++) {
                var n = String(params[p].getAttribute('name') || '').toLowerCase();
                var v = params[p].getAttribute('value');
                if (n === 'autostart') player.settings.autoStart = !/^(false|0)$/i.test(v);
                if (n === 'volume') player.settings.volume = v;
            }
            var scripts = obj.id ? document.querySelectorAll('script[for="' + obj.id + '"]') : [];
            for (var sIdx = 0; sIdx < scripts.length; sIdx++) {
                var m = /^\s*(\w+)\s*\(([^)]*)\)/.exec(scripts[sIdx].getAttribute('event') || '');
                if (!m) continue;
                try {
                    player.on(m[1], new Function(m[2], scripts[sIdx].text));
                } catch (_e) { /* not JScript */ }
            }
            for (var q = 0; q < params.length; q++) {
                if (String(params[q].getAttribute('name') || '').toLowerCase() === 'url' && params[q].getAttribute('value')) player.URL = params[q].getAttribute('value');
            }
        }
    }
    document.addEventListener('DOMContentLoaded', upgradeMediaObjects);

    // JScript's Enumerator over WMI sets (vistaGadgetHost.js vghWmiSet), arrays and FSO collections
    function Enumerator(collection) {
        var list = [];
        if (collection && typeof collection.length === 'number') list = collection;
        else if (collection && typeof collection.Count === 'number' && collection.Item) {
            for (var i = 0; i < collection.Count; i++) list.push(collection.Item(i));
        }
        this._list = list;
        this._i = 0;
    }
    Enumerator.prototype.atEnd = function () { return this._i >= this._list.length; };
    Enumerator.prototype.item = function () { return this._list[this._i]; };
    Enumerator.prototype.moveNext = function () { this._i += 1; };
    Enumerator.prototype.moveFirst = function () { this._i = 0; };
    if (!window.Enumerator) window.Enumerator = Enumerator;

    // VBArray(x).toArray(): WMI's array properties (IPAddress ...) arrive already wrapped
    function VBArray(value) {
        if (!(this instanceof VBArray)) return new VBArray(value);
        this._a = value && value.__vbarray ? value.__vbarray : (Array.isArray(value) ? value : []);
    }
    VBArray.prototype.toArray = function () { return this._a.slice(); };
    VBArray.prototype.getItem = function (i) { return this._a[i]; };
    VBArray.prototype.ubound = function () { return this._a.length - 1; };
    VBArray.prototype.lbound = function () { return 0; };
    VBArray.prototype.dimensions = function () { return 1; };
    if (!window.VBArray) window.VBArray = VBArray;

    // GetObject("winmgmts:..."): WMI over the server's figures
    if (!window.GetObject) {
        window.GetObject = function (moniker) {
            var svc = host && host.wmi ? host.wmi(window, moniker) : null;
            if (!svc) throw new Error('Automation server can\'t create object');
            return svc;
        };
    }

    function ActiveXObject(progId) {
        var id = String(progId || '').toLowerCase();
        if (/xmldom|domdocument/.test(id)) return new XmlDom();
        if (/xmlhttp/.test(id)) return new XMLHttpRequest();
        if (id === 'shell.application') {
            // Explorer's automation: folders hold nothing here; ShellExecute of a web address opens Alchemy
            var noItem = { Name: '', Path: '', InvokeVerb: function () {}, Verbs: function () { return { Count: 0 }; } };
            var noFolder = { Self: noItem, Title: '', ParseName: function () { return noItem; }, Items: function () { return { Count: 0, Item: function () { return null; } }; } };
            return {
                NameSpace: function () { return noFolder; },
                ShellExecute: function (file) { if (system.Shell && /^https?:/i.test(String(file))) system.Shell.execute(file); },
                Open: function () {}, Explore: function () {}, MinimizeAll: function () {}, UndoMinimizeALL: function () {},
                Windows: function () { return { Count: 0, Item: function () { return null; } }; }
            };
        }
        if (id === 'nicgadget.networkinformation' && host && host.netlib) return host.netlib(window);
        if (id === 'wbemscripting.swbemlocator') {
            return {
                ConnectServer: function (_server, ns) { return window.GetObject('winmgmts:\\\\.\\' + (ns || 'root\\cimv2')); },
                Security_: { ImpersonationLevel: 3 }
            };
        }
        if (id === 'sapi.spvoice') return { Speak: speak, speak: speak, Volume: 100, Rate: 0 };
        if (id === 'wmplayer.ocx' || id === 'wmplayer.ocx.7') return new MediaPlayer();
        if (id === 'wscript.shell') {
            return {
                Run: function (cmd) { if (system.Shell && /^https?:/i.test(String(cmd))) system.Shell.execute(cmd); return 0; },
                RegRead: function () { return ''; },
                RegWrite: function () {},
                ExpandEnvironmentStrings: function (s) { return s; },
                Popup: function (text) { window.alert(text); return 1; }
            };
        }
        if (id === 'scripting.filesystemobject') {
            // drives are the server's (System.Shell.drive); files never exist
            var fsoDrive = function (letter) {
                var d = system.Shell && system.Shell.drive ? system.Shell.drive(letter) : null;
                if (!d) return null;
                return {
                    DriveLetter: d.name.charAt(0), Path: d.name, RootFolder: { Path: d.path }, DriveType: 2, IsReady: true,
                    // FileSystemObject counts bytes; System.Shell.drive megabytes
                    TotalSize: d.totalSize * 1048576, FreeSpace: d.freeSpace * 1048576, AvailableSpace: d.freeSpace * 1048576,
                    VolumeName: d.volumeLabel, FileSystem: d.fileSystem, SerialNumber: 0, ShareName: ''
                };
            };
            var fsoDrives = function () {
                var letters = system.Shell && system.Shell.Drive ? system.Shell.Drive.list : [];
                var list = [];
                for (var i = 0; i < letters.length; i++) { var d = fsoDrive(letters[i]); if (d) list.push(d); }
                list.Count = list.length;
                list.Item = function (key) { return typeof key === 'number' ? list[key] : fsoDrive(String(key)); };
                return list;
            };
            // text files: this gadget's own (localStorage through the host), else its package's copy
            var files = host && host.files ? host.files(window) : null;
            var packaged = function (fn) {
                try {
                    var xhr = new XMLHttpRequest();
                    xhr.open('GET', String(fn).replace(/\\/g, '/').replace(/^file:\/+/i, '/'), false);
                    xhr.send();
                    return xhr.status === 200 ? xhr.responseText : null;
                } catch (_e) {
                    return null;
                }
            };
            var reader = function (text) {
                var lines = String(text).split(/\r?\n/);
                var at = 0;
                return {
                    get AtEndOfStream() { return at >= lines.length || (at === lines.length - 1 && lines[at] === ''); },
                    ReadLine: function () { return at < lines.length ? lines[at++] : ''; },
                    ReadAll: function () { at = lines.length; return String(text); },
                    Read: function (n) { var rest = lines.slice(at).join('\r\n'); at = lines.length; return rest.slice(0, n); },
                    SkipLine: function () { at++; },
                    Close: function () {}
                };
            };
            var writer = function (fn, start) {
                var buf = start || '';
                var save = function () { if (files) files.write(fn, buf); };
                return {
                    Write: function (t) { buf += String(t); save(); },
                    WriteLine: function (t) { buf += (t === undefined ? '' : String(t)) + '\r\n'; save(); },
                    WriteBlankLines: function (n) { for (var i = 0; i < n; i++) buf += '\r\n'; save(); },
                    Close: save
                };
            };
            var readText = function (fn) {
                var mine = files ? files.read(fn) : null;
                return mine !== null && mine !== undefined ? mine : packaged(fn);
            };
            return {
                OpenTextFile: function (fn, mode) {
                    if (mode === 2) return writer(fn, '');
                    if (mode === 8) return writer(fn, readText(fn) || '');
                    var text = readText(fn);
                    if (text === null) throw new Error('File not found');
                    return reader(text);
                },
                CreateTextFile: function (fn) { return writer(fn, ''); },
                FileExists: function (fn) { return readText(fn) !== null; },
                DeleteFile: function (fn) { if (files) files.remove(fn); },
                GetFile: function (fn) { var t = readText(fn); if (t === null) throw new Error('File not found'); return { Name: String(fn).split(/[\\\/]/).pop(), Path: String(fn), Size: t.length, DateLastModified: new Date() }; },
                GetFileName: function (p) { return String(p).split(/[\\\/]/).pop(); },
                GetParentFolderName: function (p) { var s = String(p); var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')); return i < 0 ? '' : s.slice(0, i); },
                GetExtensionName: function (p) { var n = String(p).split(/[\\\/]/).pop(); return n.indexOf('.') < 0 ? '' : n.slice(n.lastIndexOf('.') + 1); },
                CreateFolder: function () {},
                get Drives() { return fsoDrives(); },
                GetDrive: function (spec) { var d = fsoDrive(String(spec)); if (!d) throw new Error('Drive not found'); return d; },
                DriveExists: function (spec) { return !!fsoDrive(String(spec)); },
                GetDriveName: function (p) { var m = /^([a-z]:)/i.exec(String(p)); return m ? m[1] : ''; },
                FolderExists: function () { return false; },
                GetSpecialFolder: function () { return { Path: '' }; },
                BuildPath: function (a, b) { return String(a) + '\\' + String(b); }
            };
        }
        throw new Error('Automation server can\'t create object: ' + progId);
    }
    if (!window.ActiveXObject) window.ActiveXObject = ActiveXObject;

    // ------------------------------------------------------------ <g:background>, <g:image>, <g:text>

    function gUrl(raw) {
        var v = String(raw || '').trim();
        var m = /^url\(\s*(['"]?)(.*?)\1\s*\)$/i.exec(v);
        if (m) v = m[2];
        if (!v) return '';
        v = v.replace(/\\/g, '/');
        try { return new URL(v, location.href).href; } catch (_e) { return ''; }
    }
    function isG(el, name) {
        return el && el.localName === 'g:' + name;
    }
    function px(n) {
        return (Number(n) || 0) + 'px';
    }

    /** An image of a g:background: an <img> with the Sidebar's g:image properties. */
    // Sidebar's softEdge: the image fades out over that many pixels at every edge
    function softEdgeMask(el, edge) {
        var e = Number(edge) || 0;
        var mask = e ? 'linear-gradient(to right, transparent, #000 ' + e + 'px, #000 calc(100% - ' + e + 'px), transparent), '
            + 'linear-gradient(to bottom, transparent, #000 ' + e + 'px, #000 calc(100% - ' + e + 'px), transparent)' : '';
        el.style.maskImage = el.style.webkitMaskImage = mask;
        el.style.maskComposite = e ? 'intersect' : '';
        el.style.webkitMaskComposite = e ? 'source-in' : '';
    }

    function gImage(parent, src, left, top) {
        var img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.style.position = 'absolute';
        img.style.pointerEvents = 'none';
        var state = { left: Number(left) || 0, top: Number(top) || 0, width: 0, height: 0, opacity: 100, rotation: 0, blur: 0, brightness: 0, softEdge: 0 };
        // Sidebar sizes an image object about its centre: the picture's own box stays put
        var paint = function () {
            var nw = img.naturalWidth || 0;
            var nh = img.naturalHeight || 0;
            var w = state.width || nw;
            var h = state.height || nh;
            img.style.width = w ? w + 'px' : '';
            img.style.height = h ? h + 'px' : '';
            img.style.left = px(state.left + (state.width && nw ? (nw - w) / 2 : 0));
            img.style.top = px(state.top + (state.height && nh ? (nh - h) / 2 : 0));
            img.style.opacity = String(state.opacity / 100);
            img.style.transformOrigin = '50% 50%';
            img.style.transform = state.rotation ? 'rotate(' + state.rotation + 'deg)' : '';
            var f = [];
            if (state.blur) f.push('blur(' + state.blur + 'px)');
            if (state.brightness) f.push('brightness(' + (1 + state.brightness / 100) + ')');
            img.style.filter = f.join(' ');
            softEdgeMask(img, state.softEdge);
        };
        ['left', 'top', 'width', 'height', 'opacity', 'rotation', 'blur', 'brightness', 'softEdge'].forEach(function (k) {
            Object.defineProperty(img, k, {
                configurable: true,
                get: function () { return k === 'width' ? (state.width || img.naturalWidth) : (k === 'height' ? (state.height || img.naturalHeight) : state[k]); },
                set: function (v) { state[k] = Number(v) || 0; paint(); }
            });
        });
        img.addGlow = function () {};
        img.addShadow = function (color, radius, alpha, dx, dy) {
            img.style.filter = (img.style.filter || '') + ' drop-shadow(' + px(dx) + ' ' + px(dy) + ' ' + px(radius) + ' ' + (color || 'black') + ')';
        };
        img.addEventListener('load', paint);
        img.src = gUrl(src);
        parent.appendChild(img);
        paint();
        return img;
    }

    function gText(parent, value, font, size, color, left, top) {
        var span = document.createElement('span');
        span.style.position = 'absolute';
        span.style.whiteSpace = 'nowrap';
        span.style.pointerEvents = 'none';
        var state = { value: String(value == null ? '' : value), font: font || 'Segoe UI', fontsize: Number(size) || 10, color: color || '#000', left: Number(left) || 0, top: Number(top) || 0, opacity: 100, rotation: 0, align: 0 };
        var paint = function () {
            span.textContent = state.value;
            span.style.fontFamily = state.font;
            span.style.fontSize = state.fontsize + 'pt';
            span.style.color = state.color;
            span.style.left = px(state.left);
            span.style.top = px(state.top);
            span.style.opacity = String(state.opacity / 100);
            span.style.transform = state.rotation ? 'rotate(' + state.rotation + 'deg)' : '';
        };
        Object.keys(state).forEach(function (k) {
            Object.defineProperty(span, k, {
                configurable: true,
                get: function () { return k === 'width' ? span.offsetWidth : state[k]; },
                set: function (v) { state[k] = (k === 'value' || k === 'font' || k === 'color') ? String(v) : (Number(v) || 0); paint(); }
            });
        });
        span.addGlow = function () {};
        span.addShadow = function () {};
        parent.appendChild(span);
        paint();
        return span;
    }

    function paintBackground(el) {
        var url = gUrl(el.getAttribute('src'));
        el.style.display = 'block';
        if (!el.style.position) el.style.position = 'absolute';
        if (!el.style.left && !el.style.right) el.style.left = '0px';
        if (!el.style.top && !el.style.bottom) el.style.top = '0px';
        if (el.style.zIndex === '') el.style.zIndex = '-1';
        el.style.backgroundImage = url ? 'url("' + url + '")' : '';
        el.style.backgroundRepeat = 'no-repeat';
        var opacity = el.getAttribute('opacity');
        el.style.opacity = opacity !== null && opacity !== '' ? String(Number(opacity) / 100) : '';
        // without a size of its own it takes the picture's
        if (url && (!el.style.width || !el.style.height)) {
            var probe = new Image();
            probe.onload = function () {
                if (!el.style.width) el.style.width = probe.naturalWidth + 'px';
                if (!el.style.height) el.style.height = probe.naturalHeight + 'px';
            };
            probe.src = url;
        }
    }

    function paintImage(el) {
        var url = gUrl(el.getAttribute('src'));
        el.style.display = 'inline-block';
        // VML images are placed by left / top, out of the flow
        if (el.localName === 'v:image' && !el.style.position) el.style.position = 'absolute';
        el.style.backgroundImage = url ? 'url("' + url + '")' : '';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundSize = '100% 100%';
        if (url && (!el.style.width || !el.style.height)) {
            var probe = new Image();
            probe.onload = function () {
                if (!el.style.width) el.style.width = probe.naturalWidth + 'px';
                if (!el.style.height) el.style.height = probe.naturalHeight + 'px';
            };
            probe.src = url;
        }
        var opacity = el.getAttribute('opacity');
        if (opacity !== null && opacity !== '') el.style.opacity = String(Number(opacity) / 100);
    }

    // VML shapes (<v:shape>, and 8GadgetPack's <g:shape>): path in coordsize units, drawn as SVG
    var SVGNS = 'http://www.w3.org/2000/svg';
    function isShape(el) {
        return el && /^(v|g):(shape|polyline|line|rect|roundrect|oval)$/.test(el.localName);
    }
    function vmlPathToSvg(path) {
        return String(path || '').replace(/([a-z]+)/gi, function (cmd) {
            switch (cmd.toLowerCase()) {
                case 'm': return ' M ';
                case 'l': return ' L ';
                case 'c': return ' C ';
                case 't': return ' m ';
                case 'r': return ' l ';
                case 'v': return ' c ';
                case 'x': return ' Z ';
                case 'e': case 'nf': case 'ns': return ' ';
                default: return ' ';
            }
        });
    }
    function lengthPx(v) {
        var n = parseFloat(v);
        if (isNaN(n)) return 1;
        return /pt$/i.test(String(v)) ? n * 4 / 3 : n;
    }
    function paintShape(el) {
        var size = (el.getAttribute('coordsize') || '1000 1000').split(/[\s,]+/).map(Number);
        var origin = (el.getAttribute('coordorigin') || '0 0').split(/[\s,]+/).map(Number);
        if (!el.style.position) el.style.position = 'absolute';
        el.style.display = 'block';
        var svg = el.__svg;
        if (!svg) {
            svg = document.createElementNS(SVGNS, 'svg');
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none';
            svg.appendChild(document.createElementNS(SVGNS, 'path'));
            el.appendChild(svg);
            el.__svg = svg;
        }
        svg.setAttribute('viewBox', (origin[0] || 0) + ' ' + (origin[1] || 0) + ' ' + (size[0] || 1000) + ' ' + (size[1] || 1000));
        var shape = svg.firstChild;
        var stroked = String(el.getAttribute('stroked') || 'true').toLowerCase() !== 'false';
        var filled = String(el.getAttribute('filled') || 'true').toLowerCase() !== 'false';
        shape.setAttribute('d', vmlPathToSvg(el.getAttribute('path')));
        shape.setAttribute('stroke', stroked ? (el.getAttribute('strokecolor') || 'black') : 'none');
        shape.setAttribute('stroke-width', String(lengthPx(el.getAttribute('strokeweight') || '0.75pt')));
        shape.setAttribute('vector-effect', 'non-scaling-stroke');
        shape.setAttribute('fill', filled ? (el.getAttribute('fillcolor') || 'white') : 'none');
    }
    var U0 = window.HTMLUnknownElement && HTMLUnknownElement.prototype;
    if (U0) {
        ['path', 'strokecolor', 'fillcolor', 'strokeweight', 'filled', 'stroked', 'coordsize', 'coordorigin'].forEach(function (name) {
            Object.defineProperty(U0, name, {
                configurable: true,
                get: function () { return this.getAttribute(name) || ''; },
                set: function (v) { setAttr.call(this, name, String(v)); if (isShape(this)) paintShape(this); }
            });
        });
    }

    // a VML / g: image's own transform: rotation about its centre, softEdge as a feathered blur
    function paintTransform(el) {
        var rot = Number(el.__rotation) || 0;
        el.style.transformOrigin = '50% 50%';
        el.style.transform = rot ? 'rotate(' + rot + 'deg)' : '';
        softEdgeMask(el, el.__softEdge);
    }
    // VML <v:textpath string=...> inside a <v:shape>: the text along the path's line, centred
    function paintTextPath(tp) {
        var shape = tp.parentNode;
        if (!shape) return;
        var span = shape.__text;
        if (!span) {
            span = document.createElement('span');
            span.style.cssText = 'position:absolute;left:50%;bottom:0;white-space:nowrap;pointer-events:none;transform-origin:50% 50%';
            shape.appendChild(span);
            shape.__text = span;
        }
        span.textContent = tp.__string || tp.getAttribute('string') || '';
        span.style.font = tp.style.font || '';
        var fill = shape.getElementsByTagName('v:fill')[0];
        span.style.color = (fill && (fill.__color || fill.getAttribute('color'))) || '#000';
        var path = shape.getElementsByTagName('v:path')[0];
        var m = path && /l\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/i.exec(path.__v || path.getAttribute('v') || '');
        var angle = m ? Math.atan2(Number(m[2]), Number(m[1])) * 180 / Math.PI : 0;
        span.style.transform = 'translateX(-50%) rotate(' + angle + 'deg)';
    }

    function paintG(el) {
        if (isShape(el)) paintShape(el);
        else if (isG(el, 'background')) paintBackground(el);
        else if (isG(el, 'image') || el.localName === 'v:image') { paintImage(el); paintTransform(el); }
        else if (el.localName === 'v:textpath') paintTextPath(el);
        else if (isG(el, 'text')) {
            el.style.position = el.style.position || 'absolute';
            el.style.whiteSpace = 'nowrap';
        }
    }

    var U = window.HTMLUnknownElement && HTMLUnknownElement.prototype;
    if (U) {
        Object.defineProperty(U, 'src', {
            configurable: true,
            get: function () { return this.getAttribute('src') || ''; },
            set: function (v) { this.setAttribute('src', String(v)); paintG(this); }
        });
        Object.defineProperty(U, 'opacity', {
            configurable: true,
            get: function () { var o = this.getAttribute('opacity'); return o === null || o === '' ? 100 : Number(o); },
            set: function (v) { this.setAttribute('opacity', String(v)); paintG(this); }
        });
        // image properties on <g:image> / <v:image> elements themselves
        ['rotation', 'softEdge', 'blur', 'brightness'].forEach(function (name) {
            Object.defineProperty(U, name, {
                configurable: true,
                get: function () { return this['__' + name] || 0; },
                set: function (v) { this['__' + name] = Number(v) || 0; paintTransform(this); }
            });
        });
        ['width', 'height'].forEach(function (name) {
            Object.defineProperty(U, name, {
                configurable: true,
                get: function () { return name === 'width' ? this.offsetWidth : this.offsetHeight; },
                set: function (v) { this.style[name] = (Number(v) || 0) + 'px'; }
            });
        });
        // VML: v:textpath.string, v:path.v, v:fill.color
        Object.defineProperty(U, 'string', {
            configurable: true,
            get: function () { return this.__string || ''; },
            set: function (v) { this.__string = String(v); paintTextPath(this); }
        });
        Object.defineProperty(U, 'v', {
            configurable: true,
            get: function () { return this.__v || ''; },
            set: function (v) { this.__v = String(v); var tp = this.parentNode && this.parentNode.getElementsByTagName('v:textpath')[0]; if (tp) paintTextPath(tp); }
        });
        Object.defineProperty(U, 'color', {
            configurable: true,
            get: function () { return this.__color || this.getAttribute('color') || ''; },
            set: function (v) { this.__color = String(v); var tp = this.parentNode && this.parentNode.getElementsByTagName('v:textpath')[0]; if (tp) paintTextPath(tp); }
        });
        U.addImageObject = function (src, left, top) {
            if (!this.style.backgroundImage && this.getAttribute('src')) paintG(this);
            return gImage(this, src, left, top);
        };
        U.addTextObject = function (value, font, size, color, left, top) {
            return gText(this, value, font, size, color, left, top);
        };
        U.removeObjects = function () {
            while (this.firstChild) this.removeChild(this.firstChild);
        };
    }

    function paintAll() {
        ['g:background', 'g:image', 'g:text', 'g:shape', 'v:shape', 'v:polyline', 'v:line', 'v:image'].forEach(function (tag) {
            var list = document.getElementsByTagName(tag);
            for (var i = 0; i < list.length; i++) paintG(list[i]);
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintAll);
    else paintAll();

    // #FF00FF was the Sidebar's transparency key for a gadget's window: a magenta background is no background
    function keyMagenta() {
        var els = [document.documentElement, document.body].concat(Array.prototype.slice.call(document.body ? document.body.getElementsByTagName('*') : [], 0, 400));
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el && window.getComputedStyle(el).backgroundColor === 'rgb(255, 0, 255)') el.style.backgroundColor = 'transparent';
        }
    }
    document.addEventListener('DOMContentLoaded', keyMagenta);
    window.addEventListener('load', keyMagenta);
}());
