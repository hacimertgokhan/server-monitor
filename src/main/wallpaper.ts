import { app, screen } from 'electron'
import type { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'

/**
 * Attaches an Electron window to the Windows desktop, *behind* the desktop icons (live wallpaper).
 *
 * Windows 10 / early 11: send 0x052C to Progman so it spawns a WorkerW behind the icons, re-parent into it.
 * Windows 11 24H2+ (build 26100+): SHELLDLL_DefView is a child of Progman; re-parent into Progman and slot
 * the window directly below DefView (above the wallpaper WorkerW).
 */
const PS = String.raw`
param([Int64]$Hwnd, [int]$X, [int]$Y, [int]$W, [int]$H)
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class WP {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, IntPtr t);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, IntPtr t);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr c, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  public struct POINT { public int X, Y; }
}
"@
[void][WP]::SetProcessDPIAware()
$hwnd = [IntPtr]$Hwnd
$progman = [WP]::FindWindow("Progman", [IntPtr]::Zero)
if ($progman -eq [IntPtr]::Zero) { Write-Output "ERR no Progman"; exit 2 }
$res = [IntPtr]::Zero
[void][WP]::SendMessageTimeout($progman, 0x052C, [IntPtr]0xD, [IntPtr]1, 0, 1000, [ref]$res)
Start-Sleep -Milliseconds 300

$parent = [IntPtr]::Zero; $defView = [IntPtr]::Zero; $layout = "unknown"
# Layout A: top-level WorkerW that owns SHELLDLL_DefView; wallpaper WorkerW is its next sibling.
$cb = [WP+EnumProc]{ param($h, $l)
  $dv = [WP]::FindWindowEx($h, [IntPtr]::Zero, "SHELLDLL_DefView", [IntPtr]::Zero)
  if ($dv -ne [IntPtr]::Zero) { $script:parent = [WP]::FindWindowEx([IntPtr]::Zero, $h, "WorkerW", [IntPtr]::Zero); return $false }
  return $true }
[void][WP]::EnumWindows($cb, [IntPtr]::Zero)
if ($parent -ne [IntPtr]::Zero) { $layout = "legacy-workerw" }
else {
  # Layout B (24H2+): DefView lives directly under Progman.
  $defView = [WP]::FindWindowEx($progman, [IntPtr]::Zero, "SHELLDLL_DefView", [IntPtr]::Zero)
  if ($defView -ne [IntPtr]::Zero) { $parent = $progman; $layout = "progman-24h2" }
}
if ($parent -eq [IntPtr]::Zero) { Write-Output "ERR no desktop parent (layout unknown)"; exit 3 }

$style = [WP]::GetWindowLong($hwnd, -16)
# WS_POPUP + caption/sysmenu/thickframe/min/max off (removes the invisible ~8px frame), WS_CHILD on
$style = ($style -band (-bnot (0x80000000 -bor 0x00CF0000))) -bor 0x40000000
[void][WP]::SetWindowLong($hwnd, -16, $style)
$ex = [WP]::GetWindowLong($hwnd, -20)
$ex = $ex -band (-bnot 0x00000300)                          # WS_EX_WINDOWEDGE / CLIENTEDGE off
[void][WP]::SetWindowLong($hwnd, -20, $ex)
[void][WP]::SetParent($hwnd, $parent)

$pt = New-Object WP+POINT; $pt.X = $X; $pt.Y = $Y
[void][WP]::ScreenToClient($parent, [ref]$pt)
$after = [IntPtr]::Zero            # HWND_TOP
if ($layout -eq "progman-24h2") { $after = $defView }   # directly below the icons layer
# SWP_NOACTIVATE 0x10 | SWP_FRAMECHANGED 0x20 | SWP_SHOWWINDOW 0x40
[void][WP]::SetWindowPos($hwnd, $after, $pt.X, $pt.Y, $W, $H, 0x70)
Write-Output "OK layout=$layout parent=$parent defView=$defView pos=$($pt.X),$($pt.Y) size=$W x $H"
`

const log = (msg: string): void => {
  try {
    appendFileSync(join(app.getPath('userData'), 'wallpaper.log'), `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* ignore */
  }
}

export const wallpaperBounds = (): Electron.Rectangle => screen.getPrimaryDisplay().bounds

export async function attachToDesktop(win: BrowserWindow): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const b = screen.dipToScreenRect(null, wallpaperBounds()) // physical pixels
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0)
  const script = join(app.getPath('temp'), 'server-monitor-wallpaper.ps1')
  writeFileSync(script, PS, 'utf8')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Hwnd',
        String(hwnd),
        '-X',
        String(b.x),
        '-Y',
        String(b.y),
        '-W',
        String(b.width),
        '-H',
        String(b.height)
      ],
      { windowsHide: true, timeout: 15_000 },
      (err, stdout, stderr) => {
        const out = `${stdout}${stderr}`.trim()
        log(err ? `attach failed: ${err.message} ${out}` : `attach: ${out}`)
        resolve(!err && out.startsWith('OK'))
      }
    )
  })
}
