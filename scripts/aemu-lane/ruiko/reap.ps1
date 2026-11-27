# reap.ps1 - stops lane emulators (AVD names aemu-*) that nobody used for IdleMinutes (default 30).
# Run on Ruiko by the scheduled task "aemu-lane-reap" (every 10 minutes, SYSTEM, session 0, hidden) and by `lane.sh reap`.
# -Names a,b limits it to those AVDs (lane.sh reap: instances whose coord lease ended).
# The last use of an instance is the file C:\Users\ykaza\claude-lane\last\<avd>.txt (unix seconds) that every lane.sh command
# refreshes; without the file the process start time counts. It only ever touches emulator.exe processes whose command
# line names an aemu-* AVD: the other sessions' emulators (fold7-test, DSFold7) are never matched.
param([int]$IdleMinutes = 30, [switch]$DryRun, [string[]]$Names = @())
$base = 'C:\Users\ykaza\claude-lane'
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$out = @()
foreach ($x in (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'emulator.exe' })) {
  if ($x.CommandLine -notmatch '-avd (aemu-[a-z0-9-]+).* -port (\d+)') { continue }
  $avd = $matches[1]; $port = [int]$matches[2]
  if ($Names.Count -gt 0 -and ($Names -notcontains $avd)) { continue }   # lane.sh reap names the instances whose lease ended
  $f = "$base\last\$avd.txt"
  $last = $null
  if (Test-Path $f) { try { $last = [int64]((Get-Content $f -Raw).Trim()) } catch { $last = $null } }
  if (-not $last) { $last = [DateTimeOffset]::new($x.CreationDate.ToUniversalTime()).ToUnixTimeSeconds() }
  $idle = [math]::Round(($now - $last) / 60, 1)
  $row = [ordered]@{ avd = $avd; port = $port; idleMinutes = $idle; stopped = $false }
  if ($idle -ge $IdleMinutes -and -not $DryRun) {
    $done = $false
    try {   # the emulator's own console, as the user's token file says: a clean shutdown
      $tok = (Get-Content 'C:\Users\ykaza\.emulator_console_auth_token' -Raw).Trim()
      $c = New-Object Net.Sockets.TcpClient('127.0.0.1', $port); $s = $c.GetStream()
      $w = New-Object IO.StreamWriter($s); $w.NewLine = "`n"; $w.AutoFlush = $true
      Start-Sleep -Milliseconds 400; $w.WriteLine("auth $tok"); Start-Sleep -Milliseconds 400; $w.WriteLine('kill'); Start-Sleep -Milliseconds 800
      $c.Close(); $done = $true
    } catch { }
    if (-not $done) {
      Get-CimInstance Win32_Process -Filter "ParentProcessId=$($x.ProcessId)" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue
    }
    $row.stopped = $true
  }
  $out += [pscustomobject]$row
}
$json = ConvertTo-Json -InputObject @($out) -Compress
Add-Content -Path "$base\logs\reap.txt" -Value ("{0} {1}" -f (Get-Date -Format s), $json)
$json
