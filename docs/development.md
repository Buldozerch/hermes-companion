# Development

[Project overview](../README.md) · [Release builds](releases.md)

## Local setup

Use Node.js 22.12+, stable Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the host OS. Keep `package-lock.json` and `Cargo.lock` in Git. Install JavaScript dependencies with `npm ci`.

```bash
npm ci
npm run desktop
```

Tauri starts Vite on port 1420 and opens the native window. SSH, host verification and SQLite run in Rust. The remote Bash/Python scripts execute on the Ubuntu VPS, including when the desktop is Windows or macOS. `.gitattributes` preserves LF so Windows checkout settings cannot turn these scripts into CRLF files.

For interface-only work:

```bash
npm run dev
```

Open http://127.0.0.1:1420. The preview supports browsing, forms and drafts; it cannot run SSH or remote installation. Its localStorage drafts are separate from the desktop database. Stop this server before running `npm run desktop` on the same port.

## Checks

```bash
npm run check:release
npm run format:check
npm test
npm run build
cargo fmt --all -- --check
cargo test -p hermes-core --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
python -m unittest discover -s tests -p '*_test.py'
```

The Python boundary tests run on Linux: the private configuration and OAuth adapters use POSIX APIs because they execute on the VPS. They are not Windows desktop dependencies. Rust SSH integration tests create an in-process loopback server; normal tests do not contact the real VPS or use `.env`.

`npm run check:release` verifies matching versions, private/generated file exclusions, required files remaining trackable, tracked ignored files and local documentation links. `RELEASE_TAG=v0.1.0` can additionally validate the expected tag. Never run `git add -f` on private credentials to pass an ignore check.

## GUI tests

Use a separate Python environment, install Playwright, and start `npm run dev`. The tests use deterministic IPC fixtures; paid services and real account approval are not exercised.

```bash
python -m venv .venv
.venv/bin/python -m pip install playwright
.venv/bin/python -m playwright install chromium
.venv/bin/python tests/ui_smoke.py
.venv/bin/python tests/deployment_ui.py
.venv/bin/python tests/setup_master_ui.py
.venv/bin/python tests/hermes_management_ui.py
.venv/bin/python tests/oauth_ui.py
.venv/bin/python tests/provider_models_ui.py
.venv/bin/python tests/updates_ui.py
```

On Windows use `.venv\Scripts\python` instead of `.venv/bin/python`. The GUI scripts support `--chromium /path/to/chrome` for an existing browser. Screenshots use synthetic server data. Native WebView differences still need the [manual desktop checks](releases.md#manual-checks).

## Disposable VPS testing

The explicit `remote_vps` example loads `.env`; the application and default tests do not. Copy the empty [environment template](../.env.example) to `.env` and fill in SSH credentials for a disposable Ubuntu 24.04 LTS server. Use a host fingerprint from the provider console when available. Never print the file or include real credentials in reports.

```bash
cargo run --example remote_vps -- inspect
cargo run --example remote_vps -- install
cargo run --example remote_vps -- status
cargo run --example remote_vps -- settings
cargo run --example remote_vps -- auth-browsers
cargo run --example remote_vps -- prepare-antigravity
cargo run --example remote_vps -- auth-antigravity
cargo run --example remote_vps -- models
cargo run --example remote_vps -- logs
cargo run --example remote_vps -- verify
cargo run --example remote_vps -- lifecycle
```

`install` changes packages, users and services. `lifecycle` stops and starts Hermes. Run modifying checks only on a server authorized for them. Once manual configuration is present, preserve it: use read-only probes or targeted changes instead of resetting to a test baseline. The fixture stores its non-secret profiles and trusted host fingerprints under `target/remote-vps/`; first observed keys can be pinned there, while the GUI always asks for first-key confirmation.

## Repository layout

| Path                 | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `frontend/`          | React/TypeScript interface, shadcn/ui primitives, translations and unit tests |
| `src/`               | Rust core: SSH, profiles, deployment jobs and settings                        |
| `src/scripts/`       | Scripts transported over SSH and executed on the VPS                          |
| `src-tauri/`         | Native window, IPC commands, capabilities and OS bundle configuration         |
| `catalog/`           | Shared provider/channel/tool catalog                                          |
| `tests/`             | SSH integration tests, configuration boundaries and browser scenarios         |
| `scripts/`           | Release checks, installer build wrapper and artifact collection               |
| `.github/workflows/` | Checks and native cross-platform installer builds                             |
| `docs/`              | Architecture, design, operation and verification notes                        |

`target/`, `releases/`, dependencies, Python caches, local databases, credentials and local agent graphs are ignored. Local QA history belongs in the ignored `local-notes/` directory. Generated screenshots and mobile icon sets are ignored; the README illustration `docs/screenshots/management-model.png` and desktop icons remain trackable. Keep source files, tests, useful fixtures, lockfiles and `.env.example` in Git. Ignore rules do not remove files already present in Git history.

## Language and local data

English is the default UI language. Source strings are translation keys; Russian translations live in `frontend/locales/ru.json`. Add a translation for each new user-facing message. Technical activity and errors remain English in both locales; user-entered names and model IDs are never translated. The EN/RU selection is stored as `hermes-companion.locale` in WebView localStorage.

Tauri chooses the platform app-data directory for identifier `app.hermes.companion`. SQLite contains server addresses, SSH usernames, trusted host fingerprints and non-secret settings. Fingerprints survive profile deletion. SSH passwords/private keys are not persisted; Rust connection credentials are zeroized when dropped. OS credential storage is not implemented.

Provider keys remain on the VPS. OAuth uses native account stores; the Google CLI owns Antigravity credentials. External links open in the system browser. The WebView has no general shell or filesystem permission.

Release artifact tests run with `npm run test:release`. They use a disposable signing key and isolated files under `target/`, never the production key. `cargo test --test releases_network -- --ignored` is an optional read-only check against the two public GitHub release endpoints.
