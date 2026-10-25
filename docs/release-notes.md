Hermes Companion 0.1.2 separates installation from configuration and adds updates for both the desktop app and Hermes Agent.

- Install a clean Hermes service before choosing any provider or messenger. No model API key or Telegram bot token is required, including when opening an older setup draft.
- Continue to model, channel, tool and service settings after installation. Existing connection validation remains active when applying selected integrations.
- Companion checks published releases, including previews, and offers signed download/install/restart updates. Existing 0.1.0/0.1.1 users must install 0.1.2 manually once.
- Hermes Agent updates use the native stable-channel updater in a durable server job. A private pre-update backup is created, existing connections and the system service definition are preserved, and failures attempt to restart the service.
- Added EN/RU progress, update status and retry controls. Unsaved server settings block server upgrades until saved or discarded.

Packages target Linux x86_64 (DEB and AppImage), Windows x86_64 (NSIS EXE), macOS Apple Silicon and Intel (separate DMGs). Match the architecture before installing and verify the accompanying SHA-256 checksum.

Validation includes frontend and Rust tests, Python configuration/auth/model tests, isolated shell upgrade jobs for success/failure, signed update-manifest assembly, public release discovery and browser UI checks with mocked desktop IPC. A fresh VPS installation/real upgrade, full application replacement/restart, Windows/macOS GUI behavior and real account approval remain manual release checks. Successful CI builds verify compilation and automated checks, not those manual scenarios.

These are preview packages. Update artifacts use Tauri signatures; Windows installers still have no OS publisher certificate, and macOS packages use ad-hoc signing without notarization. Remote installation currently requires Ubuntu 24.04 LTS with systemd.

Author: [@buldozercode](https://t.me/buldozercode). Independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent).
