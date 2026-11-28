import subprocess
W,H=540,1200; FS=W*H*3
EMB=(140,90,284,236); WORD=(100,230,320,288); BAD=(338,1076,522,1182)
def stream(run):
    p=subprocess.Popen(['ffmpeg','-nostdin','-v','error','-i',run+'.mp4','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
    i=0
    while True:
        f=p.stdout.read(FS)
        if len(f)<FS: break
        i+=1; yield i,f
def crop(f,b): return b''.join(f[(y*W+b[0])*3:(y*W+b[2])*3] for y in range(b[1],b[3]))
def diff(a,b): return sum(abs(x-y) for x,y in zip(a,b))/len(a)
def orange(f):
    o=n=0
    for y in range(5,H,10):
        for x in range(5,W,10):
            p=(y*W+x)*3; r,g,b=f[p:p+3]; n+=1
            o+= r>110 and r>g+30 and b<110
    return o*100/n
ref=None
for i,f in stream('r1'):
    if i==120: ref=(crop(f,EMB),crop(f,WORD),crop(f,BAD)); break
cells=[]
for run in ['r1','r2','r3','r4','r5']:
    rows=[]; before=None; prev=None; after=[]
    for i,f in stream(run):
        o=orange(f)
        if o>=90:
            if not rows: before=(i-1,prev)
            c=(crop(f,EMB),crop(f,WORD),crop(f,BAD))
            rows.append((i,o,diff(c[0],ref[0]),diff(c[1],ref[1]),diff(c[2],ref[2])))
            cells.append((run,i,c))
        elif rows and len(after)<12:
            after.append((i,o))
        prev=o
    n=[r[0] for r in rows]
    print(run,'full frames',len(rows),'range',n[0],n[-1],'contiguous',n==list(range(n[0],n[-1]+1)),'orange% before',before,'after',[(a,round(b)) for a,b in after[:6]])
    print('  max diff emblem %.2f word %.2f badge %.2f'%tuple(max(r[k] for r in rows) for k in (2,3,4)))
    for r in rows:
        if max(r[2:])>1: print('   f%04d orange %.0f emblem %.2f word %.2f badge %.2f'%r)
# contact sheet: emblem+word box and badge box of every full frame, in order; magenta separators, a cyan row between runs
CW,CH=220+6+184,200
def cell(c):
    out=bytearray(b'\xff\x00\xff'*(CW+6)*(CH+6))
    def put(buf,w,h,x0,y0):
        for y in range(h):
            s=((y+y0)*(CW+6)+x0)*3; out[s:s+w*3]=buf[y*w*3:(y+1)*w*3]
    put(c[0],144,146,38,0); put(c[1],220,58,0,142); put(c[2],184,106,226,47)
    return bytes(out)
COLS=10; sheet=[]; W2=(CW+6)*COLS
def flush(line):
    if not line: return
    while len(line)<COLS: line.append(bytes((CW+6)*(CH+6)*3))
    for y in range(CH+6): sheet.append(b''.join(l[y*(CW+6)*3:(y+1)*(CW+6)*3] for l in line))
line=[]; cur=None
for run,i,c in cells:
    if run!=cur:
        flush(line); line=[]
        if cur: sheet.extend([b'\x00\xff\xff'*W2]*14)
        cur=run
    line.append(cell(c))
    if len(line)==COLS: flush(line); line=[]
flush(line)
data=b''.join(sheet); h=len(sheet)
subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','%dx%d'%(W2,h),'-i','-','-frames:v','1','crops-all.png'],input=data,check=True)
print('sheet',W2,h,'cells',len(cells))
