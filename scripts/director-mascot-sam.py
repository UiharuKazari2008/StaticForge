"""Segment Anything over the Director mascot sheets (Yozora #766).

Run where torch is installed (Ruiko: C:\\Users\\ykaza\\claude-build\\masks\\venv), in a folder holding
sam_vit_b.pth (sam_vit_b_01ec64.pth, md5 01ec64d2...) and the output of
`node scripts/director-mascot-build.js sam-jobs <dir>`:

    python director-mascot-sam.py <dir>

For every sheet and every piece in jobs.json it writes <sheet>-<piece>.png (white = the piece) and a
prev-<sheet>.jpg to look at. `node scripts/director-mascot-build.js parts <dir>` packs them.
"""
import json
import os
import sys

import cv2
import numpy as np
from segment_anything import SamPredictor, sam_model_registry

folder = sys.argv[1] if len(sys.argv) > 1 else '.'
sam = sam_model_registry['vit_b'](checkpoint='sam_vit_b.pth')
sam.eval()
predictor = SamPredictor(sam)
COLOUR = {'chest': (200, 80, 255), 'arm': (255, 220, 80), 'hand': (255, 220, 80), 'belly': (80, 255, 120)}

for job in json.load(open(os.path.join(folder, 'jobs.json'))):
    image = cv2.imread(os.path.join(folder, job['file']))
    predictor.set_image(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    preview = image.copy()
    for part in job['parts']:
        points = np.array(part['pos'] + part['neg'], dtype=np.float32)
        labels = np.array([1] * len(part['pos']) + [0] * len(part['neg']))
        masks, scores, _ = predictor.predict(point_coords=points, point_labels=labels, multimask_output=True)
        by_size = sorted(range(3), key=lambda i: masks[i].sum())
        if part.get('small'):
            # an arm or a hand: the smallest candidate that holds every point given for it
            holds = [i for i in by_size if all(masks[i][int(y), int(x)] for (x, y) in part['pos'])]
            pick = holds[0] if holds else by_size[0]
        else:
            # a whole piece: the best-scored candidate, the largest (the whole figure) at a discount
            pick = max(by_size, key=lambda i: scores[i] - (0.08 if i == by_size[2] else 0))
        mask = masks[pick].astype(np.uint8) * 255
        cv2.imwrite(os.path.join(folder, job['file'].replace('.png', '-' + part['name'] + '.png')), mask)
        chosen = mask > 0
        preview[chosen] = (preview[chosen] * 0.45 + np.array(COLOUR[part['name']], dtype=np.float32) * 0.55).astype(np.uint8)
        for (x, y) in part['pos']:
            cv2.circle(preview, (int(x), int(y)), 9, (255, 255, 255), -1)
        print(job['file'], part['name'], int(chosen.sum()), [round(float(s), 2) for s in scores], flush=True)
    cv2.imwrite(os.path.join(folder, 'prev-' + job['file'].replace('.png', '.jpg')), cv2.resize(preview, None, fx=0.3, fy=0.3))
