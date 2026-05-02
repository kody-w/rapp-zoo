# start.ps1 — launch rapp-zoo on http://127.0.0.1:7070
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$env:PYTHONUTF8 = "1"

# Prefer a brainstem venv if present
$brainstemPy = Join-Path $env:USERPROFILE ".brainstem\venv\Scripts\python.exe"
$localPy     = Join-Path (Get-Location) "venv\Scripts\python.exe"
$python = $null

if (Test-Path $brainstemPy)  { $python = $brainstemPy }
elseif (Test-Path $localPy)  { $python = $localPy }
else {
    Write-Host "[zoo] creating local venv…" -ForegroundColor Yellow
    python -m venv .\venv
    $python = $localPy
}

# Ensure flask
& $python -c "import flask" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[zoo] installing dependencies…" -ForegroundColor Yellow
    & "$($python -replace 'python.exe$', 'pip.exe')" install -r installer\requirements.txt -q
}

& $python zoo.py
