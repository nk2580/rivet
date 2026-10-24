# Rivet architecture

The supported application is a local Electron desktop app. There is no Rivet login, hosted application backend, or required cloud database.

| Area | Location | Responsibility |
| --- | --- | --- |
| Desktop | `desktop/main.ts`, `desktop/preload.cjs` | Windows, trusted IPC, workspace, OS integration |
| Interface | `src/app/`, `src/components/` | React/TypeScript, shadcn-based controls, themes |
| Domain | `src/domain/` | Edition-specific records, commands, calculations |
| Storage | `desktop/sqlite.ts`, `src/storage/workspace.ts` | SQLite transactions, revisions, backups, undo |
| Rules | `desktop/rules.ts`, `desktop/mcp.ts`, `public/rules/` | Indexed SRDs and read-only stdio MCP service |
| Oracle | `desktop/assistant.ts`, `desktop/character-actions.ts` | Local tool loop, reviewed changes, receipts |
| Connection | `desktop/auth.ts`, `desktop/credentials.ts`, `desktop/native/RivetAuth.swift` | ChatGPT authorization and protected credentials |
| Capture | `desktop/capture*.ts`, `desktop/native/session-capture.cpp` | Local speech, transcript lifecycle, recap jobs |
| Website | `website/`, `scripts/build-site.mjs` | Static public site, deployed through GitHub Pages |

## Data boundary

The renderer accesses records through the preload bridge. The main process validates IPC callers and owns SQLite, rules lookup, and credentials. Character writes use revisions and transactions; routine actions create undo receipts. Imported records are validated and existing IDs are kept rather than silently overwritten.

Oracle inference is online. The local agent sends bounded character and explicitly shared notebook context to the connected ChatGPT account. MCP rules search is read-only. Character-edit tools have separate validation and review rules. The guide has no general shell or filesystem tool.

Speech recognition uses Vosk and miniaudio locally. Audio is discarded; transcript text can be sent for optional ChatGPT recaps. The speech model is downloaded separately and excluded from workspace backups.

## Historical code

`legacy/` retains the original hand-written browser prototype; `legacy/dist/` is source, not generated output. `server/`, Firebase rules, Compose files, and browser synchronization modules retain the later browser-service experiment and its tests. They are not used by the desktop app. Historical owner-restricted examples use the synthetic identity `owner@example.test` and are not a production multi-user deployment configuration.

The [historical setup notes](historical-saas-README.md) describe the earlier stack. Start with the desktop build guide for current development.
