# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

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

[0.2.0]: https://github.com/hacimertgokhan/server-monitor/releases/tag/v0.2.0
[0.1.0]: https://github.com/hacimertgokhan/server-monitor/commits/main
