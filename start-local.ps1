param([switch]$NoBrowser, [switch]$Setup)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$stateDir = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
$nodePath = (Get-Command node -ErrorAction Stop).Source
if ([int]((& $nodePath -p 'process.versions.node.split(String.fromCharCode(46))[0]')) -lt 22) { throw 'Node.js 22 or newer is required.' }
if (!(Test-Path -LiteralPath $pythonPath)) {
    & py -3.13 -m venv (Join-Path $projectRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.13, then run this script again.' }
    $Setup = $true
}
if ($Setup) {
    & $pythonPath -m pip install -r (Join-Path $projectRoot 'backend/requirements-lock.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
}
if ($Setup -or !(Test-Path -LiteralPath (Join-Path $projectRoot 'frontend/node_modules/.bin/vite.cmd'))) {
    Push-Location (Join-Path $projectRoot 'frontend')
    try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' } }
    finally { Pop-Location }
}
function Test-Endpoint([string]$Url) {
    try { return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
    catch { return $false }
}
function Start-ServiceProcess([string]$Name, [string]$Executable, [string[]]$ServiceArgs, [int]$Port, [string]$Url, [string]$WorkingDirectory = $projectRoot) {
    $pidFile = Join-Path $stateDir "$Name.json"
    if (Test-Path -LiteralPath $pidFile) {
        $savedState = Get-Content -Raw -LiteralPath $pidFile | ConvertFrom-Json
        $running = Get-CimInstance Win32_Process -Filter "ProcessId = $($savedState.pid)" -ErrorAction SilentlyContinue
        if ($running -and $running.CommandLine -and $running.CommandLine.Contains($projectRoot) -and (Test-Endpoint $Url)) {
            Write-Host "$Name already running at $Url"
            return
        }
    }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listener) { throw "Port $Port is already occupied. Stop the existing service or run stop-local.ps1 for this project." }
    $quotedArgs = ($ServiceArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $process = Start-Process -FilePath $Executable -ArgumentList $quotedArgs -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir "$Name.out.log") -RedirectStandardError (Join-Path $stateDir "$Name.err.log")
    @{pid=$process.Id; executable=$Executable; project=$projectRoot} | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        if (Test-Endpoint $Url) { Write-Host "$Name ready at $Url"; return }
        if ($process.HasExited) { throw "$Name stopped. Read .local/$Name.err.log." }
        Start-Sleep -Milliseconds 250
    }
    throw "$Name did not become ready. Read .local/$Name.err.log."
}
Start-ServiceProcess -Name 'backend' -Executable $pythonPath -ServiceArgs @('-m','uvicorn','app.main:app','--app-dir',(Join-Path $projectRoot 'backend'),'--host','127.0.0.1','--port','8000') -Port 8000 -Url 'http://127.0.0.1:8000/health'
Start-ServiceProcess -Name 'frontend' -Executable $nodePath -ServiceArgs @((Join-Path $projectRoot 'frontend/node_modules/vite/bin/vite.js'),(Join-Path $projectRoot 'frontend'),'--host','127.0.0.1','--strictPort') -Port 5173 -Url 'http://127.0.0.1:5173/' -WorkingDirectory (Join-Path $projectRoot 'frontend')
$cesiumAsset = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/cesium/Assets/Images/ion-credit.png' -UseBasicParsing -TimeoutSec 20
if ($cesiumAsset.Headers['Content-Type'] -notlike 'image/png*') { throw 'Cesium assets are unavailable. Reinstall frontend dependencies with -Setup.' }
Write-Host 'GUGIS3D: http://127.0.0.1:5173/'
Write-Host 'API docs: http://127.0.0.1:8000/docs'
if (!$NoBrowser) { Start-Process 'http://127.0.0.1:5173/' }
