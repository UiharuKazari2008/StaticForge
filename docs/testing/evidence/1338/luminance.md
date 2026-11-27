# #1338 luminance evidence (device-free)

Measured over every `public/static_images/wm65/holder-*.png` at 1x (no `@2x`/`@4x`), pixels with alpha > 16. Nothing in the repo was changed by this measurement (no code, no art).

## 1. Formula finding

Old black car from `git show 8b238f9a7:public/static_images/wm65/holder-car.png` (302 visible px), all formulas over alpha > 16:

| formula | unweighted | alpha-weighted |
|---|---|---|
| plain mean of R,G,B | 27.3 | 26.9 |
| Rec.601 | 26.9 | 26.5 |
| Rec.709 | 26.9 | 26.5 |

The black car alone (27) does not separate the formulas; the other holders do (current working-tree files):

| icon | issue | plain mean (unw.) | Rec.601 (unw.) | Rec.709 (unw.) | plain mean (alpha-w.) | Rec.601 (alpha-w.) |
|---|---|---|---|---|---|---|
| api-key | 105 | **104.6** | 116.6 | 116.9 | 108.6 | 120.9 |
| weather-severe | 115 | **114.9** | 112.0 | 109.4 | 117.5 | 114.5 |
| lapis-health | 122 | **121.6** | 122.3 | 122.4 | 137.2 | 138.9 |
| lapis-failed | 123 | **123.2** | 119.8 | 117.3 | 135.3 | 132.1 |
| call | 131 | **130.8** | 128.2 | 133.2 | 136.2 | 133.2 |
| alarm | 187 | **187.2** | 192.3 | 191.5 | 196.4 | 201.1 |
| email | 202 | **201.6** | 211.7 | 212.2 | 203.1 | 214.0 |
| meeting | 204 | **204.1** | 217.1 | 217.3 | 210.2 | 222.9 |

- The ISSUE's numbers (car 27, api-key 105, weather-severe 115, lapis-health 122, lapis-failed 123, call 131, alarm 187, email 202, meeting 204) are reproduced, after rounding, by the **plain mean of R,G,B, unweighted** over alpha > 16, and by no other formula. This is the PRIMARY formula in the tables below.
- The LATER session's numbers (api-key 117, alarm 192, email 212, meeting 217) match **Rec.601 unweighted** (116.6, 192.3, 211.7, 217.1). Rec.709 unweighted is close (116.9, 191.5, 212.2, 217.3) and cannot be told apart on those four icons alone; Rec.601 is the one that is exactly right on all four.
- The car is reported under both formulas everywhere below.

## 2. All holder icons (1x), primary formula, ascending

### PRIMARY: plain mean of R,G,B, unweighted (reproduces the issue)

| rank | name | mean lum | mean R | mean G | mean B | visible px (alpha>16) |
|---|---|---|---|---|---|---|
| 1 | holder-api-key | 105 | 141.3 | 115.7 | 56.7 | 745 |
| 2 | holder-weather-severe | 115 | 129.3 | 103.2 | 112.1 | 574 |
| 3 | holder-lapis-health | 122 | 123.1 | 122.5 | 119.1 | 514 |
| 4 | holder-lapis-failed | 123 | 134.6 | 111.5 | 123.4 | 531 |
| 5 | holder-call | 131 | 77.4 | 146.2 | 168.7 | 709 |
| 6 | holder-sms-error | 132 | 155.9 | 126.1 | 114.4 | 621 |
| 7 | holder-progress | 136 | 156.3 | 140.7 | 111.5 | 518 |
| 8 | holder-lapis-fuel | 137 | 115.7 | 137.4 | 157.4 | 497 |
| 9 | holder-update-failed | 138 | 174.9 | 134.4 | 105.0 | 647 |
| 10 | holder-message | 140 | 164.9 | 144.6 | 111.2 | 491 |
| 11 | holder-rain-alarm | 141 | 139.9 | 144.2 | 139.9 | 559 |
| 12 | holder-voicemail | 144 | 111.6 | 160.0 | 160.6 | 799 |
| 13 | holder-print-error | 147 | 123.5 | 144.7 | 172.2 | 705 |
| 14 | holder-emotion-error | 147 | 140.6 | 146.6 | 153.9 | 645 |
| 15 | holder-call-missed | 148 | 232.4 | 121.4 | 90.2 | 572 |
| 16 | holder-lapis-unlocked | 150 | 191.5 | 159.5 | 100.0 | 380 |
| 17 | holder-fleet-attention | 152 | 139.1 | 154.7 | 163.2 | 726 |
| 18 | holder-fleet-done | 153 | 124.2 | 166.4 | 167.0 | 719 |
| 19 | holder-fleet-login | 153 | 135.3 | 155.3 | 169.7 | 672 |
| 20 | holder-fleet-routine | 161 | 130.6 | 163.1 | 190.1 | 688 |
| **21** | **holder-car** | **162** | **152.8** | **161.9** | **171.9** | **485** |
| 22 | holder-weather-alert | 171 | 204.4 | 184.6 | 123.5 | 589 |
| 23 | holder-mail-error | 177 | 220.4 | 180.2 | 130.8 | 760 |
| 24 | holder-lapis-run-left | 178 | 201.1 | 179.7 | 153.4 | 695 |
| 25 | holder-lapis-service | 182 | 196.8 | 180.0 | 168.3 | 543 |
| 26 | holder-alarm | 187 | 210.6 | 188.8 | 162.1 | 582 |
| 27 | holder-email | 202 | 230.4 | 211.8 | 162.5 | 751 |
| 28 | holder-meeting | 204 | 245.0 | 215.7 | 151.6 | 725 |

Band of the other 27 icons (mean): min 104.6, median 147.0, max 204.1. Car 162.2, rank 21 of 28 ascending. Meets 150+: YES. Icons below 150 among the others: 15 of 27.

### Same table under Rec.601 unweighted (later session formula)

| rank | name | mean lum | mean R | mean G | mean B | visible px (alpha>16) |
|---|---|---|---|---|---|---|
| 1 | holder-weather-severe | 112 | 129.3 | 103.2 | 112.1 | 574 |
| 2 | holder-api-key | 117 | 141.3 | 115.7 | 56.7 | 745 |
| 3 | holder-lapis-failed | 120 | 134.6 | 111.5 | 123.4 | 531 |
| 4 | holder-lapis-health | 122 | 123.1 | 122.5 | 119.1 | 514 |
| 5 | holder-call | 128 | 77.4 | 146.2 | 168.7 | 709 |
| 6 | holder-lapis-fuel | 133 | 115.7 | 137.4 | 157.4 | 497 |
| 7 | holder-sms-error | 134 | 155.9 | 126.1 | 114.4 | 621 |
| 8 | holder-print-error | 141 | 123.5 | 144.7 | 172.2 | 705 |
| 9 | holder-progress | 142 | 156.3 | 140.7 | 111.5 | 518 |
| 10 | holder-rain-alarm | 142 | 139.9 | 144.2 | 139.9 | 559 |
| 11 | holder-update-failed | 143 | 174.9 | 134.4 | 105.0 | 647 |
| 12 | holder-voicemail | 146 | 111.6 | 160.0 | 160.6 | 799 |
| 13 | holder-emotion-error | 146 | 140.6 | 146.6 | 153.9 | 645 |
| 14 | holder-message | 147 | 164.9 | 144.6 | 111.2 | 491 |
| 15 | holder-fleet-login | 151 | 135.3 | 155.3 | 169.7 | 672 |
| 16 | holder-fleet-attention | 151 | 139.1 | 154.7 | 163.2 | 726 |
| 17 | holder-call-missed | 151 | 232.4 | 121.4 | 90.2 | 572 |
| 18 | holder-fleet-done | 154 | 124.2 | 166.4 | 167.0 | 719 |
| 19 | holder-fleet-routine | 157 | 130.6 | 163.1 | 190.1 | 688 |
| **20** | **holder-car** | **160** | **152.8** | **161.9** | **171.9** | **485** |
| 21 | holder-lapis-unlocked | 162 | 191.5 | 159.5 | 100.0 | 380 |
| 22 | holder-lapis-run-left | 183 | 201.1 | 179.7 | 153.4 | 695 |
| 23 | holder-weather-alert | 184 | 204.4 | 184.6 | 123.5 | 589 |
| 24 | holder-lapis-service | 184 | 196.8 | 180.0 | 168.3 | 543 |
| 25 | holder-mail-error | 187 | 220.4 | 180.2 | 130.8 | 760 |
| 26 | holder-alarm | 192 | 210.6 | 188.8 | 162.1 | 582 |
| 27 | holder-email | 212 | 230.4 | 211.8 | 162.5 | 751 |
| 28 | holder-meeting | 217 | 245.0 | 215.7 | 151.6 | 725 |

Band of the other 27 icons (601): min 112.0, median 146.9, max 217.1. Car 160.4, rank 20 of 28 ascending. Meets 150+: YES. Icons below 150 among the others: 14 of 27.


## 3. Car before / interim / after

before = blob from 8b238f9a7, interim = 58af37765, after = working tree now (same commits, holder-car.png, holder-car@2x.png, holder-car@4x.png). Columns: mean RGB = primary formula.

| version | size | mean RGB (primary) | Rec.601 | Rec.709 | visible px |
|---|---|---|---|---|---|
| before (8b238f9a7) | 1x | 27.3 | 26.9 | 26.9 | 302 |
| before (8b238f9a7) | 2x | 27.5 | 27.1 | 27.1 | 1165 |
| before (8b238f9a7) | 4x | 27.0 | 26.6 | 26.6 | 4579 |
| interim (58af37765) | 1x | 176.3 | 188.0 | 187.7 | 404 |
| interim (58af37765) | 2x | 168.3 | 179.8 | 179.6 | 1573 |
| interim (58af37765) | 4x | 169.0 | 180.5 | 180.2 | 6186 |
| after (working tree) | 1x | 162.2 | 160.4 | 160.7 | 485 |
| after (working tree) | 2x | 163.3 | 161.4 | 161.8 | 1869 |
| after (working tree) | 4x | 162.2 | 160.3 | 160.7 | 7417 |

## 4. Band and the 150+ question

Primary formula (plain mean RGB, unweighted):
- The other 27 holder icons: min 104.6 (api-key), median 147.0, max 204.1 (meeting).
- Car after: 162.2, rank 21 of 28 ascending (7 icons are brighter, 20 are darker or equal in mean luminance; 15 of the other 27 are below 150).
- 150+: **YES, 162.2 >= 150.**

Rec.601 (the later session's formula):
- The other 27: min 112.0 (weather-severe), median 146.9, max 217.1 (meeting).
- Car after: 160.4, rank 20 of 28 ascending (14 of the other 27 are below 150).
- 150+: **YES, 160.4 >= 150.**

Rec.709 for the car: 160.7 at 1x (>= 150). Plain mean across 1x/@2x/@4x: 162.2 / 163.3 / 162.2; Rec.601: 160.4 / 161.4 / 160.3.

So by either formula the car sits inside the band of its neighbours, slightly above the median (about 147) and below the brightest group (alarm, email, meeting, mail-error, lapis-run-left, lapis-service, weather-alert at 171..217). The interim key picture was brighter (176 plain / 188 Rec.601) than the final car.

## 5. Files and git facts

sha256sum (working tree):

```
c08cf5769308d4228026b06537a02d19639c886cd84fa07600a3ab16b599974f  public/static_images/wm65/holder-car.png
49b3eecc08b10b0a01fab52fdb093c7a4e0f18634b31790898f8e2740a21f8d6  public/static_images/wm65/holder-car@2x.png
58778e4cf1f19b7cfa32e339bb4ba91642ddcc9ded5e1ed30fb170630428d410  public/static_images/wm65/holder-car@4x.png
05b4ba371dd91d27c11ff98db870d0da8b7575bf448af96601508168b3a833ac  public/static_images/lapis/car.webp
```

`git log --oneline -3 -- public/static_images/lapis/car.webp`:

```
8214378b9 feat(lapis): Lapis Remote phone app: vehicle screen, remote start, map, status, maintenance, driving record, settings, Today item, notices (#835)
```

Only the #835 Lapis Remote commit touched car.webp; neither #1338 commit (58af37765, 7907f33cb) did.

`git diff --stat 58af37765^ 7907f33cb` (the complete file list of the fix):

```
 public/static_images/app_icons/holder-car.png | Bin 0 -> 1105196 bytes
 public/static_images/wm65/holder-car.png      | Bin 1032 -> 1869 bytes
 public/static_images/wm65/holder-car@2x.png   | Bin 3093 -> 6163 bytes
 public/static_images/wm65/holder-car@4x.png   | Bin 9466 -> 20051 bytes
 scripts/build-wm65-holder-kind-icons.py       |   5 ++++-
 5 files changed, 4 insertions(+), 1 deletion(-)
```

Both commits are ancestors of origin/main. Local equivalents: 9b42b69ce and ecb526838. `git status --short` on these five files and car.webp: clean (no uncommitted changes) at measurement time.

Visible-pixel bounding boxes (alpha > 16, 32x32 file): car after (1,6)-(31,26) i.e. 30 x 20; car before (1,10)-(31,22) i.e. 30 x 12; alarm (3,3)-(28,30) i.e. 25 x 27; email (1,3)-(31,32) i.e. 30 x 29.
