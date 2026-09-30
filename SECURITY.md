# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/hacimertgokhan/server-monitor/security/advisories/new).

Include what you found, how to reproduce it and the affected version. You can expect an acknowledgement within a few days.

## Scope and design notes

- SSH credentials are encrypted with the operating system (Electron `safeStorage` / Windows DPAPI). The app refuses to store them in plain text.
- Remote hosts are only ever sent fixed, read-only scripts (`src/main/probe.ts`). Host keys are pinned on first use and a changed key blocks the connection.
- The renderer runs with context isolation and sandbox enabled, without Node integration; production builds ship a strict Content-Security-Policy.
- Data stays on your machine. The app makes no network connections other than the SSH connections you configure.
