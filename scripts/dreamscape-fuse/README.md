# dreamscape-fuse

Mounts the Dreamscape VFS (Workspaces, Pictures, Scraps, user files, notes, `/System` read-only, `@desktop`)
as a folder, over the HTTP contract in `modules/vfsFuseHttp.js` (#1153).

## Install
    sudo apt install fuse3
    python3 -m venv ~/.local/share/dreamscape-fuse/venv
    ~/.local/share/dreamscape-fuse/venv/bin/pip install -r requirements.txt
    cp dreamscape_fuse.py ~/.local/share/dreamscape-fuse/

## Auth
Create an application key in Dreamscape and save it, one line, to `~/.secrets/dreamscape-fuse.key` (`chmod 600`).
It is sent as `X-StaticForge-App-Key`; no browser login. You also need the server origin and the
`vfsPathUuid` (first path segment of the VFS routes).

## Mount / unmount
    dreamscape_fuse.py ~/dreamscape --url https://HOST --vfs-path <vfsPathUuid> [--key-file F] [-f]
    fusermount3 -u ~/dreamscape

Env equivalents: `DREAMSCAPE_URL`, `DREAMSCAPE_VFS_PATH`, `DREAMSCAPE_KEY_FILE`.

## systemd user unit
Put those variables in `~/.config/dreamscape-fuse.env`, copy `dreamscape-fuse.service` to
`~/.config/systemd/user/`, then `systemctl --user enable --now dreamscape-fuse`.

## Behaviour
- Attributes and listings cached 2 s (the server's folder cache), dropped for any path written through the mount.
- Reads fetch the whole file once per `open()`; writes buffer and PUT on flush/close (100 MB cap).
- `sizeExact: false` entries (JPEG XL pictures) are sized with `/fs/stat`, so `cp` gives a PNG of exactly `st_size`.
- HTTP 400/403/404/413/415 map to EINVAL/EACCES/ENOENT/EFBIG/EOPNOTSUPP; `readOnly` entries are 0444/0555 and
  opening them for write gives EROFS.
- Connection failures and 502/503/504 retry ~10 s (then EAGAIN), so the mount survives a server restart.

## Test
`mock_server.py PORT` is an in-memory implementation of the contract (accepts key `k`).
