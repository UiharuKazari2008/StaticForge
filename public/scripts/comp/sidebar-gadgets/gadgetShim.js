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
    if (!('parentWindow' in Document.prototype)) {
        Object.defineProperty(Document.prototype, 'parentWindow', {
            configurable: true,
            get: function () { return this.defaultView; }
        });
    }
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
        this.parseError = { errorCode: bad ? 1 : 0, reason: bad ? 'parse error' : '' };
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

    /** WMPlayer.OCX over an <audio>: URL, controls.play / stop / pause, settings.volume / mute, playState. */
    function MediaPlayer() {
        var audio = new Audio();
        var self = this;
        this._audio = audio;
        this.controls = {
            play: function () { audio.play().catch(function () {}); },
            stop: function () { audio.pause(); audio.currentTime = 0; },
            pause: function () { audio.pause(); },
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
            get: function () { return audio.src; },
            set: function (v) {
                audio.src = String(v || '').replace(/\\/g, '/');
                if (self.settings.autoStart && v) audio.play().catch(function () {});
            }
        });
        Object.defineProperty(this, 'playState', {
            get: function () { return audio.paused ? (audio.currentTime ? 2 : 1) : 3; }
        });
        this.close = function () { audio.pause(); audio.src = ''; };
    }

    function ActiveXObject(progId) {
        var id = String(progId || '').toLowerCase();
        if (/xmldom|domdocument/.test(id)) return new XmlDom();
        if (/xmlhttp/.test(id)) return new XMLHttpRequest();
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
            return {
                FileExists: function () { return false; },
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
    function gImage(parent, src, left, top) {
        var img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.style.position = 'absolute';
        img.style.left = px(left);
        img.style.top = px(top);
        img.style.pointerEvents = 'none';
        var state = { left: Number(left) || 0, top: Number(top) || 0, opacity: 100, rotation: 0, blur: 0, brightness: 0 };
        var paint = function () {
            img.style.left = px(state.left);
            img.style.top = px(state.top);
            img.style.opacity = String(state.opacity / 100);
            img.style.transform = state.rotation ? 'rotate(' + state.rotation + 'deg)' : '';
            var f = [];
            if (state.blur) f.push('blur(' + state.blur + 'px)');
            if (state.brightness) f.push('brightness(' + (1 + state.brightness / 100) + ')');
            img.style.filter = f.join(' ');
        };
        ['left', 'top', 'opacity', 'rotation', 'blur', 'brightness'].forEach(function (k) {
            Object.defineProperty(img, k, {
                configurable: true,
                get: function () { return state[k]; },
                set: function (v) { state[k] = Number(v) || 0; paint(); }
            });
        });
        img.addGlow = function () {};
        img.addShadow = function (color, radius, alpha, dx, dy) {
            img.style.filter = (img.style.filter || '') + ' drop-shadow(' + px(dx) + ' ' + px(dy) + ' ' + px(radius) + ' ' + (color || 'black') + ')';
        };
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

    function paintG(el) {
        if (isG(el, 'background')) paintBackground(el);
        else if (isG(el, 'image')) paintImage(el);
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
        ['g:background', 'g:image', 'g:text'].forEach(function (tag) {
            var list = document.getElementsByTagName(tag);
            for (var i = 0; i < list.length; i++) paintG(list[i]);
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintAll);
    else paintAll();
}());
