/**
 * The AmusementVISION box OSD page (Yozora #734, avOsd.js): what a box's OBS browser source
 * "AV OSD Overlay" loads. It draws the box's on-screen menu INTO THE BOX'S VIDEO OUTPUT, styled like a
 * hardware mixer's OSD, from state pushed over Server-Sent Events. Transparent when nothing is up.
 *
 *   GET /av-osd/:box?k=<token>          the page (no login: OBS's browser has none; the token is per box)
 *   GET /av-osd/:box/events?k=<token>   its event stream
 *
 * The page sends nothing back: keys come from QuickCast's remote over the Dreamscape websocket.
 */
'use strict';

const avOsd = require('./avOsd');

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>AV OSD</title>
<style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
body { font-family: 'Lucida Console', 'Consolas', 'Courier New', monospace; color: #e8eef6; -webkit-font-smoothing: none; }
/* everything is sized from the output height, so 720p and 1080p boxes draw the same OSD */
:root { --u: calc(100vh / 1080); }
#osd { position: absolute; left: calc(110 * var(--u)); top: calc(120 * var(--u)); width: calc(900 * var(--u)); display: none;
  background: rgba(6, 14, 30, 0.88); border: calc(3 * var(--u)) solid #c9d3df; box-shadow: 0 0 0 calc(3 * var(--u)) #000, calc(10 * var(--u)) calc(10 * var(--u)) 0 rgba(0,0,0,.45); }
#osd.on { display: block; }
.hd { display: flex; align-items: center; gap: calc(16 * var(--u)); height: calc(58 * var(--u)); padding: 0 calc(20 * var(--u)); background: linear-gradient(#2a4f86, #173361); border-bottom: calc(3 * var(--u)) solid #c9d3df; }
.brand { font: bold calc(20 * var(--u)) Arial, sans-serif; letter-spacing: calc(2 * var(--u)); color: #fff; }
.brand b { color: #6fb6ff; }
.unit { margin-left: auto; font-size: calc(20 * var(--u)); color: #ffd54a; }
.ttl { display: flex; align-items: baseline; justify-content: space-between; height: calc(54 * var(--u)); padding: 0 calc(20 * var(--u)); border-bottom: calc(2 * var(--u)) solid #34507a; font-size: calc(30 * var(--u)); letter-spacing: calc(3 * var(--u)); line-height: calc(54 * var(--u)); }
.ttl small { font-size: calc(18 * var(--u)); color: #8ea4c2; letter-spacing: 0; }
.rows { padding: calc(8 * var(--u)) 0; min-height: calc(46 * 6 * var(--u)); }
.row { display: flex; align-items: center; height: calc(46 * var(--u)); padding: 0 calc(20 * var(--u)); font-size: calc(26 * var(--u)); white-space: nowrap; }
.row .l { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.row .v { margin-left: calc(20 * var(--u)); color: #9fe3b0; overflow: hidden; text-overflow: ellipsis; max-width: 55%; }
.row .t { margin-left: calc(12 * var(--u)); font-size: calc(16 * var(--u)); color: #8ea4c2; border: calc(2 * var(--u)) solid #34507a; padding: 0 calc(6 * var(--u)); }
.row.nav .v::after { content: '\\25B6'; color: #8ea4c2; }
.row.sel { background: #ffd54a; color: #0a1220; }
.row.sel .v, .row.sel .t { color: #0a1220; border-color: #0a1220; }
.row.sel.pick .v::before, .row.sel.adjust .v::before { content: '\\25C4 '; }
.row.sel.pick .v::after, .row.sel.adjust .v::after { content: ' \\25BA'; }
.row.changed .v { color: #ff9f43; }
.row.sel.changed .v { color: #7a2d00; }
.row.ok .v { color: #6bf08a; }
.row.warn .v { color: #ffcf70; }
.row.bad .v { color: #ff6b5e; }
.row.on .v { color: #ff5a4f; }
.row.blink .v { animation: bl 0.8s steps(1, end) infinite; }
@keyframes bl { 50% { visibility: hidden; } }
.row.info { color: #c6d0dc; }
.more { height: calc(22 * var(--u)); padding: 0 calc(20 * var(--u)); font-size: calc(18 * var(--u)); color: #8ea4c2; }
.ft { display: flex; flex-wrap: wrap; gap: calc(6 * var(--u)) calc(26 * var(--u)); padding: calc(12 * var(--u)) calc(20 * var(--u)); border-top: calc(2 * var(--u)) solid #34507a; font-size: calc(18 * var(--u)); color: #8ea4c2; }
.ft b { color: #e8eef6; }
.hint { min-height: calc(30 * var(--u)); padding: calc(4 * var(--u)) calc(20 * var(--u)) 0; font-size: calc(20 * var(--u)); color: #ffd54a; }
#toast { position: absolute; left: 50%; bottom: calc(150 * var(--u)); transform: translateX(-50%); display: none; padding: calc(12 * var(--u)) calc(28 * var(--u)); background: rgba(6, 14, 30, 0.92); border: calc(3 * var(--u)) solid #ffd54a; font-size: calc(28 * var(--u)); color: #ffd54a; white-space: nowrap; }
#toast.on { display: block; }
#strip { position: absolute; left: calc(40 * var(--u)); right: calc(40 * var(--u)); bottom: calc(40 * var(--u)); display: none; gap: calc(30 * var(--u)); padding: calc(8 * var(--u)) calc(18 * var(--u)); background: rgba(6, 14, 30, 0.85); border: calc(2 * var(--u)) solid #c9d3df; font-size: calc(22 * var(--u)); }
#strip.on { display: flex; }
#strip span { color: #8ea4c2; }
#strip b { color: #e8eef6; font-weight: normal; }
#strip .u { color: #ffd54a; }
#off { position: absolute; right: calc(40 * var(--u)); top: calc(40 * var(--u)); display: none; padding: calc(8 * var(--u)) calc(16 * var(--u)); background: rgba(80, 0, 0, 0.85); font-size: calc(20 * var(--u)); }
</style></head>
<body>
<div id="osd"><div class="hd"><span class="brand">Amusement<b>VISION</b></span><span class="unit" id="unit"></span></div>
<div class="ttl"><span id="title"></span><small id="crumbs"></small></div>
<div class="rows" id="rows"></div><div class="hint" id="hint"></div>
<div class="ft"><span><b>&#9650;&#9660;</b> SELECT</span><span><b>&#9668;&#9658;</b> ADJUST</span><span><b>OK</b> ENTER / APPLY</span><span><b>EXIT</b> BACK</span><span><b>DIAG</b> DIAGNOSTICS</span><span><b>INFO</b> STATUS</span></div></div>
<div id="strip"></div><div id="toast"></div><div id="off"></div>
<script>
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  function draw(v) {
    $('unit').textContent = v.box ? v.box.name : '';
    var p = v.page;
    $('osd').className = v.open && p ? 'on' : '';
    if (v.open && p) {
      $('title').textContent = p.title || '';
      $('crumbs').textContent = (p.crumbs || []).slice(0, -1).map(function (c) { return c.toUpperCase(); }).join(' > ');
      var html = p.first > 0 ? '<div class="more">&#9650; ' + p.first + ' more</div>' : '';
      (p.rows || []).forEach(function (r, i) {
        var cls = ['row', r.kind || 'info', r.state || '', r.changed ? 'changed' : '', r.blink ? 'blink' : '', (p.first + i) === p.cursor ? 'sel' : ''].join(' ');
        html += '<div class="' + cls + '"><span class="l">' + esc(r.label) + '</span>' + (r.type ? '<span class="t">' + esc(r.type) + '</span>' : '') + '<span class="v">' + esc(r.value) + '</span></div>';
      });
      var rest = (p.total || 0) - (p.first || 0) - (p.rows || []).length;
      if (rest > 0) html += '<div class="more">&#9660; ' + rest + ' more</div>';
      if (p.error) html += '<div class="row bad"><span class="l">' + esc(p.error) + '</span></div>';
      $('rows').innerHTML = html;
      $('hint').textContent = p.hint || '';
    }
    var s = v.info && v.strip;
    $('strip').className = s ? 'on' : '';
    if (s) $('strip').innerHTML = '<b class="u">' + esc(v.box.name) + '</b><span>FMT <b>' + esc(s.format) + '</b></span><span>RUN <b>' + esc(s.fps) + ' fps</b></span><span>FRAME <b>' + esc(s.frame) + ' ms</b></span><span>CPU <b>' + esc(s.cpu) + '%</b></span><span>PGM <b>' + esc(s.program) + '</b></span><span>IP <b>' + esc(s.addr) + '</b></span>';
    $('toast').className = v.toast ? 'on' : '';
    $('toast').textContent = v.toast || '';
    $('off').style.display = v.offline && (v.open || v.info) ? 'block' : 'none';
    $('off').textContent = v.offline || '';
  }
  var q = location.search;
  var es = new EventSource(location.pathname.replace(/\\/$/, '') + '/events' + q);
  es.onmessage = function (e) { try { draw(JSON.parse(e.data)); } catch (_) {} };
})();
</script></body></html>`;

function registerRoutes(app) {
    app.get('/av-osd/:box', (req, res) => {
        if (!avOsd.checkToken(String(req.params.box || ''), String(req.query.k || ''))) return res.status(404).end();
        res.set('Cache-Control', 'no-store');
        res.type('html').send(PAGE);
    });
    app.get('/av-osd/:box/events', (req, res) => {
        if (!avOsd.checkToken(String(req.params.box || ''), String(req.query.k || ''))) return res.status(404).end();
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders && res.flushHeaders();
        const off = avOsd.subscribe(String(req.params.box || ''), String(req.query.k || ''), res);
        if (!off) { res.end(); return; }
        const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch (_) { /* closed */ } }, 15000);
        req.on('close', () => { clearInterval(beat); off(); });
    });
}

module.exports = { registerRoutes, PAGE };
