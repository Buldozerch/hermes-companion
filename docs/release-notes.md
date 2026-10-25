Hermes Companion 0.1.6 fixes custom gateway transport selection and improves visible connection/loading feedback.

- Save custom gateways as named Hermes providers with an explicit `transport`. Hermes can ignore `model.api_mode: codex_responses` on anonymous third-party endpoints; the named route preserves the selected Chat Completions, Responses or Messages protocol.
- Label the transport selector with concrete API paths and offer a Responses hint for Sol/Astra gateways that reject Chat Completions. Explicit protocol choices remain under user control.
- Repair existing anonymous Responses connections with one action, preserving the model, endpoint and saved key. Configuration reads remain read-only and unrelated providers/settings are preserved.
- Keep loading indicators rotating during installation, downloads and model discovery, including when reduced motion is enabled. Other reduced-motion rules remain active.
- Highlight established SSH connections with green text, icons and borders.

This includes the clean-install configuration fix and live installation output from 0.1.5, server reboot controls from 0.1.4, corrected macOS packaging from 0.1.3 and signed app/agent updates from 0.1.2.

Packages target Linux x86_64 (DEB and AppImage), Windows x86_64 (NSIS EXE), macOS Apple Silicon and Intel (separate DMGs). Match the architecture before installing and verify the accompanying SHA-256 checksum.

Validation covers Rust/TypeScript/Python regression tests, configuration write/read and runtime transport resolution against Hermes v0.22.5 in an isolated temporary profile, plus browser checks with mocked desktop IPC for transport repair, protocol persistence, loading animation, connection colors, EN/RU and accessibility. A request to the user's live model gateway and native Windows/macOS checks remain manual release checks.

These are preview packages. Update artifacts use Tauri signatures; Windows installers still have no OS publisher certificate, and macOS packages use ad-hoc signing without notarization. Remote installation currently requires Ubuntu 24.04 LTS with systemd.

Author: [@buldozercode](https://t.me/buldozercode). Independent companion for [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent).
