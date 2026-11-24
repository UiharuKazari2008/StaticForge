"""Tiny in-memory implementation of the vfsFuseHttp contract, for testing the client."""
import json, sys, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
PNG = b'\x89PNG\r\n' + b'x' * 5000
FS = {'/': 'd', '/Workspaces': 'd', '/Workspaces/default': 'd', '/Workspaces/default/Pictures': 'd',
      '/Workspaces/default/Pictures/a.png': PNG, '/System': 'd', '/System/ro.txt': b'ro'}
def entry(p):
    v = FS[p]; d = v == 'd'
    e = dict(path=p, name=p.rsplit('/', 1)[1], kind='dir' if d else 'file', size=0 if d else len(v), sizeExact=True,
             mtime=1700000000, readOnly=p.startswith('/System'))
    if p == '/Workspaces/default/Pictures/a.png': e.update(size=100, sizeExact=False)  # stored jxl size
    return e
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj=None, raw=None):
        b = raw if raw is not None else json.dumps(obj or {}).encode()
        self.send_response(code); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def route(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query)); ep = u.path.split('/fs')[1]
        if self.headers.get('X-StaticForge-App-Key') != 'k': return self.send(401, {})
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
        ro = lambda p: p.startswith('/System')
        if ep == '/list':
            p = q['path'].rstrip('/') or '/'
            if FS.get(p) != 'd': return self.send(404, {'success': False})
            kids = sorted(k for k in FS if k != '/' and k.rsplit('/', 1)[0] == (p if p != '/' else ''))
            off = int(q.get('offset', 0)); lim = int(q.get('limit', 1000)); pg = kids[off:off + lim]
            return self.send(200, dict(success=True, hasMore=off + lim < len(kids), entries=[entry(k) for k in pg]))
        if ep == '/stat':
            p = q['path'].rstrip('/') or '/'
            if p not in FS: return self.send(404, {'success': False})
            e = entry(p) if p != '/' else dict(path='/', kind='dir', size=0)
            if p.endswith('a.png'): e.update(size=len(PNG), sizeExact=True)
            return self.send(200, dict(e, success=True))
        if ep == '/read':
            v = FS.get(q['path'])
            return self.send(200, raw=v) if isinstance(v, bytes) else self.send(404 if v is None else 415, {'success': False})
        if ep == '/write':
            p = q['path']
            if ro(p): return self.send(403, {'success': False})
            FS[p] = body; return self.send(200, {'success': True})
        j = json.loads(body or b'{}')
        if ep == '/mkdir':
            if ro(j['path']): return self.send(403, {'success': False})
            FS[j['path']] = 'd'; return self.send(200, {'success': True})
        if ep == '/move':
            if ro(j['from']) or ro(j['to']): return self.send(403, {'success': False})
            if j['from'] not in FS: return self.send(404, {'success': False})
            FS[j['to']] = FS.pop(j['from']); return self.send(200, {'success': True})
        if ep == '/trash':
            if ro(j['path']): return self.send(403, {'success': False})
            FS.pop(j['path'], None); return self.send(200, {'success': True})
        self.send(400, {'success': False})
    do_GET = do_PUT = do_POST = route
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
