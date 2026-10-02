# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.5.1] - 2026-10-02

### Fixed

- **Servers and settings could appear empty after starting the app.** A data file that was briefly unreadable at startup (for example locked by an antivirus or sync tool) was treated as "no data", and the next save could overwrite the real file. Reads are now retried and restored from a `.bak` copy; a file that still cannot be read is never overwritten. The window shows a warning with a **Retry** button, retries on its own every few seconds, and blocks adding or removing servers until the data is readable. Every save keeps the previous good version as `<file>.bak`, and problems are logged to `data-load.log` in the app data folder.

## [0.5.0] - 2026-10-01

### Added

- **Root mode**: a Termius-style workspace (switch with *Flowchart / Root* in the top bar). Servers are listed on the left; click one to open a real SSH terminal in front of you. Sessions stay alive while you look at the flowchart. The server detail dialog has *Terminal* and *Files* buttons.
- **SSH terminal** (xterm.js, real `xterm-256color` PTY): `nano`, `vim`, `htop`, `tmux`, colours and `cat` work like in any SSH client. Tabs, several sessions per server, copy / paste (Ctrl+Shift+C/V, Ctrl+C with a selection, right click), copy on select, search, clickable links (Ctrl+click), font zoom (Ctrl+scroll), reconnect, flow control for huge outputs.
- **Terminal themes and settings**: 12 colour themes (Monochrome Ash, Dracula, Nord, Tokyo Night, One Dark, Catppuccin, Gruvbox, Monokai, Solarized, Matrix, GitHub Light ...), bundled JetBrains Mono, font size, cursor style and blinking, scrollback; changes apply live.
- **Integrated file manager (SFTP)**: browse, sort, filter, create, rename, delete, change permissions, edit text files, upload files and folders (also by drag and drop), download files and folders with progress and cancel, *Open terminal here*. Downloads never overwrite local files.

### Security

- Terminals and the file manager open their own SSH connections and use the same pinned host keys as monitoring. Agents (MCP) have no access to them.

## [0.4.0] - 2026-09-30

### Added

- **macOS and Linux support**: native window chrome, menu-bar/tray icon, `⌘⌥M` shortcut, live wallpaper via the desktop window level (macOS) or the desktop window type (Linux/X11), XDG autostart, dock reactivation, keyring check for stored passwords, and installers (macOS dmg/zip for Intel and Apple Silicon, Linux AppImage/deb) built in CI alongside Windows.
- **Agents (MCP)**: a built-in MCP server (Streamable HTTP on loopback) with per-agent tokens, permissions and server scope; tools `list_servers`, `get_server_status`, `list_issues`, `get_policy`, `get_logs` and `run_command`; command modes _Ask me_, _Allow list only_, _Deny list_ and _No commands_ with editable rules and a test box; built-in blocks for destructive commands; native approval dialog; connected-agents view and audit log.
- **Log viewer** for Docker containers, PM2 processes and systemd services: search with highlighting, level filters, live refresh, copy and save. Opens from the flowchart, the detail tables and the problems panel.
- **Problems panel**, desktop notifications for new problems with configurable CPU/RAM/disk thresholds, server search (`/`) and a "problems only" filter.
- **About** section with author links (hacimertgokhan.com) and a manual "Check for updates".
- Card and text sizes were increased and low-contrast text was brightened for readability; fonts now include macOS and Linux system fonts.

### Changed

- Manual launches always open the window (a remembered wallpaper mode is restored only at login).

### Security

- Log names are validated against a strict pattern and against the server's own listing before they reach a shell.

## [0.3.0] - 2026-09-30

### Added

- Expandable sub-trees in the flowchart: Docker containers, PM2 processes, systemd services and listening ports can be opened under each server (chips on the card, or "Expand all" / "Collapse all" in the top bar). Items are colour-coded by health, problems and key daemons come first, long lists collapse into a "+N more" node, and open trees are remembered and shown in wallpaper mode.
- Layouts now place a server together with its open tree, so radial, grid and free layouts never overlap; trees follow their server while it is dragged.

### Fixed

- Hidden connection handles could swallow clicks that landed exactly on a node's centre.

## [0.2.1] - 2026-09-30

### Fixed

- Launching the app manually while wallpaper mode was remembered left it invisible behind other windows (no taskbar entry). A manual launch now always opens the window; wallpaper mode is restored only when Windows starts the app at login.

## [0.2.0] - 2026-09-30

### Added

- Layout modes: automatic radial, grid and free placement; dragging a card switches to free placement.
- Card size: global size slider, per-card resize handle, "fit to screen" button, reset layout. Layouts and sizes are remembered and used in wallpaper mode too.
- English and Turkish UI (automatic by system language, switchable in Settings).
- Unit tests (Vitest) for probe parsers, layouts and translations; ESLint and Prettier; CI and release workflows.
- Reproducible promo video and screenshots (`npm run promo`).

### Fixed

- Detail dialog overflowed horizontally on some tabs and in narrow windows.
- Radial layout overlapped cards with 12 or more servers.
- Wallpaper window had an invisible ~7 px inset on Windows.

## [0.1.0] - 2026-09-30

### Added

- Initial version: live SSH monitoring (CPU, RAM, disk, network, uptime, Docker, PM2, systemd services, open ports), flowchart UI with the user at the centre, window / mini / wallpaper modes, tray, credential encryption, SSH host-key pinning.

[0.3.0]: https://github.com/hacimertgokhan/server-monitor/releases/tag/v0.3.0
[0.2.1]: https://github.com/hacimertgokhan/server-monitor/releases/tag/v0.2.1
[0.2.0]: https://github.com/hacimertgokhan/server-monitor/releases/tag/v0.2.0
[0.1.0]: https://github.com/hacimertgokhan/server-monitor/commits/main
