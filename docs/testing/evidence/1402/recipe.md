# #1402 recipe (phase 1, run on aemu-fold-1, release versionCode 3632251)

Only case Z was run. P and D are written down but NOT run yet (untested commands; check each `ls -laZ`).

```
L="/home/kanmi/staticforge/scripts/aemu-lane/lane.sh --agent claude-0e4f7089"; I=aemu-fold-1
P=jp.net.seventhreeseven.dreamscape; D=/data/data/$P/files/adb
```

## Once per run

1. Shizuku must run and the app be allowed: `$L $I shizuku status` (after a boot: `$L $I shizuku start`; the app then needs a NEW process to get the binder).
2. Backup (keep through phase 2): `$L $I su "mkdir -p /data/local/tmp/k1402 && cp -p $D/adbkey* /data/local/tmp/k1402/"`
3. Accessibility to put back after every app restart (read BEFORE the first stop):
   `$L $I su "settings get secure enabled_accessibility_services; settings get secure accessibility_enabled"`
   was `jp.net.seventhreeseven.dreamscape/jp.net.seventhreeseven.dreamscape.MelatonBarService` and `1`.
   Put back: `$L $I su "settings put secure enabled_accessibility_services $P/$P.MelatonBarService; settings put secure accessibility_enabled 1"`
   (in this run `stop-app` did not clear them, but put them back anyway).

## The trigger: a shell command run BY THE APP through LocalAdb.shell

Route: server `POST /api/activesync/adb/<deviceId>/shell` -> ActiveSync op `device.adbShell` -> `LocalAdb.shell`
(the server answers it by asking the phone; its own adb says "unreachable" for the emulator, so it is not the server's adb).
deviceId of aemu-fold-1: `$($L $I status | jq -r .deviceId)` = f59ea601ec17510953a44bf8e09c35a0.

Needs the phone-side feature "commands" (server side already had it on). It is OFF by default on the app:
```
$L $I adbsettings '{"features":{"commands":true}}'      # via the page bridge AndroidActiveSync.setAdbSettings
...
$L $I adbsettings '{}'                                   # at the end: back to the defaults (commands false)
```
The call (auth and base URL exactly as `api()` in lane.sh: key file `~/.secrets/dreamscape-claude.key`, http://127.0.0.1:9220):
```
k=$(tr -d '[:space:]' < ~/.secrets/dreamscape-claude.key)
curl -sS -m 70 -X POST -H "Authorization: Bearer $k" -H "X-StaticForge-App-Key: $k" -H 'User-Agent: claude-code' \
  -H 'Content-Type: application/json' --data '{"command":"id; echo hello-1402"}' \
  http://127.0.0.1:9220/api/activesync/adb/f59ea601ec17510953a44bf8e09c35a0/shell
```
How to tell the route: healthy via adb = answer has no `"via"` field and adbd logs `adbd service requested 'shell,v2,raw:<command>'`
(no `TERM=` part: that part is on the lane's own adb calls; `$L $I logcat 300 --all | grep 'echo hello'`).
Via Shizuku = answer carries `"via":"shizuku"`. A failed key (old app) = `{"success":false,"code":"io","error":"...Error parsing private key"}`.
The old app logs nothing for the failure itself; the only LocalAdb line is `pass (fresh): ...`.

## Case Z: both files 0 bytes (run)

A fresh process is needed (key cached per process). `stop-app` first, so the app cannot start and read the key between steps:
```
$L $I stop-app
$L $I su ": > $D/adbkey; : > $D/adbkey.pub; ls -laZ $D"   # owner, mode 600 and label kept (truncated in place)
$L $I start-app          # then put accessibility back, wait ~25 s, then the shell call above
```
Restore:
```
$L $I stop-app
$L $I su "cp -p /data/local/tmp/k1402/adbkey /data/local/tmp/k1402/adbkey.pub $D/ && chown u0_a234:u0_a234 $D/adbkey $D/adbkey.pub && restorecon $D/adbkey $D/adbkey.pub; chmod 600 $D/adbkey $D/adbkey.pub; ls -laZ $D; sha256sum $D/*"
$L $I start-app          # accessibility back, wait ~25 s, shell call works
```
(`cp -p` into the existing files keeps the label; the first `cp -p` of /data/local/tmp files has label shell_data_file, restorecon fixes it:
verified in this run, label back to `u:object_r:app_data_file:s0:c234,c256,c512,c768`, sha256 equal.)
sha256 of the originals: adbkey 55304234ceaa072a789aee564695d35f2adb409c103badbf59a3b06281c10423, adbkey.pub 665f73be462aec7b7c40d097b8ae1f263e08864482852fe3be884622ff157b7b.

## Case P: only adbkey.pub 0 bytes (run in phase 2, release 3632745)
```
$L $I stop-app
$L $I su "cp -p $B/adbkey $B/adbkey.pub $D/ && chown u0_a234:u0_a234 $D/adbkey $D/adbkey.pub && chmod 600 $D/adbkey $D/adbkey.pub && restorecon $D/adbkey $D/adbkey.pub"   # backup pair first; check sha256
$L $I su ": > $D/adbkey.pub; ls -laZ $D"
$L $I start-app          # accessibility, ~28 s, shell call, then `$L $I logcat 60 --all | grep LocalAdb`
```
Result: `adbkey.pub was made again from the adb key: adbkey.pub is empty`, adbkey sha unchanged, adbkey.pub identical to the backup.

## Case D: `adb` folder replaced by an empty regular file (run in phase 2)
```
$L $I stop-app
$L $I su "rm -rf $D && touch $D && chown u0_a234:u0_a234 $D && chmod 600 $D && restorecon $D; ls -laZ /data/data/$P/files | grep ' adb\$'"
$L $I start-app          # accessibility, ~28 s, shell call -> "via":"shizuku"; app status: $L $I eval 'AndroidActiveSync.adbStatus()' (field error)
```
Restore (the toybox `chcon` has NO --reference; use the literal label; the first attempt with --reference failed and left the app to make a new key):
```
$L $I stop-app
$L $I su "L=u:object_r:app_data_file:s0:c234,c256,c512,c768; rm -rf $D; mkdir $D && chown u0_a234:u0_a234 $D && chmod 700 $D && chcon \$L $D && cp -p $B/adbkey $B/adbkey.pub $D/ && chown u0_a234:u0_a234 $D/adbkey $D/adbkey.pub && chmod 600 $D/adbkey $D/adbkey.pub && chcon \$L $D/adbkey $D/adbkey.pub; ls -laZ $D; sha256sum $D/*"
$L $I start-app
```
Also: `kill-app` makes Android start the app again by itself within seconds (a new process); `stop-app` does not.
