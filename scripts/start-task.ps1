<#
.SYNOPSIS
  Start a building session in its own git worktree.
.DESCRIPTION
  Cuts task/<name> from the latest main into .claude/worktrees/<name>, pins the commit identity
  and installs the pnpm workspaces. It deliberately does NOT create a Python venv: the worktree
  uses the main checkout's interpreter (see the -Venv note in README and the shared-venv incident
  ADR in vault/decisions/).
#>
param(
  [Parameter(Mandatory = $true)][string] $Name
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$wt = Join-Path $repo ".claude\worktrees\$Name"

if (Test-Path $wt) { throw "worktree already exists: $wt" }

Write-Host "fetching origin/main..."
& git -C $repo fetch origin main 2>&1 | Out-Host

# origin may not exist yet (the repo is published in a later task); fall back to local main.
$base = 'main'
if ((& git -C $repo branch -r) -match 'origin/main') { $base = 'origin/main' }

& git -C $repo worktree add $wt -b "task/$Name" $base
if ($LASTEXITCODE -ne 0) { throw "git worktree add failed" }

# Commit identity is pinned per worktree: the email is what GitHub attributes commits to.
& git -C $wt config user.name  'Danijel Jovanovic'
& git -C $wt config user.email 'info@synapse-solutions.ai'

Write-Host "installing pnpm workspaces (hardlinked from the store, a few seconds)..."
& pnpm -C (Join-Path $wt 'frontend') install | Out-Host
& pnpm -C (Join-Path $wt 'contract') install | Out-Host

Write-Host ""
Write-Host "worktree ready on task/$Name"
Write-Host "  cd $wt"
Write-Host "backend commands use the main checkout's interpreter:"
Write-Host "  $repo\backend\.venv\Scripts\python.exe -m pytest"
