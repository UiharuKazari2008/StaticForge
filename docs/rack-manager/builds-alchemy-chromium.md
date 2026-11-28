# Alchemy-Chromium on Fat Misaka (`builds` role)

Fat Misaka replaces Sequenzia Core as the Chromium build host (Yukimi, Nov 27 2026). Pipeline: `services/rackd/pipelines/alchemy-chromium.json` + `.Dockerfile`
(presets are read from `/opt/rackd/pipelines` on the host; `scripts/rack/deploy-rackd.sh` ships them, or copy the two files there: no rackd restart needed).

## Layout
- LV `rackchromium` (400 GB, xfs, VG vmdata) mounted at `/srv/rack/builds/alchemy-chromium` (fstab, `defaults,nofail`), on top of the `rackbuilds` mount.
  `src/` = the DreamScape/Alchemy-Chromium checkout (branch `master`, mounted as `/work/src`); `cache/` = `/cache` in the container:
  `chromium/` (gclient checkout + `out/Alchemy`, about 140 GB after a build), `ccache/`, `home/`.
- Output: `/srv/rack/artifacts/<runId>/out/alchemy-chromium-<tag>.tar.gz` and `.sha256`.

## How the run works
- The script copies the repo's own `build-alchemy.sh` and adjusts four lines with sed (ROOT = `/cache/chromium`, HERE = `/work/src`, no `sudo install-build-deps`, `cc_wrapper = "ccache"` added to the gn args), so gn args, patch list and
  tarball layout stay what the repo (and Core) define. `JOBS=80`, `TAG` come from the pipeline `env` (TAG 156.0.8078.79 now: change it in the JSON for a new stable).
- Stage: `all` when `cache/chromium/src/chrome/VERSION` is not the TAG (sync, hooks, patch, gn, build, package); `after-sync` when it is (no sync). Override with env `STAGE` (`build` after a patch change: minutes).
- Container: 80 CPUs, 128 GB RAM, timeout 18 h. Image `rack-build-alchemy-chromium:<hash>` (debian trixie, depot_tools bootstrapped with `ensure_bootstrap`, ccache, Pillow for `brand.py`, the dev packages
  instead of `install-build-deps`).

## First build (Nov 27-28 2026, run `jmwzosfd84b5b`, Chromium 156.0.8078.79, repo commit 88a7c85)
| step | time |
| --- | --- |
| gclient sync (shallow, no history) | about 6.5 min (00:02:39 to 00:09:00 UTC) |
| hooks, apply.py + brand.py, gn | about 3 min |
| autoninja chrome, 57341 steps, 80 jobs | 19:43:18 to 21:28 local (00:43:18 to 02:28:10 UTC): 1 h 45 min, load average about 90, RAM used about 25 GB at the one sample taken |
| package + copy | 35 s |
| total from empty cache | about 2 h 05 min (Core: 5 h 48 min on 12 threads) |

Tarball: `alchemy-chromium-156.0.8078.79.tar.gz`, 201,228,625 B, sha256 `f3bba67ed3382ed1e555c21440310db366d549276698bec100d1e604c8a9b2b7` (matches after the copy to Dreamscape `~/.cache/alchemy-build/`).
Layout identical to Core's (alchemy, chrome, crashpad handler, paks, icudtl, v8 snapshot, swiftshader/vulkan libs, locales/en-US.pak, alchemy-patches.json with the 8 patches).

## Differences from Core's build
- Built in a container, not on the bare host; no `install-build-deps` (packages are in the image).
- 80 jobs at normal priority inside the container (the repo script's `nice 19` / `ionice -c3` stays, nothing competes on the host). Core used 4 to 12 jobs.
- ccache wraps the compiler, but it was useless for this first build: 90 % of calls were uncacheable and 0 hits (clean tree). Check the hit rate on a second build before relying on it; harmless otherwise.
- Same gn args as the repo script (is_official_build false, symbol_level 0, proprietary codecs, stripped features), `use_siso=false`, ninja.

## Traps hit
- A repeat `gclient sync --shallow` on an existing checkout refetches for 20+ minutes (once hung at 0 % CPU on `git fetch origin`): hence the VERSION check that skips the sync.
- `brand.py` needs Pillow (`python3-pil`); `gn` through depot_tools needs `ensure_bootstrap` (`python3_bin_reldir.txt`), which a skipped sync never creates: both are in the image now.
- The preset's `ref` is `master` (the repo has no `main`).
- The Dockerfile hash changes with every edit, so the image rebuilds once (about 1 min with cached layers).

## Viewer test (from /home/kanmi/staticforge, binary unpacked in `~/.cache/alchemy-build/unpacked`)
`node scripts/test-alchemy-viewer.js --chrome <bin>` is flaky on both builds: new build 3 of 5 runs "all passed", the others failed a single timing check (packed-scroll picture diff, cache rows 840 vs 1350, audio underruns 2);
the build in service (2026-11-21) passed 5 of 6 runs, once "timed out: scroll settles". `--mobile`: all passed on the new and the old build.
