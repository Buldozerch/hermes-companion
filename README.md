<img src="src-tauri/icons/icon.png" width="56" alt="Hermes Companion icon">

# Hermes Companion

**Set up Hermes Agent on your own server through a guided desktop interface.**

English · [Русский](README.ru.md)

Hermes Companion takes you from choosing a VPS to connecting your model and Telegram bot. It handles the remote installation, then lets you change providers, manage tools and services, and read logs from the same application. Your agent runs on your server.

This is an independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent), built with Rust, Tauri and React.

![Hermes Companion: model and provider settings](docs/screenshots/management-model.png)

## Get started

The project is an **early preview**. Open this repository's **Releases** page, choose a version and download the installer for your OS from **Assets**. Packaged builds do not require Rust or Node.js on your computer.

| Desktop             | File                  | Installation                                                |
| ------------------- | --------------------- | ----------------------------------------------------------- |
| Windows x86_64      | `_setup.exe`          | Run the installer, then open Hermes Companion               |
| macOS Apple Silicon | ARM64 `.dmg`          | Open the DMG and drag the app to Applications               |
| macOS Intel         | x86_64 `.dmg`         | Open the DMG and drag the app to Applications               |
| Linux x86_64        | `.AppImage` or `.deb` | Make the AppImage executable and run it, or install the DEB |

Check the release notes for tested platforms and known limitations. If your chosen release has no installer for your platform, you can [run from source](#run-from-source). See the [release guide](docs/releases.md) for package details and how maintainers build and publish releases.

These are desktop applications. The browser preview lets you explore the interface; real SSH connections and installation use the desktop app. The remote installer currently supports **Ubuntu 24.04 LTS with systemd**.

## What you need

- A fresh Ubuntu 24.04 LTS VPS with SSH access. Recommended: **2 vCPU, 4 GB RAM and 25 GB disk**. Smaller servers receive resource recommendations; less than 1 GB free disk blocks installation.
- A root login or an account with passwordless `sudo` for preparing the server.
- An API key or a supported provider account. Browser sign-in happens after Hermes is installed.
- A Telegram bot token and your numeric Telegram ID if you choose Telegram. The app links to the tools for getting both.

The app includes links to [VDSina](https://www.vdsina.com/?partner=62n73usqa1jp) and [HIP Hosting](https://hip.hosting/?code=9f78107d10447a5f9b47). You can also use a server you already own that meets the requirements. VPS rental and paid provider services are billed by their providers.

## From server to agent

1. **Add your server.** Follow the hosting instructions or select that you already have a server.
2. **Connect securely.** Enter SSH details and verify the server fingerprint before sending credentials.
3. **Choose your setup.** Configure Telegram, the model provider, and optional voice/search/image services. Core agent tools are enabled by default.
4. **Install Hermes.** Follow live progress while the app prepares Ubuntu, creates the dedicated `hermes` user and installs the latest stable Hermes release. The remote job continues if the app closes.
5. **Manage your agent.** Switch models or providers, replace keys, change channels and tools, or inspect service status and logs. Settings are applied without reinstalling Hermes.

## Connections and capabilities

| Area            | Available now                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Models          | All 53 native provider variants in the catalog; custom OpenAI-compatible endpoints; Groq/Mistral/Together/Ollama presets                         |
| Account sign-in | ChatGPT, Anthropic, OpenRouter, Nous, MiniMax and xAI browser flows; Google Antigravity through a community Hermes plugin and official `agy` CLI |
| Model selection | Automatic catalog loading after entering credentials or authorizing an account, search, refresh and manual ID entry                              |
| Channels        | Telegram-first setup and an advanced catalog of other Hermes channels, including Discord and Slack                                               |
| Tools           | Terminal, code, files, memory and web tools enabled by default, with optional exclusions                                                         |
| Services        | TTS, transcription, search, page extraction and optional image generation, including free options without API keys                               |
| Operations      | Reconnectable installation progress, start/stop/restart, diagnostic logs and separate settings sections                                          |
| Interface       | Compact monochrome layout and persistent English/Russian switching; technical errors and logs stay in English                                    |

Provider suggestions reflect the catalog snapshot, not a pinned Hermes installation version. Some providers require extra credentials, account access or dependencies. Model catalogs do not prove generation access or quota. Antigravity uses the [community plugin](https://github.com/neerazz/hermes-antigravity-oauth) and [official Google CLI](https://antigravity.google/cli); its normal sign-in performs a small verification turn after approval.

## Your data and access

Server profiles, trusted SSH fingerprints and non-secret preferences are stored locally in SQLite. SSH passwords and private keys are used to connect and are not saved in that database. Provider credentials stay in private files or native account stores on your VPS; the interface reads credential presence rather than retrieving saved keys.

Hermes runs as a dedicated user without root or sudo membership. Its terminal and file tools can still change files accessible to that user. The managed API listens on loopback and requires authentication. Removing a profile from Companion does not remove Hermes from the server.

The installer protects existing unmanaged Hermes installations. Use a fresh server for a first installation. A healthy service does not establish that the selected model can answer.

## Run from source

Install **Node.js 22.12+**, stable Rust and the [Tauri prerequisites for your desktop OS](https://v2.tauri.app/start/prerequisites/). Then run these commands in the project directory:

```bash
npm ci
npm run desktop
```

This opens the native app and starts its local development frontend. No `.env` file is needed for normal use: enter server details in the app. Close any existing preview using port 1420 before launching desktop development mode.

To create a release installer on the current OS:

```bash
npm run release
```

Installers and SHA-256 checksums are copied into `releases/<platform>/`. macOS test builds use ad-hoc signing; Windows test builds are unsigned. See [building and testing releases](docs/releases.md) for platform setup and installation details.

## Project status and documentation

Builds are produced by GitHub Actions and attached to releases after the release workflow succeeds. Each release's notes describe its validation status. Hermes code updates from the app, signed public distribution and automatic app updates remain future work.

- [Development, tests and local data](docs/development.md)
- [Release builds and cross-platform test checklist](docs/releases.md)
- [Architecture and roadmap](docs/architecture.md)
- [Interface design](docs/design.md)

Created by [@buldozercode](https://t.me/buldozercode).
