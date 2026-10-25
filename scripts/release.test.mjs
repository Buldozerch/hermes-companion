import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { collectRelease } from "./collect-release.mjs";
import { assembleUpdate } from "./assemble-update.mjs";

test("macOS requests both the application update bundle and DMG installer", () => {
  const config = JSON.parse(readFileSync("src-tauri/tauri.macos.conf.json", "utf8"));
  const root = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  assert.equal(root.bundle.createUpdaterArtifacts, true);
  assert.ok(
    config.bundle.targets.includes("app"),
    "The app target is required for .app.tar.gz updater generation.",
  );
  assert.ok(config.bundle.targets.includes("dmg"), "The DMG installer must still be built.");
});

test("signed packages assemble a complete manifest and reject mismatched versions", () => {
  mkdirSync("target", { recursive: true });
  const directory = mkdtempSync(resolve("target/release-test-"));
  const previousKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
  const previousPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  try {
    const key = join(directory, "fixture.key");
    const cli = resolve("node_modules/@tauri-apps/cli/tauri.js");
    const generated = spawnSync(
      process.execPath,
      [cli, "signer", "generate", "--ci", "-p", "test-only-password", "-w", key],
      { encoding: "utf8" },
    );
    assert.ifError(generated.error);
    assert.equal(generated.status, 0, "Could not generate the disposable test signing key.");
    process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(key, "utf8");
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "test-only-password";
    const output = join(directory, "releases");
    for (const [platform, extensions] of Object.entries({
      "linux-x86_64": [".deb", ".AppImage"],
      "windows-x86_64": [".exe"],
      "macos-aarch64": [".dmg", ".app.tar.gz"],
      "macos-x86_64": [".dmg", ".app.tar.gz"],
    })) {
      const source = join(directory, platform);
      mkdirSync(source);
      const files = extensions.map((extension) => {
        const path = join(source, "fixture" + extension);
        writeFileSync(path, "Disposable updater artifact " + platform + extension);
        return path;
      });
      if (platform.startsWith("macos-")) {
        // Reproduce the failed Action output: only the DMG existed with targets=["dmg"].
        assert.throws(
          () => collectRelease(platform, [files[0]], output),
          /missing required release files.*\.app\.tar\.gz.*"app" and "dmg"/,
        );
      }
      collectRelease(platform, files, output);
    }
    // Simulate Actions download-artifact with merge-multiple enabled.
    for (const platform of readdirSync(output))
      for (const name of readdirSync(join(output, platform)))
        copyFileSync(join(output, platform, name), join(output, name));
    const manifest = assembleUpdate(output);
    assert.equal(Object.keys(manifest.platforms).length, 5);
    for (const entry of Object.values(manifest.platforms)) assert.ok(entry.signature.length > 50);
    const partial = join(output, "update-windows-x86_64.json");
    const value = JSON.parse(readFileSync(partial, "utf8"));
    value.version = "999.0.0";
    writeFileSync(partial, JSON.stringify(value));
    assert.throws(() => assembleUpdate(output), /mismatched versions/);
  } finally {
    if (previousKey === undefined) delete process.env.TAURI_SIGNING_PRIVATE_KEY;
    else process.env.TAURI_SIGNING_PRIVATE_KEY = previousKey;
    if (previousPassword === undefined) delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
    else process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = previousPassword;
    rmSync(directory, { recursive: true, force: true });
  }
});
