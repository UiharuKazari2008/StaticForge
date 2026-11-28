import subprocess
exec(open('measure.py').read().split('ref=None')[0].replace('import subprocess',''))
S=(338,1160,522,1182)
for run,last,first in [('r1',152,96),('r2',171,96),('r3',148,80),('r4',150,81),('r5',179,102)]:
    ref=None; states=[]
    for i,f in stream(run):
        if i==first: ref=crop(f,S)
        if i>last:
            ok=diff(crop(f,S),ref)<=2
            if not states or states[-1][0]!=ok: states.append([ok,i,i,diff(crop(f,S),ref)])
            else: states[-1][2]=i
            if len(states)>1: break
    print(run,'exit frames with the badge strip unchanged:',states[0][1:3] if states[0][0] else None,'next',states[1:] or states)
