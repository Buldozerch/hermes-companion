Hermes Companion 0.1.8 improves log panel placement and clarifies settings refresh and service status.

- Give the logs panel an explicit right-edge placement, independent of centered-dialog translations. Keep its header and close control inside the viewport, with scrolling inside the panel and a viewport-height fallback.
- Rename Reload from server to Refresh settings, with an explanation that it reads configuration into the form. Saving still uses the bottom action bar; unsaved edits remain protected.
- Show a green Running badge only when the service and local API are healthy. Highlight the individual running-service and healthy-API values in green; stopped and unready states remain neutral.
- Preserve centered placement for ordinary dialogs and keep all new copy localized in English and Russian.

This includes the guided settings walkthrough, synchronized navigation and pinned feedback from 0.1.7, named custom transports from 0.1.6 and earlier installation/update fixes.

Packages target Linux x86_64 (DEB and AppImage), Windows x86_64 (NSIS EXE), macOS Apple Silicon and Intel (separate DMGs). Match the architecture before installing and verify the accompanying SHA-256 checksum.

Validation includes frontend tests/build and browser checks with mocked desktop IPC for scrolled-page and narrow-viewport panel bounds, close-button visibility, centered dialogs, read-only refresh, green/neutral status transitions, EN/RU and accessibility. Native Windows/macOS WebView checks remain manual release checks.

These are preview packages. Update artifacts use Tauri signatures; Windows installers still have no OS publisher certificate, and macOS packages use ad-hoc signing without notarization. Remote installation currently requires Ubuntu 24.04 LTS with systemd.

Author: [@buldozercode](https://t.me/buldozercode). Independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent).
