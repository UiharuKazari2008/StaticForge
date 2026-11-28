# DreamOS on Fat Misaka

DreamOS images are built, signed and tested on Fat Misaka. Full guide: `docs/rack-builds.md` in the DreamScape/DreamOS repo
(branch `rack-builds` until merged).

- **Build:** `builds` pipeline `dreamos` (privileged mkosi container, root, host `/dev`, 32 CPUs). Run with
  `rack_role {server:"misaka", role:"builds", action:"run", params:{pipeline:"dreamos", env:{FLAVOR:"dev"}}}`.
  A cold dev image takes about 8 minutes, a warm one 5.5 minutes. Output: `/srv/rack/artifacts/<run>/out`, unsigned.
- **Signing:** pipeline `dreamos-release` (the only container with `/etc/rackd/secrets/dreamos` mounted read-only; input =
  a build run). Test channels only (`test*`) unless told otherwise. Ruiko's `dreamos-build` VM keeps its copy of the key
  as the fallback; versions are claimed first with `tools/reserve-version.sh` (a `release-<ver>` tag on Yozora).
- **Tests:** libvirt on the host through `DREAMOS_VM_BACKEND=libvirt tools/vm-e2e.sh | vm-update-test.sh | vm-rollback-test.sh`.
- **Chromium:** `dreamos-chromium` is defined (vanilla 156.0.8078.79 content_shell / future forge_shell, no Alchemy patches), not run.
- **Code:** `services/rackd/roles/builds.js` gained `privileged`, `devMount`, `secrets`, `acceptsInput`, `envParams` for shipped
  presets; it is not deployed until rackd is redeployed. Pipeline files are copied into `/opt/rackd/pipelines` already.
