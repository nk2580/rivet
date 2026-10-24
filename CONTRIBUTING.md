# Contributing to Rivet

Bug reports, documentation improvements, accessibility fixes, and code contributions are welcome. Open an issue before a large change so we can agree on scope.

## Development

Follow the [macOS build guide](docs/building-macos.md), then work in a fork and a focused branch. Use the pinned pnpm version and keep the lockfile in sync with dependency changes. Use an isolated workspace:

```sh
pnpm install --frozen-lockfile
RIVET_DATA_DIR="$PWD/.local/dev-workspace" pnpm dev
```

Explain the concrete problem, resulting behavior, and validation in pull requests. Include before/after screenshots for UI changes; check light/dark themes, narrow windows, keyboard access, and reduced motion where relevant.

```sh
pnpm typecheck
pnpm test
pnpm test:legacy
pnpm build:desktop
```

For website-only changes, `pnpm build:site` and a browser check at desktop and phone widths are sufficient. Website source lives in `website/`; desktop UI lives in `src/`.

Add regression coverage for behavior changes. Use synthetic characters and temporary SQLite stores. Never sign into a live account or use a real microphone from an automated test. Do not commit databases, exports, credentials, or screenshots of personal campaigns.

## Rules and data

Preserve edition boundaries and source citations. Explain which SRD passage supports a rules change and keep its license and attribution. Reference coverage does not imply complete mechanics automation. Keep table-adjudicated outcomes explicit.

Save character changes through the revision-checked workspace command path. Preserve transactions, undo receipts, private-note boundaries, and backup compatibility. The guide has bounded local tools; do not add arbitrary shell or filesystem access.

## Reporting issues

Include reproduction steps, expected and actual behavior, macOS version, architecture, and Rivet version. Use a fresh sample character when possible. Redact personal paths, account details, transcripts, and campaign information from logs. Sensitive reports belong in [private security reports](SECURITY.md).

## License and conduct

Application-code contributions are under the project's MIT license. Assets, rules material, and dependencies must include applicable licenses and attribution. Be kind, assume good intent, and keep discussion focused on the work.
