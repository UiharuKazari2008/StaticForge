#!/usr/bin/env python3
"""Linux FUSE client for the Dreamscape VFS (contract: modules/vfsFuseHttp.js, #1153).

Needs only libfuse3 + `pip install mfusepy`. Auth is an application key sent as
X-StaticForge-App-Key (no browser login).
"""
import argparse, errno, json, os, stat, sys, threading, time, urllib.error, urllib.parse, urllib.request
from mfusepy import FUSE, FuseOSError, Operations

ATTR_TTL = 2.0          # server's own folder cache is 2 s
PAGE = 1000
WRITE_MAX = 100 * 1024 * 1024
STATUS_ERRNO = {400: errno.EINVAL, 403: errno.EACCES, 404: errno.ENOENT, 413: errno.EFBIG, 415: errno.EOPNOTSUPP}


class Api:
    def __init__(self, base, key, timeout=60):
        self.base, self.key, self.timeout = base.rstrip('/'), key, timeout

    def _call(self, method, endpoint, query=None, body=None, raw=None, ctype=None):
        url = f'{self.base}{endpoint}'
        if query:
            url += '?' + urllib.parse.urlencode(query)
        data, headers = None, {'X-StaticForge-App-Key': self.key, 'User-Agent': 'dreamscape-fuse/1'}
        if body is not None:
            data, headers['Content-Type'] = json.dumps(body).encode(), 'application/json'
        elif raw is not None:
            data, headers['Content-Type'] = raw, ctype or 'application/octet-stream'
        last = None
        for attempt in range(4):  # server restarts: retry connection failures, mount stays up
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return r.read(), r.headers
            except urllib.error.HTTPError as e:
                if e.code in (502, 503, 504):
                    last = FuseOSError(errno.EAGAIN)
                    time.sleep(1 + attempt * 2)
                    continue
                if e.code in (401,):
                    raise FuseOSError(errno.EACCES)
                raise FuseOSError(STATUS_ERRNO.get(e.code, errno.EIO))
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                last = FuseOSError(errno.EAGAIN)
                time.sleep(1 + attempt * 2)
        raise last

    def json(self, method, endpoint, **kw):
        data, _ = self._call(method, endpoint, **kw)
        return json.loads(data)


def parse_mtime(v):
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return time.mktime(time.strptime(v[:19], '%Y-%m-%dT%H:%M:%S')) if 'T' in v else float(v)
    except Exception:
        return 0.0


class DreamscapeFS(Operations):
    use_ns = True
    def __init__(self, api):
        self.api = api
        self.lock = threading.Lock()
        self.attrs = {}      # path -> (at, entry|None)
        self.dirs = {}       # path -> (at, [entries])
        self.open_files = {}  # fh -> {path, data, dirty, writable}
        self.next_fh = 1

    # ---- cache -------------------------------------------------------
    def _drop(self, *paths):
        with self.lock:
            for p in paths:
                p = '/' + p.strip('/') if p.strip('/') else '/'
                parent = p.rsplit('/', 1)[0] or '/'
                self.attrs.pop(p, None)
                self.dirs.pop(parent, None)
                self.dirs.pop(p, None)
            # descendants (renames/moves/trash of folders)
            for p in paths:
                pre = p.rstrip('/') + '/'
                for d in (self.attrs, self.dirs):
                    for k in [k for k in d if k.startswith(pre)]:
                        d.pop(k, None)

    def _stat(self, path):
        now = time.time()
        with self.lock:
            hit = self.attrs.get(path)
            if hit and now - hit[0] < ATTR_TTL:
                if hit[1] is None:
                    raise FuseOSError(errno.ENOENT)
                return hit[1]
        try:
            e = self.api.json('GET', '/fs/stat', query={'path': path})
        except FuseOSError as ex:
            if ex.errno == errno.ENOENT:
                with self.lock:
                    self.attrs[path] = (now, None)
            raise
        with self.lock:
            self.attrs[path] = (time.time(), e)
        return e

    def _list(self, path):
        now = time.time()
        with self.lock:
            hit = self.dirs.get(path)
            if hit and now - hit[0] < ATTR_TTL:
                return hit[1]
        entries, offset = [], 0
        while True:
            r = self.api.json('GET', '/fs/list', query={'path': path, 'offset': offset, 'limit': PAGE})
            page = r.get('entries', [])
            entries += page
            if not r.get('hasMore') or not page:
                break
            offset += len(page)
        with self.lock:
            self.dirs[path] = (time.time(), entries)
            # entries with exact sizes double as attribute cache; inexact ones need /fs/stat
            for e in entries:
                if e.get('sizeExact', True):
                    self.attrs[e['path']] = (time.time(), e)
                else:
                    self.attrs.pop(e['path'], None)
        return entries

    # ---- attributes ---------------------------------------------------
    def getattr(self, path, fh=None):
        if fh in self.open_files and self.open_files[fh]['data'] is not None and self.open_files[fh]['dirty']:
            of = self.open_files[fh]
            return self._attr(of['entry'], size=len(of['data']))
        if path == '/':
            return dict(st_mode=stat.S_IFDIR | 0o755, st_nlink=2, st_uid=os.getuid(), st_gid=os.getgid(), st_mtime=time.time_ns())
        return self._attr(self._stat(path))

    def _attr(self, e, size=None):
        ro = e.get('readOnly')
        t = int(parse_mtime(e.get('mtime')) * 1e9)
        own = dict(st_uid=os.getuid(), st_gid=os.getgid(), st_mtime=t, st_atime=t, st_ctime=t)
        if e['kind'] == 'dir':
            return dict(st_mode=stat.S_IFDIR | (0o555 if ro else 0o755), st_nlink=2, **own)
        return dict(st_mode=stat.S_IFREG | (0o444 if ro else 0o644), st_nlink=1,
                    st_size=e.get('size', 0) if size is None else size, **own)

    def readdir(self, path, fh):
        yield '.'
        yield '..'
        for e in self._list(path):
            yield e['name']

    # ---- reading ----------------------------------------------------
    def _fetch(self, path):
        data, _ = self.api._call('GET', '/fs/read', query={'path': path})
        return data

    def open(self, path, flags):
        e = self._stat(path)
        if e['kind'] == 'dir':
            raise FuseOSError(errno.EISDIR)
        writable = bool(flags & (os.O_WRONLY | os.O_RDWR))
        if writable and e.get('readOnly'):
            raise FuseOSError(errno.EROFS)
        with self.lock:
            fh = self.next_fh
            self.next_fh += 1
            self.open_files[fh] = dict(path=path, entry=e, data=None, dirty=False, writable=writable)
        if flags & os.O_TRUNC and writable:
            self.open_files[fh].update(data=bytearray(), dirty=True)
        return fh

    def _data(self, fh):
        of = self.open_files[fh]
        if of['data'] is None:   # whole-file bytes fetched once per open, not per read() chunk
            of['data'] = bytearray(self._fetch(of['path']))
        return of['data']

    def read(self, path, size, offset, fh):
        return bytes(self._data(fh)[offset:offset + size])

    # ---- writing ----------------------------------------------------
    def create(self, path, mode, fi=None):
        parent = path.rsplit('/', 1)[0] or '/'
        self._stat(parent)  # ENOENT if missing
        with self.lock:
            fh = self.next_fh
            self.next_fh += 1
            entry = dict(kind='file', size=0, name=path.rsplit('/', 1)[1], path=path, readOnly=False)
            self.open_files[fh] = dict(path=path, entry=entry, data=bytearray(), dirty=True, writable=True)
        self._flush_fh(fh)   # create the empty file now so ls/stat see it
        return fh

    def write(self, path, data, offset, fh):
        of = self.open_files[fh]
        if not of['writable']:
            raise FuseOSError(errno.EBADF)
        buf = self._data(fh)
        if offset + len(data) > WRITE_MAX:
            raise FuseOSError(errno.EFBIG)
        if offset > len(buf):
            buf.extend(b'\0' * (offset - len(buf)))
        buf[offset:offset + len(data)] = data
        of['dirty'] = True
        return len(data)

    def truncate(self, path, length, fh=None):
        if fh is not None and fh in self.open_files:
            buf = self._data(fh)
            of = self.open_files[fh]
        else:
            e = self._stat(path)
            if e.get('readOnly'):
                raise FuseOSError(errno.EROFS)
            buf = bytearray(self._fetch(path)) if length else bytearray()
            of = None
        if length < len(buf):
            del buf[length:]
        else:
            buf.extend(b'\0' * (length - len(buf)))
        if of is not None:
            of['dirty'] = True
        else:
            self.api._call('PUT', '/fs/write', query={'path': path}, raw=bytes(buf))
            self._drop(path)

    def _flush_fh(self, fh):
        of = self.open_files.get(fh)
        if of and of['dirty']:
            self.api._call('PUT', '/fs/write', query={'path': of['path']}, raw=bytes(of['data']))
            of['dirty'] = False
            self._drop(of['path'])

    def flush(self, path, fh):
        self._flush_fh(fh)
        return 0

    def fsync(self, path, datasync, fh):
        self._flush_fh(fh)
        return 0

    def release(self, path, fh):
        try:
            self._flush_fh(fh)
        finally:
            self.open_files.pop(fh, None)
        return 0

    def utimens(self, path, times=None):
        return 0

    def chmod(self, path, mode):
        return 0

    def chown(self, path, uid, gid):
        return 0

    def mkdir(self, path, mode):
        self.api.json('POST', '/fs/mkdir', body={'path': path})
        self._drop(path)

    def rmdir(self, path):
        if self._list(path):
            raise FuseOSError(errno.ENOTEMPTY)
        self.api.json('POST', '/fs/trash', body={'path': path})
        self._drop(path)

    def unlink(self, path):
        self.api.json('POST', '/fs/trash', body={'path': path})
        self._drop(path)

    def rename(self, old, new):
        self.api.json('POST', '/fs/move', body={'from': old, 'to': new})
        self._drop(old, new)

    def statfs(self, path):
        return dict(f_bsize=4096, f_frsize=4096, f_blocks=1 << 24, f_bfree=1 << 23, f_bavail=1 << 23, f_namemax=255)


def main():
    ap = argparse.ArgumentParser(description='Mount the Dreamscape VFS')
    ap.add_argument('mountpoint')
    ap.add_argument('--url', default=os.environ.get('DREAMSCAPE_URL'), help='server origin, e.g. https://host')
    ap.add_argument('--vfs-path', default=os.environ.get('DREAMSCAPE_VFS_PATH'), help='the vfsPathUuid segment')
    ap.add_argument('--key-file', default=os.environ.get('DREAMSCAPE_KEY_FILE', os.path.expanduser('~/.secrets/dreamscape-fuse.key')))
    ap.add_argument('--foreground', '-f', action='store_true')
    ap.add_argument('--allow-other', action='store_true')
    a = ap.parse_args()
    if not a.url or not a.vfs_path:
        ap.error('--url and --vfs-path (or DREAMSCAPE_URL / DREAMSCAPE_VFS_PATH) are required')
    key = open(a.key_file).read().strip()
    api = Api(f'{a.url.rstrip("/")}/{a.vfs_path.strip("/")}', key)
    FUSE(DreamscapeFS(api), a.mountpoint, foreground=a.foreground, nothreads=False, allow_other=a.allow_other,
         fsname='dreamscape', subtype='dreamscape')


if __name__ == '__main__':
    main()
