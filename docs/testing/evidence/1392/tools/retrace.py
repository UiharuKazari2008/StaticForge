# retrace.py <R8 mapping.txt> <file> : prints <file> with obfuscated Java frames "at a.b(SourceFile:N)" (ART traces, debuggerd, logcat)
# deobfuscated from the release's own mapping (inlined frames are all printed). Lines without a mapped frame are copied as they are.
import re, sys
mapping, path = sys.argv[1], sys.argv[2]
classes, cur = {}, None
CL = re.compile(r'^(\S.*?) -> (\S+):$')
ML = re.compile(r'^    (?:(\d+):(\d+):)?(\S+) ([^\s(]+)\((.*?)\)(?::(\d+))?(?::(\d+))? -> (\S+)$')
for line in open(mapping, errors='replace'):
    if line.startswith('#') or line.lstrip().startswith('#'): continue
    m = CL.match(line.rstrip('\n'))
    if m:
        cur = {'orig': m.group(1), 'methods': {}}; classes[m.group(2)] = cur; continue
    m = ML.match(line.rstrip('\n'))
    if m and cur:
        lo, hi, ret, name, args, o1, o2, obf = m.groups()
        cur['methods'].setdefault(obf, []).append((int(lo) if lo else None, int(hi) if hi else None, name, int(o1) if o1 else None, int(o2) if o2 else None))
def resolve(cls, meth, line):
    c = classes.get(cls)
    if not c: return None
    out = []
    for lo, hi, name, o1, o2 in c['methods'].get(meth, []):
        if lo is not None and line is not None and not (lo <= line <= hi): continue
        if lo is None and line is not None and out: continue
        full = name if '.' in name else c['orig'] + '.' + name
        if o1 is None: ln = line
        elif o2 is None or lo is None: ln = o1
        else: ln = o1 + (line - lo)
        out.append('%s:%s' % (full, ln))
    if not out: out = ['%s.%s (line %s not in the mapping)' % (c['orig'], meth, line)]
    return out
FR = [re.compile(r'\bat ([A-Za-z_$][\w$.]*)\.([\w$<>]+)\((?:SourceFile|Unknown Source|unavailable|r8-map-id-\w+)(?::(\d+))?\)'),
      re.compile(r'\(([A-Za-z_$][\w$.]*)\.([\w$<>-]+)\+\d+\)')]
for line in open(path, errors='replace'):
    line = line.rstrip('\n'); print(line)
    for i, rx in enumerate(FR):
        m = rx.search(line)
        if not m: continue
        ln = int(m.group(3)) if i == 0 and m.group(3) else None
        r = resolve(m.group(1), m.group(2), ln)
        if r and not (len(r) == 1 and r[0].startswith(m.group(1) + '.' + m.group(2))):
            for x in r[:12]: print('        => ' + x)
        break
