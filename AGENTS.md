# Working on Rivet

Rivet is a free, open-source D&D desktop companion. The current app uses Electron, React, TypeScript, and local SQLite. Its marketing website is a separate static GitHub Pages site. Sheets, notes, and rules search work offline; Oracle and generated session recaps use an optional online ChatGPT connection.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/architecture.md), and [rules coverage](docs/rules-coverage.md) before changing behavior. Use the [macOS build guide](docs/building-macos.md) for native setup and packaging.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app/`, `src/components/` | Desktop React interface and shadcn-based controls |
| `src/domain/` | Edition-specific records, commands, and calculations |
| `src/storage/`, `desktop/sqlite.ts` | Workspace operations, SQLite, revisions, backup, and undo |
| `desktop/` | Electron main process, IPC, Oracle, local MCP, and session capture |
| `desktop/native/` | macOS authentication and native speech helpers |
| `public/rules/` | Licensed, source-attributed SRD content |
| `desktop/assets/`, `public/app-icons/` | Generated app icons and theme variants |
| `website/` | Public marketing site, independent of the desktop renderer |
| `tests/` | Synthetic domain, storage, desktop, and integration fixtures |
| `legacy/`, `server/`, Firebase and Compose files | Historical browser implementations and their tests |

`legacy/dist/` contains hand-written prototype source. It is an exception to the usual rule that `dist/` is generated output. The historical Go/Firebase stack is not needed to build or run the current desktop app.

## Working agreements

- Check `git status` and the relevant diff before editing. Preserve unrelated changes and other tasks' work. Coordinate overlapping edits and honor requests to wait before publication.
- Keep changes focused on the requested behavior. Follow nearby code conventions and reuse existing domain operations and UI components.
- Use `pnpm` and the version pinned in `package.json`; keep `pnpm-lock.yaml` consistent with dependency changes. Node.js 22.17+ and Xcode Command Line Tools are required for macOS development.
- Do not commit personal workspaces, credentials, transcripts, exported backups, internal QA captures, or build output. Keep temporary work under ignored `.local/` or a directory you own.
- Complete work within the user's authorized scope. Report actual validation and outstanding limits without claiming that a local build proves deployment or platform support.

## Local development

Use an isolated workspace rather than the user's everyday database:

```sh
pnpm install --frozen-lockfile
RIVET_DATA_DIR="$PWD/.local/dev-workspace" pnpm dev
```

`pnpm dev` builds and launches Electron. Rebuild and relaunch after renderer or desktop changes. `pnpm dev:ui` alone does not provide the Electron preload bridge or a usable desktop workspace.

Useful commands:

```sh
pnpm typecheck
pnpm build:desktop
pnpm test
pnpm test:legacy
pnpm package:desktop
pnpm dev:site
pnpm build:site
```

Build the desktop app before running tests that depend on `dist-electron/` helpers or `rules.sqlite`. Packaging generates and verifies a local ad-hoc signature. `pnpm install:desktop` also replaces the installed application; use it only when installation is part of the task.

## Data, rules, and trust boundaries

- Keep durable writes in the main process and revision-checked workspace operations. Preserve SQLite transactions, stale-write detection, activity receipts, undo, and backup compatibility.
- Oracle chat deletion is permanent: stop and drain an active response, then remove the conversation's messages, model history, and proposals transactionally. Preserve saved character changes and their independent action history. Existing exported backups remain separate copies.
- Keep 5e 2014, 5e 2024, and 3.5e rules distinct. Rules changes need edition-specific source references and appropriate regression coverage. Searchable SRD coverage does not imply complete mechanics automation or legal character progression.
- Preserve SRD source IDs, hashes, attribution, and licenses. Application code is MIT licensed; bundled content retains its own licenses. Update `THIRD_PARTY_NOTICES.md` when needed.
- Keep credentials out of the renderer, logs, screenshots, and exports. Preserve the preload API boundary, IPC caller validation, context isolation, renderer sandbox, and disabled Node integration.
- The guide's tools are bounded. Rules MCP access is read-only; character changes use the validated action path. Do not introduce general shell or filesystem access for Oracle.
- Keep private notes and portraits outside automatic guide context. Preserve explicit note-sharing choices and review requirements for non-routine edits.
- Speech recognition runs locally and discards audio. Only the text needed for optional recaps goes online. Do not save or upload audio as an incidental implementation change.

## UI and assets

- Preserve the existing compass identity, warm neutral surfaces, crimson default, six appearance colours, and light/dark modes. Reuse existing theme tokens and shadcn-based controls.
- Keep character information readable and the next useful action clear. Support keyboard access, visible focus, accessible names, narrow windows, and reduced motion.
- Treat `website/` and `src/` as separate surfaces. Website copy must describe implemented behavior, show real or clearly identified sample workspaces, and state current build and platform limits.
- Generate icon assets with `pnpm build:app-icon`; edit the generator rather than individual generated PNGs or ICNS files. Preserve all twelve colour/theme variants and sync the website favicon when the app icon changes. See [icon guidance](desktop/assets/README.md).

## Validation and delivery

- Run checks appropriate to the change. Add meaningful regression tests for behavior changes, using synthetic data and temporary SQLite stores.
- Automated tests must not sign into live accounts, open a real microphone, or use the normal workspace. Inspect fixtures and storage paths before running manual scripts.
- For desktop UI changes, inspect the app in light/dark themes and at wide/narrow sizes; exercise keyboard operation and affected interactions. A browser-only preview is not native Electron verification.
- For website changes, run `pnpm build:site` and check desktop/mobile layouts, assets, links, and changed interactions. For documentation-only changes, verify commands and links and run `git diff --check`; an application rebuild is unnecessary.
- Follow the task's authorized commit, push, and release scope. Stage only intended files, use focused conventional commits, and verify the remote revision after pushing. Preserve published release tags; use a new version for a new release.
- Verify relevant GitHub Actions results before calling CI or deployment successful. A successful local package is not proof of a hosted build or a live Pages update.
- macOS releases are currently source-only, with local ad-hoc signing and no Apple Developer ID signature or notarization. Do not advertise a signed installer or verified Windows, Linux, or Intel macOS support without corresponding evidence.

## Preferences for new subsystems

Prefer React, TypeScript, Vite, and shadcn/ui for new application interfaces; Go when a backend is needed; Docker Compose for local service development; and Kubernetes for service deployments. These preferences do not require adding services to the existing local desktop app or replacing its GitHub Pages website.
