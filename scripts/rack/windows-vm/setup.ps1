$ErrorActionPreference = 'Continue'
Start-Transcript -Path C:\rack-setup.log -Force | Out-Null
function Step($n) { "== $n $(Get-Date -Format s)" }
$src = (Get-PSDrive -PSProvider FileSystem | Where-Object { Test-Path (Join-Path $_.Root 'rack_ed25519.pub') } | Select-Object -First 1).Root
$vio = (Get-PSDrive -PSProvider FileSystem | Where-Object { Test-Path (Join-Path $_.Root 'virtio-win-guest-tools.exe') } | Select-Object -First 1).Root
"src=$src vio=$vio"
Step power
powercfg /setactive SCHEME_MIN
powercfg /change standby-timeout-ac 0; powercfg /change monitor-timeout-ac 0; powercfg /change disk-timeout-ac 0; powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
Step telemetry
New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection' -Force | Out-Null
Set-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection' AllowTelemetry 0 -Type DWord
Stop-Service DiagTrack -Force -ErrorAction SilentlyContinue; Set-Service DiagTrack -StartupType Disabled -ErrorAction SilentlyContinue
Step account
Set-LocalUser -Name rack -PasswordNeverExpires $true
Step virtio
if ($vio) { Start-Process "$($vio)virtio-win-guest-tools.exe" -ArgumentList '/install','/quiet','/norestart' -Wait }
Step openssh
$cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*'
if ($cap.State -ne 'Installed') { Add-WindowsCapability -Online -Name $cap.Name }
if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
  "capability failed, trying GitHub"
  $u = 'https://github.com/PowerShell/Win32-OpenSSH/releases/latest/download/OpenSSH-Win64.zip'
  Invoke-WebRequest $u -OutFile C:\openssh.zip -UseBasicParsing
  Expand-Archive C:\openssh.zip 'C:\Program Files' -Force
  & 'C:\Program Files\OpenSSH-Win64\install-sshd.ps1'
}
Set-Service sshd -StartupType Automatic
New-Item -Path HKLM:\SOFTWARE\OpenSSH -Force | Out-Null
New-ItemProperty -Path HKLM:\SOFTWARE\OpenSSH -Name DefaultShell -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -PropertyType String -Force | Out-Null
if (-not (Test-Path C:\ProgramData\ssh)) { New-Item -ItemType Directory C:\ProgramData\ssh | Out-Null }
Copy-Item (Join-Path $src 'rack_ed25519.pub') C:\ProgramData\ssh\administrators_authorized_keys -Force
icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
Start-Service sshd
if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null }
Step license
cscript //nologo C:\Windows\System32\slmgr.vbs /ipk NPPR9-FWDCX-D2C8J-H872K-2YT43
Step windowsupdate
$au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
New-Item -Path $au -Force | Out-Null
Set-ItemProperty $au NoAutoUpdate 0 -Type DWord; Set-ItemProperty $au AUOptions 2 -Type DWord
Set-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate' SetAutoRestartNotificationDisable 1 -Type DWord -ErrorAction SilentlyContinue
Step done
Set-Content C:\rack-setup.done (Get-Date -Format s)
Stop-Transcript | Out-Null
