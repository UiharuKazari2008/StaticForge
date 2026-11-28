#!/usr/bin/env python3
"""One line-JSON request to Rack Manager over Dreamscape's Fleet socket (rack.sock); prints the answer line.
   rack.py '<json>' [timeout-seconds]   (socket: env AGENT_RACK_SOCKET, else ~/.local/state/dreamscape-agents/rack.sock)"""
import os, socket, sys
path = os.environ.get('AGENT_RACK_SOCKET') or os.path.expanduser('~/.local/state/dreamscape-agents/rack.sock')
try:
    s = socket.socket(socket.AF_UNIX); s.settimeout(float(sys.argv[2]) if len(sys.argv) > 2 else 60); s.connect(path)
    s.sendall((sys.argv[1] + '\n').encode())
    b = b''
    while not b.endswith(b'\n'):
        d = s.recv(65536)
        if not d: break
        b += d
    sys.stdout.write(b.decode(errors='replace').strip() + '\n')
except Exception as e:
    sys.stdout.write('{"ok":false,"error":%s,"code":"SOCKET"}\n' % __import__('json').dumps(str(e)))
    sys.exit(2)
