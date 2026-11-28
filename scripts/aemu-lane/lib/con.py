#!/usr/bin/env python3
"""Emulator console client: con.py <port> <command words...>  (auth token from ~/.secrets/aemu-console.token)."""
import os, socket, sys, time
port = int(sys.argv[1]); cmd = ' '.join(sys.argv[2:])
tok = open(os.path.expanduser(os.environ.get('AEMU_CONSOLE_TOKEN') or '~/.secrets/aemu-console.token')).read().strip()
s = socket.create_connection(("127.0.0.1", port), timeout=int(os.environ.get("CON_TIMEOUT", "10")))
def until_ok():
    buf = b''
    while not (buf.endswith(b'OK\r\n') or b'KO:' in buf):
        d = s.recv(65536)
        if not d: break
        buf += d
    return buf.decode(errors='replace')
until_ok()
s.sendall(f'auth {tok}\n'.encode()); r = until_ok()
if 'KO' in r: sys.exit('console auth failed')
s.sendall((cmd + '\n').encode()); out = until_ok()
s.sendall(b'quit\n'); s.close()
out = out.replace('\r', '').rstrip()
if out.endswith('OK'): out = out[:-2].rstrip()
print(out)
sys.exit(1 if 'KO:' in out else 0)
