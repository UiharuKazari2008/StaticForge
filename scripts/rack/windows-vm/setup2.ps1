$ErrorActionPreference = 'Continue'
Start-Transcript -Path C:\rack-setup2.log -Force | Out-Null
function Step($n) { "== $n $(Get-Date -Format s)" }
$H = 'http://192.168.100.42:8099'
Step openssh
Expand-Archive C:\openssh.zip 'C:\Program Files' -Force
if (Test-Path 'C:\Program Files\OpenSSH-Win64') { Rename-Item 'C:\Program Files\OpenSSH-Win64' 'C:\Program Files\OpenSSH' -ErrorAction SilentlyContinue }
& 'C:\Program Files\OpenSSH\install-sshd.ps1'
Set-Service sshd -StartupType Automatic
New-Item -Path HKLM:\SOFTWARE\OpenSSH -Force | Out-Null
New-ItemProperty -Path HKLM:\SOFTWARE\OpenSSH -Name DefaultShell -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -PropertyType String -Force | Out-Null
if (-not (Test-Path C:\ProgramData\ssh)) { New-Item -ItemType Directory C:\ProgramData\ssh | Out-Null }
Invoke-WebRequest "$H/rack_ed25519.pub" -OutFile C:\ProgramData\ssh\administrators_authorized_keys -UseBasicParsing
icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
Start-Service sshd
Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Out-Null
if (-not $?) { }
New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -Profile Any -ErrorAction SilentlyContinue | Out-Null
Step license
cscript //nologo C:\Windows\System32\slmgr.vbs /ipk NPPR9-FWDCX-D2C8J-H872K-2YT43
Step windowsupdate
$au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
New-Item -Path $au -Force | Out-Null
Set-ItemProperty $au NoAutoUpdate 0 -Type DWord; Set-ItemProperty $au AUOptions 2 -Type DWord
Step autologon
$src = (Get-PSDrive -PSProvider FileSystem | Where-Object { Test-Path (Join-Path $_.Root 'autounattend.xml') } | Select-Object -First 1).Root
$pw = ([regex]::Match((Get-Content (Join-Path $src 'autounattend.xml') -Raw), '<AutoLogon>.*?<Value>(.*?)</Value>', 'Singleline')).Groups[1].Value
$wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty $wl AutoAdminLogon '1'; Set-ItemProperty $wl DefaultUserName 'rack'; Set-ItemProperty $wl DefaultDomainName $env:COMPUTERNAME; Set-ItemProperty $wl DefaultPassword $pw
Remove-ItemProperty $wl AutoLogonCount -ErrorAction SilentlyContinue
$pw = $null
Step agent
New-Item -ItemType Directory C:\agent -Force | Out-Null
Invoke-WebRequest "$H/agent.cs" -OutFile C:\agent\agent.cs -UseBasicParsing
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /out:C:\agent\agent.exe /r:System.Drawing.dll /r:System.Windows.Forms.dll C:\agent\agent.cs
Set-Content C:\agent\token.txt 'template-no-token' -NoNewline
icacls C:\agent\token.txt /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
$a = New-ScheduledTaskAction -Execute 'C:\agent\agent.exe'
$t = New-ScheduledTaskTrigger -AtLogOn -User 'rack'
$p = New-ScheduledTaskPrincipal -UserId 'rack' -LogonType Interactive -RunLevel Highest
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName RackVmAgent -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null
New-NetFirewallRule -Name 'RackVmAgent-In' -DisplayName 'Rack VM agent 8790' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 8790 -Profile Any | Out-Null
Start-ScheduledTask -TaskName RackVmAgent
Step done
Set-Content C:\rack-setup2.done (Get-Date -Format s)
Stop-Transcript | Out-Null
