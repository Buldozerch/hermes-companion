import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "./check-release.mjs";

if (!process.argv.includes("--upload")) {
  console.log(
    "Use --upload to store the existing local release signing key in this repository's GitHub Actions secrets.",
  );
  process.exit(0);
}
try {
  for (const [name, file] of [
    ["TAURI_SIGNING_PRIVATE_KEY", "companion.key"],
    ["TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "password.txt"],
  ]) {
    const input = readFileSync(resolve(projectRoot, "local-notes/updater", file), "utf8");
    const result = spawnSync(
      "gh",
      ["secret", "set", name, "--repo", "Buldozerch/hermes-companion", "--app", "actions"],
      { input, encoding: "utf8" },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        "Could not configure Actions signing secrets. Check GitHub CLI access to Buldozerch/hermes-companion.",
      );
  }
  console.log(
    "Dedicated updater signing secrets configured for GitHub Actions. No credential values were logged.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
