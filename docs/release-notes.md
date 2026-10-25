Hermes Companion 0.1.1 fixes the model-key requirement during the first Hermes installation.

- New server profiles no longer present OpenRouter and Claude Sonnet as an already selected connection.
- Install Hermes without a model API key and connect the model afterward in Hermes settings. Existing installation drafts offer an explicit option to defer model setup.
- Explicitly selected API providers and external services still require their own credentials. Browser sign-in remains available after installation.
- Deferred setup clears upstream and legacy model defaults, while existing configured providers remain selected.
- Updated English/Russian guidance and setup documentation.

Packages target Linux x86_64 (DEB and AppImage), Windows x86_64 (NSIS EXE), macOS Apple Silicon and Intel (separate DMGs). Match the architecture before installing and verify the accompanying SHA-256 checksum.

Validation for this change: 128 automated tests and browser UI checks for deferred installation, post-install provider connection, existing settings and OAuth, using mocked desktop IPC. A fresh VPS installation, Windows/macOS GUI behavior and real account approval remain manual release checks. Successful CI builds verify compilation and automated checks, not those manual scenarios.

These are preview packages. Windows installers are unsigned; macOS packages use ad-hoc signing and are not notarized. Remote installation currently requires Ubuntu 24.04 LTS with systemd. Hermes code updates and automatic application updates are not implemented yet.

Author: [@buldozercode](https://t.me/buldozercode). Independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent).
