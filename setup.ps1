# Windows PowerShell setup for cursor-realtime-voice
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

function Log($msg) { Write-Host "[cursor-realtime-voice] $msg" }

Log "Platform: Windows (PowerShell)"

Log "Installing npm dependencies…"
npm install

Log "Building extension…"
npm run compile --prefix extension

$Vsix = Join-Path $env:TEMP "cursor-voice-bridge.vsix"
Log "Packaging extension…"
Push-Location extension
npx --yes @vscode/vsce package --allow-missing-repository -o $Vsix
Pop-Location

$CursorCmd = $null
if (Get-Command cursor -ErrorAction SilentlyContinue) {
  $CursorCmd = "cursor"
} else {
  $Candidates = @(
    "$env:LOCALAPPDATA\Programs\cursor\resources\app\bin\cursor.cmd",
    "$env:LOCALAPPDATA\Programs\Cursor\resources\app\bin\cursor.cmd",
    "${env:ProgramFiles}\Cursor\resources\app\bin\cursor.cmd"
  )
  foreach ($c in $Candidates) {
    if (Test-Path $c) { $CursorCmd = $c; break }
  }
}

if ($CursorCmd) {
  Log "Installing extension via: $CursorCmd"
  & $CursorCmd --install-extension $Vsix
} else {
  Log "Cursor CLI not found. Install VSIX manually: $Vsix"
}

Log "Installing hooks…"
& bash "$Root\scripts\install-hooks.sh"
if ($LASTEXITCODE -ne 0) {
  Log "Hooks install failed. Install Git Bash or run install-hooks from WSL/macOS/Linux."
}

if (-not (Test-Path "$Root\.env")) {
  Copy-Item "$Root\.env.example" "$Root\.env"
  Log "Created .env from .env.example"
}

$Port = if ($env:CURSOR_VOICE_TOKEN_PORT) { $env:CURSOR_VOICE_TOKEN_PORT } else { 8787 }
$Url = "http://127.0.0.1:$Port"

Log "Stopping any process on port $Port…"
Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Log "Starting voice server…"
Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory $Root -WindowStyle Hidden
Start-Sleep -Seconds 3

try {
  Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
  Log "Server health check failed. See $Root\.cursor-voice-server.log"
  exit 1
}

Log "Opening $Url"
Start-Process $Url

Log "Done."
Log "  1. In Cursor: Ctrl+Shift+P → Cursor Voice: Restart Bridge"
Log "  2. Keep an Agent chat open."
Log "  3. In the browser: save OpenAI key → tap the voice button."
