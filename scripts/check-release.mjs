import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function checkRelease(tag = process.env.RELEASE_TAG) {
  const read = (path) => readFileSync(resolve(projectRoot, path), "utf8");
  const packageJson = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
  const version = packageJson.version;
  const versions = [tauri.version, lock.version, lock.packages[""].version];
  for (const manifest of ["Cargo.toml", "src-tauri/Cargo.toml"]) {
    versions.push(read(manifest).match(/^version\s*=\s*"([^"]+)"/m)?.[1]);
  }
  for (const name of ["hermes-core", "hermes-desktop"]) {
    const entry = read("Cargo.lock")
      .split("[[package]]")
      .find((value) => value.includes(`name = "${name}"\n`));
    versions.push(entry?.match(/^version\s*=\s*"([^"]+)"/m)?.[1]);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version) || versions.some((item) => item !== version)) {
    throw new Error(
      "Release versions must match in package.json, package-lock.json, both Cargo manifests and tauri.conf.json.",
    );
  }
  if (tag && tag !== `v${version}`) throw new Error(`The release tag must be v${version}.`);

  const privatePaths = [
    ".env",
    ".env.local",
    ".env.production",
    "secrets/test.json",
    "credentials/test.json",
    "id_ed25519",
    "test.pem",
    "AuthKey_test.p8",
    "preview.dmg",
    "preview.exe",
    "profile.sqlite3",
    "tests/__pycache__/test.pyc",
    "node_modules/test",
    "target/test",
    "releases/test.deb",
    "graphify-out/graph.json",
    "local-notes/remote-test-report.md",
    "docs/screenshots/generated.png",
    "src-tauri/icons/android/test.png",
    "src-tauri/icons/ios/test.png",
  ];
  const publicPaths = [
    ".env.example",
    "Cargo.lock",
    "package-lock.json",
    "src/scripts/deploy-runner.sh",
    "tests/fixtures/desktop-mock.js",
    "docs/screenshots/management-model.png",
    "src-tauri/icons/icon.png",
    "src-tauri/icons/icon.ico",
    "src-tauri/icons/icon.icns",
    ".github/workflows/release.yml",
    "AGENTS.md",
  ];
  const input = [...privatePaths, ...publicPaths].join("\n") + "\n";
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: projectRoot,
    input,
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.error || ![0, 1].includes(result.status))
    throw new Error("Could not verify the repository ignore rules.");
  const ignored = new Set(result.stdout.trim().split(/\r?\n/));
  if (
    privatePaths.some((path) => !ignored.has(path)) ||
    publicPaths.some((path) => ignored.has(path))
  ) {
    throw new Error(
      "The ignore rules expose private/generated files or hide required project files.",
    );
  }
  const tracked = spawnSync("git", ["ls-files", "-ci", "--exclude-standard", "-z"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 10000,
  });
  if (tracked.error || tracked.status !== 0)
    throw new Error("Could not check tracked ignored files.");
  if (tracked.stdout)
    throw new Error(
      "Ignored files are already tracked. Remove private/generated files from the Git index before releasing.",
    );
  for (const path of ["README.md", "README.ru.md", "docs/development.md", "docs/releases.md"]) {
    for (const match of read(path).matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      // Read only local documentation targets; do not follow service URLs.
      readFileSync(resolve(projectRoot, path, "..", target));
    }
  }
  console.log(
    `Release checks passed: v${version}; versions, ignore rules and documentation links agree.`,
  );
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkRelease();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
