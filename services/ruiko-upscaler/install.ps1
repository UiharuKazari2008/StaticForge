# Ruiko upscaler worker (Windows 11, RTX 2070 Super 8 GB)
# Run from this folder on Ruiko:  powershell -ExecutionPolicy Bypass -File .\install.ps1
# Does not open the firewall. The note at the end is the LAN rule to apply yourself.

$ErrorActionPreference = "Stop"

$Root = "F:\dreamscape-worker"
$Venv = Join-Path $Root "venv"
$ModelDir = Join-Path $Root "models"
$KeyFile = Join-Path $Root "worker.key"
$LogDir = Join-Path $Root "logs"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Venv "Scripts\python.exe"
$Service = "RuikoUpscaler"

New-Item -ItemType Directory -Force -Path $Root, $ModelDir, $LogDir | Out-Null

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python 3.10+ is required on PATH (Windows 11)."
}

if (-not (Test-Path $Python)) {
    python -m venv $Venv
}

& $Python -m pip install --upgrade pip
# Turing (2070 Super, sm_75) needs a CUDA wheel. Do not use the default CPU index.
& $Python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
& $Python -m pip install -r (Join-Path $Here "requirements.txt")

$catalog = Get-Content -Raw -Path (Join-Path $Here "models.json") | ConvertFrom-Json
foreach ($model in $catalog) {
    $dest = Join-Path $ModelDir $model.file
    $expected = $model.sha256.ToLower()
    $have = ""
    if (Test-Path $dest) {
        $have = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
    }
    if ($have -ne $expected) {
        Write-Host "Downloading $($model.file)"
        Invoke-WebRequest -Uri $model.url -OutFile $dest
        $have = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
        if ($have -ne $expected) {
            throw "SHA256 mismatch for $($model.file): $have"
        }
    } else {
        Write-Host "OK $($model.file)"
    }
}

if (-not (Test-Path $KeyFile)) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $key = ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLower()
    Set-Content -Path $KeyFile -Value $key -NoNewline -Encoding ascii
    Write-Host "Wrote a new worker key to $KeyFile"
    Write-Host "Put that key in Dreamscape secure.config.json as localWorker.key (do not commit it)."
} else {
    Write-Host "Worker key already exists at $KeyFile"
}

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
    Write-Host "NSSM is not on PATH. Install NSSM, then re-run this script to register the service."
} else {
    $existing = Get-Service $Service -ErrorAction SilentlyContinue
    if (-not $existing) {
        & nssm install $Service $Python
    }
    & nssm set $Service Application $Python
    & nssm set $Service AppParameters "-m uvicorn ruiko_upscaler.app:app --host 0.0.0.0 --port 8188"
    & nssm set $Service AppDirectory $Here
    & nssm set $Service AppEnvironmentExtra "RUIKO_WORKER_KEY_FILE=$KeyFile" "RUIKO_MODEL_DIR=$ModelDir"
    & nssm set $Service AppStdout (Join-Path $LogDir "upscaler.out.log")
    & nssm set $Service AppStderr (Join-Path $LogDir "upscaler.err.log")
    & nssm set $Service AppRotateFiles 1
    & nssm set $Service AppExit Default Restart
    & nssm set $Service AppRestartDelay 5000
    & nssm set $Service Start SERVICE_AUTO_START
    & nssm restart $Service
    Write-Host "Service $Service installed with auto-restart (5s delay)."
}

Write-Host ""
Write-Host "Firewall note (not applied by this script):"
Write-Host "Allow TCP 8188 from the Dreamscape LAN only. Do not expose 8188 to the internet."
Write-Host "Example (adjust the remote address):"
Write-Host '  New-NetFirewallRule -DisplayName "Ruiko upscaler LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8188 -RemoteAddress 192.168.0.0/16 -Profile Private'
Write-Host ""
Write-Host "Health (no key, minimal):  curl http://127.0.0.1:8188/health"
Write-Host "Health (full):             curl -H `"Authorization: Bearer <key>`" http://127.0.0.1:8188/health"
