#!/usr/bin/env python3
"""uitap.py <ui.xml> <text|regex> -> prints 'x y' (centre of the first node whose text or content-desc matches)."""
import re, sys, xml.etree.ElementTree as ET
rx = re.compile(sys.argv[2])
for n in ET.parse(sys.argv[1]).iter('node'):
    if rx.fullmatch(n.get('text', '') or '') or rx.fullmatch(n.get('content-desc', '') or ''):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
        print((x1 + x2) // 2, (y1 + y2) // 2); sys.exit(0)
sys.exit(1)
