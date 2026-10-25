Hermes Companion 0.1.3 fixes macOS release packaging for Apple Silicon and Intel.

- Explicitly build both the macOS application bundle and DMG installer, so signed `.app.tar.gz` updater archives are generated and collected alongside the DMGs.
- Add a regression check for the macOS bundle configuration and reproduce the failed DMG-only artifact list for both CPU architectures.
- Report the exact missing artifact and required bundle targets when collecting an incomplete release.

Clean installation without model keys or Telegram tokens, post-install configuration, signed Companion updates and stable Hermes Agent upgrades from 0.1.2 remain included. Users of 0.1.0/0.1.1 must install the new version manually once.

Packages target Linux x86_64 (DEB and AppImage), Windows x86_64 (NSIS EXE), macOS Apple Silicon and Intel (separate DMGs). Match the architecture before installing and verify the accompanying SHA-256 checksum.

Packaging regression checks pass locally, including signed update-manifest assembly and the DMG-only failure scenario for both Mac architectures. Native macOS artifact generation must be confirmed by the 0.1.3 CI run. A fresh VPS installation/real upgrade, full application replacement/restart, Windows/macOS GUI behavior and real account approval remain manual release checks. Successful CI builds verify compilation and automated checks, not those manual scenarios.

These are preview packages. Update artifacts use Tauri signatures; Windows installers still have no OS publisher certificate, and macOS packages use ad-hoc signing without notarization. Remote installation currently requires Ubuntu 24.04 LTS with systemd.

Author: [@buldozercode](https://t.me/buldozercode). Independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent).
