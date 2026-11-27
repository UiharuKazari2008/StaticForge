# StaticForge #1392: READ-ONLY sampler of the lane emulator's qemu process on its Windows host. Prints one line per sample.
$ErrorActionPreference = 'SilentlyContinue'
$q = Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'qemu-system*' -and $_.CommandLine -match ('-avd ' + $(if ($AVD) { $AVD } else { 'aemu-fold-1' }) + ' ') }
$id = $q.ProcessId
"qemu pid=$id"
$prevT = @{}; $pc = $null; $pm = $null
$end = (Get-Date).AddSeconds($DURATION)
while ((Get-Date) -lt $end) {
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $w = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  $cpuMs = [int64](($w.KernelModeTime + $w.UserModeTime) / 10000)
  $tot = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
  $dsk = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
  $gp = Get-Process -Id $id
  $cur = @{}; foreach ($th in $gp.Threads) { $cur[$th.Id] = $th.TotalProcessorTime.TotalMilliseconds }
  $top = @()
  if ($pm -ne $null) { $top = $cur.Keys | ForEach-Object { [pscustomobject]@{ k = $_; d = $cur[$_] - $prevT[$_] } } | Sort-Object d -Descending | Select-Object -First 6 }
  $dt = if ($pm -ne $null) { $t - $pm } else { 0 }
  $cores = if ($dt -gt 0) { [math]::Round(($cpuMs - $pc) / $dt, 2) } else { 0 }
  "ms=$t dt=$dt qemuCores=$cores hostCpuPct=$tot wsMB=$([int]($w.WorkingSetSize/1MB)) readB=$($w.ReadTransferCount) writeB=$($w.WriteTransferCount) otherB=$($w.OtherTransferCount) pageFaults=$($w.PageFaults) diskQ=$($dsk.CurrentDiskQueueLength) diskBps=$($dsk.DiskBytesPersec) threads=$($gp.Threads.Count) top=" + (($top | ForEach-Object { "$($_.k):$([int]$_.d)" }) -join ',')
  $prevT = $cur; $pc = $cpuMs; $pm = $t
  Start-Sleep -Milliseconds 400
}
