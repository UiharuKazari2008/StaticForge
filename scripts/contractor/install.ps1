# Fleet Contractor installer for Windows (#1154). Installs the headless agent that connects this machine to a
# Dreamscape Fleet server, pairs it with a one-time code from Fleet, and runs it at logon as a scheduled task
# (per user, hidden, restarted on failure).
#
#   powershell -ExecutionPolicy Bypass -File fleet-contractor-install.ps1 -Server https://dreamscape.example -Name "Build PC" -Project C:\src\app
#   powershell -ExecutionPolicy Bypass -File fleet-contractor-install.ps1 -Uninstall
#
# The pairing code is asked for (or read from $env:FLEET_PAIR_CODE); it is never a command-line argument.
# Needs Node.js 20+ and the claude CLI (logged in: its login stays on this machine). Sessions run as child
# processes of the agent in print mode with stream-json input (no Remote Control link on Windows).
param(
    [string]$Server = '',
    [string]$Name = '',
    [string[]]$Project = @(),
    [string]$Claude = '',
    [string]$Prefix = (Join-Path $env:LOCALAPPDATA 'FleetContractor'),
    [switch]$NoTask,
    [switch]$DryRun,
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Fleet Contractor'

# >>> embedded files (filled in by the server)
$EmbeddedAgent = $null
$EmbeddedTranscript = $null
# <<< embedded files

function Say($m) { Write-Host "fleet-contractor: $m" }
function Die($m) { Write-Host "fleet-contractor: $m" -ForegroundColor Red; exit 1 }

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Prefix 'agent.js'), (Join-Path $Prefix 'claudeTranscript.js'), (Join-Path $Prefix 'credential.json')
    Say "removed the agent, its task and its credential. Revoke the contractor in Fleet too; config.json is kept."
    exit 0
}

# ---- checks
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { Die 'node is not installed (Node.js 20 or newer is needed)' }
$major = [int](& $node.Source -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) { Die "Node.js $major is too old: 20 or newer is needed" }
if (-not $Claude) {
    $c = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
    if (Test-Path $c) { $Claude = $c } else {
        $g = Get-Command claude -ErrorAction SilentlyContinue
        if ($g) { $Claude = $g.Source }
    }
}
if (-not $Claude -or -not (Test-Path $Claude)) { Die 'the claude CLI was not found (install Claude Code and log in, or pass -Claude PATH)' }
if (-not $Server) { Die '-Server https://... is needed' }
if ($Server -notmatch '^https?://') { Die '-Server must start with https://' }
if (-not $Name) { $Name = $env:COMPUTERNAME }
Say "node $(& $node.Source --version), claude at $Claude"

# ---- files (owner-only ACL on the folder: the credential lives here)
New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
& icacls $Prefix /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" | Out-Null
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
function Install-File($file, $text, $fallback) {
    $dest = Join-Path $Prefix $file
    if ($text) { [IO.File]::WriteAllText($dest, ($text -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding($false))) }
    elseif (Test-Path $fallback) { Copy-Item -Force $fallback $dest }
    else { Die "this installer has no $file inside it: get it from Fleet (Contractors > Get installer)" }
}
Install-File 'agent.js' $EmbeddedAgent (Join-Path $here 'agent.js')
Install-File 'claudeTranscript.js' $EmbeddedTranscript (Join-Path $here '..\..\modules\claudeTranscript.js')
Say "agent installed in $Prefix"

# ---- pairing (config + credential go to the same folder: FLEET_CONTRACTOR_HOME)
$env:FLEET_CONTRACTOR_HOME = $Prefix
$pairArgs = @((Join-Path $Prefix 'agent.js'), 'pair', '--server', $Server, '--name', $Name, '--claude', $Claude)
foreach ($p in $Project) { $pairArgs += @('--project', (Resolve-Path $p).Path) }
if ($DryRun) {
    Say "dry run: would run: node $($pairArgs -join ' ')  (pairing code asked for)"
} else {
    if (-not $env:FLEET_PAIR_CODE) {
        $sec = Read-Host -AsSecureString 'Pairing code from Fleet'
        $env:FLEET_PAIR_CODE = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    }
    & $node.Source @pairArgs
    $ok = $LASTEXITCODE -eq 0
    Remove-Item Env:\FLEET_PAIR_CODE -ErrorAction SilentlyContinue
    if (-not $ok) { Die 'pairing failed' }
}

# ---- scheduled task at logon (hidden, restarts on failure)
if ($NoTask) { Say "no task installed (-NoTask): run node $Prefix\agent.js run"; exit 0 }
$runner = Join-Path $Prefix 'run-agent.cmd'
$cmd = "@echo off`r`nset FLEET_CONTRACTOR_HOME=$Prefix`r`n`"$($node.Source)`" `"$Prefix\agent.js`" run >> `"$Prefix\agent.log`" 2>&1`r`n"
if ($DryRun) { Say "dry run: would register task '$TaskName' running $runner"; exit 0 }
[IO.File]::WriteAllText($runner, $cmd)
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Say "running as the scheduled task '$TaskName'; log: $Prefix\agent.log"
