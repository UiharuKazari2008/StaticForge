# Ruiko worker (Windows 11, RTX 2070 Super 8 GB): upscale + animate job types.
# Run from this folder on Ruiko:  powershell -ExecutionPolicy Bypass -File .\install.ps1
# Pass -PrefetchWan / -PrefetchLtx to also download those backends up front
# (both are large; they otherwise download lazily on the first wan/ltx job).
# Does not open the firewall. The note at the end is the LAN rule to apply yourself.

param(
    [switch]$PrefetchWan,
    [switch]$PrefetchLtx
)

$ErrorActionPreference = "Stop"

$Root = "F:\dreamscape-worker"
$Venv = Join-Path $Root "venv"
$ModelDir = Join-Path $Root "models"
$HfCacheDir = Join-Path $ModelDir "hf-cache"
$KeyFile = Join-Path $Root "worker.key"
$LogDir = Join-Path $Root "logs"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Venv "Scripts\python.exe"
$Service = "RuikoUpscaler"

New-Item -ItemType Directory -Force -Path $Root, $ModelDir, $HfCacheDir, $LogDir | Out-Null

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

$env:HF_HOME = $HfCacheDir
Write-Host "Prefetching AnimateDiff (anime SD1.5 base + motion adapter) into $HfCacheDir"
& $Python -c "from diffusers import MotionAdapter; from diffusers import AnimateDiffVideoToVideoPipeline; MotionAdapter.from_pretrained('guoyww/animatediff-motion-adapter-v1-5-2', cache_dir=r'$HfCacheDir'); AnimateDiffVideoToVideoPipeline.from_pretrained('stablediffusionapi/anything-v5', cache_dir=r'$HfCacheDir')"

if ($PrefetchWan) {
    Write-Host "Prefetching Wan 2.1 I2V 14B (GGUF transformer + rest of the pipeline) into $HfCacheDir (large download)"
    & $Python -c "import torch; from diffusers import GGUFQuantizationConfig, WanImageToVideoPipeline, WanTransformer3DModel; from huggingface_hub import hf_hub_download; gguf_path = hf_hub_download('city96/Wan2.1-I2V-14B-480P-gguf', 'wan2.1-i2v-14b-480p-Q4_K_M.gguf', cache_dir=r'$HfCacheDir'); transformer = WanTransformer3DModel.from_single_file(gguf_path, quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16), torch_dtype=torch.bfloat16, config='Wan-AI/Wan2.1-I2V-14B-480P-Diffusers', subfolder='transformer'); WanImageToVideoPipeline.from_pretrained('Wan-AI/Wan2.1-I2V-14B-480P-Diffusers', transformer=transformer, cache_dir=r'$HfCacheDir', torch_dtype=torch.bfloat16)"
} else {
    Write-Host "Skipping Wan prefetch (lazy-loads on first backend=wan job). Re-run with -PrefetchWan to cache it now."
}

if ($PrefetchLtx) {
    Write-Host "Prefetching LTX-Video into $HfCacheDir (large download)"
    & $Python -c "import torch; from diffusers import LTXImageToVideoPipeline; LTXImageToVideoPipeline.from_pretrained('Lightricks/LTX-Video', cache_dir=r'$HfCacheDir', torch_dtype=torch.bfloat16)"
} else {
    Write-Host "Skipping LTX prefetch (lazy-loads on first backend=ltx job). Re-run with -PrefetchLtx to cache it now."
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
    & nssm set $Service AppEnvironmentExtra "RUIKO_WORKER_KEY_FILE=$KeyFile" "RUIKO_MODEL_DIR=$ModelDir" "HF_HOME=$HfCacheDir"
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
