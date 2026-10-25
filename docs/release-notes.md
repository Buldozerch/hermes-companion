Hermes Companion 0.1.4 adds a server reboot action to the Ubuntu reboot-required notice.

- Reboot the VPS directly from the service panel after saving or discarding pending settings.
- Schedule the reboot with a short delay so the app receives acknowledgement before SSH disconnects.
- Prevent reboots during server installation/update jobs, and prevent new jobs while a reboot is scheduled.
- Keep a clear EN/RU reboot-requested notice with a reconnect action; expected SSH disconnection is not reported as a failure.

This includes the corrected macOS application/DMG packaging and signed update bundles from 0.1.3, plus clean installation, post-install settings and app/agent updates from 0.1.2.

Packages target Linux x86_64 (DEB and AppImage), Windows x86_64 (NSIS EXE), macOS Apple Silicon and Intel (separate DMGs). Match the architecture before installing and verify the accompanying SHA-256 checksum.

Validation: core and configuration regression tests, isolated reboot scheduling/locking/failure tests and browser checks with mocked desktop IPC. The UI checks cover unsaved edits, active updates, failed requests, expected disconnection, EN/RU, reconnection and accessibility. Rebooting an actual VPS remains a manual release check.

These are preview packages. Update artifacts use Tauri signatures; Windows installers still have no OS publisher certificate, and macOS packages use ad-hoc signing without notarization. Remote installation currently requires Ubuntu 24.04 LTS with systemd.

Author: [@buldozercode](https://t.me/buldozercode). Independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent).
