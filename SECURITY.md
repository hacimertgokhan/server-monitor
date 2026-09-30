# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/hacimertgokhan/server-monitor/security/advisories/new).

If GitHub reporting is not an option, email [hacimertgokhan@gmail.com](mailto:hacimertgokhan@gmail.com) (website: [hacimertgokhan.com](https://hacimertgokhan.com)).

Include what you found, how to reproduce it and the affected version. You can expect an acknowledgement within a few days.

## Scope and design notes

- SSH credentials are encrypted with the operating system (Electron `safeStorage` / Windows DPAPI). The app refuses to store them in plain text.
- Remote hosts are only ever sent fixed, read-only scripts (`src/main/probe.ts`). Host keys are pinned on first use and a changed key blocks the connection.
- The renderer runs with context isolation and sandbox enabled, without Node integration; production builds ship a strict Content-Security-Policy.
- Data stays on your machine. The app makes no network connections other than the SSH connections you configure, the local MCP endpoint (only when you enable it) and, only when you press "Check for updates", one request to the GitHub releases API.

### Agents (MCP)

The MCP server can let an agent run commands on your servers, so it is the most security-sensitive part of the app. Design and known limits:

- **Off by default.** It only listens on `127.0.0.1`, rejects any request with an `Origin` header (browsers) and any `Host` other than the loopback names (DNS rebinding), and requires an `Authorization: Bearer` token.
- **Tokens** are random (256 bit), shown once, and stored only as a SHA-256 hash; comparison is constant-time. Each agent has its own token, permissions (status / logs / commands) and server scope, and can be disabled, rotated or deleted at any time.
- **Command policy** (`src/shared/mcp.ts`): modes _Ask me_, _Allow list only_, _Deny list_ and _No commands_. A built-in set of destructive commands is blocked in every mode. Approvals are shown in a native OS dialog, not in the renderer.
- **A deny list is best-effort.** Shell syntax can hide a command (encoding, scripts, aliases), so use _Ask me_ or _Allow list only_ for real protection. The allow list mode refuses command substitution, redirects, background jobs and path traversal because they cannot be verified from the text.
- **Anything an agent may run runs with the SSH user's rights** on the server. Give agents accounts with the least privilege they need.
- Every call is written to a local audit log (`mcp-audit.jsonl` in the app data folder). It can contain the commands agents ran; treat it as sensitive.
- The MCP endpoint speaks plain HTTP on the loopback interface. Do not forward its port to other machines.
