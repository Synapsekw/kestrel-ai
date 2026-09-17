# Start the UI in development. -Mode mock: Prism mock server + Vite. -Mode backend: real backend + Vite.
param([ValidateSet("mock", "backend")] [string] $Mode = "mock")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if ($Mode -eq "mock") {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\contract'; pnpm mock"
  Set-Location "$root\frontend"
  pnpm dev
} else {
  $token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  # Children inherit the environment, so the token never appears on a command line.
  $env:APP_TOKEN = $token
  $env:APP_PORT = "8765"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; .\.venv\Scripts\python -m app"
  $env:APP_BACKEND_URL = "http://127.0.0.1:8765"
  $env:APP_BACKEND_TOKEN = $token
  Set-Location "$root\frontend"
  pnpm dev
}
