# per recorded frame: is it a splash frame, and how far are the emblem box and the badge box from run1 frame 66 (checked by eye)
import subprocess, sys, numpy as np
W, H = 984, 1092
EMB = (36, 80, 156, 202); BAD = (808, 946, 972, 1044)   # x0 y0 x1 y1
def frames(path):
    raw = subprocess.run(['ffmpeg','-nostdin','-v','error','-i',path,'-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
crop = lambda f, b: f[b[1]:b[3], b[0]:b[2]].astype(int)
ref = frames("run1/run.mp4")[65]
def green(p): r,g,b = p; return g > 110 and g > r + 25 and g > b + 60
for run in sys.argv[1:]:
    fs = frames(run + '/run.mp4')
    pts = [float(l.split()[1]) for l in open(run + '/pts.txt')]
    assert len(fs) == len(pts), (len(fs), len(pts))
    rows = []
    for i, f in enumerate(fs):
        samples = [(700,700),(950,400),(500,850),(600,300)]
        n = sum(green(tuple(int(v) for v in f[y, x])) for x, y in samples)
        if n >= 3:
            rows.append((i + 1, pts[i], np.abs(crop(f, EMB) - crop(ref, EMB)).mean(), np.abs(crop(f, BAD) - crop(ref, BAD)).mean()))
    print(run, 'frames', len(fs), 'full-green splash frames', len(rows), 'numbers %s..%s' % (rows[0][0], rows[-1][0]) if rows else '', 'pts %.3f..%.3f' % (rows[0][1], rows[-1][1]) if rows else '')
    print('   max mean abs diff emblem %.2f  badge %.2f' % (max(r[2] for r in rows), max(r[3] for r in rows)))
    for r in rows: print('   f%04d t=%.3f emblem %.2f badge %.2f' % r)
    # every splash frame's two boxes side by side, 6 per row, in frame order
    cells = []
    for r in rows:
        f = fs[r[0] - 1]
        c = np.zeros((122, 120 + 4 + 164 + 12, 3), np.uint8); c[:] = (255, 0, 255)
        c[:122, :120] = crop(f, EMB); c[:98, 124:288] = crop(f, BAD); cells.append(c)
    while len(cells) % 4: cells.append(np.full_like(cells[0], 0))
    sheet = np.vstack([np.hstack(cells[i:i+4]) for i in range(0, len(cells), 4)])
    subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','%dx%d' % (sheet.shape[1], sheet.shape[0]),'-i','-','-frames:v','1', run + '/crops.png'], input=sheet.tobytes(), check=True)
