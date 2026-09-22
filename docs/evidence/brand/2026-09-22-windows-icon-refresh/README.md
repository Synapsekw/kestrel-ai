# Windows icon reference refresh — 2026-09-22

The operator reported an old Windows icon. Inspected the installed app before changing anything:

- Source icon integrity check passed for all 17 generated assets.
- Direct PE extraction from the installed app and retained setup executable showed the approved bird.
- The running window's `WM_GETICON` SMALL and SMALL2 handles also rendered the bird.
- Windows shell extraction for the executable and Start shortcut already returned the bird.
- The only matching shortcut targeted the current installed Kestrel executable. No matching stale
  taskbar or implicit-app shortcut was found. The reported old bitmap was not reproduced by these reads.

Applied a targeted reference refresh: copied the verified ICO into the installed app directory as
`kestrel-bird-61b90923c2e6.ico` and set the existing Start shortcut's IconLocation explicitly to it.
The shortcut target and arguments were preserved; a backup is retained under the ignored
`dist/windows-icon-2026-09-22/` folder. Sent synchronous Windows UPDATEITEM notifications for both
paths and an ASSOCCHANGED notification. No Explorer restart, global cache deletion or rebuild.

Afterward, the shortcut retained the explicit path and Windows resolved it to the bird shown in
`shortcut-after.png`. `repair.json` records the exact path and source hash. The running app remains
open at PID 14528. Its executable hash still matches the verified setup-agent desktop build.

`installed-app-large.png` is the executable resource, `window-0.png` is the actual running window
icon, and `shortcut-after.png` is Windows shell output (including its normal shortcut arrow).
These are direct extractions, not edited images or screenshots of the entire Windows desktop.

The unchanged installed app remains the setup-agent build from `75aa11b`; the later editor/train
CI fixes on main were not installed by this icon-only operation. A later installer can recreate the
shortcut, so this records a local shell-reference repair, not a change to installer behavior.

## How to test

1. Find **Kestrel AI** in Start and check for the amber bird.
2. Open it; the app's Windows icon and the bird in the sidebar should match.

The running Tauri window returned no BIG icon but did provide SMALL/SMALL2. A null BIG response
alone therefore does not establish a missing or wrong icon. The Microsoft
[WM_GETICON documentation](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-geticon)
describes the message variants and fallback inspection.
