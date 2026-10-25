Hermes Companion 0.1.5 fixes clean installation with current Hermes configuration templates and makes long server operations easier to follow.

- Handle empty YAML sections such as `gateway:` correctly. Previously, the official Hermes installer could finish successfully and Companion would then fail while writing its configuration.
- Show elapsed time, the current stage, the age of the last status/output update and automatically refreshed installer output. Timers remain useful with reduced motion enabled; stage progress is not presented as an estimated completion time.
- Show the failed stage and recent installer output automatically when an operation fails or is interrupted.
- Unlock desktop Hermes settings after installation completes on a connected server, and show installation before settings in the onboarding overview.
- Keep technical errors in English, with exception types and safe source locations instead of private exception content.

This includes server reboot controls from 0.1.4, corrected macOS application/DMG packaging and signed update bundles from 0.1.3, plus clean installation, post-install settings and app/agent updates from 0.1.2.

Packages target Linux x86_64 (DEB and AppImage), Windows x86_64 (NSIS EXE), macOS Apple Silicon and Intel (separate DMGs). Match the architecture before installing and verify the accompanying SHA-256 checksum.

Validation covers Rust/TypeScript/Python regression tests, native configuration write/read against Hermes v0.22.5 in an isolated temporary profile, and browser checks with mocked desktop IPC for quiet installs, live output, reduced motion, status failures, retries, navigation, EN/RU and accessibility. A full installation on a real VPS and native Windows/macOS checks remain manual release checks.

These are preview packages. Update artifacts use Tauri signatures; Windows installers still have no OS publisher certificate, and macOS packages use ad-hoc signing without notarization. Remote installation currently requires Ubuntu 24.04 LTS with systemd.

Author: [@buldozercode](https://t.me/buldozercode). Independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent).
