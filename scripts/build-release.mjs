import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { checkRelease, projectRoot } from "./check-release.mjs";
import { collectRelease } from "./collect-release.mjs";

try {
  checkRelease();
  const cli = resolve(projectRoot, "node_modules/@tauri-apps/cli/tauri.js");
  const localKey = resolve(projectRoot, "local-notes/updater/companion.key");
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY && existsSync(localKey)) {
    process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(localKey, "utf8");
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = readFileSync(
      resolve(projectRoot, "local-notes/updater/password.txt"),
      "utf8",
    );
  }
  const args = [cli, "build", "--ci"];
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY)
    args.push("--config", JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
  const result = spawnSync(process.execPath, [...args, "--", "--locked"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  collectRelease();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
