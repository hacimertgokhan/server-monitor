# Contributing

Thanks for helping! Questions? Open a discussion/issue or write to [hacimertgokhan@gmail.com](mailto:hacimertgokhan@gmail.com). This is a small project; the workflow is deliberately light.

## Setup

```bash
npm install
npm run dev:web    # fastest loop for UI work: browser, demo data, no SSH
npm run dev        # full Electron app
```

Node.js ≥ 22. The packaged app and wallpaper mode are Windows-only; most UI work can be done in the browser preview.

## Before you open a pull request

```bash
npm run check      # eslint + prettier --check + tsc (main and renderer) + vitest
```

CI runs the same checks plus a production build and a Windows installer build.

- **Formatting** is Prettier (`npm run format`); **linting** is ESLint (`npm run lint:fix`).
- **Tests** live next to the code (`*.test.ts`). Parser changes in `src/main/probe.ts` need a test with real-looking command output. Layout changes need to keep `layout.test.ts` (no overlapping cards) green.
- **Strings**: write UI text in English through `t('…')` and add the Turkish translation in `src/renderer/src/lib/i18n.tsx`. A test fails if a key is missing or stale.
- **Remote commands** must stay read-only and must not interpolate user input into shell code. Never log or persist secrets (passwords, key passphrases, PM2 environments).
- **UI**: keep to the Monochrome Ash palette and the soft status accents defined in `src/renderer/src/styles.css`. Attach a screenshot or GIF to UI pull requests. `npm run promo` regenerates the media in `docs/media`.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`. Keep pull requests focused, and describe how you tested them.

## Releasing (maintainers)

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. `git tag vX.Y.Z && git push --tags`. The **Release** workflow builds the installer and publishes the GitHub release.
