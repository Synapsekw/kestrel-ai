<#
.SYNOPSIS
  One-shot rename of the project folder E:\Dev\Yolo\app -> E:\Dev\Yolo\kestrel-ai, plus every
  absolute-path dependency that breaks when the folder moves.
.DESCRIPTION
  Run this from OUTSIDE the project folder (e.g. a PowerShell console sitting in E:\Dev\Yolo),
  never from a console whose current directory is inside $OldPath. The script itself lives inside
  the project, so the safest invocation is to copy it out first:

    Copy-Item E:\Dev\Yolo\app\scripts\rename-project.ps1 E:\Dev\Yolo\rename-project.ps1
    cd E:\Dev\Yolo
    .\rename-project.ps1              # dry run - review the output
    .\rename-project.ps1 -Execute     # the real thing, once the dry run is clean

  RUN THE DRY RUN FIRST. Omitting -Execute (the default) performs every precondition check and
  prints every action it WOULD take, without changing anything on disk. Nothing is renamed,
  deleted, installed or rewritten until you pass -Execute, and even then only after every
  precondition has passed. Passing -DryRun forces a dry run even alongside -Execute, so -DryRun
  always wins.

  Background: read docs/superpowers/plans/2026-09-21-rename-project-folder.md for the why and the
  recovery path before running this for real.
#>
param(
  [string] $OldPath = 'E:\Dev\Yolo\app',
  [string] $NewPath = 'E:\Dev\Yolo\kestrel-ai',
  [switch] $DryRun,
  [switch] $Execute
)

$ErrorActionPreference = 'Stop'

$isDryRun = $DryRun -or (-not $Execute)

function Write-Section {
  param([string] $Title)
  Write-Host ''
  Write-Host "=== $Title ==="
}

function Write-Check {
  param([bool] $Passed, [string] $Message)
  if ($Passed) {
    Write-Host "  [PASS] $Message"
  } else {
    Write-Host "  [FAIL] $Message"
  }
}

function Get-DirectorySizeBytes {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  $items = Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue
  if (-not $items) { return 0 }
  $sum = ($items | Measure-Object -Property Length -Sum).Sum
  if (-not $sum) { return 0 }
  return $sum
}

function Format-Bytes {
  param([double] $Bytes)
  if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
  if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
  if ($Bytes -ge 1KB) { return ('{0:N2} KB' -f ($Bytes / 1KB)) }
  return "$Bytes B"
}

function Get-EscapingLinks {
  # Mirrors scripts/finish-task.ps1's junction-safety check: any reparse point (LinkType is
  # truthy) whose Target does not stay under $Root is a hazard, never delete blind.
  param([string] $Root)
  $normRoot = $Root.TrimEnd('\')
  Get-ChildItem -LiteralPath $Root -Force -Recurse -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LinkType } |
    Where-Object { @($_.Target) | Where-Object { $_ -notlike "$normRoot*" } }
}

function Remove-TreeSafely {
  # Never rm -rf. Delete reparse-point directories as links (not their targets) deepest-first,
  # then remove what's left. Aborts rather than guessing if a link escapes the tree.
  # (vault/decisions/2026-09-18-gotcha-shared-venv-deleted-with-a-worktree.md)
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host "  (not present, nothing to delete: $Path)"
    return
  }
  $escaping = Get-EscapingLinks -Root $Path
  if (@($escaping).Count -gt 0) {
    $escaping | Select-Object FullName, Target | Format-List | Out-Host
    throw "ABORTING: a link inside $Path points outside it. Deleted nothing; inspect by hand."
  }
  $links = Get-ChildItem -LiteralPath $Path -Force -Recurse -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LinkType } |
    Sort-Object { $_.FullName.Length } -Descending
  foreach ($link in $links) {
    [System.IO.Directory]::Delete($link.FullName, $false)
  }
  Remove-Item -LiteralPath $Path -Recurse -Force
}

function Get-ClaudeProjectSlug {
  # Claude Code derives its per-project directory name from the path: ':' and '\' both become
  # '-'. E:\Dev\Yolo\app -> E--Dev-Yolo-app. Verified against the operator's actual directory.
  param([string] $Path)
  return (($Path -replace ':', '-') -replace '\\', '-')
}

Write-Host ''
Write-Host 'rename-project.ps1'
Write-Host "  OldPath : $OldPath"
Write-Host "  NewPath : $NewPath"
if ($isDryRun) {
  Write-Host '  Mode    : DRY RUN (default) -- checks only, nothing will change. Pass -Execute to perform the rename.'
} else {
  Write-Host '  Mode    : EXECUTE -- this will rename the folder and rebuild the toolchain.'
}

# ---------------------------------------------------------------------------------------------
# Preconditions. Every one of these is checked and printed before anything mutates. In EXECUTE
# mode, a single failure refuses the whole run before any action runs.
# ---------------------------------------------------------------------------------------------
Write-Section 'Preconditions'
$failures = @()

# 1. OldPath exists, NewPath does not.
$oldExists = Test-Path -LiteralPath $OldPath
$newExists = Test-Path -LiteralPath $NewPath
Write-Check $oldExists "OldPath exists: $OldPath"
if (-not $oldExists) { $failures += "OldPath does not exist. Check the -OldPath value: $OldPath" }
Write-Check (-not $newExists) "NewPath does not already exist: $NewPath"
if ($newExists) { $failures += "NewPath already exists: $NewPath. Remove or rename it out of the way first, or this run would either merge into it or refuse outright." }

# 2. Not running from inside OldPath.
$cwd = (Get-Location).Path.TrimEnd('\')
$oldNorm = $OldPath.TrimEnd('\')
$cwdInsideOld = ($cwd -ieq $oldNorm) -or ($cwd -ilike "$oldNorm\*")
Write-Check (-not $cwdInsideOld) "current directory is not inside OldPath (cwd: $cwd)"
if ($cwdInsideOld) { $failures += "This console's current directory is inside $OldPath. cd out of it first (e.g. cd E:\Dev\Yolo) -- a directory can't be renamed while a process's working directory is inside it." }

# 2b. The script's own file should not be inside OldPath when actually executing -- a directory
# rename mid-execution of a script that lives inside that directory is a needless self-inflicted
# lock hazard. Dry runs are allowed to read-only report this; EXECUTE requires the script to have
# been copied out first (see the .DESCRIPTION block above).
$scriptInsideOld = $false
if ($PSCommandPath) {
  $scriptDir = (Split-Path -Parent $PSCommandPath).TrimEnd('\')
  $scriptInsideOld = ($scriptDir -ieq $oldNorm) -or ($scriptDir -ilike "$oldNorm\*")
}
if ($scriptInsideOld) {
  Write-Check $false "script file is outside OldPath (it is currently inside: $PSCommandPath)"
  if (-not $isDryRun) {
    $failures += "This script is running from inside $OldPath ($PSCommandPath). Copy it outside first: Copy-Item '$PSCommandPath' 'E:\Dev\Yolo\rename-project.ps1', then run the copy."
  } else {
    Write-Host '         (informational in dry-run mode; EXECUTE will refuse until the script is copied outside OldPath)'
  }
} else {
  Write-Check $true 'script file is outside OldPath'
}

# 3. No uncommitted work in the main checkout.
$gitStatus = $null
if ($oldExists) {
  $gitStatus = & git -C $OldPath status --porcelain
}
$statusClean = -not $gitStatus
Write-Check $statusClean 'git status --porcelain is empty (no uncommitted work)'
if (-not $statusClean) {
  $failures += "Uncommitted changes in $OldPath. Commit or stash them first. First few lines:`n$(($gitStatus | Select-Object -First 5) -join "`n")"
}

# 4. Only the main worktree is registered.
$extraWorktrees = @()
if ($oldExists) {
  $wtOut = & git -C $OldPath worktree list --porcelain
  $entries = @()
  $current = $null
  foreach ($line in $wtOut) {
    if ($line -like 'worktree *') {
      if ($current) { $entries += [pscustomobject]$current }
      $current = @{ Path = $line.Substring(9) }
    } elseif ($current -and $line -like 'branch *') {
      $current.Branch = $line.Substring(7)
    }
  }
  if ($current) { $entries += [pscustomobject]$current }
  $mainNorm = ((Resolve-Path -LiteralPath $OldPath).Path.TrimEnd('\'))
  $extraWorktrees = $entries | Where-Object {
    (($_.Path -replace '/', '\').TrimEnd('\')) -ine $mainNorm
  }
}
Write-Check (@($extraWorktrees).Count -eq 0) 'no worktree other than the main checkout is registered'
if (@($extraWorktrees).Count -gt 0) {
  $names = ($extraWorktrees | ForEach-Object { "$($_.Path) [$($_.Branch)]" }) -join ', '
  $failures += "Additional git worktree(s) registered: $names. A session is mid-task there. Finish or remove it (scripts\finish-task.ps1, or a junction-safe manual removal per vault/decisions/2026-09-18-gotcha-shared-venv-deleted-with-a-worktree.md) before renaming -- worktrees store absolute paths to the main checkout and would break silently."
}

# 5. Nothing unpushed -- this is the real safety net (everything recoverable from GitHub).
$unpushedOk = $false
$unpushedDetail = ''
if ($oldExists) {
  $remoteUrl = & git -C $OldPath remote get-url origin
  if ($LASTEXITCODE -ne 0 -or -not $remoteUrl) {
    $unpushedDetail = "No 'origin' remote is configured in $OldPath. This is the recovery safety net for this whole operation -- add origin and push main before renaming."
  } else {
    & git -C $OldPath fetch origin main
    if ($LASTEXITCODE -ne 0) {
      $unpushedDetail = 'git fetch origin main failed. Check network/auth before renaming -- the unpushed-commits check below is only trustworthy against a fresh fetch.'
    } else {
      $unpushed = & git -C $OldPath log --oneline 'origin/main..main'
      if ($unpushed) {
        $unpushedDetail = "Unpushed commits on main:`n$(($unpushed | Select-Object -First 10) -join "`n")`nPush them (git push origin main) before renaming -- if the rename goes wrong, GitHub is the recovery path, and it can't recover what was never pushed."
      } else {
        $unpushedOk = $true
      }
    }
  }
}
Write-Check $unpushedOk 'nothing unpushed (origin/main..main is empty)'
if (-not $unpushedOk) { $failures += $unpushedDetail }

# 6. Nothing holds the folder: process scan, then (only if the scan is clean) a non-destructive
# lock test that actually round-trips the rename.
$watchNames = @('Obsidian', 'Code', 'claude', 'node', 'python', 'cargo')
$processHits = @()
if ($oldExists) {
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($p.Name)
    if ($watchNames -icontains $base) {
      $haystack = "$($p.ExecutablePath) $($p.CommandLine)"
      if ($haystack -and $haystack.ToLower().Contains($oldNorm.ToLower())) {
        $processHits += [pscustomobject]@{ Name = $p.Name; ProcessId = $p.ProcessId; ExecutablePath = $p.ExecutablePath; CommandLine = $p.CommandLine }
      }
    }
  }
}
Write-Check (@($processHits).Count -eq 0) "no Obsidian/Code/claude/node/python/cargo process is rooted under $OldPath"
if (@($processHits).Count -gt 0) {
  $processHits | Format-Table -AutoSize Name, ProcessId, ExecutablePath | Out-Host
  $failures += "Process(es) above are running under $OldPath. Close them (this includes: Obsidian, any VS Code window, any Claude Code session -- including the one running this script if it's a Claude session, and any node/python/cargo process such as a dev server or build)."
}

$lockTestOk = $false
$lockTestDetail = ''
if ($oldExists -and @($processHits).Count -eq 0 -and -not $scriptInsideOld) {
  $lockTestPath = "$oldNorm.locktest"
  if (Test-Path -LiteralPath $lockTestPath) {
    $lockTestDetail = "Stale artifact from a previous failed run: $lockTestPath. Verify by hand whether it should be renamed back to $OldPath, then remove this file/folder and re-run."
  } else {
    try {
      [System.IO.Directory]::Move($oldNorm, $lockTestPath)
      try {
        [System.IO.Directory]::Move($lockTestPath, $oldNorm)
        $lockTestOk = $true
      } catch {
        Write-Host ''
        Write-Host '=================================================================='
        Write-Host 'CRITICAL: the lock test renamed the folder away and could NOT rename it back.'
        Write-Host "The project folder is currently at: $lockTestPath"
        Write-Host "It needs to be at:                  $OldPath"
        Write-Host 'Close whatever now holds it and rename it back by hand:'
        Write-Host "  Rename-Item -LiteralPath '$lockTestPath' -NewName '$(Split-Path -Leaf $OldPath)'"
        Write-Host '=================================================================='
        throw "lock-test restore failed: $($_.Exception.Message)"
      }
    } catch {
      $lockTestDetail = "Could not rename $OldPath even to itself: $($_.Exception.Message). Something still has a handle open inside it."
    }
  }
} elseif ($scriptInsideOld) {
  $lockTestDetail = 'skipped -- the script itself is inside OldPath (see check 2b above); copy it outside and re-run to get a real lock test.'
} elseif (@($processHits).Count -gt 0) {
  $lockTestDetail = 'skipped -- the process scan above found hits; fix those first.'
}
Write-Check $lockTestOk 'non-destructive lock test (rename OldPath to itself and back) succeeded'
if (-not $lockTestOk) { $failures += "Lock test did not pass: $lockTestDetail" }

# ---------------------------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------------------------
Write-Section 'Verdict'
if (@($failures).Count -gt 0) {
  Write-Host "$(@($failures).Count) precondition(s) failed. Refusing to proceed." -ForegroundColor Red
  $i = 1
  foreach ($f in $failures) {
    Write-Host ''
    Write-Host "$i. $f"
    $i++
  }
  Write-Host ''
  Write-Host 'Nothing was changed. Fix the item(s) above and re-run (dry run first).'
  exit 1
}
Write-Host 'All preconditions passed.'
if ($isDryRun) {
  Write-Host ''
  Write-Host 'This was a DRY RUN. No files were renamed, deleted, installed or rewritten (the lock test'
  Write-Host 'above is the one exception, and it always restores itself before this script continues).'
  Write-Host 'Re-run with -Execute once you are ready to actually rename the folder:'
  Write-Host "  .\rename-project.ps1 -OldPath '$OldPath' -NewPath '$NewPath' -Execute"
  exit 0
}

# ---------------------------------------------------------------------------------------------
# From here on: EXECUTE mode only, and every precondition passed.
# ---------------------------------------------------------------------------------------------
$stepFailures = @()
$preRenameHead = (& git -C $OldPath rev-parse HEAD).Trim()

# Step: back up the Obsidian vault registry.
Write-Section 'Step: back up %APPDATA%\obsidian\obsidian.json'
$obsidianPath = Join-Path $env:APPDATA 'obsidian\obsidian.json'
$obsidianBak = $null
if (Test-Path -LiteralPath $obsidianPath) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $obsidianBak = "$obsidianPath.$stamp.bak"
  Copy-Item -LiteralPath $obsidianPath -Destination $obsidianBak
  Write-Host "backed up to $obsidianBak"
} else {
  Write-Host "WARNING: $obsidianPath not found -- nothing to back up, and the repoint step later will be skipped."
}

# Step: delete git-ignored build trees with baked-in absolute paths.
Write-Section 'Step: delete build trees with baked-in paths'
$treesToDelete = @(
  (Join-Path $OldPath 'frontend\src-tauri\target'),
  (Join-Path $OldPath 'backend\build'),
  (Join-Path $OldPath 'backend\dist')
)
$reclaimed = 0
foreach ($tree in $treesToDelete) {
  $size = Get-DirectorySizeBytes -Path $tree
  Write-Host "$tree ($(Format-Bytes $size))"
  try {
    Remove-TreeSafely -Path $tree
    $reclaimed += $size
  } catch {
    $stepFailures += "delete of $tree failed: $($_.Exception.Message)"
    Write-Host "  FAILED: $($_.Exception.Message)"
  }
}
Write-Host "reclaimed approximately $(Format-Bytes $reclaimed)"

# Step: rename the directory. Hard stop on failure -- nothing after this runs.
Write-Section 'Step: rename the directory'
Write-Host "$OldPath -> $NewPath"
try {
  [System.IO.Directory]::Move($OldPath, $NewPath)
} catch {
  Write-Host ''
  Write-Host '=================================================================='
  Write-Host 'RENAME FAILED. STOPPING NOW. Nothing after this point has run:'
  Write-Host '  - the venv has NOT been recreated'
  Write-Host '  - pnpm install has NOT been run'
  Write-Host '  - the Obsidian registry has NOT been repointed'
  Write-Host '  - the Claude memory folder has NOT been moved'
  Write-Host '=================================================================='
  Write-Host "Error: $($_.Exception.Message)"
  Write-Host ''
  Write-Host 'Close whatever is holding a handle inside $OldPath, then re-run the dry run to'
  Write-Host 'confirm the lock test passes before trying -Execute again. Likely culprits: an'
  Write-Host 'Explorer window browsing the folder, a terminal whose cwd is inside it, an open'
  Write-Host 'VS Code / Obsidian window, a Claude Code session rooted there (including this'
  Write-Host 'one, if it somehow still held a handle), or an antivirus scan in progress.'
  exit 1
}
Write-Host 'renamed successfully.'

# Step: recreate the backend venv at the new path (ADR recipe).
Write-Section 'Step: recreate backend/.venv'
$backendDir = Join-Path $NewPath 'backend'
$oldVenv = Join-Path $backendDir '.venv'
try {
  if (Test-Path -LiteralPath $oldVenv) {
    Write-Host 'removing the stale (moved-but-broken) venv...'
    Remove-TreeSafely -Path $oldVenv
  }
  Push-Location $backendDir
  try {
    Write-Host 'uv venv .venv --python 3.11.15'
    & uv venv .venv --python 3.11.15
    if ($LASTEXITCODE -ne 0) { throw "uv venv exited $LASTEXITCODE" }
    Write-Host 'uv pip install -r requirements-lock.txt -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cu130'
    & uv pip install -r requirements-lock.txt -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cu130
    if ($LASTEXITCODE -ne 0) { throw "uv pip install exited $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
  Write-Host 'venv recreated.'
} catch {
  $stepFailures += "venv recreation failed: $($_.Exception.Message)"
  Write-Host "FAILED: $($_.Exception.Message)"
  Write-Host 'Retry by hand from the ADR: vault/decisions/2026-09-18-gotcha-shared-venv-deleted-with-a-worktree.md'
}

# Step: reinstall pnpm workspaces.
Write-Section 'Step: pnpm install (frontend, contract)'
foreach ($dir in @('frontend', 'contract')) {
  $full = Join-Path $NewPath $dir
  try {
    Write-Host "pnpm -C $full install"
    & pnpm -C $full install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install exited $LASTEXITCODE" }
  } catch {
    $stepFailures += "pnpm install in $dir failed: $($_.Exception.Message)"
    Write-Host "FAILED: $($_.Exception.Message)"
  }
}

# Step: repoint the Obsidian vault registry, BOM-less, preserving every other vault and key.
Write-Section 'Step: repoint the Obsidian vault registry'
if (-not $obsidianBak) {
  Write-Host 'skipped -- no obsidian.json was found to back up earlier.'
} else {
  try {
    $raw = Get-Content -LiteralPath $obsidianPath -Raw
    $registry = $raw | ConvertFrom-Json
    $matched = $false
    foreach ($prop in $registry.vaults.PSObject.Properties) {
      if ($prop.Value.path -ieq $OldPath) {
        $prop.Value.path = $NewPath
        $matched = $true
      }
    }
    if (-not $matched) {
      Write-Host "WARNING: no vault entry with path '$OldPath' was found in $obsidianPath -- nothing changed there. Registered paths were:"
      foreach ($prop in $registry.vaults.PSObject.Properties) { Write-Host "  $($prop.Value.path)" }
    } else {
      $json = $registry | ConvertTo-Json -Depth 10 -Compress
      $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
      [System.IO.File]::WriteAllText($obsidianPath, $json, $utf8NoBom)

      # Re-parse to prove it's valid before trusting it.
      $reread = (Get-Content -LiteralPath $obsidianPath -Raw) | ConvertFrom-Json
      Write-Host 'registry rewritten and re-parsed successfully. Registered vaults:'
      foreach ($prop in $reread.vaults.PSObject.Properties) { Write-Host "  $($prop.Value.path)" }
    }
  } catch {
    $stepFailures += "Obsidian registry repoint failed: $($_.Exception.Message). Original is backed up at $obsidianBak -- restore it by copying that file back over $obsidianPath if the current file looks wrong."
    Write-Host "FAILED: $($_.Exception.Message)"
  }
}

# Step: move the Claude Code memory folder across, never overwriting an existing one.
Write-Section 'Step: move the Claude Code memory folder'
try {
  $claudeProjectsRoot = Join-Path $env:USERPROFILE '.claude\projects'
  $oldSlug = Get-ClaudeProjectSlug -Path $OldPath
  $newSlug = Get-ClaudeProjectSlug -Path $NewPath
  $oldMemory = Join-Path $claudeProjectsRoot "$oldSlug\memory"
  $newProjectDir = Join-Path $claudeProjectsRoot $newSlug
  $newMemory = Join-Path $newProjectDir 'memory'
  if (-not (Test-Path -LiteralPath $oldMemory)) {
    Write-Host "no memory folder found at $oldMemory -- nothing to move."
  } elseif (Test-Path -LiteralPath $newMemory) {
    Write-Host "WARNING: not moving memory -- $newMemory already exists. Left $oldMemory in place; merge by hand."
  } else {
    if (-not (Test-Path -LiteralPath $newProjectDir)) {
      New-Item -ItemType Directory -Path $newProjectDir | Out-Null
    }
    Move-Item -LiteralPath $oldMemory -Destination $newMemory
    Write-Host "moved $oldMemory -> $newMemory"
  }
} catch {
  $stepFailures += "memory folder move failed: $($_.Exception.Message)"
  Write-Host "FAILED: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------------------------
Write-Section 'Verification'

$newGitStatus = & git -C $NewPath status --porcelain
if ($newGitStatus) {
  Write-Check $false "git status at new path is clean (found changes)"
  $stepFailures += 'git status at the new path is not clean -- unexpected, investigate before trusting the rename.'
} else {
  Write-Check $true 'git status at new path is clean'
}
$newHead = (& git -C $NewPath rev-parse HEAD).Trim()
$headMatches = ($newHead -eq $preRenameHead)
Write-Check $headMatches "HEAD unchanged (before: $preRenameHead, after: $newHead)"
if (-not $headMatches) { $stepFailures += "HEAD changed across the rename: before=$preRenameHead after=$newHead. Investigate before trusting anything else." }

$venvPy = Join-Path $NewPath 'backend\.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $venvPy) {
  $torchOut = & $venvPy -c "import torch; print('torch', torch.__version__); print('cuda', torch.cuda.is_available())"
  if ($LASTEXITCODE -eq 0) {
    Write-Check $true "venv python imports torch and reports CUDA:`n           $($torchOut -join "`n           ")"
  } else {
    Write-Check $false 'venv python imports torch and reports CUDA'
    $stepFailures += 'torch import / CUDA check failed in the recreated venv.'
  }
} else {
  Write-Check $false "venv python exists at $venvPy"
  $stepFailures += 'no venv python found -- venv recreation did not complete.'
}

foreach ($dir in @('frontend', 'contract')) {
  $nm = Join-Path $NewPath "$dir\node_modules"
  $exists = Test-Path -LiteralPath $nm
  Write-Check $exists "$dir\node_modules exists"
  if (-not $exists) { $stepFailures += "$nm is missing -- pnpm install did not complete for $dir." }
}

if ($obsidianBak) {
  try {
    $finalRegistry = (Get-Content -LiteralPath $obsidianPath -Raw) | ConvertFrom-Json
    $paths = @($finalRegistry.vaults.PSObject.Properties | ForEach-Object { $_.Value.path })
    $hasNew = $paths -icontains $NewPath
    Write-Check $hasNew "Obsidian registry parses and lists the new path ($($paths.Count) vault(s) total)"
    foreach ($p in $paths) { Write-Host "           $p" }
    if (-not $hasNew) { $stepFailures += 'Obsidian registry does not list the new path -- check the repoint step above.' }
  } catch {
    Write-Check $false 'Obsidian registry parses'
    $stepFailures += "Obsidian registry failed to re-parse: $($_.Exception.Message)"
  }
}

# ---------------------------------------------------------------------------------------------
# Next steps
# ---------------------------------------------------------------------------------------------
Write-Section 'What to do next'
if (@($stepFailures).Count -gt 0) {
  Write-Host "$(@($stepFailures).Count) step(s) need attention before you trust this rename:" -ForegroundColor Yellow
  foreach ($f in $stepFailures) { Write-Host "  - $f" }
  Write-Host ''
}
Write-Host '1. Reopen the vault in Obsidian. It will now be named "kestrel-ai".'
Write-Host "2. Start a new Claude Code session rooted at $NewPath (the old one, and any other"
Write-Host '   process from before the rename, is now pointed at a folder that no longer exists).'
Write-Host '3. Run the full gate from the new path to confirm the toolchain works:'
Write-Host "     cd $NewPath\backend; uv run ruff check .; uv run pytest"
Write-Host "     pnpm -C $NewPath\contract check"
Write-Host "     pnpm -C $NewPath\frontend lint; pnpm -C $NewPath\frontend test"
Write-Host '4. If anything above is still broken, the runbook has a recovery path:'
Write-Host '   docs/superpowers/plans/2026-09-21-rename-project-folder.md'
