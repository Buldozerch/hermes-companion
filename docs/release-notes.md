Hermes Companion 0.1.7 makes initial settings sequential and keeps server actions and feedback visible.

- Show a persistent, prominent Ubuntu reboot notice above the server page. Explain whether the user should wait for an operation, save pending edits or reboot now.
- Mirror the settings sections in the left navigation, with the current section, unsaved changes and walkthrough decisions synchronized with the upper tabs.
- Guide new installations through model, channels, services and tools. Save and continue only after a successful apply and health check; optional steps can be skipped. Store progress separately per server and resume matching pending jobs after reopening the app.
- Keep established profiles in normal settings management. The guided walkthrough can also be started explicitly.
- Pin save/continue actions and a green, server-confirmed success message to the bottom of the viewport.
- Open live operation output and redacted diagnostic logs in a side panel when settings are applied or a job fails. The pinned Logs button opens the same panel at any scroll position.

This includes named custom transports and connection/loading feedback from 0.1.6, clean-install compatibility from 0.1.5, server reboot controls from 0.1.4, corrected macOS packaging from 0.1.3 and signed app/agent updates from 0.1.2.

Packages target Linux x86_64 (DEB and AppImage), Windows x86_64 (NSIS EXE), macOS Apple Silicon and Intel (separate DMGs). Match the architecture before installing and verify the accompanying SHA-256 checksum.

Validation covers database persistence/isolation and progress validation, walkthrough checkpoints, existing core/configuration tests, and browser checks with mocked desktop IPC for interrupted-job resume, sequential save/skip/finish, preserved drafts, pinned feedback, reboot timing, logs, EN/RU and accessibility. Live VPS operations and native Windows/macOS checks remain manual release checks.

These are preview packages. Update artifacts use Tauri signatures; Windows installers still have no OS publisher certificate, and macOS packages use ad-hoc signing without notarization. Remote installation currently requires Ubuntu 24.04 LTS with systemd.

Author: [@buldozercode](https://t.me/buldozercode). Independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent).
