# Release builds

[English overview](../README.md) · [Обзор на русском](../README.ru.md) · [Development](development.md)

Preview installers are distributed through this repository's **Releases** page. Open a version, expand **Assets** and choose the file matching your OS and CPU. Review that release's notes for verification results and known limitations.

Maintainers build packages with the **Release** workflow: a manual run saves downloadable Actions artifacts, while a version tag creates a draft prerelease after every build succeeds. Publishing the draft makes its installers visible to readers of the repository. This guide also covers local builds and manual verification.

## Targets

| Platform            | Rust target                | Package             | Build host                |
| ------------------- | -------------------------- | ------------------- | ------------------------- |
| Linux x86_64        | `x86_64-unknown-linux-gnu` | `.deb`, `.AppImage` | Ubuntu 22.04 runner       |
| Windows x86_64      | `x86_64-pc-windows-msvc`   | NSIS `_setup.exe`   | Windows 2022 runner       |
| macOS Apple Silicon | `aarch64-apple-darwin`     | `.dmg`              | Native ARM macOS runner   |
| macOS Intel         | `x86_64-apple-darwin`      | `.dmg`              | Native Intel macOS runner |

These are desktop targets. The VPS still needs Ubuntu 24.04 LTS with systemd. Windows ARM, Linux ARM and mobile packages are not configured. macOS packages require macOS 13.3 or later. Windows packages use WebView2; the installer downloads its bootstrapper if the runtime is missing. Windows 10/11 are the intended test systems.

The Linux CI host is Ubuntu 22.04 to avoid accidentally depending on a newer host glibc. A package built locally on a rolling Linux distribution may require newer libraries; do not use it as evidence of Ubuntu compatibility. [Tauri's AppImage guide](https://v2.tauri.app/distribute/appimage/) describes build-host compatibility and FUSE requirements.

## Build on the current OS

Install Git, Node.js 22.12+, stable Rust and the [OS-specific Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Put the project on the target computer, open its directory and run:

```bash
npm ci
npm run release
```

`release` validates the repository, builds the production frontend and optimized Rust application using the lockfile, bundles the native installer and copies only the expected packages to `releases/<platform>/`. No real `.env` or VPS credentials are needed. Linux outputs both DEB and AppImage; each Mac outputs the DMG for its own CPU. The Windows command works in PowerShell with the MSVC toolchain installed.

The release checks need a Git working tree. If you copy the source folder without its hidden `.git` directory, run `git init` in the copied project first. A remote and a GitHub account are not needed for local builds.

Examples of collected filenames:

```text
releases/linux-x86_64/Hermes-Companion_0.1.2_linux-x86_64.deb
releases/linux-x86_64/Hermes-Companion_0.1.2_linux-x86_64.AppImage
releases/windows-x86_64/Hermes-Companion_0.1.2_windows-x86_64_setup.exe
releases/macos-aarch64/Hermes-Companion_0.1.2_macos-aarch64.dmg
releases/macos-x86_64/Hermes-Companion_0.1.2_macos-x86_64.dmg
```

Each platform folder also contains `SHA256SUMS-<platform>.txt`. Those are generated files and stay outside Git. To collect an already completed native build without compiling again, run `npm run release:collect`.

### Linux dependencies

On Ubuntu 22.04/24.04, install the build dependencies before the npm commands:

```bash
sudo apt-get update
sudo apt-get install -y build-essential curl file libssl-dev pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

### macOS dependencies

Install the Xcode Command Line Tools with `xcode-select --install`, then stable Rust and Node.js. Choose an ARM64 Rust toolchain on Apple Silicon and an x86_64 toolchain on Intel. `npm run release` builds the current architecture; both kinds of Mac are represented separately in CI.

### Windows dependencies

Install the MSVC Rust toolchain and Visual Studio Build Tools with **Desktop development with C++** and a Windows SDK, as described in the Tauri prerequisites. Restart the terminal after installation. The installer uses current-user installation and offers English/Russian installer languages; the application itself initially opens in English.

## Build in GitHub Actions

After adding a GitHub remote and pushing the project:

1. Enable Actions in the repository.
2. Open **Actions → Release → Run workflow** and choose the branch to test.
3. Wait for Checks and all four native build jobs.
4. Download the `Hermes-Companion-<platform>` artifacts from that workflow run. They are retained for 30 days. No public release is created by this manual run.

The [checks workflow](../.github/workflows/checks.yml) validates versions, file exclusions, documentation links, formatting, frontend tests/build, Rust tests/Clippy and Linux Python boundary tests. Each [release matrix job](../.github/workflows/release.yml) also runs the Rust tests natively for its target before bundling. Builds use lockfiles; actions are pinned to reviewed commit IDs.

### Create a draft prerelease

Keep `package.json`, the root entry in `package-lock.json`, both Cargo manifests and `src-tauri/tauri.conf.json` on the same version. Update the workspace entries in `Cargo.lock` when changing Cargo versions. Run `npm run check:release` before tagging.

For version 0.1.2, after committing and pushing the release changes:

```bash
git tag v0.1.2
git push origin v0.1.2
```

The tag must match the application version. Once every build succeeds, the workflow creates or updates a **draft prerelease** containing the five installers, signed update bundles, `latest.json` and per-platform SHA-256 manifests. It refuses to replace files in a published release. Review the packages and [release notes](release-notes.md), perform the checks below and publish the draft manually when ready. Public publishing is not automatic.

The workflow uses GitHub's built-in token. Read access is sufficient for builds; only the draft assembly job receives `contents: write`. No SSH credentials, provider API keys, Apple account or Microsoft signing certificate are required. Builds need the dedicated updater signing secrets described below.

## Install and verify packages

- **Linux DEB:** on a compatible Debian/Ubuntu desktop, run `sudo apt install ./Hermes-Companion_0.1.2_linux-x86_64.deb`, then launch Hermes Companion from the application menu.
- **Linux AppImage:** make the downloaded file executable and launch it. If FUSE is unavailable, use the AppImage extraction mode described by the Tauri guide. A graphical session and a compatible build-host ABI are still required.
- **Windows:** run the `_setup.exe`, then launch the installed app. These preview packages have no publisher certificate, so Windows may display a reputation warning.
- **macOS:** select the DMG matching the CPU, open it and drag the app to Applications. Packages use ad-hoc signing and are not notarized. macOS may require approval in Privacy & Security; see [Tauri's explanation](https://v2.tauri.app/distribute/sign/macos/). Do not disable Gatekeeper system-wide.

Check the installer hash against its matching `SHA256SUMS` file. On Linux use `sha256sum`, on macOS `shasum -a 256`, and in PowerShell `Get-FileHash -Algorithm SHA256`.

## Manual checks

Run this on Linux, Windows, an Apple Silicon Mac and an Intel Mac when available. Use a disposable VPS for the installation scenario and preserve an existing manual setup for management checks.

- Install and open the packaged app without Vite, Node.js or a terminal server running. Confirm that the frontend is embedded.
- Switch EN/RU, restart and verify that the language and server profile persist.
- Add a server, confirm its SSH fingerprint, connect with a password and separately with a private key; also check an encrypted key and an incorrect password.
- Open hosting, BotFather and provider links; verify that they use the system browser.
- Follow the setup steps and inspect installation progress. Close/reopen the app and reconnect to the same operation.
- Open an installed server directly in management. Change a model, replace a key and toggle a service; apply and verify that unrelated settings remain intact.
- Load model lists for an API provider and your custom endpoint. Confirm manual model-ID entry remains available.
- Complete a real supported OAuth login. For Antigravity, prepare support if needed, approve Google access, paste the code promptly, select an account model and apply.
- Read English diagnostic logs, stop/start the service, disconnect/reconnect and verify saved profiles survive a normal app restart.
- Resize the window, navigate with the keyboard and check long provider/model names for clipping in each native WebView.

Successful compilation is not a manual UI or real-account test. Record the desktop OS, architecture, installer filename/hash and observed result without credentials. Windows/macOS remain unverified until those runs actually happen.

## Update signing

The committed public key in `src-tauri/tauri.conf.json` verifies updates. Keep the matching private key and its password in a secure backup; replacing the key breaks updates for existing installations. Private files in `local-notes/updater/` are ignored and must never be committed.

With the maintainer's existing local signing files and GitHub CLI access, run `node scripts/configure-release-signing.mjs --upload` once to configure `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as repository Actions secrets. Fork maintainers must generate their own key and configure their own repository and update endpoints.

Release jobs generate update artifacts, sign their bytes with a bound application version and assemble one manifest for all package types. Publishing the draft makes that manifest discoverable. Companion checks published releases including previews and selects the highest newer semantic version. It never installs drafts or unsigned packages. See [Tauri updater signing](https://v2.tauri.app/plugin/updater/) for the key format and platform behavior.

`npm run release` uses the ignored local signing files when present. Other developers can build local installers without that private key; the helper disables update-artifact generation for those builds. Such a local app can still verify future official updates using the public key.

Version 0.1.2 must be installed manually by users of older Companion versions. Subsequent signed releases can be installed through the new update button. Windows/macOS full replacement and restart still require manual package testing.
