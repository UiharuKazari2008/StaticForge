#!/usr/bin/env python3
import sys,json,subprocess,time,base64
vm=sys.argv[1]; cmd=sys.argv[2]; shell=sys.argv[3] if len(sys.argv)>3 else 'cmd'
def q(o):
    r=subprocess.run(['virsh','-c','qemu:///system','qemu-agent-command',vm,json.dumps(o)],capture_output=True,text=True)
    return json.loads(r.stdout) if r.stdout.strip() else {'error':r.stderr}
if shell=='ps': path,args='powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',cmd]
else: path,args='cmd.exe',['/c',cmd]
r=q({'execute':'guest-exec','arguments':{'path':path,'arg':args,'capture-output':True}})
if 'return' not in r: print(r); sys.exit(1)
pid=r['return']['pid']
for i in range(int(sys.argv[4]) if len(sys.argv)>4 else 120):
    r=q({'execute':'guest-exec-status','arguments':{'pid':pid}})['return']
    if r['exited']: break
    time.sleep(1)
for k in ('out-data','err-data'):
    if k in r: sys.stdout.write(base64.b64decode(r[k]).decode('utf-8','replace'))
