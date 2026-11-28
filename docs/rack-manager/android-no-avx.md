# Android without AVX on Fat Misaka: attempts and results

Nov 27 2026. Host: DL580 G7, 4x Xeon E7-4860 (Westmere-EX): `vmx`, `sse4_2`, no AVX. Order of attempts is in README.md "Android without AVX".

## Result (Nov 27 2026, after `intel_iommu=off`)

**Step 1 succeeds: the current SDK emulator (37.3.10.0, build 16970787) runs on the Westmere CPUs without AVX. Steps 2 to 5 were not needed.**
No SIGILL and no startup CPU check: `emulator-check accel` = KVM usable, `emulator-check cpu-info` = no objection, and qemu-system-x86_64-headless runs.

| AVD (created by the android role as user `rack`) | image | emulator flags | `sys.boot_completed` | screenshot |
|---|---|---|---|---|
| `lane-a53` (device `pixel_6`, 3 GB RAM, 8 GB data) | `system-images;android-36;google_apis;x86_64` | `-no-window -gpu swiftshader_indirect -no-audio -no-boot-anim` | **1** (about 1 minute from start), `ro.build.version.sdk=36`, abi x86_64 | **works** (`android/screenshot`: real 1080x2400 PNG of the lock/home screen, served at `/v1/files/shots/...`) |
| `lane-fold` (device `7.6in Foldable`, 4 GB RAM, 8 GB data) | `system-images;android-37.0;google_apis;x86_64` | same | **1**, `ro.build.version.sdk=37` | **not yet**: `adb exec-out screencap` aborts in the guest with `Assertion failed: !rcEnc->featureInfo()->hasReadColorBufferDma` (also with `-gpu guest`, `-feature -GLDMA`, and `-gpu swangle_indirect`, which hung); the console's `screenrecord screenshot <dir>` answers OK but writes no file with `-no-window` |

**Update (Nov 28 2026): solved for the lane.** With the lane's AVD config (`hw.gpu.mode=swiftshader_indirect`) the API 37 Fold screenshots work (`screencap -d <id> -p` to a file, then pull); details, the API 36 `-gpu guest` finding and the lane's four Misaka instances: docs/testing/emulator-lane.md "The Fat Misaka pool".

The API 37 screenshot needs one more attempt (a different `-gpu` mode, `-feature` names, or an older emulator build with `emulator-build {build}`; the role already installs archived builds under `/opt/android-emulators/<build>` and `create/start` take `emulator: <build>`). The AVDs were deleted after the test; recreate with `android/create`.
The foldable device name for avdmanager is `7.6in Foldable` (there is no `pixel_fold` in this cmdline-tools).

## Earlier attempts (before the fix)

The first start of `lane-a53` crashed the host (below); that was not an AVX refusal.

## What stopped the test: the host crashes under disk writes (not an Android problem)

Twice (17:30 while `docker build` wrote the dsapp image, 17:43 while the system images were unpacked and the emulator started) the host rebooted by itself.
The previous boot's journal ends with:

```
DMAR: ERROR: DMA PTE for vPFN 0xbf7f4 already set (to bf7f4003 not ...)
WARNING: ... drivers/iommu/intel/iommu.c:1884 intel_iommu_map_pages.cold
 ... iommu_map_sg <- dma_map_sg_attrs <- scsi_dma_map <- hpsa_ciss_submit [hpsa] <- blk_mq ...
```

The Smart Array (hpsa) disks collide with the HP BIOS RMRR regions (`RMRR base: 0xbf7f4000 end: 0xbf7f9fff`) once the IOMMU is on (Debian's kernel enables Intel IOMMU by default).
After a few GB of writes the kernel goes down. Current kernel command line: `quiet intremap=nosid nomodeset console=ttyS1,115200n8`.

Fix applied by the lead (grub backup `/etc/default/grub.bak-20261127-iommu`): add `intel_iommu=off` to `GRUB_CMDLINE_LINUX_DEFAULT` in `/etc/default/grub`, `update-grub`, reboot.
After the reboot the same workloads ran without any crash: a dsapp build (about 5.5 minutes, 47 MB APK), system image unpacking and two AVD boots.
