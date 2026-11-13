#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-status-alert-icons.py [outdir]
# Melaton Mobile's notification icons for a warning and an error (wmShell NOTE_KIND_ICON:
# status-warning, status-error; 16 / @2x 32 / @4x 64 px), drawn on the pixel grid at each size
# instead of scaled: white glyphs on transparent like the other title-bar icons. Warning = a solid
# triangle with the "!" knocked out (bar, gap, square dot); error = a solid disc with the X knocked
# out (Yukimi, Nov 13 2026: the old ones were drawn wrong).
import sys, os, math, subprocess
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'static_images', 'wm61')
def warning(n):
    # solid triangle with rounded corners (the apex too, as a warning sign is drawn), base on the
    # last row; '!' knocked out. Rounded = every pixel centre within r of a smaller triangle.
    g = [[0]*n for _ in range(n)]
    c = n/2
    r = n * 0.12
    # the triangle the rounding starts from: its apex raised (and base corners pushed out) by what
    # a corner of radius r cuts off (r / sin(half the corner's angle) - r), so the rounded sign still
    # reaches the top row and the bottom corners
    A, B, C = (c, -1.236 * r), (-0.9 * r, float(n)), (n + 0.9 * r, float(n))
    def inset(P, Q, R):
        # point moved towards the incentre so the triangle shrinks by r on every side
        la, lb, lc = (math.dist(Q, R), math.dist(P, R), math.dist(P, Q))
        ix = (la*P[0] + lb*Q[0] + lc*R[0]) / (la+lb+lc); iy = (la*P[1] + lb*Q[1] + lc*R[1]) / (la+lb+lc)
        s2 = (la+lb+lc)/2; area = math.sqrt(s2*(s2-la)*(s2-lb)*(s2-lc)); rin = area / s2
        k = (rin - r) / rin
        return (ix + (P[0]-ix)*k, iy + (P[1]-iy)*k), (ix + (Q[0]-ix)*k, iy + (Q[1]-iy)*k), (ix + (R[0]-ix)*k, iy + (R[1]-iy)*k)
    a, b, cc = inset(A, B, C)
    def seg(p, u, v):
        ux, uy = v[0]-u[0], v[1]-u[1]
        t = max(0, min(1, ((p[0]-u[0])*ux + (p[1]-u[1])*uy) / (ux*ux + uy*uy)))
        return math.dist(p, (u[0]+t*ux, u[1]+t*uy))
    def inside(p):
        def side(u, v): return (v[0]-u[0])*(p[1]-u[1]) - (v[1]-u[1])*(p[0]-u[0])
        s1, s2_, s3 = side(a, b), side(b, cc), side(cc, a)
        return (s1 <= 0 and s2_ <= 0 and s3 <= 0) or (s1 >= 0 and s2_ >= 0 and s3 >= 0)
    for y in range(n):
        for x in range(n):
            p = (x + 0.5, y + 0.5)
            if inside(p) or min(seg(p, a, b), seg(p, b, cc), seg(p, cc, a)) <= r: g[y][x] = 1
    w = max(2, n//8)                          # stroke of the '!'
    x0 = int(c - w/2)
    top, bar_end = round(n*0.31), round(n*0.66)
    dot0 = bar_end + max(1, n//16); dot1 = dot0 + w
    for y in list(range(top, bar_end)) + list(range(dot0, dot1)):
        for x in range(x0, x0 + w): g[y][x] = 0
    return g
def error(n):
    # solid disc with an X knocked out
    g = [[0]*n for _ in range(n)]
    c = n/2; r = n/2
    for y in range(n):
        for x in range(n):
            dx, dy = x + 0.5 - c, y + 0.5 - c
            if dx*dx + dy*dy <= r*r - n*0.06: g[y][x] = 1
    arm = n*0.24                              # X reaches this far from the centre
    th = n/16*1.05                            # half the stroke width
    for y in range(n):
        for x in range(n):
            dx, dy = x + 0.5 - c, y + 0.5 - c
            if abs(dx) <= arm + 0.01 and abs(dy) <= arm + 0.01 and (abs(dx - dy) <= th*1.42 or abs(dx + dy) <= th*1.42): g[y][x] = 0
    return g
for name, fn in (('status-warning', warning), ('status-error', error)):
    for n, suf in ((16, ''), (32, '@2x'), (64, '@4x')):
        g = fn(n)
        # white glyph, transparent elsewhere (as the other status icons)
        pbm = f"{out}/{name}{suf}.pbm"
        with open(pbm, 'w') as f:
            f.write(f"P1\n{n} {n}\n" + "\n".join(" ".join('0' if v else '1' for v in row) for row in g) + "\n")
        subprocess.run(['convert', '-size', f'{n}x{n}', 'xc:white', '(', pbm, '-alpha', 'off', ')', '-compose', 'CopyOpacity', '-composite', f'PNG32:{out}/{name}{suf}.png'], check=True)
        os.remove(pbm)
