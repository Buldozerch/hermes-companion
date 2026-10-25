# Architecture and development stages

## Product

Guide a user from buying a VPS to running Hermes Agent and maintaining it through a desktop GUI. The desktop connects directly to the user's server; the core workflow does not require an application cloud.

The UI uses compact monochrome surfaces, local fonts and a 120% scale. English is the source language. EN / RU switches the interface while preserving form state; technical logs remain English. See [design.md](design.md).

## Desktop boundary

Tauri 2 hosts React and TypeScript. IPC exposes specific Rust operations; the WebView has no general shell or filesystem access. The standalone `hermes-core` library contains SSH, persistence, deployment planning and execution. Browser preview supports interface exploration and drafts; it cannot install or connect over SSH.

SQLite stores profiles, trusted host keys, reports, settings drafts, activity and references to remote installation jobs. Passwords and private keys are held in memory and cleared on drop. Browser preview data is stored separately.

SSH host-key discovery happens before authentication. The first key requires GUI confirmation; a changed trusted key blocks authentication. Resetting or migrating a server needs an explicit key-rotation workflow, which remains to be implemented.

## Installation

The wizard covers VPS purchase → server details → SSH diagnostics → clean installation. After the service is healthy, the user opens the independent model, channel, tool and service settings. Installation never consumes integration drafts or credentials from older clients.

Each installation resolves the latest stable official Hermes release. It records the release and its exact commit, downloads that commit's official installer and uses its noninteractive mode. A running operation keeps its resolved commit. A new installation resolves the latest release again.

The supported initial server target is Ubuntu 24.04 LTS with systemd and root/passwordless sudo. Resource recommendations are separate from blockers. Less than 1 GB free disk blocks installation. A low-memory source build can use a temporary 1 GB swap file when there is enough disk space; the installer limits Node's heap, attempts to remove its swap on exit and never adds it to `/etc/fstab`.

Installation steps:

1. Prepare Ubuntu packages and optional system updates.
2. Create the dedicated, unprivileged `hermes` user.
3. Run the official source installer for the resolved release and selected browser option.
4. Write a clean profile through the installed Hermes configuration library: no model, no messaging channels and no keyed services. Core tools and free backends remain available.
5. Enable the system gateway service, check its live process and probe its authenticated loopback API.

`SetupOptions::clean_install` is applied at the backend installation boundary, so even a legacy draft selecting Telegram or an API provider cannot introduce a credential requirement. Model defaults are cleared, channels are empty and keyed transcription is disabled until selected. Explicitly selected integrations require credentials only when applying their settings after installation. Service/API health and model credential configuration are shown separately. No successful model response is claimed without an actual inference test.

## Durable remote jobs

Installation runs in a systemd service independently of SSH and the desktop window. A server-wide lock and a unique service prevent concurrent installations. Job files under `/var/lib/hermes-companion/jobs/<uuid>/` contain state, resolved release metadata and bounded diagnostic sources. The server is authoritative; reconnecting recovers its latest job.

Only supported operations and encoded payloads are transmitted. User fields are not interpolated into shell commands. Installation credentials travel through SSH stdin into root-private temporary files and are removed after configuration or failure. They never enter local SQLite, activity entries or process arguments.

A failed application-managed installation can be retried, reusing the account and upstream caches. Successful installations are protected from accidental reinstallation. Unmanaged existing accounts/homes are refused. A job that stopped before completion is reported as interrupted.

SQLite records terminal transitions once per job, so status polling does not duplicate activity.

## Service access

The gateway runs as `hermes`, with an authenticated API bound to `127.0.0.1:8642`. The app does not open a public API port. Credentials are owned by the service user with mode `0600`; configuration writes run as the unprivileged account. Account imports use directory descriptors and refuse symlink traversal.

The GUI can start, stop and restart the application-managed service and read bounded diagnostic output. Known credential values are redacted from returned logs. Closing the desktop does not stop the installed service.

## Guided setup and free services

The configuration master runs in three steps: communication, agent brain, services and voice. Its last action validates the active choices, saves the nonsecret draft and starts installation. Field errors return users to the relevant step. Settings on an installed service use the same controls and a configuration-only job.

The native catalog keeps all 53 IDs. Additional compatible presets map to `model.provider=custom`, with an endpoint-scoped key reference and persistent UI identity. Secrets stay in a separate memory-only context and only active credential fields enter the SSH payload.

Core toolsets include terminal, code execution, file operations, memory, delegation and web browsing by default. External services use explicit settings: `web.search_backend`, `web.extract_backend`, `tts.provider`, `stt.provider` and `image_gen.provider`. Paid keys are validated before a fresh installation starts and again against the merged server environment when applying configuration.

The built-in parser is an opt-in user plugin (`web-companion-parser`), selected as `web.extract_backend=companion-parser`. It uses Hermes' SSRF-safe HTTP client, a bounded 2 MB response and a static HTML/text parser. DuckDuckGo uses the official DDGS plugin and optional dependency. The Replicate provider is another user plugin with a fixed text-to-image model and the native image-provider response contract. Both are uploaded as trusted application sources and written by the unprivileged service account. No paid API is called while saving or applying these choices.

## Configuration and account sign-in

The shared source-derived catalog drives frontend choices and Rust validation. The catalog is a versioned snapshot; installation still resolves the latest stable release per job. Legacy `openai` profiles migrate to `openai-api` because upstream treats the old ID as an OpenRouter alias.

Configuration jobs use the same durable job mechanism with `operation=configure`. They skip system upgrades, account creation and source installation. The unprivileged helper runs in Hermes' own bootstrapped Python environment and uses its native dotenv/config writers. Unknown configuration sections and blank existing credentials are preserved. Switching providers clears old endpoint credential routing. Custom API keys use references scoped to the endpoint, rather than inline YAML secrets.

Selected channels are explicitly enabled; unselected channels are disabled. Public messengers require credentials and an allowlist. Tool selections set explicit platform toolsets and global exclusions. STT uses its native configuration switch. Optional Python extras, Chromium packages/system libraries and voice dependencies are installed when selected. External bridges, desktop sessions and platform accounts still need their own prerequisites.

A narrow SSH proxy starts a temporary authenticated Hermes headless account service on `127.0.0.1:8643`. It forwards only account start/poll/cancel operations and safe display fields. The service stops after completion/cancellation or 30 minutes. It never exposes account tokens or a public listener. Successful authorization reapplies the saved model settings through the normal configuration job.

## Validation

Local checks cover profile validation, SSH password/key authentication, host-key changes, deployment status parsing, duplicate event suppression and private file operations. Browser tests cover localization, form retention, progress, retries, service controls and accessibility using deterministic IPC.

Real disposable VPS checks exercise the same Rust deployment functions: installation, recovery after disconnect, failure/retry, service lifecycle, private file permissions, API authentication and reboot/autostart. Follow the [development guide](development.md#disposable-vps-testing) for these checks and the [release checklist](releases.md#manual-checks) for desktop verification. Local QA history stays outside version control.

## Next stages

- Add configuration snapshots and automatic rollback when an applied configuration fails its service health check.
- Update Hermes to the latest stable release with consistent backups, verification and a recovery procedure.
- Import unmanaged existing installations by discovering their user, paths and service without overwriting them.
- Add explicit host-key rotation/rebuild recovery to the GUI.
- Expand browser automation and Telegram integration tests with the required credentials.
- Optionally remember SSH credentials in the operating system's credential store.
- Build, manually test, sign and publish Windows/macOS/Linux installers and application updates.

## Installed-server management

The first-install master remains sequential. Installed servers use `HermesManagement` with four independent sections and a shared dirty-state/apply/discard footer. App routing loads deployment status for connected profiles; reconnecting to an installed service opens management directly. In-progress jobs open their progress panel.

`read_server_settings` runs the trusted helper inside the installed Hermes runtime as the unprivileged service account. It returns whitelisted non-secret options, credential names with values present, model authorization readiness and a SHA-256 revision. API keys, account files and arbitrary environment values never enter the response. Native provider, model, channel, tool and service choices take precedence over local drafts. Unsupported native options generate guidance and remain untouched outside their section.

`apply_server_settings` reads a fresh snapshot, rejects a stale revision and merges only requested sections. The private writer checks the revision again before writing, preserves untouched model/channel/service sections, retains unrelated plugin toolsets and validates credentials for newly enabled or changed services. Existing inline model credentials migrate to private environment references when their model section is edited. Configuration-only jobs continue to restart the gateway and check health. Dependency preparation is limited to relevant sections.

The UI tracks incoming credential replacements only in memory. Unselected service keys are excluded. Existing credentials use presence indicators with Replace/Keep saved value controls. Reloading or discarding resets these controls; finishing a configuration job reloads the applied server snapshot. OAuth authorization in management applies the live model section through the same scoped endpoint.

## Provider browser authorization

`authMethod` distinguishes API-key and OAuth choices without changing the 53 native provider IDs. OpenAI subscription login maps to `openai-codex`; API access maps to `openai-api`. Anthropic and OpenRouter keep their native provider IDs. API mode writes an explicit private environment reference where a dual-mode provider needs to override an existing account; OAuth mode removes stale explicit-key routing and uses the native credential pool. First installation may defer sign-in; applying an OAuth model to an installed server requires a connected account. Read-only snapshots return authorized provider IDs, never credential contents.

The four existing device-code flows use the authenticated, loopback-only native account service over SSH. Anthropic and OpenRouter use a separate interactive native CLI adapter: it runs Hermes' own PKCE login function under the service account, relays its URL and input prompt, then stores the result using the installed credential-pool specification. It adds no HTTP Anthropic token-minting endpoint.

The PKCE verifier stays inside a detached worker process. Each session has a private 0700 directory with atomic 0600 metadata/input files. Callback submission is bound to the server/provider/session; Anthropic state is compared before queuing the code and again by the native exchange. Callback URLs are parsed rather than fetched. One-time input is removed when consumed, cancelled or expired. Cancellation and native persistence share a lock, and a 15-minute worker deadline bounds abandoned login processes. Native token/error output is suppressed; the SSH reply contains display fields only.

The UI opens the system browser, displays a device code or password-masked callback input, polls without overlapping requests and cancels pending sessions when their scope is left. Successful authentication refreshes credential-presence metadata while preserving other unsaved settings. The user activates the chosen connection with the common Apply changes action.

## Antigravity and model discovery

`antigravity-oauth` is an additional plugin provider; the 53 native provider IDs remain available. The durable `provider` operation installs the official Google CLI as `hermes` and installs/enables the community plugin at a resolved Git commit. Preparation changes plugin registration, then restarts and checks the service; it preserves the selected model, existing credentials and in-memory form edits. Snapshots expose `preparedProviders` independently of `authorizedProviders`. Initial installation may defer the Antigravity model ID until Google authorization; managed model updates require an exact selected ID.

Google login runs native `hermes auth add antigravity-oauth` inside a private PTY. The adapter relays only the `accounts.google.com` URL, polls one-time input even while the CLI is silent and terminates its own child process group on cancellation. Raw PTY output never enters logs or the response. The official CLI owns Google tokens and includes its standard small verification turn after approval. The application does not copy or mint Google OAuth credentials. Closing a login cannot revoke a session Google has already approved.

`discover_provider_models` runs on the connected VPS, using in-memory input or the matching saved provider key. Direct HTTP probes implement OpenAI-compatible, Anthropic and Gemini metadata formats with bounded reads, TLS validation and redirect refusal. A changed custom endpoint cannot inherit a different endpoint's stored key. Other providers delegate to native Hermes model discovery and are labeled as Hermes catalogs, which may include native suggestions. Antigravity delegates to the plugin's live `agy models` reader and preserves exact IDs without static aliases. Model discovery makes no generation request and does not establish quota or inference permissions.

The model picker automatically probes after credential entry/account approval, debounces changes and ignores stale replies after provider/key changes. It preserves manually entered IDs, supports searching and explicit refresh, and retains manual entry when discovery is unavailable. Empty successful catalogs and failed probes are distinct. Catalogs are bounded to 1,000 IDs and indicate truncation or upstream pagination.

## Application and server updates

Companion uses the Tauri updater with a committed public verification key and mandatory signed-version binding. A bounded HTTPS request reads public releases from the fixed Companion GitHub repository, including published previews. Drafts and invalid versions are excluded. A newer release's `latest.json` must be its own GitHub asset; the version and download URL must match that release. Update installation holds a native operation lock, streams progress over a Tauri channel, verifies the signature and restarts the app. The frontend never receives signing secrets or chooses an arbitrary executable URL.

The release workflow signs each package type, including DEB and AppImage separately, and produces the macOS application archives used for replacement. A final job validates all five signed updater targets before assembling the manifest. The draft remains private until the maintainer publishes it.

Hermes upgrades use `operation=update` under the existing server lock. A private profile archive is stored under `/var/lib/hermes-companion/backups/<timestamp>/`. The root-owned managed service is stopped by the job before invoking `hermes update --channel stable --yes --backup --no-gateway-restart` as the unprivileged Hermes user. The job never calls the configuration writer during an update or rewrites the existing system service definition. It restarts the service, checks health and updates version markers after success. Failure preserves the backup and old markers and attempts service recovery; it does not claim automatic rollback of arbitrary native migrations.
