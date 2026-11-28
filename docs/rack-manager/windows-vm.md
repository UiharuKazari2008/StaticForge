# Windows 11 test VMs on Fat Misaka

`win11-template` is a Windows 11 (25H2, build 26200) VM on Fat Misaka. Short-lived test VMs are linked clones of it: a qcow2 overlay, a few hundred milliseconds
to create, about 75 s to a desktop, dropped with `delete`. Built Nov 27 2026 for the Windows app (Dreamscape VDI, `DreamScape/DSApp-Win`).

## What is where

| thing | where |
|---|---|
| install media (iso pool) | `Win11_25H2_Enterprise_Eval_en-us_x64.iso` (7.09 GB, build 26200.6584), `virtio-win.iso` (stable) in `/var/lib/libvirt/images/iso/` |
| SHA-256 | Enterprise eval `a61adeab895ef5a4db436e0a7011c92a2ff17bb0357f58b13bbc4062e535e7b9`, virtio-win `303f7ae40dad495d6ae474fdc571df58958a4dbc5c37a522d80f9a203867949d` (Microsoft publishes no hash for the eval ISO; the size matched the CDN's Content-Length) |
| VM disks | LV `vmdata/winvms` (300 GB xfs) mounted at `/srv/rack/winvms` (fstab, `nofail`): the template qcow2 and every clone overlay |
| rack account | `rack`, password in `/etc/rackd/secrets/win11-rack.pass` (host, root, 600) and `~/.secrets/win11-rack.pass` (Dreamscape, 600). Never print it |
| build scripts | `scripts/rack/windows-vm/` (`make-autounattend.py`, `setup.ps1`, `setup2.ps1`, `agent.cs`, `ga.py`) |

## The ISO and the activation note

Microsoft's consumer ISO flow (Fido / `GetProductDownloadLinksBySku`) answered `Sentinel marked this request as rejected` from both the host and Dreamscape, so the
**Windows 11 Enterprise evaluation ISO** is used (`go.microsoft.com/fwlink/?linkid=2334167`, a direct CDN download). It is the Enterprise Evaluation edition,
valid 90 days from first boot without activation.

- Yukimi: install with the KMS client key, activate later, short-lived installs do not need activation. The Enterprise public GVLK `NPPR9-FWDCX-D2C8J-H872K-2YT43` is given to Setup
  (`specialize` pass) and to `slmgr /ipk`; the evaluation SKU answers `0xC004F069` to `/ipk` (a KMS key does not apply to an Evaluation SKU), so the VM is **not activated** and shows the
  "Windows 11 Enterprise Evaluation, license valid for 90 days" watermark. That is fine for tests. To get a Pro template instead: a consumer ISO from a browser on a
  machine Microsoft accepts, the key `W269N-WFGWX-YVC9B-4J6C9-T83GX`, and change `InstallFrom` in `make-autounattend.py`.
- The 90 days run from the template's install (Nov 27 2026): refresh the template (below) before about Feb 25 2027, or the clones count down from the same date.

## Template build (what was done)

1. Disk `qemu-img create -f qcow2 ... 120G` at `/srv/rack/winvms/win11-template.qcow2`.
2. `virt-install`: q35, `OVMF_CODE_4M.ms.fd` secure boot with `OVMF_VARS_4M.ms.fd` (Microsoft keys enrolled), swtpm 2.0 (`tpm-crb`), 8 vCPU, 16 GB, `host-passthrough`
   (works on the Westmere-EX CPUs: SSE4.2/POPCNT are enough for 25H2), virtio-blk disk, virtio-net on `br0`, VGA, VNC on 127.0.0.1, guest agent channel, three SATA CD-ROMs
   (install ISO, virtio-win, an autounattend ISO), `--osinfo win11`.
3. `autounattend.xml` (made by `make-autounattend.py`): LabConfig bypasses (TPM, Secure Boot, CPU, RAM), GPT layout, virtio drivers loaded in WinPE from the virtio-win ISO,
   image index 1, local admin `rack`, BypassNRO, auto-logon. The "Press any key to boot from CD" prompt is passed with `virsh send-key win11-template KEY_SPACE` in a loop.
4. First logon `setup.ps1` (from the unattend ISO): High performance power plan, no sleep/hibernate, telemetry 0 (Enterprise honours 0), `rack` password never expires,
   `virtio-win-guest-tools.exe /install /quiet` (virtio drivers, QEMU guest agent, viogpudo), then OpenSSH.
5. `Add-WindowsCapability OpenSSH.Server` hung for 15+ minutes (Windows Update on the LAN), so OpenSSH came from the Win32-OpenSSH GitHub zip instead
   (`setup2.ps1`, which also does the rest): key auth for `rack` through `C:\ProgramData\ssh\administrators_authorized_keys` (Dreamscape's `~/.ssh/rack_ed25519.pub`),
   default shell PowerShell, Windows Update notify only (`AUOptions=2`), permanent auto-logon of `rack` (Winlogon `AutoAdminLogon`), network profile Private.
   `setup2.ps1` fetched its files from a throwaway `python3 -m http.server` on the host; the install was driven through the guest agent (`ga.py`) while SSH was not yet there.
6. Shut down, CD-ROMs ejected, `adopt {name, guest:'windows'}` (adds the serial log), tag `template=windows11`, internal checkpoint `golden`.

Times (Nov 27 2026, host busy with lane emulators): ISO + virtio download 5 min; unattended Windows install to first desktop 27 min; first-logon setup and agent 20 more min
(15 of them the hung capability install); template made at 22:48.

## In-guest agent (same as the Vista VM, `docs/vista-vm-agent.md`)

- `C:\agent\agent.exe`, built in the VM with `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /target:winexe /r:System.Drawing.dll /r:System.Windows.Forms.dll agent.cs`
  from `scripts/rack/windows-vm/agent.cs` (the Vista source, token-free; the only change: the token is read from `C:\agent\token.txt` on every request and the mutex is `RackVmAgent`).
- Port 8790, header `X-Token`. Scheduled task `RackVmAgent`: at logon of `rack`, interactive, highest privileges, restarts every minute on failure, so `/shot` sees the desktop.
  Firewall rule `RackVmAgent-In` (TCP 8790, any profile; the LAN is Private anyway).
- `C:\agent` is Administrators/SYSTEM only. The template holds the dummy token `template-no-token`.
- Per clone: `linked-clone` writes a random token to `/etc/rackd/secrets/vm-agent/<name>` (root, 600) and `agent-register`s it, then writes it to the guest's `C:\agent\token.txt` through the guest agent
  as soon as the guest answers (no restart needed). `delete` removes the secret. `waitAgentS` on `linked-clone` waits for that write (`agentToken: pushed`).
- Calls: Fleet `rack_role {server:"misaka", role:"vms", action:"agent", params:{name, route:"ping"|"run"|"shot"|"get"|"put"|"list"|"exists", method?, body?}}`, or
  curl from Dreamscape with the token read from the host: `T=$(ssh fat-misaka sudo cat /etc/rackd/secrets/vm-agent/<name>)`, `curl -H "X-Token: $T" http://<ip>:8790/ping`,
  `curl -H "X-Token: $T" -X POST --data 'ver' 'http://<ip>:8790/run?t=20'`, `curl -H "X-Token: $T" http://<ip>:8790/shot -o shot.png`.
  Without the network: `exec` (guest agent), `file-read`, `file-write`, `screen`, `input`.

## Make and drop a test clone

```
rack_role {server:"misaka", role:"vms", action:"linked-clone", params:{source:"win11-template", name:"win-test-x", waitIpS:120, waitAgentS:120}}
```

Optional `memMB`, `vcpus` (defaults 16 GB / 8 vCPU; the template's), `start:false`, `purpose`. It makes `/srv/rack/winvms/<name>.qcow2` (backing file = the template disk), a copy of the template's NVRAM and swtpm
state, a new UUID and MAC, tags `purpose=windows-test`, `disposable=true`, `cloneof=win11-template`, and starts it. `ip` in the answer is the IPv4 address (leases come from the LAN DHCP, the guest agent reports them).

- ssh: `ssh -i ~/.ssh/rack_ed25519 rack@<ip>` (a PowerShell prompt; use `;` not `&`).
- Screenshot: `vms screenshot {name}` (virsh, works at any time) or the agent's `/shot` (the composed desktop).
- Drop: `rack_role {... action:"delete", params:{name:"win-test-x", storage:true, force:true}}` (removes the overlay, NVRAM, swtpm state and the agent secret).
- The template is locked while any clone exists: `start`, `snapshot` and `delete` of it answer `IN_USE`. Never boot it with clones around: they would read a changed backing file.

Measured (Nov 27 2026): clone creation 0.27 s (`start:false`), delete 0.6-0.8 s; boot to a desktop and DHCP address 75 s (two clones at once, the second with 4 vCPU / 8 GB: address and agent token in 132 s);
ssh, `/ping`, `/run`, `/shot` and the guest agent all answered on both; a wrong token gets 403.

## Windows app smoke test (Dreamscape VDI)

Releases live on Yozora: `DreamScape/DSApp-Win` releases, asset `Dreamscape-VDI-<ver>-win-x64.exe` (latest v1.0.1, Oct 23 2026; a portable Electron app, needs the Yozora token to download).
In a clone: `scp` the exe to `C:/Users/rack/`, then through the agent `/run` with `start "" C:\Users\rack\dsvdi.exe` (it runs in the desktop session). It opens on "Connect to Dreamscape"
(server address prefilled `staticforge.737.jp.net`); proof in `docs/testing/evidence/rack-windows/dsapp-win-1.0.1-start.png`.

## Refresh the template (updates, a new build of the agent, ...)

1. Delete every clone (`delete`), then `vms start {name:"win11-template"}` (allowed once no clone exists).
2. `ssh rack@<ip>`: run Windows Update (it is notify only), change what you need, rebuild the agent if needed, then `shutdown /s /t 0`.
3. Eject any media (`virsh change-media win11-template sdX --eject --config`), `vms snapshot {name:"win11-template", snap:"golden2", op:"create"}`; delete the old `golden` when happy.
4. A bad refresh: `virsh snapshot-revert win11-template golden` (internal checkpoint, VM off).

## Gotchas

- The deployed rackd must carry the current `services/rackd/roles/vms.js` (linked-clone, the delete cleanup, IPv4 address pick-up). The `domifaddr` parser ignored rows without a MAC; it now reads an interface's later rows, so IPv4 wins over IPv6 link-local.
- Clones share the template's computer name (`WIN11-TPL`), host keys and SID: fine for short-lived tests, DHCP uses the MAC. Rename in the guest when two must meet on one network.
- `Add-WindowsCapability` for OpenSSH can hang on this network; the GitHub zip route is in `setup2.ps1`.
- `virsh qemu-agent-command` needs `--timeout` for guest-exec while the guest is busy (5 s default).
