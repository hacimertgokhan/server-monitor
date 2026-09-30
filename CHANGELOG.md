# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

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
