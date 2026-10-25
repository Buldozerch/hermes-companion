Hermes Companion 0.1.0 is an early preview for setting up and managing a self-hosted Hermes Agent.

- Guided VPS onboarding, verified SSH connections and installation of the latest stable Hermes release.
- Provider/API-key and browser account connections, custom endpoints and model catalog discovery.
- Telegram setup, additional channels, agent tools, voice and external services.
- Independent settings sections, retained server credentials, service controls and diagnostic logs.
- English/Russian interface in a compact monochrome desktop app.

Packages target Linux x86_64 (DEB and AppImage), Windows x86_64 (NSIS EXE), macOS Apple Silicon and Intel (separate DMGs). Match the architecture before installing and verify the accompanying SHA-256 checksum.

Validation: the Linux app and remote installation/management flow have been checked on a disposable Ubuntu VPS. Windows/macOS GUI behavior and real account approval require manual verification before recommending this preview to users on those platforms. Successful CI builds verify compilation and automated checks, not those manual scenarios.

These are preview packages. Windows installers are unsigned; macOS packages use ad-hoc signing and are not notarized. Remote installation currently requires Ubuntu 24.04 LTS with systemd. Hermes code updates and automatic application updates are not implemented yet.

Author: [@buldozercode](https://t.me/buldozercode). Independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent).
