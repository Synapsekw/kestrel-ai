<#
.SYNOPSIS
  Gate, merge and clean up a task worktree. Run from inside the worktree.
.DESCRIPTION
  Rebases onto the latest main so the gate runs against the merged state, runs the full gate,
  merges to main, then removes the worktree. Removal follows the junction rule: only directory
  reparse points are hazardous; hardlinks share inodes and are safe. Never rm -rf.
#>
param(
  [switch] $SkipGate
)

$ErrorActionPreference = 'Stop'
$wt = (& git rev-parse --show-toplevel)
if (-not $wt) { throw "not inside a git worktree" }
$wt = $wt -replace '/', '\'
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -notlike 'task/*') { throw "not on a task/* branch (on '$branch')" }

$repo = (& git rev-parse --git-common-dir) -replace '/', '\'
$repo = Split-Path -Parent $repo

if ((& git status --porcelain)) { throw "working tree is dirty - commit or discard first" }

Write-Host "rebasing $branch onto main so the gate runs against the merged state..."
$rebaseBase = 'main'
if ((& git branch -r) -match 'origin/main') {
  & git fetch origin main | Out-Null
  $rebaseBase = 'origin/main'
}
& git rebase $rebaseBase
if ($LASTEXITCODE -ne 0) {
  throw "rebase conflict - resolve it, then re-run this script"
}

if (-not $SkipGate) {
  $py = Join-Path $repo 'backend\.venv\Scripts\python.exe'
  $cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
  $gate = @(
    @{ n = 'contract';       c = { & pnpm -C (Join-Path $wt 'contract') check } },
    @{ n = 'ruff';           c = { Push-Location (Join-Path $wt 'backend'); try { & $py -m ruff check . } finally { Pop-Location } } },
    @{ n = 'pytest';         c = { Push-Location (Join-Path $wt 'backend'); try { & $py -m pytest -q } finally { Pop-Location } } },
    @{ n = 'frontend lint';  c = { & pnpm -C (Join-Path $wt 'frontend') lint } },
    @{ n = 'frontend test';  c = { & pnpm -C (Join-Path $wt 'frontend') test } },
    @{ n = 'frontend build'; c = { & pnpm -C (Join-Path $wt 'frontend') build } },
    @{ n = 'cargo test';     c = { & $cargo test --manifest-path (Join-Path $wt 'frontend\src-tauri\Cargo.toml') } }
  )
  foreach ($g in $gate) {
    Write-Host "--- $($g.n) ---"
    & $g.c | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "gate failed at: $($g.n)" }
  }
}

Write-Host "merging $branch into main..."
& git -C $repo checkout main
if ($LASTEXITCODE -ne 0) { throw "checkout of main failed" }
if ((& git -C $repo status --porcelain)) { throw "main checkout is dirty - commit or discard first, then re-run this script" }
if ((& git -C $repo rev-parse --abbrev-ref HEAD).Trim() -ne 'main') { throw "main checkout is not on main" }
& git -C $repo merge --ff-only $branch
if ($LASTEXITCODE -ne 0) { throw "merge failed" }
if ((& git -C $repo branch -r) -match 'origin/main') {
  & git -C $repo push origin main
  if ($LASTEXITCODE -ne 0) { throw "push rejected - main advanced on the remote; pull and re-run" }
}

Write-Host "removing the worktree..."
Set-Location $repo
& git worktree remove $wt | Out-Host

if (Test-Path $wt) {
  # Expected: git refuses while node_modules is present. Remove junctions AS LINKS first.
  $escaping = Get-ChildItem -Force -Recurse $wt -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LinkType } |
    Where-Object { @($_.Target) | Where-Object { $_ -notlike "$wt*" } }
  if (@($escaping).Count -gt 0) {
    $escaping | Select-Object FullName, Target | Format-List | Out-Host
    throw "ABORTING: a junction points outside the worktree. Delete nothing; inspect by hand."
  }
  $j = Get-ChildItem -Force -Recurse $wt -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LinkType } | Sort-Object { $_.FullName.Length } -Descending
  foreach ($d in $j) { try { [System.IO.Directory]::Delete($d.FullName, $false) } catch {} }
  Remove-Item -Recurse -Force $wt -ErrorAction SilentlyContinue
}
& git worktree prune
& git -C $repo branch -d $branch

Write-Host ""
Write-Host "done: $branch merged into main, worktree removed, branch deleted."
Write-Host "Now write the operator a numbered 'how to test this' walkthrough, and run /wrapup."
