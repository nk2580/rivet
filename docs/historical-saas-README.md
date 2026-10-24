> Historical architecture notes. The current app is Electron/SQLite; use [the macOS build guide](building-macos.md). Any internal planning or evidence paths below refer to the original development workspace and are not shipped.

# Rivet · Adventure companion

Private character and campaign companion for `owner@example.test`, built with React, TypeScript, Vite, shadcn-based components, Go, and Firebase Spark.

**Implementation is in progress.** The durable character workspace, owner authentication boundary, notebook, drafts, offline PWA, revision synchronization, recovery/backup flows and equipment controls are implemented. Spell cards expand to full edition-matched text from 319 SRD 5.1 and 339 SRD 5.2.1 entries. The remaining catalogues, complete creation/advancement and rules automation, subscription assistant, and full connected-stack acceptance are not yet complete. See `projects/rivet/goal.md` for the complete agreed scope and `projects/rivet/state.json` for task status.

There is no dice system. Record resolved damage and healing; keep dice and adjudication at your table.

## Local connected stack

1. Copy `.env.example` to `.env` and enter your Firebase **public web configuration**. Keep the project on Spark and do not link billing.
2. Enable Google Authentication, create the default Firestore database, authorize the application hostname, and deploy `firestore.rules`.
3. Run `docker compose up --build -d`.
4. Open `http://localhost:8088`. Only the verified Google owner can open the workspace.

The Go backend exposes only public configuration without authentication. Protected API endpoints verify Firebase ID tokens using the official Admin SDK, then enforce the fixed email, verified status, and Google provider. Server credentials never enter the frontend build.

The final delivery may be this fully functional Compose stack; a free hosted deployment is optional. Until the acceptance checks are complete, successful container startup alone is not proof of real Google login, durable cloud synchronization, or live subscription inference.

## Explicit development emulator

Run `docker compose -f compose.yaml -f compose.emulator.yaml up --build -d`.

Open `http://localhost:8088`. The UI labels emulator identity and storage explicitly. Emulator data uses a named volume, exported on graceful shutdown. Emulator login is not real Google authentication. Connected mode rejects emulator environment variables.

The emulator runs the Firebase CLI directly and receives SIGINT for a clean export. Data is retained under `/data/state` inside its volume; emulator binaries use a separate cache volume. Do not change the export target to the mount root: Firebase replaces the target directory during export. A checksum/revision restart check covers the corrected lifecycle.

Use `docker compose -f compose.yaml -f compose.emulator.yaml down` to stop only this stack. Do not delete the volume if you want to retain local test data.

If the desktop Docker credential helper stalls while reading public-image credentials, use the task-local wrapper. It keeps the selected local Docker socket and supplies an isolated anonymous registry configuration to Compose and Buildx:

```sh
RIVET_PUBLIC_IMAGE_AUTH=anonymous sh scripts/compose.sh -f compose.yaml -f compose.emulator.yaml up --build -d
```

All base images in this stack are public. The wrapper does not modify the saved desktop login or Docker daemon configuration.

## Development and checks

Node 22.17+ and Go 1.25 are used. pnpm is pinned in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm test:legacy
```

Run the Go API from `server/` with `go run ./cmd/rivet-server`; run backend tests with `go test ./...`. Vite proxies `/api` to port 8080 by default. The API reads the documented environment variables; `.env` is loaded by Compose, not automatically by `go run`.

The prototype is preserved unchanged in `legacy/` with its source license and original tests. Import its exported JSON through the workspace settings. Legacy imports retain the source backup locally, use deterministic record IDs, preserve note-sharing flags, and require character review. Workspace imports skip existing records instead of silently replacing them.

## Data and recovery

Changes are written to owner-scoped IndexedDB before cloud synchronization. Each cloud record has a revision and operation ID. Conflicting edits retain both versions and allow an explicit choice with a local recovery copy. Export backups before clearing browser storage or changing hosting origins.

Private notes are identified independently of their campaign links. Subscription credentials will be encrypted in backend-only storage during the assistant phase. Never place a service account, encryption key, or OAuth credential in a `VITE_` variable or commit it.

## Design and licensing

`PRODUCT.md`, `DESIGN.md`, and `docs/design-brief.md` capture the approved Field companion direction. The approved concept is in `docs/design/`. Component and font attribution is in `THIRD_PARTY_NOTICES.md` and `public/fonts/`. Complete source-backed rules-pack attribution is part of the rules phase.
