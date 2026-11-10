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
/* Drawn into the unit's own video output, in the unit's own look (box.theme):
 *   takao      TAKAO iUHD-4DX cabinet mixers: black card, magenta top bar, wide logotype over an RGB rule
 *   amuvision  AmuVISION Satellite iSVE-20D: black card, thin / bold wordmark, blue status bar at the foot
 * Sized from the output height (1 u = 1/1080), so 720p and 1080p units draw the same OSD. */
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
:root { --u: calc(100vh / 1080); --acc: #ff00b4; --acc-ink: #fff; --ok: #3ee07a; --warn: #ffc23a; --bad: #ff4b4b; }
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #fff; }
body.t-amuvision { --acc: #0055ff; }
#osd { position: absolute; inset: 0; display: none; }
#osd.on { display: block; }
.card { position: absolute; left: 0; top: 0; bottom: 0; width: calc(1000 * var(--u)); background: rgba(0, 0, 0, .9); }
.bar { position: absolute; left: 0; right: 0; top: 0; height: calc(72 * var(--u)); display: flex; align-items: center; background: var(--acc); }
.bar i { width: calc(2 * var(--u)); height: 100%; margin-left: calc(460 * var(--u)); background: rgba(255,255,255,.55); }
.bar i + i { margin-left: calc(306 * var(--u)); }
.bar b { margin-left: auto; padding-right: calc(28 * var(--u)); font-size: calc(30 * var(--u)); font-weight: bold; letter-spacing: calc(.5 * var(--u)); text-transform: uppercase; color: var(--acc-ink); }
body.t-amuvision .bar { top: auto; bottom: 0; height: calc(80 * var(--u)); }
body.t-amuvision .bar i { display: none; }
.brand { position: absolute; left: calc(108 * var(--u)); top: calc(150 * var(--u)); }
.logo { font: 400 calc(76 * var(--u))/1 'Eurostile', 'Microgramma', 'Arial', sans-serif; letter-spacing: calc(30 * var(--u)); }
.rule { display: flex; height: calc(6 * var(--u)); width: calc(404 * var(--u)); margin-top: calc(10 * var(--u)); }
.rule i { flex: 1; } .rule i:nth-child(1) { background: #e00000; } .rule i:nth-child(2) { background: #00c040; } .rule i:nth-child(3) { background: #0030e0; }
.sub { display: flex; justify-content: space-between; width: calc(404 * var(--u)); margin-top: calc(10 * var(--u)); font-size: calc(18 * var(--u)); font-weight: bold; }
body.t-amuvision .logo { font: 200 calc(56 * var(--u))/1 'Helvetica Neue', Helvetica, Arial, sans-serif; letter-spacing: calc(-1 * var(--u)); }
body.t-amuvision .logo b { font-weight: bold; }
body.t-amuvision .rule { display: none; }
body.t-amuvision .sub { justify-content: flex-end; width: auto; }
.crumbs { position: absolute; left: calc(108 * var(--u)); top: calc(300 * var(--u)); font-size: calc(20 * var(--u)); color: #9a9a9a; text-transform: uppercase; letter-spacing: calc(1 * var(--u)); }
.rows { position: absolute; left: calc(96 * var(--u)); top: calc(338 * var(--u)); width: calc(840 * var(--u)); }
.row { display: flex; align-items: center; height: calc(46 * var(--u)); padding: 0 calc(12 * var(--u)); font-size: calc(26 * var(--u)); font-weight: bold; white-space: nowrap; }
.row .l { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.row .v { margin-left: calc(20 * var(--u)); max-width: 52%; overflow: hidden; text-overflow: ellipsis; font-weight: normal; color: #d0d0d0; }
.row .t { margin-left: calc(12 * var(--u)); padding: 0 calc(6 * var(--u)); border: calc(2 * var(--u)) solid #666; font-size: calc(15 * var(--u)); color: #aaa; }
.row .bar2 { width: calc(140 * var(--u)); height: calc(10 * var(--u)); margin-left: calc(16 * var(--u)); background: #333; position: relative; }
.row .bar2 s { position: absolute; top: 0; bottom: 0; background: var(--warn); }
.row.nav .v::after { content: '  \\25B6'; color: #888; }
.row.sel { background: var(--acc); color: var(--acc-ink); }
.row.sel .v, .row.sel .t { color: var(--acc-ink); border-color: var(--acc-ink); }
.row.sel.pick .v::before, .row.sel.adjust .v::before { content: '\\25C4  '; }
.row.sel.pick .v::after, .row.sel.adjust .v::after { content: '  \\25BA'; }
.row.changed .v { color: var(--warn); }
.row.ok .v { color: var(--ok); } .row.warn .v { color: var(--warn); } .row.bad .v { color: var(--bad); } .row.on .v { color: var(--bad); }
.row.sel.ok .v, .row.sel.warn .v, .row.sel.bad .v, .row.sel.changed .v { color: var(--acc-ink); }
.row.blink .v { animation: bl 0.8s steps(1, end) infinite; }
@keyframes bl { 50% { visibility: hidden; } }
.row .w { flex: none; width: calc(30 * var(--u)); height: calc(26 * var(--u)); margin-left: calc(10 * var(--u)); background: var(--warn); clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.more { height: calc(26 * var(--u)); padding: 0 calc(12 * var(--u)); font-size: calc(18 * var(--u)); color: #888; }
.hint { position: absolute; left: calc(108 * var(--u)); top: calc(930 * var(--u)); right: calc(40 * var(--u)); font-size: calc(22 * var(--u)); font-weight: bold; }
.keys { position: absolute; left: calc(108 * var(--u)); top: calc(966 * var(--u)); font-size: calc(17 * var(--u)); color: #9a9a9a; }
.keys b { color: #fff; margin-right: calc(4 * var(--u)); }
.keys span { margin-right: calc(22 * var(--u)); }
.foot { position: absolute; left: calc(24 * var(--u)); bottom: calc(22 * var(--u)); font-size: calc(17 * var(--u)); color: #8a8a8a; line-height: 1.3; }
.foot em { font-style: normal; color: #ddd; font-weight: 300; }
.foot em b { font-weight: bold; }
body.t-amuvision .hint { top: calc(905 * var(--u)); }
body.t-amuvision .keys { top: calc(940 * var(--u)); }
body.t-amuvision .foot { display: none; }
#toast { position: absolute; right: calc(40 * var(--u)); bottom: calc(120 * var(--u)); display: none; padding: calc(14 * var(--u)) calc(28 * var(--u)); background: var(--acc); color: var(--acc-ink); font-size: calc(26 * var(--u)); font-weight: bold; white-space: nowrap; }
#toast.on { display: block; }
#strip { position: absolute; left: 0; right: 0; bottom: 0; height: calc(64 * var(--u)); display: none; align-items: center; gap: calc(36 * var(--u)); padding: 0 calc(28 * var(--u)); background: var(--acc); font-size: calc(22 * var(--u)); font-weight: bold; }
#strip.on { display: flex; }
#strip span { color: rgba(255,255,255,.75); font-weight: normal; }
#strip b { color: #fff; }
/* live cards (?card=): the unit's own system test card / standby slate, drawn live */
#card { position: absolute; inset: 0; display: none; background: #000; }
#card.on { display: block; }
#card .bar b { text-transform: uppercase; }
#card .press { position: absolute; left: calc(96 * var(--u)); top: calc(790 * var(--u)); font-size: calc(24 * var(--u)); font-weight: bold; }
#card .fmt { position: absolute; left: calc(96 * var(--u)); top: calc(830 * var(--u)); font-size: calc(20 * var(--u)); color: #9a9a9a; }
#card .tiles { position: absolute; left: calc(1088 * var(--u)); top: calc(118 * var(--u)); display: grid; grid-template-columns: repeat(2, calc(386 * var(--u))); grid-auto-rows: calc(218 * var(--u)); gap: calc(18 * var(--u)) calc(18 * var(--u)); }
#card .tile { position: relative; background: linear-gradient(#3a3a3a, #262626); }
#card .tile.ok { background: linear-gradient(#1f3a26, #13241a); }
#card .tile b { position: absolute; left: calc(16 * var(--u)); top: calc(14 * var(--u)); font-size: calc(22 * var(--u)); }
#card .tile span { position: absolute; left: calc(16 * var(--u)); top: calc(46 * var(--u)); font-size: calc(17 * var(--u)); color: #aaa; }
#card .tile em { position: absolute; left: calc(16 * var(--u)); bottom: calc(14 * var(--u)); font: normal calc(20 * var(--u)) 'Helvetica Neue', Arial, sans-serif; color: #9fe3b0; }
#card .tile .w { position: absolute; right: calc(20 * var(--u)); bottom: calc(18 * var(--u)); width: calc(52 * var(--u)); height: calc(46 * var(--u)); background: #b8b02a; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
#card .tile .w::after { content: '!'; position: absolute; left: 0; right: 0; bottom: calc(2 * var(--u)); text-align: center; font-size: calc(30 * var(--u)); font-weight: bold; color: #262626; }
#card .ver { position: absolute; left: calc(24 * var(--u)); bottom: calc(22 * var(--u)); font-size: calc(19 * var(--u)); color: #8a8a8a; line-height: 1.35; }
#card .ver em { font-style: normal; color: #ddd; font-weight: 300; }
#card .ver em b { font-weight: bold; }
#card.slate .brand { left: calc(200 * var(--u)); top: calc(500 * var(--u)); }
#card.slate .press, #card.slate .tiles, #card.slate .ver, #card.slate .fmt { display: none; }
#card.post .brand { left: calc(96 * var(--u)); top: calc(420 * var(--u)); }
#card.post.ph-boot .tiles, #card.post.ph-boot .press, #card.post.ph-boot .fmt { display: none; }
#card.post.ph-boot .brand { left: calc(200 * var(--u)); top: calc(500 * var(--u)); }
#card.post .press { top: calc(640 * var(--u)); font-size: calc(26 * var(--u)); line-height: 1.5; }
#card .press .dna { display: inline-block; margin-bottom: calc(6 * var(--u)); padding: calc(6 * var(--u)) calc(18 * var(--u)); background: #d00; color: #fff; font-size: calc(54 * var(--u)); letter-spacing: calc(4 * var(--u)); animation: bl 0.8s steps(1, end) infinite; }
#card.ph-fault .bar { background: #d00; animation: fbar 0.8s steps(1, end) infinite; }
@keyframes fbar { 50% { background: #500; } }
#card .tile.bad { background: linear-gradient(#5a1414, #2e0a0a); outline: calc(3 * var(--u)) solid #d00; }
#card .tile em.al { color: #ff9a8f; font-weight: bold; }
#off { position: absolute; right: calc(40 * var(--u)); top: calc(100 * var(--u)); display: none; padding: calc(10 * var(--u)) calc(18 * var(--u)); background: #900; font-size: calc(22 * var(--u)); font-weight: bold; }
</style></head>
<body class="t-takao">
<div id="osd"><div class="card"></div><div class="bar"><i></i><i></i><b id="title"></b></div>
<div class="brand"><div class="logo" id="logo"></div><div class="rule"><i></i><i></i><i></i></div><div class="sub"><span id="type"></span><span id="model"></span></div></div>
<div class="crumbs" id="crumbs"></div><div class="rows" id="rows"></div>
<div class="hint" id="hint"></div>
<div class="keys"><span><b>&#9650;&#9660;</b>SELECT</span><span><b>&#9668;&#9658;</b>ADJUST</span><span><b>OK</b>ENTER</span><span><b>EXIT</b>BACK</span><span><b>DIAG</b>DIAGNOSTICS</span><span><b>INFO</b>STATUS</span></div>
<div class="foot"><em>Amusement<b>VISION</b></em><br><span id="unit"></span></div></div>
<div id="card"><div class="bar"><i></i><i></i><b id="cstat"></b></div>
<div class="brand"><div class="logo" id="clogo"></div><div class="rule"><i></i><i></i><i></i></div><div class="sub"><span id="ctype"></span><span id="cmodel"></span></div></div>
<div class="press" id="cpress">Press and hold &ldquo;DIAG&rdquo; button to modify settings</div><div class="fmt" id="cfmt"></div>
<div class="tiles" id="tiles"></div><div class="ver"><em>Amusement<b>VISION</b></em><br><span id="cver"></span></div></div>
<div id="strip"></div><div id="toast"></div><div id="off"></div>
<script>
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  function draw(v) {
    var bx = v.box || {};
    document.body.className = 't-' + (bx.theme === 'amuvision' ? 'amuvision' : 'takao');
    if (bx.theme === 'amuvision') $('logo').innerHTML = esc(bx.maker || 'AmuVISION').replace('VISION', '<span>VISION</span>') + ' <b>' + esc(bx.line || '') + '</b>';
    else $('logo').textContent = (bx.maker || 'TAKAO').toUpperCase();
    $('type').textContent = bx.theme === 'amuvision' ? (bx.type || '') + ' // ' + (bx.model || '') : (bx.type || '');
    $('model').textContent = bx.theme === 'amuvision' ? '' : (bx.model || '');
    $('unit').textContent = (bx.name || '') + (bx.model ? '  -  ' + bx.model : '');
    var p = v.page;
    $('osd').className = v.open && p ? 'on' : '';
    if (v.open && p) {
      $('title').textContent = p.loading ? (p.title || '') + '...' : (p.title || '');
      $('crumbs').textContent = (p.crumbs || []).slice(0, -1).map(function (c) { return c.toUpperCase(); }).join('  >  ');
      var html = p.first > 0 ? '<div class="more">&#9650; ' + p.first + ' MORE</div>' : '';
      (p.rows || []).forEach(function (r, i) {
        var cls = ['row', r.kind || 'info', r.state || '', r.changed ? 'changed' : '', r.blink ? 'blink' : '', (p.first + i) === p.cursor ? 'sel' : ''].join(' ');
        var bar = r.bar ? '<span class="bar2"><s style="left:' + Math.max(0, Math.min(100, r.bar.from || 0)) + '%;width:' + Math.max(1, Math.min(100, r.bar.width || 0)) + '%;background:' + (r.bar.color || '') + '"></s></span>' : '';
        html += '<div class="' + cls + '"><span class="l">' + esc(r.label) + '</span>' + (r.type ? '<span class="t">' + esc(r.type) + '</span>' : '') + bar + '<span class="v">' + esc(r.value) + '</span>' + (r.state === 'bad' || r.state === 'warn' ? '<span class="w"></span>' : '') + '</div>';
      });
      var rest = (p.total || 0) - (p.first || 0) - (p.rows || []).length;
      if (rest > 0) html += '<div class="more">&#9660; ' + rest + ' MORE</div>';
      if (p.error) html += '<div class="row bad"><span class="l">' + esc(p.error) + '</span></div>';
      $('rows').innerHTML = html;
      $('hint').textContent = p.hint || '';
    }
    // power on: boot screen, self test, and the latched FAULT card (hidden while the menu is open)
    if (v.post && !(v.open && p)) {
      var po = v.post;
      drawCard({ card: 'post', unit: { name: bx.name, maker: bx.maker, line: bx.line, model: bx.model, type: bx.type, theme: bx.theme, sw: '', hw: '', fw: '' }, status: po.text, tiles: (po.items || []).map(function (x) { return { n: x.n, name: x.label, type: x.type, ok: x.state !== 'alarm', size: x.detail, alarm: x.state === 'alarm' ? x.detail : '' }; }) });
      $('card').className = 'on post ph-' + po.phase;
      $('cpress').innerHTML = po.phase === 'fault' ? '<b class="dna">DO NOT AIR</b><br>CALL A TECHNICIAN &mdash; press MENU to service this unit' : po.phase === 'boot' ? '' : po.phase === 'pass' ? 'All sources OK' : 'Checking every source...';
    } else if (!isCard) $('card').className = '';
    var s = v.info && v.strip;
    $('strip').className = s ? 'on' : '';
    if (s) $('strip').innerHTML = '<b>' + esc(bx.name) + '</b><span>FMT</span><b>' + esc(s.format) + '</b><span>RUN</span><b>' + esc(s.fps) + ' fps</b><span>FRAME</span><b>' + esc(s.frame) + ' ms</b><span>CPU</span><b>' + esc(s.cpu) + '%</b><span>PGM</span><b>' + esc(s.program) + '</b><span>IP</span><b>' + esc(s.addr) + '</b>';
    $('toast').className = v.toast ? 'on' : '';
    $('toast').textContent = v.toast || '';
    $('off').style.display = v.offline && (v.open || v.info) ? 'block' : 'none';
    $('off').textContent = v.offline || '';
  }
  function drawCard(c) {
    var u = c.unit || {};
    var slate = c.card === 'slate';
    document.body.className = 't-' + (u.theme === 'amuvision' ? 'amuvision' : 'takao');
    $('card').className = 'on' + (slate ? ' slate' : '');
    if (u.theme === 'amuvision') $('clogo').innerHTML = esc(u.maker || 'AmuVISION') + ' <b>' + esc(u.line || '') + '</b>';
    else $('clogo').textContent = (u.maker || 'TAKAO').toUpperCase();
    $('ctype').textContent = u.theme === 'amuvision' ? (u.type || '') + ' // ' + (u.model || '') : (u.type || '');
    $('cmodel').textContent = u.theme === 'amuvision' ? '' : (u.model || '');
    $('cstat').textContent = c.error ? c.error : (c.status || '');
    $('cfmt').textContent = c.format ? (u.name || '') + '  -  OUTPUT ' + c.format : (u.name || '');
    $('cver').textContent = ['SW: ' + (u.sw || '-'), 'HW: ' + (u.hw || '-'), 'AMV: ' + (u.fw || '-')].join(' - ');
    var t = c.tiles || [];
    var html = '';
    for (var i = 0; i < 8; i++) {
      var x = t[i];
      html += x ? '<div class="tile' + (x.ok ? ' ok' : ' bad') + '"><b>IN ' + x.n + '</b><span>' + esc(x.name) + ' &middot; ' + esc(x.type) + '</span>' + (x.ok ? '<em>' + esc(x.size) + '</em>' : '<em class="al">' + esc(x.alarm || 'NO SIGNAL') + '</em><i class="w"></i>') + '</div>' : '<div class="tile"><span>NOT FITTED</span></div>';
    }
    $('tiles').innerHTML = html;
  }
  var isCard = /[?&]card=/.test(location.search);
  var es = new EventSource(location.pathname.replace(/\\/$/, '') + '/events' + location.search);
  es.onmessage = function (e) { try { var d = JSON.parse(e.data); if (isCard) { if (d.card) drawCard(d); } else draw(d); } catch (_) {} };
})();
</script></body></html>`;

function registerRoutes(app) {
    // QuickCast REALTIME preview: MJPEG for a one-time ticket from quickcast_live_ticket (admin websocket)
    app.get('/quickcast/live/:ticket', (req, res) => {
        res.set('X-Robots-Tag', 'noindex');
        void require('./quickcast').liveStream(String(req.params.ticket || ''), req, res);
    });
    app.get('/av-osd/:box', (req, res) => {
        if (!avOsd.checkToken(String(req.params.box || ''), String(req.query.k || ''))) return res.status(404).end();
        res.set('Cache-Control', 'no-store');
        res.type('html').send(PAGE);
    });
    app.get('/av-osd/:box/events', (req, res) => {
        if (!avOsd.checkToken(String(req.params.box || ''), String(req.query.k || ''))) return res.status(404).end();
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders && res.flushHeaders();
        const card = req.query.card ? String(req.query.card) : '';
        const off = card
            ? avOsd.subscribeCard(String(req.params.box || ''), String(req.query.k || ''), card, String(req.query.cab || ''), res)
            : avOsd.subscribe(String(req.params.box || ''), String(req.query.k || ''), res);
        if (!off) { res.end(); return; }
        const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch (_) { /* closed */ } }, 15000);
        req.on('close', () => { clearInterval(beat); off(); });
    });
}

module.exports = { registerRoutes, PAGE };
