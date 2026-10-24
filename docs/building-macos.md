# Build Rivet on macOS

Rivet is currently distributed as source code. There is no prebuilt installer, Apple Developer ID signature, or Apple notarization. The packaging script applies a local **ad-hoc signature** and verifies it. This is the self-signing step; it does not establish a verified developer identity or replace notarization.

## Prerequisites

- macOS on Apple Silicon (locally verified). The scripts also target Intel Macs using native x64 Node.js, but that build needs testing.
- Node.js **22.17 or newer**. Install the native architecture build from [nodejs.org](https://nodejs.org/en/download).
- pnpm **10.34.7**, pinned in `package.json`.
- Xcode Command Line Tools, including Swift, a C++17 compiler, `codesign`, and `iconutil`.
- Internet for package installation and the first checksum-pinned Vosk/miniaudio build download.

Install the command-line tools and finish the macOS installer:

```sh
xcode-select --install
```

If the tools are already installed, macOS will say so. After installing Node.js, install the pinned pnpm version:

```sh
npm install --global pnpm@10.34.7
node --version
pnpm --version
xcrun --find swiftc
```

No Firebase project, Go toolchain, Docker, API key, or Apple Developer membership is needed for the desktop build. Oracle uses the Mac's Secure Enclave; older Intel hardware without it may be unable to use the optional ChatGPT connection. The rest of the app does not require that connection. The oldest supported macOS version has not yet been established by testing.

## Download and build

```sh
git clone https://github.com/nk2580/rivet.git
cd rivet
pnpm install --frozen-lockfile
pnpm package:desktop
```

Alternatively [download the source ZIP](https://github.com/nk2580/rivet/archive/refs/heads/main.zip), extract it, and run the last two commands in the extracted folder.

`package:desktop` type-checks and builds the React interface, builds the Electron processes, compiles the native authentication and speech helpers, builds the SQLite rules database, and packages the app for the architecture of the Node.js process. The first build can take several minutes.

The output is:

- Apple Silicon: `release/Rivet-darwin-arm64/Rivet.app`
- Intel: `release/Rivet-darwin-x64/Rivet.app` (not locally verified)

Build on the architecture you intend to run. An Apple Silicon Mac running x64 Node.js under Rosetta will produce an x64 app.

## Local signing and launch

The packaging script signs the native helpers, the Vosk library, and the full app bundle with the ad-hoc identity `-`, then runs `codesign --verify --deep --strict`. If signing or verification fails, packaging stops.

Verify the generated app and open it:

```sh
codesign --verify --deep --strict \
  "release/Rivet-darwin-$(node -p process.arch)/Rivet.app"
open "release/Rivet-darwin-$(node -p process.arch)/Rivet.app"
```

If you intentionally modify an existing built bundle, regenerate all local signatures by repackaging from your reviewed source:

```sh
node scripts/package-desktop.mjs
```

This uses the existing `dist/` and `dist-electron/` build outputs. Use `pnpm package:desktop` to rebuild those outputs too.

If macOS blocks a launch because the developer cannot be verified, follow [Apple's instructions for opening an app from an unidentified developer](https://support.apple.com/en-au/102445). Local signing is not Apple approval. Do not disable Gatekeeper system-wide.

## Install or update

You can copy the generated Rivet.app into Applications manually. For an installation that verifies the bundle and retains a backup of the previous app, quit Rivet and run:

```sh
node scripts/install-macos.mjs
```

The installer only replaces an app with bundle ID `com.rivet.desktop`. It installs `/Applications/Rivet.app`, keeps the previous app in `.local/installed-app-backups/`, registers the app with Launch Services, and requests Spotlight indexing. It does not replace your workspace database. Writing to Applications requires appropriate permissions on your Mac.

`pnpm install:desktop` rebuilds, packages, and installs in one command.

## Workspace and backups

The normal macOS database is `~/Library/Application Support/Rivet/workspace.sqlite`. Use workspace settings to export a JSON backup before upgrades. Exports include saved chats and capture text but exclude ChatGPT credentials, speech models, and audio. Backups are separate copies; deleting a chat does not remove old exported backups.

For development, use a separate absolute path:

```sh
RIVET_DATA_DIR="$PWD/.local/dev-workspace" pnpm dev
```

## Troubleshooting

- **`pnpm` not found:** install the pinned version above and check that your Node.js installation's global binary folder is in `PATH`.
- **`xcrun` or `swiftc` fails:** finish Command Line Tools installation and confirm `xcode-select -p` points to a valid tools or Xcode directory.
- **A speech dependency download fails:** check internet access and retry. Build downloads are checksum-verified. Do not remove checksum checks to work around an unexpected file.
- **Signature verification fails:** rebuild with `pnpm package:desktop`; avoid editing files inside the generated app. Keep the complete error in a bug report, with private paths redacted.
- **Oracle won't unlock:** the Mac authentication helper needs available Secure Enclave support. You can keep using local sheets, notes, and rules without connecting ChatGPT.

When reporting a build issue, include macOS version, hardware architecture, `node --version`, `pnpm --version`, and the failing command. Never attach your real workspace database, credentials, or unredacted chat history.
