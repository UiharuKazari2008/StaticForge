| run | display | first MelatonBars | token linked | main thread outside its looper for 2 s or more | longest main-thread log silence up to the link | longest hb.txt gap (wall / uptime) | getWindows seen in system_server | host: qemu cores mean (max), host CPU % mean (max), longest sample step |
|---|---|---|---|---|---|---|---|---|
| kill-1 | on | +0.34 s | +1.87 s | never | 0.34 s from +1.10 | 0.17 / 0.17 s | - | 1.2 (3.9), 21 (47), 1.1 s |
| kill-2 | on | +0.25 s | +1.32 s | never | 0.14 s from +0.45 | 0.16 / 0.14 s | - | 1.4 (3.8), 22 (52), 1.1 s |
| kill-3 | on | +0.28 s | +1.49 s | never | 0.32 s from +0.51 | 0.20 / 0.21 s | - | 1.3 (3.4), 22 (50), 1.3 s |
| kill-4 | on | +0.26 s | +1.43 s | never | 0.27 s from +0.63 | 0.20 / 0.20 s | - | 1.2 (4.0), 20 (41), 1.1 s |
| kill-5 | on | +0.27 s | +1.36 s | never | 0.17 s from +0.42 | 0.21 / 0.23 s | - | 1.2 (3.9), 20 (63), 1.4 s |
| kill-off-1 | OFF | +0.43 s | +12.00 s | +0.5..+31.4 s (30.9 s) | 5.77 s from +0.99 | 0.31 / 0.15 s | 4 of 6 dumps | 1.5 (2.7), 81 (100), 1.3 s |
| kill-off-2 | OFF | +0.29 s | +11.48 s | +0.4..+11.1 s (10.7 s); +12.3..+21.4 s (9.1 s) | 5.12 s from +0.77 | 0.17 / 0.17 s | 4 of 6 dumps | 1.3 (2.7), 39 (79), 1.2 s |
| reinstall-off-1 | OFF | +0.73 s | +11.71 s | +0.3..+31.3 s (31.0 s) | 6.77 s from +0.95 | 0.21 / 0.21 s | - | 1.1 (3.9), 18 (38), 1.1 s |
| reinstall-off-2 | OFF | +0.81 s | +11.74 s | +0.6..+31.7 s (31.1 s) | 4.58 s from +4.75 | 0.17 / 0.17 s | 5 of 6 dumps | 1.2 (3.8), 22 (52), 1.1 s |
| reinstall-off-3 | OFF | +0.78 s | +11.66 s | +0.4..+31.6 s (31.2 s) | 6.46 s from +4.57 | 0.21 / 0.20 s | 5 of 6 dumps | 1.3 (3.9), 23 (61), 1.2 s |
| reinstall-on-1 | on | +0.86 s | +2.13 s | never | 0.24 s from +0.04 | 0.18 / 0.18 s | 0 of 5 dumps | 1.6 (4.1), 25 (60), 1.1 s |
| reinstall-on-2 | on | +0.78 s | +2.24 s | never | 0.20 s from +0.06 | 0.21 / 0.21 s | - | 1.6 (4.4), 29 (65), 1.7 s |
| replay-crash-1 | on | +0.85 s | +5.58 s | +0.7..+12.7 s (12.0 s) | 1.09 s from +1.79 | 0.97 / 0.61 s | 0 of 5 dumps | 2.3 (3.9), 97 (100), 5.2 s |
| replay-crash-2 | on | +1.53 s | +3.53 s | +0.3..+3.7 s (3.3 s) | 0.44 s from +0.71 | 0.24 / 0.24 s | 0 of 2 dumps | 2.3 (4.4), 70 (98), 1.2 s |
